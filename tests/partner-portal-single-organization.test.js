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

test("Partner company readiness uses one server-derived read model without self-approval", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");
  const dashboardController = read("apps/api/src/routes/partner-dashboard.controller.ts");
  const productSpec = read("docs/product/partner-portal-product-spec.md");
  const uxContract = read("docs/product/partner-portal-ux-contract.md");
  const readinessDoc = read("docs/product/partner-company-readiness.md");

  assert.match(dashboardController, /@Get\("readiness"\)/);
  assert.match(dashboardController, /@RequirePermission\("partner_profile\.read"\)/);
  assert.match(dashboardController, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(dashboardController, /rejectBrowserOrganizationScope\(query, headers\)/);
  assert.match(dashboardController, /resolvePartnerAdminContext\(client, request\)/);
  assert.match(dashboardController, /companyReadiness\(client, context, asOf\)/);
  assert.match(dashboardController, /workforceReadiness\(client, context, asOf\)/);
  assert.match(dashboardController, /partnerCanApprove: false/);
  assert.match(dashboardController, /tinDisplay/);
  assert.doesNotMatch(dashboardController, /customer_rate/);
  assert.doesNotMatch(dashboardController, /sync_margin/);

  assert.match(shell, /safeFetch<PartnerReadinessReadModel>\("partner\/readiness"\)/);
  assert.match(shell, /data\.readiness\?\.onboarding/);
  assert.match(shell, /data\.readiness\?\.companyProfile/);
  assert.match(shell, /data\.readiness\?\.workers/);
  assert.match(shell, /data\.readiness\?\.crews/);
  assert.match(shell, /data\.readiness\?\.vehiclesEquipment/);
  assert.match(shell, /Partner edits use the certified P3 submission workflow|Profile edits use the certified P3 submission workflow/);
  assert.match(shell, /Private file on record/);
  assert.match(shell, /action_required: "Action Required"/);
  assert.match(shell, /partnerReadinessStatusLabels\[code\] \?\? "Status Unavailable"/);
  const statusMapSource = shell.match(/const partnerReadinessStatusLabels: Record<string, string> = \{([\s\S]*?)\n\};/);
  assert.ok(statusMapSource);
  const statusEntries = Object.fromEntries([...statusMapSource[1].matchAll(/\b([a-z_]+): "([^"]+)"/g)].map((entry) => [entry[1], entry[2]]));
  for (const [code, label] of Object.entries({ not_started: "Not Started", in_progress: "In Progress", submitted: "Submitted", under_review: "Under Review", action_required: "Action Required", complete: "Complete", completed: "Complete", approved: "Approved", conditional: "Conditional", hold: "On Hold", on_hold: "On Hold", locked: "Locked", expired: "Expired", suspended: "Suspended", unavailable: "Unavailable", pending: "Pending", active: "Active", inactive: "Inactive" })) {
    assert.equal(statusEntries[code], label);
    assert.equal(statusEntries[code.toUpperCase().toLowerCase()], label);
  }
  assert.equal(statusEntries.unexpected_internal_state ?? "Status Unavailable", "Status Unavailable");
  assert.equal(statusEntries.foo_bar_private_status ?? "Status Unavailable", "Status Unavailable");
  const reasonMapSource = shell.match(/const partnerBlockerLabels: Record<string, string> = \{([\s\S]*?)\n\};/);
  assert.ok(reasonMapSource);
  const reasonEntries = Object.fromEntries([...reasonMapSource[1].matchAll(/\b([A-Z0-9_]+): "([^"]+)"/g)].map((entry) => [entry[1], entry[2]]));
  for (const [code, label] of Object.entries({ COMPANY_PROFILE_INCOMPLETE: "Complete Company Profile", W9_MISSING: "W-9 Required", PAYMENT_PROFILE_INCOMPLETE: "Complete Payment Setup", GENERAL_LIABILITY_MISSING: "General Liability Insurance Required", AUTO_LIABILITY_MISSING: "Auto Liability Insurance Required", WORKERS_COMP_MISSING: "Workers’ Compensation Required", INSURANCE_EXPIRED: "Insurance Expired", AGREEMENT_UNSIGNED: "Agreement Signature Required", CREW_MISSING_FOREMAN: "Primary Foreman Required", CREW_MISSING_WORKERS: "Additional Crew Members Required", CREW_MISSING_CAPABILITY: "Crew Capability Required", EQUIPMENT_MISSING: "Required Equipment Missing", WORKER_CREDENTIAL_EXPIRED: "Worker Credential Required" })) {
    assert.equal(reasonEntries[code], label);
  }
  assert.equal(reasonEntries.UNKNOWN_PRIVATE_BLOCKER ?? "Action Required", "Action Required");
  assert.match(shell, /str\(blocker\.label\) \|\| partnerBlockerLabel/);
  assert.match(shell, /str\(blocker\.description\) \|\| str\(blocker\.external_detail\)/);
  assert.doesNotMatch(shell, /\|\| "action_required"/);
  assert.doesNotMatch(shell, /partnerBlockerLabel[^}]+statusLabel/s);
  assert.doesNotMatch(shell, /const status = \(value \|\| "unknown"\)\.replace\(\/_\/g/);
  assert.match(shell, /aria-label=\{`\$\{label\}: \$\{presentation\}`\}/);
  assert.match(shell, /const statusPresentation = partnerReadinessStatusLabel\(status\)/);
  assert.doesNotMatch(shell, /\$\{category\.replace\(\/_\/g, " "\)\} requires attention/);
  assert.doesNotMatch(shell, /organization_id=\$\{/);
  assert.doesNotMatch(shell, /Select Partner/);

  assert.match(productSpec, /Data source: `GET \/partner\/readiness`/);
  assert.match(productSpec, /Partner cannot fabricate an executed agreement state/);
  assert.match(uxContract, /Company Approved, Crew Ready, and Project Mobilization Authorized remain separate gates/);
  assert.match(uxContract, /Partner Admin cannot self-approve/);
  assert.match(readinessDoc, /No migration is expected for Slice C/);
  assert.match(readinessDoc, /Ordinary Workers do not automatically receive SyncOS login/);
});

test("Partner company readiness keeps raw identifiers and private file data out of presentation", () => {
  const shell = read("apps/web/app/partner/partner-shell.tsx");
  const dashboardController = read("apps/api/src/routes/partner-dashboard.controller.ts");
  const readinessDoc = read("docs/product/partner-company-readiness.md");

  assert.match(shell, /title=\{str\(vehicle\.equipment_name\) \|\| "Equipment"\}/);
  assert.match(shell, /title=\{str\(workOrder\.work_order_number\) \|\| "Work Order"\}/);
  assert.match(shell, /partnerDescriptorLabel\(worker\.worker_role\)/);
  assert.match(shell, /partnerDescriptorLabel\(crew\.type\)/);
  assert.match(shell, /CapabilityRows/);
  assert.match(dashboardController, /No SyncField login created by Worker record/);
  assert.doesNotMatch(shell, /title=\{str\(vehicle\.equipment_name\) \|\| str\(vehicle\.equipment_id\)\}/);
  assert.doesNotMatch(shell, /\["Crew", str\(vehicle\.crew_id\)\]/);
  assert.doesNotMatch(shell, /storage_key/);
  assert.doesNotMatch(shell, /routing_number/);
  assert.doesNotMatch(shell, /tax_id/);

  assert.match(readinessDoc, /full TIN/);
  assert.match(readinessDoc, /raw storage keys/);
  assert.match(readinessDoc, /customer rates/);
  assert.match(readinessDoc, /Sync margin/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
