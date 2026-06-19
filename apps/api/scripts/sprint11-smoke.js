const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";
const kpis = [
  ["Signal Conversion Rate", "intelligence", "opportunity_candidates / verified_signals"],
  ["Opportunity Candidate Conversion Rate", "opportunity", "opportunities / opportunity_candidates"],
  ["Qualified Opportunity Value", "opportunity", "sum(opportunity.estimated_value) where status != archived"],
  ["Capacity Coverage Ratio", "capacity", "available capacity quantity / required opportunity capacity quantity"],
  ["Production Approval Rate", "execution", "approved production records / submitted production records"],
  ["Correction Rate", "execution", "correction_required production records / submitted production records"],
  ["Settlement Conversion Rate", "cash", "approved settlements / billable production records"],
  ["Cash Conversion Rate", "cash", "payments reconciled / approved settlements"],
  ["Constraint Resolution Time", "optimization", "average constraint resolved_at - created_at"],
  ["Decision Velocity", "optimization", "average recommendation approved_at - created_at"],
  ["Telecom Work Throughput", "optimization", "approved architecture throughput formula"],
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
  const { user_id: userId, tenant_id: tenantId } = seeded.rows[0];
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const marker = `S11${Date.now()}`;
  await createFixture(client, tenantId, userId, marker);
  const outside = await createOutsideData(client, marker);

  await expectStatus("unauthorized KPI create blocked", "POST", "/kpis", undefined, 401, { kpi_name: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});
  await expectStatus("cross-tenant KPI blocked", "GET", `/kpis/${outside.kpiId}`, `Bearer ${token}`, 404);

  const created = {};
  for (const [name, category, formula] of kpis) {
    const before = await counts(client);
    const kpi = await expectStatus(`KPI create ${name}`, "POST", "/kpis", `Bearer ${token}`, 201, {
      kpi_name: name,
      kpi_category: category,
      formula_description: formula,
      calculation_frequency: "manual",
      owner_role: "Executive",
      target_value: 1,
      alert_threshold: alertThresholdFor(name),
      status: "active",
    });
    created[name] = kpi;
    await expectWrite(client, before, "kpi.created", `KPI create ${name}`);
  }

  const expected = await expectedValues(client, tenantId);
  const firstBefore = await counts(client);
  const signalSnapshot = await expectStatus("Signal Conversion calculation", "POST", `/kpis/${created["Signal Conversion Rate"].id}/calculate`, `Bearer ${token}`, 201, {});
  assertClose(signalSnapshot.calculated_value, expected["Signal Conversion Rate"], "Signal Conversion Rate");
  await expectWrite(client, firstBefore, "kpi.calculated", "Signal Conversion calculation", 3);
  await expectDelta(client, firstBefore, "kpi_snapshot.created", 1, "Signal Conversion snapshot");
  await expectDelta(client, firstBefore, "kpi_alert.created", 1, "Signal Conversion alert");

  const history = await expectStatus("KPI history returns snapshots", "GET", `/kpis/${created["Signal Conversion Rate"].id}/history`, `Bearer ${token}`, 200);
  if (!history.some((row) => row.id === signalSnapshot.snapshot_id)) throw new Error("KPI history missing snapshot");
  const snapshotRead = await expectStatus("KPI snapshot read", "GET", `/kpi-snapshots/${signalSnapshot.snapshot_id}`, `Bearer ${token}`, 200);
  assertClose(snapshotRead.value, expected["Signal Conversion Rate"], "snapshot value");

  const alerts = await expectStatus("KPI alerts list", "GET", "/kpi-alerts", `Bearer ${token}`, 200);
  const alert = alerts.find((row) => row.kpi_definition_id === created["Signal Conversion Rate"].id);
  if (!alert) throw new Error("threshold violation did not create KPI alert");
  const archiveAlertBefore = await counts(client);
  const archivedAlert = await expectStatus("KPI alert archive", "POST", `/kpi-alerts/${alert.id}/archive`, `Bearer ${token}`, 201, {});
  if (archivedAlert.status !== "archived") throw new Error("KPI alert not archived");
  await expectWrite(client, archiveAlertBefore, "kpi_alert.archived", "KPI alert archive");

  for (const name of kpis.map((row) => row[0]).filter((name) => name !== "Signal Conversion Rate")) {
    const before = await counts(client);
    const result = await expectStatus(`${name} calculation`, "POST", `/kpis/${created[name].id}/calculate`, `Bearer ${token}`, 201, {});
    assertClose(result.calculated_value, expected[name], name);
    await expectWrite(client, before, "kpi.calculated", `${name} calculation`, 2);
    await expectDelta(client, before, "kpi_snapshot.created", 1, `${name} snapshot`);
  }

  const allBefore = await counts(client);
  const allResults = await expectStatus("calculate all KPIs", "POST", "/kpis/calculate-all", `Bearer ${token}`, 201, {});
  if (allResults.length < kpis.length) throw new Error("calculate-all did not return all KPI calculations");
  await expectDelta(client, allBefore, "kpi.calculated", kpis.length, "calculate all KPI events");

  const searchResults = await expectStatus("tenant-scoped KPI search", "GET", `/search?q=${encodeURIComponent("Signal Conversion")}`, `Bearer ${token}`, 200);
  if (!searchResults.some((row) => row.object_type === "kpi" && row.id === created["Signal Conversion Rate"].id)) throw new Error("search missing KPI definition");
  if (searchResults.some((row) => row.id === outside.kpiId)) throw new Error("search returned cross-tenant KPI");

  const forbidden = await client.query(`
    SELECT
      to_regclass('public.forecasts') AS forecasts,
      to_regclass('public.ai_kpi_generations') AS ai_kpi_generations,
      to_regclass('public.kpi_worker_jobs') AS kpi_worker_jobs
  `);
  if (forbidden.rows[0].forecasts) throw new Error("forecasting table was created");
  if (forbidden.rows[0].ai_kpi_generations) throw new Error("AI KPI generation table was created");
  if (forbidden.rows[0].kpi_worker_jobs) throw new Error("KPI worker job table was created");

  await client.end();
  console.log("sprint11 smoke passed");
}

