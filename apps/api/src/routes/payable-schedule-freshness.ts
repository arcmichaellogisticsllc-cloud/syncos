import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';

// This lock is shared with DB triggers so legacy cash writers cannot race payment decisions.
export async function lockScheduleInputs(client:PoolClient,tenantId:string){
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,85))',[tenantId]);
}
export async function scheduleFingerprint(client:PoolClient,tenantId:string,payableId:string){
 const result=await client.query(`WITH items AS (
 SELECT * FROM contractor_payable_items WHERE tenant_id=$1 AND contractor_payable_id=$2
 ), sources AS (
 SELECT s.* FROM accepted_production_financial_sources s WHERE s.tenant_id=$1 AND s.id IN(SELECT accepted_production_source_id FROM items)
 ), allocations AS (
 SELECT a.* FROM payment_application_allocations a WHERE a.tenant_id=$1 AND a.accepted_production_source_id IN(SELECT id FROM sources)
 ), applications AS (
 SELECT a.* FROM payment_applications a WHERE a.tenant_id=$1 AND a.id IN(SELECT payment_application_id FROM allocations)
 ), lines AS (
 SELECT i.* FROM invoice_items i WHERE i.tenant_id=$1 AND i.accepted_production_source_id IN(SELECT id FROM sources)
 ) SELECT md5(jsonb_build_object(
 'payable',(SELECT jsonb_build_array(commercial_terms_revision_id,settlement_id,net_payable_amount) FROM contractor_payables WHERE tenant_id=$1 AND id=$2),
 'items',(SELECT jsonb_agg(to_jsonb(i)-ARRAY['funded_customer_amount','eligible_partner_amount','updated_at','updated_by'] ORDER BY id) FROM items i),
 'sources',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM sources s),
 'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM allocations a),
 'applications',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM applications a),
 'receipts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM cash_receipts c WHERE tenant_id=$1 AND id IN(SELECT cash_receipt_id FROM applications)),
 'lines',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM lines i),
 'invoices',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM invoices i WHERE tenant_id=$1 AND id IN(SELECT invoice_id FROM lines)),
 'triggers',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM partner_payment_trigger_events e WHERE tenant_id=$1 AND contractor_payable_id=$2)
 )::text) AS fingerprint`,[tenantId,payableId]);
 return String(result.rows[0].fingerprint);
}
export async function requireFreshSchedule(client:PoolClient,tenantId:string,payableId:string){
 await lockScheduleInputs(client,tenantId);
 const current=await scheduleFingerprint(client,tenantId,payableId);
 const snapshot=(await client.query('SELECT source_fingerprint FROM contractor_payable_eligibility_snapshots WHERE tenant_id=$1 AND contractor_payable_id=$2 ORDER BY calculation_version DESC LIMIT 1',[tenantId,payableId])).rows[0];
 if(!snapshot?.source_fingerprint||snapshot.source_fingerprint!==current)throw new BadRequestException('Payment schedule is stale. Recalculate eligibility after cash or agreement inputs change.');
}
