const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";
const sprint5Permissions = [
  "project.read",
  "project.create",
  "project.update",
  "project.archive",
  "work_order.read",
  "work_order.create",
  "work_order.update",
  "work_order.assign",
  "work_order.start",
  "work_order.archive",
  "production_record.read",
  "production_record.create",
  "production_record.update",
  "production_record.submit",
  "production_record.correction_required",
  "production_record.archive",
  "production_evidence.read",
  "production_evidence.create",
  "production_evidence.update",
  "production_evidence.archive",
  "search.read",
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.AUTH_JWT_SECRET;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required");

  const client = new Client({ connectionString });
  await client.connect();

  const seeded = await client.query(`
    SELECT u.id AS user_id, t.id AS tenant_id, tu.id AS tenant_user_id
    FROM users u
    JOIN tenant_users tu ON tu.user_id = u.id
    JOIN tenants t ON t.id = tu.tenant_id
    WHERE u.email = 'admin@jackson-telcom.local'
      AND t.slug = 'jackson-telcom'
    LIMIT 1
  `);
  if (!seeded.rows[0]) throw new Error("Seeded Jackson Telcom admin user was not found");
  const { user_id: userId, tenant_id: tenantId, tenant_user_id: tenantUserId } = seeded.rows[0];
  const marker = `S5${Date.now()}`;
  await assignRole(client, tenantId, tenantUserId, "Operations Manager");
  await assignRole(client, tenantId, tenantUserId, "Project Manager");
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const nonAuthority = await createNonAuthorityUser(client, tenantId);
  const nonAuthorityToken = createToken({ sub: nonAuthority.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  await expectStatus("unauthorized project create blocked", "POST", "/projects", undefined, 401, { name: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});

  const base = await createBaseData(client, tenantId, userId, marker);
  const outside = await createOutsideData(client);

  await expectStatus("project creation requires awarded opportunity", "POST", "/projects", `Bearer ${token}`, 400, {
    opportunity_id: base.nonAwardedOpportunityId,
    customer_organization_id: base.customerOrganizationId,
    name: `Project Blocked ${marker}`,
  });

  const projectBefore = await counts(client);
  const project = await expectStatus("project create", "POST", "/projects", `Bearer ${token}`, 201, {
    opportunity_id: base.opportunityId,
    customer_organization_id: base.customerOrganizationId,
    name: `Project ${marker}`,
  });
  await expectWrite(client, projectBefore, "project.created", "project create");
  await client.query("UPDATE projects SET status = 'ready_for_work', project_phase = 'pre_construction' WHERE id = $1", [project.id]);
  await expectStatus("cross-tenant project blocked", "GET", `/projects/${outside.projectId}`, `Bearer ${token}`, 404);

  const workOrderBefore = await counts(client);
  const workOrder = await expectStatus("work order create", "POST", "/work-orders", `Bearer ${token}`, 201, {
    project_id: project.id,
    title: `Work Order ${marker}`,
    work_type: "fiber_build",
    location_description: `Location ${marker}`,
    expected_units: 100,
    unit_type: "feet",
  });
  await expectWrite(client, workOrderBefore, "work_order.created", "work order create");

  const inactiveWorkOrder = await expectStatus("inactive-provider work order create", "POST", "/work-orders", `Bearer ${token}`, 201, {
    project_id: project.id,
    title: `Inactive Work Order ${marker}`,
    work_type: "fiber_build",
    location_description: `Inactive Location ${marker}`,
    expected_units: 50,
    unit_type: "feet",
  });
  await expectStatus("assign requires activated provider", "POST", `/work-orders/${inactiveWorkOrder.id}/assign`, `Bearer ${token}`, 400, {
    assigned_capacity_provider_id: base.inactiveProviderId,
  });
  await expectStatus("start requires assigned status", "POST", `/work-orders/${workOrder.id}/start`, `Bearer ${token}`, 400, {});

  const assigned = await expectStatus("assign work order", "POST", `/work-orders/${workOrder.id}/assign`, `Bearer ${token}`, 201, {
    assigned_capacity_provider_id: base.providerId,
    assigned_crew_id: base.crewId,
  });
  if (assigned.status !== "assigned") throw new Error("work order not assigned");

  const productionBefore = await counts(client);
  const draft = await expectStatus("production record create", "POST", "/production-records", `Bearer ${token}`, 201, {
    project_id: project.id,
    work_order_id: workOrder.id,
    capacity_provider_id: base.providerId,
    crew_id: base.crewId,
    production_date: "2026-08-01",
    quantity_submitted: 10,
    unit_type: "feet",
  });
  await expectWrite(client, productionBefore, "production_record.created", "production record create");
  await expectStatus("production submit blocked if work order not in_progress", "POST", `/production-records/${draft.id}/submit`, `Bearer ${token}`, 400, {});

  const started = await expectStatus("start work order", "POST", `/work-orders/${workOrder.id}/start`, `Bearer ${token}`, 201, {});
  if (started.status !== "in_progress") throw new Error("work order not in_progress");
  await expectStatus("production submit blocked without evidence", "POST", `/production-records/${draft.id}/submit`, `Bearer ${token}`, 400, {});

  const evidenceBefore = await counts(client);
  const evidence = await expectStatus("create production evidence", "POST", `/production-records/${draft.id}/evidence`, `Bearer ${token}`, 201, {
    evidence_type: "photo",
    description: `Evidence ${marker}`,
    source_url: "https://example.test/evidence.jpg",
  });
  await expectWrite(client, evidenceBefore, "production_evidence.created", "evidence create");

  await expectPatchEvent(client, "PATCH production evidence", "PATCH", `/production-evidence/${evidence.id}`, token, "production_evidence.updated", {
    description: `Evidence Updated ${marker}`,
  });
  const archiveEvidenceBefore = await counts(client);
  const archivedEvidence = await expectStatus("archive production evidence", "POST", `/production-evidence/${evidence.id}/archive`, `Bearer ${token}`, 201, {});
  await expectWrite(client, archiveEvidenceBefore, "production_evidence.archived", "evidence archive");
  if (archivedEvidence.status !== "archived") throw new Error("evidence not archived");
  const activeEvidence = await expectStatus("create active production evidence", "POST", `/production-records/${draft.id}/evidence`, `Bearer ${token}`, 201, {
    evidence_type: "daily_report",
    description: `Active Evidence ${marker}`,
  });
  if (!activeEvidence.id) throw new Error("active evidence missing id");

  const submitted = await expectStatus("production submit succeeds", "POST", `/production-records/${draft.id}/submit`, `Bearer ${token}`, 201, {
    submitted_by_user_id: userId,
  });
  if (submitted.status !== "submitted") throw new Error("production record not submitted");

  await expectStatus("correction required requires reason", "POST", `/production-records/${draft.id}/correction-required`, `Bearer ${token}`, 400, {});
  await expectStatus("correction required requires authority", "POST", `/production-records/${draft.id}/correction-required`, `Bearer ${nonAuthorityToken}`, 403, {
    reason: `Needs correction ${marker}`,
  });
  const correction = await expectStatus("correction required succeeds", "POST", `/production-records/${draft.id}/correction-required`, `Bearer ${token}`, 201, {
    reason: `Needs correction ${marker}`,
  });
  if (correction.status !== "correction_required") throw new Error("correction status not set");

  const results = await expectStatus("tenant-scoped production search", "GET", `/search?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
  for (const expected of [
    ["project", project.id],
    ["work_order", workOrder.id],
    ["production_record", draft.id],
  ]) {
    if (!results.some((row) => row.object_type === expected[0] && row.id === expected[1])) throw new Error(`search missing ${expected[0]}`);
  }
  if (results.some((row) => row.id === outside.projectId)) throw new Error("search returned cross-tenant project");

  const forbiddenCounts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM approvals WHERE entity_type = 'production_record') AS qc_approvals,
      (SELECT count(*)::int FROM production_records WHERE status = 'billable') AS billable_production,
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments
  `);
  if (forbiddenCounts.rows[0].qc_approvals !== 0) throw new Error("Sprint 5 created QC approval records");
  if (forbiddenCounts.rows[0].billable_production !== 0) throw new Error("Sprint 5 created billable production");
  if (forbiddenCounts.rows[0].settlements !== 0) throw new Error("Sprint 5 created settlements");
  if (forbiddenCounts.rows[0].invoices !== 0) throw new Error("Sprint 5 created invoices");
  if (forbiddenCounts.rows[0].payments !== 0) throw new Error("Sprint 5 created payments");

  await client.end();
  console.log("sprint5 smoke passed");
}

async function createBaseData(client, tenantId, userId, marker) {
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantId, `Territory ${marker}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'customer') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Customer ${marker}`,
  ]);
  const opportunity = await client.query(
    `
    INSERT INTO opportunities (tenant_id, organization_id, territory_id, owner_user_id, title, work_type, evidence_summary, status, stage)
    VALUES ($1, $2, $3, $4, $5, 'fiber_build', 'award evidence', 'awarded', 'awarded')
    RETURNING id
    `,
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId, `Opportunity ${marker}`],
  );
  const nonAwarded = await client.query(
    `
    INSERT INTO opportunities (tenant_id, organization_id, territory_id, owner_user_id, title, work_type, evidence_summary, status, stage)
    VALUES ($1, $2, $3, $4, $5, 'fiber_build', 'qualified evidence', 'qualified', 'qualified')
    RETURNING id
    `,
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId, `Non Awarded ${marker}`],
  );
  const provider = await client.query(
    "INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status, verification_status, contract_status) VALUES ($1, $2, $3, 'subcontractor', 'activated', 'verified', 'contracted') RETURNING id",
    [tenantId, organization.rows[0].id, `Provider ${marker}`],
  );
  const inactiveProvider = await client.query(
    "INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status) VALUES ($1, $2, $3, 'subcontractor', 'qualified') RETURNING id",
    [tenantId, organization.rows[0].id, `Inactive Provider ${marker}`],
  );
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type) VALUES ($1, $2, $3, 'bore') RETURNING id", [
    tenantId,
    provider.rows[0].id,
    `Crew ${marker}`,
  ]);
  return {
    territoryId: territory.rows[0].id,
    customerOrganizationId: organization.rows[0].id,
    opportunityId: opportunity.rows[0].id,
    nonAwardedOpportunityId: nonAwarded.rows[0].id,
    providerId: provider.rows[0].id,
    inactiveProviderId: inactiveProvider.rows[0].id,
    crewId: crew.rows[0].id,
  };
}

