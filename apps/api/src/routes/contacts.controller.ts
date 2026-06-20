import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, requireAllowed, requireOne, requireString } from "./intelligence.types";

const contactRoles = new Set([
  "decision_maker",
  "executive_sponsor",
  "economic_buyer",
  "technical_buyer",
  "procurement_contact",
  "vendor_manager",
  "construction_manager",
  "project_manager",
  "field_supervisor",
  "field_inspector",
  "qc_contact",
  "safety_contact",
  "engineering_contact",
  "design_contact",
  "permitting_contact",
  "row_contact",
  "ap_contact",
  "billing_contact",
  "contract_manager",
  "subcontractor_owner",
  "subcontractor_foreman",
  "equipment_contact",
  "staffing_contact",
  "gatekeeper",
  "relationship_bridge",
  "influencer",
  "unknown",
]);
const contactStatuses = new Set(["discovered", "enriched", "verified", "contacted", "engaged", "relationship_active", "dormant", "invalid", "archived"]);
const verificationStatuses = new Set(["unverified", "partially_verified", "verified", "invalid", "stale"]);
const verificationMethods = new Set(["direct_confirmation", "email_validated", "phone_validated", "linkedin_confirmed", "organization_website", "public_source", "relationship_source", "internal_note"]);
const archiveReasons = new Set(["duplicate", "left_company", "not_relevant", "bad_data", "inactive", "other"]);
const invalidReasons = new Set(["bad_email", "bad_phone", "left_company", "wrong_person", "duplicate", "not_relevant", "other"]);
const interactionTypes = new Set(["call", "email", "meeting", "text", "introduction", "site_visit", "conference", "referral", "billing_discussion", "field_discussion", "other"]);
const interactionOutcomes = new Set(["no_response", "left_message", "connected", "positive_response", "negative_response", "requested_follow_up", "provided_information", "made_introduction", "resolved_issue"]);
const financeRoles = new Set(["ap_contact", "billing_contact", "contract_manager", "economic_buyer"]);

type EnrichedContactRow = QueryResultRow & {
  id: string;
  organization_id: string | null;
  contact_role: string;
  status: string;
  verification_status: string;
  relationship_owner_user_id: string | null;
  influence_score: number | null;
  decision_authority_score: number | null;
  relationship_strength_score: number | null;
  related_signals_count: number | null;
  related_candidates_count: number | null;
  related_opportunities_count: number | null;
  open_constraints_count: number | null;
  recommendations_count: number | null;
};

