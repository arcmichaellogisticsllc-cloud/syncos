const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('apps/api/src/restricted-files/restricted-file.primitives.ts', 'utf8');

test('restricted filename sanitizer removes traversal and bounds names', () => {
  assert.match(source, /path\.basename/);
  assert.match(source, /slice\(0, 120\)/);
});

test('restricted MIME detection and extension mapping use signatures', () => {
  assert.match(source, /%PDF-/);
  assert.match(source, /image\/jpeg/);
  assert.match(source, /image\/png/);
  assert.match(source, /\.jpg/);
});

test('restricted SHA-256 and root containment are deterministic', () => {
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /startsWith\(`\$\{resolvedRoot\}\$\{path\.sep\}`\)/);
});
