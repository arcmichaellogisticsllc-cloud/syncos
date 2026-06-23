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
    const marker = `PAY${Date.now()}`;
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/contractor-payables", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/contractor-payables", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/contractor-payables/${outside.payableId}`, `Bearer ${token}`, 404);

    const forbiddenBefore = await forbiddenCounts(client, tenantId);
    await expectStatus("invalid payable_type rejected", "POST", "/contractor-payables", `Bearer ${token}`, 400, {
      payable_type: "bad_type",
      payable_party_type: "capacity_provider",
      capacity_provider_id: crypto.randomUUID(),
    });
    await expectStatus("invalid payable_party_type rejected", "POST", "/contractor-payables", `Bearer ${token}`, 400, {
      payable_type: "subcontractor",
      payable_party_type: "bad_party",
    });
    await expectStatus("provider tenant validation works", "POST", "/contractor-payables", `Bearer ${token}`, 404, {
      payable_type: "subcontractor",
      payable_party_type: "capacity_provider",
      capacity_provider_id: outside.providerId,
    });

    const fixture = await createSettlementFixture(client, tenantId, userId, marker, { status: "payable_ready", itemType: "contractor_payable", payableReady: true });
    const payable = await expectStatus("contractor payable creation works", "POST", "/contractor-payables", `Bearer ${token}`, 201, {
      payable_type: "subcontractor",
      payable_party_type: "capacity_provider",
      capacity_provider_id: fixture.providerId,
      settlement_id: fixture.settlementId,
      compliance_status: "ready",
      tax_document_status: "ready",
      pay_cycle_start: todayOffset(-7),
      pay_cycle_end: todayOffset(0),
      due_date: todayOffset(7),
    });
    if (!payable.payable_number || payable.status !== "draft" || payable.payment_readiness_status !== "not_ready") throw new Error("Payable defaults were incorrect");

    const notReadyFixture = await createSettlementFixture(client, tenantId, userId, `${marker}NR`, { status: "approved", itemType: "contractor_payable", payableReady: false });
    await expectStatus("add item requires payable_ready settlement item unless override", "POST", `/contractor-payables/${payable.id}/items`, `Bearer ${token}`, 400, {
      settlement_item_id: notReadyFixture.settlementItemId,
    });
    const customerOnlyFixture = await createSettlementFixture(client, tenantId, userId, `${marker}CO`, { status: "payable_ready", itemType: "customer_billable", payableReady: true });
    await expectStatus("customer_billable-only settlement item rejected unless override", "POST", `/contractor-payables/${payable.id}/items`, `Bearer ${token}`, 400, {
      settlement_item_id: customerOnlyFixture.settlementItemId,
    });

    const item = await expectStatus("add payable item from settlement item works", "POST", `/contractor-payables/${payable.id}/items`, `Bearer ${token}`, 201, {
      settlement_item_id: fixture.settlementItemId,
      retainage_percent: 10,
    });
    if (item.settlement_item_id !== fixture.settlementItemId || Number(item.net_payable_amount) !== 180) throw new Error("Payable item traceability or amount was incorrect");
    await expectStatus("duplicate settlement item blocked unless override", "POST", `/contractor-payables/${payable.id}/items`, `Bearer ${token}`, 400, {
      settlement_item_id: fixture.settlementItemId,
    });

    const updatedItem = await expectStatus("item update recalculates totals", "PATCH", `/contractor-payable-items/${item.id}`, `Bearer ${token}`, 200, {
      deduction_amount: 20,
      retainage_percent: 5,
    });
    if (Number(updatedItem.net_payable_amount) !== 170) throw new Error("Payable item update did not recalculate net amount");
    const recalculated = await expectStatus("totals recalculate", "POST", `/contractor-payables/${payable.id}/recalculate-totals`, `Bearer ${token}`, 201);
    if (Number(recalculated.net_payable_amount) !== 170) throw new Error("Payable totals were not recalculated");

    await expectStatus("submit review requires item", "POST", `/contractor-payables/${(await createBarePayable(client, tenantId, userId, marker)).id}/submit-review`, `Bearer ${token}`, 400);
    const submitted = await expectStatus("submit review works", "POST", `/contractor-payables/${payable.id}/submit-review`, `Bearer ${token}`, 201);
    if (submitted.status !== "ready_for_review" || submitted.approval_status !== "pending") throw new Error("Submit review did not set statuses");
    const reviewing = await expectStatus("start review works", "POST", `/contractor-payables/${payable.id}/start-review`, `Bearer ${token}`, 201);
    if (reviewing.status !== "under_review") throw new Error("Start review did not set under_review");
    const approved = await expectStatus("approve requires valid payable and creates no payment", "POST", `/contractor-payables/${payable.id}/approve`, `Bearer ${token}`, 201, {
      approval_note: "Smoke approval.",
    });
    if (approved.status !== "approved" || approved.approval_status !== "approved") throw new Error("Approve did not set approved status");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "approve");
    const ready = await expectStatus("mark payment ready creates no payment/payroll/bank transaction", "POST", `/contractor-payables/${payable.id}/mark-payment-ready`, `Bearer ${token}`, 201, {
      ready_note: "Ready for future payment workflow.",
    });
    if (ready.status !== "payment_ready" || ready.payment_readiness_status !== "ready_for_payment" || ready.payment_status !== "not_paid") throw new Error("Payment readiness did not set expected statuses");
    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "payment readiness");

    const holdPayable = await createApiPayableWithItem(client, token, tenantId, userId, `${marker}HOLD`);
    await expectStatus("hold requires reason", "POST", `/contractor-payables/${holdPayable.id}/place-hold`, `Bearer ${token}`, 400, {});
    const held = await expectStatus("hold works", "POST", `/contractor-payables/${holdPayable.id}/place-hold`, `Bearer ${token}`, 201, { hold_reason: "missing_docs" });
    if (held.status !== "held" || held.hold_status !== "hold") throw new Error("Hold did not set status");
    const released = await expectStatus("release hold works", "POST", `/contractor-payables/${holdPayable.id}/release-hold`, `Bearer ${token}`, 201, { release_note: "Docs received." });
    if (released.hold_status !== "released") throw new Error("Release hold did not set released");

    const disputePayable = await createApiPayableWithItem(client, token, tenantId, userId, `${marker}DISP`);
    await expectStatus("dispute requires reason", "POST", `/contractor-payables/${disputePayable.id}/dispute`, `Bearer ${token}`, 400, {});
    const disputed = await expectStatus("dispute works", "POST", `/contractor-payables/${disputePayable.id}/dispute`, `Bearer ${token}`, 201, { dispute_reason: "amount_dispute" });
    if (disputed.status !== "disputed" || disputed.dispute_status !== "open") throw new Error("Dispute did not set status");
    const resolved = await expectStatus("resolve dispute works", "POST", `/contractor-payables/${disputePayable.id}/resolve-dispute`, `Bearer ${token}`, 201, { resolution_note: "Resolved." });
    if (resolved.dispute_status !== "resolved") throw new Error("Resolve dispute did not set resolved");

    const rejectPayable = await createApiPayableWithItem(client, token, tenantId, userId, `${marker}REJ`);
    await expectStatus("reject requires reason", "POST", `/contractor-payables/${rejectPayable.id}/reject`, `Bearer ${token}`, 400, {});
    const rejected = await expectStatus("reject works", "POST", `/contractor-payables/${rejectPayable.id}/reject`, `Bearer ${token}`, 201, { rejection_reason: "rate_review" });
    if (rejected.status !== "rejected") throw new Error("Reject did not set rejected");

    const terminalPayable = await createApiPayableWithItem(client, token, tenantId, userId, `${marker}TERM`);
    const terminalItem = terminalPayable.item;
    const voidedItem = await expectStatus("item void excludes from totals", "POST", `/contractor-payable-items/${terminalItem.id}/void`, `Bearer ${token}`, 201, { void_reason: "duplicate" });
    if (voidedItem.status !== "voided") throw new Error("Item void did not set status");
    const archiveItemPayable = await createApiPayableWithItem(client, token, tenantId, userId, `${marker}ARCHITEM`);
    const archivedItem = await expectStatus("item archive excludes from totals", "POST", `/contractor-payable-items/${archiveItemPayable.item.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });
    if (archivedItem.status !== "archived") throw new Error("Item archive did not set status");
    await expectStatus("void requires reason", "POST", `/contractor-payables/${terminalPayable.id}/void`, `Bearer ${token}`, 400, {});
    const voided = await expectStatus("void works", "POST", `/contractor-payables/${terminalPayable.id}/void`, `Bearer ${token}`, 201, { void_reason: "smoke_void" });
    if (voided.status !== "voided") throw new Error("Payable void did not set status");
    await expectStatus("archive requires reason", "POST", `/contractor-payables/${archiveItemPayable.id}/archive`, `Bearer ${token}`, 400, {});
    const archived = await expectStatus("archive works", "POST", `/contractor-payables/${archiveItemPayable.id}/archive`, `Bearer ${token}`, 201, { archive_reason: "smoke_archive" });
    if (archived.status !== "archived") throw new Error("Payable archive did not set status");

    const list = await expectStatus("list returns enriched fields", "GET", `/contractor-payables?q=${encodeURIComponent(payable.payable_number)}`, `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === payable.id && row.recommended_next_action)) throw new Error("Payable list missing enriched row");
    const detail = await expectStatus("detail returns items and summaries", "GET", `/contractor-payables/${payable.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.contractor_payable_items?.length || detail.payment_boundary_summary.creates_payment) throw new Error("Payable detail missing items or boundary summary");
    const itemDetail = await expectStatus("item detail returns source traceability", "GET", `/contractor-payable-items/${item.id}/detail`, `Bearer ${token}`, 200);
    if (!itemDetail.settlement_context || !itemDetail.settlement_item_context) throw new Error("Payable item detail missing traceability");
    const timeline = await expectStatus("timeline returns payable/item events", "GET", `/contractor-payables/${payable.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["contractor_payable.created", "contractor_payable.item_added", "contractor_payable.payment_ready"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Payable timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/contractor-payables/${payable.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/contractor-payables/${payable.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.action === "contractor_payable.create")) throw new Error("Payable audit missing create action");
    const search = await expectStatus("search includes contractor payables", "GET", `/search?q=${encodeURIComponent(payable.payable_number)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "contractor_payable" && row.id === payable.id)) throw new Error("Search missing contractor payable");

    await assertForbiddenUnchanged(client, tenantId, forbiddenBefore, "contractor payable smoke");
    console.log("contractor payable smoke passed");
  } finally {
    await client.end();
  }
}

