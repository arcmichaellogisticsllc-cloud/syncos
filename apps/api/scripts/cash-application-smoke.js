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
    const marker = `CASH${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/cash-receipts", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/cash-receipts", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/cash-receipts/${outside.receiptId}`, `Bearer ${token}`, 404);

    const forbiddenBefore = await forbiddenCounts(client, tenantId);
    const invoice = await createInvoice(client, tenantId, userId, marker, 500);
    const invoiceBefore = await getInvoice(client, tenantId, invoice.id);

    const receipt = await expectStatus("cash receipt creation works", "POST", "/cash-receipts", `Bearer ${token}`, 201, {
      customer_organization_id: invoice.customerOrganizationId,
      gross_received_amount: 300,
      payment_date: todayOffset(0),
      payment_method: "check",
      payment_reference: `CHK-${marker}`,
      notes: "Smoke receipt.",
    });
    if (!receipt.receipt_number || receipt.receipt_status !== "unapplied" || Number(receipt.unapplied_amount) !== 300) throw new Error("Receipt defaults were incorrect");
    const invoiceAfterReceipt = await getInvoice(client, tenantId, invoice.id);
    assertInvoiceReceivable(invoiceAfterReceipt, invoiceBefore, "receipt creation changed invoice");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "receipt creation");

    const partial = await expectStatus("apply receipt to invoice works", "POST", `/cash-receipts/${receipt.id}/apply`, `Bearer ${token}`, 201, {
      invoice_id: invoice.id,
      applied_amount: 200,
      note: "Partial application.",
    });
    if (partial.application_status !== "partially_applied") throw new Error("Partial payment application status was incorrect");
    const invoiceAfterPartial = await getInvoice(client, tenantId, invoice.id);
    if (Number(invoiceAfterPartial.paid_amount) !== 200 || Number(invoiceAfterPartial.balance_amount) !== 300 || invoiceAfterPartial.payment_status !== "partially_paid") {
      throw new Error("Partial payment did not update invoice receivable state");
    }

    const receiptAfterPartial = await expectStatus("receipt detail returns applications", "GET", `/cash-receipts/${receipt.id}/detail`, `Bearer ${token}`, 200);
    if (!receiptAfterPartial.payment_applications.some((row) => row.id === partial.id) || Number(receiptAfterPartial.cash_receipt.unapplied_amount) !== 100) {
      throw new Error("Receipt detail did not reflect partial application");
    }

    const fullInvoice = await createInvoice(client, tenantId, userId, `${marker}FULL`, 150);
    const fullReceipt = await expectStatus("full receipt create", "POST", "/cash-receipts", `Bearer ${token}`, 201, {
      customer_organization_id: fullInvoice.customerOrganizationId,
      gross_received_amount: 150,
      payment_date: todayOffset(0),
      payment_method: "ach",
      payment_reference: `ACH-${marker}`,
    });
    await expectStatus("full payment works", "POST", `/cash-receipts/${fullReceipt.id}/apply`, `Bearer ${token}`, 201, {
      invoice_id: fullInvoice.id,
      applied_amount: 150,
    });
    const fullPaid = await getInvoice(client, tenantId, fullInvoice.id);
    if (Number(fullPaid.balance_amount) !== 0 || fullPaid.payment_status !== "paid" || fullPaid.collection_status !== "resolved" || fullPaid.cash_application_status !== "fully_applied_later") {
      throw new Error("Full payment did not close invoice receivable state");
    }

    const overInvoice = await createInvoice(client, tenantId, userId, `${marker}OVER`, 125);
    const overReceipt = await expectStatus("overpayment receipt create", "POST", "/cash-receipts", `Bearer ${token}`, 201, {
      customer_organization_id: overInvoice.customerOrganizationId,
      gross_received_amount: 200,
      payment_date: todayOffset(0),
      payment_method: "wire",
      payment_reference: `WIRE-${marker}`,
    });
    await expectStatus("overpayment amount is blocked", "POST", `/cash-receipts/${overReceipt.id}/apply`, `Bearer ${token}`, 400, {
      invoice_id: overInvoice.id,
      applied_amount: 200,
      override_reasons: { overpayment_reviewed: "Keep excess unapplied." },
    });
    await expectStatus("overpayment excess remains unapplied", "POST", `/cash-receipts/${overReceipt.id}/apply`, `Bearer ${token}`, 201, {
      invoice_id: overInvoice.id,
      applied_amount: 125,
    });
    const overReceiptDetail = await expectStatus("overpayment receipt detail", "GET", `/cash-receipts/${overReceipt.id}/detail`, `Bearer ${token}`, 200);
    if (Number(overReceiptDetail.cash_receipt.unapplied_amount) !== 75) throw new Error("Overpayment did not remain unapplied");

    const firstMulti = await createInvoice(client, tenantId, userId, `${marker}M1`, 60);
    const secondMulti = await createInvoice(client, tenantId, userId, `${marker}M2`, 40, firstMulti.customerOrganizationId);
    const multiReceipt = await expectStatus("multi invoice receipt create", "POST", "/cash-receipts", `Bearer ${token}`, 201, {
      customer_organization_id: firstMulti.customerOrganizationId,
      gross_received_amount: 100,
      payment_date: todayOffset(0),
      payment_method: "lockbox",
      payment_reference: `LOCK-${marker}`,
    });
    await expectStatus("multi invoice first application", "POST", `/cash-receipts/${multiReceipt.id}/apply`, `Bearer ${token}`, 201, { invoice_id: firstMulti.id, applied_amount: 60 });
    await expectStatus("multi invoice second application", "POST", `/cash-receipts/${multiReceipt.id}/apply`, `Bearer ${token}`, 201, { invoice_id: secondMulti.id, applied_amount: 40 });
    const multiDetail = await expectStatus("multi invoice receipt detail", "GET", `/cash-receipts/${multiReceipt.id}/detail`, `Bearer ${token}`, 200);
    if (multiDetail.cash_receipt.invoice_count !== 2 || multiDetail.cash_receipt.receipt_status !== "fully_applied") throw new Error("Multi-invoice application did not close receipt");

    const mismatchInvoice = await createInvoice(client, tenantId, userId, `${marker}MIS`, 30);
    await expectStatus("customer mismatch requires override", "POST", `/cash-receipts/${multiReceipt.id}/apply`, `Bearer ${token}`, 400, {
      invoice_id: mismatchInvoice.id,
      applied_amount: 1,
    });

    const disputedInvoice = await createInvoice(client, tenantId, userId, `${marker}DIS`, 80);
    await client.query("UPDATE invoices SET status = 'disputed', collection_status = 'disputed' WHERE tenant_id = $1 AND id = $2", [tenantId, disputedInvoice.id]);
    const disputedReceipt = await expectStatus("disputed receipt create", "POST", "/cash-receipts", `Bearer ${token}`, 201, {
      customer_organization_id: disputedInvoice.customerOrganizationId,
      gross_received_amount: 80,
      payment_date: todayOffset(0),
      payment_method: "card",
      payment_reference: `CARD-${marker}`,
    });
    await expectStatus("disputed invoice requires override", "POST", `/cash-receipts/${disputedReceipt.id}/apply`, `Bearer ${token}`, 400, {
      invoice_id: disputedInvoice.id,
      applied_amount: 10,
    });
    await expectStatus("disputed invoice override works", "POST", `/cash-receipts/${disputedReceipt.id}/apply`, `Bearer ${token}`, 201, {
      invoice_id: disputedInvoice.id,
      applied_amount: 10,
      override_reasons: { disputed_payment_reviewed: "Customer paid during dispute." },
    });

    const reverseInvoice = await createInvoice(client, tenantId, userId, `${marker}REV`, 90);
    const reverseReceipt = await expectStatus("reverse receipt create", "POST", "/cash-receipts", `Bearer ${token}`, 201, {
      customer_organization_id: reverseInvoice.customerOrganizationId,
      gross_received_amount: 90,
      payment_date: todayOffset(0),
      payment_method: "cash",
      payment_reference: `CASH-${marker}`,
    });
    const reverseApplication = await expectStatus("reverse application create", "POST", `/cash-receipts/${reverseReceipt.id}/apply`, `Bearer ${token}`, 201, {
      invoice_id: reverseInvoice.id,
      applied_amount: 90,
    });
    await expectStatus("receipt with active apps cannot void", "POST", `/cash-receipts/${reverseReceipt.id}/void`, `Bearer ${token}`, 400, { void_reason: "Should fail." });
    await expectStatus("payment application void reverses invoice balance", "POST", `/payment-applications/${reverseApplication.id}/void`, `Bearer ${token}`, 201, { void_reason: "Smoke reversal." });
    const reversedInvoice = await getInvoice(client, tenantId, reverseInvoice.id);
    if (Number(reversedInvoice.paid_amount) !== 0 || Number(reversedInvoice.balance_amount) !== 90 || reversedInvoice.payment_status !== "unpaid") throw new Error("Application void did not reverse invoice");
    const voidedReceipt = await expectStatus("receipt void works after app void", "POST", `/cash-receipts/${reverseReceipt.id}/void`, `Bearer ${token}`, 201, { void_reason: "Smoke void." });
    if (voidedReceipt.receipt_status !== "voided") throw new Error("Receipt void did not set status");
    const archivedReceipt = await expectStatus("receipt archive requires reason and works", "POST", `/cash-receipts/${reverseReceipt.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "Smoke archive." });
    if (archivedReceipt.receipt_status !== "archived") throw new Error("Receipt archive did not set status");

    const list = await expectStatus("list returns enriched fields", "GET", `/cash-receipts?q=${encodeURIComponent(receipt.receipt_number)}`, `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === receipt.id && row.recommended_next_action)) throw new Error("Cash receipt list missing enriched row");
    const appList = await expectStatus("payment application list works", "GET", `/payment-applications?cash_receipt_id=${receipt.id}`, `Bearer ${token}`, 200);
    if (!appList.some((row) => row.id === partial.id)) throw new Error("Payment application list missing application");
    const appDetail = await expectStatus("payment application detail works", "GET", `/payment-applications/${partial.id}/detail`, `Bearer ${token}`, 200);
    if (!appDetail.cash_receipt_context || !appDetail.invoice_context) throw new Error("Payment application detail missing contexts");
    const timeline = await expectStatus("timeline returns cash/payment/invoice events", "GET", `/cash-receipts/${receipt.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["cash_receipt.created", "payment_application.created", "invoice.payment_applied"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Cash timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/cash-receipts/${receipt.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/cash-receipts/${receipt.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "cash_receipt.create")) throw new Error("Cash receipt audit missing create action");
    const search = await expectStatus("search includes cash receipts", "GET", `/search?q=${encodeURIComponent(receipt.receipt_number)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "cash_receipt" && row.id === receipt.id)) throw new Error("Search missing cash receipt");

    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "cash application smoke");
    console.log("cash application smoke passed");
  } finally {
    await client.end();
  }
}

