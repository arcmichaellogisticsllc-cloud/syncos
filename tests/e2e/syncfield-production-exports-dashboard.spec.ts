import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantA: string;
  tenantB: string;
  orgA: string;
  crewA: string;
  reportId: string;
  mapFileId: string;
  internalToken: string;
  partnerToken: string;
  foremanToken: string;
  tenantBToken: string;
};

test.describe.serial("P11 accepted production exports, dashboard, and operational closeout", () => {
  let client: Client;
  let fixture: Fixture;
  let downstreamBefore: Awaited<ReturnType<typeof downstreamCounts>>;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedP11Fixture(client, secret);
    downstreamBefore = await downstreamCounts(client);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("dashboards aggregate reported vs Customer Accepted without double counting or rates", async ({ request }) => {
    const dashboard = await apiJson(request, fixture.internalToken, "GET", `/syncfield/production-dashboard?daily_report_id=${fixture.reportId}`);
    expect(dashboard.headline.production_record_count).toBe(3);
    expect(dashboard.headline.pending_customer_qc).toBe(1);
    expect(dashboard.headline.correction_required).toBe(1);
    const fiber = dashboard.reported_vs_accepted.find((row: Record<string, unknown>) => row.code === "FIBER");
    expect(fiber.reported_quantity).toBe(141);
    expect(fiber.customer_accepted_quantity).toBe(132);
    expect(fiber.variance).toBe(-9);
    const labor = dashboard.reported_vs_accepted.find((row: Record<string, unknown>) => row.code === "LABOR");
    expect(labor.pending_customer_qc).toBe(1);
    expect(JSON.stringify(dashboard)).not.toMatch(/contractor_rate|customer_rate|margin|storage_key|internal_note/i);

    const partner = await apiJson(request, fixture.partnerToken, "GET", "/syncfield/partner/production-dashboard");
    expect(partner.headline.production_record_count).toBe(3);
    const foreman = await apiJson(request, fixture.foremanToken, "GET", "/syncfield/foreman/production-history");
    expect(foreman.reports[0].id).toBe(fixture.reportId);
    const cross = await request.get(apiUrl(`/syncfield/partner/production-dashboard?organization_id=${fixture.orgA}`), { headers: auth(fixture.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });

  test("CSV export is private, formula-safe, idempotent, and financially inert", async ({ request }) => {
    const first = await apiJson(request, fixture.internalToken, "POST", "/syncfield/production-exports", {
      artifact_type: "production_csv",
      generation_mode: "dashboard_export",
      daily_report_id: fixture.reportId,
    });
    const retry = await apiJson(request, fixture.internalToken, "POST", "/syncfield/production-exports", {
      artifact_type: "production_csv",
      generation_mode: "dashboard_export",
      daily_report_id: fixture.reportId,
    });
    expect(retry.id).toBe(first.id);
    const bytes = await apiJson(request, fixture.internalToken, "GET", `/syncfield/production-exports/${first.id}/bytes`);
    const csv = Buffer.from(bytes.content_base64, "base64").toString("utf8");
    expect(csv).toContain("Reported Quantity");
    expect(csv).toContain("Customer Accepted Quantity");
    expect(csv).toContain("\"'=+@SUM(1,2)\"");
    expect(csv).not.toMatch(/contractor_rate|customer_rate|margin|storage_key/i);
    const partnerDownload = await apiJson(request, fixture.partnerToken, "GET", `/syncfield/partner/production-exports/${first.id}/bytes`);
    expect(Buffer.from(partnerDownload.content_base64, "base64").toString("utf8")).toContain("Customer QC Authority");
    const cross = await request.get(apiUrl(`/syncfield/partner/production-exports/${first.id}/bytes`), { headers: auth(fixture.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
    expect(await downstreamCounts(client)).toEqual(downstreamBefore);
  });

  test("annotated and daily PDFs preserve original map file and include coordinate/report proof", async ({ request }) => {
    const before = await client.query("SELECT checksum FROM partner_restricted_file_objects WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.mapFileId]);
    const annotated = await apiJson(request, fixture.internalToken, "POST", "/syncfield/production-exports", {
      artifact_type: "annotated_map_pdf",
      generation_mode: "customer_qc_status",
      daily_report_id: fixture.reportId,
    });
    const annotatedBytes = await apiJson(request, fixture.internalToken, "GET", `/syncfield/production-exports/${annotated.id}/bytes`);
    const annotatedPdf = Buffer.from(annotatedBytes.content_base64, "base64").toString("latin1");
    expect(annotatedPdf.startsWith("%PDF-")).toBe(true);
    expect(annotatedPdf).toContain("Customer Correction Required");
    expect(annotatedPdf).toContain("point\\(257.04,411.84\\)");
    const daily = await apiJson(request, fixture.internalToken, "POST", "/syncfield/production-exports", {
      artifact_type: "daily_production_pdf",
      generation_mode: "customer_qc_status",
      daily_report_id: fixture.reportId,
    });
    const dailyBytes = await apiJson(request, fixture.internalToken, "GET", `/syncfield/production-exports/${daily.id}/bytes`);
    const dailyPdf = Buffer.from(dailyBytes.content_base64, "base64").toString("latin1");
    expect(dailyPdf).toContain("Reported 141 LF; Customer Accepted 132");
    expect(dailyPdf).toContain("Pending Customer QC");
    const after = await client.query("SELECT checksum FROM partner_restricted_file_objects WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.mapFileId]);
    expect(after.rows[0].checksum).toBe(before.rows[0].checksum);
  });

  test("operational closeout distinguishes open QC/corrections and creates no financial records", async ({ request }) => {
    const closeout = await apiJson(request, fixture.internalToken, "POST", "/syncfield/production-closeout", { daily_report_id: fixture.reportId });
    expect(closeout.artifact_type).toBe("production_closeout_package");
    const dashboard = await apiJson(request, fixture.internalToken, "GET", `/syncfield/production-dashboard?daily_report_id=${fixture.reportId}`);
    expect(["awaiting_customer_qc", "corrections_open", "in_progress"]).toContain(dashboard.closeout.status);
    expect(dashboard.missing_reports.status).toBe("insufficient_schedule_data");
    expect(await downstreamCounts(client)).toEqual(downstreamBefore);
  });
});

async function seedP11Fixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const providerA = crypto.randomUUID();
  const providerB = crypto.randomUUID();
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
  const workOrderId = crypto.randomUUID();
  const agreementVersionId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const rateScheduleId = crypto.randomUUID();
  const workOrderVersionId = crypto.randomUUID();
  const crewA = crypto.randomUUID();
  const foremanWorker = crypto.randomUUID();
  const mapDocumentId = crypto.randomUUID();
  const mapVersionId = crypto.randomUUID();
  const mapFileId = crypto.randomUUID();
  const jsaId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const cycleId = crypto.randomUUID();
  const transferCode = crypto.randomUUID();
  const fiberCode = crypto.randomUUID();
  const laborCode = crypto.randomUUID();
  const transferRecord = crypto.randomUUID();
  const fiberRecord = crypto.randomUUID();
  const laborRecord = crypto.randomUUID();
  const permissions = ["production_dashboard.read", "production_export.generate", "production_export.read", "production_closeout.read", "production_closeout.generate", "partner_production_dashboard.read", "partner_production_export.read", "partner_production_export.generate", "partner_production_history.read_own", "partner_production_export.read_own", "partner_context.read", "partner_actions.read", "partner_daily_production.read_org", "partner_production.read_org", "partner_daily_production.read", "partner_customer_qc.read", "partner_customer_qc.read_own"];
  await client.query("BEGIN");
  try {
    for (const key of permissions) await client.query("INSERT INTO permissions (key, name) VALUES ($1, $1) ON CONFLICT (key) DO NOTHING", [key]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,'P11 Tenant A',$2),($3,'P11 Tenant B',$4)", [tenantA, `p11-a-${suffix}`, tenantB, `p11-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P11 Partner Admin'),($3,$4,'P11 Foreman'),($5,$6,'P11 Internal'),($7,$8,'P11 Tenant B')", [adminUser, `p11-admin-${suffix}@syncos.test`, foremanUser, `p11-foreman-${suffix}@syncos.test`, internalUser, `p11-internal-${suffix}@syncos.test`, tenantBUser, `p11-b-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [adminTenantUser, tenantA, adminUser, foremanTenantUser, foremanUser, internalTenantUser, internalUser, tenantBTenantUser, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P11 Partner Admin','partner_admin'),($3,$2,'P11 Partner Foreman','partner_foreman'),($4,$2,'P11 Internal','p11_internal'),($5,$6,'P11 Tenant B Partner Admin','partner_admin')", [adminRole, tenantA, foremanRole, internalRole, tenantBRole, tenantB]);
    for (const [tenantId, roleId, keys] of [[tenantA, adminRole, ["partner_context.read", "partner_production_dashboard.read", "partner_production_export.read", "partner_production_export.generate", "partner_daily_production.read_org", "partner_production.read_org", "partner_customer_qc.read"]], [tenantA, foremanRole, ["partner_context.read", "partner_production_history.read_own", "partner_production_export.read_own", "partner_daily_production.read", "partner_customer_qc.read_own"]], [tenantA, internalRole, ["production_dashboard.read", "production_export.generate", "production_export.read", "production_closeout.read", "production_closeout.generate"]], [tenantB, tenantBRole, ["partner_context.read", "partner_production_dashboard.read", "partner_production_export.read"]]] as const) {
      for (const key of keys) await client.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
    }
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P11 Partner','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P11 Customer','customer',ARRAY['work_creator']::text[],'active'),($4,$5,'P11 Tenant B Partner','subcontractor',ARRAY['capacity_provider']::text[],'active')", [orgA, tenantA, customerOrg, orgB, tenantB]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status) VALUES ($1,$2,$3,'P11 Provider','subcontractor','activated'),($4,$5,$6,'P11 Provider B','subcontractor','activated')", [providerA, tenantA, orgA, providerB, tenantB, orgB]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'organization',$4),($1,$5,$6,'organization',$4),($1,$7,$8,'tenant',$1),($9,$10,$11,'organization',$12)", [tenantA, adminTenantUser, adminRole, orgA, foremanTenantUser, foremanRole, internalTenantUser, internalRole, tenantB, tenantBTenantUser, tenantBRole, orgB]);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status,qc_authority_organization_id) VALUES ($1,$2,$3,'P11 Project','active',$3)", [projectId, tenantA, customerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P11 MSA','partner_master_agreement','active','active','2026-08-01')", [contractId, tenantA, orgA, providerA]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P11 Rate','2026-08-01','active')", [rateScheduleId, tenantA, orgA]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-01',$6)", [agreementVersionId, tenantA, orgA, providerA, contractId, internalUser]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P11 Crew','aerial','active','active',1)", [crewA, tenantA, providerA, orgA]);
    await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,'P11','Foreman','active','approved')", [foremanWorker, tenantA, providerA, crewA, orgA]);
    await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,'foreman','active')", [tenantA, orgA, providerA, crewA, foremanWorker]);
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, orgA, foremanWorker, foremanTenantUser]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,scope_summary,map_link,assignment_type,assigned_organization_id,partner_organization_id,partner_rate_schedule_id,governing_agreement_version_id,partner_execution_status,partner_effective_date,unit,planned_quantity,qc_authority_organization_id) VALUES ($1,$2,$3,$4,$5,'P11 WO','fiber',3000,'feet','assigned','P11 WO','WO-P11','P11 fiber scope','MAP-P11','partner_contractor',$6,$6,$7,$8,'active','2026-08-01','feet',3000,$9)", [workOrderId, tenantA, projectId, providerA, crewA, orgA, rateScheduleId, agreementVersionId, customerOrg]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WO-P11','P11 fiber scope','MAP-P11','feet','active','2026-08-01',$10)", [workOrderVersionId, tenantA, orgA, providerA, projectId, workOrderId, agreementVersionId, crewA, rateScheduleId, internalUser]);
    await client.query("INSERT INTO syncfield_map_documents (id,tenant_id,project_id,work_order_id,name,customer_document_number,status,created_by_user_id) VALUES ($1,$2,$3,$4,'P11 Map','ARL019','active',$5)", [mapDocumentId, tenantA, projectId, workOrderId, internalUser]);
    await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'syncfield_map_original_pdf','syncfield_map_version',$5,'map.pdf','application/pdf',16,'original-map-checksum',$6,$7)", [mapFileId, tenantA, orgA, providerA, mapVersionId, `${tenantA}/${orgA}/p11-map.pdf`, internalUser]);
    await client.query("INSERT INTO syncfield_map_versions (id,tenant_id,map_document_id,revision_number,revision_label,original_filename,original_file_object_id,file_hash,page_count,processing_status,status,uploaded_by_user_id) VALUES ($1,$2,$3,1,'Rev 0','map.pdf',$4,'original-map-checksum',1,'ready','ready',$5)", [mapVersionId, tenantA, mapDocumentId, mapFileId, internalUser]);
    await client.query("INSERT INTO syncfield_map_pages (tenant_id,map_version_id,page_number,pdf_width,pdf_height) VALUES ($1,$2,1,612,792)", [tenantA, mapVersionId]);
    await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,map_version_id,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-25',$11,'completed','P11 work area',true,$10,now())", [jsaId, tenantA, projectId, workOrderId, workOrderVersionId, orgA, providerA, crewA, foremanWorker, foremanUser, mapVersionId]);
    await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,map_document_id,map_version_id,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-25',$11,$12,$13,'submitted',now(),$10,1,'complete','customer_correction_required')", [reportId, tenantA, projectId, workOrderId, workOrderVersionId, orgA, providerA, crewA, foremanWorker, foremanUser, mapDocumentId, mapVersionId, jsaId]);
    await client.query("INSERT INTO daily_production_report_revisions (id,tenant_id,daily_report_id,revision_number,snapshot_json,reason,submitted_by_user_id) VALUES ($1,$2,$3,1,'{}','submitted',$4)", [revisionId, tenantA, reportId, foremanUser]);
    for (const [id, code, description, unit, locationType] of [[transferCode, "TRANSFER", "Cable Transfer", "EA", "asset"], [fiberCode, "FIBER", "Place Fiber", "LF", "route"], [laborCode, "LABOR", "Labor Hours", "HR", "daily"]] as const) {
      await client.query("INSERT INTO syncfield_production_codes (id,tenant_id,code,description,unit_of_measure,location_type,requires_asset,requires_route) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, tenantA, code, description, unit, locationType, locationType === "asset", locationType === "route"]);
    }
    await insertProduction(client, tenantA, projectId, workOrderId, workOrderVersionId, orgA, providerA, crewA, foremanWorker, foremanUser, reportId, transferRecord, transferCode, 1, "EA", "asset", "complete", "Pole 12301", null, null, "=+@SUM(1,2)");
    await insertProduction(client, tenantA, projectId, workOrderId, workOrderVersionId, orgA, providerA, crewA, foremanWorker, foremanUser, reportId, fiberRecord, fiberCode, 141, "LF", "route", "partial", null, "Pole 12301", "Pole 12312", "Fiber notes");
    await insertProduction(client, tenantA, projectId, workOrderId, workOrderVersionId, orgA, providerA, crewA, foremanWorker, foremanUser, reportId, laborRecord, laborCode, 8, "HR", "daily", "complete", null, null, null, "Crew labor");
    await client.query("INSERT INTO map_annotations (tenant_id,production_record_id,map_version_id,page_number,annotation_type,x_ratio,y_ratio,display_status,created_by_user_id) VALUES ($1,$2,$3,1,'asset_point',0.42,0.48,'complete',$4)", [tenantA, transferRecord, mapVersionId, foremanUser]);
    await client.query("INSERT INTO map_annotations (tenant_id,production_record_id,map_version_id,page_number,annotation_type,start_x_ratio,start_y_ratio,end_x_ratio,end_y_ratio,display_status,created_by_user_id) VALUES ($1,$2,$3,1,'route_line',0.42,0.48,0.66,0.52,'partial',$4)", [tenantA, fiberRecord, mapVersionId, foremanUser]);
    await client.query("INSERT INTO customer_qc_cycles (id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,submitted_to_customer_at,source_reference,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'awaiting_partner_correction',now() - interval '3 days','customer-email',$11)", [cycleId, tenantA, projectId, workOrderId, workOrderVersionId, reportId, revisionId, orgA, crewA, customerOrg, internalUser]);
    const partialDecision = crypto.randomUUID();
    const correctionDecision = crypto.randomUUID();
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference) VALUES ($1,$2,$3,$4,'partially_accepted',141,132,'LF','customer_measured_difference',$5,'customer-email'),($6,$2,$3,$7,'correction_required',1,NULL,'EA','asset_identifier',$5,'customer-email')", [partialDecision, tenantA, cycleId, fiberRecord, internalUser, correctionDecision, transferRecord]);
    await client.query("INSERT INTO production_corrections (tenant_id,qc_cycle_id,customer_qc_decision_id,daily_report_id,production_record_id,partner_organization_id,crew_id,correction_type,allowed_fields,customer_reason,partner_safe_instructions,status,created_by_user_id,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,'asset_identifier',ARRAY['asset_identifier','notes']::text[],'Wrong asset','Correct asset identifier','open',$8,'2026-08-30')", [tenantA, cycleId, correctionDecision, reportId, transferRecord, orgA, crewA, internalUser]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { tenantA, tenantB, orgA, crewA, reportId, mapFileId, internalToken: token(internalUser, tenantA, secret), partnerToken: token(adminUser, tenantA, secret), foremanToken: token(foremanUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret) };
}

async function insertProduction(client: Client, tenantId: string, projectId: string, workOrderId: string, workOrderVersionId: string, orgId: string, providerId: string, crewId: string, foremanWorkerId: string, foremanUserId: string, reportId: string, recordId: string, codeId: string, quantity: number, unit: string, locationType: string, status: string, assetIdentifier: string | null, fromAsset: string | null, toAsset: string | null, notes: string) {
  await client.query(
    "INSERT INTO production_records (id,tenant_id,project_id,work_order_id,work_order_version_id,capacity_provider_id,crew_id,foreman_user_id,foreman_worker_id,submitted_by_user_id,submitted_by,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,production_type,qc_status,billable_status,status,daily_production_report_id,partner_organization_id,map_document_id,map_version_id,syncfield_production_code_id,syncfield_location_type,syncfield_status,asset_type,asset_identifier,from_asset_identifier,to_asset_identifier,map_page,production_notes,locked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$8,'2026-08-25',$10,$10,$10,$11,$11,'daily_production','not_started','not_billable','submitted',$12,$13,NULL,NULL,$14,$15,$16,$17,$18,$19,$20,1,$21,now())",
    [recordId, tenantId, projectId, workOrderId, workOrderVersionId, providerId, crewId, foremanUserId, foremanWorkerId, quantity, unit, reportId, orgId, codeId, locationType, status, locationType === "asset" ? "pole" : null, assetIdentifier, fromAsset, toAsset, notes],
  );
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

function token(userId: string, tenantId: string, secret: string) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: userId, tenant_id: tenantId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function downstreamCounts(client: Client) {
  const result = await client.query("SELECT (SELECT count(*)::int FROM billable_items) AS billable, (SELECT count(*)::int FROM settlements) AS settlements, (SELECT count(*)::int FROM contractor_payables) AS payables, (SELECT count(*)::int FROM payments) AS payments, (SELECT count(*)::int FROM invoices) AS invoices, (SELECT count(*)::int FROM cash_receipts) AS cash_receipts");
  return result.rows[0];
}
