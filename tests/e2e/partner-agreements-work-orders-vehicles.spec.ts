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
  contactA1: string;
  contactA2: string;
  crewA: string;
  workerA: string;
  equipmentA: string;
  projectA: string;
  adminToken: string;
  foremanToken: string;
  internalToken: string;
  unauthorizedInternalToken: string;
  tenantBToken: string;
};

test.describe.serial("P5 Partner agreements, work orders, rates, and vehicles", () => {
  let client: Client;
  let seeded: Seeded;
  let agreementVersionId: string;
  let workOrderVersionId: string;
  let vehicleAssignmentId: string;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");

    client = new Client({ connectionString });
    await client.connect();
    seeded = await seedPartnerAgreementFixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("internal user creates an MSA, enforces signer rules, and Partner can read only own safe view", async ({ request }) => {
    const unauthenticated = await request.get(apiUrl("/partner-agreements/me/agreements"));
    expect(unauthenticated.status()).toBe(401);

    await expectStatus(request, seeded.adminToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements`, 403, {
      name: "Partner MSA",
      capacity_provider_id: seeded.providerA,
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgB}/agreements`, 404, {
      name: "Wrong Partner MSA",
      capacity_provider_id: seeded.providerA,
    });

    const agreement = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements`, {
      name: "Master Project Partner Agreement",
      agreement_number: "MSA-P5-A",
      capacity_provider_id: seeded.providerA,
      issued_date: "2026-08-16",
    });
    agreementVersionId = agreement.version_id;
    expect(agreement.standing_terms.pay_when_paid).toBe(true);
    expect(agreement.standing_terms.no_guaranteed_work).toBe(true);

    const signer1 = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/signatories`, {
      signer_role: "partner_representative_1",
      contact_id: seeded.contactA1,
      full_legal_name: "P5 Partner Rep One",
      title: "President",
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/signatories`, 400, {
      signer_role: "partner_representative_2",
      contact_id: seeded.contactA1,
      full_legal_name: "P5 Partner Rep One",
      title: "President",
    });
    const signer2 = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/signatories`, {
      signer_role: "partner_representative_2",
      contact_id: seeded.contactA2,
      full_legal_name: "P5 Partner Rep Two",
      title: "Treasurer",
    });
    const syncSigner = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/signatories`, {
      signer_role: "sync_representative",
      full_legal_name: "Sync Authorized Rep",
      title: "Operations",
    });
    await expectStatus(request, seeded.adminToken, "POST", `/partner-agreements/me/agreements/${agreementVersionId}/signatures`, 403, {
      signatory_id: syncSigner.id,
      signed_date: "2026-08-17",
    });
    await apiJson(request, seeded.adminToken, "POST", `/partner-agreements/me/agreements/${agreementVersionId}/signatures`, {
      signatory_id: signer1.id,
      signed_date: "2026-08-17",
    });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/signatures`, {
      signatory_id: signer1.id,
      signed_date: "2026-08-17",
    });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/signatures`, {
      signatory_id: signer2.id,
      signed_date: "2026-08-18",
    });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/signatures`, {
      signatory_id: syncSigner.id,
      signed_date: "2026-08-19",
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/activate`, 400);

    await expectStatus(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/artifact`, 400, {
      file_name: "spoof.pdf",
      mime_type: "application/pdf",
      content_base64: Buffer.from("not a pdf").toString("base64"),
    });
    const artifact = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/artifact`, pdfArtifact("msa-executed.pdf"));
    expect(artifact.mime_type).toBe("application/pdf");
    expect(artifact.storage_key).toBeUndefined();

    const activated = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/agreements/${agreementVersionId}/activate`);
    expect(activated.effective_date).toBe("2026-08-19");

    const own = await apiJson(request, seeded.adminToken, "GET", "/partner-agreements/me/agreements");
    expect(own[0].version_id).toBe(agreementVersionId);
    expect(JSON.stringify(own).toLowerCase()).not.toContain("internal");
    await expectStatus(request, seeded.tenantBToken, "GET", `/partner-agreements/me/agreements/${agreementVersionId}/artifact`, 404);
    await expectStatus(request, seeded.foremanToken, "GET", `/partner-agreements/me/agreements/${agreementVersionId}/artifact`, 403);
    const ownArtifact = await apiJson(request, seeded.adminToken, "GET", `/partner-agreements/me/agreements/${agreementVersionId}/artifact`);
    expect(ownArtifact.content_base64).toBeTruthy();
    expect(ownArtifact.public_url).toBeUndefined();
  });

  test("Work Order activation preserves Partner rate isolation and cannot be managed by Partner users", async ({ request }) => {
    await expectStatus(request, seeded.adminToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders`, 403, {});
    const workOrder = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders`, {
      project_id: seeded.projectA,
      capacity_provider_id: seeded.providerA,
      governing_agreement_version_id: agreementVersionId,
      assigned_crew_id: seeded.crewA,
      work_order_name: "Toledo Synthetic Aerial WO",
      work_order_number: "WO-P5-A",
      work_type: "fiber_hanging_overlash",
      scope_summary: "fiber hanging and overlash only",
      primary_work_area: "Synthetic Toledo market",
      map_work_package_ref: "MAP-P5-A",
      production_unit: "feet",
      performance_target: 3000,
      partner_rate_amount: 0.7,
      rate_code: "accepted_foot",
      rate_unit: "feet",
      fuel_tolls_responsibility: "partner",
    });
    workOrderVersionId = workOrder.id;
    expect(workOrderVersionId).toBeTruthy();

    const partnerView = await apiJson(request, seeded.adminToken, "GET", "/partner-agreements/me/work-orders");
    expect(partnerView[0].partner_rate).toEqual({ amount: "0.70", unit: "feet" });
    expect(JSON.stringify(partnerView).toLowerCase()).not.toContain("customer_rate");
    expect(JSON.stringify(partnerView).toLowerCase()).not.toContain("margin");
    await expectStatus(request, seeded.foremanToken, "GET", "/partner-agreements/me/work-orders", 403);

    const signer1 = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/signatories`, signatory("partner_representative_1", seeded.contactA1, "P5 Partner Rep One"));
    const signer2 = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/signatories`, signatory("partner_representative_2", seeded.contactA2, "P5 Partner Rep Two"));
    const syncSigner = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/signatories`, signatory("sync_representative", null, "Sync Authorized Rep"));
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/signatures`, { signatory_id: signer1.id, signed_date: "2026-08-20" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/signatures`, { signatory_id: signer2.id, signed_date: "2026-08-21" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/signatures`, { signatory_id: syncSigner.id, signed_date: "2026-08-22" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/artifact`, pdfArtifact("wo-executed.pdf"));
    const activated = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/work-orders/${workOrderVersionId}/activate`);
    expect(activated.effective_date).toBe("2026-08-22");

    const rows = await client.query("SELECT customer_rate, margin_amount, margin_percent FROM rate_codes rc JOIN partner_work_order_versions wov ON wov.rate_code_id = rc.id WHERE wov.id = $1", [workOrderVersionId]);
    expect(rows.rows[0].customer_rate).toBeNull();
    expect(rows.rows[0].margin_amount).toBeNull();
    expect(rows.rows[0].margin_percent).toBeNull();
  });

  test("vehicle custody, operators, condition, and allocation are tenant and Partner safe", async ({ request }) => {
    const financialBefore = await financialCounts(client);
    const assignment = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments`, {
      work_order_version_id: workOrderVersionId,
      equipment_id: seeded.equipmentA,
      rental_provider: "Synthetic Rental",
      sync_possession_date: "2026-08-20",
      partner_custody_start_date: "2026-08-23",
      daily_allocation_amount: 100,
      currency: "USD",
      timezone: "America/New_York",
      odometer_at_assignment: 1200,
      fuel_level_at_assignment: "full",
    });
    vehicleAssignmentId = assignment.id;

    await expectStatus(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/operators`, 400, {
      worker_id: crypto.randomUUID(),
    });
    const operator = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/operators`, {
      worker_id: seeded.workerA,
      authorization_role: "driver_operator",
    });
    expect(operator.worker_id).toBe(seeded.workerA);

    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/conditions`, {
      record_type: "pre_assignment",
      odometer: 1200,
      fuel_level: "full",
      known_damage: "none",
      tires_status: "ok",
      external_notes: "synthetic condition",
    });
    const preview = await apiJson(request, seeded.adminToken, "GET", `/partner-agreements/me/vehicle-assignments/${vehicleAssignmentId}/allocation-preview?period_end=2026-08-25`);
    expect(preview.allocated_days).toBe(3);
    expect(preview.calculated_allocation_amount).toBe(300);
    await expectStatus(request, seeded.adminToken, "GET", `/partner-agreements/me/vehicle-assignments/${vehicleAssignmentId}/allocation-preview?period_end=2026-08-22`, 400);

    const returned = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/return`, {
      partner_return_release_date: "2026-08-23",
      odometer_at_return: 1210,
      fuel_level_at_return: "three_quarter",
    });
    expect(returned.status).toBe("returned");
    const sameDay = await apiJson(request, seeded.adminToken, "GET", `/partner-agreements/me/vehicle-assignments/${vehicleAssignmentId}/allocation-preview`);
    expect(sameDay.allocated_days).toBe(1);

    const financialAfter = await financialCounts(client);
    expect(financialAfter).toEqual(financialBefore);
  });

  test("vehicle agreement artifacts are restricted and Foreman sees only safe operational summary", async ({ request }) => {
    const signer1 = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/signatories`, signatory("partner_representative_1", seeded.contactA1, "P5 Partner Rep One"));
    const signer2 = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/signatories`, signatory("partner_representative_2", seeded.contactA2, "P5 Partner Rep Two"));
    const syncSigner = await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/signatories`, signatory("sync_representative", null, "Sync Authorized Rep"));
    await apiJson(request, seeded.adminToken, "POST", `/partner-agreements/me/vehicle-assignments/${vehicleAssignmentId}/signatures`, { signatory_id: signer1.id, signed_date: "2026-08-23" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/signatures`, { signatory_id: signer1.id, signed_date: "2026-08-23" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/signatures`, { signatory_id: signer2.id, signed_date: "2026-08-23" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/signatures`, { signatory_id: syncSigner.id, signed_date: "2026-08-23" });
    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${vehicleAssignmentId}/artifact`, pdfArtifact("vehicle-executed.pdf"));

    const ownArtifact = await apiJson(request, seeded.adminToken, "GET", `/partner-agreements/me/vehicle-assignments/${vehicleAssignmentId}/artifact`);
    expect(ownArtifact.content_base64).toBeTruthy();
    expect(ownArtifact.storage_key).toBeUndefined();
    await expectStatus(request, seeded.tenantBToken, "GET", `/partner-agreements/me/vehicle-assignments/${vehicleAssignmentId}/artifact`, 404);
    await expectStatus(request, seeded.foremanToken, "GET", `/partner-agreements/me/vehicle-assignments/${vehicleAssignmentId}/artifact`, 403);

    const foremanSummary = await apiJson(request, seeded.foremanToken, "GET", "/partner-agreements/foreman/work-order");
    expect(foremanSummary.work_order_id).toBeTruthy();
    expect(foremanSummary.vehicle.equipment_name).toBe("P5 Bucket Truck");
    expect(JSON.stringify(foremanSummary).toLowerCase()).not.toContain("rate");
    expect(JSON.stringify(foremanSummary).toLowerCase()).not.toContain("artifact");
  });

  test("events and audit omit restricted legal bytes, storage keys, internal rates, and internal notes", async () => {
    const payloads = await client.query<{ payload: unknown }>(
      `
      SELECT ep.payload
      FROM event_payloads ep
      JOIN events e ON e.id = ep.event_id
      WHERE e.event_type LIKE 'partner_%'
         OR e.event_type LIKE 'vehicle_%'
         OR e.event_type = 'restricted_legal_artifact.uploaded'
      `,
    );
    const leakedKeys = payloads.rows.flatMap(({ payload }) => findProhibitedKeys(payload));
    expect(leakedKeys).toEqual([]);

    const storageLeaks = await client.query(
      `
      SELECT count(*)::int AS count
      FROM event_payloads ep
      JOIN events e ON e.id = ep.event_id
      WHERE (e.event_type LIKE 'partner_%'
         OR e.event_type LIKE 'vehicle_%'
         OR e.event_type = 'restricted_legal_artifact.uploaded')
        AND ep.payload::text ILIKE '%/private/tmp/%'
      `,
    );
    expect(storageLeaks.rows[0].count).toBe(0);
  });
});

