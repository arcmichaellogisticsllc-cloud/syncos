import type { PoolClient } from "pg";
import { appendAuditLog, type CreateAuditLogInput } from "./audit";

export type WriteActionResult<T> = {
  entityType: string;
  entityId: string;
  eventType?: string;
  afterState: T;
  beforeState?: Record<string, unknown>;
  additionalEvents?: Array<{
    action: string;
    aggregateType: string;
    entityType: string;
    entityId: string;
    eventType: string;
    afterState: Record<string, unknown>;
    beforeState?: Record<string, unknown>;
    audit?: Omit<CreateAuditLogInput, "tenantId" | "actorUserId" | "action" | "entityType" | "entityId" | "afterState" | "beforeState">;
    systemActions?: Array<{
      actionType: string;
      payload?: Record<string, unknown>;
    }>;
  }>;
};

export type ExecuteWriteActionInput<T> = {
  tenantId: string;
  actorUserId: string;
  action: string;
  aggregateType: string;
  eventType: string;
  audit?: Omit<CreateAuditLogInput, "tenantId" | "actorUserId" | "action" | "entityType" | "entityId" | "afterState" | "beforeState">;
  systemActions?: Array<{
    actionType: string;
    payload?: Record<string, unknown>;
  }>;
  write: (client: PoolClient) => Promise<WriteActionResult<T>>;
};

export async function executeWriteAction<T>(
  client: PoolClient,
  input: ExecuteWriteActionInput<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await input.write(client);
    const eventType = result.eventType ?? input.eventType;
    const systemActions = result.eventType
      ? [{ actionType: `${eventType}.processed`, payload: { action: input.action } }]
      : input.systemActions;
    await appendEventAuditAndActions(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      aggregateType: input.aggregateType,
      entityType: result.entityType,
      entityId: result.entityId,
      eventType,
      beforeState: result.beforeState,
      afterState: result.afterState as Record<string, unknown>,
      audit: input.audit,
      systemActions,
    });

    for (const event of result.additionalEvents ?? []) {
      await appendEventAuditAndActions(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        ...event,
      });
    }

    await client.query("COMMIT");
    return result.afterState;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export type MobilizationExpirationScanResult = {
  scannedAt: string;
  emittedEvents: number;
};

