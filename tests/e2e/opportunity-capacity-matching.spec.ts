import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantA: string;
  tenantB: string;
  opportunity: string;
  equipmentOpportunity: string;
  territory: string;
  partnerA: string;
  partnerB: string;
  partnerC: string;
  partnerLowConfidence: string;
  partnerToken: string;
  internalToken: string;
  tenantBToken: string;
};

test.describe.serial("P15 Opportunity capacity matching and recommendation intelligence", () => {
  let client: Client;
  let fixture: Fixture;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedP15Fixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("structured requirements are versioned and missing requirements are not guessed", async ({ request }) => {
    const missing = await apiJson(request, fixture.internalToken, "GET", `/opportunity-capacity-matching/opportunities/${fixture.equipmentOpportunity}`);
    expect(missing.requirement).toBeNull();
    expect(missing.missing_requirements).toContain("territory");

    const first = await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}/requirements`, requirementBody(fixture, 5));
    expect(first.version).toBe(1);
    const second = await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}/requirements`, { ...requirementBody(fixture, 5), notes: "version two" });
    expect(second.version).toBe(2);
    const history = await client.query("SELECT count(*)::int AS count, count(*) FILTER (WHERE current)::int AS current_count FROM opportunity_requirement_profiles WHERE tenant_id = $1 AND opportunity_id = $2", [fixture.tenantA, fixture.opportunity]);
    expect(history.rows[0]).toEqual({ count: 2, current_count: 1 });
  });

  test("hard blockers override high scores and partner score remains distinct from match score", async ({ request }) => {
    await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}/recalculate`, { as_of: "2026-08-19T12:00:00Z" });
    const detail = await apiJson(request, fixture.internalToken, "GET", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}`);
    const critical = detail.partner_matches.find((row: Record<string, unknown>) => row.partner_organization_id === fixture.partnerC);
    const lowConfidence = detail.partner_matches.find((row: Record<string, unknown>) => row.partner_organization_id === fixture.partnerLowConfidence);
    expect(critical.eligible).toBe(false);
    expect(critical.hard_blockers).toContain("CRITICAL_RISK_ACTIVE");
    expect(Number(critical.fit_score)).toBeGreaterThan(70);
    expect(critical.review_required).toBe(true);
    expect(lowConfidence.performance_confidence).toBe("low");
    expect(lowConfidence.capacity_confidence).toBe("low");
    expect(lowConfidence.fit_score).not.toBe(lowConfidence.performance_score);
    expect(JSON.stringify(detail)).not.toMatch(/"customer_rate"|"partner_rate"|"margin"|"worker_email"|"worker_name"/i);
    expect(detail.boundary).toMatchObject({ recommendation_is_assignment: false, ranking_is_award: false, worker_ranking_created: false });
  });

  test("capacity gap and multi-Partner coverage are explainable and do not assign work", async ({ request }) => {
    const before = await counts(client, fixture.tenantA);
    const detail = await apiJson(request, fixture.internalToken, "GET", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}`);
    const option = detail.coverage_options[0];
    expect(option.covered_crew_count).toBe(5);
    expect(option.required_crew_count).toBe(5);
    expect(option.remaining_gap).toBe(0);
    expect(["fully_covered", "low_confidence_coverage"]).toContain(option.coverage_status);
    const composition = option.composition as Array<Record<string, unknown>>;
    expect(composition.map((row) => row.partner_organization_id)).toEqual(expect.arrayContaining([fixture.partnerA, fixture.partnerB]));
    expect(composition.reduce((sum, row) => sum + Number(row.suggested_crew_count ?? 0), 0)).toBe(5);
    const after = await counts(client, fixture.tenantA);
    expect(after).toEqual(before);
  });

  test("mandatory equipment blocks coverage where canonical equipment fit is missing", async ({ request }) => {
    await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.equipmentOpportunity}/requirements`, { ...requirementBody(fixture, 2), required_equipment_types: ["bucket_truck"] });
    await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.equipmentOpportunity}/recalculate`, {});
    const detail = await apiJson(request, fixture.internalToken, "GET", `/opportunity-capacity-matching/opportunities/${fixture.equipmentOpportunity}`);
    expect(detail.partner_matches.every((row: Record<string, unknown>) => row.eligible === false)).toBe(true);
    expect(detail.partner_matches.some((row: Record<string, unknown>) => Array.isArray(row.hard_blockers) && row.hard_blockers.includes("EQUIPMENT_MISSING"))).toBe(true);
    expect(detail.coverage_options[0].coverage_status).toBe("no_eligible_capacity");
  });

  test("shortlist and human decision are audited decision support, not assignment", async ({ request }) => {
    const shortlist = await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}/shortlist`, { partner_organization_id: fixture.partnerA, status: "preferred_for_pursuit", note: "best verified capacity" });
    expect(shortlist.assignment_created).toBe(false);
    const decision = await apiJson(request, fixture.internalToken, "POST", `/opportunity-capacity-matching/opportunities/${fixture.opportunity}/decision`, { decision: "pursue_full_capacity_identified", reason: "full verified partner mix is available", selected_shortlist_ids: [shortlist.id] });
    expect(decision.opportunity_stage_changed).toBe(false);
    expect(decision.work_order_created).toBe(false);
    expect(decision.crew_reserved).toBe(false);
    const audit = await client.query("SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id = $1 AND entity_type IN ('opportunity_partner_shortlist','opportunity_match_decision')", [fixture.tenantA]);
    expect(audit.rows[0].count).toBeGreaterThanOrEqual(2);
  });

  test("scheduled scan is locked and idempotent; Partner and cross-tenant access are denied", async ({ request }) => {
    const first = await apiJson(request, fixture.internalToken, "POST", "/opportunity-capacity-matching/scan", { as_of: "2026-08-19T12:00:00Z", batch_size: 10 });
    const second = await apiJson(request, fixture.internalToken, "POST", "/opportunity-capacity-matching/scan", { as_of: "2026-08-19T12:00:00Z", batch_size: 10 });
    expect(first.locked).toBe(true);
    expect(second.locked).toBe(true);
    const current = await client.query("SELECT count(*)::int AS count FROM opportunity_partner_match_snapshots WHERE tenant_id = $1 AND opportunity_id = $2 AND current = true", [fixture.tenantA, fixture.opportunity]);
    const all = await client.query("SELECT count(DISTINCT partner_organization_id)::int AS count FROM opportunity_partner_match_snapshots WHERE tenant_id = $1 AND opportunity_id = $2", [fixture.tenantA, fixture.opportunity]);
    expect(current.rows[0].count).toBe(all.rows[0].count);

    const partner = await request.get(apiUrl(`/opportunity-capacity-matching/opportunities/${fixture.opportunity}`), { headers: auth(fixture.partnerToken) });
    expect(partner.status()).toBeGreaterThanOrEqual(403);
    const cross = await request.get(apiUrl(`/opportunity-capacity-matching/opportunities/${fixture.opportunity}`), { headers: auth(fixture.tenantBToken) });
    expect(cross.status()).toBeGreaterThanOrEqual(403);
  });
});

