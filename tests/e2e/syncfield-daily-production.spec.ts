import crypto from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";

type Seeded = {
  tenantA: string;
  tenantB: string;
  orgA: string;
  orgTenantB: string;
  crewA: string;
  foremanWorkerId: string;
  workOrderVersionId: string;
  internalToken: string;
  adminToken: string;
  foremanToken: string;
  tenantBToken: string;
  adminPermissions: string[];
  foremanPermissions: string[];
  internalPermissions: string[];
  mapDocumentId?: string;
  mapVersionId?: string;
  assignmentId?: string;
};

test.describe.serial("P9 SyncField Daily Production, map annotation, offline queue, and submission", () => {
  let client: Client;
  let seeded: Seeded;
  let downstreamCountsBefore: Awaited<ReturnType<typeof downstreamCounts>>;
  let codes: Record<string, string>;
  let reportId: string;
  let submittedRecordId: string;

  test.beforeAll(async ({ request }) => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedSyncfieldFixture(client, secret);
    await authorizeMobilization(request, seeded);
    await createAssignedMap(request, seeded);
    await completeJsa(request, seeded);
    downstreamCountsBefore = await downstreamCounts(client);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("production gate, Work Order codes, and field UI hydrate without rates", async ({ page, request }) => {
    const missingJsa = await request.post(apiUrl("/syncfield/foreman/production/today?work_date=2026-08-26"), { headers: auth(seeded.foremanToken), data: { client_mutation_id: crypto.randomUUID() } });
    expect(missingJsa.status()).toBe(400);

    const codeList = await apiJson(request, seeded.foremanToken, "GET", "/syncfield/foreman/production/codes");
    codes = Object.fromEntries(codeList.map((code: Record<string, unknown>) => [String(code.code), String(code.id)]));
    expect(codes.FIBER).toBeTruthy();
    expect(codeList[0]).not.toHaveProperty("amount");
    expect(codeList[0]).not.toHaveProperty("contractor_rate");

    const opened = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/production/today", { work_date: today(), client_mutation_id: crypto.randomUUID(), weather: "Clear" });
    reportId = opened.id;
    expect(opened.status).toBe("draft");
    expect(opened.gate).toBeUndefined();

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({ width: 820, height: 1040 });
    await page.goto("/partner/production");
    await expect(page.locator("h2").filter({ hasText: "Daily Production" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Asset" })).toBeVisible();
    await expect(page.locator("a.partner-button", { hasText: "Review Day" })).toBeVisible();
    await expect(page.getByText("Partner Rate")).toHaveCount(0);
    await expect(page.getByText("contractor_rate")).toHaveCount(0);

    const cross = await request.get(apiUrl("/syncfield/foreman/production/today"), { headers: auth(seeded.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });

  test("browser offline queue persists and automatically replays Asset, Route, and Daily production exactly once", async ({ page, context, request }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({ width: 820, height: 1040 });
    await page.goto("/partner/production");
    await expect(page.locator("h2").filter({ hasText: "Daily Production" })).toBeVisible();

    const before = await productionCountsForReport(client, seeded.tenantA, reportId);
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ Asset" }).click();
    await page.getByRole("button", { name: "+ Route" }).click();
    await page.getByRole("button", { name: "+ Daily" }).click();
    await expect(page.getByText("offline - 3 changes saved locally")).toBeVisible();

    const queued = await queuedFieldMutations(page);
    expect(queued).toHaveLength(3);
    expect(queued.every((mutation) => mutation.scopeKey.includes(seeded.orgA))).toBe(true);
    expect(JSON.stringify(queued)).not.toMatch(/contractor_rate|storage_key|margin|driver_license/i);

    const duplicatePayload = queued[0].payload;
    await createProduction(request, seeded, duplicatePayload);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("h2").filter({ hasText: "Daily Production" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("synced", { exact: true }).first()).toBeVisible({ timeout: 15000 });

    const after = await productionCountsForReport(client, seeded.tenantA, reportId);
    expect(after.records).toBe(before.records + 3);
    expect(after.annotations).toBe(before.annotations + 2);
    await expect.poll(async () => (await queuedFieldMutations(page)).filter((mutation) => mutation.status !== "SYNCED").length).toBe(0);

    await page.goto("/partner/production/review");
    await expect(page.getByText("Unsynced Mutations")).toBeVisible();
    await expect(page.getByText("0").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Daily Production" })).toBeEnabled();
  });

  test("offline replay revalidates lost production-start authorization and keeps failed work traceable", async ({ page, context }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/partner/production");
    await expect(page.locator("h2").filter({ hasText: "Daily Production" })).toBeVisible();
    const before = await productionCountsForReport(client, seeded.tenantA, reportId);
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ Asset" }).click();
    await expect(page.getByText("offline - 1 change saved locally")).toBeVisible();

    await client.query("UPDATE production_start_authorizations SET authorization_status = 'held' WHERE tenant_id = $1 AND current = true", [seeded.tenantA]);
    try {
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByText("sync failed")).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("Production start is no longer authorized. Local changes were not applied.")).toBeVisible();
      const after = await productionCountsForReport(client, seeded.tenantA, reportId);
      expect(after).toEqual(before);
      const pending = await queuedFieldMutations(page);
      expect(pending.filter((mutation) => mutation.status === "FAILED")).toHaveLength(1);
    } finally {
      await client.query("UPDATE production_start_authorizations SET authorization_status = 'authorized' WHERE tenant_id = $1 AND current = true", [seeded.tenantA]);
    }
  });

  test("Asset, Route, and Daily production create authoritative records with subordinate annotations and idempotency", async ({ request }) => {
    const assetMutation = crypto.randomUUID();
    const asset = await createProduction(request, seeded, { client_mutation_id: assetMutation, production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.4, y_ratio: 0.5, reported_quantity: 1, status: "complete" });
    submittedRecordId = asset.id;
    const assetRetry = await createProduction(request, seeded, { client_mutation_id: assetMutation, production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.4, y_ratio: 0.5, reported_quantity: 1, status: "complete" });
    expect(assetRetry.id).toBe(asset.id);

    const decreasing = await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12301", to_asset_identifier: "Pole 12312", map_page: 1, start_x_ratio: 0.4, start_y_ratio: 0.5, end_x_ratio: 0.6, end_y_ratio: 0.55, tick_start_label: "Pole 12301 start", tick_end_label: "Pole 12312 end", reel_cable_id: "REEL-A", fiber_type: "144ct", sequence_start: 14826, sequence_end: 14685, reported_quantity: 141, status: "partial" });
    expect(decreasing.sequence_direction).toBe("decreasing");
    expect(decreasing.sequence_calculated_footage).toBe(141);
    expect(decreasing.sequence_reported_variance).toBe(0);
    expect(decreasing.sequence_variance_status).toBe("within_tolerance");
    const increasing = await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12312", to_asset_identifier: "Pole 12323", map_page: 1, start_x_ratio: 0.6, start_y_ratio: 0.55, end_x_ratio: 0.7, end_y_ratio: 0.6, tick_start_label: "Pole 12312 start", tick_end_label: "Pole 12323 end", reel_cable_id: "REEL-B", fiber_type: "144ct", sequence_start: 14685, sequence_end: 14826, reported_quantity: 141, status: "complete" });
    expect(increasing.sequence_direction).toBe("increasing");
    expect(increasing.sequence_calculated_footage).toBe(141);
    const missingVarianceExplanation = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { work_date: today(), client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12323", to_asset_identifier: "Pole 12334", map_page: 1, start_x_ratio: 0.7, start_y_ratio: 0.6, end_x_ratio: 0.8, end_y_ratio: 0.65, sequence_start: 14826, sequence_end: 12131, reported_quantity: 3000, status: "partial" },
    });
    expect(missingVarianceExplanation.status()).toBe(400);
    const varianceReview = await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.FIBER, location_type: "route", from_asset_identifier: "Pole 12323", to_asset_identifier: "Pole 12334", map_page: 1, start_x_ratio: 0.7, start_y_ratio: 0.6, end_x_ratio: 0.8, end_y_ratio: 0.65, tick_start_label: "Pole 12323 start", tick_end_label: "Pole 12334 end", reel_cable_id: "REEL-C", fiber_type: "288ct", sequence_start: 14826, sequence_end: 12131, reported_quantity: 3000, sequence_variance_explanation: "Customer requested additional slack loop footage.", status: "partial" });
    expect(varianceReview.sequence_calculated_footage).toBe(2695);
    expect(varianceReview.sequence_reported_variance).toBe(305);
    expect(varianceReview.sequence_variance_status).toBe("review_required");
    await createProduction(request, seeded, { client_mutation_id: crypto.randomUUID(), production_code_id: codes.LABOR, location_type: "daily", reported_quantity: 8, status: "complete", notes: "Crew labor hours" });

    const detail = await apiJson(request, seeded.foremanToken, "GET", "/syncfield/foreman/production/today");
    expect(detail.records).toHaveLength(8);
    expect(detail.annotations).toHaveLength(6);
    expect(detail.annotations.filter((row: Record<string, unknown>) => row.annotation_type === "tick_span")).toHaveLength(4);
    expect(detail.totals.record_count).toBe(8);
    expect(detail.totals.status_counts.complete).toBe(6);
    expect(detail.totals.status_counts.partial).toBe(2);
    expect(detail.totals.by_code.find((row: Record<string, unknown>) => row.code === "FIBER").quantity).toBe(3423);

    const badCoordinate = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Bad", map_page: 1, x_ratio: 1.4, y_ratio: 0.5, reported_quantity: 1, status: "complete" },
    });
    expect(badCoordinate.status()).toBe(400);
  });

  test("submission creates immutable revision snapshot and blocks ordinary edits without QC or finance", async ({ page, request }) => {
    const beforeReadiness = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/readiness");
    const submitted = await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/production/review-day/submit", { work_date: today(), client_mutation_id: crypto.randomUUID(), general_notes: "Submitted by Foreman." });
    expect(submitted.status).toBe("submitted");
    expect(submitted.records.every((record: Record<string, unknown>) => record.locked === true)).toBe(true);
    const revision = await client.query("SELECT snapshot_json FROM daily_production_report_revisions WHERE tenant_id = $1 AND daily_report_id = $2", [seeded.tenantA, submitted.id]);
    expect(revision.rowCount).toBe(1);
    expect(revision.rows[0].snapshot_json.records).toHaveLength(8);
    expect(revision.rows[0].snapshot_json.records.some((record: Record<string, unknown>) => record.sequence_variance_status === "review_required")).toBe(true);

    const edit = await request.post(apiUrl(`/syncfield/foreman/production/records/${submittedRecordId}`), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), reported_quantity: 2 },
    });
    expect(edit.status()).toBe(400);
    const addAfterSubmit = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 999", map_page: 1, x_ratio: 0.1, y_ratio: 0.1, reported_quantity: 1, status: "complete" },
    });
    expect(addAfterSubmit.status()).toBe(400);
    const afterReadiness = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/readiness");
    expect(afterReadiness.overall_status).toBe(beforeReadiness.overall_status);
    expect(await downstreamCounts(client)).toEqual({ ...downstreamCountsBefore, production: downstreamCountsBefore.production + 8 });

    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.setViewportSize({ width: 390, height: 860 });
    await page.goto("/partner/production/review");
    await expect(page.locator("h2").filter({ hasText: "Review Day" })).toBeVisible();
    await expect(page.getByText("submitted", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Daily Production" })).toBeDisabled();
    await expect(page.getByText("Customer QC")).toHaveCount(0);
    await expect(page.getByText("accepted quantity")).toHaveCount(0);
  });

  test("submitted-report offline conflict does not reopen the report or create production", async ({ page, context }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/partner/production");
    await expect(page.locator("h2").filter({ hasText: "Daily Production" })).toBeVisible();
    const before = await productionCountsForReport(client, seeded.tenantA, reportId);
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ Daily" }).click();
    await expect(page.getByText("offline - 1 change saved locally")).toBeVisible();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("sync failed")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("REPORT ALREADY SUBMITTED - LOCAL CHANGES NOT APPLIED")).toBeVisible();
    expect(await productionCountsForReport(client, seeded.tenantA, reportId)).toEqual(before);
  });

  test("Partner-local queue isolation hides pending field work after account switch", async ({ page, context }) => {
    await installSession(page, seeded.foremanToken, seeded.foremanPermissions);
    await page.goto("/partner/production");
    await expect(page.locator("h2").filter({ hasText: "Daily Production" })).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ Asset" }).click();
    await expect(page.getByText("offline - 1 change saved locally")).toBeVisible();
    await installSession(page, seeded.tenantBToken, seeded.adminPermissions);
    await context.setOffline(false);
    await page.goto("/partner/production");
    await expect(page.getByText("offline - 1 change saved locally")).toHaveCount(0);
  });

  test("Partner Admin receives safe read-only report and duplicate submitted work requires traceability", async ({ request, page }) => {
    await installSession(page, seeded.adminToken, seeded.adminPermissions);
    await page.goto("/partner/production");
    await expect(page.locator("h2").filter({ hasText: "Daily Production" })).toBeVisible();
    await expect(page.getByText("submitted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("contractor_rate")).toHaveCount(0);
    await expect(page.getByText("storage_key")).toHaveCount(0);

    await completeJsa(request, seeded, "2026-08-26");
    await apiJson(request, seeded.foremanToken, "POST", "/syncfield/foreman/production/today", { work_date: "2026-08-26", client_mutation_id: crypto.randomUUID() });
    const duplicate = await request.post(apiUrl("/syncfield/foreman/production/records"), {
      headers: auth(seeded.foremanToken),
      data: { work_date: "2026-08-26", client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.3, y_ratio: 0.3, reported_quantity: 1, status: "rework" },
    });
    expect(duplicate.status()).toBe(400);
    const traced = await createProduction(request, seeded, { work_date: "2026-08-26", client_mutation_id: crypto.randomUUID(), production_code_id: codes.TRANSFER, location_type: "asset", asset_type: "pole", asset_identifier: "Pole 12301", map_page: 1, x_ratio: 0.3, y_ratio: 0.3, reported_quantity: 1, status: "rework", duplicate_reason: "Customer requested additional pass." });
    expect(traced.duplicate_reason).toBe("Customer requested additional pass.");
  });
});

