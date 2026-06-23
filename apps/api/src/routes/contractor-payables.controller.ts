import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const payableTypes = new Set(["subcontractor", "crew", "worker_later", "vendor_later", "internal_self_perform", "adjustment", "retainage_release", "chargeback"]);
const payablePartyTypes = new Set(["capacity_provider", "crew", "worker_later", "vendor_later", "internal_self_perform"]);
const payableStatuses = new Set(["draft", "assembling", "ready_for_review", "under_review", "approved", "rejected", "held", "disputed", "payment_ready", "payment_created_later", "partially_paid_later", "paid_later", "voided", "archived"]);
const approvalStatuses = new Set(["not_submitted", "pending", "approved", "rejected", "withdrawn"]);
const readinessStatuses = new Set(["not_ready", "ready_with_warning", "ready_for_payment", "blocked"]);
const paymentStatuses = new Set(["not_paid", "partially_paid_later", "paid_later", "held", "disputed"]);
const complianceStatuses = new Set(["unknown", "missing", "incomplete", "ready", "expired", "blocked"]);
const taxDocumentStatuses = new Set(["unknown", "missing_w9", "ready", "expired", "blocked"]);
const disputeStatuses = new Set(["none", "open", "under_review", "resolved", "rejected"]);
const holdStatuses = new Set(["none", "hold", "released"]);
const payableItemTypes = new Set(["labor", "subcontractor_production", "equipment", "material_reimbursement", "retainage_hold", "retainage_release", "deduction", "chargeback", "adjustment", "correction", "bonus", "penalty"]);
const payableItemStatuses = new Set(["draft", "ready", "approved", "held", "disputed", "payment_ready", "payment_created_later", "voided", "archived"]);

type Row = Record<string, unknown>;

