import { requireFreshSchedule, lockScheduleInputs } from './payable-schedule-freshness';
import { normalizePaymentObservation } from "./external-payment-observation";
import { requirePartnerPayableLineage } from "./partner-financial-lineage";
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { requireString } from "./intelligence.types";

type Row = QueryResultRow & Record<string, unknown>;

const activeInstructionStatuses = ["draft", "pending_approval", "approved", "submitted", "processing"];

@Controller("payment-retainage-adjustments")
export class PaymentRetainageAdjustmentsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("ready-to-pay")
  @RequirePermission("partner_payment.execute")
  async readyToPay(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const result = await client.query(
        `
        SELECT cp.*, o.name AS partner_name, s.settlement_number
        FROM contractor_payables cp
        LEFT JOIN organizations o ON o.tenant_id = cp.tenant_id AND o.id = cp.partner_organization_id
        LEFT JOIN settlements s ON s.tenant_id = cp.tenant_id AND s.id = cp.settlement_id
        WHERE cp.tenant_id = $1
          AND cp.deleted_at IS NULL
          AND cp.payment_readiness_status IN ('ready_for_payment','ready_with_warning')
          AND cp.status NOT IN ('voided','archived','rejected','held','disputed')
          AND COALESCE(cp.hold_status,'') <> 'hold'
          AND COALESCE(cp.dispute_status,'') NOT IN ('open','under_review')
          AND cp.pay_when_paid_status IN ('eligible','partially_eligible')
          AND COALESCE(cp.eligible_amount,0) - COALESCE(cp.paid_amount,0) - COALESCE(cp.in_flight_payment_amount,0) > 0
        ORDER BY cp.payment_due_at NULLS LAST, cp.created_at
        LIMIT 250
        `,
        [request.auth.tenantId],
      );
      return result.rows.map((row) => this.safePayable(row));
    });
  }

  @Get("dashboard")
  @RequirePermission("partner_payment.execute")
  async dashboard(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const [payables, instructions, retainage, adjustments] = await Promise.all([
        client.query(
          "SELECT COALESCE(sum(eligible_amount),0)::numeric AS eligible, COALESCE(sum(paid_amount),0)::numeric AS paid, COALESCE(sum(in_flight_payment_amount),0)::numeric AS in_flight FROM contractor_payables WHERE tenant_id = $1 AND deleted_at IS NULL",
          [request.auth.tenantId],
        ),
        client.query("SELECT status, count(*)::int AS count, COALESCE(sum(amount),0)::numeric AS amount FROM partner_payment_instructions WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY status", [request.auth.tenantId]),
        client.query("SELECT COALESCE(sum(retained_balance_amount),0)::numeric AS retained FROM contractor_payables WHERE tenant_id = $1 AND deleted_at IS NULL", [request.auth.tenantId]),
        client.query("SELECT count(*)::int AS count FROM financial_adjustments WHERE tenant_id = $1 AND deleted_at IS NULL AND status <> 'void'", [request.auth.tenantId]),
      ]);
      return {
        eligible_amount: Number(payables.rows[0].eligible),
        paid_amount: Number(payables.rows[0].paid),
        in_flight_amount: Number(payables.rows[0].in_flight),
        retained_balance: Number(retainage.rows[0].retained),
        adjustment_count: adjustments.rows[0].count,
        instruction_statuses: instructions.rows,
        boundary: {
          settlement_is_payment: false,
          contractor_payable_is_payment: false,
          eligibility_is_payment: false,
          provider_submission_is_confirmation: false,
          creates_real_ach: false,
        },
      };
    });
  }

  @Get("passport-preview")
  @RequirePermission("partner_payment.confirm")
  async passportPreview() {
    // Pure invented fixtures. No tenant data, provider calls or financial writes.
    const { buildPreview } = require("../../../../packages/passport/src/preview");
    return buildPreview();
  }

  @Get("external-payment-observations")
  @RequirePermission("partner_payment.confirm")
  async paymentObservations(@Req() request: AuthenticatedRequest) {
    return this.withClient(async client => (await client.query("SELECT * FROM external_payment_observations WHERE tenant_id=$1 ORDER BY received_at DESC LIMIT 200", [request.auth.tenantId])).rows);
  }

  @Post("external-payment-observations")
  @RequirePermission("partner_payment.confirm")
  async observeExternalPayment(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    const observation = normalizePaymentObservation(body, this.today());
    const evidence = requireString(body.evidence_reference, "Evidence reference is required");
    return this.write(request, "external_payment.observed", "external_payment.observed", "external_payment_observation", async client => {
      const key = [request.auth.tenantId, observation.provider, observation.account_reference, observation.transaction_reference];
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [JSON.stringify(key)]);
      const existing = (await client.query("SELECT * FROM external_payment_observations WHERE tenant_id=$1 AND provider=$2 AND account_reference=$3 AND transaction_reference=$4 AND fingerprint=$5", [...key, observation.fingerprint])).rows[0];
      if (existing) return { entityType: "external_payment_observation", entityId: existing.id, afterState: existing, skipEventAudit: true };
      const row = (await client.query(`INSERT INTO external_payment_observations
        (tenant_id,provider,account_reference,transaction_reference,payee_reference,amount,currency,observed_status,completed_date,evidence_reference,fingerprint,received_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [...key, observation.payee_reference, observation.amount, observation.currency, observation.observed_status, observation.completed_date, evidence, observation.fingerprint, request.auth.userId])).rows[0];
      return { entityType: "external_payment_observation", entityId: row.id, afterState: row };
    });
  }

  @Post("external-payment-observations/:id/link-recorded-payment")
  @RequirePermission("partner_payment.confirm")
  async linkObservedPayment(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    const paymentId = requireString(body.external_partner_payment_id, "Select an already recorded external payment");
    const note = requireString(body.review_note, "Document the account and payee mapping review");
    if (body.account_and_payee_verified !== true) throw new BadRequestException("Verify the account and payee mapping first");
    return this.write(request, "external_payment.reviewed", "external_payment.reviewed", "external_payment_observation", async client => {
      const before = (await client.query("SELECT * FROM external_payment_observations WHERE tenant_id=$1 AND id=$2", [request.auth.tenantId,id])).rows[0];
      if (!before) throw new NotFoundException("Observation not found");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [JSON.stringify([request.auth.tenantId,before.provider,before.account_reference,before.transaction_reference])]);
      const current = (await client.query("SELECT * FROM external_payment_observations WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [request.auth.tenantId,id])).rows[0];
      if (current.review_status === "linked") {
        if (current.external_partner_payment_id !== paymentId) throw new BadRequestException("Observation already linked to a different payment");
        return { entityType: "external_payment_observation", entityId: id, afterState: current, skipEventAudit: true };
      }
      const conflicts = (await client.query(`SELECT id FROM external_payment_observations WHERE tenant_id=$1 AND provider=$2 AND account_reference=$3 AND transaction_reference=$4
        AND (observed_status IN ('failed','returned','reversed') OR (observed_status='completed' AND (amount<>$5 OR currency<>$6 OR payee_reference<>$7 OR completed_date<>$8)))`, [request.auth.tenantId,current.provider,current.account_reference,current.transaction_reference,current.amount,current.currency,current.payee_reference,current.completed_date])).rows;
      if (conflicts.length) throw new BadRequestException("Conflicting or reversed payment remains under review; do not mark reconciled");
      const payment = (await client.query("SELECT * FROM external_partner_payments WHERE tenant_id=$1 AND id=$2", [request.auth.tenantId,paymentId])).rows[0];
      const date = payment?.payment_date instanceof Date ? payment.payment_date.toISOString().slice(0,10) : String(payment?.payment_date).slice(0,10);
      const observedDate = current.completed_date instanceof Date ? current.completed_date.toISOString().slice(0,10) : String(current.completed_date).slice(0,10);
      if (!payment || current.observed_status !== "completed" || current.currency !== "USD" || Number(payment.amount) !== Number(current.amount) || payment.reference !== current.transaction_reference || date !== observedDate || (current.provider === "passport" && payment.method !== "passport")) throw new BadRequestException("Recorded payment must match completed reference, amount, currency and date");
      const after = (await client.query("UPDATE external_payment_observations SET review_status='linked',external_partner_payment_id=$3,reviewed_by=$4,reviewed_at=now(),review_note=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *", [request.auth.tenantId,id,paymentId,request.auth.userId,note])).rows[0];
      return { entityType: "external_payment_observation", entityId: id, beforeState: current, afterState: after };
    });
  }

  @Get("external-payments")
  @RequirePermission("partner_payment.execute")
  async externalPayments(@Req() request: AuthenticatedRequest) {
    return this.withClient(async client => (await client.query(`
      SELECT ep.id,ep.amount,ep.payment_date,ep.method,ep.reference,ep.evidence_reference,ep.created_at,
        cp.payable_number,o.name AS partner_name,u.display_name AS recorded_by
      FROM external_partner_payments ep
      JOIN contractor_payables cp ON cp.tenant_id=ep.tenant_id AND cp.id=ep.contractor_payable_id
      LEFT JOIN organizations o ON o.tenant_id=cp.tenant_id AND o.id=cp.partner_organization_id
      LEFT JOIN users u ON u.id=ep.recorded_by
      WHERE ep.tenant_id=$1 ORDER BY ep.created_at DESC LIMIT 100`,[request.auth.tenantId])).rows);
  }

  @Post("external-payments")
  @RequirePermission("partner_payment.confirm")
  async recordExternalPayment(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "partner_payment.external_recorded", "partner_payment.external_recorded", "external_partner_payment", async client => {
      const payable = await this.requirePayable(client, request.auth.tenantId, requireString(body.contractor_payable_id,"Payable is required"));
      const key = requireString(body.idempotency_key,"Payment request identifier is required");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${request.auth.tenantId}:external-payment-key:${key}`]);
      const existing = await client.query("SELECT * FROM external_partner_payments WHERE tenant_id=$1 AND idempotency_key=$2",[request.auth.tenantId,key]);
      const amount = this.positive(body.amount,"amount");
      if(amount!==this.roundMoney(amount))throw new BadRequestException("Payment amount must use whole cents");
      const reference = requireString(body.reference,"External payment reference is required");
      const evidence = requireString(body.evidence_reference,"Receipt or bank confirmation reference is required");
      const method = requireString(body.method,"Payment method is required");
      const date = requireString(body.payment_date,"Payment date is required");
      if(!['ach','wire','check','passport','other'].includes(method))throw new BadRequestException("Unsupported payment method");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>this.today())throw new BadRequestException("Use the completed payment date, not a future date");
      if(body.confirmed_completed!==true)throw new BadRequestException("Confirm the external payment has completed");
      if(existing.rows[0]) {
        const e=existing.rows[0];
        if(e.contractor_payable_id!==payable.id||Number(e.amount)!==amount||e.reference!==reference||e.method!==method||String(e.payment_date instanceof Date ? e.payment_date.toISOString().slice(0,10) : e.payment_date).slice(0,10)!==date||e.evidence_reference!==evidence)throw new BadRequestException("Payment request identifier was already used for different details");
        return {entityType:"external_partner_payment",entityId:e.id,afterState:e,skipEventAudit:true};
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${request.auth.tenantId}:external-payment:${method}:${reference}`]);
      if((await client.query("SELECT id FROM external_partner_payments WHERE tenant_id=$1 AND method=$2 AND reference=$3",[request.auth.tenantId,method,reference])).rows.length)throw new BadRequestException("This external payment reference has already been recorded");
      if(amount>await this.availableToPay(client,request.auth.tenantId,payable))throw new BadRequestException("Payment exceeds eligible unpaid balance");
      const payment=(await client.query("INSERT INTO payments (tenant_id,settlement_id,amount,payment_amount,payment_date,payment_reference,status) VALUES ($1,$2,$3,$3,$4,$5,'recorded') RETURNING *",[request.auth.tenantId,payable.settlement_id,amount,date,reference])).rows[0];
      const recorded=(await client.query("INSERT INTO external_partner_payments (tenant_id,contractor_payable_id,payment_id,amount,payment_date,method,reference,evidence_reference,idempotency_key,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[request.auth.tenantId,payable.id,payment.id,amount,date,method,reference,evidence,key,request.auth.userId])).rows[0];
      const paid=this.roundMoney(Number(payable.paid_amount??0)+amount);
      const status=paid>=Number(payable.net_payable_amount)?'paid_later':'partially_paid_later';
      await client.query("UPDATE contractor_payables SET paid_amount=$3,payment_status=$4,status=$4,payment_execution_status='confirmed',updated_by=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2",[request.auth.tenantId,payable.id,paid,status,request.auth.userId]);
      return {entityType:"external_partner_payment",entityId:recorded.id,afterState:recorded};
    });
  }

  @Post("payment-instructions")
  @RequirePermission("partner_payment.execute")
  async createInstruction(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "partner_payment.instruction_created", "partner_payment.instruction_created", "partner_payment_instruction", async (client) => {
      const idempotencyKey = requireString(body.idempotency_key, "idempotency_key is required");
      const existing = await this.findByIdempotency(client, "partner_payment_instructions", request.auth.tenantId, idempotencyKey);
      if (existing) return { entityType: "partner_payment_instruction", entityId: existing.id, afterState: this.safeInstruction(existing) };
      const payable = await this.requirePayable(client, request.auth.tenantId, requireString(body.contractor_payable_id, "contractor_payable_id is required"));
      const profile = await this.requirePaymentProfile(client, request.auth.tenantId, String(payable.partner_organization_id));
      const available = await this.availableToPay(client, request.auth.tenantId, payable);
      const amount = body.amount === undefined ? available : this.positive(body.amount, "amount");
      if (amount > available) throw new BadRequestException("payment instruction amount exceeds eligible unpaid amount");
      const inserted = await client.query(
        `
        INSERT INTO partner_payment_instructions (
          tenant_id, partner_organization_id, capacity_provider_id, contractor_payable_id, amount, currency,
          payment_method, payment_profile_id, status, requested_by_user_id, approved_by_user_id, approved_at, idempotency_key
        )
        VALUES ($1,$2,$3,$4,$5,'USD','priority_passport',$6,'approved',$7,$7,now(),$8)
        RETURNING *
        `,
        [request.auth.tenantId, payable.partner_organization_id, payable.capacity_provider_id, payable.id, amount, profile.id, request.auth.userId, idempotencyKey],
      );
      await this.recalculateInFlight(client, request.auth.tenantId, String(payable.id), request.auth.userId);
      return { entityType: "partner_payment_instruction", entityId: inserted.rows[0].id, afterState: this.safeInstruction(inserted.rows[0]) };
    });
  }

  @Post("payment-instructions/:id/submit")
  @RequirePermission("partner_payment.submit")
  async submitInstruction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    if (["production", "staging"].includes(process.env.NODE_ENV ?? "")) {
      throw new BadRequestException("Live automated Partner payment submission is disabled");
    }
    return this.write(request, "partner_payment.submitted", "partner_payment.submitted", "partner_payment_instruction", async (client) => {
      const instruction = await this.requireInstruction(client, request.auth.tenantId, id);
      if (!["approved", "failed", "returned"].includes(String(instruction.status))) throw new BadRequestException("payment instruction must be approved or retryable");
      const payable = await this.requirePayable(client, request.auth.tenantId, String(instruction.contractor_payable_id));
      const available = await this.availableToPay(client, request.auth.tenantId, payable, id);
      if (Number(instruction.amount) > available) throw new BadRequestException("payment instruction amount exceeds current eligibility");
      await this.requirePaymentProfile(client, request.auth.tenantId, String(instruction.partner_organization_id));
      const idempotencyKey = requireString(body.idempotency_key, "idempotency_key is required");
      const existingAttempt = await this.findByIdempotency(client, "partner_payment_attempts", request.auth.tenantId, idempotencyKey);
      if (existingAttempt) return { entityType: "partner_payment_instruction", entityId: id, afterState: this.safeInstruction(instruction) };
      const attemptNo = Number((await client.query("SELECT COALESCE(max(attempt_number),0)::int + 1 AS next FROM partner_payment_attempts WHERE tenant_id = $1 AND payment_instruction_id = $2", [request.auth.tenantId, id])).rows[0].next);
      const providerReference = `local-test-${id.slice(0, 8)}-${attemptNo}`;
      await client.query(
        `
        INSERT INTO partner_payment_attempts (tenant_id,payment_instruction_id,contractor_payable_id,attempt_number,provider_name,provider_reference,status,amount,currency,idempotency_key,created_by_user_id)
        VALUES ($1,$2,$3,$4,'local_test_provider',$5,'processing',$6,$7,$8,$9)
        `,
        [request.auth.tenantId, id, payable.id, attemptNo, providerReference, instruction.amount, instruction.currency ?? "USD", idempotencyKey, request.auth.userId],
      );
      const after = await client.query("UPDATE partner_payment_instructions SET status = 'processing', submitted_at = now(), provider_reference = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3 RETURNING *", [providerReference, request.auth.tenantId, id]);
      await this.recalculateInFlight(client, request.auth.tenantId, String(payable.id), request.auth.userId);
      return { entityType: "partner_payment_instruction", entityId: id, beforeState: instruction, afterState: this.safeInstruction(after.rows[0]) };
    });
  }

  @Post("payment-instructions/:id/confirm")
  @RequirePermission("partner_payment.confirm")
  async confirmInstruction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "partner_payment.confirmed", "partner_payment.confirmed", "partner_payment_instruction", async (client) => {
      const instruction = await this.requireInstruction(client, request.auth.tenantId, id);
      if (instruction.status === "confirmed") return { entityType: "partner_payment_instruction", entityId: id, afterState: this.safeInstruction(instruction) };
      if (instruction.status !== "processing") throw new BadRequestException("payment instruction must be processing before confirmation");
      const attempt = await this.currentAttempt(client, request.auth.tenantId, id);
      const payable = await this.requirePayable(client, request.auth.tenantId, String(instruction.contractor_payable_id));
      const newPaid = this.roundMoney(Number(payable.paid_amount ?? 0) + Number(instruction.amount));
      if (newPaid > Number(payable.net_payable_amount ?? 0)) throw new BadRequestException("confirmed payment would exceed payable net amount");
      await client.query("UPDATE partner_payment_attempts SET status = 'confirmed', confirmed_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2", [request.auth.tenantId, attempt.id]);
      const payment = await client.query(
        "INSERT INTO payments (tenant_id, settlement_id, amount, payment_amount, payment_date, payment_reference, status) VALUES ($1,$2,$3,$3,$4,$5,'recorded') RETURNING *",
        [request.auth.tenantId, payable.settlement_id, instruction.amount, this.today(), instruction.provider_reference],
      );
      await client.query(
        "UPDATE contractor_payables SET paid_amount = $1, payment_status = $2, status = $3, payment_execution_status = $4, updated_by = $5, updated_at = now() WHERE tenant_id = $6 AND id = $7",
        [newPaid, newPaid >= Number(payable.net_payable_amount ?? 0) ? "paid_later" : "partially_paid_later", newPaid >= Number(payable.net_payable_amount ?? 0) ? "paid_later" : "partially_paid_later", "confirmed", request.auth.userId, request.auth.tenantId, payable.id],
      );
      const after = await client.query("UPDATE partner_payment_instructions SET status = 'confirmed', updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *", [request.auth.tenantId, id]);
      await this.recalculateInFlight(client, request.auth.tenantId, String(payable.id), request.auth.userId);
      return {
        entityType: "partner_payment_instruction",
        entityId: id,
        beforeState: instruction,
        afterState: this.safeInstruction(after.rows[0]),
        additionalEvents: [{ action: "payment.recorded", aggregateType: "payment", entityType: "payment", entityId: payment.rows[0].id, eventType: "payment.recorded", afterState: { id: payment.rows[0].id, amount: payment.rows[0].amount, settlement_id: payment.rows[0].settlement_id } }],
      };
    });
  }

  @Post("payment-instructions/:id/fail")
  @RequirePermission("partner_payment.confirm")
  async failInstruction(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Row) {
    return this.write(request, "partner_payment.failed", "partner_payment.failed", "partner_payment_instruction", async (client) => {
      const instruction = await this.requireInstruction(client, request.auth.tenantId, id);
      if (!["processing", "submitted"].includes(String(instruction.status))) throw new BadRequestException("payment instruction is not in flight");
      const attempt = await this.currentAttempt(client, request.auth.tenantId, id);
      const reason = requireString(body.failure_reason_safe, "failure_reason_safe is required");
      await client.query("UPDATE partner_payment_attempts SET status = 'failed', failed_at = now(), failure_reason_safe = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3", [reason, request.auth.tenantId, attempt.id]);
      const after = await client.query("UPDATE partner_payment_instructions SET status = 'failed', failure_reason_safe = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3 RETURNING *", [reason, request.auth.tenantId, id]);
      await this.recalculateInFlight(client, request.auth.tenantId, String(instruction.contractor_payable_id), request.auth.userId);
      return { entityType: "partner_payment_instruction", entityId: id, beforeState: instruction, afterState: this.safeInstruction(after.rows[0]) };
    });
  }

  @Get("retainage-choices")
  @RequirePermission("retainage.release")
  async retainageChoices(@Req() request: AuthenticatedRequest) {
    return this.withClient(async client => {
      const payables = await client.query(`SELECT cp.id, cp.retained_balance_amount, concat(cp.payable_number,' · ',o.name,' · retained $',cp.retained_balance_amount) AS label FROM contractor_payables cp LEFT JOIN organizations o ON o.tenant_id=cp.tenant_id AND o.id=cp.partner_organization_id WHERE cp.tenant_id=$1 AND cp.deleted_at IS NULL AND cp.status NOT IN ('voided','archived') AND cp.retained_balance_amount>0`, [request.auth.tenantId]);
      const releases = await client.query(`SELECT r.id, r.status, r.release_amount, concat(cp.payable_number,' · $',r.release_amount,' · ',r.release_reason) AS label FROM retainage_releases r JOIN contractor_payables cp ON cp.tenant_id=r.tenant_id AND cp.id=r.contractor_payable_id WHERE r.tenant_id=$1 AND r.deleted_at IS NULL ORDER BY r.created_at DESC`, [request.auth.tenantId]);
      return { payables: payables.rows, releases: releases.rows };
    });
  }

  @Get("adjustment-choices")
  @RequirePermission("financial_adjustment.create")
  async adjustmentChoices(@Req() request: AuthenticatedRequest) {
    return this.withClient(async client => {
      const sources = await client.query(`SELECT src.id, src.accepted_quantity, cqd.customer_accepted_quantity AS corrected_quantity,
        cp.id AS contractor_payable_id, concat(i.invoice_number,' · ',wo.work_order_number,' · ',src.accepted_quantity,' → ',cqd.customer_accepted_quantity,' ',src.unit_of_measure) AS label
        FROM accepted_production_financial_sources src
        JOIN invoice_items ii ON ii.tenant_id=src.tenant_id AND ii.id=src.invoice_item_id
        JOIN invoices i ON i.tenant_id=ii.tenant_id AND i.id=ii.invoice_id
        JOIN customer_qc_decisions cqd ON cqd.tenant_id=src.tenant_id AND cqd.production_record_id=src.production_record_id AND cqd.current=true AND cqd.deleted_at IS NULL
        LEFT JOIN work_orders wo ON wo.tenant_id=src.tenant_id AND wo.id=src.work_order_id
        LEFT JOIN contractor_payable_items cpi ON cpi.tenant_id=src.tenant_id AND cpi.id=src.contractor_payable_item_id
        LEFT JOIN contractor_payables cp ON cp.tenant_id=cpi.tenant_id AND cp.id=cpi.contractor_payable_id
        WHERE src.tenant_id=$1 AND src.deleted_at IS NULL AND src.billable_item_id IS NOT NULL AND COALESCE(cqd.customer_accepted_quantity,0)<src.accepted_quantity ORDER BY src.created_at DESC`, [request.auth.tenantId]);
      const adjustments = await client.query(`SELECT id,status,reason,source_reference,adjustment_amount FROM financial_adjustments WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [request.auth.tenantId]);
      return { sources: sources.rows, adjustments: adjustments.rows };
    });
  }

  @Post("retainage-releases")
  @RequirePermission("retainage.release")
  async createRetainageRelease(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "retainage.release_created", "retainage.release_created", "retainage_release", async (client) => {
      const idempotencyKey = requireString(body.idempotency_key, "idempotency_key is required");
      const existing = await this.findByIdempotency(client, "retainage_releases", request.auth.tenantId, idempotencyKey);
      if (existing) return { entityType: "retainage_release", entityId: existing.id, afterState: existing };
      const payable = await this.requirePayable(client, request.auth.tenantId, requireString(body.contractor_payable_id, "contractor_payable_id is required"));
      const amount = this.positive(body.release_amount, "release_amount");
      const retained = Number(payable.retained_balance_amount ?? payable.retainage_amount ?? 0);
      if (amount > this.roundMoney(retained)) throw new BadRequestException("retainage release exceeds retained balance");
      const release = await client.query(
        "INSERT INTO retainage_releases (tenant_id,partner_organization_id,contractor_payable_id,settlement_item_id,retained_amount,release_amount,release_reason,source_reference,status,idempotency_key,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10) RETURNING *",
        [request.auth.tenantId, payable.partner_organization_id, payable.id, this.optionalString(body.settlement_item_id), retained, amount, requireString(body.release_reason, "release_reason is required"), requireString(body.source_reference, "source_reference is required"), idempotencyKey, request.auth.userId],
      );
      return { entityType: "retainage_release", entityId: release.rows[0].id, afterState: release.rows[0] };
    });
  }

  @Post("retainage-releases/:id/authorize")
  @RequirePermission("retainage.release")
  async authorizeRetainageRelease(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "retainage.release_authorized", "retainage.release_authorized", "retainage_release", async (client) => {
      const release = await this.requireRecord(client, "retainage_releases", request.auth.tenantId, id, "retainage release not found");
      if (release.status === "released_to_payable") return { entityType: "retainage_release", entityId: id, afterState: release };
      if (release.status !== "pending") throw new BadRequestException("retainage release must be pending");
      const sourcePayable = await this.requirePayable(client, request.auth.tenantId, String(release.contractor_payable_id));
      if (["voided", "archived", "rejected", "held", "disputed"].includes(String(sourcePayable.status)) || sourcePayable.hold_status === "hold" || ["open", "under_review"].includes(String(sourcePayable.dispute_status))) throw new BadRequestException("Resolve the payable hold or dispute before releasing retainage");
      if (Number(release.release_amount) > Number(sourcePayable.retained_balance_amount ?? sourcePayable.retainage_amount ?? 0)) throw new BadRequestException("Retained balance changed; this release exceeds the remaining amount");
      const number = await this.nextNumber(client, request.auth.tenantId, "contractor_payables", "payable_number", "CP-RET-P13");
      const payable = await client.query(
        `
        INSERT INTO contractor_payables (
          tenant_id, payable_number, payable_type, payable_party_type, status, approval_status, payment_readiness_status, payment_status,
          capacity_provider_id, partner_organization_id, project_id, settlement_id, pay_cycle_start, pay_cycle_end,
          gross_payable_amount, retainage_amount, retained_balance_amount, net_payable_amount, eligible_amount, ineligible_amount,
          pay_when_paid_status, payment_execution_status, compliance_status, tax_document_status, created_by, updated_by
        )
        VALUES ($1,$2,'retainage_release','capacity_provider','payment_ready','approved','ready_for_payment','not_paid',
          $3,$4,$5,$6,$7,$8,$9,0,0,$9,$9,0,'eligible','not_started','ready','ready',$10,$10)
        RETURNING *
        `,
        [request.auth.tenantId, number, sourcePayable.capacity_provider_id, sourcePayable.partner_organization_id, sourcePayable.project_id, sourcePayable.settlement_id, sourcePayable.pay_cycle_start, sourcePayable.pay_cycle_end, release.release_amount, request.auth.userId],
      );
      const after = await client.query(
        "UPDATE retainage_releases SET status = 'released_to_payable', authorized_by_user_id = $1, authorized_at = now(), release_payable_id = $2, updated_at = now() WHERE tenant_id = $3 AND id = $4 RETURNING *",
        [request.auth.userId, payable.rows[0].id, request.auth.tenantId, id],
      );
      await client.query("UPDATE contractor_payables SET retained_balance_amount = GREATEST(COALESCE(retained_balance_amount, retainage_amount) - $1, 0), updated_by = $2, updated_at = now() WHERE tenant_id = $3 AND id = $4", [release.release_amount, request.auth.userId, request.auth.tenantId, sourcePayable.id]);
      return {
        entityType: "retainage_release",
        entityId: id,
        beforeState: release,
        afterState: after.rows[0],
        additionalEvents: [{ action: "contractor_payable.created", aggregateType: "contractor_payable", entityType: "contractor_payable", entityId: payable.rows[0].id, eventType: "contractor_payable.created", afterState: this.safePayable(payable.rows[0]) }],
      };
    });
  }

  @Post("financial-adjustments/credit-rebill")
  @RequirePermission("financial_adjustment.create")
  async creditRebill(@Req() request: AuthenticatedRequest, @Body() body: Row) {
    return this.write(request, "financial_adjustment.created", "financial_adjustment.created", "financial_adjustment", async (client) => {
      const idempotencyKey = requireString(body.idempotency_key, "idempotency_key is required");
      const existing = await this.findByIdempotency(client, "financial_adjustments", request.auth.tenantId, idempotencyKey);
      if (existing) return { entityType: "financial_adjustment", entityId: existing.id, afterState: existing };
      const source = await this.requireRecord(client, "accepted_production_financial_sources", request.auth.tenantId, requireString(body.accepted_production_source_id, "accepted_production_source_id is required"), "accepted production source not found");
      if (!source.invoice_item_id || !source.billable_item_id) throw new BadRequestException("source must already be billed before credit/rebill adjustment");
      const invoiceItem = await this.requireRecord(client, "invoice_items", request.auth.tenantId, String(source.invoice_item_id), "invoice item not found");
      const invoice = await this.requireRecord(client, "invoices", request.auth.tenantId, String(invoiceItem.invoice_id), "invoice not found");
      const current = await this.currentDecision(client, request.auth.tenantId, String(source.production_record_id));
      const correctedQuantity = Number(current.customer_accepted_quantity ?? 0);
      const originalQuantity = Number(source.accepted_quantity ?? 0);
      if (correctedQuantity >= originalQuantity) throw new BadRequestException("credit adjustment requires reduced accepted quantity");
      const rate = Number(source.customer_rate ?? invoiceItem.unit_rate ?? 0);
      const adjustmentAmount = this.roundMoney((originalQuantity - correctedQuantity) * rate);
      const inserted = await client.query(
        `
        INSERT INTO financial_adjustments (
          tenant_id, adjustment_type, status, project_id, work_order_id, partner_organization_id, original_invoice_id,
          original_invoice_item_id, billable_item_id, accepted_production_source_id, contractor_payable_id, customer_qc_decision_id,
          original_quantity, corrected_quantity, unit_of_measure, original_rate, adjustment_amount, reason, source_reference,
          idempotency_key, created_by_user_id
        )
        VALUES ($1,'customer_credit','review_required',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING *
        `,
        [request.auth.tenantId, source.project_id, source.work_order_id, source.partner_organization_id, invoice.id, invoiceItem.id, source.billable_item_id, source.id, body.contractor_payable_id ?? null, current.id, originalQuantity, correctedQuantity, source.unit_of_measure, rate, adjustmentAmount, requireString(body.reason, "reason is required"), requireString(body.source_reference, "source_reference is required"), idempotencyKey, request.auth.userId],
      );
      await this.createException(client, request, "post_billing_adjustment_required", source, "CONTROLLED CREDIT/REBILL REQUIRED - ISSUED INVOICE PRESERVED");
      if (body.contractor_payable_id) {
        await this.createException(client, request, "partner_recovery_required", { ...source, contractor_payable_id: body.contractor_payable_id }, "PARTNER RECOVERY / OFFSET REVIEW REQUIRED");
      }
      return { entityType: "financial_adjustment", entityId: inserted.rows[0].id, afterState: inserted.rows[0] };
    });
  }

  @Get("partner/payments")
  @RequirePermission("partner_payment.read")
  async partnerPayments(@Req() request: AuthenticatedRequest) {
    return this.withClient(async (client) => {
      const partner = await this.partnerContext(client, request.auth.tenantId, request.auth.userId);
      const result = await client.query(
        `
        SELECT cp.id AS contractor_payable_id, cp.payable_number, cp.net_payable_amount, cp.eligible_amount, cp.paid_amount,
          cp.in_flight_payment_amount, cp.retained_balance_amount, cp.payment_due_at, cp.payment_status, cp.pay_when_paid_status,
          COALESCE(json_agg(json_build_object(
            'id', ppi.id,
            'amount', ppi.amount,
            'status', ppi.status,
            'provider_reference', ppi.provider_reference,
            'requested_at', ppi.requested_at
          ) ORDER BY ppi.created_at DESC) FILTER (WHERE ppi.id IS NOT NULL), '[]'::json)::jsonb || COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',ep.id,'amount',ep.amount,'status','confirmed','provider_reference',ep.reference,'requested_at',ep.payment_date
          ) ORDER BY ep.created_at DESC) FROM external_partner_payments ep WHERE ep.tenant_id=cp.tenant_id AND ep.contractor_payable_id=cp.id),'[]'::jsonb) AS payments
        FROM contractor_payables cp
        LEFT JOIN partner_payment_instructions ppi ON ppi.tenant_id = cp.tenant_id AND ppi.contractor_payable_id = cp.id AND ppi.deleted_at IS NULL
        WHERE cp.tenant_id = $1 AND cp.partner_organization_id = $2 AND cp.deleted_at IS NULL
        GROUP BY cp.id
        ORDER BY cp.created_at DESC
        LIMIT 100
        `,
        [request.auth.tenantId, partner.organization_id],
      );
      return result.rows.map((row) => this.safePayable(row));
    });
  }

  private async requirePayable(client: PoolClient, tenantId: string, id: string) {
    await lockScheduleInputs(client,tenantId);
    const result = await client.query("SELECT * FROM contractor_payables WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("contractor payable not found");
    return result.rows[0] as Row;
  }

  private async requireInstruction(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query("SELECT * FROM partner_payment_instructions WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE", [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException("payment instruction not found");
    return result.rows[0] as Row;
  }

  private async requirePaymentProfile(client: PoolClient, tenantId: string, partnerOrganizationId: string) {
    const result = await client.query(
      "SELECT * FROM partner_payment_profiles WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'active' AND priority_passport_status = 'active' ORDER BY version DESC LIMIT 1",
      [tenantId, partnerOrganizationId],
    );
    if (!result.rows[0]) throw new BadRequestException("PAYMENT DESTINATION NOT READY");
    return result.rows[0] as Row;
  }

  private async availableToPay(client: PoolClient, tenantId: string, payable: Row, excludingInstructionId?: string) {
    if (!["eligible", "partially_eligible"].includes(String(payable.pay_when_paid_status))) throw new BadRequestException("contractor payable is not eligible for payment");
    if (["voided", "archived", "rejected", "held", "disputed"].includes(String(payable.status))) throw new BadRequestException("contractor payable lifecycle blocks payment");
    if (["open", "under_review"].includes(String(payable.dispute_status))) throw new BadRequestException("disputed payable amount unavailable");
    if (payable.hold_status === "hold") throw new BadRequestException("held payable amount unavailable");
    await requirePartnerPayableLineage(client, tenantId, payable);
    await requireFreshSchedule(client,tenantId,String(payable.id));
    const active = await client.query(
      `
      SELECT COALESCE(sum(amount),0)::numeric AS amount
      FROM partner_payment_instructions
      WHERE tenant_id = $1 AND contractor_payable_id = $2 AND deleted_at IS NULL
        AND status = ANY($3::text[])
        AND ($4::uuid IS NULL OR id <> $4::uuid)
      `,
      [tenantId, payable.id, activeInstructionStatuses, excludingInstructionId ?? null],
    );
    return this.roundMoney(Math.max(0, Number(payable.eligible_amount ?? 0) - Number(payable.paid_amount ?? 0) - Number(active.rows[0].amount ?? 0)));
  }

  private async recalculateInFlight(client: PoolClient, tenantId: string, payableId: string, userId: string) {
    const result = await client.query("SELECT COALESCE(sum(amount),0)::numeric AS amount FROM partner_payment_instructions WHERE tenant_id = $1 AND contractor_payable_id = $2 AND deleted_at IS NULL AND status = ANY($3::text[])", [tenantId, payableId, activeInstructionStatuses]);
    await client.query("UPDATE contractor_payables SET in_flight_payment_amount = $1, updated_by = $2, updated_at = now() WHERE tenant_id = $3 AND id = $4", [result.rows[0].amount, userId, tenantId, payableId]);
  }

  private async currentAttempt(client: PoolClient, tenantId: string, instructionId: string) {
    const result = await client.query("SELECT * FROM partner_payment_attempts WHERE tenant_id = $1 AND payment_instruction_id = $2 AND deleted_at IS NULL ORDER BY attempt_number DESC LIMIT 1", [tenantId, instructionId]);
    if (!result.rows[0]) throw new BadRequestException("payment attempt not found");
    return result.rows[0] as Row;
  }

  private async currentDecision(client: PoolClient, tenantId: string, productionRecordId: string) {
    const result = await client.query(
      "SELECT * FROM customer_qc_decisions WHERE tenant_id = $1 AND production_record_id = $2 AND current = true AND deleted_at IS NULL ORDER BY recorded_at DESC LIMIT 1",
      [tenantId, productionRecordId],
    );
    if (!result.rows[0]) throw new NotFoundException("current Customer QC decision not found");
    return result.rows[0] as Row;
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
    if (!result.rows[0]) throw new ForbiddenException("Partner payment workspace is unavailable");
    return result.rows[0] as Row;
  }

  private async createException(client: PoolClient, request: AuthenticatedRequest, type: string, source: Row, message: string) {
    const fingerprint = this.sourceFingerprint([type, source.id, source.customer_qc_decision_id ?? "", source.production_record_id ?? ""]);
    const existing = await client.query("SELECT * FROM financial_exceptions WHERE tenant_id = $1 AND exception_type = $2 AND source_fingerprint = $3 AND deleted_at IS NULL AND status <> 'void'", [request.auth.tenantId, type, fingerprint]);
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await client.query(
      "INSERT INTO financial_exceptions (tenant_id,exception_type,project_id,work_order_id,partner_organization_id,production_record_id,customer_qc_decision_id,billable_item_id,settlement_item_id,invoice_id,contractor_payable_id,message,safe_resolution_hint,source_fingerprint,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
      [request.auth.tenantId, type, source.project_id ?? null, source.work_order_id ?? null, source.partner_organization_id ?? null, source.production_record_id ?? null, source.customer_qc_decision_id ?? null, source.billable_item_id ?? null, source.settlement_item_id ?? null, source.invoice_id ?? null, source.contractor_payable_id ?? null, message, "Use controlled finance review. Do not rewrite issued invoices or payable history in place.", fingerprint, request.auth.userId],
    );
    return inserted.rows[0];
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: unknown, message: string) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`, [tenantId, id]);
    if (!result.rows[0]) throw new NotFoundException(message);
    return result.rows[0] as Row;
  }

  private async findByIdempotency(client: PoolClient, table: string, tenantId: string, idempotencyKey: string) {
    const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL LIMIT 1`, [tenantId, idempotencyKey]);
    return result.rows[0] as Row | undefined;
  }

  private safePayable(row: Row) {
    const { customer_rate, margin, margin_amount, margin_percent, provider_destination_reference, storage_key, internal_notes, ...safe } = row;
    return safe;
  }

  private safeInstruction(row: Row) {
    const { provider_destination_reference, provider_secret, storage_key, internal_notes, ...safe } = row;
    return safe;
  }

  private sourceFingerprint(parts: unknown[]) {
    return Buffer.from(parts.map((part) => String(part)).join("|")).toString("base64url").slice(0, 64);
  }

  private positive(value: unknown, label: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new BadRequestException(`${label} must be positive`);
    return parsed;
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
