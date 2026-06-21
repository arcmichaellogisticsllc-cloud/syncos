import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const handoffStatuses = new Set(["draft", "readiness_review", "ready_for_project", "approved", "rejected", "project_created", "blocked", "archived"]);
const checklistCategories = new Set(["core_identity", "operations_ownership", "coverage", "capacity", "compliance", "customer_contract", "financial_readiness", "documentation", "risk_review"]);
const checklistStatuses = new Set(["not_started", "in_progress", "complete", "overridden", "blocked", "not_applicable", "archived"]);
const riskTypes = new Set(["coverage_gap", "capacity_gap", "compliance_gap", "safety_gap", "contract_gap", "customer_requirement_gap", "financial_gap", "margin_gap", "documentation_gap", "schedule_gap", "ownership_gap", "scope_gap", "location_gap", "po_ntp_gap", "billing_gap", "ap_contact_gap", "hard_stop_constraint", "executive_hold", "other"]);
const riskSeverities = new Set(["low", "medium", "high", "critical"]);
const riskStatuses = new Set(["open", "assigned", "in_progress", "resolved", "overridden", "hard_blocked", "archived"]);
const rejectionReasons = new Set(["coverage_not_ready", "compliance_blocked", "capacity_blocked", "scope_incomplete", "customer_requirement_missing", "financial_risk", "duplicate", "other"]);
const archiveReasons = new Set(["duplicate", "no_longer_relevant", "replaced", "created_in_error", "opportunity_cancelled", "other"]);
const projectStatuses = new Set(["planning", "ready_for_work", "active", "on_hold", "completed", "closed", "archived"]);
const activeHandoffStatuses = ["draft", "readiness_review", "ready_for_project", "approved", "blocked"];

type HandoffWarning = {
  warning_type: string;
  severity: "low" | "medium" | "high";
  message: string;
  required_override_field: string;
  related_object_type?: string;
  related_object_id?: string | null;
};

type HandoffBlocker = {
  blocker_type: string;
  severity: "critical";
  message: string;
  related_object_type?: string;
  related_object_id?: string | null;
};

type ReadinessContext = {
  handoff: QueryResultRow;
  checklist: QueryResultRow[];
  risks: QueryResultRow[];
  coverageHardStops: QueryResultRow[];
  coveragePlan?: QueryResultRow;
  opportunity?: QueryResultRow;
};

type ReadinessResult = {
  handoff_readiness_score: number;
  handoff_readiness_band: string;
  warnings: HandoffWarning[];
  blockers: HandoffBlocker[];
  required_override_fields: string[];
  ready_for_project: boolean;
  recommended_next_action: string;
};

type DefaultChecklistItem = {
  category: string;
  checklist_key: string;
  label: string;
  required: boolean;
  hard_stop: boolean;
  override_allowed: boolean;
};

const defaultChecklistItems: DefaultChecklistItem[] = [
  { category: "core_identity", checklist_key: "opportunity_awarded", label: "Opportunity awarded", required: true, hard_stop: true, override_allowed: false },
  { category: "core_identity", checklist_key: "coverage_plan_approved", label: "Coverage plan approved", required: true, hard_stop: true, override_allowed: false },
  { category: "core_identity", checklist_key: "customer_confirmed", label: "Customer confirmed", required: true, hard_stop: true, override_allowed: false },
  { category: "core_identity", checklist_key: "territory_confirmed", label: "Territory confirmed", required: true, hard_stop: true, override_allowed: false },
  { category: "core_identity", checklist_key: "work_type_confirmed", label: "Work type confirmed", required: true, hard_stop: true, override_allowed: false },
  { category: "core_identity", checklist_key: "scope_summary_present", label: "Scope summary present", required: true, hard_stop: true, override_allowed: false },
  { category: "core_identity", checklist_key: "location_summary_present", label: "Location summary present", required: true, hard_stop: true, override_allowed: false },
  { category: "operations_ownership", checklist_key: "operations_owner_assigned", label: "Operations owner assigned", required: true, hard_stop: true, override_allowed: false },
  { category: "coverage", checklist_key: "hard_stop_gaps_resolved", label: "Hard stop gaps resolved", required: true, hard_stop: true, override_allowed: false },
  { category: "compliance", checklist_key: "compliance_reviewed", label: "Compliance reviewed", required: true, hard_stop: true, override_allowed: false },
  { category: "compliance", checklist_key: "safety_requirements_reviewed", label: "Safety requirements reviewed", required: true, hard_stop: true, override_allowed: false },
  { category: "customer_contract", checklist_key: "contract_requirement_identified", label: "Contract requirement identified", required: true, hard_stop: true, override_allowed: false },
  { category: "risk_review", checklist_key: "constraints_reviewed", label: "Constraints reviewed", required: true, hard_stop: true, override_allowed: false },
  { category: "operations_ownership", checklist_key: "project_manager_assigned", label: "Project manager assigned", required: true, hard_stop: false, override_allowed: true },
  { category: "operations_ownership", checklist_key: "field_supervisor_identified", label: "Field supervisor identified", required: false, hard_stop: false, override_allowed: true },
  { category: "customer_contract", checklist_key: "po_requirement_reviewed", label: "PO requirement reviewed", required: true, hard_stop: false, override_allowed: true },
  { category: "customer_contract", checklist_key: "ntp_requirement_reviewed", label: "NTP requirement reviewed", required: true, hard_stop: false, override_allowed: true },
  { category: "financial_readiness", checklist_key: "rate_schedule_requirement_identified", label: "Rate schedule requirement identified", required: true, hard_stop: false, override_allowed: true },
  { category: "financial_readiness", checklist_key: "billing_contact_identified", label: "Billing contact identified", required: true, hard_stop: false, override_allowed: true },
  { category: "financial_readiness", checklist_key: "ap_contact_identified", label: "AP contact identified", required: true, hard_stop: false, override_allowed: true },
  { category: "financial_readiness", checklist_key: "payment_terms_reviewed", label: "Payment terms reviewed", required: true, hard_stop: false, override_allowed: true },
  { category: "documentation", checklist_key: "required_documentation_identified", label: "Required documentation identified", required: true, hard_stop: false, override_allowed: true },
];

