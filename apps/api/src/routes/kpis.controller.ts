import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const kpiCategories = new Set(["intelligence", "opportunity", "capacity", "execution", "cash", "optimization"]);
const approvedKpis: Record<string, { key: string; category: string; direction: "lt" | "gt" }> = {
  "Signal Conversion Rate": { key: "signal_conversion_rate", category: "intelligence", direction: "lt" },
  "Opportunity Candidate Conversion Rate": { key: "opportunity_candidate_conversion_rate", category: "opportunity", direction: "lt" },
  "Qualified Opportunity Value": { key: "qualified_opportunity_value", category: "opportunity", direction: "lt" },
  "Capacity Coverage Ratio": { key: "capacity_coverage_ratio", category: "capacity", direction: "lt" },
  "Production Approval Rate": { key: "production_approval_rate", category: "execution", direction: "lt" },
  "Correction Rate": { key: "correction_rate", category: "execution", direction: "gt" },
  "Settlement Conversion Rate": { key: "settlement_conversion_rate", category: "cash", direction: "lt" },
  "Cash Conversion Rate": { key: "cash_conversion_rate", category: "cash", direction: "lt" },
  "Constraint Resolution Time": { key: "constraint_resolution_time", category: "optimization", direction: "gt" },
  "Decision Velocity": { key: "decision_velocity", category: "optimization", direction: "gt" },
  "Telecom Work Throughput": { key: "telecom_work_throughput", category: "optimization", direction: "lt" },
};

