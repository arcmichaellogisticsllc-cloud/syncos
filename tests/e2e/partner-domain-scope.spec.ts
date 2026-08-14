import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Seeded = {
  tenantA: string;
  tenantB: string;
  orgA: string;
  orgB: string;
  orgTenantB: string;
  providerA: string;
  providerB: string;
  providerTenantB: string;
  orgClassify: string;
  orgConcurrent: string;
  scopedToken: string;
  internalToken: string;
  unauthorizedToken: string;
  tenantBToken: string;
};

test.describe.serial("P1 Partner domain organization scope", () => {
  let client: Client;
  let seeded: Seeded;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");

    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedPartnerScopeFixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("organization-scoped list and detail are limited to the scoped Partner Organization", async ({ request }) => {
    const list = await apiJson(request, seeded.scopedToken, "GET", "/partner-domain/organizations", undefined, orgScopeHeaders(seeded.orgA));
    expect(list.map((row: { id: string }) => row.id)).toEqual([seeded.orgA]);

    const own = await apiJson(request, seeded.scopedToken, "GET", `/partner-domain/organizations/${seeded.orgA}`, undefined, orgScopeHeaders(seeded.orgA));
    expect(own.id).toBe(seeded.orgA);

    await expectStatus(request, seeded.scopedToken, "GET", `/partner-domain/organizations/${seeded.orgB}`, 404, undefined, orgScopeHeaders(seeded.orgA));
    await expectStatus(request, seeded.scopedToken, "GET", `/partner-domain/organizations/${seeded.orgTenantB}`, 404, undefined, orgScopeHeaders(seeded.orgA));
  });

  test("organization-scoped mutations revalidate scope server-side", async ({ request }) => {
    const before = await eventCounts(client);
    await expectStatus(request, seeded.scopedToken, "POST", `/partner-domain/organizations/${seeded.orgB}/classify`, 404, {
      provider_type: "subcontractor",
    }, orgScopeHeaders(seeded.orgA));
    await expectStatus(request, seeded.scopedToken, "POST", `/partner-domain/organizations/${seeded.orgTenantB}/classify`, 404, {
      provider_type: "subcontractor",
    }, orgScopeHeaders(seeded.orgA));
    await expectStatus(request, seeded.scopedToken, "POST", `/partner-domain/organizations/${seeded.orgA}/classify`, 201, {
      provider_type: "subcontractor",
      reason: "P1 scoped mutation test",
    }, orgScopeHeaders(seeded.orgA));
    const after = await eventCounts(client);
    expect(after.events).toBe(before.events);
    expect(after.audit_logs).toBe(before.audit_logs);
  });

  test("guessed capacity provider and mismatched child records are denied", async ({ request }) => {
    await expectStatus(
      request,
      seeded.scopedToken,
      "GET",
      `/partner-domain/organizations/${seeded.orgA}/capacity-providers/${seeded.providerB}`,
      404,
      undefined,
      orgScopeHeaders(seeded.orgA),
    );
    await expectStatus(
      request,
      seeded.scopedToken,
      "GET",
      `/partner-domain/organizations/${seeded.orgA}/capacity-providers/${seeded.providerTenantB}`,
      404,
      undefined,
      orgScopeHeaders(seeded.orgA),
    );
    await expectStatus(
      request,
      seeded.scopedToken,
      "GET",
      `/partner-domain/organizations/${seeded.orgTenantB}/capacity-providers/${seeded.providerTenantB}`,
      404,
      undefined,
      orgScopeHeaders(seeded.orgA),
    );
  });

  test("client-supplied scope inputs cannot broaden access", async ({ request }) => {
    await expectStatus(
      request,
      seeded.scopedToken,
      "GET",
      `/partner-domain/organizations/${seeded.orgB}?organization_id=${seeded.orgA}`,
      404,
      undefined,
      orgScopeHeaders(seeded.orgA),
    );
    await expectStatus(request, seeded.scopedToken, "GET", `/partner-domain/organizations/${seeded.orgB}`, 403, undefined, {
      "x-scope-type": "organization",
      "x-scope-id": seeded.orgB,
    });
    await expectStatus(request, seeded.scopedToken, "POST", `/partner-domain/organizations/${seeded.orgB}/classify`, 404, {
      organization_id: seeded.orgA,
      provider_type: "subcontractor",
    }, orgScopeHeaders(seeded.orgA));
  });

  test("tenant-scoped internal access still works and unauthorized internal roles stay denied", async ({ request }) => {
    const internalList = await apiJson(request, seeded.internalToken, "GET", "/partner-domain/organizations");
    expect(internalList.map((row: { id: string }) => row.id).sort()).toEqual([seeded.orgA, seeded.orgB].sort());

    await expectStatus(request, seeded.internalToken, "GET", "/capacity-providers", 200);
    await expectStatus(request, seeded.internalToken, "POST", `/partner-domain/organizations/${seeded.orgClassify}/classify`, 201, {
      provider_type: "crew_provider",
      reason: "P1 internal classification test",
    });
    await expectStatus(request, seeded.unauthorizedToken, "GET", "/partner-domain/organizations", 403);
  });

  test("cross-tenant Partner Organization access is denied", async ({ request }) => {
    const tenantBList = await apiJson(request, seeded.tenantBToken, "GET", "/partner-domain/organizations");
    expect(tenantBList.map((row: { id: string }) => row.id)).toEqual([seeded.orgTenantB]);

    await expectStatus(request, seeded.tenantBToken, "GET", `/partner-domain/organizations/${seeded.orgA}`, 404);
    await expectStatus(request, seeded.scopedToken, "GET", `/partner-domain/organizations/${seeded.orgTenantB}`, 404, undefined, orgScopeHeaders(seeded.orgA));
  });

  test("classification is provider-type constrained, idempotent, and audited only for creation", async ({ request }) => {
    await expectStatus(request, seeded.internalToken, "POST", `/partner-domain/organizations/${seeded.orgClassify}/classify`, 400, {
      provider_type: "equipment_provider",
    });

    const before = await eventCounts(client);
    const first = await apiJson(request, seeded.internalToken, "POST", `/partner-domain/organizations/${seeded.orgClassify}/classify`, {
      provider_type: "subcontractor",
      reason: "P1 idempotency first create",
    });
    expect(first.reused_existing_linkage).toBe(false);
    expect(first.tenant_id).toBe(seeded.tenantA);
    expect(first.organization_id).toBe(seeded.orgClassify);
    expect(first.capacity_provider_id).toBeTruthy();
    const afterFirst = await eventCounts(client);
    expect(afterFirst.events).toBe(before.events + 1);
    expect(afterFirst.audit_logs).toBe(before.audit_logs + 1);

    const event = await latestClassificationEvent(client, seeded.tenantA, seeded.orgClassify);
    expect(event.actor_user_id).toBeTruthy();
    expect(event.payload.tenant_id).toBe(seeded.tenantA);
    expect(event.payload.organization_id).toBe(seeded.orgClassify);
    expect(event.payload.capacity_provider_id).toBe(first.capacity_provider_id);

    const second = await apiJson(request, seeded.internalToken, "POST", `/partner-domain/organizations/${seeded.orgClassify}/classify`, {
      provider_type: "subcontractor",
      reason: "P1 idempotency repeat",
    });
    expect(second.reused_existing_linkage).toBe(true);
    expect(second.capacity_provider_id).toBe(first.capacity_provider_id);
    const afterSecond = await eventCounts(client);
    expect(afterSecond.events).toBe(afterFirst.events);
    expect(afterSecond.audit_logs).toBe(afterFirst.audit_logs);

    expect(await activeProviderCount(client, seeded.tenantA, seeded.orgClassify, "subcontractor")).toBe(1);
  });

  test("near-concurrent classification does not create duplicate active linkage", async ({ request }) => {
    const [left, right] = await Promise.all([
      send(request, seeded.internalToken, "POST", `/partner-domain/organizations/${seeded.orgConcurrent}/classify`, {
        provider_type: "subcontractor",
      }),
      send(request, seeded.internalToken, "POST", `/partner-domain/organizations/${seeded.orgConcurrent}/classify`, {
        provider_type: "subcontractor",
      }),
    ]);
    expect(left.status(), "left concurrent classify").toBeLessThan(400);
    expect(right.status(), "right concurrent classify").toBeLessThan(400);
    expect(await activeProviderCount(client, seeded.tenantA, seeded.orgConcurrent, "subcontractor")).toBe(1);
  });
});

