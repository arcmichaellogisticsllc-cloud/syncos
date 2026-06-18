import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_ROUTE } from "./public.decorator";

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
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]) === true) {
      return true;
    }

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
