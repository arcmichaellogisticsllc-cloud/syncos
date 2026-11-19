import {BadRequestException} from '@nestjs/common';
import type {PoolClient} from 'pg';
export type StaffingRole={code:string;minimum:number;qualification:string};
export type Coverage={worker_id:string;role_code:string};
export function staffingRoles(value:unknown):StaffingRole[]{
 if(!Array.isArray(value)||!value.length||value.length>20)throw new BadRequestException('Specify between 1 and 20 simultaneous staffing roles');
 const seen=new Set<string>();
 return value.map(r=>{if(!r||typeof r.code!=='string'||!/^[a-z][a-z0-9_]{0,49}$/.test(r.code)||seen.has(r.code)||!Number.isInteger(r.minimum)||r.minimum<1||r.minimum>100||typeof r.qualification!=='string'||!r.qualification.trim()||r.qualification.length>1000)throw new BadRequestException('Each role needs a unique code, positive minimum and qualification requirements');seen.add(r.code);return {code:r.code,minimum:r.minimum,qualification:r.qualification.trim()};});
}
export function uuid(value:unknown){if(typeof value!=='string'||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))throw new BadRequestException('A valid record reference is required');return value;}
export async function lockStaffing(c:PoolClient,t:string){await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${t}:staffing-coverage`]);}
export async function latestPlan(c:PoolClient,t:string,v:string,crew:string,approved=true){return (await c.query(`SELECT * FROM staffing_plans WHERE tenant_id=$1 AND work_order_version_id=$2 AND crew_id=$3 ${approved?'AND approved_at IS NOT NULL':''} ORDER BY revision DESC LIMIT 1`,[t,v,crew])).rows[0];}
export async function latestCheck(c:PoolClient,t:string,wo:string,crew:string){return (await c.query('SELECT * FROM staffing_checks WHERE tenant_id=$1 AND work_order_id=$2 AND crew_id=$3 ORDER BY checked_at DESC,id DESC LIMIT 1',[t,wo,crew])).rows[0];}
export async function coverageFindings(c:PoolClient,t:string,plan:any,jsa:any,coverage:Coverage[],end:string,checkId?:string){
 const findings:string[]=[];
 if(!jsa?.meeting_completed_at||new Date(jsa.meeting_completed_at).getTime()<Date.now()-24*3600000)findings.push('fresh_shift_safety_review_required');
 if(!jsa?.current||jsa.status!=='completed'||jsa.deleted_at)findings.push('current_completed_jsa_required');
 const version=(await c.query("SELECT id FROM partner_work_order_versions v WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL AND status='active' AND (assigned_crew_id=$3 OR EXISTS(SELECT 1 FROM partner_work_order_crew_assignments a WHERE a.tenant_id=v.tenant_id AND a.work_order_version_id=v.id AND a.crew_id=$3 AND a.status='active'))",[t,plan.work_order_version_id,plan.crew_id])).rows[0];
 if(!version)findings.push('current_work_assignment_required');
 const eligible=(await c.query(`SELECT e.worker_id,e.role_code FROM staffing_eligibilities e JOIN workers w ON w.tenant_id=e.tenant_id AND w.id=e.worker_id AND w.status='active' AND w.deleted_at IS NULL
 JOIN capacity_providers cp ON cp.tenant_id=w.tenant_id AND cp.id=w.capacity_provider_id AND cp.deleted_at IS NULL AND cp.status NOT IN ('suspended','archived')
 JOIN organizations org ON org.tenant_id=cp.tenant_id AND org.id=cp.organization_id AND org.deleted_at IS NULL AND org.status NOT IN ('inactive','suspended','archived')
 JOIN crews cr ON cr.tenant_id=e.tenant_id AND cr.id=$3 AND cr.lifecycle_status='active' AND cr.deleted_at IS NULL
 WHERE e.tenant_id=$1 AND e.plan_id=$2 AND NOT e.revoked AND e.valid_until>=$5::timestamptz
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.credential_snapshots) snap WHERE NOT EXISTS(SELECT 1 FROM partner_worker_credentials wc WHERE wc.tenant_id=e.tenant_id AND wc.worker_id=e.worker_id AND wc.deleted_at IS NULL AND wc.status='verified' AND (wc.expiration_date IS NULL OR wc.expiration_date>=$5::timestamptz::date) AND jsonb_build_object('id',wc.id,'version',wc.version,'verified_at',wc.verified_at,'expiration_date',wc.expiration_date,'evidence_file_object_id',wc.evidence_file_object_id)=snap))
 AND EXISTS(SELECT 1 FROM partner_crew_memberships m WHERE m.tenant_id=e.tenant_id AND m.worker_id=e.worker_id AND m.crew_id=$3 AND m.status='active' AND m.deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM daily_jsa_participants p WHERE p.tenant_id=e.tenant_id AND p.daily_jsa_id=$4 AND p.worker_id=e.worker_id AND p.participation_status='present' AND p.acknowledged AND p.acknowledged_by IS NOT NULL AND p.acknowledged_at IS NOT NULL)`,[t,plan.id,plan.crew_id,jsa?.id??null,end])).rows;
 const counts=new Map<string,number>();
 for(const worker of coverage){
  const claim=(await c.query('SELECT check_id FROM staffing_claims WHERE tenant_id=$1 AND worker_id=$2 AND ends_at>now()',[t,worker.worker_id])).rows[0];
  if(claim && claim.check_id!==checkId){findings.push(`worker_already_covering_other_work:${worker.worker_id}`);continue;}
  if(checkId && !claim){findings.push(`worker_coverage_no_longer_current:${worker.worker_id}`);continue;}
  if(!eligible.some(e=>e.worker_id===worker.worker_id&&e.role_code===worker.role_code)){findings.push(`worker_not_eligible_or_present:${worker.worker_id}`);continue;}
  counts.set(worker.role_code,(counts.get(worker.role_code)??0)+1);
 }
 for(const role of plan.requirements as StaffingRole[])if((counts.get(role.code)??0)<role.minimum)findings.push(`staffing_shortfall:${role.code}:${counts.get(role.code)??0}/${role.minimum}`);
 return findings;
}
export async function checkFindings(c:PoolClient,t:string,check:any){
 const plan=(await c.query('SELECT * FROM staffing_plans WHERE tenant_id=$1 AND id=$2',[t,check.plan_id])).rows[0];
 const current=await latestPlan(c,t,plan.work_order_version_id,check.crew_id);
 const issues:string[]=[];
 if(current?.id!==plan.id)issues.push('staffing_plan_changed_recheck_required');
 if(new Date(check.shift_ends_at).getTime()<=Date.now())issues.push('staffing_shift_check_expired');
 if(check.ended_at)issues.push('staffing_shift_ended');
 if(check.unsafe_reason)issues.push('unsafe_condition_reported');
 const jsa=(await c.query('SELECT * FROM daily_jsas WHERE tenant_id=$1 AND id=$2',[t,check.daily_jsa_id])).rows[0];
 return [...issues,...await coverageFindings(c,t,plan,jsa,check.coverage,new Date(check.shift_ends_at).toISOString(),check.id)];
}
export async function staffingBlockers(c:PoolClient,t:string,wo:string,crew:string|null,jsa?:any){
 await lockStaffing(c,t);
 const blockers:string[]=[];
 if((await c.query("SELECT id FROM staffing_cases WHERE tenant_id=$1 AND work_order_id=$2 AND ($3::uuid IS NULL OR crew_id=$3) AND status<>'released' LIMIT 1",[t,wo,crew])).rowCount)blockers.push('staffing_pause_requires_supervisor_release');
 if(jsa?.status==='completed'&&crew){
  const plan=await latestPlan(c,t,jsa.work_order_version_id,crew);
  if(!plan)blockers.push('approved_role_staffing_plan_required');
  const check=await latestCheck(c,t,wo,crew);
  if(!check||check.daily_jsa_id!==jsa.id)blockers.push('current_shift_staffing_check_required');
  else blockers.push(...await checkFindings(c,t,check));
 }
 return blockers;
}
export async function updateStaffingCase(c:PoolClient,t:string,check:any,findings:string[],actor:string|null){
 let existing=(await c.query("SELECT * FROM staffing_cases WHERE tenant_id=$1 AND work_order_id=$2 AND crew_id=$3 AND status<>'released' FOR UPDATE",[t,check.work_order_id,check.crew_id])).rows[0];
 if(!existing&&!findings.length)return null;
 if(!existing){existing=(await c.query('INSERT INTO staffing_cases(tenant_id,work_order_id,crew_id,latest_check_id,findings) VALUES($1,$2,$3,$4,$5) RETURNING *',[t,check.work_order_id,check.crew_id,check.id,findings])).rows[0];
  await c.query("INSERT INTO staffing_notices(tenant_id,case_id,target,due_at) VALUES($1,$2,'supervisor',now())",[t,existing.id]);
  await c.query("INSERT INTO staffing_case_events(tenant_id,case_id,actor_user_id,event_type,details) VALUES($1,$2,$3,'pause_detected',$4)",[t,existing.id,actor,JSON.stringify({check_id:check.id,findings})]);
 }
 if(!findings.length&&(!check.checked_at||new Date(check.checked_at)<=new Date(existing.recheck_after)))findings=['fresh_crew_check_after_pause_required'];
 const status=findings.length?'open':'awaiting_release';
 if(existing.status!==status||existing.latest_check_id!==check.id||JSON.stringify(existing.findings)!==JSON.stringify(findings)){
  await c.query("UPDATE staffing_cases SET status=$3,latest_check_id=$4,findings=$5,recheck_after=CASE WHEN $3='open' THEN clock_timestamp() ELSE recheck_after END WHERE tenant_id=$1 AND id=$2",[t,existing.id,status,check.id,findings]);
  await c.query("INSERT INTO staffing_case_events(tenant_id,case_id,actor_user_id,event_type,details) VALUES($1,$2,$3,'coverage_rechecked',$4)",[t,existing.id,actor,JSON.stringify({check_id:check.id,status,findings})]);
 }
 return existing.id;
}
