const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";
const dashboardPaths = [
  ["executive", "/dashboard/executive"],
  ["growth", "/dashboard/growth"],
  ["operations", "/dashboard/operations"],
  ["finance", "/dashboard/finance"],
  ["constraints", "/dashboard/constraints"],
  ["recommendations", "/dashboard/recommendations"],
  ["workflows", "/dashboard/workflows"],
  ["kpis", "/dashboard/kpis"],
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.AUTH_JWT_SECRET;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required");

  const client = new Client({ connectionString });
  await client.connect();

  const seeded = await client.query(`
    SELECT u.id AS user_id, t.id AS tenant_id
    FROM users u
    JOIN tenant_users tu ON tu.user_id = u.id
    JOIN tenants t ON t.id = tu.tenant_id
    WHERE u.email = 'admin@jackson-telcom.local'
      AND t.slug = 'jackson-telcom'
    LIMIT 1
  `);
  if (!seeded.rows[0]) throw new Error("Seeded Jackson Telcom admin user was not found");
  const { user_id: userId, tenant_id: tenantId } = seeded.rows[0];
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const marker = `S12${Date.now()}`;

  const limited = await createLimitedUser(client, tenantId, marker);
  const limitedToken = createToken({ sub: limited.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  await createTenantFixture(client, tenantId, userId, marker);
  const outside = await createOutsideTenantFixture(client, marker);
  const expected = await expectedDashboardValues(client, tenantId);

  await expectStatus("unauthorized dashboard blocked", "GET", "/dashboard/executive", undefined, 401);
  await expectStatus("missing dashboard permission blocked", "GET", "/dashboard/executive", `Bearer ${limitedToken}`, 403);

  const before = await readOnlyCounts(client);
  const responses = {};
  for (const [name, path] of dashboardPaths) {
    responses[name] = await expectStatus(`${name} dashboard loads`, "GET", path, `Bearer ${token}`, 200);
  }
  const after = await readOnlyCounts(client);
  assertEqual(after.events, before.events, "dashboard reads created events");
  assertEqual(after.audit_logs, before.audit_logs, "dashboard reads created audit logs");
  assertEqual(after.system_actions, before.system_actions, "dashboard reads created system actions");
  assertEqual(after.opportunities, before.opportunities, "dashboard reads created opportunities");
  assertEqual(after.capacity_providers, before.capacity_providers, "dashboard reads created capacity providers");
  assertEqual(after.production_records, before.production_records, "dashboard reads created production records");
  assertEqual(after.settlements, before.settlements, "dashboard reads created settlements");
  assertEqual(after.invoices, before.invoices, "dashboard reads created invoices");
  assertEqual(after.payments, before.payments, "dashboard reads created payments");
  assertEqual(after.constraints, before.constraints, "dashboard reads created constraints");
  assertEqual(after.recommendations, before.recommendations, "dashboard reads created recommendations");
  assertEqual(after.workflow_instances, before.workflow_instances, "dashboard reads created workflow instances");

  if (responses.growth.signalVolume !== expected.signalVolume) throw new Error(`growth signal volume aggregate is incorrect: expected ${expected.signalVolume}, got ${responses.growth.signalVolume}`);
  if (responses.operations.activatedProviders !== expected.activatedProviders) throw new Error(`activated providers aggregate is incorrect: expected ${expected.activatedProviders}, got ${responses.operations.activatedProviders}`);
  if (responses.executive.opportunityPipeline.awardedValue !== expected.awardedValue) throw new Error("executive opportunity pipeline aggregate is incorrect");
  if (responses.executive.opportunityPipeline.awardedValue === outside.awardedValue) throw new Error("executive dashboard returned outside tenant aggregate");
  if (responses.finance.customerPaymentIntelligence.some((row) => row.customer_organization_id === outside.organizationId)) throw new Error("finance dashboard returned outside tenant payment stats");
  if (responses.constraints.activeConstraints.some((row) => row.id === outside.constraintId)) throw new Error("constraints dashboard returned outside tenant constraint");
  if (responses.recommendations.approved.some((row) => row.id === outside.recommendationId)) throw new Error("recommendations dashboard returned outside tenant recommendation");
  if (responses.workflows.openWorkflowInstances.some((row) => row.id === outside.workflowInstanceId)) throw new Error("workflow dashboard returned outside tenant instance");
  if (responses.kpis.kpiList.some((row) => row.id === outside.kpiId)) throw new Error("KPI dashboard returned outside tenant KPI");

  await client.end();
  console.log("sprint12 smoke passed");
}

async function createLimitedUser(client, tenantId, marker) {
  const user = await client.query(
    "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'test') RETURNING id",
    [`sprint12-limited-${marker}@example.local`, `Sprint 12 Limited ${marker}`],
  );
  await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active')", [tenantId, user.rows[0].id]);
  return { userId: user.rows[0].id };
}

async function createTenantFixture(client, tenantId, userId, marker) {
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantId, `Dashboard Territory ${marker}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'customer') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Dashboard Customer ${marker}`,
  ]);
  await client.query("INSERT INTO signals (tenant_id, title, source_name, status) VALUES ($1, $2, 'fixture', 'verified'), ($1, $3, 'fixture', 'discovered')", [
    tenantId,
    `Verified Signal ${marker}`,
    `Discovered Signal ${marker}`,
  ]);
  await client.query("INSERT INTO opportunity_candidates (tenant_id, organization_id, territory_id, title, name, relationship_access_score, strategic_fit_score) VALUES ($1, $2, $3, $4, $4, 80, 90)", [
    tenantId,
    organization.rows[0].id,
    territory.rows[0].id,
    `Candidate ${marker}`,
  ]);
  const opportunity = await client.query(
    "INSERT INTO opportunities (tenant_id, organization_id, territory_id, owner_user_id, title, work_type, evidence_summary, status, stage, estimated_value, strategic_fit_score) VALUES ($1, $2, $3, $4, $5, 'fiber_build', 'evidence', 'awarded', 'awarded', 700, 90) RETURNING id",
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId, `Awarded Opportunity ${marker}`],
  );
  await client.query("INSERT INTO opportunity_capacity_requirements (tenant_id, opportunity_id, capacity_type, quantity, unit, territory_id) VALUES ($1, $2, 'Bore Crew', 10, 'crews', $3)", [
    tenantId,
    opportunity.rows[0].id,
    territory.rows[0].id,
  ]);
  const provider = await client.query(
    "INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status, verification_status, contract_status) VALUES ($1, $2, $3, 'subcontractor', 'activated', 'verified', 'contracted') RETURNING id",
    [tenantId, organization.rows[0].id, `Dashboard Provider ${marker}`],
  );
  await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type) VALUES ($1, $2, $3, 'bore')", [tenantId, provider.rows[0].id, `Crew ${marker}`]);
  await client.query("INSERT INTO capacity_records (tenant_id, capacity_provider_id, capacity_type, territory_id, quantity, unit) VALUES ($1, $2, 'Bore Crew', $3, 6, 'crews')", [
    tenantId,
    provider.rows[0].id,
    territory.rows[0].id,
  ]);
  await client.query(
    "INSERT INTO capacity_gap_analyses (tenant_id, opportunity_id, territory_id, analysis_name, gap_summary_json, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6)",
    [tenantId, opportunity.rows[0].id, territory.rows[0].id, `Gap ${marker}`, JSON.stringify([{ capacity_type: "Bore Crew", gap_quantity: 4 }]), userId],
  );
  const project = await client.query("INSERT INTO projects (tenant_id, opportunity_id, customer_organization_id, name, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id", [
    tenantId,
    opportunity.rows[0].id,
    organization.rows[0].id,
    `Project ${marker}`,
  ]);
  const workOrder = await client.query("INSERT INTO work_orders (tenant_id, project_id, assigned_capacity_provider_id, title, work_type, location_description, expected_units, unit_type, status) VALUES ($1, $2, $3, $4, 'fiber_build', 'location', 10, 'feet', 'in_progress') RETURNING id", [
    tenantId,
    project.rows[0].id,
    provider.rows[0].id,
    `Work Order ${marker}`,
  ]);
  await client.query("INSERT INTO production_records (tenant_id, project_id, work_order_id, capacity_provider_id, submitted_by_user_id, production_date, quantity_submitted, quantity, unit_type, unit, status, stop_work_status) VALUES ($1, $2, $3, $4, $5, current_date, 5, 5, 'feet', 'feet', 'approved', 'clear')", [
    tenantId,
    project.rows[0].id,
    workOrder.rows[0].id,
    provider.rows[0].id,
    userId,
  ]);
  const contract = await client.query("INSERT INTO contracts (tenant_id, organization_id, name, status) VALUES ($1, $2, $3, 'active') RETURNING id", [tenantId, organization.rows[0].id, `Contract ${marker}`]);
  const settlement = await client.query("INSERT INTO settlements (tenant_id, contract_id, customer_organization_id, gross_amount, net_amount, total_amount, status) VALUES ($1, $2, $3, 100, 100, 100, 'approved') RETURNING id", [
    tenantId,
    contract.rows[0].id,
    organization.rows[0].id,
  ]);
  const invoice = await client.query("INSERT INTO invoices (tenant_id, organization_id, settlement_id, invoice_number, invoice_date, due_date, invoice_amount, total_amount, status) VALUES ($1, $2, $3, $4, current_date - interval '40 days', current_date - interval '10 days', 100, 100, 'overdue') RETURNING id", [
    tenantId,
    organization.rows[0].id,
    settlement.rows[0].id,
    `INV-${marker}`,
  ]);
  await client.query("INSERT INTO ar_records (tenant_id, invoice_id, customer_organization_id, amount_open, age_days, aging_bucket, balance, status) VALUES ($1, $2, $3, 100, 40, '30', 100, 'open')", [
    tenantId,
    invoice.rows[0].id,
    organization.rows[0].id,
  ]);
  await client.query("INSERT INTO payments (tenant_id, invoice_id, settlement_id, amount, payment_amount, payment_date, payment_reference, status) VALUES ($1, $2, $3, 100, 100, current_date, $4, 'reconciled')", [
    tenantId,
    invoice.rows[0].id,
    settlement.rows[0].id,
    `PAY-${marker}`,
  ]);
  await client.query("INSERT INTO customer_payment_stats (tenant_id, customer_organization_id, average_days_to_pay, payment_count, short_pay_count, last_payment_at) VALUES ($1, $2, 30, 1, 0, current_date)", [
    tenantId,
    organization.rows[0].id,
  ]);
  await client.query("INSERT INTO constraints (tenant_id, constraint_type, affected_object_type, affected_object_id, title, owner_id, due_date, severity, status) VALUES ($1, 'execution', 'project', $2, $3, $4, current_date + interval '2 days', 'high', 'open')", [
    tenantId,
    project.rows[0].id,
    `Constraint ${marker}`,
    userId,
  ]);
  await client.query("INSERT INTO recommendations (tenant_id, related_object_type, related_object_id, recommendation_type, title, evidence_summary, confidence_score, confidence, risk_level, expected_impact, status) VALUES ($1, 'project', $2, 'investigate_data', $3, 'evidence', 80, 80, 'medium', 'impact', 'approved')", [
    tenantId,
    project.rows[0].id,
    `Recommendation ${marker}`,
  ]);
  const workflowDefinition = await client.query("INSERT INTO workflow_definitions (tenant_id, name, workflow_name, workflow_category, trigger_event_type, start_status, end_status, sla_hours, status) VALUES ($1, $2, $2, 'execution', 'manual', 'created', 'completed', 24, 'active') RETURNING id", [
    tenantId,
    `Workflow ${marker}`,
  ]);
  const workflowInstance = await client.query("INSERT INTO workflow_instances (tenant_id, workflow_definition_id, source_object_type, source_object_id, owner_user_id, due_at, status) VALUES ($1, $2, 'project', $3, $4, now() - interval '1 hour', 'in_progress') RETURNING id", [
    tenantId,
    workflowDefinition.rows[0].id,
    project.rows[0].id,
    userId,
  ]);
  await client.query("INSERT INTO workflow_tasks (tenant_id, workflow_instance_id, title, task_name, assigned_to, assigned_role, due_at, status) VALUES ($1, $2, $3, $3, $4, 'Operations Manager', now() - interval '1 hour', 'open')", [
    tenantId,
    workflowInstance.rows[0].id,
    `Task ${marker}`,
    userId,
  ]);
  await createKpi(client, tenantId, "Telecom Work Throughput", "optimization", "telecom_work_throughput", 10);
}