async function seedPartnerScopeFixture(client: Client, secret: string): Promise<Seeded> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const orgTenantB = crypto.randomUUID();
  const orgClassify = crypto.randomUUID();
  const orgConcurrent = crypto.randomUUID();
  const providerA = crypto.randomUUID();
  const providerB = crypto.randomUUID();
  const providerTenantB = crypto.randomUUID();
  const scopedUser = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const unauthorizedUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const scopedTenantUser = crypto.randomUUID();
  const internalTenantUser = crypto.randomUUID();
  const unauthorizedTenantUser = crypto.randomUUID();
  const tenantBTenantUser = crypto.randomUUID();
  const scopedRole = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const unauthorizedRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)", [
      tenantA,
      "P1 Partner Scope Tenant A",
      `p1-partner-scope-a-${suffix}`,
      tenantB,
      "P1 Partner Scope Tenant B",
      `p1-partner-scope-b-${suffix}`,
    ]);
    await ensurePermission(client, "capacity_provider.read");
    await ensurePermission(client, "capacity_provider.create");
    await client.query(
      `
      INSERT INTO users (id, email, display_name)
      VALUES
        ($1, $2, 'P1 Scoped Partner Actor'),
        ($3, $4, 'P1 Internal Capacity Actor'),
        ($5, $6, 'P1 Unauthorized Actor'),
        ($7, $8, 'P1 Tenant B Actor')
      `,
      [
        scopedUser,
        `p1-scoped-${suffix}@syncos.test`,
        internalUser,
        `p1-internal-${suffix}@syncos.test`,
        unauthorizedUser,
        `p1-unauthorized-${suffix}@syncos.test`,
        tenantBUser,
        `p1-tenant-b-${suffix}@syncos.test`,
      ],
    );
    await client.query(
      `
      INSERT INTO tenant_users (id, tenant_id, user_id)
      VALUES
        ($1, $2, $3),
        ($4, $2, $5),
        ($6, $2, $7),
        ($8, $9, $10)
      `,
      [scopedTenantUser, tenantA, scopedUser, internalTenantUser, internalUser, unauthorizedTenantUser, unauthorizedUser, tenantBTenantUser, tenantB, tenantBUser],
    );
    await client.query(
      `
      INSERT INTO roles (id, tenant_id, name, system_key)
      VALUES
        ($1, $2, 'P1 Scoped Capacity Reader', $3),
        ($4, $2, 'P1 Internal Capacity Manager', $5),
        ($6, $2, 'P1 Unauthorized', $7),
        ($8, $9, 'P1 Tenant B Capacity Reader', $10)
      `,
      [
        scopedRole,
        tenantA,
        `p1_scoped_${suffix}`,
        internalRole,
        `p1_internal_${suffix}`,
        unauthorizedRole,
        `p1_unauthorized_${suffix}`,
        tenantBRole,
        tenantB,
        `p1_tenant_b_${suffix}`,
      ],
    );
    await grantPermissions(client, tenantA, scopedRole, ["capacity_provider.read", "capacity_provider.create"]);
    await grantPermissions(client, tenantA, internalRole, ["capacity_provider.read", "capacity_provider.create"]);
    await grantPermissions(client, tenantB, tenantBRole, ["capacity_provider.read"]);
    await client.query(
      `
      INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
      VALUES
        ($1, $2, $3, 'organization', $4),
        ($1, $5, $6, 'tenant', $1),
        ($1, $7, $8, 'tenant', $1),
        ($9, $10, $11, 'tenant', $9)
      `,
      [tenantA, scopedTenantUser, scopedRole, orgA, internalTenantUser, internalRole, unauthorizedTenantUser, unauthorizedRole, tenantB, tenantBTenantUser, tenantBRole],
    );
    await client.query(
      `
      INSERT INTO organizations (id, tenant_id, name, organization_type, actor_roles, status)
      VALUES
        ($1, $2, 'P1 Partner A', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($3, $2, 'P1 Partner B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($4, $5, 'P1 Partner Tenant B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($6, $2, 'P1 Partner Classify Target', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($7, $2, 'P1 Partner Concurrent Target', 'subcontractor', ARRAY['capacity_provider']::text[], 'active')
      `,
      [orgA, tenantA, orgB, orgTenantB, tenantB, orgClassify, orgConcurrent],
    );
    await client.query(
      `
      INSERT INTO capacity_providers (id, tenant_id, organization_id, name, provider_type, status, verification_status, contract_status)
      VALUES
        ($1, $2, $3, 'P1 Provider A', 'subcontractor', 'prospect', 'prospect', 'not_started'),
        ($4, $2, $5, 'P1 Provider B', 'subcontractor', 'prospect', 'prospect', 'not_started'),
        ($6, $7, $8, 'P1 Provider Tenant B', 'subcontractor', 'prospect', 'prospect', 'not_started')
      `,
      [providerA, tenantA, orgA, providerB, orgB, providerTenantB, tenantB, orgTenantB],
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
    providerA,
    providerB,
    providerTenantB,
    orgClassify,
    orgConcurrent,
    scopedToken: createToken({ sub: scopedUser, tenant_id: tenantA }, secret),
    internalToken: createToken({ sub: internalUser, tenant_id: tenantA }, secret),
    unauthorizedToken: createToken({ sub: unauthorizedUser, tenant_id: tenantA }, secret),
    tenantBToken: createToken({ sub: tenantBUser, tenant_id: tenantB }, secret),
  };
}

