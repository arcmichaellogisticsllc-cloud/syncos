import { BadRequestException,Body,Controller,Get,Inject,NotFoundException,Param,Post,Query,Req } from '@nestjs/common';
import type {Pool} from 'pg';
import {executeWriteAction} from '@syncos/shared';
import {DATABASE_POOL} from '../modules/database.module';
import {RequirePermission} from '../security/require-permission.decorator';
import {requireString,type AuthenticatedRequest} from './intelligence.types';
import {productionQuantityFingerprint,assertQuantityRelationship,requireReviewedProductionQuantity,productionQuantitySource,quantityReviewFingerprint} from './production-quantity-integrity';
@Controller('production-quantity')
export class ProductionQuantityReviewController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Get(':id/candidates') @RequirePermission('customer_qc.completeness_review')
 async candidates(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Query('search') search=''){
  const c=await this.pool.connect();try{
   const record=(await c.query('SELECT work_order_id FROM production_records WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,id])).rows[0];
   if(!record)throw new NotFoundException('Production record not found');
   const rows=(await c.query(`SELECT p.id,q.canonical_reference FROM production_records p
     JOIN production_quantity_reviews q ON q.tenant_id=p.tenant_id AND q.id=p.quantity_review_id
     WHERE p.tenant_id=$1 AND p.work_order_id=$2 AND p.id<>$3 AND p.deleted_at IS NULL AND q.disposition IN ('primary_work','additional_work')
       AND p.status NOT IN ('voided','archived','cancelled')
       AND (q.canonical_reference ILIKE $4 OR p.asset_identifier ILIKE $4 OR p.from_asset_identifier ILIKE $4 OR p.to_asset_identifier ILIKE $4)
     ORDER BY p.production_date DESC,p.id LIMIT 100`,[r.auth.tenantId,record.work_order_id,id,`%${String(search).slice(0,200)}%`])).rows;
   const choices=[];for(const row of rows){try{const reviewed=await requireReviewedProductionQuantity(c,r.auth.tenantId,row.id);const source=reviewed.record;choices.push({id:row.id,label:`${row.canonical_reference} · ${Number(source.quantity_submitted)} ${source.unit??source.unit_type} · ${source.asset_identifier??[source.from_asset_identifier,source.to_asset_identifier].filter(Boolean).join(' → ')}`});}catch(error){if(!(error instanceof BadRequestException))throw error;}}
   return choices;
  }finally{c.release();}
 }
 @Post(':id/review') @RequirePermission('customer_qc.completeness_review')
 async review(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  const disposition=requireString(b.disposition,'Choose how this quantity relates to the work');
  if(!['primary_work','additional_work','included_subset','summary'].includes(disposition))throw new BadRequestException('Invalid quantity disposition');
  const key=requireString(b.client_mutation_id,'A review request identity is required');
  if(!/^[0-9a-f-]{36}$/i.test(key))throw new BadRequestException('Invalid review request identity');
  const source=requireString(b.source_reference,'Governing work or additional-work approval reference is required');
  const notes=requireString(b.review_notes,'Quantity reconciliation findings are required');
  const refs=b.related_record_ids??[];
  if(!Array.isArray(refs)||refs.some(v=>typeof v!=='string'||!/^[0-9a-f-]{36}$/i.test(v))||new Set(refs).size!==refs.length||refs.includes(id)||refs.length>200)throw new BadRequestException('Select distinct underlying production records');
  const canonical=['primary_work','additional_work'].includes(disposition)?requireString(b.canonical_reference,'Stable work-item reference is required').trim().replace(/\s+/g,' ').toLowerCase():null;
  if(canonical&&canonical.length>200)throw new BadRequestException('Work-item reference must be 200 characters or fewer');
  const c=await this.pool.connect();
  try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action:'production.quantity_review',eventType:'production.quantity_reviewed',aggregateType:'production_record',write:async client=>{
   // Serialize quantity classification across related records to prevent cycles or duplicate claims.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${r.auth.tenantId}:quantity-review`]);
   const prior=(await client.query('SELECT * FROM production_quantity_reviews WHERE tenant_id=$1 AND reviewed_by=$2 AND client_mutation_id=$3',[r.auth.tenantId,r.auth.userId,key])).rows[0];
   if(prior){if(prior.production_record_id!==id||prior.disposition!==disposition||prior.canonical_reference!==canonical||prior.source_reference!==source||prior.review_notes!==notes||JSON.stringify(prior.related_record_ids)!==JSON.stringify(refs))throw new BadRequestException('Review retry changed; start a new review');return {entityType:'production_record',entityId:id,afterState:prior,skipEventAudit:true};}
   const locked=(await client.query('SELECT id FROM production_records WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[r.auth.tenantId,id])).rows[0];
   if(!locked)throw new NotFoundException('Production record not found');
   const record=await productionQuantitySource(client,r.auth.tenantId,id);
   if(!record.work_order_id||!['submitted','under_review','qc_review','correction_required','corrected'].includes(record.status))throw new BadRequestException('Review a submitted work-order production record');
   const financiallyUsed=await client.query("SELECT id FROM billable_items WHERE tenant_id=$1 AND production_record_id=$2 AND deleted_at IS NULL AND status NOT IN ('voided','archived') UNION ALL SELECT id FROM accepted_production_financial_sources WHERE tenant_id=$1 AND production_record_id=$2 AND deleted_at IS NULL AND financial_status<>'void' UNION ALL SELECT id FROM settlement_items WHERE tenant_id=$1 AND production_record_id=$2 AND deleted_at IS NULL AND status NOT IN ('voided','archived') LIMIT 1",[r.auth.tenantId,id]);
   if(financiallyUsed.rows.length)throw new BadRequestException('This work has financial records; reconcile them through controlled adjustments before changing quantity classification');
   const related=[];
   for(const relatedId of [...refs].sort()){
    const entry=await requireReviewedProductionQuantity(client,r.auth.tenantId,relatedId);
    if(entry.record.work_order_id!==record.work_order_id||(entry.record.unit??entry.record.unit_type)!==(record.unit??record.unit_type))throw new BadRequestException('Underlying work must share this work order and unit');
    related.push(Number(entry.record.quantity_submitted??entry.record.quantity));
   }
   assertQuantityRelationship(disposition,Number(record.quantity_submitted??record.quantity),related);
   if(disposition==='primary_work' && (record.asset_identifier || (record.from_asset_identifier && record.to_asset_identifier))){
    const duplicate=await client.query(`SELECT p.id FROM production_records p
      JOIN production_quantity_reviews q ON q.tenant_id=p.tenant_id AND q.id=p.quantity_review_id
      WHERE p.tenant_id=$1 AND p.work_order_id=$2 AND p.id<>$3 AND p.deleted_at IS NULL
      AND p.status NOT IN ('voided','archived','cancelled') AND q.disposition IN ('primary_work','additional_work')
      AND p.syncfield_production_code_id IS NOT DISTINCT FROM $4::uuid AND p.rate_code_id IS NOT DISTINCT FROM $5::uuid
      AND ((NULLIF(trim($6::text),'') IS NOT NULL AND lower(trim(p.asset_identifier))=lower(trim($6))) OR
       (NULLIF(trim($7::text),'') IS NOT NULL AND NULLIF(trim($8::text),'') IS NOT NULL AND
        ((lower(trim(p.from_asset_identifier))=lower(trim($7)) AND lower(trim(p.to_asset_identifier))=lower(trim($8))) OR
         (lower(trim(p.from_asset_identifier))=lower(trim($8)) AND lower(trim(p.to_asset_identifier))=lower(trim($7)))))) LIMIT 1`,
      [r.auth.tenantId,record.work_order_id,id,record.syncfield_production_code_id,record.rate_code_id,record.asset_identifier,record.from_asset_identifier,record.to_asset_identifier]);
    if(duplicate.rows.length)throw new BadRequestException('This asset or route already has reviewed work. Classify the reference or record separately approved additional work');
   }
   if(canonical){
    const existing=(await client.query('SELECT * FROM production_work_item_registry WHERE tenant_id=$1 AND (production_record_id=$2 OR (work_order_id=$3 AND canonical_reference=$4))',[r.auth.tenantId,id,record.work_order_id,canonical])).rows;
    if(existing.some(e=>e.production_record_id!==id||e.canonical_reference!==canonical))throw new BadRequestException('Work identity is already registered; use its correction history rather than another work item');
    await client.query('INSERT INTO production_work_item_registry(tenant_id,work_order_id,canonical_reference,production_record_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,production_record_id) DO NOTHING',[r.auth.tenantId,record.work_order_id,canonical,id]);
   }
   const review=(await client.query('INSERT INTO production_quantity_reviews(tenant_id,production_record_id,disposition,canonical_reference,related_record_ids,source_fingerprint,source_reference,review_notes,reviewed_by,client_mutation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[r.auth.tenantId,id,disposition,canonical,refs,await quantityReviewFingerprint(client,r.auth.tenantId,record,refs),source,notes,r.auth.userId,key])).rows[0];
   await client.query('UPDATE production_records SET quantity_review_id=$3 WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,id,review.id]);
   return {entityType:'production_record',entityId:id,beforeState:{quantity_review_id:record.quantity_review_id},afterState:review};
  }});}finally{c.release();}
 }
}
