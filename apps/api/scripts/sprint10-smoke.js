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
  for (const role of ["Executive", "System Admin", "Billing Manager"]) await assignRole(client, tenantId, tenantUserId, role);

  const marker = `S10${Date.now()}`;
  const token = createToken({ sub: userId, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 300 }, secret);
  const base = await createBaseData(client, tenantId, userId, marker);
  const outside = await createOutsideData(client, marker);

  await expectStatus("unauthorized workflow definition blocked", "POST", "/workflow-definitions", undefined, 401, { workflow_name: "Denied" });
  await expectStatus("missing permission blocked", "POST", "/security-test/missing-permission", `Bearer ${token}`, 405, {});
  await expectStatus("cross-tenant workflow definition blocked", "GET", `/workflow-definitions/${outside.definitionId}`, `Bearer ${token}`, 404);

  const definitionBefore = await counts(client);
  const definition = await expectStatus("workflow definition create", "POST", "/workflow-definitions", `Bearer ${token}`, 201, {
    workflow_name: `Workflow ${marker}`,
    workflow_category: "recommendation",
    trigger_event_type: "recommendation.approved",
    start_status: "approved",
    end_status: "completed",
    sla_hours: 24,
    status: "active",
  });
  await expectWrite(client, definitionBefore, "workflow_definition.created", "workflow definition create");

  const stepBefore = await counts(client);
  const stepOne = await expectStatus("workflow step create", "POST", `/workflow-definitions/${definition.id}/steps`, `Bearer ${token}`, 201, {
    step_order: 1,
    step_name: `Review ${marker}`,
    owner_role: "Billing Manager",
    required_action: "review",
    sla_hours: 4,
    approval_required: true,
  });
  await expectWrite(client, stepBefore, "workflow_step.created", "workflow step create");
  const stepTwo = await expectStatus("workflow second step create", "POST", `/workflow-definitions/${definition.id}/steps`, `Bearer ${token}`, 201, {
    step_order: 2,
    step_name: `Approve ${marker}`,
    owner_role: "Executive",
    required_action: "approve",
    sla_hours: 8,
    approval_required: true,
  });
  if (!stepTwo.id) throw new Error("second workflow step not created");
  await expectStatus("duplicate step order blocked", "POST", `/workflow-definitions/${definition.id}/steps`, `Bearer ${token}`, 400, {
    step_order: 1,
    step_name: `Duplicate ${marker}`,
    owner_role: "Billing Manager",
    required_action: "review",
    sla_hours: 4,
    approval_required: false,
  });

  const instanceBefore = await counts(client);
  const instance = await expectStatus("workflow instance create", "POST", "/workflow-instances", `Bearer ${token}`, 201, {
    workflow_definition_id: definition.id,
    source_object_type: "project",
    source_object_id: base.projectId,
  });
  await expectWrite(client, instanceBefore, "workflow_instance.created", "workflow instance create");

  await expectStatus("workflow complete blocked until required tasks completed", "POST", `/workflow-instances/${instance.id}/complete`, `Bearer ${token}`, 400, {});
  const startBefore = await counts(client);
  const started = await expectStatus("workflow start", "POST", `/workflow-instances/${instance.id}/start`, `Bearer ${token}`, 201, {});
  if (started.status !== "in_progress") throw new Error("workflow instance not started");
  await expectWrite(client, startBefore, "workflow_instance.started", "workflow start", 2);
  await expectDelta(client, startBefore, "workflow_task.created", 1, "workflow start task");
  const firstTask = await taskByStep(client, tenantId, instance.id, stepOne.id);

  const completeFirstBefore = await counts(client);
  const completedFirst = await expectStatus("workflow task complete creates next task", "POST", `/workflow-tasks/${firstTask.id}/complete`, `Bearer ${token}`, 201, {
    completion_note: `Done ${marker}`,
  });
  if (completedFirst.status !== "completed") throw new Error("first task not completed");
  await expectWrite(client, completeFirstBefore, "workflow_task.completed", "first task complete", 2);
  await expectDelta(client, completeFirstBefore, "workflow_task.created", 1, "next task create");
  const secondTask = await taskByStep(client, tenantId, instance.id, stepTwo.id);

  await expectStatus("workflow complete still blocked with next task open", "POST", `/workflow-instances/${instance.id}/complete`, `Bearer ${token}`, 400, {});
  const completeSecondBefore = await counts(client);
  await expectStatus("second workflow task complete", "POST", `/workflow-tasks/${secondTask.id}/complete`, `Bearer ${token}`, 201, {});
  await expectWrite(client, completeSecondBefore, "workflow_task.completed", "second task complete");
  const completeInstanceBefore = await counts(client);
  const completedInstance = await expectStatus("workflow complete succeeds", "POST", `/workflow-instances/${instance.id}/complete`, `Bearer ${token}`, 201, {});
  if (completedInstance.status !== "completed") throw new Error("workflow instance not completed");
  await expectWrite(client, completeInstanceBefore, "workflow_instance.completed", "workflow complete");

  const reassignInstance = await createStartedInstance(token, definition.id, base.projectId);
  const reassignTask = await firstOpenTask(client, tenantId, reassignInstance.id);
  await expectStatus("task reassign requires reason", "POST", `/workflow-tasks/${reassignTask.id}/reassign`, `Bearer ${token}`, 400, {
    assigned_role: "Executive",
  });
  const reassignBefore = await counts(client);
  const reassigned = await expectStatus("task reassign", "POST", `/workflow-tasks/${reassignTask.id}/reassign`, `Bearer ${token}`, 201, {
    assigned_role: "Executive",
    reason: `Reassign ${marker}`,
  });
  if (reassigned.status !== "reassigned") throw new Error("task not reassigned");
  await expectWrite(client, reassignBefore, "workflow_task.reassigned", "task reassign");
  const escalateBefore = await counts(client);
  const escalated = await expectStatus("task escalate", "POST", `/workflow-tasks/${reassignTask.id}/escalate`, `Bearer ${token}`, 201, {
    reason: `Escalate ${marker}`,
    escalated_to_role: "Executive",
  });
  if (escalated.status !== "escalated") throw new Error("task not escalated");
  await expectWrite(client, escalateBefore, "workflow_task.escalated", "task escalate", 2);
  await expectDelta(client, escalateBefore, "workflow_escalation.created", 1, "workflow escalation create");

  await createOverdueTask(client, tenantId, definition.id, stepOne.id, base.projectId, marker);
  const overdueTasks = await expectStatus("overdue task query", "GET", "/workflow-tasks?status=open&overdue=true", `Bearer ${token}`, 200);
  if (!overdueTasks.some((task) => task.task_name === `Overdue ${marker}`)) throw new Error("overdue task query missing expected task");

  const conversionRecommendation = await createApprovedRecommendation(client, tenantId, base.constraintId, marker);
  const convertBefore = await counts(client);
  const converted = await expectStatus("recommendation convert creates workflow runtime", "POST", `/recommendations/${conversionRecommendation.id}/convert-to-workflow`, `Bearer ${token}`, 201, {
    workflow_definition_id: definition.id,
  });
  if (converted.status !== "converted_to_workflow") throw new Error("recommendation not converted");
  await expectWrite(client, convertBefore, "recommendation.converted_to_workflow", "recommendation convert", 4);
  await expectDelta(client, convertBefore, "workflow_instance.created", 1, "convert workflow instance create");
  await expectDelta(client, convertBefore, "workflow_instance.started", 1, "convert workflow instance start");
  await expectDelta(client, convertBefore, "workflow_task.created", 1, "convert workflow task create");

  const searchResults = await expectStatus("tenant-scoped workflow search", "GET", `/search?q=${encodeURIComponent(marker)}`, `Bearer ${token}`, 200);
  if (!searchResults.some((row) => row.object_type === "workflow_definition" && row.id === definition.id)) throw new Error("search missing workflow definition");
  if (!searchResults.some((row) => row.object_type === "workflow_task" && row.title === `Overdue ${marker}`)) throw new Error("search missing workflow task");
  if (searchResults.some((row) => row.id === outside.definitionId)) throw new Error("search returned cross-tenant workflow definition");

  const forbidden = await client.query(`
    SELECT
      to_regclass('public.ai_agents') AS ai_agents,
      to_regclass('public.external_notifications') AS external_notifications,
      to_regclass('public.autonomous_remediations') AS autonomous_remediations
  `);
  if (forbidden.rows[0].ai_agents) throw new Error("AI agents table was created");
  if (forbidden.rows[0].external_notifications) throw new Error("external notifications table was created");
  if (forbidden.rows[0].autonomous_remediations) throw new Error("autonomous remediation table was created");

  await client.end();
  console.log("sprint10 smoke passed");
}

