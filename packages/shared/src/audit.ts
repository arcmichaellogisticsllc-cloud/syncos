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
