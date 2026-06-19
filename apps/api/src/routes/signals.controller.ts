import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireOne, requireString } from "./intelligence.types";

@Controller()
export class SignalsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("signals")
  @RequirePermission("signal.read")
  async list(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "signals", request.auth.tenantId, { searchColumns: ["title", "description", "signal_type", "signal_category", "source_name"] }));
  }

  @Get("signals/:id")
  @RequirePermission("signal.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const record = await this.withClient((client) => findTenantRecordById(client, "signals", request.auth.tenantId, id));
    if (!record) throw new NotFoundException("signal not found");
    return record;
  }

  @Post("signals")
  @RequirePermission("signal.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.title ?? body.summary, "signal title or summary is required");
      requireOne([body.source_name, body.source_url], "source_name or source_url is required");
      return await this.write(request, "signal.create", "signal.created", "signal", async (client) => {
        await this.validateOptionalEntity(client, request.auth.tenantId, "organizations", body.organization_id);
        await this.validateOptionalEntity(client, request.auth.tenantId, "territories", body.territory_id);
        const signal = await insertTenantRecord(client, "signals", request.auth.tenantId, {
          title,
          description: body.description ?? body.summary,
          signal_type: body.signal_type ?? "uncategorized",
          signal_category: body.signal_category,
          source_name: body.source_name,
          source_url: body.source_url,
          status: "discovered",
        });
        await this.linkSignalEntity(client, request.auth.tenantId, signal.id, "organization", body.organization_id);
        await this.linkSignalEntity(client, request.auth.tenantId, signal.id, "territory", body.territory_id);
        return { entityType: "signal", entityId: signal.id, afterState: signal };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("signals/:id")
  @RequirePermission("signal.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "signal.update", "signal.updated", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, pick(body, ["title", "description", "source_name", "source_url", "signal_type", "signal_category", "status"]));
      if (!after) throw new NotFoundException("signal not found");
      return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("signals/:id/categorize")
  @RequirePermission("signal.categorize")
  async categorize(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const signalCategory = requireString(body.signal_category, "signal_category is required");
      const signalType = requireString(body.signal_type, "signal_type is required");
      return await this.write(request, "signal.categorize", "signal.categorized", "signal", async (client) => {
        const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("signal not found");
        const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, {
          signal_category: signalCategory,
          signal_type: signalType,
          status: "categorized",
        });
        if (!after) throw new NotFoundException("signal not found");
        return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("signals/:id/score")
  @RequirePermission("signal.score")
  async score(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const score = Number(body.confidence_score);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new BadRequestException("confidence_score must be between 0 and 100");
    return this.write(request, "signal.score", "signal.scored", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, {
        confidence_score: score,
        confidence: score,
        status: "scored",
      });
      if (!after) throw new NotFoundException("signal not found");
      return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("signals/:id/verify")
  @RequirePermission("signal.verify")
  async verify(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "signal.verify", "signal.verified", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      const evidence = await client.query("SELECT 1 FROM signal_evidence WHERE tenant_id = $1 AND signal_id = $2 AND status = 'active' LIMIT 1", [request.auth.tenantId, id]);
      if (!evidence.rowCount && !body.verifier_note) throw new BadRequestException("documented evidence or verifier input is required");
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, {
        status: "verified",
        verified_by_user_id: request.auth.userId,
        verified_at: new Date(),
      });
      if (!after) throw new NotFoundException("signal not found");
      return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("signals/:id/archive")
  @RequirePermission("signal.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "signal.archive", "signal.archived", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("signal not found");
      return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("signals/:id/evidence")
  @RequirePermission("signal_evidence.read")
  async listEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireSignal(client, request.auth.tenantId, id);
      const result = await client.query(
        "SELECT * FROM signal_evidence WHERE tenant_id = $1 AND signal_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC",
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Post("signals/:id/evidence")
  @RequirePermission("signal_evidence.create")
  async createEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const evidenceType = requireString(body.evidence_type, "evidence_type is required");
      requireOne([body.description, body.summary, body.source_url, body.file_id], "description, source_url, or file_id is required");
      return await this.write(request, "signal_evidence.create", "signal_evidence.created", "signal_evidence", async (client) => {
        await this.requireSignal(client, request.auth.tenantId, id);
        const evidence = await insertTenantRecord(client, "signal_evidence", request.auth.tenantId, {
          signal_id: id,
          evidence_type: evidenceType,
          summary: body.summary ?? body.description ?? body.source_url ?? body.file_id,
          description: body.description,
          source_url: body.source_url,
          file_id: body.file_id,
          status: "active",
          metadata: body.metadata ?? {},
        });
        return { entityType: "signal_evidence", entityId: evidence.id, afterState: evidence };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("signal-evidence/:id")
  @RequirePermission("signal_evidence.update")
  async updateEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "signal_evidence.update", "signal_evidence.updated", "signal_evidence", async (client) => {
      const before = await findTenantRecordById(client, "signal_evidence", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal evidence not found");
      const after = await updateTenantRecord(client, "signal_evidence", request.auth.tenantId, id, pick(body, ["evidence_type", "summary", "description", "source_url", "file_id", "metadata", "status"]));
      if (!after) throw new NotFoundException("signal evidence not found");
      return { entityType: "signal_evidence", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("signal-evidence/:id/archive")
  @RequirePermission("signal_evidence.archive")
  async archiveEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "signal_evidence.archive", "signal_evidence.archived", "signal_evidence", async (client) => {
      const before = await findTenantRecordById(client, "signal_evidence", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal evidence not found");
      const after = await updateTenantRecord(client, "signal_evidence", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("signal evidence not found");
      return { entityType: "signal_evidence", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async requireSignal(client: PoolClient, tenantId: string, signalId: string) {
    const signal = await findTenantRecordById(client, "signals", tenantId, signalId);
    if (!signal) throw new NotFoundException("signal not found in tenant");
  }

  private async validateOptionalEntity(client: PoolClient, tenantId: string, tableName: string, id: unknown) {
    if (!id) return;
    if (typeof id !== "string") throw new Error(`${tableName} id must be a string`);
    const record = await findTenantRecordById(client, tableName, tenantId, id);
    if (!record) throw new NotFoundException(`${tableName} record not found in tenant`);
  }

  private async linkSignalEntity(client: PoolClient, tenantId: string, signalId: string, entityType: string, entityId: unknown) {
    if (typeof entityId !== "string" || !entityId) return;
    await client.query("INSERT INTO signal_entities (tenant_id, signal_id, entity_type, entity_id) VALUES ($1, $2, $3, $4)", [
      tenantId,
      signalId,
      entityType,
      entityId,
    ]);
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