export async function runMobilizationExpirationScan(
  client: PoolClient,
  options: { asOf?: string | Date; batchSize?: number } = {},
): Promise<MobilizationExpirationScanResult> {
  const asOf = options.asOf instanceof Date ? options.asOf.toISOString() : options.asOf ?? new Date().toISOString();
  const batchSize = Math.max(1, Math.min(Number(options.batchSize ?? 50), 250));
  const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('syncos.p6.mobilization_expiration_scan')) AS locked");
  if (!lock.rows[0]?.locked) return { scannedAt: asOf, emittedEvents: 0 };
  let emittedEvents = 0;
  try {
    const due = await client.query(
      `
      WITH active_contexts AS (
        SELECT DISTINCT wov.tenant_id, wov.organization_id, wov.id AS work_order_version_id, ca.id AS crew_assignment_id,
          ca.crew_id, COALESCE(md.authorized_by_user_id, ntp.issued_by_user_id, psa.authorized_by_user_id) AS actor_user_id
        FROM partner_work_order_versions wov
        JOIN partner_work_order_crew_assignments ca ON ca.tenant_id = wov.tenant_id AND ca.work_order_version_id = wov.id AND ca.status = 'active'
        LEFT JOIN mobilization_decisions md ON md.tenant_id = wov.tenant_id AND md.work_order_version_id = wov.id AND md.crew_assignment_id = ca.id AND md.current = true
        LEFT JOIN notice_to_proceed_versions ntp ON ntp.tenant_id = wov.tenant_id AND ntp.work_order_version_id = wov.id AND ntp.crew_assignment_id = ca.id AND ntp.current = true
        LEFT JOIN production_start_authorizations psa ON psa.tenant_id = wov.tenant_id AND psa.work_order_version_id = wov.id AND psa.crew_assignment_id = ca.id AND psa.current = true
        WHERE wov.deleted_at IS NULL
          AND (md.id IS NOT NULL OR ntp.id IS NOT NULL OR psa.id IS NOT NULL OR EXISTS (
            SELECT 1 FROM mobilization_readiness_evaluations mre
            WHERE mre.tenant_id = wov.tenant_id AND mre.work_order_version_id = wov.id AND mre.crew_assignment_id = ca.id AND mre.current = true
          ))
      ),
      due_sources AS (
        SELECT DISTINCT ac.tenant_id, ac.actor_user_id, 'partner_insurance_policy.expired' AS event_type, 'partner_insurance_policy' AS aggregate_type,
          pip.id AS aggregate_id, jsonb_build_object('id', pip.id, 'tenant_id', pip.tenant_id, 'organization_id', pip.organization_id, 'capacity_provider_id', pip.capacity_provider_id, 'status', 'expired', 'policy_type', pip.policy_type, 'expiration_date', pip.expiration_date) AS after_state
        FROM active_contexts ac
        JOIN partner_insurance_policies pip ON pip.tenant_id = ac.tenant_id AND pip.organization_id = ac.organization_id AND pip.deleted_at IS NULL AND pip.status = 'verified' AND pip.expiration_date < $1::date
        UNION ALL
        SELECT DISTINCT ac.tenant_id, ac.actor_user_id, 'worker_credential.expired', 'worker_credential',
          pwc.id, jsonb_build_object('id', pwc.id, 'tenant_id', pwc.tenant_id, 'organization_id', pwc.organization_id, 'capacity_provider_id', pwc.capacity_provider_id, 'worker_id', pwc.worker_id, 'credential_type', pwc.credential_type, 'status', 'expired', 'expiration_date', pwc.expiration_date)
        FROM active_contexts ac
        JOIN partner_crew_memberships pcm ON pcm.tenant_id = ac.tenant_id AND pcm.organization_id = ac.organization_id AND pcm.crew_id = ac.crew_id AND pcm.status = 'active'
        JOIN partner_worker_credentials pwc ON pwc.tenant_id = ac.tenant_id AND pwc.organization_id = ac.organization_id AND pwc.worker_id = pcm.worker_id AND pwc.required = true AND pwc.status = 'verified' AND pwc.deleted_at IS NULL AND pwc.expiration_date < $1::date
        UNION ALL
        SELECT DISTINCT ac.tenant_id, ac.actor_user_id, 'worker_credential.expired', 'worker_credential',
          opcred.id, jsonb_build_object('id', opcred.id, 'tenant_id', opcred.tenant_id, 'organization_id', opcred.organization_id, 'capacity_provider_id', opcred.capacity_provider_id, 'worker_id', opcred.worker_id, 'credential_type', opcred.credential_type, 'status', 'expired', 'expiration_date', opcred.expiration_date)
        FROM active_contexts ac
        JOIN partner_vehicle_assignments pva ON pva.tenant_id = ac.tenant_id AND pva.work_order_version_id = ac.work_order_version_id AND pva.crew_id = ac.crew_id AND pva.deleted_at IS NULL
        JOIN partner_vehicle_operator_authorizations pvoa ON pvoa.tenant_id = ac.tenant_id AND pvoa.organization_id = ac.organization_id AND pvoa.vehicle_assignment_id = pva.id AND pvoa.crew_id = ac.crew_id AND pvoa.end_date IS NULL AND pvoa.qualification_status = 'approved'
        JOIN partner_worker_credentials opcred ON opcred.tenant_id = ac.tenant_id AND opcred.organization_id = ac.organization_id AND opcred.worker_id = pvoa.worker_id AND opcred.credential_type = 'driver_license' AND opcred.status = 'verified' AND opcred.deleted_at IS NULL AND opcred.expiration_date < $1::date
        UNION ALL
        SELECT DISTINCT ac.tenant_id, ac.actor_user_id, 'vehicle_assignment.inspection_expired', 'vehicle_assignment',
          pva.id, jsonb_build_object('id', pva.id, 'tenant_id', pva.tenant_id, 'organization_id', pva.organization_id, 'capacity_provider_id', pva.capacity_provider_id, 'work_order_version_id', pva.work_order_version_id, 'crew_id', pva.crew_id, 'status', pva.status, 'aerial_inspection_expires_at', pva.aerial_inspection_expires_at)
        FROM active_contexts ac
        JOIN partner_vehicle_assignments pva ON pva.tenant_id = ac.tenant_id AND pva.work_order_version_id = ac.work_order_version_id AND pva.crew_id = ac.crew_id AND pva.deleted_at IS NULL AND pva.aerial_inspection_expires_at IS NOT NULL AND pva.aerial_inspection_expires_at < $1::date
        UNION ALL
        SELECT DISTINCT ac.tenant_id, ac.actor_user_id, 'mobilization_override.expired', 'mobilization_override',
          mo.id, jsonb_build_object('id', mo.id, 'tenant_id', mo.tenant_id, 'organization_id', mo.organization_id, 'work_order_version_id', mo.work_order_version_id, 'crew_assignment_id', mo.crew_assignment_id, 'requirement_code', mo.requirement_code, 'status', 'expired')
        FROM active_contexts ac
        JOIN mobilization_overrides mo ON mo.tenant_id = ac.tenant_id AND mo.work_order_version_id = ac.work_order_version_id AND mo.crew_assignment_id = ac.crew_assignment_id AND mo.status = 'active' AND mo.expires_at <= $1::timestamptz
        UNION ALL
        SELECT DISTINCT ac.tenant_id, ac.actor_user_id, 'mobilization_decision.expired', 'mobilization_decision',
          md.id, jsonb_build_object('id', md.id, 'tenant_id', md.tenant_id, 'organization_id', md.organization_id, 'work_order_version_id', md.work_order_version_id, 'crew_assignment_id', md.crew_assignment_id, 'decision', md.decision, 'status', 'expired')
        FROM active_contexts ac
        JOIN mobilization_decisions md ON md.tenant_id = ac.tenant_id AND md.work_order_version_id = ac.work_order_version_id AND md.crew_assignment_id = ac.crew_assignment_id AND md.current = true AND md.decision IN ('approved_to_mobilize','conditionally_approved') AND md.expires_at IS NOT NULL AND md.expires_at <= $1::timestamptz
      )
      SELECT * FROM due_sources WHERE actor_user_id IS NOT NULL LIMIT $2
      `,
      [asOf, batchSize],
    );
    for (const row of due.rows) {
      await client.query("BEGIN");
      try {
        if (row.event_type === "mobilization_override.expired") await client.query("UPDATE mobilization_overrides SET status = 'expired' WHERE tenant_id = $1 AND id = $2 AND status = 'active'", [row.tenant_id, row.aggregate_id]);
        await appendEventAuditAndActions(client, {
          tenantId: row.tenant_id,
          actorUserId: row.actor_user_id,
          action: "mobilization_expiration.scan",
          aggregateType: row.aggregate_type,
          entityType: row.aggregate_type,
          entityId: row.aggregate_id,
          eventType: row.event_type,
          afterState: row.after_state,
          systemActions: [{ actionType: `${row.event_type}.processed`, payload: { source: "p6_expiration_scan", as_of: asOf } }],
        });
        await client.query("COMMIT");
        emittedEvents += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { scannedAt: asOf, emittedEvents };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('syncos.p6.mobilization_expiration_scan'))");
  }
}

