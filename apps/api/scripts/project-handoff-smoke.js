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
    if (!seeded.rows[0]) throw new Error("Seeded admin user was not found");

    const { user_id: userId, tenant_id: tenantId } = seeded.rows[0];
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedUserId = await createLimitedUser(client, tenantId);
    const limitedToken = createToken({ sub: limitedUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const base = await createBase(client, tenantId, userId);
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/project-handoffs", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/project-handoffs", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross-tenant blocked", "GET", `/project-handoffs/${outside.handoffId}`, `Bearer ${token}`, 404);
    await expectStatus("handoff requires awarded opportunity", "POST", "/project-handoffs", `Bearer ${token}`, 400, {
      opportunity_id: base.draftOpportunityId,
      coverage_plan_id: base.draftCoveragePlanId,
    });
    await expectStatus("handoff requires approved coverage plan", "POST", "/project-handoffs", `Bearer ${token}`, 400, {
      opportunity_id: base.awardedOpportunityId,
      coverage_plan_id: base.unapprovedCoveragePlanId,
    });

    const downstreamBefore = await downstreamCounts(client);
    const handoff = await expectStatus("create handoff works", "POST", "/project-handoffs", `Bearer ${token}`, 201, {
      opportunity_id: base.awardedOpportunityId,
      coverage_plan_id: base.approvedCoveragePlanId,
      operations_owner_user_id: userId,
      project_manager_user_id: userId,
      field_supervisor_user_id: userId,
      scope_summary: "Project handoff smoke scope.",
      location_summary: "Project handoff smoke location.",
      expected_start_date: "2026-08-01",
      handoff_notes: "Project handoff smoke.",
    });
    const handoffId = handoff.project_handoff.id;
    if (handoff.project_handoff.status !== "draft") throw new Error("handoff did not start in draft");
    if (!handoff.checklist_items?.length) throw new Error("default checklist items were not created");
    assertSameExceptProjects(downstreamBefore, await downstreamCounts(client), 0, "handoff create downstream boundary");

    await expectStatus("duplicate active handoff blocked", "POST", "/project-handoffs", `Bearer ${token}`, 400, {
      opportunity_id: base.awardedOpportunityId,
      coverage_plan_id: base.approvedCoveragePlanId,
    });
    const duplicate = await expectStatus("duplicate active handoff allowed with override", "POST", "/project-handoffs", `Bearer ${token}`, 201, {
      opportunity_id: base.awardedOpportunityId,
      coverage_plan_id: base.approvedCoveragePlanId,
      override_reason: "parallel handoff scenario",
      operations_owner_user_id: userId,
      scope_summary: "Duplicate handoff scope.",
      location_summary: "Duplicate handoff location.",
    });

    const checklist = await expectStatus("list checklist works", "GET", `/project-handoffs/${handoffId}/checklist-items`, `Bearer ${token}`, 200);
    for (const item of checklist.filter((row) => row.hard_stop && row.status !== "complete")) {
      await expectStatus(`complete hard stop checklist ${item.checklist_key}`, "POST", `/project-handoff-checklist-items/${item.id}/complete`, `Bearer ${token}`, 201, {});
    }
    const warningItem = checklist.find((row) => !row.hard_stop && row.status !== "complete");
    if (!warningItem) throw new Error("expected warning checklist item");
    await expectStatus("checklist override requires reason", "POST", `/project-handoff-checklist-items/${warningItem.id}/override`, `Bearer ${token}`, 400, {});
    await expectStatus("checklist override works", "POST", `/project-handoff-checklist-items/${warningItem.id}/override`, `Bearer ${token}`, 201, { override_reason: "Reviewed during smoke test." });

    const hardStopRisk = await expectStatus("risk create works", "POST", `/project-handoffs/${handoffId}/risks`, `Bearer ${token}`, 201, {
      risk_type: "safety_gap",
      severity: "critical",
      message: "Safety hard stop for smoke.",
      hard_stop: true,
      override_allowed: false,
      status: "open",
    });
    const blockedApproval = await expectStatus("hard stop risk blocks approval", "POST", `/project-handoffs/${handoffId}/approve`, `Bearer ${token}`, 400, { approval_note: "Attempt approval." });
    if (!blockedApproval.blockers?.some((blocker) => blocker.related_object_id === hardStopRisk.id)) throw new Error("hard stop risk blocker missing");
    await expectStatus("risk resolve works", "POST", `/project-handoff-risks/${hardStopRisk.id}/resolve`, `Bearer ${token}`, 201, { resolution_note: "Safety risk resolved." });

    const openRisk = await expectStatus("non-hard-stop risk create works", "POST", `/project-handoffs/${handoffId}/risks`, `Bearer ${token}`, 201, {
      risk_type: "documentation_gap",
      severity: "medium",
      message: "Documentation package needs final review.",
      hard_stop: false,
      override_allowed: true,
    });
    await expectStatus("risk override requires reason", "POST", `/project-handoff-risks/${openRisk.id}/override`, `Bearer ${token}`, 400, {});
    const missingOverride = await expectStatus("warnings require override reason", "POST", `/project-handoffs/${handoffId}/approve`, `Bearer ${token}`, 400, { approval_note: "Approve with warning." });
    if (!missingOverride.required_override_fields?.includes("risk_override_reason")) throw new Error("risk override field missing");
    await expectStatus("risk override works", "POST", `/project-handoff-risks/${openRisk.id}/override`, `Bearer ${token}`, 201, { override_reason: "Documentation action accepted." });

    const recalculated = await expectStatus("recalculate updates readiness score", "POST", `/project-handoffs/${handoffId}/recalculate`, `Bearer ${token}`, 201, {});
    if (recalculated.readiness.handoff_readiness_score === null) throw new Error("handoff readiness score missing");
    await expectStatus("submit readiness review works", "POST", `/project-handoffs/${handoffId}/submit-readiness-review`, `Bearer ${token}`, 201, { review_note: "Ready for approval review." });
    await expectStatus("create project blocked before approval", "POST", `/project-handoffs/${handoffId}/create-project`, `Bearer ${token}`, 400, { creation_note: "Too soon." });

    const approved = await expectStatus("approve handoff works with overrides", "POST", `/project-handoffs/${handoffId}/approve`, `Bearer ${token}`, 201, {
      approval_note: "Approved for explicit project creation.",
      override_reasons: {
        checklist_override_reason: "Remaining non-hard-stop checklist items are assigned.",
      },
    });
    if (approved.project_handoff.status !== "approved") throw new Error("handoff approval did not persist");
    assertSameExceptProjects(downstreamBefore, await downstreamCounts(client), 0, "handoff approval downstream boundary");

    const projectCreated = await expectStatus("create project works after handoff approval", "POST", `/project-handoffs/${handoffId}/create-project`, `Bearer ${token}`, 201, {
      creation_note: "Create planning project.",
    });
    const projectId = projectCreated.project_handoff.project_id;
    if (!projectId || projectCreated.project_handoff.status !== "project_created") throw new Error("project was not linked to handoff");
    await expectStatus("duplicate project creation blocked", "POST", `/project-handoffs/${handoffId}/create-project`, `Bearer ${token}`, 400, { creation_note: "Duplicate." });
    assertSameExceptProjects(downstreamBefore, await downstreamCounts(client), 1, "project handoff downstream boundary");

    const project = await client.query("SELECT * FROM projects WHERE id = $1", [projectId]);
    if (project.rows[0].status !== "planning" || project.rows[0].source_project_handoff_id !== handoffId) throw new Error("created project missing planning/source fields");

    const timeline = await expectStatus("timeline endpoint returns handoff events", "GET", `/project-handoffs/${handoffId}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["project_handoff.created", "project_handoff_checklist.completed", "project_handoff_risk.created", "project_handoff.project_created", "project.created"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`handoff timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/project-handoffs/${handoffId}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns handoff audit", "GET", `/project-handoffs/${handoffId}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.object_type === "project_handoff")) throw new Error("handoff audit missing handoff record");
    const approvals = await expectStatus("approvals list works", "GET", `/project-handoffs/${handoffId}/approvals`, `Bearer ${token}`, 200);
    if (!approvals.some((row) => row.approval_type === "handoff_approval" && row.status === "approved")) throw new Error("handoff approval row missing");

    const search = await expectStatus("global search includes project handoffs", "GET", "/search?q=handoff", `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "project_handoff" && row.id === handoffId)) throw new Error("project handoff was not searchable");
    await expectStatus("archive requires reason", "POST", `/project-handoffs/${duplicate.project_handoff.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("archive works", "POST", `/project-handoffs/${duplicate.project_handoff.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "duplicate" });

    console.log("project handoff smoke passed");
  } finally {
    await client.end();
  }
}

async function createBase(client, tenantId, userId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Handoff Territory ${suffix}`, `HO${String(suffix).slice(-4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'customer', 'customer') RETURNING id", [tenantId, territory.rows[0].id, `Handoff Customer ${suffix}`]);
  const awardedOpportunityId = await createOpportunity(client, tenantId, userId, territory.rows[0].id, organization.rows[0].id, "awarded");
  const draftOpportunityId = await createOpportunity(client, tenantId, userId, territory.rows[0].id, organization.rows[0].id, "draft");
  const approvedCoveragePlan = await client.query("INSERT INTO coverage_plans (tenant_id, opportunity_id, status, coverage_readiness_score, coverage_readiness_band, operations_owner_user_id, approved_for_handoff_by, approved_for_handoff_at, created_by, updated_by) VALUES ($1, $2, 'approved_for_handoff', 90, 'ready_for_handoff', $3, $3, now(), $3, $3) RETURNING id", [tenantId, awardedOpportunityId, userId]);
  const unapprovedCoveragePlan = await client.query("INSERT INTO coverage_plans (tenant_id, opportunity_id, status, created_by, updated_by) VALUES ($1, $2, 'not_started', $3, $3) RETURNING id", [tenantId, awardedOpportunityId, userId]);
  const draftCoveragePlan = await client.query("INSERT INTO coverage_plans (tenant_id, opportunity_id, status, created_by, updated_by) VALUES ($1, $2, 'approved_for_handoff', $3, $3) RETURNING id", [tenantId, draftOpportunityId, userId]);
  return {
    tenantId,
    userId,
    territoryId: territory.rows[0].id,
    organizationId: organization.rows[0].id,
    awardedOpportunityId,
    draftOpportunityId,
    approvedCoveragePlanId: approvedCoveragePlan.rows[0].id,
    unapprovedCoveragePlanId: unapprovedCoveragePlan.rows[0].id,
    draftCoveragePlanId: draftCoveragePlan.rows[0].id,
  };
}

async function createOpportunity(client, tenantId, userId, territoryId, organizationId, status) {
  const result = await client.query(
    `
    INSERT INTO opportunities (
      tenant_id, title, organization_id, customer_organization_id, territory_id, owner_user_id, work_type,
      estimated_value, status, stage, summary, scope_summary, location_summary, source_type, awarded_by, awarded_at
    )
    VALUES ($1, $2, $3, $3, $4, $5, 'fiber', 100000, $6, $6, 'Handoff summary.', 'Handoff scope.', 'Handoff location.', 'manual_entry', $5, CASE WHEN $6 = 'awarded' THEN now() ELSE NULL END)
    RETURNING id
    `,
    [tenantId, `Handoff ${status} Opportunity ${Date.now()}-${Math.random()}`, organizationId, territoryId, userId, status],
  );
  return result.rows[0].id;
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Handoff User', 'x') RETURNING id", [`limited-handoff-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Handoff Tenant", `outside-handoff-${suffix}`]);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outside Handoff User', 'x') RETURNING id", [`outside-handoff-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenant.rows[0].id, user.rows[0].id]);
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, 'Outside Handoff Territory', 'OHO') RETURNING id", [tenant.rows[0].id]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, 'Outside Handoff Customer', 'customer', 'customer') RETURNING id", [tenant.rows[0].id, territory.rows[0].id]);
  const opportunity = await client.query("INSERT INTO opportunities (tenant_id, title, organization_id, customer_organization_id, territory_id, owner_user_id, work_type, estimated_value, status, stage) VALUES ($1, 'Outside Handoff Opportunity', $2, $2, $3, $4, 'fiber', 10000, 'awarded', 'awarded') RETURNING id", [tenant.rows[0].id, organization.rows[0].id, territory.rows[0].id, user.rows[0].id]);
  const plan = await client.query("INSERT INTO coverage_plans (tenant_id, opportunity_id, status, created_by, updated_by) VALUES ($1, $2, 'approved_for_handoff', $3, $3) RETURNING id", [tenant.rows[0].id, opportunity.rows[0].id, user.rows[0].id]);
  const handoff = await client.query("INSERT INTO project_handoffs (tenant_id, opportunity_id, coverage_plan_id, status, customer_organization_id, territory_id, work_type, scope_summary, location_summary, operations_owner_user_id, created_by, updated_by) VALUES ($1, $2, $3, 'draft', $4, $5, 'fiber', 'Outside scope', 'Outside location', $6, $6, $6) RETURNING id", [tenant.rows[0].id, opportunity.rows[0].id, plan.rows[0].id, organization.rows[0].id, territory.rows[0].id, user.rows[0].id]);
  return { handoffId: handoff.rows[0].id };
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

function assertSameExceptProjects(before, after, projectDelta, label) {
  for (const key of Object.keys(before)) {
    const expected = key === "projects" ? before[key] + projectDelta : before[key];
    if (after[key] !== expected) throw new Error(`${label}: expected ${key} count ${expected}, got ${after[key]}`);
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