async function createOutsideTenantFixture(client, marker) {
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 12 Outside", `sprint12-outside-${Date.now()}`]);
  const tenantId = tenant.rows[0].id;
  const organization = await client.query("INSERT INTO organizations (tenant_id, name, type) VALUES ($1, $2, 'customer') RETURNING id", [tenantId, `Outside Customer ${marker}`]);
  const opportunity = await client.query("INSERT INTO opportunities (tenant_id, organization_id, owner_user_id, title, work_type, evidence_summary, status, stage, estimated_value) VALUES ($1, $2, null, $3, 'fiber_build', 'evidence', 'awarded', 'awarded', 9999) RETURNING id", [
    tenantId,
    organization.rows[0].id,
    `Outside Opportunity ${marker}`,
  ]);
  const constraint = await client.query("INSERT INTO constraints (tenant_id, constraint_type, affected_object_type, affected_object_id, title, severity, status) VALUES ($1, 'cash', 'opportunity', $2, $3, 'critical', 'open') RETURNING id", [
    tenantId,
    opportunity.rows[0].id,
    `Outside Constraint ${marker}`,
  ]);
  const recommendation = await client.query("INSERT INTO recommendations (tenant_id, related_object_type, related_object_id, recommendation_type, title, evidence_summary, confidence_score, confidence, risk_level, expected_impact, status) VALUES ($1, 'opportunity', $2, 'monitor', $3, 'evidence', 70, 70, 'medium', 'impact', 'approved') RETURNING id", [
    tenantId,
    opportunity.rows[0].id,
    `Outside Recommendation ${marker}`,
  ]);
  const workflowDefinition = await client.query("INSERT INTO workflow_definitions (tenant_id, name, workflow_name, workflow_category, trigger_event_type, start_status, end_status, sla_hours, status) VALUES ($1, $2, $2, 'execution', 'manual', 'created', 'completed', 24, 'active') RETURNING id", [
    tenantId,
    `Outside Workflow ${marker}`,
  ]);
  const workflowInstance = await client.query("INSERT INTO workflow_instances (tenant_id, workflow_definition_id, source_object_type, source_object_id, due_at, status) VALUES ($1, $2, 'opportunity', $3, now(), 'in_progress') RETURNING id", [
    tenantId,
    workflowDefinition.rows[0].id,
    opportunity.rows[0].id,
  ]);
  const kpi = await createKpi(client, tenantId, "Telecom Work Throughput", "optimization", "telecom_work_throughput", 9999);
  return { tenantId, organizationId: organization.rows[0].id, awardedValue: 9999, constraintId: constraint.rows[0].id, recommendationId: recommendation.rows[0].id, workflowInstanceId: workflowInstance.rows[0].id, kpiId: kpi.id };
}

