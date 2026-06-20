import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, requireAllowed, requireString } from "./intelligence.types";

const storedOpportunityStatuses = new Set(["qualified", "draft", "pursuit_review", "pursuit_approved", "pursuing", "bid_proposal", "proposal", "negotiation", "awarded", "lost", "deferred", "archived"]);
const productOpportunityStatuses = new Set(["draft", "pursuit_review", "pursuit_approved", "pursuing", "proposal", "negotiation", "awarded", "lost", "deferred", "archived"]);
const capacityRequirementStatuses = new Set(["active", "archived"]);
const workTypes = new Set(["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"]);
const legacyWorkTypeMap = new Map<string, string>([["fiber_build", "fiber"]]);
const sourceTypes = new Set(["candidate_conversion", "manual_entry", "signal", "organization_research", "relationship_map", "customer_request", "prime_request", "public_source", "internal_note", "other"]);
const authorityRoles = new Set(["Executive", "Growth Director"]);
const lostReasons = new Set(["price", "relationship_access", "capacity", "schedule", "compliance", "competitor", "customer_cancelled", "poor_fit", "other"]);
const deferredReasons = new Set(["timing", "funding_delay", "relationship_gap", "capacity_gap", "customer_delay", "more_research_needed", "other"]);
const archiveReasons = new Set(["duplicate", "stale", "no_longer_relevant", "converted_or_replaced", "cleanup", "other"]);
const capacityArchiveReasons = new Set(["duplicate", "stale", "no_longer_relevant", "planning_changed", "other"]);

type OpportunityRow = QueryResultRow & {
  id: string;
  status: string;
  normalized_status?: string;
  organization_id?: string | null;
  territory_id?: string | null;
  owner_user_id?: string | null;
  source_candidate_id?: string | null;
  relationship_map_id?: string | null;
  relationship_access_score?: number | null;
  estimated_value?: number | string | null;
  pursuit_score?: number | string | null;
  capacity_readiness_score?: number | null;
  capacity_fit_score?: number | null;
  margin_potential_score?: number | null;
  archived_at?: Date | null;
};

