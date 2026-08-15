const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("P3 reuses Organization and capacity_provider as the Partner identity foundation", () => {
  const controller = read("apps/api/src/routes/partner-compliance.controller.ts");
  assert.match(controller, /JOIN organizations o/);
  assert.match(controller, /JOIN capacity_providers cp/);
  assert.match(controller, /provider_type = ANY/);
  assert.doesNotMatch(controller, /INSERT INTO partners\b/i);
  assert.doesNotMatch(controller, /partner_onboarding/i);
  assert.doesNotMatch(controller, /onboarding_answers/i);
});

test("P3 schema stores structured compliance records without full TIN or full banking fields", () => {
  const migration = read("packages/database/migrations/042_partner_compliance_onboarding_foundation.sql");
  for (const table of [
    "partner_company_profiles",
    "partner_tax_profiles",
    "partner_payment_profiles",
    "partner_insurance_policies",
    "partner_restricted_evidence",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(migration, /tin_last_four/);
  assert.match(migration, /account_last_four/);
  assert.match(migration, /card_last_four/);
  assert.match(migration, /supersedes_tax_profile_id/);
  assert.match(migration, /superseded_by_tax_profile_id/);
  assert.match(migration, /supersedes_payment_profile_id/);
  assert.match(migration, /superseded_by_payment_profile_id/);
  assert.match(migration, /supersedes_policy_id/);
  assert.match(migration, /superseded_by_policy_id/);
  assert.doesNotMatch(migration, /\bfull_tin\b/i);
  assert.doesNotMatch(migration, /\btin_value\b/i);
  assert.doesNotMatch(migration, /\brouting_number\b/i);
  assert.doesNotMatch(migration, /\bbank_account_number\b/i);
  assert.doesNotMatch(migration, /\baccount_number\b/i);
});

test("P3 Partner self-service permissions remain organization scoped in PermissionGuard", () => {
  const guard = read("apps/api/src/security/permission.guard.ts");
  for (const key of [
    "partner_compliance.summary.read",
    "partner_compliance.profile.read",
    "partner_compliance.profile.submit",
    "partner_compliance.w9.read",
    "partner_compliance.w9.submit",
    "partner_compliance.payment.read",
    "partner_compliance.payment.submit",
    "partner_compliance.insurance.read",
    "partner_compliance.insurance.submit",
    "partner_compliance.evidence.read",
  ]) {
    assert.match(guard, new RegExp(`"${escapeRegex(key)}"`));
  }
  assert.doesNotMatch(guard, /"partner_compliance\.review"/);
  assert.doesNotMatch(guard, /"partner_compliance\.evidence\.review"/);
});

test("P3 permissions are provisioned narrowly for Partner Admin and Partner Foreman", () => {
  const seed = read("packages/database/scripts/seed.js");
  const permissionTypes = read("packages/permissions/src/index.ts");
  for (const key of [
    "partner_compliance.summary.read",
    "partner_compliance.profile.read",
    "partner_compliance.profile.submit",
    "partner_compliance.w9.read",
    "partner_compliance.w9.submit",
    "partner_compliance.payment.read",
    "partner_compliance.payment.submit",
    "partner_compliance.insurance.read",
    "partner_compliance.insurance.submit",
    "partner_compliance.evidence.read",
    "partner_compliance.review",
    "partner_compliance.evidence.review",
  ]) {
    assert.match(seed, new RegExp(`"${escapeRegex(key)}"`));
    assert.match(permissionTypes, new RegExp(`"${escapeRegex(key)}"`));
  }
  const partnerForemanBlock = seed.match(/\{\s*name: "Partner Foreman"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.match(partnerForemanBlock, /partner_compliance\.summary\.read/);
  assert.doesNotMatch(partnerForemanBlock, /partner_compliance\.w9\.read/);
  assert.doesNotMatch(partnerForemanBlock, /partner_compliance\.payment\.read/);
  assert.doesNotMatch(partnerForemanBlock, /partner_compliance\.evidence\.read/);
});

test("P3 API rejects sensitive ordinary payload fields and never returns raw storage URLs", () => {
  const controller = read("apps/api/src/routes/partner-compliance.controller.ts");
  assert.match(controller, /rejectSensitiveBody/);
  assert.match(controller, /routing_number/);
  assert.match(controller, /bank_account_number/);
  assert.match(controller, /Partner users cannot verify/);
  assert.match(controller, /raw_url: undefined/);
  assert.match(controller, /storage references must be created by the file service/);
  assert.match(controller, /restricted_evidence\.access/);
  assert.doesNotMatch(controller, /presigned/i);
  assert.doesNotMatch(controller, /public\/static/i);
});

test("P3 verified compliance submissions are superseded instead of destructively overwritten", () => {
  const controller = read("apps/api/src/routes/partner-compliance.controller.ts");
  assert.match(controller, /supersedeCurrent/);
  assert.match(controller, /status = 'superseded'/);
  assert.match(controller, /supersedes_tax_profile_id/);
  assert.match(controller, /superseded_by_tax_profile_id/);
  assert.match(controller, /supersedes_policy_id/);
  assert.match(controller, /superseded_by_policy_id/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
