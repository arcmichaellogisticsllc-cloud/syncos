import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, positiveInteger, requireAllowed, requireString } from "./intelligence.types";

const relationshipMapTypes = new Set(["organization_access", "opportunity_access", "customer_access", "prime_access", "engineering_access", "capacity_access", "billing_access", "field_access", "executive_access"]);
const relationshipMapStatuses = new Set(["no_path", "weak_path", "identified_path", "introduction_requested", "conversation_opened", "relationship_active", "strategic_access", "dormant", "archived"]);
const relationshipPathStatuses = new Set(["proposed", "active", "inactive", "archived"]);
const mapArchiveReasons = new Set(["no_longer_relevant", "duplicate", "target_changed", "organization_inactive", "opportunity_lost", "relationship_no_longer_useful", "other"]);
const pathArchiveReasons = new Set(["no_longer_valid", "duplicate", "contact_left_company", "weak_or_unusable", "replaced_by_better_path", "target_changed", "other"]);

type RelationshipMapRow = QueryResultRow & {
  id: string;
  status: string;
  map_type: string;
  target_organization_id: string | null;
  target_contact_id: string | null;
  related_candidate_id: string | null;
  related_opportunity_id: string | null;
  owner_user_id: string | null;
  strategic_flag: boolean | null;
  archived_at: Date | null;
  updated_at: Date;
};

type RelationshipPathRow = QueryResultRow & {
  id: string;
  relationship_map_id: string;
  status: string;
  rank: number | null;
  strength_score: number | null;
  confidence_score: number | null;
  archived_at: Date | null;
  updated_at: Date;
};

