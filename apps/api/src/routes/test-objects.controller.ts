import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { findTenantRecordById, insertTenantRecord } from "@syncos/database";
import { executeWriteAction } from "@syncos/shared";
import { RequirePermission } from "../security/require-permission.decorator";
import { DATABASE_POOL } from "../modules/database.module";

type AuthenticatedRequest = Request & {
  auth: {
    tenantId: string;
    userId: string;
  };
};

@Controller("test-objects")
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
          const object = await insertTenantRecord<{ id: string; name: string }>(
            transaction,
            "test_objects",
            request.auth.tenantId,
            {
              name: body.name ?? "Sprint 0 test object",
              created_by_user_id: request.auth.userId,
            },
            ["id", "name"],
          );
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

  @Get(":id")
  @RequirePermission("system.test_object.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const client = await this.pool.connect();
    try {
      const object = await findTenantRecordById(client, "test_objects", request.auth.tenantId, id);
      if (!object) {
        throw new NotFoundException("test object not found");
      }
      return object;
    } finally {
      client.release();
    }
  }
}
