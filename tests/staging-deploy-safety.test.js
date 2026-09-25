const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/deploy-staging-hostinger.sh');

// Exercise the real shell control flow with mocked external tools, never a server or DB.
function deployment(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncos-deploy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const sha = 'a'.repeat(40);
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, 'app/releases', sha, '.git'), { recursive: true });
  const envFile = path.join(root, 'api.env');
  fs.writeFileSync(envFile, 'NODE_ENV=staging\n');
  const log = path.join(root, 'calls');
  const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const call = tool + ' ' + args.join(' ');
fs.appendFileSync(process.env.TEST_CALLS, call + '\\n');
const scenario = process.env.TEST_SCENARIO;
if (tool === 'id') console.log('1000');
if (tool === 'git' && args[0] === 'status' && scenario === 'dirty') console.log('?? injected.ts');
if (tool === 'git' && args[0] === 'rev-parse') console.log(process.env.SYNCOS_RELEASE_SHA);
if (tool === 'node' && args[0] === '-p') console.log('064_restore_production_export_file_types.sql');
if (tool === 'sudo' && args.includes('is-active')) {
  const service = args.at(-1);
  if (!service.startsWith('syncos-staging-')) process.exit(scenario === 'legacy' ? 0 : 3);
  if (scenario === 'worker-failed' && service === 'syncos-staging-worker') process.exit(3);
}
if (tool === 'npm' && args.includes('release:staging:migrate') && scenario === 'migration-failed') process.exit(1);
if (tool === 'node' && args[0] === 'scripts/check-deployed-startup.js' && scenario === 'health-failed') process.exit(1);
`;
  for (const command of ['id', 'git', 'npm', 'sudo', 'node', 'curl', 'mv']) {
    fs.writeFileSync(path.join(bin, command), mock, { mode: 0o755 });
  }
  const result = spawnSync('bash', [script], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SYNCOS_DEPLOY_TARGET: 'hostinger-staging',
      SYNCOS_RELEASE_SHA: sha, SYNCOS_RELEASE_BRANCH: 'codex/test', STAGING_DB_BACKUP_CONFIRMED: 'true',
      SYNCOS_APP_ROOT: path.join(root, 'app'), SYNCOS_STAGING_API_ENV_FILE: envFile,
      TEST_SCENARIO: scenario, TEST_CALLS: log }, encoding: 'utf8', timeout: 60000,
  });
  // A killed harness must never count as a successful fail-closed deployment.
  assert.equal(result.error, undefined, result.error?.message);
  return { result, calls: fs.readFileSync(log, 'utf8'),
    published: fs.existsSync(path.join(root, 'app/shared/deployments/current.json')) };
}

for (const scenario of ['dirty', 'legacy']) {
  test(`deployment rejects ${scenario} before migrations or service shutdown`, t => {
    const { result, calls, published } = deployment(t, scenario);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(calls, /npm run release:staging:migrate|systemctl stop/);
    assert.equal(published, false);
  });
}
for (const scenario of ['migration-failed', 'health-failed', 'worker-failed']) {
  test(`deployment leaves services stopped without publishing on ${scenario}`, t => {
    const { result, calls, published } = deployment(t, scenario);
    assert.notEqual(result.status, 0);
    assert.ok(calls.indexOf('systemctl stop') < calls.indexOf('npm run release:staging:migrate'));
    assert.match(calls.trim().split('\n').at(-1), /systemctl stop syncos-staging-api syncos-staging-worker syncos-staging-web/);
    if (scenario === 'migration-failed') assert.doesNotMatch(calls, /systemctl start/);
    assert.equal(published, false);
  });
}
test('healthy deployment stops writers before migrating and publishes after verification', t => {
  const { result, calls, published } = deployment(t, 'healthy');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(calls.indexOf('systemctl stop') < calls.indexOf('npm run release:staging:migrate'));
  assert.ok(calls.indexOf('npm run release:staging:migrate') < calls.indexOf('systemctl start'));
  assert.match(calls, /systemctl is-active --quiet syncos-staging-worker/);
  assert.equal(published, true);
});
