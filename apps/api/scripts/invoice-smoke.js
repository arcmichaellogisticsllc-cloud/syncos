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
    const marker = `INV${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/invoices", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/invoices", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/invoices/${outside.invoiceId}`, `Bearer ${token}`, 404);

    const base = await createInvoiceReadySettlementItem(client, tenantId, userId, marker);
    await expectStatus("invalid invoice_type rejected", "POST", "/invoices", `Bearer ${token}`, 400, {
      customer_organization_id: base.customerOrganizationId,
      invoice_type: "ar",
    });

    const downstreamBefore = await downstreamCounts(client, tenantId);
    const invoice = await expectStatus("invoice creation works", "POST", "/invoices", `Bearer ${token}`, 201, {
      customer_organization_id: base.customerOrganizationId,
      settlement_id: base.settlementId,
      project_id: base.projectId,
      invoice_date: todayOffset(-5),
      due_date: todayOffset(10),
      payment_terms: "net_15",
      invoice_package_status: "ready",
      documentation_status: "ready",
      customer_acceptance_status: "accepted",
      prime_acceptance_status: "accepted",
    });
    if (!invoice.invoice_number || invoice.status !== "draft" || invoice.cash_application_status !== "not_ready") throw new Error("Invoice defaults are incorrect");
    await assertNoDownstream(client, tenantId, downstreamBefore, "invoice create");

    const item = await expectStatus("add invoice item works", "POST", `/invoices/${invoice.id}/items`, `Bearer ${token}`, 201, {
      settlement_item_id: base.settlementItemId,
      quantity: 100,
      unit_rate: 10,
    });
    if (Number(item.total_amount) !== 950 || Number(item.balance_amount) !== 950) throw new Error("Invoice totals did not update after item add");
    await assertNoDownstream(client, tenantId, downstreamBefore, "invoice item add");
    await expectStatus("duplicate settlement item blocked", "POST", `/invoices/${invoice.id}/items`, `Bearer ${token}`, 400, {
      settlement_item_id: base.settlementItemId,
    });

    const submit = await expectStatus("submit review works", "POST", `/invoices/${invoice.id}/submit-review`, `Bearer ${token}`, 201, {});
    if (submit.status !== "ready_for_review" || submit.approval_status !== "pending") throw new Error("Submit review did not set pending review");
    await assertNoDownstream(client, tenantId, downstreamBefore, "submit review");

    const approved = await expectStatus("approve works", "POST", `/invoices/${invoice.id}/approve`, `Bearer ${token}`, 201, { approval_note: "Approved for billing." });
    if (approved.status !== "approved" || Number(approved.original_amount) !== 950 || Number(approved.paid_amount) !== 0 || Number(approved.balance_amount) !== 950) {
      throw new Error("Approval did not lock receivable state");
    }
    await assertNoDownstream(client, tenantId, downstreamBefore, "approve");

    const sent = await expectStatus("mark sent works", "POST", `/invoices/${invoice.id}/mark-sent`, `Bearer ${token}`, 201, { sent_note: "Sent manually." });
    if (sent.status !== "sent" || sent.delivery_status !== "sent") throw new Error("Mark sent did not update delivery state");
    await assertNoDownstream(client, tenantId, downstreamBefore, "mark sent");

    const ready = await expectStatus("ready for cash application works", "POST", `/invoices/${invoice.id}/mark-ready-for-cash-application`, `Bearer ${token}`, 201, {
      ready_note: "Ready for future cash application.",
    });
    if (ready.cash_application_status !== "ready_for_cash_application") throw new Error("Invoice not ready for cash application");
    await assertNoDownstream(client, tenantId, downstreamBefore, "ready for cash application");

    const legacy = await expectStatus("legacy submit invoice create", "POST", "/invoices", `Bearer ${token}`, 201, {
      customer_organization_id: base.customerOrganizationId,
      settlement_id: base.legacySettlementId,
      invoice_number: `LEGACY-${marker}`,
      invoice_date: todayOffset(-3),
      due_date: todayOffset(20),
      invoice_amount: 100,
    });
    const legacyBefore = await downstreamCounts(client, tenantId);
    const legacySubmitted = await expectStatus("legacy submit creates no AR", "POST", `/invoices/${legacy.id}/submit`, `Bearer ${token}`, 201, {});
    if (legacySubmitted.status !== "ready_for_review") throw new Error("Legacy submit did not map to review");
    await assertNoDownstream(client, tenantId, legacyBefore, "legacy submit");

    const disputed = await expectStatus("dispute requires reason and works", "POST", `/invoices/${invoice.id}/dispute`, `Bearer ${token}`, 201, {
      dispute_reason: "Customer question.",
    });
    if (disputed.collection_status !== "disputed") throw new Error("Dispute did not update collection status");
    const resolved = await expectStatus("resolve dispute works", "POST", `/invoices/${invoice.id}/resolve-dispute`, `Bearer ${token}`, 201, { resolution_note: "Resolved." });
    if (resolved.status !== "sent") throw new Error("Resolve dispute did not restore sent status");

    const voidBase = await createInvoiceReadySettlementItem(client, tenantId, userId, `${marker}V`);
    const voidInvoice = await createInvoiceWithItem(token, voidBase);
    const voidedItem = await expectStatus("invoice item void works", "POST", `/invoice-items/${voidInvoice.itemId}/void`, `Bearer ${token}`, 201, { void_reason: "Test void." });
    if (voidedItem.status !== "voided") throw new Error("Invoice item not voided");
    const voided = await expectStatus("invoice void works", "POST", `/invoices/${voidInvoice.invoiceId}/void`, `Bearer ${token}`, 201, { void_reason: "Test void." });
    if (voided.status !== "voided") throw new Error("Invoice not voided");
    const archived = await expectStatus("invoice archive works", "POST", `/invoices/${voidInvoice.invoiceId}/archive`, `Bearer ${token}`, 201, { archive_reason: "Test archive." });
    if (archived.status !== "archived") throw new Error("Invoice not archived");

    const list = await expectStatus("list returns enriched fields", "GET", `/invoices?q=${encodeURIComponent(invoice.invoice_number)}`, `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === invoice.id && row.recommended_next_action)) throw new Error("Invoice list missing enriched row");
    const detail = await expectStatus("detail returns receivable summary", "GET", `/invoices/${invoice.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.receivable_summary || !Array.isArray(detail.invoice_items)) throw new Error("Invoice detail missing expected summaries");
    const timeline = await expectStatus("timeline works", "GET", `/invoices/${invoice.id}/timeline`, `Bearer ${token}`, 200);
    if (!timeline.some((row) => row.event_type === "invoice.ready_for_cash_application")) throw new Error("Timeline missing ready event");
    const audit = await expectStatus("audit works", "GET", `/invoices/${invoice.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "invoice.approve")) throw new Error("Audit missing approve action");
    const search = await expectStatus("search includes invoice", "GET", `/search?q=${encodeURIComponent(invoice.invoice_number)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "invoice" && row.id === invoice.id)) throw new Error("Search missing invoice");
    if (search.some((row) => row.id === outside.invoiceId)) throw new Error("Search returned cross-tenant invoice");

    await assertNoForbiddenTables(client);
    await client.end();
    console.log("invoice smoke passed");
  } catch (error) {
    await client.end();
    throw error;
  }
}