@Controller()
export class RelationshipMapsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("relationship-maps")
  @RequirePermission("relationship_map.read")
  async listMaps(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listEnrichedMaps(client, request.auth.tenantId, query));
  }

  @Get("relationship-maps/:id/detail")
  @RequirePermission("relationship_map.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getDetail(client, request.auth.tenantId, id));
  }

  @Get("relationship-maps/:id/timeline")
  @RequirePermission("relationship_map.timeline.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireMap(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH map_paths AS (
          SELECT id FROM relationship_paths WHERE tenant_id = $1 AND relationship_map_id = $2
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
            (e.aggregate_type = 'relationship_map' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'relationship_path' AND e.aggregate_id IN (SELECT id FROM map_paths))
            OR (e.aggregate_type IN ('constraint', 'recommendation', 'workflow_task') AND ep.payload @> jsonb_build_object('related_object_type', 'relationship_map', 'related_object_id', $2::text))
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("relationship-maps/:id/audit-summary")
  @RequirePermission("relationship_map.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireMap(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH map_paths AS (
          SELECT id FROM relationship_paths WHERE tenant_id = $1 AND relationship_map_id = $2
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
            (al.entity_type = 'relationship_map' AND al.entity_id = $2)
            OR (al.entity_type = 'relationship_path' AND al.entity_id IN (SELECT id FROM map_paths))
          )
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("relationship-maps/:id")
  @RequirePermission("relationship_map.read")
  async findMap(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const map = await this.withClient((client) => this.getEnrichedMap(client, request.auth.tenantId, id));
    if (!map) throw new NotFoundException("relationship map not found");
    return map;
  }

  @Post("relationship-maps")
  @RequirePermission("relationship_map.create")
  async createMap(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name ?? body.map_name, "relationship map name is required");
      const legacyMapType = body.target_object_type === "opportunity_candidate" || body.related_candidate_id ? "opportunity_access" : "organization_access";
      const mapType = body.map_type === undefined ? legacyMapType : requireAllowed(body.map_type, relationshipMapTypes, "map_type");
      const objective = body.objective === undefined ? this.defaultObjective(mapType) : requireString(body.objective, "objective is required");
      const status = body.status === undefined ? "no_path" : requireAllowed(body.status, relationshipMapStatuses, "relationship map status");
      const values = await this.mapValues(body, true);
      return await this.write(request, "relationship_map.create", "relationship_map.created", "relationship_map", async (client) => {
        await this.validateMapRelations(client, request.auth.tenantId, values);
        const map = await insertTenantRecord(client, "relationship_maps", request.auth.tenantId, {
          ...values,
          name,
          map_type: mapType,
          objective,
          status,
          strategic_flag: values.strategic_flag ?? false,
          target_object_type: values.related_candidate_id ? "opportunity_candidate" : values.target_object_type,
          target_object_id: values.related_candidate_id ?? values.target_object_id,
        });
        await this.refreshMapDerived(client, request.auth.tenantId, map.id);
        const after = await this.getEnrichedMap(client, request.auth.tenantId, map.id);
        return { entityType: "relationship_map", entityId: map.id, afterState: after ?? map };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("relationship-maps/:id")
  @RequirePermission("relationship_map.update")
  async updateMap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = await this.mapValues(body, false);
      return await this.write(request, "relationship_map.update", "relationship_map.updated", "relationship_map", async (client) => {
        const before = await this.requireMap(client, request.auth.tenantId, id);
        const relationValues = { ...before, ...values };
        await this.validateMapRelations(client, request.auth.tenantId, relationValues);
        const after = await updateTenantRecord(client, "relationship_maps", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("relationship map not found");
        await this.refreshMapDerived(client, request.auth.tenantId, id);
        const enriched = await this.getEnrichedMap(client, request.auth.tenantId, id);
        return { entityType: "relationship_map", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-maps/:id/assign-owner")
  @RequirePermission("relationship_map.assign_owner")
  async assignOwner(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let ownerUserId: string;
    try {
      ownerUserId = requireString(body.owner_user_id, "owner_user_id is required");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.write(request, "relationship_map.assign_owner", "relationship_map.owner_assigned", "relationship_map", async (client) => {
      const before = await this.requireMap(client, request.auth.tenantId, id);
      await this.requireActiveTenantUser(client, request.auth.tenantId, ownerUserId);
      const after = await updateTenantRecord(client, "relationship_maps", request.auth.tenantId, id, { owner_user_id: ownerUserId });
      if (!after) throw new NotFoundException("relationship map not found");
      return { entityType: "relationship_map", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("relationship-maps/:id/status")
  @RequirePermission("relationship_map.status")
  async setMapStatus(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const status = requireAllowed(body.status, relationshipMapStatuses, "relationship map status");
      const reason = requireString(body.reason, "reason is required");
      if (status === "archived") throw new BadRequestException("Use archive route to archive relationship maps.");
      return await this.write(request, "relationship_map.status", "relationship_map.status_changed", "relationship_map", async (client) => {
        const before = await this.requireMap(client, request.auth.tenantId, id);
        if (before.status === "archived") throw new BadRequestException("Archived maps cannot be updated.");
        const warnings: string[] = await this.statusWarnings(client, request.auth.tenantId, before, status);
        const after = await updateTenantRecord(client, "relationship_maps", request.auth.tenantId, id, { status });
        if (!after) throw new NotFoundException("relationship map not found");
        await this.refreshMapDerived(client, request.auth.tenantId, id);
        return { entityType: "relationship_map", entityId: id, beforeState: before, afterState: { ...after, reason, note: body.note, warnings } };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-maps/:id/archive")
  @RequirePermission("relationship_map.archive")
  async archiveMap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let archiveReason: string;
    try {
      archiveReason = requireAllowed(body.archive_reason ?? body.reason, mapArchiveReasons, "archive reason");
    } catch {
      throw new BadRequestException("Archive reason is required.");
    }
    return this.write(request, "relationship_map.archive", "relationship_map.archived", "relationship_map", async (client) => {
      const before = await this.requireMap(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "relationship_maps", request.auth.tenantId, id, {
        status: "archived",
        archive_reason: archiveReason,
        archive_note: body.archive_note ?? body.note,
        archived_by: request.auth.userId,
        archived_at: new Date(),
      });
      if (!after) throw new NotFoundException("relationship map not found");
      return { entityType: "relationship_map", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("relationship-maps/:id/paths")
  @RequirePermission("relationship_path.read")
  async listPaths(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireMap(client, request.auth.tenantId, id);
      return this.listEnrichedPaths(client, request.auth.tenantId, id, true);
    });
  }

  @Post("relationship-maps/:id/paths")
  @RequirePermission("relationship_path.create")
  async createPath(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.pathValues(body, true);
      return await this.write(request, "relationship_path.create", "relationship_path.created", "relationship_path", async (client) => {
        await this.requireMap(client, request.auth.tenantId, id);
        await this.validatePathValues(client, request.auth.tenantId, values);
        const path = await insertTenantRecord(client, "relationship_paths", request.auth.tenantId, { ...values, relationship_map_id: id, score: values.confidence_score ?? values.strength_score });
        await this.refreshMapDerived(client, request.auth.tenantId, id);
        const after = (await this.listEnrichedPaths(client, request.auth.tenantId, id, false)).find((row) => row.id === path.id) ?? path;
        return { entityType: "relationship_path", entityId: path.id, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("relationship-paths/:id")
  @RequirePermission("relationship_path.update")
  async updatePath(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.pathValues(body, false);
      return await this.write(request, "relationship_path.update", "relationship_path.updated", "relationship_path", async (client) => {
        const before = await findTenantRecordById<RelationshipPathRow>(client, "relationship_paths", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("relationship path not found");
        await this.validatePathValues(client, request.auth.tenantId, { ...before, ...values });
        const after = await updateTenantRecord(client, "relationship_paths", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("relationship path not found");
        await this.refreshMapDerived(client, request.auth.tenantId, before.relationship_map_id);
        return { entityType: "relationship_path", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-paths/:id/rank")
  @RequirePermission("relationship_path.rank")
  async rankPath(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const rank = positiveInteger(body.rank, "rank");
      return await this.write(request, "relationship_path.rank", "relationship_path.ranked", "relationship_path", async (client) => {
        const before = await findTenantRecordById<RelationshipPathRow>(client, "relationship_paths", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("relationship path not found");
        const after = await updateTenantRecord(client, "relationship_paths", request.auth.tenantId, id, { rank });
        if (!after) throw new NotFoundException("relationship path not found");
        await this.refreshMapDerived(client, request.auth.tenantId, before.relationship_map_id);
        return { entityType: "relationship_path", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("relationship-paths/:id/archive")
  @RequirePermission("relationship_path.archive")
  async archivePath(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let archiveReason: string;
    try {
      archiveReason = requireAllowed(body.archive_reason ?? body.reason, pathArchiveReasons, "archive reason");
    } catch {
      throw new BadRequestException("Archive reason is required.");
    }
    return this.write(request, "relationship_path.archive", "relationship_path.archived", "relationship_path", async (client) => {
      const before = await findTenantRecordById<RelationshipPathRow>(client, "relationship_paths", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("relationship path not found");
      const after = await updateTenantRecord(client, "relationship_paths", request.auth.tenantId, id, {
        status: "archived",
        archive_reason: archiveReason,
        archive_note: body.archive_note ?? body.note,
        archived_by: request.auth.userId,
        archived_at: new Date(),
      });
      if (!after) throw new NotFoundException("relationship path not found");
      await this.refreshMapDerived(client, request.auth.tenantId, before.relationship_map_id);
      return { entityType: "relationship_path", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async listEnrichedMaps(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const rows = await this.baseMapRows(client, tenantId);
    let enriched: QueryResultRow[] = await Promise.all(rows.map((row) => this.enrichMapRow(client, tenantId, row)));
    enriched = this.filterMaps(enriched, query);
    enriched = this.sortMaps(enriched, query.sort);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(query.offset ?? 0), 0);
    return enriched.slice(offset, offset + limit);
  }

  private async getEnrichedMap(client: PoolClient, tenantId: string, id: string) {
    const row = await this.baseMapRows(client, tenantId, id);
    if (!row[0]) return null;
    return this.enrichMapRow(client, tenantId, row[0]);
  }

  private async getDetail(client: PoolClient, tenantId: string, id: string) {
    const relationshipMap = await this.getEnrichedMap(client, tenantId, id);
    if (!relationshipMap) throw new NotFoundException("relationship map not found");
    const [targetOrganization, targetContact, paths, constraints, recommendations, workflowTasks] = await Promise.all([
      relationshipMap.target_organization_id ? this.findById(client, "organizations", tenantId, relationshipMap.target_organization_id) : null,
      relationshipMap.target_contact_id ? this.findById(client, "contacts", tenantId, relationshipMap.target_contact_id) : null,
      this.listEnrichedPaths(client, tenantId, id, true),
      this.relatedConstraints(client, tenantId, id),
      this.relatedRecommendations(client, tenantId, id),
      this.workflowTasks(client, tenantId, id),
    ]);
    return {
      relationship_map: relationshipMap,
      target_organization: targetOrganization,
      target_contact: targetContact,
      paths,
      path_contacts: this.pathContacts(paths),
      related_candidate: relationshipMap.related_candidate_id ? await this.findById(client, "opportunity_candidates", tenantId, relationshipMap.related_candidate_id) : null,
      related_opportunity: relationshipMap.related_opportunity_id ? await this.findById(client, "opportunities", tenantId, relationshipMap.related_opportunity_id) : null,
      constraints_summary: constraints,
      recommendations_summary: recommendations,
      workflow_tasks_summary: workflowTasks,
      relationship_gaps: relationshipMap.relationship_gaps,
      recommended_next_action: relationshipMap.recommended_next_action,
      relationship_access_score: relationshipMap.relationship_access_score,
      audit_allowed: true,
      timeline_available: true,
    };
  }

  private async baseMapRows(client: PoolClient, tenantId: string, id?: string) {
    const result = await client.query<RelationshipMapRow>(
      `
      SELECT
        rm.*,
        rm.name AS map_name,
        u.display_name AS owner_name,
        t.name AS territory_name,
        org.name AS target_organization_name,
        org.organization_type AS target_organization_type,
        org.actor_roles AS target_organization_actor_roles,
        c.full_name AS target_contact_name,
        c.contact_role AS target_contact_role,
        ((c.email IS NOT NULL AND c.email != '') OR (c.phone IS NOT NULL AND c.phone != '') OR (c.mobile IS NOT NULL AND c.mobile != '') OR (c.linkedin_url IS NOT NULL AND c.linkedin_url != '')) AS target_contact_has_method,
        c.influence_score AS target_contact_influence_score,
        c.decision_authority_score AS target_contact_decision_authority_score,
        oc.name AS related_candidate_name,
        oc.title AS related_candidate_title,
        o.title AS related_opportunity_name
      FROM relationship_maps rm
      LEFT JOIN users u ON u.id = rm.owner_user_id
      LEFT JOIN territories t ON t.id = rm.territory_id AND t.tenant_id = rm.tenant_id
      LEFT JOIN organizations org ON org.id = rm.target_organization_id AND org.tenant_id = rm.tenant_id
      LEFT JOIN contacts c ON c.id = rm.target_contact_id AND c.tenant_id = rm.tenant_id
      LEFT JOIN opportunity_candidates oc ON oc.id = rm.related_candidate_id AND oc.tenant_id = rm.tenant_id
      LEFT JOIN opportunities o ON o.id = rm.related_opportunity_id AND o.tenant_id = rm.tenant_id
      WHERE rm.tenant_id = $1
        AND ($2::uuid IS NULL OR rm.id = $2::uuid)
        AND rm.deleted_at IS NULL
      ORDER BY rm.updated_at DESC
      `,
      [tenantId, id ?? null],
    );
    return result.rows;
  }

  private async enrichMapRow(client: PoolClient, tenantId: string, row: RelationshipMapRow) {
    const paths = await this.listEnrichedPaths(client, tenantId, row.id, false);
    const activePaths = paths.filter((path) => path.status === "active" && !path.archived_at);
    const bestPath = this.bestActivePath(activePaths);
    const relationshipAccessScore = bestPath ? this.accessScore(bestPath) : 0;
    const relationshipGaps = this.relationshipGaps(row, paths, bestPath);
    const recommendedNextAction = this.recommendedNextAction(row, paths, bestPath, relationshipAccessScore);
    const [openConstraintsCount, recommendationsCount, workflowTasksCount] = await Promise.all([
      this.relatedConstraints(client, tenantId, row.id, "AND status NOT IN ('closed', 'archived')").then((rows) => rows.length),
      this.relatedRecommendations(client, tenantId, row.id).then((rows) => rows.length),
      this.workflowTasks(client, tenantId, row.id).then((rows) => rows.length),
    ]);
    return {
      ...row,
      map_name: row.name,
      relationship_access_score: relationshipAccessScore,
      access_score: relationshipAccessScore,
      relationship_gaps: relationshipGaps,
      relationship_gap_summary: relationshipGaps,
      recommended_next_action: recommendedNextAction,
      path_count: paths.filter((path) => path.status !== "archived" && !path.archived_at).length,
      active_path_count: activePaths.length,
      proposed_path_count: paths.filter((path) => path.status === "proposed").length,
      best_path_id: bestPath?.id ?? null,
      best_path_name: bestPath?.path_name ?? null,
      best_path_strength: bestPath?.strength_score ?? null,
      best_path_confidence: bestPath?.confidence_score ?? null,
      open_constraints_count: openConstraintsCount,
      recommendations_count: recommendationsCount,
      workflow_tasks_count: workflowTasksCount,
      stale: this.isStale(row),
    };
  }

  private async listEnrichedPaths(client: PoolClient, tenantId: string, mapId: string, excludeArchived: boolean) {
    const result = await client.query(
      `
      SELECT
        rp.*,
        fc.full_name AS from_contact_name,
        tc.full_name AS to_contact_name,
        ou.display_name AS owner_name
      FROM relationship_paths rp
      LEFT JOIN contacts fc ON fc.id = rp.from_contact_id AND fc.tenant_id = rp.tenant_id
      LEFT JOIN contacts tc ON tc.id = rp.to_contact_id AND tc.tenant_id = rp.tenant_id
      LEFT JOIN users ou ON ou.id = rp.owner_user_id
      WHERE rp.tenant_id = $1
        AND rp.relationship_map_id = $2
        AND ($3::boolean = false OR (rp.status != 'archived' AND rp.deleted_at IS NULL AND rp.archived_at IS NULL))
      ORDER BY rp.rank NULLS LAST, rp.updated_at DESC
      `,
      [tenantId, mapId, excludeArchived],
    );
    return result.rows;
  }

  private filterMaps(rows: QueryResultRow[], query: Record<string, string | undefined>) {
    return rows.filter((row) => {
      if (query.status && row.status !== query.status) return false;
      if (query.map_type && row.map_type !== query.map_type) return false;
      if (query.target_organization_id && row.target_organization_id !== query.target_organization_id) return false;
      if (query.target_organization_type && row.target_organization_type !== query.target_organization_type) return false;
      if (query.target_contact_id && row.target_contact_id !== query.target_contact_id) return false;
      if (query.territory_id && row.territory_id !== query.territory_id) return false;
      if (query.owner_user_id && row.owner_user_id !== query.owner_user_id) return false;
      if (query.priority && row.priority !== query.priority) return false;
      if (query.related_candidate_id && row.related_candidate_id !== query.related_candidate_id) return false;
      if (query.related_opportunity_id && row.related_opportunity_id !== query.related_opportunity_id) return false;
      if (query.strategic_flag && String(Boolean(row.strategic_flag)) !== query.strategic_flag) return false;
      if (query.dormant && String(row.status === "dormant") !== query.dormant) return false;
      if (query.has_target_contact && String(Boolean(row.target_contact_id)) !== query.has_target_contact) return false;
      if (query.has_active_path && String(Number(row.active_path_count) > 0) !== query.has_active_path) return false;
      if (query.archived && String(row.status === "archived" || Boolean(row.archived_at)) !== query.archived) return false;
      if (query.strength_min && Number(row.best_path_strength ?? 0) < Number(query.strength_min)) return false;
      if (query.strength_max && Number(row.best_path_strength ?? 0) > Number(query.strength_max)) return false;
      if (query.confidence_min && Number(row.best_path_confidence ?? 0) < Number(query.confidence_min)) return false;
      if (query.confidence_max && Number(row.best_path_confidence ?? 0) > Number(query.confidence_max)) return false;
      if (query.access_score_min && Number(row.relationship_access_score ?? 0) < Number(query.access_score_min)) return false;
      if (query.access_score_max && Number(row.relationship_access_score ?? 0) > Number(query.access_score_max)) return false;
      if (query.q) {
        const haystack = [row.name, row.map_type, row.objective, row.status, row.target_organization_name, row.target_contact_name].join(" ").toLowerCase();
        if (!haystack.includes(query.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  private sortMaps(rows: QueryResultRow[], sort = "default") {
    return [...rows].sort((a, b) => {
      if (sort === "access_score_desc" || sort === "default") return Number(b.strategic_flag) - Number(a.strategic_flag) || Number(b.relationship_access_score) - Number(a.relationship_access_score) || this.dateNumber(b.updated_at) - this.dateNumber(a.updated_at);
      if (sort === "strength_desc") return Number(b.best_path_strength ?? -1) - Number(a.best_path_strength ?? -1);
      if (sort === "confidence_desc") return Number(b.best_path_confidence ?? -1) - Number(a.best_path_confidence ?? -1);
      if (sort === "priority") return String(a.priority ?? "").localeCompare(String(b.priority ?? ""));
      if (sort === "strategic_first") return Number(b.strategic_flag) - Number(a.strategic_flag);
      if (sort === "status") return String(a.status).localeCompare(String(b.status));
      if (sort === "target_organization") return String(a.target_organization_name ?? "").localeCompare(String(b.target_organization_name ?? ""));
      return this.dateNumber(b.updated_at) - this.dateNumber(a.updated_at);
    });
  }

  private async mapValues(body: Record<string, unknown>, creating: boolean) {
    const values = pick(body, ["name", "desired_outcome", "owner_user_id", "priority", "target_organization_id", "target_contact_id", "related_signal_id", "related_candidate_id", "related_opportunity_id", "territory_id"]);
    if (body.map_name !== undefined) values.name = body.map_name;
    if (body.objective !== undefined) values.objective = requireString(body.objective, "objective is required");
    if (body.map_type !== undefined) values.map_type = requireAllowed(body.map_type, relationshipMapTypes, "map_type");
    if (body.status !== undefined) values.status = requireAllowed(body.status, relationshipMapStatuses, "relationship map status");
    if (body.strategic_flag !== undefined) values.strategic_flag = Boolean(body.strategic_flag);
    if (body.due_date !== undefined) values.due_date = this.dateOnly(body.due_date, "due_date");
    if (values.related_candidate_id) {
      values.target_object_type = "opportunity_candidate";
      values.target_object_id = values.related_candidate_id;
    }
    return values;
  }

  private pathValues(body: Record<string, unknown>, creating: boolean) {
    const values = pick(body, ["path_summary", "recommended_action", "owner_user_id", "last_successful_outcome", "risk_notes", "blocked_reason", "last_used_at", "source_entity_type", "source_entity_id", "target_entity_type", "target_entity_id", "path"]);
    if (body.path_name !== undefined) values.path_name = requireString(body.path_name, "path_name is required");
    else if (creating) values.path_name = "Relationship path";
    if (body.from_contact_id !== undefined || creating) values.from_contact_id = requireString(body.from_contact_id, "from_contact_id is required");
    if (body.to_contact_id !== undefined) values.to_contact_id = requireString(body.to_contact_id, "to_contact_id is required");
    else if (creating && body.from_contact_id) values.to_contact_id = body.from_contact_id;
    else if (creating) values.to_contact_id = requireString(body.to_contact_id, "to_contact_id is required");
    if (body.strength_score !== undefined || creating) values.strength_score = optionalScore(body.strength_score, "strength_score");
    if (body.confidence_score !== undefined || creating) values.confidence_score = optionalScore(body.confidence_score, "confidence_score");
    if (body.rank !== undefined) values.rank = positiveInteger(body.rank, "rank");
    else if (creating) values.rank = 1;
    if (body.status !== undefined) values.status = requireAllowed(body.status, relationshipPathStatuses, "relationship path status");
    else if (creating) values.status = "proposed";
    if (body.intermediary_contact_ids !== undefined) {
      if (!Array.isArray(body.intermediary_contact_ids)) throw new Error("intermediary_contact_ids must be an array");
      values.intermediary_contact_ids = body.intermediary_contact_ids;
    } else if (creating) values.intermediary_contact_ids = [];
    return values;
  }

  private async validateMapRelations(client: PoolClient, tenantId: string, values: Record<string, unknown>) {
    await this.requireOrganization(client, tenantId, values.target_organization_id);
    await this.validateTargetContact(client, tenantId, values.target_contact_id, values.target_organization_id);
    await this.validateOptional(client, "signals", tenantId, values.related_signal_id, "related signal");
    await this.validateOptional(client, "opportunity_candidates", tenantId, values.related_candidate_id, "related candidate");
    await this.validateOptional(client, "opportunities", tenantId, values.related_opportunity_id, "related opportunity");
    await this.validateOptional(client, "territories", tenantId, values.territory_id, "territory");
    await this.validateOwner(client, tenantId, values.owner_user_id);
  }

  private async validatePathValues(client: PoolClient, tenantId: string, values: Record<string, unknown>) {
    await this.validateContact(client, tenantId, values.from_contact_id);
    await this.validateContact(client, tenantId, values.to_contact_id);
    if (values.from_contact_id === values.to_contact_id) throw new BadRequestException("from_contact_id and to_contact_id must be different");
    if (Array.isArray(values.intermediary_contact_ids)) {
      for (const contactId of values.intermediary_contact_ids) await this.validateContact(client, tenantId, contactId);
    }
    await this.validateOwner(client, tenantId, values.owner_user_id);
  }

  private bestActivePath(paths: RelationshipPathRow[]) {
    return [...paths].sort((a, b) => this.accessScore(b) - this.accessScore(a) || Number(a.rank ?? 999999) - Number(b.rank ?? 999999) || this.dateNumber(b.updated_at) - this.dateNumber(a.updated_at))[0] ?? null;
  }

  private accessScore(path: QueryResultRow) {
    return Math.round(Number(path.strength_score ?? 0) * 0.6 + Number(path.confidence_score ?? 0) * 0.4);
  }

  private defaultObjective(mapType: string) {
    if (mapType === "opportunity_access") return "Build relationship access for the linked opportunity candidate.";
    return "Build relationship access to the target organization.";
  }

  private relationshipGaps(map: RelationshipMapRow, paths: QueryResultRow[], bestPath: QueryResultRow | null) {
    const gaps: Record<string, unknown>[] = [];
    const add = (gap_type: string, severity: string, suggested_action: string, related_object_type?: string, related_object_id?: string | null) => gaps.push({ gap_type, severity, suggested_action, related_object_type, related_object_id });
    if (!map.target_organization_id) add("missing_target_organization", "critical", "Attach target organization.");
    if (!map.target_contact_id) add("missing_target_contact", "high", "Identify target contact.");
    if (map.target_contact_id && !(map as QueryResultRow).target_contact_has_method) add("missing_target_contact_method", "high", "Add or verify a target contact method.", "contact", map.target_contact_id);
    if (!paths.some((path) => path.status === "active" && !path.archived_at)) add("no_active_path", "high", "Create or activate a relationship path.");
    if (bestPath && Number(bestPath.strength_score ?? 0) < 50) add("weak_path_only", "medium", "Strengthen the best active path.", "relationship_path", bestPath.id);
    if (bestPath && Number(bestPath.confidence_score ?? 0) < 50) add("low_confidence_path", "medium", "Verify relationship path evidence.", "relationship_path", bestPath.id);
    if ((map as QueryResultRow).target_contact_role && !["decision_maker", "executive_sponsor", "economic_buyer", "vendor_manager", "construction_manager", "project_manager"].includes(String((map as QueryResultRow).target_contact_role))) add("no_decision_maker", "medium", "Identify a stronger decision-maker.", "contact", map.target_contact_id);
    if (map.map_type === "billing_access" && !["ap_contact", "billing_contact", "contract_manager", "economic_buyer"].includes(String((map as QueryResultRow).target_contact_role ?? ""))) add("no_ap_contact_for_billing_map", "medium", "Attach AP or billing contact.", "contact", map.target_contact_id);
    if (map.map_type === "field_access" && !["field_supervisor", "field_inspector", "qc_contact", "project_manager"].includes(String((map as QueryResultRow).target_contact_role ?? ""))) add("no_field_validator_for_field_map", "medium", "Attach field validator contact.", "contact", map.target_contact_id);
    if (map.map_type === "prime_access" && !["vendor_manager", "construction_manager", "project_manager"].includes(String((map as QueryResultRow).target_contact_role ?? ""))) add("no_prime_subcontractor_contact_for_prime_map", "medium", "Attach prime subcontractor or PM contact.", "contact", map.target_contact_id);
    if (map.map_type === "engineering_access" && !["engineering_contact", "design_contact", "technical_buyer", "influencer"].includes(String((map as QueryResultRow).target_contact_role ?? ""))) add("no_engineering_influencer_for_engineering_map", "medium", "Attach engineering influencer.", "contact", map.target_contact_id);
    if (this.isStale(map)) add("relationship_stale", "low", "Reconfirm relationship path recency.");
    if (map.map_type === "opportunity_access" && !map.related_candidate_id && !map.related_opportunity_id) add("missing_candidate_or_opportunity_for_opportunity_access", "medium", "Link candidate or opportunity.");
    return gaps;
  }

  private recommendedNextAction(map: RelationshipMapRow, paths: QueryResultRow[], bestPath: QueryResultRow | null, accessScore: number) {
    if (map.status === "archived") return "view_only";
    if (!map.target_organization_id) return "attach_target_organization";
    if (!map.target_contact_id) return "identify_target_contact";
    if (paths.length === 0) return "create_path";
    if (!bestPath || bestPath.confidence_score === null || Number(bestPath.confidence_score) < 50) return "verify_path";
    if (bestPath.strength_score === null || Number(bestPath.strength_score) < 50) return "strengthen_path";
    if (["no_path", "weak_path"].includes(String(map.status)) && paths.length > 0) return "update_status_to_identified_path";
    if (map.status === "identified_path") return "request_introduction";
    if (map.status === "introduction_requested") return "follow_up_introduction";
    if (map.status === "conversation_opened") return "mark_relationship_active";
    if (map.status === "relationship_active" && accessScore >= 80) return "consider_strategic_access";
    return "maintain_relationship";
  }

  private async refreshMapDerived(client: PoolClient, tenantId: string, mapId: string) {
    const map = (await this.baseMapRows(client, tenantId, mapId))[0];
    if (!map) return;
    const paths = await this.listEnrichedPaths(client, tenantId, mapId, false);
    const activePaths = paths.filter((path) => path.status === "active" && !path.archived_at);
    const bestPath = this.bestActivePath(activePaths);
    const accessScore = bestPath ? this.accessScore(bestPath) : 0;
    const gaps = this.relationshipGaps(map, paths, bestPath);
    const nextAction = this.recommendedNextAction(map, paths, bestPath, accessScore);
    await updateTenantRecord(client, "relationship_maps", tenantId, mapId, {
      access_score: accessScore,
      relationship_gap_summary: JSON.stringify(gaps),
      recommended_next_action: nextAction,
    });
  }

  private async statusWarnings(client: PoolClient, tenantId: string, map: RelationshipMapRow, status: string) {
    const warnings: string[] = [];
    const paths = await this.listEnrichedPaths(client, tenantId, map.id, true);
    const activePath = paths.some((path) => path.status === "active");
    if (["introduction_requested", "conversation_opened", "relationship_active"].includes(status) && !map.target_contact_id) warnings.push("target_contact_missing");
    if (status === "introduction_requested" && paths.length === 0) warnings.push("path_missing");
    if (status === "relationship_active" && !activePath) warnings.push("active_path_missing");
    if (status === "strategic_access") {
      const best = this.bestActivePath(paths.filter((path) => path.status === "active"));
      const score = best ? this.accessScore(best) : 0;
      if (score < 80) warnings.push("relationship_access_score_below_80");
    }
    return warnings;
  }

  private async requireMap(client: PoolClient, tenantId: string, id: string) {
    const map = await findTenantRecordById<RelationshipMapRow>(client, "relationship_maps", tenantId, id);
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
    if (organizationId && contact.organization_id !== organizationId) throw new Error("target_contact_id must belong to target organization");
  }

  private async validateContact(client: PoolClient, tenantId: string, contactId: unknown) {
    if (typeof contactId !== "string" || !contactId) throw new Error("contact id is required");
    const contact = await findTenantRecordById(client, "contacts", tenantId, contactId);
    if (!contact) throw new NotFoundException("contact not found in tenant");
    return contact;
  }

  private async validateOptional(client: PoolClient, table: string, tenantId: string, id: unknown, label: string) {
    if (!id) return;
    if (typeof id !== "string") throw new Error(`${label} id must be a string`);
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(`${label} not found in tenant`);
  }

  private async validateOwner(client: PoolClient, tenantId: string, userId: unknown) {
    if (!userId) return;
    if (typeof userId !== "string") throw new Error("owner_user_id must be a string");
    await this.requireActiveTenantUser(client, tenantId, userId);
  }

  private async requireActiveTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query("SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1", [tenantId, userId]);
    if (!result.rows[0]) throw new NotFoundException("owner user not found in tenant");
  }

  private async findById(client: PoolClient, table: string, tenantId: string, id: string) {
    return findTenantRecordById(client, table, tenantId, id);
  }

  private async relatedConstraints(client: PoolClient, tenantId: string, objectId: string, extra = "") {
    const result = await client.query(`SELECT * FROM constraints WHERE tenant_id = $1 AND deleted_at IS NULL AND affected_object_type = 'relationship_map' AND affected_object_id = $2 ${extra} ORDER BY updated_at DESC LIMIT 25`, [tenantId, objectId]);
    return result.rows;
  }

  private async relatedRecommendations(client: PoolClient, tenantId: string, objectId: string) {
    const result = await client.query("SELECT * FROM recommendations WHERE tenant_id = $1 AND deleted_at IS NULL AND related_object_type = 'relationship_map' AND related_object_id = $2 ORDER BY updated_at DESC LIMIT 25", [tenantId, objectId]);
    return result.rows;
  }

  private async workflowTasks(client: PoolClient, tenantId: string, mapId: string) {
    const result = await client.query(
      `
      SELECT wt.id AS task_id, wt.title, wt.task_name, wt.assigned_to, wt.due_at AS due_date, wt.status, wt.workflow_instance_id, (wt.due_at < now() AND wt.status NOT IN ('completed', 'cancelled', 'archived')) AS overdue
      FROM workflow_tasks wt
      JOIN workflow_instances wi ON wi.id = wt.workflow_instance_id AND wi.tenant_id = wt.tenant_id
      WHERE wt.tenant_id = $1
        AND wt.deleted_at IS NULL
        AND wi.source_object_type = 'relationship_map'
        AND wi.source_object_id = $2
      ORDER BY wt.due_at NULLS LAST, wt.created_at DESC
      LIMIT 25
      `,
      [tenantId, mapId],
    );
    return result.rows;
  }

  private pathContacts(paths: QueryResultRow[]) {
    const ids = new Set<string>();
    for (const path of paths) {
      if (path.from_contact_id) ids.add(path.from_contact_id);
      if (path.to_contact_id) ids.add(path.to_contact_id);
      if (Array.isArray(path.intermediary_contact_ids)) for (const id of path.intermediary_contact_ids) ids.add(String(id));
    }
    return [...ids];
  }

  private isStale(map: QueryResultRow) {
    return !["archived", "strategic_access"].includes(String(map.status)) && this.dateNumber(map.updated_at) < Date.now() - 180 * 24 * 60 * 60 * 1000;
  }

  private dateOnly(value: unknown, field: string) {
    if (!value) return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
    return date.toISOString().slice(0, 10);
  }

  private dateNumber(value: unknown) {
    const date = new Date(String(value ?? 0)).getTime();
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