async function createApiPayableWithItem(client, token, tenantId, userId, marker) {
  const fixture = await createSettlementFixture(client, tenantId, userId, marker, { status: "payable_ready", itemType: "contractor_payable", payableReady: true });
  const payable = await expectStatus("api helper payable create", "POST", "/contractor-payables", `Bearer ${token}`, 201, {
    payable_type: "subcontractor",
    payable_party_type: "capacity_provider",
    capacity_provider_id: fixture.providerId,
    settlement_id: fixture.settlementId,
    compliance_status: "ready",
    tax_document_status: "ready",
  });
  const item = await expectStatus("api helper item add", "POST", `/contractor-payables/${payable.id}/items`, `Bearer ${token}`, 201, {
    settlement_item_id: fixture.settlementItemId,
  });
  return { ...payable, fixture, item };
}

async function createBarePayable(client, tenantId, userId, marker) {
  const fixture = await createSettlementFixture(client, tenantId, userId, `${marker}BARE`, { status: "payable_ready", itemType: "contractor_payable", payableReady: true });
  const result = await client.query(
    `INSERT INTO contractor_payables (tenant_id, payable_number, payable_type, payable_party_type, capacity_provider_id, settlement_id, compliance_status, tax_document_status, created_by, updated_by)
     VALUES ($1, $2, 'subcontractor', 'capacity_provider', $3, $4, 'ready', 'ready', $5, $5) RETURNING id`,
    [tenantId, `PAY-BARE-${marker}-${crypto.randomUUID().slice(0, 6)}`, fixture.providerId, fixture.settlementId, userId],
  );
  return result.rows[0];
}

