import crypto from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

type Row = QueryResultRow & Record<string, unknown>;

type ExecutiveActionInput = {
  actionType: string;
  severity: "critical" | "high" | "medium" | "low";
  domain: "growth" | "operations" | "partner" | "customer" | "finance" | "safety_compliance" | "capacity" | "unknown";
  ownerAttribution: "sync" | "partner" | "customer" | "capacity" | "compliance" | "finance" | "unknown";
  sourceObjectType: string;
  sourceObjectId: string | null;
  title: string;
  reasonCode: string;
  reasonSummary: string;
  recommendedNextStep: string;
  route: string;
  ageDays?: number | null;
  dueAt?: string | Date | null;
  impactAmount?: number | null;
};

type BlockerInput = Omit<ExecutiveActionInput, "actionType" | "title" | "recommendedNextStep" | "route"> & {
  blockerType: string;
};

export const executiveCommandPolicyVersion = "executive_command_v1";
export const executiveActionPriorityPolicyVersion = "executive_action_priority_v1";

export const executiveActionPriorityPolicy = {
  criticalSafetyBase: 98,
  paymentOverdueBase: 92,
  imminentCapacityGapBase: 90,
  missingCustomerRateBase: 86,
  customerQcAgingBase: 78,
  partnerCorrectionOverdueBase: 80,
  unappliedCashBase: 68,
  readyToInvoiceBase: 66,
  lowDocumentationBase: 45,
} as const;

export type ExecutiveCommandRefreshScanResult = {
  scannedAt: string;
  scannedTenants: number;
  createdSnapshots: number;
  locked: boolean;
};

export async function runExecutiveCommandRefreshScan(
  client: PoolClient,
  options: { asOf?: string | Date; batchSize?: number; actorUserId?: string | null; tenantId?: string | null } = {},
): Promise<ExecutiveCommandRefreshScanResult> {
  const asOf = normalizeAsOf(options.asOf);
  const batchSize = Math.max(1, Math.min(Number(options.batchSize ?? 25), 100));
  const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('syncos.p16.executive_command_refresh_scan')) AS locked");
  if (!lock.rows[0]?.locked) return { scannedAt: asOf.toISOString(), scannedTenants: 0, createdSnapshots: 0, locked: false };
  let scannedTenants = 0;
  let createdSnapshots = 0;
  try {
    const tenants = await client.query<Row>(
      `
      SELECT id
      FROM tenants
      WHERE deleted_at IS NULL
        AND status = 'active'
        AND ($1::uuid IS NULL OR id = $1::uuid)
      ORDER BY created_at, id
      LIMIT $2
      `,
      [options.tenantId ?? null, batchSize],
    );
    for (const tenant of tenants.rows) {
      const result = await recalculateExecutiveCommandSnapshot(client, {
        tenantId: String(tenant.id),
        actorUserId: options.actorUserId ?? null,
        asOf,
      });
      scannedTenants += 1;
      if (result.created) createdSnapshots += 1;
    }
    return { scannedAt: asOf.toISOString(), scannedTenants, createdSnapshots, locked: true };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('syncos.p16.executive_command_refresh_scan'))");
  }
}