@Controller()
export class KpisController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("kpis")
  @RequirePermission("kpi.read")
  async listKpis(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "kpi_definitions", request.auth.tenantId, { searchColumns: ["key", "name", "kpi_name", "kpi_category", "status"] }));
  }

  @Get("kpis/:id")
  @RequirePermission("kpi.read")
  async getKpi(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "kpi_definitions", request.auth.tenantId, id, "kpi not found"));
  }

  @Post("kpis")
  @RequirePermission("kpi.create")
  async createKpi(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const kpiName = this.requireString(body.kpi_name, "kpi_name is required");
    const approved = approvedKpis[kpiName];
    if (!approved) throw new BadRequestException("kpi_name is not approved for Sprint 11");
    const category = this.requireAllowed(body.kpi_category, kpiCategories, "kpi_category");
    if (category !== approved.category) throw new BadRequestException("kpi_category does not match approved KPI");
    return this.write(request, "kpi.create", "kpi.created", "kpi", async (client) => {
      const kpi = await insertTenantRecord(client, "kpi_definitions", request.auth.tenantId, {
        key: approved.key,
        name: kpiName,
        kpi_name: kpiName,
        kpi_category: category,
        formula_description: this.requireString(body.formula_description, "formula_description is required"),
        calculation_frequency: this.requireString(body.calculation_frequency, "calculation_frequency is required"),
        owner_role: this.requireString(body.owner_role, "owner_role is required"),
        target_value: this.requireNumber(body.target_value, "target_value"),
        alert_threshold: this.requireNumber(body.alert_threshold, "alert_threshold"),
        status: this.requireString(body.status, "status is required"),
        calculation: this.requireString(body.formula_description, "formula_description is required"),
      });
      return { entityType: "kpi", entityId: kpi.id, afterState: kpi };
    });
  }

  @Patch("kpis/:id")
  @RequirePermission("kpi.update")
  async updateKpi(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const values = pick(body, ["formula_description", "calculation_frequency", "owner_role", "status"]);
    if (body.kpi_name !== undefined || body.key !== undefined || body.kpi_category !== undefined) throw new BadRequestException("kpi identity fields cannot be changed");
    if (body.target_value !== undefined) values.target_value = this.requireNumber(body.target_value, "target_value");
    if (body.alert_threshold !== undefined) values.alert_threshold = this.requireNumber(body.alert_threshold, "alert_threshold");
    if (values.formula_description !== undefined) values.calculation = values.formula_description;
    return this.writeUpdate(request, "kpi_definitions", id, "kpi", "kpi.update", "kpi.updated", values, body.reason);
  }

  @Post("kpis/:id/archive")
  @RequirePermission("kpi.archive")
  async archiveKpi(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "kpi.archive", "kpi.archived", "kpi", async (client) => {
      const before = await this.requireRecord(client, "kpi_definitions", request.auth.tenantId, id, "kpi not found");
      const after = await updateTenantRecord(client, "kpi_definitions", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("kpi not found");
      return { entityType: "kpi", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("kpis/:id/calculate")
  @RequirePermission("kpi.calculate")
  async calculateKpi(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.calculateOne(request, id);
  }

  @Post("kpis/calculate-all")
  @RequirePermission("kpi.calculate")
  async calculateAll(@Req() request: AuthenticatedRequest) {
    const kpis = await this.withClient((client) => listTenantRecords(client, "kpi_definitions", request.auth.tenantId, { limit: 100 }));
    const results = [];
    for (const kpi of kpis.filter((row) => row.status !== "archived")) {
      results.push(await this.calculateOne(request, kpi.id));
    }
    return results;
  }

  @Get("kpi-snapshots")
  @RequirePermission("kpi_history.read")
  async listSnapshots(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "kpi_snapshots", request.auth.tenantId, { orderBy: "snapshot_period_end" }));
  }

  @Get("kpi-snapshots/:id")
  @RequirePermission("kpi_history.read")
  async getSnapshot(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "kpi_snapshots", request.auth.tenantId, id, "kpi snapshot not found"));
  }

  @Get("kpis/:id/history")
  @RequirePermission("kpi_history.read")
  async kpiHistory(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "kpi_definitions", request.auth.tenantId, id, "kpi not found");
      const result = await client.query(
        "SELECT * FROM kpi_snapshots WHERE tenant_id = $1 AND kpi_definition_id = $2 AND deleted_at IS NULL ORDER BY snapshot_period_end DESC NULLS LAST, created_at DESC",
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("kpi-alerts")
  @RequirePermission("kpi_alert.read")
  async listAlerts(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "kpi_alerts", request.auth.tenantId, { searchColumns: ["severity", "message", "status"] }));
  }

  @Get("kpi-alerts/:id")
  @RequirePermission("kpi_alert.read")
  async getAlert(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "kpi_alerts", request.auth.tenantId, id, "kpi alert not found"));
  }

  @Post("kpi-alerts/:id/archive")
  @RequirePermission("kpi_alert.archive")
  async archiveAlert(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "kpi_alert.archive", "kpi_alert.archived", "kpi_alert", async (client) => {
      const before = await this.requireRecord(client, "kpi_alerts", request.auth.tenantId, id, "kpi alert not found");
      const after = await updateTenantRecord(client, "kpi_alerts", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("kpi alert not found");
      return { entityType: "kpi_alert", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async calculateOne(request: AuthenticatedRequest, id: string) {
    return this.write(request, "kpi.calculate", "kpi.calculated", "kpi", async (client) => {
      const kpi = await this.requireRecord(client, "kpi_definitions", request.auth.tenantId, id, "kpi not found");
      if (kpi.status === "archived") throw new BadRequestException("archived KPI cannot be calculated");
      const value = await this.calculateValue(client, request.auth.tenantId, String(kpi.key));
      const now = new Date();
      const snapshot = await insertTenantRecord(client, "kpi_snapshots", request.auth.tenantId, {
        kpi_definition_id: id,
        value,
        snapshot_at: now,
        snapshot_period_start: now,
        snapshot_period_end: now,
        metadata: { kpi_key: kpi.key },
      });
      const additionalEvents = [this.additionalEvent("kpi_snapshot.create", "kpi_snapshot", snapshot.id, "kpi_snapshot.created", snapshot)];
      const alert = await this.maybeCreateAlert(client, request.auth.tenantId, kpi, value);
      if (alert) additionalEvents.push(this.additionalEvent("kpi_alert.create", "kpi_alert", alert.id, "kpi_alert.created", alert));
      return { entityType: "kpi", entityId: id, afterState: { ...kpi, calculated_value: value, snapshot_id: snapshot.id }, additionalEvents };
    });
  }

  private async calculateValue(client: PoolClient, tenantId: string, key: string): Promise<number> {
    switch (key) {
      case "signal_conversion_rate":
        return this.ratio(client, "SELECT count(*)::numeric FROM opportunity_candidates WHERE tenant_id = $1 AND deleted_at IS NULL", "SELECT count(*)::numeric FROM signals WHERE tenant_id = $1 AND status = 'verified' AND deleted_at IS NULL", tenantId);
      case "opportunity_candidate_conversion_rate":
        return this.ratio(client, "SELECT count(*)::numeric FROM opportunities WHERE tenant_id = $1 AND deleted_at IS NULL", "SELECT count(*)::numeric FROM opportunity_candidates WHERE tenant_id = $1 AND deleted_at IS NULL", tenantId);
      case "qualified_opportunity_value":
        return this.scalar(client, "SELECT coalesce(sum(estimated_value), 0)::numeric FROM opportunities WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL", tenantId);
      case "capacity_coverage_ratio":
        return this.ratio(client, "SELECT coalesce(sum(quantity), 0)::numeric FROM capacity_records WHERE tenant_id = $1 AND deleted_at IS NULL", "SELECT coalesce(sum(quantity), 0)::numeric FROM opportunity_capacity_requirements WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL", tenantId);
      case "production_approval_rate":
        return this.ratio(client, "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status IN ('approved', 'billable') AND deleted_at IS NULL", this.submittedProductionSql(), tenantId);
      case "correction_rate":
        return this.ratio(client, "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status = 'correction_required' AND deleted_at IS NULL", this.submittedProductionSql(), tenantId);
      case "settlement_conversion_rate":
        return this.ratio(client, "SELECT count(*)::numeric FROM settlements WHERE tenant_id = $1 AND status = 'approved' AND deleted_at IS NULL", "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status = 'billable' AND deleted_at IS NULL", tenantId);
      case "cash_conversion_rate":
        return this.ratio(client, "SELECT count(*)::numeric FROM payments WHERE tenant_id = $1 AND status = 'reconciled' AND deleted_at IS NULL", "SELECT count(*)::numeric FROM settlements WHERE tenant_id = $1 AND status = 'approved' AND deleted_at IS NULL", tenantId);
      case "constraint_resolution_time":
        return this.scalar(client, "SELECT coalesce(avg(extract(epoch FROM (resolved_at - created_at)) / 3600), 0)::numeric FROM constraints WHERE tenant_id = $1 AND resolved_at IS NOT NULL AND deleted_at IS NULL", tenantId);
      case "decision_velocity":
        return this.scalar(client, "SELECT coalesce(avg(extract(epoch FROM (approved_at - created_at)) / 3600), 0)::numeric FROM recommendations WHERE tenant_id = $1 AND approved_at IS NOT NULL AND deleted_at IS NULL", tenantId);
      case "telecom_work_throughput": {
        const qualifiedValue = await this.calculateValue(client, tenantId, "qualified_opportunity_value");
        const capacityCoverage = await this.calculateValue(client, tenantId, "capacity_coverage_ratio");
        const productionApproval = await this.calculateValue(client, tenantId, "production_approval_rate");
        const settlementConversion = await this.calculateValue(client, tenantId, "settlement_conversion_rate");
        const cashConversion = await this.calculateValue(client, tenantId, "cash_conversion_rate");
        const activeOpportunities = await this.scalar(client, "SELECT count(*)::numeric FROM opportunities WHERE tenant_id = $1 AND status <> 'archived' AND deleted_at IS NULL", tenantId);
        return activeOpportunities === 0 ? 0 : Number((qualifiedValue * capacityCoverage * productionApproval * settlementConversion * cashConversion / activeOpportunities).toFixed(4));
      }
      default:
        throw new BadRequestException("unsupported KPI calculation");
    }
  }

  private submittedProductionSql() {
    return "SELECT count(*)::numeric FROM production_records WHERE tenant_id = $1 AND status IN ('submitted', 'correction_required', 'qc_review', 'accepted', 'approved', 'billable', 'rejected') AND deleted_at IS NULL";
  }

  private async maybeCreateAlert(client: PoolClient, tenantId: string, kpi: Record<string, unknown>, value: number) {
    const approved = Object.values(approvedKpis).find((entry) => entry.key === kpi.key);
    if (!approved) return null;
    const threshold = Number(kpi.alert_threshold);
    const violated = approved.direction === "lt" ? value < threshold : value > threshold;
    if (!violated) return null;
    return insertTenantRecord(client, "kpi_alerts", tenantId, {
      kpi_definition_id: kpi.id,
      severity: "medium",
      message: `${kpi.kpi_name ?? kpi.name} threshold violated`,
      status: "open",
    });
  }

  private async ratio(client: PoolClient, numeratorSql: string, denominatorSql: string, tenantId: string) {
    const numerator = await this.scalar(client, numeratorSql, tenantId);
    const denominator = await this.scalar(client, denominatorSql, tenantId);
    return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
  }

  private async scalar(client: PoolClient, sql: string, tenantId: string) {
    const result = await client.query(sql, [tenantId]);
    return Number(result.rows[0]?.coalesce ?? result.rows[0]?.count ?? result.rows[0]?.sum ?? result.rows[0]?.avg ?? Object.values(result.rows[0] ?? { value: 0 })[0] ?? 0);
  }

  private async writeUpdate(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string, values: Record<string, unknown>, reason?: unknown) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    }, reason);
  }

  private additionalEvent(action: string, aggregateType: string, entityId: string, eventType: string, afterState: Record<string, unknown>) {
    return {
      action,
      aggregateType,
      entityType: aggregateType,
      entityId,
      eventType,
      afterState,
      systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
      audit: { metadata: {} },
    };
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private requireString(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private requireAllowed(value: unknown, allowed: Set<string>, field: string) {
    const text = this.requireString(value, `${field} is required`);
    if (!allowed.has(text)) throw new BadRequestException(`${field} is invalid`);
    return text;
  }

  private requireNumber(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new BadRequestException(`${field} is required`);
    return parsed;
  }

  private async write<T>(
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
    reason?: unknown,
  ) {
    const client = await this.pool.connect();
    try {
      return await executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
        audit: { metadata: typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {} },
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
