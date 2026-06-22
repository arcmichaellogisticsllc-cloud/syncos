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
    for (const role of ["QC Manager", "Project Manager", "Operations Manager", "Billing Manager", "Safety Manager", "Executive"]) {
      await assignRole(client, tenantId, tenantUserId, role);
    }
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedUserId = await createLimitedUser(client, tenantId);
    const limitedToken = createToken({ sub: limitedUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const base = await createBase(client, tenantId, userId, "ready_for_work", "in_progress");
    const planningBase = await createBase(client, tenantId, userId, "planning", "in_progress");
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/production-records", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/production-records", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross-tenant blocked", "GET", `/production-records/${outside.productionRecordId}`, `Bearer ${token}`, 404);
    await expectStatus("production requires work order", "POST", "/production-records", `Bearer ${token}`, 400, productionPayload(base, { work_order_id: undefined }));
    await expectStatus("project not ready blocks production without override", "POST", "/production-records", `Bearer ${token}`, 400, productionPayload(planningBase));
    await expectStatus("production requires performer context", "POST", "/production-records", `Bearer ${token}`, 400, productionPayload(base, { capacity_provider_id: null, crew_id: null, foreman_user_id: null }));
    await expectStatus("unit mismatch requires override", "POST", "/production-records", `Bearer ${token}`, 400, productionPayload(base, { unit: "drops" }));
    await expectStatus("quantity overage requires override", "POST", "/production-records", `Bearer ${token}`, 400, productionPayload(base, { claimed_quantity: 5000 }));

    const downstreamBefore = await downstreamCounts(client);
    const daily = await expectStatus("submitted production can be created", "POST", "/production-records", `Bearer ${token}`, 201, productionPayload(base));
    if (daily.status !== "submitted" || daily.production_type !== "daily_production") throw new Error("submitted production was not created");
    assertNoFinance(await downstreamCounts(client), downstreamBefore, "submitted create boundary");

    await expectStatus("completion requires evidence or override", "POST", "/production-records", `Bearer ${token}`, 400, productionPayload(base, { production_type: "completion_submission", status: "submitted" }));
    const draft = await expectStatus("draft production can be created", "POST", "/production-records", `Bearer ${token}`, 201, productionPayload(base, { production_type: "completion_submission", status: "draft" }));
    if (draft.status !== "draft") throw new Error("draft production was not created");

    const evidence = await expectStatus("evidence metadata create works", "POST", `/production-records/${draft.id}/evidence`, `Bearer ${token}`, 201, {
      evidence_type: "photo",
      caption: "Completion evidence",
      file_url: "https://example.test/production.jpg",
      metadata: { source: "smoke" },
    });
    if (!evidence.id || evidence.status !== "active") throw new Error("evidence metadata was not created");
    await expectStatus("evidence archive requires reason", "POST", `/production-evidence/${evidence.id}/archive`, `Bearer ${token}`, 400, {});
    const activeEvidence = await expectStatus("replacement evidence metadata create works", "POST", `/production-records/${draft.id}/evidence`, `Bearer ${token}`, 201, {
      evidence_type: "after_photo",
      caption: "Replacement completion evidence",
      storage_reference: "production/smoke/replacement",
    });
    if (!activeEvidence.id) throw new Error("active evidence was not created");

    const submitted = await expectStatus("submit route works", "POST", `/production-records/${draft.id}/submit`, `Bearer ${token}`, 201, {});
    if (submitted.status !== "submitted") throw new Error("draft was not submitted");
    const review = await expectStatus("start review works", "POST", `/production-records/${draft.id}/start-review`, `Bearer ${token}`, 201, {});
    if (review.status !== "under_review" || review.qc_status !== "pending_review") throw new Error("review did not start");
    const approved = await expectStatus("approve route works", "POST", `/production-records/${draft.id}/approve`, `Bearer ${token}`, 201, { approved_quantity: 100, approval_note: "Approved in smoke." });
    if (approved.status !== "approved" || Number(approved.approved_quantity) !== 100) throw new Error("production was not approved");

    const rejectedTarget = await createSubmittedWithEvidence(token, base);
    await expectStatus("reject requires reason", "POST", `/production-records/${rejectedTarget.id}/reject`, `Bearer ${token}`, 400, {});
    const rejected = await expectStatus("reject works", "POST", `/production-records/${rejectedTarget.id}/reject`, `Bearer ${token}`, 201, { rejection_reason: "bad_evidence", rejected_quantity: 25 });
    if (rejected.status !== "rejected") throw new Error("production was not rejected");

    const correctionTarget = await createSubmittedWithEvidence(token, base);
    await expectStatus("correction request requires reason", "POST", `/production-records/${correctionTarget.id}/request-correction`, `Bearer ${token}`, 400, {});
    const correction = await expectStatus("correction request works", "POST", `/production-records/${correctionTarget.id}/request-correction`, `Bearer ${token}`, 201, { correction_reason: "need_updated_photo" });
    if (correction.status !== "correction_required") throw new Error("correction was not requested");
    await expectStatus("correction evidence create works", "POST", `/production-records/${correctionTarget.id}/evidence`, `Bearer ${token}`, 201, {
      evidence_type: "after_photo",
      caption: "Correction evidence",
      storage_reference: "production/smoke/correction",
    });
    const corrected = await expectStatus("mark corrected works", "POST", `/production-records/${correctionTarget.id}/mark-corrected`, `Bearer ${token}`, 201, { correction_note: "Corrected.", corrected_quantity: 15 });
    if (corrected.status !== "corrected") throw new Error("production was not marked corrected");

    const beforeBillable = await downstreamCounts(client);
    await expectStatus("mark billable creates no finance", "POST", `/production-records/${draft.id}/mark-billable`, `Bearer ${token}`, 201, { billable_quantity: 100 });
    assertNoFinance(await downstreamCounts(client), beforeBillable, "mark billable boundary");

    const voidTarget = await createSubmittedWithEvidence(token, base);
    await expectStatus("void requires reason", "POST", `/production-records/${voidTarget.id}/void`, `Bearer ${token}`, 400, {});
    const voided = await expectStatus("void works", "POST", `/production-records/${voidTarget.id}/void`, `Bearer ${token}`, 201, { void_reason: "created_in_error" });
    if (voided.status !== "voided") throw new Error("production was not voided");

    const archiveTarget = await createSubmittedWithEvidence(token, base);
    await expectStatus("archive requires reason", "POST", `/production-records/${archiveTarget.id}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("archive works", "POST", `/production-records/${archiveTarget.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "other" });

    const list = await expectStatus("list returns enriched fields", "GET", "/production-records", `Bearer ${token}`, 200);
    const listed = list.find((row) => row.id === draft.id);
    if (!listed || listed.project_name === undefined || listed.work_order_name === undefined || listed.evidence_count === undefined) throw new Error("production list was not enriched");
    const detail = await expectStatus("detail returns context", "GET", `/production-records/${draft.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.project_context || !detail.work_order_context || !detail.evidence || !detail.quantity_summary || !detail.qc_summary || !detail.billable_summary) throw new Error("production detail missing sections");
    const timeline = await expectStatus("timeline returns production and evidence events", "GET", `/production-records/${draft.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["production.created", "production.submitted", "production.review_started", "production.approved", "production.marked_billable", "production_evidence.created"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`production timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/production-records/${draft.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/production-records/${draft.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.object_type === "production_record")) throw new Error("production audit missing production records");
    const search = await expectStatus("search includes production records", "GET", `/search?q=${encodeURIComponent("Production smoke")}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "production_record" && row.id === draft.id)) throw new Error("production was not searchable");

    console.log("production smoke passed");
  } finally {
    await client.end();
  }
}

function productionPayload(base, overrides = {}) {
  const payload = {
    work_order_id: base.workOrderId,
    production_type: "daily_production",
    production_date: "2026-09-05",
    claimed_quantity: 100,
    unit: "feet",
    location_summary: "Production smoke location",
    description: "Production smoke field truth.",
    capacity_provider_id: base.providerId,
    crew_id: base.crewId,
    foreman_user_id: base.userId,
    ...overrides,
  };
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }
  return payload;
}

