import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, MethodNotAllowedException } from "@nestjs/common";
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
      const request = context.switchToHttp().getRequest<Request>();
      const method = request.method.toUpperCase();
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new MethodNotAllowedException("Write routes must declare explicit permission metadata");
      }
      throw new ForbiddenException("Protected routes must declare explicit permission metadata");
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
          AND (
            ur.scope_type = 'tenant'
            OR (ur.scope_type = $4 AND ur.scope_id = $5)
          )
      ) AS allowed
      `,
      [
        request.auth.tenantId,
        request.auth.userId,
        permission,
        this.getScopeType(request),
        this.getScopeId(request),
      ],
    );

    if (!result.rows[0]?.allowed) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return true;
  }

  private getScopeType(request: Request): string {
    const value = request.header("x-scope-type");
    return value && ["organization", "territory", "project", "customer", "contractor"].includes(value)
      ? value
      : "tenant";
  }

  private getScopeId(request: Request & { auth?: { tenantId: string } }): string {
    return request.header("x-scope-id") ?? request.auth?.tenantId ?? "";
  }
}
