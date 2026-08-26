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
  const lockHelper = read("apps/api/src/security/partner-account-binding-lock.ts");

  assert.match(invitations, /lockPartnerAccountForTransaction\(client, tenantId, input\.email\)/);
  assert.match(invitations, /lockPartnerAccountForTransaction\(client, invitation\.tenant_id, invitation\.email\)/);
  assert.match(invitations, /lockPartnerAccountOrganizationBinding\(client, tenantId, email\)/);
  assert.match(invitations, /requireNoPartnerAccountOrganizationConflict\(client, tenantId, input\.email, input\.organizationId\)/);
  assert.match(invitations, /requireNoCompetingPendingInvitation\(client, tenantId, input\.email, input\.organizationId\)/);
  assert.match(invitations, /requireNoPartnerAccountOrganizationConflict\(client, invitation\.tenant_id, invitation\.email, invitation\.organization_id\)/);
  assert.match(invitations, /This email is already associated with another Partner organization/);
  assert.match(invitations, /PARTNER_ACCOUNT_ORGANIZATION_CONFLICT/);
  assert.match(personas, /lockPartnerAccountForTransaction\(writeClient, request\.auth\.tenantId, tenantUser\.email\)/);
  assert.match(personas, /lockPartnerAccountOrganizationBinding\(client, tenantId, email\)/);
  assert.match(personas, /requireNoPartnerAccountOrganizationConflict\(writeClient, request\.auth\.tenantId, tenantUser\.id, tenantUser\.email, input\.organizationId\)/);
  assert.match(personas, /FROM partner_onboarding_invitations/);
  assert.match(lockHelper, /partner-account:\$\{tenantId\}:\$\{normalizePartnerAccountEmail\(email\)\}/);
  assert.match(lockHelper, /email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(lockHelper, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
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

test("Partner Dashboard exposes daily operations and action ownership without organization selection", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");
  const dashboardController = read("apps/api/src/routes/partner-dashboard.controller.ts");
  const contract = read("docs/product/partner-portal-ux-contract.md");
  const dashboardDoc = read("docs/product/partner-dashboard-action-center.md");

  for (const label of [
    "Needs Your Action",
    "Crew / Foreman Action",
    "Waiting / Informational",
    "Today by Crew",
    "Active Work Orders",
    "Production & QC",
    "Settlements & Payments",
    "Paid This Month",
  ]) {
    assert.match(shell, new RegExp(label.replace(/[\\/]/g, "\\$&")));
  }

  assert.match(shell, /safeFetch<PartnerDashboardReadModel>\("partner\/dashboard"\)/);
  assert.match(shell, /dashboardActionsFromReadModel/);
  assert.doesNotMatch(shell, /partnerDashboardSummary/);
  assert.doesNotMatch(shell, /partnerDashboardActions/);
  assert.doesNotMatch(shell, /dashboardFinancialSummary/);
  assert.match(dashboardController, /@Controller\("partner"\)/);
  assert.match(dashboardController, /@Get\("dashboard"\)/);
  assert.match(dashboardController, /@RequirePermission\("partner_profile\.read"\)/);
  assert.match(dashboardController, /Partner Dashboard organization context is resolved from your account, not browser selection/);
  assert.match(dashboardController, /actionsPanel/);
  assert.match(shell, /freshnessLabel/);
  assert.match(shell, /window\.location\.reload\(\)/);
  assert.doesNotMatch(shell, /organization_id=\$\{/);
  assert.match(contract, /Daily actions and crew\/work status appear before analytics and finance history/);
  assert.match(dashboardDoc, /The browser does not send an authority-bearing `organization_id`/);
});

test("Partner Dashboard financial summary keeps payment states separate and avoids rate math", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");
  const dashboardController = read("apps/api/src/routes/partner-dashboard.controller.ts");
  const dashboardDoc = read("docs/product/partner-dashboard-action-center.md");

  for (const label of [
    "Accepted Production Awaiting Settlement",
    "Issued Settlements",
    "Outstanding Payable",
    "Eligible",
    "Awaiting Customer Funds",
    "Processing",
    "Paid This Month",
  ]) {
    assert.match(shell, new RegExp(label));
  }

  assert.match(shell, /Server-returned amounts only/);
  assert.match(shell, /Amounts are returned by the Partner Dashboard read model and formatted in the browser/);
  assert.doesNotMatch(shell, /sumReturnedAmounts/);
  assert.doesNotMatch(shell, /settlementAwaitingQuantity/);
  assert.doesNotMatch(shell, /paidThisMonthAmount/);
  assert.match(dashboardController, /financialPanel/);
  assert.match(dashboardController, /acceptedProductionAwaitingSettlement/);
  assert.match(dashboardController, /financial_status <> 'void'/);
  assert.match(dashboardController, /settlement_item_id IS NULL/);
  assert.doesNotMatch(shell, /partner_rate\s*[*]/);
  assert.doesNotMatch(shell, /[*]\s*partner_rate/);
  assert.doesNotMatch(shell, /gross_partner_amount\s*=/);
  assert.match(dashboardDoc, /The frontend formats server-returned amounts/);
  assert.match(dashboardDoc, /does not calculate settlement line amounts/);
  assert.match(dashboardDoc, /Customer rates, customer invoice economics, Customer cash details beyond safe eligibility state, Sync margin/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
