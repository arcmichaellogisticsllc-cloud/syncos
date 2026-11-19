import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantA: string;
  tenantB: string;
  partnerOrg: string;
  otherPartnerOrg: string;
  internalToken: string;
  partnerToken: string;
  foremanToken: string;
  tenantBToken: string;
};

test.describe.serial("P14 Partner performance, reputation, and capacity intelligence", () => {
  let client: Client;
  let fixture: Fixture;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedP14Fixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("recalculation creates one explainable versioned score snapshot and is idempotent", async ({ request }) => {
    const first = await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: fixture.partnerOrg });
    const snapshot = first.snapshots[0];
    expect(snapshot.scoring_policy_version).toBe("partner_performance_v1");
    expect(Number(snapshot.score)).toBeGreaterThanOrEqual(0);
    expect(Number(snapshot.score)).toBeLessThanOrEqual(100);
    expect(snapshot.confidence).toBe("medium");
    expect(snapshot.lifecycle_recommendation).toBe("promote");

    const retry = await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: fixture.partnerOrg });
    expect(retry.snapshots[0].id).toBe(snapshot.id);
    const components = await client.query("SELECT count(*)::int AS count, sum(weight)::numeric AS weight FROM partner_performance_score_components WHERE tenant_id = $1 AND snapshot_id = $2", [fixture.tenantA, snapshot.id]);
    expect(components.rows[0].count).toBe(8);
    expect(Number(components.rows[0].weight)).toBe(100);
  });

  test("Daily Report timeliness uses operational timezone and leaves missing timezone unevaluated", async ({ request }) => {
    const onTime = await createTimelinessCase(client, fixture, "America/New_York", "2026-08-19", "2026-08-20T00:59:00Z");
    const late = await createTimelinessCase(client, fixture, "America/New_York", "2026-08-19", "2026-08-20T01:01:00Z");
    const dst = await createTimelinessCase(client, fixture, "America/New_York", "2026-11-01", "2026-11-02T00:59:00Z");
    const pacific = await createTimelinessCase(client, fixture, "America/Los_Angeles", "2026-08-19", "2026-08-20T03:59:00Z");
    const missing = await createTimelinessCase(client, fixture, null, "2026-08-19", "2026-08-20T00:59:00Z");
    const utc = await createTimelinessCase(client, fixture, "UTC", "2026-08-19", "2026-08-19T21:00:00Z");
    const cases = [onTime, late, dst, pacific, missing, utc];

    for (const item of cases) await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: item.partnerOrg, as_of: "2026-08-20T12:00:00Z" });

    async function source(partnerOrg: string) {
      const result = await client.query(
        "SELECT c.source_summary FROM partner_performance_score_components c JOIN partner_performance_snapshots s ON s.tenant_id = c.tenant_id AND s.id = c.snapshot_id WHERE s.tenant_id = $1 AND s.partner_organization_id = $2 AND s.current = true AND c.dimension = 'documentation'",
        [fixture.tenantA, partnerOrg],
      );
      return result.rows[0].source_summary as Record<string, unknown>;
    }

    expect(await source(onTime.partnerOrg)).toMatchObject({ evaluated_reports: 1, on_time_reports: 1, timezone_missing_reports: 0 });
    expect(await source(late.partnerOrg)).toMatchObject({ evaluated_reports: 1, on_time_reports: 0, timezone_missing_reports: 0 });
    expect(await source(dst.partnerOrg)).toMatchObject({ evaluated_reports: 1, on_time_reports: 1, timezone_missing_reports: 0 });
    expect(await source(pacific.partnerOrg)).toMatchObject({ evaluated_reports: 1, on_time_reports: 1, timezone_missing_reports: 0 });
    expect(await source(missing.partnerOrg)).toMatchObject({ evaluated_reports: 0, on_time_reports: 0, timezone_missing_reports: 1 });
    expect(await source(utc.partnerOrg)).toMatchObject({ evaluated_reports: 1, on_time_reports: 1, timezone_missing_reports: 0 });
  });

  test("quality, sample size, mixed units, and critical risk stay separate and explainable", async ({ request }) => {
    const detail = await apiJson(request, fixture.internalToken, "GET", `/partner-performance/partners/${fixture.partnerOrg}`);
    const quality = detail.components.find((row: Record<string, unknown>) => row.dimension === "quality");
    const production = detail.components.find((row: Record<string, unknown>) => row.dimension === "production");
    const documentation = detail.components.find((row: Record<string, unknown>) => row.dimension === "documentation");
    expect(quality.source_summary.reviewed).toBe(6);
    expect(quality.source_summary.correctionRequired).toBeUndefined();
    expect(quality.source_summary.correction_required).toBe(1);
    expect(production.source_summary.target_lf_per_day).toBe(3000);
    expect(documentation.source_summary.report_due_policy).toBe("21:00 operational timezone same production day");
    expect(JSON.stringify(detail)).not.toMatch(/customer_rate|contractor_rate|margin|bank|provider_secret/i);
    expect(detail.boundary.lifecycle_auto_changed).toBe(false);
    expect(detail.crew_performance[0].worker_ranking).toBe(false);

    await client.query("INSERT INTO partner_risk_flags (tenant_id,partner_organization_id,risk_type,severity,source_type,source_id,reason_code) VALUES ($1,$2,'safety_critical','critical','daily_jsa',$3,'severe_stop_work_source')", [fixture.tenantA, fixture.partnerOrg, crypto.randomUUID()]);
    const withRisk = await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: fixture.partnerOrg });
    expect(withRisk.snapshots[0].critical_risk_count).toBe(1);
    expect(withRisk.snapshots[0].lifecycle_recommendation).toBe("suspend_review");
  });

  test("capacity intelligence distinguishes verified ready capacity from unverified stated capacity", async ({ request }) => {
    await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", {});
    const capacity = await apiJson(request, fixture.internalToken, "GET", "/partner-performance/capacity?horizon=now_24h&capability=aerial");
    const ready = capacity.find((row: Record<string, unknown>) => row.partner_organization_id === fixture.partnerOrg);
    const unverified = capacity.find((row: Record<string, unknown>) => row.partner_organization_id === fixture.otherPartnerOrg);
    expect(ready.ready_crew_count).toBeGreaterThan(0);
    expect(ready.capacity_confidence).not.toBe("low");
    expect(unverified.unverified_crew_count).toBeGreaterThan(0);
    expect(unverified.capacity_confidence).toBe("low");
    expect(unverified.recommendation).toBe("available_low_confidence");
    const allCapacity = await apiJson(request, fixture.internalToken, "GET", "/partner-performance/capacity?capability=aerial");
    const horizons = allCapacity
      .filter((row: Record<string, unknown>) => row.partner_organization_id === fixture.partnerOrg)
      .map((row: Record<string, unknown>) => row.horizon)
      .sort();
    expect(horizons).toEqual(["1_week", "2_weeks", "30_days", "60_days", "72h", "now_24h"]);
  });

  test("run-once scheduled scan is locked, idempotent, and time-sensitive for capacity horizons and critical risk", async ({ request }) => {
    const scheduled = await createTimelinessCase(client, fixture, "America/New_York", "2026-08-19", "2026-08-20T00:59:00Z", { availabilityStart: "2026-08-26" });
    await client.query("INSERT INTO partner_risk_flags (tenant_id,partner_organization_id,risk_type,severity,source_type,source_id,reason_code,detected_at) VALUES ($1,$2,'safety_critical','critical','daily_jsa',$3,'scheduled_critical_risk','2026-08-19T12:00:00Z')", [fixture.tenantA, scheduled.partnerOrg, crypto.randomUUID()]);
    const first = await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: scheduled.partnerOrg, as_of: "2026-08-19T12:00:00Z" });
    const retry = await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: scheduled.partnerOrg, as_of: "2026-08-19T12:00:00Z" });
    expect(retry.snapshots[0].id).toBe(first.snapshots[0].id);
    expect(first.snapshots[0].critical_risk_count).toBe(1);
    expect(first.snapshots[0].lifecycle_recommendation).toBe("suspend_review");

    const future = await apiJson(request, fixture.internalToken, "POST", "/partner-performance/recalculate", { partner_organization_id: scheduled.partnerOrg, as_of: "2026-08-25T12:00:00Z" });
    expect(future.snapshots[0].id).not.toBe(first.snapshots[0].id);
    expect(future.snapshots[0].critical_risk_count).toBe(1);
    expect(future.snapshots[0].lifecycle_recommendation).toBe("suspend_review");
    const capacity = await apiJson(request, fixture.internalToken, "GET", "/partner-performance/capacity?capability=aerial");
    const currentRows = capacity.filter((row: Record<string, unknown>) => row.partner_organization_id === scheduled.partnerOrg);
    expect(currentRows.find((row: Record<string, unknown>) => row.horizon === "now_24h")?.ready_crew_count).toBeGreaterThan(0);
    const count = await client.query("SELECT count(*)::int AS count FROM partner_performance_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2", [fixture.tenantA, scheduled.partnerOrg]);
    expect(count.rows[0].count).toBe(2);
  });

  test("Partner Admin sees only own safe scorecard; Foreman and cross-tenant access are denied", async ({ request }) => {
    const partner = await apiJson(request, fixture.partnerToken, "GET", "/partner-performance/partner/summary");
    expect(partner.score).toBeGreaterThanOrEqual(0);
    expect(partner.boundary.competitive_rank_visible).toBe(false);
    expect(JSON.stringify(partner)).not.toMatch(/customer_rate|contractor_rate|margin|bank|worker_id|internal_investigation/i);

    const foreman = await request.get(apiUrl("/partner-performance/partner/summary"), { headers: auth(fixture.foremanToken) });
    expect(foreman.status()).toBeGreaterThanOrEqual(403);
    const cross = await request.get(apiUrl("/partner-performance/partners/" + fixture.partnerOrg), { headers: auth(fixture.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);

    const org = await client.query("SELECT status FROM organizations WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.partnerOrg]);
    expect(org.rows[0].status).toBe("active");
    const financialCounts = await client.query("SELECT (SELECT count(*)::int FROM payments WHERE tenant_id = $1) AS payments, (SELECT count(*)::int FROM financial_adjustments WHERE tenant_id = $1) AS adjustments", [fixture.tenantA]);
    expect(financialCounts.rows[0]).toEqual({ payments: 0, adjustments: 0 });
  });
});

async function seedP14Fixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const partnerOrg = crypto.randomUUID();
  const otherPartnerOrg = crypto.randomUUID();
  const tenantBPartnerOrg = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const provider = crypto.randomUUID();
  const otherProvider = crypto.randomUUID();
  const contract = crypto.randomUUID();
  const agreementVersion = crypto.randomUUID();
  const rateSchedule = crypto.randomUUID();
  const crew = crypto.randomUUID();
  const otherCrew = crypto.randomUUID();
  const foremanWorker = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const partnerUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
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
  const productionCode = crypto.randomUUID();
  const dailyCode = crypto.randomUUID();
  const territory = crypto.randomUUID();
  const permissions = [
    "partner_performance.read",
    "partner_performance.recalculate",
    "partner_reputation.read",
    "partner_lifecycle_recommendation.read",
    "partner_capacity_intelligence.read",
    "partner_risk_flags.read",
    "partner_performance.read_own",
    "partner_context.read",
  ];
  await client.query("BEGIN");
  try {
    for (const key of permissions) await client.query("INSERT INTO permissions (key,name) VALUES ($1,$1) ON CONFLICT (key) DO NOTHING", [key]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,'P14 Tenant A',$2),($3,'P14 Tenant B',$4)", [tenantA, `p14-a-${suffix}`, tenantB, `p14-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P14 Internal'),($3,$4,'P14 Partner'),($5,$6,'P14 Foreman'),($7,$8,'P14 Tenant B')", [internalUser, `p14-internal-${suffix}@syncos.test`, partnerUser, `p14-partner-${suffix}@syncos.test`, foremanUser, `p14-foreman-${suffix}@syncos.test`, tenantBUser, `p14-b-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$9,$10)", [internalTu, tenantA, internalUser, partnerTu, partnerUser, foremanTu, foremanUser, tenantBTu, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P14 Internal','p14_internal'),($3,$2,'Partner Admin','partner_admin'),($4,$2,'Partner Foreman','partner_foreman'),($5,$6,'P14 Tenant B','p14_internal')", [internalRole, tenantA, partnerRole, foremanRole, tenantBRole, tenantB]);
    for (const [tenantId, roleId, keys] of [[tenantA, internalRole, permissions.filter((key) => key !== "partner_context.read" && key !== "partner_performance.read_own")], [tenantA, partnerRole, ["partner_context.read", "partner_performance.read_own"]], [tenantA, foremanRole, ["partner_context.read"]], [tenantB, tenantBRole, ["partner_performance.read"]]] as const) {
      for (const key of keys) await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
    }
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P14 Strong Partner','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P14 Unverified Partner','subcontractor',ARRAY['capacity_provider']::text[],'active'),($4,$2,'P14 Customer','customer',ARRAY['work_creator']::text[],'active'),($5,$6,'P14 Other Tenant Partner','subcontractor',ARRAY['capacity_provider']::text[],'active')", [partnerOrg, tenantA, otherPartnerOrg, customerOrg, tenantBPartnerOrg, tenantB]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,'P14 Strong Provider','subcontractor','activated','verified','contracted'),($4,$2,$5,'P14 Unverified Provider','subcontractor','qualified','prospect','not_started')", [provider, tenantA, partnerOrg, otherProvider, otherPartnerOrg]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'tenant',$1),($1,$4,$5,'organization',$6),($1,$7,$8,'organization',$6),($9,$10,$11,'tenant',$9)", [tenantA, internalTu, internalRole, partnerTu, partnerRole, partnerOrg, foremanTu, foremanRole, tenantB, tenantBTu, tenantBRole]);
    await client.query("INSERT INTO territories (id,tenant_id,name,status) VALUES ($1,$2,'Great Lakes','active')", [territory, tenantA]);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status,territory_id,qc_authority_organization_id) VALUES ($1,$2,$3,'P14 Project','active',$4,$3)", [project, tenantA, customerOrg, territory]);
    await client.query("INSERT INTO syncfield_production_codes (id,tenant_id,code,description,unit_of_measure,location_type,requires_route) VALUES ($1,$2,'FIBER','Aerial Fiber','LF','route',true),($3,$2,'HOURS','Crew Hours','HR','daily',false)", [productionCode, tenantA, dailyCode]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P14 Aerial Crew','aerial','active','active',4),($5,$2,$6,$7,'P14 Claimed Crew','aerial','active','active',4)", [crew, tenantA, provider, partnerOrg, otherCrew, otherProvider, otherPartnerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P14 Partner MSA','partner_master_agreement','active','active','2026-08-01')", [contract, tenantA, partnerOrg, provider]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-01',$6)", [agreementVersion, tenantA, partnerOrg, provider, contract, internalUser]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P14 Partner Rates','2026-08-01','active')", [rateSchedule, tenantA, partnerOrg]);
    await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,'P14','Foreman','active','approved')", [foremanWorker, tenantA, provider, crew, partnerOrg]);
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, partnerOrg, foremanWorker, foremanTu]);
    await client.query("INSERT INTO capacity_records (tenant_id,capacity_provider_id,capacity_type,territory_id,availability_start,availability_end,production_rate,production_unit,compliance_status,insurance_status,current_utilization,readiness_score,quantity,unit,effective_date) VALUES ($1,$2,'aerial',$3,'2026-08-01','2026-12-31',3000,'LF','compliant','active',0,95,2,'crew','2026-08-01'),($1,$4,'aerial',$3,'2026-08-01','2026-12-31',3000,'LF','missing','missing',0,35,5,'crew','2026-08-01')", [tenantA, provider, territory, otherProvider]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,assigned_organization_id,partner_organization_id,governing_agreement_version_id,partner_rate_schedule_id,partner_execution_status,partner_effective_date,unit,planned_quantity,qc_authority_organization_id) VALUES ($1,$2,$3,$4,$5,'P14 WO','fiber',18000,'feet','closed','P14 WO','WO-P14',$6,$6,$7,$8,'active','2026-08-01','feet',18000,$9)", [workOrder, tenantA, project, provider, crew, partnerOrg, agreementVersion, rateSchedule, customerOrg]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WO-P14','P14 scope','MAP-P14','feet','active','2026-08-01',$10)", [workOrderVersion, tenantA, partnerOrg, provider, project, workOrder, agreementVersion, crew, rateSchedule, internalUser]);
    for (let day = 1; day <= 6; day++) {
      const date = `2026-08-${String(day).padStart(2, "0")}`;
      const jsa = crypto.randomUUID();
      const report = crypto.randomUUID();
      const revision = crypto.randomUUID();
      const cycle = crypto.randomUUID();
      const production = crypto.randomUUID();
      await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed','P14 work area',true,$10,$11::date + time '07:00')", [jsa, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, date]);
      await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'submitted',$11::date + time '20:00',$10,1,'complete',$13)", [report, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, date, jsa, day === 6 ? "customer_correction_required" : "customer_accepted"]);
      await client.query("INSERT INTO daily_production_report_revisions (id,tenant_id,daily_report_id,revision_number,snapshot_json,reason,submitted_by_user_id) VALUES ($1,$2,$3,1,'{}','submitted',$4)", [revision, tenantA, report, foremanUser]);
      await client.query("INSERT INTO customer_qc_cycles (id,tenant_id,project_id,work_order_id,work_order_version_id,daily_report_id,daily_report_revision_id,partner_organization_id,crew_id,qc_authority_organization_id,cycle_number,status,submitted_to_customer_at,source_reference,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12::date + time '09:00','customer-qc',$13)", [cycle, tenantA, project, workOrder, workOrderVersion, report, revision, partnerOrg, crew, customerOrg, day === 6 ? "correction_required" : "accepted", date, internalUser]);
      await client.query("INSERT INTO production_records (id,tenant_id,project_id,work_order_id,work_order_version_id,capacity_provider_id,crew_id,foreman_user_id,foreman_worker_id,submitted_by_user_id,submitted_by,production_date,quantity_submitted,quantity,claimed_quantity,unit_type,unit,production_type,qc_status,billable_status,status,daily_production_report_id,partner_organization_id,syncfield_production_code_id,syncfield_location_type,syncfield_status,locked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$8,$10,2850,2850,2850,'LF','LF','daily_production','not_started','not_billable','submitted',$11,$12,$13,'route','complete',now())", [production, tenantA, project, workOrder, workOrderVersion, provider, crew, foremanUser, foremanWorker, date, report, partnerOrg, productionCode]);
      await client.query("INSERT INTO customer_qc_decisions (tenant_id,qc_cycle_id,production_record_id,decision,reported_quantity,customer_accepted_quantity,unit_of_measure,customer_reason_code,recorded_by_user_id,source_reference,current) VALUES ($1,$2,$3,$4,2850,$5,'LF',$6,$7,'customer-qc',true)", [tenantA, cycle, production, day === 6 ? "correction_required" : "accepted", day === 6 ? null : 2850, day === 6 ? "workmanship" : "customer_acceptance", internalUser]);
      if (day === 6) await client.query("INSERT INTO production_corrections (tenant_id,qc_cycle_id,customer_qc_decision_id,daily_report_id,production_record_id,partner_organization_id,crew_id,correction_type,allowed_fields,customer_reason,partner_safe_instructions,status,created_by_user_id) SELECT $1,$2,id,$3,$4,$5,$6,'workmanship',ARRAY['notes']::text[],'workmanship correction','Correct workmanship issue','open',$7 FROM customer_qc_decisions WHERE tenant_id = $1 AND production_record_id = $4", [tenantA, cycle, report, production, partnerOrg, crew, internalUser]);
    }
    const pendingReport = crypto.randomUUID();
    const pendingJsa = crypto.randomUUID();
    await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-20','completed','P14 pending area',true,$10,'2026-08-20 07:00')", [pendingJsa, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser]);
    await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-08-20',$11,'submitted','2026-08-20 22:00',$10,1,'returned','pending_customer_qc')", [pendingReport, tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, foremanWorker, foremanUser, pendingJsa]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { tenantA, tenantB, partnerOrg, otherPartnerOrg, internalToken: token(internalUser, tenantA, secret), partnerToken: token(partnerUser, tenantA, secret), foremanToken: token(foremanUser, tenantA, secret), tenantBToken: token(tenantBUser, tenantB, secret) };
}

async function createTimelinessCase(
  client: Client,
  fixture: Fixture,
  timezone: string | null,
  workDate: string,
  submittedAt: string,
  options: { availabilityStart?: string } = {},
) {
  const suffix = crypto.randomUUID();
  const partnerOrg = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const provider = crypto.randomUUID();
  const contract = crypto.randomUUID();
  const agreementVersion = crypto.randomUUID();
  const rateSchedule = crypto.randomUUID();
  const project = crypto.randomUUID();
  const workOrder = crypto.randomUUID();
  const workOrderVersion = crypto.randomUUID();
  const crew = crypto.randomUUID();
  const crewAssignment = crypto.randomUUID();
  const worker = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const readiness = crypto.randomUUID();
  const mobilizationDecision = crypto.randomUUID();
  const notice = crypto.randomUUID();
  const jsa = crypto.randomUUID();
  const report = crypto.randomUUID();
  const territory = crypto.randomUUID();
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P14 Timeliness Foreman')", [foremanUser, `p14-time-${suffix}@syncos.test`]);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,$3,'subcontractor',ARRAY['capacity_provider']::text[],'active'),($4,$2,$5,'customer',ARRAY['work_creator']::text[],'active')", [partnerOrg, fixture.tenantA, `P14 Time Partner ${suffix}`, customerOrg, `P14 Time Customer ${suffix}`]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,$4,'subcontractor','activated','verified','contracted')", [provider, fixture.tenantA, partnerOrg, `P14 Time Provider ${suffix}`]);
    await client.query("INSERT INTO territories (id,tenant_id,name,status) VALUES ($1,$2,$3,'active')", [territory, fixture.tenantA, `P14 Time Territory ${suffix}`]);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status,territory_id,qc_authority_organization_id) VALUES ($1,$2,$3,$4,'active',$5,$3)", [project, fixture.tenantA, customerOrg, `P14 Time Project ${suffix}`, territory]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,$5,'aerial','active','active',4)", [crew, fixture.tenantA, provider, partnerOrg, `P14 Time Crew ${suffix}`]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,$5,'partner_master_agreement','active','active',$6)", [contract, fixture.tenantA, partnerOrg, provider, `P14 Time MSA ${suffix}`, workDate]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective',$6,$7)", [agreementVersion, fixture.tenantA, partnerOrg, provider, contract, workDate, foremanUser]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,$4,$5,'active')", [rateSchedule, fixture.tenantA, partnerOrg, `P14 Time Rates ${suffix}`, workDate]);
    await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,'P14','Time','active','approved')", [worker, fixture.tenantA, provider, crew, partnerOrg]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,assigned_organization_id,partner_organization_id,governing_agreement_version_id,partner_rate_schedule_id,partner_execution_status,partner_effective_date,unit,planned_quantity,qc_authority_organization_id) VALUES ($1,$2,$3,$4,$5,'P14 Time WO','fiber',1000,'feet','closed','P14 Time WO',$6,$7,$7,$8,$9,'active',$10,'feet',1000,$11)", [workOrder, fixture.tenantA, project, provider, crew, `WO-TIME-${suffix.slice(0, 8)}`, partnerOrg, agreementVersion, rateSchedule, workDate, customerOrg]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,effective_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'P14 time scope','MAP-TIME','feet','active',$11,$12)", [workOrderVersion, fixture.tenantA, partnerOrg, provider, project, workOrder, agreementVersion, crew, rateSchedule, `WO-TIME-${suffix.slice(0, 8)}`, workDate, foremanUser]);
    await client.query("INSERT INTO partner_work_order_crew_assignments (id,tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,status,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [crewAssignment, fixture.tenantA, partnerOrg, provider, workOrder, workOrderVersion, crew, foremanUser]);
    await client.query("INSERT INTO mobilization_readiness_evaluations (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_assignment_id,crew_id,map_work_package_ref,project_timezone,overall_status,passed_check_count,blocker_count,warning_count,triggered_by,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MAP-TIME',$10,'ready',1,0,0,'explicit_request',$11)", [readiness, fixture.tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crewAssignment, crew, timezone ?? "America/New_York", foremanUser]);
    await client.query("INSERT INTO mobilization_decisions (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_assignment_id,crew_id,readiness_evaluation_id,decision,authorized_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved_to_mobilize',$11)", [mobilizationDecision, fixture.tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crewAssignment, crew, readiness, foremanUser]);
    if (timezone) {
      await client.query("INSERT INTO notice_to_proceed_versions (id,tenant_id,notice_number,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_assignment_id,crew_id,readiness_evaluation_id,mobilization_decision_id,production_start_status,production_start_date,production_start_time,timezone,initial_map_work_package_ref,initial_work_area,external_instructions,issued_by_user_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'authorized',$13,'07:00',$14,'MAP-TIME','P14 time area','Start work',$15,'authorized')", [notice, fixture.tenantA, `NTP-TIME-${suffix.slice(0, 8)}`, project, workOrder, workOrderVersion, partnerOrg, provider, crewAssignment, crew, readiness, mobilizationDecision, workDate, timezone, foremanUser]);
      await client.query("INSERT INTO production_start_authorizations (tenant_id,notice_id,project_id,work_order_id,work_order_version_id,organization_id,crew_assignment_id,crew_id,authorization_status,start_date,start_time,timezone,map_work_package_ref,work_area,authorized_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'authorized',$9,'07:00',$10,'MAP-TIME','P14 time area',$11)", [fixture.tenantA, notice, project, workOrder, workOrderVersion, partnerOrg, crewAssignment, crew, workDate, timezone, foremanUser]);
    }
    await client.query("INSERT INTO daily_jsas (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,foreman_certified,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed','P14 time area',true,$10,$11::date + time '07:00')", [jsa, fixture.tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, worker, foremanUser, workDate]);
    await client.query("INSERT INTO daily_production_reports (id,tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,daily_jsa_id,status,submitted_at,submitted_by_user_id,revision_number,completeness_status,customer_qc_outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'submitted',$13,$10,1,'complete','pending_customer_qc')", [report, fixture.tenantA, project, workOrder, workOrderVersion, partnerOrg, provider, crew, worker, foremanUser, workDate, jsa, submittedAt]);
    await client.query("INSERT INTO capacity_records (tenant_id,capacity_provider_id,capacity_type,territory_id,availability_start,availability_end,production_rate,production_unit,compliance_status,insurance_status,current_utilization,readiness_score,quantity,unit,effective_date) VALUES ($1,$2,'aerial',$3,$4,'2026-12-31',3000,'LF','compliant','active',0,95,1,'crew',$4)", [fixture.tenantA, provider, territory, options.availabilityStart ?? workDate]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { partnerOrg };
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
