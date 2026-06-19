import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Pool } from "pg";
import { verifyAuthToken } from "@syncos/auth";
import { logStructured } from "../instrumentation/structured-logger";
import { DATABASE_POOL } from "../modules/database.module";
import { IS_PUBLIC_ROUTE } from "./public.decorator";

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { auth?: unknown }>();
    const claims = this.getClaims(request);

    const membership = await this.pool.query<{ user_id: string; tenant_id: string; email: string }>(
      `
      SELECT u.id AS user_id, tu.tenant_id, u.email
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id
      JOIN tenants t ON t.id = tu.tenant_id
      WHERE u.id = $1
        AND tu.tenant_id = $2
        AND u.status = 'active'
        AND tu.status = 'active'
        AND t.status = 'active'
        AND u.deleted_at IS NULL
        AND tu.deleted_at IS NULL
        AND t.deleted_at IS NULL
      `,
      [claims.sub, claims.tenant_id],
    );

    if (!membership.rows[0]) {
      logStructured("Security", "authenticated_user_not_active_in_tenant", { userId: claims.sub, tenantId: claims.tenant_id });
      throw new UnauthorizedException("Authenticated user is not active in tenant");
    }

    request.auth = {
      tenantId: membership.rows[0].tenant_id,
      userId: membership.rows[0].user_id,
      email: membership.rows[0].email,
    };
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]) === true;
  }

  private getClaims(request: Request) {
    const authorization = request.header("authorization");
    if (authorization?.startsWith("Bearer ")) {
      const secret = process.env.AUTH_JWT_SECRET;
      if (!secret) {
        throw new UnauthorizedException("AUTH_JWT_SECRET is required");
      }
      try {
        return verifyAuthToken(authorization.slice("Bearer ".length), secret);
      } catch {
        logStructured("Security", "invalid_auth_token");
        throw new UnauthorizedException("Invalid auth token");
      }
    }

    if (process.env.ALLOW_DEV_HEADER_AUTH === "true" && process.env.NODE_ENV !== "production") {
      const tenantId = request.header("x-tenant-id");
      const userId = request.header("x-user-id");
      if (tenantId && userId) {
        return { sub: userId, tenant_id: tenantId };
      }
    }

    logStructured("Security", "missing_bearer_token");
    throw new UnauthorizedException("Bearer token is required");
  }
}
