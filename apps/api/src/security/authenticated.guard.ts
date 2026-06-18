import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { auth?: unknown }>();
    const tenantId = request.header("x-tenant-id");
    const userId = request.header("x-user-id");

    if (!tenantId || !userId) {
      throw new UnauthorizedException("x-tenant-id and x-user-id headers are required");
    }

    request.auth = { tenantId, userId };
    return true;
  }
}
