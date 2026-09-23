const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('release validation includes every registered domain smoke check', () => {
  const { scripts } = require('../package.json');
  const release = fs.readFileSync(path.join(root, 'scripts/release-validation.sh'), 'utf8');
  const invoked = new Set([...release.matchAll(/^npm run ([\w:-]+)\s*$/gm)].map(match => match[1]));
  const missing = Object.keys(scripts).filter(name => name.endsWith(':smoke') && !invoked.has(name));
  assert.deepEqual(missing, [], 'New domain smoke checks must be included in release validation');
});

test('production readiness smoke validates the current shipped release', () => {
  const result = spawnSync(process.execPath, ['apps/api/scripts/sprint17-smoke.js'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
