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
    for (const role of ["Billing Manager", "Finance Manager"]) await assignRole(client, tenantId, tenantUserId, role);
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedToken = createToken({ sub: await createLimitedUser(client, tenantId), tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const marker = `COLL${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/collection-cases", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/collection-cases", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/collection-cases/${outside.caseId}`, `Bearer ${token}`, 404);

    const forbiddenBefore = await forbiddenCounts(client, tenantId);
    const invoice = await createInvoice(client, tenantId, userId, marker, 500, { dueOffsetDays: -45 });
    const invoiceBefore = await getInvoice(client, tenantId, invoice.id);

    const collectionCase = await expectStatus("collection case creation works from invoice with balance", "POST", "/collection-cases", `Bearer ${token}`, 201, {
      invoice_id: invoice.id,
      assigned_owner_user_id: userId,
      notes: "Smoke collection case.",
    });
    if (!collectionCase.case_number || collectionCase.case_status !== "open" || collectionCase.aging_bucket !== "31_60") throw new Error("Collection case defaults were incorrect");
    if (!["high", "urgent"].includes(collectionCase.collection_priority) || collectionCase.risk_level !== "high") throw new Error("Priority/risk were not calculated");
    await assertInvoiceBalanceUnchanged(client, tenantId, invoice.id, invoiceBefore, "case creation");

    await expectStatus("duplicate active case blocked unless override", "POST", "/collection-cases", `Bearer ${token}`, 400, { invoice_id: invoice.id });
    const duplicate = await expectStatus("duplicate active case override works", "POST", "/collection-cases", `Bearer ${token}`, 201, {
      invoice_id: invoice.id,
      override_reasons: { split_collection_review: "Smoke duplicate override." },
    });
    if (duplicate.id === collectionCase.id) throw new Error("Duplicate override did not create a distinct case");

    const paidInvoice = await createInvoice(client, tenantId, userId, `${marker}PAID`, 100, { paid: true });
    await expectStatus("paid invoice blocked unless override", "POST", "/collection-cases", `Bearer ${token}`, 400, { invoice_id: paidInvoice.id });
    const voidedInvoice = await createInvoice(client, tenantId, userId, `${marker}VOID`, 100, { status: "voided" });
    await expectStatus("voided invoice blocked", "POST", "/collection-cases", `Bearer ${token}`, 400, { invoice_id: voidedInvoice.id });
    const archivedInvoice = await createInvoice(client, tenantId, userId, `${marker}ARCH`, 100, { status: "archived" });
    await expectStatus("archived invoice blocked", "POST", "/collection-cases", `Bearer ${token}`, 400, { invoice_id: archivedInvoice.id });

    const assigned = await expectStatus("assign owner works", "POST", `/collection-cases/${collectionCase.id}/assign-owner`, `Bearer ${token}`, 201, {
      assigned_owner_user_id: userId,
      assignment_note: "Smoke assignment.",
    });
    if (assigned.assigned_owner_user_id !== userId) throw new Error("Owner assignment did not persist");

    const noteAction = await expectStatus("add internal note action works", "POST", `/collection-cases/${collectionCase.id}/actions`, `Bearer ${token}`, 201, {
      action_type: "internal_note",
      note: "Reviewed with billing.",
    });
    if (noteAction.action_type !== "internal_note") throw new Error("Internal note action was not created");

    const promise = await expectStatus("add promise-to-pay action works", "POST", `/collection-cases/${collectionCase.id}/actions`, `Bearer ${token}`, 201, {
      action_type: "promise_to_pay",
      promise_to_pay_date: todayOffset(7),
      promise_to_pay_amount: 250,
      note: "Customer promised partial payment.",
    });
    if (promise.action_type !== "promise_to_pay") throw new Error("Promise action was not created");
    const afterPromise = await getInvoice(client, tenantId, invoice.id);
    assertInvoiceBalanceMatches(afterPromise, invoiceBefore, "promise changed invoice balance");

    const dispute = await expectStatus("add dispute action works", "POST", `/collection-cases/${collectionCase.id}/actions`, `Bearer ${token}`, 201, {
      action_type: "dispute_opened",
      dispute_reason: "documentation_missing",
      note: "Customer requested support.",
    });
    if (dispute.action_type !== "dispute_opened") throw new Error("Dispute action was not created");
    const disputedInvoice = await getInvoice(client, tenantId, invoice.id);
    if (disputedInvoice.collection_status !== "disputed") throw new Error("Dispute did not update invoice collection status");
    assertInvoiceBalanceMatches(disputedInvoice, invoiceBefore, "dispute changed invoice balance");

    await expectStatus("resolve dispute action works", "POST", `/collection-cases/${collectionCase.id}/actions`, `Bearer ${token}`, 201, {
      action_type: "dispute_resolved",
      note: "Documents accepted.",
    });
    const resolvedInvoice = await getInvoice(client, tenantId, invoice.id);
    if (resolvedInvoice.collection_status === "disputed") throw new Error("Dispute resolution did not recalculate invoice collection status");
    assertInvoiceBalanceMatches(resolvedInvoice, invoiceBefore, "dispute resolution changed invoice balance");

    const escalation = await expectStatus("escalation action works", "POST", `/collection-cases/${collectionCase.id}/actions`, `Bearer ${token}`, 201, {
      action_type: "escalation_requested",
      escalation_reason: "large_overdue_balance",
      note: "Escalate internally.",
    });
    if (escalation.action_type !== "escalation_requested") throw new Error("Escalation action was not created");

    await expectStatus("writeoff review flags candidate only", "POST", `/collection-cases/${collectionCase.id}/actions`, `Bearer ${token}`, 201, {
      action_type: "writeoff_review_requested",
      note: "Review only; no writeoff execution.",
    });
    const detailAfterWriteoff = await expectStatus("detail returns invoice/cash/action context", "GET", `/collection-cases/${collectionCase.id}/detail`, `Bearer ${token}`, 200);
    if (detailAfterWriteoff.collection_case.writeoff_review_status !== "candidate") throw new Error("Writeoff review candidate was not tracked");
    if (detailAfterWriteoff.boundary_summary.creates_cash_receipt || detailAfterWriteoff.boundary_summary.updates_invoice_balance) throw new Error("Boundary summary is incorrect");

    const completed = await expectStatus("complete action works", "POST", `/collection-actions/${noteAction.id}/complete`, `Bearer ${token}`, 201, {
      outcome: "contacted",
      note: "Completed smoke note.",
    });
    if (completed.action_status !== "completed") throw new Error("Action complete did not set status");
    await expectStatus("cancel action requires reason", "POST", `/collection-actions/${promise.id}/cancel`, `Bearer ${token}`, 400, {});
    const cancelled = await expectStatus("cancel action works", "POST", `/collection-actions/${promise.id}/cancel`, `Bearer ${token}`, 201, {
      cancel_reason: "Promise replaced.",
    });
    if (cancelled.action_status !== "cancelled") throw new Error("Action cancel did not set status");

    await expectStatus("close case requires reason", "POST", `/collection-cases/${collectionCase.id}/close`, `Bearer ${token}`, 400, {});
    await expectStatus("closing unresolved balance requires override", "POST", `/collection-cases/${collectionCase.id}/close`, `Bearer ${token}`, 400, { close_reason: "resolved" });
    const closed = await expectStatus("close case with override works", "POST", `/collection-cases/${collectionCase.id}/close`, `Bearer ${token}`, 201, {
      close_reason: "unresolved_close",
      close_note: "Smoke close without balance mutation.",
      override_reasons: { unresolved_close_reviewed: "Smoke." },
    });
    if (closed.case_status !== "closed") throw new Error("Close case did not set status");

    const archivedAction = await expectStatus("archive action requires reason and works", "POST", `/collection-actions/${escalation.id}/archive`, `Bearer ${token}`, 201, {
      archive_reason: "Smoke archive.",
    });
    if (archivedAction.action_status !== "archived") throw new Error("Action archive did not set status");
    const archivedCase = await expectStatus("archive case requires reason and works", "POST", `/collection-cases/${collectionCase.id}/archive`, `Bearer ${token}`, 201, {
      archive_reason: "Smoke archive.",
    });
    if (archivedCase.case_status !== "archived") throw new Error("Case archive did not set status");

    const list = await expectStatus("list returns enriched fields", "GET", `/collection-cases?q=${encodeURIComponent(collectionCase.case_number)}&archived=true`, `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === collectionCase.id && row.recommended_next_action)) throw new Error("Collection case list missing enriched row");
    const actionList = await expectStatus("action list works", "GET", `/collection-actions?collection_case_id=${collectionCase.id}&archived=true`, `Bearer ${token}`, 200);
    if (!actionList.some((row) => row.id === noteAction.id)) throw new Error("Collection action list missing action");
    const actionDetail = await expectStatus("action detail works", "GET", `/collection-actions/${noteAction.id}/detail`, `Bearer ${token}`, 200);
    if (!actionDetail.case_context || !actionDetail.invoice_context) throw new Error("Collection action detail missing context");

    const timeline = await expectStatus("timeline returns case/action/invoice events", "GET", `/collection-cases/${collectionCase.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["collection_case.created", "collection_action.created", "invoice.promise_to_pay_recorded"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Collection timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/collection-cases/${collectionCase.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/collection-cases/${collectionCase.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "collection_case.create")) throw new Error("Collection audit missing create action");
    const search = await expectStatus("search includes collections", "GET", `/search?q=${encodeURIComponent(collectionCase.case_number)}&archived=true`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "collection_case" && row.id === collectionCase.id)) throw new Error("Search missing collection case");

    await assertInvoiceBalanceUnchanged(client, tenantId, invoice.id, invoiceBefore, "collections smoke");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "collections smoke");
    console.log("collections smoke passed");
  } finally {
    await client.end();
  }
}