export async function recalculateExecutiveCommandSnapshot(
  client: PoolClient,
  input: { tenantId: string; asOf?: string | Date; actorUserId?: string | null },
): Promise<{ snapshot: Row; actions: Row[]; blockers: Row[]; created: boolean }> {
  const asOf = normalizeAsOf(input.asOf);
  const metrics = await collectMetrics(client, input.tenantId, asOf);
  const blockers = await collectBlockers(client, input.tenantId, asOf);
  const actions = rankAndDedupeActions(await collectActions(client, input.tenantId, asOf, blockers));
  const dailyBrief = dailyBriefFor(metrics, actions, blockers);
  const fingerprint = hash([
    executiveCommandPolicyVersion,
    executiveActionPriorityPolicyVersion,
    asOfBucket(asOf),
    JSON.stringify(metrics),
    JSON.stringify(actions),
    JSON.stringify(blockers),
  ]);
  const existing = await client.query(
    "SELECT * FROM executive_command_snapshots WHERE tenant_id = $1 AND policy_version = $2 AND source_fingerprint = $3 LIMIT 1",
    [input.tenantId, executiveCommandPolicyVersion, fingerprint],
  );
  if (existing.rows[0]) {
    const rows = await readSnapshotChildren(client, input.tenantId, String(existing.rows[0].id));
    return { snapshot: existing.rows[0] as Row, actions: rows.actions, blockers: rows.blockers, created: false };
  }

  await client.query("UPDATE executive_command_snapshots SET current = false WHERE tenant_id = $1 AND snapshot_date = $2 AND policy_version = $3 AND current = true", [input.tenantId, dateOnly(asOf), executiveCommandPolicyVersion]);
  await client.query("UPDATE executive_actions SET current = false, status = CASE WHEN status = 'open' THEN 'resolved_by_source_change' ELSE status END, updated_at = now() WHERE tenant_id = $1 AND current = true", [input.tenantId]);

  const inserted = await client.query<Row>(
    `
    INSERT INTO executive_command_snapshots (
      tenant_id, snapshot_date, as_of, policy_version, qualified_opportunity_count, qualified_opportunity_value,
      coverage_ready_count, capacity_gap_count, ready_crew_count, active_work_order_count, reported_production_summary,
      accepted_production_summary, pending_qc_count, customer_qc_aging_count, accepted_not_billed_amount,
      outstanding_ar_amount, cleared_cash_amount, unapplied_cash_amount, partner_eligible_payable_amount,
      partner_awaiting_funds_amount, partner_payment_due_amount, critical_risk_count, high_blocker_count,
      days_to_cash, billing_velocity, daily_brief, freshness, source_fingerprint, calculated_at, created_by_user_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
    RETURNING *
    `,
    [
      input.tenantId,
      dateOnly(asOf),
      asOf,
      executiveCommandPolicyVersion,
      metrics.qualifiedOpportunityCount,
      metrics.qualifiedOpportunityValue,
      metrics.coverageReadyCount,
      metrics.capacityGapCount,
      metrics.readyCrewCount,
      metrics.activeWorkOrderCount,
      JSON.stringify(metrics.reportedProductionSummary),
      JSON.stringify(metrics.acceptedProductionSummary),
      metrics.pendingQcCount,
      metrics.customerQcAgingCount,
      metrics.acceptedNotBilledAmount,
      metrics.outstandingArAmount,
      metrics.clearedCashAmount,
      metrics.unappliedCashAmount,
      metrics.partnerEligiblePayableAmount,
      metrics.partnerAwaitingFundsAmount,
      metrics.partnerPaymentDueAmount,
      metrics.criticalRiskCount,
      blockers.filter((blocker) => ["critical", "high"].includes(blocker.severity)).length,
      JSON.stringify(metrics.daysToCash),
      JSON.stringify(metrics.billingVelocity),
      JSON.stringify(dailyBrief),
      JSON.stringify(metrics.freshness),
      fingerprint,
      asOf,
      input.actorUserId ?? null,
    ],
  );
  const snapshot = inserted.rows[0] as Row;
  for (const blocker of blockers) await insertBlocker(client, input.tenantId, String(snapshot.id), blocker);
  for (const action of actions) await insertAction(client, input.tenantId, String(snapshot.id), action, asOf);
  const rows = await readSnapshotChildren(client, input.tenantId, String(snapshot.id));
  return { snapshot, actions: rows.actions, blockers: rows.blockers, created: true };
}

