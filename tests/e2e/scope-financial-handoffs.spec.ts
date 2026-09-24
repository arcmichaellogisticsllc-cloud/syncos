import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantA: string;
  tenantB: string;
  partnerOrg: string;
  customerOrg: string;
  fiberDecision: string;
  coilDecision: string;
  workOrder: string;
  pendingDecision: string;
  extraDecision: string;
  internalToken: string;
  partnerToken: string;
  foremanToken: string;
  tenantBToken: string;
};

// Boundary acceptance: immutable customer decisions are fixture inputs, not a claim
// that this file tests field entry or customer review UI. All financial transactions
// use copied persona grants or an explicitly limited test-only finance recorder.
// This never broadens the existing pilot Payables approval authority.
test.describe("Scope preservation: financial role handoffs", () => {
  let client: Client;
  test.beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/test|scope|browser|release/.test(db.pathname)) {
      throw new Error("Scope tests require an explicitly disposable local test database");
    }
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });
  test.afterAll(async () => { await client?.end(); });

  test("accepted partner quantity passes billing, cash and payables roles to one evidence-backed external payment", async ({ request }) => {
    test.setTimeout(120000);
    const f = await seedP12Fixture(client, process.env.AUTH_JWT_SECRET!);
    const billing = await copyPersona(client, f.tenantA, "e2e_billing_manager");
    const finance = await copyPersona(client, f.tenantA, "e2e_finance_user");
    const payables = await copyPersona(client, f.tenantA, "e2e_payables_payroll_admin");
    const recorder = await explicitFinanceRecorder(client, f.tenantA);
    const ops = await copyPersona(client, f.tenantA, "e2e_ops_manager");
    // Deliberately different quantities: 141 reported, only 100 customer accepted.
    await client.query("UPDATE customer_qc_decisions SET decision='partially_accepted',customer_accepted_quantity=100 WHERE tenant_id=$1 AND id=$2", [f.tenantA,f.fiberDecision]);
    for (const actor of [billing, finance, payables, recorder, ops]) {
      const me = await apiJson(request, actor.bearer, "GET", "/auth/me");
      expect(me.permissions).not.toContain("admin.manage_users");
    }
    const convert = "/accepted-production-financials/billables/convert";
    for (const bearer of [f.foremanToken, ops.bearer]) {
      expect((await request.post(apiUrl(convert), {headers:auth(bearer),data:{customer_qc_decision_id:f.fiberDecision}})).status()).toBe(403);
    }
    const pending = await request.post(apiUrl(convert), {headers:auth(billing.bearer),data:{customer_qc_decision_id:f.pendingDecision}});
    // The accepted-source query deliberately excludes correction-required decisions.
    expect(pending.status()).toBe(404);
    expect((await pending.json()).message).toBe("accepted production not found");
    for (const table of ["accepted_production_financial_sources", "billable_items"]) {
      expect((await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id=$1 AND customer_qc_decision_id=$2`,[f.tenantA,f.pendingDecision])).rows[0].count).toBe(0);
    }
    const billable = await apiJson(request,billing.bearer,"POST",convert,{customer_qc_decision_id:f.fiberDecision});
    expect(Number(billable.billable_quantity)).toBe(100);
    expect(Number(billable.net_billable_amount)).toBe(94);
    expect((await apiJson(request,billing.bearer,"POST",convert,{customer_qc_decision_id:f.fiberDecision})).id).toBe(billable.id);
    const source = (await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id=$1 AND customer_qc_decision_id=$2",[f.tenantA,f.fiberDecision])).rows[0];
    expect(Number(source.accepted_quantity)).toBe(100);
    expect(source.billable_item_id).toBe(billable.id);
    const reported = (await client.query("SELECT quantity_submitted FROM production_records WHERE tenant_id=$1 AND id=$2",[f.tenantA,source.production_record_id])).rows[0];
    expect(Number(reported.quantity_submitted)).toBe(141);
    const invoice = await apiJson(request,billing.bearer,"POST","/accepted-production-financials/invoices/create",{billable_item_ids:[billable.id],retainage_percent:0});
    expect(Number(invoice.original_amount)).toBe(94);
    const settlement = await apiJson(request,recorder.bearer,"POST","/accepted-production-financials/partner-settlements/create",{accepted_production_source_ids:[source.id]});
    expect(Number(settlement.net_settlement_amount)).toBe(70);
    const payable = await apiJson(request,payables.bearer,"POST","/accepted-production-financials/contractor-payables/create",{settlement_id:settlement.id});
    expect(Number(payable.net_payable_amount)).toBe(70);
    const calculate = `/accepted-production-financials/contractor-payables/${payable.id}/calculate-eligibility`;
    expect(Number((await apiJson(request,payables.bearer,"POST",calculate)).eligible_amount)).toBe(0);
    const payment = {contractor_payable_id:payable.id,amount:70,payment_date:new Date().toISOString().slice(0,10),method:"ach",reference:crypto.randomUUID(),evidence_reference:"Synthetic scope pilot bank confirmation",idempotency_key:crypto.randomUUID(),confirmed_completed:true};
    const external = "/payment-retainage-adjustments/external-payments";
    expect((await request.post(apiUrl(external),{headers:auth(recorder.bearer),data:payment})).status()).toBe(400);
    const receipt = await apiJson(request,finance.bearer,"POST","/accepted-production-financials/cash-receipts",{customer_organization_id:f.customerOrg,amount:94,payment_reference:crypto.randomUUID(),idempotency_key:crypto.randomUUID()});
    expect(Number((await apiJson(request,payables.bearer,"POST",calculate)).eligible_amount)).toBe(0);
    await apiJson(request,finance.bearer,"POST",`/accepted-production-financials/cash-receipts/${receipt.id}/clear`);
    // Cleared but unallocated customer cash cannot authorize a partner payment.
    expect(Number((await apiJson(request,payables.bearer,"POST",calculate)).eligible_amount)).toBe(0);
    const application = await apiJson(request,finance.bearer,"POST","/accepted-production-financials/payment-applications",{cash_receipt_id:receipt.id,invoice_id:invoice.id,amount:94});
    expect(application.invoice_id).toBe(invoice.id);
    expect(Number((await apiJson(request,payables.bearer,"POST",calculate)).eligible_amount)).toBe(70);
    for (const bearer of [f.foremanToken,ops.bearer]) expect((await request.post(apiUrl(external),{headers:auth(bearer),data:payment})).status()).toBe(403);
    expect((await request.post(apiUrl(external),{headers:auth(recorder.bearer),data:{...payment,evidence_reference:""}})).status()).toBe(400);
    const paid = await apiJson(request,recorder.bearer,"POST",external,payment);
    expect((await apiJson(request,recorder.bearer,"POST",external,payment)).id).toBe(paid.id);
    expect(paid.recorded_by).toBe(recorder.userId);
    const final = (await client.query("SELECT paid_amount,balance_amount FROM invoices WHERE tenant_id=$1 AND id=$2",[f.tenantA,invoice.id])).rows[0];
    expect(Number(final.paid_amount)).toBe(94); expect(Number(final.balance_amount)).toBe(0);
    const debt = (await client.query("SELECT paid_amount FROM contractor_payables WHERE tenant_id=$1 AND id=$2",[f.tenantA,payable.id])).rows[0];
    expect(Number(debt.paid_amount)).toBe(70);
    const paymentRows = (await client.query("SELECT count(*)::int AS count FROM external_partner_payments WHERE tenant_id=$1 AND contractor_payable_id=$2",[f.tenantA,payable.id])).rows[0];
    expect(paymentRows.count).toBe(1);
    expect((await client.query("SELECT count(*)::int AS count FROM partner_payment_instructions WHERE tenant_id=$1",[f.tenantA])).rows[0].count).toBe(0);
    const safe = await apiJson(request,f.partnerToken,"GET","/accepted-production-financials/partner/settlements");
    expect(JSON.stringify(safe)).toContain(settlement.id);
    expect(JSON.stringify(safe)).not.toMatch(/customer_rate|margin/);
    // All debt items retain the same accepted source; no parallel/manual financial path.
    const items = await client.query("SELECT accepted_production_source_id FROM contractor_payable_items WHERE tenant_id=$1 AND contractor_payable_id=$2",[f.tenantA,payable.id]);
    expect(items.rows.map(r=>r.accepted_production_source_id)).toEqual([source.id]);
  });

  test("accepted employee source remains customer billable but cannot create partner debt", async ({request}) => {
    const f = await seedP12Fixture(client,process.env.AUTH_JWT_SECRET!);
    const billing = await copyPersona(client,f.tenantA,"e2e_billing_manager");
    const recorder = await explicitFinanceRecorder(client,f.tenantA);
    // Economic boundary fixture, not internal workforce onboarding: source belongs
    // to an internal provider even when legacy commercial metadata exists.
    await client.query("UPDATE capacity_providers SET provider_type='internal_workforce' WHERE tenant_id=$1",[f.tenantA]);
    const billable = await apiJson(request,billing.bearer,"POST","/accepted-production-financials/billables/convert",{customer_qc_decision_id:f.fiberDecision});
    expect(Number(billable.net_billable_amount)).toBe(132.54);
    const source = (await client.query("SELECT id FROM accepted_production_financial_sources WHERE tenant_id=$1 AND customer_qc_decision_id=$2",[f.tenantA,f.fiberDecision])).rows[0];
    const rejected = await request.post(apiUrl("/accepted-production-financials/partner-settlements/create"),{headers:auth(recorder.bearer),data:{accepted_production_source_ids:[source.id]}});
    expect(rejected.status()).toBe(400);
    expect(await rejected.text()).toContain("Sync employee work is not eligible for partner settlement");
    const invoice = await apiJson(request,billing.bearer,"POST","/accepted-production-financials/invoices/create",{billable_item_ids:[billable.id],retainage_percent:0});
    expect(Number(invoice.original_amount)).toBe(132.54);
    for (const table of ["settlements","contractor_payables","external_partner_payments"]) {
      expect((await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id=$1`,[f.tenantA])).rows[0].count).toBe(0);
    }
  });
});

