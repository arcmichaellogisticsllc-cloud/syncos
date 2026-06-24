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
    const marker = `AEX${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/accounting-export-batches", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/accounting-export-batches", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/accounting-export-batches/${outside.batchId}`, `Bearer ${token}`, 404);

    await expectStatus("invalid export_type rejected", "POST", "/accounting-export-batches", `Bearer ${token}`, 400, { export_type: "bad", target_system: "generic_json", export_format: "json" });
    await expectStatus("invalid target_system rejected", "POST", "/accounting-export-batches", `Bearer ${token}`, 400, { export_type: "invoices", target_system: "bad", export_format: "json" });
    await expectStatus("invalid export_format rejected", "POST", "/accounting-export-batches", `Bearer ${token}`, 400, { export_type: "invoices", target_system: "generic_json", export_format: "bad" });

    const sources = await createSources(client, tenantId, userId, marker);
    const forbiddenBefore = await forbiddenCounts(client, tenantId);
    const batch = await expectStatus("export batch creation works", "POST", "/accounting-export-batches", `Bearer ${token}`, 201, {
      export_type: "mixed_later",
      target_system: "generic_json",
      export_format: "json",
      period_start: todayOffset(-7),
      period_end: todayOffset(0),
      currency: "USD",
      override_reasons: { smoke_mixed_batch: true },
    });
    if (!batch.export_batch_number || batch.status !== "draft" || batch.export_status !== "not_generated") throw new Error("Accounting export batch defaults were incorrect");

    await expectStatus("duplicate source object not yet present sanity", "GET", `/accounting-export-batches/${batch.id}/items`, `Bearer ${token}`, 200);
    const invoiceItem = await addExportItem(token, batch.id, sources.invoiceId, "invoice", "receivable", marker);
    await addExportItem(token, batch.id, sources.cashReceiptId, "cash_receipt", "cash_receipt", marker);
    await addExportItem(token, batch.id, sources.paymentApplicationId, "payment_application", "cash_receipt", marker);
    await addExportItem(token, batch.id, sources.contractorPayableId, "contractor_payable", "payable", marker);
    await addExportItem(token, batch.id, sources.payrollRunId, "payroll_run", "payroll_expense", marker);
    await addExportItem(token, batch.id, sources.paymentBatchId, "payment_batch", "payment", marker);
    await addExportItem(token, batch.id, sources.reconciliationMatchId, "reconciliation_match", "reconciliation", marker);
    await expectStatus("duplicate source object blocked", "POST", `/accounting-export-batches/${batch.id}/items`, `Bearer ${token}`, 400, {
      source_object_type: "invoice",
      source_object_id: sources.invoiceId,
      export_item_type: "receivable",
    });

    const unmappedBatch = await expectStatus("unmapped batch helper create", "POST", "/accounting-export-batches", `Bearer ${token}`, 201, { export_type: "invoices", target_system: "generic_json", export_format: "json" });
    await expectStatus("missing mapping creates unmapped", "POST", `/accounting-export-batches/${unmappedBatch.id}/items`, `Bearer ${token}`, 201, {
      source_object_type: "invoice",
      source_object_id: sources.unusedInvoiceId,
      export_item_type: "receivable",
    });
    await expectStatus("generate blocks mapping_error or unmapped unless override", "POST", `/accounting-export-batches/${unmappedBatch.id}/generate`, `Bearer ${token}`, 400, { generate_note: "Should block." });

    const updatedItem = await expectStatus("item update recalculates totals and mapping", "PATCH", `/accounting-export-items/${invoiceItem.id}`, `Bearer ${token}`, 200, {
      amount: 110,
      target_account_code: "4000",
      target_entity_reference: "CUST-100",
    });
    if (updatedItem.mapping_status !== "mapped" || Number(updatedItem.amount) !== 110) throw new Error("Accounting export item update failed");
    const recalculated = await expectStatus("totals recalculate", "POST", `/accounting-export-batches/${batch.id}/recalculate-totals`, `Bearer ${token}`, 201);
    if (Number(recalculated.item_count) < 7 || Number(recalculated.total_amount) <= 0) throw new Error("Accounting export totals were not recalculated");

    const generated = await expectStatus("generate creates status only", "POST", `/accounting-export-batches/${batch.id}/generate`, `Bearer ${token}`, 201, { generate_note: "Metadata generation only." });
    if (generated.status !== "generated" || generated.export_status !== "generated") throw new Error("Generate did not set generated statuses");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "generate");
    const submittedReview = await expectStatus("submit review requires active item and works", "POST", `/accounting-export-batches/${batch.id}/submit-review`, `Bearer ${token}`, 201, { override_reasons: { smoke_generated: true } });
    if (submittedReview.status !== "ready_for_review" || submittedReview.approval_status !== "pending") throw new Error("Submit review did not set statuses");
    const reviewing = await expectStatus("start review works", "POST", `/accounting-export-batches/${batch.id}/start-review`, `Bearer ${token}`, 201);
    if (reviewing.status !== "under_review") throw new Error("Start review did not set under_review");
    const approved = await expectStatus("approve requires valid batch", "POST", `/accounting-export-batches/${batch.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Smoke approval." });
    if (approved.status !== "approved" || approved.approval_status !== "approved") throw new Error("Approve did not set approved");
    const submitted = await expectStatus("mark submitted records manual reference only", "POST", `/accounting-export-batches/${batch.id}/mark-submitted`, `Bearer ${token}`, 201, { external_batch_reference: `MANUAL-${marker}` });
    if (submitted.status !== "submitted_later" || submitted.export_status !== "submitted_later") throw new Error("Mark submitted did not set manual status");
    const accepted = await expectStatus("mark accepted records manual acceptance only", "POST", `/accounting-export-batches/${batch.id}/mark-accepted`, `Bearer ${token}`, 201, { acceptance_note: "Accepted manually." });
    if (accepted.status !== "accepted_later" || accepted.export_status !== "accepted_later") throw new Error("Mark accepted did not set manual status");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "mark accepted");

    const failedBatch = await createBatchWithItem(token, sources.unusedCashReceiptId, "cash_receipts", "cash_receipt", "cash_receipt", marker);
    const failed = await expectStatus("mark failed records failure", "POST", `/accounting-export-batches/${failedBatch.id}/mark-failed`, `Bearer ${token}`, 201, { failure_reason: "external_manual_rejection" });
    if (failed.status !== "failed" || Number(failed.retry_count) < 1) throw new Error("Mark failed did not set failure state");
    const cancelBatch = await createBatchWithItem(token, sources.unusedPaymentBatchId, "payment_execution", "payment_batch", "payment", marker);
    await expectStatus("cancel requires reason", "POST", `/accounting-export-batches/${cancelBatch.id}/cancel`, `Bearer ${token}`, 400, {});
    const cancelled = await expectStatus("cancel works", "POST", `/accounting-export-batches/${cancelBatch.id}/cancel`, `Bearer ${token}`, 201, { cancel_reason: "smoke_cancel" });
    if (cancelled.status !== "cancelled") throw new Error("Cancel did not set cancelled");
    const archiveBatch = await createBatchWithItem(token, sources.unusedBankTransactionId, "bank_reconciliation", "bank_transaction", "bank_transaction", marker);
    await expectStatus("archive requires reason", "POST", `/accounting-export-batches/${archiveBatch.id}/archive`, `Bearer ${token}`, 400, {});
    const archived = await expectStatus("archive works", "POST", `/accounting-export-batches/${archiveBatch.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });
    if (archived.status !== "archived") throw new Error("Archive did not set archived");
    const itemArchiveBatch = await createBatchWithItem(token, sources.unusedPayrollRunId, "payroll", "payroll_run", "payroll_expense", marker);
    await expectStatus("item archive excludes from totals", "POST", `/accounting-export-items/${itemArchiveBatch.item.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });

    const list = await expectStatus("list returns enriched fields", "GET", `/accounting-export-batches?q=${encodeURIComponent(batch.export_batch_number)}`, `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === batch.id && row.recommended_next_action)) throw new Error("Accounting export list missing enriched row");
    const detail = await expectStatus("detail returns items and summaries", "GET", `/accounting-export-batches/${batch.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.accounting_export_items?.length || detail.boundary_summary.creates_gl_entry) throw new Error("Accounting export detail missing items or boundary summary");
    const itemDetail = await expectStatus("item detail returns source context", "GET", `/accounting-export-items/${invoiceItem.id}/detail`, `Bearer ${token}`, 200);
    if (!itemDetail.source_context || itemDetail.boundary_summary.calls_quickbooks_api) throw new Error("Accounting export item detail missing source or boundary summary");
    const timeline = await expectStatus("timeline returns export batch/item events", "GET", `/accounting-export-batches/${batch.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["accounting_export_batch.created", "accounting_export_batch.item_added", "accounting_export_batch.accepted"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Accounting export timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/accounting-export-batches/${batch.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/accounting-export-batches/${batch.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "accounting_export_batch.create")) throw new Error("Accounting export audit missing create action");
    const search = await expectStatus("search includes accounting exports", "GET", `/search?q=${encodeURIComponent(batch.export_batch_number)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "accounting_export_batch" && row.id === batch.id)) throw new Error("Search missing accounting export batch");

    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "accounting export smoke");
    console.log("accounting export smoke passed");
  } finally {
    await client.end();
  }
}

async function addExportItem(token, batchId, sourceId, sourceType, itemType, marker) {
  return expectStatus(`add ${sourceType} export item works`, "POST", `/accounting-export-batches/${batchId}/items`, `Bearer ${token}`, 201, {
    source_object_type: sourceType,
    source_object_id: sourceId,
    export_item_type: itemType,
    target_account_code: "4000",
    target_entity_reference: `ENTITY-${marker}`,
  });
}

async function createBatchWithItem(token, sourceId, exportType, sourceType, itemType, marker) {
  const batch = await expectStatus("helper export batch create", "POST", "/accounting-export-batches", `Bearer ${token}`, 201, { export_type: exportType, target_system: "generic_json", export_format: "json" });
  const item = await addExportItem(token, batch.id, sourceId, sourceType, itemType, marker);
  return { ...batch, item };
}

async function createSources(client, tenantId, userId, marker) {
  const organizationId = await organization(client, tenantId);
  const workerId = await worker(client, tenantId);
  const invoiceId = await insertOne(client, `INSERT INTO invoices (tenant_id, organization_id, customer_organization_id, invoice_number, invoice_date, due_date, status, approval_status, delivery_status, cash_application_status, invoice_amount, total_amount, original_amount, balance_amount, currency, created_by, updated_by) VALUES ($1,$2,$2,$3,$4,$4,'approved','approved','sent','ready_for_cash_application',100,100,100,100,'USD',$5,$5) RETURNING id`, [tenantId, organizationId, `INV-${marker}`, todayOffset(0), userId]);
  const unusedInvoiceId = await insertOne(client, `INSERT INTO invoices (tenant_id, organization_id, customer_organization_id, invoice_number, invoice_date, due_date, status, approval_status, invoice_amount, total_amount, original_amount, balance_amount, currency, created_by, updated_by) VALUES ($1,$2,$2,$3,$4,$4,'approved','approved',75,75,75,75,'USD',$5,$5) RETURNING id`, [tenantId, organizationId, `INV-${marker}-UNUSED`, todayOffset(0), userId]);
  const cashReceiptId = await insertOne(client, `INSERT INTO cash_receipts (tenant_id, receipt_number, customer_organization_id, payer_name, payment_date, payment_method, gross_received_amount, unapplied_amount, receipt_status, reconciliation_status, created_by, updated_by) VALUES ($1,$2,$3,'Smoke Payer',$4,'ach',100,100,'received','reconciled_later',$5,$5) RETURNING id`, [tenantId, `CR-${marker}`, organizationId, todayOffset(0), userId]);
  const unusedCashReceiptId = await insertOne(client, `INSERT INTO cash_receipts (tenant_id, receipt_number, customer_organization_id, payer_name, payment_date, payment_method, gross_received_amount, unapplied_amount, receipt_status, created_by, updated_by) VALUES ($1,$2,$3,'Smoke Payer',$4,'ach',25,25,'received',$5,$5) RETURNING id`, [tenantId, `CR-${marker}-UNUSED`, organizationId, todayOffset(0), userId]);
  const paymentApplicationId = await insertOne(client, `INSERT INTO payment_applications (tenant_id, cash_receipt_id, invoice_id, customer_organization_id, applied_amount, application_date, application_status, created_by, updated_by) VALUES ($1,$2,$3,$4,50,$5,'applied',$6,$6) RETURNING id`, [tenantId, cashReceiptId, invoiceId, organizationId, todayOffset(0), userId]);
  const contractorPayableId = await insertOne(client, `INSERT INTO contractor_payables (tenant_id, payable_number, payable_type, payable_party_type, status, approval_status, payment_readiness_status, net_payable_amount, created_by, updated_by) VALUES ($1,$2,'subcontractor','internal_self_perform','payment_ready','approved','ready_for_payment',80,$3,$3) RETURNING id`, [tenantId, `CP-${marker}`, userId]);
  const payrollRunId = await insertOne(client, `INSERT INTO payroll_runs (tenant_id, payroll_run_number, payroll_run_type, status, approval_status, payroll_readiness_status, payroll_cycle, payroll_period_start, payroll_period_end, net_pay_amount, item_count, worker_count, created_by, updated_by) VALUES ($1,$2,'regular','payroll_ready','approved','ready_for_payroll','weekly',$3,$3,90,1,1,$4,$4) RETURNING id`, [tenantId, `PR-${marker}`, todayOffset(0), userId]);
  const unusedPayrollRunId = await insertOne(client, `INSERT INTO payroll_runs (tenant_id, payroll_run_number, payroll_run_type, status, approval_status, payroll_readiness_status, payroll_cycle, payroll_period_start, payroll_period_end, net_pay_amount, item_count, worker_count, created_by, updated_by) VALUES ($1,$2,'regular','payroll_ready','approved','ready_for_payroll','weekly',$3,$3,20,1,1,$4,$4) RETURNING id`, [tenantId, `PR-${marker}-UNUSED`, todayOffset(0), userId]);
  const payrollItemId = await insertOne(client, `INSERT INTO payroll_items (tenant_id, payroll_run_id, worker_id, source_type, earning_type, status, worker_classification, gross_pay_amount, net_pay_amount, created_by, updated_by) VALUES ($1,$2,$3,'manual','regular','payroll_ready','w2_employee',90,90,$4,$4) RETURNING id`, [tenantId, payrollRunId, workerId, userId]);
  const paymentBatchId = await insertOne(client, `INSERT INTO payment_batches (tenant_id, payment_batch_number, batch_type, payment_method, status, approval_status, execution_status, item_count, total_payment_amount, currency, created_by, updated_by) VALUES ($1,$2,'contractor_payable','manual','executed_later','approved','executed_later',1,80,'USD',$3,$3) RETURNING id`, [tenantId, `PB-${marker}`, userId]);
  const unusedPaymentBatchId = await insertOne(client, `INSERT INTO payment_batches (tenant_id, payment_batch_number, batch_type, payment_method, status, approval_status, execution_status, item_count, total_payment_amount, currency, created_by, updated_by) VALUES ($1,$2,'contractor_payable','manual','executed_later','approved','executed_later',1,22,'USD',$3,$3) RETURNING id`, [tenantId, `PB-${marker}-UNUSED`, userId]);
  const paymentItemId = await insertOne(client, `INSERT INTO payment_items (tenant_id, payment_batch_id, source_type, contractor_payable_id, payee_type, payment_method, payment_amount, currency, status, execution_status, created_by, updated_by) VALUES ($1,$2,'contractor_payable',$3,'internal_self_perform','manual',80,'USD','executed_later','executed_later',$4,$4) RETURNING id`, [tenantId, paymentBatchId, contractorPayableId, userId]);
  const bankAccountId = await insertOne(client, `INSERT INTO bank_accounts (tenant_id, account_name, account_type, currency, status, created_by, updated_by) VALUES ($1,$2,'operating','USD','active',$3,$3) RETURNING id`, [tenantId, `Operating ${marker}`, userId]);
  const bankTransactionId = await insertOne(client, `INSERT INTO bank_transactions (tenant_id, bank_account_id, transaction_date, direction, amount, currency, description, transaction_type, reconciliation_status, cleared_status, source_type, created_by, updated_by) VALUES ($1,$2,$3,'debit',80,'USD',$4,'payment_out','matched','cleared','manual',$5,$5) RETURNING id`, [tenantId, bankAccountId, todayOffset(0), `Debit ${marker}`, userId]);
  const unusedBankTransactionId = await insertOne(client, `INSERT INTO bank_transactions (tenant_id, bank_account_id, transaction_date, direction, amount, currency, description, transaction_type, reconciliation_status, cleared_status, source_type, created_by, updated_by) VALUES ($1,$2,$3,'debit',30,'USD',$4,'payment_out','matched','cleared','manual',$5,$5) RETURNING id`, [tenantId, bankAccountId, todayOffset(0), `Debit unused ${marker}`, userId]);
  const reconciliationMatchId = await insertOne(client, `INSERT INTO reconciliation_matches (tenant_id, bank_transaction_id, match_type, matched_object_type, matched_object_id, payment_batch_id, payment_item_id, matched_amount, match_confidence, match_status, approved_by, approved_at, created_by, updated_by) VALUES ($1,$2,'payment_item','payment_item',$3,$4,$3,80,'exact','approved',$5,now(),$5,$5) RETURNING id`, [tenantId, bankTransactionId, paymentItemId, paymentBatchId, userId]);
  return { invoiceId, unusedInvoiceId, cashReceiptId, unusedCashReceiptId, paymentApplicationId, contractorPayableId, payrollRunId, unusedPayrollRunId, payrollItemId, paymentBatchId, unusedPaymentBatchId, paymentItemId, bankTransactionId, unusedBankTransactionId, reconciliationMatchId };
}

async function insertOne(client, sql, params) {
  const result = await client.query(sql, params);
  return result.rows[0].id;
}

async function organization(client, tenantId) {
  const result = await client.query("SELECT id FROM organizations WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1", [tenantId]);
  if (!result.rows[0]) {
    const created = await client.query("INSERT INTO organizations (tenant_id, name, type, status) VALUES ($1, $2, 'customer', 'active') RETURNING id", [tenantId, `AEX Customer ${Date.now()}`]);
    return created.rows[0].id;
  }
  return result.rows[0].id;
}

async function worker(client, tenantId) {
  const result = await client.query("SELECT id FROM workers WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1", [tenantId]);
  if (!result.rows[0]) {
    const orgId = await organization(client, tenantId);
    const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status) VALUES ($1, $2, $3, 'staffing_partner', 'verified') RETURNING id", [tenantId, orgId, `AEX Provider ${Date.now()}`]);
    const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'project_management', 'active') RETURNING id", [tenantId, provider.rows[0].id, `AEX Crew ${Date.now()}`]);
    const created = await client.query("INSERT INTO workers (tenant_id, capacity_provider_id, crew_id, first_name, last_name, status) VALUES ($1, $2, $3, 'AEX', 'Worker', 'active') RETURNING id", [tenantId, provider.rows[0].id, crew.rows[0].id]);
    return created.rows[0].id;
  }
  return result.rows[0].id;
}

async function createOutsideTenant(client) {
  const tenantId = crypto.randomUUID();
  await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [tenantId, "Outside AEX", `outside-aex-${Date.now()}`]);
  const batchId = await insertOne(client, "INSERT INTO accounting_export_batches (tenant_id, export_batch_number, export_type, target_system, export_format) VALUES ($1,$2,'invoices','generic_json','json') RETURNING id", [tenantId, `AEX-OUT-${Date.now()}`]);
  return { tenantId, batchId };
}

async function forbiddenCounts(client, tenantId) {
  const tables = ["payments", "bank_transactions"];
  const counts = {};
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    counts[table] = Number(result.rows[0].count);
  }
  return counts;
}

async function assertForbiddenUnchanged(client, tenantId, before, label) {
  const after = await forbiddenCounts(client, tenantId);
  for (const [table, count] of Object.entries(before)) {
    if (after[table] !== count) throw new Error(`${label}: ${table} changed from ${count} to ${after[table]}`);
  }
}

async function assignRole(client, tenantId, tenantUserId, roleName) {
  await client.query(
    `INSERT INTO user_roles (tenant_id, tenant_user_id, role_id)
     SELECT $1, $2, r.id
     FROM roles r
     WHERE r.tenant_id = $1 AND r.name = $3
     ON CONFLICT DO NOTHING`,
    [tenantId, tenantUserId, roleName],
  );
}

async function createLimitedUser(client, tenantId) {
  const email = `aex-limited-${Date.now()}@example.test`;
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'AEX Limited', 'x') RETURNING id", [email]);
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return user.rows[0].id;
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
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
