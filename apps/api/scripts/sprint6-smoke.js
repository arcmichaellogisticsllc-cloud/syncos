const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";
const sprint6Permissions = [
  "production_record.read",
  "production_record.create",
  "production_record.update",
  "production_record.submit",
  "production_record.correction_required",
  "production_record.archive",
  "production_evidence.read",
  "production_evidence.create",
  "production_evidence.update",
  "production_evidence.archive",
  "qc.review",
  "qc.accept",
  "qc.reject",
  "qc.approve",
  "production.mark_billable",
  "production.clear_correction",
  "stop_work.issue",
  "stop_work.release",
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
  const marker = `S6${Date.now()}`;
  for (const role of ["QC Manager", "Project Manager", "Operations Manager", "Billing Manager", "Safety Manager", "Executive"]) {
    await assignRole(client, tenantId, tenantUserId, role);
  }
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const nonAuthority = await createNonAuthorityUser(client, tenantId);
  const nonAuthorityToken = createToken({ sub: nonAuthority.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

  await expectStatus("unauthorized QC queue blocked", "GET", "/qc/review-queue", undefined, 401);
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});

  const base = await createBaseData(client, tenantId, userId, marker);
  const outside = await createOutsideData(client);
  await expectStatus("cross-tenant production blocked", "GET", `/production-records/${outside.productionRecordId}`, `Bearer ${token}`, 404);

  const draft = await createProductionRecord(client, tenantId, base, "draft", marker, 10);
  await addEvidence(client, tenantId, draft.id, "direct setup evidence");
  await expectStatus("QC review requires submitted status", "POST", `/production-records/${draft.id}/qc-review`, `Bearer ${token}`, 400, {});

  const submittedForAcceptBlock = await createSubmittedProduction(client, tenantId, base, marker, 10);
  await expectStatus("accept requires QC review", "POST", `/production-records/${submittedForAcceptBlock.id}/accept`, `Bearer ${token}`, 400, {
    accepted_quantity: 5,
  });

  const submitted = await createSubmittedProduction(client, tenantId, base, marker, 10);
  const qcBefore = await counts(client);
  const qcReview = await expectStatus("QC review starts", "POST", `/production-records/${submitted.id}/qc-review`, `Bearer ${token}`, 201, {});
  if (qcReview.status !== "qc_review") throw new Error("QC review status not set");
  await expectWrite(client, qcBefore, "production_record.qc_review_started", "QC review");

  await expectStatus("accepted quantity required", "POST", `/production-records/${submitted.id}/accept`, `Bearer ${token}`, 400, {});
  await expectStatus("accepted quantity cannot exceed submitted", "POST", `/production-records/${submitted.id}/accept`, `Bearer ${token}`, 400, {
    accepted_quantity: 11,
  });
  const acceptBefore = await counts(client);
  const accepted = await expectStatus("accept succeeds", "POST", `/production-records/${submitted.id}/accept`, `Bearer ${token}`, 201, {
    accepted_quantity: 8,
  });
  if (accepted.status !== "accepted" || Number(accepted.accepted_quantity) !== 8) throw new Error("accepted fields not set");
  await expectWrite(client, acceptBefore, "production_record.accepted", "accept");

  await expectStatus("approved quantity required", "POST", `/production-records/${submitted.id}/approve`, `Bearer ${token}`, 400, {});
  await expectStatus("approved quantity cannot exceed accepted", "POST", `/production-records/${submitted.id}/approve`, `Bearer ${token}`, 400, {
    approved_quantity: 9,
  });
  const approveBefore = await counts(client);
  const approved = await expectStatus("approve succeeds", "POST", `/production-records/${submitted.id}/approve`, `Bearer ${token}`, 201, {
    approved_quantity: 7,
  });
  if (approved.status !== "approved" || Number(approved.approved_quantity) !== 7) throw new Error("approved fields not set");
  await expectWrite(client, approveBefore, "production.approved", "approve");

  await expectStatus("billable quantity cannot exceed approved", "POST", `/production-records/${submitted.id}/mark-billable`, `Bearer ${token}`, 400, {
    billable_quantity: 9,
  });

  const stopped = await createAcceptedProduction(client, tenantId, base, marker, 10, 8);
  const stopBefore = await counts(client);
  const stopWork = await expectStatus("stop work issued", "POST", `/production-records/${stopped.id}/stop-work`, `Bearer ${token}`, 201, {
    reason: `Safety hold ${marker}`,
  });
  if (stopWork.stop_work_status !== "active") throw new Error("stop work not active");
  await expectWrite(client, stopBefore, "production_record.stop_work_issued", "stop work issue");
  await expectStatus("billable blocked when stop work active", "POST", `/production-records/${stopped.id}/approve`, `Bearer ${token}`, 400, {
    approved_quantity: 5,
  });
  await expectStatus("stop work authority enforced", "POST", `/production-records/${stopped.id}/stop-work`, `Bearer ${nonAuthorityToken}`, 403, {
    reason: "no authority",
  });
  await expectStatus("release stop work authority enforced", "POST", `/production-records/${stopped.id}/release-stop-work`, `Bearer ${nonAuthorityToken}`, 403, {
    release_reason: "no authority",
  });
  const releaseBefore = await counts(client);
  const released = await expectStatus("stop work released", "POST", `/production-records/${stopped.id}/release-stop-work`, `Bearer ${token}`, 201, {
    release_reason: `Released ${marker}`,
  });
  if (released.stop_work_status !== "released") throw new Error("stop work not released");
  await expectWrite(client, releaseBefore, "production_record.stop_work_released", "stop work release");

  const billableBefore = await counts(client);
  const billable = await expectStatus("mark billable succeeds", "POST", `/production-records/${submitted.id}/mark-billable`, `Bearer ${token}`, 201, {
    rate_code_id: base.rateCodeId,
  });
  if (billable.status !== "billable" || billable.billable_status !== "billable") throw new Error("billable status not set");
  await expectWrite(client, billableBefore, "production.marked_billable", "billable");

  const rejectTarget = await createSubmittedProduction(client, tenantId, base, marker, 12);
  await expectStatus("rejection reason required", "POST", `/production-records/${rejectTarget.id}/reject`, `Bearer ${token}`, 400, {});
  await expectStatus("rejected quantity cannot exceed submitted", "POST", `/production-records/${rejectTarget.id}/reject`, `Bearer ${token}`, 400, {
    reason: "bad production",
    rejected_quantity: 13,
  });
  const rejectBefore = await counts(client);
  const rejected = await expectStatus("reject succeeds", "POST", `/production-records/${rejectTarget.id}/reject`, `Bearer ${token}`, 201, {
    reason: `Rejected ${marker}`,
    rejected_quantity: 4,
  });
  if (rejected.status !== "rejected" || rejected.rejection_reason !== `Rejected ${marker}`) throw new Error("rejection fields not set");
  await expectWrite(client, rejectBefore, "production_record.rejected", "reject");

  const correctionTarget = await createSubmittedProduction(client, tenantId, base, marker, 9);
  const correctionBefore = await counts(client);
  const correction = await expectStatus("correction required succeeds", "POST", `/production-records/${correctionTarget.id}/correction-required`, `Bearer ${token}`, 201, {
    reason: `Correction ${marker}`,
  });
  if (correction.status !== "correction_required" || !correction.correction_required_at) throw new Error("correction fields not set");
  await expectWrite(client, correctionBefore, "production.correction_requested", "correction required");
  await expectStatus("clear correction blocked without new evidence", "POST", `/production-records/${correctionTarget.id}/clear-correction`, `Bearer ${token}`, 400, {});
  await expectStatus("create updated correction evidence", "POST", `/production-records/${correctionTarget.id}/evidence`, `Bearer ${token}`, 201, {
    evidence_type: "photo",
    description: `Updated Correction Evidence ${marker}`,
  });
  const clearBefore = await counts(client);
  const cleared = await expectStatus("clear correction succeeds", "POST", `/production-records/${correctionTarget.id}/clear-correction`, `Bearer ${token}`, 201, {
    reason: `Cleared ${marker}`,
  });
  if (cleared.status !== "qc_review") throw new Error("correction not cleared to qc_review");
  await expectWrite(client, clearBefore, "production_record.correction_cleared", "clear correction");

  const queue = await expectStatus("QC queue lists tenant records", "GET", "/qc/review-queue", `Bearer ${token}`, 200);
  if (!queue.some((row) => row.id === cleared.id)) throw new Error("QC queue missing cleared record");

  const results = await expectStatus("tenant-scoped production search", "GET", `/search?q=${encodeURIComponent("billable")}`, `Bearer ${token}`, 200);
  if (!results.some((row) => row.object_type === "production_record" && row.id === submitted.id)) throw new Error("search missing billable production");
  if (results.some((row) => row.id === outside.productionRecordId)) throw new Error("search returned cross-tenant production");

  const forbiddenCounts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM settlements) AS settlements,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM kpi_snapshots) AS kpi_snapshots
  `);
  if (forbiddenCounts.rows[0].settlements !== 0) throw new Error("Sprint 6 created settlements");
  if (forbiddenCounts.rows[0].invoices !== 0) throw new Error("Sprint 6 created invoices");
  if (forbiddenCounts.rows[0].payments !== 0) throw new Error("Sprint 6 created payments");
  if (forbiddenCounts.rows[0].kpi_snapshots !== 0) throw new Error("Sprint 6 wrote KPI snapshots");

  await client.end();
  console.log("sprint6 smoke passed");
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
  const crew = await client.query("INSERT INTO crews (tenant_id, capacity_provider_id, name, crew_type) VALUES ($1, $2, $3, 'bore') RETURNING id", [
    tenantId,
    provider.rows[0].id,
    `Crew ${marker}`,
  ]);
  const workOrder = await client.query(
    `
    INSERT INTO work_orders (tenant_id, project_id, assigned_capacity_provider_id, assigned_crew_id, title, work_type, location_description, expected_units, unit_type, status)
    VALUES ($1, $2, $3, $4, $5, 'fiber_build', $6, 100, 'feet', 'in_progress')
    RETURNING id
    `,
    [tenantId, project.rows[0].id, provider.rows[0].id, crew.rows[0].id, `Work Order ${marker}`, `Location ${marker}`],
  );
  const rateSchedule = await client.query("INSERT INTO rate_schedules (tenant_id, name, status) VALUES ($1, $2, 'active') RETURNING id", [tenantId, `Rates ${marker}`]);
  const rateCode = await client.query("INSERT INTO rate_codes (tenant_id, rate_schedule_id, code, unit, amount) VALUES ($1, $2, $3, 'feet', 10) RETURNING id", [
    tenantId,
    rateSchedule.rows[0].id,
    `FEET-${marker}`,
  ]);
  const mismatchedRateCode = await client.query("INSERT INTO rate_codes (tenant_id, rate_schedule_id, code, unit, amount) VALUES ($1, $2, $3, 'each', 10) RETURNING id", [
    tenantId,
    rateSchedule.rows[0].id,
    `EACH-${marker}`,
  ]);
  return {
    projectId: project.rows[0].id,
    workOrderId: workOrder.rows[0].id,
    providerId: provider.rows[0].id,
    crewId: crew.rows[0].id,
    rateCodeId: rateCode.rows[0].id,
    mismatchedRateCodeId: mismatchedRateCode.rows[0].id,
  };
}

async function createProductionRecord(client, tenantId, base, status, marker, quantitySubmitted) {
  const result = await client.query(
    `
    INSERT INTO production_records (
      tenant_id, project_id, work_order_id, capacity_provider_id, crew_id,
      production_date, quantity_submitted, quantity, unit_type, unit, status
    )
    VALUES ($1, $2, $3, $4, $5, '2026-08-01', $6, $6, 'feet', 'feet', $7)
    RETURNING *
    `,
    [tenantId, base.projectId, base.workOrderId, base.providerId, base.crewId, quantitySubmitted, status],
  );
  return result.rows[0];
}

async function createSubmittedProduction(client, tenantId, base, marker, quantitySubmitted) {
  const record = await createProductionRecord(client, tenantId, base, "submitted", marker, quantitySubmitted);
  await addEvidence(client, tenantId, record.id, `Evidence ${marker}`);
  return record;
}

async function createAcceptedProduction(client, tenantId, base, marker, quantitySubmitted, acceptedQuantity) {
  const record = await createSubmittedProduction(client, tenantId, base, marker, quantitySubmitted);
  const updated = await client.query("UPDATE production_records SET status = 'accepted', accepted_quantity = $1 WHERE id = $2 RETURNING *", [acceptedQuantity, record.id]);
  return updated.rows[0];
}

async function addEvidence(client, tenantId, productionRecordId, description) {
  const result = await client.query(
    `
    INSERT INTO production_evidence (tenant_id, production_record_id, evidence_type, summary, description)
    VALUES ($1, $2, 'photo', $3, $3)
    RETURNING id
    `,
    [tenantId, productionRecordId, description],
  );
  return result.rows[0];
}

async function createOutsideData(client) {
  const suffix = Date.now();
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 6 Outside Tenant", `sprint6-outside-${suffix}`]);
  const tenantId = tenant.rows[0].id;
  const project = await client.query("INSERT INTO projects (tenant_id, name) VALUES ($1, 'Outside Project') RETURNING id", [tenantId]);
  const workOrder = await client.query(
    "INSERT INTO work_orders (tenant_id, project_id, title, work_type, location_description, expected_units, unit_type) VALUES ($1, $2, 'Outside Work', 'fiber_build', 'Outside', 1, 'feet') RETURNING id",
    [tenantId, project.rows[0].id],
  );
  const provider = await client.query(
    "INSERT INTO capacity_providers (tenant_id, name, provider_type, status) VALUES ($1, 'Outside Provider', 'subcontractor', 'activated') RETURNING id",
    [tenantId],
  );
  const record = await client.query(
    "INSERT INTO production_records (tenant_id, project_id, work_order_id, capacity_provider_id, production_date, quantity_submitted, quantity, unit_type, unit) VALUES ($1, $2, $3, $4, '2026-08-01', 1, 1, 'feet', 'feet') RETURNING id",
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id],
  );
  return { productionRecordId: record.rows[0].id };
}

async function createNonAuthorityUser(client, tenantId) {
  const suffix = Date.now();
  const user = await client.query("INSERT INTO users (email, display_name) VALUES ($1, 'Sprint 6 Non Authority') RETURNING id", [`sprint6-nonauthority-${suffix}@example.test`]);
  const tenantUser = await client.query("INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2) RETURNING id", [tenantId, user.rows[0].id]);
  await assignRole(client, tenantId, tenantUser.rows[0].id, "Foreman");
  await client.query(
    `
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT $1, r.id, p.id
    FROM roles r
    JOIN permissions p ON p.key = ANY($2::text[])
    WHERE r.tenant_id = $1 AND r.name = 'Foreman'
    ON CONFLICT (role_id, permission_id) DO NOTHING
    `,
    [tenantId, sprint6Permissions],
  );
  return { userId: user.rows[0].id };
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
    "production_record.qc_review_started",
    "production_record.accepted",
    "production_record.rejected",
    "production.approved",
    "production.marked_billable",
    "production_record.correction_cleared",
    "production_record.stop_work_issued",
    "production_record.stop_work_released",
    "production.correction_requested",
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
