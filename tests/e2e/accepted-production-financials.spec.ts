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

  test("production item choices stay tenant-scoped and exclude unauthorized partners", async ({ request }) => {
    const foreignCode = crypto.randomUUID();
    await client.query("INSERT INTO syncfield_production_codes (id,tenant_id,code,description,unit_of_measure,location_type) VALUES ($1,$2,'FOREIGN','Other tenant item','each','daily')", [foreignCode, fixture.tenantB]);
    const choices = await apiJson(request, fixture.internalToken, "GET", "/accepted-production-financials/production-code-choices");
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) expect(Object.keys(choice).sort()).toEqual(["code", "id", "name", "unit"]);
    expect(choices.some((choice: { id: string }) => choice.id === foreignCode)).toBe(false);
    const forbidden = await request.get(apiUrl("/accepted-production-financials/production-code-choices"), { headers: auth(fixture.partnerToken) });
    expect(forbidden.status()).toBe(403);
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
    const invoice=(await client.query('SELECT id FROM invoices WHERE tenant_id=$1 ORDER BY created_at LIMIT 1',[fixture.tenantA])).rows[0];
    await client.query("UPDATE cash_receipts SET cleared_at='2026-08-01T12:00:00Z' WHERE tenant_id=$1",[fixture.tenantA]);
    const stale=await apiJson(request,fixture.internalToken,'GET',`/accepted-production-financials/contractor-payables/${payable.id}/installments`);
    expect(stale.stale).toBe(true);expect(stale.snapshot.installments).toEqual([]);
    const second=await apiJson(request,fixture.internalToken,'POST','/accepted-production-financials/cash-receipts',{customer_organization_id:fixture.customerOrg,amount:66.27,payment_reference:'P12-CASH-2',idempotency_key:'p12-cash-2'});
    await apiJson(request,fixture.internalToken,'POST',`/accepted-production-financials/cash-receipts/${second.id}/clear`);
    await client.query("UPDATE cash_receipts SET cleared_at='2026-08-10T12:00:00Z' WHERE id=$1",[second.id]);
    await apiJson(request,fixture.internalToken,'POST','/accepted-production-financials/payment-applications',{cash_receipt_id:second.id,invoice_id:invoice.id,amount:66.27});
    await apiJson(request,fixture.internalToken,'POST',`/accepted-production-financials/contractor-payables/${payable.id}/calculate-eligibility`);
    const schedule=await apiJson(request,fixture.internalToken,'GET',`/accepted-production-financials/contractor-payables/${payable.id}/installments`);
    expect(schedule.stale).toBe(false);
    expect(schedule.snapshot.installments.map((row:any)=>[row.amount,row.due_date])).toEqual([[49.35,'2026-08-15'],[49.35,'2026-08-24']]);
    expect((await request.get(apiUrl(`/accepted-production-financials/contractor-payables/${payable.id}/installments`),{headers:auth(fixture.foremanToken)})).status()).toBe(403);

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

  test("Customer and Partner coil commercial policies are independent and preserve base accepted quantity", async ({ request }) => {
    const customerPolicy = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/coil-policies", {
      work_order_id: fixture.workOrder,
      party_type: "CUSTOMER",
      counterparty_organization_id: fixture.customerOrg,
      coil_type: "GENERAL_SLACK",
      treatment: "BILLABLE_AS_FOOTAGE",
      effective_from: "2026-08-01",
      source_type: "CUSTOMER_RATE_SHEET",
      source_reference: "Customer Rate Sheet Rev 3",
    });
    const partnerPolicy = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/coil-policies", {
      work_order_id: fixture.workOrder,
      party_type: "PARTNER",
      counterparty_organization_id: fixture.partnerOrg,
      coil_type: "GENERAL_SLACK",
      treatment: "INCLUDED_IN_ROUTE_RATE",
      effective_from: "2026-08-01",
      source_type: "PARTNER_RATE_SHEET",
      source_reference: "Partner Rate Sheet Rev 1",
    });
    expect(customerPolicy.treatment).toBe("billable_as_footage");
    expect(partnerPolicy.treatment).toBe("included_in_route_rate");

    await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/billables/convert", { customer_qc_decision_id: fixture.coilDecision });
    const billables = await client.query("SELECT billable_quantity, net_billable_amount, accepted_production_source_id FROM billable_items WHERE tenant_id = $1 AND customer_qc_decision_id = $2 AND deleted_at IS NULL ORDER BY billable_quantity", [fixture.tenantA, fixture.coilDecision]);
    expect(billables.rows.map((row) => Number(row.billable_quantity)).sort((a, b) => a - b)).toEqual([540, 3000]);
    expect(billables.rows.reduce((sum, row) => sum + Number(row.net_billable_amount), 0)).toBeCloseTo(3327.6, 2);

    const base = await client.query("SELECT accepted_quantity FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2 AND source_kind = 'accepted_production'", [fixture.tenantA, fixture.coilDecision]);
    expect(Number(base.rows[0].accepted_quantity)).toBe(3000);
    const coilSource = await client.query("SELECT accepted_quantity, commercial_treatment, customer_coil_policy_id, partner_coil_policy_id FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2 AND source_kind = 'customer_coil_supplement'", [fixture.tenantA, fixture.coilDecision]);
    expect(Number(coilSource.rows[0].accepted_quantity)).toBe(540);
    expect(coilSource.rows[0].commercial_treatment).toBe("billable_as_footage");
    expect(coilSource.rows[0].customer_coil_policy_id).toBe(customerPolicy.id);
    expect(coilSource.rows[0].partner_coil_policy_id).toBeNull();

    const settlement = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/partner-settlements/create", { period_start: "2026-08-24", period_end: "2026-08-30" });
    expect(Number(settlement.net_settlement_amount)).toBe(2100);
    const settlementItems = await client.query("SELECT quantity, accepted_production_source_id FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND deleted_at IS NULL", [fixture.tenantA, settlement.id]);
    expect(settlementItems.rows.map((row) => Number(row.quantity))).toEqual([3000]);
    const partnerCoilSource = await client.query("SELECT count(*)::int AS count FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2 AND source_kind = 'partner_coil_supplement'", [fixture.tenantA, fixture.coilDecision]);
    expect(partnerCoilSource.rows[0].count).toBe(0);
  });

  test("Editing a schedule cannot change an already approved partner rate", async ({ request }) => {
    await client.query("UPDATE rate_codes SET contractor_rate = NULL WHERE tenant_id = $1 AND code = 'FIBER'", [fixture.tenantA]);
    await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/billables/convert", { customer_qc_decision_id: fixture.extraDecision });
    const source = await client.query("SELECT id FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2", [fixture.tenantA, fixture.extraDecision]);
    const response = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/partner-settlements/create", { accepted_production_source_ids: [source.rows[0].id] });
    expect(response.id).toBeTruthy();
    const locked=await client.query("SELECT partner_rate FROM accepted_production_financial_sources WHERE id=$1",[source.rows[0].id]);
    expect(Number(locked.rows[0].partner_rate)).toBe(0.70);
  });

  test("Post-billing Customer QC change creates exception without rewriting issued invoice or Billable", async ({ request }) => {
    const source = await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2", [fixture.tenantA, fixture.fiberDecision]);
    const beforeInvoice = await client.query("SELECT original_amount,balance_amount FROM invoices WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [fixture.tenantA]);
    const newDecision = crypto.randomUUID();
    await client.query("UPDATE customer_qc_decisions SET current = false WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.fiberDecision]);
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference,current) VALUES ($1,$2,$3,$4,'partially_accepted',141,132,'feet','customer_revision',$5,'corrected-source',true)", [newDecision, fixture.tenantA, source.rows[0].customer_qc_cycle_id, source.rows[0].production_record_id, source.rows[0].created_by_user_id]);
    const exception = await apiJson(request, fixture.internalToken, "POST", "/accepted-production-financials/detect-qc-change", { accepted_production_source_id: source.rows[0].id });
    expect(exception.exception_type).toBe("post_billing_customer_qc_change");
    await client.query('UPDATE customer_qc_decisions n SET accepted_quantity_review_id=o.accepted_quantity_review_id,accepted_quantity_fingerprint=o.accepted_quantity_fingerprint FROM customer_qc_decisions o WHERE n.id=$1 AND o.id=$2',[newDecision,fixture.fiberDecision]);
    const duplicate = await request.post(apiUrl('/accepted-production-financials/billables/convert'), { headers: auth(fixture.internalToken), data: { customer_qc_decision_id: newDecision } });
    expect(duplicate.status()).toBe(400);
    expect(await duplicate.text()).toContain('controlled financial adjustments');

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
    "contractor_payable.calculate_eligibility", "contractor_payable.read", "contract.read", "contract.update", "financial_exception.read", "partner_context.read",
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
    // Synthetic verified agreement evidence for the financial lineage gate.
    const agreementFile = crypto.randomUUID();
    await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'partner_msa_executed','partner_agreement_version',$5,'synthetic-agreement.pdf','application/pdf',16,'synthetic-agreement-checksum',$6,$7)", [agreementFile,tenantA,partnerOrg,provider,agreementVersion,`${tenantA}/${partnerOrg}/${agreementFile}.pdf`,internalUser]);
    await client.query("UPDATE partner_agreement_versions SET executed_at='2026-08-01',artifact_file_object_id=$3,artifact_verified_at='2026-08-01',artifact_verified_by_user_id=$4 WHERE tenant_id=$1 AND id=$2",[tenantA,agreementVersion,agreementFile,internalUser]);
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
  await prepareSyntheticCommercialFixture(client,tenantA,internalUser);
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

test('a newer pending customer QC cycle blocks readiness using an older accepted decision', async ({ request }) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const fixture = await seedP12Fixture(client, process.env.AUTH_JWT_SECRET!);
    const billable = await apiJson(request, fixture.internalToken, 'POST', '/accepted-production-financials/billables/convert', { customer_qc_decision_id: fixture.fiberDecision });
    const detail = await apiJson(request, fixture.internalToken, 'GET', `/billable-items/${billable.id}/detail`);
    expect(detail.billable_item.id).toBe(billable.id);
    expect(detail.qc_context).toBeNull();
    expect(detail.blockers).toEqual([]);
    const ready = await apiJson(request, fixture.internalToken, 'POST', `/billable-items/${billable.id}/mark-ready-for-settlement`, { approval_note: 'Customer-accepted source is ready without internal QC' });
    expect(ready.billable_item.status).toBe('ready_for_settlement');


    await client.query(`INSERT INTO customer_qc_cycles
      (tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,source_reference,created_by_user_id)
      SELECT c.tenant_id,c.project_id,c.work_order_id,c.work_order_version_id,c.daily_report_id,c.daily_report_revision_id,c.partner_organization_id,c.crew_id,c.qc_authority_organization_id,c.cycle_number+1,'awaiting_customer','new pending review',c.created_by_user_id
      FROM customer_qc_cycles c JOIN customer_qc_decisions d ON d.tenant_id=c.tenant_id AND d.qc_cycle_id=c.id
      WHERE d.tenant_id=$1 AND d.id=$2`, [fixture.tenantA, fixture.fiberDecision]);
    const response = await request.post(apiUrl(`/billable-items/${billable.id}/mark-ready-for-settlement`), { headers: auth(fixture.internalToken), data: { approval_note: 'Cannot reuse acceptance from an older cycle' } });
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('Current customer acceptance is required');
    const invoice = await request.post(apiUrl('/accepted-production-financials/invoices/create'), { headers: auth(fixture.internalToken), data: { billable_item_ids: [billable.id] } });
    expect(invoice.status()).toBe(400);
    expect(await invoice.text()).toContain('Current customer acceptance is required');
    const invoiceCount = await client.query('SELECT count(*)::int AS count FROM invoices WHERE tenant_id=$1', [fixture.tenantA]);
    expect(invoiceCount.rows[0].count).toBe(0);

    const stored = await client.query('SELECT customer_qc_decision_id FROM billable_items WHERE tenant_id=$1 AND id=$2', [fixture.tenantA,billable.id]);
    expect(stored.rows[0].customer_qc_decision_id).toBe(fixture.fiberDecision);
  } finally { await client.end(); }
});

