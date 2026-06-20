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
  const base = await createBase(client, tenantId, ownerUserId);
  const outside = await createOutsideTenant(client);

  await expectStatus("unauthorized blocked", "GET", "/opportunities", undefined, 401);
  await expectStatus("missing permission blocked", "GET", "/opportunities", `Bearer ${limitedToken}`, 403);
  await expectStatus("cross-tenant opportunity access blocked", "GET", `/opportunities/${outside.opportunityId}`, `Bearer ${token}`, 404);

  await expectStatus("negative estimated_value rejected", "POST", "/opportunities", `Bearer ${token}`, 400, manualBody(base, ownerUserId, { estimated_value: -1 }));
  await expectStatus("invalid work_type rejected", "POST", "/opportunities", `Bearer ${token}`, 400, manualBody(base, ownerUserId, { work_type: "subsea_cable" }));
  await expectStatus("invalid status rejected", "POST", "/opportunities", `Bearer ${token}`, 400, manualBody(base, ownerUserId, { status: "pipeline_magic" }));

  const createBefore = await counts(client);
  const manual = await expectStatus("manual opportunity create works", "POST", "/opportunities", `Bearer ${token}`, 201, manualBody(base, ownerUserId, {
    relationship_access_score: 0,
    pursuit_score: 72,
  }));
  await expectWriteDelta(client, createBefore, 1, 1, 1, 1, "manual opportunity create");
  if (manual.normalized_status !== "draft" || !manual.warnings?.includes("missing_relationship_map")) throw new Error("manual opportunity did not return enriched draft warning state");

  const ownerBefore = await counts(client);
  const assigned = await expectStatus("owner assignment works", "POST", `/opportunities/${manual.id}/assign-owner`, `Bearer ${token}`, 201, { owner_user_id: ownerUserId });
  await expectWriteDelta(client, ownerBefore, 1, 1, 1, 1, "opportunity owner assignment");
  if (assigned.owner_user_id !== ownerUserId) throw new Error("owner assignment did not persist");
  await expectStatus("owner assignment rejects cross-tenant user", "POST", `/opportunities/${manual.id}/assign-owner`, `Bearer ${token}`, 404, { owner_user_id: outside.userId });

  await expectStatus("relationship map link rejects cross-tenant map", "POST", `/opportunities/${manual.id}/link-relationship-map`, `Bearer ${token}`, 404, { relationship_map_id: outside.relationshipMapId });
  const linked = await expectStatus("relationship map link works", "POST", `/opportunities/${manual.id}/link-relationship-map`, `Bearer ${token}`, 201, { relationship_map_id: base.relationshipMapId });
  if (linked.relationship_map_id !== base.relationshipMapId || Number(linked.relationship_access_score) !== 80) throw new Error("relationship map link did not persist access score");

  const weak = await expectStatus("weak relationship access does not block creation", "POST", "/opportunities", `Bearer ${token}`, 201, manualBody(base, ownerUserId, {
    opportunity_name: `Weak Relationship Opportunity ${Date.now()}`,
    relationship_access_score: 0,
    pursuit_score: 64,
  }));
  await expectStatus("submit for review works", "POST", `/opportunities/${weak.id}/submit-for-review`, `Bearer ${token}`, 201, { pursuit_review_reason: "Smoke review." });
  await expectStatus("pursuit approval with missing relationship access returns warning requiring override reason", "POST", `/opportunities/${weak.id}/pursuit-approve`, `Bearer ${token}`, 400, {});
  const approvedWeak = await expectStatus("pursuit approval succeeds with override reason", "POST", `/opportunities/${weak.id}/pursuit-approve`, `Bearer ${token}`, 201, {
    relationship_access_override_reason: "Relationship gap accepted with required action path.",
    capacity_override_reason: "Capacity planning warning accepted.",
    margin_override_reason: "Margin warning accepted.",
    pursuit_approval_override_reason: "Pursuit score warning accepted.",
  });
  if (approvedWeak.status !== "pursuit_approved" || !approvedWeak.relationship_access_override_reason) throw new Error("approval override did not persist");

  const missingCore = await client.query("INSERT INTO opportunities (tenant_id, title, status, stage, estimated_value) VALUES ($1, 'Missing Core Opportunity', 'draft', 'draft', 1) RETURNING id", [tenantId]);
  await expectStatus("pursuit approval still blocks missing core required fields", "POST", `/opportunities/${missingCore.rows[0].id}/pursuit-approve`, `Bearer ${token}`, 400, {
    relationship_access_override_reason: "override",
    capacity_override_reason: "override",
    margin_override_reason: "override",
    pursuit_approval_override_reason: "override",
  });

  const conversionBefore = await counts(client);
  const converted = await expectStatus("qualified candidate conversion works", "POST", `/opportunity-candidates/${base.candidateId}/convert-to-opportunity`, `Bearer ${token}`, 201, { opportunity_name: "Converted Smoke Opportunity" });
  await expectWriteDelta(client, conversionBefore, 2, 2, 2, 2, "candidate conversion");
  if (converted.source_candidate_id !== base.candidateId || converted.source_type !== "candidate_conversion") throw new Error("candidate conversion did not persist source linkage");
  await expectStatus("unqualified candidate conversion rejected", "POST", `/opportunity-candidates/${base.unqualifiedCandidateId}/convert-to-opportunity`, `Bearer ${token}`, 400, { opportunity_name: "Bad Conversion" });
  await expectStatus("duplicate candidate conversion rejected unless override reason supplied", "POST", `/opportunity-candidates/${base.candidateId}/convert-to-opportunity`, `Bearer ${token}`, 400, { opportunity_name: "Duplicate Conversion" });
  const duplicate = await expectStatus("duplicate candidate conversion allowed with override reason", "POST", `/opportunity-candidates/${base.candidateId}/convert-to-opportunity`, `Bearer ${token}`, 201, { opportunity_name: "Duplicate Override Conversion", override_reason: "parallel pursuit test" });
  if (duplicate.source_candidate_id !== base.candidateId) throw new Error("duplicate override conversion did not persist");

  const lifecycleOpportunity = await expectStatus("lifecycle opportunity create works", "POST", "/opportunities", `Bearer ${token}`, 201, manualBody(base, ownerUserId, {
    opportunity_name: `Lifecycle Opportunity ${Date.now()}`,
    relationship_map_id: base.relationshipMapId,
    pursuit_score: 80,
    capacity_readiness_score: 70,
    margin_potential_score: 65,
  }));
  const capacity = await expectStatus("capacity requirement create works", "POST", `/opportunities/${lifecycleOpportunity.id}/capacity-requirements`, `Bearer ${token}`, 201, {
    capacity_type: "fiber",
    quantity: 2,
    unit: "crew",
    territory_id: base.territoryId,
    required_crew_type: "fiber crew",
  });
  await expectStatus("capacity requirement update works", "PATCH", `/opportunity-capacity-requirements/${capacity.id}`, `Bearer ${token}`, 200, { quantity: 3, notes: "Updated planning need." });
  await expectStatus("lifecycle submit for review works", "POST", `/opportunities/${lifecycleOpportunity.id}/submit-for-review`, `Bearer ${token}`, 201, { pursuit_review_reason: "Ready." });
  await expectStatus("lifecycle approve works", "POST", `/opportunities/${lifecycleOpportunity.id}/pursuit-approve`, `Bearer ${token}`, 201, {});
  await expectStatus("pursue lifecycle works", "POST", `/opportunities/${lifecycleOpportunity.id}/pursue`, `Bearer ${token}`, 201, { next_action: "Prepare proposal." });
  await expectStatus("proposal lifecycle works", "POST", `/opportunities/${lifecycleOpportunity.id}/proposal`, `Bearer ${token}`, 201, { scope_summary: "Proposal scope.", estimated_value: 150000 });
  await expectStatus("negotiation lifecycle works", "POST", `/opportunities/${lifecycleOpportunity.id}/negotiation`, `Bearer ${token}`, 201, {});

  const downstreamBefore = await downstreamCounts(client);
  const awarded = await expectStatus("award works and creates no downstream records", "POST", `/opportunities/${lifecycleOpportunity.id}/award`, `Bearer ${token}`, 201, {
    award_evidence: "Award email received.",
    customer_confirmation: "Customer confirmed award.",
  });
  const downstreamAfter = await downstreamCounts(client);
  if (awarded.status !== "awarded" || !awarded.awarded_by || awarded.handoff_message !== "Awarded opportunity is ready for future project handoff. No project was created.") throw new Error("award metadata or handoff message missing");
  assertSameCounts(downstreamBefore, downstreamAfter, "award downstream boundary");
  await expectStatus("capacity requirement archive requires reason", "POST", `/opportunity-capacity-requirements/${capacity.id}/archive`, `Bearer ${token}`, 400, {});
  await expectStatus("capacity requirement archive works within planning boundary", "POST", `/opportunity-capacity-requirements/${capacity.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "planning_changed" });

  const reasonOpportunity = await expectStatus("reason opportunity create works", "POST", "/opportunities", `Bearer ${token}`, 201, manualBody(base, ownerUserId, { opportunity_name: `Reason Opportunity ${Date.now()}` }));
  await expectStatus("lost requires valid lost_reason", "POST", `/opportunities/${reasonOpportunity.id}/lost`, `Bearer ${token}`, 400, {});
  const lost = await expectStatus("lost reason persists", "POST", `/opportunities/${reasonOpportunity.id}/lost`, `Bearer ${token}`, 201, { lost_reason: "price", lost_note: "Too expensive." });
  if (lost.lost_reason !== "price" || !lost.lost_by || !lost.lost_at) throw new Error("lost reason metadata missing");

  const deferOpportunity = await expectStatus("defer opportunity create works", "POST", "/opportunities", `Bearer ${token}`, 201, manualBody(base, ownerUserId, { opportunity_name: `Defer Opportunity ${Date.now()}` }));
  await expectStatus("defer requires valid deferred_reason", "POST", `/opportunities/${deferOpportunity.id}/defer`, `Bearer ${token}`, 400, {});
  const deferred = await expectStatus("deferred reason persists", "POST", `/opportunities/${deferOpportunity.id}/defer`, `Bearer ${token}`, 201, { deferred_reason: "timing", deferred_until: "2026-12-31" });
  if (deferred.deferred_reason !== "timing" || !deferred.deferred_by || !deferred.deferred_at) throw new Error("defer metadata missing");

  const archiveOpportunity = await expectStatus("archive opportunity create works", "POST", "/opportunities", `Bearer ${token}`, 201, manualBody(base, ownerUserId, { opportunity_name: `Archive Opportunity ${Date.now()}` }));
  await expectStatus("archive requires valid archive_reason", "POST", `/opportunities/${archiveOpportunity.id}/archive`, `Bearer ${token}`, 400, {});
  const archived = await expectStatus("archive reason persists", "POST", `/opportunities/${archiveOpportunity.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "cleanup", archive_note: "Smoke archive." });
  if (archived.status !== "archived" || archived.archive_reason !== "cleanup" || !archived.archived_by || !archived.archived_at) throw new Error("archive metadata missing");

  const filtered = await expectStatus("opportunity filters work", "GET", `/opportunities?normalized_status=draft&organization_id=${base.organizationId}&territory_id=${base.territoryId}&work_type=fiber&has_source_candidate=false&has_relationship_map=true&has_capacity_requirements=false&archived=false`, `Bearer ${token}`, 200);
  if (!filtered.some((row) => row.id === manual.id)) throw new Error("opportunity filters did not return linked manual opportunity");
  for (const sort of ["estimated_value_desc", "pursuit_score_desc", "relationship_access_desc", "updated_desc"]) {
    const sorted = await expectStatus(`${sort} sorting works`, "GET", `/opportunities?sort=${sort}`, `Bearer ${token}`, 200);
    if (!Array.isArray(sorted)) throw new Error(`${sort} did not return an array`);
  }

  const detail = await expectStatus("opportunity detail returns required sections", "GET", `/opportunities/${lifecycleOpportunity.id}/detail`, `Bearer ${token}`, 200);
  if (!detail.opportunity || !detail.organization_context || !detail.relationship_map_context || !Array.isArray(detail.capacity_requirements) || !detail.readiness) {
    throw new Error("opportunity detail missing required sections");
  }
  const timeline = await expectStatus("timeline endpoint returns opportunity/capacity events", "GET", `/opportunities/${lifecycleOpportunity.id}/timeline`, `Bearer ${token}`, 200);
  if (!timeline.some((event) => event.event_type === "opportunity.created")) throw new Error("timeline missing opportunity.created");
  if (!timeline.some((event) => event.event_type === "capacity_requirement.created")) throw new Error("timeline missing capacity_requirement.created");
  await expectStatus("audit summary endpoint enforces permission", "GET", `/opportunities/${lifecycleOpportunity.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
  const audit = await expectStatus("audit summary returns opportunity/capacity audits", "GET", `/opportunities/${lifecycleOpportunity.id}/audit-summary`, `Bearer ${token}`, 200);
  if (!audit.some((row) => row.action === "opportunity.create")) throw new Error("audit summary missing opportunity.create");
  if (!audit.some((row) => row.action === "capacity_requirement.create")) throw new Error("audit summary missing capacity_requirement.create");

  await client.end();
  console.log("opportunity smoke passed");
}

function manualBody(base, ownerUserId, patch = {}) {
  return {
    opportunity_name: `Opportunity Smoke ${Date.now()}`,
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    work_type: "fiber",
    estimated_value: 125000,
    owner_user_id: ownerUserId,
    summary: "Smoke opportunity summary.",
    source_type: "manual_entry",
    status: "draft",
    ...patch,
  };
}

async function createBase(client, tenantId, ownerUserId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `Opportunity Territory ${suffix}`, "OPP"]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type, actor_roles, work_relevance_score) VALUES ($1, $2, $3, 'prime_contractor', 'prime_contractor', ARRAY['work_distributor']::text[], 82) RETURNING id", [tenantId, territory.rows[0].id, `Opportunity Organization ${suffix}`]);
  const target = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email, influence_score, decision_authority_score, relationship_strength_score) VALUES ($1, $2, 'Opportunity Target Contact', 'decision_maker', $3, 82, 80, 70) RETURNING id", [tenantId, organization.rows[0].id, `opportunity-target-${suffix}@example.test`]);
  const bridge = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email) VALUES ($1, $2, 'Opportunity Bridge Contact', 'relationship_bridge', $3) RETURNING id", [tenantId, organization.rows[0].id, `opportunity-bridge-${suffix}@example.test`]);
  const signal = await client.query("INSERT INTO signals (tenant_id, title, source_name, status, confidence_score, trust_level, date_discovered) VALUES ($1, $2, 'opportunity-smoke', 'verified', 85, 'verified', now()) RETURNING id", [tenantId, `Opportunity Signal ${suffix}`]);
  const map = await client.query("INSERT INTO relationship_maps (tenant_id, name, map_type, objective, owner_user_id, target_organization_id, target_contact_id, status, access_score, relationship_gap_summary, recommended_next_action) VALUES ($1, $2, 'opportunity_access', 'Build access for opportunity smoke.', $3, $4, $5, 'relationship_active', 80, '[]'::jsonb, 'maintain_relationship') RETURNING id", [tenantId, `Opportunity Relationship Map ${suffix}`, ownerUserId, organization.rows[0].id, target.rows[0].id]);
  await client.query("INSERT INTO relationship_paths (tenant_id, relationship_map_id, path_name, from_contact_id, to_contact_id, intermediary_contact_ids, strength_score, confidence_score, rank, status) VALUES ($1, $2, 'Opportunity access path', $3, $4, ARRAY[$5]::uuid[], 82, 78, 1, 'active')", [tenantId, map.rows[0].id, bridge.rows[0].id, target.rows[0].id, bridge.rows[0].id]);
  const candidate = await client.query("INSERT INTO opportunity_candidates (tenant_id, title, name, summary, organization_id, territory_id, work_type, estimated_value, status, candidate_score, confidence_score, owner_user_id, relationship_map_id, relationship_access_score) VALUES ($1, 'Qualified Candidate', 'Qualified Candidate', 'Qualified summary.', $2, $3, 'fiber', 125000, 'qualified_candidate', 72, 76, $4, $5, 80) RETURNING id", [tenantId, organization.rows[0].id, territory.rows[0].id, ownerUserId, map.rows[0].id]);
  await client.query("INSERT INTO candidate_signals (tenant_id, candidate_id, signal_id, contribution_score, status) VALUES ($1, $2, $3, 80, 'active')", [tenantId, candidate.rows[0].id, signal.rows[0].id]);
  const unqualified = await client.query("INSERT INTO opportunity_candidates (tenant_id, title, name, organization_id, territory_id, work_type, status, candidate_score, confidence_score) VALUES ($1, 'Unqualified Candidate', 'Unqualified Candidate', $2, $3, 'fiber', 'monitoring', 72, 76) RETURNING id", [tenantId, organization.rows[0].id, territory.rows[0].id]);
  await client.query("INSERT INTO candidate_signals (tenant_id, candidate_id, signal_id, contribution_score, status) VALUES ($1, $2, $3, 80, 'active')", [tenantId, unqualified.rows[0].id, signal.rows[0].id]);
  return { territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, relationshipMapId: map.rows[0].id, candidateId: candidate.rows[0].id, unqualifiedCandidateId: unqualified.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Limited Opportunity User', 'x') RETURNING id", [`limited-opportunity-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOwnerUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Opportunity Owner User', 'x') RETURNING id", [`owner-opportunity-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Outside Opportunity Tenant", `outside-opportunity-${suffix}`]);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outside Opportunity User', 'x') RETURNING id", [`outside-opportunity-${suffix}@example.test`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)", [tenant.rows[0].id, user.rows[0].id]);
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, 'Outside Opportunity Territory', 'OUT') RETURNING id", [tenant.rows[0].id]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, organization_type, type) VALUES ($1, $2, 'Outside Opportunity Organization', 'prime_contractor', 'prime_contractor') RETURNING id", [tenant.rows[0].id, territory.rows[0].id]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, contact_role, email) VALUES ($1, $2, 'Outside Opportunity Contact', 'vendor_manager', 'outside-opportunity@example.test') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const map = await client.query("INSERT INTO relationship_maps (tenant_id, name, map_type, objective, target_organization_id, target_contact_id, access_score) VALUES ($1, 'Outside Opportunity Relationship Map', 'opportunity_access', 'Outside map.', $2, $3, 80) RETURNING id", [tenant.rows[0].id, organization.rows[0].id, contact.rows[0].id]);
  const opportunity = await client.query("INSERT INTO opportunities (tenant_id, title, organization_id, territory_id, work_type, estimated_value, status, stage) VALUES ($1, 'Outside Opportunity', $2, $3, 'fiber', 1, 'draft', 'draft') RETURNING id", [tenant.rows[0].id, organization.rows[0].id, territory.rows[0].id]);
  return { tenantId: tenant.rows[0].id, userId: user.rows[0].id, relationshipMapId: map.rows[0].id, opportunityId: opportunity.rows[0].id };
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

async function downstreamCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM projects) AS projects,
      (SELECT count(*)::int FROM work_orders) AS work_orders,
      (SELECT count(*)::int FROM contracts) AS contracts,
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments
  `);
  return result.rows[0];
}

function assertSameCounts(before, after, label) {
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) throw new Error(`${label}: expected ${key} count to remain ${before[key]}, got ${after[key]}`);
  }
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
