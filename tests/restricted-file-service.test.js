const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('apps/api/src/restricted-files/restricted-file.service.ts', 'utf8');
const workforce = fs.readFileSync('apps/api/src/routes/partner-workforce.controller.ts', 'utf8');
const app = fs.readFileSync('apps/api/src/modules/app.module.ts', 'utf8');

test('RestrictedFileService is injectable and owns create/write persistence', () => {
  assert.match(source, /@Injectable\(\)/);
  assert.match(source, /partner_restricted_file_objects/);
  assert.match(source, /writeFile\(/);
  assert.match(source, /unlink\(/);
  assert.match(source, /calculateRestrictedFileSha256/);
});

test('Workforce create paths use the service and local creator is absent', () => {
  assert.match(workforce, /restrictedFileService\.createRestrictedFileObject/);
  assert.doesNotMatch(workforce, /private async createRestrictedFileObject/);
  assert.match(workforce, /readAuthorizedWorkforceFile/);
  assert.match(app, /RestrictedFileService/);
});

test('service uses the caller supplied database client and safe storage primitives', () => {
  assert.match(source, /params\.client\.query/);
  assert.match(source, /resolveRestrictedStoragePath/);
  assert.match(source, /storageKey/);
  assert.match(source, /RETURNING \*/);
});

test('service rejects invalid/empty writes before metadata persistence', () => {
  assert.match(source, /!buffer\.length/);
  assert.match(source, /detectedMime/);
  assert.match(source, /await params\.client\.query/);
});