@Controller()
export class ProjectHandoffsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("project-handoffs")
  @RequirePermission("project_handoff.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const params: unknown[] = [request.auth.tenantId];
      const clauses = ["ph.tenant_id = $1", "ph.deleted_at IS NULL"];
      if (query.status) {
        params.push(query.status);
        clauses.push(`ph.status = $${params.length}`);
      }
      if (query.coverage_plan_id) {
        params.push(query.coverage_plan_id);
        clauses.push(`ph.coverage_plan_id = $${params.length}`);
      }
      if (query.opportunity_id) {
        params.push(query.opportunity_id);
        clauses.push(`ph.opportunity_id = $${params.length}`);
      }
      if (query.archived !== "true") clauses.push("ph.archived_at IS NULL AND ph.status <> 'archived'");
      if (query.q) {
        params.push(`%${query.q}%`);
        clauses.push(`(o.title ILIKE $${params.length} OR ph.status ILIKE $${params.length} OR ph.scope_summary ILIKE $${params.length} OR ph.location_summary ILIKE $${params.length})`);
      }
      const result = await client.query(
        `
        SELECT
          ph.*,
          o.title AS opportunity_name,
          o.status AS opportunity_status,
          cp.status AS coverage_plan_status,
          org.name AS customer_organization_name,
          t.name AS territory_name,
          owner.display_name AS operations_owner_name,
          pm.display_name AS project_manager_name,
          p.name AS project_name,
          (SELECT count(*)::int FROM project_handoff_checklist_items WHERE tenant_id = ph.tenant_id AND project_handoff_id = ph.id AND deleted_at IS NULL AND archived_at IS NULL) AS checklist_count,
          (SELECT count(*)::int FROM project_handoff_checklist_items WHERE tenant_id = ph.tenant_id AND project_handoff_id = ph.id AND deleted_at IS NULL AND archived_at IS NULL AND status IN ('complete', 'overridden', 'not_applicable')) AS completed_checklist_count,
          (SELECT count(*)::int FROM project_handoff_risks WHERE tenant_id = ph.tenant_id AND project_handoff_id = ph.id AND deleted_at IS NULL AND archived_at IS NULL AND status NOT IN ('resolved', 'overridden', 'archived')) AS open_risks_count,
          (SELECT count(*)::int FROM project_handoff_risks WHERE tenant_id = ph.tenant_id AND project_handoff_id = ph.id AND deleted_at IS NULL AND archived_at IS NULL AND status NOT IN ('resolved', 'overridden', 'archived') AND (hard_stop = true OR status = 'hard_blocked')) AS hard_stop_risks_count
        FROM project_handoffs ph
        JOIN opportunities o ON o.tenant_id = ph.tenant_id AND o.id = ph.opportunity_id
        JOIN coverage_plans cp ON cp.tenant_id = ph.tenant_id AND cp.id = ph.coverage_plan_id
        LEFT JOIN organizations org ON org.tenant_id = ph.tenant_id AND org.id = ph.customer_organization_id
        LEFT JOIN territories t ON t.tenant_id = ph.tenant_id AND t.id = ph.territory_id
        LEFT JOIN users owner ON owner.id = ph.operations_owner_user_id
        LEFT JOIN users pm ON pm.id = ph.project_manager_user_id
        LEFT JOIN projects p ON p.tenant_id = ph.tenant_id AND p.id = ph.project_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY ph.updated_at DESC
        LIMIT 100
        `,
        params,
      );
      const rows = [];
      for (const row of result.rows) {
        const readiness = await this.calculateReadiness(client, request.auth.tenantId, row.id, row);
        rows.push({ ...row, ...readiness });
      }
      return rows;
    });
  }

  @Get("project-handoffs/:id")
  @RequirePermission("project_handoff.read")
  async get(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => this.requireHandoff(client, request.auth.tenantId, id));
  }

  @Get("project-handoffs/:id/detail")
  @RequirePermission("project_handoff.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.detailHandoff(client, request.auth.tenantId, id, request.auth.userId));
  }

  @Post("project-handoffs")
  @RequirePermission("project_handoff.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const opportunityId = requiredText(body.opportunity_id, "opportunity_id is required");
    const coveragePlanId = requiredText(body.coverage_plan_id, "coverage_plan_id is required");
    return this.write(request, "project_handoff.create", "project_handoff.created", "project_handoff", async (client) => {
      const opportunity = await this.requireRecord(client, "opportunities", request.auth.tenantId, opportunityId, "opportunity not found");
      if (normalizeOpportunityStatus(opportunity.status) !== "awarded" || opportunity.archived_at || opportunity.deleted_at) throw new BadRequestException("handoff requires awarded opportunity");
      const coveragePlan = await this.requireRecord(client, "coverage_plans", request.auth.tenantId, coveragePlanId, "coverage plan not found");
      if (coveragePlan.opportunity_id !== opportunityId) throw new BadRequestException("coverage plan must belong to opportunity");
      if (coveragePlan.status !== "approved_for_handoff") throw new BadRequestException("handoff requires approved coverage plan");
      const duplicate = await client.query(
        "SELECT id FROM project_handoffs WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND status = ANY($3) LIMIT 1",
        [request.auth.tenantId, coveragePlanId, activeHandoffStatuses],
      );
      if (duplicate.rows[0] && !optionalText(body.override_reason)) throw new BadRequestException("duplicate active handoff requires override reason");
      const values = await this.handoffValuesFromBody(client, request.auth.tenantId, opportunity, coveragePlan, body);
      const handoff = await insertTenantRecord(client, "project_handoffs", request.auth.tenantId, {
        ...values,
        opportunity_id: opportunityId,
        coverage_plan_id: coveragePlanId,
        status: "draft",
        override_reasons: body.override_reasons ?? {},
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      const checklist = await this.createDefaultChecklist(client, request.auth.tenantId, handoff.id, handoff, request.auth.userId);
      const readiness = await this.calculateReadiness(client, request.auth.tenantId, handoff.id, { ...handoff, checklist_count: checklist.length });
      await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, handoff.id, {
        handoff_readiness_score: readiness.handoff_readiness_score,
        handoff_readiness_band: readiness.handoff_readiness_band,
      });
      return { entityType: "project_handoff", entityId: handoff.id, afterState: await this.detailHandoff(client, request.auth.tenantId, handoff.id) };
    });
  }

  @Patch("project-handoffs/:id")
  @RequirePermission("project_handoff.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["scope_summary", "location_summary", "expected_start_date", "expected_end_date", "handoff_notes", "override_reasons"]);
    if (body.status !== undefined) values.status = allowedValue(body.status, handoffStatuses, "status");
    for (const userField of ["operations_owner_user_id", "project_manager_user_id", "field_supervisor_user_id"]) {
      if (body[userField] !== undefined) values[userField] = optionalText(body[userField]);
    }
    return this.write(request, "project_handoff.update", "project_handoff.updated", "project_handoff", async (client) => {
      const before = await this.requireActiveHandoff(client, request.auth.tenantId, id);
      await this.validateHandoffRelations(client, request.auth.tenantId, values);
      const after = await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, id, { ...values, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("project handoff not found");
      return { entityType: "project_handoff", entityId: id, beforeState: before, afterState: await this.detailHandoff(client, request.auth.tenantId, id) };
    });
  }

  @Post("project-handoffs/:id/recalculate")
  @RequirePermission("project_handoff.recalculate")
  async recalculate(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "project_handoff.recalculate", "project_handoff.recalculated", "project_handoff", async (client) => {
      const before = await this.requireActiveHandoff(client, request.auth.tenantId, id);
      const readiness = await this.calculateReadiness(client, request.auth.tenantId, id, before);
      await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, id, {
        handoff_readiness_score: readiness.handoff_readiness_score,
        handoff_readiness_band: readiness.handoff_readiness_band,
        status: before.status === "draft" && readiness.ready_for_project ? "ready_for_project" : before.status,
        updated_by: request.auth.userId,
      });
      return { entityType: "project_handoff", entityId: id, beforeState: before, afterState: await this.detailHandoff(client, request.auth.tenantId, id) };
    });
  }

  @Post("project-handoffs/:id/submit-readiness-review")
  @RequirePermission("project_handoff.submit_review")
  async submitReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reviewNote = requiredText(body.review_note, "review_note is required");
    return this.write(request, "project_handoff.submit_review", "project_handoff.readiness_review_submitted", "project_handoff", async (client) => {
      const before = await this.requireActiveHandoff(client, request.auth.tenantId, id);
      await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, id, { status: "readiness_review", handoff_notes: reviewNote, updated_by: request.auth.userId });
      return { entityType: "project_handoff", entityId: id, beforeState: before, afterState: await this.detailHandoff(client, request.auth.tenantId, id) };
    });
  }

  @Post("project-handoffs/:id/approve")
  @RequirePermission("project_handoff.approve")
  async approve(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const approvalNote = requiredText(body.approval_note, "approval_note is required");
    return this.write(request, "project_handoff.approve", "project_handoff.approved", "project_handoff", async (client) => {
      const before = await this.requireActiveHandoff(client, request.auth.tenantId, id);
      const readiness = await this.calculateReadiness(client, request.auth.tenantId, id, before);
      if (readiness.blockers.length) throw new BadRequestException({ message: "Project handoff approval blocked.", blockers: readiness.blockers });
      const overrideReasons = objectValue(body.override_reasons);
      const missing = readiness.required_override_fields.filter((field) => !optionalText(overrideReasons[field]));
      if (missing.length) throw new BadRequestException({ message: "Project handoff approval requires override reason for warnings.", warnings: readiness.warnings, required_override_fields: missing });
      await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, id, {
        status: "approved",
        approved_by: request.auth.userId,
        approved_at: new Date(),
        override_reasons: overrideReasons,
        handoff_readiness_score: readiness.handoff_readiness_score,
        handoff_readiness_band: readiness.handoff_readiness_band,
        updated_by: request.auth.userId,
      });
      await insertTenantRecord(client, "project_handoff_approvals", request.auth.tenantId, {
        project_handoff_id: id,
        approval_type: "handoff_approval",
        status: "approved",
        approved_by: request.auth.userId,
        approved_at: new Date(),
        approval_note: approvalNote,
        override_reasons: overrideReasons,
        readiness_score: readiness.handoff_readiness_score,
        warnings: JSON.stringify(readiness.warnings),
        blockers: JSON.stringify(readiness.blockers),
        created_by: request.auth.userId,
      });
      return { entityType: "project_handoff", entityId: id, beforeState: before, afterState: await this.detailHandoff(client, request.auth.tenantId, id) };
    });
  }

  @Post("project-handoffs/:id/reject")
  @RequirePermission("project_handoff.reject")
  async reject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = allowedValue(body.rejection_reason, rejectionReasons, "rejection_reason");
    return this.write(request, "project_handoff.reject", "project_handoff.rejected", "project_handoff", async (client) => {
      const before = await this.requireActiveHandoff(client, request.auth.tenantId, id);
      await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, id, {
        status: "rejected",
        rejected_by: request.auth.userId,
        rejected_at: new Date(),
        rejection_reason: reason,
        rejection_note: optionalText(body.rejection_note),
        updated_by: request.auth.userId,
      });
      await insertTenantRecord(client, "project_handoff_approvals", request.auth.tenantId, {
        project_handoff_id: id,
        approval_type: "handoff_approval",
        status: "rejected",
        rejected_by: request.auth.userId,
        rejected_at: new Date(),
        rejection_reason: reason,
        approval_note: optionalText(body.rejection_note),
        created_by: request.auth.userId,
      });
      return { entityType: "project_handoff", entityId: id, beforeState: before, afterState: await this.detailHandoff(client, request.auth.tenantId, id) };
    });
  }

  @Post("project-handoffs/:id/create-project")
  @RequirePermission("project_handoff.create_project")
  async createProject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const creationNote = requiredText(body.creation_note, "creation_note is required");
    return this.write(request, "project_handoff.create_project", "project_handoff.project_created", "project_handoff", async (client) => {
      if (!(await this.actorHasPermission(client, request.auth.tenantId, request.auth.userId, "project.create"))) throw new BadRequestException("You do not have permission to create a project.");
      const before = await this.requireHandoff(client, request.auth.tenantId, id);
      if (before.status !== "approved") throw new BadRequestException("project creation requires approved handoff");
      if (before.project_id) throw new BadRequestException("project already created from handoff");
      const readiness = await this.calculateReadiness(client, request.auth.tenantId, id, before);
      if (readiness.blockers.length) throw new BadRequestException({ message: "Project creation blocked.", blockers: readiness.blockers });
      const missing = this.projectCreationMissingFields(before, body);
      if (missing.length) throw new BadRequestException({ message: "Project creation requires minimum project fields.", missing_fields: missing });
      const coveragePlan = await findTenantRecordById(client, "coverage_plans", request.auth.tenantId, before.coverage_plan_id);
      const project = await insertTenantRecord(client, "projects", request.auth.tenantId, {
        opportunity_id: before.opportunity_id,
        source_opportunity_id: before.opportunity_id,
        source_coverage_plan_id: before.coverage_plan_id,
        source_project_handoff_id: before.id,
        customer_organization_id: before.customer_organization_id,
        territory_id: before.territory_id,
        work_type: before.work_type,
        scope_summary: before.scope_summary,
        location_summary: before.location_summary,
        operations_owner_user_id: before.operations_owner_user_id,
        project_manager_user_id: before.project_manager_user_id,
        expected_start_date: before.expected_start_date,
        expected_end_date: before.expected_end_date,
        planned_start_date: before.expected_start_date,
        planned_end_date: before.expected_end_date,
        project_phase: "intake",
        coverage_readiness_score: coveragePlan?.coverage_readiness_score,
        compliance_readiness_score: coveragePlan?.compliance_readiness_score,
        financial_readiness_score: coveragePlan?.economic_readiness_score,
        name: projectName(before),
        status: "planning",
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, id, {
        project_id: project.id,
        status: "project_created",
        created_project_by: request.auth.userId,
        created_project_at: new Date(),
        updated_by: request.auth.userId,
      });
      await insertTenantRecord(client, "project_handoff_approvals", request.auth.tenantId, {
        project_handoff_id: id,
        approval_type: "project_creation_approval",
        status: "approved",
        approved_by: request.auth.userId,
        approved_at: new Date(),
        approval_note: creationNote,
        readiness_score: readiness.handoff_readiness_score,
        warnings: JSON.stringify(readiness.warnings),
        blockers: JSON.stringify(readiness.blockers),
        created_by: request.auth.userId,
      });
      const afterState = await this.detailHandoff(client, request.auth.tenantId, id);
      return {
        entityType: "project_handoff",
        entityId: id,
        beforeState: before,
        afterState: { ...afterState, project_creation_message: "Project created in planning status. No work orders, production, or finance records were created." },
        additionalEvents: [
          {
            action: "project.create",
            aggregateType: "project",
            entityType: "project",
            entityId: project.id,
            eventType: "project.created",
            afterState: project,
            systemActions: [{ actionType: "project.created.processed", payload: { source_project_handoff_id: id } }],
          },
        ],
      };
    });
  }

  @Post("project-handoffs/:id/archive")
  @RequirePermission("project_handoff.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = allowedValue(body.archive_reason, archiveReasons, "archive_reason");
    return this.write(request, "project_handoff.archive", "project_handoff.archived", "project_handoff", async (client) => {
      const before = await this.requireHandoff(client, request.auth.tenantId, id);
      const after = await updateTenantRecord(client, "project_handoffs", request.auth.tenantId, id, {
        status: "archived",
        archive_reason: reason,
        archive_note: optionalText(body.archive_note),
        archived_by: request.auth.userId,
        archived_at: new Date(),
        updated_by: request.auth.userId,
      });
      return { entityType: "project_handoff", entityId: id, beforeState: before, afterState: after ?? before };
    });
  }

  @Get("project-handoffs/:id/checklist-items")
  @RequirePermission("project_handoff_checklist.read")
  async listChecklist(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireHandoff(client, request.auth.tenantId, id);
      const result = await client.query("SELECT * FROM project_handoff_checklist_items WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL ORDER BY created_at", [request.auth.tenantId, id]);
      return result.rows;
    });
  }

  @Post("project-handoffs/:id/checklist-items")
  @RequirePermission("project_handoff_checklist.create")
  async createChecklist(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "project_handoff_checklist.create", "project_handoff_checklist.created", "project_handoff_checklist", async (client) => {
      await this.requireActiveHandoff(client, request.auth.tenantId, id);
      const item = await insertTenantRecord(client, "project_handoff_checklist_items", request.auth.tenantId, {
        project_handoff_id: id,
        category: allowedValue(body.category, checklistCategories, "category"),
        checklist_key: requiredText(body.checklist_key, "checklist_key is required"),
        label: requiredText(body.label, "label is required"),
        status: body.status ? allowedValue(body.status, checklistStatuses, "status") : "not_started",
        required: boolValue(body.required, true),
        hard_stop: boolValue(body.hard_stop, false),
        override_allowed: boolValue(body.override_allowed, true),
        owner_user_id: optionalText(body.owner_user_id),
        due_date: optionalText(body.due_date),
        notes: optionalText(body.notes),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "project_handoff_checklist", entityId: item.id, afterState: item };
    });
  }

  @Patch("project-handoff-checklist-items/:id")
  @RequirePermission("project_handoff_checklist.update")
  async updateChecklist(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["label", "owner_user_id", "due_date", "notes"]);
    if (body.status !== undefined) values.status = allowedValue(body.status, checklistStatuses, "status");
    if (body.required !== undefined) values.required = boolValue(body.required, true);
    if (body.hard_stop !== undefined) values.hard_stop = boolValue(body.hard_stop, false);
    if (body.override_allowed !== undefined) values.override_allowed = boolValue(body.override_allowed, true);
    return this.childUpdate(request, "project_handoff_checklist_items", id, "project_handoff_checklist.update", "project_handoff_checklist.updated", "project_handoff_checklist", values);
  }

  @Post("project-handoff-checklist-items/:id/complete")
  @RequirePermission("project_handoff_checklist.complete")
  async completeChecklist(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.childUpdate(request, "project_handoff_checklist_items", id, "project_handoff_checklist.complete", "project_handoff_checklist.completed", "project_handoff_checklist", {
      status: "complete",
      completed_by: request.auth.userId,
      completed_at: new Date(),
    });
  }

  @Post("project-handoff-checklist-items/:id/override")
  @RequirePermission("project_handoff_checklist.override")
  async overrideChecklist(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = requiredText(body.override_reason, "override_reason is required");
    return this.childUpdate(request, "project_handoff_checklist_items", id, "project_handoff_checklist.override", "project_handoff_checklist.overridden", "project_handoff_checklist", {
      status: "overridden",
      override_reason: reason,
      override_note: optionalText(body.override_note),
    });
  }

  @Post("project-handoff-checklist-items/:id/archive")
  @RequirePermission("project_handoff_checklist.archive")
  async archiveChecklist(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = allowedValue(body.archive_reason, archiveReasons, "archive_reason");
    return this.childUpdate(request, "project_handoff_checklist_items", id, "project_handoff_checklist.archive", "project_handoff_checklist.archived", "project_handoff_checklist", {
      status: "archived",
      archive_reason: reason,
      archive_note: optionalText(body.archive_note),
      archived_by: request.auth.userId,
      archived_at: new Date(),
    });
  }

  @Get("project-handoffs/:id/risks")
  @RequirePermission("project_handoff_risk.read")
  async listRisks(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireHandoff(client, request.auth.tenantId, id);
      const result = await client.query("SELECT * FROM project_handoff_risks WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL ORDER BY created_at", [request.auth.tenantId, id]);
      return result.rows;
    });
  }

  @Post("project-handoffs/:id/risks")
  @RequirePermission("project_handoff_risk.create")
  async createRisk(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "project_handoff_risk.create", "project_handoff_risk.created", "project_handoff_risk", async (client) => {
      await this.requireActiveHandoff(client, request.auth.tenantId, id);
      const risk = await insertTenantRecord(client, "project_handoff_risks", request.auth.tenantId, {
        project_handoff_id: id,
        risk_type: allowedValue(body.risk_type, riskTypes, "risk_type"),
        severity: allowedValue(body.severity, riskSeverities, "severity"),
        source_object_type: optionalText(body.source_object_type),
        source_object_id: optionalText(body.source_object_id),
        message: requiredText(body.message, "message is required"),
        recommended_action: optionalText(body.recommended_action),
        hard_stop: boolValue(body.hard_stop, false),
        override_allowed: boolValue(body.override_allowed, true),
        status: body.status ? allowedValue(body.status, riskStatuses, "status") : "open",
        owner_user_id: optionalText(body.owner_user_id),
        due_date: optionalText(body.due_date),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "project_handoff_risk", entityId: risk.id, afterState: risk };
    });
  }

  @Patch("project-handoff-risks/:id")
  @RequirePermission("project_handoff_risk.update")
  async updateRisk(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["message", "recommended_action", "source_object_type", "source_object_id", "owner_user_id", "due_date"]);
    if (body.risk_type !== undefined) values.risk_type = allowedValue(body.risk_type, riskTypes, "risk_type");
    if (body.severity !== undefined) values.severity = allowedValue(body.severity, riskSeverities, "severity");
    if (body.status !== undefined) values.status = allowedValue(body.status, riskStatuses, "status");
    if (body.hard_stop !== undefined) values.hard_stop = boolValue(body.hard_stop, false);
    if (body.override_allowed !== undefined) values.override_allowed = boolValue(body.override_allowed, true);
    return this.childUpdate(request, "project_handoff_risks", id, "project_handoff_risk.update", "project_handoff_risk.updated", "project_handoff_risk", values);
  }

  @Post("project-handoff-risks/:id/resolve")
  @RequirePermission("project_handoff_risk.resolve")
  async resolveRisk(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const note = requiredText(body.resolution_note, "resolution_note is required");
    return this.childUpdate(request, "project_handoff_risks", id, "project_handoff_risk.resolve", "project_handoff_risk.resolved", "project_handoff_risk", {
      status: "resolved",
      resolution_note: note,
      resolved_by: request.auth.userId,
      resolved_at: new Date(),
    });
  }

  @Post("project-handoff-risks/:id/override")
  @RequirePermission("project_handoff_risk.override")
  async overrideRisk(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = requiredText(body.override_reason, "override_reason is required");
    return this.childUpdate(request, "project_handoff_risks", id, "project_handoff_risk.override", "project_handoff_risk.overridden", "project_handoff_risk", {
      status: "overridden",
      override_reason: reason,
      override_note: optionalText(body.override_note),
    });
  }

  @Post("project-handoff-risks/:id/archive")
  @RequirePermission("project_handoff_risk.archive")
  async archiveRisk(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = allowedValue(body.archive_reason, archiveReasons, "archive_reason");
    return this.childUpdate(request, "project_handoff_risks", id, "project_handoff_risk.archive", "project_handoff_risk.archived", "project_handoff_risk", {
      status: "archived",
      archive_reason: reason,
      archive_note: optionalText(body.archive_note),
      archived_by: request.auth.userId,
      archived_at: new Date(),
    });
  }

  @Get("project-handoffs/:id/approvals")
  @RequirePermission("project_handoff_approval.read")
  async approvals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireHandoff(client, request.auth.tenantId, id);
      const result = await client.query("SELECT * FROM project_handoff_approvals WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, id]);
      return result.rows;
    });
  }

  @Get("project-handoffs/:id/timeline")
  @RequirePermission("project_handoff.timeline.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const handoff = await this.requireHandoff(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH checklist_ids AS (SELECT id FROM project_handoff_checklist_items WHERE tenant_id = $1 AND project_handoff_id = $2),
        risk_ids AS (SELECT id FROM project_handoff_risks WHERE tenant_id = $1 AND project_handoff_id = $2)
        SELECT e.id AS event_id, e.event_type, e.actor_user_id AS actor_id, u.display_name AS actor_name, e.occurred_at AS timestamp,
          e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'project_handoff' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'project_handoff_checklist' AND e.aggregate_id IN (SELECT id FROM checklist_ids))
            OR (e.aggregate_type = 'project_handoff_risk' AND e.aggregate_id IN (SELECT id FROM risk_ids))
            OR (e.aggregate_type = 'project' AND e.aggregate_id = $3)
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, handoff.project_id],
      );
      return result.rows;
    });
  }

  @Get("project-handoffs/:id/audit-summary")
  @RequirePermission("project_handoff.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const handoff = await this.requireHandoff(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        WITH checklist_ids AS (SELECT id FROM project_handoff_checklist_items WHERE tenant_id = $1 AND project_handoff_id = $2),
        risk_ids AS (SELECT id FROM project_handoff_risks WHERE tenant_id = $1 AND project_handoff_id = $2),
        approval_ids AS (SELECT id FROM project_handoff_approvals WHERE tenant_id = $1 AND project_handoff_id = $2)
        SELECT al.id AS audit_id, al.actor_user_id AS actor_id, u.display_name AS actor_name, al.action,
          al.entity_type AS object_type, al.entity_id AS object_id, al.before_state AS before_json, al.after_state AS after_json,
          al.metadata->>'reason' AS reason, al.created_at, al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1
          AND (
            (al.entity_type = 'project_handoff' AND al.entity_id = $2)
            OR (al.entity_type = 'project_handoff_checklist' AND al.entity_id IN (SELECT id FROM checklist_ids))
            OR (al.entity_type = 'project_handoff_risk' AND al.entity_id IN (SELECT id FROM risk_ids))
            OR (al.entity_type = 'project_handoff_approval' AND al.entity_id IN (SELECT id FROM approval_ids))
            OR (al.entity_type = 'project' AND al.entity_id = $3)
          )
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, handoff.project_id],
      );
      return result.rows;
    });
  }

  private async detailHandoff(client: PoolClient, tenantId: string, id: string, actorUserId?: string) {
    const handoff = await this.requireHandoff(client, tenantId, id);
    const [checklist, risks, approvals] = await Promise.all([
      client.query("SELECT * FROM project_handoff_checklist_items WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL ORDER BY created_at", [tenantId, id]),
      client.query("SELECT * FROM project_handoff_risks WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL ORDER BY created_at", [tenantId, id]),
      client.query("SELECT * FROM project_handoff_approvals WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [tenantId, id]),
    ]);
    const readiness = await this.calculateReadiness(client, tenantId, id, handoff, checklist.rows, risks.rows);
    return {
      project_handoff: { ...handoff, ...readiness },
      opportunity_context: await this.opportunityContext(client, tenantId, handoff.opportunity_id),
      coverage_plan_context: await this.coverageContext(client, tenantId, handoff.coverage_plan_id),
      checklist_items: checklist.rows,
      risks: risks.rows,
      approvals: approvals.rows,
      readiness,
      warnings: readiness.warnings,
      blockers: readiness.blockers,
      required_override_fields: readiness.required_override_fields,
      recommended_next_action: readiness.recommended_next_action,
      audit_allowed: actorUserId ? await this.actorHasPermission(client, tenantId, actorUserId, "project_handoff.audit.read") : false,
      timeline_available: true,
      project_creation_boundary: "Project Handoff creates only a planning project through the explicit create-project route. It creates no work orders, production, or finance records.",
    };
  }

  private async calculateReadiness(client: PoolClient, tenantId: string, id: string, handoffRow?: QueryResultRow, checklistRows?: QueryResultRow[], riskRows?: QueryResultRow[]): Promise<ReadinessResult> {
    const handoff = handoffRow ?? await this.requireHandoff(client, tenantId, id);
    const checklist = checklistRows ?? (await client.query("SELECT * FROM project_handoff_checklist_items WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL AND archived_at IS NULL", [tenantId, id])).rows;
    const risks = riskRows ?? (await client.query("SELECT * FROM project_handoff_risks WHERE tenant_id = $1 AND project_handoff_id = $2 AND deleted_at IS NULL AND archived_at IS NULL", [tenantId, id])).rows;
    const coveragePlan = await this.requireRecord(client, "coverage_plans", tenantId, handoff.coverage_plan_id, "coverage plan not found");
    const opportunity = await this.requireRecord(client, "opportunities", tenantId, handoff.opportunity_id, "opportunity not found");
    const coverageHardStops = (await client.query(
      "SELECT id, gap_type, severity FROM coverage_gaps WHERE tenant_id = $1 AND coverage_plan_id = $2 AND deleted_at IS NULL AND archived_at IS NULL AND status NOT IN ('resolved', 'overridden', 'archived') AND (hard_stop = true OR status = 'hard_blocked')",
      [tenantId, handoff.coverage_plan_id],
    )).rows;
    return this.readinessFromContext({ handoff, checklist, risks, coverageHardStops, coveragePlan, opportunity });
  }

  private readinessFromContext(context: ReadinessContext): ReadinessResult {
    const warnings: HandoffWarning[] = [];
    const blockers: HandoffBlocker[] = [];
    const addBlocker = (blocker_type: string, message: string, related_object_type?: string, related_object_id?: string | null) => blockers.push({ blocker_type, severity: "critical", message, related_object_type, related_object_id });
    const addWarning = (warning_type: string, severity: "low" | "medium" | "high", message: string, required_override_field: string, related_object_type?: string, related_object_id?: string | null) => warnings.push({ warning_type, severity, message, required_override_field, related_object_type, related_object_id });

    if (context.handoff.status === "archived" || context.handoff.archived_at) addBlocker("archived_handoff", "Archived handoffs cannot be approved.", "project_handoff", context.handoff.id);
    if (normalizeOpportunityStatus(context.opportunity?.status) !== "awarded") addBlocker("opportunity_not_awarded", "Project handoff requires an awarded opportunity.", "opportunity", context.handoff.opportunity_id);
    if (context.coveragePlan?.status !== "approved_for_handoff") addBlocker("coverage_plan_not_approved", "Project handoff requires approved coverage.", "coverage_plan", context.handoff.coverage_plan_id);
    for (const field of ["customer_organization_id", "territory_id", "work_type", "scope_summary", "location_summary"]) {
      if (!context.handoff[field]) addBlocker(`missing_${field}`, `Project handoff is missing ${field}.`, "project_handoff", context.handoff.id);
    }
    for (const gap of context.coverageHardStops) addBlocker("unresolved_hard_stop_coverage_gap", "Unresolved hard stop coverage gap blocks handoff.", "coverage_gap", gap.id);

    const applicable = context.checklist.filter((item) => item.archived_at == null && item.status !== "archived" && item.status !== "not_applicable");
    const completed = applicable.filter((item) => item.status === "complete" || item.status === "overridden");
    for (const item of applicable) {
      const unresolved = item.status !== "complete" && item.status !== "overridden";
      if (!unresolved) continue;
      if (item.hard_stop) addBlocker("unresolved_hard_stop_checklist_item", `${item.label} must be completed before handoff approval.`, "project_handoff_checklist", item.id);
      else if (item.required) addWarning("required_checklist_incomplete", "medium", `${item.label} is not complete.`, "checklist_override_reason", "project_handoff_checklist", item.id);
    }
    for (const risk of context.risks.filter((risk) => risk.archived_at == null && !["resolved", "overridden", "archived"].includes(risk.status))) {
      if (risk.hard_stop || risk.status === "hard_blocked") addBlocker("unresolved_hard_stop_risk", risk.message, "project_handoff_risk", risk.id);
      else addWarning("open_handoff_risk", risk.severity === "critical" ? "high" : "medium", risk.message, "risk_override_reason", "project_handoff_risk", risk.id);
    }
    if (!context.handoff.project_manager_user_id) addWarning("project_manager_not_assigned", "medium", "Project manager is not assigned.", "project_manager_override_reason", "project_handoff", context.handoff.id);
    if (!context.handoff.field_supervisor_user_id) addWarning("field_supervisor_not_identified", "low", "Field supervisor is not identified.", "operations_override_reason", "project_handoff", context.handoff.id);
    if (context.coveragePlan?.coverage_readiness_band === "covered_with_risk" || Number(context.coveragePlan?.coverage_readiness_score ?? 100) < 85) addWarning("coverage_approved_with_risk", "medium", "Coverage was approved with remaining risk.", "coverage_override_reason", "coverage_plan", context.handoff.coverage_plan_id);

    const baseScore = applicable.length ? Math.round((completed.length / applicable.length) * 100) : 0;
    let score = baseScore;
    if (blockers.length) score = Math.min(score, 39);
    else if (context.risks.some((risk) => risk.severity === "critical" && !["resolved", "overridden", "archived"].includes(risk.status))) score = Math.min(score, 69);
    else if (warnings.length) score = Math.min(score, 84);
    const band = score >= 85 ? "ready_for_project" : score >= 70 ? "ready_with_risk" : score >= 40 ? "needs_handoff_work" : "not_ready";
    const required_override_fields = Array.from(new Set(warnings.map((warning) => warning.required_override_field)));
    return {
      handoff_readiness_score: score,
      handoff_readiness_band: band,
      warnings,
      blockers,
      required_override_fields,
      ready_for_project: !blockers.length && score >= 85,
      recommended_next_action: recommendedNextAction(context.handoff.status, blockers, warnings, band),
    };
  }

  private async createDefaultChecklist(client: PoolClient, tenantId: string, handoffId: string, handoff: QueryResultRow, actorUserId: string) {
    const rows = [];
    for (const item of defaultChecklistItems) {
      const status = defaultStatusForChecklist(item.checklist_key, handoff);
      rows.push(await insertTenantRecord(client, "project_handoff_checklist_items", tenantId, {
        project_handoff_id: handoffId,
        ...item,
        status,
        created_by: actorUserId,
        updated_by: actorUserId,
      }));
    }
    return rows;
  }

  private async handoffValuesFromBody(client: PoolClient, tenantId: string, opportunity: QueryResultRow, coveragePlan: QueryResultRow, body: Record<string, unknown>) {
    const operationsOwner = optionalText(body.operations_owner_user_id) ?? optionalText(coveragePlan.operations_owner_user_id) ?? optionalText(opportunity.owner_user_id);
    const projectManager = optionalText(body.project_manager_user_id);
    const fieldSupervisor = optionalText(body.field_supervisor_user_id);
    for (const id of [operationsOwner, projectManager, fieldSupervisor].filter(Boolean)) await this.requireTenantUser(client, tenantId, String(id));
    const customerOrganizationId = optionalText(body.customer_organization_id) ?? optionalText(opportunity.customer_organization_id) ?? optionalText(opportunity.organization_id);
    const primeOrganizationId = optionalText(body.prime_organization_id) ?? optionalText(opportunity.prime_organization_id);
    if (customerOrganizationId) await this.requireRecord(client, "organizations", tenantId, customerOrganizationId, "customer organization not found");
    if (primeOrganizationId) await this.requireRecord(client, "organizations", tenantId, primeOrganizationId, "prime organization not found");
    const territoryId = optionalText(body.territory_id) ?? optionalText(opportunity.territory_id);
    if (territoryId) await this.requireRecord(client, "territories", tenantId, territoryId, "territory not found");
    return {
      operations_owner_user_id: operationsOwner,
      project_manager_user_id: projectManager,
      field_supervisor_user_id: fieldSupervisor,
      customer_organization_id: customerOrganizationId,
      prime_organization_id: primeOrganizationId,
      territory_id: territoryId,
      work_type: optionalText(body.work_type) ?? optionalText(opportunity.work_type),
      scope_summary: optionalText(body.scope_summary) ?? optionalText(opportunity.scope_summary) ?? optionalText(opportunity.summary),
      location_summary: optionalText(body.location_summary) ?? optionalText(opportunity.location_summary),
      expected_start_date: optionalText(body.expected_start_date) ?? optionalText(opportunity.expected_start_date),
      expected_end_date: optionalText(body.expected_end_date),
      handoff_notes: optionalText(body.handoff_notes),
    };
  }

  private projectCreationMissingFields(handoff: QueryResultRow, body: Record<string, unknown>) {
    const missing = [];
    for (const field of ["customer_organization_id", "territory_id", "work_type", "scope_summary", "location_summary", "operations_owner_user_id"]) {
      if (!handoff[field]) missing.push(field);
    }
    if (!handoff.project_manager_user_id && !optionalText(body.project_manager_override_reason)) missing.push("project_manager_user_id");
    if (!handoff.expected_start_date && !optionalText(body.expected_start_override_reason)) missing.push("expected_start_date");
    return missing;
  }

  private async validateHandoffRelations(client: PoolClient, tenantId: string, values: Record<string, unknown>) {
    for (const userField of ["operations_owner_user_id", "project_manager_user_id", "field_supervisor_user_id"]) {
      if (values[userField]) await this.requireTenantUser(client, tenantId, String(values[userField]));
    }
  }

  private async childUpdate(request: AuthenticatedRequest, table: string, id: string, action: string, eventType: string, entityType: string, values: Record<string, unknown>) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      await this.requireActiveHandoff(client, request.auth.tenantId, before.project_handoff_id);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, { ...values, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private async opportunityContext(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT o.id, o.title AS opportunity_name, o.status, o.estimated_value, o.work_type, o.scope_summary, o.location_summary,
        org.id AS organization_id, org.name AS organization_name, t.id AS territory_id, t.name AS territory_name
      FROM opportunities o
      LEFT JOIN organizations org ON org.tenant_id = o.tenant_id AND org.id = COALESCE(o.customer_organization_id, o.organization_id)
      LEFT JOIN territories t ON t.tenant_id = o.tenant_id AND t.id = o.territory_id
      WHERE o.tenant_id = $1 AND o.id = $2 AND o.deleted_at IS NULL
      `,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async coverageContext(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      "SELECT id, status, coverage_readiness_score, capacity_readiness_score, compliance_readiness_score, economic_readiness_score, coverage_readiness_band, approved_for_handoff_by, approved_for_handoff_at FROM coverage_plans WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL",
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async requireActiveHandoff(client: PoolClient, tenantId: string, id: string) {
    const handoff = await this.requireHandoff(client, tenantId, id);
    if (handoff.status === "archived" || handoff.archived_at) throw new BadRequestException("archived project handoffs cannot be changed");
    return handoff;
  }

  private async requireHandoff(client: PoolClient, tenantId: string, id: string) {
    return this.requireRecord(client, "project_handoffs", tenantId, id, "project handoff not found");
  }

  private async requireRecord(client: PoolClient, tableName: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, tableName, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      "SELECT u.id FROM users u JOIN tenant_users tu ON tu.user_id = u.id WHERE tu.tenant_id = $1 AND u.id = $2 AND tu.status = 'active' AND u.status = 'active' AND tu.deleted_at IS NULL AND u.deleted_at IS NULL LIMIT 1",
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("tenant user not found");
  }

  private async actorHasPermission(client: PoolClient, tenantId: string, actorUserId: string, permissionKey: string) {
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
      [tenantId, actorUserId, permissionKey],
    );
    return Boolean(result.rows[0]);
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
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
        write: async (writeClient) => {
          const result = await write(writeClient);
          return { ...result, eventType: result.eventType ?? eventType };
        },
      });
    } finally {
      client.release();
    }
  }
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requiredText(value: unknown, message: string): string {
  const text = optionalText(value);
  if (!text) throw new BadRequestException(message);
  return text;
}

function allowedValue(value: unknown, allowed: Set<string>, field: string): string {
  const text = optionalText(value);
  if (!text || !allowed.has(text)) throw new BadRequestException(`${field} is invalid`);
  return text;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeOpportunityStatus(status: unknown): string {
  if (status === "bid_proposal") return "proposal";
  if (status === "qualified") return "draft";
  return String(status ?? "");
}

function defaultStatusForChecklist(key: string, handoff: QueryResultRow): string {
  const completeKeys = new Set(["opportunity_awarded", "coverage_plan_approved"]);
  if (completeKeys.has(key)) return "complete";
  if (key === "customer_confirmed" && handoff.customer_organization_id) return "complete";
  if (key === "territory_confirmed" && handoff.territory_id) return "complete";
  if (key === "work_type_confirmed" && handoff.work_type) return "complete";
  if (key === "scope_summary_present" && handoff.scope_summary) return "complete";
  if (key === "location_summary_present" && handoff.location_summary) return "complete";
  if (key === "operations_owner_assigned" && handoff.operations_owner_user_id) return "complete";
  if (key === "project_manager_assigned" && handoff.project_manager_user_id) return "complete";
  if (key === "field_supervisor_identified" && handoff.field_supervisor_user_id) return "complete";
  return "not_started";
}

function recommendedNextAction(status: unknown, blockers: HandoffBlocker[], warnings: HandoffWarning[], band: string): string {
  if (status === "archived") return "view_only";
  if (blockers.some((blocker) => blocker.blocker_type.includes("coverage"))) return "resolve_coverage_blockers";
  if (blockers.some((blocker) => blocker.blocker_type.includes("checklist"))) return "complete_hard_stop_checklist";
  if (blockers.some((blocker) => blocker.blocker_type.includes("risk"))) return "resolve_hard_stop_risks";
  if (blockers.length) return "resolve_blockers";
  if (warnings.length) return "resolve_or_override_warnings";
  if (status === "draft") return "submit_readiness_review";
  if (status === "readiness_review" || band === "ready_for_project") return "approve_handoff";
  if (status === "approved") return "create_project";
  if (status === "project_created") return "open_project";
  return "continue_handoff_review";
}

function projectName(handoff: QueryResultRow): string {
  return handoff.scope_summary ? String(handoff.scope_summary).slice(0, 120) : `Project from handoff ${handoff.id}`;
}
