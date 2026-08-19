import crypto from "node:crypto";
import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { executeWriteAction, recalculatePartnerPerformance, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

type Row = QueryResultRow & Record<string, unknown>;
type Component = {
  dimension: string;
  metric_code: string;
  metric_value: number;
  metric_unit: string;
  normalized_score: number;
  weight: number;
  weighted_contribution: number;
  sample_size: number;
  reason_code: string;
  source_summary: Record<string, unknown>;
};

const policyVersion = "partner_performance_v1";
const weights = {
  quality: 25,
  production: 15,
  documentation: 10,
  safety: 15,
  mobilization: 10,
  correction_rework: 10,
  commercial_reliability: 5,
  capacity_reliability: 10,
} as const;

@Controller("partner-performance")
export class PartnerPerformanceCapacityController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("dashboard")
  @RequirePermission("partner_performance.read")
  async dashboard(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const snapshots = await client.query(
        `
        SELECT s.*, o.name AS partner_name, cp.name AS capacity_provider_name,
          COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}'::text[]) AS territories,
          COALESCE(array_agg(DISTINCT cis.capability) FILTER (WHERE cis.capability IS NOT NULL), '{}'::text[]) AS capabilities,
          COALESCE(sum(cis.ready_crew_count) FILTER (WHERE cis.horizon = 'now_24h'), 0)::int AS ready_crews,
          COALESCE(sum(cis.ready_crew_count + cis.conditional_crew_count) FILTER (WHERE cis.horizon = '30_days'), 0)::int AS thirty_day_capacity
        FROM partner_performance_snapshots s
        JOIN organizations o ON o.tenant_id = s.tenant_id AND o.id = s.partner_organization_id
        LEFT JOIN capacity_providers cp ON cp.tenant_id = s.tenant_id AND cp.id = s.capacity_provider_id
        LEFT JOIN partner_capacity_intelligence_snapshots cis ON cis.tenant_id = s.tenant_id AND cis.partner_organization_id = s.partner_organization_id AND cis.current = true
        LEFT JOIN territories t ON t.tenant_id = cis.tenant_id AND t.id = cis.territory_id
        WHERE s.tenant_id = $1
          AND s.current = true
          AND ($2::text IS NULL OR s.confidence = $2)
          AND ($3::text IS NULL OR s.score_band = $3)
          AND ($4::text IS NULL OR s.lifecycle_recommendation = $4)
        GROUP BY s.id, o.name, cp.name
        ORDER BY s.score DESC, s.partner_organization_id
        LIMIT 250
        `,
        [request.auth.tenantId, this.optional(query.confidence), this.optional(query.score_band), this.optional(query.recommendation)],
      );
      const metrics = {
        active_partners: snapshots.rows.length,
        preferred_candidates: snapshots.rows.filter((row) => row.lifecycle_recommendation === "promote").length,
        strategic_candidates: snapshots.rows.filter((row) => row.score_band === "excellent" && row.confidence === "high").length,
        ready_crews: snapshots.rows.reduce((sum, row) => sum + Number(row.ready_crews ?? 0), 0),
        high_risk_partners: snapshots.rows.filter((row) => Number(row.critical_risk_count ?? 0) > 0 || row.score_band === "high_risk").length,
        capacity_gaps: snapshots.rows.filter((row) => Number(row.ready_crews ?? 0) === 0).length,
      };
      return { metrics, partners: snapshots.rows.map((row) => this.safeSnapshot(row)) };
    });
  }

  @Get("partners/:partnerOrganizationId")
  @RequirePermission("partner_performance.read")
  async detail(@Req() request: AuthenticatedRequest, @Param("partnerOrganizationId") partnerOrganizationId: string) {
    return this.withClient(async (client) => {
      const snapshot = await this.requireCurrentSnapshot(client, request.auth.tenantId, partnerOrganizationId);
      const components = await client.query("SELECT * FROM partner_performance_score_components WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY weight DESC, dimension", [request.auth.tenantId, snapshot.id]);
      const risks = await client.query("SELECT risk_type,severity,status,reason_code,detected_at,resolved_at,external_visible FROM partner_risk_flags WHERE tenant_id = $1 AND partner_organization_id = $2 ORDER BY detected_at DESC", [request.auth.tenantId, partnerOrganizationId]);
      const lifecycle = await client.query("SELECT * FROM partner_lifecycle_recommendations WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true LIMIT 1", [request.auth.tenantId, partnerOrganizationId]);
      const capacity = await client.query("SELECT * FROM partner_capacity_intelligence_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true ORDER BY horizon, capability", [request.auth.tenantId, partnerOrganizationId]);
      const crews = await this.crewPerformance(client, request.auth.tenantId, partnerOrganizationId);
      return {
        snapshot: this.safeSnapshot(snapshot),
        components: components.rows,
        risks: risks.rows,
        lifecycle_recommendation: lifecycle.rows[0] ?? null,
        capacity: capacity.rows,
        crew_performance: crews,
        boundary: this.boundary(),
      };
    });
  }

  @Get("capacity")
  @RequirePermission("partner_capacity_intelligence.read")
  async capacity(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const rows = await client.query(
        `
        SELECT cis.*, o.name AS partner_name, t.name AS territory_name, s.score AS performance_score, s.confidence AS performance_confidence
        FROM partner_capacity_intelligence_snapshots cis
        JOIN organizations o ON o.tenant_id = cis.tenant_id AND o.id = cis.partner_organization_id
        LEFT JOIN territories t ON t.tenant_id = cis.tenant_id AND t.id = cis.territory_id
        LEFT JOIN partner_performance_snapshots s ON s.tenant_id = cis.tenant_id AND s.partner_organization_id = cis.partner_organization_id AND s.current = true
        WHERE cis.tenant_id = $1
          AND cis.current = true
          AND ($2::text IS NULL OR cis.horizon = $2)
          AND ($3::text IS NULL OR cis.capability = $3)
        ORDER BY cis.ready_crew_count DESC, s.score DESC NULLS LAST
        LIMIT 250
        `,
        [request.auth.tenantId, this.optional(query.horizon), this.optional(query.capability)],
      );
      return rows.rows.map((row) => this.safeCapacity(row));
    });
  }

  @Post("recalculate")
  @RequirePermission("partner_performance.recalculate")
  async recalculate(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "partner_performance.recalculated", "partner_performance.recalculated", "partner_performance_snapshot", async (client) => {
      const partnerOrganizationId = this.optional(body.partner_organization_id);
      const partners = await this.partners(client, request.auth.tenantId, partnerOrganizationId);
      const snapshots = [];
      for (const partner of partners) {
        const result = await recalculatePartnerPerformance(client, { tenantId: request.auth.tenantId, actorUserId: request.auth.userId, partner, asOf: this.optional(body.as_of) ?? undefined });
        snapshots.push(result.snapshot);
      }
      const primary = snapshots[0];
      return {
        entityType: "partner_performance_snapshot",
        entityId: primary?.id ?? request.auth.tenantId,
        afterState: { snapshots: snapshots.map((snapshot) => this.safeSnapshot(snapshot)) },
        additionalEvents: snapshots.map((snapshot) => ({
          action: "partner_performance.changed",
          aggregateType: "partner_performance_snapshot",
          entityType: "partner_performance_snapshot",
          entityId: snapshot.id,
          eventType: "partner_performance.changed",
          afterState: {
            partner_organization_id: snapshot.partner_organization_id,
            score: snapshot.score,
            confidence: snapshot.confidence,
            trend: snapshot.trend,
            lifecycle_recommendation: snapshot.lifecycle_recommendation,
          },
        })),
      };
    });
  }

  @Get("partner/summary")
  @RequirePermission("partner_performance.read_own")
  async partnerSummary(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const partner = await this.partnerContext(client, request.auth.tenantId, request.auth.userId);
      const snapshot = await this.requireCurrentSnapshot(client, request.auth.tenantId, String(partner.organization_id));
      const components = await client.query(
        "SELECT dimension, normalized_score, sample_size, reason_code FROM partner_performance_score_components WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY weight DESC",
        [request.auth.tenantId, snapshot.id],
      );
      return {
        overall_status: snapshot.score_band,
        score: Number(snapshot.score),
        confidence: snapshot.confidence,
        trend: snapshot.trend,
        dimensions: components.rows,
        improvement_items: components.rows.filter((row) => Number(row.normalized_score) < 80).map((row) => row.reason_code),
        boundary: {
          competitive_rank_visible: false,
          internal_strategy_visible: false,
          worker_ranking_visible: false,
        },
      };
    });
  }

  private async recalculatePartner(client: PoolClient, tenantId: string, userId: string, partner: Row) {
    const stats = await this.collectStats(client, tenantId, partner);
    const components = this.components(stats);
    const score = this.roundScore(components.reduce((sum, component) => sum + component.weighted_contribution, 0));
    const confidence = this.confidence(stats);
    const risks = await this.activeRisks(client, tenantId, String(partner.organization_id));
    const criticalRiskCount = risks.filter((risk) => ["high", "critical"].includes(String(risk.severity))).length;
    const prior = await client.query("SELECT * FROM partner_performance_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true ORDER BY calculated_at DESC LIMIT 1", [tenantId, partner.organization_id]);
    const trend = this.trend(score, prior.rows[0]);
    const lifecycle = this.lifecycleRecommendation(score, confidence, stats, criticalRiskCount);
    const fingerprint = this.sourceFingerprint([policyVersion, JSON.stringify(stats), criticalRiskCount]);
    const existing = await client.query("SELECT * FROM partner_performance_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND scoring_policy_version = $3 AND source_fingerprint = $4 LIMIT 1", [tenantId, partner.organization_id, policyVersion, fingerprint]);
    if (existing.rows[0]) return existing.rows[0] as Row;

    await client.query("UPDATE partner_performance_snapshots SET current = false WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true", [tenantId, partner.organization_id]);
    await client.query("UPDATE partner_lifecycle_recommendations SET current = false WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true", [tenantId, partner.organization_id]);
    await client.query("UPDATE partner_capacity_intelligence_snapshots SET current = false WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true", [tenantId, partner.organization_id]);

    const inserted = await client.query(
      `
      INSERT INTO partner_performance_snapshots (
        tenant_id, partner_organization_id, capacity_provider_id, scoring_policy_version, score, score_band, confidence,
        quality_score, production_score, documentation_score, safety_score, mobilization_score, correction_score,
        commercial_score, capacity_reliability_score, trend, lifecycle_recommendation, sample_start, sample_end,
        production_day_count, reviewed_record_count, completed_work_order_count, critical_risk_count, source_fingerprint, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING *
      `,
      [
        tenantId,
        partner.organization_id,
        partner.capacity_provider_id,
        policyVersion,
        score,
        this.scoreBand(score),
        confidence,
        components.find((component) => component.dimension === "quality")?.normalized_score ?? 0,
        components.find((component) => component.dimension === "production")?.normalized_score ?? 0,
        components.find((component) => component.dimension === "documentation")?.normalized_score ?? 0,
        components.find((component) => component.dimension === "safety")?.normalized_score ?? 0,
        components.find((component) => component.dimension === "mobilization")?.normalized_score ?? 0,
        components.find((component) => component.dimension === "correction_rework")?.normalized_score ?? 0,
        components.find((component) => component.dimension === "commercial_reliability")?.normalized_score ?? 0,
        components.find((component) => component.dimension === "capacity_reliability")?.normalized_score ?? 0,
        trend,
        lifecycle.recommendation,
        stats.sample_start,
        stats.sample_end,
        stats.production_day_count,
        stats.reviewed_record_count,
        stats.completed_work_order_count,
        criticalRiskCount,
        fingerprint,
        userId,
      ],
    );
    const snapshot = inserted.rows[0] as Row;
    for (const component of components) {
      await client.query(
        "INSERT INTO partner_performance_score_components (tenant_id,snapshot_id,partner_organization_id,dimension,metric_code,metric_value,metric_unit,normalized_score,weight,weighted_contribution,sample_size,reason_code,source_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [tenantId, snapshot.id, partner.organization_id, component.dimension, component.metric_code, component.metric_value, component.metric_unit, component.normalized_score, component.weight, component.weighted_contribution, component.sample_size, component.reason_code, JSON.stringify(component.source_summary)],
      );
    }
    await client.query(
      "INSERT INTO partner_lifecycle_recommendations (tenant_id,partner_organization_id,snapshot_id,current_lifecycle_status,recommendation,recommended_lifecycle_status,confidence,reason_code,governance_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)",
      [tenantId, partner.organization_id, snapshot.id, partner.organization_status, lifecycle.recommendation, lifecycle.recommended_lifecycle_status, confidence, lifecycle.reason_code],
    );
    for (const capacity of this.capacitySnapshots(stats, partner, score, confidence, fingerprint)) {
      await client.query(
        "INSERT INTO partner_capacity_intelligence_snapshots (tenant_id,partner_organization_id,capacity_provider_id,territory_id,crew_type,capability,horizon,ready_crew_count,conditional_crew_count,unverified_crew_count,committed_crew_count,capacity_confidence,recommendation,source_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [tenantId, partner.organization_id, partner.capacity_provider_id, capacity.territory_id, capacity.crew_type, capacity.capability, capacity.horizon, capacity.ready_crew_count, capacity.conditional_crew_count, capacity.unverified_crew_count, capacity.committed_crew_count, capacity.capacity_confidence, capacity.recommendation, `${fingerprint}:${capacity.horizon}:${capacity.capability}`],
      );
    }
    return snapshot;
  }

  private async collectStats(client: PoolClient, tenantId: string, partner: Row) {
    const partnerId = String(partner.organization_id);
    const decisions = await client.query(
      `
        SELECT DISTINCT ON (prd.id) prd.id, prd.quantity_submitted, prd.production_date, prd.unit, prd.syncfield_status,
          cqd.decision, cqd.reported_quantity, cqd.customer_accepted_quantity, cqd.unit_of_measure, cqc.cycle_number,
          spc.code, spc.description, cr.crew_type
        FROM production_records prd
        LEFT JOIN syncfield_production_codes spc ON spc.tenant_id = prd.tenant_id AND spc.id = prd.syncfield_production_code_id
        LEFT JOIN crews cr ON cr.tenant_id = prd.tenant_id AND cr.id = prd.crew_id
        JOIN customer_qc_decisions cqd ON cqd.tenant_id = prd.tenant_id AND cqd.production_record_id = prd.id AND cqd.current = true AND cqd.deleted_at IS NULL
        JOIN customer_qc_cycles cqc ON cqc.tenant_id = cqd.tenant_id AND cqc.id = cqd.qc_cycle_id AND cqc.deleted_at IS NULL
        WHERE prd.tenant_id = $1 AND prd.partner_organization_id = $2 AND prd.deleted_at IS NULL
        ORDER BY prd.id, cqc.cycle_number DESC, cqd.recorded_at DESC
        `,
      [tenantId, partnerId],
    );
    const reports = await client.query("SELECT work_date, submitted_at, status, completeness_status FROM daily_production_reports WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'submitted'", [tenantId, partnerId]);
    const jsas = await client.query("SELECT work_date, status, foreman_certified, submitted_at FROM daily_jsas WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL", [tenantId, partnerId]);
    const corrections = await client.query("SELECT status, correction_type, created_at, resolved_at, resubmitted_at FROM production_corrections WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL", [tenantId, partnerId]);
    const crews = await client.query("SELECT id, name, crew_type, status, lifecycle_status, target_staffing_level FROM crews WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL", [tenantId, partnerId]);
    const capacity = await client.query("SELECT territory_id, capacity_type, compliance_status, insurance_status, current_utilization, readiness_score, quantity, unit, effective_date FROM capacity_records WHERE tenant_id = $1 AND capacity_provider_id = $2 AND deleted_at IS NULL", [tenantId, partner.capacity_provider_id]);
    const financial = await client.query("SELECT exception_type, severity, status FROM financial_exceptions WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND status = 'open'", [tenantId, partnerId]);
    const workOrders = await client.query("SELECT count(*)::int AS completed_count FROM work_orders WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND status IN ('closed','billable','approved')", [tenantId, partnerId]);
    const risks = await client.query("SELECT risk_type,severity,status FROM partner_risk_flags WHERE tenant_id = $1 AND partner_organization_id = $2 AND status = 'active'", [tenantId, partnerId]);
    const decisionRows = decisions.rows;
    const productionDates = decisionRows.map((row) => this.dateOnly(row.production_date)).filter(Boolean).sort();
    return {
      partner_id: partnerId,
      sample_start: productionDates[0] ?? null,
      sample_end: productionDates[productionDates.length - 1] ?? null,
      reviewed_record_count: decisionRows.length,
      production_day_count: new Set(productionDates).size,
      completed_work_order_count: Number(workOrders.rows[0]?.completed_count ?? 0),
      decisions: decisionRows,
      reports: reports.rows,
      jsas: jsas.rows,
      corrections: corrections.rows,
      crews: crews.rows,
      capacity: capacity.rows,
      financial: financial.rows,
      risks: risks.rows,
    };
  }

  private components(stats: Awaited<ReturnType<PartnerPerformanceCapacityController["collectStats"]>>): Component[] {
    const reviewed = stats.reviewed_record_count;
    const accepted = stats.decisions.filter((row) => row.decision === "accepted").length;
    const partial = stats.decisions.filter((row) => row.decision === "partially_accepted").length;
    const rejected = stats.decisions.filter((row) => row.decision === "rejected").length;
    const correctionRequired = stats.decisions.filter((row) => row.decision === "correction_required").length;
    const acceptedQuantity = stats.decisions.reduce((sum, row) => sum + Number(row.customer_accepted_quantity ?? 0), 0);
    const reportedQuantity = stats.decisions.reduce((sum, row) => sum + Number(row.reported_quantity ?? row.quantity_submitted ?? 0), 0);
    const qualityScore = reviewed ? this.clamp(((accepted + partial * 0.75) / reviewed) * 100 - (rejected / reviewed) * 20) : 60;
    const correctionScore = reviewed ? this.clamp(100 - (correctionRequired / reviewed) * 70 - (stats.corrections.filter((row) => !["resolved", "cancelled"].includes(String(row.status))).length / Math.max(reviewed, 1)) * 20) : 60;
    const lfDays = stats.decisions.filter((row) => ["LF", "feet", "ft"].includes(String(row.unit_of_measure ?? row.unit)) && row.crew_type === "aerial");
    const lfAccepted = lfDays.reduce((sum, row) => sum + Number(row.customer_accepted_quantity ?? 0), 0);
    const productionScore = lfDays.length && stats.production_day_count ? this.clamp((lfAccepted / stats.production_day_count / 3000) * 100) : (acceptedQuantity > 0 ? 75 : 60);
    const submittedReports = stats.reports.length;
    const onTimeReports = stats.reports.filter((row) => this.onTimeReport(row)).length;
    const completedJsas = stats.jsas.filter((row) => row.status === "completed" && row.foreman_certified === true).length;
    const documentationScore = submittedReports || stats.jsas.length ? this.clamp((((submittedReports ? onTimeReports / submittedReports : 0.8) + (stats.jsas.length ? completedJsas / stats.jsas.length : 0.8)) / 2) * 100) : 60;
    const activeCriticalSafety = stats.risks.some((row) => ["safety_critical", "compliance_critical"].includes(String(row.risk_type)) && ["high", "critical"].includes(String(row.severity)));
    const safetyScore = activeCriticalSafety ? 40 : (stats.jsas.length ? this.clamp((completedJsas / stats.jsas.length) * 100) : 75);
    const mobilizationScore = Number(stats.crews.filter((row) => row.status === "active" && row.lifecycle_status !== "suspended").length) > 0 ? 85 : 60;
    const partnerFinancialIssues = stats.financial.filter((row) => ["partner_recovery_required", "payment_destination_not_ready"].includes(String(row.exception_type))).length;
    const commercialScore = this.clamp(100 - partnerFinancialIssues * 20);
    const activeCrews = stats.crews.filter((row) => row.status === "active" && row.lifecycle_status !== "suspended").length;
    const readyCapacity = stats.capacity.filter((row) => ["compliant", "approved"].includes(String(row.compliance_status)) && ["active", "approved"].includes(String(row.insurance_status)) && Number(row.current_utilization ?? 0) < 100).length;
    const capacityScore = activeCrews ? this.clamp((Math.min(activeCrews, Math.max(readyCapacity, 0)) / activeCrews) * 100) : 60;
    return [
      this.component("quality", "first_pass_customer_qc", qualityScore, reviewed, `${accepted}:${partial}:${correctionRequired}:${rejected}`, { reviewed, accepted, partial, correction_required: correctionRequired, rejected, accepted_quantity_ratio: reportedQuantity ? acceptedQuantity / reportedQuantity : null }),
      this.component("production", "accepted_lf_per_aerial_crew_day", productionScore, stats.production_day_count, lfAccepted, { accepted_lf: lfAccepted, production_days: stats.production_day_count, target_lf_per_day: lfDays.length ? 3000 : null }),
      this.component("documentation", "report_jsa_timeliness", documentationScore, submittedReports + stats.jsas.length, onTimeReports + completedJsas, { submitted_reports: submittedReports, on_time_reports: onTimeReports, jsas: stats.jsas.length, completed_jsas: completedJsas, report_due_policy: "21:00 same production day" }),
      this.component("safety", "safety_compliance", safetyScore, stats.jsas.length, completedJsas, { active_critical_safety: activeCriticalSafety, jsa_count: stats.jsas.length }),
      this.component("mobilization", "crew_readiness_presence", mobilizationScore, stats.crews.length, activeCrews, { active_crews: activeCrews, suspended_crews: stats.crews.filter((row) => row.lifecycle_status === "suspended").length }),
      this.component("correction_rework", "customer_correction_rate", correctionScore, reviewed, correctionRequired, { correction_required: correctionRequired, open_corrections: stats.corrections.filter((row) => !["resolved", "cancelled"].includes(String(row.status))).length }),
      this.component("commercial_reliability", "partner_attributable_financial_exceptions", commercialScore, stats.financial.length, partnerFinancialIssues, { partner_attributable_financial_issues: partnerFinancialIssues, excludes_customer_late_payment: true, excludes_sync_payment_delay: true }),
      this.component("capacity_reliability", "verified_deployable_capacity", capacityScore, activeCrews, readyCapacity, { active_crews: activeCrews, ready_capacity_records: readyCapacity }),
    ];
  }

  private component(dimension: keyof typeof weights, metric: string, score: number, sampleSize: number, value: number | string, source: Record<string, unknown>): Component {
    const normalized = this.roundScore(score);
    const weight = weights[dimension];
    return {
      dimension,
      metric_code: metric,
      metric_value: typeof value === "number" ? this.roundScore(value) : 0,
      metric_unit: typeof value === "string" ? value : "count",
      normalized_score: normalized,
      weight,
      weighted_contribution: this.roundScore((normalized * weight) / 100),
      sample_size: sampleSize,
      reason_code: `${dimension}_${metric}`,
      source_summary: source,
    };
  }

  private capacitySnapshots(stats: Awaited<ReturnType<PartnerPerformanceCapacityController["collectStats"]>>, partner: Row, score: number, confidence: string, fingerprint: string) {
    const activeCrews = stats.crews.filter((row) => row.status === "active" && row.lifecycle_status !== "suspended");
    const capacityByKey = new Map<string, Row>();
    for (const row of stats.capacity) capacityByKey.set(`${row.territory_id ?? "none"}:${row.capacity_type ?? "general"}:${row.unit ?? ""}`, row);
    const base = [...capacityByKey.values()];
    const rows = base.length ? base : [{ territory_id: null, capacity_type: activeCrews[0]?.crew_type ?? "general", unit: activeCrews[0]?.crew_type ?? "general", compliance_status: "missing", insurance_status: "missing", current_utilization: null } as Row];
    return rows.flatMap((row) => {
      const matchingCrews = activeCrews.filter((crew) => !row.capacity_type || String(row.capacity_type).includes(String(crew.crew_type)));
      const ready = ["compliant", "approved"].includes(String(row.compliance_status)) && ["active", "approved"].includes(String(row.insurance_status));
      const unverified = ready ? 0 : Math.max(1, Number(row.quantity ?? matchingCrews.length ?? 0));
      const readyCount = ready ? Math.max(1, Math.min(matchingCrews.length || Number(row.quantity ?? 1), Number(row.quantity ?? (matchingCrews.length || 1)))) : 0;
      const committed = Number(row.current_utilization ?? 0) >= 100 ? readyCount : 0;
      const recommendation = !ready ? "available_low_confidence" : score < 70 ? "performance_watch" : readyCount - committed > 0 && confidence !== "low" ? "best_fit" : "capacity_constrained";
      return ["now_24h", "72h", "1_week", "2_weeks", "30_days", "60_days"].map((horizon) => ({
        territory_id: row.territory_id ?? null,
        crew_type: matchingCrews[0]?.crew_type ?? String(row.capacity_type ?? "general"),
        capability: String(row.capacity_type ?? matchingCrews[0]?.crew_type ?? "general"),
        horizon,
        ready_crew_count: ready ? Math.max(0, readyCount - committed) : 0,
        conditional_crew_count: ready && horizon !== "now_24h" ? Math.max(0, Number(row.quantity ?? readyCount) - readyCount) : 0,
        unverified_crew_count: ready ? 0 : unverified,
        committed_crew_count: committed,
        capacity_confidence: ready ? (confidence === "high" ? "high" : "medium") : "low",
        recommendation,
        source_fingerprint: fingerprint,
      }));
    });
  }

  private async crewPerformance(client: PoolClient, tenantId: string, partnerOrganizationId: string) {
    const result = await client.query(
      `
      SELECT c.id, c.name, c.crew_type,
        count(DISTINCT prd.id)::int AS reviewed_records,
        count(DISTINCT dpr.work_date)::int AS production_days,
        COALESCE(sum(cqd.customer_accepted_quantity) FILTER (WHERE cqd.decision IN ('accepted','partially_accepted')),0)::numeric AS accepted_quantity,
        count(cqd.id) FILTER (WHERE cqd.decision = 'correction_required')::int AS correction_count,
        count(dj.id) FILTER (WHERE dj.status = 'completed' AND dj.foreman_certified = true)::int AS completed_jsas
      FROM crews c
      LEFT JOIN production_records prd ON prd.tenant_id = c.tenant_id AND prd.crew_id = c.id AND prd.deleted_at IS NULL
      LEFT JOIN daily_production_reports dpr ON dpr.tenant_id = prd.tenant_id AND dpr.id = prd.daily_production_report_id
      LEFT JOIN customer_qc_decisions cqd ON cqd.tenant_id = prd.tenant_id AND cqd.production_record_id = prd.id AND cqd.current = true AND cqd.deleted_at IS NULL
      LEFT JOIN daily_jsas dj ON dj.tenant_id = c.tenant_id AND dj.crew_id = c.id AND dj.deleted_at IS NULL
      WHERE c.tenant_id = $1 AND c.organization_id = $2 AND c.deleted_at IS NULL
      GROUP BY c.id
      ORDER BY c.name
      `,
      [tenantId, partnerOrganizationId],
    );
    return result.rows.map((row) => {
      const reviewed = Number(row.reviewed_records ?? 0);
      const correctionRate = reviewed ? Number(row.correction_count ?? 0) / reviewed : 0;
      return {
        ...row,
        crew_score: this.roundScore(this.clamp(85 - correctionRate * 40 + Math.min(Number(row.production_days ?? 0), 10))),
        worker_ranking: false,
      };
    });
  }

  private async partners(client: PoolClient, tenantId: string, partnerOrganizationId: string | null) {
    const result = await client.query(
      `
      SELECT o.id AS organization_id, o.name, o.status AS organization_status, cp.id AS capacity_provider_id, cp.status AS provider_status
      FROM organizations o
      LEFT JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.deleted_at IS NULL
      WHERE o.tenant_id = $1
        AND o.deleted_at IS NULL
        AND o.status IN ('active','strategic','qualified')
        AND ('capacity_provider' = ANY(o.actor_roles) OR o.organization_type = 'subcontractor')
        AND ($2::uuid IS NULL OR o.id = $2::uuid)
      ORDER BY o.name
      `,
      [tenantId, partnerOrganizationId],
    );
    if (partnerOrganizationId && !result.rows[0]) throw new NotFoundException("partner organization not found");
    return result.rows;
  }

  private async requireCurrentSnapshot(client: PoolClient, tenantId: string, partnerOrganizationId: string) {
    const result = await client.query("SELECT * FROM partner_performance_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true LIMIT 1", [tenantId, partnerOrganizationId]);
    if (!result.rows[0]) throw new NotFoundException("partner performance snapshot not found");
    return result.rows[0] as Row;
  }

  private async activeRisks(client: PoolClient, tenantId: string, partnerOrganizationId: string) {
    const result = await client.query("SELECT * FROM partner_risk_flags WHERE tenant_id = $1 AND partner_organization_id = $2 AND status = 'active'", [tenantId, partnerOrganizationId]);
    return result.rows;
  }

  private async partnerContext(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      `
      SELECT cp.organization_id, cp.id AS capacity_provider_id
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_id = tu.tenant_id AND ur.tenant_user_id = tu.id
      JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id AND r.system_key = 'partner_admin'
      JOIN capacity_providers cp ON cp.tenant_id = tu.tenant_id AND cp.organization_id = ur.scope_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND ur.scope_type = 'organization'
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new ForbiddenException("Partner performance summary is unavailable");
    return result.rows[0] as Row;
  }

  private confidence(stats: { reviewed_record_count: number; production_day_count: number }) {
    if (stats.reviewed_record_count < 5 || stats.production_day_count < 3) return "low";
    if (stats.reviewed_record_count < 25 || stats.production_day_count < 10) return "medium";
    return "high";
  }

  private lifecycleRecommendation(score: number, confidence: string, stats: { production_day_count: number; reviewed_record_count: number; completed_work_order_count: number }, criticalRiskCount: number) {
    if (criticalRiskCount > 0) return { recommendation: "suspend_review", recommended_lifecycle_status: null, reason_code: "active_critical_risk_requires_governance_review" };
    if (confidence === "low") return { recommendation: "insufficient_data", recommended_lifecycle_status: null, reason_code: "minimum_sample_not_met" };
    if (score >= 90 && confidence === "high" && stats.completed_work_order_count >= 2) return { recommendation: "promote", recommended_lifecycle_status: "strategic_partner", reason_code: "sustained_high_score_high_confidence" };
    if (score >= 80 && ["medium", "high"].includes(confidence) && stats.production_day_count >= 5) return { recommendation: "promote", recommended_lifecycle_status: "preferred", reason_code: "preferred_candidate_evidence_met" };
    if (score < 60 && confidence !== "low") return { recommendation: "review", recommended_lifecycle_status: null, reason_code: "high_risk_score_review" };
    return { recommendation: "maintain", recommended_lifecycle_status: null, reason_code: "maintain_current_lifecycle" };
  }

  private trend(score: number, prior: Row | undefined) {
    if (!prior) return "insufficient_data";
    const delta = score - Number(prior.score ?? score);
    if (delta >= 3) return "improving";
    if (delta <= -3) return "declining";
    return "stable";
  }

  private scoreBand(score: number) {
    if (score >= 90) return "excellent";
    if (score >= 80) return "strong";
    if (score >= 70) return "acceptable";
    if (score >= 60) return "watch";
    return "high_risk";
  }

  private onTimeReport(row: Row) {
    if (!row.submitted_at) return false;
    const submitted = new Date(String(row.submitted_at));
    return submitted.getUTCHours() < 21 || (submitted.getUTCHours() === 21 && submitted.getUTCMinutes() === 0);
  }

  private dateOnly(value: unknown) {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }

  private safeSnapshot(row: Row) {
    const { source_fingerprint, internal_notes, customer_rate, contractor_rate, margin, bank_account, provider_secret, ...safe } = row;
    return safe;
  }

  private safeCapacity(row: Row) {
    const { source_fingerprint, internal_notes, customer_rate, margin, worker_id, worker_name, ...safe } = row;
    return safe;
  }

  private boundary() {
    return {
      score_is_derived: true,
      lifecycle_auto_changed: false,
      contract_auto_changed: false,
      payment_auto_changed: false,
      worker_ranking_created: false,
    };
  }

  private optional(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private clamp(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  private roundScore(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private sourceFingerprint(parts: unknown[]) {
    return crypto.createHash("sha256").update(parts.map((part) => String(part)).join("|")).digest("base64url");
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
    return this.withClient((client) => executeWriteAction(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action,
      aggregateType,
      eventType,
      write,
    }));
  }
}
