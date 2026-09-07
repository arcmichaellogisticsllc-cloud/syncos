const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('migration 060 preserves the cumulative pre-060 P4 category set and adds C2A categories', () => {
  const sql = fs.readFileSync('packages/database/migrations/060_partner_onboarding_submissions.sql', 'utf8');
  const block = sql.match(/partner_restricted_file_objects_category_check[\s\S]*?\n\);/)[0];
  const categories = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const legacy = [
    'worker_headshot', 'worker_credential_evidence', 'partner_msa_executed',
    'partner_msa_amendment_executed', 'partner_work_order_executed',
    'partner_vehicle_agreement_executed', 'syncfield_map_original_pdf',
  ];
  const c2a = ['partner_w9', 'partner_coi', 'partner_insurance_endorsement', 'partner_insurance_policy_evidence'];
  for (const category of [...legacy, ...c2a]) assert.equal(categories.has(category), true, category);
  assert.equal(categories.has('syncos_invalid_restricted_category_test'), false);
  assert.equal(/category\s+IN\s*\(/i.test(block), true);
});