@Controller()
export class OpportunitiesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("opportunities")
  @RequirePermission("opportunity.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listEnrichedOpportunities(client, request.auth.tenantId, query));
  }

  @Get("opportunities/:id/detail")
  @RequirePermission("opportunity.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getDetail(client, request.auth.tenantId, id));
  }

  @Get("opportunities/:id/timeline")
  @RequirePermission("opportunity.timeline.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH requirement_ids AS (
          SELECT id FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND opportunity_id = $2
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
            (e.aggregate_type = 'opportunity' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'capacity_requirement' AND e.aggregate_id IN (SELECT id FROM requirement_ids))
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("opportunities/:id/audit-summary")
  @RequirePermission("opportunity.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH requirement_ids AS (
          SELECT id FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND opportunity_id = $2
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
            (al.entity_type = 'opportunity' AND al.entity_id = $2)
            OR (al.entity_type = 'capacity_requirement' AND al.entity_id IN (SELECT id FROM requirement_ids))
          )
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("opportunities/:id")
  @RequirePermission("opportunity.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const opportunity = await this.withClient((client) => this.getEnrichedOpportunity(client, request.auth.tenantId, id));
    if (!opportunity) throw new NotFoundException("opportunity not found");
    return opportunity;
  }

  @Post("opportunity-candidates/:id/convert-to-opportunity")
  @RequirePermission("opportunity.create")
  async convertCandidate(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "opportunity.convert_from_candidate", "opportunity.created", "opportunity", async (client) => {
        const candidate = await this.requireCandidate(client, request.auth.tenantId, id);
        const normalizedStatus = normalizeCandidateStatus(candidate.status);
        if (normalizedStatus !== "qualified") throw new BadRequestException("candidate must be qualified");
        if (candidate.status === "archived" || candidate.archived_at) throw new BadRequestException("candidate must not be archived");
        if (candidate.status === "rejected") throw new BadRequestException("candidate must not be rejected");
        if (!candidate.organization_id) throw new BadRequestException("candidate must have organization_id");
        if (!candidate.territory_id) throw new BadRequestException("candidate must have territory_id");
        if ((await this.activeCandidateSignals(client, request.auth.tenantId, id)) === 0) throw new BadRequestException("candidate must have at least one active signal");
        if (Math.max(Number(candidate.candidate_score ?? candidate.score ?? -1), Number(candidate.confidence_score ?? -1)) < 60) {
          throw new BadRequestException("candidate score or confidence score must be at least 60");
        }
        const duplicate = await client.query(
          "SELECT 1 FROM opportunities WHERE tenant_id = $1 AND source_candidate_id = $2 AND status <> 'archived' AND deleted_at IS NULL LIMIT 1",
          [request.auth.tenantId, id],
        );
        if (duplicate.rows[0] && !body.override_reason && !body.conversion_override_reason) {
          throw new BadRequestException("duplicate active opportunity from candidate requires override reason");
        }
        const title = optionalText(body.opportunity_name ?? body.title ?? body.name) ?? String(candidate.name ?? candidate.title);
        const relationshipAccessScore = await this.relationshipAccessForMap(client, request.auth.tenantId, candidate.relationship_map_id);
        const warnings = this.relationshipWarnings(candidate.relationship_map_id, relationshipAccessScore);
        const ownerUserId = optionalText(body.owner_user_id) ?? candidate.owner_user_id;
        if (ownerUserId) await this.requireTenantUser(client, request.auth.tenantId, ownerUserId);
        const opportunity = await insertTenantRecord(client, "opportunities", request.auth.tenantId, {
          candidate_id: id,
          source_candidate_id: id,
          source_type: "candidate_conversion",
          organization_id: candidate.organization_id,
          territory_id: candidate.territory_id,
          owner_user_id: ownerUserId,
          title,
          summary: candidate.summary ?? candidate.evidence_summary,
          evidence_summary: candidate.summary ?? candidate.evidence_summary,
          work_type: normalizeWorkType(candidate.work_type ?? "unknown"),
          estimated_value: candidate.estimated_value,
          relationship_map_id: candidate.relationship_map_id,
          relationship_access_score: relationshipAccessScore,
          pursuit_score: candidate.candidate_score ?? candidate.score ?? candidate.confidence_score,
          signal_strength_score: candidate.confidence_score,
          status: normalizeOpportunityStatusInput(body.status ?? "draft"),
          stage: normalizeOpportunityStatusInput(body.status ?? "draft"),
          relationship_access_override_reason: optionalText(body.relationship_access_override_reason),
          risk_notes: optionalText(body.conversion_note),
        });
        const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, opportunity.id);
        return {
          entityType: "opportunity",
          entityId: opportunity.id,
          afterState: { ...(enriched ?? opportunity), warnings },
          additionalEvents: [
            {
              action: "opportunity.convert_from_candidate",
              aggregateType: "opportunity",
              entityType: "opportunity",
              entityId: opportunity.id,
              eventType: "opportunity.converted_from_candidate",
              afterState: { ...(enriched ?? opportunity), source_candidate_id: id, conversion_note: body.conversion_note },
              systemActions: [{ actionType: "opportunity.converted_from_candidate.processed", payload: { action: "opportunity.convert_from_candidate" } }],
            },
          ],
        };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities")
  @RequirePermission("opportunity.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.opportunity_name ?? body.title ?? body.name, "opportunity_name is required");
      const values = await this.opportunityValues(body, true);
      return await this.write(request, "opportunity.create", "opportunity.created", "opportunity", async (client) => {
        if (body.candidate_id && !body.source_candidate_id) {
          const candidate = await this.requireCandidate(client, request.auth.tenantId, body.candidate_id);
          if (candidate.status !== "qualified_candidate") throw new BadRequestException("candidate must be qualified_candidate");
          values.organization_id ??= candidate.organization_id;
          values.territory_id ??= candidate.territory_id;
          values.work_type ??= candidate.work_type;
          values.summary ??= candidate.summary ?? candidate.evidence_summary;
          values.evidence_summary ??= candidate.summary ?? candidate.evidence_summary;
          values.owner_user_id ??= candidate.owner_user_id;
          if (body.status === undefined) {
            values.status = "qualified";
            values.stage = "qualified";
          }
        }
        await this.validateOpportunityRelations(client, request.auth.tenantId, values);
        const relationshipAccessScore = await this.relationshipAccessForMap(client, request.auth.tenantId, values.relationship_map_id);
        if (values.relationship_map_id) values.relationship_access_score = relationshipAccessScore;
        const opportunity = await insertTenantRecord(client, "opportunities", request.auth.tenantId, {
          ...values,
          title,
          status: values.status ?? "draft",
          stage: values.stage ?? values.status ?? "draft",
        });
        const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, opportunity.id);
        return { entityType: "opportunity", entityId: opportunity.id, afterState: { ...(enriched ?? opportunity), warnings: this.relationshipWarnings(values.relationship_map_id, relationshipAccessScore) } };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("opportunities/:id")
  @RequirePermission("opportunity.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
      const values = await this.opportunityValues(body, false);
      if (body.opportunity_name !== undefined || body.title !== undefined || body.name !== undefined) {
        values.title = requireString(body.opportunity_name ?? body.title ?? body.name, "opportunity_name is required");
      }
      return await this.write(request, "opportunity.update", "opportunity.updated", "opportunity", async (client) => {
        const before = await this.requireOpportunity(client, request.auth.tenantId, id);
        if (before.status === "archived") throw new BadRequestException("Archived opportunities cannot be updated.");
        await this.validateOpportunityRelations(client, request.auth.tenantId, { ...before, ...values });
        if (values.relationship_map_id !== undefined) values.relationship_access_score = await this.relationshipAccessForMap(client, request.auth.tenantId, values.relationship_map_id);
        const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("opportunity not found");
        const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
        return { entityType: "opportunity", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/assign-owner")
  @RequirePermission("opportunity.assign_owner")
  async assignOwner(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const ownerUserId = requireString(body.owner_user_id, "owner_user_id is required");
      return await this.write(request, "opportunity.assign_owner", "opportunity.owner_assigned", "opportunity", async (client) => {
        await this.requireTenantUser(client, request.auth.tenantId, ownerUserId);
        const before = await this.requireOpportunity(client, request.auth.tenantId, id);
        const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { owner_user_id: ownerUserId });
        if (!after) throw new NotFoundException("opportunity not found");
        const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
        return { entityType: "opportunity", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/link-relationship-map")
  @RequirePermission("opportunity.link_relationship_map")
  async linkRelationshipMap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const relationshipMapId = requireString(body.relationship_map_id, "relationship_map_id is required");
      return await this.write(request, "opportunity.link_relationship_map", "opportunity.relationship_map_linked", "opportunity", async (client) => {
        const before = await this.requireOpportunity(client, request.auth.tenantId, id);
        const map = await this.requireRelationshipMap(client, request.auth.tenantId, relationshipMapId);
        if (before.organization_id && map.target_organization_id && before.organization_id !== map.target_organization_id && !body.override_reason) {
          throw new BadRequestException("relationship map organization mismatch requires override_reason");
        }
        const score = await this.relationshipAccessForMap(client, request.auth.tenantId, relationshipMapId);
        const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { relationship_map_id: relationshipMapId, relationship_access_score: score });
        if (!after) throw new NotFoundException("opportunity not found");
        const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
        return { entityType: "opportunity", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/unlink-relationship-map")
  @RequirePermission("opportunity.link_relationship_map")
  async unlinkRelationshipMap(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity.link_relationship_map", "opportunity.relationship_map_unlinked", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { relationship_map_id: null, relationship_access_score: null });
      if (!after) throw new NotFoundException("opportunity not found");
      const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: enriched ?? after };
    });
  }

  @Post("opportunities/:id/submit-for-review")
  @RequirePermission("opportunity.submit_review")
  async submitForReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.pursuit_review_reason ?? body.reason, "pursuit_review_reason is required");
      return await this.write(request, "opportunity.submit_review", "opportunity.pursuit_review_submitted", "opportunity", async (client) => {
        const before = await this.requireOpportunity(client, request.auth.tenantId, id);
        if (!["draft", "qualified"].includes(normalizeOpportunityStatus(before.status))) throw new BadRequestException("opportunity must be draft");
        const blockers = this.coreBlockers(before);
        if (blockers.length) throw new BadRequestException(`opportunity is missing required core fields: ${blockers.join(", ")}`);
        const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
          status: "pursuit_review",
          stage: "pursuit_review",
          pursuit_review_reason: reason,
          pursuit_review_note: optionalText(body.pursuit_review_note ?? body.note),
        });
        if (!after) throw new NotFoundException("opportunity not found");
        const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
        return { entityType: "opportunity", entityId: id, beforeState: before, afterState: enriched ?? after };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/pursuit-approve")
  @RequirePermission("opportunity.pursuit_approve")
  async pursuitApprove(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "opportunity.pursuit_approve", "opportunity.pursuit_approved", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status === "archived") throw new BadRequestException("Archived opportunities cannot be approved.");
      if (!["draft", "pursuit_review", "qualified"].includes(normalizeOpportunityStatus(before.status))) throw new BadRequestException("opportunity must be in pursuit review");
      const blockers = this.coreBlockers(before);
      if (blockers.length) throw new BadRequestException(`opportunity is missing required core fields: ${blockers.join(", ")}`);
      const openCriticalConstraints = await this.openCriticalConstraintCount(client, request.auth.tenantId, id);
      if (openCriticalConstraints > 0 && !body.constraints_override_reason) throw new BadRequestException("Pursuit approval requires override reason for warnings.");
      const warnings = await this.approvalWarnings(client, request.auth.tenantId, before);
      const missingOverride = warnings.some((warning) => !this.overrideForWarning(warning, body));
      if (missingOverride) {
        throw new BadRequestException({ message: "Pursuit approval requires override reason for warnings.", warnings });
      }
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        status: "pursuit_approved",
        stage: "pursuit_approved",
        pursuit_approved_by: request.auth.userId,
        pursuit_approved_at: new Date(),
        pursuit_approval_override_reason: optionalText(body.pursuit_approval_override_reason),
        pursuit_approval_override_note: optionalText(body.pursuit_approval_override_note ?? body.approval_note),
        relationship_access_override_reason: optionalText(body.relationship_access_override_reason),
        capacity_override_reason: optionalText(body.capacity_override_reason),
        margin_override_reason: optionalText(body.margin_override_reason),
        constraints_override_reason: optionalText(body.constraints_override_reason),
      });
      if (!after) throw new NotFoundException("opportunity not found");
      const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: { ...(enriched ?? after), warnings } };
    });
  }

  @Post("opportunities/:id/pursue")
  @RequirePermission("opportunity.pursue")
  async pursue(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.transition(request, id, "opportunity.pursue", "opportunity.pursuing", "pursuing", ["pursuit_approved"], body);
  }

  @Post("opportunities/:id/proposal")
  @RequirePermission("opportunity.proposal")
  async proposal(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "opportunity.proposal", "opportunity.proposal", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (normalizeOpportunityStatus(before.status) !== "pursuing") throw new BadRequestException("opportunity must be pursuing");
      const scope = optionalText(body.scope_summary) ?? before.scope_summary;
      const estimatedValue = body.estimated_value ?? before.estimated_value;
      requireString(scope, "scope_summary is required");
      if (estimatedValue === undefined || estimatedValue === null || Number(estimatedValue) <= 0) throw new BadRequestException("estimated_value is required");
      if (!(await this.capacityRequirementExists(client, request.auth.tenantId, id))) throw new BadRequestException("capacity requirement is required");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        status: "bid_proposal",
        stage: "bid_proposal",
        scope_summary: scope,
        estimated_value: nonNegativeNumber(estimatedValue, "estimated_value"),
        proposal_submitted_at: new Date(),
      });
      if (!after) throw new NotFoundException("opportunity not found");
      const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: enriched ?? after };
    });
  }

  @Post("opportunities/:id/negotiation")
  @RequirePermission("opportunity.negotiation")
  async negotiation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.transition(request, id, "opportunity.negotiation", "opportunity.negotiation", "negotiation", ["proposal"], body);
  }

  @Post("opportunities/:id/award")
  @RequirePermission("opportunity.award")
  async award(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "opportunity.award", "opportunity.awarded", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      await this.requireAuthority(client, request.auth.tenantId, request.auth.userId);
      if (normalizeOpportunityStatus(before.status) !== "negotiation") throw new BadRequestException("opportunity must be negotiation");
      const awardEvidence = optionalText(body.award_evidence) ?? before.award_evidence;
      const customerConfirmation = optionalText(body.customer_confirmation) ?? before.customer_confirmation;
      requireString(awardEvidence, "award_evidence is required");
      requireString(customerConfirmation, "customer_confirmation is required");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        status: "awarded",
        stage: "awarded",
        award_evidence: awardEvidence,
        customer_confirmation: customerConfirmation,
        awarded_by: request.auth.userId,
        awarded_at: new Date(),
      });
      if (!after) throw new NotFoundException("opportunity not found");
      const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
      return {
        entityType: "opportunity",
        entityId: id,
        beforeState: before,
        afterState: { ...(enriched ?? after), handoff_message: "Awarded opportunity is ready for future project handoff. No project was created." },
      };
    });
  }

  @Post("opportunities/:id/lost")
  @RequirePermission("opportunity.lost")
  async lost(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const lostReason = requireAllowed(body.lost_reason ?? body.loss_reason, lostReasons, "lost reason");
      return await this.statusWithFields(request, id, "opportunity.lost", "opportunity.lost", "lost", {
        lost_reason: lostReason,
        lost_note: optionalText(body.lost_note ?? body.note),
        lost_by: request.auth.userId,
        lost_at: new Date(),
        loss_reason: lostReason,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/defer")
  @RequirePermission("opportunity.defer")
  async defer(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const deferredReason = requireAllowed(body.deferred_reason ?? body.deferral_reason, deferredReasons, "deferred reason");
      const deferredUntil = dateOnly(body.deferred_until ?? body.review_date);
      return await this.statusWithFields(request, id, "opportunity.defer", "opportunity.deferred", "deferred", {
        deferred_reason: deferredReason,
        deferred_note: optionalText(body.deferred_note ?? body.note),
        deferred_until: deferredUntil,
        deferred_by: request.auth.userId,
        deferred_at: new Date(),
        deferral_reason: deferredReason,
        review_date: deferredUntil,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunities/:id/archive")
  @RequirePermission("opportunity.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const archiveReason = requireAllowed(body.archive_reason ?? body.reason, archiveReasons, "archive reason");
      return await this.statusWithFields(request, id, "opportunity.archive", "opportunity.archived", "archived", {
        archive_reason: archiveReason,
        archive_note: optionalText(body.archive_note ?? body.note),
        archived_by: request.auth.userId,
        archived_at: new Date(),
      });
    } catch {
      throw new BadRequestException("Archive reason is required.");
    }
  }

  @Post("opportunities/:id/score")
  @RequirePermission("opportunity.score")
  async score(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "opportunity.score", "opportunity.scored", "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      const summary = this.calculateScore(before);
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        pursuit_score: summary.pursuit_score,
        recommendation: summary.recommendation,
      });
      if (!after) throw new NotFoundException("opportunity not found");
      const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: { ...(enriched ?? after), score_summary: summary } };
    });
  }

  @Get("opportunities/:id/score-summary")
  @RequirePermission("opportunity.read")
  async scoreSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const opportunity = await this.requireOpportunity(client, request.auth.tenantId, id);
      return this.calculateScore(opportunity);
    });
  }

  @Get("opportunities/:id/capacity-requirements")
  @RequirePermission("capacity_requirement.read")
  async listCapacityRequirements(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, id);
      return this.capacityRequirements(client, request.auth.tenantId, id);
    });
  }

  @Post("opportunities/:id/capacity-requirements")
  @RequirePermission("capacity_requirement.create")
  async createCapacityRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const capacityType = requireString(body.capacity_type ?? body.work_type ?? body.required_crew_type, "capacity_type is required");
      const quantity = positiveNumber(body.quantity ?? body.estimated_quantity, "quantity");
      const unit = requireString(body.unit, "unit is required");
      const status = body.status === undefined ? "active" : requireAllowed(body.status, capacityRequirementStatuses, "capacity requirement status");
      return await this.write(request, "capacity_requirement.create", "capacity_requirement.created", "capacity_requirement", async (client) => {
        await this.requireOpportunity(client, request.auth.tenantId, id);
        if (body.territory_id) await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
        const requirement = await insertTenantRecord(client, "opportunity_capacity_requirements", request.auth.tenantId, {
          opportunity_id: id,
          capacity_type: capacityType,
          work_type: optionalText(body.work_type) ?? capacityType,
          required_crew_type: optionalText(body.required_crew_type) ?? capacityType,
          quantity,
          estimated_quantity: quantity,
          unit,
          territory_id: body.territory_id,
          start_date: dateOnly(body.start_date ?? body.required_start_date),
          end_date: dateOnly(body.end_date ?? body.required_end_date),
          required_start_date: dateOnly(body.required_start_date ?? body.start_date),
          required_end_date: dateOnly(body.required_end_date ?? body.end_date),
          notes: optionalText(body.notes),
          status,
        });
        return { entityType: "capacity_requirement", entityId: requirement.id, afterState: requirement };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("opportunity-capacity-requirements/:id")
  @RequirePermission("capacity_requirement.update")
  async updateCapacityRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["capacity_type", "work_type", "required_crew_type", "unit", "notes"]);
      if (body.quantity !== undefined || body.estimated_quantity !== undefined) {
        const quantity = positiveNumber(body.quantity ?? body.estimated_quantity, "quantity");
        values.quantity = quantity;
        values.estimated_quantity = quantity;
      }
      if (body.start_date !== undefined || body.required_start_date !== undefined) {
        const startDate = dateOnly(body.start_date ?? body.required_start_date);
        values.start_date = startDate;
        values.required_start_date = startDate;
      }
      if (body.end_date !== undefined || body.required_end_date !== undefined) {
        const endDate = dateOnly(body.end_date ?? body.required_end_date);
        values.end_date = endDate;
        values.required_end_date = endDate;
      }
      if (body.status !== undefined) values.status = requireAllowed(body.status, capacityRequirementStatuses, "capacity requirement status");
      return await this.write(request, "capacity_requirement.update", "capacity_requirement.updated", "capacity_requirement", async (client) => {
        const before = await this.requireCapacityRequirement(client, request.auth.tenantId, id);
        if (body.opportunity_id) {
          if (typeof body.opportunity_id !== "string") throw new Error("opportunity_id must be a string");
          await this.requireOpportunity(client, request.auth.tenantId, body.opportunity_id);
          values.opportunity_id = body.opportunity_id;
        }
        if (body.territory_id) {
          await this.requireTerritory(client, request.auth.tenantId, body.territory_id);
          values.territory_id = body.territory_id;
        }
        const after = await updateTenantRecord(client, "opportunity_capacity_requirements", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("capacity requirement not found");
        return { entityType: "capacity_requirement", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("opportunity-capacity-requirements/:id/archive")
  @RequirePermission("capacity_requirement.archive")
  async archiveCapacityRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const archiveReason = requireAllowed(body.archive_reason ?? body.reason, capacityArchiveReasons, "archive reason");
      return await this.write(request, "capacity_requirement.archive", "capacity_requirement.archived", "capacity_requirement", async (client) => {
        const before = await this.requireCapacityRequirement(client, request.auth.tenantId, id);
        const after = await updateTenantRecord(client, "opportunity_capacity_requirements", request.auth.tenantId, id, {
          status: "archived",
          archive_reason: archiveReason,
          archive_note: optionalText(body.archive_note ?? body.note),
          archived_by: request.auth.userId,
          archived_at: new Date(),
        });
        if (!after) throw new NotFoundException("capacity requirement not found");
        return { entityType: "capacity_requirement", entityId: id, beforeState: before, afterState: after };
      });
    } catch {
      throw new BadRequestException("Archive reason is required.");
    }
  }

  private async listEnrichedOpportunities(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const rows = await this.baseOpportunityRows(client, tenantId);
    let enriched: QueryResultRow[] = await Promise.all(rows.map((row) => this.enrichOpportunityRow(client, tenantId, row)));
    enriched = this.filterOpportunities(enriched, query);
    enriched = this.sortOpportunities(enriched, query.sort);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(query.offset ?? 0), 0);
    return enriched.slice(offset, offset + limit);
  }

  private async getEnrichedOpportunity(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.baseOpportunityRows(client, tenantId, id);
    if (!rows[0]) return null;
    return this.enrichOpportunityRow(client, tenantId, rows[0]);
  }

  private async getDetail(client: PoolClient, tenantId: string, id: string) {
    const opportunity = await this.getEnrichedOpportunity(client, tenantId, id);
    if (!opportunity) throw new NotFoundException("opportunity not found");
    const [sourceCandidate, organization, relationshipMap, capacityRequirements, constraints, recommendations] = await Promise.all([
      opportunity.source_candidate_id ? this.findById(client, "opportunity_candidates", tenantId, opportunity.source_candidate_id) : null,
      opportunity.organization_id ? this.findById(client, "organizations", tenantId, opportunity.organization_id) : null,
      opportunity.relationship_map_id ? this.relationshipMapContext(client, tenantId, opportunity.relationship_map_id) : null,
      this.capacityRequirements(client, tenantId, id),
      this.relatedConstraints(client, tenantId, id),
      this.relatedRecommendations(client, tenantId, id),
    ]);
    return {
      opportunity,
      source_candidate: sourceCandidate ? await this.sourceCandidateContext(client, tenantId, sourceCandidate.id) : null,
      organization_context: organization ? this.organizationContext(organization) : null,
      relationship_map_context: relationshipMap,
      capacity_requirements: capacityRequirements,
      constraints_summary: constraints,
      recommendations_summary: recommendations,
      score_summary: this.calculateScore(opportunity),
      readiness: opportunity.readiness,
      warnings: opportunity.warnings,
      blockers: opportunity.blockers,
      audit_allowed: true,
      timeline_available: true,
    };
  }

  private async baseOpportunityRows(client: PoolClient, tenantId: string, id?: string) {
    const result = await client.query<OpportunityRow>(
      `
      SELECT
        o.*,
        o.title AS opportunity_name,
        sc.name AS source_candidate_name,
        sc.title AS source_candidate_title,
        org.name AS organization_name,
        org.organization_type,
        org.actor_roles AS organization_actor_roles,
        cust.name AS customer_organization_name,
        t.name AS territory_name,
        rm.name AS relationship_map_name,
        u.display_name AS owner_name,
        (SELECT count(*)::int FROM opportunity_capacity_requirements cr WHERE cr.tenant_id = o.tenant_id AND cr.opportunity_id = o.id AND cr.status = 'active' AND cr.deleted_at IS NULL) AS capacity_requirement_count,
        (SELECT count(*)::int FROM constraints c WHERE c.tenant_id = o.tenant_id AND c.affected_object_type = 'opportunity' AND c.affected_object_id = o.id AND c.status NOT IN ('resolved', 'verified', 'closed', 'archived') AND c.deleted_at IS NULL) AS open_constraints_count,
        (SELECT count(*)::int FROM recommendations r WHERE r.tenant_id = o.tenant_id AND r.related_object_type = 'opportunity' AND r.related_object_id = o.id AND r.status <> 'archived' AND r.deleted_at IS NULL) AS recommendations_count
      FROM opportunities o
      LEFT JOIN opportunity_candidates sc ON sc.id = o.source_candidate_id AND sc.tenant_id = o.tenant_id
      LEFT JOIN organizations org ON org.id = o.organization_id AND org.tenant_id = o.tenant_id
      LEFT JOIN organizations cust ON cust.id = o.customer_organization_id AND cust.tenant_id = o.tenant_id
      LEFT JOIN territories t ON t.id = o.territory_id AND t.tenant_id = o.tenant_id
      LEFT JOIN relationship_maps rm ON rm.id = o.relationship_map_id AND rm.tenant_id = o.tenant_id
      LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.tenant_id = $1
        AND o.deleted_at IS NULL
        ${id ? "AND o.id = $2" : ""}
      ORDER BY o.updated_at DESC
      `,
      id ? [tenantId, id] : [tenantId],
    );
    return result.rows;
  }

  private async enrichOpportunityRow(client: PoolClient, tenantId: string, row: OpportunityRow) {
    const relationshipScore = row.relationship_map_id ? await this.relationshipAccessForMap(client, tenantId, row.relationship_map_id) : nullableNumber(row.relationship_access_score);
    const capacityCount = Number(row.capacity_requirement_count ?? 0);
    const criticalConstraints = await this.openCriticalConstraintCount(client, tenantId, row.id);
    const warnings = this.readinessWarnings({ ...row, relationship_access_score: relationshipScore }, capacityCount, criticalConstraints);
    const blockers = this.coreBlockers(row);
    const readiness = this.readiness(row, capacityCount, criticalConstraints, warnings, blockers);
    return {
      ...row,
      opportunity_name: row.opportunity_name ?? row.title,
      source_candidate_name: row.source_candidate_name ?? row.source_candidate_title,
      normalized_status: normalizeOpportunityStatus(row.status),
      relationship_access_score: relationshipScore,
      capacity_requirement_count: capacityCount,
      open_constraints_count: Number(row.open_constraints_count ?? 0),
      recommendations_count: Number(row.recommendations_count ?? 0),
      readiness,
      readiness_score: readiness.readiness_score,
      readiness_band: readiness.readiness_band,
      warnings,
      blockers,
      recommended_next_action: this.recommendedNextAction({ ...row, relationship_access_score: relationshipScore, normalized_status: normalizeOpportunityStatus(row.status) }, capacityCount, criticalConstraints),
    };
  }

  private filterOpportunities(rows: QueryResultRow[], query: Record<string, string | undefined>) {
    return rows.filter((row) => {
      if (query.status && row.status !== query.status) return false;
      if (query.normalized_status && row.normalized_status !== query.normalized_status) return false;
      if (query.organization_id && row.organization_id !== query.organization_id) return false;
      if (query.customer_organization_id && row.customer_organization_id !== query.customer_organization_id) return false;
      if (query.territory_id && row.territory_id !== query.territory_id) return false;
      if (query.work_type && row.work_type !== query.work_type) return false;
      if (query.owner_user_id && row.owner_user_id !== query.owner_user_id) return false;
      if (query.source_candidate_id && row.source_candidate_id !== query.source_candidate_id) return false;
      if (query.has_source_candidate && bool(query.has_source_candidate) !== Boolean(row.source_candidate_id)) return false;
      if (query.has_relationship_map && bool(query.has_relationship_map) !== Boolean(row.relationship_map_id)) return false;
      if (query.has_capacity_requirements && bool(query.has_capacity_requirements) !== Number(row.capacity_requirement_count ?? 0) > 0) return false;
      if (query.has_open_constraints && bool(query.has_open_constraints) !== Number(row.open_constraints_count ?? 0) > 0) return false;
      if (query.archived && bool(query.archived) !== (row.normalized_status === "archived" || Boolean(row.archived_at))) return false;
      if (query.estimated_value_min && Number(row.estimated_value ?? 0) < Number(query.estimated_value_min)) return false;
      if (query.estimated_value_max && Number(row.estimated_value ?? 0) > Number(query.estimated_value_max)) return false;
      if (query.pursuit_score_min && Number(row.pursuit_score ?? 0) < Number(query.pursuit_score_min)) return false;
      if (query.pursuit_score_max && Number(row.pursuit_score ?? 0) > Number(query.pursuit_score_max)) return false;
      if (query.relationship_access_min && Number(row.relationship_access_score ?? 0) < Number(query.relationship_access_min)) return false;
      if (query.relationship_access_max && Number(row.relationship_access_score ?? 0) > Number(query.relationship_access_max)) return false;
      if (query.expected_decision_from && dateNumber(row.expected_decision_date) < dateNumber(query.expected_decision_from)) return false;
      if (query.expected_decision_to && dateNumber(row.expected_decision_date) > dateNumber(query.expected_decision_to)) return false;
      if (query.q) {
        const haystack = [row.opportunity_name, row.title, row.organization_name, row.work_type, row.status].join(" ").toLowerCase();
        if (!haystack.includes(query.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  private sortOpportunities(rows: QueryResultRow[], sort = "default") {
    const sorted = [...rows];
    const compare = (a: QueryResultRow, b: QueryResultRow) => {
      switch (sort) {
        case "created_desc":
          return dateNumber(b.created_at) - dateNumber(a.created_at);
        case "estimated_value_desc":
          return Number(b.estimated_value ?? -1) - Number(a.estimated_value ?? -1);
        case "pursuit_score_desc":
          return Number(b.pursuit_score ?? -1) - Number(a.pursuit_score ?? -1);
        case "relationship_access_desc":
          return Number(b.relationship_access_score ?? -1) - Number(a.relationship_access_score ?? -1);
        case "expected_decision_asc":
          return dateNumber(a.expected_decision_date) - dateNumber(b.expected_decision_date);
        case "status":
          return String(a.normalized_status).localeCompare(String(b.normalized_status));
        case "organization":
          return String(a.organization_name ?? "").localeCompare(String(b.organization_name ?? ""));
        case "updated_desc":
          return dateNumber(b.updated_at) - dateNumber(a.updated_at);
        default:
          return Number(b.estimated_value ?? -1) - Number(a.estimated_value ?? -1) || dateNumber(a.expected_decision_date) - dateNumber(b.expected_decision_date) || dateNumber(b.updated_at) - dateNumber(a.updated_at);
      }
    };
    return sorted.sort(compare);
  }

  private async opportunityValues(body: Record<string, unknown>, creating: boolean) {
    const values: Record<string, unknown> = pick(body, [
      "summary",
      "evidence_summary",
      "scope_summary",
      "next_action",
      "risk_notes",
      "location_summary",
      "source_candidate_id",
      "candidate_id",
      "organization_id",
      "customer_organization_id",
      "prime_organization_id",
      "engineering_firm_organization_id",
      "territory_id",
      "owner_user_id",
      "relationship_map_id",
      "expected_start_date",
      "expected_decision_date",
      "bid_due_date",
    ]);
    if (body.source_type !== undefined) values.source_type = requireAllowed(body.source_type, sourceTypes, "source_type");
    if (body.work_type !== undefined || creating) values.work_type = normalizeWorkType(body.work_type ?? "unknown");
    if (body.status !== undefined || creating) values.status = normalizeOpportunityStatusInput(body.status ?? "draft");
    if (body.estimated_value !== undefined) values.estimated_value = nonNegativeNumber(body.estimated_value, "estimated_value");
    if (body.probability !== undefined) values.probability = optionalScore(body.probability, "probability");
    for (const field of this.scoreFields()) {
      if (body[field] !== undefined) values[field] = optionalScore(body[field], field);
    }
    if (body.relationship_access_score !== undefined) values.relationship_access_score = optionalScore(body.relationship_access_score, "relationship_access_score");
    if (values.source_candidate_id === undefined && body.candidate_id) values.source_candidate_id = body.candidate_id;
    if (values.candidate_id === undefined && body.source_candidate_id) values.candidate_id = body.source_candidate_id;
    if (values.summary && !values.evidence_summary) values.evidence_summary = values.summary;
    if (values.evidence_summary && !values.summary) values.summary = values.evidence_summary;
    for (const field of ["expected_start_date", "expected_decision_date", "bid_due_date"]) {
      if (values[field]) values[field] = dateOnly(values[field]);
    }
    return values;
  }

  private async validateOpportunityRelations(client: PoolClient, tenantId: string, values: Record<string, unknown>) {
    await this.requireOrganization(client, tenantId, values.organization_id);
    if (values.customer_organization_id) await this.requireOrganization(client, tenantId, values.customer_organization_id);
    if (values.prime_organization_id) await this.requireOrganization(client, tenantId, values.prime_organization_id);
    if (values.engineering_firm_organization_id) await this.requireOrganization(client, tenantId, values.engineering_firm_organization_id);
    await this.requireTerritory(client, tenantId, values.territory_id);
    await this.requireTenantUser(client, tenantId, values.owner_user_id);
    if (values.source_candidate_id) await this.requireCandidate(client, tenantId, values.source_candidate_id);
    if (values.candidate_id) await this.requireCandidate(client, tenantId, values.candidate_id);
    if (values.relationship_map_id) await this.requireRelationshipMap(client, tenantId, values.relationship_map_id);
  }

  private async statusWithFields(request: AuthenticatedRequest, id: string, action: string, eventType: string, status: string, values: Record<string, unknown>) {
    return this.write(request, action, eventType, "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status === "archived") throw new BadRequestException("Archived opportunities cannot be updated.");
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, { ...values, status, stage: status });
      if (!after) throw new NotFoundException("opportunity not found");
      const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: enriched ?? after };
    });
  }

  private async transition(request: AuthenticatedRequest, id: string, action: string, eventType: string, status: string, allowedFrom: string[], body: Record<string, unknown>) {
    return this.write(request, action, eventType, "opportunity", async (client) => {
      const before = await this.requireOpportunity(client, request.auth.tenantId, id);
      if (before.status === "archived") throw new BadRequestException("Archived opportunities cannot be updated.");
      if (!allowedFrom.includes(normalizeOpportunityStatus(before.status))) throw new BadRequestException(`opportunity must be ${allowedFrom.join(" or ")}`);
      const after = await updateTenantRecord(client, "opportunities", request.auth.tenantId, id, {
        status,
        stage: status,
        next_action: optionalText(body.next_action) ?? before.next_action,
      });
      if (!after) throw new NotFoundException("opportunity not found");
      const enriched = await this.getEnrichedOpportunity(client, request.auth.tenantId, id);
      return { entityType: "opportunity", entityId: id, beforeState: before, afterState: { ...(enriched ?? after), reason: body.reason, note: body.note } };
    });
  }

  private calculateScore(opportunity: Record<string, unknown>) {
    const signalStrength = Number(opportunity.signal_strength_score ?? 0);
    const relationshipAccess = Number(opportunity.relationship_access_score ?? 0);
    const capacityFit = Number(opportunity.capacity_readiness_score ?? opportunity.capacity_fit_score ?? 0);
    const marginPotential = Number(opportunity.margin_potential_score ?? 0);
    const strategicFit = Number(opportunity.strategic_fit_score ?? 0);
    const paymentRisk = Number(opportunity.payment_risk_score ?? 50);
    const raw = signalStrength * 0.2 + relationshipAccess * 0.2 + capacityFit * 0.2 + marginPotential * 0.15 + strategicFit * 0.15 + (100 - paymentRisk) * 0.1;
    const pursuitScore = Math.max(0, Math.min(100, Number(raw.toFixed(4))));
    return {
      signal_strength_score: signalStrength,
      relationship_access_score: relationshipAccess,
      capacity_readiness_score: capacityFit,
      capacity_fit_score: capacityFit,
      margin_potential_score: marginPotential,
      strategic_fit_score: strategicFit,
      payment_risk_score: paymentRisk,
      probability: nullableNumber(opportunity.probability),
      pursuit_score: pursuitScore,
      recommendation: this.recommendation(pursuitScore),
    };
  }

  private recommendation(score: number) {
    if (score < 40) return "Avoid";
    if (score < 70) return "Monitor";
    if (score < 85) return "Pursue";
    return "Priority Pursuit";
  }

  private readiness(row: QueryResultRow, capacityCount: number, criticalConstraints: number, warnings: string[], blockers: string[]) {
    const checks = [
      ["organization_attached", Boolean(row.organization_id)],
      ["territory_attached", Boolean(row.territory_id)],
      ["owner_assigned", Boolean(row.owner_user_id)],
      ["estimated_value_captured", row.estimated_value !== null && row.estimated_value !== undefined],
      ["source_candidate_attached_or_manual_source_reason", Boolean(row.source_candidate_id || row.source_type)],
      ["relationship_access_reviewed", Boolean(row.relationship_map_id) || row.relationship_access_override_reason !== null],
      ["capacity_requirements_reviewed", capacityCount > 0 || row.capacity_override_reason !== null],
      ["critical_constraints_reviewed", criticalConstraints === 0 || row.constraints_override_reason !== null],
      ["pursuit_score_captured_if_supported", row.pursuit_score !== null && row.pursuit_score !== undefined],
    ] as const;
    const completed = checks.filter(([, done]) => done).length;
    const readinessScore = Math.round((completed / checks.length) * 100);
    const missing = checks.filter(([, done]) => !done).map(([key]) => key);
    return {
      checks: Object.fromEntries(checks),
      readiness_score: readinessScore,
      readiness_band: band(readinessScore),
      missing_items: missing,
      warnings,
      blockers,
      ready_for_pursuit_approval: blockers.length === 0 && criticalConstraints === 0,
    };
  }

  private readinessWarnings(row: QueryResultRow, capacityCount: number, criticalConstraints: number) {
    const warnings: string[] = [];
    if (!row.relationship_map_id) warnings.push("missing_relationship_map");
    if (row.relationship_access_score === null || row.relationship_access_score === undefined || Number(row.relationship_access_score) < 50) warnings.push("weak_relationship_access");
    if (capacityCount === 0) warnings.push("missing_capacity_requirements");
    if (row.capacity_readiness_score === null && row.capacity_fit_score === null) warnings.push("missing_capacity_readiness");
    if (row.margin_potential_score === null || row.margin_potential_score === undefined) warnings.push("missing_margin_potential");
    if (row.pursuit_score === null || row.pursuit_score === undefined) warnings.push("missing_pursuit_score");
    if (criticalConstraints > 0) warnings.push("open_critical_constraints");
    return warnings;
  }

  private async approvalWarnings(client: PoolClient, tenantId: string, opportunity: QueryResultRow) {
    const capacityCount = await this.capacityRequirementCount(client, tenantId, opportunity.id);
    const criticalConstraints = await this.openCriticalConstraintCount(client, tenantId, opportunity.id);
    const warnings = this.readinessWarnings(opportunity, capacityCount, criticalConstraints);
    const hasLegacyRelationshipPath = await this.relationshipPathExists(client, tenantId, opportunity);
    const relationshipScore = nullableNumber(opportunity.relationship_access_score);
    return warnings.filter((warning) => {
      if (warning === "missing_relationship_map") return !hasLegacyRelationshipPath && relationshipScore !== null && relationshipScore < 50;
      if (warning === "weak_relationship_access") return relationshipScore === null || relationshipScore < 50;
      if (warning === "missing_capacity_requirements") return capacityCount === 0 && nullableNumber(opportunity.capacity_readiness_score ?? opportunity.capacity_fit_score) === null;
      if (warning === "missing_capacity_readiness") return nullableNumber(opportunity.capacity_readiness_score ?? opportunity.capacity_fit_score) === null;
      return true;
    });
  }

  private overrideForWarning(warning: string, body: Record<string, unknown>) {
    if (warning === "missing_relationship_map" || warning === "weak_relationship_access") return body.relationship_access_override_reason;
    if (warning === "missing_capacity_requirements" || warning === "missing_capacity_readiness") return body.capacity_override_reason;
    if (warning === "missing_margin_potential") return body.margin_override_reason;
    if (warning === "open_critical_constraints") return body.constraints_override_reason;
    if (warning === "missing_pursuit_score") return body.pursuit_approval_override_reason;
    return true;
  }

  private relationshipWarnings(relationshipMapId: unknown, relationshipScore: unknown) {
    const warnings: string[] = [];
    if (!relationshipMapId) warnings.push("missing_relationship_map");
    if (relationshipScore === null || relationshipScore === undefined || Number(relationshipScore) < 50) warnings.push("weak_relationship_access");
    return warnings;
  }

  private coreBlockers(opportunity: QueryResultRow) {
    const blockers: string[] = [];
    if (!opportunity.organization_id) blockers.push("missing_organization");
    if (!opportunity.territory_id) blockers.push("missing_territory");
    if (!opportunity.owner_user_id) blockers.push("missing_owner");
    if (!storedOpportunityStatuses.has(String(opportunity.status))) blockers.push("invalid_status");
    if (opportunity.status === "archived") blockers.push("archived_opportunity");
    return blockers;
  }

  private recommendedNextAction(row: QueryResultRow, capacityCount: number, criticalConstraints: number) {
    const status = String(row.normalized_status ?? normalizeOpportunityStatus(row.status));
    if (status === "archived") return "view_only";
    if (!row.organization_id) return "attach_organization";
    if (!row.territory_id) return "attach_territory";
    if (!row.owner_user_id) return "assign_owner";
    if (!row.source_candidate_id && !row.source_type) return "define_source";
    if (!row.relationship_map_id) return "build_relationship_path";
    if (row.relationship_access_score === null || row.relationship_access_score === undefined || Number(row.relationship_access_score) < 50) return "relationship_constraint_review";
    if (capacityCount === 0) return "define_capacity_requirements";
    if (criticalConstraints > 0) return "resolve_constraints";
    if (status === "draft") return "submit_for_pursuit_review";
    if (status === "pursuit_review") return "approve_or_defer_pursuit";
    if (status === "pursuit_approved") return "begin_pursuit";
    if (status === "pursuing") return "prepare_proposal_or_negotiate";
    if (status === "proposal") return "follow_up_proposal";
    if (status === "negotiation") return "close_award_or_lost";
    if (status === "awarded") return "prepare_project_handoff_later";
    return "review_opportunity";
  }

  private async relationshipAccessForMap(client: PoolClient, tenantId: string, relationshipMapId: unknown) {
    if (!relationshipMapId) return null;
    const result = await client.query("SELECT COALESCE(access_score, 0) AS score FROM relationship_maps WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1", [tenantId, relationshipMapId]);
    if (!result.rows[0]) throw new NotFoundException("relationship map not found in tenant");
    return nullableNumber(result.rows[0].score);
  }

  private async sourceCandidateContext(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT
        c.id,
        c.name AS candidate_name,
        CASE WHEN c.status = 'qualified_candidate' THEN 'qualified' ELSE c.status END AS normalized_status,
        c.estimated_value,
        c.confidence_score,
        COALESCE(c.candidate_score, c.score) AS candidate_score,
        c.relationship_access_score,
        (SELECT count(*)::int FROM candidate_signals cs WHERE cs.tenant_id = c.tenant_id AND cs.candidate_id = c.id AND cs.status = 'active' AND cs.deleted_at IS NULL) AS active_signal_count
      FROM opportunity_candidates c
      WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private organizationContext(row: QueryResultRow) {
    return {
      id: row.id,
      name: row.name,
      organization_type: row.organization_type,
      actor_roles: row.actor_roles,
      territory_name: row.territory_name,
      status: row.status,
      strategic_flag: row.strategic_flag,
      influence_score: row.influence_score,
      work_relevance_score: row.work_relevance_score,
      capacity_relevance_score: row.capacity_relevance_score,
      payment_relevance_score: row.payment_relevance_score,
      recommended_next_action: row.recommended_next_action,
    };
  }

  private async relationshipMapContext(client: PoolClient, tenantId: string, id: string) {
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
        FROM relationship_paths rp
        WHERE rp.tenant_id = rm.tenant_id
          AND rp.relationship_map_id = rm.id
          AND rp.status = 'active'
          AND rp.deleted_at IS NULL
        ORDER BY (COALESCE(rp.strength_score, 0) * 0.6 + COALESCE(rp.confidence_score, 0) * 0.4) DESC, rp.rank ASC NULLS LAST, rp.updated_at DESC
        LIMIT 1
      ) bp ON true
      WHERE rm.tenant_id = $1 AND rm.id = $2 AND rm.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async relatedConstraints(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      "SELECT id, constraint_type, severity, owner_id, due_date, status, resolution_summary FROM constraints WHERE tenant_id = $1 AND affected_object_type = 'opportunity' AND affected_object_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25",
      [tenantId, id],
    );
    return result.rows;
  }

  private async relatedRecommendations(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      "SELECT id, recommendation_type, confidence_score, confidence, risk_level, expected_impact, status FROM recommendations WHERE tenant_id = $1 AND related_object_type = 'opportunity' AND related_object_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25",
      [tenantId, id],
    );
    return result.rows;
  }

  private async capacityRequirements(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query(
      `
      SELECT cr.*, t.name AS territory_name
      FROM opportunity_capacity_requirements cr
      LEFT JOIN territories t ON t.id = cr.territory_id AND t.tenant_id = cr.tenant_id
      WHERE cr.tenant_id = $1 AND cr.opportunity_id = $2 AND cr.deleted_at IS NULL
      ORDER BY cr.created_at DESC
      `,
      [tenantId, opportunityId],
    );
    return result.rows;
  }

  private async findById(client: PoolClient, table: string, tenantId: string, id: string) {
    return findTenantRecordById(client, table, tenantId, id);
  }

  private async requireOpportunity(client: PoolClient, tenantId: string, id: string) {
    const opportunity = await findTenantRecordById<OpportunityRow>(client, "opportunities", tenantId, id);
    if (!opportunity) throw new NotFoundException("opportunity not found");
    return opportunity;
  }

  private async requireCapacityRequirement(client: PoolClient, tenantId: string, id: string) {
    const requirement = await findTenantRecordById(client, "opportunity_capacity_requirements", tenantId, id);
    if (!requirement) throw new NotFoundException("capacity requirement not found");
    return requirement;
  }

  private async requireCandidate(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("candidate_id is required");
    const candidate = await findTenantRecordById<QueryResultRow>(client, "opportunity_candidates", tenantId, id);
    if (!candidate) throw new NotFoundException("candidate not found in tenant");
    return candidate;
  }

  private async requireOrganization(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("organization_id is required");
    const organization = await findTenantRecordById<QueryResultRow>(client, "organizations", tenantId, id);
    if (!organization) throw new NotFoundException("organization not found in tenant");
    return organization;
  }

  private async requireTerritory(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("territory_id is required");
    const territory = await findTenantRecordById(client, "territories", tenantId, id);
    if (!territory) throw new NotFoundException("territory not found in tenant");
    return territory;
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: unknown) {
    if (typeof userId !== "string" || !userId) throw new Error("owner_user_id is required");
    const result = await client.query(
      "SELECT 1 FROM tenant_users tu JOIN users u ON u.id = tu.user_id WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND u.status = 'active' AND tu.deleted_at IS NULL AND u.deleted_at IS NULL LIMIT 1",
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("owner user not found in tenant");
  }

  private async requireRelationshipMap(client: PoolClient, tenantId: string, id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("relationship_map_id is required");
    const map = await findTenantRecordById<QueryResultRow>(client, "relationship_maps", tenantId, id);
    if (!map) throw new NotFoundException("relationship map not found in tenant");
    return map;
  }

  private async activeCandidateSignals(client: PoolClient, tenantId: string, candidateId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM candidate_signals WHERE tenant_id = $1 AND candidate_id = $2 AND status = 'active' AND deleted_at IS NULL", [tenantId, candidateId]);
    return result.rows[0]?.count ?? 0;
  }

  private async capacityRequirementExists(client: PoolClient, tenantId: string, opportunityId: string) {
    return (await this.capacityRequirementCount(client, tenantId, opportunityId)) > 0;
  }

  private async capacityRequirementCount(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND opportunity_id = $2 AND status = 'active' AND deleted_at IS NULL", [tenantId, opportunityId]);
    return result.rows[0]?.count ?? 0;
  }

  private async openCriticalConstraintCount(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM constraints WHERE tenant_id = $1 AND affected_object_type = 'opportunity' AND affected_object_id = $2 AND severity = 'critical' AND status NOT IN ('resolved', 'verified', 'closed', 'archived') AND deleted_at IS NULL",
      [tenantId, opportunityId],
    );
    return result.rows[0]?.count ?? 0;
  }

  private async relationshipPathExists(client: PoolClient, tenantId: string, opportunity: QueryResultRow) {
    const result = await client.query(
      `
      SELECT 1
      FROM relationship_paths rp
      JOIN relationship_maps rm ON rm.id = rp.relationship_map_id
      WHERE rp.tenant_id = $1
        AND rm.tenant_id = $1
        AND rp.deleted_at IS NULL
        AND rm.deleted_at IS NULL
        AND rp.status <> 'archived'
        AND rm.status <> 'archived'
        AND (
          rm.id = $2
          OR rm.target_organization_id = $3
          OR (rm.target_object_type = 'opportunity_candidate' AND rm.target_object_id = $4)
          OR rm.related_candidate_id = $4
        )
      LIMIT 1
      `,
      [tenantId, opportunity.relationship_map_id, opportunity.organization_id, opportunity.source_candidate_id ?? opportunity.candidate_id],
    );
    return Boolean(result.rows[0]);
  }

  private async requireAuthority(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      `
      SELECT 1
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id
      JOIN roles r ON r.id = ur.role_id
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND r.name = ANY($3::text[])
        AND r.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, userId, Array.from(authorityRoles)],
    );
    if (!result.rows[0]) throw new ForbiddenException("Executive or Growth Director authority is required");
  }

  private scoreFields() {
    return ["signal_strength_score", "capacity_fit_score", "capacity_readiness_score", "margin_potential_score", "strategic_fit_score", "payment_risk_score", "pursuit_score"];
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

function normalizeOpportunityStatus(status: unknown) {
  if (status === "qualified") return "draft";
  if (status === "bid_proposal") return "proposal";
  return String(status ?? "draft");
}

function normalizeOpportunityStatusInput(status: unknown) {
  const text = String(status ?? "draft");
  if (!storedOpportunityStatuses.has(text)) throw new Error("status is invalid");
  return text;
}

function normalizeCandidateStatus(status: unknown) {
  return status === "qualified_candidate" ? "qualified" : String(status ?? "created");
}

function normalizeWorkType(value: unknown) {
  const text = String(value ?? "");
  const mapped = legacyWorkTypeMap.get(text) ?? text;
  return requireAllowed(mapped, workTypes, "work_type");
}

function nonNegativeNumber(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be greater than or equal to 0`);
  return parsed;
}

function positiveNumber(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be positive`);
  return parsed;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function dateOnly(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("date is invalid");
  return date.toISOString().slice(0, 10);
}

function dateNumber(value: unknown) {
  if (!value) return 0;
  const date = new Date(String(value)).getTime();
  return Number.isFinite(date) ? date : 0;
}

function bool(value: unknown) {
  return String(value) === "true";
}

function band(score: number) {
  if (score < 40) return "incomplete";
  if (score < 70) return "partial";
  if (score < 90) return "usable";
  return "complete";
}
