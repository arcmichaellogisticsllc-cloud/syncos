import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
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
const settlementStatuses = new Set(["draft", "internal_review", "ready_to_submit", "submitted", "customer_review", "approved", "disputed", "archived"]);
const settlementItemStatuses = new Set(["active", "archived"]);
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
  async listSettlements(@Req() request: AuthenticatedRequest) {
    return this.withClient((client) => listTenantRecords(client, "settlements", request.auth.tenantId, { searchColumns: ["status"] }));
  }

  @Get("settlements/:id")
  @RequirePermission("settlement.read")
  async getSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.withClient((client) => this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found"));
  }

  @Post("settlements")
  @RequirePermission("settlement.create")
  async createSettlement(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
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
  async approveSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement.approve", "settlement.approved", "settlement", async (client) => {
      await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, customerReviewRoles, "Customer Validator or internal review authority is required");
      const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
      if (before.status !== "customer_review") throw new BadRequestException("settlement must be customer_review");
      return this.updateSettlementStatus(client, request, before, id, "approved");
    });
  }

  @Post("settlements/:id/dispute")
  @RequirePermission("settlement.dispute")
  async disputeSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      const reason = requireString(body.reason ?? body.dispute_reason, "dispute reason is required");
      return await this.write(request, "settlement.dispute", "settlement.disputed", "settlement", async (client) => {
        await this.requireRoleAuthority(client, request.auth.tenantId, request.auth.userId, disputeRoles, "Customer Validator, Billing Manager, or Finance Manager authority is required");
        const before = await this.requireRecord(client, "settlements", request.auth.tenantId, id, "settlement not found");
        const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status: "disputed", dispute_reason: reason });
        if (!after) throw new NotFoundException("settlement not found");
        return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
      }, reason);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post("settlements/:id/archive")
  @RequirePermission("settlement.archive")
  async archiveSettlement(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.archiveRecord(request, "settlements", id, "settlement", "settlement.archive", "settlement.archived");
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

  @Post("settlements/:id/items")
  @RequirePermission("settlement_item.create")
  async createSettlementItem(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
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
      const values = pick(body, ["description"]);
      if (body.status !== undefined) values.status = requireAllowed(body.status, settlementItemStatuses, "settlement item status");
      if (body.quantity !== undefined) values.quantity = this.requireNonNegative(body.quantity, "quantity");
      if (body.unit_rate !== undefined) values.unit_rate = this.requireNonNegative(body.unit_rate, "unit_rate");
      return await this.write(request, "settlement_item.update", "settlement_item.updated", "settlement_item", async (client) => {
        const before = await this.requireRecord(client, "settlement_items", request.auth.tenantId, id, "settlement item not found");
        if (body.production_record_id) {
          const productionRecord = await this.requireBillableProduction(client, request.auth.tenantId, body.production_record_id);
          values.production_record_id = productionRecord.id;
        }
        const productionRecord = await this.requireBillableProduction(client, request.auth.tenantId, values.production_record_id ?? before.production_record_id);
        if (body.rate_code_id) {
          const rateCode = await this.requireRateCodeForProduction(client, request.auth.tenantId, body.rate_code_id, String(productionRecord.unit_type));
          values.rate_code_id = rateCode.id;
        }
        const quantity = Number(values.quantity ?? before.quantity);
        const unitRate = Number(values.unit_rate ?? before.unit_rate);
        values.gross_amount = body.gross_amount === undefined ? quantity * unitRate : this.requireNonNegative(body.gross_amount, "gross_amount");
        values.amount = values.gross_amount;
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

  @Post("settlement-items/:id/archive")
  @RequirePermission("settlement_item.archive")
  async archiveSettlementItem(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.write(request, "settlement_item.archive", "settlement_item.archived", "settlement_item", async (client) => {
      const before = await this.requireRecord(client, "settlement_items", request.auth.tenantId, id, "settlement item not found");
      const after = await updateTenantRecord(client, "settlement_items", request.auth.tenantId, id, { status: "archived", deleted_at: new Date() });
      if (!after) throw new NotFoundException("settlement item not found");
      await this.recalculateSettlementTotals(client, request.auth.tenantId, String(before.settlement_id));
      return { entityType: "settlement_item", entityId: id, beforeState: before, afterState: after };
    });
  }

  private async updateSettlementStatus(client: PoolClient, request: AuthenticatedRequest, before: Record<string, unknown>, id: string, status: string) {
    const after = await updateTenantRecord(client, "settlements", request.auth.tenantId, id, { status });
    if (!after) throw new NotFoundException("settlement not found");
    return { entityType: "settlement", entityId: id, beforeState: before, afterState: after };
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
      "SELECT 1 FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND status = 'active' AND deleted_at IS NULL LIMIT 1",
      [tenantId, settlementId],
    );
    return Boolean(result.rows[0]);
  }

  private async recalculateSettlementTotals(client: PoolClient, tenantId: string, settlementId: string) {
    const settlement = await this.requireRecord(client, "settlements", tenantId, settlementId, "settlement not found");
    const result = await client.query(
      "SELECT coalesce(sum(gross_amount), 0)::numeric AS gross_amount FROM settlement_items WHERE tenant_id = $1 AND settlement_id = $2 AND status = 'active' AND deleted_at IS NULL",
      [tenantId, settlementId],
    );
    const totals = this.calculateTotals({
      gross_amount: result.rows[0].gross_amount,
      retainage_amount: settlement.retainage_amount,
      adjustment_amount: settlement.adjustment_amount,
      chargeback_amount: settlement.chargeback_amount,
    });
    await updateTenantRecord(client, "settlements", tenantId, settlementId, { ...totals, total_amount: totals.gross_amount });
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