async function createFixture(client, tenantId, userId, marker) {
  const territory = await client.query("INSERT INTO territories (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantId, `Territory ${marker}`]);
  const organization = await client.query("INSERT INTO organizations (tenant_id, territory_id, name, type) VALUES ($1, $2, $3, 'customer') RETURNING id", [
    tenantId,
    territory.rows[0].id,
    `Customer ${marker}`,
  ]);
  for (let index = 0; index < 4; index += 1) {
    await client.query("INSERT INTO signals (tenant_id, title, source_name, status) VALUES ($1, $2, 'fixture', 'verified')", [tenantId, `Verified Signal ${marker} ${index}`]);
  }
  await client.query("INSERT INTO signals (tenant_id, title, source_name, status) VALUES ($1, $2, 'fixture', 'discovered')", [tenantId, `Unverified Signal ${marker}`]);
  for (let index = 0; index < 2; index += 1) {
    await client.query("INSERT INTO opportunity_candidates (tenant_id, organization_id, territory_id, title, name, work_type, evidence_summary) VALUES ($1, $2, $3, $4, $4, 'fiber_build', 'evidence')", [
      tenantId,
      organization.rows[0].id,
      territory.rows[0].id,
      `Candidate ${marker} ${index}`,
    ]);
  }
  const opportunity = await client.query(
    `
    INSERT INTO opportunities (tenant_id, organization_id, territory_id, owner_user_id, title, work_type, evidence_summary, status, stage, estimated_value)
    VALUES ($1, $2, $3, $4, $5, 'fiber_build', 'evidence', 'qualified', 'qualified', 1000)
    RETURNING id
    `,
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId, `Opportunity ${marker}`],
  );
  await client.query("INSERT INTO opportunity_capacity_requirements (tenant_id, opportunity_id, capacity_type, quantity, unit, territory_id) VALUES ($1, $2, 'Bore Crew', 10, 'crews', $3)", [
    tenantId,
    opportunity.rows[0].id,
    territory.rows[0].id,
  ]);
  const provider = await client.query(
    "INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status, verification_status, contract_status) VALUES ($1, $2, $3, 'subcontractor', 'activated', 'verified', 'contracted') RETURNING id",
    [tenantId, organization.rows[0].id, `Provider ${marker}`],
  );
  await client.query("INSERT INTO capacity_records (tenant_id, capacity_provider_id, capacity_type, territory_id, quantity, unit) VALUES ($1, $2, 'Bore Crew', $3, 5, 'crews')", [
    tenantId,
    provider.rows[0].id,
    territory.rows[0].id,
  ]);
  const project = await client.query("INSERT INTO projects (tenant_id, opportunity_id, customer_organization_id, name) VALUES ($1, $2, $3, $4) RETURNING id", [
    tenantId,
    opportunity.rows[0].id,
    organization.rows[0].id,
    `Project ${marker}`,
  ]);
  const workOrder = await client.query(
    `
    INSERT INTO work_orders (tenant_id, project_id, assigned_capacity_provider_id, title, work_type, location_description, expected_units, unit_type, status)
    VALUES ($1, $2, $3, $4, 'fiber_build', 'location', 100, 'feet', 'in_progress')
    RETURNING id
    `,
    [tenantId, project.rows[0].id, provider.rows[0].id, `Work Order ${marker}`],
  );
  for (const status of ["submitted", "approved", "correction_required", "billable"]) {
    await client.query(
      `
      INSERT INTO production_records (
        tenant_id, project_id, work_order_id, capacity_provider_id, submitted_by_user_id,
        production_date, quantity_submitted, quantity, unit_type, unit, status
      )
      VALUES ($1, $2, $3, $4, $5, current_date, 10, 10, 'feet', 'feet', $6)
      `,
      [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id, userId, status],
    );
  }
  const contract = await client.query("INSERT INTO contracts (tenant_id, organization_id, name, status) VALUES ($1, $2, $3, 'active') RETURNING id", [
    tenantId,
    organization.rows[0].id,
    `Contract ${marker}`,
  ]);
  const settlement = await client.query(
    "INSERT INTO settlements (tenant_id, contract_id, customer_organization_id, gross_amount, net_amount, total_amount, status) VALUES ($1, $2, $3, 100, 100, 100, 'approved') RETURNING id",
    [tenantId, contract.rows[0].id, organization.rows[0].id],
  );
  const invoice = await client.query(
    "INSERT INTO invoices (tenant_id, organization_id, settlement_id, invoice_number, invoice_date, due_date, invoice_amount, total_amount, status) VALUES ($1, $2, $3, $4, current_date, current_date + interval '30 days', 100, 100, 'submitted') RETURNING id",
    [tenantId, organization.rows[0].id, settlement.rows[0].id, `INV-${marker}`],
  );
  await client.query("INSERT INTO payments (tenant_id, invoice_id, settlement_id, amount, payment_amount, payment_date, payment_reference, status) VALUES ($1, $2, $3, 100, 100, current_date, $4, 'reconciled')", [
    tenantId,
    invoice.rows[0].id,
    settlement.rows[0].id,
    `PAY-${marker}`,
  ]);
  await client.query(
    "INSERT INTO constraints (tenant_id, constraint_type, affected_object_type, affected_object_id, title, severity, status, created_at, resolved_at) VALUES ($1, 'execution', 'project', $2, $3, 'medium', 'resolved', now() - interval '4 hours', now())",
    [tenantId, project.rows[0].id, `Resolved Constraint ${marker}`],
  );
  await client.query(
    `
    INSERT INTO recommendations (
      tenant_id, related_object_type, related_object_id, recommendation_type, title,
      evidence_summary, confidence_score, confidence, risk_level, expected_impact, status, created_at, approved_at
    )
    VALUES ($1, 'project', $2, 'investigate_data', $3, 'evidence', 80, 80, 'medium', 'impact', 'approved', now() - interval '2 hours', now())
    `,
    [tenantId, project.rows[0].id, `Approved Recommendation ${marker}`],
  );
}

