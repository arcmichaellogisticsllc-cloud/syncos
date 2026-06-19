const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";
const sprint4Permissions = [
  "capacity_provider.read",
  "capacity_provider.create",
  "capacity_provider.update",
  "capacity_provider.qualify",
  "capacity_provider.verify",
  "capacity_provider.contract",
  "capacity_provider.activate",
  "capacity_provider.suspend",
  "capacity_provider.archive",
  "crew.read",
  "crew.create",
  "crew.update",
  "crew.archive",
  "worker.read",
  "worker.create",
  "worker.update",
  "worker.archive",
  "equipment.read",
  "equipment.create",
  "equipment.update",
  "equipment.archive",
  "compliance_document.read",
  "compliance_document.create",
  "compliance_document.update",
  "compliance_document.verify",
  "compliance_document.archive",
  "capacity_record.read",
  "capacity_record.create",
  "capacity_record.update",
  "capacity_record.score",
  "capacity_record.archive",
  "capacity_gap_analysis.read",
  "capacity_gap_analysis.create",
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
  const marker = `S4${Date.now()}`;
  await assignRole(client, tenantId, tenantUserId, "Operations Manager");
  await assignRole(client, tenantId, tenantUserId, "Compliance Manager");
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  const nonAuthority = await createNonAuthorityUser(client, tenantId);
  const nonAuthorityToken = createToken({ sub: nonAuthority.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  await expectStatus("unauthorized capacity provider create blocked", "POST", "/capacity-providers", undefined, 401, { name: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});

  const base = await createBaseTenantData(client, tenantId, marker);
  const outside = await createOutsideTenantData(client);

  const providerBefore = await counts(client);
  const provider = await expectStatus("create capacity provider", "POST", "/capacity-providers", `Bearer ${token}`, 201, {
    name: `Sprint 4 Provider ${marker}`,
    organization_id: base.organizationId,
    primary_contact_id: base.contactId,
    provider_type: "subcontractor",
  });
  await expectWrite(client, providerBefore, "capacity_provider.created", "capacity provider create");
  await expectStatus("cross-tenant provider blocked", "GET", `/capacity-providers/${outside.providerId}`, `Bearer ${token}`, 404);

  await expectPatchEvent(client, "PATCH capacity provider", "PATCH", `/capacity-providers/${provider.id}`, token, "capacity_provider.updated", {
    name: `Sprint 4 Provider Updated ${marker}`,
    reason: "smoke update",
  });

  await expectStatus("provider cannot activate before verification", "POST", `/capacity-providers/${provider.id}/activate`, `Bearer ${token}`, 400, {});
  await expectStatus("qualify provider", "POST", `/capacity-providers/${provider.id}/qualify`, `Bearer ${token}`, 201, {});

  const firstDocument = await expectStatus("create compliance document", "POST", "/compliance-documents", `Bearer ${token}`, 201, {
    capacity_provider_id: provider.id,
    document_type: "insurance",
    status: "submitted",
  });
  await expectStatus("compliance document verify authority enforced", "POST", `/compliance-documents/${firstDocument.id}/verify`, `Bearer ${nonAuthorityToken}`, 403, {});
  await expectStatus("verify first compliance document", "POST", `/compliance-documents/${firstDocument.id}/verify`, `Bearer ${token}`, 201, {});
  await expectPatchEvent(client, "PATCH compliance document", "PATCH", `/compliance-documents/${firstDocument.id}`, token, "compliance_document.updated", {
    metadata: { source: "sprint4-smoke" },
    reason: "smoke update",
  });
  for (const type of ["w9", "msa", "rate_schedule", "safety_document", "crew_list"]) {
    const document = await expectStatus(`create ${type} document`, "POST", "/compliance-documents", `Bearer ${token}`, 201, {
      capacity_provider_id: provider.id,
      document_type: type,
      status: "submitted",
    });
    await expectStatus(`verify ${type} document`, "POST", `/compliance-documents/${document.id}/verify`, `Bearer ${token}`, 201, {});
  }

  await expectStatus("verify provider", "POST", `/capacity-providers/${provider.id}/verify`, `Bearer ${token}`, 201, {});
  await expectStatus("provider cannot activate before contract", "POST", `/capacity-providers/${provider.id}/activate`, `Bearer ${token}`, 400, {});
  await expectStatus("contract provider", "POST", `/capacity-providers/${provider.id}/contract`, `Bearer ${token}`, 201, {});

  const crew = await expectStatus("create crew", "POST", "/crews", `Bearer ${token}`, 201, {
    capacity_provider_id: provider.id,
    name: `Sprint 4 Bore Crew ${marker}`,
    crew_type: "bore",
  });
  await expectPatchEvent(client, "PATCH crew", "PATCH", `/crews/${crew.id}`, token, "crew.updated", { name: `Sprint 4 Bore Crew Updated ${marker}` });

  const worker = await expectStatus("create worker", "POST", "/workers", `Bearer ${token}`, 201, {
    capacity_provider_id: provider.id,
    crew_id: crew.id,
    first_name: "Sprint",
    last_name: `4 Worker ${marker}`,
  });
  await expectPatchEvent(client, "PATCH worker", "PATCH", `/workers/${worker.id}`, token, "worker.updated", { last_name: `4 Worker Updated ${marker}` });

  const equipment = await expectStatus("create equipment", "POST", "/equipment", `Bearer ${token}`, 201, {
    capacity_provider_id: provider.id,
    crew_id: crew.id,
    name: `Sprint 4 Drill ${marker}`,
    equipment_type: "drill",
  });
  await expectPatchEvent(client, "PATCH equipment", "PATCH", `/equipment/${equipment.id}`, token, "equipment.updated", { name: `Sprint 4 Drill Updated ${marker}` });

  const record = await expectStatus("create capacity record", "POST", "/capacity-records", `Bearer ${token}`, 201, {
    capacity_provider_id: provider.id,
    capacity_type: `Sprint 4 Bore Crew ${marker}`,
    territory_id: base.territoryId,
    availability_start: "2026-07-01",
    availability_end: "2026-07-31",
    production_rate: 100,
    production_unit: "feet",
    compliance_status: "compliant",
    insurance_status: "active",
    quantity: 2,
    unit: "crew",
  });
  await expectPatchEvent(client, "PATCH capacity record", "PATCH", `/capacity-records/${record.id}`, token, "capacity_record.updated", {
    current_utilization: 10,
  });
  const scored = await expectStatus("readiness score calculation", "POST", `/capacity-records/${record.id}/score`, `Bearer ${token}`, 201, {});
  if (Number(scored.readiness_score) !== 100) throw new Error(`readiness score mismatch: ${scored.readiness_score}`);

  const activated = await expectStatus("provider activates with required authority", "POST", `/capacity-providers/${provider.id}/activate`, `Bearer ${token}`, 201, {});
  if (activated.status !== "activated") throw new Error("provider did not activate");

  const gap = await expectStatus("capacity gap analysis", "POST", "/capacity-gap-analysis", `Bearer ${token}`, 201, {
    analysis_name: "Sprint 4 Gap Analysis",
    required_capacity: [{ capacity_type: `Sprint 4 Bore Crew ${marker}`, quantity: 3, territory_id: base.territoryId }],
  });
  const gapSummary = gap.gap_summary_json;
  if (!Array.isArray(gapSummary) || gapSummary[0]?.required_quantity !== 3 || gapSummary[0]?.available_quantity !== 2 || gapSummary[0]?.gap_quantity !== 1) {
    throw new Error(`gap analysis mismatch: ${JSON.stringify(gapSummary)}`);
  }
  await expectStatus("get capacity gap analysis", "GET", `/capacity-gap-analysis/${gap.id}`, `Bearer ${token}`, 200);

  const results = await expectStatus("tenant-scoped capacity search", "GET", `/search?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
  for (const expected of [
    ["capacity_provider", provider.id],
    ["crew", crew.id],
    ["worker", worker.id],
    ["equipment", equipment.id],
    ["capacity_record", record.id],
  ]) {
    if (!results.some((row) => row.object_type === expected[0] && row.id === expected[1])) {
      throw new Error(`search missing ${expected[0]}`);
    }
  }
  if (results.some((row) => row.id === outside.providerId)) throw new Error("search returned cross-tenant capacity provider");

  const forbiddenCounts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM projects) AS projects,
      (SELECT count(*)::int FROM work_orders) AS work_orders,
      (SELECT count(*)::int FROM production_records) AS production_records,
      (SELECT count(*)::int FROM recommendations) AS recommendations
  `);
  if (forbiddenCounts.rows[0].projects !== 0) throw new Error("Sprint 4 created project records");
  if (forbiddenCounts.rows[0].work_orders !== 0) throw new Error("Sprint 4 created work order records");
  if (forbiddenCounts.rows[0].production_records !== 0) throw new Error("Sprint 4 created production records");
  if (forbiddenCounts.rows[0].recommendations !== 0) throw new Error("Sprint 4 created recommendation records");

  await client.end();
  console.log("sprint4 smoke passed");
}

async function createBaseTenantData(client, tenantId, marker) {
  const suffix = marker;
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [
    tenantId,
    `Sprint 4 Territory ${suffix}`,
    `S4-${suffix}`,
  ]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'contractor') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Sprint 4 Organization ${suffix}`,
  ]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, email) VALUES ($1, $2, 'Sprint 4 Contact', 'sprint4@example.test') RETURNING id", [
    tenantId,
    organization.rows[0].id,
  ]);
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, contactId: contact.rows[0].id };
}

async function createOutsideTenantData(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 4 Outside Tenant", `sprint4-outside-${suffix}`]);
  const tenantId = tenant.rows[0].id;
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type) VALUES ($1, 'Outside Capacity Org', 'contractor') RETURNING id", [tenantId]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type) VALUES ($1, $2, 'Outside Provider', 'vendor') RETURNING id", [
    tenantId,
    organization.rows[0].id,
  ]);
  return { providerId: provider.rows[0].id };
}

async function createNonAuthorityUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name) VALUES ($1, 'Sprint 4 Non Authority') RETURNING id", [`sprint4-nonauthority-${suffix}@example.test`]);
  const tenantUser = await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2) RETURNING id", [tenantId, user.rows[0].id]);
  await assignRole(client, tenantId, tenantUser.rows[0].id, "Regional Director");
  await client.query(
    `
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT $1, r.id, p.id
    FROM roles r
    JOIN permissions p ON p.key = ANY($2::text[])
    WHERE r.tenant_id = $1 AND r.name = 'Regional Director'
    ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [tenantId, sprint4Permissions],
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
    "capacity_provider.created",
    "capacity_provider.updated",
    "compliance_document.updated",
    "crew.updated",
    "worker.updated",
    "equipment.updated",
    "capacity_record.updated",
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
