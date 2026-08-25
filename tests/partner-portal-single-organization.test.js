const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("Partner Portal resolves one server-derived organization and never exposes a selector", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");
  const personas = read("apps/api/src/routes/partner-personas.controller.ts");

  assert.match(shell, /adminNavGroups/);
  assert.match(shell, /PARTNER_ACCOUNT_ORGANIZATION_CONFLICT/);
  assert.match(shell, /Your account has conflicting company access/);
  assert.doesNotMatch(shell, /organization selector/i);
  assert.doesNotMatch(shell, /organization_id.*select/i);
  assert.match(personas, /Partner Portal organization context is resolved from your account, not browser selection/);
  assert.match(personas, /partnerAccountOrganizationConflict/);
});

test("Partner Portal uses grouped admin navigation and keeps field execution in SyncField", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");

  for (const group of ["Overview", "Company", "Workforce", "Work", "Financial", "Performance"]) {
    assert.match(shell, new RegExp(`label: "${group}"`));
  }
  assert.match(shell, /\["Vehicles & Equipment", "\/partner\/vehicles"\]/);
  assert.match(shell, /\["Production", "\/partner\/production"\]/);
  assert.match(shell, /\["QC & Corrections", "\/partner\/customer-qc"\]/);
  assert.doesNotMatch(shell, /\["Daily JSA", "\/partner\/jsa"\]/);
  assert.match(shell, /href="\/syncfield\/today"/);
});

test("Invitation and role assignment block cross-organization Partner accounts", () => {
  const invitations = read("apps/api/src/routes/partner-invitations.controller.ts");
  const personas = read("apps/api/src/routes/partner-personas.controller.ts");

  assert.match(invitations, /lockPartnerAccountForTransaction\(client, tenantId, input\.email\)/);
  assert.match(invitations, /lockPartnerAccountForTransaction\(client, invitation\.tenant_id, invitation\.email\)/);
  assert.match(invitations, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(invitations, /requireNoPartnerAccountOrganizationConflict\(client, tenantId, input\.email, input\.organizationId\)/);
  assert.match(invitations, /requireNoPartnerAccountOrganizationConflict\(client, invitation\.tenant_id, invitation\.email, invitation\.organization_id\)/);
  assert.match(invitations, /This email is already associated with another Partner organization/);
  assert.match(invitations, /PARTNER_ACCOUNT_ORGANIZATION_CONFLICT/);
  assert.match(personas, /lockPartnerAccountForTransaction\(writeClient, request\.auth\.tenantId, tenantUser\.email\)/);
  assert.match(personas, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(personas, /partner-account:\$\{tenantId\}:\$\{email\.trim\(\)\.toLowerCase\(\)\}/);
  assert.match(personas, /requireNoPartnerAccountOrganizationConflict\(writeClient, request\.auth\.tenantId, tenantUser\.id, input\.organizationId\)/);
});

test("Partner Portal product boundaries keep financial truth server-authoritative and private", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");
  const contract = read("docs/product/partner-portal-ux-contract.md");

  assert.match(shell, /No Customer rate or margin/);
  assert.match(contract, /Partner Portal is single-company/);
  assert.match(contract, /Financial calculations are server-authoritative/);
  assert.match(contract, /never displays customer rates/);
  assert.match(contract, /Sync margin/);
  assert.match(contract, /Reported, accepted, payable, settled, eligible, processing, and paid states remain distinct/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
