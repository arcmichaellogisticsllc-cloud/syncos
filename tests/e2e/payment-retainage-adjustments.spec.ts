import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

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
  const permissions = [
    "partner_payment.execute", "partner_payment.submit", "partner_payment.confirm", "partner_payment.read", "retainage.release", "financial_adjustment.create",
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
    await client.query("INSERT INTO contractor_payables (id,tenant_id,payable_number,payable_type,payable_party_type,status,approval_status,payment_readiness_status,payment_status,capacity_provider_id,partner_organization_id,project_id,settlement_id,pay_cycle_start,pay_cycle_end,gross_payable_amount,retainage_amount,retained_balance_amount,deduction_amount,chargeback_amount,net_payable_amount,eligible_amount,ineligible_amount,pay_when_paid_status,payment_execution_status,compliance_status,tax_document_status) VALUES ($1,$2,'CP-P13-1','subcontractor','capacity_provider','payment_ready','approved','ready_for_payment','not_paid',$3,$4,$5,$6,'2026-08-24','2026-08-30',98.70,0,0,0,0,98.70,98.70,0,'eligible','not_started','ready','ready'),($7,$2,'CP-P13-RET','subcontractor','capacity_provider','payment_ready','approved','ready_for_payment','not_paid',$3,$4,$5,$6,'2026-08-24','2026-08-30',700,700,700,0,0,630,630,0,'eligible','not_started','ready','ready')", [payable, tenantA, provider, partnerOrg, project, settlement, retainagePayable]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
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
