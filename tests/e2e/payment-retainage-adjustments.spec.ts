import {pinSyntheticPaymentProvenance} from './helpers/financial-fixture-provenance';
import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client, Pool } from "pg";
const {AcceptedProductionFinancialsController}=require("../../apps/api/dist/routes/accepted-production-financials.controller");

type Fixture = {
  tenantA: string;
  tenantB: string;
  partnerOrg: string;
  payableId: string;
  retainagePayableId: string;
  acceptedSourceId: string;
  invoiceId: string;
  internalToken: string;
  partnerToken: string;
  foremanToken: string;
  tenantBToken: string;
};

test.describe.serial("P13 payment, retainage, and controlled financial adjustments", () => {
  let client: Client;
  let fixture: Fixture;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedP13Fixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("eligible Contractor Payable creates, submits, and confirms one Partner payment instruction", async ({ request }) => {
    const ready = await apiJson(request, fixture.internalToken, "GET", "/payment-retainage-adjustments/ready-to-pay");
    expect(ready.some((row: Record<string, unknown>) => row.id === fixture.payableId)).toBe(true);

    const created = await apiJson(request, fixture.internalToken, "POST", "/payment-retainage-adjustments/payment-instructions", {
      contractor_payable_id: fixture.payableId,
      amount: 49.35,
      idempotency_key: "p13-payment-create-1",
    });
    const retryCreate = await apiJson(request, fixture.internalToken, "POST", "/payment-retainage-adjustments/payment-instructions", {
      contractor_payable_id: fixture.payableId,
      amount: 49.35,
      idempotency_key: "p13-payment-create-1",
    });
    expect(retryCreate.id).toBe(created.id);

    const submitted = await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/submit`, { idempotency_key: "p13-payment-submit-1" });
    expect(submitted.status).toBe("processing");
    const submittedPayable = await client.query("SELECT paid_amount,in_flight_payment_amount FROM contractor_payables WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.payableId]);
    expect(Number(submittedPayable.rows[0].paid_amount)).toBe(0);
    expect(Number(submittedPayable.rows[0].in_flight_payment_amount)).toBe(49.35);

    await client.query("UPDATE cash_receipts SET cleared_at=cleared_at+interval '1 day' WHERE tenant_id=$1",[fixture.tenantA]);
    const stale=await request.post(apiUrl(`/payment-retainage-adjustments/payment-instructions/${created.id}/confirm`),{headers:auth(fixture.internalToken),data:{}});
    expect(stale.status()).toBe(400);expect((await stale.json()).message).toContain('stale');
    await apiJson(request,fixture.internalToken,'POST',`/accepted-production-financials/contractor-payables/${fixture.payableId}/calculate-eligibility`,{});
    const confirmed = await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/confirm`, {});
    expect(confirmed.status).toBe("confirmed");
    const confirmedPayable = await client.query("SELECT paid_amount,in_flight_payment_amount,payment_status FROM contractor_payables WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.payableId]);
    expect(Number(confirmedPayable.rows[0].paid_amount)).toBe(49.35);
    expect(Number(confirmedPayable.rows[0].in_flight_payment_amount)).toBe(0);
    expect(confirmedPayable.rows[0].payment_status).toBe("partially_paid_later");

    await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/confirm`, {});
    const paymentCount = await client.query("SELECT count(*)::int AS count FROM payments WHERE tenant_id = $1 AND settlement_id IS NOT NULL", [fixture.tenantA]);
    expect(paymentCount.rows[0].count).toBe(1);
    const attempts = await client.query("SELECT provider_name FROM partner_payment_attempts WHERE tenant_id = $1", [fixture.tenantA]);
    expect(attempts.rows.every((row) => row.provider_name === "local_test_provider")).toBe(true);
  });

  test("failed provider attempt preserves history and releases in-flight amount for retry", async ({ request }) => {
    const created = await apiJson(request, fixture.internalToken, "POST", "/payment-retainage-adjustments/payment-instructions", {
      contractor_payable_id: fixture.payableId,
      amount: 10,
      idempotency_key: "p13-payment-create-fail",
    });
    await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/submit`, { idempotency_key: "p13-payment-submit-fail-1" });
    const failed = await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/fail`, { failure_reason_safe: "test provider rejected" });
    expect(failed.status).toBe("failed");
    const payable = await client.query("SELECT paid_amount,in_flight_payment_amount FROM contractor_payables WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.payableId]);
    expect(Number(payable.rows[0].paid_amount)).toBe(49.35);
    expect(Number(payable.rows[0].in_flight_payment_amount)).toBe(0);
    const retry = await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/submit`, { idempotency_key: "p13-payment-submit-fail-2" });
    expect(retry.status).toBe("processing");
    const attemptCount = await client.query("SELECT count(*)::int AS count FROM partner_payment_attempts WHERE tenant_id = $1 AND payment_instruction_id = $2", [fixture.tenantA, created.id]);
    expect(attemptCount.rows[0].count).toBe(2);
  });

  test("retainage release creates separate payable and preserves original retained history", async ({ request }) => {
    const release = await apiJson(request, fixture.internalToken, "POST", "/payment-retainage-adjustments/retainage-releases", {
      contractor_payable_id: fixture.retainagePayableId,
      release_amount: 350,
      release_reason: "authorized closeout release",
      source_reference: "customer-retainage-release-1",
      idempotency_key: "p13-retainage-release-1",
    });
    const authorized = await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/retainage-releases/${release.id}/authorize`, {});
    expect(authorized.status).toBe("released_to_payable");
    expect(authorized.release_payable_id).toBeTruthy();

    const original = await client.query("SELECT retainage_amount,retained_balance_amount FROM contractor_payables WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.retainagePayableId]);
    expect(Number(original.rows[0].retainage_amount)).toBe(700);
    expect(Number(original.rows[0].retained_balance_amount)).toBe(350);
    const releasePayable = await client.query("SELECT payable_type,net_payable_amount,pay_when_paid_status FROM contractor_payables WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, authorized.release_payable_id]);
    expect(releasePayable.rows[0].payable_type).toBe("retainage_release");
    expect(Number(releasePayable.rows[0].net_payable_amount)).toBe(350);
    expect(releasePayable.rows[0].pay_when_paid_status).toBe("eligible");
  });

  test("controlled adjustment preserves issued invoice and Partner payment view remains scoped and redacted", async ({ request }) => {
    const beforeInvoice = await client.query("SELECT original_amount,balance_amount FROM invoices WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.invoiceId]);
    await client.query("UPDATE customer_qc_decisions SET current = false WHERE tenant_id = $1 AND id = (SELECT customer_qc_decision_id FROM accepted_production_financial_sources WHERE tenant_id = $1 AND id = $2)", [fixture.tenantA, fixture.acceptedSourceId]);
    const source = await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.acceptedSourceId]);
    await client.query("INSERT INTO customer_qc_decisions (tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference,current) VALUES ($1,$2,$3,'partially_accepted',141,132,'feet','customer_revision',$4,'corrected-source',true)", [fixture.tenantA, source.rows[0].customer_qc_cycle_id, source.rows[0].production_record_id, source.rows[0].created_by_user_id]);

    const adjustment = await apiJson(request, fixture.internalToken, "POST", "/payment-retainage-adjustments/financial-adjustments/credit-rebill", {
      accepted_production_source_id: fixture.acceptedSourceId,
      contractor_payable_id: fixture.payableId,
      reason: "Customer corrected accepted footage",
      source_reference: "customer-correction-p13",
      idempotency_key: "p13-adjustment-1",
    });
    expect(Number(adjustment.adjustment_amount)).toBe(8.46);
    expect(adjustment.status).toBe("review_required");
    const afterInvoice = await client.query("SELECT original_amount,balance_amount FROM invoices WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.invoiceId]);
    expect(afterInvoice.rows[0]).toEqual(beforeInvoice.rows[0]);

    const partner = await apiJson(request, fixture.partnerToken, "GET", "/payment-retainage-adjustments/partner/payments");
    expect(JSON.stringify(partner)).not.toMatch(/customer_rate|margin|bank|routing|provider_secret/i);
    const foreman = await request.get(apiUrl("/payment-retainage-adjustments/partner/payments"), { headers: auth(fixture.foremanToken) });
    expect(foreman.status()).toBeGreaterThanOrEqual(403);
    const cross = await request.get(apiUrl("/payment-retainage-adjustments/partner/payments"), { headers: auth(fixture.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });
});

async function seedP13Fixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const partnerOrg = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const provider = crypto.randomUUID();
  const crew = crypto.randomUUID();
  const contract = crypto.randomUUID();
  const agreementVersion = crypto.randomUUID();
  const partnerSchedule = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const partnerUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const foremanWorker = crypto.randomUUID();
  const internalTu = crypto.randomUUID();
  const partnerTu = crypto.randomUUID();
  const foremanTu = crypto.randomUUID();
  const tenantBTu = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const partnerRole = crypto.randomUUID();
  const foremanRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();
  const project = crypto.randomUUID();
  const workOrder = crypto.randomUUID();
  const workOrderVersion = crypto.randomUUID();
  const dailyJsa = crypto.randomUUID();
  const report = crypto.randomUUID();
  const revision = crypto.randomUUID();
  const cycle = crypto.randomUUID();
  const production = crypto.randomUUID();
  const decision = crypto.randomUUID();
  const source = crypto.randomUUID();
  const billable = crypto.randomUUID();
  const invoice = crypto.randomUUID();
  const invoiceItem = crypto.randomUUID();
  const settlement = crypto.randomUUID();
  const payable = crypto.randomUUID();
  const retainagePayable = crypto.randomUUID();
  const retainageProduction=crypto.randomUUID(), retainageDecision=crypto.randomUUID(), retainageSettlement=crypto.randomUUID(), retainageSource=crypto.randomUUID();
  const permissions = [
    "contractor_payable.calculate_eligibility", "partner_payment.execute", "partner_payment.submit", "partner_payment.confirm", "partner_payment.read", "retainage.release", "financial_adjustment.create",
    "financial_exception.read", "partner_context.read",
  ];
  await client.query("BEGIN");
  try {
    for (const key of permissions) await client.query("INSERT INTO permissions (key,name) VALUES ($1,$1) ON CONFLICT (key) DO NOTHING", [key]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,'P13 Tenant A',$2),($3,'P13 Tenant B',$4)", [tenantA, `p13-a-${suffix}`, tenantB, `p13-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P13 Internal'),($3,$4,'P13 Partner'),($5,$6,'P13 Foreman'),($7,$8,'P13 Other')", [internalUser, `p13-internal-${suffix}@syncos.test`, partnerUser, `p13-partner-${suffix}@syncos.test`, foremanUser, `p13-foreman-${suffix}@syncos.test`, tenantBUser, `p13-b-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [internalTu, tenantA, internalUser, partnerTu, partnerUser, foremanTu, foremanUser, tenantBTu, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P13 Finance','p13_finance'),($3,$2,'Partner Admin','partner_admin'),($4,$2,'Partner Foreman','partner_foreman'),($5,$6,'Partner Admin','partner_admin')", [internalRole, tenantA, partnerRole, foremanRole, tenantBRole, tenantB]);
    for (const [tenantId, roleId, keys] of [[tenantA, internalRole, permissions.filter((key) => key !== "partner_context.read" && key !== "partner_payment.read")], [tenantA, partnerRole, ["partner_context.read", "partner_payment.read"]], [tenantA, foremanRole, ["partner_context.read"]], [tenantB, tenantBRole, ["partner_context.read", "partner_payment.read"]]] as const) {
      for (const key of keys) await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
    }
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P13 Partner','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P13 Customer','customer',ARRAY['work_creator']::text[],'active')", [partnerOrg, tenantA, customerOrg]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status) VALUES ($1,$2,$3,'P13 Provider','subcontractor','activated')", [provider, tenantA, partnerOrg]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'tenant',$1),($1,$4,$5,'organization',$6),($1,$7,$8,'organization',$6),($9,$10,$11,'organization',$12)", [tenantA, internalTu, internalRole, partnerTu, partnerRole, partnerOrg, foremanTu, foremanRole, tenantB, tenantBTu, tenantBRole, crypto.randomUUID()]);
    await client.query("INSERT INTO partner_payment_profiles (tenant_id,organization_id,capacity_provider_id,primary_payment_method,priority_passport_status,status,provider_reference,account_last_four,bank_display_name) VALUES ($1,$2,$3,'priority_passport','active','active','test-provider-profile','6789','Synthetic Bank')", [tenantA, partnerOrg, provider]);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status,qc_authority_organization_id) VALUES ($1,$2,$3,'P13 Project','active',$3)", [project, tenantA, customerOrg]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P13 Crew','aerial','active','active',1)", [crew, tenantA, provider, partnerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P13 Partner MSA','partner_master_agreement','active','active','2026-08-01')", [contract, tenantA, partnerOrg, provider]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-01',$6)", [agreementVersion, tenantA, partnerOrg, provider, contract, internalUser]);
    // Synthetic verified agreement evidence for the financial lineage gate.
    const agreementFile = crypto.randomUUID();
    await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'partner_msa_executed','partner_agreement_version',$5,'synthetic-agreement.pdf','application/pdf',16,'synthetic-agreement-checksum',$6,$7)", [agreementFile,tenantA,partnerOrg,provider,agreementVersion,`${tenantA}/${partnerOrg}/${agreementFile}.pdf`,internalUser]);
    await client.query("UPDATE partner_agreement_versions SET executed_at='2026-08-01',artifact_file_object_id=$3,artifact_verified_at='2026-08-01',artifact_verified_by_user_id=$4 WHERE tenant_id=$1 AND id=$2",[tenantA,agreementVersion,agreementFile,internalUser]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P13 Partner Rates','2026-08-01','active')", [partnerSchedule, tenantA, partnerOrg]);
    await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,'P13','Foreman','active','approved')", [foremanWorker, tenantA, provider, crew, partnerOrg]);
    await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,'foreman','active')", [tenantA, partnerOrg, provider, crew, foremanWorker]);
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, partnerOrg, foremanWorker, foremanTu]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,assigned_organization_id,partner_organization_id,partner_rate_schedule_id,governing_agreement_version_id,unit,planned_quantity,qc_authority_organization_id) VALUES ($1,$2,$3,$4,$5,'P13 WO','fiber',3000,'feet','assigned','P13 WO','WO-P13',$6,$6,$7,$8,'feet',3000,$9)", [workOrder, tenantA, project, provider, crew, partnerOrg, partnerSchedule, agreementVersion, customerOrg]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WO-P13','P13 scope','MAP-P13','feet','active','2026-08-01',$10)", [workOrderVersion, tenantA, partnerOrg, provider, project, workOrder, agreementVersion, crew, partnerSchedule, internalUser]);
    await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-25','completed','P13 work area',true,$10,now())", [dailyJsa, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser]);
    await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,daily_jsa_id,work_date,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'2026-08-25','submitted',now(),$10,1,'complete','customer_accepted')", [report, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, dailyJsa]);
    await client.query("INSERT INTO daily_production_report_revisions (id,tenant_id,daily_report_id,revision_number,snapshot_json,reason,submitted_by_user_id) VALUES ($1,$2,$3,1,'{}','submitted',$4)", [revision, tenantA, report, foremanUser]);
    await client.query("INSERT INTO customer_qc_cycles (id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,submitted_to_customer_at,source_reference,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'accepted',now(),'customer-report',$11)", [cycle, tenantA, project, workOrder, workOrderVersion, report, revision, partnerOrg, crew, customerOrg, internalUser]);
    await client.query("INSERT INTO production_records (id,tenant_id,project_id,work_order_id,work_order_version_id,capacity_provider_id,crew_id,foreman_user_id,submitted_by_user_id,submitted_by,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,production_type,qc_status,billable_status,status,daily_production_report_id,partner_organization_id,syncfield_location_type,syncfield_status,locked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,'2026-08-25',141,141,141,'feet','feet','daily_production','not_started','not_billable','submitted',$9,$10,'route','complete',now())", [production, tenantA, project, workOrder, workOrderVersion, provider, crew, foremanUser, report, partnerOrg]);
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference,current) VALUES ($1,$2,$3,$4,'accepted',141,141,'feet','customer_acceptance',$5,'customer-report',true)", [decision, tenantA, cycle, production, internalUser]);
    await client.query("INSERT INTO accepted_production_financial_sources (id,tenant_id,project_id,work_order_id,partner_organization_id,capacity_provider_id,crew_id,production_record_id,customer_qc_cycle_id,customer_qc_decision_id,production_code,production_description,accepted_quantity,unit_of_measure,customer_rate,customer_extended_amount,partner_rate,partner_extended_amount,source_fingerprint,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'FIBER','Place Fiber',141,'feet',0.94,132.54,0.70,98.70,$11,$12)", [source, tenantA, project, workOrder, partnerOrg, provider, crew, production, cycle, decision, `p13-source-${suffix}`, internalUser]);
    await client.query("INSERT INTO billable_items (id,tenant_id,project_id,work_order_id,production_record_id,qc_review_id,customer_qc_decision_id,accepted_production_source_id,customer_organization_id,capacity_provider_id,crew_id,status,readiness_status,approved_quantity,billable_quantity,unit,unit_rate,rate_source,rate_confidence,estimated_billable_amount,net_billable_amount,customer_acceptance_status,billing_package_status,documentation_status,currency,source_fingerprint) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,'settlement_created','ready_for_settlement',141,141,'feet',0.94,'customer_rate','confirmed',132.54,132.54,'accepted','ready','ready','USD',$11)", [billable, tenantA, project, workOrder, production, decision, source, customerOrg, provider, crew, `p13-source-${suffix}`]);
    await client.query("INSERT INTO invoices (id,tenant_id,organization_id,customer_organization_id,project_id,invoice_number,invoice_type,invoice_date,due_date,subtotal_amount,invoice_amount,total_amount,original_amount,paid_amount,balance_amount,currency,status,approval_status,delivery_status,cash_application_status,customer_acceptance_status,p12_source_fingerprint) VALUES ($1,$2,$3,$3,$4,'INV-P13','standard','2026-08-25','2026-09-24',132.54,132.54,132.54,132.54,0,132.54,'USD','approved','approved','not_sent','ready_for_cash_application','accepted',$5)", [invoice, tenantA, customerOrg, project, `p13-invoice-${suffix}`]);
    await client.query("INSERT INTO invoice_items (id,tenant_id,invoice_id,billable_item_id,accepted_production_source_id,production_record_id,work_order_id,project_id,customer_organization_id,item_type,status,description,quantity,unit,unit_rate,gross_amount,net_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'customer_billable','invoiced','Place Fiber',141,'feet',0.94,132.54,132.54)", [invoiceItem, tenantA, invoice, billable, source, production, workOrder, project, customerOrg]);
    await client.query("UPDATE billable_items SET invoice_item_id = $1 WHERE tenant_id = $2 AND id = $3", [invoiceItem, tenantA, billable]);
    await client.query("UPDATE accepted_production_financial_sources SET billable_item_id = $1, invoice_item_id = $2 WHERE tenant_id = $3 AND id = $4", [billable, invoiceItem, tenantA, source]);
    await client.query("INSERT INTO settlements (id,tenant_id,settlement_number,settlement_type,status,readiness_status,customer_organization_id,capacity_provider_id,project_id,work_order_id,settlement_period_start,settlement_period_end,gross_amount,contractor_payable_amount,net_amount,net_settlement_amount,total_amount,payable_ready,issued_at,dispute_deadline) VALUES ($1,$2,'PSET-P13','contractor_payable','payable_ready','ready_for_approval',$3,$4,$5,$6,'2026-08-24','2026-08-30',98.70,98.70,98.70,98.70,98.70,true,now(),'2026-09-04')", [settlement, tenantA, customerOrg, provider, project, workOrder]);
    await client.query("INSERT INTO settlement_items (tenant_id,settlement_id,accepted_production_source_id,production_record_id,partner_organization_id,capacity_provider_id,item_type,status,quantity,unit,unit_rate,gross_amount,amount,net_amount,contractor_payable_amount) VALUES ($1,$2,$3,$4,$5,$6,'contractor_payable','payable_ready',141,'feet',0.70,98.70,98.70,98.70,98.70)",[tenantA,settlement,source,production,partnerOrg,provider]);
    await client.query("INSERT INTO production_records (id,tenant_id,project_id,work_order_id,work_order_version_id,capacity_provider_id,crew_id,foreman_user_id,submitted_by_user_id,submitted_by,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,production_type,qc_status,billable_status,status,daily_production_report_id,partner_organization_id,syncfield_location_type,syncfield_status,locked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,'2026-08-25',1900,1900,1900,'feet','feet','daily_production','not_started','not_billable','submitted',$9,$10,'route','complete',now())", [retainageProduction, tenantA, project, workOrder, workOrderVersion, provider, crew, foremanUser, report, partnerOrg]);
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference,current) VALUES ($1,$2,$3,$4,'accepted',1900,1900,'feet','customer_acceptance',$5,'customer-report',true)", [retainageDecision, tenantA, cycle, retainageProduction, internalUser]);
    await client.query("INSERT INTO settlements (id,tenant_id,settlement_number,settlement_type,status,readiness_status,customer_organization_id,capacity_provider_id,project_id,work_order_id,settlement_period_start,settlement_period_end,gross_amount,contractor_payable_amount,net_amount,net_settlement_amount,total_amount,payable_ready,issued_at,dispute_deadline) VALUES ($1,$2,'PSET-P13-RET','contractor_payable','payable_ready','ready_for_approval',$3,$4,$5,$6,'2026-08-24','2026-08-30',1330,1330,1330,1330,1330,true,now(),'2026-09-04')", [retainageSettlement, tenantA, customerOrg, provider, project, workOrder]);
    await client.query("INSERT INTO accepted_production_financial_sources (id,tenant_id,project_id,work_order_id,partner_organization_id,capacity_provider_id,crew_id,production_record_id,customer_qc_cycle_id,customer_qc_decision_id,production_code,production_description,accepted_quantity,unit_of_measure,customer_rate,customer_extended_amount,partner_rate,partner_extended_amount,source_fingerprint,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'FIBER','Place Fiber',1900,'feet',0.94,1786,0.70,1330,$11,$12)", [retainageSource, tenantA, project, workOrder, partnerOrg, provider, crew, retainageProduction, cycle, retainageDecision, `p13-retainage-source-${suffix}`, internalUser]);
    await client.query("INSERT INTO settlement_items (tenant_id,settlement_id,accepted_production_source_id,production_record_id,partner_organization_id,capacity_provider_id,item_type,status,quantity,unit,unit_rate,gross_amount,amount,net_amount,contractor_payable_amount) VALUES ($1,$2,$6,$3,$4,$5,'contractor_payable','payable_ready',1900,'feet',0.70,1330,1330,1330,1330)",[tenantA,retainageSettlement,retainageProduction,partnerOrg,provider,retainageSource]);
    await client.query("INSERT INTO contractor_payables (id,tenant_id,payable_number,payable_type,payable_party_type,status,approval_status,payment_readiness_status,payment_status,capacity_provider_id,partner_organization_id,project_id,settlement_id,pay_cycle_start,pay_cycle_end,gross_payable_amount,retainage_amount,retained_balance_amount,deduction_amount,chargeback_amount,net_payable_amount,eligible_amount,ineligible_amount,pay_when_paid_status,payment_execution_status,compliance_status,tax_document_status) VALUES ($1,$2,'CP-P13-1','subcontractor','capacity_provider','payment_ready','approved','ready_for_payment','not_paid',$3,$4,$5,$6,'2026-08-24','2026-08-30',98.70,0,0,0,0,98.70,98.70,0,'eligible','not_started','ready','ready'),($7,$2,'CP-P13-RET','subcontractor','capacity_provider','payment_ready','approved','ready_for_payment','not_paid',$3,$4,$5,$8,'2026-08-24','2026-08-30',1330,700,700,0,0,630,630,0,'eligible','not_started','ready','ready')", [payable, tenantA, provider, partnerOrg, project, settlement, retainagePayable, retainageSettlement]);
    await pinSyntheticPaymentProvenance(client,tenantA,internalUser,contract,partnerSchedule,partnerOrg);
    // Payment tests use actual source-linked cleared funding and the real calculation path.
    await client.query("INSERT INTO contractor_payable_items(tenant_id,contractor_payable_id,settlement_id,settlement_item_id,accepted_production_source_id,production_record_id,item_type,status,net_payable_amount) SELECT $1,$2,$3,id,$4,$5,'subcontractor_production','ready',98.70 FROM settlement_items WHERE tenant_id=$1 AND settlement_id=$3",[tenantA,payable,settlement,source,production]);
    const receipt=(await client.query("INSERT INTO cash_receipts(tenant_id,receipt_number,customer_organization_id,payment_date,payment_method,gross_received_amount,applied_amount,receipt_status,clearance_status,cleared_at) VALUES($1,'SYNTHETIC-P13-FUNDING',$2,'2026-08-26','ach',132.54,132.54,'fully_applied','cleared','2026-08-26') RETURNING id",[tenantA,customerOrg])).rows[0];
    const application=(await client.query("INSERT INTO payment_applications(tenant_id,cash_receipt_id,invoice_id,customer_organization_id,applied_amount,application_date) VALUES($1,$2,$3,$4,132.54,'2026-08-26') RETURNING id",[tenantA,receipt.id,invoice,customerOrg])).rows[0];
    await client.query("INSERT INTO payment_application_allocations(tenant_id,payment_application_id,invoice_item_id,accepted_production_source_id,allocated_customer_amount) VALUES($1,$2,$3,$4,132.54)",[tenantA,application.id,invoiceItem,source]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try {await new AcceptedProductionFinancialsController(pool).calculateEligibility({auth:{tenantId:tenantA,userId:internalUser}},payable);}finally{await pool.end();}
  return { tenantA, tenantB, partnerOrg, payableId: payable, retainagePayableId: retainagePayable, acceptedSourceId: source, invoiceId: invoice, internalToken: token(internalUser, tenantA, secret), partnerToken: token(partnerUser, tenantA, secret), foremanToken: token(foremanUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret) };
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

test('external payment records are idempotent, evidence-backed, and serialized against concurrent overpayment', async ({request}) => {
  const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try {
    const f=await seedP13Fixture(client,process.env.AUTH_JWT_SECRET!);
    const balance=(await client.query('SELECT eligible_amount FROM contractor_payables WHERE tenant_id=$1 AND id=$2',[f.tenantA,f.payableId])).rows[0];
    const amount=Number(balance.eligible_amount);
    const body={contractor_payable_id:f.payableId,amount,payment_date:new Date().toISOString().slice(0,10),method:'ach',reference:crypto.randomUUID(),evidence_reference:'Synthetic bank confirmation',idempotency_key:crypto.randomUUID(),confirmed_completed:true};
    const url=apiUrl('/payment-retainage-adjustments/external-payments');
    const denied=await request.post(url,{headers:auth(f.foremanToken),data:body});expect(denied.status()).toBe(403);
    const noEvidence=await request.post(url,{headers:auth(f.internalToken),data:{...body,evidence_reference:''}});expect(noEvidence.status()).toBe(400);
    const fractional=await request.post(url,{headers:auth(f.internalToken),data:{...body,amount:1.001}});expect(fractional.status()).toBe(400);
    const invalidDate=await request.post(url,{headers:auth(f.internalToken),data:{...body,payment_date:'2026-02-31'}});expect(invalidDate.status()).toBe(400);
    const attempts=await Promise.all([request.post(url,{headers:auth(f.internalToken),data:body}),request.post(url,{headers:auth(f.internalToken),data:{...body,idempotency_key:crypto.randomUUID(),reference:crypto.randomUUID()}})]);
    expect(attempts.filter(r=>r.ok())).toHaveLength(1);expect(attempts.filter(r=>r.status()===400)).toHaveLength(1);
    const winner=await attempts.find(r=>r.ok())!.json();
    const retryBody={...body,idempotency_key:winner.idempotency_key,reference:winner.reference};
    const retry=await request.post(url,{headers:auth(f.internalToken),data:retryBody});expect(retry.ok()).toBeTruthy();expect((await retry.json()).id).toBe(winner.id);
    const changed=await request.post(url,{headers:auth(f.internalToken),data:{...retryBody,amount:amount/2}});expect(changed.status()).toBe(400);
    const stored=await client.query('SELECT paid_amount FROM contractor_payables WHERE tenant_id=$1 AND id=$2',[f.tenantA,f.payableId]);expect(Number(stored.rows[0].paid_amount)).toBe(amount);
    const history=await apiJson(request,f.internalToken,'GET','/payment-retainage-adjustments/external-payments');expect(history.some((r:any)=>r.id===winner.id&&r.evidence_reference===body.evidence_reference)).toBe(true);
    const partnerHistory=await apiJson(request,f.partnerToken,'GET','/payment-retainage-adjustments/partner/payments');expect(JSON.stringify(partnerHistory)).toContain(winner.reference);expect(JSON.stringify(partnerHistory)).not.toContain(body.evidence_reference);
    const rows=await client.query('SELECT count(*)::int AS count FROM external_partner_payments WHERE tenant_id=$1 AND contractor_payable_id=$2',[f.tenantA,f.payableId]);expect(rows.rows[0].count).toBe(1);
    const observationBody={provider:'bank',account_reference:'synthetic-bank',transaction_reference:winner.reference,payee_reference:'synthetic-partner',amount:amount.toFixed(2),currency:'USD',observed_status:'completed',completed_date:body.payment_date,evidence_reference:'Synthetic bank settlement evidence'};
    const observation=await apiJson(request,f.internalToken,'POST','/payment-retainage-adjustments/external-payment-observations',observationBody);
    const review={external_partner_payment_id:winner.id,review_note:'Synthetic account and payee mapping checked',account_and_payee_verified:true};
    const linkPath=`/payment-retainage-adjustments/external-payment-observations/${observation.id}/link-recorded-payment`;
    expect((await request.post(apiUrl(linkPath),{headers:auth(f.internalToken),data:{...review,account_and_payee_verified:false}})).status()).toBe(400);
    const linked=await apiJson(request,f.internalToken,'POST',linkPath,review);expect(linked.review_status).toBe('linked');
    const replay=await apiJson(request,f.internalToken,'POST',linkPath,review);expect(replay.id).toBe(linked.id);
    expect((await client.query('SELECT count(*)::int AS n FROM external_partner_payments WHERE tenant_id=$1',[f.tenantA])).rows[0].n).toBe(1);
    expect((await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2",[f.tenantA,observation.id])).rows[0].n).toBe(2);
    const reversal=await apiJson(request,f.internalToken,'POST','/payment-retainage-adjustments/external-payment-observations',{...observationBody,observed_status:'returned'});
    expect(reversal.review_status).toBe('needs_review');
    expect((await request.post(apiUrl(`/payment-retainage-adjustments/external-payment-observations/${reversal.id}/link-recorded-payment`),{headers:auth(f.internalToken),data:review})).status()).toBe(400);

  } finally {await client.end();}
});

test('competing pending retainage authorizations cannot exceed the remaining balance',async({request})=>{
 const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try {
  const f=await seedP13Fixture(client,process.env.AUTH_JWT_SECRET!);
  await client.query("UPDATE contractor_payables SET eligible_amount=49.35,pay_when_paid_status='partially_eligible',payment_readiness_status='ready_with_warning' WHERE tenant_id=$1 AND id=$2",[f.tenantA,f.payableId]);
  const partial=await apiJson(request,f.internalToken,'GET','/payment-retainage-adjustments/ready-to-pay');expect(partial.some((r:any)=>r.id===f.payableId)).toBe(true);
  const choices=await apiJson(request,f.internalToken,'GET','/payment-retainage-adjustments/retainage-choices');expect(choices.payables.some((r:any)=>r.id===f.retainagePayableId)).toBe(true);
  for(const bearer of [f.partnerToken,f.foremanToken,f.tenantBToken])expect((await request.get(apiUrl('/payment-retainage-adjustments/retainage-choices'),{headers:auth(bearer)})).status()).toBe(403);
  const releases=[];
  for(let i=0;i<2;i++)releases.push(await apiJson(request,f.internalToken,'POST','/payment-retainage-adjustments/retainage-releases',{contractor_payable_id:f.retainagePayableId,release_amount:500,release_reason:'Synthetic competing release',source_reference:'Synthetic closeout',idempotency_key:crypto.randomUUID()}));
  const results=await Promise.all(releases.map(r=>request.post(apiUrl(`/payment-retainage-adjustments/retainage-releases/${r.id}/authorize`),{headers:auth(f.internalToken),data:{}})));
  expect(results.map(r=>r.status()).sort()).toEqual([201,400]);
  const balance=await client.query('SELECT retained_balance_amount FROM contractor_payables WHERE tenant_id=$1 AND id=$2',[f.tenantA,f.retainagePayableId]);expect(Number(balance.rows[0].retained_balance_amount)).toBe(200);
  const remainder=await apiJson(request,f.internalToken,'POST','/payment-retainage-adjustments/retainage-releases',{contractor_payable_id:f.retainagePayableId,release_amount:200,release_reason:'Remaining balance',source_reference:'Synthetic final closeout',idempotency_key:crypto.randomUUID()});
  await apiJson(request,f.internalToken,'POST',`/payment-retainage-adjustments/retainage-releases/${remainder.id}/authorize`,{});
  const after=await client.query('SELECT retained_balance_amount,retainage_amount FROM contractor_payables WHERE tenant_id=$1 AND id=$2',[f.tenantA,f.retainagePayableId]);expect(Number(after.rows[0].retained_balance_amount)).toBe(0);expect(Number(after.rows[0].retainage_amount)).toBe(700);
 } finally {await client.end();}
});

test('payment advancement rejects unverified agreements and duplicate payable exposure',async({request})=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const f=await seedP13Fixture(db,process.env.AUTH_JWT_SECRET!);
  const body={contractor_payable_id:f.payableId,amount:1,idempotency_key:crypto.randomUUID()};
  await db.query('UPDATE partner_agreement_versions SET artifact_verified_at=NULL WHERE tenant_id=$1',[f.tenantA]);
  let denied=await request.post(apiUrl('/payment-retainage-adjustments/payment-instructions'),{headers:auth(f.internalToken),data:body});expect(denied.status()).toBe(400);expect(await denied.text()).toContain('approved agreement');
  await db.query('UPDATE partner_agreement_versions SET artifact_verified_at=now() WHERE tenant_id=$1',[f.tenantA]);
  await db.query('UPDATE settlement_items SET net_amount=net_amount+1 WHERE tenant_id=$1 AND settlement_id=(SELECT settlement_id FROM contractor_payables WHERE id=$2)',[f.tenantA,f.payableId]);
  denied=await request.post(apiUrl('/payment-retainage-adjustments/payment-instructions'),{headers:auth(f.internalToken),data:body});expect(denied.status()).toBe(400);expect(await denied.text()).toContain('locked partner rate');
  await db.query('UPDATE settlement_items SET net_amount=net_amount-1 WHERE tenant_id=$1 AND settlement_id=(SELECT settlement_id FROM contractor_payables WHERE id=$2)',[f.tenantA,f.payableId]);
  await db.query('UPDATE contractor_payables SET net_payable_amount=100 WHERE tenant_id=$1 AND id=$2',[f.tenantA,f.payableId]);
  denied=await request.post(apiUrl('/payment-retainage-adjustments/payment-instructions'),{headers:auth(f.internalToken),data:body});expect(denied.status()).toBe(400);expect(await denied.text()).toContain('settlement budget');
  expect((await db.query('SELECT id FROM partner_payment_instructions WHERE tenant_id=$1',[f.tenantA])).rows).toHaveLength(0);
 }finally{await db.end();}
});

test('finance review UI retains unmatched observations without posting payments and hides controls from foremen',async({request,page})=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const f=await seedP13Fixture(db,process.env.AUTH_JWT_SECRET!);
  await page.addInitScript(bearer=>localStorage.setItem('syncos.apiToken',bearer),f.internalToken);
  await page.goto('/payment-retainage-adjustments');
  await page.getByText('Add an observed transaction',{exact:true}).click();
  await page.getByLabel('Account reference (not a bank number)').fill('synthetic-account');
  const reference=crypto.randomUUID();await page.getByLabel('Transaction reference',{exact:true}).fill(reference);
  await page.getByLabel('Payee reference',{exact:true}).fill('synthetic-payee');
  await page.getByLabel('Amount (for example 125.00)').fill('12.34');
  await page.getByLabel('Evidence reference',{exact:true}).fill('SYNTHETIC-OBSERVATION');
  await page.getByRole('button',{name:'Save for review',exact:true}).click();
  await expect(page.getByText('Observation saved for review. No payment was posted or sent.',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:reference,exact:true})).toBeVisible();
  expect((await db.query('SELECT review_status FROM external_payment_observations WHERE tenant_id=$1',[f.tenantA])).rows).toEqual([{review_status:'needs_review'}]);
  expect((await db.query('SELECT id FROM payments WHERE tenant_id=$1',[f.tenantA])).rows).toHaveLength(0);
  await page.addInitScript(bearer=>localStorage.setItem('syncos.apiToken',bearer),f.foremanToken);
  await page.goto('/payment-retainage-adjustments');
  await expect(page.getByRole('button',{name:'Save for review',exact:true})).toHaveCount(0);
  expect((await request.get(apiUrl('/payment-retainage-adjustments/external-payment-observations'),{headers:auth(f.foremanToken)})).status()).toBe(403);
 }finally{await db.end();}
});
