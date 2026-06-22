import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireAllowed, requireString } from "./intelligence.types";

const projectStatuses = new Set(["created", "planning", "ready_for_work", "active", "on_hold", "completed", "closed", "archived"]);
const projectPhases = new Set(["intake", "planning", "pre_construction", "construction", "closeout", "complete"]);
const projectArchiveReasons = new Set(["duplicate", "no_longer_relevant", "replaced", "created_in_error", "customer_cancelled", "other"]);
const workOrderStatuses = new Set(["draft", "ready_to_assign", "assigned", "scheduled", "in_progress", "submitted", "qc_review", "corrections_required", "approved", "billable", "closed", "on_hold", "cancelled", "archived"]);
const legacyWorkOrderStatusMap: Record<string, string> = { created: "draft" };
const workOrderReadinessStatuses = new Set(["not_ready", "ready_to_assign", "ready_to_start", "blocked"]);
const workOrderReadinessBands = new Set(["not_ready", "needs_assignment", "ready_with_risk", "ready_to_start"]);
const workOrderQcStatuses = new Set(["not_started", "pending_review", "corrections_required", "approved", "rejected"]);
const workOrderBillableStatuses = new Set(["not_billable", "pending_approval", "billable", "billed_later", "blocked"]);
const workOrderAssignmentTypes = new Set(["unassigned", "internal_crew", "subcontractor", "partner_contractor", "vendor_equipment", "staffing_source"]);
const workOrderUnits = new Set(["feet", "miles", "drops", "addresses", "passings", "splice_cases", "nodes", "poles", "permits", "inspections", "restoration_items", "days", "crews", "workers", "equipment_units", "each"]);
const workOrderArchiveReasons = new Set(["duplicate", "no_longer_relevant", "replaced", "created_in_error", "project_cancelled", "other"]);
const productionTypes = new Set(["daily_production", "progress_update", "completion_submission", "correction_submission", "inspection_submission", "restoration_submission", "delay_report", "no_work_report", "safety_observation", "material_issue", "access_issue", "weather_delay", "customer_issue", "other"]);
const quantityProductionTypes = new Set(["daily_production", "completion_submission", "correction_submission", "restoration_submission", "inspection_submission"]);
const issueProductionTypes = new Set(["delay_report", "no_work_report", "safety_observation", "material_issue", "access_issue", "weather_delay", "customer_issue"]);
const productionRecordStatuses = new Set(["draft", "submitted", "under_review", "correction_required", "corrected", "qc_review", "accepted", "approved", "billable", "rejected", "voided", "archived"]);
const productionQcStatuses = new Set(["not_started", "pending_review", "corrections_required", "approved", "rejected"]);
const productionBillableStatuses = new Set(["not_billable", "billable_candidate", "pending_approval", "billable", "billed_later", "blocked"]);
const evidenceTypes = new Set(["photo", "video", "gps", "daily_report", "safety_form", "inspection_note", "material_ticket", "document", "form", "test_result", "gps_point", "map_markup", "customer_signature", "inspector_signature", "permit_document", "restoration_photo", "before_photo", "after_photo", "other"]);
const evidenceStatuses = new Set(["active", "archived"]);
const productionArchiveReasons = new Set(["duplicate", "no_longer_relevant", "replaced", "created_in_error", "voided", "other"]);
const correctionAuthorityRoles = new Set(["Project Manager", "Operations Manager"]);
const qcReviewAuthorityRoles = new Set(["QC Manager", "Project Manager"]);
const qcManagerRoles = new Set(["QC Manager"]);
const approveAuthorityRoles = new Set(["QC Manager", "Operations Manager"]);
const billableAuthorityRoles = new Set(["Billing Manager", "QC Manager"]);
const stopWorkIssueAuthorityRoles = new Set(["Safety Manager", "QC Manager", "Executive"]);
const stopWorkReleaseAuthorityRoles = new Set(["Safety Manager", "Executive"]);
const qcReviewTypes = new Set(["internal_qc", "safety_qc", "compliance_qc", "customer_qc", "prime_qc", "billing_qc", "final_acceptance"]);
const qcReviewStatuses = new Set(["pending", "in_review", "approved", "rejected", "correction_required", "corrected", "voided", "archived"]);
const qcFindingStatuses = new Set(["pending", "sufficient", "insufficient", "not_required"]);
const qcLocationStatuses = new Set(["pending", "valid", "invalid", "not_required"]);
const qcAcceptanceStatuses = new Set(["not_required", "pending", "accepted", "rejected", "correction_required"]);
const qcArchiveReasons = new Set(["duplicate", "no_longer_relevant", "replaced", "created_in_error", "voided", "other"]);
const billableStatuses = new Set(["candidate", "needs_rate", "needs_documentation", "needs_customer_acceptance", "held", "ready_for_settlement", "settlement_created", "disputed", "voided", "archived"]);
const billableReadinessStatuses = new Set(["not_ready", "needs_review", "ready_with_warning", "ready_for_settlement", "blocked"]);
const billableReadinessBands = new Set(["not_ready", "needs_review", "ready_with_warning", "ready_for_settlement"]);
const billableRateSources = new Set(["contract_rate", "project_rate", "customer_rate", "manual_rate", "unknown"]);
const billableRateConfidences = new Set(["unknown", "low", "medium", "high", "confirmed"]);
const billableAcceptanceStatuses = new Set(["not_required", "pending", "accepted", "rejected", "correction_required", "disputed"]);
const billablePackageStatuses = new Set(["not_started", "incomplete", "ready", "submitted_later", "accepted_later", "rejected_later"]);

