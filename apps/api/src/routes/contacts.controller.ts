import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireOne } from "./intelligence.types";

@Controller("contacts")
export class ContactsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("contact.read")
  async list(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "contacts", request.auth.tenantId, { searchColumns: ["full_name", "first_name", "last_name", "email", "phone"] }));
  }

  @Get(":id")
  @RequirePermission("contact.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const record = await this.withClient((client) => findTenantRecordById(client, "contacts", request.auth.tenantId, id));
    if (!record) throw new NotFoundException("contact not found");
    return record;
  }

  @Post()
  @RequirePermission("contact.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      requireOne([body.full_name, body.first_name, body.last_name], "contact name is required");
      return await this.write(request, "contact.create", "contact.created", async (client) => {
        await this.requireOrganization(client, request.auth.tenantId, body.organization_id);
        const contact = await insertTenantRecord(client, "contacts", request.auth.tenantId, {
          organization_id: body.organization_id,
          first_name: body.first_name,
          last_name: body.last_name,
          full_name: body.full_name ?? [body.first_name, body.last_name].filter(Boolean).join(" "),
          title: body.title,
          email: body.email,
          phone: body.phone,
          mobile: body.mobile,
          linkedin_url: body.linkedin_url,
          status: body.status ?? "discovered",
        });
        return { entityType: "contact", entityId: contact.id, afterState: contact };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch(":id")
  @RequirePermission("contact.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "contact.update", "contact.updated", async (client) => {
        if (body.organization_id) await this.requireOrganization(client, request.auth.tenantId, body.organization_id);
        const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("contact not found");
        const after = await updateTenantRecord(
          client,
          "contacts",
          request.auth.tenantId,
          id,
          pick(body, ["organization_id", "first_name", "last_name", "full_name", "title", "email", "phone", "mobile", "linkedin_url", "status", "trust_level"]),
        );
        if (!after) throw new NotFoundException("contact not found");
        return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post(":id/verify")
  @RequirePermission("contact.verify")
  async verify(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "contact.verify", "contact.verified", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      if (![before.email, before.phone, before.mobile, before.linkedin_url].some((value) => typeof value === "string" && value.trim())) {
        throw new BadRequestException("at least one contact method is required to verify");
      }
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, {
        status: "verified",
        verification_status: "verified",
        trust_level: before.trust_level ?? 80,
        last_verified_at: new Date(),
      });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/archive")
  @RequirePermission("contact.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "contact.archive", "contact.archived", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async requireOrganization(client: PoolClient, tenantId: string, organizationId: unknown): Promise<void> {
    if (typeof organizationId !== "string" || !organizationId) throw new Error("organization_id is required");
    const organization = await findTenantRecordById(client, "organizations", tenantId, organizationId);
    if (!organization) throw new NotFoundException("organization not found in tenant");
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, { tenantId: request.auth.tenantId, actorUserId: request.auth.userId, action, aggregateType: "contact", eventType, write });
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