async function createStartedInstance(token, definitionId, projectId) {
  const instance = await expectStatus("workflow instance create for task action", "POST", "/workflow-instances", `Bearer ${token}`, 201, {
    workflow_definition_id: definitionId,
    source_object_type: "project",
    source_object_id: projectId,
  });
  await expectStatus("workflow instance start for task action", "POST", `/workflow-instances/${instance.id}/start`, `Bearer ${token}`, 201, {});
  return instance;
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
  const project = await client.query(
    "INSERT INTO projects (tenant_id, opportunity_id, customer_organization_id, name) VALUES ($1, $2, $3, $4) RETURNING id",
    [tenantId, opportunity.rows[0].id, organization.rows[0].id, `Project ${marker}`],
  );
  const constraint = await client.query(
    "INSERT INTO constraints (tenant_id, constraint_type, affected_object_type, affected_object_id, title, severity, status) VALUES ($1, 'execution', 'project', $2, $3, 'high', 'open') RETURNING id",
    [tenantId, project.rows[0].id, `Constraint ${marker}`],
  );
  return { projectId: project.rows[0].id, constraintId: constraint.rows[0].id };
}

async function createOutsideData(client, marker) {
  const tenant = await client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", ["Sprint 10 Outside Tenant", `sprint10-outside-${Date.now()}`]);
  const definition = await client.query(
    "INSERT INTO workflow_definitions (tenant_id, name, workflow_name, workflow_category, trigger_event_type, start_status, end_status, sla_hours, status) VALUES ($1, $2, $2, 'recommendation', 'recommendation.approved', 'approved', 'completed', 24, 'active') RETURNING id",
    [tenant.rows[0].id, `Outside Workflow ${marker}`],
  );
  return { definitionId: definition.rows[0].id };
}

