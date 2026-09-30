import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { hasActiveFieldStop } from './field-stop-scope';
import { lockWorkSafety,safetyBlockers } from './work-safety';

// Administrative production entry uses the same field prerequisites. It cannot
// replace a missing mobilization, individual JSA review or pre-bore approval.
export async function requireRecordWorkAuthorization(c:PoolClient,record:Record<string,any>){
 const tenant=record.tenant_id,workOrder=record.work_order_id,crew=record.crew_id;
 if(!tenant||!workOrder||!crew)throw new BadRequestException('An assigned work order and crew are required for production authorization');
 const date=String(record.production_date instanceof Date?record.production_date.toISOString():record.production_date).slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new BadRequestException('A valid production date is required');
 if(await hasActiveFieldStop(c,tenant,workOrder,crew))throw new BadRequestException('crew_work_order_stopped');
 const versions=(await c.query(`SELECT v.* FROM partner_work_order_versions v WHERE v.tenant_id=$1 AND v.work_order_id=$2 AND v.deleted_at IS NULL AND v.status='active'
   AND (v.assigned_crew_id=$3 OR EXISTS(SELECT 1 FROM partner_work_order_crew_assignments a WHERE a.tenant_id=v.tenant_id AND a.work_order_version_id=v.id AND a.crew_id=$3 AND a.status='active'))
   AND ($4::uuid IS NULL OR v.id=$4) ORDER BY v.version_number DESC LIMIT 2`,[tenant,workOrder,crew,record.work_order_version_id??null])).rows;
 if(versions.length!==1)throw new BadRequestException('One active, assigned work-order version is required; review mobilization before recording production');
 const v=versions[0];
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenant}:jsa:${v.id}:${crew}:${date}`]);
 await lockWorkSafety(c,tenant,workOrder);
 const current=(await c.query('SELECT * FROM partner_work_order_versions WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[tenant,v.id])).rows[0];
 if(current?.status!=='active'||!current.safety_scope_reviewed_at)throw new BadRequestException('work_safety_scope_not_reviewed');
 if(current.execution_model==='internal'){
  const ready=await c.query("SELECT id FROM internal_field_clearances WHERE tenant_id=$1 AND work_order_version_id=$2 AND status='authorized' AND valid_until>=CURRENT_DATE AND valid_until>=$3::date",[tenant,v.id,date]);
  if(!ready.rows.length)throw new BadRequestException('internal_readiness_not_authorized');
 }else{
  const ready=await c.query("SELECT id FROM production_start_authorizations WHERE tenant_id=$1 AND work_order_version_id=$2 AND crew_id=$3 AND current=true AND authorization_status='authorized'",[tenant,v.id,crew]);
  if(!ready.rows.length)throw new BadRequestException('production_start_not_authorized');
 }
 const jsa=(await c.query("SELECT * FROM daily_jsas WHERE tenant_id=$1 AND work_order_version_id=$2 AND crew_id=$3 AND work_date=$4::date AND current=true AND deleted_at IS NULL",[tenant,v.id,crew,date])).rows[0];
 if(jsa?.status!=='completed')throw new BadRequestException('daily_jsa_incomplete');
 const code=record.rate_code_id?(await c.query('SELECT code FROM rate_codes WHERE tenant_id=$1 AND id=$2',[tenant,record.rate_code_id])).rows[0]?.code:null;
 const blocked=await safetyBlockers(c,tenant,workOrder,crew,jsa,current.pre_bore_required===true||['BORE','PLOW','EXCAVATION'].includes(String(code).toUpperCase()));
 if(blocked.length)throw new BadRequestException(blocked.join(','));
 return {work_order_version_id:v.id,safety_jsa_id:jsa.id};
}
