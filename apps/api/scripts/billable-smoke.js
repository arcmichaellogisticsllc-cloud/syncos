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
  try {
    const seeded = await client.query(`
      SELECT u.id AS user_id, t.id AS tenant_id, tu.id AS tenant_user_id
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id
      JOIN tenants t ON t.id = tu.tenant_id
      WHERE u.email = 'admin@jackson-telcom.local'
        AND t.slug = 'jackson-telcom'
      LIMIT 1
    `);
    if (!seeded.rows[0]) throw new Error("Seeded admin user was not found");
    const { user_id: userId, tenant_id: tenantId, tenant_user_id: tenantUserId } = seeded.rows[0];
    for (const role of ["Billing Manager", "Finance Manager", "Operations Manager"]) {
      await assignRole(client, tenantId, tenantUserId, role);
    }
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedUserId = await createLimitedUser(client, tenantId);
    const limitedToken = createToken({ sub: limitedUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/billable-items", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/billable-items", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross-tenant blocked", "GET", `/billable-items/${outside.billableItemId}`, `Bearer ${token}`, 404);

    const downstreamBefore = await downstreamCounts(client);

    const base = await createBase(client, tenantId, userId, { approvedQuantity: 80, billableCandidateQuantity: 70 });
    const item = await expectStatus("billable item create works", "POST", "/billable-items", `Bearer ${token}`, 201, {
      qc_review_id: base.qcReviewId,
      billable_quantity: 70,
    });
    if (item.billable_item.status !== "needs_rate" || Number(item.billable_item.billable_quantity) !== 70) throw new Error("Billable item was not created as needs_rate");
    assertNoFinance(await downstreamCounts(client), downstreamBefore, "billable create boundary");

    await expectStatus("duplicate active item blocked", "POST", "/billable-items", `Bearer ${token}`, 400, {
      qc_review_id: base.qcReviewId,
      billable_quantity: 70,
    });

    const overageBase = await createBase(client, tenantId, userId, { approvedQuantity: 50, billableCandidateQuantity: 50 });
    await expectStatus("billable quantity cannot exceed approved without override", "POST", "/billable-items", `Bearer ${token}`, 400, {
      qc_review_id: overageBase.qcReviewId,
      billable_quantity: 60,
    });

    const docsBase = await createBase(client, tenantId, userId, { approvedQuantity: 100, billableCandidateQuantity: 90 });
    const rate = await createRate(client, tenantId, docsBase.customerOrganizationId);
    const docsItem = await expectStatus("incomplete billing package creates needs_documentation", "POST", "/billable-items", `Bearer ${token}`, 201, {
      qc_review_id: docsBase.qcReviewId,
      billable_quantity: 90,
      rate_code_id: rate.rateCodeId,
      billing_package_status: "incomplete",
      documentation_status: "incomplete",
    });
    if (docsItem.billable_item.status !== "needs_documentation") throw new Error("Incomplete package did not create needs_documentation");

    const acceptanceBase = await createBase(client, tenantId, userId, { approvedQuantity: 90, billableCandidateQuantity: 90 });
    const acceptanceRate = await createRate(client, tenantId, acceptanceBase.customerOrganizationId);
    const acceptanceItem = await expectStatus("pending customer acceptance creates needs_customer_acceptance", "POST", "/billable-items", `Bearer ${token}`, 201, {
      qc_review_id: acceptanceBase.qcReviewId,
      billable_quantity: 90,
      rate_code_id: acceptanceRate.rateCodeId,
      billing_package_status: "ready",
      documentation_status: "ready",
      customer_acceptance_status: "pending",
    });
    if (acceptanceItem.billable_item.status !== "needs_customer_acceptance") throw new Error("Pending acceptance did not create needs_customer_acceptance");

    const readyBase = await createBase(client, tenantId, userId, { approvedQuantity: 100, billableCandidateQuantity: 100 });
    const readyRate = await createRate(client, tenantId, readyBase.customerOrganizationId, { amount: 12 });
    const readyItem = await expectStatus("ready candidate create works", "POST", "/billable-items", `Bearer ${token}`, 201, {
      qc_review_id: readyBase.qcReviewId,
      billable_quantity: 100,
      rate_code_id: readyRate.rateCodeId,
      billing_package_status: "ready",
      documentation_status: "ready",
      customer_acceptance_status: "accepted",
      prime_acceptance_status: "accepted",
      retainage_required: true,
      retainage_percent: 10,
    });
    if (readyItem.billable_item.status !== "candidate") throw new Error("Ready billable item did not create as candidate");
    if (Number(readyItem.billable_item.estimated_billable_amount) !== 1200 || Number(readyItem.billable_item.retainage_amount) !== 120 || Number(readyItem.billable_item.net_billable_amount) !== 1080) throw new Error("Retainage or amount calculation failed");

    const recalculated = await expectStatus("readiness recalculation works", "POST", `/billable-items/${readyItem.billable_item.id}/recalculate-readiness`, `Bearer ${token}`, 201, {});
    if (recalculated.billable_item.readiness_score === null || recalculated.billable_item.readiness_score === undefined) throw new Error("Readiness was not recalculated");

    await expectStatus("mark ready blocked by blockers", "POST", `/billable-items/${item.billable_item.id}/mark-ready-for-settlement`, `Bearer ${token}`, 400, {
      approval_note: "Should fail.",
    });
    const readyBefore = await downstreamCounts(client);
    const markedReady = await expectStatus("mark ready succeeds", "POST", `/billable-items/${readyItem.billable_item.id}/mark-ready-for-settlement`, `Bearer ${token}`, 201, {
      approval_note: "Ready for future settlement.",
      override_reasons: { retainage_applies: "Retainage reviewed." },
    });
    if (markedReady.billable_item.status !== "ready_for_settlement") throw new Error("Billable item was not marked ready_for_settlement");
    assertNoFinance(await downstreamCounts(client), readyBefore, "mark ready boundary");

    const holdBase = await createReadyItem(client, token, tenantId, userId);
    await expectStatus("hold requires reason", "POST", `/billable-items/${holdBase.id}/place-hold`, `Bearer ${token}`, 400, {});
    const held = await expectStatus("hold works", "POST", `/billable-items/${holdBase.id}/place-hold`, `Bearer ${token}`, 201, { hold_reason: "documentation_hold" });
    if (held.billable_item.status !== "held") throw new Error("Hold did not set status");
    const released = await expectStatus("release hold works", "POST", `/billable-items/${holdBase.id}/release-hold`, `Bearer ${token}`, 201, { release_note: "Hold cleared." });
    if (released.billable_item.status === "held") throw new Error("Hold was not released");

    const disputeBase = await createReadyItem(client, token, tenantId, userId);
    await expectStatus("dispute requires reason", "POST", `/billable-items/${disputeBase.id}/dispute`, `Bearer ${token}`, 400, {});
    const disputed = await expectStatus("dispute works", "POST", `/billable-items/${disputeBase.id}/dispute`, `Bearer ${token}`, 201, { dispute_reason: "customer_dispute" });
    if (disputed.billable_item.status !== "disputed") throw new Error("Dispute did not set status");
    const resolved = await expectStatus("resolve dispute works", "POST", `/billable-items/${disputeBase.id}/resolve-dispute`, `Bearer ${token}`, 201, { resolution_note: "Resolved." });
    if (resolved.billable_item.status === "disputed") throw new Error("Dispute was not resolved");

    const voidBase = await createReadyItem(client, token, tenantId, userId);
    await expectStatus("void requires reason", "POST", `/billable-items/${voidBase.id}/void`, `Bearer ${token}`, 400, {});
    const voided = await expectStatus("void works", "POST", `/billable-items/${voidBase.id}/void`, `Bearer ${token}`, 201, { void_reason: "created_in_error" });
    if (voided.billable_item.status !== "voided") throw new Error("Void did not set status");

    const archiveBase = await createReadyItem(client, token, tenantId, userId);
    await expectStatus("archive requires reason", "POST", `/billable-items/${archiveBase.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("archive works", "POST", `/billable-items/${archiveBase.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "no_longer_relevant" });

    const list = await expectStatus("list returns enriched fields", "GET", "/billable-items", `Bearer ${token}`, 200);
    const listed = list.find((row) => row.id === readyItem.billable_item.id);
    if (!listed || listed.project_name === undefined || listed.customer_organization_name === undefined || listed.recommended_next_action === undefined) throw new Error("Billable list was not enriched");
    const detail = await expectStatus("detail returns contexts", "GET", `/billable-items/${readyItem.billable_item.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.project_context || !detail.work_order_context || !detail.production_context || !detail.qc_context || !detail.rate_summary || !detail.retainage_summary) throw new Error("Billable detail missing required sections");
    const timeline = await expectStatus("timeline returns billable events", "GET", `/billable-items/${readyItem.billable_item.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["billable_item.created", "billable_item.ready_for_settlement"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Billable timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/billable-items/${readyItem.billable_item.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/billable-items/${readyItem.billable_item.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.object_type === "billable_item")) throw new Error("Billable audit missing records");
    const search = await expectStatus("search includes billable items", "GET", `/search?q=${encodeURIComponent("Billable Rate")}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "billable_item" && row.id === readyItem.billable_item.id)) throw new Error("Billable item was not searchable");

    assertNoFinance(await downstreamCounts(client), downstreamBefore, "billable smoke finance boundary");
    console.log("billable smoke passed");
  } finally {
    await client.end();
  }
}

async function createReadyItem(client, token, tenantId, userId) {
  const base = await createBase(client, tenantId, userId, { approvedQuantity: 50, billableCandidateQuantity: 50 });
  const rate = await createRate(client, tenantId, base.customerOrganizationId);
  const item = await expectStatus("helper ready item", "POST", "/billable-items", `Bearer ${token}`, 201, {
    qc_review_id: base.qcReviewId,
    billable_quantity: 50,
    rate_code_id: rate.rateCodeId,
    billing_package_status: "ready",
    documentation_status: "ready",
    customer_acceptance_status: "accepted",
    prime_acceptance_status: "accepted",
  });
  return { id: item.billable_item.id };
}

async function createBase(client, tenantId, userId, options = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const approvedQuantity = options.approvedQuantity ?? 100;
  const billableCandidateQuantity = options.billableCandidateQuantity ?? approvedQuantity;
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `BILL Territory ${suffix}`, `BI${suffix.slice(0, 4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'customer', 'customer') RETURNING id", [tenantId, territory.rows[0].id, `BILL Customer ${suffix}`]);
  const project = await client.query(
    "INSERT INTO projects (tenant_id, customer_organization_id, territory_id, name, status, work_type, scope_summary, location_summary, created_by, updated_by) VALUES ($1, $2, $3, $4, 'ready_for_work', 'fiber', 'Billable project scope', 'Billable project location', $5, $5) RETURNING id",
    [tenantId, organization.rows[0].id, territory.rows[0].id, `Billable Project ${suffix}`, userId],
  );
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, $3, 'subcontractor', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, organization.rows[0].id, `Billable Provider ${suffix}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'splicing', 'active') RETURNING id", [tenantId, provider.rows[0].id, `Billable Crew ${suffix}`]);
  const workOrder = await client.query(
    `INSERT INTO work_orders (
      tenant_id, project_id, assigned_capacity_provider_id, assigned_crew_id, title, work_order_name,
      work_type, territory_id, scope_summary, location_summary, expected_units, planned_quantity, unit_type, unit,
      status, qc_status, billable_status, assignment_type, completed_quantity, approved_quantity, billable_quantity
    ) VALUES ($1, $2, $3, $4, $5, $5, 'fiber', $6, 'Billable scope', 'Billable location', 100, 100, 'feet', 'feet', 'approved', 'approved', 'not_billable', 'subcontractor', 100, $7, 0) RETURNING id`,
    [tenantId, project.rows[0].id, provider.rows[0].id, crew.rows[0].id, `Billable Work Order ${suffix}`, territory.rows[0].id, approvedQuantity],
  );
  const production = await client.query(
    `INSERT INTO production_records (
      tenant_id, project_id, work_order_id, capacity_provider_id, crew_id, foreman_user_id, submitted_by, submitted_by_user_id,
      production_type, production_date, quantity_submitted, claimed_quantity, quantity, unit_type, unit, status, qc_status,
      approved_quantity, rejected_quantity, billable_quantity, billable_status, location_summary, description, submitted_at, approved_at, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $6, $6, 'daily_production', current_date, 100, 100, 100, 'feet', 'feet', 'approved', 'approved',
      $7, $8, $9, 'billable_candidate', 'Billable location', 'Billable field truth.', now(), now(), $6, $6) RETURNING id`,
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id, crew.rows[0].id, userId, approvedQuantity, Math.max(0, 100 - approvedQuantity), billableCandidateQuantity],
  );
  const review = await client.query(
    `INSERT INTO qc_reviews (
      tenant_id, production_record_id, work_order_id, project_id, review_type, review_status, reviewer_user_id, reviewed_at,
      claimed_quantity, approved_quantity, rejected_quantity, billable_candidate_quantity, unit,
      evidence_status, location_status, documentation_status, production_status, customer_acceptance_status, prime_acceptance_status,
      review_notes, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, 'internal_qc', 'approved', $5, now(), 100, $6, $7, $8, 'feet',
      'sufficient', 'valid', 'sufficient', 'valid', 'not_required', 'not_required', 'Approved for billable smoke.', $5, $5) RETURNING id`,
    [tenantId, production.rows[0].id, workOrder.rows[0].id, project.rows[0].id, userId, approvedQuantity, Math.max(0, 100 - approvedQuantity), billableCandidateQuantity],
  );
  return {
    projectId: project.rows[0].id,
    workOrderId: workOrder.rows[0].id,
    productionRecordId: production.rows[0].id,
    qcReviewId: review.rows[0].id,
    customerOrganizationId: organization.rows[0].id,
  };
}

async function createRate(client, tenantId, organizationId, options = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const contract = await client.query("INSERT INTO contracts (tenant_id, organization_id, name, contract_number, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id", [tenantId, organizationId, `Billable Contract ${suffix}`, `BC-${suffix}`]);
  const schedule = await client.query("INSERT INTO rate_schedules (tenant_id, contract_id, organization_id, name, effective_date, status) VALUES ($1, $2, $3, $4, current_date, 'active') RETURNING id", [tenantId, contract.rows[0].id, organizationId, `Billable Schedule ${suffix}`]);
  const rate = await client.query("INSERT INTO rate_codes (tenant_id, rate_schedule_id, code, description, unit, unit_type, amount, customer_rate, status) VALUES ($1, $2, $3, 'Billable Rate', 'feet', 'feet', $4, $4, 'active') RETURNING id", [tenantId, schedule.rows[0].id, `BILL-${suffix}`, options.amount ?? 10]);
  return { rateCodeId: rate.rows[0].id };
}

async function createOutsideTenant(client) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [`Outside BILL ${suffix}`, `outside-bill-${suffix}`]);
  const base = await createBase(client, tenant.rows[0].id, null, { approvedQuantity: 1, billableCandidateQuantity: 1 });
  const item = await client.query(
    `INSERT INTO billable_items (
      tenant_id, project_id, work_order_id, production_record_id, qc_review_id, customer_organization_id,
      status, readiness_status, approved_quantity, billable_quantity, held_quantity, unit, rate_source, rate_confidence,
      customer_acceptance_status, prime_acceptance_status, billing_package_status, documentation_status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'candidate', 'needs_review', 1, 1, 0, 'feet', 'unknown', 'unknown', 'not_required', 'not_required', 'not_started', 'not_started') RETURNING id`,
    [tenant.rows[0].id, base.projectId, base.workOrderId, base.productionRecordId, base.qcReviewId, base.customerOrganizationId],
  );
  return { billableItemId: item.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, $2, 'x', 'active') RETURNING id", [`billable-limited-${suffix}@example.com`, "Billable Limited"]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function assignRole(client, tenantId, tenantUserId, roleName) {
  const role = await client.query("SELECT id FROM roles WHERE tenant_id = $1 AND name = $2", [tenantId, roleName]);
  if (!role.rows[0]) throw new Error(`${roleName} role was not seeded`);
  await client.query(
    `
      INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
      VALUES ($1, $2, $3, 'tenant', $1)
      ON CONFLICT (tenant_user_id, role_id, scope_type, scope_id) DO NOTHING
    `,
    [tenantId, tenantUserId, role.rows[0].id],
  );
}

async function downstreamCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM settlement_items) AS settlement_items,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM ar_records) AS ar_records
  `);
  return result.rows[0];
}

function assertNoFinance(after, before, label) {
  for (const key of ["settlements", "settlement_items", "invoices", "payments", "ar_records"]) {
    if (after[key] !== before[key]) throw new Error(`${label}: ${key} changed`);
  }
}

async function expectStatus(label, method, path, authorization, expectedStatus, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { ...(authorization ? { authorization } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function createToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