async function createApprovedRecommendation(client, tenantId, constraintId, marker) {
  const result = await client.query(
    `
    INSERT INTO recommendations (
      tenant_id, constraint_id, recommendation_type, title, evidence_summary,
      confidence_score, confidence, risk_level, expected_impact, status
    )
    VALUES ($1, $2, 'invoice', $3, 'evidence', 80, 80, 'medium', 'impact', 'approved')
    RETURNING id
    `,
    [tenantId, constraintId, `Convert Recommendation ${marker}`],
  );
  return result.rows[0];
}

async function createOverdueTask(client, tenantId, definitionId, stepId, projectId, marker) {
  const instance = await client.query(
    `
    INSERT INTO workflow_instances (tenant_id, workflow_definition_id, source_object_type, source_object_id, entity_type, entity_id, status, started_at, due_at)
    VALUES ($1, $2, 'project', $3, 'project', $3, 'in_progress', now() - interval '2 days', now() - interval '1 day')
    RETURNING id
    `,
    [tenantId, definitionId, projectId],
  );
  await client.query(
    `
    INSERT INTO workflow_tasks (tenant_id, workflow_instance_id, step_id, title, task_name, assigned_role, status, due_at)
    VALUES ($1, $2, $3, $4, $4, 'Billing Manager', 'open', now() - interval '1 hour')
    `,
    [tenantId, instance.rows[0].id, stepId, `Overdue ${marker}`],
  );
}

async function taskByStep(client, tenantId, instanceId, stepId) {
  const result = await client.query(
    "SELECT * FROM workflow_tasks WHERE tenant_id = $1 AND workflow_instance_id = $2 AND step_id = $3 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [tenantId, instanceId, stepId],
  );
  if (!result.rows[0]) throw new Error("workflow task not found");
  return result.rows[0];
}

async function firstOpenTask(client, tenantId, instanceId) {
  const result = await client.query(
    "SELECT * FROM workflow_tasks WHERE tenant_id = $1 AND workflow_instance_id = $2 AND status = 'open' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1",
    [tenantId, instanceId],
  );
  if (!result.rows[0]) throw new Error("open workflow task not found");
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
  const eventTypes = [
    "workflow_definition.created",
    "workflow_step.created",
    "workflow_instance.created",
    "workflow_instance.started",
    "workflow_instance.completed",
    "workflow_task.created",
    "workflow_task.completed",
    "workflow_task.reassigned",
    "workflow_task.escalated",
    "workflow_escalation.created",
    "recommendation.converted_to_workflow",
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
