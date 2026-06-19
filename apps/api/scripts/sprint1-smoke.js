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

  await expectStatus("unauthorized territory create blocked", "POST", "/territories", undefined, 401, { name: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});

  const outside = await createOutsideTenantData(client, userId);

  const before = await counts(client);
  const territory = await expectStatus("create territory", "POST", "/territories", `Bearer ${token}`, 201, {
    name: `Sprint 1 Territory ${Date.now()}`,
    code: "S1",
  });
  await expectDelta(client, before, 1, 1, "territory create event/audit");
  await expectStatus("cross-tenant territory blocked", "GET", `/territories/${outside.territoryId}`, `Bearer ${token}`, 404);

  const orgBefore = await counts(client);
  const organization = await expectStatus("create organization", "POST", "/organizations", `Bearer ${token}`, 201, {
    name: `Sprint 1 Organization ${Date.now()}`,
    type: "carrier",
    actor_roles: ["owner"],
    territory_id: territory.id,
    source_name: "sprint1-smoke",
  });
  await expectDelta(client, orgBefore, 1, 1, "organization create event/audit");
  await expectStatus("cross-tenant organization blocked", "GET", `/organizations/${outside.organizationId}`, `Bearer ${token}`, 404);

  const qualifyBefore = await counts(client);
  const qualified = await expectStatus("qualify organization", "POST", `/organizations/${organization.id}/qualify`, `Bearer ${token}`, 201, {});
  if (qualified.status !== "qualified") throw new Error("organization qualify did not set status qualified");
  await expectDelta(client, qualifyBefore, 1, 1, "organization qualify event/audit");

  const contact = await expectStatus("create contact", "POST", "/contacts", `Bearer ${token}`, 201, {
    organization_id: organization.id,
    full_name: "Sprint One Contact",
    email: "sprint1-contact@example.com",
  });
  await expectStatus("cross-tenant contact blocked", "GET", `/contacts/${outside.contactId}`, `Bearer ${token}`, 404);
  await expectStatus("create contact under other tenant organization fails", "POST", "/contacts", `Bearer ${token}`, 404, {
    organization_id: outside.organizationId,
    full_name: "Bad Tenant Contact",
  });
  const noMethodContact = await expectStatus("create no-method contact", "POST", "/contacts", `Bearer ${token}`, 201, {
    organization_id: organization.id,
    full_name: "No Method Contact",
  });
  await expectStatus("verify contact requires method", "POST", `/contacts/${noMethodContact.id}/verify`, `Bearer ${token}`, 400, {});
  const verifiedContact = await expectStatus("verify contact", "POST", `/contacts/${contact.id}/verify`, `Bearer ${token}`, 201, {});
  if (verifiedContact.status !== "verified") throw new Error("contact verify did not set status verified");

  const signalBefore = await counts(client);
  const signal = await expectStatus("create signal", "POST", "/signals", `Bearer ${token}`, 201, {
    title: `Sprint 1 Signal ${Date.now()}`,
    source_name: "sprint1-smoke",
    organization_id: organization.id,
    territory_id: territory.id,
  });
  await expectDelta(client, signalBefore, 1, 1, "signal create event/audit");
  await expectStatus("cross-tenant signal blocked", "GET", `/signals/${outside.signalId}`, `Bearer ${token}`, 404);
  await expectStatus("categorize signal requires fields", "POST", `/signals/${signal.id}/categorize`, `Bearer ${token}`, 400, {
    signal_category: "network",
  });
  const categorized = await expectStatus("categorize signal", "POST", `/signals/${signal.id}/categorize`, `Bearer ${token}`, 201, {
    signal_category: "network_build",
    signal_type: "permit_activity",
  });
  if (categorized.status !== "categorized") throw new Error("signal categorize did not set status categorized");
  await expectStatus("score signal range enforced", "POST", `/signals/${signal.id}/score`, `Bearer ${token}`, 400, {
    confidence_score: 101,
  });
  const scored = await expectStatus("score signal", "POST", `/signals/${signal.id}/score`, `Bearer ${token}`, 201, {
    confidence_score: 88,
  });
  if (scored.status !== "scored") throw new Error("signal score did not set status scored");
  await expectStatus("verify signal requires evidence or verifier input", "POST", `/signals/${signal.id}/verify`, `Bearer ${token}`, 400, {});
  await expectStatus("signal evidence must match tenant signal", "POST", `/signals/${outside.signalId}/evidence`, `Bearer ${token}`, 404, {
    evidence_type: "source",
    description: "Should fail",
  });
  const evidence = await expectStatus("create signal evidence", "POST", `/signals/${signal.id}/evidence`, `Bearer ${token}`, 201, {
    evidence_type: "source",
    description: "Public notice from source",
    source_url: "https://example.test/source",
  });
  const verifiedSignal = await expectStatus("verify signal", "POST", `/signals/${signal.id}/verify`, `Bearer ${token}`, 201, {});
  if (verifiedSignal.status !== "verified") throw new Error("signal verify did not set status verified");
  await expectStatus("archive evidence", "POST", `/signal-evidence/${evidence.id}/archive`, `Bearer ${token}`, 201, {});

  const results = await expectStatus("tenant-scoped search", "GET", `/search?q=${encodeURIComponent("Sprint 1")}`, `Bearer ${token}`, 200);
  if (!Array.isArray(results) || !results.some((row) => row.object_type === "organization" && row.id === organization.id)) {
    throw new Error("search did not return same-tenant organization");
  }
  if (results.some((row) => row.id === outside.organizationId || row.id === outside.signalId || row.id === outside.territoryId || row.id === outside.contactId)) {
    throw new Error("search returned cross-tenant result");
  }

  await client.end();
  console.log("sprint1 smoke passed");
}

async function createOutsideTenantData(client, userId) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [
    "Sprint 1 Outside Tenant",
    `sprint1-outside-${suffix}`,
  ]);
  const tenantId = tenant.rows[0].id;
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantId, "Outside Territory"]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'carrier') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    "Outside Organization",
  ]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name) VALUES ($1, $2, 'Outside Contact') RETURNING id", [
    tenantId,
    organization.rows[0].id,
  ]);
  const signal = await client.query("INSERT INTO signals (tenant_id, title, source_name) VALUES ($1, 'Outside Signal', 'outside') RETURNING id", [tenantId]);
  await client.query("INSERT INTO test_objects (tenant_id, name, created_by_user_id) VALUES ($1, 'outside helper', $2)", [tenantId, userId]);
  return {
    territoryId: territory.rows[0].id,
    organizationId: organization.rows[0].id,
    contactId: contact.rows[0].id,
    signalId: signal.rows[0].id,
  };
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs
  `);
  return result.rows[0];
}

async function expectDelta(client, before, events, auditLogs, label) {
  const after = await counts(client);
  if (after.events !== before.events + events) throw new Error(`${label}: expected ${events} event delta`);
  if (after.audit_logs !== before.audit_logs + auditLogs) throw new Error(`${label}: expected ${auditLogs} audit delta`);
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
