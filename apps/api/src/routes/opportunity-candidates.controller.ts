import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, requireAllowed, requireString } from "./intelligence.types";

const storedCandidateStatuses = new Set(["created", "monitoring", "investigating", "qualified_candidate", "converted_to_opportunity", "rejected", "archived"]);
const productCandidateStatuses = new Set(["created", "monitoring", "investigating", "qualified", "qualified_candidate", "rejected", "archived"]);
const workTypes = new Set(["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"]);
const legacyWorkTypeMap = new Map<string, string>([["fiber_build", "fiber"]]);
const sourceTypes = new Set(["signal", "organization_research", "relationship_map", "manual_entry", "customer_request", "prime_request", "public_source", "internal_note", "other"]);
const rejectionReasons = new Set(["insufficient_evidence", "no_relationship_access", "out_of_territory", "low_value", "poor_fit", "capacity_gap", "not_telecom_work", "duplicate", "other"]);
const archiveReasons = new Set(["duplicate", "stale", "no_longer_relevant", "converted_later", "rejected_cleanup", "other"]);
const candidateSignalArchiveReasons = new Set(["duplicate", "signal_no_longer_relevant", "incorrect_link", "candidate_rejected", "other"]);
const candidateSignalStatuses = new Set(["active", "archived"]);

type CandidateRow = QueryResultRow & {
  id: string;
  status: string;
  organization_id?: string | null;
  territory_id?: string | null;
  relationship_map_id?: string | null;
  relationship_access_score?: number | null;
  confidence_score?: number | null;
  candidate_score?: number | null;
  score?: number | null;
  active_signal_count?: number | null;
};

