import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { zipSync,strToU8 } from 'fflate';
import { requireInvoiceCommercialIntegrity } from './commercial-terms';
import { requireFinancialItemAcceptance } from './customer-accepted-billing';
export const packageHash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export function requiredInvoiceDocuments(value:unknown) {
 if(!Array.isArray(value)||value.length>30||value.some(v=>typeof v!=='string'||!v.trim()||v.length>100)||new Set(value.map(v=>typeof v==='string'?v.trim():v)).size!==value.length)throw new BadRequestException('Provide distinct document names required by the prime, or explicitly confirm none');
 return value.map(v=>v.trim()).sort();
}
export function assertDeliveryTransition(previous:string|null,next:string) {
 const allowed:Record<string,string[]>={prepared:['delivered'],delivered:['rejected','accepted'],rejected:['resubmitted'],resubmitted:['rejected','accepted'],accepted:[]};
 if(!allowed[previous??'prepared']?.includes(next))throw new BadRequestException('Record delivery, rejection, resubmission and acceptance in their actual order');
}
export async function invoicePackageFacts(c:PoolClient,tenant:string,id:string) {
 const invoice=(await c.query("SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status NOT IN ('voided','archived') FOR UPDATE",[tenant,id])).rows[0];
 if(!invoice||invoice.approval_status!=='approved')throw new BadRequestException('An approved invoice is required');
 const terms=await requireInvoiceCommercialIntegrity(c,tenant,invoice);
 const policy=(await c.query('SELECT * FROM invoice_package_policies WHERE tenant_id=$1 AND contract_id=$2 ORDER BY approved_at DESC,id DESC LIMIT 1',[tenant,terms.contract_id])).rows[0];
 if(!policy)throw new BadRequestException('Approve the prime invoice-package requirements before preparing a package');
 const items=(await c.query("SELECT * FROM invoice_items WHERE tenant_id=$1 AND invoice_id=$2 AND deleted_at IS NULL AND status NOT IN ('voided','archived') ORDER BY id",[tenant,id])).rows;
 const accepted=[];const evidenceIds=new Set<string>();
 for(const item of items){
  await requireFinancialItemAcceptance(c,tenant,item);
  const decision=(await c.query(`SELECT d.* FROM customer_qc_decisions d JOIN accepted_production_financial_sources s ON s.tenant_id=d.tenant_id AND s.customer_qc_decision_id=d.id WHERE s.tenant_id=$1 AND s.id=$2`,[tenant,item.accepted_production_source_id])).rows[0];
  if(!decision)throw new BadRequestException('Invoice item lacks a customer acceptance decision');
  accepted.push({production_record_id:item.production_record_id,decision_id:decision.id,accepted_quantity:decision.customer_accepted_quantity,unit:decision.unit_of_measure,quantity_review_id:decision.accepted_quantity_review_id,quantity_fingerprint:decision.accepted_quantity_fingerprint});
  for(const evidence of decision.accepted_evidence_ids??[])evidenceIds.add(evidence);
 }
 const evidence=(await c.query('SELECT id,file_name,mime_type,checksum,content_bytes,readability_status,captured_at,evidence_kind FROM syncfield_field_evidence WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[tenant,[...evidenceIds]])).rows;
 if(evidence.length!==evidenceIds.size||evidence.some(e=>e.readability_status!=='readable'||packageHash(e.content_bytes)!==e.checksum))throw new BadRequestException('Accepted evidence is missing, unreadable or fails its original checksum');
 const documents=(await c.query('SELECT DISTINCT ON(document_kind) * FROM invoice_package_documents WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY document_kind,reviewed_at DESC,id DESC',[tenant,id])).rows;
 const missing=requiredInvoiceDocuments(policy.required_documents).filter(kind=>!documents.some(d=>d.document_kind===kind));
 if(missing.length)throw new BadRequestException('Missing required invoice documents: '+missing.join(', '));
 if(documents.some(d=>packageHash(d.content_bytes)!==d.checksum))throw new BadRequestException('A billing document failed checksum verification');
 const customer=(await c.query('SELECT name FROM organizations WHERE tenant_id=$1 AND id=$2',[tenant,invoice.customer_organization_id])).rows[0];
 const manifest={invoice:{id:invoice.id,number:invoice.invoice_number,customer:customer?.name,invoice_date:invoice.invoice_date,subtotal:invoice.subtotal_amount,retainage:invoice.retainage_amount,total:invoice.total_amount,currency:invoice.currency},terms:{id:terms.id,payment_days:terms.payment_days,payment_trigger:terms.payment_trigger,time_zone:terms.time_zone,retainage_percent:terms.retainage_percent},policy:{id:policy.id,source:policy.source_reference,required_documents:policy.required_documents},items:items.map(i=>({id:i.id,description:i.description,quantity:i.quantity,unit:i.unit,unit_rate:i.unit_rate,gross:i.gross_amount,retainage:i.retainage_amount,net:i.net_amount})),accepted_work:accepted,evidence:evidence.map(({content_bytes,...e})=>e),documents:documents.map(d=>({id:d.id,kind:d.document_kind,file_name:d.file_name,checksum:d.checksum}))};
 return {invoice,terms,policy,manifest,source_fingerprint:packageHash(JSON.stringify(manifest)),files:[...evidence,...documents]};
}
export function buildInvoiceArchive(facts:Awaited<ReturnType<typeof invoicePackageFacts>>) {
 const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const m=facts.manifest;
 const files:Record<string,Uint8Array>={'manifest.json':strToU8(JSON.stringify(m,null,2)), 'invoice.html':strToU8(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Invoice ${escape(m.invoice.number)}</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:20px}td,th{text-align:left;padding:10px;border-bottom:1px solid #ccc}table{width:100%}</style><h1>Invoice ${escape(m.invoice.number)}</h1><p>${escape(m.invoice.customer)}</p><table><tr><th>Work</th><th>Quantity</th><th>Rate</th><th>Net amount</th></tr>${m.items.map(i=>`<tr><td>${escape(i.description)}</td><td>${escape(i.quantity)} ${escape(i.unit)}</td><td>${escape(i.unit_rate)}</td><td>${escape(i.net)}</td></tr>`).join('')}</table><p>Subtotal: ${escape(m.invoice.subtotal)} · Retainage: ${escape(m.invoice.retainage)} · Total: ${escape(m.invoice.total)} ${escape(m.invoice.currency)}</p><p>Payment: ${escape(m.terms.payment_days)} calendar days from ${escape(m.terms.payment_trigger.replaceAll('_',' '))}.</p><p>Original accepted evidence and reviewed billing documents accompany this invoice. Delivery and acceptance are recorded separately in SyncOS.</p></html>`)};
 let total=0;
 for(const f of facts.files){total+=f.content_bytes.length;if(total>100*1024*1024)throw new BadRequestException('Package exceeds 100 MiB; split the invoice into smaller accepted-work groups');files[`evidence/${f.id}-${String(f.file_name).replace(/[^a-zA-Z0-9._-]/g,'_')}`]=f.content_bytes;}
 return Buffer.from(zipSync(files,{level:0}));
}