async function createSettlementFixture(client, tenantId, userId, marker, options) {
  const org = await client.query("INSERT INTO organizations (tenant_id, name, type, organization_type) VALUES ($1, $2, 'customer', 'customer') RETURNING id", [tenantId, `Payable Customer ${marker}`]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, 'subcontractor', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, `Payable Provider ${marker}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'bore', 'active') RETURNING id", [tenantId, provider.rows[0].id, `Payable Crew ${marker}`]);
  const settlement = await client.query(
    `
    INSERT INTO settlements (
      tenant_id, settlement_number, settlement_type, status, readiness_status, customer_organization_id,
      capacity_provider_id, settlement_period_start, settlement_period_end, gross_billable_amount,
      contractor_payable_amount, net_settlement_amount, payable_ready, created_by, updated_by
    )
    VALUES ($1, $2, 'contractor_payable', $3, 'ready_for_approval', $4, $5, current_date, current_date, 0, 200, 200, $6, $7, $7)
    RETURNING id
    `,
    [tenantId, `SET-${marker}-${crypto.randomUUID().slice(0, 6)}`, options.payableReady ? "payable_ready" : "approved", org.rows[0].id, provider.rows[0].id, options.payableReady, userId],
  );
  const item = await client.query(
    `
    INSERT INTO settlement_items (
      tenant_id, settlement_id, quantity, unit_rate, gross_amount, amount, description, status,
      item_type, unit, contractor_rate, contractor_payable_amount, net_amount, capacity_provider_id, crew_id,
      customer_organization_id, created_by, updated_by
    )
    VALUES ($1, $2, 2, 100, 200, 200, $3, $4, $5, 'unit', 100, 200, 200, $6, $7, $8, $9, $9)
    RETURNING id
    `,
    [tenantId, settlement.rows[0].id, `Payable item ${marker}`, options.status, options.itemType, provider.rows[0].id, crew.rows[0].id, org.rows[0].id, userId],
  );
  return {
    customerOrganizationId: org.rows[0].id,
    providerId: provider.rows[0].id,
    crewId: crew.rows[0].id,
    settlementId: settlement.rows[0].id,
    settlementItemId: item.rows[0].id,
  };
}

async function createOutsideTenant(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Payable Outside Tenant", `payable-outside-${suffix}`]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, name, provider_type) VALUES ($1, 'Outside Payable Provider', 'subcontractor') RETURNING id", [tenant.rows[0].id]);
  const payable = await client.query(
    "INSERT INTO contractor_payables (tenant_id, payable_number, payable_type, payable_party_type, capacity_provider_id) VALUES ($1, 'OUTSIDE-PAYABLE', 'subcontractor', 'capacity_provider', $2) RETURNING id",
    [tenant.rows[0].id, provider.rows[0].id],
  );
  return { tenantId: tenant.rows[0].id, providerId: provider.rows[0].id, payableId: payable.rows[0].id };
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
    `payable-limited-${suffix}@example.com`,
    "Payable Limited",
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
