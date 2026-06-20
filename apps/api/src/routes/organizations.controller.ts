import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, requireAllowed, requireString } from "./intelligence.types";

const organizationTypes = new Set([
  "utility",
  "isp_carrier",
  "broadband_office",
  "municipality",
  "engineering_firm",
  "prime_contractor",
  "general_contractor_program_manager",
  "subcontractor",
  "vendor",
  "equipment_provider",
  "staffing_partner",
  "customer",
  "internal_company",
]);
const legacyOrganizationTypes = new Map([
  ["unknown", null],
  ["carrier", "isp_carrier"],
  ["contractor", "prime_contractor"],
  ["partner", "vendor"],
  ["agency", "municipality"],
]);
const actorRoles = new Set(["work_creator", "work_influencer", "work_distributor", "capacity_provider", "work_validator", "cash_controller", "vendor_enabler", "regulatory_public_actor"]);
const legacyActorRoles = new Map([
  ["owner", "work_creator"],
  ["influencer", "work_influencer"],
  ["distributor", "work_distributor"],
  ["provider", "capacity_provider"],
  ["validator", "work_validator"],
  ["payer", "cash_controller"],
]);
const organizationStatuses = new Set(["discovered", "researched", "qualified", "relationship_opened", "active", "strategic", "dormant", "archived"]);
const trustLevels = new Set(["unverified", "low", "medium", "high", "verified"]);
const archiveReasons = new Set(["duplicate", "inactive", "not_relevant", "bad_data", "merged", "out_of_territory", "no_longer_target", "other"]);

type EnrichedOrganizationRow = QueryResultRow & {
  id: string;
  organization_type: string | null;
  actor_roles: string[];
  territory_id: string | null;
  relationship_owner_user_id: string | null;
  status: string;
  contacts_count: number;
  verified_contacts_count: number;
  signals_count: number;
  candidates_count: number;
  opportunities_count: number;
  capacity_provider_count: number;
  open_constraints_count: number;
  recommendations_count: number;
};

