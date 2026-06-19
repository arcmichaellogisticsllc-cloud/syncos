const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";
const sprint7Permissions = [
  "contract.read",
  "contract.create",
  "contract.update",
  "contract.archive",
  "rate_schedule.read",
  "rate_schedule.create",
  "rate_schedule.update",
  "rate_schedule.archive",
  "rate_code.read",
  "rate_code.create",
  "rate_code.update",
  "rate_code.archive",
  "settlement.read",
  "settlement.create",
  "settlement.update",
  "settlement.internal_review",
  "settlement.ready_to_submit",
  "settlement.submit",
  "settlement.customer_review",
  "settlement.approve",
  "settlement.dispute",
  "settlement.archive",
  "settlement_item.read",
  "settlement_item.create",
  "settlement_item.update",
  "settlement_item.archive",
  "search.read",
];

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
  const marker = `S7${Date.now()}`;
  for (const role of ["Billing Manager", "Finance Manager", "Customer Validator"]) {
    await assignRole(client, tenantId, tenantUserId, role);
  }
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  await expectStatus("unauthorized contract create blocked", "POST", "/contracts", undefined, 401, { name: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});

  const base = await createBaseData(client, tenantId, userId, marker);
  const outside = await createOutsideData(client);

  const contractBefore = await counts(client);
  const contract = await expectStatus("contract create", "POST", "/contracts", `Bearer ${token}`, 201, {
    organization_id: base.organizationId,
    name: `Contract ${marker}`,
    contract_number: `C-${marker}`,
    contract_type: "master_service",
    payment_terms_days: 45,
    retainage_percent: 10,
    status: "active",
  });
  await expectWrite(client, contractBefore, "contract.created", "contract create");
  await expectStatus("cross-tenant contract blocked", "GET", `/contracts/${outside.contractId}`, `Bearer ${token}`, 404);

  const scheduleBefore = await counts(client);
  const schedule = await expectStatus("rate schedule create", "POST", "/rate-schedules", `Bearer ${token}`, 201, {
    contract_id: contract.id,
    name: `Rate Schedule ${marker}`,
    effective_date: "2026-09-01",
    status: "active",
  });
  await expectWrite(client, scheduleBefore, "rate_schedule.created", "rate schedule create");

  const rateCodeBefore = await counts(client);
  const rateCode = await expectStatus("rate code create", "POST", "/rate-codes", `Bearer ${token}`, 201, {
    rate_schedule_id: schedule.id,
    code: `FT-${marker}`,
    description: `Feet ${marker}`,
    unit_type: "feet",
    customer_rate: 12,
  });
  await expectWrite(client, rateCodeBefore, "rate_code.created", "rate code create");
  const badRateCode = await expectStatus("mismatched rate code create", "POST", "/rate-codes", `Bearer ${token}`, 201, {
    rate_schedule_id: schedule.id,
    code: `EA-${marker}`,
    description: `Each ${marker}`,
    unit_type: "each",
    customer_rate: 5,
  });

  await expectStatus("settlement create requires contract", "POST", "/settlements", `Bearer ${token}`, 400, {
    customer_organization_id: base.organizationId,
    billing_period_start: "2026-09-01",
    billing_period_end: "2026-09-30",
  });
  const settlementBefore = await counts(client);
  const settlement = await expectStatus("settlement create", "POST", "/settlements", `Bearer ${token}`, 201, {
    contract_id: contract.id,
    customer_organization_id: base.organizationId,
    billing_period_start: "2026-09-01",
    billing_period_end: "2026-09-30",
    retainage_amount: 10,
    adjustment_amount: 5,
    chargeback_amount: 3,
  });
  await expectWrite(client, settlementBefore, "settlement.created", "settlement create");

  await expectStatus("internal review requires items", "POST", `/settlements/${settlement.id}/internal-review`, `Bearer ${token}`, 400, {});
  await expectStatus("settlement item requires billable production", "POST", `/settlements/${settlement.id}/items`, `Bearer ${token}`, 400, {
    production_record_id: base.nonBillableProductionId,
    rate_code_id: rateCode.id,
    quantity: 10,
    unit_rate: 12,
  });
  await expectStatus("settlement item unit_type validation", "POST", `/settlements/${settlement.id}/items`, `Bearer ${token}`, 400, {
    production_record_id: base.billableProductionId,
    rate_code_id: badRateCode.id,
    quantity: 10,
    unit_rate: 12,
  });

  const itemBefore = await counts(client);
  const item = await expectStatus("settlement item create", "POST", `/settlements/${settlement.id}/items`, `Bearer ${token}`, 201, {
    production_record_id: base.billableProductionId,
    rate_code_id: rateCode.id,
    quantity: 10,
    unit_rate: 12,
  });
  if (Number(item.gross_amount) !== 120) throw new Error("settlement item gross amount incorrect");
  await expectWrite(client, itemBefore, "settlement_item.created", "settlement item create");
  const recalculated = await expectStatus("settlement recalculated", "GET", `/settlements/${settlement.id}`, `Bearer ${token}`, 200);
  if (Number(recalculated.gross_amount) !== 120) throw new Error("settlement gross amount incorrect");
  if (Number(recalculated.net_amount) !== 102) throw new Error(`settlement net amount incorrect: ${recalculated.net_amount}`);

  await expectStatus("ready-to-submit requires internal review", "POST", `/settlements/${settlement.id}/ready-to-submit`, `Bearer ${token}`, 400, {});
  const reviewBefore = await counts(client);
  const review = await expectStatus("internal review starts", "POST", `/settlements/${settlement.id}/internal-review`, `Bearer ${token}`, 201, {});
  if (review.status !== "internal_review") throw new Error("settlement not internal_review");
  await expectWrite(client, reviewBefore, "settlement.internal_review_started", "internal review");

  await expectStatus("submit requires ready-to-submit", "POST", `/settlements/${settlement.id}/submit`, `Bearer ${token}`, 400, {});
  const readyBefore = await counts(client);
  const ready = await expectStatus("ready to submit", "POST", `/settlements/${settlement.id}/ready-to-submit`, `Bearer ${token}`, 201, {});
  if (ready.status !== "ready_to_submit") throw new Error("settlement not ready_to_submit");
  await expectWrite(client, readyBefore, "settlement.ready_to_submit", "ready to submit");

  const submitBefore = await counts(client);
  const submitted = await expectStatus("submit settlement", "POST", `/settlements/${settlement.id}/submit`, `Bearer ${token}`, 201, {});
  if (submitted.status !== "submitted") throw new Error("settlement not submitted");
  await expectWrite(client, submitBefore, "settlement.submitted", "submit");

  await expectStatus("approve requires customer_review", "POST", `/settlements/${settlement.id}/approve`, `Bearer ${token}`, 400, {});
  const customerReviewBefore = await counts(client);
  const customerReview = await expectStatus("customer review", "POST", `/settlements/${settlement.id}/customer-review`, `Bearer ${token}`, 201, {});
  if (customerReview.status !== "customer_review") throw new Error("settlement not customer_review");
  await expectWrite(client, customerReviewBefore, "settlement.customer_review_started", "customer review");

  const approveBefore = await counts(client);
  const approved = await expectStatus("approve settlement", "POST", `/settlements/${settlement.id}/approve`, `Bearer ${token}`, 201, {});
  if (approved.status !== "approved") throw new Error("settlement not approved");
  await expectWrite(client, approveBefore, "settlement.approved", "approve");

  const disputeTarget = await createSettlementWithItem(client, tenantId, base, contract.id, rateCode.id, marker);
  await expectStatus("dispute requires reason", "POST", `/settlements/${disputeTarget.settlementId}/dispute`, `Bearer ${token}`, 400, {});
  const disputeBefore = await counts(client);
  const disputed = await expectStatus("dispute settlement", "POST", `/settlements/${disputeTarget.settlementId}/dispute`, `Bearer ${token}`, 201, {
    reason: `Disputed ${marker}`,
  });
  if (disputed.status !== "disputed" || disputed.dispute_reason !== `Disputed ${marker}`) throw new Error("settlement dispute fields incorrect");
  await expectWrite(client, disputeBefore, "settlement.disputed", "dispute");

  const results = await expectStatus("tenant-scoped settlement search", "GET", `/search?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
  for (const expected of [
    ["contract", contract.id],
    ["rate_schedule", schedule.id],
    ["rate_code", rateCode.id],
  ]) {
    if (!results.some((row) => row.object_type === expected[0] && row.id === expected[1])) throw new Error(`search missing ${expected[0]}`);
  }
  if (results.some((row) => row.id === outside.contractId)) throw new Error("search returned cross-tenant contract");

  const forbiddenCounts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM ar_records) AS ar_records
  `);
  if (forbiddenCounts.rows[0].invoices !== 0) throw new Error("Sprint 7 created invoices");
  if (forbiddenCounts.rows[0].payments !== 0) throw new Error("Sprint 7 created payments");
  if (forbiddenCounts.rows[0].ar_records !== 0) throw new Error("Sprint 7 created AR records");

  await client.end();
  console.log("sprint7 smoke passed");
}

