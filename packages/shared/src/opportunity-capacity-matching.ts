import crypto from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

type Row = QueryResultRow & Record<string, unknown>;

export const opportunityCapacityMatchingPolicyVersion = "opportunity_capacity_match_v1";

export const opportunityCapacityMatchWeights = {
  availability: 25,
  capability: 20,
  territory: 10,
  readiness: 15,
  performance: 15,
  capacity_confidence: 10,
  risk_reliability: 5,
} as const;

export type OpportunityCapacityMatchingScanResult = {
  scannedAt: string;
  scannedOpportunities: number;
  createdPartnerMatches: number;
  createdCoverageOptions: number;
  locked: boolean;
};

type Requirement = Row & {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  territory_id: string;
  capability: string;
  crew_type: string;
  required_crew_count: number;
  required_start_date: string | Date;
  required_start_window: string;
  required_equipment_types: string[] | null;
  required_compliance_types: string[] | null;
  required_customer_clearances: string[] | null;
};

export async function runOpportunityCapacityMatchingScan(
  client: PoolClient,
  options: { asOf?: string | Date; batchSize?: number; actorUserId?: string | null; tenantId?: string | null; opportunityId?: string | null } = {},
): Promise<OpportunityCapacityMatchingScanResult> {
  const asOf = normalizeAsOf(options.asOf);
  const batchSize = Math.max(1, Math.min(Number(options.batchSize ?? 50), 250));
  const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('syncos.p15.opportunity_capacity_matching_scan')) AS locked");
  if (!lock.rows[0]?.locked) return { scannedAt: asOf.toISOString(), scannedOpportunities: 0, createdPartnerMatches: 0, createdCoverageOptions: 0, locked: false };
  let scannedOpportunities = 0;
  let createdPartnerMatches = 0;
  let createdCoverageOptions = 0;
  try {
    const requirements = await currentRequirementCandidates(client, options.tenantId ?? null, options.opportunityId ?? null, batchSize);
    for (const requirement of requirements) {
      const result = await recalculateOpportunityCapacityMatch(client, {
        tenantId: String(requirement.tenant_id),
        opportunityId: String(requirement.opportunity_id),
        requirementProfileId: String(requirement.id),
        actorUserId: options.actorUserId ?? null,
        asOf,
      });
      scannedOpportunities += 1;
      createdPartnerMatches += result.createdPartnerMatches;
      createdCoverageOptions += result.createdCoverageOptions;
    }
    return { scannedAt: asOf.toISOString(), scannedOpportunities, createdPartnerMatches, createdCoverageOptions, locked: true };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('syncos.p15.opportunity_capacity_matching_scan'))");
  }
}

