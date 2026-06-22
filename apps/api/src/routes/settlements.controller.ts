import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { findTenantRecordById, insertTenantRecord, listTenantRecords, updateTenantRecord } from "@syncos/database";
import { executeWriteAction, type WriteActionResult } from "@syncos/shared";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";
import { pick, requireAllowed, requireString } from "./intelligence.types";

const contractStatuses = new Set(["draft", "active", "expired", "archived"]);
const rateScheduleStatuses = new Set(["draft", "active", "archived"]);
const rateCodeStatuses = new Set(["active", "archived"]);
const settlementStatuses = new Set([
  "draft",
  "assembling",
  "ready_for_review",
  "under_review",
  "approved",
  "rejected",
  "held",
  "disputed",
  "invoice_ready",
  "payable_ready",
  "invoice_created_later",
  "payable_created_later",
  "voided",
  "archived",
  "internal_review",
  "ready_to_submit",
  "submitted",
  "customer_review",
]);
const settlementTypes = new Set(["customer_billable", "contractor_payable", "mixed", "internal_adjustment", "retainage_release", "correction_adjustment", "chargeback"]);
const settlementItemStatuses = new Set(["draft", "ready", "held", "disputed", "approved", "invoice_ready", "payable_ready", "invoice_created_later", "payable_created_later", "voided", "archived", "active"]);
const settlementItemTypes = new Set(["customer_billable", "contractor_payable", "retainage_hold", "retainage_release", "deduction", "chargeback", "adjustment", "correction"]);
const readinessStatuses = new Set(["not_ready", "needs_review", "ready_with_warning", "ready_for_approval", "blocked"]);
const packageStatuses = new Set(["not_started", "incomplete", "ready", "submitted_later", "accepted_later", "rejected_later"]);
const acceptanceStatuses = new Set(["not_required", "pending", "accepted", "rejected", "correction_required", "disputed"]);
const activeSettlementItemStatuses = ["draft", "ready", "held", "disputed", "approved", "invoice_ready", "payable_ready", "active"];
const internalReviewRoles = new Set(["Billing Manager", "Finance Manager"]);
const readyToSubmitRoles = new Set(["Billing Manager"]);
const submitRoles = new Set(["Billing Manager", "Finance Manager"]);
const customerReviewRoles = new Set(["Customer Validator", "Billing Manager", "Finance Manager"]);
const disputeRoles = new Set(["Customer Validator", "Billing Manager", "Finance Manager"]);

