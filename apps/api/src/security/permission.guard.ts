import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, MethodNotAllowedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Pool } from "pg";
import type { PermissionKey } from "@syncos/permissions";
import { DATABASE_POOL } from "../modules/database.module";
import { IS_PUBLIC_ROUTE } from "./public.decorator";
import { REQUIRED_PERMISSION } from "./require-permission.decorator";

const partnerScopedPermissions = new Set<PermissionKey>(["partner_context.read", "partner_profile.read", "partner_actions.read"]);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]) === true) {
      return true;
    }

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
    const scopeType = this.getScopeType(request);
    const scopeId = this.getScopeId(request);
    const isPartnerScopedPermission = partnerScopedPermissions.has(permission);
    const hasExplicitScopeHeader = Boolean(request.header("x-scope-type") || request.header("x-scope-id"));
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
            (
              $6::boolean = true
              AND ur.scope_type = 'organization'
              AND ur.scope_id IS NOT NULL
              AND (
                $7::boolean = false
                OR (ur.scope_type = $4 AND ur.scope_id::text = $5)
              )
            )
            OR (
              $6::boolean = false
              AND (
                ur.scope_type = 'tenant'
                OR (ur.scope_type = $4 AND ur.scope_id::text = $5)
              )
            )
          )
      ) AS allowed
      `,
      [
        request.auth.tenantId,
        request.auth.userId,
        permission,
        scopeType,
        scopeId,
        isPartnerScopedPermission,
        hasExplicitScopeHeader,
      ],
    );

    if (!result.rows[0]?.allowed) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return true;
  }

  private getScopeType(request: Request): string {
    const value = request.header("x-scope-type");
    return value && ["organization", "territory", "project", "customer", "contractor", "tenant"].includes(value)
      ? value
      : "tenant";
  }

  private getScopeId(request: Request & { auth?: { tenantId: string } }): string {
    return request.header("x-scope-id") ?? request.auth?.tenantId ?? "";
  }
}