async function collectMetrics(client: PoolClient, tenantId: string, asOf: Date) {
  const opportunity = await client.query<Row>(
    `
    SELECT
      count(*) FILTER (WHERE status IN ('qualified','pursuit_approved','pursuing','bid_proposal','negotiation'))::int AS qualified_count,
      coalesce(sum(estimated_value) FILTER (WHERE estimated_value IS NOT NULL AND status IN ('qualified','pursuit_approved','pursuing','bid_proposal','negotiation')), 0)::numeric AS qualified_value,
      coalesce(sum(estimated_value) FILTER (WHERE status = 'awarded' AND estimated_value IS NOT NULL), 0)::numeric AS awarded_value
    FROM opportunities
    WHERE tenant_id = $1 AND deleted_at IS NULL
    `,
    [tenantId],
  );
  const coverage = await client.query<Row>(
    `
    SELECT
      count(*) FILTER (WHERE co.coverage_status = 'fully_covered')::int AS ready_count,
      count(*) FILTER (WHERE co.remaining_gap > 0 OR co.coverage_status IN ('capacity_gap','no_eligible_capacity'))::int AS gap_count,
      count(*) FILTER (WHERE co.coverage_status = 'low_confidence_coverage')::int AS low_confidence_count
    FROM opportunity_coverage_options co
    JOIN opportunity_requirement_profiles rp ON rp.tenant_id = co.tenant_id AND rp.id = co.requirement_profile_id AND rp.current = true
    JOIN opportunities o ON o.tenant_id = co.tenant_id AND o.id = co.opportunity_id
    WHERE co.tenant_id = $1 AND co.current = true AND o.deleted_at IS NULL AND o.status NOT IN ('lost','deferred','archived')
    `,
    [tenantId],
  );
  const capacity = await client.query<Row>(
    `
    SELECT
      coalesce(sum(ready_crew_count) FILTER (WHERE horizon = 'now_24h'), 0)::int AS ready_now,
      coalesce(sum(ready_crew_count) FILTER (WHERE horizon = '72h'), 0)::int AS ready_72h,
      coalesce(sum(ready_crew_count) FILTER (WHERE horizon = '1_week'), 0)::int AS ready_1_week,
      coalesce(sum(ready_crew_count) FILTER (WHERE horizon = '30_days'), 0)::int AS ready_30_days,
      coalesce(sum(committed_crew_count), 0)::int AS committed,
      coalesce(sum(unverified_crew_count), 0)::int AS low_confidence_claimed
    FROM partner_capacity_intelligence_snapshots
    WHERE tenant_id = $1 AND current = true
    `,
    [tenantId],
  );
  const workOrders = await client.query<Row>("SELECT count(*)::int AS count FROM work_orders WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('assigned','scheduled','authorized','in_progress','submitted','qc_review','corrections_required','approved','billable','on_hold')", [tenantId]);
  const reports = await client.query<Row>("SELECT count(*) FILTER (WHERE status = 'submitted')::int AS submitted_today FROM daily_production_reports WHERE tenant_id = $1 AND deleted_at IS NULL AND work_date = $2", [tenantId, dateOnly(asOf)]);
  const jsas = await client.query<Row>("SELECT count(*)::int AS count, count(*) FILTER (WHERE status = 'completed' AND foreman_certified = true)::int AS completed FROM daily_jsas WHERE tenant_id = $1 AND deleted_at IS NULL AND work_date = $2", [tenantId, dateOnly(asOf)]);
  const reportedProduction = await client.query<Row>(
    `
    SELECT coalesce(spc.code, pr.unit, pr.unit_type, 'unknown') AS code, coalesce(pr.unit, pr.unit_type, spc.unit_of_measure, 'unknown') AS unit, coalesce(sum(pr.quantity_submitted), 0)::numeric AS quantity, count(*)::int AS record_count
    FROM production_records pr
    LEFT JOIN syncfield_production_codes spc ON spc.tenant_id = pr.tenant_id AND spc.id = pr.syncfield_production_code_id
    WHERE pr.tenant_id = $1 AND pr.deleted_at IS NULL AND pr.production_date = $2 AND pr.status IN ('submitted','qc_review','accepted','approved','billable','correction_required','rejected')
    GROUP BY coalesce(spc.code, pr.unit, pr.unit_type, 'unknown'), coalesce(pr.unit, pr.unit_type, spc.unit_of_measure, 'unknown')
    ORDER BY unit, code
    `,
    [tenantId, dateOnly(asOf)],
  );
  const acceptedProduction = await client.query<Row>(
    `
    SELECT coalesce(spc.code, cqd.unit_of_measure, pr.unit, 'unknown') AS code, coalesce(cqd.unit_of_measure, pr.unit, pr.unit_type, 'unknown') AS unit, coalesce(sum(cqd.customer_accepted_quantity), 0)::numeric AS quantity, count(*)::int AS record_count
    FROM customer_qc_decisions cqd
    JOIN production_records pr ON pr.tenant_id = cqd.tenant_id AND pr.id = cqd.production_record_id
    LEFT JOIN syncfield_production_codes spc ON spc.tenant_id = pr.tenant_id AND spc.id = pr.syncfield_production_code_id
    WHERE cqd.tenant_id = $1 AND cqd.deleted_at IS NULL AND cqd.current = true AND cqd.decision IN ('accepted','partially_accepted') AND cqd.recorded_at::date = $2
    GROUP BY coalesce(spc.code, cqd.unit_of_measure, pr.unit, 'unknown'), coalesce(cqd.unit_of_measure, pr.unit, pr.unit_type, 'unknown')
    ORDER BY unit, code
    `,
    [tenantId, dateOnly(asOf)],
  );
  const qc = await client.query<Row>(
    `
    SELECT
      count(*) FILTER (WHERE status = 'awaiting_customer')::int AS pending,
      count(*) FILTER (WHERE status = 'awaiting_customer' AND submitted_to_customer_at < $2::timestamptz - interval '3 days')::int AS aging,
      count(*) FILTER (WHERE status = 'awaiting_partner_correction')::int AS partner_correction,
      count(*) FILTER (WHERE status = 'awaiting_reinspection')::int AS reinspection
    FROM customer_qc_cycles
    WHERE tenant_id = $1 AND deleted_at IS NULL
    `,
    [tenantId, asOf],
  );
  const finance = await client.query<Row>(
    `
    SELECT
      (SELECT coalesce(sum(customer_extended_amount), 0)::numeric FROM accepted_production_financial_sources WHERE tenant_id = $1 AND deleted_at IS NULL AND financial_status = 'exception') AS accepted_not_billed,
      (SELECT coalesce(sum(balance_amount), 0)::numeric FROM invoices WHERE tenant_id = $1 AND deleted_at IS NULL AND status NOT IN ('voided','archived') AND payment_status <> 'paid') AS outstanding_ar,
      (SELECT coalesce(sum(gross_received_amount), 0)::numeric FROM cash_receipts WHERE tenant_id = $1 AND deleted_at IS NULL AND clearance_status = 'cleared') AS cleared_cash,
      (SELECT coalesce(sum(unapplied_amount), 0)::numeric FROM cash_receipts WHERE tenant_id = $1 AND deleted_at IS NULL AND clearance_status = 'cleared' AND receipt_status IN ('unapplied','partially_applied')) AS unapplied_cash,
      (SELECT coalesce(sum(eligible_amount), 0)::numeric FROM contractor_payables WHERE tenant_id = $1 AND deleted_at IS NULL AND pay_when_paid_status IN ('eligible','partially_eligible')) AS partner_eligible,
      (SELECT coalesce(sum(ineligible_amount), 0)::numeric FROM contractor_payables WHERE tenant_id = $1 AND deleted_at IS NULL AND pay_when_paid_status IN ('awaiting_customer_funds','partially_eligible','eligible')) AS partner_awaiting,
      (SELECT coalesce(sum(eligible_amount - paid_amount - in_flight_payment_amount), 0)::numeric FROM contractor_payables WHERE tenant_id = $1 AND deleted_at IS NULL AND payment_due_at <= $2::date AND pay_when_paid_status IN ('eligible','partially_eligible') AND payment_execution_status NOT IN ('paid')) AS partner_due
    `,
    [tenantId, dateOnly(asOf)],
  );
  const risks = await client.query<Row>("SELECT count(*)::int AS count FROM partner_risk_flags WHERE tenant_id = $1 AND status = 'active' AND severity IN ('high','critical')", [tenantId]);
  const daysToCash = await client.query<Row>(
    `
    SELECT
      avg(extract(epoch FROM (cr.cleared_at - cqd.recorded_at)) / 86400.0)::numeric(10,2) AS accepted_to_cleared_cash_days,
      avg(extract(epoch FROM (i.sent_at - cqd.recorded_at)) / 86400.0)::numeric(10,2) AS accepted_to_invoice_days,
      avg(extract(epoch FROM (cr.cleared_at - coalesce(i.sent_at, i.invoice_date::timestamptz))) / 86400.0)::numeric(10,2) AS invoice_to_cleared_cash_days
    FROM payment_application_allocations paa
    JOIN payment_applications pa ON pa.tenant_id = paa.tenant_id AND pa.id = paa.payment_application_id AND pa.deleted_at IS NULL AND pa.application_status IN ('applied','partially_applied')
    JOIN cash_receipts cr ON cr.tenant_id = pa.tenant_id AND cr.id = pa.cash_receipt_id AND cr.deleted_at IS NULL AND cr.clearance_status = 'cleared' AND cr.cleared_at IS NOT NULL
    JOIN invoice_items ii ON ii.tenant_id = paa.tenant_id AND ii.id = paa.invoice_item_id AND ii.deleted_at IS NULL
    JOIN invoices i ON i.tenant_id = ii.tenant_id AND i.id = ii.invoice_id AND i.deleted_at IS NULL
    JOIN accepted_production_financial_sources aps ON aps.tenant_id = paa.tenant_id AND aps.id = paa.accepted_production_source_id AND aps.deleted_at IS NULL
    JOIN customer_qc_decisions cqd ON cqd.tenant_id = aps.tenant_id AND cqd.id = aps.customer_qc_decision_id
    WHERE paa.tenant_id = $1 AND paa.deleted_at IS NULL
    `,
    [tenantId],
  );
  return {
    qualifiedOpportunityCount: Number(opportunity.rows[0]?.qualified_count ?? 0),
    qualifiedOpportunityValue: numberOrNull(opportunity.rows[0]?.qualified_value),
    awardedValue: numberOrNull(opportunity.rows[0]?.awarded_value),
    coverageReadyCount: Number(coverage.rows[0]?.ready_count ?? 0),
    capacityGapCount: Number(coverage.rows[0]?.gap_count ?? 0),
    lowConfidenceCoverageCount: Number(coverage.rows[0]?.low_confidence_count ?? 0),
    readyCrewCount: Number(capacity.rows[0]?.ready_now ?? 0),
    ready72hCrewCount: Number(capacity.rows[0]?.ready_72h ?? 0),
    ready1WeekCrewCount: Number(capacity.rows[0]?.ready_1_week ?? 0),
    ready30DayCrewCount: Number(capacity.rows[0]?.ready_30_days ?? 0),
    committedCrewCount: Number(capacity.rows[0]?.committed ?? 0),
    lowConfidenceClaimedCapacity: Number(capacity.rows[0]?.low_confidence_claimed ?? 0),
    activeWorkOrderCount: Number(workOrders.rows[0]?.count ?? 0),
    reportsSubmittedToday: Number(reports.rows[0]?.submitted_today ?? 0),
    jsaCompletion: { completed: Number(jsas.rows[0]?.completed ?? 0), expected: Number(jsas.rows[0]?.count ?? 0) },
    reportedProductionSummary: productionRows(reportedProduction.rows),
    acceptedProductionSummary: productionRows(acceptedProduction.rows),
    pendingQcCount: Number(qc.rows[0]?.pending ?? 0),
    customerQcAgingCount: Number(qc.rows[0]?.aging ?? 0),
    partnerCorrectionCount: Number(qc.rows[0]?.partner_correction ?? 0),
    reinspectionCount: Number(qc.rows[0]?.reinspection ?? 0),
    acceptedNotBilledAmount: numberOrNull(finance.rows[0]?.accepted_not_billed),
    outstandingArAmount: numberOrNull(finance.rows[0]?.outstanding_ar),
    clearedCashAmount: numberOrNull(finance.rows[0]?.cleared_cash),
    unappliedCashAmount: numberOrNull(finance.rows[0]?.unapplied_cash),
    partnerEligiblePayableAmount: numberOrNull(finance.rows[0]?.partner_eligible),
    partnerAwaitingFundsAmount: numberOrNull(finance.rows[0]?.partner_awaiting),
    partnerPaymentDueAmount: numberOrNull(finance.rows[0]?.partner_due),
    criticalRiskCount: Number(risks.rows[0]?.count ?? 0),
    daysToCash: {
      definition: "customer_acceptance_to_cleared_cash_application",
      accepted_to_cleared_cash_days: nullableNumber(daysToCash.rows[0]?.accepted_to_cleared_cash_days),
      accepted_to_invoice_days: nullableNumber(daysToCash.rows[0]?.accepted_to_invoice_days),
      invoice_to_cleared_cash_days: nullableNumber(daysToCash.rows[0]?.invoice_to_cleared_cash_days),
      unpaid_items_excluded: true,
    },
    billingVelocity: { accepted_to_invoice_separate: true, invoice_to_cash_separate: true, cash_to_partner_eligibility_separate: true },
    freshness: { as_of: asOf.toISOString(), stale_threshold_minutes: 120 },
  };
}

