import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireAllowed, requireString } from "./intelligence.types";

const planStatuses = new Set(["not_started", "requirements_defined", "sources_identified", "partially_covered", "fully_covered", "covered_with_risk", "gap_exists", "blocked", "approved_for_handoff", "archived"]);
const approvedOpportunityStatuses = new Set(["awarded"]);
const workTypes = new Set(["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"]);
const coverageUnits = new Set(["feet", "miles", "drops", "addresses", "passings", "splice_cases", "nodes", "poles", "permits", "inspections", "restoration_items", "days", "crews", "workers", "equipment_units"]);
const sourceTypes = new Set(["internal_workforce", "approved_subcontractor", "preferred_contractor", "strategic_partner", "recruitable_contractor", "partner_workforce", "vendor_equipment_source", "staffing_source", "mixed_coverage", "unknown"]);
const commitmentStatuses = new Set(["identified", "contacted", "interested", "verbally_committed", "committed", "unavailable", "rejected", "needs_activation"]);
const marginConfidenceValues = new Set(["unknown", "low", "medium", "high", "verified"]);
const gapTypes = new Set(["no_capacity_source", "insufficient_crew_count", "insufficient_worker_count", "equipment_gap", "compliance_gap", "schedule_gap", "territory_gap", "production_rate_gap", "subcontractor_not_active", "contractor_not_verified", "insurance_gap", "safety_gap", "permit_or_row_gap", "material_or_vendor_gap", "economic_gap", "low_margin_gap", "negative_margin_gap", "margin_unknown_gap", "payment_risk_gap", "unknown_scope_gap"]);
const gapSeverities = new Set(["low", "medium", "high", "critical"]);
const gapStatuses = new Set(["open", "action_assigned", "in_progress", "resolved", "overridden", "hard_blocked", "archived"]);
const closedGapStatuses = new Set(["resolved", "overridden", "archived"]);
const invalidSourceCommitments = new Set(["unavailable", "rejected"]);
const archiveReasonValues = new Set(["duplicate", "no_longer_relevant", "replaced", "created_in_error", "opportunity_cancelled", "other"]);
const complianceGapTypes = new Set(["compliance_gap", "insurance_gap", "safety_gap", "permit_or_row_gap", "contractor_not_verified", "subcontractor_not_active"]);
const economicGapTypes = new Set(["economic_gap", "low_margin_gap", "negative_margin_gap", "margin_unknown_gap", "payment_risk_gap"]);
const capacityGapTypes = new Set(["no_capacity_source", "insufficient_crew_count", "insufficient_worker_count", "equipment_gap", "schedule_gap", "territory_gap", "production_rate_gap", "subcontractor_not_active", "contractor_not_verified", "material_or_vendor_gap", "unknown_scope_gap"]);

type CoverageWarning = {
  warning_type: string;
  severity: "low" | "medium" | "high";
  message: string;
  required_override_field: string;
  related_object_type?: string;
  related_object_id?: string | null;
};

type CoverageCounts = {
  requirements_count: number;
  active_requirements_count: number;
  sources_count: number;
  active_sources_count: number;
  gaps_count: number;
  open_gaps_count: number;
  hard_stop_gaps_count: number;
  overridden_gaps_count: number;
  resolved_gaps_count: number;
  economic_gaps_count: number;
  compliance_gaps_count: number;
  capacity_gaps_count: number;
};

type CoverageBlocker = {
  blocker_type: string;
  severity: "critical";
  message: string;
  related_object_type?: string;
  related_object_id?: string | null;
};

type Recalculation = {
  coverage_readiness_score: number | null;
  capacity_readiness_score: number | null;
  compliance_readiness_score: number | null;
  economic_readiness_score: number | null;
  coverage_readiness_band: string | null;
  economic_readiness_status: string;
  warnings: CoverageWarning[];
  blockers: CoverageBlocker[];
};

