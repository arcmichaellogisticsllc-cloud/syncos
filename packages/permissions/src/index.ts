export type PermissionKey =
  | "tenants.read"
  | "tenants.write"
  | "users.read"
  | "users.write"
  | "roles.read"
  | "roles.write"
  | "permissions.read"
  | "events.read"
  | "audit_logs.read";

export type PermissionCheck = {
  tenantId: string;
  userId: string;
  permission: PermissionKey;
  entityType?: string;
  entityId?: string;
};

export type PermissionDecision = {
  allowed: boolean;
  reason?: string;
};

export function deny(reason: string): PermissionDecision {
  return { allowed: false, reason };
}

export function allow(): PermissionDecision {
  return { allowed: true };
}
