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

    await expectStatus("unauthorized blocked", "GET", "/projects", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/projects", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross-tenant project access blocked", "GET", `/projects/${outside.projectId}`, `Bearer ${token}`, 404);

    const downstreamBefore = await downstreamCounts(client);
    const created = await expectStatus("project creation from handoff works", "POST", `/project-handoffs/${base.handoffId}/create-project`, `Bearer ${token}`, 201, {
      creation_note: "Create project for project smoke.",
    });
    const projectId = created.project_handoff.project_id;
    if (!projectId) throw new Error("project handoff did not link created project");
    assertDownstreamBoundary(downstreamBefore, await downstreamCounts(client), 1, "handoff project creation boundary");

    const projectRecord = await client.query("SELECT * FROM projects WHERE id = $1", [projectId]);
    const project = projectRecord.rows[0];
    if (project.source_project_handoff_id !== base.handoffId || project.source_coverage_plan_id !== base.coveragePlanId || project.source_opportunity_id !== base.opportunityId) {
      throw new Error("project created from handoff missing source ids");
    }
    if (project.status !== "planning") throw new Error("project did not start in planning");

    const list = await expectStatus("project list returns enriched rows", "GET", "/projects", `Bearer ${token}`, 200);
    const listed = list.find((row) => row.id === projectId);
    if (!listed || listed.project_name !== project.name || listed.customer_organization_name === undefined || listed.recommended_next_action === undefined) throw new Error("project list row was not enriched");

    const detail = await expectStatus("project detail returns readiness", "GET", `/projects/${projectId}/detail`, `Bearer ${token}`, 200);
    if (!detail.readiness || !Array.isArray(detail.warnings) || !Array.isArray(detail.blockers)) throw new Error("project detail readiness shape missing");

    const recalculated = await expectStatus("recalculate readiness works", "POST", `/projects/${projectId}/recalculate-readiness`, `Bearer ${token}`, 201, {});
    if (recalculated.readiness?.project_readiness_score === null || recalculated.readiness?.project_readiness_score === undefined) throw new Error("project readiness was not recalculated");

    const blockerProject = await createProject(client, tenantId, userId, await createBase(client, tenantId, userId), { scopeSummary: null });
    await expectStatus("hard blocker prevents mark ready", "POST", `/projects/${blockerProject}/mark-ready-for-work`, `Bearer ${token}`, 400, {
      override_reasons: { readiness_override_reason: "Warnings accepted." },
    });

    const warningOnlyProject = await createProject(client, tenantId, userId, await createBase(client, tenantId, userId), { suffix: "warning", projectManager: null });
    const missingOverride = await expectStatus("warnings require override", "POST", `/projects/${warningOnlyProject}/mark-ready-for-work`, `Bearer ${token}`, 400, {});
    if (!missingOverride.required_override_fields?.includes("readiness_override_reason")) throw new Error("project readiness override field missing");
    await expectStatus("mark ready for work works", "POST", `/projects/${warningOnlyProject}/mark-ready-for-work`, `Bearer ${token}`, 201, {
      override_reasons: { readiness_override_reason: "Planning warnings assigned to operations." },
    });

    const beforeStart = await downstreamCounts(client);
    await expectStatus("start project works", "POST", `/projects/${warningOnlyProject}/start`, `Bearer ${token}`, 201, {});
    assertDownstreamBoundary(beforeStart, await downstreamCounts(client), 0, "project start downstream boundary");

    await expectStatus("place hold requires reason", "POST", `/projects/${warningOnlyProject}/place-on-hold`, `Bearer ${token}`, 400, {});
    await expectStatus("place hold works", "POST", `/projects/${warningOnlyProject}/place-on-hold`, `Bearer ${token}`, 201, { hold_reason: "customer_hold" });
    await expectStatus("release hold works", "POST", `/projects/${warningOnlyProject}/release-hold`, `Bearer ${token}`, 201, { release_note: "Customer hold released." });

    const beforeComplete = await downstreamCounts(client);
    await expectStatus("complete project works", "POST", `/projects/${warningOnlyProject}/complete`, `Bearer ${token}`, 201, { completion_note: "Field work complete." });
    assertDownstreamBoundary(beforeComplete, await downstreamCounts(client), 0, "project complete downstream boundary");

    const beforeClose = await downstreamCounts(client);
    await expectStatus("close project works", "POST", `/projects/${warningOnlyProject}/close`, `Bearer ${token}`, 201, { closeout_notes: "Closeout accepted." });
    assertDownstreamBoundary(beforeClose, await downstreamCounts(client), 0, "project close downstream boundary");

    await expectStatus("archive requires reason", "POST", `/projects/${projectId}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("archive works", "POST", `/projects/${projectId}/archive`, `Bearer ${token}`, 201, { archive_reason: "other" });

    const timeline = await expectStatus("timeline endpoint returns project events", "GET", `/projects/${warningOnlyProject}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["project.ready_for_work", "project.started", "project.on_hold", "project.hold_released", "project.completed", "project.closed"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`project timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/projects/${warningOnlyProject}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns project audit", "GET", `/projects/${warningOnlyProject}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.object_type === "project")) throw new Error("project audit missing project records");

    const search = await expectStatus("search includes projects", "GET", `/search?q=${encodeURIComponent("Project Smoke warning")}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "project" && row.id === warningOnlyProject)) throw new Error("project was not searchable");

    console.log("project smoke passed");
  } finally {
    await client.end();
  }
}

async function createBase(client, tenantId, userId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Project Territory ${suffix}`, `PJ${String(suffix).slice(-4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'customer', 'customer') RETURNING id", [tenantId, territory.rows[0].id, `Project Customer ${suffix}`]);
  const opportunity = await client.query(
    "INSERT INTO opportunities (tenant_id, title, organization_id, customer_organization_id, territory_id, work_type, estimated_value, owner_user_id, status, stage) VALUES ($1, $2, $3, $3, $4, 'fiber', 125000, $5, 'awarded', 'awarded') RETURNING id",
    [tenantId, `Project Opportunity ${suffix}`, organization.rows[0].id, territory.rows[0].id, userId],
  );
  const coverage = await client.query(
    "INSERT INTO coverage_plans (tenant_id, opportunity_id, status, coverage_readiness_score, capacity_readiness_score, compliance_readiness_score, economic_readiness_score, coverage_readiness_band, operations_owner_user_id, approved_for_handoff_by, approved_for_handoff_at, created_by, updated_by) VALUES ($1, $2, 'approved_for_handoff', 90, 90, 90, 90, 'ready_for_handoff', $3, $3, now(), $3, $3) RETURNING id",
    [tenantId, opportunity.rows[0].id, userId],
  );
  const handoff = await client.query(
    "INSERT INTO project_handoffs (tenant_id, opportunity_id, coverage_plan_id, status, customer_organization_id, territory_id, work_type, scope_summary, location_summary, operations_owner_user_id, project_manager_user_id, field_supervisor_user_id, expected_start_date, expected_end_date, approved_by, approved_at, created_by, updated_by) VALUES ($1, $2, $3, 'approved', $4, $5, 'fiber', 'Project smoke scope', 'Project smoke location', $6, $6, $6, '2026-09-01', '2026-10-01', $6, now(), $6, $6) RETURNING id",
    [tenantId, opportunity.rows[0].id, coverage.rows[0].id, organization.rows[0].id, territory.rows[0].id, userId],
  );
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, opportunityId: opportunity.rows[0].id, coveragePlanId: coverage.rows[0].id, handoffId: handoff.rows[0].id };
}

async function createProject(client, tenantId, userId, base, options = {}) {
  const suffix = options.suffix ?? crypto.randomUUID().slice(0, 8);
  const result = await client.query(
    `INSERT INTO projects (
      tenant_id, opportunity_id, source_opportunity_id, source_coverage_plan_id, source_project_handoff_id,
      customer_organization_id, territory_id, work_type, name, status, project_phase, scope_summary, location_summary,
      planned_start_date, planned_end_date, operations_owner_user_id, project_manager_user_id, field_supervisor_user_id,
      coverage_readiness_score, compliance_readiness_score, financial_readiness_score, documentation_requirements,
      billing_package_requirements, customer_validation_requirements, created_by, updated_by
    ) VALUES ($1, $2, $2, $3, $4, $5, $6, 'fiber', $7, 'planning', 'intake', $8, 'Project smoke location', '2026-09-01', '2026-10-01', $9, $10, $9, 90, 90, 90, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $9, $9) RETURNING id`,
    [tenantId, base.opportunityId, base.coveragePlanId, base.handoffId, base.organizationId, base.territoryId, `Project Smoke ${suffix}`, options.scopeSummary === null ? null : "Project smoke scope", userId, options.projectManager === null ? null : userId],
  );
  return result.rows[0].id;
}

async function createLimitedUser(client, tenantId) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, $2, 'x', 'active') RETURNING id", [`project-limited-${suffix}@example.com`, "Project Limited"]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [`Outside ${suffix}`, `outside-project-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, 'Outside Project Org', 'customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const project = await client.query("INSERT INTO projects (tenant_id, customer_organization_id, name, status) VALUES ($1, $2, 'Outside Project', 'planning') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  return { projectId: project.rows[0].id };
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

function assertDownstreamBoundary(before, after, expectedProjectDelta, label) {
  if (after.projects - before.projects !== expectedProjectDelta) throw new Error(`${label}: expected project delta ${expectedProjectDelta}, got ${after.projects - before.projects}`);
  for (const key of ["work_orders", "production_records", "settlements", "invoices", "payments", "ar_records"]) {
    if (after[key] !== before[key]) throw new Error(`${label}: ${key} changed`);
  }
}

async function expectStatus(label, method, path, authorization, expectedStatus, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { ...(authorization ? { authorization } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (response.status !== expectedStatus) throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}: ${text}`);
  return parsed;
}

function createToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
