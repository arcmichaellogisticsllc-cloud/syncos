import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { PermissionKey } from "@syncos/permissions";
import { appendAuditLog, executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { OrganizationScopeService } from "../security/organization-scope";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireAllowed, requireString } from "./intelligence.types";

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const partnerRoleKeys = new Set(["partner_admin", "partner_foreman"]);
const workerReviewStatuses = new Set(["draft", "submitted", "under_review", "approved", "conditional", "returned", "rejected", "suspended", "inactive"]);
const credentialTypes = new Set([
  "driver_license",
  "osha_10",
  "osha_30",
  "first_aid_cpr",
  "bucket_truck_aerial_lift",
  "fall_protection_harness",
  "pole_climbing",
  "bucket_rescue",
  "pole_top_rescue",
  "traffic_control",
  "background_check",
  "drug_screen",
  "customer_badge_or_clearance",
  "other",
]);
const credentialStatuses = new Set(["draft", "submitted", "under_review", "verified", "returned", "rejected", "expired"]);
const headshotReviewStatuses = new Set(["under_review", "approved", "returned", "rejected"]);
const credentialReviewStatuses = new Set(["under_review", "verified", "returned", "rejected", "expired"]);
const workerInternalReviewStatuses = new Set(["under_review", "approved", "conditional", "returned", "rejected", "suspended", "inactive"]);
const membershipRoles = new Set(["member", "foreman", "alternate_foreman"]);
const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const credentialMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

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
  verification_status: string;
  contract_status: string;
};

type PartnerContext = {
  user: { id: string; display_name: string; tenant_user_id: string };
  tenant_id: string;
  persona: "partner_admin" | "partner_foreman";
  organization: { id: string; name: string; status: string };
  capacityProvider: { id: string; name: string; provider_type: string; status: string; verification_status: string; contract_status: string };
};

type FileObjectRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  organization_id: string;
  capacity_provider_id: string;
  category: string;
  related_entity_type: string;
  related_entity_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  checksum: string;
  storage_provider: string;
  storage_key: string;
  uploaded_by_user_id: string;
  uploaded_at: Date;
};

