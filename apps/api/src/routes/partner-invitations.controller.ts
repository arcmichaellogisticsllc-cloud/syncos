import crypto from "node:crypto";
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, InternalServerErrorException, NotFoundException, Param, Post, Req } from "@nestjs/common";
import { createAuthToken, hashPassword, validatePassword } from "@syncos/auth";
import { appendAuditLog } from "@syncos/shared";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { sendSmtpRelayEmail } from "../email/smtp-relay";
import { DATABASE_POOL } from "../modules/database.module";
import { Public } from "../security/public.decorator";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const partnerAdminRoleKey = "partner_admin";
const partnerForemanRoleKey = "partner_foreman";
const inviteTtlDays = 7;
const publicInquiryHourlyLimit = 5;

const inquiryStatuses = new Set(["NEW", "REVIEWING", "CONTACT_REQUIRED", "CONTACTED", "QUALIFIED", "FUTURE_CAPACITY", "NOT_A_FIT", "INVITED", "CONVERTED", "CLOSED"]);
const inviteSources = new Set(["PUBLIC_INQUIRY", "MANUAL_INTERNAL", "REFERRAL", "EXISTING_RELATIONSHIP", "OPPORTUNITY_CAPACITY_GAP", "PRIME_CUSTOMER_INTRODUCTION", "PARTNER_NETWORK_RECRUITING", "OTHER"]);
const qualificationDecisions = new Set(["QUALIFIED", "FUTURE_CAPACITY", "NOT_A_FIT", "CLOSED"]);

type PartnerOrganizationRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  capacity_provider_id: string;
  provider_type: string;
};

type InvitationRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  organization_id: string;
  organization_name?: string;
  inquiry_id: string | null;
  invitation_type: "partner_admin" | "partner_foreman";
  invitation_source: string;
  primary_contact_name: string;
  email: string;
  intended_role_key: "partner_admin" | "partner_foreman";
  worker_id: string | null;
  crew_id: string | null;
  foreman_membership_id: string | null;
  status: string;
  invited_by_user_id: string | null;
  accepted_by_user_id: string | null;
  revoked_by_user_id: string | null;
  supersedes_invitation_id: string | null;
  superseded_by_invitation_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  delivery_status: string;
  email_subject: string;
  email_preview: string;
  created_at: Date;
  updated_at: Date;
};

type InquiryRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  territory: string;
  capability: string;
  crew_count: number | null;
  availability: string | null;
  equipment: string | null;
  experience_notes: string | null;
  source: string;
  status: string;
  owner_user_id: string | null;
  territory_verified: boolean;
  capability_verified: boolean;
  crew_count_verified: boolean;
  availability_verified: boolean;
  equipment_verified: boolean;
  qualification_decision: string | null;
  qualified_organization_id: string | null;
  potential_capacity_signal: Record<string, unknown>;
  contacted_at: Date | null;
  qualified_at: Date | null;
  invited_at: Date | null;
  converted_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