async function collectBlockers(client: PoolClient, tenantId: string, asOf: Date): Promise<BlockerInput[]> {
  const blockers: BlockerInput[] = [];
  const coverage = await client.query<Row>(
    `
    SELECT co.id, co.opportunity_id, o.title, rp.required_start_date, rp.capability, rp.required_crew_count, co.covered_crew_count, co.remaining_gap, co.coverage_status
    FROM opportunity_coverage_options co
    JOIN opportunity_requirement_profiles rp ON rp.tenant_id = co.tenant_id AND rp.id = co.requirement_profile_id AND rp.current = true
    JOIN opportunities o ON o.tenant_id = co.tenant_id AND o.id = co.opportunity_id
    WHERE co.tenant_id = $1 AND co.current = true AND o.deleted_at IS NULL AND o.status NOT IN ('lost','deferred','archived')
      AND (co.remaining_gap > 0 OR co.coverage_status IN ('capacity_gap','no_eligible_capacity','low_confidence_coverage'))
    ORDER BY rp.required_start_date ASC
    LIMIT 50
    `,
    [tenantId],
  );
  for (const row of coverage.rows) {
    const gap = Number(row.remaining_gap ?? 0);
    const daysUntilStart = daysBetween(asOf, row.required_start_date);
    blockers.push({
      blockerType: "capacity_gap",
      severity: gap >= Number(row.required_crew_count ?? 0) || daysUntilStart <= 3 ? "high" : "medium",
      domain: "capacity",
      ownerAttribution: "capacity",
      sourceObjectType: "opportunity",
      sourceObjectId: String(row.opportunity_id),
      reasonCode: "CAPACITY_GAP",
      reasonSummary: `Opportunity requires ${row.required_crew_count} ${row.capability} Crews; ${row.covered_crew_count} verified Crews are available and gap is ${gap}.`,
      ageDays: null,
      impactAmount: null,
    });
  }
  const risks = await client.query<Row>(
    `
    SELECT rf.id, rf.partner_organization_id, o.name, rf.risk_type, rf.severity, rf.detected_at
    FROM partner_risk_flags rf
    JOIN organizations o ON o.tenant_id = rf.tenant_id AND o.id = rf.partner_organization_id
    WHERE rf.tenant_id = $1 AND rf.status = 'active' AND rf.severity IN ('high','critical')
    ORDER BY rf.detected_at
    LIMIT 50
    `,
    [tenantId],
  );
  for (const row of risks.rows) {
    blockers.push({
      blockerType: "critical_partner_risk",
      severity: String(row.severity) === "critical" ? "critical" : "high",
      domain: "safety_compliance",
      ownerAttribution: "compliance",
      sourceObjectType: "partner_risk_flag",
      sourceObjectId: String(row.id),
      reasonCode: "CRITICAL_PARTNER_RISK",
      reasonSummary: `${row.name} has active ${String(row.risk_type).replace(/_/g, " ")} risk.`,
      ageDays: daysBetween(row.detected_at, asOf),
      impactAmount: null,
    });
  }
  const qc = await client.query<Row>(
    `
    SELECT id, work_order_id, project_id, submitted_to_customer_at
    FROM customer_qc_cycles
    WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'awaiting_customer' AND submitted_to_customer_at < $2::timestamptz - interval '3 days'
    ORDER BY submitted_to_customer_at
    LIMIT 50
    `,
    [tenantId, asOf],
  );
  for (const row of qc.rows) {
    blockers.push({
      blockerType: "customer_qc_aging",
      severity: daysBetween(row.submitted_to_customer_at, asOf) >= 8 ? "high" : "medium",
      domain: "customer",
      ownerAttribution: "customer",
      sourceObjectType: "customer_qc_cycle",
      sourceObjectId: String(row.id),
      reasonCode: "CUSTOMER_QC_AGING",
      reasonSummary: `Customer QC has awaited decision for ${daysBetween(row.submitted_to_customer_at, asOf)} days.`,
      ageDays: daysBetween(row.submitted_to_customer_at, asOf),
      impactAmount: null,
    });
  }
  const corrections = await client.query<Row>(
    `
    SELECT pc.id, pc.due_date, pc.partner_organization_id, dpr.work_order_id
    FROM production_corrections pc
    JOIN daily_production_reports dpr ON dpr.tenant_id = pc.tenant_id AND dpr.id = pc.daily_report_id
    WHERE pc.tenant_id = $1 AND pc.deleted_at IS NULL AND pc.status IN ('open','acknowledged','in_progress') AND pc.due_date < $2::date
    ORDER BY pc.due_date
    LIMIT 50
    `,
    [tenantId, dateOnly(asOf)],
  );
  for (const row of corrections.rows) {
    blockers.push({
      blockerType: "partner_correction_overdue",
      severity: daysBetween(row.due_date, asOf) >= 3 ? "high" : "medium",
      domain: "operations",
      ownerAttribution: "partner",
      sourceObjectType: "production_correction",
      sourceObjectId: String(row.id),
      reasonCode: "PARTNER_CORRECTION_OVERDUE",
      reasonSummary: `Partner correction is ${daysBetween(row.due_date, asOf)} days past due.`,
      ageDays: daysBetween(row.due_date, asOf),
      impactAmount: null,
    });
  }
  const financial = await client.query<Row>(
    `
    SELECT fe.id, fe.exception_type, fe.severity, coalesce(fe.work_order_id, aps.work_order_id) AS work_order_id,
      fe.created_at, fe.customer_qc_decision_id, aps.customer_extended_amount
    FROM financial_exceptions fe
    LEFT JOIN accepted_production_financial_sources aps ON aps.tenant_id = fe.tenant_id AND aps.customer_qc_decision_id = fe.customer_qc_decision_id
    WHERE fe.tenant_id = $1 AND fe.deleted_at IS NULL AND fe.status = 'open' AND fe.exception_type = 'missing_customer_rate'
    ORDER BY fe.created_at
    LIMIT 50
    `,
    [tenantId],
  );
  for (const row of financial.rows) {
    blockers.push({
      blockerType: "missing_customer_rate",
      severity: "high",
      domain: "finance",
      ownerAttribution: "finance",
      sourceObjectType: "financial_exception",
      sourceObjectId: String(row.id),
      reasonCode: "MISSING_CUSTOMER_RATE",
      reasonSummary: "Accepted production cannot move to billing because the Customer rate is missing.",
      ageDays: daysBetween(row.created_at, asOf),
      impactAmount: nullableNumber(row.customer_extended_amount),
    });
  }
  const payments = await client.query<Row>(
    `
    SELECT id, partner_organization_id, payment_due_at, eligible_amount, paid_amount, in_flight_payment_amount
    FROM contractor_payables
    WHERE tenant_id = $1 AND deleted_at IS NULL AND payment_due_at < $2::date
      AND pay_when_paid_status IN ('eligible','partially_eligible')
      AND payment_execution_status NOT IN ('paid')
      AND eligible_amount - paid_amount - in_flight_payment_amount > 0
    ORDER BY payment_due_at
    LIMIT 50
    `,
    [tenantId, dateOnly(asOf)],
  );
  for (const row of payments.rows) {
    blockers.push({
      blockerType: "partner_payment_overdue",
      severity: "critical",
      domain: "finance",
      ownerAttribution: "finance",
      sourceObjectType: "contractor_payable",
      sourceObjectId: String(row.id),
      reasonCode: "PARTNER_PAYMENT_OVERDUE",
      reasonSummary: `Partner payable is ${daysBetween(row.payment_due_at, asOf)} days past due after becoming eligible.`,
      ageDays: daysBetween(row.payment_due_at, asOf),
      impactAmount: Math.max(0, Number(row.eligible_amount ?? 0) - Number(row.paid_amount ?? 0) - Number(row.in_flight_payment_amount ?? 0)),
    });
  }
  return blockers;
}

