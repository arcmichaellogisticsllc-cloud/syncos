import type { PoolClient } from 'pg';
import { productionQuantityFingerprint } from './production-quantity-integrity';

// Report only reconciled work. Quantities with unlike units are never combined.
export function summarizeReviewedProduction(records: Record<string, any>[]) {
  const totals = new Map<string, { unit: string; quantity: number; record_count: number }>();
  let pending = 0, references = 0;
  for (const record of records) {
    if (['included_subset', 'summary'].includes(record.review_disposition)) { references++; continue; }
    if (!['primary_work', 'additional_work'].includes(record.review_disposition) || record.review_fingerprint !== productionQuantityFingerprint(record)) { pending++; continue; }
    const unit = String(record.unit ?? record.unit_type ?? 'Unspecified');
    const group = totals.get(unit) ?? { unit, quantity: 0, record_count: 0 };
    group.quantity += Number(record.quantity_submitted); group.record_count++;
    totals.set(unit, group);
  }
  return { by_unit: [...totals.values()].sort((a,b)=>a.unit.localeCompare(b.unit)), pending_review_count: pending, excluded_reference_count: references };
}

export async function reviewedProductionSummary(c: PoolClient, tenant: string) {
  const records = (await c.query(`SELECT p.*, q.disposition AS review_disposition,q.source_fingerprint AS review_fingerprint
    FROM production_records p LEFT JOIN production_quantity_reviews q ON q.tenant_id=p.tenant_id AND q.id=p.quantity_review_id
    WHERE p.tenant_id=$1 AND p.deleted_at IS NULL AND p.status IN ('submitted','under_review','qc_review','correction_required','corrected','accepted','approved','billable')`, [tenant])).rows;
  if (!records.length) return summarizeReviewedProduction([]);
  const revisions = (await c.query(`SELECT revision.id,revision.snapshot_json->>'original_production_record_id' AS record_id,
      revision.snapshot_json->'proposed_correction' AS proposal,code.unit_of_measure
    FROM daily_production_report_revisions revision
    JOIN production_corrections correction ON correction.tenant_id=revision.tenant_id AND correction.id::text=revision.snapshot_json->'correction'->>'id'
    LEFT JOIN syncfield_production_codes code ON code.tenant_id=revision.tenant_id AND code.id::text=revision.snapshot_json->'proposed_correction'->>'production_code_id'
    WHERE revision.tenant_id=$1 AND revision.snapshot_json->>'original_production_record_id'=ANY($2::text[])
      AND correction.deleted_at IS NULL AND correction.status IN ('awaiting_customer_reinspection','resolved') ORDER BY revision.revision_number`, [tenant,records.map(r=>r.id)])).rows;
  const byId = new Map(records.map(record=>[record.id,{...record,quantity_revision_ids:[] as string[]}]));
  for (const revision of revisions) {
    const record=byId.get(revision.record_id); if(!record) continue;
    record.quantity_revision_ids.push(revision.id);
    const proposal=revision.proposal;
    if(proposal?.reported_quantity!==null&&proposal?.reported_quantity!==undefined)record.quantity_submitted=Number(proposal.reported_quantity);
    if(proposal?.asset_identifier)record.asset_identifier=proposal.asset_identifier;
    if(proposal?.route_endpoint)record.to_asset_identifier=proposal.route_endpoint;
    if(proposal?.production_code_id){record.syncfield_production_code_id=proposal.production_code_id;record.unit=revision.unit_of_measure;record.unit_type=revision.unit_of_measure;}
  }
  return summarizeReviewedProduction([...byId.values()]);
}
