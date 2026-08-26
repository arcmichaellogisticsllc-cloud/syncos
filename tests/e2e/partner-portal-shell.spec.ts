import crypto from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";

type Seeded = {
  tenantA: string;
  orgA: string;
  orgTenantB: string;
  crewA: string;
  workerIds: string[];
  workOrderVersionId: string;
  agreementVersionId: string;
  vehicleAssignmentId: string;
  adminToken: string;
  foremanToken: string;
  internalToken: string;
  tenantBToken: string;
  adminPermissions: string[];
  foremanPermissions: string[];
};

test.describe.serial("P7 Partner Portal shell", () => {
  let client: Client;
  let seeded: Seeded;
  let downstreamCountsBefore: Awaited<ReturnType<typeof financialCounts>>;

  test.beforeAll(async ({ request }) => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedPortalFixture(client, secret);
    await authorizePortalFixture(request, seeded);
    downstreamCountsBefore = await financialCounts(client);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("Partner Admin enters dashboard with safe P1-P6 operational summary", async ({ page }) => {
    test.setTimeout(90_000);
    const dialogs = failOnUnexpectedDialogs(page);
    await installSession(page, seeded.adminToken, seeded.adminPermissions);
    await page.goto("/partner");
    await expect(page.getByRole("heading", { name: "P7 Partner A", level: 1 })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Dashboard", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs Attention" })).toBeVisible();
    await expect(page.getByText("Needs Your Action")).toBeVisible();
    await expect(page.getByText("Crew / Foreman Action")).toBeVisible();
    await expect(page.getByText("Waiting / Informational")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today by Crew" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Active Work Orders" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Production & QC" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settlements & Payments" })).toBeVisible();
    await expect(page.getByText(/Updated|Data may be stale/)).toBeVisible();
    await expect(page.getByRole("link", { name: /WO-P7-A/ })).toBeVisible();
    await expect(page.getByText("MAP-P7-A").first()).toBeVisible();
    await expect(page.getByText("No Customer rate or margin")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Company" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Compliance", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Production", exact: true })).toBeVisible();
    await expect(page.getByText("Finance")).toHaveCount(0);
    await expect(page.getByText("Collections")).toHaveCount(0);
    await expect(page.getByText("Sync margin")).toHaveCount(0);
    await expect(page.getByText("internal_notes")).toHaveCount(0);

    await page.goto("/syncfield/today");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await expect(page.getByText("SyncField requires an active Foreman assignment.")).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test("Partner Admin workspaces expose safe company, workforce, agreement, vehicle, and mobilization views", async ({ page }) => {
    test.setTimeout(180_000);
    await installSession(page, seeded.adminToken, seeded.adminPermissions);
    await page.goto("/partner/company");
    await expect(page.getByText("P7 Partner A LLC")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("1234")).toHaveCount(0);

    await page.goto("/partner/compliance");
    await expect(page.getByRole("heading", { name: "Insurance" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("commercial_auto")).toBeVisible();
    await expect(page.getByText("storage_key")).toHaveCount(0);

    await page.goto("/partner/workers");
    await expect(page.getByText("P7-0 Worker")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("driver-license-number")).toHaveCount(0);

    await page.goto(`/partner/workers/${seeded.workerIds[0]}`);
    await expect(page.getByRole("heading", { name: "P7-0 Worker" })).toBeVisible({ timeout: 45_000 });

    await page.goto("/partner/crews");
    await expect(page.getByText("P7 Ready Crew")).toBeVisible({ timeout: 45_000 });

    await page.goto(`/partner/agreements/${seeded.agreementVersionId}`);
    await expect(page.getByText("P7-MSA")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("storage_key")).toHaveCount(0);

    await page.goto("/partner/vehicles");
    await expect(page.getByText("P7 Bucket Truck")).toBeVisible({ timeout: 45_000 });
    expect(await financialCounts(client)).toEqual(downstreamCountsBefore);

    await page.goto("/partner/mobilization");
    await expect(page.getByRole("heading", { name: "Readiness" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Approval to Mobilize" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Production Start" })).toBeVisible();
    await expect(page.getByText("approved_to_mobilize")).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge Notice" }).first().click();
    await expect(page.getByText("Notice acknowledgment recorded as receipt only.")).toBeVisible();
  });

  test("Partner Foreman receives field-focused navigation and no company-sensitive workspaces", async ({ page }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({ width: 820, height: 1040 });
    await page.goto("/partner");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Crew" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Workload" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Company" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Compliance" })).toHaveCount(0);
    await expect(page.getByText("P7-0 Worker")).toBeVisible();
    await expect(page.getByText("Partner Rate")).toHaveCount(0);
    await expect(page.getByText("W-9")).toHaveCount(0);

    await page.goto("/partner/compliance");
    await expect(page.getByText("not available to Foreman users")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 860 });
    await page.goto("/syncfield/today");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Map" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Production", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Command Center" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Finance" })).toHaveCount(0);
    await page.goto("/partner/field/today");
    await expect(page).toHaveURL(/\/syncfield\/today$/);
    await expect(page.getByText("Initial Work Area", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge Notice" }).first().click();
    await expect(page.getByText("Notice acknowledgment recorded as receipt only.")).toBeVisible();
  });

  test("guessed IDs and cross-Partner scope do not broaden Partner Portal access", async ({ page, request }) => {
    await installSession(page, seeded.adminToken, seeded.adminPermissions);
    await page.goto(`/partner/workers/${crypto.randomUUID()}`);
    await expect(page.getByText("Worker not found in your Partner organization.")).toBeVisible();
    await page.goto(`/partner/agreements/${crypto.randomUUID()}`);
    await expect(page.getByText("Agreement not found for your Partner organization.")).toBeVisible();
    await page.goto(`/partner/work-orders/${crypto.randomUUID()}`);
    await expect(page.getByText("Work Order not found for your Partner organization.")).toBeVisible();

    const crossScope = await request.get(apiUrl(`/partner-personas/me/context?organization_id=${seeded.orgTenantB}`), {
      headers: { authorization: `Bearer ${seeded.adminToken}` },
    });
    expect(crossScope.status()).toBe(400);

    await installSession(page, seeded.tenantBToken, seeded.adminPermissions);
    await page.goto(`/partner/workers/${seeded.workerIds[0]}`);
    await expect(page.getByText("Worker not found in your Partner organization.")).toBeVisible();
  });

  test("Partner and SyncField shells reach terminal UI states without browser dialogs or client organization scope", async ({ page }) => {
    const dialogs = failOnUnexpectedDialogs(page);
    const scopedRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const body = request.postData() ?? "";
      if (url.pathname.includes("/api/syncos/") && (url.searchParams.has("organization_id") || url.searchParams.has("organizationId") || /organization_id|organizationId/.test(body))) {
        scopedRequests.push(`${request.method()} ${url.pathname}${url.search}`);
      }
    });

    await installSession(page, seeded.adminToken, seeded.adminPermissions);
    await page.goto("/partner");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 2 })).toBeVisible();
    await expect(page.getByText("Loading Partner Portal...")).toHaveCount(0);

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    for (const route of ["/syncfield/today", "/syncfield/production", "/syncfield/production/review", "/syncfield/jsa", "/syncfield/map"]) {
      await page.goto(route);
      await expect(page.getByText(/Loading (Partner Portal|SyncField)\.\.\./)).toHaveCount(0);
      await expect(page.locator("main")).toBeVisible();
    }
    expect(dialogs).toEqual([]);
    expect(scopedRequests).toEqual([]);
  });
});