// Explicitly authorized finance authority in a test-only tenant. These two
// permissions do NOT imply that the shared pilot Payables role is provisioned
// to approve settlements or confirm externally completed payments.
async function explicitFinanceRecorder(client: Client, tenantId: string) {
  const userId=crypto.randomUUID(), memberId=crypto.randomUUID(), roleId=crypto.randomUUID();
  await client.query("INSERT INTO users(id,email,display_name) VALUES($1,$2,'Scope authorized finance recorder')",[userId,`${userId}@syncos.test`]);
  await client.query("INSERT INTO tenant_users(id,tenant_id,user_id) VALUES($1,$2,$3)",[memberId,tenantId,userId]);
  await client.query("INSERT INTO roles(id,tenant_id,name,system_key) VALUES($1,$2,'Scope authorized finance recorder','scope_finance_recorder')",[roleId,tenantId]);
  await client.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key=ANY($3::text[])",[tenantId,roleId,["partner_settlement.create","partner_payment.confirm"]]);
  await client.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,'tenant',$1)",[tenantId,memberId,roleId]);
  return {userId,bearer:token(userId,tenantId,process.env.AUTH_JWT_SECRET!)};
}

async function copyPersona(client: Client, tenantId: string, systemKey: string) {
  const template = (await client.query("SELECT r.id,r.name FROM roles r WHERE r.system_key=$1 ORDER BY r.created_at LIMIT 1",[systemKey])).rows[0];
  expect(template, `Canonical seeded role ${systemKey} must exist`).toBeTruthy();
  const userId=crypto.randomUUID(), memberId=crypto.randomUUID(), roleId=crypto.randomUUID();
  await client.query("INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)",[userId,`${userId}@syncos.test`,`Scope ${template.name}`]);
  await client.query("INSERT INTO tenant_users(id,tenant_id,user_id) VALUES($1,$2,$3)",[memberId,tenantId,userId]);
  await client.query("INSERT INTO roles(id,tenant_id,name,system_key) VALUES($1,$2,$3,$4)",[roleId,tenantId,template.name,`scope_${systemKey}`]);
  await client.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,permission_id FROM role_permissions WHERE role_id=$3",[tenantId,roleId,template.id]);
  await client.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,'tenant',$1)",[tenantId,memberId,roleId]);
  return {userId,bearer:token(userId,tenantId,process.env.AUTH_JWT_SECRET!)};
}

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
  const crewAssignment = crypto.randomUUID();
  const mapFile = crypto.randomUUID();
  const mapDocument = crypto.randomUUID();
  const mapVersion = crypto.randomUUID();
  const mapAssignment = crypto.randomUUID();
  const assetObservation = crypto.randomUUID();
  const mapPage = crypto.randomUUID();
  const dailyJsa = crypto.randomUUID();
  const foremanWorker = crypto.randomUUID();
  const report = crypto.randomUUID();
  const revision = crypto.randomUUID();
  const cycle = crypto.randomUUID();
  const fiberProduction = crypto.randomUUID();
  const pendingProduction = crypto.randomUUID();
  const extraProduction = crypto.randomUUID();
  const coilProduction = crypto.randomUUID();
  const fiberDecision = crypto.randomUUID();
  const pendingDecision = crypto.randomUUID();
  const extraDecision = crypto.randomUUID();
  const coilDecision = crypto.randomUUID();
  const coilObservation = crypto.randomUUID();
  const permissions = [
    "billable_item.read", "billable_item.mark_ready", "billing.read", "billing.create_billable", "billing.create_invoice", "billing.issue_invoice", "cash_receipt.record", "payment_application.create",
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
    await client.query("INSERT INTO partner_work_order_crew_assignments (id,tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,status,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [crewAssignment, tenantA, partnerOrg, provider, workOrder, workOrderVersion, crew, internalUser]);
    await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'syncfield_map_original_pdf','syncfield_map_version',$5,'p12-map.pdf','application/pdf',16,'p12-original-map-checksum',$6,$7)", [mapFile, tenantA, partnerOrg, provider, mapVersion, `${tenantA}/${partnerOrg}/p12-map.pdf`, internalUser]);
    await client.query("INSERT INTO syncfield_map_documents (id,tenant_id,project_id,work_order_id,name,customer_document_number,status,created_by_user_id) VALUES ($1,$2,$3,$4,'P12 Map','P12-MAP','active',$5)", [mapDocument, tenantA, project, workOrder, internalUser]);
    await client.query("INSERT INTO syncfield_map_versions (id,tenant_id,map_document_id,revision_number,revision_label,original_filename,original_file_object_id,file_hash,page_count,processing_status,status,uploaded_by_user_id) VALUES ($1,$2,$3,1,'Rev 1','p12-map.pdf',$4,'p12-original-map-checksum',1,'ready','ready',$5)", [mapVersion, tenantA, mapDocument, mapFile, internalUser]);
    await client.query("INSERT INTO syncfield_map_pages (id,tenant_id,map_version_id,page_number,pdf_width,pdf_height) VALUES ($1,$2,$3,1,612,792)", [mapPage, tenantA, mapVersion]);
    await client.query("INSERT INTO syncfield_map_assignments (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_assignment_id,crew_id,foreman_worker_id,map_document_id,map_version_id,assignment_status,assigned_by_user_id,current) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,true)", [mapAssignment, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crewAssignment, crew, foremanWorker, mapDocument, mapVersion, internalUser]);
    await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,map_version_id,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-25',$11,'completed','P12 work area',true,$10,now())", [dailyJsa, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, mapVersion]);
    await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,map_document_id,map_version_id,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-25',$11,$12,$13,'submitted',now(),$10,1,'complete','customer_partially_accepted')", [report, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, mapDocument, mapVersion, dailyJsa]);
    await client.query("INSERT INTO daily_production_report_revisions (id,tenant_id,daily_report_id,revision_number,snapshot_json,reason,submitted_by_user_id) VALUES ($1,$2,$3,1,'{}','submitted',$4)", [revision, tenantA, report, foremanUser]);
    await client.query("INSERT INTO customer_qc_cycles (id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,submitted_to_customer_at,source_reference,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,'partially_accepted',now(),'customer-report',$11)", [cycle, tenantA, project, workOrder, workOrderVersion, report, revision, partnerOrg, crew, customerOrg, internalUser]);
    await insertProduction(client, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, report, fiberProduction, fiberCode, 141);
    await insertProduction(client, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, report, pendingProduction, fiberCode, 12);
    await insertProduction(client, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, report, extraProduction, fiberCode, 10);
    await insertProduction(client, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, report, coilProduction, fiberCode, 3000);
    await client.query("INSERT INTO syncfield_asset_observations (id,tenant_id,organization_id,project_id,work_order_id,assignment_id,crew_id,foreman_worker_id,production_date,map_document_id,map_version_id,map_page_id,asset_identifier,asset_type,pdf_x,pdf_y,input_tick,output_tick,tick_unit,reel_cable_id,fiber_type,status,daily_report_id,submitted_revision_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2026-08-25',$9,$10,$11,'15-12-4','pole',0.5,0.5,14826,14676,'ft','R-327','96CT','submitted',$12,$13,$14)", [assetObservation, tenantA, partnerOrg, project, workOrder, mapAssignment, crew, foremanWorker, mapDocument, mapVersion, mapPage, report, revision, foremanUser]);
    await client.query("INSERT INTO syncfield_coil_observations (id,tenant_id,organization_id,project_id,work_order_id,assignment_id,crew_id,foreman_worker_id,production_date,map_document_id,map_version_id,map_page_id,asset_observation_id,production_record_id,daily_report_id,submitted_revision_id,asset_identifier,easement_type,coil_type,required_length_ft,actual_length_ft,variance_status,rule_source,rule_source_reference,reel_cable_id,fiber_type,status,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2026-08-25',$9,$10,$11,$12,$13,$14,$15,'15-12-4','front','general_slack',540,540,'within_expectation','work_order_rule','Commercial policy test coil','R-327','96CT','submitted',$16)", [coilObservation, tenantA, partnerOrg, project, workOrder, mapAssignment, crew, foremanWorker, mapDocument, mapVersion, mapPage, assetObservation, coilProduction, report, revision, foremanUser]);
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference) VALUES ($1,$2,$3,$4,'accepted',141,141,'feet','customer_acceptance',$5,'customer-report'),($6,$2,$3,$7,'correction_required',12,NULL,'feet','missing_evidence',$5,'customer-report'),($8,$2,$3,$9,'accepted',10,10,'feet','customer_acceptance',$5,'customer-report'),($10,$2,$3,$11,'accepted',3000,3000,'feet','customer_acceptance',$5,'customer-report')", [fiberDecision, tenantA, cycle, fiberProduction, internalUser, pendingDecision, pendingProduction, extraDecision, extraProduction, coilDecision, coilProduction]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { tenantA, tenantB, partnerOrg, customerOrg, fiberDecision, coilDecision, workOrder, pendingDecision, extraDecision, internalToken: token(internalUser, tenantA, secret), partnerToken: token(partnerUser, tenantA, secret), foremanToken: token(foremanUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret) };
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

