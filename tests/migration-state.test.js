const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { migrationManifest, checkMigrationState } = require('../packages/database/dist');

test('release manifest covers every shipped migration', () => {
  assert.deepEqual(migrationManifest, fs.readdirSync('packages/database/migrations').filter(f => f.endsWith('.sql')).sort());
});
test('health rejects a pre-workforce database and an intermediate migration gap', () => {
  assert.equal(checkMigrationState(migrationManifest.slice(0,59)).ok, false);
  const gap = checkMigrationState(migrationManifest.filter(id => !id.startsWith('061_')));
  assert.equal(gap.ok, false);
  assert.equal(gap.hasCurrentCeiling, true);
  assert.equal(gap.missing.length, 1);
});
test('health accepts the complete release and rejects unknown or duplicate migrations', () => {
  assert.equal(checkMigrationState([...migrationManifest]).ok, true);
  assert.equal(checkMigrationState([...migrationManifest, '999_unknown.sql']).ok, false);
  assert.equal(checkMigrationState([...migrationManifest, migrationManifest[0]]).ok, false);
});

test('deployment rejects HTTP-success payloads from an old release or failed startup', () => {
  const { isReleaseHealthy } = require('../scripts/check-deployed-startup');
  const healthy = {ok:true, migrations:checkMigrationState([...migrationManifest])};
  assert.equal(isReleaseHealthy(healthy), true);
  assert.equal(isReleaseHealthy({...healthy, ok:false}), false);
  assert.equal(isReleaseHealthy({ok:true, migrations:{...healthy.migrations,currentCeiling:'059_syncfield_coil_commercial_policy.sql'}}), false);
  assert.equal(isReleaseHealthy({ok:true, migrations:{...healthy.migrations,appliedCount:59}}), false);
  assert.equal(isReleaseHealthy({ok:true}), false);
});