export async function recalculateOpportunityCapacityMatch(
  client: PoolClient,
  input: { tenantId: string; opportunityId: string; requirementProfileId?: string | null; actorUserId?: string | null; asOf?: string | Date },
): Promise<{ requirement: Row; partnerMatches: Row[]; coverageOptions: Row[]; createdPartnerMatches: number; createdCoverageOptions: number }> {
  const asOf = normalizeAsOf(input.asOf);
  const requirement = await requireRequirement(client, input.tenantId, input.opportunityId, input.requirementProfileId ?? null);
  const partners = await partnerCandidates(client, input.tenantId);
  const insertedMatches: Row[] = [];
  let createdPartnerMatches = 0;

  for (const partner of partners) {
    const evaluation = await evaluatePartner(client, requirement, partner, asOf);
    const existing = await client.query(
      "SELECT * FROM opportunity_partner_match_snapshots WHERE tenant_id = $1 AND opportunity_id = $2 AND requirement_profile_id = $3 AND partner_organization_id = $4 AND matching_policy_version = $5 AND source_fingerprint = $6 LIMIT 1",
      [input.tenantId, requirement.opportunity_id, requirement.id, partner.organization_id, opportunityCapacityMatchingPolicyVersion, evaluation.sourceFingerprint],
    );
    let match = existing.rows[0] as Row | undefined;
    if (!match) {
      await client.query("UPDATE opportunity_partner_match_snapshots SET current = false WHERE tenant_id = $1 AND opportunity_id = $2 AND requirement_profile_id = $3 AND partner_organization_id = $4 AND current = true", [input.tenantId, requirement.opportunity_id, requirement.id, partner.organization_id]);
      const inserted = await client.query(
        `
        INSERT INTO opportunity_partner_match_snapshots (
          tenant_id, opportunity_id, requirement_profile_id, partner_organization_id, capacity_provider_id, matching_policy_version,
          eligible, review_required, hard_blockers, fit_score, availability_score, capability_score, territory_score, readiness_score,
          performance_score, capacity_confidence_score, risk_score, performance_confidence, capacity_confidence, recommended_crew_count,
          ready_crew_count, potential_crew_count, unverified_crew_count, trend, risk_summary, reason_codes, source_fingerprint, calculated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
        RETURNING *
        `,
        [
          input.tenantId,
          requirement.opportunity_id,
          requirement.id,
          partner.organization_id,
          partner.capacity_provider_id,
          opportunityCapacityMatchingPolicyVersion,
          evaluation.eligible,
          evaluation.reviewRequired,
          JSON.stringify(evaluation.hardBlockers),
          evaluation.fitScore,
          evaluation.availabilityScore,
          evaluation.capabilityScore,
          evaluation.territoryScore,
          evaluation.readinessScore,
          evaluation.performanceScore,
          evaluation.capacityConfidenceScore,
          evaluation.riskScore,
          evaluation.performanceConfidence,
          evaluation.capacityConfidence,
          evaluation.recommendedCrewCount,
          evaluation.readyCrewCount,
          evaluation.potentialCrewCount,
          evaluation.unverifiedCrewCount,
          evaluation.trend,
          JSON.stringify(evaluation.riskSummary),
          evaluation.reasonCodes,
          evaluation.sourceFingerprint,
          asOf,
        ],
      );
      match = inserted.rows[0] as Row;
      createdPartnerMatches += 1;
    }
    insertedMatches.push(match);
    await upsertCrewMatches(client, requirement, match, evaluation, asOf);
  }

  const coverageResult = await createCoverageOptions(client, requirement, insertedMatches, asOf);
  return { requirement, partnerMatches: insertedMatches, coverageOptions: coverageResult.options, createdPartnerMatches, createdCoverageOptions: coverageResult.createdCount };
}

