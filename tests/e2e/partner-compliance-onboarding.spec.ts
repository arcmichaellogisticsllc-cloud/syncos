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
};

test.describe.serial("P3 Partner compliance onboarding foundation", () => {
  let client: Client;
  let seeded: Seeded;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");

    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedPartnerComplianceFixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("empty Partner compliance summary is organization scoped and Foreman safe", async ({ request }) => {
    const unauthenticated = await request.get(apiUrl("/partner-compliance/me/summary"));
    expect(unauthenticated.status()).toBe(401);

    const summary = await apiJson(request, seeded.adminToken, "GET", "/partner-compliance/me/summary");
    expect(summary.organization_id).toBe(seeded.orgA);
    expect(summary.overall_status).toBe("not_started");
    expect(summary.blockers.map((blocker: { key: string }) => blocker.key)).toEqual(
      expect.arrayContaining(["company_profile_missing", "w9_missing", "payment_profile_incomplete", "required_policy_missing"]),
    );

    const foreman = await apiJson(request, seeded.foremanToken, "GET", "/partner-compliance/me/summary");
    expect(foreman.organization_id).toBe(seeded.orgA);
    expect(foreman.blocker_categories).toContain("w9");
    expect(JSON.stringify(foreman).toLowerCase()).not.toContain("tin");
    await expectStatus(request, seeded.foremanToken, "GET", "/partner-compliance/me/w9", 403);
    await expectStatus(request, seeded.foremanToken, "GET", "/partner-compliance/me/payment-profile", 403);
  });

  test("Partner Admin submits own profile, W-9, payment readiness, and insurance without broadening scope", async ({ request }) => {
    await expectStatus(request, seeded.adminToken, "POST", "/partner-compliance/me/company-profile", 403, {
      organization_id: seeded.orgB,
      legal_business_name: "Wrong Scope LLC",
    });
    await expectStatus(request, seeded.adminToken, "GET", `/partner-compliance/me/summary?organization_id=${seeded.orgB}`, 403);

    const profile = await apiJson(request, seeded.adminToken, "POST", "/partner-compliance/me/company-profile", {
      legal_business_name: "P3 Partner A LLC",
      dba_name: "P3 Partner A",
      state_of_formation: "GA",
      entity_type: "llc",
      business_address: { line1: "2750 Holcomb Bridge Rd", city: "Alpharetta", state: "GA", postal_code: "30022" },
      primary_business_phone: "404.272.8065",
      primary_business_email: "ops-p3-a@syncos.test",
      primary_contact_name: "P3 Admin",
      settlement_contact_email: "settlement-p3-a@syncos.test",
      compliance_contact_email: "compliance-p3-a@syncos.test",
    });
    expect(profile.organization_id).toBe(seeded.orgA);
    expect(profile.status).toBe("submitted");

    await expectStatus(request, seeded.adminToken, "POST", "/partner-compliance/me/w9", 400, {
      legal_name_on_w9: "P3 Partner A LLC",
      federal_tax_classification: "llc",
      tin_type: "ein",
      tin: "123456789",
      tin_last_four: "6789",
    });
    const w9 = await apiJson(request, seeded.adminToken, "POST", "/partner-compliance/me/w9", {
      legal_name_on_w9: "P3 Partner A LLC",
      federal_tax_classification: "llc",
      tin_type: "ein",
      tin_last_four: "6789",
      signed_date: "2026-08-15",
      evidence: evidence("partner-a-w9.pdf", "w9-checksum"),
    });
    expect(w9.tin_last_four).toBe("6789");
    expect(JSON.stringify(w9)).not.toContain("123456789");
    await expectStatus(request, seeded.adminToken, "POST", "/partner-compliance/me/w9", 400, {
      legal_name_on_w9: "P3 Partner A LLC",
      federal_tax_classification: "llc",
      tin_type: "ein",
      tin_last_four: "6789",
      evidence: { ...evidence("partner-a-public-url.pdf", "storage-checksum"), object_key: "partner/a/w9.pdf" },
    });

    await expectStatus(request, seeded.adminToken, "POST", "/partner-compliance/me/payment-profile", 400, {
      priority_passport_status: "pending",
      routing_number: "123456789",
      account_last_four: "4321",
    });
    const payment = await apiJson(request, seeded.adminToken, "POST", "/partner-compliance/me/payment-profile", {
      priority_passport_status: "pending",
      provider_reference: "pp-p3-a",
      account_last_four: "4321",
      enrollment_contact_email: "payments-p3-a@syncos.test",
      backup_ach_status: "submitted",
      bank_display_name: "Example Bank",
      account_type: "business_checking",
      ach_evidence: evidence("partner-a-ach.pdf", "ach-checksum"),
    });
    expect(payment.account_last_four).toBe("4321");
    expect(JSON.stringify(payment).toLowerCase()).not.toContain("routing");

    for (const policy of completePolicySet()) {
      const inserted = await apiJson(request, seeded.adminToken, "POST", "/partner-compliance/me/insurance-policies", policy);
      expect(inserted.policy_type).toBe(policy.policy_type);
      expect(inserted.status).toBe("submitted");
    }
    await expectStatus(request, seeded.adminToken, "POST", `/partner-compliance/organizations/${seeded.orgA}/company-profile/review`, 403, {
      status: "verified",
    });
  });

  test("restricted evidence is never public and remains tenant and Partner scoped", async ({ request }) => {
    const w9 = await apiJson(request, seeded.adminToken, "GET", "/partner-compliance/me/w9");
    const evidenceRecord = await apiJson(request, seeded.adminToken, "GET", `/partner-compliance/me/evidence/${w9.evidence_id}`);
    expect(evidenceRecord.organization_id).toBe(seeded.orgA);
    expect(evidenceRecord.raw_url).toBeUndefined();
    expect(evidenceRecord.object_key).toBeUndefined();
    expect(evidenceRecord.restricted).toBe(true);

    await expectStatus(request, seeded.foremanToken, "GET", `/partner-compliance/me/evidence/${w9.evidence_id}`, 403);
    await expectStatus(request, seeded.tenantBToken, "GET", `/partner-compliance/me/evidence/${w9.evidence_id}`, 404);
    await expectStatus(request, seeded.unauthorizedInternalToken, "GET", `/partner-compliance/organizations/${seeded.orgA}/evidence/${w9.evidence_id}`, 403);

    const internalEvidence = await apiJson(request, seeded.internalToken, "GET", `/partner-compliance/organizations/${seeded.orgA}/evidence/${w9.evidence_id}`);
    expect(internalEvidence.storage_reference_available).toBe(false);
    expect(internalEvidence.raw_url).toBeUndefined();
  });

  test("internal reviewer verifies records, Partner users cannot self-approve, and compliance becomes ready", async ({ request }) => {
    const before = await eventCounts(client);
    const company = await apiJson(request, seeded.internalToken, "POST", `/partner-compliance/organizations/${seeded.orgA}/company-profile/review`, {
      status: "verified",
      external_return_reason: "complete",
      internal_review_notes: "reviewed by compliance",
    });
    expect(company.status).toBe("verified");
    expect(JSON.stringify(company)).not.toContain("reviewed by compliance");
    await apiJson(request, seeded.internalToken, "POST", `/partner-compliance/organizations/${seeded.orgA}/w9/review`, { status: "verified" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-compliance/organizations/${seeded.orgA}/payment-profile/review`, { status: "verified" });

    const policies = await apiJson(request, seeded.adminToken, "GET", "/partner-compliance/me/insurance-policies");
    for (const policy of policies) {
      await apiJson(request, seeded.internalToken, "POST", `/partner-compliance/organizations/${seeded.orgA}/insurance-policies/${policy.id}/review`, { status: "verified" });
    }
    const summary = await apiJson(request, seeded.adminToken, "GET", "/partner-compliance/me/summary");
    expect(summary.overall_status).toBe("ready");
    expect(summary.blockers).toEqual([]);

    const after = await eventCounts(client);
    expect(after.events).toBeGreaterThan(before.events);
    expect(after.audit_logs).toBeGreaterThan(before.audit_logs);
    const sensitiveLeaks = await client.query(
      `
      SELECT count(*)::int AS count
      FROM event_payloads ep
      WHERE ep.payload::text ILIKE '%123456789%'
         OR ep.payload::text ILIKE '%routing_number%'
         OR ep.payload::text ILIKE '%bank_account_number%'
      `,
    );
    expect(sensitiveLeaks.rows[0].count).toBe(0);
  });

  test("insurance limit and expiration changes recalculate blockers and preserve version history", async ({ request }) => {
    const before = await apiJson(request, seeded.adminToken, "GET", "/partner-compliance/me/insurance-policies");
    const cglBefore = before.find((policy: { policy_type: string }) => policy.policy_type === "commercial_general_liability");
    expect(cglBefore.status).toBe("verified");

    const cglAfter = await apiJson(request, seeded.adminToken, "POST", "/partner-compliance/me/insurance-policies", {
      ...completePolicy("commercial_general_liability"),
      effective_date: "2025-08-01",
      occurrence_limit_cents: 500_000_00,
      expiration_date: "2026-01-01",
    });
    expect(cglAfter.version).toBeGreaterThan(cglBefore.version);
    expect(cglAfter.status).toBe("submitted");

    const summary = await apiJson(request, seeded.adminToken, "GET", "/partner-compliance/me/summary");
    expect(summary.overall_status).toBe("blocked");
    expect(summary.blockers.map((blocker: { key: string }) => blocker.key)).toEqual(expect.arrayContaining(["policy_unverified", "policy_expired", "coverage_limit_insufficient"]));

    const history = await client.query(
      `
      SELECT id, status, version, supersedes_policy_id, superseded_by_policy_id
      FROM partner_insurance_policies
      WHERE tenant_id = $1 AND organization_id = $2 AND policy_type = 'commercial_general_liability'
      ORDER BY version ASC
      `,
      [seeded.tenantA, seeded.orgA],
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0].id).toBe(cglBefore.id);
    expect(history.rows[0].status).toBe("superseded");
    expect(history.rows[0].superseded_by_policy_id).toBe(cglAfter.id);
    expect(history.rows[1].id).toBe(cglAfter.id);
    expect(history.rows[1].supersedes_policy_id).toBe(cglBefore.id);
  });
});

async function seedPartnerComplianceFixture(client: Client, secret: string): Promise<Seeded> {
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

  const p3Permissions = [
    "partner_context.read",
    "partner_actions.read",
    "partner_compliance.summary.read",
    "partner_compliance.profile.read",
    "partner_compliance.profile.submit",
    "partner_compliance.w9.read",
    "partner_compliance.w9.submit",
    "partner_compliance.payment.read",
    "partner_compliance.payment.submit",
    "partner_compliance.insurance.read",
    "partner_compliance.insurance.submit",
    "partner_compliance.evidence.read",
    "partner_compliance.review",
    "partner_compliance.evidence.review",
  ];

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)", [
      tenantA,
      "P3 Partner Compliance Tenant A",
      `p3-partner-compliance-a-${suffix}`,
      tenantB,
      "P3 Partner Compliance Tenant B",
      `p3-partner-compliance-b-${suffix}`,
    ]);
    for (const permission of p3Permissions) await ensurePermission(client, permission);
    await client.query(
      `
      INSERT INTO users (id, email, display_name)
      VALUES
        ($1, $2, 'P3 Partner Admin'),
        ($3, $4, 'P3 Partner Foreman'),
        ($5, $6, 'P3 Internal Reviewer'),
        ($7, $8, 'P3 Unauthorized Internal'),
        ($9, $10, 'P3 Tenant B Partner')
      `,
      [
        adminUser,
        `p3-admin-${suffix}@syncos.test`,
        foremanUser,
        `p3-foreman-${suffix}@syncos.test`,
        internalUser,
        `p3-internal-${suffix}@syncos.test`,
        unauthorizedInternalUser,
        `p3-unauthorized-${suffix}@syncos.test`,
        tenantBUser,
        `p3-tenant-b-${suffix}@syncos.test`,
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
        ($1, $2, 'P3 Partner Admin', 'partner_admin'),
        ($3, $2, 'P3 Partner Foreman', 'partner_foreman'),
        ($4, $2, 'P3 Internal Compliance Reviewer', $5),
        ($6, $2, 'P3 Unauthorized Internal', $7),
        ($8, $9, 'P3 Tenant B Partner Admin', 'partner_admin')
      `,
      [adminRole, tenantA, foremanRole, internalRole, `p3_internal_reviewer_${suffix}`, unauthorizedRole, `p3_unauthorized_${suffix}`, tenantBRole, tenantB],
    );
    await grantPermissions(client, tenantA, adminRole, p3Permissions.filter((permission) => !permission.endsWith(".review") && permission !== "partner_compliance.review"));
    await grantPermissions(client, tenantA, foremanRole, ["partner_context.read", "partner_actions.read", "partner_compliance.summary.read"]);
    await grantPermissions(client, tenantA, internalRole, ["partner_compliance.review", "partner_compliance.evidence.review"]);
    await grantPermissions(client, tenantB, tenantBRole, p3Permissions.filter((permission) => !permission.endsWith(".review") && permission !== "partner_compliance.review"));
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
        ($1, $2, 'P3 Partner A', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($3, $2, 'P3 Partner B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($4, $5, 'P3 Partner Tenant B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active')
      `,
      [orgA, tenantA, orgB, orgTenantB, tenantB],
    );
    await client.query(
      `
      INSERT INTO capacity_providers (id, tenant_id, organization_id, name, provider_type, status, verification_status, contract_status)
      VALUES
        ($1, $2, $3, 'P3 Provider A', 'subcontractor', 'activated', 'verified', 'contracted'),
        ($4, $2, $5, 'P3 Provider B', 'crew_provider', 'activated', 'verified', 'contracted'),
        ($6, $7, $8, 'P3 Provider Tenant B', 'subcontractor', 'activated', 'verified', 'contracted')
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
  };
}

function completePolicySet() {
  return [
    completePolicy("commercial_general_liability"),
    completePolicy("commercial_auto"),
    completePolicy("umbrella_excess"),
    completePolicy("workers_compensation"),
    completePolicy("employers_liability"),
  ];
}

function completePolicy(policy_type: string) {
  return {
    policy_type,
    carrier: `Carrier ${policy_type}`,
    policy_reference: `policy-${policy_type}`,
    effective_date: "2026-08-01",
    expiration_date: "2027-08-01",
    occurrence_limit_cents: policy_type === "umbrella_excess" ? 2_000_000_00 : 1_000_000_00,
    general_aggregate_cents: 2_000_000_00,
    products_completed_operations_aggregate_cents: 2_000_000_00,
    combined_single_auto_limit_cents: 1_000_000_00,
    employer_liability_accident_limit_cents: 500_000_00,
    employer_liability_disease_each_employee_limit_cents: 500_000_00,
    employer_liability_disease_policy_limit_cents: 500_000_00,
    workers_compensation_statutory: policy_type === "workers_compensation",
    owned_auto_covered: true,
    hired_rented_auto_covered: true,
    non_owned_auto_covered: true,
    additional_insured_status: ["commercial_general_liability", "commercial_auto", "umbrella_excess"].includes(policy_type) ? "verified" : "not_required",
    waiver_of_subrogation_status: ["commercial_general_liability", "commercial_auto", "umbrella_excess"].includes(policy_type) ? "verified" : "not_required",
    primary_non_contributory_status: ["commercial_general_liability", "commercial_auto", "umbrella_excess"].includes(policy_type) ? "verified" : "not_required",
    coi_evidence: evidence(`${policy_type}-coi.pdf`, `${policy_type}-coi-checksum`),
  };
}

function evidence(file_name: string, checksum: string) {
  return {
    file_name,
    mime_type: "application/pdf",
    size_bytes: 1234,
    checksum,
  };
}

async function ensurePermission(client: Client, key: string) {
  await client.query(
    `
    INSERT INTO permissions (key, name, description)
    VALUES ($1, $1, 'P3 partner compliance test permission')
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

function send(
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
  if (method === "GET") return request.get(url, options);
  return request.post(url, options);
}

function apiUrl(path: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${path.replace(/^\//, "")}`;
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
