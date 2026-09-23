const test = require('node:test');
const assert = require('node:assert/strict');
const { SyncfieldController } = require('../apps/api/dist/routes/syncfield.controller.js');

function fixture() {
  const c = new SyncfieldController({}, {});
  c.withClient = fn => fn({});
  c.requirePartnerForeman = async () => ({ tenant_id: 'tenant-a', organization: { id: 'org-a' } });
  c.requireForemanCrew = async () => ({ id: 'crew-a', worker_id: 'worker-a' });
  // Exercise the actual selected-assignment resolver with both valid assignments.
  c.activeForemanAssignments = async () => [
    { assignment_id: 'new', map_version_id: 'new-map' },
    { assignment_id: 'old', map_version_id: 'old-map' },
  ];
  c.latestForemanAssignment = async () => ({ map_version_id: 'new-map' });
  c.requireMapFile = async (_client, tenantId, mapId) => ({ tenantId, mapId });
  c.readAuthorizedMapFile = async (_client, _request, file) => file;
  return c;
}
const req = { auth: { tenantId: 'tenant-a', userId: 'foreman' } };

test('selected older active assignment can download its own map', async () => {
  assert.deepEqual(await fixture().foremanMapBytes(req, 'old-map', 'old'), { tenantId: 'tenant-a', mapId: 'old-map' });
});
test('selected assignment cannot download another assignment map', async () => {
  await assert.rejects(fixture().foremanMapBytes(req, 'new-map', 'old'), /assigned map not found/);
});
test('unassigned and cross-tenant assignment identifiers fail closed', async () => {
  await assert.rejects(fixture().foremanMapBytes(req, 'old-map', 'foreign-assignment'), /assigned map not found/);
});
test('omitted assignment remains compatible with latest map download', async () => {
  assert.equal((await fixture().foremanMapBytes(req, 'new-map')).mapId, 'new-map');
  await assert.rejects(fixture().foremanMapBytes(req, 'old-map'), /assigned map not found/);
});
