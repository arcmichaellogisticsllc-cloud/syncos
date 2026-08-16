import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { appendAuditLog, executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { OrganizationScopeService } from "../security/organization-scope";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireAllowed, requireString } from "./intelligence.types";

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const signerRoles = new Set(["partner_representative_1", "partner_representative_2", "sync_representative"]);
const partnerSignerRoles = new Set(["partner_representative_1", "partner_representative_2"]);
const agreementArtifactCategories = new Set(["partner_msa_executed", "partner_msa_amendment_executed", "partner_work_order_executed", "partner_vehicle_agreement_executed"]);
const woResponsibilities = new Set(["partner", "sync", "customer", "project_specific", "not_applicable"]);

type PartnerScopeRow = QueryResultRow & {
  user_id: string;
  display_name: string;
  tenant_user_id: string;
  role_key: "partner_admin" | "partner_foreman";
  organization_id: string;
  organization_name: string;
  organization_status: string;
  capacity_provider_id: string;
  capacity_provider_name: string;
  provider_type: string;
  provider_status: string;
};

type PartnerContext = {
  user: { id: string; display_name: string; tenant_user_id: string };
  tenant_id: string;
  persona: "partner_admin" | "partner_foreman";
  organization: { id: string; name: string; status: string };
  capacityProvider: { id: string; name: string; provider_type: string; status: string };
};

type FileRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  organization_id: string;
  category: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  checksum: string;
  storage_key: string;
};

