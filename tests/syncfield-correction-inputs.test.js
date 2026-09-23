const test = require('node:test');
const assert = require('node:assert/strict');
const { SyncfieldController } = require('../apps/api/dist/routes/syncfield.controller');

test('corrections reject values that cannot be preserved in a revision', () => {
  const controller = new SyncfieldController({});
  const allowed_fields = ['notes', 'reported_quantity', 'map_location', 'evidence', 'production_code_id'];
  for (const field of ['map_location', 'evidence', 'production_code_id']) {
    assert.throws(() => controller.validateCorrectionAllowedFields({ allowed_fields }, { [field]: 'value' }), /not supported/);
  }
  for (const value of ['', null, -1, 'not-a-number', Infinity]) {
    assert.throws(() => controller.validateCorrectionAllowedFields({ allowed_fields }, { reported_quantity: value }), /non-negative/);
  }
  assert.doesNotThrow(() => controller.validateCorrectionAllowedFields({ allowed_fields }, { reported_quantity: 0, notes: 'Removed duplicate work' }));
  assert.throws(() => controller.validateCorrectionAllowedFields({ allowed_fields: ['notes'] }, { reported_quantity: 1 }), /not allowed/);
});
