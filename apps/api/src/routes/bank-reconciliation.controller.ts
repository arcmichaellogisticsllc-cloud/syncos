import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick } from "./intelligence.types";

const accountTypes = new Set(["operating", "payroll", "tax", "savings", "escrow", "credit_card", "other"]);
const accountStatuses = new Set(["active", "inactive", "closed", "archived"]);
const directions = new Set(["debit", "credit"]);
const transactionTypes = new Set(["payment_out", "deposit_in", "fee", "transfer", "reversal", "chargeback", "adjustment", "interest", "unknown"]);
const reconciliationStatuses = new Set(["unreconciled", "matched", "partially_matched", "exception", "ignored", "archived"]);
const clearedStatuses = new Set(["pending", "posted", "cleared", "returned", "reversed", "unknown"]);
const exceptionStatuses = new Set(["none", "open", "under_review", "resolved", "ignored"]);
const sourceTypes = new Set(["manual", "statement_import_later", "bank_feed_later", "processor_import_later"]);
const paymentMethods = new Set(["ach", "wire", "check", "card", "card_payout", "cash", "lockbox", "portal", "zelle", "manual", "payroll_provider", "other"]);
const matchTypes = new Set(["payment_batch", "payment_item", "cash_receipt", "payment_application_context", "manual_adjustment", "unknown"]);
const matchedObjectTypes = new Set(["payment_batch", "payment_item", "cash_receipt", "payment_application", "invoice", "manual"]);
const matchConfidences = new Set(["exact", "high", "medium", "low", "manual"]);

type Row = Record<string, unknown>;

