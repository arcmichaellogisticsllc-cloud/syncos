import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { executeWriteAction } from '@syncos/shared';
import { DATABASE_POOL } from '../modules/database.module';
import { RequirePermission } from '../security/require-permission.decorator';
import type { AuthenticatedRequest } from './intelligence.types';
import { approvedRateSnapshot, commercialPreviewFingerprint, commercialTermsInput } from './commercial-terms';
@Controller('commercial-terms')
export class CommercialTermsController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool) {}
 private async preview(c:PoolClient,tenant:string,id:string,lock=false) {
  const schedule=(await c.query(`SELECT * FROM rate_schedules WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status='active' ${lock?'FOR SHARE':''}`,[tenant,id])).rows[0];
  if(!schedule?.contract_id)throw new BadRequestException('Choose an active rate schedule linked to an approved contract');
  const contract=(await c.query(`SELECT * FROM contracts WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status='active' ${lock?'FOR SHARE':''}`,[tenant,schedule.contract_id])).rows[0];
  if(!contract||contract.organization_id!==schedule.organization_id)throw new BadRequestException('The schedule and contract must belong to the same organization');
  const rates=(await c.query(`SELECT * FROM rate_codes WHERE tenant_id=$1 AND rate_schedule_id=$2 AND deleted_at IS NULL AND status='active' ORDER BY id ${lock?'FOR SHARE':''}`,[tenant,id])).rows;
  return {contract,schedule,rates,preview_fingerprint:commercialPreviewFingerprint(contract,schedule,rates)};
 }
 @Get('choices') @RequirePermission('contract.read')
 async choices(@Req() req:AuthenticatedRequest) {
  const c=await this.pool.connect();try {
   return {schedules:(await c.query(`SELECT r.id,r.name, o.name AS organization_name FROM rate_schedules r JOIN contracts a ON a.tenant_id=r.tenant_id AND a.id=r.contract_id AND a.organization_id=r.organization_id JOIN organizations o ON o.tenant_id=r.tenant_id AND o.id=r.organization_id WHERE r.tenant_id=$1 AND r.deleted_at IS NULL AND r.status='active' AND a.deleted_at IS NULL AND a.status='active' ORDER BY o.name,r.name`,[req.auth.tenantId])).rows};
  }finally{c.release();}
 }
 @Get('rate-schedules/:id') @RequirePermission('contract.read')
 async read(@Req() req:AuthenticatedRequest,@Param('id') id:string) {
  const c=await this.pool.connect();try{return {...await this.preview(c,req.auth.tenantId,id),revisions:(await c.query('SELECT * FROM commercial_terms_revisions WHERE tenant_id=$1 AND rate_schedule_id=$2 ORDER BY revision_number DESC',[req.auth.tenantId,id])).rows};}finally{c.release();}
 }
 @Post('rate-schedules/:id/approve') @RequirePermission('contract.update')
 async approve(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() body:Record<string,unknown>) {
  const terms=commercialTermsInput(body),source=String(body.source_reference??'').trim(),mutation=String(body.client_mutation_id??'');
  if(body.verified!==true||source.length<3||source.length>2000||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mutation))throw new BadRequestException('Confirm the executed agreement and pricing, provide its source and a valid request identifier');
  const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:req.auth.tenantId,actorUserId:req.auth.userId,action:'commercial_terms.approve',aggregateType:'commercial_terms_revision',eventType:'commercial_terms.approved',write:async()=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.auth.tenantId+':commercial-terms']);
   const prior=(await c.query('SELECT * FROM commercial_terms_revisions WHERE tenant_id=$1 AND approved_by=$2 AND client_mutation_id=$3',[req.auth.tenantId,req.auth.userId,mutation])).rows[0];
   if(prior){
    const comparable={...prior,effective_from:typeof prior.effective_from==='string'?prior.effective_from:prior.effective_from.toISOString().slice(0,10),effective_until:prior.effective_until?(typeof prior.effective_until==='string'?prior.effective_until:prior.effective_until.toISOString().slice(0,10)):null};
    if(prior.rate_schedule_id!==id||prior.source_reference!==source||JSON.stringify(commercialTermsInput(comparable))!==JSON.stringify(terms))throw new BadRequestException('This request identifier belongs to a different approval');
    return {entityType:'commercial_terms_revision',entityId:prior.id,afterState:prior,skipEventAudit:true};
   }
   const p=await this.preview(c,req.auth.tenantId,id,true);
   if(body.preview_fingerprint!==p.preview_fingerprint)throw new BadRequestException('The contract or rates changed. Refresh and review them before approval');
   const rates=approvedRateSnapshot(p.rates,terms.party_type);
   const revision=(await c.query('SELECT COALESCE(max(revision_number),0)+1 AS next FROM commercial_terms_revisions WHERE tenant_id=$1 AND rate_schedule_id=$2 AND party_type=$3',[req.auth.tenantId,id,terms.party_type])).rows[0].next;
   const row=(await c.query(`INSERT INTO commercial_terms_revisions(tenant_id,contract_id,rate_schedule_id,counterparty_organization_id,party_type,revision_number,effective_from,effective_until,payment_trigger,payment_days,time_zone,retainage_percent,rate_snapshot,source_reference,approved_by,client_mutation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16) RETURNING *`,[req.auth.tenantId,p.contract.id,id,p.contract.organization_id,terms.party_type,revision,terms.effective_from,terms.effective_until,terms.payment_trigger,terms.payment_days,terms.time_zone,terms.retainage_percent,JSON.stringify(rates),source,req.auth.userId,mutation])).rows[0];
   return {entityType:'commercial_terms_revision',entityId:row.id,afterState:row};
  }});}finally{c.release();}
 }
}