async function evaluatePartner(client: PoolClient, requirement: Requirement, partner: Row, asOf: Date) {
  const horizon = requiredHorizon(requirement, asOf);
  const capacity = await client.query(
    `
    SELECT *
    FROM partner_capacity_intelligence_snapshots
    WHERE tenant_id = $1
      AND partner_organization_id = $2
      AND current = true
      AND territory_id = $3
      AND capability = $4
      AND ($5::text IS NULL OR crew_type = $5)
      AND horizon = $6
    ORDER BY calculated_at DESC
    LIMIT 10
    `,
    [requirement.tenant_id, partner.organization_id, requirement.territory_id, requirement.capability, requirement.crew_type || null, horizon],
  );
  const allCapacity = await client.query(
    "SELECT * FROM partner_capacity_intelligence_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true",
    [requirement.tenant_id, partner.organization_id],
  );
  const performance = await client.query(
    "SELECT * FROM partner_performance_snapshots WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true LIMIT 1",
    [requirement.tenant_id, partner.organization_id],
  );
  const risks = await client.query(
    "SELECT risk_type,severity,status,reason_code FROM partner_risk_flags WHERE tenant_id = $1 AND partner_organization_id = $2 AND status = 'active'",
    [requirement.tenant_id, partner.organization_id],
  );
  const capacityRows = capacity.rows;
  const readyCrewCount = capacityRows.reduce((sum, row) => sum + Number(row.ready_crew_count ?? 0), 0);
  const potentialCrewCount = capacityRows.reduce((sum, row) => sum + Number(row.ready_crew_count ?? 0) + Number(row.conditional_crew_count ?? 0), 0);
  const unverifiedCrewCount = capacityRows.reduce((sum, row) => sum + Number(row.unverified_crew_count ?? 0), 0);
  const requiredCrewCount = Number(requirement.required_crew_count);
  const hasTerritory = allCapacity.rows.some((row) => String(row.territory_id) === String(requirement.territory_id));
  const hasCapability = allCapacity.rows.some((row) => String(row.capability) === String(requirement.capability));
  const activeCriticalRisk = risks.rows.some((row) => ["high", "critical"].includes(String(row.severity)));
  const requiredEquipment = normalizeStringArray(requirement.required_equipment_types);
  const hardBlockers: string[] = [];
  const reasonCodes: string[] = [];
  if (!["active", "qualified", "strategic"].includes(String(partner.organization_status))) hardBlockers.push("PARTNER_INELIGIBLE");
  if (!hasTerritory) hardBlockers.push("TERRITORY_NOT_SUPPORTED");
  if (!hasCapability) hardBlockers.push("CAPABILITY_MISSING");
  if (!readyCrewCount) hardBlockers.push("START_WINDOW_MISS");
  if (requiredEquipment.length > 0) hardBlockers.push("EQUIPMENT_MISSING");
  if (activeCriticalRisk) hardBlockers.push("CRITICAL_RISK_ACTIVE");
  if (readyCrewCount > 0) reasonCodes.push(horizon === "now_24h" ? "READY_NOW" : "READY_WITHIN_WINDOW");
  if (hasTerritory) reasonCodes.push("TERRITORY_EXACT");
  if (hasCapability) reasonCodes.push("CAPABILITY_EXACT");
  if (readyCrewCount < requiredCrewCount && readyCrewCount > 0) reasonCodes.push("CAPACITY_PARTIAL");
  if (unverifiedCrewCount > 0) reasonCodes.push("CAPACITY_CONFIDENCE_LOW");
  if (activeCriticalRisk) reasonCodes.push("CRITICAL_RISK_ACTIVE");
  const performanceRow = performance.rows[0] as Row | undefined;
  const performanceConfidence = String(performanceRow?.confidence ?? "insufficient_data");
  const capacityConfidence = confidenceFromCapacity(capacityRows);
  const availabilityScore = clamp((Math.min(readyCrewCount, requiredCrewCount) / requiredCrewCount) * 100);
  const capabilityScore = hasCapability ? 100 : 0;
  const territoryScore = hasTerritory ? 100 : 0;
  const readinessScore = readyCrewCount > 0 ? (readyCrewCount >= requiredCrewCount ? 100 : 75) : 0;
  const performanceScore = confidenceAdjustedPerformance(Number(performanceRow?.score ?? 0), performanceConfidence);
  const capacityConfidenceScore = confidenceScore(capacityConfidence);
  const riskScore = activeCriticalRisk ? 0 : risks.rows.length ? 70 : 100;
  const fitScore = roundScore(
    (availabilityScore * opportunityCapacityMatchWeights.availability +
      capabilityScore * opportunityCapacityMatchWeights.capability +
      territoryScore * opportunityCapacityMatchWeights.territory +
      readinessScore * opportunityCapacityMatchWeights.readiness +
      performanceScore * opportunityCapacityMatchWeights.performance +
      capacityConfidenceScore * opportunityCapacityMatchWeights.capacity_confidence +
      riskScore * opportunityCapacityMatchWeights.risk_reliability) /
      100,
  );
  const sourceFingerprint = fingerprint([
    opportunityCapacityMatchingPolicyVersion,
    asOfBucket(asOf),
    requirement.id,
    requirement.version,
    requirement.territory_id,
    requirement.capability,
    requirement.crew_type,
    requirement.required_crew_count,
    requirement.required_start_date,
    requirement.required_start_window,
    partner.organization_id,
    performanceRow?.id ?? "no-performance",
    performanceRow?.source_fingerprint ?? "no-performance-fingerprint",
    capacityRows.map((row) => `${row.id}:${row.source_fingerprint}`).sort().join(","),
    risks.rows.map((row) => `${row.risk_type}:${row.severity}:${row.reason_code}`).sort().join(","),
    hardBlockers.join(","),
  ]);
  return {
    horizon,
    eligible: hardBlockers.length === 0,
    reviewRequired: activeCriticalRisk,
    hardBlockers,
    fitScore,
    availabilityScore: roundScore(availabilityScore),
    capabilityScore,
    territoryScore,
    readinessScore,
    performanceScore,
    capacityConfidenceScore,
    riskScore,
    performanceConfidence,
    capacityConfidence,
    recommendedCrewCount: hardBlockers.length === 0 ? Math.min(requiredCrewCount, readyCrewCount) : 0,
    readyCrewCount,
    potentialCrewCount,
    unverifiedCrewCount,
    trend: String(performanceRow?.trend ?? "insufficient_data"),
    riskSummary: { active_risk_count: risks.rows.length, active_critical_risk: activeCriticalRisk, risk_types: risks.rows.map((row) => row.risk_type) },
    reasonCodes: reasonCodes.length ? reasonCodes : ["INSUFFICIENT_DATA"],
    sourceFingerprint,
  };
}

