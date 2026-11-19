import {BadRequestException,Body,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Req,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import type {Pool,PoolClient} from 'pg';
import {executeWriteAction} from '@syncos/shared';
import {DATABASE_POOL} from '../modules/database.module';
import {AuthenticatedOnly} from '../security/authenticated-only.decorator';
import {resolveFieldIdentity} from '../security/field-identity';
import {type AuthenticatedRequest,requireString} from './intelligence.types';
import {lockWorkSafety} from './work-safety';
import {uuid,staffingRoles,lockStaffing,latestPlan,latestCheck,coverageFindings,checkFindings,updateStaffingCase,type Coverage} from './staffing';

@Controller('staffing') @AuthenticatedOnly()
export class StaffingController implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private running=false;
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 onModuleInit(){this.timer=setInterval(()=>{void this.tick().catch(()=>console.error('Staffing monitoring failed; review service health.'));},30000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async supervisor(c:PoolClient,r:AuthenticatedRequest,required=false){
  const found=(await c.query(`SELECT 1 FROM tenant_users tu JOIN users u ON u.id=tu.user_id AND u.status='active' AND u.deleted_at IS NULL
   JOIN user_roles ur ON ur.tenant_id=tu.tenant_id AND ur.tenant_user_id=tu.id AND ur.scope_type='tenant'
   JOIN roles role ON role.tenant_id=ur.tenant_id AND role.id=ur.role_id AND role.deleted_at IS NULL
   WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL AND role.system_key='field_supervisor'`,[r.auth.tenantId,r.auth.userId])).rowCount!>0;
  if(required&&!found)throw new ForbiddenException('Internal supervisor authority is required');return found;
 }
 private async foreman(c:PoolClient,r:AuthenticatedRequest,crew:string){
  const context=await resolveFieldIdentity(c,r.auth.tenantId,r.auth.userId);
  const member=await c.query(`SELECT m.id FROM partner_crew_memberships m JOIN workers w ON w.tenant_id=m.tenant_id AND w.id=m.worker_id AND w.status='active' AND w.deleted_at IS NULL
   JOIN partner_worker_user_links l ON l.tenant_id=m.tenant_id AND l.worker_id=m.worker_id AND l.status='active' AND l.deleted_at IS NULL
   JOIN crews cr ON cr.tenant_id=m.tenant_id AND cr.id=m.crew_id AND cr.lifecycle_status='active' AND cr.deleted_at IS NULL
   WHERE m.tenant_id=$1 AND m.crew_id=$2 AND m.membership_role='foreman' AND m.status='active' AND m.deleted_at IS NULL AND l.tenant_user_id=$3 AND cr.organization_id=$4`,[r.auth.tenantId,crew,context.user.tenant_user_id,context.organization.id]);
  if(!member.rowCount)throw new ForbiddenException('Only the active foreman of this crew may record staffing');
 }
 private async scope(c:PoolClient,r:AuthenticatedRequest,v:string,crew:string,writeForeman=false){
  uuid(v);uuid(crew);
  if(writeForeman||!await this.supervisor(c,r))await this.foreman(c,r,crew);
  const row=(await c.query(`SELECT v.* FROM partner_work_order_versions v JOIN crews cr ON cr.tenant_id=v.tenant_id AND cr.id=$3 AND cr.deleted_at IS NULL
   WHERE v.tenant_id=$1 AND v.id=$2 AND v.deleted_at IS NULL AND v.status='active'
   AND (v.assigned_crew_id=$3 OR EXISTS(SELECT 1 FROM partner_work_order_crew_assignments a WHERE a.tenant_id=v.tenant_id AND a.work_order_version_id=v.id AND a.crew_id=$3 AND a.status='active'))`,[r.auth.tenantId,uuid(v),uuid(crew)])).rows[0];
  if(!row)throw new NotFoundException('Active assigned work order not found');return row;
 }
 private async lock(c:PoolClient,t:string,wo:string){await lockWorkSafety(c,t,wo);await lockStaffing(c,t);}
 private async write(r:AuthenticatedRequest,action:string,fn:(c:PoolClient)=>Promise<any>){const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action,aggregateType:'staffing',eventType:action,write:fn});}finally{c.release();}}
 private result(type:string,row:any,extra:Record<string,unknown>={}){return {entityType:type,entityId:row.id,afterState:{...row,...extra}};}
 @Get('scopes') async scopes(@Req() r:AuthenticatedRequest){const c=await this.pool.connect();try{
  const supervisor=await this.supervisor(c,r);let crews:string[]|null=null;
  if(!supervisor){const ctx=await resolveFieldIdentity(c,r.auth.tenantId,r.auth.userId);crews=(await c.query(`SELECT DISTINCT m.crew_id FROM partner_crew_memberships m JOIN partner_worker_user_links l ON l.tenant_id=m.tenant_id AND l.worker_id=m.worker_id AND l.status='active' AND l.deleted_at IS NULL WHERE m.tenant_id=$1 AND l.tenant_user_id=$2 AND m.membership_role='foreman' AND m.status='active' AND m.deleted_at IS NULL`,[r.auth.tenantId,ctx.user.tenant_user_id])).rows.map(x=>x.crew_id);}
  const scopes=(await c.query(`SELECT DISTINCT v.id AS version_id,v.work_order_number,v.version_number,v.work_order_id,cr.id AS crew_id,cr.name AS crew_name,(SELECT count(*)::int FROM staffing_cases sc WHERE sc.tenant_id=v.tenant_id AND sc.work_order_id=v.work_order_id AND sc.crew_id=cr.id AND sc.status<>'released') AS open_cases FROM partner_work_order_versions v JOIN crews cr ON cr.tenant_id=v.tenant_id AND cr.deleted_at IS NULL AND (v.assigned_crew_id=cr.id OR EXISTS(SELECT 1 FROM partner_work_order_crew_assignments a WHERE a.tenant_id=v.tenant_id AND a.work_order_version_id=v.id AND a.crew_id=cr.id AND a.status='active')) WHERE v.tenant_id=$1 AND v.status='active' AND v.deleted_at IS NULL AND ($2::uuid[] IS NULL OR cr.id=ANY($2)) ORDER BY v.work_order_number,cr.name`,[r.auth.tenantId,crews])).rows;
  return {supervisor,scopes};
 }finally{c.release();}}
 @Get(':version/:crew') async read(@Req() r:AuthenticatedRequest,@Param('version') v:string,@Param('crew') crew:string){const c=await this.pool.connect();try{
  const scope=await this.scope(c,r,v,crew),t=r.auth.tenantId;
  const plans=(await c.query('SELECT * FROM staffing_plans WHERE tenant_id=$1 AND work_order_version_id=$2 AND crew_id=$3 ORDER BY revision DESC',[t,v,crew])).rows;
  const workers=(await c.query(`SELECT DISTINCT w.id,w.first_name,w.last_name FROM workers w JOIN partner_crew_memberships m ON m.tenant_id=w.tenant_id AND m.worker_id=w.id WHERE w.tenant_id=$1 AND m.crew_id=$2 AND m.status='active' AND m.deleted_at IS NULL AND w.status='active' AND w.deleted_at IS NULL ORDER BY w.first_name,w.last_name`,[t,crew])).rows;
  const jsas=(await c.query("SELECT id,work_date,revision_number,status FROM daily_jsas WHERE tenant_id=$1 AND work_order_version_id=$2 AND crew_id=$3 AND current AND deleted_at IS NULL AND status='completed' ORDER BY work_date DESC LIMIT 30",[t,v,crew])).rows;
  const eligibilities=(await c.query('SELECT e.* FROM staffing_eligibilities e JOIN staffing_plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id WHERE e.tenant_id=$1 AND p.work_order_version_id=$2 AND p.crew_id=$3',[t,v,crew])).rows;
  const cases=(await c.query(`SELECT s.*,COALESCE((SELECT jsonb_agg(n ORDER BY n.due_at) FROM staffing_notices n WHERE n.tenant_id=s.tenant_id AND n.case_id=s.id),'[]') AS notices,COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at) FROM staffing_case_events e WHERE e.tenant_id=s.tenant_id AND e.case_id=s.id),'[]') AS history FROM staffing_cases s WHERE s.tenant_id=$1 AND s.work_order_id=$2 AND s.crew_id=$3 ORDER BY s.created_at DESC LIMIT 50`,[t,scope.work_order_id,crew])).rows;
  const check=await latestCheck(c,t,scope.work_order_id,crew);
  const credentials=await this.supervisor(c,r)?(await c.query("SELECT wc.id,wc.worker_id,wc.credential_type,wc.status,wc.expiration_date FROM partner_worker_credentials wc WHERE wc.tenant_id=$1 AND wc.deleted_at IS NULL AND EXISTS(SELECT 1 FROM partner_crew_memberships m WHERE m.tenant_id=wc.tenant_id AND m.worker_id=wc.worker_id AND m.crew_id=$2 AND m.status='active' AND m.deleted_at IS NULL)",[t,crew])).rows:[];
  return {plans,workers,jsas,eligibilities,cases,credentials,check,live_findings:check?await checkFindings(c,t,check):['current_shift_staffing_check_required']};
 }finally{c.release();}}
 @Post(':version/:crew/plans') async propose(@Req() r:AuthenticatedRequest,@Param('version') v:string,@Param('crew') crew:string,@Body() b:Record<string,any>){return this.write(r,'staffing.plan_proposed',async c=>{
  const scope=await this.scope(c,r,v,crew,true),t=r.auth.tenantId;await this.lock(c,t,scope.work_order_id);
  const prior=await latestPlan(c,t,v,crew,false);if((b.previous_plan_id??null)!==(prior?.id??null))throw new BadRequestException('Staffing plan changed; reload before proposing a revision');
  const row=(await c.query('INSERT INTO staffing_plans(tenant_id,work_order_id,work_order_version_id,crew_id,revision,phase,requirements,plan_reference,pause_instructions,proposed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[t,scope.work_order_id,v,crew,(prior?.revision??0)+1,requireString(b.phase,'Current work phase required'),JSON.stringify(staffingRoles(b.requirements)),requireString(b.plan_reference,'Applicable work and traffic plan reference required'),requireString(b.pause_instructions,'Affected-work pause and protective coverage instructions required'),r.auth.userId])).rows[0];return this.result('staffing_plan',row);
 });}
 @Post('plans/:id/approve') async approve(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,any>){return this.write(r,'staffing.plan_approved',async c=>{
  await this.supervisor(c,r,true);const t=r.auth.tenantId;const p=(await c.query('SELECT * FROM staffing_plans WHERE tenant_id=$1 AND id=$2',[t,uuid(id)])).rows[0];if(!p)throw new NotFoundException('Plan not found');await this.lock(c,t,p.work_order_id);await this.scope(c,r,p.work_order_version_id,p.crew_id);
  if((await latestPlan(c,t,p.work_order_version_id,p.crew_id,false))?.id!==p.id)throw new BadRequestException('A newer plan proposal requires review');
  const ref=requireString(b.review_reference,'Qualified plan and safety review reference required');
  const current=(await c.query('SELECT * FROM staffing_plans WHERE tenant_id=$1 AND id=$2',[t,id])).rows[0];
  if(current.approved_at){if(current.review_reference!==ref)throw new BadRequestException('Approved plan cannot be rewritten');return {...this.result('staffing_plan',current),skipEventAudit:true};}
  const row=(await c.query('UPDATE staffing_plans SET approved_by=$3,approved_at=now(),review_reference=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *',[t,id,r.auth.userId,ref])).rows[0];
  const check=await latestCheck(c,t,p.work_order_id,p.crew_id);if(check&&!check.ended_at&&new Date(check.shift_ends_at).getTime()>Date.now())await updateStaffingCase(c,t,check,['staffing_plan_changed_recheck_required'],r.auth.userId);
  return this.result('staffing_plan',row);
 });}
 @Post('plans/:id/eligibility') async eligibility(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,any>){return this.write(r,'staffing.eligibility_reviewed',async c=>{
  await this.supervisor(c,r,true);const t=r.auth.tenantId,p=(await c.query('SELECT * FROM staffing_plans WHERE tenant_id=$1 AND id=$2',[t,uuid(id)])).rows[0];if(!p?.approved_at)throw new BadRequestException('Approved staffing plan required');await this.lock(c,t,p.work_order_id);await this.scope(c,r,p.work_order_version_id,p.crew_id);
  if((await latestPlan(c,t,p.work_order_version_id,p.crew_id))?.id!==id)throw new BadRequestException('Review eligibility against the current approved plan');
  if(!p.requirements.some((x:any)=>x.code===b.role_code))throw new BadRequestException('Role is not in this approved plan');
  const worker=uuid(b.worker_id),until=new Date(b.valid_until);if(!Number.isFinite(until.getTime())||until.getTime()<=Date.now())throw new BadRequestException('Future eligibility expiry is required');
  if(!(await c.query("SELECT id FROM partner_crew_memberships WHERE tenant_id=$1 AND crew_id=$2 AND worker_id=$3 AND status='active' AND deleted_at IS NULL",[t,p.crew_id,worker])).rowCount)throw new BadRequestException('Worker must belong to this crew');
  if(typeof b.revoked!=='boolean')throw new BadRequestException('Explicitly confirm eligibility or revocation');
  const evidence=requireString(b.evidence_reference,'Verified qualification and plan eligibility evidence required');
  const ids=b.credential_ids??[];if(!Array.isArray(ids)||ids.length>30||new Set(ids).size!==ids.length)throw new BadRequestException('Select the applicable credential records');ids.forEach(uuid);
  const snapshots=(await c.query("SELECT jsonb_build_object('id',id,'version',version,'verified_at',verified_at,'expiration_date',expiration_date,'evidence_file_object_id',evidence_file_object_id) AS snapshot FROM partner_worker_credentials WHERE tenant_id=$1 AND worker_id=$2 AND id=ANY($3::uuid[]) AND deleted_at IS NULL AND status='verified' AND (expiration_date IS NULL OR expiration_date>=$4::timestamptz::date)",[t,worker,ids,until.toISOString()])).rows.map(x=>x.snapshot);
  if(snapshots.length!==ids.length&&!b.revoked)throw new BadRequestException('Selected credentials must belong to this worker, be verified and cover the eligibility period');
  await c.query(`INSERT INTO staffing_eligibilities(tenant_id,plan_id,worker_id,role_code,valid_until,evidence_reference,revoked,verified_by,credential_snapshots) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,plan_id,worker_id,role_code) DO UPDATE SET valid_until=EXCLUDED.valid_until,evidence_reference=EXCLUDED.evidence_reference,revoked=EXCLUDED.revoked,verified_by=EXCLUDED.verified_by,verified_at=now(),credential_snapshots=EXCLUDED.credential_snapshots`,[t,id,worker,b.role_code,until.toISOString(),evidence,b.revoked,r.auth.userId,JSON.stringify(snapshots)]);
  const check=await latestCheck(c,t,p.work_order_id,p.crew_id);if(check&&!check.ended_at&&new Date(check.shift_ends_at).getTime()>Date.now())await updateStaffingCase(c,t,check,await checkFindings(c,t,check),r.auth.userId);
  return this.result('staffing_plan',p,{worker_id:worker,role_code:b.role_code,revoked:b.revoked,evidence_reference:evidence,valid_until:until.toISOString(),credential_ids:ids});
 });}
 @Post(':version/:crew/checks') async check(@Req() r:AuthenticatedRequest,@Param('version') v:string,@Param('crew') crew:string,@Body() b:Record<string,any>){return this.write(r,'staffing.coverage_checked',async c=>{
  const scope=await this.scope(c,r,v,crew,true),t=r.auth.tenantId;await this.lock(c,t,scope.work_order_id);
  const mutation=uuid(b.client_mutation_id);const old=(await c.query('SELECT * FROM staffing_checks WHERE tenant_id=$1 AND client_mutation_id=$2',[t,mutation])).rows[0];
  const request={version:v,crew,body:b};if(old){
   const equal=(await c.query('SELECT request=$3::jsonb AS equal FROM staffing_checks WHERE tenant_id=$1 AND id=$2',[t,old.id,JSON.stringify(request)])).rows[0].equal;
   if(old.checked_by!==r.auth.userId||!equal)throw new BadRequestException('This check reference was already used with different facts');
   return {...this.result('staffing_check',old),skipEventAudit:true};
  }
  const plan=await latestPlan(c,t,v,crew);if(!plan||plan.id!==b.plan_id)throw new BadRequestException('Review the current approved staffing plan');
  const prior=await latestCheck(c,t,scope.work_order_id,crew);if((prior?.id??null)!==(b.expected_check_id??null))throw new BadRequestException('Coverage changed; refresh before checking again');
  const jsa=(await c.query("SELECT * FROM daily_jsas WHERE tenant_id=$1 AND id=$2 AND work_order_version_id=$3 AND crew_id=$4 AND current AND status='completed' AND deleted_at IS NULL",[t,uuid(b.daily_jsa_id),v,crew])).rows[0];if(!jsa||jsa.foreman_user_id!==r.auth.userId)throw new BadRequestException('Complete your current shift safety review first');
  const end=new Date(b.shift_ends_at);if(!jsa.meeting_completed_at||end.getTime()>new Date(jsa.meeting_completed_at).getTime()+24*3600000)throw new BadRequestException('Complete a fresh shift safety review; coverage cannot extend beyond 24 hours after that review');if(!Number.isFinite(end.getTime())||end.getTime()<=Date.now()||end.getTime()>Date.now()+24*3600000)throw new BadRequestException('Shift end must be within the next 24 hours');
  if(!Array.isArray(b.coverage)||b.coverage.length>200)throw new BadRequestException('Provide the actual workers covering this phase');
  const seen=new Set<string>();const coverage:Coverage[]=b.coverage.map((w:any)=>{const worker=uuid(w.worker_id);if(seen.has(worker)||!plan.requirements.some((x:any)=>x.code===w.role_code))throw new BadRequestException('A worker may cover only one simultaneous role, using approved role codes');seen.add(worker);return {worker_id:worker,role_code:w.role_code};});
  for(const w of coverage)if(!(await c.query("SELECT id FROM partner_crew_memberships WHERE tenant_id=$1 AND worker_id=$2 AND crew_id=$3 AND status='active' AND deleted_at IS NULL",[t,w.worker_id,crew])).rowCount)throw new BadRequestException('Coverage workers must belong to your crew');
  await c.query('DELETE FROM staffing_claims WHERE tenant_id=$1 AND (ends_at<=now() OR check_id IN (SELECT id FROM staffing_checks WHERE tenant_id=$1 AND work_order_id=$2 AND crew_id=$3))',[t,scope.work_order_id,crew]);
  const findings=await coverageFindings(c,t,plan,jsa,coverage,end.toISOString());const unsafe=typeof b.unsafe_reason==='string'?b.unsafe_reason.trim():'';if(unsafe)findings.push('unsafe_condition_reported');
  const row=(await c.query('INSERT INTO staffing_checks(tenant_id,plan_id,work_order_id,crew_id,daily_jsa_id,client_mutation_id,request,coverage,findings,checked_by,shift_ends_at,reason,unsafe_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[t,plan.id,scope.work_order_id,crew,jsa.id,mutation,JSON.stringify(request),JSON.stringify(coverage),findings,r.auth.userId,end.toISOString(),requireString(b.reason,'Start, change, relief or recheck reason required'),unsafe||null])).rows[0];
  for(const w of coverage)await c.query('INSERT INTO staffing_claims(tenant_id,worker_id,check_id,crew_id,ends_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[t,w.worker_id,row.id,crew,end.toISOString()]);
  const caseId=await updateStaffingCase(c,t,row,findings,r.auth.userId);return this.result('staffing_check',row,{case_id:caseId});
 });}
 @Post(':version/:crew/end-shift') async endShift(@Req() r:AuthenticatedRequest,@Param('version') v:string,@Param('crew') crew:string,@Body() b:Record<string,any>){return this.write(r,'staffing.shift_ended',async c=>{
  const scope=await this.scope(c,r,v,crew,true),t=r.auth.tenantId;await this.lock(c,t,scope.work_order_id);const check=await latestCheck(c,t,scope.work_order_id,crew);
  if(!check||check.id!==b.check_id)throw new BadRequestException('Review the current coverage check before ending the shift');
  if(check.ended_at)return {...this.result('staffing_check',check),skipEventAudit:true};
  const reason=requireString(b.reason,'Record shift completion or handoff before freeing worker coverage');
  const after=(await c.query('UPDATE staffing_checks SET ended_at=now(),ended_by=$3,end_reason=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *',[t,check.id,r.auth.userId,reason])).rows[0];
  await c.query('DELETE FROM staffing_claims WHERE tenant_id=$1 AND check_id=$2',[t,check.id]);return this.result('staffing_check',after);
 });}
 @Post(':version/:crew/concerns') async concern(@Req() r:AuthenticatedRequest,@Param('version') v:string,@Param('crew') crew:string,@Body() b:Record<string,any>){return this.write(r,'staffing.unsafe_condition_reported',async c=>{
  const scope=await this.scope(c,r,v,crew,true),t=r.auth.tenantId;await this.lock(c,t,scope.work_order_id);
  const reason=requireString(b.reason,'Describe the unsafe condition and immediate precautions');
  const id=await updateStaffingCase(c,t,{id:null,work_order_id:scope.work_order_id,crew_id:crew},['unsafe_condition_reported'],r.auth.userId);
  await c.query('UPDATE staffing_cases SET recheck_after=clock_timestamp() WHERE tenant_id=$1 AND id=$2',[t,id]);
  await c.query("INSERT INTO staffing_case_events(tenant_id,case_id,actor_user_id,event_type,details) VALUES($1,$2,$3,'unsafe_condition_reported',$4)",[t,id,r.auth.userId,JSON.stringify({reason})]);
  const row=(await c.query('SELECT * FROM staffing_cases WHERE tenant_id=$1 AND id=$2',[t,id])).rows[0];return this.result('staffing_case',row);
 });}
 private async caseScope(c:PoolClient,r:AuthenticatedRequest,id:string){const row=(await c.query('SELECT * FROM staffing_cases WHERE tenant_id=$1 AND id=$2',[r.auth.tenantId,uuid(id)])).rows[0];if(!row)throw new NotFoundException('Staffing case not found');if(!await this.supervisor(c,r))await this.foreman(c,r,row.crew_id);await this.lock(c,r.auth.tenantId,row.work_order_id);return (await c.query('SELECT * FROM staffing_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[r.auth.tenantId,id])).rows[0];}
 @Post('cases/:id/acknowledge') async acknowledge(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,any>){return this.write(r,'staffing.case_acknowledged',async c=>{await this.supervisor(c,r,true);const row=await this.caseScope(c,r,id);if(row.status==='released')throw new BadRequestException('Case is already released');const note=requireString(b.contact_note,'Record contact with the crew and review plan');if(row.acknowledged_at)return {...this.result('staffing_case',row),skipEventAudit:true};const after=(await c.query('UPDATE staffing_cases SET acknowledged_by=$3,acknowledged_at=now(),contact_note=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *',[r.auth.tenantId,id,r.auth.userId,note])).rows[0];return this.result('staffing_case',after);});}
 @Post('cases/:id/escalate') async escalate(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,any>){return this.write(r,'staffing.case_escalated',async c=>{const row=await this.caseScope(c,r,id);if(row.status==='released')throw new BadRequestException('Case is already released');if(!['backup_supervisor','business_owner'].includes(b.target))throw new BadRequestException('Choose backup supervisor or business owner');const note=requireString(b.contact_note,'Record why escalation is needed and the contact attempt');await c.query('INSERT INTO staffing_notices(tenant_id,case_id,target,due_at) VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING',[r.auth.tenantId,id,b.target]);await c.query("INSERT INTO staffing_case_events(tenant_id,case_id,actor_user_id,event_type,details) VALUES($1,$2,$3,'manual_escalation',$4)",[r.auth.tenantId,id,r.auth.userId,JSON.stringify({target:b.target,contact_note:note})]);return this.result('staffing_case',row,{target:b.target,contact_note:note});});}
 @Post('cases/:id/release') async release(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,any>){return this.write(r,'staffing.case_released',async c=>{
  await this.supervisor(c,r,true);const row=await this.caseScope(c,r,id),t=r.auth.tenantId;const reference=requireString(b.release_reference,'Current plan, coverage and crew contact review required');
  if(row.status==='released'){if(row.latest_check_id!==b.check_id||row.release_reference!==reference)throw new BadRequestException('Release facts cannot be rewritten');return {...this.result('staffing_case',row),skipEventAudit:true};}
  const check=await latestCheck(c,t,row.work_order_id,row.crew_id);if(!check||check.id!==b.check_id)throw new BadRequestException('Coverage changed; review the latest check');
  if(new Date(check.checked_at)<=new Date(row.recheck_after))throw new BadRequestException('A fresh crew check after this pause is required');
  const findings=await checkFindings(c,t,check);if(findings.length)throw new BadRequestException('Staffing is not ready: '+findings.join(', '));
  const after=(await c.query("UPDATE staffing_cases SET status='released',latest_check_id=$3,findings='{}',released_by=$4,released_at=now(),release_reference=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *",[t,id,check.id,r.auth.userId,reference])).rows[0];
  await c.query("INSERT INTO staffing_case_events(tenant_id,case_id,actor_user_id,event_type,details) VALUES($1,$2,$3,'supervisor_release',$4)",[t,id,r.auth.userId,JSON.stringify({check_id:check.id,plan_id:check.plan_id,release_reference:reference})]);return this.result('staffing_case',after);
 });}
 async tick(){if(this.running)return;this.running=true;try{
  const checks=(await this.pool.query(`SELECT DISTINCT ON(tenant_id,work_order_id,crew_id) * FROM staffing_checks ORDER BY tenant_id,work_order_id,crew_id,checked_at DESC,id DESC`)).rows;
  for(const item of checks){if(item.ended_at||new Date(item.shift_ends_at).getTime()<=Date.now())continue;const c=await this.pool.connect();try{await c.query('BEGIN');await this.lock(c,item.tenant_id,item.work_order_id);const check=await latestCheck(c,item.tenant_id,item.work_order_id,item.crew_id);if(check&&!check.ended_at&&new Date(check.shift_ends_at).getTime()>Date.now())await updateStaffingCase(c,item.tenant_id,check,await checkFindings(c,item.tenant_id,check),null);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  await this.pool.query(`INSERT INTO staffing_notices(tenant_id,case_id,target,due_at) SELECT s.tenant_id,s.id,x.target,s.created_at+x.delay FROM staffing_cases s CROSS JOIN (VALUES('backup_supervisor',interval '5 minutes'),('business_owner',interval '10 minutes')) x(target,delay) WHERE s.status<>'released' AND s.acknowledged_at IS NULL AND s.created_at+x.delay<=now() ON CONFLICT DO NOTHING`);
 }finally{this.running=false;}}
}
