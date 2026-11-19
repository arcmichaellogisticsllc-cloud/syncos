"use strict";
const {randomUUID,createHash}=require('node:crypto');
const {normalize}=require('./index');
const reference=value=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_.:]{1,160}$/.test(value))throw new Error('Invalid reference');return value;};
// Caller supplies an authenticated tenant. No credentials or provider body are stored.
class DurableIntake {
 constructor(pool){this.pool=pool;}
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async connection(c,tenant,id){const row=(await c.query('SELECT * FROM passport_connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];if(!row)throw new Error('Connection not found');return row;}
 async enqueue(tenant,id,transaction){reference(transaction);return this.transaction(async c=>{
 await this.connection(c,tenant,id);
 const row=(await c.query(`INSERT INTO passport_refresh_jobs(tenant_id,connection_id,transaction_reference) VALUES($1,$2,$3)
 ON CONFLICT(connection_id,transaction_reference) DO UPDATE SET status=CASE WHEN passport_refresh_jobs.status='leased' THEN 'leased' ELSE 'queued' END,
 hint_version=passport_refresh_jobs.hint_version+1,available_at=now(),updated_at=now() RETURNING *`,[tenant,id,transaction])).rows[0];return row;
 });}
 async claim(tenant,id){return this.transaction(async c=>{
 await this.connection(c,tenant,id);
 const row=(await c.query(`SELECT id FROM passport_refresh_jobs WHERE tenant_id=$1 AND connection_id=$2
 AND ((status='queued' AND available_at<=now()) OR (status='leased' AND lease_until<now()))
 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[tenant,id])).rows[0];if(!row)return null;
 return (await c.query("UPDATE passport_refresh_jobs SET status='leased',lease_token=$3,leased_hint_version=hint_version,lease_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[tenant,row.id,randomUUID()])).rows[0];
 });}
 async complete(tenant,job,lease){return this.finish(tenant,job,lease,null);}
 async fail(tenant,job,lease,code){if(!['provider_unavailable','invalid_response','mapping_required','contract_unverified'].includes(code))throw new Error('Unknown safe failure code');return this.finish(tenant,job,lease,code);}
 async finish(tenant,job,lease,code){return this.transaction(async c=>{
 const row=(await c.query(`UPDATE passport_refresh_jobs SET status=CASE WHEN $4::text IS NULL AND hint_version>COALESCE(leased_hint_version,0) THEN 'queued' WHEN $4::text IS NULL THEN 'complete' WHEN attempts>=8 THEN 'failed' ELSE 'queued' END,
 available_at=now()+interval '60 seconds',lease_token=NULL,lease_until=NULL,last_error_code=$4,updated_at=now()
 WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status='leased' AND lease_until>now() RETURNING id`,[tenant,job,lease,code])).rows[0];if(!row)throw new Error('Expired or foreign lease');return row;
 });}
 // Authoritative refresh completion and job acknowledgment share one transaction.
 // This preparation path records observations and review exceptions, never financial payments.
 async ingestRefresh(tenant,id,jobId,lease,input){const t=normalize(input);return this.transaction(async c=>{
  const connection=await this.connection(c,tenant,id);
  const job=(await c.query("SELECT * FROM passport_refresh_jobs WHERE tenant_id=$1 AND connection_id=$2 AND id=$3 AND lease_token=$4 AND status='leased' AND lease_until>now() FOR UPDATE",[tenant,id,jobId,lease])).rows[0];if(!job)throw new Error('Expired or foreign lease');
  if(t.customerId!==connection.customer_reference||t.accountId!==connection.account_reference||t.transactionId!==job.transaction_reference)throw new Error('Provider scope mismatch');
  const hash=createHash('sha256').update(JSON.stringify(t)).digest('hex');
  const old=(await c.query('SELECT fingerprint FROM passport_observations WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3 AND normalized_version=$4',[tenant,id,t.transactionId,t.version])).rows;
  await c.query('INSERT INTO passport_observations(tenant_id,connection_id,transaction_reference,normalized_version,fingerprint,normalized_metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[tenant,id,t.transactionId,t.version,hash,t]);
  const reason=old.some(x=>x.fingerprint!==hash)?'conflicting_same_version':t.status==='completed'?'provider_acceptance_required':['returned','reversed','failed'].includes(t.status)?'provider_'+t.status:null;
  if(reason)await c.query('INSERT INTO passport_reconciliation_exceptions(tenant_id,connection_id,transaction_reference,fingerprint,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tenant,id,t.transactionId,hash,reason]);
  await c.query("UPDATE passport_refresh_jobs SET status=CASE WHEN hint_version>leased_hint_version THEN 'queued' ELSE 'complete' END,available_at=now(),lease_token=NULL,lease_until=NULL,last_error_code=NULL,updated_at=now() WHERE id=$1",[jobId]);
  return {observed:1,automaticallyRecorded:0,reviewRequired:reason!==null};
 });}
 async checkpoint(tenant,id){return this.transaction(async c=>{await this.connection(c,tenant,id);const row=(await c.query('SELECT cursor,version FROM passport_poll_checkpoints WHERE tenant_id=$1 AND connection_id=$2',[tenant,id])).rows[0];return row||{cursor:null,version:'0'};});}
 // This accepts the INTERNAL normalized contract only. It does not decode real Passport JSON
 // or post payments. Every completion stays in review until provider certification is complete.
 async ingestPage(tenant,id,expectedVersion,items,nextCursor){
 if(!Array.isArray(items)||items.length>1000)throw new Error('Invalid page');
 if(nextCursor!==null&&(typeof nextCursor!=='string'||nextCursor.length>2048))throw new Error('Invalid cursor');
 const normalized=items.map(normalize);
 return this.transaction(async c=>{
 const connection=await this.connection(c,tenant,id);
 const prior=(await c.query('SELECT version FROM passport_poll_checkpoints WHERE tenant_id=$1 AND connection_id=$2',[tenant,id])).rows[0];
 if(String(prior?.version||0)!==String(expectedVersion))throw new Error('Checkpoint changed; reload before retry');
 for(const t of normalized){
 if(t.customerId!==connection.customer_reference||t.accountId!==connection.account_reference)throw new Error('Provider scope mismatch');
 const hash=createHash('sha256').update(JSON.stringify(t)).digest('hex');
 const old=(await c.query('SELECT fingerprint FROM passport_observations WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3 AND normalized_version=$4',[tenant,id,t.transactionId,t.version])).rows;
 await c.query('INSERT INTO passport_observations(tenant_id,connection_id,transaction_reference,normalized_version,fingerprint,normalized_metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[tenant,id,t.transactionId,t.version,hash,t]);
 const reason=old.some(x=>x.fingerprint!==hash)?'conflicting_same_version':t.status==='completed'?'provider_acceptance_required':['returned','reversed','failed'].includes(t.status)?'provider_'+t.status:null;
 if(reason)await c.query('INSERT INTO passport_reconciliation_exceptions(tenant_id,connection_id,transaction_reference,fingerprint,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tenant,id,t.transactionId,hash,reason]);
 }
 await c.query('INSERT INTO passport_poll_checkpoints(tenant_id,connection_id,cursor,version) VALUES($1,$2,$3,1) ON CONFLICT(connection_id) DO UPDATE SET cursor=$3,version=passport_poll_checkpoints.version+1,updated_at=now()',[tenant,id,nextCursor]);
 return {observed:normalized.length,automaticallyRecorded:0};
 });
 }
}
module.exports={DurableIntake,reference};
