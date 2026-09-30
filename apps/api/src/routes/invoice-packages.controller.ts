import { BadRequestException,Body,Controller,Get,Inject,NotFoundException,Param,Post,Req,Res } from '@nestjs/common';
import type { Pool,PoolClient } from 'pg';
import type { Response } from 'express';
import { executeWriteAction,type WriteActionResult } from '@syncos/shared';
import { DATABASE_POOL } from '../modules/database.module';
import { RequirePermission } from '../security/require-permission.decorator';
import type { AuthenticatedRequest } from './intelligence.types';
import { requireString } from './intelligence.types';
import { absoluteTime } from './prime-correction-deadlines';
import { contractualDueDate } from './commercial-terms';
import { assertDeliveryTransition,buildInvoiceArchive,invoicePackageFacts,packageHash,requiredInvoiceDocuments } from './invoice-packages';
@Controller('invoice-packages')
export class InvoicePackagesController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 private async write(r:AuthenticatedRequest,action:string,fn:(c:PoolClient)=>Promise<WriteActionResult<any>>) {const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action,aggregateType:'invoice',eventType:action,write:fn});}finally{c.release();}}
 @Get('choices') @RequirePermission('invoice.read')
 async choices(@Req() r:AuthenticatedRequest){const c=await this.pool.connect();try{
  const invoices=(await c.query(`SELECT i.id,concat(i.invoice_number,' · ',o.name,' · $',i.balance_amount) AS label
   FROM invoices i LEFT JOIN organizations o ON o.tenant_id=i.tenant_id AND o.id=i.customer_organization_id
   WHERE i.tenant_id=$1 AND i.deleted_at IS NULL AND i.status NOT IN ('voided','archived') ORDER BY i.created_at DESC`,[r.auth.tenantId])).rows;
  return {invoices};
 }finally{c.release();}}
 @Post('contracts/:id/requirements') @RequirePermission('contract.update')
 async requirements(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  const required=requiredInvoiceDocuments(b.required_documents),source=requireString(b.source_reference,'Prime package requirements source is required');
  if(b.verified!==true||source.length>2000)throw new BadRequestException('Verify the prime invoice-package requirements against the approved source');
  return this.write(r,'invoice_package.policy_approved',async c=>{
   const agreement=(await c.query("SELECT id FROM contracts WHERE tenant_id=$1 AND id=$2 AND status='active' AND deleted_at IS NULL FOR SHARE",[r.auth.tenantId,id])).rows[0];
   if(!agreement)throw new NotFoundException('Active contract not found');
   const row=(await c.query('INSERT INTO invoice_package_policies(tenant_id,contract_id,required_documents,source_reference,approved_by) VALUES($1,$2,$3::jsonb,$4,$5) RETURNING *',[r.auth.tenantId,id,JSON.stringify(required),source,r.auth.userId])).rows[0];
   return {entityType:'invoice_package_policy',entityId:row.id,afterState:row};
  });
 }
 @Get('invoices/:id') @RequirePermission('invoice.read')
 async read(@Req() r:AuthenticatedRequest,@Param('id') id:string){const c=await this.pool.connect();try{
  const invoice=(await c.query('SELECT id,invoice_number,commercial_terms_revision_id,due_date,contract_trigger_at FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,id])).rows[0];if(!invoice)throw new NotFoundException('Invoice not found');
  const terms=(await c.query('SELECT * FROM commercial_terms_revisions WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,invoice.commercial_terms_revision_id])).rows[0];
  const policy=terms?(await c.query('SELECT * FROM invoice_package_policies WHERE tenant_id=$1 AND contract_id=$2 ORDER BY approved_at DESC,id DESC LIMIT 1',[r.auth.tenantId,terms.contract_id])).rows[0]:null;
  const packages=(await c.query('SELECT id,revision_number,archive_checksum,created_at,source_fingerprint FROM invoice_packages WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY revision_number DESC',[r.auth.tenantId,id])).rows;
  const events=(await c.query('SELECT * FROM invoice_delivery_events WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY event_sequence',[r.auth.tenantId,id])).rows;
  const documents=(await c.query('SELECT id,document_kind,file_name,checksum,reviewed_at FROM invoice_package_documents WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY reviewed_at DESC',[r.auth.tenantId,id])).rows;
  return {invoice,terms,policy,packages,events,documents};
 }finally{c.release();}}
 @Post('invoices/:id/documents') @RequirePermission('invoice.update')
 async document(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  const bytes=Buffer.from(String(b.content_base64??''),'base64'),kind=requireString(b.document_kind,'Document type is required'),name=requireString(b.file_name,'File name is required');
  if(b.verified!==true||!bytes.length||bytes.length>20*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||kind.length>100||name.length>240)throw new BadRequestException('Open and review the original PDF, up to 20 MiB, before adding it to the package');
  const checksum=packageHash(bytes);
  return this.write(r,'invoice_package.document_recorded',async c=>{
   const invoice=(await c.query("SELECT id FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status NOT IN ('voided','archived') FOR UPDATE",[r.auth.tenantId,id])).rows[0];if(!invoice)throw new NotFoundException('Invoice not found');
   const prior=(await c.query('SELECT id,file_name,checksum FROM invoice_package_documents WHERE tenant_id=$1 AND invoice_id=$2 AND document_kind=$3 AND checksum=$4',[r.auth.tenantId,id,kind,checksum])).rows[0];
   if(prior)return {entityType:'invoice_package_document',entityId:prior.id,afterState:prior,skipEventAudit:true};
   const row=(await c.query("INSERT INTO invoice_package_documents(tenant_id,invoice_id,document_kind,file_name,mime_type,content_bytes,checksum,reviewed_by) VALUES($1,$2,$3,$4,'application/pdf',$5,$6,$7) RETURNING id,file_name,checksum",[r.auth.tenantId,id,kind,name,bytes,checksum,r.auth.userId])).rows[0];
   return {entityType:'invoice_package_document',entityId:row.id,afterState:row};
  });
 }
 @Post('invoices/:id/prepare') @RequirePermission('invoice.update')
 async prepare(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.write(r,'invoice_package.prepared',async c=>{
  const facts=await invoicePackageFacts(c,r.auth.tenantId,id);
  const existing=(await c.query('SELECT id,revision_number,source_fingerprint FROM invoice_packages WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY revision_number DESC LIMIT 1',[r.auth.tenantId,id])).rows[0];
  if(existing?.source_fingerprint===facts.source_fingerprint)return {entityType:'invoice_package',entityId:existing.id,afterState:existing,skipEventAudit:true};
  const archive=buildInvoiceArchive(facts);
  const row=(await c.query('INSERT INTO invoice_packages(tenant_id,invoice_id,policy_id,revision_number,source_fingerprint,manifest,archive_bytes,archive_checksum,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id,revision_number,archive_checksum',[r.auth.tenantId,id,facts.policy.id,(existing?.revision_number??0)+1,facts.source_fingerprint,JSON.stringify(facts.manifest),archive,packageHash(archive),r.auth.userId])).rows[0];
  return {entityType:'invoice_package',entityId:row.id,afterState:row};
 });}
 @Get(':id/download') @RequirePermission('invoice.read')
 async download(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Res() res:Response){const c=await this.pool.connect();try{
  const row=(await c.query('SELECT id,revision_number,archive_bytes,archive_checksum FROM invoice_packages WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,id])).rows[0];if(!row)throw new NotFoundException('Package not found');if(packageHash(row.archive_bytes)!==row.archive_checksum)throw new BadRequestException('Package failed integrity verification');
  res.setHeader('Content-Type','application/zip');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`attachment; filename="invoice-package-${row.id}-r${row.revision_number}.zip"`);res.send(row.archive_bytes);
 }finally{c.release();}}
 @Post('invoices/:id/delivery') @RequirePermission('invoice.mark_sent')
 async delivery(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){if(!['delivered','rejected','resubmitted'].includes(String(b.event_type)))throw new BadRequestException('Choose a delivery, rejection or resubmission event');return this.event(r,id,b);}
 @Post('invoices/:id/acceptance') @RequirePermission('invoice.approve')
 async acceptance(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){return this.event(r,id,{...b,event_type:'accepted'});}
 private async event(r:AuthenticatedRequest,id:string,b:Record<string,unknown>){
  const type=String(b.event_type),time=absoluteTime(b.occurred_at,'Customer event time'),recipient=requireString(b.recipient,'Customer recipient is required'),proof=requireString(b.proof_reference,'Delivery or customer response proof is required'),notes=requireString(b.notes,'Event notes are required'),mutation=String(b.client_mutation_id??'');
  if(b.verified!==true||new Date(time).getTime()>Date.now()||[recipient,proof,notes].some(s=>s.length>2000)||!/^[0-9a-f-]{36}$/i.test(mutation))throw new BadRequestException('Verify the event, its actual time and supporting receipt');
  return this.write(r,'invoice_package.'+type,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.auth.tenantId+':invoice-event:'+mutation]);
   const prior=(await c.query('SELECT * FROM invoice_delivery_events WHERE tenant_id=$1 AND recorded_by=$2 AND client_mutation_id=$3',[r.auth.tenantId,r.auth.userId,mutation])).rows[0];
   if(prior){if(prior.invoice_id!==id||prior.package_id!==b.package_id||prior.event_type!==type||new Date(prior.occurred_at).toISOString()!==new Date(time).toISOString()||prior.recipient!==recipient||prior.proof_reference!==proof||prior.notes!==notes)throw new BadRequestException('Request identifier already belongs to another event');return {entityType:'invoice_delivery_event',entityId:prior.id,afterState:prior,skipEventAudit:true};}
   const facts=await invoicePackageFacts(c,r.auth.tenantId,id);
   const packet=(await c.query('SELECT * FROM invoice_packages WHERE tenant_id=$1 AND invoice_id=$2 AND id=$3',[r.auth.tenantId,id,b.package_id])).rows[0];
   if(!packet||packet.source_fingerprint!==facts.source_fingerprint)throw new BadRequestException('Prepare and deliver the current complete invoice package before recording its customer event');
   if(new Date(time)<new Date(packet.created_at))throw new BadRequestException('The event cannot precede preparation of this package');
   const last=(await c.query('SELECT * FROM invoice_delivery_events WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY event_sequence DESC LIMIT 1',[r.auth.tenantId,id])).rows[0];
   assertDeliveryTransition(last?.event_type??null,type);
   if(last&&new Date(time)<new Date(last.occurred_at))throw new BadRequestException('An event cannot precede the previous delivery event');
   if(['accepted','rejected'].includes(type)&&last.package_id!==packet.id)throw new BadRequestException('The customer response must refer to the package actually delivered');
   const row=(await c.query('INSERT INTO invoice_delivery_events(tenant_id,invoice_id,package_id,event_type,occurred_at,recipient,proof_reference,notes,client_mutation_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[r.auth.tenantId,id,packet.id,type,time,recipient,proof,notes,mutation,r.auth.userId])).rows[0];
   const triggers=(facts.terms.payment_trigger==='invoice_delivery'&&['delivered','resubmitted'].includes(type))||(facts.terms.payment_trigger==='invoice_acceptance'&&type==='accepted');
   const trigger=facts.invoice.contract_trigger_at?new Date(facts.invoice.contract_trigger_at).toISOString():triggers?time:null;
   const due=contractualDueDate(facts.terms,trigger);
   await c.query(`UPDATE invoices SET delivery_status=$3,customer_acceptance_status=$4,status='sent',contract_trigger_at=$5,contractual_due_at=$6,due_date=$7,sent_at=COALESCE(sent_at,$8),sent_by=COALESCE(sent_by,$9),updated_by=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2`,[r.auth.tenantId,id,type==='accepted'?'acknowledged':type==='rejected'?'rejected':'sent',type==='accepted'?'accepted':type==='rejected'?'rejected':'pending',trigger,due.due_at,due.due_date,time,r.auth.userId]);
   return {entityType:'invoice_delivery_event',entityId:row.id,afterState:row};
  });
 }
}
