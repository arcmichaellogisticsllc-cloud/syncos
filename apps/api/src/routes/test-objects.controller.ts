import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { executeWriteAction } from "@syncos/shared";
import { AuthenticatedGuard } from "../security/authenticated.guard";
import { PermissionGuard } from "../security/permission.guard";
import { RequirePermission } from "../security/require-permission.decorator";
import { TenantIsolationGuard } from "../security/tenant-isolation.guard";
import { DATABASE_POOL } from "../modules/database.module";

type AuthenticatedRequest = Request & {
  auth: {
    tenantId: string;
    userId: string;
  };
};

@Controller("test-objects")
@UseGuards(AuthenticatedGuard, TenantIsolationGuard, PermissionGuard)
export class TestObjectsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Post()
  @RequirePermission("system.test_object.write")
  async create(@Req() request: AuthenticatedRequest, @Body() body: { name?: string }) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action: "test_object.create",
        aggregateType: "test_object",
        eventType: "test_object.created",
        audit: { requestId: request.header("x-request-id") },
        systemActions: [{ actionType: "test_object.created.demo" }],
        write: async (transaction) => {
          const objectResult = await transaction.query<{ id: string; name: string }>(
            "INSERT INTO test_objects (tenant_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id, name",
            [request.auth.tenantId, body.name ?? "Sprint 0 test object", request.auth.userId],
          );
          const object = objectResult.rows[0];
          return {
            entityType: "test_object",
            entityId: object.id,
            afterState: object,
          };
        },
      });
    } catch (error) {
      throw error;
    } finally {
      client.release();
    }
  }
}