async function upsertCrewMatches(client: PoolClient, requirement: Requirement, partnerMatch: Row, evaluation: Awaited<ReturnType<typeof evaluatePartner>>, asOf: Date) {
  if (!evaluation.readyCrewCount && !evaluation.potentialCrewCount) return;
  await client.query("UPDATE opportunity_crew_match_snapshots SET current = false WHERE tenant_id = $1 AND partner_match_id = $2 AND current = true", [requirement.tenant_id, partnerMatch.id]);
  const crews = await client.query(
    `
    SELECT id, name, crew_type, status, lifecycle_status
    FROM crews
    WHERE tenant_id = $1
      AND organization_id = $2
      AND deleted_at IS NULL
      AND ($3::text IS NULL OR crew_type = $3)
    ORDER BY name
    LIMIT $4
    `,
    [requirement.tenant_id, partnerMatch.partner_organization_id, requirement.crew_type || null, Math.max(1, evaluation.readyCrewCount + evaluation.potentialCrewCount)],
  );
  let readyUsed = 0;
  for (const crew of crews.rows) {
    const active = crew.status === "active" && crew.lifecycle_status !== "suspended";
    const ready = active && readyUsed < evaluation.readyCrewCount;
    if (ready) readyUsed += 1;
    await client.query(
      `
      INSERT INTO opportunity_crew_match_snapshots (
        tenant_id, partner_match_id, opportunity_id, requirement_profile_id, partner_organization_id, crew_id, crew_type,
        territory_fit, capability_fit, readiness_status, availability_horizon, equipment_fit, performance_summary, risk_summary,
        eligible, fit_score, reason_codes, calculated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `,
      [
        requirement.tenant_id,
        partnerMatch.id,
        requirement.opportunity_id,
        requirement.id,
        partnerMatch.partner_organization_id,
        crew.id,
        crew.crew_type,
        evaluation.territoryScore > 0 ? "exact" : "not_supported",
        evaluation.capabilityScore > 0 ? "exact" : "missing",
        ready ? "ready" : active ? "conditional" : "not_ready",
        ready ? evaluation.horizon : "not_available",
        normalizeStringArray(requirement.required_equipment_types).length ? "missing" : "not_required",
        JSON.stringify({ partner_fit_score: partnerMatch.fit_score, performance_confidence: partnerMatch.performance_confidence }),
        JSON.stringify(partnerMatch.risk_summary ?? {}),
        ready && evaluation.eligible,
        ready ? partnerMatch.fit_score : 25,
        ready ? evaluation.reasonCodes : ["CREW_NOT_READY"],
        asOf,
      ],
    );
  }
}

