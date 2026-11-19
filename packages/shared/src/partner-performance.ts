import crypto from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

type Row = QueryResultRow & Record<string, unknown>;

type Component = {
  dimension: keyof typeof partnerPerformanceWeights;
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

export const partnerPerformancePolicyVersion = "partner_performance_v1";
export const partnerPerformanceWeights = {
  quality: 25,
  production: 15,
  documentation: 10,
  safety: 15,
  mobilization: 10,
  correction_rework: 10,
  commercial_reliability: 5,
  capacity_reliability: 10,
} as const;

const horizons = ["now_24h", "72h", "1_week", "2_weeks", "30_days", "60_days"] as const;

export type PartnerPerformanceRecalculationResult = {
  scannedAt: string;
  scannedPartners: number;
  createdSnapshots: number;
  locked: boolean;
};

export async function runPartnerPerformanceRecalculationScan(
  client: PoolClient,
  options: { asOf?: string | Date; batchSize?: number; actorUserId?: string | null; tenantId?: string | null; partnerOrganizationId?: string | null } = {},
): Promise<PartnerPerformanceRecalculationResult> {
  const asOf = normalizeAsOf(options.asOf);
  const batchSize = Math.max(1, Math.min(Number(options.batchSize ?? 50), 250));
  const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('syncos.p14.partner_performance_recalculation_scan')) AS locked");
  if (!lock.rows[0]?.locked) return { scannedAt: asOf.toISOString(), scannedPartners: 0, createdSnapshots: 0, locked: false };
  let scannedPartners = 0;
  let createdSnapshots = 0;
  try {
    const partners = await partnerCandidates(client, options.tenantId ?? null, options.partnerOrganizationId ?? null, batchSize);
    for (const partner of partners) {
      const result = await recalculatePartnerPerformance(client, {
        tenantId: String(partner.tenant_id),
        partner,
        actorUserId: options.actorUserId ?? null,
        asOf,
      });
      scannedPartners += 1;
      if (result.created) createdSnapshots += 1;
    }
    return { scannedAt: asOf.toISOString(), scannedPartners, createdSnapshots, locked: true };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('syncos.p14.partner_performance_recalculation_scan'))");
  }
}