@Controller()
export class BankReconciliationController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("bank-accounts")
  @RequirePermission("bank_account.read")
  async listAccounts(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["ba.tenant_id = $1", "ba.deleted_at IS NULL"];
      if (query.archived !== "true") where.push("ba.status <> 'archived'");
      this.addFilter(where, values, "ba.account_type", query.account_type);
      this.addFilter(where, values, "ba.status", query.status);
      if (query.q) {
        values.push(`%${query.q}%`);
        where.push(`(ba.account_name ILIKE $${values.length} OR ba.institution_name ILIKE $${values.length} OR ba.masked_account_number ILIKE $${values.length})`);
      }
      const result = await client.query(
        `
        SELECT ba.*,
          COALESCE(summary.transaction_count, 0)::int AS transaction_count,
          COALESCE(summary.unreconciled_count, 0)::int AS unreconciled_count,
          COALESCE(summary.exception_count, 0)::int AS exception_count
        FROM bank_accounts ba
        LEFT JOIN (
          SELECT tenant_id, bank_account_id,
            count(*) AS transaction_count,
            count(*) FILTER (WHERE reconciliation_status = 'unreconciled') AS unreconciled_count,
            count(*) FILTER (WHERE exception_status = 'open' OR reconciliation_status = 'exception') AS exception_count
          FROM bank_transactions
          WHERE deleted_at IS NULL
          GROUP BY tenant_id, bank_account_id
        ) summary ON summary.tenant_id = ba.tenant_id AND summary.bank_account_id = ba.id
        WHERE ${where.join(" AND ")}
        ORDER BY ba.updated_at DESC
        LIMIT 250
        `,
        values,
      );
      return result.rows.map((row) => this.withAccountGuidance(row));
    });
  }

  @Get("bank-accounts/:id/detail")
  @RequirePermission("bank_account.read")
  async getAccountDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const account = await this.requireAccount(client, request.auth.tenantId, id);
      const summary = await this.accountSummary(client, request.auth.tenantId, id);
      const recent = await client.query("SELECT * FROM bank_transactions WHERE tenant_id = $1 AND bank_account_id = $2 AND deleted_at IS NULL ORDER BY transaction_date DESC, created_at DESC LIMIT 25", [request.auth.tenantId, id]);
      return {
        bank_account: this.withAccountGuidance({ ...account, ...summary }),
        transaction_summary: summary,
        reconciliation_summary: summary,
        recent_transactions: recent.rows.map((row) => this.withTransactionGuidance(row)),
        warnings: this.accountWarnings(account),
        blockers: [],
        recommended_next_action: "review_transactions",
        timeline_available: true,
        audit_allowed: await this.hasPermission(client, request.auth.tenantId, request.auth.userId, "bank_account.audit.read"),
      };
    });
  }

  @Get("bank-accounts/:id")
  @RequirePermission("bank_account.read")
  async getAccount(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireAccount(client, request.auth.tenantId, id));
  }

  @Post("bank-accounts")
  @RequirePermission("bank_account.create")
  async createAccount(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "bank_account.create", "bank_account.created", "bank_account", async (client) => {
      this.validateBankSensitiveFields(body);
      const account = await this.insert(client, "bank_accounts", {
        tenant_id: request.auth.tenantId,
        account_name: this.requireText(body.account_name, "account_name is required"),
        account_type: this.allowed(body.account_type, "account_type", accountTypes),
        institution_name: this.optionalString(body.institution_name),
        masked_account_number: this.optionalString(body.masked_account_number),
        routing_last4: this.routingLast4(body.routing_last4),
        currency: this.optionalString(body.currency) ?? "USD",
        opening_balance: this.optionalNumber(body.opening_balance),
        current_balance_snapshot: this.optionalNumber(body.current_balance_snapshot),
        last_statement_date: this.optionalString(body.last_statement_date),
        notes: this.optionalString(body.notes),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "bank_account", entityId: account.id as string, afterState: this.withAccountGuidance(account) };
    });
  }

  @Patch("bank-accounts/:id")
  @RequirePermission("bank_account.update")
  async updateAccount(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "bank_account.update", "bank_account.updated", "bank_account", async (client) => {
      this.validateBankSensitiveFields(body);
      const before = await this.requireAccount(client, request.auth.tenantId, id);
      const values = pick(body, ["account_name", "institution_name", "masked_account_number", "currency", "last_statement_date", "notes"]);
      if (body.account_type !== undefined) values.account_type = this.allowed(body.account_type, "account_type", accountTypes);
      if (body.status !== undefined) values.status = this.allowed(body.status, "status", accountStatuses);
      if (body.routing_last4 !== undefined) values.routing_last4 = this.routingLast4(body.routing_last4);
      if (body.opening_balance !== undefined) values.opening_balance = this.optionalNumber(body.opening_balance);
      if (body.current_balance_snapshot !== undefined) values.current_balance_snapshot = this.optionalNumber(body.current_balance_snapshot);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "bank_accounts", request.auth.tenantId, id, values);
      return { entityType: "bank_account", entityId: id, beforeState: before, afterState: this.withAccountGuidance(after) };
    });
  }

  @Post("bank-accounts/:id/archive")
  @RequirePermission("bank_account.archive")
  async archiveAccount(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "bank_account.archive", "bank_account.archived", "bank_account", async (client) => {
      const before = await this.requireAccount(client, request.auth.tenantId, id);
      const after = await this.update(client, "bank_accounts", request.auth.tenantId, id, {
        status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
        archive_note: this.optionalString(body.archive_note),
        updated_by: request.auth.userId,
        updated_at: new Date(),
      });
      return { entityType: "bank_account", entityId: id, beforeState: before, afterState: this.withAccountGuidance(after) };
    }, body.archive_reason);
  }

  @Get("bank-transactions")
  @RequirePermission("bank_transaction.read")
  async listTransactions(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["bt.tenant_id = $1", "bt.deleted_at IS NULL"];
      if (query.archived !== "true") where.push("bt.reconciliation_status <> 'archived'");
      this.addFilter(where, values, "bt.bank_account_id", query.bank_account_id);
      this.addFilter(where, values, "bt.direction", query.direction);
      this.addFilter(where, values, "bt.transaction_type", query.transaction_type);
      this.addFilter(where, values, "bt.reconciliation_status", query.reconciliation_status);
      this.addFilter(where, values, "bt.cleared_status", query.cleared_status);
      this.addFilter(where, values, "bt.exception_status", query.exception_status);
      this.addFilter(where, values, "bt.source_type", query.source_type);
      this.addDateFilter(where, values, "bt.transaction_date", ">=", query.transaction_date_from);
      this.addDateFilter(where, values, "bt.transaction_date", "<=", query.transaction_date_to);
      this.addDateFilter(where, values, "bt.posted_date", ">=", query.posted_date_from);
      this.addDateFilter(where, values, "bt.posted_date", "<=", query.posted_date_to);
      this.addNumberFilter(where, values, "bt.amount", ">=", query.amount_min);
      this.addNumberFilter(where, values, "bt.amount", "<=", query.amount_max);
      if (query.q) {
        values.push(`%${query.q}%`);
        where.push(`(bt.description ILIKE $${values.length} OR bt.bank_reference ILIKE $${values.length} OR bt.external_transaction_id ILIKE $${values.length} OR bt.exception_reason ILIKE $${values.length} OR ba.account_name ILIKE $${values.length})`);
      }
      const result = await client.query(
        `
        SELECT bt.*, ba.account_name AS bank_account_name,
          COALESCE(match_summary.active_match_count, 0)::int AS active_match_count,
          COALESCE(match_summary.approved_match_amount, 0)::numeric AS approved_match_amount,
          (bt.amount - COALESCE(match_summary.approved_match_amount, 0))::numeric AS unmatched_amount
        FROM bank_transactions bt
        JOIN bank_accounts ba ON ba.tenant_id = bt.tenant_id AND ba.id = bt.bank_account_id
        LEFT JOIN (
          SELECT tenant_id, bank_transaction_id,
            count(*) FILTER (WHERE match_status NOT IN ('voided', 'archived', 'rejected')) AS active_match_count,
            COALESCE(sum(matched_amount) FILTER (WHERE match_status = 'approved'), 0) AS approved_match_amount
          FROM reconciliation_matches
          WHERE deleted_at IS NULL
          GROUP BY tenant_id, bank_transaction_id
        ) match_summary ON match_summary.tenant_id = bt.tenant_id AND match_summary.bank_transaction_id = bt.id
        WHERE ${where.join(" AND ")}
        ORDER BY bt.transaction_date DESC, bt.created_at DESC
        LIMIT 250
        `,
        values,
      );
      return result.rows.map((row) => this.withTransactionGuidance(row));
    });
  }

  @Get("bank-transactions/:id")
  @RequirePermission("bank_transaction.read")
  async getTransaction(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireTransaction(client, request.auth.tenantId, id));
  }

  @Get("bank-transactions/:id/detail")
  @RequirePermission("bank_transaction.read")
  async getTransactionDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const transaction = await this.requireTransaction(client, request.auth.tenantId, id);
      const matches = await this.listMatchesForTransaction(client, request.auth.tenantId, id);
      return {
        bank_transaction: this.withTransactionGuidance(transaction),
        bank_account_context: await this.requireAccount(client, request.auth.tenantId, String(transaction.bank_account_id)),
        reconciliation_matches: matches,
        matched_payment_context: await this.paymentContext(client, request.auth.tenantId, matches),
        matched_cash_context: await this.cashContext(client, request.auth.tenantId, matches),
        exception_summary: pick(transaction, ["exception_status", "exception_reason", "reconciliation_status"]),
        boundary_summary: this.boundarySummary(),
        warnings: this.transactionWarnings(transaction),
        blockers: this.transactionBlockers(transaction),
        recommended_next_action: this.recommendedTransactionAction(transaction),
        timeline_available: true,
        audit_allowed: await this.hasPermission(client, request.auth.tenantId, request.auth.userId, "bank_transaction.audit.read"),
      };
    });
  }

  @Post("bank-transactions")
  @RequirePermission("bank_transaction.create")
  async createTransaction(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "bank_transaction.create", "bank_transaction.created", "bank_transaction", async (client) => {
      const account = await this.requireAccount(client, request.auth.tenantId, this.requireText(body.bank_account_id, "bank_account_id is required"));
      const sourceType = this.allowed(body.source_type ?? "manual", "source_type", sourceTypes);
      if (sourceType !== "manual") throw new BadRequestException("bank statement import and bank feed source types are future scope");
      const transaction = await this.insert(client, "bank_transactions", {
        tenant_id: request.auth.tenantId,
        bank_account_id: account.id,
        transaction_date: this.requireText(body.transaction_date, "transaction_date is required"),
        posted_date: this.optionalString(body.posted_date),
        direction: this.allowed(body.direction, "direction", directions),
        amount: this.requirePositive(body.amount, "amount"),
        currency: this.optionalString(body.currency) ?? account.currency ?? "USD",
        description: this.requireText(body.description, "description is required"),
        bank_reference: this.optionalString(body.bank_reference),
        external_transaction_id: this.optionalString(body.external_transaction_id),
        payment_method: body.payment_method === undefined ? undefined : this.allowed(body.payment_method, "payment_method", paymentMethods),
        transaction_type: this.allowed(body.transaction_type, "transaction_type", transactionTypes),
        cleared_status: body.cleared_status === undefined ? "unknown" : this.allowed(body.cleared_status, "cleared_status", clearedStatuses),
        source_type: sourceType,
        notes: this.optionalString(body.notes),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "bank_transaction", entityId: transaction.id as string, afterState: this.withTransactionGuidance(transaction) };
    });
  }

  @Patch("bank-transactions/:id")
  @RequirePermission("bank_transaction.update")
  async updateTransaction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "bank_transaction.update", "bank_transaction.updated", "bank_transaction", async (client) => {
      const before = await this.requireTransaction(client, request.auth.tenantId, id);
      const hasMatches = await this.hasActiveMatches(client, request.auth.tenantId, id);
      const hasOverride = this.hasOverride(body);
      if ((body.amount !== undefined || body.direction !== undefined) && hasMatches && !hasOverride) throw new BadRequestException("amount or direction cannot be changed after matching without override");
      const values = pick(body, ["transaction_date", "posted_date", "description", "bank_reference", "external_transaction_id", "notes", "exception_reason"]);
      if (body.payment_method !== undefined) values.payment_method = this.allowed(body.payment_method, "payment_method", paymentMethods);
      if (body.cleared_status !== undefined) values.cleared_status = this.allowed(body.cleared_status, "cleared_status", clearedStatuses);
      if (body.direction !== undefined) values.direction = this.allowed(body.direction, "direction", directions);
      if (body.amount !== undefined) values.amount = this.requirePositive(body.amount, "amount");
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "bank_transactions", request.auth.tenantId, id, values);
      return { entityType: "bank_transaction", entityId: id, beforeState: before, afterState: this.withTransactionGuidance(after) };
    });
  }

  @Post("bank-transactions/:id/ignore")
  @RequirePermission("bank_transaction.ignore")
  async ignoreTransaction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "bank_transaction.ignore", "bank_transaction.ignored", "bank_transaction", async (client) => {
      const before = await this.requireTransaction(client, request.auth.tenantId, id);
      const after = await this.update(client, "bank_transactions", request.auth.tenantId, id, {
        reconciliation_status: "ignored",
        exception_status: "ignored",
        ignored_by: request.auth.userId,
        ignored_at: new Date(),
        ignore_reason: this.requireText(body.ignore_reason, "ignore_reason is required"),
        ignore_note: this.optionalString(body.ignore_note),
        updated_by: request.auth.userId,
        updated_at: new Date(),
      });
      return { entityType: "bank_transaction", entityId: id, beforeState: before, afterState: this.withTransactionGuidance(after) };
    }, body.ignore_reason);
  }

  @Post("bank-transactions/:id/archive")
  @RequirePermission("bank_transaction.archive")
  async archiveTransaction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "bank_transaction.archive", "bank_transaction.archived", "bank_transaction", async (client) => {
      const before = await this.requireTransaction(client, request.auth.tenantId, id);
      const after = await this.update(client, "bank_transactions", request.auth.tenantId, id, {
        reconciliation_status: "archived",
        archived_by: request.auth.userId,
        archived_at: new Date(),
        archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
        archive_note: this.optionalString(body.archive_note),
        updated_by: request.auth.userId,
        updated_at: new Date(),
      });
      return { entityType: "bank_transaction", entityId: id, beforeState: before, afterState: this.withTransactionGuidance(after) };
    }, body.archive_reason);
  }

  @Post("bank-transactions/:id/matches/payment-batch")
  @RequirePermission("bank_transaction.match")
  async matchPaymentBatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.createMatch(request, id, body, "payment_batch");
  }

  @Post("bank-transactions/:id/matches/payment-item")
  @RequirePermission("bank_transaction.match")
  async matchPaymentItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.createMatch(request, id, body, "payment_item");
  }

  @Post("bank-transactions/:id/matches/cash-receipt")
  @RequirePermission("bank_transaction.match")
  async matchCashReceipt(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.createMatch(request, id, body, "cash_receipt");
  }

  @Post("bank-transactions/:id/matches/payment-application")
  @RequirePermission("bank_transaction.match")
  async matchPaymentApplication(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.createMatch(request, id, body, "payment_application_context");
  }

  @Post("bank-transactions/:id/open-exception")
  @RequirePermission("bank_transaction.open_exception")
  async openException(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "bank_transaction.open_exception", "bank_transaction.exception_opened", "bank_transaction", async (client) => {
      const before = await this.requireTransaction(client, request.auth.tenantId, id);
      const after = await this.update(client, "bank_transactions", request.auth.tenantId, id, {
        reconciliation_status: "exception",
        exception_status: "open",
        exception_reason: this.requireText(body.exception_reason, "exception_reason is required"),
        notes: this.optionalString(body.notes) ?? before.notes,
        updated_by: request.auth.userId,
        updated_at: new Date(),
      });
      return { entityType: "bank_transaction", entityId: id, beforeState: before, afterState: this.withTransactionGuidance(after) };
    }, body.exception_reason);
  }

  @Post("bank-transactions/:id/resolve-exception")
  @RequirePermission("bank_transaction.resolve_exception")
  async resolveException(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "bank_transaction.resolve_exception", "bank_transaction.exception_resolved", "bank_transaction", async (client) => {
      this.requireText(body.resolution_note, "resolution_note is required");
      const before = await this.requireTransaction(client, request.auth.tenantId, id);
      const recalculated = await this.calculateTransactionStatus(client, request.auth.tenantId, id);
      const after = await this.update(client, "bank_transactions", request.auth.tenantId, id, {
        reconciliation_status: recalculated.reconciliation_status,
        exception_status: "resolved",
        notes: this.optionalString(body.resolution_note) ?? before.notes,
        updated_by: request.auth.userId,
        updated_at: new Date(),
      });
      return { entityType: "bank_transaction", entityId: id, beforeState: before, afterState: this.withTransactionGuidance(after) };
    }, body.resolution_note);
  }

  @Get("reconciliation-matches")
  @RequirePermission("reconciliation_match.read")
  async listMatches(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["rm.tenant_id = $1", "rm.deleted_at IS NULL"];
      if (query.archived !== "true") where.push("rm.match_status <> 'archived'");
      this.addFilter(where, values, "rm.bank_transaction_id", query.bank_transaction_id);
      this.addFilter(where, values, "rm.match_type", query.match_type);
      this.addFilter(where, values, "rm.matched_object_type", query.matched_object_type);
      this.addFilter(where, values, "rm.matched_object_id", query.matched_object_id);
      this.addFilter(where, values, "rm.payment_batch_id", query.payment_batch_id);
      this.addFilter(where, values, "rm.payment_item_id", query.payment_item_id);
      this.addFilter(where, values, "rm.cash_receipt_id", query.cash_receipt_id);
      this.addFilter(where, values, "rm.payment_application_id", query.payment_application_id);
      this.addFilter(where, values, "rm.invoice_id", query.invoice_id);
      this.addFilter(where, values, "rm.match_status", query.match_status);
      this.addFilter(where, values, "rm.match_confidence", query.match_confidence);
      if (query.q) {
        values.push(`%${query.q}%`);
        where.push(`(rm.match_reason ILIKE $${values.length} OR rm.notes ILIKE $${values.length} OR bt.description ILIKE $${values.length} OR bt.bank_reference ILIKE $${values.length})`);
      }
      const result = await client.query(
        `
        SELECT rm.*, bt.description AS bank_transaction_description, bt.bank_reference, bt.amount AS bank_transaction_amount
        FROM reconciliation_matches rm
        JOIN bank_transactions bt ON bt.tenant_id = rm.tenant_id AND bt.id = rm.bank_transaction_id
        WHERE ${where.join(" AND ")}
        ORDER BY rm.created_at DESC
        LIMIT 250
        `,
        values,
      );
      return result.rows.map((row) => this.withMatchGuidance(row));
    });
  }

  @Get("reconciliation-matches/:id")
  @RequirePermission("reconciliation_match.read")
  async getMatch(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireMatch(client, request.auth.tenantId, id));
  }

  @Get("reconciliation-matches/:id/detail")
  @RequirePermission("reconciliation_match.read")
  async getMatchDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const match = await this.requireMatch(client, request.auth.tenantId, id);
      return {
        reconciliation_match: this.withMatchGuidance(match),
        bank_transaction_context: await this.requireTransaction(client, request.auth.tenantId, String(match.bank_transaction_id)),
        matched_object_context: await this.matchedObjectContext(client, request.auth.tenantId, match),
        payment_context: await this.paymentContext(client, request.auth.tenantId, [match]),
        cash_context: await this.cashContext(client, request.auth.tenantId, [match]),
        invoice_context: match.invoice_id ? await this.optionalRecord(client, "invoices", request.auth.tenantId, match.invoice_id) : null,
        review_approval_summary: pick(match, ["match_status", "reviewed_by", "reviewed_at", "approved_by", "approved_at", "rejected_by", "rejected_at", "rejection_reason", "rejection_note"]),
        boundary_summary: this.boundarySummary(),
        audit_allowed: await this.hasPermission(client, request.auth.tenantId, request.auth.userId, "reconciliation_match.audit.read"),
      };
    });
  }

  @Post("reconciliation-matches/:id/review")
  @RequirePermission("reconciliation_match.review")
  async reviewMatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.matchStateAction(request, id, "reconciliation_match.review", "reconciliation_match.reviewed", () => ({
      match_status: "reviewed",
      reviewed_by: request.auth.userId,
      reviewed_at: new Date(),
      notes: this.optionalString(body.review_note),
    }), body.review_note);
  }

  @Post("reconciliation-matches/:id/approve")
  @RequirePermission("reconciliation_match.approve")
  async approveMatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.matchStateAction(request, id, "reconciliation_match.approve", "reconciliation_match.approved", async (match, client) => {
      this.requireText(body.approval_note, "approval_note is required");
      return {
        match_status: "approved",
        approved_by: request.auth.userId,
        approved_at: new Date(),
        override_reasons: body.override_reasons === undefined ? match.override_reasons : this.objectValue(body.override_reasons),
        notes: this.optionalString(body.approval_note) ?? match.notes,
      };
    }, body.approval_note, true);
  }

  @Post("reconciliation-matches/:id/reject")
  @RequirePermission("reconciliation_match.reject")
  async rejectMatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.matchStateAction(request, id, "reconciliation_match.reject", "reconciliation_match.rejected", () => ({
      match_status: "rejected",
      rejected_by: request.auth.userId,
      rejected_at: new Date(),
      rejection_reason: this.requireText(body.rejection_reason, "rejection_reason is required"),
      rejection_note: this.optionalString(body.rejection_note),
    }), body.rejection_reason, true);
  }

  @Post("reconciliation-matches/:id/void")
  @RequirePermission("reconciliation_match.void")
  async voidMatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.matchStateAction(request, id, "reconciliation_match.void", "reconciliation_match.voided", () => ({
      match_status: "voided",
      voided_by: request.auth.userId,
      voided_at: new Date(),
      void_reason: this.requireText(body.void_reason, "void_reason is required"),
      void_note: this.optionalString(body.void_note),
    }), body.void_reason, true);
  }

  @Post("reconciliation-matches/:id/archive")
  @RequirePermission("reconciliation_match.archive")
  async archiveMatch(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.matchStateAction(request, id, "reconciliation_match.archive", "reconciliation_match.archived", () => ({
      match_status: "archived",
      archived_by: request.auth.userId,
      archived_at: new Date(),
      archive_reason: this.requireText(body.archive_reason, "archive_reason is required"),
      archive_note: this.optionalString(body.archive_note),
    }), body.archive_reason, true);
  }

  @Get("bank-transactions/:id/timeline")
  @RequirePermission("bank_transaction.timeline.read")
  async transactionTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.timeline(request, id, "bank_transaction");
  }

  @Get("bank-accounts/:id/timeline")
  @RequirePermission("bank_account.timeline.read")
  async accountTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.timeline(request, id, "bank_account");
  }

  @Get("bank-transactions/:id/audit-summary")
  @RequirePermission("bank_transaction.audit.read")
  async transactionAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.audit(request, id, "bank_transaction");
  }

  @Get("bank-accounts/:id/audit-summary")
  @RequirePermission("bank_account.audit.read")
  async accountAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.audit(request, id, "bank_account");
  }

  @Get("reconciliation-matches/:id/audit-summary")
  @RequirePermission("reconciliation_match.audit.read")
  async matchAudit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.audit(request, id, "reconciliation_match");
  }

  private async createMatch(request: AuthenticatedRequest, transactionId: string, body: Row, matchType: string) {
    return this.write(request, "reconciliation_match.create", "reconciliation_match.created", "reconciliation_match", async (client) => {
      const transaction = await this.requireTransaction(client, request.auth.tenantId, transactionId);
      const hasOverride = this.hasOverride(body);
      const matchedAmount = this.requirePositive(body.matched_amount, "matched_amount");
      const remaining = await this.remainingUnmatchedAmount(client, request.auth.tenantId, transactionId);
      if (matchedAmount > remaining && !hasOverride) throw new BadRequestException("matched_amount cannot exceed remaining unmatched amount without override");
      const values: Row = {
        tenant_id: request.auth.tenantId,
        bank_transaction_id: transactionId,
        match_type: matchType,
        matched_amount: matchedAmount,
        match_confidence: body.match_confidence === undefined ? "manual" : this.allowed(body.match_confidence, "match_confidence", matchConfidences),
        match_reason: this.optionalString(body.match_reason),
        variance_amount: Number(transaction.amount ?? 0) - matchedAmount,
        override_reasons: this.objectValue(body.override_reasons),
        notes: this.optionalString(body.notes),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      };
      await this.populateMatchTarget(client, request.auth.tenantId, transaction, body, values, matchType, hasOverride);
      const match = await this.insert(client, "reconciliation_matches", values);
      const status = await this.recalculateTransactionStatus(client, request.auth.tenantId, transactionId, request.auth.userId);
      return {
        entityType: "reconciliation_match",
        entityId: match.id as string,
        afterState: this.withMatchGuidance(match),
        additionalEvents: [this.additionalEvent("bank_transaction.match", "bank_transaction", transactionId, status.reconciliation_status === "exception" ? "bank_transaction.exception_opened" : "bank_transaction.matched", status)],
      };
    });
  }

  private async populateMatchTarget(client: PoolClient, tenantId: string, transaction: Row, body: Row, values: Row, matchType: string, hasOverride: boolean) {
    if (matchType === "payment_batch") {
      if (transaction.direction !== "debit" && !hasOverride) throw new BadRequestException("payment batch matches require debit transaction unless override supplied");
      const batch = await this.requireRecord(client, "payment_batches", tenantId, this.requireText(body.payment_batch_id, "payment_batch_id is required"), "payment batch not found");
      if (!["submitted", "executed_later"].includes(String(batch.status)) && !hasOverride) throw new BadRequestException("payment batch must be submitted or executed_later unless override supplied");
      Object.assign(values, { matched_object_type: "payment_batch", matched_object_id: batch.id, payment_batch_id: batch.id });
      return;
    }
    if (matchType === "payment_item") {
      if (transaction.direction !== "debit" && !hasOverride) throw new BadRequestException("payment item matches require debit transaction unless override supplied");
      const item = await this.requireRecord(client, "payment_items", tenantId, this.requireText(body.payment_item_id, "payment_item_id is required"), "payment item not found");
      if (!["submitted_later", "executed_later"].includes(String(item.status)) && !hasOverride) throw new BadRequestException("payment item must be submitted_later or executed_later unless override supplied");
      Object.assign(values, { matched_object_type: "payment_item", matched_object_id: item.id, payment_item_id: item.id, payment_batch_id: item.payment_batch_id });
      return;
    }
    if (matchType === "cash_receipt") {
      if (transaction.direction !== "credit" && !hasOverride) throw new BadRequestException("cash receipt matches require credit transaction unless override supplied");
      const receipt = await this.requireRecord(client, "cash_receipts", tenantId, this.requireText(body.cash_receipt_id, "cash_receipt_id is required"), "cash receipt not found");
      Object.assign(values, { matched_object_type: "cash_receipt", matched_object_id: receipt.id, cash_receipt_id: receipt.id });
      return;
    }
    if (matchType === "payment_application_context") {
      const application = await this.requireRecord(client, "payment_applications", tenantId, this.requireText(body.payment_application_id, "payment_application_id is required"), "payment application not found");
      Object.assign(values, { matched_object_type: "payment_application", matched_object_id: application.id, payment_application_id: application.id, invoice_id: application.invoice_id, cash_receipt_id: application.cash_receipt_id });
      return;
    }
    throw new BadRequestException("match type is not supported");
  }

  private async matchStateAction(request: AuthenticatedRequest, id: string, action: string, eventType: string, transition: (match: Row, client: PoolClient) => Promise<Row> | Row, reason?: unknown, recalculate = false) {
    return this.write(request, action, eventType, "reconciliation_match", async (client) => {
      const before = await this.requireMatch(client, request.auth.tenantId, id);
      const values = await transition(before, client);
      values.updated_by = request.auth.userId;
      values.updated_at = new Date();
      const after = await this.update(client, "reconciliation_matches", request.auth.tenantId, id, values);
      const additionalEvents: WriteActionResult<Row>["additionalEvents"] = [];
      if (recalculate) {
        const transaction = await this.recalculateTransactionStatus(client, request.auth.tenantId, String(after.bank_transaction_id), request.auth.userId);
        if (after.match_status === "approved") {
          await this.updateMatchedSourceStatus(client, request.auth.tenantId, after, request.auth.userId);
          if (after.payment_item_id) additionalEvents.push(this.additionalEvent("reconciliation_match.approve", "payment_item", String(after.payment_item_id), "payment_item.bank_match_approved", { reconciliation_match_id: after.id, bank_transaction_id: after.bank_transaction_id }));
          if (after.cash_receipt_id) additionalEvents.push(this.additionalEvent("reconciliation_match.approve", "cash_receipt", String(after.cash_receipt_id), "cash_receipt.bank_match_approved", { reconciliation_match_id: after.id, bank_transaction_id: after.bank_transaction_id }));
        }
        additionalEvents.push(this.additionalEvent("bank_transaction.recalculate_status", "bank_transaction", String(after.bank_transaction_id), transaction.reconciliation_status === "exception" ? "bank_transaction.exception_opened" : "bank_transaction.matched", transaction));
      }
      return { entityType: "reconciliation_match", entityId: id, beforeState: before, afterState: this.withMatchGuidance(after), additionalEvents };
    }, reason);
  }

  private async updateMatchedSourceStatus(client: PoolClient, tenantId: string, match: Row, userId: string) {
    if (match.cash_receipt_id) {
      await client.query(
        "UPDATE cash_receipts SET reconciliation_status = 'reconciled_later', deposit_status = 'reconciled_later', updated_by = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL",
        [tenantId, match.cash_receipt_id, userId],
      );
    }
  }

  private async calculateTransactionStatus(client: PoolClient, tenantId: string, transactionId: string) {
    const transaction = await this.requireTransaction(client, tenantId, transactionId);
    if (transaction.reconciliation_status === "archived" || transaction.reconciliation_status === "ignored") return pick(transaction, ["reconciliation_status", "exception_status"]);
    const total = await this.approvedMatchAmount(client, tenantId, transactionId);
    const amount = Number(transaction.amount ?? 0);
    if (total <= 0) return { reconciliation_status: "unreconciled", exception_status: "none" };
    if (total < amount) return { reconciliation_status: "partially_matched", exception_status: "none" };
    if (total === amount) return { reconciliation_status: "matched", exception_status: transaction.exception_status === "resolved" ? "resolved" : "none" };
    return { reconciliation_status: "exception", exception_status: "open", exception_reason: "approved matches exceed bank transaction amount" };
  }

  private async recalculateTransactionStatus(client: PoolClient, tenantId: string, transactionId: string, userId: string) {
    const status = await this.calculateTransactionStatus(client, tenantId, transactionId);
    return this.update(client, "bank_transactions", tenantId, transactionId, { ...status, updated_by: userId, updated_at: new Date() });
  }

  private async approvedMatchAmount(client: PoolClient, tenantId: string, transactionId: string) {
    const result = await client.query(
      "SELECT COALESCE(sum(matched_amount), 0)::numeric AS total FROM reconciliation_matches WHERE tenant_id = $1 AND bank_transaction_id = $2 AND deleted_at IS NULL AND match_status = 'approved'",
      [tenantId, transactionId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private async remainingUnmatchedAmount(client: PoolClient, tenantId: string, transactionId: string) {
    const transaction = await this.requireTransaction(client, tenantId, transactionId);
    const result = await client.query(
      "SELECT COALESCE(sum(matched_amount), 0)::numeric AS total FROM reconciliation_matches WHERE tenant_id = $1 AND bank_transaction_id = $2 AND deleted_at IS NULL AND match_status NOT IN ('rejected', 'voided', 'archived')",
      [tenantId, transactionId],
    );
    return Number(transaction.amount ?? 0) - Number(result.rows[0]?.total ?? 0);
  }

  private async requireAccount(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM bank_accounts WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("bank account not found");
    return result.rows[0] as Row;
  }

  private async requireTransaction(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM bank_transactions WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("bank transaction not found");
    return result.rows[0] as Row;
  }

  private async requireMatch(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT * FROM reconciliation_matches WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("reconciliation match not found");
    return result.rows[0] as Row;
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: unknown, message: string) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException(message);
    return result.rows[0] as Row;
  }

  private async optionalRecord(client: PoolClient, table: string, tenantId: string, id: unknown) {
    if (!id) return null;
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    return result.rows[0] ?? null;
  }

  private async hasActiveMatches(client: PoolClient, tenantId: string, transactionId: string) {
    const result = await client.query("SELECT 1 FROM reconciliation_matches WHERE tenant_id = $1 AND bank_transaction_id = $2 AND deleted_at IS NULL AND match_status NOT IN ('rejected', 'voided', 'archived') LIMIT 1", [tenantId, transactionId]);
    return Boolean(result.rows[0]);
  }

  private async listMatchesForTransaction(client: PoolClient, tenantId: string, transactionId: string) {
    return (await client.query("SELECT * FROM reconciliation_matches WHERE tenant_id = $1 AND bank_transaction_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [tenantId, transactionId])).rows.map((row) => this.withMatchGuidance(row));
  }

  private async accountSummary(client: PoolClient, tenantId: string, accountId: string) {
    const result = await client.query(
      `SELECT count(*)::int AS transaction_count,
        count(*) FILTER (WHERE reconciliation_status = 'unreconciled')::int AS unreconciled_count,
        count(*) FILTER (WHERE exception_status = 'open' OR reconciliation_status = 'exception')::int AS exception_count
      FROM bank_transactions
      WHERE tenant_id = $1 AND bank_account_id = $2 AND deleted_at IS NULL`,
      [tenantId, accountId],
    );
    return result.rows[0] ?? {};
  }

  private async paymentContext(client: PoolClient, tenantId: string, matches: Row[]) {
    const batchIds = [...new Set(matches.map((match) => match.payment_batch_id).filter(Boolean))];
    const itemIds = [...new Set(matches.map((match) => match.payment_item_id).filter(Boolean))];
    return {
      payment_batches: batchIds.length ? (await client.query("SELECT * FROM payment_batches WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, batchIds])).rows : [],
      payment_items: itemIds.length ? (await client.query("SELECT * FROM payment_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, itemIds])).rows : [],
    };
  }

  private async cashContext(client: PoolClient, tenantId: string, matches: Row[]) {
    const receiptIds = [...new Set(matches.map((match) => match.cash_receipt_id).filter(Boolean))];
    const applicationIds = [...new Set(matches.map((match) => match.payment_application_id).filter(Boolean))];
    return {
      cash_receipts: receiptIds.length ? (await client.query("SELECT * FROM cash_receipts WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, receiptIds])).rows : [],
      payment_applications: applicationIds.length ? (await client.query("SELECT * FROM payment_applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, applicationIds])).rows : [],
    };
  }

  private async matchedObjectContext(client: PoolClient, tenantId: string, match: Row) {
    if (match.payment_batch_id) return this.optionalRecord(client, "payment_batches", tenantId, match.payment_batch_id);
    if (match.payment_item_id) return this.optionalRecord(client, "payment_items", tenantId, match.payment_item_id);
    if (match.cash_receipt_id) return this.optionalRecord(client, "cash_receipts", tenantId, match.cash_receipt_id);
    if (match.payment_application_id) return this.optionalRecord(client, "payment_applications", tenantId, match.payment_application_id);
    return null;
  }

  private withAccountGuidance(row: Row) {
    return { ...row, warnings: this.accountWarnings(row), blockers: [], recommended_next_action: "review_transactions" };
  }

  private accountWarnings(row: Row) {
    const warnings: string[] = [];
    if (row.masked_account_number && /\d{9,}/.test(String(row.masked_account_number).replace(/\D/g, ""))) warnings.push("masked_account_number_may_include_too_many_digits");
    return warnings;
  }

  private withTransactionGuidance(row: Row) {
    return { ...row, warnings: this.transactionWarnings(row), blockers: this.transactionBlockers(row), recommended_next_action: this.recommendedTransactionAction(row) };
  }

  private transactionWarnings(row: Row) {
    const warnings: string[] = [];
    if (row.source_type !== "manual") warnings.push("non_manual_source_is_future_scope");
    if (row.cleared_status === "returned" || row.cleared_status === "reversed") warnings.push("returned_or_reversed_bank_activity_requires_exception_review");
    return warnings;
  }

  private transactionBlockers(row: Row) {
    const blockers: string[] = [];
    if (row.exception_status === "open") blockers.push("open_exception");
    if (row.reconciliation_status === "ignored") blockers.push("transaction_ignored");
    return blockers;
  }

  private recommendedTransactionAction(row: Row) {
    if (row.reconciliation_status === "archived") return "view_only";
    if (row.reconciliation_status === "ignored") return "view_ignored_transaction";
    if (row.exception_status === "open") return "resolve_exception";
    if (row.reconciliation_status === "unreconciled") return "create_match";
    if (row.reconciliation_status === "partially_matched") return "review_remaining_unmatched_amount";
    if (row.reconciliation_status === "matched") return "review_or_approve_matches";
    return "review_transaction";
  }

  private withMatchGuidance(row: Row) {
    return { ...row, recommended_next_action: this.recommendedMatchAction(row) };
  }

  private recommendedMatchAction(row: Row) {
    if (row.match_status === "archived") return "view_only";
    if (row.match_status === "voided") return "view_voided_match";
    if (row.match_status === "proposed") return "review_match";
    if (row.match_status === "reviewed") return "approve_or_reject_match";
    if (row.match_status === "approved") return "view_approved_match";
    if (row.match_status === "rejected") return "review_rejected_match";
    return "review_match";
  }

  private boundarySummary() {
    return {
      creates_bank_feed: false,
      imports_bank_statement: false,
      creates_payment_execution: false,
      creates_cash_receipt: false,
      creates_payment_application: false,
      updates_invoice_balance: false,
      creates_accounting_export: false,
      creates_gl_entry: false,
      creates_tax_filing: false,
      creates_treasury_forecast: false,
      moves_money: false,
    };
  }

  private async timeline(request: AuthenticatedRequest, id: string, aggregateType: "bank_transaction" | "bank_account") {
    return this.withClient(async (client) => {
      if (aggregateType === "bank_transaction") await this.requireTransaction(client, request.auth.tenantId, id);
      else await this.requireAccount(client, request.auth.tenantId, id);
      const matchIds = aggregateType === "bank_transaction" ? (await client.query("SELECT id FROM reconciliation_matches WHERE tenant_id = $1 AND bank_transaction_id = $2", [request.auth.tenantId, id])).rows.map((row) => row.id) : [];
      const transactionIds = aggregateType === "bank_account" ? (await client.query("SELECT id FROM bank_transactions WHERE tenant_id = $1 AND bank_account_id = $2", [request.auth.tenantId, id])).rows.map((row) => row.id) : [];
      const ids = [id, ...matchIds, ...transactionIds];
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

  private async audit(request: AuthenticatedRequest, id: string, entityType: "bank_transaction" | "bank_account" | "reconciliation_match") {
    return this.withClient(async (client) => {
      if (entityType === "bank_transaction") await this.requireTransaction(client, request.auth.tenantId, id);
      if (entityType === "bank_account") await this.requireAccount(client, request.auth.tenantId, id);
      if (entityType === "reconciliation_match") await this.requireMatch(client, request.auth.tenantId, id);
      const result = await client.query(
        "SELECT id, actor_user_id AS actor, action, entity_type AS object, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 250",
        [request.auth.tenantId, id],
      );
      return result.rows;
    });
  }

  private async insert(client: PoolClient, table: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    const result = await client.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`, keys.map((key) => values[key]));
    return result.rows[0] as Row;
  }

  private async update(client: PoolClient, table: string, tenantId: string, id: string, values: Row) {
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    if (!keys.length) {
      if (table === "bank_accounts") return this.requireAccount(client, tenantId, id);
      if (table === "bank_transactions") return this.requireTransaction(client, tenantId, id);
      return this.requireMatch(client, tenantId, id);
    }
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

  private addNumberFilter(where: string[], values: unknown[], column: string, operator: string, value?: string) {
    if (!value) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    values.push(parsed);
    where.push(`${column} ${operator} $${values.length}`);
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

  private optionalNumber(value: unknown) {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new BadRequestException("numeric value is invalid");
    return parsed;
  }

  private requirePositive(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new BadRequestException(`${field} must be > 0`);
    return parsed;
  }

  private routingLast4(value: unknown) {
    const text = this.optionalString(value);
    if (!text) return undefined;
    if (text.length > 4) throw new BadRequestException("routing_last4 length must be <= 4");
    return text;
  }

  private objectValue(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return {};
  }

  private hasOverride(body: Row) {
    return Object.keys(this.objectValue(body.override_reasons)).length > 0;
  }

  private validateBankSensitiveFields(body: Row) {
    const payload = JSON.stringify(body).toLowerCase();
    for (const blocked of ["credential", "password", "token", "secret", "api_key", "login"]) {
      if (payload.includes(blocked)) throw new BadRequestException("bank credentials and tokens are not allowed");
    }
    const masked = this.optionalString(body.masked_account_number);
    if (masked && masked.replace(/\D/g, "").length > 8 && !masked.includes("*") && !masked.toLowerCase().includes("x")) {
      throw new BadRequestException("masked_account_number must not contain a full account number");
    }
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