async function createBaseData(client, tenantId, userId, marker) {
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantId, `Territory ${marker}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'customer') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Customer ${marker}`,
  ]);
  const opportunity = await client.query(
    `
    INSERT INTO opportunities (tenant_id, organization_id, territory_id, owner_user_id, title, work_type, evidence_summary, status, stage)
    VALUES ($1, $2, $3, $4, $5, 'fiber_build', 'award evidence', 'awarded', 'awarded')
    RETURNING id
    `,
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId, `Opportunity ${marker}`],
  );
  const project = await client.query(
    "INSERT INTO projects (tenant_id, opportunity_id, customer_organization_id, name) VALUES ($1, $2, $3, $4) RETURNING id",
    [tenantId, opportunity.rows[0].id, organization.rows[0].id, `Project ${marker}`],
  );
  const provider = await client.query(
    "INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status, verification_status, contract_status) VALUES ($1, $2, $3, 'subcontractor', 'activated', 'verified', 'contracted') RETURNING id",
    [tenantId, organization.rows[0].id, `Provider ${marker}`],
  );
  const workOrder = await client.query(
    `
    INSERT INTO work_orders (tenant_id, project_id, assigned_capacity_provider_id, title, work_type, location_description, expected_units, unit_type, status)
    VALUES ($1, $2, $3, $4, 'fiber_build', $5, 100, 'feet', 'in_progress')
    RETURNING id
    `,
    [tenantId, project.rows[0].id, provider.rows[0].id, `Work Order ${marker}`, `Location ${marker}`],
  );
  const billable = await client.query(
    `
    INSERT INTO production_records (
      tenant_id, project_id, work_order_id, capacity_provider_id,
      production_date, quantity_submitted, quantity, unit_type, unit, status,
      accepted_quantity, approved_quantity, billable_status
    )
    VALUES ($1, $2, $3, $4, '2026-09-01', 10, 10, 'feet', 'feet', 'billable', 10, 10, 'billable')
    RETURNING id
    `,
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id],
  );
  const nonBillable = await client.query(
    `
    INSERT INTO production_records (
      tenant_id, project_id, work_order_id, capacity_provider_id,
      production_date, quantity_submitted, quantity, unit_type, unit, status
    )
    VALUES ($1, $2, $3, $4, '2026-09-01', 10, 10, 'feet', 'feet', 'approved')
    RETURNING id
    `,
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id],
  );
  return {
    organizationId: organization.rows[0].id,
    billableProductionId: billable.rows[0].id,
    nonBillableProductionId: nonBillable.rows[0].id,
  };
}

