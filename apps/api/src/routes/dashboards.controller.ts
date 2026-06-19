import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

type Metric = { label: string; value: number | string | null };

@Controller("dashboard")
export class DashboardsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("executive")
  @RequirePermission("dashboard.executive.read")
  async executive(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      telecomWorkThroughput: await this.latestKpi(client, tenantId, "telecom_work_throughput"),
      opportunityPipeline: await this.opportunityPipeline(client, tenantId),
      capacityHealth: await this.capacityHealth(client, tenantId),
      productionHealth: await this.productionHealth(client, tenantId),
      settlementHealth: await this.statusCounts(client, tenantId, "settlements"),
      cashHealth: await this.cashHealth(client, tenantId),
      constraintSummary: await this.constraintSummary(client, tenantId),
      recommendationSummary: await this.statusCounts(client, tenantId, "recommendations"),
      workflowSummary: await this.workflowSummary(client, tenantId),
    }));
  }

  @Get("growth")
  @RequirePermission("dashboard.growth.read")
  async growth(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      signalVolume: await this.count(client, "signals", tenantId),
      signalConversionRate: await this.latestKpi(client, tenantId, "signal_conversion_rate"),
      candidateConversionRate: await this.latestKpi(client, tenantId, "opportunity_candidate_conversion_rate"),
      relationshipAccessScore: await this.avg(client, "opportunity_candidates", "relationship_access_score", tenantId),
      opportunityCandidatePipeline: await this.statusCounts(client, tenantId, "opportunity_candidates"),
      qualifiedOpportunityValue: await this.latestKpi(client, tenantId, "qualified_opportunity_value"),
      strategicOpportunityRatio: await this.ratio(
        client,
        "SELECT count(*)::numeric FROM opportunities WHERE tenant_id = $1 AND strategic_fit_score >= 70 AND deleted_at IS NULL",
        "SELECT count(*)::numeric FROM opportunities WHERE tenant_id = $1 AND deleted_at IS NULL",
        tenantId,
      ),
      relationshipActivity: await this.statusCounts(client, tenantId, "relationship_maps"),
    }));
  }

  @Get("operations")
  @RequirePermission("dashboard.operations.read")
  async operations(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      capacityCoverageRatio: await this.latestKpi(client, tenantId, "capacity_coverage_ratio"),
      activatedProviders: await this.scalar(client, "SELECT count(*)::numeric FROM capacity_providers WHERE tenant_id = $1 AND status = 'activated' AND deleted_at IS NULL", tenantId),
      crewCounts: await this.groupCounts(client, tenantId, "crews", "crew_type"),
      capacityGaps: await this.latestCapacityGaps(client, tenantId),
      productionVolume: await this.scalar(client, "SELECT coalesce(sum(quantity_submitted), 0)::numeric FROM production_records WHERE tenant_id = $1 AND deleted_at IS NULL", tenantId),
      correctionRate: await this.latestKpi(client, tenantId, "correction_rate"),
      qcScore: {
        approvalRate: await this.latestKpi(client, tenantId, "production_approval_rate"),
        correctionRate: await this.latestKpi(client, tenantId, "correction_rate"),
        rejectionRate: await this.ratio(
          client,
          "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status = 'rejected' AND deleted_at IS NULL",
          this.submittedProductionSql(),
          tenantId,
        ),
      },
      stopWorkCount: await this.scalar(client, "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND stop_work_status = 'active' AND deleted_at IS NULL", tenantId),
    }));
  }

  @Get("finance")
  @RequirePermission("dashboard.finance.read")
  async finance(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      settlementConversionRate: await this.latestKpi(client, tenantId, "settlement_conversion_rate"),
      cashConversionRate: await this.latestKpi(client, tenantId, "cash_conversion_rate"),
      arAging: await this.groupCounts(client, tenantId, "ar_records", "aging_bucket"),
      invoiceCounts: await this.statusCounts(client, tenantId, "invoices"),
      paymentCounts: await this.statusCounts(client, tenantId, "payments"),
      customerPaymentIntelligence: await this.customerPaymentStats(client, tenantId),
    }));
  }

  @Get("constraints")
  @RequirePermission("dashboard.constraints.read")
  async constraints(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      byType: await this.groupCounts(client, tenantId, "constraints", "constraint_type", "status <> 'archived' AND deleted_at IS NULL"),
      bySeverity: await this.groupCounts(client, tenantId, "constraints", "severity", "status <> 'archived' AND deleted_at IS NULL"),
      byOwner: await this.groupCounts(client, tenantId, "constraints", "owner_id", "status <> 'archived' AND deleted_at IS NULL"),
      byDueDate: await this.dueDateBuckets(client, tenantId),
      byValueImpact: await this.constraintValueImpact(client, tenantId),
      activeConstraints: await this.recentRows(client, tenantId, "constraints", ["detected", "open", "assigned", "in_progress", "blocked", "resolved"]),
    }));
  }

  @Get("recommendations")
  @RequirePermission("dashboard.recommendations.read")
  async recommendations(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      pendingReview: await this.recommendationsByStatus(client, tenantId, "pending_review"),
      approved: await this.recommendationsByStatus(client, tenantId, "approved"),
      deferred: await this.recommendationsByStatus(client, tenantId, "deferred"),
      completed: await this.recommendationsByStatus(client, tenantId, "completed"),
      measured: await this.recommendationsByStatus(client, tenantId, "measured"),
      summary: await this.statusCounts(client, tenantId, "recommendations"),
    }));
  }

  @Get("workflows")
  @RequirePermission("dashboard.workflows.read")
  async workflows(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      openWorkflowInstances: await this.recentWorkflowInstances(client, tenantId, ["created", "started", "in_progress"]),
      completedWorkflowInstances: await this.recentWorkflowInstances(client, tenantId, ["completed"]),
      openTasks: await this.recentWorkflowTasks(client, tenantId, ["open", "in_progress", "reassigned"]),
      overdueTasks: await this.overdueTasks(client, tenantId),
      escalatedTasks: await this.recentWorkflowTasks(client, tenantId, ["escalated"]),
      summary: await this.workflowSummary(client, tenantId),
    }));
  }

  @Get("kpis")
  @RequirePermission("dashboard.kpis.read")
  async kpis(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth.tenantId;
    return this.withClient(async (client) => ({
      kpiList: await this.kpiList(client, tenantId),
      kpiAlerts: await this.recentRows(client, tenantId, "kpi_alerts", ["open", "resolved"]),
      kpiTrends: await this.kpiTrends(client, tenantId),
    }));
  }

  private async opportunityPipeline(client: PoolClient, tenantId: string) {
    const result = await client.query(
      `
      SELECT status, coalesce(sum(estimated_value), 0)::numeric AS value
      FROM opportunities
      WHERE tenant_id = $1 AND deleted_at IS NULL
      GROUP BY status
      `,
      [tenantId],
    );
    return {
      qualifiedValue: this.valueFor(result.rows, "qualified"),
      pursuingValue: this.valueFor(result.rows, "pursuing"),
      awardedValue: this.valueFor(result.rows, "awarded"),
      deferredValue: this.valueFor(result.rows, "deferred"),
    };
  }

  private async capacityHealth(client: PoolClient, tenantId: string) {
    return {
      capacityCoverageRatio: await this.latestKpi(client, tenantId, "capacity_coverage_ratio"),
      activatedCapacity: await this.scalar(client, "SELECT coalesce(sum(quantity), 0)::numeric FROM capacity_records WHERE tenant_id = $1 AND deleted_at IS NULL", tenantId),
      capacityGaps: await this.latestCapacityGaps(client, tenantId),
    };
  }

  private async productionHealth(client: PoolClient, tenantId: string) {
    return {
      submittedProduction: await this.scalar(client, this.submittedProductionSql(), tenantId),
      approvedProduction: await this.scalar(client, "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status IN ('approved', 'billable') AND deleted_at IS NULL", tenantId),
      correctionRate: await this.latestKpi(client, tenantId, "correction_rate"),
      productionApprovalRate: await this.latestKpi(client, tenantId, "production_approval_rate"),
    };
  }

  private async cashHealth(client: PoolClient, tenantId: string) {
    return {
      openAr: await this.scalar(client, "SELECT coalesce(sum(amount_open), 0)::numeric FROM ar_records WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL", tenantId),
      overdueAr: await this.scalar(client, "SELECT coalesce(sum(ar.amount_open), 0)::numeric FROM ar_records ar JOIN invoices i ON i.id = ar.invoice_id WHERE ar.tenant_id = $1 AND i.due_date < current_date AND ar.status <> 'archived' AND ar.deleted_at IS NULL", tenantId),
      cashConversionRate: await this.latestKpi(client, tenantId, "cash_conversion_rate"),
      averageDaysToPay: await this.scalar(client, "SELECT coalesce(avg(average_days_to_pay), 0)::numeric FROM customer_payment_stats WHERE tenant_id = $1", tenantId),
    };
  }

  private async constraintSummary(client: PoolClient, tenantId: string) {
    return {
      openConstraints: await this.scalar(client, "SELECT count(*)::numeric FROM constraints WHERE tenant_id = $1 AND status IN ('detected', 'open', 'assigned', 'in_progress', 'blocked') AND deleted_at IS NULL", tenantId),
      openConstraintsTrend: await this.latestKpi(client, tenantId, "open_constraints"),
      constraintsByType: await this.groupCounts(client, tenantId, "constraints", "constraint_type", "status IN ('detected', 'open', 'assigned', 'in_progress', 'blocked') AND deleted_at IS NULL"),
      blockedValue: await this.scalar(client, "SELECT count(*)::numeric FROM constraints WHERE tenant_id = $1 AND status = 'blocked' AND deleted_at IS NULL", tenantId),
    };
  }

  private async workflowSummary(client: PoolClient, tenantId: string) {
    return {
      openTasks: await this.scalar(client, "SELECT count(*)::numeric FROM workflow_tasks WHERE tenant_id = $1 AND status IN ('open', 'in_progress', 'reassigned') AND deleted_at IS NULL", tenantId),
      overdueTasks: await this.scalar(client, "SELECT count(*)::numeric FROM workflow_tasks WHERE tenant_id = $1 AND due_at < now() AND status NOT IN ('completed', 'cancelled', 'archived') AND deleted_at IS NULL", tenantId),
      escalatedTasks: await this.scalar(client, "SELECT count(*)::numeric FROM workflow_tasks WHERE tenant_id = $1 AND status = 'escalated' AND deleted_at IS NULL", tenantId),
      openWorkflowInstances: await this.scalar(client, "SELECT count(*)::numeric FROM workflow_instances WHERE tenant_id = $1 AND status IN ('created', 'started', 'in_progress') AND deleted_at IS NULL", tenantId),
    };
  }

  private async latestKpi(client: PoolClient, tenantId: string, key: string) {
    const result = await client.query(
      `
      SELECT kd.id, kd.kpi_name, ks.value, ks.snapshot_period_end AS last_calculation_date
      FROM kpi_definitions kd
      LEFT JOIN LATERAL (
        SELECT value, snapshot_period_end
        FROM kpi_snapshots
        WHERE tenant_id = kd.tenant_id AND kpi_definition_id = kd.id AND deleted_at IS NULL
        ORDER BY snapshot_period_end DESC NULLS LAST, created_at DESC
        LIMIT 1
      ) ks ON true
      WHERE kd.tenant_id = $1 AND kd.key = $2 AND kd.deleted_at IS NULL
      ORDER BY kd.created_at DESC
      LIMIT 1
      `,
      [tenantId, key],
    );
    const row = result.rows[0];
    if (!row) {
      return { key, currentValue: 0, trend: "flat", percentageChange: 0, lastCalculationDate: null };
    }

    const trend = await this.snapshotTrend(client, tenantId, row.id);
    return {
      key,
      kpiId: row.id,
      name: row.kpi_name,
      currentValue: Number(row.value ?? 0),
      trend: trend.trend,
      percentageChange: trend.percentageChange,
      lastCalculationDate: row.last_calculation_date,
    };
  }

  private async snapshotTrend(client: PoolClient, tenantId: string, kpiDefinitionId: string) {
    const result = await client.query(
      `
      SELECT value
      FROM kpi_snapshots
      WHERE tenant_id = $1 AND kpi_definition_id = $2 AND deleted_at IS NULL
      ORDER BY snapshot_period_end DESC NULLS LAST, created_at DESC
      LIMIT 2
      `,
      [tenantId, kpiDefinitionId],
    );
    const current = Number(result.rows[0]?.value ?? 0);
    const previous = Number(result.rows[1]?.value ?? current);
    const delta = current - previous;
    const trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const percentageChange = previous === 0 ? (delta === 0 ? 0 : 100) : Number(((delta / Math.abs(previous)) * 100).toFixed(2));
    return { trend, percentageChange };
  }

  private async latestCapacityGaps(client: PoolClient, tenantId: string) {
    const result = await client.query(
      "SELECT id, analysis_name, gap_summary_json, created_at FROM capacity_gap_analyses WHERE tenant_id = $1 AND status <> 'archived' ORDER BY created_at DESC LIMIT 5",
      [tenantId],
    );
    return result.rows;
  }

  private async customerPaymentStats(client: PoolClient, tenantId: string) {
    const result = await client.query(
      "SELECT customer_organization_id, average_days_to_pay, payment_count, short_pay_count, last_payment_at FROM customer_payment_stats WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 25",
      [tenantId],
    );
    return result.rows;
  }

  private async recommendationsByStatus(client: PoolClient, tenantId: string, status: string) {
    const result = await client.query(
      "SELECT id, title, recommendation_type, risk_level, expected_impact, status, created_at FROM recommendations WHERE tenant_id = $1 AND status = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25",
      [tenantId, status],
    );
    return result.rows;
  }

  private async recentWorkflowInstances(client: PoolClient, tenantId: string, statuses: string[]) {
    const result = await client.query(
      "SELECT id, workflow_definition_id, source_object_type, source_object_id, status, due_at, created_at FROM workflow_instances WHERE tenant_id = $1 AND status = ANY($2) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25",
      [tenantId, statuses],
    );
    return result.rows;
  }

  private async recentWorkflowTasks(client: PoolClient, tenantId: string, statuses: string[]) {
    const result = await client.query(
      "SELECT id, workflow_instance_id, title, task_name, assigned_to, assigned_role, status, due_at, created_at FROM workflow_tasks WHERE tenant_id = $1 AND status = ANY($2) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25",
      [tenantId, statuses],
    );
    return result.rows;
  }

  private async overdueTasks(client: PoolClient, tenantId: string) {
    const result = await client.query(
      "SELECT id, workflow_instance_id, title, task_name, assigned_to, assigned_role, status, due_at, created_at FROM workflow_tasks WHERE tenant_id = $1 AND due_at < now() AND status NOT IN ('completed', 'cancelled', 'archived') AND deleted_at IS NULL ORDER BY due_at ASC LIMIT 25",
      [tenantId],
    );
    return result.rows;
  }

  private async kpiList(client: PoolClient, tenantId: string) {
    const result = await client.query(
      "SELECT id, kpi_name, kpi_category, calculation_frequency, owner_role, target_value, alert_threshold, status FROM kpi_definitions WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY kpi_category, kpi_name",
      [tenantId],
    );
    return result.rows;
  }

  private async kpiTrends(client: PoolClient, tenantId: string) {
    const result = await client.query(
      `
      SELECT kd.id AS kpi_definition_id, kd.kpi_name, json_agg(json_build_object('value', ks.value, 'snapshot_period_end', ks.snapshot_period_end) ORDER BY ks.snapshot_period_end DESC NULLS LAST, ks.created_at DESC) AS history
      FROM kpi_definitions kd
      JOIN kpi_snapshots ks ON ks.kpi_definition_id = kd.id AND ks.tenant_id = kd.tenant_id AND ks.deleted_at IS NULL
      WHERE kd.tenant_id = $1 AND kd.deleted_at IS NULL
      GROUP BY kd.id, kd.kpi_name
      ORDER BY kd.kpi_name
      `,
      [tenantId],
    );
    return result.rows;
  }

  private async recentRows(client: PoolClient, tenantId: string, table: string, statuses: string[]) {
    const result = await client.query(
      `SELECT * FROM ${table} WHERE tenant_id = $1 AND status = ANY($2) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 25`,
      [tenantId, statuses],
    );
    return result.rows;
  }

  private async dueDateBuckets(client: PoolClient, tenantId: string): Promise<Metric[]> {
    const result = await client.query(
      `
      SELECT
        CASE
          WHEN due_date IS NULL THEN 'no_due_date'
          WHEN due_date < current_date THEN 'overdue'
          WHEN due_date <= current_date + interval '7 days' THEN 'due_7_days'
          ELSE 'future'
        END AS label,
        count(*)::numeric AS value
      FROM constraints
      WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL
      GROUP BY label
      ORDER BY label
      `,
      [tenantId],
    );
    return result.rows.map((row) => ({ label: row.label, value: Number(row.value) }));
  }

  private async constraintValueImpact(client: PoolClient, tenantId: string) {
    const result = await client.query(
      "SELECT severity AS label, count(*)::numeric AS value FROM constraints WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL GROUP BY severity ORDER BY severity",
      [tenantId],
    );
    return result.rows.map((row) => ({ label: row.label, value: Number(row.value) }));
  }

  private async groupCounts(client: PoolClient, tenantId: string, table: string, column: string, predicate = "deleted_at IS NULL"): Promise<Metric[]> {
    const result = await client.query(
      `SELECT coalesce(${column}::text, 'unassigned') AS label, count(*)::numeric AS value FROM ${table} WHERE tenant_id = $1 AND ${predicate} GROUP BY label ORDER BY label`,
      [tenantId],
    );
    return result.rows.map((row) => ({ label: row.label, value: Number(row.value) }));
  }

  private async statusCounts(client: PoolClient, tenantId: string, table: string): Promise<Metric[]> {
    return this.groupCounts(client, tenantId, table, "status");
  }

  private async count(client: PoolClient, table: string, tenantId: string) {
    return this.scalar(client, `SELECT count(*)::numeric FROM ${table} WHERE tenant_id = $1 AND deleted_at IS NULL`, tenantId);
  }

  private async avg(client: PoolClient, table: string, column: string, tenantId: string) {
    return this.scalar(client, `SELECT coalesce(avg(${column}), 0)::numeric FROM ${table} WHERE tenant_id = $1 AND ${column} IS NOT NULL AND deleted_at IS NULL`, tenantId);
  }

  private async ratio(client: PoolClient, numeratorSql: string, denominatorSql: string, tenantId: string) {
    const numerator = await this.scalar(client, numeratorSql, tenantId);
    const denominator = await this.scalar(client, denominatorSql, tenantId);
    return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
  }

  private async scalar(client: PoolClient, sql: string, tenantId: string) {
    const result = await client.query(sql, [tenantId]);
    return Number(result.rows[0]?.[Object.keys(result.rows[0] ?? { value: 0 })[0]] ?? 0);
  }

  private submittedProductionSql() {
    return "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status IN ('submitted', 'correction_required', 'qc_review', 'accepted', 'approved', 'billable', 'rejected') AND deleted_at IS NULL";
  }

  private valueFor(rows: Array<{ status: string; value: string }>, status: string) {
    return Number(rows.find((row) => row.status === status)?.value ?? 0);
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
