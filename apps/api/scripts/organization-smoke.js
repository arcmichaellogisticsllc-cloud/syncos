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

  await expectStatus("unauthorized blocked", "GET", "/organizations", undefined, 401);
  await expectStatus("missing permission blocked", "GET", "/organizations", `Bearer ${limitedToken}`, 403);
  await expectStatus("cross-tenant organization blocked", "GET", `/organizations/${outside.organizationId}`, `Bearer ${token}`, 404);

  await expectStatus("invalid organization type rejected", "POST", "/organizations", `Bearer ${token}`, 400, {
    name: "Invalid Org",
    organization_type: "invented_type",
    actor_roles: ["work_creator"],
    territory_id: base.territoryId,
  });
  await expectStatus("invalid actor role rejected", "POST", "/organizations", `Bearer ${token}`, 400, {
    name: "Invalid Role Org",
    organization_type: "utility",
    actor_roles: ["made_up_role"],
    territory_id: base.territoryId,
  });

  const createBefore = await counts(client);
  const organization = await expectStatus("create organization with taxonomy", "POST", "/organizations", `Bearer ${token}`, 201, {
    name: `Jackson Utility ${Date.now()}`,
    legal_name: "Jackson Utility Cooperative",
    organization_type: "utility",
    actor_roles: ["work_creator", "cash_controller"],
    territory_id: base.territoryId,
    status: "researched",
    trust_level: "medium",
    strategic_flag: true,
    influence_score: 76,
    work_relevance_score: 82,
    capacity_relevance_score: 15,
    payment_relevance_score: 61,
    description: "Regional utility actor for broadband make-ready and fiber construction intelligence.",
  });
  await expectWriteDelta(client, createBefore, 1, 1, 1, 1, "organization create");
  if (!organization.actor_roles.includes("work_creator") || !organization.actor_roles.includes("cash_controller")) throw new Error("multiple actor roles did not persist");
  if (organization.organization_type !== "utility" || organization.trust_level !== "medium") throw new Error("organization taxonomy fields did not persist");

  const ownerBefore = await counts(client);
  const assigned = await expectStatus("relationship owner assignment works", "POST", `/organizations/${organization.id}/assign-owner`, `Bearer ${token}`, 201, {
    owner_user_id: ownerUserId,
  });
  await expectWriteDelta(client, ownerBefore, 1, 1, 1, 1, "owner assignment");
  if (assigned.relationship_owner_user_id !== ownerUserId) throw new Error("owner assignment did not persist");
  await expectStatus("owner assignment rejects cross-tenant user", "POST", `/organizations/${organization.id}/assign-owner`, `Bearer ${token}`, 404, {
    owner_user_id: outside.userId,
  });

  await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, email, status, verification_status) VALUES ($1, $2, 'Org Smoke Contact', 'org-smoke@example.test', 'verified', 'verified')", [tenantId, organization.id]);
  const signal = await client.query("INSERT INTO signals (tenant_id, title, source_name, status) VALUES ($1, 'Org Smoke Signal', 'org-smoke', 'verified') RETURNING id", [tenantId]);
  await client.query(
    "INSERT INTO signal_entities (tenant_id, signal_id, entity_type, entity_id, is_primary, linked_by) VALUES ($1, $2, 'organization', $3, true, $4)",
    [tenantId, signal.rows[0].id, organization.id, userId],
  );

  const qualifyBefore = await counts(client);
  const qualified = await expectStatus("qualify sets metadata", "POST", `/organizations/${organization.id}/qualify`, `Bearer ${token}`, 201, {});
  await expectWriteDelta(client, qualifyBefore, 1, 1, 1, 1, "organization qualify");
  if (qualified.status !== "qualified" || !qualified.qualified_by || !qualified.qualified_at) throw new Error("qualification metadata was not persisted");

  const list = await expectStatus("enriched list returns fields", "GET", `/organizations?organization_type=utility&actor_role=work_creator&strategic_flag=true&relationship_owner_user_id=${ownerUserId}&trust_level=medium&has_contacts=true&has_signals=true&archived=false&sort=strategic_first`, `Bearer ${token}`, 200);
  const row = list.find((item) => item.id === organization.id);
  if (!row) throw new Error("enriched list did not return created organization");
  for (const field of ["relationship_owner_name", "contacts_count", "verified_contacts_count", "signals_count", "completeness_score", "missing_intelligence_items", "recommended_next_action"]) {
    if (!(field in row)) throw new Error(`enriched organization row missing ${field}`);
  }

  const sorted = await expectStatus("influence sort works", "GET", "/organizations?sort=influence_desc&archived=false", `Bearer ${token}`, 200);
  if (!Array.isArray(sorted)) throw new Error("sorted organization list did not return array");

  const detail = await expectStatus("detail returns summaries", "GET", `/organizations/${organization.id}/detail`, `Bearer ${token}`, 200);
  if (!detail.organization || !detail.contacts?.length || !detail.signals?.length || !detail.completeness || !detail.actor_guidance) {
    throw new Error("organization detail missing required sections");
  }

  const timeline = await expectStatus("timeline returns organization events", "GET", `/organizations/${organization.id}/timeline`, `Bearer ${token}`, 200);
  if (!timeline.some((event) => event.event_type === "organization.created")) throw new Error("timeline missing organization.created");

  await expectStatus("audit summary enforces permission", "GET", `/organizations/${organization.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
  const audit = await expectStatus("audit summary returns direct audits", "GET", `/organizations/${organization.id}/audit-summary`, `Bearer ${token}`, 200);
  if (!audit.some((row) => row.action === "organization.create")) throw new Error("audit summary missing organization.create");

  await expectStatus("archive requires reason", "POST", `/organizations/${organization.id}/archive`, `Bearer ${token}`, 400, {});
  const archiveBefore = await counts(client);
  const archived = await expectStatus("archive persists reason", "POST", `/organizations/${organization.id}/archive`, `Bearer ${token}`, 201, {
    archive_reason: "inactive",
    archive_note: "Smoke test archive.",
  });
  await expectWriteDelta(client, archiveBefore, 1, 1, 1, 1, "organization archive");
  if (archived.status !== "archived" || archived.archive_reason !== "inactive" || !archived.archived_by || !archived.archived_at) {
    throw new Error("archive metadata was not persisted");
  }

  await client.end();
  console.log("organization smoke passed");
}

async function createBase(client, tenantId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Org Smoke Territory ${suffix}`, "ORG"]);
  return { territoryId: territory.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Organization User', 'x') RETURNING id", [`limited-org-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOwnerUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Organization Owner User', 'x') RETURNING id", [`owner-org-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Organization Tenant", `outside-org-${suffix}`]);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outside Organization User', 'x') RETURNING id", [`outside-org-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenant.rows[0].id, user.rows[0].id]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, organization_type, type) VALUES ($1, 'Outside Organization', 'utility', 'utility') RETURNING id", [tenant.rows[0].id]);
  return { tenantId: tenant.rows[0].id, userId: user.rows[0].id, organizationId: organization.rows[0].id };
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
