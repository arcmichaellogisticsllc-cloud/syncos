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

test('phone originals retain HEIC and QuickTime bytes without pretending headers prove readability',()=>{
  const heic=Buffer.from('000000186674797068656963000000006d69663168656963','hex');
  const mov=Buffer.from('0000001466747970717420200000000071742020','hex');
  assert.deepEqual(decodeFieldEvidence('image/heic',heic.toString('base64')).bytes,heic);
  assert.deepEqual(decodeFieldEvidence('video/quicktime',mov.toString('base64')).bytes,mov);
  assert.throws(()=>decodeFieldEvidence('video/mp4',heic.toString('base64')));
  assert.throws(()=>decodeFieldEvidence('image/heic',mov.toString('base64')));
});
test('evidence retries preserve original capture category, time and location',()=>{
  const original={daily_report_id:'day',file_name:'a.heic',mime_type:'image/heic',description:'After',checksum:'original',evidence_kind:'after',captured_at:new Date('2026-09-29T12:00:00Z'),capture_location:'Pole 1'};
  assert.doesNotThrow(()=>assertEvidenceReplay(original,{...original,captured_at:'2026-09-29T12:00:00.000Z'}));
  for(const change of [{captured_at:'2026-09-29T13:00:00Z'},{capture_location:'Pole 2'},{evidence_kind:'before'}])assert.throws(()=>assertEvidenceReplay(original,{...original,...change}));
});
test('evidence policy requires explicit supported categories and bounded positive counts',()=>{
 const {evidenceRequirements}=require('../apps/api/dist/routes/field-evidence-readiness');
 assert.deepEqual(evidenceRequirements({after:2,as_built:1}),{after:2,as_built:1});
 for(const value of [null,[],{unknown:1},{after:0},{after:1.5},{after:'2'},{after:101}])assert.throws(()=>evidenceRequirements(value));
});