export async function replayMobilizationSourceInvalidation(
  client: PoolClient,
  eventId: string,
): Promise<{ replayed: boolean }> {
  const result = await client.query<{
    tenant_id: string;
    actor_user_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
  }>(
    `
    SELECT e.tenant_id, e.actor_user_id, e.aggregate_type, e.aggregate_id, e.event_type, ep.payload
    FROM events e
    JOIN event_payloads ep ON ep.event_id = e.id
    WHERE e.id = $1
    `,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) return { replayed: false };
  await applyMobilizationSourceInvalidation(client, {
    eventId,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    afterState: row.payload,
  });
  return { replayed: true };
}

async function appendEventAuditAndActions(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    aggregateType: string;
    entityType: string;
    entityId: string;
    eventType: string;
    beforeState?: Record<string, unknown>;
    afterState: Record<string, unknown>;
    audit?: Omit<CreateAuditLogInput, "tenantId" | "actorUserId" | "action" | "entityType" | "entityId" | "afterState" | "beforeState">;
    systemActions?: Array<{
      actionType: string;
      payload?: Record<string, unknown>;
    }>;
  },
) {
  const eventResult = await client.query<{ id: string }>(
    `
    INSERT INTO events (
      tenant_id,
      aggregate_type,
      aggregate_id,
      event_type,
      actor_user_id,
      audit_context
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
    `,
    [
      input.tenantId,
      input.aggregateType,
      input.entityId,
      input.eventType,
      input.actorUserId,
      { action: input.action, entityType: input.entityType },
    ],
  );
  structuredLog("Event", "event_created", {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventId: eventResult.rows[0].id,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.entityId,
  });

  await client.query("INSERT INTO event_payloads (event_id, payload) VALUES ($1, $2)", [
    eventResult.rows[0].id,
    input.afterState,
  ]);

  await appendAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeState: input.beforeState,
    afterState: input.afterState,
    ...input.audit,
  });
  structuredLog("Audit", "audit_log_created", {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
  });

  for (const action of input.systemActions ?? []) {
    await client.query(
      `
      INSERT INTO system_actions (tenant_id, event_id, action_type, payload)
      VALUES ($1, $2, $3, $4)
      `,
      [input.tenantId, eventResult.rows[0].id, action.actionType, action.payload ?? {}],
    );
  }

  await applyMobilizationSourceInvalidation(client, {
    eventId: eventResult.rows[0].id,
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.entityId,
    afterState: input.afterState,
  });
}