@Controller()
export class SettlementsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("contracts")
  @RequirePermission("contract.read")
  async listContracts(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "contracts", request.auth.tenantId, { searchColumns: ["name", "contract_number", "contract_type", "status"] }));
  }

  @Get("contracts/:id")
  @RequirePermission("contract.read")
  async getContract(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "contracts", request.auth.tenantId, id, "contract not found"));
  }

  @Post("contracts")
  @RequirePermission("contract.create")
  async createContract(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "contract name is required");
      return await this.write(request, "contract.create", "contract.created", "contract", async (client) => {
        await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.organization_id, "organization_id"), "organization not found");
        if (body.opportunity_id) await this.requireRecord(client, "opportunities", request.auth.tenantId, this.requiredId(body.opportunity_id, "opportunity_id"), "opportunity not found");
        const contract = await insertTenantRecord(client, "contracts", request.auth.tenantId, {
          organization_id: body.organization_id,
          opportunity_id: body.opportunity_id,
          name,
          contract_number: body.contract_number,
          contract_type: body.contract_type,
          payment_terms_days: this.optionalNonNegative(body.payment_terms_days, "payment_terms_days"),
          retainage_percent: this.optionalPercent(body.retainage_percent, "retainage_percent"),
          status: body.status === undefined ? "draft" : requireAllowed(body.status, contractStatuses, "contract status"),
        });
        return { entityType: "contract", entityId: contract.id, afterState: contract };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("contracts/:id")
  @RequirePermission("contract.update")
  async updateContract(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["name", "contract_number", "contract_type"]);
      if (body.status !== undefined) values.status = requireAllowed(body.status, contractStatuses, "contract status");
      if (body.payment_terms_days !== undefined) values.payment_terms_days = this.optionalNonNegative(body.payment_terms_days, "payment_terms_days");
      if (body.retainage_percent !== undefined) values.retainage_percent = this.optionalPercent(body.retainage_percent, "retainage_percent");
      return await this.write(request, "contract.update", "contract.updated", "contract", async (client) => {
        const before = await this.requireRecord(client, "contracts", request.auth.tenantId, id, "contract not found");
        if (body.organization_id) {
          await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.organization_id, "organization_id"), "organization not found");
          values.organization_id = body.organization_id;
        }
        if (body.opportunity_id) {
          await this.requireRecord(client, "opportunities", request.auth.tenantId, this.requiredId(body.opportunity_id, "opportunity_id"), "opportunity not found");
          values.opportunity_id = body.opportunity_id;
        }
        const after = await updateTenantRecord(client, "contracts", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("contract not found");
        return { entityType: "contract", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("contracts/:id/archive")
  @RequirePermission("contract.archive")
  async archiveContract(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "contracts", id, "contract", "contract.archive", "contract.archived");
  }

  @Get("rate-schedules")
  @RequirePermission("rate_schedule.read")
  async listRateSchedules(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "rate_schedules", request.auth.tenantId, { searchColumns: ["name", "status"] }));
  }

  @Get("rate-schedules/:id")
  @RequirePermission("rate_schedule.read")
  async getRateSchedule(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "rate_schedules", request.auth.tenantId, id, "rate schedule not found"));
  }

  @Post("rate-schedules")
  @RequirePermission("rate_schedule.create")
  async createRateSchedule(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const name = requireString(body.name, "rate schedule name is required");
      const effectiveDate = requireString(body.effective_date, "effective_date is required");
      return await this.write(request, "rate_schedule.create", "rate_schedule.created", "rate_schedule", async (client) => {
        const contract = await this.requireRecord(client, "contracts", request.auth.tenantId, this.requiredId(body.contract_id, "contract_id"), "contract not found");
        const organizationId = body.organization_id ?? contract.organization_id;
        await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(organizationId, "organization_id"), "organization not found");
        const schedule = await insertTenantRecord(client, "rate_schedules", request.auth.tenantId, {
          contract_id: contract.id,
          organization_id: organizationId,
          name,
          effective_date: effectiveDate,
          status: body.status === undefined ? "draft" : requireAllowed(body.status, rateScheduleStatuses, "rate schedule status"),
        });
        return { entityType: "rate_schedule", entityId: schedule.id, afterState: schedule };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("rate-schedules/:id")
  @RequirePermission("rate_schedule.update")
  async updateRateSchedule(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["name", "effective_date"]);
      if (body.status !== undefined) values.status = requireAllowed(body.status, rateScheduleStatuses, "rate schedule status");
      return await this.write(request, "rate_schedule.update", "rate_schedule.updated", "rate_schedule", async (client) => {
        const before = await this.requireRecord(client, "rate_schedules", request.auth.tenantId, id, "rate schedule not found");
        if (body.contract_id) {
          await this.requireRecord(client, "contracts", request.auth.tenantId, this.requiredId(body.contract_id, "contract_id"), "contract not found");
          values.contract_id = body.contract_id;
        }
        if (body.organization_id) {
          await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.organization_id, "organization_id"), "organization not found");
          values.organization_id = body.organization_id;
        }
        const after = await updateTenantRecord(client, "rate_schedules", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("rate schedule not found");
        return { entityType: "rate_schedule", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("rate-schedules/:id/archive")
  @RequirePermission("rate_schedule.archive")
  async archiveRateSchedule(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "rate_schedules", id, "rate_schedule", "rate_schedule.archive", "rate_schedule.archived");
  }

  @Get("rate-codes")
  @RequirePermission("rate_code.read")
  async listRateCodes(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "rate_codes", request.auth.tenantId, { searchColumns: ["code", "description", "unit_type", "status"] }));
  }

  @Get("rate-codes/:id")
  @RequirePermission("rate_code.read")
  async getRateCode(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "rate_codes", request.auth.tenantId, id, "rate code not found"));
  }

  @Post("rate-codes")
  @RequirePermission("rate_code.create")
  async createRateCode(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      const code = requireString(body.code, "rate code is required");
      const description = requireString(body.description, "description is required");
      const unitType = requireString(body.unit_type ?? body.unit, "unit_type is required");
      const customerRate = this.requireNonNegative(body.customer_rate ?? body.amount, "customer_rate");
      return await this.write(request, "rate_code.create", "rate_code.created", "rate_code", async (client) => {
        await this.requireRecord(client, "rate_schedules", request.auth.tenantId, this.requiredId(body.rate_schedule_id, "rate_schedule_id"), "rate schedule not found");
        const rateCode = await insertTenantRecord(client, "rate_codes", request.auth.tenantId, {
          rate_schedule_id: body.rate_schedule_id,
          code,
          description,
          unit: unitType,
          unit_type: unitType,
          amount: customerRate,
          customer_rate: customerRate,
          contractor_rate: body.contractor_rate,
          margin_amount: body.margin_amount,
          margin_percent: body.margin_percent,
          status: "active",
        });
        return { entityType: "rate_code", entityId: rateCode.id, afterState: rateCode };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("rate-codes/:id")
  @RequirePermission("rate_code.update")
  async updateRateCode(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["code", "description", "contractor_rate", "margin_amount", "margin_percent"]);
      if (body.status !== undefined) values.status = requireAllowed(body.status, rateCodeStatuses, "rate code status");
      if (body.unit_type !== undefined || body.unit !== undefined) {
        const unitType = requireString(body.unit_type ?? body.unit, "unit_type is required");
        values.unit = unitType;
        values.unit_type = unitType;
      }
      if (body.customer_rate !== undefined || body.amount !== undefined) {
        const customerRate = this.requireNonNegative(body.customer_rate ?? body.amount, "customer_rate");
        values.amount = customerRate;
        values.customer_rate = customerRate;
      }
      return await this.write(request, "rate_code.update", "rate_code.updated", "rate_code", async (client) => {
        const before = await this.requireRecord(client, "rate_codes", request.auth.tenantId, id, "rate code not found");
        if (body.rate_schedule_id) {
          await this.requireRecord(client, "rate_schedules", request.auth.tenantId, this.requiredId(body.rate_schedule_id, "rate_schedule_id"), "rate schedule not found");
          values.rate_schedule_id = body.rate_schedule_id;
        }
        const after = await updateTenantRecord(client, "rate_codes", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("rate code not found");
        return { entityType: "rate_code", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("rate-codes/:id/archive")
  @RequirePermission("rate_code.archive")
  async archiveRateCode(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "rate_codes", id, "rate_code", "rate_code.archive", "rate_code.archived");
  }

  @Get("settlements")
  @RequirePermission("settlement.read")
  async listSettlements(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>) {
    return this.withClient(async (client) => {
      const rows = await this.listSettlementRows(client, request.auth.tenantId, query);
      return Promise.all(rows.map((row) => this.withSettlementReadiness(client, request.auth.tenantId, row)));
    });
  }

  @Get("settlements/:id")
  @RequirePermission("settlement.read")
  async getSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getSettlementRow(client, request.auth.tenantId, id));
  }

  @Get("settlements/:id/detail")
  @RequirePermission("settlement.read")
  async getSettlementDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.getSettlementDetailPayload(client, request.auth.tenantId, id));
  }

  @Post("settlements")
  @RequirePermission("settlement.create")
  async createSettlement(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      if (body.settlement_type !== undefined) return await this.createSettlementFoundation(request, body);
      const billingPeriodStart = requireString(body.billing_period_start, "billing_period_start is required");
      const billingPeriodEnd = requireString(body.billing_period_end, "billing_period_end is required");
      return await this.write(request, "settlement.create", "settlement.created", "settlement", async (client) => {
        const contract = await this.requireRecord(client, "contracts", request.auth.tenantId, this.requiredId(body.contract_id, "contract_id"), "contract not found");
        const customerOrganizationId = body.customer_organization_id ?? contract.organization_id;
        await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(customerOrganizationId, "customer_organization_id"), "customer organization not found");
        if (!(await this.billableProductionExists(client, request.auth.tenantId))) throw new BadRequestException("billable production is required");
        const totals = this.calculateTotals({
          gross_amount: body.gross_amount,
          retainage_amount: body.retainage_amount,
          adjustment_amount: body.adjustment_amount,
          chargeback_amount: body.chargeback_amount,
        });
        const settlement = await insertTenantRecord(client, "settlements", request.auth.tenantId, {
          contract_id: contract.id,
          customer_organization_id: customerOrganizationId,
          capacity_provider_id: body.capacity_provider_id,
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
          ...totals,
          total_amount: totals.gross_amount,
          status: "draft",
        });
        return { entityType: "settlement", entityId: settlement.id, afterState: settlement };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("settlements/:id")
  @RequirePermission("settlement.update")
  async updateSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.status !== undefined) throw new BadRequestException("status changes must use lifecycle action routes");
      const values = pick(body, ["billing_period_start", "billing_period_end", "dispute_reason"]);
      const hasTotals = ["gross_amount", "retainage_amount", "adjustment_amount", "chargeback_amount"].some((field) => body[field] !== undefined);
      return await this.write(request, "settlement.update", "settlement.updated", "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        if (body.contract_id) {
          await this.requireRecord(client, "contracts", request.auth.tenantId, this.requiredId(body.contract_id, "contract_id"), "contract not found");
          values.contract_id = body.contract_id;
        }
        if (body.customer_organization_id) {
          await this.requireRecord(client, "organizations", request.auth.tenantId, this.requiredId(body.customer_organization_id, "customer_organization_id"), "customer organization not found");
          values.customer_organization_id = body.customer_organization_id;
        }
        if (body.capacity_provider_id) {
          await this.requireRecord(client, "capacity_providers", request.auth.tenantId, this.requiredId(body.capacity_provider_id, "capacity_provider_id"), "capacity provider not found");
          values.capacity_provider_id = body.capacity_provider_id;
        }
        if (hasTotals) {
          Object.assign(values, this.calculateTotals({
            gross_amount: body.gross_amount ?? before.gross_amount,
            retainage_amount: body.retainage_amount ?? before.retainage_amount,
            adjustment_amount: body.adjustment_amount ?? before.adjustment_amount,
            chargeback_amount: body.chargeback_amount ?? before.chargeback_amount,
          }));
          values.total_amount = values.gross_amount;
        }
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/recalculate-readiness")
  @RequirePermission("settlement.recalculate_readiness")
  async recalculateSettlementReadiness(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement.recalculate_readiness", "settlement.readiness_recalculated", "settlement", async (client) => {
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      const readiness = await this.calculateSettlementReadiness(client, request.auth.tenantId, id, before);
      const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, {
        readiness_score: readiness.readiness_score,
        readiness_status: readiness.readiness_status,
        readiness_band: readiness.readiness_band,
      });
      if (!after) throw new NotFoundException("settlement not found");
      return { entityType: "settlement", entityId: id, beforeState: before, afterState: { ...after, ...readiness } };
    });
  }

  @Post("settlements/:id/submit-review")
  @RequirePermission("settlement.submit_review")
  async submitSettlementReview(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "settlement.submit_review", "settlement.review_submitted", "settlement", async (client) => {
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (!(await this.settlementHasItems(client, request.auth.tenantId, id))) throw new BadRequestException("settlement items are required");
      const readiness = await this.calculateSettlementReadiness(client, request.auth.tenantId, id, before);
      if (readiness.blockers.length && !this.hasOverride(body.override_reasons)) throw new BadRequestException("settlement readiness blockers must be resolved before this action");
      const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, {
        status: "ready_for_review",
        readiness_score: readiness.readiness_score,
        readiness_status: readiness.readiness_status,
        readiness_band: readiness.readiness_band,
        override_reasons: this.mergeOverrideReasons(before.override_reasons, body.override_reasons),
      });
      if (!after) throw new NotFoundException("settlement not found");
      return { entityType: "settlement", entityId: id, beforeState: before, afterState: { ...after, ...readiness } };
    });
  }

  @Post("settlements/:id/start-review")
  @RequirePermission("settlement.start_review")
  async startSettlementReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement.start_review", "settlement.review_started", "settlement", async (client) => {
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (before.status !== "ready_for_review") throw new BadRequestException("settlement must be ready_for_review");
      return this.updateSettlementStatus(client, request, before, id, "under_review");
    });
  }

  @Post("settlements/:id/internal-review")
  @RequirePermission("settlement.internal_review")
  async internalReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement.internal_review", "settlement.internal_review_started", "settlement", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, internalReviewRoles, "Billing Manager or Finance Manager authority is required");
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (before.status !== "draft") throw new BadRequestException("settlement must be draft");
      if (!(await this.settlementHasItems(client, request.auth.tenantId, id))) throw new BadRequestException("settlement items are required");
      if (Number(before.gross_amount) <= 0) throw new BadRequestException("settlement gross_amount must be > 0");
      return this.updateSettlementStatus(client, request, before, id, "internal_review");
    });
  }

  @Post("settlements/:id/ready-to-submit")
  @RequirePermission("settlement.ready_to_submit")
  async readyToSubmit(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement.ready_to_submit", "settlement.ready_to_submit", "settlement", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, readyToSubmitRoles, "Billing Manager authority is required");
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (before.status !== "internal_review") throw new BadRequestException("settlement must be internal_review");
      return this.updateSettlementStatus(client, request, before, id, "ready_to_submit");
    });
  }

  @Post("settlements/:id/submit")
  @RequirePermission("settlement.submit")
  async submitSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement.submit", "settlement.submitted", "settlement", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, submitRoles, "Billing Manager or Finance Manager authority is required");
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (before.status !== "ready_to_submit") throw new BadRequestException("settlement must be ready_to_submit");
      return this.updateSettlementStatus(client, request, before, id, "submitted");
    });
  }

  @Post("settlements/:id/customer-review")
  @RequirePermission("settlement.customer_review")
  async customerReview(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement.customer_review", "settlement.customer_review_started", "settlement", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, customerReviewRoles, "Customer Validator or internal review authority is required");
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (before.status !== "submitted") throw new BadRequestException("settlement must be submitted");
      return this.updateSettlementStatus(client, request, before, id, "customer_review");
    });
  }

  @Post("settlements/:id/approve")
  @RequirePermission("settlement.approve")
  async approveSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.write(request, "settlement.approve", "settlement.approved", "settlement", async (client) => {
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (before.status === "customer_review") {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, customerReviewRoles, "Customer Validator or internal review authority is required");
        return this.updateSettlementStatus(client, request, before, id, "approved");
      }
      if (typeof body.approval_note !== "string" || !body.approval_note.trim()) throw new BadRequestException("approval_note is required");
      if (before.status !== "under_review" && before.status !== "ready_for_review") throw new BadRequestException("settlement must be under_review");
      const readiness = await this.calculateSettlementReadiness(client, request.auth.tenantId, id, before);
      if (readiness.blockers.length && !this.hasOverride(body.override_reasons)) throw new BadRequestException("settlement readiness blockers must be resolved before this action");
      if ((readiness.warnings.length || readiness.readiness_score < 85) && !this.hasOverride(body.override_reasons)) throw new BadRequestException("settlement warnings require override reasons");
      const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, {
        status: "approved",
        approved_by: request.auth.userId,
        approved_at: new Date(),
        readiness_score: readiness.readiness_score,
        readiness_status: readiness.readiness_status,
        readiness_band: readiness.readiness_band,
        override_reasons: this.mergeOverrideReasons(before.override_reasons, body.override_reasons),
      });
      if (!after) throw new NotFoundException("settlement not found");
      return { entityType: "settlement", entityId: id, beforeState: before, afterState: { ...after, ...readiness } };
    }, body.approval_note);
  }

  @Post("settlements/:id/reject")
  @RequirePermission("settlement.reject")
  async rejectSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.rejection_reason, "rejection_reason is required");
      return await this.write(request, "settlement.reject", "settlement.rejected", "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, {
          status: "rejected",
          rejected_by: request.auth.userId,
          rejected_at: new Date(),
          rejection_reason: reason,
          rejection_note: body.rejection_note,
        });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/mark-invoice-ready")
  @RequirePermission("settlement.mark_invoice_ready")
  async markSettlementInvoiceReady(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.markSettlementReadyFlag(request, id, body, "invoice");
  }

  @Post("settlements/:id/mark-payable-ready")
  @RequirePermission("settlement.mark_payable_ready")
  async markSettlementPayableReady(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.markSettlementReadyFlag(request, id, body, "payable");
  }

  @Post("settlements/:id/place-hold")
  @RequirePermission("settlement.place_hold")
  async placeSettlementHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.hold_reason, "hold_reason is required");
      return await this.write(request, "settlement.place_hold", "settlement.held", "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status: "held", hold_reason: reason, hold_note: body.hold_note });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/release-hold")
  @RequirePermission("settlement.release_hold")
  async releaseSettlementHold(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const note = requireString(body.release_note, "release_note is required");
      return await this.write(request, "settlement.release_hold", "settlement.hold_released", "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const readiness = await this.calculateSettlementReadiness(client, request.auth.tenantId, id, { ...before, status: "draft", hold_reason: null });
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status: this.statusAfterSettlementInterruption(before), hold_note: note, hold_reason: null, readiness_score: readiness.readiness_score, readiness_status: readiness.readiness_status, readiness_band: readiness.readiness_band });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: { ...after, ...readiness } };
      }, note);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/dispute")
  @RequirePermission("settlement.dispute")
  async disputeSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.reason ?? body.dispute_reason, "dispute reason is required");
      return await this.write(request, "settlement.dispute", "settlement.disputed", "settlement", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, disputeRoles, "Customer Validator, Billing Manager, or Finance Manager authority is required");
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status: "disputed", dispute_reason: reason, dispute_note: body.dispute_note });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/resolve-dispute")
  @RequirePermission("settlement.resolve_dispute")
  async resolveSettlementDispute(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const note = requireString(body.resolution_note, "resolution_note is required");
      return await this.write(request, "settlement.resolve_dispute", "settlement.dispute_resolved", "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const readiness = await this.calculateSettlementReadiness(client, request.auth.tenantId, id, { ...before, status: "draft", dispute_reason: null });
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, {
          status: this.statusAfterSettlementInterruption(before),
          dispute_note: note,
          dispute_reason: null,
          override_reasons: this.mergeOverrideReasons(before.override_reasons, body.override_reasons),
          readiness_score: readiness.readiness_score,
          readiness_status: readiness.readiness_status,
          readiness_band: readiness.readiness_band,
        });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: { ...after, ...readiness } };
      }, note);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/void")
  @RequirePermission("settlement.void")
  async voidSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.void_reason, "void_reason is required");
      return await this.write(request, "settlement.void", "settlement.voided", "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        if (before.status === "invoice_created_later" || before.status === "payable_created_later") throw new BadRequestException("settlement with future invoice or payable records cannot be voided");
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status: "voided", voided_by: request.auth.userId, voided_at: new Date(), void_reason: reason, void_note: body.void_note });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/archive")
  @RequirePermission("settlement.archive")
  async archiveSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.archive_reason, "archive_reason is required");
      return await this.write(request, "settlement.archive", "settlement.archived", "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status: "archived", archived_by: request.auth.userId, archived_at: new Date(), archive_reason: reason, archive_note: body.archive_note });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get("settlements/:id/items")
  @RequirePermission("settlement_item.read")
  async listSettlementItems(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      const result = await client.query("SELECT * FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC", [
        request.auth.tenantId,
        id,
      ]);
      return result.rows;
    });
  }

  @Get("settlement-items/:id")
  @RequirePermission("settlement_item.read")
  async getSettlementItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "settlement_items", request.auth.tenantId, id, "settlement item not found"));
  }

  @Get("settlement-items/:id/detail")
  @RequirePermission("settlement_item.read")
  async getSettlementItemDetail(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      const item = await this.requireRecord(client, "settlement_items", request.auth.tenantId, id, "settlement item not found");
      const settlement = await this.requireRecord(client, "settlements", request.auth.tenantId, String(item.settlement_id), "settlement not found");
      const billable = item.billable_item_id ? await this.optionalRecord(client, "billable_items", request.auth.tenantId, String(item.billable_item_id)) : null;
      const qc = item.qc_review_id ? await this.optionalRecord(client, "qc_reviews", request.auth.tenantId, String(item.qc_review_id)) : null;
      const production = item.production_record_id ? await this.optionalRecord(client, "production_records", request.auth.tenantId, String(item.production_record_id)) : null;
      const workOrder = item.work_order_id ? await this.optionalRecord(client, "work_orders", request.auth.tenantId, String(item.work_order_id)) : null;
      const project = item.project_id ? await this.optionalRecord(client, "projects", request.auth.tenantId, String(item.project_id)) : null;
      return {
        item,
        settlement_context: settlement,
        billable_context: billable,
        qc_context: qc,
        production_context: production,
        work_order_context: workOrder,
        project_context: project,
        financial_breakdown: this.itemFinancialBreakdown(item),
        margin_breakdown: this.itemMarginBreakdown(item),
      };
    });
  }

  @Post("settlements/:id/items")
  @RequirePermission("settlement_item.create")
  async createSettlementItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      if (body.billable_item_id !== undefined) return await this.createSettlementItemFromBillable(request, id, body);
      const quantity = this.requireNonNegative(body.quantity, "quantity");
      const unitRate = this.requireNonNegative(body.unit_rate, "unit_rate");
      const grossAmount = body.gross_amount === undefined ? quantity * unitRate : this.requireNonNegative(body.gross_amount, "gross_amount");
      return await this.write(request, "settlement_item.create", "settlement_item.created", "settlement_item", async (client) => {
        await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const productionRecord = await this.requireBillableProduction(client, request.auth.tenantId, body.production_record_id);
        const rateCode = await this.requireRateCodeForProduction(client, request.auth.tenantId, body.rate_code_id, String(productionRecord.unit_type));
        const item = await insertTenantRecord(client, "settlement_items", request.auth.tenantId, {
          settlement_id: id,
          production_record_id: productionRecord.id,
          rate_code_id: rateCode.id,
          quantity,
          unit_rate: unitRate,
          gross_amount: grossAmount,
          amount: grossAmount,
          description: body.description,
          status: "active",
        });
        await this.recalculateSettlementTotals(client, request.auth.tenantId, id);
        return { entityType: "settlement_item", entityId: item.id, afterState: item };
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Patch("settlement-items/:id")
  @RequirePermission("settlement_item.update")
  async updateSettlementItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const values = pick(body, ["description", "hold_reason", "hold_note", "dispute_reason", "dispute_note", "billing_package_status", "documentation_status", "customer_acceptance_status", "prime_acceptance_status"]);
      if (body.status !== undefined) values.status = requireAllowed(body.status, settlementItemStatuses, "settlement item status");
      if (body.quantity !== undefined) values.quantity = this.requireNonNegative(body.quantity, "quantity");
      if (body.unit_rate !== undefined) values.unit_rate = this.requireNonNegative(body.unit_rate, "unit_rate");
      if (body.contractor_rate !== undefined) values.contractor_rate = this.requireNonNegative(body.contractor_rate, "contractor_rate");
      if (body.retainage_percent !== undefined) values.retainage_percent = this.optionalPercent(body.retainage_percent, "retainage_percent");
      if (body.deduction_amount !== undefined) values.deduction_amount = this.requireNonNegative(body.deduction_amount, "deduction_amount");
      if (body.chargeback_amount !== undefined) values.chargeback_amount = this.requireNonNegative(body.chargeback_amount, "chargeback_amount");
      return await this.write(request, "settlement_item.update", "settlement_item.updated", "settlement_item", async (client) => {
        const before = await this.requireRecord(client, "settlement_items", request.auth.tenantId, id, "settlement item not found");
        if (body.production_record_id) {
          const productionRecord = await this.requireBillableProduction(client, request.auth.tenantId, body.production_record_id);
          values.production_record_id = productionRecord.id;
        }
        const productionRecord = before.billable_item_id ? null : await this.requireBillableProduction(client, request.auth.tenantId, values.production_record_id ?? before.production_record_id);
        if (body.rate_code_id) {
          if (!productionRecord) throw new BadRequestException("rate_code_id updates are only supported for legacy settlement items");
          const rateCode = await this.requireRateCodeForProduction(client, request.auth.tenantId, body.rate_code_id, String(productionRecord.unit_type));
          values.rate_code_id = rateCode.id;
        }
        Object.assign(values, this.calculateSettlementItemAmounts({ ...before, ...values, gross_amount: body.gross_amount }));
        const after = await updateTenantRecord(client, "settlement_items", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("settlement item not found");
        await this.recalculateSettlementTotals(client, request.auth.tenantId, String(after.settlement_id));
        return { entityType: "settlement_item", entityId: id, beforeState: before, afterState: after };
      }, body.reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlement-items/:id/void")
  @RequirePermission("settlement_item.void")
  async voidSettlementItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.void_reason, "void_reason is required");
      return await this.write(request, "settlement_item.void", "settlement_item.voided", "settlement_item", async (client) => {
        const before = await this.requireRecord(client, "settlement_items", request.auth.tenantId, id, "settlement item not found");
        if (before.invoice_item_id || before.payable_item_id) throw new BadRequestException("settlement item with future invoice or payable records cannot be voided");
        const after = await updateTenantRecord(client, "settlement_items", request.auth.tenantId, id, { status: "voided", voided_by: request.auth.userId, voided_at: new Date(), void_reason: reason, void_note: body.void_note });
        if (!after) throw new NotFoundException("settlement item not found");
        await this.recalculateSettlementTotals(client, request.auth.tenantId, String(before.settlement_id));
        return {
          entityType: "settlement_item",
          entityId: id,
          beforeState: before,
          afterState: after,
          additionalEvents: [this.additionalEvent("settlement.remove_item", "settlement", String(before.settlement_id), "settlement.item_removed", { settlement_item_id: id })],
        };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlement-items/:id/archive")
  @RequirePermission("settlement_item.archive")
  async archiveSettlementItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.archive_reason, "archive_reason is required");
      return await this.write(request, "settlement_item.archive", "settlement_item.archived", "settlement_item", async (client) => {
        const before = await this.requireRecord(client, "settlement_items", request.auth.tenantId, id, "settlement item not found");
        const after = await updateTenantRecord(client, "settlement_items", request.auth.tenantId, id, { status: "archived", archived_by: request.auth.userId, archived_at: new Date(), archive_reason: reason, archive_note: body.archive_note, deleted_at: new Date() });
        if (!after) throw new NotFoundException("settlement item not found");
        await this.recalculateSettlementTotals(client, request.auth.tenantId, String(before.settlement_id));
        return { entityType: "settlement_item", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get("settlements/:id/timeline")
  @RequirePermission("settlement.timeline.read")
  async getSettlementTimeline(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      const itemIds = await client.query("SELECT id FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2", [request.auth.tenantId, id]);
      const result = await client.query(
        `
        SELECT e.event_type, e.actor_user_id AS actor, e.occurred_at AS timestamp, e.aggregate_type AS object_type, e.aggregate_id AS object_id, e.event_type AS summary, ep.payload
        FROM events e
        LEFT JOIN event_payloads ep ON ep.event_id = e.id
        WHERE e.tenant_id = $1
          AND (
            (e.aggregate_type = 'settlement' AND e.aggregate_id = $2)
            OR (e.aggregate_type = 'settlement_item' AND e.aggregate_id = ANY($3::uuid[]))
          )
        ORDER BY e.occurred_at DESC
        `,
        [request.auth.tenantId, id, itemIds.rows.map((row) => row.id)],
      );
      return result.rows;
    });
  }

  @Get("settlements/:id/audit-summary")
  @RequirePermission("settlement.audit.read")
  async getSettlementAuditSummary(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient(async (client) => {
      await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      const itemIds = await client.query("SELECT id FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2", [request.auth.tenantId, id]);
      const result = await client.query(
        `
        SELECT actor_user_id AS actor, action, entity_type AS object_type, entity_id AS object, before_state AS before, after_state AS after, metadata->>'reason' AS reason, created_at AS timestamp, request_id AS correlation_id
        FROM audit_logs
        WHERE tenant_id = $1
          AND (
            (entity_type = 'settlement' AND entity_id = $2)
            OR (entity_type = 'settlement_item' AND entity_id = ANY($3::uuid[]))
          )
        ORDER BY created_at DESC
        `,
        [request.auth.tenantId, id, itemIds.rows.map((row) => row.id)],
      );
      return result.rows;
    });
  }

  private async updateSettlementStatus(client: PoolClient, request: AuthenticatedRequest, before: Record<string, unknown>, id: string, status: string) {
    const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status });
    if (!after) throw new NotFoundException("settlement not found");
    return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
  }

  private async createSettlementFoundation(request: AuthenticatedRequest, body: Record<string, unknown>) {
    const settlementType = requireAllowed(body.settlement_type, settlementTypes, "settlement_type");
    return this.write(request, "settlement.create", "settlement.created", "settlement", async (client) => {
      await this.validateOptionalTenantRefs(client, request.auth.tenantId, body);
      const settlementNumber = typeof body.settlement_number === "string" && body.settlement_number.trim() ? body.settlement_number.trim() : await this.nextSettlementNumber(client, request.auth.tenantId);
      await this.ensureSettlementNumberAvailable(client, request.auth.tenantId, settlementNumber);
      const settlement = await insertTenantRecord(client, "settlements", request.auth.tenantId, {
        settlement_number: settlementNumber,
        settlement_type: settlementType,
        status: "draft",
        readiness_status: "not_ready",
        readiness_score: 0,
        readiness_band: "not_ready",
        customer_organization_id: body.customer_organization_id,
        capacity_provider_id: body.capacity_provider_id,
        project_id: body.project_id,
        work_order_id: body.work_order_id,
        settlement_period_start: body.settlement_period_start,
        settlement_period_end: body.settlement_period_end,
        billing_period_start: body.settlement_period_start,
        billing_period_end: body.settlement_period_end,
        invoice_cycle: body.invoice_cycle,
        pay_cycle: body.pay_cycle,
        gross_amount: 0,
        gross_billable_amount: 0,
        contractor_payable_amount: 0,
        retainage_amount: 0,
        adjustment_amount: 0,
        deduction_amount: 0,
        chargeback_amount: 0,
        net_amount: 0,
        net_settlement_amount: 0,
        total_amount: 0,
        invoice_ready: false,
        payable_ready: false,
        override_reasons: this.asObject(body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
      });
      return { entityType: "settlement", entityId: settlement.id, afterState: settlement };
    });
  }

  private async createSettlementItemFromBillable(request: AuthenticatedRequest, settlementId: string, body: Record<string, unknown>) {
    const quantity = this.requirePositive(body.quantity, "quantity");
    const itemType = requireAllowed(body.item_type, settlementItemTypes, "item_type");
    return this.write(request, "settlement_item.create", "settlement_item.created", "settlement_item", async (client) => {
      const settlement = await this.requireRecord(client, "settlements", request.auth.tenantId, settlementId, "settlement not found");
      const billable = await this.requireRecord(client, "billable_items", request.auth.tenantId, this.requiredId(body.billable_item_id, "billable_item_id"), "billable item not found");
      if (billable.status !== "ready_for_settlement" && !this.hasOverride(body.override_reasons)) throw new BadRequestException("billable_item must be ready_for_settlement");
      if (billable.status === "voided" || billable.status === "archived") throw new BadRequestException("billable_item is not eligible for settlement");
      if (!(await this.billableItemCanBeAdded(client, request.auth.tenantId, String(billable.id))) && !this.hasOverride(body.override_reasons)) throw new BadRequestException("duplicate active settlement item for billable_item");
      if (quantity > Number(billable.billable_quantity ?? 0) && !this.hasOverride(body.override_reasons)) throw new BadRequestException("quantity cannot exceed billable quantity without override");
      this.requireSettlementTypeCompatibility(String(settlement.settlement_type ?? "customer_billable"), itemType);
      const amounts = this.calculateSettlementItemAmounts({
        quantity,
        unit_rate: body.unit_rate ?? billable.unit_rate,
        contractor_rate: body.contractor_rate,
        retainage_percent: body.retainage_percent ?? billable.retainage_percent,
        deduction_amount: body.deduction_amount,
        chargeback_amount: body.chargeback_amount,
      });
      const item = await insertTenantRecord(client, "settlement_items", request.auth.tenantId, {
        settlement_id: settlementId,
        billable_item_id: billable.id,
        project_id: billable.project_id,
        work_order_id: billable.work_order_id,
        production_record_id: billable.production_record_id,
        qc_review_id: billable.qc_review_id,
        customer_organization_id: billable.customer_organization_id,
        capacity_provider_id: billable.capacity_provider_id,
        crew_id: billable.crew_id,
        item_type: itemType,
        status: "draft",
        quantity,
        unit: billable.unit,
        unit_rate: body.unit_rate ?? billable.unit_rate,
        contractor_rate: body.contractor_rate,
        retainage_percent: body.retainage_percent ?? billable.retainage_percent,
        billing_package_status: body.billing_package_status ?? billable.billing_package_status ?? "not_started",
        documentation_status: body.documentation_status ?? billable.documentation_status ?? "not_started",
        customer_acceptance_status: body.customer_acceptance_status ?? billable.customer_acceptance_status ?? "not_required",
        prime_acceptance_status: body.prime_acceptance_status ?? billable.prime_acceptance_status ?? "not_required",
        override_reasons: this.mergeOverrideReasons(billable.override_reasons, body.override_reasons),
        created_by: request.auth.userId,
        updated_by: request.auth.userId,
        ...amounts,
      });
      await this.recalculateSettlementTotals(client, request.auth.tenantId, settlementId);
      return {
        entityType: "settlement_item",
        entityId: item.id,
        afterState: item,
        additionalEvents: [this.additionalEvent("settlement.add_item", "settlement", settlementId, "settlement.item_added", { settlement_item_id: item.id, billable_item_id: billable.id })],
      };
    });
  }

  private async markSettlementReadyFlag(request: AuthenticatedRequest, id: string, body: Record<string, unknown>, mode: "invoice" | "payable") {
    try {
      const note = requireString(body.ready_note, "ready_note is required");
      return await this.write(request, `settlement.mark_${mode}_ready`, `settlement.${mode}_ready`, "settlement", async (client) => {
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        if (before.status !== "approved") throw new BadRequestException("settlement must be approved");
        const itemType = mode === "invoice" ? "customer_billable" : "contractor_payable";
        if (!(await this.settlementHasItemType(client, request.auth.tenantId, id, itemType))) throw new BadRequestException(`settlement has no ${itemType} items`);
        const futureLink = mode === "invoice" ? "invoice_item_id" : "payable_item_id";
        if (await this.settlementHasFutureLink(client, request.auth.tenantId, id, futureLink)) throw new BadRequestException(`${mode} records already exist`);
        const values = mode === "invoice" ? { invoice_ready: true, status: "invoice_ready" } : { payable_ready: true, status: "payable_ready" };
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, values);
        if (!after) throw new NotFoundException("settlement not found");
        await client.query(`UPDATE settlement_items SET status = $1, updated_at = now() WHERE tenant_id = $2 AND settlement_id = $3 AND item_type = $4 AND status <> ALL($5::text[])`, [
          mode === "invoice" ? "invoice_ready" : "payable_ready",
          request.auth.tenantId,
          id,
          itemType,
          ["voided", "archived"],
        ]);
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, note);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  private async listSettlementRows(client: PoolClient, tenantId: string, query: Record<string, string | undefined>) {
    const filters: string[] = ["s.tenant_id = $1", "s.deleted_at IS NULL"];
    const values: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      filters.push(sql.replace("?", `$${values.length}`));
    };
    for (const field of ["settlement_type", "status", "readiness_status", "customer_organization_id", "capacity_provider_id", "project_id", "work_order_id"] as const) {
      if (query[field]) add(`s.${field} = ?`, query[field]);
    }
    if (query.invoice_ready === "true" || query.invoice_ready === "false") add("s.invoice_ready = ?", query.invoice_ready === "true");
    if (query.payable_ready === "true" || query.payable_ready === "false") add("s.payable_ready = ?", query.payable_ready === "true");
    if (query.has_hold === "true") filters.push("s.hold_reason IS NOT NULL");
    if (query.has_hold === "false") filters.push("s.hold_reason IS NULL");
    if (query.has_dispute === "true") filters.push("s.dispute_reason IS NOT NULL");
    if (query.has_dispute === "false") filters.push("s.dispute_reason IS NULL");
    if (query.archived !== "true") filters.push("(s.archived_at IS NULL AND s.status <> 'archived')");
    if (query.q) {
      values.push(`%${query.q}%`);
      filters.push(`(s.settlement_number ILIKE $${values.length} OR s.status ILIKE $${values.length} OR s.hold_reason ILIKE $${values.length} OR s.dispute_reason ILIKE $${values.length} OR co.name ILIKE $${values.length} OR cp.name ILIKE $${values.length} OR p.name ILIKE $${values.length} OR wo.work_order_name ILIKE $${values.length})`);
    }
    const order = this.settlementSort(query.sort);
    const result = await client.query(
      `
      SELECT s.*,
        co.name AS customer_organization_name,
        cp.name AS capacity_provider_name,
        p.name AS project_name,
        coalesce(wo.work_order_name, wo.title) AS work_order_name,
        coalesce(count(si.id) FILTER (WHERE si.status <> ALL($${values.length + 1}::text[]) AND si.deleted_at IS NULL), 0)::int AS item_count,
        coalesce(count(si.id) FILTER (WHERE si.item_type = 'customer_billable' AND si.status <> ALL($${values.length + 1}::text[]) AND si.deleted_at IS NULL), 0)::int AS customer_billable_item_count,
        coalesce(count(si.id) FILTER (WHERE si.item_type = 'contractor_payable' AND si.status <> ALL($${values.length + 1}::text[]) AND si.deleted_at IS NULL), 0)::int AS contractor_payable_item_count
      FROM settlements s
      LEFT JOIN organizations co ON co.tenant_id = s.tenant_id AND co.id = s.customer_organization_id
      LEFT JOIN capacity_providers cp ON cp.tenant_id = s.tenant_id AND cp.id = s.capacity_provider_id
      LEFT JOIN projects p ON p.tenant_id = s.tenant_id AND p.id = s.project_id
      LEFT JOIN work_orders wo ON wo.tenant_id = s.tenant_id AND wo.id = s.work_order_id
      LEFT JOIN settlement_items si ON si.tenant_id = s.tenant_id AND si.settlement_id = s.id
      WHERE ${filters.join(" AND ")}
      GROUP BY s.id, co.name, cp.name, p.name, wo.work_order_name, wo.title
      ${order}
      `,
      [...values, ["voided", "archived"]],
    );
    return result.rows;
  }

  private async getSettlementRow(client: PoolClient, tenantId: string, id: string) {
    const rows = await this.listSettlementRows(client, tenantId, { archived: "true" });
    const row = rows.find((settlement) => settlement.id === id);
    if (!row) throw new NotFoundException("settlement not found");
    return this.withSettlementReadiness(client, tenantId, row);
  }

  private async getSettlementDetailPayload(client: PoolClient, tenantId: string, id: string) {
    const settlement = (await this.getSettlementRow(client, tenantId, id)) as Record<string, unknown>;
    const items = await this.settlementItems(client, tenantId, id);
    const readiness = await this.calculateSettlementReadiness(client, tenantId, id, settlement);
    return {
      settlement,
      settlement_items: items,
      customer_context: settlement.customer_organization_id ? await this.optionalRecord(client, "organizations", tenantId, String(settlement.customer_organization_id)) : null,
      provider_context: settlement.capacity_provider_id ? await this.optionalRecord(client, "capacity_providers", tenantId, String(settlement.capacity_provider_id)) : null,
      project_context: settlement.project_id ? await this.optionalRecord(client, "projects", tenantId, String(settlement.project_id)) : null,
      work_order_context: settlement.work_order_id ? await this.optionalRecord(client, "work_orders", tenantId, String(settlement.work_order_id)) : null,
      financial_summary: this.settlementFinancialSummary(settlement),
      readiness,
      warnings: readiness.warnings,
      blockers: readiness.blockers,
      required_override_fields: readiness.required_override_fields,
      recommended_next_action: readiness.recommended_next_action,
      invoice_readiness_summary: { invoice_ready: settlement.invoice_ready, customer_billable_item_count: settlement.customer_billable_item_count },
      payable_readiness_summary: { payable_ready: settlement.payable_ready, contractor_payable_item_count: settlement.contractor_payable_item_count },
      margin_summary: { estimated_margin_amount: settlement.estimated_margin_amount, estimated_margin_percent: settlement.estimated_margin_percent },
      retainage_summary: { retainage_amount: settlement.retainage_amount },
      deduction_chargeback_summary: { deduction_amount: settlement.deduction_amount, chargeback_amount: settlement.chargeback_amount },
      timeline_available: true,
      audit_allowed: true,
    };
  }

  private async withSettlementReadiness(client: PoolClient, tenantId: string, row: Record<string, unknown>) {
    const readiness = await this.calculateSettlementReadiness(client, tenantId, String(row.id), row);
    return { ...row, ...readiness };
  }

  private async calculateSettlementReadiness(client: PoolClient, tenantId: string, settlementId: string, settlement: Record<string, unknown>) {
    const items = await this.settlementItems(client, tenantId, settlementId);
    const warnings = new Set<string>();
    const blockers = new Set<string>();
    const required = new Set<string>();
    if (!items.length) blockers.add("no_settlement_items");
    if (settlement.status === "held" || settlement.hold_reason) blockers.add("settlement_held");
    if (settlement.status === "disputed" || settlement.dispute_reason) blockers.add("settlement_disputed");
    if (settlement.status === "voided") blockers.add("settlement_voided");
    if (settlement.status === "archived") blockers.add("settlement_archived");
    for (const item of items) {
      if (Number(item.quantity) <= 0) blockers.add("invalid_quantity");
      if (item.billable_item_id && item.billable_status !== "ready_for_settlement") blockers.add("billable_item_not_ready");
      if (item.invoice_item_id) blockers.add("invoice_already_created");
      if (item.payable_item_id) blockers.add("payable_already_created");
      if (item.item_type === "customer_billable" && item.unit_rate === null) {
        blockers.add("missing_customer_rate_for_customer_billable");
        required.add("customer_rate_override_reason");
      }
      if (item.item_type === "contractor_payable" && item.contractor_rate === null) {
        blockers.add("missing_contractor_rate_for_payable");
        required.add("contractor_rate_override_reason");
      }
      if (item.billing_package_status !== "ready") warnings.add("billing_package_incomplete");
      if (item.documentation_status !== "ready") warnings.add("documentation_incomplete");
      if (item.customer_acceptance_status === "pending") warnings.add("customer_acceptance_pending");
      if (item.prime_acceptance_status === "pending") warnings.add("prime_acceptance_pending");
      if (item.customer_acceptance_status === "rejected") blockers.add("customer_rejected");
      if (item.prime_acceptance_status === "rejected") blockers.add("prime_rejected");
      if (Number(item.retainage_amount ?? 0) > 0) warnings.add("retainage_applies");
      if (Number(item.deduction_amount ?? 0) > 0) warnings.add("deduction_applies");
      if (Number(item.chargeback_amount ?? 0) > 0) warnings.add("chargeback_applies");
      if (item.margin_amount === null) warnings.add("margin_unknown");
      if (item.margin_amount !== null && Number(item.margin_amount) < 0) warnings.add("negative_margin");
    }
    const duplicate = await client.query(
      `SELECT billable_item_id FROM settlement_items WHERE tenant_id = $1 AND billable_item_id IS NOT NULL AND status <> ALL($2::text[]) AND deleted_at IS NULL GROUP BY billable_item_id HAVING count(*) > 1`,
      [tenantId, ["voided", "archived"]],
    );
    if (duplicate.rows.length) blockers.add("duplicate_billable_item");
    const completeChecks = [
      items.length > 0,
      !blockers.has("billable_item_not_ready"),
      !blockers.has("duplicate_billable_item"),
      !blockers.has("invalid_quantity"),
      !blockers.has("missing_customer_rate_for_customer_billable"),
      !blockers.has("missing_contractor_rate_for_payable"),
      !warnings.has("billing_package_incomplete"),
      !warnings.has("documentation_incomplete"),
      !warnings.has("customer_acceptance_pending"),
      !warnings.has("prime_acceptance_pending"),
      !blockers.has("settlement_held"),
      !blockers.has("settlement_disputed"),
      !blockers.has("invoice_already_created"),
      !blockers.has("payable_already_created"),
    ];
    let score = Math.round((completeChecks.filter(Boolean).length / completeChecks.length) * 100);
    if (blockers.size) score = Math.min(score, 39);
    else if (warnings.size) score = Math.min(score, 84);
    const readinessStatus = blockers.size ? "blocked" : score >= 85 ? "ready_for_approval" : score >= 70 ? "ready_with_warning" : score >= 40 ? "needs_review" : "not_ready";
    return {
      readiness_score: score,
      readiness_status: readinessStatus,
      readiness_band: readinessStatus === "ready_for_approval" ? "ready_for_approval" : readinessStatus,
      warnings: Array.from(warnings),
      blockers: Array.from(blockers),
      required_override_fields: Array.from(required),
      recommended_next_action: this.recommendedSettlementAction(String(settlement.status), score, blockers.size, items.length, Boolean(settlement.invoice_ready), Boolean(settlement.payable_ready), String(settlement.settlement_type ?? "")),
    };
  }

  private async archiveRecord(request: AuthenticatedRequest, table: string, id: string, entityType: string, action: string, eventType: string) {
    return this.write(request, action, eventType, entityType, async (client) => {
      const before = await this.requireRecord(client, table, request.auth.tenantId, id, `${entityType} not found`);
      const after = await updateTenantRecord(client, table, request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException(`${entityType} not found`);
      return { entityType, entityId: id, beforeState: before, afterState: after };
    });
  }

  private async optionalRecord(client: PoolClient, table: string, tenantId: string, id: string) {
    return findTenantRecordById(client, table, tenantId, id);
  }

  private async validateOptionalTenantRefs(client: PoolClient, tenantId: string, body: Record<string, unknown>) {
    if (body.customer_organization_id) await this.requireRecord(client, "organizations", tenantId, this.requiredId(body.customer_organization_id, "customer_organization_id"), "customer organization not found");
    if (body.capacity_provider_id) await this.requireRecord(client, "capacity_providers", tenantId, this.requiredId(body.capacity_provider_id, "capacity_provider_id"), "capacity provider not found");
    if (body.project_id) await this.requireRecord(client, "projects", tenantId, this.requiredId(body.project_id, "project_id"), "project not found");
    if (body.work_order_id) await this.requireRecord(client, "work_orders", tenantId, this.requiredId(body.work_order_id, "work_order_id"), "work order not found");
  }

  private async nextSettlementNumber(client: PoolClient, tenantId: string) {
    const result = await client.query("SELECT count(*)::int + 1 AS next_number FROM settlements WHERE tenant_id = $1", [tenantId]);
    return `SET-${String(result.rows[0].next_number).padStart(6, "0")}`;
  }

  private async ensureSettlementNumberAvailable(client: PoolClient, tenantId: string, settlementNumber: string) {
    const result = await client.query("SELECT 1 FROM settlements WHERE tenant_id = $1 AND settlement_number = $2 AND deleted_at IS NULL LIMIT 1", [tenantId, settlementNumber]);
    if (result.rows[0]) throw new BadRequestException("settlement_number must be unique");
  }

  private requireSettlementTypeCompatibility(settlementType: string, itemType: string) {
    if (settlementType === "customer_billable" && itemType === "contractor_payable") throw new BadRequestException("settlement_type is not compatible with item_type");
    if (settlementType === "contractor_payable" && itemType === "customer_billable") throw new BadRequestException("settlement_type is not compatible with item_type");
  }

  private async billableItemCanBeAdded(client: PoolClient, tenantId: string, billableItemId: string) {
    const result = await client.query(
      "SELECT 1 FROM settlement_items WHERE tenant_id = $1 AND billable_item_id = $2 AND status <> ALL($3::text[]) AND deleted_at IS NULL LIMIT 1",
      [tenantId, billableItemId, ["voided", "archived"]],
    );
    return !result.rows[0];
  }

  private async settlementHasItemType(client: PoolClient, tenantId: string, settlementId: string, itemType: string) {
    const result = await client.query(
      "SELECT 1 FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND item_type = $3 AND status <> ALL($4::text[]) AND deleted_at IS NULL LIMIT 1",
      [tenantId, settlementId, itemType, ["voided", "archived"]],
    );
    return Boolean(result.rows[0]);
  }

  private async settlementHasFutureLink(client: PoolClient, tenantId: string, settlementId: string, column: string) {
    const result = await client.query(`SELECT 1 FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND ${column} IS NOT NULL AND deleted_at IS NULL LIMIT 1`, [tenantId, settlementId]);
    return Boolean(result.rows[0]);
  }

  private async settlementItems(client: PoolClient, tenantId: string, settlementId: string) {
    const result = await client.query(
      `
      SELECT si.*, bi.status AS billable_status, bi.billable_quantity AS source_billable_quantity
      FROM settlement_items si
      LEFT JOIN billable_items bi ON bi.tenant_id = si.tenant_id AND bi.id = si.billable_item_id
      WHERE si.tenant_id = $1
        AND si.settlement_id = $2
        AND si.deleted_at IS NULL
        AND si.status <> ALL($3::text[])
      ORDER BY si.created_at DESC
      `,
      [tenantId, settlementId, ["voided", "archived"]],
    );
    return result.rows;
  }

  private settlementSort(sort?: string) {
    switch (sort) {
      case "readiness_asc":
        return "ORDER BY s.readiness_score ASC NULLS FIRST, s.updated_at DESC";
      case "readiness_desc":
        return "ORDER BY s.readiness_score DESC NULLS LAST, s.updated_at DESC";
      case "gross_amount_desc":
        return "ORDER BY s.gross_billable_amount DESC NULLS LAST, s.updated_at DESC";
      case "net_amount_desc":
        return "ORDER BY s.net_settlement_amount DESC NULLS LAST, s.updated_at DESC";
      case "status":
        return "ORDER BY s.status ASC, s.updated_at DESC";
      case "settlement_number":
        return "ORDER BY s.settlement_number ASC, s.updated_at DESC";
      default:
        return "ORDER BY s.updated_at DESC";
    }
  }

  private recommendedSettlementAction(status: string, score: number, blockerCount: number, itemCount: number, invoiceReady: boolean, payableReady: boolean, settlementType: string) {
    if (status === "archived") return "view_only";
    if (status === "voided") return "view_voided_settlement";
    if (blockerCount) return "resolve_blockers";
    if (status === "held") return "release_or_review_hold";
    if (status === "disputed") return "resolve_dispute";
    if (!itemCount) return "add_settlement_items";
    if (score === null || score === undefined) return "recalculate_readiness";
    if (status === "draft" || status === "assembling") return "submit_for_review";
    if (status === "ready_for_review") return "start_review";
    if (status === "under_review" && score >= 85) return "approve_settlement";
    if (status === "approved" && !invoiceReady && (settlementType === "customer_billable" || settlementType === "mixed")) return "mark_invoice_ready";
    if (status === "approved" && !payableReady && (settlementType === "contractor_payable" || settlementType === "mixed")) return "mark_payable_ready";
    if (status === "invoice_ready" || status === "payable_ready") return "wait_for_future_invoice_or_payable";
    return "continue_settlement_review";
  }

  private statusAfterSettlementInterruption(before: Record<string, unknown>) {
    if (before.approved_at) return "approved";
    if (before.readiness_status === "ready_for_approval") return "ready_for_review";
    return "draft";
  }

  private async requireRecord(client: PoolClient, table: string, tenantId: string, id: string, message: string) {
    const record = await findTenantRecordById(client, table, tenantId, id);
    if (!record) throw new NotFoundException(message);
    return record;
  }

  private async requireBillableProduction(client: PoolClient, tenantId: string, id: unknown) {
    const record = await this.requireRecord(client, "production_records", tenantId, this.requiredId(id, "production_record_id"), "production record not found");
    if (record.status !== "billable" || record.billable_status !== "billable") throw new BadRequestException("production_record must be billable");
    return record;
  }

  private async requireRateCodeForProduction(client: PoolClient, tenantId: string, id: unknown, unitType: string) {
    const rateCode = await this.requireRecord(client, "rate_codes", tenantId, this.requiredId(id, "rate_code_id"), "rate code not found");
    if (rateCode.status !== "active") throw new BadRequestException("rate code must be active");
    if ((rateCode.unit_type ?? rateCode.unit) !== unitType) throw new BadRequestException("rate_code unit_type must match production unit_type");
    return rateCode;
  }

  private async billableProductionExists(client: PoolClient, tenantId: string) {
    const result = await client.query(
      "SELECT 1 FROM production_records WHERE tenant_id = $1 AND status = 'billable' AND billable_status = 'billable' AND deleted_at IS NULL LIMIT 1",
      [tenantId],
    );
    return Boolean(result.rows[0]);
  }

  private async settlementHasItems(client: PoolClient, tenantId: string, settlementId: string) {
    const result = await client.query(
      "SELECT 1 FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND status = ANY($3::text[]) AND deleted_at IS NULL LIMIT 1",
      [tenantId, settlementId, activeSettlementItemStatuses],
    );
    return Boolean(result.rows[0]);
  }

  private async recalculateSettlementTotals(client: PoolClient, tenantId: string, settlementId: string) {
    const settlement = await this.requireRecord(client, "settlements", tenantId, settlementId, "settlement not found");
    const result = await client.query(
      `
      SELECT
        coalesce(sum(CASE WHEN item_type = 'customer_billable' OR item_type IS NULL THEN gross_amount ELSE 0 END), 0)::numeric AS gross_billable_amount,
        coalesce(sum(contractor_payable_amount), 0)::numeric AS contractor_payable_amount,
        coalesce(sum(retainage_amount), 0)::numeric AS retainage_amount,
        coalesce(sum(deduction_amount), 0)::numeric AS deduction_amount,
        coalesce(sum(chargeback_amount), 0)::numeric AS chargeback_amount,
        count(*) FILTER (WHERE item_type = 'contractor_payable' AND contractor_payable_amount IS NULL)::int AS unknown_contractor_count
      FROM settlement_items
      WHERE tenant_id = $1
        AND settlement_id = $2
        AND status <> ALL($3::text[])
        AND deleted_at IS NULL
      `,
      [tenantId, settlementId, ["voided", "archived"]],
    );
    const grossBillableAmount = Number(result.rows[0].gross_billable_amount ?? 0);
    const contractorPayableAmount = Number(result.rows[0].contractor_payable_amount ?? 0);
    const retainageAmount = Number(result.rows[0].retainage_amount ?? 0) || Number(settlement.retainage_amount ?? 0);
    const deductionAmount = Number(result.rows[0].deduction_amount ?? 0) || Number(settlement.adjustment_amount ?? 0);
    const chargebackAmount = Number(result.rows[0].chargeback_amount ?? 0) || Number(settlement.chargeback_amount ?? 0);
    const netSettlementAmount = Math.max(0, grossBillableAmount - retainageAmount - deductionAmount - chargebackAmount);
    const marginKnown = Number(result.rows[0].unknown_contractor_count ?? 0) === 0;
    const estimatedMarginAmount = marginKnown ? netSettlementAmount - contractorPayableAmount : null;
    const estimatedMarginPercent = estimatedMarginAmount !== null && netSettlementAmount > 0 ? (estimatedMarginAmount / netSettlementAmount) * 100 : null;
    await updateTenantRecord(client, "settlements", tenantId, settlementId, {
      gross_amount: grossBillableAmount,
      gross_billable_amount: grossBillableAmount,
      contractor_payable_amount: contractorPayableAmount,
      retainage_amount: retainageAmount,
      adjustment_amount: deductionAmount,
      deduction_amount: deductionAmount,
      chargeback_amount: chargebackAmount,
      net_amount: netSettlementAmount,
      net_settlement_amount: netSettlementAmount,
      total_amount: grossBillableAmount,
      estimated_margin_amount: estimatedMarginAmount,
      estimated_margin_percent: estimatedMarginPercent,
    });
  }

  private calculateTotals(input: Record<string, unknown>) {
    const grossAmount = this.optionalMoney(input.gross_amount, "gross_amount");
    const retainageAmount = this.optionalMoney(input.retainage_amount, "retainage_amount");
    const adjustmentAmount = this.optionalMoney(input.adjustment_amount, "adjustment_amount");
    const chargebackAmount = this.optionalMoney(input.chargeback_amount, "chargeback_amount");
    const netAmount = Math.max(0, grossAmount - retainageAmount - chargebackAmount - adjustmentAmount);
    return {
      gross_amount: grossAmount,
      retainage_amount: retainageAmount,
      adjustment_amount: adjustmentAmount,
      chargeback_amount: chargebackAmount,
      net_amount: netAmount,
    };
  }

  private calculateSettlementItemAmounts(input: Record<string, unknown>) {
    const quantity = this.requireNonNegative(input.quantity, "quantity");
    const unitRate = input.unit_rate === undefined || input.unit_rate === null ? null : this.requireNonNegative(input.unit_rate, "unit_rate");
    const contractorRate = input.contractor_rate === undefined || input.contractor_rate === null ? null : this.requireNonNegative(input.contractor_rate, "contractor_rate");
    const grossAmount = input.gross_amount === undefined || input.gross_amount === null ? (unitRate === null ? 0 : quantity * unitRate) : this.requireNonNegative(input.gross_amount, "gross_amount");
    const retainagePercent = input.retainage_percent === undefined || input.retainage_percent === null ? null : this.optionalPercent(input.retainage_percent, "retainage_percent");
    const retainageAmount = input.retainage_amount === undefined || input.retainage_amount === null ? (retainagePercent === null || retainagePercent === undefined ? 0 : grossAmount * (retainagePercent / 100)) : this.requireNonNegative(input.retainage_amount, "retainage_amount");
    const deductionAmount = this.optionalMoney(input.deduction_amount, "deduction_amount");
    const chargebackAmount = this.optionalMoney(input.chargeback_amount, "chargeback_amount");
    const netAmount = Math.max(0, grossAmount - retainageAmount - deductionAmount - chargebackAmount);
    const contractorPayableAmount = contractorRate === null ? null : quantity * contractorRate;
    const marginAmount = contractorPayableAmount === null ? null : netAmount - contractorPayableAmount;
    const marginPercent = marginAmount === null || netAmount <= 0 ? null : (marginAmount / netAmount) * 100;
    return {
      gross_amount: grossAmount,
      amount: grossAmount,
      retainage_amount: retainageAmount,
      deduction_amount: deductionAmount,
      chargeback_amount: chargebackAmount,
      net_amount: netAmount,
      contractor_payable_amount: contractorPayableAmount,
      margin_amount: marginAmount,
      margin_percent: marginPercent,
    };
  }

  private settlementFinancialSummary(settlement: Record<string, unknown>) {
    return {
      gross_billable_amount: settlement.gross_billable_amount ?? settlement.gross_amount,
      contractor_payable_amount: settlement.contractor_payable_amount,
      retainage_amount: settlement.retainage_amount,
      deduction_amount: settlement.deduction_amount ?? settlement.adjustment_amount,
      chargeback_amount: settlement.chargeback_amount,
      net_settlement_amount: settlement.net_settlement_amount ?? settlement.net_amount,
      estimated_margin_amount: settlement.estimated_margin_amount,
      estimated_margin_percent: settlement.estimated_margin_percent,
    };
  }

  private itemFinancialBreakdown(item: Record<string, unknown>) {
    return {
      quantity: item.quantity,
      unit: item.unit,
      unit_rate: item.unit_rate,
      gross_amount: item.gross_amount,
      retainage_amount: item.retainage_amount,
      deduction_amount: item.deduction_amount,
      chargeback_amount: item.chargeback_amount,
      net_amount: item.net_amount,
      contractor_rate: item.contractor_rate,
      contractor_payable_amount: item.contractor_payable_amount,
    };
  }

  private itemMarginBreakdown(item: Record<string, unknown>) {
    return { margin_amount: item.margin_amount, margin_percent: item.margin_percent };
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
    const parsed = this.requireNonNegative(value, field);
    if (parsed <= 0) throw new Error(`${field} must be > 0`);
    return parsed;
  }

  private optionalMoney(value: unknown, field: string) {
    if (value === undefined || value === null) return 0;
    return this.requireNonNegative(value, field);
  }

  private optionalNonNegative(value: unknown, field: string) {
    if (value === undefined || value === null) return undefined;
    return this.requireNonNegative(value, field);
  }

  private optionalPercent(value: unknown, field: string) {
    if (value === undefined || value === null) return undefined;
    const parsed = this.requireNonNegative(value, field);
    if (parsed > 100) throw new Error(`${field} must be <= 100`);
    return parsed;
  }

  private hasOverride(value: unknown) {
    return Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length);
  }

  private asObject(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private mergeOverrideReasons(existing: unknown, incoming: unknown) {
    return { ...this.asObject(existing), ...this.asObject(incoming) };
  }

  private additionalEvent(action: string, entityType: string, entityId: string, eventType: string, afterState: Record<string, unknown>) {
    return {
      action,
      aggregateType: entityType,
      entityType,
      entityId,
      eventType,
      afterState,
      systemActions: [{ actionType: `${eventType}.processed`, payload: { action } }],
    };
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
