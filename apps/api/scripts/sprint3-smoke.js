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
  await assignRole(client, tenantId, tenantUserId, "Executive");
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  const nonAuthority = await createNonAuthorityUser(client, tenantId);
  const nonAuthorityToken = createToken({ sub: nonAuthority.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  await expectStatus("unauthorized opportunity create blocked", "POST", "/opportunities", undefined, 401, { title: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});

  const base = await createBaseTenantData(client, tenantId, userId);
  const outside = await createOutsideTenantData(client, userId);

  const createBefore = await counts(client);
  const opportunity = await expectStatus("create opportunity", "POST", "/opportunities", `Bearer ${token}`, 201, {
    title: `Sprint 3 Opportunity ${Date.now()}`,
    candidate_id: base.candidateId,
    signal_strength_score: 80,
    relationship_access_score: 75,
    capacity_fit_score: 90,
    margin_potential_score: 60,
    strategic_fit_score: 80,
    payment_risk_score: 20,
  });
  await expectDelta(client, createBefore, 1, 1, 1, 1, "opportunity create event/audit/payload/system action");
  if (opportunity.status !== "qualified") throw new Error("opportunity was not created as qualified");

  await expectStatus("cross-tenant opportunity blocked", "GET", `/opportunities/${outside.opportunityId}`, `Bearer ${token}`, 404);

  const scoreBefore = await counts(client);
  const scored = await expectStatus("opportunity score calculation", "POST", `/opportunities/${opportunity.id}/score`, `Bearer ${token}`, 201, {});
  await expectDelta(client, scoreBefore, 1, 1, 1, 1, "opportunity score event/audit/payload/system action");
  if (Number(scored.pursuit_score) !== 78 || scored.recommendation !== "Pursue") {
    throw new Error(`opportunity score mismatch: ${scored.pursuit_score} ${scored.recommendation}`);
  }
  const summary = await expectStatus("opportunity score summary", "GET", `/opportunities/${opportunity.id}/score-summary`, `Bearer ${token}`, 200);
  if (summary.pursuit_score !== 78 || summary.recommendation !== "Pursue") throw new Error("opportunity score summary mismatch");

  const low = await expectStatus("create low opportunity", "POST", "/opportunities", `Bearer ${token}`, 201, {
    title: `Sprint 3 Low Opportunity ${Date.now()}`,
    organization_id: base.organizationId,
    territory_id: base.territoryId,
    owner_user_id: userId,
    work_type: "fiber_build",
    evidence_summary: "Manual executive evidence",
    signal_strength_score: 20,
    relationship_access_score: 20,
    capacity_fit_score: 20,
    margin_potential_score: 20,
    strategic_fit_score: 20,
    payment_risk_score: 80,
  });
  await expectStatus("score low opportunity", "POST", `/opportunities/${low.id}/score`, `Bearer ${token}`, 201, {});
  await expectStatus("pursuit approval blocked below threshold", "POST", `/opportunities/${low.id}/pursuit-approve`, `Bearer ${token}`, 400, {});

  const approveBefore = await counts(client);
  const approved = await expectStatus("pursuit approval succeeds above threshold", "POST", `/opportunities/${opportunity.id}/pursuit-approve`, `Bearer ${token}`, 201, {});
  await expectDelta(client, approveBefore, 1, 1, 1, 1, "pursuit approval event/audit/payload/system action");
  if (approved.status !== "pursuit_approved") throw new Error("pursuit approval did not update status");

  const pursuing = await expectStatus("pursue opportunity", "POST", `/opportunities/${opportunity.id}/pursue`, `Bearer ${token}`, 201, {
    next_action: "Prepare proposal package",
  });
  if (pursuing.status !== "pursuing") throw new Error("pursue did not update status");

  const requirement = await expectStatus("create capacity requirement", "POST", `/opportunities/${opportunity.id}/capacity-requirements`, `Bearer ${token}`, 201, {
    capacity_type: "Sprint 3 Bore Crew",
    quantity: 2,
    unit: "crew",
    territory_id: base.territoryId,
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  });
  await expectStatus("capacity requirement cross-tenant opportunity blocked", "POST", `/opportunities/${outside.opportunityId}/capacity-requirements`, `Bearer ${token}`, 404, {
    capacity_type: "Bore Crew",
    quantity: 1,
    unit: "crew",
  });
  await expectStatus("capacity requirement tenant-safe territory", "PATCH", `/opportunity-capacity-requirements/${requirement.id}`, `Bearer ${token}`, 404, {
    territory_id: outside.territoryId,
  });

  const proposal = await expectStatus("proposal transition", "POST", `/opportunities/${opportunity.id}/proposal`, `Bearer ${token}`, 201, {
    scope_summary: "Backbone build scope",
    estimated_value: 250000,
  });
  if (proposal.status !== "bid_proposal") throw new Error("proposal did not update status");

  const negotiation = await expectStatus("negotiation transition", "POST", `/opportunities/${opportunity.id}/negotiation`, `Bearer ${token}`, 201, {});
  if (negotiation.status !== "negotiation") throw new Error("negotiation did not update status");

  await expectStatus("award requires authority", "POST", `/opportunities/${opportunity.id}/award`, `Bearer ${nonAuthorityToken}`, 403, {
    award_evidence: "Signed award notice",
    customer_confirmation: "Customer confirmed",
  });
  const awarded = await expectStatus("award with authority", "POST", `/opportunities/${opportunity.id}/award`, `Bearer ${token}`, 201, {
    award_evidence: "Signed award notice",
    customer_confirmation: "Customer confirmed",
  });
  if (awarded.status !== "awarded") throw new Error("award did not update status");

  const results = await expectStatus("tenant-scoped opportunity search", "GET", `/search?q=${encodeURIComponent("Sprint 3")}`, `Bearer ${token}`, 200);
  if (!Array.isArray(results) || !results.some((row) => row.object_type === "opportunity" && row.id === opportunity.id)) {
    throw new Error("search did not return same-tenant opportunity");
  }
  if (!results.some((row) => row.object_type === "capacity_requirement" && row.id === requirement.id)) {
    throw new Error("search did not return same-tenant capacity requirement");
  }
  if (results.some((row) => row.id === outside.opportunityId || row.id === outside.requirementId)) {
    throw new Error("search returned cross-tenant Sprint 3 result");
  }

  const forbiddenCounts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM capacity_providers) AS capacity_providers,
      (SELECT count(*)::int FROM projects) AS projects,
      (SELECT count(*)::int FROM production_records) AS production_records
  `);
  if (forbiddenCounts.rows[0].capacity_providers !== 0) throw new Error("Sprint 3 created capacity provider records");
  if (forbiddenCounts.rows[0].projects !== 0) throw new Error("Sprint 3 created project records");
  if (forbiddenCounts.rows[0].production_records !== 0) throw new Error("Sprint 3 created production records");

  await client.end();
  console.log("sprint3 smoke passed");
}

async function createBaseTenantData(client, tenantId, userId) {
  const suffix = Date.now();
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [
    tenantId,
    `Sprint 3 Territory ${suffix}`,
    `S3-${suffix}`,
  ]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'carrier') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Sprint 3 Organization ${suffix}`,
  ]);
  const contact = await client.query("INSERT INTO contacts (tenant_id, organization_id, full_name, email) VALUES ($1, $2, 'Sprint 3 Contact', 'sprint3@example.test') RETURNING id", [
    tenantId,
    organization.rows[0].id,
  ]);
  const candidate = await client.query(
    `
    INSERT INTO opportunity_candidates (
      tenant_id, organization_id, territory_id, title, name, work_type, owner_user_id, evidence_summary, status, confidence_score
    )
    VALUES ($1, $2, $3, 'Sprint 3 Candidate', 'Sprint 3 Candidate', 'fiber_build', $4, 'Qualified candidate evidence', 'qualified_candidate', 84)
    RETURNING id
    `,
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId],
  );
  const map = await client.query(
    "INSERT INTO relationship_maps (tenant_id, name, target_organization_id, target_object_type, target_object_id, status) VALUES ($1, 'Sprint 3 Relationship Map', $2, 'opportunity_candidate', $3, 'identified_path') RETURNING id",
    [tenantId, organization.rows[0].id, candidate.rows[0].id],
  );
  await client.query(
    "INSERT INTO relationship_paths (tenant_id, relationship_map_id, from_contact_id, to_contact_id, strength_score, confidence_score, rank, status) VALUES ($1, $2, $3, $3, 80, 80, 1, 'active')",
    [tenantId, map.rows[0].id, contact.rows[0].id],
  );
  return {
    territoryId: territory.rows[0].id,
    organizationId: organization.rows[0].id,
    candidateId: candidate.rows[0].id,
  };
}