test.describe('Financial handoff completion safeguards', () => {
 let client: Client;
 test.beforeAll(async()=>{client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();});
 test.afterAll(async()=>{await client?.end();});
 test('workflow choices are tenant-scoped; cash retry and duplicate settlement cannot double financial facts',async({request})=>{
  const f=await seedP12Fixture(client,process.env.AUTH_JWT_SECRET!);
  const billable=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/billables/convert',{customer_qc_decision_id:f.fiberDecision});
  const choices=await apiJson(request,f.internalToken,'GET','/accepted-production-financials/workflow-choices');
  expect(choices.billables.some((r:any)=>r.id===billable.id&&r.label.includes('P12 Customer'))).toBe(true);
  for(const bearer of [f.partnerToken,f.foremanToken,f.tenantBToken])expect((await request.get(apiUrl('/accepted-production-financials/workflow-choices'),{headers:auth(bearer)})).status()).toBe(403);
  const invoice=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/invoices/create',{billable_item_ids:[billable.id]});
  const receipt=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/cash-receipts',{customer_organization_id:f.customerOrg,amount:100,idempotency_key:crypto.randomUUID()});
  await apiJson(request,f.internalToken,'POST',`/accepted-production-financials/cash-receipts/${receipt.id}/clear`,{});
  const body={cash_receipt_id:receipt.id,invoice_id:invoice.id,amount:40,idempotency_key:crypto.randomUUID()};
  const attempts=await Promise.all([1,2].map(()=>request.post(apiUrl('/accepted-production-financials/payment-applications'),{headers:auth(f.internalToken),data:body})));
  expect(attempts.map(r=>r.status())).toEqual([201,201]);const first=await attempts[0].json();expect((await attempts[1].json()).id).toBe(first.id);
  const balance=await client.query('SELECT paid_amount FROM invoices WHERE tenant_id=$1 AND id=$2',[f.tenantA,invoice.id]);expect(Number(balance.rows[0].paid_amount)).toBe(40);
  expect((await request.post(apiUrl('/accepted-production-financials/payment-applications'),{headers:auth(f.internalToken),data:{...body,amount:41}})).status()).toBe(400);
  const source=choices.sources.find((r:any)=>r.id===billable.accepted_production_source_id);
  const settlementBody={accepted_production_source_ids:[source.id]};
  const settlements=await Promise.all([1,2].map(()=>request.post(apiUrl('/accepted-production-financials/partner-settlements/create'),{headers:auth(f.internalToken),data:settlementBody})));
  expect(settlements.map(r=>r.status()).sort()).toEqual([201,400]);
  const count=await client.query('SELECT count(*)::int AS n FROM settlement_items WHERE tenant_id=$1 AND accepted_production_source_id=$2',[f.tenantA,source.id]);expect(count.rows[0].n).toBe(1);
 });
 test('accepted correction production code controls locked customer rate, preserving original record',async({request})=>{
  const f=await seedP12Fixture(client,process.env.AUTH_JWT_SECRET!);
  const context=(await client.query('SELECT cqd.production_record_id,cqd.qc_cycle_id,cqc.daily_report_id,wo.customer_rate_schedule_id FROM customer_qc_decisions cqd JOIN customer_qc_cycles cqc ON cqc.id=cqd.qc_cycle_id JOIN work_orders wo ON wo.id=cqc.work_order_id WHERE cqd.tenant_id=$1 AND cqd.id=$2',[f.tenantA,f.fiberDecision])).rows[0];
  const code=crypto.randomUUID(), revision=crypto.randomUUID();
  await client.query("INSERT INTO syncfield_production_codes(id,tenant_id,code,description,unit_of_measure,location_type) VALUES($1,$2,'FIBER-CORRECTED','Corrected placement','feet','route')",[code,f.tenantA]);
  await client.query("INSERT INTO rate_codes(tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,customer_rate,status) VALUES($1,$2,'FIBER-CORRECTED','Corrected placement','feet','feet',2,2,'active')",[f.tenantA,context.customer_rate_schedule_id]);
  await client.query("INSERT INTO daily_production_report_revisions(id,tenant_id,daily_report_id,revision_number,snapshot_json,reason) VALUES($1,$2,$3,2,$4,'correction_submitted')",[revision,f.tenantA,context.daily_report_id,JSON.stringify({original_production_record_id:context.production_record_id,proposed_correction:{production_code_id:code}})]);
  // A subsequent correction to another record must retain this record's accepted code lineage.
  const third=crypto.randomUUID();await client.query("INSERT INTO daily_production_report_revisions(id,tenant_id,daily_report_id,revision_number,snapshot_json,reason) VALUES($1,$2,$3,3,$4,'correction_submitted')",[third,f.tenantA,context.daily_report_id,JSON.stringify({original_production_record_id:crypto.randomUUID(),proposed_correction:{production_code_id:code}})]);
  await client.query('UPDATE customer_qc_cycles SET daily_report_revision_id=$1 WHERE tenant_id=$2 AND id=$3',[third,f.tenantA,context.qc_cycle_id]);
  const unapproved=await request.post(apiUrl('/accepted-production-financials/billables/convert'),{headers:auth(f.internalToken),data:{customer_qc_decision_id:f.fiberDecision}});expect(unapproved.status()).toBe(400);
  const actor=(await client.query('SELECT recorded_by_user_id FROM customer_qc_decisions WHERE id=$1',[f.fiberDecision])).rows[0].recorded_by_user_id;
  await prepareSyntheticCommercialFixture(client,f.tenantA,actor);
  const billable=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/billables/convert',{customer_qc_decision_id:f.fiberDecision});expect(Number(billable.customer_rate_locked)).toBe(2);expect(Number(billable.net_billable_amount)).toBe(282);
  const original=(await client.query('SELECT syncfield_production_code_id FROM production_records WHERE id=$1',[context.production_record_id])).rows[0];expect(original.syncfield_production_code_id).not.toBe(code);
 });
});

