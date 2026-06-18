import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

type TenantScopedRequest = Request & {
  auth: {
    tenantId: string;
    userId: string;
  };
  body?: {
    tenantId?: string;
  };
  query: {
    tenantId?: string;
  };
};

@Injectable()
export class TenantIsolationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const bodyTenantId = request.body?.tenantId;
    const queryTenantId = request.query.tenantId;

    if (bodyTenantId && bodyTenantId !== request.auth.tenantId) {
      throw new ForbiddenException("body tenantId does not match authenticated tenant");
    }

    if (queryTenantId && queryTenantId !== request.auth.tenantId) {
      throw new ForbiddenException("query tenantId does not match authenticated tenant");
    }

    return true;
  }
}
