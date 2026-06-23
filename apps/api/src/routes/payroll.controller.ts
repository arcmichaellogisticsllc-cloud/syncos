import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const payrollRunTypes = new Set(["regular", "off_cycle", "correction", "bonus", "reimbursement", "final_pay", "manual_adjustment"]);
const payrollStatuses = new Set(["draft", "assembling", "ready_for_review", "under_review", "approved", "rejected", "held", "disputed", "payroll_ready", "payroll_created_later", "partially_paid_later", "paid_later", "voided", "archived"]);
const approvalStatuses = new Set(["not_submitted", "pending", "approved", "rejected", "withdrawn"]);
const readinessStatuses = new Set(["not_ready", "ready_with_warning", "ready_for_payroll", "blocked"]);
const payrollCycles = new Set(["weekly", "biweekly", "semimonthly", "monthly", "custom"]);
const complianceStatuses = new Set(["unknown", "missing", "incomplete", "ready", "expired", "blocked"]);
const taxDocumentStatuses = new Set(["unknown", "missing_w9", "missing_w4_later", "ready", "expired", "blocked"]);
const disputeStatuses = new Set(["none", "open", "under_review", "resolved", "rejected"]);
const holdStatuses = new Set(["none", "hold", "released"]);
const sourceTypes = new Set(["approved_time", "production_based", "per_diem", "reimbursement", "bonus", "adjustment", "correction", "manual", "imported_later"]);
const earningTypes = new Set(["regular", "overtime", "doubletime", "piece_rate", "per_diem", "reimbursement", "bonus", "incentive", "adjustment", "correction", "deduction", "penalty"]);
const workerClassifications = new Set(["w2_employee", "contractor_1099", "temp_worker", "seasonal_worker", "internal_self_perform", "union_later", "unknown"]);
const itemStatuses = new Set(["draft", "ready", "approved", "held", "disputed", "payroll_ready", "payroll_created_later", "voided", "archived"]);

type Row = Record<string, unknown>;

