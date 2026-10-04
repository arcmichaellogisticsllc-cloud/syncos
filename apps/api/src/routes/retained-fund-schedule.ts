import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { commercialTermsInput, contractualDueDate, unpaidInstallments } from './commercial-terms';
import { lockScheduleInputs, scheduleFingerprint } from './payable-schedule-freshness';
import { requirePartnerPayableLineage } from './partner-financial-lineage';
type Row=Record<string,any>;
export function retainedTermsInput(body:Row) {
 const trigger=String(body.payment_trigger??'');
 if(!['release_approval','customer_retainage_receipt','invoice_acceptance','other_contract_event'].includes(trigger))throw new BadRequestException('Choose the retained-fund trigger from the executed agreement');
 const source=String(body.source_reference??'').trim(), proof=String(body.trigger_proof_reference??'').trim();
 if(body.verified!==true||source.length<3||source.length>2000)throw new BadRequestException('Verify the retained-fund clause and provide its agreement reference');
 const terms=commercialTermsInput({...body,party_type:'partner',payment_trigger:'invoice_acceptance',retainage_percent:0,effective_from:'2000-01-01'});
 let occurred:string|null=null;
 if(trigger!=='release_approval') {
  occurred=String(body.trigger_occurred_at??'');
  contractualDueDate(terms,occurred);
  if(!occurred||!Number.isFinite(Date.parse(occurred))||Date.parse(occurred)>Date.now()||proof.length<3||proof.length>2000)throw new BadRequestException('Provide proof and the actual completed contract event time');
 }
 return {...terms,payment_trigger:trigger,source_reference:source,trigger_occurred_at:occurred,trigger_proof_reference:trigger==='release_approval'?null:proof};
}
export function allocateRetainedRelease(items:Row[],amount:number) {
 const cents=Math.round(amount*100);
 if(!Number.isSafeInteger(cents)||cents<=0||Math.abs(amount*100-cents)>1e-6)throw new BadRequestException('Release amount must be a positive exact cent amount');
 let remaining=cents;
 const result=items.map(item=>{
  const available=Math.round(Number(item.retainage_amount)*100)-Math.round(Number(item.released_amount??0)*100);
  if(!Number.isSafeInteger(available)||available<0)throw new BadRequestException('Reconcile retained item balances before release');
  const taken=Math.min(remaining,available); remaining-=taken;
  return {item,amount:taken/100};
 }).filter(row=>row.amount>0);
 if(remaining)throw new BadRequestException('Release exceeds source-linked retained funds');
 return result;
}
export async function calculateRetainedSchedule(c:PoolClient,tenant:string,payable:Row,user:string) {
 await lockScheduleInputs(c,tenant);
 const release=(await c.query(`SELECT r.*,t.payment_trigger,t.payment_days,t.payment_day_basis,t.time_zone,t.holidays,t.holiday_calendar_through,t.trigger_occurred_at,t.commercial_terms_revision_id FROM retainage_releases r JOIN retained_fund_release_terms t ON t.tenant_id=r.tenant_id AND t.retainage_release_id=r.id WHERE r.tenant_id=$1 AND r.release_payable_id=$2 AND r.status='released_to_payable' AND r.deleted_at IS NULL`,[tenant,payable.id])).rows[0];
 if(!release||release.commercial_terms_revision_id!==payable.commercial_terms_revision_id)throw new BadRequestException('Approve the retained-fund contract clock before calculating payment');
 const source=(await c.query('SELECT * FROM contractor_payables WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[tenant,release.contractor_payable_id])).rows[0];
 if(!source||['held','disputed','voided','archived','rejected'].includes(source.status)||source.hold_status==='hold'||['open','under_review'].includes(source.dispute_status))throw new BadRequestException('Resolve the source payable hold or dispute before paying retained funds');
 await requirePartnerPayableLineage(c,tenant,payable);
 const items=(await c.query(`SELECT i.*,s.retainage_amount AS source_retained FROM contractor_payable_items i JOIN contractor_payable_items s ON s.tenant_id=i.tenant_id AND s.id=i.source_retainage_item_id AND s.contractor_payable_id=$3 AND s.deleted_at IS NULL AND s.status NOT IN ('voided','archived') WHERE i.tenant_id=$1 AND i.contractor_payable_id=$2 AND i.deleted_at IS NULL AND i.status NOT IN ('voided','archived') ORDER BY i.id`,[tenant,payable.id,source.id])).rows;
 const overdrawn=(await c.query(`SELECT s.id FROM contractor_payable_items s JOIN contractor_payable_items r ON r.tenant_id=s.tenant_id AND r.source_retainage_item_id=s.id WHERE s.tenant_id=$1 AND s.contractor_payable_id=$2 GROUP BY s.id HAVING sum(r.net_payable_amount)>s.retainage_amount`,[tenant,source.id])).rows;
 if(overdrawn.length)throw new BadRequestException('Released amounts exceed original source-item retainage');
 if(!items.length||Math.round(items.reduce((sum,i)=>sum+Number(i.net_payable_amount),0)*100)!==Math.round(Number(release.release_amount)*100)||Number(payable.net_payable_amount)!==Number(release.release_amount))throw new BadRequestException('Retained release amount must match its source-linked items');
 const trigger=new Date(release.payment_trigger==='release_approval'?release.authorized_at:release.trigger_occurred_at).toISOString();
 const dates=contractualDueDate(release,trigger);
 const schedule=unpaidInstallments(items.map(i=>({allocation_id:i.id,contractor_payable_item_id:i.id,amount:Number(i.net_payable_amount),trigger_at:trigger,...dates})),Number(payable.paid_amount??0));
 const due=schedule.find(i=>i.outstanding_amount>0)?.due_date??null;
 const version=(await c.query('SELECT COALESCE(max(calculation_version),0)+1 AS next FROM contractor_payable_eligibility_snapshots WHERE tenant_id=$1 AND contractor_payable_id=$2',[tenant,payable.id])).rows[0].next;
 await c.query('UPDATE contractor_payable_items SET eligible_partner_amount=net_payable_amount WHERE tenant_id=$1 AND contractor_payable_id=$2',[tenant,payable.id]);
 const fingerprint=await scheduleFingerprint(c,tenant,payable.id);
 await c.query(`INSERT INTO contractor_payable_eligibility_snapshots(tenant_id,contractor_payable_id,calculation_version,cleared_customer_funds,allocated_customer_funds,eligible_partner_amount,status,eligible_at,payment_due_at,source_payment_application_ids,created_by_user_id,installments,source_fingerprint) VALUES($1,$2,$3,0,0,$4,'eligible',$5,$6,'{}'::uuid[],$7,$8::jsonb,$9)`,[tenant,payable.id,version,release.release_amount,trigger,due,user,JSON.stringify(schedule),fingerprint]);
 return (await c.query(`UPDATE contractor_payables SET eligible_amount=net_payable_amount,ineligible_amount=0,pay_when_paid_status='eligible',payment_readiness_status='ready_for_payment',payment_due_at=$3,eligible_at=$4,updated_by=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenant,payable.id,due,trigger,user])).rows[0];
}