async function createOutsideData(client, marker) {
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 11 Outside Tenant", `sprint11-outside-${Date.now()}`]);
  const kpi = await client.query(
    "INSERT INTO kpi_definitions (tenant_id, key, name, kpi_name, kpi_category, formula_description, calculation_frequency, owner_role, target_value, alert_threshold, status, calculation) VALUES ($1, 'outside_signal_conversion', $2, $2, 'intelligence', 'outside', 'manual', 'Executive', 1, 1, 'active', 'outside') RETURNING id",
    [tenant.rows[0].id, `Outside KPI ${marker}`],
  );
  return { kpiId: kpi.rows[0].id };
}

async function expectedValues(client, tenantId) {
  const signalConversion = await ratio(client, "SELECT count(*)::numeric FROM opportunity_candidates WHERE tenant_id = $1 AND deleted_at IS NULL", "SELECT count(*)::numeric FROM signals WHERE tenant_id = $1 AND status = 'verified' AND deleted_at IS NULL", tenantId);
  const candidateConversion = await ratio(client, "SELECT count(*)::numeric FROM opportunities WHERE tenant_id = $1 AND deleted_at IS NULL", "SELECT count(*)::numeric FROM opportunity_candidates WHERE tenant_id = $1 AND deleted_at IS NULL", tenantId);
  const qualifiedValue = await scalar(client, "SELECT coalesce(sum(estimated_value), 0)::numeric FROM opportunities WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL", tenantId);
  const capacityCoverage = await ratio(client, "SELECT coalesce(sum(quantity), 0)::numeric FROM capacity_records WHERE tenant_id = $1 AND deleted_at IS NULL", "SELECT coalesce(sum(quantity), 0)::numeric FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL", tenantId);
  const submittedSql = "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status IN ('submitted', 'correction_required', 'qc_review', 'accepted', 'approved', 'billable', 'rejected') AND deleted_at IS NULL";
  const approvalRate = await ratio(client, "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status IN ('approved', 'billable') AND deleted_at IS NULL", submittedSql, tenantId);
  const correctionRate = await ratio(client, "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status = 'correction_required' AND deleted_at IS NULL", submittedSql, tenantId);
  const settlementConversion = await ratio(client, "SELECT count(*)::numeric FROM settlements WHERE tenant_id = $1 AND status = 'approved' AND deleted_at IS NULL", "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status = 'billable' AND deleted_at IS NULL", tenantId);
  const cashConversion = await ratio(client, "SELECT count(*)::numeric FROM payments WHERE tenant_id = $1 AND status = 'reconciled' AND deleted_at IS NULL", "SELECT count(*)::numeric FROM settlements WHERE tenant_id = $1 AND status = 'approved' AND deleted_at IS NULL", tenantId);
  const resolutionTime = await scalar(client, "SELECT coalesce(avg(extract(epoch FROM (resolved_at - created_at)) / 3600), 0)::numeric FROM constraints WHERE tenant_id = $1 AND resolved_at IS NOT NULL AND deleted_at IS NULL", tenantId);
  const decisionVelocity = await scalar(client, "SELECT coalesce(avg(extract(epoch FROM (approved_at - created_at)) / 3600), 0)::numeric FROM recommendations WHERE tenant_id = $1 AND approved_at IS NOT NULL AND deleted_at IS NULL", tenantId);
  const activeOpportunities = await scalar(client, "SELECT count(*)::numeric FROM opportunities WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL", tenantId);
  const throughput = activeOpportunities === 0 ? 0 : Number((qualifiedValue * capacityCoverage * approvalRate * settlementConversion * cashConversion / activeOpportunities).toFixed(4));
  return {
    "Signal Conversion Rate": signalConversion,
    "Opportunity Candidate Conversion Rate": candidateConversion,
    "Qualified Opportunity Value": qualifiedValue,
    "Capacity Coverage Ratio": capacityCoverage,
    "Production Approval Rate": approvalRate,
    "Correction Rate": correctionRate,
    "Settlement Conversion Rate": settlementConversion,
    "Cash Conversion Rate": cashConversion,
    "Constraint Resolution Time": resolutionTime,
    "Decision Velocity": decisionVelocity,
    "Telecom Work Throughput": throughput,
  };
}

