const test = require('node:test');
const assert = require('node:assert/strict');
const { SyncfieldController } = require('../apps/api/dist/routes/syncfield.controller');

test('corrections admit supported revision fields but reject unknown or unauthorized changes', () => {
  const controller = new SyncfieldController({});
  const allowed_fields = ['notes', 'reported_quantity', 'map_location', 'evidence', 'production_code_id'];
  const supported = {map_location:{page:1,x_ratio:0.2,y_ratio:0.3},evidence:['file-id'],production_code_id:'code-id'};
  assert.doesNotThrow(() => controller.validateCorrectionAllowedFields({allowed_fields}, supported));
  for (const field of Object.keys(supported)) {
    assert.throws(() => controller.validateCorrectionAllowedFields({allowed_fields:['notes']}, {[field]:supported[field]}), /not allowed/);
  }
  for (const value of ['', null, -1, 'not-a-number', Infinity]) {
    assert.throws(() => controller.validateCorrectionAllowedFields({ allowed_fields }, { reported_quantity: value }), /non-negative/);
  }
  assert.doesNotThrow(() => controller.validateCorrectionAllowedFields({ allowed_fields }, { reported_quantity: 0, notes: 'Removed duplicate work' }));
  for (const field of ['customer_accepted_quantity','billing_status','tenant_id','unknown_field']) {
    assert.throws(() => controller.validateCorrectionAllowedFields({allowed_fields}, {notes:'Valid note',[field]:'forbidden'}), /unknown correction field/);
  }
  assert.throws(() => controller.validateCorrectionAllowedFields({allowed_fields:['evidence']}, {partner_notes:'Bypass note restriction'}), /not allowed/);
});

test('supported correction changes are preserved in the immutable proposed revision', async () => {
  const controller = new SyncfieldController({});
  controller.requireDailyReportById = async () => ({id:'report',work_date:'2026-09-25',revision_number:1,status:'submitted'});
  controller.requireProductionRecord = async () => ({id:'production'});
  const correction={id:'correction',tenant_id:'tenant',daily_report_id:'report',production_record_id:'production',allowed_fields:['notes','production_code_id','map_location','evidence']};
  const proposal={notes:'New observed position',production_code_id:'authorized-code',map_location:{page:1,x_ratio:0.2,y_ratio:0.3},evidence:['scoped-evidence']};
  const snapshot=await controller.buildCorrectionSnapshot({},correction,proposal,2);
  assert.equal(snapshot.revision_number,2);
  assert.equal(snapshot.original_production_record_id,'production');
  for(const [field,value] of Object.entries(proposal))assert.deepEqual(snapshot.proposed_correction[field],value);
});