async function createInvoice(client, tenantId, userId, marker, amount, customerOrganizationId) {
  const organizationId = customerOrganizationId ?? (await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, $2, 'customer', 'customer') RETURNING id", [tenantId, `Cash Customer ${marker}`])).rows[0].id;
  const invoice = await client.query(
    `
    INSERT INTO invoices (
      tenant_id, customer_organization_id, organization_id, invoice_number, invoice_type, status, approval_status,
      delivery_status, cash_application_status, invoice_date, due_date, payment_terms, subtotal_amount,
      retainage_amount, adjustment_amount, tax_amount, fee_amount, total_amount, original_amount, paid_amount,
      balance_amount, currency, aging_days, payment_status, collection_status, invoice_package_status,
      documentation_status, customer_acceptance_status, prime_acceptance_status, created_by, updated_by
    )
    VALUES ($1, $2, $2, $3, 'standard', 'sent', 'approved', 'sent', 'ready_for_cash_application',
      current_date, current_date, 'due_on_receipt', $4, 0, 0, 0, 0, $4, $4, 0, $4, 'USD', 0, 'unpaid',
      'due', 'ready', 'ready', 'accepted', 'accepted', $5, $5)
    RETURNING id
    `,
    [tenantId, organizationId, `INV-${marker}-${crypto.randomUUID().slice(0, 8)}`, amount, userId],
  );
  return { id: invoice.rows[0].id, customerOrganizationId: organizationId };
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Cash Outside Tenant", `cash-outside-${suffix}`]);
  const receipt = await client.query(
    "INSERT INTO cash_receipts (tenant_id, receipt_number, payment_date, payment_method, gross_received_amount, unapplied_amount) VALUES ($1, 'OUTSIDE-RCPT', current_date, 'check', 1, 1) RETURNING id",
    [tenant.rows[0].id],
  );
  return { receiptId: receipt.rows[0].id };
}

async function getInvoice(client, tenantId, invoiceId) {
  const result = await client.query("SELECT * FROM invoices WHERE tenant_id = $1 AND id = $2", [tenantId, invoiceId]);
  if (!result.rows[0]) throw new Error("Invoice fixture not found");
  return result.rows[0];
}

function assertInvoiceReceivable(after, before, label) {
  for (const key of ["paid_amount", "balance_amount", "payment_status", "collection_status", "cash_application_status", "last_payment_at", "last_payment_amount"]) {
    if (String(after[key]) !== String(before[key])) throw new Error(`${label}: ${key} changed`);
  }
}

async function forbiddenCounts(client, tenantId) {
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM ar_records WHERE tenant_id = $1) AS ar_records,
      (SELECT count(*)::int FROM payments WHERE tenant_id = $1) AS payments
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
    `cash-limited-${suffix}@example.com`,
    "Cash Limited",
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