async function createOutsideData(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 7 Outside Tenant", `sprint7-outside-${suffix}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type) VALUES ($1, 'Outside Customer', 'customer') RETURNING id", [tenant.rows[0].id]);
  const contract = await client.query("INSERT INTO contracts (tenant_id, organization_id, name) VALUES ($1, $2, 'Outside Contract') RETURNING id", [
    tenant.rows[0].id,
    organization.rows[0].id,
  ]);
  return { contractId: contract.rows[0].id };
}

async function createSettlementWithItem(client, tenantId, base, contractId, rateCodeId, marker) {
  const settlement = await client.query(
    `
    INSERT INTO settlements (
      tenant_id, contract_id, customer_organization_id, billing_period_start, billing_period_end,
      gross_amount, retainage_amount, adjustment_amount, chargeback_amount, net_amount, total_amount
    )
    VALUES ($1, $2, $3, '2026-09-01', '2026-09-30', 20, 0, 0, 0, 20, 20)
    RETURNING id
    `,
    [tenantId, contractId, base.organizationId],
  );
  await client.query(
    `
    INSERT INTO settlement_items (tenant_id, settlement_id, production_record_id, rate_code_id, quantity, unit_rate, gross_amount, amount)
    VALUES ($1, $2, $3, $4, 2, 10, 20, 20)
    `,
    [tenantId, settlement.rows[0].id, base.billableProductionId, rateCodeId],
  );
  return { settlementId: settlement.rows[0].id };
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

async function expectWrite(client, before, eventType, label) {
  const after = await counts(client);
  if (after.events !== before.events + 1) throw new Error(`${label}: expected event delta`);
  if (after.event_payloads !== before.event_payloads + 1) throw new Error(`${label}: expected event payload delta`);
  if (after.audit_logs !== before.audit_logs + 1) throw new Error(`${label}: expected audit delta`);
  if (after.system_actions !== before.system_actions + 1) throw new Error(`${label}: expected system action delta`);
  if (after[eventType] !== before[eventType] + 1) throw new Error(`${label}: expected ${eventType}`);
}

async function counts(client) {
  const eventTypes = [
    "contract.created",
    "rate_schedule.created",
    "rate_code.created",
    "settlement.created",
    "settlement.internal_review_started",
    "settlement.ready_to_submit",
    "settlement.submitted",
    "settlement.customer_review_started",
    "settlement.approved",
    "settlement.disputed",
    "settlement_item.created",
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
