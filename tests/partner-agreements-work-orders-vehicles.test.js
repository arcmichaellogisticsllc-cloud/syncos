const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("P5 reuses canonical contract, work order, rate, crew, and equipment objects", () => {
  const migration = read("packages/database/migrations/044_partner_agreements_work_orders_vehicles_foundation.sql");
  assert.match(migration, /ALTER TABLE contracts ADD COLUMN IF NOT EXISTS partner_organization_id/);
  assert.match(migration, /ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS partner_organization_id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS partner_agreement_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS partner_work_order_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS partner_vehicle_assignments/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS partner_projects\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS partner_contracts\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS partner_crews\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS partner_equipment\b/i);
});

test("P5 legal artifacts reuse restricted file bytes without public URL columns", () => {
  const migration = read("packages/database/migrations/044_partner_agreements_work_orders_vehicles_foundation.sql");
  for (const category of [
    "partner_msa_executed",
    "partner_msa_amendment_executed",
    "partner_work_order_executed",
    "partner_vehicle_agreement_executed",
  ]) {
    assert.match(migration, new RegExp(`'${category}'`));
  }
  assert.match(migration, /partner_restricted_file_objects/);
  assert.match(migration, /artifact_file_object_id UUID/);
  assert.doesNotMatch(migration, /\bpublic_url\b/i);
  assert.doesNotMatch(migration, /\braw_url\b/i);
});

test("P5 Partner self-service permissions are scoped while internal review permissions are not", () => {
  const guard = read("apps/api/src/security/permission.guard.ts");
  for (const key of [
    "partner_agreement.read",
    "partner_agreement.sign",
    "partner_agreement.artifact.read",
    "partner_work_order.read",
    "partner_work_order.rate.read",
    "partner_work_order.foreman_summary.read",
    "partner_vehicle_assignment.read",
    "partner_vehicle_assignment.artifact.read",
  ]) {
    assert.match(guard, new RegExp(`"${escapeRegex(key)}"`));
  }
  for (const key of [
    "partner_agreement.manage",
    "partner_agreement.review",
    "partner_work_order.manage",
    "partner_vehicle_assignment.manage",
    "partner_vehicle_assignment.operator.manage",
    "partner_vehicle_assignment.condition.manage",
  ]) {
    assert.doesNotMatch(guard, new RegExp(`"${escapeRegex(key)}"`));
  }
});

test("P5 controller validates legal PDF bytes and rejects client storage references", () => {
  const controller = read("apps/api/src/routes/partner-agreements.controller.ts");
  assert.match(controller, /mimeType !== "application\/pdf"/);
  assert.match(controller, /%PDF-/);
  assert.match(controller, /writeFile\(fullPath, bytes/);
  assert.match(controller, /readFile\(path\.join\(root, file\.storage_key\)\)/);
  assert.match(controller, /storage references must be created by the file service/);
  assert.doesNotMatch(controller, /public\/static/i);
  assert.doesNotMatch(controller, /apps\/web\/public/i);
});

test("P5 seed grants commercial actions narrowly to Partner personas", () => {
  const seed = read("packages/database/scripts/seed.js");
  const adminBlock = seed.match(/\{\s*name: "Partner Admin"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  const foremanBlock = seed.match(/\{\s*name: "Partner Foreman"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.match(adminBlock, /partner_agreement\.read/);
  assert.match(adminBlock, /partner_work_order\.rate\.read/);
  assert.match(adminBlock, /partner_vehicle_assignment\.allocation\.read/);
  assert.doesNotMatch(adminBlock, /partner_agreement\.manage/);
  assert.doesNotMatch(adminBlock, /partner_work_order\.manage/);
  assert.match(foremanBlock, /partner_work_order\.foreman_summary\.read/);
  assert.doesNotMatch(foremanBlock, /partner_work_order\.rate\.read/);
});

test("P5 E2E is registered in global certification", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(
    packageJson.scripts["e2e:certification"],
    /tests\/e2e\/partner-agreements-work-orders-vehicles\.spec\.ts/,
    "P5 Partner agreements/work orders/vehicles E2E must run as part of npm run e2e:certification",
  );
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
