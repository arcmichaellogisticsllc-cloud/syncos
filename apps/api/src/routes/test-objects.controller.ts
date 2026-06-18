import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { appendAuditLog } from "@syncos/shared";
import { createDomainEvent } from "@syncos/events";
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
      await client.query("BEGIN");
      const objectResult = await client.query<{ id: string; name: string }>(
        "INSERT INTO test_objects (tenant_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id, name",
        [request.auth.tenantId, body.name ?? "Sprint 0 test object", request.auth.userId],
      );
      const object = objectResult.rows[0];

      const event = createDomainEvent({
        tenantId: request.auth.tenantId,
        aggregateType: "test_object",
        aggregateId: object.id,
        eventType: "test_object.created",
        actorUserId: request.auth.userId,
        payload: object,
      });

      const eventResult = await client.query<{ id: string }>(
        `
        INSERT INTO events (
          tenant_id,
          aggregate_type,
          aggregate_id,
          event_type,
          actor_user_id,
          audit_context
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        `,
        [
          event.tenantId,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          event.actorUserId,
          { action: "test_object.create", route: "POST /test-objects" },
        ],
      );
      await client.query(
        "INSERT INTO event_payloads (event_id, payload) VALUES ($1, $2)",
        [eventResult.rows[0].id, event.payload],
      );
      await appendAuditLog(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action: "test_object.create",
        entityType: "test_object",
        entityId: object.id,
        afterState: object,
      });
      await client.query("COMMIT");
      return object;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
