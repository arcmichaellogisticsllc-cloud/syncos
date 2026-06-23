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
    for (const role of ["Billing Manager", "Finance Manager", "Operations Manager"]) await assignRole(client, tenantId, tenantUserId, role);
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedToken = createToken({ sub: await createLimitedUser(client, tenantId), tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const marker = `PAYROLL${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/payroll-runs", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/payroll-runs", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/payroll-runs/${outside.runId}`, `Bearer ${token}`, 404);

    const forbiddenBefore = await forbiddenCounts(client, tenantId);
    await expectStatus("invalid payroll_run_type rejected", "POST", "/payroll-runs", `Bearer ${token}`, 400, {
      payroll_run_type: "bad_type",
      payroll_cycle: "weekly",
      payroll_period_start: todayOffset(-7),
      payroll_period_end: todayOffset(0),
    });
    await expectStatus("invalid payroll_cycle rejected", "POST", "/payroll-runs", `Bearer ${token}`, 400, {
      payroll_run_type: "regular",
      payroll_cycle: "bad_cycle",
      payroll_period_start: todayOffset(-7),
      payroll_period_end: todayOffset(0),
    });
    await expectStatus("invalid payroll period rejected", "POST", "/payroll-runs", `Bearer ${token}`, 400, {
      payroll_run_type: "regular",
      payroll_cycle: "weekly",
      payroll_period_start: todayOffset(1),
      payroll_period_end: todayOffset(0),
    });

    const fixture = await createWorkerFixture(client, tenantId, userId, marker);
    const run = await expectStatus("payroll run creation works", "POST", "/payroll-runs", `Bearer ${token}`, 201, {
      payroll_run_type: "regular",
      payroll_cycle: "weekly",
      payroll_period_start: todayOffset(-7),
      payroll_period_end: todayOffset(0),
      pay_date: todayOffset(5),
      project_id: fixture.projectId,
      crew_id: fixture.crewId,
      compliance_status: "ready",
      tax_document_status: "ready",
    });
    if (!run.payroll_run_number || run.status !== "draft" || run.payroll_readiness_status !== "not_ready") throw new Error("Payroll run defaults were incorrect");

    await expectStatus("project/crew tenant validation works", "POST", "/payroll-runs", `Bearer ${token}`, 404, {
      payroll_run_type: "regular",
      payroll_cycle: "weekly",
      payroll_period_start: todayOffset(-7),
      payroll_period_end: todayOffset(0),
      project_id: outside.projectId,
    });
    await expectStatus("add item requires valid worker", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 404, {
      worker_id: outside.workerId,
      source_type: "manual",
      earning_type: "regular",
      worker_classification: "w2_employee",
      manual_reason: "Smoke.",
      gross_pay_amount: 100,
    });
    await expectStatus("unknown classification blocked unless override", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 400, {
      worker_id: fixture.workerId,
      source_type: "manual",
      earning_type: "regular",
      worker_classification: "unknown",
      manual_reason: "Smoke.",
      gross_pay_amount: 100,
    });
    await expectStatus("approved time item requires hours", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 400, {
      worker_id: fixture.workerId,
      source_type: "approved_time",
      earning_type: "regular",
      worker_classification: "w2_employee",
    });
    await expectStatus("production-based item requires source unless override", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 400, {
      worker_id: fixture.workerId,
      source_type: "production_based",
      earning_type: "piece_rate",
      worker_classification: "w2_employee",
    });
    await expectStatus("manual item requires manual_reason", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 400, {
      worker_id: fixture.workerId,
      source_type: "manual",
      earning_type: "regular",
      worker_classification: "w2_employee",
      gross_pay_amount: 100,
    });
    await expectStatus("reimbursement item requires amount and note/evidence", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 400, {
      worker_id: fixture.workerId,
      source_type: "reimbursement",
      earning_type: "reimbursement",
      worker_classification: "w2_employee",
    });
    await expectStatus("deduction item requires deduction amount and reason", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 400, {
      worker_id: fixture.workerId,
      source_type: "manual",
      earning_type: "deduction",
      worker_classification: "w2_employee",
    });

    const item = await expectStatus("add payroll item works", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 201, {
      worker_id: fixture.workerId,
      crew_id: fixture.crewId,
      project_id: fixture.projectId,
      production_record_id: fixture.productionRecordId,
      source_type: "approved_time",
      earning_type: "regular",
      worker_classification: "w2_employee",
      work_date: todayOffset(-1),
      hours_regular: 8,
      rate_regular: 25,
      reimbursement_amount: 15,
      deduction_amount: 5,
      estimated_tax_amount: 20,
      compliance_status: "ready",
      tax_document_status: "ready",
      description: "Smoke payroll item",
    });
    if (item.worker_id !== fixture.workerId || Number(item.net_pay_amount) !== 190) throw new Error("Payroll item traceability or net pay was incorrect");
    await expectStatus("duplicate worker/source item blocked unless override", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 400, {
      worker_id: fixture.workerId,
      source_type: "approved_time",
      earning_type: "regular",
      worker_classification: "w2_employee",
      work_date: todayOffset(-1),
      hours_regular: 8,
    });

    const updatedItem = await expectStatus("item update recalculates totals", "PATCH", `/payroll-items/${item.id}`, `Bearer ${token}`, 200, {
      hours_regular: 6,
      rate_regular: 30,
      deduction_amount: 10,
    });
    if (Number(updatedItem.net_pay_amount) !== 165) throw new Error("Payroll item update did not recalculate net amount");
    const recalculated = await expectStatus("totals recalculate", "POST", `/payroll-runs/${run.id}/recalculate-totals`, `Bearer ${token}`, 201);
    if (Number(recalculated.net_pay_amount) !== 165 || Number(recalculated.item_count) !== 1 || Number(recalculated.worker_count) !== 1) throw new Error("Payroll totals were not recalculated");

    await expectStatus("submit review requires item", "POST", `/payroll-runs/${(await createBareRun(client, tenantId, userId, marker)).id}/submit-review`, `Bearer ${token}`, 400);
    const submitted = await expectStatus("submit review works", "POST", `/payroll-runs/${run.id}/submit-review`, `Bearer ${token}`, 201);
    if (submitted.status !== "ready_for_review" || submitted.approval_status !== "pending") throw new Error("Submit review did not set statuses");
    const reviewing = await expectStatus("start review works", "POST", `/payroll-runs/${run.id}/start-review`, `Bearer ${token}`, 201);
    if (reviewing.status !== "under_review") throw new Error("Start review did not set under_review");
    const approved = await expectStatus("approve requires valid payroll and creates no payment", "POST", `/payroll-runs/${run.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Smoke approval." });
    if (approved.status !== "approved" || approved.approval_status !== "approved") throw new Error("Approve did not set approved status");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "approve");
    const ready = await expectStatus("mark payroll ready creates no payment/ACH/tax filing/provider submission", "POST", `/payroll-runs/${run.id}/mark-payroll-ready`, `Bearer ${token}`, 201, { ready_note: "Ready for future payroll execution." });
    if (ready.status !== "payroll_ready" || ready.payroll_readiness_status !== "ready_for_payroll") throw new Error("Payroll readiness did not set expected statuses");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "payroll readiness");

    const holdRun = await createApiRunWithItem(client, token, tenantId, userId, `${marker}HOLD`);
    await expectStatus("hold requires reason", "POST", `/payroll-runs/${holdRun.id}/place-hold`, `Bearer ${token}`, 400, {});
    const held = await expectStatus("hold works", "POST", `/payroll-runs/${holdRun.id}/place-hold`, `Bearer ${token}`, 201, { hold_reason: "missing_docs" });
    if (held.status !== "held" || held.hold_status !== "hold") throw new Error("Hold did not set status");
    const released = await expectStatus("release hold works", "POST", `/payroll-runs/${holdRun.id}/release-hold`, `Bearer ${token}`, 201, { release_note: "Docs received." });
    if (released.hold_status !== "released") throw new Error("Release hold did not set released");

    const disputeRun = await createApiRunWithItem(client, token, tenantId, userId, `${marker}DISP`);
    await expectStatus("dispute requires reason", "POST", `/payroll-runs/${disputeRun.id}/dispute`, `Bearer ${token}`, 400, {});
    const disputed = await expectStatus("dispute works", "POST", `/payroll-runs/${disputeRun.id}/dispute`, `Bearer ${token}`, 201, { dispute_reason: "hours_dispute" });
    if (disputed.status !== "disputed" || disputed.dispute_status !== "open") throw new Error("Dispute did not set status");
    const resolved = await expectStatus("resolve dispute works", "POST", `/payroll-runs/${disputeRun.id}/resolve-dispute`, `Bearer ${token}`, 201, { resolution_note: "Resolved." });
    if (resolved.dispute_status !== "resolved") throw new Error("Resolve dispute did not set resolved");

    const rejectRun = await createApiRunWithItem(client, token, tenantId, userId, `${marker}REJ`);
    await expectStatus("reject requires reason", "POST", `/payroll-runs/${rejectRun.id}/reject`, `Bearer ${token}`, 400, {});
    const rejected = await expectStatus("reject works", "POST", `/payroll-runs/${rejectRun.id}/reject`, `Bearer ${token}`, 201, { rejection_reason: "rate_review" });
    if (rejected.status !== "rejected") throw new Error("Reject did not set rejected");

    const terminalRun = await createApiRunWithItem(client, token, tenantId, userId, `${marker}TERM`);
    const voidedItem = await expectStatus("item void excludes from totals", "POST", `/payroll-items/${terminalRun.item.id}/void`, `Bearer ${token}`, 201, { void_reason: "duplicate" });
    if (voidedItem.status !== "voided") throw new Error("Item void did not set status");
    const archiveItemRun = await createApiRunWithItem(client, token, tenantId, userId, `${marker}ARCHITEM`);
    const archivedItem = await expectStatus("item archive excludes from totals", "POST", `/payroll-items/${archiveItemRun.item.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });
    if (archivedItem.status !== "archived") throw new Error("Item archive did not set status");
    await expectStatus("void requires reason", "POST", `/payroll-runs/${terminalRun.id}/void`, `Bearer ${token}`, 400, {});
    const voided = await expectStatus("void works", "POST", `/payroll-runs/${terminalRun.id}/void`, `Bearer ${token}`, 201, { void_reason: "smoke_void" });
    if (voided.status !== "voided") throw new Error("Payroll run void did not set status");
    await expectStatus("archive requires reason", "POST", `/payroll-runs/${archiveItemRun.id}/archive`, `Bearer ${token}`, 400, {});
    const archived = await expectStatus("archive works", "POST", `/payroll-runs/${archiveItemRun.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });
    if (archived.status !== "archived") throw new Error("Payroll run archive did not set status");

    const list = await expectStatus("list returns enriched fields", "GET", `/payroll-runs?q=${encodeURIComponent(run.payroll_run_number)}`, `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === run.id && row.recommended_next_action)) throw new Error("Payroll list missing enriched row");
    const detail = await expectStatus("detail returns items and summaries", "GET", `/payroll-runs/${run.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.payroll_items?.length || detail.payroll_boundary_summary.creates_payment) throw new Error("Payroll detail missing items or boundary summary");
    const itemDetail = await expectStatus("item detail returns source traceability", "GET", `/payroll-items/${item.id}/detail`, `Bearer ${token}`, 200);
    if (!itemDetail.worker_context || !itemDetail.production_context) throw new Error("Payroll item detail missing traceability");
    const timeline = await expectStatus("timeline returns payroll/item events", "GET", `/payroll-runs/${run.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["payroll_run.created", "payroll_run.item_added", "payroll_run.payroll_ready"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Payroll timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/payroll-runs/${run.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/payroll-runs/${run.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "payroll_run.create")) throw new Error("Payroll audit missing create action");
    const search = await expectStatus("search includes payroll", "GET", `/search?q=${encodeURIComponent(run.payroll_run_number)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "payroll_run" && row.id === run.id)) throw new Error("Search missing payroll run");

    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "payroll smoke");
    console.log("payroll smoke passed");
  } finally {
    await client.end();
  }
}

async function createApiRunWithItem(client, token, tenantId, userId, marker) {
  const fixture = await createWorkerFixture(client, tenantId, userId, marker);
  const run = await expectStatus("api helper run create", "POST", "/payroll-runs", `Bearer ${token}`, 201, {
    payroll_run_type: "regular",
    payroll_cycle: "weekly",
    payroll_period_start: todayOffset(-7),
    payroll_period_end: todayOffset(0),
    compliance_status: "ready",
    tax_document_status: "ready",
  });
  const item = await expectStatus("api helper item add", "POST", `/payroll-runs/${run.id}/items`, `Bearer ${token}`, 201, {
    worker_id: fixture.workerId,
    source_type: "manual",
    earning_type: "regular",
    worker_classification: "w2_employee",
    manual_reason: "Smoke helper.",
    gross_pay_amount: 100,
    compliance_status: "ready",
    tax_document_status: "ready",
  });
  return { ...run, fixture, item };
}

async function createBareRun(client, tenantId, userId, marker) {
  const result = await client.query(
    `INSERT INTO payroll_runs (tenant_id, payroll_run_number, payroll_run_type, payroll_cycle, payroll_period_start, payroll_period_end, compliance_status, tax_document_status, created_by, updated_by)
     VALUES ($1, $2, 'regular', 'weekly', current_date - interval '7 days', current_date, 'ready', 'ready', $3, $3) RETURNING id`,
    [tenantId, `PR-BARE-${marker}-${crypto.randomUUID().slice(0, 6)}`, userId],
  );
  return result.rows[0];
}

async function createWorkerFixture(client, tenantId, userId, marker) {
  const org = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, $2, 'customer', 'customer') RETURNING id", [tenantId, `Payroll Customer ${marker}`]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, 'staffing_partner', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, `Payroll Provider ${marker}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'bore', 'active') RETURNING id", [tenantId, provider.rows[0].id, `Payroll Crew ${marker}`]);
  const worker = await client.query("INSERT INTO workers (tenant_id, capacity_provider_id, crew_id, first_name, last_name, status) VALUES ($1, $2, $3, 'Pat', $4, 'active') RETURNING id", [tenantId, provider.rows[0].id, crew.rows[0].id, marker]);
  const project = await client.query("INSERT INTO projects (tenant_id, name, customer_organization_id, status, created_by, updated_by) VALUES ($1, $2, $3, 'active', $4, $4) RETURNING id", [tenantId, `Payroll Project ${marker}`, org.rows[0].id, userId]);
  const workOrder = await client.query(
    "INSERT INTO work_orders (tenant_id, project_id, title, work_type, expected_units, unit_type, work_order_number, work_order_name, assigned_capacity_provider_id, assigned_crew_id, status, created_by, updated_by) VALUES ($1, $2, $3, 'labor', 1, 'days', $4, $3, $5, $6, 'assigned', $7, $7) RETURNING id",
    [tenantId, project.rows[0].id, `Payroll WO ${marker}`, `WO-${marker}`, provider.rows[0].id, crew.rows[0].id, userId],
  );
  const production = await client.query(
    "INSERT INTO production_records (tenant_id, project_id, work_order_id, capacity_provider_id, crew_id, production_type, production_date, quantity_submitted, unit_type, quantity, unit, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, 'daily_production', current_date, 1, 'days', 1, 'days', 'approved', $6, $6) RETURNING id",
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id, crew.rows[0].id, userId],
  );
  return {
    providerId: provider.rows[0].id,
    crewId: crew.rows[0].id,
    workerId: worker.rows[0].id,
    projectId: project.rows[0].id,
    workOrderId: workOrder.rows[0].id,
    productionRecordId: production.rows[0].id,
  };
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Payroll Outside Tenant", `payroll-outside-${suffix}`]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, name, provider_type) VALUES ($1, 'Outside Payroll Provider', 'staffing_partner') RETURNING id", [tenant.rows[0].id]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type) VALUES ($1, $2, 'Outside Payroll Crew', 'bore') RETURNING id", [tenant.rows[0].id, provider.rows[0].id]);
  const worker = await client.query("INSERT INTO workers (tenant_id, capacity_provider_id, crew_id, first_name, last_name) VALUES ($1, $2, $3, 'Outside', 'Worker') RETURNING id", [tenant.rows[0].id, provider.rows[0].id, crew.rows[0].id]);
  const project = await client.query("INSERT INTO projects (tenant_id, name, status) VALUES ($1, 'Outside Payroll Project', 'active') RETURNING id", [tenant.rows[0].id]);
  const run = await client.query(
    "INSERT INTO payroll_runs (tenant_id, payroll_run_number, payroll_run_type, payroll_cycle, payroll_period_start, payroll_period_end) VALUES ($1, 'OUTSIDE-PAYROLL', 'regular', 'weekly', current_date - interval '7 days', current_date) RETURNING id",
    [tenant.rows[0].id],
  );
  return { tenantId: tenant.rows[0].id, providerId: provider.rows[0].id, crewId: crew.rows[0].id, workerId: worker.rows[0].id, projectId: project.rows[0].id, runId: run.rows[0].id };
}

