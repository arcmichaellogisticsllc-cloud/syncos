import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { absoluteTime } from './prime-correction-deadlines';
const { DateTime, IANAZone } = require('luxon');
type Row = Record<string, any>;
export function commercialTermsInput(b:Row) {
  const party_type=String(b.party_type),payment_trigger=String(b.payment_trigger),time_zone=String(b.time_zone);
  const payment_days=Number(b.payment_days),retainage_percent=Number(b.retainage_percent);
  if(!['customer','partner'].includes(party_type)||!['invoice_issue','invoice_delivery','invoice_acceptance','customer_payment'].includes(payment_trigger)||party_type==='customer'&&payment_trigger==='customer_payment')throw new BadRequestException('Choose the agreement party and approved payment trigger');
  if(b.payment_days==null||b.payment_days===''||!Number.isInteger(payment_days)||payment_days<0||payment_days>3660)throw new BadRequestException('Provide approved payment days between 0 and 3660');
  if(b.retainage_percent==null||b.retainage_percent===''||!Number.isFinite(retainage_percent)||retainage_percent<0||retainage_percent>100||Math.abs(retainage_percent*100-Math.round(retainage_percent*100))>1e-8)throw new BadRequestException('Provide approved retainage from 0 to 100 with at most two decimal places');
  if(!IANAZone.isValidZone(time_zone))throw new BadRequestException('Provide the agreement time zone');
  const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&DateTime.fromISO(v).isValid;
  if(!date(b.effective_from)||b.effective_until!=null&&!date(b.effective_until)||b.effective_until&&b.effective_until<b.effective_from)throw new BadRequestException('Provide valid agreement effective dates');
  return {party_type,payment_trigger,payment_days,time_zone,retainage_percent,effective_from:b.effective_from as string,effective_until:b.effective_until??null};
}
export function canonicalRateUnit(unit:unknown) {const u=String(unit).trim().toUpperCase();return ({FEET:'LF',EACH:'EA',HOURS:'HR'} as Row)[u]??u;}
export function approvedRateSnapshot(rows:Row[],party:string) {
  const seen=new Set<string>();
  if(!rows.length)throw new BadRequestException('The schedule needs approved rates');
  return rows.map(r=>{
    const unit=canonicalRateUnit(r.unit),key=String(r.code)+'|'+unit;
    const raw=party==='customer'?(r.customer_rate??r.amount):r.contractor_rate,rate=Number(raw);
    if(raw==null||!Number.isFinite(rate)||rate<=0||Math.abs(rate*100-Math.round(rate*100))>1e-6)throw new BadRequestException('Every approved rate must be positive with at most two decimal places');
    if(seen.has(key))throw new BadRequestException('Resolve duplicate production codes and units before approving rates');
    seen.add(key);return {id:String(r.id),code:String(r.code),unit,rate,description:String(r.description??r.code)};
  }).sort((a,b)=>(a.code+'|'+a.unit).localeCompare(b.code+'|'+b.unit));
}
export function commercialPreviewFingerprint(contract:Row,schedule:Row,rows:Row[]) {
  return createHash('sha256').update(JSON.stringify({contract,schedule,rates:[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)))})).digest('hex');
}
export async function approvedCommercialTerms(c:PoolClient,tenant:string,schedule:unknown,party:string,counterparty:unknown,workDate:unknown) {
  const result=await c.query(`SELECT t.* FROM commercial_terms_revisions t
    JOIN contracts agreement ON agreement.tenant_id=t.tenant_id AND agreement.id=t.contract_id
    WHERE t.tenant_id=$1 AND t.rate_schedule_id=$2 AND t.party_type=$3 AND t.counterparty_organization_id=$4
      AND t.effective_from<=$5::date AND (t.effective_until IS NULL OR t.effective_until>=$5::date)
      AND agreement.organization_id=t.counterparty_organization_id AND agreement.deleted_at IS NULL AND agreement.status IN ('active','expired')
    ORDER BY t.revision_number DESC LIMIT 1`,[tenant,schedule,party,counterparty,workDate]);
  if(!result.rows[0])throw new BadRequestException(`Approve ${party} agreement terms and rates covering the work date before advancing finance`);
  return result.rows[0];
}
export function rateFromTerms(terms:Row,code:unknown,unit:unknown) {
  const row=terms.rate_snapshot.find((r:Row)=>r.code===code&&r.unit===canonicalRateUnit(unit));
  if(!row)throw new BadRequestException('The approved agreement has no matching production code and unit');
  return {...row,rate_schedule_id:terms.rate_schedule_id,terms_revision_id:terms.id};
}
export function invoiceTermsAmounts(subtotal:number,percent:number) {
  const cents=Math.round(subtotal*100);
  if(!Number.isSafeInteger(cents)||cents<0||!Number.isFinite(percent)||percent<0||percent>100)throw new BadRequestException('Invoice amount or retainage is invalid');
  const retained=Math.round(cents*percent/100);return {subtotal:cents/100,retainage:retained/100,total:(cents-retained)/100};
}
export function contractualDueDate(terms:Row,trigger:string|null) {
  if(!trigger)return {due_at:null,due_date:null};
  const start=DateTime.fromISO(absoluteTime(trigger,'Contract payment trigger')).setZone(terms.time_zone);
  const due=start.plus({days:terms.payment_days});
  if(!due.isValid)throw new BadRequestException('Contract due date is invalid');
  return {due_at:due.toUTC().toISO() as string,due_date:due.toISODate() as string};
}
export async function invoiceCommercialTerms(c:PoolClient,tenant:string,billables:Row[]) {
  if(!billables.length)throw new BadRequestException('Select accepted billable work');
  const ids=[...new Set(billables.map(b=>b.accepted_production_source_id))];
  if(ids.some(id=>!id))throw new BadRequestException('Billable work needs approved agreement pricing and accepted-work provenance');
  const sources=(await c.query('SELECT * FROM accepted_production_financial_sources WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL AND financial_status<>\'void\'',[tenant,ids])).rows;
  if(sources.length!==ids.length||sources.some(s=>!s.customer_terms_revision_id))throw new BadRequestException('Review agreement pricing before invoicing historical work');
  const termsIds=[...new Set(sources.map(s=>s.customer_terms_revision_id))];
  if(termsIds.length!==1)throw new BadRequestException('Create separate invoices for different approved agreement revisions');
  const terms=(await c.query('SELECT * FROM commercial_terms_revisions WHERE tenant_id=$1 AND id=$2 AND party_type=\'customer\'',[tenant,termsIds[0]])).rows[0];
  if(!terms||billables.some(b=>b.customer_organization_id!==terms.counterparty_organization_id))throw new BadRequestException('Invoice customer does not match the approved agreement');
  for(const b of billables){const source=sources.find(s=>s.id===b.accepted_production_source_id);
    if(!source||Number(b.unit_rate)!==Number(source.customer_rate)||Math.abs(Number(b.net_billable_amount)-Number(source.customer_extended_amount))>0.001||Number(b.billable_quantity)!==Number(source.accepted_quantity))throw new BadRequestException('Billable amount must match the locked approved rate and accepted quantity');
  }
  return terms;
}
export function allocateRetainage(amounts:number[],percent:number) {
 const total=invoiceTermsAmounts(amounts.reduce((a,b)=>a+b,0),percent).retainage;
 let remaining=Math.round(total*100),remainingGross=amounts.reduce((a,b)=>a+Math.round(b*100),0);
 return amounts.map(amount=>{const cents=Math.round(amount*100),retained=remainingGross?Math.min(cents,Math.round(remaining*cents/remainingGross)):0;remaining-=retained;remainingGross-=cents;return {retainage:retained/100,net:(cents-retained)/100};});
}
export async function requireInvoiceCommercialIntegrity(c:PoolClient,tenant:string,invoice:Row) {
 const billables=(await c.query(`SELECT b.*,row_to_json(i) AS invoice_line FROM invoice_items i LEFT JOIN settlement_items s ON s.tenant_id=i.tenant_id AND s.id=i.settlement_item_id JOIN billable_items b ON b.tenant_id=i.tenant_id AND b.id=COALESCE(i.billable_item_id,s.billable_item_id) WHERE i.tenant_id=$1 AND i.invoice_id=$2 AND i.deleted_at IS NULL AND i.status NOT IN ('voided','archived') ORDER BY i.id`,[tenant,invoice.id])).rows;
 const counts=(await c.query("SELECT count(*)::int AS count FROM invoice_items WHERE tenant_id=$1 AND invoice_id=$2 AND deleted_at IS NULL AND status NOT IN ('voided','archived')",[tenant,invoice.id])).rows[0];
 if(counts.count!==billables.length)throw new BadRequestException('Every invoice item needs accepted-work and approved-rate provenance');
 const terms=await invoiceCommercialTerms(c,tenant,billables);
 const seen=new Set<string>();
 for(const b of billables){const line=b.invoice_line;
  if(seen.has(b.id))throw new BadRequestException('Accepted work cannot appear more than once on an invoice');seen.add(b.id);
  if(Number(line.quantity)!==Number(b.billable_quantity)||canonicalRateUnit(line.unit)!==canonicalRateUnit(b.unit)||Number(line.unit_rate)!==Number(b.unit_rate)||Math.abs(Number(line.gross_amount)-Number(b.net_billable_amount))>0.001||Math.abs(Number(line.gross_amount)-Number(line.retainage_amount)-Number(line.net_amount))>0.001||Number(line.retainage_amount)<0||Number(line.net_amount)<0)throw new BadRequestException('Invoice line quantities, rates and amounts must match approved accepted work');
 }
 const lineRetainage=billables.reduce((sum,b)=>sum+Number(b.invoice_line.retainage_amount),0);
 if(Math.abs(lineRetainage-Number(invoice.retainage_amount))>0.001)throw new BadRequestException('Invoice line retainage must match the approved invoice total');
 const amounts=invoiceTermsAmounts(billables.reduce((sum,b)=>sum+Number(b.net_billable_amount),0),Number(terms.retainage_percent));
 if(invoice.commercial_terms_revision_id!==terms.id||Math.abs(Number(invoice.subtotal_amount)-amounts.subtotal)>0.001||Math.abs(Number(invoice.total_amount)-amounts.total)>0.001||Math.abs(Number(invoice.retainage_amount)-amounts.retainage)>0.001)throw new BadRequestException('Invoice terms or totals differ from approved accepted work; reconcile before approval or delivery');
 return terms;
}
export async function partnerSettlementTerms(c:PoolClient,tenant:string,settlement:string) {
 const rows=(await c.query(`SELECT DISTINCT t.* FROM settlement_items i JOIN accepted_production_financial_sources s ON s.tenant_id=i.tenant_id AND s.id=i.accepted_production_source_id LEFT JOIN commercial_terms_revisions t ON t.tenant_id=s.tenant_id AND t.id=s.partner_terms_revision_id WHERE i.tenant_id=$1 AND i.settlement_id=$2 AND i.deleted_at IS NULL AND i.status NOT IN ('voided','archived')`,[tenant,settlement])).rows;
 if(rows.length!==1||!rows[0]?.id||rows[0].party_type!=='partner')throw new BadRequestException('A partner payable must use one approved partner agreement revision; reconcile historical or mixed terms first');
 return rows[0];
}
