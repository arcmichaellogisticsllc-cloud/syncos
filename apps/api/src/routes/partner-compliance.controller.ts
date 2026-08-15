import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
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
const profileStatuses = new Set(["draft", "submitted", "under_review", "verified", "returned", "rejected"]);
const taxStatuses = new Set(["submitted", "under_review", "verified", "returned", "rejected"]);
const paymentStatuses = new Set(["submitted", "under_review", "active", "hold", "rejected"]);
const policyStatuses = new Set(["draft", "submitted", "under_review", "verified", "returned", "rejected", "expired"]);
const evidenceCategories = new Set([
  "partner_w9",
  "partner_ach_authorization",
  "partner_bank_verification",
  "partner_coi",
  "partner_insurance_endorsement",
  "partner_insurance_policy_evidence",
]);
const policyTypes = new Set([
  "commercial_general_liability",
  "commercial_auto",
  "umbrella_excess",
  "workers_compensation",
  "employers_liability",
]);
const reviewActions = new Set(["under_review", "verified", "returned", "rejected", "hold"]);

type PartnerScopeRow = QueryResultRow & {
  user_id: string;
  display_name: string;
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
  user: { id: string; display_name: string };
  tenant_id: string;
  persona: "partner_admin" | "partner_foreman";
  organization: { id: string; name: string; status: string };
  capacityProvider: { id: string; name: string; provider_type: string; status: string; verification_status: string; contract_status: string };
};

type DbRow = QueryResultRow & { id: string; tenant_id: string; organization_id: string; status: string };
type EvidenceRow = DbRow & {
  category: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  checksum: string | null;
  restricted: boolean;
  uploaded_by_user_id: string | null;
  uploaded_at: Date;
  verified_by_user_id: string | null;
  verified_at: Date | null;
  external_return_reason: string | null;
  internal_review_notes: string | null;
};

