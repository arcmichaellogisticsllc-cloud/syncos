const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

test('PartnerComplianceController emits the canonical RestrictedFileService runtime token', async () => {
  const { PartnerComplianceController } = require('../apps/api/dist/routes/partner-compliance.controller.js');
  const { RestrictedFileService } = require('../apps/api/dist/restricted-files/restricted-file.service.js');
  const types = Reflect.getMetadata('design:paramtypes', PartnerComplianceController);
  assert.ok(types);
  assert.equal(types[2], RestrictedFileService);
  assert.notEqual(types[2], Object);
});

test('AppModule declares RestrictedFileService as a provider, not a controller', () => {
  const { AppModule } = require('../apps/api/dist/modules/app.module.js');
  const meta = Reflect.getMetadata('providers', AppModule) || [];
  const controllers = Reflect.getMetadata('controllers', AppModule) || [];
  const { RestrictedFileService } = require('../apps/api/dist/restricted-files/restricted-file.service.js');
  assert.equal(meta.includes(RestrictedFileService), true);
  assert.equal(controllers.includes(RestrictedFileService), false);
});
