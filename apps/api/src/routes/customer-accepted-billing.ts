import { requireReviewedProductionQuantity } from "./production-quantity-integrity";
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
      AND NOT EXISTS (
        SELECT 1 FROM customer_qc_cycles newer
        LEFT JOIN daily_production_report_revisions inspected ON inspected.tenant_id=newer.tenant_id AND inspected.id=newer.daily_report_revision_id
        WHERE newer.tenant_id=cycle.tenant_id AND newer.daily_report_id=cycle.daily_report_id AND newer.deleted_at IS NULL AND newer.cycle_number>cycle.cycle_number
          AND (NULLIF(inspected.snapshot_json->>'original_production_record_id','') IS NULL
            OR inspected.snapshot_json->>'original_production_record_id'=decision.production_record_id::text)
      )
      AND NOT EXISTS (SELECT 1 FROM production_corrections correction WHERE correction.tenant_id=decision.tenant_id
        AND correction.production_record_id=decision.production_record_id AND correction.deleted_at IS NULL AND correction.status NOT IN ('resolved','cancelled'))
    ORDER BY cycle.cycle_number DESC,decision.recorded_at DESC LIMIT 1 FOR UPDATE OF decision`, [tenantId, productionId]);
  const decision = result.rows[0];
  if (!decision || !['accepted', 'partially_accepted'].includes(decision.decision) || Number(decision.customer_accepted_quantity) <= 0) {
    throw new BadRequestException("Current customer acceptance is required before billing production");
  }
  if (expectedDecisionId && decision.id !== expectedDecisionId) {
    throw new BadRequestException("Customer acceptance changed; review the existing billable through controlled financial adjustments");
  }
  const reviewed=await requireReviewedProductionQuantity(client, tenantId, productionId);
  if(!decision.accepted_quantity_review_id || decision.accepted_quantity_review_id!==reviewed.review.id || decision.accepted_quantity_fingerprint!==reviewed.review.source_fingerprint)throw new BadRequestException("Customer acceptance must cover the current quantity review; obtain a documented customer decision for the reconciled source");
  if(Number(decision.customer_accepted_quantity)>Number(reviewed.record.quantity_submitted) || decision.unit_of_measure!==(reviewed.record.unit??reviewed.record.unit_type))throw new BadRequestException("Customer acceptance no longer matches the current production quantity or unit");
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
    if (["customer_coil_supplement", "partner_coil_supplement"].includes(source.source_kind)) quantitySource = { customer_accepted_quantity: source.accepted_quantity, unit_of_measure: source.unit_of_measure };
  }
  validateAcceptedBillingQuantity(quantitySource, Number(billable.billable_quantity), billable.unit);
}

export async function requireFinancialItemAcceptance(client: PoolClient, tenantId: string, item: Record<string, any>) {
  if (item.billable_item_id) {
    const billable = (await client.query("SELECT * FROM billable_items WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL", [tenantId, item.billable_item_id])).rows[0];
    if (!billable) throw new BadRequestException("Billable source is unavailable");
    await requireLinkedBillableAcceptance(client, tenantId, { ...billable, billable_quantity: item.quantity });
  } else if (item.production_record_id) {
    const production = (await client.query("SELECT * FROM production_records WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL", [tenantId, item.production_record_id])).rows[0];
    if (!production) throw new BadRequestException("Production source is unavailable");
    const source = item.accepted_production_source_id
      ? (await client.query("SELECT * FROM accepted_production_financial_sources WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND financial_status <> 'void'", [tenantId, item.accepted_production_source_id])).rows[0] : null;
    if (item.accepted_production_source_id && !source) throw new BadRequestException("Accepted-production source is unavailable");
    await requireLinkedBillableAcceptance(client, tenantId, {
      production_record_id: production.id,
      customer_qc_decision_id: source?.customer_qc_decision_id,
      accepted_production_source_id: source?.id,
      billable_quantity: item.quantity,
      unit: item.unit ?? production.unit ?? production.unit_type,
    });
  }
}
