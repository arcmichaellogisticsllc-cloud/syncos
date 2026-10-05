import {PreparedCashPosting} from './prepared-cash-posting';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {executeWriteAction} from '@syncos/shared';
import {PaymentRetainageAdjustmentsController} from './payment-retainage-adjustments.controller';
import type {AuthenticatedRequest} from './intelligence.types';
const {normalize}=require('@syncos/passport');
/** Exercises real financial transactions only on explicitly synthetic local databases.
 * No HTTP route or worker activates this seam. Live provider certification remains required.
 */
export class PreparedPaymentPosting {
 constructor(private readonly pool:Pool){}
 async rehearse(request:AuthenticatedRequest,connectionId:string,input:unknown){
  if((input as any)?.direction==='incoming')return new PreparedCashPosting(this.pool).rehearse(request,connectionId,input);
  const c=await this.pool.connect();try{
   const target=(await c.query('SELECT current_database() AS name,host(inet_server_addr()) AS address')).rows[0];
   if(!/^syncos_synthetic_[a-z0-9_]+$/.test(target.name)||!['127.0.0.1','::1',null].includes(target.address))throw Error('Posting rehearsal requires an explicitly synthetic localhost database');
   const t=normalize(input),tenant=request.auth.tenantId,hash=createHash('sha256').update(JSON.stringify(t)).digest('hex');
   return await executeWriteAction(c,{tenantId:tenant,actorUserId:request.auth.userId,action:'passport.posting_rehearsed',aggregateType:'passport',eventType:'passport.posting_rehearsed',write:async()=>{
    const connection=(await c.query('SELECT * FROM passport_connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,connectionId])).rows[0];
    if(!connection||connection.customer_reference!==t.customerId||connection.account_reference!==t.accountId)throw Error('Provider account does not match tenant connection');
    const observations=(await c.query('SELECT * FROM passport_observations WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3 ORDER BY normalized_version DESC',[tenant,connectionId,t.transactionId])).rows;
    const old=observations[0];
    const result=(value:any,retry=false)=>({entityType:'passport_connection',entityId:connectionId,afterState:value,skipEventAudit:retry});
    const issue=async(reason:string)=>{await c.query('INSERT INTO passport_reconciliation_exceptions(tenant_id,connection_id,transaction_reference,fingerprint,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tenant,connectionId,t.transactionId,hash,reason]);return result({outcome:'review_required',reason});};
    if(old&&BigInt(t.version)<BigInt(old.normalized_version))return result({outcome:'stale'},true);
    await c.query('INSERT INTO passport_observations(tenant_id,connection_id,transaction_reference,normalized_version,fingerprint,normalized_metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[tenant,connectionId,t.transactionId,t.version,hash,t]);
    if(observations.some(o=>o.normalized_metadata.direction!=='outgoing'))return issue('transaction_direction_changed');
    if(observations.some(o=>BigInt(o.normalized_version)===BigInt(t.version)&&o.fingerprint!==hash))return issue('conflicting_same_version');
    const prior=(await c.query('SELECT p.*,o.normalized_metadata FROM passport_recorded_payments p JOIN passport_observations o ON o.tenant_id=p.tenant_id AND o.id=p.observation_id WHERE p.tenant_id=$1 AND p.connection_id=$2 AND p.transaction_reference=$3',[tenant,connectionId,t.transactionId])).rows[0];
    if(prior){const recorded=prior.normalized_metadata;if(['returned','reversed','failed'].includes(t.status))return issue('recorded_payment_return_or_reversal');if(t.status!=='completed'||['amount','currency','payeeId','completedDate'].some(key=>recorded[key]!==t[key]))return issue('recorded_payment_changed');return result({outcome:'duplicate',payment_id:prior.external_partner_payment_id},true);}
    if(old&&['returned','reversed','failed'].includes(old.normalized_metadata.status)&&old.normalized_metadata.status!==t.status)return issue('terminal_status_changed');
    if(t.status==='pending')return result({outcome:'pending'});
    if(t.status!=='completed')return issue('provider_'+t.status);
    const mapping=(await c.query('SELECT * FROM passport_payable_mappings WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3',[tenant,connectionId,t.transactionId])).rows[0];
    if(!mapping)return issue('unmatched_payment');
    if(mapping.payee_reference!==t.payeeId)return issue('payee_mismatch');
    if(mapping.currency!==t.currency||String(mapping.amount)!==t.amount)return issue('amount_or_currency_mismatch');
    if(t.completedDate>new Date().toISOString().slice(0,10))return issue('future_completion_date');
    await c.query('SAVEPOINT financial_posting');
    try{
     const payment=await new PaymentRetainageAdjustmentsController(this.pool).recordExternalPaymentInTransaction(c,request,{contractor_payable_id:mapping.contractor_payable_id,amount:t.amount,payment_date:t.completedDate,method:'passport',reference:t.transactionId,evidence_reference:'Normalized observation '+hash,idempotency_key:'passport:'+connectionId+':'+t.transactionId,confirmed_completed:true});
     const observation=(await c.query('SELECT id FROM passport_observations WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3 AND normalized_version=$4 AND fingerprint=$5',[tenant,connectionId,t.transactionId,t.version,hash])).rows[0];
     await c.query('INSERT INTO passport_recorded_payments(tenant_id,connection_id,transaction_reference,observation_id,external_partner_payment_id) VALUES($1,$2,$3,$4,$5)',[tenant,connectionId,t.transactionId,observation.id,payment.entityId]);
     await c.query('RELEASE SAVEPOINT financial_posting');return {...result({outcome:'recorded',payment_id:payment.entityId}),additionalEvents:[{action:'partner_payment.external_recorded',aggregateType:'external_partner_payment',entityType:'external_partner_payment',entityId:payment.entityId,eventType:'partner_payment.external_recorded',afterState:payment.afterState}]};
    }catch(e){await c.query('ROLLBACK TO SAVEPOINT financial_posting');await c.query('RELEASE SAVEPOINT financial_posting');
     // Preserve operational failures for retry; only expected financial denials become review items.
     if(typeof (e as any).getStatus==='function'&&[400,403,404].includes((e as any).getStatus()))return issue('financial_controls_require_review');throw e;
    }
   }});
  }finally{c.release();}
 }
}