@Controller("contacts")
export class ContactsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("contact.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.listEnrichedContacts(client, request.auth.tenantId, query));
  }

  @Get(":id/detail")
  @RequirePermission("contact.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getContactDetail(client, request.auth.tenantId, id));
  }

  @Get(":id/timeline")
  @RequirePermission("contact.timeline.read")
  async timeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireContact(client, request.auth.tenantId, id);
      return this.contactTimeline(client, request.auth.tenantId, id);
    });
  }

  @Get(":id/audit-summary")
  @RequirePermission("contact.audit.read")
  async auditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireContact(client, request.auth.tenantId, id);
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
          AND al.entity_type = 'contact'
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
  @RequirePermission("contact.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    const record = await this.withClient((client) => this.getEnrichedContact(client, request.auth.tenantId, id));
    if (!record) throw new NotFoundException("contact not found");
    return record;
  }

  @Post()
  @RequirePermission("contact.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      requireOne([body.full_name, body.first_name, body.last_name], "contact name is required");
      const values = this.contactValues(body, true);
      return await this.write(request, "contact.create", "contact.created", async (client) => {
        await this.requireOrganization(client, request.auth.tenantId, values.organization_id);
        await this.validateTerritory(client, request.auth.tenantId, values.territory_id);
        await this.validateOwner(client, request.auth.tenantId, values.relationship_owner_user_id);
        const contact = await insertTenantRecord(client, "contacts", request.auth.tenantId, {
          ...values,
          full_name: values.full_name ?? [values.first_name, values.last_name].filter(Boolean).join(" "),
          status: values.status ?? "discovered",
          verification_status: values.verification_status ?? "unverified",
          contact_role: values.contact_role ?? "unknown",
        });
        return { entityType: "contact", entityId: contact.id, afterState: contact };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch(":id")
  @RequirePermission("contact.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.contactValues(body, false);
      return await this.write(request, "contact.update", "contact.updated", async (client) => {
        await this.validateOrganization(client, request.auth.tenantId, values.organization_id);
        await this.validateTerritory(client, request.auth.tenantId, values.territory_id);
        await this.validateOwner(client, request.auth.tenantId, values.relationship_owner_user_id);
        const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
        if (!before) throw new NotFoundException("contact not found");
        const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("contact not found");
        return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post(":id/verify")
  @RequirePermission("contact.verify")
  async verify(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let verificationMethod: string;
    try {
      verificationMethod = requireAllowed(body.verification_method ?? body.method, verificationMethods, "verification_method");
    } catch {
      throw new BadRequestException("Verification requires at least one contact method and a verification source or note.");
    }
    const verificationSource = typeof (body.verification_source ?? body.source) === "string" ? String(body.verification_source ?? body.source).trim() : "";
    const verificationNote = typeof (body.verification_note ?? body.note) === "string" ? String(body.verification_note ?? body.note).trim() : "";
    if (!verificationSource && !verificationNote) throw new BadRequestException("Verification requires at least one contact method and a verification source or note.");
    return this.write(request, "contact.verify", "contact.verified", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      if (before.status === "archived" || before.archived_at) throw new BadRequestException("This contact is archived. Actions are limited.");
      if (!this.hasContactMethod(before)) throw new BadRequestException("Verification requires at least one contact method and a verification source or note.");
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, {
        status: ["discovered", "enriched"].includes(String(before.status)) ? "verified" : before.status,
        verification_status: "verified",
        verification_method: verificationMethod,
        verification_source: verificationSource || null,
        verification_note: verificationNote || null,
        verified_by: request.auth.userId,
        verified_at: new Date(),
        last_verified_at: new Date(),
      });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/assign-owner")
  @RequirePermission("contact.assign_owner")
  async assignOwner(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let ownerUserId: string;
    try {
      ownerUserId = requireString(body.owner_user_id, "owner_user_id is required");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.write(request, "contact.assign_owner", "contact.owner_assigned", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      await this.requireActiveTenantUser(client, request.auth.tenantId, ownerUserId);
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, { relationship_owner_user_id: ownerUserId });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/mark-invalid")
  @RequirePermission("contact.mark_invalid")
  async markInvalid(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let invalidReason: string;
    try {
      invalidReason = requireAllowed(body.invalid_reason ?? body.reason, invalidReasons, "invalid_reason");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.write(request, "contact.mark_invalid", "contact.invalid", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, {
        status: "invalid",
        verification_status: "invalid",
        invalid_reason: invalidReason,
        invalid_note: body.invalid_note ?? body.note,
      });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/mark-contacted")
  @RequirePermission("contact.update")
  async markContacted(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let contactDate: Date;
    let interactionType: string;
    let summary: string;
    let outcome: string;
    try {
      contactDate = this.requireDate(body.contact_date, "contact_date is required");
      interactionType = requireAllowed(body.interaction_type, interactionTypes, "interaction_type");
      summary = requireString(body.summary, "summary is required");
      outcome = requireAllowed(body.outcome, interactionOutcomes, "outcome");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.write(request, "contact.update", "contact.contacted", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, {
        status: ["engaged", "relationship_active"].includes(String(before.status)) ? before.status : "contacted",
        last_contacted_at: contactDate,
        notes: this.appendNote(before.notes, `Contacted (${interactionType}/${outcome}): ${summary}`),
      });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: { ...after, interaction_type: interactionType, outcome, next_action: body.next_action, follow_up_date: body.follow_up_date } };
    });
  }

  @Post(":id/mark-engaged")
  @RequirePermission("contact.update")
  async markEngaged(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let engagementDate: Date;
    let summary: string;
    let outcome: string;
    try {
      engagementDate = this.requireDate(body.engagement_date, "engagement_date is required");
      summary = requireString(body.summary, "summary is required");
      outcome = requireString(body.outcome, "outcome is required");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.write(request, "contact.update", "contact.engaged", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, {
        status: "engaged",
        last_contacted_at: engagementDate,
        notes: this.appendNote(before.notes, `Engaged (${outcome}): ${summary}`),
      });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: { ...after, outcome } };
    });
  }

  @Post(":id/mark-relationship-active")
  @RequirePermission("contact.mark_relationship_active")
  async markRelationshipActive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let reason: string;
    let recentInteractionSummary: string;
    let relationshipStrengthScore: number | undefined;
    try {
      reason = requireString(body.reason, "reason is required");
      recentInteractionSummary = requireString(body.recent_interaction_summary, "recent_interaction_summary is required");
      relationshipStrengthScore = optionalScore(body.relationship_strength_score, "relationship_strength_score");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.write(request, "contact.mark_relationship_active", "contact.relationship_active", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      const values: Record<string, unknown> = {
        status: "relationship_active",
        notes: this.appendNote(before.notes, `Relationship active (${reason}): ${recentInteractionSummary}`),
      };
      if (relationshipStrengthScore !== undefined) values.relationship_strength_score = relationshipStrengthScore;
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/mark-dormant")
  @RequirePermission("contact.update")
  async markDormant(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let reason: string;
    try {
      reason = requireString(body.reason, "reason is required");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.write(request, "contact.update", "contact.dormant", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, {
        status: "dormant",
        notes: this.appendNote(before.notes, `Dormant: ${reason}`),
      });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post(":id/archive")
  @RequirePermission("contact.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    let archiveReason: string;
    try {
      archiveReason = requireAllowed(body.archive_reason ?? body.reason, archiveReasons, "archive reason");
    } catch {
      throw new BadRequestException("Archive reason is required.");
    }
    return this.write(request, "contact.archive", "contact.archived", async (client) => {
      const before = await findTenantRecordById(client, "contacts", request.auth.tenantId, id);
      if (!before) throw new NotFoundException("contact not found");
      const after = await updateTenantRecord(client, "contacts", request.auth.tenantId, id, {
        status: "archived",
        archive_reason: archiveReason,
        archive_note: body.archive_note ?? body.note,
        archived_by: request.auth.userId,
        archived_at: new Date(),
        deleted_at: new Date(),
      });
      if (!after) throw new NotFoundException("contact not found");
      return { entityType: "contact", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async listEnrichedContacts(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const rows = await this.enrichedContactRows(client, tenantId);
    const filtered = rows.filter((row) => this.matchesContactFilters(row, query));
    const sorted = this.sortContacts(filtered, query.sort ?? "default");
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return sorted.slice(offset, offset + limit).map((row) => this.decorateContact(row));
  }

  private async getEnrichedContact(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.enrichedContactRows(client, tenantId, id);
    return rows[0] ? this.decorateContact(rows[0]) : null;
  }

  private async getContactDetail(client: PoolClient, tenantId: string, id: string) {
    const contact = await this.getEnrichedContact(client, tenantId, id);
    if (!contact) throw new NotFoundException("contact not found");
    const [relatedSignals, relatedCandidates, relatedOpportunities, relatedProjects, financeRelevance, constraints, recommendations] = await Promise.all([
      this.relatedSignals(client, tenantId, id),
      this.relatedCandidates(client, tenantId, id),
      this.relatedOpportunities(client, tenantId, id),
      this.relatedProjects(client, tenantId, contact),
      this.financeRelevance(client, tenantId, contact),
      this.constraintsSummary(client, tenantId, id),
      this.recommendationsSummary(client, tenantId, id),
    ]);
    return {
      contact,
      organization_context: this.organizationContext(contact),
      related_signals: relatedSignals,
      related_candidates: relatedCandidates,
      related_opportunities: relatedOpportunities,
      related_projects: relatedProjects,
      finance_relevance: financeRelevance,
      constraints_summary: constraints,
      recommendations_summary: recommendations,
      completeness: {
        score: contact.completeness_score,
        band: contact.completeness_band,
        missing_items: contact.missing_contact_items,
      },
      stale: contact.stale,
      timeline_available: true,
      audit_allowed: true,
    };
  }

  private async enrichedContactRows(client: PoolClient, tenantId: string, id?: string) {
    const result = await client.query<EnrichedContactRow>(
      `
      SELECT
        c.*,
        COALESCE(c.full_name, concat_ws(' ', c.first_name, c.last_name)) AS full_name,
        o.name AS organization_name,
        o.organization_type,
        o.actor_roles AS organization_actor_roles,
        o.status AS organization_status,
        o.strategic_flag AS organization_strategic_flag,
        o.influence_score AS organization_influence_score,
        o.work_relevance_score AS organization_work_relevance_score,
        o.capacity_relevance_score AS organization_capacity_relevance_score,
        o.payment_relevance_score AS organization_payment_relevance_score,
        t.name AS territory_name,
        u.display_name AS relationship_owner_name,
        COALESCE(signal_counts.related_signals_count, 0)::int AS related_signals_count,
        NULL::int AS related_candidates_count,
        NULL::int AS related_opportunities_count,
        COALESCE(constraint_counts.open_constraints_count, 0)::int AS open_constraints_count,
        COALESCE(recommendation_counts.recommendations_count, 0)::int AS recommendations_count
      FROM contacts c
      LEFT JOIN organizations o ON o.tenant_id = c.tenant_id AND o.id = c.organization_id AND o.deleted_at IS NULL
      LEFT JOIN territories t ON t.tenant_id = c.tenant_id AND t.id = c.territory_id AND t.deleted_at IS NULL
      LEFT JOIN users u ON u.id = c.relationship_owner_user_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT se.signal_id) AS related_signals_count
        FROM signal_entities se
        JOIN signals s ON s.tenant_id = se.tenant_id AND s.id = se.signal_id AND s.deleted_at IS NULL
        WHERE se.tenant_id = c.tenant_id
          AND se.entity_type = 'contact'
          AND se.entity_id = c.id
          AND se.archived_at IS NULL
          AND se.deleted_at IS NULL
      ) signal_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS open_constraints_count
        FROM constraints con
        WHERE con.tenant_id = c.tenant_id
          AND con.deleted_at IS NULL
          AND con.status NOT IN ('closed', 'archived')
          AND con.affected_object_type = 'contact'
          AND con.affected_object_id = c.id
      ) constraint_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS recommendations_count
        FROM recommendations r
        WHERE r.tenant_id = c.tenant_id
          AND r.deleted_at IS NULL
          AND r.related_object_type = 'contact'
          AND r.related_object_id = c.id
      ) recommendation_counts ON true
      WHERE c.tenant_id = $1
        AND ($2::uuid IS NULL OR c.id = $2::uuid)
      `,
      [tenantId, id ?? null],
    );
    return result.rows;
  }

  private matchesContactFilters(row: EnrichedContactRow, query: Record<string, string | undefined>) {
    const contact = this.decorateContact(row);
    const archived = Boolean(row.archived_at || row.deleted_at || row.status === "archived");
    if (query.archived === undefined && archived) return false;
    if (query.archived !== undefined && String(archived) !== query.archived) return false;
    if (query.organization_id && row.organization_id !== query.organization_id) return false;
    if (query.organization_type && row.organization_type !== query.organization_type) return false;
    if (query.organization_actor_role) {
      const roles = Array.isArray(row.organization_actor_roles) ? row.organization_actor_roles.map(String) : [];
      if (!roles.includes(query.organization_actor_role)) return false;
    }
    if (query.contact_role && row.contact_role !== query.contact_role) return false;
    if (query.territory_id && row.territory_id !== query.territory_id) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.verification_status && row.verification_status !== query.verification_status) return false;
    if (query.relationship_owner_user_id && row.relationship_owner_user_id !== query.relationship_owner_user_id) return false;
    if (!this.inRange(row.influence_score, query.influence_min, query.influence_max)) return false;
    if (!this.inRange(row.decision_authority_score, query.decision_authority_min, query.decision_authority_max)) return false;
    if (!this.inRange(row.relationship_strength_score, query.relationship_strength_min, query.relationship_strength_max)) return false;
    if (query.missing_contact_method !== undefined && String(!this.hasContactMethod(row)) !== query.missing_contact_method) return false;
    if (query.stale !== undefined && String(contact.stale) !== query.stale) return false;
    if (query.linked_to_opportunity === "true" && Number(row.related_opportunities_count ?? 0) === 0) return false;
    if (query.linked_to_opportunity === "false" && Number(row.related_opportunities_count ?? 0) > 0) return false;
    if (query.q) {
      const haystack = [row.full_name, row.first_name, row.last_name, row.title, row.email, row.phone, row.mobile, row.organization_name, row.contact_role].map((value) => String(value ?? "").toLowerCase()).join(" ");
      if (!haystack.includes(query.q.toLowerCase())) return false;
    }
    if (!this.dateInRange(row.last_contacted_at, query.last_contacted_from, query.last_contacted_to)) return false;
    if (!this.dateInRange(row.last_verified_at, query.last_verified_from, query.last_verified_to)) return false;
    return true;
  }

  private sortContacts(rows: EnrichedContactRow[], sort: string) {
    const score = (value: unknown) => (value === null || value === undefined ? -1 : Number(value));
    const updated = (row: EnrichedContactRow) => Date.parse(String(row.updated_at ?? row.created_at ?? 0));
    const date = (value: unknown) => (value ? Date.parse(String(value)) : 0);
    return [...rows].sort((a, b) => {
      if (sort === "name_asc") return String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""));
      if (sort === "updated_desc") return updated(b) - updated(a);
      if (sort === "influence_desc") return score(b.influence_score) - score(a.influence_score);
      if (sort === "decision_authority_desc") return score(b.decision_authority_score) - score(a.decision_authority_score);
      if (sort === "relationship_strength_desc") return score(b.relationship_strength_score) - score(a.relationship_strength_score);
      if (sort === "last_contacted_asc") return date(a.last_contacted_at) - date(b.last_contacted_at);
      if (sort === "last_verified_asc") return date(a.last_verified_at) - date(b.last_verified_at);
      if (sort === "strategic_first") {
        const strategic = score(b.influence_score) + score(b.decision_authority_score) + score(b.relationship_strength_score) - (score(a.influence_score) + score(a.decision_authority_score) + score(a.relationship_strength_score));
        if (strategic !== 0) return strategic;
      }
      const influence = score(b.influence_score) - score(a.influence_score);
      if (influence !== 0) return influence;
      const authority = score(b.decision_authority_score) - score(a.decision_authority_score);
      if (authority !== 0) return authority;
      return updated(b) - updated(a);
    });
  }

  private decorateContact(row: EnrichedContactRow) {
    const stale = this.stale(row);
    const checklist = this.completenessChecklist(row);
    const complete = checklist.filter((item) => item.complete).length;
    const completenessScore = Math.round((complete / checklist.length) * 100);
    return {
      ...row,
      contact_role: row.contact_role ?? "unknown",
      stale,
      completeness_score: completenessScore,
      completeness_band: this.completenessBand(completenessScore),
      missing_contact_items: checklist.filter((item) => !item.complete).map((item) => item.key),
      recommended_next_action: this.recommendedNextAction(row, stale),
    };
  }

  private completenessChecklist(row: EnrichedContactRow) {
    return [
      { key: "organization_attached", complete: Boolean(row.organization_id) },
      { key: "name_present", complete: Boolean(row.full_name || row.first_name || row.last_name) },
      { key: "title_present", complete: Boolean(row.title) },
      { key: "contact_role_assigned", complete: Boolean(row.contact_role && row.contact_role !== "unknown") },
      { key: "at_least_one_contact_method", complete: this.hasContactMethod(row) },
      { key: "verification_complete", complete: row.verification_status === "verified" },
      { key: "owner_assigned", complete: Boolean(row.relationship_owner_user_id) },
      { key: "influence_score_captured", complete: row.influence_score !== null && row.influence_score !== undefined },
      { key: "decision_authority_score_captured", complete: row.decision_authority_score !== null && row.decision_authority_score !== undefined },
      { key: "relationship_strength_score_captured", complete: row.relationship_strength_score !== null && row.relationship_strength_score !== undefined },
    ];
  }

  private recommendedNextAction(row: EnrichedContactRow, stale: boolean) {
    if (row.status === "archived") return "view_only";
    if (row.status === "invalid") return "replace_or_archive";
    if (!row.organization_id) return "attach_organization";
    if (!row.contact_role || row.contact_role === "unknown") return "assign_role";
    if (!this.hasContactMethod(row)) return "add_contact_method";
    if (row.verification_status === "unverified") return "verify_contact";
    if (!row.relationship_owner_user_id) return "assign_owner";
    if (stale) return "reverify_contact";
    if (row.relationship_strength_score === null || row.relationship_strength_score === undefined || Number(row.relationship_strength_score) < 40) return "strengthen_relationship";
    return "review_contact";
  }

  private stale(row: Record<string, unknown>) {
    if (row.verification_status === "stale") return true;
    if (row.status === "archived" || row.status === "invalid") return false;
    const threshold = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const verified = row.last_verified_at ? new Date(String(row.last_verified_at)).getTime() : 0;
    const contacted = row.last_contacted_at ? new Date(String(row.last_contacted_at)).getTime() : 0;
    return verified > 0 && verified < threshold && (contacted === 0 || contacted < threshold);
  }

  private async relatedSignals(client: PoolClient, tenantId: string, contactId: string) {
    const result = await client.query(
      `
      SELECT s.id, s.title, s.signal_category AS category, s.signal_type AS type, s.confidence_score,
        s.trust_level, s.status, s.source_name, s.date_discovered,
        CASE
          WHEN s.status = 'archived' THEN 'view_only'
          WHEN s.status = 'verified' THEN 'create_candidate'
          ELSE 'continue_investigation'
        END AS recommended_next_action
      FROM signal_entities se
      JOIN signals s ON s.tenant_id = se.tenant_id AND s.id = se.signal_id
      WHERE se.tenant_id = $1
        AND se.entity_type = 'contact'
        AND se.entity_id = $2
        AND se.archived_at IS NULL
        AND se.deleted_at IS NULL
        AND s.deleted_at IS NULL
      ORDER BY s.date_discovered DESC NULLS LAST, s.updated_at DESC
      LIMIT 50
      `,
      [tenantId, contactId],
    );
    return result.rows;
  }

  private async relatedCandidates(_client: PoolClient, _tenantId: string, _contactId: string) {
    return [];
  }

  private async relatedOpportunities(_client: PoolClient, _tenantId: string, _contactId: string) {
    return [];
  }

  private async relatedProjects(client: PoolClient, tenantId: string, contact: Record<string, unknown>) {
    const organizationId = contact.organization_id;
    if (!organizationId) return [];
    const result = await client.query(
      `
      SELECT id, name, status, customer_organization_id, created_at
      FROM projects
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND customer_organization_id = $2
      ORDER BY updated_at DESC
      LIMIT 25
      `,
      [tenantId, organizationId],
    );
    return result.rows;
  }

  private async financeRelevance(client: PoolClient, tenantId: string, contact: Record<string, unknown>) {
    if (!financeRoles.has(String(contact.contact_role)) || !contact.organization_id) {
      return { settlements: [], invoices: [], payments: [], note: "Finance relevance is only shown for approved finance contact roles." };
    }
    const [settlements, invoices, payments] = await Promise.all([
      client.query("SELECT id, id::text AS settlement_number, status, gross_amount, net_amount FROM settlements WHERE tenant_id = $1 AND customer_organization_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 25", [tenantId, contact.organization_id]),
      client.query("SELECT id, invoice_number, status, invoice_amount, due_date FROM invoices WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 25", [tenantId, contact.organization_id]),
      client.query(
        `
        SELECT p.id, p.payment_reference, p.status, p.payment_amount, p.payment_date
        FROM payments p
        JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
        WHERE p.tenant_id = $1 AND i.organization_id = $2 AND p.deleted_at IS NULL
        ORDER BY p.updated_at DESC
        LIMIT 25
        `,
        [tenantId, contact.organization_id],
      ),
    ]);
    return { settlements: settlements.rows, invoices: invoices.rows, payments: payments.rows };
  }

  private async constraintsSummary(client: PoolClient, tenantId: string, contactId: string) {
    const result = await client.query(
      "SELECT id, title, constraint_type, severity, owner_id, due_date, status, resolution_summary FROM constraints WHERE tenant_id = $1 AND affected_object_type = 'contact' AND affected_object_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50",
      [tenantId, contactId],
    );
    return result.rows;
  }

  private async recommendationsSummary(client: PoolClient, tenantId: string, contactId: string) {
    const result = await client.query(
      "SELECT id, title, recommendation_type, confidence_score, risk_level, expected_impact, status, NULL::uuid AS owner_id FROM recommendations WHERE tenant_id = $1 AND related_object_type = 'contact' AND related_object_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50",
      [tenantId, contactId],
    );
    return result.rows;
  }

  private async contactTimeline(client: PoolClient, tenantId: string, contactId: string) {
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
          (e.aggregate_type = 'contact' AND e.aggregate_id = $2)
          OR (e.aggregate_type = 'signal_entity' AND e.aggregate_id IN (
            SELECT id FROM signal_entities WHERE tenant_id = $1 AND entity_type = 'contact' AND entity_id = $2
          ))
          OR (e.aggregate_type = 'constraint' AND e.aggregate_id IN (
            SELECT id FROM constraints WHERE tenant_id = $1 AND affected_object_type = 'contact' AND affected_object_id = $2
          ))
          OR (e.aggregate_type = 'recommendation' AND e.aggregate_id IN (
            SELECT id FROM recommendations WHERE tenant_id = $1 AND related_object_type = 'contact' AND related_object_id = $2
          ))
        )
      ORDER BY e.occurred_at DESC
      LIMIT 50
      `,
      [tenantId, contactId],
    );
    return result.rows;
  }

  private organizationContext(contact: Record<string, unknown>) {
    if (!contact.organization_id) return null;
    return {
      organization_id: contact.organization_id,
      organization_name: contact.organization_name,
      organization_type: contact.organization_type,
      actor_roles: contact.organization_actor_roles ?? [],
      status: contact.organization_status,
      territory_name: contact.territory_name,
      relationship_owner_name: contact.relationship_owner_name,
      strategic_flag: contact.organization_strategic_flag,
      influence_score: contact.organization_influence_score,
      work_relevance_score: contact.organization_work_relevance_score,
      capacity_relevance_score: contact.organization_capacity_relevance_score,
      payment_relevance_score: contact.organization_payment_relevance_score,
    };
  }

  private contactValues(body: Record<string, unknown>, creating: boolean) {
    const values = pick(body, [
      "organization_id",
      "full_name",
      "first_name",
      "last_name",
      "title",
      "department",
      "email",
      "secondary_email",
      "phone",
      "mobile",
      "linkedin_url",
      "territory_id",
      "relationship_owner_user_id",
      "preferred_contact_method",
      "best_time_to_contact",
      "source",
      "source_url",
      "notes",
    ]);
    if (body.contact_role !== undefined || creating) values.contact_role = requireAllowed(body.contact_role ?? "unknown", contactRoles, "contact_role");
    if (body.status !== undefined) values.status = requireAllowed(body.status, contactStatuses, "status");
    if (body.verification_status !== undefined) values.verification_status = requireAllowed(body.verification_status, verificationStatuses, "verification_status");
    if (body.verification_method !== undefined) values.verification_method = requireAllowed(body.verification_method, verificationMethods, "verification_method");
    if (body.verification_source !== undefined) values.verification_source = body.verification_source;
    if (body.verification_note !== undefined) values.verification_note = body.verification_note;
    if (body.do_not_contact_flag !== undefined) values.do_not_contact_flag = Boolean(body.do_not_contact_flag);
    for (const field of ["influence_score", "decision_authority_score", "relationship_strength_score", "source_confidence"]) {
      if (body[field] !== undefined) values[field] = optionalScore(body[field], field);
    }
    return values;
  }

  private async requireOrganization(client: PoolClient, tenantId: string, organizationId: unknown): Promise<void> {
    if (typeof organizationId !== "string" || !organizationId) throw new Error("organization_id is required");
    const organization = await findTenantRecordById(client, "organizations", tenantId, organizationId);
    if (!organization) throw new NotFoundException("organization not found in tenant");
  }

  private async validateOrganization(client: PoolClient, tenantId: string, organizationId: unknown): Promise<void> {
    if (organizationId === undefined || organizationId === null || organizationId === "") return;
    await this.requireOrganization(client, tenantId, organizationId);
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
      SELECT 1
      FROM tenant_users tu
      JOIN users u ON u.id = tu.user_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND u.status = 'active'
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rowCount) throw new NotFoundException("owner user not found in tenant");
  }

  private async requireContact(client: PoolClient, tenantId: string, id: string) {
    const contact = await findTenantRecordById(client, "contacts", tenantId, id);
    if (!contact) throw new NotFoundException("contact not found");
    return contact;
  }

  private hasContactMethod(contact: Record<string, unknown>) {
    return [contact.email, contact.phone, contact.mobile, contact.linkedin_url].some((value) => typeof value === "string" && value.trim());
  }

  private appendNote(existing: unknown, next: string) {
    return [typeof existing === "string" ? existing.trim() : "", next].filter(Boolean).join("\n");
  }

  private requireDate(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(message);
    return date;
  }

  private inRange(value: unknown, min?: string, max?: string) {
    const numeric = value === null || value === undefined ? null : Number(value);
    if (min !== undefined && (numeric === null || numeric < Number(min))) return false;
    if (max !== undefined && (numeric === null || numeric > Number(max))) return false;
    return true;
  }

  private dateInRange(value: unknown, from?: string, to?: string) {
    const timestamp = value ? Date.parse(String(value)) : null;
    if (from !== undefined && (timestamp === null || timestamp < Date.parse(from))) return false;
    if (to !== undefined && (timestamp === null || timestamp > Date.parse(to))) return false;
    return true;
  }

  private completenessBand(score: number) {
    if (score < 40) return "incomplete";
    if (score < 70) return "partial";
    if (score < 90) return "usable";
    return "complete";
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType: "contact",
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
