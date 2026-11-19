import crypto from "node:crypto";
import type {Client} from "pg";
// Isolated synthetic fixtures only; never infer approval for operational records.
export async function prepareSyntheticCommercialFixture(db:Client,tenant:string,actor:string){
 const u=new URL(process.env.DATABASE_URL!);if(!['localhost','127.0.0.1'].includes(u.hostname)||/staging|production/i.test(u.pathname))throw new Error('Synthetic fixture preparation is local-only');
 const {productionQuantitySource,productionQuantityFingerprint}=require('../../../apps/api/dist/routes/production-quantity-integrity');
 const {approvedRateSnapshot}=require('../../../apps/api/dist/routes/commercial-terms');
 for(const row of (await db.query('SELECT id FROM production_records WHERE tenant_id=$1',[tenant])).rows){
  const source=await productionQuantitySource(db,tenant,row.id),fingerprint=productionQuantityFingerprint(source),ref='synthetic-p12-'+row.id;
  await db.query('INSERT INTO production_work_item_registry(tenant_id,work_order_id,canonical_reference,production_record_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[tenant,source.work_order_id,ref,row.id]);
  const review=(await db.query("INSERT INTO production_quantity_reviews(tenant_id,production_record_id,disposition,canonical_reference,source_fingerprint,source_reference,review_notes,reviewed_by,client_mutation_id) VALUES($1,$2,'primary_work',$3,$4,'SYNTHETIC local fixture','Synthetic reviewed quantity',$5,$6) RETURNING id",[tenant,row.id,ref,fingerprint,actor,crypto.randomUUID()])).rows[0];
  await db.query('UPDATE production_records SET quantity_review_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,row.id,review.id]);
  await db.query('UPDATE customer_qc_decisions SET accepted_quantity_review_id=$3,accepted_quantity_fingerprint=$4 WHERE tenant_id=$1 AND production_record_id=$2',[tenant,row.id,review.id,fingerprint]);
 }
 for(const schedule of (await db.query('SELECT * FROM rate_schedules WHERE tenant_id=$1',[tenant])).rows){
  let agreement=(await db.query('SELECT id FROM contracts WHERE tenant_id=$1 AND organization_id=$2 LIMIT 1',[tenant,schedule.organization_id])).rows[0]?.id;
  const party=schedule.name==='P12 Partner Rates'?'partner':'customer';
  if(!agreement)agreement=(await db.query("INSERT INTO contracts(tenant_id,organization_id,name,status) VALUES($1,$2,'SYNTHETIC P12 commercial agreement','active') RETURNING id",[tenant,schedule.organization_id])).rows[0].id;
  await db.query('UPDATE rate_schedules SET contract_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,schedule.id,agreement]);
  const rates=(await db.query("SELECT * FROM rate_codes WHERE tenant_id=$1 AND rate_schedule_id=$2 AND status='active' AND deleted_at IS NULL",[tenant,schedule.id])).rows;
  const n=(await db.query('SELECT coalesce(max(revision_number),0)+1 AS n FROM commercial_terms_revisions WHERE tenant_id=$1 AND rate_schedule_id=$2 AND party_type=$3',[tenant,schedule.id,party])).rows[0].n;
  await db.query("INSERT INTO commercial_terms_revisions(tenant_id,contract_id,rate_schedule_id,counterparty_organization_id,party_type,revision_number,effective_from,payment_trigger,payment_days,time_zone,retainage_percent,rate_snapshot,source_reference,approved_by,client_mutation_id) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01',$7,14,'America/New_York',0,$8::jsonb,'SYNTHETIC approved pricing',$9,$10)",[tenant,agreement,schedule.id,schedule.organization_id,party,n,party==='partner'?'customer_payment':'invoice_acceptance',JSON.stringify(approvedRateSnapshot(rates,party)),actor,crypto.randomUUID()]);
 }
}