async function seedSyncfieldFixture(client: Client, secret: string): Promise<Seeded> {
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
  const adminPermissions = ["partner_context.read", "partner_actions.read", "partner_profile.read", "partner_compliance.summary.read", "partner_compliance.profile.read", "partner_compliance.w9.read", "partner_compliance.payment.read", "partner_compliance.insurance.read", "partner_workforce.worker.read", "partner_workforce.crew.read", "partner_workforce.readiness.read", "partner_agreement.read", "partner_agreement.artifact.read", "partner_work_order.read", "partner_work_order.rate.read", "partner_vehicle_assignment.read", "partner_vehicle_assignment.allocation.read", "partner_mobilization.read", "partner_notice.read", "partner_notice.acknowledge", "partner_map.read", "partner_jsa.read", "partner_jsa_history.read", "partner_daily_production.read_org", "partner_production.read_org"];
  const foremanPermissions = ["partner_context.read", "partner_actions.read", "partner_compliance.summary.read", "partner_workforce.foreman_roster.read", "partner_work_order.foreman_summary.read", "partner_mobilization.foreman.read", "partner_notice.foreman.read", "partner_notice.foreman.acknowledge", "partner_map.read_assigned", "partner_jsa.create", "partner_jsa.update_draft", "partner_jsa.complete", "partner_jsa.read_own", "partner_daily_production.read", "partner_daily_production.create", "partner_daily_production.update_draft", "partner_daily_production.delete_draft", "partner_daily_production.submit", "partner_production_record.create", "partner_production_record.update_draft", "partner_production_record.delete_draft", "partner_production_photo.create", "partner_field_sync.submit"];
  const internalPermissions = ["capacity_provider.read", "partner_mobilization.review", "partner_mobilization.evaluate", "partner_mobilization.approve", "partner_notice.issue", "syncfield_map.create", "syncfield_map.version.upload", "syncfield_map.read", "syncfield_map.assignment.manage", "syncfield_map.work_zone.manage", "syncfield_jsa.read_all", "daily_production.read_all", "daily_production.completeness_read"];
  for (const permission of [...adminPermissions, ...foremanPermissions, ...internalPermissions]) await ensurePermission(client, permission);
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3),($4,$5,$6)", [tenantA, "P8 Tenant A", `p8-a-${suffix}`, tenantB, "P8 Tenant B", `p8-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P8 Partner Admin'),($3,$4,'P8 Partner Foreman'),($5,$6,'P8 Internal'),($7,$8,'P8 Tenant B')", [adminUser, `p8-admin-${suffix}@syncos.test`, foremanUser, `p8-foreman-${suffix}@syncos.test`, internalUser, `p8-internal-${suffix}@syncos.test`, tenantBUser, `p8-tenantb-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [adminTenantUser, tenantA, adminUser, foremanTenantUser, foremanUser, internalTenantUser, internalUser, tenantBTenantUser, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P8 Partner Admin','partner_admin'),($3,$2,'P8 Partner Foreman','partner_foreman'),($4,$2,'P8 Internal',$5),($6,$7,'P8 Tenant B Partner Admin','partner_admin')", [adminRole, tenantA, foremanRole, internalRole, `p8_internal_${suffix}`, tenantBRole, tenantB]);
    await grantPermissions(client, tenantA, adminRole, adminPermissions);
    await grantPermissions(client, tenantA, foremanRole, foremanPermissions);
    await grantPermissions(client, tenantA, internalRole, internalPermissions);
    await grantPermissions(client, tenantB, tenantBRole, adminPermissions);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P8 Partner A','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P8 Customer','customer',ARRAY['work_creator']::text[],'active'),($4,$5,'P8 Tenant B Partner','subcontractor',ARRAY['capacity_provider']::text[],'active')", [orgA, tenantA, customerOrg, orgTenantB, tenantB]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,'P8 Provider A','subcontractor','activated','verified','contracted'),($4,$5,$6,'P8 Tenant B Provider','subcontractor','activated','verified','contracted')", [providerA, tenantA, orgA, providerTenantB, tenantB, orgTenantB]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'organization',$4),($1,$5,$6,'organization',$4),($1,$7,$8,'tenant',$1),($9,$10,$11,'organization',$12)", [tenantA, adminTenantUser, adminRole, orgA, foremanTenantUser, foremanRole, internalTenantUser, internalRole, tenantB, tenantBTenantUser, tenantBRole, orgTenantB]);
    await seedReadyCompliance(client, tenantA, orgA, providerA);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status) VALUES ($1,$2,$3,'P8 Synthetic Project','active')", [projectId, tenantA, customerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P8-MSA','partner_master_agreement','active','active','2026-08-16')", [contractId, tenantA, orgA, providerA]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_msa_executed','partner_agreement_version',$4,'msa.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, agreementVersionId, `${tenantA}/${orgA}/msa.pdf`, internalUser]);
    const msaFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, agreementVersionId]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-16',$6,now(),$7)", [agreementVersionId, tenantA, orgA, providerA, contractId, msaFile.rows[0].id, internalUser]);
    const rateScheduleId = crypto.randomUUID();
    const rateCodeId = crypto.randomUUID();
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P8 Partner Rate','2026-08-16','active')", [rateScheduleId, tenantA, orgA]);
    await client.query("INSERT INTO rate_codes (id,tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,contractor_rate,status) VALUES ($1,$2,$3,'accepted_foot','Partner rate','feet','production_unit',0.70,0.70,'active')", [rateCodeId, tenantA, rateScheduleId]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P8 Ready Crew','aerial','active','active',4)", [crewA, tenantA, providerA, orgA]);
    for (const [index, workerId] of workerIds.entries()) {
      await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,$6,'Worker','active','approved')", [workerId, tenantA, providerA, crewA, orgA, `P8-${index}`]);
      await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,$6,'active')", [tenantA, orgA, providerA, crewA, workerId, index === 0 ? "foreman" : index === 1 ? "alternate_foreman" : "member"]);
      const headshotFile = crypto.randomUUID();
      await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'worker_headshot','worker',$5,'headshot.png','image/png',8,'checksum',$6,$7)", [headshotFile, tenantA, orgA, providerA, workerId, `${tenantA}/${workerId}/headshot.png`, internalUser]);
      await client.query("INSERT INTO partner_worker_headshots (tenant_id,organization_id,capacity_provider_id,worker_id,file_object_id,status) VALUES ($1,$2,$3,$4,$5,'approved')", [tenantA, orgA, providerA, workerId, headshotFile]);
      await client.query("INSERT INTO partner_worker_credentials (tenant_id,organization_id,capacity_provider_id,worker_id,credential_type,required,status,expiration_date) VALUES ($1,$2,$3,$4,'driver_license',true,'verified','2027-08-16')", [tenantA, orgA, providerA, workerId]);
    }
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, orgA, workerIds[0], foremanTenantUser]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,scope_summary,map_link,assignment_type,assigned_organization_id,partner_organization_id,partner_rate_schedule_id,governing_agreement_version_id,partner_execution_status,partner_effective_date,unit,planned_quantity) VALUES ($1,$2,$3,$4,$5,'P8 WO','fiber',3000,'feet','assigned','P8 WO','WO-P8-A','fiber hanging and overlash only','MAP-P8-A','partner_contractor',$6,$6,$7,$8,'active','2026-08-22','feet',3000)", [workOrderId, tenantA, projectId, providerA, crewA, orgA, rateScheduleId, agreementVersionId]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_work_order_executed','partner_work_order_version',$4,'wo.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, workOrderVersionId, `${tenantA}/${orgA}/wo.pdf`, internalUser]);
    const woFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, workOrderVersionId]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,version_number,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,rate_code_id,work_order_number,scope_summary,primary_work_area,map_work_package_ref,production_unit,performance_target,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,'WO-P8-A','fiber hanging and overlash only','P8 Initial Work Area','MAP-P8-A','feet',3000,'active','2026-08-22',$11,now(),$12)", [workOrderVersionId, tenantA, orgA, providerA, projectId, workOrderId, agreementVersionId, crewA, rateScheduleId, rateCodeId, woFile.rows[0].id, internalUser]);
    await client.query("INSERT INTO partner_work_order_crew_assignments (id,tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,status,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [crewAssignmentId, tenantA, orgA, providerA, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO equipment (id,tenant_id,name,equipment_type,status) VALUES ($1,$2,'P8 Bucket Truck','bucket_truck','active')", [equipmentId, tenantA]);
    await client.query("INSERT INTO partner_vehicle_assignments (id,tenant_id,organization_id,capacity_provider_id,equipment_id,work_order_id,work_order_version_id,crew_id,rental_provider,partner_custody_start_date,daily_allocation_amount,status,aerial_inspection_expires_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic Rental','2026-08-23',100,'active_custody','2027-08-16',$9)", [vehicleAssignmentId, tenantA, orgA, providerA, equipmentId, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO partner_vehicle_condition_records (tenant_id,organization_id,vehicle_assignment_id,record_type,odometer,fuel_level,recorded_by_user_id) VALUES ($1,$2,$3,'pre_assignment',1200,'full',$4)", [tenantA, orgA, vehicleAssignmentId, internalUser]);
    await client.query("INSERT INTO partner_vehicle_operator_authorizations (id,tenant_id,organization_id,vehicle_assignment_id,worker_id,crew_id,authorization_role,qualification_status,approved_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,'driver_operator','approved',$7)", [operatorAuthorizationId, tenantA, orgA, vehicleAssignmentId, workerIds[0], crewA, internalUser]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { tenantA, tenantB, orgA, orgTenantB, crewA, foremanWorkerId: workerIds[0], workOrderVersionId, internalToken: token(internalUser, tenantA, secret), adminToken: token(adminUser, tenantA, secret), foremanToken: token(foremanUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret), adminPermissions, foremanPermissions, internalPermissions };
}

async function authorizeMobilization(request: APIRequestContext, fixture: Seeded) {
  const evaluation = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/evaluate`);
  expect(evaluation.overall_status).toBe("ready");
  const decision = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/approve`, {});
  expect(decision.decision).toBe("approved_to_mobilize");
  const notice = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/notices`, { production_start_date: "2026-08-25", production_start_time: "07:30:00", timezone: "America/New_York", initial_work_area: "P8 Initial Work Area", external_instructions: "Open field map and complete Daily JSA before work." });
  expect(notice.production_start.authorization_status).toBe("authorized");
}

