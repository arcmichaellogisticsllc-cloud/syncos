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
    for (const role of ["Billing Manager", "Finance Manager", "Customer Validator"]) {
      await assignRole(client, tenantId, tenantUserId, role);
    }
    const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const limitedUserId = await createLimitedUser(client, tenantId);
    const limitedToken = createToken({ sub: limitedUserId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
    const outside = await createOutsideTenant(client);

    await expectStatus("unauthorized blocked", "GET", "/settlements", undefined, 401);
    await expectStatus("missing permission blocked", "GET", "/settlements", `Bearer ${limitedToken}`, 403);
    await expectStatus("cross tenant blocked", "GET", `/settlements/${outside.settlementId}`, `Bearer ${token}`, 404);

    const downstreamBefore = await downstreamCounts(client);
    await expectStatus("invalid settlement_type rejected", "POST", "/settlements", `Bearer ${token}`, 400, { settlement_type: "invoice" });

    const base = await createReadyBillable(client, tenantId, userId, { billableQuantity: 100 });
    const settlement = await expectStatus("settlement creation works", "POST", "/settlements", `Bearer ${token}`, 201, {
      settlement_type: "customer_billable",
      customer_organization_id: base.customerOrganizationId,
      project_id: base.projectId,
      work_order_id: base.workOrderId,
      settlement_period_start: "2026-10-01",
      settlement_period_end: "2026-10-31",
    });
    if (settlement.status !== "draft" || !settlement.settlement_number) throw new Error("Settlement was not created as draft with number");

    await expectStatus("empty settlement submit blocked", "POST", `/settlements/${settlement.id}/submit-review`, `Bearer ${token}`, 400, {});
    const notReady = await createReadyBillable(client, tenantId, userId, { billableQuantity: 10, status: "candidate" });
    await expectStatus("add item requires ready billable", "POST", `/settlements/${settlement.id}/items`, `Bearer ${token}`, 400, {
      billable_item_id: notReady.billableItemId,
      item_type: "customer_billable",
      quantity: 10,
      unit_rate: 10,
    });

    const item = await expectStatus("add item works", "POST", `/settlements/${settlement.id}/items`, `Bearer ${token}`, 201, {
      billable_item_id: base.billableItemId,
      item_type: "customer_billable",
      quantity: 100,
      unit_rate: 12,
      retainage_percent: 10,
      billing_package_status: "ready",
      documentation_status: "ready",
      customer_acceptance_status: "accepted",
      prime_acceptance_status: "accepted",
    });
    if (Number(item.gross_amount) !== 1200 || Number(item.retainage_amount) !== 120 || Number(item.net_amount) !== 1080) throw new Error("Settlement item amounts are incorrect");
    await expectStatus("duplicate billable item blocked", "POST", `/settlements/${settlement.id}/items`, `Bearer ${token}`, 400, {
      billable_item_id: base.billableItemId,
      item_type: "customer_billable",
      quantity: 1,
      unit_rate: 12,
    });

    const totals = await expectStatus("settlement totals recalculated", "GET", `/settlements/${settlement.id}`, `Bearer ${token}`, 200);
    if (Number(totals.gross_billable_amount) !== 1200 || Number(totals.net_settlement_amount) !== 1080) throw new Error("Settlement totals did not recalculate");
    const recalculated = await expectStatus("readiness recalculation works", "POST", `/settlements/${settlement.id}/recalculate-readiness`, `Bearer ${token}`, 201, {});
    if (recalculated.readiness_score === null || recalculated.readiness_score === undefined) throw new Error("Readiness was not recalculated");

    const submitted = await expectStatus("submit review works", "POST", `/settlements/${settlement.id}/submit-review`, `Bearer ${token}`, 201, {
      override_reasons: { retainage_applies: "Retainage reviewed." },
    });
    if (submitted.status !== "ready_for_review") throw new Error("Submit review did not set ready_for_review");
    const started = await expectStatus("start review works", "POST", `/settlements/${settlement.id}/start-review`, `Bearer ${token}`, 201, {});
    if (started.status !== "under_review") throw new Error("Start review did not set under_review");
    await expectStatus("approve requires note", "POST", `/settlements/${settlement.id}/approve`, `Bearer ${token}`, 400, {});
    const approved = await expectStatus("approve works", "POST", `/settlements/${settlement.id}/approve`, `Bearer ${token}`, 201, {
      approval_note: "Approved for future invoice readiness.",
      override_reasons: { retainage_applies: "Retainage reviewed." },
    });
    if (approved.status !== "approved") throw new Error("Settlement was not approved");
    assertNoDownstream(await downstreamCounts(client), downstreamBefore, "approval boundary");

    const invoiceReady = await expectStatus("mark invoice ready works", "POST", `/settlements/${settlement.id}/mark-invoice-ready`, `Bearer ${token}`, 201, { ready_note: "Ready for future invoice." });
    if (!invoiceReady.invoice_ready) throw new Error("Invoice ready flag not set");
    assertNoDownstream(await downstreamCounts(client), downstreamBefore, "invoice ready boundary");

    const payable = await createApprovedContractorSettlement(client, token, tenantId, userId);
    const payableReady = await expectStatus("mark payable ready works", "POST", `/settlements/${payable.settlementId}/mark-payable-ready`, `Bearer ${token}`, 201, { ready_note: "Ready for future payable." });
    if (!payableReady.payable_ready) throw new Error("Payable ready flag not set");
    assertNoDownstream(await downstreamCounts(client), downstreamBefore, "payable ready boundary");

    const held = await createSettlementWithItem(client, token, tenantId, userId);
    await expectStatus("hold requires reason", "POST", `/settlements/${held.settlementId}/place-hold`, `Bearer ${token}`, 400, {});
    await expectStatus("hold works", "POST", `/settlements/${held.settlementId}/place-hold`, `Bearer ${token}`, 201, { hold_reason: "billing_hold" });
    await expectStatus("release hold works", "POST", `/settlements/${held.settlementId}/release-hold`, `Bearer ${token}`, 201, { release_note: "Cleared." });
    await expectStatus("dispute requires reason", "POST", `/settlements/${held.settlementId}/dispute`, `Bearer ${token}`, 400, {});
    await expectStatus("dispute works", "POST", `/settlements/${held.settlementId}/dispute`, `Bearer ${token}`, 201, { dispute_reason: "customer_dispute" });
    await expectStatus("resolve dispute works", "POST", `/settlements/${held.settlementId}/resolve-dispute`, `Bearer ${token}`, 201, { resolution_note: "Resolved." });
    await expectStatus("reject requires reason", "POST", `/settlements/${held.settlementId}/reject`, `Bearer ${token}`, 400, {});
    await expectStatus("reject works", "POST", `/settlements/${held.settlementId}/reject`, `Bearer ${token}`, 201, { rejection_reason: "not_ready" });

    const voidable = await createSettlementWithItem(client, token, tenantId, userId);
    await expectStatus("settlement item void requires reason", "POST", `/settlement-items/${voidable.itemId}/void`, `Bearer ${token}`, 400, {});
    await expectStatus("settlement item void works", "POST", `/settlement-items/${voidable.itemId}/void`, `Bearer ${token}`, 201, { void_reason: "created_in_error" });
    const voidedTotals = await expectStatus("voided item excluded from totals", "GET", `/settlements/${voidable.settlementId}`, `Bearer ${token}`, 200);
    if (Number(voidedTotals.gross_billable_amount) !== 0) throw new Error("Voided item was not excluded from totals");
    await expectStatus("void requires reason", "POST", `/settlements/${voidable.settlementId}/void`, `Bearer ${token}`, 400, {});
    await expectStatus("void works", "POST", `/settlements/${voidable.settlementId}/void`, `Bearer ${token}`, 201, { void_reason: "created_in_error" });

    const archivable = await createSettlementWithItem(client, token, tenantId, userId);
    await expectStatus("archive requires reason", "POST", `/settlements/${archivable.settlementId}/archive`, `Bearer ${token}`, 400, {});
    await expectStatus("archive works", "POST", `/settlements/${archivable.settlementId}/archive`, `Bearer ${token}`, 201, { archive_reason: "no_longer_needed" });

    const list = await expectStatus("list returns enriched fields", "GET", "/settlements", `Bearer ${token}`, 200);
    if (!list.some((row) => row.id === settlement.id && row.item_count !== undefined && row.recommended_next_action !== undefined)) throw new Error("Settlement list was not enriched");
    const detail = await expectStatus("detail returns items and summaries", "GET", `/settlements/${settlement.id}/detail`, `Bearer ${token}`, 200);
    if (!detail.settlement || !detail.settlement_items || !detail.financial_summary || !detail.invoice_readiness_summary) throw new Error("Settlement detail missing context");
    const itemDetail = await expectStatus("item detail works", "GET", `/settlement-items/${item.id}/detail`, `Bearer ${token}`, 200);
    if (!itemDetail.item || !itemDetail.billable_context || !itemDetail.financial_breakdown) throw new Error("Settlement item detail missing context");
    const timeline = await expectStatus("timeline returns settlement events", "GET", `/settlements/${settlement.id}/timeline`, `Bearer ${token}`, 200);
    for (const eventType of ["settlement.created", "settlement.item_added", "settlement.approved", "settlement.invoice_ready"]) {
      if (!timeline.some((row) => row.event_type === eventType)) throw new Error(`Settlement timeline missing ${eventType}`);
    }
    await expectStatus("audit endpoint enforces permission", "GET", `/settlements/${settlement.id}/audit-summary`, `Bearer ${limitedToken}`, 403);
    const audit = await expectStatus("audit endpoint returns records", "GET", `/settlements/${settlement.id}/audit-summary`, `Bearer ${token}`, 200);
    if (!audit.some((row) => row.object_type === "settlement")) throw new Error("Settlement audit missing records");
    const search = await expectStatus("search includes settlements", "GET", `/search?q=${encodeURIComponent(settlement.settlement_number)}`, `Bearer ${token}`, 200);
    if (!search.some((row) => row.object_type === "settlement" && row.id === settlement.id)) throw new Error("Settlement was not searchable");

    assertNoDownstream(await downstreamCounts(client), downstreamBefore, "settlement smoke downstream boundary");
    console.log("settlement smoke passed");
  } finally {
    await client.end();
  }
}

