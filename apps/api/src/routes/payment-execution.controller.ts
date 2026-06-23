import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const batchTypes = new Set(["contractor_payable", "payroll", "mixed_later", "correction", "reversal"]);
const paymentMethods = new Set(["ach", "check", "card_payout", "wire", "payroll_provider", "manual", "other"]);
const batchStatuses = new Set(["draft", "assembling", "ready_for_review", "under_review", "approved", "scheduled", "submitted", "partially_executed_later", "executed_later", "failed", "cancelled", "voided", "archived"]);
const approvalStatuses = new Set(["not_submitted", "pending", "approved", "rejected", "withdrawn"]);
const executionStatuses = new Set(["not_submitted", "ready_for_execution", "submitted_later", "executed_later", "partially_executed_later", "failed", "cancelled"]);
const itemStatuses = new Set(["draft", "ready", "approved", "scheduled", "submitted_later", "executed_later", "failed", "cancelled", "voided", "archived"]);

type Row = Record<string, unknown>;

@Controller()
export class PaymentExecutionController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("payment-batches")
  @RequirePermission("payment_batch.read")
  async listBatches(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["pb.tenant_id = $1"];
      if (query.archived !== "true") where.push("pb.deleted_at IS NULL", "pb.status <> 'archived'");
      this.addFilter(where, values, "pb.batch_type", query.batch_type);
      this.addFilter(where, values, "pb.payment_method", query.payment_method);
      this.addFilter(where, values, "pb.status", query.status);
      this.addFilter(where, values, "pb.approval_status", query.approval_status);
      this.addFilter(where, values, "pb.execution_status", query.execution_status);
      if (query.scheduled_payment_date_from) {
        values.push(query.scheduled_payment_date_from);
        where.push(`pb.scheduled_payment_date >= $${values.length}`);
      }
      if (query.scheduled_payment_date_to) {
        values.push(query.scheduled_payment_date_to);
        where.push(`pb.scheduled_payment_date <= $${values.length}`);
      }
      if (query.submitted_from) {
        values.push(query.submitted_from);
        where.push(`pb.submitted_at >= $${values.length}`);
      }
      if (query.submitted_to) {
        values.push(query.submitted_to);
        where.push(`pb.submitted_at <= $${values.length}`);
      }
      if (query.executed_from) {
        values.push(query.executed_from);
        where.push(`pb.executed_at >= $${values.length}`);
      }
      if (query.executed_to) {
        values.push(query.executed_to);
        where.push(`pb.executed_at <= $${values.length}`);
      }
      if (query.q) {
        values.push(`%${query.q}%`);
        where.push(`(pb.payment_batch_number ILIKE $${values.length} OR pb.execution_reference ILIKE $${values.length} OR pb.failure_reason ILIKE $${values.length} OR pb.notes ILIKE $${values.length})`);
      }
      const result = await client.query(
        `
        SELECT pb.*
        FROM payment_batches pb
        WHERE ${where.join(" AND ")}
        ORDER BY ${this.batchOrder(query.sort)}
        LIMIT 250
        `,
        values,
      );
      return result.rows.map((row) => this.withBatchGuidance(row));
    });
  }

  @Get("payment-batches/:id")
  @RequirePermission("payment_batch.read")
  async getBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireBatch(client, request.auth.tenantId, id));
  }

  @Get("payment-batches/:id/detail")
  @RequirePermission("payment_batch.read")
  async getBatchDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.batchDetail(client, request.auth.tenantId, request.auth.userId, id));
  }

  @Post("payment-batches")
  @RequirePermission("payment_batch.create")
  async createBatch(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "payment_batch.create", "payment_batch.created", "payment_batch", async (client) => {
      const batchType = this.allowed(body.batch_type, "batch_type", batchTypes);
      const hasOverride = this.hasOverride(body);
      if (batchType === "mixed_later" && !hasOverride) throw new BadRequestException("mixed_later payment batches are blocked unless override is supplied");
      const batch = await this.insert(client, "payment_batches", {
        tenant_id: request.auth.tenantId,
        payment_batch_number: await this.nextBatchNumber(client, request.auth.tenantId),
        batch_type: batchType,
        payment_method: this.allowed(body.payment_method, "payment_method", paymentMethods),
        scheduled_payment_date: this.optionalString(body.scheduled_payment_date),
        currency: this.optionalString(body.currency) ?? "USD",
        notes: this.optionalString(body.notes),
        override_reasons: this.objectValue(body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "payment_batch", entityId: batch.id as string, afterState: this.withBatchGuidance(batch) };
    });
  }

  @Patch("payment-batches/:id")
  @RequirePermission("payment_batch.update")
  async updateBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "payment_batch.update", "payment_batch.updated", "payment_batch", async (client) => {
      const before = await this.requireBatch(client, request.auth.tenantId, id);
      this.ensureBatchEditable(before);
      const values = pick(body, ["scheduled_payment_date", "notes", "override_reasons"]);
      if (body.payment_method !== undefined) values.payment_method = this.allowed(body.payment_method, "payment_method", paymentMethods);
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "payment_batches", request.auth.tenantId, id, values);
      return { entityType: "payment_batch", entityId: id, beforeState: before, afterState: this.withBatchGuidance(after) };
    }, body.reason);
  }

  @Post("payment-batches/:id/items/contractor-payable")
  @RequirePermission("payment_batch.add_item")
  async addContractorPayable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "payment_batch.add_item", "payment_item.created", "payment_item", async (client) => {
      const batch = await this.requireBatch(client, request.auth.tenantId, id);
      this.ensureBatchCanAddItems(batch);
      const hasOverride = this.hasOverride(body);
      if (batch.batch_type !== "contractor_payable" && !(batch.batch_type === "mixed_later" && hasOverride)) throw new BadRequestException("payment batch type does not accept contractor payable items");
      const payable = await this.requireContractorPayable(client, request.auth.tenantId, this.requireText(body.contractor_payable_id, "contractor_payable_id is required"));
      if (payable.status !== "payment_ready" || payable.payment_readiness_status !== "ready_for_payment") throw new BadRequestException("contractor payable must be payment ready");
      if (!["not_paid"].includes(String(payable.payment_status)) && !hasOverride) throw new BadRequestException("contractor payable payment status must be not_paid unless override supplied");
      if ((payable.hold_status === "hold" || payable.dispute_status === "open") && !hasOverride) throw new BadRequestException("held or disputed contractor payable cannot be added without override");
      let payableItem: Row | null = null;
      if (body.contractor_payable_item_id) {
        payableItem = await this.requireContractorPayableItem(client, request.auth.tenantId, String(body.contractor_payable_item_id));
        if (payableItem.contractor_payable_id !== payable.id) throw new BadRequestException("contractor payable item does not belong to contractor payable");
      }
      await this.requireNoDuplicateSource(client, request.auth.tenantId, "contractor_payable", String(payable.id), body.contractor_payable_item_id, hasOverride);
      const amountLimit = Number(payableItem?.net_payable_amount ?? payable.net_payable_amount ?? 0);
      const amount = body.payment_amount === undefined ? amountLimit : this.requirePositive(body.payment_amount, "payment_amount");
      if (amount > amountLimit && !hasOverride) throw new BadRequestException("payment_amount cannot exceed payable amount without override");
      const item = await this.insert(client, "payment_items", {
        tenant_id: request.auth.tenantId,
        payment_batch_id: id,
        source_type: "contractor_payable",
        contractor_payable_id: payable.id,
        contractor_payable_item_id: payableItem?.id,
        ...this.deriveContractorPayee(payable),
        payee_name: this.optionalString(body.payee_name),
        payment_method: batch.payment_method,
        payment_amount: amount,
        currency: batch.currency ?? "USD",
        override_reasons: this.objectValue(body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      const totals = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return {
        entityType: "payment_item",
        entityId: item.id as string,
        afterState: item,
        additionalEvents: [this.additionalEvent("payment_batch.add_item", "payment_batch", id, "payment_batch.item_added", { ...totals, payment_item_id: item.id })],
      };
    });
  }

  @Post("payment-batches/:id/items/payroll-run")
  @RequirePermission("payment_batch.add_item")
  async addPayrollRun(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "payment_batch.add_item", "payment_item.created", "payment_item", async (client) => {
      const batch = await this.requireBatch(client, request.auth.tenantId, id);
      this.ensureBatchCanAddItems(batch);
      const hasOverride = this.hasOverride(body);
      if (batch.batch_type !== "payroll" && !(batch.batch_type === "mixed_later" && hasOverride)) throw new BadRequestException("payment batch type does not accept payroll items");
      const run = await this.requirePayrollRun(client, request.auth.tenantId, this.requireText(body.payroll_run_id, "payroll_run_id is required"));
      if (run.status !== "payroll_ready" || run.payroll_readiness_status !== "ready_for_payroll") throw new BadRequestException("payroll run must be payroll ready");
      if ((run.hold_status === "hold" || run.dispute_status === "open") && !hasOverride) throw new BadRequestException("held or disputed payroll run cannot be added without override");
      const payrollItemId = this.requireText(body.payroll_item_id, "payroll_item_id is required for payroll payment items");
      const payrollItem = await this.requirePayrollItem(client, request.auth.tenantId, payrollItemId);
      if (payrollItem.payroll_run_id !== run.id) throw new BadRequestException("payroll item does not belong to payroll run");
      await this.requireNoDuplicateSource(client, request.auth.tenantId, "payroll", String(run.id), payrollItemId, hasOverride);
      const amountLimit = Number(payrollItem.net_pay_amount ?? 0);
      const amount = body.payment_amount === undefined ? amountLimit : this.requirePositive(body.payment_amount, "payment_amount");
      if (amount > amountLimit && !hasOverride) throw new BadRequestException("payment_amount cannot exceed payroll item amount without override");
      const item = await this.insert(client, "payment_items", {
        tenant_id: request.auth.tenantId,
        payment_batch_id: id,
        source_type: "payroll",
        payroll_run_id: run.id,
        payroll_item_id: payrollItem.id,
        payee_type: "worker",
        worker_id: payrollItem.worker_id,
        payee_name: this.optionalString(body.payee_name),
        payment_method: batch.payment_method,
        payment_amount: amount,
        currency: batch.currency ?? "USD",
        override_reasons: this.objectValue(body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      const totals = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return {
        entityType: "payment_item",
        entityId: item.id as string,
        afterState: item,
        additionalEvents: [this.additionalEvent("payment_batch.add_item", "payment_batch", id, "payment_batch.item_added", { ...totals, payment_item_id: item.id })],
      };
    });
  }

  @Patch("payment-items/:id")
  @RequirePermission("payment_item.update")
  async updateItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "payment_item.update", "payment_item.updated", "payment_item", async (client) => {
      const before = await this.requireItem(client, request.auth.tenantId, id);
      const batch = await this.requireBatch(client, request.auth.tenantId, String(before.payment_batch_id));
      if (["approved", "scheduled", "submitted", "executed_later", "voided", "archived"].includes(String(batch.status))) throw new BadRequestException("payment item cannot be updated after batch approval or execution");
      const values = pick(body, ["payment_date", "payee_name", "notes", "override_reasons"]);
      if (body.payment_amount !== undefined) values.payment_amount = this.requirePositive(body.payment_amount, "payment_amount");
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "payment_items", request.auth.tenantId, id, values);
      await this.recalculateTotals(client, request.auth.tenantId, String(after.payment_batch_id), request.auth.userId);
      return { entityType: "payment_item", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("payment-items/:id/void")
  @RequirePermission("payment_item.void")
  async voidItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.itemTerminalAction(request, id, body, "voided", "payment_item.void", "payment_item.voided", "void_reason", "void_note");
  }

  @Post("payment-items/:id/archive")
  @RequirePermission("payment_item.archive")
  async archiveItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.itemTerminalAction(request, id, body, "archived", "payment_item.archive", "payment_item.archived", "archive_reason", "archive_note");
  }

  @Post("payment-batches/:id/recalculate-totals")
  @RequirePermission("payment_batch.recalculate_totals")
  async recalculateBatchTotals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "payment_batch.recalculate_totals", "payment_batch.totals_recalculated", "payment_batch", async (client) => {
      const before = await this.requireBatch(client, request.auth.tenantId, id);
      const after = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return { entityType: "payment_batch", entityId: id, beforeState: before, afterState: this.withBatchGuidance(after) };
    });
  }

  @Post("payment-batches/:id/submit-review")
  @RequirePermission("payment_batch.submit_review")
  async submitReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.batchStateAction(request, id, "payment_batch.submit_review", "payment_batch.review_submitted", async (batch, client) => {
      if (!["draft", "assembling", "rejected"].includes(String(batch.status))) throw new BadRequestException("payment batch cannot be submitted from its current status");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      return { status: "ready_for_review", approval_status: "pending" };
    });
  }

  @Post("payment-batches/:id/start-review")
  @RequirePermission("payment_batch.start_review")
  async startReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.batchStateAction(request, id, "payment_batch.start_review", "payment_batch.review_started", (batch) => {
      if (batch.status !== "ready_for_review") throw new BadRequestException("payment batch must be ready_for_review");
      return { status: "under_review" };
    });
  }

  @Post("payment-batches/:id/approve")
  @RequirePermission("payment_batch.approve")
  async approveBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.approve", "payment_batch.approved", async (batch, client) => {
      this.requireText(body.approval_note, "approval_note is required");
      const hasOverride = this.hasOverride(body);
      if (!["under_review", "ready_for_review"].includes(String(batch.status))) throw new BadRequestException("payment batch must be under review or ready for review");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      if (Number(batch.total_payment_amount ?? 0) <= 0) throw new BadRequestException("payment batch total must be > 0");
      await this.validateAllItemsReady(client, request.auth.tenantId, id, hasOverride);
      return { status: "approved", approval_status: "approved", execution_status: "ready_for_execution", approved_by: request.auth.userId, approved_at: new Date(), override_reasons: body.override_reasons === undefined ? batch.override_reasons : this.objectValue(body.override_reasons) };
    }, body.approval_note);
  }

  @Post("payment-batches/:id/reject")
  @RequirePermission("payment_batch.reject")
  async rejectBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.reject", "payment_batch.rejected", () => ({
      status: "rejected",
      approval_status: "rejected",
      rejected_by: request.auth.userId,
      rejected_at: new Date(),
      rejection_reason: this.requireText(body.rejection_reason, "rejection_reason is required"),
      rejection_note: this.optionalString(body.rejection_note),
    }), body.rejection_reason);
  }

  @Post("payment-batches/:id/schedule")
  @RequirePermission("payment_batch.schedule")
  async scheduleBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.schedule", "payment_batch.scheduled", (batch) => {
      if (batch.approval_status !== "approved") throw new BadRequestException("payment batch must be approved");
      return { status: "scheduled", scheduled_payment_date: this.requireText(body.scheduled_payment_date, "scheduled_payment_date is required"), notes: this.optionalString(body.schedule_note) ?? batch.notes };
    }, body.schedule_note);
  }

  @Post("payment-batches/:id/submit-execution")
  @RequirePermission("payment_batch.submit_execution")
  async submitExecution(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.submit_execution", "payment_batch.submitted_for_execution", async (batch, client) => {
      this.requireText(body.submit_note, "submit_note is required");
      if (!["approved", "scheduled"].includes(String(batch.status))) throw new BadRequestException("payment batch must be approved or scheduled");
      if (batch.execution_status !== "ready_for_execution") throw new BadRequestException("payment batch is not ready for execution");
      await client.query(
        "UPDATE payment_items SET status = 'submitted_later', execution_status = 'submitted_later', execution_reference = coalesce($3, execution_reference), updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')",
        [request.auth.tenantId, id, this.optionalString(body.external_reference), request.auth.userId],
      );
      return {
        status: "submitted",
        execution_status: "submitted_later",
        submitted_by: request.auth.userId,
        submitted_at: new Date(),
        execution_reference: this.optionalString(body.external_reference) ?? batch.execution_reference,
        notes: this.optionalString(body.submit_note) ?? batch.notes,
      };
    }, body.submit_note);
  }

  @Post("payment-batches/:id/mark-executed")
  @RequirePermission("payment_batch.mark_executed")
  async markExecuted(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.mark_executed", "payment_batch.executed", async (batch, client) => {
      const reference = this.requireText(body.execution_reference, "execution_reference is required");
      this.requireText(body.execution_note, "execution_note is required");
      const hasOverride = this.hasOverride(body);
      if (!["submitted", "approved", "scheduled"].includes(String(batch.status)) || (batch.status !== "submitted" && !hasOverride)) throw new BadRequestException("payment batch must be submitted unless override supplied");
      await client.query(
        "UPDATE payment_items SET status = 'executed_later', execution_status = 'executed_later', execution_reference = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')",
        [request.auth.tenantId, id, reference, request.auth.userId],
      );
      return { status: "executed_later", execution_status: "executed_later", executed_at: body.executed_at ? this.requireText(body.executed_at, "executed_at is invalid") : new Date(), execution_reference: reference, notes: this.optionalString(body.execution_note) ?? batch.notes };
    }, body.execution_note);
  }

  @Post("payment-batches/:id/mark-failed")
  @RequirePermission("payment_batch.mark_failed")
  async markFailed(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.mark_failed", "payment_batch.failed", async (_batch, client) => {
      const reason = this.requireText(body.failure_reason, "failure_reason is required");
      await client.query(
        "UPDATE payment_items SET status = 'failed', execution_status = 'failed', failure_reason = $3, failure_note = $4, updated_by = $5, updated_at = now() WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')",
        [request.auth.tenantId, id, reason, this.optionalString(body.failure_note), request.auth.userId],
      );
      return { status: "failed", execution_status: "failed", failure_reason: reason, failure_note: this.optionalString(body.failure_note) };
    }, body.failure_reason);
  }

  @Post("payment-batches/:id/cancel")
  @RequirePermission("payment_batch.cancel")
  async cancelBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.cancel", "payment_batch.cancelled", (batch) => {
      if (batch.status === "executed_later") throw new BadRequestException("executed payment batch cannot be cancelled");
      return { status: "cancelled", execution_status: "cancelled", cancelled_by: request.auth.userId, cancelled_at: new Date(), cancel_reason: this.requireText(body.cancel_reason, "cancel_reason is required"), cancel_note: this.optionalString(body.cancel_note) };
    }, body.cancel_reason);
  }

  @Post("payment-batches/:id/void")
  @RequirePermission("payment_batch.void")
  async voidBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.void", "payment_batch.voided", (batch) => {
      if (batch.status === "executed_later") throw new BadRequestException("executed payment batch cannot be voided");
      return { status: "voided", voided_by: request.auth.userId, voided_at: new Date(), void_reason: this.requireText(body.void_reason, "void_reason is required"), void_note: this.optionalString(body.void_note) };
    }, body.void_reason);
  }

  @Post("payment-batches/:id/archive")
  @RequirePermission("payment_batch.archive")
  async archiveBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "payment_batch.archive", "payment_batch.archived", () => ({
      status: "archived",
      archived_by: request.auth.userId,
      archived_at: new Date(),
      archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
      archive_note: this.optionalString(body.archive_note),
    }), body.archive_reason);
  }

  @Get("payment-batches/:id/items")
  @RequirePermission("payment_item.read")
  async listItems(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireBatch(client, request.auth.tenantId, id);
      return (await client.query("SELECT * FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, id])).rows;
    });
  }

  @Get("payment-items/:id")
  @RequirePermission("payment_item.read")
  async getItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireItem(client, request.auth.tenantId, id));
  }

  @Get("payment-items/:id/detail")
  @RequirePermission("payment_item.read")
  async getItemDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const item = await this.requireItem(client, request.auth.tenantId, id);
      return {
        item,
        payment_batch_context: await this.requireBatch(client, request.auth.tenantId, String(item.payment_batch_id)),
        contractor_payable_context: item.contractor_payable_id ? await this.optionalRecord(client, "contractor_payables", request.auth.tenantId, item.contractor_payable_id) : null,
        payroll_context: item.payroll_run_id ? await this.optionalRecord(client, "payroll_runs", request.auth.tenantId, item.payroll_run_id) : null,
        payee_context: await this.payeeContext(client, request.auth.tenantId, item),
        execution_summary: { execution_status: item.execution_status, execution_reference: item.execution_reference, failure_reason: item.failure_reason },
        boundary_summary: this.boundarySummary(),
      };
    });
  }

  @Get("payment-batches/:id/timeline")
  @RequirePermission("payment_batch.timeline.read")
  async batchTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireBatch(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2", [request.auth.tenantId, id]);
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
          "payment_batch.created",
          "payment_batch.updated",
          "payment_batch.item_added",
          "payment_batch.totals_recalculated",
          "payment_batch.review_submitted",
          "payment_batch.review_started",
          "payment_batch.approved",
          "payment_batch.rejected",
          "payment_batch.scheduled",
          "payment_batch.submitted_for_execution",
          "payment_batch.executed",
          "payment_batch.failed",
          "payment_batch.cancelled",
          "payment_batch.voided",
          "payment_batch.archived",
          "payment_item.created",
          "payment_item.updated",
          "payment_item.submitted_for_execution",
          "payment_item.executed",
          "payment_item.failed",
          "payment_item.voided",
          "payment_item.archived",
        ]],
      );
      return result.rows;
    });
  }

  @Get("payment-batches/:id/audit-summary")
  @RequirePermission("payment_batch.audit.read")
  async batchAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireBatch(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2", [request.auth.tenantId, id]);
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

  private async batchStateAction(request: AuthenticatedRequest, id: string, action: string, eventType: string, transition: (batch: Row, client: PoolClient) => Promise<Row> | Row, reason?: unknown) {
    return this.write(request, action, eventType, "payment_batch", async (client) => {
      const before = await this.requireBatch(client, request.auth.tenantId, id);
      if (["voided", "archived", "executed_later"].includes(String(before.status)) && !["payment_batch.archive"].includes(action)) throw new BadRequestException("payment batch cannot transition from its current status");
      const values = await transition(before, client);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "payment_batches", request.auth.tenantId, id, values);
      return { entityType: "payment_batch", entityId: id, beforeState: before, afterState: this.withBatchGuidance(after) };
    }, reason);
  }

  private async itemTerminalAction(request: AuthenticatedRequest, id: string, body: Row, status: "voided" | "archived", action: string, eventType: string, reasonField: string, noteField: string) {
    return this.write(request, action, eventType, "payment_item", async (client) => {
      const before = await this.requireItem(client, request.auth.tenantId, id);
      const batch = await this.requireBatch(client, request.auth.tenantId, String(before.payment_batch_id));
      if (["submitted", "executed_later"].includes(String(batch.status))) throw new BadRequestException("payment item cannot be changed after submission or execution");
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
      const after = await this.update(client, "payment_items", request.auth.tenantId, id, values);
      await this.recalculateTotals(client, request.auth.tenantId, String(after.payment_batch_id), request.auth.userId);
      return { entityType: "payment_item", entityId: id, beforeState: before, afterState: after };
    }, body[reasonField]);
  }

  private async batchDetail(client: PoolClient, tenantId: string, userId: string, id: string) {
    const batch = await this.requireBatch(client, tenantId, id);
    const items = (await client.query("SELECT * FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [tenantId, id])).rows;
    return {
      payment_batch: this.withBatchGuidance(batch),
      payment_items: items,
      contractor_payable_context: await this.sourceSummary(client, tenantId, items, "contractor_payable"),
      payroll_context: await this.sourceSummary(client, tenantId, items, "payroll"),
      payee_summary: await this.payeeSummary(client, tenantId, id),
      source_summary: await this.itemBreakdown(client, tenantId, id, "source_type"),
      approval_summary: pick(batch, ["approval_status", "approved_by", "approved_at", "rejected_by", "rejected_at", "rejection_reason", "rejection_note"]),
      execution_summary: pick(batch, ["execution_status", "scheduled_payment_date", "submitted_at", "submitted_by", "executed_at", "execution_reference"]),
      failure_summary: pick(batch, ["failure_reason", "failure_note", "cancel_reason", "cancel_note"]),
      boundary_summary: this.boundarySummary(),
      warnings: this.batchWarnings(batch),
      blockers: this.batchBlockers(batch),
      recommended_next_action: this.recommendedBatchAction(batch, Number(batch.item_count ?? items.length)),
      timeline_available: true,
      audit_allowed: await this.hasPermission(client, tenantId, userId, "payment_batch.audit.read"),
    };
  }

  private async requireBatch(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM payment_batches WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("payment batch not found");
    return result.rows[0] as Row;
  }

  private async requireItem(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM payment_items WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("payment item not found");
    return result.rows[0] as Row;
  }

  private async requireContractorPayable(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query("SELECT * FROM contractor_payables WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("contractor payable not found");
    return result.rows[0] as Row;
  }

  private async requireContractorPayableItem(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query("SELECT * FROM contractor_payable_items WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("contractor payable item not found");
    return result.rows[0] as Row;
  }

  private async requirePayrollRun(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query("SELECT * FROM payroll_runs WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("payroll run not found");
    return result.rows[0] as Row;
  }

  private async requirePayrollItem(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query("SELECT * FROM payroll_items WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("payroll item not found");
    return result.rows[0] as Row;
  }

  private async requireNoDuplicateSource(client: PoolClient, tenantId: string, sourceType: string, sourceId: string, itemId: unknown, hasOverride: boolean) {
    if (hasOverride) return;
    const column = sourceType === "contractor_payable" ? "contractor_payable_id" : "payroll_run_id";
    const itemColumn = sourceType === "contractor_payable" ? "contractor_payable_item_id" : "payroll_item_id";
    const result = await client.query(
      `
      SELECT id
      FROM payment_items
      WHERE tenant_id = $1 AND source_type = $2 AND ${column} = $3
        AND ($4::uuid IS NULL OR ${itemColumn} = $4::uuid)
        AND deleted_at IS NULL AND status NOT IN ('voided', 'archived', 'cancelled')
      LIMIT 1
      `,
      [tenantId, sourceType, sourceId, itemId ?? null],
    );
    if (result.rows[0]) throw new BadRequestException("duplicate active payment item for source is not allowed without override");
  }

  private async requireActiveItemCount(client: PoolClient, tenantId: string, batchId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')", [tenantId, batchId]);
    if (Number(result.rows[0]?.count ?? 0) <= 0) throw new BadRequestException("payment batch requires at least one active item");
  }

  private async validateAllItemsReady(client: PoolClient, tenantId: string, batchId: string, hasOverride: boolean) {
    const items = await client.query("SELECT * FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')", [tenantId, batchId]);
    for (const item of items.rows) {
      if (Number(item.payment_amount ?? 0) <= 0) throw new BadRequestException("payment item amount must be > 0");
      if (item.source_type === "contractor_payable") {
        const payable = await this.requireContractorPayable(client, tenantId, String(item.contractor_payable_id));
        if (payable.status !== "payment_ready" || payable.payment_readiness_status !== "ready_for_payment") throw new BadRequestException("all contractor payable sources must remain payment ready");
        if ((payable.hold_status === "hold" || payable.dispute_status === "open") && !hasOverride) throw new BadRequestException("source hold/dispute blocks payment approval without override");
      }
      if (item.source_type === "payroll") {
        const run = await this.requirePayrollRun(client, tenantId, String(item.payroll_run_id));
        if (run.status !== "payroll_ready" || run.payroll_readiness_status !== "ready_for_payroll") throw new BadRequestException("all payroll sources must remain payroll ready");
        if ((run.hold_status === "hold" || run.dispute_status === "open") && !hasOverride) throw new BadRequestException("source hold/dispute blocks payment approval without override");
      }
    }
  }

  private async recalculateTotals(client: PoolClient, tenantId: string, batchId: string, userId: string) {
    const totals = await client.query(
      `
      SELECT
        count(*)::int AS item_count,
        coalesce(sum(payment_amount), 0)::numeric AS total_payment_amount
      FROM payment_items
      WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')
      `,
      [tenantId, batchId],
    );
    return this.update(client, "payment_batches", tenantId, batchId, { ...totals.rows[0], updated_by: userId, updated_at: new Date() });
  }

  private deriveContractorPayee(payable: Row) {
    if (payable.payable_party_type === "capacity_provider") return { payee_type: "capacity_provider", capacity_provider_id: payable.capacity_provider_id };
    if (payable.payable_party_type === "crew") return { payee_type: "crew", crew_id: payable.crew_id };
    if (payable.payable_party_type === "worker_later") return { payee_type: "worker", worker_id: payable.worker_id };
    if (payable.payable_party_type === "vendor_later") return { payee_type: "vendor_later", vendor_organization_id: payable.vendor_organization_id };
    return { payee_type: "internal_self_perform" };
  }

  private withBatchGuidance(row: Row) {
    return {
      ...row,
      warnings: this.batchWarnings(row),
      blockers: this.batchBlockers(row),
      recommended_next_action: this.recommendedBatchAction(row, Number(row.item_count ?? 0)),
    };
  }

  private batchWarnings(row: Row) {
    const warnings: string[] = [];
    if (row.payment_method !== "manual") warnings.push("external_payment_method_status_only");
    if (row.status === "submitted") warnings.push("submitted_status_only_no_external_money_movement");
    if (row.status === "executed_later") warnings.push("executed_later_requires_future_bank_reconciliation");
    return warnings;
  }

  private batchBlockers(row: Row) {
    const blockers: string[] = [];
    if (Number(row.total_payment_amount ?? 0) <= 0) blockers.push("total_payment_amount_not_positive");
    if (row.status === "failed") blockers.push("payment_batch_failed");
    if (row.status === "cancelled") blockers.push("payment_batch_cancelled");
    return blockers;
  }

  private recommendedBatchAction(row: Row, itemCount: number) {
    if (row.status === "archived") return "view_only";
    if (row.status === "voided") return "view_voided_batch";
    if (row.status === "cancelled") return "view_cancelled_batch";
    if (row.status === "failed") return "review_failure";
    if (itemCount <= 0) return "add_payment_items";
    if (row.approval_status === "not_submitted") return "submit_for_review";
    if (row.approval_status === "pending" && row.status === "ready_for_review") return "start_review";
    if (row.status === "under_review") return "approve_or_reject";
    if (row.status === "approved" && row.execution_status === "ready_for_execution") return "schedule_or_submit_execution";
    if (row.status === "scheduled") return "submit_execution_when_ready";
    if (row.status === "submitted") return "mark_executed_or_failed";
    if (row.status === "executed_later") return "wait_for_future_bank_reconciliation";
    return "continue_payment_review";
  }

  private boundarySummary() {
    return {
      creates_ach: false,
      creates_card_payout: false,
      prints_check: false,
      submits_payroll_provider: false,
      creates_bank_transaction: false,
      creates_tax_filing: false,
      creates_accounting_export: false,
      creates_bank_reconciliation: false,
      creates_real_money_movement: false,
    };
  }

  private batchOrder(sort?: string) {
    if (sort === "scheduled_date_asc") return "pb.scheduled_payment_date ASC NULLS LAST, pb.updated_at DESC";
    if (sort === "executed_date_desc") return "pb.executed_at DESC NULLS LAST, pb.updated_at DESC";
    if (sort === "amount_desc") return "pb.total_payment_amount DESC, pb.updated_at DESC";
    if (sort === "status") return "pb.status ASC, pb.updated_at DESC";
    if (sort === "payment_batch_number") return "pb.payment_batch_number ASC";
    return "pb.updated_at DESC";
  }

  private ensureBatchEditable(batch: Row) {
    if (["submitted", "executed_later", "partially_executed_later", "voided", "archived"].includes(String(batch.status))) throw new BadRequestException("payment batch cannot be updated in its current status");
  }

  private ensureBatchCanAddItems(batch: Row) {
    if (["approved", "scheduled", "submitted", "executed_later", "voided", "archived", "cancelled"].includes(String(batch.status))) throw new BadRequestException("payment items cannot be added in current batch status");
  }

  private async sourceSummary(client: PoolClient, tenantId: string, items: Row[], sourceType: string) {
    const ids = [...new Set(items.filter((item) => item.source_type === sourceType).map((item) => sourceType === "contractor_payable" ? item.contractor_payable_id : item.payroll_run_id).filter(Boolean))];
    if (!ids.length) return [];
    const table = sourceType === "contractor_payable" ? "contractor_payables" : "payroll_runs";
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
    return result.rows;
  }

  private async payeeSummary(client: PoolClient, tenantId: string, batchId: string) {
    const result = await client.query(
      "SELECT payee_type, count(*)::int AS item_count, coalesce(sum(payment_amount), 0)::numeric AS total_payment_amount FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived') GROUP BY payee_type ORDER BY payee_type",
      [tenantId, batchId],
    );
    return result.rows;
  }

  private async itemBreakdown(client: PoolClient, tenantId: string, batchId: string, field: string) {
    const result = await client.query(
      `SELECT ${field} AS key, count(*)::int AS count, coalesce(sum(payment_amount), 0)::numeric AS total_payment_amount FROM payment_items WHERE tenant_id = $1 AND payment_batch_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived') GROUP BY ${field} ORDER BY ${field}`,
      [tenantId, batchId],
    );
    return result.rows;
  }

  private async payeeContext(client: PoolClient, tenantId: string, item: Row) {
    if (item.payee_type === "capacity_provider") return this.optionalRecord(client, "capacity_providers", tenantId, item.capacity_provider_id);
    if (item.payee_type === "crew") return this.optionalRecord(client, "crews", tenantId, item.crew_id);
    if (item.payee_type === "worker") return this.optionalRecord(client, "workers", tenantId, item.worker_id);
    if (item.payee_type === "vendor_later") return this.optionalRecord(client, "organizations", tenantId, item.vendor_organization_id);
    return { type: "internal_self_perform" };
  }

  private async nextBatchNumber(client: PoolClient, tenantId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await client.query("SELECT count(*)::int + 1 AS next FROM payment_batches WHERE tenant_id = $1", [tenantId]);
      const candidate = `PB-${String(Number(result.rows[0].next) + attempt).padStart(6, "0")}`;
      const existing = await client.query("SELECT 1 FROM payment_batches WHERE tenant_id = $1 AND payment_batch_number = $2", [tenantId, candidate]);
      if (!existing.rows[0]) return candidate;
    }
    throw new BadRequestException("could not allocate payment batch number");
  }

  private async insert(client: PoolClient, table: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    const placeholders = keys.map((_, index) => `$${index + 1}`);
    const result = await client.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`, keys.map((key) => values[key]));
    return result.rows[0] as Row;
  }

  private async update(client: PoolClient, table: string, tenantId: string, id: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    if (keys.length === 0) return table === "payment_batches" ? this.requireBatch(client, tenantId, id) : this.requireItem(client, tenantId, id);
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

  private requirePositive(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new BadRequestException(`${field} must be > 0`);
    return parsed;
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>, reason?: unknown) {
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