async function installSession(page: Page, token: string, permissions: string[]) {
  await page.addInitScript(({ nextToken, nextPermissions }) => {
    window.localStorage.setItem("syncos.apiToken", nextToken);
    window.localStorage.setItem("syncos.permissions", nextPermissions.join(","));
  }, { nextToken: token, nextPermissions: permissions });
}

function failOnUnexpectedDialogs(page: Page) {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  return dialogs;
}

async function seedPortalFixture(client: Client, secret: string): Promise<Seeded> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgTenantB = crypto.randomUUID();
  const providerA = crypto.randomUUID();
  const providerTenantB = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const adminUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const adminTenantUser = crypto.randomUUID();
  const foremanTenantUser = crypto.randomUUID();
  const internalTenantUser = crypto.randomUUID();
  const tenantBTenantUser = crypto.randomUUID();
  const adminRole = crypto.randomUUID();
  const foremanRole = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const agreementVersionId = crypto.randomUUID();
  const workOrderId = crypto.randomUUID();
  const workOrderVersionId = crypto.randomUUID();
  const crewA = crypto.randomUUID();
  const crewAssignmentId = crypto.randomUUID();
  const equipmentId = crypto.randomUUID();
  const vehicleAssignmentId = crypto.randomUUID();
  const operatorAuthorizationId = crypto.randomUUID();
  const workerIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const adminPermissions = [
    "partner_context.read",
    "partner_actions.read",
    "partner_profile.read",
    "partner_compliance.summary.read",
    "partner_compliance.profile.read",
    "partner_compliance.profile.submit",
    "partner_compliance.w9.read",
    "partner_compliance.payment.read",
    "partner_compliance.insurance.read",
    "partner_workforce.worker.read",
    "partner_workforce.crew.read",
    "partner_workforce.readiness.read",
    "partner_agreement.read",
    "partner_agreement.artifact.read",
    "partner_work_order.read",
    "partner_work_order.rate.read",
    "partner_vehicle_assignment.read",
    "partner_vehicle_assignment.allocation.read",
    "partner_mobilization.read",
    "partner_notice.read",
    "partner_notice.acknowledge",
  ];
  const foremanPermissions = [
    "partner_context.read",
    "partner_actions.read",
    "partner_compliance.summary.read",
    "partner_workforce.foreman_roster.read",
    "partner_work_order.foreman_summary.read",
    "partner_mobilization.foreman.read",
    "partner_notice.foreman.read",
    "partner_notice.foreman.acknowledge",
  ];
  const internalPermissions = [
    "capacity_provider.read",
    "partner_mobilization.review",
    "partner_mobilization.evaluate",
    "partner_mobilization.approve",
    "partner_mobilization.hold",
    "partner_mobilization.revoke",
    "partner_mobilization.override",
    "partner_notice.issue",
  ];
  for (const permission of [...adminPermissions, ...foremanPermissions, ...internalPermissions]) await ensurePermission(client, permission);

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3),($4,$5,$6)", [tenantA, "P7 Tenant A", `p7-a-${suffix}`, tenantB, "P7 Tenant B", `p7-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P7 Partner Admin'),($3,$4,'P7 Partner Foreman'),($5,$6,'P7 Internal'),($7,$8,'P7 Tenant B')", [adminUser, `p7-admin-${suffix}@syncos.test`, foremanUser, `p7-foreman-${suffix}@syncos.test`, internalUser, `p7-internal-${suffix}@syncos.test`, tenantBUser, `p7-tenantb-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [adminTenantUser, tenantA, adminUser, foremanTenantUser, foremanUser, internalTenantUser, internalUser, tenantBTenantUser, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P7 Partner Admin','partner_admin'),($3,$2,'P7 Partner Foreman','partner_foreman'),($4,$2,'P7 Internal',$5),($6,$7,'P7 Tenant B Partner Admin','partner_admin')", [adminRole, tenantA, foremanRole, internalRole, `p7_internal_${suffix}`, tenantBRole, tenantB]);
    await grantPermissions(client, tenantA, adminRole, adminPermissions);
    await grantPermissions(client, tenantA, foremanRole, foremanPermissions);
    await grantPermissions(client, tenantA, internalRole, internalPermissions);
    await grantPermissions(client, tenantB, tenantBRole, adminPermissions);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P7 Partner A','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P7 Customer','customer',ARRAY['work_creator']::text[],'active'),($4,$5,'P7 Tenant B Partner','subcontractor',ARRAY['capacity_provider']::text[],'active')", [orgA, tenantA, customerOrg, orgTenantB, tenantB]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,'P7 Provider A','subcontractor','activated','verified','contracted'),($4,$5,$6,'P7 Tenant B Provider','subcontractor','activated','verified','contracted')", [providerA, tenantA, orgA, providerTenantB, tenantB, orgTenantB]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'organization',$4),($1,$5,$6,'organization',$4),($1,$7,$8,'tenant',$1),($9,$10,$11,'organization',$12)", [tenantA, adminTenantUser, adminRole, orgA, foremanTenantUser, foremanRole, internalTenantUser, internalRole, tenantB, tenantBTenantUser, tenantBRole, orgTenantB]);
    await seedReadyCompliance(client, tenantA, orgA, providerA);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status) VALUES ($1,$2,$3,'P7 Synthetic Project','active')", [projectId, tenantA, customerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P7-MSA','partner_master_agreement','active','active','2026-08-16')", [contractId, tenantA, orgA, providerA]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_msa_executed','partner_agreement_version',$4,'msa.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, agreementVersionId, `${tenantA}/${orgA}/msa.pdf`, internalUser]);
    const msaFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, agreementVersionId]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-16',$6,now(),$7)", [agreementVersionId, tenantA, orgA, providerA, contractId, msaFile.rows[0].id, internalUser]);
    const rateScheduleId = crypto.randomUUID();
    const rateCodeId = crypto.randomUUID();
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P7 Partner Rate','2026-08-16','active')", [rateScheduleId, tenantA, orgA]);
    await client.query("INSERT INTO rate_codes (id,tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,contractor_rate,status) VALUES ($1,$2,$3,'accepted_foot','Partner rate','feet','production_unit',0.70,0.70,'active')", [rateCodeId, tenantA, rateScheduleId]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P7 Ready Crew','aerial','active','active',4)", [crewA, tenantA, providerA, orgA]);
    for (const [index, workerId] of workerIds.entries()) {
      await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,$6,'Worker','active','approved')", [workerId, tenantA, providerA, crewA, orgA, `P7-${index}`]);
      await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,$6,'active')", [tenantA, orgA, providerA, crewA, workerId, index === 0 ? "foreman" : index === 1 ? "alternate_foreman" : "member"]);
      const headshotFile = crypto.randomUUID();
      await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'worker_headshot','worker',$5,'headshot.png','image/png',8,'checksum',$6,$7)", [headshotFile, tenantA, orgA, providerA, workerId, `${tenantA}/${workerId}/headshot.png`, internalUser]);
      await client.query("INSERT INTO partner_worker_headshots (tenant_id,organization_id,capacity_provider_id,worker_id,file_object_id,status) VALUES ($1,$2,$3,$4,$5,'approved')", [tenantA, orgA, providerA, workerId, headshotFile]);
      await client.query("INSERT INTO partner_worker_credentials (tenant_id,organization_id,capacity_provider_id,worker_id,credential_type,required,status,expiration_date) VALUES ($1,$2,$3,$4,'driver_license',true,'verified','2027-08-16')", [tenantA, orgA, providerA, workerId]);
    }
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, orgA, workerIds[0], foremanTenantUser]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,scope_summary,map_link,assignment_type,assigned_organization_id,partner_organization_id,partner_rate_schedule_id,governing_agreement_version_id,partner_execution_status,partner_effective_date,unit,planned_quantity) VALUES ($1,$2,$3,$4,$5,'P7 WO','fiber',3000,'feet','assigned','P7 WO','WO-P7-A','fiber hanging and overlash only','MAP-P7-A','partner_contractor',$6,$6,$7,$8,'active','2026-08-22','feet',3000)", [workOrderId, tenantA, projectId, providerA, crewA, orgA, rateScheduleId, agreementVersionId]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_work_order_executed','partner_work_order_version',$4,'wo.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, workOrderVersionId, `${tenantA}/${orgA}/wo.pdf`, internalUser]);
    const woFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, workOrderVersionId]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,version_number,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,rate_code_id,work_order_number,scope_summary,primary_work_area,map_work_package_ref,production_unit,performance_target,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,'WO-P7-A','fiber hanging and overlash only','P7 Initial Work Area','MAP-P7-A','feet',3000,'active','2026-08-22',$11,now(),$12)", [workOrderVersionId, tenantA, orgA, providerA, projectId, workOrderId, agreementVersionId, crewA, rateScheduleId, rateCodeId, woFile.rows[0].id, internalUser]);
    await client.query("INSERT INTO partner_work_order_crew_assignments (id,tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,status,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [crewAssignmentId, tenantA, orgA, providerA, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO equipment (id,tenant_id,name,equipment_type,status) VALUES ($1,$2,'P7 Bucket Truck','bucket_truck','active')", [equipmentId, tenantA]);
    await client.query("INSERT INTO partner_vehicle_assignments (id,tenant_id,organization_id,capacity_provider_id,equipment_id,work_order_id,work_order_version_id,crew_id,rental_provider,partner_custody_start_date,daily_allocation_amount,status,aerial_inspection_expires_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic Rental','2026-08-23',100,'active_custody','2027-08-16',$9)", [vehicleAssignmentId, tenantA, orgA, providerA, equipmentId, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO partner_vehicle_condition_records (tenant_id,organization_id,vehicle_assignment_id,record_type,odometer,fuel_level,recorded_by_user_id) VALUES ($1,$2,$3,'pre_assignment',1200,'full',$4)", [tenantA, orgA, vehicleAssignmentId, internalUser]);
    await client.query("INSERT INTO partner_vehicle_operator_authorizations (id,tenant_id,organization_id,vehicle_assignment_id,worker_id,crew_id,authorization_role,qualification_status,approved_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,'driver_operator','approved',$7)", [operatorAuthorizationId, tenantA, orgA, vehicleAssignmentId, workerIds[0], crewA, internalUser]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return {
    tenantA,
    orgA,
    orgTenantB,
    crewA,
    workerIds,
    workOrderVersionId,
    agreementVersionId,
    vehicleAssignmentId,
    adminToken: createToken({ sub: adminUser, tenant_id: tenantA }, secret),
    foremanToken: createToken({ sub: foremanUser, tenant_id: tenantA }, secret),
    internalToken: createToken({ sub: internalUser, tenant_id: tenantA }, secret),
    tenantBToken: createToken({ sub: tenantBUser, tenant_id: tenantB }, secret),
    adminPermissions,
    foremanPermissions,
  };
}

async function authorizePortalFixture(request: APIRequestContext, fixture: Seeded) {
  const evaluation = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/evaluate`);
  expect(evaluation.overall_status).toBe("ready");
  const decision = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/approve`, {});
  expect(decision.decision).toBe("approved_to_mobilize");
  const notice = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/notices`, {
    planned_mobilization_date: "2026-08-24",
    production_start_date: "2026-08-25",
    production_start_time: "07:30:00",
    timezone: "America/New_York",
    initial_work_area: "P7 Initial Work Area",
    external_instructions: "View start instructions before first bucket setup.",
  });
  expect(notice.production_start.authorization_status).toBe("authorized");
}

