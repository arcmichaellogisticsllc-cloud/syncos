import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { OrganizationScopeService } from "../security/organization-scope";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireAllowed, requireString } from "./intelligence.types";

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const partnerRoles = new Set(["partner_admin", "partner_foreman"]);
const triggerValues = new Set(["explicit_request", "source_event", "scheduled_reevaluation", "decision_attempt", "notice_attempt", "production_start_attempt"]);
const overrideableRequirements = new Set(["housing_confirmation", "reporting_acknowledgment", "customer_badge_or_clearance", "safety_orientation_acknowledgment"]);
const warningRequirements = new Set(["alternate_foreman_missing", "insurance_expiring_soon"]);
const sourceEventMap: Record<string, string[]> = {
  "partner_compliance_status.changed": ["partner_compliance_ready"],
  "partner_insurance_policy.expired": ["partner_compliance_ready", "insurance_current"],
  "worker_readiness.changed": ["crew_base_ready"],
  "crew_readiness.changed": ["crew_base_ready"],
  "crew_membership.added": ["crew_base_ready", "approved_foreman"],
  "crew_foreman.replaced": ["approved_foreman"],
  "partner_agreement.terminated": ["msa_effective"],
  "partner_work_order.suspended": ["work_order_active"],
  "vehicle_assignment.operator_revoked": ["approved_operator"],
  "vehicle_assignment.inspection_expired": ["vehicle_aerial_inspection_current"],
  "mobilization_override.expired": ["override_expired"],
  "mobilization_override.revoked": ["override_expired"],
  "mobilization_decision.expired": ["mobilization_decision_current"],
};

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

type MobilizationContext = {
  tenant_id: string;
  project_id: string;
  work_order_id: string;
  work_order_version_id: string;
  organization_id: string;
  capacity_provider_id: string;
  crew_assignment_id: string;
  crew_id: string;
  vehicle_assignment_id: string | null;
  map_work_package_ref: string | null;
  project_timezone: string;
  scope_summary: string | null;
  primary_work_area: string | null;
  work_order_status: string;
  agreement_version_id: string;
  agreement_status: string;
  agreement_artifact_file_object_id: string | null;
  work_order_artifact_file_object_id: string | null;
  rate_schedule_id: string | null;
  rate_code_id: string | null;
  vehicle_status: string | null;
  aerial_inspection_expires_at: Date | string | null;
};

type Check = {
  code: string;
  category: string;
  status: "passed" | "failed" | "warning" | "waived" | "not_applicable";
  severity: "blocker" | "warning" | "info";
  override_policy: "non_overrideable" | "overrideable_with_expiration" | "warning_only";
  external_detail: string;
  internal_detail?: string;
  source_type?: string;
  source_record_id?: string | null;
  source_version?: string | null;
  source_observed_state?: string | null;
  override_id?: string | null;
};

