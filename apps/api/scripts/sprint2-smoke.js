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

  await expectStatus("unauthorized relationship map create blocked", "POST", "/relationship-maps", undefined, 401, {
    name: "Denied",
  });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});

  const base = await createBaseTenantData(client, tenantId);
  const outside = await createOutsideTenantData(client, userId);

  const mapBefore = await counts(client);
  const map = await expectStatus("create relationship map", "POST", "/relationship-maps", `Bearer ${token}`, 201, {
    name: `Sprint 2 Relationship Map ${Date.now()}`,
    target_organization_id: base.organizationId,
    target_contact_id: base.contactId,
    status: "weak_path",
  });
  await expectDelta(client, mapBefore, 1, 1, "relationship map create event/audit");
  await expectStatus("cross-tenant relationship map blocked", "GET", `/relationship-maps/${outside.mapId}`, `Bearer ${token}`, 404);
  await expectStatus("invalid target organization tenant blocked", "POST", "/relationship-maps", `Bearer ${token}`, 404, {
    name: "Bad tenant map",
    target_organization_id: outside.organizationId,
  });

  const pathBefore = await counts(client);
  const path = await expectStatus("create relationship path", "POST", `/relationship-maps/${map.id}/paths`, `Bearer ${token}`, 201, {
    from_contact_id: base.contactId,
    to_contact_id: base.secondContactId,
    intermediary_contact_ids: [base.secondContactId],
    strength_score: 70,
    confidence_score: 80,
    rank: 1,
  });
  await expectDelta(client, pathBefore, 1, 1, "relationship path create event/audit");
  await expectStatus("cross-tenant relationship path blocked", "PATCH", `/relationship-paths/${outside.pathId}`, `Bearer ${token}`, 404, {
    rank: 2,
  });
  await expectStatus("path same-tenant contact enforcement works", "POST", `/relationship-maps/${map.id}/paths`, `Bearer ${token}`, 404, {
    from_contact_id: outside.contactId,
    strength_score: 40,
  });
  await expectStatus("relationship path score validation works", "POST", `/relationship-maps/${map.id}/paths`, `Bearer ${token}`, 400, {
    strength_score: 101,
  });

  const candidateBefore = await counts(client);
  const lowCandidate = await expectStatus("create opportunity candidate", "POST", "/opportunity-candidates", `Bearer ${token}`, 201, {
    name: `Sprint 2 Candidate Low ${Date.now()}`,
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "fiber_build",
    confidence_score: 45,
    relationship_access_score: 50,
    strategic_fit_score: 60,
    capacity_fit_score: 60,
    risk_score: 30,
    evidence_summary: "Smoke evidence",
  });
  await expectDelta(client, candidateBefore, 1, 1, "candidate create event/audit");
  await expectStatus("cross-tenant opportunity candidate blocked", "GET", `/opportunity-candidates/${outside.candidateId}`, `Bearer ${token}`, 404);
  await expectStatus("candidate requires same-tenant organization", "POST", "/opportunity-candidates", `Bearer ${token}`, 404, {
    name: "Bad tenant candidate",
    organization_id: outside.organizationId,
    territory_id: base.territoryId,
  });
  await expectStatus("candidate signal requires same-tenant signal", "POST", `/opportunity-candidates/${lowCandidate.id}/signals`, `Bearer ${token}`, 404, {
    signal_id: outside.signalId,
    contribution_score: 50,
  });
  const archivedSignal = await createSignal(client, tenantId, "Archived Candidate Signal", "archived");
  await expectStatus("archived signal cannot be linked", "POST", `/opportunity-candidates/${lowCandidate.id}/signals`, `Bearer ${token}`, 400, {
    signal_id: archivedSignal,
    contribution_score: 50,
  });
  await expectStatus("qualify candidate blocked below score 60", "POST", `/opportunity-candidates/${lowCandidate.id}/qualify`, `Bearer ${token}`, 400, {});

  const highCandidate = await expectStatus("create high opportunity candidate", "POST", "/opportunity-candidates", `Bearer ${token}`, 201, {
    name: `Sprint 2 Candidate High ${Date.now()}`,
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "fiber_build",
    relationship_access_score: 80,
    strategic_fit_score: 90,
    capacity_fit_score: 70,
    risk_score: 20,
  });
  const signal = await createSignal(client, tenantId, "Candidate Signal", "verified");
  const candidateSignal = await expectStatus("create candidate signal", "POST", `/opportunity-candidates/${highCandidate.id}/signals`, `Bearer ${token}`, 201, {
    signal_id: signal,
    contribution_score: 90,
  });

  const scoreBefore = await counts(client);
  const scored = await expectStatus("candidate scoring formula", "POST", `/opportunity-candidates/${highCandidate.id}/score`, `Bearer ${token}`, 201, {});
  await expectDelta(client, scoreBefore, 1, 1, "candidate score event/audit");
  if (Number(scored.score) !== 84 || scored.confidence_score !== 84) {
    throw new Error(`candidate score formula mismatch: got score=${scored.score}, confidence=${scored.confidence_score}`);
  }
  const summary = await expectStatus("candidate score summary", "GET", `/opportunity-candidates/${highCandidate.id}/score-summary`, `Bearer ${token}`, 200);
  if (summary.candidate_score !== 84) throw new Error("candidate score summary mismatch");
  const qualified = await expectStatus("qualify candidate succeeds", "POST", `/opportunity-candidates/${highCandidate.id}/qualify`, `Bearer ${token}`, 201, {});
  if (qualified.status !== "qualified_candidate") throw new Error("candidate qualify did not set status qualified_candidate");

  const results = await expectStatus("tenant-scoped candidate/map search", "GET", `/search?q=${encodeURIComponent("Sprint 2")}`, `Bearer ${token}`, 200);
  if (!Array.isArray(results) || !results.some((row) => row.object_type === "relationship_map" && row.id === map.id)) {
    throw new Error("search did not return same-tenant relationship map");
  }
  if (!results.some((row) => row.object_type === "opportunity_candidate" && row.id === highCandidate.id)) {
    throw new Error("search did not return same-tenant opportunity candidate");
  }
  if (results.some((row) => row.id === outside.mapId || row.id === outside.candidateId)) {
    throw new Error("search returned cross-tenant Sprint 2 result");
  }

  const opportunityCount = await client.query("SELECT count(*)::int AS count FROM opportunities");
  if (opportunityCount.rows[0].count !== 0) throw new Error("Sprint 2 smoke created an opportunity record");

  await expectStatus("archive candidate signal", "POST", `/candidate-signals/${candidateSignal.id}/archive`, `Bearer ${token}`, 201, {});
  await client.end();
  console.log("sprint2 smoke passed");
}