async function collectActions(client: PoolClient, tenantId: string, asOf: Date, blockers: BlockerInput[]): Promise<ExecutiveActionInput[]> {
  const actions: ExecutiveActionInput[] = blockers.map((blocker) => actionFromBlocker(blocker, asOf));
  const readyToInvoice = await client.query<Row>(
    `
    SELECT work_order_id, coalesce(sum(customer_extended_amount), 0)::numeric AS amount, count(*)::int AS count
    FROM accepted_production_financial_sources
    WHERE tenant_id = $1 AND deleted_at IS NULL AND financial_status IN ('eligible','billable_created') AND customer_extended_amount IS NOT NULL
    GROUP BY work_order_id
    ORDER BY amount DESC
    LIMIT 25
    `,
    [tenantId],
  );
  for (const row of readyToInvoice.rows) {
    actions.push({
      actionType: "ready_to_invoice",
      severity: "medium",
      domain: "finance",
      ownerAttribution: "finance",
      sourceObjectType: "work_order",
      sourceObjectId: String(row.work_order_id),
      title: "Submit accepted production for billing",
      reasonCode: "READY_TO_INVOICE",
      reasonSummary: `${row.count} accepted production sources are ready to invoice.`,
      recommendedNextStep: "Open accepted-production financials and create the Customer invoice package.",
      route: "/accepted-production-financials",
      impactAmount: nullableNumber(row.amount),
    });
  }
  const unapplied = await client.query<Row>(
    "SELECT id, unapplied_amount, received_at FROM cash_receipts WHERE tenant_id = $1 AND deleted_at IS NULL AND clearance_status = 'cleared' AND unapplied_amount > 0 ORDER BY unapplied_amount DESC LIMIT 25",
    [tenantId],
  );
  for (const row of unapplied.rows) {
    actions.push({
      actionType: "apply_unapplied_cash",
      severity: "medium",
      domain: "finance",
      ownerAttribution: "finance",
      sourceObjectType: "cash_receipt",
      sourceObjectId: String(row.id),
      title: "Apply cleared Customer cash",
      reasonCode: "UNAPPLIED_CASH",
      reasonSummary: `Cleared cash has ${currency(row.unapplied_amount)} unapplied.`,
      recommendedNextStep: "Open cash application and apply the receipt to the correct Customer invoice.",
      route: "/accepted-production-financials",
      ageDays: daysBetween(row.received_at, asOf),
      impactAmount: nullableNumber(row.unapplied_amount),
    });
  }
  return actions;
}