async function ratio(client, numeratorSql, denominatorSql, tenantId) {
  const numerator = await scalar(client, numeratorSql, tenantId);
  const denominator = await scalar(client, denominatorSql, tenantId);
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

async function scalar(client, sql, tenantId) {
  const result = await client.query(sql, [tenantId]);
  return Number(Object.values(result.rows[0] ?? { value: 0 })[0] ?? 0);
}

async function expectWrite(client, before, eventType, label, delta = 1) {
  const after = await counts(client);
  if (after.events !== before.events + delta) throw new Error(`${label}: expected event delta ${delta}`);
  if (after.event_payloads !== before.event_payloads + delta) throw new Error(`${label}: expected event payload delta ${delta}`);
  if (after.audit_logs !== before.audit_logs + delta) throw new Error(`${label}: expected audit delta ${delta}`);
  if (after.system_actions !== before.system_actions + delta) throw new Error(`${label}: expected system action delta ${delta}`);
  if (after[eventType] !== before[eventType] + 1) throw new Error(`${label}: expected ${eventType}`);
}

async function expectDelta(client, before, eventType, delta, label) {
  const after = await counts(client);
  if (after[eventType] !== before[eventType] + delta) throw new Error(`${label}: expected ${eventType} delta ${delta}`);
}

async function counts(client) {
  const eventTypes = ["kpi.created", "kpi.calculated", "kpi_snapshot.created", "kpi_alert.created", "kpi_alert.archived"];
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

function assertClose(actual, expected, label) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.0001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function alertThresholdFor(name) {
  if (name === "Signal Conversion Rate") return 999;
  if (["Correction Rate", "Constraint Resolution Time", "Decision Velocity"].includes(name)) return 999999;
  return -1;
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