@Controller("partner-agreements")
export class PartnerAgreementsController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  @Get("me/agreements")
  @RequirePermission("partner_agreement.read")
  async ownAgreements(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const result = await client.query(
        `
        SELECT c.id AS contract_id, c.name, c.contract_number, c.status AS contract_status,
          v.id AS version_id, v.version_number, v.status, v.effective_date,
          v.pay_when_paid, v.partner_invoice_required, v.payout_after_cleared_funds_business_days,
          v.partial_customer_payment_pro_rata, v.customer_retainage_pass_through_may_apply,
          v.settlement_dispute_window_calendar_days, v.workmanship_warranty_months, v.no_guaranteed_work
        FROM contracts c
        JOIN partner_agreement_versions v ON v.tenant_id = c.tenant_id AND v.contract_id = c.id AND v.deleted_at IS NULL
        WHERE c.tenant_id = $1 AND c.partner_organization_id = $2 AND c.deleted_at IS NULL
        ORDER BY c.created_at DESC, v.version_number DESC
        `,
        [context.tenant_id, context.organization.id],
      );
      return result.rows.map((row) => this.safeAgreement(row));
    });
  }

  @Get("me/agreements/:versionId/artifact")
  @RequirePermission("partner_agreement.artifact.read")
  async ownAgreementArtifact(@Req() request: AuthenticatedRequest, @Param("versionId") versionId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const version = await this.requireAgreementVersion(client, context.tenant_id, context.organization.id, versionId);
      if (!version.artifact_file_object_id || !version.artifact_verified_at) throw new NotFoundException("executed artifact not found");
      const file = await this.requireFile(client, context.tenant_id, context.organization.id, version.artifact_file_object_id);
      return this.readAuthorizedFile(client, request, file);
    });
  }

  @Post("me/agreements/:versionId/signatures")
  @RequirePermission("partner_agreement.sign")
  async partnerAgreementSignature(@Req() request: AuthenticatedRequest, @Param("versionId") versionId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const version = await this.requireAgreementVersion(client, context.tenant_id, context.organization.id, versionId);
      return this.recordPartnerSignature(client, request, context, "master_agreement", version.id, body);
    });
  }

  @Get("me/work-orders")
  @RequirePermission("partner_work_order.read")
  async ownWorkOrders(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const result = await client.query(
        `
        SELECT wov.*, p.name AS project_name, o.name AS customer_name, rc.amount AS partner_rate_amount, rc.unit AS partner_rate_unit
        FROM partner_work_order_versions wov
        JOIN projects p ON p.tenant_id = wov.tenant_id AND p.id = wov.project_id
        LEFT JOIN organizations o ON o.tenant_id = p.tenant_id AND o.id = p.customer_organization_id
        LEFT JOIN rate_codes rc ON rc.tenant_id = wov.tenant_id AND rc.id = wov.rate_code_id
        WHERE wov.tenant_id = $1 AND wov.organization_id = $2 AND wov.deleted_at IS NULL
        ORDER BY wov.created_at DESC
        `,
        [context.tenant_id, context.organization.id],
      );
      return result.rows.map((row) => this.safeWorkOrder(row, true));
    });
  }

  @Get("me/work-orders/:versionId/artifact")
  @RequirePermission("partner_work_order.artifact.read")
  async ownWorkOrderArtifact(@Req() request: AuthenticatedRequest, @Param("versionId") versionId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const version = await this.requireWorkOrderVersion(client, context.tenant_id, context.organization.id, versionId);
      if (!version.artifact_file_object_id || !version.artifact_verified_at) throw new NotFoundException("executed artifact not found");
      return this.readAuthorizedFile(client, request, await this.requireFile(client, context.tenant_id, context.organization.id, version.artifact_file_object_id));
    });
  }

  @Post("me/work-orders/:versionId/signatures")
  @RequirePermission("partner_work_order.sign")
  async partnerWorkOrderSignature(@Req() request: AuthenticatedRequest, @Param("versionId") versionId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const version = await this.requireWorkOrderVersion(client, context.tenant_id, context.organization.id, versionId);
      return this.recordPartnerSignature(client, request, context, "work_order", version.id, body);
    });
  }

  @Get("me/vehicle-assignments")
  @RequirePermission("partner_vehicle_assignment.read")
  async ownVehicleAssignments(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const result = await this.listVehicleAssignments(client, context.tenant_id, context.organization.id);
      return result.map((row) => this.safeVehicleAssignment(row));
    });
  }

  @Get("me/vehicle-assignments/:assignmentId/allocation-preview")
  @RequirePermission("partner_vehicle_assignment.allocation.read")
  async ownAllocationPreview(@Req() request: AuthenticatedRequest, @Param("assignmentId") assignmentId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const assignment = await this.requireVehicleAssignment(client, context.tenant_id, context.organization.id, assignmentId);
      return this.allocationPreview(assignment, query.period_end);
    });
  }

  @Get("me/vehicle-assignments/:assignmentId/artifact")
  @RequirePermission("partner_vehicle_assignment.artifact.read")
  async ownVehicleArtifact(@Req() request: AuthenticatedRequest, @Param("assignmentId") assignmentId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const assignment = await this.requireVehicleAssignment(client, context.tenant_id, context.organization.id, assignmentId);
      if (!assignment.artifact_file_object_id || !assignment.artifact_verified_at) throw new NotFoundException("executed artifact not found");
      return this.readAuthorizedFile(client, request, await this.requireFile(client, context.tenant_id, context.organization.id, assignment.artifact_file_object_id));
    });
  }

  @Post("me/vehicle-assignments/:assignmentId/signatures")
  @RequirePermission("partner_vehicle_assignment.sign")
  async partnerVehicleSignature(@Req() request: AuthenticatedRequest, @Param("assignmentId") assignmentId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const assignment = await this.requireVehicleAssignment(client, context.tenant_id, context.organization.id, assignmentId);
      return this.recordPartnerSignature(client, request, context, "vehicle_agreement", assignment.id, body);
    });
  }

  @Get("foreman/work-order")
  @RequirePermission("partner_work_order.foreman_summary.read")
  async foremanWorkOrder(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const crew = await this.requireForemanCrew(client, context);
      const result = await client.query(
        `
        SELECT wov.*, p.name AS project_name, o.name AS customer_name, va.id AS vehicle_assignment_id, e.name AS equipment_name, e.equipment_type
        FROM partner_work_order_versions wov
        JOIN projects p ON p.tenant_id = wov.tenant_id AND p.id = wov.project_id
        LEFT JOIN organizations o ON o.tenant_id = p.tenant_id AND o.id = p.customer_organization_id
        LEFT JOIN partner_vehicle_assignments va ON va.tenant_id = wov.tenant_id AND va.work_order_version_id = wov.id AND va.deleted_at IS NULL
        LEFT JOIN equipment e ON e.tenant_id = va.tenant_id AND e.id = va.equipment_id
        WHERE wov.tenant_id = $1 AND wov.organization_id = $2 AND wov.assigned_crew_id = $3 AND wov.deleted_at IS NULL AND wov.status IN ('executed', 'active')
        ORDER BY wov.created_at DESC
        LIMIT 1
        `,
        [context.tenant_id, context.organization.id, crew.id],
      );
      if (!result.rows[0]) throw new NotFoundException("assigned work order not found");
      return this.safeForemanWorkOrder(result.rows[0]);
    });
  }

  @Post("organizations/:organizationId/agreements")
  @RequirePermission("partner_agreement.manage")
  async createAgreement(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const provider = await this.requirePartnerProvider(client, request.auth.tenantId, organizationId, body.capacity_provider_id);
      return this.writeWithClient(client, request, "partner_agreement.create", "partner_agreement.created", "partner_agreement", async (writeClient) => {
        const contract = await writeClient.query(
          `
          INSERT INTO contracts (tenant_id, organization_id, partner_organization_id, capacity_provider_id, name, contract_number, contract_type, status, agreement_lifecycle_status)
          VALUES ($1, $2, $2, $3, $4, $5, 'partner_master_agreement', 'draft', 'draft')
          RETURNING *
          `,
          [request.auth.tenantId, organizationId, provider.id, requireString(body.name ?? "Master Project Partner Agreement", "name is required"), body.agreement_number ?? null],
        );
        const version = await writeClient.query(
          `
          INSERT INTO partner_agreement_versions (tenant_id, organization_id, capacity_provider_id, contract_id, version_number, status, issued_date, created_by_user_id)
          VALUES ($1, $2, $3, $4, 1, 'draft', $5, $6)
          RETURNING *
          `,
          [request.auth.tenantId, organizationId, provider.id, contract.rows[0].id, body.issued_date ?? null, request.auth.userId],
        );
        return { entityType: "partner_agreement", entityId: contract.rows[0].id, afterState: this.safeAgreement({ ...contract.rows[0], ...version.rows[0] }) };
      });
    });
  }

  @Post("organizations/:organizationId/agreements/:versionId/signatories")
  @RequirePermission("partner_agreement.manage")
  async addAgreementSignatory(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.addSignatory(request, organizationId, "master_agreement", versionId, body);
  }

  @Post("organizations/:organizationId/agreements/:versionId/artifact")
  @RequirePermission("partner_agreement.artifact.review")
  async uploadAgreementArtifact(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const version = await this.requireAgreementVersion(client, request.auth.tenantId, organizationId, versionId);
      return this.writeWithClient(client, request, "restricted_legal_artifact.upload", "restricted_legal_artifact.uploaded", "restricted_legal_artifact", async (writeClient) => {
        const file = await this.createPdfFile(writeClient, request.auth.tenantId, organizationId, version.capacity_provider_id, request.auth.userId, version.amendment ? "partner_msa_amendment_executed" : "partner_msa_executed", "partner_agreement_version", versionId, body);
        await writeClient.query("UPDATE partner_agreement_versions SET artifact_file_object_id = $3, artifact_verified_at = now(), artifact_verified_by_user_id = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, versionId, file.id, request.auth.userId]);
        return { entityType: "restricted_legal_artifact", entityId: file.id, afterState: this.safeFile(file) };
      });
    });
  }

  @Post("organizations/:organizationId/agreements/:versionId/signatures")
  @RequirePermission("partner_agreement.review")
  async internalAgreementSignature(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.internalSignature(request, organizationId, "master_agreement", versionId, body);
  }

  @Post("organizations/:organizationId/agreements/:versionId/activate")
  @RequirePermission("partner_agreement.review")
  async activateAgreement(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      return this.writeWithClient(client, request, "partner_agreement.activate", "partner_agreement.effective", "partner_agreement", async (writeClient) => {
        const version = await this.requireAgreementVersion(writeClient, request.auth.tenantId, organizationId, versionId);
        const effectiveDate = await this.requireExecutable(writeClient, request.auth.tenantId, organizationId, "master_agreement", versionId, version.artifact_file_object_id);
        const after = await writeClient.query(
          `
          UPDATE partner_agreement_versions SET status = 'effective', effective_date = $4, executed_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND organization_id = $2 AND id = $3
          RETURNING *
          `,
          [request.auth.tenantId, organizationId, versionId, effectiveDate],
        );
        await writeClient.query("UPDATE contracts SET status = 'active', agreement_lifecycle_status = 'active', agreement_effective_date = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, version.contract_id, effectiveDate]);
        return {
          entityType: "partner_agreement",
          entityId: version.contract_id,
          beforeState: this.safeAgreement(version),
          afterState: this.safeAgreement(after.rows[0]),
          additionalEvents: [{
            action: "partner_agreement.execute",
            aggregateType: "partner_agreement",
            entityType: "partner_agreement",
            entityId: version.contract_id,
            eventType: "partner_agreement.executed",
            afterState: { organization_id: organizationId, version_id: versionId, effective_date: effectiveDate },
          }],
        };
      });
    });
  }

  @Post("organizations/:organizationId/work-orders")
  @RequirePermission("partner_work_order.manage")
  async createPartnerWorkOrder(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const provider = await this.requirePartnerProvider(client, request.auth.tenantId, organizationId, body.capacity_provider_id);
      const agreement = await this.requireAgreementVersion(client, request.auth.tenantId, organizationId, requireString(body.governing_agreement_version_id, "governing_agreement_version_id is required"));
      if (agreement.status !== "effective") throw new BadRequestException("active governing MSA version is required");
      const project = await this.requireTenantRecord(client, "projects", request.auth.tenantId, requireString(body.project_id, "project_id is required"), "project not found");
      const crew = await this.requireCrew(client, request.auth.tenantId, organizationId, requireString(body.assigned_crew_id, "assigned_crew_id is required"));
      return this.writeWithClient(client, request, "partner_work_order.create", "partner_work_order.created", "partner_work_order", async (writeClient) => {
        const rate = await this.createPartnerRate(writeClient, request.auth.tenantId, organizationId, body);
        const wo = await writeClient.query(
          `
          INSERT INTO work_orders (
            tenant_id, project_id, assigned_capacity_provider_id, assigned_crew_id, title, work_type, expected_units, unit_type, status,
            work_order_name, work_order_number, scope_summary, location_summary, map_link, assignment_type, assigned_organization_id,
            partner_organization_id, partner_rate_schedule_id, governing_agreement_version_id, partner_execution_status, unit, planned_quantity, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::numeric, 0), $8, 'draft', $5, $9, $10, $11, $12, 'partner_contractor', $13, $13, $14, $15, 'draft', $8, COALESCE($7::numeric, 0), $16, $16)
          RETURNING *
          `,
          [
            request.auth.tenantId,
            project.id,
            provider.id,
            crew.id,
            requireString(body.work_order_name ?? body.title, "work_order_name is required"),
            requireString(body.work_type ?? "fiber_hanging_overlash", "work_type is required"),
            body.performance_target ?? null,
            requireString(body.production_unit ?? "feet", "production_unit is required"),
            requireString(body.work_order_number, "work_order_number is required"),
            requireString(body.scope_summary, "scope_summary is required"),
            body.primary_work_area ?? null,
            requireString(body.map_work_package_ref, "map_work_package_ref is required"),
            organizationId,
            rate.schedule.id,
            agreement.id,
            request.auth.userId,
          ],
        );
        const version = await writeClient.query(
          `
          INSERT INTO partner_work_order_versions (
            tenant_id, organization_id, capacity_provider_id, project_id, work_order_id, version_number, governing_agreement_version_id, assigned_crew_id,
            rate_schedule_id, rate_code_id, work_order_number, scope_summary, primary_work_area, map_work_package_ref, production_unit,
            performance_target, housing_responsibility, traffic_control_responsibility, fuel_tolls_responsibility, status, issued_date, created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'draft', $19, $20)
          RETURNING *
          `,
          [
            request.auth.tenantId,
            organizationId,
            provider.id,
            project.id,
            wo.rows[0].id,
            agreement.id,
            crew.id,
            rate.schedule.id,
            rate.code.id,
            body.work_order_number,
            body.scope_summary,
            body.primary_work_area ?? null,
            body.map_work_package_ref,
            body.production_unit ?? "feet",
            body.performance_target ?? null,
            this.responsibility(body.housing_responsibility, "housing_responsibility"),
            this.responsibility(body.traffic_control_responsibility, "traffic_control_responsibility"),
            body.fuel_tolls_responsibility ?? "partner",
            body.issued_date ?? null,
            request.auth.userId,
          ],
        );
        await writeClient.query("INSERT INTO partner_work_order_crew_assignments (tenant_id, organization_id, capacity_provider_id, work_order_id, work_order_version_id, crew_id, assigned_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)", [request.auth.tenantId, organizationId, provider.id, wo.rows[0].id, version.rows[0].id, crew.id, request.auth.userId]);
        return {
          entityType: "partner_work_order",
          entityId: wo.rows[0].id,
          afterState: this.safeWorkOrder(version.rows[0], false),
          additionalEvents: [{
            action: "partner_work_order.rate_schedule_assign",
            aggregateType: "partner_work_order",
            entityType: "partner_work_order",
            entityId: wo.rows[0].id,
            eventType: "partner_work_order.rate_schedule_assigned",
            afterState: { organization_id: organizationId, rate_schedule_id: rate.schedule.id, rate_code_id: rate.code.id },
          }],
        };
      });
    });
  }

  @Post("organizations/:organizationId/work-orders/:versionId/signatories")
  @RequirePermission("partner_work_order.manage")
  async addWorkOrderSignatory(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.addSignatory(request, organizationId, "work_order", versionId, body);
  }

  @Post("organizations/:organizationId/work-orders/:versionId/artifact")
  @RequirePermission("partner_work_order.manage")
  async uploadWorkOrderArtifact(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.uploadVersionArtifact(request, organizationId, "work_order", versionId, "partner_work_order_executed", body);
  }

  @Post("organizations/:organizationId/work-orders/:versionId/signatures")
  @RequirePermission("partner_work_order.manage")
  async internalWorkOrderSignature(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.internalSignature(request, organizationId, "work_order", versionId, body);
  }

  @Post("organizations/:organizationId/work-orders/:versionId/activate")
  @RequirePermission("partner_work_order.manage")
  async activateWorkOrder(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      return this.writeWithClient(client, request, "partner_work_order.activate", "partner_work_order.activated", "partner_work_order", async (writeClient) => {
        const version = await this.requireWorkOrderVersion(writeClient, request.auth.tenantId, organizationId, versionId);
        const effectiveDate = await this.requireExecutable(writeClient, request.auth.tenantId, organizationId, "work_order", versionId, version.artifact_file_object_id);
        const after = await writeClient.query("UPDATE partner_work_order_versions SET status = 'active', effective_date = $4, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 RETURNING *", [request.auth.tenantId, organizationId, versionId, effectiveDate]);
        await writeClient.query("UPDATE work_orders SET status = 'assigned', partner_execution_status = 'active', partner_effective_date = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, version.work_order_id, effectiveDate]);
        return { entityType: "partner_work_order", entityId: version.work_order_id, beforeState: this.safeWorkOrder(version, false), afterState: this.safeWorkOrder(after.rows[0], false) };
      });
    });
  }

  @Post("organizations/:organizationId/vehicle-assignments")
  @RequirePermission("partner_vehicle_assignment.manage")
  async createVehicleAssignment(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const version = await this.requireWorkOrderVersion(client, request.auth.tenantId, organizationId, requireString(body.work_order_version_id, "work_order_version_id is required"));
      const equipment = await this.requireTenantRecord(client, "equipment", request.auth.tenantId, requireString(body.equipment_id, "equipment_id is required"), "equipment not found");
      if (equipment.capacity_provider_id && equipment.capacity_provider_id === version.capacity_provider_id) throw new BadRequestException("Partner-owned equipment is not assignable through Sync-rented assignment route");
      return this.writeWithClient(client, request, "vehicle_assignment.create", "vehicle_assignment.created", "vehicle_assignment", async (writeClient) => {
        const result = await writeClient.query(
          `
          INSERT INTO partner_vehicle_assignments (
            tenant_id, organization_id, capacity_provider_id, equipment_id, work_order_id, work_order_version_id, crew_id,
            rental_provider, sync_possession_date, partner_custody_start_date, daily_allocation_amount, currency, timezone,
            odometer_at_assignment, fuel_level_at_assignment, status, created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'USD'), COALESCE($13, 'America/New_York'), $14, $15, 'active_custody', $16)
          RETURNING *
          `,
          [
            request.auth.tenantId,
            organizationId,
            version.capacity_provider_id,
            equipment.id,
            version.work_order_id,
            version.id,
            version.assigned_crew_id,
            body.rental_provider ?? null,
            body.sync_possession_date ?? null,
            requireString(body.partner_custody_start_date, "partner_custody_start_date is required"),
            this.money(body.daily_allocation_amount, "daily_allocation_amount"),
            body.currency ?? "USD",
            body.timezone ?? "America/New_York",
            body.odometer_at_assignment ?? null,
            body.fuel_level_at_assignment ?? null,
            request.auth.userId,
          ],
        );
        return { entityType: "vehicle_assignment", entityId: result.rows[0].id, afterState: this.safeVehicleAssignment(result.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/vehicle-assignments/:assignmentId/operators")
  @RequirePermission("partner_vehicle_assignment.operator.manage")
  async authorizeOperator(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("assignmentId") assignmentId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const assignment = await this.requireVehicleAssignment(client, request.auth.tenantId, organizationId, assignmentId);
      const workerId = requireString(body.worker_id, "worker_id is required");
      await this.requireCrewMember(client, request.auth.tenantId, organizationId, assignment.crew_id, workerId);
      await this.requireOperatorCredential(client, request.auth.tenantId, organizationId, workerId);
      return this.writeWithClient(client, request, "vehicle_assignment.operator_authorize", "vehicle_assignment.operator_authorized", "vehicle_operator_authorization", async (writeClient) => {
        const existing = await writeClient.query("SELECT * FROM partner_vehicle_operator_authorizations WHERE tenant_id = $1 AND vehicle_assignment_id = $2 AND worker_id = $3 AND end_date IS NULL AND qualification_status = 'approved'", [request.auth.tenantId, assignmentId, workerId]);
        if (existing.rows[0]) return { entityType: "vehicle_operator_authorization", entityId: existing.rows[0].id, afterState: this.safeOperator(existing.rows[0]) };
        const result = await writeClient.query(
          "INSERT INTO partner_vehicle_operator_authorizations (tenant_id, organization_id, vehicle_assignment_id, worker_id, crew_id, authorization_role, approved_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
          [request.auth.tenantId, organizationId, assignmentId, workerId, assignment.crew_id, body.authorization_role ?? "operator", request.auth.userId],
        );
        return { entityType: "vehicle_operator_authorization", entityId: result.rows[0].id, afterState: this.safeOperator(result.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/vehicle-assignments/:assignmentId/signatories")
  @RequirePermission("partner_vehicle_assignment.manage")
  async addVehicleSignatory(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("assignmentId") assignmentId: string, @Body() body: Record<string, unknown>) {
    return this.addSignatory(request, organizationId, "vehicle_agreement", assignmentId, body);
  }

  @Post("organizations/:organizationId/vehicle-assignments/:assignmentId/artifact")
  @RequirePermission("partner_vehicle_assignment.artifact.review")
  async uploadVehicleArtifact(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("assignmentId") assignmentId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const assignment = await this.requireVehicleAssignment(client, request.auth.tenantId, organizationId, assignmentId);
      return this.writeWithClient(client, request, "restricted_legal_artifact.upload", "restricted_legal_artifact.uploaded", "restricted_legal_artifact", async (writeClient) => {
        const file = await this.createPdfFile(writeClient, request.auth.tenantId, organizationId, assignment.capacity_provider_id, request.auth.userId, "partner_vehicle_agreement_executed", "partner_vehicle_assignment", assignmentId, body);
        await writeClient.query("UPDATE partner_vehicle_assignments SET artifact_file_object_id = $3, artifact_verified_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, assignmentId, file.id]);
        return { entityType: "restricted_legal_artifact", entityId: file.id, afterState: this.safeFile(file) };
      });
    });
  }

  @Post("organizations/:organizationId/vehicle-assignments/:assignmentId/signatures")
  @RequirePermission("partner_vehicle_assignment.manage")
  async internalVehicleSignature(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("assignmentId") assignmentId: string, @Body() body: Record<string, unknown>) {
    return this.internalSignature(request, organizationId, "vehicle_agreement", assignmentId, body);
  }

  @Post("organizations/:organizationId/vehicle-assignments/:assignmentId/conditions")
  @RequirePermission("partner_vehicle_assignment.condition.manage")
  async recordCondition(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("assignmentId") assignmentId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      await this.requireVehicleAssignment(client, request.auth.tenantId, organizationId, assignmentId);
      return this.writeWithClient(client, request, "vehicle_condition.record", "vehicle_condition.recorded", "vehicle_condition", async (writeClient) => {
        const result = await writeClient.query(
          `
          INSERT INTO partner_vehicle_condition_records (tenant_id, organization_id, vehicle_assignment_id, record_type, odometer, fuel_level, known_damage, tires_status, lights_status, brakes_steering_status, pto_hydraulics_status, outriggers_status, boom_bucket_controls_status, emergency_lowering_status, fall_protection_anchor_status, safety_equipment_status, leaks_warning_lights, external_notes, recorded_by_user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          RETURNING *
          `,
          [request.auth.tenantId, organizationId, assignmentId, requireAllowed(body.record_type, new Set(["pre_assignment", "return"]), "record_type"), body.odometer ?? null, body.fuel_level ?? null, body.known_damage ?? null, body.tires_status ?? null, body.lights_status ?? null, body.brakes_steering_status ?? null, body.pto_hydraulics_status ?? null, body.outriggers_status ?? null, body.boom_bucket_controls_status ?? null, body.emergency_lowering_status ?? null, body.fall_protection_anchor_status ?? null, body.safety_equipment_status ?? null, body.leaks_warning_lights ?? null, body.external_notes ?? null, request.auth.userId],
        );
        return { entityType: "vehicle_condition", entityId: result.rows[0].id, afterState: this.safeCondition(result.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/vehicle-assignments/:assignmentId/return")
  @RequirePermission("partner_vehicle_assignment.manage")
  async returnVehicle(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("assignmentId") assignmentId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      return this.writeWithClient(client, request, "vehicle_assignment.return", "vehicle_assignment.return_recorded", "vehicle_assignment", async (writeClient) => {
        const before = await this.requireVehicleAssignment(writeClient, request.auth.tenantId, organizationId, assignmentId);
        const returnDate = requireString(body.partner_return_release_date, "partner_return_release_date is required");
        this.allocationPreview({ ...before, partner_return_release_date: returnDate }, returnDate);
        const result = await writeClient.query("UPDATE partner_vehicle_assignments SET partner_return_release_date = $4, odometer_at_return = $5, fuel_level_at_return = $6, status = 'returned', returned_by_user_id = $7, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 RETURNING *", [request.auth.tenantId, organizationId, assignmentId, returnDate, body.odometer_at_return ?? null, body.fuel_level_at_return ?? null, request.auth.userId]);
        return { entityType: "vehicle_assignment", entityId: assignmentId, beforeState: this.safeVehicleAssignment(before), afterState: this.safeVehicleAssignment(result.rows[0]) };
      });
    });
  }

  private async addSignatory(request: AuthenticatedRequest, organizationId: string, documentType: string, documentVersionId: string, body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const role = requireAllowed(body.signer_role, signerRoles, "signer_role");
      await this.validateDocumentExists(client, request.auth.tenantId, organizationId, documentType, documentVersionId);
      if (role.startsWith("partner_")) {
        await this.requirePartnerContact(client, request.auth.tenantId, organizationId, body.contact_id);
        await this.assertDistinctPartnerSignatory(client, request.auth.tenantId, documentType, documentVersionId, role, requireString(body.full_legal_name, "full_legal_name is required"), body.contact_id);
      }
      return this.writeWithClient(client, request, `${documentType}.signatory.create`, `${documentType}.signatory_created`, "document_signatory", async (writeClient) => {
        const result = await writeClient.query(
          "INSERT INTO partner_document_signatories (tenant_id, organization_id, document_type, document_version_id, contact_id, tenant_user_id, full_legal_name, title, signer_role, authorization_status, verified_by_user_id, verified_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'authorized', $10, now()) RETURNING *",
          [request.auth.tenantId, organizationId, documentType, documentVersionId, body.contact_id ?? null, body.tenant_user_id ?? null, body.full_legal_name, requireString(body.title, "title is required"), role, request.auth.userId],
        );
        return { entityType: "document_signatory", entityId: result.rows[0].id, afterState: this.safeSignatory(result.rows[0]) };
      });
    });
  }

  private async internalSignature(request: AuthenticatedRequest, organizationId: string, documentType: string, documentVersionId: string, body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      await this.validateDocumentExists(client, request.auth.tenantId, organizationId, documentType, documentVersionId);
      return this.writeWithClient(client, request, `${documentType}.signature.verify`, `${documentType}.signature_verified`, "document_signature", async (writeClient) => {
        const signature = await this.upsertSignature(writeClient, request.auth.tenantId, organizationId, documentType, documentVersionId, requireString(body.signatory_id, "signatory_id is required"), body.signed_date ?? new Date().toISOString().slice(0, 10), "verified", request.auth.userId);
        await this.updatePartialStatus(writeClient, request.auth.tenantId, organizationId, documentType, documentVersionId);
        return { entityType: "document_signature", entityId: signature.id, afterState: this.safeSignature(signature) };
      });
    });
  }

  private async recordPartnerSignature(client: PoolClient, request: AuthenticatedRequest, context: PartnerContext, documentType: string, documentVersionId: string, body: Record<string, unknown>) {
    const signatory = await this.requireSignatory(client, context.tenant_id, context.organization.id, documentType, documentVersionId, requireString(body.signatory_id, "signatory_id is required"));
    if (!partnerSignerRoles.has(signatory.signer_role)) throw new ForbiddenException("Partner cannot record Sync signature");
    return this.writeWithClient(client, request, `${documentType}.signature.record`, `${documentType}.signature_recorded`, "document_signature", async (writeClient) => {
      const signature = await this.upsertSignature(writeClient, context.tenant_id, context.organization.id, documentType, documentVersionId, signatory.id, requireString(body.signed_date, "signed_date is required"), "submitted", null);
      await this.updatePartialStatus(writeClient, context.tenant_id, context.organization.id, documentType, documentVersionId);
      return { entityType: "document_signature", entityId: signature.id, afterState: this.safeSignature(signature) };
    });
  }

  private async uploadVersionArtifact(request: AuthenticatedRequest, organizationId: string, documentType: string, versionId: string, category: string, body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const version = await this.requireWorkOrderVersion(client, request.auth.tenantId, organizationId, versionId);
      return this.writeWithClient(client, request, "restricted_legal_artifact.upload", "restricted_legal_artifact.uploaded", "restricted_legal_artifact", async (writeClient) => {
        const file = await this.createPdfFile(writeClient, request.auth.tenantId, organizationId, version.capacity_provider_id, request.auth.userId, category, documentType === "work_order" ? "partner_work_order_version" : "partner_vehicle_assignment", versionId, body);
        await writeClient.query("UPDATE partner_work_order_versions SET artifact_file_object_id = $3, artifact_verified_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, versionId, file.id]);
        return { entityType: "restricted_legal_artifact", entityId: file.id, afterState: this.safeFile(file) };
      });
    });
  }

  private async requireExecutable(client: PoolClient, tenantId: string, organizationId: string, documentType: string, documentVersionId: string, artifactFileObjectId: string | null): Promise<string> {
    if (!artifactFileObjectId) throw new BadRequestException("verified executed artifact is required");
    const signatories = await client.query("SELECT * FROM partner_document_signatories WHERE tenant_id = $1 AND organization_id = $2 AND document_type = $3 AND document_version_id = $4 AND deleted_at IS NULL AND authorization_status = 'authorized'", [tenantId, organizationId, documentType, documentVersionId]);
    for (const role of signerRoles) {
      if (!signatories.rows.some((row) => row.signer_role === role)) throw new BadRequestException(`${role} signatory is required`);
    }
    const partnerRows = signatories.rows.filter((row) => partnerSignerRoles.has(row.signer_role));
    if (new Set(partnerRows.map((row) => row.contact_id ?? row.full_legal_name)).size !== 2) throw new BadRequestException("Partner representatives must be distinct");
    const signatures = await client.query("SELECT s.*, ds.signer_role FROM partner_document_signatures s JOIN partner_document_signatories ds ON ds.tenant_id = s.tenant_id AND ds.id = s.signatory_id WHERE s.tenant_id = $1 AND s.organization_id = $2 AND s.document_type = $3 AND s.document_version_id = $4 AND s.deleted_at IS NULL AND s.verification_status = 'verified'", [tenantId, organizationId, documentType, documentVersionId]);
    for (const role of signerRoles) {
      if (!signatures.rows.some((row) => row.signer_role === role)) throw new BadRequestException(`${role} verified signature is required`);
    }
    return signatures.rows.map((row) => this.dateOnly(row.signed_date)).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  }

  private async createPartnerRate(client: PoolClient, tenantId: string, organizationId: string, body: Record<string, unknown>) {
    const schedule = await client.query("INSERT INTO rate_schedules (tenant_id, organization_id, name, effective_date, status) VALUES ($1, $2, $3, $4, 'active') RETURNING *", [tenantId, organizationId, body.rate_schedule_name ?? `Partner WO Rate ${body.work_order_number}`, body.rate_effective_date ?? new Date().toISOString().slice(0, 10)]);
    const code = await client.query("INSERT INTO rate_codes (tenant_id, rate_schedule_id, code, description, unit, unit_type, amount, contractor_rate, status) VALUES ($1, $2, $3, $4, $5, 'production_unit', $6, $6, 'active') RETURNING *", [tenantId, schedule.rows[0].id, body.rate_code ?? "accepted_foot", body.rate_description ?? "Partner accepted production rate", body.rate_unit ?? "feet", this.money(body.partner_rate_amount, "partner_rate_amount")]);
    return { schedule: schedule.rows[0], code: code.rows[0] };
  }

  private async createPdfFile(client: PoolClient, tenantId: string, organizationId: string, capacityProviderId: string, userId: string, category: string, relatedType: string, relatedId: string, body: Record<string, unknown>): Promise<FileRow> {
    if (!agreementArtifactCategories.has(category)) throw new BadRequestException("unsupported legal artifact category");
    this.rejectFileStorageInput(body);
    const fileName = this.sanitizeFileName(requireString(body.file_name, "file_name is required"));
    const mimeType = requireString(body.mime_type, "mime_type is required");
    if (mimeType !== "application/pdf") throw new BadRequestException("executed legal artifact must be application/pdf");
    const bytes = Buffer.from(requireString(body.content_base64, "content_base64 is required"), "base64");
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new BadRequestException("invalid PDF content");
    if (bytes.length <= 0 || bytes.length > 8 * 1024 * 1024) throw new BadRequestException("PDF size is outside allowed range");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `${tenantId}/${organizationId}/${randomUUID()}.pdf`;
    const root = process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR || "/private/tmp/syncos-restricted-files";
    const fullPath = path.join(root, storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes, { flag: "wx" });
    const result = await client.query<FileRow>(
      `
      INSERT INTO partner_restricted_file_objects (tenant_id, organization_id, capacity_provider_id, category, related_entity_type, related_entity_id, file_name, mime_type, size_bytes, checksum, storage_key, uploaded_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'application/pdf', $8, $9, $10, $11)
      RETURNING *
      `,
      [tenantId, organizationId, capacityProviderId, category, relatedType, relatedId, fileName, bytes.length, checksum, storageKey, userId],
    );
    return result.rows[0];
  }

  private async readAuthorizedFile(client: PoolClient, request: AuthenticatedRequest, file: FileRow) {
    const root = process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR || "/private/tmp/syncos-restricted-files";
    const bytes = await readFile(path.join(root, file.storage_key));
    await appendAuditLog(client, { tenantId: request.auth.tenantId, actorUserId: request.auth.userId, action: "restricted_legal_artifact.access", entityType: "restricted_legal_artifact", entityId: file.id, metadata: { category: file.category, organization_id: file.organization_id } });
    return { id: file.id, file_name: file.file_name, mime_type: file.mime_type, size_bytes: Number(file.size_bytes), checksum: file.checksum, content_base64: bytes.toString("base64") };
  }

  private async requirePartnerAdmin(client: PoolClient, request: AuthenticatedRequest, requestedOrganizationId?: string): Promise<PartnerContext> {
    const context = await this.partnerContext(client, request, "partner_admin", requestedOrganizationId);
    if (requestedOrganizationId && requestedOrganizationId !== context.organization.id) throw new ForbiddenException("invalid Partner Organization scope");
    return context;
  }

  private async requirePartnerForeman(client: PoolClient, request: AuthenticatedRequest): Promise<PartnerContext> {
    return this.partnerContext(client, request, "partner_foreman");
  }

  private async partnerContext(client: PoolClient, request: AuthenticatedRequest, roleKey: "partner_admin" | "partner_foreman", requestedOrganizationId?: string): Promise<PartnerContext> {
    const result = await client.query<PartnerScopeRow>(
      `
      SELECT u.id AS user_id, u.display_name, tu.id AS tenant_user_id, r.system_key AS role_key,
        o.id AS organization_id, o.name AS organization_name, o.status AS organization_status,
        cp.id AS capacity_provider_id, cp.name AS capacity_provider_name, cp.provider_type, cp.status AS provider_status
      FROM tenant_users tu
      JOIN users u ON u.id = tu.user_id
      JOIN user_roles ur ON ur.tenant_user_id = tu.id
      JOIN roles r ON r.id = ur.role_id
      JOIN organizations o ON o.tenant_id = tu.tenant_id AND o.id = ur.scope_id
      JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.deleted_at IS NULL
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active'
        AND r.system_key = $3 AND ur.scope_type = 'organization'
        AND o.deleted_at IS NULL AND cp.provider_type = ANY($4) AND cp.status <> 'archived'
      ORDER BY cp.created_at ASC
      `,
      [request.auth.tenantId, request.auth.userId, roleKey, [...partnerProviderTypes]],
    );
    const rows = result.rows;
    const selected = requestedOrganizationId ? rows.find((row) => row.organization_id === requestedOrganizationId) : rows[0];
    if (!selected || (!requestedOrganizationId && rows.length !== 1)) throw new ForbiddenException("Partner scope is unavailable or ambiguous");
    return {
      user: { id: selected.user_id, display_name: selected.display_name, tenant_user_id: selected.tenant_user_id },
      tenant_id: request.auth.tenantId,
      persona: roleKey,
      organization: { id: selected.organization_id, name: selected.organization_name, status: selected.organization_status },
      capacityProvider: { id: selected.capacity_provider_id, name: selected.capacity_provider_name, provider_type: selected.provider_type, status: selected.provider_status },
    };
  }

  private async requireInternalOrganizationAccess(client: PoolClient, request: AuthenticatedRequest, organizationId: string) {
    await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, "capacity_provider.read");
  }

  private async requirePartnerProvider(client: PoolClient, tenantId: string, organizationId: string, providerId?: unknown) {
    const params: unknown[] = [tenantId, organizationId];
    let where = "tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND provider_type = ANY($3)";
    params.push([...partnerProviderTypes]);
    if (providerId) {
      params.push(providerId);
      where += ` AND id = $${params.length}`;
    }
    const result = await client.query(`SELECT * FROM capacity_providers WHERE ${where} ORDER BY created_at ASC LIMIT 1`, params);
    if (!result.rows[0]) throw new NotFoundException("eligible Partner capacity provider not found");
    return result.rows[0];
  }

  private async requireTenantRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException(message);
    return result.rows[0];
  }

  private async requireAgreementVersion(client: PoolClient, tenantId: string, organizationId: string, versionId: string) {
    const result = await client.query("SELECT * FROM partner_agreement_versions WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL", [tenantId, organizationId, versionId]);
    if (!result.rows[0]) throw new NotFoundException("agreement version not found");
    return result.rows[0];
  }

  private async requireWorkOrderVersion(client: PoolClient, tenantId: string, organizationId: string, versionId: string) {
    const result = await client.query("SELECT * FROM partner_work_order_versions WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL", [tenantId, organizationId, versionId]);
    if (!result.rows[0]) throw new NotFoundException("work order version not found");
    return result.rows[0];
  }

  private async requireVehicleAssignment(client: PoolClient, tenantId: string, organizationId: string, assignmentId: string) {
    const result = await client.query("SELECT * FROM partner_vehicle_assignments WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL", [tenantId, organizationId, assignmentId]);
    if (!result.rows[0]) throw new NotFoundException("vehicle assignment not found");
    return result.rows[0];
  }

  private async requireFile(client: PoolClient, tenantId: string, organizationId: string, fileId: string): Promise<FileRow> {
    const result = await client.query<FileRow>("SELECT * FROM partner_restricted_file_objects WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL", [tenantId, organizationId, fileId]);
    if (!result.rows[0]) throw new NotFoundException("restricted artifact not found");
    return result.rows[0];
  }

  private async requireSignatory(client: PoolClient, tenantId: string, organizationId: string, documentType: string, documentVersionId: string, signatoryId: string) {
    const result = await client.query("SELECT * FROM partner_document_signatories WHERE tenant_id = $1 AND organization_id = $2 AND document_type = $3 AND document_version_id = $4 AND id = $5 AND deleted_at IS NULL", [tenantId, organizationId, documentType, documentVersionId, signatoryId]);
    if (!result.rows[0]) throw new NotFoundException("signatory not found");
    return result.rows[0];
  }

  private async requirePartnerContact(client: PoolClient, tenantId: string, organizationId: string, contactId: unknown) {
    const id = requireString(contactId, "Partner representative contact_id is required");
    const result = await client.query("SELECT * FROM contacts WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL", [tenantId, organizationId, id]);
    if (!result.rows[0]) throw new BadRequestException("Partner representative must be an authorized contact for the Partner Organization");
    return result.rows[0];
  }

  private async requireCrew(client: PoolClient, tenantId: string, organizationId: string, crewId: string) {
    const result = await client.query("SELECT * FROM crews WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL", [tenantId, organizationId, crewId]);
    if (!result.rows[0]) throw new NotFoundException("Crew not found");
    return result.rows[0];
  }

  private async requireCrewMember(client: PoolClient, tenantId: string, organizationId: string, crewId: string, workerId: string) {
    const result = await client.query("SELECT * FROM partner_crew_memberships WHERE tenant_id = $1 AND organization_id = $2 AND crew_id = $3 AND worker_id = $4 AND status = 'active' AND deleted_at IS NULL", [tenantId, organizationId, crewId, workerId]);
    if (!result.rows[0]) throw new BadRequestException("operator must be an active member of the assigned Crew");
  }

  private async requireOperatorCredential(client: PoolClient, tenantId: string, organizationId: string, workerId: string) {
    const result = await client.query("SELECT * FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND credential_type = 'driver_license' AND status = 'verified' AND deleted_at IS NULL AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)", [tenantId, organizationId, workerId]);
    if (!result.rows[0]) throw new BadRequestException("verified unexpired driver/operator credential is required");
  }

  private async requireForemanCrew(client: PoolClient, context: PartnerContext) {
    const result = await client.query(
      `
      SELECT pcm.crew_id AS id
      FROM partner_worker_user_links link
      JOIN partner_crew_memberships pcm ON pcm.tenant_id = link.tenant_id AND pcm.worker_id = link.worker_id
      WHERE link.tenant_id = $1 AND link.organization_id = $2 AND link.tenant_user_id = $3 AND link.status = 'active' AND link.deleted_at IS NULL
        AND pcm.status = 'active' AND pcm.deleted_at IS NULL AND pcm.membership_role IN ('foreman', 'alternate_foreman')
      LIMIT 1
      `,
      [context.tenant_id, context.organization.id, context.user.tenant_user_id],
    );
    if (!result.rows[0]) throw new ForbiddenException("Foreman Crew link is required");
    return result.rows[0];
  }

  private async validateDocumentExists(client: PoolClient, tenantId: string, organizationId: string, documentType: string, documentVersionId: string) {
    if (documentType === "master_agreement") await this.requireAgreementVersion(client, tenantId, organizationId, documentVersionId);
    else if (documentType === "work_order") await this.requireWorkOrderVersion(client, tenantId, organizationId, documentVersionId);
    else await this.requireVehicleAssignment(client, tenantId, organizationId, documentVersionId);
  }

  private async assertDistinctPartnerSignatory(client: PoolClient, tenantId: string, documentType: string, documentVersionId: string, role: string, name: string, contactId: unknown) {
    const otherRole = role === "partner_representative_1" ? "partner_representative_2" : "partner_representative_1";
    const result = await client.query("SELECT * FROM partner_document_signatories WHERE tenant_id = $1 AND document_type = $2 AND document_version_id = $3 AND signer_role = $4 AND deleted_at IS NULL AND authorization_status <> 'revoked'", [tenantId, documentType, documentVersionId, otherRole]);
    const other = result.rows[0];
    if (other && ((contactId && other.contact_id === contactId) || (!contactId && other.full_legal_name.trim().toLowerCase() === name.trim().toLowerCase()))) throw new BadRequestException("Partner representatives must be distinct people");
  }

  private async upsertSignature(client: PoolClient, tenantId: string, organizationId: string, documentType: string, documentVersionId: string, signatoryId: string, signedDate: unknown, status: "submitted" | "verified", verifier: string | null) {
    const signatory = await this.requireSignatory(client, tenantId, organizationId, documentType, documentVersionId, signatoryId);
    const existing = await client.query("SELECT * FROM partner_document_signatures WHERE tenant_id = $1 AND signatory_id = $2 AND deleted_at IS NULL AND verification_status IN ('submitted', 'verified')", [tenantId, signatoryId]);
    if (existing.rows[0]) {
      if (status === "verified" && existing.rows[0].verification_status !== "verified") {
        const updated = await client.query("UPDATE partner_document_signatures SET verification_status = 'verified', verified_by_user_id = $3, verified_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *", [tenantId, existing.rows[0].id, verifier]);
        return updated.rows[0];
      }
      return existing.rows[0];
    }
    const result = await client.query("INSERT INTO partner_document_signatures (tenant_id, organization_id, signatory_id, document_type, document_version_id, signer_role, signed_date, verification_status, verified_by_user_id, verified_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $8 = 'verified' THEN now() ELSE NULL END) RETURNING *", [tenantId, organizationId, signatoryId, documentType, documentVersionId, signatory.signer_role, signedDate, status, verifier]);
    return result.rows[0];
  }

  private async updatePartialStatus(client: PoolClient, tenantId: string, organizationId: string, documentType: string, documentVersionId: string) {
    const verified = await client.query("SELECT count(*)::int AS count FROM partner_document_signatures WHERE tenant_id = $1 AND organization_id = $2 AND document_type = $3 AND document_version_id = $4 AND verification_status = 'verified' AND deleted_at IS NULL", [tenantId, organizationId, documentType, documentVersionId]);
    if (Number(verified.rows[0].count) > 0) {
      if (documentType === "master_agreement") await client.query("UPDATE partner_agreement_versions SET status = CASE WHEN status = 'draft' THEN 'partially_executed' ELSE status END, updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, documentVersionId]);
      if (documentType === "work_order") await client.query("UPDATE partner_work_order_versions SET status = CASE WHEN status = 'draft' THEN 'partially_executed' ELSE status END, updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, documentVersionId]);
    }
  }

  private async listVehicleAssignments(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query("SELECT va.*, e.name AS equipment_name, e.equipment_type FROM partner_vehicle_assignments va JOIN equipment e ON e.tenant_id = va.tenant_id AND e.id = va.equipment_id WHERE va.tenant_id = $1 AND va.organization_id = $2 AND va.deleted_at IS NULL ORDER BY va.created_at DESC", [tenantId, organizationId]);
    return result.rows;
  }

  private allocationPreview(assignment: QueryResultRow, periodEnd?: string) {
    const start = assignment.partner_custody_start_date ? this.dateOnly(assignment.partner_custody_start_date) : null;
    const end = assignment.partner_return_release_date ? this.dateOnly(assignment.partner_return_release_date) : periodEnd;
    if (!start) throw new BadRequestException("partner custody start date is required");
    if (!end) throw new BadRequestException("period_end is required for open assignments");
    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    if (endDate < startDate) throw new BadRequestException("allocation end date cannot be before start date");
    const allocatedDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    const daily = Number(assignment.daily_allocation_amount);
    return { source_assignment_id: assignment.id, allocated_days: allocatedDays, daily_allocation_amount: daily, calculated_allocation_amount: Number((allocatedDays * daily).toFixed(2)), currency: assignment.currency ?? "USD", calculation_period: { start_date: start, end_date: end }, timezone: assignment.timezone ?? "America/New_York" };
  }

  private responsibility(value: unknown, label: string) {
    if (value === undefined || value === null) return "project_specific";
    return requireAllowed(value, woResponsibilities, label);
  }

  private money(value: unknown, label: string) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException(`${label} must be a non-negative number`);
    return amount;
  }

  private rejectFileStorageInput(body: Record<string, unknown>) {
    for (const key of ["storage_key", "storage_path", "storage_url", "public_url", "raw_url", "object_key", "bucket", "url", "path"]) {
      if (body[key] !== undefined) throw new BadRequestException("storage references must be created by the file service");
    }
  }

  private sanitizeFileName(name: string) {
    return path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 160) || "artifact.pdf";
  }

  private safeAgreement(row: QueryResultRow) {
    return { contract_id: row.contract_id ?? row.id, version_id: row.version_id ?? row.id, name: row.name, contract_number: row.contract_number, version_number: row.version_number, status: row.status, effective_date: this.optionalDate(row.effective_date), standing_terms: { pay_when_paid: row.pay_when_paid, partner_invoice_required: row.partner_invoice_required, payout_after_cleared_funds_business_days: row.payout_after_cleared_funds_business_days, partial_customer_payment_pro_rata: row.partial_customer_payment_pro_rata, customer_retainage_pass_through_may_apply: row.customer_retainage_pass_through_may_apply, settlement_dispute_window_calendar_days: row.settlement_dispute_window_calendar_days, workmanship_warranty_months: row.workmanship_warranty_months, no_guaranteed_work: row.no_guaranteed_work } };
  }

  private safeWorkOrder(row: QueryResultRow, includeRate: boolean) {
    return { id: row.id, work_order_id: row.work_order_id, project_id: row.project_id, project_name: row.project_name, customer_name: row.customer_name, work_order_number: row.work_order_number, scope_summary: row.scope_summary, map_work_package_ref: row.map_work_package_ref, status: row.status, effective_date: this.optionalDate(row.effective_date), performance_target: row.performance_target, production_unit: row.production_unit, partner_rate: includeRate ? { amount: row.partner_rate_amount, unit: row.partner_rate_unit } : undefined };
  }

  private safeForemanWorkOrder(row: QueryResultRow) {
    return { work_order_id: row.work_order_id, project_name: row.project_name, customer_name: row.customer_name, scope_summary: row.scope_summary, map_work_package_ref: row.map_work_package_ref, vehicle: row.vehicle_assignment_id ? { assignment_id: row.vehicle_assignment_id, equipment_name: row.equipment_name, equipment_type: row.equipment_type } : null };
  }

  private safeVehicleAssignment(row: QueryResultRow) {
    return { id: row.id, equipment_id: row.equipment_id, equipment_name: row.equipment_name, equipment_type: row.equipment_type, work_order_id: row.work_order_id, crew_id: row.crew_id, status: row.status, sync_possession_date: this.optionalDate(row.sync_possession_date), partner_custody_start_date: this.optionalDate(row.partner_custody_start_date), partner_return_release_date: this.optionalDate(row.partner_return_release_date), daily_allocation_amount: row.daily_allocation_amount, currency: row.currency, timezone: row.timezone, odometer_at_assignment: row.odometer_at_assignment, odometer_at_return: row.odometer_at_return, fuel_level_at_assignment: row.fuel_level_at_assignment, fuel_level_at_return: row.fuel_level_at_return };
  }

  private safeSignatory(row: QueryResultRow) {
    return { id: row.id, signer_role: row.signer_role, full_legal_name: row.full_legal_name, title: row.title, authorization_status: row.authorization_status };
  }

  private safeSignature(row: QueryResultRow) {
    return { id: row.id, signatory_id: row.signatory_id, signer_role: row.signer_role, signed_date: row.signed_date, verification_status: row.verification_status };
  }

  private safeFile(file: FileRow) {
    return { id: file.id, category: file.category, file_name: file.file_name, mime_type: file.mime_type, size_bytes: Number(file.size_bytes), checksum: file.checksum };
  }

  private safeOperator(row: QueryResultRow) {
    return { id: row.id, vehicle_assignment_id: row.vehicle_assignment_id, worker_id: row.worker_id, crew_id: row.crew_id, authorization_role: row.authorization_role, qualification_status: row.qualification_status };
  }

  private safeCondition(row: QueryResultRow) {
    return { id: row.id, vehicle_assignment_id: row.vehicle_assignment_id, record_type: row.record_type, odometer: row.odometer, fuel_level: row.fuel_level, known_damage: row.known_damage, external_notes: row.external_notes };
  }

  private dateOnly(value: unknown) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }

  private optionalDate(value: unknown) {
    return value === undefined || value === null ? null : this.dateOnly(value);
  }

  private async writeWithClient<T extends QueryResultRow>(
    client: PoolClient,
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
  ) {
    return executeWriteAction(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action,
      eventType,
      aggregateType,
      audit: {
        requestId: request.header("x-request-id") ?? request.header("x-correlation-id"),
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
      },
      write,
    });
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
