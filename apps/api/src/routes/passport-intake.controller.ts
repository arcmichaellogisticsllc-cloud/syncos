import {activityPage} from './activity-pagination';
import { BadRequestException,Body,Controller,Get,Inject,NotFoundException,Param,Post,Req } from '@nestjs/common';
import type { Pool,PoolClient } from 'pg';
import { executeWriteAction } from '@syncos/shared';
import { DATABASE_POOL } from '../modules/database.module';
import { RequirePermission } from '../security/require-permission.decorator';
import type { AuthenticatedRequest } from './intelligence.types';
import { requirePartnerPayableLineage } from './partner-financial-lineage';
const ref=(value:unknown)=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_.:]{1,160}$/.test(value))throw new BadRequestException('Use a non-sensitive account or transaction reference');return value;};
@Controller('passport-intake')
export class PassportIntakeController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Get() @RequirePermission('partner_payment.confirm')
 async read(@Req() req:AuthenticatedRequest){
  const c=await this.pool.connect();try{return {mode:'preparation',automaticRecordingEnabled:false,connections:(await c.query('SELECT * FROM passport_connections WHERE tenant_id=$1 ORDER BY created_at',[req.auth.tenantId])).rows,
  payables:(await activityPage(c,'SELECT id AS __history_id,created_at::text AS __history_time,id,payable_number,net_payable_amount FROM contractor_payables WHERE tenant_id=$1 AND partner_organization_id IS NOT NULL AND commercial_terms_revision_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200',[req.auth.tenantId],{before:req.query?.payables_before,history_q:req.query?.payables_q})).rows,
  mappings:(await activityPage(c,'SELECT id AS __history_id,approved_at::text AS __history_time,* FROM passport_payable_mappings WHERE tenant_id=$1 ORDER BY approved_at DESC LIMIT 200',[req.auth.tenantId],{before:req.query?.mappings_before,history_q:req.query?.mappings_q})).rows,
  exceptions:(await activityPage(c,'SELECT id AS __history_id,created_at::text AS __history_time,* FROM passport_reconciliation_exceptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200',[req.auth.tenantId],{before:req.query?.exceptions_before,history_q:req.query?.exceptions_q})).rows,
  jobs:(await activityPage(c,'SELECT id AS __history_id,updated_at::text AS __history_time,id,connection_id,transaction_reference,status,attempts,last_error_code,updated_at FROM passport_refresh_jobs WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 200',[req.auth.tenantId],{before:req.query?.jobs_before,history_q:req.query?.jobs_q})).rows};}finally{c.release();}
 }
 @Post('connections') @RequirePermission('admin.manage_users')
 async connection(@Req() req:AuthenticatedRequest,@Body() b:Record<string,unknown>){
  const customer=ref(b.customer_reference),account=ref(b.account_reference);
  return this.write(req,'connection_prepared',async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,86))',[customer+':'+account]);
   const prior=(await c.query('SELECT * FROM passport_connections WHERE customer_reference=$1 AND account_reference=$2',[customer,account])).rows[0];
   if(prior){if(prior.tenant_id!==req.auth.tenantId)throw new BadRequestException('Account is unavailable for this tenant');return {entityType:'passport_connection',entityId:prior.id,afterState:prior,skipEventAudit:true};}
   const row=(await c.query('INSERT INTO passport_connections(tenant_id,customer_reference,account_reference,created_by) VALUES($1,$2,$3,$4) RETURNING *',[req.auth.tenantId,customer,account,req.auth.userId])).rows[0];return {entityType:'passport_connection',entityId:row.id,afterState:row};
  });
 }
 @Post('connections/:id/mappings') @RequirePermission('partner_payment.confirm')
 async mapping(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  const transaction=ref(b.transaction_reference),payee=ref(b.payee_reference),evidence=String(b.evidence_reference??'').trim();
  if(b.account_and_payee_verified!==true||evidence.length<3||evidence.length>2000||typeof b.amount!=='string'||!/^([1-9]\d{0,11}|0)\.\d{2}$/.test(b.amount)||Number(b.amount)<=0||b.currency!=='USD')throw new BadRequestException('Verify account, payee, whole-cent USD amount and evidence');
  return this.write(req,'mapping_approved',async c=>{
   if(!(await c.query('SELECT id FROM passport_connections WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[req.auth.tenantId,id])).rowCount)throw new NotFoundException('Connection not found');
   const prior=(await c.query('SELECT * FROM passport_payable_mappings WHERE tenant_id=$1 AND connection_id=$2 AND transaction_reference=$3',[req.auth.tenantId,id,transaction])).rows[0];
   if(prior){if(prior.payee_reference!==payee||prior.contractor_payable_id!==b.contractor_payable_id||String(prior.amount)!==b.amount||prior.evidence_reference!==evidence)throw new BadRequestException('Approved mapping conflicts; use controlled review');return {entityType:'passport_mapping',entityId:prior.id,afterState:prior,skipEventAudit:true};}
   const payable=(await c.query('SELECT * FROM contractor_payables WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[req.auth.tenantId,b.contractor_payable_id])).rows[0];
   if(!payable?.partner_organization_id)throw new BadRequestException('Choose an accepted partner payable');
   await requirePartnerPayableLineage(c,req.auth.tenantId,payable);
   if(Number(b.amount)>Number(payable.net_payable_amount))throw new BadRequestException('Mapping exceeds payable amount');
   const row=(await c.query(`INSERT INTO passport_payable_mappings(tenant_id,connection_id,transaction_reference,payee_reference,contractor_payable_id,amount,currency,evidence_reference,approved_by) VALUES($1,$2,$3,$4,$5,$6,'USD',$7,$8) RETURNING *`,[req.auth.tenantId,id,transaction,payee,payable.id,b.amount,evidence,req.auth.userId])).rows[0];return {entityType:'passport_mapping',entityId:row.id,afterState:row};
  });
 }
 @Post('exceptions/:id/review') @RequirePermission('partner_payment.confirm')
 async review(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  const note=String(b.review_note??'').trim();if(note.length<3||note.length>2000)throw new BadRequestException('Document the review; this does not record or reverse money');
  return this.write(req,'exception_reviewed',async c=>{
   const before=(await c.query('SELECT * FROM passport_reconciliation_exceptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[req.auth.tenantId,id])).rows[0];if(!before)throw new NotFoundException('Exception not found');
   if(before.status==='reviewed'){if(before.review_note!==note)throw new BadRequestException('Review already recorded');return {entityType:'passport_exception',entityId:id,afterState:before,skipEventAudit:true};}
   const after=(await c.query("UPDATE passport_reconciliation_exceptions SET status='reviewed',reviewed_by=$3,review_note=$4,reviewed_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[req.auth.tenantId,id,req.auth.userId,note])).rows[0];return {entityType:'passport_exception',entityId:id,beforeState:before,afterState:after};
  });
 }
 private async write(req:AuthenticatedRequest,action:string,fn:(c:PoolClient)=>Promise<any>){const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:req.auth.tenantId,actorUserId:req.auth.userId,action:'passport.'+action,aggregateType:'passport',eventType:'passport.'+action,write:()=>fn(c)});}finally{c.release();}}
}
