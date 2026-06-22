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
    const { user_id: adminUserId, tenant_id: tenantId, tenant_user_id: adminTenantUserId } = seeded.rows[0];
    for (const role of ["QC Manager", "Project Manager", "Operations Manager", "Billing Manager"]) {
      await assignRole(client, tenantId, adminTenantUserId, role);
    }
    const adminToken = createToken({ sub: adminUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedUserId = await createLimitedUser(client, tenantId, "qc-limited");
    const limitedToken = createToken({ sub: limitedUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const selfUser = await createQcUser(client, tenantId);
    const selfToken = createToken({ sub: selfUser.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const base = await createBase(client, tenantId, adminUserId);
    const selfBase = await createBase(client, tenantId, selfUser.userId);
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/qc-reviews", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/qc-reviews", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/qc-reviews/${outside.qcReviewId}`, `Bearer ${adminToken}`, 404);

    const downstreamBefore = await downstreamCounts(client);
    const review = await expectStatus("review create works", "POST", "/qc-reviews", `Bearer ${adminToken}`, 201, {
      production_record_id: base.productionRecordId,
      review_type: "internal_qc",
      review_notes: "QC smoke review.",
    });
    if (review.qc_review.review_status !== "pending") throw new Error("QC review was not created pending");

    const selfReview = await expectStatus("self review create works", "POST", "/qc-reviews", `Bearer ${selfToken}`, 201, {
      production_record_id: selfBase.productionRecordId,
      review_type: "internal_qc",
    });
    await expectStatus("self approval blocked", "POST", `/qc-reviews/${selfReview.qc_review.id}/approve`, `Bearer ${selfToken}`, 403, {
      approval_note: "Self approve should fail.",
      approved_quantity: 10,
    });

    const started = await expectStatus("review start works", "POST", `/qc-reviews/${review.qc_review.id}/start-review`, `Bearer ${adminToken}`, 201, {});
    if (started.qc_review.review_status !== "in_review") throw new Error("QC review did not start");
    const approved = await expectStatus("review approve works", "POST", `/qc-reviews/${review.qc_review.id}/approve`, `Bearer ${adminToken}`, 201, {
      approval_note: "Accepted in QC smoke.",
      approved_quantity: 80,
      billable_candidate_quantity: 70,
      evidence_status: "sufficient",
      location_status: "valid",
      documentation_status: "sufficient",
      production_status: "valid",
    });
    if (approved.qc_review.review_status !== "approved" || Number(approved.qc_review.billable_candidate_quantity) !== 70) throw new Error("QC approval did not persist quantities");
    const productionAfterApprove = await client.query("SELECT status, qc_status, approved_quantity, rejected_quantity, billable_status FROM production_records WHERE id = $1", [base.productionRecordId]);
    if (productionAfterApprove.rows[0].qc_status !== "approved" || Number(productionAfterApprove.rows[0].approved_quantity) !== 80 || productionAfterApprove.rows[0].billable_status !== "billable_candidate") {
      throw new Error("Production summary did not update from approved QC");
    }
    assertNoFinance(await downstreamCounts(client), downstreamBefore, "approved QC boundary");

    const rejectBase = await createBase(client, tenantId, adminUserId);
    const rejectReview = await expectStatus("reject review create works", "POST", "/qc-reviews", `Bearer ${adminToken}`, 201, { production_record_id: rejectBase.productionRecordId });
    await expectStatus("review reject requires reason", "POST", `/qc-reviews/${rejectReview.qc_review.id}/reject`, `Bearer ${adminToken}`, 400, {});
    const rejected = await expectStatus("review reject works", "POST", `/qc-reviews/${rejectReview.qc_review.id}/reject`, `Bearer ${adminToken}`, 201, { rejection_reason: "evidence_failed", rejected_quantity: 100 });
    if (rejected.qc_review.review_status !== "rejected") throw new Error("QC rejection failed");

    const correctionBase = await createBase(client, tenantId, adminUserId);
    const correctionReview = await expectStatus("correction review create works", "POST", "/qc-reviews", `Bearer ${adminToken}`, 201, { production_record_id: correctionBase.productionRecordId });
    await expectStatus("correction request requires reason", "POST", `/qc-reviews/${correctionReview.qc_review.id}/request-correction`, `Bearer ${adminToken}`, 400, {});
    const correction = await expectStatus("correction requested works", "POST", `/qc-reviews/${correctionReview.qc_review.id}/request-correction`, `Bearer ${adminToken}`, 201, {
      correction_reason: "needs_after_photo",
      correction_required_quantity: 25,
    });
    if (correction.qc_review.review_status !== "correction_required") throw new Error("QC correction request failed");
    const corrected = await expectStatus("corrected works", "POST", `/qc-reviews/${correctionReview.qc_review.id}/mark-corrected`, `Bearer ${adminToken}`, 201, { correction_note: "Correction submitted." });
    if (corrected.qc_review.review_status !== "corrected") throw new Error("QC corrected state failed");

    const list = await expectStatus("list returns enriched QC rows", "GET", "/qc-reviews", `Bearer ${adminToken}`, 200);
    const listed = list.find((row) => row.id === review.qc_review.id);
    if (!listed || listed.production_type === undefined || listed.work_order_name === undefined || listed.recommended_next_action === undefined) throw new Error("QC list was not enriched");
    const detail = await expectStatus("detail returns QC context", "GET", `/qc-reviews/${review.qc_review.id}/detail`, `Bearer ${adminToken}`, 200);
    if (!detail.production_record || !detail.work_order_context || !detail.project_context || !detail.quantity_summary || !detail.acceptance) throw new Error("QC detail missing required context");
    const timeline = await expectStatus("timeline works", "GET", `/qc-reviews/${review.qc_review.id}/timeline`, `Bearer ${adminToken}`, 200);
    for (const eventType of ["qc_review.created", "qc_review.started", "qc_review.approved"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`QC timeline missing ${eventType}`);
    }
    await expectStatus("audit enforces permission", "GET", `/qc-reviews/${review.qc_review.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit works", "GET", `/qc-reviews/${review.qc_review.id}/audit-summary`, `Bearer ${adminToken}`, 200);
    if (!audit.some((row) => row.object_type === "qc_review")) throw new Error("QC audit missing review records");
    const search = await expectStatus("search includes qc reviews", "GET", `/search?q=${encodeURIComponent("Accepted in QC smoke")}`, `Bearer ${adminToken}`, 200);
    if (!search.some((row) => row.object_type === "qc_review" && row.id === review.qc_review.id)) throw new Error("QC review was not searchable");
    assertNoFinance(await downstreamCounts(client), downstreamBefore, "QC smoke finance boundary");

    console.log("qc smoke passed");
  } finally {
    await client.end();
  }
}

async function createBase(client, tenantId, userId) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `QC Territory ${suffix}`, `QC${suffix.slice(0, 4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'customer', 'customer') RETURNING id", [tenantId, territory.rows[0].id, `QC Customer ${suffix}`]);
  const project = await client.query(
    "INSERT INTO projects (tenant_id, customer_organization_id, territory_id, name, status, work_type, scope_summary, location_summary, created_by, updated_by) VALUES ($1, $2, $3, $4, 'ready_for_work', 'fiber', 'QC project scope', 'QC project location', $5, $5) RETURNING id",
    [tenantId, organization.rows[0].id, territory.rows[0].id, `QC Project ${suffix}`, userId],
  );
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, $3, 'subcontractor', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, organization.rows[0].id, `QC Provider ${suffix}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'splicing', 'active') RETURNING id", [tenantId, provider.rows[0].id, `QC Crew ${suffix}`]);
  const workOrder = await client.query(
    `INSERT INTO work_orders (
      tenant_id, project_id, assigned_capacity_provider_id, assigned_crew_id, title, work_order_name,
      work_type, territory_id, scope_summary, location_summary, location_description, expected_units,
      planned_quantity, unit_type, unit, status, assignment_type, completed_quantity, approved_quantity, billable_quantity
    ) VALUES ($1, $2, $3, $4, $5, $5, 'fiber', $6, 'QC smoke scope', 'QC smoke location', 'QC smoke location', 100, 100, 'feet', 'feet', 'in_progress', 'subcontractor', 0, 0, 0) RETURNING id`,
    [tenantId, project.rows[0].id, provider.rows[0].id, crew.rows[0].id, `QC Smoke Work Order ${suffix}`, territory.rows[0].id],
  );
  const production = await client.query(
    `INSERT INTO production_records (
      tenant_id, project_id, work_order_id, capacity_provider_id, crew_id, foreman_user_id, submitted_by, submitted_by_user_id,
      production_type, production_date, quantity_submitted, claimed_quantity, quantity, unit_type, unit, status, qc_status,
      billable_status, location_summary, description, submitted_at, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $6, $6, 'daily_production', current_date, 100, 100, 100, 'feet', 'feet', 'submitted', 'pending_review', 'not_billable', 'QC smoke location', 'QC smoke review field claim.', now(), $6, $6) RETURNING id`,
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id, crew.rows[0].id, userId],
  );
  return { projectId: project.rows[0].id, workOrderId: workOrder.rows[0].id, productionRecordId: production.rows[0].id };
}

async function createOutsideTenant(client) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [`Outside QC ${suffix}`, `outside-qc-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, 'Outside QC Org', 'customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const project = await client.query("INSERT INTO projects (tenant_id, customer_organization_id, name, status) VALUES ($1, $2, 'Outside QC Project', 'ready_for_work') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status) VALUES ($1, $2, 'Outside QC Provider', 'subcontractor', 'activated') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const workOrder = await client.query("INSERT INTO work_orders (tenant_id, project_id, title, work_order_name, work_type, scope_summary, location_summary, expected_units, planned_quantity, unit_type, unit, status) VALUES ($1, $2, 'Outside QC WO', 'Outside QC WO', 'fiber', 'Outside scope', 'Outside location', 1, 1, 'feet', 'feet', 'in_progress') RETURNING id", [tenant.rows[0].id, project.rows[0].id]);
  const production = await client.query("INSERT INTO production_records (tenant_id, project_id, work_order_id, capacity_provider_id, production_type, production_date, quantity_submitted, claimed_quantity, quantity, unit_type, unit, status) VALUES ($1, $2, $3, $4, 'daily_production', current_date, 1, 1, 1, 'feet', 'feet', 'submitted') RETURNING id", [tenant.rows[0].id, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id]);
  const review = await client.query("INSERT INTO qc_reviews (tenant_id, production_record_id, work_order_id, project_id, review_type, review_status, claimed_quantity, unit) VALUES ($1, $2, $3, $4, 'internal_qc', 'pending', 1, 'feet') RETURNING id", [tenant.rows[0].id, production.rows[0].id, workOrder.rows[0].id, project.rows[0].id]);
  return { qcReviewId: review.rows[0].id };
}

async function createLimitedUser(client, tenantId, prefix) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, $2, 'x', 'active') RETURNING id", [`${prefix}-${suffix}@example.com`, `${prefix} user`]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function createQcUser(client, tenantId) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, 'QC Smoke Reviewer', 'x', 'active') RETURNING id", [`qc-reviewer-${suffix}@example.com`]);
  const tenantUser = await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id", [tenantId, user.rows[0].id]);
  for (const role of ["QC Manager", "Project Manager"]) {
    await assignRole(client, tenantId, tenantUser.rows[0].id, role);
    await grantRolePermissions(client, tenantId, role, ["qc_review.read", "qc_review.create", "qc_review.start", "qc_review.approve", "qc_review.reject", "qc_review.request_correction", "qc_review.mark_corrected", "qc_review.timeline.read", "qc_review.audit.read"]);
  }
  return { userId: user.rows[0].id, tenantUserId: tenantUser.rows[0].id };
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

async function grantRolePermissions(client, tenantId, roleName, permissionKeys) {
  const role = await client.query("SELECT id FROM roles WHERE tenant_id = $1 AND name = $2", [tenantId, roleName]);
  if (!role.rows[0]) throw new Error(`${roleName} role was not seeded`);
  await client.query(
    `
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT $1, $2, p.id
    FROM permissions p
    WHERE p.key = ANY($3::text[])
    ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [tenantId, role.rows[0].id, permissionKeys],
  );
}

async function downstreamCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM ar_records) AS ar_records
  `);
  return result.rows[0];
}

function assertNoFinance(after, before, label) {
  for (const key of ["settlements", "invoices", "payments", "ar_records"]) {
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