@Controller("partner-workforce")
export class PartnerWorkforceController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  @Get("me/workers")
  @RequirePermission("partner_workforce.worker.read")
  async listWorkers(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const result = await client.query(
        `
        SELECT w.*, p.status AS profile_status, p.display_name, p.driver_operator_status
        FROM workers w
        LEFT JOIN partner_worker_profiles p
          ON p.tenant_id = w.tenant_id
         AND p.worker_id = w.id
         AND p.deleted_at IS NULL
         AND p.status <> 'superseded'
        WHERE w.tenant_id = $1
          AND w.organization_id = $2
          AND w.deleted_at IS NULL
        ORDER BY w.created_at ASC
        `,
        [context.tenant_id, context.organization.id],
      );
      return result.rows.map((row) => this.safeWorker(row, "partner_admin"));
    });
  }

  @Post("me/workers")
  @RequirePermission("partner_workforce.worker.create")
  async createWorker(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      this.rejectRestrictedWorkerBody(body);
      return this.writeWithClient(client, request, "worker.create", "worker.created", "worker", async (writeClient) => {
        const worker = await this.insertWorker(writeClient, context, request.auth.userId, body);
        return { entityType: "worker", entityId: worker.id, afterState: this.safeWorker(worker, "partner_admin") };
      });
    });
  }

  @Get("me/workers/:workerId")
  @RequirePermission("partner_workforce.worker.read")
  async getWorker(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      return this.safeWorker(await this.requireWorker(client, context, workerId), "partner_admin");
    });
  }

  @Patch("me/workers/:workerId")
  @RequirePermission("partner_workforce.worker.update")
  async updateWorker(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      this.rejectRestrictedWorkerBody(body);
      return this.writeWithClient(client, request, "worker.update", "worker.updated", "worker", async (writeClient) => {
        const before = await this.requireWorker(writeClient, context, workerId);
        if (["approved", "conditional"].includes(String(before.review_status))) {
          await writeClient.query("UPDATE partner_worker_profiles SET status = 'superseded', updated_at = now() WHERE tenant_id = $1 AND worker_id = $2 AND deleted_at IS NULL AND status <> 'superseded'", [context.tenant_id, workerId]);
        }
        const after = await this.updateWorkerProfile(writeClient, context, workerId, request.auth.userId, body);
        return { entityType: "worker", entityId: workerId, beforeState: this.safeWorker(before, "partner_admin"), afterState: this.safeWorker(after, "partner_admin") };
      });
    });
  }

  @Post("me/workers/:workerId/submit")
  @RequirePermission("partner_workforce.worker.submit")
  async submitWorker(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      return this.writeWithClient(client, request, "worker.submit", "worker.submitted", "worker", async (writeClient) => {
        const before = await this.requireWorker(writeClient, context, workerId);
        const result = await writeClient.query("UPDATE workers SET review_status = 'submitted', submitted_by_user_id = $3, submitted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *", [context.tenant_id, workerId, request.auth.userId]);
        await this.upsertWorkerProfile(writeClient, context, result.rows[0], request.auth.userId, { status: "submitted" });
        return { entityType: "worker", entityId: workerId, beforeState: this.safeWorker(before, "partner_admin"), afterState: this.safeWorker(result.rows[0], "partner_admin") };
      });
    });
  }

  @Get("me/workers/:workerId/readiness")
  @RequirePermission("partner_workforce.readiness.read")
  async workerReadiness(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      await this.requireWorker(client, context, workerId);
      return this.evaluateWorkerReadiness(client, context, workerId);
    });
  }

  @Post("me/workers/:workerId/headshots")
  @RequirePermission("partner_workforce.headshot.submit")
  async submitHeadshot(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      await this.requireWorker(client, context, workerId);
      if (body.attestation_accepted !== true) throw new BadRequestException("Partner workforce attestation is required");
      return this.writeWithClient(client, request, "worker_headshot.submit", "worker_headshot.submitted", "worker_headshot", async (writeClient) => {
        const upload = await this.createRestrictedFileObject(writeClient, context, request.auth.userId, "worker_headshot", "worker", workerId, body, "headshot");
        const before = await this.currentHeadshot(writeClient, context, workerId);
        if (before) await this.supersedeHeadshot(writeClient, context, before.id);
        const inserted = await writeClient.query(
          `
          INSERT INTO partner_worker_headshots (
            tenant_id, organization_id, capacity_provider_id, worker_id, file_object_id,
            status, version, attested_by_user_id, attested_at, supersedes_headshot_id
          )
          VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, now(), $8)
          RETURNING *
          `,
          [context.tenant_id, context.organization.id, context.capacityProvider.id, workerId, upload.file.id, Number(before?.version ?? 0) + 1, request.auth.userId, before?.id ?? null],
        );
        if (before) await writeClient.query("UPDATE partner_worker_headshots SET superseded_by_headshot_id = $4 WHERE tenant_id = $1 AND organization_id = $2 AND id = $3", [context.tenant_id, context.organization.id, before.id, inserted.rows[0].id]);
        await writeClient.query("UPDATE partner_restricted_file_objects SET related_entity_type = 'worker_headshot', related_entity_id = $3 WHERE tenant_id = $1 AND id = $2", [context.tenant_id, upload.file.id, inserted.rows[0].id]);
        await this.createAttestation(writeClient, context, request.auth.userId, workerId, null, "headshot");
        return {
          entityType: "worker_headshot",
          entityId: inserted.rows[0].id,
          beforeState: before ? this.safeHeadshot(before) : undefined,
          afterState: this.safeHeadshot(inserted.rows[0], upload.file),
          additionalEvents: [this.fileEvent(upload.file, request.auth.userId)],
        };
      });
    });
  }

  @Get("me/workers/:workerId/headshots/:headshotId/bytes")
  @RequirePermission("partner_workforce.headshot.read")
  async readOwnHeadshot(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Param("headshotId") headshotId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      await this.requireWorker(client, context, workerId);
      const file = await this.requireHeadshotFile(client, context, headshotId, { workerId });
      return this.readAuthorizedFile(client, request, file);
    });
  }

  @Get("me/workers/:workerId/credentials")
  @RequirePermission("partner_workforce.credential.read")
  async listCredentials(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      await this.requireWorker(client, context, workerId);
      const result = await client.query(
        "SELECT * FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded' ORDER BY credential_type",
        [context.tenant_id, context.organization.id, workerId],
      );
      return result.rows.map((row) => this.safeCredential(row));
    });
  }

  @Post("me/workers/:workerId/credentials")
  @RequirePermission("partner_workforce.credential.submit")
  async submitCredential(@Req() request: AuthenticatedRequest, @Param("workerId") workerId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      await this.requireWorker(client, context, workerId);
      this.rejectCredentialSensitiveBody(body);
      const credentialType = requireAllowed(body.credential_type, credentialTypes, "credential_type");
      return this.writeWithClient(client, request, "worker_credential.submit", "worker_credential.submitted", "worker_credential", async (writeClient) => {
        const before = await this.currentCredential(writeClient, context, workerId, credentialType);
        if (before) await this.supersedeCredential(writeClient, context, before.id);
        const file = body.evidence ? await this.createRestrictedFileObject(writeClient, context, request.auth.userId, "worker_credential_evidence", "worker", workerId, body.evidence, "credential") : null;
        const inserted = await writeClient.query(
          `
          INSERT INTO partner_worker_credentials (
            tenant_id, organization_id, capacity_provider_id, worker_id, credential_type, credential_level,
            issuer, credential_identifier_last_four, issued_date, expiration_date, required, status,
            version, evidence_file_object_id, submitted_by_user_id, supersedes_credential_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'submitted', $12, $13, $14, $15)
          RETURNING *
          `,
          [
            context.tenant_id,
            context.organization.id,
            context.capacityProvider.id,
            workerId,
            credentialType,
            this.optionalString(body.credential_level),
            this.optionalString(body.issuer),
            body.credential_identifier_last_four === undefined ? null : this.lastFourAlpha(body.credential_identifier_last_four),
            this.optionalDate(body.issued_date),
            this.optionalDate(body.expiration_date),
            Boolean(body.required),
            Number(before?.version ?? 0) + 1,
            file?.file.id ?? null,
            request.auth.userId,
            before?.id ?? null,
          ],
        );
        if (before) await writeClient.query("UPDATE partner_worker_credentials SET superseded_by_credential_id = $4 WHERE tenant_id = $1 AND organization_id = $2 AND id = $3", [context.tenant_id, context.organization.id, before.id, inserted.rows[0].id]);
        if (file) await writeClient.query("UPDATE partner_restricted_file_objects SET related_entity_type = 'worker_credential', related_entity_id = $3 WHERE tenant_id = $1 AND id = $2", [context.tenant_id, file.file.id, inserted.rows[0].id]);
        return {
          entityType: "worker_credential",
          entityId: inserted.rows[0].id,
          beforeState: before ? this.safeCredential(before) : undefined,
          afterState: this.safeCredential(inserted.rows[0]),
          additionalEvents: file ? [this.fileEvent(file.file, request.auth.userId)] : [],
        };
      });
    });
  }

  @Get("me/crews")
  @RequirePermission("partner_workforce.crew.read")
  async listCrews(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const result = await client.query("SELECT * FROM crews WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC", [context.tenant_id, context.organization.id]);
      return result.rows.map((row) => this.safeCrew(row));
    });
  }

  @Post("me/crews")
  @RequirePermission("partner_workforce.crew.create")
  async createCrew(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      return this.writeWithClient(client, request, "crew.create", "crew.created", "crew", async (writeClient) => {
        const result = await writeClient.query(
          `
          INSERT INTO crews (tenant_id, capacity_provider_id, organization_id, name, crew_type, status, lifecycle_status, target_staffing_level)
          VALUES ($1, $2, $3, $4, $5, 'active', 'active', $6)
          RETURNING *
          `,
          [context.tenant_id, context.capacityProvider.id, context.organization.id, requireString(body.name, "name is required"), this.optionalString(body.crew_type) ?? "aerial", this.positiveInteger(body.target_staffing_level, 4)],
        );
        return { entityType: "crew", entityId: result.rows[0].id, afterState: this.safeCrew(result.rows[0]) };
      });
    });
  }

  @Get("me/crews/:crewId")
  @RequirePermission("partner_workforce.crew.read")
  async getCrew(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      return this.safeCrew(await this.requireCrew(client, context, crewId));
    });
  }

  @Patch("me/crews/:crewId")
  @RequirePermission("partner_workforce.crew.update")
  async updateCrew(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      return this.writeWithClient(client, request, "crew.update", "crew.updated", "crew", async (writeClient) => {
        const before = await this.requireCrew(writeClient, context, crewId);
        const result = await writeClient.query(
          "UPDATE crews SET name = COALESCE($3, name), crew_type = COALESCE($4, crew_type), target_staffing_level = COALESCE($5, target_staffing_level), updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *",
          [context.tenant_id, crewId, this.optionalString(body.name), this.optionalString(body.crew_type), body.target_staffing_level === undefined ? null : this.positiveInteger(body.target_staffing_level, 4)],
        );
        return { entityType: "crew", entityId: crewId, beforeState: this.safeCrew(before), afterState: this.safeCrew(result.rows[0]) };
      });
    });
  }

  @Post("me/crews/:crewId/members")
  @RequirePermission("partner_workforce.membership.manage")
  async addCrewMember(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      const workerId = requireString(body.worker_id, "worker_id is required");
      const role = body.membership_role === undefined ? "member" : requireAllowed(body.membership_role, membershipRoles, "membership_role");
      return this.writeWithClient(client, request, "crew_membership.add", "crew_membership.added", "crew_membership", async (writeClient) => {
        await this.requireCrew(writeClient, context, crewId);
        await this.requireWorker(writeClient, context, workerId);
        const existing = await this.currentMembership(writeClient, context, crewId, workerId);
        if (existing) return { entityType: "crew_membership", entityId: existing.id, afterState: this.safeMembership(existing) };
        const result = await writeClient.query(
          `
          INSERT INTO partner_crew_memberships (tenant_id, organization_id, capacity_provider_id, crew_id, worker_id, membership_role, assigned_by_user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
          `,
          [context.tenant_id, context.organization.id, context.capacityProvider.id, crewId, workerId, role, request.auth.userId],
        );
        return { entityType: "crew_membership", entityId: result.rows[0].id, afterState: this.safeMembership(result.rows[0]) };
      });
    });
  }

  @Post("me/crews/:crewId/members/:membershipId/end")
  @RequirePermission("partner_workforce.membership.manage")
  async endCrewMember(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Param("membershipId") membershipId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      return this.writeWithClient(client, request, "crew_membership.end", "crew_membership.ended", "crew_membership", async (writeClient) => {
        await this.requireCrew(writeClient, context, crewId);
        const before = await this.requireMembership(writeClient, context, crewId, membershipId);
        const result = await writeClient.query(
          "UPDATE partner_crew_memberships SET status = 'ended', effective_end_date = CURRENT_DATE, ended_by_user_id = $4, ended_reason = $5, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 RETURNING *",
          [context.tenant_id, context.organization.id, membershipId, request.auth.userId, this.optionalString(body.ended_reason)],
        );
        return { entityType: "crew_membership", entityId: membershipId, beforeState: this.safeMembership(before), afterState: this.safeMembership(result.rows[0]) };
      });
    });
  }

  @Post("me/crews/:crewId/foreman")
  @RequirePermission("partner_workforce.foreman.assign")
  async assignForeman(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.assignCrewRole(request, query, crewId, requireString(body.worker_id, "worker_id is required"), "foreman");
  }

  @Post("me/crews/:crewId/alternate-foreman")
  @RequirePermission("partner_workforce.foreman.assign")
  async assignAlternateForeman(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.assignCrewRole(request, query, crewId, requireString(body.worker_id, "worker_id is required"), "alternate_foreman");
  }

  @Get("me/crews/:crewId/roster")
  @RequirePermission("partner_workforce.crew.read")
  async crewRoster(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      await this.requireCrew(client, context, crewId);
      return this.roster(client, context, crewId, "partner_admin");
    });
  }

  @Get("me/crews/:crewId/readiness")
  @RequirePermission("partner_workforce.readiness.read")
  async crewReadiness(@Req() request: AuthenticatedRequest, @Param("crewId") crewId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      await this.requireCrew(client, context, crewId);
      return this.evaluateCrewReadiness(client, context, crewId);
    });
  }

  @Get("foreman/crew")
  @RequirePermission("partner_workforce.foreman_roster.read")
  async foremanCrew(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request, query.organization_id);
      const crew = await this.requireForemanCrew(client, context);
      return this.safeCrew(crew);
    });
  }

  @Get("foreman/crew/roster")
  @RequirePermission("partner_workforce.foreman_roster.read")
  async foremanRoster(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request, query.organization_id);
      const crew = await this.requireForemanCrew(client, context);
      return this.roster(client, context, crew.id, "partner_foreman");
    });
  }

  @Get("foreman/headshots/:headshotId/bytes")
  @RequirePermission("partner_workforce.foreman_roster.read")
  async foremanHeadshot(@Req() request: AuthenticatedRequest, @Param("headshotId") headshotId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerForeman(client, request, query.organization_id);
      const crew = await this.requireForemanCrew(client, context);
      const file = await this.requireHeadshotFile(client, context, headshotId, { crewId: crew.id, approvedOnly: true });
      return this.readAuthorizedFile(client, request, file);
    });
  }

  @Post("organizations/:organizationId/workers/:workerId/review")
  @RequirePermission("partner_workforce.review")
  async reviewWorker(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("workerId") workerId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const partner = await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_workforce.review");
      const status = requireAllowed(body.status, workerInternalReviewStatuses, "status");
      const suspensionReason = this.optionalString(body.suspended_reason) ?? this.optionalString(body.external_return_reason);
      return this.writeWithClient(client, request, "worker.review", this.reviewEvent("worker", status), "worker", async (writeClient) => {
        const before = await this.requireWorkerByOrg(writeClient, request.auth.tenantId, organizationId, workerId);
        const result = await writeClient.query(
          `
          UPDATE workers
          SET review_status = $4,
              status = CASE WHEN $4 IN ('suspended', 'inactive') THEN $4 WHEN $4 IN ('approved', 'conditional') THEN 'active' ELSE status END,
              suspended_reason = CASE WHEN $4 = 'suspended' THEN $8 WHEN $4 IN ('approved', 'conditional') THEN NULL ELSE suspended_reason END,
              inactive_at = CASE WHEN $4 IN ('suspended', 'inactive') THEN now() WHEN $4 IN ('approved', 'conditional') THEN NULL ELSE inactive_at END,
              reviewed_by_user_id = $5, reviewed_at = now(), external_return_reason = $6,
              internal_review_notes = $7, updated_at = now()
          WHERE tenant_id = $1 AND organization_id = $2 AND id = $3
          RETURNING *
          `,
          [request.auth.tenantId, organizationId, workerId, status, request.auth.userId, this.optionalString(body.external_return_reason), this.optionalString(body.internal_review_notes), suspensionReason],
        );
        await writeClient.query("UPDATE partner_worker_profiles SET status = $4, reviewed_by_user_id = $5, reviewed_at = now(), external_return_reason = $6, internal_review_notes = $7, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded'", [request.auth.tenantId, organizationId, workerId, status, request.auth.userId, this.optionalString(body.external_return_reason), this.optionalString(body.internal_review_notes)]);
        return { entityType: "worker", entityId: workerId, beforeState: this.safeWorker(before, "internal"), afterState: this.safeWorker({ ...result.rows[0], capacity_provider_id: partner.capacity_provider_id }, "internal") };
      });
    });
  }

  @Post("organizations/:organizationId/workers/:workerId/headshots/:headshotId/review")
  @RequirePermission("partner_workforce.evidence.review")
  async reviewHeadshot(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("workerId") workerId: string, @Param("headshotId") headshotId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_workforce.evidence.review");
      const status = requireAllowed(body.status, headshotReviewStatuses, "status");
      return this.writeWithClient(client, request, "worker_headshot.review", this.reviewEvent("worker_headshot", status), "worker_headshot", async (writeClient) => {
        const before = await this.requireHeadshot(writeClient, request.auth.tenantId, organizationId, workerId, headshotId);
        const result = await writeClient.query(
          "UPDATE partner_worker_headshots SET status = $5, reviewed_by_user_id = $6, reviewed_at = now(), external_return_reason = $7, internal_review_notes = $8, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND id = $4 RETURNING *",
          [request.auth.tenantId, organizationId, workerId, headshotId, status, request.auth.userId, this.optionalString(body.external_return_reason), this.optionalString(body.internal_review_notes)],
        );
        return { entityType: "worker_headshot", entityId: headshotId, beforeState: this.safeHeadshot(before), afterState: this.safeHeadshot(result.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/workers/:workerId/credentials/:credentialId/review")
  @RequirePermission("partner_workforce.review")
  async reviewCredential(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("workerId") workerId: string, @Param("credentialId") credentialId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_workforce.review");
      const status = requireAllowed(body.status, credentialReviewStatuses, "status");
      return this.writeWithClient(client, request, "worker_credential.review", this.reviewEvent("worker_credential", status), "worker_credential", async (writeClient) => {
        const before = await this.requireCredential(writeClient, request.auth.tenantId, organizationId, workerId, credentialId);
        const result = await writeClient.query(
          "UPDATE partner_worker_credentials SET status = $5, verified_by_user_id = CASE WHEN $5 = 'verified' THEN $6 ELSE verified_by_user_id END, verified_at = CASE WHEN $5 = 'verified' THEN now() ELSE verified_at END, external_return_reason = $7, internal_review_notes = $8, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND id = $4 RETURNING *",
          [request.auth.tenantId, organizationId, workerId, credentialId, status, request.auth.userId, this.optionalString(body.external_return_reason), this.optionalString(body.internal_review_notes)],
        );
        return { entityType: "worker_credential", entityId: credentialId, beforeState: this.safeCredential(before), afterState: this.safeCredential(result.rows[0]) };
      });
    });
  }

  @Get("organizations/:organizationId/file-objects/:fileObjectId/bytes")
  @RequirePermission("partner_workforce.evidence.review")
  async internalFileBytes(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("fileObjectId") fileObjectId: string) {
    return this.withClient(async (client) => {
      await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_workforce.evidence.review");
      const file = await this.requireFileObject(client, request.auth.tenantId, organizationId, fileObjectId);
      return this.readAuthorizedFile(client, request, file);
    });
  }

  private async assignCrewRole(request: AuthenticatedRequest, query: Record<string, string | undefined>, crewId: string, workerId: string, role: "foreman" | "alternate_foreman") {
    return this.withClient(async (client) => {
      const context = await this.requirePartnerAdmin(client, request, query.organization_id);
      return this.writeWithClient(client, request, `crew_${role}.assign`, `crew_${role}.assigned`, "crew_membership", async (writeClient) => {
        await this.requireCrew(writeClient, context, crewId);
        const worker = await this.requireWorker(writeClient, context, workerId);
        if (!["approved", "conditional"].includes(String(worker.review_status))) throw new BadRequestException("Foreman Worker must be approved before designation");
        const member = await this.currentMembership(writeClient, context, crewId, workerId);
        if (!member) throw new BadRequestException("Foreman must be an active Crew member");
        await writeClient.query("UPDATE partner_crew_memberships SET membership_role = 'member', updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND crew_id = $3 AND membership_role = $4 AND status = 'active'", [context.tenant_id, context.organization.id, crewId, role]);
        const result = await writeClient.query("UPDATE partner_crew_memberships SET membership_role = $5, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND crew_id = $3 AND worker_id = $4 AND status = 'active' RETURNING *", [context.tenant_id, context.organization.id, crewId, workerId, role]);
        return { entityType: "crew_membership", entityId: result.rows[0].id, beforeState: this.safeMembership(member), afterState: this.safeMembership(result.rows[0]) };
      });
    });
  }

  private async insertWorker(client: PoolClient, context: PartnerContext, userId: string, body: Record<string, unknown>) {
    const firstName = requireString(body.first_name, "first_name is required");
    const lastName = requireString(body.last_name, "last_name is required");
    const result = await client.query(
      `
      INSERT INTO workers (
        tenant_id, capacity_provider_id, organization_id, first_name, last_name, status, worker_role,
        partner_worker_reference, review_status, submitted_by_user_id, submitted_at, last_material_change_at
      )
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, 'draft', $8, now(), now())
      RETURNING *
      `,
      [context.tenant_id, context.capacityProvider.id, context.organization.id, firstName, lastName, this.optionalString(body.worker_role), this.optionalString(body.partner_worker_reference), userId],
    );
    await this.upsertWorkerProfile(client, context, result.rows[0], userId, { status: "draft" });
    await this.createAttestation(client, context, userId, result.rows[0].id, null, "worker");
    return result.rows[0];
  }

  private async updateWorkerProfile(client: PoolClient, context: PartnerContext, workerId: string, userId: string, body: Record<string, unknown>) {
    const result = await client.query(
      `
      UPDATE workers
      SET first_name = COALESCE($3, first_name),
          last_name = COALESCE($4, last_name),
          worker_role = COALESCE($5, worker_role),
          partner_worker_reference = COALESCE($6, partner_worker_reference),
          review_status = 'submitted',
          submitted_by_user_id = $7,
          submitted_at = now(),
          reviewed_by_user_id = NULL,
          reviewed_at = NULL,
          external_return_reason = NULL,
          internal_review_notes = NULL,
          last_material_change_at = now(),
          updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND organization_id = $8
      RETURNING *
      `,
      [
        context.tenant_id,
        workerId,
        this.optionalString(body.first_name),
        this.optionalString(body.last_name),
        this.optionalString(body.worker_role),
        this.optionalString(body.partner_worker_reference),
        userId,
        context.organization.id,
      ],
    );
    if (!result.rows[0]) throw new NotFoundException("Worker not found");
    await this.upsertWorkerProfile(client, context, result.rows[0], userId, { status: "submitted", ...body });
    return result.rows[0];
  }

  private async upsertWorkerProfile(client: PoolClient, context: PartnerContext, worker: QueryResultRow, userId: string, body: Record<string, unknown>) {
    const existing = await client.query("SELECT * FROM partner_worker_profiles WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded' LIMIT 1", [context.tenant_id, context.organization.id, worker.id]);
    const values = {
      display_name: this.optionalString(body.display_name) ?? `${worker.first_name} ${worker.last_name}`,
      home_address: this.optionalObject(body.home_address),
      mobile_phone: this.optionalString(body.mobile_phone),
      emergency_contact_name: this.optionalString(body.emergency_contact_name),
      emergency_contact_phone: this.optionalString(body.emergency_contact_phone),
      driver_operator_status: body.driver_operator_status === undefined ? "not_driver" : requireAllowed(body.driver_operator_status, new Set(["not_driver", "driver", "operator", "driver_operator"]), "driver_operator_status"),
      driver_license_state: this.optionalString(body.driver_license_state),
      driver_license_class: this.optionalString(body.driver_license_class),
      driver_license_last_four: body.driver_license_last_four === undefined ? null : this.lastFourAlpha(body.driver_license_last_four),
      driver_license_expiration_date: this.optionalDate(body.driver_license_expiration_date),
      driver_license_verification_status: body.driver_license_verification_status === undefined ? "not_required" : requireAllowed(body.driver_license_verification_status, new Set(["not_required", "submitted", "under_review", "returned", "rejected"]), "driver_license_verification_status"),
      aerial_experience_years: body.aerial_experience_years === undefined ? null : this.nonNegativeNumber(body.aerial_experience_years),
      status: requireAllowed(body.status ?? "submitted", workerReviewStatuses, "status"),
      submitted_by_user_id: userId,
      submitted_at: new Date(),
      reviewed_by_user_id: null,
      reviewed_at: null,
      external_return_reason: null,
      internal_review_notes: null,
      updated_at: new Date(),
    };
    if (values.status === "approved") throw new ForbiddenException("Partner users cannot approve Worker profile");
    if (existing.rows[0]) {
      await client.query(
        `
        UPDATE partner_worker_profiles
        SET ${Object.keys(values).map((key, index) => `${key} = $${index + 4}`).join(", ")}
        WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded'
        `,
        [context.tenant_id, context.organization.id, worker.id, ...Object.values(values)],
      );
      return;
    }
    const columns = ["tenant_id", "organization_id", "capacity_provider_id", "worker_id", ...Object.keys(values)];
    await client.query(
      `INSERT INTO partner_worker_profiles (${columns.join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
      [context.tenant_id, context.organization.id, context.capacityProvider.id, worker.id, ...Object.values(values)],
    );
  }

  private async createRestrictedFileObject(client: PoolClient, context: PartnerContext, userId: string, category: string, relatedType: string, relatedId: string, raw: unknown, mode: "headshot" | "credential") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("file payload is required");
    const body = raw as Record<string, unknown>;
    this.rejectFileStorageInput(body);
    const fileName = this.sanitizeFileName(requireString(body.file_name, "file_name is required"));
    const requestedMime = requireString(body.mime_type ?? body.content_type, "mime_type is required");
    const contentBase64 = requireString(body.content_base64, "content_base64 is required");
    const buffer = Buffer.from(contentBase64, "base64");
    const maxSize = mode === "headshot" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (buffer.length <= 0 || buffer.length > maxSize) throw new BadRequestException("file size is outside permitted limits");
    const detectedMime = this.detectMime(buffer);
    const allowed = mode === "headshot" ? imageMimeTypes : credentialMimeTypes;
    if (!allowed.has(detectedMime) || detectedMime !== requestedMime) throw new BadRequestException("file content type is not supported");
    if (detectedMime === "image/svg+xml") throw new BadRequestException("SVG files are not permitted");
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const extension = this.extensionForMime(detectedMime);
    const storageKey = `${context.tenant_id}/${context.organization.id}/${randomUUID()}${extension}`;
    const fullPath = this.storagePath(storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer, { flag: "wx" });
    try {
      const result = await client.query<FileObjectRow>(
        `
        INSERT INTO partner_restricted_file_objects (
          tenant_id, organization_id, capacity_provider_id, category, related_entity_type, related_entity_id,
          file_name, mime_type, size_bytes, checksum, storage_key, uploaded_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        `,
        [context.tenant_id, context.organization.id, context.capacityProvider.id, category, relatedType, relatedId, fileName, detectedMime, buffer.length, checksum, storageKey, userId],
      );
      return { file: result.rows[0], storageKey };
    } catch (error) {
      await unlink(fullPath).catch(() => undefined);
      throw error;
    }
  }

  private async readAuthorizedFile(client: PoolClient, request: AuthenticatedRequest, file: FileObjectRow) {
    const content = await readFile(this.storagePath(file.storage_key));
    await appendAuditLog(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action: "restricted_personnel_evidence.access",
      entityType: "partner_restricted_file_object",
      entityId: file.id,
      afterState: { file_object_id: file.id, organization_id: file.organization_id, category: file.category, mime_type: file.mime_type, size_bytes: file.size_bytes },
      requestId: request.header("x-request-id") ?? request.header("x-correlation-id"),
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    });
    return { file_name: file.file_name, mime_type: file.mime_type, size_bytes: Number(file.size_bytes), checksum: file.checksum, content_base64: content.toString("base64") };
  }

  private async resolvePartnerContext(client: PoolClient, request: AuthenticatedRequest, queryOrganizationId?: string): Promise<PartnerContext> {
    const requestedScope = this.requestedOrganizationScope(request, queryOrganizationId);
    const rows = await this.partnerScopeRows(client, request.auth.tenantId, request.auth.userId, requestedScope);
    if (!rows.length) {
      if (requestedScope) throw new ForbiddenException("Partner organization scope is not assigned");
      throw new ForbiddenException("Partner role with active organization scope is required");
    }
    const organizationIds = Array.from(new Set(rows.map((row) => row.organization_id)));
    if (!requestedScope && organizationIds.length > 1) throw new ConflictException("Multiple Partner organization scopes require explicit organization selection");
    const selectedOrganizationId = requestedScope ?? organizationIds[0];
    const selectedRows = rows.filter((row) => row.organization_id === selectedOrganizationId);
    if (!selectedRows.length) throw new ForbiddenException("Partner organization scope is not assigned");
    const first = selectedRows[0];
    return {
      user: { id: first.user_id, display_name: first.display_name, tenant_user_id: first.tenant_user_id },
      tenant_id: request.auth.tenantId,
      persona: selectedRows.some((row) => row.role_key === "partner_admin") ? "partner_admin" : "partner_foreman",
      organization: { id: first.organization_id, name: first.organization_name, status: first.organization_status },
      capacityProvider: {
        id: first.capacity_provider_id,
        name: first.capacity_provider_name,
        provider_type: first.provider_type,
        status: first.provider_status,
        verification_status: first.verification_status,
        contract_status: first.contract_status,
      },
    };
  }

  private async partnerScopeRows(client: PoolClient, tenantId: string, userId: string, organizationId?: string) {
    const values: unknown[] = [tenantId, userId, Array.from(partnerRoleKeys), Array.from(partnerProviderTypes)];
    if (organizationId) values.push(organizationId);
    const result = await client.query<PartnerScopeRow>(
      `
      SELECT u.id AS user_id, u.display_name, tu.id AS tenant_user_id, r.system_key AS role_key,
             o.id AS organization_id, o.name AS organization_name, o.status AS organization_status,
             cp.id AS capacity_provider_id, cp.name AS capacity_provider_name, cp.provider_type,
             cp.status AS provider_status, cp.verification_status, cp.contract_status
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = $1 AND tu.status = 'active' AND tu.deleted_at IS NULL
      JOIN user_roles ur ON ur.tenant_user_id = tu.id AND ur.tenant_id = tu.tenant_id AND ur.scope_type = 'organization' AND ur.scope_id IS NOT NULL
      JOIN roles r ON r.id = ur.role_id AND r.tenant_id = tu.tenant_id AND r.system_key = ANY($3::text[]) AND r.deleted_at IS NULL
      JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = tu.tenant_id
      JOIN permissions p ON p.id = rp.permission_id AND p.key = 'partner_context.read'
      JOIN organizations o ON o.tenant_id = tu.tenant_id AND o.id = ur.scope_id AND o.deleted_at IS NULL
      JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.provider_type = ANY($4::text[]) AND cp.status <> 'archived' AND cp.deleted_at IS NULL
      WHERE u.id = $2 AND u.status = 'active' AND u.deleted_at IS NULL ${organizationId ? "AND o.id = $5" : ""}
      ORDER BY o.name ASC, r.system_key ASC, cp.created_at ASC
      `,
      values,
    );
    return result.rows;
  }

  private requestedOrganizationScope(request: AuthenticatedRequest, queryOrganizationId?: string): string | undefined {
    const headerScopeType = request.header("x-scope-type");
    const headerScopeId = request.header("x-scope-id");
    if (headerScopeType || headerScopeId) {
      if (headerScopeType !== "organization" || !headerScopeId) throw new ForbiddenException("Partner context requires organization scope");
      return headerScopeId;
    }
    return queryOrganizationId;
  }

  private async requirePartnerAdmin(client: PoolClient, request: AuthenticatedRequest, organizationId?: string) {
    const context = await this.resolvePartnerContext(client, request, organizationId);
    if (context.persona !== "partner_admin") throw new ForbiddenException("Partner Admin persona is required");
    return context;
  }

  private async requirePartnerForeman(client: PoolClient, request: AuthenticatedRequest, organizationId?: string) {
    const context = await this.resolvePartnerContext(client, request, organizationId);
    if (context.persona !== "partner_foreman") throw new ForbiddenException("Partner Foreman persona is required");
    return context;
  }

  private async requireInternalPartnerOrganization(client: PoolClient, request: AuthenticatedRequest, organizationId: string, permission: PermissionKey) {
    await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, permission);
    const result = await client.query(
      `
      SELECT o.id, cp.id AS capacity_provider_id
      FROM organizations o
      JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id
       AND cp.provider_type = ANY($3::text[]) AND cp.status <> 'archived' AND cp.deleted_at IS NULL
      WHERE o.tenant_id = $1 AND o.id = $2 AND o.deleted_at IS NULL
      LIMIT 1
      `,
      [request.auth.tenantId, organizationId, Array.from(partnerProviderTypes)],
    );
    if (!result.rows[0]) throw new NotFoundException("Partner Organization not found");
    return result.rows[0];
  }

  private async requireWorker(client: PoolClient, context: PartnerContext, workerId: string) {
    return this.requireWorkerByOrg(client, context.tenant_id, context.organization.id, workerId);
  }

  private async requireWorkerByOrg(client: PoolClient, tenantId: string, organizationId: string, workerId: string) {
    const result = await client.query("SELECT * FROM workers WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL LIMIT 1", [tenantId, organizationId, workerId]);
    if (!result.rows[0]) throw new NotFoundException("Worker not found");
    return result.rows[0];
  }

  private async requireCrew(client: PoolClient, context: PartnerContext, crewId: string) {
    const result = await client.query("SELECT * FROM crews WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL LIMIT 1", [context.tenant_id, context.organization.id, crewId]);
    if (!result.rows[0]) throw new NotFoundException("Crew not found");
    return result.rows[0];
  }

  private async requireMembership(client: PoolClient, context: PartnerContext, crewId: string, membershipId: string) {
    const result = await client.query("SELECT * FROM partner_crew_memberships WHERE tenant_id = $1 AND organization_id = $2 AND crew_id = $3 AND id = $4 AND deleted_at IS NULL LIMIT 1", [context.tenant_id, context.organization.id, crewId, membershipId]);
    if (!result.rows[0]) throw new NotFoundException("Crew membership not found");
    return result.rows[0];
  }

  private async currentMembership(client: PoolClient, context: PartnerContext, crewId: string, workerId: string) {
    const result = await client.query("SELECT * FROM partner_crew_memberships WHERE tenant_id = $1 AND organization_id = $2 AND crew_id = $3 AND worker_id = $4 AND status = 'active' AND deleted_at IS NULL LIMIT 1", [context.tenant_id, context.organization.id, crewId, workerId]);
    return result.rows[0] ?? null;
  }

  private async currentHeadshot(client: PoolClient, context: PartnerContext, workerId: string) {
    const result = await client.query("SELECT * FROM partner_worker_headshots WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded' LIMIT 1", [context.tenant_id, context.organization.id, workerId]);
    return result.rows[0] ?? null;
  }

  private async currentCredential(client: PoolClient, context: PartnerContext, workerId: string, credentialType: string) {
    const result = await client.query("SELECT * FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND credential_type = $4 AND deleted_at IS NULL AND status <> 'superseded' LIMIT 1", [context.tenant_id, context.organization.id, workerId, credentialType]);
    return result.rows[0] ?? null;
  }

  private async requireHeadshot(client: PoolClient, tenantId: string, organizationId: string, workerId: string, headshotId: string) {
    const result = await client.query("SELECT * FROM partner_worker_headshots WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND id = $4 AND deleted_at IS NULL LIMIT 1", [tenantId, organizationId, workerId, headshotId]);
    if (!result.rows[0]) throw new NotFoundException("Headshot not found");
    return result.rows[0];
  }

  private async requireCredential(client: PoolClient, tenantId: string, organizationId: string, workerId: string, credentialId: string) {
    const result = await client.query("SELECT * FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND id = $4 AND deleted_at IS NULL LIMIT 1", [tenantId, organizationId, workerId, credentialId]);
    if (!result.rows[0]) throw new NotFoundException("Credential not found");
    return result.rows[0];
  }

  private async requireHeadshotFile(client: PoolClient, context: PartnerContext, headshotId: string, options: { workerId?: string; crewId?: string; approvedOnly?: boolean }) {
    const crewJoin = options.crewId
      ? "JOIN partner_crew_memberships pcm ON pcm.tenant_id = h.tenant_id AND pcm.organization_id = h.organization_id AND pcm.worker_id = h.worker_id AND pcm.crew_id = $5 AND pcm.status = 'active' AND pcm.deleted_at IS NULL"
      : "";
    const workerPredicate = options.workerId ? "AND h.worker_id = $5" : "";
    const approvedPredicate = options.approvedOnly ? "AND h.status = 'approved'" : "";
    const values = options.crewId
      ? [context.tenant_id, context.organization.id, headshotId, "worker_headshot", options.crewId]
      : [context.tenant_id, context.organization.id, headshotId, "worker_headshot", options.workerId];
    const result = await client.query<FileObjectRow>(
      `
      SELECT f.*
      FROM partner_worker_headshots h
      JOIN partner_restricted_file_objects f ON f.tenant_id = h.tenant_id AND f.organization_id = h.organization_id AND f.id = h.file_object_id
      ${crewJoin}
      WHERE h.tenant_id = $1 AND h.organization_id = $2 AND h.id = $3 AND f.category = $4 AND h.deleted_at IS NULL
        ${workerPredicate} ${approvedPredicate}
      LIMIT 1
      `,
      values,
    );
    if (!result.rows[0]) throw new NotFoundException("Headshot file not found");
    return result.rows[0];
  }

  private async requireFileObject(client: PoolClient, tenantId: string, organizationId: string, fileObjectId: string) {
    const result = await client.query<FileObjectRow>("SELECT * FROM partner_restricted_file_objects WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL LIMIT 1", [tenantId, organizationId, fileObjectId]);
    if (!result.rows[0]) throw new NotFoundException("Restricted file not found");
    return result.rows[0];
  }

  private async requireForemanCrew(client: PoolClient, context: PartnerContext) {
    const result = await client.query(
      `
      SELECT c.*
      FROM partner_worker_user_links l
      JOIN partner_crew_memberships m ON m.tenant_id = l.tenant_id AND m.organization_id = l.organization_id AND m.worker_id = l.worker_id
       AND m.status = 'active' AND m.membership_role IN ('foreman', 'alternate_foreman') AND m.deleted_at IS NULL
      JOIN workers w ON w.tenant_id = l.tenant_id AND w.organization_id = l.organization_id AND w.id = l.worker_id AND w.status = 'active' AND w.deleted_at IS NULL
      JOIN crews c ON c.tenant_id = m.tenant_id AND c.organization_id = m.organization_id AND c.id = m.crew_id AND c.deleted_at IS NULL
      WHERE l.tenant_id = $1 AND l.organization_id = $2 AND l.tenant_user_id = $3 AND l.status = 'active' AND l.deleted_at IS NULL
      LIMIT 1
      `,
      [context.tenant_id, context.organization.id, context.user.tenant_user_id],
    );
    if (!result.rows[0]) throw new ForbiddenException("Active Foreman Worker/Crew link is required");
    return result.rows[0];
  }

  private async roster(client: PoolClient, context: PartnerContext, crewId: string, persona: "partner_admin" | "partner_foreman") {
    const result = await client.query(
      `
      SELECT w.*, m.id AS membership_id, m.membership_role, h.id AS current_headshot_id, h.status AS headshot_status
      FROM partner_crew_memberships m
      JOIN workers w ON w.tenant_id = m.tenant_id AND w.organization_id = m.organization_id AND w.id = m.worker_id AND w.deleted_at IS NULL
      LEFT JOIN partner_worker_headshots h ON h.tenant_id = w.tenant_id AND h.organization_id = w.organization_id AND h.worker_id = w.id AND h.deleted_at IS NULL AND h.status <> 'superseded'
      WHERE m.tenant_id = $1 AND m.organization_id = $2 AND m.crew_id = $3 AND m.status = 'active' AND m.deleted_at IS NULL
      ORDER BY m.membership_role DESC, w.last_name ASC, w.first_name ASC
      `,
      [context.tenant_id, context.organization.id, crewId],
    );
    return result.rows.map((row) => this.safeRosterWorker(row, persona));
  }

  private async evaluateWorkerReadiness(client: PoolClient, context: PartnerContext, workerId: string) {
    const worker = await this.requireWorker(client, context, workerId);
    const [profile, headshot, credentialsResult] = await Promise.all([
      client.query("SELECT * FROM partner_worker_profiles WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded' LIMIT 1", [context.tenant_id, context.organization.id, workerId]),
      client.query("SELECT * FROM partner_worker_headshots WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded' LIMIT 1", [context.tenant_id, context.organization.id, workerId]),
      client.query("SELECT * FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND deleted_at IS NULL AND status <> 'superseded'", [context.tenant_id, context.organization.id, workerId]),
    ]);
    const blockers: Array<{ key: string; category: string; message: string }> = [];
    if (worker.status === "inactive" || worker.review_status === "inactive") blockers.push(this.blocker("worker_inactive", "worker", "Worker is inactive"));
    if (worker.status === "suspended" || worker.review_status === "suspended") blockers.push(this.blocker("worker_suspended", "worker", "Worker is suspended"));
    if (!worker.first_name || !worker.last_name) blockers.push(this.blocker("worker_profile_incomplete", "worker", "Worker profile is incomplete"));
    if (!["approved", "conditional"].includes(String(worker.review_status))) blockers.push(this.blocker("worker_profile_unverified", "worker", "Worker profile is not approved"));
    const currentProfile = profile.rows[0];
    if (currentProfile?.driver_operator_status && currentProfile.driver_operator_status !== "not_driver") {
      const license = credentialsResult.rows.find((credential) => credential.credential_type === "driver_license");
      if (!license) blockers.push(this.blocker("worker_driver_license_missing", "credential", "Driver license credential is missing"));
      else if (license.status !== "verified") blockers.push(this.blocker("worker_driver_license_unverified", "credential", "Driver license is not verified"));
      else if (license.expiration_date && new Date(String(license.expiration_date)).getTime() < Date.now()) blockers.push(this.blocker("worker_driver_license_expired", "credential", "Driver license is expired"));
    }
    const currentHeadshot = headshot.rows[0];
    if (!currentHeadshot) blockers.push(this.blocker("worker_headshot_missing", "headshot", "Approved Worker headshot is missing"));
    else if (currentHeadshot.status === "returned" || currentHeadshot.status === "rejected") blockers.push(this.blocker("worker_headshot_correction_required", "headshot", "Worker headshot requires correction"));
    else if (currentHeadshot.status !== "approved") blockers.push(this.blocker("worker_headshot_unverified", "headshot", "Worker headshot is not approved"));
    for (const credential of credentialsResult.rows.filter((row) => row.required === true)) {
      if (credential.status !== "verified") blockers.push(this.blocker("worker_credential_unverified", "credential", `${credential.credential_type} is not verified`));
      if (credential.expiration_date && new Date(String(credential.expiration_date)).getTime() < Date.now()) blockers.push(this.blocker("worker_credential_expired", "credential", `${credential.credential_type} is expired`));
    }
    return { worker_id: workerId, status: blockers.length === 0 ? "ready" : "blocked", passed_checks: blockers.length === 0 ? ["worker_base_ready"] : [], blockers, warnings: [], evaluated_at: new Date().toISOString() };
  }

  private async evaluateCrewReadiness(client: PoolClient, context: PartnerContext, crewId: string) {
    const crew = await this.requireCrew(client, context, crewId);
    const members = await client.query("SELECT * FROM partner_crew_memberships WHERE tenant_id = $1 AND organization_id = $2 AND crew_id = $3 AND status = 'active' AND deleted_at IS NULL", [context.tenant_id, context.organization.id, crewId]);
    const blockers: Array<{ key: string; category: string; message: string }> = [];
    if (crew.lifecycle_status === "inactive") blockers.push(this.blocker("crew_inactive", "crew", "Crew is inactive"));
    if (crew.lifecycle_status === "suspended") blockers.push(this.blocker("crew_suspended", "crew", "Crew is suspended"));
    if (members.rows.length < Number(crew.target_staffing_level ?? 4)) blockers.push(this.blocker("crew_staffing_incomplete", "crew", "Crew does not meet target staffing"));
    const foremen = members.rows.filter((row) => row.membership_role === "foreman");
    if (foremen.length === 0) blockers.push(this.blocker("crew_foreman_missing", "crew", "Crew Foreman is missing"));
    if (foremen.length > 1) blockers.push(this.blocker("crew_foreman_unapproved", "crew", "Crew has multiple Foremen"));
    for (const member of members.rows) {
      const readiness = await this.evaluateWorkerReadiness(client, context, member.worker_id);
      if (readiness.status !== "ready") blockers.push(this.blocker("crew_member_not_ready", "worker", `Worker ${member.worker_id} is not ready`));
    }
    return { crew_id: crewId, status: blockers.length === 0 ? "ready" : members.rows.length ? "blocked" : "not_started", passed_checks: blockers.length === 0 ? ["crew_base_ready"] : [], blockers, warnings: [], evaluated_at: new Date().toISOString() };
  }

  private async supersedeHeadshot(client: PoolClient, context: PartnerContext, headshotId: string) {
    await client.query("UPDATE partner_worker_headshots SET status = 'superseded', updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND id = $3", [context.tenant_id, context.organization.id, headshotId]);
  }

  private async supersedeCredential(client: PoolClient, context: PartnerContext, credentialId: string) {
    await client.query("UPDATE partner_worker_credentials SET status = 'superseded', updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND id = $3", [context.tenant_id, context.organization.id, credentialId]);
  }

  private async createAttestation(client: PoolClient, context: PartnerContext, userId: string, workerId: string | null, crewId: string | null, scope: string) {
    await client.query(
      "INSERT INTO partner_workforce_attestations (tenant_id, organization_id, capacity_provider_id, worker_id, crew_id, attested_by_user_id, attestation_scope) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [context.tenant_id, context.organization.id, context.capacityProvider.id, workerId, crewId, userId, scope],
    );
  }

  private fileEvent(file: FileObjectRow, actorUserId: string) {
    return {
      action: "restricted_personnel_evidence.upload",
      aggregateType: "partner_restricted_file_object",
      entityType: "partner_restricted_file_object",
      entityId: file.id,
      eventType: "restricted_personnel_evidence.uploaded",
      afterState: { file_object_id: file.id, organization_id: file.organization_id, category: file.category, mime_type: file.mime_type, size_bytes: file.size_bytes, checksum: file.checksum, actor_user_id: actorUserId },
    };
  }

  private safeWorker(row: QueryResultRow, persona: "partner_admin" | "partner_foreman" | "internal") {
    const base = this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "first_name", "last_name", "worker_role", "partner_worker_reference", "status", "review_status", "external_return_reason", "created_at", "updated_at"]);
    if (persona === "internal") return { ...base, ...this.pick(row, ["submitted_at", "reviewed_at", "inactive_at"]) };
    return base;
  }

  private safeRosterWorker(row: QueryResultRow, persona: "partner_admin" | "partner_foreman") {
    const keys = persona === "partner_foreman"
      ? ["id", "first_name", "last_name", "worker_role", "membership_role", "current_headshot_id", "headshot_status", "status"]
      : ["id", "tenant_id", "organization_id", "capacity_provider_id", "first_name", "last_name", "worker_role", "membership_id", "membership_role", "current_headshot_id", "headshot_status", "status", "review_status"];
    return this.pick(row, keys);
  }

  private safeCrew(row: QueryResultRow) {
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "name", "crew_type", "status", "lifecycle_status", "target_staffing_level", "suspended_reason", "inactive_at", "created_at", "updated_at"]);
  }

  private safeMembership(row: QueryResultRow) {
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "crew_id", "worker_id", "membership_role", "primary_membership", "effective_start_date", "effective_end_date", "status", "created_at", "updated_at"]);
  }

  private safeHeadshot(row: QueryResultRow, file?: FileObjectRow) {
    return { ...this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "worker_id", "file_object_id", "status", "version", "attested_at", "reviewed_at", "external_return_reason", "supersedes_headshot_id", "superseded_by_headshot_id", "created_at", "updated_at"]), file: file ? this.safeFile(file) : undefined };
  }

  private safeCredential(row: QueryResultRow) {
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "worker_id", "credential_type", "credential_level", "issuer", "credential_identifier_last_four", "issued_date", "expiration_date", "required", "status", "version", "evidence_file_object_id", "submitted_at", "verified_at", "external_return_reason", "supersedes_credential_id", "superseded_by_credential_id", "created_at", "updated_at"]);
  }

  private safeFile(row: FileObjectRow) {
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "category", "related_entity_type", "related_entity_id", "file_name", "mime_type", "size_bytes", "checksum", "uploaded_by_user_id", "uploaded_at"]);
  }

  private pick(row: QueryResultRow, keys: string[]) {
    return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
  }

  private blocker(key: string, category: string, message: string) {
    return { key, category, message };
  }

  private reviewEvent(prefix: string, status: string) {
    if (status === "approved" || status === "verified") return `${prefix}.${status}`;
    if (status === "returned") return `${prefix}.returned`;
    if (status === "rejected") return `${prefix}.rejected`;
    if (status === "suspended") return `${prefix}.suspended`;
    return `${prefix}.reviewed`;
  }

  private rejectSpoofedOrganization(body: Record<string, unknown>, organizationId: string) {
    if (body.organization_id !== undefined && body.organization_id !== organizationId) throw new ForbiddenException("organization_id does not match authorized Partner scope");
    if (body.tenant_id !== undefined) throw new ForbiddenException("tenant_id is resolved from the authenticated request");
  }

  private rejectRestrictedWorkerBody(body: Record<string, unknown>) {
    const forbidden = ["driver_license_number", "full_driver_license_number", "ssn", "social_security_number", "background_report", "drug_screen_report"];
    for (const key of forbidden) if (body[key] !== undefined) throw new BadRequestException(`${key} must not be submitted to ordinary Worker APIs`);
    for (const value of Object.values(body)) this.rejectSensitiveString(value);
  }

  private rejectCredentialSensitiveBody(body: Record<string, unknown>) {
    this.rejectRestrictedWorkerBody(body);
    if (body.status === "verified") throw new ForbiddenException("Partner users cannot verify credentials");
    if (body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)) this.rejectFileStorageInput(body.evidence as Record<string, unknown>);
  }

  private rejectFileStorageInput(body: Record<string, unknown>) {
    for (const key of ["storage_key", "storage_path", "storage_url", "public_url", "raw_url", "object_key", "bucket", "url", "path"]) {
      if (body[key] !== undefined) throw new BadRequestException("storage references are server-generated");
    }
    for (const value of Object.values(body)) this.rejectSensitiveString(value);
  }

  private rejectSensitiveString(value: unknown) {
    if (typeof value !== "string") return;
    if (/\b\d{9,}\b/.test(value)) throw new BadRequestException("restricted metadata cannot contain full personnel identifiers");
  }

  private optionalString(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("expected string value");
    this.rejectSensitiveString(value);
    return value;
  }

  private optionalObject(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("expected object value");
    for (const fieldValue of Object.values(value as Record<string, unknown>)) this.rejectSensitiveString(fieldValue);
    return value as Record<string, unknown>;
  }

  private optionalDate(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new BadRequestException("invalid date");
    return value;
  }

  private lastFourAlpha(value: unknown): string {
    if (typeof value !== "string" || !/^[0-9A-Za-z]{4}$/.test(value)) throw new BadRequestException("last four must be four alphanumeric characters");
    return value;
  }

  private nonNegativeNumber(value: unknown): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException("number must be non-negative");
    return number;
  }

  private positiveInteger(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new BadRequestException("value must be a positive integer");
    return number;
  }

  private detectMime(buffer: Buffer): string {
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
    if (buffer.subarray(0, Math.min(buffer.length, 200)).toString("utf8").toLowerCase().includes("<svg")) return "image/svg+xml";
    throw new BadRequestException("unsupported file content");
  }

  private extensionForMime(mimeType: string): string {
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/png") return ".png";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "application/pdf") return ".pdf";
    throw new BadRequestException("unsupported file content");
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

  private async writeWithClient<T>(
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
      aggregateType,
      eventType,
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