async function createSubmittedWithEvidence(token, base) {
  const draft = await expectStatus("create draft for helper", "POST", "/production-records", `Bearer ${token}`, 201, productionPayload(base, { production_type: "completion_submission", status: "draft", claimed_quantity: 25 }));
  await expectStatus("create helper evidence", "POST", `/production-records/${draft.id}/evidence`, `Bearer ${token}`, 201, {
    evidence_type: "photo",
    caption: "Helper evidence",
    storage_reference: `production/smoke/${draft.id}`,
  });
  return expectStatus("submit helper production", "POST", `/production-records/${draft.id}/submit`, `Bearer ${token}`, 201, {});
}

async function createBase(client, tenantId, userId, projectStatus, workOrderStatus) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `PROD Territory ${suffix}`, `PR${suffix.slice(0, 4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'customer', 'customer') RETURNING id", [tenantId, territory.rows[0].id, `PROD Customer ${suffix}`]);
  const project = await client.query(
    "INSERT INTO projects (tenant_id, customer_organization_id, territory_id, name, status, work_type, scope_summary, location_summary, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, 'fiber', 'Production project scope', 'Production project location', $6, $6) RETURNING id",
    [tenantId, organization.rows[0].id, territory.rows[0].id, `Production Project ${suffix}`, projectStatus, userId],
  );
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, $3, 'subcontractor', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, organization.rows[0].id, `Production Provider ${suffix}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'splicing', 'active') RETURNING id", [tenantId, provider.rows[0].id, `Production Crew ${suffix}`]);
  const workOrder = await client.query(
    `INSERT INTO work_orders (
      tenant_id, project_id, assigned_capacity_provider_id, assigned_crew_id, title, work_order_name,
      work_type, territory_id, scope_summary, location_summary, location_description, expected_units,
      planned_quantity, unit_type, unit, status, assignment_type, completed_quantity, approved_quantity, billable_quantity
    ) VALUES ($1, $2, $3, $4, $5, $5, 'fiber', $6, 'Production smoke scope', 'Production smoke location', 'Production smoke location', 1000, 1000, 'feet', 'feet', $7, 'subcontractor', 0, 0, 0) RETURNING id`,
    [tenantId, project.rows[0].id, provider.rows[0].id, crew.rows[0].id, `Production Smoke Work Order ${suffix}`, territory.rows[0].id, workOrderStatus],
  );
  return { userId, territoryId: territory.rows[0].id, organizationId: organization.rows[0].id, projectId: project.rows[0].id, providerId: provider.rows[0].id, crewId: crew.rows[0].id, workOrderId: workOrder.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, $2, 'x', 'active') RETURNING id", [`production-limited-${suffix}@example.com`, "Production Limited"]);
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

