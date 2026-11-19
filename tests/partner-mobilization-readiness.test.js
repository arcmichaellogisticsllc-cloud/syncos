const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("P6 stores derived readiness snapshots without duplicating P1-P5 source facts", () => {
  const migration = read("packages/database/migrations/045_partner_mobilization_readiness_foundation.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mobilization_readiness_evaluations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mobilization_readiness_check_results/);
  assert.match(migration, /work_order_version_id UUID NOT NULL/);
  assert.match(migration, /crew_assignment_id UUID NOT NULL/);
  assert.match(migration, /vehicle_assignment_id UUID/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS mobilization_checklist_answers/i);
  assert.doesNotMatch(migration, /\bfull_tin\b|\brouting_number\b|\baccount_number\b/i);
});

test("P6 preserves decision, override, Notice, acknowledgment, and production-start history", () => {
  const migration = read("packages/database/migrations/045_partner_mobilization_readiness_foundation.sql");
  for (const table of [
    "mobilization_overrides",
    "mobilization_decisions",
    "notice_to_proceed_versions",
    "notice_acknowledgments",
    "production_start_authorizations",
    "mobilization_source_event_invalidations",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /supersedes_evaluation_id/);
  assert.match(migration, /supersedes_decision_id/);
  assert.match(migration, /supersedes_notice_id/);
  assert.match(migration, /current BOOLEAN NOT NULL DEFAULT true/);
});

test("P6 Partner permissions are scoped while internal approval and override permissions are not", () => {
  const guard = read("apps/api/src/security/permission.guard.ts");
  for (const key of [
    "partner_mobilization.read",
    "partner_mobilization.foreman.read",
    "partner_notice.read",
    "partner_notice.acknowledge",
    "partner_notice.foreman.read",
    "partner_notice.foreman.acknowledge",
  ]) {
    assert.match(guard, new RegExp(`"${escapeRegex(key)}"`));
  }
  for (const key of [
    "partner_mobilization.approve",
    "partner_mobilization.override",
    "partner_notice.issue",
  ]) {
    assert.doesNotMatch(guard, new RegExp(`"${escapeRegex(key)}"`));
  }
});

test("P6 controller separates mobilization approval from production start and excludes QC/financial writes", () => {
  const controller = read("apps/api/src/routes/partner-mobilization.controller.ts");
  assert.match(controller, /approved_to_mobilize/);
  assert.match(controller, /production_start_authorizations/);
  assert.match(controller, /Notice cannot be issued while readiness is blocked/);
  assert.match(controller, /blocked readiness cannot be approved/);
  assert.match(controller, /priorChecks/);
  assert.match(controller, /priorBlockerSet/);
  assert.doesNotMatch(controller, /prior\.blocker_codes/);
  assert.doesNotMatch(controller, /INSERT INTO production_records/i);
  assert.doesNotMatch(controller, /INSERT INTO qc_reviews/i);
  assert.doesNotMatch(controller, /INSERT INTO settlements/i);
  assert.doesNotMatch(controller, /INSERT INTO contractor_payables/i);
});

test("P6 seed grants only safe mobilization visibility to Partner personas", () => {
  const seed = read("packages/database/scripts/seed.js");
  const adminBlock = seed.match(/\{\s*name: "Partner Admin"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  const foremanBlock = seed.match(/\{\s*name: "Partner Foreman"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.match(adminBlock, /partner_mobilization\.read/);
  assert.match(adminBlock, /partner_notice\.acknowledge/);
  assert.doesNotMatch(adminBlock, /partner_mobilization\.approve/);
  assert.doesNotMatch(adminBlock, /partner_mobilization\.override/);
  assert.match(foremanBlock, /partner_mobilization\.foreman\.read/);
  assert.match(foremanBlock, /partner_notice\.foreman\.acknowledge/);
  assert.doesNotMatch(foremanBlock, /partner_notice\.read/);
});

test("P6 E2E is registered in global certification", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(
    packageJson.scripts["e2e:certification"],
    /tests\/e2e\/partner-mobilization-readiness\.spec\.ts/,
    "P6 Partner mobilization readiness E2E must run as part of npm run e2e:certification",
  );
});

test("P6 E2E fixture and event leak query are scoped to this tenant, Partner, Work Order version, and P6 aggregates", () => {
  const spec = read("tests/e2e/partner-mobilization-readiness.spec.ts");
  assert.match(spec, /const tenantA = crypto\.randomUUID\(\)/);
  assert.match(spec, /const orgA = crypto\.randomUUID\(\)/);
  assert.match(spec, /const workOrderVersionId = crypto\.randomUUID\(\)/);
  assert.match(spec, /await client\.query\("BEGIN"\)/);
  assert.match(spec, /await client\.query\("ROLLBACK"\)/);
  assert.match(spec, /e\.tenant_id = \$1/);
  assert.match(spec, /organization_id = \$2/);
  assert.match(spec, /work_order_version_id = \$3/);
  assert.match(spec, /e\.aggregate_type = 'mobilization_readiness'/);
  assert.match(spec, /e\.aggregate_type = 'notice_to_proceed'/);
  assert.match(spec, /internal mobilization note/);
});

test("P6 automatic invalidation is wired through audited source writes", () => {
  const helper = read("packages/shared/src/write-action.ts");
  const spec = read("tests/e2e/partner-mobilization-readiness.spec.ts");
  assert.match(helper, /applyMobilizationSourceInvalidation/);
  assert.match(helper, /mobilization_source_event_invalidations/);
  assert.match(helper, /worker\.suspended/);
  assert.match(helper, /vehicle_assignment\.return_recorded/);
  assert.match(helper, /mobilization_readiness\.changed/);
  assert.match(helper, /production_start\.held/);
  assert.match(spec, /canonical source mutations automatically invalidate readiness/);
  assert.doesNotMatch(spec, /source-events`,/);
});

test("P6C scheduled expiration and replay protections are registered", () => {
  const helper = read("packages/shared/src/write-action.ts");
  const worker = read("apps/worker/src/index.ts");
  const migration = read("packages/database/migrations/045_partner_mobilization_readiness_foundation.sql");
  const spec = read("tests/e2e/partner-mobilization-readiness.spec.ts");
  assert.match(helper, /runMobilizationExpirationScan/);
  assert.match(helper, /replayMobilizationSourceInvalidation/);
  assert.match(helper, /pg_try_advisory_lock/);
  assert.match(helper, /mobilizationSourceFingerprint/);
  assert.match(helper, /vehicle_assignment\.inspection_expired/);
  assert.match(helper, /mobilization_override\.expired/);
  assert.match(helper, /ON CONFLICT DO NOTHING/);
  assert.match(worker, /startMobilizationExpirationScheduler/);
  assert.match(worker, /SYNCOS_P6_EXPIRATION_SCAN_INTERVAL_MS/);
  assert.match(worker, /SYNCOS_P6_EXPIRATION_SCAN_DISABLED/);
  assert.match(migration, /workers_status_check CHECK \(status IN \('active', 'inactive', 'suspended', 'archived'\)\)/);
  assert.match(migration, /partner_vehicle_assignments_aerial_inspection_idx/);
  assert.match(migration, /mobilization_source_event_invalidations_fingerprint_context_uidx/);
  assert.match(spec, /scheduled expiration scan invalidates time-based sources and is idempotent/);
  assert.match(spec, /duplicate and older source-event replay does not duplicate or restore authorization/);
  assert.match(spec, /billable_items/);
  assert.match(spec, /payments/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