async function seedP15Fixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const territory = crypto.randomUUID();
  const otherTerritory = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const opportunity = crypto.randomUUID();
  const equipmentOpportunity = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const partnerUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const internalTu = crypto.randomUUID();
  const partnerTu = crypto.randomUUID();
  const tenantBTu = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const partnerRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();
  const permissions = ["opportunity_capacity_match.read", "opportunity_capacity_match.recalculate", "opportunity_capacity_match.requirements_manage", "opportunity_partner_shortlist.manage", "opportunity_coverage.read", "opportunity_match_decision.record", "partner_context.read"];
  const partners = [
    { key: "partnerA", org: crypto.randomUUID(), provider: crypto.randomUUID(), ready: 2, score: 92, confidence: "high", capacityConfidence: "high", territory, risk: false, capability: "aerial" },
    { key: "partnerB", org: crypto.randomUUID(), provider: crypto.randomUUID(), ready: 2, score: 88, confidence: "high", capacityConfidence: "medium", territory, risk: false, capability: "aerial" },
    { key: "partnerE", org: crypto.randomUUID(), provider: crypto.randomUUID(), ready: 1, score: 84, confidence: "medium", capacityConfidence: "high", territory, risk: false, capability: "aerial" },
    { key: "partnerC", org: crypto.randomUUID(), provider: crypto.randomUUID(), ready: 3, score: 96, confidence: "high", capacityConfidence: "high", territory, risk: true, capability: "aerial" },
    { key: "partnerLowConfidence", org: crypto.randomUUID(), provider: crypto.randomUUID(), ready: 1, score: 95, confidence: "low", capacityConfidence: "low", territory, risk: false, capability: "aerial", unverified: 3 },
    { key: "partnerD", org: crypto.randomUUID(), provider: crypto.randomUUID(), ready: 3, score: 90, confidence: "high", capacityConfidence: "high", territory: otherTerritory, risk: false, capability: "underground" },
  ];
  await client.query("BEGIN");
  try {
    for (const key of permissions) await client.query("INSERT INTO permissions (key,name) VALUES ($1,$1) ON CONFLICT (key) DO NOTHING", [key]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,'P15 Tenant A',$2),($3,'P15 Tenant B',$4)", [tenantA, `p15-a-${suffix}`, tenantB, `p15-b-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P15 Internal'),($3,$4,'P15 Partner'),($5,$6,'P15 Tenant B')", [internalUser, `p15-internal-${suffix}@syncos.test`, partnerUser, `p15-partner-${suffix}@syncos.test`, tenantBUser, `p15-b-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$7,$8)", [internalTu, tenantA, internalUser, partnerTu, partnerUser, tenantBTu, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P15 Internal','p15_internal'),($3,$2,'Partner Admin','partner_admin'),($4,$5,'P15 Tenant B','p15_internal')", [internalRole, tenantA, partnerRole, tenantBRole, tenantB]);
    for (const key of permissions.filter((value) => value !== "partner_context.read")) {
      await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantA, internalRole, key]);
      await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantB, tenantBRole, key]);
    }
    await client.query("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key = 'partner_context.read' ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantA, partnerRole]);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'tenant',$1),($1,$4,$5,'organization',$6),($7,$8,$9,'tenant',$7)", [tenantA, internalTu, internalRole, partnerTu, partnerRole, partners[0].org, tenantB, tenantBTu, tenantBRole]);
    await client.query("INSERT INTO territories (id,tenant_id,name,status) VALUES ($1,$2,'Great Lakes','active'),($3,$2,'Desert Southwest','active')", [territory, tenantA, otherTerritory]);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P15 Customer','customer',ARRAY['work_creator']::text[],'active')", [customerOrg, tenantA]);
    await client.query("INSERT INTO opportunities (id,tenant_id,organization_id,territory_id,title,work_type,status,stage) VALUES ($1,$2,$3,$4,'P15 Great Lakes Aerial','aerial','pursuing','pursuing'),($5,$2,$3,$4,'P15 Equipment Required Aerial','aerial','pursuing','pursuing')", [opportunity, tenantA, customerOrg, territory, equipmentOpportunity]);
    for (const partner of partners) {
      await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,$3,'subcontractor',ARRAY['capacity_provider']::text[],'active')", [partner.org, tenantA, `P15 ${partner.key}`]);
      await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,$4,'subcontractor','activated','verified','contracted')", [partner.provider, tenantA, partner.org, `P15 Provider ${partner.key}`]);
      for (let index = 0; index < Math.max(partner.ready, partner.unverified ?? 0, 1); index += 1) {
        await client.query("INSERT INTO crews (tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'aerial','active','active',4)", [tenantA, partner.provider, partner.org, `P15 Crew ${partner.key} ${index + 1}`]);
      }
      await client.query(
        `
        INSERT INTO partner_performance_snapshots (
          tenant_id, partner_organization_id, capacity_provider_id, scoring_policy_version, score, score_band, confidence,
          quality_score, production_score, documentation_score, safety_score, mobilization_score, correction_score,
          commercial_score, capacity_reliability_score, trend, lifecycle_recommendation, production_day_count,
          reviewed_record_count, completed_work_order_count, critical_risk_count, source_fingerprint
        )
        VALUES ($1,$2,$3,'partner_performance_v1',$4,'excellent',$5,90,90,90,90,90,90,90,90,'stable','maintain',20,30,2,$6,$7)
        `,
        [tenantA, partner.org, partner.provider, partner.score, partner.confidence, partner.risk ? 1 : 0, `p15-performance-${partner.key}-${suffix}`],
      );
      await client.query(
        "INSERT INTO partner_capacity_intelligence_snapshots (tenant_id,partner_organization_id,capacity_provider_id,territory_id,crew_type,capability,horizon,ready_crew_count,conditional_crew_count,unverified_crew_count,committed_crew_count,capacity_confidence,recommendation,source_fingerprint) VALUES ($1,$2,$3,$4,'aerial',$5,'72h',$6,0,$7,0,$8,$9,$10)",
        [tenantA, partner.org, partner.provider, partner.territory, partner.capability, partner.ready, partner.unverified ?? 0, partner.capacityConfidence, partner.capacityConfidence === "low" ? "available_low_confidence" : "best_fit", `p15-capacity-${partner.key}-${suffix}`],
      );
      if (partner.risk) {
        await client.query("INSERT INTO partner_risk_flags (tenant_id,partner_organization_id,risk_type,severity,source_type,source_id,reason_code) VALUES ($1,$2,'safety_critical','critical','daily_jsa',$3,'active_critical_risk')", [tenantA, partner.org, crypto.randomUUID()]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const byKey = Object.fromEntries(partners.map((partner) => [partner.key, partner.org]));
  return {
    tenantA,
    tenantB,
    opportunity,
    equipmentOpportunity,
    territory,
    partnerA: byKey.partnerA,
    partnerB: byKey.partnerB,
    partnerC: byKey.partnerC,
    partnerLowConfidence: byKey.partnerLowConfidence,
    internalToken: token(internalUser, tenantA, secret),
    partnerToken: token(partnerUser, tenantA, secret),
    tenantBToken: token(tenantBUser, tenantB, secret),
  };
}

function requirementBody(fixture: Fixture, count: number) {
  return {
    territory_id: fixture.territory,
    capability: "aerial",
    crew_type: "aerial",
    required_crew_count: count,
    required_start_date: "2026-08-21",
    required_start_window: "72h",
    minimum_performance_score: 70,
    minimum_performance_confidence: "medium",
    max_risk_severity: "medium",
  };
}

async function counts(client: Client, tenantId: string) {
  const result = await client.query("SELECT (SELECT count(*)::int FROM work_orders WHERE tenant_id = $1) AS work_orders, (SELECT count(*)::int FROM partner_work_order_crew_assignments WHERE tenant_id = $1) AS assignments, (SELECT count(*)::int FROM payments WHERE tenant_id = $1) AS payments", [tenantId]);
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