@Controller()
export class ContractorPayablesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("contractor-payables")
  @RequirePermission("contractor_payable.read")
  async listPayables(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["cp.tenant_id = $1"];
      if (query.archived !== "true") where.push("cp.deleted_at IS NULL", "cp.status <> 'archived'");
      this.addFilter(where, values, "cp.payable_type", query.payable_type);
      this.addFilter(where, values, "cp.payable_party_type", query.payable_party_type);
      this.addFilter(where, values, "cp.status", query.status);
      this.addFilter(where, values, "cp.approval_status", query.approval_status);
      this.addFilter(where, values, "cp.payment_readiness_status", query.payment_readiness_status);
      this.addFilter(where, values, "cp.payment_status", query.payment_status);
      this.addFilter(where, values, "cp.capacity_provider_id", query.capacity_provider_id);
      this.addFilter(where, values, "cp.crew_id", query.crew_id);
      this.addFilter(where, values, "cp.project_id", query.project_id);
      this.addFilter(where, values, "cp.settlement_id", query.settlement_id);
      this.addFilter(where, values, "cp.compliance_status", query.compliance_status);
      this.addFilter(where, values, "cp.tax_document_status", query.tax_document_status);
      this.addFilter(where, values, "cp.dispute_status", query.dispute_status);
      this.addFilter(where, values, "cp.hold_status", query.hold_status);
      if (query.pay_cycle_start) {
        values.push(query.pay_cycle_start);
        where.push(`cp.pay_cycle_start >= $${values.length}`);
      }
      if (query.pay_cycle_end) {
        values.push(query.pay_cycle_end);
        where.push(`cp.pay_cycle_end <= $${values.length}`);
      }
      if (query.due_date_from) {
        values.push(query.due_date_from);
        where.push(`cp.due_date >= $${values.length}`);
      }
      if (query.due_date_to) {
        values.push(query.due_date_to);
        where.push(`cp.due_date <= $${values.length}`);
      }
      if (query.q) {
        values.push(`%${query.q}%`);
        where.push(`(cp.payable_number ILIKE $${values.length} OR provider.name ILIKE $${values.length} OR crew.name ILIKE $${values.length} OR project.name ILIKE $${values.length} OR settlement.settlement_number ILIKE $${values.length} OR cp.hold_reason ILIKE $${values.length} OR cp.dispute_reason ILIKE $${values.length})`);
      }
      const order = this.payableOrder(query.sort);
      const result = await client.query(
        `
        SELECT cp.*,
          provider.name AS capacity_provider_name,
          crew.name AS crew_name,
          project.name AS project_name,
          settlement.settlement_number,
          count(cpi.id) FILTER (WHERE cpi.deleted_at IS NULL AND cpi.status NOT IN ('voided', 'archived'))::int AS item_count
        FROM contractor_payables cp
        LEFT JOIN capacity_providers provider ON provider.tenant_id = cp.tenant_id AND provider.id = cp.capacity_provider_id
        LEFT JOIN crews crew ON crew.tenant_id = cp.tenant_id AND crew.id = cp.crew_id
        LEFT JOIN projects project ON project.tenant_id = cp.tenant_id AND project.id = cp.project_id
        LEFT JOIN settlements settlement ON settlement.tenant_id = cp.tenant_id AND settlement.id = cp.settlement_id
        LEFT JOIN contractor_payable_items cpi ON cpi.tenant_id = cp.tenant_id AND cpi.contractor_payable_id = cp.id
        WHERE ${where.join(" AND ")}
        GROUP BY cp.id, provider.name, crew.name, project.name, settlement.settlement_number
        ORDER BY ${order}
        LIMIT 250
        `,
        values,
      );
      return result.rows.map((row) => this.withPayableGuidance(row));
    });
  }

  @Get("contractor-payables/:id")
  @RequirePermission("contractor_payable.read")
  async getPayable(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requirePayable(client, request.auth.tenantId, id));
  }

  @Get("contractor-payables/:id/detail")
  @RequirePermission("contractor_payable.read")
  async getPayableDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => this.payableDetail(client, request.auth.tenantId, request.auth.userId, id));
  }

  @Post("contractor-payables")
  @RequirePermission("contractor_payable.create")
  async createPayable(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "contractor_payable.create", "contractor_payable.created", "contractor_payable", async (client) => {
      const payableType = this.allowed(body.payable_type, "payable_type", payableTypes);
      const partyType = this.allowed(body.payable_party_type, "payable_party_type", payablePartyTypes);
      await this.validatePayableParty(client, request.auth.tenantId, partyType, body);
      if (body.settlement_id) await this.requireRecord(client, "settlements", request.auth.tenantId, String(body.settlement_id), "settlement not found");
      if (body.project_id) await this.requireRecord(client, "projects", request.auth.tenantId, String(body.project_id), "project not found");
      const values = {
        tenant_id: request.auth.tenantId,
        payable_number: await this.nextPayableNumber(client, request.auth.tenantId),
        payable_type: payableType,
        payable_party_type: partyType,
        capacity_provider_id: this.optionalString(body.capacity_provider_id),
        crew_id: this.optionalString(body.crew_id),
        worker_id: this.optionalString(body.worker_id),
        vendor_organization_id: this.optionalString(body.vendor_organization_id),
        project_id: this.optionalString(body.project_id),
        settlement_id: this.optionalString(body.settlement_id),
        pay_cycle_start: this.optionalString(body.pay_cycle_start),
        pay_cycle_end: this.optionalString(body.pay_cycle_end),
        due_date: this.optionalString(body.due_date),
        compliance_status: body.compliance_status === undefined ? "unknown" : this.allowed(body.compliance_status, "compliance_status", complianceStatuses),
        tax_document_status: body.tax_document_status === undefined ? "unknown" : this.allowed(body.tax_document_status, "tax_document_status", taxDocumentStatuses),
        override_reasons: this.objectValue(body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      };
      const payable = await this.insert(client, "contractor_payables", values);
      return { entityType: "contractor_payable", entityId: payable.id as string, afterState: this.withPayableGuidance(payable) };
    });
  }

  @Patch("contractor-payables/:id")
  @RequirePermission("contractor_payable.update")
  async updatePayable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "contractor_payable.update", "contractor_payable.updated", "contractor_payable", async (client) => {
      const before = await this.requirePayable(client, request.auth.tenantId, id);
      if (["voided", "archived", "payment_created_later", "paid_later", "partially_paid_later"].includes(String(before.status))) throw new BadRequestException("contractor payable cannot be updated in its current status");
      const values = pick(body, ["pay_cycle_start", "pay_cycle_end", "due_date", "hold_note", "dispute_note", "override_reasons"]);
      if (body.compliance_status !== undefined) values.compliance_status = this.allowed(body.compliance_status, "compliance_status", complianceStatuses);
      if (body.tax_document_status !== undefined) values.tax_document_status = this.allowed(body.tax_document_status, "tax_document_status", taxDocumentStatuses);
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "contractor_payables", request.auth.tenantId, id, values);
      return { entityType: "contractor_payable", entityId: id, beforeState: before, afterState: this.withPayableGuidance(after) };
    }, body.reason);
  }

  @Post("contractor-payables/:id/items")
  @RequirePermission("contractor_payable.add_item")
  async addPayableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "contractor_payable.add_item", "contractor_payable_item.created", "contractor_payable_item", async (client) => {
      const payable = await this.requirePayable(client, request.auth.tenantId, id);
      this.ensurePayableEditableForItems(payable);
      const settlementItem = await this.requireSettlementItem(client, request.auth.tenantId, this.requireText(body.settlement_item_id, "settlement_item_id is required"));
      const hasOverride = this.hasOverride(body);
      if (settlementItem.status !== "payable_ready" && settlementItem.settlement_payable_ready !== true && !hasOverride) throw new BadRequestException("settlement item must be payable ready");
      if (settlementItem.item_type === "customer_billable" && !hasOverride) throw new BadRequestException("customer_billable-only settlement item cannot become contractor payable item without override");
      if (Number(settlementItem.contractor_payable_amount ?? 0) <= 0 && Number(settlementItem.contractor_rate ?? 0) <= 0 && body.contractor_rate === undefined && !hasOverride) throw new BadRequestException("settlement item is missing contractor payable amount or contractor rate");
      await this.requireNoDuplicateSettlementItem(client, request.auth.tenantId, String(settlementItem.id), hasOverride);
      this.validatePayablePartyMatches(payable, settlementItem, hasOverride);
      const itemValues = this.deriveItemValues(request.auth.tenantId, request.auth.userId, payable, settlementItem, body, hasOverride);
      const item = await this.insert(client, "contractor_payable_items", itemValues);
      const totals = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return {
        entityType: "contractor_payable_item",
        entityId: item.id as string,
        afterState: item,
        additionalEvents: [this.additionalEvent("contractor_payable.add_item", "contractor_payable", id, "contractor_payable.item_added", { ...totals, contractor_payable_item_id: item.id })],
      };
    });
  }

  @Patch("contractor-payable-items/:id")
  @RequirePermission("contractor_payable_item.update")
  async updatePayableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "contractor_payable_item.update", "contractor_payable_item.updated", "contractor_payable_item", async (client) => {
      const before = await this.requirePayableItem(client, request.auth.tenantId, id);
      const payable = await this.requirePayable(client, request.auth.tenantId, String(before.contractor_payable_id));
      if (["approved", "payment_ready", "payment_created_later", "voided", "archived"].includes(String(payable.status))) throw new BadRequestException("contractor payable item cannot be updated after approval or payment readiness");
      const values = pick(body, ["description", "override_reasons"]);
      if (body.quantity !== undefined) values.quantity = this.requirePositive(body.quantity, "quantity");
      if (body.contractor_rate !== undefined) values.contractor_rate = this.requireNonNegative(body.contractor_rate, "contractor_rate");
      if (body.deduction_amount !== undefined) values.deduction_amount = this.requireNonNegative(body.deduction_amount, "deduction_amount");
      if (body.chargeback_amount !== undefined) values.chargeback_amount = this.requireNonNegative(body.chargeback_amount, "chargeback_amount");
      if (body.retainage_percent !== undefined) values.retainage_percent = this.requireNonNegative(body.retainage_percent, "retainage_percent");
      if (body.compliance_status !== undefined) values.compliance_status = this.allowed(body.compliance_status, "compliance_status", complianceStatuses);
      if (body.tax_document_status !== undefined) values.tax_document_status = this.allowed(body.tax_document_status, "tax_document_status", taxDocumentStatuses);
      if (body.override_reasons !== undefined) values.override_reasons = this.objectValue(body.override_reasons);
      const quantity = Number(values.quantity ?? before.quantity ?? 0);
      const rate = Number(values.contractor_rate ?? before.contractor_rate ?? 0);
      values.gross_payable_amount = this.roundMoney(quantity * rate);
      values.retainage_amount = values.retainage_percent !== undefined ? this.roundMoney(Number(values.gross_payable_amount) * Number(values.retainage_percent) / 100) : before.retainage_amount;
      values.net_payable_amount = this.roundMoney(Number(values.gross_payable_amount) - Number(values.deduction_amount ?? before.deduction_amount ?? 0) - Number(values.chargeback_amount ?? before.chargeback_amount ?? 0) - Number(values.retainage_amount ?? before.retainage_amount ?? 0));
      if (Number(values.net_payable_amount) < 0 && !["adjustment", "chargeback", "deduction", "penalty"].includes(String(before.item_type))) throw new BadRequestException("net payable amount cannot be negative for this item type");
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "contractor_payable_items", request.auth.tenantId, id, values);
      await this.recalculateTotals(client, request.auth.tenantId, String(after.contractor_payable_id), request.auth.userId);
      return { entityType: "contractor_payable_item", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("contractor-payable-items/:id/void")
  @RequirePermission("contractor_payable_item.void")
  async voidPayableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.itemTerminalAction(request, id, body, "voided", "contractor_payable_item.void", "contractor_payable_item.voided", "void_reason", "void_note");
  }

  @Post("contractor-payable-items/:id/archive")
  @RequirePermission("contractor_payable_item.archive")
  async archivePayableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.itemTerminalAction(request, id, body, "archived", "contractor_payable_item.archive", "contractor_payable_item.archived", "archive_reason", "archive_note");
  }

  @Post("contractor-payables/:id/recalculate-totals")
  @RequirePermission("contractor_payable.recalculate_totals")
  async recalculatePayableTotals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "contractor_payable.recalculate_totals", "contractor_payable.totals_recalculated", "contractor_payable", async (client) => {
      const before = await this.requirePayable(client, request.auth.tenantId, id);
      const after = await this.recalculateTotals(client, request.auth.tenantId, id, request.auth.userId);
      return { entityType: "contractor_payable", entityId: id, beforeState: before, afterState: this.withPayableGuidance(after) };
    });
  }

  @Post("contractor-payables/:id/submit-review")
  @RequirePermission("contractor_payable.submit_review")
  async submitReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.payableStateAction(request, id, "contractor_payable.submit_review", "contractor_payable.review_submitted", async (payable, client) => {
      if (!["draft", "assembling", "rejected"].includes(String(payable.status))) throw new BadRequestException("payable cannot be submitted from its current status");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      return { status: "ready_for_review", approval_status: "pending" };
    });
  }

  @Post("contractor-payables/:id/start-review")
  @RequirePermission("contractor_payable.start_review")
  async startReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.payableStateAction(request, id, "contractor_payable.start_review", "contractor_payable.review_started", (payable) => {
      if (payable.status !== "ready_for_review") throw new BadRequestException("payable must be ready_for_review");
      return { status: "under_review" };
    });
  }

  @Post("contractor-payables/:id/approve")
  @RequirePermission("contractor_payable.approve")
  async approvePayable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.approve", "contractor_payable.approved", async (payable, client) => {
      this.requireText(body.approval_note, "approval_note is required");
      const hasOverride = this.hasOverride(body);
      if (!["under_review", "ready_for_review"].includes(String(payable.status))) throw new BadRequestException("payable must be under review or ready for review");
      await this.requireActiveItemCount(client, request.auth.tenantId, id);
      if (Number(payable.net_payable_amount ?? 0) <= 0) throw new BadRequestException("net payable amount must be > 0");
      if (payable.compliance_status !== "ready" && !hasOverride) throw new BadRequestException("compliance must be ready unless override supplied");
      if (payable.tax_document_status !== "ready" && !hasOverride) throw new BadRequestException("tax documents must be ready unless override supplied");
      if (payable.hold_status === "hold" && !hasOverride) throw new BadRequestException("held payable cannot be approved without override");
      if (payable.dispute_status === "open" && !hasOverride) throw new BadRequestException("disputed payable cannot be approved without override");
      return { status: "approved", approval_status: "approved", approved_by: request.auth.userId, approved_at: new Date(), override_reasons: body.override_reasons === undefined ? payable.override_reasons : this.objectValue(body.override_reasons) };
    }, body.approval_note);
  }

  @Post("contractor-payables/:id/reject")
  @RequirePermission("contractor_payable.reject")
  async rejectPayable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.reject", "contractor_payable.rejected", () => ({
      status: "rejected",
      approval_status: "rejected",
      rejected_by: request.auth.userId,
      rejected_at: new Date(),
      rejection_reason: this.requireText(body.rejection_reason, "rejection_reason is required"),
      rejection_note: this.optionalString(body.rejection_note),
    }), body.rejection_reason);
  }

  @Post("contractor-payables/:id/mark-payment-ready")
  @RequirePermission("contractor_payable.mark_payment_ready")
  async markPaymentReady(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.mark_payment_ready", "contractor_payable.payment_ready", async (payable, client) => {
      this.requireText(body.ready_note, "ready_note is required");
      const hasOverride = this.hasOverride(body);
      if (payable.approval_status !== "approved") throw new BadRequestException("payable must be approved");
      if (Number(payable.net_payable_amount ?? 0) <= 0) throw new BadRequestException("net payable amount must be > 0");
      if (payable.compliance_status !== "ready" && !hasOverride) throw new BadRequestException("compliance must be ready unless override supplied");
      if (payable.tax_document_status !== "ready" && !hasOverride) throw new BadRequestException("tax documents must be ready unless override supplied");
      if (payable.hold_status === "hold") throw new BadRequestException("held payable cannot be marked payment ready");
      if (payable.dispute_status === "open") throw new BadRequestException("disputed payable cannot be marked payment ready");
      const linked = await client.query("SELECT id FROM contractor_payable_items WHERE tenant_id = $1 AND contractor_payable_id = $2 AND payment_item_id IS NOT NULL AND deleted_at IS NULL LIMIT 1", [request.auth.tenantId, id]);
      if (linked.rows[0]) throw new BadRequestException("payable item is already linked to a future payment item");
      return { status: "payment_ready", payment_readiness_status: "ready_for_payment", payment_status: "not_paid", override_reasons: body.override_reasons === undefined ? payable.override_reasons : this.objectValue(body.override_reasons) };
    }, body.ready_note);
  }

  @Post("contractor-payables/:id/place-hold")
  @RequirePermission("contractor_payable.place_hold")
  async placeHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.place_hold", "contractor_payable.held", () => ({
      status: "held",
      hold_status: "hold",
      payment_readiness_status: "blocked",
      payment_status: "held",
      hold_reason: this.requireText(body.hold_reason, "hold_reason is required"),
      hold_note: this.optionalString(body.hold_note),
    }), body.hold_reason);
  }

  @Post("contractor-payables/:id/release-hold")
  @RequirePermission("contractor_payable.release_hold")
  async releaseHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.release_hold", "contractor_payable.hold_released", (payable) => {
      this.requireText(body.release_note, "release_note is required");
      return { hold_status: "released", status: payable.approval_status === "approved" ? "approved" : "draft", payment_readiness_status: "not_ready", payment_status: "not_paid", hold_note: body.release_note };
    }, body.release_note);
  }

  @Post("contractor-payables/:id/dispute")
  @RequirePermission("contractor_payable.dispute")
  async disputePayable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.dispute", "contractor_payable.disputed", () => ({
      status: "disputed",
      dispute_status: "open",
      payment_readiness_status: "blocked",
      payment_status: "disputed",
      dispute_reason: this.requireText(body.dispute_reason, "dispute_reason is required"),
      dispute_note: this.optionalString(body.dispute_note),
    }), body.dispute_reason);
  }

  @Post("contractor-payables/:id/resolve-dispute")
  @RequirePermission("contractor_payable.resolve_dispute")
  async resolveDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.resolve_dispute", "contractor_payable.dispute_resolved", (payable) => {
      this.requireText(body.resolution_note, "resolution_note is required");
      return { dispute_status: "resolved", status: payable.approval_status === "approved" ? "approved" : "draft", payment_readiness_status: "not_ready", payment_status: "not_paid", dispute_note: body.resolution_note, override_reasons: body.override_reasons === undefined ? payable.override_reasons : this.objectValue(body.override_reasons) };
    }, body.resolution_note);
  }

  @Post("contractor-payables/:id/void")
  @RequirePermission("contractor_payable.void")
  async voidPayable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.void", "contractor_payable.voided", async (_payable, client) => {
      this.requireText(body.void_reason, "void_reason is required");
      const linked = await client.query("SELECT id FROM contractor_payable_items WHERE tenant_id = $1 AND contractor_payable_id = $2 AND payment_item_id IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('voided', 'archived') LIMIT 1", [request.auth.tenantId, id]);
      if (linked.rows[0]) throw new BadRequestException("payable with payment item links cannot be voided");
      return { status: "voided", voided_by: request.auth.userId, voided_at: new Date(), void_reason: body.void_reason, void_note: this.optionalString(body.void_note) };
    }, body.void_reason);
  }

  @Post("contractor-payables/:id/archive")
  @RequirePermission("contractor_payable.archive")
  async archivePayable(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.payableStateAction(request, id, "contractor_payable.archive", "contractor_payable.archived", () => ({
      status: "archived",
      archived_by: request.auth.userId,
      archived_at: new Date(),
      archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
      archive_note: this.optionalString(body.archive_note),
    }), body.archive_reason);
  }

  @Get("contractor-payables/:id/items")
  @RequirePermission("contractor_payable_item.read")
  async listPayableItems(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePayable(client, request.auth.tenantId, id);
      return (await client.query("SELECT * FROM contractor_payable_items WHERE tenant_id = $1 AND contractor_payable_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [request.auth.tenantId, id])).rows;
    });
  }

  @Get("contractor-payable-items/:id")
  @RequirePermission("contractor_payable_item.read")
  async getPayableItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requirePayableItem(client, request.auth.tenantId, id));
  }

  @Get("contractor-payable-items/:id/detail")
  @RequirePermission("contractor_payable_item.read")
  async getPayableItemDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const item = await this.requirePayableItem(client, request.auth.tenantId, id);
      return {
        item,
        contractor_payable_context: await this.requirePayable(client, request.auth.tenantId, String(item.contractor_payable_id)),
        settlement_context: await this.optionalRecord(client, "settlements", request.auth.tenantId, item.settlement_id),
        settlement_item_context: await this.optionalRecord(client, "settlement_items", request.auth.tenantId, item.settlement_item_id),
        billable_context: await this.optionalRecord(client, "billable_items", request.auth.tenantId, item.billable_item_id),
        qc_context: await this.optionalRecord(client, "qc_reviews", request.auth.tenantId, item.qc_review_id),
        production_context: await this.optionalRecord(client, "production_records", request.auth.tenantId, item.production_record_id),
        work_order_context: await this.optionalRecord(client, "work_orders", request.auth.tenantId, item.work_order_id),
        project_context: await this.optionalRecord(client, "projects", request.auth.tenantId, item.project_id),
        provider_context: await this.optionalRecord(client, "capacity_providers", request.auth.tenantId, item.capacity_provider_id),
        crew_context: await this.optionalRecord(client, "crews", request.auth.tenantId, item.crew_id),
        financial_breakdown: {
          gross_payable_amount: item.gross_payable_amount,
          deduction_amount: item.deduction_amount,
          chargeback_amount: item.chargeback_amount,
          retainage_amount: item.retainage_amount,
          net_payable_amount: item.net_payable_amount,
        },
      };
    });
  }

  @Get("contractor-payables/:id/timeline")
  @RequirePermission("contractor_payable.timeline.read")
  async payableTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePayable(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM contractor_payable_items WHERE tenant_id = $1 AND contractor_payable_id = $2", [request.auth.tenantId, id]);
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
          "contractor_payable.created",
          "contractor_payable.updated",
          "contractor_payable.item_added",
          "contractor_payable.item_removed",
          "contractor_payable.totals_recalculated",
          "contractor_payable.review_submitted",
          "contractor_payable.review_started",
          "contractor_payable.approved",
          "contractor_payable.rejected",
          "contractor_payable.payment_ready",
          "contractor_payable.held",
          "contractor_payable.hold_released",
          "contractor_payable.disputed",
          "contractor_payable.dispute_resolved",
          "contractor_payable.voided",
          "contractor_payable.archived",
          "contractor_payable_item.created",
          "contractor_payable_item.updated",
          "contractor_payable_item.voided",
          "contractor_payable_item.archived",
        ]],
      );
      return result.rows;
    });
  }

  @Get("contractor-payables/:id/audit-summary")
  @RequirePermission("contractor_payable.audit.read")
  async payableAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requirePayable(client, request.auth.tenantId, id);
      const itemIds = await client.query("SELECT id FROM contractor_payable_items WHERE tenant_id = $1 AND contractor_payable_id = $2", [request.auth.tenantId, id]);
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

  private async payableStateAction(
    request: AuthenticatedRequest,
    id: string,
    action: string,
    eventType: string,
    transition: (payable: Row, client: PoolClient) => Promise<Row> | Row,
    reason?: unknown,
  ) {
    return this.write(request, action, eventType, "contractor_payable", async (client) => {
      const before = await this.requirePayable(client, request.auth.tenantId, id);
      if (["voided", "archived", "payment_created_later", "paid_later", "partially_paid_later"].includes(String(before.status)) && !["contractor_payable.archive"].includes(action)) throw new BadRequestException("contractor payable cannot transition from its current status");
      const values = await transition(before, client);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "contractor_payables", request.auth.tenantId, id, values);
      return { entityType: "contractor_payable", entityId: id, beforeState: before, afterState: this.withPayableGuidance(after) };
    }, reason);
  }

  private async itemTerminalAction(request: AuthenticatedRequest, id: string, body: Row, status: "voided" | "archived", action: string, eventType: string, reasonField: string, noteField: string) {
    return this.write(request, action, eventType, "contractor_payable_item", async (client) => {
      const before = await this.requirePayableItem(client, request.auth.tenantId, id);
      if (status === "voided" && before.payment_item_id) throw new BadRequestException("payable item linked to payment cannot be voided");
      const values: Row = {
        status,
        updated_by: request.auth.userId,
        updated_at: new Date(),
      };
      const prefix = status === "voided" ? "voided" : "archived";
      values[`${prefix}_by`] = request.auth.userId;
      values[`${prefix}_at`] = new Date();
      values[reasonField] = this.requireText(body[reasonField], `${reasonField} is required`);
      values[noteField] = this.optionalString(body[noteField]);
      const after = await this.update(client, "contractor_payable_items", request.auth.tenantId, id, values);
      await this.recalculateTotals(client, request.auth.tenantId, String(after.contractor_payable_id), request.auth.userId);
      return { entityType: "contractor_payable_item", entityId: id, beforeState: before, afterState: after };
    }, body[reasonField]);
  }

  private async payableDetail(client: PoolClient, tenantId: string, userId: string, id: string) {
    const payable = await this.requirePayable(client, tenantId, id);
    const items = (await client.query("SELECT * FROM contractor_payable_items WHERE tenant_id = $1 AND contractor_payable_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [tenantId, id])).rows;
    return {
      contractor_payable: this.withPayableGuidance(payable),
      contractor_payable_items: items,
      payable_party_context: await this.payablePartyContext(client, tenantId, payable),
      provider_context: await this.optionalRecord(client, "capacity_providers", tenantId, payable.capacity_provider_id),
      crew_context: await this.optionalRecord(client, "crews", tenantId, payable.crew_id),
      project_context: await this.optionalRecord(client, "projects", tenantId, payable.project_id),
      settlement_context: await this.optionalRecord(client, "settlements", tenantId, payable.settlement_id),
      financial_summary: {
        gross_payable_amount: payable.gross_payable_amount,
        deduction_amount: payable.deduction_amount,
        chargeback_amount: payable.chargeback_amount,
        retainage_amount: payable.retainage_amount,
        net_payable_amount: payable.net_payable_amount,
      },
      compliance_summary: { compliance_status: payable.compliance_status },
      tax_document_summary: { tax_document_status: payable.tax_document_status },
      retainage_summary: { retainage_amount: payable.retainage_amount },
      deduction_chargeback_summary: { deduction_amount: payable.deduction_amount, chargeback_amount: payable.chargeback_amount },
      hold_dispute_summary: { hold_status: payable.hold_status, hold_reason: payable.hold_reason, dispute_status: payable.dispute_status, dispute_reason: payable.dispute_reason },
      payment_boundary_summary: {
        payment_readiness_status: payable.payment_readiness_status,
        payment_status: payable.payment_status,
        creates_payment: false,
        creates_payroll: false,
        creates_bank_transaction: false,
        creates_tax_or_accounting_export: false,
      },
      warnings: this.payableWarnings(payable),
      blockers: this.payableBlockers(payable),
      required_override_fields: this.payableRequiredOverrides(payable),
      recommended_next_action: this.recommendedPayableAction(payable, items.length),
      timeline_available: true,
      audit_allowed: await this.hasPermission(client, tenantId, userId, "contractor_payable.audit.read"),
    };
  }

  private async requirePayable(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM contractor_payables WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("contractor payable not found");
    return result.rows[0] as Row;
  }

  private async requirePayableItem(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM contractor_payable_items WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("contractor payable item not found");
    return result.rows[0] as Row;
  }

  private async requireSettlementItem(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT si.*, s.payable_ready AS settlement_payable_ready, s.capacity_provider_id AS settlement_capacity_provider_id
      FROM settlement_items si
      JOIN settlements s ON s.tenant_id = si.tenant_id AND s.id = si.settlement_id
      WHERE si.tenant_id = $1 AND si.id = $2 AND si.deleted_at IS NULL
      `,
      [tenantId, id],
    );
    if (!result.rows[0]) throw new NotFoundException("settlement item not found");
    return result.rows[0] as Row;
  }

  private async validatePayableParty(client: PoolClient, tenantId: string, partyType: string, body: Row) {
    if (partyType === "capacity_provider") await this.requireRecord(client, "capacity_providers", tenantId, this.requireText(body.capacity_provider_id, "capacity_provider_id is required"), "capacity provider not found");
    if (partyType === "crew") await this.requireRecord(client, "crews", tenantId, this.requireText(body.crew_id, "crew_id is required"), "crew not found");
    if (partyType === "worker_later") await this.requireRecord(client, "workers", tenantId, this.requireText(body.worker_id, "worker_id is required"), "worker not found");
    if (partyType === "vendor_later") await this.requireRecord(client, "organizations", tenantId, this.requireText(body.vendor_organization_id, "vendor_organization_id is required"), "vendor organization not found");
  }

  private validatePayablePartyMatches(payable: Row, settlementItem: Row, hasOverride: boolean) {
    if (hasOverride) return;
    if (payable.capacity_provider_id && settlementItem.capacity_provider_id && payable.capacity_provider_id !== settlementItem.capacity_provider_id) throw new BadRequestException("payable party does not match settlement item capacity provider");
    if (payable.crew_id && settlementItem.crew_id && payable.crew_id !== settlementItem.crew_id) throw new BadRequestException("payable party does not match settlement item crew");
  }

  private deriveItemValues(tenantId: string, userId: string, payable: Row, settlementItem: Row, body: Row, hasOverride: boolean) {
    const sourceQuantity = Number(settlementItem.quantity ?? 1);
    const quantity = body.quantity === undefined ? sourceQuantity : this.requirePositive(body.quantity, "quantity");
    if (sourceQuantity > 0 && quantity > sourceQuantity && !hasOverride) throw new BadRequestException("quantity cannot exceed settlement item quantity without override");
    const contractorRate = body.contractor_rate === undefined ? Number(settlementItem.contractor_rate ?? 0) : this.requireNonNegative(body.contractor_rate, "contractor_rate");
    const sourceGross = Number(settlementItem.contractor_payable_amount ?? 0);
    const gross = body.quantity === undefined && body.contractor_rate === undefined && sourceGross > 0 ? sourceGross : this.roundMoney(quantity * contractorRate);
    const deduction = body.deduction_amount === undefined ? 0 : this.requireNonNegative(body.deduction_amount, "deduction_amount");
    const chargeback = body.chargeback_amount === undefined ? 0 : this.requireNonNegative(body.chargeback_amount, "chargeback_amount");
    const retainagePercent = body.retainage_percent === undefined ? undefined : this.requireNonNegative(body.retainage_percent, "retainage_percent");
    const retainage = retainagePercent === undefined ? 0 : this.roundMoney(gross * retainagePercent / 100);
    const itemType = this.mapSettlementItemType(settlementItem.item_type, body.item_type);
    const net = this.roundMoney(gross - deduction - chargeback - retainage);
    if (net < 0 && !["adjustment", "chargeback", "deduction", "penalty"].includes(itemType)) throw new BadRequestException("net payable amount cannot be negative for this item type");
    return {
      tenant_id: tenantId,
      contractor_payable_id: payable.id,
      settlement_id: settlementItem.settlement_id,
      settlement_item_id: settlementItem.id,
      billable_item_id: settlementItem.billable_item_id,
      qc_review_id: settlementItem.qc_review_id,
      production_record_id: settlementItem.production_record_id,
      work_order_id: settlementItem.work_order_id,
      project_id: settlementItem.project_id,
      capacity_provider_id: settlementItem.capacity_provider_id ?? payable.capacity_provider_id,
      crew_id: settlementItem.crew_id ?? payable.crew_id,
      item_type: itemType,
      status: "ready",
      description: this.optionalString(body.description) ?? settlementItem.description,
      quantity,
      unit: settlementItem.unit ?? "unit",
      contractor_rate: contractorRate,
      gross_payable_amount: gross,
      deduction_amount: deduction,
      chargeback_amount: chargeback,
      retainage_percent: retainagePercent,
      retainage_amount: retainage,
      net_payable_amount: net,
      compliance_status: payable.compliance_status ?? "unknown",
      tax_document_status: payable.tax_document_status ?? "unknown",
      dispute_status: "none",
      hold_status: "none",
      override_reasons: this.objectValue(body.override_reasons),
      created_by: userId,
      updated_by: userId,
    };
  }

  private mapSettlementItemType(sourceType: unknown, requested: unknown) {
    if (requested !== undefined) return this.allowed(requested, "item_type", payableItemTypes);
    if (sourceType === "deduction") return "deduction";
    if (sourceType === "chargeback") return "chargeback";
    if (sourceType === "adjustment") return "adjustment";
    if (sourceType === "correction") return "correction";
    if (sourceType === "retainage_release") return "retainage_release";
    if (sourceType === "retainage_hold") return "retainage_hold";
    return "subcontractor_production";
  }

  private async requireNoDuplicateSettlementItem(client: PoolClient, tenantId: string, settlementItemId: string, hasOverride: boolean) {
    if (hasOverride) return;
    const duplicate = await client.query(
      "SELECT id FROM contractor_payable_items WHERE tenant_id = $1 AND settlement_item_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived') LIMIT 1",
      [tenantId, settlementItemId],
    );
    if (duplicate.rows[0]) throw new BadRequestException("duplicate contractor payable item for settlement item is not allowed without override");
  }

  private async requireActiveItemCount(client: PoolClient, tenantId: string, payableId: string) {
    const result = await client.query("SELECT count(*)::int AS count FROM contractor_payable_items WHERE tenant_id = $1 AND contractor_payable_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')", [tenantId, payableId]);
    if (Number(result.rows[0]?.count ?? 0) <= 0) throw new BadRequestException("contractor payable requires at least one active item");
  }

  private async recalculateTotals(client: PoolClient, tenantId: string, payableId: string, userId: string) {
    const totals = await client.query(
      `
      SELECT
        coalesce(sum(gross_payable_amount), 0)::numeric AS gross_payable_amount,
        coalesce(sum(deduction_amount), 0)::numeric AS deduction_amount,
        coalesce(sum(chargeback_amount), 0)::numeric AS chargeback_amount,
        coalesce(sum(retainage_amount), 0)::numeric AS retainage_amount,
        coalesce(sum(net_payable_amount), 0)::numeric AS net_payable_amount
      FROM contractor_payable_items
      WHERE tenant_id = $1 AND contractor_payable_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')
      `,
      [tenantId, payableId],
    );
    return this.update(client, "contractor_payables", tenantId, payableId, { ...totals.rows[0], updated_by: userId, updated_at: new Date() });
  }

  private withPayableGuidance(row: Row) {
    return {
      ...row,
      warnings: this.payableWarnings(row),
      blockers: this.payableBlockers(row),
      required_override_fields: this.payableRequiredOverrides(row),
      recommended_next_action: this.recommendedPayableAction(row, Number(row.item_count ?? 0)),
    };
  }

  private payableWarnings(row: Row) {
    const warnings: string[] = [];
    if (row.compliance_status !== "ready") warnings.push("compliance_not_ready");
    if (row.tax_document_status !== "ready") warnings.push("tax_documents_not_ready");
    if (row.hold_status === "hold") warnings.push("payable_on_hold");
    if (row.dispute_status === "open") warnings.push("payable_disputed");
    return warnings;
  }

  private payableBlockers(row: Row) {
    const blockers: string[] = [];
    if (Number(row.net_payable_amount ?? 0) <= 0) blockers.push("net_payable_amount_not_positive");
    if (row.hold_status === "hold") blockers.push("hold_blocks_payment_readiness");
    if (row.dispute_status === "open") blockers.push("dispute_blocks_payment_readiness");
    if (row.compliance_status === "blocked") blockers.push("compliance_blocked");
    if (row.tax_document_status === "blocked") blockers.push("tax_documents_blocked");
    return blockers;
  }

  private payableRequiredOverrides(row: Row) {
    const required: string[] = [];
    if (row.compliance_status !== "ready") required.push("compliance_override_reason");
    if (row.tax_document_status !== "ready") required.push("tax_document_override_reason");
    if (row.hold_status === "hold") required.push("hold_override_reason");
    if (row.dispute_status === "open") required.push("dispute_override_reason");
    return required;
  }

  private recommendedPayableAction(row: Row, itemCount: number) {
    if (row.status === "archived") return "view_only";
    if (row.status === "voided") return "view_voided_payable";
    if (row.status === "held") return "release_or_review_hold";
    if (row.status === "disputed") return "resolve_dispute";
    if (itemCount <= 0) return "add_payable_items";
    if (row.approval_status === "not_submitted") return "submit_for_review";
    if (row.approval_status === "pending" && row.status === "ready_for_review") return "start_review";
    if (row.status === "under_review") return "approve_or_reject";
    if (row.status === "approved" && row.payment_readiness_status !== "ready_for_payment") return "mark_payment_ready";
    if (row.payment_readiness_status === "ready_for_payment") return "wait_for_future_payment_or_payroll";
    return "continue_payable_review";
  }

  private payableOrder(sort?: string) {
    if (sort === "due_date_asc") return "cp.due_date ASC NULLS LAST, cp.updated_at DESC";
    if (sort === "net_amount_desc") return "cp.net_payable_amount DESC, cp.updated_at DESC";
    if (sort === "status") return "cp.status ASC, cp.updated_at DESC";
    if (sort === "payable_number") return "cp.payable_number ASC";
    if (sort === "payment_readiness") return "cp.payment_readiness_status ASC, cp.updated_at DESC";
    return "cp.updated_at DESC";
  }

  private async payablePartyContext(client: PoolClient, tenantId: string, payable: Row) {
    if (payable.payable_party_type === "capacity_provider") return this.optionalRecord(client, "capacity_providers", tenantId, payable.capacity_provider_id);
    if (payable.payable_party_type === "crew") return this.optionalRecord(client, "crews", tenantId, payable.crew_id);
    if (payable.payable_party_type === "worker_later") return this.optionalRecord(client, "workers", tenantId, payable.worker_id);
    if (payable.payable_party_type === "vendor_later") return this.optionalRecord(client, "organizations", tenantId, payable.vendor_organization_id);
    return { type: "internal_self_perform" };
  }

  private ensurePayableEditableForItems(payable: Row) {
    if (["approved", "payment_ready", "payment_created_later", "partially_paid_later", "paid_later", "voided", "archived"].includes(String(payable.status))) throw new BadRequestException("contractor payable items cannot be changed in current status");
  }

  private async nextPayableNumber(client: PoolClient, tenantId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await client.query("SELECT count(*)::int + 1 AS next FROM contractor_payables WHERE tenant_id = $1", [tenantId]);
      const candidate = `PAY-${String(Number(result.rows[0].next) + attempt).padStart(6, "0")}`;
      const existing = await client.query("SELECT 1 FROM contractor_payables WHERE tenant_id = $1 AND payable_number = $2", [tenantId, candidate]);
      if (!existing.rows[0]) return candidate;
    }
    throw new BadRequestException("could not allocate payable number");
  }

  private async insert(client: PoolClient, table: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    const placeholders = keys.map((_, index) => `$${index + 1}`);
    const result = await client.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`, keys.map((key) => values[key]));
    return result.rows[0] as Row;
  }

  private async update(client: PoolClient, table: string, tenantId: string, id: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    if (keys.length === 0) return table === "contractor_payables" ? this.requirePayable(client, tenantId, id) : this.requirePayableItem(client, tenantId, id);
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

  private requirePositive(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new BadRequestException(`${field} must be > 0`);
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
