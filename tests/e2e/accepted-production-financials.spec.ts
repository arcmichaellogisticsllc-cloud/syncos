import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantA: string;
  tenantB: string;
  partnerOrg: string;
  customerOrg: string;
  fiberDecision: string;
  pendingDecision: string;
  extraDecision: string;
  internalToken: string;
  partnerToken: string;
  foremanToken: string;
  tenantBToken: string;
};

test.describe.serial("P12 accepted production financials", () => {
  let client: Client;
  let fixture: Fixture;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedP12Fixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("Customer-accepted production converts to one Billable using Customer rate only", async ({ request }) => {
    const queue = await apiJson(request, fixture.internalToken, "GET", "/accepted-production-financials/billable-queue");
    expect(queue.length).toBeGreaterThanOrEqual(2);

    const billable = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/billables/convert", { customer_qc_decision_id: fixture.fiberDecision });
    const retry = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/billables/convert", { customer_qc_decision_id: fixture.fiberDecision });
    expect(retry.id).toBe(billable.id);
    expect(Number(billable.billable_quantity)).toBe(141);
    expect(Number(billable.customer_rate_locked)).toBe(0.94);
    expect(Number(billable.net_billable_amount)).toBe(132.54);
    expect(JSON.stringify(billable)).not.toMatch(/contractor_rate|margin/i);

    const count = await client.query("SELECT count(*)::int AS count FROM billable_items WHERE tenant_id = $1 AND production_record_id = $2", [fixture.tenantA, billable.production_record_id]);
    expect(count.rows[0].count).toBe(1);
  });

  test("Invoice, cash, payment application, and invoice balance stay in Customer revenue chain", async ({ request }) => {
    const invoice = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/invoices/create", { retainage_percent: 0 });
    expect(Number(invoice.original_amount)).toBe(132.54);
    expect(Number(invoice.balance_amount)).toBe(132.54);

    const receipt = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/cash-receipts", {
      customer_organization_id: fixture.customerOrg,
      amount: 66.27,
      payment_reference: "P12-CASH-1",
      idempotency_key: "p12-cash-1",
    });
    const receivedEligibility = await client.query("SELECT COALESCE(sum(eligible_amount),0)::numeric AS eligible FROM contractor_payables WHERE tenant_id = $1", [fixture.tenantA]);
    expect(Number(receivedEligibility.rows[0].eligible)).toBe(0);
    await apiJson(request, fixture.internalToken, "POST", `/accepted-production-financials/cash-receipts/${receipt.id}/clear`);
    const application = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/payment-applications", { cash_receipt_id: receipt.id, invoice_id: invoice.id, amount: 66.27 });
    expect(application.invoice_id).toBe(invoice.id);

    const refreshed = await client.query("SELECT paid_amount,balance_amount FROM invoices WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, invoice.id]);
    expect(Number(refreshed.rows[0].paid_amount)).toBe(66.27);
    expect(Number(refreshed.rows[0].balance_amount)).toBe(66.27);
    const paymentCount = await client.query("SELECT count(*)::int AS count FROM payments WHERE tenant_id = $1", [fixture.tenantA]);
    expect(paymentCount.rows[0].count).toBe(0);
  });

  test("Partner settlement, Contractor Payable, and pay-when-paid eligibility use Partner rate", async ({ request }) => {
    const settlement = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/partner-settlements/create", { period_start: "2026-08-24", period_end: "2026-08-30" });
    expect(Number(settlement.net_settlement_amount)).toBe(98.7);
    const payable = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/contractor-payables/create", { settlement_id: settlement.id });
    expect(Number(payable.net_payable_amount)).toBe(98.7);
    expect(Number(payable.eligible_amount)).toBe(0);
    expect(payable.pay_when_paid_status).toBe("awaiting_customer_funds");

    const eligible = await apiJson(request, fixture.internalToken, "POST", `/accepted-production-financials/contractor-payables/${payable.id}/calculate-eligibility`);
    expect(eligible.pay_when_paid_status).toBe("partially_eligible");
    expect(Number(eligible.eligible_amount)).toBe(49.35);
    expect(eligible.payment_due_at).toBeTruthy();
    const snapshots = await client.query("SELECT count(*)::int AS count FROM contractor_payable_eligibility_snapshots WHERE tenant_id = $1 AND contractor_payable_id = $2", [fixture.tenantA, payable.id]);
    expect(snapshots.rows[0].count).toBe(1);
  });

  test("Partner Admin sees own settlement without Customer rate or margin; Foreman and Partner B are denied", async ({ request }) => {
    const partner = await apiJson(request, fixture.partnerToken, "GET", "/accepted-production-financials/partner/settlements");
    expect(Number(partner[0].items[0].partner_rate)).toBe(0.7);
    expect(JSON.stringify(partner)).not.toMatch(/customer_rate|margin/i);

    const foreman = await request.get(apiUrl("/accepted-production-financials/partner/settlements"), { headers: auth(fixture.foremanToken) });
    expect(foreman.status()).toBeGreaterThanOrEqual(403);
    const cross = await request.get(apiUrl("/accepted-production-financials/partner/settlements"), { headers: auth(fixture.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });

  test("Missing Partner rate creates settlement exception but does not block Customer Billable", async ({ request }) => {
    await client.query("UPDATE rate_codes SET contractor_rate = NULL WHERE tenant_id = $1 AND code = 'FIBER'", [fixture.tenantA]);
    await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/billables/convert", { customer_qc_decision_id: fixture.extraDecision });
    const source = await client.query("SELECT id FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2", [fixture.tenantA, fixture.extraDecision]);
    const response = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/partner-settlements/create", { accepted_production_source_ids: [source.rows[0].id] });
    expect(response.exception_type).toBe("missing_partner_rate");
    const exceptions = await apiJson(request, fixture.internalToken, "GET", "/accepted-production-financials/exceptions");
    expect(exceptions.some((row: Record<string, unknown>) => row.exception_type === "missing_partner_rate")).toBe(true);
  });

  test("Post-billing Customer QC change creates exception without rewriting issued invoice or Billable", async ({ request }) => {
    const source = await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2", [fixture.tenantA, fixture.fiberDecision]);
    const beforeInvoice = await client.query("SELECT original_amount,balance_amount FROM invoices WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [fixture.tenantA]);
    const newDecision = crypto.randomUUID();
    await client.query("UPDATE customer_qc_decisions SET current = false WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.fiberDecision]);
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference,current) VALUES ($1,$2,$3,$4,'partially_accepted',141,132,'feet','customer_revision',$5,'corrected-source',true)", [newDecision, fixture.tenantA, source.rows[0].customer_qc_cycle_id, source.rows[0].production_record_id, source.rows[0].created_by_user_id]);
    const exception = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/detect-qc-change", { accepted_production_source_id: source.rows[0].id });
    expect(exception.exception_type).toBe("post_billing_customer_qc_change");
    const afterInvoice = await client.query("SELECT original_amount,balance_amount FROM invoices WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [fixture.tenantA]);
    expect(afterInvoice.rows[0]).toEqual(beforeInvoice.rows[0]);
  });
});

async function seedP12Fixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const partnerOrg = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const provider = crypto.randomUUID();
  const crew = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const partnerUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const internalTenantUser = crypto.randomUUID();
  const partnerTenantUser = crypto.randomUUID();
  const foremanTenantUser = crypto.randomUUID();
  const tenantBTenantUser = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const partnerRole = crypto.randomUUID();
  const foremanRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();
  const project = crypto.randomUUID();
  const workOrder = crypto.randomUUID();
  const contract = crypto.randomUUID();
  const agreementVersion = crypto.randomUUID();
  const customerSchedule = crypto.randomUUID();
  const partnerSchedule = crypto.randomUUID();
  const fiberCode = crypto.randomUUID();
  const workOrderVersion = crypto.randomUUID();
  const mapFile = crypto.randomUUID();
  const mapDocument = crypto.randomUUID();
  const mapVersion = crypto.randomUUID();
  const dailyJsa = crypto.randomUUID();
  const foremanWorker = crypto.randomUUID();
  const report = crypto.randomUUID();
  const revision = crypto.randomUUID();
  const cycle = crypto.randomUUID();
  const fiberProduction = crypto.randomUUID();
  const pendingProduction = crypto.randomUUID();
  const extraProduction = crypto.randomUUID();
  const fiberDecision = crypto.randomUUID();
  const pendingDecision = crypto.randomUUID();
  const extraDecision = crypto.randomUUID();
  const permissions = [
    "billing.read", "billing.create_billable", "billing.create_invoice", "billing.issue_invoice", "cash_receipt.record", "payment_application.create",
    "partner_settlement.read", "partner_settlement.create", "partner_contractor_payable.read", "partner_payment_eligibility.read", "contractor_payable.create",
    "contractor_payable.calculate_eligibility", "financial_exception.read", "partner_context.read",
  ];
  await client.query("BEGIN");
  try {
    for (const key of permissions) await client.query("INSERT INTO permissions (key,name) VALUES ($1,$1) ON CONFLICT (key) DO NOTHING", [key]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,'P12 Tenant A',$2),($3,'P12 Tenant B',$4)", [tenantA, `p12-a-${suffix}`, tenantB, `p12-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P12 Internal'),($3,$4,'P12 Partner Admin'),($5,$6,'P12 Foreman'),($7,$8,'P12 Tenant B')", [internalUser, `p12-internal-${suffix}@syncos.test`, partnerUser, `p12-partner-${suffix}@syncos.test`, foremanUser, `p12-foreman-${suffix}@syncos.test`, tenantBUser, `p12-b-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [internalTenantUser, tenantA, internalUser, partnerTenantUser, partnerUser, foremanTenantUser, foremanUser, tenantBTenantUser, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P12 Finance','p12_finance'),($3,$2,'Partner Admin','partner_admin'),($4,$2,'Partner Foreman','partner_foreman'),($5,$6,'Partner Admin','partner_admin')", [internalRole, tenantA, partnerRole, foremanRole, tenantBRole, tenantB]);
    for (const [tenantId, roleId, keys] of [[tenantA, internalRole, permissions.filter((key) => key !== "partner_context.read")], [tenantA, partnerRole, ["partner_context.read", "partner_settlement.read", "partner_contractor_payable.read", "partner_payment_eligibility.read"]], [tenantA, foremanRole, ["partner_context.read"]], [tenantB, tenantBRole, ["partner_context.read", "partner_settlement.read"]]] as const) {
      for (const key of keys) await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
    }
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P12 Partner','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P12 Customer','customer',ARRAY['work_creator']::text[],'active')", [partnerOrg, tenantA, customerOrg]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status) VALUES ($1,$2,$3,'P12 Provider','subcontractor','activated')", [provider, tenantA, partnerOrg]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'tenant',$1),($1,$4,$5,'organization',$6),($1,$7,$8,'organization',$6),($9,$10,$11,'organization',$12)", [tenantA, internalTenantUser, internalRole, partnerTenantUser, partnerRole, partnerOrg, foremanTenantUser, foremanRole, tenantB, tenantBTenantUser, tenantBRole, crypto.randomUUID()]);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status,qc_authority_organization_id) VALUES ($1,$2,$3,'P12 Project','active',$3)", [project, tenantA, customerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P12 MSA','partner_master_agreement','active','active','2026-08-01')", [contract, tenantA, partnerOrg, provider]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-01',$6)", [agreementVersion, tenantA, partnerOrg, provider, contract, internalUser]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P12 Customer Rates','2026-08-01','active'),($4,$2,$5,'P12 Partner Rates','2026-08-01','active')", [customerSchedule, tenantA, customerOrg, partnerSchedule, partnerOrg]);
    await client.query("INSERT INTO rate_codes (tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,customer_rate,contractor_rate,status) VALUES ($1,$2,'FIBER','Place Fiber','feet','feet',0.94,0.94,NULL,'active'),($1,$3,'FIBER','Place Fiber','feet','feet',0.70,NULL,0.70,'active')", [tenantA, customerSchedule, partnerSchedule]);
    await client.query("INSERT INTO syncfield_production_codes (id,tenant_id,code,description,unit_of_measure,location_type,requires_route) VALUES ($1,$2,'FIBER','Place Fiber','feet','route',true)", [fiberCode, tenantA]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P12 Crew','aerial','active','active',1)", [crew, tenantA, provider, partnerOrg]);
    await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,'P12','Foreman','active','approved')", [foremanWorker, tenantA, provider, crew, partnerOrg]);
    await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,'foreman','active')", [tenantA, partnerOrg, provider, crew, foremanWorker]);
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, partnerOrg, foremanWorker, foremanTenantUser]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,assigned_organization_id,partner_organization_id,customer_rate_schedule_id,partner_rate_schedule_id,governing_agreement_version_id,partner_execution_status,partner_effective_date,unit,planned_quantity,qc_authority_organization_id) VALUES ($1,$2,$3,$4,$5,'P12 WO','fiber',3000,'feet','assigned','P12 WO','WO-P12',$6,$6,$7,$8,$9,'active','2026-08-01','feet',3000,$10)", [workOrder, tenantA, project, provider, crew, partnerOrg, customerSchedule, partnerSchedule, agreementVersion, customerOrg]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WO-P12','P12 scope','MAP-P12','feet','active','2026-08-01',$10)", [workOrderVersion, tenantA, partnerOrg, provider, project, workOrder, agreementVersion, crew, partnerSchedule, internalUser]);
    await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'syncfield_map_original_pdf','syncfield_map_version',$5,'p12-map.pdf','application/pdf',16,'p12-original-map-checksum',$6,$7)", [mapFile, tenantA, partnerOrg, provider, mapVersion, `${tenantA}/${partnerOrg}/p12-map.pdf`, internalUser]);
    await client.query("INSERT INTO syncfield_map_documents (id,tenant_id,project_id,work_order_id,name,customer_document_number,status,created_by_user_id) VALUES ($1,$2,$3,$4,'P12 Map','P12-MAP','active',$5)", [mapDocument, tenantA, project, workOrder, internalUser]);
    await client.query("INSERT INTO syncfield_map_versions (id,tenant_id,map_document_id,revision_number,revision_label,original_filename,original_file_object_id,file_hash,page_count,processing_status,status,uploaded_by_user_id) VALUES ($1,$2,$3,1,'Rev 1','p12-map.pdf',$4,'p12-original-map-checksum',1,'ready','ready',$5)", [mapVersion, tenantA, mapDocument, mapFile, internalUser]);
    await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,map_version_id,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-25',$11,'completed','P12 work area',true,$10,now())", [dailyJsa, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, mapVersion]);
    await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,map_document_id,map_version_id,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-25',$11,$12,$13,'submitted',now(),$10,1,'complete','customer_partially_accepted')", [report, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, mapDocument, mapVersion, dailyJsa]);
    await client.query("INSERT INTO daily_production_report_revisions (id,tenant_id,daily_report_id,revision_number,snapshot_json,reason,submitted_by_user_id) VALUES ($1,$2,$3,1,'{}','submitted',$4)", [revision, tenantA, report, foremanUser]);
    await client.query("INSERT INTO customer_qc_cycles (id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,submitted_to_customer_at,source_reference,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,'partially_accepted',now(),'customer-report',$11)", [cycle, tenantA, project, workOrder, workOrderVersion, report, revision, partnerOrg, crew, customerOrg, internalUser]);
    await insertProduction(client, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, report, fiberProduction, fiberCode, 141);
    await insertProduction(client, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, report, pendingProduction, fiberCode, 12);
    await insertProduction(client, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, report, extraProduction, fiberCode, 10);
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference) VALUES ($1,$2,$3,$4,'accepted',141,141,'feet','customer_acceptance',$5,'customer-report'),($6,$2,$3,$7,'correction_required',12,NULL,'feet','missing_evidence',$5,'customer-report'),($8,$2,$3,$9,'accepted',10,10,'feet','customer_acceptance',$5,'customer-report')", [fiberDecision, tenantA, cycle, fiberProduction, internalUser, pendingDecision, pendingProduction, extraDecision, extraProduction]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { tenantA, tenantB, partnerOrg, customerOrg, fiberDecision, pendingDecision, extraDecision, internalToken: token(internalUser, tenantA, secret), partnerToken: token(partnerUser, tenantA, secret), foremanToken: token(foremanUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret) };
}

async function insertProduction(client: Client, tenantId: string, projectId: string, workOrderId: string, workOrderVersionId: string, orgId: string, providerId: string, crewId: string, foremanWorkerId: string, foremanUserId: string, reportId: string, recordId: string, codeId: string, quantity: number) {
  await client.query(
    "INSERT INTO production_records (id,tenant_id,project_id,work_order_id,work_order_version_id,capacity_provider_id,crew_id,foreman_user_id,foreman_worker_id,submitted_by_user_id,submitted_by,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,production_type,qc_status,billable_status,status,daily_production_report_id,partner_organization_id,syncfield_production_code_id,syncfield_location_type,syncfield_status,from_asset_identifier,to_asset_identifier,map_page,production_notes,locked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$8,'2026-08-25',$10,$10,$10,'feet','feet','daily_production','not_started','not_billable','submitted',$11,$12,$13,'route','complete','Pole 1','Pole 2',1,'P12 fiber',now())",
    [recordId, tenantId, projectId, workOrderId, workOrderVersionId, providerId, crewId, foremanUserId, foremanWorkerId, quantity, reportId, orgId, codeId],
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