async function seedReadyCompliance(client: Client, tenantId: string, orgId: string, providerId: string) {
  await client.query("INSERT INTO partner_company_profiles (tenant_id,organization_id,capacity_provider_id,legal_business_name,dba_name,state_of_formation,entity_type,primary_contact_name,primary_contact_email,compliance_contact_name,compliance_contact_email,settlement_contact_name,settlement_contact_email,business_address,status) VALUES ($1,$2,$3,'P7 Partner A LLC','P7 A','OH','llc','Admin Contact','admin@p7.test','Compliance Contact','compliance@p7.test','Settlement Contact','settlement@p7.test','{}','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_tax_profiles (tenant_id,organization_id,capacity_provider_id,legal_name_on_w9,federal_tax_classification,tin_type,tin_last_four,status) VALUES ($1,$2,$3,'P7 Partner A LLC','corporation','ein','1234','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_payment_profiles (tenant_id,organization_id,capacity_provider_id,priority_passport_status,status,account_last_four,bank_display_name) VALUES ($1,$2,$3,'active','active','6789','Synthetic Bank')", [tenantId, orgId, providerId]);
  for (const type of ["commercial_general_liability", "commercial_auto", "umbrella_excess", "workers_compensation", "employers_liability"]) {
    await client.query("INSERT INTO partner_insurance_policies (tenant_id,organization_id,capacity_provider_id,policy_type,carrier,effective_date,expiration_date,status,occurrence_limit_cents,general_aggregate_cents,products_completed_operations_aggregate_cents,combined_single_auto_limit_cents,workers_compensation_statutory,employer_liability_accident_limit_cents,employer_liability_disease_each_employee_limit_cents,employer_liability_disease_policy_limit_cents,additional_insured_status,waiver_of_subrogation_status,primary_non_contributory_status) VALUES ($1,$2,$3,$4,'Synthetic Carrier','2026-01-01','2027-08-16','verified',100000000,200000000,200000000,100000000,true,50000000,50000000,50000000,'verified','verified','verified')", [tenantId, orgId, providerId, type]);
  }
}

async function financialCounts(client: Client) {
  const result = await client.query("SELECT (SELECT count(*)::int FROM production_records) AS production, (SELECT count(*)::int FROM qc_reviews) AS qc, (SELECT count(*)::int FROM billable_items) AS billable, (SELECT count(*)::int FROM settlements) AS settlements, (SELECT count(*)::int FROM contractor_payables) AS payables, (SELECT count(*)::int FROM payments) AS payments");
  return result.rows[0];
}

async function ensurePermission(client: Client, key: string) {
  await client.query("INSERT INTO permissions (key, name, description) VALUES ($1, $1, 'P7 partner portal test permission') ON CONFLICT (key) DO NOTHING", [key]);
}

async function grantPermissions(client: Client, tenantId: string, roleId: string, keys: string[]) {
  for (const key of keys) {
    await client.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
  }
}

async function apiJson(request: APIRequestContext, token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = method === "GET"
    ? await request.get(apiUrl(path), { headers: { authorization: `Bearer ${token}` } })
    : await request.post(apiUrl(path), { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, data: body });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(400);
  return response.json();
}

function apiUrl(route: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${route.replace(/^\//, "")}`;
}

function createToken(claims: { sub: string; tenant_id: string }, secret: string): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
