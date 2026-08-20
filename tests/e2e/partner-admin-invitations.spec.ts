import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Fixture = {
  tenantId: string;
  organizationId: string;
  otherOrganizationId: string;
  workerId: string;
  crewId: string;
  membershipId: string;
  internalToken: string;
  partnerAdminToken: string;
  foremanToken: string;
};

test.describe.serial("P18 Partner inquiry, invitation, and onboarding controls", () => {
  let client: Client;
  let fixture: Fixture;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    fixture = await seedInviteFixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("public inquiry creates only a low-confidence inquiry and requires human qualification before invite", async ({ request }) => {
    const email = `Inquiry.${crypto.randomUUID()}@Example.com`;
    const inquiry = await apiJson(request, "", "POST", "/partner-invitations/public-inquiries", {
      company_name: "Inquiry Aerial LLC",
      contact_name: "Inquiry Owner",
      email,
      phone: "555-0101",
      territory: "Ohio",
      capability: "Aerial Fiber",
      crew_count: 3,
      availability: "7 days",
      equipment: "bucket trucks",
      experience_notes: "OSP aerial construction",
      source: "synccommsystems.com",
    }, 202);
    expect(inquiry.accepted).toBe(true);
    expect(inquiry.status).toBe("NEW");

    const row = await client.query("SELECT * FROM partner_inquiries WHERE id = $1", [inquiry.inquiry_id]);
    expect(row.rows[0].potential_capacity_signal.confidence).toBe("LOW");
    expect(row.rows[0].potential_capacity_signal.verified).toBe(false);
    await expectNoAutomaticOnboarding(client, email);

    const scopedInquiryId = await seedScopedInquiry(client, fixture, email);
    await expectStatus(request, fixture.internalToken, "POST", `/partner-invitations/inquiries/${scopedInquiryId}/invite`, { organization_id: fixture.organizationId }, 409);
    const spoof = await request.post(apiUrl("/partner-invitations/public-inquiries"), { headers: jsonHeaders(""), data: { company_name: "Bad", contact_name: "Bad", email: `bad-${crypto.randomUUID()}@example.com`, territory: "Ohio", capability: "Aerial Fiber", organization_id: fixture.organizationId } });
    expect(spoof.status()).toBe(400);

    const qualified = await apiJson(request, fixture.internalToken, "POST", `/partner-invitations/inquiries/${scopedInquiryId}/qualify`, {
      decision: "QUALIFIED",
      organization_id: fixture.organizationId,
      territory_verified: true,
      capability_verified: true,
      crew_count_verified: true,
      availability_verified: true,
      equipment_verified: true,
      note: "Human conversation completed.",
    });
    expect(qualified.status).toBe("QUALIFIED");
    expect(qualified.qualified_organization_id).toBe(fixture.organizationId);

    const invitation = await apiJson(request, fixture.internalToken, "POST", `/partner-invitations/inquiries/${scopedInquiryId}/invite`, { organization_id: fixture.organizationId });
    expect(invitation.status).toBe("SENT");
    expect(invitation.invitation_source).toBe("PUBLIC_INQUIRY");
    expect(invitation.inquiry_id).toBe(scopedInquiryId);
    expect(JSON.stringify(invitation)).not.toMatch(/token_hash|internal_review_notes|margin|routing|tin/i);
  });

  test("Partner Admin invitation token lifecycle is hash-only, single-use, scoped, and race-safe", async ({ request }) => {
    const email = `Invite.Admin.${crypto.randomUUID()}@Example.com`;
    const invitation = await apiJson(request, fixture.internalToken, "POST", "/partner-invitations", {
      organization_id: fixture.organizationId,
      primary_contact_name: "Invite Partner Admin",
      email,
      role_key: "partner_admin",
      source: "MANUAL_INTERNAL",
    });
    expect(invitation.status).toBe("SENT");
    expect(invitation.intended_role_key).toBe("partner_admin");
    expect(invitation.organization_id).toBe(fixture.organizationId);
    expect(invitation.email.subject).toContain("Partner Onboarding Invitation");

    const token = tokenFrom(invitation);
    const stored = await client.query("SELECT token_hash, status FROM partner_onboarding_invitations WHERE id = $1", [invitation.id]);
    expect(stored.rows[0].token_hash).toHaveLength(64);
    expect(stored.rows[0].token_hash).not.toBe(token);

    const preview = await apiJson(request, "", "POST", "/partner-invitations/token/preview", { token });
    expect(preview.message).toContain("complete your company onboarding");
    expect(preview.checklist.items.map((item: { label: string }) => item.label)).toContain("Foreman");

    const resent = await apiJson(request, fixture.internalToken, "POST", `/partner-invitations/${invitation.id}/resend`);
    expect(resent.status).toBe("SENT");
    await expectStatus(request, "", "POST", "/partner-invitations/accept", { token }, 409);
    await apiJson(request, fixture.internalToken, "POST", `/partner-invitations/${resent.id}/revoke`, { reason: "wrong contact" });
    await expectStatus(request, "", "POST", "/partner-invitations/accept", { token: tokenFrom(resent) }, 409);

    const existingEmail = `existing-${crypto.randomUUID()}@example.com`;
    const existingUserId = crypto.randomUUID();
    await client.query("INSERT INTO users (id,email,display_name,status) VALUES ($1,$2,'Existing User','active')", [existingUserId, existingEmail]);
    const existingInvite = await apiJson(request, fixture.internalToken, "POST", "/partner-invitations", {
      organization_id: fixture.organizationId,
      primary_contact_name: "Existing User",
      email: existingEmail,
      role_key: "partner_admin",
    });
    const accepted = await apiJson(request, "", "POST", "/partner-invitations/accept", { token: tokenFrom(existingInvite), display_name: "Accepted Partner Admin" });
    expect(accepted.user.id).toBe(existingUserId);
    expect(accepted.role_key).toBe("partner_admin");
    expect(accepted.organization_id).toBe(fixture.organizationId);
    expect(accepted.next_path).toBe("/partner/onboarding");

    const checklist = await apiJson(request, accepted.token, "GET", "/partner-invitations/me/onboarding-checklist");
    expect(checklist.boundaries.checklist_is_navigation_only).toBe(true);
    expect(checklist.boundaries.mobilization_separate).toBe(true);
    const mobilization = checklist.items.find((item: { key: string }) => item.key === "mobilization");
    expect(mobilization.requirement).toBe("Locked until required items complete");

    const raceInvite = await apiJson(request, fixture.internalToken, "POST", "/partner-invitations", {
      organization_id: fixture.organizationId,
      primary_contact_name: "Race Admin",
      email: `race-${crypto.randomUUID()}@example.com`,
      role_key: "partner_admin",
    });
    const raceToken = tokenFrom(raceInvite);
    const raceResults = await Promise.all([
      request.post(apiUrl("/partner-invitations/accept"), { data: { token: raceToken }, headers: jsonHeaders("") }),
      request.post(apiUrl("/partner-invitations/accept"), { data: { token: raceToken }, headers: jsonHeaders("") }),
    ]);
    expect(raceResults.filter((response) => response.status() < 400)).toHaveLength(1);
    const acceptedRows = await client.query("SELECT count(*)::int AS count FROM partner_onboarding_invitations WHERE id = $1 AND status = 'ACCEPTED'", [raceInvite.id]);
    expect(acceptedRows.rows[0].count).toBe(1);

    await expectStatus(request, fixture.foremanToken, "POST", "/partner-invitations", {
      organization_id: fixture.organizationId,
      primary_contact_name: "Nope",
      email: `nope-${crypto.randomUUID()}@example.com`,
    }, 403);
  });

  test("Foreman invitation binds exact Worker/Crew assignment and rejects changed relationships", async ({ request }) => {
    const invitation = await apiJson(request, fixture.partnerAdminToken, "POST", "/partner-invitations/foreman", {
      worker_id: fixture.workerId,
      crew_id: fixture.crewId,
      email: `foreman-${crypto.randomUUID()}@example.com`,
    });
    expect(invitation.invitation_type).toBe("partner_foreman");
    expect(invitation.intended_role_key).toBe("partner_foreman");
    expect(invitation.organization_id).toBe(fixture.organizationId);
    expect(invitation.worker_id).toBe(fixture.workerId);
    expect(invitation.crew_id).toBe(fixture.crewId);

    await expectStatus(request, fixture.partnerAdminToken, "POST", "/partner-invitations/foreman", {
      organization_id: fixture.otherOrganizationId,
      worker_id: fixture.workerId,
      crew_id: fixture.crewId,
      email: `wrong-org-${crypto.randomUUID()}@example.com`,
    }, 403);

    const accepted = await apiJson(request, "", "POST", "/partner-invitations/accept", { token: tokenFrom(invitation), display_name: "Field Foreman" });
    expect(accepted.role_key).toBe("partner_foreman");
    expect(accepted.worker_id).toBe(fixture.workerId);
    expect(accepted.crew_id).toBe(fixture.crewId);
    const linkRows = await client.query(
      "SELECT count(*)::int AS count FROM partner_worker_user_links l JOIN tenant_users tu ON tu.id = l.tenant_user_id WHERE l.tenant_id = $1 AND l.worker_id = $2 AND tu.user_id = $3 AND l.status = 'active'",
      [fixture.tenantId, fixture.workerId, accepted.user.id],
    );
    expect(linkRows.rows[0].count).toBe(1);

    const staleWorkerId = crypto.randomUUID();
    const staleCrewId = crypto.randomUUID();
    const staleMembershipId = crypto.randomUUID();
    await seedForemanWorker(client, fixture, staleWorkerId, staleCrewId, staleMembershipId);
    const staleInvite = await apiJson(request, fixture.partnerAdminToken, "POST", "/partner-invitations/foreman", {
      worker_id: staleWorkerId,
      crew_id: staleCrewId,
      email: `stale-foreman-${crypto.randomUUID()}@example.com`,
    });
    await client.query("UPDATE partner_crew_memberships SET status = 'ended', effective_end_date = current_date, updated_at = now() WHERE id = $1", [staleMembershipId]);
    await expectStatus(request, "", "POST", "/partner-invitations/accept", { token: tokenFrom(staleInvite) }, 403);
  });

  test("onboarding workspace, approval boundary, analytics, and token-leak controls stay internal", async ({ request }) => {
    const workspace = await apiJson(request, fixture.internalToken, "GET", "/partner-invitations/onboarding-workspace");
    expect(workspace.partners.some((partner: { organization_id: string }) => partner.organization_id === fixture.organizationId)).toBe(true);

    const analytics = await apiJson(request, fixture.internalToken, "GET", "/partner-invitations/analytics");
    expect(Number(analytics.inquiry_count)).toBeGreaterThanOrEqual(1);
    expect(Number(analytics.invitation_count)).toBeGreaterThanOrEqual(1);

    await expectStatus(request, fixture.partnerAdminToken, "POST", `/partner-invitations/organizations/${fixture.organizationId}/approve`, {}, 403);
    const beforeWo = await client.query("SELECT count(*)::int AS count FROM work_orders WHERE tenant_id = $1", [fixture.tenantId]);
    const beforeMob = await client.query("SELECT count(*)::int AS count FROM mobilization_readiness_evaluations WHERE tenant_id = $1", [fixture.tenantId]);
    await expectStatus(request, fixture.internalToken, "POST", `/partner-invitations/organizations/${fixture.organizationId}/approve`, {}, 409);
    const afterWo = await client.query("SELECT count(*)::int AS count FROM work_orders WHERE tenant_id = $1", [fixture.tenantId]);
    const afterMob = await client.query("SELECT count(*)::int AS count FROM mobilization_readiness_evaluations WHERE tenant_id = $1", [fixture.tenantId]);
    expect(afterWo.rows[0].count).toBe(beforeWo.rows[0].count);
    expect(afterMob.rows[0].count).toBe(beforeMob.rows[0].count);

    const rawTokenInvite = await apiJson(request, fixture.internalToken, "POST", "/partner-invitations", {
      organization_id: fixture.organizationId,
      primary_contact_name: "Leak Audit",
      email: `leak-${crypto.randomUUID()}@example.com`,
    });
    const token = tokenFrom(rawTokenInvite);
    const leakRows = await client.query("SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id = $1 AND (before_state::text LIKE $2 OR after_state::text LIKE $2 OR metadata::text LIKE $2)", [fixture.tenantId, `%${token}%`]);
    expect(leakRows.rows[0].count).toBe(0);
  });
});

