import type { PoolClient } from "pg";
import { appendAuditLog, type CreateAuditLogInput } from "./audit";

export type WriteActionResult<T> = {
  entityType: string;
  entityId: string;
  afterState: T;
  beforeState?: Record<string, unknown>;
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
        result.entityId,
        input.eventType,
        input.actorUserId,
        { action: input.action, entityType: result.entityType },
      ],
    );

    await client.query("INSERT INTO event_payloads (event_id, payload) VALUES ($1, $2)", [
      eventResult.rows[0].id,
      result.afterState,
    ]);

    await appendAuditLog(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: result.entityType,
      entityId: result.entityId,
      beforeState: result.beforeState,
      afterState: result.afterState as Record<string, unknown>,
      ...input.audit,
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

    await client.query("COMMIT");
    return result.afterState;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
