const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.AUTH_JWT_SECRET;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const seeded = await client.query(`
      SELECT u.id AS user_id, t.id AS tenant_id
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id
      JOIN tenants t ON t.id = tu.tenant_id
      WHERE u.email = 'admin@jackson-telcom.local'
        AND t.slug = 'jackson-telcom'
      LIMIT 1
    `);
    if (!seeded.rows[0]) throw new Error("Seeded Jackson Telcom admin user was not found");

    const { user_id: userId, tenant_id: tenantId } = seeded.rows[0];
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedUserId = await createLimitedUser(client, tenantId);
    const limitedToken = createToken({ sub: limitedUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const base = await createBase(client, tenantId, userId);
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/coverage-plans", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/coverage-plans", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross-tenant blocked", "GET", `/coverage-plans/${outside.coveragePlanId}`, `Bearer ${token}`, 404);
    await expectStatus("coverage plan requires awarded opportunity", "POST", "/coverage-plans", `Bearer ${token}`, 400, { opportunity_id: base.draftOpportunityId });
    await expectStatus("coverage plan rejects cross-tenant opportunity", "POST", "/coverage-plans", `Bearer ${token}`, 404, { opportunity_id: outside.opportunityId });

    const downstreamBefore = await downstreamCounts(client);
    const createBefore = await writeCounts(client);
    const created = await expectStatus("coverage plan create works", "POST", "/coverage-plans", `Bearer ${token}`, 201, {
      opportunity_id: base.awardedOpportunityId,
      operations_owner_user_id: userId,
      notes: "Coverage smoke plan.",
    });
    await expectWriteDelta(client, createBefore, 1, 1, 1, 1, "coverage plan create");
    assertSameCounts(downstreamBefore, await downstreamCounts(client), "coverage plan create downstream boundary");
    const planId = created.coverage_plan.id;
    if (created.coverage_plan.status !== "not_started") throw new Error("new coverage plan did not start in not_started");

    await expectStatus("duplicate active coverage plan blocked", "POST", "/coverage-plans", `Bearer ${token}`, 400, { opportunity_id: base.awardedOpportunityId });
    const duplicate = await expectStatus("duplicate active coverage plan allowed with override", "POST", "/coverage-plans", `Bearer ${token}`, 201, { opportunity_id: base.awardedOpportunityId, override_reason: "parallel coverage scenario test" });
    if (duplicate.coverage_plan.opportunity_id !== base.awardedOpportunityId) throw new Error("duplicate override did not create coverage plan");

    const requirement = await expectStatus("create requirement works", "POST", `/coverage-plans/${planId}/requirements`, `Bearer ${token}`, 201, {
      work_type: "fiber",
      territory_id: base.territoryId,
      quantity: 1000,
      unit: "feet",
      required_crew_type: "splicing",
      required_equipment_type: "bucket_truck",
    });
    if (requirement.coverage_plan_id !== planId) throw new Error("requirement not linked to coverage plan");
    const source = await expectStatus("create source works", "POST", `/coverage-plans/${planId}/sources`, `Bearer ${token}`, 201, {
      coverage_requirement_id: requirement.id,
      source_type: "approved_subcontractor",
      organization_id: base.organizationId,
      capacity_provider_id: base.providerId,
      crew_id: base.crewId,
      equipment_id: base.equipmentId,
      covered_quantity: 750,
      unit: "feet",
      confidence_score: 75,
      commitment_status: "verbally_committed",
      estimated_cost: 10000,
      expected_margin_percent: 18,
      margin_confidence: "medium",
    });
    if (source.coverage_requirement_id !== requirement.id) throw new Error("source not linked to requirement");
    const gap = await expectStatus("create gap works", "POST", `/coverage-plans/${planId}/gaps`, `Bearer ${token}`, 201, {
      coverage_requirement_id: requirement.id,
      gap_type: "insufficient_crew_count",
      severity: "medium",
      required_quantity: 1000,
      covered_quantity: 750,
      gap_quantity: 250,
      unit: "feet",
      owner_user_id: userId,
      recommended_action: "Confirm backup crew source.",
    });
    if (gap.status !== "open") throw new Error("coverage gap did not start open");

    const recalculated = await expectStatus("recalculate updates readiness scores", "POST", `/coverage-plans/${planId}/recalculate`, `Bearer ${token}`, 201, {});
    if (recalculated.readiness.capacity_readiness_score === null || recalculated.readiness.coverage_readiness_score === null) throw new Error("recalculate did not return readiness scores");
    const listRows = await expectStatus("coverage list returns enriched fields", "GET", "/coverage-plans", `Bearer ${token}`, 200);
    const listPlan = listRows.find((row) => row.id === planId);
    if (!listPlan) throw new Error("created coverage plan missing from enriched list");
    for (const field of ["requirements_count", "active_requirements_count", "sources_count", "active_sources_count", "open_gaps_count", "hard_stop_gaps_count", "recommended_next_action", "warnings", "blockers", "required_override_fields", "operations_owner_name"]) {
      if (!(field in listPlan)) throw new Error(`coverage list missing ${field}`);
    }
    if (listPlan.open_gaps_count < 1 || listPlan.recommended_next_action !== "resolve_or_override_gaps") throw new Error("coverage list did not return gap-driven next action");
    await expectListHas("coverage list filters hard stop", "/coverage-plans?has_hard_stop_gaps=false", token, planId);
    await expectListHas("coverage list filters economic risk", "/coverage-plans?has_economic_risk=false", token, planId);
    await expectListHas("coverage list filters compliance risk", "/coverage-plans?has_compliance_risk=false", token, planId);
    await expectListHas("coverage list filters capacity gap", "/coverage-plans?has_capacity_gap=true", token, planId);
    await expectListHas("coverage list sorts hard stops", "/coverage-plans?sort=hard_stops_desc", token, planId);
    await expectListHas("coverage list sorts readiness", "/coverage-plans?sort=readiness_asc", token, planId);
    await expectListHas("coverage list sorts open gaps", "/coverage-plans?sort=open_gaps_desc", token, planId);

    const missingOverride = await expectStatus("non-hard-stop gap requires override reason", "POST", `/coverage-plans/${planId}/approve-for-handoff`, `Bearer ${token}`, 400, { approval_note: "Ready with open gap." });
    if (!missingOverride.required_override_fields?.includes("capacity_override_reason")) throw new Error("capacity override field missing for non-hard-stop gap");
    await expectStatus("gap override works", "POST", `/coverage-gaps/${gap.id}/override`, `Bearer ${token}`, 201, { override_reason: "Backup source action plan accepted." });
    const approvedWithGapOverride = await expectStatus("approve for handoff succeeds with override reasons", "POST", `/coverage-plans/${planId}/approve-for-handoff`, `Bearer ${token}`, 201, {
      approval_note: "Operations accepts coverage plan with documented warnings.",
      override_reasons: {
        capacity_override_reason: "Remaining quantity has accepted action plan.",
        source_override_reason: "Verbal commitment is accepted for handoff planning.",
      },
    });
    if (approvedWithGapOverride.coverage_plan.status !== "approved_for_handoff") throw new Error("handoff approval did not persist");
    assertSameCounts(downstreamBefore, await downstreamCounts(client), "handoff approval downstream boundary");

    const unknownPlan = await createPlanWithRequirementAndSource(client, token, base, {
      source: { expected_margin_percent: undefined, margin_confidence: undefined },
    });
    const unknownApproval = await expectStatus("margin unknown creates warning, not hard block", "POST", `/coverage-plans/${unknownPlan.planId}/approve-for-handoff`, `Bearer ${token}`, 400, { approval_note: "Unknown margin." });
    if (!hasWarning(unknownApproval, "margin_unknown") || unknownApproval.blockers?.length || !unknownApproval.required_override_fields?.includes("economic_override_reason")) throw new Error("margin unknown was not warning-only");
    await expectStatus("margin unknown approval succeeds with override", "POST", `/coverage-plans/${unknownPlan.planId}/approve-for-handoff`, `Bearer ${token}`, 201, {
      approval_note: "Unknown margin accepted for planning.",
      override_reasons: { economic_override_reason: "Margin will be reviewed before handoff execution.", compliance_override_reason: "Compliance source is not provider-linked.", source_override_reason: "Identified source accepted for planning." },
    });

    const lowPlan = await createPlanWithRequirementAndSource(client, token, base, { source: { expected_margin_percent: 0, margin_confidence: "low" } });
    const lowApproval = await expectStatus("low margin creates warning, not hard block", "POST", `/coverage-plans/${lowPlan.planId}/approve-for-handoff`, `Bearer ${token}`, 400, { approval_note: "Low margin." });
    if (!hasWarning(lowApproval, "low_margin") || lowApproval.blockers?.length) throw new Error("low margin was not warning-only");

    const negativePlan = await createPlanWithRequirementAndSource(client, token, base, { source: { expected_margin_percent: -5, margin_confidence: "low" } });
    const negativeApproval = await expectStatus("negative margin creates high warning, not automatic hard block", "POST", `/coverage-plans/${negativePlan.planId}/approve-for-handoff`, `Bearer ${token}`, 400, { approval_note: "Negative margin." });
    if (!hasWarning(negativeApproval, "negative_margin") || negativeApproval.blockers?.length) throw new Error("negative margin was not warning-only");

    const hardStopPlan = await createPlanWithRequirementAndSource(client, token, base, { source: { expected_margin_percent: 20, margin_confidence: "medium" } });
    const hardStopGap = await expectStatus("hard stop gap create works", "POST", `/coverage-plans/${hardStopPlan.planId}/gaps`, `Bearer ${token}`, 201, {
      gap_type: "safety_gap",
      severity: "critical",
      hard_stop: true,
      override_allowed: false,
      status: "open",
      recommended_action: "Resolve safety stop before handoff.",
    });
    const hardStopApproval = await expectStatus("hard_stop gap blocks approve-for-handoff", "POST", `/coverage-plans/${hardStopPlan.planId}/approve-for-handoff`, `Bearer ${token}`, 400, {
      approval_note: "Cannot override hard stop.",
      override_reasons: { safety_gap: "not allowed" },
    });
    if (!hardStopApproval.blockers?.some((blocker) => blocker.related_object_id === hardStopGap.id)) throw new Error("hard stop blocker missing");
    await expectStatus("gap resolve works", "POST", `/coverage-gaps/${hardStopGap.id}/resolve`, `Bearer ${token}`, 201, { resolution_note: "Safety issue resolved." });

    await expectStatus("coverage requirement archive requires reason", "POST", `/coverage-requirements/${requirement.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("coverage source archive requires reason", "POST", `/coverage-sources/${source.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("coverage gap archive requires reason", "POST", `/coverage-gaps/${gap.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("coverage source archive works", "POST", `/coverage-sources/${source.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "replaced" });
    await expectStatus("coverage requirement archive works", "POST", `/coverage-requirements/${requirement.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "replaced" });
    await expectStatus("coverage gap archive works", "POST", `/coverage-gaps/${gap.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "replaced" });
    await expectStatus("coverage plan archive requires reason", "POST", `/coverage-plans/${duplicate.coverage_plan.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("coverage plan archive works", "POST", `/coverage-plans/${duplicate.coverage_plan.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "replaced" });

    const detail = await expectStatus("coverage detail returns warnings and blockers", "GET", `/coverage-plans/${planId}/detail`, `Bearer ${token}`, 200);
    if (!("recommended_next_action" in detail) || !Array.isArray(detail.warnings) || !Array.isArray(detail.blockers) || !Array.isArray(detail.required_override_fields)) throw new Error("coverage detail missing hardened approval context");
    const timeline = await expectStatus("timeline endpoint returns coverage events", "GET", `/coverage-plans/${planId}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["coverage_plan.created", "coverage_requirement.created", "coverage_source.created", "coverage_gap.created"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`coverage timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/coverage-plans/${planId}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const auditSummary = await expectStatus("audit endpoint returns coverage audit", "GET", `/coverage-plans/${planId}/audit-summary`, `Bearer ${token}`, 200);
    if (!auditSummary.some((row) => row.object_type === "coverage_plan")) throw new Error("coverage audit summary missing plan audit records");

    const search = await expectStatus("global search includes active coverage plans", "GET", "/search?q=Coverage", `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "coverage_plan" && row.id === planId)) throw new Error("coverage plan was not searchable");
    const archivedSearch = await expectStatus("global search supports archived coverage plans", "GET", "/search?q=Coverage&archived=true", `Bearer ${token}`, 200);
    if (!archivedSearch.some((row) => row.object_type === "coverage_plan" && row.id === duplicate.coverage_plan.id)) throw new Error("archived coverage plan was not searchable with archived=true");

    const payload = await latestEventPayload(client, planId, "coverage_plan.approved_for_handoff");
    if (!payload?.warnings?.length || !payload?.override_reasons?.capacity_override_reason) throw new Error("approval event payload missing warnings or override reasons");
    const coverageAudit = await client.query("SELECT after_state FROM audit_logs WHERE entity_type = 'coverage_plan' AND entity_id = $1 AND action = 'coverage_plan.approve_handoff' ORDER BY created_at DESC LIMIT 1", [planId]);
    if (!coverageAudit.rows[0]?.after_state?.override_reasons?.capacity_override_reason) throw new Error("coverage audit missing override reason data");
    const finalCounts = await writeCounts(client);
    if (finalCounts.events <= createBefore.events || finalCounts.event_payloads <= createBefore.event_payloads || finalCounts.audit_logs <= createBefore.audit_logs || finalCounts.system_actions <= createBefore.system_actions) {
      throw new Error("coverage writes did not create event/audit/system_action records");
    }

    assertSameCounts(downstreamBefore, await downstreamCounts(client), "coverage smoke downstream boundary");
    console.log("coverage smoke passed");
  } finally {
    await client.end();
  }
}

async function createPlanWithRequirementAndSource(client, token, base, options = {}) {
  const opportunityId = await createAwardedOpportunity(client, base);
  const plan = await expectStatus("scenario coverage plan create", "POST", "/coverage-plans", `Bearer ${token}`, { status: 201 }, { opportunity_id: opportunityId });
  const planId = plan.coverage_plan.id;
  const requirement = await expectStatus("scenario requirement create", "POST", `/coverage-plans/${planId}/requirements`, `Bearer ${token}`, { status: 201 }, {
    work_type: "fiber",
    territory_id: base.territoryId,
    quantity: 10,
    unit: "days",
  });
  const sourceBody = {
    coverage_requirement_id: requirement.id,
    source_type: "internal_workforce",
    covered_quantity: 10,
    unit: "days",
    confidence_score: 75,
    commitment_status: "identified",
    ...options.source,
  };
  await expectStatus("scenario source create", "POST", `/coverage-plans/${planId}/sources`, `Bearer ${token}`, { status: 201 }, sourceBody);
  return { planId, opportunityId };
}

async function createBase(client, tenantId, userId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Coverage Territory ${suffix}`, `CV${String(suffix).slice(-4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'subcontractor', 'subcontractor') RETURNING id", [tenantId, territory.rows[0].id, `Coverage Organization ${suffix}`]);
  const awardedOpportunityId = await createAwardedOpportunity(client, {
    tenantId,
    territoryId: territory.rows[0].id,
    organizationId: organization.rows[0].id,
    userId,
  });
  const draft = await client.query(
    "INSERT INTO opportunities (tenant_id, title, organization_id, territory_id, owner_user_id, work_type, estimated_value, status, stage) VALUES ($1, $2, $3, $4, $5, 'fiber', 10000, 'draft', 'draft') RETURNING id",
    [tenantId, `Draft Coverage Opportunity ${suffix}`, organization.rows[0].id, territory.rows[0].id, userId],
  );
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status, verification_status, contract_status) VALUES ($1, $2, $3, 'subcontractor', 'verified', 'verified', 'contracted') RETURNING id", [tenantId, organization.rows[0].id, `Coverage Provider ${suffix}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'splicing', 'active') RETURNING id", [tenantId, provider.rows[0].id, `Coverage Crew ${suffix}`]);
  const equipment = await client.query("INSERT INTO equipment (tenant_id, capacity_provider_id, crew_id, name, equipment_type, status) VALUES ($1, $2, $3, $4, 'bucket_truck', 'active') RETURNING id", [tenantId, provider.rows[0].id, crew.rows[0].id, `Coverage Equipment ${suffix}`]);
  await client.query("INSERT INTO capacity_records (tenant_id, capacity_provider_id, territory_id, capacity_type, quantity, unit, compliance_status, insurance_status) VALUES ($1, $2, $3, 'splicing', 2, 'crew', 'compliant', 'active')", [tenantId, provider.rows[0].id, territory.rows[0].id]);
  return {
    tenantId,
    userId,
    territoryId: territory.rows[0].id,
    organizationId: organization.rows[0].id,
    awardedOpportunityId,
    draftOpportunityId: draft.rows[0].id,
    providerId: provider.rows[0].id,
    crewId: crew.rows[0].id,
    equipmentId: equipment.rows[0].id,
  };
}

async function createAwardedOpportunity(client, base) {
  const suffix = Date.now();
  const result = await client.query(
    `
    INSERT INTO opportunities (tenant_id, title, organization_id, territory_id, owner_user_id, work_type, estimated_value, status, stage, summary, source_type, awarded_by, awarded_at)
    VALUES ($1, $2, $3, $4, $5, 'fiber', 125000, 'awarded', 'awarded', 'Awarded coverage smoke work.', 'manual_entry', $5, now())
    RETURNING id
    `,
    [base.tenantId, `Awarded Coverage Opportunity ${suffix}-${Math.random()}`, base.organizationId, base.territoryId, base.userId],
  );
  return result.rows[0].id;
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Coverage User', 'x') RETURNING id", [`limited-coverage-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Coverage Tenant", `outside-coverage-${suffix}`]);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outside Coverage User', 'x') RETURNING id", [`outside-coverage-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenant.rows[0].id, user.rows[0].id]);
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, 'Outside Coverage Territory', 'OCV') RETURNING id", [tenant.rows[0].id]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, 'Outside Coverage Organization', 'subcontractor', 'subcontractor') RETURNING id", [tenant.rows[0].id, territory.rows[0].id]);
  const opportunity = await client.query("INSERT INTO opportunities (tenant_id, title, organization_id, territory_id, owner_user_id, work_type, estimated_value, status, stage) VALUES ($1, 'Outside Awarded Coverage Opportunity', $2, $3, $4, 'fiber', 10000, 'awarded', 'awarded') RETURNING id", [tenant.rows[0].id, organization.rows[0].id, territory.rows[0].id, user.rows[0].id]);
  const plan = await client.query("INSERT INTO coverage_plans (tenant_id, opportunity_id, status, created_by, updated_by) VALUES ($1, $2, 'not_started', $3, $3) RETURNING id", [tenant.rows[0].id, opportunity.rows[0].id, user.rows[0].id]);
  return { opportunityId: opportunity.rows[0].id, coveragePlanId: plan.rows[0].id };
}

function hasWarning(response, type) {
  return Array.isArray(response.warnings) && response.warnings.some((warning) => warning.warning_type === type);
}

async function writeCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM event_payloads) AS event_payloads,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs,
      (SELECT count(*)::int FROM system_actions) AS system_actions
  `);
  return result.rows[0];
}

async function downstreamCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM projects) AS projects,
      (SELECT count(*)::int FROM work_orders) AS work_orders,
      (SELECT count(*)::int FROM production_records) AS production_records,
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM ar_records) AS ar_records
  `);
  return result.rows[0];
}

