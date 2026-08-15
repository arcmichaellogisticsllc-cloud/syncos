const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("P2 partner personas reuse existing users, tenant users, roles, permissions, and organization scope", () => {
  const controller = read("apps/api/src/routes/partner-personas.controller.ts");
  assert.match(controller, /FROM users u/);
  assert.match(controller, /JOIN tenant_users tu/);
  assert.match(controller, /JOIN user_roles ur/);
  assert.match(controller, /JOIN roles r/);
  assert.match(controller, /JOIN role_permissions rp/);
  assert.match(controller, /JOIN permissions p/);
  assert.match(controller, /ur\.scope_type = 'organization'/);
  assert.match(controller, /JOIN organizations o/);
  assert.match(controller, /JOIN capacity_providers cp/);
  assert.doesNotMatch(controller, /INSERT INTO partner_users\b/i);
  assert.doesNotMatch(controller, /INSERT INTO partner_profiles\b/i);
  assert.doesNotMatch(controller, /INSERT INTO partners\b/i);
});

test("P2 partner roles and permissions are narrowly provisioned", () => {
  const seed = read("packages/database/scripts/seed.js");
  const permissionTypes = read("packages/permissions/src/index.ts");
  for (const key of ["partner_context.read", "partner_profile.read", "partner_actions.read"]) {
    assert.match(seed, new RegExp(`"${escapeRegex(key)}"`));
    assert.match(permissionTypes, new RegExp(`"${escapeRegex(key)}"`));
  }
  assert.match(seed, /"Partner Admin"/);
  assert.match(seed, /"Partner Foreman"/);
  assert.doesNotMatch(seed, /Partner Owner/);
});

test("P2 partner permissions cannot be satisfied by tenant-scoped roles in the global guard", () => {
  const guard = read("apps/api/src/security/permission.guard.ts");
  assert.match(guard, /partnerScopedPermissions/);
  assert.match(guard, /ur\.scope_type = 'organization'/);
  assert.match(guard, /ur\.scope_id IS NOT NULL/);
  assert.match(guard, /\$6::boolean = false[\s\S]*ur\.scope_type = 'tenant'/);
});

test("P2 partner role assignment is internal-only and organization-scoped", () => {
  const controller = read("apps/api/src/routes/partner-personas.controller.ts");
  assert.match(controller, /@RequirePermission\("admin\.manage_roles"\)/);
  assert.match(controller, /Partner roles must be organization scoped/);
  assert.match(controller, /Partner users cannot self-elevate/);
  assert.match(controller, /requireAssignablePartnerOrganization/);
  assert.match(controller, /provider_type = ANY/);
  assert.match(controller, /partner_role\.assigned/);
  assert.match(controller, /partner_role\.revoked/);
});

test("P2 partner context response is external-safe", () => {
  const controller = read("apps/api/src/routes/partner-personas.controller.ts");
  assert.match(controller, /safeContext/);
  assert.match(controller, /allowed_actions/);
  assert.match(controller, /route_visibility/);
  for (const forbidden of ["ein", "bank", "margin", "internal_rate", "customer_rate", "scorecard"]) {
    assert.doesNotMatch(controller, new RegExp(forbidden, "i"));
  }
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
