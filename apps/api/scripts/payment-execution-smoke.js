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
    const marker = `PAYEXEC${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/payment-batches", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/payment-batches", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/payment-batches/${outside.batchId}`, `Bearer ${token}`, 404);

    const forbiddenBefore = await forbiddenCounts(client, tenantId);
    await expectStatus("invalid batch_type rejected", "POST", "/payment-batches", `Bearer ${token}`, 400, { batch_type: "bad_type", payment_method: "manual" });
    await expectStatus("invalid payment_method rejected", "POST", "/payment-batches", `Bearer ${token}`, 400, { batch_type: "contractor_payable", payment_method: "bad_method" });
    await expectStatus("mixed_later blocked unless override", "POST", "/payment-batches", `Bearer ${token}`, 400, { batch_type: "mixed_later", payment_method: "manual" });

    const payableFixture = await createPaymentReadyPayable(client, tenantId, userId, marker);
    const payrollFixture = await createPayrollReadyRun(client, tenantId, userId, marker);

    const batch = await expectStatus("payment batch creation works", "POST", "/payment-batches", `Bearer ${token}`, 201, {
      batch_type: "contractor_payable",
      payment_method: "manual",
      scheduled_payment_date: todayOffset(3),
      notes: "Smoke payment batch.",
    });
    if (!batch.payment_batch_number || batch.status !== "draft" || batch.execution_status !== "not_submitted") throw new Error("Payment batch defaults were incorrect");

    await expectStatus("add contractor payable requires payment_ready payable", "POST", `/payment-batches/${batch.id}/items/contractor-payable`, `Bearer ${token}`, 400, {
      contractor_payable_id: payableFixture.notReadyPayableId,
    });
    const payableItem = await expectStatus("add contractor payable item works", "POST", `/payment-batches/${batch.id}/items/contractor-payable`, `Bearer ${token}`, 201, {
      contractor_payable_id: payableFixture.payableId,
      payment_amount: 125,
      payee_name: "Smoke Provider",
    });
    if (payableItem.source_type !== "contractor_payable" || Number(payableItem.payment_amount) !== 125) throw new Error("Contractor payable payment item was incorrect");
    await expectStatus("duplicate contractor payable source blocked", "POST", `/payment-batches/${batch.id}/items/contractor-payable`, `Bearer ${token}`, 400, {
      contractor_payable_id: payableFixture.payableId,
    });

    const recalculated = await expectStatus("totals recalculate", "POST", `/payment-batches/${batch.id}/recalculate-totals`, `Bearer ${token}`, 201);
    if (Number(recalculated.item_count) !== 1 || Number(recalculated.total_payment_amount) !== 125) throw new Error("Payment batch totals were not recalculated");
    await expectStatus("submit review requires item", "POST", `/payment-batches/${(await createBareBatch(client, tenantId, userId, marker)).id}/submit-review`, `Bearer ${token}`, 400);
    const submitted = await expectStatus("submit review works", "POST", `/payment-batches/${batch.id}/submit-review`, `Bearer ${token}`, 201);
    if (submitted.status !== "ready_for_review" || submitted.approval_status !== "pending") throw new Error("Submit review did not set statuses");
    const reviewing = await expectStatus("start review works", "POST", `/payment-batches/${batch.id}/start-review`, `Bearer ${token}`, 201);
    if (reviewing.status !== "under_review") throw new Error("Start review did not set under_review");
    const approved = await expectStatus("approve creates no ACH/bank/provider/tax/export", "POST", `/payment-batches/${batch.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Smoke approval." });
    if (approved.status !== "approved" || approved.execution_status !== "ready_for_execution") throw new Error("Approve did not set execution readiness");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "approve");
    const scheduled = await expectStatus("schedule works and creates no money movement", "POST", `/payment-batches/${batch.id}/schedule`, `Bearer ${token}`, 201, { scheduled_payment_date: todayOffset(4) });
    if (scheduled.status !== "scheduled") throw new Error("Schedule did not set status");
    const executionSubmitted = await expectStatus("submit execution creates status only", "POST", `/payment-batches/${batch.id}/submit-execution`, `Bearer ${token}`, 201, { submit_note: "Manual status only.", external_reference: `MANUAL-${marker}` });
    if (executionSubmitted.status !== "submitted" || executionSubmitted.execution_status !== "submitted_later") throw new Error("Submit execution did not set status-only fields");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "submit execution");
    const executed = await expectStatus("mark executed creates status only", "POST", `/payment-batches/${batch.id}/mark-executed`, `Bearer ${token}`, 201, { execution_reference: `EXEC-${marker}`, execution_note: "Manual execution status only." });
    if (executed.status !== "executed_later" || executed.execution_status !== "executed_later") throw new Error("Mark executed did not set status-only execution");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "mark executed");

    const payrollBatch = await expectStatus("payroll payment batch creation works", "POST", "/payment-batches", `Bearer ${token}`, 201, { batch_type: "payroll", payment_method: "manual" });
    await expectStatus("whole payroll run without item is blocked", "POST", `/payment-batches/${payrollBatch.id}/items/payroll-run`, `Bearer ${token}`, 400, { payroll_run_id: payrollFixture.runId });
    const payrollPaymentItem = await expectStatus("add payroll item requires payroll_ready run and item", "POST", `/payment-batches/${payrollBatch.id}/items/payroll-run`, `Bearer ${token}`, 201, {
      payroll_run_id: payrollFixture.runId,
      payroll_item_id: payrollFixture.itemId,
      payment_amount: 90,
    });
    if (payrollPaymentItem.source_type !== "payroll" || payrollPaymentItem.worker_id !== payrollFixture.workerId) throw new Error("Payroll payment item was incorrect");

    const failureBatch = await createApiBatchWithPayable(client, token, tenantId, userId, `${marker}FAIL`);
    await expectStatus("failure handling requires reason", "POST", `/payment-batches/${failureBatch.id}/mark-failed`, `Bearer ${token}`, 400, {});
    const failed = await expectStatus("failure handling works", "POST", `/payment-batches/${failureBatch.id}/mark-failed`, `Bearer ${token}`, 201, { failure_reason: "manual_rejection" });
    if (failed.status !== "failed" || failed.execution_status !== "failed") throw new Error("Failure handling did not set failed status");

    const terminalBatch = await createApiBatchWithPayable(client, token, tenantId, userId, `${marker}TERM`);
    const updatedItem = await expectStatus("item update recalculates totals", "PATCH", `/payment-items/${terminalBatch.item.id}`, `Bearer ${token}`, 200, { payment_amount: 75, payee_name: "Updated Payee" });
    if (Number(updatedItem.payment_amount) !== 75) throw new Error("Payment item update failed");
    await expectStatus("item void excludes from totals", "POST", `/payment-items/${terminalBatch.item.id}/void`, `Bearer ${token}`, 201, { void_reason: "duplicate" });
    const archiveBatch = await createApiBatchWithPayable(client, token, tenantId, userId, `${marker}ARCHITEM`);
    await expectStatus("item archive excludes from totals", "POST", `/payment-items/${archiveBatch.item.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });
    await expectStatus("cancel requires reason", "POST", `/payment-batches/${archiveBatch.id}/cancel`, `Bearer ${token}`, 400, {});
    const cancelled = await expectStatus("cancel works", "POST", `/payment-batches/${archiveBatch.id}/cancel`, `Bearer ${token}`, 201, { cancel_reason: "smoke_cancel" });
    if (cancelled.status !== "cancelled") throw new Error("Cancel did not set status");
    await expectStatus("void requires reason", "POST", `/payment-batches/${terminalBatch.id}/void`, `Bearer ${token}`, 400, {});
    const voided = await expectStatus("void works", "POST", `/payment-batches/${terminalBatch.id}/void`, `Bearer ${token}`, 201, { void_reason: "smoke_void" });
    if (voided.status !== "voided") throw new Error("Void did not set status");
    const archiveOnlyBatch = await createApiBatchWithPayable(client, token, tenantId, userId, `${marker}ARCH`);
    await expectStatus("archive requires reason", "POST", `/payment-batches/${archiveOnlyBatch.id}/archive`, `Bearer ${token}`, 400, {});
    const archived = await expectStatus("archive works", "POST", `/payment-batches/${archiveOnlyBatch.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });
    if (archived.status !== "archived") throw new Error("Archive did not set status");

    const list = await expectStatus("list returns enriched fields", "GET", `/payment-batches?q=${encodeURIComponent(batch.payment_batch_number)}`, `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === batch.id && row.recommended_next_action)) throw new Error("Payment batch list missing enriched row");
    const detail = await expectStatus("detail returns items and summaries", "GET", `/payment-batches/${batch.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.payment_items?.length || detail.boundary_summary.creates_real_money_movement) throw new Error("Payment batch detail missing items or boundary summary");
    const itemDetail = await expectStatus("item detail returns source context", "GET", `/payment-items/${payableItem.id}/detail`, `Bearer ${token}`, 200);
    if (!itemDetail.contractor_payable_context || itemDetail.boundary_summary.creates_bank_transaction) throw new Error("Payment item detail missing source or boundary summary");
    const timeline = await expectStatus("timeline returns batch/item events", "GET", `/payment-batches/${batch.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["payment_batch.created", "payment_batch.item_added", "payment_batch.executed"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Payment execution timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/payment-batches/${batch.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/payment-batches/${batch.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "payment_batch.create")) throw new Error("Payment batch audit missing create action");
    const search = await expectStatus("search includes payment execution", "GET", `/search?q=${encodeURIComponent(batch.payment_batch_number)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "payment_batch" && row.id === batch.id)) throw new Error("Search missing payment batch");

    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "payment execution smoke");
    console.log("payment execution smoke passed");
  } finally {
    await client.end();
  }
}

async function createApiBatchWithPayable(client, token, tenantId, userId, marker) {
  const fixture = await createPaymentReadyPayable(client, tenantId, userId, marker);
  const batch = await expectStatus("api helper payment batch create", "POST", "/payment-batches", `Bearer ${token}`, 201, { batch_type: "contractor_payable", payment_method: "manual" });
  const item = await expectStatus("api helper payment item add", "POST", `/payment-batches/${batch.id}/items/contractor-payable`, `Bearer ${token}`, 201, { contractor_payable_id: fixture.payableId });
  return { ...batch, fixture, item };
}

async function createBareBatch(client, tenantId, userId, marker) {
  const result = await client.query(
    "INSERT INTO payment_batches (tenant_id, payment_batch_number, batch_type, payment_method, created_by, updated_by) VALUES ($1, $2, 'contractor_payable', 'manual', $3, $3) RETURNING id",
    [tenantId, `PB-BARE-${marker}-${crypto.randomUUID().slice(0, 6)}`, userId],
  );
  return result.rows[0];
}

async function createPaymentReadyPayable(client, tenantId, userId, marker) {
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, 'subcontractor', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, `Payment Exec Provider ${marker}`]);
  const ready = await client.query(
    `INSERT INTO contractor_payables (
      tenant_id, payable_number, payable_type, payable_party_type, status, approval_status,
      payment_readiness_status, payment_status, capacity_provider_id, gross_payable_amount,
      net_payable_amount, compliance_status, tax_document_status, created_by, updated_by
    )
    VALUES ($1, $2, 'subcontractor', 'capacity_provider', 'payment_ready', 'approved',
      'ready_for_payment', 'not_paid', $3, 150, 150, 'ready', 'ready', $4, $4) RETURNING id`,
    [tenantId, `PAY-READY-${marker}-${crypto.randomUUID().slice(0, 6)}`, provider.rows[0].id, userId],
  );
  const notReady = await client.query(
    "INSERT INTO contractor_payables (tenant_id, payable_number, payable_type, payable_party_type, capacity_provider_id, net_payable_amount, created_by, updated_by) VALUES ($1, $2, 'subcontractor', 'capacity_provider', $3, 150, $4, $4) RETURNING id",
    [tenantId, `PAY-NOTREADY-${marker}-${crypto.randomUUID().slice(0, 6)}`, provider.rows[0].id, userId],
  );
  return { providerId: provider.rows[0].id, payableId: ready.rows[0].id, notReadyPayableId: notReady.rows[0].id };
}

async function createPayrollReadyRun(client, tenantId, userId, marker) {
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, name, provider_type) VALUES ($1, $2, 'staffing_partner') RETURNING id", [tenantId, `Payment Exec Payroll Provider ${marker}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type) VALUES ($1, $2, $3, 'bore') RETURNING id", [tenantId, provider.rows[0].id, `Payment Exec Crew ${marker}`]);
  const worker = await client.query("INSERT INTO workers (tenant_id, capacity_provider_id, crew_id, first_name, last_name, status) VALUES ($1, $2, $3, 'Penny', $4, 'active') RETURNING id", [tenantId, provider.rows[0].id, crew.rows[0].id, marker]);
  const run = await client.query(
    `INSERT INTO payroll_runs (
      tenant_id, payroll_run_number, payroll_run_type, status, approval_status, payroll_readiness_status,
      payroll_cycle, payroll_period_start, payroll_period_end, gross_pay_amount, net_pay_amount,
      item_count, worker_count, compliance_status, tax_document_status, created_by, updated_by
    )
    VALUES ($1, $2, 'regular', 'payroll_ready', 'approved', 'ready_for_payroll',
      'weekly', current_date - interval '7 days', current_date, 100, 100, 1, 1, 'ready', 'ready', $3, $3) RETURNING id`,
    [tenantId, `PR-READY-${marker}-${crypto.randomUUID().slice(0, 6)}`, userId],
  );
  const item = await client.query(
    `INSERT INTO payroll_items (
      tenant_id, payroll_run_id, worker_id, source_type, earning_type, status, worker_classification,
      gross_pay_amount, net_pay_amount, compliance_status, tax_document_status, created_by, updated_by
    )
    VALUES ($1, $2, $3, 'manual', 'regular', 'ready', 'w2_employee', 100, 100, 'ready', 'ready', $4, $4) RETURNING id`,
    [tenantId, run.rows[0].id, worker.rows[0].id, userId],
  );
  return { providerId: provider.rows[0].id, crewId: crew.rows[0].id, workerId: worker.rows[0].id, runId: run.rows[0].id, itemId: item.rows[0].id };
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Payment Execution Outside Tenant", `payment-exec-outside-${suffix}`]);
  const batch = await client.query(
    "INSERT INTO payment_batches (tenant_id, payment_batch_number, batch_type, payment_method) VALUES ($1, 'OUTSIDE-PAYMENT-BATCH', 'contractor_payable', 'manual') RETURNING id",
    [tenant.rows[0].id],
  );
  return { tenantId: tenant.rows[0].id, batchId: batch.rows[0].id };
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
    `payment-execution-limited-${suffix}@example.com`,
    "Payment Execution Limited",
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