async function seedInviteFixture(client: Client, secret: string): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const internalUserId = crypto.randomUUID();
  const internalTenantUserId = crypto.randomUUID();
  const internalRoleId = crypto.randomUUID();
  const partnerRoleId = crypto.randomUUID();
  const foremanRoleId = crypto.randomUUID();
  const foremanOnlyUserId = crypto.randomUUID();
  const foremanOnlyTenantUserId = crypto.randomUUID();
  const partnerAdminUserId = crypto.randomUUID();
  const partnerAdminTenantUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const providerId = crypto.randomUUID();
  const otherProviderId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const crewId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const permissions = [
    "partner_inquiry.read",
    "partner_inquiry.manage",
    "partner_inquiry.qualify",
    "partner_invitation.create",
    "partner_invitation.read",
    "partner_invitation.resend",
    "partner_invitation.revoke",
    "partner_onboarding.review",
    "partner_onboarding.approve",
    "partner_foreman_invitation.create",
    "partner_foreman_invitation.read",
    "partner_foreman_invitation.resend",
    "partner_foreman_invitation.revoke",
    "partner_context.read",
    "partner_profile.read",
    "partner_actions.read",
    "partner_compliance.summary.read",
  ];
  await client.query("BEGIN");
  try {
    for (const permission of permissions) await client.query("INSERT INTO permissions (key,name) VALUES ($1,$1) ON CONFLICT (key) DO NOTHING", [permission]);
    await client.query("INSERT INTO tenants (id,name,slug) VALUES ($1,$2,$3)", [tenantId, "Invite Tenant", `invite-${suffix}`]);
    await client.query("INSERT INTO users (id,email,display_name,status) VALUES ($1,$2,'Invite Internal','active'),($3,$4,'Partner Admin','active'),($5,$6,'Foreman Only','active')", [internalUserId, `invite-internal-${suffix}@syncos.test`, partnerAdminUserId, `partner-admin-${suffix}@syncos.test`, foremanOnlyUserId, `foreman-only-${suffix}@syncos.test`]);
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id,status) VALUES ($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$2,$7,'active')", [internalTenantUserId, tenantId, internalUserId, partnerAdminTenantUserId, partnerAdminUserId, foremanOnlyTenantUserId, foremanOnlyUserId]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'Invite Internal','invite_internal'),($3,$2,'Partner Admin','partner_admin'),($4,$2,'Partner Foreman','partner_foreman')", [internalRoleId, tenantId, partnerRoleId, foremanRoleId]);
    for (const permission of permissions) await grant(client, tenantId, internalRoleId, permission);
    for (const permission of ["partner_context.read", "partner_profile.read", "partner_actions.read", "partner_compliance.summary.read", "partner_foreman_invitation.create", "partner_foreman_invitation.read", "partner_foreman_invitation.resend", "partner_foreman_invitation.revoke"]) await grant(client, tenantId, partnerRoleId, permission);
    for (const permission of ["partner_context.read", "partner_actions.read", "partner_compliance.summary.read"]) await grant(client, tenantId, foremanRoleId, permission);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'tenant',$1),($1,$4,$5,'organization',$6),($1,$7,$8,'organization',$6)", [tenantId, internalTenantUserId, internalRoleId, partnerAdminTenantUserId, partnerRoleId, organizationId, foremanOnlyTenantUserId, foremanRoleId]);
    await seedOrganization(client, tenantId, organizationId, providerId, "Invite Partner");
    await seedOrganization(client, tenantId, otherOrganizationId, otherProviderId, "Other Partner");
    await seedForemanWorker(client, { tenantId, organizationId, workerId, crewId, membershipId } as Fixture, workerId, crewId, membershipId, providerId);
    await client.query("COMMIT");
    return {
      tenantId,
      organizationId,
      otherOrganizationId,
      workerId,
      crewId,
      membershipId,
      internalToken: signToken(internalUserId, tenantId, secret),
      partnerAdminToken: signToken(partnerAdminUserId, tenantId, secret),
      foremanToken: signToken(foremanOnlyUserId, tenantId, secret),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedOrganization(client: Client, tenantId: string, organizationId: string, providerId: string, name: string) {
  await client.query("INSERT INTO organizations (id,tenant_id,name,type,organization_type,actor_roles,status) VALUES ($1,$2,$3,'subcontractor','subcontractor',ARRAY['capacity_provider']::text[],'active')", [organizationId, tenantId, name]);
  await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,$4,'subcontractor','qualified','qualified','not_started')", [providerId, tenantId, organizationId, `${name} Provider`]);
}

