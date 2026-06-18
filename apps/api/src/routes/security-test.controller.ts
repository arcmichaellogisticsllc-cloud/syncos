import { Controller, Post, UseGuards } from "@nestjs/common";
import { AuthenticatedGuard } from "../security/authenticated.guard";
import { PermissionGuard } from "../security/permission.guard";
import { TenantIsolationGuard } from "../security/tenant-isolation.guard";

@Controller("security-test")
@UseGuards(AuthenticatedGuard, TenantIsolationGuard, PermissionGuard)
export class SecurityTestController {
  @Post("missing-permission")
  missingPermissionMetadata() {
    return { shouldNotReach: true };
  }
}
