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

  await expectStatus("unauthorized blocked", "GET", "/signals", undefined, 401);
  await expectStatus("missing permission blocked", "GET", "/signals", `Bearer ${limitedToken}`, 403);

  const base = await createBase(client, tenantId);
  const outsideSignalId = await createOutsideSignal(client);
  await expectStatus("cross-tenant signal access blocked", "GET", `/signals/${outsideSignalId}`, `Bearer ${token}`, 404);

  const before = await counts(client);
  const signal = await expectStatus("create signal with metadata", "POST", "/signals", `Bearer ${token}`, 201, {
    title: `Intelligence Signal ${Date.now()}`,
    description: "Jackson Telcom broadband funding notice for fiber construction.",
    signal_category: "funding",
    signal_type: "broadband_funding",
    source_name: "State Broadband Office",
    source_type: "government_source",
    source_url: "https://example.test/funding",
    source_note: "Published funding round.",
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    date_discovered: "2026-06-19",
    estimated_value: 125000,
    estimated_scope: "Fiber backbone and drops",
    work_type: "fiber",
    confidence_score: 82,
    trust_level: "medium",
  });
  await expectWriteDelta(client, before, 1, 1, 1, 1, "signal create");

  const feed = await expectStatus("enriched feed returns signal", "GET", `/signals?q=${encodeURIComponent("Intelligence Signal")}&has_organization=true&trust_level=medium&confidence_min=80`, `Bearer ${token}`, 200);
  const feedRow = feed.find((row) => row.id === signal.id);
  if (!feedRow) throw new Error("enriched feed did not return created signal");
  for (const field of ["primary_organization_name", "primary_territory_name", "active_evidence_count", "candidate_ready", "converted", "recommended_next_action", "owner_name"]) {
    if (!(field in feedRow)) throw new Error(`enriched feed missing ${field}`);
  }

  const ownerAssigned = await expectStatus("assign owner works", "POST", `/signals/${signal.id}/assign-owner`, `Bearer ${token}`, 201, {
    owner_user_id: userId,
  });
  if (ownerAssigned.owner_user_id !== userId) throw new Error("owner assignment did not persist owner_user_id");

  await expectStatus("verify blocked without active evidence", "POST", `/signals/${signal.id}/verify`, `Bearer ${token}`, 400, {});

  const evidence = await expectStatus("create evidence", "POST", `/signals/${signal.id}/evidence`, `Bearer ${token}`, 201, {
    evidence_type: "funding_notice",
    summary: "Published state funding notice",
    description: "Funding award list includes target market.",
    source_url: "https://example.test/funding",
    trust_level: "high",
  });
  if (evidence.trust_level !== "high") throw new Error("evidence trust level was not persisted");

  const contactLink = await expectStatus("attach contact", "POST", `/signals/${signal.id}/entities`, `Bearer ${token}`, 201, {
    entity_type: "contact",
    entity_id: base.contactId,
  });
  if (contactLink.entity_type !== "contact") throw new Error("contact link was not created");

  const entities = await expectStatus("entities grouped", "GET", `/signals/${signal.id}/entities`, `Bearer ${token}`, 200);
  if (!entities.organizations?.length || !entities.territories?.length || !entities.contacts?.length) {
    throw new Error("signal entities endpoint did not return grouped links");
  }

  await expectStatus("filters has evidence", "GET", `/signals?has_evidence=true&organization_id=${base.organizationId}&converted=false`, `Bearer ${token}`, 200);
  const verified = await expectStatus("verify succeeds with active evidence", "POST", `/signals/${signal.id}/verify`, `Bearer ${token}`, 201, {});
  if (verified.status !== "verified") throw new Error("verify did not set status verified");

  const readiness = await expectStatus("readiness true", "GET", `/signals/${signal.id}/readiness`, `Bearer ${token}`, 200);
  if (!readiness.candidate_ready) throw new Error(`candidate readiness should be true: ${JSON.stringify(readiness)}`);

  const incomplete = await expectStatus("create incomplete signal", "POST", "/signals", `Bearer ${token}`, 201, {
    title: `Incomplete Signal ${Date.now()}`,
    source_name: "Manual",
    source_type: "manual_entry",
  });
  const incompleteReadiness = await expectStatus("readiness false", "GET", `/signals/${incomplete.id}/readiness`, `Bearer ${token}`, 200);
  if (incompleteReadiness.candidate_ready) throw new Error("incomplete signal should not be candidate ready");

  await expectStatus("archive requires reason", "POST", `/signals/${incomplete.id}/archive`, `Bearer ${token}`, 400, {});
  const archived = await expectStatus("archive persists reason", "POST", `/signals/${incomplete.id}/archive`, `Bearer ${token}`, 201, {
    archive_reason: "stale",
    archive_note: "No longer relevant.",
  });
  if (archived.archive_reason !== "stale" || archived.status !== "archived") throw new Error("archive reason/status did not persist");

  const candidate = await expectStatus("create candidate from signal", "POST", `/signals/${signal.id}/create-candidate`, `Bearer ${token}`, 201, {
    candidate_name: "Jackson Telcom Fiber Funding Candidate",
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "fiber",
    evidence_summary: "Verified funding notice with local organization and territory.",
    contribution_score: 82,
  });
  if (!candidate.candidate?.id || !candidate.candidate_signal?.id) throw new Error("candidate route did not return candidate and candidate_signal");

  const detail = await expectStatus("detail returns enriched sections", "GET", `/signals/${signal.id}/detail`, `Bearer ${token}`, 200);
  if (!detail.evidence?.length || !detail.entities?.contacts?.length || !detail.readiness?.candidate_ready || !detail.candidates?.length) {
    throw new Error("detail endpoint missing evidence/entities/readiness/candidates");
  }

  const convertedFeed = await expectStatus("converted flag true", "GET", `/signals?converted=true&q=${encodeURIComponent("Intelligence Signal")}`, `Bearer ${token}`, 200);
  if (!convertedFeed.some((row) => row.id === signal.id && row.converted === true)) throw new Error("converted feed did not return linked signal");

  const timeline = await expectStatus("timeline returns events", "GET", `/signals/${signal.id}/timeline`, `Bearer ${token}`, 200);
  if (!timeline.some((row) => row.event_type === "signal.created")) throw new Error("timeline missing signal.created");

  await expectStatus("audit summary enforces authorization", "GET", `/signals/${signal.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
  const audit = await expectStatus("audit summary returns rows", "GET", `/signals/${signal.id}/audit-summary`, `Bearer ${token}`, 200);
  if (!audit.some((row) => row.action === "signal.create")) throw new Error("audit summary missing signal.create");

  await client.end();
  console.log("intelligence smoke passed");
}

async function createBase(client, tenantId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Intel Territory ${suffix}`, "INT"]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, actor_roles, source_name) VALUES ($1, $2, $3, 'carrier', $4, 'intelligence-smoke') RETURNING id", [tenantId, territory.rows[0].id, `Intel Organization ${suffix}`, ["owner"]]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, email) VALUES ($1, $2, $3, $4) RETURNING id", [tenantId, organization.rows[0].id, "Intel Contact", `intel-${suffix}@example.test`]);
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, contactId: contact.rows[0].id };
}

async function createOutsideSignal(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Intel Tenant", `outside-intel-${suffix}`]);
  const signal = await client.query("INSERT INTO signals (tenant_id, title, source_name) VALUES ($1, 'Outside Intelligence Signal', 'outside') RETURNING id", [tenant.rows[0].id]);
  return signal.rows[0].id;
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Intelligence User', 'x') RETURNING id", [`limited-intel-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
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