async function ensurePermission(client: Client, key: string) {
  await client.query(
    `
    INSERT INTO permissions (key, name, description)
    VALUES ($1, $1, 'P1 partner scope test permission')
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
  method: "GET" | "POST",
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
  method: "GET" | "POST",
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
  method: "GET" | "POST",
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
  return method === "GET" ? request.get(url, options) : request.post(url, options);
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

async function activeProviderCount(client: Client, tenantId: string, organizationId: string, providerType: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `
    SELECT count(*)::int AS count
    FROM capacity_providers
    WHERE tenant_id = $1
      AND organization_id = $2
      AND provider_type = $3
      AND status <> 'archived'
      AND deleted_at IS NULL
    `,
    [tenantId, organizationId, providerType],
  );
  return result.rows[0].count;
}

async function latestClassificationEvent(client: Client, tenantId: string, organizationId: string) {
  const result = await client.query<{
    actor_user_id: string;
    payload: {
      tenant_id: string;
      organization_id: string;
      capacity_provider_id: string;
    };
  }>(
    `
    SELECT e.actor_user_id, ep.payload
    FROM events e
    JOIN event_payloads ep ON ep.event_id = e.id
    WHERE e.tenant_id = $1
      AND e.aggregate_id = $2
      AND e.event_type = 'partner_classification.created'
    ORDER BY e.created_at DESC
    LIMIT 1
    `,
    [tenantId, organizationId],
  );
  expect(result.rows[0]).toBeTruthy();
  return result.rows[0];
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