async function createAssignedMap(request: APIRequestContext, fixture: Seeded) {
  const document = await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/map-documents`, {
    name: "ARL019 Construction Map",
    customer_document_number: "ARL019",
    document_type: "construction_map",
  });
  fixture.mapDocumentId = document.id;
  const version = await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/map-documents/${document.id}/versions`, {
    file_name: "ARL019 Rev 0.pdf",
    mime_type: "application/pdf",
    content_base64: pdfBase64(),
    revision_number: 1,
    revision_label: "Rev 0",
  });
  fixture.mapVersionId = version.id;
  await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/map-versions/${version.id}/work-zones`, {
    name: "South Ave",
    page_number: 1,
    x_ratio: 0.44,
    y_ratio: 0.58,
    zoom_level: 1.5,
  });
  const assignment = await apiJson(request, fixture.internalToken, "POST", `/syncfield/organizations/${fixture.orgA}/map-versions/${version.id}/assign`, {
    crew_id: fixture.crewA,
    foreman_worker_id: fixture.foremanWorkerId,
  });
  fixture.assignmentId = assignment.id;
}

async function completeJsa(request: APIRequestContext, fixture: Seeded, workDate = today()) {
  const result = await apiJson(request, fixture.foremanToken, "POST", `/syncfield/foreman/jsa/today/complete?work_date=${workDate}`, {
    work_date: workDate,
    work_location: "P9 Initial Work Area",
    hazards: ["traffic"],
    controls: ["ppe_reviewed", "emergency_procedures_reviewed", "stop_work_authority_reviewed"],
    foreman_certified: true,
  });
  expect(result.status).toBe("completed");
}

async function createProduction(request: APIRequestContext, fixture: Seeded, body: Record<string, unknown>) {
  return apiJson(request, fixture.foremanToken, "POST", "/syncfield/foreman/production/records", { work_date: today(), ...body });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function seedReadyCompliance(client: Client, tenantId: string, orgId: string, providerId: string) {
  await client.query("INSERT INTO partner_company_profiles (tenant_id,organization_id,capacity_provider_id,legal_business_name,dba_name,state_of_formation,entity_type,primary_contact_name,primary_contact_email,compliance_contact_name,compliance_contact_email,settlement_contact_name,settlement_contact_email,business_address,status) VALUES ($1,$2,$3,'P8 Partner A LLC','P8 A','OH','llc','Admin Contact','admin@p8.test','Compliance Contact','compliance@p8.test','Settlement Contact','settlement@p8.test','{}','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_tax_profiles (tenant_id,organization_id,capacity_provider_id,legal_name_on_w9,federal_tax_classification,tin_type,tin_last_four,status) VALUES ($1,$2,$3,'P8 Partner A LLC','corporation','ein','1234','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_payment_profiles (tenant_id,organization_id,capacity_provider_id,priority_passport_status,status,account_last_four,bank_display_name) VALUES ($1,$2,$3,'active','active','6789','Synthetic Bank')", [tenantId, orgId, providerId]);
  for (const type of ["commercial_general_liability", "commercial_auto", "umbrella_excess", "workers_compensation", "employers_liability"]) {
    await client.query("INSERT INTO partner_insurance_policies (tenant_id,organization_id,capacity_provider_id,policy_type,carrier,effective_date,expiration_date,status,occurrence_limit_cents,general_aggregate_cents,products_completed_operations_aggregate_cents,combined_single_auto_limit_cents,workers_compensation_statutory,employer_liability_accident_limit_cents,employer_liability_disease_each_employee_limit_cents,employer_liability_disease_policy_limit_cents,additional_insured_status,waiver_of_subrogation_status,primary_non_contributory_status) VALUES ($1,$2,$3,$4,'Synthetic Carrier','2026-01-01','2027-08-16','verified',100000000,200000000,200000000,100000000,true,50000000,50000000,50000000,'verified','verified','verified')", [tenantId, orgId, providerId, type]);
  }
}

async function ensurePermission(client: Client, key: string) {
  await client.query("INSERT INTO permissions (key, name, description) VALUES ($1, $1, 'P8 SyncField test permission') ON CONFLICT (key) DO NOTHING", [key]);
}

async function grantPermissions(client: Client, tenantId: string, roleId: string, keys: string[]) {
  for (const key of keys) await client.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
}

async function downstreamCounts(client: Client) {
  const result = await client.query("SELECT (SELECT count(*)::int FROM production_records) AS production, (SELECT count(*)::int FROM qc_reviews) AS qc, (SELECT count(*)::int FROM billable_items) AS billable, (SELECT count(*)::int FROM settlements) AS settlements, (SELECT count(*)::int FROM contractor_payables) AS payables, (SELECT count(*)::int FROM payments) AS payments");
  return result.rows[0];
}

async function productionCountsForReport(client: Client, tenantId: string, dailyReportId: string) {
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM production_records WHERE tenant_id = $1 AND daily_production_report_id = $2 AND deleted_at IS NULL) AS records,
      (SELECT count(*)::int FROM map_annotations ma JOIN production_records pr ON pr.tenant_id = ma.tenant_id AND pr.id = ma.production_record_id WHERE ma.tenant_id = $1 AND pr.daily_production_report_id = $2 AND ma.deleted_at IS NULL) AS annotations
    `,
    [tenantId, dailyReportId],
  );
  return result.rows[0] as { records: number; annotations: number };
}

