const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("P1 partner domain reuses canonical Organization and CapacityProvider objects", () => {
  const controller = read("apps/api/src/routes/partner-domain.controller.ts");
  assert.match(controller, /FROM organizations o/);
  assert.match(controller, /JOIN capacity_providers cp/);
  assert.match(controller, /canonical_partner_definition: "organization_with_capacity_provider"/);
  assert.doesNotMatch(controller, /INSERT INTO partners\b/i);
  assert.doesNotMatch(controller, /INSERT INTO partner_profiles\b/i);
  assert.doesNotMatch(controller, /INSERT INTO partner_records\b/i);
});

test("P1 partner scope is resolved server-side from existing user role scopes", () => {
  const source = read("apps/api/src/security/organization-scope.ts");
  assert.match(source, /FROM\s+tenant_users tu/);
  assert.match(source, /JOIN\s+user_roles ur/);
  assert.match(source, /JOIN\s+role_permissions rp/);
  assert.match(source, /JOIN\s+permissions p/);
  assert.match(source, /ur\.scope_type = 'organization'/);
  assert.match(source, /ur\.scope_type = 'contractor'/);
  assert.match(source, /cp\.organization_id/);
  assert.doesNotMatch(source, /request\.header\("x-scope-type"\)/);
  assert.doesNotMatch(source, /request\.header\("x-scope-id"\)/);
});

test("P1 partner routes enforce tenant and organization predicates in SQL", () => {
  const controller = read("apps/api/src/routes/partner-domain.controller.ts");
  const scope = read("apps/api/src/security/organization-scope.ts");
  assert.match(controller, /@RequirePermission\("capacity_provider\.read"\)/);
  assert.match(controller, /@RequirePermission\("capacity_provider\.create"\)/);
  assert.match(controller, /o\.tenant_id = \$1/);
  assert.match(controller, /cp\.tenant_id = o\.tenant_id/);
  assert.match(controller, /cp\.organization_id = o\.id/);
  assert.match(controller, /organizationScope\.appendOrganizationScope/);
  assert.match(controller, /requireCapacityProviderAccess/);
  assert.match(scope, /partner capacity provider not found/);
});

test("P1 does not add a migration for duplicate partner company storage", () => {
  const migrationFiles = fs.readdirSync(path.join(root, "packages/database/migrations")).filter((file) => file.endsWith(".sql"));
  const forbidden = [/partner_profiles/i, /\bpartners\b/i, /partner_records/i, /partner_forms/i, /partner_submissions/i];
  for (const file of migrationFiles) {
    const source = read(path.join("packages/database/migrations", file));
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must not create duplicate partner storage`);
    }
  }
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