@Controller("partner-mobilization")
export class PartnerMobilizationController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  @Post("organizations/:organizationId/work-order-versions/:versionId/evaluate")
  @RequirePermission("partner_mobilization.evaluate")
  async evaluateInternal(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const context = await this.resolveMobilizationContext(client, request.auth.tenantId, organizationId, versionId);
      await this.upsertContextRequirements(client, request, context, body.requirements);
      return this.evaluateAndStore(client, request, context, requireAllowed(body.triggered_by ?? "explicit_request", triggerValues, "triggered_by"), true);
    });
  }

  @Get("organizations/:organizationId/work-order-versions/:versionId/readiness")
  @RequirePermission("partner_mobilization.review")
  async latestInternal(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const context = await this.resolveMobilizationContext(client, request.auth.tenantId, organizationId, versionId);
      return this.latestOrEvaluate(client, request, context, true);
    });
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/overrides")
  @RequirePermission("partner_mobilization.override")
  async createOverride(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const context = await this.resolveMobilizationContext(client, request.auth.tenantId, organizationId, versionId);
      const code = requireString(body.requirement_code, "requirement_code is required");
      if (!overrideableRequirements.has(code)) throw new BadRequestException("requirement is not overrideable");
      const reason = requireString(body.reason, "reason is required");
      const expiresAt = requireString(body.expires_at, "expires_at is required");
      return this.writeWithClient(client, request, "mobilization_override.create", "mobilization_override.created", "mobilization_override", async (writeClient) => {
        const evalResult = await this.evaluateAndStore(writeClient, request, context, "decision_attempt", true, false);
        const existing = await writeClient.query("SELECT * FROM mobilization_overrides WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND requirement_code = $4 AND status = 'active'", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id, code]);
        if (existing.rows[0]) return { entityType: "mobilization_override", entityId: existing.rows[0].id, afterState: this.safeOverride(existing.rows[0]) };
        const inserted = await writeClient.query(
          `
          INSERT INTO mobilization_overrides (tenant_id, project_id, work_order_id, work_order_version_id, organization_id, crew_assignment_id, requirement_code, source_evaluation_id, reason, external_condition, internal_notes, expires_at, approved_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          RETURNING *
          `,
          [context.tenant_id, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.crew_assignment_id, code, evalResult.id, reason, body.external_condition ?? null, body.internal_notes ?? null, expiresAt, request.auth.userId],
        );
        return { entityType: "mobilization_override", entityId: inserted.rows[0].id, afterState: this.safeOverride(inserted.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/overrides/:overrideId/revoke")
  @RequirePermission("partner_mobilization.override")
  async revokeOverride(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Param("overrideId") overrideId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const context = await this.resolveMobilizationContext(client, request.auth.tenantId, organizationId, versionId);
      const reason = requireString(body.reason, "reason is required");
      return this.writeWithClient(client, request, "mobilization_override.revoke", "mobilization_override.revoked", "mobilization_override", async (writeClient) => {
        const current = await writeClient.query("SELECT * FROM mobilization_overrides WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3 AND crew_assignment_id = $4 AND id = $5 AND status = 'active'", [context.tenant_id, context.organization_id, context.work_order_version_id, context.crew_assignment_id, overrideId]);
        if (!current.rows[0]) throw new NotFoundException("active override not found");
        const revoked = await writeClient.query("UPDATE mobilization_overrides SET status = 'revoked', revoked_by_user_id = $6, revoked_at = now(), revoked_reason = $7 WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3 AND crew_assignment_id = $4 AND id = $5 RETURNING *", [context.tenant_id, context.organization_id, context.work_order_version_id, context.crew_assignment_id, overrideId, request.auth.userId, reason]);
        return { entityType: "mobilization_override", entityId: overrideId, beforeState: this.safeOverride(current.rows[0]), afterState: this.safeOverride(revoked.rows[0]) };
      });
    });
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/approve")
  @RequirePermission("partner_mobilization.approve")
  async approve(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.makeDecision(request, organizationId, versionId, body, "approved_to_mobilize");
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/conditional-approve")
  @RequirePermission("partner_mobilization.approve")
  async conditionalApprove(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    const conditions = this.stringArray(body.external_conditions);
    if (conditions.length === 0) throw new BadRequestException("conditional approval requires external_conditions");
    return this.makeDecision(request, organizationId, versionId, body, "conditionally_approved");
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/hold")
  @RequirePermission("partner_mobilization.hold")
  async hold(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.makeDecision(request, organizationId, versionId, body, "hold");
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/revoke")
  @RequirePermission("partner_mobilization.revoke")
  async revoke(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    if (!body.reason) throw new BadRequestException("revocation reason is required");
    return this.makeDecision(request, organizationId, versionId, body, "revoked");
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/source-events")
  @RequirePermission("partner_mobilization.evaluate")
  async sourceEvent(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const context = await this.resolveMobilizationContext(client, request.auth.tenantId, organizationId, versionId);
      const result = await this.evaluateAndStore(client, request, context, "source_event", true);
      const eventType = requireString(body.event_type ?? "source_event", "event_type is required");
      if (result.overall_status === "blocked") await this.autoHold(client, request, context, result.id, `source_event:${eventType}`);
      return { ...result, affected_requirement_codes: sourceEventMap[eventType] ?? [] };
    });
  }

  @Post("organizations/:organizationId/work-order-versions/:versionId/notices")
  @RequirePermission("partner_notice.issue")
  async issueNotice(@Req() request: AuthenticatedRequest, @Param("organizationId") organizationId: string, @Param("versionId") versionId: string, @Body() body: Record<string, unknown>) {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const context = await this.resolveMobilizationContext(client, request.auth.tenantId, organizationId, versionId);
      const evaluation = await this.evaluateAndStore(client, request, context, "notice_attempt", true);
      if (evaluation.overall_status === "blocked") throw new BadRequestException("Notice cannot be issued while readiness is blocked");
      const decision = await this.currentDecision(client, context);
      if (!decision || !["approved_to_mobilize", "conditionally_approved"].includes(decision.decision)) throw new BadRequestException("mobilization approval is required before Notice issuance");
      if (!body.production_start_date || !body.production_start_time || !body.timezone || !body.initial_work_area) throw new BadRequestException("start date, time, timezone, and work area are required");
      return this.writeWithClient(client, request, "notice_to_proceed.issue", "notice_to_proceed.issued", "notice_to_proceed", async (writeClient) => {
        const current = await this.currentNotice(writeClient, context);
        const currentStart = current ? await this.currentProductionStart(writeClient, current) : null;
        if (current) await writeClient.query("UPDATE notice_to_proceed_versions SET current = false, status = 'superseded' WHERE tenant_id = $1 AND id = $2", [context.tenant_id, current.id]);
        if (currentStart) await writeClient.query("UPDATE production_start_authorizations SET current = false, authorization_status = 'superseded' WHERE tenant_id = $1 AND id = $2", [context.tenant_id, currentStart.id]);
        const noticeNumber = current?.notice_number ?? `NTP-${String(Date.now()).slice(-8)}`;
        const versionNumber = Number(current?.version_number ?? 0) + 1;
        const notice = await writeClient.query(
          `
          INSERT INTO notice_to_proceed_versions (
            tenant_id, notice_number, version_number, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id,
            crew_assignment_id, crew_id, vehicle_assignment_id, readiness_evaluation_id, mobilization_decision_id, production_start_status,
            planned_mobilization_date, production_start_date, production_start_time, timezone, initial_map_work_package_ref,
            initial_work_area, external_instructions, external_conditions, internal_notes, issued_by_user_id, status, supersedes_notice_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'authorized',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'authorized',$24)
          RETURNING *
          `,
          [
            context.tenant_id, noticeNumber, versionNumber, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.capacity_provider_id,
            context.crew_assignment_id, context.crew_id, context.vehicle_assignment_id, evaluation.id, decision.id, body.planned_mobilization_date ?? null, body.production_start_date,
            body.production_start_time, body.timezone, context.map_work_package_ref, body.initial_work_area, requireString(body.external_instructions, "external_instructions is required"),
            this.stringArray(body.external_conditions), body.internal_notes ?? null, request.auth.userId, current?.id ?? null,
          ],
        );
        const auth = await writeClient.query(
          `
          INSERT INTO production_start_authorizations (tenant_id, notice_id, project_id, work_order_id, work_order_version_id, organization_id, crew_assignment_id, crew_id, vehicle_assignment_id, authorization_status, start_date, start_time, timezone, map_work_package_ref, work_area, authorized_by_user_id, supersedes_authorization_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'authorized',$10,$11,$12,$13,$14,$15,$16)
          RETURNING *
          `,
          [context.tenant_id, notice.rows[0].id, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.crew_assignment_id, context.crew_id, context.vehicle_assignment_id, body.production_start_date, body.production_start_time, body.timezone, context.map_work_package_ref, body.initial_work_area, request.auth.userId, currentStart?.id ?? null],
        );
        if (current) await writeClient.query("UPDATE notice_to_proceed_versions SET superseded_by_notice_id = $3 WHERE tenant_id = $1 AND id = $2", [context.tenant_id, current.id, notice.rows[0].id]);
        if (currentStart) await writeClient.query("UPDATE production_start_authorizations SET superseded_by_authorization_id = $3 WHERE tenant_id = $1 AND id = $2", [context.tenant_id, currentStart.id, auth.rows[0].id]);
        return {
          entityType: "notice_to_proceed",
          entityId: notice.rows[0].id,
          afterState: this.safeNotice(notice.rows[0], auth.rows[0], true),
          additionalEvents: [{
            action: "production_start.authorize",
            aggregateType: "production_start",
            entityType: "production_start_authorization",
            entityId: auth.rows[0].id,
            eventType: "production_start.authorized",
            afterState: this.safeProductionStart(auth.rows[0]),
          }],
        };
      });
    });
  }

  @Get("me/work-order-versions/:versionId/readiness")
  @RequirePermission("partner_mobilization.read")
  async ownReadiness(@Req() request: AuthenticatedRequest, @Param("versionId") versionId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const partner = await this.requirePartner(client, request, "partner_admin", query.organization_id);
      const context = await this.resolveMobilizationContext(client, partner.tenant_id, partner.organization.id, versionId);
      return this.latestOrEvaluate(client, request, context, false);
    });
  }

  @Get("me/notices/:noticeId")
  @RequirePermission("partner_notice.read")
  async ownNotice(@Req() request: AuthenticatedRequest, @Param("noticeId") noticeId: string, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const partner = await this.requirePartner(client, request, "partner_admin", query.organization_id);
      const notice = await this.requireNotice(client, partner.tenant_id, partner.organization.id, noticeId);
      const auth = await this.currentProductionStart(client, notice);
      return this.safeNotice(notice, auth, false);
    });
  }

  @Post("me/notices/:noticeId/acknowledge")
  @RequirePermission("partner_notice.acknowledge")
  async ownAcknowledge(@Req() request: AuthenticatedRequest, @Param("noticeId") noticeId: string, @Query() query: Record<string, string | undefined>) {
    return this.acknowledge(request, noticeId, "partner_admin", query.organization_id);
  }

  @Get("foreman/readiness")
  @RequirePermission("partner_mobilization.foreman.read")
  async foremanReadiness(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const partner = await this.requirePartner(client, request, "partner_foreman");
      const crewId = await this.requireForemanCrew(client, partner);
      const context = await this.resolveForemanContext(client, partner, crewId);
      return this.latestOrEvaluate(client, request, context, false, "foreman");
    });
  }

  @Get("foreman/notice")
  @RequirePermission("partner_notice.foreman.read")
  async foremanNotice(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const partner = await this.requirePartner(client, request, "partner_foreman");
      const crewId = await this.requireForemanCrew(client, partner);
      const context = await this.resolveForemanContext(client, partner, crewId);
      const notice = await this.currentNotice(client, context);
      if (!notice) throw new NotFoundException("Notice not found");
      return this.safeForemanNotice(notice, await this.currentProductionStart(client, notice));
    });
  }

  @Post("foreman/notices/:noticeId/acknowledge")
  @RequirePermission("partner_notice.foreman.acknowledge")
  async foremanAcknowledge(@Req() request: AuthenticatedRequest, @Param("noticeId") noticeId: string) {
    return this.acknowledge(request, noticeId, "partner_foreman");
  }

  private async makeDecision(request: AuthenticatedRequest, organizationId: string, versionId: string, body: Record<string, unknown>, decision: "approved_to_mobilize" | "conditionally_approved" | "hold" | "revoked") {
    return this.withClient(async (client) => {
      await this.requireInternalOrganizationAccess(client, request, organizationId);
      const context = await this.resolveMobilizationContext(client, request.auth.tenantId, organizationId, versionId);
      const evaluation = await this.evaluateAndStore(client, request, context, "decision_attempt", true);
      if (["approved_to_mobilize", "conditionally_approved"].includes(decision) && evaluation.overall_status === "blocked") throw new BadRequestException("blocked readiness cannot be approved");
      const eventType = decision === "approved_to_mobilize" ? "mobilization.approved" : decision === "hold" ? "mobilization.held" : decision === "revoked" ? "mobilization.revoked" : "mobilization.conditionally_approved";
      return this.writeWithClient(client, request, `mobilization.${decision}`, eventType, "mobilization_decision", async (writeClient) => {
        const current = await this.currentDecision(writeClient, context);
        if (current) await writeClient.query("UPDATE mobilization_decisions SET current = false, superseded_by_decision_id = NULL WHERE tenant_id = $1 AND id = $2", [context.tenant_id, current.id]);
        const result = await writeClient.query(
          `
          INSERT INTO mobilization_decisions (tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_assignment_id, crew_id, vehicle_assignment_id, readiness_evaluation_id, decision, authorized_by_user_id, external_conditions, internal_notes, expires_at, revocation_reason, supersedes_decision_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          RETURNING *
          `,
          [context.tenant_id, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.capacity_provider_id, context.crew_assignment_id, context.crew_id, context.vehicle_assignment_id, evaluation.id, decision, request.auth.userId, this.stringArray(body.external_conditions), body.internal_notes ?? null, body.expires_at ?? null, body.reason ?? null, current?.id ?? null],
        );
        if (["hold", "revoked"].includes(decision)) await this.holdCurrentNoticeAndStart(writeClient, context, String(body.reason ?? decision));
        return { entityType: "mobilization_decision", entityId: result.rows[0].id, beforeState: current ? this.safeDecision(current, true) : undefined, afterState: this.safeDecision(result.rows[0], true) };
      });
    });
  }

  private async evaluateAndStore(client: PoolClient, request: AuthenticatedRequest, context: MobilizationContext, triggeredBy: string, internal: boolean, writeEvents = true) {
    const checks = await this.evaluateChecks(client, context);
    const blockerCount = checks.filter((check) => check.status === "failed" && check.severity === "blocker").length;
    const warningCount = checks.filter((check) => check.status === "warning" || check.status === "waived").length;
    const passedCount = checks.filter((check) => ["passed", "waived", "not_applicable"].includes(check.status)).length;
    const overallStatus = blockerCount > 0 ? (checks.some((check) => check.status === "passed") ? "blocked" : "in_progress") : warningCount > 0 ? "conditional" : "ready";
    const prior = await this.currentEvaluation(client, context);

    const persist = async (writeClient: PoolClient) => {
      if (prior) await writeClient.query("UPDATE mobilization_readiness_evaluations SET current = false WHERE tenant_id = $1 AND id = $2", [context.tenant_id, prior.id]);
      const evaluation = await writeClient.query(
        `
        INSERT INTO mobilization_readiness_evaluations (tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_assignment_id, crew_id, vehicle_assignment_id, map_work_package_ref, project_timezone, overall_status, passed_check_count, blocker_count, warning_count, supersedes_evaluation_id, triggered_by, actor_user_id, correlation_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING *
        `,
        [context.tenant_id, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.capacity_provider_id, context.crew_assignment_id, context.crew_id, context.vehicle_assignment_id, context.map_work_package_ref, context.project_timezone, overallStatus, passedCount, blockerCount, warningCount, prior?.id ?? null, triggeredBy, request.auth.userId, request.header("x-request-id") ?? request.header("x-correlation-id") ?? null],
      );
      if (prior) await writeClient.query("UPDATE mobilization_readiness_evaluations SET superseded_by_evaluation_id = $3 WHERE tenant_id = $1 AND id = $2", [context.tenant_id, prior.id, evaluation.rows[0].id]);
      for (const check of checks) {
        await writeClient.query(
          `
          INSERT INTO mobilization_readiness_check_results (tenant_id, evaluation_id, requirement_code, requirement_category, status, severity, override_policy, external_code, internal_detail, external_detail, source_type, source_record_id, source_version, source_observed_state, override_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$3,$8,$9,$10,$11,$12,$13,$14)
          `,
          [context.tenant_id, evaluation.rows[0].id, check.code, check.category, check.status, check.severity, check.override_policy, check.internal_detail ?? null, check.external_detail, check.source_type ?? null, check.source_record_id ?? null, check.source_version ?? null, check.source_observed_state ?? null, check.override_id ?? null],
        );
      }
      return evaluation.rows[0];
    };

    if (!writeEvents) return this.safeEvaluation({ ...(prior ?? {}), id: prior?.id ?? "", overall_status: overallStatus, passed_check_count: passedCount, blocker_count: blockerCount, warning_count: warningCount }, checks, internal);

    const priorChecks = prior ? await this.evaluationChecks(client, context.tenant_id, prior.id) : [];
    return this.writeWithClient(client, request, "mobilization_readiness.evaluate", materialChange(prior, priorChecks, overallStatus, checks) ? "mobilization_readiness.changed" : "mobilization_readiness.evaluated", "mobilization_readiness", async (writeClient) => {
      const evaluation = await persist(writeClient);
      return { entityType: "mobilization_readiness", entityId: evaluation.id, beforeState: prior ? { id: prior.id, overall_status: prior.overall_status } : undefined, afterState: this.safeEvaluation(evaluation, checks, internal) };
    });
  }

  private async evaluateChecks(client: PoolClient, context: MobilizationContext): Promise<Check[]> {
    await this.expireOverrides(client, context);
    const activeOverrides = await this.activeOverrides(client, context);
    const checks: Check[] = [];
    const add = (code: string, category: string, passed: boolean, detail: string, sourceType?: string, sourceId?: string | null, state?: string | null, policy: Check["override_policy"] = "non_overrideable") => {
      const override = activeOverrides.get(code);
      if (!passed && override && policy === "overrideable_with_expiration") checks.push({ code, category, status: "waived", severity: "warning", override_policy: policy, external_detail: override.external_condition ?? detail, internal_detail: detail, source_type: sourceType, source_record_id: sourceId, source_observed_state: state, override_id: override.id });
      else checks.push({ code, category, status: passed ? "passed" : "failed", severity: passed ? "info" : "blocker", override_policy: policy, external_detail: detail, source_type: sourceType, source_record_id: sourceId, source_observed_state: state });
    };
    const warn = (code: string, category: string, condition: boolean, detail: string) => checks.push({ code, category, status: condition ? "warning" : "not_applicable", severity: condition ? "warning" : "info", override_policy: "warning_only", external_detail: detail });

    const org = await client.query("SELECT o.status AS org_status, cp.status AS provider_status FROM organizations o JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id WHERE o.tenant_id = $1 AND o.id = $2 AND cp.id = $3 AND cp.provider_type = ANY($4) AND o.deleted_at IS NULL AND cp.deleted_at IS NULL", [context.tenant_id, context.organization_id, context.capacity_provider_id, [...partnerProviderTypes]]);
    add("partner_eligible", "partner", Boolean(org.rows[0] && !["archived", "inactive", "suspended"].includes(String(org.rows[0].org_status)) && !["archived", "suspended", "inactive"].includes(String(org.rows[0].provider_status))), "Partner Organization and capacity-provider relationship must be active", "organization", context.organization_id, org.rows[0]?.org_status ?? null);

    const compliance = await this.complianceSummary(client, context);
    add("partner_compliance_ready", "company_compliance", compliance.ready, "Partner company compliance must be ready", "organization", context.organization_id, compliance.status);
    for (const blocker of compliance.blockers) add(`p3_${blocker.key}`, "company_compliance", false, blocker.message, "organization", context.organization_id, blocker.key);

    add("msa_effective", "agreement", context.agreement_status === "effective" && Boolean(context.agreement_artifact_file_object_id), "Governing MSA version must be effective with verified artifact", "partner_agreement_version", context.agreement_version_id, context.agreement_status);
    add("work_order_active", "work_order", context.work_order_status === "active" && Boolean(context.work_order_artifact_file_object_id), "Work Order version must be active with verified artifact", "partner_work_order_version", context.work_order_version_id, context.work_order_status);
    add("commercial_terms_assigned", "work_order", Boolean(context.rate_schedule_id && context.rate_code_id), "Required commercial terms must be assigned", "partner_work_order_version", context.work_order_version_id);
    add("map_work_package_assigned", "work_order", Boolean(context.map_work_package_ref), "Map/work package must be assigned", "partner_work_order_version", context.work_order_version_id);
    add("scope_assigned", "work_order", Boolean(context.scope_summary), "Work Order scope must be assigned", "partner_work_order_version", context.work_order_version_id);

    const crew = await this.crewReadiness(client, context);
    add("crew_base_ready", "crew", crew.ready, "Crew base-readiness must be ready", "crew", context.crew_id, crew.status);
    for (const blocker of crew.blockers) add(`p4_${blocker}`, "crew", false, blocker, "crew", context.crew_id, blocker);
    warn("alternate_foreman_missing", "crew", !crew.hasAlternateForeman, "Optional Alternate Foreman is not assigned");

    const vehicleRequired = true;
    add("vehicle_assignment_valid", "vehicle", !vehicleRequired || Boolean(context.vehicle_assignment_id && ["assigned", "active_custody", "pending_execution"].includes(String(context.vehicle_status))), "Vehicle assignment must be valid for mobilization", "partner_vehicle_assignment", context.vehicle_assignment_id, context.vehicle_status);
    if (context.vehicle_assignment_id) {
      const condition = await client.query("SELECT id FROM partner_vehicle_condition_records WHERE tenant_id = $1 AND organization_id = $2 AND vehicle_assignment_id = $3 AND record_type = 'pre_assignment' LIMIT 1", [context.tenant_id, context.organization_id, context.vehicle_assignment_id]);
      add("vehicle_pre_assignment_condition", "vehicle", Boolean(condition.rows[0]), "Pre-assignment vehicle condition record is required", "partner_vehicle_assignment", context.vehicle_assignment_id);
      const aerialInspectionExpiresAt = this.dateOnlyOrNull(context.aerial_inspection_expires_at);
      add("vehicle_aerial_inspection_current", "vehicle", !aerialInspectionExpiresAt || aerialInspectionExpiresAt >= new Date().toISOString().slice(0, 10), "Required aerial inspection must be current", "partner_vehicle_assignment", context.vehicle_assignment_id, aerialInspectionExpiresAt);
      const operator = await client.query("SELECT id FROM partner_vehicle_operator_authorizations WHERE tenant_id = $1 AND organization_id = $2 AND vehicle_assignment_id = $3 AND crew_id = $4 AND qualification_status = 'approved' AND end_date IS NULL LIMIT 1", [context.tenant_id, context.organization_id, context.vehicle_assignment_id, context.crew_id]);
      add("approved_operator", "operator", Boolean(operator.rows[0]), "At least one approved operator is required", "partner_vehicle_assignment", context.vehicle_assignment_id);
    }

    for (const requirement of await this.contextRequirements(client, context)) {
      const policy = overrideableRequirements.has(requirement.requirement_code) ? "overrideable_with_expiration" : warningRequirements.has(requirement.requirement_code) ? "warning_only" : "non_overrideable";
      if (policy === "warning_only") warn(requirement.requirement_code, "project_requirement", requirement.required, requirement.external_message ?? `${requirement.requirement_code} should be reviewed`);
      else {
        const satisfied = await this.projectRequirementSatisfied(client, context, requirement.requirement_code);
        add(requirement.requirement_code, "project_requirement", !requirement.required || satisfied, requirement.external_message ?? `${requirement.requirement_code} is required`, "partner_work_order_version", context.work_order_version_id, satisfied ? "satisfied" : "missing", policy);
      }
    }
    return checks;
  }

  private async complianceSummary(client: PoolClient, context: MobilizationContext) {
    const profile = await this.currentRow(client, "partner_company_profiles", context);
    const tax = await this.currentRow(client, "partner_tax_profiles", context);
    const payment = await this.currentRow(client, "partner_payment_profiles", context);
    const policies = await client.query("SELECT * FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status <> 'superseded'", [context.tenant_id, context.organization_id]);
    const blockers: Array<{ key: string; message: string }> = [];
    if (!profile || profile.status !== "verified") blockers.push({ key: "company_profile_unverified", message: "Company profile must be verified" });
    if (!tax || tax.status !== "verified") blockers.push({ key: "w9_unverified", message: "W-9 must be verified" });
    if (!payment || payment.status !== "active" || payment.priority_passport_status !== "active") blockers.push({ key: "payment_profile_unverified", message: "Payment readiness must be active" });
    for (const type of ["commercial_general_liability", "commercial_auto", "umbrella_excess", "workers_compensation", "employers_liability"]) {
      const policy = policies.rows.find((row) => row.policy_type === type);
      if (!policy) blockers.push({ key: `policy_missing_${type}`, message: `${type} policy is required` });
      else if (policy.status !== "verified" || new Date(policy.expiration_date) < new Date(new Date().toISOString().slice(0, 10))) blockers.push({ key: `policy_not_ready_${type}`, message: `${type} policy must be verified and current` });
    }
    return { ready: blockers.length === 0, status: blockers.length === 0 ? "ready" : "blocked", blockers };
  }

  private async crewReadiness(client: PoolClient, context: MobilizationContext) {
    const crew = await client.query("SELECT * FROM crews WHERE tenant_id = $1 AND organization_id = $2 AND id = $3 AND deleted_at IS NULL", [context.tenant_id, context.organization_id, context.crew_id]);
    const blockers: string[] = [];
    if (!crew.rows[0] || crew.rows[0].lifecycle_status !== "active") blockers.push("crew_inactive");
    const members = await client.query("SELECT pcm.*, w.status AS worker_status, w.review_status FROM partner_crew_memberships pcm JOIN workers w ON w.tenant_id = pcm.tenant_id AND w.id = pcm.worker_id WHERE pcm.tenant_id = $1 AND pcm.organization_id = $2 AND pcm.crew_id = $3 AND pcm.status = 'active' AND pcm.deleted_at IS NULL", [context.tenant_id, context.organization_id, context.crew_id]);
    if (members.rows.length < Number(crew.rows[0]?.target_staffing_level ?? 4)) blockers.push("crew_staffing_incomplete");
    if (!members.rows.some((row) => row.membership_role === "foreman")) blockers.push("crew_foreman_missing");
    const hasAlternateForeman = members.rows.some((row) => row.membership_role === "alternate_foreman");
    for (const member of members.rows) {
      if (member.worker_status !== "active" || !["approved", "conditional"].includes(String(member.review_status))) blockers.push("crew_member_not_ready");
      const headshot = await client.query("SELECT id FROM partner_worker_headshots WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND status = 'approved' AND deleted_at IS NULL LIMIT 1", [context.tenant_id, context.organization_id, member.worker_id]);
      if (!headshot.rows[0]) blockers.push("worker_headshot_missing");
      const requiredCredential = await client.query("SELECT id FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND worker_id = $3 AND required = true AND status = 'verified' AND deleted_at IS NULL AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE) LIMIT 1", [context.tenant_id, context.organization_id, member.worker_id]);
      if (!requiredCredential.rows[0]) blockers.push("worker_credential_missing_or_unverified");
    }
    return { ready: blockers.length === 0, status: blockers.length === 0 ? "ready" : "blocked", blockers: Array.from(new Set(blockers)), hasAlternateForeman };
  }

  private async projectRequirementSatisfied(client: PoolClient, context: MobilizationContext, code: string) {
    if (["customer_badge_or_clearance", "background_check", "drug_screen"].includes(code)) {
      const type = code === "customer_badge_or_clearance" ? "customer_badge_or_clearance" : code;
      const result = await client.query("SELECT id FROM partner_worker_credentials WHERE tenant_id = $1 AND organization_id = $2 AND credential_type = $3 AND status = 'verified' AND deleted_at IS NULL AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE) LIMIT 1", [context.tenant_id, context.organization_id, type]);
      return Boolean(result.rows[0]);
    }
    return false;
  }

  private async resolveMobilizationContext(client: PoolClient, tenantId: string, organizationId: string, versionId: string): Promise<MobilizationContext> {
    const result = await client.query(
      `
      SELECT wov.tenant_id, wov.project_id, wov.work_order_id, wov.id AS work_order_version_id, wov.organization_id,
        wov.capacity_provider_id, ca.id AS crew_assignment_id, wov.assigned_crew_id AS crew_id,
        va.id AS vehicle_assignment_id, wov.map_work_package_ref, COALESCE(va.timezone, 'America/New_York') AS project_timezone,
        wov.scope_summary, wov.primary_work_area, wov.status AS work_order_status, wov.governing_agreement_version_id AS agreement_version_id,
        av.status AS agreement_status, av.artifact_file_object_id AS agreement_artifact_file_object_id,
        wov.artifact_file_object_id AS work_order_artifact_file_object_id, wov.rate_schedule_id, wov.rate_code_id,
        va.status AS vehicle_status, va.aerial_inspection_expires_at
      FROM partner_work_order_versions wov
      JOIN partner_agreement_versions av ON av.tenant_id = wov.tenant_id AND av.id = wov.governing_agreement_version_id
      JOIN partner_work_order_crew_assignments ca ON ca.tenant_id = wov.tenant_id AND ca.work_order_version_id = wov.id AND ca.status = 'active'
      LEFT JOIN partner_vehicle_assignments va ON va.tenant_id = wov.tenant_id AND va.work_order_version_id = wov.id AND va.crew_id = ca.crew_id AND va.deleted_at IS NULL AND va.status <> 'voided'
      WHERE wov.tenant_id = $1 AND wov.organization_id = $2 AND wov.id = $3 AND wov.deleted_at IS NULL
      ORDER BY va.created_at DESC NULLS LAST
      LIMIT 1
      `,
      [tenantId, organizationId, versionId],
    );
    if (!result.rows[0]) throw new NotFoundException("mobilization assignment context not found");
    return result.rows[0] as MobilizationContext;
  }

  private async resolveForemanContext(client: PoolClient, partner: PartnerContext, crewId: string): Promise<MobilizationContext> {
    const result = await client.query("SELECT id FROM partner_work_order_versions WHERE tenant_id = $1 AND organization_id = $2 AND assigned_crew_id = $3 AND status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [partner.tenant_id, partner.organization.id, crewId]);
    if (!result.rows[0]) throw new NotFoundException("assigned mobilization context not found");
    return this.resolveMobilizationContext(client, partner.tenant_id, partner.organization.id, result.rows[0].id);
  }

  private async acknowledge(request: AuthenticatedRequest, noticeId: string, persona: "partner_admin" | "partner_foreman", organizationId?: string) {
    return this.withClient(async (client) => {
      const partner = await this.requirePartner(client, request, persona, organizationId);
      const notice = await this.requireNotice(client, partner.tenant_id, partner.organization.id, noticeId);
      if (persona === "partner_foreman") {
        const crewId = await this.requireForemanCrew(client, partner);
        if (notice.crew_id !== crewId) throw new ForbiddenException("Notice is not assigned to this Foreman's Crew");
      }
      return this.writeWithClient(client, request, "notice_to_proceed.acknowledge", "notice_to_proceed.acknowledged", "notice_acknowledgment", async (writeClient) => {
        const existing = await writeClient.query("SELECT * FROM notice_acknowledgments WHERE tenant_id = $1 AND notice_id = $2 AND acknowledged_by_user_id = $3 AND acknowledgment_type = $4 AND status = 'active'", [partner.tenant_id, noticeId, request.auth.userId, persona === "partner_foreman" ? "operational_start_instructions" : "receipt"]);
        if (existing.rows[0]) return { entityType: "notice_acknowledgment", entityId: existing.rows[0].id, afterState: this.safeAck(existing.rows[0]) };
        const ack = await writeClient.query("INSERT INTO notice_acknowledgments (tenant_id, notice_id, organization_id, acknowledged_by_user_id, partner_persona, crew_id, acknowledgment_type) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [partner.tenant_id, noticeId, partner.organization.id, request.auth.userId, persona, notice.crew_id, persona === "partner_foreman" ? "operational_start_instructions" : "receipt"]);
        await writeClient.query("UPDATE notice_to_proceed_versions SET status = CASE WHEN status = 'issued' THEN 'acknowledged' ELSE status END WHERE tenant_id = $1 AND id = $2", [partner.tenant_id, noticeId]);
        return { entityType: "notice_acknowledgment", entityId: ack.rows[0].id, afterState: this.safeAck(ack.rows[0]) };
      });
    });
  }

  private async latestOrEvaluate(client: PoolClient, request: AuthenticatedRequest, context: MobilizationContext, internal: boolean, view: "admin" | "foreman" = "admin") {
    const evaluation = await this.currentEvaluation(client, context);
    if (!evaluation) return this.evaluateAndStore(client, request, context, "explicit_request", internal);
    const checks = await this.evaluationChecks(client, context.tenant_id, evaluation.id);
    return view === "foreman" ? this.safeForemanEvaluation(evaluation, checks) : this.safeEvaluation(evaluation, checks, internal);
  }

  private async currentEvaluation(client: PoolClient, context: MobilizationContext) {
    const result = await client.query("SELECT * FROM mobilization_readiness_evaluations WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id]);
    return result.rows[0] ?? null;
  }

  private async evaluationChecks(client: PoolClient, tenantId: string, evaluationId: string): Promise<Check[]> {
    const result = await client.query("SELECT requirement_code AS code, requirement_category AS category, status, severity, override_policy, external_detail, internal_detail, source_type, source_record_id, source_version, source_observed_state, override_id FROM mobilization_readiness_check_results WHERE tenant_id = $1 AND evaluation_id = $2 ORDER BY requirement_category, requirement_code", [tenantId, evaluationId]);
    return result.rows as Check[];
  }

  private safeEvaluation(row: QueryResultRow, checks: Check[], internal: boolean) {
    const visible = checks.map((check) => ({
      requirement_code: check.code,
      category: check.category,
      status: check.status,
      severity: check.severity,
      override_policy: check.override_policy,
      external_detail: check.external_detail,
      source: internal ? { type: check.source_type, id: check.source_record_id, version: check.source_version, observed_state: check.source_observed_state } : undefined,
      internal_detail: internal ? check.internal_detail : undefined,
    }));
    return {
      id: row.id,
      overall_status: row.overall_status,
      passed_check_count: Number(row.passed_check_count ?? 0),
      blocker_count: Number(row.blocker_count ?? 0),
      warning_count: Number(row.warning_count ?? 0),
      evaluated_at: row.evaluated_at,
      blockers: visible.filter((check) => check.status === "failed" && check.severity === "blocker"),
      warnings: visible.filter((check) => check.status === "warning" || check.status === "waived"),
      passed_checks: visible.filter((check) => ["passed", "waived", "not_applicable"].includes(check.status)),
      decision: undefined,
    };
  }

  private safeForemanEvaluation(row: QueryResultRow, checks: Check[]) {
    const allowed = checks.filter((check) => ["crew", "vehicle", "operator", "work_order", "project_requirement"].includes(check.category) && check.code !== "commercial_terms_assigned");
    return this.safeEvaluation(row, allowed, false);
  }

  private safeDecision(row: QueryResultRow, internal: boolean) {
    void internal;
    return { id: row.id, decision: row.decision, decision_at: row.decision_at, readiness_evaluation_id: row.readiness_evaluation_id, external_conditions: row.external_conditions ?? [], expires_at: row.expires_at, revocation_reason: row.revocation_reason };
  }

  private safeNotice(row: QueryResultRow, auth: QueryResultRow | null, internal: boolean) {
    void internal;
    return { id: row.id, notice_number: row.notice_number, version_number: row.version_number, status: row.status, production_start: auth ? this.safeProductionStart(auth) : null, production_start_status: row.production_start_status, planned_mobilization_date: this.dateOnlyOrNull(row.planned_mobilization_date), production_start_date: this.dateOnlyOrNull(row.production_start_date), production_start_time: String(row.production_start_time).slice(0, 8), timezone: row.timezone, initial_map_work_package_ref: row.initial_map_work_package_ref, initial_work_area: row.initial_work_area, external_instructions: row.external_instructions, external_conditions: row.external_conditions ?? [] };
  }

  private safeForemanNotice(row: QueryResultRow, auth: QueryResultRow | null) {
    const notice = this.safeNotice(row, auth, false);
    return { id: notice.id, notice_number: notice.notice_number, version_number: notice.version_number, status: notice.status, production_start: notice.production_start, production_start_date: notice.production_start_date, production_start_time: notice.production_start_time, timezone: notice.timezone, initial_map_work_package_ref: notice.initial_map_work_package_ref, initial_work_area: notice.initial_work_area, external_instructions: notice.external_instructions };
  }

  private safeProductionStart(row: QueryResultRow) {
    return { id: row.id, authorization_status: row.authorization_status, start_date: this.dateOnlyOrNull(row.start_date), start_time: String(row.start_time).slice(0, 8), timezone: row.timezone, map_work_package_ref: row.map_work_package_ref, work_area: row.work_area };
  }

  private safeOverride(row: QueryResultRow) {
    return { id: row.id, requirement_code: row.requirement_code, status: row.status, external_condition: row.external_condition, expires_at: row.expires_at };
  }

  private safeAck(row: QueryResultRow) {
    return { id: row.id, notice_id: row.notice_id, partner_persona: row.partner_persona, acknowledgment_type: row.acknowledgment_type, acknowledged_at: row.acknowledged_at };
  }

  private async requirePartner(client: PoolClient, request: AuthenticatedRequest, roleKey: "partner_admin" | "partner_foreman", requestedOrganizationId?: string): Promise<PartnerContext> {
    if (!partnerRoles.has(roleKey)) throw new ForbiddenException("invalid Partner persona");
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
    const selected = requestedOrganizationId ? result.rows.find((row) => row.organization_id === requestedOrganizationId) : result.rows[0];
    if (!selected || (!requestedOrganizationId && result.rows.length !== 1)) throw new ForbiddenException("Partner scope is unavailable or ambiguous");
    return {
      user: { id: selected.user_id, display_name: selected.display_name, tenant_user_id: selected.tenant_user_id },
      tenant_id: request.auth.tenantId,
      persona: roleKey,
      organization: { id: selected.organization_id, name: selected.organization_name, status: selected.organization_status },
      capacityProvider: { id: selected.capacity_provider_id, name: selected.capacity_provider_name, provider_type: selected.provider_type, status: selected.provider_status },
    };
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
    return result.rows[0].id as string;
  }

  private async requireInternalOrganizationAccess(client: PoolClient, request: AuthenticatedRequest, organizationId: string) {
    await this.organizationScope.requireOrganizationAccess(client, request.auth.tenantId, request.auth.userId, organizationId, "capacity_provider.read");
  }

  private async currentRow(client: PoolClient, table: string, context: MobilizationContext) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status <> 'superseded' LIMIT 1`, [context.tenant_id, context.organization_id]);
    return result.rows[0] ?? null;
  }

  private async contextRequirements(client: PoolClient, context: MobilizationContext) {
    const result = await client.query("SELECT * FROM mobilization_context_requirements WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3 AND deleted_at IS NULL", [context.tenant_id, context.organization_id, context.work_order_version_id]);
    return result.rows;
  }

  private async upsertContextRequirements(client: PoolClient, request: AuthenticatedRequest, context: MobilizationContext, requirements: unknown) {
    if (!Array.isArray(requirements)) return;
    for (const entry of requirements) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const code = requireString(item.requirement_code, "requirement_code is required");
      await client.query(
        `
        INSERT INTO mobilization_context_requirements (tenant_id, organization_id, work_order_version_id, requirement_code, required, external_message, created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (tenant_id, work_order_version_id, requirement_code) WHERE deleted_at IS NULL
        DO UPDATE SET required = EXCLUDED.required, external_message = EXCLUDED.external_message
        `,
        [context.tenant_id, context.organization_id, context.work_order_version_id, code, item.required !== false, item.external_message ?? null, request.auth.userId],
      );
    }
  }

  private async activeOverrides(client: PoolClient, context: MobilizationContext) {
    const result = await client.query("SELECT * FROM mobilization_overrides WHERE tenant_id = $1 AND organization_id = $2 AND work_order_version_id = $3 AND crew_assignment_id = $4 AND status = 'active' AND expires_at > now()", [context.tenant_id, context.organization_id, context.work_order_version_id, context.crew_assignment_id]);
    return new Map(result.rows.map((row) => [row.requirement_code, row]));
  }

  private async expireOverrides(client: PoolClient, context: MobilizationContext) {
    await client.query("UPDATE mobilization_overrides SET status = 'expired' WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND status = 'active' AND expires_at <= now()", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id]);
  }

  private async currentDecision(client: PoolClient, context: MobilizationContext) {
    const result = await client.query("SELECT * FROM mobilization_decisions WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id]);
    return result.rows[0] ?? null;
  }

  private async currentNotice(client: PoolClient, context: MobilizationContext) {
    const result = await client.query("SELECT * FROM notice_to_proceed_versions WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id]);
    return result.rows[0] ?? null;
  }

  private async requireNotice(client: PoolClient, tenantId: string, organizationId: string, noticeId: string) {
    const result = await client.query("SELECT * FROM notice_to_proceed_versions WHERE tenant_id = $1 AND organization_id = $2 AND id = $3", [tenantId, organizationId, noticeId]);
    if (!result.rows[0]) throw new NotFoundException("Notice not found");
    return result.rows[0];
  }

  private async currentProductionStart(client: PoolClient, notice: QueryResultRow) {
    const result = await client.query("SELECT * FROM production_start_authorizations WHERE tenant_id = $1 AND notice_id = $2 AND current = true", [notice.tenant_id, notice.id]);
    return result.rows[0] ?? null;
  }

  private async holdCurrentNoticeAndStart(client: PoolClient, context: MobilizationContext, reason: string) {
    await client.query("UPDATE notice_to_proceed_versions SET status = 'held', production_start_status = 'held', hold_reason = $4 WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true AND status IN ('issued','acknowledged','scheduled','authorized')", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id, reason]);
    await client.query("UPDATE production_start_authorizations SET authorization_status = 'held' WHERE tenant_id = $1 AND work_order_version_id = $2 AND crew_assignment_id = $3 AND current = true AND authorization_status IN ('scheduled','authorized')", [context.tenant_id, context.work_order_version_id, context.crew_assignment_id]);
  }

  private async autoHold(client: PoolClient, request: AuthenticatedRequest, context: MobilizationContext, evaluationId: string, reason: string) {
    const current = await this.currentDecision(client, context);
    if (!current || ["hold", "revoked"].includes(current.decision)) return;
    await this.writeWithClient(client, request, "mobilization.hold", "mobilization.held", "mobilization_decision", async (writeClient) => {
      await writeClient.query("UPDATE mobilization_decisions SET current = false WHERE tenant_id = $1 AND id = $2", [context.tenant_id, current.id]);
      const inserted = await writeClient.query(
        "INSERT INTO mobilization_decisions (tenant_id, project_id, work_order_id, work_order_version_id, organization_id, capacity_provider_id, crew_assignment_id, crew_id, vehicle_assignment_id, readiness_evaluation_id, decision, authorized_by_user_id, revocation_reason, supersedes_decision_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'hold',$11,$12,$13) RETURNING *",
        [context.tenant_id, context.project_id, context.work_order_id, context.work_order_version_id, context.organization_id, context.capacity_provider_id, context.crew_assignment_id, context.crew_id, context.vehicle_assignment_id, evaluationId, request.auth.userId, reason, current.id],
      );
      await this.holdCurrentNoticeAndStart(writeClient, context, reason);
      return { entityType: "mobilization_decision", entityId: inserted.rows[0].id, beforeState: this.safeDecision(current, true), afterState: this.safeDecision(inserted.rows[0], true) };
    });
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }

  private dateOnlyOrNull(value: unknown) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
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

function materialChange(prior: QueryResultRow | null, priorChecks: Check[], status: string, checks: Check[]) {
  if (!prior) return true;
  const blockerSet = checks.filter((check) => check.status === "failed" && check.severity === "blocker").map((check) => check.code).sort().join(",");
  const priorBlockerSet = priorChecks.filter((check) => check.status === "failed" && check.severity === "blocker").map((check) => check.code).sort().join(",");
  return prior.overall_status !== status || priorBlockerSet !== blockerSet;
}