async function queuedFieldMutations(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(async () => {
    const open = indexedDB.open("syncos-field-production", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("mutations")) {
          const store = db.createObjectStore("mutations", { keyPath: "mutationId" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rows = await new Promise<Array<Record<string, any>>>((resolve, reject) => {
      const tx = db.transaction("mutations", "readonly");
      const request = tx.objectStore("mutations").getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, any>>);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  });
}

async function installSession(page: Page, nextToken: string, nextPermissions: string[]) {
  await page.addInitScript(({ tokenValue, permissionValue }) => {
    window.localStorage.setItem("syncos.apiToken", tokenValue);
    window.localStorage.setItem("syncos.permissions", permissionValue.join(","));
  }, { tokenValue: nextToken, permissionValue: nextPermissions });
}

async function apiJson(request: APIRequestContext, bearer: string, method: "GET" | "POST", route: string, body?: unknown) {
  const response = method === "GET" ? await request.get(apiUrl(route), { headers: auth(bearer) }) : await request.post(apiUrl(route), { headers: auth(bearer), data: body });
  expect(response.status(), `${method} ${route}: ${await response.text()}`).toBeLessThan(400);
  return response.json();
}

function auth(bearer: string) {
  return { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
}

function apiUrl(route: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${route.replace(/^\//, "")}`;
}

function pdfBase64() {
  return Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF").toString("base64");
}

function token(userId: string, tenantId: string, secret: string) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: userId, tenant_id: tenantId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
