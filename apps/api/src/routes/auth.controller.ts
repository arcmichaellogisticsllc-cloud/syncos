import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

@Controller("auth")
export class AuthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("me/permissions")
  @RequirePermission("signal.read")
  async permissions(@Req() request: AuthenticatedRequest) {
    const result = await this.pool.query(
      `
      SELECT
        r.name AS role_name,
        p.key AS permission_key
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id AND ur.tenant_id = tu.tenant_id
      JOIN roles r ON r.id = ur.role_id AND r.tenant_id = tu.tenant_id
      JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = tu.tenant_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active'
      ORDER BY r.name, p.key
      `,
      [request.auth.tenantId, request.auth.userId],
    );
    return {
      user_id: request.auth.userId,
      tenant_id: request.auth.tenantId,
      roles: Array.from(new Set(result.rows.map((row) => row.role_name))),
      permissions: Array.from(new Set(result.rows.map((row) => row.permission_key))),
    };
  }
}
