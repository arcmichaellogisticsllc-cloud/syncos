import crypto from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { replayMobilizationSourceInvalidation, runMobilizationExpirationScan } from "@syncos/shared";

let globalClient: Client;

type Seeded = {
  tenantA: string;
  tenantB: string;
  orgA: string;
  orgB: string;
  providerA: string;
  crewA: string;
  crewAssignmentId: string;
  workerIds: string[];
  agreementVersionId: string;
  workOrderVersionId: string;
  vehicleAssignmentId: string;
  operatorAuthorizationId: string;
  adminToken: string;
  foremanToken: string;
  internalToken: string;
  unauthorizedToken: string;
  tenantBToken: string;
};

test.describe.serial("P6 Partner mobilization readiness and Notice to Proceed", () => {
  let client: Client;
  let seeded: Seeded;
  let noticeId: string;

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    const secret = process.env.AUTH_JWT_SECRET;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!secret) throw new Error("AUTH_JWT_SECRET is required");
    client = new Client({ connectionString });
    await client.connect();
    globalClient = client;
    seeded = await seedMobilizationFixture(client, secret);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test("evaluates canonical assignment context and blocks on missing source readiness", async ({ request }) => {
    const unauthenticated = await request.post(apiUrl(`/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/evaluate`));
    expect(unauthenticated.status()).toBe(401);

    await expectStatus(request, seeded.adminToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/evaluate`, 403, {});
    await expectStatus(request, seeded.internalToken, "POST", `/partner-mobilization/organizations/${seeded.orgB}/work-order-versions/${seeded.workOrderVersionId}/evaluate`, 404, {});

    await client.query("UPDATE partner_insurance_policies SET status = 'expired' WHERE tenant_id = $1 AND organization_id = $2 AND policy_type = 'commercial_auto'", [seeded.tenantA, seeded.orgA]);
    const blocked = await apiJson(request, seeded.internalToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/evaluate`, {
      requirements: [{ requirement_code: "housing_confirmation", required: true, external_message: "Housing confirmation is pending" }],
    });
    expect(blocked.overall_status).toBe("blocked");
    expect(blocked.blockers.map((b: { requirement_code: string }) => b.requirement_code)).toContain("partner_compliance_ready");
    expect(blocked.blockers.map((b: { requirement_code: string }) => b.requirement_code)).toContain("housing_confirmation");
    expect(JSON.stringify(blocked).toLowerCase()).not.toContain("internal_review_notes");
  });

  test("enforces override governance and clears only overrideable administrative blockers", async ({ request }) => {
    await expectStatus(request, seeded.adminToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/overrides`, 403, {
      requirement_code: "housing_confirmation",
      reason: "Partner attempted self-override",
      expires_at: "2026-08-20T12:00:00Z",
    });
    await expectStatus(request, seeded.internalToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/overrides`, 400, {
      requirement_code: "partner_compliance_ready",
      reason: "Cannot override insurance",
      expires_at: "2026-08-20T12:00:00Z",
    });
    await apiJson(request, seeded.internalToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/overrides`, {
      requirement_code: "housing_confirmation",
      reason: "Administrative hotel confirmation pending; field start not affected",
      external_condition: "Housing confirmation must be completed before travel",
      expires_at: "2026-08-20T12:00:00Z",
      internal_notes: "internal deliberation must not leak",
    });

    await client.query("UPDATE partner_insurance_policies SET status = 'verified', expiration_date = '2027-08-16' WHERE tenant_id = $1 AND organization_id = $2 AND policy_type = 'commercial_auto'", [seeded.tenantA, seeded.orgA]);
    const conditional = await apiJson(request, seeded.internalToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/evaluate`);
    expect(conditional.overall_status).toBe("conditional");
    expect(conditional.warnings.map((w: { requirement_code: string }) => w.requirement_code)).toContain("housing_confirmation");
    expect(JSON.stringify(conditional).toLowerCase()).not.toContain("internal deliberation");
  });

  test("approves mobilization, issues structured Notice, and keeps production start separate from QC and settlement", async ({ request }) => {
    await expectStatus(request, seeded.adminToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/approve`, 403, {});
    const approved = await apiJson(request, seeded.internalToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/conditional-approve`, {
      external_conditions: ["Housing confirmation must be completed before travel"],
      expires_at: "2026-08-20T12:00:00Z",
      internal_notes: "internal mobilization note",
    });
    expect(approved.decision).toBe("conditionally_approved");

    const countsBefore = await forbiddenWorkflowCounts(client);
    const notice = await apiJson(request, seeded.internalToken, "POST", `/partner-mobilization/organizations/${seeded.orgA}/work-order-versions/${seeded.workOrderVersionId}/notices`, {
      planned_mobilization_date: "2026-08-24",
      production_start_date: "2026-08-25",
      production_start_time: "07:30:00",
      timezone: "America/New_York",
      initial_work_area: "Synthetic Toledo map section A",
      external_instructions: "Begin only on the issued map package and initial work area.",
      external_conditions: ["Call Sync dispatch before first bucket setup"],
      internal_notes: "do not leak",
    });
    noticeId = notice.id;
    expect(notice.production_start.authorization_status).toBe("authorized");
    expect(notice.initial_map_work_package_ref).toBe("MAP-P6-A");
    expect(JSON.stringify(notice).toLowerCase()).not.toContain("do not leak");
    expect(await forbiddenWorkflowCounts(client)).toEqual(countsBefore);
  });

  test("Partner Admin and Foreman see only safe own Notice/readiness and acknowledgment is receipt-only", async ({ request }) => {
    const adminReadiness = await apiJson(request, seeded.adminToken, "GET", `/partner-mobilization/me/work-order-versions/${seeded.workOrderVersionId}/readiness`);
    expect(["conditional", "ready"]).toContain(adminReadiness.overall_status);
    expect(JSON.stringify(adminReadiness).toLowerCase()).not.toContain("w9");
    expect(JSON.stringify(adminReadiness).toLowerCase()).not.toContain("payment_profile");
    expect(JSON.stringify(adminReadiness).toLowerCase()).not.toContain("margin");

    const adminNotice = await apiJson(request, seeded.adminToken, "GET", `/partner-mobilization/me/notices/${noticeId}`);
    expect(adminNotice.production_start.authorization_status).toBe("authorized");
    await expectStatus(request, seeded.tenantBToken, "GET", `/partner-mobilization/me/notices/${noticeId}`, 404);

    const foremanReadiness = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/readiness");
    expect(JSON.stringify(foremanReadiness).toLowerCase()).not.toContain("payment");
    expect(JSON.stringify(foremanReadiness).toLowerCase()).not.toContain("rate");
    const foremanNotice = await apiJson(request, seeded.foremanToken, "GET", "/partner-mobilization/foreman/notice");
    expect(foremanNotice.initial_map_work_package_ref).toBe("MAP-P6-A");
    expect(foremanNotice.production_start.authorization_status).toBe("authorized");

    const ack = await apiJson(request, seeded.adminToken, "POST", `/partner-mobilization/me/notices/${noticeId}/acknowledge`);
    expect(ack.acknowledgment_type).toBe("receipt");
    const foremanAck = await apiJson(request, seeded.foremanToken, "POST", `/partner-mobilization/foreman/notices/${noticeId}/acknowledge`);
    expect(foremanAck.acknowledgment_type).toBe("operational_start_instructions");

    const decision = await client.query("SELECT decision FROM mobilization_decisions WHERE tenant_id = $1 AND current = true", [seeded.tenantA]);
    expect(decision.rows[0].decision).toBe("conditionally_approved");
  });

  test("canonical source mutations automatically invalidate readiness and hold authorization without restricted payload leaks", async ({ request }) => {
    await apiJson(request, seeded.internalToken, "POST", `/partner-workforce/organizations/${seeded.orgA}/workers/${seeded.workerIds[0]}/review`, {
      status: "inactive",
      external_return_reason: "Synthetic worker inactivation for automatic P6 invalidation",
      internal_review_notes: "restricted worker inactivation detail must not leak",
    });
    const invalidated = await client.query(
      `
      SELECT e.id, c.requirement_code
      FROM mobilization_readiness_evaluations e
      JOIN mobilization_readiness_check_results c ON c.tenant_id = e.tenant_id AND c.evaluation_id = e.id
      WHERE e.tenant_id = $1 AND e.work_order_version_id = $2 AND e.current = true
      `,
      [seeded.tenantA, seeded.workOrderVersionId],
    );
    expect(invalidated.rows.map((row) => row.requirement_code)).toContain("crew_base_ready");
    const held = await client.query("SELECT decision FROM mobilization_decisions WHERE tenant_id = $1 AND work_order_version_id = $2 AND current = true", [seeded.tenantA, seeded.workOrderVersionId]);
    expect(held.rows[0].decision).toBe("hold");
    const start = await client.query("SELECT authorization_status FROM production_start_authorizations WHERE tenant_id = $1 AND current = true", [seeded.tenantA]);
    expect(start.rows[0].authorization_status).toBe("held");
    const workerInvalidations = await client.query("SELECT count(*)::int AS count FROM mobilization_source_event_invalidations WHERE tenant_id = $1 AND work_order_version_id = $2 AND source_event_type = 'worker.reviewed' AND status = 'blocked'", [seeded.tenantA, seeded.workOrderVersionId]);
    expect(workerInvalidations.rows[0].count).toBe(1);

    await apiJson(request, seeded.internalToken, "POST", `/partner-agreements/organizations/${seeded.orgA}/vehicle-assignments/${seeded.vehicleAssignmentId}/return`, {
      partner_return_release_date: "2026-08-26",
      odometer_at_return: 1210,
      fuel_level_at_return: "full",
    });
    const vehicleInvalidated = await client.query(
      `
      SELECT c.requirement_code
      FROM mobilization_readiness_evaluations e
      JOIN mobilization_readiness_check_results c ON c.tenant_id = e.tenant_id AND c.evaluation_id = e.id
      WHERE e.tenant_id = $1 AND e.work_order_version_id = $2 AND e.current = true
      `,
      [seeded.tenantA, seeded.workOrderVersionId],
    );
    expect(vehicleInvalidated.rows.map((row) => row.requirement_code)).toContain("vehicle_assignment_valid");

    const leaks = await client.query(
      `
      SELECT count(*)::int AS count
      FROM event_payloads ep
      JOIN events e ON e.id = ep.event_id
      WHERE e.tenant_id = $1
        AND (
          (e.aggregate_type = 'mobilization_readiness' AND e.aggregate_id IN (SELECT id FROM mobilization_readiness_evaluations WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3))
          OR (e.aggregate_type = 'mobilization_decision' AND e.aggregate_id IN (SELECT id FROM mobilization_decisions WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3))
          OR (e.aggregate_type = 'notice_to_proceed' AND e.aggregate_id IN (SELECT id FROM notice_to_proceed_versions WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3))
          OR (e.aggregate_type = 'production_start' AND e.aggregate_id IN (SELECT id FROM production_start_authorizations WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3))
        )
        AND (
          ep.payload::text ILIKE '%internal mobilization note%'
          OR ep.payload::text ILIKE '%customer_rate%'
          OR ep.payload::text ILIKE '%margin%'
          OR ep.payload::text ILIKE '%driver_license%'
          OR ep.payload::text ILIKE '%content_base64%'
        )
      `,
      [seeded.tenantA, seeded.orgA, seeded.workOrderVersionId],
    );
    expect(leaks.rows[0].count).toBe(0);
  });

  test("canonical P3/P4/P5 source events automatically invalidate ready authorization", async ({ request }) => {
    const cases: Array<{ name: string; expected: string; mutate: (fixture: Seeded) => Promise<void> }> = [
      {
        name: "insurance rejection",
        expected: "partner_compliance_ready",
        mutate: async (fixture) => {
          const policy = await one(client, "SELECT id FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND policy_type = 'commercial_auto'", [fixture.tenantA, fixture.orgA]);
          await apiJson(request, fixture.internalToken, "POST", `/partner-compliance/organizations/${fixture.orgA}/insurance-policies/${policy.id}/review`, { status: "rejected", external_return_reason: "Synthetic rejection" });
        },
      },
      {
        name: "Worker suspension",
        expected: "crew_base_ready",
        mutate: async (fixture) => {
          await apiJson(request, fixture.internalToken, "POST", `/partner-workforce/organizations/${fixture.orgA}/workers/${fixture.workerIds[0]}/review`, { status: "suspended", suspended_reason: "Synthetic suspension" });
        },
      },
      {
        name: "Worker credential rejection",
        expected: "crew_base_ready",
        mutate: async (fixture) => {
          const credential = await one(client, "SELECT id FROM partner_worker_credentials WHERE tenant_id = $1 AND worker_id = $2 LIMIT 1", [fixture.tenantA, fixture.workerIds[0]]);
          await apiJson(request, fixture.internalToken, "POST", `/partner-workforce/organizations/${fixture.orgA}/workers/${fixture.workerIds[0]}/credentials/${credential.id}/review`, { status: "rejected", external_return_reason: "Synthetic credential rejection" });
        },
      },
      {
        name: "Crew membership end",
        expected: "crew_base_ready",
        mutate: async (fixture) => {
          const membership = await one(client, "SELECT id FROM partner_crew_memberships WHERE tenant_id = $1 AND crew_id = $2 AND worker_id = $3", [fixture.tenantA, fixture.crewA, fixture.workerIds[3]]);
          await apiJson(request, fixture.adminToken, "POST", `/partner-workforce/me/crews/${fixture.crewA}/members/${membership.id}/end?organization_id=${fixture.orgA}`, { ended_reason: "Synthetic staffing gap" });
        },
      },
      {
        name: "Foreman membership end",
        expected: "approved_foreman",
        mutate: async (fixture) => {
          const membership = await one(client, "SELECT id FROM partner_crew_memberships WHERE tenant_id = $1 AND crew_id = $2 AND worker_id = $3", [fixture.tenantA, fixture.crewA, fixture.workerIds[0]]);
          await apiJson(request, fixture.adminToken, "POST", `/partner-workforce/me/crews/${fixture.crewA}/members/${membership.id}/end?organization_id=${fixture.orgA}`, { ended_reason: "Synthetic foreman change" });
        },
      },
      {
        name: "MSA termination",
        expected: "msa_effective",
        mutate: async (fixture) => {
          await apiJson(request, fixture.internalToken, "POST", `/partner-agreements/organizations/${fixture.orgA}/agreements/${fixture.agreementVersionId}/terminate`, { reason: "Synthetic MSA termination" });
        },
      },
      {
        name: "Work Order suspension",
        expected: "work_order_active",
        mutate: async (fixture) => {
          await apiJson(request, fixture.internalToken, "POST", `/partner-agreements/organizations/${fixture.orgA}/work-orders/${fixture.workOrderVersionId}/suspend`, { reason: "Synthetic WO suspension" });
        },
      },
      {
        name: "operator revocation",
        expected: "approved_operator",
        mutate: async (fixture) => {
          await apiJson(request, fixture.internalToken, "POST", `/partner-agreements/organizations/${fixture.orgA}/vehicle-assignments/${fixture.vehicleAssignmentId}/operators/${fixture.operatorAuthorizationId}/revoke`, { reason: "Synthetic operator revocation" });
        },
      },
    ];

    for (const item of cases) {
      const fixture = await seedMobilizationFixture(client, process.env.AUTH_JWT_SECRET!);
      const before = await authorizeFixture(request, fixture);
      const countsBefore = await forbiddenWorkflowCounts(client);
      await item.mutate(fixture);
      await expectInvalidated(fixture, item.expected, countsBefore);
      await expectHistoryPreserved(fixture, before.evaluationId, before.decisionId, before.noticeId);
    }
  });

  test("scheduled expiration scan invalidates time-based sources and is idempotent", async ({ request }) => {
    const fixture = await seedMobilizationFixture(client, process.env.AUTH_JWT_SECRET!);
    await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/evaluate`, {
      requirements: [{ requirement_code: "housing_confirmation", required: true, external_message: "Housing confirmation pending" }],
    });
    const override = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/overrides`, {
      requirement_code: "housing_confirmation",
      reason: "Synthetic administrative override",
      external_condition: "Housing confirmation expires at noon",
      expires_at: "2026-08-20T12:00:00Z",
    });
    const ready = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/evaluate`);
    expect(ready.overall_status).toBe("conditional");
    const approved = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/conditional-approve`, {
      external_conditions: ["Housing confirmation expires at noon"],
      expires_at: "2026-08-20T12:00:00Z",
    });
    const notice = await issueNotice(request, fixture);

    await client.query("UPDATE partner_insurance_policies SET expiration_date = '2026-08-19' WHERE tenant_id = $1 AND organization_id = $2 AND policy_type = 'commercial_auto'", [fixture.tenantA, fixture.orgA]);
    await client.query("UPDATE partner_worker_credentials SET expiration_date = '2026-08-19' WHERE tenant_id = $1 AND worker_id = $2 AND credential_type = 'driver_license'", [fixture.tenantA, fixture.workerIds[0]]);
    await client.query("UPDATE partner_vehicle_assignments SET aerial_inspection_expires_at = '2026-08-19' WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.vehicleAssignmentId]);

    const countsBeforeScan = await forbiddenWorkflowCounts(client);
    const before = await runMobilizationExpirationScan(client as never, { asOf: "2026-08-19T23:00:00Z", batchSize: 20 });
    expect(before.emittedEvents).toBe(0);
    const result = await runMobilizationExpirationScan(client as never, { asOf: "2026-08-21T00:00:00Z", batchSize: 20 });
    expect(result.emittedEvents).toBeGreaterThanOrEqual(4);
    await expectHeldBlocked(fixture, countsBeforeScan);
    await expectInvalidationLedgerContains(fixture, "partner_compliance_ready");
    await expectInvalidationLedgerContains(fixture, "crew_base_ready");
    await expectInvalidationLedgerContains(fixture, "approved_operator");
    await expectInvalidationLedgerContains(fixture, "vehicle_aerial_inspection_current");
    await expectInvalidationLedgerContains(fixture, "override_expired");
    await expectInvalidationLedgerContains(fixture, "mobilization_decision_current");
    const scanAgain = await runMobilizationExpirationScan(client as never, { asOf: "2026-08-21T00:00:00Z", batchSize: 20 });
    expect(scanAgain.emittedEvents).toBeGreaterThanOrEqual(0);
    const invalidations = await client.query("SELECT source_fingerprint, count(*)::int AS count FROM mobilization_source_event_invalidations WHERE tenant_id = $1 AND work_order_version_id = $2 GROUP BY source_fingerprint HAVING count(*) > 1", [fixture.tenantA, fixture.workOrderVersionId]);
    expect(invalidations.rows).toHaveLength(0);
    await expectHistoryPreserved(fixture, ready.id, approved.id, notice.id);
    expect(override.status).toBe("active");
  });

  test("duplicate and older source-event replay does not duplicate or restore authorization", async ({ request }) => {
    const fixture = await seedMobilizationFixture(client, process.env.AUTH_JWT_SECRET!);
    const before = await authorizeFixture(request, fixture);
    await apiJson(request, fixture.internalToken, "POST", `/partner-workforce/organizations/${fixture.orgA}/workers/${fixture.workerIds[0]}/review`, { status: "suspended", suspended_reason: "Synthetic duplicate replay" });
    const event = await one(client, "SELECT id FROM events WHERE tenant_id = $1 AND event_type = 'worker.suspended' ORDER BY created_at DESC LIMIT 1", [fixture.tenantA]);
    await replayMobilizationSourceInvalidation(client as never, event.id);
    await replayMobilizationSourceInvalidation(client as never, event.id);
    await expectInvalidated(fixture, "crew_base_ready", await forbiddenWorkflowCounts(client));
    const ledger = await client.query("SELECT count(*)::int AS count FROM mobilization_source_event_invalidations WHERE tenant_id = $1 AND source_event_id = $2", [fixture.tenantA, event.id]);
    expect(ledger.rows[0].count).toBe(1);
    const holds = await client.query("SELECT count(*)::int AS count FROM events WHERE tenant_id = $1 AND event_type = 'mobilization.held' AND aggregate_id IN (SELECT id FROM mobilization_decisions WHERE tenant_id = $1 AND work_order_version_id = $2)", [fixture.tenantA, fixture.workOrderVersionId]);
    expect(holds.rows[0].count).toBe(1);
    await client.query("UPDATE workers SET status = 'active', review_status = 'approved', updated_at = now() WHERE tenant_id = $1 AND id = $2", [fixture.tenantA, fixture.workerIds[0]]);
    await replayMobilizationSourceInvalidation(client as never, event.id);
    const current = await one(client, "SELECT decision FROM mobilization_decisions WHERE tenant_id = $1 AND work_order_version_id = $2 AND current = true", [fixture.tenantA, fixture.workOrderVersionId]);
    expect(current.decision).toBe("hold");
    await expectHistoryPreserved(fixture, before.evaluationId, before.decisionId, before.noticeId);
  });
});