async function seedScopedInquiry(client: Client, fixture: Fixture, email: string) {
  const result = await client.query(
    `
    INSERT INTO partner_inquiries (
      tenant_id, company_name, contact_name, email, territory, capability, crew_count,
      availability, equipment, experience_notes, source, potential_capacity_signal
    )
    VALUES ($1,'Inquiry Aerial LLC','Inquiry Owner',$2,'Ohio','Aerial Fiber',3,'7 days','bucket trucks','OSP aerial construction','synccommsystems.com',$3)
    RETURNING id
    `,
    [fixture.tenantId, email.toLowerCase(), { confidence: "LOW", verified: false, territory: "Ohio", capability: "Aerial Fiber", crew_count: 3, source: "public_inquiry" }],
  );
  return result.rows[0].id as string;
}

async function seedForemanWorker(client: Client, fixture: Pick<Fixture, "tenantId" | "organizationId">, workerId: string, crewId: string, membershipId: string, providerId?: string) {
  const resolvedProviderId = providerId ?? (await client.query("SELECT id FROM capacity_providers WHERE tenant_id = $1 AND organization_id = $2 LIMIT 1", [fixture.tenantId, fixture.organizationId])).rows[0].id;
  await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status) VALUES ($1,$2,$3,$4,$5,'aerial','active','active')", [crewId, fixture.tenantId, resolvedProviderId, fixture.organizationId, `Crew ${crewId.slice(0, 6)}`]);
  await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,organization_id,crew_id,first_name,last_name,status,review_status,worker_role) VALUES ($1,$2,$3,$4,$5,'Field','Foreman','active','approved','foreman')", [workerId, fixture.tenantId, resolvedProviderId, fixture.organizationId, crewId]);
  await client.query("INSERT INTO partner_crew_memberships (id,tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,$6,'foreman','active')", [membershipId, fixture.tenantId, fixture.organizationId, resolvedProviderId, crewId, workerId]);
}