async function createBaseTenantData(client, tenantId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [
    tenantId,
    `Sprint 2 Territory ${suffix}`,
    `S2-${suffix}`,
  ]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'carrier') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Sprint 2 Organization ${suffix}`,
  ]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, email) VALUES ($1, $2, $3, $4) RETURNING id", [
    tenantId,
    organization.rows[0].id,
    "Sprint 2 Contact",
    "sprint2-contact@example.test",
  ]);
  const secondContact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, email) VALUES ($1, $2, $3, $4) RETURNING id", [
    tenantId,
    organization.rows[0].id,
    "Sprint 2 Second Contact",
    "sprint2-second@example.test",
  ]);
  return {
    territoryId: territory.rows[0].id,
    organizationId: organization.rows[0].id,
    contactId: contact.rows[0].id,
    secondContactId: secondContact.rows[0].id,
  };
}

async function createOutsideTenantData(client, userId) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [
    "Sprint 2 Outside Tenant",
    `sprint2-outside-${suffix}`,
  ]);
  const tenantId = tenant.rows[0].id;
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, 'Outside Territory') RETURNING id", [tenantId]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, 'Outside Organization', 'carrier') RETURNING id", [
    tenantId,
    territory.rows[0].id,
  ]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name) VALUES ($1, $2, 'Outside Contact') RETURNING id", [
    tenantId,
    organization.rows[0].id,
  ]);
  const signal = await createSignal(client, tenantId, "Outside Signal", "verified");
  const map = await client.query("INSERT INTO relationship_maps (tenant_id, name, target_organization_id) VALUES ($1, 'Outside Map', $2) RETURNING id", [
    tenantId,
    organization.rows[0].id,
  ]);
  const path = await client.query("INSERT INTO relationship_paths (tenant_id, relationship_map_id, from_contact_id) VALUES ($1, $2, $3) RETURNING id", [
    tenantId,
    map.rows[0].id,
    contact.rows[0].id,
  ]);
  const candidate = await client.query(
    "INSERT INTO opportunity_candidates (tenant_id, organization_id, territory_id, title, name) VALUES ($1, $2, $3, 'Outside Candidate', 'Outside Candidate') RETURNING id",
    [tenantId, organization.rows[0].id, territory.rows[0].id],
  );
  await client.query("INSERT INTO test_objects (tenant_id, name, created_by_user_id) VALUES ($1, 'outside sprint2 helper', $2)", [tenantId, userId]);
  return {
    organizationId: organization.rows[0].id,
    contactId: contact.rows[0].id,
    signalId: signal,
    mapId: map.rows[0].id,
    pathId: path.rows[0].id,
    candidateId: candidate.rows[0].id,
  };
}

async function createSignal(client, tenantId, title, status) {
  const result = await client.query(
    "INSERT INTO signals (tenant_id, title, source_name, status) VALUES ($1, $2, 'sprint2-smoke', $3) RETURNING id",
    [tenantId, title, status],
  );
  return result.rows[0].id;
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
