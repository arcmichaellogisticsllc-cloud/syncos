const test = require('node:test');
const assert = require('node:assert/strict');
const { PaymentRetainageAdjustmentsController } = require('../apps/api/dist/routes/payment-retainage-adjustments.controller');
const { PaymentExecutionController } = require('../apps/api/dist/routes/payment-execution.controller');

const eligible = { id: 'payable', pay_when_paid_status: 'eligible', status: 'payment_ready', hold_status: 'none', dispute_status: 'none', eligible_amount: 100, paid_amount: 10 };
const emptyInstructions = { query: async () => ({ rows: [{ amount: 0 }] }) };

test('external payment eligibility rejects disputes and retired lifecycle states before allocating money', async () => {
  const controller = new PaymentRetainageAdjustmentsController({});
  for (const status of ['voided', 'archived', 'rejected', 'held', 'disputed']) {
    await assert.rejects(controller.availableToPay(emptyInstructions, 'tenant', { ...eligible, status }), /lifecycle blocks/);
  }
  for (const dispute_status of ['open', 'under_review']) {
    await assert.rejects(controller.availableToPay(emptyInstructions, 'tenant', { ...eligible, dispute_status }), /disputed payable/);
  }
  assert.equal(await controller.availableToPay(emptyInstructions, 'tenant', eligible), 90);
  assert.equal(await controller.availableToPay(emptyInstructions, 'tenant', { ...eligible, status: 'partially_paid_later' }), 90);
});

test('editing a payment item cannot bypass the source amount ceiling', async () => {
  const controller = new PaymentExecutionController({});
  const before = { id: 'item', payment_batch_id: 'batch', source_type: 'contractor_payable', contractor_payable_id: 'payable', payment_amount: 80 };
  controller.write = async (_req, _action, _event, _type, work) => work({});
  controller.requireItem = async () => before;
  controller.requireBatch = async () => ({ id: 'batch', status: 'draft' });
  controller.requireContractorPayable = async () => ({ id: 'payable', net_payable_amount: 100 });
  let writes = 0;
  controller.update = async (_client, _table, _tenant, _id, values) => { writes++; return { ...before, ...values }; };
  controller.recalculateTotals = async () => {};
  const req = { auth: { tenantId: 'tenant', userId: 'user' } };
  await assert.rejects(controller.updateItem(req, 'item', { payment_amount: 101 }), /cannot exceed source/);
  assert.equal(writes, 0);
  await controller.updateItem(req, 'item', { payment_amount: 100 });
  assert.equal(writes, 1);
});

test('approval revalidates contractor and payroll amounts against current sources', async () => {
  const controller = new PaymentExecutionController({});
  controller.requireContractorPayable = async () => ({ id: 'payable', net_payable_amount: 100, status: 'payment_ready', payment_readiness_status: 'ready_for_payment' });
  controller.requirePayrollItem = async () => ({ payroll_run_id: 'run', net_pay_amount: 100 });
  for (const item of [
    { source_type: 'contractor_payable', contractor_payable_id: 'payable', payment_amount: 101 },
    { source_type: 'payroll', payroll_run_id: 'run', payroll_item_id: 'payroll-item', payment_amount: 101 },
  ]) {
    const client = { query: async () => ({ rows: [item] }) };
    await assert.rejects(controller.validateAllItemsReady(client, 'tenant', 'batch', false), /cannot exceed source/);
  }
});

const { requireCustomerAcceptedBilling, validateAcceptedBillingQuantity } = require('../apps/api/dist/routes/customer-accepted-billing');
test('internal approval alone cannot become customer acceptance; partial acceptance is the hard ceiling', async () => {
  for (const row of [undefined, { decision: 'rejected', customer_accepted_quantity: 0 }, { decision: 'correction_required', customer_accepted_quantity: 100 }]) {
    const client = { query: async sql => ({ rows: sql.includes('FROM customer_qc_decisions') && row ? [row] : [] }) };
    await assert.rejects(requireCustomerAcceptedBilling(client, 'tenant', 'production'), /customer acceptance is required/);
  }
  const accepted = { decision: 'partially_accepted', customer_accepted_quantity: 60, unit_of_measure: 'feet' };
  validateAcceptedBillingQuantity(accepted, 60, 'feet');
  assert.throws(() => validateAcceptedBillingQuantity(accepted, 61, 'feet'), /customer-accepted quantity/);
  assert.throws(() => validateAcceptedBillingQuantity(accepted, 60, 'meters'), /customer-accepted unit/);
});

const { ProductionController } = require('../apps/api/dist/routes/production.controller');
test('legacy create and update cannot override accepted quantities or invent customer acceptance', async () => {
  const controller = new ProductionController({});
  let decision;
  const client = { query: async sql => ({ rows: sql.includes('FROM customer_qc_decisions') && decision ? [decision] : [] }) };
  controller.write = async (_r, _a, _e, _t, work) => work(client);
  controller.billableContextFromQcReview = async () => ({ qcReview: { id: 'review', review_status: 'approved', unit: 'feet' }, productionRecord: { id: 'production', status: 'approved' }, workOrder: {}, project: {} });
  const req = { auth: { tenantId: 'tenant', userId: 'user' } };
  await assert.rejects(controller.createBillableItem(req, { qc_review_id: 'review', customer_acceptance_status: 'accepted', billable_quantity: 100 }), /customer acceptance is required/);
  decision = { id: 'decision', decision: 'partially_accepted', customer_accepted_quantity: 60, unit_of_measure: 'feet' };
  await assert.rejects(controller.createBillableItem(req, { qc_review_id: 'review', billable_quantity: 100, override_reasons: { billable_quantity_override_reason: 'override' } }), /customer-accepted quantity/);
  controller.requireRecord = async () => ({ id: 'billable', production_record_id: 'production', billable_quantity: 60, unit: 'feet', status: 'needs_rate' });
  await assert.rejects(controller.updateBillableItem(req, 'billable', { billable_quantity: 100 }), /customer-accepted quantity/);
});