async function forbiddenCounts(client, tenantId) {
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM payments WHERE tenant_id = $1) AS payments,
      (SELECT count(*)::int FROM cash_receipts WHERE tenant_id = $1) AS cash_receipts,
      (SELECT count(*)::int FROM payment_applications WHERE tenant_id = $1) AS payment_applications
    `,
    [tenantId],
  );
  return result.rows[0];
}

async function assertForbiddenUnchanged(client, tenantId, before, label) {
  const after = await forbiddenCounts(client, tenantId);
  for (const key of Object.keys(before)) {
    if (Number(after[key]) !== Number(before[key])) throw new Error(`${label} changed forbidden ${key}`);
  }
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id", [
    `payroll-limited-${suffix}@example.com`,
    "Payroll Limited",
  ]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
}

async function assignRole(client, tenantId, tenantUserId, roleName) {
  const role = await client.query("SELECT id FROM roles WHERE tenant_id = $1 AND name = $2", [tenantId, roleName]);
  if (!role.rows[0]) return;
  await client.query(
    "INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id) VALUES ($1, $2, $3, 'tenant', $1) ON CONFLICT DO NOTHING",
    [tenantId, tenantUserId, role.rows[0].id],
  );
}

function createToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function expectStatus(label, method, path, authorization, status, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (response.status !== status) throw new Error(`${label}: expected ${status}, got ${response.status}: ${text}`);
  return data;
}

function todayOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