export async function recalculatePartnerPerformance(
  client: PoolClient,
  input: { tenantId: string; partner: Row; actorUserId?: string | null; asOf?: string | Date },
): Promise<{ snapshot: Row; created: boolean }> {
  const asOf = normalizeAsOf(input.asOf);
  const stats = await collectStats(client, input.tenantId, input.partner, asOf);
  const components = scoreComponents(stats);
  const score = roundScore(components.reduce((sum, component) => sum + component.weighted_contribution, 0));
  const confidence = confidenceFor(stats);
  const risks = await activeRisks(client, input.tenantId, String(input.partner.organization_id));
  const criticalRiskCount = risks.filter((risk) => ["high", "critical"].includes(String(risk.severity))).length;
  const prior = await client.query("SELECT * FROM partner_performance_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true ORDER BY calculated_at DESC LIMIT 1", [input.tenantId, input.partner.organization_id]);
  const trend = trendFor(score, prior.rows[0]);
  const lifecycle = lifecycleRecommendation(score, confidence, stats, criticalRiskCount);
  const fingerprint = sourceFingerprint([partnerPerformancePolicyVersion, asOfFingerprintBucket(asOf), JSON.stringify(stats), criticalRiskCount]);
  const existing = await client.query("SELECT * FROM partner_performance_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND scoring_policy_version = $3 AND source_fingerprint = $4 LIMIT 1", [input.tenantId, input.partner.organization_id, partnerPerformancePolicyVersion, fingerprint]);
  if (existing.rows[0]) return { snapshot: existing.rows[0] as Row, created: false };

  await client.query("UPDATE partner_performance_snapshots SET current = false WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true", [input.tenantId, input.partner.organization_id]);
  await client.query("UPDATE partner_lifecycle_recommendations SET current = false WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true", [input.tenantId, input.partner.organization_id]);
  await client.query("UPDATE partner_capacity_intelligence_snapshots SET current = false WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true", [input.tenantId, input.partner.organization_id]);

  const inserted = await client.query(
    `
    INSERT INTO partner_performance_snapshots (
      tenant_id, partner_organization_id, capacity_provider_id, scoring_policy_version, score, score_band, confidence,
      quality_score, production_score, documentation_score, safety_score, mobilization_score, correction_score,
      commercial_score, capacity_reliability_score, trend, lifecycle_recommendation, sample_start, sample_end,
      production_day_count, reviewed_record_count, completed_work_order_count, critical_risk_count, source_fingerprint,
      calculated_at, created_by_user_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    RETURNING *
    `,
    [
      input.tenantId,
      input.partner.organization_id,
      input.partner.capacity_provider_id,
      partnerPerformancePolicyVersion,
      score,
      scoreBand(score),
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
      asOf,
      input.actorUserId ?? null,
    ],
  );
  const snapshot = inserted.rows[0] as Row;
  for (const component of components) {
    await client.query(
      "INSERT INTO partner_performance_score_components (tenant_id,snapshot_id,partner_organization_id,dimension,metric_code,metric_value,metric_unit,normalized_score,weight,weighted_contribution,sample_size,reason_code,source_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [input.tenantId, snapshot.id, input.partner.organization_id, component.dimension, component.metric_code, component.metric_value, component.metric_unit, component.normalized_score, component.weight, component.weighted_contribution, component.sample_size, component.reason_code, JSON.stringify(component.source_summary)],
    );
  }
  await client.query(
    "INSERT INTO partner_lifecycle_recommendations (tenant_id,partner_organization_id,snapshot_id,current_lifecycle_status,recommendation,recommended_lifecycle_status,confidence,reason_code,governance_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)",
    [input.tenantId, input.partner.organization_id, snapshot.id, input.partner.organization_status, lifecycle.recommendation, lifecycle.recommended_lifecycle_status, confidence, lifecycle.reason_code],
  );
  for (const capacity of capacitySnapshots(stats, input.partner, score, confidence, fingerprint, asOf)) {
    await client.query(
      "INSERT INTO partner_capacity_intelligence_snapshots (tenant_id,partner_organization_id,capacity_provider_id,territory_id,crew_type,capability,horizon,ready_crew_count,conditional_crew_count,unverified_crew_count,committed_crew_count,capacity_confidence,recommendation,source_fingerprint,calculated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [input.tenantId, input.partner.organization_id, input.partner.capacity_provider_id, capacity.territory_id, capacity.crew_type, capacity.capability, capacity.horizon, capacity.ready_crew_count, capacity.conditional_crew_count, capacity.unverified_crew_count, capacity.committed_crew_count, capacity.capacity_confidence, capacity.recommendation, `${fingerprint}:${capacity.horizon}:${capacity.capability}`, asOf],
    );
  }
  return { snapshot, created: true };
}

async function partnerCandidates(client: PoolClient, tenantId: string | null, partnerOrganizationId: string | null, batchSize: number) {
  const result = await client.query(
    `
    SELECT DISTINCT o.tenant_id, o.id AS organization_id, o.name, o.status AS organization_status, cp.id AS capacity_provider_id, cp.status AS provider_status
    FROM organizations o
    LEFT JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.deleted_at IS NULL
    WHERE o.deleted_at IS NULL
      AND ($1::uuid IS NULL OR o.tenant_id = $1::uuid)
      AND o.status IN ('active','strategic','qualified')
      AND ('capacity_provider' = ANY(o.actor_roles) OR o.organization_type = 'subcontractor')
      AND ($2::uuid IS NULL OR o.id = $2::uuid)
      AND (
        EXISTS (SELECT 1 FROM partner_performance_snapshots s WHERE s.tenant_id = o.tenant_id AND s.partner_organization_id = o.id AND s.current = true)
        OR EXISTS (SELECT 1 FROM production_records pr WHERE pr.tenant_id = o.tenant_id AND pr.partner_organization_id = o.id AND pr.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM customer_qc_decisions cqd JOIN production_records pr ON pr.tenant_id = cqd.tenant_id AND pr.id = cqd.production_record_id WHERE pr.partner_organization_id = o.id AND cqd.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM partner_risk_flags rf WHERE rf.tenant_id = o.tenant_id AND rf.partner_organization_id = o.id AND rf.status = 'active')
        OR EXISTS (SELECT 1 FROM capacity_records cr WHERE cr.tenant_id = o.tenant_id AND cr.capacity_provider_id = cp.id AND cr.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM partner_lifecycle_recommendations lr WHERE lr.tenant_id = o.tenant_id AND lr.partner_organization_id = o.id AND lr.current = true)
      )
    ORDER BY o.name
    LIMIT $3
    `,
    [tenantId, partnerOrganizationId, batchSize],
  );
  return result.rows;
}