async function createOutsideTenantData(client, userId) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [
    "Sprint 3 Outside Tenant",
    `sprint3-outside-${suffix}`,
  ]);
  const tenantId = tenant.rows[0].id;
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, 'Outside Territory') RETURNING id", [tenantId]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, 'Outside Organization', 'carrier') RETURNING id", [
    tenantId,
    territory.rows[0].id,
  ]);
  const opportunity = await client.query(
    `
    INSERT INTO opportunities (tenant_id, organization_id, territory_id, owner_user_id, title, work_type, evidence_summary)
    VALUES ($1, $2, $3, $4, 'Outside Opportunity', 'fiber_build', 'outside evidence')
    RETURNING id
    `,
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId],
  );
  const requirement = await client.query(
    "INSERT INTO opportunity_capacity_requirements (tenant_id, opportunity_id, capacity_type, quantity, unit, territory_id) VALUES ($1, $2, 'Outside Capacity', 1, 'crew', $3) RETURNING id",
    [tenantId, opportunity.rows[0].id, territory.rows[0].id],
  );
  return {
    territoryId: territory.rows[0].id,
    opportunityId: opportunity.rows[0].id,
    requirementId: requirement.rows[0].id,
  };
}

async function createNonAuthorityUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Sprint 3 Non Authority') RETURNING id",
    [`sprint3-nonauthority-${suffix}@example.test`],
  );
  const tenantUser = await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2) RETURNING id", [tenantId, user.rows[0].id]);
  await assignRole(client, tenantId, tenantUser.rows[0].id, "Regional Director");
  await client.query(
    `
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT $1, r.id, p.id
    FROM roles r
    JOIN permissions p ON p.key LIKE 'opportunity.%' OR p.key LIKE 'capacity_requirement.%'
    WHERE r.tenant_id = $1 AND r.name = 'Regional Director'
    ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [tenantId],
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

async function expectDelta(client, before, events, eventPayloads, auditLogs, systemActions, label) {
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
