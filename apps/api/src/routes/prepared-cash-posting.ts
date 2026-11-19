import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {BadRequestException} from '@nestjs/common';
import {executeWriteAction} from '@syncos/shared';
import {CashController} from './cash.controller';
import {requireInvoiceCommercialIntegrity} from './commercial-terms';
import {requireFinancialItemAcceptance} from './customer-accepted-billing';
import type {AuthenticatedRequest} from './intelligence.types';
const {normalize}=require('@syncos/passport');

/** An internal incoming-receipt contract, deliberately separate from provider wire JSON.
 * No live route invokes this rehearsal. It shares cash application's transaction code.
 */
export class PreparedCashPosting {
 constructor(private readonly pool:Pool){}
 async rehearse(request:AuthenticatedRequest,connectionId:string,input:any){
  if(input?.direction!=='incoming')throw new Error('Incoming receipt required');
  const normalized=normalize({...input,payeeId:input.payerId,direction:'outgoing'});
  const {payeeId,...rest}=normalized,t={...rest,direction:'incoming',payerId:payeeId};
  const hash=createHash('sha256').update(JSON.stringify(t)).digest('hex'),tenant=request.auth.tenantId;
  const c=await this.pool.connect();try{
   const target=(await c.query('SELECT current_database() name,host(inet_server_addr()) address')).rows[0];
   if(!/^syncos_synthetic_[a-z0-9_]+$/.test(target.name)||!['127.0.0.1','::1',null].includes(target.address))throw Error('Posting rehearsal requires an explicitly synthetic localhost database');
   return await executeWriteAction(c,{tenantId:tenant,actorUserId:request.auth.userId,action:'passport.receipt_rehearsed',aggregateType:'passport',eventType:'passport.receipt_rehearsed',write:async()=>{
    const connection=(await c.query('SELECT * FROM passport_connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,connectionId])).rows[0];
    if(!connection||connection.customer_reference!==t.customerId||connection.account_reference!==t.accountId)throw Error('Provider account does not match tenant connection');
    const result=(value:any,duplicate=false)=>({entityType:'passport_connection',entityId:connectionId,afterState:value,skipEventAudit:duplicate});
    const issue=async(reason:string)=>{await c.query('INSERT INTO passport_reconciliation_exceptions(tenant_id,connection_id,transaction_reference,fingerprint,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tenant,connectionId,t.transactionId,hash,reason]);return result({outcome:'review_required',reason});};
    const history=(await c.query('SELECT * FROM passport_observations WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3 ORDER BY normalized_version DESC',[tenant,connectionId,t.transactionId])).rows;
    if(history[0]&&BigInt(t.version)<BigInt(history[0].normalized_version))return result({outcome:'stale'},true);
    await c.query('INSERT INTO passport_observations(tenant_id,connection_id,transaction_reference,normalized_version,fingerprint,normalized_metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[tenant,connectionId,t.transactionId,t.version,hash,t]);
    if(history.some(o=>o.normalized_metadata.direction!=='incoming'))return issue('transaction_direction_changed');
    if(history.some(o=>BigInt(o.normalized_version)===BigInt(t.version)&&o.fingerprint!==hash))return issue('conflicting_same_version');
    const prior=(await c.query('SELECT p.*,o.normalized_metadata FROM passport_recorded_receipts p JOIN passport_observations o ON o.tenant_id=p.tenant_id AND o.id=p.observation_id WHERE p.tenant_id=$1 AND p.connection_id=$2 AND p.transaction_reference=$3',[tenant,connectionId,t.transactionId])).rows[0];
    if(prior){if(['returned','reversed','failed'].includes(t.status))return issue('recorded_receipt_return_or_reversal');if(t.status!=='completed'||['amount','currency','payerId','completedDate'].some(k=>prior.normalized_metadata[k]!==t[k]))return issue('recorded_receipt_changed');return result({outcome:'duplicate',receipt_id:prior.cash_receipt_id},true);}
    if(history[0]&&['returned','reversed','failed'].includes(history[0].normalized_metadata.status)&&history[0].normalized_metadata.status!==t.status)return issue('terminal_status_changed');
    if(t.status==='pending')return result({outcome:'pending'});
    if(t.status!=='completed')return issue('provider_'+t.status);
    const mapping=(await c.query('SELECT * FROM passport_receivable_mappings WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3',[tenant,connectionId,t.transactionId])).rows[0];
    if(!mapping)return issue('unmatched_receipt');
    if(mapping.payer_reference!==t.payerId||mapping.currency!==t.currency||String(mapping.amount)!==t.amount)return issue('payer_amount_or_currency_mismatch');
    if(t.completedDate>new Date().toISOString().slice(0,10))return issue('future_completion_date');
    await c.query('SAVEPOINT financial_posting');
    try{
     const invoice=(await c.query('SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,mapping.invoice_id])).rows[0];
     if(!invoice||invoice.approval_status!=='approved'||invoice.customer_acceptance_status!=='accepted'||invoice.currency!==t.currency)throw new BadRequestException('Approved matching receivable required');
     await requireInvoiceCommercialIntegrity(c,tenant,invoice);
     const lines=(await c.query("SELECT * FROM invoice_items WHERE tenant_id=$1 AND invoice_id=$2 AND deleted_at IS NULL AND status NOT IN ('voided','archived')",[tenant,invoice.id])).rows;
     for(const line of lines)await requireFinancialItemAcceptance(c,tenant,line);
     await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant+':customer-receipt:'+t.transactionId]);
     if((await c.query('SELECT id FROM cash_receipts WHERE tenant_id=$1 AND external_transaction_id=$2',[tenant,t.transactionId])).rowCount)throw new BadRequestException('External receipt already recorded; explicit review required');
     const controller=new CashController(this.pool);
     const receipt=await controller.createCashReceiptInTransaction(c,request,{customer_organization_id:invoice.customer_organization_id??invoice.organization_id,gross_received_amount:t.amount,payment_date:t.completedDate,payment_method:'other',source_type:'processor_import_later',currency:t.currency,external_transaction_id:t.transactionId,payment_reference:t.transactionId,evidence_reference:'Normalized observation '+hash});
     const application=await controller.applyCashReceiptInTransaction(c,request,receipt.entityId,{invoice_id:invoice.id,applied_amount:t.amount,application_date:t.completedDate,note:'Normalized observation '+hash});
     const observation=(await c.query('SELECT id FROM passport_observations WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3 AND fingerprint=$4',[tenant,connectionId,t.transactionId,hash])).rows[0];
     await c.query('INSERT INTO passport_recorded_receipts(tenant_id,connection_id,transaction_reference,observation_id,cash_receipt_id,payment_application_id) VALUES($1,$2,$3,$4,$5,$6)',[tenant,connectionId,t.transactionId,observation.id,receipt.entityId,application.entityId]);
     await c.query('RELEASE SAVEPOINT financial_posting');
     return {...result({outcome:'recorded',receipt_id:receipt.entityId,application_id:application.entityId}),additionalEvents:[...(application.additionalEvents??[]),{action:'payment_application.create',aggregateType:'payment_application',entityType:'payment_application',entityId:application.entityId,eventType:'payment_application.created',afterState:application.afterState},{action:'passport.receipt_created',aggregateType:'cash_receipt',aggregateId:receipt.entityId,eventType:'cash_receipt.created',entityType:'cash_receipt',entityId:receipt.entityId,afterState:receipt.afterState}]};
    }catch(e){await c.query('ROLLBACK TO SAVEPOINT financial_posting');await c.query('RELEASE SAVEPOINT financial_posting');if(typeof (e as any).getStatus==='function'&&[400,403,404].includes((e as any).getStatus()))return issue('receivable_controls_require_review');throw e;}
   }});
  }finally{c.release();}
 }
}