function actionFromBlocker(blocker: BlockerInput, asOf: Date): ExecutiveActionInput {
  if (blocker.blockerType === "capacity_gap") {
    return {
      actionType: "cover_capacity_gap",
      ...blocker,
      title: "Source additional verified capacity",
      recommendedNextStep: "Open Opportunity capacity matching and identify additional qualified Partner or Crew coverage.",
      route: `/opportunities/capacity-matching?opportunityId=${blocker.sourceObjectId}`,
      dueAt: addDays(asOf, 1),
    };
  }
  if (blocker.blockerType === "critical_partner_risk") {
    return {
      actionType: "review_critical_partner_risk",
      ...blocker,
      title: "Review critical Partner risk before additional assignment",
      recommendedNextStep: "Open Partner Performance and resolve or govern the active risk before additional assignment.",
      route: "/partner-performance",
    };
  }
  if (blocker.blockerType === "customer_qc_aging") {
    return {
      actionType: "follow_up_customer_qc",
      ...blocker,
      title: "Follow up with Customer QC",
      recommendedNextStep: "Open Customer QC and request decision status from the Customer authority.",
      route: "/partner/customer-qc",
    };
  }
  if (blocker.blockerType === "partner_correction_overdue") {
    return {
      actionType: "resolve_partner_correction",
      ...blocker,
      title: "Resolve overdue Partner correction",
      recommendedNextStep: "Open Customer QC corrections and drive the Partner correction through resubmission.",
      route: "/partner/customer-qc",
    };
  }
  if (blocker.blockerType === "partner_payment_overdue") {
    return {
      actionType: "review_partner_payment_due",
      ...blocker,
      title: "Review Partner payment due",
      recommendedNextStep: "Open payment controls and decide whether to create or submit a payment instruction.",
      route: "/payment-retainage-adjustments",
    };
  }
  return {
    actionType: blocker.blockerType,
    ...blocker,
    title: "Review executive blocker",
    recommendedNextStep: "Open the source workflow and clear the underlying canonical issue.",
    route: "/command-center",
  };
}

