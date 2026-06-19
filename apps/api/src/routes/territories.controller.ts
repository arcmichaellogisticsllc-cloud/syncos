import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireString } from "./intelligence.types";

@Controller("territories")
export class TerritoriesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("territory.read")
  async list(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "territories", request.auth.tenantId, { searchColumns: ["name", "code"] }));
  }

  @Get(":id")
  @RequirePermission("territory.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.requireRecord(request.auth.tenantId, id);
  }

  @Post()
  @RequirePermission("territory.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "territory name is required");
      return await this.write(request, "territory.create", "territory.created", async (client) => {
        const territory = await insertTenantRecord(client, "territories", request.auth.tenantId, {
          name,
          code: body.code,
          parent_territory_id: body.parent_territory_id,
          status: "active",
        });
        return { entityType: "territory", entityId: territory.id, afterState: territory };
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch(":id")
  @RequirePermission("territory.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "territory.update", "territory.updated", async (client) => {
      const before = await findTenantRecordById(client, "territories", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("territory not found");
      const after = await updateTenantRecord(client, "territories", request.auth.tenantId, id, pick(body, ["name", "code", "parent_territory_id", "status"]));
      if (!after) throw new NotFoundException("territory not found");
      return { entityType: "territory", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/archive")
  @RequirePermission("territory.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "territory.archive", "territory.archived", async (client) => {
      const before = await findTenantRecordById(client, "territories", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("territory not found");
      const after = await updateTenantRecord(client, "territories", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("territory not found");
      return { entityType: "territory", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async requireRecord(tenantId: string, id: string) {
    const record = await this.withClient((client) => findTenantRecordById(client, "territories", tenantId, id));
    if (!record) throw new NotFoundException("territory not found");
    return record;
  }

  private async write(request: AuthenticatedRequest, action: string, eventType: string, write: Parameters<typeof executeWriteAction>[1]["write"]) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType: "territory",
        eventType,
        write,
      });
    } finally {
      client.release();
    }
  }

  private async withClient<T>(callback: (client: import("pg").PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