async function createOutsideData(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 5 Outside Tenant", `sprint5-outside-${suffix}`]);
  const tenantId = tenant.rows[0].id;
  const project = await client.query("INSERT INTO projects (tenant_id, name) VALUES ($1, 'Outside Project') RETURNING id", [tenantId]);
  return { projectId: project.rows[0].id };
}

async function createNonAuthorityUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name) VALUES ($1, 'Sprint 5 Non Authority') RETURNING id", [`sprint5-nonauthority-${suffix}@example.test`]);
  const tenantUser = await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2) RETURNING id", [tenantId, user.rows[0].id]);
  await assignRole(client, tenantId, tenantUser.rows[0].id, "Foreman");
  await client.query(
    `
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT $1, r.id, p.id
    FROM roles r
    JOIN permissions p ON p.key = ANY($2::text[])
    WHERE r.tenant_id = $1 AND r.name = 'Foreman'
    ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [tenantId, sprint5Permissions],
  );
  return { userId: user.rows[0].id };
}

async function assignRole(client, tenantId, tenantUserId, roleName) {
  const role = await client.query("SELECT id FROM roles WHERE tenant_id = $1 AND name = $2", [tenantId, roleName]);
  if (!role.rows[0]) throw new Error(`${roleName} role not found`);
  await client.query(
    `
    INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
    VALUES ($1, $2, $3, 'tenant', $1)
    ON CONFLICT (tenant_user_id, role_id, scope_type, scope_id) DO NOTHING
    `,
    [tenantId, tenantUserId, role.rows[0].id],
  );
}

async function expectPatchEvent(client, name, method, path, token, eventType, body) {
  const before = await counts(client);
  await expectStatus(name, method, path, `Bearer ${token}`, 200, body);
  await expectWrite(client, before, eventType, name);
}

async function expectWrite(client, before, eventType, label) {
  const after = await counts(client);
  if (after.events !== before.events + 1) throw new Error(`${label}: expected event delta`);
  if (after.event_payloads !== before.event_payloads + 1) throw new Error(`${label}: expected event payload delta`);
  if (after.audit_logs !== before.audit_logs + 1) throw new Error(`${label}: expected audit delta`);
  if (after.system_actions !== before.system_actions + 1) throw new Error(`${label}: expected system action delta`);
  if (after[eventType] !== before[eventType] + 1) throw new Error(`${label}: expected ${eventType}`);
}

async function counts(client) {
  const eventTypes = [
    "project.created",
    "work_order.created",
    "production_record.created",
    "production_evidence.created",
    "production_evidence.updated",
    "production_evidence.archived",
  ];
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM event_payloads) AS event_payloads,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs,
      (SELECT count(*)::int FROM system_actions) AS system_actions,
      ${eventTypes.map((type, index) => `(SELECT count(*)::int FROM events WHERE event_type = $${index + 1}) AS "${type}"`).join(",\n      ")}
    `,
    eventTypes,
  );
  return result.rows[0];
}

async function expectStatus(name, method, path, authorization, expected, body) {
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status !== expected) {
    const text = await response.text();
    throw new Error(`${name}: expected ${expected}, got ${response.status}: ${text}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
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