@Controller()
export class ProductionController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("projects")
  @RequirePermission("project.read")
  async listProjects(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listProjectsEnriched(client, request.auth.tenantId, query));
  }

  @Get("projects/:id/detail")
  @RequirePermission("project.read")
  async getProjectDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const project = await this.projectDetail(client, request.auth.tenantId, id);
      return project;
    });
  }

  @Get("projects/:id/timeline")
  @RequirePermission("project.timeline.read")
  async getProjectTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const project = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      const result = await client.query(
        `
        SELECT e.id AS event_id, e.event_type, e.actor_user_id AS actor_id, u.display_name AS actor_name, e.created_at AS timestamp,
          e.aggregate_type AS object_type, e.aggregate_id AS object_id,
          e.event_type AS summary,
          ep.payload
        FROM events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1 AND (
          (e.aggregate_type = 'project' AND e.aggregate_id = $2)
          OR (e.aggregate_type = 'project_handoff' AND e.aggregate_id = $3 AND e.event_type = 'project_handoff.project_created')
        )
        ORDER BY e.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, project.source_project_handoff_id],
      );
      return result.rows;
    });
  }

  @Get("projects/:id/audit-summary")
  @RequirePermission("project.audit.read")
  async getProjectAuditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const project = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      const result = await client.query(
        `
        SELECT al.id AS audit_id, al.actor_user_id AS actor_id, u.display_name AS actor_name, al.action, al.entity_type AS object_type,
          al.entity_id AS object_id, al.before_state AS before_json, al.after_state AS after_json,
          al.metadata->>'reason' AS reason, al.created_at, al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1 AND (
          (al.entity_type = 'project' AND al.entity_id = $2)
          OR (al.entity_type = 'project_handoff' AND al.entity_id = $3 AND al.action = 'project_handoff.create_project')
        )
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, project.source_project_handoff_id],
      );
      return result.rows;
    });
  }

  @Get("projects/:id")
  @RequirePermission("project.read")
  async getProject(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.projectRow(client, request.auth.tenantId, id));
  }

  @Post("projects")
  @RequirePermission("project.create")
  async createProject(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = this.requiredText(body.project_name ?? body.name, "project name is required");
      return await this.write(request, "project.create", "project.created", "project", async (client) => {
        const opportunityId = this.requiredId(body.source_opportunity_id ?? body.opportunity_id, "source_opportunity_id");
        const opportunity = await this.requireRecord(client, "opportunities", request.auth.tenantId, opportunityId, "opportunity not found");
        if (opportunity.status !== "awarded") throw new BadRequestException("opportunity must be awarded");
        const customerId = this.requiredId(body.customer_organization_id ?? opportunity.customer_organization_id ?? opportunity.organization_id, "customer_organization_id");
        await this.requireRecord(client, "organizations", request.auth.tenantId, customerId, "customer organization not found");
        const territoryId = this.requiredId(body.territory_id ?? opportunity.territory_id, "territory_id");
        await this.requireRecord(client, "territories", request.auth.tenantId, territoryId, "territory not found");
        if (body.operations_owner_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.operations_owner_user_id);
        if (body.project_manager_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.project_manager_user_id);
        if (body.field_supervisor_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.field_supervisor_user_id);
        const workType = this.requiredText(body.work_type ?? opportunity.work_type, "work_type is required");
        const project = await insertTenantRecord(client, "projects", request.auth.tenantId, {
          opportunity_id: opportunityId,
          source_opportunity_id: opportunityId,
          customer_organization_id: customerId,
          territory_id: territoryId,
          work_type: workType,
          name,
          status: "planning",
          project_phase: "intake",
          scope_summary: body.scope_summary,
          location_summary: body.location_summary,
          planned_start_date: body.planned_start_date,
          planned_end_date: body.planned_end_date,
          operations_owner_user_id: body.operations_owner_user_id ?? request.auth.userId,
          project_manager_user_id: body.project_manager_user_id,
          field_supervisor_user_id: body.field_supervisor_user_id,
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        const readiness = await this.calculateProjectReadiness(client, request.auth.tenantId, project.id, project);
        await this.persistProjectReadiness(client, request.auth.tenantId, project.id, readiness, request.auth.userId);
        const detail = await this.projectDetail(client, request.auth.tenantId, project.id);
        return { entityType: "project", entityId: project.id, afterState: { id: project.id, ...detail }, eventType: "project.created" };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("projects/:id")
  @RequirePermission("project.update")
  async updateProject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined) requireAllowed(body.status, projectStatuses, "project status");
      if (body.project_phase !== undefined) requireAllowed(body.project_phase, projectPhases, "project_phase");
      const values = pick(body, [
        "name",
        "project_phase",
        "prime_organization_id",
        "contractor_organization_id",
        "territory_id",
        "work_type",
        "scope_summary",
        "location_summary",
        "planned_start_date",
        "planned_end_date",
        "operations_owner_user_id",
        "project_manager_user_id",
        "field_supervisor_user_id",
        "billing_package_requirements",
        "documentation_requirements",
        "customer_validation_requirements",
        "risk_notes",
      ]);
      if (body.project_name !== undefined) values.name = body.project_name;
      return await this.write(request, "project.update", "project.updated", "project", async (client) => {
        const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
        if (before.status === "archived") throw new BadRequestException("archived projects are view-only");
        if (body.opportunity_id) {
          await this.requireRecord(client, "opportunities", request.auth.tenantId, this.requiredId(body.opportunity_id, "opportunity_id"), "opportunity not found");
          values.opportunity_id = body.opportunity_id;
        }
        if (body.source_opportunity_id) {
          await this.requireRecord(client, "opportunities", request.auth.tenantId, this.requiredId(body.source_opportunity_id, "source_opportunity_id"), "opportunity not found");
          values.source_opportunity_id = body.source_opportunity_id;
        }
        if (body.customer_organization_id) {
          await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.customer_organization_id, "customer_organization_id"), "customer organization not found");
          values.customer_organization_id = body.customer_organization_id;
        }
        if (body.prime_organization_id) await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.prime_organization_id, "prime_organization_id"), "prime organization not found");
        if (body.contractor_organization_id) await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.contractor_organization_id, "contractor_organization_id"), "contractor organization not found");
        if (body.territory_id) await this.requireRecord(client, "territories", request.auth.tenantId, this.requiredId(body.territory_id, "territory_id"), "territory not found");
        if (body.operations_owner_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.operations_owner_user_id);
        if (body.project_manager_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.project_manager_user_id);
        if (body.field_supervisor_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.field_supervisor_user_id);
        values.updated_by = request.auth.userId;
        const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("project not found");
        const readiness = await this.calculateProjectReadiness(client, request.auth.tenantId, id, after);
        await this.persistProjectReadiness(client, request.auth.tenantId, id, readiness, request.auth.userId);
        return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.updated" };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("projects/:id/recalculate-readiness")
  @RequirePermission("project.recalculate_readiness")
  async recalculateProjectReadiness(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "project.recalculate_readiness", "project.readiness_recalculated", "project", async (client) => {
      const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      const readiness = await this.calculateProjectReadiness(client, request.auth.tenantId, id, before);
      await this.persistProjectReadiness(client, request.auth.tenantId, id, readiness, request.auth.userId);
      return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.readiness_recalculated" };
    });
  }

  @Post("projects/:id/mark-ready-for-work")
  @RequirePermission("project.mark_ready")
  async markProjectReady(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "project.mark_ready", "project.ready_for_work", "project", async (client) => {
      const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      const readiness = await this.calculateProjectReadiness(client, request.auth.tenantId, id, before);
      this.assertNoProjectBlockers(readiness);
      this.assertProjectOverrides(readiness, body.override_reasons);
      const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, {
        status: "ready_for_work",
        project_phase: "pre_construction",
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("project not found");
      await this.persistProjectReadiness(client, request.auth.tenantId, id, await this.calculateProjectReadiness(client, request.auth.tenantId, id, after), request.auth.userId);
      return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.ready_for_work" };
    }, body.reason);
  }

  @Post("projects/:id/start")
  @RequirePermission("project.start")
  async startProject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "project.start", "project.started", "project", async (client) => {
      const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      if (before.status !== "ready_for_work") throw new BadRequestException("project must be ready_for_work");
      const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, {
        status: "active",
        project_phase: "construction",
        actual_start_date: before.actual_start_date ?? body.actual_start_date ?? new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("project not found");
      return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.started" };
    });
  }

  @Post("projects/:id/place-on-hold")
  @RequirePermission("project.place_hold")
  async placeProjectOnHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const holdReason = this.requiredText(body.hold_reason, "hold_reason is required");
    return this.write(request, "project.place_hold", "project.on_hold", "project", async (client) => {
      const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      if (before.status === "archived") throw new BadRequestException("archived projects are view-only");
      const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, {
        status: "on_hold",
        previous_status: before.status === "on_hold" ? before.previous_status : before.status,
        hold_reason: holdReason,
        hold_note: body.hold_note,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("project not found");
      return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.on_hold" };
    }, holdReason);
  }

  @Post("projects/:id/release-hold")
  @RequirePermission("project.release_hold")
  async releaseProjectHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const releaseNote = this.requiredText(body.release_note, "release_note is required");
    return this.write(request, "project.release_hold", "project.hold_released", "project", async (client) => {
      const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      if (before.status !== "on_hold") throw new BadRequestException("project must be on_hold");
      const restoredStatus = before.previous_status && projectStatuses.has(before.previous_status) && before.previous_status !== "archived" ? before.previous_status : "planning";
      const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, {
        status: restoredStatus,
        previous_status: null,
        hold_released_at: new Date(),
        hold_release_note: releaseNote,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("project not found");
      return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.hold_released" };
    }, releaseNote);
  }

  @Post("projects/:id/complete")
  @RequirePermission("project.complete")
  async completeProject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const completionNote = this.requiredText(body.completion_note, "completion_note is required");
    return this.write(request, "project.complete", "project.completed", "project", async (client) => {
      const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      if (!["active", "ready_for_work"].includes(before.status)) throw new BadRequestException("project must be active or ready_for_work");
      const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, {
        status: "completed",
        project_phase: "closeout",
        actual_end_date: before.actual_end_date ?? body.actual_end_date ?? new Date(),
        closeout_notes: completionNote,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("project not found");
      return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.completed" };
    }, completionNote);
  }

  @Post("projects/:id/close")
  @RequirePermission("project.close")
  async closeProject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const closeoutNotes = this.requiredText(body.closeout_notes, "closeout_notes is required");
    return this.write(request, "project.close", "project.closed", "project", async (client) => {
      const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
      if (before.status !== "completed" && !body.override_reason) throw new BadRequestException("project must be completed before close unless override_reason is supplied");
      const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, {
        status: "closed",
        project_phase: "complete",
        closeout_notes: closeoutNotes,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("project not found");
      return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.closed" };
    }, closeoutNotes);
  }

  @Post("projects/:id/archive")
  @RequirePermission("project.archive")
  async archiveProject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const archiveReason = requireAllowed(body.archive_reason, projectArchiveReasons, "archive_reason");
      return await this.write(request, "project.archive", "project.archived", "project", async (client) => {
        const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
        const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, {
          status: "archived",
          archived_at: new Date(),
          archived_by: request.auth.userId,
          archive_reason: archiveReason,
          archive_note: body.archive_note,
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("project not found");
        return { entityType: "project", entityId: id, beforeState: before, afterState: await this.projectDetail(client, request.auth.tenantId, id), eventType: "project.archived" };
      }, archiveReason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get("work-orders")
  @RequirePermission("work_order.read")
  async listWorkOrders(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listWorkOrdersEnriched(client, request.auth.tenantId, query));
  }

  @Get("work-orders/:id/detail")
  @RequirePermission("work_order.read")
  async getWorkOrderDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.workOrderDetail(client, request.auth.tenantId, id));
  }

  @Get("work-orders/:id/timeline")
  @RequirePermission("work_order.timeline.read")
  async getWorkOrderTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      const result = await client.query(
        `
        SELECT e.id AS event_id, e.event_type, e.actor_user_id AS actor_id, u.display_name AS actor_name, e.created_at AS timestamp,
          e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1 AND e.aggregate_type = 'work_order' AND e.aggregate_id = $2
        ORDER BY e.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("work-orders/:id/audit-summary")
  @RequirePermission("work_order.audit.read")
  async getWorkOrderAuditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      const result = await client.query(
        `
        SELECT al.id AS audit_id, al.actor_user_id AS actor_id, u.display_name AS actor_name, al.action, al.entity_type AS object_type,
          al.entity_id AS object_id, al.before_state AS before_json, al.after_state AS after_json,
          al.metadata->>'reason' AS reason, al.created_at, al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1 AND al.entity_type = 'work_order' AND al.entity_id = $2
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("work-orders/:id")
  @RequirePermission("work_order.read")
  async getWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.workOrderRow(client, request.auth.tenantId, id));
  }

  @Post("work-orders")
  @RequirePermission("work_order.create")
  async createWorkOrder(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.work_order_name ?? body.title, "work order name is required");
      const workType = requireString(body.work_type, "work_type is required");
      const scopeSummary = requireString(body.scope_summary ?? body.title ?? body.work_order_name, "scope_summary is required");
      const locationSummary = requireString(body.location_summary ?? body.location_description, "location_summary is required");
      const plannedQuantity = this.requireNonNegative(body.planned_quantity ?? body.expected_units, "planned_quantity");
      const unit = requireAllowed(body.unit ?? body.unit_type, workOrderUnits, "unit");
      const requestedStatus = body.status === undefined ? "draft" : this.normalizeWorkOrderStatus(String(body.status));
      if (requestedStatus !== "draft") throw new BadRequestException("new work orders must start as draft");
      return await this.write(request, "work_order.create", "work_order.created", "work_order", async (client) => {
        const project = await this.requireRecord(client, "projects", request.auth.tenantId, this.requiredId(body.project_id, "project_id"), "project not found");
        if (project.status === "archived") throw new BadRequestException("project is archived");
        if (!["planning", "ready_for_work", "active"].includes(project.status)) throw new BadRequestException("project must be planning, ready_for_work, or active");
        await this.validateWorkOrderReferences(client, request.auth.tenantId, project, body);
        const workOrder = await insertTenantRecord(client, "work_orders", request.auth.tenantId, {
          project_id: body.project_id,
          coverage_plan_id: body.coverage_plan_id,
          coverage_requirement_id: body.coverage_requirement_id,
          coverage_source_id: body.coverage_source_id,
          assigned_capacity_provider_id: body.assigned_capacity_provider_id,
          assigned_crew_id: body.assigned_crew_id,
          title,
          work_order_name: title,
          work_order_number: body.work_order_number,
          customer_work_order_number: body.customer_work_order_number,
          prime_work_order_number: body.prime_work_order_number,
          internal_work_order_number: body.internal_work_order_number,
          scope_summary: scopeSummary,
          location_summary: locationSummary,
          location_description: locationSummary,
          route_name: body.route_name,
          node_id: body.node_id,
          segment_id: body.segment_id,
          address_range: body.address_range,
          permit_reference: body.permit_reference,
          map_link: body.map_link,
          work_type: workType,
          territory_id: body.territory_id ?? project.territory_id,
          gps_lat: body.gps_lat,
          gps_lng: body.gps_lng,
          expected_units: plannedQuantity,
          unit_type: unit,
          planned_quantity: plannedQuantity,
          unit,
          planned_start_date: body.planned_start_date,
          planned_end_date: body.planned_end_date,
          assignment_type: body.assignment_type ? requireAllowed(body.assignment_type, workOrderAssignmentTypes, "assignment_type") : "unassigned",
          assigned_organization_id: body.assigned_organization_id,
          assigned_equipment_id: body.assigned_equipment_id,
          owner_user_id: body.owner_user_id,
          field_supervisor_user_id: body.field_supervisor_user_id,
          qc_owner_user_id: body.qc_owner_user_id,
          documentation_requirements: body.documentation_requirements,
          production_requirements: body.production_requirements,
          customer_validation_requirements: body.customer_validation_requirements,
          billing_package_requirements: body.billing_package_requirements,
          risk_notes: body.risk_notes,
          status: "draft",
          readiness_status: "not_ready",
          readiness_band: "not_ready",
          qc_status: "not_started",
          billable_status: "not_billable",
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        const readiness = await this.calculateWorkOrderReadiness(client, request.auth.tenantId, workOrder.id, workOrder);
        await this.persistWorkOrderReadiness(client, request.auth.tenantId, workOrder.id, readiness, request.auth.userId);
        return { entityType: "work_order", entityId: workOrder.id, afterState: await this.workOrderDetail(client, request.auth.tenantId, workOrder.id) };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("work-orders/:id")
  @RequirePermission("work_order.update")
  async updateWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
      const values = pick(body, ["work_order_number", "customer_work_order_number", "prime_work_order_number", "internal_work_order_number", "work_type", "scope_summary", "location_summary", "route_name", "node_id", "segment_id", "address_range", "permit_reference", "map_link", "territory_id", "planned_start_date", "planned_end_date", "scheduled_start_date", "scheduled_end_date", "owner_user_id", "field_supervisor_user_id", "qc_owner_user_id", "documentation_requirements", "production_requirements", "customer_validation_requirements", "billing_package_requirements", "risk_notes"]);
      if (body.work_order_name !== undefined || body.title !== undefined) {
        values.work_order_name = requireString(body.work_order_name ?? body.title, "work order name is required");
        values.title = values.work_order_name;
      }
      if (body.location_description !== undefined) values.location_summary = body.location_description;
      if (body.location_summary !== undefined) values.location_description = body.location_summary;
      if (body.planned_quantity !== undefined || body.expected_units !== undefined) {
        values.planned_quantity = this.requireNonNegative(body.planned_quantity ?? body.expected_units, "planned_quantity");
        values.expected_units = values.planned_quantity;
      }
      if (body.completed_quantity !== undefined) values.completed_quantity = this.requireNonNegative(body.completed_quantity, "completed_quantity");
      if (body.approved_quantity !== undefined) values.approved_quantity = this.requireNonNegative(body.approved_quantity, "approved_quantity");
      if (body.billable_quantity !== undefined) values.billable_quantity = this.requireNonNegative(body.billable_quantity, "billable_quantity");
      if (body.unit !== undefined || body.unit_type !== undefined) {
        values.unit = requireAllowed(body.unit ?? body.unit_type, workOrderUnits, "unit");
        values.unit_type = values.unit;
      }
      return await this.write(request, "work_order.update", "work_order.updated", "work_order", async (client) => {
        const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
        if (["archived", "cancelled", "closed"].includes(before.status)) throw new BadRequestException("closed, cancelled, and archived work orders are view-only");
        if (body.project_id) values.project_id = this.requiredId(body.project_id, "project_id");
        const project = await this.requireRecord(client, "projects", request.auth.tenantId, String(values.project_id ?? before.project_id), "project not found");
        await this.validateWorkOrderReferences(client, request.auth.tenantId, project, body, before);
        for (const key of ["coverage_plan_id", "coverage_requirement_id", "coverage_source_id", "assigned_organization_id", "assigned_capacity_provider_id", "assigned_crew_id", "assigned_equipment_id", "assignment_type"] as const) {
          if (body[key] !== undefined) values[key] = body[key];
        }
        if (values.assignment_type !== undefined) requireAllowed(values.assignment_type, workOrderAssignmentTypes, "assignment_type");
        values.updated_by = request.auth.userId;
        const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("work order not found");
        const readiness = await this.calculateWorkOrderReadiness(client, request.auth.tenantId, id, after);
        await this.persistWorkOrderReadiness(client, request.auth.tenantId, id, readiness, request.auth.userId);
        return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("work-orders/:id/recalculate-readiness")
  @RequirePermission("work_order.recalculate_readiness")
  async recalculateWorkOrderReadiness(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "work_order.recalculate_readiness", "work_order.readiness_recalculated", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      const readiness = await this.calculateWorkOrderReadiness(client, request.auth.tenantId, id, before);
      await this.persistWorkOrderReadiness(client, request.auth.tenantId, id, readiness, request.auth.userId);
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("work-orders/:id/mark-ready-to-assign")
  @RequirePermission("work_order.mark_ready")
  async markWorkOrderReady(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "work_order.mark_ready", "work_order.ready_to_assign", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      const readiness = await this.calculateWorkOrderReadiness(client, request.auth.tenantId, id, before);
      this.assertNoWorkOrderBlockers(readiness);
      this.assertWorkOrderOverrides(readiness, body.override_reasons);
      if (readiness.readiness_score < 70) throw new BadRequestException("work order readiness is not sufficient to mark ready_to_assign");
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, { status: "ready_to_assign", updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("work order not found");
      await this.persistWorkOrderReadiness(client, request.auth.tenantId, id, await this.calculateWorkOrderReadiness(client, request.auth.tenantId, id, after), request.auth.userId);
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    }, body.reason);
  }

  @Post("work-orders/:id/assign")
  @RequirePermission("work_order.assign")
  async assignWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "work_order.assign", "work_order.assigned", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      await this.requireProjectReadyForWorkOrder(client, request.auth.tenantId, before.project_id);
      this.requireWorkOrderOpen(before);
      const assignmentType = requireAllowed(body.assignment_type ?? before.assignment_type ?? "unassigned", workOrderAssignmentTypes, "assignment_type");
      const providerId = body.assigned_capacity_provider_id ?? before.assigned_capacity_provider_id ?? null;
      const crewId = body.assigned_crew_id ?? before.assigned_crew_id ?? null;
      const organizationId = body.assigned_organization_id ?? before.assigned_organization_id ?? null;
      const equipmentId = body.assigned_equipment_id ?? before.assigned_equipment_id ?? null;
      if (assignmentType !== "unassigned" && !providerId && !crewId && !organizationId && !equipmentId) throw new BadRequestException("assignment target is required");
      if (providerId) {
        const provider = await this.requireProvider(client, request.auth.tenantId, providerId);
        if (["archived", "suspended"].includes(String(provider.status))) throw new BadRequestException("assigned provider is archived or suspended");
        if (provider.status !== "activated" && !this.hasOverride(body.override_reasons, "assignment_override_reason")) {
          throw new BadRequestException({ message: "Work order assignment requires override reasons for warnings.", required_override_fields: ["assignment_override_reason"] });
        }
      }
      if (crewId) await this.requireCrew(client, request.auth.tenantId, crewId, providerId);
      if (organizationId) await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(organizationId, "assigned_organization_id"), "assigned organization not found");
      if (equipmentId) await this.requireRecord(client, "equipment", request.auth.tenantId, this.requiredId(equipmentId, "assigned_equipment_id"), "assigned equipment not found");
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, {
        assignment_type: assignmentType,
        assigned_organization_id: organizationId,
        assigned_capacity_provider_id: providerId,
        assigned_crew_id: crewId,
        assigned_equipment_id: equipmentId,
        assigned_by: request.auth.userId,
        assigned_at: new Date(),
        assignment_note: body.assignment_note,
        status: "assigned",
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("work order not found");
      await this.persistWorkOrderReadiness(client, request.auth.tenantId, id, await this.calculateWorkOrderReadiness(client, request.auth.tenantId, id, after), request.auth.userId);
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("work-orders/:id/schedule")
  @RequirePermission("work_order.schedule")
  async scheduleWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    if (!body.scheduled_start_date && !body.schedule_note) throw new BadRequestException("scheduled_start_date or schedule_note is required");
    return this.workOrderStatusAction(request, id, "work_order.schedule", "work_order.scheduled", ["ready_to_assign", "assigned"], { status: "scheduled", scheduled_start_date: body.scheduled_start_date, scheduled_end_date: body.scheduled_end_date, updated_by: request.auth.userId });
  }

  @Post("work-orders/:id/start")
  @RequirePermission("work_order.start")
  async startWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "work_order.start", "work_order.started", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      await this.requireProjectReadyForWorkOrder(client, request.auth.tenantId, before.project_id);
      if (!["assigned", "scheduled"].includes(before.status)) throw new BadRequestException("work order must be assigned or scheduled");
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, { status: "in_progress", actual_start_date: before.actual_start_date ?? new Date(), updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("work order not found");
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("work-orders/:id/submit")
  @RequirePermission("work_order.submit")
  async submitWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.workOrderStatusAction(request, id, "work_order.submit", "work_order.submitted", ["in_progress"], { status: "submitted", updated_by: request.auth.userId });
  }

  @Post("work-orders/:id/start-qc-review")
  @RequirePermission("work_order.qc_review")
  async startWorkOrderQcReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.workOrderStatusAction(request, id, "work_order.qc_review", "work_order.qc_review_started", ["submitted"], { status: "qc_review", qc_status: "pending_review", updated_by: request.auth.userId });
  }

  @Post("work-orders/:id/request-corrections")
  @RequirePermission("work_order.corrections")
  async requestWorkOrderCorrections(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requiredText(body.correction_reason ?? body.reason, "correction_reason is required");
    return this.workOrderStatusAction(request, id, "work_order.corrections", "work_order.corrections_required", ["submitted", "qc_review"], { status: "corrections_required", qc_status: "corrections_required", correction_reason: reason, updated_by: request.auth.userId }, reason);
  }

  @Post("work-orders/:id/approve")
  @RequirePermission("work_order.approve")
  async approveWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const note = this.requiredText(body.approval_note, "approval_note is required");
    return this.workOrderStatusAction(request, id, "work_order.approve", "work_order.approved", ["submitted", "qc_review", "corrections_required"], { status: "approved", qc_status: "approved", approval_note: note, approved_quantity: body.approved_quantity === undefined ? undefined : this.requireNonNegative(body.approved_quantity, "approved_quantity"), updated_by: request.auth.userId }, note);
  }

  @Post("work-orders/:id/mark-billable")
  @RequirePermission("work_order.mark_billable")
  async markWorkOrderBillable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "work_order.mark_billable", "work_order.marked_billable", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      if (before.status !== "approved" && !body.override_reason) throw new BadRequestException("work order must be approved before marking billable unless override_reason is supplied");
      if (Number(before.approved_quantity ?? 0) <= 0 && !body.override_reason) throw new BadRequestException("approved_quantity must be > 0 unless override_reason is supplied");
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, { status: "billable", billable_status: "billable", billable_note: body.billable_note, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("work order not found");
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    }, body.override_reason ?? body.billable_note);
  }

  @Post("work-orders/:id/place-on-hold")
  @RequirePermission("work_order.place_hold")
  async placeWorkOrderOnHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const holdReason = this.requiredText(body.hold_reason, "hold_reason is required");
    return this.write(request, "work_order.place_hold", "work_order.on_hold", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      this.requireWorkOrderOpen(before);
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, { status: "on_hold", previous_status: before.status === "on_hold" ? before.previous_status : before.status, hold_reason: holdReason, hold_note: body.hold_note, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("work order not found");
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    }, holdReason);
  }

  @Post("work-orders/:id/release-hold")
  @RequirePermission("work_order.release_hold")
  async releaseWorkOrderHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const releaseNote = this.requiredText(body.release_note, "release_note is required");
    return this.write(request, "work_order.release_hold", "work_order.hold_released", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      if (before.status !== "on_hold") throw new BadRequestException("work order must be on_hold");
      const restored = before.previous_status && workOrderStatuses.has(before.previous_status) && !["archived", "cancelled", "closed", "on_hold"].includes(before.previous_status) ? before.previous_status : before.assigned_capacity_provider_id || before.assigned_crew_id ? "assigned" : "ready_to_assign";
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, { status: restored, previous_status: null, hold_release_note: releaseNote, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("work order not found");
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    }, releaseNote);
  }

  @Post("work-orders/:id/cancel")
  @RequirePermission("work_order.cancel")
  async cancelWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requiredText(body.cancellation_reason ?? body.reason, "cancellation_reason is required");
    return this.workOrderStatusAction(request, id, "work_order.cancel", "work_order.cancelled", ["draft", "ready_to_assign", "assigned", "scheduled", "on_hold"], { status: "cancelled", cancellation_reason: reason, cancellation_note: body.cancellation_note, updated_by: request.auth.userId }, reason);
  }

  @Post("work-orders/:id/close")
  @RequirePermission("work_order.close")
  async closeWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const closeoutNotes = this.requiredText(body.closeout_notes, "closeout_notes is required");
    return this.workOrderStatusAction(request, id, "work_order.close", "work_order.closed", ["billable", "approved"], { status: "closed", closeout_notes: closeoutNotes, actual_end_date: body.actual_end_date ?? new Date(), updated_by: request.auth.userId }, closeoutNotes);
  }

  @Post("work-orders/:id/archive")
  @RequirePermission("work_order.archive")
  async archiveWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const archiveReason = requireAllowed(body.archive_reason, workOrderArchiveReasons, "archive_reason");
      return await this.write(request, "work_order.archive", "work_order.archived", "work_order", async (client) => {
        const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
        const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, { status: "archived", archived_at: new Date(), archived_by: request.auth.userId, archive_reason: archiveReason, archive_note: body.archive_note, deleted_at: new Date(), updated_by: request.auth.userId });
        if (!after) throw new NotFoundException("work order not found");
        return { entityType: "work_order", entityId: id, beforeState: before, afterState: after };
      }, archiveReason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get("qc/review-queue")
  @RequirePermission("qc.review")
  async listQcReviewQueue(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT *
        FROM production_records
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND status IN ('submitted', 'qc_review')
        ORDER BY updated_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId],
      );
      return result.rows;
    });
  }

  @Get("qc/review-queue/:id")
  @RequirePermission("qc.review")
  async getQcReviewQueueItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found"));
  }

  @Get("qc-reviews")
  @RequirePermission("qc_review.read")
  async listQcReviews(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listQcReviewsEnriched(client, request.auth.tenantId, query));
  }

  @Get("qc-reviews/:id/detail")
  @RequirePermission("qc_review.read")
  async getQcReviewDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.qcReviewDetail(client, request.auth.tenantId, id));
  }

  @Get("qc-reviews/:id/timeline")
  @RequirePermission("qc_review.timeline.read")
  async getQcReviewTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
      const result = await client.query(
        `
        SELECT e.id AS event_id, e.event_type, e.actor_user_id AS actor_id, u.display_name AS actor_name, e.created_at AS timestamp,
          e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND e.aggregate_type = 'qc_review'
          AND e.aggregate_id = $2
        ORDER BY e.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("qc-reviews/:id/audit-summary")
  @RequirePermission("qc_review.audit.read")
  async getQcReviewAuditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
      const result = await client.query(
        `
        SELECT al.id AS audit_id, al.actor_user_id AS actor_id, u.display_name AS actor_name, al.action,
          al.entity_type AS object_type, al.entity_id AS object_id, al.before_state AS before_json,
          al.after_state AS after_json, al.metadata->>'reason' AS reason, al.created_at, al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1
          AND al.entity_type = 'qc_review'
          AND al.entity_id = $2
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("qc-reviews/:id")
  @RequirePermission("qc_review.read")
  async getQcReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.qcReviewRow(client, request.auth.tenantId, id));
  }

  @Post("qc-reviews")
  @RequirePermission("qc_review.create")
  async createQcReview(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const reviewType = requireAllowed(body.review_type ?? "internal_qc", qcReviewTypes, "review_type");
      return await this.write(request, "qc_review.create", "qc_review.created", "qc_review", async (client) => {
        const productionRecord = await this.requireRecord(client, "production_records", request.auth.tenantId, this.requiredId(body.production_record_id, "production_record_id"), "production record not found");
        const workOrder = await this.requireRecord(client, "work_orders", request.auth.tenantId, String(productionRecord.work_order_id), "work order not found");
        const project = await this.requireRecord(client, "projects", request.auth.tenantId, String(productionRecord.project_id), "project not found");
        if (body.reviewer_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.reviewer_user_id);
        if (body.correction_owner_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.correction_owner_user_id);
        if (body.source_qc_review_id) await this.requireRecord(client, "qc_reviews", request.auth.tenantId, this.requiredId(body.source_qc_review_id, "source_qc_review_id"), "source qc review not found");
        const review = await insertTenantRecord(client, "qc_reviews", request.auth.tenantId, {
          production_record_id: productionRecord.id,
          work_order_id: workOrder.id,
          project_id: project.id,
          review_type: reviewType,
          review_status: "pending",
          reviewer_user_id: body.reviewer_user_id ?? request.auth.userId,
          claimed_quantity: Number(productionRecord.claimed_quantity ?? productionRecord.quantity_submitted ?? productionRecord.quantity ?? 0),
          unit: productionRecord.unit ?? productionRecord.unit_type ?? workOrder.unit,
          evidence_status: this.optionalAllowed(body.evidence_status, qcFindingStatuses, "evidence_status") ?? "pending",
          location_status: this.optionalAllowed(body.location_status, qcLocationStatuses, "location_status") ?? "pending",
          documentation_status: this.optionalAllowed(body.documentation_status, qcFindingStatuses, "documentation_status") ?? "pending",
          production_status: this.optionalAllowed(body.production_status, qcLocationStatuses, "production_status") ?? "pending",
          customer_acceptance_status: this.optionalAllowed(body.customer_acceptance_status, qcAcceptanceStatuses, "customer_acceptance_status") ?? "not_required",
          prime_acceptance_status: this.optionalAllowed(body.prime_acceptance_status, qcAcceptanceStatuses, "prime_acceptance_status") ?? "not_required",
          review_notes: body.review_notes,
          hard_stop: Boolean(body.hard_stop),
          override_reasons: this.jsonObject(body.override_reasons),
          source_qc_review_id: body.source_qc_review_id,
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        return { entityType: "qc_review", entityId: review.id, afterState: await this.qcReviewDetail(client, request.auth.tenantId, review.id) };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("qc-reviews/:id/start-review")
  @RequirePermission("qc_review.start")
  async startQcReviewRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "qc_review.start", "qc_review.started", "qc_review", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
      const before = await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
      if (before.review_status !== "pending" && before.review_status !== "corrected") throw new BadRequestException("qc review must be pending or corrected");
      const after = await updateTenantRecord(client, "qc_reviews", request.auth.tenantId, id, {
        review_status: "in_review",
        reviewer_user_id: request.auth.userId,
        reviewed_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("qc review not found");
      return { entityType: "qc_review", entityId: id, beforeState: before, afterState: await this.qcReviewDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("qc-reviews/:id/approve")
  @RequirePermission("qc_review.approve")
  async approveQcReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const approvalNote = this.requiredText(body.approval_note ?? body.review_notes, "approval_note is required");
      const approvedQuantity = this.requireNonNegative(body.approved_quantity, "approved_quantity");
      return await this.write(request, "qc_review.approve", "qc_review.approved", "qc_review", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, approveAuthorityRoles, "QC Manager or Operations Manager authority is required");
        const before = await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
        if (before.hard_stop) throw new BadRequestException("hard stop qc reviews cannot be approved");
        const productionRecord = await this.requireRecord(client, "production_records", request.auth.tenantId, String(before.production_record_id), "production record not found");
        await this.assertNoSelfApproval(client, request.auth.tenantId, request.auth.userId, productionRecord, body.override_reasons);
        const claimedQuantity = Number(before.claimed_quantity ?? productionRecord.claimed_quantity ?? productionRecord.quantity_submitted ?? productionRecord.quantity ?? 0);
        if (approvedQuantity > claimedQuantity && !this.hasOverride(body.override_reasons, "admin_override_reason")) throw new BadRequestException({ message: "approved_quantity cannot exceed claimed_quantity", required_override_fields: ["admin_override_reason"] });
        const rejectedQuantity = body.rejected_quantity === undefined ? Math.max(0, claimedQuantity - approvedQuantity) : this.requireNonNegative(body.rejected_quantity, "rejected_quantity");
        const correctionRequiredQuantity = body.correction_required_quantity === undefined ? undefined : this.requireNonNegative(body.correction_required_quantity, "correction_required_quantity");
        if (correctionRequiredQuantity !== undefined && correctionRequiredQuantity > rejectedQuantity) throw new BadRequestException("correction_required_quantity cannot exceed rejected_quantity");
        const billableCandidateQuantity = body.billable_candidate_quantity === undefined ? approvedQuantity : this.requireNonNegative(body.billable_candidate_quantity, "billable_candidate_quantity");
        if (billableCandidateQuantity > approvedQuantity && !this.hasOverride(body.override_reasons, "override_reason")) throw new BadRequestException({ message: "billable_candidate_quantity cannot exceed approved_quantity", required_override_fields: ["override_reason"] });
        const after = await updateTenantRecord(client, "qc_reviews", request.auth.tenantId, id, {
          review_status: "approved",
          reviewer_user_id: request.auth.userId,
          reviewed_at: new Date(),
          approved_quantity: approvedQuantity,
          rejected_quantity: rejectedQuantity,
          correction_required_quantity: correctionRequiredQuantity,
          billable_candidate_quantity: billableCandidateQuantity,
          evidence_status: this.optionalAllowed(body.evidence_status, qcFindingStatuses, "evidence_status") ?? before.evidence_status,
          location_status: this.optionalAllowed(body.location_status, qcLocationStatuses, "location_status") ?? before.location_status,
          documentation_status: this.optionalAllowed(body.documentation_status, qcFindingStatuses, "documentation_status") ?? before.documentation_status,
          production_status: this.optionalAllowed(body.production_status, qcLocationStatuses, "production_status") ?? before.production_status,
          customer_acceptance_status: this.optionalAllowed(body.customer_acceptance_status, qcAcceptanceStatuses, "customer_acceptance_status") ?? before.customer_acceptance_status,
          prime_acceptance_status: this.optionalAllowed(body.prime_acceptance_status, qcAcceptanceStatuses, "prime_acceptance_status") ?? before.prime_acceptance_status,
          review_notes: approvalNote,
          override_reasons: this.jsonObject(body.override_reasons ?? before.override_reasons),
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("qc review not found");
        await this.syncProductionFromApprovedQcReview(client, request.auth.tenantId, after, productionRecord, request.auth.userId);
        return { entityType: "qc_review", entityId: id, beforeState: before, afterState: await this.qcReviewDetail(client, request.auth.tenantId, id) };
      }, approvalNote);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("qc-reviews/:id/reject")
  @RequirePermission("qc_review.reject")
  async rejectQcReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.rejection_reason ?? body.reason, "rejection_reason is required");
      return await this.write(request, "qc_review.reject", "qc_review.rejected", "qc_review", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
        const before = await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
        const productionRecord = await this.requireRecord(client, "production_records", request.auth.tenantId, String(before.production_record_id), "production record not found");
        const claimedQuantity = Number(before.claimed_quantity ?? productionRecord.claimed_quantity ?? productionRecord.quantity_submitted ?? productionRecord.quantity ?? 0);
        const rejectedQuantity = body.rejected_quantity === undefined ? claimedQuantity : this.requireNonNegative(body.rejected_quantity, "rejected_quantity");
        if (rejectedQuantity > claimedQuantity && !this.hasOverride(body.override_reasons, "admin_override_reason")) throw new BadRequestException({ message: "rejected_quantity cannot exceed claimed_quantity", required_override_fields: ["admin_override_reason"] });
        const after = await updateTenantRecord(client, "qc_reviews", request.auth.tenantId, id, {
          review_status: "rejected",
          reviewer_user_id: request.auth.userId,
          reviewed_at: new Date(),
          approved_quantity: 0,
          rejected_quantity: rejectedQuantity,
          rejection_reason: reason,
          rejection_note: body.rejection_note,
          override_reasons: this.jsonObject(body.override_reasons ?? before.override_reasons),
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("qc review not found");
        await this.syncProductionFromRejectedQcReview(client, request.auth.tenantId, after, productionRecord, request.auth.userId);
        return { entityType: "qc_review", entityId: id, beforeState: before, afterState: await this.qcReviewDetail(client, request.auth.tenantId, id) };
      }, reason);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("qc-reviews/:id/request-correction")
  @RequirePermission("qc_review.request_correction")
  async requestQcCorrection(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.correction_reason ?? body.reason, "correction_reason is required");
      return await this.write(request, "qc_review.request_correction", "qc_review.correction_requested", "qc_review", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, correctionAuthorityRoles, "Project Manager or Operations Manager authority is required");
        const before = await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
        if (body.correction_owner_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.correction_owner_user_id);
        const rejectedQuantity = Number(before.rejected_quantity ?? before.claimed_quantity ?? 0);
        const correctionRequiredQuantity = body.correction_required_quantity === undefined ? rejectedQuantity : this.requireNonNegative(body.correction_required_quantity, "correction_required_quantity");
        if (correctionRequiredQuantity > rejectedQuantity && rejectedQuantity > 0) throw new BadRequestException("correction_required_quantity cannot exceed rejected_quantity");
        const after = await updateTenantRecord(client, "qc_reviews", request.auth.tenantId, id, {
          review_status: "correction_required",
          reviewer_user_id: request.auth.userId,
          reviewed_at: new Date(),
          correction_reason: reason,
          correction_note: body.correction_note,
          correction_due_date: body.correction_due_date,
          correction_owner_user_id: body.correction_owner_user_id,
          correction_required_quantity: correctionRequiredQuantity,
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("qc review not found");
        await this.syncProductionFromCorrectionQcReview(client, request.auth.tenantId, after, request.auth.userId);
        return { entityType: "qc_review", entityId: id, beforeState: before, afterState: await this.qcReviewDetail(client, request.auth.tenantId, id) };
      }, reason);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("qc-reviews/:id/mark-corrected")
  @RequirePermission("qc_review.mark_corrected")
  async markQcCorrected(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const note = this.requiredText(body.correction_note ?? body.review_notes, "correction_note is required");
    return this.write(request, "qc_review.mark_corrected", "qc_review.corrected", "qc_review", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
      const before = await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
      if (before.review_status !== "correction_required") throw new BadRequestException("qc review must be correction_required");
      const after = await updateTenantRecord(client, "qc_reviews", request.auth.tenantId, id, {
        review_status: "corrected",
        correction_note: note,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("qc review not found");
      return { entityType: "qc_review", entityId: id, beforeState: before, afterState: await this.qcReviewDetail(client, request.auth.tenantId, id) };
    }, note);
  }

  @Post("qc-reviews/:id/void")
  @RequirePermission("qc_review.void")
  async voidQcReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requiredText(body.void_reason ?? body.reason, "void_reason is required");
    return this.write(request, "qc_review.void", "qc_review.voided", "qc_review", async (client) => {
      const before = await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
      if (before.review_status === "archived") throw new BadRequestException("archived qc reviews are view-only");
      const after = await updateTenantRecord(client, "qc_reviews", request.auth.tenantId, id, {
        review_status: "voided",
        review_notes: body.review_notes ?? before.review_notes,
        override_reasons: this.jsonObject({ ...(typeof before.override_reasons === "object" && before.override_reasons ? before.override_reasons : {}), void_reason: reason }),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("qc review not found");
      return { entityType: "qc_review", entityId: id, beforeState: before, afterState: await this.qcReviewDetail(client, request.auth.tenantId, id) };
    }, reason);
  }

  @Post("qc-reviews/:id/archive")
  @RequirePermission("qc_review.archive")
  async archiveQcReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const archiveReason = requireAllowed(body.archive_reason, qcArchiveReasons, "archive_reason");
      return await this.write(request, "qc_review.archive", "qc_review.archived", "qc_review", async (client) => {
        const before = await this.requireRecord(client, "qc_reviews", request.auth.tenantId, id, "qc review not found");
        const after = await updateTenantRecord(client, "qc_reviews", request.auth.tenantId, id, {
          review_status: "archived",
          archived_by: request.auth.userId,
          archived_at: new Date(),
          archive_reason: archiveReason,
          archive_note: body.archive_note,
          deleted_at: new Date(),
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("qc review not found");
        return { entityType: "qc_review", entityId: id, beforeState: before, afterState: after };
      }, archiveReason);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get("billable-items")
  @RequirePermission("billable_item.read")
  async listBillableItems(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listBillableItemsEnriched(client, request.auth.tenantId, query));
  }

  @Get("billable-items/:id/detail")
  @RequirePermission("billable_item.read")
  async getBillableItemDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.billableItemDetail(client, request.auth.tenantId, id));
  }

  @Get("billable-items/:id/timeline")
  @RequirePermission("billable_item.timeline.read")
  async getBillableItemTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      const result = await client.query(
        `
        SELECT e.id AS event_id, e.event_type, e.actor_user_id AS actor_id, u.display_name AS actor_name, e.created_at AS timestamp,
          e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND e.aggregate_type = 'billable_item'
          AND e.aggregate_id = $2
        ORDER BY e.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("billable-items/:id/audit-summary")
  @RequirePermission("billable_item.audit.read")
  async getBillableItemAuditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      const result = await client.query(
        `
        SELECT al.id AS audit_id, al.actor_user_id AS actor_id, u.display_name AS actor_name, al.action, al.entity_type AS object_type,
          al.entity_id AS object_id, al.before_state AS before_json, al.after_state AS after_json,
          al.metadata->>'reason' AS reason, al.created_at, al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1
          AND al.entity_type = 'billable_item'
          AND al.entity_id = $2
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("billable-items/:id")
  @RequirePermission("billable_item.read")
  async getBillableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.billableItemRow(client, request.auth.tenantId, id));
  }

  @Post("billable-items")
  @RequirePermission("billable_item.create")
  async createBillableItem(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "billable_item.create", "billable_item.created", "billable_item", async (client) => {
        const context = await this.billableContextFromQcReview(client, request.auth.tenantId, this.requiredId(body.qc_review_id, "qc_review_id"));
        if (context.qcReview.review_status !== "approved") throw new BadRequestException("qc_review must be approved");
        if (context.productionRecord.status !== "approved") throw new BadRequestException("production_record must be approved");
        const duplicate = await client.query(
          "SELECT 1 FROM billable_items WHERE tenant_id = $1 AND qc_review_id = $2 AND status NOT IN ('voided', 'archived') AND deleted_at IS NULL LIMIT 1",
          [request.auth.tenantId, context.qcReview.id],
        );
        if (duplicate.rows[0] && !this.hasOverride(body.override_reasons, "duplicate_billable_override_reason")) {
          throw new BadRequestException({ message: "Duplicate active billable item requires override.", required_override_fields: ["duplicate_billable_override_reason"] });
        }
        const approvedQuantity = Number(context.qcReview.approved_quantity ?? context.productionRecord.approved_quantity ?? 0);
        if (approvedQuantity <= 0) throw new BadRequestException("approved_quantity must be > 0");
        const billableQuantity = body.billable_quantity === undefined ? Number(context.qcReview.billable_candidate_quantity ?? approvedQuantity) : this.requirePositive(body.billable_quantity, "billable_quantity");
        if (billableQuantity > approvedQuantity && !this.hasOverride(body.override_reasons, "billable_quantity_override_reason")) {
          throw new BadRequestException({ message: "billable_quantity cannot exceed approved_quantity", required_override_fields: ["billable_quantity_override_reason"] });
        }
        const unit = this.optionalAllowed(body.unit, workOrderUnits, "unit") ?? context.qcReview.unit ?? context.productionRecord.unit ?? context.productionRecord.unit_type ?? context.workOrder.unit;
        if (!unit) throw new BadRequestException("unit is required");
        const rate = await this.billableRateContext(client, request.auth.tenantId, body, String(unit));
        const estimatedBillableAmount = this.billableEstimatedAmount(billableQuantity, rate.unitRate);
        const retainage = this.billableRetainage(body, billableQuantity, estimatedBillableAmount);
        const values = {
          project_id: context.project.id,
          work_order_id: context.workOrder.id,
          production_record_id: context.productionRecord.id,
          qc_review_id: context.qcReview.id,
          customer_organization_id: context.project.customer_organization_id,
          capacity_provider_id: context.productionRecord.capacity_provider_id ?? context.workOrder.assigned_capacity_provider_id,
          crew_id: context.productionRecord.crew_id ?? context.workOrder.assigned_crew_id,
          approved_quantity: approvedQuantity,
          billable_quantity: billableQuantity,
          held_quantity: Math.max(0, approvedQuantity - billableQuantity),
          rejected_quantity: context.qcReview.rejected_quantity ?? context.productionRecord.rejected_quantity,
          correction_quantity: context.qcReview.correction_required_quantity ?? context.productionRecord.corrected_quantity,
          unit,
          rate_code_id: rate.rateCodeId,
          rate_description: rate.rateDescription,
          unit_rate: rate.unitRate,
          rate_source: rate.rateSource,
          rate_confidence: rate.rateConfidence,
          estimated_billable_amount: estimatedBillableAmount,
          retainage_required: retainage.retainageRequired,
          retainage_percent: retainage.retainagePercent,
          retainage_amount: retainage.retainageAmount,
          retainage_release_condition: body.retainage_release_condition,
          net_billable_amount: retainage.netBillableAmount,
          customer_acceptance_status: this.optionalAllowed(body.customer_acceptance_status, billableAcceptanceStatuses, "customer_acceptance_status") ?? this.mapBillableAcceptance(context.qcReview.customer_acceptance_status),
          prime_acceptance_status: this.optionalAllowed(body.prime_acceptance_status, billableAcceptanceStatuses, "prime_acceptance_status") ?? this.mapBillableAcceptance(context.qcReview.prime_acceptance_status),
          billing_package_status: this.optionalAllowed(body.billing_package_status, billablePackageStatuses, "billing_package_status") ?? "not_started",
          documentation_status: this.optionalAllowed(body.documentation_status, billablePackageStatuses, "documentation_status") ?? this.mapBillablePackageStatus(context.qcReview.documentation_status),
          override_reasons: this.jsonObject(body.override_reasons),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        };
        const derived = this.deriveBillableState(values);
        const billableItem = await insertTenantRecord(client, "billable_items", request.auth.tenantId, { ...values, status: derived.status, readiness_status: derived.readiness_status, readiness_score: derived.readiness_score, readiness_band: derived.readiness_band });
        await this.syncBillableSummaries(client, request.auth.tenantId, String(context.productionRecord.id), String(context.workOrder.id), request.auth.userId);
        return { entityType: "billable_item", entityId: billableItem.id, afterState: await this.billableItemDetail(client, request.auth.tenantId, billableItem.id) };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("billable-items/:id")
  @RequirePermission("billable_item.update")
  async updateBillableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "billable_item.update", "billable_item.updated", "billable_item", async (client) => {
        const before = await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
        if (["archived", "voided"].includes(String(before.status))) throw new BadRequestException("archived or voided billable items are view-only");
        if (before.status === "settlement_created") throw new BadRequestException("settlement_created billable items are view-only");
        const values = pick(body, ["rate_description", "retainage_release_condition", "hold_note", "dispute_note"]);
        if (body.billable_quantity !== undefined) values.billable_quantity = this.requirePositive(body.billable_quantity, "billable_quantity");
        if (body.rate_code_id !== undefined || body.unit_rate !== undefined || body.rate_source !== undefined || body.rate_confidence !== undefined) {
          const rate = await this.billableRateContext(client, request.auth.tenantId, { ...before, ...body }, String(before.unit));
          values.rate_code_id = rate.rateCodeId;
          values.rate_description = rate.rateDescription;
          values.unit_rate = rate.unitRate;
          values.rate_source = rate.rateSource;
          values.rate_confidence = rate.rateConfidence;
          values.estimated_billable_amount = rate.estimatedBillableAmount;
        }
        if (body.customer_acceptance_status !== undefined) values.customer_acceptance_status = requireAllowed(body.customer_acceptance_status, billableAcceptanceStatuses, "customer_acceptance_status");
        if (body.prime_acceptance_status !== undefined) values.prime_acceptance_status = requireAllowed(body.prime_acceptance_status, billableAcceptanceStatuses, "prime_acceptance_status");
        if (body.billing_package_status !== undefined) values.billing_package_status = requireAllowed(body.billing_package_status, billablePackageStatuses, "billing_package_status");
        if (body.documentation_status !== undefined) values.documentation_status = requireAllowed(body.documentation_status, billablePackageStatuses, "documentation_status");
        if (body.rate_source !== undefined) values.rate_source = requireAllowed(body.rate_source, billableRateSources, "rate_source");
        if (body.rate_confidence !== undefined) values.rate_confidence = requireAllowed(body.rate_confidence, billableRateConfidences, "rate_confidence");
        if (body.retainage_required !== undefined || body.retainage_percent !== undefined || body.billable_quantity !== undefined || body.unit_rate !== undefined) {
          const billableQuantity = Number(values.billable_quantity ?? before.billable_quantity);
          const estimated = values.estimated_billable_amount !== undefined ? Number(values.estimated_billable_amount) : this.billableEstimatedAmount(billableQuantity, values.unit_rate ?? before.unit_rate);
          const retainage = this.billableRetainage({ ...before, ...body }, billableQuantity, estimated);
          values.retainage_required = retainage.retainageRequired;
          values.retainage_percent = retainage.retainagePercent;
          values.retainage_amount = retainage.retainageAmount;
          values.net_billable_amount = retainage.netBillableAmount;
        }
        if (body.override_reasons !== undefined) values.override_reasons = this.jsonObject(body.override_reasons);
        values.updated_by = request.auth.userId;
        const next = { ...before, ...values };
        const derived = this.deriveBillableState(next);
        Object.assign(values, derived);
        const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("billable item not found");
        await this.syncBillableSummaries(client, request.auth.tenantId, String(after.production_record_id), String(after.work_order_id), request.auth.userId);
        return { entityType: "billable_item", entityId: id, beforeState: before, afterState: await this.billableItemDetail(client, request.auth.tenantId, id) };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("billable-items/:id/recalculate-readiness")
  @RequirePermission("billable_item.recalculate_readiness")
  async recalculateBillableReadiness(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "billable_item.recalculate_readiness", "billable_item.readiness_recalculated", "billable_item", async (client) => {
      const before = await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      const derived = this.deriveBillableState(before, { preserveStatus: true });
      const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, { ...derived, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("billable item not found");
      return { entityType: "billable_item", entityId: id, beforeState: before, afterState: await this.billableItemDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("billable-items/:id/mark-ready-for-settlement")
  @RequirePermission("billable_item.mark_ready")
  async markBillableReadyForSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const note = this.requiredText(body.approval_note, "approval_note is required");
    return this.write(request, "billable_item.mark_ready", "billable_item.ready_for_settlement", "billable_item", async (client) => {
      const before = await this.billableItemRow(client, request.auth.tenantId, id);
      if (["archived", "voided", "disputed", "held"].includes(String(before.status))) throw new BadRequestException("billable item is not eligible for ready_for_settlement");
      if (before.settlement_item_id) throw new BadRequestException("settlement already created");
      const blockers = this.billableBlockers(before);
      if (blockers.length) throw new BadRequestException({ message: "Billable blockers must be resolved.", blockers });
      this.assertBillableOverrides(before, body.override_reasons);
      const derived = this.deriveBillableState({ ...before, override_reasons: this.jsonObject(body.override_reasons ?? before.override_reasons) }, { preserveStatus: true });
      if (Number(derived.readiness_score ?? 0) < 85 && !this.hasOverride(body.override_reasons, "readiness_override_reason")) throw new BadRequestException({ message: "readiness is not sufficient", required_override_fields: ["readiness_override_reason"] });
      const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, {
        status: "ready_for_settlement",
        readiness_status: "ready_for_settlement",
        readiness_score: derived.readiness_score,
        readiness_band: derived.readiness_band,
        override_reasons: this.jsonObject(body.override_reasons ?? before.override_reasons),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("billable item not found");
      await this.syncBillableSummaries(client, request.auth.tenantId, String(after.production_record_id), String(after.work_order_id), request.auth.userId);
      return { entityType: "billable_item", entityId: id, beforeState: before, afterState: await this.billableItemDetail(client, request.auth.tenantId, id) };
    }, note);
  }

  @Post("billable-items/:id/place-hold")
  @RequirePermission("billable_item.place_hold")
  async holdBillableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requiredText(body.hold_reason, "hold_reason is required");
    return this.billableStatusAction(request, id, "billable_item.place_hold", "billable_item.held", { status: "held", hold_reason: reason, hold_note: body.hold_note, updated_by: request.auth.userId }, reason);
  }

  @Post("billable-items/:id/release-hold")
  @RequirePermission("billable_item.release_hold")
  async releaseBillableHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const note = this.requiredText(body.release_note, "release_note is required");
    return this.write(request, "billable_item.release_hold", "billable_item.hold_released", "billable_item", async (client) => {
      const before = await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      if (before.status !== "held") throw new BadRequestException("billable item must be held");
      const derived = this.deriveBillableState({ ...before, status: "candidate", hold_reason: null, hold_note: note });
      const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, { ...derived, hold_note: note, hold_reason: null, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("billable item not found");
      return { entityType: "billable_item", entityId: id, beforeState: before, afterState: await this.billableItemDetail(client, request.auth.tenantId, id) };
    }, note);
  }

  @Post("billable-items/:id/dispute")
  @RequirePermission("billable_item.dispute")
  async disputeBillableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requiredText(body.dispute_reason, "dispute_reason is required");
    return this.billableStatusAction(request, id, "billable_item.dispute", "billable_item.disputed", { status: "disputed", dispute_reason: reason, dispute_note: body.dispute_note, updated_by: request.auth.userId }, reason);
  }

  @Post("billable-items/:id/resolve-dispute")
  @RequirePermission("billable_item.resolve_dispute")
  async resolveBillableDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const note = this.requiredText(body.resolution_note, "resolution_note is required");
    return this.write(request, "billable_item.resolve_dispute", "billable_item.dispute_resolved", "billable_item", async (client) => {
      const before = await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      if (before.status !== "disputed") throw new BadRequestException("billable item must be disputed");
      const derived = this.deriveBillableState({ ...before, status: "candidate", dispute_reason: null, dispute_note: note, override_reasons: this.jsonObject(body.override_reasons ?? before.override_reasons) });
      const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, { ...derived, dispute_reason: null, dispute_note: note, override_reasons: this.jsonObject(body.override_reasons ?? before.override_reasons), updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("billable item not found");
      return { entityType: "billable_item", entityId: id, beforeState: before, afterState: await this.billableItemDetail(client, request.auth.tenantId, id) };
    }, note);
  }

  @Post("billable-items/:id/void")
  @RequirePermission("billable_item.void")
  async voidBillableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requiredText(body.void_reason, "void_reason is required");
    return this.write(request, "billable_item.void", "billable_item.voided", "billable_item", async (client) => {
      const before = await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      if (before.settlement_item_id) throw new BadRequestException("billable item with settlement_item_id cannot be voided");
      const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, { status: "voided", void_reason: reason, void_note: body.void_note, voided_by: request.auth.userId, voided_at: new Date(), updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("billable item not found");
      await this.syncBillableSummaries(client, request.auth.tenantId, String(after.production_record_id), String(after.work_order_id), request.auth.userId);
      return { entityType: "billable_item", entityId: id, beforeState: before, afterState: await this.billableItemDetail(client, request.auth.tenantId, id) };
    }, reason);
  }

  @Post("billable-items/:id/archive")
  @RequirePermission("billable_item.archive")
  async archiveBillableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = this.requiredText(body.archive_reason, "archive_reason is required");
    return this.write(request, "billable_item.archive", "billable_item.archived", "billable_item", async (client) => {
      const before = await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, { status: "archived", archived_by: request.auth.userId, archived_at: new Date(), archive_reason: reason, archive_note: body.archive_note, deleted_at: new Date(), updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("billable item not found");
      await this.syncBillableSummaries(client, request.auth.tenantId, String(after.production_record_id), String(after.work_order_id), request.auth.userId);
      return { entityType: "billable_item", entityId: id, beforeState: before, afterState: after };
    }, reason);
  }

  @Get("production-records")
  @RequirePermission("production_record.read")
  async listProductionRecords(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listProductionRecordsEnriched(client, request.auth.tenantId, query));
  }

  @Get("production-records/:id/detail")
  @RequirePermission("production_record.read")
  async getProductionRecordDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.productionRecordDetail(client, request.auth.tenantId, id));
  }

  @Get("production-records/:id/timeline")
  @RequirePermission("production.timeline.read")
  async getProductionRecordTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      const result = await client.query(
        `
        SELECT e.id AS event_id, e.event_type, e.actor_user_id AS actor_id, u.display_name AS actor_name, e.created_at AS timestamp,
          e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'production_record' AND e.aggregate_id = $2)
            OR (
              e.aggregate_type = 'production_evidence'
              AND e.aggregate_id IN (
                SELECT id FROM production_evidence WHERE tenant_id = $1 AND production_record_id = $2
              )
            )
          )
        ORDER BY e.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("production-records/:id/audit-summary")
  @RequirePermission("production.audit.read")
  async getProductionRecordAuditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      const result = await client.query(
        `
        SELECT al.id AS audit_id, al.actor_user_id AS actor_id, u.display_name AS actor_name, al.action, al.entity_type AS object_type,
          al.entity_id AS object_id, al.before_state AS before_json, al.after_state AS after_json,
          al.metadata->>'reason' AS reason, al.created_at, al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1
          AND (
            (al.entity_type = 'production_record' AND al.entity_id = $2)
            OR (
              al.entity_type = 'production_evidence'
              AND al.entity_id IN (
                SELECT id FROM production_evidence WHERE tenant_id = $1 AND production_record_id = $2
              )
            )
          )
        ORDER BY al.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("production-records/:id")
  @RequirePermission("production_record.read")
  async getProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.productionRecordRow(client, request.auth.tenantId, id));
  }

  @Post("production-records")
  @RequirePermission("production_record.create")
  async createProductionRecord(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const productionType = requireAllowed(body.production_type ?? "daily_production", productionTypes, "production_type");
      const productionDate = requireString(body.production_date, "production_date is required");
      const status = body.status === undefined ? "submitted" : requireAllowed(body.status, new Set(["draft", "submitted"]), "production status");
      return await this.write(request, "production_record.create", status === "submitted" ? "production.submitted" : "production.created", "production_record", async (client) => {
        const context = await this.validateProductionCreateContext(client, request.auth.tenantId, body, productionType);
        const quantity = this.productionClaimedQuantity(body, productionType);
        const unit = this.productionUnit(body, quantity);
        this.validateProductionTypeNotes(body, productionType);
        await this.validateProductionQuantityRules(client, request.auth.tenantId, context.workOrder, body, quantity, unit);
        const record = await insertTenantRecord(client, "production_records", request.auth.tenantId, {
          project_id: context.project.id,
          work_order_id: context.workOrder.id,
          capacity_provider_id: body.capacity_provider_id ?? context.workOrder.assigned_capacity_provider_id,
          crew_id: body.crew_id ?? context.workOrder.assigned_crew_id,
          assigned_organization_id: body.assigned_organization_id ?? context.workOrder.assigned_organization_id,
          foreman_user_id: body.foreman_user_id,
          foreman_contact_id: body.foreman_contact_id,
          submitted_by_user_id: status === "submitted" ? request.auth.userId : body.submitted_by_user_id,
          submitted_by: status === "submitted" ? request.auth.userId : body.submitted_by,
          worker_count: body.worker_count,
          equipment_used: body.equipment_used,
          subcontractor_reference: body.subcontractor_reference,
          production_type: productionType,
          production_date: productionDate,
          quantity_submitted: quantity ?? 0,
          claimed_quantity: quantity,
          quantity: quantity ?? 0,
          unit_type: unit ?? context.workOrder.unit,
          unit: unit ?? context.workOrder.unit,
          status,
          qc_status: "not_started",
          billable_status: "not_billable",
          location_summary: body.location_summary ?? context.workOrder.location_summary ?? context.workOrder.location_description,
          route_name: body.route_name ?? context.workOrder.route_name,
          node_id: body.node_id ?? context.workOrder.node_id,
          segment_id: body.segment_id ?? context.workOrder.segment_id,
          address_range: body.address_range ?? context.workOrder.address_range,
          latitude: body.latitude,
          longitude: body.longitude,
          description: body.description,
          production_notes: body.production_notes,
          delay_reason: body.delay_reason,
          no_work_reason: body.no_work_reason,
          safety_observation_note: body.safety_observation_note,
          material_issue_note: body.material_issue_note,
          access_issue_note: body.access_issue_note,
          weather_delay_note: body.weather_delay_note,
          customer_issue_note: body.customer_issue_note,
          started_at: body.started_at,
          ended_at: body.ended_at,
          submitted_at: status === "submitted" ? new Date() : body.submitted_at,
          parent_production_record_id: body.parent_production_record_id,
          source_qc_review_id: body.source_qc_review_id,
          correction_due_date: body.correction_due_date,
          correction_owner_user_id: body.correction_owner_user_id,
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        if (status === "submitted") {
          await this.assertProductionEvidenceRequirement(client, request.auth.tenantId, record.id, productionType, body.override_reasons);
          await this.recalculateWorkOrderProductionRollups(client, request.auth.tenantId, String(context.workOrder.id), request.auth.userId);
        }
        return { entityType: "production_record", entityId: record.id, afterState: await this.productionRecordDetail(client, request.auth.tenantId, record.id) };
      }, typeof body.reason === "string" ? body.reason : undefined);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("production-records/:id")
  @RequirePermission("production_record.update")
  async updateProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
      const values = pick(body, ["production_date", "started_at", "ended_at", "location_summary", "route_name", "node_id", "segment_id", "address_range", "latitude", "longitude", "description", "production_notes", "delay_reason", "no_work_reason", "safety_observation_note", "material_issue_note", "access_issue_note", "weather_delay_note", "customer_issue_note", "correction_reason", "correction_note", "worker_count", "equipment_used", "subcontractor_reference", "correction_due_date", "correction_owner_user_id"]);
      if (body.production_type !== undefined) values.production_type = requireAllowed(body.production_type, productionTypes, "production_type");
      if (body.quantity_submitted !== undefined || body.claimed_quantity !== undefined) {
        values.quantity_submitted = this.requireNonNegative(body.claimed_quantity ?? body.quantity_submitted, "claimed_quantity");
        values.claimed_quantity = values.quantity_submitted;
        values.quantity = values.quantity_submitted;
      }
      if (body.unit_type !== undefined || body.unit !== undefined) {
        values.unit_type = requireAllowed(body.unit ?? body.unit_type, workOrderUnits, "unit");
        values.unit = values.unit_type;
      }
      return await this.write(request, "production_record.update", "production_record.updated", "production_record", async (client) => {
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        if (["approved", "billable", "rejected", "voided", "archived"].includes(before.status)) throw new BadRequestException("approved, rejected, voided, billable, and archived production records cannot be edited");
        await this.validateProductionReferences(client, request.auth.tenantId, values, body, before);
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/submit")
  @RequirePermission("production_record.submit")
  async submitProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "production_record.submit", "production.submitted", "production_record", async (client) => {
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (!["draft", "corrected"].includes(before.status)) throw new BadRequestException("production record must be draft or corrected");
      const workOrder = await this.requireRecord(client, "work_orders", request.auth.tenantId, String(before.work_order_id), "work order not found");
      const project = await this.requireRecord(client, "projects", request.auth.tenantId, String(before.project_id), "project not found");
      this.assertProjectAllowsProduction(project, body.override_reasons);
      this.assertWorkOrderAllowsProduction(workOrder, before.production_type, body.override_reasons);
      if (before.quantity_submitted === undefined || before.quantity_submitted === null || Number(before.quantity_submitted) < 0) throw new BadRequestException("quantity_submitted is required");
      requireString(before.unit_type, "unit_type is required");
      if (!before.production_date) throw new BadRequestException("production_date is required");
      const submittedBy = body.submitted_by_user_id ?? request.auth.userId;
      await this.requireTenantUser(client, request.auth.tenantId, submittedBy);
      await this.assertProductionEvidenceRequirement(client, request.auth.tenantId, id, before.production_type, body.override_reasons);
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
        status: "submitted",
        qc_status: "not_started",
        submitted_by_user_id: submittedBy,
        submitted_by: submittedBy,
        submitted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("production record not found");
      await this.recalculateWorkOrderProductionRollups(client, request.auth.tenantId, String(before.work_order_id), request.auth.userId);
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("production-records/:id/correction-required")
  @RequirePermission("production_record.correction_required")
  async correctionRequired(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.requestProductionCorrection(request, id, body);
  }

  @Post("production-records/:id/request-correction")
  @RequirePermission("production.request_correction")
  async requestProductionCorrection(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.reason ?? body.correction_reason, "correction reason is required");
      return await this.write(request, "production.request_correction", "production.correction_requested", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, correctionAuthorityRoles, "Project Manager or Operations Manager authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          status: "correction_required",
          qc_status: "corrections_required",
          correction_reason: reason,
          correction_note: body.correction_note,
          correction_due_date: body.correction_due_date,
          correction_owner_user_id: body.correction_owner_user_id,
          correction_required_at: new Date(),
          correction_required_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
      }, reason);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/qc-review")
  @RequirePermission("qc.review")
  async startQcReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "qc.review", "production_record.qc_review_started", "production_record", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (before.status !== "submitted") throw new BadRequestException("production record must be submitted");
      await this.requireQcValidation(client, request.auth.tenantId, before);
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "qc_review", qc_status: "pending_review", reviewed_at: new Date(), updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("production-records/:id/start-review")
  @RequirePermission("production.review")
  async startProductionReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "production.review", "production.review_started", "production_record", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (!["submitted", "corrected"].includes(before.status)) throw new BadRequestException("production record must be submitted or corrected");
      await this.requireQcValidation(client, request.auth.tenantId, before);
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "under_review", qc_status: "pending_review", reviewed_at: new Date(), updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("production-records/:id/accept")
  @RequirePermission("qc.accept")
  async acceptProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const acceptedQuantity = this.requirePositive(body.accepted_quantity, "accepted_quantity");
      return await this.write(request, "qc.accept", "production_record.accepted", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcManagerRoles, "QC Manager authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        if (!["qc_review", "under_review"].includes(before.status)) throw new BadRequestException("production record must be in review");
        this.requireNoActiveStopWork(before);
        await this.requireQcValidation(client, request.auth.tenantId, before);
        this.requireQuantityAtMost(acceptedQuantity, before.quantity_submitted, "accepted_quantity", "quantity_submitted");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          status: "accepted",
          qc_status: "pending_review",
          accepted_quantity: acceptedQuantity,
          accepted_by: request.auth.userId,
          accepted_at: new Date(),
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
      });
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/reject")
  @RequirePermission("qc.reject")
  async rejectProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.reason ?? body.rejection_reason, "rejection reason is required");
      const rejectedQuantity = body.rejected_quantity === undefined ? undefined : this.requirePositive(body.rejected_quantity, "rejected_quantity");
      return await this.write(request, "qc.reject", "production_record.rejected", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        if (rejectedQuantity !== undefined) this.requireQuantityAtMost(rejectedQuantity, before.quantity_submitted, "rejected_quantity", "quantity_submitted");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          status: "rejected",
          qc_status: "rejected",
          rejection_reason: reason,
          rejection_note: body.rejection_note,
          rejected_quantity: rejectedQuantity,
          rejected_by: request.auth.userId,
          rejected_at: new Date(),
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
      }, reason);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/approve")
  @RequirePermission("qc.approve")
  async approveProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const approvedQuantity = this.requirePositive(body.approved_quantity, "approved_quantity");
      return await this.write(request, "qc.approve", "production.approved", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, approveAuthorityRoles, "QC Manager or Operations Manager authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        if (!["accepted", "submitted", "under_review", "corrected"].includes(before.status)) throw new BadRequestException("production record must be accepted, submitted, under_review, or corrected");
        this.requireNoActiveStopWork(before);
        const maximum = before.accepted_quantity ?? before.claimed_quantity ?? before.quantity_submitted;
        this.requireQuantityAtMost(approvedQuantity, maximum, "approved_quantity", before.accepted_quantity ? "accepted_quantity" : "claimed_quantity");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          status: "approved",
          qc_status: "approved",
          billable_status: "billable_candidate",
          approved_quantity: approvedQuantity,
          rejected_quantity: Math.max(0, Number(before.quantity_submitted ?? before.claimed_quantity ?? approvedQuantity) - approvedQuantity),
          approved_by: request.auth.userId,
          approved_at: new Date(),
          updated_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("production record not found");
        await this.recalculateWorkOrderProductionRollups(client, request.auth.tenantId, String(before.work_order_id), request.auth.userId);
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
      });
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/mark-billable")
  @RequirePermission("production.mark_billable")
  async markBillable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "production.mark_billable", "production.marked_billable", "production_record", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, billableAuthorityRoles, "Billing Manager or QC Manager authority is required");
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (before.status !== "approved") throw new BadRequestException("production record must be approved");
      this.requireNoActiveStopWork(before);
      if (!before.approved_quantity || Number(before.approved_quantity) <= 0) throw new BadRequestException("approved_quantity must be > 0");
      const rateCodeId = body.rate_code_id ?? before.rate_code_id;
      if (rateCodeId) await this.requireActiveRateCode(client, request.auth.tenantId, rateCodeId, String(before.unit_type));
      const billableQuantity = body.billable_quantity === undefined ? Number(before.approved_quantity) : this.requireNonNegative(body.billable_quantity, "billable_quantity");
      this.requireQuantityAtMost(billableQuantity, before.approved_quantity, "billable_quantity", "approved_quantity");
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
        rate_code_id: rateCodeId,
        status: "billable",
        billable_status: "billable",
        billable_quantity: billableQuantity,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("production record not found");
      await this.recalculateWorkOrderProductionRollups(client, request.auth.tenantId, String(before.work_order_id), request.auth.userId);
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
    });
  }

  @Post("production-records/:id/clear-correction")
  @RequirePermission("production.clear_correction")
  async clearCorrection(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;
    return this.write(request, "production.clear_correction", "production_record.correction_cleared", "production_record", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (before.status !== "correction_required") throw new BadRequestException("production record must be correction_required");
      if (!before.correction_required_at) throw new BadRequestException("correction_required_at is required");
      if (!(await this.hasActiveEvidenceAfter(client, request.auth.tenantId, id, before.correction_required_at))) {
        throw new BadRequestException("updated active evidence is required");
      }
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "qc_review", qc_status: "pending_review", updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
    }, reason);
  }

  @Post("production-records/:id/mark-corrected")
  @RequirePermission("production.mark_corrected")
  async markProductionCorrected(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;
    return this.write(request, "production.mark_corrected", "production.corrected", "production_record", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, qcReviewAuthorityRoles, "QC Manager or Project Manager authority is required");
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (before.status !== "correction_required") throw new BadRequestException("production record must be correction_required");
      if (!before.correction_required_at) throw new BadRequestException("correction_required_at is required");
      if (!(await this.hasActiveEvidenceAfter(client, request.auth.tenantId, id, before.correction_required_at))) {
        throw new BadRequestException("updated active evidence is required");
      }
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "corrected", corrected_quantity: body.corrected_quantity === undefined ? before.corrected_quantity : this.requireNonNegative(body.corrected_quantity, "corrected_quantity"), correction_note: body.correction_note, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
    }, reason);
  }

  @Post("production-records/:id/stop-work")
  @RequirePermission("stop_work.issue")
  async issueStopWork(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.reason ?? body.stop_work_reason, "stop work reason is required");
      return await this.write(request, "stop_work.issue", "production_record.stop_work_issued", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, stopWorkIssueAuthorityRoles, "Safety Manager, QC Manager, or Executive authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          stop_work_status: "active",
          stop_work_reason: reason,
          stop_work_at: new Date(),
          stop_work_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/release-stop-work")
  @RequirePermission("stop_work.release")
  async releaseStopWork(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const releaseReason = requireString(body.release_reason, "release_reason is required");
      return await this.write(request, "stop_work.release", "production_record.stop_work_released", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, stopWorkReleaseAuthorityRoles, "Safety Manager or Executive authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          stop_work_status: "released",
          stop_work_release_reason: releaseReason,
          stop_work_released_at: new Date(),
          stop_work_released_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
      }, releaseReason);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/archive")
  @RequirePermission("production_record.archive")
  async archiveProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const archiveReason = requireAllowed(body.archive_reason, productionArchiveReasons, "archive_reason");
      return await this.write(request, "production_record.archive", "production.archived", "production_record", async (client) => {
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "archived", archived_by: request.auth.userId, archived_at: new Date(), archive_reason: archiveReason, archive_note: body.archive_note, deleted_at: new Date(), updated_by: request.auth.userId });
        if (!after) throw new NotFoundException("production record not found");
        await this.recalculateWorkOrderProductionRollups(client, request.auth.tenantId, String(before.work_order_id), request.auth.userId);
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
      }, archiveReason);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/void")
  @RequirePermission("production.void")
  async voidProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const voidReason = this.requiredText(body.void_reason ?? body.reason, "void_reason is required");
    return this.write(request, "production.void", "production.voided", "production_record", async (client) => {
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (before.status === "archived") throw new BadRequestException("archived production records are view-only");
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "voided", void_reason: voidReason, void_note: body.void_note, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("production record not found");
      await this.recalculateWorkOrderProductionRollups(client, request.auth.tenantId, String(before.work_order_id), request.auth.userId);
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: await this.productionRecordDetail(client, request.auth.tenantId, id) };
    }, voidReason);
  }

  @Get("production-records/:id/evidence")
  @RequirePermission("production_evidence.read")
  async listEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      const result = await client.query("SELECT * FROM production_evidence WHERE tenant_id = $1 AND production_record_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [
        request.auth.tenantId,
        id,
      ]);
      return result.rows;
    });
  }

  @Post("production-records/:id/evidence")
  @RequirePermission("production_evidence.create")
  async createEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const evidenceType = requireAllowed(body.evidence_type, evidenceTypes, "evidence_type");
      if (!this.hasEvidenceReference(body)) throw new Error("description, file_id, source_url, file_url, storage_reference, or caption is required");
      return await this.write(request, "production_evidence.create", "production_evidence.created", "production_evidence", async (client) => {
        await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        const summary = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim() : typeof body.description === "string" && body.description.trim() ? body.description.trim() : evidenceType;
        const evidence = await insertTenantRecord(client, "production_evidence", request.auth.tenantId, {
          production_record_id: id,
          evidence_type: evidenceType,
          summary,
          description: body.description,
          source_url: body.source_url ?? body.file_url,
          file_id: body.file_id,
          file_url: body.file_url ?? body.source_url,
          storage_reference: body.storage_reference,
          filename: body.filename,
          mime_type: body.mime_type,
          uploaded_by: request.auth.userId,
          uploaded_at: new Date(),
          caption: body.caption ?? summary,
          geo_latitude: body.geo_latitude,
          geo_longitude: body.geo_longitude,
          captured_at: body.captured_at,
          status: "active",
          metadata: this.objectOrEmpty(body.metadata),
        });
        return { entityType: "production_evidence", entityId: evidence.id, afterState: evidence };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("production-evidence/:id")
  @RequirePermission("production_evidence.update")
  async updateEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["description", "source_url", "file_id", "file_url", "storage_reference", "filename", "mime_type", "caption", "geo_latitude", "geo_longitude", "captured_at"]);
      if (body.evidence_type !== undefined) values.evidence_type = requireAllowed(body.evidence_type, evidenceTypes, "evidence_type");
      if (body.status !== undefined) values.status = requireAllowed(body.status, evidenceStatuses, "evidence status");
      if (body.metadata !== undefined) values.metadata = this.objectOrEmpty(body.metadata);
      if (body.description !== undefined) values.summary = body.description;
      return await this.write(request, "production_evidence.update", "production_evidence.updated", "production_evidence", async (client) => {
        const before = await this.requireRecord(client, "production_evidence", request.auth.tenantId, id, "production evidence not found");
        const after = await updateTenantRecord(client, "production_evidence", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("production evidence not found");
        return { entityType: "production_evidence", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-evidence/:id/archive")
  @RequirePermission("production_evidence.archive")
  async archiveEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const archiveReason = requireAllowed(body.archive_reason, productionArchiveReasons, "archive_reason");
      return await this.write(request, "production_evidence.archive", "production_evidence.archived", "production_evidence", async (client) => {
        const before = await this.requireRecord(client, "production_evidence", request.auth.tenantId, id, "production evidence not found");
        const after = await updateTenantRecord(client, "production_evidence", request.auth.tenantId, id, { status: "archived", archived_by: request.auth.userId, archived_at: new Date(), archive_reason: archiveReason, archive_note: body.archive_note, deleted_at: new Date() });
        if (!after) throw new NotFoundException("production evidence not found");
        return { entityType: "production_evidence", entityId: id, beforeState: before, afterState: after };
      }, archiveReason);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("work-orders/:id/recalculate-production-rollups")
  @RequirePermission("work_order.update")
  async recalculateProductionRollups(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "work_order.update", "work_order.production_rollups_recalculated", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      await this.recalculateWorkOrderProductionRollups(client, request.auth.tenantId, id, request.auth.userId);
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    });
  }

  private async listQcReviewsEnriched(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const conditions = ["qr.tenant_id = $1", "qr.deleted_at IS NULL"];
    const params: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    if (query.archived !== "true") conditions.push("qr.review_status <> 'archived'");
    if (query.id) add("qr.id = ?", query.id);
    if (query.production_record_id) add("qr.production_record_id = ?", query.production_record_id);
    if (query.work_order_id) add("qr.work_order_id = ?", query.work_order_id);
    if (query.project_id) add("qr.project_id = ?", query.project_id);
    if (query.review_type) add("qr.review_type = ?", query.review_type);
    if (query.review_status) add("qr.review_status = ?", query.review_status);
    if (query.reviewer_user_id) add("qr.reviewer_user_id = ?", query.reviewer_user_id);
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(`(qr.review_notes ILIKE $${params.length} OR qr.rejection_reason ILIKE $${params.length} OR qr.correction_reason ILIKE $${params.length} OR wo.work_order_name ILIKE $${params.length} OR wo.work_order_number ILIKE $${params.length} OR p.name ILIKE $${params.length} OR pr.description ILIKE $${params.length})`);
    }
    const orderBy = query.sort === "reviewed_at_desc" ? "qr.reviewed_at DESC NULLS LAST, qr.updated_at DESC" : query.sort === "status" ? "qr.review_status ASC, qr.updated_at DESC" : "qr.updated_at DESC";
    const result = await client.query(
      `
      SELECT qr.*, pr.production_type, pr.status AS production_record_status, pr.qc_status AS production_qc_status,
        pr.billable_status AS production_billable_status, wo.work_order_name, wo.work_order_number, wo.status AS work_order_status,
        p.name AS project_name, p.status AS project_status, u.display_name AS reviewer_name,
        cu.display_name AS correction_owner_name
      FROM qc_reviews qr
      JOIN production_records pr ON pr.tenant_id = qr.tenant_id AND pr.id = qr.production_record_id
      JOIN work_orders wo ON wo.tenant_id = qr.tenant_id AND wo.id = qr.work_order_id
      JOIN projects p ON p.tenant_id = qr.tenant_id AND p.id = qr.project_id
      LEFT JOIN users u ON u.id = qr.reviewer_user_id
      LEFT JOIN users cu ON cu.id = qr.correction_owner_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 200
      `,
      params,
    );
    return result.rows.map((row) => ({
      ...row,
      warnings: this.qcReviewWarnings(row),
      blockers: this.qcReviewBlockers(row),
      recommended_next_action: this.recommendedQcAction(row),
    }));
  }

  private async qcReviewRow(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.listQcReviewsEnriched(client, tenantId, { id });
    const direct = rows.find((row) => row.id === id);
    if (direct) return direct;
    const review = await this.requireRecord(client, "qc_reviews", tenantId, id, "qc review not found");
    return review;
  }

  private async qcReviewDetail(client: PoolClient, tenantId: string, id: string) {
    const review = await this.qcReviewRow(client, tenantId, id);
    const productionRecord = await this.productionRecordDetail(client, tenantId, String(review.production_record_id));
    const timelineAvailable = true;
    return {
      qc_review: review,
      production_record: productionRecord.production_record,
      work_order_context: productionRecord.work_order_context,
      project_context: productionRecord.project_context,
      performer_context: productionRecord.performer_context,
      quantity_summary: {
        claimed_quantity: review.claimed_quantity,
        approved_quantity: review.approved_quantity,
        rejected_quantity: review.rejected_quantity,
        correction_required_quantity: review.correction_required_quantity,
        billable_candidate_quantity: review.billable_candidate_quantity,
        unit: review.unit,
      },
      findings: {
        evidence_status: review.evidence_status,
        location_status: review.location_status,
        documentation_status: review.documentation_status,
        production_status: review.production_status,
      },
      acceptance: {
        customer_acceptance_status: review.customer_acceptance_status,
        prime_acceptance_status: review.prime_acceptance_status,
      },
      correction_context: {
        correction_reason: review.correction_reason,
        correction_note: review.correction_note,
        correction_due_date: review.correction_due_date,
        correction_owner_user_id: review.correction_owner_user_id,
        correction_owner_name: review.correction_owner_name,
      },
      warnings: this.qcReviewWarnings(review),
      blockers: this.qcReviewBlockers(review),
      recommended_next_action: this.recommendedQcAction(review),
      timeline_available: timelineAvailable,
      audit_allowed: true,
    };
  }

  private qcReviewWarnings(row: Record<string, any>) {
    const warnings = [];
    if (row.evidence_status === "pending") warnings.push({ warning_type: "evidence_pending", severity: "medium", message: "Evidence review is pending." });
    if (row.location_status === "pending") warnings.push({ warning_type: "location_pending", severity: "medium", message: "Location review is pending." });
    if (row.documentation_status === "pending") warnings.push({ warning_type: "documentation_pending", severity: "medium", message: "Documentation review is pending." });
    if (row.customer_acceptance_status === "pending") warnings.push({ warning_type: "customer_acceptance_pending", severity: "medium", message: "Customer acceptance is pending." });
    if (row.prime_acceptance_status === "pending") warnings.push({ warning_type: "prime_acceptance_pending", severity: "medium", message: "Prime acceptance is pending." });
    return warnings;
  }

  private qcReviewBlockers(row: Record<string, any>) {
    const blockers = [];
    if (row.review_status === "archived" || row.archived_at) blockers.push({ blocker_type: "archived_review", severity: "critical", message: "Archived QC reviews are view-only." });
    if (row.review_status === "voided") blockers.push({ blocker_type: "voided_review", severity: "high", message: "Voided QC reviews cannot be approved." });
    if (row.hard_stop) blockers.push({ blocker_type: "hard_stop", severity: "critical", message: "Hard stop QC review blocks approval." });
    if (["insufficient", "invalid"].includes(String(row.evidence_status))) blockers.push({ blocker_type: "evidence_blocker", severity: "high", message: "Evidence is insufficient." });
    if (row.location_status === "invalid") blockers.push({ blocker_type: "location_blocker", severity: "high", message: "Location is invalid." });
    if (row.production_status === "invalid") blockers.push({ blocker_type: "production_blocker", severity: "high", message: "Production claim is invalid." });
    return blockers;
  }

  private recommendedQcAction(row: Record<string, any>) {
    if (row.review_status === "archived") return "view_only";
    if (row.review_status === "voided") return "view_voided_review";
    if (row.review_status === "pending") return "start_review";
    if (row.review_status === "in_review") return "approve_reject_or_request_correction";
    if (row.review_status === "correction_required") return "await_correction";
    if (row.review_status === "corrected") return "restart_review";
    if (row.review_status === "approved" && Number(row.billable_candidate_quantity ?? 0) > 0) return "ready_for_billable_review";
    if (row.review_status === "approved") return "review_billable_candidate";
    if (row.review_status === "rejected") return "review_rejection";
    return "review_qc";
  }

  private async syncProductionFromApprovedQcReview(client: PoolClient, tenantId: string, review: Record<string, any>, productionRecord: Record<string, any>, actorUserId: string) {
    const after = await updateTenantRecord(client, "production_records", tenantId, String(review.production_record_id), {
      status: "approved",
      qc_status: "approved",
      approved_quantity: review.approved_quantity,
      rejected_quantity: review.rejected_quantity,
      billable_quantity: review.billable_candidate_quantity,
      billable_status: Number(review.billable_candidate_quantity ?? 0) > 0 ? "billable_candidate" : "not_billable",
      approved_by: actorUserId,
      approved_at: new Date(),
      updated_by: actorUserId,
    });
    if (!after) throw new NotFoundException("production record not found");
    await this.recalculateWorkOrderProductionRollups(client, tenantId, String(productionRecord.work_order_id), actorUserId);
  }

  private async syncProductionFromRejectedQcReview(client: PoolClient, tenantId: string, review: Record<string, any>, productionRecord: Record<string, any>, actorUserId: string) {
    const after = await updateTenantRecord(client, "production_records", tenantId, String(review.production_record_id), {
      status: "rejected",
      qc_status: "rejected",
      approved_quantity: 0,
      rejected_quantity: review.rejected_quantity,
      rejection_reason: review.rejection_reason,
      rejection_note: review.rejection_note,
      rejected_by: actorUserId,
      rejected_at: new Date(),
      updated_by: actorUserId,
    });
    if (!after) throw new NotFoundException("production record not found");
    await this.recalculateWorkOrderProductionRollups(client, tenantId, String(productionRecord.work_order_id), actorUserId);
  }

  private async syncProductionFromCorrectionQcReview(client: PoolClient, tenantId: string, review: Record<string, any>, actorUserId: string) {
    const after = await updateTenantRecord(client, "production_records", tenantId, String(review.production_record_id), {
      status: "correction_required",
      qc_status: "corrections_required",
      correction_reason: review.correction_reason,
      correction_note: review.correction_note,
      correction_due_date: review.correction_due_date,
      correction_owner_user_id: review.correction_owner_user_id,
      correction_required_at: new Date(),
      correction_required_by: actorUserId,
      updated_by: actorUserId,
    });
    if (!after) throw new NotFoundException("production record not found");
  }

  private async listBillableItemsEnriched(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const conditions = ["bi.tenant_id = $1", "bi.deleted_at IS NULL"];
    const params: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    if (query.archived !== "true") conditions.push("bi.status <> 'archived'");
    if (query.id) add("bi.id = ?", query.id);
    if (query.project_id) add("bi.project_id = ?", query.project_id);
    if (query.work_order_id) add("bi.work_order_id = ?", query.work_order_id);
    if (query.production_record_id) add("bi.production_record_id = ?", query.production_record_id);
    if (query.qc_review_id) add("bi.qc_review_id = ?", query.qc_review_id);
    if (query.status) add("bi.status = ?", query.status);
    if (query.readiness_status) add("bi.readiness_status = ?", query.readiness_status);
    if (query.customer_organization_id) add("bi.customer_organization_id = ?", query.customer_organization_id);
    if (query.capacity_provider_id) add("bi.capacity_provider_id = ?", query.capacity_provider_id);
    if (query.crew_id) add("bi.crew_id = ?", query.crew_id);
    if (query.customer_acceptance_status) add("bi.customer_acceptance_status = ?", query.customer_acceptance_status);
    if (query.prime_acceptance_status) add("bi.prime_acceptance_status = ?", query.prime_acceptance_status);
    if (query.billing_package_status) add("bi.billing_package_status = ?", query.billing_package_status);
    if (query.documentation_status) add("bi.documentation_status = ?", query.documentation_status);
    if (query.rate_source) add("bi.rate_source = ?", query.rate_source);
    if (query.rate_confidence) add("bi.rate_confidence = ?", query.rate_confidence);
    if (query.retainage_required === "true") conditions.push("bi.retainage_required = true");
    if (query.retainage_required === "false") conditions.push("bi.retainage_required = false");
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(`(bi.rate_description ILIKE $${params.length} OR bi.hold_reason ILIKE $${params.length} OR bi.dispute_reason ILIKE $${params.length} OR p.name ILIKE $${params.length} OR wo.work_order_name ILIKE $${params.length} OR co.name ILIKE $${params.length})`);
    }
    const orderBy = query.sort === "readiness_asc" ? "bi.readiness_score ASC NULLS FIRST, bi.updated_at DESC" : query.sort === "readiness_desc" ? "bi.readiness_score DESC NULLS LAST, bi.updated_at DESC" : query.sort === "amount_desc" ? "bi.estimated_billable_amount DESC NULLS LAST, bi.updated_at DESC" : query.sort === "status" ? "bi.status ASC, bi.updated_at DESC" : query.sort === "project" ? "p.name ASC, bi.updated_at DESC" : query.sort === "customer" ? "co.name ASC NULLS LAST, bi.updated_at DESC" : "bi.updated_at DESC";
    const result = await client.query(
      `
      SELECT bi.*, p.name AS project_name, wo.work_order_name, wo.work_order_number, pr.production_type,
        pr.status AS production_record_status, qr.review_status AS qc_review_status,
        co.name AS customer_organization_name, cp.name AS capacity_provider_name, c.name AS crew_name
      FROM billable_items bi
      JOIN projects p ON p.tenant_id = bi.tenant_id AND p.id = bi.project_id
      JOIN work_orders wo ON wo.tenant_id = bi.tenant_id AND wo.id = bi.work_order_id
      JOIN production_records pr ON pr.tenant_id = bi.tenant_id AND pr.id = bi.production_record_id
      JOIN qc_reviews qr ON qr.tenant_id = bi.tenant_id AND qr.id = bi.qc_review_id
      LEFT JOIN organizations co ON co.tenant_id = bi.tenant_id AND co.id = bi.customer_organization_id
      LEFT JOIN capacity_providers cp ON cp.tenant_id = bi.tenant_id AND cp.id = bi.capacity_provider_id
      LEFT JOIN crews c ON c.tenant_id = bi.tenant_id AND c.id = bi.crew_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 200
      `,
      params,
    );
    return result.rows.map((row) => ({
      ...row,
      warnings: this.billableWarnings(row),
      blockers: this.billableBlockers(row),
      required_override_fields: this.billableRequiredOverrideFields(row),
      recommended_next_action: this.billableNextAction(row),
    }));
  }

  private async billableItemRow(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.listBillableItemsEnriched(client, tenantId, { archived: "true", id });
    const row = rows[0];
    if (!row) throw new NotFoundException("billable item not found");
    return row;
  }

  private async billableItemDetail(client: PoolClient, tenantId: string, id: string) {
    const billableItem = await this.billableItemRow(client, tenantId, id);
    return {
      billable_item: billableItem,
      project_context: await this.optionalRecord(client, "projects", tenantId, billableItem.project_id),
      work_order_context: await this.optionalRecord(client, "work_orders", tenantId, billableItem.work_order_id),
      production_context: await this.optionalRecord(client, "production_records", tenantId, billableItem.production_record_id),
      qc_context: await this.optionalRecord(client, "qc_reviews", tenantId, billableItem.qc_review_id),
      customer_context: await this.optionalRecord(client, "organizations", tenantId, billableItem.customer_organization_id),
      provider_context: {
        capacity_provider_id: billableItem.capacity_provider_id,
        capacity_provider_name: billableItem.capacity_provider_name,
        crew_id: billableItem.crew_id,
        crew_name: billableItem.crew_name,
      },
      quantity_summary: {
        approved_quantity: billableItem.approved_quantity,
        billable_quantity: billableItem.billable_quantity,
        held_quantity: billableItem.held_quantity,
        rejected_quantity: billableItem.rejected_quantity,
        correction_quantity: billableItem.correction_quantity,
        unit: billableItem.unit,
      },
      rate_summary: {
        rate_code_id: billableItem.rate_code_id,
        rate_description: billableItem.rate_description,
        unit_rate: billableItem.unit_rate,
        rate_source: billableItem.rate_source,
        rate_confidence: billableItem.rate_confidence,
        estimated_billable_amount: billableItem.estimated_billable_amount,
      },
      acceptance_summary: {
        customer_acceptance_status: billableItem.customer_acceptance_status,
        prime_acceptance_status: billableItem.prime_acceptance_status,
      },
      billing_package_summary: {
        billing_package_status: billableItem.billing_package_status,
        documentation_status: billableItem.documentation_status,
      },
      retainage_summary: {
        retainage_required: billableItem.retainage_required,
        retainage_percent: billableItem.retainage_percent,
        retainage_amount: billableItem.retainage_amount,
        retainage_release_condition: billableItem.retainage_release_condition,
        net_billable_amount: billableItem.net_billable_amount,
      },
      readiness: {
        readiness_score: billableItem.readiness_score,
        readiness_status: billableItem.readiness_status,
        readiness_band: billableItem.readiness_band,
      },
      warnings: this.billableWarnings(billableItem),
      blockers: this.billableBlockers(billableItem),
      required_override_fields: this.billableRequiredOverrideFields(billableItem),
      recommended_next_action: this.billableNextAction(billableItem),
      timeline_available: true,
      audit_allowed: true,
    };
  }

  private async billableContextFromQcReview(client: PoolClient, tenantId: string, qcReviewId: string) {
    const qcReview = await this.requireRecord(client, "qc_reviews", tenantId, qcReviewId, "qc review not found");
    const productionRecord = await this.requireRecord(client, "production_records", tenantId, String(qcReview.production_record_id), "production record not found");
    const workOrder = await this.requireRecord(client, "work_orders", tenantId, String(qcReview.work_order_id), "work order not found");
    const project = await this.requireRecord(client, "projects", tenantId, String(qcReview.project_id), "project not found");
    if (productionRecord.work_order_id !== workOrder.id || productionRecord.project_id !== project.id || workOrder.project_id !== project.id) throw new BadRequestException("billable source relationships are inconsistent");
    return { qcReview, productionRecord, workOrder, project };
  }

  private async billableRateContext(client: PoolClient, tenantId: string, body: Record<string, unknown>, unit: string) {
    let rateCodeId = typeof body.rate_code_id === "string" && body.rate_code_id ? body.rate_code_id : undefined;
    let rateDescription = typeof body.rate_description === "string" ? body.rate_description : undefined;
    let unitRate = body.unit_rate === undefined || body.unit_rate === null || body.unit_rate === "" ? undefined : this.requireNonNegative(body.unit_rate, "unit_rate");
    let rateSource = this.optionalAllowed(body.rate_source, billableRateSources, "rate_source") ?? "unknown";
    let rateConfidence = this.optionalAllowed(body.rate_confidence, billableRateConfidences, "rate_confidence") ?? "unknown";
    if (rateCodeId) {
      const rateCode = await this.requireActiveRateCode(client, tenantId, rateCodeId, unit);
      rateDescription = rateDescription ?? rateCode.description ?? rateCode.code;
      unitRate = unitRate ?? Number(rateCode.customer_rate ?? rateCode.amount);
      rateSource = rateSource === "unknown" ? "contract_rate" : rateSource;
      rateConfidence = rateConfidence === "unknown" ? "confirmed" : rateConfidence;
    }
    const billableQuantity = Number(body.billable_quantity ?? 0);
    return {
      rateCodeId,
      rateDescription,
      unitRate,
      rateSource,
      rateConfidence,
      estimatedBillableAmount: this.billableEstimatedAmount(billableQuantity, unitRate),
    };
  }

  private billableEstimatedAmount(billableQuantity: unknown, unitRate: unknown) {
    const quantity = Number(billableQuantity);
    const rate = Number(unitRate);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate)) return undefined;
    return Number((quantity * rate).toFixed(2));
  }

  private billableRetainage(body: Record<string, unknown>, billableQuantity: number, estimatedBillableAmount: number | undefined) {
    const retainageRequired = Boolean(body.retainage_required);
    const retainagePercent = body.retainage_percent === undefined || body.retainage_percent === null || body.retainage_percent === "" ? undefined : this.requireNonNegative(body.retainage_percent, "retainage_percent");
    if (retainagePercent !== undefined && retainagePercent > 100) throw new BadRequestException("retainage_percent must be <= 100");
    const baseAmount = Number(estimatedBillableAmount ?? 0);
    const retainageAmount = retainageRequired && retainagePercent !== undefined && Number.isFinite(baseAmount) ? Number((baseAmount * (retainagePercent / 100)).toFixed(2)) : undefined;
    const netBillableAmount = estimatedBillableAmount === undefined ? undefined : Number((estimatedBillableAmount - Number(retainageAmount ?? 0)).toFixed(2));
    return { retainageRequired, retainagePercent, retainageAmount, netBillableAmount, billableQuantity };
  }

  private mapBillableAcceptance(status: unknown) {
    if (status === "accepted" || status === "rejected" || status === "correction_required" || status === "pending" || status === "not_required") return status;
    return "not_required";
  }

  private mapBillablePackageStatus(status: unknown) {
    if (status === "sufficient") return "ready";
    if (status === "insufficient") return "incomplete";
    if (status === "pending") return "incomplete";
    return "not_started";
  }

  private deriveBillableState(row: Record<string, any>, options: { preserveStatus?: boolean } = {}) {
    const checks = [
      row.qc_review_status === undefined || row.qc_review_status === "approved",
      row.production_record_status === undefined || row.production_record_status === "approved",
      Boolean(row.work_order_id),
      Boolean(row.project_id),
      Number(row.billable_quantity ?? 0) > 0,
      Number(row.billable_quantity ?? 0) <= Number(row.approved_quantity ?? 0) || this.hasOverride(row.override_reasons, "billable_quantity_override_reason"),
      Boolean(row.unit),
      this.billableRateKnown(row) || this.hasOverride(row.override_reasons, "rate_override_reason"),
      this.packageReady(row.billing_package_status) || this.hasOverride(row.override_reasons, "billing_package_override_reason"),
      this.packageReady(row.documentation_status) || this.hasOverride(row.override_reasons, "documentation_override_reason"),
      this.acceptanceReviewed(row.customer_acceptance_status),
      this.acceptanceReviewed(row.prime_acceptance_status),
      !row.dispute_reason && row.status !== "disputed",
      !row.hold_reason && row.status !== "held",
      !["voided", "archived"].includes(String(row.status)),
      !row.settlement_item_id,
    ];
    let score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
    if (row.qc_review_status !== undefined && row.qc_review_status !== "approved") score = Math.min(score, 39);
    if (row.production_record_status !== undefined && row.production_record_status !== "approved") score = Math.min(score, 39);
    if (Number(row.billable_quantity ?? 0) <= 0) score = Math.min(score, 39);
    if (Number(row.billable_quantity ?? 0) > Number(row.approved_quantity ?? 0) && !this.hasOverride(row.override_reasons, "billable_quantity_override_reason")) score = Math.min(score, 39);
    if (["rejected", "correction_required", "disputed"].includes(String(row.customer_acceptance_status)) || ["rejected", "correction_required", "disputed"].includes(String(row.prime_acceptance_status))) score = Math.min(score, 69);
    if (!this.billableRateKnown(row)) score = Math.min(score, 69);
    if (!this.packageReady(row.billing_package_status) || !this.packageReady(row.documentation_status)) score = Math.min(score, 84);
    if (row.customer_acceptance_status === "pending" || row.prime_acceptance_status === "pending") score = Math.min(score, 84);
    if (row.status === "held" || row.status === "disputed" || row.hold_reason || row.dispute_reason) score = Math.min(score, 69);
    const readiness_band = score >= 85 ? "ready_for_settlement" : score >= 70 ? "ready_with_warning" : score >= 40 ? "needs_review" : "not_ready";
    const readiness_status = this.billableBlockers({ ...row, readiness_score: score }).length ? "blocked" : score >= 85 ? "ready_for_settlement" : score >= 70 ? "ready_with_warning" : score >= 40 ? "needs_review" : "not_ready";
    let status = row.status;
    if (!options.preserveStatus && !["held", "disputed", "voided", "archived", "ready_for_settlement", "settlement_created"].includes(String(row.status))) {
      if (!this.billableRateKnown(row)) status = "needs_rate";
      else if (!this.packageReady(row.billing_package_status) || !this.packageReady(row.documentation_status)) status = "needs_documentation";
      else if (row.customer_acceptance_status === "pending" || row.prime_acceptance_status === "pending") status = "needs_customer_acceptance";
      else status = "candidate";
    }
    return { status, readiness_score: score, readiness_status, readiness_band };
  }

  private billableRateKnown(row: Record<string, any>) {
    return row.rate_source !== "unknown" && row.unit_rate !== undefined && row.unit_rate !== null;
  }

  private packageReady(status: unknown) {
    return status === "ready" || status === "accepted_later";
  }

  private acceptanceReviewed(status: unknown) {
    return status === "not_required" || status === "accepted";
  }

  private billableWarnings(row: Record<string, any>) {
    const warnings = [];
    if (!this.billableRateKnown(row)) warnings.push({ warning_type: "rate_unknown", severity: "high", message: "Rate is unknown.", required_override_field: "rate_override_reason" });
    if (row.rate_source === "manual_rate") warnings.push({ warning_type: "manual_rate", severity: "medium", message: "Manual rate requires audit." });
    if (!this.packageReady(row.billing_package_status)) warnings.push({ warning_type: "billing_package_incomplete", severity: "medium", message: "Billing package is incomplete.", required_override_field: "billing_package_override_reason" });
    if (!this.packageReady(row.documentation_status)) warnings.push({ warning_type: "documentation_incomplete", severity: "medium", message: "Documentation is incomplete.", required_override_field: "documentation_override_reason" });
    if (row.customer_acceptance_status === "pending") warnings.push({ warning_type: "customer_acceptance_pending", severity: "medium", message: "Customer acceptance is pending.", required_override_field: "customer_acceptance_override_reason" });
    if (row.prime_acceptance_status === "pending") warnings.push({ warning_type: "prime_acceptance_pending", severity: "medium", message: "Prime acceptance is pending.", required_override_field: "prime_acceptance_override_reason" });
    if (row.retainage_required) warnings.push({ warning_type: "retainage_applies", severity: "low", message: "Retainage applies." });
    if (Number(row.held_quantity ?? 0) > 0) warnings.push({ warning_type: "partial_quantity_held", severity: "medium", message: "Some approved quantity is held." });
    if (row.dispute_reason) warnings.push({ warning_type: "provider_dispute", severity: "high", message: "Billable item is disputed." });
    if (Number(row.billable_quantity ?? 0) !== Number(row.approved_quantity ?? 0)) warnings.push({ warning_type: "quantity_mismatch", severity: "medium", message: "Billable quantity differs from approved quantity." });
    if (row.work_order_status && row.work_order_status !== "billable") warnings.push({ warning_type: "work_order_not_billable", severity: "low", message: "Work order is not marked billable." });
    if (row.override_reasons && Object.keys(row.override_reasons).length) warnings.push({ warning_type: "manual_override_present", severity: "medium", message: "Manual override is present." });
    return warnings;
  }

  private billableBlockers(row: Record<string, any>) {
    const blockers = [];
    if (row.qc_review_status !== undefined && row.qc_review_status !== "approved") blockers.push({ blocker_type: "no_approved_qc", severity: "critical", message: "Approved QC review is required." });
    if (row.production_record_status !== undefined && row.production_record_status !== "approved") blockers.push({ blocker_type: "no_approved_production", severity: "critical", message: "Approved production is required." });
    if (Number(row.billable_quantity ?? 0) <= 0) blockers.push({ blocker_type: "no_billable_quantity", severity: "critical", message: "Billable quantity is required." });
    if (Number(row.billable_quantity ?? 0) > Number(row.approved_quantity ?? 0) && !this.hasOverride(row.override_reasons, "billable_quantity_override_reason")) blockers.push({ blocker_type: "billable_exceeds_approved_without_override", severity: "critical", message: "Billable quantity exceeds approved quantity." });
    if (["rejected", "correction_required", "disputed"].includes(String(row.customer_acceptance_status))) blockers.push({ blocker_type: row.customer_acceptance_status === "rejected" ? "customer_rejected" : row.customer_acceptance_status === "correction_required" ? "correction_required" : "hard_stop_dispute", severity: "high", message: "Customer acceptance blocks settlement readiness." });
    if (["rejected", "correction_required", "disputed"].includes(String(row.prime_acceptance_status))) blockers.push({ blocker_type: row.prime_acceptance_status === "rejected" ? "prime_rejected" : row.prime_acceptance_status === "correction_required" ? "correction_required" : "hard_stop_dispute", severity: "high", message: "Prime acceptance blocks settlement readiness." });
    if (row.status === "voided") blockers.push({ blocker_type: "voided_billable_item", severity: "critical", message: "Voided Billable item is view-only." });
    if (row.status === "archived" || row.archived_at) blockers.push({ blocker_type: "archived_source_record", severity: "critical", message: "Archived Billable item is view-only." });
    if (row.settlement_item_id) blockers.push({ blocker_type: "settlement_already_created", severity: "critical", message: "Settlement item is already linked." });
    if (row.status === "held" || row.hold_reason) blockers.push({ blocker_type: "executive_hold", severity: "high", message: "Billable item is held." });
    if (row.status === "disputed" || row.dispute_reason) blockers.push({ blocker_type: "hard_stop_dispute", severity: "high", message: "Billable item is disputed." });
    return blockers;
  }

  private billableRequiredOverrideFields(row: Record<string, any>) {
    const fields = new Set<string>();
    for (const warning of this.billableWarnings(row)) {
      if (warning.required_override_field) fields.add(warning.required_override_field);
    }
    return Array.from(fields);
  }

  private assertBillableOverrides(row: Record<string, any>, overrides: unknown) {
    const missing = this.billableRequiredOverrideFields(row).filter((field) => !this.hasOverride(overrides, field));
    if (missing.length) throw new BadRequestException({ message: "Billable warnings require override reasons.", warnings: this.billableWarnings(row), required_override_fields: missing });
  }

  private billableNextAction(row: Record<string, any>) {
    if (row.status === "archived") return "view_only";
    if (row.status === "voided") return "view_voided_item";
    if (this.billableBlockers(row).length) return "resolve_blockers";
    if (row.status === "disputed") return "resolve_dispute";
    if (row.status === "held") return "release_or_review_hold";
    if (row.readiness_score === undefined || row.readiness_score === null) return "recalculate_readiness";
    if (!this.billableRateKnown(row)) return "add_rate";
    if (!this.packageReady(row.billing_package_status)) return "complete_billing_package";
    if (row.customer_acceptance_status === "pending" || row.prime_acceptance_status === "pending") return "review_acceptance";
    if (Number(row.readiness_score) >= 85) return "mark_ready_for_settlement";
    return "continue_billable_review";
  }

  private async syncBillableSummaries(client: PoolClient, tenantId: string, productionRecordId: string, workOrderId: string, actorUserId: string) {
    const productionSummary = await client.query(
      `
      SELECT COALESCE(sum(billable_quantity) FILTER (WHERE status NOT IN ('voided', 'archived') AND deleted_at IS NULL), 0)::numeric AS billable_quantity,
        bool_or(status = 'ready_for_settlement') AS ready_for_settlement,
        bool_or(status IN ('candidate', 'needs_rate', 'needs_documentation', 'needs_customer_acceptance', 'ready_for_settlement')) AS has_active
      FROM billable_items
      WHERE tenant_id = $1 AND production_record_id = $2
      `,
      [tenantId, productionRecordId],
    );
    const productionStatus = productionSummary.rows[0]?.ready_for_settlement ? "billable" : productionSummary.rows[0]?.has_active ? "billable_candidate" : "not_billable";
    await updateTenantRecord(client, "production_records", tenantId, productionRecordId, {
      billable_status: productionStatus,
      billable_quantity: Number(productionSummary.rows[0]?.billable_quantity ?? 0),
      updated_by: actorUserId,
    });
    const workOrderSummary = await client.query(
      `
      SELECT COALESCE(sum(billable_quantity) FILTER (WHERE status NOT IN ('voided', 'archived') AND deleted_at IS NULL), 0)::numeric AS billable_quantity,
        bool_or(status = 'ready_for_settlement') AS ready_for_settlement,
        bool_or(status IN ('candidate', 'needs_rate', 'needs_documentation', 'needs_customer_acceptance', 'ready_for_settlement')) AS has_active
      FROM billable_items
      WHERE tenant_id = $1 AND work_order_id = $2
      `,
      [tenantId, workOrderId],
    );
    const workOrderBillableStatus = workOrderSummary.rows[0]?.ready_for_settlement ? "billable" : workOrderSummary.rows[0]?.has_active ? "pending_approval" : "not_billable";
    await updateTenantRecord(client, "work_orders", tenantId, workOrderId, {
      billable_status: workOrderBillableStatus,
      billable_quantity: Number(workOrderSummary.rows[0]?.billable_quantity ?? 0),
      updated_by: actorUserId,
    });
  }

  private async billableStatusAction(request: AuthenticatedRequest, id: string, action: string, eventType: string, values: Record<string, unknown>, reason: string) {
    return this.write(request, action, eventType, "billable_item", async (client) => {
      const before = await this.requireRecord(client, "billable_items", request.auth.tenantId, id, "billable item not found");
      if (["archived", "voided"].includes(String(before.status))) throw new BadRequestException("archived or voided billable items are view-only");
      const after = await updateTenantRecord(client, "billable_items", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("billable item not found");
      await this.syncBillableSummaries(client, request.auth.tenantId, String(after.production_record_id), String(after.work_order_id), request.auth.userId);
      return { entityType: "billable_item", entityId: id, beforeState: before, afterState: await this.billableItemDetail(client, request.auth.tenantId, id) };
    }, reason);
  }

  private async listProductionRecordsEnriched(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const conditions = ["pr.tenant_id = $1", "pr.deleted_at IS NULL"];
    const params: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    if (query.archived !== "true") conditions.push("pr.status <> 'archived'");
    if (query.id) add("pr.id = ?", query.id);
    if (query.project_id) add("pr.project_id = ?", query.project_id);
    if (query.work_order_id) add("pr.work_order_id = ?", query.work_order_id);
    if (query.production_type) add("pr.production_type = ?", query.production_type);
    if (query.status) add("pr.status = ?", query.status);
    if (query.qc_status) add("pr.qc_status = ?", query.qc_status);
    if (query.billable_status) add("pr.billable_status = ?", query.billable_status);
    if (query.production_date_from) add("pr.production_date >= ?", query.production_date_from);
    if (query.production_date_to) add("pr.production_date <= ?", query.production_date_to);
    if (query.capacity_provider_id) add("pr.capacity_provider_id = ?", query.capacity_provider_id);
    if (query.crew_id) add("pr.crew_id = ?", query.crew_id);
    if (query.foreman_user_id) add("pr.foreman_user_id = ?", query.foreman_user_id);
    if (query.submitted_by) add("COALESCE(pr.submitted_by, pr.submitted_by_user_id) = ?", query.submitted_by);
    if (query.territory_id) add("wo.territory_id = ?", query.territory_id);
    if (query.work_type) add("wo.work_type = ?", query.work_type);
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(`(pr.description ILIKE $${params.length} OR pr.production_notes ILIKE $${params.length} OR pr.location_summary ILIKE $${params.length} OR pr.route_name ILIKE $${params.length} OR pr.node_id ILIKE $${params.length} OR pr.segment_id ILIKE $${params.length} OR wo.work_order_name ILIKE $${params.length} OR wo.work_order_number ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }
    const orderBy = query.sort === "production_date_asc" ? "pr.production_date ASC, pr.updated_at DESC" : query.sort === "status" ? "pr.status ASC, pr.updated_at DESC" : query.sort === "work_order" ? "wo.work_order_name ASC NULLS LAST, pr.updated_at DESC" : query.sort === "project" ? "p.name ASC NULLS LAST, pr.updated_at DESC" : query.sort === "provider" ? "cp.name ASC NULLS LAST, pr.updated_at DESC" : query.sort === "crew" ? "c.name ASC NULLS LAST, pr.updated_at DESC" : query.sort === "updated_desc" ? "pr.updated_at DESC" : "pr.production_date DESC, pr.updated_at DESC";
    const result = await client.query(
      `
      WITH evidence_counts AS (
        SELECT production_record_id, count(*)::int AS evidence_count
        FROM production_evidence
        WHERE tenant_id = $1 AND deleted_at IS NULL AND status <> 'archived'
        GROUP BY production_record_id
      )
      SELECT pr.id, pr.production_type, pr.status, pr.qc_status, pr.billable_status, pr.production_date,
        pr.project_id, p.name AS project_name, pr.work_order_id, wo.work_order_name, wo.title AS work_order_title, wo.status AS work_order_status,
        p.customer_organization_id, co.name AS customer_organization_name, wo.territory_id, t.name AS territory_name, wo.work_type,
        pr.capacity_provider_id, cp.name AS capacity_provider_name, pr.crew_id, c.name AS crew_name,
        pr.foreman_user_id, fu.display_name AS foreman_name,
        COALESCE(pr.submitted_by, pr.submitted_by_user_id) AS submitted_by, su.display_name AS submitted_by_name,
        COALESCE(pr.claimed_quantity, pr.quantity_submitted, pr.quantity) AS claimed_quantity,
        pr.accepted_quantity, pr.approved_quantity, pr.rejected_quantity, pr.corrected_quantity, pr.billable_quantity,
        pr.rejection_reason, pr.rejection_note, pr.rejected_at, pr.rejected_by,
        pr.correction_reason, pr.correction_note, pr.correction_required_at, pr.correction_required_by,
        pr.correction_due_date, pr.correction_owner_user_id,
        pr.void_reason, pr.void_note, pr.archived_by, pr.archive_reason, pr.archive_note,
        COALESCE(pr.unit, pr.unit_type) AS unit, pr.location_summary, pr.description, pr.production_notes,
        COALESCE(ec.evidence_count, 0) AS evidence_count,
        (pr.status = 'correction_required') AS correction_required,
        (p.status IN ('ready_for_work', 'active') AND wo.status IN ('assigned', 'scheduled', 'in_progress')) AS production_eligible_context,
        pr.created_at, pr.updated_at, pr.archived_at
      FROM production_records pr
      JOIN work_orders wo ON wo.tenant_id = pr.tenant_id AND wo.id = pr.work_order_id
      JOIN projects p ON p.tenant_id = pr.tenant_id AND p.id = pr.project_id
      LEFT JOIN organizations co ON co.tenant_id = p.tenant_id AND co.id = p.customer_organization_id
      LEFT JOIN territories t ON t.tenant_id = wo.tenant_id AND t.id = wo.territory_id
      LEFT JOIN capacity_providers cp ON cp.tenant_id = pr.tenant_id AND cp.id = pr.capacity_provider_id
      LEFT JOIN crews c ON c.tenant_id = pr.tenant_id AND c.id = pr.crew_id
      LEFT JOIN users fu ON fu.id = pr.foreman_user_id
      LEFT JOIN users su ON su.id = COALESCE(pr.submitted_by, pr.submitted_by_user_id)
      LEFT JOIN evidence_counts ec ON ec.production_record_id = pr.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 200
      `,
      params,
    );
    return result.rows.map((row) => ({ ...row, warnings: this.productionWarnings(row), blockers: this.productionBlockers(row), recommended_next_action: this.productionNextAction(row) }));
  }

  private async productionRecordRow(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.listProductionRecordsEnriched(client, tenantId, { archived: "true", id });
    const row = rows[0];
    if (!row) throw new NotFoundException("production record not found");
    return row;
  }

  private async productionRecordDetail(client: PoolClient, tenantId: string, id: string) {
    const productionRecord = await this.productionRecordRow(client, tenantId, id);
    const evidence = await client.query("SELECT * FROM production_evidence WHERE tenant_id = $1 AND production_record_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [tenantId, id]);
    return {
      ...productionRecord,
      production_record: productionRecord,
      project_context: await this.optionalRecord(client, "projects", tenantId, productionRecord.project_id),
      work_order_context: await this.optionalRecord(client, "work_orders", tenantId, productionRecord.work_order_id),
      performer_context: {
        capacity_provider_id: productionRecord.capacity_provider_id,
        capacity_provider_name: productionRecord.capacity_provider_name,
        crew_id: productionRecord.crew_id,
        crew_name: productionRecord.crew_name,
        foreman_user_id: productionRecord.foreman_user_id,
        foreman_name: productionRecord.foreman_name,
        submitted_by: productionRecord.submitted_by,
        submitted_by_name: productionRecord.submitted_by_name,
      },
      evidence: evidence.rows,
      correction_context: {
        correction_required: productionRecord.correction_required,
        correction_reason: productionRecord.correction_reason,
        corrected_quantity: productionRecord.corrected_quantity,
      },
      quantity_summary: {
        claimed_quantity: productionRecord.claimed_quantity,
        approved_quantity: productionRecord.approved_quantity,
        accepted_quantity: productionRecord.accepted_quantity,
        rejected_quantity: productionRecord.rejected_quantity,
        corrected_quantity: productionRecord.corrected_quantity,
        billable_quantity: productionRecord.billable_quantity,
        unit: productionRecord.unit,
      },
      qc_summary: { qc_status: productionRecord.qc_status, status: productionRecord.status },
      billable_summary: { billable_status: productionRecord.billable_status, billable_quantity: productionRecord.billable_quantity },
      warnings: this.productionWarnings(productionRecord),
      blockers: this.productionBlockers(productionRecord),
      recommended_next_action: this.productionNextAction(productionRecord),
      timeline_available: true,
      audit_allowed: true,
    };
  }

  private productionWarnings(row: Record<string, any>) {
    const warnings = [];
    if (!row.evidence_count) warnings.push({ warning_type: "missing_evidence", severity: "medium", message: "production evidence is not attached", required_override_field: "evidence_override_reason", related_object_type: "production_record", related_object_id: row.id });
    if (!row.capacity_provider_id && !row.crew_id && !row.foreman_user_id && !row.submitted_by) warnings.push({ warning_type: "missing_performer_context", severity: "high", message: "performer context is missing", required_override_field: "performer_override_reason", related_object_type: "production_record", related_object_id: row.id });
    if (!row.production_eligible_context && ["draft", "submitted"].includes(row.status)) warnings.push({ warning_type: "production_context_not_eligible", severity: "medium", message: "project/work order production context is not fully eligible", required_override_field: "production_eligibility_override_reason", related_object_type: "production_record", related_object_id: row.id });
    return warnings;
  }

  private productionBlockers(row: Record<string, any>) {
    const blockers = [];
    if (["archived", "voided"].includes(row.status)) blockers.push({ blocker_type: `production_${row.status}`, severity: "critical", message: `production record is ${row.status}`, related_object_type: "production_record", related_object_id: row.id });
    if (["closed", "cancelled", "archived", "billable"].includes(row.work_order_status)) blockers.push({ blocker_type: "work_order_not_open", severity: "critical", message: "work order is closed, cancelled, archived, or billable", related_object_type: "work_order", related_object_id: row.work_order_id });
    return blockers;
  }

  private productionNextAction(row: Record<string, any>) {
    if (row.status === "archived") return "view_only";
    if (row.status === "draft") return "submit_production";
    if (row.status === "submitted") return "start_review";
    if (["under_review", "qc_review"].includes(row.status)) return "approve_reject_or_request_correction";
    if (row.status === "correction_required") return "submit_correction";
    if (row.status === "corrected") return "restart_review";
    if (row.status === "approved" && row.billable_status !== "billable") return "mark_billable_candidate";
    if (["approved", "billable"].includes(row.status) && row.billable_status === "billable") return "ready_for_future_settlement";
    if (row.status === "rejected") return "review_rejection";
    if (row.status === "voided") return "view_voided_record";
    return "review_production";
  }

  private async listWorkOrdersEnriched(client: PoolClient, tenantId: string, query: Record<string, string | undefined>): Promise<Array<Record<string, any>>> {
    const conditions = ["wo.tenant_id = $1", "wo.deleted_at IS NULL"];
    const params: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    if (query.archived !== "true") conditions.push("wo.status <> 'archived'");
    if (query.id) add("wo.id = ?", query.id);
    if (query.project_id) add("wo.project_id = ?", query.project_id);
    if (query.status) add("wo.status = ?", this.normalizeWorkOrderStatus(query.status));
    if (query.normalized_status) add("wo.status = ?", this.normalizeWorkOrderStatus(query.normalized_status));
    if (query.readiness_status) add("wo.readiness_status = ?", query.readiness_status);
    if (query.qc_status) add("wo.qc_status = ?", query.qc_status);
    if (query.billable_status) add("wo.billable_status = ?", query.billable_status);
    if (query.territory_id) add("wo.territory_id = ?", query.territory_id);
    if (query.work_type) add("wo.work_type = ?", query.work_type);
    if (query.assigned_capacity_provider_id) add("wo.assigned_capacity_provider_id = ?", query.assigned_capacity_provider_id);
    if (query.assigned_crew_id) add("wo.assigned_crew_id = ?", query.assigned_crew_id);
    if (query.assignment_type) add("wo.assignment_type = ?", query.assignment_type);
    if (query.production_eligible === "true") conditions.push("wo.status IN ('assigned', 'scheduled', 'in_progress') AND p.status IN ('ready_for_work', 'active')");
    if (query.production_eligible === "false") conditions.push("NOT (wo.status IN ('assigned', 'scheduled', 'in_progress') AND p.status IN ('ready_for_work', 'active'))");
    if (query.planned_start_from) add("wo.planned_start_date >= ?", query.planned_start_from);
    if (query.planned_start_to) add("wo.planned_start_date <= ?", query.planned_start_to);
    if (query.scheduled_start_from) add("wo.scheduled_start_date >= ?", query.scheduled_start_from);
    if (query.scheduled_start_to) add("wo.scheduled_start_date <= ?", query.scheduled_start_to);
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(`(wo.work_order_name ILIKE $${params.length} OR wo.title ILIKE $${params.length} OR wo.work_order_number ILIKE $${params.length} OR wo.customer_work_order_number ILIKE $${params.length} OR wo.prime_work_order_number ILIKE $${params.length} OR wo.scope_summary ILIKE $${params.length} OR wo.location_summary ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }
    const orderBy = query.sort === "planned_start_asc" ? "wo.planned_start_date ASC NULLS LAST, wo.updated_at DESC" : query.sort === "scheduled_start_asc" ? "wo.scheduled_start_date ASC NULLS LAST, wo.updated_at DESC" : query.sort === "readiness_desc" ? "wo.readiness_score DESC NULLS LAST, wo.updated_at DESC" : query.sort === "readiness_asc" ? "wo.readiness_score ASC NULLS FIRST, wo.updated_at DESC" : query.sort === "status" ? "wo.status ASC, wo.updated_at DESC" : query.sort === "project" ? "p.name ASC, wo.updated_at DESC" : query.sort === "assigned_provider" ? "cp.name ASC NULLS LAST, wo.updated_at DESC" : "wo.readiness_score ASC NULLS FIRST, wo.scheduled_start_date ASC NULLS LAST, wo.updated_at DESC";
    const result = await client.query(
      `
      WITH production_counts AS (
        SELECT work_order_id, count(*)::int AS production_record_count
        FROM production_records
        WHERE tenant_id = $1 AND deleted_at IS NULL
        GROUP BY work_order_id
      ),
      constraint_counts AS (
        SELECT affected_object_id AS work_order_id,
          count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived'))::int AS open_constraints_count,
          count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived') AND COALESCE(hard_stop, false))::int AS hard_stop_constraints_count
        FROM constraints
        WHERE tenant_id = $1 AND affected_object_type = 'work_order' AND deleted_at IS NULL
        GROUP BY affected_object_id
      ),
      evidence_counts AS (
        SELECT pr.work_order_id, count(pe.id)::int AS evidence_count
        FROM production_records pr
        JOIN production_evidence pe ON pe.tenant_id = pr.tenant_id AND pe.production_record_id = pr.id AND pe.deleted_at IS NULL
        WHERE pr.tenant_id = $1 AND pr.deleted_at IS NULL
        GROUP BY pr.work_order_id
      )
      SELECT wo.id, wo.coverage_plan_id, wo.coverage_requirement_id, wo.coverage_source_id, wo.work_order_name, wo.title,
        wo.work_order_number, wo.customer_work_order_number, wo.prime_work_order_number,
        wo.project_id, p.name AS project_name, p.status AS project_status, p.customer_organization_id, co.name AS customer_organization_name,
        wo.territory_id, t.name AS territory_name, wo.work_type, wo.status, wo.status AS normalized_status,
        wo.readiness_status, wo.readiness_score, wo.readiness_band, wo.qc_status, wo.billable_status,
        wo.planned_quantity, wo.completed_quantity, wo.approved_quantity, wo.billable_quantity, wo.unit,
        wo.scope_summary, wo.location_summary, wo.planned_start_date, wo.planned_end_date, wo.scheduled_start_date, wo.scheduled_end_date, wo.actual_start_date, wo.actual_end_date,
        wo.documentation_requirements, wo.production_requirements, wo.customer_validation_requirements, wo.billing_package_requirements,
        wo.assignment_type, wo.assigned_organization_id, ao.name AS assigned_organization_name,
        wo.assigned_capacity_provider_id, cp.name AS assigned_capacity_provider_name,
        wo.assigned_crew_id, c.name AS assigned_crew_name, wo.assigned_equipment_id, wo.assigned_by, wo.assigned_at, wo.assignment_note,
        wo.owner_user_id, ou.display_name AS owner_name, wo.field_supervisor_user_id, fs.display_name AS field_supervisor_name,
        wo.archived_at, wo.created_at, wo.updated_at,
        COALESCE(pc.production_record_count, 0) AS production_record_count,
        COALESCE(cc.open_constraints_count, 0) AS open_constraints_count,
        COALESCE(ec.evidence_count, 0) AS evidence_count,
        COALESCE(cc.hard_stop_constraints_count, 0) AS hard_stop_constraints_count
      FROM work_orders wo
      JOIN projects p ON p.tenant_id = wo.tenant_id AND p.id = wo.project_id
      LEFT JOIN organizations co ON co.tenant_id = p.tenant_id AND co.id = p.customer_organization_id
      LEFT JOIN organizations ao ON ao.tenant_id = wo.tenant_id AND ao.id = wo.assigned_organization_id
      LEFT JOIN territories t ON t.tenant_id = wo.tenant_id AND t.id = wo.territory_id
      LEFT JOIN capacity_providers cp ON cp.tenant_id = wo.tenant_id AND cp.id = wo.assigned_capacity_provider_id
      LEFT JOIN crews c ON c.tenant_id = wo.tenant_id AND c.id = wo.assigned_crew_id
      LEFT JOIN users ou ON ou.id = wo.owner_user_id
      LEFT JOIN users fs ON fs.id = wo.field_supervisor_user_id
      LEFT JOIN production_counts pc ON pc.work_order_id = wo.id
      LEFT JOIN constraint_counts cc ON cc.work_order_id = wo.id
      LEFT JOIN evidence_counts ec ON ec.work_order_id = wo.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 200
      `,
      params,
    );
    const rows = await Promise.all(result.rows.map((row) => this.withWorkOrderDerived(client, tenantId, row.id, row)));
    if (query.has_blockers === "true") return rows.filter((row) => row.blockers.length > 0);
    if (query.has_blockers === "false") return rows.filter((row) => row.blockers.length === 0);
    if (query.has_warnings === "true") return rows.filter((row) => row.warnings.length > 0);
    if (query.has_warnings === "false") return rows.filter((row) => row.warnings.length === 0);
    return rows;
  }

  private async workOrderRow(client: PoolClient, tenantId: string, id: string): Promise<Record<string, any>> {
    const result = await client.query("SELECT 1 FROM work_orders WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("work order not found");
    const rows = await this.listWorkOrdersEnriched(client, tenantId, { archived: "true", id });
    const row = rows.find((item) => item.id === id);
    if (!row) throw new NotFoundException("work order not found");
    return row;
  }

  private async workOrderDetail(client: PoolClient, tenantId: string, id: string) {
    const workOrder = (await this.workOrderRow(client, tenantId, id)) as Record<string, any>;
    const readiness = await this.calculateWorkOrderReadiness(client, tenantId, id, workOrder);
    const workOrderWithReadiness = { ...workOrder, warnings: readiness.warnings, blockers: readiness.blockers, required_override_fields: readiness.required_override_fields, production_eligible: readiness.production_eligible, recommended_next_action: this.workOrderNextAction(workOrder, readiness) };
    const detail = {
      work_order: { ...workOrder, warnings: readiness.warnings, blockers: readiness.blockers, required_override_fields: readiness.required_override_fields, production_eligible: readiness.production_eligible, recommended_next_action: this.workOrderNextAction(workOrder, readiness) },
      project_context: await this.optionalRecord(client, "projects", tenantId, workOrder.project_id),
      coverage_context: {
        coverage_plan: workOrder.coverage_plan_id ? await this.optionalRecord(client, "coverage_plans", tenantId, workOrder.coverage_plan_id) : null,
        coverage_requirement: workOrder.coverage_requirement_id ? await this.optionalRecord(client, "coverage_requirements", tenantId, workOrder.coverage_requirement_id) : null,
        coverage_source: workOrder.coverage_source_id ? await this.optionalRecord(client, "coverage_sources", tenantId, workOrder.coverage_source_id) : null,
      },
      assignment_context: {
        assignment_type: workOrder.assignment_type,
        assigned_organization_id: workOrder.assigned_organization_id,
        assigned_organization_name: workOrder.assigned_organization_name,
        assigned_capacity_provider_id: workOrder.assigned_capacity_provider_id,
        assigned_capacity_provider_name: workOrder.assigned_capacity_provider_name,
        assigned_crew_id: workOrder.assigned_crew_id,
        assigned_crew_name: workOrder.assigned_crew_name,
        assigned_equipment_id: workOrder.assigned_equipment_id,
        assigned_by: workOrder.assigned_by,
        assigned_at: workOrder.assigned_at,
        assignment_note: workOrder.assignment_note,
      },
      readiness,
      warnings: readiness.warnings,
      blockers: readiness.blockers,
      quantity_summary: { planned_quantity: workOrder.planned_quantity, completed_quantity: workOrder.completed_quantity, approved_quantity: workOrder.approved_quantity, billable_quantity: workOrder.billable_quantity, unit: workOrder.unit },
      production_summary: { production_record_count: workOrder.production_record_count ?? 0 },
      qc_summary: { qc_status: workOrder.qc_status },
      billable_summary: { billable_status: workOrder.billable_status },
      constraints_summary: { open_constraints_count: workOrder.open_constraints_count ?? 0, hard_stop_constraints_count: workOrder.hard_stop_constraints_count ?? 0 },
      timeline_available: true,
      audit_allowed: true,
    };
    return { ...workOrderWithReadiness, ...detail };
  }

  private async withWorkOrderDerived(client: PoolClient, tenantId: string, id: string, row: Record<string, any>): Promise<Record<string, any>> {
    const readiness = await this.calculateWorkOrderReadiness(client, tenantId, id, row);
    return { ...row, normalized_status: this.normalizeWorkOrderStatus(row.status), warnings: readiness.warnings, blockers: readiness.blockers, required_override_fields: readiness.required_override_fields, production_eligible: readiness.production_eligible, recommended_next_action: this.workOrderNextAction(row, readiness) };
  }

  private async calculateWorkOrderReadiness(client: PoolClient, tenantId: string, workOrderId: string, workOrder: Record<string, any>) {
    const project = await this.optionalRecord(client, "projects", tenantId, String(workOrder.project_id));
    const constraints = await this.workOrderConstraints(client, tenantId, workOrderId);
    const projectReady = project && ["ready_for_work", "active"].includes(project.status);
    const assignmentPresent = Boolean(workOrder.assigned_capacity_provider_id || workOrder.assigned_crew_id || workOrder.assigned_organization_id || workOrder.assigned_equipment_id);
    const assignmentRequired = !["draft", "ready_to_assign"].includes(String(workOrder.status));
    const items = [
      { key: "project_valid", complete: Boolean(project), hard: true },
      { key: "project_ready_or_active", complete: Boolean(projectReady), hard: workOrder.status !== "draft" },
      { key: "scope_summary_present", complete: Boolean(workOrder.scope_summary ?? workOrder.title), hard: true },
      { key: "location_summary_present", complete: Boolean(workOrder.location_summary ?? workOrder.location_description), hard: true },
      { key: "work_type_present", complete: Boolean(workOrder.work_type), hard: true },
      { key: "territory_present", complete: Boolean(workOrder.territory_id), hard: true },
      { key: "planned_quantity_present", complete: Number(workOrder.planned_quantity ?? workOrder.expected_units) >= 0, hard: true },
      { key: "unit_present", complete: Boolean(workOrder.unit ?? workOrder.unit_type), hard: true },
      { key: "assignment_target_present", complete: !assignmentRequired || assignmentPresent, hard: false },
      { key: "schedule_present", complete: Boolean(workOrder.scheduled_start_date || workOrder.planned_start_date), hard: false },
      { key: "coverage_source_linked", complete: Boolean(workOrder.coverage_source_id), hard: false },
      { key: "documentation_requirements_identified", complete: Boolean(workOrder.documentation_requirements), hard: false },
      { key: "hard_stop_constraints_resolved", complete: Number(constraints.hard_stop_constraints_count ?? 0) === 0, hard: true },
    ];
    const completed = items.filter((item) => item.complete).length;
    let score = Math.round((completed / items.length) * 100);
    const blockers = items.filter((item) => !item.complete && item.hard).map((item) => ({ blocker_type: item.key, severity: "high", message: item.key, related_object_type: "work_order", related_object_id: workOrderId }));
    const warnings = items.filter((item) => !item.complete && !item.hard).map((item) => ({ warning_type: item.key, severity: "medium", message: item.key, required_override_field: "readiness_override_reason", related_object_type: "work_order", related_object_id: workOrderId }));
    if (["archived", "cancelled", "closed"].includes(workOrder.status)) blockers.push({ blocker_type: `work_order_${workOrder.status}`, severity: "critical", message: `work order ${workOrder.status}`, related_object_type: "work_order", related_object_id: workOrderId });
    if (!projectReady && workOrder.status !== "draft") score = Math.min(score, 39);
    if (blockers.length || Number(constraints.hard_stop_constraints_count ?? 0) > 0) score = Math.min(score, 39);
    if (assignmentRequired && !assignmentPresent) score = Math.min(score, 69);
    if (warnings.length) score = Math.min(score, 84);
    const band = score >= 85 ? "ready_to_start" : score >= 70 ? "ready_with_risk" : score >= 40 ? "needs_assignment" : "not_ready";
    const readinessStatus = blockers.length ? "blocked" : score >= 85 ? "ready_to_start" : score >= 70 ? "ready_to_assign" : "not_ready";
    const requiredOverrideFields = [...new Set(warnings.map((warning) => warning.required_override_field).filter(Boolean))];
    return { checklist: items, readiness_score: score, readiness_status: readinessStatus, readiness_band: band, warnings, blockers, required_override_fields: requiredOverrideFields, production_eligible: Boolean(projectReady && ["assigned", "scheduled", "in_progress"].includes(workOrder.status) && !blockers.length) };
  }

  private async persistWorkOrderReadiness(client: PoolClient, tenantId: string, id: string, readiness: Record<string, unknown>, actorUserId: string) {
    await updateTenantRecord(client, "work_orders", tenantId, id, {
      readiness_score: readiness.readiness_score,
      readiness_status: readiness.readiness_status,
      readiness_band: readiness.readiness_band,
      updated_by: actorUserId,
    });
  }

  private async workOrderConstraints(client: PoolClient, tenantId: string, workOrderId: string) {
    const result = await client.query(
      `
      SELECT count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived'))::int AS open_constraints_count,
        count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived') AND COALESCE(hard_stop, false))::int AS hard_stop_constraints_count
      FROM constraints
      WHERE tenant_id = $1 AND affected_object_type = 'work_order' AND affected_object_id = $2 AND deleted_at IS NULL
      `,
      [tenantId, workOrderId],
    );
    return result.rows[0] ?? { open_constraints_count: 0, hard_stop_constraints_count: 0 };
  }

  private workOrderNextAction(workOrder: Record<string, any>, readiness: { blockers: unknown[]; readiness_score: number }) {
    if (workOrder.status === "archived") return "view_only";
    if (readiness.blockers.length) return "resolve_blockers";
    if (workOrder.readiness_score === null || workOrder.readiness_score === undefined) return "recalculate_readiness";
    if (workOrder.status === "draft" && readiness.readiness_score >= 70) return "mark_ready_to_assign";
    if (workOrder.status === "ready_to_assign") return "assign_provider_or_crew";
    if (workOrder.status === "assigned") return "schedule_work";
    if (workOrder.status === "scheduled") return "start_work";
    if (workOrder.status === "in_progress") return "submit_for_review";
    if (workOrder.status === "submitted") return "start_qc_review";
    if (workOrder.status === "qc_review") return "approve_or_request_corrections";
    if (workOrder.status === "corrections_required") return "complete_corrections";
    if (workOrder.status === "approved") return "mark_billable";
    if (workOrder.status === "billable") return "close_work_order";
    if (workOrder.status === "on_hold") return "release_or_resolve_hold";
    if (workOrder.status === "closed") return "view_closed_work_order";
    return "review_work_order";
  }

  private normalizeWorkOrderStatus(status: string) {
    const normalized = legacyWorkOrderStatusMap[status] ?? status;
    requireAllowed(normalized, workOrderStatuses, "work_order status");
    return normalized;
  }

  private assertNoWorkOrderBlockers(readiness: { blockers: unknown[] }) {
    if (readiness.blockers.length) throw new BadRequestException({ message: "Work order readiness has blockers.", blockers: readiness.blockers });
  }

  private assertWorkOrderOverrides(readiness: { required_override_fields: string[] }, overrides: unknown) {
    if (!readiness.required_override_fields.length) return;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new BadRequestException({ message: "Work order readiness requires override reasons for warnings.", required_override_fields: readiness.required_override_fields });
    const record = overrides as Record<string, unknown>;
    const missing = readiness.required_override_fields.filter((field) => typeof record[field] !== "string" || !String(record[field]).trim());
    if (missing.length) throw new BadRequestException({ message: "Work order readiness requires override reasons for warnings.", required_override_fields: missing });
  }

  private hasOverride(overrides: unknown, field: string) {
    return Boolean(overrides && typeof overrides === "object" && !Array.isArray(overrides) && typeof (overrides as Record<string, unknown>)[field] === "string" && String((overrides as Record<string, unknown>)[field]).trim());
  }

  private async requireProjectReadyForWorkOrder(client: PoolClient, tenantId: string, projectId: unknown) {
    const project = await this.requireRecord(client, "projects", tenantId, this.requiredId(projectId, "project_id"), "project not found");
    if (!["ready_for_work", "active"].includes(project.status)) throw new BadRequestException("project must be ready_for_work or active");
    return project;
  }

  private requireWorkOrderOpen(workOrder: Record<string, unknown>) {
    if (["archived", "cancelled", "closed"].includes(String(workOrder.status))) throw new BadRequestException("work order is closed, cancelled, or archived");
  }

  private async validateWorkOrderReferences(client: PoolClient, tenantId: string, project: Record<string, any>, body: Record<string, unknown>, before?: Record<string, any>) {
    if (body.territory_id) await this.requireRecord(client, "territories", tenantId, this.requiredId(body.territory_id, "territory_id"), "territory not found");
    if (body.owner_user_id) await this.requireTenantUser(client, tenantId, body.owner_user_id);
    if (body.field_supervisor_user_id) await this.requireTenantUser(client, tenantId, body.field_supervisor_user_id);
    if (body.qc_owner_user_id) await this.requireTenantUser(client, tenantId, body.qc_owner_user_id);
    const coveragePlanId = body.coverage_plan_id ?? before?.coverage_plan_id;
    if (coveragePlanId) {
      const plan = await this.requireRecord(client, "coverage_plans", tenantId, this.requiredId(coveragePlanId, "coverage_plan_id"), "coverage plan not found");
      if (project.source_coverage_plan_id && plan.id !== project.source_coverage_plan_id && !this.hasOverride(body.override_reasons, "coverage_mismatch_override_reason")) {
        throw new BadRequestException({ message: "Coverage source mismatch requires override reason.", required_override_fields: ["coverage_mismatch_override_reason"] });
      }
    }
    if (body.coverage_requirement_id) {
      const requirement = await this.requireRecord(client, "coverage_requirements", tenantId, this.requiredId(body.coverage_requirement_id, "coverage_requirement_id"), "coverage requirement not found");
      if (coveragePlanId && requirement.coverage_plan_id !== coveragePlanId) throw new BadRequestException("coverage requirement must belong to coverage plan");
    }
    if (body.coverage_source_id) {
      const source = await this.requireRecord(client, "coverage_sources", tenantId, this.requiredId(body.coverage_source_id, "coverage_source_id"), "coverage source not found");
      if (coveragePlanId && source.coverage_plan_id !== coveragePlanId) throw new BadRequestException("coverage source must belong to coverage plan");
    }
    if (body.assigned_capacity_provider_id) await this.requireProvider(client, tenantId, body.assigned_capacity_provider_id);
    if (body.assigned_crew_id) await this.requireCrew(client, tenantId, body.assigned_crew_id, body.assigned_capacity_provider_id ?? before?.assigned_capacity_provider_id);
    if (body.assigned_organization_id) await this.requireRecord(client, "organizations", tenantId, this.requiredId(body.assigned_organization_id, "assigned_organization_id"), "assigned organization not found");
    if (body.assigned_equipment_id) await this.requireRecord(client, "equipment", tenantId, this.requiredId(body.assigned_equipment_id, "assigned_equipment_id"), "assigned equipment not found");
  }

  private async workOrderStatusAction(request: AuthenticatedRequest, id: string, action: string, eventType: string, allowedStatuses: string[], values: Record<string, unknown>, reason?: unknown) {
    return this.write(request, action, eventType, "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      if (!allowedStatuses.includes(before.status)) throw new BadRequestException(`work order must be ${allowedStatuses.join(" or ")}`);
      const cleanValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, cleanValues);
      if (!after) throw new NotFoundException("work order not found");
      await this.persistWorkOrderReadiness(client, request.auth.tenantId, id, await this.calculateWorkOrderReadiness(client, request.auth.tenantId, id, after), request.auth.userId);
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: await this.workOrderDetail(client, request.auth.tenantId, id) };
    }, reason);
  }

  private async validateProductionReferences(client: PoolClient, tenantId: string, values: Record<string, unknown>, body: Record<string, unknown>, before: Record<string, unknown>) {
    if (body.project_id) {
      await this.requireRecord(client, "projects", tenantId, this.requiredId(body.project_id, "project_id"), "project not found");
      values.project_id = body.project_id;
    }
    if (body.work_order_id) {
      await this.requireRecord(client, "work_orders", tenantId, this.requiredId(body.work_order_id, "work_order_id"), "work order not found");
      values.work_order_id = body.work_order_id;
    }
    const projectId = values.project_id ?? before.project_id;
    const workOrderId = values.work_order_id ?? before.work_order_id;
    const workOrder = await this.requireRecord(client, "work_orders", tenantId, String(workOrderId), "work order not found");
    if (workOrder.project_id !== projectId) throw new BadRequestException("work_order must belong to project");
    if (body.capacity_provider_id) {
      await this.requireProvider(client, tenantId, body.capacity_provider_id);
      values.capacity_provider_id = body.capacity_provider_id;
    }
    if (body.crew_id) {
      await this.requireCrew(client, tenantId, body.crew_id, values.capacity_provider_id ?? before.capacity_provider_id);
      values.crew_id = body.crew_id;
    }
    if (body.foreman_user_id) {
      await this.requireTenantUser(client, tenantId, body.foreman_user_id);
      values.foreman_user_id = body.foreman_user_id;
    }
    if (body.foreman_contact_id) {
      await this.requireRecord(client, "contacts", tenantId, this.requiredId(body.foreman_contact_id, "foreman_contact_id"), "foreman contact not found");
      values.foreman_contact_id = body.foreman_contact_id;
    }
  }

  private async validateProductionCreateContext(client: PoolClient, tenantId: string, body: Record<string, unknown>, productionType: unknown) {
    const workOrder = await this.requireRecord(client, "work_orders", tenantId, this.requiredId(body.work_order_id, "work_order_id"), "work order not found");
    const project = await this.requireRecord(client, "projects", tenantId, String(body.project_id ?? workOrder.project_id), "project not found");
    if (workOrder.project_id !== project.id) throw new BadRequestException("work_order must belong to project");
    this.assertProjectAllowsProduction(project, body.override_reasons);
    this.assertWorkOrderAllowsProduction(workOrder, String(productionType), body.override_reasons);
    const hasBodyValue = (key: string) => body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== "";
    const hasExplicitPerformer = ["capacity_provider_id", "crew_id", "assigned_organization_id", "foreman_user_id", "submitted_by", "submitted_by_user_id"].some(hasBodyValue);
    if (!hasExplicitPerformer && !this.hasOverride(body.override_reasons, "performer_override_reason")) {
      throw new BadRequestException({ message: "Production requires performer context.", required_override_fields: ["performer_override_reason"] });
    }
    const providerId = body.capacity_provider_id ?? workOrder.assigned_capacity_provider_id;
    const crewId = body.crew_id ?? workOrder.assigned_crew_id;
    const organizationId = body.assigned_organization_id ?? workOrder.assigned_organization_id;
    if (providerId) {
      const provider = await this.requireProvider(client, tenantId, providerId);
      if (["archived", "suspended"].includes(String(provider.status))) throw new BadRequestException("capacity provider is archived or suspended");
      if (workOrder.assigned_capacity_provider_id && provider.id !== workOrder.assigned_capacity_provider_id && !this.hasOverride(body.override_reasons, "performer_override_reason")) {
        throw new BadRequestException({ message: "Production provider must match work order assignment or include override.", required_override_fields: ["performer_override_reason"] });
      }
    }
    if (crewId) {
      await this.requireCrew(client, tenantId, crewId, providerId);
      if (workOrder.assigned_crew_id && crewId !== workOrder.assigned_crew_id && !this.hasOverride(body.override_reasons, "performer_override_reason")) {
        throw new BadRequestException({ message: "Production crew must match work order assignment or include override.", required_override_fields: ["performer_override_reason"] });
      }
    }
    if (organizationId) await this.requireRecord(client, "organizations", tenantId, this.requiredId(organizationId, "assigned_organization_id"), "assigned organization not found");
    if (body.foreman_user_id) await this.requireTenantUser(client, tenantId, body.foreman_user_id);
    if (body.submitted_by) await this.requireTenantUser(client, tenantId, body.submitted_by);
    if (body.submitted_by_user_id) await this.requireTenantUser(client, tenantId, body.submitted_by_user_id);
    if (body.foreman_contact_id) await this.requireRecord(client, "contacts", tenantId, this.requiredId(body.foreman_contact_id, "foreman_contact_id"), "foreman contact not found");
    if (body.parent_production_record_id) await this.requireRecord(client, "production_records", tenantId, this.requiredId(body.parent_production_record_id, "parent_production_record_id"), "parent production record not found");
    if (body.source_qc_review_id) await this.requireRecord(client, "qc_reviews", tenantId, this.requiredId(body.source_qc_review_id, "source_qc_review_id"), "source qc review not found");
    if (body.correction_owner_user_id) await this.requireTenantUser(client, tenantId, body.correction_owner_user_id);
    return { project, workOrder };
  }

  private assertProjectAllowsProduction(project: Record<string, unknown>, overrides: unknown) {
    if (["ready_for_work", "active"].includes(String(project.status))) return;
    if (this.hasOverride(overrides, "production_eligibility_override_reason")) return;
    throw new BadRequestException({ message: "Project must be ready_for_work or active for production.", required_override_fields: ["production_eligibility_override_reason"] });
  }

  private assertWorkOrderAllowsProduction(workOrder: Record<string, unknown>, productionType: string, overrides: unknown) {
    if (["archived", "cancelled", "closed", "billable"].includes(String(workOrder.status))) throw new BadRequestException("work order is archived, cancelled, closed, or billable");
    const normalStatuses = new Set(["assigned", "scheduled", "in_progress", "corrections_required"]);
    const reviewStatuses = new Set(["submitted", "qc_review"]);
    if (normalStatuses.has(String(workOrder.status))) return;
    if ((productionType === "correction_submission" || productionType === "inspection_submission") && reviewStatuses.has(String(workOrder.status))) return;
    if (this.hasOverride(overrides, "production_eligibility_override_reason")) return;
    throw new BadRequestException({ message: "Work order is not production eligible.", required_override_fields: ["production_eligibility_override_reason"] });
  }

  private productionClaimedQuantity(body: Record<string, unknown>, productionType: string) {
    const raw = body.claimed_quantity ?? body.quantity_submitted ?? body.quantity;
    if (raw === undefined || raw === null || raw === "") {
      if (quantityProductionTypes.has(productionType)) throw new BadRequestException("claimed_quantity is required");
      return null;
    }
    return this.requireNonNegative(raw, "claimed_quantity");
  }

  private productionUnit(body: Record<string, unknown>, quantity: number | null) {
    const raw = body.unit ?? body.unit_type;
    if ((quantity !== null || raw !== undefined) && (typeof raw !== "string" || !raw)) throw new BadRequestException("unit is required");
    return raw === undefined || raw === null || raw === "" ? null : requireAllowed(raw, workOrderUnits, "unit");
  }

  private validateProductionTypeNotes(body: Record<string, unknown>, productionType: string) {
    if (productionType === "other") this.requiredText(body.description ?? body.production_notes, "other production requires description");
    const requirements: Record<string, string[]> = {
      delay_report: ["delay_reason", "description"],
      no_work_report: ["no_work_reason", "description"],
      safety_observation: ["safety_observation_note", "description"],
      material_issue: ["material_issue_note", "description"],
      access_issue: ["access_issue_note", "description"],
      weather_delay: ["weather_delay_note", "description"],
      customer_issue: ["customer_issue_note", "description"],
    };
    const fields = requirements[productionType];
    if (fields && !fields.some((field) => typeof body[field] === "string" && String(body[field]).trim())) {
      throw new BadRequestException(`${productionType} requires reason, note, or description`);
    }
    if (quantityProductionTypes.has(productionType)) this.requiredText(body.description ?? body.production_notes, "description or production_notes is required");
  }

  private async validateProductionQuantityRules(client: PoolClient, tenantId: string, workOrder: Record<string, unknown>, body: Record<string, unknown>, quantity: number | null, unit: string | null) {
    if (unit && workOrder.unit && unit !== workOrder.unit && !this.hasOverride(body.override_reasons, "unit_override_reason")) {
      throw new BadRequestException({ message: "Production unit mismatch requires override.", required_override_fields: ["unit_override_reason"] });
    }
    if (quantity === null) return;
    const current = await client.query(
      "SELECT COALESCE(sum(COALESCE(claimed_quantity, quantity_submitted, quantity)), 0)::numeric AS claimed FROM production_records WHERE tenant_id = $1 AND work_order_id = $2 AND status NOT IN ('voided', 'archived', 'rejected') AND deleted_at IS NULL",
      [tenantId, workOrder.id],
    );
    const planned = Number(workOrder.planned_quantity ?? workOrder.expected_units ?? 0);
    const cumulative = Number(current.rows[0]?.claimed ?? 0) + quantity;
    if (planned >= 0 && cumulative > planned && !this.hasOverride(body.override_reasons, "quantity_overage_override_reason")) {
      throw new BadRequestException({ message: "Production quantity overage requires override.", required_override_fields: ["quantity_overage_override_reason"] });
    }
  }

  private async assertProductionEvidenceRequirement(client: PoolClient, tenantId: string, productionRecordId: string, productionType: unknown, overrides: unknown) {
    if (!["completion_submission", "correction_submission", "restoration_submission", "inspection_submission"].includes(String(productionType))) return;
    if (await this.hasActiveEvidence(client, tenantId, productionRecordId)) return;
    if (this.hasOverride(overrides, "evidence_override_reason")) return;
    throw new BadRequestException({ message: "Production evidence is required.", required_override_fields: ["evidence_override_reason"] });
  }

  private async recalculateWorkOrderProductionRollups(client: PoolClient, tenantId: string, workOrderId: string, actorUserId: string) {
    const result = await client.query(
      `
      SELECT
        COALESCE(sum(COALESCE(claimed_quantity, quantity_submitted, quantity)) FILTER (WHERE status IN ('submitted', 'under_review', 'qc_review', 'correction_required', 'corrected', 'accepted', 'approved', 'billable')), 0)::numeric AS completed_quantity,
        COALESCE(sum(approved_quantity) FILTER (WHERE status IN ('approved', 'billable')), 0)::numeric AS approved_quantity,
        COALESCE(sum(COALESCE(billable_quantity, approved_quantity)) FILTER (WHERE status = 'billable' OR billable_status = 'billable'), 0)::numeric AS billable_quantity
      FROM production_records
      WHERE tenant_id = $1 AND work_order_id = $2 AND status NOT IN ('voided', 'archived', 'rejected') AND deleted_at IS NULL
      `,
      [tenantId, workOrderId],
    );
    await updateTenantRecord(client, "work_orders", tenantId, workOrderId, {
      completed_quantity: Number(result.rows[0]?.completed_quantity ?? 0),
      approved_quantity: Number(result.rows[0]?.approved_quantity ?? 0),
      billable_quantity: Number(result.rows[0]?.billable_quantity ?? 0),
      updated_by: actorUserId,
    });
  }

  private async archiveRecord(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private async listProjectsEnriched(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const conditions = ["p.tenant_id = $1", "p.deleted_at IS NULL"];
    const params: unknown[] = [tenantId];
    if (query.archived !== "true") conditions.push("p.status <> 'archived'");
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    if (query.status) add("p.status = ?", query.status);
    if (query.customer_organization_id) add("p.customer_organization_id = ?", query.customer_organization_id);
    if (query.territory_id) add("p.territory_id = ?", query.territory_id);
    if (query.project_manager_user_id) add("p.project_manager_user_id = ?", query.project_manager_user_id);
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.scope_summary ILIKE $${params.length} OR p.location_summary ILIKE $${params.length} OR co.name ILIKE $${params.length} OR t.name ILIKE $${params.length})`);
    }
    const orderBy = query.sort === "planned_start" ? "p.planned_start_date ASC NULLS LAST, p.updated_at DESC" : query.sort === "readiness_desc" ? "p.project_readiness_score DESC NULLS LAST, p.updated_at DESC" : "p.updated_at DESC";
    const result = await client.query(
      `
      WITH constraint_counts AS (
        SELECT affected_object_id AS project_id,
          count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived'))::int AS open_constraints_count,
          count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived') AND COALESCE(hard_stop, false))::int AS hard_stop_constraints_count
        FROM constraints
        WHERE tenant_id = $1 AND affected_object_type = 'project' AND deleted_at IS NULL
        GROUP BY affected_object_id
      ),
      work_order_counts AS (
        SELECT project_id, count(*)::int AS work_order_count
        FROM work_orders
        WHERE tenant_id = $1 AND deleted_at IS NULL
        GROUP BY project_id
      ),
      production_counts AS (
        SELECT project_id, count(*)::int AS production_record_count
        FROM production_records
        WHERE tenant_id = $1 AND deleted_at IS NULL
        GROUP BY project_id
      ),
      coverage_gap_counts AS (
        SELECT cp.id AS coverage_plan_id, count(cg.id)::int AS coverage_gap_count
        FROM coverage_plans cp
        LEFT JOIN coverage_gaps cg ON cg.tenant_id = cp.tenant_id AND cg.coverage_plan_id = cp.id AND cg.deleted_at IS NULL AND cg.status NOT IN ('resolved', 'overridden', 'archived')
        WHERE cp.tenant_id = $1
        GROUP BY cp.id
      )
      SELECT p.id, p.name AS project_name, p.status, p.project_phase, p.source_opportunity_id, o.title AS source_opportunity_name,
        p.source_coverage_plan_id, p.source_project_handoff_id, p.customer_organization_id, co.name AS customer_organization_name,
        p.territory_id, t.name AS territory_name, p.work_type, p.scope_summary, p.location_summary, p.planned_start_date, p.planned_end_date,
        p.actual_start_date, p.actual_end_date, p.operations_owner_user_id, ou.display_name AS operations_owner_name,
        p.project_manager_user_id, pm.display_name AS project_manager_name, p.field_supervisor_user_id, fs.display_name AS field_supervisor_name,
        p.coverage_readiness_score, p.compliance_readiness_score, p.financial_readiness_score, p.project_readiness_score, p.project_readiness_band,
        p.billing_package_requirements, p.documentation_requirements, p.customer_validation_requirements,
        p.created_at, p.updated_at, p.archived_at,
        COALESCE(cc.open_constraints_count, 0) AS open_constraints_count,
        COALESCE(cc.hard_stop_constraints_count, 0) AS hard_stop_constraints_count,
        COALESCE(woc.work_order_count, 0) AS work_order_count,
        COALESCE(pc.production_record_count, 0) AS production_record_count,
        COALESCE(cgc.coverage_gap_count, 0) AS coverage_gap_count
      FROM projects p
      LEFT JOIN opportunities o ON o.tenant_id = p.tenant_id AND o.id = p.source_opportunity_id
      LEFT JOIN organizations co ON co.tenant_id = p.tenant_id AND co.id = p.customer_organization_id
      LEFT JOIN territories t ON t.tenant_id = p.tenant_id AND t.id = p.territory_id
      LEFT JOIN users ou ON ou.id = p.operations_owner_user_id
      LEFT JOIN users pm ON pm.id = p.project_manager_user_id
      LEFT JOIN users fs ON fs.id = p.field_supervisor_user_id
      LEFT JOIN constraint_counts cc ON cc.project_id = p.id
      LEFT JOIN work_order_counts woc ON woc.project_id = p.id
      LEFT JOIN production_counts pc ON pc.project_id = p.id
      LEFT JOIN coverage_gap_counts cgc ON cgc.coverage_plan_id = p.source_coverage_plan_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 200
      `,
      params,
    );
    return Promise.all(result.rows.map((row) => this.withProjectDerived(client, tenantId, row.id, row)));
  }

  private async projectRow(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT *
      FROM (${await this.projectRowsSql()}) p
      WHERE p.id = $2
      LIMIT 1
      `,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("project not found");
    return this.withProjectDerived(client, tenantId, id, row);
  }

  private async projectRowsSql() {
    return `
      SELECT p.id, p.name AS project_name, p.name, p.status, p.project_phase, p.source_opportunity_id, o.title AS source_opportunity_name,
        p.source_coverage_plan_id, p.source_project_handoff_id, p.customer_organization_id, co.name AS customer_organization_name,
        p.territory_id, t.name AS territory_name, p.work_type, p.scope_summary, p.location_summary, p.planned_start_date, p.planned_end_date,
        p.actual_start_date, p.actual_end_date, p.operations_owner_user_id, ou.display_name AS operations_owner_name,
        p.project_manager_user_id, pm.display_name AS project_manager_name, p.field_supervisor_user_id, fs.display_name AS field_supervisor_name,
        p.coverage_readiness_score, p.compliance_readiness_score, p.financial_readiness_score, p.project_readiness_score, p.project_readiness_band,
        p.billing_package_requirements, p.documentation_requirements, p.customer_validation_requirements,
        p.risk_notes, p.hold_reason, p.closeout_notes, p.created_at, p.updated_at, p.archived_at,
        0::int AS open_constraints_count, 0::int AS hard_stop_constraints_count, 0::int AS work_order_count, 0::int AS production_record_count, 0::int AS coverage_gap_count
      FROM projects p
      LEFT JOIN opportunities o ON o.tenant_id = p.tenant_id AND o.id = p.source_opportunity_id
      LEFT JOIN organizations co ON co.tenant_id = p.tenant_id AND co.id = p.customer_organization_id
      LEFT JOIN territories t ON t.tenant_id = p.tenant_id AND t.id = p.territory_id
      LEFT JOIN users ou ON ou.id = p.operations_owner_user_id
      LEFT JOIN users pm ON pm.id = p.project_manager_user_id
      LEFT JOIN users fs ON fs.id = p.field_supervisor_user_id
      WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
    `;
  }

  private async projectDetail(client: PoolClient, tenantId: string, id: string) {
    const project = (await this.projectRow(client, tenantId, id)) as Record<string, any>;
    const readiness = await this.calculateProjectReadiness(client, tenantId, id, project);
    return {
      project: { ...project, warnings: readiness.warnings, blockers: readiness.blockers, recommended_next_action: this.projectNextAction(project, readiness), ready_for_work: readiness.ready_for_work },
      source_opportunity: project.source_opportunity_id ? await this.optionalRecord(client, "opportunities", tenantId, project.source_opportunity_id) : null,
      source_coverage_plan: project.source_coverage_plan_id ? await this.optionalRecord(client, "coverage_plans", tenantId, project.source_coverage_plan_id) : null,
      source_project_handoff: project.source_project_handoff_id ? await this.optionalRecord(client, "project_handoffs", tenantId, project.source_project_handoff_id) : null,
      customer_context: { id: project.customer_organization_id, name: project.customer_organization_name, territory_id: project.territory_id, territory_name: project.territory_name },
      operations_context: {
        operations_owner_user_id: project.operations_owner_user_id,
        operations_owner_name: project.operations_owner_name,
        project_manager_user_id: project.project_manager_user_id,
        project_manager_name: project.project_manager_name,
        field_supervisor_user_id: project.field_supervisor_user_id,
        field_supervisor_name: project.field_supervisor_name,
      },
      readiness,
      warnings: readiness.warnings,
      blockers: readiness.blockers,
      documentation_requirements: project.documentation_requirements ?? null,
      billing_package_requirements: project.billing_package_requirements ?? null,
      customer_validation_requirements: project.customer_validation_requirements ?? null,
      constraints_summary: await this.projectConstraints(client, tenantId, id),
      work_orders_summary: await this.projectWorkOrdersSummary(client, tenantId, id),
      production_summary: await this.projectProductionSummary(client, tenantId, id),
      timeline_available: true,
      audit_allowed: true,
    };
  }

  private async withProjectDerived(client: PoolClient, tenantId: string, id: string, row: Record<string, any>) {
    const readiness = await this.calculateProjectReadiness(client, tenantId, id, row);
    return { ...row, warnings: readiness.warnings, blockers: readiness.blockers, recommended_next_action: this.projectNextAction(row, readiness), ready_for_work: readiness.ready_for_work };
  }

  private async calculateProjectReadiness(client: PoolClient, tenantId: string, projectId: string, project: Record<string, any>) {
    const constraints = await this.projectConstraints(client, tenantId, projectId);
    const items = [
      { key: "customer_organization_attached", complete: Boolean(project.customer_organization_id), hard: true },
      { key: "territory_attached", complete: Boolean(project.territory_id), hard: true },
      { key: "work_type_attached", complete: Boolean(project.work_type), hard: true },
      { key: "scope_summary_present", complete: Boolean(project.scope_summary), hard: true },
      { key: "location_summary_present", complete: Boolean(project.location_summary), hard: true },
      { key: "planned_dates_reviewed", complete: Boolean(project.planned_start_date || project.planned_end_date), hard: false },
      { key: "operations_owner_assigned", complete: Boolean(project.operations_owner_user_id), hard: false },
      { key: "project_manager_assigned", complete: Boolean(project.project_manager_user_id), hard: false },
      { key: "field_supervisor_identified", complete: Boolean(project.field_supervisor_user_id), hard: false },
      { key: "source_coverage_plan_attached", complete: Boolean(project.source_coverage_plan_id), hard: false },
      { key: "source_project_handoff_attached", complete: Boolean(project.source_project_handoff_id), hard: false },
      { key: "coverage_reviewed", complete: project.coverage_readiness_score !== null && project.coverage_readiness_score !== undefined, hard: false },
      { key: "compliance_reviewed", complete: project.compliance_readiness_score !== null && project.compliance_readiness_score !== undefined, hard: false },
      { key: "financial_reviewed", complete: project.financial_readiness_score !== null && project.financial_readiness_score !== undefined, hard: false },
      { key: "documentation_requirements_identified", complete: Boolean(project.documentation_requirements), hard: false },
      { key: "billing_package_requirements_identified", complete: Boolean(project.billing_package_requirements), hard: false },
      { key: "customer_validation_requirements_identified", complete: Boolean(project.customer_validation_requirements), hard: false },
      { key: "hard_stop_constraints_resolved", complete: Number(constraints.hard_stop_constraints_count ?? 0) === 0, hard: true },
    ];
    const completed = items.filter((item) => item.complete).length;
    let score = Math.round((completed / items.length) * 100);
    const blockers = items
      .filter((item) => !item.complete && item.hard)
      .map((item) => ({ blocker_type: item.key, severity: "high", message: item.key, related_object_type: "project", related_object_id: projectId }));
    const warnings = items
      .filter((item) => !item.complete && !item.hard)
      .map((item) => ({ warning_type: item.key, severity: "medium", message: item.key, required_override_field: "readiness_override_reason", related_object_type: "project", related_object_id: projectId }));
    if (project.status === "archived") blockers.push({ blocker_type: "archived_project", severity: "critical", message: "archived project", related_object_type: "project", related_object_id: projectId });
    if (Number(constraints.hard_stop_constraints_count ?? 0) > 0 || blockers.length) score = Math.min(score, 39);
    if (!project.operations_owner_user_id || !project.project_manager_user_id) score = Math.min(score, 69);
    if (project.compliance_readiness_score === null || project.compliance_readiness_score === undefined || project.financial_readiness_score === null || project.financial_readiness_score === undefined) score = Math.min(score, 84);
    const band = score >= 85 ? "ready_for_work" : score >= 70 ? "ready_with_risk" : score >= 40 ? "needs_planning" : "not_ready";
    const requiredOverrideFields = [...new Set(warnings.map((warning) => warning.required_override_field).filter(Boolean))];
    return { checklist: items, project_readiness_score: score, project_readiness_band: band, warnings, blockers, required_override_fields: requiredOverrideFields, ready_for_work: score >= 85 && blockers.length === 0 };
  }

  private async persistProjectReadiness(client: PoolClient, tenantId: string, id: string, readiness: Record<string, unknown>, actorUserId: string) {
    await updateTenantRecord(client, "projects", tenantId, id, {
      project_readiness_score: readiness.project_readiness_score,
      project_readiness_band: readiness.project_readiness_band,
      updated_by: actorUserId,
    });
  }

  private assertNoProjectBlockers(readiness: { blockers: unknown[] }) {
    if (readiness.blockers.length) throw new BadRequestException({ message: "Project readiness has blockers.", blockers: readiness.blockers });
  }

  private assertProjectOverrides(readiness: { required_override_fields: string[] }, overrides: unknown) {
    if (!readiness.required_override_fields.length) return;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new BadRequestException({ message: "Project readiness requires override reasons for warnings.", required_override_fields: readiness.required_override_fields });
    }
    const record = overrides as Record<string, unknown>;
    const missing = readiness.required_override_fields.filter((field) => typeof record[field] !== "string" || !String(record[field]).trim());
    if (missing.length) throw new BadRequestException({ message: "Project readiness requires override reasons for warnings.", required_override_fields: missing });
  }

  private projectNextAction(project: Record<string, any>, readiness: { blockers: unknown[]; project_readiness_score: number }) {
    if (project.status === "archived") return "view_only";
    if (readiness.blockers.length) return "resolve_blockers";
    if (project.project_readiness_score === null || project.project_readiness_score === undefined) return "recalculate_readiness";
    if (project.status === "planning" && readiness.project_readiness_score < 85) return "complete_project_readiness";
    if (project.status === "planning" && readiness.project_readiness_score >= 85) return "mark_ready_for_work";
    if (project.status === "ready_for_work") return "prepare_work_orders_later";
    if (project.status === "active") return "monitor_execution";
    if (project.status === "on_hold") return "resolve_hold";
    if (project.status === "completed") return "begin_closeout";
    if (project.status === "closed") return "view_closed_project";
    return "review_project";
  }

  private async projectConstraints(client: PoolClient, tenantId: string, projectId: string) {
    const result = await client.query(
      `
      SELECT count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived'))::int AS open_constraints_count,
        count(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'archived') AND COALESCE(hard_stop, false))::int AS hard_stop_constraints_count
      FROM constraints
      WHERE tenant_id = $1 AND affected_object_type = 'project' AND affected_object_id = $2 AND deleted_at IS NULL
      `,
      [tenantId, projectId],
    );
    return result.rows[0] ?? { open_constraints_count: 0, hard_stop_constraints_count: 0 };
  }

  private async projectWorkOrdersSummary(client: PoolClient, tenantId: string, projectId: string) {
    const result = await client.query("SELECT count(*)::int AS work_order_count FROM work_orders WHERE tenant_id = $1 AND project_id = $2 AND deleted_at IS NULL", [tenantId, projectId]);
    return result.rows[0] ?? { work_order_count: 0 };
  }

  private async projectProductionSummary(client: PoolClient, tenantId: string, projectId: string) {
    const result = await client.query("SELECT count(*)::int AS production_record_count FROM production_records WHERE tenant_id = $1 AND project_id = $2 AND deleted_at IS NULL", [tenantId, projectId]);
    return result.rows[0] ?? { production_record_count: 0 };
  }

  private async optionalRecord(client: PoolClient, table: string, tenantId: string, id: string) {
    return findTenantRecordById(client, table, tenantId, id);
  }

  private requireLocation(body: Record<string, unknown>) {
    if (typeof body.location_description === "string" && body.location_description.trim()) return;
    if (body.gps_lat !== undefined && body.gps_lng !== undefined) return;
    throw new Error("location_description or GPS fields are required");
  }

  private hasEvidenceReference(body: Record<string, unknown>) {
    return ["description", "file_id", "source_url", "file_url", "storage_reference", "caption"].some((key) => typeof body[key] === "string" && body[key].trim());
  }

  private async hasActiveEvidence(client: PoolClient, tenantId: string, productionRecordId: string) {
    const result = await client.query(
      "SELECT 1 FROM production_evidence WHERE tenant_id = $1 AND production_record_id = $2 AND status = 'active' AND deleted_at IS NULL LIMIT 1",
      [tenantId, productionRecordId],
    );
    return Boolean(result.rows[0]);
  }

  private async hasActiveEvidenceAfter(client: PoolClient, tenantId: string, productionRecordId: string, createdAfter: unknown) {
    const result = await client.query(
      `
      SELECT 1
      FROM production_evidence
      WHERE tenant_id = $1
        AND production_record_id = $2
        AND status = 'active'
        AND deleted_at IS NULL
        AND created_at > $3
      LIMIT 1
      `,
      [tenantId, productionRecordId, createdAfter],
    );
    return Boolean(result.rows[0]);
  }

  private async requireQcValidation(client: PoolClient, tenantId: string, record: Record<string, unknown>) {
    if (!record.production_date) throw new BadRequestException("production_date is required");
    if (record.quantity_submitted === undefined || record.quantity_submitted === null || Number(record.quantity_submitted) < 0) {
      throw new BadRequestException("quantity_submitted is required");
    }
    requireString(record.unit_type, "unit_type is required");
    await this.requireRecord(client, "projects", tenantId, String(record.project_id), "project not found");
    const workOrder = await this.requireRecord(client, "work_orders", tenantId, String(record.work_order_id), "work order not found");
    if (workOrder.project_id !== record.project_id) throw new BadRequestException("work_order must belong to project");
    await this.requireProvider(client, tenantId, record.capacity_provider_id);
    if (record.crew_id) await this.requireCrew(client, tenantId, record.crew_id, record.capacity_provider_id);
    if (record.foreman_user_id) await this.requireTenantUser(client, tenantId, record.foreman_user_id);
    if (record.foreman_contact_id) await this.requireRecord(client, "contacts", tenantId, String(record.foreman_contact_id), "foreman contact not found");
    if (!(await this.hasActiveEvidence(client, tenantId, String(record.id)))) throw new BadRequestException("active evidence is required");
  }

  private requireNoActiveStopWork(record: Record<string, unknown>) {
    if (record.stop_work_status === "active") throw new BadRequestException("active stop work blocks this action");
  }

  private async requireActiveRateCode(client: PoolClient, tenantId: string, rateCodeId: unknown, unitType: string) {
    if (typeof rateCodeId !== "string" || !rateCodeId) throw new BadRequestException("rate_code_id is required");
    const id = rateCodeId;
    const result = await client.query(
      `
      SELECT rc.*
      FROM rate_codes rc
      JOIN rate_schedules rs ON rs.id = rc.rate_schedule_id
      WHERE rc.tenant_id = $1
        AND rc.id = $2
        AND rs.tenant_id = $1
        AND rs.status = 'active'
        AND rs.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );
    const rateCode = result.rows[0];
    if (!rateCode) throw new NotFoundException("active rate code not found");
    if (rateCode.unit !== unitType) throw new BadRequestException("rate_code unit must match production unit_type");
    return rateCode;
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private async requireProvider(client: PoolClient, tenantId: string, id: unknown) {
    return this.requireRecord(client, "capacity_providers", tenantId, this.requiredId(id, "capacity_provider_id"), "capacity provider not found");
  }

  private async requireCrew(client: PoolClient, tenantId: string, id: unknown, providerId: unknown) {
    const crew = await this.requireRecord(client, "crews", tenantId, this.requiredId(id, "crew_id"), "crew not found");
    if (providerId && crew.capacity_provider_id !== providerId) throw new BadRequestException("crew must belong to capacity provider");
    return crew;
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: unknown) {
    const id = this.requiredId(userId, "user_id");
    const result = await client.query(
      "SELECT 1 FROM tenant_users tu JOIN users u ON u.id = tu.user_id WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND u.status = 'active' AND tu.deleted_at IS NULL AND u.deleted_at IS NULL",
      [tenantId, id],
    );
    if (!result.rows[0]) throw new NotFoundException("user not found in tenant");
  }

  private async requireRoleAuthority(client: PoolClient, tenantId: string, userId: string, roles: Set<string>, message: string) {
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
      [tenantId, userId, Array.from(roles)],
    );
    if (!result.rows[0]) throw new ForbiddenException(message);
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !value) throw new Error(`${field} is required`);
    return value;
  }

  private requireNonNegative(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be >= 0`);
    return parsed;
  }

  private requirePositive(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be > 0`);
    return parsed;
  }

  private requireQuantityAtMost(value: number, maximum: unknown, field: string, maximumField: string) {
    const parsedMaximum = Number(maximum);
    if (!Number.isFinite(parsedMaximum)) throw new BadRequestException(`${maximumField} is required`);
    if (value > parsedMaximum) throw new BadRequestException(`${field} must be <= ${maximumField}`);
  }

  private objectOrEmpty(value: unknown) {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("metadata must be an object");
    return value;
  }

  private jsonObject(value: unknown) {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("override_reasons must be an object");
    return value;
  }

  private optionalAllowed(value: unknown, allowed: Set<string>, field: string) {
    if (value === undefined || value === null || value === "") return undefined;
    return requireAllowed(value, allowed, field);
  }

  private async assertNoSelfApproval(client: PoolClient, tenantId: string, actorUserId: string, productionRecord: Record<string, unknown>, overrides: unknown) {
    const submittedBy = productionRecord.submitted_by ?? productionRecord.submitted_by_user_id;
    if (!submittedBy || submittedBy !== actorUserId) return;
    if (this.hasOverride(overrides, "self_approval_override_reason") || this.hasOverride(overrides, "admin_override_reason")) return;
    const systemAdmin = await client.query(
      `
      SELECT 1
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id
      JOIN roles r ON r.id = ur.role_id
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND r.name = 'System Admin'
        AND r.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, actorUserId],
    );
    if (systemAdmin.rows[0]) return;
    throw new ForbiddenException("Reviewer cannot approve production they submitted without override");
  }

  private requiredText(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private async write<T>(
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
    reason?: unknown,
  ) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
        audit: { metadata: typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {} },
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
