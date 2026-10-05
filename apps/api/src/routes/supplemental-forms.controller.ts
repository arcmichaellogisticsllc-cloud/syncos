import {workspaceHistory,type HistoryQuery} from './workspace-history';
import {BadRequestException,Body,Controller,Get,Inject,Param,Post,Req,Query} from '@nestjs/common';
import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {executeWriteAction} from '@syncos/shared';
import {validateFormTemplate,validateFormAnswers} from '@syncos/shared/form-schema';
import {DATABASE_POOL} from '../modules/database.module';
import {RequirePermission} from '../security/require-permission.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
function uuid(value:unknown){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('A valid record reference is required.');return value;}
function validate<T>(fn:()=>T):T{try{return fn();}catch(e){throw new BadRequestException((e as Error).message);}}
@Controller('supplemental-forms')
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