async function createOutsideTenant(client) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [`Outside PROD ${suffix}`, `outside-prod-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, 'Outside Production Org', 'customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const project = await client.query("INSERT INTO projects (tenant_id, customer_organization_id, name, status) VALUES ($1, $2, 'Outside Production Project', 'active') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status) VALUES ($1, $2, 'Outside Production Provider', 'subcontractor', 'activated') RETURNING id", [tenant.rows[0].id, organization.rows[0].id]);
  const workOrder = await client.query("INSERT INTO work_orders (tenant_id, project_id, title, work_order_name, work_type, scope_summary, location_summary, expected_units, planned_quantity, unit_type, unit, status) VALUES ($1, $2, 'Outside Production WO', 'Outside Production WO', 'fiber', 'Outside scope', 'Outside location', 1, 1, 'feet', 'feet', 'in_progress') RETURNING id", [tenant.rows[0].id, project.rows[0].id]);
  const production = await client.query("INSERT INTO production_records (tenant_id, project_id, work_order_id, capacity_provider_id, production_type, production_date, quantity_submitted, claimed_quantity, quantity, unit_type, unit, status) VALUES ($1, $2, $3, $4, 'daily_production', current_date, 1, 1, 1, 'feet', 'feet', 'submitted') RETURNING id", [tenant.rows[0].id, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id]);
  return { productionRecordId: production.rows[0].id };
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
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (response.status !== expectedStatus) throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}: ${text}`);
  return parsed;
}

function createToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