@Controller()
export class PayrollController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("payroll-runs")
  @RequirePermission("payroll_run.read")
  async listPayrollRuns(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["pr.tenant_id = $1"];
      if (query.archived !== "true") where.push("pr.deleted_at IS NULL", "pr.status <> 'archived'");
      this.addFilter(where, values, "pr.payroll_run_type", query.payroll_run_type);
      this.addFilter(where, values, "pr.status", query.status);
      this.addFilter(where, values, "pr.approval_status", query.approval_status);
      this.addFilter(where, values, "pr.payroll_readiness_status", query.payroll_readiness_status);
      this.addFilter(where, values, "pr.payroll_cycle", query.payroll_cycle);
      this.addFilter(where, values, "pr.project_id", query.project_id);
      this.addFilter(where, values, "pr.crew_id", query.crew_id);
      this.addFilter(where, values, "pr.compliance_status", query.compliance_status);
      this.addFilter(where, values, "pr.tax_document_status", query.tax_document_status);
      this.addFilter(where, values, "pr.dispute_status", query.dispute_status);
      this.addFilter(where, values, "pr.hold_status", query.hold_status);
      if (query.payroll_period_start) {
        values.push(query.payroll_period_start);
        where.push(`pr.payroll_period_start >= $${values.length}`);
      }
      if (query.payroll_period_end) {
        values.push(query.payroll_period_end);
        where.push(`pr.payroll_period_end <= $${values.length}`);
      }
      if (query.pay_date_from) {
        values.push(query.pay_date_from);
        where.push(`pr.pay_date >= $${values.length}`);
      }
      if (query.pay_date_to) {
        values.push(query.pay_date_to);
        where.push(`pr.pay_date <= $${values.length}`);
      }
      if (query.q) {
        values.push(`%${query.q}%`);
        where.push(`(pr.payroll_run_number ILIKE $${values.length} OR pr.payroll_run_type ILIKE $${values.length} OR pr.status ILIKE $${values.length} OR pr.hold_reason ILIKE $${values.length} OR pr.dispute_reason ILIKE $${values.length} OR project.name ILIKE $${values.length} OR crew.name ILIKE $${values.length})`);
      }
      const result = await client.query(
        `
        SELECT pr.*,
          project.name AS project_name,
          crew.name AS crew_name
        FROM payroll_runs pr
        LEFT JOIN projects project ON project.tenant_id = pr.tenant_id AND project.id = pr.project_id
        LEFT JOIN crews crew ON crew.tenant_id = pr.tenant_id AND crew.id = pr.crew_id
        WHERE ${where.join(" AND ")}
        ORDER BY ${this.runOrder(query.sort)}
        LIMIT 250
        `,
        values,
      );
      return result.rows.map((row) => this.withRunGuidance(row));
    });
  }

  @Get("payroll-runs/:id")
  @RequirePermission("payroll_run.read")
  async getPayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRun(client, request.auth.tenantId, id));
  }

  @Get("payroll-runs/:id/detail")
  @RequirePermission("payroll_run.read")
  async getPayrollRunDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.runDetail(client, request.auth.tenantId, request.auth.userId, id));
  }

  @Post("payroll-runs")
  @RequirePermission("payroll_run.create")
  async createPayrollRun(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "payroll_run.create", "payroll_run.created", "payroll_run", async (client) => {
      const payrollRunType = this.allowed(body.payroll_run_type, "payroll_run_type", payrollRunTypes);
      const payrollCycle = this.allowed(body.payroll_cycle, "payroll_cycle", payrollCycles);
      const periodStart = this.requireDate(body.payroll_period_start, "payroll_period_start is required");
      const periodEnd = this.requireDate(body.payroll_period_end, "payroll_period_end is required");
      if (periodStart > periodEnd) throw new BadRequestException("payroll_period_start must be <= payroll_period_end");
      if (body.project_id) await this.requireRecord(client, "projects", request.auth.tenantId, String(body.project_id), "project not found");
      if (body.crew_id) await this.requireRecord(client, "crews", request.auth.tenantId, String(body.crew_id), "crew not found");
      const run = await this.insert(client, "payroll_runs", {
        tenant_id: request.auth.tenantId,
        payroll_run_number: await this.nextRunNumber(client, request.auth.tenantId),
        payroll_run_type: payrollRunType,
        payroll_cycle: payrollCycle,
        payroll_period_start: periodStart,
        payroll_period_end: periodEnd,
        pay_date: this.optionalString(body.pay_date),
        territory_id: this.optionalString(body.territory_id),
        project_id: this.optionalString(body.project_id),
        crew_id: this.optionalString(body.crew_id),
        compliance_status: body.compliance_status === undefined ? "unknown" : this.allowed(body.compliance_status, "compliance_status", complianceStatuses),
        tax_document_status: body.tax_document_status === undefined ? "unknown" : this.allowed(body.tax_document_status, "tax_document_status", taxDocumentStatuses),
        override_reasons: this.objectValue(body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "payroll_run", entityId: run.id as string, afterState: this.withRunGuidance(run) };
    });
  }

  @Patch("payroll-runs/:id")
  @RequirePermission("payroll_run.update")
  async updatePayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "payroll_run.update", "payroll_run.updated", "payroll_run", async (client) => {
      const before = await this.requireRun(client, request.auth.tenantId, id);
      if (["voided", "archived", "payroll_created_later", "paid_later", "partially_paid_later"].includes(String(before.status))) throw new BadRequestException("payroll run cannot be updated in its current status");
      if (body.project_id) await this.requireRecord(client, "projects", request.auth.tenantId, String(body.project_id), "project not found");
      if (body.crew_id) await this.requireRecord(client, "crews", request.auth.tenantId, String(body.crew_id), "crew not found");
      const values = pick(body, ["payroll_period_start", "payroll_period_end", "pay_date", "payroll_cycle", "project_id", "crew_id", "hold_note", "dispute_note", "override_reasons"]);
      if (body.payroll_cycle !== undefined) values.payroll_cycle = this.allowed(body.payroll_cycle, "payroll_cycle", payrollCycles);
      if (body.compliance_status !== undefined) values.compliance_status = this.allowed(body.compliance_status, "compliance_status", complianceStatuses);
      if (body.tax_document_status !== undefined) values.tax_document_status = this.allowed(body.tax_document_status, "tax_document_status", taxDocumentStatuses);
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      if (values.payroll_period_start && values.payroll_period_end && String(values.payroll_period_start) > String(values.payroll_period_end)) throw new BadRequestException("payroll_period_start must be <= payroll_period_end");
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "payroll_runs", request.auth.tenantId, id, values);
      return { entityType: "payroll_run", entityId: id, beforeState: before, afterState: this.withRunGuidance(after) };
    }, body.reason);
  }

  @Post("payroll-runs/:id/items")
  @RequirePermission("payroll_run.add_item")
  async addPayrollItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "payroll_run.add_item", "payroll_item.created", "payroll_item", async (client) => {
      const run = await this.requireRun(client, request.auth.tenantId, id);
      this.ensureRunEditableForItems(run);
      const hasOverride = this.hasOverride(body);
      const workerId = this.requireText(body.worker_id, "worker_id is required");
      await this.requireRecord(client, "workers", request.auth.tenantId, workerId, "worker not found");
      await this.validateItemContext(client, request.auth.tenantId, body);
      this.validateItemRequirements(body, hasOverride);
      await this.requireNoDuplicateSource(client, request.auth.tenantId, id, workerId, body, hasOverride);
      const item = await this.insert(client, "payroll_items", this.deriveItemValues(request.auth.tenantId, request.auth.userId, id, body, hasOverride));
      const totals = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return {
        entityType: "payroll_item",
        entityId: item.id as string,
        afterState: item,
        additionalEvents: [this.additionalEvent("payroll_run.add_item", "payroll_run", id, "payroll_run.item_added", { ...totals, payroll_item_id: item.id })],
      };
    });
  }

  @Patch("payroll-items/:id")
  @RequirePermission("payroll_item.update")
  async updatePayrollItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "payroll_item.update", "payroll_item.updated", "payroll_item", async (client) => {
      const before = await this.requireItem(client, request.auth.tenantId, id);
      const run = await this.requireRun(client, request.auth.tenantId, String(before.payroll_run_id));
      if (["approved", "payroll_ready", "payroll_created_later", "voided", "archived"].includes(String(run.status))) throw new BadRequestException("payroll item cannot be updated after approval or payroll readiness");
      await this.validateItemContext(client, request.auth.tenantId, body);
      const values = pick(body, ["work_date", "unit", "description", "manual_reason", "evidence_reference", "override_reasons"]);
      for (const field of ["hours_regular", "hours_overtime", "hours_doubletime", "quantity", "rate_regular", "rate_overtime", "rate_doubletime", "piece_rate", "gross_pay_amount", "reimbursement_amount", "deduction_amount", "estimated_tax_amount"]) {
        if (body[field] !== undefined) values[field] = this.requireNonNegative(body[field], field);
      }
      if (body.compliance_status !== undefined) values.compliance_status = this.allowed(body.compliance_status, "compliance_status", complianceStatuses);
      if (body.tax_document_status !== undefined) values.tax_document_status = this.allowed(body.tax_document_status, "tax_document_status", taxDocumentStatuses);
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      const calculated = this.calculateItem({ ...before, ...values }, body.gross_pay_amount !== undefined);
      Object.assign(values, calculated, { updated_by: request.auth.userId, updated_at: new Date() });
      const after = await this.update(client, "payroll_items", request.auth.tenantId, id, values);
      await this.recalculateTotals(client, request.auth.tenantId, String(after.payroll_run_id), request.auth.userId);
      return { entityType: "payroll_item", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("payroll-items/:id/void")
  @RequirePermission("payroll_item.void")
  async voidPayrollItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.itemTerminalAction(request, id, body, "voided", "payroll_item.void", "payroll_item.voided", "void_reason", "void_note");
  }

  @Post("payroll-items/:id/archive")
  @RequirePermission("payroll_item.archive")
  async archivePayrollItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.itemTerminalAction(request, id, body, "archived", "payroll_item.archive", "payroll_item.archived", "archive_reason", "archive_note");
  }

  @Post("payroll-runs/:id/recalculate-totals")
  @RequirePermission("payroll_run.recalculate_totals")
  async recalculatePayrollTotals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "payroll_run.recalculate_totals", "payroll_run.totals_recalculated", "payroll_run", async (client) => {
      const before = await this.requireRun(client, request.auth.tenantId, id);
      const after = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return { entityType: "payroll_run", entityId: id, beforeState: before, afterState: this.withRunGuidance(after) };
    });
  }

  @Post("payroll-runs/:id/submit-review")
  @RequirePermission("payroll_run.submit_review")
  async submitReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.runStateAction(request, id, "payroll_run.submit_review", "payroll_run.review_submitted", async (run, client) => {
      if (!["draft", "assembling", "rejected"].includes(String(run.status))) throw new BadRequestException("payroll run cannot be submitted from its current status");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      return { status: "ready_for_review", approval_status: "pending" };
    });
  }

  @Post("payroll-runs/:id/start-review")
  @RequirePermission("payroll_run.start_review")
  async startReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.runStateAction(request, id, "payroll_run.start_review", "payroll_run.review_started", (run) => {
      if (run.status !== "ready_for_review") throw new BadRequestException("payroll run must be ready_for_review");
      return { status: "under_review" };
    });
  }

  @Post("payroll-runs/:id/approve")
  @RequirePermission("payroll_run.approve")
  async approvePayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.approve", "payroll_run.approved", async (run, client) => {
      this.requireText(body.approval_note, "approval_note is required");
      const hasOverride = this.hasOverride(body);
      if (!["under_review", "ready_for_review"].includes(String(run.status))) throw new BadRequestException("payroll run must be under review or ready for review");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      if (Number(run.net_pay_amount ?? 0) < 0) throw new BadRequestException("net pay amount must be >= 0");
      if (run.compliance_status !== "ready" && !hasOverride) throw new BadRequestException("compliance must be ready unless override supplied");
      if (run.tax_document_status !== "ready" && !hasOverride) throw new BadRequestException("tax documents must be ready unless override supplied");
      if (run.hold_status === "hold" && !hasOverride) throw new BadRequestException("held payroll run cannot be approved without override");
      if (run.dispute_status === "open" && !hasOverride) throw new BadRequestException("disputed payroll run cannot be approved without override");
      return { status: "approved", approval_status: "approved", approved_by: request.auth.userId, approved_at: new Date(), override_reasons: body.override_reasons === undefined ? run.override_reasons : this.objectValue(body.override_reasons) };
    }, body.approval_note);
  }

  @Post("payroll-runs/:id/reject")
  @RequirePermission("payroll_run.reject")
  async rejectPayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.reject", "payroll_run.rejected", () => ({
      status: "rejected",
      approval_status: "rejected",
      rejected_by: request.auth.userId,
      rejected_at: new Date(),
      rejection_reason: this.requireText(body.rejection_reason, "rejection_reason is required"),
      rejection_note: this.optionalString(body.rejection_note),
    }), body.rejection_reason);
  }

  @Post("payroll-runs/:id/mark-payroll-ready")
  @RequirePermission("payroll_run.mark_payroll_ready")
  async markPayrollReady(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.mark_payroll_ready", "payroll_run.payroll_ready", async (run, client) => {
      this.requireText(body.ready_note, "ready_note is required");
      const hasOverride = this.hasOverride(body);
      if (run.approval_status !== "approved") throw new BadRequestException("payroll run must be approved");
      if (Number(run.net_pay_amount ?? 0) < 0) throw new BadRequestException("net pay amount must be >= 0");
      if (run.compliance_status !== "ready" && !hasOverride) throw new BadRequestException("compliance must be ready unless override supplied");
      if (run.tax_document_status !== "ready" && !hasOverride) throw new BadRequestException("tax documents must be ready unless override supplied");
      if (run.hold_status === "hold") throw new BadRequestException("held payroll run cannot be marked payroll ready");
      if (run.dispute_status === "open") throw new BadRequestException("disputed payroll run cannot be marked payroll ready");
      const linked = await client.query("SELECT id FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2 AND payment_item_id IS NOT NULL AND deleted_at IS NULL LIMIT 1", [request.auth.tenantId, id]);
      if (linked.rows[0]) throw new BadRequestException("payroll item is already linked to a future payment item");
      return { status: "payroll_ready", payroll_readiness_status: "ready_for_payroll", override_reasons: body.override_reasons === undefined ? run.override_reasons : this.objectValue(body.override_reasons) };
    }, body.ready_note);
  }

  @Post("payroll-runs/:id/place-hold")
  @RequirePermission("payroll_run.place_hold")
  async placeHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.place_hold", "payroll_run.held", () => ({
      status: "held",
      hold_status: "hold",
      payroll_readiness_status: "blocked",
      hold_reason: this.requireText(body.hold_reason, "hold_reason is required"),
      hold_note: this.optionalString(body.hold_note),
    }), body.hold_reason);
  }

  @Post("payroll-runs/:id/release-hold")
  @RequirePermission("payroll_run.release_hold")
  async releaseHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.release_hold", "payroll_run.hold_released", (run) => {
      this.requireText(body.release_note, "release_note is required");
      return { hold_status: "released", status: run.approval_status === "approved" ? "approved" : "draft", payroll_readiness_status: "not_ready", hold_note: body.release_note };
    }, body.release_note);
  }

  @Post("payroll-runs/:id/dispute")
  @RequirePermission("payroll_run.dispute")
  async disputePayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.dispute", "payroll_run.disputed", () => ({
      status: "disputed",
      dispute_status: "open",
      payroll_readiness_status: "blocked",
      dispute_reason: this.requireText(body.dispute_reason, "dispute_reason is required"),
      dispute_note: this.optionalString(body.dispute_note),
    }), body.dispute_reason);
  }

  @Post("payroll-runs/:id/resolve-dispute")
  @RequirePermission("payroll_run.resolve_dispute")
  async resolveDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.resolve_dispute", "payroll_run.dispute_resolved", (run) => {
      this.requireText(body.resolution_note, "resolution_note is required");
      return { dispute_status: "resolved", status: run.approval_status === "approved" ? "approved" : "draft", payroll_readiness_status: "not_ready", dispute_note: body.resolution_note, override_reasons: body.override_reasons === undefined ? run.override_reasons : this.objectValue(body.override_reasons) };
    }, body.resolution_note);
  }

  @Post("payroll-runs/:id/void")
  @RequirePermission("payroll_run.void")
  async voidPayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.void", "payroll_run.voided", async (_run, client) => {
      this.requireText(body.void_reason, "void_reason is required");
      const linked = await client.query("SELECT id FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2 AND payment_item_id IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('voided', 'archived') LIMIT 1", [request.auth.tenantId, id]);
      if (linked.rows[0]) throw new BadRequestException("payroll run with payment item links cannot be voided");
      return { status: "voided", voided_by: request.auth.userId, voided_at: new Date(), void_reason: body.void_reason, void_note: this.optionalString(body.void_note) };
    }, body.void_reason);
  }

  @Post("payroll-runs/:id/archive")
  @RequirePermission("payroll_run.archive")
  async archivePayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.runStateAction(request, id, "payroll_run.archive", "payroll_run.archived", () => ({
      status: "archived",
      archived_by: request.auth.userId,
      archived_at: new Date(),
      archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
      archive_note: this.optionalString(body.archive_note),
    }), body.archive_reason);
  }

  @Get("payroll-runs/:id/items")
  @RequirePermission("payroll_item.read")
  async listPayrollItems(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRun(client, request.auth.tenantId, id);
      return (await client.query("SELECT * FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, id])).rows;
    });
  }

  @Get("payroll-items/:id")
  @RequirePermission("payroll_item.read")
  async getPayrollItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireItem(client, request.auth.tenantId, id));
  }

  @Get("payroll-items/:id/detail")
  @RequirePermission("payroll_item.read")
  async getPayrollItemDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const item = await this.requireItem(client, request.auth.tenantId, id);
      return {
        item,
        payroll_run_context: await this.requireRun(client, request.auth.tenantId, String(item.payroll_run_id)),
        worker_context: await this.optionalRecord(client, "workers", request.auth.tenantId, item.worker_id),
        crew_context: await this.optionalRecord(client, "crews", request.auth.tenantId, item.crew_id),
        project_context: await this.optionalRecord(client, "projects", request.auth.tenantId, item.project_id),
        work_order_context: await this.optionalRecord(client, "work_orders", request.auth.tenantId, item.work_order_id),
        production_context: await this.optionalRecord(client, "production_records", request.auth.tenantId, item.production_record_id),
        financial_breakdown: {
          gross_pay_amount: item.gross_pay_amount,
          reimbursement_amount: item.reimbursement_amount,
          deduction_amount: item.deduction_amount,
          estimated_tax_amount: item.estimated_tax_amount,
          net_pay_amount: item.net_pay_amount,
        },
        compliance_breakdown: { compliance_status: item.compliance_status, tax_document_status: item.tax_document_status },
      };
    });
  }

  @Get("payroll-runs/:id/timeline")
  @RequirePermission("payroll_run.timeline.read")
  async payrollRunTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRun(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2", [request.auth.tenantId, id]);
      const ids = [id, ...itemIds.rows.map((row) => row.id)];
      const result = await client.query(
        `
        SELECT e.id, e.event_type, e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.actor_user_id AS actor, e.created_at AS timestamp, e.audit_context AS summary
        FROM events e
        WHERE e.tenant_id = $1 AND e.aggregate_id = ANY($2::uuid[])
          AND e.event_type = ANY($3::text[])
        ORDER BY e.created_at DESC
        LIMIT 250
        `,
        [request.auth.tenantId, ids, [
          "payroll_run.created",
          "payroll_run.updated",
          "payroll_run.item_added",
          "payroll_run.item_removed",
          "payroll_run.totals_recalculated",
          "payroll_run.review_submitted",
          "payroll_run.review_started",
          "payroll_run.approved",
          "payroll_run.rejected",
          "payroll_run.payroll_ready",
          "payroll_run.held",
          "payroll_run.hold_released",
          "payroll_run.disputed",
          "payroll_run.dispute_resolved",
          "payroll_run.voided",
          "payroll_run.archived",
          "payroll_item.created",
          "payroll_item.updated",
          "payroll_item.voided",
          "payroll_item.archived",
        ]],
      );
      return result.rows;
    });
  }

  @Get("payroll-runs/:id/audit-summary")
  @RequirePermission("payroll_run.audit.read")
  async payrollRunAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRun(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2", [request.auth.tenantId, id]);
      const ids = [id, ...itemIds.rows.map((row) => row.id)];
      const result = await client.query(
        `
        SELECT id, actor_user_id AS actor, action, entity_type AS object, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id
        FROM audit_logs
        WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
        ORDER BY created_at DESC
        LIMIT 250
        `,
        [request.auth.tenantId, ids],
      );
      return result.rows;
    });
  }

  private async runStateAction(
    request: AuthenticatedRequest,
    id: string,
    action: string,
    eventType: string,
    transition: (run: Row, client: PoolClient) => Promise<Row> | Row,
    reason?: unknown,
  ) {
    return this.write(request, action, eventType, "payroll_run", async (client) => {
      const before = await this.requireRun(client, request.auth.tenantId, id);
      if (["voided", "archived", "payroll_created_later", "paid_later", "partially_paid_later"].includes(String(before.status)) && action !== "payroll_run.archive") throw new BadRequestException("payroll run cannot transition from its current status");
      const values = await transition(before, client);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "payroll_runs", request.auth.tenantId, id, values);
      return { entityType: "payroll_run", entityId: id, beforeState: before, afterState: this.withRunGuidance(after) };
    }, reason);
  }

  private async itemTerminalAction(request: AuthenticatedRequest, id: string, body: Row, status: "voided" | "archived", action: string, eventType: string, reasonField: string, noteField: string) {
    return this.write(request, action, eventType, "payroll_item", async (client) => {
      const before = await this.requireItem(client, request.auth.tenantId, id);
      if (status === "voided" && before.payment_item_id) throw new BadRequestException("payroll item linked to payment cannot be voided");
      const prefix = status === "voided" ? "voided" : "archived";
      const values: Row = {
        status,
        updated_by: request.auth.userId,
        updated_at: new Date(),
        [`${prefix}_by`]: request.auth.userId,
        [`${prefix}_at`]: new Date(),
        [reasonField]: this.requireText(body[reasonField], `${reasonField} is required`),
        [noteField]: this.optionalString(body[noteField]),
      };
      const after = await this.update(client, "payroll_items", request.auth.tenantId, id, values);
      await this.recalculateTotals(client, request.auth.tenantId, String(after.payroll_run_id), request.auth.userId);
      return { entityType: "payroll_item", entityId: id, beforeState: before, afterState: after };
    }, body[reasonField]);
  }

  private async runDetail(client: PoolClient, tenantId: string, userId: string, id: string) {
    const run = await this.requireRun(client, tenantId, id);
    const items = (await client.query("SELECT * FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [tenantId, id])).rows;
    return {
      payroll_run: this.withRunGuidance(run),
      payroll_items: items,
      project_context: await this.optionalRecord(client, "projects", tenantId, run.project_id),
      crew_context: await this.optionalRecord(client, "crews", tenantId, run.crew_id),
      worker_summary: { worker_count: run.worker_count },
      financial_summary: {
        gross_pay_amount: run.gross_pay_amount,
        reimbursement_amount: run.reimbursement_amount,
        deduction_amount: run.deduction_amount,
        estimated_tax_amount: run.estimated_tax_amount,
        net_pay_amount: run.net_pay_amount,
      },
      earning_summary: await this.itemBreakdown(client, tenantId, id, "earning_type"),
      reimbursement_summary: { reimbursement_amount: run.reimbursement_amount },
      deduction_summary: { deduction_amount: run.deduction_amount },
      compliance_summary: { compliance_status: run.compliance_status },
      tax_document_summary: { tax_document_status: run.tax_document_status },
      hold_dispute_summary: { hold_status: run.hold_status, hold_reason: run.hold_reason, dispute_status: run.dispute_status, dispute_reason: run.dispute_reason },
      payroll_boundary_summary: {
        payroll_readiness_status: run.payroll_readiness_status,
        creates_payment: false,
        creates_ach: false,
        creates_card_payout: false,
        creates_check: false,
        creates_bank_transaction: false,
        submits_payroll_provider: false,
        creates_tax_filing: false,
        creates_accounting_export: false,
      },
      warnings: this.runWarnings(run),
      blockers: this.runBlockers(run),
      required_override_fields: this.runRequiredOverrides(run),
      recommended_next_action: this.recommendedRunAction(run, Number(run.item_count ?? items.length)),
      timeline_available: true,
      audit_allowed: await this.hasPermission(client, tenantId, userId, "payroll_run.audit.read"),
    };
  }

  private async validateItemContext(client: PoolClient, tenantId: string, body: Row) {
    if (body.crew_id) await this.requireRecord(client, "crews", tenantId, String(body.crew_id), "crew not found");
    if (body.project_id) await this.requireRecord(client, "projects", tenantId, String(body.project_id), "project not found");
    if (body.work_order_id) await this.requireRecord(client, "work_orders", tenantId, String(body.work_order_id), "work order not found");
    if (body.production_record_id) await this.requireRecord(client, "production_records", tenantId, String(body.production_record_id), "production record not found");
  }

  private validateItemRequirements(body: Row, hasOverride: boolean) {
    const sourceType = this.allowed(body.source_type, "source_type", sourceTypes);
    const earningType = this.allowed(body.earning_type, "earning_type", earningTypes);
    const classification = this.allowed(body.worker_classification, "worker_classification", workerClassifications);
    if (classification === "unknown" && !hasOverride) throw new BadRequestException("unknown worker classification blocks payroll readiness unless override supplied");
    if (sourceType === "approved_time" && body.hours_regular === undefined && body.hours_overtime === undefined && body.hours_doubletime === undefined) throw new BadRequestException("approved_time requires hours");
    if (sourceType === "production_based" && !body.production_record_id && !body.work_order_id && !body.project_id && body.quantity === undefined && !hasOverride) throw new BadRequestException("production_based requires production, work order, project, or quantity unless override supplied");
    if (sourceType === "manual" && !this.optionalString(body.manual_reason)) throw new BadRequestException("manual payroll item requires manual_reason");
    if (earningType === "reimbursement" && (body.reimbursement_amount === undefined || (!this.optionalString(body.description) && !this.optionalString(body.evidence_reference))) && !hasOverride) throw new BadRequestException("reimbursement requires amount and description/evidence unless override supplied");
    if (earningType === "bonus" && !this.optionalString(body.description) && !this.optionalString(body.manual_reason)) throw new BadRequestException("bonus requires description or manual_reason");
    if (earningType === "correction" && !this.optionalString(body.description) && !this.optionalString(body.manual_reason)) throw new BadRequestException("correction requires description or manual_reason");
    if (earningType === "deduction" && (body.deduction_amount === undefined || (!this.optionalString(body.description) && !this.optionalString(body.manual_reason)))) throw new BadRequestException("deduction requires deduction_amount and reason");
  }

  private deriveItemValues(tenantId: string, userId: string, payrollRunId: string, body: Row, hasOverride: boolean) {
    this.validateItemRequirements(body, hasOverride);
    const base: Row = {
      tenant_id: tenantId,
      payroll_run_id: payrollRunId,
      worker_id: this.requireText(body.worker_id, "worker_id is required"),
      crew_id: this.optionalString(body.crew_id),
      project_id: this.optionalString(body.project_id),
      work_order_id: this.optionalString(body.work_order_id),
      production_record_id: this.optionalString(body.production_record_id),
      source_type: this.allowed(body.source_type, "source_type", sourceTypes),
      earning_type: this.allowed(body.earning_type, "earning_type", earningTypes),
      status: "ready",
      worker_classification: this.allowed(body.worker_classification, "worker_classification", workerClassifications),
      work_date: this.optionalString(body.work_date),
      unit: this.optionalString(body.unit),
      description: this.optionalString(body.description),
      manual_reason: this.optionalString(body.manual_reason),
      evidence_reference: this.optionalString(body.evidence_reference),
      compliance_status: body.compliance_status === undefined ? "unknown" : this.allowed(body.compliance_status, "compliance_status", complianceStatuses),
      tax_document_status: body.tax_document_status === undefined ? "unknown" : this.allowed(body.tax_document_status, "tax_document_status", taxDocumentStatuses),
      dispute_status: "none",
      hold_status: "none",
      override_reasons: this.objectValue(body.override_reasons),
      created_by: userId,
      updated_by: userId,
    };
    for (const field of ["hours_regular", "hours_overtime", "hours_doubletime", "quantity", "rate_regular", "rate_overtime", "rate_doubletime", "piece_rate", "gross_pay_amount", "reimbursement_amount", "deduction_amount", "estimated_tax_amount"]) {
      if (body[field] !== undefined) base[field] = this.requireNonNegative(body[field], field);
    }
    return { ...base, ...this.calculateItem(base, body.gross_pay_amount !== undefined) };
  }

  private calculateItem(row: Row, useExplicitGross: boolean) {
    const hasPayComponents = ["hours_regular", "hours_overtime", "hours_doubletime", "quantity", "rate_regular", "rate_overtime", "rate_doubletime", "piece_rate"].some((field) => row[field] !== undefined && row[field] !== null);
    const canUseStoredGross = !hasPayComponents && ["bonus", "incentive", "adjustment", "correction"].includes(String(row.earning_type));
    const explicitGross = row.gross_pay_amount === undefined || (!useExplicitGross && !canUseStoredGross) ? undefined : Number(row.gross_pay_amount);
    const gross = explicitGross ?? this.roundMoney(
      Number(row.hours_regular ?? 0) * Number(row.rate_regular ?? 0)
        + Number(row.hours_overtime ?? 0) * Number(row.rate_overtime ?? 0)
        + Number(row.hours_doubletime ?? 0) * Number(row.rate_doubletime ?? 0)
        + Number(row.quantity ?? 0) * Number(row.piece_rate ?? 0)
        + (["bonus", "incentive", "adjustment", "correction"].includes(String(row.earning_type)) ? Number(row.gross_pay_amount ?? 0) : 0),
    );
    const reimbursement = Number(row.reimbursement_amount ?? (row.earning_type === "per_diem" ? row.gross_pay_amount ?? 0 : 0));
    const deduction = Number(row.deduction_amount ?? 0);
    const estimatedTax = row.estimated_tax_amount === undefined || row.estimated_tax_amount === null ? null : Number(row.estimated_tax_amount);
    const net = this.roundMoney(gross + reimbursement - deduction - Number(estimatedTax ?? 0));
    if (net < 0 && !["deduction", "penalty", "correction", "adjustment"].includes(String(row.earning_type))) throw new BadRequestException("net pay amount cannot be negative for this earning type");
    return {
      gross_pay_amount: this.roundMoney(gross),
      reimbursement_amount: this.roundMoney(reimbursement),
      deduction_amount: this.roundMoney(deduction),
      estimated_tax_amount: estimatedTax === null ? null : this.roundMoney(estimatedTax),
      net_pay_amount: net,
    };
  }

  private async requireNoDuplicateSource(client: PoolClient, tenantId: string, payrollRunId: string, workerId: string, body: Row, hasOverride: boolean) {
    if (hasOverride) return;
    const result = await client.query(
      `
      SELECT id
      FROM payroll_items
      WHERE tenant_id = $1
        AND payroll_run_id = $2
        AND worker_id = $3
        AND source_type = $4
        AND earning_type = $5
        AND coalesce(work_date::text, '') = coalesce($6::text, '')
        AND deleted_at IS NULL
        AND status NOT IN ('voided', 'archived')
      LIMIT 1
      `,
      [tenantId, payrollRunId, workerId, body.source_type, body.earning_type, body.work_date ?? null],
    );
    if (result.rows[0]) throw new BadRequestException("duplicate payroll item for worker/source is not allowed without override");
  }

  private async requireActiveItemCount(client: PoolClient, tenantId: string, runId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')", [tenantId, runId]);
    if (Number(result.rows[0]?.count ?? 0) <= 0) throw new BadRequestException("payroll run requires at least one active item");
  }

  private async recalculateTotals(client: PoolClient, tenantId: string, runId: string, userId: string) {
    const totals = await client.query(
      `
      SELECT
        coalesce(sum(gross_pay_amount), 0)::numeric AS gross_pay_amount,
        coalesce(sum(reimbursement_amount), 0)::numeric AS reimbursement_amount,
        coalesce(sum(deduction_amount), 0)::numeric AS deduction_amount,
        nullif(sum(coalesce(estimated_tax_amount, 0)), 0)::numeric AS estimated_tax_amount,
        coalesce(sum(net_pay_amount), 0)::numeric AS net_pay_amount,
        count(*)::int AS item_count,
        count(DISTINCT worker_id)::int AS worker_count
      FROM payroll_items
      WHERE tenant_id = $1 AND payroll_run_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')
      `,
      [tenantId, runId],
    );
    return this.update(client, "payroll_runs", tenantId, runId, { ...totals.rows[0], updated_by: userId, updated_at: new Date() });
  }

  private async itemBreakdown(client: PoolClient, tenantId: string, runId: string, field: string) {
    const result = await client.query(
      `SELECT ${field} AS key, count(*)::int AS count, coalesce(sum(net_pay_amount), 0)::numeric AS net_pay_amount FROM payroll_items WHERE tenant_id = $1 AND payroll_run_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived') GROUP BY ${field} ORDER BY ${field}`,
      [tenantId, runId],
    );
    return result.rows;
  }

  private withRunGuidance(row: Row) {
    return {
      ...row,
      warnings: this.runWarnings(row),
      blockers: this.runBlockers(row),
      required_override_fields: this.runRequiredOverrides(row),
      recommended_next_action: this.recommendedRunAction(row, Number(row.item_count ?? 0)),
    };
  }

  private runWarnings(row: Row) {
    const warnings: string[] = [];
    if (row.compliance_status !== "ready") warnings.push("compliance_not_ready");
    if (row.tax_document_status !== "ready") warnings.push("tax_documents_not_ready");
    if (row.hold_status === "hold") warnings.push("payroll_run_on_hold");
    if (row.dispute_status === "open") warnings.push("payroll_run_disputed");
    if (row.estimated_tax_amount === null || row.estimated_tax_amount === undefined) warnings.push("estimated_tax_not_supplied");
    return warnings;
  }

  private runBlockers(row: Row) {
    const blockers: string[] = [];
    if (Number(row.net_pay_amount ?? 0) < 0) blockers.push("net_pay_amount_negative");
    if (row.hold_status === "hold") blockers.push("hold_blocks_payroll_readiness");
    if (row.dispute_status === "open") blockers.push("dispute_blocks_payroll_readiness");
    if (row.compliance_status === "blocked") blockers.push("compliance_blocked");
    if (row.tax_document_status === "blocked") blockers.push("tax_documents_blocked");
    return blockers;
  }

  private runRequiredOverrides(row: Row) {
    const required: string[] = [];
    if (row.compliance_status !== "ready") required.push("compliance_override_reason");
    if (row.tax_document_status !== "ready") required.push("tax_document_override_reason");
    if (row.hold_status === "hold") required.push("hold_override_reason");
    if (row.dispute_status === "open") required.push("dispute_override_reason");
    return required;
  }

  private recommendedRunAction(row: Row, itemCount: number) {
    if (row.status === "archived") return "view_only";
    if (row.status === "voided") return "view_voided_payroll_run";
    if (row.status === "held") return "release_or_review_hold";
    if (row.status === "disputed") return "resolve_dispute";
    if (itemCount <= 0) return "add_payroll_items";
    if (row.approval_status === "not_submitted") return "submit_for_review";
    if (row.approval_status === "pending" && row.status === "ready_for_review") return "start_review";
    if (row.status === "under_review") return "approve_or_reject";
    if (row.status === "approved" && row.payroll_readiness_status !== "ready_for_payroll") return "mark_payroll_ready";
    if (row.payroll_readiness_status === "ready_for_payroll") return "wait_for_future_payroll_execution";
    return "continue_payroll_review";
  }

  private runOrder(sort?: string) {
    if (sort === "pay_date_asc") return "pr.pay_date ASC NULLS LAST, pr.updated_at DESC";
    if (sort === "net_amount_desc") return "pr.net_pay_amount DESC, pr.updated_at DESC";
    if (sort === "status") return "pr.status ASC, pr.updated_at DESC";
    if (sort === "payroll_run_number") return "pr.payroll_run_number ASC";
    if (sort === "payroll_readiness") return "pr.payroll_readiness_status ASC, pr.updated_at DESC";
    return "pr.updated_at DESC";
  }

  private ensureRunEditableForItems(run: Row) {
    if (["approved", "payroll_ready", "payroll_created_later", "partially_paid_later", "paid_later", "voided", "archived"].includes(String(run.status))) throw new BadRequestException("payroll items cannot be changed in current status");
  }

  private async nextRunNumber(client: PoolClient, tenantId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await client.query("SELECT count(*)::int + 1 AS next FROM payroll_runs WHERE tenant_id = $1", [tenantId]);
      const candidate = `PR-${String(Number(result.rows[0].next) + attempt).padStart(6, "0")}`;
      const existing = await client.query("SELECT 1 FROM payroll_runs WHERE tenant_id = $1 AND payroll_run_number = $2", [tenantId, candidate]);
      if (!existing.rows[0]) return candidate;
    }
    throw new BadRequestException("could not allocate payroll run number");
  }

  private async requireRun(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM payroll_runs WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("payroll run not found");
    return result.rows[0] as Row;
  }

  private async requireItem(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM payroll_items WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("payroll item not found");
    return result.rows[0] as Row;
  }

  private async insert(client: PoolClient, table: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    const placeholders = keys.map((_, index) => `$${index + 1}`);
    const result = await client.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`, keys.map((key) => values[key]));
    return result.rows[0] as Row;
  }

  private async update(client: PoolClient, table: string, tenantId: string, id: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    if (keys.length === 0) return table === "payroll_runs" ? this.requireRun(client, tenantId, id) : this.requireItem(client, tenantId, id);
    const assignments = keys.map((key, index) => `${key} = $${index + 3}`);
    const result = await client.query(`UPDATE ${table} SET ${assignments.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING *`, [tenantId, id, ...keys.map((key) => values[key])]);
    if (!result.rows[0]) throw new NotFoundException("record not found");
    return result.rows[0] as Row;
  }

  private addFilter(where: string[], values: unknown[], column: string, value?: string) {
    if (!value) return;
    values.push(value);
    where.push(`${column} = $${values.length}`);
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const result = await client.query(`SELECT id FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException(message);
  }

  private async optionalRecord(client: PoolClient, table: string, tenantId: string, id: unknown) {
    if (!id) return null;
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    return result.rows[0] ?? null;
  }

  private async hasPermission(client: PoolClient, tenantId: string, userId: string, permission: string) {
    const result = await client.query(
      `
      SELECT 1
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id AND ur.tenant_id = tu.tenant_id
      JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.tenant_id = tu.tenant_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND p.key = $3
      LIMIT 1
      `,
      [tenantId, userId, permission],
    );
    return Boolean(result.rows[0]);
  }

  private additionalEvent(action: string, entityType: string, entityId: string, eventType: string, afterState: Row, beforeState?: Row) {
    return {
      action,
      aggregateType: entityType,
      entityType,
      entityId,
      eventType,
      afterState,
      beforeState,
      systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
    };
  }

  private allowed(value: unknown, field: string, allowedValues: Set<string>) {
    const parsed = this.requireText(value, `${field} is required`);
    if (!allowedValues.has(parsed)) throw new BadRequestException(`${field} is invalid`);
    return parsed;
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private requireDate(value: unknown, message: string) {
    const parsed = this.requireText(value, message);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) throw new BadRequestException(message);
    return parsed;
  }

  private requireText(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private objectValue(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return {};
  }

  private hasOverride(body: Row) {
    const override = this.objectValue(body.override_reasons);
    return Object.keys(override).length > 0;
  }

  private requireNonNegative(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new BadRequestException(`${field} must be >= 0`);
    return parsed;
  }

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
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