async function latestEventPayload(client, aggregateId, eventType) {
  const result = await client.query(
    `
    SELECT ep.payload
    FROM events e
    JOIN event_payloads ep ON ep.event_id = e.id
    WHERE e.aggregate_id = $1 AND e.event_type = $2
    ORDER BY e.occurred_at DESC
    LIMIT 1
    `,
    [aggregateId, eventType],
  );
  return result.rows[0]?.payload;
}

async function expectWriteDelta(client, before, events, eventPayloads, auditLogs, systemActions, label) {
  const after = await writeCounts(client);
  if (after.events !== before.events + events) throw new Error(`${label}: expected ${events} event delta`);
  if (after.event_payloads !== before.event_payloads + eventPayloads) throw new Error(`${label}: expected ${eventPayloads} event payload delta`);
  if (after.audit_logs !== before.audit_logs + auditLogs) throw new Error(`${label}: expected ${auditLogs} audit delta`);
  if (after.system_actions !== before.system_actions + systemActions) throw new Error(`${label}: expected ${systemActions} system action delta`);
}

function assertSameCounts(before, after, label) {
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) throw new Error(`${label}: expected ${key} count to remain ${before[key]}, got ${after[key]}`);
  }
}

async function expectStatus(name, method, path, authorization, expected, body) {
  const expectedStatus = typeof expected === "number" ? expected : expected.status;
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(`${name}: expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  const text = await response.text();
  if (!text) return undefined;
  const parsed = JSON.parse(text);
  return parsed && typeof parsed.message === "object" && !Array.isArray(parsed.message) ? { ...parsed, ...parsed.message } : parsed;
}

async function expectListHas(name, path, token, id) {
  const rows = await expectStatus(name, "GET", path, `Bearer ${token}`, 200);
  if (!Array.isArray(rows) || !rows.some((row) => row.id === id)) throw new Error(`${name}: expected list to include ${id}`);
  return rows;
}

function createToken(claims, secret) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000) });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
