import type { PoolClient } from "pg";

export type AuditLogEntry = {
  tenantId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
};

export type CreateAuditLogInput = Omit<AuditLogEntry, "createdAt"> & {
  createdAt?: Date;
};

export function createAuditLogEntry(input: CreateAuditLogInput): AuditLogEntry {
  return {
    ...input,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date(),
  };
}

export async function appendAuditLog(client: PoolClient, input: CreateAuditLogInput): Promise<AuditLogEntry> {
  const entry = createAuditLogEntry(input);
  await client.query(
    `
    INSERT INTO audit_logs (
      tenant_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_state,
      after_state,
      metadata,
      request_id,
      ip_address,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      entry.tenantId,
      entry.actorUserId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.beforeState ?? null,
      entry.afterState ?? null,
      entry.metadata ?? {},
      entry.requestId ?? null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ],
  );
  return entry;
}
