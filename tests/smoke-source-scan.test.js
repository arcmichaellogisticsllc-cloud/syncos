const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listFiles } = require('../apps/api/scripts/sprint14-smoke');

test('release source scan excludes generated and dependency trees before descent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncos-source-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['migrations', 'src', 'node_modules', '.git', '.next', 'dist', 'test-results', 'playwright-report', 'coverage']) {
    fs.mkdirSync(path.join(root, directory));
    fs.writeFileSync(path.join(root, directory, 'schema.sql'), 'CREATE TABLE sample (id int);');
  }
  fs.writeFileSync(path.join(root, 'src/controller.ts'), 'export {};');
  fs.writeFileSync(path.join(root, 'src/map.pdf'), 'not source');
  // A symlink back to the tree must not cause recursion or escape the scan scope.
  fs.symlinkSync(root, path.join(root, 'src/loop'));
  assert.deepEqual(listFiles(root).map(file => path.relative(root, file)).sort(), [
    'migrations/schema.sql', 'src/controller.ts', 'src/schema.sql',
  ]);
});
