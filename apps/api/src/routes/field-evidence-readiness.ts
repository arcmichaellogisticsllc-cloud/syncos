import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lockWorkSafety } from './work-safety';
export const evidenceKinds=['before','during','after','as_built','test_result','permit','other'];
export function evidenceRequirements(value:unknown):Record<string,number>{
 if(!value||Array.isArray(value)||typeof value!=='object')throw new BadRequestException('Specify the required evidence categories and counts; an empty object requires an explicit approved source');
 const result:Record<string,number>={};
 for(const [kind,count] of Object.entries(value)){
  if(!evidenceKinds.includes(kind)||!Number.isInteger(count)||Number(count)<1||Number(count)>100)throw new BadRequestException('Evidence requirements must use supported categories and counts from 1 to 100');
  result[kind]=Number(count);
 }
 return result;
}
export async function evidenceReadiness(c:PoolClient,tenant:string,reportId:string,readable=false,selectedIds?:string[]){
 const report=(await c.query('SELECT id,work_order_version_id,evidence_policy_id FROM daily_production_reports WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[tenant,reportId])).rows[0];
 if(!report)throw new BadRequestException('Daily report not found');
 const policy=(await c.query(`SELECT * FROM field_evidence_policies WHERE tenant_id=$1 AND ($3::uuid IS NOT NULL AND id=$3 OR $3::uuid IS NULL AND work_order_version_id=$2) ORDER BY revision_number DESC LIMIT 1`,[tenant,report.work_order_version_id,report.evidence_policy_id])).rows[0];
 const files=(await c.query(`SELECT id,evidence_kind,captured_at,capture_location,received_revision_number,readability_status,production_record_id,file_name,checksum,created_at FROM syncfield_field_evidence WHERE tenant_id=$1 AND daily_report_id=$2 ORDER BY created_at FOR SHARE`,[tenant,reportId])).rows;
 const eligible=files.filter(f=>(!selectedIds||selectedIds.includes(f.id))&&f.readability_status!=='unreadable'&&(!readable||f.readability_status==='readable')&&(!policy?.capture_time_required||f.captured_at));
 const missing=policy?Object.entries(policy.requirements as Record<string,number>).flatMap(([kind,count])=>{const n=new Set(eligible.filter(f=>f.evidence_kind===kind).map(f=>f.checksum)).size;return n<count?[`${kind}: ${count-n} required file(s) missing${readable?' or not reviewed as readable':''}`]:[];}):['Approved work-order evidence requirements are missing'];
 return {policy,files,missing,ready:missing.length===0};
}
export async function requireEvidenceReady(c:PoolClient,tenant:string,reportId:string,readable=false,selectedIds?:string[]){
 const report=(await c.query('SELECT work_order_id FROM daily_production_reports WHERE tenant_id=$1 AND id=$2',[tenant,reportId])).rows[0];
 if(!report)throw new BadRequestException('Daily report not found');
 await lockWorkSafety(c,tenant,report.work_order_id);
 await c.query('SELECT id FROM daily_production_reports WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,reportId]);
 const result=await evidenceReadiness(c,tenant,reportId,readable,selectedIds);
 if(!result.ready)throw new BadRequestException(result.missing.join('; '));
 await c.query('UPDATE daily_production_reports SET evidence_policy_id=$3 WHERE tenant_id=$1 AND id=$2 AND evidence_policy_id IS NULL',[tenant,reportId,result.policy.id]);
 return result;
}
