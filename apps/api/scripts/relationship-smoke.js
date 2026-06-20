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
  const ownerUserId = await createOwnerUser(client, tenantId);
  const outside = await createOutsideTenant(client);
  const base = await createBase(client, tenantId);

  await expectStatus("unauthorized blocked", "GET", "/relationship-maps", undefined, 401);
  await expectStatus("missing permission blocked", "GET", "/relationship-maps", `Bearer ${limitedToken}`, 403);
  await expectStatus("cross-tenant relationship map blocked", "GET", `/relationship-maps/${outside.mapId}`, `Bearer ${token}`, 404);

  await expectStatus("invalid map type rejected", "POST", "/relationship-maps", `Bearer ${token}`, 400, {
    name: "Invalid Relationship Map",
    map_type: "social_graph",
    objective: "Invalid map type should be rejected.",
    target_organization_id: base.organizationId,
  });

  const createBefore = await counts(client);
  const map = await expectStatus("create relationship map with approved map type", "POST", "/relationship-maps", `Bearer ${token}`, 201, {
    name: `Relationship Smoke ${Date.now()}`,
    map_type: "prime_access",
    objective: "Secure subcontractor onboarding conversation with regional construction leadership.",
    desired_outcome: "Identify onboarding requirements and active overflow work opportunities.",
    target_organization_id: base.organizationId,
    target_contact_id: base.targetContactId,
    owner_user_id: ownerUserId,
    priority: "high",
    strategic_flag: true,
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    status: "no_path",
  });
  await expectWriteDelta(client, createBefore, 1, 1, 1, 1, "relationship map create");
  if (map.map_type !== "prime_access" || map.owner_user_id !== ownerUserId || map.strategic_flag !== true) {
    throw new Error("relationship map metadata did not persist");
  }

  await expectStatus("invalid status rejected", "POST", `/relationship-maps/${map.id}/status`, `Bearer ${token}`, 400, {
    status: "auto_researched",
    reason: "Invalid status should be rejected.",
  });

  const ownerBefore = await counts(client);
  const assigned = await expectStatus("owner assignment works", "POST", `/relationship-maps/${map.id}/assign-owner`, `Bearer ${token}`, 201, { owner_user_id: ownerUserId });
  await expectWriteDelta(client, ownerBefore, 1, 1, 1, 1, "relationship map owner assignment");
  if (assigned.owner_user_id !== ownerUserId) throw new Error("relationship owner assignment did not persist");
  await expectStatus("owner assignment rejects cross tenant user", "POST", `/relationship-maps/${map.id}/assign-owner`, `Bearer ${token}`, 404, { owner_user_id: outside.userId });

  await expectStatus("create path rejects cross-tenant contacts", "POST", `/relationship-maps/${map.id}/paths`, `Bearer ${token}`, 404, {
    path_name: "Cross tenant path",
    from_contact_id: outside.contactId,
    to_contact_id: base.targetContactId,
    strength_score: 60,
    confidence_score: 60,
    rank: 1,
  });
  await expectStatus("create path rejects same from/to contact", "POST", `/relationship-maps/${map.id}/paths`, `Bearer ${token}`, 400, {
    path_name: "Same contact path",
    from_contact_id: base.sourceContactId,
    to_contact_id: base.sourceContactId,
    strength_score: 60,
    confidence_score: 60,
    rank: 1,
  });
  await expectStatus("create path rejects invalid scores", "POST", `/relationship-maps/${map.id}/paths`, `Bearer ${token}`, 400, {
    path_name: "Invalid score path",
    from_contact_id: base.sourceContactId,
    to_contact_id: base.targetContactId,
    strength_score: 101,
    confidence_score: 60,
    rank: 1,
  });

  const pathBefore = await counts(client);
  const path = await expectStatus("create path with valid contacts", "POST", `/relationship-maps/${map.id}/paths`, `Bearer ${token}`, 201, {
    path_name: "Jackson ops director to prime vendor manager",
    from_contact_id: base.sourceContactId,
    to_contact_id: base.targetContactId,
    intermediary_contact_ids: [base.bridgeContactId],
    path_summary: "Bridge contact can introduce Jackson operations to the prime vendor manager.",
    strength_score: 82,
    confidence_score: 78,
    rank: 1,
    status: "active",
    recommended_action: "request_introduction",
    owner_user_id: ownerUserId,
    risk_notes: "Relationship should be reconfirmed before pursuit decision.",
  });
  await expectWriteDelta(client, pathBefore, 1, 1, 1, 1, "relationship path create");
  if (path.path_name !== "Jackson ops director to prime vendor manager" || path.status !== "active") throw new Error("relationship path metadata did not persist");

  const ranked = await expectStatus("rank path works", "POST", `/relationship-paths/${path.id}/rank`, `Bearer ${token}`, 201, { rank: 2 });
  if (ranked.rank !== 2) throw new Error("relationship path rank did not persist");

  const list = await expectStatus("enriched list filters", "GET", `/relationship-maps?map_type=prime_access&status=no_path&target_organization_id=${base.organizationId}&target_contact_id=${base.targetContactId}&owner_user_id=${ownerUserId}&strategic_flag=true&has_active_path=true&archived=false`, `Bearer ${token}`, 200);
  const row = list.find((item) => item.id === map.id);
  if (!row) throw new Error("enriched relationship map list did not return smoke map");
  for (const field of ["target_organization_name", "target_contact_name", "best_path_strength", "best_path_confidence", "relationship_access_score", "relationship_gaps", "recommended_next_action", "path_count"]) {
    if (!(field in row)) throw new Error(`enriched relationship map row missing ${field}`);
  }
  if (row.relationship_access_score !== 80) throw new Error(`expected access score 80, got ${row.relationship_access_score}`);

  for (const sort of ["access_score_desc", "strength_desc", "confidence_desc", "updated_desc"]) {
    const sorted = await expectStatus(`${sort} sorting works`, "GET", `/relationship-maps?sort=${sort}`, `Bearer ${token}`, 200);
    if (!Array.isArray(sorted)) throw new Error(`${sort} did not return an array`);
  }

  const detail = await expectStatus("detail returns contract sections", "GET", `/relationship-maps/${map.id}/detail`, `Bearer ${token}`, 200);
  if (!detail.relationship_map || !detail.target_organization || !detail.target_contact || !detail.paths?.length || !Array.isArray(detail.relationship_gaps) || detail.relationship_access_score !== 80) {
    throw new Error("relationship map detail missing required sections");
  }

  const timeline = await expectStatus("timeline returns map/path events", "GET", `/relationship-maps/${map.id}/timeline`, `Bearer ${token}`, 200);
  if (!timeline.some((event) => event.event_type === "relationship_map.created")) throw new Error("timeline missing relationship_map.created");
  if (!timeline.some((event) => event.event_type === "relationship_path.created")) throw new Error("timeline missing relationship_path.created");

  await expectStatus("audit summary enforces permission", "GET", `/relationship-maps/${map.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
  const audit = await expectStatus("audit summary returns map/path audits", "GET", `/relationship-maps/${map.id}/audit-summary`, `Bearer ${token}`, 200);
  if (!audit.some((row) => row.action === "relationship_map.create")) throw new Error("audit summary missing relationship_map.create");
  if (!audit.some((row) => row.action === "relationship_path.create")) throw new Error("audit summary missing relationship_path.create");

  await expectStatus("archive path requires reason", "POST", `/relationship-paths/${path.id}/archive`, `Bearer ${token}`, 400, {});
  const archivedPath = await expectStatus("archive path persists reason", "POST", `/relationship-paths/${path.id}/archive`, `Bearer ${token}`, 201, {
    archive_reason: "replaced_by_better_path",
    archive_note: "Smoke archive path.",
  });
  if (archivedPath.status !== "archived" || archivedPath.archive_reason !== "replaced_by_better_path") throw new Error("path archive metadata did not persist");

  await expectStatus("archive map requires reason", "POST", `/relationship-maps/${map.id}/archive`, `Bearer ${token}`, 400, {});
  const archiveBefore = await counts(client);
  const archived = await expectStatus("archive map persists reason", "POST", `/relationship-maps/${map.id}/archive`, `Bearer ${token}`, 201, {
    archive_reason: "no_longer_relevant",
    archive_note: "Smoke archive.",
  });
  await expectWriteDelta(client, archiveBefore, 1, 1, 1, 1, "relationship map archive");
  if (archived.status !== "archived" || archived.archive_reason !== "no_longer_relevant" || !archived.archived_by || !archived.archived_at) {
    throw new Error("relationship map archive metadata did not persist");
  }

  await client.end();
  console.log("relationship smoke passed");
}

async function createBase(client, tenantId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Relationship Smoke Territory ${suffix}`, "REL"]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, organization_type, type, actor_roles, territory_id) VALUES ($1, $2, 'prime_contractor', 'prime_contractor', ARRAY['work_distributor']::text[], $3) RETURNING id", [tenantId, `Relationship Smoke Prime ${suffix}`, territory.rows[0].id]);
  const source = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email, influence_score, decision_authority_score, relationship_strength_score) VALUES ($1, $2, 'Jackson Ops Director', 'relationship_bridge', 'ops-director@example.test', 70, 55, 80) RETURNING id", [tenantId, organization.rows[0].id]);
  const bridge = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email, influence_score, decision_authority_score, relationship_strength_score) VALUES ($1, $2, 'Prime Bridge Contact', 'relationship_bridge', 'bridge@example.test', 76, 60, 72) RETURNING id", [tenantId, organization.rows[0].id]);
  const target = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email, influence_score, decision_authority_score, relationship_strength_score) VALUES ($1, $2, 'Prime Vendor Manager', 'vendor_manager', 'vendor-manager@example.test', 82, 78, 65) RETURNING id", [tenantId, organization.rows[0].id]);
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, sourceContactId: source.rows[0].id, bridgeContactId: bridge.rows[0].id, targetContactId: target.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Relationship User', 'x') RETURNING id", [`limited-relationship-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOwnerUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Relationship Owner User', 'x') RETURNING id", [`owner-relationship-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Relationship Tenant", `outside-relationship-${suffix}`]);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outside Relationship User', 'x') RETURNING id", [`outside-relationship-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenant.rows[0].id, user.rows[0].id]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, organization_type, type) VALUES ($1, 'Outside Relationship Organization', 'prime_contractor', 'prime_contractor') RETURNING id", [tenant.rows[0].id]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email) VALUES ($1, $2, 'Outside Relationship Contact', 'vendor_manager', 'outside-relationship@example.test') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const map = await client.query("INSERT INTO relationship_maps (tenant_id, name, map_type, objective, target_organization_id, target_contact_id) VALUES ($1, 'Outside Relationship Map', 'prime_access', 'Outside map.', $2, $3) RETURNING id", [tenant.rows[0].id, organization.rows[0].id, contact.rows[0].id]);
  return { tenantId: tenant.rows[0].id, userId: user.rows[0].id, contactId: contact.rows[0].id, mapId: map.rows[0].id };
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM event_payloads) AS event_payloads,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs,
      (SELECT count(*)::int FROM system_actions) AS system_actions
  `);
  return result.rows[0];
}

async function expectWriteDelta(client, before, events, eventPayloads, auditLogs, systemActions, label) {
  const after = await counts(client);
  if (after.events !== before.events + events) throw new Error(`${label}: expected ${events} event delta`);
  if (after.event_payloads !== before.event_payloads + eventPayloads) throw new Error(`${label}: expected ${eventPayloads} event payload delta`);
  if (after.audit_logs !== before.audit_logs + auditLogs) throw new Error(`${label}: expected ${auditLogs} audit delta`);
  if (after.system_actions !== before.system_actions + systemActions) throw new Error(`${label}: expected ${systemActions} system action delta`);
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
