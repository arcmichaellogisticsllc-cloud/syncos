import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireString } from "./intelligence.types";

const invoiceAuthorityRoles = new Set(["Billing Manager", "Finance Manager"]);

@Controller()
export class CashController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("invoices")
  @RequirePermission("invoice.read")
  async listInvoices(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "invoices", request.auth.tenantId, { searchColumns: ["invoice_number", "status"] }));
  }

  @Get("invoices/:id")
  @RequirePermission("invoice.read")
  async getInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found"));
  }

  @Post("invoices")
  @RequirePermission("invoice.create")
  async createInvoice(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const invoiceNumber = requireString(body.invoice_number, "invoice_number is required");
      const invoiceDate = requireString(body.invoice_date, "invoice_date is required");
      const dueDate = requireString(body.due_date, "due_date is required");
      const invoiceAmount = this.requireNonNegative(body.invoice_amount, "invoice_amount");
      return await this.write(request, "invoice.create", "invoice.created", "invoice", async (client) => {
        const settlement = await this.requireApprovedSettlement(client, request.auth.tenantId, body.settlement_id);
        if (invoiceAmount !== Number(settlement.net_amount)) throw new BadRequestException("invoice_amount must equal settlement net_amount");
        const invoice = await insertTenantRecord(client, "invoices", request.auth.tenantId, {
          settlement_id: settlement.id,
          organization_id: settlement.customer_organization_id,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: dueDate,
          invoice_amount: invoiceAmount,
          total_amount: invoiceAmount,
          status: "draft",
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
      const values = pick(body, ["invoice_number", "invoice_date", "due_date"]);
      return await this.write(request, "invoice.update", "invoice.updated", "invoice", async (client) => {
        const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
        if (body.settlement_id) {
          const settlement = await this.requireApprovedSettlement(client, request.auth.tenantId, body.settlement_id);
          values.settlement_id = settlement.id;
          values.organization_id = settlement.customer_organization_id;
          values.invoice_amount = Number(settlement.net_amount);
          values.total_amount = Number(settlement.net_amount);
        }
        if (body.invoice_amount !== undefined) {
          const settlement = await this.requireApprovedSettlement(client, request.auth.tenantId, values.settlement_id ?? before.settlement_id);
          const invoiceAmount = this.requireNonNegative(body.invoice_amount, "invoice_amount");
          if (invoiceAmount !== Number(settlement.net_amount)) throw new BadRequestException("invoice_amount must equal settlement net_amount");
          values.invoice_amount = invoiceAmount;
          values.total_amount = invoiceAmount;
        }
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
  async submitInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "invoice.submit", "invoice.submitted", "invoice", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, invoiceAuthorityRoles, "Billing Manager or Finance Manager authority is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (before.status !== "draft") throw new BadRequestException("invoice must be draft");
      requireString(before.invoice_number, "invoice_number is required");
      if (!before.invoice_date) throw new BadRequestException("invoice_date is required");
      if (!before.due_date) throw new BadRequestException("due_date is required");
      if (before.invoice_amount === undefined || before.invoice_amount === null) throw new BadRequestException("invoice_amount is required");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, { status: "submitted" });
      if (!after) throw new NotFoundException("invoice not found");
      const arRecord = await insertTenantRecord(client, "ar_records", request.auth.tenantId, {
        invoice_id: id,
        customer_organization_id: before.organization_id,
        amount_open: before.invoice_amount,
        balance: before.invoice_amount,
        ...this.calculateAging(before.due_date),
        status: "open",
      });
      return {
        entityType: "invoice",
        entityId: id,
        beforeState: before,
        afterState: after,
        additionalEvents: [
          {
            action: "ar_record.create",
            aggregateType: "ar_record",
            entityType: "ar_record",
            entityId: arRecord.id,
            eventType: "ar_record.created",
            afterState: arRecord,
            systemActions: [{ actionType: "ar_record.created.processed", payload: { action: "ar_record.create" } }],
          },
        ],
      };
    });
  }

  @Post("invoices/:id/mark-overdue")
  @RequirePermission("invoice.mark_overdue")
  async markOverdue(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "invoice.mark_overdue", "invoice.overdue", "invoice", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, invoiceAuthorityRoles, "Billing Manager or Finance Manager authority is required");
      const before = await this.requireRecord(client, "invoices", request.auth.tenantId, id, "invoice not found");
      if (before.status !== "submitted") throw new BadRequestException("invoice must be submitted");
      if (this.daysPastDue(before.due_date) <= 0) throw new BadRequestException("invoice is not overdue");
      const after = await updateTenantRecord(client, "invoices", request.auth.tenantId, id, { status: "overdue" });
      if (!after) throw new NotFoundException("invoice not found");
      return { entityType: "invoice", entityId: id, beforeState: before, afterState: after };
    });
  }

  @Post("invoices/:id/archive")
  @RequirePermission("invoice.archive")
  async archiveInvoice(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "invoices", id, "invoice", "invoice.archive", "invoice.archived");
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
