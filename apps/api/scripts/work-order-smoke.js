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
    const base = await createBase(client, tenantId, userId, "ready_for_work");
    const planning = await createBase(client, tenantId, userId, "planning");
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/work-orders", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/work-orders", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross-tenant blocked", "GET", `/work-orders/${outside.workOrderId}`, `Bearer ${token}`, 404);
    await expectStatus("create with invalid unit rejected", "POST", "/work-orders", `Bearer ${token}`, 400, workOrderPayload(base, { unit: "yards" }));
    await expectStatus("create with invalid status rejected", "POST", "/work-orders", `Bearer ${token}`, 400, workOrderPayload(base, { status: "bogus" }));
    await expectStatus("coverage source cross-tenant rejected", "POST", "/work-orders", `Bearer ${token}`, 404, workOrderPayload(base, { coverage_source_id: outside.coverageSourceId }));

    const downstreamBefore = await downstreamCounts(client);
    const planningDraft = await expectStatus("create draft work order for planning project works", "POST", "/work-orders", `Bearer ${token}`, 201, workOrderPayload(planning));
    if (planningDraft.work_order.status !== "draft") throw new Error("planning project work order did not start as draft");
    assertNoDownstream(await downstreamCounts(client), downstreamBefore, "planning draft boundary", 1);

    const workOrder = await expectStatus("create assignable work order works", "POST", "/work-orders", `Bearer ${token}`, 201, workOrderPayload(base));
    const workOrderId = workOrder.work_order.id;
    if (workOrder.work_order.production_eligible) throw new Error("draft work order should not be production eligible");

    const list = await expectStatus("enriched list returns work order fields", "GET", "/work-orders", `Bearer ${token}`, 200);
    const listed = list.find((row) => row.id === workOrderId);
    if (!listed || listed.project_name === undefined || listed.customer_organization_name === undefined || listed.recommended_next_action === undefined) throw new Error("work order list row was not enriched");
    await expectStatus("filters work", "GET", `/work-orders?project_id=${base.projectId}&status=draft`, `Bearer ${token}`, 200);
    await expectStatus("sorting works", "GET", "/work-orders?sort=readiness_asc", `Bearer ${token}`, 200);

    const detail = await expectStatus("detail returns summaries", "GET", `/work-orders/${workOrderId}/detail`, `Bearer ${token}`, 200);
    if (!detail.project_context || !detail.coverage_context || !detail.assignment_context || !detail.readiness || !detail.quantity_summary) throw new Error("work order detail missing required sections");

    await expectStatus("recalculate readiness works", "POST", `/work-orders/${workOrderId}/recalculate-readiness`, `Bearer ${token}`, 201, {});
    await expectStatus("mark ready succeeds when readiness sufficient", "POST", `/work-orders/${workOrderId}/mark-ready-to-assign`, `Bearer ${token}`, 201, {
      override_reasons: { readiness_override_reason: "Warnings tracked before assignment." },
    });

    await expectStatus("assign cross-tenant provider blocked", "POST", `/work-orders/${workOrderId}/assign`, `Bearer ${token}`, 404, { assignment_type: "subcontractor", assigned_capacity_provider_id: outside.providerId });
    await expectStatus("assign provider and crew works", "POST", `/work-orders/${workOrderId}/assign`, `Bearer ${token}`, 201, {
      assignment_type: "subcontractor",
      assigned_capacity_provider_id: base.providerId,
      assigned_crew_id: base.crewId,
      assignment_note: "Smoke assignment.",
    });
    await expectStatus("schedule works", "POST", `/work-orders/${workOrderId}/schedule`, `Bearer ${token}`, 201, { scheduled_start_date: "2026-09-03T12:00:00Z" });

    const beforeStart = await downstreamCounts(client);
    await expectStatus("start works and creates no production", "POST", `/work-orders/${workOrderId}/start`, `Bearer ${token}`, 201, {});
    assertNoDownstream(await downstreamCounts(client), beforeStart, "start boundary", 0);

    const beforeSubmit = await downstreamCounts(client);
    await expectStatus("submit works and creates no production", "POST", `/work-orders/${workOrderId}/submit`, `Bearer ${token}`, 201, {});
    assertNoDownstream(await downstreamCounts(client), beforeSubmit, "submit boundary", 0);

    const beforeQc = await downstreamCounts(client);
    await expectStatus("qc review works and creates no evidence", "POST", `/work-orders/${workOrderId}/start-qc-review`, `Bearer ${token}`, 201, {});
    assertNoDownstream(await downstreamCounts(client), beforeQc, "qc boundary", 0);

    await expectStatus("corrections require reason", "POST", `/work-orders/${workOrderId}/request-corrections`, `Bearer ${token}`, 400, {});
    await expectStatus("corrections work", "POST", `/work-orders/${workOrderId}/request-corrections`, `Bearer ${token}`, 201, { correction_reason: "Missing photo package." });
    await expectStatus("approve works", "POST", `/work-orders/${workOrderId}/approve`, `Bearer ${token}`, 201, { approval_note: "Accepted for smoke.", approved_quantity: 500 });

    const beforeBillable = await downstreamCounts(client);
    await expectStatus("mark billable creates no finance", "POST", `/work-orders/${workOrderId}/mark-billable`, `Bearer ${token}`, 201, {});
    assertNoDownstream(await downstreamCounts(client), beforeBillable, "billable boundary", 0);

    await expectStatus("place hold requires reason", "POST", `/work-orders/${workOrderId}/place-on-hold`, `Bearer ${token}`, 400, {});
    await expectStatus("place hold works", "POST", `/work-orders/${workOrderId}/place-on-hold`, `Bearer ${token}`, 201, { hold_reason: "customer_access" });
    await expectStatus("release hold works", "POST", `/work-orders/${workOrderId}/release-hold`, `Bearer ${token}`, 201, { release_note: "Access cleared." });
    await expectStatus("close requires note", "POST", `/work-orders/${workOrderId}/close`, `Bearer ${token}`, 400, {});
    await expectStatus("close works", "POST", `/work-orders/${workOrderId}/close`, `Bearer ${token}`, 201, { closeout_notes: "Closed for smoke." });

    const cancelOrder = await expectStatus("create cancellable work order", "POST", "/work-orders", `Bearer ${token}`, 201, workOrderPayload(base, { work_order_name: `Cancel WO ${Date.now()}` }));
    await expectStatus("cancel requires reason", "POST", `/work-orders/${cancelOrder.work_order.id}/cancel`, `Bearer ${token}`, 400, {});
    await expectStatus("cancel works", "POST", `/work-orders/${cancelOrder.work_order.id}/cancel`, `Bearer ${token}`, 201, { cancellation_reason: "created_in_error" });

    const archiveOrder = await expectStatus("create archivable work order", "POST", "/work-orders", `Bearer ${token}`, 201, workOrderPayload(base, { work_order_name: `Archive WO ${Date.now()}` }));
    await expectStatus("archive requires reason", "POST", `/work-orders/${archiveOrder.work_order.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("archive works", "POST", `/work-orders/${archiveOrder.work_order.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "other" });

    const timeline = await expectStatus("timeline endpoint returns work order events", "GET", `/work-orders/${workOrderId}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["work_order.created", "work_order.assigned", "work_order.started", "work_order.marked_billable", "work_order.closed"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`work order timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/work-orders/${workOrderId}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/work-orders/${workOrderId}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.object_type === "work_order")) throw new Error("work order audit missing records");

    const search = await expectStatus("search includes work orders", "GET", `/search?q=${encodeURIComponent("Smoke Fiber Work")}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "work_order" && row.id === workOrderId)) throw new Error("work order was not searchable");

    console.log("work order smoke passed");
  } finally {
    await client.end();
  }
}

function workOrderPayload(base, overrides = {}) {
  return {
    project_id: base.projectId,
    coverage_plan_id: base.coveragePlanId,
    coverage_requirement_id: base.coverageRequirementId,
    coverage_source_id: base.coverageSourceId,
    work_order_name: "Smoke Fiber Work Order",
    scope_summary: "Smoke Fiber Work scope",
    location_summary: "Smoke Fiber Work location",
    work_type: "fiber",
    territory_id: base.territoryId,
    planned_quantity: 500,
    unit: "feet",
    planned_start_date: "2026-09-02",
    documentation_requirements: { photos: true },
    ...overrides,
  };
}

async function createBase(client, tenantId, userId, projectStatus) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `WO Territory ${suffix}`, `WO${suffix.slice(0, 4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'customer', 'customer') RETURNING id", [tenantId, territory.rows[0].id, `WO Customer ${suffix}`]);
  const opportunity = await client.query(
    "INSERT INTO opportunities (tenant_id, title, organization_id, customer_organization_id, territory_id, work_type, estimated_value, owner_user_id, status, stage) VALUES ($1, $2, $3, $3, $4, 'fiber', 75000, $5, 'awarded', 'awarded') RETURNING id",
    [tenantId, `WO Opportunity ${suffix}`, organization.rows[0].id, territory.rows[0].id, userId],
  );
  const coverage = await client.query(
    "INSERT INTO coverage_plans (tenant_id, opportunity_id, status, coverage_readiness_score, capacity_readiness_score, compliance_readiness_score, economic_readiness_score, coverage_readiness_band, operations_owner_user_id, approved_for_handoff_by, approved_for_handoff_at, created_by, updated_by) VALUES ($1, $2, 'approved_for_handoff', 90, 90, 90, 90, 'ready_for_handoff', $3, $3, now(), $3, $3) RETURNING id",
    [tenantId, opportunity.rows[0].id, userId],
  );
  const requirement = await client.query("INSERT INTO coverage_requirements (tenant_id, coverage_plan_id, work_type, territory_id, quantity, unit, created_by, updated_by) VALUES ($1, $2, 'fiber', $3, 1000, 'feet', $4, $4) RETURNING id", [tenantId, coverage.rows[0].id, territory.rows[0].id, userId]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, $3, 'subcontractor', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, organization.rows[0].id, `WO Provider ${suffix}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'splicing', 'active') RETURNING id", [tenantId, provider.rows[0].id, `WO Crew ${suffix}`]);
  const source = await client.query(
    "INSERT INTO coverage_sources (tenant_id, coverage_plan_id, coverage_requirement_id, source_type, organization_id, capacity_provider_id, crew_id, covered_quantity, unit, confidence_score, commitment_status, created_by, updated_by) VALUES ($1, $2, $3, 'approved_subcontractor', $4, $5, $6, 1000, 'feet', 90, 'committed', $7, $7) RETURNING id",
    [tenantId, coverage.rows[0].id, requirement.rows[0].id, organization.rows[0].id, provider.rows[0].id, crew.rows[0].id, userId],
  );
  const project = await client.query(
    `INSERT INTO projects (
      tenant_id, opportunity_id, source_opportunity_id, source_coverage_plan_id, customer_organization_id, territory_id, work_type,
      name, status, project_phase, scope_summary, location_summary, planned_start_date, planned_end_date,
      operations_owner_user_id, project_manager_user_id, field_supervisor_user_id, coverage_readiness_score,
      compliance_readiness_score, financial_readiness_score, documentation_requirements, billing_package_requirements,
      customer_validation_requirements, created_by, updated_by
    ) VALUES ($1, $2, $2, $3, $4, $5, 'fiber', $6, $7, 'pre_construction', 'WO project scope', 'WO project location', '2026-09-01', '2026-10-01', $8, $8, $8, 90, 90, 90, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $8, $8) RETURNING id`,
    [tenantId, opportunity.rows[0].id, coverage.rows[0].id, organization.rows[0].id, territory.rows[0].id, `WO Project ${suffix}`, projectStatus, userId],
  );
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, opportunityId: opportunity.rows[0].id, coveragePlanId: coverage.rows[0].id, coverageRequirementId: requirement.rows[0].id, coverageSourceId: source.rows[0].id, providerId: provider.rows[0].id, crewId: crew.rows[0].id, projectId: project.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, $2, 'x', 'active') RETURNING id", [`work-order-limited-${suffix}@example.com`, "Work Order Limited"]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [`Outside WO ${suffix}`, `outside-wo-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, 'Outside WO Org', 'customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const opportunity = await client.query("INSERT INTO opportunities (tenant_id, title, organization_id, customer_organization_id, work_type, estimated_value, status, stage) VALUES ($1, 'Outside WO Opportunity', $2, $2, 'fiber', 100, 'awarded', 'awarded') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const project = await client.query("INSERT INTO projects (tenant_id, customer_organization_id, name, status) VALUES ($1, $2, 'Outside WO Project', 'ready_for_work') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status) VALUES ($1, $2, 'Outside Provider', 'subcontractor', 'activated') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const workOrder = await client.query("INSERT INTO work_orders (tenant_id, project_id, title, work_order_name, work_type, scope_summary, location_summary, expected_units, planned_quantity, unit_type, unit, status) VALUES ($1, $2, 'Outside WO', 'Outside WO', 'fiber', 'Outside scope', 'Outside location', 1, 1, 'feet', 'feet', 'draft') RETURNING id", [tenant.rows[0].id, project.rows[0].id]);
  const coverage = await client.query("INSERT INTO coverage_plans (tenant_id, opportunity_id, status) VALUES ($1, $2, 'approved_for_handoff') RETURNING id", [tenant.rows[0].id, opportunity.rows[0].id]);
  const source = await client.query("INSERT INTO coverage_sources (tenant_id, coverage_plan_id, source_type, covered_quantity, unit, confidence_score, commitment_status) VALUES ($1, $2, 'approved_subcontractor', 1, 'feet', 80, 'committed') RETURNING id", [tenant.rows[0].id, coverage.rows[0].id]);
  return { workOrderId: workOrder.rows[0].id, providerId: provider.rows[0].id, coverageSourceId: source.rows[0].id };
}

async function downstreamCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM work_orders) AS work_orders,
      (SELECT count(*)::int FROM production_records) AS production_records,
      (SELECT count(*)::int FROM production_evidence) AS production_evidence,
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM ar_records) AS ar_records
  `);
  return result.rows[0];
}

function assertNoDownstream(after, before, label, expectedWorkOrderDelta) {
  if (after.work_orders - before.work_orders !== expectedWorkOrderDelta) throw new Error(`${label}: work order delta changed`);
  for (const key of ["production_records", "production_evidence", "settlements", "invoices", "payments", "ar_records"]) {
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
