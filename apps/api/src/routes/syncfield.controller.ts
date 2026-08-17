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

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const mapDocumentTypes = new Set(["construction_map", "work_package", "permit_map", "other"]);
const hazardValues = new Set(["traffic", "energized_utilities", "overhead_utilities", "fall_exposure", "bucket_aerial_lift", "pole_hazards", "unsafe_pole", "guy_anchor", "trip_hazards", "public_exposure", "weather", "equipment_movement", "blocked_access", "animals", "other"]);
const controlValues = new Set(["ppe_reviewed", "traffic_control_reviewed", "fall_protection_reviewed", "equipment_inspection_complete", "emergency_procedures_reviewed", "rescue_procedures_reviewed", "communication_confirmed", "exclusion_zone_established", "stop_work_authority_reviewed", "utilities_reviewed", "aerial_hazards_reviewed", "incident_reporting_reviewed"]);
const storageRejectKeys = ["storage_key", "storage_path", "storage_url", "public_url", "raw_url", "object_key", "bucket", "url", "path"];

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
