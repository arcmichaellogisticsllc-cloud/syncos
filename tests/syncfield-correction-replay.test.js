const test = require('node:test');
const assert = require('node:assert/strict');
const { SyncfieldController } = require('../apps/api/dist/routes/syncfield.controller.js');

function fixture(existingId = 'correction-a') {
  const controller = new SyncfieldController({}, {});
  controller.withClient = fn => fn({});
  controller.requirePartnerForeman = async () => ({ tenant_id: 'tenant', organization: { id: 'org' } });
  controller.requireForemanCrew = async () => ({ id: 'crew' });
  controller.requireForemanCorrection = async () => ({ id: 'correction-a', status: 'awaiting_customer_reinspection' });
  controller.writeWithClient = async (_c, _r, _a, _e, _t, fn) => fn({ query: async () => ({ rows: [{ id: existingId, status: 'awaiting_customer_reinspection' }] }) });
  controller.safeCorrection = row => row;
  controller.validateCorrectionAllowedFields = () => assert.fail('Replay must not write another revision');
  return controller;
}
const request = { auth: { tenantId: 'tenant', userId: 'foreman' } };

test('correction retry after a lost response returns the existing result', async () => {
  const result = await fixture().resubmitCorrection(request, 'correction-a', { client_mutation_id: 'same-request' });
  assert.equal(result.entityId, 'correction-a');
  assert.equal(result.skipEventAudit, true);
});
test('a correction cannot reuse another correction mutation identifier', async () => {
  await assert.rejects(fixture('correction-b').resubmitCorrection(request, 'correction-a', { client_mutation_id: 'other-request' }), /another correction/);
});
test('new request cannot resubmit a correction already awaiting reinspection', async () => {
  await assert.rejects(fixture().resubmitCorrection(request, 'correction-a', {}), /not open/);
});
test('daily production PDF distinguishes accepted zero from pending customer QC', () => {
  const controller = fixture();
  const base = { production_code_id: 'code', code: 'LF', description: 'Footage', unit_of_measure: 'LF', reported_quantity: 10, work_date: '2026-09-23' };
  const zero = controller.dailyProductionPdfLines([{ ...base, customer_accepted_quantity: 0, customer_decision: 'accepted' }], 'customer_qc_status');
  assert.ok(zero.some(line => line.includes('Customer Accepted 0;')));
  const pending = controller.dailyProductionPdfLines([{ ...base, customer_accepted_quantity: null }], 'customer_qc_status');
  assert.ok(pending.some(line => line.includes('Pending Customer QC')));
});
