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
    WHERE u.email = 'admin@synccommsystems.local'
      AND t.slug = 'sync-comm-systems'
    LIMIT 1
  `);
  if (!seeded.rows[0]) throw new Error("Seeded Sync Comm Systems admin user was not found");

  const { user_id: userId, tenant_id: tenantId } = seeded.rows[0];
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const limitedUserId = await createLimitedUser(client, tenantId);
  const limitedToken = createToken({ sub: limitedUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const ownerUserId = await createOwnerUser(client, tenantId);
  const outside = await createOutsideTenant(client);
  const base = await createBase(client, tenantId);

  await expectStatus("unauthorized blocked", "GET", "/account-onboarding", undefined, 401);
  await expectStatus("missing permission blocked", "GET", "/account-onboarding", `Bearer ${limitedToken}`, 403);

  await expectStatus("invalid stage rejected", "POST", "/account-onboarding", `Bearer ${token}`, 400, {
    organization_id: base.organizationId,
    onboarding_stage: "made_up_stage",
  });
  await expectStatus("cross-tenant organization blocked", "POST", "/account-onboarding", `Bearer ${token}`, 404, {
    organization_id: outside.organizationId,
    lane: "prime",
  });

  const createBefore = await counts(client);
  const created = await expectStatus("create profile works", "POST", "/account-onboarding", `Bearer ${token}`, 201, {
    organization_id: base.organizationId,
    lane: "prime",
    onboarding_stage: "documents_requested",
    account_owner_user_id: ownerUserId,
    primary_contact_id: base.contactId,
    relationship_strength_score: 62,
    last_interaction_at: "2026-02-01T12:00:00Z",
    next_action: "Collect insurance certificate and rate sheet.",
    next_action_deadline: "2026-02-15",
    required_documents: ["vendor packet", "insurance certificate", "rate sheet"],
    missing_documents: ["insurance certificate", "rate sheet"],
    market_availability: ["Ohio", "Michigan"],
    customer_programs: ["Underground fiber"],
    rate_sheet_status: "requested",
    payment_terms_days: 45,
    approval_status: "submitted",
    probability_of_work: 66,
    notes: "Smoke account onboarding profile.",
  });
  await expectWriteDelta(client, createBefore, 1, 1, 1, 1, "account onboarding create");
  if (created.onboarding_stage !== "documents_requested" || created.organization_name !== base.organizationName) {
    throw new Error("created onboarding profile missing enriched fields");
  }
  if (!created.boundary?.includes("does not create contracts")) throw new Error("created onboarding profile missing boundary text");

  const list = await expectStatus("list filters work", "GET", "/account-onboarding?lane=prime&onboarding_stage=documents_requested&approval_status=submitted&sort=probability_desc", `Bearer ${token}`, 200);
  if (!list.some((row) => row.id === created.id)) throw new Error("filtered list did not include created profile");
  for (const field of ["stage_label", "lane_label", "account_owner_name", "contact_title", "market_summary", "required_document_count", "missing_document_count", "next_action_label"]) {
    if (!(field in list[0])) throw new Error(`account onboarding row missing ${field}`);
  }

  const updateBefore = await counts(client);
  const updated = await expectStatus("update profile works", "PATCH", `/account-onboarding/${created.id}`, `Bearer ${token}`, 200, {
    onboarding_stage: "rate_negotiation",
    rate_sheet_status: "in_review",
    approval_status: "in_review",
    missing_documents: [],
    probability_of_work: 72,
  });
  await expectWriteDelta(client, updateBefore, 1, 1, 1, 1, "account onboarding update");
  if (updated.onboarding_stage !== "rate_negotiation" || updated.probability_of_work !== 72) throw new Error("update did not persist onboarding fields");

  await expectStatus("read one works", "GET", `/account-onboarding/${created.id}`, `Bearer ${token}`, 200);

  const archiveBefore = await counts(client);
  const archived = await expectStatus("archive profile works", "POST", `/account-onboarding/${created.id}/archive`, `Bearer ${token}`, 201, {});
  await expectWriteDelta(client, archiveBefore, 1, 1, 1, 1, "account onboarding archive");
  if (archived.status !== "archived" || !archived.archived_at) throw new Error("archive metadata was not persisted");

  await client.end();
  console.log("account onboarding smoke passed");
}

async function createBase(client, tenantId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Account Onboarding Territory ${suffix}`, "AOB"]);
  const organizationName = `Account Onboarding Prime ${suffix}`;
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type, actor_roles, status) VALUES ($1, $2, $3, 'prime_contractor', 'prime_contractor', ARRAY['work_distributor']::text[], 'researched') RETURNING id", [tenantId, territory.rows[0].id, organizationName]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, title, email, status, verification_status) VALUES ($1, $2, 'Onboarding Contact', 'Vendor Manager', $3, 'engaged', 'verified') RETURNING id", [tenantId, organization.rows[0].id, `onboarding-${suffix}@example.test`]);
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, organizationName, contactId: contact.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Account Onboarding User', 'x') RETURNING id", [`limited-account-onboarding-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOwnerUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Account Onboarding Owner User', 'x') RETURNING id", [`owner-account-onboarding-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Account Onboarding Tenant", `outside-account-onboarding-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, 'Outside Account Onboarding Org', 'prime_contractor', 'prime_contractor') RETURNING id", [tenant.rows[0].id]);
  return { tenantId: tenant.rows[0].id, organizationId: organization.rows[0].id };
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
