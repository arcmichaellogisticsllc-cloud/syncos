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

  const seeded = await client.query(`
    SELECT u.id AS user_id, t.id AS tenant_id, tu.id AS tenant_user_id
    FROM users u
    JOIN tenant_users tu ON tu.user_id = u.id
    JOIN tenants t ON t.id = tu.tenant_id
    WHERE u.email = 'admin@jackson-telcom.local'
      AND t.slug = 'jackson-telcom'
    LIMIT 1
  `);
  if (!seeded.rows[0]) throw new Error("Seeded Jackson Telcom admin user was not found");
  const { user_id: userId, tenant_id: tenantId, tenant_user_id: tenantUserId } = seeded.rows[0];
  await assignRole(client, tenantId, tenantUserId, "Billing Manager");
  await assignRole(client, tenantId, tenantUserId, "Finance Manager");

  const marker = `S8${Date.now()}`;
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const base = await createBaseData(client, tenantId, userId, marker);
  const outside = await createOutsideData(client);

  await expectStatus("unauthorized invoice create blocked", "POST", "/invoices", undefined, 401, {});
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});
  await expectStatus("cross-tenant invoice blocked", "GET", `/invoices/${outside.invoiceId}`, `Bearer ${token}`, 404);

  await expectStatus("invoice create requires approved settlement", "POST", "/invoices", `Bearer ${token}`, 400, {
    settlement_id: base.draftSettlementId,
    invoice_number: `INV-BLOCK-${marker}`,
    invoice_date: todayOffset(-10),
    due_date: todayOffset(10),
    invoice_amount: 100,
  });
  await expectStatus("invoice amount must equal settlement net amount", "POST", "/invoices", `Bearer ${token}`, 400, {
    settlement_id: base.exactSettlementId,
    invoice_number: `INV-AMOUNT-${marker}`,
    invoice_date: todayOffset(-10),
    due_date: todayOffset(10),
    invoice_amount: 99,
  });

  const invoiceBefore = await counts(client);
  const exactInvoice = await createInvoice(token, base.exactSettlementId, `INV-EXACT-${marker}`, todayOffset(-20), todayOffset(10), 100);
  await expectWrite(client, invoiceBefore, "invoice.created", "invoice create");

  const submitBefore = await counts(client);
  const submitted = await expectStatus("invoice submit creates AR", "POST", `/invoices/${exactInvoice.id}/submit`, `Bearer ${token}`, 201, {});
  if (submitted.status !== "submitted") throw new Error("invoice not submitted");
  await expectWrite(client, submitBefore, "invoice.submitted", "invoice submit", 2);
  await expectDelta(client, submitBefore, "ar_record.created", 1, "AR create event");
  const exactAr = await arByInvoice(client, tenantId, exactInvoice.id);
  if (Number(exactAr.amount_open) !== 100) throw new Error("AR amount_open incorrect");

  await expectStatus("overdue blocked before due date", "POST", `/invoices/${exactInvoice.id}/mark-overdue`, `Bearer ${token}`, 400, {});

  const agingInvoice = await createInvoice(token, base.agingSettlementId, `INV-AGING-${marker}`, todayOffset(-70), todayOffset(-45), 100);
  await expectStatus("submit aging invoice", "POST", `/invoices/${agingInvoice.id}/submit`, `Bearer ${token}`, 201, {});
  const agingAr = await arByInvoice(client, tenantId, agingInvoice.id);
  const agingRead = await expectStatus("AR aging bucket calculation", "GET", `/ar-records/${agingAr.id}`, `Bearer ${token}`, 200);
  if (agingRead.aging_bucket !== "30") throw new Error(`expected 30 aging bucket, got ${agingRead.aging_bucket}`);

  const overdueBefore = await counts(client);
  const overdue = await expectStatus("overdue succeeds after due date", "POST", `/invoices/${agingInvoice.id}/mark-overdue`, `Bearer ${token}`, 201, {});
  if (overdue.status !== "overdue") throw new Error("invoice not overdue");
  await expectWrite(client, overdueBefore, "invoice.overdue", "invoice overdue");
  const arArchiveBefore = await counts(client);
  const archivedAr = await expectStatus("AR archive writes event", "POST", `/ar-records/${agingAr.id}/archive`, `Bearer ${token}`, 201, {});
  if (archivedAr.status !== "archived") throw new Error("AR record not archived");
  await expectWrite(client, arArchiveBefore, "ar_record.archived", "AR archive");

  const paymentBefore = await counts(client);
  const exactPayment = await expectStatus("payment create", "POST", "/payments", `Bearer ${token}`, 201, {
    invoice_id: exactInvoice.id,
    settlement_id: base.exactSettlementId,
    payment_date: todayOffset(0),
    payment_amount: 100,
    payment_reference: `PAY-EXACT-${marker}`,
  });
  await expectWrite(client, paymentBefore, "payment.created", "payment create");

  const reconcileBefore = await counts(client);
  const reconciled = await expectStatus("exact match reconciliation", "POST", `/payments/${exactPayment.id}/reconcile`, `Bearer ${token}`, 201, {});
  if (reconciled.status !== "reconciled") throw new Error("payment not reconciled");
  await expectWrite(client, reconcileBefore, "payment.reconciled", "exact reconciliation");
  await expectPaymentPayload(client, "payment.reconciled", "reconciled");
  const reconciledAr = await arByInvoice(client, tenantId, exactInvoice.id);
  if (Number(reconciledAr.amount_open) !== 0) throw new Error("reconciled AR still open");

  const shortInvoice = await createSubmittedInvoice(token, base.shortSettlementId, `INV-SHORT-${marker}`, todayOffset(-25), todayOffset(5), 100);
  const shortPayment = await expectStatus("short payment create", "POST", "/payments", `Bearer ${token}`, 201, {
    invoice_id: shortInvoice.id,
    settlement_id: base.shortSettlementId,
    payment_date: todayOffset(0),
    payment_amount: 80,
    payment_reference: `PAY-SHORT-${marker}`,
  });
  const shortBefore = await counts(client);
  const shortPaid = await expectStatus("short pay reconciliation", "POST", `/payments/${shortPayment.id}/reconcile`, `Bearer ${token}`, 201, {});
  if (shortPaid.status !== "short_paid" || Number(shortPaid.short_pay_amount) !== 20) throw new Error("short pay fields incorrect");
  await expectWrite(client, shortBefore, "payment.short_paid", "short pay reconciliation");
  await expectPaymentPayload(client, "payment.short_paid", "short_paid");

  const overInvoice = await createSubmittedInvoice(token, base.overSettlementId, `INV-OVER-${marker}`, todayOffset(-30), todayOffset(0), 100);
  const overPayment = await expectStatus("over payment create", "POST", "/payments", `Bearer ${token}`, 201, {
    invoice_id: overInvoice.id,
    settlement_id: base.overSettlementId,
    payment_date: todayOffset(0),
    payment_amount: 120,
    payment_reference: `PAY-OVER-${marker}`,
  });
  const overBefore = await counts(client);
  const overpaid = await expectStatus("overpay reconciliation", "POST", `/payments/${overPayment.id}/reconcile`, `Bearer ${token}`, 201, {});
  if (overpaid.status !== "overpaid" || Number(overpaid.overpay_amount) !== 20) throw new Error("overpay fields incorrect");
  await expectWrite(client, overBefore, "payment.overpaid", "overpay reconciliation");
  await expectPaymentPayload(client, "payment.overpaid", "overpaid");

  const stats = await client.query("SELECT * FROM customer_payment_stats WHERE tenant_id = $1 AND customer_organization_id = $2", [tenantId, base.organizationId]);
  if (!stats.rows[0]) throw new Error("customer payment stats not created");
  if (Number(stats.rows[0].payment_count) !== 3) throw new Error("customer payment stats payment_count incorrect");
  if (Number(stats.rows[0].short_pay_count) !== 1) throw new Error("customer payment stats short_pay_count incorrect");

  const searchResults = await expectStatus("tenant-scoped cash search", "GET", `/search?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
  if (!searchResults.some((row) => row.object_type === "invoice" && row.id === exactInvoice.id)) throw new Error("search missing invoice");
  if (!searchResults.some((row) => row.object_type === "payment" && row.id === exactPayment.id)) throw new Error("search missing payment");
  if (searchResults.some((row) => row.id === outside.invoiceId)) throw new Error("search returned cross-tenant invoice");

  const forbidden = await client.query(`
    SELECT
      to_regclass('public.collections') AS collections_table,
      to_regclass('public.payroll_records') AS payroll_table,
      to_regclass('public.payment_processor_integrations') AS processor_table
  `);
  if (forbidden.rows[0].collections_table) throw new Error("collections table was created");
  if (forbidden.rows[0].payroll_table) throw new Error("payroll table was created");
  if (forbidden.rows[0].processor_table) throw new Error("payment processor integration table was created");

  await client.end();
  console.log("sprint8 smoke passed");
}

async function createInvoice(token, settlementId, invoiceNumber, invoiceDate, dueDate, invoiceAmount) {
  return expectStatus("invoice create", "POST", "/invoices", `Bearer ${token}`, 201, {
    settlement_id: settlementId,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    invoice_amount: invoiceAmount,
  });
}

async function createSubmittedInvoice(token, settlementId, invoiceNumber, invoiceDate, dueDate, invoiceAmount) {
  const invoice = await createInvoice(token, settlementId, invoiceNumber, invoiceDate, dueDate, invoiceAmount);
  await expectStatus("invoice submit", "POST", `/invoices/${invoice.id}/submit`, `Bearer ${token}`, 201, {});
  return invoice;
}

async function createBaseData(client, tenantId, userId, marker) {
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantId, `Territory ${marker}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'customer') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Customer ${marker}`,
  ]);
  const contract = await client.query("INSERT INTO contracts (tenant_id, organization_id, name, status) VALUES ($1, $2, $3, 'active') RETURNING id", [
    tenantId,
    organization.rows[0].id,
    `Contract ${marker}`,
  ]);
  async function settlement(status, suffix) {
    const result = await client.query(
      `
      INSERT INTO settlements (
        tenant_id, contract_id, customer_organization_id, billing_period_start, billing_period_end,
        gross_amount, retainage_amount, adjustment_amount, chargeback_amount, net_amount, total_amount, status
      )
      VALUES ($1, $2, $3, '2026-09-01', '2026-09-30', 100, 0, 0, 0, 100, 100, $4)
      RETURNING id
      `,
      [tenantId, contract.rows[0].id, organization.rows[0].id, status],
    );
    return result.rows[0].id;
  }
  return {
    organizationId: organization.rows[0].id,
    draftSettlementId: await settlement("draft", "DRAFT"),
    exactSettlementId: await settlement("approved", "EXACT"),
    agingSettlementId: await settlement("approved", "AGING"),
    shortSettlementId: await settlement("approved", "SHORT"),
    overSettlementId: await settlement("approved", "OVER"),
  };
}

async function createOutsideData(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 8 Outside Tenant", `sprint8-outside-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type) VALUES ($1, 'Outside Customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const invoice = await client.query("INSERT INTO invoices (tenant_id, organization_id, invoice_number, status, total_amount) VALUES ($1, $2, 'OUTSIDE', 'draft', 1) RETURNING id", [
    tenant.rows[0].id,
    organization.rows[0].id,
  ]);
  return { invoiceId: invoice.rows[0].id };
}

