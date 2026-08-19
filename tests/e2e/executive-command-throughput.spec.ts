import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantA: string;
  tenantB: string;
  opportunity: string;
  partnerOrg: string;
  internalToken: string;
  partnerToken: string;
  tenantBToken: string;
};

test.describe.serial("P16 Executive Command Center throughput and daily decision support", () => {
  let client: Client;
  let fixture: Fixture;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedP16Fixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("authorized executive can open Command Center; Partner and cross-tenant users are denied", async ({ page, request }) => {
    const recalculated = await apiJson(request, fixture.internalToken, "POST", "/executive-command/recalculate", { as_of: "2026-08-19T15:00:00Z" });
    expect(recalculated.snapshot.policy_version).toBe("executive_command_v1");
    expect(recalculated.boundary).toMatchObject({ read_model_only: true, opportunity_stage_changed: false, partner_assigned: false, payment_executed: false });

    await page.addInitScript((token) => window.localStorage.setItem("syncos.apiToken", token), fixture.internalToken);
    await page.goto("/command-center");
    await expect(page.getByRole("heading", { name: /Telecom throughput and daily action board/i })).toBeVisible();
    await expect(page.getByText("Top Actions Today")).toBeVisible();

    const partner = await request.get(apiUrl("/executive-command/summary"), { headers: auth(fixture.partnerToken) });
    expect(partner.status()).toBeGreaterThanOrEqual(403);
    const cross = await request.get(apiUrl("/executive-command/summary"), { headers: auth(fixture.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });

  test("growth and capacity KPIs consume P15/P14 without mutating opportunities or assignments", async ({ request }) => {
    const before = await sourceCounts(client, fixture.tenantA);
    const summary = await apiJson(request, fixture.internalToken, "GET", "/executive-command/summary");
    const snapshot = summary.snapshot;
    expect(Number(snapshot.qualified_opportunity_count)).toBe(1);
    expect(Number(snapshot.qualified_opportunity_value)).toBe(250000);
    expect(Number(snapshot.coverage_ready_count)).toBe(0);
    expect(Number(snapshot.capacity_gap_count)).toBe(1);
    expect(Number(snapshot.ready_crew_count)).toBe(4);
    expect(Number(snapshot.active_work_order_count)).toBe(1);
    const after = await sourceCounts(client, fixture.tenantA);
    expect(after).toEqual(before);
  });

  test("production and Customer QC KPIs are unit-aware and separate Customer delay from Partner correction", async ({ request }) => {
    const summary = await apiJson(request, fixture.internalToken, "GET", "/executive-command/summary");
    const reported = summary.snapshot.reported_production_summary as Array<Record<string, unknown>>;
    const units = reported.map((row) => row.unit);
    expect(units).toEqual(expect.arrayContaining(["LF", "EA"]));
    expect(Number(reported.find((row) => row.unit === "LF")?.quantity)).toBe(18400);
    expect(Number(reported.find((row) => row.unit === "EA")?.quantity)).toBe(12);
    expect(Number(summary.snapshot.pending_qc_count)).toBe(1);
    expect(Number(summary.snapshot.customer_qc_aging_count)).toBe(1);
    expect(summary.blockers.find((row: Record<string, unknown>) => row.reason_code === "CUSTOMER_QC_AGING").owner_attribution).toBe("customer");
    expect(summary.blockers.find((row: Record<string, unknown>) => row.reason_code === "PARTNER_CORRECTION_OVERDUE").owner_attribution).toBe("partner");
  });

  test("finance KPIs preserve Customer revenue and Partner payable chain separation", async ({ request }) => {
    const summary = await apiJson(request, fixture.internalToken, "GET", "/executive-command/summary");
    const snapshot = summary.snapshot;
    expect(Number(snapshot.accepted_not_billed_amount)).toBe(1200);
    expect(Number(snapshot.outstanding_ar_amount)).toBe(15000);
    expect(Number(snapshot.cleared_cash_amount)).toBe(10000);
    expect(Number(snapshot.unapplied_cash_amount)).toBe(2000);
    expect(Number(snapshot.partner_eligible_payable_amount)).toBe(7000);
    expect(Number(snapshot.partner_awaiting_funds_amount)).toBe(3000);
    expect(Number(snapshot.partner_payment_due_amount)).toBe(7000);
    expect(snapshot.days_to_cash).toMatchObject({ definition: "customer_acceptance_to_cleared_cash_application", unpaid_items_excluded: true });
    expect(summary.boundary.customer_ar_partner_ap_collapsed).toBe(false);
  });

  test("daily actions are deterministic, deduped, routed, and do not execute source actions", async ({ request }) => {
    const summary = await apiJson(request, fixture.internalToken, "GET", "/executive-command/summary");
    const actions = summary.actions as Array<Record<string, unknown>>;
    expect(actions.map((row) => row.reason_code)).toEqual(expect.arrayContaining(["CRITICAL_PARTNER_RISK", "PARTNER_PAYMENT_OVERDUE", "CAPACITY_GAP", "MISSING_CUSTOMER_RATE", "CUSTOMER_QC_AGING", "PARTNER_CORRECTION_OVERDUE", "UNAPPLIED_CASH"]));
    expect(actions[0].priority).toBe("p0");
    expect(actions[0].reason_code).toBe("CRITICAL_PARTNER_RISK");
    expect(new Set(actions.map((row) => `${row.reason_code}:${row.source_object_type}:${row.source_object_id}`)).size).toBe(actions.length);
    expect(actions.every((row) => String(row.route ?? "").startsWith("/"))).toBe(true);
    const before = await sourceCounts(client, fixture.tenantA);
    await apiJson(request, fixture.internalToken, "PATCH", `/executive-command/actions/${actions[0].id}/acknowledge`);
    const after = await sourceCounts(client, fixture.tenantA);
    expect(after).toEqual(before);
  });

  test("scheduled scan is locked and idempotent; no rates, secrets, Worker PII, or auto-actions leak", async ({ request }) => {
    const first = await apiJson(request, fixture.internalToken, "POST", "/executive-command/scan", { as_of: "2026-08-19T15:00:00Z", batch_size: 10 });
    const second = await apiJson(request, fixture.internalToken, "POST", "/executive-command/scan", { as_of: "2026-08-19T15:00:00Z", batch_size: 10 });
    expect(first.locked).toBe(true);
    expect(second.locked).toBe(true);
    const current = await client.query("SELECT count(*)::int AS count FROM executive_command_snapshots WHERE tenant_id = $1 AND current = true", [fixture.tenantA]);
    expect(current.rows[0].count).toBe(1);
    const summary = await apiJson(request, fixture.internalToken, "GET", "/executive-command/summary");
    expect(JSON.stringify(summary)).not.toMatch(/"(worker_email|worker_name|bank_account|provider_secret|margin_amount|margin_percent|customer_rate|partner_rate)"/i);
    expect(summary.boundary).toMatchObject({ ranked_action_is_automatic_action: false, work_order_awarded: false, crew_reserved: false, lifecycle_changed: false });
  });
});

async function seedP16Fixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const territory = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const partnerOrg = crypto.randomUUID();
  const provider = crypto.randomUUID();
  const crew = crypto.randomUUID();
  const crewEa = crypto.randomUUID();
  const project = crypto.randomUUID();
  const workOrder = crypto.randomUUID();
  const workOrderVersion = crypto.randomUUID();
  const contract = crypto.randomUUID();
  const agreementVersion = crypto.randomUUID();
  const rateSchedule = crypto.randomUUID();
  const productionCodeLf = crypto.randomUUID();
  const productionCodeEa = crypto.randomUUID();
  const worker = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const partnerUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const internalTu = crypto.randomUUID();
  const partnerTu = crypto.randomUUID();
  const tenantBTu = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const partnerRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();
  const opportunity = crypto.randomUUID();
  const requirement = crypto.randomUUID();
  const coverage = crypto.randomUUID();
  const risk = crypto.randomUUID();
  const permissions = ["executive_command.read", "executive_command.actions_read", "executive_command.snapshot_recalculate", "executive_command.action_acknowledge", "partner_context.read"];

  await client.query("BEGIN");
  try {
    for (const key of permissions) await client.query("INSERT INTO permissions (key,name) VALUES ($1,$1) ON CONFLICT (key) DO NOTHING", [key]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,'P16 Tenant A',$2),($3,'P16 Tenant B',$4)", [tenantA, `p16-a-${suffix}`, tenantB, `p16-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P16 Executive'),($3,$4,'P16 Partner'),($5,$6,'P16 Tenant B')", [internalUser, `p16-exec-${suffix}@syncos.test`, partnerUser, `p16-partner-${suffix}@syncos.test`, tenantBUser, `p16-b-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$7,$8)", [internalTu, tenantA, internalUser, partnerTu, partnerUser, tenantBTu, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P16 Executive','p16_executive'),($3,$2,'Partner Admin','partner_admin'),($4,$5,'P16 Tenant B','p16_tenant_b')", [internalRole, tenantA, partnerRole, tenantBRole, tenantB]);
    for (const key of permissions.filter((value) => value !== "partner_context.read")) {
      await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantA, internalRole, key]);
    }
    await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = 'partner_context.read' ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantA, partnerRole]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'tenant',$1),($1,$4,$5,'organization',$6),($7,$8,$9,'tenant',$7)", [tenantA, internalTu, internalRole, partnerTu, partnerRole, partnerOrg, tenantB, tenantBTu, tenantBRole]);
    await client.query("INSERT INTO territories (id,tenant_id,name,status) VALUES ($1,$2,'Great Lakes','active')", [territory, tenantA]);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P16 Customer','customer',ARRAY['work_creator']::text[],'active'),($3,$2,'P16 Partner','subcontractor',ARRAY['capacity_provider']::text[],'active')", [customerOrg, tenantA, partnerOrg]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,'P16 Provider','subcontractor','activated','verified','contracted')", [provider, tenantA, partnerOrg]);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status,territory_id,qc_authority_organization_id) VALUES ($1,$2,$3,'P16 Project','active',$4,$3)", [project, tenantA, customerOrg, territory]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P16 Aerial Crew','aerial','active','active',4),($5,$2,$3,$4,'P16 Splice Crew','aerial','active','active',4)", [crew, tenantA, provider, partnerOrg, crewEa]);
    await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,'P16','Foreman','active','approved')", [worker, tenantA, provider, crew, partnerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P16 Partner MSA','partner_master_agreement','active','active','2026-08-01')", [contract, tenantA, partnerOrg, provider]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-01',$6)", [agreementVersion, tenantA, partnerOrg, provider, contract, internalUser]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P16 Partner Rates','2026-08-01','active')", [rateSchedule, tenantA, partnerOrg]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,assigned_organization_id,partner_organization_id,governing_agreement_version_id,partner_rate_schedule_id,partner_execution_status,partner_effective_date,unit,planned_quantity,qc_authority_organization_id) VALUES ($1,$2,$3,$4,$5,'P16 WO','fiber',25000,'LF','in_progress','P16 WO','WO-P16',$6,$6,$7,$8,'active','2026-08-01','feet',25000,$9)", [workOrder, tenantA, project, provider, crew, partnerOrg, agreementVersion, rateSchedule, customerOrg]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WO-P16','P16 scope','MAP-P16','feet','active','2026-08-01',$10)", [workOrderVersion, tenantA, partnerOrg, provider, project, workOrder, agreementVersion, crew, rateSchedule, internalUser]);
    await client.query("INSERT INTO syncfield_production_codes (id,tenant_id,code,description,unit_of_measure,location_type,requires_route) VALUES ($1,$2,'AERIAL','Aerial Fiber','LF','route',true),($3,$2,'SPLICE','Splice Case','EA','asset',false)", [productionCodeLf, tenantA, productionCodeEa]);
    await client.query("INSERT INTO opportunities (id,tenant_id,organization_id,territory_id,title,work_type,status,stage,estimated_value) VALUES ($1,$2,$3,$4,'P16 Great Lakes Expansion','aerial','pursuing','pursuing',250000)", [opportunity, tenantA, customerOrg, territory]);
    await client.query("INSERT INTO opportunity_requirement_profiles (id,tenant_id,opportunity_id,version,territory_id,capability,crew_type,required_crew_count,required_start_date,required_start_window,current,created_by_user_id) VALUES ($1,$2,$3,1,$4,'aerial','aerial',5,'2026-08-22','72h',true,$5)", [requirement, tenantA, opportunity, territory, internalUser]);
    await client.query("INSERT INTO opportunity_coverage_options (id,tenant_id,opportunity_id,requirement_profile_id,rank,coverage_status,covered_crew_count,required_crew_count,remaining_gap,average_fit_score,minimum_confidence,critical_risk_count,partner_count,composition,reason_summary,source_fingerprint,current) VALUES ($1,$2,$3,$4,1,'capacity_gap',4,5,1,88,'high',0,2,'[]','{\"pursue_recommendation\":\"pursue_partial_capacity_recruiting_required\"}',$5,true)", [coverage, tenantA, opportunity, requirement, `p16-coverage-${suffix}`]);
    await client.query("INSERT INTO partner_performance_snapshots (tenant_id,partner_organization_id,capacity_provider_id,scoring_policy_version,score,score_band,confidence,quality_score,production_score,documentation_score,safety_score,mobilization_score,correction_score,commercial_score,capacity_reliability_score,trend,lifecycle_recommendation,production_day_count,reviewed_record_count,completed_work_order_count,critical_risk_count,source_fingerprint) VALUES ($1,$2,$3,'partner_performance_v1',94,'excellent','high',94,90,88,95,90,92,90,93,'stable','review',30,50,4,1,$4)", [tenantA, partnerOrg, provider, `p16-performance-${suffix}`]);
    await client.query("INSERT INTO partner_capacity_intelligence_snapshots (tenant_id,partner_organization_id,capacity_provider_id,territory_id,crew_type,capability,horizon,ready_crew_count,conditional_crew_count,unverified_crew_count,committed_crew_count,capacity_confidence,recommendation,source_fingerprint) VALUES ($1,$2,$3,$4,'aerial','aerial','now_24h',4,0,0,1,'high','best_fit',$5),($1,$2,$3,$4,'aerial','aerial','72h',4,0,2,1,'high','best_fit',$6)", [tenantA, partnerOrg, provider, territory, `p16-cap-now-${suffix}`, `p16-cap-72-${suffix}`]);
    await client.query("INSERT INTO partner_risk_flags (id,tenant_id,partner_organization_id,risk_type,severity,status,source_type,source_id,reason_code,detected_at) VALUES ($1,$2,$3,'safety_critical','critical','active','daily_jsa',$4,'critical_safety_stop','2026-08-18T10:00:00Z')", [risk, tenantA, partnerOrg, crypto.randomUUID()]);

    const acceptedSourceForCash = await createProductionLineage(client, { tenantA, project, workOrder, workOrderVersion, provider, crew, worker, partnerOrg, customerOrg, internalUser, productionCode: productionCodeLf, workDate: "2026-08-19", quantity: 18400, unit: "LF", decision: "accepted", acceptedQuantity: 18400, sourceStatus: "invoiced", sourceAmount: 25000 });
    await createProductionLineage(client, { tenantA, project, workOrder, workOrderVersion, provider, crew: crewEa, worker, partnerOrg, customerOrg, internalUser, productionCode: productionCodeEa, workDate: "2026-08-19", quantity: 12, unit: "EA", decision: "accepted", acceptedQuantity: 12, sourceStatus: "eligible", sourceAmount: 500 });
    const missingRate = await createProductionLineage(client, { tenantA, project, workOrder, workOrderVersion, provider, crew, worker, partnerOrg, customerOrg, internalUser, productionCode: productionCodeLf, workDate: "2026-08-18", quantity: 1200, unit: "LF", decision: "accepted", acceptedQuantity: 1200, sourceStatus: "exception", sourceAmount: 1200 });
    await client.query("INSERT INTO financial_exceptions (tenant_id,exception_type,status,severity,project_id,work_order_id,partner_organization_id,production_record_id,customer_qc_decision_id,billable_item_id,message,safe_resolution_hint,source_fingerprint,created_by_user_id) VALUES ($1,'missing_customer_rate','open','blocking',$2,$3,$4,$5,$6,$7,'Customer rate missing','Bind a current Customer rate before billing',$8,$9)", [tenantA, project, workOrder, partnerOrg, missingRate.production, missingRate.decision, missingRate.billableItem, `p16-missing-rate-${suffix}`, internalUser]);
    await createProductionLineage(client, { tenantA, project, workOrder, workOrderVersion, provider, crew, worker, partnerOrg, customerOrg, internalUser, productionCode: productionCodeLf, workDate: "2026-08-14", quantity: 1000, unit: "LF", decision: "pending" });
    await createProductionLineage(client, { tenantA, project, workOrder, workOrderVersion, provider, crew, worker, partnerOrg, customerOrg, internalUser, productionCode: productionCodeLf, workDate: "2026-08-16", quantity: 900, unit: "LF", decision: "correction_required", correctionDueDate: "2026-08-17" });

    const invoice = crypto.randomUUID();
    const invoiceItem = crypto.randomUUID();
    const receipt = crypto.randomUUID();
    const application = crypto.randomUUID();
    await client.query("INSERT INTO invoices (id,tenant_id,organization_id,customer_organization_id,project_id,invoice_number,invoice_date,due_date,status,total_amount,invoice_amount,subtotal_amount,original_amount,paid_amount,balance_amount,payment_status,collection_status,sent_at) VALUES ($1,$2,$3,$3,$4,'P16-INV-1','2026-08-15','2026-09-14','sent',25000,25000,25000,25000,10000,15000,'partially_paid','not_due','2026-08-15T12:00:00Z')", [invoice, tenantA, customerOrg, project]);
    await client.query("INSERT INTO invoice_items (id,tenant_id,invoice_id,billable_item_id,production_record_id,work_order_id,project_id,customer_organization_id,item_type,status,description,quantity,unit,unit_rate,gross_amount,net_amount,accepted_production_source_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'customer_billable','invoiced','P16 accepted production',18400,'LF',1.3587,25000,25000,$9)", [invoiceItem, tenantA, invoice, acceptedSourceForCash.billableItem, acceptedSourceForCash.production, workOrder, project, customerOrg, acceptedSourceForCash.source]);
    await client.query("INSERT INTO cash_receipts (id,tenant_id,receipt_number,customer_organization_id,payment_date,payment_method,payment_reference,gross_received_amount,applied_amount,unapplied_amount,currency,receipt_status,clearance_status,cleared_at) VALUES ($1,$2,'P16-RCPT-1',$3,'2026-08-18','ach','safe-test-ref',10000,8000,2000,'USD','partially_applied','cleared','2026-08-18T16:00:00Z')", [receipt, tenantA, customerOrg]);
    await client.query("INSERT INTO payment_applications (id,tenant_id,cash_receipt_id,invoice_id,customer_organization_id,applied_amount,application_date,application_status,application_type) VALUES ($1,$2,$3,$4,$5,8000,'2026-08-18','applied','partial_payment')", [application, tenantA, receipt, invoice, customerOrg]);
    await client.query("INSERT INTO payment_application_allocations (tenant_id,payment_application_id,invoice_item_id,billable_item_id,accepted_production_source_id,allocated_customer_amount,allocation_method,created_by_user_id) VALUES ($1,$2,$3,$4,$5,8000,'line_level',$6)", [tenantA, application, invoiceItem, acceptedSourceForCash.billableItem, acceptedSourceForCash.source, internalUser]);
    await client.query("INSERT INTO contractor_payables (tenant_id,payable_number,payable_type,payable_party_type,status,approval_status,payment_readiness_status,payment_status,capacity_provider_id,partner_organization_id,project_id,gross_payable_amount,retainage_amount,net_payable_amount,eligible_amount,ineligible_amount,eligible_at,payment_due_at,pay_when_paid_status,paid_amount,in_flight_payment_amount,payment_execution_status) VALUES ($1,'P16-CP-1','subcontractor','capacity_provider','payment_ready','approved','ready_for_payment','not_paid',$2,$3,$4,10000,0,10000,7000,3000,'2026-08-16T12:00:00Z','2026-08-18','eligible',0,0,'not_started')", [tenantA, provider, partnerOrg, project]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { tenantA, tenantB, opportunity, partnerOrg, internalToken: token(internalUser, tenantA, secret), partnerToken: token(partnerUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret) };
}

async function createProductionLineage(
  client: Client,
  input: { tenantA: string; project: string; workOrder: string; workOrderVersion: string; provider: string; crew: string; worker: string; partnerOrg: string; customerOrg: string; internalUser: string; productionCode: string; workDate: string; quantity: number; unit: string; decision: "accepted" | "correction_required" | "pending"; acceptedQuantity?: number; sourceStatus?: string; sourceAmount?: number; correctionDueDate?: string },
) {
  const jsa = crypto.randomUUID();
  const report = crypto.randomUUID();
  const revision = crypto.randomUUID();
  const cycle = crypto.randomUUID();
  const production = crypto.randomUUID();
  const decision = crypto.randomUUID();
  const source = crypto.randomUUID();
  const billableItem = crypto.randomUUID();
  await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed','P16 work area',true,$10,$11::date + time '07:00')", [jsa, input.tenantA, input.project, input.workOrder, input.workOrderVersion, input.partnerOrg, input.provider, input.crew, input.worker, input.internalUser, input.workDate]);
  await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'submitted',$11::date + time '20:00',$10,1,'complete',$13)", [report, input.tenantA, input.project, input.workOrder, input.workOrderVersion, input.partnerOrg, input.provider, input.crew, input.worker, input.internalUser, input.workDate, jsa, input.decision === "pending" ? "pending_customer_qc" : input.decision === "accepted" ? "customer_accepted" : "customer_correction_required"]);
  await client.query("INSERT INTO daily_production_report_revisions (id,tenant_id,daily_report_id,revision_number,snapshot_json,reason,submitted_by_user_id) VALUES ($1,$2,$3,1,'{}','submitted',$4)", [revision, input.tenantA, report, input.internalUser]);
  await client.query("INSERT INTO production_records (id,tenant_id,project_id,work_order_id,work_order_version_id,capacity_provider_id,crew_id,foreman_user_id,submitted_by_user_id,submitted_by,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,production_type,qc_status,billable_status,status,daily_production_report_id,partner_organization_id,syncfield_production_code_id,syncfield_location_type,syncfield_status,locked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,$9,$10,$10,$10,$11,$11,'daily_production','pending_review','not_billable','submitted',$12,$13,$14,'route','complete',now())", [production, input.tenantA, input.project, input.workOrder, input.workOrderVersion, input.provider, input.crew, input.internalUser, input.workDate, input.quantity, input.unit, report, input.partnerOrg, input.productionCode]);
  await client.query("INSERT INTO customer_qc_cycles (id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,submitted_to_customer_at,source_reference,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12::date + time '09:00','customer-qc',$13)", [cycle, input.tenantA, input.project, input.workOrder, input.workOrderVersion, report, revision, input.partnerOrg, input.crew, input.customerOrg, input.decision === "pending" ? "awaiting_customer" : input.decision === "accepted" ? "accepted" : "awaiting_partner_correction", input.workDate, input.internalUser]);
  if (input.decision !== "pending") {
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,recorded_at,source_reference,current) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date + time '12:00','customer-qc',true)", [decision, input.tenantA, cycle, production, input.decision, input.quantity, input.acceptedQuantity ?? null, input.unit, input.decision === "accepted" ? "customer_acceptance" : "workmanship", input.internalUser, input.workDate]);
  }
  if (input.decision === "accepted") {
    await client.query("INSERT INTO billable_items (id,tenant_id,project_id,work_order_id,production_record_id,qc_review_id,customer_qc_decision_id,customer_organization_id,capacity_provider_id,crew_id,status,readiness_status,approved_quantity,billable_quantity,unit,unit_rate,rate_source,rate_confidence,estimated_billable_amount,net_billable_amount,currency,source_fingerprint,billing_exception_status) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,'ready_for_settlement','ready_for_settlement',$10,$10,$11,1,'customer_rate','confirmed',$12,$12,'USD',$13,'none')", [billableItem, input.tenantA, input.project, input.workOrder, production, decision, input.customerOrg, input.provider, input.crew, input.acceptedQuantity ?? input.quantity, input.unit === "LF" ? "feet" : "each", input.sourceAmount ?? 25000, `p16-billable-${production}`]);
    await client.query("INSERT INTO accepted_production_financial_sources (id,tenant_id,project_id,work_order_id,partner_organization_id,capacity_provider_id,crew_id,production_record_id,customer_qc_cycle_id,customer_qc_decision_id,production_code_id,production_code,accepted_quantity,unit_of_measure,customer_rate,customer_extended_amount,partner_rate,partner_extended_amount,currency,financial_status,source_fingerprint,billable_item_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'P16',$12,$13,1,$14,0.7,$15,'USD',$16,$17,$18,$19)", [source, input.tenantA, input.project, input.workOrder, input.partnerOrg, input.provider, input.crew, production, cycle, decision, input.productionCode, input.acceptedQuantity ?? input.quantity, input.unit, input.sourceAmount ?? 25000, Math.round((input.sourceAmount ?? 25000) * 0.7), input.sourceStatus ?? "exception", `p16-source-${production}`, billableItem, input.internalUser]);
  }
  if (input.decision === "correction_required") {
    await client.query("INSERT INTO production_corrections (tenant_id,qc_cycle_id,customer_qc_decision_id,daily_report_id,production_record_id,partner_organization_id,crew_id,correction_type,allowed_fields,customer_reason,partner_safe_instructions,due_date,status,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'workmanship',ARRAY['notes']::text[],'workmanship correction','Resolve correction',$8,'open',$9)", [input.tenantA, cycle, decision, report, production, input.partnerOrg, input.crew, input.correctionDueDate, input.internalUser]);
  }
  return { source, billableItem, production, decision };
}

async function sourceCounts(client: Client, tenantId: string) {
  const result = await client.query("SELECT (SELECT count(*)::int FROM opportunities WHERE tenant_id = $1) AS opportunities, (SELECT count(*)::int FROM work_orders WHERE tenant_id = $1) AS work_orders, (SELECT count(*)::int FROM partner_work_order_crew_assignments WHERE tenant_id = $1) AS assignments, (SELECT count(*)::int FROM payments WHERE tenant_id = $1) AS payments, (SELECT count(*)::int FROM contractor_payables WHERE tenant_id = $1) AS payables", [tenantId]);
  return result.rows[0];
}

async function apiJson(request: APIRequestContext, bearer: string, method: "GET" | "POST" | "PATCH", route: string, body?: unknown) {
  const options = { headers: auth(bearer), data: body };
  const response = method === "GET" ? await request.get(apiUrl(route), { headers: auth(bearer) }) : method === "PATCH" ? await request.patch(apiUrl(route), options) : await request.post(apiUrl(route), options);
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
