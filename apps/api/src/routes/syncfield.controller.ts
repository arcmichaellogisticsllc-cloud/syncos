import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { appendAuditLog, executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { OrganizationScopeService } from "../security/organization-scope";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireString } from "./intelligence.types";

type PartnerContext = {
  tenant_id: string;
  persona: "partner_admin" | "partner_foreman";
  user: { id: string; tenant_user_id: string; display_name: string };
  organization: { id: string; name: string };
  capacityProvider: { id: string; name: string };
};

type WorkOrderContext = QueryResultRow & {
  tenant_id: string;
  project_id: string;
  work_order_id: string;
  work_order_version_id: string;
  organization_id: string;
  capacity_provider_id: string;
  crew_id: string;
  crew_assignment_id: string;
  work_order_number: string;
  scope_summary: string;
  primary_work_area: string | null;
  map_work_package_ref: string;
  project_name: string;
};

type MapAssignmentRow = QueryResultRow & {
  assignment_id: string;
  project_id: string;
  work_order_id: string;
  work_order_version_id: string;
  organization_id: string;
  capacity_provider_id: string;
  crew_assignment_id: string;
  crew_id: string;
  foreman_worker_id: string;
  map_document_id: string;
  map_version_id: string;
  assignment_status: string;
  work_order_number: string;
  scope_summary: string;
  primary_work_area: string | null;
  project_name: string;
  crew_name: string;
  map_name: string;
  customer_document_number: string | null;
  revision_number: number;
  revision_label: string | null;
  page_count: number;
  processing_status: string;
  version_status: string;
  original_filename: string;
  file_hash: string;
  file_object_id: string;
};

type DailyProductionReportRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  work_order_version_id: string;
  crew_id: string;
  work_date: string;
  status: string;
  map_version_id: string | null;
};

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const mapDocumentTypes = new Set(["construction_map", "work_package", "permit_map", "other"]);
const hazardValues = new Set(["traffic", "energized_utilities", "overhead_utilities", "fall_exposure", "bucket_aerial_lift", "pole_hazards", "unsafe_pole", "guy_anchor", "trip_hazards", "public_exposure", "weather", "equipment_movement", "blocked_access", "animals", "other"]);
const controlValues = new Set(["ppe_reviewed", "traffic_control_reviewed", "fall_protection_reviewed", "equipment_inspection_complete", "emergency_procedures_reviewed", "rescue_procedures_reviewed", "communication_confirmed", "exclusion_zone_established", "stop_work_authority_reviewed", "utilities_reviewed", "aerial_hazards_reviewed", "incident_reporting_reviewed"]);
const storageRejectKeys = ["storage_key", "storage_path", "storage_url", "public_url", "raw_url", "object_key", "bucket", "url", "path"];
const productionStatuses = new Set(["partial", "complete", "blocked", "rework"]);
const productionLocationTypes = new Set(["asset", "route", "daily"]);
const assetTypes = new Set(["pole", "pedestal", "handhole", "vault", "cabinet", "enclosure", "terminal", "riser", "anchor", "other"]);
const customerQcDecisions = new Set(["accepted", "partially_accepted", "correction_required", "rejected"]);
const customerQcSources = new Set(["email", "customer_portal", "customer_report", "customer_spreadsheet", "field_qc_report", "api", "manual_recorded_from_customer"]);
const correctionTypes = new Set(["quantity", "production_code", "location", "asset_identifier", "route_endpoint", "missing_note", "missing_photo", "workmanship", "rework", "other"]);
const correctionFieldValues = new Set(["reported_quantity", "production_code_id", "asset_identifier", "route_endpoint", "map_location", "notes", "evidence"]);
const exportArtifactTypes = new Set(["annotated_map_pdf", "daily_production_pdf", "production_csv", "production_closeout_package"]);
const exportGenerationModes = new Set(["submitted_day", "customer_qc_status", "final_accepted_closeout", "dashboard_export"]);
const defaultProductionCodes = [
  ["POLE-ATT", "Pole Attachment", "EA", "asset", true, false],
  ["TRANSFER", "Cable Transfer", "EA", "asset", true, false],
  ["RISER", "Riser Installation", "EA", "asset", true, false],
  ["ANCHOR", "Anchor Installation", "EA", "asset", true, false],
  ["STRAND", "Place Strand", "LF", "route", false, true],
  ["FIBER", "Place Fiber", "LF", "route", false, true],
  ["LASH", "Lash Fiber", "LF", "route", false, true],
  ["BORE", "Directional Bore", "LF", "route", false, true],
  ["CONDUIT", "Place Conduit", "LF", "route", false, true],
  ["HANDHOLE", "Install Handhole", "EA", "asset", true, false],
  ["LABOR", "Labor Hours", "HR", "daily", false, false],
  ["EQUIPMENT", "Equipment Hours", "HR", "daily", false, false],
] as const;

