import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

type Seeded = {
  tenantA: string;
  tenantB: string;
  orgA: string;
  orgB: string;
  orgTenantB: string;
  adminToken: string;
  foremanToken: string;
  internalToken: string;
  unauthorizedInternalToken: string;
  tenantBToken: string;
  foremanTenantUser: string;
};

test.describe.serial("P4 Partner crews, workers, credentials, and secure headshots", () => {
  let client: Client;
  let seeded: Seeded;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");

    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedPartnerWorkforceFixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("Partner Admin creates own Workers but cannot cross Partner scope or self-approve", async ({ request }) => {
    const unauthenticated = await request.get(apiUrl("/partner-workforce/me/workers"));
    expect(unauthenticated.status()).toBe(401);

    await expectStatus(request, seeded.adminToken, "POST", "/partner-workforce/me/workers", 403, {
      organization_id: seeded.orgB,
      first_name: "Wrong",
      last_name: "Scope",
    });
    await expectStatus(request, seeded.foremanToken, "POST", "/partner-workforce/me/workers", 403, {
      first_name: "Foreman",
      last_name: "Blocked",
    });

    const worker = await apiJson(request, seeded.adminToken, "POST", "/partner-workforce/me/workers", workerBody("P4", "Worker One"));
    expect(worker.organization_id).toBe(seeded.orgA);
    expect(worker.review_status).toBe("draft");
    expect(JSON.stringify(worker).toLowerCase()).not.toContain("driver_license_number");
    await expectStatus(request, seeded.adminToken, "PATCH", `/partner-workforce/me/workers/${worker.id}`, 400, {
      driver_license_number: "D123456789",
    });
    await expectStatus(request, seeded.adminToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${worker.id}/review`, 403, {
      status: "approved",
    });

    const userLinks = await client.query("SELECT count(*)::int AS count FROM tenant_users WHERE user_id = $1", [worker.id]);
    expect(userLinks.rows[0].count).toBe(0);
  });

  test("Headshot upload stores actual bytes and enforces tenant, Partner, and persona authorization", async ({ request }) => {
    const worker = await createApprovedWorkerWithHeadshot(request, "Headshot", "Owner");
    await expectStatus(request, seeded.adminToken, "POST", `/partner-workforce/me/workers/${worker.id}/headshots`, 400, {
      attestation_accepted: true,
      file_name: "spoof.jpg",
      mime_type: "image/jpeg",
      content_base64: pngBase64(),
      storage_key: "tenant/org/spoof.jpg",
    });
    await expectStatus(request, seeded.adminToken, "POST", `/partner-workforce/me/workers/${worker.id}/headshots`, 400, {
      attestation_accepted: true,
      file_name: "bad.svg",
      mime_type: "image/svg+xml",
      content_base64: Buffer.from("<svg></svg>").toString("base64"),
    });

    const headshot = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/workers/${worker.id}/headshots`, {
      attestation_accepted: true,
      file_name: "../current-headshot.png",
      mime_type: "image/png",
      content_base64: pngBase64(),
    });
    expect(headshot.file.file_name).toBe("current-headshot.png");
    expect(headshot.file.storage_key).toBeUndefined();
    const stored = await client.query("SELECT storage_key, checksum, size_bytes FROM partner_restricted_file_objects WHERE id = $1", [headshot.file_object_id]);
    expect(stored.rows[0].storage_key).toContain(`${seeded.tenantA}/${seeded.orgA}/`);
    expect(Number(stored.rows[0].size_bytes)).toBeGreaterThan(0);

    await expectStatus(request, seeded.tenantBToken, "GET", `/partner-workforce/me/workers/${worker.id}/headshots/${headshot.id}/bytes`, 404);
    await expectStatus(request, seeded.foremanToken, "GET", `/partner-workforce/foreman/headshots/${headshot.id}/bytes`, 403);
    await apiJson(request, seeded.internalToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${worker.id}/headshots/${headshot.id}/review`, { status: "approved" });

    const ownBytes = await apiJson(request, seeded.adminToken, "GET", `/partner-workforce/me/workers/${worker.id}/headshots/${headshot.id}/bytes`);
    expect(ownBytes.content_base64).toBeTruthy();
    expect(ownBytes.storage_key).toBeUndefined();
    expect(ownBytes.public_url).toBeUndefined();
  });

  test("Credentials are Partner-scoped, review-only internally, and readiness blocks on unverified or expired required credentials", async ({ request }) => {
    const worker = await createReadyWorker(request, "Credential", "Worker");
    const credential = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/workers/${worker.id}/credentials`, {
      credential_type: "driver_license",
      credential_identifier_last_four: "A123",
      expiration_date: "2027-08-01",
      required: true,
      evidence: pdfEvidence("driver-license.pdf"),
    });
    expect(credential.status).toBe("submitted");
    expect(JSON.stringify(credential)).not.toContain("storage_key");
    await expectStatus(request, seeded.foremanToken, "GET", `/partner-workforce/me/workers/${worker.id}/credentials`, 403);
    await expectStatus(request, seeded.adminToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${worker.id}/credentials/${credential.id}/review`, 403, { status: "verified" });
    let readiness = await apiJson(request, seeded.adminToken, "GET", `/partner-workforce/me/workers/${worker.id}/readiness`);
    expect(readiness.blockers.map((blocker: { key: string }) => blocker.key)).toContain("worker_credential_unverified");

    await apiJson(request, seeded.internalToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${worker.id}/credentials/${credential.id}/review`, { status: "verified" });
    readiness = await apiJson(request, seeded.adminToken, "GET", `/partner-workforce/me/workers/${worker.id}/readiness`);
    expect(readiness.status).toBe("ready");

    const expired = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/workers/${worker.id}/credentials`, {
      credential_type: "driver_license",
      credential_identifier_last_four: "A123",
      expiration_date: "2025-01-01",
      required: true,
      evidence: pdfEvidence("expired-license.pdf"),
    });
    await apiJson(request, seeded.internalToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${worker.id}/credentials/${expired.id}/review`, { status: "verified" });
    readiness = await apiJson(request, seeded.adminToken, "GET", `/partner-workforce/me/workers/${worker.id}/readiness`);
    expect(readiness.blockers.map((blocker: { key: string }) => blocker.key)).toContain("worker_credential_expired");
  });

  test("Crews preserve membership history, foreman links gate Foreman roster/headshot access, and readiness is derived", async ({ request }) => {
    const workers = [];
    for (const [first, last] of [["Ready", "One"], ["Ready", "Two"], ["Ready", "Three"], ["Ready", "Four"]] as const) {
      workers.push(await createReadyWorker(request, first, last));
    }
    const crew = await apiJson(request, seeded.adminToken, "POST", "/partner-workforce/me/crews", {
      name: "P4 Aerial Crew",
      crew_type: "aerial",
      target_staffing_level: 4,
    });
    const memberships = [];
    for (const worker of workers) {
      memberships.push(await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/crews/${crew.id}/members`, { worker_id: worker.id }));
    }
    const duplicateMembership = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/crews/${crew.id}/members`, { worker_id: workers[0].id });
    expect(duplicateMembership.id).toBe(memberships[0].id);
    const foremanAssignment = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/crews/${crew.id}/foreman`, { worker_id: workers[0].id });
    expect(foremanAssignment.membership_role).toBe("foreman");
    const alternateAssignment = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/crews/${crew.id}/alternate-foreman`, { worker_id: workers[1].id });
    expect(alternateAssignment.membership_role).toBe("alternate_foreman");
    await expectStatus(request, seeded.adminToken, "POST", `/partner-workforce/me/crews/${crew.id}/foreman`, 404, { worker_id: crypto.randomUUID() });

    await client.query(
      "INSERT INTO partner_worker_user_links (tenant_id, organization_id, worker_id, tenant_user_id) VALUES ($1, $2, $3, $4)",
      [seeded.tenantA, seeded.orgA, workers[0].id, seeded.foremanTenantUser],
    );
    const foremanRoster = await apiJson(request, seeded.foremanToken, "GET", "/partner-workforce/foreman/crew/roster");
    expect(foremanRoster).toHaveLength(4);
    expect(JSON.stringify(foremanRoster).toLowerCase()).not.toContain("emergency_contact");

    const headshotId = foremanRoster[0].current_headshot_id;
    const foremanBytes = await apiJson(request, seeded.foremanToken, "GET", `/partner-workforce/foreman/headshots/${headshotId}/bytes`);
    expect(foremanBytes.content_base64).toBeTruthy();
    const endedMembership = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/crews/${crew.id}/members/${memberships[3].id}/end`, { ended_reason: "rotation" });
    expect(endedMembership.status).toBe("ended");
    const history = await client.query("SELECT status FROM partner_crew_memberships WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 ORDER BY created_at", [seeded.tenantA, seeded.orgA, workers[3].id]);
    expect(history.rows.map((row) => row.status)).toContain("ended");
    const blocked = await apiJson(request, seeded.adminToken, "GET", `/partner-workforce/me/crews/${crew.id}/readiness`);
    expect(blocked.blockers.map((blocker: { key: string }) => blocker.key)).toContain("crew_staffing_incomplete");
  });

  test("events and audit payloads omit restricted PII and file storage details", async ({ request }) => {
    const before = await eventCounts(client);
    const worker = await createReadyWorker(request, "Audit", "Safe");
    const after = await eventCounts(client);
    expect(after.events).toBeGreaterThan(before.events);
    expect(after.audit_logs).toBeGreaterThan(before.audit_logs);
    const leaks = await client.query(
      `
      SELECT count(*)::int AS count
      FROM event_payloads ep
      WHERE ep.payload::text ILIKE '%driver_license_number%'
         OR ep.payload::text ILIKE '%emergency_contact_phone%'
         OR ep.payload::text ILIKE '%storage_key%'
         OR ep.payload::text ILIKE '%content_base64%'
      `,
    );
    expect(leaks.rows[0].count).toBe(0);
    expect(worker.id).toBeTruthy();
  });

  async function createApprovedWorkerWithHeadshot(request: APIRequestContext, first: string, last: string) {
    const worker = await apiJson(request, seeded.adminToken, "POST", "/partner-workforce/me/workers", workerBody(first, last));
    await apiJson(request, seeded.internalToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${worker.id}/review`, { status: "approved" });
    return worker;
  }

  async function createReadyWorker(request: APIRequestContext, first: string, last: string) {
    const worker = await createApprovedWorkerWithHeadshot(request, first, last);
    const headshot = await apiJson(request, seeded.adminToken, "POST", `/partner-workforce/me/workers/${worker.id}/headshots`, {
      attestation_accepted: true,
      file_name: `${first}-${last}.png`,
      mime_type: "image/png",
      content_base64: pngBase64(),
    });
    await apiJson(request, seeded.internalToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${worker.id}/headshots/${headshot.id}/review`, { status: "approved" });
    return worker;
  }
});

async function seedPartnerWorkforceFixture(client: Client, secret: string): Promise<Seeded> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const orgTenantB = crypto.randomUUID();
  const providerA = crypto.randomUUID();
  const providerB = crypto.randomUUID();
  const providerTenantB = crypto.randomUUID();
  const adminUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const unauthorizedInternalUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const adminTenantUser = crypto.randomUUID();
  const foremanTenantUser = crypto.randomUUID();
  const internalTenantUser = crypto.randomUUID();
  const unauthorizedTenantUser = crypto.randomUUID();
  const tenantBTenantUser = crypto.randomUUID();
  const adminRole = crypto.randomUUID();
  const foremanRole = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const unauthorizedRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();

  const adminPermissions = [
    "partner_context.read",
    "partner_actions.read",
    "partner_workforce.worker.read",
    "partner_workforce.worker.create",
    "partner_workforce.worker.update",
    "partner_workforce.worker.submit",
    "partner_workforce.headshot.read",
    "partner_workforce.headshot.submit",
    "partner_workforce.credential.read",
    "partner_workforce.credential.submit",
    "partner_workforce.crew.read",
    "partner_workforce.crew.create",
    "partner_workforce.crew.update",
    "partner_workforce.membership.manage",
    "partner_workforce.foreman.assign",
    "partner_workforce.readiness.read",
    "partner_workforce.attestation.submit",
  ];
  const foremanPermissions = ["partner_context.read", "partner_actions.read", "partner_workforce.foreman_roster.read"];

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)", [
      tenantA,
      "P4 Partner Workforce Tenant A",
      `p4-workforce-a-${suffix}`,
      tenantB,
      "P4 Partner Workforce Tenant B",
      `p4-workforce-b-${suffix}`,
    ]);
    for (const permission of [...adminPermissions, ...foremanPermissions, "partner_workforce.review", "partner_workforce.evidence.review"]) {
      await ensurePermission(client, permission);
    }
    await client.query(
      `
      INSERT INTO users (id, email, display_name)
      VALUES
        ($1, $2, 'P4 Partner Admin'),
        ($3, $4, 'P4 Partner Foreman'),
        ($5, $6, 'P4 Internal Reviewer'),
        ($7, $8, 'P4 Unauthorized Internal'),
        ($9, $10, 'P4 Tenant B Partner')
      `,
      [
        adminUser,
        `p4-admin-${suffix}@syncos.test`,
        foremanUser,
        `p4-foreman-${suffix}@syncos.test`,
        internalUser,
        `p4-internal-${suffix}@syncos.test`,
        unauthorizedInternalUser,
        `p4-unauthorized-${suffix}@syncos.test`,
        tenantBUser,
        `p4-tenant-b-${suffix}@syncos.test`,
      ],
    );
    await client.query(
      `
      INSERT INTO tenant_users (id, tenant_id, user_id)
      VALUES
        ($1, $2, $3),
        ($4, $2, $5),
        ($6, $2, $7),
        ($8, $2, $9),
        ($10, $11, $12)
      `,
      [adminTenantUser, tenantA, adminUser, foremanTenantUser, foremanUser, internalTenantUser, internalUser, unauthorizedTenantUser, unauthorizedInternalUser, tenantBTenantUser, tenantB, tenantBUser],
    );
    await client.query(
      `
      INSERT INTO roles (id, tenant_id, name, system_key)
      VALUES
        ($1, $2, 'P4 Partner Admin', 'partner_admin'),
        ($3, $2, 'P4 Partner Foreman', 'partner_foreman'),
        ($4, $2, 'P4 Internal Workforce Reviewer', $5),
        ($6, $2, 'P4 Unauthorized Internal', $7),
        ($8, $9, 'P4 Tenant B Partner Admin', 'partner_admin')
      `,
      [adminRole, tenantA, foremanRole, internalRole, `p4_internal_reviewer_${suffix}`, unauthorizedRole, `p4_unauthorized_${suffix}`, tenantBRole, tenantB],
    );
    await grantPermissions(client, tenantA, adminRole, adminPermissions);
    await grantPermissions(client, tenantA, foremanRole, foremanPermissions);
    await grantPermissions(client, tenantA, internalRole, ["partner_workforce.review", "partner_workforce.evidence.review"]);
    await grantPermissions(client, tenantB, tenantBRole, adminPermissions);
    await client.query(
      `
      INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
      VALUES
        ($1, $2, $3, 'organization', $4),
        ($1, $5, $6, 'organization', $4),
        ($1, $7, $8, 'tenant', $1),
        ($1, $9, $10, 'tenant', $1),
        ($11, $12, $13, 'organization', $14)
      `,
      [tenantA, adminTenantUser, adminRole, orgA, foremanTenantUser, foremanRole, internalTenantUser, internalRole, unauthorizedTenantUser, unauthorizedRole, tenantB, tenantBTenantUser, tenantBRole, orgTenantB],
    );
    await client.query(
      `
      INSERT INTO organizations (id, tenant_id, name, organization_type, actor_roles, status)
      VALUES
        ($1, $2, 'P4 Partner A', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($3, $2, 'P4 Partner B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($4, $5, 'P4 Partner Tenant B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active')
      `,
      [orgA, tenantA, orgB, orgTenantB, tenantB],
    );
    await client.query(
      `
      INSERT INTO capacity_providers (id, tenant_id, organization_id, name, provider_type, status, verification_status, contract_status)
      VALUES
        ($1, $2, $3, 'P4 Provider A', 'subcontractor', 'activated', 'verified', 'contracted'),
        ($4, $2, $5, 'P4 Provider B', 'crew_provider', 'activated', 'verified', 'contracted'),
        ($6, $7, $8, 'P4 Provider Tenant B', 'subcontractor', 'activated', 'verified', 'contracted')
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
    adminToken: createToken({ sub: adminUser, tenant_id: tenantA }, secret),
    foremanToken: createToken({ sub: foremanUser, tenant_id: tenantA }, secret),
    internalToken: createToken({ sub: internalUser, tenant_id: tenantA }, secret),
    unauthorizedInternalToken: createToken({ sub: unauthorizedInternalUser, tenant_id: tenantA }, secret),
    tenantBToken: createToken({ sub: tenantBUser, tenant_id: tenantB }, secret),
    foremanTenantUser,
  };
}

function workerBody(first_name: string, last_name: string) {
  return {
    first_name,
    last_name,
    worker_role: "aerial_operator",
    display_name: `${first_name} ${last_name}`,
    mobile_phone: "404-555-0100",
    emergency_contact_name: "Synthetic Contact",
    emergency_contact_phone: "404-555-0199",
    driver_operator_status: "not_driver",
    aerial_experience_years: 4,
  };
}

function pngBase64() {
  return Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea73581e40000000049454e44ae426082", "hex").toString("base64");
}

function pdfEvidence(file_name: string) {
  return {
    file_name,
    mime_type: "application/pdf",
    content_base64: Buffer.from("%PDF-1.4\n% synthetic credential evidence\n").toString("base64"),
  };
}

async function ensurePermission(client: Client, key: string) {
  await client.query(
    `
    INSERT INTO permissions (key, name, description)
    VALUES ($1, $1, 'P4 partner workforce test permission')
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
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const response = await send(request, token, method, path, body, extraHeaders);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(400);
  return response.json();
}

async function expectStatus(
  request: APIRequestContext,
  token: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  expected: number,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const response = await send(request, token, method, path, body, extraHeaders);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(expected);
}

function send(
  request: APIRequestContext,
  token: string,
  method: "GET" | "POST" | "PATCH",
  route: string,
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
  const url = apiUrl(route);
  if (method === "GET") return request.get(url, options);
  if (method === "PATCH") return request.patch(url, options);
  return request.post(url, options);
}

function apiUrl(route: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${route.replace(/^\//, "")}`;
}

async function eventCounts(client: Client) {
  const result = await client.query<{ events: number; audit_logs: number }>(
    "SELECT (SELECT count(*)::int FROM events) AS events, (SELECT count(*)::int FROM audit_logs) AS audit_logs",
  );
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
