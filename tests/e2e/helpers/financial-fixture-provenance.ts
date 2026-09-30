import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
const {productionQuantitySource,productionQuantityFingerprint}=require('../../../apps/api/dist/routes/production-quantity-integrity');
/** Complete isolated synthetic payment fixtures; never backfill operational acceptance. */
export async function pinSyntheticPaymentProvenance(db:Client,tenant:string,actor:string,contract:string,schedule:string,partner:string){
 const url=new URL(process.env.DATABASE_URL??'');
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||/staging|production/i.test(url.pathname))throw new Error('Synthetic provenance requires an isolated local test database');
 const records=(await db.query('SELECT DISTINCT production_record_id FROM accepted_production_financial_sources WHERE tenant_id=$1',[tenant])).rows;
 for(const row of records){const source=await productionQuantitySource(db,tenant,row.production_record_id);const fingerprint=productionQuantityFingerprint(source);const reference=`synthetic-payment-${source.id}`;
  await db.query('INSERT INTO production_work_item_registry(tenant_id,work_order_id,canonical_reference,production_record_id) VALUES($1,$2,$3,$4)',[tenant,source.work_order_id,reference,source.id]);
  const review=(await db.query("INSERT INTO production_quantity_reviews(tenant_id,production_record_id,disposition,canonical_reference,source_fingerprint,source_reference,review_notes,reviewed_by,client_mutation_id) VALUES($1,$2,'primary_work',$3,$4,'SYNTHETIC payment test quantity evidence','Isolated payment fixture, not operational acceptance',$5,$6) RETURNING id",[tenant,source.id,reference,fingerprint,actor,randomUUID()])).rows[0];
  await db.query('UPDATE production_records SET quantity_review_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,source.id,review.id]);
  await db.query('UPDATE customer_qc_decisions SET accepted_quantity_review_id=$3,accepted_quantity_fingerprint=$4 WHERE tenant_id=$1 AND production_record_id=$2',[tenant,source.id,review.id,fingerprint]);
 }
 await db.query('UPDATE rate_schedules SET contract_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,schedule,contract]);
 const rates=(await db.query('SELECT DISTINCT production_code,unit_of_measure,partner_rate FROM accepted_production_financial_sources WHERE tenant_id=$1',[tenant])).rows.map(r=>({id:randomUUID(),code:r.production_code,unit:r.unit_of_measure==='feet'?'LF':r.unit_of_measure,rate:Number(r.partner_rate),description:'Synthetic approved test rate'}));
 const terms=(await db.query("INSERT INTO commercial_terms_revisions(tenant_id,contract_id,rate_schedule_id,counterparty_organization_id,party_type,revision_number,effective_from,payment_trigger,payment_days,time_zone,retainage_percent,rate_snapshot,source_reference,approved_by,client_mutation_id) VALUES($1,$2,$3,$4,'partner',1,'2026-08-01','customer_payment',14,'America/New_York',0,$5::jsonb,'SYNTHETIC payment test approved agreement',$6,$7) RETURNING id",[tenant,contract,schedule,partner,JSON.stringify(rates),actor,randomUUID()])).rows[0];
 await db.query('UPDATE accepted_production_financial_sources SET partner_terms_revision_id=$2 WHERE tenant_id=$1',[tenant,terms.id]);
 await db.query('UPDATE contractor_payables SET commercial_terms_revision_id=$2 WHERE tenant_id=$1',[tenant,terms.id]);
}
