const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeFieldEvidence, assertEvidenceReplay, FIELD_EVIDENCE_MAX_BYTES } = require('../apps/api/dist/routes/field-evidence-validation');

test('field evidence accepts an original photo above the historical two MB cap', () => {
  const photo = Buffer.alloc(3500000); photo.set([255,216,255]);
  const result = decodeFieldEvidence('image/jpeg', photo.toString('base64'));
  assert.deepEqual(result.bytes, photo);
  assert.equal(result.checksum.length, 64);
});
test('field evidence validates types, base64 and hard size bound', () => {
  assert.throws(() => decodeFieldEvidence('image/png', Buffer.from('not a picture').toString('base64')));
  assert.throws(() => decodeFieldEvidence('text/html', Buffer.from('<script>').toString('base64')));
  assert.throws(() => decodeFieldEvidence('image/jpeg', '/9j/==='));
  const large=Buffer.alloc(FIELD_EVIDENCE_MAX_BYTES+1);large.set([255,216,255]);
  assert.throws(() => decodeFieldEvidence('image/jpeg',large.toString('base64')));
  const mp4=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109]);
  assert.deepEqual(decodeFieldEvidence('video/mp4',mp4.toString('base64')).bytes,mp4);
});
test('lost-response retry accepts identical evidence and rejects changed content or ownership', () => {
  const original={daily_report_id:'day',production_record_id:'work',file_name:'photo.jpg',mime_type:'image/jpeg',description:'Crossing',checksum:'original'};
  assert.doesNotThrow(()=>assertEvidenceReplay(original,{...original}));
  for(const key of Object.keys(original))assert.throws(()=>assertEvidenceReplay(original,{...original,[key]:'changed'}),/different evidence/);
});
