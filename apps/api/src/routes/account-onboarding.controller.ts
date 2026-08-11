import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { findTenantRecordById, insertTenantRecord, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { optionalScore, pick, requireAllowed, requireString } from "./intelligence.types";

const lanes = new Set(["prime", "contractor"]);
const stages = new Set([
  "identified",
  "contact_discovered",
  "initial_outreach",
  "application_submitted",
  "documents_requested",
  "compliance_review",
  "operational_interview",
  "rate_negotiation",
  "approved",
  "market_assigned",
  "mobilized",
]);
const rateSheetStatuses = new Set(["not_captured", "not_required", "requested", "received", "in_review", "approved", "rejected"]);
const approvalStatuses = new Set(["not_submitted", "submitted", "in_review", "approved", "rejected", "blocked"]);
const profileStatuses = new Set(["active", "archived"]);

type OnboardingProfileRow = QueryResultRow & {
  id: string;
  organization_id: string;
  lane: string;
  onboarding_stage: string;
  account_owner_user_id?: string | null;
  primary_contact_id?: string | null;
  rate_schedule_id?: string | null;
  required_documents: string[];
  missing_documents: string[];
  market_availability: string[];
  customer_programs: string[];
  status: string;
};

@Controller("account-onboarding")
export class AccountOnboardingController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("account_onboarding.read")
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const rows = await this.profileRows(client, request.auth.tenantId);
      const filtered = rows.filter((row) => this.matchesFilters(row, query));
      const sorted = this.sortRows(filtered, query.sort);
      const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 200);
      const offset = Math.max(Number(query.offset ?? 0), 0);
      return sorted.slice(offset, offset + limit).map((row) => this.decorateRow(row));
    });
  }

  @Get(":id")
  @RequirePermission("account_onboarding.read")
  async findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const row = await this.profileRow(client, request.auth.tenantId, id);
      if (!row) throw new NotFoundException("account onboarding profile not found");
      return this.decorateRow(row);
    });
  }

  @Post()
  @RequirePermission("account_onboarding.create")
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const organizationId = requireString(body.organization_id, "organization_id is required");
      const values = this.profileValues(body, true);
      values.organization_id = organizationId;
      values.created_by = request.auth.userId;
      values.updated_by = request.auth.userId;
      return await this.write(request, "account_onboarding.create", "account_onboarding.created", "account_onboarding_profile", async (client) => {
        await this.validateRelations(client, request.auth.tenantId, values);
        const profile = await insertTenantRecord<OnboardingProfileRow>(client, "account_onboarding_profiles", request.auth.tenantId, values);
        const enriched = await this.profileRow(client, request.auth.tenantId, profile.id);
        return { entityType: "account_onboarding_profile", entityId: profile.id, afterState: this.decorateRow(enriched ?? profile) };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch(":id")
  @RequirePermission("account_onboarding.update")
  async update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = this.profileValues(body, false);
      values.updated_by = request.auth.userId;
      return await this.write(request, "account_onboarding.update", "account_onboarding.updated", "account_onboarding_profile", async (client) => {
        const before = await this.requireProfile(client, request.auth.tenantId, id);
        await this.validateRelations(client, request.auth.tenantId, { ...before, ...values });
        const after = await updateTenantRecord<OnboardingProfileRow>(client, "account_onboarding_profiles", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("account onboarding profile not found");
        const enriched = await this.profileRow(client, request.auth.tenantId, id);
        return { entityType: "account_onboarding_profile", entityId: id, beforeState: before, afterState: this.decorateRow(enriched ?? after) };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post(":id/archive")
  @RequirePermission("account_onboarding.archive")
  async archive(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "account_onboarding.archive", "account_onboarding.archived", "account_onboarding_profile", async (client) => {
      const before = await this.requireProfile(client, request.auth.tenantId, id);
      const after = await updateTenantRecord<OnboardingProfileRow>(client, "account_onboarding_profiles", request.auth.tenantId, id, {
        status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        deleted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("account onboarding profile not found");
      return { entityType: "account_onboarding_profile", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async profileRows(client: PoolClient, tenantId: string, id?: string) {
    const result = await client.query<OnboardingProfileRow>(
      `
      SELECT
        aop.*,
        org.name AS organization_name,
        org.organization_type,
        org.type AS organization_type_legacy,
        org.actor_roles AS organization_actor_roles,
        org.status AS organization_status,
        org.state AS organization_state,
        org.relationship_owner_user_id AS organization_owner_user_id,
        org_owner.display_name AS organization_owner_name,
        t.name AS territory_name,
        t.code AS territory_code,
        owner.display_name AS account_owner_name,
        pc.full_name AS primary_contact_name,
        pc.title AS primary_contact_title,
        pc.contact_role AS primary_contact_role,
        pc.status AS primary_contact_status,
        pc.last_contacted_at AS primary_contact_last_contacted_at,
        rs.name AS rate_schedule_name,
        rs.status AS rate_schedule_current_status,
        c.name AS contract_name,
        c.status AS contract_status,
        COALESCE(contact_counts.contacts_count, 0)::int AS contacts_count,
        COALESCE(contact_counts.verified_contacts_count, 0)::int AS verified_contacts_count,
        COALESCE(candidate_counts.candidates_count, 0)::int AS candidates_count,
        COALESCE(opportunity_counts.opportunities_count, 0)::int AS opportunities_count,
        COALESCE(provider_counts.capacity_provider_count, 0)::int AS capacity_provider_count,
        COALESCE(document_counts.document_count, 0)::int AS document_count,
        COALESCE(document_counts.missing_document_count, 0)::int AS missing_document_count,
        COALESCE(document_counts.approved_document_count, 0)::int AS approved_document_count
      FROM account_onboarding_profiles aop
      JOIN organizations org ON org.tenant_id = aop.tenant_id AND org.id = aop.organization_id AND org.deleted_at IS NULL
      LEFT JOIN territories t ON t.tenant_id = org.tenant_id AND t.id = org.territory_id AND t.deleted_at IS NULL
      LEFT JOIN users owner ON owner.id = aop.account_owner_user_id
      LEFT JOIN users org_owner ON org_owner.id = org.relationship_owner_user_id
      LEFT JOIN contacts pc ON pc.tenant_id = aop.tenant_id AND pc.id = aop.primary_contact_id AND pc.deleted_at IS NULL
      LEFT JOIN rate_schedules rs ON rs.tenant_id = aop.tenant_id AND rs.id = aop.rate_schedule_id AND rs.deleted_at IS NULL
      LEFT JOIN contracts c ON c.tenant_id = rs.tenant_id AND c.id = rs.contract_id AND c.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS contacts_count,
          count(*) FILTER (WHERE verification_status = 'verified' OR status = 'verified') AS verified_contacts_count
        FROM contacts contact
        WHERE contact.tenant_id = aop.tenant_id AND contact.organization_id = aop.organization_id AND contact.deleted_at IS NULL
      ) contact_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS candidates_count
        FROM opportunity_candidates oc
        WHERE oc.tenant_id = aop.tenant_id AND oc.organization_id = aop.organization_id AND oc.deleted_at IS NULL
      ) candidate_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS opportunities_count
        FROM opportunities op
        WHERE op.tenant_id = aop.tenant_id AND op.organization_id = aop.organization_id AND op.deleted_at IS NULL
      ) opportunity_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS capacity_provider_count
        FROM capacity_providers cp
        WHERE cp.tenant_id = aop.tenant_id AND cp.organization_id = aop.organization_id AND cp.deleted_at IS NULL
      ) provider_counts ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS document_count,
          count(*) FILTER (WHERE cd.status IN ('submitted', 'rejected', 'expired')) AS missing_document_count,
          count(*) FILTER (WHERE cd.status = 'approved') AS approved_document_count
        FROM capacity_providers cp
        JOIN compliance_documents cd ON cd.tenant_id = cp.tenant_id AND cd.capacity_provider_id = cp.id AND cd.deleted_at IS NULL
        WHERE cp.tenant_id = aop.tenant_id AND cp.organization_id = aop.organization_id AND cp.deleted_at IS NULL
      ) document_counts ON true
      WHERE aop.tenant_id = $1
        AND aop.deleted_at IS NULL
        AND ($2::uuid IS NULL OR aop.id = $2::uuid)
      `,
      [tenantId, id ?? null],
    );
    return result.rows;
  }

  private async profileRow(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.profileRows(client, tenantId, id);
    return rows[0] ?? null;
  }

  private matchesFilters(row: OnboardingProfileRow, query: Record<string, string | undefined>) {
    if (query.lane && row.lane !== query.lane) return false;
    if (query.onboarding_stage && row.onboarding_stage !== query.onboarding_stage) return false;
    if (query.approval_status && row.approval_status !== query.approval_status) return false;
    if (query.account_owner_user_id && row.account_owner_user_id !== query.account_owner_user_id) return false;
    if (query.archived && String(row.status === "archived" || Boolean(row.archived_at)) !== query.archived) return false;
    if (!query.archived && (row.status === "archived" || Boolean(row.archived_at))) return false;
    if (query.q) {
      const haystack = [
        row.organization_name,
        row.organization_state,
        row.territory_name,
        row.account_owner_name,
        row.primary_contact_title,
        row.next_action,
        row.customer_programs?.join(" "),
        row.market_availability?.join(" "),
      ].join(" ").toLowerCase();
      if (!haystack.includes(query.q.toLowerCase())) return false;
    }
    return true;
  }

  private sortRows(rows: OnboardingProfileRow[], sort = "default") {
    return [...rows].sort((a, b) => {
      if (sort === "deadline_asc") return dateNumber(a.next_action_deadline) - dateNumber(b.next_action_deadline);
      if (sort === "probability_desc") return Number(b.probability_of_work ?? -1) - Number(a.probability_of_work ?? -1);
      if (sort === "relationship_desc") return Number(b.relationship_strength_score ?? -1) - Number(a.relationship_strength_score ?? -1);
      if (sort === "company_asc") return String(a.organization_name ?? "").localeCompare(String(b.organization_name ?? ""));
      return stageIndex(a.onboarding_stage) - stageIndex(b.onboarding_stage) || dateNumber(b.updated_at) - dateNumber(a.updated_at);
    });
  }

  private decorateRow(row: OnboardingProfileRow) {
    return {
      ...row,
      stage_label: label(row.onboarding_stage),
      lane_label: row.lane === "contractor" ? "Contractor / Vendor" : "Prime / Customer",
      account_owner_name: row.account_owner_name ?? row.organization_owner_name ?? null,
      contact_title: row.primary_contact_title ?? row.primary_contact_role ?? null,
      market_summary: row.market_availability?.length ? row.market_availability : [row.territory_name ?? row.territory_code ?? row.organization_state].filter(Boolean),
      required_document_count: row.required_documents?.length ?? 0,
      missing_document_count: row.missing_documents?.length ?? Number(row.missing_document_count ?? 0),
      next_action_label: row.next_action ?? defaultNextAction(row.onboarding_stage),
      boundary: "Account onboarding updates internal SyncOS readiness state only. It does not create contracts, customer assignments, payables, payroll, invoices, tax filings, insurance verification, payment activity, or guaranteed work.",
    };
  }

  private profileValues(body: Record<string, unknown>, creating: boolean) {
    const values = pick(body, ["organization_id", "account_owner_user_id", "primary_contact_id", "rate_schedule_id", "last_interaction_at", "next_action", "next_action_deadline", "notes"]);
    if (body.lane !== undefined) values.lane = requireAllowed(body.lane, lanes, "lane");
    else if (creating) values.lane = "prime";
    if (body.onboarding_stage !== undefined) values.onboarding_stage = requireAllowed(body.onboarding_stage, stages, "onboarding_stage");
    else if (creating) values.onboarding_stage = "identified";
    if (body.rate_sheet_status !== undefined) values.rate_sheet_status = requireAllowed(body.rate_sheet_status, rateSheetStatuses, "rate_sheet_status");
    if (body.approval_status !== undefined) values.approval_status = requireAllowed(body.approval_status, approvalStatuses, "approval_status");
    if (body.status !== undefined) values.status = requireAllowed(body.status, profileStatuses, "status");
    if (body.relationship_strength_score !== undefined) values.relationship_strength_score = optionalScore(body.relationship_strength_score, "relationship_strength_score");
    if (body.probability_of_work !== undefined) values.probability_of_work = optionalScore(body.probability_of_work, "probability_of_work");
    if (body.payment_terms_days !== undefined) values.payment_terms_days = nonNegativeInteger(body.payment_terms_days, "payment_terms_days");
    for (const field of ["required_documents", "missing_documents", "market_availability", "customer_programs"]) {
      if (body[field] !== undefined) values[field] = stringArray(body[field], field);
    }
    return values;
  }

  private async validateRelations(client: PoolClient, tenantId: string, values: Record<string, unknown>) {
    await this.requireRecord(client, "organizations", tenantId, values.organization_id, "organization not found in tenant");
    await this.validateOptional(client, "users", tenantId, values.account_owner_user_id, "account owner not found in tenant");
    await this.validateOptional(client, "contacts", tenantId, values.primary_contact_id, "primary contact not found in tenant");
    await this.validateOptional(client, "rate_schedules", tenantId, values.rate_schedule_id, "rate schedule not found in tenant");
  }

  private async validateOptional(client: PoolClient, table: string, tenantId: string, id: unknown, message: string) {
    if (!id) return;
    await this.requireRecord(client, table, tenantId, id, message);
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: unknown, message: string) {
    if (typeof id !== "string" || !id) throw new BadRequestException(message);
    if (table === "users") {
      const result = await client.query("SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1", [tenantId, id]);
      if (!result.rows[0]) throw new NotFoundException(message);
      return;
    }
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
  }

  private async requireProfile(client: PoolClient, tenantId: string, id: string) {
    const profile = await findTenantRecordById<OnboardingProfileRow>(client, "account_onboarding_profiles", tenantId, id);
    if (!profile) throw new NotFoundException("account onboarding profile not found");
    return profile;
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
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

function stringArray(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

function nonNegativeInteger(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative integer`);
  return parsed;
}

function dateNumber(value: unknown) {
  if (!value) return 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function stageIndex(stage: unknown) {
  return Array.from(stages).indexOf(String(stage));
}

function label(value: unknown) {
  return String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultNextAction(stage: string) {
  if (stage === "identified") return "Find a decision-maker, vendor manager, or operations contact.";
  if (stage === "contact_discovered") return "Record initial outreach and confirm the contact path.";
  if (stage === "initial_outreach") return "Capture application or onboarding requirements.";
  if (stage === "application_submitted") return "Request onboarding documents and compliance evidence.";
  if (stage === "documents_requested") return "Follow up on missing document packet.";
  if (stage === "compliance_review") return "Complete internal compliance review.";
  if (stage === "operational_interview") return "Confirm operational fit, market coverage, and program expectations.";
  if (stage === "rate_negotiation") return "Confirm rate sheet and payment terms.";
  if (stage === "approved") return "Assign market and customer program context.";
  if (stage === "market_assigned") return "Confirm mobilization readiness and first-work path.";
  return "Monitor readiness and keep relationship current.";
}
