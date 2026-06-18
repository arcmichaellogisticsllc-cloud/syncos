import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Pool } from "pg";
import type { PermissionKey } from "@syncos/permissions";
import { DATABASE_POOL } from "../modules/database.module";
import { REQUIRED_PERMISSION } from "./require-permission.decorator";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<PermissionKey | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { auth: { tenantId: string; userId: string } }>();
    const result = await this.pool.query<{ allowed: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM tenant_users tu
        JOIN user_roles ur ON ur.tenant_user_id = tu.id
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE tu.tenant_id = $1
          AND tu.user_id = $2
          AND tu.status = 'active'
          AND p.key = $3
      ) AS allowed
      `,
      [request.auth.tenantId, request.auth.userId, permission],
    );

    if (!result.rows[0]?.allowed) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return true;
  }
}
