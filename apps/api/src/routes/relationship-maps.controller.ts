import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, positiveInteger, requireAllowed, requireString } from "./intelligence.types";

const relationshipMapStatuses = new Set([
  "no_path",
  "weak_path",
  "identified_path",
  "introduction_requested",
  "conversation_opened",
  "relationship_active",
  "archived",
]);
const relationshipPathStatuses = new Set(["proposed", "active", "inactive", "archived"]);

@Controller()
export class RelationshipMapsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("relationship-maps")
  @RequirePermission("relationship_map.read")
  async listMaps(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "relationship_maps", request.auth.tenantId, { searchColumns: ["name", "status"] }));
  }

  @Get("relationship-maps/:id")
  @RequirePermission("relationship_map.read")
  async findMap(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const map = await this.withClient((client) => findTenantRecordById(client, "relationship_maps", request.auth.tenantId, id));
    if (!map) throw new NotFoundException("relationship map not found");
    return map;
  }

  @Post("relationship-maps")
  @RequirePermission("relationship_map.create")
  async createMap(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "relationship map name is required");
      const status = body.status === undefined ? "no_path" : requireAllowed(body.status, relationshipMapStatuses, "relationship map status");
      return await this.write(request, "relationship_map.create", "relationship_map.created", "relationship_map", async (client) => {
        await this.requireOrganization(client, request.auth.tenantId, body.target_organization_id);
        await this.validateTargetContact(client, request.auth.tenantId, body.target_contact_id, body.target_organization_id);
        await this.validateTargetObject(client, request.auth.tenantId, body.target_object_type, body.target_object_id);
        const map = await insertTenantRecord(client, "relationship_maps", request.auth.tenantId, {
          name,
          root_entity_type: body.root_entity_type,
          root_entity_id: body.root_entity_id,
          target_organization_id: body.target_organization_id,
          target_contact_id: body.target_contact_id,
          target_object_type: body.target_object_type,
          target_object_id: body.target_object_id,
          status,
        });
        return { entityType: "relationship_map", entityId: map.id, afterState: map };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("relationship-maps/:id")
  @RequirePermission("relationship_map.update")
  async updateMap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "relationship_map.update", "relationship_map.updated", "relationship_map", async (client) => {
        const before = await this.requireMap(client, request.auth.tenantId, id);
        const targetOrganizationId = body.target_organization_id ?? before.target_organization_id;
        if (body.target_organization_id) await this.requireOrganization(client, request.auth.tenantId, body.target_organization_id);
        await this.validateTargetContact(client, request.auth.tenantId, body.target_contact_id, targetOrganizationId);
        await this.validateTargetObject(client, request.auth.tenantId, body.target_object_type, body.target_object_id);
        const after = await updateTenantRecord(client, "relationship_maps", request.auth.tenantId, id, pick(body, [
          "name",
          "root_entity_type",
          "root_entity_id",
          "target_organization_id",
          "target_contact_id",
          "target_object_type",
          "target_object_id",
        ]));
        if (!before || !after) throw new NotFoundException("relationship map not found");
        return { entityType: "relationship_map", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-maps/:id/status")
  @RequirePermission("relationship_map.status")
  async setMapStatus(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const status = requireAllowed(body.status, relationshipMapStatuses, "relationship map status");
      return await this.write(request, "relationship_map.status", "relationship_map.status_changed", "relationship_map", async (client) => {
        const before = await findTenantRecordById(client, "relationship_maps", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("relationship map not found");
        const after = await updateTenantRecord(client, "relationship_maps", request.auth.tenantId, id, { status });
        if (!after) throw new NotFoundException("relationship map not found");
        return { entityType: "relationship_map", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-maps/:id/archive")
  @RequirePermission("relationship_map.archive")
  async archiveMap(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "relationship_map.archive", "relationship_map.archived", "relationship_map", async (client) => {
      const before = await findTenantRecordById(client, "relationship_maps", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("relationship map not found");
      const after = await updateTenantRecord(client, "relationship_maps", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("relationship map not found");
      return { entityType: "relationship_map", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("relationship-maps/:id/paths")
  @RequirePermission("relationship_path.read")
  async listPaths(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireMap(client, request.auth.tenantId, id);
      const result = await client.query("SELECT * FROM relationship_paths WHERE tenant_id = $1 AND relationship_map_id = $2 AND deleted_at IS NULL ORDER BY rank NULLS LAST, created_at DESC", [request.auth.tenantId, id]);
      return result.rows;
    });
  }

  @Post("relationship-maps/:id/paths")
  @RequirePermission("relationship_path.create")
  async createPath(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const strength = optionalScore(body.strength_score, "strength_score");
      const confidence = optionalScore(body.confidence_score, "confidence_score");
      const rank = body.rank === undefined ? undefined : positiveInteger(body.rank, "rank");
      const status = body.status === undefined ? "proposed" : requireAllowed(body.status, relationshipPathStatuses, "relationship path status");
      return await this.write(request, "relationship_path.create", "relationship_path.created", "relationship_path", async (client) => {
        await this.requireMap(client, request.auth.tenantId, id);
        await this.validateContact(client, request.auth.tenantId, body.from_contact_id);
        await this.validateContact(client, request.auth.tenantId, body.to_contact_id);
        await this.validateIntermediaries(client, request.auth.tenantId, body.intermediary_contact_ids);
        const path = await insertTenantRecord(client, "relationship_paths", request.auth.tenantId, {
          relationship_map_id: id,
          source_entity_type: body.source_entity_type,
          source_entity_id: body.source_entity_id,
          target_entity_type: body.target_entity_type,
          target_entity_id: body.target_entity_id,
          from_contact_id: body.from_contact_id,
          to_contact_id: body.to_contact_id,
          intermediary_contact_ids: Array.isArray(body.intermediary_contact_ids) ? body.intermediary_contact_ids : [],
          strength_score: strength,
          confidence_score: confidence,
          rank,
          status,
          score: confidence ?? strength,
          path: body.path ?? [],
        });
        return { entityType: "relationship_path", entityId: path.id, afterState: path };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("relationship-paths/:id")
  @RequirePermission("relationship_path.update")
  async updatePath(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["source_entity_type", "source_entity_id", "target_entity_type", "target_entity_id", "from_contact_id", "to_contact_id", "intermediary_contact_ids", "status", "path"]);
      if (body.strength_score !== undefined) values.strength_score = optionalScore(body.strength_score, "strength_score");
      if (body.confidence_score !== undefined) values.confidence_score = optionalScore(body.confidence_score, "confidence_score");
      if (body.rank !== undefined) values.rank = positiveInteger(body.rank, "rank");
      if (body.status !== undefined) values.status = requireAllowed(body.status, relationshipPathStatuses, "relationship path status");
      return await this.write(request, "relationship_path.update", "relationship_path.updated", "relationship_path", async (client) => {
        await this.validateContact(client, request.auth.tenantId, body.from_contact_id);
        await this.validateContact(client, request.auth.tenantId, body.to_contact_id);
        await this.validateIntermediaries(client, request.auth.tenantId, body.intermediary_contact_ids);
        const before = await findTenantRecordById(client, "relationship_paths", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("relationship path not found");
        const after = await updateTenantRecord(client, "relationship_paths", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("relationship path not found");
        return { entityType: "relationship_path", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-paths/:id/rank")
  @RequirePermission("relationship_path.rank")
  async rankPath(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const rank = positiveInteger(body.rank, "rank");
      return await this.write(request, "relationship_path.rank", "relationship_path.ranked", "relationship_path", async (client) => {
        const before = await findTenantRecordById(client, "relationship_paths", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("relationship path not found");
        const after = await updateTenantRecord(client, "relationship_paths", request.auth.tenantId, id, { rank, status: body.status ?? before.status });
        if (!after) throw new NotFoundException("relationship path not found");
        return { entityType: "relationship_path", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-paths/:id/archive")
  @RequirePermission("relationship_path.archive")
  async archivePath(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "relationship_path.archive", "relationship_path.archived", "relationship_path", async (client) => {
      const before = await findTenantRecordById(client, "relationship_paths", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("relationship path not found");
      const after = await updateTenantRecord(client, "relationship_paths", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("relationship path not found");
      return { entityType: "relationship_path", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async requireMap(client: PoolClient, tenantId: string, id: string) {
    const map = await findTenantRecordById(client, "relationship_maps", tenantId, id);
    if (!map) throw new NotFoundException("relationship map not found");
    return map;
  }

  private async requireOrganization(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("target_organization_id is required");
    const organization = await findTenantRecordById(client, "organizations", tenantId, id);
    if (!organization) throw new NotFoundException("target organization not found in tenant");
    return organization;
  }

  private async validateTargetContact(client: PoolClient, tenantId: string, contactId: unknown, organizationId: unknown) {
    if (!contactId) return;
    const contact = await this.validateContact(client, tenantId, contactId);
    if (!contact) return;
    if (organizationId && contact.organization_id !== organizationId) throw new Error("target_contact_id must belong to target organization");
  }

  private async validateContact(client: PoolClient, tenantId: string, contactId: unknown) {
    if (!contactId) return null;
    if (typeof contactId !== "string") throw new Error("contact id must be a string");
    const contact = await findTenantRecordById(client, "contacts", tenantId, contactId);
    if (!contact) throw new NotFoundException("contact not found in tenant");
    return contact;
  }

  private async validateIntermediaries(client: PoolClient, tenantId: string, contactIds: unknown) {
    if (contactIds === undefined) return;
    if (!Array.isArray(contactIds)) throw new Error("intermediary_contact_ids must be an array");
    for (const contactId of contactIds) await this.validateContact(client, tenantId, contactId);
  }

  private async validateTargetObject(client: PoolClient, tenantId: string, type: unknown, id: unknown) {
    if (!type && !id) return;
    if (type !== "opportunity_candidate") throw new Error("target_object_type must be opportunity_candidate for Sprint 2");
    if (typeof id !== "string") throw new Error("target_object_id is required");
    const candidate = await findTenantRecordById(client, "opportunity_candidates", tenantId, id);
    if (!candidate) throw new NotFoundException("target opportunity candidate not found in tenant");
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
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
