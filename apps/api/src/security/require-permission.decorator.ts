import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@syncos/permissions";

export const REQUIRED_PERMISSION = "requiredPermission";

export function RequirePermission(permission: PermissionKey) {
  return SetMetadata(REQUIRED_PERMISSION, permission);
}

// Directory/admin endpoints without object-scope filtering require tenant-wide grants.
export const TENANT_PERMISSION_ONLY = "tenantPermissionOnly";
export function TenantPermissionOnly() { return SetMetadata(TENANT_PERMISSION_ONLY, true); }