async function createApprovedContractorSettlement(client, token, tenantId, userId) {
  const created = await createSettlementWithItem(client, token, tenantId, userId, "contractor_payable");
  await expectStatus("contractor submit", "POST", `/settlements/${created.settlementId}/submit-review`, `Bearer ${token}`, 201, {});
  await expectStatus("contractor start", "POST", `/settlements/${created.settlementId}/start-review`, `Bearer ${token}`, 201, {});
  await expectStatus("contractor approve", "POST", `/settlements/${created.settlementId}/approve`, `Bearer ${token}`, 201, { approval_note: "Approved payable." });
  return created;
}

async function createSettlementWithItem(client, token, tenantId, userId, settlementType = "customer_billable") {
  const base = await createReadyBillable(client, tenantId, userId, { billableQuantity: 20 });
  const settlement = await expectStatus("helper settlement", "POST", "/settlements", `Bearer ${token}`, 201, {
    settlement_type: settlementType,
    customer_organization_id: base.customerOrganizationId,
    capacity_provider_id: base.providerId,
    project_id: base.projectId,
    work_order_id: base.workOrderId,
  });
  const itemType = settlementType === "contractor_payable" ? "contractor_payable" : "customer_billable";
  const item = await expectStatus("helper item", "POST", `/settlements/${settlement.id}/items`, `Bearer ${token}`, 201, {
    billable_item_id: base.billableItemId,
    item_type: itemType,
    quantity: 20,
    unit_rate: itemType === "customer_billable" ? 10 : undefined,
    contractor_rate: itemType === "contractor_payable" ? 7 : undefined,
    billing_package_status: "ready",
    documentation_status: "ready",
    customer_acceptance_status: "accepted",
    prime_acceptance_status: "accepted",
  });
  return { settlementId: settlement.id, itemId: item.id };
}

