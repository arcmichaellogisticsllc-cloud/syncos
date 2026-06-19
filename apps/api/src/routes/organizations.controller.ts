import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireString } from "./intelligence.types";

const organizationTypes = new Set(["unknown", "carrier", "contractor", "customer", "vendor", "partner", "agency"]);

@Controller("organizations")
export class OrganizationsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("organization.read")
  async list(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "organizations", request.auth.tenantId, { searchColumns: ["name", "type", "status"] }));
  }

  @Get(":id")
  @RequirePermission("organization.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const record = await this.withClient((client) => findTenantRecordById(client, "organizations", request.auth.tenantId, id));
    if (!record) throw new NotFoundException("organization not found");
    return record;
  }

  @Post()
  @RequirePermission("organization.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "organization name is required");
      this.validateType(body.type);
      return await this.write(request, "organization.create", "organization.created", "organization", async (client) => {
        await this.validateTerritory(client, request.auth.tenantId, body.territory_id);
        const organization = await insertTenantRecord(client, "organizations", request.auth.tenantId, {
          name,
          territory_id: body.territory_id,
          type: body.type ?? "unknown",
          actor_roles: Array.isArray(body.actor_roles) ? body.actor_roles : [],
          source_name: body.source_name,
          source_url: body.source_url,
          trust_level: body.trust_level,
          status: body.status ?? "discovered",
        });
        return { entityType: "organization", entityId: organization.id, afterState: organization };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch(":id")
  @RequirePermission("organization.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      this.validateType(body.type);
      return await this.write(request, "organization.update", "organization.updated", "organization", async (client) => {
        await this.validateTerritory(client, request.auth.tenantId, body.territory_id);
        const before = await findTenantRecordById(client, "organizations", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("organization not found");
        const after = await updateTenantRecord(
          client,
          "organizations",
          request.auth.tenantId,
          id,
          pick(body, ["name", "territory_id", "type", "actor_roles", "source_name", "source_url", "trust_level", "status"]),
        );
        if (!after) throw new NotFoundException("organization not found");
        return { entityType: "organization", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post(":id/qualify")
  @RequirePermission("organization.qualify")
  async qualify(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "organization.qualify", "organization.qualified", "organization", async (client) => {
      const before = await findTenantRecordById(client, "organizations", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("organization not found");
      if (!before.type || before.type === "unknown") throw new BadRequestException("organization type is required to qualify");
      if (!Array.isArray(before.actor_roles) || before.actor_roles.length === 0) throw new BadRequestException("actor role is required to qualify");
      if (!before.territory_id) throw new BadRequestException("territory or region is required to qualify");
      if (!before.source_name && !before.source_url) throw new BadRequestException("source or trust data is required to qualify");
      const after = await updateTenantRecord(client, "organizations", request.auth.tenantId, id, { status: "qualified" });
      if (!after) throw new NotFoundException("organization not found");
      return { entityType: "organization", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/archive")
  @RequirePermission("organization.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "organization.archive", "organization.archived", "organization", async (client) => {
      const before = await findTenantRecordById(client, "organizations", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("organization not found");
      const after = await updateTenantRecord(client, "organizations", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("organization not found");
      return { entityType: "organization", entityId: id, beforeState: before, afterState: after };
    });
  }

  private validateType(value: unknown): void {
    if (value !== undefined && (typeof value !== "string" || !organizationTypes.has(value))) {
      throw new Error("organization type is invalid");
    }
  }

  private async validateTerritory(client: PoolClient, tenantId: string, territoryId: unknown): Promise<void> {
    if (!territoryId) return;
    if (typeof territoryId !== "string") throw new Error("territory_id must be a string");
    const territory = await findTenantRecordById(client, "territories", tenantId, territoryId);
    if (!territory) throw new NotFoundException("territory not found in tenant");
  }

  private async write<T>(
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
  ) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, { tenantId: request.auth.tenantId, actorUserId: request.auth.userId, action, aggregateType, eventType, write });
    } finally {
      client.release();
    }
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