@Controller("partner-compliance")
export class PartnerComplianceController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  @Get("me/summary")
  @RequirePermission("partner_compliance.summary.read")
  async ownSummary(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      const summary = await this.evaluateCompliance(client, context.tenant_id, context.organization.id);
      if (context.persona === "partner_foreman") {
        return {
          organization_id: context.organization.id,
          overall_status: summary.overall_status,
          blocker_categories: summary.blockers.map((blocker) => blocker.category),
          evaluated_at: summary.evaluated_at,
        };
      }
      return summary;
    });
  }

  @Get("me/company-profile")
  @RequirePermission("partner_compliance.profile.read")
  async ownCompanyProfile(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      return this.safeCompanyProfile(await this.currentRow(client, "partner_company_profiles", context.tenant_id, context.organization.id));
    });
  }

  @Post("me/company-profile")
  @RequirePermission("partner_compliance.profile.submit")
  async submitCompanyProfile(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      const values = this.companyProfileValues(body, context, request.auth.userId);
      return this.writeWithClient(client, request, "partner_company_profile.submit", "partner_company_profile.submitted", "partner_company_profile", async (writeClient) => {
        const before = await this.currentRow(writeClient, "partner_company_profiles", context.tenant_id, context.organization.id);
        const after = await this.upsertCurrent(writeClient, "partner_company_profiles", context.tenant_id, context.organization.id, before, values);
        return { entityType: "partner_company_profile", entityId: after.id, beforeState: before ?? undefined, afterState: this.safeCompanyProfile(after) };
      });
    });
  }

  @Get("me/w9")
  @RequirePermission("partner_compliance.w9.read")
  async ownW9(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      return this.safeTaxProfile(await this.currentRow(client, "partner_tax_profiles", context.tenant_id, context.organization.id));
    });
  }

  @Post("me/w9")
  @RequirePermission("partner_compliance.w9.submit")
  async submitW9(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      this.rejectSensitiveBody(body);
      return this.writeWithClient(client, request, "partner_w9.submit", "partner_w9.submitted", "partner_tax_profile", async (writeClient) => {
        const evidence = body.evidence ? await this.createEvidence(writeClient, context, request.auth.userId, "partner_w9", body.evidence, "partner_tax_profile", null) : null;
        const before = await this.currentRow(writeClient, "partner_tax_profiles", context.tenant_id, context.organization.id);
        const values = this.taxProfileValues(body, context, request.auth.userId, evidence?.id ?? before?.evidence_id ?? null);
        const after = await this.upsertCurrent(writeClient, "partner_tax_profiles", context.tenant_id, context.organization.id, before, values);
        if (evidence) await this.linkEvidence(writeClient, context.tenant_id, evidence.id, "partner_tax_profile", after.id);
        return {
          entityType: "partner_tax_profile",
          entityId: after.id,
          beforeState: before ?? undefined,
          afterState: this.safeTaxProfile(after),
          additionalEvents: evidence ? [this.evidenceEvent(evidence, request.auth.userId)] : [],
        };
      });
    });
  }

  @Get("me/payment-profile")
  @RequirePermission("partner_compliance.payment.read")
  async ownPaymentProfile(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      return this.safePaymentProfile(await this.currentRow(client, "partner_payment_profiles", context.tenant_id, context.organization.id));
    });
  }

  @Post("me/payment-profile")
  @RequirePermission("partner_compliance.payment.submit")
  async submitPaymentProfile(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      this.rejectSensitiveBody(body);
      return this.writeWithClient(client, request, "partner_payment_profile.submit", "partner_payment_profile.submitted", "partner_payment_profile", async (writeClient) => {
        const achEvidence = body.ach_evidence
          ? await this.createEvidence(writeClient, context, request.auth.userId, "partner_ach_authorization", body.ach_evidence, "partner_payment_profile", null)
          : null;
        const bankEvidence = body.bank_verification_evidence
          ? await this.createEvidence(writeClient, context, request.auth.userId, "partner_bank_verification", body.bank_verification_evidence, "partner_payment_profile", null)
          : null;
        const before = await this.currentRow(writeClient, "partner_payment_profiles", context.tenant_id, context.organization.id);
        const values = this.paymentProfileValues(body, context, request.auth.userId, achEvidence?.id ?? before?.ach_evidence_id ?? null, bankEvidence?.id ?? before?.bank_verification_evidence_id ?? null);
        const after = await this.upsertCurrent(writeClient, "partner_payment_profiles", context.tenant_id, context.organization.id, before, values);
        if (achEvidence) await this.linkEvidence(writeClient, context.tenant_id, achEvidence.id, "partner_payment_profile", after.id);
        if (bankEvidence) await this.linkEvidence(writeClient, context.tenant_id, bankEvidence.id, "partner_payment_profile", after.id);
        return {
          entityType: "partner_payment_profile",
          entityId: after.id,
          beforeState: before ?? undefined,
          afterState: this.safePaymentProfile(after),
          additionalEvents: [achEvidence, bankEvidence].filter(Boolean).map((evidence) => this.evidenceEvent(evidence as EvidenceRow, request.auth.userId)),
        };
      });
    });
  }

  @Get("me/insurance-policies")
  @RequirePermission("partner_compliance.insurance.read")
  async ownPolicies(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      return (await this.policyRows(client, context.tenant_id, context.organization.id)).map((row) => this.safePolicy(row));
    });
  }

  @Post("me/insurance-policies")
  @RequirePermission("partner_compliance.insurance.submit")
  async submitPolicy(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      this.rejectSpoofedOrganization(body, context.organization.id);
      const policyType = requireAllowed(body.policy_type, policyTypes, "policy_type");
      return this.writeWithClient(client, request, "partner_insurance_policy.submit", "partner_insurance_policy.submitted", "partner_insurance_policy", async (writeClient) => {
        const coiEvidence = body.coi_evidence
          ? await this.createEvidence(writeClient, context, request.auth.userId, "partner_coi", body.coi_evidence, "partner_insurance_policy", null)
          : null;
        const endorsementEvidence = body.endorsement_evidence
          ? await this.createEvidence(writeClient, context, request.auth.userId, "partner_insurance_endorsement", body.endorsement_evidence, "partner_insurance_policy", null)
          : null;
        const before = await this.currentPolicy(writeClient, context.tenant_id, context.organization.id, policyType);
        const values = this.policyValues(body, context, request.auth.userId, coiEvidence?.id ?? before?.coi_evidence_id ?? null, endorsementEvidence?.id ? [endorsementEvidence.id] : (before?.endorsement_evidence_ids ?? []));
        const after = await this.upsertCurrentPolicy(writeClient, context.tenant_id, context.organization.id, policyType, before, values);
        if (coiEvidence) await this.linkEvidence(writeClient, context.tenant_id, coiEvidence.id, "partner_insurance_policy", after.id);
        if (endorsementEvidence) await this.linkEvidence(writeClient, context.tenant_id, endorsementEvidence.id, "partner_insurance_policy", after.id);
        return {
          entityType: "partner_insurance_policy",
          entityId: after.id,
          beforeState: before ?? undefined,
          afterState: this.safePolicy(after),
          additionalEvents: [coiEvidence, endorsementEvidence].filter(Boolean).map((evidence) => this.evidenceEvent(evidence as EvidenceRow, request.auth.userId)),
        };
      });
    });
  }

  @Get("me/evidence/:evidenceId")
  @RequirePermission("partner_compliance.evidence.read")
  async ownEvidence(@Req() request: AuthenticatedRequest, @Param("evidenceId") evidenceId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const context = await this.resolvePartnerContext(client, request, query.organization_id);
      if (context.persona !== "partner_admin") throw new ForbiddenException("Partner Foreman cannot access restricted evidence");
      const evidence = await this.requireEvidence(client, context.tenant_id, context.organization.id, evidenceId);
      await this.auditEvidenceAccess(client, request, evidence);
      return this.safeEvidence(evidence);
    });
  }

  @Get("organizations/:organizationId/summary")
  @RequirePermission("partner_compliance.review")
  async internalSummary(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string) {
    return this.withClient(async (client) => {
      await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_compliance.review");
      return this.evaluateCompliance(client, request.auth.tenantId, organizationId);
    });
  }

  @Post("organizations/:organizationId/company-profile/review")
  @RequirePermission("partner_compliance.review")
  async reviewCompanyProfile(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Body() body: Record<string, unknown>) {
    return this.reviewCurrentRecord(request, organizationId, "partner_company_profiles", "partner_company_profile", "partner_company_profile", body);
  }

  @Post("organizations/:organizationId/w9/review")
  @RequirePermission("partner_compliance.review")
  async reviewW9(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Body() body: Record<string, unknown>) {
    return this.reviewCurrentRecord(request, organizationId, "partner_tax_profiles", "partner_tax_profile", "partner_w9", body);
  }

  @Post("organizations/:organizationId/payment-profile/review")
  @RequirePermission("partner_compliance.review")
  async reviewPaymentProfile(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Body() body: Record<string, unknown>) {
    return this.reviewCurrentRecord(request, organizationId, "partner_payment_profiles", "partner_payment_profile", "partner_payment_profile", body);
  }

  @Post("organizations/:organizationId/insurance-policies/:policyId/review")
  @RequirePermission("partner_compliance.review")
  async reviewInsurancePolicy(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("policyId") policyId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_compliance.review");
      const action = this.reviewAction(body);
      return this.writeWithClient(client, request, "partner_insurance_policy.review", this.reviewEvent("partner_insurance_policy", action), "partner_insurance_policy", async (writeClient) => {
        const before = await this.requirePolicyById(writeClient, request.auth.tenantId, organizationId, policyId);
        const after = await this.updateReviewState(writeClient, "partner_insurance_policies", request.auth.tenantId, before.id, action, request.auth.userId, body);
        return { entityType: "partner_insurance_policy", entityId: after.id, beforeState: this.safePolicy(before) ?? undefined, afterState: this.safePolicy(after) };
      });
    });
  }

  @Get("organizations/:organizationId/evidence/:evidenceId")
  @RequirePermission("partner_compliance.evidence.review")
  async internalEvidence(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("evidenceId") evidenceId: string) {
    return this.withClient(async (client) => {
      await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_compliance.evidence.review");
      const evidence = await this.requireEvidence(client, request.auth.tenantId, organizationId, evidenceId);
      await this.auditEvidenceAccess(client, request, evidence);
      return this.safeEvidence(evidence, true);
    });
  }

  private async reviewCurrentRecord(request: AuthenticatedRequest, organizationId: string, table: string, entityType: string, eventPrefix: string, body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalPartnerOrganization(client, request, organizationId, "partner_compliance.review");
      const action = this.reviewAction(body);
      return this.writeWithClient(client, request, `${eventPrefix}.review`, this.reviewEvent(eventPrefix, action), entityType, async (writeClient) => {
        const before = await this.requireCurrentRow(writeClient, table, request.auth.tenantId, organizationId);
        const after = await this.updateReviewState(writeClient, table, request.auth.tenantId, before.id, action, request.auth.userId, body);
        return { entityType, entityId: after.id, beforeState: this.safeRecord(table, before) ?? undefined, afterState: this.safeRecord(table, after) };
      });
    });
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
      user: { id: first.user_id, display_name: first.display_name },
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
      SELECT u.id AS user_id, u.display_name, r.system_key AS role_key, o.id AS organization_id, o.name AS organization_name,
             o.status AS organization_status, cp.id AS capacity_provider_id, cp.name AS capacity_provider_name,
             cp.provider_type, cp.status AS provider_status, cp.verification_status, cp.contract_status
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

  private companyProfileValues(body: Record<string, unknown>, context: PartnerContext, userId: string) {
    const status = body.status === undefined ? "submitted" : requireAllowed(body.status, profileStatuses, "status");
    if (status === "verified") throw new ForbiddenException("Partner users cannot verify company profile");
    return {
      capacity_provider_id: context.capacityProvider.id,
      legal_business_name: requireString(body.legal_business_name, "legal_business_name is required"),
      dba_name: this.optionalString(body.dba_name),
      state_of_formation: this.optionalString(body.state_of_formation),
      entity_type: this.optionalString(body.entity_type),
      business_address: this.optionalObject(body.business_address),
      primary_business_phone: this.optionalString(body.primary_business_phone),
      primary_business_email: this.optionalString(body.primary_business_email),
      primary_contact_name: this.optionalString(body.primary_contact_name),
      primary_contact_email: this.optionalString(body.primary_contact_email),
      primary_contact_phone: this.optionalString(body.primary_contact_phone),
      settlement_contact_name: this.optionalString(body.settlement_contact_name),
      settlement_contact_email: this.optionalString(body.settlement_contact_email),
      settlement_contact_phone: this.optionalString(body.settlement_contact_phone),
      compliance_contact_name: this.optionalString(body.compliance_contact_name),
      compliance_contact_email: this.optionalString(body.compliance_contact_email),
      compliance_contact_phone: this.optionalString(body.compliance_contact_phone),
      status,
      submitted_by_user_id: userId,
      submitted_at: new Date(),
      reviewed_by_user_id: null,
      reviewed_at: null,
      external_return_reason: null,
      internal_review_notes: null,
      last_material_change_at: new Date(),
      updated_at: new Date(),
    };
  }

  private taxProfileValues(body: Record<string, unknown>, context: PartnerContext, userId: string, evidenceId: string | null) {
    const status = body.status === undefined ? "submitted" : requireAllowed(body.status, taxStatuses, "status");
    if (status === "verified") throw new ForbiddenException("Partner users cannot verify W-9");
    return {
      capacity_provider_id: context.capacityProvider.id,
      legal_name_on_w9: requireString(body.legal_name_on_w9, "legal_name_on_w9 is required"),
      dba_name_on_w9: this.optionalString(body.dba_name_on_w9),
      federal_tax_classification: requireString(body.federal_tax_classification, "federal_tax_classification is required"),
      tin_type: requireAllowed(body.tin_type, new Set(["ein", "ssn"]), "tin_type"),
      tin_last_four: this.lastFour(body.tin_last_four),
      signed_date: this.optionalDate(body.signed_date),
      received_date: this.optionalDate(body.received_date) ?? new Date(),
      status,
      evidence_id: evidenceId,
      submitted_by_user_id: userId,
      submitted_at: new Date(),
      verified_by_user_id: null,
      verified_at: null,
      external_return_reason: null,
      internal_review_notes: null,
      updated_at: new Date(),
    };
  }

  private paymentProfileValues(body: Record<string, unknown>, context: PartnerContext, userId: string, achEvidenceId: string | null, bankEvidenceId: string | null) {
    const status = body.status === undefined ? "submitted" : requireAllowed(body.status, paymentStatuses, "status");
    if (status === "active") throw new ForbiddenException("Partner users cannot verify payment profile");
    return {
      capacity_provider_id: context.capacityProvider.id,
      primary_payment_method: "priority_passport",
      priority_passport_status: requireAllowed(body.priority_passport_status ?? "pending", new Set(["not_started", "pending", "active", "hold"]), "priority_passport_status"),
      provider_reference: this.optionalString(body.provider_reference),
      account_last_four: body.account_last_four === undefined ? null : this.lastFour(body.account_last_four),
      card_last_four: body.card_last_four === undefined ? null : this.lastFour(body.card_last_four),
      enrollment_contact_name: this.optionalString(body.enrollment_contact_name),
      enrollment_contact_email: this.optionalString(body.enrollment_contact_email),
      enrollment_contact_phone: this.optionalString(body.enrollment_contact_phone),
      status,
      backup_ach_status: requireAllowed(body.backup_ach_status ?? "not_provided", new Set(["not_provided", "submitted", "under_review", "verified", "rejected", "superseded"]), "backup_ach_status"),
      bank_display_name: this.optionalString(body.bank_display_name),
      account_type: body.account_type === undefined ? null : requireAllowed(body.account_type, new Set(["checking", "savings", "business_checking", "other"]), "account_type"),
      ach_evidence_id: achEvidenceId,
      bank_verification_evidence_id: bankEvidenceId,
      submitted_by_user_id: userId,
      submitted_at: new Date(),
      verified_by_user_id: null,
      verified_at: null,
      hold_reason: null,
      external_return_reason: null,
      internal_review_notes: null,
      updated_at: new Date(),
    };
  }

  private policyValues(body: Record<string, unknown>, context: PartnerContext, userId: string, coiEvidenceId: string | null, endorsementEvidenceIds: string[]) {
    const status = body.status === undefined ? "submitted" : requireAllowed(body.status, policyStatuses, "status");
    if (status === "verified") throw new ForbiddenException("Partner users cannot verify insurance policy");
    const effectiveDate = this.requiredDate(body.effective_date, "effective_date is required");
    const expirationDate = this.requiredDate(body.expiration_date, "expiration_date is required");
    if (new Date(expirationDate).getTime() < new Date(effectiveDate).getTime()) {
      throw new BadRequestException("expiration_date must be on or after effective_date");
    }
    return {
      capacity_provider_id: context.capacityProvider.id,
      policy_type: requireAllowed(body.policy_type, policyTypes, "policy_type"),
      carrier: requireString(body.carrier, "carrier is required"),
      policy_reference: this.optionalString(body.policy_reference),
      effective_date: effectiveDate,
      expiration_date: expirationDate,
      occurrence_limit_cents: this.optionalMoney(body.occurrence_limit_cents),
      general_aggregate_cents: this.optionalMoney(body.general_aggregate_cents),
      products_completed_operations_aggregate_cents: this.optionalMoney(body.products_completed_operations_aggregate_cents),
      combined_single_auto_limit_cents: this.optionalMoney(body.combined_single_auto_limit_cents),
      employer_liability_accident_limit_cents: this.optionalMoney(body.employer_liability_accident_limit_cents),
      employer_liability_disease_each_employee_limit_cents: this.optionalMoney(body.employer_liability_disease_each_employee_limit_cents),
      employer_liability_disease_policy_limit_cents: this.optionalMoney(body.employer_liability_disease_policy_limit_cents),
      workers_compensation_statutory: Boolean(body.workers_compensation_statutory),
      owned_auto_covered: this.optionalBoolean(body.owned_auto_covered),
      hired_rented_auto_covered: this.optionalBoolean(body.hired_rented_auto_covered),
      non_owned_auto_covered: this.optionalBoolean(body.non_owned_auto_covered),
      additional_insured_status: requireAllowed(body.additional_insured_status ?? "not_provided", new Set(["not_provided", "submitted", "verified", "not_required"]), "additional_insured_status"),
      waiver_of_subrogation_status: requireAllowed(body.waiver_of_subrogation_status ?? "not_provided", new Set(["not_provided", "submitted", "verified", "not_required"]), "waiver_of_subrogation_status"),
      primary_non_contributory_status: requireAllowed(body.primary_non_contributory_status ?? "not_provided", new Set(["not_provided", "submitted", "verified", "not_required"]), "primary_non_contributory_status"),
      cancellation_notice_status: this.optionalString(body.cancellation_notice_status),
      coi_evidence_id: coiEvidenceId,
      endorsement_evidence_ids: endorsementEvidenceIds,
      status,
      submitted_by_user_id: userId,
      submitted_at: new Date(),
      verified_by_user_id: null,
      verified_at: null,
      external_return_reason: null,
      internal_review_notes: null,
      updated_at: new Date(),
    };
  }

  private async upsertCurrent(client: PoolClient, table: string, tenantId: string, organizationId: string, before: DbRow | null, values: Record<string, unknown>) {
    if (before) {
      if (before.status === "verified") {
        return this.supersedeCurrent(client, table, tenantId, organizationId, before, values);
      }
      const nextVersion = before.status === "verified" ? Number(before.version ?? 1) + 1 : Number(before.version ?? 1);
      const result = await client.query(
        `
        UPDATE ${table}
        SET ${Object.keys(values).map((key, index) => `${key} = $${index + 4}`).join(", ")}, version = $${Object.keys(values).length + 4}
        WHERE tenant_id = $1 AND organization_id = $2 AND id = $3
        RETURNING *
        `,
        [tenantId, organizationId, before.id, ...Object.values(values), nextVersion],
      );
      return result.rows[0];
    }
    const columns = ["tenant_id", "organization_id", ...Object.keys(values)];
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      [tenantId, organizationId, ...Object.values(values)],
    );
    return result.rows[0];
  }

  private async upsertCurrentPolicy(client: PoolClient, tenantId: string, organizationId: string, policyType: string, before: DbRow | null, values: Record<string, unknown>) {
    if (before) return this.upsertCurrentById(client, "partner_insurance_policies", tenantId, organizationId, before.id, before, values);
    const columns = ["tenant_id", "organization_id", ...Object.keys(values)];
    const result = await client.query(
      `INSERT INTO partner_insurance_policies (${columns.join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
      [tenantId, organizationId, ...Object.values(values)],
    );
    return result.rows[0];
  }

  private async upsertCurrentById(client: PoolClient, table: string, tenantId: string, organizationId: string, id: string, before: DbRow, values: Record<string, unknown>) {
    if (before.status === "verified") {
      return this.supersedeCurrent(client, table, tenantId, organizationId, before, values);
    }
    const nextVersion = before.status === "verified" ? Number(before.version ?? 1) + 1 : Number(before.version ?? 1);
    const result = await client.query(
      `
      UPDATE ${table}
      SET ${Object.keys(values).map((key, index) => `${key} = $${index + 4}`).join(", ")}, version = $${Object.keys(values).length + 4}
      WHERE tenant_id = $1 AND organization_id = $2 AND id = $3
      RETURNING *
      `,
      [tenantId, organizationId, id, ...Object.values(values), nextVersion],
    );
    return result.rows[0];
  }

  private async supersedeCurrent(client: PoolClient, table: string, tenantId: string, organizationId: string, before: DbRow, values: Record<string, unknown>) {
    const link = this.supersessionColumns(table);
    if (!link) throw new BadRequestException("unsupported compliance supersession table");
    const nextVersion = Number(before.version ?? 1) + 1;
    await client.query(
      `UPDATE ${table} SET status = 'superseded', updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND id = $3`,
      [tenantId, organizationId, before.id],
    );
    const insertValues = { ...values, version: nextVersion, [link.supersedes]: before.id };
    const columns = ["tenant_id", "organization_id", ...Object.keys(insertValues)];
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
      [tenantId, organizationId, ...Object.values(insertValues)],
    );
    const after = result.rows[0];
    await client.query(
      `UPDATE ${table} SET ${link.supersededBy} = $4, updated_at = now() WHERE tenant_id = $1 AND organization_id = $2 AND id = $3`,
      [tenantId, organizationId, before.id, after.id],
    );
    return after;
  }

  private supersessionColumns(table: string) {
    const columns: Record<string, { supersedes: string; supersededBy: string }> = {
      partner_company_profiles: { supersedes: "supersedes_profile_id", supersededBy: "superseded_by_profile_id" },
      partner_tax_profiles: { supersedes: "supersedes_tax_profile_id", supersededBy: "superseded_by_tax_profile_id" },
      partner_payment_profiles: { supersedes: "supersedes_payment_profile_id", supersededBy: "superseded_by_payment_profile_id" },
      partner_insurance_policies: { supersedes: "supersedes_policy_id", supersededBy: "superseded_by_policy_id" },
    };
    return columns[table];
  }

  private async updateReviewState(client: PoolClient, table: string, tenantId: string, id: string, action: string, reviewerId: string, body: Record<string, unknown>) {
    const status = table === "partner_payment_profiles" && action === "verified" ? "active" : action === "hold" ? "hold" : action;
    if (status === "hold" && table !== "partner_payment_profiles") throw new BadRequestException("hold applies only to payment profiles");
    const externalReason = this.optionalString(body.external_return_reason);
    const internalNotes = this.optionalString(body.internal_review_notes);
    if (table === "partner_company_profiles") {
      const result = await client.query(
        `
        UPDATE partner_company_profiles
        SET status = $3,
            reviewed_by_user_id = $4,
            reviewed_at = now(),
            external_return_reason = $5,
            internal_review_notes = $6,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
        `,
        [tenantId, id, status, reviewerId, externalReason, internalNotes],
      );
      return result.rows[0];
    }
    if (table === "partner_payment_profiles") {
      const result = await client.query(
        `
        UPDATE partner_payment_profiles
        SET status = $3,
            verified_by_user_id = CASE WHEN $3 = 'active' THEN $4 ELSE verified_by_user_id END,
            verified_at = CASE WHEN $3 = 'active' THEN now() ELSE verified_at END,
            priority_passport_status = CASE WHEN $3 = 'active' THEN 'active' ELSE priority_passport_status END,
            hold_reason = CASE WHEN $3 = 'hold' THEN $5 ELSE hold_reason END,
            external_return_reason = $5,
            internal_review_notes = $6,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
        `,
        [tenantId, id, status, reviewerId, externalReason, internalNotes],
      );
      return result.rows[0];
    }
    const result = await client.query(
      `
      UPDATE ${table}
      SET status = $3,
          verified_by_user_id = CASE WHEN $3 = 'verified' THEN $4 ELSE verified_by_user_id END,
          verified_at = CASE WHEN $3 = 'verified' THEN now() ELSE verified_at END,
          external_return_reason = $5,
          internal_review_notes = $6,
          updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *
      `,
      [tenantId, id, status, reviewerId, externalReason, internalNotes],
    );
    return result.rows[0];
  }

  private async createEvidence(client: PoolClient, context: PartnerContext, userId: string, category: string, raw: unknown, relatedEntityType: string, relatedEntityId: string | null) {
    if (!evidenceCategories.has(category)) throw new BadRequestException("unsupported evidence category");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("evidence metadata is required");
    const body = raw as Record<string, unknown>;
    this.rejectSensitiveBody(body);
    const fileName = requireString(body.file_name, "evidence.file_name is required");
    const mimeType = requireString(body.mime_type ?? body.content_type, "evidence.mime_type is required");
    const sizeBytes = Number(body.size_bytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new BadRequestException("evidence.size_bytes must be a non-negative number");
    if (body.storage_provider !== undefined || body.bucket !== undefined || body.object_key !== undefined) {
      throw new BadRequestException("storage references must be created by the file service");
    }
    for (const value of [fileName, mimeType, body.checksum]) this.rejectSensitiveString(value);
    const result = await client.query<EvidenceRow>(
      `
      INSERT INTO partner_restricted_evidence (
        tenant_id, organization_id, capacity_provider_id, category, related_entity_type, related_entity_id,
        file_name, mime_type, size_bytes, checksum, storage_provider, bucket, object_key, uploaded_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
      `,
      [
        context.tenant_id,
        context.organization.id,
        context.capacityProvider.id,
        category,
        relatedEntityType,
        relatedEntityId,
        fileName,
        mimeType,
        sizeBytes,
        this.optionalString(body.checksum),
        null,
        null,
        null,
        userId,
      ],
    );
    return result.rows[0];
  }

  private async linkEvidence(client: PoolClient, tenantId: string, evidenceId: string, relatedEntityType: string, relatedEntityId: string) {
    await client.query(
      "UPDATE partner_restricted_evidence SET related_entity_type = $3, related_entity_id = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2",
      [tenantId, evidenceId, relatedEntityType, relatedEntityId],
    );
  }

  private evidenceEvent(evidence: EvidenceRow, actorUserId: string) {
    return {
      action: "restricted_evidence.upload",
      aggregateType: "partner_restricted_evidence",
      entityType: "partner_restricted_evidence",
      entityId: evidence.id,
      eventType: "restricted_evidence.uploaded",
      afterState: { ...this.safeEvidence(evidence), actor_user_id: actorUserId },
    };
  }

  private async currentRow(client: PoolClient, table: string, tenantId: string, organizationId: string) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status <> 'superseded' ORDER BY updated_at DESC LIMIT 1`, [tenantId, organizationId]);
    return result.rows[0] ?? null;
  }

  private async requireCurrentRow(client: PoolClient, table: string, tenantId: string, organizationId: string) {
    const row = await this.currentRow(client, table, tenantId, organizationId);
    if (!row) throw new NotFoundException("compliance record not found");
    return row;
  }

  private async currentPolicy(client: PoolClient, tenantId: string, organizationId: string, policyType: string) {
    const result = await client.query(
      "SELECT * FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND policy_type = $3 AND deleted_at IS NULL AND status <> 'superseded' LIMIT 1",
      [tenantId, organizationId, policyType],
    );
    return result.rows[0] ?? null;
  }

  private async policyRows(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      "SELECT * FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status <> 'superseded' ORDER BY policy_type",
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async requirePolicyById(client: PoolClient, tenantId: string, organizationId: string, policyId: string) {
    const result = await client.query("SELECT * FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL LIMIT 1", [tenantId, organizationId, policyId]);
    if (!result.rows[0]) throw new NotFoundException("insurance policy not found");
    return result.rows[0];
  }

  private async requireEvidence(client: PoolClient, tenantId: string, organizationId: string, evidenceId: string) {
    const result = await client.query<EvidenceRow>(
      "SELECT * FROM partner_restricted_evidence WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL LIMIT 1",
      [tenantId, organizationId, evidenceId],
    );
    if (!result.rows[0]) throw new NotFoundException("restricted evidence not found");
    return result.rows[0];
  }

  private async evaluateCompliance(client: PoolClient, tenantId: string, organizationId: string) {
    const [profile, tax, payment, policies] = await Promise.all([
      this.currentRow(client, "partner_company_profiles", tenantId, organizationId),
      this.currentRow(client, "partner_tax_profiles", tenantId, organizationId),
      this.currentRow(client, "partner_payment_profiles", tenantId, organizationId),
      this.policyRows(client, tenantId, organizationId),
    ]);
    const blockers: Array<{ key: string; category: string; message: string }> = [];
    if (!profile) blockers.push(this.blocker("company_profile_missing", "company_profile", "Company profile has not been submitted"));
    else if (profile.status !== "verified") blockers.push(this.blocker(`company_profile_${profile.status}`, "company_profile", "Company profile is not verified"));
    if (!tax) blockers.push(this.blocker("w9_missing", "w9", "W-9 has not been submitted"));
    else if (tax.status === "rejected") blockers.push(this.blocker("w9_rejected", "w9", "W-9 was rejected"));
    else if (tax.status !== "verified") blockers.push(this.blocker("w9_unverified", "w9", "W-9 is not verified"));
    if (!payment) blockers.push(this.blocker("payment_profile_incomplete", "payment", "Payment profile has not been submitted"));
    else if (payment.status === "hold") blockers.push(this.blocker("payment_profile_on_hold", "payment", "Payment profile is on hold"));
    else if (payment.status !== "active" || payment.priority_passport_status !== "active") blockers.push(this.blocker("payment_profile_unverified", "payment", "Priority Passport payment readiness is not active"));
    const policyByType = new Map(policies.map((policy) => [policy.policy_type, policy]));
    for (const type of policyTypes) {
      const policy = policyByType.get(type);
      if (!policy) {
        blockers.push(this.blocker("required_policy_missing", "insurance", `${type} policy is missing`));
        continue;
      }
      blockers.push(...this.policyBlockers(policy));
    }
    const hasRecords = Boolean(profile || tax || payment || policies.length);
    return {
      organization_id: organizationId,
      overall_status: blockers.length === 0 ? "ready" : hasRecords ? "blocked" : "not_started",
      profile_status: profile?.status ?? "not_started",
      w9_status: tax?.status ?? "not_submitted",
      payment_profile_status: payment?.status ?? "not_started",
      insurance_status: blockers.some((blocker) => blocker.category === "insurance") ? "blocked" : "ready",
      blockers,
      warnings: [],
      evaluated_at: new Date().toISOString(),
    };
  }

  private policyBlockers(policy: QueryResultRow) {
    const blockers: Array<{ key: string; category: string; message: string }> = [];
    const expired = new Date(String(policy.expiration_date)).getTime() < Date.now();
    if (expired || policy.status === "expired") blockers.push(this.blocker("policy_expired", "insurance", `${policy.policy_type} policy is expired`));
    if (policy.status !== "verified") blockers.push(this.blocker("policy_unverified", "insurance", `${policy.policy_type} policy is not verified`));
    const dollars = (value: unknown) => Number(value ?? 0) / 100;
    if (policy.policy_type === "commercial_general_liability") {
      if (dollars(policy.occurrence_limit_cents) < 1_000_000 || dollars(policy.general_aggregate_cents) < 2_000_000 || dollars(policy.products_completed_operations_aggregate_cents) < 2_000_000) blockers.push(this.blocker("coverage_limit_insufficient", "insurance", "Commercial General Liability limits are insufficient"));
    }
    if (policy.policy_type === "commercial_auto") {
      if (dollars(policy.combined_single_auto_limit_cents) < 1_000_000) blockers.push(this.blocker("coverage_limit_insufficient", "insurance", "Commercial Auto limit is insufficient"));
      if (policy.hired_rented_auto_covered !== true) blockers.push(this.blocker("hired_auto_coverage_missing", "insurance", "Hired/rented auto coverage is missing"));
    }
    if (policy.policy_type === "umbrella_excess" && (dollars(policy.occurrence_limit_cents) < 2_000_000 || dollars(policy.general_aggregate_cents) < 2_000_000)) blockers.push(this.blocker("coverage_limit_insufficient", "insurance", "Umbrella/Excess limits are insufficient"));
    if (policy.policy_type === "workers_compensation" && policy.workers_compensation_statutory !== true) blockers.push(this.blocker("coverage_limit_insufficient", "insurance", "Workers Compensation statutory coverage is missing"));
    if (policy.policy_type === "employers_liability" && (dollars(policy.employer_liability_accident_limit_cents) < 500_000 || dollars(policy.employer_liability_disease_each_employee_limit_cents) < 500_000 || dollars(policy.employer_liability_disease_policy_limit_cents) < 500_000)) blockers.push(this.blocker("coverage_limit_insufficient", "insurance", "Employer's Liability limits are insufficient"));
    if (["commercial_general_liability", "commercial_auto", "umbrella_excess"].includes(policy.policy_type)) {
      if (policy.additional_insured_status !== "verified") blockers.push(this.blocker("additional_insured_missing", "insurance", `${policy.policy_type} Additional Insured endorsement is missing`));
      if (policy.waiver_of_subrogation_status !== "verified") blockers.push(this.blocker("waiver_of_subrogation_missing", "insurance", `${policy.policy_type} Waiver of Subrogation is missing`));
      if (policy.primary_non_contributory_status !== "verified") blockers.push(this.blocker("primary_non_contributory_missing", "insurance", `${policy.policy_type} Primary/Non-Contributory status is missing`));
    }
    return blockers;
  }

  private blocker(key: string, category: string, message: string) {
    return { key, category, message };
  }

  private safeRecord(table: string, row: QueryResultRow | null) {
    if (table === "partner_company_profiles") return this.safeCompanyProfile(row);
    if (table === "partner_tax_profiles") return this.safeTaxProfile(row);
    if (table === "partner_payment_profiles") return this.safePaymentProfile(row);
    return this.safePolicy(row);
  }

  private safeCompanyProfile(row: QueryResultRow | null) {
    if (!row) return null;
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "legal_business_name", "dba_name", "state_of_formation", "entity_type", "business_address", "primary_business_phone", "primary_business_email", "primary_contact_name", "primary_contact_email", "primary_contact_phone", "settlement_contact_name", "settlement_contact_email", "settlement_contact_phone", "compliance_contact_name", "compliance_contact_email", "compliance_contact_phone", "status", "version", "submitted_at", "reviewed_at", "external_return_reason", "last_material_change_at", "created_at", "updated_at"]);
  }

  private safeTaxProfile(row: QueryResultRow | null) {
    if (!row) return null;
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "legal_name_on_w9", "dba_name_on_w9", "federal_tax_classification", "tin_type", "tin_last_four", "signed_date", "received_date", "status", "version", "evidence_id", "verified_at", "external_return_reason", "submitted_at", "created_at", "updated_at"]);
  }

  private safePaymentProfile(row: QueryResultRow | null) {
    if (!row) return null;
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "primary_payment_method", "priority_passport_status", "provider_reference", "account_last_four", "card_last_four", "enrollment_contact_name", "enrollment_contact_email", "enrollment_contact_phone", "status", "backup_ach_status", "bank_display_name", "account_type", "ach_evidence_id", "bank_verification_evidence_id", "verified_at", "hold_reason", "external_return_reason", "submitted_at", "version", "created_at", "updated_at"]);
  }

  private safePolicy(row: QueryResultRow | null) {
    if (!row) return null;
    return this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "policy_type", "carrier", "policy_reference", "effective_date", "expiration_date", "occurrence_limit_cents", "general_aggregate_cents", "products_completed_operations_aggregate_cents", "combined_single_auto_limit_cents", "employer_liability_accident_limit_cents", "employer_liability_disease_each_employee_limit_cents", "employer_liability_disease_policy_limit_cents", "workers_compensation_statutory", "owned_auto_covered", "hired_rented_auto_covered", "non_owned_auto_covered", "additional_insured_status", "waiver_of_subrogation_status", "primary_non_contributory_status", "cancellation_notice_status", "coi_evidence_id", "endorsement_evidence_ids", "status", "verified_at", "external_return_reason", "submitted_at", "version", "created_at", "updated_at"]);
  }

  private safeEvidence(row: EvidenceRow, internal = false) {
    const safe = this.pick(row, ["id", "tenant_id", "organization_id", "capacity_provider_id", "category", "related_entity_type", "related_entity_id", "file_name", "mime_type", "size_bytes", "checksum", "status", "restricted", "uploaded_by_user_id", "uploaded_at", "verified_at", "external_return_reason", "created_at", "updated_at"]);
    return { ...safe, storage_reference_available: Boolean(internal && (row.file_id || row.object_key)), raw_url: undefined };
  }

  private pick(row: QueryResultRow, keys: string[]) {
    return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
  }

  private reviewAction(body: Record<string, unknown>) {
    return requireAllowed(body.status, reviewActions, "status");
  }

  private reviewEvent(prefix: string, action: string) {
    if (prefix === "partner_payment_profile" && action === "hold") return "partner_payment_profile.held";
    if (action === "verified") return `${prefix}.verified`;
    if (action === "returned") return `${prefix}.returned`;
    if (action === "rejected") return `${prefix}.rejected`;
    return `${prefix}.reviewed`;
  }

  private rejectSpoofedOrganization(body: Record<string, unknown>, organizationId: string) {
    if (body.organization_id !== undefined && body.organization_id !== organizationId) throw new ForbiddenException("organization_id does not match authorized Partner scope");
  }

  private rejectSensitiveBody(body: Record<string, unknown>) {
    const forbidden = ["tin", "taxpayer_identification_number", "routing_number", "bank_routing_number", "account_number", "bank_account_number"];
    for (const key of forbidden) {
      if (body[key] !== undefined) throw new BadRequestException(`${key} must not be submitted to ordinary compliance APIs`);
    }
    for (const value of Object.values(body)) this.rejectSensitiveString(value);
  }

  private rejectSensitiveString(value: unknown) {
    if (typeof value !== "string") return;
    if (/\b\d{9,}\b/.test(value)) throw new BadRequestException("restricted metadata cannot contain full tax or bank identifiers");
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
    this.rejectSensitiveBody(value as Record<string, unknown>);
    return value as Record<string, unknown>;
  }

  private lastFour(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}$/.test(value)) throw new BadRequestException("last four must be four digits");
    return value;
  }

  private requiredDate(value: unknown, message: string): string {
    const date = this.optionalDate(value);
    if (!date) throw new BadRequestException(message);
    return date;
  }

  private optionalDate(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("expected date string");
    if (Number.isNaN(Date.parse(value))) throw new BadRequestException("invalid date");
    return value;
  }

  private optionalMoney(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException("money value must be non-negative");
    return Math.trunc(number);
  }

  private optionalBoolean(value: unknown): boolean | null {
    if (value === undefined || value === null) return null;
    return Boolean(value);
  }

  private async auditEvidenceAccess(client: PoolClient, request: AuthenticatedRequest, evidence: EvidenceRow) {
    await appendAuditLog(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action: "restricted_evidence.access",
      entityType: "partner_restricted_evidence",
      entityId: evidence.id,
      afterState: { evidence_id: evidence.id, organization_id: evidence.organization_id, category: evidence.category },
      requestId: request.header("x-request-id") ?? request.header("x-correlation-id"),
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    });
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
