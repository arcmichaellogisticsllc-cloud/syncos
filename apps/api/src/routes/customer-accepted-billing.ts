import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";

export async function lockProductionBilling(client: PoolClient, tenantId: string, productionId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${tenantId}:production-billing:${productionId}`]);
}

export async function requireCustomerAcceptedBilling(client: PoolClient, tenantId: string, productionId: string, expectedDecisionId?: unknown) {
  await lockProductionBilling(client, tenantId, productionId);
  const result = await client.query(`SELECT decision.* FROM customer_qc_decisions decision
    JOIN customer_qc_cycles cycle ON cycle.tenant_id=decision.tenant_id AND cycle.id=decision.qc_cycle_id AND cycle.deleted_at IS NULL
    WHERE decision.tenant_id=$1 AND decision.production_record_id=$2 AND decision.current=true AND decision.deleted_at IS NULL
      AND cycle.cycle_number=(SELECT max(latest.cycle_number) FROM customer_qc_cycles latest
        WHERE latest.tenant_id=cycle.tenant_id AND latest.daily_report_id=cycle.daily_report_id AND latest.deleted_at IS NULL)
    ORDER BY decision.recorded_at DESC LIMIT 1 FOR UPDATE OF decision`, [tenantId, productionId]);
  const decision = result.rows[0];
  if (!decision || !['accepted', 'partially_accepted'].includes(decision.decision) || Number(decision.customer_accepted_quantity) <= 0) {
    throw new BadRequestException("Current customer acceptance is required before billing production");
  }
  if (expectedDecisionId && decision.id !== expectedDecisionId) {
    throw new BadRequestException("Customer acceptance changed; review the existing billable through controlled financial adjustments");
  }
  return decision;
}

export function validateAcceptedBillingQuantity(decision: Record<string, unknown>, quantity: number, unit: unknown) {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number(decision.customer_accepted_quantity)) {
    throw new BadRequestException("Billable quantity must not exceed the customer-accepted quantity");
  }
  if (unit !== decision.unit_of_measure) throw new BadRequestException("Billable unit must match the customer-accepted unit");
}

export async function requireLinkedBillableAcceptance(client: PoolClient, tenantId: string, billable: Record<string, any>) {
  // Stored historical records remain intact; new financial advancement of production requires customer acceptance.
  if (!billable.production_record_id) return;
  const decision = await requireCustomerAcceptedBilling(client, tenantId, String(billable.production_record_id), billable.customer_qc_decision_id);
  let quantitySource = decision;
  if (billable.accepted_production_source_id) {
    const source = (await client.query("SELECT source_kind,accepted_quantity,unit_of_measure FROM accepted_production_financial_sources WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND financial_status <> 'void'", [tenantId, billable.accepted_production_source_id])).rows[0];
    if (!source) throw new BadRequestException("Active accepted-production source is required");
    if (source.source_kind === "customer_coil_supplement") quantitySource = { customer_accepted_quantity: source.accepted_quantity, unit_of_measure: source.unit_of_measure };
  }
  validateAcceptedBillingQuantity(quantitySource, Number(billable.billable_quantity), billable.unit);
}