test('targeted reinspection retains unrelated accepted production while unresolved corrected work stays blocked',async({request})=>{
 const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try {
  const f=await seedP12Fixture(client,process.env.AUTH_JWT_SECRET!);
  const context=(await client.query(`SELECT c.*,d.production_record_id FROM customer_qc_cycles c JOIN customer_qc_decisions d ON d.tenant_id=c.tenant_id AND d.qc_cycle_id=c.id WHERE d.tenant_id=$1 AND d.id=$2`,[f.tenantA,f.extraDecision])).rows[0];
  const correction=crypto.randomUUID(),revision=crypto.randomUUID(),cycle=crypto.randomUUID();
  await client.query(`INSERT INTO production_corrections(id,tenant_id,qc_cycle_id,customer_qc_decision_id,daily_report_id,production_record_id,partner_organization_id,crew_id,correction_type,customer_reason,partner_safe_instructions,status,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'quantity','Recheck selected line','Recheck selected line','awaiting_customer_reinspection',$9)`,[correction,f.tenantA,context.id,f.extraDecision,context.daily_report_id,context.production_record_id,context.partner_organization_id,context.crew_id,context.created_by_user_id]);
  await client.query(`INSERT INTO daily_production_report_revisions(id,tenant_id,daily_report_id,revision_number,snapshot_json,reason) VALUES($1,$2,$3,2,$4,'customer_correction_resubmitted')`,[revision,f.tenantA,context.daily_report_id,JSON.stringify({original_production_record_id:context.production_record_id,correction:{id:correction},proposed_correction:{reported_quantity:8}})]);
  await client.query(`INSERT INTO customer_qc_cycles(id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,source_reference,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,3,'awaiting_reinspection','Targeted correction',$11)`,[cycle,f.tenantA,context.project_id,context.work_order_id,context.work_order_version_id,context.daily_report_id,revision,context.partner_organization_id,context.crew_id,context.qc_authority_organization_id,context.created_by_user_id]);
  const queue=await apiJson(request,f.internalToken,'GET','/accepted-production-financials/billable-queue');expect(queue.some((r:any)=>r.customer_qc_decision_id===f.fiberDecision)).toBe(true);expect(queue.some((r:any)=>r.customer_qc_decision_id===f.extraDecision)).toBe(false);
  const unchanged=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/billables/convert',{customer_qc_decision_id:f.fiberDecision});
  const invoice=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/invoices/create',{billable_item_ids:[unchanged.id]});expect(Number(invoice.original_amount)).toBe(132.54);
  // An accepted decision alone cannot bypass an outstanding correction that has not been resolved.
  const unsafeDecision=crypto.randomUUID();await client.query(`INSERT INTO customer_qc_decisions(id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,recorded_by_user_id,source_reference) VALUES($1,$2,$3,$4,'accepted',8,8,'feet',$5,'unresolved correction test')`,[unsafeDecision,f.tenantA,cycle,context.production_record_id,context.created_by_user_id]);
  const blocked=await request.post(apiUrl('/accepted-production-financials/billables/convert'),{headers:auth(f.internalToken),data:{customer_qc_decision_id:unsafeDecision}});expect(blocked.status()).toBe(404);
  const old=(await client.query('SELECT current FROM customer_qc_decisions WHERE tenant_id=$1 AND id=$2',[f.tenantA,f.fiberDecision])).rows[0];expect(old.current).toBe(true);
 } finally {await client.end();}
});