async function createCoverageOptions(client: PoolClient, requirement: Requirement, partnerMatches: Row[], asOf: Date) {
  const eligible = partnerMatches
    .filter((row) => row.eligible === true && Number(row.recommended_crew_count ?? 0) > 0)
    .sort((a, b) => Number(b.fit_score ?? 0) - Number(a.fit_score ?? 0))
    .slice(0, 20);
  const required = Number(requirement.required_crew_count);
  const selected: Row[] = [];
  let covered = 0;
  for (const match of eligible) {
    if (covered >= required) break;
    selected.push(match);
    covered += Math.min(Number(match.recommended_crew_count ?? 0), required - covered);
  }
  const remaining = Math.max(0, required - covered);
  const minimumConfidence = minConfidence(selected.map((row) => String(row.capacity_confidence ?? "insufficient_data")));
  const status = coverageStatus(covered, required, minimumConfidence);
  const composition = selected.map((row) => ({
    partner_organization_id: row.partner_organization_id,
    match_snapshot_id: row.id,
    suggested_crew_count: Math.min(Number(row.recommended_crew_count ?? 0), Math.max(0, required - selected.slice(0, selected.indexOf(row)).reduce((sum, prior) => sum + Number(prior.recommended_crew_count ?? 0), 0))),
    fit_score: Number(row.fit_score ?? 0),
    capacity_confidence: row.capacity_confidence,
  }));
  const averageFit = selected.length ? roundScore(selected.reduce((sum, row) => sum + Number(row.fit_score ?? 0), 0) / selected.length) : 0;
  const criticalRiskCount = selected.reduce((sum, row) => sum + ((row.risk_summary as { active_critical_risk?: boolean })?.active_critical_risk ? 1 : 0), 0);
  const sourceFingerprint = fingerprint([opportunityCapacityMatchingPolicyVersion, asOfBucket(asOf), requirement.id, required, selected.map((row) => `${row.id}:${row.source_fingerprint}`).join(","), status, remaining]);
  const existing = await client.query(
    "SELECT * FROM opportunity_coverage_options WHERE tenant_id = $1 AND opportunity_id = $2 AND requirement_profile_id = $3 AND rank = 1 AND source_fingerprint = $4 LIMIT 1",
    [requirement.tenant_id, requirement.opportunity_id, requirement.id, sourceFingerprint],
  );
  if (existing.rows[0]) return { options: [existing.rows[0] as Row], createdCount: 0 };
  await client.query("UPDATE opportunity_coverage_options SET current = false WHERE tenant_id = $1 AND opportunity_id = $2 AND requirement_profile_id = $3 AND current = true", [requirement.tenant_id, requirement.opportunity_id, requirement.id]);
  const inserted = await client.query(
    `
    INSERT INTO opportunity_coverage_options (
      tenant_id, opportunity_id, requirement_profile_id, rank, coverage_status, covered_crew_count, required_crew_count,
      remaining_gap, average_fit_score, minimum_confidence, critical_risk_count, partner_count, composition, reason_summary,
      source_fingerprint, calculated_at
    )
    VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
    `,
    [
      requirement.tenant_id,
      requirement.opportunity_id,
      requirement.id,
      status,
      covered,
      required,
      remaining,
      averageFit,
      minimumConfidence,
      criticalRiskCount,
      selected.length,
      JSON.stringify(composition),
      JSON.stringify({ pursue_recommendation: pursueRecommendation(status, criticalRiskCount), recruiting_need: remaining > 0 ? { crew_count: remaining, capability: requirement.capability, territory_id: requirement.territory_id, needed_by: requirement.required_start_date } : null }),
      sourceFingerprint,
      asOf,
    ],
  );
  return { options: [inserted.rows[0] as Row], createdCount: 1 };
}

async function currentRequirementCandidates(client: PoolClient, tenantId: string | null, opportunityId: string | null, batchSize: number) {
  const result = await client.query(
    `
    SELECT rp.*
    FROM opportunity_requirement_profiles rp
    JOIN opportunities o ON o.tenant_id = rp.tenant_id AND o.id = rp.opportunity_id
    WHERE rp.current = true
      AND ($1::uuid IS NULL OR rp.tenant_id = $1::uuid)
      AND ($2::uuid IS NULL OR rp.opportunity_id = $2::uuid)
      AND o.deleted_at IS NULL
      AND o.status NOT IN ('awarded','lost','archived')
    ORDER BY rp.required_start_date ASC, rp.created_at ASC
    LIMIT $3
    `,
    [tenantId, opportunityId, batchSize],
  );
  return result.rows as Requirement[];
}

