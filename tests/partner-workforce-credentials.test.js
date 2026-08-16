const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("P4 reuses canonical workers and crews without duplicate Partner workforce tables", () => {
  const migration = read("packages/database/migrations/043_partner_workforce_credentials_foundation.sql");
  assert.match(migration, /ALTER TABLE workers ADD COLUMN IF NOT EXISTS organization_id/);
  assert.match(migration, /ALTER TABLE crews ADD COLUMN IF NOT EXISTS organization_id/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS partner_workers\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS partner_crews\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS partner_worker_profiles\b[\s\S]*legal_name_duplicate/i);
});

test("P4 schema stores restricted personnel facts without full driver-license or public URL fields", () => {
  const migration = read("packages/database/migrations/043_partner_workforce_credentials_foundation.sql");
  for (const table of [
    "partner_worker_profiles",
    "partner_restricted_file_objects",
    "partner_worker_headshots",
    "partner_worker_credentials",
    "partner_crew_memberships",
    "partner_worker_user_links",
    "partner_workforce_attestations",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /driver_license_last_four/);
  assert.match(migration, /credential_identifier_last_four/);
  assert.match(migration, /storage_key TEXT NOT NULL/);
  assert.doesNotMatch(migration, /\bdriver_license_number\b/i);
  assert.doesNotMatch(migration, /\bfull_driver_license\b/i);
  assert.doesNotMatch(migration, /\bpublic_url\b/i);
  assert.doesNotMatch(migration, /\braw_url\b/i);
  assert.doesNotMatch(migration, /\bimage_base64\b/i);
});

test("P4 Partner self-service permissions are organization-scoped but internal review is not Partner-scoped", () => {
  const guard = read("apps/api/src/security/permission.guard.ts");
  for (const key of [
    "partner_workforce.worker.read",
    "partner_workforce.worker.create",
    "partner_workforce.headshot.submit",
    "partner_workforce.credential.submit",
    "partner_workforce.crew.create",
    "partner_workforce.membership.manage",
    "partner_workforce.foreman_roster.read",
  ]) {
    assert.match(guard, new RegExp(`"${escapeRegex(key)}"`));
  }
  assert.doesNotMatch(guard, /"partner_workforce\.review"/);
  assert.doesNotMatch(guard, /"partner_workforce\.evidence\.review"/);
});

test("P4 secure file-byte implementation rejects client storage keys and public URL responses", () => {
  const controller = read("apps/api/src/routes/partner-workforce.controller.ts");
  assert.match(controller, /writeFile\(fullPath, buffer/);
  assert.match(controller, /readFile\(this\.storagePath/);
  assert.match(controller, /SYNCOS_RESTRICTED_FILE_STORAGE_DIR/);
  assert.match(controller, /storage references are server-generated/);
  assert.match(controller, /image\/svg\+xml/);
  assert.match(controller, /restricted_personnel_evidence\.access/);
  assert.doesNotMatch(controller, /public\/static/i);
  assert.doesNotMatch(controller, /apps\/web\/public/i);
  assert.doesNotMatch(controller, /raw_url:\s*undefined/);
  assert.doesNotMatch(controller, /public_url:\s*undefined/);
});

test("P4 seed grants workforce actions narrowly to Partner personas", () => {
  const seed = read("packages/database/scripts/seed.js");
  const adminBlock = seed.match(/\{\s*name: "Partner Admin"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  const foremanBlock = seed.match(/\{\s*name: "Partner Foreman"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.match(adminBlock, /partner_workforce\.worker\.create/);
  assert.match(adminBlock, /partner_workforce\.credential\.submit/);
  assert.match(adminBlock, /partner_workforce\.membership\.manage/);
  assert.doesNotMatch(adminBlock, /partner_workforce\.review/);
  assert.match(foremanBlock, /partner_workforce\.foreman_roster\.read/);
  assert.doesNotMatch(foremanBlock, /partner_workforce\.worker\.create/);
  assert.doesNotMatch(foremanBlock, /partner_workforce\.credential\.read/);
});

test("P4 E2E is registered in global certification", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(
    packageJson.scripts["e2e:certification"],
    /tests\/e2e\/partner-workforce-credentials\.spec\.ts/,
    "P4 Partner workforce E2E must run as part of npm run e2e:certification",
  );
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
