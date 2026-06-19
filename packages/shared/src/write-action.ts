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
}

function structuredLog(category: "Event" | "Audit", message: string, context: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), category, message, ...context })}\n`);
}