@Controller()
export class OpportunityCandidatesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("opportunity-candidates")
  @RequirePermission("opportunity_candidate.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listEnrichedCandidates(client, request.auth.tenantId, query));
  }

  @Get("opportunity-candidates/:id/detail")
  @RequirePermission("opportunity_candidate.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getDetail(client, request.auth.tenantId, id));
  }

  @Get("opportunity-candidates/:id/timeline")
  @RequirePermission("opportunity_candidate.timeline.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireCandidate(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH candidate_signal_ids AS (
          SELECT id FROM candidate_signals WHERE tenant_id = $1 AND candidate_id = $2
        )
        SELECT
          e.id AS event_id,
          e.event_type,
          e.actor_user_id AS actor_id,
          u.display_name AS actor_name,
          e.occurred_at AS timestamp,
          e.aggregate_type AS object_type,
          e.aggregate_id AS object_id,
          e.event_type AS summary,
          ep.payload
        FROM events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'opportunity_candidate' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'candidate_signal' AND e.aggregate_id IN (SELECT id FROM candidate_signal_ids))
            OR (e.aggregate_type IN ('constraint', 'recommendation') AND ep.payload @> jsonb_build_object('related_object_type', 'opportunity_candidate', 'related_object_id', $2::text))
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("opportunity-candidates/:id/audit-summary")
  @RequirePermission("opportunity_candidate.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireCandidate(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH candidate_signal_ids AS (
          SELECT id FROM candidate_signals WHERE tenant_id = $1 AND candidate_id = $2
        )
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
            (al.entity_type = 'opportunity_candidate' AND al.entity_id = $2)
            OR (al.entity_type = 'candidate_signal' AND al.entity_id IN (SELECT id FROM candidate_signal_ids))
          )
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("opportunity-candidates/:id")
  @RequirePermission("opportunity_candidate.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const candidate = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
      if (!candidate) throw new NotFoundException("opportunity candidate not found");
      return candidate;
    });
  }

  @Post("opportunity-candidates")
  @RequirePermission("opportunity_candidate.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.name ?? body.title ?? body.candidate_name, "candidate name is required");
      const values = await this.candidateValues(body, true);
      values.title = title;
      values.name = title;
      if (!values.status) values.status = "created";
      return await this.write(request, "opportunity_candidate.create", "opportunity_candidate.created", "opportunity_candidate", async (client) => {
        await this.validateCandidateRelations(client, request.auth.tenantId, values);
        const relationshipScore = await this.relationshipAccessForMap(client, request.auth.tenantId, values.relationship_map_id);
        if (values.relationship_map_id) values.relationship_access_score = relationshipScore;
        const candidate = await insertTenantRecord(client, "opportunity_candidates", request.auth.tenantId, values);
        const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, candidate.id);
        return { entityType: "opportunity_candidate", entityId: candidate.id, afterState: enriched ?? candidate };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("opportunity-candidates/:id")
  @RequirePermission("opportunity_candidate.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = await this.candidateValues(body, false);
      return await this.write(request, "opportunity_candidate.update", "opportunity_candidate.updated", "opportunity_candidate", async (client) => {
        const before = await this.requireCandidate(client, request.auth.tenantId, id);
        await this.validateCandidateRelations(client, request.auth.tenantId, values);
        if (values.relationship_map_id !== undefined) values.relationship_access_score = await this.relationshipAccessForMap(client, request.auth.tenantId, values.relationship_map_id);
        const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("opportunity candidate not found");
        const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
        return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-candidates/:id/assign-owner")
  @RequirePermission("opportunity_candidate.assign_owner")
  async assignOwner(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const ownerUserId = requireString(body.owner_user_id, "owner_user_id is required");
      return await this.write(request, "opportunity_candidate.assign_owner", "opportunity_candidate.owner_assigned", "opportunity_candidate", async (client) => {
        await this.requireActiveTenantUser(client, request.auth.tenantId, ownerUserId);
        const before = await this.requireCandidate(client, request.auth.tenantId, id);
        const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, { owner_user_id: ownerUserId });
        if (!after) throw new NotFoundException("opportunity candidate not found");
        const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
        return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-candidates/:id/link-relationship-map")
  @RequirePermission("opportunity_candidate.link_relationship_map")
  async linkRelationshipMap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const relationshipMapId = requireString(body.relationship_map_id, "relationship_map_id is required");
      return await this.write(request, "opportunity_candidate.link_relationship_map", "opportunity_candidate.relationship_map_linked", "opportunity_candidate", async (client) => {
        const before = await this.requireCandidate(client, request.auth.tenantId, id);
        const relationshipMap = await this.requireRelationshipMap(client, request.auth.tenantId, relationshipMapId);
        const warning = before.organization_id && relationshipMap.target_organization_id && before.organization_id !== relationshipMap.target_organization_id ? "relationship_map_target_organization_mismatch" : null;
        const relationshipAccessScore = await this.relationshipAccessForMap(client, request.auth.tenantId, relationshipMapId);
        const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, {
          relationship_map_id: relationshipMapId,
          relationship_access_score: relationshipAccessScore,
        });
        if (!after) throw new NotFoundException("opportunity candidate not found");
        const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
        return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: { ...(enriched ?? after), warnings: warning ? [warning] : [] } };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-candidates/:id/unlink-relationship-map")
  @RequirePermission("opportunity_candidate.link_relationship_map")
  async unlinkRelationshipMap(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity_candidate.link_relationship_map", "opportunity_candidate.relationship_map_unlinked", "opportunity_candidate", async (client) => {
      const before = await this.requireCandidate(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, { relationship_map_id: null, relationship_access_score: null });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: enriched ?? after };
    });
  }

  @Post("opportunity-candidates/:id/monitor")
  @RequirePermission("opportunity_candidate.monitor")
  async monitor(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.statusAction(request, id, "opportunity_candidate.monitor", "opportunity_candidate.monitored", {
      status: "monitoring",
      monitored_by: request.auth.userId,
      monitored_at: new Date(),
    }, body);
  }

  @Post("opportunity-candidates/:id/investigate")
  @RequirePermission("opportunity_candidate.investigate")
  async investigate(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.statusAction(request, id, "opportunity_candidate.investigate", "opportunity_candidate.investigated", {
      status: "investigating",
      investigated_by: request.auth.userId,
      investigated_at: new Date(),
    }, body, true);
  }

  @Post("opportunity-candidates/:id/qualify")
  @RequirePermission("opportunity_candidate.qualify")
  async qualify(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity_candidate.qualify", "opportunity_candidate.qualified", "opportunity_candidate", async (client) => {
      const before = await this.requireCandidate(client, request.auth.tenantId, id);
      await this.requireOrganization(client, request.auth.tenantId, before.organization_id);
      await this.requireTerritory(client, request.auth.tenantId, before.territory_id);
      const activeSignals = await this.activeCandidateSignals(client, request.auth.tenantId, id);
      if (activeSignals.length === 0) throw new BadRequestException("candidate must have at least one active signal before qualification");
      if (!before.work_type && !before.unknown_work_type_reason) throw new BadRequestException("work_type or unknown_work_type_reason is required");
      if (before.confidence_score === null && before.candidate_score === null && before.score === null) throw new BadRequestException("confidence_score or candidate_score is required");
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, {
        status: "qualified_candidate",
        qualified_by: request.auth.userId,
        qualified_at: new Date(),
      });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: enriched ?? after };
    });
  }

  @Post("opportunity-candidates/:id/reject")
  @RequirePermission("opportunity_candidate.reject")
  async reject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireAllowed(requireString(body.rejection_reason, "rejection_reason is required"), rejectionReasons, "rejection_reason");
      return await this.write(request, "opportunity_candidate.reject", "opportunity_candidate.rejected", "opportunity_candidate", async (client) => {
        const before = await this.requireCandidate(client, request.auth.tenantId, id);
        const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, {
          status: "rejected",
          rejection_reason: reason,
          rejection_note: stringOrNull(body.rejection_note),
          rejected_by: request.auth.userId,
          rejected_at: new Date(),
        });
        if (!after) throw new NotFoundException("opportunity candidate not found");
        const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
        return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-candidates/:id/archive")
  @RequirePermission("opportunity_candidate.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireAllowed(requireString(body.archive_reason, "Archive reason is required."), archiveReasons, "archive_reason");
      return await this.write(request, "opportunity_candidate.archive", "opportunity_candidate.archived", "opportunity_candidate", async (client) => {
        const before = await this.requireCandidate(client, request.auth.tenantId, id);
        const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, {
          status: "archived",
          archive_reason: reason,
          archive_note: stringOrNull(body.archive_note),
          archived_by: request.auth.userId,
          archived_at: new Date(),
        });
        if (!after) throw new NotFoundException("opportunity candidate not found");
        const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
        return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get("opportunity-candidates/:id/signals")
  @RequirePermission("candidate_signal.read")
  async listSignals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireCandidate(client, request.auth.tenantId, id);
      return this.attachedSignals(client, request.auth.tenantId, id);
    });
  }

  @Post("opportunity-candidates/:id/signals")
  @RequirePermission("candidate_signal.create")
  async addSignal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const signalId = requireString(body.signal_id, "signal_id is required");
      const contribution = optionalScore(body.contribution_score, "contribution_score") ?? 0;
      return await this.write(request, "candidate_signal.create", "candidate_signal.created", "candidate_signal", async (client) => {
        await this.requireCandidate(client, request.auth.tenantId, id);
        const signal = await this.requireSignal(client, request.auth.tenantId, signalId);
        if (signal.status === "archived") throw new BadRequestException("archived signal cannot be linked to candidate");
        const duplicate = await client.query("SELECT 1 FROM candidate_signals WHERE tenant_id = $1 AND candidate_id = $2 AND signal_id = $3 AND status = 'active' AND archived_at IS NULL AND deleted_at IS NULL LIMIT 1", [request.auth.tenantId, id, signalId]);
        if (duplicate.rows[0]) throw new BadRequestException("active candidate signal link already exists");
        const candidateSignal = await insertTenantRecord(client, "candidate_signals", request.auth.tenantId, {
          candidate_id: id,
          signal_id: signalId,
          contribution_score: contribution,
          contribution_note: stringOrNull(body.contribution_note),
          status: "active",
        });
        return { entityType: "candidate_signal", entityId: candidateSignal.id, afterState: candidateSignal };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("candidate-signals/:id")
  @RequirePermission("candidate_signal.update")
  async updateSignal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["contribution_note"]);
      if (body.status !== undefined) values.status = requireAllowed(body.status, candidateSignalStatuses, "candidate signal status");
      if (body.contribution_score !== undefined) values.contribution_score = optionalScore(body.contribution_score, "contribution_score");
      return await this.write(request, "candidate_signal.update", "candidate_signal.updated", "candidate_signal", async (client) => {
        const before = await findTenantRecordById(client, "candidate_signals", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("candidate signal not found");
        const after = await updateTenantRecord(client, "candidate_signals", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("candidate signal not found");
        return { entityType: "candidate_signal", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("candidate-signals/:id/archive")
  @RequirePermission("candidate_signal.archive")
  async archiveSignal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireAllowed(requireString(body.archive_reason, "Archive reason is required."), candidateSignalArchiveReasons, "archive_reason");
      return await this.write(request, "candidate_signal.archive", "candidate_signal.archived", "candidate_signal", async (client) => {
        const before = await findTenantRecordById(client, "candidate_signals", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("candidate signal not found");
        const after = await updateTenantRecord(client, "candidate_signals", request.auth.tenantId, id, {
          status: "archived",
          archive_reason: reason,
          archive_note: stringOrNull(body.archive_note),
          archived_by: request.auth.userId,
          archived_at: new Date(),
        });
        if (!after) throw new NotFoundException("candidate signal not found");
        return { entityType: "candidate_signal", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-candidates/:id/score")
  @RequirePermission("opportunity_candidate.score")
  async score(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity_candidate.score", "opportunity_candidate.scored", "opportunity_candidate", async (client) => {
      const before = await this.requireCandidate(client, request.auth.tenantId, id);
      const summary = await this.calculateScore(client, request.auth.tenantId, id, before);
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, {
        score: summary.candidate_score,
        candidate_score: summary.candidate_score,
        confidence_score: Math.round(summary.candidate_score),
      });
      if (!after) throw new NotFoundException("opportunity candidate not found");
      const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
      return { entityType: "opportunity_candidate", entityId: id, beforeState: before, afterState: { ...(enriched ?? after), score_summary: summary } };
    });
  }

  @Get("opportunity-candidates/:id/score-summary")
  @RequirePermission("opportunity_candidate.read")
  async scoreSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const candidate = await this.requireCandidate(client, request.auth.tenantId, id);
      return this.calculateScore(client, request.auth.tenantId, id, candidate);
    });
  }

  private async listEnrichedCandidates(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const rows = await this.baseCandidateRows(client, tenantId, query.id);
    const enriched = rows.map((row) => this.enrichCandidateRow(row));
    const filtered = this.filterCandidates(enriched, query);
    const sorted = this.sortCandidates(filtered, query.sort);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(query.offset ?? 0), 0);
    return sorted.slice(offset, offset + limit);
  }

  private async getEnrichedCandidate(client: PoolClient, tenantId: string, id: string) {
    const row = (await this.baseCandidateRows(client, tenantId, id))[0];
    return row ? this.enrichCandidateRow(row) : null;
  }

  private async getDetail(client: PoolClient, tenantId: string, id: string) {
    const candidate = await this.getEnrichedCandidate(client, tenantId, id);
    if (!candidate) throw new NotFoundException("opportunity candidate not found");
    const [organization, signals, relationshipMap, contacts, constraints, recommendations, scoreSummary] = await Promise.all([
      candidate.organization_id ? this.organizationContext(client, tenantId, String(candidate.organization_id)) : null,
      this.attachedSignals(client, tenantId, id),
      candidate.relationship_map_id ? this.relationshipMapContext(client, tenantId, String(candidate.relationship_map_id)) : null,
      this.relatedContacts(client, tenantId, candidate),
      this.relatedConstraints(client, tenantId, id),
      this.relatedRecommendations(client, tenantId, id),
      this.calculateScore(client, tenantId, id, candidate),
    ]);
    return {
      candidate,
      organization_context: organization,
      attached_signals: signals,
      relationship_map_context: relationshipMap,
      related_contacts: contacts,
      constraints_summary: constraints,
      recommendations_summary: recommendations,
      score_summary: scoreSummary,
      readiness: candidate.readiness,
      completeness: {
        completeness_score: candidate.completeness_score,
        completeness_band: candidate.completeness_band,
        missing_candidate_items: candidate.missing_candidate_items,
      },
      audit_allowed: true,
      timeline_available: true,
    };
  }

  private async baseCandidateRows(client: PoolClient, tenantId: string, id?: string) {
    const result = await client.query<CandidateRow>(
      `
      SELECT
        oc.*,
        oc.name AS candidate_name,
        COALESCE(oc.candidate_score, oc.score) AS candidate_score,
        CASE WHEN oc.status = 'qualified_candidate' THEN 'qualified' ELSE oc.status END AS normalized_status,
        org.name AS organization_name,
        org.organization_type,
        org.actor_roles AS organization_actor_roles,
        t.name AS territory_name,
        u.display_name AS owner_name,
        rm.name AS relationship_map_name,
        rm.map_type AS relationship_map_type,
        CASE WHEN oc.relationship_map_id IS NOT NULL THEN COALESCE(rm.access_score, oc.relationship_access_score) ELSE NULL END AS relationship_access_score,
        COALESCE(cs.signal_count, 0)::int AS signal_count,
        COALESCE(cs.active_signal_count, 0)::int AS active_signal_count,
        COALESCE(cons.open_constraints_count, 0)::int AS open_constraints_count,
        COALESCE(recs.recommendations_count, 0)::int AS recommendations_count
      FROM opportunity_candidates oc
      LEFT JOIN organizations org ON org.id = oc.organization_id AND org.tenant_id = oc.tenant_id
      LEFT JOIN territories t ON t.id = oc.territory_id AND t.tenant_id = oc.tenant_id
      LEFT JOIN users u ON u.id = oc.owner_user_id
      LEFT JOIN relationship_maps rm ON rm.id = oc.relationship_map_id AND rm.tenant_id = oc.tenant_id
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE status != 'archived' AND archived_at IS NULL AND deleted_at IS NULL)::int AS signal_count,
          count(*) FILTER (WHERE status = 'active' AND archived_at IS NULL AND deleted_at IS NULL)::int AS active_signal_count
        FROM candidate_signals
        WHERE tenant_id = oc.tenant_id AND candidate_id = oc.id
      ) cs ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_constraints_count
        FROM constraints
        WHERE tenant_id = oc.tenant_id
          AND deleted_at IS NULL
          AND affected_object_type = 'opportunity_candidate'
          AND affected_object_id = oc.id
          AND status NOT IN ('closed', 'archived')
      ) cons ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS recommendations_count
        FROM recommendations
        WHERE tenant_id = oc.tenant_id
          AND deleted_at IS NULL
          AND related_object_type = 'opportunity_candidate'
          AND related_object_id = oc.id
      ) recs ON true
      WHERE oc.tenant_id = $1
        AND ($2::uuid IS NULL OR oc.id = $2::uuid)
      ORDER BY oc.updated_at DESC
      `,
      [tenantId, id ?? null],
    );
    return result.rows;
  }

  private enrichCandidateRow(row: CandidateRow) {
    const normalizedStatus = normalizeStatus(row.status);
    const relationshipAccessScore = row.relationship_map_id ? nullableNumber(row.relationship_access_score) : null;
    const activeSignalCount = Number(row.active_signal_count ?? 0);
    const readiness = this.readiness(row, normalizedStatus, activeSignalCount, relationshipAccessScore);
    const missing = Object.entries(readiness.checklist).filter(([, complete]) => !complete).map(([key]) => key);
    const completeness = this.completeness(readiness.checklist);
    return {
      ...row,
      candidate_name: row.name ?? row.title,
      normalized_status: normalizedStatus,
      relationship_access_score: relationshipAccessScore,
      readiness,
      completeness_score: completeness.score,
      completeness_band: completeness.band,
      missing_candidate_items: missing,
      candidate_ready_for_opportunity: this.readyForOpportunity(row, normalizedStatus, activeSignalCount, relationshipAccessScore),
      recommended_next_action: this.recommendedNextAction(row, normalizedStatus, activeSignalCount, relationshipAccessScore),
    };
  }

  private readiness(row: CandidateRow, normalizedStatus: string, activeSignalCount: number, relationshipAccessScore: number | null) {
    const checklist = {
      organization_attached: Boolean(row.organization_id),
      territory_attached: Boolean(row.territory_id),
      at_least_one_signal_attached: activeSignalCount > 0,
      confidence_score_captured: row.confidence_score !== null && row.confidence_score !== undefined,
      candidate_score_captured: row.candidate_score !== null && row.candidate_score !== undefined,
      relationship_access_available: !row.relationship_map_id || (relationshipAccessScore !== null && relationshipAccessScore >= 50),
      no_critical_constraints: true,
      status_qualified: normalizedStatus === "qualified",
    };
    return { checklist, candidate_ready_for_opportunity: this.readyForOpportunity(row, normalizedStatus, activeSignalCount, relationshipAccessScore) };
  }

  private completeness(checklist: Record<string, boolean>) {
    const values = Object.values(checklist);
    const score = Math.round((values.filter(Boolean).length / values.length) * 100);
    const band = score < 40 ? "incomplete" : score < 70 ? "partial" : score < 90 ? "usable" : "complete";
    return { score, band };
  }

  private readyForOpportunity(row: CandidateRow, normalizedStatus: string, activeSignalCount: number, relationshipAccessScore: number | null) {
    const score = nullableNumber(row.candidate_score ?? row.score);
    const confidence = nullableNumber(row.confidence_score);
    return Boolean(row.organization_id)
      && Boolean(row.territory_id)
      && activeSignalCount > 0
      && ((score ?? -1) >= 60 || (confidence ?? -1) >= 60)
      && normalizedStatus === "qualified"
      && (!row.relationship_map_id || (relationshipAccessScore ?? -1) >= 50);
  }

  private recommendedNextAction(row: CandidateRow, normalizedStatus: string, activeSignalCount: number, relationshipAccessScore: number | null) {
    if (row.status === "archived") return "view_only";
    if (row.status === "rejected") return "review_rejection";
    if (!row.organization_id) return "attach_organization";
    if (!row.territory_id) return "attach_territory";
    if (activeSignalCount === 0) return "attach_signal";
    if (!row.relationship_map_id) return "link_relationship_map";
    if (relationshipAccessScore === null || relationshipAccessScore < 50) return "build_relationship_access";
    if (row.confidence_score === null && row.candidate_score === null && row.score === null) return "score_candidate";
    if (normalizedStatus === "created") return "monitor_or_investigate";
    if (normalizedStatus === "monitoring") return "investigate";
    if (normalizedStatus === "investigating" && ((Number(row.candidate_score ?? row.score ?? -1) >= 60) || Number(row.confidence_score ?? -1) >= 60)) return "qualify_candidate";
    if (normalizedStatus === "qualified") return "ready_for_opportunity_later";
    return "continue_review";
  }

  private filterCandidates(rows: QueryResultRow[], query: Record<string, string | undefined>) {
    return rows.filter((row) => {
      if (query.status && row.status !== normalizeStatusInput(query.status)) return false;
      if (query.normalized_status && row.normalized_status !== query.normalized_status) return false;
      if (query.organization_id && row.organization_id !== query.organization_id) return false;
      if (query.territory_id && row.territory_id !== query.territory_id) return false;
      if (query.work_type && row.work_type !== query.work_type) return false;
      if (query.owner_user_id && row.owner_user_id !== query.owner_user_id) return false;
      if (query.archived && String(row.status === "archived" || Boolean(row.archived_at)) !== query.archived) return false;
      if (!query.archived && (row.status === "archived" || Boolean(row.archived_at))) return false;
      if (query.has_signals && String(Number(row.active_signal_count ?? 0) > 0) !== query.has_signals) return false;
      if (query.has_organization && String(Boolean(row.organization_id)) !== query.has_organization) return false;
      if (query.has_relationship_map && String(Boolean(row.relationship_map_id)) !== query.has_relationship_map) return false;
      if (query.ready_for_opportunity && String(Boolean(row.candidate_ready_for_opportunity)) !== query.ready_for_opportunity) return false;
      if (query.estimated_value_min && Number(row.estimated_value ?? -1) < Number(query.estimated_value_min)) return false;
      if (query.estimated_value_max && Number(row.estimated_value ?? 0) > Number(query.estimated_value_max)) return false;
      if (query.confidence_min && Number(row.confidence_score ?? -1) < Number(query.confidence_min)) return false;
      if (query.confidence_max && Number(row.confidence_score ?? 101) > Number(query.confidence_max)) return false;
      if (query.candidate_score_min && Number(row.candidate_score ?? -1) < Number(query.candidate_score_min)) return false;
      if (query.candidate_score_max && Number(row.candidate_score ?? 101) > Number(query.candidate_score_max)) return false;
      if (query.relationship_access_min && Number(row.relationship_access_score ?? -1) < Number(query.relationship_access_min)) return false;
      if (query.relationship_access_max && Number(row.relationship_access_score ?? 101) > Number(query.relationship_access_max)) return false;
      if (query.created_from && this.dateNumber(row.created_at) < this.dateNumber(query.created_from)) return false;
      if (query.created_to && this.dateNumber(row.created_at) > this.dateNumber(query.created_to)) return false;
      if (query.updated_from && this.dateNumber(row.updated_at) < this.dateNumber(query.updated_from)) return false;
      if (query.updated_to && this.dateNumber(row.updated_at) > this.dateNumber(query.updated_to)) return false;
      if (query.q) {
        const haystack = [row.name, row.title, row.summary, row.source_note, row.status, row.work_type, row.organization_name].join(" ").toLowerCase();
        if (!haystack.includes(query.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  private sortCandidates(rows: QueryResultRow[], sort = "default") {
    return [...rows].sort((a, b) => {
      if (sort === "candidate_score_desc" || sort === "default") return Number(b.candidate_score ?? -1) - Number(a.candidate_score ?? -1) || this.dateNumber(b.updated_at) - this.dateNumber(a.updated_at);
      if (sort === "confidence_desc") return Number(b.confidence_score ?? -1) - Number(a.confidence_score ?? -1);
      if (sort === "estimated_value_desc") return Number(b.estimated_value ?? -1) - Number(a.estimated_value ?? -1);
      if (sort === "relationship_access_desc") return Number(b.relationship_access_score ?? -1) - Number(a.relationship_access_score ?? -1);
      if (sort === "created_desc") return this.dateNumber(b.created_at) - this.dateNumber(a.created_at);
      if (sort === "status") return String(a.normalized_status ?? "").localeCompare(String(b.normalized_status ?? ""));
      if (sort === "organization") return String(a.organization_name ?? "").localeCompare(String(b.organization_name ?? ""));
      return this.dateNumber(b.updated_at) - this.dateNumber(a.updated_at);
    });
  }

  private async candidateValues(body: Record<string, unknown>, creating: boolean) {
    const values = pick(body, ["organization_id", "territory_id", "unknown_work_type_reason", "owner_user_id", "relationship_map_id", "source_note", "rejection_note", "archive_note"]);
    if (body.name !== undefined || body.title !== undefined || body.candidate_name !== undefined) {
      const name = requireString(body.name ?? body.title ?? body.candidate_name, "candidate name is required");
      values.title = name;
      values.name = name;
    }
    if (body.summary !== undefined || body.evidence_summary !== undefined) {
      values.summary = stringOrNull(body.summary ?? body.evidence_summary);
      values.evidence_summary = values.summary;
    }
    if (body.source_type !== undefined) values.source_type = requireAllowed(body.source_type, sourceTypes, "source_type");
    if (body.work_type !== undefined) values.work_type = normalizeWorkType(body.work_type);
    else if (creating) values.work_type = "unknown";
    if (body.status !== undefined) values.status = normalizeStatusInput(requireAllowed(body.status, productCandidateStatuses, "opportunity candidate status"));
    if (body.estimated_value !== undefined) values.estimated_value = nonNegativeNumber(body.estimated_value, "estimated_value");
    if (body.confidence_score !== undefined) values.confidence_score = optionalScore(body.confidence_score, "confidence_score");
    if (body.candidate_score !== undefined || body.score !== undefined) {
      const candidateScore = optionalScore(body.candidate_score ?? body.score, "candidate_score");
      values.candidate_score = candidateScore;
      values.score = candidateScore;
    }
    for (const field of ["relationship_access_score", "capacity_fit_score", "strategic_fit_score", "risk_score"]) {
      if (body[field] !== undefined) values[field] = optionalScore(body[field], field);
    }
    return values;
  }

  private async validateCandidateRelations(client: PoolClient, tenantId: string, values: Record<string, unknown>) {
    await this.validateOptional(client, "organizations", tenantId, values.organization_id, "organization");
    await this.validateOptional(client, "territories", tenantId, values.territory_id, "territory");
    await this.validateOptional(client, "relationship_maps", tenantId, values.relationship_map_id, "relationship map");
    if (values.owner_user_id) await this.requireActiveTenantUser(client, tenantId, String(values.owner_user_id));
  }

  private async statusAction(request: AuthenticatedRequest, id: string, action: string, eventType: string, values: Record<string, unknown>, body: Record<string, unknown>, assignOwner = false) {
    return this.write(request, action, eventType, "opportunity_candidate", async (client) => {
      const before = await this.requireCandidate(client, request.auth.tenantId, id);
      if (assignOwner) values.owner_user_id = body.owner_user_id ?? before.owner_user_id ?? request.auth.userId;
      const after = await updateTenantRecord(client, "opportunity_candidates", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("opportunity candidate not found");
      const enriched = await this.getEnrichedCandidate(client, request.auth.tenantId, id);
      return {
        entityType: "opportunity_candidate",
        entityId: id,
        beforeState: before,
        afterState: {
          ...(enriched ?? after),
          reason: stringOrNull(body.reason),
          note: stringOrNull(body.note),
        },
      };
    });
  }

  private async calculateScore(client: PoolClient, tenantId: string, candidateId: string, candidate: QueryResultRow) {
    const signals = await this.activeCandidateSignals(client, tenantId, candidateId);
    const signalAvg = signals.length ? signals.reduce((sum, row) => sum + Number(row.contribution_score ?? 0), 0) / signals.length : 0;
    const relationshipAccessScore = Number(candidate.relationship_access_score ?? 0);
    const strategicFitScore = Number(candidate.strategic_fit_score ?? 50);
    const capacityFitScore = Number(candidate.capacity_fit_score ?? 50);
    const riskScore = Number(candidate.risk_score ?? 50);
    const raw = signalAvg * 0.4 + relationshipAccessScore * 0.2 + strategicFitScore * 0.15 + capacityFitScore * 0.15 + (100 - riskScore) * 0.1;
    const candidateScore = Math.max(0, Math.min(100, Number(raw.toFixed(4))));
    return {
      signal_avg: Number(signalAvg.toFixed(4)),
      relationship_access_score: relationshipAccessScore,
      strategic_fit_score: strategicFitScore,
      capacity_fit_score: capacityFitScore,
      risk_score: riskScore,
      candidate_score: candidateScore,
    };
  }

  private async organizationContext(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT id, name, organization_type, actor_roles, status, strategic_flag, influence_score, work_relevance_score, capacity_relevance_score, payment_relevance_score
      FROM organizations
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      `,
      [tenantId, organizationId],
    );
    return result.rows[0] ?? null;
  }

  private async relationshipMapContext(client: PoolClient, tenantId: string, relationshipMapId: string) {
    const result = await client.query(
      `
      SELECT
        rm.id,
        rm.name AS map_name,
        rm.map_type,
        rm.status,
        rm.target_organization_id,
        rm.target_contact_id,
        c.full_name AS target_contact_name,
        rm.access_score AS relationship_access_score,
        rm.relationship_gap_summary AS relationship_gaps,
        rm.recommended_next_action,
        bp.strength_score AS best_path_strength,
        bp.confidence_score AS best_path_confidence
      FROM relationship_maps rm
      LEFT JOIN contacts c ON c.id = rm.target_contact_id AND c.tenant_id = rm.tenant_id
      LEFT JOIN LATERAL (
        SELECT strength_score, confidence_score
        FROM relationship_paths
        WHERE tenant_id = rm.tenant_id
          AND relationship_map_id = rm.id
          AND status = 'active'
          AND archived_at IS NULL
          AND deleted_at IS NULL
        ORDER BY (strength_score * 0.6 + confidence_score * 0.4) DESC, rank NULLS LAST, updated_at DESC
        LIMIT 1
      ) bp ON true
      WHERE rm.tenant_id = $1 AND rm.id = $2
      LIMIT 1
      `,
      [tenantId, relationshipMapId],
    );
    return result.rows[0] ?? null;
  }

  private async attachedSignals(client: PoolClient, tenantId: string, candidateId: string) {
    const result = await client.query(
      `
      SELECT
        cs.id AS candidate_signal_id,
        cs.signal_id,
        s.title AS signal_title,
        s.title,
        s.signal_category AS category,
        s.signal_type AS type,
        s.confidence_score,
        s.trust_level,
        s.status,
        s.source_name,
        s.date_discovered,
        cs.contribution_score,
        cs.contribution_note,
        cs.status AS link_status,
        cs.archived_at,
        cs.archive_reason
      FROM candidate_signals cs
      JOIN signals s ON s.id = cs.signal_id AND s.tenant_id = cs.tenant_id
      WHERE cs.tenant_id = $1
        AND cs.candidate_id = $2
        AND cs.status = 'active'
        AND cs.archived_at IS NULL
        AND cs.deleted_at IS NULL
      ORDER BY cs.created_at DESC
      `,
      [tenantId, candidateId],
    );
    return result.rows;
  }

  private async activeCandidateSignals(client: PoolClient, tenantId: string, candidateId: string) {
    const result = await client.query<{ contribution_score: number }>(
      "SELECT contribution_score FROM candidate_signals WHERE tenant_id = $1 AND candidate_id = $2 AND status = 'active' AND archived_at IS NULL AND deleted_at IS NULL",
      [tenantId, candidateId],
    );
    return result.rows;
  }

  private async relatedContacts(client: PoolClient, tenantId: string, candidate: QueryResultRow) {
    if (!candidate.organization_id && !candidate.relationship_map_id) return [];
    const result = await client.query(
      `
      SELECT DISTINCT c.id, c.full_name, c.title, c.organization_id, org.name AS organization_name, c.contact_role, c.verification_status, c.influence_score, c.decision_authority_score, c.relationship_strength_score, c.last_contacted_at, c.last_verified_at
      FROM contacts c
      LEFT JOIN organizations org ON org.id = c.organization_id AND org.tenant_id = c.tenant_id
      LEFT JOIN relationship_maps rm ON rm.tenant_id = c.tenant_id AND rm.id = $3::uuid
      WHERE c.tenant_id = $1
        AND c.archived_at IS NULL
        AND (
          ($2::uuid IS NOT NULL AND c.organization_id = $2::uuid)
          OR c.id = rm.target_contact_id
        )
      ORDER BY c.full_name
      LIMIT 25
      `,
      [tenantId, candidate.organization_id ?? null, candidate.relationship_map_id ?? null],
    );
    return result.rows;
  }

  private async relatedConstraints(client: PoolClient, tenantId: string, candidateId: string) {
    const result = await client.query("SELECT * FROM constraints WHERE tenant_id = $1 AND deleted_at IS NULL AND affected_object_type = 'opportunity_candidate' AND affected_object_id = $2 ORDER BY updated_at DESC LIMIT 25", [tenantId, candidateId]);
    return result.rows;
  }

  private async relatedRecommendations(client: PoolClient, tenantId: string, candidateId: string) {
    const result = await client.query("SELECT * FROM recommendations WHERE tenant_id = $1 AND deleted_at IS NULL AND related_object_type = 'opportunity_candidate' AND related_object_id = $2 ORDER BY updated_at DESC LIMIT 25", [tenantId, candidateId]);
    return result.rows;
  }

  private async relationshipAccessForMap(client: PoolClient, tenantId: string, relationshipMapId: unknown) {
    if (!relationshipMapId) return null;
    const map = await this.requireRelationshipMap(client, tenantId, String(relationshipMapId));
    return nullableNumber(map.access_score) ?? 0;
  }

  private async requireCandidate(client: PoolClient, tenantId: string, id: string) {
    const candidate = await findTenantRecordById<CandidateRow>(client, "opportunity_candidates", tenantId, id);
    if (!candidate) throw new NotFoundException("opportunity candidate not found");
    return candidate;
  }

  private async requireOrganization(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("organization_id is required");
    const organization = await findTenantRecordById(client, "organizations", tenantId, id);
    if (!organization) throw new NotFoundException("organization not found in tenant");
    return organization;
  }

  private async requireTerritory(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("territory_id is required");
    const territory = await findTenantRecordById(client, "territories", tenantId, id);
    if (!territory) throw new NotFoundException("territory not found in tenant");
    return territory;
  }

  private async requireSignal(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("signal_id is required");
    const signal = await findTenantRecordById(client, "signals", tenantId, id);
    if (!signal) throw new NotFoundException("signal not found in tenant");
    return signal;
  }

  private async requireRelationshipMap(client: PoolClient, tenantId: string, id: string) {
    const relationshipMap = await findTenantRecordById<QueryResultRow>(client, "relationship_maps", tenantId, id);
    if (!relationshipMap) throw new NotFoundException("relationship map not found in tenant");
    return relationshipMap;
  }

  private async validateOptional(client: PoolClient, table: string, tenantId: string, id: unknown, label: string) {
    if (!id) return;
    if (typeof id !== "string") throw new Error(`${label} id must be a string`);
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(`${label} not found in tenant`);
  }

  private async requireActiveTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query("SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1", [tenantId, userId]);
    if (!result.rows[0]) throw new NotFoundException("owner user not found in tenant");
  }

  private dateNumber(value: unknown) {
    if (!value) return 0;
    const date = new Date(String(value)).getTime();
    return Number.isFinite(date) ? date : 0;
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

function normalizeStatus(status: unknown) {
  return status === "qualified_candidate" ? "qualified" : String(status ?? "created");
}

function normalizeStatusInput(status: unknown) {
  return status === "qualified" ? "qualified_candidate" : String(status ?? "created");
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function nonNegativeNumber(value: unknown, field: string) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) throw new Error(`${field} must be greater than or equal to 0`);
  return next;
}

function normalizeWorkType(value: unknown) {
  const text = String(value ?? "");
  const mapped = legacyWorkTypeMap.get(text) ?? text;
  return requireAllowed(mapped, workTypes, "work_type");
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}