function rankAndDedupeActions(actions: ExecutiveActionInput[]) {
  const byRoot = new Map<string, ExecutiveActionInput>();
  for (const action of actions) {
    const key = `${action.reasonCode}:${action.sourceObjectType}:${action.sourceObjectId ?? "tenant"}`;
    const existing = byRoot.get(key);
    if (!existing || priorityScore(action) > priorityScore(existing)) byRoot.set(key, action);
  }
  return [...byRoot.values()].sort((a, b) => priorityScore(b) - priorityScore(a) || a.reasonCode.localeCompare(b.reasonCode)).slice(0, 100);
}

function priorityScore(action: ExecutiveActionInput): number {
  const base = {
    CRITICAL_PARTNER_RISK: executiveActionPriorityPolicy.criticalSafetyBase,
    PARTNER_PAYMENT_OVERDUE: executiveActionPriorityPolicy.paymentOverdueBase,
    CAPACITY_GAP: executiveActionPriorityPolicy.imminentCapacityGapBase,
    MISSING_CUSTOMER_RATE: executiveActionPriorityPolicy.missingCustomerRateBase,
    CUSTOMER_QC_AGING: executiveActionPriorityPolicy.customerQcAgingBase,
    PARTNER_CORRECTION_OVERDUE: executiveActionPriorityPolicy.partnerCorrectionOverdueBase,
    UNAPPLIED_CASH: executiveActionPriorityPolicy.unappliedCashBase,
    READY_TO_INVOICE: executiveActionPriorityPolicy.readyToInvoiceBase,
  }[action.reasonCode] ?? 40;
  const age = Math.min(Number(action.ageDays ?? 0), 10);
  const impact = Math.min(Math.floor(Number(action.impactAmount ?? 0) / 10000), 10);
  return clamp(base + age + impact);
}