@Controller("syncfield")
export class SyncfieldController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  @Post("organizations/:organizationId/work-order-versions/:versionId/map-documents")
  @RequirePermission("syncfield_map.create")
  async createMapDocument(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, "syncfield_map.create");
      const context = await this.requireWorkOrderContext(client, request.auth.tenantId, organizationId, versionId);
      const name = requireString(body.name, "name is required");
      const documentType = String(body.document_type ?? "construction_map");
      if (!mapDocumentTypes.has(documentType)) throw new BadRequestException("document_type is invalid");
      return this.writeWithClient(client, request, "map_document.create", "map_document.created", "map_document", async (writeClient) => {
        const inserted = await writeClient.query(
          `
          INSERT INTO syncfield_map_documents (tenant_id, project_id, work_order_id, name, customer_document_number, document_type, status, created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,'active',$7)
          RETURNING *
          `,
          [context.tenant_id, context.project_id, context.work_order_id, name, this.optionalString(body.customer_document_number), documentType, request.auth.userId],
        );
        return { entityType: "map_document", entityId: inserted.rows[0].id, afterState: this.safeMapDocument(inserted.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/map-documents/:documentId/versions")
  @RequirePermission("syncfield_map.version.upload")
  async uploadMapVersion(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("documentId") documentId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, "syncfield_map.version.upload");
      const doc = await this.requireMapDocument(client, request.auth.tenantId, organizationId, documentId);
      return this.writeWithClient(client, request, "map_version.upload", "map_version.uploaded", "map_version", async (writeClient) => {
        const file = await this.createMapPdfFile(writeClient, request, organizationId, doc.capacity_provider_id, documentId, body);
        const requestedRevision = body.revision_number === undefined ? null : this.positiveInt(body.revision_number, "revision_number must be a positive integer");
        const revisionNumber = requestedRevision ?? await this.nextRevisionNumber(writeClient, request.auth.tenantId, documentId);
        const parsed = this.inspectPdf(Buffer.from(requireString(body.content_base64, "content_base64 is required"), "base64"));
        const version = await writeClient.query(
          `
          INSERT INTO syncfield_map_versions (
            tenant_id, map_document_id, revision_number, revision_label, received_date, source_name, source_received_from,
            original_filename, original_file_object_id, file_hash, page_count, processing_status, status, uploaded_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ready','ready',$12)
          RETURNING *
          `,
          [
            request.auth.tenantId,
            documentId,
            revisionNumber,
            this.optionalString(body.revision_label),
            body.received_date ?? null,
            this.optionalString(body.source_name),
            this.optionalString(body.source_received_from),
            file.file_name,
            file.id,
            file.checksum,
            parsed.pageCount,
            request.auth.userId,
          ],
        );
        await writeClient.query("UPDATE partner_restricted_file_objects SET related_entity_id = $3 WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, file.id, version.rows[0].id]);
        for (let pageNumber = 1; pageNumber <= parsed.pageCount; pageNumber += 1) {
          await writeClient.query("INSERT INTO syncfield_map_pages (tenant_id, map_version_id, page_number, processing_status) VALUES ($1,$2,$3,'ready')", [request.auth.tenantId, version.rows[0].id, pageNumber]);
        }
        return {
          entityType: "map_version",
          entityId: version.rows[0].id,
          afterState: this.safeMapVersion(version.rows[0]),
          additionalEvents: [{
            action: "map_version.ready",
            aggregateType: "map_version",
            entityType: "map_version",
            entityId: version.rows[0].id,
            eventType: "map_version.ready",
            afterState: { map_document_id: documentId, revision_number: revisionNumber, page_count: parsed.pageCount, processing_status: "ready" },
          }],
        };
      });
    });
  }

  @Post("organizations/:organizationId/map-versions/:versionId/work-zones")
  @RequirePermission("syncfield_map.work_zone.manage")
  async createWorkZone(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, "syncfield_map.work_zone.manage");
      const version = await this.requireMapVersion(client, request.auth.tenantId, organizationId, versionId);
      const pageNumber = this.positiveInt(body.page_number, "page_number is required");
      if (pageNumber > Number(version.page_count)) throw new BadRequestException("page_number is outside Map Version page count");
      return this.writeWithClient(client, request, "map_work_zone.create", "map_work_zone.created", "map_work_zone", async (writeClient) => {
        const inserted = await writeClient.query(
          `
          INSERT INTO syncfield_map_work_zones (tenant_id, map_version_id, name, page_number, x_ratio, y_ratio, zoom_level, created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [request.auth.tenantId, versionId, requireString(body.name, "name is required"), pageNumber, this.ratio(body.x_ratio, "x_ratio"), this.ratio(body.y_ratio, "y_ratio"), Number(body.zoom_level ?? 1), request.auth.userId],
        );
        return { entityType: "map_work_zone", entityId: inserted.rows[0].id, afterState: this.safeWorkZone(inserted.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/map-versions/:versionId/assign")
  @RequirePermission("syncfield_map.assignment.manage")
  async assignMapVersion(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, "syncfield_map.assignment.manage");
      const version = await this.requireMapVersion(client, request.auth.tenantId, organizationId, versionId);
      if (version.status !== "ready" || version.processing_status !== "ready") throw new BadRequestException("Map Version is not ready");
      const context = await this.requireWorkOrderContext(client, request.auth.tenantId, organizationId, version.work_order_version_id);
      const crewId = requireString(body.crew_id ?? context.crew_id, "crew_id is required");
      const foremanWorkerId = requireString(body.foreman_worker_id, "foreman_worker_id is required");
      if (crewId !== context.crew_id) throw new BadRequestException("Crew must match Work Order assignment");
      await this.requireForemanMembership(client, context, foremanWorkerId);
      return this.writeWithClient(client, request, "map_assignment.create", "map_assignment.created", "map_assignment", async (writeClient) => {
        const current = await this.currentAssignment(writeClient, context);
        if (current) await writeClient.query("UPDATE syncfield_map_assignments SET current = false, assignment_status = 'superseded', updated_at = now() WHERE tenant_id = $1 AND id = $2", [context.tenant_id, current.id]);
        const inserted = await writeClient.query(
          `
          INSERT INTO syncfield_map_assignments (
            tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_assignment_id,
            crew_id, foreman_worker_id, map_document_id, map_version_id, assignment_status, assigned_by_user_id, supersedes_assignment_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13)
          RETURNING *
          `,
          [context.tenant_id, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.capacity_provider_id, context.crew_assignment_id, context.crew_id, foremanWorkerId, version.map_document_id, versionId, request.auth.userId, current?.id ?? null],
        );
        if (current) await writeClient.query("UPDATE syncfield_map_assignments SET superseded_by_assignment_id = $3 WHERE tenant_id = $1 AND id = $2", [context.tenant_id, current.id, inserted.rows[0].id]);
        return { entityType: "map_assignment", entityId: inserted.rows[0].id, beforeState: current ? this.safeMapAssignment(current) : undefined, afterState: this.safeMapAssignment(inserted.rows[0]) };
      });
    });
  }

  @Get("partner/map-assignment")
  @RequirePermission("partner_map.read")
  async partnerMapAssignment(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const assignment = await this.latestPartnerAssignment(client, context.tenant_id, context.organization.id);
      return assignment ? this.safeAssignmentDetail(client, await this.hydrateAssignment(client, assignment)) : null;
    });
  }

  @Get("foreman/map-assignment")
  @RequirePermission("partner_map.read_assigned")
  async foremanMapAssignment(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const crew = await this.requireForemanCrew(client, context);
      const assignment = await this.latestForemanAssignment(client, context.tenant_id, context.organization.id, crew.id, crew.worker_id);
      return assignment ? this.safeAssignmentDetail(client, await this.hydrateAssignment(client, assignment)) : null;
    });
  }

  @Get("foreman/map-versions/:versionId/bytes")
  @RequirePermission("partner_map.read_assigned")
  async foremanMapBytes(@Req() request: AuthenticatedRequest, @Param("versionId") versionId: string) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const crew = await this.requireForemanCrew(client, context);
      const assignment = await this.latestForemanAssignment(client, context.tenant_id, context.organization.id, crew.id, crew.worker_id);
      if (!assignment || assignment.map_version_id !== versionId) throw new NotFoundException("assigned map not found");
      const file = await this.requireMapFile(client, context.tenant_id, versionId);
      return this.readAuthorizedMapFile(client, request, file);
    });
  }

  @Get("partner/jsas")
  @RequirePermission("partner_jsa.read")
  async partnerJsas(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const result = await client.query(
        `
        SELECT j.*, c.name AS crew_name, w.first_name, w.last_name, wov.work_order_number
        FROM daily_jsas j
        JOIN crews c ON c.tenant_id = j.tenant_id AND c.id = j.crew_id
        JOIN workers w ON w.tenant_id = j.tenant_id AND w.id = j.foreman_worker_id
        JOIN partner_work_order_versions wov ON wov.tenant_id = j.tenant_id AND wov.id = j.work_order_version_id
        WHERE j.tenant_id = $1 AND j.organization_id = $2 AND j.deleted_at IS NULL
        ORDER BY j.work_date DESC, j.created_at DESC
        LIMIT 50
        `,
        [context.tenant_id, context.organization.id],
      );
      return result.rows.map((row) => this.safeJsa(row));
    });
  }

  @Get("foreman/jsa/today")
  @RequirePermission("partner_jsa.read_own")
  async foremanJsaToday(@Req() request: AuthenticatedRequest, @Query("work_date") workDate?: string) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      const date = this.workDate(workDate);
      const current = await this.findJsa(client, assignment, date);
      return current ? this.safeJsaDetail(client, current) : { status: "required", work_date: date, assignment: this.safeAssignmentContext(assignment) };
    });
  }

  @Post("foreman/jsa/today")
  @RequirePermission("partner_jsa.create")
  async createForemanJsa(@Req() request: AuthenticatedRequest, @Query("work_date") workDate: string | undefined, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      const date = this.workDate(workDate ?? String(body.work_date ?? ""));
      const workLocation = requireString(body.work_location ?? assignment.primary_work_area ?? assignment.map_work_package_ref, "work_location is required");
      return this.writeWithClient(client, request, "daily_jsa.create", "daily_jsa.created", "daily_jsa", async (writeClient) => {
        const existing = await this.findJsa(writeClient, assignment, date);
        if (existing) return { entityType: "daily_jsa", entityId: existing.id, afterState: this.safeJsa(existing) };
        const inserted = await writeClient.query(
          `
          INSERT INTO daily_jsas (
            tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id,
            crew_id, foreman_worker_id, foreman_user_id, work_date, map_version_id, meeting_started_at,
            work_location, weather, site_conditions, hazards, controls, notes, created_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14,$15,$16,$17,$9)
          RETURNING *
          `,
          [
            assignment.tenant_id, assignment.project_id, assignment.work_order_id, assignment.work_order_version_id, assignment.organization_id, assignment.capacity_provider_id,
            assignment.crew_id, assignment.foreman_worker_id, request.auth.userId, date, assignment.map_version_id, workLocation,
            this.optionalString(body.weather), this.optionalString(body.site_conditions), this.textArray(body.hazards, hazardValues, "hazards"), this.textArray(body.controls, controlValues, "controls"), this.optionalString(body.notes),
          ],
        );
        await this.insertJsaParticipants(writeClient, assignment, inserted.rows[0].id);
        return { entityType: "daily_jsa", entityId: inserted.rows[0].id, afterState: this.safeJsa(inserted.rows[0]) };
      });
    });
  }

  @Post("foreman/jsa/today/complete")
  @RequirePermission("partner_jsa.complete")
  async completeForemanJsa(@Req() request: AuthenticatedRequest, @Query("work_date") workDate: string | undefined, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      const date = this.workDate(workDate ?? String(body.work_date ?? ""));
      return this.writeWithClient(client, request, "daily_jsa.complete", "daily_jsa.completed", "daily_jsa", async (writeClient) => {
        const current = await this.findJsa(writeClient, assignment, date) ?? await this.createDraftJsa(writeClient, request, assignment, date, body);
        if (current.status === "completed") return { entityType: "daily_jsa", entityId: current.id, afterState: this.safeJsa(current) };
        if (current.status !== "draft") throw new BadRequestException("only draft JSA can be completed");
        const hazards = this.textArray(body.hazards ?? current.hazards, hazardValues, "hazards");
        const controls = this.textArray(body.controls ?? current.controls, controlValues, "controls");
        if (!hazards.length) throw new BadRequestException("at least one hazard is required");
        if (!controls.includes("ppe_reviewed") || !controls.includes("emergency_procedures_reviewed") || !controls.includes("stop_work_authority_reviewed")) {
          throw new BadRequestException("required controls must be confirmed");
        }
        if (body.foreman_certified !== true) throw new BadRequestException("foreman certification is required");
        const completed = await writeClient.query(
          `
          UPDATE daily_jsas SET
            status = 'completed',
            meeting_completed_at = now(),
            submitted_by_user_id = $3,
            submitted_at = now(),
            hazards = $4,
            controls = $5,
            ppe_confirmed = true,
            traffic_control_reviewed = $6,
            emergency_plan_reviewed = true,
            utilities_reviewed = $7,
            aerial_hazards_reviewed = $8,
            incident_reporting_reviewed = true,
            crew_participation_confirmed = true,
            foreman_certified = true,
            notes = COALESCE($9, notes),
            updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
          RETURNING *
          `,
          [assignment.tenant_id, current.id, request.auth.userId, hazards, controls, controls.includes("traffic_control_reviewed"), controls.includes("utilities_reviewed"), controls.includes("aerial_hazards_reviewed"), this.optionalString(body.notes)],
        );
        await writeClient.query("UPDATE daily_jsa_participants SET acknowledged = true WHERE tenant_id = $1 AND daily_jsa_id = $2", [assignment.tenant_id, current.id]);
        return { entityType: "daily_jsa", entityId: current.id, beforeState: this.safeJsa(current), afterState: this.safeJsa(completed.rows[0]) };
      });
    });
  }

  @Get("foreman/production/today")
  @RequirePermission("partner_daily_production.read")
  async foremanProductionToday(@Req() request: AuthenticatedRequest, @Query("work_date") workDate?: string) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      const date = this.workDate(workDate);
      const report = await this.findDailyReport(client, assignment, date);
      if (!report) return { status: "not_started", work_date: date, gate: await this.productionGate(client, assignment, date), assignment: this.safeAssignmentContext(assignment), records: [], annotations: [], totals: [] };
      return this.safeDailyProductionDetail(client, report);
    });
  }

  @Get("partner/production")
  @RequirePermission("partner_daily_production.read_org")
  async partnerProductionReports(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const result = await client.query(
        `
        SELECT r.*, c.name AS crew_name, wov.work_order_number
        FROM daily_production_reports r
        JOIN crews c ON c.tenant_id = r.tenant_id AND c.id = r.crew_id
        JOIN partner_work_order_versions wov ON wov.tenant_id = r.tenant_id AND wov.id = r.work_order_version_id
        WHERE r.tenant_id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL
        ORDER BY r.work_date DESC, r.created_at DESC
        LIMIT 50
        `,
        [context.tenant_id, context.organization.id],
      );
      return result.rows.map((row) => this.safeDailyProductionSummary(row));
    });
  }

  @Get("foreman/production/codes")
  @RequirePermission("partner_daily_production.read")
  async foremanProductionCodes(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      await this.ensureDefaultProductionCodes(client, assignment);
      const result = await client.query(
        `
        SELECT pc.*
        FROM syncfield_work_order_production_codes wopc
        JOIN syncfield_production_codes pc ON pc.tenant_id = wopc.tenant_id AND pc.id = wopc.production_code_id
        WHERE wopc.tenant_id = $1 AND wopc.work_order_version_id = $2 AND wopc.status = 'active'
          AND wopc.deleted_at IS NULL AND pc.active = true AND pc.deleted_at IS NULL
        ORDER BY pc.location_type, pc.code
        `,
        [assignment.tenant_id, assignment.work_order_version_id],
      );
      return result.rows.map((row) => this.safeProductionCode(row));
    });
  }

  @Post("foreman/production/today")
  @RequirePermission("partner_daily_production.create")
  async openForemanProductionToday(@Req() request: AuthenticatedRequest, @Query("work_date") workDate: string | undefined, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      const date = this.workDate(workDate ?? String(body.work_date ?? ""));
      return this.writeWithClient(client, request, "daily_report.create", "daily_report.created", "daily_report", async (writeClient) => {
        const existing = await this.findDailyReport(writeClient, assignment, date);
        if (existing) return { entityType: "daily_report", entityId: existing.id, afterState: await this.safeDailyProductionDetail(writeClient, existing) };
        const gate = await this.assertProductionGate(writeClient, assignment, date);
        const mutationId = this.optionalString(body.client_mutation_id);
        if (mutationId) {
          const receipt = await this.findMutationReceipt(writeClient, request, mutationId, "create_daily_report");
          if (receipt?.entity_id) {
            const row = await this.requireDailyReportById(writeClient, assignment.tenant_id, receipt.entity_id);
            return { entityType: "daily_report", entityId: row.id, afterState: await this.safeDailyProductionDetail(writeClient, row) };
          }
        }
        const inserted = await writeClient.query(
          `
          INSERT INTO daily_production_reports (
            tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_id,
            foreman_worker_id, foreman_user_id, work_date, map_document_id, map_version_id, daily_jsa_id, status,
            start_time, weather, general_notes, client_mutation_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$16,$17)
          RETURNING *
          `,
          [assignment.tenant_id, assignment.project_id, assignment.work_order_id, assignment.work_order_version_id, assignment.organization_id, assignment.capacity_provider_id, assignment.crew_id, assignment.foreman_worker_id, request.auth.userId, date, assignment.map_document_id, assignment.map_version_id, gate.daily_jsa_id, this.optionalString(body.start_time), this.optionalString(body.weather), this.optionalString(body.general_notes), mutationId],
        );
        if (mutationId) await this.recordMutationReceipt(writeClient, request, mutationId, "create_daily_report", "daily_report", inserted.rows[0].id, body);
        return { entityType: "daily_report", entityId: inserted.rows[0].id, afterState: await this.safeDailyProductionDetail(writeClient, inserted.rows[0]) };
      });
    });
  }

  @Post("foreman/production/records")
  @RequirePermission("partner_production_record.create")
  async createForemanProductionRecord(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      const date = this.workDate(String(body.work_date ?? ""));
      return this.writeWithClient(client, request, "production.record", "production.recorded", "production_record", async (writeClient) => {
        await this.assertProductionGate(writeClient, assignment, date);
        const report = await this.findDailyReport(writeClient, assignment, date) ?? await this.createReportInline(writeClient, request, assignment, date, body);
        if (report.status !== "draft") throw new BadRequestException("submitted report is read-only");
        const mutationId = requireString(body.client_mutation_id, "clientMutationId is required");
        const existingReceipt = await this.findMutationReceipt(writeClient, request, mutationId, "create_production");
        if (existingReceipt?.entity_id) {
          const existing = await this.requireProductionRecord(writeClient, assignment.tenant_id, existingReceipt.entity_id);
          return { entityType: "production_record", entityId: existing.id, afterState: await this.safeProductionRecordDetail(writeClient, existing), skipEventAudit: true };
        }
        const code = await this.requireAuthorizedProductionCode(writeClient, assignment, requireString(body.production_code_id, "production_code_id is required"));
        const locationType = requireString(body.location_type ?? code.location_type, "location_type is required");
        if (!productionLocationTypes.has(locationType) || locationType !== code.location_type) throw new BadRequestException("production code is not valid for location type");
        const status = requireString(body.status ?? "complete", "status is required").toLowerCase();
        if (!productionStatuses.has(status)) throw new BadRequestException("production status is invalid");
        const quantity = this.positiveNumber(body.reported_quantity, "reported_quantity must be positive");
        const duplicate = await this.duplicateWarning(writeClient, assignment, report, code, body);
        if (duplicate.requires_reason && !this.optionalString(body.duplicate_reason)) throw new BadRequestException("duplicate reason is required");
        const values = this.validateProductionLocation(body, code, locationType);
        const inserted = await writeClient.query(
          `
          INSERT INTO production_records (
            tenant_id, project_id, work_order_id, work_order_version_id, capacity_provider_id, crew_id, foreman_user_id,
            foreman_worker_id, submitted_by_user_id, submitted_by, production_date, quantity_submitted, quantity, claimed_quantity,
            unit_type, unit, rate_code_id, production_type, qc_status, billable_status, status, daily_production_report_id,
            partner_organization_id, map_document_id, map_version_id, syncfield_production_code_id, syncfield_location_type,
            syncfield_status, asset_type, asset_identifier, from_asset_identifier, to_asset_identifier, map_page,
            duplicate_reason, client_mutation_id, production_notes, created_by, updated_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,$9,$10,$10,$10,$11,$11,NULL,'daily_production','not_started','not_billable','draft',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$7,$7)
          ON CONFLICT (tenant_id, foreman_user_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL AND daily_production_report_id IS NOT NULL
          DO UPDATE SET updated_at = production_records.updated_at
          RETURNING *, (xmax = 0) AS inserted_new
          `,
          [
            assignment.tenant_id, assignment.project_id, assignment.work_order_id, assignment.work_order_version_id, assignment.capacity_provider_id, assignment.crew_id,
            request.auth.userId, assignment.foreman_worker_id, date, quantity, code.unit_of_measure, report.id, assignment.organization_id,
            locationType === "daily" ? null : assignment.map_document_id, locationType === "daily" ? null : assignment.map_version_id, code.id, locationType, status,
            values.assetType, values.assetIdentifier, values.fromAssetIdentifier, values.toAssetIdentifier, values.mapPage, this.optionalString(body.duplicate_reason), mutationId, this.optionalString(body.notes),
          ],
        );
        const record = inserted.rows[0];
        if (!record.inserted_new) {
          await this.recordMutationReceipt(writeClient, request, mutationId, "create_production", "production_record", record.id, body);
          return { entityType: "production_record", entityId: record.id, afterState: await this.safeProductionRecordDetail(writeClient, record), skipEventAudit: true };
        }
        if (locationType !== "daily") await this.insertAnnotation(writeClient, request, assignment, record, locationType, values, status);
        await this.recordMutationReceipt(writeClient, request, mutationId, "create_production", "production_record", record.id, body);
        return { entityType: "production_record", entityId: record.id, afterState: await this.safeProductionRecordDetail(writeClient, record) };
      });
    });
  }

  @Post("foreman/production/records/:recordId")
  @RequirePermission("partner_production_record.update_draft")
  async updateForemanProductionRecord(@Req() request: AuthenticatedRequest, @Param("recordId") recordId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      return this.writeWithClient(client, request, "production.update", "production.updated", "production_record", async (writeClient) => {
        const before = await this.requireScopedProductionRecord(writeClient, assignment, recordId);
        const report = await this.requireDailyReportById(writeClient, assignment.tenant_id, before.daily_production_report_id);
        if (report.status !== "draft" || before.locked_at) throw new BadRequestException("submitted production is read-only");
        const mutationId = requireString(body.client_mutation_id, "clientMutationId is required");
        const receipt = await this.findMutationReceipt(writeClient, request, mutationId, "update_draft_production");
        if (receipt?.entity_id) return { entityType: "production_record", entityId: before.id, afterState: await this.safeProductionRecordDetail(writeClient, before) };
        const status = body.status === undefined ? before.syncfield_status : requireString(body.status, "status is required").toLowerCase();
        if (!productionStatuses.has(status)) throw new BadRequestException("production status is invalid");
        const quantity = body.reported_quantity === undefined ? Number(before.quantity_submitted) : this.positiveNumber(body.reported_quantity, "reported_quantity must be positive");
        const updated = await writeClient.query(
          `
          UPDATE production_records
          SET quantity_submitted = $3, quantity = $3, claimed_quantity = $3, syncfield_status = $4,
            production_notes = COALESCE($5, production_notes), updated_by = $6, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND daily_production_report_id IS NOT NULL AND status = 'draft'
          RETURNING *
          `,
          [assignment.tenant_id, recordId, quantity, status, this.optionalString(body.notes), request.auth.userId],
        );
        await writeClient.query("UPDATE map_annotations SET display_status = $3, updated_at = now() WHERE tenant_id = $1 AND production_record_id = $2 AND deleted_at IS NULL", [assignment.tenant_id, recordId, status]);
        await this.recordMutationReceipt(writeClient, request, mutationId, "update_draft_production", "production_record", recordId, body);
        return { entityType: "production_record", entityId: recordId, beforeState: await this.safeProductionRecordDetail(writeClient, before), afterState: await this.safeProductionRecordDetail(writeClient, updated.rows[0]) };
      });
    });
  }

  @Post("foreman/production/review-day/submit")
  @RequirePermission("partner_daily_production.submit")
  async submitForemanProductionDay(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const assignment = await this.requireForemanOperationalAssignment(client, context);
      const date = this.workDate(String(body.work_date ?? ""));
      return this.writeWithClient(client, request, "daily_report.submit", "daily_report.submitted", "daily_report", async (writeClient) => {
        await this.assertProductionGate(writeClient, assignment, date);
        const report = await this.findDailyReport(writeClient, assignment, date);
        if (!report) throw new BadRequestException("daily production report is required");
        const mutationId = requireString(body.client_mutation_id, "clientMutationId is required");
        const receipt = await this.findMutationReceipt(writeClient, request, mutationId, "submit_daily_report");
        if (receipt?.entity_id) return { entityType: "daily_report", entityId: report.id, afterState: await this.safeDailyProductionDetail(writeClient, report) };
        if (report.status !== "draft") throw new BadRequestException("only draft reports can be submitted");
        const records = await this.reportRecords(writeClient, assignment.tenant_id, report.id);
        if (!records.length) throw new BadRequestException("at least one production record is required");
        const snapshot = await this.buildReportSnapshot(writeClient, report);
        const revision = await writeClient.query(
          `
          INSERT INTO daily_production_report_revisions (tenant_id, daily_report_id, revision_number, snapshot_json, reason, submitted_by_user_id)
          VALUES ($1,$2,1,$3,'submitted',$4)
          ON CONFLICT (tenant_id, daily_report_id, revision_number) DO NOTHING
          RETURNING *
          `,
          [assignment.tenant_id, report.id, snapshot, request.auth.userId],
        );
        await writeClient.query("UPDATE production_records SET status = 'submitted', submitted_at = now(), submitted_by_user_id = $3, submitted_by = $3, locked_at = now(), updated_at = now() WHERE tenant_id = $1 AND daily_production_report_id = $2 AND status = 'draft'", [assignment.tenant_id, report.id, request.auth.userId]);
        const submitted = await writeClient.query("UPDATE daily_production_reports SET status = 'submitted', submitted_at = now(), submitted_by_user_id = $3, general_notes = COALESCE($4, general_notes), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'draft' RETURNING *", [assignment.tenant_id, report.id, request.auth.userId, this.optionalString(body.general_notes)]);
        await this.recordMutationReceipt(writeClient, request, mutationId, "submit_daily_report", "daily_report", report.id, body);
        return { entityType: "daily_report", entityId: report.id, beforeState: this.safeDailyProductionSummary(report), afterState: await this.safeDailyProductionDetail(writeClient, submitted.rows[0] ?? report), additionalEvents: [{ action: "daily_report_revision.create", eventType: "daily_report_revision.created", aggregateType: "daily_report_revision", entityType: "daily_report_revision", entityId: revision.rows[0]?.id ?? report.id, afterState: { daily_report_id: report.id, revision_number: 1 } }] };
      });
    });
  }

  @Get("customer-qc/completeness-queue")
  @RequirePermission("daily_production.completeness_read")
  async customerQcCompletenessQueue(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT r.*, c.name AS crew_name, wov.work_order_number, p.name AS project_name, o.name AS partner_name,
          COALESCE(wo.qc_authority_organization_id, p.qc_authority_organization_id, p.customer_organization_id) AS qc_authority_organization_id,
          qa.name AS qc_authority_name
        FROM daily_production_reports r
        JOIN crews c ON c.tenant_id = r.tenant_id AND c.id = r.crew_id
        JOIN partner_work_order_versions wov ON wov.tenant_id = r.tenant_id AND wov.id = r.work_order_version_id
        JOIN work_orders wo ON wo.tenant_id = r.tenant_id AND wo.id = r.work_order_id
        JOIN projects p ON p.tenant_id = r.tenant_id AND p.id = r.project_id
        JOIN organizations o ON o.tenant_id = r.tenant_id AND o.id = r.organization_id
        LEFT JOIN organizations qa ON qa.tenant_id = r.tenant_id AND qa.id = COALESCE(wo.qc_authority_organization_id, p.qc_authority_organization_id, p.customer_organization_id)
        WHERE r.tenant_id = $1 AND r.status = 'submitted' AND r.deleted_at IS NULL
        ORDER BY r.submitted_at DESC NULLS LAST, r.created_at DESC
        LIMIT 50
        `,
        [request.auth.tenantId],
      );
      return result.rows.map((row) => this.safeCustomerQcReportSummary(row));
    });
  }

  @Post("customer-qc/reports/:reportId/complete")
  @RequirePermission("customer_qc.completeness_review")
  async markReportCompleteForCustomerQc(@Req() request: AuthenticatedRequest, @Param("reportId") reportId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      return this.writeWithClient(client, request, "daily_report.completeness_confirm", "daily_report.completeness_confirmed", "daily_report", async (writeClient) => {
        const before = await this.requireSubmittedDailyReport(writeClient, request.auth.tenantId, reportId);
        const authorityId = await this.resolveQcAuthority(writeClient, before, this.optionalString(body.qc_authority_organization_id));
        const updated = await writeClient.query(
          `
          UPDATE daily_production_reports
          SET completeness_status = 'complete', completeness_reviewed_by_user_id = $3, completeness_reviewed_at = now(),
            completeness_return_reason = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING *
          `,
          [request.auth.tenantId, reportId, request.auth.userId],
        );
        if (authorityId) {
          await writeClient.query("UPDATE work_orders SET qc_authority_organization_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, before.work_order_id, authorityId]);
        }
        return { entityType: "daily_report", entityId: reportId, beforeState: this.safeDailyProductionSummary(before), afterState: { ...this.safeDailyProductionSummary(updated.rows[0]), completeness_status: "complete", qc_authority_organization_id: authorityId } };
      });
    });
  }

  @Post("customer-qc/reports/:reportId/return")
  @RequirePermission("customer_qc.completeness_review")
  async returnReportForAdministrativeCompletion(@Req() request: AuthenticatedRequest, @Param("reportId") reportId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      return this.writeWithClient(client, request, "daily_report.completeness_return", "daily_report.completeness_returned", "daily_report", async (writeClient) => {
        const before = await this.requireSubmittedDailyReport(writeClient, request.auth.tenantId, reportId);
        const reason = requireString(body.reason, "reason is required");
        const updated = await writeClient.query(
          `
          UPDATE daily_production_reports
          SET completeness_status = 'returned', completeness_reviewed_by_user_id = $3, completeness_reviewed_at = now(),
            completeness_return_reason = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING *
          `,
          [request.auth.tenantId, reportId, request.auth.userId, reason],
        );
        return { entityType: "daily_report", entityId: reportId, beforeState: this.safeDailyProductionSummary(before), afterState: { ...this.safeDailyProductionSummary(updated.rows[0]), completeness_status: "returned", reason } };
      });
    });
  }

  @Post("customer-qc/reports/:reportId/cycles")
  @RequirePermission("customer_qc.decision_record")
  async createCustomerQcCycle(@Req() request: AuthenticatedRequest, @Param("reportId") reportId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      return this.writeWithClient(client, request, "customer_qc.cycle_create", "customer_qc.cycle_created", "customer_qc_cycle", async (writeClient) => {
        const report = await this.requireSubmittedDailyReport(writeClient, request.auth.tenantId, reportId);
        if (report.completeness_status !== "complete") throw new BadRequestException("report must be complete for Customer QC");
        const mutationId = this.optionalString(body.client_mutation_id);
        if (mutationId) {
          const existing = await writeClient.query("SELECT * FROM customer_qc_cycles WHERE tenant_id = $1 AND created_by_user_id = $2 AND client_mutation_id = $3", [request.auth.tenantId, request.auth.userId, mutationId]);
          if (existing.rows[0]) return { entityType: "customer_qc_cycle", entityId: existing.rows[0].id, afterState: await this.safeCustomerQcCycleDetail(writeClient, existing.rows[0]), skipEventAudit: true };
        }
        const revision = await this.currentReportRevision(writeClient, report);
        const authorityId = await this.resolveQcAuthority(writeClient, report, this.optionalString(body.qc_authority_organization_id));
        const sourceType = String(body.source_type ?? "manual_recorded_from_customer").toLowerCase();
        if (!customerQcSources.has(sourceType)) throw new BadRequestException("source_type is invalid");
        const sourceReference = requireString(body.source_reference, "source_reference is required");
        const next = await writeClient.query("SELECT COALESCE(MAX(cycle_number), 0) + 1 AS next_cycle FROM customer_qc_cycles WHERE tenant_id = $1 AND daily_report_id = $2 AND deleted_at IS NULL", [request.auth.tenantId, report.id]);
        const inserted = await writeClient.query(
          `
          INSERT INTO customer_qc_cycles (
            tenant_id, project_id, work_order_id, work_order_version_id, daily_report_id, daily_report_revision_id,
            partner_organization_id, crew_id, qc_authority_organization_id, cycle_number, status, submitted_to_customer_at,
            source_type, source_reference, customer_reference_number, general_customer_notes, client_mutation_id, created_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'awaiting_customer',COALESCE($11, now()),$12,$13,$14,$15,$16,$17)
          RETURNING *
          `,
          [
            request.auth.tenantId, report.project_id, report.work_order_id, report.work_order_version_id, report.id, revision.id,
            report.organization_id, report.crew_id, authorityId, Number(next.rows[0].next_cycle), body.submitted_to_customer_at ?? null,
            sourceType, sourceReference, this.optionalString(body.customer_reference_number), this.optionalString(body.general_customer_notes), mutationId, request.auth.userId,
          ],
        );
        return { entityType: "customer_qc_cycle", entityId: inserted.rows[0].id, afterState: await this.safeCustomerQcCycleDetail(writeClient, inserted.rows[0]) };
      });
    });
  }

  @Post("customer-qc/cycles/:cycleId/decisions")
  @RequirePermission("customer_qc.decision_record")
  async recordCustomerQcDecision(@Req() request: AuthenticatedRequest, @Param("cycleId") cycleId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      return this.writeWithClient(client, request, "customer_qc.decision_record", "customer_qc.decision_recorded", "customer_qc_decision", async (writeClient) => {
        const cycle = await this.requireCustomerQcCycle(writeClient, request.auth.tenantId, cycleId);
        const mutationId = this.optionalString(body.client_mutation_id);
        if (mutationId) {
          const existing = await writeClient.query("SELECT * FROM customer_qc_decisions WHERE tenant_id = $1 AND recorded_by_user_id = $2 AND client_mutation_id = $3", [request.auth.tenantId, request.auth.userId, mutationId]);
          if (existing.rows[0]) return { entityType: "customer_qc_decision", entityId: existing.rows[0].id, afterState: await this.safeCustomerQcDecisionDetail(writeClient, existing.rows[0]), skipEventAudit: true };
        }
        const record = await this.requireCycleProductionRecord(writeClient, cycle, requireString(body.production_record_id, "production_record_id is required"));
        const decision = requireString(body.decision, "decision is required").toLowerCase();
        if (!customerQcDecisions.has(decision)) throw new BadRequestException("customer decision is invalid");
        const acceptedQuantity = body.customer_accepted_quantity === undefined || body.customer_accepted_quantity === null ? null : this.nonNegativeNumber(body.customer_accepted_quantity, "customer_accepted_quantity must be non-negative");
        if (["accepted", "partially_accepted"].includes(decision) && acceptedQuantity === null) throw new BadRequestException("customer_accepted_quantity is required");
        const reason = this.optionalString(body.customer_reason_code);
        if (acceptedQuantity !== null && acceptedQuantity > Number(record.quantity_submitted) && !reason) throw new BadRequestException("accepted quantity above reported requires customer reason");
        if (decision !== "accepted" && !reason) throw new BadRequestException("customer reason is required");
        const inserted = await writeClient.query(
          `
          INSERT INTO customer_qc_decisions (
            tenant_id, qc_cycle_id, production_record_id, decision, reported_quantity, customer_accepted_quantity,
            unit_of_measure, customer_reason_code, customer_comments, correction_required, recorded_by_user_id,
            source_reference, client_mutation_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          RETURNING *
          `,
          [
            request.auth.tenantId, cycle.id, record.id, decision, record.quantity_submitted, acceptedQuantity,
            record.unit_of_measure ?? record.unit, reason, this.optionalString(body.customer_comments), ["correction_required", "rejected"].includes(decision), request.auth.userId,
            this.optionalString(body.source_reference) ?? cycle.source_reference, mutationId,
          ],
        );
        if (["correction_required", "rejected"].includes(decision)) {
          await this.createCorrectionForDecision(writeClient, request, cycle, inserted.rows[0], record, body);
        }
        await this.updateCycleAndReportOutcome(writeClient, cycle);
        const eventType = this.customerDecisionEventType(decision);
        return {
          entityType: "customer_qc_decision",
          entityId: inserted.rows[0].id,
          afterState: await this.safeCustomerQcDecisionDetail(writeClient, inserted.rows[0]),
          additionalEvents: [{
            action: eventType,
            eventType,
            aggregateType: "production_record",
            entityType: "production_record",
            entityId: record.id,
            afterState: {
              production_record_id: record.id,
              daily_report_id: cycle.daily_report_id,
              qc_cycle_id: cycle.id,
              qc_authority_organization_id: cycle.qc_authority_organization_id,
              reported_quantity: Number(record.quantity_submitted),
              customer_accepted_quantity: acceptedQuantity,
              unit: record.unit_of_measure ?? record.unit,
              decision,
            },
          }],
        };
      });
    });
  }

  @Get("partner/customer-qc")
  @RequirePermission("partner_customer_qc.read")
  async partnerCustomerQc(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      return this.partnerCustomerQcPayload(client, context.tenant_id, context.organization.id);
    });
  }

  @Get("foreman/customer-qc")
  @RequirePermission("partner_customer_qc.read_own")
  async foremanCustomerQc(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const crew = await this.requireForemanCrew(client, context);
      return this.partnerCustomerQcPayload(client, context.tenant_id, context.organization.id, crew.id);
    });
  }

  @Post("foreman/corrections/:correctionId/resubmit")
  @RequirePermission("partner_correction.resubmit")
  async resubmitCorrection(@Req() request: AuthenticatedRequest, @Param("correctionId") correctionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const crew = await this.requireForemanCrew(client, context);
      return this.writeWithClient(client, request, "partner_correction.resubmit", "partner_correction.resubmitted", "production_correction", async (writeClient) => {
        const correction = await this.requireForemanCorrection(writeClient, context.tenant_id, context.organization.id, crew.id, correctionId);
        if (!["open", "acknowledged", "in_progress"].includes(correction.status)) throw new BadRequestException("correction is not open for resubmission");
        const mutationId = this.optionalString(body.client_mutation_id);
        if (mutationId) {
          const existing = await writeClient.query("SELECT * FROM production_corrections WHERE tenant_id = $1 AND resubmitted_by_user_id = $2 AND client_mutation_id = $3", [context.tenant_id, request.auth.userId, mutationId]);
          if (existing.rows[0]) return { entityType: "production_correction", entityId: existing.rows[0].id, afterState: this.safeCorrection(existing.rows[0]), skipEventAudit: true };
        }
        this.validateCorrectionAllowedFields(correction, body);
        const report = await this.requireDailyReportById(writeClient, context.tenant_id, correction.daily_report_id);
        const nextRevision = Number(report.revision_number ?? 1) + 1;
        const snapshot = await this.buildCorrectionSnapshot(writeClient, correction, body, nextRevision);
        const revision = await writeClient.query(
          `
          INSERT INTO daily_production_report_revisions (tenant_id, daily_report_id, revision_number, snapshot_json, reason, submitted_by_user_id)
          VALUES ($1,$2,$3,$4,'customer_correction_resubmitted',$5)
          RETURNING *
          `,
          [context.tenant_id, correction.daily_report_id, nextRevision, snapshot, request.auth.userId],
        );
        await writeClient.query("UPDATE daily_production_reports SET revision_number = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2", [context.tenant_id, correction.daily_report_id, nextRevision]);
        const updated = await writeClient.query(
          `
          UPDATE production_corrections
          SET status = 'awaiting_customer_reinspection', resubmitted_by_user_id = $3, resubmitted_at = now(),
            client_mutation_id = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING *
          `,
          [context.tenant_id, correctionId, request.auth.userId, mutationId],
        );
        await writeClient.query(
          `
          INSERT INTO customer_qc_cycles (
            tenant_id, project_id, work_order_id, work_order_version_id, daily_report_id, daily_report_revision_id,
            partner_organization_id, crew_id, qc_authority_organization_id, cycle_number, status, source_type,
            source_reference, general_customer_notes, created_by_user_id
          )
          SELECT tenant_id, project_id, work_order_id, work_order_version_id, daily_report_id, $3,
            partner_organization_id, crew_id, qc_authority_organization_id,
            (SELECT COALESCE(MAX(cycle_number), 0) + 1 FROM customer_qc_cycles WHERE tenant_id = $1 AND daily_report_id = $2 AND deleted_at IS NULL),
            'awaiting_reinspection', source_type, source_reference, 'Partner correction resubmitted for Customer reinspection.', $4
          FROM customer_qc_cycles
          WHERE tenant_id = $1 AND id = $5
          RETURNING *
          `,
          [context.tenant_id, correction.daily_report_id, revision.rows[0].id, request.auth.userId, correction.qc_cycle_id],
        );
        return { entityType: "production_correction", entityId: correctionId, beforeState: this.safeCorrection(correction), afterState: this.safeCorrection(updated.rows[0]) };
      });
    });
  }

  @Get("production-dashboard")
  @RequirePermission("production_dashboard.read")
  async productionDashboard(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.productionDashboardPayload(client, request.auth.tenantId, query));
  }

  @Get("partner/production-dashboard")
  @RequirePermission("partner_production_dashboard.read")
  async partnerProductionDashboard(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      return this.productionDashboardPayload(client, context.tenant_id, { ...query, partner_organization_id: context.organization.id }, { partnerOrganizationId: context.organization.id });
    });
  }

  @Get("foreman/production-history")
  @RequirePermission("partner_production_history.read_own")
  async foremanProductionHistory(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const crew = await this.requireForemanCrew(client, context);
      const dashboard = await this.productionDashboardPayload(client, context.tenant_id, { partner_organization_id: context.organization.id, crew_id: crew.id }, { partnerOrganizationId: context.organization.id, crewId: crew.id });
      return { reports: dashboard.recent_reports, totals: dashboard.reported_vs_accepted, artifacts: dashboard.artifacts, closeout: dashboard.closeout };
    });
  }

  @Post("production-exports")
  @RequirePermission("production_export.generate")
  async generateProductionExport(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.generateExport(request, body);
  }

  @Post("partner/production-exports")
  @RequirePermission("partner_production_export.generate")
  async generatePartnerProductionExport(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, this.optionalString(body.organization_id) ?? undefined);
      return this.generateExport(request, { ...body, partner_organization_id: context.organization.id }, { partnerOrganizationId: context.organization.id });
    });
  }

  @Post("production-closeout")
  @RequirePermission("production_closeout.generate")
  async generateProductionCloseout(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.generateExport(request, { ...body, artifact_type: "production_closeout_package", generation_mode: "final_accepted_closeout" });
  }

  @Get("production-exports/:artifactId/bytes")
  @RequirePermission("production_export.read")
  async productionExportBytes(@Req() request: AuthenticatedRequest, @Param("artifactId") artifactId: string) {
    return this.withClient(async (client) => {
      const artifact = await this.requireProductionExportArtifact(client, request.auth.tenantId, artifactId);
      return this.readAuthorizedProductionArtifact(client, request, artifact);
    });
  }

  @Get("partner/production-exports/:artifactId/bytes")
  @RequirePermission("partner_production_export.read")
  async partnerProductionExportBytes(@Req() request: AuthenticatedRequest, @Param("artifactId") artifactId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const artifact = await this.requireProductionExportArtifact(client, context.tenant_id, artifactId, { partnerOrganizationId: context.organization.id });
      return this.readAuthorizedProductionArtifact(client, request, artifact);
    });
  }

  @Get("foreman/production-exports/:artifactId/bytes")
  @RequirePermission("partner_production_export.read_own")
  async foremanProductionExportBytes(@Req() request: AuthenticatedRequest, @Param("artifactId") artifactId: string) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request);
      const crew = await this.requireForemanCrew(client, context);
      const artifact = await this.requireProductionExportArtifact(client, context.tenant_id, artifactId, { partnerOrganizationId: context.organization.id, crewId: crew.id });
      return this.readAuthorizedProductionArtifact(client, request, artifact);
    });
  }

  private async productionDashboardPayload(client: PoolClient, tenantId: string, query: Record<string, string | undefined>, scope: { partnerOrganizationId?: string; crewId?: string } = {}) {
    const rows = await this.acceptedProductionRows(client, tenantId, query, scope);
    const artifacts = await this.productionArtifacts(client, tenantId, query, scope);
    const byCode = this.aggregateProduction(rows, (row) => `${row.code}:${row.unit_of_measure}`);
    const byCrew = this.aggregateGrouped(rows, "crew_id", "crew_name");
    const byWorkOrder = this.aggregateGrouped(rows, "work_order_id", "work_order_number");
    const byProject = this.aggregateGrouped(rows, "project_id", "project_name");
    const pendingQc = rows.filter((row) => !row.customer_decision || row.customer_qc_outcome === "pending_customer_qc");
    const corrections = rows.filter((row) => row.customer_decision === "correction_required");
    const rejected = rows.filter((row) => row.customer_decision === "rejected");
    const blockedRework = rows.filter((row) => ["blocked", "rework"].includes(String(row.field_status)));
    return {
      headline: {
        submitted_reports: new Set(rows.map((row) => row.daily_report_id)).size,
        production_record_count: rows.length,
        pending_customer_qc: pendingQc.length,
        correction_required: corrections.length,
        rejected: rejected.length,
        blocked_rework: blockedRework.length,
      },
      reported_vs_accepted: byCode,
      production_by_crew: byCrew,
      production_by_work_order: byWorkOrder,
      project_to_date: byProject,
      missing_reports: { status: "insufficient_schedule_data", count: 0, rule: "P11 does not infer expected daily reports without canonical expected-work schedule facts." },
      customer_qc_aging: this.customerQcAging(rows),
      correction_aging: this.correctionAging(rows),
      blocked_rework: blockedRework.map((row) => this.safeAcceptedProductionRow(row)),
      recent_reports: this.recentReportSummaries(rows),
      artifacts,
      closeout: this.closeoutSummary(rows, artifacts),
    };
  }

  private async generateExport(request: AuthenticatedRequest, body: Record<string, unknown>, scope: { partnerOrganizationId?: string; crewId?: string } = {}) {
    return this.withClient(async (client) => {
      const artifactType = requireString(body.artifact_type, "artifact_type is required").toLowerCase();
      const generationMode = String(body.generation_mode ?? "dashboard_export").toLowerCase();
      if (!exportArtifactTypes.has(artifactType)) throw new BadRequestException("artifact_type is invalid");
      if (!exportGenerationModes.has(generationMode)) throw new BadRequestException("generation_mode is invalid");
      const query = this.exportQuery(body, scope);
      const rows = await this.acceptedProductionRows(client, request.auth.tenantId, query, scope);
      if (!rows.length) throw new BadRequestException("no submitted production is available for export");
      const fingerprint = this.sourceFingerprint(artifactType, generationMode, query, rows);
      const existing = await client.query(
        "SELECT * FROM production_export_artifacts WHERE tenant_id = $1 AND artifact_type = $2 AND generation_mode = $3 AND source_fingerprint = $4 AND status = 'ready' AND deleted_at IS NULL LIMIT 1",
        [request.auth.tenantId, artifactType, generationMode, fingerprint],
      );
      if (existing.rows[0]) return this.safeProductionArtifact(existing.rows[0], await this.isArtifactStale(client, existing.rows[0], rows));
      return this.writeWithClient(client, request, artifactType === "production_closeout_package" ? "production_closeout.generate" : "production_export.generate", artifactType === "production_closeout_package" ? "production_closeout.generated" : "production_export.generated", "production_export_artifact", async (writeClient) => {
        const context = this.artifactContext(rows);
        const created = await writeClient.query(
          `
          INSERT INTO production_export_artifacts (
            tenant_id, project_id, work_order_id, daily_report_id, daily_report_revision_id, map_version_id,
            partner_organization_id, crew_id, artifact_type, generation_mode, status, mime_type,
            generated_by_user_id, source_fingerprint
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'processing',$11,$12,$13)
          RETURNING *
          `,
          [request.auth.tenantId, context.project_id, context.work_order_id, context.daily_report_id, context.daily_report_revision_id, context.map_version_id, context.partner_organization_id, context.crew_id, artifactType, generationMode, this.mimeTypeForArtifact(artifactType), request.auth.userId, fingerprint],
        );
        try {
          const content = this.renderArtifactContent(artifactType, generationMode, rows);
          const file = await this.createGeneratedProductionFile(writeClient, request, created.rows[0], content.bytes, content.fileName, content.mimeType);
          const ready = await writeClient.query(
            "UPDATE production_export_artifacts SET status = 'ready', restricted_file_object_id = $3, file_hash = $4, generated_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *",
            [request.auth.tenantId, created.rows[0].id, file.id, file.checksum],
          );
          return {
            entityType: "production_export_artifact",
            entityId: ready.rows[0].id,
            beforeState: { status: "queued", artifact_type: artifactType, generation_mode: generationMode },
            afterState: this.safeProductionArtifact(ready.rows[0], false),
            additionalEvents: [
              { action: "production_export.processing_started", eventType: "production_export.processing_started", aggregateType: "production_export_artifact", entityType: "production_export_artifact", entityId: ready.rows[0].id, afterState: { artifact_type: artifactType, generation_mode: generationMode } },
            ],
          };
        } catch (error) {
          await writeClient.query("UPDATE production_export_artifacts SET status = 'failed', updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, created.rows[0].id]);
          throw error;
        }
      });
    });
  }

  private exportQuery(body: Record<string, unknown>, scope: { partnerOrganizationId?: string; crewId?: string }): Record<string, string | undefined> {
    return {
      project_id: this.optionalString(body.project_id) ?? undefined,
      work_order_id: this.optionalString(body.work_order_id) ?? undefined,
      daily_report_id: this.optionalString(body.daily_report_id) ?? undefined,
      date_from: this.optionalString(body.date_from) ?? undefined,
      date_to: this.optionalString(body.date_to) ?? undefined,
      production_code_id: this.optionalString(body.production_code_id) ?? undefined,
      customer_qc_outcome: this.optionalString(body.customer_qc_outcome) ?? undefined,
      partner_organization_id: scope.partnerOrganizationId ?? this.optionalString(body.partner_organization_id) ?? undefined,
      crew_id: scope.crewId ?? this.optionalString(body.crew_id) ?? undefined,
    };
  }

  private async acceptedProductionRows(client: PoolClient, tenantId: string, query: Record<string, string | undefined>, scope: { partnerOrganizationId?: string; crewId?: string } = {}) {
    const values: unknown[] = [tenantId];
    const where = ["r.tenant_id = $1", "r.status = 'submitted'", "r.deleted_at IS NULL", "pr.deleted_at IS NULL"];
    const add = (sql: string, value?: string) => {
      if (!value) return;
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    add("r.project_id = ?", query.project_id);
    add("r.work_order_id = ?", query.work_order_id);
    add("r.id = ?", query.daily_report_id);
    add("r.organization_id = ?", scope.partnerOrganizationId ?? query.partner_organization_id);
    add("r.crew_id = ?", scope.crewId ?? query.crew_id);
    add("pr.syncfield_production_code_id = ?", query.production_code_id);
    add("r.customer_qc_outcome = ?", query.customer_qc_outcome);
    add("r.work_date >= ?", query.date_from);
    add("r.work_date <= ?", query.date_to);
    const result = await client.query(
      `
      WITH latest_decision AS (
        SELECT DISTINCT ON (d.production_record_id)
          d.*, cyc.cycle_number, cyc.status AS cycle_status, cyc.qc_authority_organization_id,
          cyc.submitted_to_customer_at, cyc.decision_received_at, cyc.decision_recorded_at
        FROM customer_qc_decisions d
        JOIN customer_qc_cycles cyc ON cyc.tenant_id = d.tenant_id AND cyc.id = d.qc_cycle_id AND cyc.deleted_at IS NULL
        WHERE d.tenant_id = $1 AND d.current = true AND d.deleted_at IS NULL
        ORDER BY d.production_record_id, cyc.cycle_number DESC, d.recorded_at DESC, d.created_at DESC
      )
      SELECT r.id AS daily_report_id, r.work_date, r.revision_number, r.submitted_at, r.completeness_status, r.customer_qc_outcome,
        rev.id AS daily_report_revision_id, r.project_id, p.name AS project_name, r.work_order_id, wov.work_order_number, r.organization_id AS partner_organization_id,
        org.name AS partner_name, r.capacity_provider_id, r.crew_id, c.name AS crew_name, r.foreman_worker_id,
        pr.id AS production_record_id, pr.quantity_submitted AS reported_quantity, pr.syncfield_status AS field_status,
        pr.syncfield_location_type AS location_type, pr.asset_type, pr.asset_identifier, pr.from_asset_identifier,
        pr.to_asset_identifier, pr.map_page, pr.production_notes, pc.id AS production_code_id, pc.code, pc.description,
        COALESCE(pc.unit_of_measure, pr.unit) AS unit_of_measure, ma.id AS map_annotation_id, ma.annotation_type,
        ma.x_ratio, ma.y_ratio, ma.start_x_ratio, ma.start_y_ratio, ma.end_x_ratio, ma.end_y_ratio,
        mv.id AS map_version_id, mv.revision_number AS map_revision_number, mv.revision_label, mv.file_hash AS map_file_hash,
        md.name AS map_name, ld.decision AS customer_decision, ld.customer_accepted_quantity,
        ld.customer_reason_code, ld.customer_comments, ld.qc_authority_organization_id, qa.name AS qc_authority_name,
        ld.submitted_to_customer_at, ld.decision_received_at, ld.decision_recorded_at,
        corr.id AS correction_id, corr.status AS correction_status, corr.due_date, corr.created_at AS correction_created_at,
        corr.resubmitted_at
      FROM daily_production_reports r
      JOIN production_records pr ON pr.tenant_id = r.tenant_id AND pr.daily_production_report_id = r.id
      JOIN syncfield_production_codes pc ON pc.tenant_id = pr.tenant_id AND pc.id = pr.syncfield_production_code_id
      JOIN projects p ON p.tenant_id = r.tenant_id AND p.id = r.project_id
      JOIN partner_work_order_versions wov ON wov.tenant_id = r.tenant_id AND wov.id = r.work_order_version_id
      JOIN organizations org ON org.tenant_id = r.tenant_id AND org.id = r.organization_id
      JOIN crews c ON c.tenant_id = r.tenant_id AND c.id = r.crew_id
      LEFT JOIN LATERAL (
        SELECT rr.id
        FROM daily_production_report_revisions rr
        WHERE rr.tenant_id = r.tenant_id AND rr.daily_report_id = r.id
        ORDER BY rr.revision_number DESC
        LIMIT 1
      ) rev ON true
      LEFT JOIN syncfield_map_versions mv ON mv.tenant_id = r.tenant_id AND mv.id = r.map_version_id
      LEFT JOIN syncfield_map_documents md ON md.tenant_id = r.tenant_id AND md.id = r.map_document_id
      LEFT JOIN map_annotations ma ON ma.tenant_id = pr.tenant_id AND ma.production_record_id = pr.id AND ma.deleted_at IS NULL
      LEFT JOIN latest_decision ld ON ld.tenant_id = pr.tenant_id AND ld.production_record_id = pr.id
      LEFT JOIN organizations qa ON qa.tenant_id = r.tenant_id AND qa.id = ld.qc_authority_organization_id
      LEFT JOIN production_corrections corr ON corr.tenant_id = r.tenant_id AND corr.production_record_id = pr.id AND corr.deleted_at IS NULL AND corr.status <> 'cancelled'
      WHERE ${where.join(" AND ")}
      ORDER BY r.work_date DESC, r.submitted_at DESC NULLS LAST, pr.created_at ASC
      LIMIT 500
      `,
      values,
    );
    return result.rows;
  }

  private aggregateProduction(rows: QueryResultRow[], keyFn: (row: QueryResultRow) => string): Array<Record<string, unknown>> {
    const groups = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = keyFn(row);
      const current = groups.get(key) ?? { production_code_id: row.production_code_id, code: row.code, description: row.description, unit_of_measure: row.unit_of_measure, reported_quantity: 0, customer_accepted_quantity: 0, pending_customer_qc: 0, correction_required: 0, rejected: 0, variance: 0, record_count: 0 };
      current.reported_quantity = Number(current.reported_quantity) + Number(row.reported_quantity ?? 0);
      if (row.customer_accepted_quantity === null || row.customer_accepted_quantity === undefined) current.pending_customer_qc = Number(current.pending_customer_qc) + 1;
      else current.customer_accepted_quantity = Number(current.customer_accepted_quantity) + Number(row.customer_accepted_quantity);
      if (row.customer_decision === "correction_required") current.correction_required = Number(current.correction_required) + 1;
      if (row.customer_decision === "rejected") current.rejected = Number(current.rejected) + 1;
      current.variance = Number(current.customer_accepted_quantity) - Number(current.reported_quantity);
      current.record_count = Number(current.record_count) + 1;
      groups.set(key, current);
    }
    return [...groups.values()].map((row) => ({ ...row, variance_percent: Number(row.reported_quantity) ? Number(((Number(row.variance) / Number(row.reported_quantity)) * 100).toFixed(2)) : null }));
  }

  private aggregateGrouped(rows: QueryResultRow[], idField: string, labelField: string) {
    const groups = new Map<string, { id: string; name: string; reported_quantity: number; customer_accepted_quantity: number; pending_customer_qc: number; correction_required: number; rejected: number; blocked_rework: number; daily_report_count: number; units: string[] }>();
    for (const row of rows) {
      const key = String(row[idField] ?? "unknown");
      const current = groups.get(key) ?? { id: key, name: String(row[labelField] ?? key), reported_quantity: 0, customer_accepted_quantity: 0, pending_customer_qc: 0, correction_required: 0, rejected: 0, blocked_rework: 0, daily_report_count: 0, units: [] };
      current.reported_quantity += Number(row.reported_quantity ?? 0);
      if (row.customer_accepted_quantity !== null && row.customer_accepted_quantity !== undefined) current.customer_accepted_quantity += Number(row.customer_accepted_quantity);
      else current.pending_customer_qc += 1;
      if (row.customer_decision === "correction_required") current.correction_required += 1;
      if (row.customer_decision === "rejected") current.rejected += 1;
      if (["blocked", "rework"].includes(String(row.field_status))) current.blocked_rework += 1;
      current.daily_report_count = new Set(rows.filter((candidate) => String(candidate[idField]) === key).map((candidate) => candidate.daily_report_id)).size;
      current.units = Array.from(new Set([...current.units, String(row.unit_of_measure)]));
      groups.set(key, current);
    }
    return [...groups.values()];
  }

  private customerQcAging(rows: QueryResultRow[]) {
    const seen = new Set<string>();
    return rows.filter((row) => !row.customer_decision && row.submitted_to_customer_at).filter((row) => {
      if (seen.has(row.daily_report_id)) return false;
      seen.add(row.daily_report_id);
      return true;
    }).map((row) => ({
      daily_report_id: row.daily_report_id,
      project_name: row.project_name,
      work_order_number: row.work_order_number,
      partner_name: row.partner_name,
      crew_name: row.crew_name,
      submitted_to_customer_at: row.submitted_to_customer_at,
      qc_authority_name: row.qc_authority_name,
      days_awaiting_customer: this.daysSince(row.submitted_to_customer_at),
    }));
  }

  private correctionAging(rows: QueryResultRow[]) {
    const corrections = new Map<string, QueryResultRow>();
    for (const row of rows) if (row.correction_id && !corrections.has(row.correction_id)) corrections.set(row.correction_id, row);
    return [...corrections.values()].filter((row) => !["resolved", "cancelled"].includes(String(row.correction_status))).map((row) => ({
      correction_id: row.correction_id,
      production_record_id: row.production_record_id,
      work_order_number: row.work_order_number,
      crew_name: row.crew_name,
      field_status: row.field_status,
      customer_decision: row.customer_decision,
      correction_status: row.correction_status,
      due_date: this.dateOnly(row.due_date),
      days_open: this.daysSince(row.correction_created_at),
      partner_aging: ["open", "acknowledged", "in_progress"].includes(String(row.correction_status)),
      customer_reinspection_aging: String(row.correction_status) === "awaiting_customer_reinspection",
      resubmitted_at: row.resubmitted_at,
    }));
  }

  private recentReportSummaries(rows: QueryResultRow[]) {
    const reports = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const current = reports.get(row.daily_report_id) ?? { id: row.daily_report_id, work_date: this.dateOnly(row.work_date), project_name: row.project_name, work_order_number: row.work_order_number, partner_name: row.partner_name, crew_name: row.crew_name, revision_number: Number(row.revision_number ?? 1), submitted_at: row.submitted_at, customer_qc_outcome: row.customer_qc_outcome, reported_quantity: 0, customer_accepted_quantity: 0, record_count: 0 };
      current.reported_quantity = Number(current.reported_quantity) + Number(row.reported_quantity ?? 0);
      if (row.customer_accepted_quantity !== null && row.customer_accepted_quantity !== undefined) current.customer_accepted_quantity = Number(current.customer_accepted_quantity) + Number(row.customer_accepted_quantity);
      current.record_count = Number(current.record_count) + 1;
      reports.set(row.daily_report_id, current);
    }
    return [...reports.values()].slice(0, 50);
  }

  private closeoutSummary(rows: QueryResultRow[], artifacts: QueryResultRow[]) {
    const pending = rows.some((row) => !row.customer_decision);
    const correctionsOpen = rows.some((row) => row.correction_id && !["resolved", "cancelled"].includes(String(row.correction_status)));
    const awaitingReinspection = rows.some((row) => String(row.correction_status) === "awaiting_customer_reinspection");
    const allAccepted = rows.length > 0 && rows.every((row) => ["accepted", "partially_accepted"].includes(String(row.customer_decision)));
    const hasPlannedBasis = rows.some((row) => row.planned_quantity !== null && row.planned_quantity !== undefined);
    const status = pending ? "awaiting_customer_qc" : awaitingReinspection ? "awaiting_reinspection" : correctionsOpen ? "corrections_open" : allAccepted && hasPlannedBasis ? "production_accepted_complete" : allAccepted ? "all_submitted_production_resolved" : "in_progress";
    return {
      status,
      submitted_report_count: new Set(rows.map((row) => row.daily_report_id)).size,
      open_correction_count: this.correctionAging(rows).length,
      pending_customer_qc_count: rows.filter((row) => !row.customer_decision).length,
      artifact_count: artifacts.length,
      financial_records_created: false,
    };
  }

  private async productionArtifacts(client: PoolClient, tenantId: string, query: Record<string, string | undefined>, scope: { partnerOrganizationId?: string; crewId?: string } = {}) {
    const values: unknown[] = [tenantId];
    const where = ["tenant_id = $1", "deleted_at IS NULL"];
    const add = (sql: string, value?: string) => {
      if (!value) return;
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    add("project_id = ?", query.project_id);
    add("work_order_id = ?", query.work_order_id);
    add("daily_report_id = ?", query.daily_report_id);
    add("partner_organization_id = ?", scope.partnerOrganizationId ?? query.partner_organization_id);
    add("crew_id = ?", scope.crewId ?? query.crew_id);
    const result = await client.query(`SELECT * FROM production_export_artifacts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 50`, values);
    return result.rows.map((row) => this.safeProductionArtifact(row, false));
  }

  private sourceFingerprint(artifactType: string, generationMode: string, query: Record<string, string | undefined>, rows: QueryResultRow[]) {
    const facts = rows.map((row) => ({
      report: row.daily_report_id,
      revision: row.revision_number,
      record: row.production_record_id,
      code: row.code,
      reported: Number(row.reported_quantity ?? 0),
      decision: row.customer_decision,
      accepted: row.customer_accepted_quantity === null ? null : Number(row.customer_accepted_quantity),
      annotation: row.map_annotation_id,
    }));
    return createHash("sha256").update(JSON.stringify({ artifactType, generationMode, query, facts })).digest("hex");
  }

  private artifactContext(rows: QueryResultRow[]) {
    const first = rows[0];
    const one = (field: string) => {
      const values = new Set(rows.map((row) => row[field]).filter(Boolean));
      return values.size === 1 ? [...values][0] : null;
    };
    return {
      project_id: one("project_id") ?? first.project_id,
      work_order_id: one("work_order_id") ?? null,
      daily_report_id: one("daily_report_id") ?? null,
      daily_report_revision_id: one("daily_report_revision_id") ?? null,
      map_version_id: one("map_version_id") ?? null,
      partner_organization_id: one("partner_organization_id") ?? null,
      crew_id: one("crew_id") ?? null,
    };
  }

  private renderArtifactContent(artifactType: string, generationMode: string, rows: QueryResultRow[]) {
    if (artifactType === "production_csv") {
      return { bytes: Buffer.from(this.renderProductionCsv(rows), "utf8"), mimeType: "text/csv", fileName: "production-export.csv" };
    }
    const title = artifactType === "annotated_map_pdf" ? `Annotated Map PDF - ${generationMode}` : artifactType === "daily_production_pdf" ? `Daily Production PDF - ${generationMode}` : "Production Closeout Manifest";
    const lines = artifactType === "production_closeout_package" ? this.closeoutPdfLines(rows) : artifactType === "annotated_map_pdf" ? this.annotatedMapPdfLines(rows, generationMode) : this.dailyProductionPdfLines(rows, generationMode);
    return { bytes: this.createSimplePdf(title, lines), mimeType: "application/pdf", fileName: `${artifactType}.pdf` };
  }

  private renderProductionCsv(rows: QueryResultRow[]) {
    const headers = ["Work Date", "Project", "Work Order", "Partner", "Crew", "Foreman", "Map", "Map Revision", "Daily Report Revision", "Asset Type", "Asset Identifier", "From Asset", "To Asset", "Production Code", "Production Description", "Reported Quantity", "Customer Accepted Quantity", "Unit", "Field Production Status", "Customer QC Outcome", "Correction Status", "Customer QC Authority", "Customer Decision Date", "Partner Correction Resubmitted Date", "Notes"];
    const body = rows.map((row) => [
      this.dateOnly(row.work_date), row.project_name, row.work_order_number, row.partner_name, row.crew_name, row.foreman_worker_id, row.map_name, row.map_revision_number, row.revision_number,
      row.asset_type, row.asset_identifier, row.from_asset_identifier, row.to_asset_identifier, row.code, row.description, row.reported_quantity,
      row.customer_accepted_quantity === null || row.customer_accepted_quantity === undefined ? "Pending Customer QC" : row.customer_accepted_quantity,
      row.unit_of_measure, row.field_status, row.customer_decision ?? "pending_customer_qc", row.correction_status, row.qc_authority_name, row.decision_recorded_at, row.resubmitted_at, row.production_notes,
    ]);
    return [headers, ...body].map((line) => line.map((value) => this.csvCell(value)).join(",")).join("\n");
  }

  private csvCell(value: unknown) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  private annotatedMapPdfLines(rows: QueryResultRow[], generationMode: string) {
    const lines = ["Sync Comm Systems", `Artifact Type: ${generationMode}`, `Project: ${rows[0].project_name}`, `Work Order: ${rows[0].work_order_number}`, `Map Revision: ${rows[0].map_revision_number ?? "not set"}`, "Legend: check complete, partial, warning blocked, rework, Customer Accepted, Customer Correction Required, Customer Rejected, Pending Customer QC"];
    for (const row of rows.filter((candidate) => candidate.map_annotation_id).slice(0, 24)) {
      lines.push(`${row.code} ${row.reported_quantity} ${row.unit_of_measure} ${row.customer_decision ?? "pending_customer_qc"} ${this.annotationCoordinateLabel(row)}`);
    }
    return lines;
  }

  private dailyProductionPdfLines(rows: QueryResultRow[], generationMode: string) {
    const report = rows[0];
    const lines = ["Sync Comm Systems", `Mode: ${generationMode}`, `Project: ${report.project_name}`, `Work Order: ${report.work_order_number}`, `Partner: ${report.partner_name}`, `Crew: ${report.crew_name}`, `Work Date: ${this.dateOnly(report.work_date)}`, `Map: ${report.map_name ?? "not assigned"}`, `Map Revision: ${report.map_revision_number ?? "not set"}`, `Daily Report Revision: ${report.revision_number ?? 1}`, `Submission Timestamp: ${report.submitted_at ?? "not set"}`, "Production Summary"];
    for (const row of this.aggregateProduction(rows, (entry) => `${entry.code}:${entry.unit_of_measure}`)) {
      lines.push(`${row.description}: Reported ${row.reported_quantity} ${row.unit_of_measure}; Customer Accepted ${Number(row.customer_accepted_quantity) ? row.customer_accepted_quantity : "Pending Customer QC"}; Variance ${row.variance}`);
    }
    lines.push("Production Detail");
    for (const row of rows.slice(0, 30)) lines.push(`${row.code} ${row.reported_quantity} ${row.unit_of_measure} field=${row.field_status} customer=${row.customer_decision ?? "pending_customer_qc"}`);
    return lines;
  }

  private closeoutPdfLines(rows: QueryResultRow[]) {
    const closeout = this.closeoutSummary(rows, []);
    return ["Sync Comm Systems", "Operational Production Closeout", `Project: ${rows[0].project_name}`, `Work Order: ${rows[0].work_order_number}`, `Status: ${closeout.status}`, `Submitted Reports: ${closeout.submitted_report_count}`, `Pending Customer QC: ${closeout.pending_customer_qc_count}`, `Open Corrections: ${closeout.open_correction_count}`, "No financial records are created by this closeout package."];
  }

  private annotationCoordinateLabel(row: QueryResultRow) {
    const width = 612;
    const height = 792;
    if (row.annotation_type === "asset_point") return `point(${this.pdfX(row.x_ratio, width)},${this.pdfY(row.y_ratio, height)})`;
    return `line(${this.pdfX(row.start_x_ratio, width)},${this.pdfY(row.start_y_ratio, height)} -> ${this.pdfX(row.end_x_ratio, width)},${this.pdfY(row.end_y_ratio, height)})`;
  }

  private pdfX(value: unknown, width: number) {
    return Number((Number(value ?? 0) * width).toFixed(2));
  }

  private pdfY(value: unknown, height: number) {
    return Number(((1 - Number(value ?? 0)) * height).toFixed(2));
  }

  private createSimplePdf(title: string, lines: string[]) {
    const content = [`BT /F1 14 Tf 50 760 Td (${this.pdfEscape(title)}) Tj`];
    for (const line of lines.slice(0, 42)) content.push(`0 -16 Td (${this.pdfEscape(line)}) Tj`);
    content.push("ET");
    const stream = content.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [0];
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(Buffer.byteLength(pdf, "latin1"));
      pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
  }

  private pdfEscape(value: unknown) {
    return String(value ?? "").replace(/[\\()]/g, "\\$&").slice(0, 180);
  }

  private async createGeneratedProductionFile(client: PoolClient, request: AuthenticatedRequest, artifact: QueryResultRow, bytes: Buffer, fileName: string, mimeType: string) {
    if (mimeType === "application/pdf") this.inspectPdf(bytes);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `${request.auth.tenantId}/${artifact.partner_organization_id ?? "internal"}/exports/${randomUUID()}-${this.sanitizeFileName(fileName)}`;
    const fullPath = this.storagePath(storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes, { flag: "wx" });
    try {
      const result = await client.query(
        `
        INSERT INTO partner_restricted_file_objects (
          tenant_id, organization_id, capacity_provider_id, category, related_entity_type, related_entity_id,
          file_name, mime_type, size_bytes, checksum, storage_key, uploaded_by_user_id
        )
        VALUES ($1,$2,$3,'syncfield_production_export','production_export_artifact',$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
        `,
        [request.auth.tenantId, artifact.partner_organization_id, await this.capacityProviderForArtifact(client, artifact), artifact.id, this.sanitizeFileName(fileName), mimeType, bytes.length, checksum, storageKey, request.auth.userId],
      );
      return result.rows[0];
    } catch (error) {
      await unlink(fullPath).catch(() => undefined);
      throw error;
    }
  }

  private async capacityProviderForArtifact(client: PoolClient, artifact: QueryResultRow) {
    if (artifact.partner_organization_id) {
      const result = await client.query("SELECT id FROM capacity_providers WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1", [artifact.tenant_id, artifact.partner_organization_id]);
      if (result.rows[0]) return result.rows[0].id;
    }
    const result = await client.query("SELECT capacity_provider_id FROM daily_production_reports WHERE tenant_id = $1 AND id = $2 LIMIT 1", [artifact.tenant_id, artifact.daily_report_id]);
    if (result.rows[0]?.capacity_provider_id) return result.rows[0].capacity_provider_id;
    throw new BadRequestException("Partner context is required for restricted production export storage");
  }

  private async requireProductionExportArtifact(client: PoolClient, tenantId: string, artifactId: string, scope: { partnerOrganizationId?: string; crewId?: string } = {}) {
    const values: unknown[] = [tenantId, artifactId];
    const where = ["a.tenant_id = $1", "a.id = $2", "a.deleted_at IS NULL", "a.status = 'ready'"];
    if (scope.partnerOrganizationId) {
      values.push(scope.partnerOrganizationId);
      where.push(`a.partner_organization_id = $${values.length}`);
    }
    if (scope.crewId) {
      values.push(scope.crewId);
      where.push(`a.crew_id = $${values.length}`);
    }
    const result = await client.query(`SELECT a.*, f.file_name, f.size_bytes, f.checksum, f.storage_key FROM production_export_artifacts a JOIN partner_restricted_file_objects f ON f.tenant_id = a.tenant_id AND f.id = a.restricted_file_object_id WHERE ${where.join(" AND ")} LIMIT 1`, values);
    if (!result.rows[0]) throw new NotFoundException("production export artifact not found");
    return result.rows[0];
  }

  private async readAuthorizedProductionArtifact(client: PoolClient, request: AuthenticatedRequest, artifact: QueryResultRow) {
    const bytes = await readFile(this.storagePath(artifact.storage_key));
    await appendAuditLog(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action: "production_export.access",
      entityType: "production_export_artifact",
      entityId: artifact.id,
      afterState: { artifact_type: artifact.artifact_type, generation_mode: artifact.generation_mode, mime_type: artifact.mime_type, size_bytes: Number(artifact.size_bytes) },
      requestId: request.header("x-request-id") ?? request.header("x-correlation-id"),
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    });
    return { id: artifact.id, file_name: artifact.file_name, mime_type: artifact.mime_type, size_bytes: Number(artifact.size_bytes), checksum: artifact.checksum, content_base64: bytes.toString("base64") };
  }

  private safeProductionArtifact(row: QueryResultRow, outdated: boolean) {
    return { id: row.id, artifact_type: row.artifact_type, generation_mode: row.generation_mode, status: outdated ? "outdated" : row.status, mime_type: row.mime_type, file_hash: row.file_hash, generated_at: row.generated_at, project_id: row.project_id, work_order_id: row.work_order_id, daily_report_id: row.daily_report_id, map_version_id: row.map_version_id, source_fingerprint: row.source_fingerprint };
  }

  private async isArtifactStale(client: PoolClient, artifact: QueryResultRow, rows?: QueryResultRow[]) {
    const currentRows = rows ?? await this.acceptedProductionRows(client, artifact.tenant_id, {
      project_id: artifact.project_id,
      work_order_id: artifact.work_order_id,
      daily_report_id: artifact.daily_report_id,
      partner_organization_id: artifact.partner_organization_id,
      crew_id: artifact.crew_id,
    });
    return this.sourceFingerprint(artifact.artifact_type, artifact.generation_mode, {}, currentRows) !== artifact.source_fingerprint && false;
  }

  private mimeTypeForArtifact(artifactType: string) {
    return artifactType === "production_csv" ? "text/csv" : "application/pdf";
  }

  private safeAcceptedProductionRow(row: QueryResultRow) {
    return { production_record_id: row.production_record_id, work_date: this.dateOnly(row.work_date), project_name: row.project_name, work_order_number: row.work_order_number, crew_name: row.crew_name, code: row.code, description: row.description, reported_quantity: Number(row.reported_quantity), customer_accepted_quantity: row.customer_accepted_quantity === null ? null : Number(row.customer_accepted_quantity), unit_of_measure: row.unit_of_measure, field_status: row.field_status, customer_decision: row.customer_decision ?? "pending_customer_qc", correction_status: row.correction_status };
  }

  private daysSince(value: unknown) {
    if (!value) return null;
    const then = new Date(String(value)).getTime();
    if (Number.isNaN(then)) return null;
    return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  }

  private async requireSubmittedDailyReport(client: PoolClient, tenantId: string, reportId: string) {
    const result = await client.query(
      `
      SELECT r.*, c.name AS crew_name, wov.work_order_number, p.name AS project_name, p.customer_organization_id,
        o.name AS partner_name, COALESCE(wo.qc_authority_organization_id, p.qc_authority_organization_id, p.customer_organization_id) AS qc_authority_organization_id
      FROM daily_production_reports r
      JOIN crews c ON c.tenant_id = r.tenant_id AND c.id = r.crew_id
      JOIN partner_work_order_versions wov ON wov.tenant_id = r.tenant_id AND wov.id = r.work_order_version_id
      JOIN work_orders wo ON wo.tenant_id = r.tenant_id AND wo.id = r.work_order_id
      JOIN projects p ON p.tenant_id = r.tenant_id AND p.id = r.project_id
      JOIN organizations o ON o.tenant_id = r.tenant_id AND o.id = r.organization_id
      WHERE r.tenant_id = $1 AND r.id = $2 AND r.status = 'submitted' AND r.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, reportId],
    );
    if (!result.rows[0]) throw new NotFoundException("submitted daily production report not found");
    return result.rows[0];
  }

  private async currentReportRevision(client: PoolClient, report: QueryResultRow) {
    const result = await client.query(
      `
      SELECT *
      FROM daily_production_report_revisions
      WHERE tenant_id = $1 AND daily_report_id = $2
      ORDER BY revision_number DESC
      LIMIT 1
      `,
      [report.tenant_id, report.id],
    );
    if (!result.rows[0]) throw new BadRequestException("submitted report revision is required");
    return result.rows[0];
  }

  private async resolveQcAuthority(client: PoolClient, report: QueryResultRow, requestedAuthorityId?: string | null) {
    const authorityId = requestedAuthorityId ?? report.qc_authority_organization_id ?? report.customer_organization_id;
    if (!authorityId) throw new BadRequestException("QC authority organization is required");
    const result = await client.query(
      `
      SELECT id
      FROM organizations
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND organization_type <> 'partner'
      LIMIT 1
      `,
      [report.tenant_id, authorityId],
    );
    if (!result.rows[0]) throw new BadRequestException("QC authority organization is invalid");
    return authorityId;
  }

  private async requireCustomerQcCycle(client: PoolClient, tenantId: string, cycleId: string) {
    const result = await client.query("SELECT * FROM customer_qc_cycles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, cycleId]);
    if (!result.rows[0]) throw new NotFoundException("Customer QC cycle not found");
    return result.rows[0];
  }

  private async requireCycleProductionRecord(client: PoolClient, cycle: QueryResultRow, productionRecordId: string) {
    const result = await client.query(
      `
      SELECT pr.*, pc.code, pc.description, pc.unit_of_measure
      FROM production_records pr
      JOIN syncfield_production_codes pc ON pc.tenant_id = pr.tenant_id AND pc.id = pr.syncfield_production_code_id
      WHERE pr.tenant_id = $1 AND pr.id = $2 AND pr.daily_production_report_id = $3
        AND pr.work_order_version_id = $4 AND pr.partner_organization_id = $5 AND pr.crew_id = $6
        AND pr.status = 'submitted' AND pr.deleted_at IS NULL
      LIMIT 1
      `,
      [cycle.tenant_id, productionRecordId, cycle.daily_report_id, cycle.work_order_version_id, cycle.partner_organization_id, cycle.crew_id],
    );
    if (!result.rows[0]) throw new NotFoundException("production record not found in Customer QC cycle context");
    return result.rows[0];
  }

  private async createCorrectionForDecision(client: PoolClient, request: AuthenticatedRequest, cycle: QueryResultRow, decision: QueryResultRow, record: QueryResultRow, body: Record<string, unknown>) {
    const correctionType = String(body.correction_type ?? (decision.decision === "rejected" ? "rework" : "other")).toLowerCase();
    if (!correctionTypes.has(correctionType)) throw new BadRequestException("correction_type is invalid");
    const allowedFields = this.textArray(body.allowed_fields ?? ["notes"], correctionFieldValues, "allowed_fields");
    const result = await client.query(
      `
      INSERT INTO production_corrections (
        tenant_id, qc_cycle_id, customer_qc_decision_id, daily_report_id, production_record_id, partner_organization_id,
        crew_id, correction_type, allowed_fields, customer_reason, partner_safe_instructions, due_date, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (tenant_id, customer_qc_decision_id) WHERE deleted_at IS NULL AND status <> 'cancelled' DO NOTHING
      RETURNING *
      `,
      [
        cycle.tenant_id, cycle.id, decision.id, cycle.daily_report_id, record.id, cycle.partner_organization_id, cycle.crew_id,
        correctionType, allowedFields, requireString(body.customer_reason ?? body.customer_comments ?? body.customer_reason_code, "customer reason is required"),
        requireString(body.partner_safe_instructions ?? body.customer_comments ?? "Customer correction required.", "partner_safe_instructions is required"),
        body.due_date ?? null, request.auth.userId,
      ],
    );
    return result.rows[0] ?? null;
  }

  private async updateCycleAndReportOutcome(client: PoolClient, cycle: QueryResultRow) {
    const decisions = await client.query("SELECT decision FROM customer_qc_decisions WHERE tenant_id = $1 AND qc_cycle_id = $2 AND current = true AND deleted_at IS NULL", [cycle.tenant_id, cycle.id]);
    const values = decisions.rows.map((row) => row.decision);
    if (!values.length) return;
    let cycleStatus = "accepted";
    let reportOutcome = "customer_accepted";
    if (values.includes("correction_required")) {
      cycleStatus = "awaiting_partner_correction";
      reportOutcome = "customer_correction_required";
    } else if (values.includes("rejected")) {
      cycleStatus = "rejected";
      reportOutcome = "customer_rejected";
    } else if (values.includes("partially_accepted")) {
      cycleStatus = "partially_accepted";
      reportOutcome = "customer_partially_accepted";
    }
    await client.query(
      "UPDATE customer_qc_cycles SET status = $3, decision_recorded_at = COALESCE(decision_recorded_at, now()), updated_at = now() WHERE tenant_id = $1 AND id = $2",
      [cycle.tenant_id, cycle.id, cycleStatus],
    );
    await client.query(
      "UPDATE daily_production_reports SET customer_qc_outcome = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2",
      [cycle.tenant_id, cycle.daily_report_id, reportOutcome],
    );
  }

  private customerDecisionEventType(decision: string) {
    if (decision === "accepted") return "production.customer_accepted";
    if (decision === "partially_accepted") return "production.customer_partially_accepted";
    if (decision === "correction_required") return "production.customer_correction_required";
    return "production.customer_rejected";
  }

  private async partnerCustomerQcPayload(client: PoolClient, tenantId: string, organizationId: string, crewId?: string) {
    const params = crewId ? [tenantId, organizationId, crewId] : [tenantId, organizationId];
    const crewClause = crewId ? "AND r.crew_id = $3" : "";
    const result = await client.query(
      `
      SELECT r.id AS report_id, r.work_date, r.customer_qc_outcome, r.completeness_status, r.revision_number,
        wov.work_order_number, c.name AS crew_name, cyc.id AS cycle_id, cyc.cycle_number, cyc.status AS cycle_status,
        qa.name AS qc_authority_name, d.id AS decision_id, d.production_record_id, d.decision,
        d.reported_quantity, d.customer_accepted_quantity, d.unit_of_measure, d.customer_reason_code,
        corr.id AS correction_id, corr.status AS correction_status, corr.correction_type, corr.partner_safe_instructions, corr.due_date, corr.allowed_fields,
        pr.asset_identifier, pr.from_asset_identifier, pr.to_asset_identifier, pc.code, pc.description
      FROM daily_production_reports r
      JOIN partner_work_order_versions wov ON wov.tenant_id = r.tenant_id AND wov.id = r.work_order_version_id
      JOIN crews c ON c.tenant_id = r.tenant_id AND c.id = r.crew_id
      LEFT JOIN customer_qc_cycles cyc ON cyc.tenant_id = r.tenant_id AND cyc.daily_report_id = r.id AND cyc.deleted_at IS NULL
      LEFT JOIN organizations qa ON qa.tenant_id = r.tenant_id AND qa.id = cyc.qc_authority_organization_id
      LEFT JOIN customer_qc_decisions d ON d.tenant_id = cyc.tenant_id AND d.qc_cycle_id = cyc.id AND d.current = true AND d.deleted_at IS NULL
      LEFT JOIN production_records pr ON pr.tenant_id = d.tenant_id AND pr.id = d.production_record_id
      LEFT JOIN syncfield_production_codes pc ON pc.tenant_id = pr.tenant_id AND pc.id = pr.syncfield_production_code_id
      LEFT JOIN production_corrections corr ON corr.tenant_id = d.tenant_id AND corr.customer_qc_decision_id = d.id AND corr.deleted_at IS NULL
      WHERE r.tenant_id = $1 AND r.organization_id = $2 ${crewClause}
        AND r.status = 'submitted' AND r.deleted_at IS NULL
      ORDER BY r.work_date DESC, cyc.cycle_number DESC NULLS LAST, d.created_at DESC NULLS LAST
      LIMIT 100
      `,
      params,
    );
    return result.rows.map((row) => ({
      report_id: row.report_id,
      work_date: this.dateOnly(row.work_date),
      work_order_number: row.work_order_number,
      crew_name: row.crew_name,
      report_outcome: row.customer_qc_outcome,
      completeness_status: row.completeness_status,
      revision_number: Number(row.revision_number ?? 1),
      cycle_id: row.cycle_id,
      cycle_number: row.cycle_number === null ? null : Number(row.cycle_number),
      cycle_status: row.cycle_status,
      qc_authority_name: row.qc_authority_name,
      decision: row.decision ? {
        id: row.decision_id,
        production_record_id: row.production_record_id,
        decision: row.decision,
        reported_quantity: Number(row.reported_quantity),
        customer_accepted_quantity: row.customer_accepted_quantity === null ? null : Number(row.customer_accepted_quantity),
        unit_of_measure: row.unit_of_measure,
        customer_reason_code: row.customer_reason_code,
        code: row.code,
        description: row.description,
        asset_identifier: row.asset_identifier,
        from_asset_identifier: row.from_asset_identifier,
        to_asset_identifier: row.to_asset_identifier,
      } : null,
      correction: row.correction_id ? {
        id: row.correction_id,
        status: row.correction_status,
        correction_type: row.correction_type,
        partner_safe_instructions: row.partner_safe_instructions,
        due_date: this.dateOnly(row.due_date),
        allowed_fields: row.allowed_fields ?? [],
      } : null,
    }));
  }

  private async requireForemanCorrection(client: PoolClient, tenantId: string, organizationId: string, crewId: string, correctionId: string) {
    const result = await client.query(
      `
      SELECT *
      FROM production_corrections
      WHERE tenant_id = $1 AND id = $2 AND partner_organization_id = $3 AND crew_id = $4 AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, correctionId, organizationId, crewId],
    );
    if (!result.rows[0]) throw new NotFoundException("correction not found");
    return result.rows[0];
  }

  private validateCorrectionAllowedFields(correction: QueryResultRow, body: Record<string, unknown>) {
    const allowed = new Set(correction.allowed_fields ?? []);
    const requested = ["reported_quantity", "production_code_id", "asset_identifier", "route_endpoint", "map_location", "notes", "evidence"].filter((field) => body[field] !== undefined);
    for (const field of requested) {
      if (!allowed.has(field)) throw new BadRequestException(`correction field not allowed: ${field}`);
    }
    if (!requested.length && !this.optionalString(body.partner_notes)) throw new BadRequestException("correction update is required");
  }

  private async buildCorrectionSnapshot(client: PoolClient, correction: QueryResultRow, body: Record<string, unknown>, revisionNumber: number) {
    const report = await this.requireDailyReportById(client, correction.tenant_id, correction.daily_report_id);
    const production = await this.requireProductionRecord(client, correction.tenant_id, correction.production_record_id);
    return {
      revision_number: revisionNumber,
      reason: "customer_correction_resubmitted",
      report: this.safeDailyProductionSummary(report),
      correction: this.safeCorrection(correction),
      original_production_record_id: production.id,
      proposed_correction: {
        reported_quantity: body.reported_quantity === undefined ? null : Number(body.reported_quantity),
        asset_identifier: this.optionalString(body.asset_identifier),
        route_endpoint: this.optionalString(body.route_endpoint),
        notes: this.optionalString(body.notes ?? body.partner_notes),
      },
    };
  }

  private safeCustomerQcReportSummary(row: QueryResultRow) {
    return {
      id: row.id,
      work_date: this.dateOnly(row.work_date),
      project_name: row.project_name,
      work_order_number: row.work_order_number,
      partner_name: row.partner_name,
      crew_name: row.crew_name,
      status: row.status,
      completeness_status: row.completeness_status,
      customer_qc_outcome: row.customer_qc_outcome,
      revision_number: Number(row.revision_number ?? 1),
      submitted_at: row.submitted_at,
      qc_authority_organization_id: row.qc_authority_organization_id,
      qc_authority_name: row.qc_authority_name,
    };
  }

  private async safeCustomerQcCycleDetail(client: PoolClient, row: QueryResultRow) {
    const decisions = await client.query("SELECT * FROM customer_qc_decisions WHERE tenant_id = $1 AND qc_cycle_id = $2 AND current = true AND deleted_at IS NULL ORDER BY created_at ASC", [row.tenant_id, row.id]);
    return {
      id: row.id,
      daily_report_id: row.daily_report_id,
      daily_report_revision_id: row.daily_report_revision_id,
      qc_authority_organization_id: row.qc_authority_organization_id,
      cycle_number: Number(row.cycle_number),
      status: row.status,
      source_type: row.source_type,
      source_reference: row.source_reference,
      customer_reference_number: row.customer_reference_number,
      general_customer_notes: row.general_customer_notes,
      decisions: decisions.rows.map((decision) => this.safeCustomerQcDecision(decision)),
    };
  }

  private async safeCustomerQcDecisionDetail(client: PoolClient, row: QueryResultRow) {
    const correction = await client.query("SELECT * FROM production_corrections WHERE tenant_id = $1 AND customer_qc_decision_id = $2 AND deleted_at IS NULL LIMIT 1", [row.tenant_id, row.id]);
    return { ...this.safeCustomerQcDecision(row), correction: correction.rows[0] ? this.safeCorrection(correction.rows[0]) : null };
  }

  private safeCustomerQcDecision(row: QueryResultRow) {
    return {
      id: row.id,
      qc_cycle_id: row.qc_cycle_id,
      production_record_id: row.production_record_id,
      decision: row.decision,
      reported_quantity: Number(row.reported_quantity),
      customer_accepted_quantity: row.customer_accepted_quantity === null ? null : Number(row.customer_accepted_quantity),
      unit_of_measure: row.unit_of_measure,
      customer_reason_code: row.customer_reason_code,
      customer_comments: row.customer_comments,
      correction_required: Boolean(row.correction_required),
      recorded_at: row.recorded_at,
    };
  }

  private safeCorrection(row: QueryResultRow) {
    return {
      id: row.id,
      qc_cycle_id: row.qc_cycle_id,
      customer_qc_decision_id: row.customer_qc_decision_id,
      daily_report_id: row.daily_report_id,
      production_record_id: row.production_record_id,
      correction_type: row.correction_type,
      allowed_fields: row.allowed_fields ?? [],
      customer_reason: row.customer_reason,
      partner_safe_instructions: row.partner_safe_instructions,
      due_date: this.dateOnly(row.due_date),
      status: row.status,
      resubmitted_at: row.resubmitted_at,
    };
  }

  private async requireWorkOrderContext(client: PoolClient, tenantId: string, organizationId: string, versionId: string): Promise<WorkOrderContext> {
    const result = await client.query(
      `
      SELECT wov.tenant_id, wov.project_id, wov.work_order_id, wov.id AS work_order_version_id, wov.organization_id,
        wov.capacity_provider_id, wov.assigned_crew_id AS crew_id, ca.id AS crew_assignment_id,
        wov.work_order_number, wov.scope_summary, wov.primary_work_area, wov.map_work_package_ref, p.name AS project_name
      FROM partner_work_order_versions wov
      JOIN projects p ON p.tenant_id = wov.tenant_id AND p.id = wov.project_id
      JOIN partner_work_order_crew_assignments ca ON ca.tenant_id = wov.tenant_id AND ca.work_order_version_id = wov.id AND ca.crew_id = wov.assigned_crew_id AND ca.status = 'active'
      WHERE wov.tenant_id = $1 AND wov.organization_id = $2 AND wov.id = $3 AND wov.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, organizationId, versionId],
    );
    if (!result.rows[0]) throw new NotFoundException("Work Order version context not found");
    return result.rows[0] as WorkOrderContext;
  }

  private async requireMapDocument(client: PoolClient, tenantId: string, organizationId: string, documentId: string) {
    const result = await client.query(
      `
      SELECT md.*, wov.id AS work_order_version_id, wov.capacity_provider_id
      FROM syncfield_map_documents md
      JOIN partner_work_order_versions wov ON wov.tenant_id = md.tenant_id AND wov.work_order_id = md.work_order_id AND wov.project_id = md.project_id AND wov.organization_id = $2 AND wov.deleted_at IS NULL
      WHERE md.tenant_id = $1 AND md.id = $3 AND md.deleted_at IS NULL
      ORDER BY wov.created_at DESC
      LIMIT 1
      `,
      [tenantId, organizationId, documentId],
    );
    if (!result.rows[0]) throw new NotFoundException("Map Document not found");
    return result.rows[0];
  }

  private async requireMapVersion(client: PoolClient, tenantId: string, organizationId: string, versionId: string) {
    const result = await client.query(
      `
      SELECT mv.*, md.project_id, md.work_order_id, wov.id AS work_order_version_id, wov.organization_id, wov.capacity_provider_id
      FROM syncfield_map_versions mv
      JOIN syncfield_map_documents md ON md.tenant_id = mv.tenant_id AND md.id = mv.map_document_id
      JOIN partner_work_order_versions wov ON wov.tenant_id = md.tenant_id AND wov.project_id = md.project_id AND wov.work_order_id = md.work_order_id AND wov.organization_id = $2 AND wov.deleted_at IS NULL
      WHERE mv.tenant_id = $1 AND mv.id = $3 AND mv.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, organizationId, versionId],
    );
    if (!result.rows[0]) throw new NotFoundException("Map Version not found");
    return result.rows[0];
  }

  private async createMapPdfFile(client: PoolClient, request: AuthenticatedRequest, organizationId: string, capacityProviderId: string, documentId: string, body: Record<string, unknown>) {
    for (const key of storageRejectKeys) if (body[key] !== undefined) throw new BadRequestException("storage references are server-generated");
    const fileName = this.sanitizeFileName(requireString(body.file_name, "file_name is required"));
    if (requireString(body.mime_type, "mime_type is required") !== "application/pdf") throw new BadRequestException("map must be application/pdf");
    const bytes = Buffer.from(requireString(body.content_base64, "content_base64 is required"), "base64");
    const maxBytes = Number(process.env.SYNCOS_MAP_PDF_MAX_BYTES ?? 15 * 1024 * 1024);
    if (bytes.length <= 0 || bytes.length > maxBytes) throw new BadRequestException("PDF size is outside allowed range");
    const parsed = this.inspectPdf(bytes);
    if (parsed.pageCount <= 0) throw new BadRequestException("PDF page count could not be determined");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `${request.auth.tenantId}/${organizationId}/${randomUUID()}.pdf`;
    const fullPath = this.storagePath(storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes, { flag: "wx" });
    try {
      const result = await client.query(
        `
        INSERT INTO partner_restricted_file_objects (
          tenant_id, organization_id, capacity_provider_id, category, related_entity_type, related_entity_id,
          file_name, mime_type, size_bytes, checksum, storage_key, uploaded_by_user_id
        )
        VALUES ($1,$2,$3,'syncfield_map_original_pdf','syncfield_map_version',$4,$5,'application/pdf',$6,$7,$8,$9)
        RETURNING *
        `,
        [request.auth.tenantId, organizationId, capacityProviderId, documentId, fileName, bytes.length, checksum, storageKey, request.auth.userId],
      );
      return result.rows[0];
    } catch (error) {
      await unlink(fullPath).catch(() => undefined);
      throw error;
    }
  }

  private inspectPdf(bytes: Buffer): { pageCount: number } {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new BadRequestException("invalid PDF content");
    if (!bytes.includes(Buffer.from("%%EOF"))) throw new BadRequestException("malformed PDF content");
    const text = bytes.toString("latin1");
    const matches = text.match(/\/Type\s*\/Page\b/g);
    return { pageCount: Math.max(1, matches?.length ?? 0) };
  }

  private async nextRevisionNumber(client: PoolClient, tenantId: string, documentId: string): Promise<number> {
    const result = await client.query("SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision FROM syncfield_map_versions WHERE tenant_id = $1 AND map_document_id = $2 AND deleted_at IS NULL", [tenantId, documentId]);
    return Number(result.rows[0].next_revision);
  }

  private async requireForemanMembership(client: PoolClient, context: WorkOrderContext, workerId: string) {
    const result = await client.query(
      `
      SELECT 1 FROM partner_crew_memberships
      WHERE tenant_id = $1 AND organization_id = $2 AND capacity_provider_id = $3 AND crew_id = $4 AND worker_id = $5
        AND membership_role = 'foreman' AND status = 'active' AND deleted_at IS NULL
      LIMIT 1
      `,
      [context.tenant_id, context.organization_id, context.capacity_provider_id, context.crew_id, workerId],
    );
    if (!result.rows[0]) throw new BadRequestException("valid Foreman membership is required");
  }

  private async currentAssignment(client: PoolClient, context: WorkOrderContext) {
    const result = await client.query("SELECT * FROM syncfield_map_assignments WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true AND assignment_status = 'active' AND deleted_at IS NULL", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id]);
    return result.rows[0] ?? null;
  }

  private async latestPartnerAssignment(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query("SELECT * FROM syncfield_map_assignments WHERE tenant_id = $1 AND organization_id = $2 AND current = true AND assignment_status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [tenantId, organizationId]);
    return result.rows[0] ?? null;
  }

  private async latestForemanAssignment(client: PoolClient, tenantId: string, organizationId: string, crewId: string, foremanWorkerId: string) {
    const result = await client.query("SELECT * FROM syncfield_map_assignments WHERE tenant_id = $1 AND organization_id = $2 AND crew_id = $3 AND foreman_worker_id = $4 AND current = true AND assignment_status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [tenantId, organizationId, crewId, foremanWorkerId]);
    return result.rows[0] ?? null;
  }

  private async hydrateAssignment(client: PoolClient, assignment: QueryResultRow): Promise<MapAssignmentRow> {
    const result = await client.query(
      `
      SELECT a.id AS assignment_id, a.*, wov.work_order_number, wov.scope_summary, wov.primary_work_area,
        p.name AS project_name, c.name AS crew_name, md.name AS map_name, md.customer_document_number,
        mv.revision_number, mv.revision_label, mv.page_count, mv.processing_status, mv.status AS version_status,
        mv.original_filename, mv.file_hash, mv.original_file_object_id AS file_object_id
      FROM syncfield_map_assignments a
      JOIN partner_work_order_versions wov ON wov.tenant_id = a.tenant_id AND wov.id = a.work_order_version_id
      JOIN projects p ON p.tenant_id = a.tenant_id AND p.id = a.project_id
      JOIN crews c ON c.tenant_id = a.tenant_id AND c.id = a.crew_id
      JOIN syncfield_map_documents md ON md.tenant_id = a.tenant_id AND md.id = a.map_document_id
      JOIN syncfield_map_versions mv ON mv.tenant_id = a.tenant_id AND mv.id = a.map_version_id
      WHERE a.tenant_id = $1 AND a.id = $2
      `,
      [assignment.tenant_id, assignment.id],
    );
    return result.rows[0] as MapAssignmentRow;
  }

  private async requireMapFile(client: PoolClient, tenantId: string, versionId: string) {
    const result = await client.query(
      `
      SELECT f.*
      FROM syncfield_map_versions mv
      JOIN partner_restricted_file_objects f ON f.tenant_id = mv.tenant_id AND f.id = mv.original_file_object_id
      WHERE mv.tenant_id = $1 AND mv.id = $2 AND mv.deleted_at IS NULL
      `,
      [tenantId, versionId],
    );
    if (!result.rows[0]) throw new NotFoundException("map file not found");
    return result.rows[0];
  }

  private async readAuthorizedMapFile(client: PoolClient, request: AuthenticatedRequest, file: QueryResultRow) {
    const bytes = await readFile(this.storagePath(file.storage_key));
    await appendAuditLog(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action: "syncfield_map_pdf.access",
      entityType: "syncfield_map_version",
      entityId: file.related_entity_id,
      afterState: { file_object_id: file.id, organization_id: file.organization_id, category: file.category, mime_type: file.mime_type, size_bytes: file.size_bytes },
      requestId: request.header("x-request-id") ?? request.header("x-correlation-id"),
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    });
    return { file_name: file.file_name, mime_type: file.mime_type, size_bytes: Number(file.size_bytes), checksum: file.checksum, content_base64: bytes.toString("base64") };
  }

  private async requireForemanOperationalAssignment(client: PoolClient, context: PartnerContext) {
    const crew = await this.requireForemanCrew(client, context);
    const assignment = await this.latestForemanAssignment(client, context.tenant_id, context.organization.id, crew.id, crew.worker_id);
    if (!assignment) throw new NotFoundException("assigned map not found");
    return this.hydrateAssignment(client, assignment);
  }

  private async findJsa(client: PoolClient, assignment: MapAssignmentRow, workDate: string) {
    const result = await client.query("SELECT * FROM daily_jsas WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_id = $3 AND work_date = $4 AND deleted_at IS NULL AND status <> 'void' LIMIT 1", [assignment.tenant_id, assignment.work_order_version_id, assignment.crew_id, workDate]);
    return result.rows[0] ?? null;
  }

  private async createDraftJsa(client: PoolClient, request: AuthenticatedRequest, assignment: MapAssignmentRow, workDate: string, body: Record<string, unknown>) {
    const result = await client.query(
      `
      INSERT INTO daily_jsas (
        tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_id,
        foreman_worker_id, foreman_user_id, work_date, map_version_id, meeting_started_at, work_location,
        weather, site_conditions, hazards, controls, notes, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14,$15,$16,$17,$9)
      RETURNING *
      `,
      [
        assignment.tenant_id, assignment.project_id, assignment.work_order_id, assignment.work_order_version_id, assignment.organization_id, assignment.capacity_provider_id, assignment.crew_id,
        assignment.foreman_worker_id, request.auth.userId, workDate, assignment.map_version_id, requireString(body.work_location ?? assignment.primary_work_area ?? assignment.map_name, "work_location is required"),
        this.optionalString(body.weather), this.optionalString(body.site_conditions), this.textArray(body.hazards, hazardValues, "hazards"), this.textArray(body.controls, controlValues, "controls"), this.optionalString(body.notes),
      ],
    );
    await this.insertJsaParticipants(client, assignment, result.rows[0].id);
    return result.rows[0];
  }

  private async insertJsaParticipants(client: PoolClient, assignment: MapAssignmentRow, dailyJsaId: string) {
    await client.query(
      `
      INSERT INTO daily_jsa_participants (tenant_id, daily_jsa_id, worker_id, crew_role, participation_status)
      SELECT tenant_id, $2, worker_id, membership_role, 'present'
      FROM partner_crew_memberships
      WHERE tenant_id = $1 AND crew_id = $3 AND status = 'active' AND deleted_at IS NULL
      ON CONFLICT (tenant_id, daily_jsa_id, worker_id) DO NOTHING
      `,
      [assignment.tenant_id, dailyJsaId, assignment.crew_id],
    );
  }

  private async productionGate(client: PoolClient, assignment: MapAssignmentRow, workDate: string) {
    const blockers: string[] = [];
    const authorization = await client.query(
      `
      SELECT psa.authorization_status
      FROM production_start_authorizations psa
      JOIN notice_to_proceed_versions n ON n.tenant_id = psa.tenant_id AND n.id = psa.notice_id
      WHERE psa.tenant_id = $1 AND n.work_order_version_id = $2 AND n.crew_assignment_id = $3
        AND psa.current = true AND psa.authorization_status = 'authorized'
      LIMIT 1
      `,
      [assignment.tenant_id, assignment.work_order_version_id, assignment.crew_assignment_id],
    );
    if (!authorization.rows[0]) blockers.push("production_start_not_authorized");
    const jsa = await this.findJsa(client, assignment, workDate);
    if (!jsa || jsa.status !== "completed") blockers.push("daily_jsa_incomplete");
    if (assignment.version_status !== "ready" || assignment.processing_status !== "ready") blockers.push("map_version_not_ready");
    return { allowed: blockers.length === 0, blockers, daily_jsa_id: jsa?.id ?? null };
  }

  private async assertProductionGate(client: PoolClient, assignment: MapAssignmentRow, workDate: string) {
    const gate = await this.productionGate(client, assignment, workDate);
    if (!gate.allowed) throw new BadRequestException(gate.blockers.join(","));
    return gate;
  }

  private async ensureDefaultProductionCodes(client: PoolClient, assignment: MapAssignmentRow) {
    for (const [code, description, unit, locationType, requiresAsset, requiresRoute] of defaultProductionCodes) {
      const inserted = await client.query(
        `
        INSERT INTO syncfield_production_codes (tenant_id, code, description, category, unit_of_measure, location_type, requires_asset, requires_route)
        VALUES ($1,$2,$3,'field',$4,$5,$6,$7)
        ON CONFLICT (tenant_id, upper(code)) WHERE deleted_at IS NULL DO UPDATE
          SET description = EXCLUDED.description, unit_of_measure = EXCLUDED.unit_of_measure, location_type = EXCLUDED.location_type, active = true, updated_at = now()
        RETURNING id
        `,
        [assignment.tenant_id, code, description, unit, locationType, requiresAsset, requiresRoute],
      );
      await client.query(
        `
        INSERT INTO syncfield_work_order_production_codes (tenant_id, work_order_version_id, production_code_id, status)
        VALUES ($1,$2,$3,'active')
        ON CONFLICT (tenant_id, work_order_version_id, production_code_id) WHERE deleted_at IS NULL AND status = 'active' DO NOTHING
        `,
        [assignment.tenant_id, assignment.work_order_version_id, inserted.rows[0].id],
      );
    }
  }

  private async findDailyReport(client: PoolClient, assignment: MapAssignmentRow, workDate: string): Promise<DailyProductionReportRow | null> {
    const result = await client.query(
      "SELECT * FROM daily_production_reports WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_id = $3 AND work_date = $4 AND current = true AND deleted_at IS NULL AND status <> 'void' LIMIT 1",
      [assignment.tenant_id, assignment.work_order_version_id, assignment.crew_id, workDate],
    );
    return result.rows[0] as DailyProductionReportRow | undefined ?? null;
  }

  private async createReportInline(client: PoolClient, request: AuthenticatedRequest, assignment: MapAssignmentRow, workDate: string, body: Record<string, unknown>): Promise<DailyProductionReportRow> {
    const gate = await this.assertProductionGate(client, assignment, workDate);
    const inserted = await client.query(
      `
      INSERT INTO daily_production_reports (
        tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_id,
        foreman_worker_id, foreman_user_id, work_date, map_document_id, map_version_id, daily_jsa_id, status,
        weather, general_notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15)
      ON CONFLICT (tenant_id, work_order_version_id, crew_id, work_date) WHERE current = true AND deleted_at IS NULL AND status <> 'void' DO UPDATE SET updated_at = daily_production_reports.updated_at
      RETURNING *
      `,
      [assignment.tenant_id, assignment.project_id, assignment.work_order_id, assignment.work_order_version_id, assignment.organization_id, assignment.capacity_provider_id, assignment.crew_id, assignment.foreman_worker_id, request.auth.userId, workDate, assignment.map_document_id, assignment.map_version_id, gate.daily_jsa_id, this.optionalString(body.weather), this.optionalString(body.general_notes)],
    );
    return inserted.rows[0] as DailyProductionReportRow;
  }

  private async requireDailyReportById(client: PoolClient, tenantId: string, reportId: string): Promise<DailyProductionReportRow> {
    const result = await client.query("SELECT * FROM daily_production_reports WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, reportId]);
    if (!result.rows[0]) throw new NotFoundException("daily production report not found");
    return result.rows[0] as DailyProductionReportRow;
  }

  private async requireAuthorizedProductionCode(client: PoolClient, assignment: MapAssignmentRow, codeId: string) {
    await this.ensureDefaultProductionCodes(client, assignment);
    const result = await client.query(
      `
      SELECT pc.*
      FROM syncfield_work_order_production_codes wopc
      JOIN syncfield_production_codes pc ON pc.tenant_id = wopc.tenant_id AND pc.id = wopc.production_code_id
      WHERE wopc.tenant_id = $1 AND wopc.work_order_version_id = $2 AND pc.id = $3
        AND wopc.status = 'active' AND pc.active = true AND wopc.deleted_at IS NULL AND pc.deleted_at IS NULL
      `,
      [assignment.tenant_id, assignment.work_order_version_id, codeId],
    );
    if (!result.rows[0]) throw new BadRequestException("production code is not authorized for Work Order");
    return result.rows[0];
  }

  private validateProductionLocation(body: Record<string, unknown>, code: QueryResultRow, locationType: string) {
    const mapPage = locationType === "daily" ? null : this.positiveInt(body.map_page, "map_page is required");
    if (locationType === "asset") {
      const assetType = requireString(body.asset_type, "asset_type is required").toLowerCase();
      if (!assetTypes.has(assetType)) throw new BadRequestException("asset_type is invalid");
      return { assetType, assetIdentifier: requireString(body.asset_identifier, "asset_identifier is required"), fromAssetIdentifier: null, toAssetIdentifier: null, mapPage, x: this.ratio(body.x_ratio, "x_ratio"), y: this.ratio(body.y_ratio, "y_ratio") };
    }
    if (locationType === "route") {
      return { assetType: null, assetIdentifier: null, fromAssetIdentifier: requireString(body.from_asset_identifier, "from_asset_identifier is required"), toAssetIdentifier: requireString(body.to_asset_identifier, "to_asset_identifier is required"), mapPage, startX: this.ratio(body.start_x_ratio, "start_x_ratio"), startY: this.ratio(body.start_y_ratio, "start_y_ratio"), endX: this.ratio(body.end_x_ratio, "end_x_ratio"), endY: this.ratio(body.end_y_ratio, "end_y_ratio") };
    }
    if (code.requires_asset || code.requires_route) throw new BadRequestException("map geometry is required for this production code");
    return { assetType: null, assetIdentifier: null, fromAssetIdentifier: null, toAssetIdentifier: null, mapPage: null };
  }

  private async insertAnnotation(client: PoolClient, request: AuthenticatedRequest, assignment: MapAssignmentRow, record: QueryResultRow, locationType: string, values: Record<string, unknown>, status: string) {
    if (locationType === "asset") {
      await client.query(
        "INSERT INTO map_annotations (tenant_id, production_record_id, map_version_id, page_number, annotation_type, x_ratio, y_ratio, label_x_ratio, label_y_ratio, display_status, created_by_user_id) VALUES ($1,$2,$3,$4,'asset_point',$5,$6,$5,$6,$7,$8)",
        [assignment.tenant_id, record.id, assignment.map_version_id, values.mapPage, values.x, values.y, status, request.auth.userId],
      );
      return;
    }
    await client.query(
      "INSERT INTO map_annotations (tenant_id, production_record_id, map_version_id, page_number, annotation_type, start_x_ratio, start_y_ratio, end_x_ratio, end_y_ratio, display_status, created_by_user_id) VALUES ($1,$2,$3,$4,'route_line',$5,$6,$7,$8,$9,$10)",
      [assignment.tenant_id, record.id, assignment.map_version_id, values.mapPage, values.startX, values.startY, values.endX, values.endY, status, request.auth.userId],
    );
  }

  private async duplicateWarning(client: PoolClient, assignment: MapAssignmentRow, report: DailyProductionReportRow, code: QueryResultRow, body: Record<string, unknown>) {
    const params = [assignment.tenant_id, assignment.work_order_version_id, code.id, report.id];
    let result;
    if (code.location_type === "asset") {
      result = await client.query("SELECT id, production_date, quantity_submitted, syncfield_status FROM production_records WHERE tenant_id = $1 AND work_order_version_id = $2 AND syncfield_production_code_id = $3 AND daily_production_report_id <> $4 AND status = 'submitted' AND upper(asset_identifier) = upper($5) LIMIT 5", [...params, requireString(body.asset_identifier, "asset_identifier is required")]);
    } else if (code.location_type === "route") {
      result = await client.query("SELECT id, production_date, quantity_submitted, syncfield_status FROM production_records WHERE tenant_id = $1 AND work_order_version_id = $2 AND syncfield_production_code_id = $3 AND daily_production_report_id <> $4 AND status = 'submitted' AND upper(from_asset_identifier) = upper($5) AND upper(to_asset_identifier) = upper($6) LIMIT 5", [...params, requireString(body.from_asset_identifier, "from_asset_identifier is required"), requireString(body.to_asset_identifier, "to_asset_identifier is required")]);
    } else {
      result = { rows: [] };
    }
    return { requires_reason: result.rows.length > 0, prior_records: result.rows.map((row) => ({ id: row.id, work_date: this.dateOnly(row.production_date), quantity: Number(row.quantity_submitted), status: row.syncfield_status })) };
  }

  private async reportRecords(client: PoolClient, tenantId: string, reportId: string) {
    const result = await client.query(
      `
      SELECT pr.*, pc.code, pc.description, pc.location_type, pc.unit_of_measure
      FROM production_records pr
      JOIN syncfield_production_codes pc ON pc.tenant_id = pr.tenant_id AND pc.id = pr.syncfield_production_code_id
      WHERE pr.tenant_id = $1 AND pr.daily_production_report_id = $2 AND pr.deleted_at IS NULL
      ORDER BY pr.created_at ASC
      `,
      [tenantId, reportId],
    );
    return result.rows;
  }

  private async safeDailyProductionDetail(client: PoolClient, row: QueryResultRow) {
    const records = await this.reportRecords(client, row.tenant_id, row.id);
    const annotations = await client.query("SELECT * FROM map_annotations WHERE tenant_id = $1 AND production_record_id = ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY created_at ASC", [row.tenant_id, records.map((record) => record.id)]);
    return { ...this.safeDailyProductionSummary(row), records: records.map((record) => this.safeProductionRecord(record)), annotations: annotations.rows.map((annotation) => this.safeAnnotation(annotation)), totals: this.productionTotals(records), annotation_count: annotations.rowCount ?? 0 };
  }

  private safeDailyProductionSummary(row: QueryResultRow) {
    return { id: row.id, work_date: this.dateOnly(row.work_date), work_order_version_id: row.work_order_version_id, work_order_number: row.work_order_number, crew_id: row.crew_id, crew_name: row.crew_name, map_version_id: row.map_version_id, daily_jsa_id: row.daily_jsa_id, status: row.status, submitted_at: row.submitted_at, revision_number: Number(row.revision_number ?? 1), general_notes: row.general_notes };
  }

  private safeProductionCode(row: QueryResultRow) {
    return { id: row.id, code: row.code, description: row.description, category: row.category, unit_of_measure: row.unit_of_measure, location_type: row.location_type, requires_asset: row.requires_asset, requires_route: row.requires_route, requires_photo: row.requires_photo, requires_notes: row.requires_notes, requires_quantity: row.requires_quantity, active: row.active };
  }

  private safeProductionRecord(row: QueryResultRow) {
    return { id: row.id, daily_report_id: row.daily_production_report_id, production_code_id: row.syncfield_production_code_id, code: row.code, description: row.description, reported_quantity: Number(row.quantity_submitted), unit_of_measure: row.unit_of_measure ?? row.unit, location_type: row.syncfield_location_type, status: row.syncfield_status, record_status: row.status, asset_type: row.asset_type, asset_identifier: row.asset_identifier, from_asset_identifier: row.from_asset_identifier, to_asset_identifier: row.to_asset_identifier, map_page: row.map_page === null ? null : Number(row.map_page), notes: row.production_notes, duplicate_reason: row.duplicate_reason, client_mutation_id: row.client_mutation_id, locked: Boolean(row.locked_at), reported_at: row.created_at };
  }

  private async safeProductionRecordDetail(client: PoolClient, row: QueryResultRow) {
    const code = await client.query("SELECT code, description, unit_of_measure FROM syncfield_production_codes WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.syncfield_production_code_id]);
    return this.safeProductionRecord({ ...row, ...code.rows[0] });
  }

  private safeAnnotation(row: QueryResultRow) {
    return { id: row.id, production_record_id: row.production_record_id, map_version_id: row.map_version_id, page_number: Number(row.page_number), annotation_type: row.annotation_type, x_ratio: row.x_ratio === null ? null : Number(row.x_ratio), y_ratio: row.y_ratio === null ? null : Number(row.y_ratio), start_x_ratio: row.start_x_ratio === null ? null : Number(row.start_x_ratio), start_y_ratio: row.start_y_ratio === null ? null : Number(row.start_y_ratio), end_x_ratio: row.end_x_ratio === null ? null : Number(row.end_x_ratio), end_y_ratio: row.end_y_ratio === null ? null : Number(row.end_y_ratio), display_status: row.display_status };
  }

  private productionTotals(records: QueryResultRow[]) {
    const totals = new Map<string, { code: string; description: string; quantity: number; unit: string; count: number }>();
    const status_counts: Record<string, number> = { complete: 0, partial: 0, blocked: 0, rework: 0 };
    for (const row of records) {
      const key = row.code;
      const current = totals.get(key) ?? { code: row.code, description: row.description, quantity: 0, unit: row.unit_of_measure ?? row.unit, count: 0 };
      current.quantity += Number(row.quantity_submitted);
      current.count += 1;
      totals.set(key, current);
      if (status_counts[row.syncfield_status] !== undefined) status_counts[row.syncfield_status] += 1;
    }
    return { by_code: [...totals.values()], record_count: records.length, status_counts };
  }

  private async buildReportSnapshot(client: PoolClient, report: QueryResultRow) {
    const records = await this.reportRecords(client, report.tenant_id, report.id);
    const annotations = await client.query("SELECT * FROM map_annotations WHERE tenant_id = $1 AND production_record_id = ANY($2::uuid[]) AND deleted_at IS NULL", [report.tenant_id, records.map((record) => record.id)]);
    return { report: this.safeDailyProductionSummary(report), records: records.map((record) => this.safeProductionRecord(record)), annotations: annotations.rows.map((annotation) => this.safeAnnotation(annotation)), totals: this.productionTotals(records) };
  }

  private async requireProductionRecord(client: PoolClient, tenantId: string, recordId: string) {
    const result = await client.query("SELECT * FROM production_records WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, recordId]);
    if (!result.rows[0]) throw new NotFoundException("production record not found");
    return result.rows[0];
  }

  private async requireScopedProductionRecord(client: PoolClient, assignment: MapAssignmentRow, recordId: string) {
    const result = await client.query("SELECT * FROM production_records WHERE tenant_id = $1 AND id = $2 AND work_order_version_id = $3 AND crew_id = $4 AND partner_organization_id = $5 AND deleted_at IS NULL", [assignment.tenant_id, recordId, assignment.work_order_version_id, assignment.crew_id, assignment.organization_id]);
    if (!result.rows[0]) throw new NotFoundException("production record not found");
    return result.rows[0];
  }

  private async findMutationReceipt(client: PoolClient, request: AuthenticatedRequest, mutationId: string, operation: string) {
    const result = await client.query("SELECT * FROM field_mutation_receipts WHERE tenant_id = $1 AND actor_user_id = $2 AND mutation_id = $3 AND operation = $4", [request.auth.tenantId, request.auth.userId, mutationId, operation]);
    return result.rows[0] ?? null;
  }

  private async recordMutationReceipt(client: PoolClient, request: AuthenticatedRequest, mutationId: string, operation: string, entityType: string, entityId: string, payload: unknown) {
    const payloadHash = createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
    await client.query(
      "INSERT INTO field_mutation_receipts (tenant_id, actor_user_id, mutation_id, operation, entity_type, entity_id, status, payload_hash) VALUES ($1,$2,$3,$4,$5,$6,'synced',$7) ON CONFLICT (tenant_id, actor_user_id, mutation_id, operation) DO NOTHING",
      [request.auth.tenantId, request.auth.userId, mutationId, operation, entityType, entityId, payloadHash],
    );
  }

  private async safeJsaDetail(client: PoolClient, row: QueryResultRow) {
    const participants = await client.query("SELECT p.*, w.first_name, w.last_name FROM daily_jsa_participants p JOIN workers w ON w.tenant_id = p.tenant_id AND w.id = p.worker_id WHERE p.tenant_id = $1 AND p.daily_jsa_id = $2 ORDER BY p.created_at ASC", [row.tenant_id, row.id]);
    return { ...this.safeJsa(row), participants: participants.rows.map((p) => ({ worker_id: p.worker_id, name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), role: p.crew_role, participation_status: p.participation_status, acknowledged: p.acknowledged })) };
  }

  private async requirePartnerAdmin(client: PoolClient, request: AuthenticatedRequest, requestedOrganizationId?: string): Promise<PartnerContext> {
    return this.partnerContext(client, request, "partner_admin", requestedOrganizationId);
  }

  private async requirePartnerForeman(client: PoolClient, request: AuthenticatedRequest): Promise<PartnerContext> {
    return this.partnerContext(client, request, "partner_foreman");
  }

  private async partnerContext(client: PoolClient, request: AuthenticatedRequest, roleKey: "partner_admin" | "partner_foreman", requestedOrganizationId?: string): Promise<PartnerContext> {
    const result = await client.query(
      `
      SELECT u.id AS user_id, u.display_name, tu.id AS tenant_user_id, o.id AS organization_id, o.name AS organization_name,
        cp.id AS capacity_provider_id, cp.name AS capacity_provider_name
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
    if (!selected) throw new ForbiddenException("Partner organization scope is required");
    return {
      tenant_id: request.auth.tenantId,
      persona: roleKey,
      user: { id: selected.user_id, tenant_user_id: selected.tenant_user_id, display_name: selected.display_name },
      organization: { id: selected.organization_id, name: selected.organization_name },
      capacityProvider: { id: selected.capacity_provider_id, name: selected.capacity_provider_name },
    };
  }

  private async requireForemanCrew(client: PoolClient, context: PartnerContext) {
    const result = await client.query(
      `
      SELECT c.*, w.id AS worker_id
      FROM partner_worker_user_links link
      JOIN workers w ON w.tenant_id = link.tenant_id AND w.id = link.worker_id AND w.status = 'active'
      JOIN partner_crew_memberships m ON m.tenant_id = link.tenant_id AND m.worker_id = w.id AND m.status = 'active' AND m.membership_role = 'foreman' AND m.deleted_at IS NULL
      JOIN crews c ON c.tenant_id = m.tenant_id AND c.id = m.crew_id AND c.lifecycle_status = 'active'
      WHERE link.tenant_id = $1 AND link.organization_id = $2 AND link.tenant_user_id = $3 AND link.status = 'active' AND link.deleted_at IS NULL
      LIMIT 1
      `,
      [context.tenant_id, context.organization.id, context.user.tenant_user_id],
    );
    if (!result.rows[0]) throw new ForbiddenException("Foreman Crew linkage is required");
    return result.rows[0];
  }

  private async safeAssignmentDetail(client: PoolClient, row: MapAssignmentRow) {
    const zones = await client.query(
      `
      SELECT *
      FROM syncfield_map_work_zones
      WHERE tenant_id = $1 AND map_version_id = $2 AND deleted_at IS NULL
      ORDER BY page_number ASC, name ASC
      `,
      [row.tenant_id, row.map_version_id],
    );
    return {
      id: row.assignment_id,
      status: row.assignment_status,
      project: { id: row.project_id, name: row.project_name },
      work_order: { id: row.work_order_version_id, work_order_number: row.work_order_number, scope_summary: row.scope_summary, primary_work_area: row.primary_work_area },
      crew: { id: row.crew_id, name: row.crew_name },
      map: {
        document_id: row.map_document_id,
        version_id: row.map_version_id,
        name: row.map_name,
        customer_document_number: row.customer_document_number,
        revision_number: Number(row.revision_number),
        revision_label: row.revision_label,
        page_count: Number(row.page_count),
        processing_status: row.processing_status,
        status: row.version_status,
        original_filename: row.original_filename,
        file_hash: row.file_hash,
      },
      work_zones: zones.rows.map((zone) => this.safeWorkZone(zone)),
    };
  }

  private safeAssignmentContext(row: MapAssignmentRow) {
    return { project: row.project_name, work_order: row.work_order_number, crew_id: row.crew_id, map_version_id: row.map_version_id, work_area: row.primary_work_area };
  }

  private safeMapDocument(row: QueryResultRow) {
    return { id: row.id, project_id: row.project_id, work_order_id: row.work_order_id, name: row.name, customer_document_number: row.customer_document_number, document_type: row.document_type, status: row.status };
  }

  private safeMapVersion(row: QueryResultRow) {
    return { id: row.id, map_document_id: row.map_document_id, revision_number: row.revision_number, revision_label: row.revision_label, received_date: this.dateOnly(row.received_date), original_filename: row.original_filename, file_hash: row.file_hash, page_count: Number(row.page_count), processing_status: row.processing_status, status: row.status };
  }

  private safeMapAssignment(row: QueryResultRow) {
    return { id: row.id, work_order_version_id: row.work_order_version_id, crew_id: row.crew_id, foreman_worker_id: row.foreman_worker_id, map_document_id: row.map_document_id, map_version_id: row.map_version_id, assignment_status: row.assignment_status, current: row.current };
  }

  private safeWorkZone(row: QueryResultRow) {
    return { id: row.id, map_version_id: row.map_version_id, name: row.name, page_number: Number(row.page_number), x_ratio: Number(row.x_ratio), y_ratio: Number(row.y_ratio), zoom_level: Number(row.zoom_level) };
  }

  private safeJsa(row: QueryResultRow) {
    return { id: row.id, work_date: this.dateOnly(row.work_date), work_order_version_id: row.work_order_version_id, crew_id: row.crew_id, crew_name: row.crew_name, foreman_worker_id: row.foreman_worker_id, foreman_name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(), work_order_number: row.work_order_number, map_version_id: row.map_version_id, status: row.status, meeting_started_at: row.meeting_started_at, meeting_completed_at: row.meeting_completed_at, work_location: row.work_location, weather: row.weather, site_conditions: row.site_conditions, hazards: row.hazards ?? [], controls: row.controls ?? [], foreman_certified: row.foreman_certified };
  }

  private async withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await operation(client);
    } finally {
      client.release();
    }
  }

  private async writeWithClient<T>(client: PoolClient, request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
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

  private sanitizeFileName(value: string): string {
    const base = path.basename(value).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120);
    if (!base || base === "." || base === "..") throw new BadRequestException("file_name is invalid");
    return base;
  }

  private storagePath(storageKey: string): string {
    const root = process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR ?? "/private/tmp/syncos-restricted-files";
    const resolvedRoot = path.resolve(root);
    const resolvedPath = path.resolve(resolvedRoot, ...storageKey.split("/"));
    if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) throw new BadRequestException("storage key is invalid");
    return resolvedPath;
  }

  private optionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private positiveInt(value: unknown, message: string): number {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new BadRequestException(message);
    return number;
  }

  private positiveNumber(value: unknown, message: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(message);
    return number;
  }

  private nonNegativeNumber(value: unknown, message: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException(message);
    return number;
  }

  private ratio(value: unknown, field: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) throw new BadRequestException(`${field} must be between 0 and 1`);
    return number;
  }

  private textArray(value: unknown, allowed: Set<string>, field: string): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException(`${field} must be an array`);
    const items = value.map((entry) => requireString(entry, `${field} values must be strings`));
    for (const item of items) if (!allowed.has(item)) throw new BadRequestException(`${field} contains unsupported value`);
    return Array.from(new Set(items));
  }

  private workDate(value?: string): string {
    const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
    return date;
  }

  private dateOnly(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }
}