async function seedMobilizationFixture(client: Client, secret: string): Promise<Seeded> {
  const suffix = crypto.randomUUID();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const orgTenantB = crypto.randomUUID();
  const providerA = crypto.randomUUID();
  const providerB = crypto.randomUUID();
  const providerTenantB = crypto.randomUUID();
  const customerOrg = crypto.randomUUID();
  const adminUser = crypto.randomUUID();
  const foremanUser = crypto.randomUUID();
  const internalUser = crypto.randomUUID();
  const unauthorizedUser = crypto.randomUUID();
  const tenantBUser = crypto.randomUUID();
  const adminTenantUser = crypto.randomUUID();
  const foremanTenantUser = crypto.randomUUID();
  const internalTenantUser = crypto.randomUUID();
  const unauthorizedTenantUser = crypto.randomUUID();
  const tenantBTenantUser = crypto.randomUUID();
  const adminRole = crypto.randomUUID();
  const foremanRole = crypto.randomUUID();
  const internalRole = crypto.randomUUID();
  const unauthorizedRole = crypto.randomUUID();
  const tenantBRole = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const agreementVersionId = crypto.randomUUID();
  const workOrderId = crypto.randomUUID();
  const workOrderVersionId = crypto.randomUUID();
  const crewA = crypto.randomUUID();
  const crewAssignmentId = crypto.randomUUID();
  const equipmentId = crypto.randomUUID();
  const vehicleAssignmentId = crypto.randomUUID();
  const operatorAuthorizationId = crypto.randomUUID();
  const workerIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

  const adminPermissions = ["partner_context.read", "partner_mobilization.read", "partner_notice.read", "partner_notice.acknowledge", "partner_workforce.membership.manage"];
  const foremanPermissions = ["partner_context.read", "partner_mobilization.foreman.read", "partner_notice.foreman.read", "partner_notice.foreman.acknowledge"];
  const internalPermissions = ["capacity_provider.read", "partner_mobilization.review", "partner_mobilization.evaluate", "partner_mobilization.approve", "partner_mobilization.hold", "partner_mobilization.revoke", "partner_mobilization.override", "partner_notice.issue", "partner_workforce.review", "partner_vehicle_assignment.manage", "partner_vehicle_assignment.operator.manage", "partner_agreement.review", "partner_work_order.manage", "partner_compliance.review"];
  for (const permission of [...adminPermissions, ...foremanPermissions, ...internalPermissions]) await ensurePermission(client, permission);

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3),($4,$5,$6)", [tenantA, "P6 Tenant A", `p6-a-${suffix}`, tenantB, "P6 Tenant B", `p6-b-${suffix}`]);
    await client.query(
      "INSERT INTO users (id,email,display_name) VALUES ($1,$2,'P6 Partner Admin'),($3,$4,'P6 Partner Foreman'),($5,$6,'P6 Internal'),($7,$8,'P6 Unauthorized'),($9,$10,'P6 Tenant B')",
      [adminUser, `p6-admin-${suffix}@syncos.test`, foremanUser, `p6-foreman-${suffix}@syncos.test`, internalUser, `p6-internal-${suffix}@syncos.test`, unauthorizedUser, `p6-unauth-${suffix}@syncos.test`, tenantBUser, `p6-tenantb-${suffix}@syncos.test`],
    );
    await client.query("INSERT INTO tenant_users (id,tenant_id,user_id) VALUES ($1,$2,$3),($4,$2,$5),($6,$2,$7),($8,$2,$9),($10,$11,$12)", [adminTenantUser, tenantA, adminUser, foremanTenantUser, foremanUser, internalTenantUser, internalUser, unauthorizedTenantUser, unauthorizedUser, tenantBTenantUser, tenantB, tenantBUser]);
    await client.query("INSERT INTO roles (id,tenant_id,name,system_key) VALUES ($1,$2,'P6 Partner Admin','partner_admin'),($3,$2,'P6 Partner Foreman','partner_foreman'),($4,$2,'P6 Internal',$5),($6,$2,'P6 Unauthorized',$7),($8,$9,'P6 Tenant B Partner Admin','partner_admin')", [adminRole, tenantA, foremanRole, internalRole, `p6_internal_${suffix}`, unauthorizedRole, `p6_unauth_${suffix}`, tenantBRole, tenantB]);
    await grantPermissions(client, tenantA, adminRole, adminPermissions);
    await grantPermissions(client, tenantA, foremanRole, foremanPermissions);
    await grantPermissions(client, tenantA, internalRole, internalPermissions);
    await grantPermissions(client, tenantB, tenantBRole, adminPermissions);
    await client.query("INSERT INTO user_roles (tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES ($1,$2,$3,'organization',$4),($1,$5,$6,'organization',$4),($1,$7,$8,'tenant',$1),($1,$9,$10,'tenant',$1),($11,$12,$13,'organization',$14)", [tenantA, adminTenantUser, adminRole, orgA, foremanTenantUser, foremanRole, internalTenantUser, internalRole, unauthorizedTenantUser, unauthorizedRole, tenantB, tenantBTenantUser, tenantBRole, orgTenantB]);
    await client.query("INSERT INTO organizations (id,tenant_id,name,organization_type,actor_roles,status) VALUES ($1,$2,'P6 Partner A','subcontractor',ARRAY['capacity_provider']::text[],'active'),($3,$2,'P6 Partner B','subcontractor',ARRAY['capacity_provider']::text[],'active'),($4,$2,'P6 Customer','customer',ARRAY['work_creator']::text[],'active'),($5,$6,'P6 Tenant B Partner','subcontractor',ARRAY['capacity_provider']::text[],'active')", [orgA, tenantA, orgB, customerOrg, orgTenantB, tenantB]);
    await client.query("INSERT INTO capacity_providers (id,tenant_id,organization_id,name,provider_type,status,verification_status,contract_status) VALUES ($1,$2,$3,'P6 Provider A','subcontractor','activated','verified','contracted'),($4,$2,$5,'P6 Provider B','crew_provider','activated','verified','contracted'),($6,$7,$8,'P6 Tenant B Provider','subcontractor','activated','verified','contracted')", [providerA, tenantA, orgA, providerB, orgB, providerTenantB, tenantB, orgTenantB]);
    await seedReadyCompliance(client, tenantA, orgA, providerA);
    await client.query("INSERT INTO projects (id,tenant_id,customer_organization_id,name,status) VALUES ($1,$2,$3,'P6 Synthetic Project','active')", [projectId, tenantA, customerOrg]);
    await client.query("INSERT INTO contracts (id,tenant_id,organization_id,partner_organization_id,capacity_provider_id,name,contract_type,status,agreement_lifecycle_status,agreement_effective_date) VALUES ($1,$2,$3,$3,$4,'P6 MSA','partner_master_agreement','active','active','2026-08-16')", [contractId, tenantA, orgA, providerA]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_msa_executed','partner_agreement_version',$4,'msa.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, agreementVersionId, `${tenantA}/${orgA}/msa.pdf`, internalUser]);
    const msaFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, agreementVersionId]);
    await client.query("INSERT INTO partner_agreement_versions (id,tenant_id,organization_id,capacity_provider_id,contract_id,version_number,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,1,'effective','2026-08-16',$6,now(),$7)", [agreementVersionId, tenantA, orgA, providerA, contractId, msaFile.rows[0].id, internalUser]);
    await client.query("INSERT INTO rate_schedules (id,tenant_id,organization_id,name,effective_date,status) VALUES ($1,$2,$3,'P6 Partner Rate','2026-08-16','active')", [crypto.randomUUID(), tenantA, orgA]);
    const rateSchedule = await client.query("SELECT id FROM rate_schedules WHERE tenant_id = $1 AND organization_id = $2", [tenantA, orgA]);
    const rateCode = crypto.randomUUID();
    await client.query("INSERT INTO rate_codes (id,tenant_id,rate_schedule_id,code,description,unit,unit_type,amount,contractor_rate,status) VALUES ($1,$2,$3,'accepted_foot','Partner rate','feet','production_unit',0.70,0.70,'active')", [rateCode, tenantA, rateSchedule.rows[0].id]);
    await client.query("INSERT INTO crews (id,tenant_id,capacity_provider_id,organization_id,name,crew_type,status,lifecycle_status,target_staffing_level) VALUES ($1,$2,$3,$4,'P6 Ready Crew','aerial','active','active',4)", [crewA, tenantA, providerA, orgA]);
    for (const [index, workerId] of workerIds.entries()) {
      await client.query("INSERT INTO workers (id,tenant_id,capacity_provider_id,crew_id,organization_id,first_name,last_name,status,review_status) VALUES ($1,$2,$3,$4,$5,$6,'Worker','active','approved')", [workerId, tenantA, providerA, crewA, orgA, `P6-${index}`]);
      await client.query("INSERT INTO partner_crew_memberships (tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role,status) VALUES ($1,$2,$3,$4,$5,$6,'active')", [tenantA, orgA, providerA, crewA, workerId, index === 0 ? "foreman" : index === 1 ? "alternate_foreman" : "member"]);
      const headshotFile = crypto.randomUUID();
      await client.query("INSERT INTO partner_restricted_file_objects (id,tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,$4,'worker_headshot','worker',$5,'headshot.png','image/png',8,'checksum',$6,$7)", [headshotFile, tenantA, orgA, providerA, workerId, `${tenantA}/${workerId}/headshot.png`, internalUser]);
      await client.query("INSERT INTO partner_worker_headshots (tenant_id,organization_id,capacity_provider_id,worker_id,file_object_id,status) VALUES ($1,$2,$3,$4,$5,'approved')", [tenantA, orgA, providerA, workerId, headshotFile]);
      await client.query("INSERT INTO partner_worker_credentials (tenant_id,organization_id,capacity_provider_id,worker_id,credential_type,required,status,expiration_date) VALUES ($1,$2,$3,$4,'driver_license',true,'verified','2027-08-16')", [tenantA, orgA, providerA, workerId]);
    }
    await client.query("INSERT INTO partner_worker_user_links (tenant_id,organization_id,worker_id,tenant_user_id,status) VALUES ($1,$2,$3,$4,'active')", [tenantA, orgA, workerIds[0], foremanTenantUser]);
    await client.query("INSERT INTO work_orders (id,tenant_id,project_id,assigned_capacity_provider_id,assigned_crew_id,title,work_type,expected_units,unit_type,status,work_order_name,work_order_number,scope_summary,map_link,assignment_type,assigned_organization_id,partner_organization_id,partner_rate_schedule_id,governing_agreement_version_id,partner_execution_status,partner_effective_date,unit,planned_quantity) VALUES ($1,$2,$3,$4,$5,'P6 WO','fiber',3000,'feet','assigned','P6 WO','WO-P6-A','fiber hanging and overlash only','MAP-P6-A','partner_contractor',$6,$6,$7,$8,'active','2026-08-22','feet',3000)", [workOrderId, tenantA, projectId, providerA, crewA, orgA, rateSchedule.rows[0].id, agreementVersionId]);
    await client.query("INSERT INTO partner_restricted_file_objects (tenant_id,organization_id,capacity_provider_id,category,related_entity_type,related_entity_id,file_name,mime_type,size_bytes,checksum,storage_key,uploaded_by_user_id) VALUES ($1,$2,$3,'partner_work_order_executed','partner_work_order_version',$4,'wo.pdf','application/pdf',12,'checksum',$5,$6)", [tenantA, orgA, providerA, workOrderVersionId, `${tenantA}/${orgA}/wo.pdf`, internalUser]);
    const woFile = await client.query("SELECT id FROM partner_restricted_file_objects WHERE tenant_id = $1 AND related_entity_id = $2", [tenantA, workOrderVersionId]);
    await client.query("INSERT INTO partner_work_order_versions (id,tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,version_number,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,rate_code_id,work_order_number,scope_summary,primary_work_area,map_work_package_ref,production_unit,performance_target,status,effective_date,artifact_file_object_id,artifact_verified_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,'WO-P6-A','fiber hanging and overlash only','Synthetic Toledo map section A','MAP-P6-A','feet',3000,'active','2026-08-22',$11,now(),$12)", [workOrderVersionId, tenantA, orgA, providerA, projectId, workOrderId, agreementVersionId, crewA, rateSchedule.rows[0].id, rateCode, woFile.rows[0].id, internalUser]);
    await client.query("INSERT INTO partner_work_order_crew_assignments (id,tenant_id,organization_id,capacity_provider_id,work_order_id,work_order_version_id,crew_id,status,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)", [crewAssignmentId, tenantA, orgA, providerA, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO equipment (id,tenant_id,name,equipment_type,status) VALUES ($1,$2,'P6 Bucket Truck','bucket_truck','active')", [equipmentId, tenantA]);
    await client.query("INSERT INTO partner_vehicle_assignments (id,tenant_id,organization_id,capacity_provider_id,equipment_id,work_order_id,work_order_version_id,crew_id,rental_provider,partner_custody_start_date,daily_allocation_amount,status,aerial_inspection_expires_at,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic Rental','2026-08-23',100,'active_custody','2027-08-16',$9)", [vehicleAssignmentId, tenantA, orgA, providerA, equipmentId, workOrderId, workOrderVersionId, crewA, internalUser]);
    await client.query("INSERT INTO partner_vehicle_condition_records (tenant_id,organization_id,vehicle_assignment_id,record_type,odometer,fuel_level,recorded_by_user_id) VALUES ($1,$2,$3,'pre_assignment',1200,'full',$4)", [tenantA, orgA, vehicleAssignmentId, internalUser]);
    await client.query("INSERT INTO partner_vehicle_operator_authorizations (id,tenant_id,organization_id,vehicle_assignment_id,worker_id,crew_id,authorization_role,qualification_status,approved_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,'driver_operator','approved',$7)", [operatorAuthorizationId, tenantA, orgA, vehicleAssignmentId, workerIds[0], crewA, internalUser]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return {
    tenantA, tenantB, orgA, orgB, providerA, crewA, crewAssignmentId, workerIds, agreementVersionId, workOrderVersionId, vehicleAssignmentId, operatorAuthorizationId,
    adminToken: createToken({ sub: adminUser, tenant_id: tenantA }, secret),
    foremanToken: createToken({ sub: foremanUser, tenant_id: tenantA }, secret),
    internalToken: createToken({ sub: internalUser, tenant_id: tenantA }, secret),
    unauthorizedToken: createToken({ sub: unauthorizedUser, tenant_id: tenantA }, secret),
    tenantBToken: createToken({ sub: tenantBUser, tenant_id: tenantB }, secret),
  };
}

async function seedReadyCompliance(client: Client, tenantId: string, orgId: string, providerId: string) {
  await client.query("INSERT INTO partner_company_profiles (tenant_id,organization_id,capacity_provider_id,legal_business_name,business_address,status) VALUES ($1,$2,$3,'P6 Partner A','{}','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_tax_profiles (tenant_id,organization_id,capacity_provider_id,legal_name_on_w9,federal_tax_classification,tin_type,tin_last_four,status) VALUES ($1,$2,$3,'P6 Partner A','corporation','ein','1234','verified')", [tenantId, orgId, providerId]);
  await client.query("INSERT INTO partner_payment_profiles (tenant_id,organization_id,capacity_provider_id,priority_passport_status,status) VALUES ($1,$2,$3,'active','active')", [tenantId, orgId, providerId]);
  const policies = ["commercial_general_liability", "commercial_auto", "umbrella_excess", "workers_compensation", "employers_liability"];
  for (const type of policies) {
    await client.query("INSERT INTO partner_insurance_policies (tenant_id,organization_id,capacity_provider_id,policy_type,carrier,effective_date,expiration_date,status,occurrence_limit_cents,general_aggregate_cents,products_completed_operations_aggregate_cents,combined_single_auto_limit_cents,workers_compensation_statutory,employer_liability_accident_limit_cents,employer_liability_disease_each_employee_limit_cents,employer_liability_disease_policy_limit_cents,additional_insured_status,waiver_of_subrogation_status,primary_non_contributory_status) VALUES ($1,$2,$3,$4,'Synthetic Carrier','2026-01-01','2027-08-16','verified',100000000,200000000,200000000,100000000,true,50000000,50000000,50000000,'verified','verified','verified')", [tenantId, orgId, providerId, type]);
  }
}

async function forbiddenWorkflowCounts(client: Client) {
  const result = await client.query<{
    production: number;
    qc: number;
    billable: number;
    settlements: number;
    payables: number;
    payments: number;
  }>(
    "SELECT (SELECT count(*)::int FROM production_records) AS production, (SELECT count(*)::int FROM qc_reviews) AS qc, (SELECT count(*)::int FROM billable_items) AS billable, (SELECT count(*)::int FROM settlements) AS settlements, (SELECT count(*)::int FROM contractor_payables) AS payables, (SELECT count(*)::int FROM payments) AS payments",
  );
  return result.rows[0];
}

async function authorizeFixture(request: APIRequestContext, fixture: Seeded) {
  const evaluation = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/evaluate`);
  expect(evaluation.overall_status).toBe("ready");
  const decision = await apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/approve`, {});
  expect(decision.decision).toBe("approved_to_mobilize");
  const notice = await issueNotice(request, fixture);
  expect(notice.production_start.authorization_status).toBe("authorized");
  return { evaluationId: evaluation.id as string, decisionId: decision.id as string, noticeId: notice.id as string };
}

async function issueNotice(request: APIRequestContext, fixture: Seeded) {
  return apiJson(request, fixture.internalToken, "POST", `/partner-mobilization/organizations/${fixture.orgA}/work-order-versions/${fixture.workOrderVersionId}/notices`, {
    planned_mobilization_date: "2026-08-24",
    production_start_date: "2026-08-25",
    production_start_time: "07:30:00",
    timezone: "America/New_York",
    initial_work_area: "Synthetic P6C source-event proof area",
    external_instructions: "Begin only on the issued map package and initial work area.",
  });
}

async function expectInvalidated(fixture: Seeded, expectedRequirementCode: string, expectedWorkflowCounts: Awaited<ReturnType<typeof forbiddenWorkflowCounts>>) {
  const current = await clientQuery(
    `
    SELECT e.id, e.overall_status, c.requirement_code
    FROM mobilization_readiness_evaluations e
    JOIN mobilization_readiness_check_results c ON c.tenant_id = e.tenant_id AND c.evaluation_id = e.id
    WHERE e.tenant_id = $1 AND e.work_order_version_id = $2 AND e.crew_assignment_id = $3 AND e.current = true
    `,
    [fixture.tenantA, fixture.workOrderVersionId, fixture.crewAssignmentId],
  );
  expect(current.rows[0].overall_status).toBe("blocked");
  expect(current.rows.map((row) => row.requirement_code)).toContain(expectedRequirementCode);
  await expectHeldBlocked(fixture, expectedWorkflowCounts);
}

async function expectHeldBlocked(fixture: Seeded, expectedWorkflowCounts: Awaited<ReturnType<typeof forbiddenWorkflowCounts>>) {
  const decision = await clientQuery("SELECT decision FROM mobilization_decisions WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true", [fixture.tenantA, fixture.workOrderVersionId, fixture.crewAssignmentId]);
  expect(decision.rows[0].decision).toBe("hold");
  const notice = await clientQuery("SELECT status, production_start_status FROM notice_to_proceed_versions WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true", [fixture.tenantA, fixture.workOrderVersionId, fixture.crewAssignmentId]);
  expect(notice.rows[0].status).toBe("held");
  expect(notice.rows[0].production_start_status).toBe("held");
  const start = await clientQuery("SELECT authorization_status FROM production_start_authorizations WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true", [fixture.tenantA, fixture.workOrderVersionId, fixture.crewAssignmentId]);
  expect(start.rows[0].authorization_status).toBe("held");
  expect(await forbiddenWorkflowCounts(globalClient)).toEqual(expectedWorkflowCounts);
}

async function expectInvalidationLedgerContains(fixture: Seeded, expectedRequirementCode: string) {
  const result = await clientQuery("SELECT blocker_codes FROM mobilization_source_event_invalidations WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3", [fixture.tenantA, fixture.workOrderVersionId, fixture.crewAssignmentId]);
  expect(result.rows.flatMap((row) => row.blocker_codes)).toContain(expectedRequirementCode);
}

async function expectHistoryPreserved(fixture: Seeded, evaluationId: string, decisionId: string, noticeId: string) {
  const prior = await clientQuery(
    `
    SELECT
      EXISTS(SELECT 1 FROM mobilization_readiness_evaluations WHERE tenant_id = $1 AND id = $2 AND current = false) AS evaluation_preserved,
      EXISTS(SELECT 1 FROM mobilization_decisions WHERE tenant_id = $1 AND id = $3 AND current = false) AS decision_preserved,
      EXISTS(SELECT 1 FROM notice_to_proceed_versions WHERE tenant_id = $1 AND id = $4 AND current = true) AS notice_preserved
    `,
    [fixture.tenantA, evaluationId, decisionId, noticeId],
  );
  expect(prior.rows[0].evaluation_preserved).toBe(true);
  expect(prior.rows[0].decision_preserved).toBe(true);
  expect(prior.rows[0].notice_preserved).toBe(true);
}

async function one(client: Client, sql: string, params: unknown[]) {
  const result = await client.query(sql, params);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

function clientQuery(sql: string, params: unknown[]) {
  return globalClient.query(sql, params);
}

async function ensurePermission(client: Client, key: string) {
  await client.query("INSERT INTO permissions (key, name, description) VALUES ($1, $1, 'P6 partner mobilization test permission') ON CONFLICT (key) DO NOTHING", [key]);
}

async function grantPermissions(client: Client, tenantId: string, roleId: string, keys: string[]) {
  for (const key of keys) {
    await client.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE key = $3 ON CONFLICT (role_id, permission_id) DO NOTHING", [tenantId, roleId, key]);
  }
}

async function apiJson(request: APIRequestContext, token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await send(request, token, method, path, body);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(400);
  return response.json();
}

async function expectStatus(request: APIRequestContext, token: string, method: "GET" | "POST", path: string, expected: number, body?: unknown) {
  const response = await send(request, token, method, path, body);
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(expected);
}

function send(request: APIRequestContext, token: string, method: "GET" | "POST", route: string, body?: unknown) {
  const options = { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, data: body };
  const url = apiUrl(route);
  if (method === "GET") return request.get(url, options);
  return request.post(url, options);
}

function apiUrl(route: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required");
  return `${base}/${route.replace(/^\//, "")}`;
}

function createToken(claims: { sub: string; tenant_id: string }, secret: string): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ ...claims, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