async function prepareSyntheticCommercialFixture(db:Client,tenant:string,actor:string){
 const u=new URL(process.env.DATABASE_URL!);if(!['localhost','127.0.0.1'].includes(u.hostname)||/staging|production/i.test(u.pathname))throw new Error('Synthetic fixture preparation is local-only');
 const {productionQuantitySource,productionQuantityFingerprint}=require('../../apps/api/dist/routes/production-quantity-integrity');
 const {approvedRateSnapshot}=require('../../apps/api/dist/routes/commercial-terms');
 for(const row of (await db.query('SELECT id FROM production_records WHERE tenant_id=$1',[tenant])).rows){
  const source=await productionQuantitySource(db,tenant,row.id),fingerprint=productionQuantityFingerprint(source),ref='synthetic-p12-'+row.id;
  await db.query('INSERT INTO production_work_item_registry(tenant_id,work_order_id,canonical_reference,production_record_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[tenant,source.work_order_id,ref,row.id]);
  const review=(await db.query("INSERT INTO production_quantity_reviews(tenant_id,production_record_id,disposition,canonical_reference,source_fingerprint,source_reference,review_notes,reviewed_by,client_mutation_id) VALUES($1,$2,'primary_work',$3,$4,'SYNTHETIC local fixture','Synthetic reviewed quantity',$5,$6) RETURNING id",[tenant,row.id,ref,fingerprint,actor,crypto.randomUUID()])).rows[0];
  await db.query('UPDATE production_records SET quantity_review_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,row.id,review.id]);
  await db.query('UPDATE customer_qc_decisions SET accepted_quantity_review_id=$3,accepted_quantity_fingerprint=$4 WHERE tenant_id=$1 AND production_record_id=$2',[tenant,row.id,review.id,fingerprint]);
 }
 for(const schedule of (await db.query('SELECT * FROM rate_schedules WHERE tenant_id=$1',[tenant])).rows){
  let agreement=(await db.query('SELECT id FROM contracts WHERE tenant_id=$1 AND organization_id=$2 LIMIT 1',[tenant,schedule.organization_id])).rows[0]?.id;
  const party=schedule.name==='P12 Partner Rates'?'partner':'customer';
  if(!agreement)agreement=(await db.query("INSERT INTO contracts(tenant_id,organization_id,name,status) VALUES($1,$2,'SYNTHETIC P12 commercial agreement','active') RETURNING id",[tenant,schedule.organization_id])).rows[0].id;
  await db.query('UPDATE rate_schedules SET contract_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,schedule.id,agreement]);
  const rates=(await db.query("SELECT * FROM rate_codes WHERE tenant_id=$1 AND rate_schedule_id=$2 AND status='active' AND deleted_at IS NULL",[tenant,schedule.id])).rows;
  const n=(await db.query('SELECT coalesce(max(revision_number),0)+1 AS n FROM commercial_terms_revisions WHERE tenant_id=$1 AND rate_schedule_id=$2 AND party_type=$3',[tenant,schedule.id,party])).rows[0].n;
  await db.query("INSERT INTO commercial_terms_revisions(tenant_id,contract_id,rate_schedule_id,counterparty_organization_id,party_type,revision_number,effective_from,payment_trigger,payment_days,time_zone,retainage_percent,rate_snapshot,source_reference,approved_by,client_mutation_id) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01',$7,14,'America/New_York',0,$8::jsonb,'SYNTHETIC approved pricing',$9,$10)",[tenant,agreement,schedule.id,schedule.organization_id,party,n,party==='partner'?'customer_payment':'invoice_acceptance',JSON.stringify(approvedRateSnapshot(rates,party)),actor,crypto.randomUUID()]);
 }
}


test('four-decimal approved rates survive conversion and invoice storage without early rounding',async({request})=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const f=await seedP12Fixture(db,process.env.AUTH_JWT_SECRET!);
  await db.query("UPDATE rate_codes SET customer_rate=0.6435,amount=0.6435 WHERE tenant_id=$1",[f.tenantA]);
  const actor=(await db.query('SELECT recorded_by_user_id FROM customer_qc_decisions WHERE id=$1',[f.fiberDecision])).rows[0].recorded_by_user_id;
  await prepareSyntheticCommercialFixture(db,f.tenantA,actor);
  const billable=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/billables/convert',{customer_qc_decision_id:f.fiberDecision});
  expect(Number(billable.customer_rate_locked)).toBe(0.6435);
  expect(Number(billable.net_billable_amount)).toBe(90.73);
  const invoice=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/invoices/create',{retainage_percent:0});
  expect(Number(invoice.total_amount)).toBe(90.73);
  const line=(await db.query('SELECT unit_rate,gross_amount FROM invoice_items WHERE invoice_id=$1',[invoice.id])).rows[0];
  expect(Number(line.unit_rate)).toBe(0.6435);expect(Number(line.gross_amount)).toBe(90.73);
 }finally{await db.end();}
});


test('agreement UI approves a reviewed business calendar and shows its history',async({page})=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const f=await seedP12Fixture(db,process.env.AUTH_JWT_SECRET!);
  const schedule=(await db.query("SELECT id FROM rate_schedules WHERE tenant_id=$1 AND name='P12 Customer Rates'",[f.tenantA])).rows[0];
  await page.addInitScript(token=>localStorage.setItem('syncos.apiToken',token),f.internalToken);
  await page.goto('/accepted-production-financials');
  await page.getByLabel('Agreement rate schedule').selectOption(schedule.id);
  await page.getByLabel('Payment clock starts at').selectOption('invoice_acceptance');
  await page.getByLabel('Days after trigger',{exact:true}).fill('2');
  await page.getByLabel('Day calculation').selectOption('business_days');
  await page.getByLabel('Approved holidays').fill('2026-10-12');
  await page.getByLabel('Holiday calendar verified through').fill('2026-12-31');
  await page.getByLabel('Retainage percent',{exact:true}).fill('10');
  await page.getByLabel('Work effective from').fill('2026-01-01');
  await page.getByLabel('Agreement time zone').fill('America/New_York');
  await page.getByLabel('Executed agreement and pricing source').fill('SYNTHETIC reviewed UI agreement');
  await page.getByLabel('I verified these terms and rates').check();
  await page.getByRole('button',{name:'Approve agreement revision',exact:true}).click();
  await expect(page.getByText('Agreement revision approved.',{exact:false})).toBeVisible();
  const saved=(await db.query('SELECT payment_day_basis,holidays,holiday_calendar_through FROM commercial_terms_revisions WHERE tenant_id=$1 ORDER BY approved_at DESC LIMIT 1',[f.tenantA])).rows[0];
  expect(saved.payment_day_basis).toBe('business_days');expect(saved.holidays).toEqual(['2026-10-12']);
 }finally{await db.end();}
});

