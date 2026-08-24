import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireString } from "./intelligence.types";

type Row = QueryResultRow & Record<string, unknown>;

const billableStatuses = ["voided", "archived"];
const coilTreatments = new Set(["billable_as_footage", "included_in_route_rate", "separate_pay_item", "non_billable", "unconfirmed"]);
const coilPartyTypes = new Set(["customer", "partner"]);
const coilSourceTypes = new Set(["customer_rate_sheet", "partner_rate_sheet", "msa", "work_order", "change_order", "customer_email", "partner_agreement", "written_direction", "other"]);
const coilTypes = new Set(["front_easement", "rear_easement", "express_splice", "butt_splice", "riser_slack", "general_slack", "customer_required", "field_condition", "other"]);
const easementTypes = new Set(["front", "rear", "unknown", "not_applicable"]);

@Controller("accepted-production-financials")
export class AcceptedProductionFinancialsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("billable-queue")
  @RequirePermission("billing.read")
  async billableQueue(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient((client) => this.acceptedProductionRows(client, request.auth.tenantId, query));
  }

  @Get("dashboard")
  @RequirePermission("billing.read")
  async dashboard(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const [queue, billables, invoices, cash, settlements, payables, exceptions] = await Promise.all([
        this.acceptedProductionRows(client, request.auth.tenantId, {}),
        client.query("SELECT count(*)::int AS count, COALESCE(sum(net_billable_amount),0)::numeric AS amount FROM billable_items WHERE tenant_id = $1 AND deleted_at IS NULL AND status <> ALL($2::text[])", [request.auth.tenantId, billableStatuses]),
        client.query("SELECT count(*)::int AS count, COALESCE(sum(balance_amount),0)::numeric AS balance FROM invoices WHERE tenant_id = $1 AND deleted_at IS NULL AND status <> ALL($2::text[])", [request.auth.tenantId, ["voided", "archived"]]),
        client.query("SELECT COALESCE(sum(gross_received_amount),0)::numeric AS received, COALESCE(sum(applied_amount),0)::numeric AS applied FROM cash_receipts WHERE tenant_id = $1 AND deleted_at IS NULL AND receipt_status <> ALL($2::text[])", [request.auth.tenantId, ["voided", "archived"]]),
        client.query("SELECT count(*)::int AS count, COALESCE(sum(net_settlement_amount),0)::numeric AS amount FROM settlements WHERE tenant_id = $1 AND deleted_at IS NULL AND settlement_type = 'contractor_payable' AND status <> ALL($2::text[])", [request.auth.tenantId, ["voided", "archived"]]),
        client.query("SELECT count(*)::int AS count, COALESCE(sum(net_payable_amount),0)::numeric AS net, COALESCE(sum(eligible_amount),0)::numeric AS eligible FROM contractor_payables WHERE tenant_id = $1 AND deleted_at IS NULL AND status <> ALL($2::text[])", [request.auth.tenantId, ["voided", "archived"]]),
        client.query("SELECT count(*)::int AS count FROM financial_exceptions WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'open'", [request.auth.tenantId]),
      ]);
      return {
        accepted_production_queue_count: queue.filter((row) => !row.billable_item_id).length,
        billable_count: billables.rows[0].count,
        billable_amount: Number(billables.rows[0].amount),
        invoice_count: invoices.rows[0].count,
        invoice_balance: Number(invoices.rows[0].balance),
        cash_received: Number(cash.rows[0].received),
        cash_applied: Number(cash.rows[0].applied),
        partner_settlement_count: settlements.rows[0].count,
        partner_settlement_amount: Number(settlements.rows[0].amount),
        contractor_payable_count: payables.rows[0].count,
        contractor_payable_net: Number(payables.rows[0].net),
        contractor_payable_eligible: Number(payables.rows[0].eligible),
        open_exception_count: exceptions.rows[0].count,
        boundary: {
          settlement_is_payment: false,
          contractor_payable_is_payment: false,
          customer_cash_creates_partner_payment: false,
        },
      };
    });
  }

  @Post("billables/convert")
  @RequirePermission("billing.create_billable")
  async convertBillables(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "billable.created", "billable.created", "billable_item", async (client) => {
      const accepted = await this.requireAcceptedProduction(client, request.auth.tenantId, this.optionalString(body.customer_qc_decision_id));
      const source = await this.ensureFinancialSource(client, request.auth.tenantId, request.auth.userId, accepted);
      const existing = await client.query("SELECT * FROM billable_items WHERE tenant_id = $1 AND accepted_production_source_id = $2 AND deleted_at IS NULL AND status <> ALL($3::text[]) LIMIT 1", [request.auth.tenantId, source.id, billableStatuses]);
      if (existing.rows[0]) {
        await this.ensureCustomerCoilSupplementSources(client, request, accepted);
        await this.createCustomerCoilBillables(client, request);
        return { entityType: "billable_item", entityId: existing.rows[0].id, afterState: this.safeBillable(existing.rows[0]) };
      }
      if (!source.customer_rate_code_id || Number(source.customer_rate ?? 0) <= 0) {
        const exception = await this.createException(client, request, "missing_customer_rate", accepted, "BILLING EXCEPTION - MISSING CUSTOMER RATE");
        return { entityType: "financial_exception", entityId: exception.id, eventType: "financial_exception.created", afterState: exception };
      }
      const billable = await client.query(
        `
        INSERT INTO billable_items (
          tenant_id, project_id, work_order_id, production_record_id, customer_qc_decision_id, accepted_production_source_id,
          customer_organization_id, capacity_provider_id, crew_id, status, readiness_status, readiness_score, readiness_band,
          approved_quantity, billable_quantity, unit, rate_code_id, rate_description, unit_rate, rate_source, rate_confidence,
          estimated_billable_amount, net_billable_amount, customer_acceptance_status, billing_package_status, documentation_status,
          rate_schedule_id, rate_schedule_version, rate_effective_date, currency, source_fingerprint, created_by, updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready_for_settlement','ready_for_settlement',100,'ready_for_settlement',
          $10,$10,$11,$12,$13,$14,'customer_rate','confirmed',$15,$15,'accepted','ready','ready',$16,$17,$18,'USD',$19,$20,$20)
        RETURNING *
        `,
        [
          request.auth.tenantId,
          accepted.project_id,
          accepted.work_order_id,
          accepted.production_record_id,
          accepted.customer_qc_decision_id,
          source.id,
          accepted.customer_organization_id,
          accepted.capacity_provider_id,
          accepted.crew_id,
          accepted.accepted_quantity,
          accepted.unit_of_measure,
          source.customer_rate_code_id,
          accepted.production_description,
          source.customer_rate,
          source.customer_extended_amount,
          source.customer_rate_schedule_id,
          "effective:" + String(source.customer_rate_effective_date ?? ""),
          source.customer_rate_effective_date,
          source.source_fingerprint,
          request.auth.userId,
        ],
      );
      await client.query("UPDATE accepted_production_financial_sources SET billable_item_id = $1, financial_status = 'billable_created', updated_at = now() WHERE tenant_id = $2 AND id = $3", [billable.rows[0].id, request.auth.tenantId, source.id]);
      await this.ensureCustomerCoilSupplementSources(client, request, accepted);
      await this.createCustomerCoilBillables(client, request);
      return { entityType: "billable_item", entityId: billable.rows[0].id, afterState: this.safeBillable(billable.rows[0]) };
    });
  }

  @Post("invoices/create")
  @RequirePermission("billing.create_invoice")
  async createInvoice(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "invoice.created", "invoice.created", "invoice", async (client) => {
      const billables = await this.billablesForBody(client, request.auth.tenantId, body);
      if (!billables.length) throw new BadRequestException("billable_items are required");
      const customerId = String(billables[0].customer_organization_id);
      if (billables.some((row) => row.customer_organization_id !== customerId)) throw new BadRequestException("cross-customer invoice grouping denied");
      const invoiceNumber = this.optionalString(body.invoice_number) ?? await this.nextNumber(client, request.auth.tenantId, "invoices", "invoice_number", "INV-P12");
      const subtotal = this.roundMoney(billables.reduce((sum, row) => sum + Number(row.net_billable_amount ?? row.estimated_billable_amount ?? 0), 0));
      const retainagePercent = body.retainage_percent === undefined ? 0 : this.nonNegative(body.retainage_percent, "retainage_percent");
      const retainage = this.roundMoney(subtotal * retainagePercent / 100);
      const total = this.roundMoney(subtotal - retainage);
      const invoice = await client.query(
        `
        INSERT INTO invoices (
          tenant_id, organization_id, customer_organization_id, project_id, invoice_number, invoice_type, invoice_date, due_date,
          payment_terms, billing_period_start, billing_period_end, subtotal_amount, retainage_amount, invoice_amount, total_amount,
          original_amount, paid_amount, balance_amount, currency, status, approval_status, delivery_status, cash_application_status,
          customer_acceptance_status, p12_source_fingerprint, p12_retained_balance_amount, created_by, updated_by
        )
        VALUES ($1,$2,$2,$3,$4,'standard',$5,$6,'net_30',$7,$8,$9,$10,$11,$11,$11,0,$11,'USD','approved','approved','not_sent','ready_for_cash_application','accepted',$12,$10,$13,$13)
        RETURNING *
        `,
        [request.auth.tenantId, customerId, billables[0].project_id, invoiceNumber, this.today(), this.addDays(this.today(), 30), body.period_start ?? this.today(), body.period_end ?? this.today(), subtotal, retainage, total, this.sourceFingerprint(billables.map((row) => row.id).sort()), request.auth.userId],
      );
      for (const billable of billables) {
        const item = await client.query(
          `
          INSERT INTO invoice_items (
            tenant_id, invoice_id, billable_item_id, accepted_production_source_id, production_record_id, work_order_id, project_id,
            customer_organization_id, item_type, status, description, quantity, unit, unit_rate, gross_amount, retainage_amount, net_amount, created_by, updated_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'customer_billable','invoiced',$9,$10,$11,$12,$13,0,$13,$14,$14)
          RETURNING *
          `,
          [request.auth.tenantId, invoice.rows[0].id, billable.id, billable.accepted_production_source_id, billable.production_record_id, billable.work_order_id, billable.project_id, billable.customer_organization_id, billable.rate_description, billable.billable_quantity, billable.unit, billable.unit_rate, billable.net_billable_amount, request.auth.userId],
        );
        await client.query("UPDATE billable_items SET status = 'settlement_created', invoice_item_id = $1, updated_by = $2, updated_at = now() WHERE tenant_id = $3 AND id = $4", [item.rows[0].id, request.auth.userId, request.auth.tenantId, billable.id]);
        await client.query("UPDATE accepted_production_financial_sources SET invoice_item_id = $1, financial_status = 'invoiced', updated_at = now() WHERE tenant_id = $2 AND id = $3", [item.rows[0].id, request.auth.tenantId, billable.accepted_production_source_id]);
      }
      return { entityType: "invoice", entityId: invoice.rows[0].id, afterState: invoice.rows[0] };
    });
  }

  @Post("cash-receipts")
  @RequirePermission("cash_receipt.record")
  async createCashReceipt(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "cash_receipt.recorded", "cash_receipt.recorded", "cash_receipt", async (client) => {
      const idempotencyKey = this.optionalString(body.idempotency_key);
      if (idempotencyKey) {
        const existing = await client.query("SELECT * FROM cash_receipts WHERE tenant_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL", [request.auth.tenantId, idempotencyKey]);
        if (existing.rows[0]) return { entityType: "cash_receipt", entityId: existing.rows[0].id, afterState: existing.rows[0] };
      }
      const amount = this.positive(body.amount, "amount");
      const receipt = await client.query(
        `
        INSERT INTO cash_receipts (
          tenant_id, receipt_number, customer_organization_id, payer_name, payment_date, payment_method, payment_reference,
          gross_received_amount, applied_amount, unapplied_amount, currency, receipt_status, clearance_status, source_type,
          idempotency_key, created_by, updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,'USD','received','not_cleared','manual',$9,$10,$10)
        RETURNING *
        `,
        [request.auth.tenantId, this.optionalString(body.receipt_number) ?? await this.nextNumber(client, request.auth.tenantId, "cash_receipts", "receipt_number", "CR-P12"), requireString(body.customer_organization_id, "customer_organization_id is required"), this.optionalString(body.payer_name), this.optionalString(body.payment_date) ?? this.today(), this.optionalString(body.payment_method) ?? "ach", this.optionalString(body.payment_reference), amount, idempotencyKey, request.auth.userId],
      );
      return { entityType: "cash_receipt", entityId: receipt.rows[0].id, afterState: receipt.rows[0] };
    });
  }

  @Post("cash-receipts/:id/clear")
  @RequirePermission("cash_receipt.record")
  async clearReceipt(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "cash_receipt.cleared", "cash_receipt.cleared", "cash_receipt", async (client) => {
      const before = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, id, "cash receipt not found");
      const after = await client.query("UPDATE cash_receipts SET clearance_status = 'cleared', deposit_status = 'deposited_later', cleared_at = now(), cleared_by = $1, updated_by = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3 RETURNING *", [request.auth.userId, request.auth.tenantId, id]);
      return { entityType: "cash_receipt", entityId: id, beforeState: before, afterState: after.rows[0] };
    });
  }

  @Post("payment-applications")
  @RequirePermission("payment_application.create")
  async applyCash(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "payment_application.created", "payment_application.created", "payment_application", async (client) => {
      const receipt = await this.requireRecord(client, "cash_receipts", request.auth.tenantId, requireString(body.cash_receipt_id, "cash_receipt_id is required"), "cash receipt not found");
      if (receipt.clearance_status !== "cleared") throw new BadRequestException("only cleared cash can be applied");
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, requireString(body.invoice_id, "invoice_id is required"), "invoice not found");
      if (invoice.customer_organization_id !== receipt.customer_organization_id) throw new BadRequestException("cash customer must match invoice customer");
      const amount = this.positive(body.amount, "amount");
      const available = Number(receipt.unapplied_amount ?? 0);
      const balance = Number(invoice.balance_amount ?? 0);
      if (amount > available) throw new BadRequestException("applied amount exceeds available cleared cash");
      if (amount > balance) throw new BadRequestException("applied amount exceeds invoice balance");
      const application = await client.query(
        "INSERT INTO payment_applications (tenant_id,cash_receipt_id,invoice_id,customer_organization_id,applied_amount,application_date,application_status,application_type,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,'applied','partial_payment',$7,$7) RETURNING *",
        [request.auth.tenantId, receipt.id, invoice.id, invoice.customer_organization_id, amount, this.today(), request.auth.userId],
      );
      await this.allocatePaymentApplication(client, request.auth.tenantId, request.auth.userId, application.rows[0], invoice, amount);
      const paid = this.roundMoney(Number(invoice.paid_amount ?? 0) + amount);
      const newBalance = this.roundMoney(Number(invoice.original_amount ?? invoice.total_amount ?? 0) - paid);
      await client.query("UPDATE invoices SET paid_amount = $1, balance_amount = $2, payment_status = $3, cash_application_status = $4, last_payment_at = now(), last_payment_amount = $5, updated_by = $6, updated_at = now() WHERE tenant_id = $7 AND id = $8", [paid, newBalance, newBalance === 0 ? "paid" : "partially_paid", newBalance === 0 ? "fully_applied_later" : "partially_applied_later", amount, request.auth.userId, request.auth.tenantId, invoice.id]);
      await client.query("UPDATE cash_receipts SET applied_amount = applied_amount + $1, unapplied_amount = unapplied_amount - $1, receipt_status = CASE WHEN unapplied_amount - $1 = 0 THEN 'fully_applied' ELSE 'partially_applied' END, updated_by = $2, updated_at = now() WHERE tenant_id = $3 AND id = $4", [amount, request.auth.userId, request.auth.tenantId, receipt.id]);
      return { entityType: "payment_application", entityId: application.rows[0].id, afterState: application.rows[0] };
    });
  }

  @Post("partner-settlements/create")
  @RequirePermission("partner_settlement.create")
  async createPartnerSettlement(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "partner_settlement.created", "partner_settlement.created", "settlement", async (client) => {
      if (!Array.isArray(body.accepted_production_source_ids) || !body.accepted_production_source_ids.length) {
        await this.ensurePartnerCoilSupplementSourcesForEligibleAcceptedProduction(client, request);
      }
      const sources = await this.sourcesForSettlement(client, request.auth.tenantId, body);
      if (!sources.length) throw new BadRequestException("accepted production sources are required");
      if (sources.some((row) => !row.partner_rate_code_id || Number(row.partner_rate ?? 0) <= 0)) {
        const exception = await this.createException(client, request, "missing_partner_rate", sources[0], "SETTLEMENT EXCEPTION - MISSING PARTNER RATE");
        return { entityType: "financial_exception", entityId: exception.id, eventType: "financial_exception.created", afterState: exception };
      }
      const partnerId = String(sources[0].partner_organization_id);
      if (sources.some((row) => row.partner_organization_id !== partnerId)) throw new BadRequestException("cross-Partner settlement denied");
      const providerId = sources[0].capacity_provider_id;
      const gross = this.roundMoney(sources.reduce((sum, row) => sum + Number(row.partner_extended_amount ?? 0), 0));
      const periodStart = this.optionalString(body.period_start) ?? this.weekStart(this.today());
      const periodEnd = this.optionalString(body.period_end) ?? this.addDays(periodStart, 6);
      const settlement = await client.query(
        `
        INSERT INTO settlements (
          tenant_id, settlement_number, settlement_type, status, readiness_status, readiness_score, readiness_band,
          customer_organization_id, capacity_provider_id, project_id, work_order_id,
          settlement_period_start, settlement_period_end, billing_period_start, billing_period_end,
          gross_amount, gross_billable_amount, contractor_payable_amount, net_amount, net_settlement_amount,
          total_amount, invoice_ready, payable_ready, issued_at, dispute_deadline, created_by, updated_by
        )
        VALUES ($1,$2,'contractor_payable','payable_ready','ready_for_approval',100,'ready_for_approval',
          $3,$4,$5,$6,$7,$8,$7,$8,$9,0,$9,$9,$9,$9,false,true,now(),$10,$11,$11)
        RETURNING *
        `,
        [request.auth.tenantId, await this.nextNumber(client, request.auth.tenantId, "settlements", "settlement_number", "PSET-P12"), sources[0].customer_organization_id, providerId, sources[0].project_id, sources[0].work_order_id, periodStart, periodEnd, gross, this.addDays(this.today(), 10), request.auth.userId],
      );
      for (const source of sources) {
        const item = await client.query(
          `
          INSERT INTO settlement_items (
            tenant_id, settlement_id, accepted_production_source_id, billable_item_id, project_id, work_order_id, production_record_id,
            customer_organization_id, capacity_provider_id, crew_id, partner_organization_id, rate_code_id, item_type, status,
            quantity, unit, unit_rate, gross_amount, amount, net_amount, contractor_rate, contractor_payable_amount,
            partner_rate_schedule_id, partner_rate_schedule_version, partner_rate_effective_date, customer_acceptance_status, billing_package_status, documentation_status,
            created_by, updated_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'contractor_payable','payable_ready',$13,$14,$15,$16,$16,$16,$15,$16,$17,$18,$19,'accepted','ready','ready',$20,$20)
          RETURNING *
          `,
          [request.auth.tenantId, settlement.rows[0].id, source.id, source.billable_item_id, source.project_id, source.work_order_id, source.production_record_id, source.customer_organization_id, source.capacity_provider_id, source.crew_id, source.partner_organization_id, source.partner_rate_code_id, source.accepted_quantity, source.unit_of_measure, source.partner_rate, source.partner_extended_amount, source.partner_rate_schedule_id, "effective:" + String(source.partner_rate_effective_date ?? ""), source.partner_rate_effective_date, request.auth.userId],
        );
        await client.query("UPDATE accepted_production_financial_sources SET settlement_item_id = $1, financial_status = 'settled', updated_at = now() WHERE tenant_id = $2 AND id = $3", [item.rows[0].id, request.auth.tenantId, source.id]);
      }
      return { entityType: "settlement", entityId: settlement.rows[0].id, afterState: this.safePartnerSettlement(settlement.rows[0]) };
    });
  }

  @Get("coil-policies")
  @RequirePermission("billing.read")
  async coilPolicies(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const values: unknown[] = [request.auth.tenantId];
      const where = ["tenant_id = $1", "deleted_at IS NULL"];
      for (const [key, column] of [["work_order_id", "work_order_id"], ["party_type", "party_type"], ["status", "status"]] as const) {
        if (query[key]) {
          values.push(String(query[key]).toLowerCase());
          where.push(`${column} = $${values.length}`);
        }
      }
      const result = await client.query(`SELECT * FROM syncfield_coil_commercial_policies WHERE ${where.join(" AND ")} ORDER BY work_order_id, party_type, effective_from DESC, version DESC LIMIT 250`, values);
      return result.rows.map((row) => this.safeCoilPolicy(row));
    });
  }

  @Get("coil-commercial-summary")
  @RequirePermission("billing.read")
  async coilCommercialSummary(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const workOrderId = this.optionalString(query.work_order_id);
      const values: unknown[] = [request.auth.tenantId];
      const where = ["co.tenant_id = $1", "co.deleted_at IS NULL", "co.status <> 'void'"];
      if (workOrderId) {
        values.push(workOrderId);
        where.push(`co.work_order_id = $${values.length}`);
      }
      const result = await client.query(
        `
        SELECT co.id, co.work_order_id, co.production_record_id, co.asset_identifier, co.coil_type, co.easement_type,
          co.actual_length_ft, co.required_length_ft,
          cs.commercial_treatment AS customer_treatment, cs.policy_version AS customer_policy_version, cs.customer_extended_amount AS customer_amount,
          ps.commercial_treatment AS partner_treatment, ps.policy_version AS partner_policy_version, ps.partner_extended_amount AS partner_amount
        FROM syncfield_coil_observations co
        LEFT JOIN accepted_production_financial_sources cs ON cs.tenant_id = co.tenant_id
          AND cs.coil_observation_id = co.id
          AND cs.source_kind = 'customer_coil_supplement'
          AND cs.deleted_at IS NULL
          AND cs.financial_status <> 'void'
        LEFT JOIN accepted_production_financial_sources ps ON ps.tenant_id = co.tenant_id
          AND ps.coil_observation_id = co.id
          AND ps.source_kind = 'partner_coil_supplement'
          AND ps.deleted_at IS NULL
          AND ps.financial_status <> 'void'
        WHERE ${where.join(" AND ")}
        ORDER BY co.production_date DESC, co.asset_identifier
        LIMIT 250
        `,
        values,
      );
      return result.rows.map((row) => ({
        ...row,
        customer_treatment: row.customer_treatment ?? "unconfirmed",
        partner_treatment: row.partner_treatment ?? "unconfirmed",
      }));
    });
  }

  @Post("coil-policies")
  @RequirePermission("billing.create_billable")
  async createCoilPolicy(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "coil_commercial_policy.created", "coil_commercial_policy.created", "syncfield_coil_commercial_policy", async (client) => {
      const policy = await this.insertCoilPolicy(client, request, body);
      return { entityType: "syncfield_coil_commercial_policy", entityId: policy.id, afterState: this.safeCoilPolicy(policy) };
    });
  }

  @Post("contractor-payables/create")
  @RequirePermission("contractor_payable.create")
  async createContractorPayable(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "contractor_payable.created", "contractor_payable.created", "contractor_payable", async (client) => {
      const settlement = await this.requireRecord(client, "settlements", request.auth.tenantId, requireString(body.settlement_id, "settlement_id is required"), "settlement not found");
      if (settlement.settlement_type !== "contractor_payable") throw new BadRequestException("settlement must be a Partner settlement");
      const existing = await client.query("SELECT * FROM contractor_payables WHERE tenant_id = $1 AND settlement_id = $2 AND deleted_at IS NULL AND status <> ALL($3::text[]) LIMIT 1", [request.auth.tenantId, settlement.id, ["voided", "archived"]]);
      if (existing.rows[0]) return { entityType: "contractor_payable", entityId: existing.rows[0].id, afterState: this.safePayable(existing.rows[0]) };
      const partnerRows = await client.query(
        "SELECT DISTINCT partner_organization_id FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND deleted_at IS NULL AND status <> ALL($3::text[])",
        [request.auth.tenantId, settlement.id, ["voided", "archived"]],
      );
      if (partnerRows.rowCount !== 1 || !partnerRows.rows[0].partner_organization_id) throw new BadRequestException("settlement must resolve one Partner organization");
      const partnerId = partnerRows.rows[0].partner_organization_id;
      const payable = await client.query(
        `
        INSERT INTO contractor_payables (
          tenant_id, payable_number, payable_type, payable_party_type, status, approval_status, payment_readiness_status, payment_status,
          capacity_provider_id, partner_organization_id, project_id, settlement_id, pay_cycle_start, pay_cycle_end,
          gross_payable_amount, retainage_amount, deduction_amount, chargeback_amount, net_payable_amount,
          eligible_amount, ineligible_amount, pay_when_paid_status, compliance_status, tax_document_status, created_by, updated_by
        )
        VALUES ($1,$2,'subcontractor','capacity_provider','approved','approved','not_ready','not_paid',
          $3,$4,$5,$6,$7,$8,$9,0,0,0,$9,0,$9,'awaiting_customer_funds','ready','ready',$10,$10)
        RETURNING *
        `,
        [request.auth.tenantId, await this.nextNumber(client, request.auth.tenantId, "contractor_payables", "payable_number", "CP-P12"), settlement.capacity_provider_id, partnerId, settlement.project_id, settlement.id, settlement.settlement_period_start, settlement.settlement_period_end, settlement.net_settlement_amount, request.auth.userId],
      );
      const items = await client.query("SELECT * FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND deleted_at IS NULL AND status <> ALL($3::text[])", [request.auth.tenantId, settlement.id, ["voided", "archived"]]);
      for (const item of items.rows) {
        const payableItem = await client.query(
          `
          INSERT INTO contractor_payable_items (
            tenant_id, contractor_payable_id, settlement_id, settlement_item_id, accepted_production_source_id, billable_item_id,
            production_record_id, work_order_id, project_id, capacity_provider_id, crew_id, item_type, status, description,
            quantity, unit, contractor_rate, gross_payable_amount, retainage_amount, net_payable_amount, compliance_status, tax_document_status,
            created_by, updated_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'subcontractor_production','ready',$12,$13,$14,$15,$16,0,$16,'ready','ready',$17,$17)
          RETURNING *
          `,
          [request.auth.tenantId, payable.rows[0].id, settlement.id, item.id, item.accepted_production_source_id, item.billable_item_id, item.production_record_id, item.work_order_id, item.project_id, item.capacity_provider_id, item.crew_id, item.description, item.quantity, item.unit, item.contractor_rate, item.net_amount, request.auth.userId],
        );
        await client.query("UPDATE accepted_production_financial_sources SET contractor_payable_item_id = $1, financial_status = 'payable_created', updated_at = now() WHERE tenant_id = $2 AND id = $3", [payableItem.rows[0].id, request.auth.tenantId, item.accepted_production_source_id]);
      }
      return { entityType: "contractor_payable", entityId: payable.rows[0].id, afterState: this.safePayable(payable.rows[0]) };
    });
  }

  @Post("contractor-payables/:id/calculate-eligibility")
  @RequirePermission("contractor_payable.calculate_eligibility")
  async calculateEligibility(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "contractor_payable.eligibility_changed", "contractor_payable.eligibility_changed", "contractor_payable", async (client) => {
      const payable = await this.requireRecord(client, "contractor_payables", request.auth.tenantId, id, "contractor payable not found");
      const itemRows = await client.query(
        `
        SELECT cpi.*, COALESCE(sum(paa.allocated_customer_amount),0)::numeric AS funded_customer_amount
        FROM contractor_payable_items cpi
        LEFT JOIN payment_application_allocations paa ON paa.tenant_id = cpi.tenant_id
          AND paa.accepted_production_source_id = cpi.accepted_production_source_id
          AND paa.deleted_at IS NULL
        WHERE cpi.tenant_id = $1 AND cpi.contractor_payable_id = $2 AND cpi.deleted_at IS NULL AND cpi.status <> ALL($3::text[])
        GROUP BY cpi.id
        `,
        [request.auth.tenantId, id, ["voided", "archived"]],
      );
      let eligible = 0;
      let allocatedCustomer = 0;
      for (const item of itemRows.rows) {
        const funded = Number(item.funded_customer_amount ?? 0);
        const source = await this.requireRecord(client, "accepted_production_financial_sources", request.auth.tenantId, String(item.accepted_production_source_id), "accepted production source not found");
        const customerAmount = Number(source.customer_extended_amount ?? 0);
        const partnerNet = Number(item.net_payable_amount ?? 0);
        const ratio = customerAmount > 0 ? Math.min(1, funded / customerAmount) : 0;
        const itemEligible = this.roundMoney(partnerNet * ratio);
        eligible += itemEligible;
        allocatedCustomer += funded;
        await client.query("UPDATE contractor_payable_items SET funded_customer_amount = $1, eligible_partner_amount = $2, updated_by = $3, updated_at = now() WHERE tenant_id = $4 AND id = $5", [funded, itemEligible, request.auth.userId, request.auth.tenantId, item.id]);
      }
      eligible = this.roundMoney(Math.min(eligible, Number(payable.net_payable_amount ?? 0)));
      const status = eligible <= 0 ? "awaiting_customer_funds" : eligible < Number(payable.net_payable_amount ?? 0) ? "partially_eligible" : "eligible";
      const version = Number((await client.query("SELECT COALESCE(max(calculation_version),0)::int + 1 AS version FROM contractor_payable_eligibility_snapshots WHERE tenant_id = $1 AND contractor_payable_id = $2", [request.auth.tenantId, id])).rows[0].version);
      const eligibleAt = eligible > 0 ? new Date() : null;
      const due = eligibleAt ? this.addBusinessDays(this.today(), 3) : null;
      await client.query(
        "INSERT INTO contractor_payable_eligibility_snapshots (tenant_id,contractor_payable_id,calculation_version,cleared_customer_funds,allocated_customer_funds,eligible_partner_amount,status,eligible_at,payment_due_at,source_payment_application_ids,created_by_user_id) SELECT $1,$2,$3,COALESCE(sum(cr.gross_received_amount),0),$4,$5,$6,$7,$8,COALESCE(array_agg(DISTINCT pa.id) FILTER (WHERE pa.id IS NOT NULL),'{}'::uuid[]),$9 FROM payment_applications pa LEFT JOIN cash_receipts cr ON cr.tenant_id = pa.tenant_id AND cr.id = pa.cash_receipt_id WHERE pa.tenant_id = $1 AND pa.deleted_at IS NULL",
        [request.auth.tenantId, id, version, this.roundMoney(allocatedCustomer), eligible, status, eligibleAt, due, request.auth.userId],
      );
      const after = await client.query("UPDATE contractor_payables SET eligible_amount = $1, ineligible_amount = GREATEST(net_payable_amount - $1, 0), pay_when_paid_status = $2, payment_readiness_status = $3, status = CASE WHEN $2 = 'eligible' THEN 'payment_ready' ELSE status END, eligible_at = COALESCE(eligible_at,$4), payment_due_at = $5, updated_by = $6, updated_at = now() WHERE tenant_id = $7 AND id = $8 RETURNING *", [eligible, status, status === "eligible" ? "ready_for_payment" : "ready_with_warning", eligibleAt, due, request.auth.userId, request.auth.tenantId, id]);
      return { entityType: "contractor_payable", entityId: id, beforeState: payable, afterState: this.safePayable(after.rows[0]) };
    });
  }

  @Get("exceptions")
  @RequirePermission("financial_exception.read")
  async exceptions(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => (await client.query("SELECT * FROM financial_exceptions WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100", [request.auth.tenantId])).rows);
  }

  @Post("detect-qc-change")
  @RequirePermission("financial_exception.read")
  async detectQcChange(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "financial_exception.created", "financial_exception.created", "financial_exception", async (client) => {
      const source = await this.requireRecord(client, "accepted_production_financial_sources", request.auth.tenantId, requireString(body.accepted_production_source_id, "accepted_production_source_id is required"), "accepted production source not found");
      const current = await this.requireCurrentDecisionForRecord(client, request.auth.tenantId, String(source.production_record_id));
      if (String(current.id) === String(source.customer_qc_decision_id)) {
        return { entityType: "financial_exception", entityId: String(source.id), skipEventAudit: true, afterState: { status: "unchanged" } };
      }
      const exception = await this.createException(client, request, "post_billing_customer_qc_change", { ...source, customer_qc_decision_id: current.id }, "ACCEPTED PRODUCTION CHANGED AFTER BILLING");
      return { entityType: "financial_exception", entityId: exception.id, afterState: exception };
    });
  }

  @Get("partner/settlements")
  @RequirePermission("partner_settlement.read")
  async partnerSettlements(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const partner = await this.partnerContext(client, request.auth.tenantId, request.auth.userId);
      const result = await client.query(
        `
        SELECT s.id, s.settlement_number, s.settlement_period_start, s.settlement_period_end, s.issued_at, s.dispute_deadline,
          s.net_settlement_amount, cp.id AS contractor_payable_id, cp.pay_when_paid_status, cp.eligible_amount, cp.payment_due_at,
          json_agg(json_build_object(
            'production_code', src.production_code,
            'accepted_quantity', src.accepted_quantity,
            'unit', src.unit_of_measure,
            'partner_rate', src.partner_rate,
            'gross_partner_amount', src.partner_extended_amount
          ) ORDER BY src.production_code) FILTER (WHERE src.id IS NOT NULL) AS items
        FROM settlements s
        LEFT JOIN contractor_payables cp ON cp.tenant_id = s.tenant_id AND cp.settlement_id = s.id AND cp.deleted_at IS NULL
        LEFT JOIN settlement_items si ON si.tenant_id = s.tenant_id AND si.settlement_id = s.id AND si.deleted_at IS NULL
        LEFT JOIN accepted_production_financial_sources src ON src.tenant_id = si.tenant_id AND src.id = si.accepted_production_source_id
        WHERE s.tenant_id = $1 AND si.partner_organization_id = $2 AND s.deleted_at IS NULL AND s.settlement_type = 'contractor_payable'
        GROUP BY s.id, cp.id
        ORDER BY s.settlement_period_start DESC
        `,
        [request.auth.tenantId, partner.organization_id],
      );
      return result.rows.map((row) => ({
        ...row,
        customer_rate: undefined,
        margin: undefined,
      }));
    });
  }

  private async acceptedProductionRows(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const values: unknown[] = [tenantId];
    const where = ["cqd.tenant_id = $1", "cqd.current = true", "cqd.deleted_at IS NULL", "cqd.decision IN ('accepted','partially_accepted')", "COALESCE(cqd.customer_accepted_quantity,0) > 0"];
    if (query.work_order_id) {
      values.push(query.work_order_id);
      where.push(`pr.work_order_id = $${values.length}`);
    }
    if (query.partner_organization_id) {
      values.push(query.partner_organization_id);
      where.push(`pr.partner_organization_id = $${values.length}`);
    }
    const result = await client.query(
      `
      SELECT
        cqd.id AS customer_qc_decision_id,
        cqd.qc_cycle_id AS customer_qc_cycle_id,
        cqd.production_record_id,
        cqd.customer_accepted_quantity AS accepted_quantity,
        cqd.unit_of_measure,
        cqd.decision,
        cqd.reported_quantity,
        cqc.qc_authority_organization_id,
        auth.name AS qc_authority_name,
        pr.project_id,
        pr.work_order_id,
        pr.partner_organization_id,
        pr.capacity_provider_id,
        pr.crew_id,
        COALESCE(spc.code, rc.code, pr.production_type) AS production_code,
        COALESCE(spc.description, rc.description, pr.production_type) AS production_description,
        spc.id AS production_code_id,
        p.customer_organization_id,
        wo.customer_rate_schedule_id,
        wo.partner_rate_schedule_id,
        src.id AS accepted_production_source_id,
        src.billable_item_id,
        src.settlement_item_id,
        src.invoice_item_id,
        src.contractor_payable_item_id
      FROM customer_qc_decisions cqd
      JOIN customer_qc_cycles cqc ON cqc.tenant_id = cqd.tenant_id AND cqc.id = cqd.qc_cycle_id AND cqc.deleted_at IS NULL
      JOIN production_records pr ON pr.tenant_id = cqd.tenant_id AND pr.id = cqd.production_record_id
      JOIN work_orders wo ON wo.tenant_id = pr.tenant_id AND wo.id = pr.work_order_id
      JOIN projects p ON p.tenant_id = pr.tenant_id AND p.id = pr.project_id
      LEFT JOIN organizations auth ON auth.tenant_id = cqc.tenant_id AND auth.id = cqc.qc_authority_organization_id
      LEFT JOIN syncfield_production_codes spc ON spc.tenant_id = pr.tenant_id AND spc.id = pr.syncfield_production_code_id
      LEFT JOIN rate_codes rc ON rc.tenant_id = pr.tenant_id AND rc.id = pr.rate_code_id
      LEFT JOIN accepted_production_financial_sources src ON src.tenant_id = cqd.tenant_id AND src.customer_qc_decision_id = cqd.id AND src.deleted_at IS NULL AND src.financial_status <> 'void'
      WHERE ${where.join(" AND ")}
        AND cqc.cycle_number = (
          SELECT max(cqc2.cycle_number)
          FROM customer_qc_cycles cqc2
          WHERE cqc2.tenant_id = cqc.tenant_id AND cqc2.daily_report_id = cqc.daily_report_id AND cqc2.deleted_at IS NULL
        )
      ORDER BY pr.created_at DESC
      LIMIT 250
      `,
      values,
    );
    return result.rows;
  }

  private async requireAcceptedProduction(client: PoolClient, tenantId: string, decisionId?: string | null) {
    const rows = await this.acceptedProductionRows(client, tenantId, {});
    const accepted = decisionId ? rows.find((row) => row.customer_qc_decision_id === decisionId) : rows.find((row) => !row.billable_item_id);
    if (!accepted) throw new NotFoundException("accepted production not found");
    return accepted;
  }

  private async ensureFinancialSource(client: PoolClient, tenantId: string, userId: string, accepted: Row) {
    const existing = await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id = $1 AND customer_qc_decision_id = $2 AND source_kind = 'accepted_production' AND deleted_at IS NULL AND financial_status <> 'void'", [tenantId, accepted.customer_qc_decision_id]);
    if (existing.rows[0]) return existing.rows[0];
    const customerRate = await this.resolveRate(client, tenantId, accepted.customer_rate_schedule_id, accepted.production_code, accepted.unit_of_measure, "customer");
    const partnerRate = await this.resolveRate(client, tenantId, accepted.partner_rate_schedule_id, accepted.production_code, accepted.unit_of_measure, "partner");
    const acceptedQuantity = Number(accepted.accepted_quantity);
    const fingerprint = this.sourceFingerprint([accepted.customer_qc_decision_id, accepted.production_record_id, acceptedQuantity, accepted.unit_of_measure]);
    const inserted = await client.query(
      `
      INSERT INTO accepted_production_financial_sources (
        tenant_id, project_id, work_order_id, partner_organization_id, capacity_provider_id, crew_id, production_record_id,
        customer_qc_cycle_id, customer_qc_decision_id, production_code_id, production_code, production_description,
        source_kind, accepted_quantity, unit_of_measure, customer_rate_code_id, customer_rate_schedule_id, customer_rate, customer_extended_amount,
        partner_rate_code_id, partner_rate_schedule_id, partner_rate, partner_extended_amount, source_fingerprint, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'accepted_production',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *
      `,
      [
        tenantId,
        accepted.project_id,
        accepted.work_order_id,
        accepted.partner_organization_id,
        accepted.capacity_provider_id,
        accepted.crew_id,
        accepted.production_record_id,
        accepted.customer_qc_cycle_id,
        accepted.customer_qc_decision_id,
        accepted.production_code_id,
        accepted.production_code,
        accepted.production_description,
        acceptedQuantity,
        accepted.unit_of_measure,
        customerRate?.id ?? null,
        customerRate?.rate_schedule_id ?? null,
        customerRate?.rate ?? null,
        customerRate ? this.roundMoney(acceptedQuantity * Number(customerRate.rate)) : null,
        partnerRate?.id ?? null,
        partnerRate?.rate_schedule_id ?? null,
        partnerRate?.rate ?? null,
        partnerRate ? this.roundMoney(acceptedQuantity * Number(partnerRate.rate)) : null,
        fingerprint,
        userId,
      ],
    );
    return inserted.rows[0];
  }

  private async resolveRate(client: PoolClient, tenantId: string, scheduleId: unknown, code: unknown, unit: unknown, mode: "customer" | "partner") {
    if (!scheduleId) return null;
    const column = mode === "customer" ? "COALESCE(customer_rate, amount)" : "contractor_rate";
    const result = await client.query(
      `SELECT id, rate_schedule_id, ${column} AS rate, unit, updated_at FROM rate_codes WHERE tenant_id = $1 AND rate_schedule_id = $2 AND code = $3 AND upper(unit) = upper($4::text) AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
      [tenantId, scheduleId, code, unit],
    );
    return result.rows[0] ?? null;
  }

  private async billablesForBody(client: PoolClient, tenantId: string, body: Row) {
    if (Array.isArray(body.billable_item_ids) && body.billable_item_ids.length) {
      const result = await client.query("SELECT * FROM billable_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND status <> ALL($3::text[])", [tenantId, body.billable_item_ids, billableStatuses]);
      return result.rows;
    }
    const result = await client.query("SELECT * FROM billable_items WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'ready_for_settlement' ORDER BY created_at LIMIT 100", [tenantId]);
    return result.rows;
  }

  private async sourcesForSettlement(client: PoolClient, tenantId: string, body: Row) {
    if (Array.isArray(body.accepted_production_source_ids) && body.accepted_production_source_ids.length) {
      const result = await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND financial_status <> 'void'", [tenantId, body.accepted_production_source_ids]);
      return result.rows;
    }
    const result = await client.query(
      `
      SELECT *
      FROM accepted_production_financial_sources
      WHERE tenant_id = $1
        AND settlement_item_id IS NULL
        AND deleted_at IS NULL
        AND financial_status <> 'void'
        AND (
          (source_kind = 'accepted_production' AND billable_item_id IS NOT NULL)
          OR source_kind = 'partner_coil_supplement'
        )
      ORDER BY created_at
      LIMIT 100
      `,
      [tenantId],
    );
    return result.rows;
  }

  private async insertCoilPolicy(client: PoolClient, request: AuthenticatedRequest, body: Row) {
    const workOrderId = requireString(body.work_order_id, "work_order_id is required");
    const partyType = this.normalizedValue(body.party_type, "party_type", coilPartyTypes);
    const treatment = this.normalizedValue(body.treatment ?? "unconfirmed", "treatment", coilTreatments);
    const sourceType = this.normalizedValue(body.source_type ?? "other", "source_type", coilSourceTypes);
    const workOrder = await this.workOrderCommercialContext(client, request.auth.tenantId, workOrderId);
    const counterpartyId = this.optionalString(body.counterparty_organization_id) ?? (partyType === "customer" ? String(workOrder.customer_organization_id) : String(workOrder.partner_organization_id ?? workOrder.assigned_organization_id));
    if (partyType === "customer" && counterpartyId !== String(workOrder.customer_organization_id)) throw new BadRequestException("customer coil policy counterparty must match Work Order customer");
    if (partyType === "partner" && counterpartyId !== String(workOrder.partner_organization_id ?? workOrder.assigned_organization_id)) throw new BadRequestException("partner coil policy counterparty must match Work Order Partner");
    const productionCodeId = this.optionalString(body.production_code_id);
    const separateProductionCodeId = this.optionalString(body.separate_production_code_id);
    if (treatment === "separate_pay_item" && !separateProductionCodeId) throw new BadRequestException("separate_production_code_id is required for separate pay item treatment");
    const coilType = this.optionalEnum(body.coil_type, "coil_type", coilTypes);
    const easementType = this.optionalEnum(body.easement_type, "easement_type", easementTypes);
    const effectiveFrom = this.optionalString(body.effective_from) ?? this.today();
    const effectiveTo = this.optionalString(body.effective_to);
    if (treatment !== "unconfirmed" && !this.optionalString(body.source_reference) && !this.optionalString(body.notes) && !this.optionalString(body.source_file_object_id)) throw new BadRequestException("source evidence is required for confirmed coil commercial policy");
    const supersedes = this.optionalString(body.supersedes_policy_id);
    if (supersedes) {
      const prior = await this.requireRecord(client, "syncfield_coil_commercial_policies", request.auth.tenantId, supersedes, "coil policy to supersede not found");
      if (prior.work_order_id !== workOrderId || prior.party_type !== partyType) throw new BadRequestException("superseded policy scope must match");
    }
    const overlap = await client.query(
      `
      SELECT id
      FROM syncfield_coil_commercial_policies
      WHERE tenant_id = $1
        AND work_order_id = $2
        AND party_type = $3
        AND counterparty_organization_id = $4
        AND production_code_id IS NOT DISTINCT FROM $5::uuid
        AND coil_type IS NOT DISTINCT FROM $6::text
        AND easement_type IS NOT DISTINCT FROM $7::text
        AND status = 'active'
        AND deleted_at IS NULL
        AND ($8::date <= COALESCE(effective_to, '9999-12-31'::date))
        AND (COALESCE($9::date, '9999-12-31'::date) >= effective_from)
        AND ($10::uuid IS NULL OR id <> $10::uuid)
      LIMIT 1
      `,
      [request.auth.tenantId, workOrderId, partyType, counterpartyId, productionCodeId, coilType, easementType, effectiveFrom, effectiveTo, supersedes],
    );
    if (overlap.rows[0]) throw new BadRequestException("overlapping active coil commercial policy denied");
    const version = Number(body.version ?? (supersedes ? Number((await this.requireRecord(client, "syncfield_coil_commercial_policies", request.auth.tenantId, supersedes, "coil policy to supersede not found")).version ?? 1) + 1 : 1));
    const inserted = await client.query(
      `
      INSERT INTO syncfield_coil_commercial_policies (
        tenant_id, project_id, work_order_id, party_type, counterparty_organization_id, production_code_id, coil_type, easement_type,
        treatment, separate_production_code_id, effective_from, effective_to, version, source_type, source_file_object_id,
        source_reference, notes, created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *
      `,
      [
        request.auth.tenantId,
        workOrder.project_id,
        workOrderId,
        partyType,
        counterpartyId,
        productionCodeId,
        coilType,
        easementType,
        treatment,
        separateProductionCodeId,
        effectiveFrom,
        effectiveTo,
        version,
        sourceType,
        this.optionalString(body.source_file_object_id),
        this.optionalString(body.source_reference),
        this.optionalString(body.notes),
        request.auth.userId,
      ],
    );
    if (supersedes) {
      await client.query("UPDATE syncfield_coil_commercial_policies SET status = 'superseded', effective_to = LEAST(COALESCE(effective_to, $1::date), $1::date), superseded_by_policy_id = $2 WHERE tenant_id = $3 AND id = $4", [this.addDays(effectiveFrom, -1), inserted.rows[0].id, request.auth.tenantId, supersedes]);
    }
    return inserted.rows[0];
  }

  private async ensureCustomerCoilSupplementSources(client: PoolClient, request: AuthenticatedRequest, accepted: Row) {
    await this.ensureCoilSupplementSources(client, request, accepted, "customer");
  }

  private async ensurePartnerCoilSupplementSourcesForEligibleAcceptedProduction(client: PoolClient, request: AuthenticatedRequest) {
    const rows = await this.acceptedProductionRows(client, request.auth.tenantId, {});
    const billableBaseSources = await client.query(
      "SELECT customer_qc_decision_id FROM accepted_production_financial_sources WHERE tenant_id = $1 AND source_kind = 'accepted_production' AND billable_item_id IS NOT NULL AND settlement_item_id IS NULL AND deleted_at IS NULL AND financial_status <> 'void'",
      [request.auth.tenantId],
    );
    const billableDecisionIds = new Set(billableBaseSources.rows.map((row) => String(row.customer_qc_decision_id)));
    for (const accepted of rows.filter((row) => billableDecisionIds.has(String(row.customer_qc_decision_id)))) {
      await this.ensureCoilSupplementSources(client, request, accepted, "partner");
    }
  }

  private async ensureCoilSupplementSources(client: PoolClient, request: AuthenticatedRequest, accepted: Row, partyType: "customer" | "partner") {
    const coils = await client.query(
      "SELECT * FROM syncfield_coil_observations WHERE tenant_id = $1 AND production_record_id = $2 AND deleted_at IS NULL AND status = 'submitted' AND COALESCE(actual_length_ft,0) > 0 ORDER BY created_at",
      [request.auth.tenantId, accepted.production_record_id],
    );
    for (const coil of coils.rows) {
      const policy = await this.resolveCoilPolicy(client, request.auth.tenantId, accepted, coil, partyType);
      if (!policy || policy.treatment === "unconfirmed") {
        await this.createException(client, request, "coil_commercial_clarification", { ...accepted, coil_observation_id: coil.id }, "COMMERCIAL CLARIFICATION REQUIRED - COIL POLICY UNCONFIRMED");
        continue;
      }
      if (policy.treatment === "included_in_route_rate" || policy.treatment === "non_billable") continue;
      const sourceKind = partyType === "customer" ? "customer_coil_supplement" : "partner_coil_supplement";
      const existing = await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id = $1 AND source_kind = $2 AND coil_observation_id = $3 AND customer_qc_decision_id = $4 AND deleted_at IS NULL AND financial_status <> 'void'", [request.auth.tenantId, sourceKind, coil.id, accepted.customer_qc_decision_id]);
      if (existing.rows[0]) continue;
      const quantity = Number(coil.actual_length_ft);
      const productionCode = policy.treatment === "separate_pay_item" ? await this.productionCodeById(client, request.auth.tenantId, policy.separate_production_code_id) : { id: accepted.production_code_id, code: accepted.production_code, description: `${accepted.production_description ?? accepted.production_code} coil footage`, unit_of_measure: accepted.unit_of_measure };
      const rate = await this.resolveRate(client, request.auth.tenantId, partyType === "customer" ? accepted.customer_rate_schedule_id : accepted.partner_rate_schedule_id, productionCode.code, productionCode.unit_of_measure, partyType);
      if (!rate || Number(rate.rate ?? 0) <= 0) {
        await this.createException(client, request, "missing_coil_rate_mapping", { ...accepted, coil_observation_id: coil.id }, `MISSING ${partyType.toUpperCase()} COIL RATE MAPPING`);
        continue;
      }
      const customerRateId = partyType === "customer" ? rate.id : null;
      const partnerRateId = partyType === "partner" ? rate.id : null;
      const amount = this.roundMoney(quantity * Number(rate.rate));
      const fingerprint = this.sourceFingerprint([sourceKind, accepted.customer_qc_decision_id, coil.id, policy.id, policy.version, quantity]);
      await client.query(
        `
        INSERT INTO accepted_production_financial_sources (
          tenant_id, project_id, work_order_id, partner_organization_id, capacity_provider_id, crew_id, production_record_id,
          customer_qc_cycle_id, customer_qc_decision_id, production_code_id, production_code, production_description, source_kind,
          coil_observation_id, customer_coil_policy_id, partner_coil_policy_id, commercial_treatment, policy_version,
          accepted_quantity, unit_of_measure, customer_rate_code_id, customer_rate_schedule_id, customer_rate, customer_extended_amount,
          partner_rate_code_id, partner_rate_schedule_id, partner_rate, partner_extended_amount, rate_revision_locked_at, source_fingerprint, created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,now(),$29,$30)
        ON CONFLICT DO NOTHING
        `,
        [
          request.auth.tenantId,
          accepted.project_id,
          accepted.work_order_id,
          accepted.partner_organization_id,
          accepted.capacity_provider_id,
          accepted.crew_id,
          accepted.production_record_id,
          accepted.customer_qc_cycle_id,
          accepted.customer_qc_decision_id,
          productionCode.id,
          productionCode.code,
          `${productionCode.description ?? productionCode.code} - Coil commercial supplement`,
          sourceKind,
          coil.id,
          partyType === "customer" ? policy.id : null,
          partyType === "partner" ? policy.id : null,
          policy.treatment,
          policy.version,
          quantity,
          productionCode.unit_of_measure,
          customerRateId,
          partyType === "customer" ? rate.rate_schedule_id : null,
          partyType === "customer" ? rate.rate : null,
          partyType === "customer" ? amount : null,
          partnerRateId,
          partyType === "partner" ? rate.rate_schedule_id : null,
          partyType === "partner" ? rate.rate : null,
          partyType === "partner" ? amount : null,
          fingerprint,
          request.auth.userId,
        ],
      );
    }
  }

  private async createCustomerCoilBillables(client: PoolClient, request: AuthenticatedRequest) {
    const sources = await client.query(
      "SELECT * FROM accepted_production_financial_sources WHERE tenant_id = $1 AND source_kind = 'customer_coil_supplement' AND billable_item_id IS NULL AND deleted_at IS NULL AND financial_status = 'eligible' ORDER BY created_at LIMIT 100",
      [request.auth.tenantId],
    );
    for (const source of sources.rows) {
      if (!source.customer_rate_code_id || Number(source.customer_rate ?? 0) <= 0) continue;
      const workOrder = await this.workOrderCommercialContext(client, request.auth.tenantId, String(source.work_order_id));
      const billable = await client.query(
        `
        INSERT INTO billable_items (
          tenant_id, project_id, work_order_id, production_record_id, customer_qc_decision_id, accepted_production_source_id,
          customer_organization_id, capacity_provider_id, crew_id, status, readiness_status, readiness_score, readiness_band,
          approved_quantity, billable_quantity, unit, rate_code_id, rate_description, unit_rate, rate_source, rate_confidence,
          estimated_billable_amount, net_billable_amount, customer_acceptance_status, billing_package_status, documentation_status,
          rate_schedule_id, rate_schedule_version, rate_effective_date, currency, source_fingerprint, created_by, updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready_for_settlement','ready_for_settlement',100,'ready_for_settlement',
          $10,$10,$11,$12,$13,$14,'customer_rate','confirmed',$15,$15,'accepted','ready','ready',$16,$17,$18,'USD',$19,$20,$20)
        ON CONFLICT DO NOTHING
        RETURNING *
        `,
        [
          request.auth.tenantId,
          source.project_id,
          source.work_order_id,
          source.production_record_id,
          source.customer_qc_decision_id,
          source.id,
          workOrder.customer_organization_id,
          source.capacity_provider_id,
          source.crew_id,
          source.accepted_quantity,
          source.unit_of_measure,
          source.customer_rate_code_id,
          source.production_description,
          source.customer_rate,
          source.customer_extended_amount,
          source.customer_rate_schedule_id,
          `policy:${source.customer_coil_policy_id}:v${source.policy_version}`,
          this.today(),
          source.source_fingerprint,
          request.auth.userId,
        ],
      );
      if (billable.rows[0]) await client.query("UPDATE accepted_production_financial_sources SET billable_item_id = $1, financial_status = 'billable_created', updated_at = now() WHERE tenant_id = $2 AND id = $3", [billable.rows[0].id, request.auth.tenantId, source.id]);
    }
  }

  private async resolveCoilPolicy(client: PoolClient, tenantId: string, accepted: Row, coil: Row, partyType: "customer" | "partner") {
    const counterparty = partyType === "customer" ? accepted.customer_organization_id : accepted.partner_organization_id;
    const result = await client.query(
      `
      SELECT *
      FROM syncfield_coil_commercial_policies
      WHERE tenant_id = $1
        AND work_order_id = $2
        AND party_type = $3
        AND counterparty_organization_id = $4
        AND (production_code_id IS NULL OR production_code_id = $5)
        AND (coil_type IS NULL OR coil_type = $6)
        AND (easement_type IS NULL OR easement_type = $7)
        AND effective_from <= $8
        AND COALESCE(effective_to, '9999-12-31'::date) >= $8
        AND status = 'active'
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN production_code_id IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE WHEN coil_type IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE WHEN easement_type IS NOT NULL THEN 1 ELSE 0 END DESC,
        effective_from DESC,
        version DESC
      LIMIT 1
      `,
      [tenantId, accepted.work_order_id, partyType, counterparty, accepted.production_code_id, coil.coil_type, coil.easement_type, coil.production_date],
    );
    return result.rows[0] ?? null;
  }

  private async workOrderCommercialContext(client: PoolClient, tenantId: string, workOrderId: string) {
    const result = await client.query(
      `
      SELECT wo.*, p.customer_organization_id
      FROM work_orders wo
      JOIN projects p ON p.tenant_id = wo.tenant_id AND p.id = wo.project_id
      WHERE wo.tenant_id = $1 AND wo.id = $2
      `,
      [tenantId, workOrderId],
    );
    if (!result.rows[0]) throw new NotFoundException("work order not found");
    return result.rows[0];
  }

  private async productionCodeById(client: PoolClient, tenantId: string, id: unknown) {
    const result = await client.query("SELECT id, code, description, unit_of_measure FROM syncfield_production_codes WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
    if (!result.rows[0]) throw new BadRequestException("separate production code not found");
    return result.rows[0];
  }

  private normalizedValue(value: unknown, label: string, allowed: Set<string>) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!allowed.has(normalized)) throw new BadRequestException(`${label} is invalid`);
    return normalized;
  }

  private optionalEnum(value: unknown, label: string, allowed: Set<string>) {
    if (value === undefined || value === null || value === "") return null;
    return this.normalizedValue(value, label, allowed);
  }

  private async allocatePaymentApplication(client: PoolClient, tenantId: string, userId: string, application: Row, invoice: Row, amount: number) {
    const items = await client.query("SELECT * FROM invoice_items WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL AND status <> ALL($3::text[]) ORDER BY created_at", [tenantId, invoice.id, ["voided", "archived"]]);
    const total = items.rows.reduce((sum, row) => sum + Number(row.net_amount ?? 0), 0);
    let remaining = amount;
    for (let index = 0; index < items.rows.length; index += 1) {
      const item = items.rows[index];
      const allocated = index === items.rows.length - 1 ? remaining : this.roundMoney(amount * (Number(item.net_amount ?? 0) / total));
      remaining = this.roundMoney(remaining - allocated);
      await client.query(
        "INSERT INTO payment_application_allocations (tenant_id,payment_application_id,invoice_item_id,billable_item_id,accepted_production_source_id,allocated_customer_amount,allocation_method,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,'invoice_item_prorata',$7)",
        [tenantId, application.id, item.id, item.billable_item_id, item.accepted_production_source_id, allocated, userId],
      );
    }
  }

  private async requireCurrentDecisionForRecord(client: PoolClient, tenantId: string, productionRecordId: string) {
    const result = await client.query(
      `
      SELECT cqd.*
      FROM customer_qc_decisions cqd
      JOIN customer_qc_cycles cqc ON cqc.tenant_id = cqd.tenant_id AND cqc.id = cqd.qc_cycle_id
      WHERE cqd.tenant_id = $1 AND cqd.production_record_id = $2 AND cqd.current = true AND cqd.deleted_at IS NULL
      ORDER BY cqc.cycle_number DESC, cqd.recorded_at DESC
      LIMIT 1
      `,
      [tenantId, productionRecordId],
    );
    if (!result.rows[0]) throw new NotFoundException("current Customer QC decision not found");
    return result.rows[0];
  }

  private async createException(client: PoolClient, request: AuthenticatedRequest, type: string, source: Row, message: string) {
    const fingerprint = this.sourceFingerprint([type, source.customer_qc_decision_id ?? source.id, source.production_record_id ?? ""]);
    const existing = await client.query("SELECT * FROM financial_exceptions WHERE tenant_id = $1 AND exception_type = $2 AND source_fingerprint = $3 AND deleted_at IS NULL AND status <> 'void'", [request.auth.tenantId, type, fingerprint]);
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await client.query(
      "INSERT INTO financial_exceptions (tenant_id,exception_type,project_id,work_order_id,partner_organization_id,production_record_id,customer_qc_decision_id,billable_item_id,invoice_id,contractor_payable_id,message,safe_resolution_hint,source_fingerprint,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",
      [request.auth.tenantId, type, source.project_id ?? null, source.work_order_id ?? null, source.partner_organization_id ?? null, source.production_record_id ?? null, source.customer_qc_decision_id ?? null, source.billable_item_id ?? null, source.invoice_id ?? null, source.contractor_payable_id ?? null, message, "Use controlled finance review. Do not rewrite issued invoices or payable history in place.", fingerprint, request.auth.userId],
    );
    return inserted.rows[0];
  }

  private async partnerContext(client: PoolClient, tenantId: string, userId: string) {
    const result = await client.query(
      `
      SELECT cp.organization_id, cp.id AS capacity_provider_id
      FROM tenant_users tu
      JOIN user_roles ur ON ur.tenant_id = tu.tenant_id AND ur.tenant_user_id = tu.id
      JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id AND r.system_key = 'partner_admin'
      JOIN capacity_providers cp ON cp.tenant_id = tu.tenant_id AND cp.organization_id = ur.scope_id
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND ur.scope_type = 'organization'
      LIMIT 1
      `,
      [tenantId, userId],
    );
    if (!result.rows[0]) throw new ForbiddenException("Partner financial workspace is unavailable");
    return result.rows[0];
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: unknown, message: string) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException(message);
    return result.rows[0];
  }

  private safeBillable(row: Row) {
    const { unit_rate, customer_rate, contractor_rate, margin, margin_amount, margin_percent, ...safe } = row;
    return { ...safe, customer_rate_locked: unit_rate };
  }

  private safePartnerSettlement(row: Row) {
    const { customer_rate, margin, margin_amount, margin_percent, ...safe } = row;
    return safe;
  }

  private safePayable(row: Row) {
    const { customer_rate, margin, margin_amount, margin_percent, ...safe } = row;
    return safe;
  }

  private safeCoilPolicy(row: Row) {
    return row;
  }

  private sourceFingerprint(parts: unknown[]) {
    return Buffer.from(parts.map((part) => String(part)).join("|")).toString("base64url").slice(0, 64);
  }

  private positive(value: unknown, label: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(`${label} must be positive`);
    return number;
  }

  private nonNegative(value: unknown, label: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`${label} must be non-negative`);
    return number;
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private today() {
    return new Date().toISOString().slice(0, 10);
  }

  private addDays(date: string, days: number) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  }

  private addBusinessDays(date: string, days: number) {
    let current = date;
    let remaining = days;
    while (remaining > 0) {
      current = this.addDays(current, 1);
      const day = new Date(`${current}T00:00:00Z`).getUTCDay();
      if (day !== 0 && day !== 6) remaining -= 1;
    }
    return current;
  }

  private weekStart(date: string) {
    const current = new Date(`${date}T00:00:00Z`);
    const day = current.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    current.setUTCDate(current.getUTCDate() + diff);
    return current.toISOString().slice(0, 10);
  }

  private async nextNumber(client: PoolClient, tenantId: string, table: string, column: string, prefix: string) {
    const result = await client.query(`SELECT count(*)::int + 1 AS next FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    return `${prefix}-${String(result.rows[0].next).padStart(4, "0")}`;
  }

  private async withClient<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  private async write<T>(request: AuthenticatedRequest, action: string, eventType: string, aggregateType: string, write: (client: PoolClient) => Promise<WriteActionResult<T>>) {
    return this.withClient((client) => executeWriteAction(client, {
      tenantId: request.auth.tenantId,
      actorUserId: request.auth.userId,
      action,
      aggregateType,
      eventType,
      write,
    }));
  }
}
