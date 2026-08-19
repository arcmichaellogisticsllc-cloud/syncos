import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { executeWriteAction, recalculateOpportunityCapacityMatch, runOpportunityCapacityMatchingScan, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

type Row = QueryResultRow & Record<string, unknown>;

const requirementWindows = new Set(["start_by", "start_between", "now_24h", "72h", "1_week", "2_weeks", "30_days", "60_days"]);
const confidenceValues = new Set(["low", "medium", "high"]);
const riskSeverities = new Set(["low", "medium", "high", "critical"]);
const shortlistStatuses = new Set(["consider", "preferred_for_pursuit", "backup", "removed"]);
const decisionValues = new Set(["pursue_full_capacity_identified", "pursue_partial_capacity_recruiting_required", "pursue_with_risk_review", "defer_capacity_gap", "avoid_no_qualified_capacity", "manual_note"]);

@Controller("opportunity-capacity-matching")
export class OpportunityCapacityMatchingController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("opportunities/:opportunityId")
  @RequirePermission("opportunity_capacity_match.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("opportunityId") opportunityId: string) {
    return this.withClient(async (client) => {
      const opportunity = await this.requireOpportunity(client, request.auth.tenantId, opportunityId);
      const requirement = await this.currentRequirement(client, request.auth.tenantId, opportunityId);
      if (!requirement) {
        return {
          opportunity: this.safeOpportunity(opportunity),
          requirement: null,
          missing_requirements: ["territory", "capability", "required_crew_count", "required_start_date"],
          boundary: this.boundary(),
        };
      }
      const matches = await client.query(
        `
        SELECT pm.*, o.name AS partner_name
        FROM opportunity_partner_match_snapshots pm
        JOIN organizations o ON o.tenant_id = pm.tenant_id AND o.id = pm.partner_organization_id
        WHERE pm.tenant_id = $1 AND pm.opportunity_id = $2 AND pm.requirement_profile_id = $3 AND pm.current = true
        ORDER BY pm.eligible DESC, pm.fit_score DESC, o.name
        LIMIT 250
        `,
        [request.auth.tenantId, opportunityId, requirement.id],
      );
      const crews = await client.query(
        `
        SELECT cm.*, c.name AS crew_name
        FROM opportunity_crew_match_snapshots cm
        JOIN crews c ON c.tenant_id = cm.tenant_id AND c.id = cm.crew_id
        WHERE cm.tenant_id = $1 AND cm.opportunity_id = $2 AND cm.requirement_profile_id = $3 AND cm.current = true
        ORDER BY cm.eligible DESC, cm.fit_score DESC, c.name
        LIMIT 500
        `,
        [request.auth.tenantId, opportunityId, requirement.id],
      );
      const coverage = await client.query(
        "SELECT * FROM opportunity_coverage_options WHERE tenant_id = $1 AND opportunity_id = $2 AND requirement_profile_id = $3 AND current = true ORDER BY rank",
        [request.auth.tenantId, opportunityId, requirement.id],
      );
      const shortlist = await client.query(
        `
        SELECT s.*, o.name AS partner_name
        FROM opportunity_partner_shortlists s
        JOIN organizations o ON o.tenant_id = s.tenant_id AND o.id = s.partner_organization_id
        WHERE s.tenant_id = $1 AND s.opportunity_id = $2 AND s.requirement_profile_id = $3
        ORDER BY s.added_at DESC
        `,
        [request.auth.tenantId, opportunityId, requirement.id],
      );
      const decisions = await client.query(
        "SELECT id, decision, reason, selected_shortlist_ids, recorded_by_user_id, recorded_at FROM opportunity_match_decisions WHERE tenant_id = $1 AND opportunity_id = $2 AND requirement_profile_id = $3 ORDER BY recorded_at DESC LIMIT 25",
        [request.auth.tenantId, opportunityId, requirement.id],
      );
      return {
        opportunity: this.safeOpportunity(opportunity),
        requirement,
        capacity_summary: this.capacitySummary(requirement, coverage.rows[0]),
        partner_matches: matches.rows.map((row) => this.safePartnerMatch(row)),
        crew_matches: crews.rows.map((row) => this.safeCrewMatch(row)),
        coverage_options: coverage.rows.map((row) => this.safeCoverage(row)),
        shortlist: shortlist.rows,
        decisions: decisions.rows,
        boundary: this.boundary(),
      };
    });
  }

  @Get("coverage")
  @RequirePermission("opportunity_coverage.read")
  async coverage(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT o.id AS opportunity_id, o.title, o.status AS opportunity_status, t.name AS territory_name,
          rp.capability, rp.required_crew_count, rp.required_start_date, rp.required_start_window,
          co.coverage_status, co.covered_crew_count, co.remaining_gap, co.average_fit_score, co.minimum_confidence,
          co.reason_summary
        FROM opportunities o
        JOIN opportunity_requirement_profiles rp ON rp.tenant_id = o.tenant_id AND rp.opportunity_id = o.id AND rp.current = true
        LEFT JOIN territories t ON t.tenant_id = rp.tenant_id AND t.id = rp.territory_id
        LEFT JOIN opportunity_coverage_options co ON co.tenant_id = rp.tenant_id AND co.opportunity_id = rp.opportunity_id AND co.requirement_profile_id = rp.id AND co.current = true
        WHERE o.tenant_id = $1
          AND o.deleted_at IS NULL
          AND ($2::text IS NULL OR rp.capability = $2)
          AND ($3::text IS NULL OR co.coverage_status = $3)
        ORDER BY rp.required_start_date ASC, co.remaining_gap DESC NULLS LAST
        LIMIT 250
        `,
        [request.auth.tenantId, this.optional(query.capability), this.optional(query.coverage_status)],
      );
      return result.rows.map((row) => this.safeCoverageRow(row));
    });
  }

  @Post("opportunities/:opportunityId/requirements")
  @RequirePermission("opportunity_capacity_match.requirements_manage")
  async createRequirement(@Req() request: AuthenticatedRequest, @Param("opportunityId") opportunityId: string, @Body() body: Row) {
    const values = this.requirementValues(body);
    return this.write(request, "opportunity.requirements_changed", "opportunity.requirements_changed", "opportunity_requirement_profile", async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, opportunityId);
      await this.requireTerritory(client, request.auth.tenantId, values.territory_id);
      const current = await this.currentRequirement(client, request.auth.tenantId, opportunityId);
      const version = Number(current?.version ?? 0) + 1;
      if (current) {
        await client.query("UPDATE opportunity_requirement_profiles SET current = false WHERE tenant_id = $1 AND opportunity_id = $2 AND id = $3", [request.auth.tenantId, opportunityId, current.id]);
      }
      const inserted = await client.query(
        `
        INSERT INTO opportunity_requirement_profiles (
          tenant_id, opportunity_id, version, territory_id, capability, crew_type, required_crew_count, required_start_date,
          required_start_window, required_end_date, estimated_duration_days, required_equipment_types, required_compliance_types,
          required_customer_clearances, minimum_performance_score, minimum_performance_confidence, max_risk_severity, notes, created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING *
        `,
        [
          request.auth.tenantId,
          opportunityId,
          version,
          values.territory_id,
          values.capability,
          values.crew_type,
          values.required_crew_count,
          values.required_start_date,
          values.required_start_window,
          values.required_end_date,
          values.estimated_duration_days,
          values.required_equipment_types,
          values.required_compliance_types,
          values.required_customer_clearances,
          values.minimum_performance_score,
          values.minimum_performance_confidence,
          values.max_risk_severity,
          values.notes,
          request.auth.userId,
        ],
      );
      if (current) {
        await client.query("UPDATE opportunity_requirement_profiles SET superseded_by_version_id = $4 WHERE tenant_id = $1 AND opportunity_id = $2 AND id = $3", [request.auth.tenantId, opportunityId, current.id, inserted.rows[0].id]);
      }
      return { entityType: "opportunity_requirement_profile", entityId: inserted.rows[0].id, beforeState: current, afterState: inserted.rows[0] };
    });
  }

  @Post("opportunities/:opportunityId/recalculate")
  @RequirePermission("opportunity_capacity_match.recalculate")
  async recalculate(@Req() request: AuthenticatedRequest, @Param("opportunityId") opportunityId: string, @Body() body: Row) {
    return this.write(request, "opportunity_capacity_match.recalculated", "opportunity_capacity_match.recalculated", "opportunity_capacity_match", async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, opportunityId);
      const result = await recalculateOpportunityCapacityMatch(client, {
        tenantId: request.auth.tenantId,
        opportunityId,
        requirementProfileId: this.optional(body.requirement_profile_id),
        actorUserId: request.auth.userId,
        asOf: this.optional(body.as_of) ?? undefined,
      });
      return {
        entityType: "opportunity_capacity_match",
        entityId: opportunityId,
        afterState: {
          requirement_profile_id: result.requirement.id,
          partner_match_count: result.partnerMatches.length,
          coverage_option_count: result.coverageOptions.length,
          boundary: this.boundary(),
        },
      };
    });
  }

  @Post("scan")
  @RequirePermission("opportunity_capacity_match.recalculate")
  async scan(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.withClient((client) =>
      runOpportunityCapacityMatchingScan(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        opportunityId: this.optional(body.opportunity_id),
        batchSize: typeof body.batch_size === "number" ? body.batch_size : undefined,
        asOf: this.optional(body.as_of) ?? undefined,
      }),
    );
  }

  @Post("opportunities/:opportunityId/shortlist")
  @RequirePermission("opportunity_partner_shortlist.manage")
  async shortlist(@Req() request: AuthenticatedRequest, @Param("opportunityId") opportunityId: string, @Body() body: Row) {
    const partnerOrganizationId = this.requireString(body.partner_organization_id, "partner_organization_id is required");
    const status = this.requireSet(body.status ?? "consider", shortlistStatuses, "invalid shortlist status");
    const note = this.optional(body.note);
    return this.write(request, "opportunity_partner_shortlist.changed", "opportunity_partner_shortlist.changed", "opportunity_partner_shortlist", async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, opportunityId);
      await this.requirePartner(client, request.auth.tenantId, partnerOrganizationId);
      const requirement = await this.requireCurrentRequirement(client, request.auth.tenantId, opportunityId);
      const inserted = await client.query(
        `
        INSERT INTO opportunity_partner_shortlists (tenant_id, opportunity_id, requirement_profile_id, partner_organization_id, status, note, added_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (tenant_id, opportunity_id, requirement_profile_id, partner_organization_id) WHERE status <> 'removed'
        DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now()
        RETURNING *
        `,
        [request.auth.tenantId, opportunityId, requirement.id, partnerOrganizationId, status, note, request.auth.userId],
      );
      return { entityType: "opportunity_partner_shortlist", entityId: inserted.rows[0].id, afterState: { ...inserted.rows[0], assignment_created: false } };
    });
  }

  @Post("opportunities/:opportunityId/decision")
  @RequirePermission("opportunity_match_decision.record")
  async decision(@Req() request: AuthenticatedRequest, @Param("opportunityId") opportunityId: string, @Body() body: Row) {
    const decision = this.requireSet(body.decision, decisionValues, "invalid match decision");
    const reason = this.requireString(body.reason, "reason is required");
    const selected = Array.isArray(body.selected_shortlist_ids) ? body.selected_shortlist_ids.map((id) => String(id)) : [];
    return this.write(request, "opportunity_match_decision.recorded", "opportunity_match_decision.recorded", "opportunity_match_decision", async (client) => {
      await this.requireOpportunity(client, request.auth.tenantId, opportunityId);
      const requirement = await this.requireCurrentRequirement(client, request.auth.tenantId, opportunityId);
      const inserted = await client.query(
        "INSERT INTO opportunity_match_decisions (tenant_id, opportunity_id, requirement_profile_id, decision, reason, selected_shortlist_ids, recorded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [request.auth.tenantId, opportunityId, requirement.id, decision, reason, selected, request.auth.userId],
      );
      return { entityType: "opportunity_match_decision", entityId: inserted.rows[0].id, afterState: { ...inserted.rows[0], opportunity_stage_changed: false, work_order_created: false, crew_reserved: false } };
    });
  }

  private requirementValues(body: Row) {
    return {
      territory_id: this.requireString(body.territory_id, "territory_id is required"),
      capability: this.requireString(body.capability, "capability is required"),
      crew_type: this.requireString(body.crew_type, "crew_type is required"),
      required_crew_count: this.requirePositiveInteger(body.required_crew_count, "required_crew_count must be positive"),
      required_start_date: this.requireDate(body.required_start_date, "required_start_date is required"),
      required_start_window: this.requireSet(body.required_start_window ?? "start_by", requirementWindows, "invalid required_start_window"),
      required_end_date: this.optional(body.required_end_date),
      estimated_duration_days: body.estimated_duration_days === undefined ? null : this.requirePositiveInteger(body.estimated_duration_days, "estimated_duration_days must be positive"),
      required_equipment_types: this.stringArray(body.required_equipment_types),
      required_compliance_types: this.stringArray(body.required_compliance_types),
      required_customer_clearances: this.stringArray(body.required_customer_clearances),
      minimum_performance_score: body.minimum_performance_score === undefined || body.minimum_performance_score === null ? null : this.requireScore(body.minimum_performance_score, "minimum_performance_score must be 0..100"),
      minimum_performance_confidence: body.minimum_performance_confidence === undefined || body.minimum_performance_confidence === null ? null : this.requireSet(body.minimum_performance_confidence, confidenceValues, "invalid minimum_performance_confidence"),
      max_risk_severity: this.requireSet(body.max_risk_severity ?? "medium", riskSeverities, "invalid max_risk_severity"),
      notes: this.optional(body.notes),
    };
  }

  private capacitySummary(requirement: Row, option: Row | undefined) {
    return {
      required_crew_count: Number(requirement.required_crew_count ?? 0),
      verified_ready: Number(option?.covered_crew_count ?? 0),
      potential: Number(option?.covered_crew_count ?? 0),
      gap: Number(option?.remaining_gap ?? requirement.required_crew_count ?? 0),
      confidence: option?.minimum_confidence ?? "insufficient_data",
      recruiting_need: (option?.reason_summary as { recruiting_need?: unknown } | undefined)?.recruiting_need ?? null,
    };
  }

  private async requireOpportunity(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query("SELECT * FROM opportunities WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, opportunityId]);
    if (!result.rows[0]) throw new NotFoundException("opportunity not found");
    return result.rows[0] as Row;
  }

  private async requirePartner(client: PoolClient, tenantId: string, partnerOrganizationId: string) {
    const result = await client.query("SELECT id FROM organizations WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND ('capacity_provider' = ANY(actor_roles) OR organization_type = 'subcontractor')", [tenantId, partnerOrganizationId]);
    if (!result.rows[0]) throw new NotFoundException("partner organization not found");
    return result.rows[0] as Row;
  }

  private async requireTerritory(client: PoolClient, tenantId: string, territoryId: string) {
    const result = await client.query("SELECT id FROM territories WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, territoryId]);
    if (!result.rows[0]) throw new BadRequestException("invalid territory_id");
    return result.rows[0] as Row;
  }

  private async currentRequirement(client: PoolClient, tenantId: string, opportunityId: string) {
    const result = await client.query("SELECT * FROM opportunity_requirement_profiles WHERE tenant_id = $1 AND opportunity_id = $2 AND current = true LIMIT 1", [tenantId, opportunityId]);
    return result.rows[0] as Row | undefined;
  }

  private async requireCurrentRequirement(client: PoolClient, tenantId: string, opportunityId: string) {
    const requirement = await this.currentRequirement(client, tenantId, opportunityId);
    if (!requirement) throw new BadRequestException("opportunity requirement profile is required before matching");
    return requirement;
  }

  private safeOpportunity(row: Row) {
    const { estimated_value, margin_potential_score, payment_risk_score, internal_notes, ...safe } = row;
    return safe;
  }

  private safePartnerMatch(row: Row) {
    const { source_fingerprint, customer_rate, partner_rate, margin, internal_investigation, worker_id, ...safe } = row;
    return safe;
  }

  private safeCrewMatch(row: Row) {
    const { source_fingerprint, worker_id, worker_name, worker_email, internal_notes, ...safe } = row;
    return safe;
  }

  private safeCoverage(row: Row) {
    const { source_fingerprint, margin, internal_notes, ...safe } = row;
    return safe;
  }

  private safeCoverageRow(row: Row) {
    const { estimated_value, margin, customer_rate, partner_rate, internal_notes, ...safe } = row;
    return safe;
  }

  private boundary() {
    return {
      recommendation_is_assignment: false,
      ranking_is_award: false,
      opportunity_stage_auto_changed: false,
      work_order_auto_created: false,
      partner_auto_assigned: false,
      crew_auto_reserved: false,
      lifecycle_auto_changed: false,
      rates_auto_changed: false,
      payment_auto_changed: false,
      worker_ranking_created: false,
    };
  }

  private requireString(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private requireSet(value: unknown, values: Set<string>, message: string) {
    const normalized = this.requireString(value, message);
    if (!values.has(normalized)) throw new BadRequestException(message);
    return normalized;
  }

  private requireDate(value: unknown, message: string) {
    const normalized = this.requireString(value, message);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new BadRequestException(message);
    return normalized;
  }

  private requirePositiveInteger(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new BadRequestException(message);
    return number;
  }

  private requireScore(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new BadRequestException(message);
    return number;
  }

  private stringArray(value: unknown) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException("expected array");
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  private optional(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
    return this.withClient((client) =>
      executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
        write,
      }),
    );
  }
}
