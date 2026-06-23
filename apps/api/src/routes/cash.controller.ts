import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireString } from "./intelligence.types";

const invoiceAuthorityRoles = new Set(["Billing Manager", "Finance Manager"]);
const invoiceTypes = new Set(["standard", "progress", "final", "retainage_release", "credit_memo", "rebill", "adjustment", "pro_forma"]);
const paymentTermsValues = new Set(["due_on_receipt", "net_7", "net_15", "net_30", "net_45", "net_60", "custom"]);
const invoicePackageStatuses = new Set(["not_started", "incomplete", "ready", "attached", "submitted", "accepted", "rejected"]);
const acceptanceStatuses = new Set(["not_required", "pending", "accepted", "rejected", "correction_required", "disputed"]);
const deliveryStatuses = new Set(["not_sent", "queued", "sent", "failed", "acknowledged", "rejected"]);
const invoiceItemTypes = new Set(["customer_billable", "retainage_hold", "retainage_release", "deduction", "chargeback", "credit", "adjustment", "fee", "tax", "correction"]);
const cashPaymentMethods = new Set(["ach", "wire", "check", "card", "cash", "lockbox", "portal", "zelle", "other"]);
const cashSourceTypes = new Set(["manual", "bank_import_later", "processor_import_later", "customer_portal_later", "accounting_import_later"]);
const cashReceiptStatuses = new Set(["received", "partially_applied", "fully_applied", "unapplied", "overapplied", "voided", "archived"]);
const cashDepositStatuses = new Set(["not_deposited", "deposited_later", "pending_later", "reconciled_later"]);
const cashReconciliationStatuses = new Set(["not_reconciled", "pending_later", "reconciled_later", "exception_later"]);
const paymentApplicationTypes = new Set(["standard_payment", "partial_payment", "overpayment_application", "retainage_payment", "discount", "writeoff_later", "adjustment", "correction"]);
const collectionCaseStatuses = new Set(["open", "in_progress", "promise_to_pay", "disputed", "escalated", "awaiting_payment", "resolved", "closed", "archived"]);
const collectionPriorities = new Set(["low", "medium", "high", "urgent"]);
const collectionRiskLevels = new Set(["low", "medium", "high", "critical"]);
const collectionActionTypes = new Set([
  "call",
  "email",
  "text",
  "portal_message",
  "internal_note",
  "promise_to_pay",
  "dispute_opened",
  "dispute_updated",
  "dispute_resolved",
  "payment_reminder",
  "follow_up_scheduled",
  "escalation_requested",
  "escalation_approved",
  "writeoff_review_requested",
  "case_closed",
]);
const collectionActionStatuses = new Set(["planned", "completed", "failed", "cancelled", "archived"]);
const collectionContactMethods = new Set(["phone", "email", "sms", "portal", "in_person", "internal"]);
const collectionOutcomes = new Set(["no_response", "left_message", "contacted", "promise_received", "payment_received_later", "dispute_reported", "wrong_contact", "follow_up_needed", "escalated", "resolved"]);
const collectionCloseReasons = new Set(["paid", "resolved", "duplicate", "opened_in_error", "transferred", "unresolved_close", "future_writeoff_review"]);