@Controller("partner-invitations")
export class PartnerInvitationsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Post("public-inquiries")
  @HttpCode(202)
  @Public()
  async publicInquiry(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const tenantId = await this.resolvePublicInquiryTenant();
    const companyName = this.limitedString(body.company_name, "company_name is required", 160);
    const contactName = this.limitedString(body.contact_name, "contact_name is required", 160);
    const email = this.normalizeEmail(this.limitedString(body.email, "email is required", 254));
    if (!this.validEmail(email)) throw new BadRequestException("email must be valid");
    const phone = this.optionalLimitedString(body.phone, 40);
    const territory = this.limitedString(body.territory, "territory is required", 120);
    const capability = this.limitedString(body.capability, "capability is required", 120);
    const crewCount = this.optionalNonNegativeInteger(body.crew_count, "crew_count");
    const availability = this.optionalLimitedString(body.availability, 160);
    const equipment = this.optionalLimitedString(body.equipment, 500);
    const experienceNotes = this.optionalLimitedString(body.experience_notes ?? body.notes, 2000);
    const source = this.optionalLimitedString(body.source, 80) ?? "synccommsystems.com";
    if (body.tenant_id || body.organization_id || body.role_key || body.user_id || body.storage_key) throw new BadRequestException("public inquiry may not include internal identifiers");
    const ipHash = this.hashNullable(request.ip ?? request.header("x-forwarded-for") ?? null);

    return this.withClient(async (client) => {
      await this.requirePublicInquiryWithinLimit(client, tenantId, email, ipHash);
      const signal = {
        confidence: "LOW",
        verified: false,
        territory,
        capability,
        crew_count: crewCount,
        availability,
        source: "public_inquiry",
      };
      const result = await client.query<InquiryRow>(
        `
        INSERT INTO partner_inquiries (
          tenant_id, company_name, contact_name, email, phone, territory, capability,
          crew_count, availability, equipment, experience_notes, source, potential_capacity_signal,
          source_ip_hash, user_agent_summary
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *
        `,
        [tenantId, companyName, contactName, email, phone, territory, capability, crewCount, availability, equipment, experienceNotes, source, signal, ipHash, this.optionalLimitedString(request.header("user-agent"), 240)],
      );
      return {
        accepted: true,
        message: "Thank you for your interest in partnering with Sync Comm Systems. Our team is reviewing your capabilities and current availability. If there is a fit for current or upcoming work, we'll contact you with next steps.",
        inquiry_id: result.rows[0].id,
        status: result.rows[0].status,
      };
    });
  }

  @Get("inquiries")
  @RequirePermission("partner_inquiry.read")
  async listInquiries(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query<InquiryRow>(
        "SELECT * FROM partner_inquiries WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100",
        [request.auth.tenantId],
      );
      return { inquiries: result.rows.map((row) => this.safeInquiry(row)) };
    });
  }

  @Get("inquiries/:id")
  @RequirePermission("partner_inquiry.read")
  async readInquiry(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const row = await this.inquiryById(client, request.auth.tenantId, id);
      if (!row) throw new NotFoundException("Inquiry not found");
      return this.safeInquiry(row);
    });
  }

  @Post("inquiries/:id/assign")
  @RequirePermission("partner_inquiry.manage")
  async assignInquiry(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const ownerUserId = this.requiredString(body.owner_user_id, "owner_user_id is required");
    return this.withClient(async (client) => {
      await this.requireTenantUserByUserId(client, request.auth.tenantId, ownerUserId);
      const result = await client.query<InquiryRow>(
        "UPDATE partner_inquiries SET owner_user_id = $3, status = CASE WHEN status = 'NEW' THEN 'REVIEWING' ELSE status END, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *",
        [request.auth.tenantId, id, ownerUserId],
      );
      if (!result.rows[0]) throw new NotFoundException("Inquiry not found");
      await this.recordInquiryEvent(client, request.auth.tenantId, id, "OWNER_ASSIGNED", request.auth.userId, { owner_user_id: ownerUserId }, null);
      return this.safeInquiry(result.rows[0]);
    });
  }

  @Post("inquiries/:id/contact")
  @RequirePermission("partner_inquiry.manage")
  async recordContact(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const note = this.limitedString(body.note, "note is required", 2000);
    return this.withClient(async (client) => {
      const result = await client.query<InquiryRow>(
        "UPDATE partner_inquiries SET status = 'CONTACTED', contacted_at = COALESCE(contacted_at, now()), updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *",
        [request.auth.tenantId, id],
      );
      if (!result.rows[0]) throw new NotFoundException("Inquiry not found");
      await this.recordInquiryEvent(client, request.auth.tenantId, id, "CONTACT_RECORDED", request.auth.userId, {}, note);
      return this.safeInquiry(result.rows[0]);
    });
  }

  @Post("inquiries/:id/qualify")
  @RequirePermission("partner_inquiry.qualify")
  async qualifyInquiry(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const decision = this.allowedUpper(body.decision, qualificationDecisions, "decision is required");
    const organizationId = typeof body.organization_id === "string" && body.organization_id.trim() ? body.organization_id.trim() : null;
    return this.withClient(async (client) => {
      if (organizationId) await this.requirePartnerOrganization(client, request.auth.tenantId, organizationId);
      const result = await client.query<InquiryRow>(
        `
        UPDATE partner_inquiries
        SET status = $3,
            qualification_decision = $3,
            territory_verified = COALESCE($4, territory_verified),
            capability_verified = COALESCE($5, capability_verified),
            crew_count_verified = COALESCE($6, crew_count_verified),
            availability_verified = COALESCE($7, availability_verified),
            equipment_verified = COALESCE($8, equipment_verified),
            qualified_organization_id = COALESCE($9, qualified_organization_id),
            qualified_at = CASE WHEN $3 IN ('QUALIFIED','FUTURE_CAPACITY') THEN COALESCE(qualified_at, now()) ELSE qualified_at END,
            closed_at = CASE WHEN $3 IN ('NOT_A_FIT','CLOSED') THEN COALESCE(closed_at, now()) ELSE closed_at END,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
        `,
        [request.auth.tenantId, id, decision, this.optionalBoolean(body.territory_verified), this.optionalBoolean(body.capability_verified), this.optionalBoolean(body.crew_count_verified), this.optionalBoolean(body.availability_verified), this.optionalBoolean(body.equipment_verified), organizationId],
      );
      if (!result.rows[0]) throw new NotFoundException("Inquiry not found");
      await this.recordInquiryEvent(client, request.auth.tenantId, id, "QUALIFICATION_UPDATED", request.auth.userId, { decision, organization_id: organizationId }, this.optionalLimitedString(body.note, 2000));
      return this.safeInquiry(result.rows[0]);
    });
  }

  @Post("inquiries/:id/invite")
  @RequirePermission("partner_invitation.create")
  async inviteFromInquiry(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const inquiry = await this.inquiryById(client, request.auth.tenantId, id);
      if (!inquiry) throw new NotFoundException("Inquiry not found");
      if (inquiry.status !== "QUALIFIED") throw new ConflictException("Inquiry must be human-qualified before onboarding invitation");
      const organizationId = this.requiredString(body.organization_id ?? inquiry.qualified_organization_id, "organization_id is required");
      return this.createAdminInvitation(client, request, {
        organizationId,
        primaryContactName: inquiry.contact_name,
        email: inquiry.email,
        source: "PUBLIC_INQUIRY",
        inquiryId: inquiry.id,
      });
    });
  }

  @Get("analytics")
  @RequirePermission("partner_onboarding.review")
  async analytics(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT
          (SELECT count(*)::int FROM partner_inquiries WHERE tenant_id = $1) AS inquiry_count,
          (SELECT count(*)::int FROM partner_inquiries WHERE tenant_id = $1 AND contacted_at IS NOT NULL) AS contact_count,
          (SELECT count(*)::int FROM partner_inquiries WHERE tenant_id = $1 AND qualification_decision IS NOT NULL) AS qualification_count,
          (SELECT count(*)::int FROM partner_onboarding_invitations WHERE tenant_id = $1) AS invitation_count,
          (SELECT count(*)::int FROM partner_onboarding_invitations WHERE tenant_id = $1 AND status = 'ACCEPTED') AS invite_acceptance_count,
          jsonb_object_agg(source, source_count) AS by_inquiry_source
        FROM (
          SELECT source, count(*)::int AS source_count FROM partner_inquiries WHERE tenant_id = $1 GROUP BY source
        ) s
        `,
        [request.auth.tenantId],
      );
      const durations = await client.query(
        `
        SELECT
          (
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (contacted_at - created_at)) / 86400)
            FROM partner_inquiries
            WHERE tenant_id = $1 AND contacted_at IS NOT NULL
          ) AS inquiry_to_contact_days,
          (
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (qualified_at - contacted_at)) / 86400)
            FROM partner_inquiries
            WHERE tenant_id = $1 AND contacted_at IS NOT NULL AND qualified_at IS NOT NULL
          ) AS contact_to_qualification_days,
          (
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (accepted_at - created_at)) / 86400)
            FROM partner_onboarding_invitations
            WHERE tenant_id = $1 AND accepted_at IS NOT NULL
          ) AS invite_to_acceptance_days
        `,
        [request.auth.tenantId],
      );
      return { ...result.rows[0], durations: durations.rows[0] };
    });
  }

  @Get("onboarding-workspace")
  @RequirePermission("partner_onboarding.review")
  async onboardingWorkspace(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT o.id AS organization_id, o.name AS company, o.status AS organization_status,
               max(i.created_at) AS last_invite_at,
               count(i.id)::int AS invite_count,
               count(i.id) FILTER (WHERE i.status = 'SENT')::int AS sent_invites,
               count(i.id) FILTER (WHERE i.status = 'ACCEPTED')::int AS accepted_invites,
               max(i.invitation_source) AS source
        FROM organizations o
        JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.provider_type = ANY($2::text[])
        LEFT JOIN partner_onboarding_invitations i ON i.tenant_id = o.tenant_id AND i.organization_id = o.id
        WHERE o.tenant_id = $1 AND o.deleted_at IS NULL
        GROUP BY o.id, o.name, o.status
        ORDER BY max(i.created_at) DESC NULLS LAST, o.name ASC
        LIMIT 100
        `,
        [request.auth.tenantId, Array.from(partnerProviderTypes)],
      );
      const rows = [];
      for (const row of result.rows) {
        const checklist = await this.checklist(client, request.auth.tenantId, row.organization_id);
        rows.push({
          organization_id: row.organization_id,
          company: row.company,
          source: row.source ?? "UNKNOWN",
          invite_status: Number(row.sent_invites) > 0 ? "INVITED" : Number(row.accepted_invites) > 0 ? "ACCOUNT_ACTIVATED" : "NOT_INVITED",
          last_invite_at: row.last_invite_at,
          account_status: Number(row.accepted_invites) > 0 ? "ACCOUNT_ACTIVATED" : "PENDING_INVITE",
          checklist_status: checklist.readiness_status,
          safe_blockers: checklist.items.filter((item) => !item.complete).map((item) => item.key),
          reviewer: null,
        });
      }
      return { partners: rows };
    });
  }

  @Post("organizations/:organizationId/approve")
  @RequirePermission("partner_onboarding.approve")
  async approveOrganization(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string) {
    return this.withClient(async (client) => {
      const organization = await this.requirePartnerOrganization(client, request.auth.tenantId, organizationId);
      const checklist = await this.checklist(client, request.auth.tenantId, organizationId);
      if (!checklist.ready_for_review) throw new ConflictException("Partner onboarding is not ready for internal approval");
      await client.query("UPDATE organizations SET status = 'active', updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, organizationId]);
      await client.query("UPDATE capacity_providers SET verification_status = 'qualified', status = 'qualified', updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, organization.capacity_provider_id]);
      await appendAuditLog(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action: "partner_onboarding.approve",
        entityType: "organization",
        entityId: organizationId,
        afterState: { organization_id: organizationId, approval: "COMPANY_APPROVED", no_work_order_created: true, no_mobilization_created: true },
      });
      return { organization_id: organizationId, status: "COMPANY_APPROVED", no_work_order_created: true, no_mobilization_created: true };
    });
  }

  @Get("foreman/:id")
  @RequirePermission("partner_foreman_invitation.read")
  async readForemanInvitation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const context = await this.partnerAdminContext(client, request.auth.tenantId, request.auth.userId);
      const row = await this.invitationById(client, request.auth.tenantId, id);
      if (!row || row.invitation_type !== "partner_foreman" || row.organization_id !== context.organization_id) throw new NotFoundException("Invitation not found");
      return this.safeInvitation(row, row.organization_name);
    });
  }

  @Post("foreman/:id/resend")
  @RequirePermission("partner_foreman_invitation.resend")
  async resendForemanInvitation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const context = await this.partnerAdminContext(client, request.auth.tenantId, request.auth.userId);
      return this.resendInvitationById(client, request.auth.tenantId, request.auth.userId, id, context.organization_id, "partner_foreman");
    });
  }

  @Post("foreman/:id/revoke")
  @RequirePermission("partner_foreman_invitation.revoke")
  async revokeForemanInvitation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.partnerAdminContext(client, request.auth.tenantId, request.auth.userId);
      return this.revokeInvitationById(client, request.auth.tenantId, request.auth.userId, id, this.optionalLimitedString(body.reason, 500), context.organization_id, "partner_foreman");
    });
  }

  @Post("foreman")
  @RequirePermission("partner_foreman_invitation.create")
  async createForemanInvitation(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const organizationId = typeof body.organization_id === "string" && body.organization_id.trim() ? this.requiredUuid(body.organization_id, "organization_id must be a valid UUID") : undefined;
    const workerId = this.requiredUuid(body.worker_id, "worker_id must be a valid UUID");
    const crewId = this.requiredUuid(body.crew_id, "crew_id must be a valid UUID");
    const email = this.normalizeEmail(this.requiredString(body.email, "email is required"));
    if (!this.validEmail(email)) throw new BadRequestException("email must be valid");
    return this.withClient(async (client) => {
      const context = await this.partnerAdminOrInternalOrg(client, request, organizationId);
      const foreman = await this.requireCurrentForemanMembership(client, context.tenant_id, context.organization_id, workerId, crewId);
      return this.createInvitationRecord(client, request.auth.tenantId, request.auth.userId, {
        organizationId: context.organization_id,
        primaryContactName: foreman.worker_name || "Partner Foreman",
        email,
        roleKey: partnerForemanRoleKey,
        invitationType: "partner_foreman",
        source: this.allowedUpper(body.source ?? "MANUAL_INTERNAL", inviteSources, "source is invalid"),
        workerId,
        crewId,
        foremanMembershipId: foreman.membership_id,
      });
    });
  }

  @Get()
  @RequirePermission("partner_invitation.read")
  async listInvitations(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query<InvitationRow>(
        `
        SELECT i.*, o.name AS organization_name
        FROM partner_onboarding_invitations i
        JOIN organizations o ON o.tenant_id = i.tenant_id AND o.id = i.organization_id
        WHERE i.tenant_id = $1
        ORDER BY i.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId],
      );
      return { invitations: result.rows.map((row) => this.safeInvitation(row, row.organization_name)) };
    });
  }

  @Post()
  @RequirePermission("partner_invitation.create")
  async createInvitation(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const organizationId = typeof body.organization_id === "string" && body.organization_id.trim() ? this.requiredUuid(body.organization_id, "organization_id must be a valid UUID") : null;
    const companyName = organizationId ? undefined : this.limitedString(body.company_name, "company_name is required", 160);
    const email = this.normalizeEmail(this.requiredString(body.email, "email is required"));
    const primaryContactName = this.requiredString(body.primary_contact_name, "primary_contact_name is required");
    const roleKey = body.role_key === undefined ? partnerAdminRoleKey : this.requiredString(body.role_key, "role_key is required");
    if (roleKey !== partnerAdminRoleKey) throw new BadRequestException("Only Partner Admin invitations use this endpoint");
    if (!this.validEmail(email)) throw new BadRequestException("email must be a valid normalized address");
    return this.withClient(async (client) => {
      const resolvedOrganizationId = organizationId ?? (await this.resolveManualPartnerOrganization(client, request.auth.tenantId, request.auth.userId, this.requiredString(companyName, "company_name is required")));
      return this.createAdminInvitation(client, request, {
        organizationId: resolvedOrganizationId,
        primaryContactName,
        email,
        source: this.allowedUpper(body.source ?? "MANUAL_INTERNAL", inviteSources, "source is invalid"),
        inquiryId: typeof body.inquiry_id === "string" && body.inquiry_id.trim() ? body.inquiry_id.trim() : null,
      });
    });
  }

  @Post("token/preview")
  @HttpCode(200)
  @Public()
  async previewInvitation(@Body() body: Record<string, unknown>) {
    const token = this.requiredString(body.token, "token is required");
    return this.withClient(async (client) => {
      const row = await this.invitationByToken(client, token);
      this.requireAcceptableInvitation(row);
      return {
        invitation: this.safeInvitation(row, row.organization_name),
        message: row.email_preview,
        checklist: row.invitation_type === "partner_admin" ? this.defaultChecklist(true) : null,
      };
    });
  }

  @Post("accept")
  @Public()
  async acceptInvitation(@Body() body: Record<string, unknown>) {
    const token = this.requiredString(body.token, "token is required");
    const displayName = typeof body.display_name === "string" && body.display_name.trim() ? body.display_name.trim() : null;
    const password = this.requiredPassword(body.password);
    return this.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const invitation = await this.invitationByToken(client, token, true);
        this.requireAcceptableInvitation(invitation);
        if (invitation.invitation_type === "partner_foreman") {
          await this.requireCurrentForemanMembership(client, invitation.tenant_id, invitation.organization_id, String(invitation.worker_id), String(invitation.crew_id), String(invitation.foreman_membership_id));
        }
        const user = await this.createOrAttachUser(client, invitation, displayName, password);
        const tenantUser = await this.ensureTenantUser(client, invitation.tenant_id, user.id);
        const role = await this.requireRole(client, invitation.tenant_id, invitation.intended_role_key);
        await client.query(
          `
          INSERT INTO user_roles (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
          VALUES ($1, $2, $3, 'organization', $4)
          ON CONFLICT (tenant_user_id, role_id, scope_type, scope_id) DO NOTHING
          `,
          [invitation.tenant_id, tenantUser.id, role.id, invitation.organization_id],
        );
        if (invitation.invitation_type === "partner_foreman") {
          await client.query(
            `
            INSERT INTO partner_worker_user_links (tenant_id, organization_id, worker_id, tenant_user_id, linked_by_user_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_id, worker_id) WHERE deleted_at IS NULL AND status = 'active' DO UPDATE
            SET tenant_user_id = EXCLUDED.tenant_user_id, updated_at = now()
            RETURNING id
            `,
            [invitation.tenant_id, invitation.organization_id, invitation.worker_id, tenantUser.id, user.id],
          );
        }
        const accepted = await client.query<InvitationRow>(
          `
          UPDATE partner_onboarding_invitations
          SET status = 'ACCEPTED', accepted_by_user_id = $3, accepted_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'SENT'
          RETURNING *
          `,
          [invitation.tenant_id, invitation.id, user.id],
        );
        if (!accepted.rows[0]) throw new ConflictException("Invitation was already used");
        if (invitation.inquiry_id) {
          await client.query("UPDATE partner_inquiries SET status = 'CONVERTED', converted_at = COALESCE(converted_at, now()), updated_at = now() WHERE tenant_id = $1 AND id = $2", [invitation.tenant_id, invitation.inquiry_id]);
        }
        await appendAuditLog(client, {
          tenantId: invitation.tenant_id,
          actorUserId: user.id,
          action: "partner_invitation.accept",
          entityType: "partner_onboarding_invitation",
          entityId: invitation.id,
          afterState: this.safeInvitation(accepted.rows[0], invitation.organization_name),
          metadata: { organization_id: invitation.organization_id, intended_role_key: invitation.intended_role_key, invitation_type: invitation.invitation_type },
        });
        await client.query("COMMIT");
        const sessionToken = this.createSessionToken(invitation.tenant_id, user.id, invitation.email);
        return {
          invitation: this.safeInvitation(accepted.rows[0], invitation.organization_name),
          user: { id: user.id, email: invitation.email, display_name: user.display_name },
          organization_id: invitation.organization_id,
          worker_id: invitation.worker_id,
          crew_id: invitation.crew_id,
          role_key: invitation.intended_role_key,
          token: sessionToken,
          next_path: invitation.invitation_type === "partner_foreman" ? "/syncfield/today" : "/partner/onboarding",
          checklist: invitation.invitation_type === "partner_admin" ? await this.checklist(client, invitation.tenant_id, invitation.organization_id) : null,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  @Get("me/onboarding-checklist")
  @RequirePermission("partner_context.read")
  async ownChecklist(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const context = await this.partnerAdminContext(client, request.auth.tenantId, request.auth.userId);
      return this.checklist(client, request.auth.tenantId, context.organization_id);
    });
  }

  @Post(":id/resend")
  @RequirePermission("partner_invitation.resend")
  async resendInvitation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.resendInvitationById(client, request.auth.tenantId, request.auth.userId, id));
  }

  @Post(":id/revoke")
  @RequirePermission("partner_invitation.revoke")
  async revokeInvitation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.withClient((client) => this.revokeInvitationById(client, request.auth.tenantId, request.auth.userId, id, this.optionalLimitedString(body.reason, 500)));
  }

  @Get(":id")
  @RequirePermission("partner_invitation.read")
  async readInvitation(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const row = await this.invitationById(client, request.auth.tenantId, id);
      if (!row) throw new NotFoundException("Invitation not found");
      return this.safeInvitation(row, row.organization_name);
    });
  }

  private async createAdminInvitation(client: PoolClient, request: AuthenticatedRequest, input: { organizationId: string; primaryContactName: string; email: string; source: string; inquiryId?: string | null }) {
    await this.requirePartnerOrganization(client, request.auth.tenantId, input.organizationId);
    if (input.inquiryId && !(await this.inquiryById(client, request.auth.tenantId, input.inquiryId))) throw new NotFoundException("Inquiry not found");
    return this.createInvitationRecord(client, request.auth.tenantId, request.auth.userId, {
      organizationId: input.organizationId,
      primaryContactName: input.primaryContactName,
      email: input.email,
      roleKey: partnerAdminRoleKey,
      invitationType: "partner_admin",
      source: input.source,
      inquiryId: input.inquiryId ?? null,
    });
  }

  private async createInvitationRecord(client: PoolClient, tenantId: string, actorUserId: string, input: {
    organizationId: string;
    primaryContactName: string;
    email: string;
    roleKey: "partner_admin" | "partner_foreman";
    invitationType: "partner_admin" | "partner_foreman";
    source: string;
    inquiryId?: string | null;
    workerId?: string | null;
    crewId?: string | null;
    foremanMembershipId?: string | null;
  }) {
    const existing = await client.query(
      "SELECT id FROM partner_onboarding_invitations WHERE tenant_id = $1 AND organization_id = $2 AND email = $3 AND invitation_type = $4 AND status = 'SENT' AND expires_at > now()",
      [tenantId, input.organizationId, input.email, input.invitationType],
    );
    if (existing.rows[0]) throw new ConflictException("An active invitation already exists for this Partner contact");
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const subject = input.invitationType === "partner_foreman" ? "Sync Comm Systems Field Access Invitation" : "Sync Comm Systems Partner Onboarding Invitation";
    const preview = input.invitationType === "partner_foreman"
      ? "Sync Comm Systems has invited you to activate Foreman field access."
      : "Sync Comm Systems has invited you to complete your company onboarding.";
    const result = await client.query<InvitationRow>(
      `
      INSERT INTO partner_onboarding_invitations (
        tenant_id, organization_id, inquiry_id, invitation_type, invitation_source, primary_contact_name, email,
        intended_role_key, worker_id, crew_id, foreman_membership_id, token_hash, invited_by_user_id,
        expires_at, email_subject, email_preview
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now() + ($14::text || ' days')::interval,$15,$16)
      RETURNING *
      `,
      [tenantId, input.organizationId, input.inquiryId ?? null, input.invitationType, input.source, input.primaryContactName, input.email, input.roleKey, input.workerId ?? null, input.crewId ?? null, input.foremanMembershipId ?? null, tokenHash, actorUserId, inviteTtlDays, subject, preview],
    );
    if (input.inquiryId) {
      await client.query("UPDATE partner_inquiries SET status = 'INVITED', invited_at = COALESCE(invited_at, now()), updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, input.inquiryId]);
      await this.recordInquiryEvent(client, tenantId, input.inquiryId, "INVITE_SENT", actorUserId, { invitation_id: result.rows[0].id }, null);
    }
    await appendAuditLog(client, {
      tenantId,
      actorUserId,
      action: "partner_invitation.create",
      entityType: "partner_onboarding_invitation",
      entityId: result.rows[0].id,
      afterState: this.safeInvitation(result.rows[0]),
      metadata: { invitation_source: input.source, email_provider: this.emailProvider() },
    });
    const delivery = await this.deliverInvitationEmail(client, result.rows[0], token);
    return { ...this.safeInvitation({ ...result.rows[0], delivery_status: delivery.email_delivery.delivery_status }), ...delivery };
  }

  private async resendInvitationById(client: PoolClient, tenantId: string, actorUserId: string, id: string, organizationId?: string, invitationType?: "partner_admin" | "partner_foreman") {
    await client.query("BEGIN");
    try {
      const current = await this.invitationById(client, tenantId, id, true);
      if (!current) throw new NotFoundException("Invitation not found");
      if (organizationId && current.organization_id !== organizationId) throw new NotFoundException("Invitation not found");
      if (invitationType && current.invitation_type !== invitationType) throw new NotFoundException("Invitation not found");
      if (current.status !== "SENT") throw new ConflictException("Only sent invitations can be resent");
      if (current.invitation_type === "partner_foreman") {
        await this.requireCurrentForemanMembership(client, current.tenant_id, current.organization_id, String(current.worker_id), String(current.crew_id), String(current.foreman_membership_id));
      }
      await client.query("UPDATE partner_onboarding_invitations SET status = 'SUPERSEDED', updated_at = now() WHERE tenant_id = $1 AND id = $2", [current.tenant_id, current.id]);
      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = this.hashToken(token);
      const inserted = await client.query<InvitationRow>(
        `
        INSERT INTO partner_onboarding_invitations (
          tenant_id, organization_id, inquiry_id, invitation_type, invitation_source, primary_contact_name,
          email, intended_role_key, worker_id, crew_id, foreman_membership_id, token_hash, invited_by_user_id,
          supersedes_invitation_id, expires_at, email_subject, email_preview
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now() + ($15::text || ' days')::interval,$16,$17)
        RETURNING *
        `,
        [current.tenant_id, current.organization_id, current.inquiry_id, current.invitation_type, current.invitation_source, current.primary_contact_name, current.email, current.intended_role_key, current.worker_id, current.crew_id, current.foreman_membership_id, tokenHash, actorUserId, current.id, inviteTtlDays, current.email_subject, current.email_preview],
      );
      await client.query("UPDATE partner_onboarding_invitations SET status = 'SUPERSEDED', superseded_by_invitation_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2", [current.tenant_id, current.id, inserted.rows[0].id]);
      await appendAuditLog(client, {
        tenantId: current.tenant_id,
        actorUserId,
        action: "partner_invitation.resend",
        entityType: "partner_onboarding_invitation",
        entityId: inserted.rows[0].id,
        afterState: this.safeInvitation(inserted.rows[0], current.organization_name),
        metadata: { supersedes_invitation_id: current.id },
      });
      await client.query("COMMIT");
      const delivery = await this.deliverInvitationEmail(client, inserted.rows[0], token);
      return { ...this.safeInvitation({ ...inserted.rows[0], delivery_status: delivery.email_delivery.delivery_status }, current.organization_name), ...delivery };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  private async revokeInvitationById(client: PoolClient, tenantId: string, actorUserId: string, id: string, reason: string | null, organizationId?: string, invitationType?: "partner_admin" | "partner_foreman") {
    const values: unknown[] = [tenantId, id, actorUserId, reason];
    const conditions = ["tenant_id = $1", "id = $2", "status = 'SENT'"];
    if (organizationId) {
      values.push(organizationId);
      conditions.push(`organization_id = $${values.length}`);
    }
    if (invitationType) {
      values.push(invitationType);
      conditions.push(`invitation_type = $${values.length}`);
    }
    const result = await client.query<InvitationRow>(
      `
      UPDATE partner_onboarding_invitations
      SET status = 'REVOKED', revoked_by_user_id = $3, revoked_at = now(), revoked_reason = $4, updated_at = now()
      WHERE ${conditions.join(" AND ")}
      RETURNING *
      `,
      values,
    );
    if (!result.rows[0]) throw new ConflictException("Invitation cannot be revoked");
    await appendAuditLog(client, {
      tenantId,
      actorUserId,
      action: "partner_invitation.revoke",
      entityType: "partner_onboarding_invitation",
      entityId: id,
      afterState: this.safeInvitation(result.rows[0]),
      metadata: { access_role_unchanged_if_already_accepted: true },
    });
    return { ...this.safeInvitation(result.rows[0]), accepted_access_revocation_requires_access_lifecycle: true };
  }

  private async deliverInvitationEmail(client: PoolClient, row: InvitationRow, token: string) {
    const provider = this.emailProvider();
    const onboardingUrl = this.invitationUrl(token);
    const allowlistFailure = this.stagingRecipientAllowlistFailure(row.email);
    if (allowlistFailure) {
      await client.query("UPDATE partner_onboarding_invitations SET delivery_status = 'FAILED', delivery_reference = 'staging_recipient_blocked', updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id]);
      return this.deliveryResult(row, provider, "FAILED", null, allowlistFailure);
    }
    if (provider === "disabled") {
      await client.query("UPDATE partner_onboarding_invitations SET delivery_status = 'FAILED', delivery_reference = 'email_disabled', updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id]);
      return this.deliveryResult(row, provider, "FAILED", null, "Outbound invitation email is disabled until a production provider is configured.");
    }
    if (provider === "generic_http") {
      const endpoint = process.env.EMAIL_HTTP_ENDPOINT;
      const apiKey = process.env.EMAIL_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (!endpoint || !apiKey || !from) return this.deliveryResult(row, provider, "FAILED", null, "Production email provider configuration is incomplete.");
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from,
            reply_to: process.env.EMAIL_REPLY_TO,
            to: row.email,
            subject: row.email_subject,
            text: `${row.email_preview}\n\n${onboardingUrl}`,
          }),
        });
        const deliveryStatus = response.ok ? "SENT" : "FAILED";
        await client.query("UPDATE partner_onboarding_invitations SET delivery_status = $3, delivery_reference = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id, deliveryStatus, `generic_http:${response.status}`]);
        return this.deliveryResult(row, provider, deliveryStatus, null, response.ok ? null : "Invitation email provider rejected the send request.");
      } catch {
        await client.query("UPDATE partner_onboarding_invitations SET delivery_status = 'FAILED', delivery_reference = 'generic_http:error', updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id]);
        return this.deliveryResult(row, provider, "FAILED", null, "Invitation email provider request failed.");
      }
    }
    if (provider === "smtp_relay") {
      const from = process.env.EMAIL_FROM;
      if (!from) {
        await client.query("UPDATE partner_onboarding_invitations SET delivery_status = 'FAILED', delivery_reference = 'smtp_relay:config_incomplete', updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id]);
        return this.deliveryResult(row, provider, "FAILED", null, "SMTP relay configuration is incomplete.");
      }
      try {
        await sendSmtpRelayEmail({
          from,
          replyTo: process.env.EMAIL_REPLY_TO,
          to: row.email,
          subject: row.email_subject,
          text: `${row.email_preview}\n\n${onboardingUrl}`,
        });
        await client.query("UPDATE partner_onboarding_invitations SET delivery_status = 'SENT', delivery_reference = 'smtp_relay:accepted', updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id]);
        return this.deliveryResult(row, provider, "SENT", null, null);
      } catch {
        await client.query("UPDATE partner_onboarding_invitations SET delivery_status = 'FAILED', delivery_reference = 'smtp_relay:error', updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id]);
        return this.deliveryResult(row, provider, "FAILED", null, "SMTP relay invitation delivery failed.");
      }
    }
    await client.query("UPDATE partner_onboarding_invitations SET delivery_status = 'LOCAL_PREPARED', delivery_reference = 'local_test_adapter', updated_at = now() WHERE tenant_id = $1 AND id = $2", [row.tenant_id, row.id]);
    return this.deliveryResult(row, "local_test_adapter", "LOCAL_PREPARED", onboardingUrl, null);
  }

  private deliveryResult(row: InvitationRow, provider: string, deliveryStatus: string, actionUrl: string | null, operatorAction: string | null) {
    return {
      onboarding_url: actionUrl,
      email: {
        to: row.email,
        subject: row.email_subject,
        preview: row.email_preview,
        action_url: actionUrl,
        delivery_status: deliveryStatus,
        provider,
        operator_action: operatorAction,
      },
      email_delivery: {
        provider,
        delivery_status: deliveryStatus,
        raw_token_returned: actionUrl !== null,
      },
    };
  }

  private emailProvider() {
    return process.env.EMAIL_PROVIDER ?? "local_test";
  }

  private stagingRecipientAllowlistFailure(email: string) {
    if (process.env.NODE_ENV !== "staging") return null;
    const allowed = (process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length === 0) return "STAGING_EMAIL_RECIPIENT_ALLOWLIST is required before staging invitation email can be delivered.";
    const normalized = email.trim().toLowerCase();
    const permitted = allowed.some((entry) => entry.startsWith("@") ? normalized.endsWith(entry) : normalized === entry);
    return permitted ? null : "Recipient is not in STAGING_EMAIL_RECIPIENT_ALLOWLIST; staging email delivery was blocked.";
  }

  private invitationUrl(token: string) {
    const baseUrl = process.env.APPLICATION_BASE_URL;
    if (!baseUrl) return `/partner/invite/${token}`;
    return `${baseUrl.replace(/\/$/, "")}/partner/invite/${token}`;
  }

  private async checklist(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT
        (SELECT status FROM partner_company_profiles WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status <> 'superseded' ORDER BY updated_at DESC LIMIT 1) AS company_status,
        (SELECT status FROM partner_tax_profiles WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status <> 'superseded' ORDER BY updated_at DESC LIMIT 1) AS w9_status,
        (SELECT status FROM partner_payment_profiles WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status <> 'superseded' ORDER BY updated_at DESC LIMIT 1) AS payment_status,
        (SELECT count(*)::int FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status IN ('submitted','under_review','verified')) AS insurance_count,
        (SELECT count(*)::int FROM workers WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'active' AND review_status IN ('submitted','under_review','approved','conditional')) AS worker_count,
        (SELECT count(*)::int FROM partner_worker_headshots WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status IN ('submitted','under_review','verified')) AS headshot_count,
        (SELECT count(*)::int FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status IN ('submitted','under_review','verified')) AS credential_count,
        (SELECT count(*)::int FROM crews WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND lifecycle_status IN ('active','draft')) AS crew_count,
        (SELECT count(*)::int FROM partner_crew_memberships WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'active' AND membership_role IN ('foreman','alternate_foreman')) AS foreman_count,
        (SELECT count(*)::int FROM partner_agreement_versions WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status IN ('issued','partially_executed','executed','effective')) AS agreement_count,
        (SELECT count(*)::int FROM mobilization_readiness_evaluations WHERE tenant_id = $1 AND organization_id = $2 AND current = true AND overall_status IN ('ready','conditional')) AS mobilization_count
      `,
      [tenantId, organizationId],
    );
    const row = result.rows[0] ?? {};
    const items = [
      this.checklistItem("company_profile", "Company Profile", "Required", Boolean(row.company_status), "/partner/company", row.company_status),
      this.checklistItem("w9", "W-9", "Required", Boolean(row.w9_status), "/partner/compliance", row.w9_status),
      this.checklistItem("payment_setup", "Payment Setup", "Required", Boolean(row.payment_status), "/partner/compliance", row.payment_status),
      this.checklistItem("insurance", "Insurance", "Required", Number(row.insurance_count ?? 0) > 0, "/partner/compliance", Number(row.insurance_count ?? 0) > 0 ? "submitted" : null),
      this.checklistItem("workers", "Workers", "Required", Number(row.worker_count ?? 0) > 0, "/partner/workers", `${row.worker_count ?? 0} workers`),
      this.checklistItem("headshots", "Headshots", "Required", Number(row.headshot_count ?? 0) > 0, "/partner/workers", `${row.headshot_count ?? 0} headshots`),
      this.checklistItem("credentials", "Credentials", "Required", Number(row.credential_count ?? 0) > 0, "/partner/workers", `${row.credential_count ?? 0} credentials`),
      this.checklistItem("crew", "Crew", "Required", Number(row.crew_count ?? 0) > 0, "/partner/workers", `${row.crew_count ?? 0} crews`),
      this.checklistItem("foreman", "Foreman", "Required", Number(row.foreman_count ?? 0) > 0, "/partner/workers", `${row.foreman_count ?? 0} foremen`),
      this.checklistItem("agreement", "Agreement", "Pending", Number(row.agreement_count ?? 0) > 0, "/partner/agreements", Number(row.agreement_count ?? 0) > 0 ? "issued" : "pending"),
      this.checklistItem("internal_review", "Internal Review", "Pending", false, "/partner/onboarding", "not_started"),
    ];
    const requiredComplete = items.filter((item) => item.requirement === "Required").every((item) => item.complete);
    const readyForReview = requiredComplete && Number(row.agreement_count ?? 0) > 0;
    items.push({
      key: "mobilization",
      label: "Mobilization",
      requirement: requiredComplete ? "Pending" : "Locked until required items complete",
      complete: Number(row.mobilization_count ?? 0) > 0,
      route: "/partner/mobilization",
      status: Number(row.mobilization_count ?? 0) > 0 ? "ready" : "locked",
    });
    return {
      organization_id: organizationId,
      items,
      required_complete: requiredComplete,
      ready_for_review: readyForReview,
      readiness_status: readyForReview ? "READY_FOR_REVIEW" : requiredComplete ? "ONBOARDING_INCOMPLETE" : "ACCOUNT_ACTIVATED",
      boundaries: {
        checklist_is_navigation_only: true,
        mobilization_separate: true,
      },
    };
  }

  private defaultChecklist(locked: boolean) {
    const items = [
      this.checklistItem("company_profile", "Company Profile", "Required", false, "/partner/company", null),
      this.checklistItem("w9", "W-9", "Required", false, "/partner/compliance", null),
      this.checklistItem("payment_setup", "Payment Setup", "Required", false, "/partner/compliance", null),
      this.checklistItem("insurance", "Insurance", "Required", false, "/partner/compliance", null),
      this.checklistItem("workers", "Workers", "Required", false, "/partner/workers", null),
      this.checklistItem("headshots", "Headshots", "Required", false, "/partner/workers", null),
      this.checklistItem("credentials", "Credentials", "Required", false, "/partner/workers", null),
      this.checklistItem("crew", "Crew", "Required", false, "/partner/workers", null),
      this.checklistItem("foreman", "Foreman", "Required", false, "/partner/workers", null),
      this.checklistItem("agreement", "Agreement", "Pending", false, "/partner/agreements", "pending"),
      this.checklistItem("internal_review", "Internal Review", "Pending", false, "/partner/onboarding", "not_started"),
      { key: "mobilization", label: "Mobilization", requirement: locked ? "Locked until required items complete" : "Pending", complete: false, route: "/partner/mobilization", status: "locked" },
    ];
    return { items, required_complete: false, readiness_status: "ACCOUNT_ACTIVATED" };
  }

  private checklistItem(key: string, label: string, requirement: string, complete: boolean, route: string, status: unknown) {
    return { key, label, requirement, complete, route, status: status ? String(status) : "not_started" };
  }

  private async createOrAttachUser(client: PoolClient, invitation: InvitationRow, displayName: string | null, password: string) {
    const existing = await client.query<{ id: string; display_name: string | null; status: string; password_hash: string | null }>("SELECT id, display_name, status, password_hash FROM users WHERE email = $1", [invitation.email]);
    if (existing.rows[0] && !["active", "invited"].includes(existing.rows[0].status)) throw new ForbiddenException("Existing user is not eligible for invitation acceptance");
    const passwordHash = hashPassword(password);
    const shouldSetPassword = !existing.rows[0]?.password_hash;
    const result = await client.query<{ id: string; display_name: string | null }>(
      `
      INSERT INTO users (email, display_name, password_hash, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (email) DO UPDATE
      SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
          password_hash = CASE WHEN $4::boolean THEN EXCLUDED.password_hash ELSE users.password_hash END,
          status = CASE WHEN users.status = 'invited' THEN 'active' ELSE users.status END,
          updated_at = now()
      RETURNING id, display_name
      `,
      [invitation.email, displayName ?? invitation.primary_contact_name, passwordHash, shouldSetPassword],
    );
    return { id: result.rows[0].id, display_name: result.rows[0].display_name ?? invitation.primary_contact_name };
  }

  private async ensureTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const existing = await client.query<{ id: string; status: string }>("SELECT id, status FROM tenant_users WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId]);
    if (existing.rows[0] && !["active", "invited"].includes(existing.rows[0].status)) throw new ForbiddenException("Existing tenant user is not eligible for invitation acceptance");
    const result = await client.query<{ id: string }>(
      `
      INSERT INTO tenant_users (tenant_id, user_id, status)
      VALUES ($1, $2, 'active')
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'active', updated_at = now()
      RETURNING id
      `,
      [tenantId, userId],
    );
    return result.rows[0];
  }

  private async requireRole(client: PoolClient, tenantId: string, roleKey: string) {
    const result = await client.query<{ id: string }>("SELECT id FROM roles WHERE tenant_id = $1 AND system_key = $2", [tenantId, roleKey]);
    if (!result.rows[0]) throw new InternalServerErrorException(`${roleKey} role is not configured`);
    return result.rows[0];
  }

  private async partnerAdminContext(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query<{ organization_id: string }>(
      `
      SELECT ur.scope_id AS organization_id
      FROM user_roles ur
      JOIN tenant_users tu ON tu.id = ur.tenant_user_id AND tu.tenant_id = ur.tenant_id AND tu.status = 'active'
      JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.system_key = 'partner_admin'
      JOIN organizations o ON o.tenant_id = ur.tenant_id AND o.id = ur.scope_id
      WHERE ur.tenant_id = $1 AND tu.user_id = $2 AND ur.scope_type = 'organization'
      ORDER BY ur.created_at
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new ForbiddenException("Partner Admin organization scope is required");
    return result.rows[0];
  }

  private async partnerAdminOrInternalOrg(client: PoolClient, request: AuthenticatedRequest, organizationId?: string) {
    const partnerContext = await this.partnerAdminContext(client, request.auth.tenantId, request.auth.userId).catch(() => null);
    if (partnerContext) {
      if (organizationId && organizationId !== partnerContext.organization_id) throw new ForbiddenException("Partner Admin cannot invite for another Partner");
      return { tenant_id: request.auth.tenantId, organization_id: partnerContext.organization_id };
    }
    const requestedOrganizationId = this.requiredString(organizationId, "organization_id is required for internal Foreman invitation");
    await this.requirePartnerOrganization(client, request.auth.tenantId, requestedOrganizationId);
    return { tenant_id: request.auth.tenantId, organization_id: requestedOrganizationId };
  }

  private async requirePartnerOrganization(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query<PartnerOrganizationRow>(
      `
      SELECT o.id, o.tenant_id, o.name, o.status, cp.id AS capacity_provider_id, cp.provider_type
      FROM organizations o
      JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id
      WHERE o.tenant_id = $1 AND o.id = $2 AND o.deleted_at IS NULL AND cp.provider_type = ANY($3::text[])
      LIMIT 1
      `,
      [tenantId, organizationId, Array.from(partnerProviderTypes)],
    );
    if (!result.rows[0]) throw new NotFoundException("Partner organization not found");
    return result.rows[0];
  }

  private async resolveManualPartnerOrganization(client: PoolClient, tenantId: string, actorUserId: string, companyName: string) {
    const name = companyName.trim();
    const existing = await client.query<PartnerOrganizationRow>(
      `
      SELECT o.id, o.tenant_id, o.name, o.status, cp.id AS capacity_provider_id, cp.provider_type
      FROM organizations o
      JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id
      WHERE o.tenant_id = $1
        AND lower(o.name) = lower($2)
        AND o.deleted_at IS NULL
        AND cp.deleted_at IS NULL
        AND cp.provider_type = ANY($3::text[])
        AND cp.status <> 'archived'
      ORDER BY o.created_at ASC
      `,
      [tenantId, name, Array.from(partnerProviderTypes)],
    );
    if (existing.rows.length > 1) throw new ConflictException("Multiple Partner organizations match this company name");
    if (existing.rows[0]) return existing.rows[0].id;

    const inserted = await client.query<{ organization_id: string; capacity_provider_id: string }>(
      `
      WITH organization_insert AS (
        INSERT INTO organizations (tenant_id, name, type, actor_roles, source_name, trust_level, status)
        VALUES ($1, $2, 'partner', ARRAY['capacity_provider'], 'manual_partner_invitation', 'low', 'discovered')
        RETURNING id
      ),
      provider_insert AS (
        INSERT INTO capacity_providers (
          tenant_id,
          organization_id,
          name,
          provider_type,
          status,
          verification_status,
          contract_status
        )
        SELECT $1, id, $2, 'subcontractor', 'prospect', 'prospect', 'not_started'
        FROM organization_insert
        RETURNING id
      )
      SELECT organization_insert.id AS organization_id, provider_insert.id AS capacity_provider_id
      FROM organization_insert, provider_insert
      `,
      [tenantId, name],
    );
    await appendAuditLog(client, {
      tenantId,
      actorUserId,
      action: "partner_invitation.manual_partner.create",
      entityType: "organization",
      entityId: inserted.rows[0].organization_id,
      afterState: {
        organization_id: inserted.rows[0].organization_id,
        capacity_provider_id: inserted.rows[0].capacity_provider_id,
        company_name: name,
        source: "manual_partner_invitation",
      },
    });
    return inserted.rows[0].organization_id;
  }

  private async requireCurrentForemanMembership(client: PoolClient, tenantId: string, organizationId: string, workerId: string, crewId: string, membershipId?: string) {
    const values: unknown[] = [tenantId, organizationId, workerId, crewId];
    if (membershipId) values.push(membershipId);
    const result = await client.query(
      `
      SELECT pcm.id AS membership_id, pcm.membership_role, w.first_name || ' ' || w.last_name AS worker_name
      FROM partner_crew_memberships pcm
      JOIN workers w ON w.tenant_id = pcm.tenant_id AND w.id = pcm.worker_id
      JOIN crews c ON c.tenant_id = pcm.tenant_id AND c.id = pcm.crew_id
      WHERE pcm.tenant_id = $1
        AND pcm.organization_id = $2
        AND pcm.worker_id = $3
        AND pcm.crew_id = $4
        ${membershipId ? "AND pcm.id = $5" : ""}
        AND pcm.status = 'active'
        AND pcm.deleted_at IS NULL
        AND pcm.membership_role IN ('foreman','alternate_foreman')
        AND w.status = 'active'
        AND w.review_status = 'approved'
        AND w.deleted_at IS NULL
        AND c.lifecycle_status = 'active'
        AND c.deleted_at IS NULL
      LIMIT 1
      `,
      values,
    );
    if (!result.rows[0]) throw new ForbiddenException("Current approved Foreman/Crew relationship is required");
    return result.rows[0];
  }

  private async invitationById(client: PoolClient, tenantId: string, id: string, forUpdate = false) {
    const result = await client.query<InvitationRow>(
      `
      SELECT i.*, o.name AS organization_name
      FROM partner_onboarding_invitations i
      JOIN organizations o ON o.tenant_id = i.tenant_id AND o.id = i.organization_id
      WHERE i.tenant_id = $1 AND i.id = $2
      ${forUpdate ? "FOR UPDATE OF i" : ""}
      `,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async invitationByToken(client: PoolClient, token: string, forUpdate = false) {
    const result = await client.query<InvitationRow>(
      `
      SELECT i.*, o.name AS organization_name
      FROM partner_onboarding_invitations i
      JOIN organizations o ON o.tenant_id = i.tenant_id AND o.id = i.organization_id
      WHERE i.token_hash = $1
      ${forUpdate ? "FOR UPDATE OF i" : ""}
      `,
      [this.hashToken(token)],
    );
    return result.rows[0] ?? null;
  }

  private async inquiryById(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query<InquiryRow>("SELECT * FROM partner_inquiries WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
    return result.rows[0] ?? null;
  }

  private requireAcceptableInvitation(row: InvitationRow | null): asserts row is InvitationRow {
    if (!row) throw new NotFoundException("Invitation not found");
    if (row.status !== "SENT") throw new ConflictException("Invitation is no longer active");
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new BadRequestException("Invitation has expired");
  }

  private createSessionToken(tenantId: string, userId: string, email: string) {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) throw new InternalServerErrorException("AUTH_JWT_SECRET is required to complete invitation acceptance");
    return createAuthToken({ tenant_id: tenantId, sub: userId, email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }, secret);
  }

  private safeInvitation(row: InvitationRow, organizationName?: string) {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      organization_id: row.organization_id,
      organization_name: organizationName,
      inquiry_id: row.inquiry_id,
      invitation_type: row.invitation_type,
      invitation_source: row.invitation_source,
      primary_contact_name: row.primary_contact_name,
      email: row.email,
      intended_role_key: row.intended_role_key,
      worker_id: row.worker_id,
      crew_id: row.crew_id,
      status: row.status,
      invited_by_user_id: row.invited_by_user_id,
      accepted_by_user_id: row.accepted_by_user_id,
      revoked_by_user_id: row.revoked_by_user_id,
      supersedes_invitation_id: row.supersedes_invitation_id,
      superseded_by_invitation_id: row.superseded_by_invitation_id,
      expires_at: row.expires_at,
      accepted_at: row.accepted_at,
      revoked_at: row.revoked_at,
      delivery_status: row.delivery_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private safeInquiry(row: InquiryRow) {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      company_name: row.company_name,
      contact_name: row.contact_name,
      email: row.email,
      phone: row.phone,
      territory: row.territory,
      capability: row.capability,
      crew_count: row.crew_count,
      availability: row.availability,
      equipment: row.equipment,
      experience_notes: row.experience_notes,
      source: row.source,
      status: row.status,
      owner_user_id: row.owner_user_id,
      territory_verified: row.territory_verified,
      capability_verified: row.capability_verified,
      crew_count_verified: row.crew_count_verified,
      availability_verified: row.availability_verified,
      equipment_verified: row.equipment_verified,
      qualification_decision: row.qualification_decision,
      qualified_organization_id: row.qualified_organization_id,
      potential_capacity_signal: row.potential_capacity_signal,
      contacted_at: row.contacted_at,
      qualified_at: row.qualified_at,
      invited_at: row.invited_at,
      converted_at: row.converted_at,
      closed_at: row.closed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private async recordInquiryEvent(client: PoolClient, tenantId: string, inquiryId: string, eventType: string, userId: string, summary: Record<string, unknown>, note: string | null) {
    await client.query(
      "INSERT INTO partner_inquiry_qualification_events (tenant_id, inquiry_id, event_type, safe_summary, created_by_user_id, note) VALUES ($1,$2,$3,$4,$5,$6)",
      [tenantId, inquiryId, eventType, summary, userId, note],
    );
  }

  private async resolvePublicInquiryTenant() {
    if (process.env.PUBLIC_PARTNER_INQUIRY_TENANT_ID) return process.env.PUBLIC_PARTNER_INQUIRY_TENANT_ID;
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("PUBLIC_PARTNER_INQUIRY_TENANT_ID is required for public inquiry intake");
    const result = await this.pool.query<{ id: string }>("SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1");
    if (!result.rows[0]) throw new InternalServerErrorException("No tenant is configured for public inquiry intake");
    return result.rows[0].id;
  }

  private async requirePublicInquiryWithinLimit(client: PoolClient, tenantId: string, email: string, ipHash: string | null) {
    const result = await client.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM partner_inquiries
      WHERE tenant_id = $1
        AND created_at > now() - interval '1 hour'
        AND (email = $2 OR ($3::text IS NOT NULL AND source_ip_hash = $3))
      `,
      [tenantId, email, ipHash],
    );
    if (Number(result.rows[0]?.count ?? 0) >= publicInquiryHourlyLimit) throw new BadRequestException("Inquiry intake is temporarily unavailable");
  }

  private async requireTenantUserByUserId(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query("SELECT id FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' AND deleted_at IS NULL", [tenantId, userId]);
    if (!result.rows[0]) throw new NotFoundException("Tenant user not found");
  }

  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private requiredString(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private requiredUuid(value: unknown, message: string) {
    const text = this.requiredString(value, message);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new BadRequestException(message);
    return text;
  }

  private limitedString(value: unknown, message: string, max: number) {
    const text = this.requiredString(value, message);
    if (text.length > max) throw new BadRequestException(`${message.replace(" is required", "")} is too long`);
    return text;
  }

  private requiredPassword(value: unknown) {
    const password = this.requiredString(value, "password is required");
    const error = validatePassword(password);
    if (error) throw new BadRequestException(error);
    return password;
  }

  private optionalLimitedString(value: unknown, max: number) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("value must be a string");
    const text = value.trim();
    if (!text) return null;
    if (text.length > max) throw new BadRequestException("value is too long");
    return text;
  }

  private optionalNonNegativeInteger(value: unknown, field: string) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new BadRequestException(`${field} must be a non-negative integer`);
    return number;
  }

  private optionalBoolean(value: unknown) {
    return typeof value === "boolean" ? value : null;
  }

  private allowedUpper(value: unknown, allowed: Set<string>, message: string) {
    const text = this.requiredString(value, message).toUpperCase();
    if (!allowed.has(text)) throw new BadRequestException(message);
    return text;
  }

  private validEmail(value: string) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }

  private hashToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private hashNullable(value: string | null) {
    return value ? crypto.createHash("sha256").update(value).digest("hex") : null;
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}
