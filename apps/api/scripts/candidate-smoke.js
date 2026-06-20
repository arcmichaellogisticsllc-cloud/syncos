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
  const base = await createBase(client, tenantId, ownerUserId);

  await expectStatus("unauthorized blocked", "GET", "/opportunity-candidates", undefined, 401);
  await expectStatus("missing permission blocked", "GET", "/opportunity-candidates", `Bearer ${limitedToken}`, 403);
  await expectStatus("cross-tenant candidate access blocked", "GET", `/opportunity-candidates/${outside.candidateId}`, `Bearer ${token}`, 404);

  await expectStatus("negative estimated_value rejected", "POST", "/opportunity-candidates", `Bearer ${token}`, 400, {
    name: "Invalid Candidate",
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "fiber",
    estimated_value: -1,
  });
  await expectStatus("invalid work_type rejected", "POST", "/opportunity-candidates", `Bearer ${token}`, 400, {
    name: "Invalid Work Candidate",
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "subsea_cable",
  });

  const createBefore = await counts(client);
  const candidate = await expectStatus("create candidate with estimated_value works", "POST", "/opportunity-candidates", `Bearer ${token}`, 201, {
    name: `Candidate Smoke ${Date.now()}`,
    summary: "Possible telecom work from signal intelligence.",
    source_type: "manual_entry",
    source_note: "Smoke source note.",
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "fiber",
    estimated_value: 125000.75,
    confidence_score: 72,
    candidate_score: 64,
    owner_user_id: ownerUserId,
  });
  await expectWriteDelta(client, createBefore, 1, 1, 1, 1, "candidate create");
  if (Number(candidate.estimated_value) !== 125000.75 || candidate.normalized_status !== "created") throw new Error("candidate create did not return enriched metadata");

  const ownerBefore = await counts(client);
  const assigned = await expectStatus("owner assignment works", "POST", `/opportunity-candidates/${candidate.id}/assign-owner`, `Bearer ${token}`, 201, { owner_user_id: ownerUserId });
  await expectWriteDelta(client, ownerBefore, 1, 1, 1, 1, "candidate owner assignment");
  if (assigned.owner_user_id !== ownerUserId) throw new Error("candidate owner assignment did not persist");
  await expectStatus("owner assignment rejects cross-tenant user", "POST", `/opportunity-candidates/${candidate.id}/assign-owner`, `Bearer ${token}`, 404, { owner_user_id: outside.userId });

  await expectStatus("relationship map link rejects cross-tenant map", "POST", `/opportunity-candidates/${candidate.id}/link-relationship-map`, `Bearer ${token}`, 404, { relationship_map_id: outside.relationshipMapId });
  const linked = await expectStatus("relationship map link works", "POST", `/opportunity-candidates/${candidate.id}/link-relationship-map`, `Bearer ${token}`, 201, { relationship_map_id: base.relationshipMapId });
  if (linked.relationship_map_id !== base.relationshipMapId || Number(linked.relationship_access_score) !== 80) throw new Error("relationship map link did not persist access score");

  const signalLinkBefore = await counts(client);
  const candidateSignal = await expectStatus("attach signal works", "POST", `/opportunity-candidates/${candidate.id}/signals`, `Bearer ${token}`, 201, {
    signal_id: base.signalId,
    contribution_score: 88,
    contribution_note: "Signal supports the candidate.",
  });
  await expectWriteDelta(client, signalLinkBefore, 1, 1, 1, 1, "candidate signal create");
  await expectStatus("duplicate active signal link rejected", "POST", `/opportunity-candidates/${candidate.id}/signals`, `Bearer ${token}`, 400, {
    signal_id: base.signalId,
    contribution_score: 50,
  });

  const incomplete = await expectStatus("candidate readiness false when missing required items", "POST", "/opportunity-candidates", `Bearer ${token}`, 201, {
    name: `Incomplete Candidate ${Date.now()}`,
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "fiber",
  });
  if (incomplete.candidate_ready_for_opportunity) throw new Error("incomplete candidate should not be ready");

  await expectStatus("monitor sets monitored metadata", "POST", `/opportunity-candidates/${candidate.id}/monitor`, `Bearer ${token}`, 201, { reason: "Watch for more signals." });
  const investigated = await expectStatus("investigate sets investigated metadata", "POST", `/opportunity-candidates/${candidate.id}/investigate`, `Bearer ${token}`, 201, { reason: "Gather relationship access." });
  if (investigated.normalized_status !== "investigating" || !investigated.investigated_by || !investigated.investigated_at) throw new Error("investigate metadata did not persist");

  const qualified = await expectStatus("qualify sets qualified metadata", "POST", `/opportunity-candidates/${candidate.id}/qualify`, `Bearer ${token}`, 201, {});
  if (qualified.normalized_status !== "qualified" || !qualified.qualified_by || !qualified.qualified_at || !qualified.candidate_ready_for_opportunity) {
    throw new Error("qualify metadata/readiness did not persist");
  }

  const list = await expectStatus("candidate list returns enriched fields", "GET", `/opportunity-candidates?normalized_status=qualified&organization_id=${base.organizationId}&territory_id=${base.territoryId}&work_type=fiber&has_signals=true&has_relationship_map=true&ready_for_opportunity=true&archived=false`, `Bearer ${token}`, 200);
  if (!list.some((row) => row.id === candidate.id && row.normalized_status === "qualified")) throw new Error("enriched candidate list filters did not return qualified candidate");

  await expectStatus("reject requires valid rejection_reason", "POST", `/opportunity-candidates/${candidate.id}/reject`, `Bearer ${token}`, 400, {});
  const rejected = await expectStatus("reject persists reason", "POST", `/opportunity-candidates/${candidate.id}/reject`, `Bearer ${token}`, 201, { rejection_reason: "insufficient_evidence", rejection_note: "Smoke reject." });
  if (rejected.status !== "rejected" || rejected.rejection_reason !== "insufficient_evidence" || !rejected.rejected_by) throw new Error("reject metadata did not persist");

  await expectStatus("archive requires valid archive_reason", "POST", `/opportunity-candidates/${candidate.id}/archive`, `Bearer ${token}`, 400, {});
  const archived = await expectStatus("archive persists reason", "POST", `/opportunity-candidates/${candidate.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "rejected_cleanup", archive_note: "Smoke archive." });
  if (archived.status !== "archived" || archived.archive_reason !== "rejected_cleanup" || !archived.archived_by || !archived.archived_at) throw new Error("archive metadata did not persist");

  const archivedList = await expectStatus("archived filter works", "GET", "/opportunity-candidates?archived=true", `Bearer ${token}`, 200);
  if (!archivedList.some((row) => row.id === candidate.id && row.archive_reason === "rejected_cleanup")) throw new Error("archived candidate not returned with archive metadata");

  for (const sort of ["candidate_score_desc", "confidence_desc", "estimated_value_desc", "relationship_access_desc", "updated_desc"]) {
    const sorted = await expectStatus(`${sort} sorting works`, "GET", `/opportunity-candidates?sort=${sort}&archived=true`, `Bearer ${token}`, 200);
    if (!Array.isArray(sorted)) throw new Error(`${sort} did not return an array`);
  }

  const detail = await expectStatus("candidate detail returns organization/signals/relationship/readiness", "GET", `/opportunity-candidates/${candidate.id}/detail`, `Bearer ${token}`, 200);
  if (!detail.candidate || !detail.organization_context || !detail.attached_signals?.length || !detail.relationship_map_context || !detail.readiness) {
    throw new Error("candidate detail missing required sections");
  }

  const timeline = await expectStatus("timeline endpoint returns candidate and candidate_signal events", "GET", `/opportunity-candidates/${candidate.id}/timeline`, `Bearer ${token}`, 200);
  if (!timeline.some((event) => event.event_type === "opportunity_candidate.created")) throw new Error("timeline missing opportunity_candidate.created");
  if (!timeline.some((event) => event.event_type === "candidate_signal.created")) throw new Error("timeline missing candidate_signal.created");

  await expectStatus("audit summary enforces permission", "GET", `/opportunity-candidates/${candidate.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
  const audit = await expectStatus("audit summary returns candidate and signal audits", "GET", `/opportunity-candidates/${candidate.id}/audit-summary`, `Bearer ${token}`, 200);
  if (!audit.some((row) => row.action === "opportunity_candidate.create")) throw new Error("audit summary missing opportunity_candidate.create");
  if (!audit.some((row) => row.action === "candidate_signal.create")) throw new Error("audit summary missing candidate_signal.create");

  await expectStatus("archive signal requires reason", "POST", `/candidate-signals/${candidateSignal.id}/archive`, `Bearer ${token}`, 400, {});
  const archivedSignal = await expectStatus("archive signal persists reason", "POST", `/candidate-signals/${candidateSignal.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "candidate_rejected" });
  if (archivedSignal.status !== "archived" || archivedSignal.archive_reason !== "candidate_rejected") throw new Error("candidate signal archive metadata did not persist");

  await client.end();
  console.log("candidate smoke passed");
}

async function createBase(client, tenantId, ownerUserId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Candidate Territory ${suffix}`, "CAN"]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type, actor_roles, work_relevance_score) VALUES ($1, $2, $3, 'prime_contractor', 'prime_contractor', ARRAY['work_distributor']::text[], 82) RETURNING id", [tenantId, territory.rows[0].id, `Candidate Organization ${suffix}`]);
  const target = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email, influence_score, decision_authority_score, relationship_strength_score) VALUES ($1, $2, 'Candidate Target Contact', 'vendor_manager', $3, 82, 80, 70) RETURNING id", [tenantId, organization.rows[0].id, `candidate-target-${suffix}@example.test`]);
  const bridge = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email) VALUES ($1, $2, 'Candidate Bridge Contact', 'relationship_bridge', $3) RETURNING id", [tenantId, organization.rows[0].id, `candidate-bridge-${suffix}@example.test`]);
  const signal = await client.query("INSERT INTO signals (tenant_id, title, source_name, status, confidence_score, trust_level, date_discovered) VALUES ($1, $2, 'candidate-smoke', 'verified', 85, 'verified', now()) RETURNING id", [tenantId, `Candidate Signal ${suffix}`]);
  const map = await client.query("INSERT INTO relationship_maps (tenant_id, name, map_type, objective, owner_user_id, target_organization_id, target_contact_id, status, access_score, relationship_gap_summary, recommended_next_action) VALUES ($1, $2, 'opportunity_access', 'Build access for candidate smoke.', $3, $4, $5, 'relationship_active', 80, '[]'::jsonb, 'maintain_relationship') RETURNING id", [tenantId, `Candidate Relationship Map ${suffix}`, ownerUserId, organization.rows[0].id, target.rows[0].id]);
  await client.query("INSERT INTO relationship_paths (tenant_id, relationship_map_id, path_name, from_contact_id, to_contact_id, intermediary_contact_ids, strength_score, confidence_score, rank, status) VALUES ($1, $2, 'Candidate access path', $3, $4, ARRAY[$5]::uuid[], 82, 78, 1, 'active')", [tenantId, map.rows[0].id, bridge.rows[0].id, target.rows[0].id, bridge.rows[0].id]);
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, targetContactId: target.rows[0].id, bridgeContactId: bridge.rows[0].id, signalId: signal.rows[0].id, relationshipMapId: map.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Candidate User', 'x') RETURNING id", [`limited-candidate-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOwnerUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Candidate Owner User', 'x') RETURNING id", [`owner-candidate-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Candidate Tenant", `outside-candidate-${suffix}`]);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outside Candidate User', 'x') RETURNING id", [`outside-candidate-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenant.rows[0].id, user.rows[0].id]);
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, 'Outside Candidate Territory', 'OUT') RETURNING id", [tenant.rows[0].id]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, organization_type, type) VALUES ($1, $2, 'Outside Candidate Organization', 'prime_contractor', 'prime_contractor') RETURNING id", [tenant.rows[0].id, territory.rows[0].id]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email) VALUES ($1, $2, 'Outside Candidate Contact', 'vendor_manager', 'outside-candidate@example.test') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const map = await client.query("INSERT INTO relationship_maps (tenant_id, name, map_type, objective, target_organization_id, target_contact_id, access_score) VALUES ($1, 'Outside Candidate Relationship Map', 'opportunity_access', 'Outside map.', $2, $3, 80) RETURNING id", [tenant.rows[0].id, organization.rows[0].id, contact.rows[0].id]);
  const candidate = await client.query("INSERT INTO opportunity_candidates (tenant_id, title, name, organization_id, territory_id, work_type) VALUES ($1, 'Outside Candidate', 'Outside Candidate', $2, $3, 'fiber') RETURNING id", [tenant.rows[0].id, organization.rows[0].id, territory.rows[0].id]);
  return { tenantId: tenant.rows[0].id, userId: user.rows[0].id, relationshipMapId: map.rows[0].id, candidateId: candidate.rows[0].id };
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