async function collectStats(client: PoolClient, tenantId: string, partner: Row, asOf: Date) {
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
  const reports = await client.query(
    `
    SELECT dpr.work_date, dpr.submitted_at, dpr.status, dpr.completeness_status, psa.timezone AS operational_timezone
    FROM daily_production_reports dpr
    LEFT JOIN LATERAL (
      SELECT timezone
      FROM production_start_authorizations psa
      WHERE psa.tenant_id = dpr.tenant_id
        AND psa.work_order_version_id = dpr.work_order_version_id
        AND psa.organization_id = dpr.organization_id
        AND psa.crew_id = dpr.crew_id
        AND psa.current = true
        AND psa.authorization_status IN ('scheduled','authorized')
      ORDER BY psa.created_at DESC
      LIMIT 1
    ) psa ON true
    WHERE dpr.tenant_id = $1 AND dpr.organization_id = $2 AND dpr.deleted_at IS NULL AND dpr.status = 'submitted'
    `,
    [tenantId, partnerId],
  );
  const jsas = await client.query("SELECT work_date, status, foreman_certified, submitted_at FROM daily_jsas WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL", [tenantId, partnerId]);
  const corrections = await client.query("SELECT status, correction_type, created_at, resolved_at, resubmitted_at FROM production_corrections WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL", [tenantId, partnerId]);
  const crews = await client.query("SELECT id, name, crew_type, status, lifecycle_status, target_staffing_level FROM crews WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL", [tenantId, partnerId]);
  const capacity = await client.query("SELECT territory_id, capacity_type, compliance_status, insurance_status, current_utilization, readiness_score, quantity, unit, effective_date, availability_start, availability_end FROM capacity_records WHERE tenant_id = $1 AND capacity_provider_id = $2 AND deleted_at IS NULL", [tenantId, partner.capacity_provider_id]);
  const financial = await client.query("SELECT exception_type, severity, status FROM financial_exceptions WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND status = 'open'", [tenantId, partnerId]);
  const workOrders = await client.query("SELECT count(*)::int AS completed_count FROM work_orders WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND status IN ('closed','billable','approved')", [tenantId, partnerId]);
  const risks = await client.query("SELECT risk_type,severity,status,detected_at,resolved_at FROM partner_risk_flags WHERE tenant_id = $1 AND partner_organization_id = $2 AND status = 'active'", [tenantId, partnerId]);
  const decisionRows = decisions.rows;
  const productionDates = decisionRows.map((row) => dateOnly(row.production_date)).filter(Boolean).sort();
  return {
    partner_id: partnerId,
    as_of_date: dateOnly(asOf),
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

function scoreComponents(stats: Awaited<ReturnType<typeof collectStats>>): Component[] {
  const reviewed = stats.reviewed_record_count;
  const accepted = stats.decisions.filter((row) => row.decision === "accepted").length;
  const partial = stats.decisions.filter((row) => row.decision === "partially_accepted").length;
  const rejected = stats.decisions.filter((row) => row.decision === "rejected").length;
  const correctionRequired = stats.decisions.filter((row) => row.decision === "correction_required").length;
  const acceptedQuantity = stats.decisions.reduce((sum, row) => sum + Number(row.customer_accepted_quantity ?? 0), 0);
  const reportedQuantity = stats.decisions.reduce((sum, row) => sum + Number(row.reported_quantity ?? row.quantity_submitted ?? 0), 0);
  const qualityScore = reviewed ? clamp(((accepted + partial * 0.75) / reviewed) * 100 - (rejected / reviewed) * 20) : 60;
  const correctionScore = reviewed ? clamp(100 - (correctionRequired / reviewed) * 70 - (stats.corrections.filter((row) => !["resolved", "cancelled"].includes(String(row.status))).length / Math.max(reviewed, 1)) * 20) : 60;
  const lfDays = stats.decisions.filter((row) => ["LF", "feet", "ft"].includes(String(row.unit_of_measure ?? row.unit)) && row.crew_type === "aerial");
  const lfAccepted = lfDays.reduce((sum, row) => sum + Number(row.customer_accepted_quantity ?? 0), 0);
  const productionScore = lfDays.length && stats.production_day_count ? clamp((lfAccepted / stats.production_day_count / 3000) * 100) : (acceptedQuantity > 0 ? 75 : 60);
  const evaluatedReports = stats.reports.map((row) => reportTimeliness(row)).filter((result) => result.evaluated);
  const onTimeReports = evaluatedReports.filter((result) => result.on_time).length;
  const completedJsas = stats.jsas.filter((row) => row.status === "completed" && row.foreman_certified === true).length;
  const documentationScore = evaluatedReports.length || stats.jsas.length ? clamp((((evaluatedReports.length ? onTimeReports / evaluatedReports.length : 0.8) + (stats.jsas.length ? completedJsas / stats.jsas.length : 0.8)) / 2) * 100) : 60;
  const activeCriticalSafety = stats.risks.some((row) => ["safety_critical", "compliance_critical"].includes(String(row.risk_type)) && ["high", "critical"].includes(String(row.severity)));
  const safetyScore = activeCriticalSafety ? 40 : (stats.jsas.length ? clamp((completedJsas / stats.jsas.length) * 100) : 75);
  const mobilizationScore = Number(stats.crews.filter((row) => row.status === "active" && row.lifecycle_status !== "suspended").length) > 0 ? 85 : 60;
  const partnerFinancialIssues = stats.financial.filter((row) => ["partner_recovery_required", "payment_destination_not_ready"].includes(String(row.exception_type))).length;
  const commercialScore = clamp(100 - partnerFinancialIssues * 20);
  const activeCrews = stats.crews.filter((row) => row.status === "active" && row.lifecycle_status !== "suspended").length;
  const readyCapacity = stats.capacity.filter((row) => isReadyCapacity(row, new Date(`${stats.as_of_date}T00:00:00Z`), "now_24h")).length;
  const capacityScore = activeCrews ? clamp((Math.min(activeCrews, Math.max(readyCapacity, 0)) / activeCrews) * 100) : 60;
  return [
    component("quality", "first_pass_customer_qc", qualityScore, reviewed, `${accepted}:${partial}:${correctionRequired}:${rejected}`, { reviewed, accepted, partial, correction_required: correctionRequired, rejected, accepted_quantity_ratio: reportedQuantity ? acceptedQuantity / reportedQuantity : null }),
    component("production", "accepted_lf_per_aerial_crew_day", productionScore, stats.production_day_count, lfAccepted, { accepted_lf: lfAccepted, production_days: stats.production_day_count, target_lf_per_day: lfDays.length ? 3000 : null }),
    component("documentation", "report_jsa_timeliness", documentationScore, evaluatedReports.length + stats.jsas.length, onTimeReports + completedJsas, { submitted_reports: stats.reports.length, evaluated_reports: evaluatedReports.length, on_time_reports: onTimeReports, timezone_missing_reports: stats.reports.length - evaluatedReports.length, jsas: stats.jsas.length, completed_jsas: completedJsas, report_due_policy: "21:00 operational timezone same production day" }),
    component("safety", "safety_compliance", safetyScore, stats.jsas.length, completedJsas, { active_critical_safety: activeCriticalSafety, jsa_count: stats.jsas.length }),
    component("mobilization", "crew_readiness_presence", mobilizationScore, stats.crews.length, activeCrews, { active_crews: activeCrews, suspended_crews: stats.crews.filter((row) => row.lifecycle_status === "suspended").length }),
    component("correction_rework", "customer_correction_rate", correctionScore, reviewed, correctionRequired, { correction_required: correctionRequired, open_corrections: stats.corrections.filter((row) => !["resolved", "cancelled"].includes(String(row.status))).length }),
    component("commercial_reliability", "partner_attributable_financial_exceptions", commercialScore, stats.financial.length, partnerFinancialIssues, { partner_attributable_financial_issues: partnerFinancialIssues, excludes_customer_late_payment: true, excludes_sync_payment_delay: true }),
    component("capacity_reliability", "verified_deployable_capacity", capacityScore, activeCrews, readyCapacity, { active_crews: activeCrews, ready_capacity_records: readyCapacity }),
  ];
}

function capacitySnapshots(stats: Awaited<ReturnType<typeof collectStats>>, partner: Row, score: number, confidence: string, fingerprint: string, asOf: Date) {
  const activeCrews = stats.crews.filter((row) => row.status === "active" && row.lifecycle_status !== "suspended");
  const capacityByKey = new Map<string, Row>();
  for (const row of stats.capacity) capacityByKey.set(`${row.territory_id ?? "none"}:${row.capacity_type ?? "general"}:${row.unit ?? ""}`, row);
  const base = [...capacityByKey.values()];
  const rows = base.length ? base : [{ territory_id: null, capacity_type: activeCrews[0]?.crew_type ?? "general", unit: activeCrews[0]?.crew_type ?? "general", compliance_status: "missing", insurance_status: "missing", current_utilization: null } as Row];
  return rows.flatMap((row) => {
    const matchingCrews = activeCrews.filter((crew) => !row.capacity_type || String(row.capacity_type).includes(String(crew.crew_type)));
    return horizons.map((horizon) => {
      const ready = isReadyCapacity(row, asOf, horizon);
      const unverified = ready ? 0 : Math.max(1, Number(row.quantity ?? matchingCrews.length ?? 0));
      const readyCount = ready ? Math.max(1, Math.min(matchingCrews.length || Number(row.quantity ?? 1), Number(row.quantity ?? (matchingCrews.length || 1)))) : 0;
      const committed = Number(row.current_utilization ?? 0) >= 100 ? readyCount : 0;
      const recommendation = !ready ? "available_low_confidence" : score < 70 ? "performance_watch" : readyCount - committed > 0 && confidence !== "low" ? "best_fit" : "capacity_constrained";
      return {
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
      };
    });
  });
}

function reportTimeliness(row: Row) {
  if (!row.submitted_at || !row.operational_timezone || !dateOnly(row.work_date)) return { evaluated: false, on_time: false };
  try {
    const submittedParts = zonedParts(new Date(String(row.submitted_at)), String(row.operational_timezone));
    const workDate = dateOnly(row.work_date);
    const submittedDate = `${submittedParts.year}-${submittedParts.month}-${submittedParts.day}`;
    const localMinutes = submittedParts.hour * 60 + submittedParts.minute;
    return { evaluated: true, on_time: submittedDate < workDate || (submittedDate === workDate && localMinutes <= 21 * 60) };
  } catch {
    return { evaluated: false, on_time: false };
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: String(get("month")).padStart(2, "0"), day: String(get("day")).padStart(2, "0"), hour: get("hour"), minute: get("minute") };
}

function isReadyCapacity(row: Row, asOf: Date, horizon: string) {
  if (!["compliant", "approved"].includes(String(row.compliance_status)) || !["active", "approved"].includes(String(row.insurance_status))) return false;
  if (Number(row.current_utilization ?? 0) >= 100) return false;
  const availabilityStart = row.availability_start ? new Date(`${dateOnly(row.availability_start)}T00:00:00Z`) : null;
  const availabilityEnd = row.availability_end ? new Date(`${dateOnly(row.availability_end)}T23:59:59Z`) : null;
  const horizonDate = addDays(asOf, horizonDays(horizon));
  if (availabilityStart && availabilityStart > horizonDate) return false;
  if (availabilityEnd && availabilityEnd < asOf) return false;
  return true;
}

function horizonDays(horizon: string) {
  if (horizon === "now_24h") return 1;
  if (horizon === "72h") return 3;
  if (horizon === "1_week") return 7;
  if (horizon === "2_weeks") return 14;
  if (horizon === "30_days") return 30;
  return 60;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function component(dimension: keyof typeof partnerPerformanceWeights, metric: string, score: number, sampleSize: number, value: number | string, source: Record<string, unknown>): Component {
  const normalized = roundScore(score);
  const weight = partnerPerformanceWeights[dimension];
  return { dimension, metric_code: metric, metric_value: typeof value === "number" ? roundScore(value) : 0, metric_unit: typeof value === "string" ? value : "count", normalized_score: normalized, weight, weighted_contribution: roundScore((normalized * weight) / 100), sample_size: sampleSize, reason_code: `${dimension}_${metric}`, source_summary: source };
}

async function activeRisks(client: PoolClient, tenantId: string, partnerOrganizationId: string) {
  const result = await client.query("SELECT * FROM partner_risk_flags WHERE tenant_id = $1 AND partner_organization_id = $2 AND status = 'active'", [tenantId, partnerOrganizationId]);
  return result.rows;
}

function confidenceFor(stats: { reviewed_record_count: number; production_day_count: number }) {
  if (stats.reviewed_record_count < 5 || stats.production_day_count < 3) return "low";
  if (stats.reviewed_record_count < 25 || stats.production_day_count < 10) return "medium";
  return "high";
}

function lifecycleRecommendation(score: number, confidence: string, stats: { production_day_count: number; completed_work_order_count: number }, criticalRiskCount: number) {
  if (criticalRiskCount > 0) return { recommendation: "suspend_review", recommended_lifecycle_status: null, reason_code: "active_critical_risk_requires_governance_review" };
  if (confidence === "low") return { recommendation: "insufficient_data", recommended_lifecycle_status: null, reason_code: "minimum_sample_not_met" };
  if (score >= 90 && confidence === "high" && stats.completed_work_order_count >= 2) return { recommendation: "promote", recommended_lifecycle_status: "strategic_partner", reason_code: "sustained_high_score_high_confidence" };
  if (score >= 80 && ["medium", "high"].includes(confidence) && stats.production_day_count >= 5) return { recommendation: "promote", recommended_lifecycle_status: "preferred", reason_code: "preferred_candidate_evidence_met" };
  if (score < 60 && confidence !== "low") return { recommendation: "review", recommended_lifecycle_status: null, reason_code: "high_risk_score_review" };
  return { recommendation: "maintain", recommended_lifecycle_status: null, reason_code: "maintain_current_lifecycle" };
}

function trendFor(score: number, prior: Row | undefined) {
  if (!prior) return "insufficient_data";
  const delta = score - Number(prior.score ?? score);
  if (delta >= 3) return "improving";
  if (delta <= -3) return "declining";
  return "stable";
}

function scoreBand(score: number) {
  if (score >= 90) return "excellent";
  if (score >= 80) return "strong";
  if (score >= 70) return "acceptable";
  if (score >= 60) return "watch";
  return "high_risk";
}

function dateOnly(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeAsOf(value: string | Date | undefined) {
  if (value instanceof Date) return value;
  return value ? new Date(value) : new Date();
}

function asOfFingerprintBucket(value: Date) {
  return value.toISOString().slice(0, 10);
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function roundScore(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sourceFingerprint(parts: unknown[]) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part)).join("|")).digest("base64url");
}