async function grant(client: Client, tenantId: string, roleId: string, permission: string) {
  await client.query(
    `
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT $1, $2, p.id FROM permissions p WHERE p.key = $3
    ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [tenantId, roleId, permission],
  );
}

async function expectNoAutomaticOnboarding(client: Client, email: string) {
  const normalized = email.toLowerCase();
  const userRows = await client.query("SELECT count(*)::int AS count FROM users WHERE email = $1", [normalized]);
  const invitationRows = await client.query("SELECT count(*)::int AS count FROM partner_onboarding_invitations WHERE email = $1", [normalized]);
  const workOrderRows = await client.query("SELECT count(*)::int AS count FROM work_orders", []);
  const mobilizationRows = await client.query("SELECT count(*)::int AS count FROM mobilization_readiness_evaluations", []);
  expect(userRows.rows[0].count).toBe(0);
  expect(invitationRows.rows[0].count).toBe(0);
  expect(Number(workOrderRows.rows[0].count)).toBeGreaterThanOrEqual(0);
  expect(Number(mobilizationRows.rows[0].count)).toBeGreaterThanOrEqual(0);
}

async function apiJson(request: APIRequestContext, token: string, method: "GET" | "POST", path: string, body?: unknown, expectedStatus?: number) {
  const response = method === "GET"
    ? await request.get(apiUrl(path), { headers: jsonHeaders(token) })
    : await request.post(apiUrl(path), { headers: jsonHeaders(token), data: body ?? {} });
  if (expectedStatus === undefined) {
    expect(response.status(), `${method} ${path}`).toBeLessThan(400);
  } else {
    expect(response.status(), `${method} ${path}`).toBe(expectedStatus);
  }
  return await response.json();
}

async function expectStatus(request: APIRequestContext, token: string, method: "GET" | "POST", path: string, body: unknown, expectedStatus: number) {
  const response = method === "GET"
    ? await request.get(apiUrl(path), { headers: jsonHeaders(token) })
    : await request.post(apiUrl(path), { headers: jsonHeaders(token), data: body ?? {} });
  expect(response.status(), `${method} ${path}`).toBe(expectedStatus);
}

function tokenFrom(response: { onboarding_url: string }) {
  return String(response.onboarding_url).split("/").pop() ?? "";
}

function apiUrl(path: string) {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${path.replace(/^\//, "")}`;
}

function jsonHeaders(token: string) {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function signToken(userId: string, tenantId: string, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, tenant_id: tenantId, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
