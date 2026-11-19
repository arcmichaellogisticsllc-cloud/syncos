const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('offsite checkpoint rejects corruption and preserves recovery boundaries', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests/recovery', '-v'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
});