@Controller()
export class CoveragePlansController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("coverage-plans")
  @RequirePermission("coverage_plan.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listPlans(client, request.auth.tenantId, query));
  }

  @Get("coverage-plans/:id")
  @RequirePermission("coverage_plan.read")
  async get(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const plan = await this.withClient((client) => this.getPlan(client, request.auth.tenantId, id));
    if (!plan) throw new NotFoundException("coverage plan not found");
    return plan;
  }

  @Get("coverage-plans/:id/detail")
  @RequirePermission("coverage_plan.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.detailPlan(client, request.auth.tenantId, id, request.auth.userId));
  }

  @Get("coverage-plans/:id/timeline")
  @RequirePermission("coverage_plan.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePlan(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH requirement_ids AS (
          SELECT id FROM coverage_requirements WHERE tenant_id = $1 AND coverage_plan_id = $2
        ),
        source_ids AS (
          SELECT id FROM coverage_sources WHERE tenant_id = $1 AND coverage_plan_id = $2
        ),
        gap_ids AS (
          SELECT id FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2
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
            (e.aggregate_type = 'coverage_plan' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'coverage_requirement' AND e.aggregate_id IN (SELECT id FROM requirement_ids))
            OR (e.aggregate_type = 'coverage_source' AND e.aggregate_id IN (SELECT id FROM source_ids))
            OR (e.aggregate_type = 'coverage_gap' AND e.aggregate_id IN (SELECT id FROM gap_ids))
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("coverage-plans/:id/audit-summary")
  @RequirePermission("coverage_plan.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePlan(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH requirement_ids AS (
          SELECT id FROM coverage_requirements WHERE tenant_id = $1 AND coverage_plan_id = $2
        ),
        source_ids AS (
          SELECT id FROM coverage_sources WHERE tenant_id = $1 AND coverage_plan_id = $2
        ),
        gap_ids AS (
          SELECT id FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2
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
            (al.entity_type = 'coverage_plan' AND al.entity_id = $2)
            OR (al.entity_type = 'coverage_requirement' AND al.entity_id IN (SELECT id FROM requirement_ids))
            OR (al.entity_type = 'coverage_source' AND al.entity_id IN (SELECT id FROM source_ids))
            OR (al.entity_type = 'coverage_gap' AND al.entity_id IN (SELECT id FROM gap_ids))
          )
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Post("coverage-plans")
  @RequirePermission("coverage_plan.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const opportunityId = requireString(body.opportunity_id, "opportunity_id is required");
      return await this.write(request, "coverage_plan.create", "coverage_plan.created", "coverage_plan", async (client) => {
        const opportunity = await this.requireOpportunity(client, request.auth.tenantId, opportunityId);
        const status = normalizeOpportunityStatus(opportunity.status);
        if (!approvedOpportunityStatuses.has(status)) throw new BadRequestException("coverage plan requires awarded opportunity");
        if (opportunity.archived_at || opportunity.deleted_at || status === "archived") throw new BadRequestException("coverage plan requires active awarded opportunity");
        const duplicate = await this.activePlanForOpportunity(client, request.auth.tenantId, opportunityId);
        if (duplicate && !optionalText(body.override_reason)) throw new BadRequestException("duplicate active coverage plan requires override reason");
        const operationsOwner = optionalText(body.operations_owner_user_id);
        if (operationsOwner) await this.requireTenantUser(client, request.auth.tenantId, operationsOwner);
        const plan = await insertTenantRecord(client, "coverage_plans", request.auth.tenantId, {
          opportunity_id: opportunityId,
          status: "not_started",
          operations_owner_user_id: operationsOwner,
          notes: optionalText(body.notes),
          override_reasons: body.override_reasons ?? {},
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        return { entityType: "coverage_plan", entityId: plan.id, afterState: await this.detailPlan(client, request.auth.tenantId, plan.id) };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("coverage-plans/:id")
  @RequirePermission("coverage_plan.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["notes", "approval_note", "override_reasons"]);
      if (body.status !== undefined) {
        const status = requireAllowed(body.status, planStatuses, "status");
        if (status === "approved_for_handoff") throw new BadRequestException("handoff approval must use approve-for-handoff route");
        values.status = status;
      }
      if (body.operations_owner_user_id !== undefined) values.operations_owner_user_id = optionalText(body.operations_owner_user_id);
      return await this.write(request, "coverage_plan.update", "coverage_plan.updated", "coverage_plan", async (client) => {
        const before = await this.requirePlan(client, request.auth.tenantId, id);
        if (before.status === "archived" || before.archived_at) throw new BadRequestException("archived coverage plans cannot be updated");
        if (values.operations_owner_user_id) await this.requireTenantUser(client, request.auth.tenantId, String(values.operations_owner_user_id));
        const after = await updateTenantRecord(client, "coverage_plans", request.auth.tenantId, id, { ...values, updated_by: request.auth.userId });
        if (!after) throw new NotFoundException("coverage plan not found");
        return { entityType: "coverage_plan", entityId: id, beforeState: before, afterState: await this.detailPlan(client, request.auth.tenantId, id) };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("coverage-plans/:id/recalculate")
  @RequirePermission("coverage_plan.recalculate")
  async recalculate(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "coverage_plan.recalculate", "coverage_plan.recalculated", "coverage_plan", async (client) => {
      const before = await this.requirePlan(client, request.auth.tenantId, id);
      if (before.status === "archived" || before.archived_at) throw new BadRequestException("archived coverage plans cannot be recalculated");
      const calc = await this.calculateReadiness(client, request.auth.tenantId, id);
      const nextStatus = this.statusFromReadiness(before.status, calc);
      await updateTenantRecord(client, "coverage_plans", request.auth.tenantId, id, {
        coverage_readiness_score: calc.coverage_readiness_score,
        capacity_readiness_score: calc.capacity_readiness_score,
        compliance_readiness_score: calc.compliance_readiness_score,
        economic_readiness_score: calc.economic_readiness_score,
        coverage_readiness_band: calc.coverage_readiness_band,
        status: nextStatus,
        updated_by: request.auth.userId,
      });
      return { entityType: "coverage_plan", entityId: id, beforeState: before, afterState: await this.detailPlan(client, request.auth.tenantId, id) };
    });
  }

  @Post("coverage-plans/:id/approve-for-handoff")
  @RequirePermission("coverage_plan.approve_handoff")
  async approveForHandoff(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const approvalNote = requireString(body.approval_note, "approval_note is required");
      return await this.write(request, "coverage_plan.approve_handoff", "coverage_plan.approved_for_handoff", "coverage_plan", async (client) => {
        const before = await this.requirePlan(client, request.auth.tenantId, id);
        if (before.status === "archived" || before.archived_at) throw new BadRequestException("archived coverage plans cannot be approved for handoff");
        const calc = await this.calculateReadiness(client, request.auth.tenantId, id);
        const validation = await this.handoffValidation(client, request.auth.tenantId, id, calc, before);
        if (validation.blockers.length) throw new BadRequestException({ message: "Coverage approval is blocked by hard stops.", blockers: validation.blockers, warnings: validation.warnings });
        const overrideReasons = normalizeOverrideReasons(body.override_reasons);
        const missing = validation.required_override_fields.filter((field) => !overrideReasons[field]);
        if (missing.length) {
          throw new BadRequestException({
            message: "Coverage approval requires override reason for warnings.",
            warnings: validation.warnings,
            required_override_fields: missing,
          });
        }
        await updateTenantRecord(client, "coverage_plans", request.auth.tenantId, id, {
          status: "approved_for_handoff",
          approved_for_handoff_by: request.auth.userId,
          approved_for_handoff_at: new Date(),
          approval_note: approvalNote,
          override_reasons: overrideReasons,
          coverage_readiness_score: calc.coverage_readiness_score,
          capacity_readiness_score: calc.capacity_readiness_score,
          compliance_readiness_score: calc.compliance_readiness_score,
          economic_readiness_score: calc.economic_readiness_score,
          coverage_readiness_band: calc.coverage_readiness_band,
          updated_by: request.auth.userId,
        });
        return {
          entityType: "coverage_plan",
          entityId: id,
          beforeState: before,
          afterState: {
            ...(await this.detailPlan(client, request.auth.tenantId, id)),
            warnings: validation.warnings,
            blockers: validation.blockers,
            override_reasons: overrideReasons,
          },
        };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("coverage-plans/:id/archive")
  @RequirePermission("coverage_plan.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = requireArchiveReason(body);
    return this.write(request, "coverage_plan.archive", "coverage_plan.archived", "coverage_plan", async (client) => {
      const before = await this.requirePlan(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "coverage_plans", request.auth.tenantId, id, {
        status: "archived",
        archive_reason: reason,
        archive_note: optionalText(body.archive_note ?? body.note),
        archived_by: request.auth.userId,
        archived_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("coverage plan not found");
      return { entityType: "coverage_plan", entityId: id, beforeState: before, afterState: { ...after, archive_reason: reason } };
    });
  }

  @Get("coverage-plans/:id/requirements")
  @RequirePermission("coverage_requirement.read")
  async requirements(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePlan(client, request.auth.tenantId, id);
      return this.listRequirements(client, request.auth.tenantId, id);
    });
  }

  @Post("coverage-plans/:id/requirements")
  @RequirePermission("coverage_requirement.create")
  async createRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.requirementValues(body, true);
      return await this.write(request, "coverage_requirement.create", "coverage_requirement.created", "coverage_requirement", async (client) => {
        await this.requireActivePlan(client, request.auth.tenantId, id);
        if (values.territory_id) await this.requireTenantRecord(client, "territories", request.auth.tenantId, String(values.territory_id), "territory not found");
        const requirement = await insertTenantRecord(client, "coverage_requirements", request.auth.tenantId, { ...values, coverage_plan_id: id, created_by: request.auth.userId, updated_by: request.auth.userId });
        return { entityType: "coverage_requirement", entityId: requirement.id, afterState: requirement };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("coverage-requirements/:id")
  @RequirePermission("coverage_requirement.update")
  async updateRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.requirementValues(body, false);
      return await this.write(request, "coverage_requirement.update", "coverage_requirement.updated", "coverage_requirement", async (client) => {
        const before = await this.requireRequirement(client, request.auth.tenantId, id);
        await this.requireActivePlan(client, request.auth.tenantId, before.coverage_plan_id);
        if (values.territory_id) await this.requireTenantRecord(client, "territories", request.auth.tenantId, String(values.territory_id), "territory not found");
        const after = await updateTenantRecord(client, "coverage_requirements", request.auth.tenantId, id, { ...values, updated_by: request.auth.userId });
        if (!after) throw new NotFoundException("coverage requirement not found");
        return { entityType: "coverage_requirement", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("coverage-requirements/:id/archive")
  @RequirePermission("coverage_requirement.archive")
  async archiveRequirement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = requireArchiveReason(body);
    return this.archiveChild(request, "coverage_requirements", id, "coverage_requirement", "coverage_requirement.archive", "coverage_requirement.archived", reason);
  }

  @Get("coverage-plans/:id/sources")
  @RequirePermission("coverage_source.read")
  async sources(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePlan(client, request.auth.tenantId, id);
      return this.listSources(client, request.auth.tenantId, id);
    });
  }

  @Post("coverage-plans/:id/sources")
  @RequirePermission("coverage_source.create")
  async createSource(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.sourceValues(body, true);
      return await this.write(request, "coverage_source.create", "coverage_source.created", "coverage_source", async (client) => {
        await this.requireActivePlan(client, request.auth.tenantId, id);
        await this.validateSourceRelations(client, request.auth.tenantId, id, values);
        const source = await insertTenantRecord(client, "coverage_sources", request.auth.tenantId, { ...values, coverage_plan_id: id, created_by: request.auth.userId, updated_by: request.auth.userId });
        return { entityType: "coverage_source", entityId: source.id, afterState: source };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("coverage-sources/:id")
  @RequirePermission("coverage_source.update")
  async updateSource(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.sourceValues(body, false);
      return await this.write(request, "coverage_source.update", "coverage_source.updated", "coverage_source", async (client) => {
        const before = await this.requireSource(client, request.auth.tenantId, id);
        await this.requireActivePlan(client, request.auth.tenantId, before.coverage_plan_id);
        await this.validateSourceRelations(client, request.auth.tenantId, before.coverage_plan_id, { ...before, ...values });
        const after = await updateTenantRecord(client, "coverage_sources", request.auth.tenantId, id, { ...values, updated_by: request.auth.userId });
        if (!after) throw new NotFoundException("coverage source not found");
        return { entityType: "coverage_source", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("coverage-sources/:id/archive")
  @RequirePermission("coverage_source.archive")
  async archiveSource(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = requireArchiveReason(body);
    return this.archiveChild(request, "coverage_sources", id, "coverage_source", "coverage_source.archive", "coverage_source.archived", reason);
  }

  @Get("coverage-plans/:id/gaps")
  @RequirePermission("coverage_gap.read")
  async gaps(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePlan(client, request.auth.tenantId, id);
      return this.listGaps(client, request.auth.tenantId, id);
    });
  }

  @Post("coverage-plans/:id/gaps")
  @RequirePermission("coverage_gap.create")
  async createGap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.gapValues(body, true);
      return await this.write(request, "coverage_gap.create", "coverage_gap.created", "coverage_gap", async (client) => {
        await this.requireActivePlan(client, request.auth.tenantId, id);
        await this.validateGapRelations(client, request.auth.tenantId, id, values);
        const gap = await insertTenantRecord(client, "coverage_gaps", request.auth.tenantId, { ...values, coverage_plan_id: id, created_by: request.auth.userId, updated_by: request.auth.userId });
        return { entityType: "coverage_gap", entityId: gap.id, afterState: gap };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("coverage-gaps/:id")
  @RequirePermission("coverage_gap.update")
  async updateGap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.gapValues(body, false);
      return await this.write(request, "coverage_gap.update", "coverage_gap.updated", "coverage_gap", async (client) => {
        const before = await this.requireGap(client, request.auth.tenantId, id);
        await this.requireActivePlan(client, request.auth.tenantId, before.coverage_plan_id);
        await this.validateGapRelations(client, request.auth.tenantId, before.coverage_plan_id, { ...before, ...values });
        const after = await updateTenantRecord(client, "coverage_gaps", request.auth.tenantId, id, { ...values, updated_by: request.auth.userId });
        if (!after) throw new NotFoundException("coverage gap not found");
        return { entityType: "coverage_gap", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("coverage-gaps/:id/resolve")
  @RequirePermission("coverage_gap.resolve")
  async resolveGap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const resolutionNote = requireString(body.resolution_note ?? body.note, "resolution_note is required");
    return this.write(request, "coverage_gap.resolve", "coverage_gap.resolved", "coverage_gap", async (client) => {
      const before = await this.requireGap(client, request.auth.tenantId, id);
      await this.requireActivePlan(client, request.auth.tenantId, before.coverage_plan_id);
      const after = await updateTenantRecord(client, "coverage_gaps", request.auth.tenantId, id, {
        status: "resolved",
        resolution_note: resolutionNote,
        resolved_by: request.auth.userId,
        resolved_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("coverage gap not found");
      return { entityType: "coverage_gap", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("coverage-gaps/:id/override")
  @RequirePermission("coverage_gap.override")
  async overrideGap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const resolutionNote = requireString(body.override_reason ?? body.resolution_note ?? body.note, "override_reason is required");
    return this.write(request, "coverage_gap.override", "coverage_gap.overridden", "coverage_gap", async (client) => {
      const before = await this.requireGap(client, request.auth.tenantId, id);
      await this.requireActivePlan(client, request.auth.tenantId, before.coverage_plan_id);
      if (before.hard_stop) throw new BadRequestException("hard stop gaps cannot be overridden");
      if (before.override_allowed === false) throw new BadRequestException("coverage gap is not overrideable");
      const after = await updateTenantRecord(client, "coverage_gaps", request.auth.tenantId, id, {
        status: "overridden",
        resolution_note: resolutionNote,
        resolved_by: request.auth.userId,
        resolved_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("coverage gap not found");
      return { entityType: "coverage_gap", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("coverage-gaps/:id/archive")
  @RequirePermission("coverage_gap.archive")
  async archiveGap(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = requireArchiveReason(body);
    return this.archiveChild(request, "coverage_gaps", id, "coverage_gap", "coverage_gap.archive", "coverage_gap.archived", reason);
  }

  private async listPlans(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const rows = await this.basePlanRows(client, tenantId);
    let enriched = await Promise.all(rows.map((row) => this.enrichPlanRow(client, tenantId, row)));
    enriched = this.filterPlans(enriched, query);
    enriched = this.sortPlans(enriched, query.sort);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(query.offset ?? 0), 0);
    return enriched.slice(offset, offset + limit);
  }

  private async getPlan(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.basePlanRows(client, tenantId, id);
    if (!rows[0]) return null;
    return this.enrichPlanRow(client, tenantId, rows[0]);
  }

  private async detailPlan(client: PoolClient, tenantId: string, id: string, actorUserId?: string) {
    const plan = await this.getPlan(client, tenantId, id);
    if (!plan) throw new NotFoundException("coverage plan not found");
    const [requirements, sources, gaps, complianceDocuments] = await Promise.all([
      this.listRequirements(client, tenantId, id),
      this.listSources(client, tenantId, id),
      this.listGaps(client, tenantId, id),
      this.complianceDocumentsSummary(client, tenantId, id),
    ]);
    return {
      coverage_plan: plan,
      opportunity_context: await this.opportunityContext(client, tenantId, plan.opportunity_id),
      opportunity: await this.opportunityContext(client, tenantId, plan.opportunity_id),
      requirements,
      sources,
      gaps,
      readiness: {
        coverage_readiness_score: plan.coverage_readiness_score,
        capacity_readiness_score: plan.capacity_readiness_score,
        compliance_readiness_score: plan.compliance_readiness_score,
        economic_readiness_score: plan.economic_readiness_score,
        economic_readiness_status: plan.economic_status,
        coverage_readiness_band: plan.coverage_readiness_band,
      },
      warnings: plan.warnings,
      blockers: plan.blockers,
      required_override_fields: plan.required_override_fields,
      recommended_next_action: plan.recommended_next_action,
      approval_context: {
        can_approve: actorUserId ? await this.actorCanApprove(client, tenantId, actorUserId) : null,
        approved_for_handoff_by: plan.approved_for_handoff_by,
        approved_for_handoff_by_name: plan.approved_for_handoff_by_name,
        approved_for_handoff_at: plan.approved_for_handoff_at,
        warnings: plan.warnings,
        blockers: plan.blockers,
        required_override_fields: plan.required_override_fields,
        last_approval_note: plan.approval_note,
        override_reasons: plan.override_reasons,
      },
      economic_summary: this.economicSummary(plan, sources),
      compliance_summary: {
        compliance_readiness_score: plan.compliance_readiness_score,
        compliance_gaps_count: plan.compliance_gaps_count,
        hard_stop_compliance_gaps_count: gaps.filter((gap) => complianceGapTypes.has(String(gap.gap_type)) && (gap.hard_stop || gap.status === "hard_blocked") && !closedGapStatuses.has(String(gap.status))).length,
        compliance_documents: complianceDocuments,
      },
      capacity_summary: this.capacitySummary(plan, requirements, sources, gaps),
      audit_allowed: actorUserId ? await this.actorHasPermission(client, tenantId, actorUserId, "coverage_plan.audit.read") : false,
      timeline_available: true,
      project_creation_boundary: "Coverage approval creates no project, work order, production, settlement, invoice, payment, payroll, or cash records.",
    };
  }

  private async opportunityContext(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT o.id, o.title AS opportunity_name, o.status, CASE WHEN o.status = 'qualified' THEN 'draft' WHEN o.status = 'bid_proposal' THEN 'proposal' ELSE o.status END AS normalized_status, o.work_type, o.estimated_value, o.owner_user_id, owner.display_name AS owner_name,
        o.organization_id, org.name AS organization_name, o.territory_id, t.name AS territory_name,
        o.relationship_map_id, o.relationship_access_score, o.pursuit_score, o.expected_start_date, o.expected_decision_date, o.awarded_at, o.risk_notes
      FROM opportunities o
      LEFT JOIN organizations org ON org.id = o.organization_id AND org.tenant_id = o.tenant_id
      LEFT JOIN territories t ON t.id = o.territory_id AND t.tenant_id = o.tenant_id
      LEFT JOIN users owner ON owner.id = o.owner_user_id
      WHERE o.tenant_id = $1 AND o.id = $2 AND o.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async listRequirements(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      `
      SELECT cr.*, t.name AS territory_name, creator.display_name AS created_by_name, updater.display_name AS updated_by_name
      FROM coverage_requirements cr
      LEFT JOIN territories t ON t.id = cr.territory_id AND t.tenant_id = cr.tenant_id
      LEFT JOIN users creator ON creator.id = cr.created_by
      LEFT JOIN users updater ON updater.id = cr.updated_by
      WHERE cr.tenant_id = $1 AND cr.coverage_plan_id = $2 AND cr.deleted_at IS NULL
      ORDER BY cr.created_at DESC
      `,
      [tenantId, planId],
    );
    return result.rows;
  }

  private async listSources(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      `
      SELECT cs.*, org.name AS organization_name, cp.name AS capacity_provider_name, cp.status AS capacity_provider_status, crew.name AS crew_name, eq.name AS equipment_name,
        creator.display_name AS created_by_name, updater.display_name AS updated_by_name
      FROM coverage_sources cs
      LEFT JOIN organizations org ON org.id = cs.organization_id AND org.tenant_id = cs.tenant_id
      LEFT JOIN capacity_providers cp ON cp.id = cs.capacity_provider_id AND cp.tenant_id = cs.tenant_id
      LEFT JOIN crews crew ON crew.id = cs.crew_id AND crew.tenant_id = cs.tenant_id
      LEFT JOIN equipment eq ON eq.id = cs.equipment_id AND eq.tenant_id = cs.tenant_id
      LEFT JOIN users creator ON creator.id = cs.created_by
      LEFT JOIN users updater ON updater.id = cs.updated_by
      WHERE cs.tenant_id = $1 AND cs.coverage_plan_id = $2 AND cs.deleted_at IS NULL
      ORDER BY cs.created_at DESC
      `,
      [tenantId, planId],
    );
    return result.rows;
  }

  private async listGaps(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      `
      SELECT cg.*, u.display_name AS owner_name, resolver.display_name AS resolved_by_name, creator.display_name AS created_by_name, updater.display_name AS updated_by_name
      FROM coverage_gaps cg
      LEFT JOIN users u ON u.id = cg.owner_user_id
      LEFT JOIN users resolver ON resolver.id = cg.resolved_by
      LEFT JOIN users creator ON creator.id = cg.created_by
      LEFT JOIN users updater ON updater.id = cg.updated_by
      WHERE cg.tenant_id = $1 AND cg.coverage_plan_id = $2 AND cg.deleted_at IS NULL
      ORDER BY cg.created_at DESC
      `,
      [tenantId, planId],
    );
    return result.rows;
  }

  private async basePlanRows(client: PoolClient, tenantId: string, id?: string) {
    const result = await client.query(
      `
      SELECT
        cp.*,
        o.title AS opportunity_name,
        o.status AS opportunity_status,
        o.estimated_value AS opportunity_estimated_value,
        o.organization_id,
        org.name AS organization_name,
        o.territory_id,
        t.name AS territory_name,
        o.work_type,
        owner.display_name AS operations_owner_name,
        approver.display_name AS approved_for_handoff_by_name
      FROM coverage_plans cp
      JOIN opportunities o ON o.id = cp.opportunity_id AND o.tenant_id = cp.tenant_id
      LEFT JOIN organizations org ON org.id = o.organization_id AND org.tenant_id = o.tenant_id
      LEFT JOIN territories t ON t.id = o.territory_id AND t.tenant_id = o.tenant_id
      LEFT JOIN users owner ON owner.id = cp.operations_owner_user_id
      LEFT JOIN users approver ON approver.id = cp.approved_for_handoff_by
      WHERE cp.tenant_id = $1
        AND cp.deleted_at IS NULL
        ${id ? "AND cp.id = $2" : ""}
      ORDER BY cp.updated_at DESC
      `,
      id ? [tenantId, id] : [tenantId],
    );
    return result.rows;
  }

  private async enrichPlanRow(client: PoolClient, tenantId: string, row: QueryResultRow): Promise<QueryResultRow> {
    const [counts, calc] = await Promise.all([this.coverageCounts(client, tenantId, row.id), this.calculateReadiness(client, tenantId, row.id)]);
    const validation = await this.handoffValidation(client, tenantId, row.id, calc, row);
    const economicStatus = calc.economic_readiness_status;
    const enriched = {
      ...row,
      coverage_readiness_score: calc.coverage_readiness_score,
      capacity_readiness_score: calc.capacity_readiness_score,
      compliance_readiness_score: calc.compliance_readiness_score,
      economic_readiness_score: calc.economic_readiness_score,
      coverage_readiness_band: calc.coverage_readiness_band,
      economic_status: economicStatus,
      ...counts,
      warnings: validation.warnings,
      blockers: validation.blockers,
      required_override_fields: validation.required_override_fields,
      ready_for_handoff: calc.coverage_readiness_score !== null && calc.coverage_readiness_score >= 85 && validation.blockers.length === 0,
      has_hard_stop: counts.hard_stop_gaps_count > 0,
      has_economic_risk: counts.economic_gaps_count > 0 || calc.economic_readiness_score === null || calc.economic_readiness_score < 70,
      has_compliance_risk: counts.compliance_gaps_count > 0 || calc.compliance_readiness_score === null || calc.warnings.some((warning) => warning.warning_type.startsWith("compliance")),
      has_capacity_gap: counts.capacity_gaps_count > 0 || calc.capacity_readiness_score === null || calc.capacity_readiness_score < 100,
    };
    return {
      ...enriched,
      recommended_next_action: recommendedNextAction(enriched),
    };
  }

  private async coverageCounts(client: PoolClient, tenantId: string, planId: string): Promise<CoverageCounts> {
    const result = await client.query(
      `
      SELECT
        (SELECT count(*)::int FROM coverage_requirements WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL) AS requirements_count,
        (SELECT count(*)::int FROM coverage_requirements WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL) AS active_requirements_count,
        (SELECT count(*)::int FROM coverage_sources WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL) AS sources_count,
        (SELECT count(*)::int FROM coverage_sources WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL) AS active_sources_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL) AS gaps_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND status NOT IN ('resolved', 'overridden', 'archived')) AS open_gaps_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND status NOT IN ('resolved', 'overridden', 'archived') AND (hard_stop = true OR status = 'hard_blocked')) AS hard_stop_gaps_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND status = 'overridden') AS overridden_gaps_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND status = 'resolved') AS resolved_gaps_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND gap_type = ANY($3) AND status NOT IN ('resolved', 'overridden', 'archived')) AS economic_gaps_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND gap_type = ANY($4) AND status NOT IN ('resolved', 'overridden', 'archived')) AS compliance_gaps_count,
        (SELECT count(*)::int FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND gap_type = ANY($5) AND status NOT IN ('resolved', 'overridden', 'archived')) AS capacity_gaps_count
      `,
      [tenantId, planId, Array.from(economicGapTypes), Array.from(complianceGapTypes), Array.from(capacityGapTypes)],
    );
    return result.rows[0] as CoverageCounts;
  }

  private filterPlans<T extends QueryResultRow>(rows: T[], query: Record<string, string | undefined>): T[] {
    const includeArchived = query.archived === "true";
    return rows.filter((row) => {
      if (!includeArchived && (row.archived_at || row.status === "archived")) return false;
      if (query.status && row.status !== query.status) return false;
      if (query.opportunity_id && row.opportunity_id !== query.opportunity_id) return false;
      if (query.organization_id && row.organization_id !== query.organization_id) return false;
      if (query.territory_id && row.territory_id !== query.territory_id) return false;
      if (query.operations_owner_user_id && row.operations_owner_user_id !== query.operations_owner_user_id) return false;
      if (!rangeFilter(row.coverage_readiness_score, query.readiness_min, query.readiness_max)) return false;
      if (!rangeFilter(row.capacity_readiness_score, query.capacity_readiness_min, query.capacity_readiness_max)) return false;
      if (!rangeFilter(row.compliance_readiness_score, query.compliance_readiness_min, query.compliance_readiness_max)) return false;
      if (!rangeFilter(row.economic_readiness_score, query.economic_readiness_min, query.economic_readiness_max)) return false;
      if (query.has_requirements && String(row.active_requirements_count > 0) !== query.has_requirements) return false;
      if (query.has_sources && String(row.active_sources_count > 0) !== query.has_sources) return false;
      if (query.has_open_gaps && String(row.open_gaps_count > 0) !== query.has_open_gaps) return false;
      if (query.has_hard_stop_gaps && String(row.hard_stop_gaps_count > 0) !== query.has_hard_stop_gaps) return false;
      if (query.has_economic_risk && String(row.has_economic_risk) !== query.has_economic_risk) return false;
      if (query.has_compliance_risk && String(row.has_compliance_risk) !== query.has_compliance_risk) return false;
      if (query.has_capacity_gap && String(row.has_capacity_gap) !== query.has_capacity_gap) return false;
      if (query.approved_for_handoff && String(row.status === "approved_for_handoff" || Boolean(row.approved_for_handoff_at)) !== query.approved_for_handoff) return false;
      if (query.q) {
        const haystack = [row.opportunity_name, row.organization_name, row.territory_name, row.operations_owner_name, row.status, row.notes].map((value) => String(value ?? "").toLowerCase()).join(" ");
        if (!haystack.includes(query.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  private sortPlans<T extends QueryResultRow>(rows: T[], sort = "default"): T[] {
    return [...rows].sort((a, b) => {
      if (sort === "updated_desc") return dateMs(b.updated_at) - dateMs(a.updated_at);
      if (sort === "readiness_asc") return nullableSort(a.coverage_readiness_score, true) - nullableSort(b.coverage_readiness_score, true);
      if (sort === "readiness_desc") return nullableSort(b.coverage_readiness_score, false) - nullableSort(a.coverage_readiness_score, false);
      if (sort === "hard_stops_desc") return Number(b.hard_stop_gaps_count) - Number(a.hard_stop_gaps_count);
      if (sort === "open_gaps_desc") return Number(b.open_gaps_count) - Number(a.open_gaps_count);
      if (sort === "opportunity_value_desc") return Number(b.opportunity_estimated_value ?? -1) - Number(a.opportunity_estimated_value ?? -1);
      if (sort === "status") return String(a.status ?? "").localeCompare(String(b.status ?? ""));
      if (sort === "approved_at_desc") return dateMs(b.approved_for_handoff_at) - dateMs(a.approved_for_handoff_at);
      return Number(b.hard_stop_gaps_count) - Number(a.hard_stop_gaps_count) || nullableSort(a.coverage_readiness_score, true) - nullableSort(b.coverage_readiness_score, true) || dateMs(b.updated_at) - dateMs(a.updated_at);
    });
  }

  private economicSummary(plan: QueryResultRow, sources: QueryResultRow[]) {
    const activeSources = sources.filter((source) => !source.archived_at);
    const cost = sumNumeric(activeSources, "estimated_cost");
    const marginAmount = sumNumeric(activeSources, "expected_margin_amount");
    const marginPercent = averageNumeric(activeSources, "expected_margin_percent");
    const confidence = activeSources.map((source) => source.margin_confidence).filter(Boolean);
    return {
      total_estimated_source_cost: cost,
      expected_margin_amount: marginAmount,
      expected_margin_percent: marginPercent,
      margin_confidence_summary: confidence.length ? Array.from(new Set(confidence)) : [],
      economic_readiness_score: plan.economic_readiness_score,
      economic_status: plan.economic_status,
      economic_gaps_count: plan.economic_gaps_count,
    };
  }

  private capacitySummary(plan: QueryResultRow, requirements: QueryResultRow[], sources: QueryResultRow[], gaps: QueryResultRow[]) {
    return {
      total_required_quantity: aggregateQuantities(requirements.filter((row) => !row.archived_at), "quantity"),
      total_covered_quantity: aggregateQuantities(sources.filter((row) => !row.archived_at), "covered_quantity"),
      gap_quantity: aggregateQuantities(gaps.filter((row) => !row.archived_at && !closedGapStatuses.has(String(row.status))), "gap_quantity"),
      capacity_readiness_score: plan.capacity_readiness_score,
      active_sources_count: plan.active_sources_count,
    };
  }

  private async complianceDocumentsSummary(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      `
      SELECT cd.id, cd.document_type, cd.status, cd.capacity_provider_id, cp.name AS capacity_provider_name, cd.expires_at
      FROM coverage_sources cs
      JOIN compliance_documents cd ON cd.tenant_id = cs.tenant_id AND cd.capacity_provider_id = cs.capacity_provider_id AND cd.deleted_at IS NULL
      LEFT JOIN capacity_providers cp ON cp.id = cd.capacity_provider_id AND cp.tenant_id = cd.tenant_id
      WHERE cs.tenant_id = $1 AND cs.coverage_plan_id = $2 AND cs.deleted_at IS NULL AND cs.archived_at IS NULL
      ORDER BY cd.created_at DESC
      LIMIT 50
      `,
      [tenantId, planId],
    );
    return result.rows;
  }

  private async actorCanApprove(client: PoolClient, tenantId: string, actorUserId: string) {
    return this.actorHasPermission(client, tenantId, actorUserId, "coverage_plan.approve_handoff");
  }

  private async actorHasPermission(client: PoolClient, tenantId: string, actorUserId: string, permission: string) {
    const result = await client.query(
      `
      SELECT 1
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id AND ur.tenant_id = tu.tenant_id
      JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.tenant_id = tu.tenant_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND p.key = $3
      LIMIT 1
      `,
      [tenantId, actorUserId, permission],
    );
    return Boolean(result.rows[0]);
  }

  private requirementValues(body: Record<string, unknown>, create: boolean) {
    const values = pick(body, ["territory_id", "required_crew_type", "required_equipment_type", "required_start_date", "required_end_date", "production_rate_assumption", "notes"]);
    if (body.work_type !== undefined || create) values.work_type = requireAllowed(body.work_type, workTypes, "work_type");
    if (body.unit !== undefined || create) values.unit = requireAllowed(body.unit, coverageUnits, "unit");
    if (body.quantity !== undefined || create) values.quantity = nonNegativeNumber(body.quantity, "quantity");
    if (body.production_rate_assumption !== undefined) values.production_rate_assumption = nonNegativeNumber(body.production_rate_assumption, "production_rate_assumption");
    return values;
  }

  private sourceValues(body: Record<string, unknown>, create: boolean) {
    const values = pick(body, ["coverage_requirement_id", "organization_id", "capacity_provider_id", "crew_id", "equipment_id", "activation_steps", "notes"]);
    if (body.source_type !== undefined || create) values.source_type = requireAllowed(body.source_type, sourceTypes, "source_type");
    if (body.unit !== undefined || create) values.unit = requireAllowed(body.unit, coverageUnits, "unit");
    if (body.covered_quantity !== undefined || create) values.covered_quantity = nonNegativeNumber(body.covered_quantity, "covered_quantity");
    if (body.commitment_status !== undefined || create) values.commitment_status = body.commitment_status === undefined ? "identified" : requireAllowed(body.commitment_status, commitmentStatuses, "commitment_status");
    if (body.confidence_score !== undefined) values.confidence_score = scoreNumber(body.confidence_score, "confidence_score");
    if (body.estimated_cost !== undefined) values.estimated_cost = nonNegativeNumber(body.estimated_cost, "estimated_cost");
    if (body.expected_margin_amount !== undefined) values.expected_margin_amount = numberValue(body.expected_margin_amount, "expected_margin_amount");
    if (body.expected_margin_percent !== undefined) values.expected_margin_percent = numberValue(body.expected_margin_percent, "expected_margin_percent");
    if (body.margin_confidence !== undefined) values.margin_confidence = requireAllowed(body.margin_confidence, marginConfidenceValues, "margin_confidence");
    return values;
  }

  private gapValues(body: Record<string, unknown>, create: boolean) {
    const values = pick(body, ["coverage_requirement_id", "owner_user_id", "due_date", "recommended_action", "resolution_note"]);
    if (body.gap_type !== undefined || create) values.gap_type = requireAllowed(body.gap_type, gapTypes, "gap_type");
    if (body.severity !== undefined || create) values.severity = body.severity === undefined ? "medium" : requireAllowed(body.severity, gapSeverities, "severity");
    if (body.status !== undefined) values.status = requireAllowed(body.status, gapStatuses, "status");
    if (body.unit !== undefined) values.unit = requireAllowed(body.unit, coverageUnits, "unit");
    if (body.required_quantity !== undefined) values.required_quantity = nonNegativeNumber(body.required_quantity, "required_quantity");
    if (body.covered_quantity !== undefined) values.covered_quantity = nonNegativeNumber(body.covered_quantity, "covered_quantity");
    if (body.gap_quantity !== undefined) values.gap_quantity = nonNegativeNumber(body.gap_quantity, "gap_quantity");
    if (body.override_allowed !== undefined) values.override_allowed = Boolean(body.override_allowed);
    if (body.hard_stop !== undefined) values.hard_stop = Boolean(body.hard_stop);
    return values;
  }

  private async validateSourceRelations(client: PoolClient, tenantId: string, planId: string, values: Record<string, unknown>) {
    if (values.coverage_requirement_id) await this.requireRequirementForPlan(client, tenantId, String(values.coverage_requirement_id), planId);
    if (values.organization_id) await this.requireTenantRecord(client, "organizations", tenantId, String(values.organization_id), "organization not found");
    if (values.capacity_provider_id) await this.requireTenantRecord(client, "capacity_providers", tenantId, String(values.capacity_provider_id), "capacity provider not found");
    if (values.crew_id) await this.requireTenantRecord(client, "crews", tenantId, String(values.crew_id), "crew not found");
    if (values.equipment_id) await this.requireTenantRecord(client, "equipment", tenantId, String(values.equipment_id), "equipment not found");
  }

  private async validateGapRelations(client: PoolClient, tenantId: string, planId: string, values: Record<string, unknown>) {
    if (values.coverage_requirement_id) await this.requireRequirementForPlan(client, tenantId, String(values.coverage_requirement_id), planId);
    if (values.owner_user_id) await this.requireTenantUser(client, tenantId, String(values.owner_user_id));
  }

  private async calculateReadiness(client: PoolClient, tenantId: string, planId: string): Promise<Recalculation> {
    const [capacity, compliance, economic, gaps, sourceWarnings] = await Promise.all([
      this.capacityScore(client, tenantId, planId),
      this.complianceScore(client, tenantId, planId),
      this.economicScore(client, tenantId, planId),
      this.openGaps(client, tenantId, planId),
      this.sourceCommitmentWarnings(client, tenantId, planId),
    ]);
    const warnings = [...capacity.warnings, ...compliance.warnings, ...economic.warnings, ...sourceWarnings];
    const blockers: CoverageBlocker[] = [];
    for (const gap of gaps) {
      if (gap.hard_stop || gap.status === "hard_blocked") {
        blockers.push({ blocker_type: gap.status === "hard_blocked" ? "hard_blocked_gap" : "hard_stop_gap", severity: "critical", message: "Coverage gap is marked as a hard stop.", related_object_type: "coverage_gap", related_object_id: gap.id });
      } else {
        warnings.push({
          warning_type: warningTypeForGap(gap.gap_type),
          severity: gap.severity === "critical" ? "high" : (gap.severity as "low" | "medium" | "high"),
          message: "Open coverage gap requires override or resolution before handoff approval.",
          required_override_field: overrideFieldForWarning(warningTypeForGap(gap.gap_type)),
          related_object_type: "coverage_gap",
          related_object_id: gap.id,
        });
      }
    }
    const available = [capacity.score, compliance.score, economic.score].filter((score): score is number => typeof score === "number");
    const coverageScore = available.length ? roundScore(available.reduce((sum, score) => sum + score, 0) / available.length) : null;
    return {
      coverage_readiness_score: coverageScore,
      capacity_readiness_score: capacity.score,
      compliance_readiness_score: compliance.score,
      economic_readiness_score: economic.score,
      coverage_readiness_band: coverageScore === null ? null : readinessBand(coverageScore),
      economic_readiness_status: economic.status,
      warnings,
      blockers,
    };
  }

  private async capacityScore(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      `
      WITH requirements AS (
        SELECT id, quantity FROM coverage_requirements
        WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
      ),
      covered AS (
        SELECT r.id, LEAST(r.quantity, COALESCE(sum(cs.covered_quantity), 0)) AS covered_quantity, r.quantity
        FROM requirements r
        LEFT JOIN coverage_sources cs ON cs.tenant_id = $1
          AND cs.coverage_plan_id = $2
          AND cs.coverage_requirement_id = r.id
          AND cs.deleted_at IS NULL
          AND cs.archived_at IS NULL
          AND cs.source_type <> 'unknown'
          AND cs.commitment_status NOT IN ('unavailable', 'rejected')
        GROUP BY r.id, r.quantity
      )
      SELECT count(*)::int AS requirement_count, COALESCE(sum(quantity), 0)::numeric AS required_quantity, COALESCE(sum(covered_quantity), 0)::numeric AS covered_quantity
      FROM covered
      `,
      [tenantId, planId],
    );
    const row = result.rows[0];
    const warnings: CoverageWarning[] = [];
    if (!row || Number(row.requirement_count) === 0) {
      warnings.push({ warning_type: "no_requirements", severity: "high", message: "Coverage requirements are not defined.", required_override_field: "capacity_override_reason" });
      return { score: null, warnings };
    }
    const required = Number(row.required_quantity);
    const covered = Number(row.covered_quantity);
    const score = required > 0 ? roundScore((covered / required) * 100) : 100;
    if (covered <= 0) warnings.push({ warning_type: "no_sources", severity: "high", message: "No credible coverage source covers the requirements.", required_override_field: "source_override_reason" });
    else if (covered < required) warnings.push({ warning_type: "capacity_gap", severity: "medium", message: "Coverage sources cover only part of the required quantity.", required_override_field: "capacity_override_reason" });
    return { score, warnings };
  }

  private async complianceScore(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      `
      SELECT cp.status AS provider_status, cr.compliance_status, cr.insurance_status
      FROM coverage_sources cs
      LEFT JOIN capacity_providers cp ON cp.id = cs.capacity_provider_id AND cp.tenant_id = cs.tenant_id
      LEFT JOIN LATERAL (
        SELECT compliance_status, insurance_status
        FROM capacity_records record
        WHERE record.tenant_id = cs.tenant_id AND record.capacity_provider_id = cs.capacity_provider_id AND record.deleted_at IS NULL
        ORDER BY record.created_at DESC
        LIMIT 1
      ) cr ON true
      WHERE cs.tenant_id = $1 AND cs.coverage_plan_id = $2 AND cs.deleted_at IS NULL AND cs.archived_at IS NULL AND cs.capacity_provider_id IS NOT NULL
      `,
      [tenantId, planId],
    );
    if (!result.rows.length) {
      return {
        score: null,
        warnings: [{ warning_type: "compliance_unknown", severity: "medium", message: "Compliance readiness is not safely available for this coverage plan.", required_override_field: "compliance_override_reason" } as CoverageWarning],
      };
    }
    const scores: number[] = result.rows.map((row) => providerComplianceScore(row));
    const score = roundScore(scores.reduce((sum, value) => sum + value, 0) / scores.length);
    const warnings: CoverageWarning[] = [];
    if (score < 70) warnings.push({ warning_type: "compliance_pending", severity: "high", message: "Compliance readiness is low or not fully verified.", required_override_field: "compliance_override_reason" });
    return { score, warnings };
  }

  private async economicScore(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      `
      SELECT expected_margin_amount, expected_margin_percent, margin_confidence
      FROM coverage_sources
      WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
      `,
      [tenantId, planId],
    );
    const warnings: CoverageWarning[] = [];
    if (!result.rows.length || result.rows.every((row) => row.expected_margin_amount === null && row.expected_margin_percent === null && !row.margin_confidence)) {
      warnings.push({ warning_type: "margin_unknown", severity: "medium", message: "Economic readiness is unknown.", required_override_field: "economic_override_reason" });
      return { score: 40, status: "unknown", warnings };
    }
    const hasNegative = result.rows.some((row) => Number(row.expected_margin_amount ?? 1) < 0 || Number(row.expected_margin_percent ?? 1) < 0);
    if (hasNegative) {
      warnings.push({ warning_type: "negative_margin", severity: "high", message: "Negative margin is present. Regional Director or Executive review is required by policy.", required_override_field: "economic_override_reason" });
      return { score: 30, status: "negative_margin", warnings };
    }
    const hasLow = result.rows.some((row) => row.margin_confidence === "low" || (row.expected_margin_percent !== null && Number(row.expected_margin_percent) >= 0 && Number(row.expected_margin_percent) < 10));
    if (hasLow) {
      warnings.push({ warning_type: "low_margin", severity: "medium", message: "Low margin is present.", required_override_field: "economic_override_reason" });
      return { score: 60, status: "low_margin", warnings };
    }
    const hasStrong = result.rows.some((row) => ["high", "verified"].includes(String(row.margin_confidence)) || Number(row.expected_margin_percent ?? -1) >= 20);
    return { score: hasStrong ? 100 : 85, status: hasStrong ? "strong_margin" : "acceptable_margin", warnings };
  }

  private async handoffValidation(client: PoolClient, tenantId: string, planId: string, calc: Recalculation, plan?: QueryResultRow) {
    const warnings = [...calc.warnings];
    const blockers = [...calc.blockers];
    const sourceCount = await this.activeSourceCount(client, tenantId, planId);
    const requirementCount = await this.activeRequirementCount(client, tenantId, planId);
    if (plan && (plan.status === "archived" || plan.archived_at)) {
      blockers.push({ blocker_type: "archived_plan", severity: "critical", message: "Archived coverage plans cannot be approved.", related_object_type: "coverage_plan", related_object_id: plan.id });
    }
    const opportunityStatus = plan?.opportunity_status ?? (plan?.opportunity_id ? await this.opportunityStatus(client, tenantId, plan.opportunity_id) : null);
    if (plan && normalizeOpportunityStatus(opportunityStatus) !== "awarded") {
      blockers.push({ blocker_type: "opportunity_not_awarded", severity: "critical", message: "Coverage handoff approval requires an awarded opportunity.", related_object_type: "opportunity", related_object_id: plan.opportunity_id });
    }
    if (requirementCount === 0 && !warnings.some((warning) => warning.warning_type === "no_requirements")) {
      warnings.push({ warning_type: "no_requirements", severity: "high", message: "Coverage requirements are not defined.", required_override_field: "capacity_override_reason" });
    }
    if (sourceCount === 0 && !warnings.some((warning) => warning.warning_type === "no_sources")) {
      warnings.push({ warning_type: "no_sources", severity: "high", message: "At least one coverage source is required unless overridden.", required_override_field: "source_override_reason" });
    }
    const requiredFields = Array.from(new Set(warnings.map((warning) => warning.required_override_field)));
    return { warnings, blockers, required_override_fields: requiredFields };
  }

  private async opportunityStatus(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query("SELECT status FROM opportunities WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1", [tenantId, opportunityId]);
    return result.rows[0]?.status ?? null;
  }

  private statusFromReadiness(currentStatus: string, calc: Recalculation) {
    if (currentStatus === "approved_for_handoff" || currentStatus === "archived") return currentStatus;
    if (calc.blockers.length) return "blocked";
    if (calc.warnings.some((warning) => warning.warning_type === "no_requirements")) return "not_started";
    if (calc.capacity_readiness_score === 100 && !calc.warnings.length) return "fully_covered";
    if ((calc.coverage_readiness_score ?? 0) >= 70) return "covered_with_risk";
    if (calc.warnings.some((warning) => warning.related_object_type === "coverage_gap")) return "gap_exists";
    if (calc.capacity_readiness_score !== null && calc.capacity_readiness_score > 0) return "partially_covered";
    return "requirements_defined";
  }

  private async activePlanForOpportunity(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query(
      "SELECT id FROM coverage_plans WHERE tenant_id = $1 AND opportunity_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND status <> 'archived' LIMIT 1",
      [tenantId, opportunityId],
    );
    return result.rows[0] ?? null;
  }

  private async requireOpportunity(client: PoolClient, tenantId: string, id: string) {
    const opportunity = await findTenantRecordById(client, "opportunities", tenantId, id);
    if (!opportunity) throw new NotFoundException("opportunity not found");
    return opportunity;
  }

  private async requirePlan(client: PoolClient, tenantId: string, id: string) {
    const plan = await findTenantRecordById(client, "coverage_plans", tenantId, id);
    if (!plan) throw new NotFoundException("coverage plan not found");
    return plan;
  }

  private async requireActivePlan(client: PoolClient, tenantId: string, id: string) {
    const plan = await this.requirePlan(client, tenantId, id);
    if (plan.status === "archived" || plan.archived_at) throw new BadRequestException("archived coverage plans cannot be updated");
    return plan;
  }

  private async requireRequirement(client: PoolClient, tenantId: string, id: string) {
    const requirement = await findTenantRecordById(client, "coverage_requirements", tenantId, id);
    if (!requirement) throw new NotFoundException("coverage requirement not found");
    return requirement;
  }

  private async requireRequirementForPlan(client: PoolClient, tenantId: string, id: string, planId: string) {
    const requirement = await this.requireRequirement(client, tenantId, id);
    if (requirement.coverage_plan_id !== planId) throw new BadRequestException("coverage requirement belongs to another coverage plan");
    return requirement;
  }

  private async requireSource(client: PoolClient, tenantId: string, id: string) {
    const source = await findTenantRecordById(client, "coverage_sources", tenantId, id);
    if (!source) throw new NotFoundException("coverage source not found");
    return source;
  }

  private async requireGap(client: PoolClient, tenantId: string, id: string) {
    const gap = await findTenantRecordById(client, "coverage_gaps", tenantId, id);
    if (!gap) throw new NotFoundException("coverage gap not found");
    return gap;
  }

  private async requireTenantRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const row = await findTenantRecordById(client, table, tenantId, id);
    if (!row) throw new NotFoundException(message);
    return row;
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      "SELECT u.id FROM users u JOIN tenant_users tu ON tu.user_id = u.id WHERE tu.tenant_id = $1 AND u.id = $2 AND tu.status = 'active' LIMIT 1",
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new BadRequestException("owner user is not an active tenant member");
  }

  private async activeRequirementCount(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM coverage_requirements WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL", [tenantId, planId]);
    return result.rows[0]?.count ?? 0;
  }

  private async activeSourceCount(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM coverage_sources WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL", [tenantId, planId]);
    return result.rows[0]?.count ?? 0;
  }

  private async sourceCommitmentWarnings(client: PoolClient, tenantId: string, planId: string): Promise<CoverageWarning[]> {
    const result = await client.query(
      `
      SELECT id, commitment_status
      FROM coverage_sources
      WHERE tenant_id = $1
        AND coverage_plan_id = $2
        AND deleted_at IS NULL
        AND archived_at IS NULL
        AND commitment_status NOT IN ('verbally_committed', 'committed')
      LIMIT 10
      `,
      [tenantId, planId],
    );
    return result.rows.map((row) => ({
      warning_type: "source_not_committed",
      severity: invalidSourceCommitments.has(String(row.commitment_status)) ? "high" : "medium",
      message: "Coverage source is not committed yet.",
      required_override_field: "source_override_reason",
      related_object_type: "coverage_source",
      related_object_id: row.id,
    }));
  }

  private async openGaps(client: PoolClient, tenantId: string, planId: string) {
    const result = await client.query(
      "SELECT * FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND status <> ALL($3)",
      [tenantId, planId, Array.from(closedGapStatuses)],
    );
    return result.rows;
  }

  private async archiveChild(request: AuthenticatedRequest, table: "coverage_requirements" | "coverage_sources" | "coverage_gaps", id: string, entityType: string, action: string, eventType: string, reason: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await findTenantRecordById(client, table, request.auth.tenantId, id);
      if (!before) throw new NotFoundException(`${entityType.replace("_", " ")} not found`);
      await this.requireActivePlan(client, request.auth.tenantId, before.coverage_plan_id);
      const values: Record<string, unknown> = {
        archive_reason: reason,
        archive_note: optionalText(request.body.archive_note ?? request.body.note),
        archived_by: request.auth.userId,
        archived_at: new Date(),
        updated_by: request.auth.userId,
      };
      if (table === "coverage_gaps") values.status = "archived";
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException(`${entityType.replace("_", " ")} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: { ...after, archive_reason: reason } };
    });
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
  return String(status ?? "");
}

function recommendedNextAction(row: QueryResultRow) {
  if (row.status === "archived" || row.archived_at) return "view_only";
  if (Number(row.active_requirements_count ?? 0) === 0) return "define_requirements";
  if (Number(row.active_sources_count ?? 0) === 0) return "identify_sources";
  if (Number(row.hard_stop_gaps_count ?? 0) > 0) return "resolve_hard_stops";
  if (Number(row.open_gaps_count ?? 0) > 0) return "resolve_or_override_gaps";
  if (row.economic_readiness_score === null || row.economic_readiness_score === undefined) return "review_margin";
  if (Number(row.economic_readiness_score) < 70) return "review_margin_risk";
  if (row.compliance_readiness_score === null || row.compliance_readiness_score === undefined) return "review_compliance";
  if (row.capacity_readiness_score === null || row.capacity_readiness_score === undefined) return "review_capacity";
  if (Number(row.coverage_readiness_score ?? 0) >= 85) return "approve_for_handoff";
  return "continue_coverage_planning";
}

function overrideFieldForWarning(warningType: string) {
  if (["margin_unknown", "low_margin", "negative_margin"].includes(warningType)) return "economic_override_reason";
  if (["compliance_unknown", "compliance_pending"].includes(warningType)) return "compliance_override_reason";
  if (["open_non_hard_stop_gaps"].includes(warningType)) return "gaps_override_reason";
  if (["no_sources", "source_not_committed"].includes(warningType)) return "source_override_reason";
  return "capacity_override_reason";
}

function warningTypeForGap(gapType: unknown) {
  const value = String(gapType ?? "");
  if (economicGapTypes.has(value)) {
    if (value === "negative_margin_gap") return "negative_margin";
    if (value === "low_margin_gap") return "low_margin";
    return "margin_unknown";
  }
  if (complianceGapTypes.has(value)) return "compliance_pending";
  if (capacityGapTypes.has(value)) return "capacity_gap";
  return "open_non_hard_stop_gaps";
}

function rangeFilter(value: unknown, min?: string, max?: string) {
  if (!min && !max) return true;
  if (value === null || value === undefined || value === "") return false;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return false;
  if (min && parsed < Number(min)) return false;
  if (max && parsed > Number(max)) return false;
  return true;
}

function dateMs(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function nullableSort(value: unknown, nullsFirst: boolean) {
  if (value === null || value === undefined || value === "") return nullsFirst ? -1 : 999;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : nullsFirst ? -1 : 999;
}

function sumNumeric(rows: QueryResultRow[], key: string) {
  const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== "").map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function averageNumeric(rows: QueryResultRow[], key: string) {
  const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== "").map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateQuantities(rows: QueryResultRow[], key: string) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row[key] === null || row[key] === undefined || !row.unit) continue;
    totals.set(`${row.work_type ?? "unknown"}:${row.unit}`, (totals.get(`${row.work_type ?? "unknown"}:${row.unit}`) ?? 0) + Number(row[key]));
  }
  return Array.from(totals.entries()).map(([compoundKey, quantity]) => {
    const [workType, unit] = compoundKey.split(":");
    return { work_type: workType, unit, quantity };
  });
}

function normalizeOverrideReasons(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, reason]) => typeof reason === "string" && reason.trim()).map(([key, reason]) => [key, String(reason).trim()]));
}

function optionalText(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, "value is required");
}

function nonNegativeNumber(value: unknown, field: string) {
  const parsed = numberValue(value, field);
  if (parsed < 0) throw new Error(`${field} must be non-negative`);
  return parsed;
}

function scoreNumber(value: unknown, field: string) {
  const parsed = numberValue(value, field);
  if (parsed < 0 || parsed > 100) throw new Error(`${field} must be between 0 and 100`);
  return parsed;
}

function numberValue(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be numeric`);
  return parsed;
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function readinessBand(score: number) {
  if (score <= 39) return "not_ready";
  if (score <= 69) return "needs_coverage_work";
  if (score <= 84) return "covered_with_risk";
  return "ready_for_handoff";
}

function providerComplianceScore(row: QueryResultRow) {
  if (["rejected", "expired", "archived", "suspended"].includes(String(row.compliance_status)) || ["rejected", "expired", "archived"].includes(String(row.insurance_status))) return 0;
  if (["compliant", "approved"].includes(String(row.compliance_status)) && ["active", "approved"].includes(String(row.insurance_status))) return 100;
  if (row.provider_status === "activated") return 100;
  if (row.provider_status === "contracted") return 80;
  if (row.provider_status === "verified") return 70;
  if (row.provider_status === "qualified") return 50;
  return 30;
}

function requireArchiveReason(body: Record<string, unknown>) {
  const value = body.archive_reason ?? body.reason;
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException("archive_reason is required");
  const reason = value.trim();
  if (!archiveReasonValues.has(reason)) throw new BadRequestException("archive_reason is invalid");
  return reason;
}