@Controller("organizations")
export class OrganizationsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("organization.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listEnrichedOrganizations(client, request.auth.tenantId, query));
  }

  @Get(":id/detail")
  @RequirePermission("organization.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getOrganizationDetail(client, request.auth.tenantId, id));
  }

  @Get(":id/timeline")
  @RequirePermission("organization.timeline.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireOrganization(client, request.auth.tenantId, id);
      return this.organizationTimeline(client, request.auth.tenantId, id);
    });
  }

  @Get(":id/audit-summary")
  @RequirePermission("organization.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireOrganization(client, request.auth.tenantId, id);
      const result = await client.query(
        `
        SELECT
          al.id AS audit_id,
          al.actor_user_id AS actor_id,
          u.display_name AS actor_name,
          al.action,
          al.entity_type AS object_type,
          al.entity_id AS object_id,
          al.before_state AS before_json,
          al.after_state AS after_json,
          al.metadata->>'reason' AS reason,
          al.created_at,
          al.request_id AS correlation_id
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.tenant_id = $1
          AND al.entity_type = 'organization'
          AND al.entity_id = $2
        ORDER BY al.created_at DESC
        LIMIT 50
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get(":id")
  @RequirePermission("organization.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const record = await this.withClient((client) => this.getEnrichedOrganization(client, request.auth.tenantId, id));
    if (!record) throw new NotFoundException("organization not found");
    return record;
  }

  @Post()
  @RequirePermission("organization.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "organization name is required");
      const values = this.organizationValues(body, true);
      return await this.write(request, "organization.create", "organization.created", "organization", async (client) => {
        await this.validateTerritory(client, request.auth.tenantId, values.territory_id);
        await this.validateOwner(client, request.auth.tenantId, values.relationship_owner_user_id);
        const organization = await insertTenantRecord(client, "organizations", request.auth.tenantId, {
          ...values,
          name,
          status: values.status ?? "discovered",
        });
        return { entityType: "organization", entityId: organization.id, afterState: organization };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch(":id")
  @RequirePermission("organization.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.organizationValues(body, false);
      return await this.write(request, "organization.update", "organization.updated", "organization", async (client) => {
        await this.validateTerritory(client, request.auth.tenantId, values.territory_id);
        await this.validateOwner(client, request.auth.tenantId, values.relationship_owner_user_id);
        const before = await findTenantRecordById(client, "organizations", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("organization not found");
        const after = await updateTenantRecord(client, "organizations", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("organization not found");
        return { entityType: "organization", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post(":id/assign-owner")
  @RequirePermission("organization.assign_owner")
  async assignOwner(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const ownerUserId = requireString(body.owner_user_id, "owner_user_id is required");
    return this.write(request, "organization.assign_owner", "organization.owner_assigned", "organization", async (client) => {
      const before = await findTenantRecordById(client, "organizations", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("organization not found");
      await this.requireActiveTenantUser(client, request.auth.tenantId, ownerUserId);
      const after = await updateTenantRecord(client, "organizations", request.auth.tenantId, id, { relationship_owner_user_id: ownerUserId });
      if (!after) throw new NotFoundException("organization not found");
      return { entityType: "organization", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/qualify")
  @RequirePermission("organization.qualify")
  async qualify(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "organization.qualify", "organization.qualified", "organization", async (client) => {
      const before = await findTenantRecordById(client, "organizations", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("organization not found");
      if (!before.organization_type) throw new BadRequestException("organization type is required to qualify");
      if (!Array.isArray(before.actor_roles) || before.actor_roles.length === 0) throw new BadRequestException("actor role is required to qualify");
      if (!before.territory_id) throw new BadRequestException("territory is required to qualify");
      const values: Record<string, unknown> = {
        qualified_by: request.auth.userId,
        qualified_at: new Date(),
      };
      if (!["active", "strategic"].includes(String(before.status))) values.status = "qualified";
      const after = await updateTenantRecord(client, "organizations", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("organization not found");
      return { entityType: "organization", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/archive")
  @RequirePermission("organization.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let archiveReason: string;
    try {
      archiveReason = requireAllowed(body.archive_reason ?? body.reason, archiveReasons, "archive reason");
    } catch {
      throw new BadRequestException("Archive reason is required.");
    }
    return this.write(request, "organization.archive", "organization.archived", "organization", async (client) => {
      const before = await findTenantRecordById(client, "organizations", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("organization not found");
      const after = await updateTenantRecord(client, "organizations", request.auth.tenantId, id, {
        status: "archived",
        archive_reason: archiveReason,
        archive_note: body.archive_note,
        archived_by: request.auth.userId,
        archived_at: new Date(),
        deleted_at: new Date(),
      });
      if (!after) throw new NotFoundException("organization not found");
      return { entityType: "organization", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async listEnrichedOrganizations(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const rows = await this.enrichedOrganizationRows(client, tenantId);
    const filtered = rows.filter((row) => this.matchesOrganizationFilters(row, query));
    const sorted = this.sortOrganizations(filtered, query.sort ?? "default");
    const limit = Math.min(Number(query.limit ?? 50) || 50, 200);
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
    return sorted.slice(offset, offset + limit).map((row) => this.decorateOrganization(row));
  }

  private async getEnrichedOrganization(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.enrichedOrganizationRows(client, tenantId, id);
    const row = rows[0];
    return row ? this.decorateOrganization(row) : null;
  }

  private async getOrganizationDetail(client: PoolClient, tenantId: string, id: string) {
    const organization = await this.getEnrichedOrganization(client, tenantId, id);
    if (!organization) throw new NotFoundException("organization not found");
    const contacts = await this.contactsSummary(client, tenantId, id);
    const signals = await this.signalsSummary(client, tenantId, id);
    const candidates = await this.candidatesSummary(client, tenantId, id);
    const opportunities = await this.opportunitiesSummary(client, tenantId, id);
    const capacityProviders = await this.capacityProvidersSummary(client, tenantId, id);
    const capacitySummary = await this.capacitySummary(client, tenantId, id);
    const projectsSummary = await this.projectsSummary(client, tenantId, id);
    const financeSummary = await this.financeSummary(client, tenantId, id);
    const constraints = await this.constraintsSummary(client, tenantId, id);
    const recommendations = await this.recommendationsSummary(client, tenantId, id);
    const learningScores = await this.learningSummary(client, tenantId, id);
    const events = await this.organizationTimeline(client, tenantId, id, 10);
    return {
      organization,
      contacts,
      signals,
      candidates,
      opportunities,
      capacity: { providers: capacityProviders, ...capacitySummary },
      projects: projectsSummary,
      finance: financeSummary,
      constraints,
      recommendations,
      learning: learningScores,
      events,
      audit_allowed: true,
      completeness: {
        score: organization.completeness_score,
        band: organization.completeness_band,
        missing_items: organization.missing_intelligence_items,
      },
      actor_guidance: this.actorGuidance(organization),
    };
  }

  private async enrichedOrganizationRows(client: PoolClient, tenantId: string, id?: string) {
    const result = await client.query<EnrichedOrganizationRow>(
      `
      SELECT
        o.*,
        COALESCE(o.organization_type, NULLIF(o.type, 'unknown')) AS organization_type,
        t.name AS territory_name,
        u.display_name AS relationship_owner_name,
        COALESCE(contact_counts.contacts_count, 0)::int AS contacts_count,
        COALESCE(contact_counts.verified_contacts_count, 0)::int AS verified_contacts_count,
        COALESCE(signal_counts.signals_count, 0)::int AS signals_count,
        COALESCE(candidate_counts.candidates_count, 0)::int AS candidates_count,
        COALESCE(opportunity_counts.opportunities_count, 0)::int AS opportunities_count,
        COALESCE(capacity_counts.capacity_provider_count, 0)::int AS capacity_provider_count,
        COALESCE(constraint_counts.open_constraints_count, 0)::int AS open_constraints_count,
        COALESCE(recommendation_counts.recommendations_count, 0)::int AS recommendations_count,
        COALESCE(payment_stats.payment_count, 0)::int AS payment_stats_count
      FROM organizations o
      LEFT JOIN territories t ON t.tenant_id = o.tenant_id AND t.id = o.territory_id AND t.deleted_at IS NULL
      LEFT JOIN users u ON u.id = o.relationship_owner_user_id
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS contacts_count,
          count(*) FILTER (WHERE verification_status = 'verified' OR status = 'verified') AS verified_contacts_count
        FROM contacts c
        WHERE c.tenant_id = o.tenant_id AND c.organization_id = o.id AND c.deleted_at IS NULL
      ) contact_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT s.id) AS signals_count
        FROM signals s
        LEFT JOIN signal_entities se ON se.tenant_id = s.tenant_id AND se.signal_id = s.id AND se.entity_type = 'organization' AND se.archived_at IS NULL AND se.deleted_at IS NULL
        WHERE s.tenant_id = o.tenant_id AND s.deleted_at IS NULL AND se.entity_id = o.id
      ) signal_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS candidates_count
        FROM opportunity_candidates oc
        WHERE oc.tenant_id = o.tenant_id AND oc.organization_id = o.id AND oc.deleted_at IS NULL
      ) candidate_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS opportunities_count
        FROM opportunities op
        WHERE op.tenant_id = o.tenant_id AND op.organization_id = o.id AND op.deleted_at IS NULL
      ) opportunity_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS capacity_provider_count
        FROM capacity_providers cp
        WHERE cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.deleted_at IS NULL
      ) capacity_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS open_constraints_count
        FROM constraints c
        WHERE c.tenant_id = o.tenant_id
          AND c.deleted_at IS NULL
          AND c.status NOT IN ('closed', 'archived')
          AND c.affected_object_type = 'organization'
          AND c.affected_object_id = o.id
      ) constraint_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS recommendations_count
        FROM recommendations r
        WHERE r.tenant_id = o.tenant_id
          AND r.deleted_at IS NULL
          AND r.related_object_type = 'organization'
          AND r.related_object_id = o.id
      ) recommendation_counts ON true
      LEFT JOIN customer_payment_stats payment_stats ON payment_stats.tenant_id = o.tenant_id AND payment_stats.customer_organization_id = o.id
      WHERE o.tenant_id = $1
        AND ($2::uuid IS NULL OR o.id = $2::uuid)
      `,
      [tenantId, id ?? null],
    );
    return result.rows;
  }

  private matchesOrganizationFilters(row: EnrichedOrganizationRow, query: Record<string, string | undefined>) {
    const archived = Boolean(row.archived_at || row.deleted_at || row.status === "archived");
    if (query.archived === undefined && archived) return false;
    if (query.archived !== undefined && String(archived) !== query.archived) return false;
    if (query.organization_type && row.organization_type !== this.normalizeOrganizationType(query.organization_type)) return false;
    if (query.actor_role && !row.actor_roles.includes(this.normalizeActorRole(query.actor_role))) return false;
    if (query.territory_id && row.territory_id !== query.territory_id) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.strategic_flag !== undefined && String(Boolean(row.strategic_flag)) !== query.strategic_flag) return false;
    if (query.relationship_owner_user_id && row.relationship_owner_user_id !== query.relationship_owner_user_id) return false;
    if (query.trust_level && row.trust_level !== query.trust_level) return false;
    if (!this.inRange(row.influence_score, query.influence_min, query.influence_max)) return false;
    if (!this.inRange(row.work_relevance_score, query.work_relevance_min, query.work_relevance_max)) return false;
    if (!this.inRange(row.capacity_relevance_score, query.capacity_relevance_min, query.capacity_relevance_max)) return false;
    if (!this.inRange(row.payment_relevance_score, query.payment_relevance_min, query.payment_relevance_max)) return false;
    if (query.has_contacts !== undefined && String(row.contacts_count > 0) !== query.has_contacts) return false;
    if (query.has_signals !== undefined && String(row.signals_count > 0) !== query.has_signals) return false;
    if (query.has_opportunities !== undefined && String(row.opportunities_count > 0) !== query.has_opportunities) return false;
    if (query.q) {
      const haystack = `${row.name ?? ""} ${row.legal_name ?? ""} ${row.organization_type ?? ""} ${row.actor_roles.join(" ")}`.toLowerCase();
      if (!haystack.includes(query.q.toLowerCase())) return false;
    }
    return true;
  }

  private sortOrganizations(rows: EnrichedOrganizationRow[], sort: string) {
    const value = (input: unknown) => (input === null || input === undefined ? -1 : Number(input));
    const updated = (input: EnrichedOrganizationRow) => Date.parse(String(input.updated_at ?? input.created_at ?? 0));
    return [...rows].sort((a, b) => {
      if (sort === "name_asc") return String(a.name).localeCompare(String(b.name));
      if (sort === "updated_desc") return updated(b) - updated(a);
      if (sort === "influence_desc") return value(b.influence_score) - value(a.influence_score);
      if (sort === "work_relevance_desc") return value(b.work_relevance_score) - value(a.work_relevance_score);
      if (sort === "capacity_relevance_desc") return value(b.capacity_relevance_score) - value(a.capacity_relevance_score);
      if (sort === "payment_relevance_desc") return value(b.payment_relevance_score) - value(a.payment_relevance_score);
      const strategic = Number(Boolean(b.strategic_flag)) - Number(Boolean(a.strategic_flag));
      if (strategic !== 0) return strategic;
      const influence = value(b.influence_score) - value(a.influence_score);
      if (influence !== 0) return influence;
      return updated(b) - updated(a);
    });
  }

  private decorateOrganization(row: EnrichedOrganizationRow) {
    const checklist = this.completenessChecklist(row);
    const completed = checklist.filter((item) => item.complete).length;
    const completenessScore = Math.round((completed / checklist.length) * 100);
    return {
      ...row,
      type: row.organization_type,
      completeness_score: completenessScore,
      completeness_band: this.completenessBand(completenessScore),
      missing_intelligence_items: checklist.filter((item) => !item.complete).map((item) => item.key),
      recommended_next_action: this.recommendedNextAction(row),
    };
  }

  private completenessChecklist(row: EnrichedOrganizationRow) {
    const relevantWorkRequired = row.actor_roles.includes("work_creator") || row.actor_roles.includes("work_influencer") || row.actor_roles.includes("work_distributor");
    const capacityRequired = row.actor_roles.includes("capacity_provider");
    const paymentRequired = row.actor_roles.includes("cash_controller") || row.organization_type === "customer";
    return [
      { key: "identity_complete", complete: Boolean(row.name && row.organization_type) },
      { key: "organization_type_assigned", complete: Boolean(row.organization_type) },
      { key: "actor_role_assigned", complete: row.actor_roles.length > 0 },
      { key: "territory_assigned", complete: Boolean(row.territory_id) },
      { key: "relationship_owner_assigned", complete: Boolean(row.relationship_owner_user_id) },
      { key: "contact_exists", complete: row.contacts_count > 0 },
      { key: "verified_contact_exists", complete: row.verified_contacts_count > 0 },
      { key: "signal_or_candidate_or_opportunity_exists_when_relevant", complete: !relevantWorkRequired || row.signals_count + row.candidates_count + row.opportunities_count > 0 },
      { key: "capacity_profile_exists_if_capacity_provider", complete: !capacityRequired || row.capacity_provider_count > 0 },
      { key: "payment_stats_exist_if_customer_or_cash_controller", complete: !paymentRequired || Number(row.payment_stats_count ?? 0) > 0 },
    ];
  }

  private recommendedNextAction(row: EnrichedOrganizationRow) {
    if (row.status === "archived") return "view_only";
    if (!row.relationship_owner_user_id) return "assign_owner";
    if (!row.actor_roles.length) return "assign_actor_role";
    if (!row.territory_id) return "assign_territory";
    if (row.contacts_count === 0) return "add_contact";
    if (row.verified_contacts_count === 0) return "verify_contact";
    if (row.actor_roles.includes("work_creator") && row.signals_count === 0) return "add_signal";
    if (row.actor_roles.includes("capacity_provider") && row.capacity_provider_count === 0) return "add_capacity_provider";
    return "review_profile";
  }

  private async contactsSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT id, full_name AS name, title, NULL::text AS department, NULL::text AS contact_role, email, phone,
        verification_status, NULL::int AS influence_score, NULL::int AS decision_authority_score,
        NULL::int AS relationship_strength_score, NULL::timestamptz AS last_contacted_at, NULL::text AS owner_name
      FROM contacts
      WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 50
      `,
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async signalsSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT s.id, s.title, s.signal_category AS category, s.signal_type AS type, s.confidence_score,
        s.trust_level, s.status, s.source_name, s.date_discovered,
        COALESCE(cs.candidate_count, 0)::int AS candidate_count,
        CASE
          WHEN s.status = 'archived' THEN 'view_only'
          WHEN COALESCE(cs.candidate_count, 0) > 0 THEN 'view_candidate'
          WHEN s.status = 'verified' THEN 'create_candidate'
          ELSE 'continue_investigation'
        END AS recommended_next_action
      FROM signals s
      LEFT JOIN signal_entities se ON se.tenant_id = s.tenant_id AND se.signal_id = s.id AND se.entity_type = 'organization' AND se.archived_at IS NULL AND se.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT count(*) AS candidate_count FROM candidate_signals csl WHERE csl.tenant_id = s.tenant_id AND csl.signal_id = s.id AND csl.deleted_at IS NULL
      ) cs ON true
      WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND se.entity_id = $2
      ORDER BY s.date_discovered DESC NULLS LAST, s.updated_at DESC
      LIMIT 50
      `,
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async candidatesSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT oc.id, COALESCE(oc.name, oc.title) AS name, oc.status, COALESCE(oc.confidence_score, oc.score) AS score,
        oc.confidence_score, NULL::numeric AS estimated_value, oc.work_type, u.display_name AS owner_name,
        COALESCE(cs.attached_signal_count, 0)::int AS attached_signal_count
      FROM opportunity_candidates oc
      LEFT JOIN users u ON u.id = oc.owner_user_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS attached_signal_count FROM candidate_signals csl WHERE csl.tenant_id = oc.tenant_id AND csl.candidate_id = oc.id AND csl.deleted_at IS NULL
      ) cs ON true
      WHERE oc.tenant_id = $1 AND oc.organization_id = $2 AND oc.deleted_at IS NULL
      ORDER BY oc.updated_at DESC
      LIMIT 50
      `,
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async opportunitiesSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT id, title AS name, status, estimated_value, pursuit_score, NULL::numeric AS capacity_coverage,
        relationship_access_score, NULL::text AS owner_name, review_date AS decision_date
      FROM opportunities
      WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 50
      `,
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async capacityProvidersSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query("SELECT id, name, provider_type, status, verification_status, contract_status FROM capacity_providers WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC", [tenantId, organizationId]);
    return result.rows;
  }

  private async capacitySummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT
        count(DISTINCT cp.id)::int AS provider_count,
        count(DISTINCT cr.id)::int AS crew_count,
        count(DISTINCT w.id)::int AS worker_count,
        count(DISTINCT e.id)::int AS equipment_count,
        count(DISTINCT cap.id)::int AS capacity_records_count,
        max(cap.readiness_score)::numeric AS readiness_score
      FROM capacity_providers cp
      LEFT JOIN crews cr ON cr.tenant_id = cp.tenant_id AND cr.capacity_provider_id = cp.id AND cr.deleted_at IS NULL
      LEFT JOIN workers w ON w.tenant_id = cp.tenant_id AND w.capacity_provider_id = cp.id AND w.deleted_at IS NULL
      LEFT JOIN equipment e ON e.tenant_id = cp.tenant_id AND e.capacity_provider_id = cp.id AND e.deleted_at IS NULL
      LEFT JOIN capacity_records cap ON cap.tenant_id = cp.tenant_id AND cap.capacity_provider_id = cp.id AND cap.deleted_at IS NULL
      WHERE cp.tenant_id = $1 AND cp.organization_id = $2 AND cp.deleted_at IS NULL
      `,
      [tenantId, organizationId],
    );
    return result.rows[0] ?? {};
  }

  private async projectsSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT
        count(DISTINCT p.id)::int AS projects_count,
        count(DISTINCT p.id) FILTER (WHERE p.status = 'active')::int AS active_projects,
        count(DISTINCT wo.id)::int AS work_orders_count,
        count(DISTINCT pr.id)::int AS production_records_count,
        count(DISTINCT pr.id) FILTER (WHERE pr.status = 'billable')::int AS billable_production_count,
        count(DISTINCT pr.id) FILTER (WHERE pr.stop_work_status = 'active')::int AS stop_work_count
      FROM projects p
      LEFT JOIN work_orders wo ON wo.tenant_id = p.tenant_id AND wo.project_id = p.id AND wo.deleted_at IS NULL
      LEFT JOIN production_records pr ON pr.tenant_id = p.tenant_id AND pr.project_id = p.id AND pr.deleted_at IS NULL
      WHERE p.tenant_id = $1 AND p.customer_organization_id = $2 AND p.deleted_at IS NULL
      `,
      [tenantId, organizationId],
    );
    return result.rows[0] ?? {};
  }

  private async financeSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      `
      SELECT
        (SELECT count(*)::int FROM contracts WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS contracts_count,
        (SELECT count(*)::int FROM settlements WHERE tenant_id = $1 AND customer_organization_id = $2 AND deleted_at IS NULL) AS settlements_count,
        (SELECT count(*)::int FROM invoices WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL) AS invoices_count,
        (SELECT COALESCE(sum(amount_open), 0)::numeric FROM ar_records WHERE tenant_id = $1 AND customer_organization_id = $2 AND deleted_at IS NULL AND status <> 'archived') AS open_ar_amount,
        (SELECT count(*)::int FROM payments p JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id WHERE p.tenant_id = $1 AND i.organization_id = $2 AND p.deleted_at IS NULL) AS payments_count,
        cps.average_days_to_pay,
        cps.short_pay_count,
        (SELECT COALESCE(sum(amount_open), 0)::numeric FROM ar_records WHERE tenant_id = $1 AND customer_organization_id = $2 AND deleted_at IS NULL AND status <> 'archived') AS open_balance
      FROM customer_payment_stats cps
      WHERE cps.tenant_id = $1 AND cps.customer_organization_id = $2
      UNION ALL
      SELECT 0, 0, 0, 0, 0, NULL, NULL, 0
      WHERE NOT EXISTS (SELECT 1 FROM customer_payment_stats WHERE tenant_id = $1 AND customer_organization_id = $2)
      LIMIT 1
      `,
      [tenantId, organizationId],
    );
    return result.rows[0] ?? {};
  }

  private async constraintsSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      "SELECT id, constraint_type, affected_object_type, severity, owner_id, due_date, status, resolution_summary FROM constraints WHERE tenant_id = $1 AND affected_object_type = 'organization' AND affected_object_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50",
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async recommendationsSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      "SELECT id, recommendation_type, related_object_type, confidence_score, risk_level, expected_impact, status FROM recommendations WHERE tenant_id = $1 AND related_object_type = 'organization' AND related_object_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50",
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async learningSummary(client: PoolClient, tenantId: string, organizationId: string) {
    const result = await client.query(
      "SELECT id, score_type, score_value, confidence, updated_at FROM learning_scores WHERE tenant_id = $1 AND (object_type = 'organization' AND object_id = $2 OR entity_type = 'organization' AND entity_id = $2) AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 25",
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async organizationTimeline(client: PoolClient, tenantId: string, organizationId: string, limit = 50) {
    const result = await client.query(
      `
      SELECT
        e.id AS event_id,
        e.event_type,
        e.actor_user_id AS actor_id,
        u.display_name AS actor_name,
        e.occurred_at AS timestamp,
        e.aggregate_type AS object_type,
        e.aggregate_id AS object_id,
        e.event_type AS summary,
        ep.payload
      FROM events e
      LEFT JOIN users u ON u.id = e.actor_user_id
      LEFT JOIN event_payloads ep ON ep.event_id = e.id
      WHERE e.tenant_id = $1
        AND (
          (e.aggregate_type = 'organization' AND e.aggregate_id = $2)
          OR (e.aggregate_type = 'contact' AND e.aggregate_id IN (SELECT id FROM contacts WHERE tenant_id = $1 AND organization_id = $2))
          OR (e.aggregate_type = 'signal' AND e.aggregate_id IN (
            SELECT s.id
            FROM signals s
            LEFT JOIN signal_entities se ON se.tenant_id = s.tenant_id AND se.signal_id = s.id AND se.entity_type = 'organization' AND se.archived_at IS NULL AND se.deleted_at IS NULL
            WHERE s.tenant_id = $1 AND se.entity_id = $2
          ))
          OR (e.aggregate_type = 'opportunity_candidate' AND e.aggregate_id IN (SELECT id FROM opportunity_candidates WHERE tenant_id = $1 AND organization_id = $2))
          OR (e.aggregate_type = 'opportunity' AND e.aggregate_id IN (SELECT id FROM opportunities WHERE tenant_id = $1 AND organization_id = $2))
          OR (e.aggregate_type = 'capacity_provider' AND e.aggregate_id IN (SELECT id FROM capacity_providers WHERE tenant_id = $1 AND organization_id = $2))
          OR (e.aggregate_type = 'constraint' AND e.aggregate_id IN (SELECT id FROM constraints WHERE tenant_id = $1 AND affected_object_type = 'organization' AND affected_object_id = $2))
          OR (e.aggregate_type = 'recommendation' AND e.aggregate_id IN (SELECT id FROM recommendations WHERE tenant_id = $1 AND related_object_type = 'organization' AND related_object_id = $2))
        )
      ORDER BY e.occurred_at DESC
      LIMIT $3
      `,
      [tenantId, organizationId, limit],
    );
    return result.rows;
  }

  private actorGuidance(organization: Record<string, unknown>) {
    const roles = Array.isArray(organization.actor_roles) ? organization.actor_roles.map(String) : [];
    const type = String(organization.organization_type ?? "");
    const primaryQuestion = roles.includes("capacity_provider")
      ? "Can they help us cover work?"
      : roles.includes("cash_controller")
        ? "Can they approve and pay correctly?"
        : roles.includes("work_distributor")
          ? "Can they route work to Jackson?"
          : roles.includes("work_influencer")
            ? "What work do they know about or influence before construction starts?"
            : "What work might they create?";
    const typeGuidance: Record<string, string[]> = {
      utility: ["service territory", "infrastructure relevance", "related signals", "field contacts", "AP contacts"],
      isp_carrier: ["markets served", "expansion signals", "construction contacts", "vendor manager contacts", "payment process"],
      broadband_office: ["funding programs", "award timelines", "eligible territories", "public activity signals"],
      municipality: ["jurisdiction", "ROW or permitting", "public works contacts", "meeting agenda signals"],
      engineering_firm: ["design territories", "utility or ISP relationships", "design signals", "project managers"],
      prime_contractor: ["regions served", "subcontractor onboarding path", "regional PMs", "vendor contacts", "payment behavior"],
      customer: ["contracts", "settlements", "invoices", "AR", "payments", "average days to pay"],
    };
    return {
      primary_question: primaryQuestion,
      emphasis_sections: typeGuidance[type] ?? ["contacts", "signals", "constraints", "recommendations"],
      missing_intelligence_focus: organization.missing_intelligence_items ?? [],
      suggested_next_action: organization.recommended_next_action ?? "review_profile",
    };
  }

  private organizationValues(body: Record<string, unknown>, creating: boolean) {
    const values = pick(body, [
      "name",
      "legal_name",
      "dba_name",
      "website",
      "main_phone",
      "main_email",
      "address_line_1",
      "address_line_2",
      "city",
      "state",
      "postal_code",
      "country",
      "territory_id",
      "relationship_owner_user_id",
      "description",
    ]);
    const organizationType = this.normalizeOrganizationType(body.organization_type ?? body.type);
    if (organizationType !== undefined) {
      values.organization_type = organizationType;
      values.type = organizationType ?? "unknown";
    } else if (creating) {
      values.type = "unknown";
    }
    if (body.actor_roles !== undefined) values.actor_roles = this.normalizeActorRoles(body.actor_roles);
    if (body.status !== undefined) values.status = requireAllowed(body.status, organizationStatuses, "organization status");
    if (body.trust_level !== undefined) values.trust_level = requireAllowed(body.trust_level, trustLevels, "trust_level");
    if (body.strategic_flag !== undefined) values.strategic_flag = Boolean(body.strategic_flag);
    for (const field of ["influence_score", "work_relevance_score", "capacity_relevance_score", "payment_relevance_score"]) {
      if (body[field] !== undefined) values[field] = optionalScore(body[field], field);
    }
    return values;
  }

  private normalizeOrganizationType(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new Error("organization type is invalid");
    const normalized = value.trim();
    if (legacyOrganizationTypes.has(normalized)) return legacyOrganizationTypes.get(normalized) ?? null;
    if (!organizationTypes.has(normalized)) throw new Error("organization type is invalid");
    return normalized;
  }

  private normalizeActorRoles(value: unknown): string[] {
    if (!Array.isArray(value)) throw new Error("actor_roles must be an array");
    const roles = value.map((raw) => this.normalizeActorRole(raw));
    return Array.from(new Set(roles));
  }

  private normalizeActorRole(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("actor_role is invalid");
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const role = legacyActorRoles.get(normalized) ?? normalized;
    if (!actorRoles.has(role)) throw new Error("actor_role is invalid");
    return role;
  }

  private inRange(value: unknown, min?: string, max?: string) {
    const numeric = value === null || value === undefined ? null : Number(value);
    if (min !== undefined && (numeric === null || numeric < Number(min))) return false;
    if (max !== undefined && (numeric === null || numeric > Number(max))) return false;
    return true;
  }

  private completenessBand(score: number) {
    if (score < 40) return "incomplete";
    if (score < 70) return "partial";
    if (score < 90) return "usable";
    return "complete";
  }

  private async validateTerritory(client: PoolClient, tenantId: string, territoryId: unknown): Promise<void> {
    if (!territoryId) return;
    if (typeof territoryId !== "string") throw new Error("territory_id must be a string");
    const territory = await findTenantRecordById(client, "territories", tenantId, territoryId);
    if (!territory) throw new NotFoundException("territory not found in tenant");
  }

  private async validateOwner(client: PoolClient, tenantId: string, ownerUserId: unknown): Promise<void> {
    if (!ownerUserId) return;
    if (typeof ownerUserId !== "string") throw new Error("relationship_owner_user_id must be a string");
    await this.requireActiveTenantUser(client, tenantId, ownerUserId);
  }

  private async requireActiveTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      `
      SELECT u.id
      FROM users u
      JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = $1
      WHERE u.id = $2
        AND u.status = 'active'
        AND tu.status = 'active'
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("owner user not found in tenant");
  }

  private async requireOrganization(client: PoolClient, tenantId: string, id: string) {
    const organization = await findTenantRecordById(client, "organizations", tenantId, id);
    if (!organization) throw new NotFoundException("organization not found");
    return organization;
  }

  private async write<T>(
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
  ) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
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
