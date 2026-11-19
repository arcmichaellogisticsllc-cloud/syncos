import {ForbiddenException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import type {AuthenticatedRequest} from '../routes/intelligence.types';
export type ProjectWritePolicy = {projectId:string;permission:string;sourceTable?:string;sourceId?:string;evidenceId?:string};
export type ScopedWriteRequest = AuthenticatedRequest & {projectWritePolicy?:ProjectWritePolicy};
export async function verifyProjectWrite(client:PoolClient,request:ScopedWriteRequest) {
 const policy=request.projectWritePolicy;if(!policy)return;
 // Hold the project and effective grants through the business transaction.
 const result=await client.query<{scope_type:string;territory_id:string|null;source_coverage_plan_id:string|null}>(`SELECT ur.scope_type,p.territory_id,p.source_coverage_plan_id FROM projects p
 JOIN tenant_users tu ON tu.tenant_id=p.tenant_id AND tu.user_id=$2
 JOIN user_roles ur ON ur.tenant_user_id=tu.id AND ur.tenant_id=tu.tenant_id
 JOIN roles ro ON ro.id=ur.role_id AND ro.tenant_id=tu.tenant_id
 JOIN role_permissions rp ON rp.role_id=ro.id AND rp.tenant_id=tu.tenant_id
 JOIN permissions perm ON perm.id=rp.permission_id
 WHERE p.tenant_id=$1 AND p.id=$3 AND p.deleted_at IS NULL
 AND tu.status='active' AND tu.deleted_at IS NULL AND ro.deleted_at IS NULL AND perm.key=$4
 AND (ur.scope_type='tenant' OR (ur.scope_type='project' AND ur.scope_id=p.id)
 OR (ur.scope_type='customer' AND ur.scope_id=p.customer_organization_id)
 OR (ur.scope_type='territory' AND ur.scope_id=p.territory_id))
 FOR UPDATE OF p FOR SHARE OF tu,ur,ro,rp`,[request.auth.tenantId,request.auth.userId,policy.projectId,policy.permission]);
 if(!result.rowCount)throw new ForbiddenException('Project authority changed; reload and retry');
 if(policy.sourceTable && policy.sourceId){
  if(!['projects','work_orders','production_records','qc_reviews','billable_items'].includes(policy.sourceTable))throw new ForbiddenException('Unregistered resource policy');
  const current=await client.query(`SELECT ${policy.sourceTable==='projects'?'id':'project_id'} AS project_id FROM ${policy.sourceTable} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,[request.auth.tenantId,policy.sourceId]);
  if(current.rows[0]?.project_id!==policy.projectId)throw new ForbiddenException('Resource project changed; reload and retry');
 }
 if(policy.evidenceId){
  const evidence=await client.query('SELECT production_record_id FROM production_evidence WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[request.auth.tenantId,policy.evidenceId]);
  if(evidence.rows[0]?.production_record_id!==policy.sourceId)throw new ForbiddenException('Evidence source changed; reload and retry');
 }
 if(!result.rows.some(row=>row.scope_type==='tenant')) {
  if(request.body?.project_id!==undefined&&request.body.project_id!==policy.projectId)throw new ForbiddenException('Moving work between projects requires tenant-wide authority');
  for(const [key,table]of [['work_order_id','work_orders'],['production_record_id','production_records'],['parent_production_record_id','production_records'],['source_qc_review_id','qc_reviews'],['qc_review_id','qc_reviews']]){
   if(request.body?.[key]!==undefined&&request.body[key]!==null){
    if(typeof request.body[key]!=='string')throw new ForbiddenException('Invalid related work');
    const related=await client.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1 AND id::text=$2 AND project_id=$3 AND deleted_at IS NULL`,[request.auth.tenantId,request.body[key],policy.projectId]);
    if(!related.rowCount)throw new ForbiddenException('Related work must belong to the authorized project');
   }
  }
  if(request.body?.file_id!==undefined&&request.body.file_id!==null){
   const linked=await client.query(`SELECT 1 FROM files f JOIN file_links l ON l.file_id=f.id AND l.tenant_id=f.tenant_id
     WHERE f.tenant_id=$1 AND f.id::text=$2 AND f.deleted_at IS NULL AND
     ((l.entity_type='project' AND l.entity_id=$3) OR
       (l.entity_type='work_order' AND EXISTS(SELECT 1 FROM work_orders w WHERE w.id=l.entity_id AND w.tenant_id=f.tenant_id AND w.project_id=$3 AND w.deleted_at IS NULL)) OR
       (l.entity_type='production_record' AND EXISTS(SELECT 1 FROM production_records pr WHERE pr.id=l.entity_id AND pr.tenant_id=f.tenant_id AND pr.project_id=$3 AND pr.deleted_at IS NULL)))`,[request.auth.tenantId,String(request.body.file_id),policy.projectId]);
   if(!linked.rowCount)throw new ForbiddenException('File must be linked to the authorized project');
  }
  const project=result.rows[0];
  if(request.body?.territory_id!==undefined&&request.body.territory_id!==project.territory_id)throw new ForbiddenException('Changing work territory requires tenant-wide authority');
  if(request.body?.coverage_plan_id!==undefined&&request.body.coverage_plan_id!==project.source_coverage_plan_id)throw new ForbiddenException('Changing coverage ownership requires tenant-wide authority');
  for(const [key,table]of [['coverage_requirement_id','coverage_requirements'],['coverage_source_id','coverage_sources']]){
   if(request.body?.[key]!==undefined){
    if(typeof request.body[key]!=='string'||!project.source_coverage_plan_id)throw new ForbiddenException('Coverage must belong to the authorized project');
    const related=await client.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1 AND id::text=$2 AND coverage_plan_id=$3 AND deleted_at IS NULL`,[request.auth.tenantId,request.body[key],project.source_coverage_plan_id]);
    if(!related.rowCount)throw new ForbiddenException('Coverage must belong to the authorized project');
   }
  }
 }
}