async function createInvoiceWithItem(token, base) {
  const invoice = await expectStatus("void invoice create", "POST", "/invoices", `Bearer ${token}`, 201, {
    customer_organization_id: base.customerOrganizationId,
    settlement_id: base.settlementId,
    invoice_package_status: "ready",
    documentation_status: "ready",
  });
  const updated = await expectStatus("void invoice add item", "POST", `/invoices/${invoice.id}/items`, `Bearer ${token}`, 201, {
    settlement_item_id: base.settlementItemId,
  });
  const rows = await expectStatus("void invoice items", "GET", `/invoices/${invoice.id}/items`, `Bearer ${token}`, 200);
  return { invoiceId: invoice.id, itemId: rows[0].id, updated };
}

async function createInvoiceReadySettlementItem(client, tenantId, userId, marker) {
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type) VALUES ($1, $2, 'customer') RETURNING id", [tenantId, `Invoice Customer ${marker}`]);
  const project = await client.query("INSERT INTO projects (tenant_id, customer_organization_id, name, status) VALUES ($1, $2, $3, 'active') RETURNING id", [
    tenantId,
    organization.rows[0].id,
    `Invoice Project ${marker}`,
  ]);
  const settlement = await client.query(
    `
    INSERT INTO settlements (
      tenant_id, settlement_number, settlement_type, status, invoice_ready, customer_organization_id, project_id,
      gross_billable_amount, retainage_amount, deduction_amount, chargeback_amount, net_settlement_amount, created_by, updated_by
    )
    VALUES ($1, $2, 'customer_billable', 'invoice_ready', true, $3, $4, 1000, 50, 0, 0, 950, $5, $5)
    RETURNING id
    `,
    [tenantId, `SET-${marker}`, organization.rows[0].id, project.rows[0].id, userId],
  );
  const item = await client.query(
    `
    INSERT INTO settlement_items (
      tenant_id, settlement_id, project_id, customer_organization_id, item_type, status, quantity, unit, unit_rate,
      gross_amount, retainage_amount, deduction_amount, chargeback_amount, net_amount, amount,
      billing_package_status, documentation_status, customer_acceptance_status, prime_acceptance_status, created_by, updated_by
    )
    VALUES ($1, $2, $3, $4, 'customer_billable', 'invoice_ready', 100, 'ft', 10, 1000, 50, 0, 0, 950, 950, 'ready', 'ready', 'accepted', 'accepted', $5, $5)
    RETURNING id
    `,
    [tenantId, settlement.rows[0].id, project.rows[0].id, organization.rows[0].id, userId],
  );
  const legacy = await client.query(
    `
    INSERT INTO settlements (
      tenant_id, settlement_number, settlement_type, status, invoice_ready, customer_organization_id, project_id,
      gross_billable_amount, net_settlement_amount, gross_amount, net_amount, total_amount, created_by, updated_by
    )
    VALUES ($1, $2, 'customer_billable', 'approved', true, $3, $4, 100, 100, 100, 100, 100, $5, $5)
    RETURNING id
    `,
    [tenantId, `SET-LEGACY-${marker}`, organization.rows[0].id, project.rows[0].id, userId],
  );
  return {
    customerOrganizationId: organization.rows[0].id,
    projectId: project.rows[0].id,
    settlementId: settlement.rows[0].id,
    settlementItemId: item.rows[0].id,
    legacySettlementId: legacy.rows[0].id,
  };
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Invoice Outside Tenant", `invoice-outside-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type) VALUES ($1, 'Outside Customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const invoice = await client.query("INSERT INTO invoices (tenant_id, customer_organization_id, organization_id, invoice_number, status, total_amount) VALUES ($1, $2, $2, 'OUTSIDE-INVOICE', 'draft', 1) RETURNING id", [
    tenant.rows[0].id,
    organization.rows[0].id,
  ]);
  return { invoiceId: invoice.rows[0].id };
}

async function downstreamCounts(client, tenantId) {
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

async function assertNoDownstream(client, tenantId, before, label) {
  const after = await downstreamCounts(client, tenantId);
  for (const key of Object.keys(before)) {
    if (Number(after[key]) !== Number(before[key])) throw new Error(`${label} created downstream ${key}`);
  }
}

async function assertNoForbiddenTables(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.payroll_records') AS payroll_records,
      to_regclass('public.accounting_exports') AS accounting_exports
  `);
  for (const [key, value] of Object.entries(result.rows[0])) {
    if (value) throw new Error(`${key} table was created`);
  }
}

async function createLimitedUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id", [
    `invoice-limited-${suffix}@example.com`,
    "Invoice Limited",
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