async function arByInvoice(client, tenantId, invoiceId) {
  const result = await client.query("SELECT * FROM ar_records WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL LIMIT 1", [tenantId, invoiceId]);
  if (!result.rows[0]) throw new Error("AR record not found");
  return result.rows[0];
}

async function assignRole(client, tenantId, tenantUserId, roleName) {
  const role = await client.query("SELECT id FROM roles WHERE tenant_id = $1 AND name = $2", [tenantId, roleName]);
  if (!role.rows[0]) throw new Error(`${roleName} role not found`);
  await client.query(
    `
    INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
    VALUES ($1, $2, $3, 'tenant', $1)
    ON CONFLICT (tenant_user_id, role_id, scope_type, scope_id) DO NOTHING
    `,
    [tenantId, tenantUserId, role.rows[0].id],
  );
}

async function expectPaymentPayload(client, eventType, outcome) {
  const result = await client.query(
    `
    SELECT ep.payload
    FROM events e
    JOIN event_payloads ep ON ep.event_id = e.id
    WHERE e.event_type = $1
    ORDER BY e.created_at DESC
    LIMIT 1
    `,
    [eventType],
  );
  const payload = result.rows[0]?.payload;
  if (!payload) throw new Error(`${eventType} payload missing`);
  for (const key of [
    "invoice_id",
    "ar_record_id",
    "prior_amount_open",
    "new_amount_open",
    "reconciliation_outcome",
    "customer_organization_id",
    "customer_payment_stats_id",
    "previous_average_days_to_pay",
    "new_average_days_to_pay",
    "previous_payment_count",
    "new_payment_count",
    "previous_short_pay_count",
    "new_short_pay_count",
  ]) {
    if (payload[key] === undefined || payload[key] === null) throw new Error(`${eventType} payload missing ${key}`);
  }
  if (payload.reconciliation_outcome !== outcome) throw new Error(`${eventType} payload outcome mismatch`);
}

