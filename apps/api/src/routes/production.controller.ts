import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireAllowed, requireString } from "./intelligence.types";

const projectStatuses = new Set(["created", "planning", "ready_for_work", "active", "on_hold", "completed", "closed", "archived"]);
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
  async listProjects(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "projects", request.auth.tenantId, { searchColumns: ["name", "status"] }));
  }

  @Get("projects/:id")
  @RequirePermission("project.read")
  async getProject(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found"));
  }

  @Post("projects")
  @RequirePermission("project.create")
  async createProject(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "project name is required");
      return await this.write(request, "project.create", "project.created", "project", async (client) => {
        const opportunity = await this.requireRecord(client, "opportunities", request.auth.tenantId, this.requiredId(body.opportunity_id, "opportunity_id"), "opportunity not found");
        if (opportunity.status !== "awarded") throw new BadRequestException("opportunity must be awarded");
        await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.customer_organization_id, "customer_organization_id"), "customer organization not found");
        const project = await insertTenantRecord(client, "projects", request.auth.tenantId, {
          opportunity_id: body.opportunity_id,
          customer_organization_id: body.customer_organization_id,
          name,
          status: "created",
        });
        return { entityType: "project", entityId: project.id, afterState: project };
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
      const values = pick(body, ["name", "status"]);
      return await this.write(request, "project.update", "project.updated", "project", async (client) => {
        const before = await this.requireRecord(client, "projects", request.auth.tenantId, id, "project not found");
        if (body.opportunity_id) {
          await this.requireRecord(client, "opportunities", request.auth.tenantId, this.requiredId(body.opportunity_id, "opportunity_id"), "opportunity not found");
          values.opportunity_id = body.opportunity_id;
        }
        if (body.customer_organization_id) {
          await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.customer_organization_id, "customer_organization_id"), "customer organization not found");
          values.customer_organization_id = body.customer_organization_id;
        }
        const after = await updateTenantRecord(client, "projects", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("project not found");
        return { entityType: "project", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("projects/:id/archive")
  @RequirePermission("project.archive")
  async archiveProject(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "projects", id, "project", "project.archive", "project.archived");
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
