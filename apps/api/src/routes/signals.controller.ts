import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireOne, requireString } from "./intelligence.types";

const sourceTypes = new Set(["public_source", "relationship_source", "procurement_source", "government_source", "customer_source", "prime_source", "engineering_source", "manual_entry", "internal_note"]);
const trustLevels = new Set(["unverified", "low", "medium", "high", "verified"]);
const workTypes = new Set(["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"]);
const archiveReasons = new Set(["duplicate", "stale", "false_signal", "out_of_territory", "not_telecom_work", "insufficient_evidence", "no_longer_relevant", "other"]);
const evidenceTypes = new Set(["source_url", "document", "screenshot", "email_note", "call_note", "meeting_note", "public_record", "procurement_notice", "permit_record", "funding_notice", "relationship_note", "other"]);
const entityTypes = new Set(["organization", "territory", "contact"]);

type EnrichedSignalRow = QueryResultRow & {
  id: string;
  status: string;
  confidence_score: number | null;
  active_evidence_count: number;
  primary_organization_id: string | null;
  primary_territory_id: string | null;
  candidate_count: number;
  updated_at: Date | string;
};

@Controller()
export class SignalsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("signals")
  @RequirePermission("signal.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listEnrichedSignals(client, request.auth.tenantId, query));
  }

  @Get("signals/:id/detail")
  @RequirePermission("signal.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getSignalDetail(client, request.auth.tenantId, id));
  }

  @Get("signals/:id/readiness")
  @RequirePermission("signal.read")
  async readiness(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const signal = await this.getEnrichedSignal(client, request.auth.tenantId, id);
      if (!signal) throw new NotFoundException("signal not found");
      return this.readinessFor(signal);
    });
  }

  @Get("signals/:id/entities")
  @RequirePermission("signal.read")
  async listEntities(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireSignal(client, request.auth.tenantId, id);
      return this.signalEntities(client, request.auth.tenantId, id);
    });
  }

  @Get("signals/:id/timeline")
  @RequirePermission("signal.timeline.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireSignal(client, request.auth.tenantId, id);
      return this.signalTimeline(client, request.auth.tenantId, id);
    });
  }

  @Get("signals/:id/audit-summary")
  @RequirePermission("signal.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireSignal(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        SELECT
          al.id AS audit_id,
          al.actor_user_id AS actor_id,
          u.display_name AS actor_name,
          al.action,
          al.entity_type AS object_type,
          al.entity_id AS object_id,
          al.before_state AS before_json,
          al.after_state AS after_json,
          al.metadata->>'reason' AS reason,
          al.created_at,
          al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1
          AND (
            (al.entity_type = 'signal' AND al.entity_id = $2)
            OR (al.entity_type = 'signal_evidence' AND al.entity_id IN (SELECT id FROM signal_evidence WHERE tenant_id = $1 AND signal_id = $2))
            OR (al.entity_type = 'signal_entity' AND al.entity_id IN (SELECT id FROM signal_entities WHERE tenant_id = $1 AND signal_id = $2))
            OR (al.entity_type = 'candidate_signal' AND al.entity_id IN (SELECT id FROM candidate_signals WHERE tenant_id = $1 AND signal_id = $2))
          )
        ORDER BY al.created_at DESC
        LIMIT 50
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("signals/:id")
  @RequirePermission("signal.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const record = await this.withClient((client) => this.getEnrichedSignal(client, request.auth.tenantId, id));
    if (!record) throw new NotFoundException("signal not found");
    return record;
  }

  @Post("signals")
  @RequirePermission("signal.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.title ?? body.summary, "signal title or summary is required");
      requireOne([body.source_name, body.source_url, body.source_note], "source_name, source_url, or source_note is required");
      this.validateOptionalEnum(body.source_type, sourceTypes, "source_type");
      this.validateOptionalEnum(body.trust_level, trustLevels, "trust_level");
      this.validateOptionalEnum(body.work_type, workTypes, "work_type");
      return await this.write(request, "signal.create", "signal.created", "signal", async (client) => {
        await this.validateOptionalEntity(client, request.auth.tenantId, "organizations", body.organization_id);
        await this.validateOptionalEntity(client, request.auth.tenantId, "territories", body.territory_id);
        await this.validateOptionalEntity(client, request.auth.tenantId, "contacts", body.contact_id);
        if (body.owner_user_id) await this.requireActiveTenantUser(client, request.auth.tenantId, String(body.owner_user_id));
        const signal = await insertTenantRecord(client, "signals", request.auth.tenantId, {
          title,
          description: body.description ?? body.summary,
          signal_type: body.signal_type ?? body.type ?? "uncategorized",
          signal_category: body.signal_category ?? body.category,
          source_name: body.source_name,
          source_url: body.source_url,
          source_type: body.source_type ?? "manual_entry",
          source_note: body.source_note,
          trust_level: body.trust_level ?? "unverified",
          owner_user_id: body.owner_user_id,
          date_discovered: body.date_discovered,
          estimated_value: body.estimated_value,
          estimated_scope: body.estimated_scope,
          work_type: body.work_type ?? "unknown",
          confidence_score: body.confidence_score,
          confidence: body.confidence_score,
          status: "discovered",
        });
        await this.linkSignalEntity(client, request.auth.tenantId, signal.id, "organization", body.organization_id, true, request.auth.userId);
        await this.linkSignalEntity(client, request.auth.tenantId, signal.id, "territory", body.territory_id, true, request.auth.userId);
        await this.linkSignalEntity(client, request.auth.tenantId, signal.id, "contact", body.contact_id, false, request.auth.userId);
        return { entityType: "signal", entityId: signal.id, afterState: signal };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("signals/:id")
  @RequirePermission("signal.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    this.validateOptionalEnum(body.source_type, sourceTypes, "source_type");
    this.validateOptionalEnum(body.trust_level, trustLevels, "trust_level");
    this.validateOptionalEnum(body.work_type, workTypes, "work_type");
    return this.write(request, "signal.update", "signal.updated", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, pick(body, [
        "title",
        "description",
        "source_name",
        "source_url",
        "source_type",
        "source_note",
        "signal_type",
        "signal_category",
        "trust_level",
        "date_discovered",
        "estimated_value",
        "estimated_scope",
        "work_type",
        "status",
      ]));
      if (!after) throw new NotFoundException("signal not found");
      return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("signals/:id/entities")
  @RequirePermission("signal_entity.create")
  async attachEntity(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const entityType = this.requireBodyString(body.entity_type, "entity_type is required");
    const entityId = this.requireBodyString(body.entity_id, "entity_id is required");
    if (!entityTypes.has(entityType)) throw new BadRequestException("entity_type must be organization, territory, or contact");
    return this.write(request, "signal_entity.create", "signal_entity.created", "signal_entity", async (client) => {
      await this.requireSignal(client, request.auth.tenantId, id);
      await this.validateLinkEntity(client, request.auth.tenantId, entityType, entityId);
      const isPrimary = Boolean(body.is_primary) || ((entityType === "organization" || entityType === "territory") && !(await this.hasPrimaryEntity(client, request.auth.tenantId, id, entityType)));
      if (isPrimary) {
        await client.query(
          "UPDATE signal_entities SET is_primary = false WHERE tenant_id = $1 AND signal_id = $2 AND entity_type = $3 AND archived_at IS NULL AND deleted_at IS NULL",
          [request.auth.tenantId, id, entityType],
        );
      }
      const link = await insertTenantRecord(client, "signal_entities", request.auth.tenantId, {
        signal_id: id,
        entity_type: entityType,
        entity_id: entityId,
        is_primary: isPrimary,
        linked_by: request.auth.userId,
        linked_at: new Date(),
      });
      return { entityType: "signal_entity", entityId: link.id, afterState: link };
    });
  }

  @Post("signal-entities/:id/archive")
  @RequirePermission("signal_entity.archive")
  async archiveEntity(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "signal_entity.archive", "signal_entity.archived", "signal_entity", async (client) => {
      const before = await findTenantRecordById(client, "signal_entities", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal entity link not found");
      if (before.archived_at) throw new BadRequestException("signal entity link is already archived");
      const result = await client.query(
        `
        UPDATE signal_entities
        SET archived_at = now(), deleted_at = now(), is_primary = false
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *
        `,
        [request.auth.tenantId, id],
      );
      return {
        entityType: "signal_entity",
        entityId: id,
        beforeState: before,
        afterState: { ...result.rows[0], archive_reason: body.reason ?? null },
      };
    });
  }

  @Post("signals/:id/assign-owner")
  @RequirePermission("signal.assign_owner")
  async assignOwner(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const ownerUserId = this.requireBodyString(body.owner_user_id, "owner_user_id is required");
    return this.write(request, "signal.assign_owner", "signal.owner_assigned", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      await this.requireActiveTenantUser(client, request.auth.tenantId, ownerUserId);
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, { owner_user_id: ownerUserId });
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
        if (before.status === "archived") throw new BadRequestException("archived signals cannot be categorized");
        const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, {
          signal_category: signalCategory,
          signal_type: signalType,
          status: "categorized",
        });
        if (!after) throw new NotFoundException("signal not found");
        return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
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
      if (before.status === "archived") throw new BadRequestException("archived signals cannot be scored");
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
    this.validateOptionalEnum(body.trust_level, trustLevels, "trust_level");
    return this.write(request, "signal.verify", "signal.verified", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      if (before.status === "archived") throw new BadRequestException("archived signals cannot be verified");
      const evidence = await this.activeEvidenceCount(client, request.auth.tenantId, id);
      if (evidence === 0) throw new BadRequestException("This signal cannot be verified until active evidence is attached.");
      const values: Record<string, unknown> = {
        status: "verified",
        verified_by_user_id: request.auth.userId,
        verified_by: request.auth.userId,
        verified_at: new Date(),
      };
      if (body.trust_level) values.trust_level = body.trust_level;
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("signal not found");
      return { entityType: "signal", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("signals/:id/archive")
  @RequirePermission("signal.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const archiveReason = this.requireBodyString(body.archive_reason ?? body.reason, "Archive reason is required.");
    if (!archiveReasons.has(archiveReason)) throw new BadRequestException("archive_reason is not approved");
    return this.write(request, "signal.archive", "signal.archived", "signal", async (client) => {
      const before = await findTenantRecordById(client, "signals", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal not found");
      const after = await updateTenantRecord(client, "signals", request.auth.tenantId, id, {
        status: "archived",
        archive_reason: archiveReason,
        archive_note: body.archive_note ?? body.note,
        archived_by: request.auth.userId,
        archived_at: new Date(),
        deleted_at: new Date(),
      });
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
      if (!evidenceTypes.has(evidenceType)) throw new BadRequestException("evidence_type is not approved");
      this.validateOptionalEnum(body.trust_level, trustLevels, "trust_level");
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
          trust_level: body.trust_level ?? "unverified",
          created_by: request.auth.userId,
          status: "active",
          metadata: body.metadata ?? {},
        });
        return { entityType: "signal_evidence", entityId: evidence.id, afterState: evidence };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("signal-evidence/:id")
  @RequirePermission("signal_evidence.update")
  async updateEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    this.validateOptionalEnum(body.evidence_type, evidenceTypes, "evidence_type");
    this.validateOptionalEnum(body.trust_level, trustLevels, "trust_level");
    return this.write(request, "signal_evidence.update", "signal_evidence.updated", "signal_evidence", async (client) => {
      const before = await findTenantRecordById(client, "signal_evidence", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("signal evidence not found");
      const after = await updateTenantRecord(client, "signal_evidence", request.auth.tenantId, id, pick(body, ["evidence_type", "summary", "description", "source_url", "file_id", "metadata", "status", "trust_level"]));
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
      const after = await updateTenantRecord(client, "signal_evidence", request.auth.tenantId, id, { status: "archived", archived_by: request.auth.userId, archived_at: new Date(), deleted_at: new Date() });
      if (!after) throw new NotFoundException("signal evidence not found");
      return { entityType: "signal_evidence", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("signals/:id/create-candidate")
  @RequirePermission("opportunity_candidate.create")
  async createCandidateFromSignal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const candidateName = this.requireBodyString(body.candidate_name ?? body.name, "candidate_name is required");
    const organizationId = this.requireBodyString(body.organization_id, "organization_id is required");
    const territoryId = this.requireBodyString(body.territory_id, "territory_id is required");
    const workType = this.requireBodyString(body.work_type, "work_type is required");
    const evidenceSummary = this.requireBodyString(body.evidence_summary, "evidence_summary is required");
    this.validateOptionalEnum(workType, workTypes, "work_type");
    const contributionScore = body.contribution_score === undefined ? null : Number(body.contribution_score);
    if (contributionScore !== null && (!Number.isInteger(contributionScore) || contributionScore < 0 || contributionScore > 100)) throw new BadRequestException("contribution_score must be between 0 and 100");
    return this.write(request, "opportunity_candidate.create", "opportunity_candidate.created", "opportunity_candidate", async (client) => {
      const signal = await this.getEnrichedSignal(client, request.auth.tenantId, id);
      if (!signal) throw new NotFoundException("signal not found");
      const readiness = this.readinessFor(signal);
      if (!readiness.candidate_ready) throw new BadRequestException("This signal is not ready to become a candidate.");
      await this.validateOptionalEntity(client, request.auth.tenantId, "organizations", organizationId);
      await this.validateOptionalEntity(client, request.auth.tenantId, "territories", territoryId);
      const candidate = await insertTenantRecord(client, "opportunity_candidates", request.auth.tenantId, {
        title: candidateName,
        name: candidateName,
        organization_id: organizationId,
        territory_id: territoryId,
        work_type: workType,
        evidence_summary: evidenceSummary,
        confidence_score: signal.confidence_score,
        status: "created",
      });
      const candidateSignal = await insertTenantRecord(client, "candidate_signals", request.auth.tenantId, {
        candidate_id: candidate.id,
        signal_id: id,
        contribution_score: contributionScore ?? signal.confidence_score,
        status: "active",
      });
      return {
        entityType: "opportunity_candidate",
        entityId: candidate.id,
        afterState: { candidate, candidate_signal: candidateSignal },
        additionalEvents: [
          {
            action: "candidate_signal.create",
            aggregateType: "candidate_signal",
            entityType: "candidate_signal",
            entityId: candidateSignal.id,
            eventType: "candidate_signal.created",
            afterState: candidateSignal,
            systemActions: [{ actionType: "candidate_signal.created.processed", payload: { action: "candidate_signal.create" } }],
          },
        ],
      };
    });
  }

  private async listEnrichedSignals(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const parameters: unknown[] = [tenantId];
    const clauses = ["s.tenant_id = $1"];
    const status = query.status?.trim();
    const archived = query.archived?.trim();
    if (archived === "true" || status === "archived") {
      clauses.push("(s.status = 'archived' OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)");
    } else {
      clauses.push("s.deleted_at IS NULL");
      if (archived === "false") clauses.push("s.status <> 'archived'");
    }
    this.addEqualsFilter(parameters, clauses, "s.status", status);
    this.addEqualsFilter(parameters, clauses, "s.signal_category", query.category);
    this.addEqualsFilter(parameters, clauses, "s.signal_type", query.type);
    this.addEqualsFilter(parameters, clauses, "s.source_type", query.source_type);
    this.addEqualsFilter(parameters, clauses, "s.trust_level", query.trust_level);
    this.addEqualsFilter(parameters, clauses, "s.owner_user_id", query.owner_user_id);
    this.addEqualsFilter(parameters, clauses, "po.organization_id", query.organization_id);
    this.addEqualsFilter(parameters, clauses, "pt.territory_id", query.territory_id);
    if (query.source_name) {
      parameters.push(`%${query.source_name.trim()}%`);
      clauses.push(`s.source_name ILIKE $${parameters.length}`);
    }
    if (query.q) {
      parameters.push(`%${query.q.trim()}%`);
      clauses.push(`(s.title ILIKE $${parameters.length} OR s.description ILIKE $${parameters.length} OR s.source_name ILIKE $${parameters.length} OR s.source_note ILIKE $${parameters.length})`);
    }
    this.addNumberRange(parameters, clauses, "s.confidence_score", query.confidence_min, ">=");
    this.addNumberRange(parameters, clauses, "s.confidence_score", query.confidence_max, "<=");
    this.addDateRange(parameters, clauses, "s.date_discovered", query.date_discovered_from, ">=");
    this.addDateRange(parameters, clauses, "s.date_discovered", query.date_discovered_to, "<=");
    this.addBooleanExists(parameters, clauses, "has_evidence", query.has_evidence);
    this.addBooleanExists(parameters, clauses, "has_organization", query.has_organization);
    this.addBooleanExists(parameters, clauses, "has_contact", query.has_contact);
    this.addBooleanExists(parameters, clauses, "converted", query.converted);
    if (query.stale === "true") clauses.push("s.status NOT IN ('verified', 'consumed', 'archived') AND s.updated_at < now() - interval '30 days'");
    if (query.stale === "false") clauses.push("NOT (s.status NOT IN ('verified', 'consumed', 'archived') AND s.updated_at < now() - interval '30 days')");

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    parameters.push(limit, offset);
    const orderBy = this.signalSort(query.sort);
    const result = await client.query<EnrichedSignalRow>(
      `
      ${this.enrichedSignalCtes()}
      SELECT ${this.enrichedSignalSelect()}
      FROM signals s
      LEFT JOIN users owner ON owner.id = s.owner_user_id
      LEFT JOIN primary_org po ON po.signal_id = s.id
      LEFT JOIN primary_territory pt ON pt.signal_id = s.id
      LEFT JOIN evidence_counts ec ON ec.signal_id = s.id
      LEFT JOIN contact_counts cc ON cc.signal_id = s.id
      LEFT JOIN candidate_counts cand ON cand.signal_id = s.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${parameters.length - 1} OFFSET $${parameters.length}
      `,
      parameters,
    );
    return result.rows.map((row) => this.decorateSignal(row));
  }

  private async getEnrichedSignal(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query<EnrichedSignalRow>(
      `
      ${this.enrichedSignalCtes()}
      SELECT ${this.enrichedSignalSelect()}
      FROM signals s
      LEFT JOIN users owner ON owner.id = s.owner_user_id
      LEFT JOIN primary_org po ON po.signal_id = s.id
      LEFT JOIN primary_territory pt ON pt.signal_id = s.id
      LEFT JOIN evidence_counts ec ON ec.signal_id = s.id
      LEFT JOIN contact_counts cc ON cc.signal_id = s.id
      LEFT JOIN candidate_counts cand ON cand.signal_id = s.id
      WHERE s.tenant_id = $1 AND s.id = $2
      LIMIT 1
      `,
      [tenantId, id],
    );
    return result.rows[0] ? this.decorateSignal(result.rows[0]) : null;
  }

  private async getSignalDetail(client: PoolClient, tenantId: string, id: string) {
    const signal = await this.getEnrichedSignal(client, tenantId, id);
    if (!signal) throw new NotFoundException("signal not found");
    const [evidence, entities, candidates, opportunities, constraints, recommendations, workflowTasks, timeline] = await Promise.all([
      client.query("SELECT * FROM signal_evidence WHERE tenant_id = $1 AND signal_id = $2 ORDER BY created_at DESC", [tenantId, id]),
      this.signalEntities(client, tenantId, id),
      client.query(
        `
        SELECT oc.id AS candidate_id, coalesce(oc.name, oc.title) AS name, oc.status, oc.score, oc.confidence_score, cs.contribution_score
        FROM candidate_signals cs
        JOIN opportunity_candidates oc ON oc.tenant_id = cs.tenant_id AND oc.id = cs.candidate_id
        WHERE cs.tenant_id = $1 AND cs.signal_id = $2 AND cs.deleted_at IS NULL AND cs.status = 'active' AND oc.deleted_at IS NULL
        ORDER BY cs.created_at DESC
        `,
        [tenantId, id],
      ),
      client.query(
        `
        SELECT o.id AS opportunity_id, o.title AS name, o.status, o.estimated_value
        FROM candidate_signals cs
        JOIN opportunities o ON o.tenant_id = cs.tenant_id AND o.candidate_id = cs.candidate_id
        WHERE cs.tenant_id = $1 AND cs.signal_id = $2 AND cs.deleted_at IS NULL AND o.deleted_at IS NULL
        ORDER BY o.created_at DESC
        `,
        [tenantId, id],
      ),
      client.query("SELECT id, title, constraint_type, severity, status, owner_id, due_date FROM constraints WHERE tenant_id = $1 AND affected_object_type = 'signal' AND affected_object_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10", [tenantId, id]),
      client.query("SELECT id, title, recommendation_type, risk_level, expected_impact, status, confidence_score FROM recommendations WHERE tenant_id = $1 AND related_object_type = 'signal' AND related_object_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10", [tenantId, id]),
      client.query(
        `
        SELECT wt.id, wt.task_name, wt.title, wt.status, wt.assigned_to, wt.assigned_role, wt.due_at
        FROM workflow_tasks wt
        JOIN workflow_instances wi ON wi.tenant_id = wt.tenant_id AND wi.id = wt.workflow_instance_id
        WHERE wt.tenant_id = $1 AND wi.source_object_type = 'signal' AND wi.source_object_id = $2 AND wt.deleted_at IS NULL
        ORDER BY wt.created_at DESC
        LIMIT 10
        `,
        [tenantId, id],
      ).catch(() => ({ rows: [] })),
      this.signalTimeline(client, tenantId, id).catch(() => []),
    ]);
    return {
      signal,
      evidence: evidence.rows,
      entities,
      primary_organization: entities.organizations.find((entity: { is_primary: boolean }) => entity.is_primary) ?? null,
      primary_territory: entities.territories.find((entity: { is_primary: boolean }) => entity.is_primary) ?? null,
      contacts: entities.contacts,
      candidates: candidates.rows,
      opportunities: opportunities.rows,
      readiness: this.readinessFor(signal),
      constraints: constraints.rows,
      recommendations: recommendations.rows,
      workflow_tasks: workflowTasks.rows,
      timeline_summary: timeline,
    };
  }

  private enrichedSignalCtes() {
    return `
      WITH primary_org AS (
        SELECT DISTINCT ON (se.signal_id)
          se.signal_id,
          se.id AS signal_entity_id,
          o.id AS organization_id,
          o.name AS organization_name,
          o.status AS organization_status
        FROM signal_entities se
        JOIN organizations o ON o.tenant_id = se.tenant_id AND o.id = se.entity_id AND o.deleted_at IS NULL
        WHERE se.entity_type = 'organization' AND se.archived_at IS NULL AND se.deleted_at IS NULL
        ORDER BY se.signal_id, se.is_primary DESC, se.linked_at ASC, se.created_at ASC
      ),
      primary_territory AS (
        SELECT DISTINCT ON (se.signal_id)
          se.signal_id,
          se.id AS signal_entity_id,
          t.id AS territory_id,
          t.name AS territory_name,
          t.status AS territory_status
        FROM signal_entities se
        JOIN territories t ON t.tenant_id = se.tenant_id AND t.id = se.entity_id AND t.deleted_at IS NULL
        WHERE se.entity_type = 'territory' AND se.archived_at IS NULL AND se.deleted_at IS NULL
        ORDER BY se.signal_id, se.is_primary DESC, se.linked_at ASC, se.created_at ASC
      ),
      evidence_counts AS (
        SELECT signal_id, count(*)::int AS evidence_count, count(*) FILTER (WHERE status <> 'archived' AND archived_at IS NULL AND deleted_at IS NULL)::int AS active_evidence_count
        FROM signal_evidence
        GROUP BY signal_id
      ),
      contact_counts AS (
        SELECT se.signal_id, count(*)::int AS contact_count
        FROM signal_entities se
        JOIN contacts c ON c.tenant_id = se.tenant_id AND c.id = se.entity_id AND c.deleted_at IS NULL
        WHERE se.entity_type = 'contact' AND se.archived_at IS NULL AND se.deleted_at IS NULL
        GROUP BY se.signal_id
      ),
      candidate_counts AS (
        SELECT signal_id, count(*)::int AS candidate_count, array_agg(candidate_id ORDER BY created_at DESC) AS opportunity_candidate_ids
        FROM candidate_signals
        WHERE status = 'active' AND deleted_at IS NULL
        GROUP BY signal_id
      )
    `;
  }

  private enrichedSignalSelect() {
    return `
      s.*,
      s.description AS summary,
      s.signal_category AS category,
      s.signal_type AS type,
      owner.display_name AS owner_name,
      po.organization_id AS primary_organization_id,
      po.organization_name AS primary_organization_name,
      po.organization_status AS primary_organization_status,
      pt.territory_id AS primary_territory_id,
      pt.territory_name AS primary_territory_name,
      pt.territory_status AS primary_territory_status,
      COALESCE(cc.contact_count, 0)::int AS contact_count,
      COALESCE(ec.evidence_count, 0)::int AS evidence_count,
      COALESCE(ec.active_evidence_count, 0)::int AS active_evidence_count,
      COALESCE(cand.candidate_count, 0)::int AS candidate_count,
      COALESCE(cand.opportunity_candidate_ids, '{}'::uuid[]) AS opportunity_candidate_ids
    `;
  }

  private decorateSignal(row: EnrichedSignalRow) {
    const readiness = this.readinessFor(row);
    const converted = Number(row.candidate_count ?? 0) > 0;
    const stale = !["verified", "consumed", "archived"].includes(row.status) && new Date(row.updated_at).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      ...row,
      candidate_ready: readiness.candidate_ready,
      missing_readiness_items: readiness.missing_items,
      converted,
      stale,
      recommended_next_action: this.recommendedNextAction(row, readiness, converted),
    };
  }

  private readinessFor(signal: EnrichedSignalRow) {
    const checklist = {
      verified_status: signal.status === "verified",
      confidence_at_least_60: Number(signal.confidence_score ?? 0) >= 60,
      organization_attached: Boolean(signal.primary_organization_id),
      active_evidence_exists: Number(signal.active_evidence_count ?? 0) > 0,
      territory_attached: Boolean(signal.primary_territory_id),
    };
    const labels: Record<keyof typeof checklist, string> = {
      verified_status: "Status is verified",
      confidence_at_least_60: "Confidence score >= 60",
      organization_attached: "Related organization exists",
      active_evidence_exists: "Active evidence exists",
      territory_attached: "Territory exists",
    };
    const missingItems = (Object.keys(checklist) as Array<keyof typeof checklist>).filter((key) => !checklist[key]).map((key) => labels[key]);
    return {
      candidate_ready: missingItems.length === 0,
      checklist,
      missing_items: missingItems,
      blocking_reason: missingItems[0] ?? null,
      recommended_action: missingItems.length === 0 ? "create_candidate" : this.readinessAction(checklist),
    };
  }

  private recommendedNextAction(signal: EnrichedSignalRow, readiness: ReturnType<SignalsController["readinessFor"]>, converted: boolean) {
    if (signal.status === "archived") return "view_only";
    if (!signal.owner_user_id) return "assign_owner";
    if (!signal.primary_organization_id) return "attach_organization";
    if (!signal.primary_territory_id) return "attach_territory";
    if (Number(signal.active_evidence_count ?? 0) === 0) return "add_evidence";
    if (["discovered", "categorized"].includes(signal.status) && (!signal.signal_category || !signal.signal_type || signal.signal_type === "uncategorized")) return "categorize";
    if (signal.confidence_score === null || signal.confidence_score === undefined) return "score_signal";
    if (signal.status !== "verified" && Number(signal.active_evidence_count ?? 0) > 0) return "verify_signal";
    if (readiness.candidate_ready && !converted) return "create_candidate";
    if (converted) return "view_candidate";
    return "continue_investigation";
  }

  private readinessAction(checklist: Record<string, boolean>) {
    if (!checklist.organization_attached) return "attach_organization";
    if (!checklist.territory_attached) return "attach_territory";
    if (!checklist.active_evidence_exists) return "add_evidence";
    if (!checklist.confidence_at_least_60) return "score_signal";
    if (!checklist.verified_status) return "verify_signal";
    return "continue_investigation";
  }

  private async signalEntities(client: PoolClient, tenantId: string, signalId: string) {
    const result = await client.query(
      `
      SELECT
        se.id AS signal_entity_id,
        se.entity_type,
        se.entity_id,
        se.is_primary,
        COALESCE(o.name, t.name, c.full_name, concat_ws(' ', c.first_name, c.last_name)) AS display_name,
        COALESCE(o.status, t.status, c.status) AS status,
        se.created_at,
        se.linked_at
      FROM signal_entities se
      LEFT JOIN organizations o ON se.entity_type = 'organization' AND o.tenant_id = se.tenant_id AND o.id = se.entity_id
      LEFT JOIN territories t ON se.entity_type = 'territory' AND t.tenant_id = se.tenant_id AND t.id = se.entity_id
      LEFT JOIN contacts c ON se.entity_type = 'contact' AND c.tenant_id = se.tenant_id AND c.id = se.entity_id
      WHERE se.tenant_id = $1 AND se.signal_id = $2 AND se.archived_at IS NULL AND se.deleted_at IS NULL
      ORDER BY se.entity_type, se.is_primary DESC, se.linked_at ASC
      `,
      [tenantId, signalId],
    );
    return {
      organizations: result.rows.filter((row) => row.entity_type === "organization"),
      territories: result.rows.filter((row) => row.entity_type === "territory"),
      contacts: result.rows.filter((row) => row.entity_type === "contact"),
    };
  }

  private async signalTimeline(client: PoolClient, tenantId: string, signalId: string) {
    const result = await client.query(
      `
      SELECT
        e.id AS event_id,
        e.event_type,
        e.actor_user_id AS actor_id,
        u.display_name AS actor_name,
        e.occurred_at AS timestamp,
        concat(e.event_type, ' by ', COALESCE(u.display_name, 'system')) AS summary,
        ep.payload
      FROM events e
      LEFT JOIN users u ON u.id = e.actor_user_id
      LEFT JOIN event_payloads ep ON ep.event_id = e.id
      WHERE e.tenant_id = $1
        AND (
          (e.aggregate_type = 'signal' AND e.aggregate_id = $2)
          OR (e.aggregate_type = 'signal_evidence' AND e.aggregate_id IN (SELECT id FROM signal_evidence WHERE tenant_id = $1 AND signal_id = $2))
          OR (e.aggregate_type = 'signal_entity' AND e.aggregate_id IN (SELECT id FROM signal_entities WHERE tenant_id = $1 AND signal_id = $2))
          OR (e.aggregate_type = 'candidate_signal' AND e.aggregate_id IN (SELECT id FROM candidate_signals WHERE tenant_id = $1 AND signal_id = $2))
        )
      ORDER BY e.occurred_at DESC
      LIMIT 50
      `,
      [tenantId, signalId],
    );
    return result.rows;
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

  private async validateLinkEntity(client: PoolClient, tenantId: string, entityType: string, entityId: string) {
    const tableName = entityType === "organization" ? "organizations" : entityType === "territory" ? "territories" : "contacts";
    await this.validateOptionalEntity(client, tenantId, tableName, entityId);
  }

  private async linkSignalEntity(client: PoolClient, tenantId: string, signalId: string, entityType: string, entityId: unknown, isPrimary: boolean, userId: string) {
    if (typeof entityId !== "string" || !entityId) return;
    if (isPrimary) {
      await client.query("UPDATE signal_entities SET is_primary = false WHERE tenant_id = $1 AND signal_id = $2 AND entity_type = $3 AND archived_at IS NULL AND deleted_at IS NULL", [tenantId, signalId, entityType]);
    }
    await client.query(
      "INSERT INTO signal_entities (tenant_id, signal_id, entity_type, entity_id, is_primary, linked_by, linked_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
      [tenantId, signalId, entityType, entityId, isPrimary, userId],
    );
  }

  private async hasPrimaryEntity(client: PoolClient, tenantId: string, signalId: string, entityType: string) {
    const result = await client.query("SELECT 1 FROM signal_entities WHERE tenant_id = $1 AND signal_id = $2 AND entity_type = $3 AND is_primary = true AND archived_at IS NULL AND deleted_at IS NULL LIMIT 1", [tenantId, signalId, entityType]);
    return Boolean(result.rowCount);
  }

  private async requireActiveTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      `
      SELECT 1
      FROM tenant_users tu
      JOIN users u ON u.id = tu.user_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND u.status = 'active'
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rowCount) throw new BadRequestException("owner user must be an active member of the tenant");
  }

  private async activeEvidenceCount(client: PoolClient, tenantId: string, signalId: string) {
    const result = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM signal_evidence WHERE tenant_id = $1 AND signal_id = $2 AND status <> 'archived' AND archived_at IS NULL AND deleted_at IS NULL",
      [tenantId, signalId],
    );
    return result.rows[0]?.count ?? 0;
  }

  private validateOptionalEnum(value: unknown, allowed: Set<string>, fieldName: string) {
    if (value === undefined || value === null || value === "") return;
    if (typeof value !== "string" || !allowed.has(value)) throw new BadRequestException(`${fieldName} is not approved`);
  }

  private requireBodyString(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private addEqualsFilter(parameters: unknown[], clauses: string[], column: string, value: string | undefined) {
    if (!value) return;
    parameters.push(value);
    clauses.push(`${column} = $${parameters.length}`);
  }

  private addNumberRange(parameters: unknown[], clauses: string[], column: string, value: string | undefined, operator: ">=" | "<=") {
    if (!value) return;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new BadRequestException(`${column} filter must be numeric`);
    parameters.push(number);
    clauses.push(`${column} ${operator} $${parameters.length}`);
  }

  private addDateRange(parameters: unknown[], clauses: string[], column: string, value: string | undefined, operator: ">=" | "<=") {
    if (!value) return;
    parameters.push(value);
    clauses.push(`${column} ${operator} $${parameters.length}`);
  }

  private addBooleanExists(parameters: unknown[], clauses: string[], kind: "has_evidence" | "has_organization" | "has_contact" | "converted", value: string | undefined) {
    if (value !== "true" && value !== "false") return;
    const exists = value === "true";
    const sql = {
      has_evidence: "SELECT 1 FROM signal_evidence ev WHERE ev.tenant_id = s.tenant_id AND ev.signal_id = s.id AND ev.status <> 'archived' AND ev.archived_at IS NULL AND ev.deleted_at IS NULL",
      has_organization: "SELECT 1 FROM signal_entities seo WHERE seo.tenant_id = s.tenant_id AND seo.signal_id = s.id AND seo.entity_type = 'organization' AND seo.archived_at IS NULL AND seo.deleted_at IS NULL",
      has_contact: "SELECT 1 FROM signal_entities sec WHERE sec.tenant_id = s.tenant_id AND sec.signal_id = s.id AND sec.entity_type = 'contact' AND sec.archived_at IS NULL AND sec.deleted_at IS NULL",
      converted: "SELECT 1 FROM candidate_signals cs WHERE cs.tenant_id = s.tenant_id AND cs.signal_id = s.id AND cs.status = 'active' AND cs.deleted_at IS NULL",
    }[kind];
    clauses.push(`${exists ? "" : "NOT "}EXISTS (${sql})`);
  }

  private signalSort(sort: string | undefined) {
    switch (sort) {
      case "newest":
        return "s.date_discovered DESC NULLS LAST, s.created_at DESC";
      case "oldest":
        return "s.date_discovered ASC NULLS LAST, s.created_at ASC";
      case "confidence_desc":
        return "s.confidence_score DESC NULLS LAST, s.created_at DESC";
      case "confidence_asc":
        return "s.confidence_score ASC NULLS LAST, s.created_at DESC";
      case "trust_desc":
        return "array_position(ARRAY['verified','high','medium','low','unverified'], s.trust_level), s.created_at DESC";
      case "updated_desc":
        return "s.updated_at DESC";
      case "default":
      default:
        return "s.confidence_score DESC NULLS LAST, s.date_discovered DESC NULLS LAST, s.created_at DESC";
    }
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
        systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
        write,
      });
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
