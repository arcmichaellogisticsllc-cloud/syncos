import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Seeded = {
  tenantA: string;
  tenantB: string;
  orgA: string;
  orgB: string;
  orgTenantB: string;
  nonPartnerOrg: string;
  providerA: string;
  providerB: string;
  providerTenantB: string;
  adminUser: string;
  foremanUser: string;
  disabledMemberUser: string;
  noRoleUser: string;
  noRoleTenantUser: string;
  internalToken: string;
  unauthorizedInternalToken: string;
  adminToken: string;
  foremanToken: string;
  disabledMemberToken: string;
  noRoleToken: string;
  tenantBToken: string;
};

test.describe.serial("P2 Partner personas, permissions, and route visibility", () => {
  let client: Client;
  let seeded: Seeded;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");

    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedPartnerPersonaFixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("authentication and role gates deny unauthenticated, inactive membership, and no-role users", async ({ request }) => {
    const unauthenticated = await request.get(apiUrl("/partner-personas/me/context"));
    expect(unauthenticated.status()).toBe(401);

    await expectStatus(request, seeded.disabledMemberToken, "GET", "/partner-personas/me/context", 401);
    await expectStatus(request, seeded.noRoleToken, "GET", "/partner-personas/me/context", 403);

    const tenantScopedPartnerRole = crypto.randomUUID();
    await client.query(
      `
      INSERT INTO roles (id, tenant_id, name, system_key)
      VALUES ($1, $2, 'P2 Tenant Scoped Partner Role', 'partner_foreman')
      ON CONFLICT (tenant_id, system_key) DO UPDATE SET name = EXCLUDED.name
      `,
      [tenantScopedPartnerRole, seeded.tenantA],
    );
    await grantPermissions(client, seeded.tenantA, tenantScopedPartnerRole, ["partner_context.read", "partner_actions.read"]);
    await client.query(
      `
      INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
      VALUES ($1, $2, $3, 'tenant', $1)
      ON CONFLICT (tenant_user_id, role_id, scope_type, scope_id) DO NOTHING
      `,
      [seeded.tenantA, seeded.noRoleTenantUser, tenantScopedPartnerRole],
    );
    await expectStatus(request, seeded.noRoleToken, "GET", "/partner-personas/me/context", 403);
  });

  test("authorized internal user assigns Partner Admin and Partner Foreman only to Partner Organizations", async ({ request }) => {
    await expectStatus(request, seeded.unauthorizedInternalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, 403, {
      role_key: "partner_admin",
      organization_id: seeded.orgA,
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, 400, {
      role_key: "partner_admin",
      scope_type: "tenant",
      organization_id: seeded.orgA,
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, 400, {
      role_key: "partner_admin",
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, 400, {
      role_key: "partner_owner",
      organization_id: seeded.orgA,
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, 400, {
      role_key: "partner_admin",
      organization_id: seeded.nonPartnerOrg,
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, 404, {
      role_key: "partner_admin",
      organization_id: seeded.orgTenantB,
    });

    const before = await eventCounts(client);
    const assignedAdmin = await apiJson(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, {
      role_key: "partner_admin",
      organization_id: seeded.orgA,
      reason: "P2 assign partner admin",
    });
    expect(assignedAdmin.role_key).toBe("partner_admin");
    expect(assignedAdmin.scope_type).toBe("organization");
    expect(assignedAdmin.partner_organization_id).toBe(seeded.orgA);
    expect(assignedAdmin.reused_existing_assignment).toBe(false);

    const assignedForeman = await apiJson(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.foremanUser}/roles`, {
      role_key: "partner_foreman",
      organization_id: seeded.orgA,
    });
    expect(assignedForeman.role_key).toBe("partner_foreman");
    expect(assignedForeman.partner_organization_id).toBe(seeded.orgA);

    const after = await eventCounts(client);
    expect(after.events).toBe(before.events + 2);
    expect(after.audit_logs).toBe(before.audit_logs + 2);

    const duplicate = await apiJson(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, {
      role_key: "partner_admin",
      organization_id: seeded.orgA,
    });
    expect(duplicate.reused_existing_assignment).toBe(true);
    const afterDuplicate = await eventCounts(client);
    expect(afterDuplicate).toEqual(after);
  });

  test("Partner context resolves safe persona, organization, actions, and route visibility", async ({ request }) => {
    const adminContext = await apiJson(request, seeded.adminToken, "GET", "/partner-personas/me/context");
    expect(adminContext.user.id).toBe(seeded.adminUser);
    expect(adminContext.persona).toBe("partner_admin");
    expect(adminContext.organization.id).toBe(seeded.orgA);
    expect(adminContext.capacity_provider.id).toBe(seeded.providerA);
    expect(adminContext.allowed_actions).toEqual(["partner.context.read", "partner.profile.read", "partner.actions.read"]);
    expect(adminContext.route_visibility.map((route: { key: string }) => route.key)).toEqual(["partner.context", "partner.organization", "partner.actions"]);
    assertSafeContext(adminContext);

    const organization = await apiJson(request, seeded.adminToken, "GET", "/partner-personas/me/organization");
    expect(organization.organization.id).toBe(seeded.orgA);
    expect(organization.capacity_provider.id).toBe(seeded.providerA);
    assertSafeContext(organization);

    const foremanContext = await apiJson(request, seeded.foremanToken, "GET", "/partner-personas/me/context");
    expect(foremanContext.persona).toBe("partner_foreman");
    expect(foremanContext.allowed_actions).toEqual(["partner.context.read", "partner.actions.read"]);
    expect(foremanContext.route_visibility.map((route: { key: string }) => route.key)).toEqual(["partner.context", "partner.actions"]);
    await expectStatus(request, seeded.foremanToken, "GET", "/partner-personas/me/organization", 403);
  });

  test("Partner users cannot broaden organization scope through headers, query, body, or guessed IDs", async ({ request }) => {
    await expectStatus(request, seeded.adminToken, "GET", `/partner-personas/me/context?organization_id=${seeded.orgB}`, 403);
    await expectStatus(request, seeded.adminToken, "GET", "/partner-personas/me/context", 403, undefined, orgScopeHeaders(seeded.orgB));
    await expectStatus(request, seeded.adminToken, "GET", "/partner-domain/organizations", 403, undefined, orgScopeHeaders(seeded.orgB));
    await expectStatus(request, seeded.adminToken, "GET", `/partner-domain/organizations/${seeded.orgB}`, 403, undefined, orgScopeHeaders(seeded.orgB));
    await expectStatus(
      request,
      seeded.adminToken,
      "GET",
      `/partner-domain/organizations/${seeded.orgA}/capacity-providers/${seeded.providerB}`,
      403,
      undefined,
      orgScopeHeaders(seeded.orgA),
    );
    await expectStatus(request, seeded.adminToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, 403, {
      role_key: "partner_admin",
      organization_id: seeded.orgB,
    });
  });

  test("Partner users cannot access internal routes or P1 classification mutation", async ({ request }) => {
    await expectStatus(request, seeded.adminToken, "GET", "/organizations", 403);
    await expectStatus(request, seeded.adminToken, "GET", "/capacity-providers", 403);
    await expectStatus(request, seeded.adminToken, "POST", `/partner-domain/organizations/${seeded.orgA}/classify`, 403, {
      provider_type: "subcontractor",
    }, orgScopeHeaders(seeded.orgA));
    await expectStatus(request, seeded.foremanToken, "POST", `/partner-domain/organizations/${seeded.orgA}/classify`, 403, {
      provider_type: "subcontractor",
    }, orgScopeHeaders(seeded.orgA));
    await expectStatus(request, seeded.adminToken, "POST", `/partner-personas/users/${seeded.foremanUser}/roles`, 403, {
      role_key: "partner_foreman",
      organization_id: seeded.orgA,
    });
  });

  test("cross-tenant Partner users and capacity-provider guesses are denied", async ({ request }) => {
    await expectStatus(request, seeded.tenantBToken, "GET", `/partner-personas/me/context?organization_id=${seeded.orgA}`, 403);
    await expectStatus(
      request,
      seeded.tenantBToken,
      "GET",
      `/partner-domain/organizations/${seeded.orgTenantB}/capacity-providers/${seeded.providerA}`,
      403,
      undefined,
      orgScopeHeaders(seeded.orgTenantB),
    );
  });

  test("role revocation and tenant membership deactivation revoke Partner context immediately", async ({ request }) => {
    const revocationBefore = await eventCounts(client);
    await expectStatus(
      request,
      seeded.internalToken,
      "DELETE",
      `/partner-personas/users/${seeded.foremanUser}/roles/partner_foreman/scopes/${seeded.orgA}`,
      200,
    );
    const revocationAfter = await eventCounts(client);
    expect(revocationAfter.events).toBe(revocationBefore.events + 1);
    expect(revocationAfter.audit_logs).toBe(revocationBefore.audit_logs + 1);
    await expectStatus(request, seeded.foremanToken, "GET", "/partner-personas/me/context", 403);

    await apiJson(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.noRoleUser}/roles`, {
      role_key: "partner_admin",
      organization_id: seeded.orgA,
    });
    await client.query(
      "UPDATE tenant_users SET status = 'disabled' WHERE tenant_id = $1 AND user_id = $2",
      [seeded.tenantA, seeded.noRoleUser],
    );
    await expectStatus(request, seeded.noRoleToken, "GET", "/partner-personas/me/context", 401);
  });

  test("multiple Partner organization scopes require explicit selection and remain scoped", async ({ request }) => {
    await apiJson(request, seeded.internalToken, "POST", `/partner-personas/users/${seeded.adminUser}/roles`, {
      role_key: "partner_admin",
      organization_id: seeded.orgB,
    });
    await expectStatus(request, seeded.adminToken, "GET", "/partner-personas/me/context", 409);

    const scopedA = await apiJson(request, seeded.adminToken, "GET", "/partner-personas/me/context", undefined, orgScopeHeaders(seeded.orgA));
    expect(scopedA.organization.id).toBe(seeded.orgA);
    const scopedB = await apiJson(request, seeded.adminToken, "GET", "/partner-personas/me/context", undefined, orgScopeHeaders(seeded.orgB));
    expect(scopedB.organization.id).toBe(seeded.orgB);

    await client.query(
      "UPDATE capacity_providers SET status = 'archived', deleted_at = now() WHERE tenant_id = $1 AND id = $2",
      [seeded.tenantA, seeded.providerB],
    );
    await expectStatus(request, seeded.adminToken, "GET", "/partner-personas/me/context", 403, undefined, orgScopeHeaders(seeded.orgB));
  });
});

async function seedPartnerPersonaFixture(client: Client, secret: string): Promise<Seeded> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const orgTenantB = crypto.randomUUID();
  const nonPartnerOrg = crypto.randomUUID();
  const providerA = crypto.randomUUID();
  const providerB = crypto.randomUUID();
  const providerTenantB = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const unauthorizedInternalUser = crypto.randomUUID();
  const adminUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const disabledMemberUser = crypto.randomUUID();
  const noRoleUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const internalTenantUser = crypto.randomUUID();
  const unauthorizedInternalTenantUser = crypto.randomUUID();
  const adminTenantUser = crypto.randomUUID();
  const foremanTenantUser = crypto.randomUUID();
  const disabledMemberTenantUser = crypto.randomUUID();
  const noRoleTenantUser = crypto.randomUUID();
  const tenantBTenantUser = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const unauthorizedRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)", [
      tenantA,
      "P2 Partner Persona Tenant A",
      `p2-partner-persona-a-${suffix}`,
      tenantB,
      "P2 Partner Persona Tenant B",
      `p2-partner-persona-b-${suffix}`,
    ]);
    for (const permission of ["admin.manage_roles", "capacity_provider.read", "capacity_provider.create", "partner_context.read", "partner_profile.read", "partner_actions.read"]) {
      await ensurePermission(client, permission);
    }
    await client.query(
      `
      INSERT INTO users (id, email, display_name)
      VALUES
        ($1, $2, 'P2 Internal Admin'),
        ($3, $4, 'P2 Unauthorized Internal'),
        ($5, $6, 'P2 Partner Admin'),
        ($7, $8, 'P2 Partner Foreman'),
        ($9, $10, 'P2 Disabled Member'),
        ($11, $12, 'P2 No Role User'),
        ($13, $14, 'P2 Tenant B Partner')
      `,
      [
        internalUser,
        `p2-internal-${suffix}@syncos.test`,
        unauthorizedInternalUser,
        `p2-unauthorized-${suffix}@syncos.test`,
        adminUser,
        `p2-admin-${suffix}@syncos.test`,
        foremanUser,
        `p2-foreman-${suffix}@syncos.test`,
        disabledMemberUser,
        `p2-disabled-${suffix}@syncos.test`,
        noRoleUser,
        `p2-norole-${suffix}@syncos.test`,
        tenantBUser,
        `p2-tenant-b-${suffix}@syncos.test`,
      ],
    );
    await client.query(
      `
      INSERT INTO tenant_users (id, tenant_id, user_id, status)
      VALUES
        ($1, $2, $3, 'active'),
        ($4, $2, $5, 'active'),
        ($6, $2, $7, 'active'),
        ($8, $2, $9, 'active'),
        ($10, $2, $11, 'disabled'),
        ($12, $2, $13, 'active'),
        ($14, $15, $16, 'active')
      `,
      [
        internalTenantUser,
        tenantA,
        internalUser,
        unauthorizedInternalTenantUser,
        unauthorizedInternalUser,
        adminTenantUser,
        adminUser,
        foremanTenantUser,
        foremanUser,
        disabledMemberTenantUser,
        disabledMemberUser,
        noRoleTenantUser,
        noRoleUser,
        tenantBTenantUser,
        tenantB,
        tenantBUser,
      ],
    );
    await client.query(
      `
      INSERT INTO roles (id, tenant_id, name, system_key)
      VALUES
        ($1, $2, 'P2 Internal Role Admin', $3),
        ($4, $2, 'P2 Unauthorized Internal', $5),
        ($6, $7, 'P2 Tenant B Partner Admin', 'partner_admin')
      `,
      [internalRole, tenantA, `p2_internal_role_admin_${suffix}`, unauthorizedRole, `p2_unauthorized_${suffix}`, tenantBRole, tenantB],
    );
    await grantPermissions(client, tenantA, internalRole, ["admin.manage_roles", "capacity_provider.read", "capacity_provider.create"]);
    await grantPermissions(client, tenantB, tenantBRole, ["partner_context.read", "partner_profile.read", "partner_actions.read"]);
    await client.query(
      `
      INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
      VALUES
        ($1, $2, $3, 'tenant', $1),
        ($1, $4, $5, 'tenant', $1),
        ($6, $7, $8, 'organization', $9)
      `,
      [tenantA, internalTenantUser, internalRole, unauthorizedInternalTenantUser, unauthorizedRole, tenantB, tenantBTenantUser, tenantBRole, orgTenantB],
    );
    await client.query(
      `
      INSERT INTO organizations (id, tenant_id, name, organization_type, actor_roles, status)
      VALUES
        ($1, $2, 'P2 Partner A', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($3, $2, 'P2 Partner B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($4, $5, 'P2 Partner Tenant B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($6, $2, 'P2 Equipment Provider Only', 'equipment_provider', ARRAY['capacity_provider']::text[], 'active')
      `,
      [orgA, tenantA, orgB, orgTenantB, tenantB, nonPartnerOrg],
    );
    await client.query(
      `
      INSERT INTO capacity_providers (id, tenant_id, organization_id, name, provider_type, status, verification_status, contract_status)
      VALUES
        ($1, $2, $3, 'P2 Provider A', 'subcontractor', 'activated', 'verified', 'contracted'),
        ($4, $2, $5, 'P2 Provider B', 'crew_provider', 'activated', 'verified', 'contracted'),
        ($6, $7, $8, 'P2 Provider Tenant B', 'subcontractor', 'activated', 'verified', 'contracted'),
        (gen_random_uuid(), $2, $9, 'P2 Non Partner Provider', 'equipment_provider', 'activated', 'verified', 'contracted')
      `,
      [providerA, tenantA, orgA, providerB, orgB, providerTenantB, tenantB, orgTenantB, nonPartnerOrg],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return {
    tenantA,
    tenantB,
    orgA,
    orgB,
    orgTenantB,
    nonPartnerOrg,
    providerA,
    providerB,
    providerTenantB,
    adminUser,
    foremanUser,
    disabledMemberUser,
    noRoleUser,
    noRoleTenantUser,
    internalToken: createToken({ sub: internalUser, tenant_id: tenantA }, secret),
    unauthorizedInternalToken: createToken({ sub: unauthorizedInternalUser, tenant_id: tenantA }, secret),
    adminToken: createToken({ sub: adminUser, tenant_id: tenantA }, secret),
    foremanToken: createToken({ sub: foremanUser, tenant_id: tenantA }, secret),
    disabledMemberToken: createToken({ sub: disabledMemberUser, tenant_id: tenantA }, secret),
    noRoleToken: createToken({ sub: noRoleUser, tenant_id: tenantA }, secret),
    tenantBToken: createToken({ sub: tenantBUser, tenant_id: tenantB }, secret),
  };
}

async function ensurePermission(client: Client, key: string) {
  await client.query(
    `
    INSERT INTO permissions (key, name, description)
    VALUES ($1, $1, 'P2 partner persona test permission')
    ON CONFLICT (key) DO NOTHING
    `,
    [key],
  );
}

async function grantPermissions(client: Client, tenantId: string, roleId: string, keys: string[]) {
  for (const key of keys) {
    await client.query(
      `
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT $1, $2, id
      FROM permissions
      WHERE key = $3
      ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [tenantId, roleId, key],
    );
  }
}

async function apiJson(
  request: APIRequestContext,
  token: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const response = await send(request, token, method, path, body, extraHeaders);
  expect(response.status(), `${method} ${path}`).toBeLessThan(400);
  return response.json();
}

async function expectStatus(
  request: APIRequestContext,
  token: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  expected: number,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const response = await send(request, token, method, path, body, extraHeaders);
  expect(response.status(), `${method} ${path}`).toBe(expected);
}

async function send(
  request: APIRequestContext,
  token: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const options = {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    data: body,
  };
  const url = apiUrl(path);
  if (method === "GET") return request.get(url, options);
  if (method === "DELETE") return request.delete(url, options);
  return request.post(url, options);
}

function apiUrl(path: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${path.replace(/^\//, "")}`;
}

function orgScopeHeaders(organizationId: string) {
  return {
    "x-scope-type": "organization",
    "x-scope-id": organizationId,
  };
}

async function eventCounts(client: Client) {
  const result = await client.query<{ events: number; audit_logs: number }>(
    "SELECT (SELECT count(*)::int FROM events) AS events, (SELECT count(*)::int FROM audit_logs) AS audit_logs",
  );
  return result.rows[0];
}

function assertSafeContext(payload: unknown) {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ["ein", "bank", "margin", "internal_rate", "customer_rate", "scorecard", "w9"]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toContain("p2 partner b");
}

function createToken(claims: { sub: string; tenant_id: string }, secret: string): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
