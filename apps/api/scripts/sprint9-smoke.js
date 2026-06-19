const crypto = require("node:crypto");
const { Client } = require("pg");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3100";
const sprint9Permissions = [
  "constraint.read",
  "constraint.create",
  "constraint.update",
  "constraint.assign",
  "constraint.escalate",
  "constraint.resolve",
  "constraint.verify",
  "constraint.close",
  "constraint.archive",
  "constraint.detect",
  "recommendation.read",
  "recommendation.create",
  "recommendation.update",
  "recommendation.approve",
  "recommendation.reject",
  "recommendation.defer",
  "recommendation.convert_workflow",
  "recommendation.complete",
  "recommendation.measure",
  "recommendation.archive",
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
  for (const role of ["Executive", "Operations Manager", "Billing Manager", "Finance Manager", "QC Manager", "System Admin"]) {
    await assignRole(client, tenantId, tenantUserId, role);
  }

  const marker = `S9${Date.now()}`;
  const nonAuthority = await createNonAuthorityUser(client, tenantId, marker);
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const nonAuthorityToken = createToken({ sub: nonAuthority.userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const base = await createBaseData(client, tenantId, userId, marker);
  const outside = await createOutsideData(client, marker);

  await expectStatus("unauthorized constraint create blocked", "POST", "/constraints", undefined, 401, { title: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});
  await expectStatus("cross-tenant constraint blocked", "GET", `/constraints/${outside.constraintId}`, `Bearer ${token}`, 404);

  const constraintBefore = await counts(client);
  const constraint = await expectStatus("constraint create", "POST", "/constraints", `Bearer ${token}`, 201, {
    constraint_type: "execution",
    affected_object_type: "project",
    affected_object_id: base.projectId,
    title: `Execution Constraint ${marker}`,
    severity: "high",
  });
  await expectWrite(client, constraintBefore, "constraint.created", "constraint create");

  await expectStatus("constraint assign requires owner", "POST", `/constraints/${constraint.id}/assign`, `Bearer ${token}`, 400, {
    due_date: todayOffset(7),
  });
  const assignBefore = await counts(client);
  const assigned = await expectStatus("constraint assign", "POST", `/constraints/${constraint.id}/assign`, `Bearer ${token}`, 201, {
    owner_id: userId,
    due_date: todayOffset(7),
  });
  if (assigned.status !== "assigned") throw new Error("constraint not assigned");
  await expectWrite(client, assignBefore, "constraint.assigned", "constraint assign");

  await expectStatus("constraint resolve requires summary", "POST", `/constraints/${constraint.id}/resolve`, `Bearer ${token}`, 400, {});
  const resolveBefore = await counts(client);
  const resolved = await expectStatus("constraint resolve", "POST", `/constraints/${constraint.id}/resolve`, `Bearer ${token}`, 201, {
    resolution_summary: `Resolved ${marker}`,
  });
  if (resolved.status !== "resolved") throw new Error("constraint not resolved");
  await expectWrite(client, resolveBefore, "constraint.resolved", "constraint resolve");

  await expectStatus("constraint verify requires authority", "POST", `/constraints/${constraint.id}/verify`, `Bearer ${nonAuthorityToken}`, 403, {
    verification_summary: "No authority",
  });
  await expectStatus("constraint close requires verified", "POST", `/constraints/${constraint.id}/close`, `Bearer ${token}`, 400, {});
  const verifyBefore = await counts(client);
  const verified = await expectStatus("constraint verify", "POST", `/constraints/${constraint.id}/verify`, `Bearer ${token}`, 201, {
    verification_summary: `Verified ${marker}`,
  });
  if (verified.status !== "verified") throw new Error("constraint not verified");
  await expectWrite(client, verifyBefore, "constraint.verified", "constraint verify");
  const closeBefore = await counts(client);
  const closed = await expectStatus("constraint close", "POST", `/constraints/${constraint.id}/close`, `Bearer ${token}`, 201, {});
  if (closed.status !== "closed") throw new Error("constraint not closed");
  await expectWrite(client, closeBefore, "constraint.closed", "constraint close");

  const recommendationBefore = await counts(client);
  const recommendation = await createRecommendation(token, constraint.id, "invoice", `Invoice Recommendation ${marker}`);
  await expectWrite(client, recommendationBefore, "recommendation.created", "recommendation create");

  await expectStatus("recommendation approve authority enforced", "POST", `/recommendations/${recommendation.id}/approve`, `Bearer ${nonAuthorityToken}`, 403, {});
  const approveBefore = await counts(client);
  const approved = await expectStatus("recommendation approve", "POST", `/recommendations/${recommendation.id}/approve`, `Bearer ${token}`, 201, {});
  if (approved.status !== "approved") throw new Error("recommendation not approved");
  await expectWrite(client, approveBefore, "recommendation.approved", "recommendation approve");

  const rejectTarget = await createRecommendation(token, constraint.id, "monitor", `Reject Target ${marker}`);
  await expectStatus("recommendation reject requires reason", "POST", `/recommendations/${rejectTarget.id}/reject`, `Bearer ${token}`, 400, {});
  const rejectBefore = await counts(client);
  const rejected = await expectStatus("recommendation reject", "POST", `/recommendations/${rejectTarget.id}/reject`, `Bearer ${token}`, 201, {
    rejection_reason: `Rejected ${marker}`,
  });
  if (rejected.status !== "rejected") throw new Error("recommendation not rejected");
  await expectWrite(client, rejectBefore, "recommendation.rejected", "recommendation reject");

  const deferTarget = await createRecommendation(token, constraint.id, "investigate_data", `Defer Target ${marker}`);
  await expectStatus("recommendation defer requires reason and review date", "POST", `/recommendations/${deferTarget.id}/defer`, `Bearer ${token}`, 400, {
    defer_reason: `Deferred ${marker}`,
  });
  const deferBefore = await counts(client);
  const deferred = await expectStatus("recommendation defer", "POST", `/recommendations/${deferTarget.id}/defer`, `Bearer ${token}`, 201, {
    defer_reason: `Deferred ${marker}`,
    review_date: todayOffset(14),
  });
  if (deferred.status !== "deferred") throw new Error("recommendation not deferred");
  await expectWrite(client, deferBefore, "recommendation.deferred", "recommendation defer");

  const measureBlocked = await createRecommendation(token, constraint.id, "resolve_constraint", `Measure Blocked ${marker}`);
  await expectStatus("recommendation measure requires completed", "POST", `/recommendations/${measureBlocked.id}/measure`, `Bearer ${token}`, 400, {});
  const completeTarget = await createRecommendation(token, constraint.id, "resolve_constraint", `Complete Target ${marker}`);
  const workflowBefore = await countTable(client, "workflow_instances");
  const convertBefore = await counts(client);
  const converted = await expectStatus("convert-to-workflow only changes status", "POST", `/recommendations/${completeTarget.id}/convert-to-workflow`, `Bearer ${token}`, 201, {});
  if (converted.status !== "converted_to_workflow") throw new Error("recommendation not converted");
  await expectWrite(client, convertBefore, "recommendation.converted_to_workflow", "convert to workflow");
  const workflowAfter = await countTable(client, "workflow_instances");
  if (workflowAfter !== workflowBefore) throw new Error("workflow instance was created by Sprint 9 conversion");

  const completeBefore = await counts(client);
  const completed = await expectStatus("recommendation complete", "POST", `/recommendations/${completeTarget.id}/complete`, `Bearer ${token}`, 201, {});
  if (completed.status !== "completed") throw new Error("recommendation not completed");
  await expectWrite(client, completeBefore, "recommendation.completed", "recommendation complete");
  const measureBefore = await counts(client);
  const measured = await expectStatus("recommendation measure", "POST", `/recommendations/${completeTarget.id}/measure`, `Bearer ${token}`, 201, {});
  if (measured.status !== "measured") throw new Error("recommendation not measured");
  await expectWrite(client, measureBefore, "recommendation.measured", "recommendation measure");

  const outcomeBefore = await counts(client);
  const outcome = await expectStatus("recommendation outcome create", "POST", `/recommendations/${completeTarget.id}/outcomes`, `Bearer ${token}`, 201, {
    expected_impact: "Resolve blocker",
    actual_impact: "Resolved blocker",
    success: true,
    measured_at: new Date().toISOString(),
    notes: `Outcome ${marker}`,
  });
  await expectWrite(client, outcomeBefore, "recommendation_outcome.created", "recommendation outcome create");
  const outcomeUpdateBefore = await counts(client);
  await expectStatus("recommendation outcome update", "PATCH", `/recommendation-outcomes/${outcome.id}`, `Bearer ${token}`, 200, {
    notes: `Updated Outcome ${marker}`,
  });
  await expectWrite(client, outcomeUpdateBefore, "recommendation_outcome.updated", "recommendation outcome update");

  const recommendationsBeforeDetection = await countTable(client, "recommendations");
  const detectionBefore = await counts(client);
  const detection = await expectStatus("constraint detection", "POST", "/constraints/detect", `Bearer ${token}`, 201, {
    detection_types: ["capacity", "compliance", "qc", "cash"],
  });
  if (detection.detected_constraints.length < 4) throw new Error("expected all Sprint 9 detection types");
  const detectedTypes = new Set(detection.detected_constraints.map((row) => row.constraint_type));
  for (const type of ["capacity", "compliance", "qc", "cash"]) {
    if (!detectedTypes.has(type)) throw new Error(`missing ${type} detected constraint`);
  }
  await expectWrite(client, detectionBefore, "constraint.created", "constraint detection", detection.detected_constraints.length);
  const recommendationsAfterDetection = await countTable(client, "recommendations");
  if (recommendationsAfterDetection !== recommendationsBeforeDetection) throw new Error("constraint detection created recommendations");

  const duplicateDetection = await expectStatus("duplicate constraint detection", "POST", "/constraints/detect", `Bearer ${token}`, 201, {
    detection_types: ["capacity", "compliance", "qc", "cash"],
  });
  if (duplicateDetection.skipped_duplicates.length < detection.detected_constraints.length) throw new Error("duplicate detection did not skip existing open constraints");

  const searchResults = await expectStatus("tenant-scoped constraint search", "GET", `/search?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
  if (!searchResults.some((row) => row.object_type === "constraint" && row.id === constraint.id)) throw new Error("search missing constraint");
  if (!searchResults.some((row) => row.object_type === "recommendation" && row.id === recommendation.id)) throw new Error("search missing recommendation");
  if (searchResults.some((row) => row.id === outside.constraintId)) throw new Error("search returned cross-tenant constraint");

  await client.end();
  console.log("sprint9 smoke passed");
}

async function createRecommendation(token, constraintId, recommendationType, title) {
  return expectStatus("recommendation create", "POST", "/recommendations", `Bearer ${token}`, 201, {
    constraint_id: constraintId,
    recommendation_type: recommendationType,
    title,
    evidence_summary: `${title} evidence`,
    confidence_score: 75,
    risk_level: "medium",
    expected_impact: "Reduce operational constraint",
  });
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
    VALUES ($1, $2, $3, $4, $5, 'fiber_build', 'evidence', 'qualified', 'qualified')
    RETURNING id
    `,
    [tenantId, organization.rows[0].id, territory.rows[0].id, userId, `Opportunity ${marker}`],
  );
  const requirement = await client.query(
    `
    INSERT INTO opportunity_capacity_requirements (tenant_id, opportunity_id, capacity_type, quantity, unit, territory_id)
    VALUES ($1, $2, 'Bore Crew', 10, 'crews', $3)
    RETURNING id
    `,
    [tenantId, opportunity.rows[0].id, territory.rows[0].id],
  );
  const provider = await client.query(
    "INSERT INTO capacity_providers (tenant_id, organization_id, name, provider_type, status, verification_status, contract_status) VALUES ($1, $2, $3, 'subcontractor', 'activated', 'verified', 'contracted') RETURNING id",
    [tenantId, organization.rows[0].id, `Provider ${marker}`],
  );
  await client.query("INSERT INTO compliance_documents (tenant_id, capacity_provider_id, document_type, status, expires_at) VALUES ($1, $2, 'insurance', 'expired', $3)", [
    tenantId,
    provider.rows[0].id,
    todayOffset(-1),
  ]);
  const project = await client.query(
    "INSERT INTO projects (tenant_id, opportunity_id, customer_organization_id, name) VALUES ($1, $2, $3, $4) RETURNING id",
    [tenantId, opportunity.rows[0].id, organization.rows[0].id, `Project ${marker}`],
  );
  const workOrder = await client.query(
    `
    INSERT INTO work_orders (tenant_id, project_id, assigned_capacity_provider_id, title, work_type, location_description, expected_units, unit_type, status)
    VALUES ($1, $2, $3, $4, 'fiber_build', $5, 100, 'feet', 'in_progress')
    RETURNING id
    `,
    [tenantId, project.rows[0].id, provider.rows[0].id, `Work Order ${marker}`, `Location ${marker}`],
  );
  const productionRecord = await client.query(
    `
    INSERT INTO production_records (
      tenant_id, project_id, work_order_id, capacity_provider_id, submitted_by_user_id,
      production_date, quantity_submitted, quantity, unit_type, unit, status, correction_required_at, correction_required_by, correction_reason
    )
    VALUES ($1, $2, $3, $4, $5, current_date - interval '10 days', 25, 25, 'feet', 'feet', 'correction_required', now() - interval '8 days', $5, $6)
    RETURNING id
    `,
    [tenantId, project.rows[0].id, workOrder.rows[0].id, provider.rows[0].id, userId, `Correction ${marker}`],
  );
  const invoice = await client.query(
    "INSERT INTO invoices (tenant_id, organization_id, invoice_number, invoice_date, due_date, invoice_amount, total_amount, status) VALUES ($1, $2, $3, current_date - interval '60 days', current_date - interval '30 days', 100, 100, 'overdue') RETURNING id",
    [tenantId, organization.rows[0].id, `INV-${marker}`],
  );
  return {
    organizationId: organization.rows[0].id,
    territoryId: territory.rows[0].id,
    opportunityId: opportunity.rows[0].id,
    requirementId: requirement.rows[0].id,
    providerId: provider.rows[0].id,
    projectId: project.rows[0].id,
    productionRecordId: productionRecord.rows[0].id,
    invoiceId: invoice.rows[0].id,
  };
}

async function createOutsideData(client, marker) {
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 9 Outside Tenant", `sprint9-outside-${Date.now()}`]);
  const constraint = await client.query(
    "INSERT INTO constraints (tenant_id, constraint_type, affected_object_type, title, severity) VALUES ($1, 'execution', 'project', $2, 'high') RETURNING id",
    [tenant.rows[0].id, `Outside Constraint ${marker}`],
  );
  return { constraintId: constraint.rows[0].id };
}

async function createNonAuthorityUser(client, tenantId, marker) {
  const user = await client.query(
    "INSERT INTO users (email, display_name, status) VALUES ($1, $2, 'active') RETURNING id",
    [`sprint9-${marker.toLowerCase()}@syncos.local`, `Sprint 9 User ${marker}`],
  );
  const tenantUser = await client.query("INSERT INTO tenant_users (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id", [tenantId, user.rows[0].id]);
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
    [tenantId, sprint9Permissions],
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

async function expectWrite(client, before, eventType, label, delta = 1) {
  const after = await counts(client);
  if (after.events !== before.events + delta) throw new Error(`${label}: expected event delta ${delta}`);
  if (after.event_payloads !== before.event_payloads + delta) throw new Error(`${label}: expected event payload delta ${delta}`);
  if (after.audit_logs !== before.audit_logs + delta) throw new Error(`${label}: expected audit delta ${delta}`);
  if (after.system_actions !== before.system_actions + delta) throw new Error(`${label}: expected system action delta ${delta}`);
  if (after[eventType] !== before[eventType] + delta) throw new Error(`${label}: expected ${eventType} delta ${delta}`);
}

async function counts(client) {
  const eventTypes = [
    "constraint.created",
    "constraint.assigned",
    "constraint.resolved",
    "constraint.verified",
    "constraint.closed",
    "recommendation.created",
    "recommendation.approved",
    "recommendation.rejected",
    "recommendation.deferred",
    "recommendation.converted_to_workflow",
    "recommendation.completed",
    "recommendation.measured",
    "recommendation_outcome.created",
    "recommendation_outcome.updated",
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

async function countTable(client, table) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("unsafe table");
  const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
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