async function expectWrite(client, before, eventType, label, delta = 1) {
  const after = await counts(client);
  if (after.events !== before.events + delta) throw new Error(`${label}: expected event delta ${delta}`);
  if (after.event_payloads !== before.event_payloads + delta) throw new Error(`${label}: expected event payload delta ${delta}`);
  if (after.audit_logs !== before.audit_logs + delta) throw new Error(`${label}: expected audit delta ${delta}`);
  if (after.system_actions !== before.system_actions + delta) throw new Error(`${label}: expected system action delta ${delta}`);
  await expectDelta(client, before, eventType, 1, label);
}

async function expectDelta(client, before, eventType, delta, label) {
  const after = await counts(client);
  if (after[eventType] !== before[eventType] + delta) throw new Error(`${label}: expected ${eventType} delta ${delta}`);
}

async function counts(client) {
  const eventTypes = [
    "invoice.created",
    "invoice.submitted",
    "invoice.overdue",
    "ar_record.created",
    "ar_record.archived",
    "payment.created",
    "payment.reconciled",
    "payment.short_paid",
    "payment.overpaid",
  ];
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM event_payloads) AS event_payloads,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs,
      (SELECT count(*)::int FROM system_actions) AS system_actions,
      ${eventTypes.map((type, index) => `(SELECT count(*)::int FROM events WHERE event_type = $${index + 1}) AS "${type}"`).join(",\n      ")}
    `,
    eventTypes,
  );
  return result.rows[0];
}

async function expectStatus(name, method, path, authorization, expected, body) {
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status !== expected) {
    const text = await response.text();
    throw new Error(`${name}: expected ${expected}, got ${response.status}: ${text}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function todayOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function createToken(claims, secret) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000) });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
