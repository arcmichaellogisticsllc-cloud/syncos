const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const { PartnerDashboardController: Controller } = require('../apps/api/dist/routes/partner-dashboard.controller');
const context = { tenantId: 'tenant-a', organizationId: 'org-a', organizationName: 'Company',
  organizationStatus: 'qualified', providerStatus: 'qualified', providerVerificationStatus: 'pending_review', providerContractStatus: 'not_started' };
function fixture(completed) {
  const client = { query: async () => ({ rows: [{ as_of: '2026-11-17T05:00:00Z' }] }), release() {} };
  const controller = new Controller({ connect: async () => client });
  controller.resolvePartnerAdminContext = async () => context;
  controller.companyReadiness = async () => ({
    profile: { status: completed >= 1 ? 'READY' : 'NOT_STARTED' },
    tax: { status: completed >= 2 ? 'READY' : 'NOT_STARTED' },
    paymentSetup: { status: completed >= 3 ? 'READY' : 'NOT_STARTED' },
    insurance: { status: completed >= 4 ? 'READY' : 'NOT_STARTED', requiredPolicies: [] }, blockingReasons: [],
  });
  controller.agreementReadiness = async () => ({ status: completed >= 5 ? 'READY' : 'NOT_STARTED', blockingReasons: [] });
  controller.workforceReadiness = async () => ({ workers: { total: completed >= 6 ? 1 : 0 }, crews: { total: completed >= 7 ? 1 : 0, actionRequired: 0 }, blockingReasons: [] });
  controller.vehicleReadiness = async () => ({ total: completed >= 8 ? 1 : 0, actionRequired: 0, blockingReasons: [] });
  controller.capacityReadiness = async () => ({ capabilities: completed >= 9 ? ['fiber'] : [], territories: [], blockingReasons: [] });
  for (const panel of ['crews', 'todayByCrew', 'workOrders', 'production', 'qcCorrections', 'financial', 'performance']) controller[panel + 'Panel'] = async () => ({});
  return { controller, client };
}
for (const completed of [0, 3, 5, 9]) test(`dashboard and readiness agree at ${completed}/9 without granting approval`, async () => {
  const { controller } = fixture(completed);
  const dashboard = await controller.dashboard({}, {}, {});
  const readiness = await controller.readiness({}, {}, {});
  assert.equal(dashboard.company.requiredComplete, completed);
  assert.equal(dashboard.company.requiredTotal, 9);
  assert.equal(dashboard.company.requiredComplete, readiness.onboarding.requiredComplete);
  assert.equal(dashboard.company.requiredTotal, readiness.onboarding.requiredTotal);
  assert.equal(readiness.companyApproval.state, 'UNDER_REVIEW');
  const action = dashboard.actions.needsYourAction.find(a => a.reasonCode === 'onboarding_incomplete');
  if (completed < 9) assert.match(action.description, new RegExp(`${completed} of 9`));
  else assert.equal(action, undefined);
});
test('failed readiness leaves other dashboard panels available, counts unknown, no misleading onboarding action', async () => {
  const { controller } = fixture(5);
  controller.capacityReadiness = async () => { throw Error('unavailable'); };
  const dashboard = await controller.dashboard({}, {}, {});
  assert.equal(dashboard.panelStatus.company, 'UNAVAILABLE');
  assert.equal(dashboard.company.requiredComplete, null);
  assert.equal(dashboard.company.requiredTotal, null);
  assert.equal(dashboard.actions.needsYourAction.some(a => a.reasonCode === 'onboarding_incomplete'), false);
  assert.equal(dashboard.panelStatus.workOrders, 'READY');
  await assert.rejects(controller.readiness({}, {}, {}), /unavailable/);
});
test('known lifecycle statuses normalize explicitly; unknown statuses remain unavailable', () => {
  const { controller } = fixture(0);
  assert.equal(controller.readinessStatus('qualified'), 'IN_PROGRESS');
  assert.equal(controller.readinessStatus('unexpected-new-status'), 'UNAVAILABLE');
});
for (const kind of ['missing', 'expired', 'verified']) test(`insurance requirement is not completed for ${kind} policies unless valid`, async () => {
  const controller = new Controller({});
  const types = ['commercial_general_liability', 'commercial_auto', 'workers_compensation'];
  const client = { query: async sql => ({ rows: sql.includes('partner_insurance_policies') ? types.slice(0, kind === 'missing' ? 1 : 3).map(policy_type => ({ policy_type, status: 'verified', expiration_date: kind === 'expired' ? '2020-01-01' : '2030-01-01' })) : [] }) };
  const company = await controller.companyReadiness(client, context, '2026-11-17T05:00:00Z');
  assert.equal(company.insurance.status, kind === 'verified' ? 'READY' : 'ACTION_REQUIRED');
});
test('organization lifecycle badges render actual values and retain unknown fallback', () => {
  const shell = fs.readFileSync('apps/web/app/partner/partner-shell.tsx', 'utf8');
  const snippet = shell.slice(shell.indexOf('const partnerReadinessStatusLabels:'), shell.indexOf('const partnerBlockerLabels:'));
  const js = ts.transpileModule(snippet + '\nexports.label = partnerReadinessStatusLabel;', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const result = {};
  vm.runInNewContext(js, { exports: result, str: value => String(value ?? '') });
  for (const [status, label] of Object.entries({ discovered: 'Discovered', researched: 'Researched', qualified: 'Qualified', relationship_opened: 'Relationship Opened', active: 'Active', strategic: 'Strategic', dormant: 'Dormant', archived: 'Archived' })) assert.equal(result.label(status), label);
  assert.equal(result.label('new_unknown'), 'Status Unavailable');
});

for (const status of ['superseded', 'voided', 'terminated', 'issued', 'executed', 'effective']) {
  test(`agreement ${status} with historical signing date only completes when current`, async () => {
    const controller = new Controller({});
    const client = { query: async () => ({ rows: [{ status, contract_status: 'active', executed_at: '2026-01-01', version_number: 1 }] }) };
    const result = await controller.agreementReadiness(client, context);
    assert.equal(result.status === 'READY', ['executed', 'effective'].includes(status));
  });
}
test('terminated parent contract cannot complete the agreement requirement', async () => {
  const controller = new Controller({});
  const result = await controller.agreementReadiness({ query: async () => ({ rows: [{ status: 'effective', contract_status: 'terminated' }] }) }, context);
  assert.notEqual(result.status, 'READY');
});
