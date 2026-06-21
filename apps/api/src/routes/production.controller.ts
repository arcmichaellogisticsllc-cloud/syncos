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
const workOrderStatuses = new Set(["created", "assigned", "in_progress", "archived"]);
const productionRecordStatuses = new Set(["draft", "submitted", "correction_required", "qc_review", "accepted", "approved", "billable", "rejected", "archived"]);
const evidenceTypes = new Set(["photo", "video", "gps", "daily_report", "safety_form", "inspection_note", "material_ticket", "other"]);
const evidenceStatuses = new Set(["active", "archived"]);
const correctionAuthorityRoles = new Set(["Project Manager", "Operations Manager"]);
const qcReviewAuthorityRoles = new Set(["QC Manager", "Project Manager"]);
const qcManagerRoles = new Set(["QC Manager"]);
const approveAuthorityRoles = new Set(["QC Manager", "Operations Manager"]);
const billableAuthorityRoles = new Set(["Billing Manager", "QC Manager"]);
const stopWorkIssueAuthorityRoles = new Set(["Safety Manager", "QC Manager", "Executive"]);
const stopWorkReleaseAuthorityRoles = new Set(["Safety Manager", "Executive"]);

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
  async listWorkOrders(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "work_orders", request.auth.tenantId, { searchColumns: ["title", "work_type", "status"] }));
  }

  @Get("work-orders/:id")
  @RequirePermission("work_order.read")
  async getWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found"));
  }

  @Post("work-orders")
  @RequirePermission("work_order.create")
  async createWorkOrder(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const title = requireString(body.title, "work order title is required");
      const workType = requireString(body.work_type, "work_type is required");
      this.requireLocation(body);
      const expectedUnits = this.requireNonNegative(body.expected_units, "expected_units");
      const unitType = requireString(body.unit_type, "unit_type is required");
      return await this.write(request, "work_order.create", "work_order.created", "work_order", async (client) => {
        await this.requireRecord(client, "projects", request.auth.tenantId, this.requiredId(body.project_id, "project_id"), "project not found");
        if (body.assigned_capacity_provider_id) await this.requireProvider(client, request.auth.tenantId, body.assigned_capacity_provider_id);
        if (body.assigned_crew_id) await this.requireCrew(client, request.auth.tenantId, body.assigned_crew_id, body.assigned_capacity_provider_id);
        const workOrder = await insertTenantRecord(client, "work_orders", request.auth.tenantId, {
          project_id: body.project_id,
          assigned_capacity_provider_id: body.assigned_capacity_provider_id,
          assigned_crew_id: body.assigned_crew_id,
          title,
          work_type: workType,
          location_description: body.location_description,
          gps_lat: body.gps_lat,
          gps_lng: body.gps_lng,
          expected_units: expectedUnits,
          unit_type: unitType,
          status: "created",
        });
        return { entityType: "work_order", entityId: workOrder.id, afterState: workOrder };
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
      const values = pick(body, ["title", "work_type", "location_description", "gps_lat", "gps_lng", "unit_type"]);
      if (body.expected_units !== undefined) values.expected_units = this.requireNonNegative(body.expected_units, "expected_units");
      return await this.write(request, "work_order.update", "work_order.updated", "work_order", async (client) => {
        const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
        if (body.project_id) {
          await this.requireRecord(client, "projects", request.auth.tenantId, this.requiredId(body.project_id, "project_id"), "project not found");
          values.project_id = body.project_id;
        }
        if (body.assigned_capacity_provider_id) {
          await this.requireProvider(client, request.auth.tenantId, body.assigned_capacity_provider_id);
          values.assigned_capacity_provider_id = body.assigned_capacity_provider_id;
        }
        if (body.assigned_crew_id) {
          await this.requireCrew(client, request.auth.tenantId, body.assigned_crew_id, values.assigned_capacity_provider_id ?? before.assigned_capacity_provider_id);
          values.assigned_crew_id = body.assigned_crew_id;
        }
        const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("work order not found");
        return { entityType: "work_order", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("work-orders/:id/assign")
  @RequirePermission("work_order.assign")
  async assignWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "work_order.assign", "work_order.assigned", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      const providerId = body.assigned_capacity_provider_id ?? before.assigned_capacity_provider_id;
      const provider = await this.requireProvider(client, request.auth.tenantId, providerId);
      if (provider.status !== "activated") throw new BadRequestException("capacity provider must be activated");
      const crewId = body.assigned_crew_id ?? before.assigned_crew_id;
      if (crewId) await this.requireCrew(client, request.auth.tenantId, crewId, providerId);
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, {
        assigned_capacity_provider_id: providerId,
        assigned_crew_id: crewId,
        status: "assigned",
      });
      if (!after) throw new NotFoundException("work order not found");
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("work-orders/:id/start")
  @RequirePermission("work_order.start")
  async startWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "work_order.start", "work_order.started", "work_order", async (client) => {
      const before = await this.requireRecord(client, "work_orders", request.auth.tenantId, id, "work order not found");
      if (before.status !== "assigned") throw new BadRequestException("work order must be assigned");
      await this.requireProvider(client, request.auth.tenantId, before.assigned_capacity_provider_id);
      const after = await updateTenantRecord(client, "work_orders", request.auth.tenantId, id, { status: "in_progress" });
      if (!after) throw new NotFoundException("work order not found");
      return { entityType: "work_order", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("work-orders/:id/archive")
  @RequirePermission("work_order.archive")
  async archiveWorkOrder(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "work_orders", id, "work_order", "work_order.archive", "work_order.archived");
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

  @Get("production-records")
  @RequirePermission("production_record.read")
  async listProductionRecords(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "production_records", request.auth.tenantId, { searchColumns: ["unit_type", "status", "billable_status", "stop_work_status"] }));
  }

  @Get("production-records/:id")
  @RequirePermission("production_record.read")
  async getProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found"));
  }

  @Post("production-records")
  @RequirePermission("production_record.create")
  async createProductionRecord(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const quantity = this.requireNonNegative(body.quantity_submitted, "quantity_submitted");
      const unitType = requireString(body.unit_type, "unit_type is required");
      const productionDate = requireString(body.production_date, "production_date is required");
      return await this.write(request, "production_record.create", "production_record.created", "production_record", async (client) => {
        await this.requireRecord(client, "projects", request.auth.tenantId, this.requiredId(body.project_id, "project_id"), "project not found");
        const workOrder = await this.requireRecord(client, "work_orders", request.auth.tenantId, this.requiredId(body.work_order_id, "work_order_id"), "work order not found");
        if (workOrder.project_id !== body.project_id) throw new BadRequestException("work_order must belong to project");
        await this.requireProvider(client, request.auth.tenantId, body.capacity_provider_id);
        if (body.crew_id) await this.requireCrew(client, request.auth.tenantId, body.crew_id, body.capacity_provider_id);
        if (body.foreman_user_id) await this.requireTenantUser(client, request.auth.tenantId, body.foreman_user_id);
        if (body.foreman_contact_id) await this.requireRecord(client, "contacts", request.auth.tenantId, this.requiredId(body.foreman_contact_id, "foreman_contact_id"), "foreman contact not found");
        const record = await insertTenantRecord(client, "production_records", request.auth.tenantId, {
          project_id: body.project_id,
          work_order_id: body.work_order_id,
          capacity_provider_id: body.capacity_provider_id,
          crew_id: body.crew_id,
          foreman_user_id: body.foreman_user_id,
          foreman_contact_id: body.foreman_contact_id,
          production_date: productionDate,
          quantity_submitted: quantity,
          quantity,
          unit_type: unitType,
          unit: unitType,
          status: "draft",
        });
        return { entityType: "production_record", entityId: record.id, afterState: record };
      });
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
      const values = pick(body, ["production_date", "unit_type", "correction_reason"]);
      if (body.quantity_submitted !== undefined) {
        values.quantity_submitted = this.requireNonNegative(body.quantity_submitted, "quantity_submitted");
        values.quantity = values.quantity_submitted;
      }
      if (body.unit_type !== undefined) values.unit = body.unit_type;
      return await this.write(request, "production_record.update", "production_record.updated", "production_record", async (client) => {
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        await this.validateProductionReferences(client, request.auth.tenantId, values, body, before);
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/submit")
  @RequirePermission("production_record.submit")
  async submitProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "production_record.submit", "production_record.submitted", "production_record", async (client) => {
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      const workOrder = await this.requireRecord(client, "work_orders", request.auth.tenantId, String(before.work_order_id), "work order not found");
      if (workOrder.status !== "in_progress") throw new BadRequestException("work order must be in_progress");
      if (before.quantity_submitted === undefined || before.quantity_submitted === null || Number(before.quantity_submitted) < 0) throw new BadRequestException("quantity_submitted is required");
      requireString(before.unit_type, "unit_type is required");
      if (!before.production_date) throw new BadRequestException("production_date is required");
      const submittedBy = body.submitted_by_user_id ?? request.auth.userId;
      await this.requireTenantUser(client, request.auth.tenantId, submittedBy);
      if (!(await this.hasActiveEvidence(client, request.auth.tenantId, id))) throw new BadRequestException("active evidence is required");
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
        status: "submitted",
        submitted_by_user_id: submittedBy,
      });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("production-records/:id/correction-required")
  @RequirePermission("production_record.correction_required")
  async correctionRequired(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.reason ?? body.correction_reason, "correction reason is required");
      return await this.write(request, "production_record.correction_required", "production_record.correction_required", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, correctionAuthorityRoles, "Project Manager or Operations Manager authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          status: "correction_required",
          correction_reason: reason,
          correction_required_at: new Date(),
          correction_required_by: request.auth.userId,
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
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
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "qc_review" });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
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
        if (before.status !== "qc_review") throw new BadRequestException("production record must be in qc_review");
        this.requireNoActiveStopWork(before);
        await this.requireQcValidation(client, request.auth.tenantId, before);
        this.requireQuantityAtMost(acceptedQuantity, before.quantity_submitted, "accepted_quantity", "quantity_submitted");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          status: "accepted",
          accepted_quantity: acceptedQuantity,
          accepted_by: request.auth.userId,
          accepted_at: new Date(),
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
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
          rejection_reason: reason,
          rejected_quantity: rejectedQuantity,
          rejected_by: request.auth.userId,
          rejected_at: new Date(),
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
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
      return await this.write(request, "qc.approve", "production_record.approved", "production_record", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, approveAuthorityRoles, "QC Manager or Operations Manager authority is required");
        const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        if (before.status !== "accepted") throw new BadRequestException("production record must be accepted");
        this.requireNoActiveStopWork(before);
        this.requireQuantityAtMost(approvedQuantity, before.accepted_quantity, "approved_quantity", "accepted_quantity");
        const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
          status: "approved",
          approved_quantity: approvedQuantity,
          approved_by: request.auth.userId,
          approved_at: new Date(),
        });
        if (!after) throw new NotFoundException("production record not found");
        return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("production-records/:id/mark-billable")
  @RequirePermission("production.mark_billable")
  async markBillable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "production.mark_billable", "production_record.billable", "production_record", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, billableAuthorityRoles, "Billing Manager or QC Manager authority is required");
      const before = await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
      if (before.status !== "approved") throw new BadRequestException("production record must be approved");
      this.requireNoActiveStopWork(before);
      if (!before.approved_quantity || Number(before.approved_quantity) <= 0) throw new BadRequestException("approved_quantity must be > 0");
      if (!(await this.hasActiveEvidence(client, request.auth.tenantId, id))) throw new BadRequestException("active evidence is required");
      const rateCodeId = body.rate_code_id ?? before.rate_code_id;
      if (!rateCodeId) throw new BadRequestException("rate_code_id is required");
      await this.requireActiveRateCode(client, request.auth.tenantId, rateCodeId, String(before.unit_type));
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, {
        rate_code_id: rateCodeId,
        status: "billable",
        billable_status: "billable",
      });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
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
      const after = await updateTenantRecord(client, "production_records", request.auth.tenantId, id, { status: "qc_review" });
      if (!after) throw new NotFoundException("production record not found");
      return { entityType: "production_record", entityId: id, beforeState: before, afterState: after };
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
  async archiveProductionRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "production_records", id, "production_record", "production_record.archive", "production_record.archived");
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
      if (!this.hasEvidenceReference(body)) throw new Error("description, file_id, or source_url is required");
      return await this.write(request, "production_evidence.create", "production_evidence.created", "production_evidence", async (client) => {
        await this.requireRecord(client, "production_records", request.auth.tenantId, id, "production record not found");
        const summary = typeof body.description === "string" && body.description.trim() ? body.description.trim() : evidenceType;
        const evidence = await insertTenantRecord(client, "production_evidence", request.auth.tenantId, {
          production_record_id: id,
          evidence_type: evidenceType,
          summary,
          description: body.description,
          source_url: body.source_url,
          file_id: body.file_id,
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
      const values = pick(body, ["description", "source_url", "file_id"]);
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
  async archiveEvidence(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "production_evidence", id, "production_evidence", "production_evidence.archive", "production_evidence.archived");
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
    return ["description", "file_id", "source_url"].some((key) => typeof body[key] === "string" && body[key].trim());
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