const prohibitedEventKeys = new Set([
  "content_base64",
  "storage_key",
  "storageKey",
  "customer_rate",
  "customerRate",
  "internal_rate",
  "internalRate",
  "margin",
  "internal_review_notes",
  "internalReviewNotes",
]);

function findProhibitedKeys(value: unknown, path = "$"): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findProhibitedKeys(entry, `${path}[${index}]`));
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    const nextPath = `${path}.${key}`;
    const found = prohibitedEventKeys.has(key) ? [nextPath] : [];
    return found.concat(findProhibitedKeys(entry, nextPath));
  });
}

async function seedPartnerAgreementFixture(client: Client, secret: string): Promise<Seeded> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const orgTenantB = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
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
  const contactA1 = crypto.randomUUID();
  const contactA2 = crypto.randomUUID();
  const crewA = crypto.randomUUID();
  const workerA = crypto.randomUUID();
  const equipmentA = crypto.randomUUID();
  const projectA = crypto.randomUUID();

  const adminPermissions = [
    "partner_context.read",
    "partner_agreement.read",
    "partner_agreement.sign",
    "partner_agreement.artifact.read",
    "partner_work_order.read",
    "partner_work_order.rate.read",
    "partner_work_order.sign",
    "partner_work_order.artifact.read",
    "partner_vehicle_assignment.read",
    "partner_vehicle_assignment.sign",
    "partner_vehicle_assignment.artifact.read",
    "partner_vehicle_assignment.allocation.read",
  ];
  const foremanPermissions = ["partner_context.read", "partner_work_order.foreman_summary.read"];
  const internalPermissions = [
    "capacity_provider.read",
    "partner_agreement.manage",
    "partner_agreement.review",
    "partner_agreement.artifact.review",
    "partner_work_order.manage",
    "partner_work_order.rate.manage",
    "partner_vehicle_assignment.manage",
    "partner_vehicle_assignment.operator.manage",
    "partner_vehicle_assignment.condition.manage",
    "partner_vehicle_assignment.artifact.review",
  ];

  for (const permission of [...adminPermissions, ...foremanPermissions, ...internalPermissions]) {
    await ensurePermission(client, permission);
  }

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)", [tenantA, "P5 Tenant A", `p5-a-${suffix}`, tenantB, "P5 Tenant B", `p5-b-${suffix}`]);
    await client.query(
      `
      INSERT INTO users (id, email, display_name)
      VALUES
        ($1, $2, 'P5 Partner Admin'),
        ($3, $4, 'P5 Partner Foreman'),
        ($5, $6, 'P5 Internal Reviewer'),
        ($7, $8, 'P5 Unauthorized Internal'),
        ($9, $10, 'P5 Tenant B Partner')
      `,
      [adminUser, `p5-admin-${suffix}@syncos.test`, foremanUser, `p5-foreman-${suffix}@syncos.test`, internalUser, `p5-internal-${suffix}@syncos.test`, unauthorizedInternalUser, `p5-unauthorized-${suffix}@syncos.test`, tenantBUser, `p5-tenant-b-${suffix}@syncos.test`],
    );
    await client.query(
      `
      INSERT INTO tenant_users (id, tenant_id, user_id)
      VALUES ($1, $2, $3), ($4, $2, $5), ($6, $2, $7), ($8, $2, $9), ($10, $11, $12)
      `,
      [adminTenantUser, tenantA, adminUser, foremanTenantUser, foremanUser, internalTenantUser, internalUser, unauthorizedTenantUser, unauthorizedInternalUser, tenantBTenantUser, tenantB, tenantBUser],
    );
    await client.query(
      `
      INSERT INTO roles (id, tenant_id, name, system_key)
      VALUES
        ($1, $2, 'P5 Partner Admin', 'partner_admin'),
        ($3, $2, 'P5 Partner Foreman', 'partner_foreman'),
        ($4, $2, 'P5 Internal Commercial Reviewer', $5),
        ($6, $2, 'P5 Unauthorized Internal', $7),
        ($8, $9, 'P5 Tenant B Partner Admin', 'partner_admin')
      `,
      [adminRole, tenantA, foremanRole, internalRole, `p5_internal_reviewer_${suffix}`, unauthorizedRole, `p5_unauthorized_${suffix}`, tenantBRole, tenantB],
    );
    await grantPermissions(client, tenantA, adminRole, adminPermissions);
    await grantPermissions(client, tenantA, foremanRole, foremanPermissions);
    await grantPermissions(client, tenantA, internalRole, internalPermissions);
    await grantPermissions(client, tenantB, tenantBRole, adminPermissions);
    await client.query(
      `
      INSERT INTO organizations (id, tenant_id, name, organization_type, actor_roles, status)
      VALUES
        ($1, $2, 'P5 Partner A', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($3, $2, 'P5 Partner B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active'),
        ($4, $2, 'Buckeye Synthetic Customer', 'customer', ARRAY['work_creator']::text[], 'active'),
        ($5, $6, 'P5 Partner Tenant B', 'subcontractor', ARRAY['capacity_provider']::text[], 'active')
      `,
      [orgA, tenantA, orgB, customerOrg, orgTenantB, tenantB],
    );
    await client.query(
      `
      INSERT INTO capacity_providers (id, tenant_id, organization_id, name, provider_type, status, verification_status, contract_status)
      VALUES
        ($1, $2, $3, 'P5 Provider A', 'subcontractor', 'activated', 'verified', 'contracted'),
        ($4, $2, $5, 'P5 Provider B', 'crew_provider', 'activated', 'verified', 'contracted'),
        ($6, $7, $8, 'P5 Provider Tenant B', 'subcontractor', 'activated', 'verified', 'contracted')
      `,
      [providerA, tenantA, orgA, providerB, orgB, providerTenantB, tenantB, orgTenantB],
    );
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
      INSERT INTO contacts (id, tenant_id, organization_id, first_name, last_name, full_name, title, status, verification_status)
      VALUES
        ($1, $2, $3, 'Rep', 'One', 'P5 Partner Rep One', 'President', 'verified', 'verified'),
        ($4, $2, $3, 'Rep', 'Two', 'P5 Partner Rep Two', 'Treasurer', 'verified', 'verified')
      `,
      [contactA1, tenantA, orgA, contactA2],
    );
    await client.query("INSERT INTO projects (id, tenant_id, customer_organization_id, name, status) VALUES ($1, $2, $3, 'Toledo Aerial Fiber Construction Project', 'active')", [projectA, tenantA, customerOrg]);
    await client.query("INSERT INTO crews (id, tenant_id, capacity_provider_id, organization_id, name, crew_type, status, lifecycle_status, target_staffing_level) VALUES ($1, $2, $3, $4, 'P5 Ready Crew', 'aerial', 'active', 'active', 4)", [crewA, tenantA, providerA, orgA]);
    await client.query("INSERT INTO workers (id, tenant_id, capacity_provider_id, crew_id, organization_id, first_name, last_name, status, review_status) VALUES ($1, $2, $3, $4, $5, 'P5', 'Operator', 'active', 'approved')", [workerA, tenantA, providerA, crewA, orgA]);
    await client.query("INSERT INTO partner_crew_memberships (tenant_id, organization_id, capacity_provider_id, crew_id, worker_id, membership_role, status) VALUES ($1, $2, $3, $4, $5, 'foreman', 'active')", [tenantA, orgA, providerA, crewA, workerA]);
    await client.query("INSERT INTO partner_worker_user_links (tenant_id, organization_id, worker_id, tenant_user_id, status) VALUES ($1, $2, $3, $4, 'active')", [tenantA, orgA, workerA, foremanTenantUser]);
    await client.query("INSERT INTO partner_worker_credentials (tenant_id, organization_id, capacity_provider_id, worker_id, credential_type, required, status, expiration_date) VALUES ($1, $2, $3, $4, 'driver_license', true, 'verified', '2027-08-16')", [tenantA, orgA, providerA, workerA]);
    await client.query("INSERT INTO equipment (id, tenant_id, name, equipment_type, status) VALUES ($1, $2, 'P5 Bucket Truck', 'bucket_truck', 'active')", [equipmentA, tenantA]);
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
    contactA1,
    contactA2,
    crewA,
    workerA,
    equipmentA,
    projectA,
    adminToken: createToken({ sub: adminUser, tenant_id: tenantA }, secret),
    foremanToken: createToken({ sub: foremanUser, tenant_id: tenantA }, secret),
    internalToken: createToken({ sub: internalUser, tenant_id: tenantA }, secret),
    unauthorizedInternalToken: createToken({ sub: unauthorizedInternalUser, tenant_id: tenantA }, secret),
    tenantBToken: createToken({ sub: tenantBUser, tenant_id: tenantB }, secret),
  };
}

function signatory(signer_role: string, contact_id: string | null, full_legal_name: string) {
  return { signer_role, contact_id: contact_id ?? undefined, full_legal_name, title: signer_role === "sync_representative" ? "Operations" : "Authorized Representative" };
}

function pdfArtifact(file_name: string) {
  return {
    file_name,
    mime_type: "application/pdf",
    content_base64: Buffer.from(`%PDF-1.4\n% synthetic ${file_name}\n`).toString("base64"),
  };
}

async function ensurePermission(client: Client, key: string) {
  await client.query("INSERT INTO permissions (key, name, description) VALUES ($1, $1, 'P5 partner agreement test permission') ON CONFLICT (key) DO NOTHING", [key]);
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

async function financialCounts(client: Client) {
  const result = await client.query<{ settlements: number; payables: number }>("SELECT (SELECT count(*)::int FROM settlements) AS settlements, (SELECT count(*)::int FROM contractor_payables) AS payables");
  return result.rows[0];
}

async function apiJson(request: APIRequestContext, token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await send(request, token, method, path, body);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(400);
  return response.json();
}

async function expectStatus(request: APIRequestContext, token: string, method: "GET" | "POST", path: string, expected: number, body?: unknown) {
  const response = await send(request, token, method, path, body);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(expected);
}

function send(request: APIRequestContext, token: string, method: "GET" | "POST", route: string, body?: unknown) {
  const options = { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, data: body };
  const url = apiUrl(route);
  if (method === "GET") return request.get(url, options);
  return request.post(url, options);
}

function apiUrl(route: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${route.replace(/^\//, "")}`;
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
