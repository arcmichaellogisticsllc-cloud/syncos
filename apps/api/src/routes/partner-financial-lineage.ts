import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { requireFinancialItemAcceptance } from './customer-accepted-billing';

/** Resolve the agreement governing the performed work, not today's latest MSA.
 * A superseded agreement can still govern historical work. A void or unapproved
 * agreement never qualifies, and no employee source may create partner debt. */
export async function requirePartnerWorkAgreement(client: PoolClient, tenantId: string, productionId: string, partnerId: string, providerId: string) {
  const result = await client.query(`SELECT a.id AS agreement_id, a.status AS agreement_status,
      a.effective_date, a.termination_date, a.executed_at, a.artifact_verified_at, a.artifact_file_object_id,
      a.organization_id, a.capacity_provider_id, w.execution_model, d.work_date,
      w.organization_id AS work_organization_id, w.capacity_provider_id AS work_provider_id,
      (a.effective_date <= d.work_date AND (a.termination_date IS NULL OR d.work_date < a.termination_date)) AS effective_for_work
    FROM production_records p
    JOIN daily_production_reports d ON d.tenant_id=p.tenant_id AND d.id=p.daily_production_report_id
    JOIN partner_work_order_versions w ON w.tenant_id=p.tenant_id AND w.id=p.work_order_version_id AND w.deleted_at IS NULL
    JOIN partner_agreement_versions a ON a.tenant_id=w.tenant_id AND a.id=w.governing_agreement_version_id AND a.deleted_at IS NULL
    WHERE p.tenant_id=$1 AND p.id=$2 AND p.deleted_at IS NULL
    FOR SHARE OF a,w`, [tenantId, productionId]);
  const row = result.rows[0];
  if (!row || row.execution_model !== 'partner' || row.organization_id !== partnerId || row.work_organization_id !== partnerId || row.capacity_provider_id !== providerId || row.work_provider_id !== providerId) {
    throw new BadRequestException('Partner payable requires accepted work linked to the same partner and governing agreement');
  }
  if (!['effective','superseded','terminated'].includes(row.agreement_status) || !row.executed_at || !row.artifact_verified_at || !row.artifact_file_object_id || row.effective_for_work !== true || (row.agreement_status === 'terminated' && !row.termination_date)) {
    throw new BadRequestException('Verified approved agreement effective for the performed work is required');
  }
  return row.agreement_id as string;
}

export async function requirePartnerPayableLineage(client: PoolClient, tenantId: string, payable: Record<string, any>) {
  if (!payable.settlement_id || !payable.partner_organization_id || !payable.capacity_provider_id) {
    throw new BadRequestException('Partner payable requires an approved settlement with accepted-work lineage');
  }
  const items = (await client.query(`SELECT si.* FROM settlement_items si
    JOIN settlements s ON s.tenant_id=si.tenant_id AND s.id=si.settlement_id
    WHERE si.tenant_id=$1 AND si.settlement_id=$2 AND si.deleted_at IS NULL
      AND si.status NOT IN ('voided','archived') AND s.deleted_at IS NULL
      AND s.status NOT IN ('voided','archived','rejected','held','disputed')
    ORDER BY si.production_record_id,si.id`, [tenantId, payable.settlement_id])).rows;
  if (!items.length) throw new BadRequestException('Partner payable has no active accepted-work settlement items');
  for (const item of items) {
    if (!item.production_record_id || item.partner_organization_id !== payable.partner_organization_id || item.capacity_provider_id !== payable.capacity_provider_id) {
      throw new BadRequestException('Every payable item must trace to work for the same partner');
    }
    const source = (await client.query(`SELECT src.* FROM accepted_production_financial_sources src
      WHERE src.tenant_id=$1 AND src.id=$2 AND src.deleted_at IS NULL AND src.financial_status <> 'void'`, [tenantId,item.accepted_production_source_id])).rows[0];
    if (!source || source.production_record_id !== item.production_record_id || source.partner_organization_id !== payable.partner_organization_id || source.capacity_provider_id !== payable.capacity_provider_id) {
      throw new BadRequestException('Every payable amount requires a matching accepted-production financial source');
    }
    const quantity=Number(item.quantity), rate=Number(source.partner_rate), net=Number(item.net_amount);
    if (!Number.isFinite(quantity) || quantity<=0 || quantity>Number(source.accepted_quantity) || !Number.isFinite(rate) || rate<=0 || !Number.isFinite(net) || net<0 || Math.round(net*100)>Math.round(quantity*rate*100)) {
      throw new BadRequestException('Payable item exceeds its accepted quantity or locked partner rate');
    }
    await requireFinancialItemAcceptance(client, tenantId, item);
    await requirePartnerWorkAgreement(client, tenantId, item.production_record_id, payable.partner_organization_id, payable.capacity_provider_id);
  }
  if (payable.id) {
    const balance = (await client.query(`SELECT
      (SELECT COALESCE(sum(si.net_amount),0) FROM settlement_items si WHERE si.tenant_id=$1 AND si.settlement_id=$2 AND si.deleted_at IS NULL AND si.status NOT IN ('voided','archived')) AS accepted_budget,
      COALESCE(sum(cp.net_payable_amount),0) AS committed_amount
      FROM contractor_payables cp WHERE cp.tenant_id=$1 AND cp.settlement_id=$2
        AND cp.deleted_at IS NULL AND cp.status NOT IN ('voided','archived','rejected')`, [tenantId, payable.settlement_id])).rows[0];
    if (!balance || Number(balance.accepted_budget) <= 0 || Number(balance.committed_amount) > Number(balance.accepted_budget)) {
      throw new BadRequestException('Payable amounts exceed the accepted-work settlement budget; review duplicate payables or adjustments');
    }
  }
}
