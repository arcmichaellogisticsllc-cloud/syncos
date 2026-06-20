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

  await expectStatus("unauthorized blocked", "GET", "/contacts", undefined, 401);
  await expectStatus("missing permission blocked", "GET", "/contacts", `Bearer ${limitedToken}`, 403);
  await expectStatus("cross-tenant contact blocked", "GET", `/contacts/${outside.contactId}`, `Bearer ${token}`, 404);

  await expectStatus("invalid contact role rejected", "POST", "/contacts", `Bearer ${token}`, 400, {
    organization_id: base.organizationId,
    full_name: "Invalid Role",
    contact_role: "made_up_role",
  });

  const createBefore = await counts(client);
  const contact = await expectStatus("create contact with approved role", "POST", "/contacts", `Bearer ${token}`, 201, {
    organization_id: base.organizationId,
    full_name: `Contact Smoke ${Date.now()}`,
    title: "Vendor Manager",
    department: "Construction",
    contact_role: "vendor_manager",
    email: "contact-smoke@example.test",
    mobile: "555-0100",
    territory_id: base.territoryId,
    influence_score: 76,
    decision_authority_score: 64,
    relationship_strength_score: 41,
    source: "relationship_source",
    source_confidence: 80,
    notes: "Jackson Telcom smoke contact for relationship pathing.",
  });
  await expectWriteDelta(client, createBefore, 1, 1, 1, 1, "contact create");
  if (contact.contact_role !== "vendor_manager") throw new Error("contact_role did not persist");

  await expectStatus("score outside range rejected", "PATCH", `/contacts/${contact.id}`, `Bearer ${token}`, 400, { influence_score: 101 });

  await expectStatus("verification requires method", "POST", `/contacts/${contact.id}/verify`, `Bearer ${token}`, 400, {});
  const verifyBefore = await counts(client);
  const verified = await expectStatus("verification metadata persists", "POST", `/contacts/${contact.id}/verify`, `Bearer ${token}`, 201, {
    verification_method: "email_validated",
    verification_source: "Jackson Telcom vendor file",
    verification_note: "Confirmed by email bounce-free validation.",
  });
  await expectWriteDelta(client, verifyBefore, 1, 1, 1, 1, "contact verify");
  if (verified.verification_status !== "verified" || verified.verification_method !== "email_validated" || !verified.verified_by || !verified.verified_at || !verified.last_verified_at) {
    throw new Error("verification metadata did not persist");
  }

  const ownerBefore = await counts(client);
  const assigned = await expectStatus("assign owner works", "POST", `/contacts/${contact.id}/assign-owner`, `Bearer ${token}`, 201, { owner_user_id: ownerUserId });
  await expectWriteDelta(client, ownerBefore, 1, 1, 1, 1, "contact owner assignment");
  if (assigned.relationship_owner_user_id !== ownerUserId) throw new Error("contact owner assignment did not persist");
  await expectStatus("owner assignment rejects cross tenant user", "POST", `/contacts/${contact.id}/assign-owner`, `Bearer ${token}`, 404, { owner_user_id: outside.userId });

  await client.query("INSERT INTO signals (id, tenant_id, title, source_name, status) VALUES (gen_random_uuid(), $1, 'Contact Smoke Signal', 'contact-smoke', 'verified') RETURNING id", [tenantId]).then(async (result) => {
    await client.query("INSERT INTO signal_entities (tenant_id, signal_id, entity_type, entity_id, linked_by) VALUES ($1, $2, 'contact', $3, $4)", [tenantId, result.rows[0].id, contact.id, userId]);
  });
  await client.query("INSERT INTO constraints (tenant_id, title, constraint_type, affected_object_type, affected_object_id, severity, status) VALUES ($1, 'Contact Smoke Constraint', 'relationship', 'contact', $2, 'medium', 'open')", [tenantId, contact.id]);

  const contactedBefore = await counts(client);
  const contacted = await expectStatus("mark contacted updates status", "POST", `/contacts/${contact.id}/mark-contacted`, `Bearer ${token}`, 201, {
    contact_date: new Date().toISOString(),
    interaction_type: "call",
    summary: "Confirmed vendor manager is reachable.",
    outcome: "connected",
  });
  await expectWriteDelta(client, contactedBefore, 1, 1, 1, 1, "contact contacted");
  if (contacted.status !== "contacted" || !contacted.last_contacted_at) throw new Error("mark contacted did not update status/date");

  const engaged = await expectStatus("mark engaged updates status", "POST", `/contacts/${contact.id}/mark-engaged`, `Bearer ${token}`, 201, {
    engagement_date: new Date().toISOString(),
    summary: "Discussed onboarding path.",
    outcome: "requested_follow_up",
  });
  if (engaged.status !== "engaged") throw new Error("mark engaged did not update status");

  const active = await expectStatus("mark relationship active updates status", "POST", `/contacts/${contact.id}/mark-relationship-active`, `Bearer ${token}`, 201, {
    reason: "active_vendor_discussion",
    recent_interaction_summary: "Shared onboarding documents and regional PM contact path.",
    relationship_strength_score: 72,
  });
  if (active.status !== "relationship_active" || active.relationship_strength_score !== 72) throw new Error("relationship active did not persist");

  const dormant = await expectStatus("mark dormant updates status", "POST", `/contacts/${contact.id}/mark-dormant`, `Bearer ${token}`, 201, { reason: "no current work path" });
  if (dormant.status !== "dormant") throw new Error("mark dormant did not persist");

  await expectStatus("mark invalid requires reason", "POST", `/contacts/${contact.id}/mark-invalid`, `Bearer ${token}`, 400, {});
  const invalid = await expectStatus("mark invalid persists reason", "POST", `/contacts/${contact.id}/mark-invalid`, `Bearer ${token}`, 201, {
    invalid_reason: "wrong_person",
    invalid_note: "Smoke validation invalid path.",
  });
  if (invalid.status !== "invalid" || invalid.verification_status !== "invalid" || invalid.invalid_reason !== "wrong_person") throw new Error("invalid metadata did not persist");

  const list = await expectStatus("enriched list filters", "GET", `/contacts?contact_role=vendor_manager&organization_id=${base.organizationId}&verification_status=invalid&relationship_owner_user_id=${ownerUserId}&influence_min=70&stale=false&sort=influence_desc`, `Bearer ${token}`, 200);
  const row = list.find((item) => item.id === contact.id);
  if (!row) throw new Error("enriched list did not return smoke contact");
  for (const field of ["organization_name", "relationship_owner_name", "related_signals_count", "completeness_score", "missing_contact_items", "recommended_next_action", "stale"]) {
    if (!(field in row)) throw new Error(`enriched contact row missing ${field}`);
  }

  const sorted = await expectStatus("decision sort works", "GET", "/contacts?sort=decision_authority_desc", `Bearer ${token}`, 200);
  if (!Array.isArray(sorted)) throw new Error("sorted contact list did not return array");

  const detail = await expectStatus("detail returns contract sections", "GET", `/contacts/${contact.id}/detail`, `Bearer ${token}`, 200);
  if (!detail.contact || !detail.organization_context || !detail.related_signals?.length || !detail.completeness || typeof detail.stale !== "boolean") {
    throw new Error("contact detail missing required sections");
  }

  const timeline = await expectStatus("timeline returns contact events", "GET", `/contacts/${contact.id}/timeline`, `Bearer ${token}`, 200);
  if (!timeline.some((event) => event.event_type === "contact.created")) throw new Error("timeline missing contact.created");

  await expectStatus("audit summary enforces permission", "GET", `/contacts/${contact.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
  const audit = await expectStatus("audit summary returns direct audits", "GET", `/contacts/${contact.id}/audit-summary`, `Bearer ${token}`, 200);
  if (!audit.some((row) => row.action === "contact.create")) throw new Error("audit summary missing contact.create");

  await expectStatus("archive requires reason", "POST", `/contacts/${contact.id}/archive`, `Bearer ${token}`, 400, {});
  const archiveBefore = await counts(client);
  const archived = await expectStatus("archive persists reason", "POST", `/contacts/${contact.id}/archive`, `Bearer ${token}`, 201, {
    archive_reason: "inactive",
    archive_note: "Smoke archive.",
  });
  await expectWriteDelta(client, archiveBefore, 1, 1, 1, 1, "contact archive");
  if (archived.status !== "archived" || archived.archive_reason !== "inactive" || !archived.archived_by || !archived.archived_at) {
    throw new Error("archive metadata did not persist");
  }

  await client.end();
  console.log("contact smoke passed");
}

async function createBase(client, tenantId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Contact Smoke Territory ${suffix}`, "CON"]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, organization_type, type, actor_roles, territory_id) VALUES ($1, $2, 'prime_contractor', 'prime_contractor', ARRAY['work_distributor']::text[], $3) RETURNING id", [tenantId, `Contact Smoke Prime ${suffix}`, territory.rows[0].id]);
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Contact User', 'x') RETURNING id", [`limited-contact-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOwnerUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Contact Owner User', 'x') RETURNING id", [`owner-contact-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Contact Tenant", `outside-contact-${suffix}`]);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outside Contact User', 'x') RETURNING id", [`outside-contact-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenant.rows[0].id, user.rows[0].id]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, organization_type, type) VALUES ($1, 'Outside Contact Organization', 'customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email) VALUES ($1, $2, 'Outside Contact', 'decision_maker', 'outside-contact@example.test') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  return { tenantId: tenant.rows[0].id, userId: user.rows[0].id, contactId: contact.rows[0].id };
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