test('billable lineage cannot silently move to a different current customer decision', async () => {
  const client = { query: async sql => ({ rows: sql.includes('FROM customer_qc_decisions') ? [{ id: 'new-decision', decision: 'accepted', customer_accepted_quantity: 100, unit_of_measure: 'feet' }] : [] }) };
  await assert.rejects(requireCustomerAcceptedBilling(client, 'tenant', 'production', 'prior-decision'), /acceptance changed/);
  assert.equal((await requireCustomerAcceptedBilling(client, 'tenant', 'production', 'new-decision')).id, 'new-decision');
});

test('canonical billing readiness uses current customer QC while legacy billing retains internal QC guards', () => {
  const controller = new ProductionController({});
  const row = { accepted_production_source_id: 'source', customer_qc_is_current: true, current_customer_qc_decision: 'accepted', qc_review_status: null, production_record_status: 'submitted', work_order_id: 'wo', project_id: 'project', billable_quantity: 10, approved_quantity: 10, unit: 'feet', unit_rate: 10, rate_source: 'customer_rate', billing_package_status: 'ready', documentation_status: 'ready', customer_acceptance_status: 'accepted', prime_acceptance_status: 'not_required', status: 'ready_for_settlement' };
  assert.deepEqual(controller.billableBlockers(row), []);
  assert.equal(controller.deriveBillableState(row).readiness_score, 100);
  assert.equal(controller.deriveBillableState(row).readiness_status, 'ready_for_settlement');
  assert.ok(controller.billableBlockers({ ...row, customer_qc_is_current: false }).some(b => b.blocker_type === 'no_current_customer_acceptance'));
  assert.equal(controller.deriveBillableState({ ...row, customer_qc_is_current: false }).readiness_status, 'blocked');
  assert.ok(controller.billableBlockers({ ...row, accepted_production_source_id: null }).some(b => b.blocker_type === 'no_approved_qc'));
});

const { AcceptedProductionFinancialsController } = require('../apps/api/dist/routes/accepted-production-financials.controller');
test('canonical invoicing rejects stale readiness, holds, disputes and already-invoiced items before writes', async () => {
  const controller = new AcceptedProductionFinancialsController({});
  const client = { query: async () => { throw new Error('unexpected database write'); } };
  controller.write = async (_r, _a, _e, _t, work) => work(client);
  const req = { auth: { tenantId: 'tenant', userId: 'user' } };
  for (const overrides of [{ status: 'held' }, { status: 'disputed' }, { status: 'settlement_created' }, { invoice_item_id: 'invoice-item' }, { hold_reason: 'review' }, { dispute_reason: 'review' }]) {
    controller.billablesForBody = async () => [{ status: 'ready_for_settlement', ...overrides }];
    await assert.rejects(controller.createInvoice(req, {}), /Only ready, uninvoiced/);
  }
});

const { requireLinkedBillableAcceptance } = require('../apps/api/dist/routes/customer-accepted-billing');
test('historical production billables cannot advance using stored readiness without customer acceptance', async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(requireLinkedBillableAcceptance(client, 'tenant', { production_record_id: 'legacy-production', status: 'ready_for_settlement' }), /customer acceptance is required/);
  const partial = { query: async sql => ({ rows: sql.includes('FROM customer_qc_decisions') ? [{ id: 'decision', decision: 'partially_accepted', customer_accepted_quantity: 50, unit_of_measure: 'feet' }] : [] }) };
  await assert.rejects(requireLinkedBillableAcceptance(partial, 'tenant', { production_record_id: 'legacy-production', billable_quantity: 100, unit: 'feet' }), /customer-accepted quantity/);
  await requireLinkedBillableAcceptance(partial, 'tenant', { production_record_id: 'legacy-production', billable_quantity: 50, unit: 'feet' });
});

test('invoice locking acquires deterministic production locks before billable row locks and rereads changes', async () => {
  const controller = new AcceptedProductionFinancialsController({});
  const calls = [];
  const current = [{ id: 'a', production_record_id: 'a-production', status: 'held' }, { id: 'b', production_record_id: 'b-production', status: 'ready_for_settlement' }];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: sql.includes('FOR UPDATE') ? current : [] }; } };
  const rows = await controller.lockInvoiceBillables(client, 'tenant', [{ id: 'b', production_record_id: 'b-production', status: 'ready_for_settlement' }, { id: 'a', production_record_id: 'a-production', status: 'ready_for_settlement' }]);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(calls[0].params, ['tenant:production-billing:a-production']);
  assert.deepEqual(calls[1].params, ['tenant:production-billing:b-production']);
  assert.match(calls[2].sql, /FOR UPDATE/);
  assert.equal(rows[0].status, 'held');
});
