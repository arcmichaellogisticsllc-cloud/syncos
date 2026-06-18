import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@syncos/permissions";

export const REQUIRED_PERMISSION = "requiredPermission";

export function RequirePermission(permission: PermissionKey) {
  return SetMetadata(REQUIRED_PERMISSION, permission);
}