async function createKpi(client, tenantId, name, category, key, value) {
  const kpi = await client.query(
    `
    INSERT INTO kpi_definitions (tenant_id, key, name, kpi_name, kpi_category, formula_description, calculation_frequency, owner_role, target_value, alert_threshold, status, calculation)
    VALUES ($1, $2, $3, $3, $4, 'fixture', 'manual', 'Executive', 1, 1, 'active', 'fixture')
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET kpi_name = EXCLUDED.kpi_name,
          name = EXCLUDED.name,
          kpi_category = EXCLUDED.kpi_category,
          status = 'active',
          deleted_at = NULL
    RETURNING id
    `,
    [tenantId, key, name, category],
  );
  await client.query("INSERT INTO kpi_snapshots (tenant_id, kpi_definition_id, value, snapshot_at, snapshot_period_start, snapshot_period_end) VALUES ($1, $2, $3, now(), now(), now())", [
    tenantId,
    kpi.rows[0].id,
    value,
  ]);
  return { id: kpi.rows[0].id };
}

async function readOnlyCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM events) AS events,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs,
      (SELECT count(*)::int FROM system_actions) AS system_actions,
      (SELECT count(*)::int FROM opportunities) AS opportunities,
      (SELECT count(*)::int FROM capacity_providers) AS capacity_providers,
      (SELECT count(*)::int FROM production_records) AS production_records,
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM constraints) AS constraints,
      (SELECT count(*)::int FROM recommendations) AS recommendations,
      (SELECT count(*)::int FROM workflow_instances) AS workflow_instances
  `);
  return result.rows[0];
}

async function expectedDashboardValues(client, tenantId) {
  const result = await client.query(
    `
    SELECT
      (SELECT count(*)::int FROM signals WHERE tenant_id = $1 AND deleted_at IS NULL) AS signal_volume,
      (SELECT count(*)::int FROM capacity_providers WHERE tenant_id = $1 AND status = 'activated' AND deleted_at IS NULL) AS activated_providers,
      (SELECT coalesce(sum(estimated_value), 0)::numeric FROM opportunities WHERE tenant_id = $1 AND status = 'awarded' AND deleted_at IS NULL) AS awarded_value
    `,
    [tenantId],
  );
  return {
    signalVolume: Number(result.rows[0].signal_volume),
    activatedProviders: Number(result.rows[0].activated_providers),
    awardedValue: Number(result.rows[0].awarded_value),
  };
}

async function expectStatus(label, method, path, authorization, expectedStatus, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  if (response.status === 204) return undefined;
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function assertEqual(actual, expected, label) {
  if (Number(actual) !== Number(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function createToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
