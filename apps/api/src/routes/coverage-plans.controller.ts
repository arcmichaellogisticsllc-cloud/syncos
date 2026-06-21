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
const archiveReasonValues = new Set(["duplicate", "stale", "no_longer_relevant", "planning_changed", "other"]);

type CoverageWarning = {
  warning_type: string;
  severity: "low" | "medium" | "high";
  message: string;
  required_override_field: string;
  related_object_type?: string;
  related_object_id?: string | null;
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
    return this.withClient((client) => this.detailPlan(client, request.auth.tenantId, id));
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
        const validation = await this.handoffValidation(client, request.auth.tenantId, id, calc);
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
    const includeArchived = query.archived === "true";
    const result = await client.query(
      `
      SELECT
        cp.*,
        o.title AS opportunity_name,
        o.status AS opportunity_status,
        org.name AS organization_name,
        t.name AS territory_name,
        u.display_name AS operations_owner_name,
        (
          SELECT count(*)::int FROM coverage_requirements cr
          WHERE cr.tenant_id = cp.tenant_id AND cr.coverage_plan_id = cp.id AND cr.deleted_at IS NULL AND cr.archived_at IS NULL
        ) AS requirement_count,
        (
          SELECT count(*)::int FROM coverage_sources cs
          WHERE cs.tenant_id = cp.tenant_id AND cs.coverage_plan_id = cp.id AND cs.deleted_at IS NULL AND cs.archived_at IS NULL
        ) AS source_count,
        (
          SELECT count(*)::int FROM coverage_gaps cg
          WHERE cg.tenant_id = cp.tenant_id AND cg.coverage_plan_id = cp.id AND cg.deleted_at IS NULL AND cg.archived_at IS NULL AND cg.status NOT IN ('resolved', 'overridden', 'archived')
        ) AS open_gap_count
      FROM coverage_plans cp
      JOIN opportunities o ON o.id = cp.opportunity_id AND o.tenant_id = cp.tenant_id
      LEFT JOIN organizations org ON org.id = o.organization_id AND org.tenant_id = o.tenant_id
      LEFT JOIN territories t ON t.id = o.territory_id AND t.tenant_id = o.tenant_id
      LEFT JOIN users u ON u.id = cp.operations_owner_user_id
      WHERE cp.tenant_id = $1
        AND cp.deleted_at IS NULL
        AND ($2::boolean OR (cp.archived_at IS NULL AND cp.status <> 'archived'))
      ORDER BY cp.updated_at DESC
      LIMIT 100
      `,
      [tenantId, includeArchived],
    );
    return result.rows;
  }

  private async getPlan(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT cp.*, o.title AS opportunity_name, o.status AS opportunity_status, u.display_name AS operations_owner_name
      FROM coverage_plans cp
      JOIN opportunities o ON o.id = cp.opportunity_id AND o.tenant_id = cp.tenant_id
      LEFT JOIN users u ON u.id = cp.operations_owner_user_id
      WHERE cp.tenant_id = $1 AND cp.id = $2 AND cp.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async detailPlan(client: PoolClient, tenantId: string, id: string) {
    const plan = await this.getPlan(client, tenantId, id);
    if (!plan) throw new NotFoundException("coverage plan not found");
    const calc = await this.calculateReadiness(client, tenantId, id);
    const validation = await this.handoffValidation(client, tenantId, id, calc);
    return {
      coverage_plan: plan,
      opportunity: await this.opportunityContext(client, tenantId, plan.opportunity_id),
      requirements: await this.listRequirements(client, tenantId, id),
      sources: await this.listSources(client, tenantId, id),
      gaps: await this.listGaps(client, tenantId, id),
      readiness: {
        coverage_readiness_score: calc.coverage_readiness_score,
        capacity_readiness_score: calc.capacity_readiness_score,
        compliance_readiness_score: calc.compliance_readiness_score,
        economic_readiness_score: calc.economic_readiness_score,
        economic_readiness_status: calc.economic_readiness_status,
        coverage_readiness_band: calc.coverage_readiness_band,
      },
      warnings: validation.warnings,
      blockers: validation.blockers,
      required_override_fields: validation.required_override_fields,
      project_creation_boundary: "Coverage approval creates no project, work order, production, settlement, invoice, payment, payroll, or cash records.",
    };
  }

  private async opportunityContext(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT o.id, o.title AS opportunity_name, o.status, CASE WHEN o.status = 'qualified' THEN 'draft' WHEN o.status = 'bid_proposal' THEN 'proposal' ELSE o.status END AS normalized_status, o.work_type, o.estimated_value, o.owner_user_id,
        o.organization_id, org.name AS organization_name, o.territory_id, t.name AS territory_name,
        o.relationship_map_id, o.relationship_access_score, o.pursuit_score, o.expected_start_date, o.expected_decision_date
      FROM opportunities o
      LEFT JOIN organizations org ON org.id = o.organization_id AND org.tenant_id = o.tenant_id
      LEFT JOIN territories t ON t.id = o.territory_id AND t.tenant_id = o.tenant_id
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
      SELECT cr.*, t.name AS territory_name
      FROM coverage_requirements cr
      LEFT JOIN territories t ON t.id = cr.territory_id AND t.tenant_id = cr.tenant_id
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
      SELECT cs.*, org.name AS organization_name, cp.name AS capacity_provider_name, crew.name AS crew_name, eq.name AS equipment_name
      FROM coverage_sources cs
      LEFT JOIN organizations org ON org.id = cs.organization_id AND org.tenant_id = cs.tenant_id
      LEFT JOIN capacity_providers cp ON cp.id = cs.capacity_provider_id AND cp.tenant_id = cs.tenant_id
      LEFT JOIN crews crew ON crew.id = cs.crew_id AND crew.tenant_id = cs.tenant_id
      LEFT JOIN equipment eq ON eq.id = cs.equipment_id AND eq.tenant_id = cs.tenant_id
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
      SELECT cg.*, u.display_name AS owner_name, resolver.display_name AS resolved_by_name
      FROM coverage_gaps cg
      LEFT JOIN users u ON u.id = cg.owner_user_id
      LEFT JOIN users resolver ON resolver.id = cg.resolved_by
      WHERE cg.tenant_id = $1 AND cg.coverage_plan_id = $2 AND cg.deleted_at IS NULL
      ORDER BY cg.created_at DESC
      `,
      [tenantId, planId],
    );
    return result.rows;
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
    const [capacity, compliance, economic, gaps] = await Promise.all([
      this.capacityScore(client, tenantId, planId),
      this.complianceScore(client, tenantId, planId),
      this.economicScore(client, tenantId, planId),
      this.openGaps(client, tenantId, planId),
    ]);
    const warnings = [...capacity.warnings, ...compliance.warnings, ...economic.warnings];
    const blockers: CoverageBlocker[] = [];
    for (const gap of gaps) {
      if (gap.hard_stop || gap.status === "hard_blocked") {
        blockers.push({ blocker_type: "hard_stop_gap", severity: "critical", message: "Coverage gap is marked as a hard stop.", related_object_type: "coverage_gap", related_object_id: gap.id });
      } else {
        warnings.push({
          warning_type: String(gap.gap_type),
          severity: gap.severity === "critical" ? "high" : (gap.severity as "low" | "medium" | "high"),
          message: "Open coverage gap requires override or resolution before handoff approval.",
          required_override_field: `override_reasons.${gap.gap_type}`,
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
      warnings.push({ warning_type: "missing_requirements", severity: "high", message: "Coverage requirements are not defined.", required_override_field: "override_reasons.missing_requirements" });
      return { score: null, warnings };
    }
    const required = Number(row.required_quantity);
    const covered = Number(row.covered_quantity);
    const score = required > 0 ? roundScore((covered / required) * 100) : 100;
    if (covered <= 0) warnings.push({ warning_type: "missing_coverage_source", severity: "high", message: "No credible coverage source covers the requirements.", required_override_field: "override_reasons.missing_coverage_source" });
    else if (covered < required) warnings.push({ warning_type: "partial_coverage", severity: "medium", message: "Coverage sources cover only part of the required quantity.", required_override_field: "override_reasons.partial_coverage" });
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
        warnings: [{ warning_type: "unknown_compliance_readiness", severity: "medium", message: "Compliance readiness is not safely available for this coverage plan.", required_override_field: "override_reasons.unknown_compliance_readiness" } as CoverageWarning],
      };
    }
    const scores: number[] = result.rows.map((row) => providerComplianceScore(row));
    const score = roundScore(scores.reduce((sum, value) => sum + value, 0) / scores.length);
    const warnings: CoverageWarning[] = [];
    if (score < 70) warnings.push({ warning_type: "compliance_readiness_risk", severity: "high", message: "Compliance readiness is low or not fully verified.", required_override_field: "override_reasons.compliance_readiness_risk" });
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
      warnings.push({ warning_type: "margin_unknown_gap", severity: "medium", message: "Economic readiness is unknown.", required_override_field: "override_reasons.margin_unknown_gap" });
      return { score: 40, status: "unknown", warnings };
    }
    const hasNegative = result.rows.some((row) => Number(row.expected_margin_amount ?? 1) < 0 || Number(row.expected_margin_percent ?? 1) < 0);
    if (hasNegative) {
      warnings.push({ warning_type: "negative_margin_gap", severity: "high", message: "Negative margin is present. Regional Director or Executive review is required by policy.", required_override_field: "override_reasons.negative_margin_gap" });
      return { score: 30, status: "negative_margin", warnings };
    }
    const hasLow = result.rows.some((row) => row.margin_confidence === "low" || Number(row.expected_margin_amount ?? 1) === 0 || Number(row.expected_margin_percent ?? 1) === 0);
    if (hasLow) {
      warnings.push({ warning_type: "low_margin_gap", severity: "medium", message: "Low margin is present.", required_override_field: "override_reasons.low_margin_gap" });
      return { score: 60, status: "low_margin", warnings };
    }
    const hasStrong = result.rows.some((row) => ["high", "verified"].includes(String(row.margin_confidence)));
    return { score: hasStrong ? 100 : 85, status: hasStrong ? "strong_margin" : "acceptable_margin", warnings };
  }

  private async handoffValidation(client: PoolClient, tenantId: string, planId: string, calc: Recalculation) {
    const warnings = [...calc.warnings];
    const blockers = [...calc.blockers];
    const sourceCount = await this.activeSourceCount(client, tenantId, planId);
    const requirementCount = await this.activeRequirementCount(client, tenantId, planId);
    if (requirementCount === 0 && !warnings.some((warning) => warning.warning_type === "missing_requirements")) {
      warnings.push({ warning_type: "missing_requirements", severity: "high", message: "Coverage requirements are not defined.", required_override_field: "override_reasons.missing_requirements" });
    }
    if (sourceCount === 0 && !warnings.some((warning) => warning.warning_type === "missing_coverage_source")) {
      warnings.push({ warning_type: "missing_coverage_source", severity: "high", message: "At least one coverage source is required unless overridden.", required_override_field: "override_reasons.missing_coverage_source" });
    }
    const requiredFields = Array.from(new Set(warnings.map((warning) => warning.warning_type)));
    return { warnings, blockers, required_override_fields: requiredFields };
  }

  private statusFromReadiness(currentStatus: string, calc: Recalculation) {
    if (currentStatus === "approved_for_handoff" || currentStatus === "archived") return currentStatus;
    if (calc.blockers.length) return "blocked";
    if (calc.warnings.some((warning) => warning.warning_type === "missing_requirements")) return "not_started";
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
