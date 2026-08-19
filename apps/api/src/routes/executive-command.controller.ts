import { Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { executeWriteAction, recalculateExecutiveCommandSnapshot, runExecutiveCommandRefreshScan, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

type Row = QueryResultRow & Record<string, unknown>;

@Controller("executive-command")
export class ExecutiveCommandController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("summary")
  @RequirePermission("executive_command.read")
  async summary(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const snapshot = await this.currentSnapshot(client, request.auth.tenantId);
      if (!snapshot) {
        return {
          snapshot: null,
          actions: [],
          blockers: [],
          boundary: this.boundary(),
          message: "No executive command snapshot exists. Run an authorized recalculation or wait for the worker refresh.",
        };
      }
      return {
        snapshot: this.safeSnapshot(snapshot),
        actions: await this.actionsForSnapshot(client, request.auth.tenantId, String(snapshot.id), 10),
        blockers: await this.blockersForSnapshot(client, request.auth.tenantId, String(snapshot.id)),
        boundary: this.boundary(),
      };
    });
  }

  @Get("actions")
  @RequirePermission("executive_command.actions_read")
  async actions(@Req() request: AuthenticatedRequest, @Query("limit") limit?: string) {
    return this.withClient(async (client) => {
      const snapshot = await this.currentSnapshot(client, request.auth.tenantId);
      if (!snapshot) return [];
      return this.actionsForSnapshot(client, request.auth.tenantId, String(snapshot.id), Math.max(1, Math.min(Number(limit ?? 25), 100)));
    });
  }

  @Post("recalculate")
  @RequirePermission("executive_command.snapshot_recalculate")
  async recalculate(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "executive_command.snapshot_recalculated", "executive_command.snapshot_recalculated", "executive_command_snapshot", async (client) => {
      const result = await recalculateExecutiveCommandSnapshot(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        asOf: typeof body.as_of === "string" ? body.as_of : undefined,
      });
      return {
        entityType: "executive_command_snapshot",
        entityId: String(result.snapshot.id),
        afterState: {
          snapshot: this.safeSnapshot(result.snapshot),
          action_count: result.actions.length,
          blocker_count: result.blockers.length,
          created: result.created,
          boundary: this.boundary(),
        },
      };
    });
  }

  @Post("scan")
  @RequirePermission("executive_command.snapshot_recalculate")
  async scan(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.withClient((client) =>
      runExecutiveCommandRefreshScan(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        asOf: typeof body.as_of === "string" ? body.as_of : undefined,
        batchSize: typeof body.batch_size === "number" ? body.batch_size : undefined,
      }),
    );
  }

  @Patch("actions/:actionId/acknowledge")
  @RequirePermission("executive_command.action_acknowledge")
  async acknowledge(@Req() request: AuthenticatedRequest, @Param("actionId") actionId: string) {
    return this.write(request, "executive_action.acknowledged", "executive_action.acknowledged", "executive_action", async (client) => {
      const existing = await client.query("SELECT * FROM executive_actions WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, actionId]);
      if (!existing.rows[0]) throw new NotFoundException("Executive action not found");
      const updated = await client.query("UPDATE executive_actions SET status = 'acknowledged', updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *", [request.auth.tenantId, actionId]);
      return {
        entityType: "executive_action",
        entityId: actionId,
        beforeState: this.safeAction(existing.rows[0]),
        afterState: { ...this.safeAction(updated.rows[0]), source_mutated: false },
      };
    });
  }

  private async currentSnapshot(client: PoolClient, tenantId: string) {
    const result = await client.query("SELECT * FROM executive_command_snapshots WHERE tenant_id = $1 AND current = true ORDER BY as_of DESC LIMIT 1", [tenantId]);
    return result.rows[0] as Row | undefined;
  }

  private async actionsForSnapshot(client: PoolClient, tenantId: string, snapshotId: string, limit: number) {
    const result = await client.query(
      "SELECT * FROM executive_actions WHERE tenant_id = $1 AND snapshot_id = $2 AND current = true ORDER BY priority_score DESC, generated_at LIMIT $3",
      [tenantId, snapshotId, limit],
    );
    return result.rows.map((row) => this.safeAction(row));
  }

  private async blockersForSnapshot(client: PoolClient, tenantId: string, snapshotId: string) {
    const result = await client.query("SELECT * FROM executive_blocker_snapshots WHERE tenant_id = $1 AND snapshot_id = $2 ORDER BY created_at LIMIT 100", [tenantId, snapshotId]);
    return result.rows.map((row) => this.safeBlocker(row));
  }

  private safeSnapshot(row: Row) {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      snapshot_date: row.snapshot_date,
      as_of: row.as_of,
      policy_version: row.policy_version,
      qualified_opportunity_count: row.qualified_opportunity_count,
      qualified_opportunity_value: row.qualified_opportunity_value,
      coverage_ready_count: row.coverage_ready_count,
      capacity_gap_count: row.capacity_gap_count,
      ready_crew_count: row.ready_crew_count,
      active_work_order_count: row.active_work_order_count,
      reported_production_summary: row.reported_production_summary,
      accepted_production_summary: row.accepted_production_summary,
      pending_qc_count: row.pending_qc_count,
      customer_qc_aging_count: row.customer_qc_aging_count,
      accepted_not_billed_amount: row.accepted_not_billed_amount,
      outstanding_ar_amount: row.outstanding_ar_amount,
      cleared_cash_amount: row.cleared_cash_amount,
      unapplied_cash_amount: row.unapplied_cash_amount,
      partner_eligible_payable_amount: row.partner_eligible_payable_amount,
      partner_awaiting_funds_amount: row.partner_awaiting_funds_amount,
      partner_payment_due_amount: row.partner_payment_due_amount,
      critical_risk_count: row.critical_risk_count,
      high_blocker_count: row.high_blocker_count,
      days_to_cash: row.days_to_cash,
      billing_velocity: row.billing_velocity,
      daily_brief: row.daily_brief,
      freshness: row.freshness,
      calculated_at: row.calculated_at,
    };
  }

  private safeAction(row: Row) {
    return {
      id: row.id,
      snapshot_id: row.snapshot_id,
      action_type: row.action_type,
      priority: row.priority,
      priority_score: row.priority_score,
      severity: row.severity,
      domain: row.domain,
      owner_attribution: row.owner_attribution,
      source_object_type: row.source_object_type,
      source_object_id: row.source_object_id,
      title: row.title,
      reason_code: row.reason_code,
      reason_summary: row.reason_summary,
      recommended_next_step: row.recommended_next_step,
      route: row.route,
      age_days: row.age_days,
      due_at: row.due_at,
      impact_amount: row.impact_amount,
      status: row.status,
      generated_at: row.generated_at,
    };
  }

  private safeBlocker(row: Row) {
    return {
      id: row.id,
      snapshot_id: row.snapshot_id,
      blocker_type: row.blocker_type,
      severity: row.severity,
      owner_attribution: row.owner_attribution,
      domain: row.domain,
      source_object_type: row.source_object_type,
      source_object_id: row.source_object_id,
      age_days: row.age_days,
      impact_amount: row.impact_amount,
      reason_code: row.reason_code,
      reason_summary: row.reason_summary,
      status: row.status,
    };
  }

  private boundary() {
    return {
      read_model_only: true,
      recommendation_is_action: false,
      ranked_action_is_automatic_action: false,
      opportunity_stage_changed: false,
      work_order_awarded: false,
      partner_assigned: false,
      crew_reserved: false,
      payment_executed: false,
      lifecycle_changed: false,
      customer_ar_partner_ap_collapsed: false,
      worker_pii_returned: false,
      rates_or_margin_returned: false,
    };
  }

  private async write<T>(
    request: AuthenticatedRequest,
    action: string,
    eventType: string,
    aggregateType: string,
    write: (client: PoolClient) => Promise<WriteActionResult<T>>,
  ) {
    return this.withClient((client) =>
      executeWriteAction(client, {
        tenantId: request.auth.tenantId,
        actorUserId: request.auth.userId,
        action,
        aggregateType,
        eventType,
        skipSourceInvalidation: true,
        write,
      }),
    );
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