async function createInvoice(client, tenantId, userId, marker, amount, options = {}) {
  const organizationId = options.customerOrganizationId ?? (await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, $2, 'customer', 'customer') RETURNING id", [tenantId, `Collections Customer ${marker}`])).rows[0].id;
  const paid = options.paid ? amount : 0;
  const balance = options.paid ? 0 : amount;
  const dueDate = todayOffset(options.dueOffsetDays ?? 0);
  const agingDays = Math.max(0, daysBetween(dueDate, todayOffset(0)));
  const collectionStatus = options.paid ? "resolved" : agingDays > 0 ? "overdue" : "due";
  const invoice = await client.query(
    `
    INSERT INTO invoices (
      tenant_id, customer_organization_id, organization_id, invoice_number, invoice_type, status, approval_status,
      delivery_status, cash_application_status, invoice_date, due_date, payment_terms, subtotal_amount,
      retainage_amount, adjustment_amount, tax_amount, fee_amount, total_amount, original_amount, paid_amount,
      balance_amount, currency, aging_days, payment_status, collection_status, invoice_package_status,
      documentation_status, customer_acceptance_status, prime_acceptance_status, created_by, updated_by
    )
    VALUES ($1, $2, $2, $3, 'standard', $4, 'approved', 'sent', 'ready_for_cash_application',
      current_date, $5, 'due_on_receipt', $6, 0, 0, 0, 0, $6, $6, $7, $8, 'USD', $9, $10,
      $11, 'ready', 'ready', 'accepted', 'accepted', $12, $12)
    RETURNING id
    `,
    [tenantId, organizationId, `INV-${marker}-${crypto.randomUUID().slice(0, 8)}`, options.status ?? "sent", dueDate, amount, paid, balance, agingDays, options.paid ? "paid" : "unpaid", collectionStatus, userId],
  );
  return { id: invoice.rows[0].id, customerOrganizationId: organizationId };
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Collections Outside Tenant", `collections-outside-${suffix}`]);
  const org = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, 'Outside Collections Customer', 'customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const invoice = await client.query(
    `INSERT INTO invoices (tenant_id, customer_organization_id, organization_id, invoice_number, invoice_type, status, approval_status, delivery_status, cash_application_status, invoice_date, due_date, payment_terms, total_amount, original_amount, paid_amount, balance_amount, payment_status, collection_status)
     VALUES ($1, $2, $2, 'OUTSIDE-COLL-INVOICE', 'standard', 'sent', 'approved', 'sent', 'ready_for_cash_application', current_date, current_date, 'due_on_receipt', 1, 1, 0, 1, 'unpaid', 'due') RETURNING id`,
    [tenant.rows[0].id, org.rows[0].id],
  );
  const caseRow = await client.query(
    "INSERT INTO collection_cases (tenant_id, invoice_id, customer_organization_id, case_number, balance_at_open, current_balance, original_invoice_amount) VALUES ($1, $2, $3, 'OUTSIDE-COLL', 1, 1, 1) RETURNING id",
    [tenant.rows[0].id, invoice.rows[0].id, org.rows[0].id],
  );
  return { caseId: caseRow.rows[0].id };
}

async function getInvoice(client, tenantId, invoiceId) {
  const result = await client.query("SELECT * FROM invoices WHERE tenant_id = $1 AND id = $2", [tenantId, invoiceId]);
  if (!result.rows[0]) throw new Error("Invoice fixture not found");
  return result.rows[0];
}

async function assertInvoiceBalanceUnchanged(client, tenantId, invoiceId, before, label) {
  const after = await getInvoice(client, tenantId, invoiceId);
  assertInvoiceBalanceMatches(after, before, label);
}

function assertInvoiceBalanceMatches(after, before, label) {
  for (const key of ["paid_amount", "balance_amount", "payment_status", "cash_application_status", "last_payment_at", "last_payment_amount"]) {
    if (String(after[key]) !== String(before[key])) throw new Error(`${label}: ${key} changed`);
  }
}

async function forbiddenCounts(client, tenantId) {
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM ar_records WHERE tenant_id = $1) AS ar_records,
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
    `collections-limited-${suffix}@example.com`,
    "Collections Limited",
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

function daysBetween(start, end) {
  return Math.floor((new Date(String(end)).getTime() - new Date(String(start)).getTime()) / 86400000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
