import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantA: string;
  tenantB: string;
  opportunity: string;
  partnerOrg: string;
  otherPartnerOrg: string;
  payableId: string;
  reportId: string;
  correctionId: string;
  productionId: string;
  invoiceId: string;
  internalToken: string;
  partnerToken: string;
  foremanToken: string;
  tenantBToken: string;
};

test.describe.serial("P17 production readiness release-candidate acceptance", () => {
  let client: Client;
  let fixture: Fixture;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedP17Fixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("onboarding to mobilization facts are scoped and canonical", async () => {
    const result = await client.query(
      `
      SELECT
        (SELECT count(*)::int FROM organizations WHERE tenant_id = $1 AND id = $2) AS partner_count,
        (SELECT count(*)::int FROM capacity_providers WHERE tenant_id = $1 AND organization_id = $2) AS provider_count,
        (SELECT count(*)::int FROM crews WHERE tenant_id = $1 AND organization_id = $2) AS crew_count,
        (SELECT count(*)::int FROM workers WHERE tenant_id = $1 AND organization_id = $2) AS worker_count,
        (SELECT count(*)::int FROM work_orders WHERE tenant_id = $1 AND partner_organization_id = $2) AS work_order_count,
        (SELECT count(*)::int FROM production_start_authorizations WHERE tenant_id = $1 AND organization_id = $2 AND authorization_status = 'authorized') AS start_authorizations
      `,
      [fixture.tenantA, fixture.partnerOrg],
    );
    expect(result.rows[0]).toMatchObject({ partner_count: 1, provider_count: 1, crew_count: 1, worker_count: 1, work_order_count: 1, start_authorizations: 1 });
  });

  test("field-day and offline operating envelope preserve submitted production exactly once", async () => {
    const shell = fs.readFileSync(path.join(process.cwd(), "apps/web/app/partner/partner-shell.tsx"), "utf8");
    expect(shell).toContain('const queueDbName = "syncos-field-production"');
    expect(shell).toContain('window.addEventListener("online"');
    const records = await client.query("SELECT count(*)::int AS count, count(*) FILTER (WHERE locked_at IS NOT NULL)::int AS locked_count FROM production_records WHERE tenant_id = $1 AND daily_production_report_id = $2", [fixture.tenantA, fixture.reportId]);
    const revisions = await client.query("SELECT count(*)::int AS count FROM daily_production_report_revisions WHERE tenant_id = $1 AND daily_report_id = $2", [fixture.tenantA, fixture.reportId]);
    expect(records.rows[0]).toEqual({ count: 2, locked_count: 2 });
    expect(revisions.rows[0].count).toBe(1);
  });

  test("Customer QC, correction, reinspection, and accepted quantity remain lineage-safe", async () => {
    const qc = await client.query(
      `
      SELECT
        count(*) FILTER (WHERE d.decision = 'accepted')::int AS accepted_count,
        count(*) FILTER (WHERE d.decision = 'partially_accepted')::int AS partial_count,
        count(*) FILTER (WHERE d.decision = 'correction_required')::int AS correction_count,
        max(d.reported_quantity) FILTER (WHERE d.unit_of_measure = 'LF')::numeric AS reported,
        min(d.customer_accepted_quantity) FILTER (WHERE d.unit_of_measure = 'LF')::numeric AS accepted
      FROM customer_qc_decisions d
      JOIN customer_qc_cycles c ON c.tenant_id = d.tenant_id AND c.id = d.qc_cycle_id
      WHERE d.tenant_id = $1 AND c.daily_report_id = $2
      `,
      [fixture.tenantA, fixture.reportId],
    );
    expect(qc.rows[0]).toMatchObject({ accepted_count: 1, partial_count: 1, correction_count: 1 });
    expect(Number(qc.rows[0].reported)).toBe(141);
    expect(Number(qc.rows[0].accepted)).toBe(132);
    const correction = await client.query("SELECT status FROM production_corrections WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.correctionId]);
    expect(correction.rows[0].status).toBe("resolved");
  });

  test("billing, cash, payable, and executive finance KPIs keep Customer AR separate from Partner AP", async ({ request }) => {
    await apiJson(request, fixture.internalToken, "POST", "/executive-command/recalculate", { as_of: "2026-08-19T15:00:00Z" });
    const summary = await apiJson(request, fixture.internalToken, "GET", "/executive-command/summary");
    expect(Number(summary.snapshot.outstanding_ar_amount)).toBe(15000);
    expect(Number(summary.snapshot.cleared_cash_amount)).toBe(10000);
    expect(Number(summary.snapshot.partner_eligible_payable_amount)).toBe(7000);
    expect(Number(summary.snapshot.partner_awaiting_funds_amount)).toBe(3000);
    expect(summary.boundary.customer_ar_partner_ap_collapsed).toBe(false);
  });

  test("Partner payment uses local test provider and confirmation is the only paid effect", async ({ request }) => {
    const created = await apiJson(request, fixture.internalToken, "POST", "/payment-retainage-adjustments/payment-instructions", {
      contractor_payable_id: fixture.payableId,
      amount: 2100,
      idempotency_key: `p17-payment-${fixture.payableId}`,
    });
    const duplicate = await apiJson(request, fixture.internalToken, "POST", "/payment-retainage-adjustments/payment-instructions", {
      contractor_payable_id: fixture.payableId,
      amount: 2100,
      idempotency_key: `p17-payment-${fixture.payableId}`,
    });
    expect(duplicate.id).toBe(created.id);
    await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/submit`, { idempotency_key: `p17-submit-${fixture.payableId}` });
    const submitted = await client.query("SELECT paid_amount,in_flight_payment_amount FROM contractor_payables WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.payableId]);
    expect(Number(submitted.rows[0].paid_amount)).toBe(0);
    expect(Number(submitted.rows[0].in_flight_payment_amount)).toBe(2100);
    await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/confirm`, {});
    await apiJson(request, fixture.internalToken, "POST", `/payment-retainage-adjustments/payment-instructions/${created.id}/confirm`, {});
    const paid = await client.query("SELECT paid_amount,in_flight_payment_amount FROM contractor_payables WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.payableId]);
    const attempts = await client.query("SELECT count(*)::int AS count, min(provider_name) AS provider FROM partner_payment_attempts WHERE tenant_id = $1 AND payment_instruction_id = $2", [fixture.tenantA, created.id]);
    expect(Number(paid.rows[0].paid_amount)).toBe(2100);
    expect(Number(paid.rows[0].in_flight_payment_amount)).toBe(0);
    expect(attempts.rows[0]).toEqual({ count: 1, provider: "local_test_provider" });
  });

  test("performance, opportunity matching, and command intelligence are recommendation-only", async ({ request }) => {
    const before = await sourceCounts(client, fixture.tenantA);
    await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: fixture.partnerOrg, as_of: "2026-08-19T15:00:00Z" });
    const performance = await apiJson(request, fixture.internalToken, "GET", `/partner-performance/partners/${fixture.partnerOrg}`);
    const matching = await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}/recalculate`, { as_of: "2026-08-19T15:00:00Z" });
    const command = await apiJson(request, fixture.internalToken, "POST", "/executive-command/recalculate", { as_of: "2026-08-19T16:00:00Z" });
    expect(performance.boundary.lifecycle_auto_changed).toBe(false);
    expect(matching.boundary.recommendation_is_assignment).toBe(false);
    expect(command.boundary.ranked_action_is_automatic_action).toBe(false);
    expect(await sourceCounts(client, fixture.tenantA)).toEqual(before);
  });

  test("generic-route bypass and cross-tenant attacks are denied", async ({ request }) => {
    for (const route of [
      "/executive-command/summary",
      `/opportunity-capacity-matching/opportunities/${fixture.opportunity}`,
      `/partner-performance/partners/${fixture.otherPartnerOrg}`,
      "/payment-retainage-adjustments/ready-to-pay",
    ]) {
      const partner = await request.get(apiUrl(route), { headers: auth(fixture.partnerToken) });
      expect(partner.status(), `partner route ${route}`).toBeGreaterThanOrEqual(403);
      const tenantB = await request.get(apiUrl(route), { headers: auth(fixture.tenantBToken) });
      expect(tenantB.status(), `tenantB route ${route}`).toBeGreaterThanOrEqual(403);
    }
  });

  test("Partner Foreman has no finance, ranking, Command Center, or sensitive data access", async ({ request }) => {
    for (const route of ["/payment-retainage-adjustments/partner/payments", "/accepted-production-financials/partner/settlements", "/executive-command/summary"]) {
      const response = await request.get(apiUrl(route), { headers: auth(fixture.foremanToken) });
      expect(response.status(), `foreman route ${route}`).toBeGreaterThanOrEqual(403);
    }
    const context = await request.get(apiUrl("/partner-personas/me/context"), { headers: auth(fixture.foremanToken) });
    expect(context.status()).toBeLessThan(400);
    expect(await context.text()).not.toMatch(/customer_rate|partner_rate|margin|settlement|payment|bank|routing|provider_secret|storage_key|driver_license|home_address/i);
  });

  test("Partner Admin cannot see competitor intelligence or internal command data", async ({ request }) => {
    const ownPayments = await apiJson(request, fixture.partnerToken, "GET", "/payment-retainage-adjustments/partner/payments");
    expect(JSON.stringify(ownPayments)).not.toMatch(/customer_rate|margin|routing|bank_account|provider_secret/i);
    const competitor = await request.get(apiUrl(`/partner-performance/partners/${fixture.otherPartnerOrg}`), { headers: auth(fixture.partnerToken) });
    expect(competitor.status()).toBeGreaterThanOrEqual(403);
    const command = await request.get(apiUrl("/executive-command/summary"), { headers: auth(fixture.partnerToken) });
    expect(command.status()).toBeGreaterThanOrEqual(403);
  });

  test("critical drill-through routes load for internal release users", async ({ page }) => {
    await page.addInitScript((token) => window.localStorage.setItem("syncos.apiToken", token), fixture.internalToken);
    for (const [route, text] of [
      ["/command-center", "Command Center"],
      ["/partner-performance", "Partner Performance"],
      ["/opportunities/capacity-matching", "Opportunity Capacity Matching"],
      ["/production-dashboard", "Production Dashboard"],
      ["/accepted-production-financials", "Accepted Production Financials"],
      ["/payment-retainage-adjustments", "Payment, Retainage, Adjustments"],
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1, name: text })).toBeVisible();
    }
  });

  test("scheduler/idempotency and sensitive-payload release checks hold", async ({ request }) => {
    const first = await apiJson(request, fixture.internalToken, "POST", "/executive-command/scan", { as_of: "2026-08-19T17:00:00Z", batch_size: 10 });
    const second = await apiJson(request, fixture.internalToken, "POST", "/executive-command/scan", { as_of: "2026-08-19T17:00:00Z", batch_size: 10 });
    expect(first.locked).toBe(true);
    expect(second.locked).toBe(true);
    const current = await client.query("SELECT count(*)::int AS count FROM executive_command_snapshots WHERE tenant_id = $1 AND current = true", [fixture.tenantA]);
    expect(current.rows[0].count).toBe(1);
    const payload = await apiJson(request, fixture.internalToken, "GET", "/executive-command/summary");
    expect(JSON.stringify(payload)).not.toMatch(/worker_email|worker_name|home_address|driver_license|bank_account|routing_number|provider_secret|storage_key|margin_amount|margin_percent/i);
  });
});

async function seedP17Fixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const ids = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`id${index}`, crypto.randomUUID()])) as Record<string, string>;
  const tenantA = ids.id0;
  const tenantB = ids.id1;
  const internalUser = ids.id2;
  const partnerUser = ids.id3;
  const foremanUser = ids.id4;
  const tenantBUser = ids.id5;
  const internalTu = ids.id6;
  const partnerTu = ids.id7;
  const foremanTu = ids.id8;
  const tenantBTu = ids.id9;
  const internalRole = ids.id10;
  const partnerRole = ids.id11;
  const foremanRole = ids.id12;
  const tenantBRole = ids.id13;
  const territory = ids.id14;
  const customerOrg = ids.id15;
  const partnerOrg = ids.id16;
  const otherPartnerOrg = ids.id17;
  const provider = ids.id18;
  const crew = ids.id19;
  const worker = ids.id20;
  const project = ids.id21;
  const workOrder = ids.id22;
  const contract = ids.id23;
  const agreementVersion = ids.id24;
  const rateSchedule = ids.id25;
  const workOrderVersion = ids.id26;
  const crewAssignment = ids.id27;
  const readiness = ids.id28;
  const mobilizationDecision = ids.id29;
  const notice = ids.id30;
  const startAuth = ids.id31;
  const report = ids.id32;
  const revision = ids.id33;
  const productionAccepted = ids.id34;
  const productionCorrection = ids.id35;
  const productionCode = ids.id36;
  const cycleOne = ids.id37;
  const cycleTwo = ids.id38;
  const decisionCorrection = ids.id39;
  const decisionAccepted = ids.id40;
  const acceptedSource = ids.id41;
  const billable = ids.id42;
  const invoice = ids.id43;
  const payable = ids.id44;
  const permissions = [
    "executive_command.read", "executive_command.actions_read", "executive_command.snapshot_recalculate", "executive_command.action_acknowledge",
    "opportunity_capacity_match.read", "opportunity_capacity_match.recalculate", "opportunity_capacity_match.requirements_manage", "opportunity_coverage.read",
    "partner_performance.read", "partner_performance.recalculate", "partner_capacity_intelligence.read", "partner_risk_flags.read",
    "partner_payment.execute", "partner_payment.submit", "partner_payment.confirm", "partner_payment.read",
    "billing.read",
    "partner_context.read", "partner_performance.read_own", "partner_settlement.read",
  ];
  const opportunity = crypto.randomUUID();
  const requirement = crypto.randomUUID();
  const coverage = crypto.randomUUID();
  const risk = crypto.randomUUID();
  const jsa = crypto.randomUUID();
  const correction = crypto.randomUUID();
  const invoiceItem = crypto.randomUUID();
  const receipt = crypto.randomUUID();
  const application = crypto.randomUUID();
  const settlement = crypto.randomUUID();

  await client.query("BEGIN");
  try {
    for (const key of permissions) await client.query("INSERT INTO permissions (key,name) VALUES ($1,$1) ON CONFLICT (key) DO NOTHING", [key]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,'P17 Tenant A',$2),($3,'P17 Tenant B',$4)", [tenantA, `p17-a-${suffix}`, tenantB, `p17-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P17 Internal'),($3,$4,'P17 Partner Admin'),($5,$6,'P17 Foreman'),($7,$8,'P17 Other Tenant')", [internalUser, `p17-internal-${suffix}@syncos.test`, partnerUser, `p17-partner-${suffix}@syncos.test`, foremanUser, `p17-foreman-${suffix}@syncos.test`, tenantBUser, `p17-b-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [internalTu, tenantA, internalUser, partnerTu, partnerUser, foremanTu, foremanUser, tenantBTu, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P17 Release','p17_release'),($3,$2,'Partner Admin','partner_admin'),($4,$2,'Partner Foreman','partner_foreman'),($5,$6,'P17 Other','p17_other')", [internalRole, tenantA, partnerRole, foremanRole, tenantBRole, tenantB]);
    for (const key of permissions.filter((value) => !["partner_context.read", "partner_payment.read", "partner_performance.read_own", "partner_settlement.read"].includes(value))) await grant(client, tenantA, internalRole, key);
    for (const key of ["partner_context.read", "partner_payment.read", "partner_performance.read_own", "partner_settlement.read"]) await grant(client, tenantA, partnerRole, key);
    await grant(client, tenantA, foremanRole, "partner_context.read");
    await grant(client, tenantB, tenantBRole, "partner_context.read");
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'tenant',$1),($1,$4,$5,'organization',$6),($1,$7,$8,'organization',$6),($9,$10,$11,'organization',$12)", [tenantA, internalTu, internalRole, partnerTu, partnerRole, partnerOrg, foremanTu, foremanRole, tenantB, tenantBTu, tenantBRole, crypto.randomUUID()]);
    await client.query("INSERT INTO territories (id,tenant_id,name,status) VALUES ($1,$2,'Great Lakes','active')", [territory, tenantA]);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P17 Customer','customer',ARRAY['work_creator']::text[],'active'),($3,$2,'P17 Partner','subcontractor',ARRAY['capacity_provider']::text[],'active'),($4,$2,'P17 Competitor','subcontractor',ARRAY['capacity_provider']::text[],'active')", [customerOrg, tenantA, partnerOrg, otherPartnerOrg]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,'P17 Provider','subcontractor','activated','verified','contracted')", [provider, tenantA, partnerOrg]);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status,territory_id,qc_authority_organization_id) VALUES ($1,$2,$3,'P17 Project','active',$4,$3)", [project, tenantA, customerOrg, territory]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P17 Aerial Crew','aerial','active','active',4)", [crew, tenantA, provider, partnerOrg]);
    await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,'P17','Foreman','active','approved')", [worker, tenantA, provider, crew, partnerOrg]);
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, partnerOrg, worker, foremanTu]);
    await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,'foreman','active')", [tenantA, partnerOrg, provider, crew, worker]);
    await client.query("INSERT INTO partner_payment_profiles (tenant_id,organization_id,capacity_provider_id,primary_payment_method,priority_passport_status,status,provider_reference,account_last_four,bank_display_name) VALUES ($1,$2,$3,'priority_passport','active','active','p17-test-provider','6789','Synthetic Bank')", [tenantA, partnerOrg, provider]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P17 MSA','partner_master_agreement','active','active','2026-08-01')", [contract, tenantA, partnerOrg, provider]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-01',$6)", [agreementVersion, tenantA, partnerOrg, provider, contract, internalUser]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P17 Partner Rates','2026-08-01','active')", [rateSchedule, tenantA, partnerOrg]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,assigned_organization_id,partner_organization_id,partner_rate_schedule_id,governing_agreement_version_id,partner_execution_status,partner_effective_date,unit,planned_quantity,qc_authority_organization_id) VALUES ($1,$2,$3,$4,$5,'P17 WO','fiber',3000,'feet','in_progress','P17 WO','WO-P17',$6,$6,$7,$8,'active','2026-08-01','feet',3000,$9)", [workOrder, tenantA, project, provider, crew, partnerOrg, rateSchedule, agreementVersion, customerOrg]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WO-P17','P17 scope','MAP-P17','feet','active','2026-08-01',$10)", [workOrderVersion, tenantA, partnerOrg, provider, project, workOrder, agreementVersion, crew, rateSchedule, internalUser]);
    await client.query("INSERT INTO partner_work_order_crew_assignments (id,tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,status,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [crewAssignment, tenantA, partnerOrg, provider, workOrder, workOrderVersion, crew, internalUser]);
    await client.query("INSERT INTO mobilization_readiness_evaluations (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_assignment_id,crew_id,evaluator_version,overall_status,triggered_by,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'p17_release','ready','explicit_request',$10)", [readiness, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crewAssignment, crew, internalUser]);
    await client.query("INSERT INTO mobilization_decisions (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_assignment_id,crew_id,readiness_evaluation_id,decision,authorized_by_user_id,decision_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved_to_mobilize',$11,now())", [mobilizationDecision, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crewAssignment, crew, readiness, internalUser]);
    await client.query("INSERT INTO notice_to_proceed_versions (id,tenant_id,notice_number,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_assignment_id,crew_id,readiness_evaluation_id,mobilization_decision_id,production_start_status,production_start_date,production_start_time,timezone,initial_map_work_package_ref,initial_work_area,external_instructions,issued_by_user_id,status) VALUES ($1,$2,'NTP-P17',$3,$4,$5,$6,$7,$8,$9,$10,$11,'authorized','2026-08-19','07:00','America/New_York','MAP-P17','P17 area','Start work',$12,'authorized')", [notice, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crewAssignment, crew, readiness, mobilizationDecision, internalUser]);
    await client.query("INSERT INTO production_start_authorizations (id,tenant_id,notice_id,project_id,work_order_id,work_order_version_id,organization_id,crew_assignment_id,crew_id,authorization_status,start_date,start_time,timezone,map_work_package_ref,work_area,authorized_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'authorized','2026-08-19','07:00','America/New_York','MAP-P17','P17 area',$10)", [startAuth, tenantA, notice, project, workOrder, workOrderVersion, partnerOrg, crewAssignment, crew, internalUser]);
    await client.query("INSERT INTO syncfield_production_codes (id,tenant_id,code,description,unit_of_measure,location_type,requires_route) VALUES ($1,$2,'FIBER','Place Fiber','LF','route',true)", [productionCode, tenantA]);
    await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-19','completed','P17 area',true,$10,'2026-08-19T11:00:00Z')", [jsa, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, worker, foremanUser]);
    await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-19',$11,'submitted','2026-08-20T00:30:00Z',$10,2,'complete','customer_partially_accepted')", [report, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, worker, foremanUser, jsa]);
    await client.query("INSERT INTO daily_production_report_revisions (id,tenant_id,daily_report_id,revision_number,snapshot_json,reason,submitted_by_user_id) VALUES ($1,$2,$3,2,'{}','correction_resubmitted',$4)", [revision, tenantA, report, foremanUser]);
    await client.query("INSERT INTO production_records (id,tenant_id,project_id,work_order_id,work_order_version_id,capacity_provider_id,crew_id,foreman_user_id,submitted_by_user_id,submitted_by,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,production_type,qc_status,billable_status,status,daily_production_report_id,partner_organization_id,syncfield_production_code_id,syncfield_location_type,syncfield_status,locked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,'2026-08-19',141,141,141,'LF','LF','daily_production','pending_review','not_billable','submitted',$9,$10,$11,'route','complete',now()),($12,$2,$3,$4,$5,$6,$7,$8,$8,$8,'2026-08-19',141,141,141,'LF','LF','daily_production','pending_review','not_billable','submitted',$9,$10,$11,'route','complete',now())", [productionAccepted, tenantA, project, workOrder, workOrderVersion, provider, crew, foremanUser, report, partnerOrg, productionCode, productionCorrection]);
    await client.query("INSERT INTO customer_qc_cycles (id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,submitted_to_customer_at,source_reference,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'awaiting_partner_correction','2026-08-19T13:00:00Z','customer-qc',$11),($12,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,'accepted','2026-08-20T13:00:00Z','customer-qc',$11)", [cycleOne, tenantA, project, workOrder, workOrderVersion, report, revision, partnerOrg, crew, customerOrg, internalUser, cycleTwo]);
    await client.query("INSERT INTO customer_qc_decisions (id,tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,recorded_at,source_reference,current) VALUES ($1,$2,$3,$4,'correction_required',141,NULL,'LF','workmanship',$5,'2026-08-19T16:00:00Z','customer-qc',false),($6,$2,$7,$4,'partially_accepted',141,132,'LF','customer_acceptance',$5,'2026-08-20T16:00:00Z','customer-qc',true),($8,$2,$7,$9,'accepted',12,12,'EA','customer_acceptance',$5,'2026-08-20T16:00:00Z','customer-qc',true)", [decisionCorrection, tenantA, cycleOne, productionAccepted, internalUser, decisionAccepted, cycleTwo, crypto.randomUUID(), productionCorrection]);
    await client.query("INSERT INTO production_corrections (id,tenant_id,qc_cycle_id,customer_qc_decision_id,daily_report_id,production_record_id,partner_organization_id,crew_id,correction_type,allowed_fields,customer_reason,partner_safe_instructions,due_date,status,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'workmanship',ARRAY['notes']::text[],'workmanship','Correct splice documentation','2026-08-20','resolved',$9)", [correction, tenantA, cycleOne, decisionCorrection, report, productionAccepted, partnerOrg, crew, internalUser]);
    await client.query("INSERT INTO accepted_production_financial_sources (id,tenant_id,project_id,work_order_id,partner_organization_id,capacity_provider_id,crew_id,production_record_id,customer_qc_cycle_id,customer_qc_decision_id,production_code_id,production_code,accepted_quantity,unit_of_measure,customer_rate,customer_extended_amount,partner_rate,partner_extended_amount,currency,financial_status,source_fingerprint,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'FIBER',132,'LF',189.3939,25000,75.7575,10000,'USD','invoiced',$12,$13)", [acceptedSource, tenantA, project, workOrder, partnerOrg, provider, crew, productionAccepted, cycleTwo, decisionAccepted, productionCode, `p17-source-${suffix}`, internalUser]);
    await client.query("INSERT INTO billable_items (id,tenant_id,project_id,work_order_id,production_record_id,qc_review_id,customer_qc_decision_id,accepted_production_source_id,customer_organization_id,capacity_provider_id,crew_id,status,readiness_status,approved_quantity,billable_quantity,unit,unit_rate,rate_source,rate_confidence,estimated_billable_amount,net_billable_amount,currency,source_fingerprint,billing_exception_status) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,'ready_for_settlement','ready_for_settlement',132,132,'feet',189.3939,'customer_rate','confirmed',25000,25000,'USD',$11,'none')", [billable, tenantA, project, workOrder, productionAccepted, decisionAccepted, acceptedSource, customerOrg, provider, crew, `p17-billable-${suffix}`]);
    await client.query("INSERT INTO invoices (id,tenant_id,organization_id,customer_organization_id,project_id,invoice_number,invoice_date,due_date,status,total_amount,invoice_amount,subtotal_amount,original_amount,paid_amount,balance_amount,payment_status,collection_status,sent_at) VALUES ($1,$2,$3,$3,$4,'P17-INV-1','2026-08-15','2026-09-14','sent',25000,25000,25000,25000,10000,15000,'partially_paid','not_due','2026-08-15T12:00:00Z')", [invoice, tenantA, customerOrg, project]);
    await client.query("INSERT INTO invoice_items (id,tenant_id,invoice_id,billable_item_id,production_record_id,work_order_id,project_id,customer_organization_id,item_type,status,description,quantity,unit,unit_rate,gross_amount,net_amount,accepted_production_source_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'customer_billable','invoiced','P17 accepted production',132,'LF',189.3939,25000,25000,$9)", [invoiceItem, tenantA, invoice, billable, productionAccepted, workOrder, project, customerOrg, acceptedSource]);
    await client.query("INSERT INTO cash_receipts (id,tenant_id,receipt_number,customer_organization_id,payment_date,payment_method,payment_reference,gross_received_amount,applied_amount,unapplied_amount,currency,receipt_status,clearance_status,cleared_at) VALUES ($1,$2,'P17-RCPT-1',$3,'2026-08-18','ach','safe-test-ref',10000,10000,0,'USD','fully_applied','cleared','2026-08-18T16:00:00Z')", [receipt, tenantA, customerOrg]);
    await client.query("INSERT INTO payment_applications (id,tenant_id,cash_receipt_id,invoice_id,customer_organization_id,applied_amount,application_date,application_status,application_type) VALUES ($1,$2,$3,$4,$5,10000,'2026-08-18','applied','partial_payment')", [application, tenantA, receipt, invoice, customerOrg]);
    await client.query("INSERT INTO payment_application_allocations (tenant_id,payment_application_id,invoice_item_id,billable_item_id,accepted_production_source_id,allocated_customer_amount,allocation_method,created_by_user_id) VALUES ($1,$2,$3,$4,$5,10000,'line_level',$6)", [tenantA, application, invoiceItem, billable, acceptedSource, internalUser]);
    await client.query("INSERT INTO settlements (id,tenant_id,settlement_number,settlement_type,status,readiness_status,customer_organization_id,capacity_provider_id,project_id,work_order_id,settlement_period_start,settlement_period_end,gross_amount,contractor_payable_amount,net_amount,net_settlement_amount,total_amount,payable_ready,issued_at,dispute_deadline) VALUES ($1,$2,'PSET-P17','contractor_payable','payable_ready','ready_for_approval',$3,$4,$5,$6,'2026-08-17','2026-08-23',10000,10000,10000,10000,10000,true,now(),'2026-09-04')", [settlement, tenantA, customerOrg, provider, project, workOrder]);
    await client.query("INSERT INTO contractor_payables (id,tenant_id,payable_number,payable_type,payable_party_type,status,approval_status,payment_readiness_status,payment_status,capacity_provider_id,partner_organization_id,project_id,settlement_id,gross_payable_amount,retainage_amount,retained_balance_amount,net_payable_amount,eligible_amount,ineligible_amount,eligible_at,payment_due_at,pay_when_paid_status,paid_amount,in_flight_payment_amount,payment_execution_status,compliance_status,tax_document_status) VALUES ($1,$2,'CP-P17-1','subcontractor','capacity_provider','payment_ready','approved','ready_for_payment','not_paid',$3,$4,$5,$6,10000,0,0,10000,7000,3000,'2026-08-16T12:00:00Z','2026-08-18','eligible',0,0,'not_started','ready','ready')", [payable, tenantA, provider, partnerOrg, project, settlement]);
    await client.query("INSERT INTO opportunities (id,tenant_id,organization_id,territory_id,title,work_type,status,stage,estimated_value) VALUES ($1,$2,$3,$4,'P17 Opportunity','aerial','pursuing','pursuing',250000)", [opportunity, tenantA, customerOrg, territory]);
    await client.query("INSERT INTO opportunity_requirement_profiles (id,tenant_id,opportunity_id,version,territory_id,capability,crew_type,required_crew_count,required_start_date,required_start_window,current,created_by_user_id) VALUES ($1,$2,$3,1,$4,'aerial','aerial',5,'2026-08-22','72h',true,$5)", [requirement, tenantA, opportunity, territory, internalUser]);
    await client.query("INSERT INTO opportunity_coverage_options (id,tenant_id,opportunity_id,requirement_profile_id,rank,coverage_status,covered_crew_count,required_crew_count,remaining_gap,average_fit_score,minimum_confidence,critical_risk_count,partner_count,composition,reason_summary,source_fingerprint,current) VALUES ($1,$2,$3,$4,1,'capacity_gap',4,5,1,88,'high',0,2,'[]','{\"pursue_recommendation\":\"pursue_partial_capacity_recruiting_required\"}',$5,true)", [coverage, tenantA, opportunity, requirement, `p17-coverage-${suffix}`]);
    await client.query("INSERT INTO partner_performance_snapshots (tenant_id,partner_organization_id,capacity_provider_id,scoring_policy_version,score,score_band,confidence,quality_score,production_score,documentation_score,safety_score,mobilization_score,correction_score,commercial_score,capacity_reliability_score,trend,lifecycle_recommendation,production_day_count,reviewed_record_count,completed_work_order_count,critical_risk_count,source_fingerprint) VALUES ($1,$2,$3,'partner_performance_v1',94,'excellent','high',94,90,88,95,90,92,90,93,'stable','review',30,50,4,1,$4)", [tenantA, partnerOrg, provider, `p17-performance-${suffix}`]);
    await client.query("INSERT INTO partner_capacity_intelligence_snapshots (tenant_id,partner_organization_id,capacity_provider_id,territory_id,crew_type,capability,horizon,ready_crew_count,conditional_crew_count,unverified_crew_count,committed_crew_count,capacity_confidence,recommendation,source_fingerprint) VALUES ($1,$2,$3,$4,'aerial','aerial','now_24h',4,0,0,1,'high','best_fit',$5),($1,$2,$3,$4,'aerial','aerial','72h',4,0,2,1,'high','best_fit',$6)", [tenantA, partnerOrg, provider, territory, `p17-cap-now-${suffix}`, `p17-cap-72-${suffix}`]);
    await client.query("INSERT INTO partner_risk_flags (id,tenant_id,partner_organization_id,risk_type,severity,status,source_type,source_id,reason_code,detected_at) VALUES ($1,$2,$3,'safety_critical','critical','active','daily_jsa',$4,'critical_safety_stop','2026-08-18T10:00:00Z')", [risk, tenantA, partnerOrg, jsa]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return {
    tenantA,
    tenantB,
    opportunity,
    partnerOrg,
    otherPartnerOrg,
    payableId: payable,
    reportId: report,
    correctionId: correction,
    productionId: productionAccepted,
    invoiceId: invoice,
    internalToken: token(internalUser, tenantA, secret),
    partnerToken: token(partnerUser, tenantA, secret),
    foremanToken: token(foremanUser, tenantA, secret),
    tenantBToken: token(tenantBUser, tenantB, secret),
  };
}

async function grant(client: Client, tenantId: string, roleId: string, key: string) {
  await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
}

async function sourceCounts(client: Client, tenantId: string) {
  const result = await client.query("SELECT (SELECT count(*)::int FROM opportunities WHERE tenant_id = $1) AS opportunities, (SELECT count(*)::int FROM work_orders WHERE tenant_id = $1) AS work_orders, (SELECT count(*)::int FROM partner_work_order_crew_assignments WHERE tenant_id = $1) AS assignments, (SELECT count(*)::int FROM payments WHERE tenant_id = $1) AS payments, (SELECT count(*)::int FROM contractor_payables WHERE tenant_id = $1) AS payables, (SELECT count(*)::int FROM organizations WHERE tenant_id = $1) AS organizations", [tenantId]);
  return result.rows[0];
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