function structuredLog(category: "Event" | "Audit", message: string, context: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), category, message, ...context })}\n`);
}

type SourceInvalidationInput = {
  eventId: string;
  tenantId: string;
  actorUserId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  afterState: Record<string, unknown>;
};

type MobilizationInvalidationContext = {
  project_id: string;
  work_order_id: string;
  work_order_version_id: string;
  organization_id: string;
  capacity_provider_id: string;
  crew_assignment_id: string;
  crew_id: string;
  vehicle_assignment_id: string | null;
  map_work_package_ref: string | null;
  project_timezone: string;
};

type SourceBlocker = {
  code: string;
  category: string;
  external: string;
  internal: string;
  sourceType: string;
  sourceRecordId: string;
  observedState: string;
};

async function applyMobilizationSourceInvalidation(client: PoolClient, input: SourceInvalidationInput) {
  if (input.eventType.startsWith("mobilization_readiness") || input.eventType.startsWith("mobilization.") || input.eventType.startsWith("notice_to_proceed") || input.eventType.startsWith("production_start")) return;
  const blockers = sourceBlockers(input);
  if (!blockers.length) return;
  const sourceFingerprint = mobilizationSourceFingerprint(input, blockers);

  try {
    const contexts = await mobilizationContextsForSource(client, input);
    for (const context of contexts) {
      const inserted = await client.query(
        `
        INSERT INTO mobilization_source_event_invalidations (
          tenant_id, source_event_id, source_fingerprint, source_event_type, source_aggregate_type, source_aggregate_id,
          work_order_version_id, crew_assignment_id, readiness_evaluation_id, status, blocker_codes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NULL, 'ignored', $9)
        ON CONFLICT DO NOTHING
        RETURNING id
        `,
        [input.tenantId, input.eventId, sourceFingerprint, input.eventType, input.aggregateType, input.aggregateId, context.work_order_version_id, context.crew_assignment_id, blockers.map((blocker) => blocker.code)],
      );
      if (!inserted.rows[0]) continue;

      const prior = await client.query(
        "SELECT * FROM mobilization_readiness_evaluations WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true",
        [input.tenantId, context.work_order_version_id, context.crew_assignment_id],
      );
      const priorEvaluation = prior.rows[0];
      if (priorEvaluation) await client.query("UPDATE mobilization_readiness_evaluations SET current = false WHERE tenant_id = $1 AND id = $2", [input.tenantId, priorEvaluation.id]);
      const evaluation = await client.query(
        `
        INSERT INTO mobilization_readiness_evaluations (
          tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id,
          crew_assignment_id, crew_id, vehicle_assignment_id, map_work_package_ref, project_timezone,
          overall_status, passed_check_count, blocker_count, warning_count, supersedes_evaluation_id,
          triggered_by, actor_user_id, correlation_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'blocked',0,$12,0,$13,'source_event',$14,$15)
        RETURNING *
        `,
        [
          input.tenantId,
          context.project_id,
          context.work_order_id,
          context.work_order_version_id,
          context.organization_id,
          context.capacity_provider_id,
          context.crew_assignment_id,
          context.crew_id,
          context.vehicle_assignment_id,
          context.map_work_package_ref,
          context.project_timezone,
          blockers.length,
          priorEvaluation?.id ?? null,
          input.actorUserId,
          input.eventId,
        ],
      );
      const evaluationRow = evaluation.rows[0];
      if (priorEvaluation) await client.query("UPDATE mobilization_readiness_evaluations SET superseded_by_evaluation_id = $3 WHERE tenant_id = $1 AND id = $2", [input.tenantId, priorEvaluation.id, evaluationRow.id]);
      for (const blocker of blockers) {
        await client.query(
          `
          INSERT INTO mobilization_readiness_check_results (
            tenant_id, evaluation_id, requirement_code, requirement_category, status, severity, override_policy,
            external_code, internal_detail, external_detail, source_type, source_record_id, source_observed_state
          )
          VALUES ($1,$2,$3,$4,'failed','blocker','non_overrideable',$3,$5,$6,$7,$8,$9)
          ON CONFLICT (tenant_id, evaluation_id, requirement_code) DO NOTHING
          `,
          [input.tenantId, evaluationRow.id, blocker.code, blocker.category, blocker.internal, blocker.external, blocker.sourceType, blocker.sourceRecordId, blocker.observedState],
        );
      }
      await appendEventAuditAndActions(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "mobilization_readiness.source_event_invalidate",
        aggregateType: "mobilization_readiness",
        entityType: "mobilization_readiness",
        entityId: evaluationRow.id,
        eventType: "mobilization_readiness.changed",
        beforeState: priorEvaluation ? { id: priorEvaluation.id, overall_status: priorEvaluation.overall_status } : undefined,
        afterState: safeSourceEvaluation(evaluationRow, blockers),
        systemActions: [{ actionType: "mobilization_readiness.changed.processed", payload: { source_event_id: input.eventId } }],
      });

      const decision = await holdMobilizationForSourceEvent(client, input, context, evaluationRow.id);
      await holdNoticeAndProductionStartForSourceEvent(client, input, context);
      await client.query(
        "UPDATE mobilization_source_event_invalidations SET readiness_evaluation_id = $5, mobilization_decision_id = $6, status = 'blocked' WHERE tenant_id = $1 AND source_fingerprint = $2 AND work_order_version_id = $3 AND crew_assignment_id = $4",
        [input.tenantId, sourceFingerprint, context.work_order_version_id, context.crew_assignment_id, evaluationRow.id, decision?.id ?? null],
      );
    }
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return;
    throw error;
  }
}

function sourceBlockers(input: SourceInvalidationInput): SourceBlocker[] {
  const state = String(value(input.afterState, "status") ?? value(input.afterState, "review_status") ?? value(input.afterState, "qualification_status") ?? input.eventType);
  const sourceType = input.aggregateType;
  const sourceRecordId = stringValue(value(input.afterState, "id")) ?? input.aggregateId;
  if (input.eventType === "partner_insurance_policy.rejected" || input.eventType === "partner_insurance_policy.returned" || input.eventType === "partner_insurance_policy.expired") return [blocker("partner_compliance_ready", "partner_compliance", "Partner compliance is blocked by insurance status.", sourceType, sourceRecordId, state)];
  if (input.eventType === "partner_company_profile.rejected" || input.eventType === "partner_company_profile.returned" || input.eventType === "partner_w9.rejected" || input.eventType === "partner_w9.returned" || input.eventType === "partner_payment_profile.held" || input.eventType === "partner_payment_profile.rejected" || input.eventType === "partner_payment_profile.returned") return [blocker("partner_compliance_ready", "partner_compliance", "Partner compliance is blocked.", sourceType, sourceRecordId, state)];
  if (input.eventType === "worker.suspended" || (input.eventType === "worker.reviewed" && ["inactive", "suspended"].includes(state))) return [blocker("crew_base_ready", "crew", "Assigned Crew is no longer base-ready.", sourceType, sourceRecordId, state)];
  if (input.eventType === "worker_credential.rejected" || input.eventType === "worker_credential.returned" || input.eventType === "worker_credential.expired") {
    const credentialBlockers = [blocker("crew_base_ready", "crew", "Required Worker credential is no longer verified.", sourceType, sourceRecordId, state)];
    if (value(input.afterState, "credential_type") === "driver_license") credentialBlockers.push(blocker("approved_operator", "operator", "Required driver/operator credential is no longer current.", sourceType, sourceRecordId, state));
    return credentialBlockers;
  }
  if (input.eventType === "worker_headshot.rejected" || input.eventType === "worker_headshot.returned") return [blocker("crew_base_ready", "crew", "Required Worker headshot is no longer approved.", sourceType, sourceRecordId, state)];
  if (input.eventType === "crew_membership.ended") return [blocker("crew_base_ready", "crew", "Assigned Crew membership changed.", sourceType, sourceRecordId, state), blocker("approved_foreman", "crew", "Assigned Crew Foreman must be revalidated.", sourceType, sourceRecordId, state)];
  if (input.eventType === "partner_agreement.terminated") return [blocker("msa_effective", "agreement", "Governing Master Agreement is terminated.", sourceType, sourceRecordId, state)];
  if (input.eventType === "partner_work_order.suspended" || input.eventType === "partner_work_order.terminated") return [blocker("work_order_active", "work_order", "Work Order is not active for mobilization.", sourceType, sourceRecordId, state)];
  if (input.eventType === "vehicle_assignment.return_recorded" || input.eventType === "vehicle_assignment.suspended") return [blocker("vehicle_assignment_valid", "vehicle", "Vehicle assignment is not valid for mobilization.", sourceType, sourceRecordId, state)];
  if (input.eventType === "vehicle_assignment.operator_revoked") return [blocker("approved_operator", "operator", "Required operator authorization is revoked.", sourceType, sourceRecordId, state)];
  if (input.eventType === "vehicle_assignment.inspection_expired") return [blocker("vehicle_aerial_inspection_current", "vehicle", "Required aerial inspection is expired.", sourceType, sourceRecordId, state)];
  if (input.eventType === "mobilization_override.expired" || input.eventType === "mobilization_override.revoked") return [blocker("override_expired", "override", "Mobilization override no longer satisfies the requirement.", sourceType, sourceRecordId, state)];
  if (input.eventType === "mobilization_decision.expired") return [blocker("mobilization_decision_current", "mobilization", "Mobilization decision has expired.", sourceType, sourceRecordId, state)];
  return [];
}

function blocker(code: string, category: string, external: string, sourceType: string, sourceRecordId: string, observedState: string): SourceBlocker {
  return { code, category, external, internal: `${code} invalidated by canonical source event`, sourceType, sourceRecordId, observedState };
}

function mobilizationSourceFingerprint(input: SourceInvalidationInput, blockers: SourceBlocker[]) {
  const sourceRecordIds = Array.from(new Set(blockers.map((blocker) => blocker.sourceRecordId))).sort().join(",");
  const blockerCodes = Array.from(new Set(blockers.map((blocker) => blocker.code))).sort().join(",");
  const sourceVersion = String(value(input.afterState, "source_version") ?? value(input.afterState, "version") ?? value(input.afterState, "updated_at") ?? "");
  return [input.eventType, input.aggregateType, sourceRecordIds || input.aggregateId, blockerCodes, sourceVersion].join(":");
}

async function mobilizationContextsForSource(client: PoolClient, input: SourceInvalidationInput): Promise<MobilizationInvalidationContext[]> {
  const organizationId = stringValue(value(input.afterState, "organization_id"));
  const workerId = input.aggregateType === "worker" ? input.aggregateId : stringValue(value(input.afterState, "worker_id"));
  const crewId = stringValue(value(input.afterState, "crew_id"));
  const workOrderVersionId = input.aggregateType === "partner_work_order" ? stringValue(value(input.afterState, "id")) ?? input.aggregateId : stringValue(value(input.afterState, "work_order_version_id"));
  const agreementVersionId = stringValue(value(input.afterState, "version_id")) ?? (input.aggregateType === "partner_agreement" ? input.aggregateId : null);
  const vehicleAssignmentId = stringValue(value(input.afterState, "vehicle_assignment_id")) ?? (input.aggregateType === "vehicle_assignment" ? input.aggregateId : null);

  const result = await client.query<MobilizationInvalidationContext>(
    `
    WITH affected AS (
      SELECT wov.id AS work_order_version_id
      FROM partner_work_order_versions wov
      WHERE wov.tenant_id = $1 AND (($2::uuid IS NOT NULL AND wov.organization_id = $2::uuid) OR ($5::uuid IS NOT NULL AND wov.id = $5::uuid) OR ($6::uuid IS NOT NULL AND wov.governing_agreement_version_id = $6::uuid))
      UNION
      SELECT wov.id
      FROM partner_work_order_versions wov
      JOIN partner_crew_memberships pcm ON pcm.tenant_id = wov.tenant_id AND pcm.organization_id = wov.organization_id AND pcm.crew_id = wov.assigned_crew_id
      WHERE wov.tenant_id = $1 AND $3::uuid IS NOT NULL AND pcm.worker_id = $3::uuid
      UNION
      SELECT wov.id
      FROM partner_work_order_versions wov
      WHERE wov.tenant_id = $1 AND $4::uuid IS NOT NULL AND wov.assigned_crew_id = $4::uuid
      UNION
      SELECT pva.work_order_version_id
      FROM partner_vehicle_assignments pva
      WHERE pva.tenant_id = $1 AND $7::uuid IS NOT NULL AND pva.id = $7::uuid
    )
    SELECT DISTINCT
      wov.project_id,
      wov.work_order_id,
      wov.id AS work_order_version_id,
      wov.organization_id,
      wov.capacity_provider_id,
      ca.id AS crew_assignment_id,
      ca.crew_id,
      pva.id AS vehicle_assignment_id,
      wov.map_work_package_ref,
      'America/New_York' AS project_timezone
    FROM affected
    JOIN partner_work_order_versions wov ON wov.tenant_id = $1 AND wov.id = affected.work_order_version_id
    JOIN projects p ON p.tenant_id = wov.tenant_id AND p.id = wov.project_id
    JOIN partner_work_order_crew_assignments ca ON ca.tenant_id = wov.tenant_id AND ca.work_order_version_id = wov.id AND ca.organization_id = wov.organization_id AND ca.crew_id = wov.assigned_crew_id AND ca.status = 'active'
    LEFT JOIN partner_vehicle_assignments pva ON pva.tenant_id = wov.tenant_id AND pva.work_order_version_id = wov.id AND pva.organization_id = wov.organization_id AND pva.crew_id = ca.crew_id AND pva.deleted_at IS NULL
    WHERE wov.deleted_at IS NULL
    `,
    [input.tenantId, organizationId, workerId, crewId, workOrderVersionId, agreementVersionId, vehicleAssignmentId],
  );
  return result.rows;
}

async function holdMobilizationForSourceEvent(client: PoolClient, input: SourceInvalidationInput, context: MobilizationInvalidationContext, evaluationId: string) {
  const current = await client.query(
    "SELECT * FROM mobilization_decisions WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true",
    [input.tenantId, context.work_order_version_id, context.crew_assignment_id],
  );
  const row = current.rows[0];
  if (!row || ["hold", "revoked"].includes(String(row.decision))) return null;
  await client.query("UPDATE mobilization_decisions SET current = false WHERE tenant_id = $1 AND id = $2", [input.tenantId, row.id]);
  const inserted = await client.query(
    "INSERT INTO mobilization_decisions (tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_assignment_id, crew_id, vehicle_assignment_id, readiness_evaluation_id, decision, authorized_by_user_id, revocation_reason, supersedes_decision_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'hold',$11,$12,$13) RETURNING *",
    [input.tenantId, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.capacity_provider_id, context.crew_assignment_id, context.crew_id, context.vehicle_assignment_id, evaluationId, input.actorUserId, `source_event:${input.eventType}`, row.id],
  );
  await appendEventAuditAndActions(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "mobilization.source_event_hold",
    aggregateType: "mobilization_decision",
    entityType: "mobilization_decision",
    entityId: inserted.rows[0].id,
    eventType: "mobilization.held",
    beforeState: safeDecision(row),
    afterState: safeDecision(inserted.rows[0]),
    systemActions: [{ actionType: "mobilization.held.processed", payload: { source_event_id: input.eventId } }],
  });
  return inserted.rows[0];
}

async function holdNoticeAndProductionStartForSourceEvent(client: PoolClient, input: SourceInvalidationInput, context: MobilizationInvalidationContext) {
  const notice = await client.query(
    "UPDATE notice_to_proceed_versions SET status = 'held', production_start_status = 'held', hold_reason = $4 WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true AND status IN ('issued','acknowledged','scheduled','authorized') RETURNING *",
    [input.tenantId, context.work_order_version_id, context.crew_assignment_id, `source_event:${input.eventType}`],
  );
  const start = await client.query(
    "UPDATE production_start_authorizations SET authorization_status = 'held' WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true AND authorization_status IN ('scheduled','authorized') RETURNING *",
    [input.tenantId, context.work_order_version_id, context.crew_assignment_id],
  );
  if (notice.rows[0]) {
    await appendEventAuditAndActions(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "notice_to_proceed.source_event_hold",
      aggregateType: "notice_to_proceed",
      entityType: "notice_to_proceed",
      entityId: notice.rows[0].id,
      eventType: "notice_to_proceed.held",
      afterState: { id: notice.rows[0].id, status: notice.rows[0].status, production_start_status: notice.rows[0].production_start_status, hold_reason: `source_event:${input.eventType}` },
      systemActions: [{ actionType: "notice_to_proceed.held.processed", payload: { source_event_id: input.eventId } }],
    });
  }
  if (start.rows[0]) {
    await appendEventAuditAndActions(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "production_start.source_event_hold",
      aggregateType: "production_start",
      entityType: "production_start_authorization",
      entityId: start.rows[0].id,
      eventType: "production_start.held",
      afterState: { id: start.rows[0].id, authorization_status: start.rows[0].authorization_status },
      systemActions: [{ actionType: "production_start.held.processed", payload: { source_event_id: input.eventId } }],
    });
  }
}

function safeSourceEvaluation(row: Record<string, unknown>, blockers: SourceBlocker[]) {
  return {
    id: row.id,
    work_order_version_id: row.work_order_version_id,
    crew_assignment_id: row.crew_assignment_id,
    organization_id: row.organization_id,
    overall_status: row.overall_status,
    blocker_count: row.blocker_count,
    blockers: blockers.map((blocker) => ({ requirement_code: blocker.code, category: blocker.category, external_detail: blocker.external, source_type: blocker.sourceType, source_record_id: blocker.sourceRecordId })),
  };
}

function safeDecision(row: Record<string, unknown>) {
  return { id: row.id, decision: row.decision, readiness_evaluation_id: row.readiness_evaluation_id, revocation_reason: row.revocation_reason };
}

function value(record: Record<string, unknown>, key: string) {
  return record[key];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
