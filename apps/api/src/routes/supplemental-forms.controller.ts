import {workspaceHistory,type HistoryQuery} from './workspace-history';
import {BadRequestException,Body,Controller,Get,Inject,Param,Post,Req,Query} from '@nestjs/common';
import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {executeWriteAction} from '@syncos/shared';
import {validateFormTemplate,validateFormAnswers} from '@syncos/shared/form-schema';
import {DATABASE_POOL} from '../modules/database.module';
import {RequirePermission,TenantPermissionOnly} from '../security/require-permission.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
function uuid(value:unknown){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('A valid record reference is required.');return value;}
function validate<T>(fn:()=>T):T{try{return fn();}catch(e){throw new BadRequestException((e as Error).message);}}
@Controller('supplemental-forms') @TenantPermissionOnly()
export class SupplementalFormsController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Get() @RequirePermission('form.read')
 async list(@Req() r:AuthenticatedRequest,@Query() query:HistoryQuery={}){return workspaceHistory(this.pool,r.auth.tenantId,'forms',query);}
 @Get('records') @RequirePermission('form.read')
 async records(@Req() r:AuthenticatedRequest,@Query() query:HistoryQuery={}){return workspaceHistory(this.pool,r.auth.tenantId,'records',query);}
 @Post('versions') @RequirePermission('form.manage')
 async create(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){
  const schema=validate(()=>validateFormTemplate(b.schema)),key=uuid(b.request_key),family=b.family_id?uuid(b.family_id):null;
  return this.write(r,'form.version_created',async c=>{
   await this.lock(c,r,key);
   const prior=(await c.query('SELECT * FROM supplemental_form_versions WHERE tenant_id=$1 AND request_key=$2',[r.auth.tenantId,key])).rows[0];
   if(prior){if(JSON.stringify(validateFormTemplate(prior.schema))!==JSON.stringify(schema)||(family&&prior.family_id!==family))throw new BadRequestException('This request was already used for different contents.');return {entityType:'supplemental_form_version',entityId:prior.id,afterState:prior,skipEventAudit:true};}
   const familyId=family??randomUUID();
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.auth.tenantId+':form-family:'+familyId]);
   const previous=(await c.query('SELECT max(version) AS version FROM supplemental_form_versions WHERE tenant_id=$1 AND family_id=$2',[r.auth.tenantId,familyId])).rows[0];
   if(family&&!previous.version)throw new BadRequestException('Form family is unavailable in this organization.');
   const row=(await c.query('INSERT INTO supplemental_form_versions(tenant_id,family_id,version,schema,created_by,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[r.auth.tenantId,familyId,Number(previous.version??0)+1,JSON.stringify(schema),r.auth.userId,key])).rows[0];
   return {entityType:'supplemental_form_version',entityId:row.id,afterState:row};
  });
 }
 @Post('versions/:id/publish') @RequirePermission('form.manage')
 async publish(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){
  uuid(id);if(b.approved!==true)throw new BadRequestException('Review and approve this supplemental form before publishing.');
  return this.write(r,'form.published',async c=>{
   const row=(await c.query('SELECT * FROM supplemental_form_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[r.auth.tenantId,id])).rows[0];if(!row)throw new BadRequestException('Form version unavailable.');
   if(row.status==='published')return {entityType:'supplemental_form_version',entityId:id,afterState:row,skipEventAudit:true};
   validate(()=>validateFormTemplate(row.schema));
   const after=(await c.query("UPDATE supplemental_form_versions SET status='published',published_by=$3,published_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",[r.auth.tenantId,id,r.auth.userId])).rows[0];
   return {entityType:'supplemental_form_version',entityId:id,beforeState:row,afterState:after};
  });
 }
 @Get('assignments') @RequirePermission('form.manage')
 async assignments(@Req() r:AuthenticatedRequest){return (await this.pool.query(`SELECT a.id,p.name AS project_name,c.name AS crew_name,w.work_order_number,
 COALESCE((SELECT json_agg(f.version_id) FROM supplemental_form_assignments f WHERE f.tenant_id=a.tenant_id AND f.assignment_id=a.id AND f.active),'[]') AS version_ids
 FROM syncfield_map_assignments a JOIN projects p ON p.tenant_id=a.tenant_id AND p.id=a.project_id JOIN crews c ON c.tenant_id=a.tenant_id AND c.id=a.crew_id JOIN partner_work_order_versions w ON w.tenant_id=a.tenant_id AND w.id=a.work_order_version_id
 WHERE a.tenant_id=$1 AND a.current AND a.assignment_status='active' AND a.deleted_at IS NULL ORDER BY p.name,c.name`,[r.auth.tenantId])).rows;}
 @Post('assignments') @RequirePermission('form.manage')
 async assign(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){const version=uuid(b.version_id),assignment=uuid(b.assignment_id);if(typeof b.active!=='boolean')throw new BadRequestException('Choose whether this form assignment is active.');
 return this.write(r,'form.assignment_changed',async c=>{
 const a=(await c.query("SELECT id FROM syncfield_map_assignments WHERE tenant_id=$1 AND id=$2 AND current AND assignment_status='active' AND deleted_at IS NULL FOR SHARE",[r.auth.tenantId,assignment])).rows[0];
 const v=(await c.query("SELECT id FROM supplemental_form_versions WHERE tenant_id=$1 AND id=$2 AND status='published'",[r.auth.tenantId,version])).rows[0];if(!a||!v)throw new BadRequestException('Choose an active assignment and published form in this organization.');
 const row=(await c.query(`INSERT INTO supplemental_form_assignments(tenant_id,version_id,assignment_id,assigned_by,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,version_id,assignment_id) DO UPDATE SET active=EXCLUDED.active,assigned_by=EXCLUDED.assigned_by RETURNING *`,[r.auth.tenantId,version,assignment,r.auth.userId,b.active])).rows[0];return {entityType:'supplemental_form_assignment',entityId:assignment,afterState:row};});}
 @Post('records') @RequirePermission('form.submit')
 async submit(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){
  const version=uuid(b.version_id),key=uuid(b.request_key);
  return this.write(r,'form.submitted',async c=>{
   await this.lock(c,r,key);
   const v=(await c.query("SELECT * FROM supplemental_form_versions WHERE tenant_id=$1 AND id=$2 AND status='published'",[r.auth.tenantId,version])).rows[0];if(!v)throw new BadRequestException('Select a published form from this organization.');
   const answers=validate(()=>validateFormAnswers(v.schema,b.answers));
   const old=(await c.query('SELECT * FROM supplemental_form_records WHERE tenant_id=$1 AND request_key=$2',[r.auth.tenantId,key])).rows[0];
   if(old){if(old.version_id!==version||old.submitted_by!==r.auth.userId||JSON.stringify(validateFormAnswers(v.schema,old.answers))!==JSON.stringify(answers))throw new BadRequestException('This request was already submitted with different contents.');return {entityType:'supplemental_form_record',entityId:old.id,afterState:old,skipEventAudit:true};}
   const row=(await c.query('INSERT INTO supplemental_form_records(tenant_id,version_id,schema_snapshot,answers,submitted_by,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[r.auth.tenantId,version,JSON.stringify(v.schema),JSON.stringify(answers),r.auth.userId,key])).rows[0];
   return {entityType:'supplemental_form_record',entityId:row.id,afterState:row};
  });
 }
 private async lock(c:PoolClient,r:AuthenticatedRequest,key:string){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.auth.tenantId+':form-request:'+key]);}
 private async write(r:AuthenticatedRequest,event:string,write:(c:PoolClient)=>Promise<any>){const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action:event,aggregateType:'supplemental_form',eventType:event,write});}finally{c.release();}}
}