async function requireRequirement(client: PoolClient, tenantId: string, opportunityId: string, requirementProfileId: string | null) {
  const result = await client.query(
    `
    SELECT *
    FROM opportunity_requirement_profiles
    WHERE tenant_id = $1
      AND opportunity_id = $2
      AND ($3::uuid IS NULL OR id = $3::uuid)
      AND ($3::uuid IS NOT NULL OR current = true)
    ORDER BY version DESC
    LIMIT 1
    `,
    [tenantId, opportunityId, requirementProfileId],
  );
  if (!result.rows[0]) throw new Error("opportunity requirement profile is required before matching");
  return result.rows[0] as Requirement;
}

async function partnerCandidates(client: PoolClient, tenantId: string) {
  const result = await client.query(
    `
    SELECT DISTINCT o.id AS organization_id, o.name, o.status AS organization_status, cp.id AS capacity_provider_id, cp.status AS provider_status
    FROM organizations o
    LEFT JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.deleted_at IS NULL
    WHERE o.tenant_id = $1
      AND o.deleted_at IS NULL
      AND ('capacity_provider' = ANY(o.actor_roles) OR o.organization_type = 'subcontractor')
      AND (
        EXISTS (SELECT 1 FROM partner_capacity_intelligence_snapshots cis WHERE cis.tenant_id = o.tenant_id AND cis.partner_organization_id = o.id AND cis.current = true)
        OR EXISTS (SELECT 1 FROM partner_performance_snapshots ps WHERE ps.tenant_id = o.tenant_id AND ps.partner_organization_id = o.id AND ps.current = true)
      )
    ORDER BY o.name
    LIMIT 200
    `,
    [tenantId],
  );
  return result.rows;
}

function requiredHorizon(requirement: Requirement, asOf: Date) {
  const explicit = String(requirement.required_start_window);
  if (["now_24h", "72h", "1_week", "2_weeks", "30_days", "60_days"].includes(explicit)) return explicit;
  const start = new Date(`${dateOnly(requirement.required_start_date)}T00:00:00.000Z`);
  const days = Math.ceil((start.getTime() - asOf.getTime()) / 86_400_000);
  if (days <= 1) return "now_24h";
  if (days <= 3) return "72h";
  if (days <= 7) return "1_week";
  if (days <= 14) return "2_weeks";
  if (days <= 30) return "30_days";
  return "60_days";
}

function confidenceFromCapacity(rows: Row[]) {
  if (!rows.length) return "insufficient_data";
  if (rows.some((row) => row.capacity_confidence === "low")) return "low";
  if (rows.some((row) => row.capacity_confidence === "medium")) return "medium";
  return "high";
}

function confidenceScore(confidence: string) {
  if (confidence === "high") return 100;
  if (confidence === "medium") return 75;
  if (confidence === "low") return 40;
  return 20;
}

function confidenceAdjustedPerformance(score: number, confidence: string) {
  if (confidence === "high") return clamp(score);
  if (confidence === "medium") return clamp(score * 0.95);
  if (confidence === "low") return clamp(Math.min(score * 0.85, 75));
  return 40;
}

function minConfidence(values: string[]) {
  if (!values.length) return "insufficient_data";
  if (values.includes("low")) return "low";
  if (values.includes("insufficient_data")) return "insufficient_data";
  if (values.includes("medium")) return "medium";
  return "high";
}

function coverageStatus(covered: number, required: number, confidence: string) {
  if (covered <= 0) return "no_eligible_capacity";
  if (covered < required) return "capacity_gap";
  if (confidence === "low" || confidence === "insufficient_data") return "low_confidence_coverage";
  return "fully_covered";
}

function pursueRecommendation(status: string, criticalRiskCount: number) {
  if (criticalRiskCount > 0) return "pursue_with_risk_review";
  if (status === "fully_covered") return "pursue_full_capacity_identified";
  if (status === "capacity_gap" || status === "partially_covered") return "pursue_partial_capacity_recruiting_required";
  if (status === "low_confidence_coverage") return "pursue_with_risk_review";
  return "defer_capacity_gap";
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizeAsOf(value: string | Date | undefined) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.trim()) return new Date(value);
  return new Date();
}

function dateOnly(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asOfBucket(value: Date) {
  return value.toISOString().slice(0, 10);
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function roundScore(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function fingerprint(parts: unknown[]) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part)).join("|")).digest("base64url");
}