@Controller()
export class CashController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("invoices")
  @RequirePermission("invoice.read")
  async listInvoices(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["i.tenant_id = $1", "i.deleted_at IS NULL"];
      if (query.archived !== "true") where.push("i.status <> 'archived'");
      this.addFilter(where, values, "i.invoice_type", query.invoice_type);
      this.addFilter(where, values, "i.status", query.status);
      this.addFilter(where, values, "i.approval_status", query.approval_status);
      this.addFilter(where, values, "i.delivery_status", query.delivery_status);
      this.addFilter(where, values, "i.cash_application_status", query.cash_application_status);
      this.addFilter(where, values, "i.payment_status", query.payment_status);
      this.addFilter(where, values, "i.collection_status", query.collection_status);
      this.addFilter(where, values, "i.customer_organization_id", query.customer_organization_id);
      this.addFilter(where, values, "i.project_id", query.project_id);
      this.addFilter(where, values, "i.settlement_id", query.settlement_id);
      this.addFilter(where, values, "i.payment_terms", query.payment_terms);
      if (query.invoice_date_from) this.addDateFilter(where, values, "i.invoice_date", ">=", query.invoice_date_from);
      if (query.invoice_date_to) this.addDateFilter(where, values, "i.invoice_date", "<=", query.invoice_date_to);
      if (query.due_date_from) this.addDateFilter(where, values, "i.due_date", ">=", query.due_date_from);
      if (query.due_date_to) this.addDateFilter(where, values, "i.due_date", "<=", query.due_date_to);
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        const index = values.length;
        where.push(`(i.invoice_number ILIKE $${index} OR co.name ILIKE $${index} OR p.name ILIKE $${index} OR s.settlement_number ILIKE $${index} OR i.dispute_reason ILIKE $${index})`);
      }
      const orderBy = this.invoiceSort(query.sort);
      const result = await client.query(
        `
        SELECT i.*,
          co.name AS customer_organization_name,
          p.name AS project_name,
          s.settlement_number,
          COALESCE(items.item_count, 0)::int AS item_count
        FROM invoices i
        LEFT JOIN organizations co ON co.tenant_id = i.tenant_id AND co.id = i.customer_organization_id
        LEFT JOIN projects p ON p.tenant_id = i.tenant_id AND p.id = i.project_id
        LEFT JOIN settlements s ON s.tenant_id = i.tenant_id AND s.id = i.settlement_id
        LEFT JOIN (
          SELECT tenant_id, invoice_id, count(*) AS item_count
          FROM invoice_items
          WHERE deleted_at IS NULL AND status NOT IN ('voided', 'archived')
          GROUP BY tenant_id, invoice_id
        ) items ON items.tenant_id = i.tenant_id AND items.invoice_id = i.id
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT 100
        `,
        values,
      );
      return result.rows.map((row) => this.withInvoiceGuidance(row));
    });
  }

  @Get("invoices/:id")
  @RequirePermission("invoice.read")
  async getInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found"));
  }

  @Get("invoices/:id/detail")
  @RequirePermission("invoice.read")
  async getInvoiceDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const items = await this.listInvoiceItemsForInvoice(client, request.auth.tenantId, id);
      const contexts = await client.query(
        `
        SELECT co.name AS customer_organization_name, p.name AS project_name, s.settlement_number, s.status AS settlement_status
        FROM invoices i
        LEFT JOIN organizations co ON co.tenant_id = i.tenant_id AND co.id = i.customer_organization_id
        LEFT JOIN projects p ON p.tenant_id = i.tenant_id AND p.id = i.project_id
        LEFT JOIN settlements s ON s.tenant_id = i.tenant_id AND s.id = i.settlement_id
        WHERE i.tenant_id = $1 AND i.id = $2
        `,
        [request.auth.tenantId, id],
      );
      const guidance = this.withInvoiceGuidance({ ...invoice, item_count: items.length });
      return {
        invoice: guidance,
        invoice_items: items,
        customer_context: { id: invoice.customer_organization_id ?? invoice.organization_id, name: contexts.rows[0]?.customer_organization_name ?? null },
        project_context: { id: invoice.project_id, name: contexts.rows[0]?.project_name ?? null },
        settlement_context: { id: invoice.settlement_id, settlement_number: contexts.rows[0]?.settlement_number ?? null, status: contexts.rows[0]?.settlement_status ?? null },
        financial_summary: this.invoiceFinancialSummary(invoice),
        receivable_summary: this.invoiceReceivableSummary(invoice),
        package_summary: {
          invoice_package_status: invoice.invoice_package_status,
          documentation_status: invoice.documentation_status,
          customer_acceptance_status: invoice.customer_acceptance_status,
          prime_acceptance_status: invoice.prime_acceptance_status,
        },
        approval_summary: { approval_status: invoice.approval_status, approved_by: invoice.approved_by, approved_at: invoice.approved_at },
        delivery_summary: { delivery_status: invoice.delivery_status, sent_by: invoice.sent_by, sent_at: invoice.sent_at },
        cash_application_boundary_summary: { cash_application_status: invoice.cash_application_status, creates_cash_records: false, creates_ar_records: false },
        warnings: guidance.warnings,
        blockers: guidance.blockers,
        required_override_fields: guidance.required_override_fields,
        recommended_next_action: guidance.recommended_next_action,
        timeline_available: true,
        audit_allowed: true,
      };
    });
  }

  @Post("invoices")
  @RequirePermission("invoice.create")
  async createInvoice(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "invoice.create", "invoice.created", "invoice", async (client) => {
        const settlement = body.settlement_id ? await this.requireInvoiceReadySettlement(client, request.auth.tenantId, body.settlement_id) : null;
        const customerId = this.optionalString(body.customer_organization_id) ?? settlement?.customer_organization_id ?? settlement?.organization_id;
        if (!customerId) throw new BadRequestException("customer_organization_id is required");
        await this.requireRecord(client, "organizations", request.auth.tenantId, String(customerId), "customer organization not found");
        const projectId = this.optionalString(body.project_id) ?? settlement?.project_id ?? null;
        if (projectId) await this.requireRecord(client, "projects", request.auth.tenantId, String(projectId), "project not found");
        const invoiceType = this.allowed(body.invoice_type ?? "standard", "invoice_type", invoiceTypes);
        const paymentTerms = this.allowed(body.payment_terms ?? "net_30", "payment_terms", paymentTermsValues);
        const invoiceDate = this.optionalString(body.invoice_date) ?? new Date().toISOString().slice(0, 10);
        const dueDate = this.optionalString(body.due_date) ?? this.calculateDueDate(invoiceDate, paymentTerms);
        const invoiceNumber = this.optionalString(body.invoice_number) ?? (await this.nextInvoiceNumber(client, request.auth.tenantId));
        await this.ensureInvoiceNumberAvailable(client, request.auth.tenantId, invoiceNumber);
        const startingAmount = body.invoice_amount !== undefined ? this.requireNonNegative(body.invoice_amount, "invoice_amount") : 0;
        if (body.invoice_amount !== undefined && settlement && startingAmount !== this.sourceSettlementNetAmount(settlement)) {
          throw new BadRequestException("invoice_amount must equal settlement net amount");
        }
        const receivable = this.calculateReceivableState(dueDate, startingAmount, 0, "draft");
        const invoice = await insertTenantRecord(client, "invoices", request.auth.tenantId, {
          settlement_id: settlement?.id ?? null,
          organization_id: customerId,
          customer_organization_id: customerId,
          project_id: projectId,
          invoice_number: invoiceNumber,
          invoice_type: invoiceType,
          invoice_date: invoiceDate,
          due_date: dueDate,
          payment_terms: paymentTerms,
          billing_period_start: body.billing_period_start ?? settlement?.settlement_period_start ?? null,
          billing_period_end: body.billing_period_end ?? settlement?.settlement_period_end ?? null,
          subtotal_amount: startingAmount,
          invoice_amount: startingAmount,
          total_amount: startingAmount,
          original_amount: 0,
          paid_amount: 0,
          balance_amount: startingAmount,
          currency: this.optionalString(body.currency) ?? "USD",
          aging_days: receivable.aging_days,
          payment_status: receivable.payment_status,
          collection_status: receivable.collection_status,
          status: "draft",
          approval_status: "not_submitted",
          delivery_status: "not_sent",
          cash_application_status: "not_ready",
          invoice_package_status: this.allowed(body.invoice_package_status ?? "not_started", "invoice_package_status", invoicePackageStatuses),
          documentation_status: this.allowed(body.documentation_status ?? "not_started", "documentation_status", invoicePackageStatuses),
          customer_acceptance_status: this.allowed(body.customer_acceptance_status ?? "not_required", "customer_acceptance_status", acceptanceStatuses),
          prime_acceptance_status: this.allowed(body.prime_acceptance_status ?? "not_required", "prime_acceptance_status", acceptanceStatuses),
          override_reasons: this.objectValue(body.override_reasons),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        return { entityType: "invoice", entityId: invoice.id, afterState: invoice };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("invoices/:id")
  @RequirePermission("invoice.update")
  async updateInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
      const values = pick(body, [
        "invoice_date",
        "due_date",
        "payment_terms",
        "billing_period_start",
        "billing_period_end",
        "invoice_package_status",
        "documentation_status",
        "customer_acceptance_status",
        "prime_acceptance_status",
        "override_reasons",
        "dispute_note",
      ]);
      return await this.write(request, "invoice.update", "invoice.updated", "invoice", async (client) => {
        const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
        if (["voided", "archived", "sent", "paid_later"].includes(String(before.status))) throw new BadRequestException("invoice cannot be edited in its current status");
        if (values.payment_terms !== undefined) values.payment_terms = this.allowed(values.payment_terms, "payment_terms", paymentTermsValues);
        if (values.invoice_package_status !== undefined) values.invoice_package_status = this.allowed(values.invoice_package_status, "invoice_package_status", invoicePackageStatuses);
        if (values.documentation_status !== undefined) values.documentation_status = this.allowed(values.documentation_status, "documentation_status", invoicePackageStatuses);
        if (values.customer_acceptance_status !== undefined) values.customer_acceptance_status = this.allowed(values.customer_acceptance_status, "customer_acceptance_status", acceptanceStatuses);
        if (values.prime_acceptance_status !== undefined) values.prime_acceptance_status = this.allowed(values.prime_acceptance_status, "prime_acceptance_status", acceptanceStatuses);
        const dueDate = values.due_date ?? before.due_date ?? this.calculateDueDate(values.invoice_date ?? before.invoice_date ?? new Date().toISOString().slice(0, 10), values.payment_terms ?? before.payment_terms ?? "net_30");
        const receivable = this.calculateReceivableState(dueDate, Number(before.original_amount || before.total_amount || 0), Number(before.paid_amount || 0), String(before.status));
        Object.assign(values, receivable, { updated_by: request.auth.userId });
        const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("invoice not found");
        return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("invoices/:id/submit")
  @RequirePermission("invoice.submit")
  async submitInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.submitInvoiceForReview(request, id, body, "invoice.submit", "invoice.review_submitted");
  }

  @Post("invoices/:id/submit-review")
  @RequirePermission("invoice.submit_review")
  async submitReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.submitInvoiceForReview(request, id, body, "invoice.submit_review", "invoice.review_submitted", true);
  }

  @Post("invoices/:id/recalculate-totals")
  @RequirePermission("invoice.recalculate_totals")
  async recalculateTotals(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "invoice.recalculate_totals", "invoice.totals_recalculated", "invoice", async (client) => {
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const after = await this.recalculateInvoiceTotals(client, request.auth.tenantId, id, request.auth.userId);
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/approve")
  @RequirePermission("invoice.approve")
  async approveInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.approve", "invoice.approved", "invoice", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, invoiceAuthorityRoles, "Billing Manager or Finance Manager authority is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      requireString(body.approval_note, "approval_note is required");
      await this.requireActiveInvoiceItems(client, request.auth.tenantId, id);
      if (!["pending", "not_submitted"].includes(String(before.approval_status)) && before.status !== "ready_for_review" && before.status !== "under_review") {
        throw new BadRequestException("invoice is not ready for approval");
      }
      if (Number(before.total_amount ?? 0) <= 0) throw new BadRequestException("invoice total must be > 0");
      const originalAmount = Number(before.total_amount ?? 0);
      const receivable = this.calculateReceivableState(before.due_date, originalAmount, Number(before.paid_amount ?? 0), "approved");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: "approved",
        approval_status: "approved",
        approved_by: request.auth.userId,
        approved_at: new Date(),
        original_amount: originalAmount,
        paid_amount: Number(before.paid_amount ?? 0),
        balance_amount: receivable.balance_amount,
        payment_status: receivable.payment_status,
        collection_status: receivable.collection_status,
        aging_days: receivable.aging_days,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/reject")
  @RequirePermission("invoice.reject")
  async rejectInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.reject", "invoice.rejected", "invoice", async (client) => {
      const rejectionReason = requireString(body.rejection_reason, "rejection_reason is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: "draft",
        approval_status: "rejected",
        rejected_by: request.auth.userId,
        rejected_at: new Date(),
        rejection_reason: rejectionReason,
        rejection_note: this.optionalString(body.rejection_note),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/mark-sent")
  @RequirePermission("invoice.mark_sent")
  async markSent(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.mark_sent", "invoice.sent", "invoice", async (client) => {
      requireString(body.sent_note, "sent_note is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (before.status !== "approved" || before.approval_status !== "approved") throw new BadRequestException("invoice must be approved");
      const originalAmount = Number(before.original_amount || before.total_amount || 0);
      const receivable = this.calculateReceivableState(before.due_date, originalAmount, Number(before.paid_amount ?? 0), "sent");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: "sent",
        delivery_status: this.allowed(body.delivery_status ?? "sent", "delivery_status", deliveryStatuses),
        sent_by: request.auth.userId,
        sent_at: new Date(),
        original_amount: originalAmount,
        balance_amount: receivable.balance_amount,
        payment_status: receivable.payment_status,
        collection_status: receivable.collection_status,
        aging_days: receivable.aging_days,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/mark-ready-for-cash-application")
  @RequirePermission("invoice.mark_ready_for_cash_application")
  async markReadyForCashApplication(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.mark_ready_for_cash_application", "invoice.ready_for_cash_application", "invoice", async (client) => {
      requireString(body.ready_note, "ready_note is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (!["approved", "sent"].includes(String(before.status))) throw new BadRequestException("invoice must be approved or sent");
      if (Number(before.total_amount ?? 0) <= 0) throw new BadRequestException("total_amount must be > 0");
      if (!before.customer_organization_id && !before.organization_id) throw new BadRequestException("customer organization is required");
      if (!before.due_date) throw new BadRequestException("due_date is required");
      if (["voided", "archived", "disputed"].includes(String(before.status)) && !body.override_reasons) throw new BadRequestException("invoice has a hard blocker");
      const receivable = this.calculateReceivableState(before.due_date, Number(before.original_amount || before.total_amount || 0), Number(before.paid_amount ?? 0), String(before.status));
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        cash_application_status: "ready_for_cash_application",
        payment_status: receivable.payment_status,
        collection_status: receivable.collection_status,
        aging_days: receivable.aging_days,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/dispute")
  @RequirePermission("invoice.dispute")
  async disputeInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.dispute", "invoice.disputed", "invoice", async (client) => {
      const disputeReason = requireString(body.dispute_reason, "dispute_reason is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: "disputed",
        collection_status: "disputed",
        disputed_by: request.auth.userId,
        disputed_at: new Date(),
        dispute_reason: disputeReason,
        dispute_note: this.optionalString(body.dispute_note),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/resolve-dispute")
  @RequirePermission("invoice.resolve_dispute")
  async resolveInvoiceDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.resolve_dispute", "invoice.dispute_resolved", "invoice", async (client) => {
      requireString(body.resolution_note, "resolution_note is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const nextStatus = before.delivery_status === "sent" ? "sent" : before.approval_status === "approved" ? "approved" : "draft";
      const receivable = this.calculateReceivableState(before.due_date, Number(before.original_amount || before.total_amount || 0), Number(before.paid_amount ?? 0), nextStatus);
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: nextStatus,
        collection_status: receivable.collection_status,
        aging_days: receivable.aging_days,
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/void")
  @RequirePermission("invoice.void")
  async voidInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.void", "invoice.voided", "invoice", async (client) => {
      const voidReason = requireString(body.void_reason, "void_reason is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (["paid_later", "fully_applied_later"].includes(String(before.status)) || before.cash_application_status === "fully_applied_later") throw new BadRequestException("paid invoice cannot be voided");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: "voided",
        voided_by: request.auth.userId,
        voided_at: new Date(),
        void_reason: voidReason,
        void_note: this.optionalString(body.void_note),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/mark-overdue")
  @RequirePermission("invoice.mark_overdue")
  async markOverdue(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "invoice.mark_overdue", "invoice.overdue", "invoice", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, invoiceAuthorityRoles, "Billing Manager or Finance Manager authority is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (!["submitted", "approved", "sent"].includes(String(before.status))) throw new BadRequestException("invoice must be submitted, approved, or sent");
      if (this.daysPastDue(before.due_date) <= 0) throw new BadRequestException("invoice is not overdue");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, { status: "overdue_later", collection_status: "overdue", aging_days: this.daysPastDue(before.due_date) });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/archive")
  @RequirePermission("invoice.archive")
  async archiveInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.archive", "invoice.archived", "invoice", async (client) => {
      const archiveReason = requireString(body.archive_reason, "archive_reason is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: archiveReason,
        archive_note: this.optionalString(body.archive_note),
        deleted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("invoices/:id/items")
  @RequirePermission("invoice_item.read")
  async listInvoiceItems(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      return this.listInvoiceItemsForInvoice(client, request.auth.tenantId, id);
    });
  }

  @Post("invoices/:id/items")
  @RequirePermission("invoice.add_item")
  async addInvoiceItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice.add_item", "invoice.item_added", "invoice", async (client) => {
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (["voided", "archived", "sent", "paid_later"].includes(String(invoice.status))) throw new BadRequestException("invoice cannot accept items in its current status");
      const source = await this.requireSettlementItemForInvoice(client, request.auth.tenantId, body.settlement_item_id);
      if (source.item_type === "contractor_payable") throw new BadRequestException("contractor payable items cannot become customer invoice items");
      const override = !!body.override_reasons;
      if (source.status !== "invoice_ready" && source.settlement_status !== "invoice_ready" && source.invoice_ready !== true && !override) {
        throw new BadRequestException("settlement item must be invoice ready");
      }
      if (source.customer_organization_id && invoice.customer_organization_id && source.customer_organization_id !== invoice.customer_organization_id && !override) {
        throw new BadRequestException("invoice customer must match settlement item customer");
      }
      await this.ensureNoDuplicateInvoiceItem(client, request.auth.tenantId, source.id, override);
      const quantity = body.quantity === undefined ? Number(source.quantity ?? 0) : this.requirePositive(body.quantity, "quantity");
      if (quantity > Number(source.quantity ?? 0) && !override) throw new BadRequestException("quantity cannot exceed settlement item quantity without override");
      const unitRate = body.unit_rate === undefined ? Number(source.unit_rate ?? 0) : this.requireNonNegative(body.unit_rate, "unit_rate");
      const grossAmount = this.roundMoney(quantity * unitRate);
      const retainageAmount = body.retainage_amount === undefined ? Number(source.retainage_amount ?? 0) : this.requireNonNegative(body.retainage_amount, "retainage_amount");
      const deductionAmount = body.deduction_amount === undefined ? Number(source.deduction_amount ?? source.chargeback_amount ?? 0) : this.requireNonNegative(body.deduction_amount, "deduction_amount");
      const adjustmentAmount = body.adjustment_amount === undefined ? 0 : Number(body.adjustment_amount);
      const taxAmount = body.tax_amount === undefined ? 0 : this.requireNonNegative(body.tax_amount, "tax_amount");
      const feeAmount = body.fee_amount === undefined ? 0 : this.requireNonNegative(body.fee_amount, "fee_amount");
      const netAmount = this.roundMoney(grossAmount - retainageAmount - deductionAmount + adjustmentAmount + taxAmount + feeAmount);
      const item = await insertTenantRecord(client, "invoice_items", request.auth.tenantId, {
        invoice_id: id,
        settlement_id: source.settlement_id,
        settlement_item_id: source.id,
        billable_item_id: source.billable_item_id,
        qc_review_id: source.qc_review_id,
        production_record_id: source.production_record_id,
        work_order_id: source.work_order_id,
        project_id: source.project_id,
        customer_organization_id: invoice.customer_organization_id ?? invoice.organization_id ?? source.customer_organization_id,
        item_type: this.allowed(body.item_type ?? source.item_type ?? "customer_billable", "item_type", invoiceItemTypes),
        status: "ready",
        description: this.optionalString(body.description),
        quantity,
        unit: source.unit,
        unit_rate: unitRate,
        gross_amount: grossAmount,
        retainage_amount: retainageAmount,
        deduction_amount: deductionAmount,
        adjustment_amount: adjustmentAmount,
        tax_amount: taxAmount,
        fee_amount: feeAmount,
        net_amount: netAmount,
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      const after = await this.recalculateInvoiceTotals(client, request.auth.tenantId, id, request.auth.userId);
      return {
        entityType: "invoice",
        entityId: id,
        beforeState: invoice,
        afterState: after,
        additionalEvents: [
          {
            action: "invoice_item.create",
            aggregateType: "invoice_item",
            entityType: "invoice_item",
            entityId: item.id,
            eventType: "invoice_item.created",
            afterState: item,
            systemActions: [{ actionType: "invoice_item.created.processed", payload: { action: "invoice_item.create" } }],
          },
        ],
      };
    });
  }

  @Get("invoice-items/:id")
  @RequirePermission("invoice_item.read")
  async getInvoiceItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "invoice_items", request.auth.tenantId, id, "invoice item not found"));
  }

  @Get("invoice-items/:id/detail")
  @RequirePermission("invoice_item.read")
  async getInvoiceItemDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const item = await this.requireRecord(client, "invoice_items", request.auth.tenantId, id, "invoice item not found");
      const result = await client.query(
        `
        SELECT i.invoice_number, s.settlement_number, si.item_type AS settlement_item_type, b.status AS billable_status,
          qr.review_status AS qc_status, pr.status AS production_status, wo.work_order_name, p.name AS project_name
        FROM invoice_items ii
        LEFT JOIN invoices i ON i.tenant_id = ii.tenant_id AND i.id = ii.invoice_id
        LEFT JOIN settlements s ON s.tenant_id = ii.tenant_id AND s.id = ii.settlement_id
        LEFT JOIN settlement_items si ON si.tenant_id = ii.tenant_id AND si.id = ii.settlement_item_id
        LEFT JOIN billable_items b ON b.tenant_id = ii.tenant_id AND b.id = ii.billable_item_id
        LEFT JOIN qc_reviews qr ON qr.tenant_id = ii.tenant_id AND qr.id = ii.qc_review_id
        LEFT JOIN production_records pr ON pr.tenant_id = ii.tenant_id AND pr.id = ii.production_record_id
        LEFT JOIN work_orders wo ON wo.tenant_id = ii.tenant_id AND wo.id = ii.work_order_id
        LEFT JOIN projects p ON p.tenant_id = ii.tenant_id AND p.id = ii.project_id
        WHERE ii.tenant_id = $1 AND ii.id = $2
        `,
        [request.auth.tenantId, id],
      );
      return {
        item,
        invoice_context: { id: item.invoice_id, invoice_number: result.rows[0]?.invoice_number ?? null },
        settlement_context: { id: item.settlement_id, settlement_number: result.rows[0]?.settlement_number ?? null },
        settlement_item_context: { id: item.settlement_item_id, item_type: result.rows[0]?.settlement_item_type ?? null },
        billable_context: { id: item.billable_item_id, status: result.rows[0]?.billable_status ?? null },
        qc_context: { id: item.qc_review_id, status: result.rows[0]?.qc_status ?? null },
        production_context: { id: item.production_record_id, status: result.rows[0]?.production_status ?? null },
        work_order_context: { id: item.work_order_id, name: result.rows[0]?.work_order_name ?? null },
        project_context: { id: item.project_id, name: result.rows[0]?.project_name ?? null },
        financial_breakdown: {
          gross_amount: item.gross_amount,
          retainage_amount: item.retainage_amount,
          deduction_amount: item.deduction_amount,
          adjustment_amount: item.adjustment_amount,
          tax_amount: item.tax_amount,
          fee_amount: item.fee_amount,
          net_amount: item.net_amount,
        },
      };
    });
  }

  @Post("invoice-items/:id/void")
  @RequirePermission("invoice_item.void")
  async voidInvoiceItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice_item.void", "invoice_item.voided", "invoice_item", async (client) => {
      const voidReason = requireString(body.void_reason, "void_reason is required");
      const before = await this.requireRecord(client, "invoice_items", request.auth.tenantId, id, "invoice item not found");
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, String(before.invoice_id), "invoice not found");
      if (["sent", "paid_later"].includes(String(invoice.status)) || invoice.cash_application_status === "fully_applied_later") throw new BadRequestException("invoice item cannot be voided after invoice is sent or paid");
      const after = await updateTenantRecord(client, "invoice_items", request.auth.tenantId, id, {
        status: "voided",
        voided_by: request.auth.userId,
        voided_at: new Date(),
        void_reason: voidReason,
        void_note: this.optionalString(body.void_note),
        updated_by: request.auth.userId,
      });
      await this.recalculateInvoiceTotals(client, request.auth.tenantId, String(before.invoice_id), request.auth.userId);
      return { entityType: "invoice_item", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoice-items/:id/archive")
  @RequirePermission("invoice_item.archive")
  async archiveInvoiceItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "invoice_item.archive", "invoice_item.archived", "invoice_item", async (client) => {
      const archiveReason = requireString(body.archive_reason, "archive_reason is required");
      const before = await this.requireRecord(client, "invoice_items", request.auth.tenantId, id, "invoice item not found");
      const after = await updateTenantRecord(client, "invoice_items", request.auth.tenantId, id, {
        status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: archiveReason,
        archive_note: this.optionalString(body.archive_note),
        deleted_at: new Date(),
        updated_by: request.auth.userId,
      });
      await this.recalculateInvoiceTotals(client, request.auth.tenantId, String(before.invoice_id), request.auth.userId);
      return { entityType: "invoice_item", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("invoices/:id/timeline")
  @RequirePermission("invoice.timeline.read")
  async invoiceTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const result = await client.query(
        `
        SELECT e.event_type, e.actor_user_id AS actor, e.occurred_at AS timestamp, e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'invoice' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'invoice_item' AND e.aggregate_id IN (SELECT id FROM invoice_items WHERE tenant_id = $1 AND invoice_id = $2))
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("invoices/:id/audit-summary")
  @RequirePermission("invoice.audit.read")
  async invoiceAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      const result = await client.query(
        `
        SELECT actor_user_id AS actor, action, entity_type AS object, entity_id AS object_id, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id
        FROM audit_logs
        WHERE tenant_id = $1
          AND (
            (entity_type = 'invoice' AND entity_id = $2)
            OR (entity_type = 'invoice_item' AND entity_id IN (SELECT id FROM invoice_items WHERE tenant_id = $1 AND invoice_id = $2))
          )
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("collection-cases")
  @RequirePermission("collection_case.read")
  async listCollectionCases(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["cc.tenant_id = $1"];
      if (query.archived !== "true") where.push("cc.deleted_at IS NULL", "cc.case_status <> 'archived'");
      this.addFilter(where, values, "cc.case_status", query.case_status);
      this.addFilter(where, values, "cc.collection_priority", query.collection_priority);
      this.addFilter(where, values, "cc.risk_level", query.risk_level);
      this.addFilter(where, values, "cc.aging_bucket", query.aging_bucket);
      this.addFilter(where, values, "cc.customer_organization_id", query.customer_organization_id);
      this.addFilter(where, values, "cc.invoice_id", query.invoice_id);
      this.addFilter(where, values, "cc.assigned_owner_user_id", query.assigned_owner_user_id);
      this.addFilter(where, values, "cc.dispute_status", query.dispute_status);
      this.addFilter(where, values, "cc.escalation_status", query.escalation_status);
      this.addFilter(where, values, "cc.writeoff_review_status", query.writeoff_review_status);
      if (query.next_action_due_from) this.addDateFilter(where, values, "cc.next_action_due_at", ">=", query.next_action_due_from);
      if (query.next_action_due_to) this.addDateFilter(where, values, "cc.next_action_due_at", "<=", query.next_action_due_to);
      if (query.has_promise === "true") where.push("cc.promise_to_pay_date IS NOT NULL");
      if (query.has_promise === "false") where.push("cc.promise_to_pay_date IS NULL");
      if (query.overdue_promise === "true") where.push("cc.promise_to_pay_date < current_date AND cc.case_status = 'promise_to_pay'");
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        const index = values.length;
        where.push(`(cc.case_number ILIKE $${index} OR i.invoice_number ILIKE $${index} OR co.name ILIKE $${index} OR cc.notes ILIKE $${index} OR latest.dispute_reason ILIKE $${index} OR latest.escalation_reason ILIKE $${index} OR latest.outcome ILIKE $${index})`);
      }
      const result = await client.query(
        `
        SELECT cc.*,
          i.invoice_number,
          i.balance_amount AS invoice_balance_amount,
          i.aging_days AS invoice_aging_days,
          co.name AS customer_organization_name,
          u.display_name AS assigned_owner_name,
          COALESCE(actions.action_count, 0)::int AS action_count,
          latest.action_type AS latest_action_type,
          latest.action_date AS latest_action_at
        FROM collection_cases cc
        JOIN invoices i ON i.tenant_id = cc.tenant_id AND i.id = cc.invoice_id
        LEFT JOIN organizations co ON co.tenant_id = cc.tenant_id AND co.id = cc.customer_organization_id
        LEFT JOIN users u ON u.id = cc.assigned_owner_user_id
        LEFT JOIN (
          SELECT tenant_id, collection_case_id, count(*) AS action_count
          FROM collection_actions
          WHERE deleted_at IS NULL AND action_status <> 'archived'
          GROUP BY tenant_id, collection_case_id
        ) actions ON actions.tenant_id = cc.tenant_id AND actions.collection_case_id = cc.id
        LEFT JOIN LATERAL (
          SELECT action_type, action_date, dispute_reason, escalation_reason, outcome
          FROM collection_actions ca
          WHERE ca.tenant_id = cc.tenant_id AND ca.collection_case_id = cc.id AND ca.deleted_at IS NULL
          ORDER BY ca.created_at DESC
          LIMIT 1
        ) latest ON true
        WHERE ${where.join(" AND ")}
        ORDER BY ${this.collectionCaseSort(query.sort)}
        LIMIT 100
        `,
        values,
      );
      return result.rows.map((row) => this.withCollectionCaseGuidance(this.withDynamicCollectionCase(row)));
    });
  }

  @Get("collection-cases/:id")
  @RequirePermission("collection_case.read")
  async getCollectionCase(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "collection_cases", request.auth.tenantId, id, "collection case not found"));
  }

  @Get("collection-cases/:id/detail")
  @RequirePermission("collection_case.read")
  async getCollectionCaseDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const collectionCase = await this.requireCollectionCaseContext(client, request.auth.tenantId, id);
      const actions = await this.listCollectionActionsForCase(client, request.auth.tenantId, id);
      const cash = await this.collectionCashContext(client, request.auth.tenantId, String(collectionCase.customer_organization_id), String(collectionCase.invoice_id));
      const guided = this.withCollectionCaseGuidance(this.withDynamicCollectionCase({ ...collectionCase, action_count: actions.length }));
      return {
        collection_case: guided,
        invoice_context: {
          id: collectionCase.invoice_id,
          invoice_number: collectionCase.invoice_number,
          original_amount: collectionCase.original_amount,
          paid_amount: collectionCase.paid_amount,
          balance_amount: collectionCase.invoice_balance_amount,
          aging_days: collectionCase.invoice_aging_days,
          payment_status: collectionCase.payment_status,
          collection_status: collectionCase.collection_status,
          cash_application_status: collectionCase.cash_application_status,
        },
        customer_context: { id: collectionCase.customer_organization_id, name: collectionCase.customer_organization_name },
        cash_application_context: cash,
        collection_actions: actions,
        promise_summary: { promise_to_pay_date: collectionCase.promise_to_pay_date, promise_to_pay_amount: collectionCase.promise_to_pay_amount },
        dispute_summary: { dispute_status: collectionCase.dispute_status },
        escalation_summary: { escalation_status: collectionCase.escalation_status },
        aging_priority_summary: { aging_bucket: guided["aging_bucket"], collection_priority: guided["collection_priority"], risk_level: guided["risk_level"] },
        writeoff_review_summary: { writeoff_review_status: collectionCase.writeoff_review_status, executes_writeoff: false },
        boundary_summary: { creates_cash_receipt: false, creates_payment_application: false, updates_invoice_balance: false, creates_legal_filing: false, creates_tax_record: false, creates_accounting_export: false },
        warnings: guided.warnings,
        blockers: guided.blockers,
        recommended_next_action: guided.recommended_next_action,
        timeline_available: true,
        audit_allowed: true,
      };
    });
  }

  @Post("collection-cases")
  @RequirePermission("collection_case.create")
  async createCollectionCase(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "collection_case.create", "collection_case.created", "collection_case", async (client) => {
        const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, this.requiredId(body.invoice_id, "invoice_id"), "invoice not found");
        const override = !!body.override_reasons;
        if (["voided", "archived"].includes(String(invoice.status))) throw new BadRequestException("voided or archived invoices cannot enter collections");
        if (String(invoice.payment_status) === "paid" && !override) throw new BadRequestException("paid invoices cannot enter collections without override");
        if (Number(invoice.balance_amount ?? 0) <= 0 && !override) throw new BadRequestException("invoice balance must be open for collections");
        await this.ensureNoActiveCollectionCase(client, request.auth.tenantId, String(invoice.id), override);
        const customerId = String(invoice.customer_organization_id ?? invoice.organization_id ?? "");
        if (!customerId) throw new BadRequestException("customer organization is required");
        await this.requireRecord(client, "organizations", request.auth.tenantId, customerId, "customer organization not found");
        const ownerId = this.optionalString(body.assigned_owner_user_id);
        if (ownerId) await this.requireTenantUser(client, request.auth.tenantId, ownerId);
        const agingBucket = this.collectionAgingBucket(invoice);
        const disputeStatus = String(invoice.status) === "disputed" || String(invoice.collection_status) === "disputed" ? "open" : "none";
        const priority = body.collection_priority === undefined ? this.collectionPriority(agingBucket, Number(invoice.balance_amount ?? 0), disputeStatus) : this.allowed(body.collection_priority, "collection_priority", collectionPriorities);
        const risk = this.collectionRisk(agingBucket, disputeStatus);
        const collectionCase = await insertTenantRecord(client, "collection_cases", request.auth.tenantId, {
          invoice_id: invoice.id,
          customer_organization_id: customerId,
          case_number: await this.nextCollectionCaseNumber(client, request.auth.tenantId),
          case_status: "open",
          collection_priority: priority,
          risk_level: risk,
          aging_bucket: agingBucket,
          dispute_status: disputeStatus,
          escalation_status: "none",
          writeoff_review_status: "not_ready",
          assigned_owner_user_id: ownerId ?? null,
          opened_at: new Date(),
          balance_at_open: Number(invoice.balance_amount ?? 0),
          current_balance: Number(invoice.balance_amount ?? 0),
          original_invoice_amount: Number(invoice.original_amount ?? invoice.total_amount ?? 0),
          last_payment_at: invoice.last_payment_at ?? null,
          last_payment_amount: invoice.last_payment_amount ?? null,
          notes: this.optionalString(body.notes),
          override_reasons: this.objectValue(body.override_reasons),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        return {
          entityType: "collection_case",
          entityId: collectionCase.id,
          afterState: collectionCase,
          additionalEvents: [this.additionalEvent("collection_case.create", "invoice", invoice.id, "invoice.collection_case_opened", { ...invoice, collection_case_id: collectionCase.id }, invoice)],
        };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("collection-cases/:id")
  @RequirePermission("collection_case.update")
  async updateCollectionCase(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_case.update", "collection_case.updated", "collection_case", async (client) => {
      const before = await this.requireRecord(client, "collection_cases", request.auth.tenantId, id, "collection case not found");
      if (before.case_status === "archived") throw new BadRequestException("archived collection cases are view-only");
      const values = pick(body, ["next_action_type", "next_action_due_at", "notes", "override_reasons"]);
      if (body.assigned_owner_user_id !== undefined) {
        const ownerId = this.optionalString(body.assigned_owner_user_id);
        if (ownerId) await this.requireTenantUser(client, request.auth.tenantId, ownerId);
        values.assigned_owner_user_id = ownerId ?? null;
      }
      if (body.collection_priority !== undefined) values.collection_priority = this.allowed(body.collection_priority, "collection_priority", collectionPriorities);
      if (body.risk_level !== undefined) values.risk_level = this.allowed(body.risk_level, "risk_level", collectionRiskLevels);
      values.updated_by = request.auth.userId;
      const after = await updateTenantRecord(client, "collection_cases", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("collection case not found");
      return { entityType: "collection_case", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("collection-cases/:id/assign-owner")
  @RequirePermission("collection_case.assign_owner")
  async assignCollectionOwner(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_case.assign_owner", "collection_case.owner_assigned", "collection_case", async (client) => {
      const ownerId = this.optionalString(body.assigned_owner_user_id);
      if (!ownerId) throw new BadRequestException("assigned_owner_user_id is required");
      await this.requireTenantUser(client, request.auth.tenantId, ownerId);
      const before = await this.requireRecord(client, "collection_cases", request.auth.tenantId, id, "collection case not found");
      if (before.case_status === "archived") throw new BadRequestException("archived collection cases are view-only");
      const after = await updateTenantRecord(client, "collection_cases", request.auth.tenantId, id, { assigned_owner_user_id: ownerId, updated_by: request.auth.userId });
      if (!after) throw new NotFoundException("collection case not found");
      return { entityType: "collection_case", entityId: id, beforeState: before, afterState: after };
    }, body.assignment_note);
  }

  @Post("collection-cases/:id/actions")
  @RequirePermission("collection_action.create")
  async createCollectionAction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "collection_action.create", "collection_action.created", "collection_action", async (client) => {
        const collectionCase = await this.requireRecord(client, "collection_cases", request.auth.tenantId, id, "collection case not found");
        if (collectionCase.case_status === "archived") throw new BadRequestException("archived collection cases are view-only");
        const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, String(collectionCase.invoice_id), "invoice not found");
        const actionType = this.allowed(body.action_type, "action_type", collectionActionTypes);
        this.validateCollectionActionBody(actionType, body, Number(invoice.balance_amount ?? 0));
        const actionStatus = this.allowed(body.action_status ?? "planned", "action_status", collectionActionStatuses);
        const action = await insertTenantRecord(client, "collection_actions", request.auth.tenantId, {
          collection_case_id: collectionCase.id,
          invoice_id: collectionCase.invoice_id,
          customer_organization_id: collectionCase.customer_organization_id,
          action_type: actionType,
          action_status: actionStatus,
          action_date: body.action_date === undefined ? new Date().toISOString().slice(0, 10) : this.requireDate(body.action_date, "action_date"),
          due_at: body.due_at ?? null,
          completed_at: actionStatus === "completed" ? new Date() : null,
          actor_user_id: request.auth.userId,
          contact_id: this.optionalString(body.contact_id),
          contact_method: body.contact_method === undefined ? null : this.allowed(body.contact_method, "contact_method", collectionContactMethods),
          outcome: body.outcome === undefined ? null : this.allowed(body.outcome, "outcome", collectionOutcomes),
          note: this.optionalString(body.note),
          promise_to_pay_date: body.promise_to_pay_date === undefined ? null : this.requireDate(body.promise_to_pay_date, "promise_to_pay_date"),
          promise_to_pay_amount: body.promise_to_pay_amount === undefined ? null : this.requireNonNegative(body.promise_to_pay_amount, "promise_to_pay_amount"),
          dispute_reason: this.optionalString(body.dispute_reason),
          escalation_reason: this.optionalString(body.escalation_reason),
          follow_up_required: Boolean(body.follow_up_required),
          follow_up_due_at: body.follow_up_due_at ?? null,
          evidence_reference: this.optionalString(body.evidence_reference),
          override_reasons: this.objectValue(body.override_reasons),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        const summary = await this.applyCollectionActionSummary(client, request.auth.tenantId, collectionCase, invoice, action, request.auth.userId);
        return {
          entityType: "collection_action",
          entityId: action.id,
          beforeState: collectionCase,
          afterState: action,
          additionalEvents: summary.additionalEvents,
        };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("collection-actions/:id/complete")
  @RequirePermission("collection_action.complete")
  async completeCollectionAction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_action.complete", "collection_action.completed", "collection_action", async (client) => {
      const before = await this.requireRecord(client, "collection_actions", request.auth.tenantId, id, "collection action not found");
      if (["archived", "cancelled"].includes(String(before.action_status))) throw new BadRequestException("collection action cannot be completed in its current status");
      const values: Record<string, unknown> = {
        action_status: "completed",
        completed_at: new Date(),
        updated_by: request.auth.userId,
      };
      if (body.outcome !== undefined) values.outcome = this.allowed(body.outcome, "outcome", collectionOutcomes);
      if (body.note !== undefined) values.note = this.optionalString(body.note);
      if (body.follow_up_required !== undefined) values.follow_up_required = Boolean(body.follow_up_required);
      if (body.follow_up_due_at !== undefined) values.follow_up_due_at = body.follow_up_due_at;
      const after = await updateTenantRecord(client, "collection_actions", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("collection action not found");
      if (body.follow_up_due_at) {
        const beforeCase = await this.requireRecord(client, "collection_cases", request.auth.tenantId, String(before.collection_case_id), "collection case not found");
        const afterCase = await updateTenantRecord(client, "collection_cases", request.auth.tenantId, String(before.collection_case_id), {
          next_action_type: "follow_up_scheduled",
          next_action_due_at: body.follow_up_due_at,
          updated_by: request.auth.userId,
        });
        if (!afterCase) throw new NotFoundException("collection case not found");
        return {
          entityType: "collection_action",
          entityId: id,
          beforeState: before,
          afterState: after,
          additionalEvents: [this.additionalEvent("collection_case.update", "collection_case", before.collection_case_id, "collection_case.updated", afterCase, beforeCase)],
        };
      }
      return { entityType: "collection_action", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("collection-actions/:id/cancel")
  @RequirePermission("collection_action.cancel")
  async cancelCollectionAction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_action.cancel", "collection_action.cancelled", "collection_action", async (client) => {
      const cancelReason = this.optionalString(body.cancel_reason);
      if (!cancelReason) throw new BadRequestException("cancel_reason is required");
      const before = await this.requireRecord(client, "collection_actions", request.auth.tenantId, id, "collection action not found");
      if (before.action_status === "completed" && !body.override_reasons) throw new BadRequestException("completed action requires override to cancel");
      const after = await updateTenantRecord(client, "collection_actions", request.auth.tenantId, id, {
        action_status: "cancelled",
        note: this.optionalString(body.cancel_note) ?? cancelReason,
        override_reasons: this.objectValue(body.override_reasons),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("collection action not found");
      return { entityType: "collection_action", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("collection-cases/:id/recalculate")
  @RequirePermission("collection_case.update")
  async recalculateCollectionCase(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "collection_case.update", "collection_case.recalculated", "collection_case", async (client) => {
      const before = await this.requireCollectionCaseContext(client, request.auth.tenantId, id);
      const after = await this.refreshCollectionCaseFromInvoice(client, request.auth.tenantId, before, request.auth.userId);
      return { entityType: "collection_case", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("collection-cases/:id/close")
  @RequirePermission("collection_case.close")
  async closeCollectionCase(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_case.close", "collection_case.closed", "collection_case", async (client) => {
      if (!this.optionalString(body.close_reason)) throw new BadRequestException("close_reason is required");
      const closeReason = this.allowed(body.close_reason, "close_reason", collectionCloseReasons);
      const before = await this.requireCollectionCaseContext(client, request.auth.tenantId, id);
      if (before.case_status === "archived") throw new BadRequestException("archived collection cases are view-only");
      if (Number(before.invoice_balance_amount ?? before.current_balance ?? 0) > 0 && !body.override_reasons && !["unresolved_close", "future_writeoff_review"].includes(closeReason)) {
        throw new BadRequestException("closing an unresolved balance requires override");
      }
      const status = ["paid", "resolved"].includes(closeReason) ? "resolved" : "closed";
      const after = await updateTenantRecord(client, "collection_cases", request.auth.tenantId, id, {
        case_status: status,
        closed_at: new Date(),
        close_reason: closeReason,
        close_note: this.optionalString(body.close_note),
        override_reasons: this.objectValue(body.override_reasons),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("collection case not found");
      return {
        entityType: "collection_case",
        entityId: id,
        beforeState: before,
        afterState: after,
        additionalEvents: [this.additionalEvent("collection_case.close", "invoice", before.invoice_id, "invoice.collection_case_closed", { ...before, collection_case_status: status }, before)],
      };
    });
  }

  @Post("collection-cases/:id/archive")
  @RequirePermission("collection_case.archive")
  async archiveCollectionCase(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_case.archive", "collection_case.archived", "collection_case", async (client) => {
      const archiveReason = this.optionalString(body.archive_reason);
      if (!archiveReason) throw new BadRequestException("archive_reason is required");
      const before = await this.requireRecord(client, "collection_cases", request.auth.tenantId, id, "collection case not found");
      const after = await updateTenantRecord(client, "collection_cases", request.auth.tenantId, id, {
        case_status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: archiveReason,
        archive_note: this.optionalString(body.archive_note),
        deleted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("collection case not found");
      return { entityType: "collection_case", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("collection-actions")
  @RequirePermission("collection_action.read")
  async listCollectionActions(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["ca.tenant_id = $1"];
      if (query.archived !== "true") where.push("ca.deleted_at IS NULL", "ca.action_status <> 'archived'");
      this.addFilter(where, values, "ca.collection_case_id", query.collection_case_id);
      this.addFilter(where, values, "ca.invoice_id", query.invoice_id);
      this.addFilter(where, values, "ca.customer_organization_id", query.customer_organization_id);
      this.addFilter(where, values, "ca.action_type", query.action_type);
      this.addFilter(where, values, "ca.action_status", query.action_status);
      this.addFilter(where, values, "ca.actor_user_id", query.actor_user_id);
      if (query.action_date_from) this.addDateFilter(where, values, "ca.action_date", ">=", query.action_date_from);
      if (query.action_date_to) this.addDateFilter(where, values, "ca.action_date", "<=", query.action_date_to);
      if (query.due_at_from) this.addDateFilter(where, values, "ca.due_at", ">=", query.due_at_from);
      if (query.due_at_to) this.addDateFilter(where, values, "ca.due_at", "<=", query.due_at_to);
      if (query.follow_up_due_from) this.addDateFilter(where, values, "ca.follow_up_due_at", ">=", query.follow_up_due_from);
      if (query.follow_up_due_to) this.addDateFilter(where, values, "ca.follow_up_due_at", "<=", query.follow_up_due_to);
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        const index = values.length;
        where.push(`(cc.case_number ILIKE $${index} OR i.invoice_number ILIKE $${index} OR co.name ILIKE $${index} OR ca.note ILIKE $${index} OR ca.dispute_reason ILIKE $${index} OR ca.escalation_reason ILIKE $${index} OR ca.outcome ILIKE $${index})`);
      }
      const result = await client.query(
        `
        SELECT ca.*, cc.case_number, i.invoice_number, co.name AS customer_organization_name, u.display_name AS actor_name
        FROM collection_actions ca
        JOIN collection_cases cc ON cc.tenant_id = ca.tenant_id AND cc.id = ca.collection_case_id
        JOIN invoices i ON i.tenant_id = ca.tenant_id AND i.id = ca.invoice_id
        LEFT JOIN organizations co ON co.tenant_id = ca.tenant_id AND co.id = ca.customer_organization_id
        LEFT JOIN users u ON u.id = ca.actor_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY ${this.collectionActionSort(query.sort)}
        LIMIT 100
        `,
        values,
      );
      return result.rows.map((row) => this.withCollectionActionGuidance(row));
    });
  }

  @Get("collection-actions/:id")
  @RequirePermission("collection_action.read")
  async getCollectionAction(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "collection_actions", request.auth.tenantId, id, "collection action not found"));
  }

  @Get("collection-actions/:id/detail")
  @RequirePermission("collection_action.read")
  async getCollectionActionDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const action = await this.requireCollectionActionContext(client, request.auth.tenantId, id);
      return {
        action: this.withCollectionActionGuidance(action),
        case_context: { id: action.collection_case_id, case_number: action.case_number, case_status: action.case_status },
        invoice_context: { id: action.invoice_id, invoice_number: action.invoice_number, balance_amount: action.invoice_balance_amount, collection_status: action.collection_status },
        customer_context: { id: action.customer_organization_id, name: action.customer_organization_name },
        actor_context: { id: action.actor_user_id, name: action.actor_name },
        boundary_summary: { creates_cash_receipt: false, creates_payment_application: false, updates_invoice_balance: false, sends_message: false },
        audit_allowed: true,
      };
    });
  }

  @Patch("collection-actions/:id")
  @RequirePermission("collection_action.update")
  async updateCollectionAction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_action.update", "collection_action.updated", "collection_action", async (client) => {
      const before = await this.requireRecord(client, "collection_actions", request.auth.tenantId, id, "collection action not found");
      if (before.action_status === "archived") throw new BadRequestException("archived collection actions are view-only");
      const values = pick(body, ["due_at", "note", "follow_up_required", "follow_up_due_at", "evidence_reference", "override_reasons"]);
      if (body.action_status !== undefined) values.action_status = this.allowed(body.action_status, "action_status", collectionActionStatuses);
      if (body.contact_method !== undefined) values.contact_method = this.allowed(body.contact_method, "contact_method", collectionContactMethods);
      if (body.outcome !== undefined) values.outcome = this.allowed(body.outcome, "outcome", collectionOutcomes);
      values.updated_by = request.auth.userId;
      const after = await updateTenantRecord(client, "collection_actions", request.auth.tenantId, id, values);
      if (!after) throw new NotFoundException("collection action not found");
      return { entityType: "collection_action", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("collection-actions/:id/archive")
  @RequirePermission("collection_action.archive")
  async archiveCollectionAction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "collection_action.archive", "collection_action.archived", "collection_action", async (client) => {
      const archiveReason = this.optionalString(body.archive_reason);
      if (!archiveReason) throw new BadRequestException("archive_reason is required");
      const before = await this.requireRecord(client, "collection_actions", request.auth.tenantId, id, "collection action not found");
      const after = await updateTenantRecord(client, "collection_actions", request.auth.tenantId, id, {
        action_status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: archiveReason,
        archive_note: this.optionalString(body.archive_note),
        deleted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("collection action not found");
      return { entityType: "collection_action", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("collection-cases/:id/timeline")
  @RequirePermission("collection_case.timeline.read")
  async collectionCaseTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const collectionCase = await this.requireRecordIncludingArchived(client, "collection_cases", request.auth.tenantId, id, "collection case not found");
      const result = await client.query(
        `
        SELECT e.event_type, e.actor_user_id AS actor, e.occurred_at AS timestamp, e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'collection_case' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'collection_action' AND e.aggregate_id IN (SELECT id FROM collection_actions WHERE tenant_id = $1 AND collection_case_id = $2))
            OR (e.aggregate_type = 'invoice' AND e.aggregate_id = $3)
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, collectionCase.invoice_id],
      );
      return result.rows;
    });
  }

  @Get("collection-actions/:id/timeline")
  @RequirePermission("collection_action.timeline.read")
  async collectionActionTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const action = await this.requireRecordIncludingArchived(client, "collection_actions", request.auth.tenantId, id, "collection action not found");
      const result = await client.query(
        `
        SELECT e.event_type, e.actor_user_id AS actor, e.occurred_at AS timestamp, e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'collection_action' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'collection_case' AND e.aggregate_id = $3)
            OR (e.aggregate_type = 'invoice' AND e.aggregate_id = $4)
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, action.collection_case_id, action.invoice_id],
      );
      return result.rows;
    });
  }

  @Get("collection-cases/:id/audit-summary")
  @RequirePermission("collection_case.audit.read")
  async collectionCaseAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const collectionCase = await this.requireRecordIncludingArchived(client, "collection_cases", request.auth.tenantId, id, "collection case not found");
      const result = await client.query(
        `
        SELECT actor_user_id AS actor, action, entity_type AS object, entity_id AS object_id, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id
        FROM audit_logs
        WHERE tenant_id = $1
          AND (
            (entity_type = 'collection_case' AND entity_id = $2)
            OR (entity_type = 'collection_action' AND entity_id IN (SELECT id FROM collection_actions WHERE tenant_id = $1 AND collection_case_id = $2))
            OR (entity_type = 'invoice' AND entity_id = $3)
          )
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, collectionCase.invoice_id],
      );
      return result.rows;
    });
  }

  @Get("collection-actions/:id/audit-summary")
  @RequirePermission("collection_action.audit.read")
  async collectionActionAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const action = await this.requireRecordIncludingArchived(client, "collection_actions", request.auth.tenantId, id, "collection action not found");
      const result = await client.query(
        `
        SELECT actor_user_id AS actor, action, entity_type AS object, entity_id AS object_id, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id
        FROM audit_logs
        WHERE tenant_id = $1
          AND (
            (entity_type = 'collection_action' AND entity_id = $2)
            OR (entity_type = 'collection_case' AND entity_id = $3)
            OR (entity_type = 'invoice' AND entity_id = $4)
          )
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, action.collection_case_id, action.invoice_id],
      );
      return result.rows;
    });
  }

  @Get("cash-receipts")
  @RequirePermission("cash_receipt.read")
  async listCashReceipts(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["cr.tenant_id = $1", "cr.deleted_at IS NULL"];
      if (query.archived !== "true") where.push("cr.receipt_status <> 'archived'");
      this.addFilter(where, values, "cr.customer_organization_id", query.customer_organization_id);
      this.addFilter(where, values, "cr.payment_method", query.payment_method);
      this.addFilter(where, values, "cr.receipt_status", query.receipt_status);
      this.addFilter(where, values, "cr.deposit_status", query.deposit_status);
      this.addFilter(where, values, "cr.reconciliation_status", query.reconciliation_status);
      this.addFilter(where, values, "cr.source_type", query.source_type);
      if (query.payment_date_from) this.addDateFilter(where, values, "cr.payment_date", ">=", query.payment_date_from);
      if (query.payment_date_to) this.addDateFilter(where, values, "cr.payment_date", "<=", query.payment_date_to);
      if (query.has_unapplied === "true") where.push("cr.unapplied_amount > 0");
      if (query.has_unapplied === "false") where.push("cr.unapplied_amount = 0");
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        const index = values.length;
        where.push(`(cr.receipt_number ILIKE $${index} OR cr.payment_reference ILIKE $${index} OR cr.external_transaction_id ILIKE $${index} OR cr.payer_name ILIKE $${index} OR co.name ILIKE $${index})`);
      }
      const result = await client.query(
        `
        SELECT cr.*, co.name AS customer_organization_name,
          COALESCE(apps.application_count, 0)::int AS application_count,
          COALESCE(apps.invoice_count, 0)::int AS invoice_count
        FROM cash_receipts cr
        LEFT JOIN organizations co ON co.tenant_id = cr.tenant_id AND co.id = cr.customer_organization_id
        LEFT JOIN (
          SELECT tenant_id, cash_receipt_id, count(*) AS application_count, count(DISTINCT invoice_id) AS invoice_count
          FROM payment_applications
          WHERE deleted_at IS NULL AND application_status NOT IN ('voided', 'archived')
          GROUP BY tenant_id, cash_receipt_id
        ) apps ON apps.tenant_id = cr.tenant_id AND apps.cash_receipt_id = cr.id
        WHERE ${where.join(" AND ")}
        ORDER BY ${this.cashReceiptSort(query.sort)}
        LIMIT 100
        `,
        values,
      );
      return result.rows.map((row) => this.withCashReceiptGuidance(row));
    });
  }

  @Get("cash-receipts/:id")
  @RequirePermission("cash_receipt.read")
  async getCashReceipt(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found"));
  }

  @Get("cash-receipts/:id/detail")
  @RequirePermission("cash_receipt.read")
  async getCashReceiptDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const receipt = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
      const applications = await this.listPaymentApplicationsForReceipt(client, request.auth.tenantId, id);
      const customer = receipt.customer_organization_id ? await this.optionalRecord(client, "organizations", request.auth.tenantId, String(receipt.customer_organization_id)) : null;
      return {
        cash_receipt: this.withCashReceiptGuidance({ ...receipt, application_count: applications.length, invoice_count: new Set(applications.map((row) => row.invoice_id)).size }),
        customer_context: customer ? { id: customer.id, name: customer.name, status: customer.status } : null,
        payment_applications: applications,
        applied_invoices: applications.map((row) => ({ invoice_id: row.invoice_id, invoice_number: row.invoice_number, applied_amount: row.applied_amount, balance_amount: row.invoice_balance_amount })),
        unapplied_summary: { gross_received_amount: receipt.gross_received_amount, applied_amount: receipt.applied_amount, unapplied_amount: receipt.unapplied_amount },
        boundary_summary: { creates_bank_transaction: false, creates_payroll: false, creates_tax: false, creates_accounting_export: false, creates_ar_record: false },
        warnings: [],
        blockers: this.cashReceiptBlockers(receipt),
        recommended_next_action: this.recommendedCashReceiptAction(receipt),
        timeline_available: true,
        audit_allowed: true,
      };
    });
  }

  @Post("cash-receipts")
  @RequirePermission("cash_receipt.create")
  async createCashReceipt(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "cash_receipt.create", "cash_receipt.created", "cash_receipt", async (client) => {
        const gross = this.requirePositive(body.gross_received_amount, "gross_received_amount");
        const paymentDate = this.requireDate(body.payment_date, "payment_date");
        const customerId = this.optionalString(body.customer_organization_id);
        if (customerId) await this.requireRecord(client, "organizations", request.auth.tenantId, customerId, "customer organization not found");
        const receipt = await insertTenantRecord(client, "cash_receipts", request.auth.tenantId, {
          receipt_number: await this.nextReceiptNumber(client, request.auth.tenantId),
          customer_organization_id: customerId ?? null,
          payer_name: this.optionalString(body.payer_name),
          payment_date: paymentDate,
          received_at: new Date(),
          payment_method: this.allowed(body.payment_method, "payment_method", cashPaymentMethods),
          payment_reference: this.optionalString(body.payment_reference),
          external_transaction_id: this.optionalString(body.external_transaction_id),
          gross_received_amount: gross,
          applied_amount: 0,
          unapplied_amount: gross,
          currency: this.optionalString(body.currency) ?? "USD",
          receipt_status: "unapplied",
          deposit_status: "not_deposited",
          reconciliation_status: "not_reconciled",
          source_type: this.allowed(body.source_type ?? "manual", "source_type", cashSourceTypes),
          notes: this.optionalString(body.notes),
          evidence_reference: this.optionalString(body.evidence_reference),
          override_reasons: this.objectValue(body.override_reasons),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        return { entityType: "cash_receipt", entityId: receipt.id, afterState: receipt };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("cash-receipts/:id")
  @RequirePermission("cash_receipt.update")
  async updateCashReceipt(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "cash_receipt.update", "cash_receipt.updated", "cash_receipt", async (client) => {
        const before = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
        if (["voided", "archived"].includes(String(before.receipt_status))) throw new BadRequestException("cash receipt cannot be edited in its current status");
        const values: Record<string, unknown> = pick(body, ["payer_name", "payment_reference", "external_transaction_id", "evidence_reference", "notes", "override_reasons"]);
        const activeApplications = await this.activePaymentApplicationCount(client, request.auth.tenantId, id);
        if (body.customer_organization_id !== undefined) {
          if (activeApplications > 0) throw new BadRequestException("customer cannot be changed after applications exist");
          const customerId = this.optionalString(body.customer_organization_id);
          if (customerId) await this.requireRecord(client, "organizations", request.auth.tenantId, customerId, "customer organization not found");
          values.customer_organization_id = customerId ?? null;
        }
        if (body.payment_method !== undefined) values.payment_method = this.allowed(body.payment_method, "payment_method", cashPaymentMethods);
        if (body.payment_date !== undefined) values.payment_date = this.requireDate(body.payment_date, "payment_date");
        if (body.gross_received_amount !== undefined) {
          const gross = this.requirePositive(body.gross_received_amount, "gross_received_amount");
          const applied = Number(before.applied_amount ?? 0);
          if (gross < applied) throw new BadRequestException("gross_received_amount cannot be below applied_amount");
          values.gross_received_amount = gross;
          values.unapplied_amount = this.roundMoney(gross - applied);
          values.receipt_status = this.receiptStatus(gross, applied);
        }
        values.updated_by = request.auth.userId;
        const after = await updateTenantRecord(client, "cash_receipts", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("cash receipt not found");
        return { entityType: "cash_receipt", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("cash-receipts/:id/apply")
  @RequirePermission("cash_receipt.apply")
  async applyCashReceipt(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return await this.write(request, "payment_application.create", "payment_application.created", "payment_application", async (client) => {
        const receipt = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
        if (["voided", "archived"].includes(String(receipt.receipt_status))) throw new BadRequestException("cash receipt cannot be applied in its current status");
        const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, this.requiredId(body.invoice_id, "invoice_id"), "invoice not found");
        if (["voided", "archived"].includes(String(invoice.status))) throw new BadRequestException("invoice cannot receive payment in its current status");
        const override = !!body.override_reasons;
        if (invoice.cash_application_status !== "ready_for_cash_application" && !override) throw new BadRequestException("invoice must be ready for cash application");
        if (invoice.status === "disputed" && !override) throw new BadRequestException("disputed invoice requires override");
        if (receipt.customer_organization_id && (invoice.customer_organization_id ?? invoice.organization_id) !== receipt.customer_organization_id && !override) throw new BadRequestException("receipt customer must match invoice customer");
        const original = Number(invoice.original_amount || invoice.total_amount || 0);
        const balance = Number(invoice.balance_amount ?? original);
        if (original <= 0 || !Number.isFinite(balance)) throw new BadRequestException("invoice receivable state is not locked");
        const requestedAmount = this.requirePositive(body.applied_amount, "applied_amount");
        const receiptUnapplied = Number(receipt.unapplied_amount ?? 0);
        if (requestedAmount > receiptUnapplied && !override) throw new BadRequestException("applied_amount cannot exceed receipt unapplied amount");
        if (requestedAmount > balance) throw new BadRequestException("overpayment remains unapplied by default");
        const applicationDate = body.application_date === undefined ? new Date().toISOString().slice(0, 10) : this.requireDate(body.application_date, "application_date");
        const applicationType = this.allowed(body.application_type ?? (requestedAmount < balance ? "partial_payment" : "standard_payment"), "application_type", paymentApplicationTypes);
        const customerId = String(invoice.customer_organization_id ?? invoice.organization_id);
        const application = await insertTenantRecord(client, "payment_applications", request.auth.tenantId, {
          cash_receipt_id: receipt.id,
          invoice_id: invoice.id,
          customer_organization_id: customerId,
          applied_amount: requestedAmount,
          application_date: applicationDate,
          application_status: requestedAmount < balance ? "partially_applied" : "applied",
          application_type: applicationType,
          note: this.optionalString(body.note),
          writeoff_amount: body.writeoff_amount === undefined ? null : this.requireNonNegative(body.writeoff_amount, "writeoff_amount"),
          discount_amount: body.discount_amount === undefined ? null : this.requireNonNegative(body.discount_amount, "discount_amount"),
          adjustment_amount: body.adjustment_amount === undefined ? null : Number(body.adjustment_amount),
          override_reasons: this.objectValue(body.override_reasons),
          created_by: request.auth.userId,
          updated_by: request.auth.userId,
        });
        const nextReceipt = await this.recalculateCashReceipt(client, request.auth.tenantId, String(receipt.id), request.auth.userId);
        const beforeInvoice = invoice;
        const afterInvoice = await this.applyAmountToInvoice(client, request.auth.tenantId, invoice, requestedAmount, applicationDate, request.auth.userId);
        return {
          entityType: "payment_application",
          entityId: application.id,
          beforeState: { cash_receipt: receipt, invoice: beforeInvoice },
          afterState: application,
          additionalEvents: [
            this.additionalEvent("cash_receipt.apply", "cash_receipt", receipt.id, "cash_receipt.applied", nextReceipt, receipt),
            this.additionalEvent("invoice.cash_application.update", "invoice", invoice.id, "invoice.payment_applied", afterInvoice, beforeInvoice),
            this.additionalEvent("invoice.cash_application.update", "invoice", invoice.id, "invoice.balance_updated", afterInvoice, beforeInvoice),
          ],
        };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("cash-receipts/:id/void")
  @RequirePermission("cash_receipt.void")
  async voidCashReceipt(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "cash_receipt.void", "cash_receipt.voided", "cash_receipt", async (client) => {
      const voidReason = requireString(body.void_reason, "void_reason is required");
      const before = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
      if (await this.activePaymentApplicationCount(client, request.auth.tenantId, id)) throw new BadRequestException("cash receipt cannot be voided with active applications");
      const after = await updateTenantRecord(client, "cash_receipts", request.auth.tenantId, id, {
        receipt_status: "voided",
        voided_by: request.auth.userId,
        voided_at: new Date(),
        void_reason: voidReason,
        void_note: this.optionalString(body.void_note),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("cash receipt not found");
      return { entityType: "cash_receipt", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("cash-receipts/:id/archive")
  @RequirePermission("cash_receipt.archive")
  async archiveCashReceipt(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "cash_receipt.archive", "cash_receipt.archived", "cash_receipt", async (client) => {
      const archiveReason = requireString(body.archive_reason, "archive_reason is required");
      const before = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
      const after = await updateTenantRecord(client, "cash_receipts", request.auth.tenantId, id, {
        receipt_status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: archiveReason,
        archive_note: this.optionalString(body.archive_note),
        deleted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("cash receipt not found");
      return { entityType: "cash_receipt", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("payment-applications")
  @RequirePermission("payment_application.read")
  async listPaymentApplications(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["pa.tenant_id = $1", "pa.deleted_at IS NULL"];
      if (query.archived !== "true") where.push("pa.application_status <> 'archived'");
      this.addFilter(where, values, "pa.cash_receipt_id", query.cash_receipt_id);
      this.addFilter(where, values, "pa.invoice_id", query.invoice_id);
      this.addFilter(where, values, "pa.customer_organization_id", query.customer_organization_id);
      this.addFilter(where, values, "pa.application_status", query.application_status);
      this.addFilter(where, values, "pa.application_type", query.application_type);
      if (query.application_date_from) this.addDateFilter(where, values, "pa.application_date", ">=", query.application_date_from);
      if (query.application_date_to) this.addDateFilter(where, values, "pa.application_date", "<=", query.application_date_to);
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`);
        const index = values.length;
        where.push(`(cr.receipt_number ILIKE $${index} OR cr.payment_reference ILIKE $${index} OR i.invoice_number ILIKE $${index} OR co.name ILIKE $${index})`);
      }
      const result = await client.query(
        `
        SELECT pa.*, cr.receipt_number, cr.payment_reference, i.invoice_number, i.balance_amount AS invoice_balance_amount, co.name AS customer_organization_name
        FROM payment_applications pa
        JOIN cash_receipts cr ON cr.tenant_id = pa.tenant_id AND cr.id = pa.cash_receipt_id
        JOIN invoices i ON i.tenant_id = pa.tenant_id AND i.id = pa.invoice_id
        LEFT JOIN organizations co ON co.tenant_id = pa.tenant_id AND co.id = pa.customer_organization_id
        WHERE ${where.join(" AND ")}
        ORDER BY pa.application_date DESC, pa.updated_at DESC
        LIMIT 100
        `,
        values,
      );
      return result.rows;
    });
  }

  @Get("payment-applications/:id")
  @RequirePermission("payment_application.read")
  async getPaymentApplication(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "payment_applications", request.auth.tenantId, id, "payment application not found"));
  }

  @Get("payment-applications/:id/detail")
  @RequirePermission("payment_application.read")
  async getPaymentApplicationDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const application = await this.requireRecord(client, "payment_applications", request.auth.tenantId, id, "payment application not found");
      const receipt = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, String(application.cash_receipt_id), "cash receipt not found");
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, String(application.invoice_id), "invoice not found");
      const customer = await this.optionalRecord(client, "organizations", request.auth.tenantId, String(application.customer_organization_id));
      return {
        application,
        cash_receipt_context: { id: receipt.id, receipt_number: receipt.receipt_number, payment_reference: receipt.payment_reference },
        invoice_context: { id: invoice.id, invoice_number: invoice.invoice_number, paid_amount: invoice.paid_amount, balance_amount: invoice.balance_amount },
        customer_context: customer ? { id: customer.id, name: customer.name } : null,
        before_after_invoice_balance: application.override_reasons,
        audit_allowed: true,
      };
    });
  }

  @Post("payment-applications/:id/void")
  @RequirePermission("payment_application.void")
  async voidPaymentApplication(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "payment_application.void", "payment_application.voided", "payment_application", async (client) => {
      const voidReason = requireString(body.void_reason, "void_reason is required");
      const before = await this.requireRecord(client, "payment_applications", request.auth.tenantId, id, "payment application not found");
      if (["voided", "archived"].includes(String(before.application_status))) throw new BadRequestException("payment application is already inactive");
      const receipt = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, String(before.cash_receipt_id), "cash receipt not found");
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, String(before.invoice_id), "invoice not found");
      if (["voided", "archived"].includes(String(receipt.receipt_status))) throw new BadRequestException("cash receipt cannot reverse applications in its current status");
      if (["voided", "archived"].includes(String(invoice.status))) throw new BadRequestException("invoice cannot be updated in its current status");
      const after = await updateTenantRecord(client, "payment_applications", request.auth.tenantId, id, {
        application_status: "voided",
        voided_by: request.auth.userId,
        voided_at: new Date(),
        void_reason: voidReason,
        void_note: this.optionalString(body.void_note),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("payment application not found");
      const nextReceipt = await this.recalculateCashReceipt(client, request.auth.tenantId, String(before.cash_receipt_id), request.auth.userId);
      const nextInvoice = await this.reverseAmountFromInvoice(client, request.auth.tenantId, invoice, Number(before.applied_amount), request.auth.userId);
      return {
        entityType: "payment_application",
        entityId: id,
        beforeState: before,
        afterState: after,
        additionalEvents: [
          this.additionalEvent("cash_receipt.update", "cash_receipt", receipt.id, "cash_receipt.updated", nextReceipt, receipt),
          this.additionalEvent("invoice.cash_application.update", "invoice", invoice.id, "invoice.payment_application_voided", nextInvoice, invoice),
          this.additionalEvent("invoice.cash_application.update", "invoice", invoice.id, "invoice.balance_updated", nextInvoice, invoice),
        ],
      };
    });
  }

  @Post("payment-applications/:id/archive")
  @RequirePermission("payment_application.archive")
  async archivePaymentApplication(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "payment_application.archive", "payment_application.archived", "payment_application", async (client) => {
      const archiveReason = requireString(body.archive_reason, "archive_reason is required");
      const before = await this.requireRecord(client, "payment_applications", request.auth.tenantId, id, "payment application not found");
      const after = await updateTenantRecord(client, "payment_applications", request.auth.tenantId, id, {
        application_status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: archiveReason,
        archive_note: this.optionalString(body.archive_note),
        deleted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("payment application not found");
      return { entityType: "payment_application", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("cash-receipts/:id/timeline")
  @RequirePermission("cash_receipt.timeline.read")
  async cashReceiptTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
      const result = await client.query(
        `
        SELECT e.event_type, e.actor_user_id AS actor, e.occurred_at AS timestamp, e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'cash_receipt' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'payment_application' AND e.aggregate_id IN (SELECT id FROM payment_applications WHERE tenant_id = $1 AND cash_receipt_id = $2))
            OR (e.aggregate_type = 'invoice' AND e.aggregate_id IN (SELECT invoice_id FROM payment_applications WHERE tenant_id = $1 AND cash_receipt_id = $2))
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("payment-applications/:id/timeline")
  @RequirePermission("payment_application.timeline.read")
  async paymentApplicationTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const application = await this.requireRecord(client, "payment_applications", request.auth.tenantId, id, "payment application not found");
      const result = await client.query(
        `
        SELECT e.event_type, e.actor_user_id AS actor, e.occurred_at AS timestamp, e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'payment_application' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'cash_receipt' AND e.aggregate_id = $3)
            OR (e.aggregate_type = 'invoice' AND e.aggregate_id = $4)
          )
        ORDER BY e.occurred_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, application.cash_receipt_id, application.invoice_id],
      );
      return result.rows;
    });
  }

  @Get("cash-receipts/:id/audit-summary")
  @RequirePermission("cash_receipt.audit.read")
  async cashReceiptAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
      const result = await client.query(
        `
        SELECT actor_user_id AS actor, action, entity_type AS object, entity_id AS object_id, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id
        FROM audit_logs
        WHERE tenant_id = $1
          AND (
            (entity_type = 'cash_receipt' AND entity_id = $2)
            OR (entity_type = 'payment_application' AND entity_id IN (SELECT id FROM payment_applications WHERE tenant_id = $1 AND cash_receipt_id = $2))
            OR (entity_type = 'invoice' AND entity_id IN (SELECT invoice_id FROM payment_applications WHERE tenant_id = $1 AND cash_receipt_id = $2))
          )
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  @Get("payment-applications/:id/audit-summary")
  @RequirePermission("payment_application.audit.read")
  async paymentApplicationAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const application = await this.requireRecord(client, "payment_applications", request.auth.tenantId, id, "payment application not found");
      const result = await client.query(
        `
        SELECT actor_user_id AS actor, action, entity_type AS object, entity_id AS object_id, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id
        FROM audit_logs
        WHERE tenant_id = $1
          AND (
            (entity_type = 'payment_application' AND entity_id = $2)
            OR (entity_type = 'cash_receipt' AND entity_id = $3)
            OR (entity_type = 'invoice' AND entity_id = $4)
          )
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, id, application.cash_receipt_id, application.invoice_id],
      );
      return result.rows;
    });
  }

  @Get("ar-records")
  @RequirePermission("ar.read")
  async listArRecords(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT ar.*, i.due_date
        FROM ar_records ar
        JOIN invoices i ON i.id = ar.invoice_id
        WHERE ar.tenant_id = $1
          AND ar.deleted_at IS NULL
        ORDER BY ar.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId],
      );
      return result.rows.map((row) => this.withCurrentAging(row));
    });
  }

  @Get("ar-records/:id")
  @RequirePermission("ar.read")
  async getArRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT ar.*, i.due_date
        FROM ar_records ar
        JOIN invoices i ON i.id = ar.invoice_id
        WHERE ar.tenant_id = $1
          AND ar.id = $2
          AND ar.deleted_at IS NULL
        LIMIT 1
        `,
        [request.auth.tenantId, id],
      );
      if (!result.rows[0]) throw new NotFoundException("AR record not found");
      return this.withCurrentAging(result.rows[0]);
    });
  }

  @Post("ar-records/:id/archive")
  @RequirePermission("ar.archive")
  async archiveArRecord(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "ar.archive", "ar_record.archived", "ar_record", async (client) => {
      const before = await this.requireRecord(client, "ar_records", request.auth.tenantId, id, "AR record not found");
      const after = await updateTenantRecord(client, "ar_records", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("AR record not found");
      return { entityType: "ar_record", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Get("payments")
  @RequirePermission("payment.read")
  async listPayments(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "payments", request.auth.tenantId, { searchColumns: ["payment_reference", "status"] }));
  }

  @Get("payments/:id")
  @RequirePermission("payment.read")
  async getPayment(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "payments", request.auth.tenantId, id, "payment not found"));
  }

  @Post("payments")
  @RequirePermission("payment.create")
  async createPayment(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const paymentDate = requireString(body.payment_date, "payment_date is required");
      const paymentReference = requireString(body.payment_reference, "payment_reference is required");
      const paymentAmount = this.requirePositive(body.payment_amount ?? body.amount, "payment_amount");
      return await this.write(request, "payment.create", "payment.created", "payment", async (client) => {
        const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, this.requiredId(body.invoice_id, "invoice_id"), "invoice not found");
        const settlement = await this.requireRecord(client, "settlements", request.auth.tenantId, this.requiredId(body.settlement_id, "settlement_id"), "settlement not found");
        if (invoice.settlement_id !== settlement.id) throw new BadRequestException("settlement must match invoice");
        const payment = await insertTenantRecord(client, "payments", request.auth.tenantId, {
          invoice_id: invoice.id,
          settlement_id: settlement.id,
          payment_date: paymentDate,
          amount: paymentAmount,
          payment_amount: paymentAmount,
          payment_reference: paymentReference,
          status: "recorded",
        });
        return { entityType: "payment", entityId: payment.id, afterState: payment };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("payments/:id")
  @RequirePermission("payment.update")
  async updatePayment(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
      const values = pick(body, ["payment_date", "payment_reference"]);
      if (body.payment_amount !== undefined || body.amount !== undefined) {
        const paymentAmount = this.requirePositive(body.payment_amount ?? body.amount, "payment_amount");
        values.amount = paymentAmount;
        values.payment_amount = paymentAmount;
      }
      return await this.write(request, "payment.update", "payment.updated", "payment", async (client) => {
        const before = await this.requireRecord(client, "payments", request.auth.tenantId, id, "payment not found");
        if (body.invoice_id) {
          await this.requireRecord(client, "invoices", request.auth.tenantId, this.requiredId(body.invoice_id, "invoice_id"), "invoice not found");
          values.invoice_id = body.invoice_id;
        }
        if (body.settlement_id) {
          await this.requireRecord(client, "settlements", request.auth.tenantId, this.requiredId(body.settlement_id, "settlement_id"), "settlement not found");
          values.settlement_id = body.settlement_id;
        }
        const after = await updateTenantRecord(client, "payments", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("payment not found");
        return { entityType: "payment", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("payments/:id/reconcile")
  @RequirePermission("payment.reconcile")
  async reconcilePayment(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "payment.reconcile", "payment.reconciled", "payment", async (client) => {
      const before = await this.requireRecord(client, "payments", request.auth.tenantId, id, "payment not found");
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, String(before.invoice_id), "invoice not found");
      const invoiceAmount = Number(invoice.invoice_amount);
      const paymentAmount = Number(before.payment_amount ?? before.amount);
      let status = "reconciled";
      let eventType = "payment.reconciled";
      let amountOpen = 0;
      let shortPayAmount = 0;
      let overpayAmount = 0;
      if (paymentAmount < invoiceAmount) {
        status = "short_paid";
        eventType = "payment.short_paid";
        amountOpen = invoiceAmount - paymentAmount;
        shortPayAmount = amountOpen;
      } else if (paymentAmount > invoiceAmount) {
        status = "overpaid";
        eventType = "payment.overpaid";
        overpayAmount = paymentAmount - invoiceAmount;
      }
      const arRecord = await this.requireArRecordByInvoice(client, request.auth.tenantId, String(invoice.id));
      const priorAmountOpen = Number(arRecord.amount_open);
      await updateTenantRecord(client, "ar_records", request.auth.tenantId, String(arRecord.id), {
        amount_open: amountOpen,
        balance: amountOpen,
        status,
      });
      const stats = await this.updateCustomerPaymentStats(client, request.auth.tenantId, invoice, before, status);
      const after = await updateTenantRecord(client, "payments", request.auth.tenantId, id, {
        status,
        short_pay_amount: shortPayAmount,
        overpay_amount: overpayAmount,
        reconciled_at: new Date(),
      });
      if (!after) throw new NotFoundException("payment not found");
      return {
        entityType: "payment",
        entityId: id,
        eventType,
        beforeState: before,
        afterState: {
          ...after,
          invoice_id: invoice.id,
          ar_record_id: arRecord.id,
          prior_amount_open: priorAmountOpen,
          new_amount_open: amountOpen,
          reconciliation_outcome: status,
          customer_organization_id: invoice.organization_id,
          ...stats,
        },
      };
    });
  }

  @Post("payments/:id/archive")
  @RequirePermission("payment.archive")
  async archivePayment(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "payments", id, "payment", "payment.archive", "payment.archived");
  }

  private submitInvoiceForReview(request: AuthenticatedRequest, id: string, body: Record<string, unknown>, action: string, eventType: string, requireItems = false) {
    return this.write(request, action, eventType, "invoice", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, invoiceAuthorityRoles, "Billing Manager or Finance Manager authority is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (!["draft", "assembling"].includes(String(before.status))) throw new BadRequestException("invoice must be draft or assembling");
      requireString(before.invoice_number, "invoice_number is required");
      if (!before.invoice_date) throw new BadRequestException("invoice_date is required");
      if (!before.due_date) throw new BadRequestException("due_date is required");
      const itemCount = await this.activeInvoiceItemCount(client, request.auth.tenantId, id);
      if (requireItems && itemCount === 0) throw new BadRequestException("invoice requires at least one item");
      if (itemCount === 0 && Number(before.total_amount ?? before.invoice_amount ?? 0) <= 0) throw new BadRequestException("invoice requires at least one item");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, {
        status: "ready_for_review",
        approval_status: "pending",
        submitted_by: request.auth.userId,
        submitted_at: new Date(),
        updated_by: request.auth.userId,
      });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    }, body.reason);
  }

  private addFilter(where: string[], values: unknown[], column: string, value: string | undefined) {
    if (!value) return;
    values.push(value);
    where.push(`${column} = $${values.length}`);
  }

  private addDateFilter(where: string[], values: unknown[], column: string, operator: ">=" | "<=", value: string) {
    values.push(value);
    where.push(`${column} ${operator} $${values.length}`);
  }

  private invoiceSort(sort?: string) {
    switch (sort) {
      case "invoice_date_desc":
        return "i.invoice_date DESC NULLS LAST, i.updated_at DESC";
      case "due_date_asc":
        return "i.due_date ASC NULLS LAST, i.updated_at DESC";
      case "total_amount_desc":
        return "i.total_amount DESC, i.updated_at DESC";
      case "balance_amount_desc":
        return "i.balance_amount DESC, i.updated_at DESC";
      case "aging_desc":
        return "i.aging_days DESC, i.updated_at DESC";
      case "status":
        return "i.status ASC, i.updated_at DESC";
      case "invoice_number":
        return "i.invoice_number ASC, i.updated_at DESC";
      case "updated_desc":
      default:
        return "i.updated_at DESC";
    }
  }

  private withInvoiceGuidance(row: Record<string, unknown>) {
    const warnings: string[] = [];
    const blockers: string[] = [];
    if (Number(row.item_count ?? 0) === 0) blockers.push("no_invoice_items");
    if (row.invoice_package_status !== "ready" && row.invoice_package_status !== "accepted" && row.invoice_package_status !== "attached") warnings.push("invoice_package_incomplete");
    if (row.documentation_status !== "ready" && row.documentation_status !== "accepted" && row.documentation_status !== "attached") warnings.push("documentation_incomplete");
    if (row.customer_acceptance_status === "pending") warnings.push("customer_acceptance_pending");
    if (row.prime_acceptance_status === "pending") warnings.push("prime_acceptance_pending");
    if (row.status === "voided") blockers.push("voided_invoice");
    if (row.status === "archived") blockers.push("archived_invoice");
    if (row.status === "disputed") blockers.push("invoice_disputed");
    return {
      ...row,
      warnings,
      blockers,
      required_override_fields: warnings.length > 0 ? warnings : [],
      recommended_next_action: this.recommendedInvoiceAction(row, blockers),
    };
  }

  private recommendedInvoiceAction(row: Record<string, unknown>, blockers: string[]) {
    if (row.status === "archived") return "view_only";
    if (row.status === "voided") return "view_voided_invoice";
    if (row.status === "disputed") return "resolve_dispute";
    if (blockers.includes("no_invoice_items")) return "add_invoice_items";
    if (row.approval_status === "not_submitted") return "submit_for_review";
    if (row.approval_status === "pending") return "approve_or_reject_invoice";
    if (row.approval_status === "approved" && row.delivery_status !== "sent") return "mark_sent";
    if (row.delivery_status === "sent" && row.cash_application_status !== "ready_for_cash_application") return "mark_ready_for_cash_application";
    if (row.cash_application_status === "ready_for_cash_application") return "wait_for_future_cash_application";
    return "continue_invoice_review";
  }

  private invoiceFinancialSummary(invoice: Record<string, unknown>) {
    return {
      subtotal_amount: invoice.subtotal_amount,
      retainage_amount: invoice.retainage_amount,
      adjustment_amount: invoice.adjustment_amount,
      tax_amount: invoice.tax_amount,
      fee_amount: invoice.fee_amount,
      total_amount: invoice.total_amount,
    };
  }

  private invoiceReceivableSummary(invoice: Record<string, unknown>) {
    return {
      original_amount: invoice.original_amount,
      paid_amount: invoice.paid_amount,
      balance_amount: invoice.balance_amount,
      aging_days: invoice.aging_days,
      payment_status: invoice.payment_status,
      collection_status: invoice.collection_status,
      cash_application_status: invoice.cash_application_status,
    };
  }

  private async listInvoiceItemsForInvoice(client: PoolClient, tenantId: string, invoiceId: string) {
    const result = await client.query(
      `
      SELECT ii.*, s.settlement_number, p.name AS project_name, wo.work_order_name
      FROM invoice_items ii
      LEFT JOIN settlements s ON s.tenant_id = ii.tenant_id AND s.id = ii.settlement_id
      LEFT JOIN projects p ON p.tenant_id = ii.tenant_id AND p.id = ii.project_id
      LEFT JOIN work_orders wo ON wo.tenant_id = ii.tenant_id AND wo.id = ii.work_order_id
      WHERE ii.tenant_id = $1 AND ii.invoice_id = $2 AND ii.deleted_at IS NULL
      ORDER BY ii.created_at DESC
      `,
      [tenantId, invoiceId],
    );
    return result.rows;
  }

  private async activeInvoiceItemCount(client: PoolClient, tenantId: string, invoiceId: string) {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM invoice_items WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL AND status NOT IN ('voided', 'archived')",
      [tenantId, invoiceId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async requireActiveInvoiceItems(client: PoolClient, tenantId: string, invoiceId: string) {
    const count = await this.activeInvoiceItemCount(client, tenantId, invoiceId);
    if (count === 0) throw new BadRequestException("invoice requires at least one item");
  }

  private collectionCaseSort(sort?: string) {
    switch (sort) {
      case "aging_desc":
        return "i.aging_days DESC, cc.updated_at DESC";
      case "balance_desc":
        return "i.balance_amount DESC, cc.updated_at DESC";
      case "priority_desc":
        return "CASE cc.collection_priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, cc.updated_at DESC";
      case "next_action_due_asc":
        return "cc.next_action_due_at ASC NULLS LAST, cc.updated_at DESC";
      case "opened_desc":
        return "cc.opened_at DESC, cc.updated_at DESC";
      case "case_number":
        return "cc.case_number ASC, cc.updated_at DESC";
      case "updated_desc":
      default:
        return "cc.updated_at DESC";
    }
  }

  private collectionActionSort(sort?: string) {
    switch (sort) {
      case "due_asc":
        return "ca.due_at ASC NULLS LAST, ca.updated_at DESC";
      case "follow_up_due_asc":
        return "ca.follow_up_due_at ASC NULLS LAST, ca.updated_at DESC";
      case "action_date_asc":
        return "ca.action_date ASC, ca.updated_at DESC";
      case "updated_desc":
        return "ca.updated_at DESC";
      case "action_date_desc":
      default:
        return "ca.action_date DESC, ca.updated_at DESC";
    }
  }

  private withDynamicCollectionCase(row: Record<string, unknown>) {
    const currentBalance = row.invoice_balance_amount ?? row.current_balance;
    const agingBucket = this.collectionAgingBucket({ aging_days: row.invoice_aging_days ?? row.aging_days, due_date: row.due_date });
    return { ...row, current_balance: currentBalance, aging_bucket: agingBucket };
  }

  private withCollectionCaseGuidance(row: Record<string, unknown>): Record<string, unknown> & { warnings: string[]; blockers: string[]; required_override_fields: string[]; recommended_next_action: string } {
    const warnings: string[] = [];
    const blockers: string[] = [];
    if (row.case_status === "archived") blockers.push("archived_collection_case");
    if (Number(row.current_balance ?? 0) <= 0 && !["resolved", "closed", "archived"].includes(String(row.case_status))) warnings.push("invoice_balance_resolved");
    if (row.dispute_status === "open" || row.dispute_status === "under_review") warnings.push("dispute_open");
    if (row.escalation_status && row.escalation_status !== "none") warnings.push("escalated");
    if (row.promise_to_pay_date && this.daysBetween(row.promise_to_pay_date, new Date().toISOString().slice(0, 10)) > 0) warnings.push("promise_missed");
    return {
      ...row,
      warnings,
      blockers,
      required_override_fields: [],
      recommended_next_action: this.recommendedCollectionCaseAction(row),
    };
  }

  private recommendedCollectionCaseAction(row: Record<string, unknown>) {
    if (row.case_status === "archived") return "view_only";
    if (["closed", "resolved"].includes(String(row.case_status))) return "view_closed_case";
    if (Number(row.current_balance ?? 0) <= 0) return "close_case";
    if (["open", "under_review"].includes(String(row.dispute_status))) return "resolve_dispute";
    if (row.promise_to_pay_date) {
      const diff = this.daysBetween(row.promise_to_pay_date, new Date().toISOString().slice(0, 10));
      if (diff <= 0) return "wait_for_promise_date";
      return "follow_up_on_missed_promise";
    }
    if (row.next_action_due_at && this.daysBetween(row.next_action_due_at, new Date().toISOString().slice(0, 10)) >= 0) return "complete_next_action";
    if (row.escalation_status && row.escalation_status !== "none") return "review_escalation";
    return "schedule_follow_up";
  }

  private withCollectionActionGuidance(row: Record<string, unknown>) {
    return {
      ...row,
      warnings: row.action_type === "payment_reminder" ? ["manual_reminder_only"] : [],
      blockers: row.action_status === "archived" ? ["archived_collection_action"] : [],
      recommended_next_action: this.recommendedCollectionAction(row),
    };
  }

  private recommendedCollectionAction(row: Record<string, unknown>) {
    if (row.action_status === "archived") return "view_only";
    if (row.action_status === "planned") return "complete_or_cancel_action";
    if (row.action_status === "completed") return "view_completed_action";
    return "review_action";
  }

  private async nextCollectionCaseNumber(client: PoolClient, tenantId: string) {
    const result = await client.query("SELECT count(*)::int + 1 AS next FROM collection_cases WHERE tenant_id = $1", [tenantId]);
    return `COLL-${String(result.rows[0]?.next ?? 1).padStart(6, "0")}`;
  }

  private collectionAgingBucket(invoice: Record<string, unknown>) {
    const agingDays = Number(invoice.aging_days ?? this.daysPastDue(invoice.due_date));
    if (agingDays <= 0) return "current";
    if (agingDays <= 30) return "1_30";
    if (agingDays <= 60) return "31_60";
    if (agingDays <= 90) return "61_90";
    return "90_plus";
  }

  private collectionPriority(agingBucket: string, balance: number, disputeStatus: string) {
    const base: Record<string, string> = { current: "low", "1_30": "medium", "31_60": "high", "61_90": "high", "90_plus": "urgent" };
    let priority = base[agingBucket] ?? "low";
    if (balance >= 10000 && priority === "low") priority = "medium";
    if (balance >= 25000 && priority === "medium") priority = "high";
    if (disputeStatus !== "none" && priority === "low") priority = "medium";
    return priority;
  }

  private collectionRisk(agingBucket: string, disputeStatus: string) {
    const base: Record<string, string> = { current: "low", "1_30": "medium", "31_60": "high", "61_90": "high", "90_plus": "critical" };
    const risk = base[agingBucket] ?? "low";
    if (disputeStatus === "none") return risk;
    if (risk === "low") return "medium";
    if (risk === "medium") return "high";
    return risk;
  }

  private async ensureNoActiveCollectionCase(client: PoolClient, tenantId: string, invoiceId: string, override: boolean) {
    if (override) return;
    const result = await client.query(
      `
      SELECT 1
      FROM collection_cases
      WHERE tenant_id = $1
        AND invoice_id = $2
        AND deleted_at IS NULL
        AND case_status NOT IN ('closed', 'resolved', 'archived')
      LIMIT 1
      `,
      [tenantId, invoiceId],
    );
    if (result.rows[0]) throw new BadRequestException("active collection case already exists for invoice");
  }

  private async requireTenantUser(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query("SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL AND status = 'active' LIMIT 1", [tenantId, userId]);
    if (!result.rows[0]) throw new BadRequestException("assigned owner must belong to tenant");
  }

  private validateCollectionActionBody(actionType: string, body: Record<string, unknown>, invoiceBalance: number) {
    if (actionType === "promise_to_pay") {
      const promiseDate = this.requireDate(body.promise_to_pay_date, "promise_to_pay_date");
      const amount = this.requirePositive(body.promise_to_pay_amount, "promise_to_pay_amount");
      if (this.daysBetween(new Date().toISOString().slice(0, 10), promiseDate) < 0 && !body.override_reasons) throw new BadRequestException("promise_to_pay_date must be today or future");
      if (amount > invoiceBalance && !body.override_reasons) throw new BadRequestException("promise_to_pay_amount cannot exceed invoice balance without override");
    }
    if (actionType === "dispute_opened") requireString(body.dispute_reason, "dispute_reason is required");
    if (actionType === "dispute_updated" && !body.dispute_reason && !body.note) throw new BadRequestException("dispute update requires dispute_reason or note");
    if (actionType === "dispute_resolved") requireString(body.note, "note is required");
    if (actionType === "escalation_requested") requireString(body.escalation_reason, "escalation_reason is required");
    if (actionType === "writeoff_review_requested") requireString(body.note, "note is required");
    if (actionType === "payment_reminder" && !body.note && !body.due_at) throw new BadRequestException("payment reminder requires note or due_at");
    if (actionType === "follow_up_scheduled" && !body.follow_up_due_at) throw new BadRequestException("follow_up_due_at is required");
  }

  private async applyCollectionActionSummary(client: PoolClient, tenantId: string, collectionCase: Record<string, unknown>, invoice: Record<string, unknown>, action: Record<string, unknown>, userId: string) {
    const caseValues: Record<string, unknown> = { updated_by: userId };
    const additionalEvents: NonNullable<WriteActionResult<Record<string, unknown>>["additionalEvents"]> = [];
    const actionType = String(action.action_type);
    if (actionType === "promise_to_pay") {
      caseValues.case_status = "promise_to_pay";
      caseValues.promise_to_pay_date = action.promise_to_pay_date;
      caseValues.promise_to_pay_amount = action.promise_to_pay_amount;
      caseValues.next_action_type = "follow_up_scheduled";
      caseValues.next_action_due_at = action.promise_to_pay_date;
      additionalEvents.push(this.additionalEvent("collection_action.create", "invoice", invoice.id, "invoice.promise_to_pay_recorded", { ...invoice, promise_to_pay_date: action.promise_to_pay_date, promise_to_pay_amount: action.promise_to_pay_amount }, invoice));
    } else if (actionType === "dispute_opened") {
      caseValues.case_status = "disputed";
      caseValues.dispute_status = "open";
      const afterInvoice = await updateTenantRecord(client, "invoices", tenantId, String(invoice.id), { collection_status: "disputed", updated_by: userId });
      if (!afterInvoice) throw new NotFoundException("invoice not found");
      additionalEvents.push(this.additionalEvent("collection_action.create", "invoice", invoice.id, "invoice.dispute_opened", afterInvoice, invoice));
      additionalEvents.push(this.additionalEvent("collection_action.create", "invoice", invoice.id, "invoice.collection_status_changed", afterInvoice, invoice));
    } else if (actionType === "dispute_updated") {
      caseValues.case_status = "disputed";
      caseValues.dispute_status = "under_review";
    } else if (actionType === "dispute_resolved") {
      caseValues.dispute_status = "resolved";
      caseValues.case_status = Number(invoice.balance_amount ?? 0) > 0 ? "in_progress" : "resolved";
      const nextStatus = this.calculateReceivableState(invoice.due_date, Number(invoice.original_amount || invoice.total_amount || 0), Number(invoice.paid_amount ?? 0), String(invoice.status)).collection_status;
      const afterInvoice = await updateTenantRecord(client, "invoices", tenantId, String(invoice.id), { collection_status: nextStatus, updated_by: userId });
      if (!afterInvoice) throw new NotFoundException("invoice not found");
      additionalEvents.push(this.additionalEvent("collection_action.create", "invoice", invoice.id, "invoice.dispute_resolved", afterInvoice, invoice));
      additionalEvents.push(this.additionalEvent("collection_action.create", "invoice", invoice.id, "invoice.collection_status_changed", afterInvoice, invoice));
    } else if (actionType === "escalation_requested") {
      caseValues.case_status = "escalated";
      caseValues.escalation_status = "internal_escalation";
      additionalEvents.push(this.additionalEvent("collection_action.create", "collection_case", collectionCase.id, "collection_case.escalated", { ...collectionCase, ...caseValues }, collectionCase));
    } else if (actionType === "escalation_approved") {
      caseValues.case_status = "escalated";
      caseValues.escalation_status = "executive_escalation";
    } else if (actionType === "writeoff_review_requested") {
      caseValues.writeoff_review_status = "candidate";
    } else if (actionType === "follow_up_scheduled") {
      caseValues.next_action_type = "follow_up_scheduled";
      caseValues.next_action_due_at = action.follow_up_due_at;
    } else if (action.follow_up_required && action.follow_up_due_at) {
      caseValues.next_action_type = "follow_up_scheduled";
      caseValues.next_action_due_at = action.follow_up_due_at;
    }
    const afterCase = await updateTenantRecord(client, "collection_cases", tenantId, String(collectionCase.id), caseValues);
    if (!afterCase) throw new NotFoundException("collection case not found");
    additionalEvents.push(this.additionalEvent("collection_case.update", "collection_case", collectionCase.id, "collection_case.updated", afterCase, collectionCase));
    return { additionalEvents };
  }

  private async refreshCollectionCaseFromInvoice(client: PoolClient, tenantId: string, collectionCase: Record<string, unknown>, userId: string) {
    const invoice = await this.requireRecord(client, "invoices", tenantId, String(collectionCase.invoice_id), "invoice not found");
    const agingBucket = this.collectionAgingBucket(invoice);
    const disputeStatus = String(invoice.status) === "disputed" || String(invoice.collection_status) === "disputed" ? "open" : String(collectionCase.dispute_status ?? "none");
    const after = await updateTenantRecord(client, "collection_cases", tenantId, String(collectionCase.id), {
      current_balance: Number(invoice.balance_amount ?? 0),
      original_invoice_amount: Number(invoice.original_amount ?? invoice.total_amount ?? 0),
      last_payment_at: invoice.last_payment_at ?? null,
      last_payment_amount: invoice.last_payment_amount ?? null,
      aging_bucket: agingBucket,
      collection_priority: this.collectionPriority(agingBucket, Number(invoice.balance_amount ?? 0), disputeStatus),
      risk_level: this.collectionRisk(agingBucket, disputeStatus),
      updated_by: userId,
    });
    if (!after) throw new NotFoundException("collection case not found");
    return after;
  }

  private async requireCollectionCaseContext(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT cc.*, i.invoice_number, i.original_amount, i.paid_amount, i.balance_amount AS invoice_balance_amount,
        i.aging_days AS invoice_aging_days, i.payment_status, i.collection_status, i.cash_application_status,
        i.due_date, co.name AS customer_organization_name
      FROM collection_cases cc
      JOIN invoices i ON i.tenant_id = cc.tenant_id AND i.id = cc.invoice_id
      LEFT JOIN organizations co ON co.tenant_id = cc.tenant_id AND co.id = cc.customer_organization_id
      WHERE cc.tenant_id = $1 AND cc.id = $2 AND cc.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );
    if (!result.rows[0]) throw new NotFoundException("collection case not found");
    return result.rows[0];
  }

  private async requireCollectionActionContext(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query(
      `
      SELECT ca.*, cc.case_number, cc.case_status, i.invoice_number, i.balance_amount AS invoice_balance_amount,
        i.collection_status, co.name AS customer_organization_name, u.display_name AS actor_name
      FROM collection_actions ca
      JOIN collection_cases cc ON cc.tenant_id = ca.tenant_id AND cc.id = ca.collection_case_id
      JOIN invoices i ON i.tenant_id = ca.tenant_id AND i.id = ca.invoice_id
      LEFT JOIN organizations co ON co.tenant_id = ca.tenant_id AND co.id = ca.customer_organization_id
      LEFT JOIN users u ON u.id = ca.actor_user_id
      WHERE ca.tenant_id = $1 AND ca.id = $2 AND ca.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );
    if (!result.rows[0]) throw new NotFoundException("collection action not found");
    return result.rows[0];
  }

  private async listCollectionActionsForCase(client: PoolClient, tenantId: string, caseId: string) {
    const result = await client.query(
      `
      SELECT ca.*, u.display_name AS actor_name
      FROM collection_actions ca
      LEFT JOIN users u ON u.id = ca.actor_user_id
      WHERE ca.tenant_id = $1 AND ca.collection_case_id = $2 AND ca.deleted_at IS NULL
      ORDER BY ca.action_date DESC, ca.created_at DESC
      `,
      [tenantId, caseId],
    );
    return result.rows.map((row) => this.withCollectionActionGuidance(row));
  }

  private async collectionCashContext(client: PoolClient, tenantId: string, customerId: string, invoiceId: string) {
    const result = await client.query(
      `
      SELECT
        (SELECT count(*)::int FROM payment_applications WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL AND application_status NOT IN ('voided', 'archived')) AS payment_application_count,
        (SELECT COALESCE(sum(applied_amount), 0)::numeric FROM payment_applications WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL AND application_status NOT IN ('voided', 'archived')) AS applied_payment_total,
        (SELECT COALESCE(sum(unapplied_amount), 0)::numeric FROM cash_receipts WHERE tenant_id = $1 AND customer_organization_id = $3 AND deleted_at IS NULL AND receipt_status NOT IN ('voided', 'archived')) AS customer_unapplied_cash
      `,
      [tenantId, invoiceId, customerId],
    );
    return result.rows[0] ?? { payment_application_count: 0, applied_payment_total: 0, customer_unapplied_cash: 0 };
  }

  private cashReceiptSort(sort?: string) {
    switch (sort) {
      case "payment_date_asc":
        return "cr.payment_date ASC NULLS LAST, cr.updated_at DESC";
      case "amount_desc":
        return "cr.gross_received_amount DESC, cr.updated_at DESC";
      case "unapplied_desc":
        return "cr.unapplied_amount DESC, cr.updated_at DESC";
      case "receipt_number":
        return "cr.receipt_number ASC, cr.updated_at DESC";
      case "payment_date_desc":
        return "cr.payment_date DESC NULLS LAST, cr.updated_at DESC";
      case "updated_desc":
      default:
        return "cr.updated_at DESC";
    }
  }

  private withCashReceiptGuidance(row: Record<string, unknown>) {
    const blockers = this.cashReceiptBlockers(row);
    return {
      ...row,
      warnings: [],
      blockers,
      required_override_fields: [],
      recommended_next_action: this.recommendedCashReceiptAction(row),
    };
  }

  private cashReceiptBlockers(row: Record<string, unknown>) {
    const blockers: string[] = [];
    if (row.receipt_status === "voided") blockers.push("voided_receipt");
    if (row.receipt_status === "archived") blockers.push("archived_receipt");
    return blockers;
  }

  private recommendedCashReceiptAction(row: Record<string, unknown>) {
    if (row.receipt_status === "archived") return "view_only";
    if (row.receipt_status === "voided") return "view_voided_receipt";
    if (Number(row.unapplied_amount ?? 0) > 0) return "apply_unapplied_cash";
    if (row.receipt_status === "fully_applied") return "view_fully_applied_receipt";
    return "review_receipt";
  }

  private async listPaymentApplicationsForReceipt(client: PoolClient, tenantId: string, receiptId: string) {
    const result = await client.query(
      `
      SELECT pa.*, cr.receipt_number, i.invoice_number, i.balance_amount AS invoice_balance_amount, co.name AS customer_organization_name
      FROM payment_applications pa
      JOIN cash_receipts cr ON cr.tenant_id = pa.tenant_id AND cr.id = pa.cash_receipt_id
      JOIN invoices i ON i.tenant_id = pa.tenant_id AND i.id = pa.invoice_id
      LEFT JOIN organizations co ON co.tenant_id = pa.tenant_id AND co.id = pa.customer_organization_id
      WHERE pa.tenant_id = $1
        AND pa.cash_receipt_id = $2
        AND pa.deleted_at IS NULL
      ORDER BY pa.application_date DESC, pa.created_at DESC
      `,
      [tenantId, receiptId],
    );
    return result.rows;
  }

  private async activePaymentApplicationCount(client: PoolClient, tenantId: string, receiptId: string) {
    const result = await client.query(
      `
      SELECT count(*)::int AS count
      FROM payment_applications
      WHERE tenant_id = $1
        AND cash_receipt_id = $2
        AND deleted_at IS NULL
        AND application_status NOT IN ('voided', 'archived')
      `,
      [tenantId, receiptId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async nextReceiptNumber(client: PoolClient, tenantId: string) {
    const result = await client.query("SELECT count(*)::int + 1 AS next FROM cash_receipts WHERE tenant_id = $1", [tenantId]);
    return `RCPT-${String(result.rows[0]?.next ?? 1).padStart(6, "0")}`;
  }

  private requireDate(value: unknown, field: string) {
    const parsed = requireString(value, `${field} is required`);
    const date = new Date(parsed);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} must be valid`);
    return parsed.slice(0, 10);
  }

  private receiptStatus(gross: number, applied: number) {
    if (applied <= 0) return "unapplied";
    if (applied < gross) return "partially_applied";
    if (applied === gross) return "fully_applied";
    return "overapplied";
  }

  private async recalculateCashReceipt(client: PoolClient, tenantId: string, receiptId: string, userId: string) {
    const receipt = await this.requireRecord(client, "cash_receipts", tenantId, receiptId, "cash receipt not found");
    const totals = await client.query(
      `
      SELECT COALESCE(sum(applied_amount), 0)::numeric AS applied_amount
      FROM payment_applications
      WHERE tenant_id = $1
        AND cash_receipt_id = $2
        AND deleted_at IS NULL
        AND application_status NOT IN ('voided', 'archived')
      `,
      [tenantId, receiptId],
    );
    const applied = this.roundMoney(Number(totals.rows[0]?.applied_amount ?? 0));
    const gross = Number(receipt.gross_received_amount);
    const after = await updateTenantRecord(client, "cash_receipts", tenantId, receiptId, {
      applied_amount: applied,
      unapplied_amount: this.roundMoney(Math.max(0, gross - applied)),
      receipt_status: this.receiptStatus(gross, applied),
      updated_by: userId,
    });
    if (!after) throw new NotFoundException("cash receipt not found");
    return after;
  }

  private async applyAmountToInvoice(client: PoolClient, tenantId: string, invoice: Record<string, unknown>, amount: number, applicationDate: string, userId: string) {
    const original = Number(invoice.original_amount || invoice.total_amount || 0);
    const paid = this.roundMoney(Number(invoice.paid_amount ?? 0) + amount);
    const receivable = this.calculateReceivableState(invoice.due_date, original, paid, String(invoice.status));
    const after = await updateTenantRecord(client, "invoices", tenantId, String(invoice.id), {
      paid_amount: paid,
      balance_amount: receivable.balance_amount,
      payment_status: receivable.payment_status,
      collection_status: receivable.collection_status,
      cash_application_status: this.cashApplicationStatus(receivable.balance_amount, paid),
      aging_days: receivable.aging_days,
      last_payment_at: applicationDate,
      last_payment_amount: amount,
      updated_by: userId,
    });
    if (!after) throw new NotFoundException("invoice not found");
    return after;
  }

  private async reverseAmountFromInvoice(client: PoolClient, tenantId: string, invoice: Record<string, unknown>, amount: number, userId: string) {
    const original = Number(invoice.original_amount || invoice.total_amount || 0);
    const paid = this.roundMoney(Math.max(0, Number(invoice.paid_amount ?? 0) - amount));
    const receivable = this.calculateReceivableState(invoice.due_date, original, paid, String(invoice.status));
    const lastPayment = await this.recalculateLastPayment(client, tenantId, String(invoice.id));
    const after = await updateTenantRecord(client, "invoices", tenantId, String(invoice.id), {
      paid_amount: paid,
      balance_amount: receivable.balance_amount,
      payment_status: receivable.payment_status,
      collection_status: receivable.collection_status,
      cash_application_status: this.cashApplicationStatus(receivable.balance_amount, paid),
      aging_days: receivable.aging_days,
      last_payment_at: lastPayment.last_payment_at,
      last_payment_amount: lastPayment.last_payment_amount,
      updated_by: userId,
    });
    if (!after) throw new NotFoundException("invoice not found");
    return after;
  }

  private cashApplicationStatus(balance: number, paid: number) {
    if (paid <= 0) return "ready_for_cash_application";
    if (balance <= 0) return "fully_applied_later";
    return "partially_applied_later";
  }

  private async recalculateLastPayment(client: PoolClient, tenantId: string, invoiceId: string) {
    const result = await client.query(
      `
      SELECT application_date AS last_payment_at, applied_amount AS last_payment_amount
      FROM payment_applications
      WHERE tenant_id = $1
        AND invoice_id = $2
        AND deleted_at IS NULL
        AND application_status NOT IN ('voided', 'archived')
      ORDER BY application_date DESC, created_at DESC
      LIMIT 1
      `,
      [tenantId, invoiceId],
    );
    return result.rows[0] ?? { last_payment_at: null, last_payment_amount: null };
  }

  private async requireSettlementItemForInvoice(client: PoolClient, tenantId: string, id: unknown) {
    const settlementItemId = this.requiredId(id, "settlement_item_id");
    const result = await client.query(
      `
      SELECT si.*, s.status AS settlement_status, s.invoice_ready
      FROM settlement_items si
      JOIN settlements s ON s.tenant_id = si.tenant_id AND s.id = si.settlement_id
      WHERE si.tenant_id = $1
        AND si.id = $2
        AND si.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, settlementItemId],
    );
    if (!result.rows[0]) throw new NotFoundException("settlement item not found");
    return result.rows[0];
  }

  private async ensureNoDuplicateInvoiceItem(client: PoolClient, tenantId: string, settlementItemId: string, override: boolean) {
    if (override) return;
    const result = await client.query(
      `
      SELECT 1
      FROM invoice_items
      WHERE tenant_id = $1
        AND settlement_item_id = $2
        AND deleted_at IS NULL
        AND status NOT IN ('voided', 'archived')
      LIMIT 1
      `,
      [tenantId, settlementItemId],
    );
    if (result.rows[0]) throw new BadRequestException("duplicate invoice item is not allowed without override");
  }

  private async recalculateInvoiceTotals(client: PoolClient, tenantId: string, invoiceId: string, userId: string) {
    const totals = await client.query(
      `
      SELECT
        COALESCE(sum(gross_amount), 0)::numeric AS subtotal_amount,
        COALESCE(sum(retainage_amount), 0)::numeric AS retainage_amount,
        COALESCE(sum(adjustment_amount), 0)::numeric AS adjustment_amount,
        COALESCE(sum(tax_amount), 0)::numeric AS tax_amount,
        COALESCE(sum(fee_amount), 0)::numeric AS fee_amount
      FROM invoice_items
      WHERE tenant_id = $1
        AND invoice_id = $2
        AND deleted_at IS NULL
        AND status NOT IN ('voided', 'archived')
      `,
      [tenantId, invoiceId],
    );
    const invoice = await this.requireRecord(client, "invoices", tenantId, invoiceId, "invoice not found");
    const subtotal = Number(totals.rows[0].subtotal_amount);
    const retainage = Number(totals.rows[0].retainage_amount);
    const adjustment = Number(totals.rows[0].adjustment_amount);
    const tax = Number(totals.rows[0].tax_amount);
    const fee = Number(totals.rows[0].fee_amount);
    const total = this.roundMoney(subtotal - retainage + adjustment + tax + fee);
    const original = ["approved", "sent", "partially_paid_later", "paid_later", "overdue_later"].includes(String(invoice.status)) ? Number(invoice.original_amount || total) : 0;
    const receivable = this.calculateReceivableState(invoice.due_date, original || total, Number(invoice.paid_amount ?? 0), String(invoice.status));
    const after = await updateTenantRecord(client, "invoices", tenantId, invoiceId, {
      subtotal_amount: subtotal,
      retainage_amount: retainage,
      adjustment_amount: adjustment,
      tax_amount: tax,
      fee_amount: fee,
      total_amount: total,
      invoice_amount: total,
      balance_amount: original > 0 ? receivable.balance_amount : total,
      aging_days: receivable.aging_days,
      payment_status: receivable.payment_status,
      collection_status: receivable.collection_status,
      updated_by: userId,
    });
    if (!after) throw new NotFoundException("invoice not found");
    return after;
  }

  private async nextInvoiceNumber(client: PoolClient, tenantId: string) {
    const result = await client.query("SELECT count(*)::int + 1 AS next FROM invoices WHERE tenant_id = $1", [tenantId]);
    const sequence = String(result.rows[0]?.next ?? 1).padStart(6, "0");
    return `INV-${sequence}`;
  }

  private async ensureInvoiceNumberAvailable(client: PoolClient, tenantId: string, invoiceNumber: string) {
    const result = await client.query("SELECT 1 FROM invoices WHERE tenant_id = $1 AND invoice_number = $2 AND deleted_at IS NULL LIMIT 1", [tenantId, invoiceNumber]);
    if (result.rows[0]) throw new BadRequestException("invoice_number must be unique per tenant");
  }

  private calculateDueDate(invoiceDate: unknown, paymentTerms: unknown) {
    const base = new Date(String(invoiceDate));
    if (!Number.isFinite(base.getTime())) throw new BadRequestException("valid invoice_date is required");
    const days: Record<string, number> = { due_on_receipt: 0, net_7: 7, net_15: 15, net_30: 30, net_45: 45, net_60: 60, custom: 0 };
    base.setUTCDate(base.getUTCDate() + (days[String(paymentTerms)] ?? 30));
    return base.toISOString().slice(0, 10);
  }

  private calculateReceivableState(dueDate: unknown, originalAmount: number, paidAmount: number, status: string) {
    const balanceAmount = Math.max(0, this.roundMoney(originalAmount - paidAmount));
    const agingDays = balanceAmount > 0 ? Math.max(0, this.daysPastDue(dueDate)) : 0;
    let paymentStatus = "unpaid";
    if (paidAmount > 0 && balanceAmount > 0) paymentStatus = "partially_paid";
    else if (paidAmount > 0 && balanceAmount === 0) paymentStatus = "paid";
    else if (paidAmount > originalAmount) paymentStatus = "overpaid";
    let collectionStatus = "not_due";
    if (status === "disputed") collectionStatus = "disputed";
    else if (balanceAmount <= 0) collectionStatus = "resolved";
    else if (agingDays > 0) collectionStatus = "overdue";
    else if (this.daysPastDue(dueDate) === 0) collectionStatus = "due";
    return { original_amount: originalAmount, paid_amount: paidAmount, balance_amount: balanceAmount, aging_days: agingDays, payment_status: paymentStatus, collection_status: collectionStatus };
  }

  private async requireInvoiceReadySettlement(client: PoolClient, tenantId: string, id: unknown) {
    const settlement = await this.requireRecord(client, "settlements", tenantId, this.requiredId(id, "settlement_id"), "settlement not found");
    if (!["approved", "invoice_ready"].includes(String(settlement.status)) && settlement.invoice_ready !== true) throw new BadRequestException("settlement must be approved or invoice ready");
    return settlement;
  }

  private sourceSettlementNetAmount(settlement: Record<string, unknown>) {
    for (const key of ["net_settlement_amount", "net_amount", "total_amount"]) {
      const value = Number(settlement[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  private async requireApprovedSettlement(client: PoolClient, tenantId: string, id: unknown) {
    const settlement = await this.requireRecord(client, "settlements", tenantId, this.requiredId(id, "settlement_id"), "settlement not found");
    if (settlement.status !== "approved") throw new BadRequestException("settlement must be approved");
    return settlement;
  }

  private async requireArRecordByInvoice(client: PoolClient, tenantId: string, invoiceId: string) {
    const result = await client.query("SELECT * FROM ar_records WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL LIMIT 1", [tenantId, invoiceId]);
    if (!result.rows[0]) throw new NotFoundException("AR record not found");
    return result.rows[0];
  }

  private async updateCustomerPaymentStats(client: PoolClient, tenantId: string, invoice: Record<string, unknown>, payment: Record<string, unknown>, status: string) {
    const daysToPay = this.daysBetween(invoice.invoice_date, payment.payment_date);
    const shortPayIncrement = status === "short_paid" ? 1 : 0;
    const previous = await client.query(
      `
      SELECT *
      FROM customer_payment_stats
      WHERE tenant_id = $1
        AND customer_organization_id = $2
      LIMIT 1
      `,
      [tenantId, invoice.organization_id],
    );
    await client.query(
      `
      INSERT INTO customer_payment_stats (tenant_id, customer_organization_id, average_days_to_pay, payment_count, short_pay_count, last_payment_at)
      VALUES ($1, $2, $3, 1, $4, $5)
      ON CONFLICT (tenant_id, customer_organization_id)
      DO UPDATE SET
        average_days_to_pay = ((customer_payment_stats.average_days_to_pay * customer_payment_stats.payment_count) + EXCLUDED.average_days_to_pay) / (customer_payment_stats.payment_count + 1),
        payment_count = customer_payment_stats.payment_count + 1,
        short_pay_count = customer_payment_stats.short_pay_count + EXCLUDED.short_pay_count,
        last_payment_at = EXCLUDED.last_payment_at,
        updated_at = now()
      `,
      [tenantId, invoice.organization_id, daysToPay, shortPayIncrement, payment.payment_date],
    );
    const current = await client.query(
      `
      SELECT *
      FROM customer_payment_stats
      WHERE tenant_id = $1
        AND customer_organization_id = $2
      LIMIT 1
      `,
      [tenantId, invoice.organization_id],
    );
    const before = previous.rows[0] ?? { average_days_to_pay: 0, payment_count: 0, short_pay_count: 0 };
    const after = current.rows[0];
    return {
      customer_payment_stats_id: after.id,
      previous_average_days_to_pay: Number(before.average_days_to_pay),
      new_average_days_to_pay: Number(after.average_days_to_pay),
      previous_payment_count: Number(before.payment_count),
      new_payment_count: Number(after.payment_count),
      previous_short_pay_count: Number(before.short_pay_count),
      new_short_pay_count: Number(after.short_pay_count),
    };
  }

  private calculateAging(dueDate: unknown) {
    const ageDays = Math.max(0, this.daysPastDue(dueDate));
    let agingBucket = "current";
    if (ageDays >= 120) agingBucket = "120_plus";
    else if (ageDays >= 90) agingBucket = "90";
    else if (ageDays >= 60) agingBucket = "60";
    else if (ageDays >= 30) agingBucket = "30";
    return { age_days: ageDays, aging_bucket: agingBucket };
  }

  private withCurrentAging(record: Record<string, unknown>) {
    const aging = this.calculateAging(record.due_date);
    return { ...record, ...aging };
  }

  private daysPastDue(dueDate: unknown) {
    return this.daysBetween(dueDate, new Date().toISOString().slice(0, 10));
  }

  private daysBetween(start: unknown, end: unknown) {
    const startTime = new Date(String(start)).getTime();
    const endTime = new Date(String(end)).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) throw new BadRequestException("valid dates are required");
    return Math.floor((endTime - startTime) / 86400000);
  }

  private async archiveRecord(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private async requireRecordIncludingArchived(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
    const record = result.rows[0];
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private optionalRecord(client: PoolClient, table: string, tenantId: string, id: string) {
    return findTenantRecordById(client, table, tenantId, id);
  }

  private additionalEvent(action: string, aggregateType: string, entityId: unknown, eventType: string, afterState: Record<string, unknown>, beforeState?: Record<string, unknown>) {
    return {
      action,
      aggregateType,
      entityType: aggregateType,
      entityId: String(entityId),
      eventType,
      beforeState,
      afterState,
      systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
    };
  }

  private async requireRoleAuthority(client: PoolClient, tenantId: string, userId: string, roles: Set<string>, message: string) {
    const result = await client.query(
      `
      SELECT 1
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_user_id = tu.id
      JOIN roles r ON r.id = ur.role_id
      WHERE tu.tenant_id = $1
        AND tu.user_id = $2
        AND tu.status = 'active'
        AND r.name = ANY($3::text[])
        AND r.deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, userId, Array.from(roles)],
    );
    if (!result.rows[0]) throw new ForbiddenException(message);
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !value) throw new Error(`${field} is required`);
    return value;
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private allowed(value: unknown, field: string, allowedValues: Set<string>) {
    const parsed = requireString(value, `${field} is required`);
    if (!allowedValues.has(parsed)) throw new BadRequestException(`${field} is invalid`);
    return parsed;
  }

  private objectValue(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return {};
  }

  private requireNonNegative(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be >= 0`);
    return parsed;
  }

  private requirePositive(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be > 0`);
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