function priorityClass(score: number): "p0" | "p1" | "p2" | "p3" {
  if (score >= 90) return "p0";
  if (score >= 75) return "p1";
  if (score >= 55) return "p2";
  return "p3";
}

async function insertAction(client: PoolClient, tenantId: string, snapshotId: string, action: ExecutiveActionInput, asOf: Date) {
  const score = priorityScore(action);
  await client.query(
    `
    INSERT INTO executive_actions (
      tenant_id, snapshot_id, action_type, priority, priority_score, severity, domain, owner_attribution, source_object_type,
      source_object_id, title, reason_code, reason_summary, recommended_next_step, route, age_days, due_at, impact_amount,
      source_fingerprint, generated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    `,
    [
      tenantId,
      snapshotId,
      action.actionType,
      priorityClass(score),
      score,
      action.severity,
      action.domain,
      action.ownerAttribution,
      action.sourceObjectType,
      action.sourceObjectId,
      action.title,
      action.reasonCode,
      action.reasonSummary,
      action.recommendedNextStep,
      action.route,
      action.ageDays ?? null,
      action.dueAt ?? null,
      action.impactAmount ?? null,
      hash([action.reasonCode, action.sourceObjectType, action.sourceObjectId ?? "", action.reasonSummary, action.impactAmount ?? "", dateOnly(asOf)]),
      asOf,
    ],
  );
}

async function insertBlocker(client: PoolClient, tenantId: string, snapshotId: string, blocker: BlockerInput) {
  await client.query(
    `
    INSERT INTO executive_blocker_snapshots (
      tenant_id, snapshot_id, blocker_type, severity, owner_attribution, domain, source_object_type, source_object_id,
      age_days, impact_amount, reason_code, reason_summary, source_fingerprint
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `,
    [
      tenantId,
      snapshotId,
      blocker.blockerType,
      blocker.severity,
      blocker.ownerAttribution,
      blocker.domain,
      blocker.sourceObjectType,
      blocker.sourceObjectId,
      blocker.ageDays ?? null,
      blocker.impactAmount ?? null,
      blocker.reasonCode,
      blocker.reasonSummary,
      hash([blocker.blockerType, blocker.reasonCode, blocker.sourceObjectType, blocker.sourceObjectId ?? "", blocker.reasonSummary]),
    ],
  );
}

async function readSnapshotChildren(client: PoolClient, tenantId: string, snapshotId: string) {
  const actions = await client.query<Row>("SELECT * FROM executive_actions WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY priority_score DESC, created_at LIMIT 100", [tenantId, snapshotId]);
  const blockers = await client.query<Row>("SELECT * FROM executive_blocker_snapshots WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY severity, created_at LIMIT 100", [tenantId, snapshotId]);
  return { actions: actions.rows, blockers: blockers.rows };
}

function dailyBriefFor(metrics: Awaited<ReturnType<typeof collectMetrics>>, actions: ExecutiveActionInput[], blockers: BlockerInput[]) {
  return {
    what_changed: {
      qualified_opportunities: metrics.qualifiedOpportunityCount,
      coverage_ready: metrics.coverageReadyCount,
      capacity_gaps: metrics.capacityGapCount,
      committed_crew_count: metrics.committedCrewCount,
      low_confidence_claimed_capacity: metrics.lowConfidenceClaimedCapacity,
      reports_submitted_today: metrics.reportsSubmittedToday,
      reported_production_units: metrics.reportedProductionSummary,
      accepted_production_units: metrics.acceptedProductionSummary,
      cleared_cash_amount: metrics.clearedCashAmount,
      partner_eligible_payable_amount: metrics.partnerEligiblePayableAmount,
    },
    top_actions: actions.slice(0, 10).map((action) => ({ title: action.title, reason_code: action.reasonCode, severity: action.severity, domain: action.domain })),
    blocker_summary: blockers.reduce<Record<string, number>>((acc, blocker) => {
      acc[blocker.reasonCode] = (acc[blocker.reasonCode] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function productionRows(rows: Row[]) {
  return rows.map((row) => ({ code: row.code, unit: row.unit, quantity: nullableNumber(row.quantity), record_count: Number(row.record_count ?? 0) }));
}

function normalizeAsOf(value: string | Date | undefined): Date {
  if (!value) return new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid asOf date");
  return date;
}

function dateOnly(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString().slice(0, 10);
}

function asOfBucket(value: Date): string {
  const copy = new Date(value);
  copy.setUTCMinutes(0, 0, 0);
  return copy.toISOString();
}

function hash(parts: unknown[]): string {
  return crypto.createHash("sha256").update(parts.map((part) => String(part)).join("|")).digest("hex");
}

function daysBetween(start: unknown, end: unknown): number {
  const startDate = start instanceof Date ? start : new Date(String(start));
  const endDate = end instanceof Date ? end : new Date(String(end));
  return Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000));
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrNull(value: unknown): number | null {
  return nullableNumber(value);
}

function currency(value: unknown): string {
  const amount = nullableNumber(value) ?? 0;
  return `$${amount.toFixed(2)}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}
