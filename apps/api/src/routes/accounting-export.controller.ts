import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const exportTypes = new Set(["invoices", "cash_receipts", "payment_applications", "contractor_payables", "payroll", "payment_execution", "bank_reconciliation", "mixed_later", "correction", "reversal"]);
const targetSystems = new Set(["quickbooks_later", "sage_later", "netsuite_later", "generic_csv", "generic_json", "manual_export", "other"]);
const exportFormats = new Set(["csv", "json", "manual_summary", "api_payload_later", "iif_later"]);
const batchStatuses = new Set(["draft", "assembling", "ready_for_review", "under_review", "approved", "generated", "submitted_later", "accepted_later", "rejected_later", "failed", "cancelled", "archived"]);
const approvalStatuses = new Set(["not_submitted", "pending", "approved", "rejected", "withdrawn"]);
const exportStatuses = new Set(["not_generated", "generated", "submitted_later", "accepted_later", "rejected_later", "failed", "cancelled"]);
const sourceObjectTypes = new Set(["invoice", "invoice_item", "cash_receipt", "payment_application", "contractor_payable", "contractor_payable_item", "payroll_run", "payroll_item", "payment_batch", "payment_item", "bank_transaction", "reconciliation_match"]);
const exportItemTypes = new Set(["revenue", "receivable", "cash_receipt", "unapplied_cash", "payable", "payroll_expense", "payment", "bank_transaction", "reconciliation", "fee", "adjustment", "correction", "reversal"]);
const mappingStatuses = new Set(["unmapped", "mapped", "mapping_warning", "mapping_error", "override_mapped"]);

type Row = Record<string, unknown>;

