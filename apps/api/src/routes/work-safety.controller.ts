import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { executeWriteAction } from '@syncos/shared';
import { DATABASE_POOL } from '../modules/database.module';
import { AuthenticatedOnly } from '../security/authenticated-only.decorator';
import type { AuthenticatedRequest } from './intelligence.types';
import { requireString } from './intelligence.types';
import { lockWorkSafety, verifiedApprovalTime } from './work-safety';

@Controller('work-safety')
@AuthenticatedOnly()
export class WorkSafetyController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  private async roles(c: PoolClient, r: AuthenticatedRequest) {
    return (await c.query(`SELECT DISTINCT role.system_key FROM tenant_users tu JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id
      JOIN roles role ON role.tenant_id=ur.tenant_id AND role.id=ur.role_id AND role.deleted_at IS NULL
      WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL AND ur.scope_type='tenant'`,[r.auth.tenantId,r.auth.userId])).rows.map(x=>x.system_key);
  }
  private async authority(c: PoolClient,r: AuthenticatedRequest,allowed: string[]) {
    if (!(await this.roles(c,r)).some(x=>allowed.includes(x))) throw new ForbiddenException('Applicable internal safety approval authority is required');
  }
  private async write(r: AuthenticatedRequest,action: string,fn: (c: PoolClient)=>Promise<any>) {
    const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action,aggregateType:'work_safety',eventType:action,write:fn});}finally{c.release();}
  }
  private async ownParticipants(c: PoolClient,r: AuthenticatedRequest) {
    return (await c.query(`SELECT j.*,p.id AS participant_id,p.worker_id,p.acknowledged_by,p.acknowledged_at,p.participation_status
      FROM daily_jsas j JOIN daily_jsa_participants p ON p.tenant_id=j.tenant_id AND p.daily_jsa_id=j.id
      JOIN partner_worker_user_links l ON l.tenant_id=p.tenant_id AND l.worker_id=p.worker_id AND l.status='active' AND l.deleted_at IS NULL
      JOIN tenant_users tu ON tu.tenant_id=l.tenant_id AND tu.id=l.tenant_user_id AND tu.status='active' AND tu.deleted_at IS NULL
      JOIN workers w ON w.tenant_id=p.tenant_id AND w.id=p.worker_id AND w.status='active' AND w.deleted_at IS NULL
      WHERE j.tenant_id=$1 AND tu.user_id=$2 AND j.current=true AND j.deleted_at IS NULL AND j.status='completed'
      AND p.participation_status='present' AND EXISTS(SELECT 1 FROM partner_crew_memberships m WHERE m.tenant_id=j.tenant_id AND m.crew_id=j.crew_id AND m.worker_id=p.worker_id AND m.status='active' AND m.deleted_at IS NULL)
      ORDER BY j.work_date DESC LIMIT 50`,[r.auth.tenantId,r.auth.userId])).rows;
  }
  @Get('my-jsas')
  async own(@Req() r: AuthenticatedRequest) {
    const c=await this.pool.connect();try{return (await this.ownParticipants(c,r)).map(j=>({id:j.id,revision_number:j.revision_number,work_date:j.work_date,work_location:j.work_location,hazards:j.hazards,controls:j.controls,acknowledged_at:j.acknowledged_at,worker_id:j.worker_id,can_request_pre_bore:j.foreman_user_id===r.auth.userId}));}finally{c.release();}
  }
  @Post('jsas/:id/acknowledge')
  async acknowledge(@Req() r: AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>) {
    if(b.confirmed!==true || b.worker_id!==undefined)throw new BadRequestException('Personally confirm the safety review; another worker cannot be selected');
    return this.write(r,'daily_jsa.individually_acknowledged',async c=>{
      let own=(await this.ownParticipants(c,r)).find(j=>j.id===id);if(!own)throw new ForbiddenException('Only your own current JSA participation can be acknowledged');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${own.tenant_id}:jsa:${own.work_order_version_id}:${own.crew_id}:${String(own.work_date instanceof Date?own.work_date.toISOString():own.work_date).slice(0,10)}`]);
      own=(await this.ownParticipants(c,r)).find(j=>j.id===id);if(!own)throw new BadRequestException('JSA changed; review the current revision');
      if(Number(b.revision_number)!==Number(own.revision_number))throw new BadRequestException('Review the exact current JSA revision');
      if(own.acknowledged_by===r.auth.userId)return {entityType:'daily_jsa_participant',entityId:own.participant_id,afterState:{id:own.participant_id,acknowledged_at:own.acknowledged_at},skipEventAudit:true};
      const after=(await c.query('UPDATE daily_jsa_participants SET acknowledged=true,acknowledged_by=$3,acknowledged_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,daily_jsa_id,worker_id,acknowledged_by,acknowledged_at',[r.auth.tenantId,own.participant_id,r.auth.userId])).rows[0];
      return {entityType:'daily_jsa_participant',entityId:own.participant_id,afterState:after};
    });
  }
  @Get('controls')
  async controls(@Req() r: AuthenticatedRequest){const c=await this.pool.connect();try{
    const staff=(await this.roles(c,r)).some(x=>['system_admin','executive','operations_manager','project_manager','safety_manager','qc_manager','field_supervisor'].includes(x));
    const rows=(await c.query(`SELECT sc.*,COALESCE((SELECT jsonb_agg(a ORDER BY a.recorded_at) FROM work_safety_approvals a WHERE a.tenant_id=sc.tenant_id AND a.control_id=sc.id),'[]') AS approvals
      FROM work_safety_controls sc WHERE sc.tenant_id=$1 AND ($3::boolean OR EXISTS(
       SELECT 1 FROM partner_worker_user_links l JOIN tenant_users tu ON tu.tenant_id=l.tenant_id AND tu.id=l.tenant_user_id
       JOIN partner_crew_memberships m ON m.tenant_id=l.tenant_id AND m.worker_id=l.worker_id AND m.status='active' AND m.deleted_at IS NULL
       JOIN partner_work_order_versions v ON v.tenant_id=m.tenant_id AND v.work_order_id=sc.work_order_id AND v.deleted_at IS NULL AND (v.assigned_crew_id=m.crew_id OR EXISTS(SELECT 1 FROM partner_work_order_crew_assignments ca WHERE ca.tenant_id=v.tenant_id AND ca.work_order_version_id=v.id AND ca.crew_id=m.crew_id AND ca.status='active'))
       WHERE l.tenant_id=sc.tenant_id AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL AND l.status='active' AND l.deleted_at IS NULL AND (sc.crew_id IS NULL OR sc.crew_id=m.crew_id))) ORDER BY sc.created_at DESC LIMIT 200`,[r.auth.tenantId,r.auth.userId,staff])).rows;
    const orders=staff?(await c.query('SELECT id,work_order_number,title FROM work_orders WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 250',[r.auth.tenantId])).rows:[];
    const crews=staff?(await c.query('SELECT id,name FROM crews WHERE tenant_id=$1 AND deleted_at IS NULL',[r.auth.tenantId])).rows:[];
    const versions=staff?(await c.query('SELECT id,work_order_number,version_number,pre_bore_required,safety_scope_reviewed_at FROM partner_work_order_versions WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 250',[r.auth.tenantId])).rows:[];
    return {staff,roles:await this.roles(c,r),controls:rows,work_orders:orders,crews,versions};
  }finally{c.release();}}
  @Post('work-orders/:id/scope-review')
  async scopeReview(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
    if(typeof b.pre_bore_required!=='boolean')throw new BadRequestException('Explicitly determine whether pre-bore approval is required');
    const evidence=requireString(b.evidence_reference,'Governing safety requirements and reviewed scope reference are required');
    return this.write(r,'work_safety.scope_reviewed',async c=>{
      await this.authority(c,r,['safety_manager','operations_manager','project_manager','executive']);
      const before=(await c.query('SELECT * FROM partner_work_order_versions WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,id])).rows[0];if(!before)throw new NotFoundException('Work-order version not found');
      await lockWorkSafety(c,r.auth.tenantId,before.work_order_id);
      const after=(await c.query('UPDATE partner_work_order_versions SET pre_bore_required=$3,safety_scope_reviewed_at=now(),safety_scope_reviewed_by=$4,safety_scope_evidence_reference=$5 WHERE tenant_id=$1 AND id=$2 RETURNING id,pre_bore_required,safety_scope_reviewed_at,safety_scope_reviewed_by,safety_scope_evidence_reference',[r.auth.tenantId,id,b.pre_bore_required,r.auth.userId,evidence])).rows[0];
      return {entityType:'partner_work_order_version',entityId:id,beforeState:{pre_bore_required:before.pre_bore_required,safety_scope_evidence_reference:before.safety_scope_evidence_reference},afterState:after};
    });
  }
  @Post('controls/:id/revoke-pre-bore')
  async revoke(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){return this.write(r,'pre_bore.revoked',async c=>{
    await this.authority(c,r,['safety_manager','operations_manager','project_manager','executive']);
    const before=(await c.query("SELECT * FROM work_safety_controls WHERE tenant_id=$1 AND id=$2 AND control_type='pre_bore'",[r.auth.tenantId,id])).rows[0];if(!before)throw new NotFoundException('Pre-bore control not found');
    await lockWorkSafety(c,r.auth.tenantId,before.work_order_id);
    const after=(await c.query("UPDATE work_safety_controls SET status='revoked',revocation_reason=$3,revoked_by=$4,revoked_at=now() WHERE tenant_id=$1 AND id=$2 AND status IN ('approved','pending') RETURNING *",[r.auth.tenantId,id,requireString(b.reason,'Revocation reason required'),r.auth.userId])).rows[0];
    if(!after)throw new BadRequestException('Pre-bore approval is already revoked');
    return {entityType:'work_safety_control',entityId:id,beforeState:before,afterState:after};
  });}
  @Post('pre-bore')
  async requestPreBore(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){return this.write(r,'pre_bore.requested',async c=>{
    const j=(await c.query("SELECT * FROM daily_jsas WHERE tenant_id=$1 AND id=$2 AND current=true AND status='completed' AND deleted_at IS NULL",[r.auth.tenantId,b.daily_jsa_id])).rows[0];
    if(!j)throw new BadRequestException('A completed current location-specific JSA is required');
    if(j.foreman_user_id!==r.auth.userId)await this.authority(c,r,['system_admin','executive','operations_manager','project_manager','field_supervisor','safety_manager']);
    await lockWorkSafety(c,r.auth.tenantId,j.work_order_id);
    const old=(await c.query("SELECT * FROM work_safety_controls WHERE tenant_id=$1 AND daily_jsa_id=$2 AND control_type='pre_bore' AND status IN ('pending','approved')",[r.auth.tenantId,j.id])).rows[0];
    if(old)return {entityType:'work_safety_control',entityId:old.id,afterState:old,skipEventAudit:true};
    const row=(await c.query(`INSERT INTO work_safety_controls(tenant_id,work_order_id,crew_id,work_location,control_type,reason,daily_jsa_id,required_approvals,created_by)
     VALUES($1,$2,$3,$4,'pre_bore',$5,$6,ARRAY['construction_supervisor'],$7) RETURNING *`,[r.auth.tenantId,j.work_order_id,j.crew_id,j.work_location,requireString(b.reason,'Inspection scope and utility-clearance references are required'),j.id,r.auth.userId])).rows[0];
    return {entityType:'work_safety_control',entityId:row.id,afterState:row};
  });}
  @Post('stops')
  async stop(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){return this.write(r,'work_safety.stopped',async c=>{
    await this.authority(c,r,['safety_manager','qc_manager','executive','system_admin']);
    const wo=(await c.query('SELECT id FROM work_orders WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[r.auth.tenantId,b.work_order_id])).rows[0];if(!wo)throw new NotFoundException('Work order not found');
    await lockWorkSafety(c,r.auth.tenantId,wo.id);
    if(b.crew_id && !(await c.query(`SELECT c.id FROM crews c WHERE c.tenant_id=$1 AND c.id=$2 AND c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM partner_work_order_versions v WHERE v.tenant_id=c.tenant_id AND v.work_order_id=$3 AND v.deleted_at IS NULL AND (v.assigned_crew_id=c.id OR EXISTS(SELECT 1 FROM partner_work_order_crew_assignments ca WHERE ca.tenant_id=v.tenant_id AND ca.work_order_version_id=v.id AND ca.crew_id=c.id AND ca.status='active')))`,[r.auth.tenantId,b.crew_id,wo.id])).rows.length)throw new BadRequestException('Crew is not assigned to this work order');
    const strike=b.utility_strike===true;
    const row=(await c.query(`INSERT INTO work_safety_controls(tenant_id,work_order_id,crew_id,work_location,control_type,reason,utility_strike,status,required_approvals,created_by)
      VALUES($1,$2,$3,$4,'stop',$5,$6,'active',$7,$8) RETURNING *`,[r.auth.tenantId,wo.id,b.crew_id||null,b.work_location||null,requireString(b.reason,'Shutdown reason is required'),strike,strike?['utility_owner','safety','operations']:['safety','operations'],r.auth.userId])).rows[0];
    return {entityType:'work_safety_control',entityId:row.id,afterState:row};
  });}
  @Post('controls/:id/classify')
  async classifyStop(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){return this.write(r,'work_safety.shutdown_classified',async c=>{
    await this.authority(c,r,['safety_manager','executive']);
    if(typeof b.utility_strike!=='boolean')throw new BadRequestException('Confirm whether this shutdown involves a utility strike');
    const reference=requireString(b.evidence_reference,'Source review evidence is required');
    const before=(await c.query("SELECT * FROM work_safety_controls WHERE tenant_id=$1 AND id=$2 AND control_type='stop'",[r.auth.tenantId,id])).rows[0];
    if(!before)throw new NotFoundException('Shutdown not found');
    await lockWorkSafety(c,r.auth.tenantId,before.work_order_id);
    const approvals=await c.query('SELECT id FROM work_safety_approvals WHERE tenant_id=$1 AND control_id=$2',[r.auth.tenantId,id]);
    if(approvals.rows.length)throw new BadRequestException('Do not change the requirements after restart approvals have been recorded');
    const after=(await c.query("UPDATE work_safety_controls SET utility_strike=$3,required_approvals=$4,classification_review_required=false WHERE tenant_id=$1 AND id=$2 AND status='active' AND classification_review_required=true RETURNING *",[r.auth.tenantId,id,b.utility_strike,b.utility_strike?['utility_owner','safety','operations']:['safety','operations']])).rows[0];
    if(!after)throw new BadRequestException('This shutdown is not awaiting classification');
    return {entityType:'work_safety_control',entityId:id,beforeState:before,afterState:{...after,classification_evidence_reference:reference}};
  });}
  @Post('controls/:id/approvals')
  async approve(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){return this.write(r,'work_safety.approval_recorded',async c=>{
    const before=(await c.query('SELECT * FROM work_safety_controls WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,id])).rows[0];if(!before)throw new NotFoundException('Safety control not found');
    await lockWorkSafety(c,r.auth.tenantId,before.work_order_id);
    const row=(await c.query('SELECT * FROM work_safety_controls WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[r.auth.tenantId,id])).rows[0];
    const kind=String(b.approval_kind);const permitted:Record<string,string[]>={construction_supervisor:['field_supervisor','project_manager','operations_manager','executive'],utility_owner:['safety_manager','executive'],safety:['safety_manager','executive'],operations:['operations_manager','executive']};
    if(!permitted[kind]||!row.required_approvals.includes(kind))throw new BadRequestException('Approval does not apply to this control');
    await this.authority(c,r,permitted[kind]);
    if(row.classification_review_required)throw new BadRequestException('Review the imported shutdown classification and governing restart requirements first');
    const previous=(await c.query('SELECT * FROM work_safety_approvals WHERE tenant_id=$1 AND control_id=$2',[r.auth.tenantId,id])).rows;
    const index=row.required_approvals.indexOf(kind);if(row.required_approvals.slice(0,index).some((x:string)=>!previous.some(p=>p.approval_kind===x)))throw new BadRequestException('Required preceding approvals are missing');
    const at=verifiedApprovalTime(b.approved_at);
    const approver=requireString(b.approver_name,'Actual approving person or utility representative is required');const evidence=requireString(b.evidence_reference,'Approval evidence is required');
    if(b.verified!==true)throw new BadRequestException('Confirm the approval evidence was reviewed');
    const old=previous.find(p=>p.approval_kind===kind);
    if(old){if(old.approver_name!==approver||old.evidence_reference!==evidence||new Date(old.approved_at).toISOString()!==at)throw new BadRequestException('Approval already recorded with different details');return {entityType:'work_safety_control',entityId:id,afterState:row,skipEventAudit:true};}
    if(!['pending','active'].includes(row.status))throw new BadRequestException('Control is already resolved or revoked');
    if(new Date(at)<new Date(row.created_at)||previous.some(p=>new Date(p.approved_at)>new Date(at)))throw new BadRequestException('Approval must follow this request and preceding approvals');
    await c.query('INSERT INTO work_safety_approvals(tenant_id,control_id,approval_kind,approver_name,evidence_reference,recorded_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.auth.tenantId,id,kind,approver,evidence,r.auth.userId,at]);
    if(previous.length+1===row.required_approvals.length)await c.query("UPDATE work_safety_controls SET status=$3,resolved_by=$4,resolved_at=now() WHERE tenant_id=$1 AND id=$2",[r.auth.tenantId,id,row.control_type==='pre_bore'?'approved':'released',r.auth.userId]);
    if(previous.length+1===row.required_approvals.length && row.source_production_record_id) await c.query(`UPDATE production_records SET stop_work_status='released',stop_work_release_reason='Required restart approvals recorded',stop_work_released_at=now(),stop_work_released_by=$3 WHERE tenant_id=$1 AND id=$2`,[r.auth.tenantId,row.source_production_record_id,r.auth.userId]);
    const after=(await c.query('SELECT * FROM work_safety_controls WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,id])).rows[0];
    return {entityType:'work_safety_control',entityId:id,beforeState:row,afterState:{...after,approval_kind:kind,approver_name:approver,evidence_reference:evidence,approved_at:at}};
  });}
}
