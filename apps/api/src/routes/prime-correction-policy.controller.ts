import { BadRequestException,Body,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Req } from '@nestjs/common';
import type { Pool,PoolClient } from 'pg';
import { executeWriteAction } from '@syncos/shared';
import { DATABASE_POOL } from '../modules/database.module';
import { RequirePermission } from '../security/require-permission.decorator';
import { requireString,type AuthenticatedRequest } from './intelligence.types';
import { correctionPolicyInput,scheduleCorrectionDeadline,verifiedReceivedTime } from './prime-correction-deadlines';
@Controller('prime-correction-policies')
export class PrimeCorrectionPolicyController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 private async canManage(c:PoolClient,r:AuthenticatedRequest){
  return Boolean((await c.query(`SELECT 1 FROM tenant_users tu JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id
   JOIN roles role ON role.tenant_id=ur.tenant_id AND role.id=ur.role_id AND role.deleted_at IS NULL
   WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL AND ur.scope_type='tenant'
    AND role.system_key IN ('operations_manager','project_manager','qc_manager','executive') LIMIT 1`,[r.auth.tenantId,r.auth.userId])).rows.length);
 }
 @Get('reports/:id') @RequirePermission('daily_production.completeness_read')
 async report(@Req() r:AuthenticatedRequest,@Param('id') id:string){
  const c=await this.pool.connect();try{
   const report=(await c.query('SELECT work_order_version_id FROM daily_production_reports WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,id])).rows[0];
   if(!report)throw new NotFoundException('Report not found');
   const policies=(await c.query('SELECT * FROM prime_correction_policies WHERE tenant_id=$1 AND work_order_version_id=$2 ORDER BY revision_number DESC',[r.auth.tenantId,report.work_order_version_id])).rows;
   const corrections=(await c.query(`SELECT correction.id,correction.status,correction.partner_safe_instructions,correction.deadline_status,correction.due_at,correction.due_date,
     correction.deadline_time_zone,correction.deadline_trigger_at,correction.customer_received_at,correction.deadline_policy_id,
     correction.responsible_user_id,u.display_name AS responsible_name FROM production_corrections correction
     LEFT JOIN users u ON u.id=correction.responsible_user_id WHERE correction.tenant_id=$1 AND correction.daily_report_id=$2 AND correction.deleted_at IS NULL ORDER BY correction.created_at`,[r.auth.tenantId,id])).rows;
   return {work_order_version_id:report.work_order_version_id,can_manage:await this.canManage(c,r),policies,corrections};
  }finally{c.release();}
 }
 @Post('work-orders/:id') @RequirePermission('customer_qc.decision_record')
 async approve(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  const policy=correctionPolicyInput(b),source=requireString(b.source_reference,'Approved prime policy reference required');
  const key=requireString(b.client_mutation_id,'Policy request identity required');
  if(!/^[0-9a-f-]{36}$/i.test(key))throw new BadRequestException('Invalid request identity');
  if(b.verified!==true)throw new BadRequestException('Confirm the governing prime policy and holiday calendar');
  const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action:'qc.correction_policy_approved',eventType:'qc.correction_policy_approved',aggregateType:'prime_correction_policy',write:async client=>{
   if(!await this.canManage(client,r))throw new ForbiddenException('An authorized operations, project or QC manager must approve correction policies');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${r.auth.tenantId}:correction-policy:${id}`]);
   if(!(await client.query('SELECT id FROM partner_work_order_versions WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,id])).rows.length)throw new NotFoundException('Work order version not found');
   const prior=(await client.query('SELECT * FROM prime_correction_policies WHERE tenant_id=$1 AND approved_by=$2 AND client_mutation_id=$3',[r.auth.tenantId,r.auth.userId,key])).rows[0];
   if(prior){const old=correctionPolicyInput({...prior,effective_from:new Date(prior.effective_from).toISOString(),effective_until:prior.effective_until?new Date(prior.effective_until).toISOString():null});if(prior.work_order_version_id!==id||prior.source_reference!==source||JSON.stringify(old)!==JSON.stringify(policy))throw new BadRequestException('Policy retry changed; use a new request');return {entityType:'prime_correction_policy',entityId:prior.id,afterState:prior,skipEventAudit:true};}
   const row=(await client.query(`INSERT INTO prime_correction_policies(tenant_id,work_order_version_id,revision_number,effective_from,effective_until,duration,duration_unit,trigger_event,time_zone,holidays,source_reference,approved_by,client_mutation_id)
     SELECT $1,$2,COALESCE(max(revision_number),0)+1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM prime_correction_policies WHERE tenant_id=$1 AND work_order_version_id=$2 RETURNING *`,[r.auth.tenantId,id,policy.effective_from,policy.effective_until,policy.duration,policy.duration_unit,policy.trigger_event,policy.time_zone,JSON.stringify(policy.holidays),source,r.auth.userId,key])).rows[0];
   return {entityType:'prime_correction_policy',entityId:row.id,afterState:row};
  }});}finally{c.release();}
 }
 @Post('corrections/:id/schedule') @RequirePermission('customer_qc.decision_record')
 async schedule(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action:'qc.correction_deadline_scheduled',eventType:'qc.correction_deadline_scheduled',aggregateType:'production_correction',write:async client=>{
   const before=(await client.query(`SELECT p.*,d.recorded_at FROM production_corrections p JOIN customer_qc_decisions d ON d.tenant_id=p.tenant_id AND d.id=p.customer_qc_decision_id WHERE p.tenant_id=$1 AND p.id=$2 AND p.deleted_at IS NULL FOR UPDATE OF p`,[r.auth.tenantId,id])).rows[0];
   if(!before)throw new NotFoundException('Correction not found');
   if(['resolved','cancelled'].includes(before.status))throw new BadRequestException('Closed correction deadlines are historical');
   const received=verifiedReceivedTime(b.customer_received_at,before.recorded_at);
   if(received&&before.customer_received_at&&received!==new Date(before.customer_received_at).toISOString())throw new BadRequestException('The original received time is already recorded; it cannot be silently reset');
   if(before.deadline_status==='scheduled'){if(received&&!before.customer_received_at)throw new BadRequestException('A scheduled deadline cannot be silently changed');return {entityType:'production_correction',entityId:id,afterState:before,skipEventAudit:true};}
   if(received&&!before.customer_received_at){if(b.verified!==true)throw new BadRequestException('Verify the original received time against the customer source');await client.query('UPDATE production_corrections SET customer_received_at=$3 WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,id,received]);}
   const after=await scheduleCorrectionDeadline(client,r.auth.tenantId,id);
   return {entityType:'production_correction',entityId:id,beforeState:before,afterState:after};
  }});}finally{c.release();}
 }
}