async function createReadyBillable(client, tenantId, userId, options = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const status = options.status ?? "ready_for_settlement";
  const territory = await client.query("INSERT INTO territories (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id", [tenantId, `SET Territory ${suffix}`, `ST${suffix.slice(0, 4)}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type, organization_type) VALUES ($1, $2, $3, 'customer', 'customer') RETURNING id", [tenantId, territory.rows[0].id, `SET Customer ${suffix}`]);
  const provider = await client.query("INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, verification_status, contract_status, status) VALUES ($1, $2, $3, 'subcontractor', 'verified', 'contracted', 'activated') RETURNING id", [tenantId, organization.rows[0].id, `SET Provider ${suffix}`]);
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type, status) VALUES ($1, $2, $3, 'splicing', 'active') RETURNING id", [tenantId, provider.rows[0].id, `SET Crew ${suffix}`]);
  const project = await client.query(
    "INSERT INTO projects (tenant_id, customer_organization_id, territory_id, name, status, work_type, scope_summary, location_summary, created_by, updated_by) VALUES ($1, $2, $3, $4, 'active', 'fiber', 'Settlement scope', 'Settlement location', $5, $5) RETURNING id",
    [tenantId, organization.rows[0].id, territory.rows[0].id, `SET Project ${suffix}`, userId],
  );
  const workOrder = await client.query(
    "INSERT INTO work_orders (tenant_id, project_id, assigned_capacity_provider_id, assigned_crew_id, title, work_order_name, work_type, territory_id, scope_summary, location_summary, expected_units, planned_quantity, unit_type, unit, status, qc_status, billable_status, completed_quantity, approved_quantity, billable_quantity) VALUES ($1, $2, $3, $4, $5, $5, 'fiber', $6, 'Settlement scope', 'Settlement location', 100, 100, 'feet', 'feet', 'billable', 'approved', 'billable', 100, 100, $7) RETURNING id",
    [tenantId, project.rows[0].id, provider.rows[0].id, crew.rows[0].id, `SET WO ${suffix}`, territory.rows[0].id, options.billableQuantity ?? 100],
  );
  const production = await client.query(
    "INSERT INTO production_records (tenant_id, project_id, work_order_id, capacity_provider_id, crew_id, production_type, production_date, claimed_quantity, quantity_submitted, quantity, approved_quantity, rejected_quantity, billable_quantity, unit_type, unit, status, qc_status, billable_status, location_summary, description, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, 'daily_production', current_date, 100, 100, 100, 100, 0, $6, 'feet', 'feet', 'approved', 'approved', 'billable', 'Settlement location', 'Settlement production.', $7, $7) RETURNING id",
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id, crew.rows[0].id, options.billableQuantity ?? 100, userId],
  );
  const review = await client.query(
    "INSERT INTO qc_reviews (tenant_id, production_record_id, work_order_id, project_id, review_type, review_status, reviewer_user_id, reviewed_at, claimed_quantity, approved_quantity, rejected_quantity, billable_candidate_quantity, unit, evidence_status, location_status, documentation_status, production_status, customer_acceptance_status, prime_acceptance_status, review_notes, created_by, updated_by) VALUES ($1, $2, $3, $4, 'internal_qc', 'approved', $5, now(), 100, 100, 0, $6, 'feet', 'sufficient', 'valid', 'sufficient', 'valid', 'accepted', 'accepted', 'Settlement QC.', $5, $5) RETURNING id",
    [tenantId, production.rows[0].id, workOrder.rows[0].id, project.rows[0].id, userId, options.billableQuantity ?? 100],
  );
  const billable = await client.query(
    "INSERT INTO billable_items (tenant_id, project_id, work_order_id, production_record_id, qc_review_id, customer_organization_id, capacity_provider_id, crew_id, status, readiness_status, readiness_score, readiness_band, approved_quantity, billable_quantity, held_quantity, unit, rate_description, unit_rate, rate_source, rate_confidence, estimated_billable_amount, customer_acceptance_status, prime_acceptance_status, billing_package_status, documentation_status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready_for_settlement', 100, 'ready_for_settlement', 100, $10, 0, 'feet', 'Settlement Rate', 12, 'manual_rate', 'confirmed', $11, 'accepted', 'accepted', 'ready', 'ready', $12, $12) RETURNING id",
    [tenantId, project.rows[0].id, workOrder.rows[0].id, production.rows[0].id, review.rows[0].id, organization.rows[0].id, provider.rows[0].id, crew.rows[0].id, status, options.billableQuantity ?? 100, (options.billableQuantity ?? 100) * 12, userId],
  );
  return {
    projectId: project.rows[0].id,
    workOrderId: workOrder.rows[0].id,
    providerId: provider.rows[0].id,
    customerOrganizationId: organization.rows[0].id,
    billableItemId: billable.rows[0].id,
  };
}

async function createOutsideTenant(client) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [`Outside SET ${suffix}`, `outside-set-${suffix}`]);
  const settlement = await client.query("INSERT INTO settlements (tenant_id, settlement_number, settlement_type, status, gross_amount, net_amount, total_amount) VALUES ($1, $2, 'customer_billable', 'draft', 0, 0, 0) RETURNING id", [tenant.rows[0].id, `OUT-${suffix}`]);
  return { settlementId: settlement.rows[0].id };
}

async function createLimitedUser(client, tenantId) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await client.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, 'Settlement Limited', 'x', 'active') RETURNING id", [`settlement-limited-${suffix}@example.com`]);
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

async function downstreamCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM ar_records) AS ar_records
  `);
  return result.rows[0];
}

function assertNoDownstream(after, before, label) {
  for (const key of ["invoices", "payments", "ar_records"]) {
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
