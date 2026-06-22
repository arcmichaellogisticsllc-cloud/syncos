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