test('prepared customer receipts post once, retain partial balances and send overpayments and reversals to review',async({request})=>{
 const {Pool}=require('pg'),{PreparedPaymentPosting}=require('../../apps/api/dist/routes/prepared-payment-posting');
 const db=new Client({connectionString:process.env.DATABASE_URL}),pool=new Pool({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const f=await seedP12Fixture(db,process.env.AUTH_JWT_SECRET!),actor=JSON.parse(Buffer.from(f.internalToken.split('.')[1],'base64url').toString()).sub;
  const billable=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/billables/convert',{customer_qc_decision_id:f.fiberDecision});
  const invoice=await apiJson(request,f.internalToken,'POST','/accepted-production-financials/invoices/create',{billable_item_ids:[billable.id]});
  const customer='SYNTHETIC-'+crypto.randomUUID(),connection=(await db.query("INSERT INTO passport_connections(tenant_id,customer_reference,account_reference,created_by) VALUES($1,$2,'ACCOUNT',$3) RETURNING id",[f.tenantA,customer,actor])).rows[0].id;
  const req={auth:{tenantId:f.tenantA,userId:actor}},engine=new PreparedPaymentPosting(pool),tx={customerId:customer,accountId:'ACCOUNT',transactionId:'RECEIPT-1',payerId:'PRIME',direction:'incoming',currency:'USD',amount:'30.00',status:'completed',completedDate:'2026-09-01',version:1};
  expect((await engine.rehearse(req,connection,tx)).reason).toBe('unmatched_receipt');
  for(const [ref,amount] of [['RECEIPT-1','30.00'],['TOO-MUCH','10000.00'],['RECEIPT-2','102.54']])await db.query("INSERT INTO passport_receivable_mappings(tenant_id,connection_id,transaction_reference,payer_reference,invoice_id,amount,currency,evidence_reference,approved_by) VALUES($1,$2,$3,'PRIME',$4,$5,'USD','SYNTHETIC approved incoming allocation',$6)",[f.tenantA,connection,ref,invoice.id,amount,actor]);
  expect((await engine.rehearse(req,connection,tx)).reason).toBe('receivable_controls_require_review');
  expect((await db.query('SELECT count(*)::int n FROM cash_receipts WHERE tenant_id=$1',[f.tenantA])).rows[0].n).toBe(0);
  // Isolated fixture represents the separately approved package/receivable state, not real customer acceptance.
  await db.query("UPDATE invoices SET cash_application_status='ready_for_cash_application',customer_acceptance_status='accepted',contract_trigger_at='2026-08-25',due_date='2026-09-08' WHERE tenant_id=$1 AND id=$2",[f.tenantA,invoice.id]);
  const results=await Promise.all([engine.rehearse(req,connection,tx),engine.rehearse(req,connection,tx)]);expect(results.map((r:any)=>r.outcome).sort()).toEqual(['duplicate','recorded']);
  expect((await db.query('SELECT paid_amount,balance_amount FROM invoices WHERE id=$1',[invoice.id])).rows[0]).toEqual({paid_amount:'30.00',balance_amount:'102.54'});
  expect((await engine.rehearse(req,connection,{...tx,transactionId:'TOO-MUCH',amount:'10000.00'})).reason).toBe('receivable_controls_require_review');
  expect((await db.query('SELECT count(*)::int n FROM cash_receipts WHERE tenant_id=$1',[f.tenantA])).rows[0].n).toBe(1);
  expect((await engine.rehearse(req,connection,{...tx,version:2,status:'reversed'})).reason).toBe('recorded_receipt_return_or_reversal');
  expect((await engine.rehearse(req,connection,{...tx,transactionId:'RECEIPT-2',amount:'102.54'})).outcome).toBe('recorded');
  expect((await db.query('SELECT paid_amount,balance_amount FROM invoices WHERE id=$1',[invoice.id])).rows[0]).toEqual({paid_amount:'132.54',balance_amount:'0.00'});
  expect((await db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='payment_application.create' AND entity_type='payment_application'",[f.tenantA])).rows[0].n).toBe(2);
  expect((await db.query('SELECT count(*)::int n FROM external_partner_payments WHERE tenant_id=$1',[f.tenantA])).rows[0].n).toBe(0);
  await expect(engine.rehearse({auth:{tenantId:f.tenantB,userId:actor}},connection,tx)).rejects.toThrow('Provider account');
 }finally{await db.end();await pool.end();}
});