@Controller()
export class AccountingExportController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("accounting-export-batches")
  @RequirePermission("accounting_export_batch.read")
  async listBatches(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["aeb.tenant_id = $1", "aeb.deleted_at IS NULL"];
      if (query.archived !== "true") where.push("aeb.status <> 'archived'");
      this.addFilter(where, values, "aeb.export_type", query.export_type);
      this.addFilter(where, values, "aeb.target_system", query.target_system);
      this.addFilter(where, values, "aeb.export_format", query.export_format);
      this.addFilter(where, values, "aeb.status", query.status);
      this.addFilter(where, values, "aeb.approval_status", query.approval_status);
      this.addFilter(where, values, "aeb.export_status", query.export_status);
      this.addDateFilter(where, values, "aeb.period_start", ">=", query.period_start);
      this.addDateFilter(where, values, "aeb.period_end", "<=", query.period_end);
      this.addDateFilter(where, values, "aeb.submitted_at", ">=", query.submitted_from);
      this.addDateFilter(where, values, "aeb.submitted_at", "<=", query.submitted_to);
      this.addDateFilter(where, values, "aeb.accepted_at", ">=", query.accepted_from);
      this.addDateFilter(where, values, "aeb.accepted_at", "<=", query.accepted_to);
      if (query.q) {
        values.push(`%${query.q}%`);
        where.push(`(aeb.export_batch_number ILIKE $${values.length} OR aeb.target_system ILIKE $${values.length} OR aeb.export_format ILIKE $${values.length} OR aeb.external_batch_reference ILIKE $${values.length} OR aeb.failure_reason ILIKE $${values.length} OR aeb.notes ILIKE $${values.length})`);
      }
      const result = await client.query(
        `SELECT aeb.*
         FROM accounting_export_batches aeb
         WHERE ${where.join(" AND ")}
         ORDER BY ${this.batchOrder(query.sort)}
         LIMIT 250`,
        values,
      );
      return result.rows.map((row) => this.withBatchGuidance(row));
    });
  }

  @Get("accounting-export-batches/:id")
  @RequirePermission("accounting_export_batch.read")
  async getBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireBatch(client, request.auth.tenantId, id));
  }

  @Get("accounting-export-batches/:id/detail")
  @RequirePermission("accounting_export_batch.read")
  async getBatchDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => this.batchDetail(client, request.auth.tenantId, request.auth.userId, id));
  }

  @Post("accounting-export-batches")
  @RequirePermission("accounting_export_batch.create")
  async createBatch(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "accounting_export_batch.create", "accounting_export_batch.created", "accounting_export_batch", async (client) => {
      const periodStart = this.optionalString(body.period_start);
      const periodEnd = this.optionalString(body.period_end);
      if (periodStart && periodEnd && periodStart > periodEnd) throw new BadRequestException("period_start must be <= period_end");
      const batch = await this.insert(client, "accounting_export_batches", {
        tenant_id: request.auth.tenantId,
        export_batch_number: await this.nextBatchNumber(client, request.auth.tenantId),
        export_type: this.allowed(body.export_type, "export_type", exportTypes),
        target_system: this.allowed(body.target_system, "target_system", targetSystems),
        export_format: this.allowed(body.export_format, "export_format", exportFormats),
        period_start: periodStart,
        period_end: periodEnd,
        currency: this.optionalString(body.currency),
        notes: this.optionalString(body.notes),
        override_reasons: this.objectValue(body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "accounting_export_batch", entityId: batch.id as string, afterState: this.withBatchGuidance(batch) };
    });
  }

  @Patch("accounting-export-batches/:id")
  @RequirePermission("accounting_export_batch.update")
  async updateBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "accounting_export_batch.update", "accounting_export_batch.updated", "accounting_export_batch", async (client) => {
      const before = await this.requireBatch(client, request.auth.tenantId, id);
      this.ensureBatchEditable(before);
      const values = pick(body, ["period_start", "period_end", "currency", "notes"]);
      if (body.target_system !== undefined) values.target_system = this.allowed(body.target_system, "target_system", targetSystems);
      if (body.export_format !== undefined) values.export_format = this.allowed(body.export_format, "export_format", exportFormats);
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      const periodStart = values.period_start ?? before.period_start;
      const periodEnd = values.period_end ?? before.period_end;
      if (periodStart && periodEnd && String(periodStart) > String(periodEnd)) throw new BadRequestException("period_start must be <= period_end");
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "accounting_export_batches", request.auth.tenantId, id, values);
      return { entityType: "accounting_export_batch", entityId: id, beforeState: before, afterState: this.withBatchGuidance(after) };
    });
  }

  @Post("accounting-export-batches/:id/items")
  @RequirePermission("accounting_export_batch.add_item")
  async addItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "accounting_export_batch.add_item", "accounting_export_item.created", "accounting_export_item", async (client) => {
      const batch = await this.requireBatch(client, request.auth.tenantId, id);
      this.ensureBatchCanAddItems(batch);
      const sourceObjectType = this.allowed(body.source_object_type, "source_object_type", sourceObjectTypes);
      const exportItemType = this.allowed(body.export_item_type, "export_item_type", exportItemTypes);
      const hasOverride = this.hasOverride(body);
      this.validateExportTypeCompatibility(String(batch.export_type), sourceObjectType, hasOverride);
      const source = await this.requireSource(client, request.auth.tenantId, sourceObjectType, this.requireText(body.source_object_id, "source_object_id is required"));
      await this.requireNoDuplicateSource(client, request.auth.tenantId, sourceObjectType, String(source.id), hasOverride);
      this.validateSourceEligibility(sourceObjectType, source, hasOverride);
      const mappingStatus = body.mapping_status === undefined ? this.calculateMappingStatus(body, hasOverride) : this.allowed(body.mapping_status, "mapping_status", mappingStatuses);
      const item = await this.insert(client, "accounting_export_items", {
        tenant_id: request.auth.tenantId,
        accounting_export_batch_id: id,
        source_object_type: sourceObjectType,
        source_object_id: source.id,
        ...this.sourceReference(sourceObjectType, source),
        export_item_type: exportItemType,
        mapping_status: mappingStatus,
        target_account_code: this.optionalString(body.target_account_code),
        target_account_name: this.optionalString(body.target_account_name),
        target_entity_reference: this.optionalString(body.target_entity_reference),
        target_item_reference: this.optionalString(body.target_item_reference),
        target_class_reference: this.optionalString(body.target_class_reference),
        target_location_reference: this.optionalString(body.target_location_reference),
        debit_amount: this.optionalNonNegative(body.debit_amount, "debit_amount"),
        credit_amount: this.optionalNonNegative(body.credit_amount, "credit_amount"),
        amount: this.optionalNonNegative(body.amount, "amount") ?? this.deriveAmount(sourceObjectType, source),
        currency: this.optionalString(body.currency) ?? String(batch.currency ?? source.currency ?? "USD"),
        memo: this.optionalString(body.memo),
        transaction_date: this.optionalString(body.transaction_date) ?? this.deriveTransactionDate(sourceObjectType, source),
        override_reasons: this.objectValue(body.override_reasons),
        notes: this.optionalString(body.notes),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      const totals = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return {
        entityType: "accounting_export_item",
        entityId: item.id as string,
        afterState: item,
        additionalEvents: [this.additionalEvent("accounting_export_batch.add_item", "accounting_export_batch", id, "accounting_export_batch.item_added", { ...totals, accounting_export_item_id: item.id })],
      };
    });
  }

  @Patch("accounting-export-items/:id")
  @RequirePermission("accounting_export_item.update")
  async updateItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "accounting_export_item.update", "accounting_export_item.updated", "accounting_export_item", async (client) => {
      const before = await this.requireItem(client, request.auth.tenantId, id);
      const batch = await this.requireBatch(client, request.auth.tenantId, String(before.accounting_export_batch_id));
      this.ensureBatchEditable(batch);
      const values = pick(body, ["target_account_code", "target_account_name", "target_entity_reference", "target_item_reference", "target_class_reference", "target_location_reference", "memo", "transaction_date", "error_message", "notes"]);
      if (body.debit_amount !== undefined) values.debit_amount = this.optionalNonNegative(body.debit_amount, "debit_amount");
      if (body.credit_amount !== undefined) values.credit_amount = this.optionalNonNegative(body.credit_amount, "credit_amount");
      if (body.amount !== undefined) values.amount = this.optionalNonNegative(body.amount, "amount");
      if (body.currency !== undefined) values.currency = this.requireText(body.currency, "currency is required");
      if (body.mapping_status !== undefined) values.mapping_status = this.allowed(body.mapping_status, "mapping_status", mappingStatuses);
      else values.mapping_status = this.calculateMappingStatus({ ...before, ...values }, this.hasOverride(body) || Object.keys(this.objectValue(before.override_reasons)).length > 0);
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "accounting_export_items", request.auth.tenantId, id, values);
      await this.recalculateTotals(client, request.auth.tenantId, String(after.accounting_export_batch_id), request.auth.userId);
      return { entityType: "accounting_export_item", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("accounting-export-items/:id/archive")
  @RequirePermission("accounting_export_item.archive")
  async archiveItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "accounting_export_item.archive", "accounting_export_item.archived", "accounting_export_item", async (client) => {
      const before = await this.requireItem(client, request.auth.tenantId, id);
      const batch = await this.requireBatch(client, request.auth.tenantId, String(before.accounting_export_batch_id));
      this.ensureBatchEditable(batch);
      const after = await this.update(client, "accounting_export_items", request.auth.tenantId, id, {
        export_status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
        archive_note: this.optionalString(body.archive_note),
        updated_by: request.auth.userId,
        updated_at: new Date(),
      });
      await this.recalculateTotals(client, request.auth.tenantId, String(after.accounting_export_batch_id), request.auth.userId);
      return { entityType: "accounting_export_item", entityId: id, beforeState: before, afterState: after };
    }, body.archive_reason);
  }

  @Post("accounting-export-batches/:id/recalculate-totals")
  @RequirePermission("accounting_export_batch.update")
  async recalculateBatchTotals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "accounting_export_batch.update", "accounting_export_batch.totals_recalculated", "accounting_export_batch", async (client) => {
      const before = await this.requireBatch(client, request.auth.tenantId, id);
      const after = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return { entityType: "accounting_export_batch", entityId: id, beforeState: before, afterState: this.withBatchGuidance(after) };
    });
  }

  @Post("accounting-export-batches/:id/generate")
  @RequirePermission("accounting_export_batch.generate")
  async generateBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.generate", "accounting_export_batch.generated", async (batch, client) => {
      this.requireText(body.generate_note, "generate_note is required");
      const hasOverride = this.hasOverride(body);
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      if (!["draft", "assembling", "approved", "failed", "cancelled"].includes(String(batch.status))) throw new BadRequestException("accounting export batch cannot be generated from current status");
      await this.validateGenerationReadiness(client, request.auth.tenantId, id, hasOverride);
      return {
        status: "generated",
        export_status: "generated",
        override_reasons: body.override_reasons === undefined ? batch.override_reasons : this.objectValue(body.override_reasons),
        notes: this.optionalString(body.generate_note) ?? batch.notes,
      };
    }, body.generate_note);
  }

  @Post("accounting-export-batches/:id/submit-review")
  @RequirePermission("accounting_export_batch.submit_review")
  async submitReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.submit_review", "accounting_export_batch.review_submitted", async (batch, client) => {
      const hasOverride = this.hasOverride(body);
      if (!["draft", "assembling", "generated", "rejected_later", "failed"].includes(String(batch.status))) throw new BadRequestException("accounting export batch cannot be submitted from current status");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      await this.validateGenerationReadiness(client, request.auth.tenantId, id, hasOverride);
      return { status: "ready_for_review", approval_status: "pending", override_reasons: body.override_reasons === undefined ? batch.override_reasons : this.objectValue(body.override_reasons) };
    });
  }

  @Post("accounting-export-batches/:id/start-review")
  @RequirePermission("accounting_export_batch.start_review")
  async startReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.batchStateAction(request, id, "accounting_export_batch.start_review", "accounting_export_batch.review_started", (batch) => {
      if (batch.status !== "ready_for_review") throw new BadRequestException("accounting export batch must be ready_for_review");
      return { status: "under_review" };
    });
  }

  @Post("accounting-export-batches/:id/approve")
  @RequirePermission("accounting_export_batch.approve")
  async approveBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.approve", "accounting_export_batch.approved", async (batch, client) => {
      this.requireText(body.approval_note, "approval_note is required");
      const hasOverride = this.hasOverride(body);
      if (!["under_review", "ready_for_review"].includes(String(batch.status))) throw new BadRequestException("accounting export batch must be under review or ready for review");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      await this.validateGenerationReadiness(client, request.auth.tenantId, id, hasOverride);
      return {
        status: "approved",
        approval_status: "approved",
        approved_by: request.auth.userId,
        approved_at: new Date(),
        override_reasons: body.override_reasons === undefined ? batch.override_reasons : this.objectValue(body.override_reasons),
      };
    }, body.approval_note);
  }

  @Post("accounting-export-batches/:id/reject")
  @RequirePermission("accounting_export_batch.reject")
  async rejectBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.reject", "accounting_export_batch.rejected", () => ({
      status: "rejected_later",
      approval_status: "rejected",
      rejected_by: request.auth.userId,
      rejected_at: new Date(),
      rejection_reason: this.requireText(body.rejection_reason, "rejection_reason is required"),
      rejection_note: this.optionalString(body.rejection_note),
    }), body.rejection_reason);
  }

  @Post("accounting-export-batches/:id/mark-submitted")
  @RequirePermission("accounting_export_batch.mark_submitted")
  async markSubmitted(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.mark_submitted", "accounting_export_batch.submitted", (batch) => {
      const reference = this.optionalString(body.external_batch_reference);
      const note = this.optionalString(body.submit_note);
      if (!reference && !note) throw new BadRequestException("external_batch_reference or submit_note is required");
      const hasOverride = this.hasOverride(body);
      if (!["approved", "generated"].includes(String(batch.status)) && !hasOverride) throw new BadRequestException("accounting export batch must be approved or generated unless override supplied");
      return {
        status: "submitted_later",
        export_status: "submitted_later",
        submitted_by: request.auth.userId,
        submitted_at: body.submitted_at ? this.requireText(body.submitted_at, "submitted_at is invalid") : new Date(),
        external_batch_reference: reference ?? batch.external_batch_reference,
        notes: note ?? batch.notes,
      };
    }, body.submit_note ?? body.external_batch_reference);
  }

  @Post("accounting-export-batches/:id/mark-accepted")
  @RequirePermission("accounting_export_batch.mark_accepted")
  async markAccepted(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.mark_accepted", "accounting_export_batch.accepted", (batch) => {
      this.requireText(body.acceptance_note, "acceptance_note is required");
      const hasOverride = this.hasOverride(body);
      if (batch.status !== "submitted_later" && !hasOverride) throw new BadRequestException("accounting export batch must be submitted_later unless override supplied");
      return {
        status: "accepted_later",
        export_status: "accepted_later",
        accepted_by: request.auth.userId,
        accepted_at: body.accepted_at ? this.requireText(body.accepted_at, "accepted_at is invalid") : new Date(),
        external_batch_reference: this.optionalString(body.external_batch_reference) ?? batch.external_batch_reference,
        notes: this.optionalString(body.acceptance_note) ?? batch.notes,
      };
    }, body.acceptance_note);
  }

  @Post("accounting-export-batches/:id/mark-failed")
  @RequirePermission("accounting_export_batch.mark_failed")
  async markFailed(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.mark_failed", "accounting_export_batch.failed", (batch) => ({
      status: "failed",
      export_status: "failed",
      failure_reason: this.requireText(body.failure_reason, "failure_reason is required"),
      failure_note: this.optionalString(body.failure_note),
      retry_count: Number(batch.retry_count ?? 0) + 1,
    }), body.failure_reason);
  }

  @Post("accounting-export-batches/:id/cancel")
  @RequirePermission("accounting_export_batch.cancel")
  async cancelBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.cancel", "accounting_export_batch.cancelled", (batch) => {
      if (batch.status === "accepted_later" && !this.hasOverride(body)) throw new BadRequestException("accepted accounting export batch cannot be cancelled without override");
      return {
        status: "cancelled",
        export_status: "cancelled",
        cancelled_by: request.auth.userId,
        cancelled_at: new Date(),
        cancel_reason: this.requireText(body.cancel_reason, "cancel_reason is required"),
        cancel_note: this.optionalString(body.cancel_note),
      };
    }, body.cancel_reason);
  }

  @Post("accounting-export-batches/:id/archive")
  @RequirePermission("accounting_export_batch.archive")
  async archiveBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.batchStateAction(request, id, "accounting_export_batch.archive", "accounting_export_batch.archived", () => ({
      status: "archived",
      archived_by: request.auth.userId,
      archived_at: new Date(),
      archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
      archive_note: this.optionalString(body.archive_note),
    }), body.archive_reason);
  }

  @Get("accounting-export-batches/:id/items")
  @RequirePermission("accounting_export_item.read")
  async listItems(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireBatch(client, request.auth.tenantId, id);
      return (await client.query("SELECT * FROM accounting_export_items WHERE tenant_id = $1 AND accounting_export_batch_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, id])).rows;
    });
  }

  @Get("accounting-export-items/:id")
  @RequirePermission("accounting_export_item.read")
  async getItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireItem(client, request.auth.tenantId, id));
  }

  @Get("accounting-export-items/:id/detail")
  @RequirePermission("accounting_export_item.read")
  async getItemDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const item = await this.requireItem(client, request.auth.tenantId, id);
      return {
        accounting_export_item: item,
        batch_context: await this.requireBatch(client, request.auth.tenantId, String(item.accounting_export_batch_id)),
        source_context: await this.sourceContext(client, request.auth.tenantId, item),
        mapping_context: pick(item, ["mapping_status", "target_account_code", "target_account_name", "target_entity_reference", "target_item_reference", "target_class_reference", "target_location_reference"]),
        export_status_context: pick(item, ["export_status", "external_reference"]),
        error_context: pick(item, ["error_message"]),
        boundary_summary: this.boundarySummary(),
      };
    });
  }

  @Get("accounting-export-batches/:id/timeline")
  @RequirePermission("accounting_export_batch.timeline.read")
  async batchTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireBatch(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM accounting_export_items WHERE tenant_id = $1 AND accounting_export_batch_id = $2", [request.auth.tenantId, id]);
      const ids = [id, ...itemIds.rows.map((row) => row.id)];
      const result = await client.query(
        `SELECT id, event_type, aggregate_type AS object_type, aggregate_id AS object_id, actor_user_id AS actor, created_at AS timestamp, audit_context AS summary
         FROM events
         WHERE tenant_id = $1 AND aggregate_id = ANY($2::uuid[])
         ORDER BY created_at DESC
         LIMIT 250`,
        [request.auth.tenantId, ids],
      );
      return result.rows;
    });
  }

  @Get("accounting-export-batches/:id/audit-summary")
  @RequirePermission("accounting_export_batch.audit.read")
  async batchAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireBatch(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM accounting_export_items WHERE tenant_id = $1 AND accounting_export_batch_id = $2", [request.auth.tenantId, id]);
      const ids = [id, ...itemIds.rows.map((row) => row.id)];
      const result = await client.query(
        "SELECT id, actor_user_id AS actor, action, entity_type AS object, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id FROM audit_logs WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[]) ORDER BY created_at DESC LIMIT 250",
        [request.auth.tenantId, ids],
      );
      return result.rows;
    });
  }

  private async batchStateAction(request: AuthenticatedRequest, id: string, action: string, eventType: string, transition: (batch: Row, client: PoolClient) => Promise<Row> | Row, reason?: unknown) {
    return this.write(request, action, eventType, "accounting_export_batch", async (client) => {
      const before = await this.requireBatch(client, request.auth.tenantId, id);
      if (["archived", "accepted_later"].includes(String(before.status)) && !["accounting_export_batch.archive"].includes(action)) throw new BadRequestException("accounting export batch cannot transition from current status");
      const values = await transition(before, client);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "accounting_export_batches", request.auth.tenantId, id, values);
      return { entityType: "accounting_export_batch", entityId: id, beforeState: before, afterState: this.withBatchGuidance(after) };
    }, reason);
  }

  private async batchDetail(client: PoolClient, tenantId: string, userId: string, id: string) {
    const batch = await this.requireBatch(client, tenantId, id);
    const items = (await client.query("SELECT * FROM accounting_export_items WHERE tenant_id = $1 AND accounting_export_batch_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [tenantId, id])).rows;
    return {
      accounting_export_batch: this.withBatchGuidance(batch),
      accounting_export_items: items,
      source_summary: await this.itemBreakdown(client, tenantId, id, "source_object_type"),
      mapping_summary: await this.itemBreakdown(client, tenantId, id, "mapping_status"),
      export_summary: await this.itemBreakdown(client, tenantId, id, "export_status"),
      error_summary: { error_count: batch.error_count, failed_items: items.filter((item) => item.export_status === "failed" || item.mapping_status === "mapping_error").length },
      approval_summary: pick(batch, ["approval_status", "rejected_by", "rejected_at", "rejection_reason", "rejection_note"]),
      boundary_summary: this.boundarySummary(),
      warnings: this.batchWarnings(batch),
      blockers: this.batchBlockers(batch),
      recommended_next_action: this.recommendedBatchAction(batch),
      timeline_available: true,
      audit_allowed: await this.hasPermission(client, tenantId, userId, "accounting_export_batch.audit.read"),
    };
  }

  private async requireBatch(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM accounting_export_batches WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("accounting export batch not found");
    return result.rows[0] as Row;
  }

  private async requireItem(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM accounting_export_items WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("accounting export item not found");
    return result.rows[0] as Row;
  }

  private async requireSource(client: PoolClient, tenantId: string, sourceObjectType: string, id: string) {
    const table = this.sourceTable(sourceObjectType);
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("source object not found");
    return result.rows[0] as Row;
  }

  private sourceTable(sourceObjectType: string) {
    const tables: Record<string, string> = {
      invoice: "invoices",
      invoice_item: "invoice_items",
      cash_receipt: "cash_receipts",
      payment_application: "payment_applications",
      contractor_payable: "contractor_payables",
      contractor_payable_item: "contractor_payable_items",
      payroll_run: "payroll_runs",
      payroll_item: "payroll_items",
      payment_batch: "payment_batches",
      payment_item: "payment_items",
      bank_transaction: "bank_transactions",
      reconciliation_match: "reconciliation_matches",
    };
    return tables[sourceObjectType];
  }

  private async requireNoDuplicateSource(client: PoolClient, tenantId: string, sourceObjectType: string, sourceObjectId: string, hasOverride: boolean) {
    if (hasOverride) return;
    const result = await client.query(
      "SELECT id FROM accounting_export_items WHERE tenant_id = $1 AND source_object_type = $2 AND source_object_id = $3 AND deleted_at IS NULL AND export_status NOT IN ('archived', 'cancelled') LIMIT 1",
      [tenantId, sourceObjectType, sourceObjectId],
    );
    if (result.rows[0]) throw new BadRequestException("duplicate active export item for source is not allowed without override");
  }

  private validateExportTypeCompatibility(exportType: string, sourceObjectType: string, hasOverride: boolean) {
    if (["mixed_later", "correction", "reversal"].includes(exportType) || hasOverride) return;
    const compatible: Record<string, string[]> = {
      invoices: ["invoice", "invoice_item"],
      cash_receipts: ["cash_receipt"],
      payment_applications: ["payment_application"],
      contractor_payables: ["contractor_payable", "contractor_payable_item"],
      payroll: ["payroll_run", "payroll_item"],
      payment_execution: ["payment_batch", "payment_item"],
      bank_reconciliation: ["bank_transaction", "reconciliation_match"],
    };
    if (!compatible[exportType]?.includes(sourceObjectType)) throw new BadRequestException("source object type does not match export type without override");
  }

  private validateSourceEligibility(sourceObjectType: string, source: Row, hasOverride: boolean) {
    if (hasOverride) return;
    if (sourceObjectType === "invoice" && !["approved", "sent", "ready_for_cash_application"].includes(String(source.status))) throw new BadRequestException("invoice source must be approved or sent unless override supplied");
    if (sourceObjectType === "contractor_payable" && !["approved", "payment_ready"].includes(String(source.status))) throw new BadRequestException("contractor payable source must be approved or payment_ready unless override supplied");
    if (sourceObjectType === "payroll_run" && !["approved", "payroll_ready"].includes(String(source.status))) throw new BadRequestException("payroll source must be approved or payroll_ready unless override supplied");
    if (sourceObjectType === "payment_batch" && !["submitted", "executed_later", "accepted_later"].includes(String(source.status))) throw new BadRequestException("payment batch source must be submitted or executed_later unless override supplied");
    if (sourceObjectType === "payment_item" && !["submitted_later", "executed_later"].includes(String(source.status))) throw new BadRequestException("payment item source must be submitted_later or executed_later unless override supplied");
    if (sourceObjectType === "bank_transaction" && source.exception_status === "open") throw new BadRequestException("bank transaction with open exception cannot be exported without override");
    if (sourceObjectType === "reconciliation_match" && source.match_status !== "approved") throw new BadRequestException("reconciliation match must be approved unless override supplied");
  }

  private sourceReference(sourceObjectType: string, source: Row) {
    const values: Row = {};
    if (sourceObjectType === "invoice") values.invoice_id = source.id;
    if (sourceObjectType === "invoice_item") values.invoice_item_id = source.id;
    if (sourceObjectType === "cash_receipt") values.cash_receipt_id = source.id;
    if (sourceObjectType === "payment_application") values.payment_application_id = source.id;
    if (sourceObjectType === "contractor_payable") values.contractor_payable_id = source.id;
    if (sourceObjectType === "contractor_payable_item") values.contractor_payable_item_id = source.id;
    if (sourceObjectType === "payroll_run") values.payroll_run_id = source.id;
    if (sourceObjectType === "payroll_item") values.payroll_item_id = source.id;
    if (sourceObjectType === "payment_batch") values.payment_batch_id = source.id;
    if (sourceObjectType === "payment_item") values.payment_item_id = source.id;
    if (sourceObjectType === "bank_transaction") values.bank_transaction_id = source.id;
    if (sourceObjectType === "reconciliation_match") values.reconciliation_match_id = source.id;
    return values;
  }

  private deriveAmount(sourceObjectType: string, source: Row) {
    const amountFields: Record<string, string[]> = {
      invoice: ["total_amount", "original_amount"],
      invoice_item: ["net_amount", "gross_amount"],
      cash_receipt: ["gross_received_amount", "applied_amount"],
      payment_application: ["applied_amount"],
      contractor_payable: ["net_payable_amount"],
      contractor_payable_item: ["net_payable_amount"],
      payroll_run: ["net_pay_amount"],
      payroll_item: ["net_pay_amount"],
      payment_batch: ["total_payment_amount"],
      payment_item: ["payment_amount"],
      bank_transaction: ["amount"],
      reconciliation_match: ["matched_amount"],
    };
    for (const field of amountFields[sourceObjectType] ?? []) {
      if (source[field] !== undefined && source[field] !== null) return Number(source[field]);
    }
    return undefined;
  }

  private deriveTransactionDate(sourceObjectType: string, source: Row) {
    const dateFields: Record<string, string[]> = {
      invoice: ["invoice_date", "created_at"],
      invoice_item: ["created_at"],
      cash_receipt: ["receipt_date", "created_at"],
      payment_application: ["application_date", "created_at"],
      contractor_payable: ["approved_at", "created_at"],
      contractor_payable_item: ["work_date", "created_at"],
      payroll_run: ["pay_date", "payroll_period_end", "created_at"],
      payroll_item: ["work_date", "created_at"],
      payment_batch: ["executed_at", "scheduled_payment_date", "created_at"],
      payment_item: ["payment_date", "created_at"],
      bank_transaction: ["posted_date", "transaction_date"],
      reconciliation_match: ["approved_at", "created_at"],
    };
    for (const field of dateFields[sourceObjectType] ?? []) {
      if (source[field] instanceof Date) return source[field].toISOString().slice(0, 10);
      if (source[field]) return String(source[field]).slice(0, 10);
    }
    return undefined;
  }

  private calculateMappingStatus(body: Row, hasOverride: boolean) {
    if (hasOverride) return "override_mapped";
    const account = this.optionalString(body.target_account_code) || this.optionalString(body.target_account_name);
    const entity = this.optionalString(body.target_entity_reference);
    if (account && entity) return "mapped";
    if (account || entity) return "mapping_warning";
    return "unmapped";
  }

  private async requireActiveItemCount(client: PoolClient, tenantId: string, batchId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM accounting_export_items WHERE tenant_id = $1 AND accounting_export_batch_id = $2 AND deleted_at IS NULL AND export_status <> 'archived'", [tenantId, batchId]);
    if (Number(result.rows[0]?.count ?? 0) <= 0) throw new BadRequestException("accounting export batch requires at least one active item");
  }

  private async validateGenerationReadiness(client: PoolClient, tenantId: string, batchId: string, hasOverride: boolean) {
    if (hasOverride) return;
    const result = await client.query(
      "SELECT mapping_status, export_status FROM accounting_export_items WHERE tenant_id = $1 AND accounting_export_batch_id = $2 AND deleted_at IS NULL AND export_status <> 'archived'",
      [tenantId, batchId],
    );
    if (result.rows.some((row) => row.mapping_status === "mapping_error" || row.mapping_status === "unmapped")) throw new BadRequestException("missing mappings block export generation unless override supplied");
    if (result.rows.some((row) => row.export_status === "failed")) throw new BadRequestException("failed export items block generation unless override supplied");
  }

  private async recalculateTotals(client: PoolClient, tenantId: string, batchId: string, userId: string) {
    const totals = await client.query(
      `SELECT
        count(*)::int AS item_count,
        coalesce(sum(debit_amount), 0)::numeric AS total_debit_amount,
        coalesce(sum(credit_amount), 0)::numeric AS total_credit_amount,
        coalesce(sum(coalesce(amount, debit_amount, credit_amount, 0)), 0)::numeric AS total_amount,
        count(*) FILTER (WHERE mapping_status = 'mapping_error' OR export_status = 'failed')::int AS error_count
       FROM accounting_export_items
       WHERE tenant_id = $1 AND accounting_export_batch_id = $2 AND deleted_at IS NULL AND export_status <> 'archived'`,
      [tenantId, batchId],
    );
    return this.update(client, "accounting_export_batches", tenantId, batchId, { ...totals.rows[0], updated_by: userId, updated_at: new Date() });
  }

  private async itemBreakdown(client: PoolClient, tenantId: string, batchId: string, field: string) {
    const result = await client.query(
      `SELECT ${field} AS key, count(*)::int AS count, coalesce(sum(coalesce(amount, debit_amount, credit_amount, 0)), 0)::numeric AS total_amount
       FROM accounting_export_items
       WHERE tenant_id = $1 AND accounting_export_batch_id = $2 AND deleted_at IS NULL AND export_status <> 'archived'
       GROUP BY ${field}
       ORDER BY ${field}`,
      [tenantId, batchId],
    );
    return result.rows;
  }

  private async sourceContext(client: PoolClient, tenantId: string, item: Row) {
    return this.optionalRecord(client, this.sourceTable(String(item.source_object_type)), tenantId, item.source_object_id);
  }

  private withBatchGuidance(row: Row) {
    return { ...row, warnings: this.batchWarnings(row), blockers: this.batchBlockers(row), recommended_next_action: this.recommendedBatchAction(row) };
  }

  private batchWarnings(row: Row) {
    const warnings: string[] = [];
    if (["quickbooks_later", "sage_later", "netsuite_later"].includes(String(row.target_system))) warnings.push("external_accounting_system_label_only_no_api_submission");
    if (["api_payload_later", "iif_later"].includes(String(row.export_format))) warnings.push("export_format_is_future_scope_label_only");
    if (row.export_status === "submitted_later") warnings.push("submitted_later_is_manual_status_only");
    if (row.export_status === "accepted_later") warnings.push("accepted_later_is_manual_status_only");
    return warnings;
  }

  private batchBlockers(row: Row) {
    const blockers: string[] = [];
    if (Number(row.item_count ?? 0) <= 0) blockers.push("no_export_items");
    if (Number(row.error_count ?? 0) > 0) blockers.push("export_errors_present");
    if (row.status === "failed") blockers.push("export_failed");
    if (row.status === "cancelled") blockers.push("export_cancelled");
    return blockers;
  }

  private recommendedBatchAction(row: Row) {
    if (row.status === "archived") return "view_only";
    if (row.status === "cancelled") return "view_cancelled_export";
    if (row.status === "failed") return "review_failure_or_retry";
    if (Number(row.item_count ?? 0) <= 0) return "add_export_items";
    if (Number(row.error_count ?? 0) > 0) return "fix_mapping_errors";
    if (row.export_status === "not_generated") return "generate_export";
    if (row.approval_status === "not_submitted") return "submit_for_review";
    if (row.approval_status === "pending" && row.status === "ready_for_review") return "start_review";
    if (row.status === "under_review") return "approve_or_reject";
    if (["approved", "generated"].includes(String(row.status))) return "mark_submitted_when_external_action_done";
    if (row.status === "submitted_later") return "mark_accepted_or_failed";
    if (row.status === "accepted_later") return "archive_when_ready";
    return "continue_export_review";
  }

  private boundarySummary() {
    return {
      calls_quickbooks_api: false,
      calls_erp_api: false,
      creates_gl_entry: false,
      posts_journal: false,
      creates_tax_filing: false,
      generates_w2: false,
      generates_1099: false,
      closes_accounting_period: false,
      creates_payment: false,
      creates_bank_transaction: false,
      mutates_source_financial_fact: false,
      generates_file_download: false,
    };
  }

  private batchOrder(sort?: string) {
    if (sort === "period_end_desc") return "aeb.period_end DESC NULLS LAST, aeb.updated_at DESC";
    if (sort === "amount_desc") return "aeb.total_amount DESC NULLS LAST, aeb.updated_at DESC";
    if (sort === "status") return "aeb.status ASC, aeb.updated_at DESC";
    if (sort === "export_batch_number") return "aeb.export_batch_number ASC";
    return "aeb.updated_at DESC";
  }

  private ensureBatchEditable(batch: Row) {
    if (["submitted_later", "accepted_later", "archived"].includes(String(batch.status))) throw new BadRequestException("accounting export batch cannot be updated in current status");
  }

  private ensureBatchCanAddItems(batch: Row) {
    if (["submitted_later", "accepted_later", "cancelled", "archived"].includes(String(batch.status))) throw new BadRequestException("accounting export items cannot be added in current batch status");
  }

  private async nextBatchNumber(client: PoolClient, tenantId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await client.query("SELECT count(*)::int + 1 AS next FROM accounting_export_batches WHERE tenant_id = $1", [tenantId]);
      const candidate = `AEX-${String(Number(result.rows[0].next) + attempt).padStart(6, "0")}`;
      const existing = await client.query("SELECT 1 FROM accounting_export_batches WHERE tenant_id = $1 AND export_batch_number = $2", [tenantId, candidate]);
      if (!existing.rows[0]) return candidate;
    }
    throw new BadRequestException("could not allocate accounting export batch number");
  }

  private async insert(client: PoolClient, table: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    const result = await client.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`, keys.map((key) => values[key]));
    return result.rows[0] as Row;
  }

  private async update(client: PoolClient, table: string, tenantId: string, id: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    if (!keys.length) return table === "accounting_export_batches" ? this.requireBatch(client, tenantId, id) : this.requireItem(client, tenantId, id);
    const result = await client.query(`UPDATE ${table} SET ${keys.map((key, index) => `${key} = $${index + 3}`).join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING *`, [tenantId, id, ...keys.map((key) => values[key])]);
    if (!result.rows[0]) throw new NotFoundException("record not found");
    return result.rows[0] as Row;
  }

  private addFilter(where: string[], values: unknown[], column: string, value?: string) {
    if (!value) return;
    values.push(value);
    where.push(`${column} = $${values.length}`);
  }

  private addDateFilter(where: string[], values: unknown[], column: string, operator: string, value?: string) {
    if (!value) return;
    values.push(value);
    where.push(`${column} ${operator} $${values.length}`);
  }

  private async optionalRecord(client: PoolClient, table: string, tenantId: string, id: unknown) {
    if (!id) return null;
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    return result.rows[0] ?? null;
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

  private optionalNonNegative(value: unknown, field: string) {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new BadRequestException(`${field} must be >= 0`);
    return parsed;
  }

  private objectValue(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return {};
  }

  private hasOverride(body: Row) {
    return Object.keys(this.objectValue(body.override_reasons)).length > 0;
  }

  private async hasPermission(client: PoolClient, tenantId: string, userId: string, permission: string) {
    const result = await client.query(
      `SELECT 1
       FROM tenant_users tu
       JOIN user_roles ur ON ur.tenant_user_id = tu.id AND ur.tenant_id = tu.tenant_id
       JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.tenant_id = tu.tenant_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND p.key = $3
       LIMIT 1`,
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
