import {BadRequestException,Body,Controller,Get,HttpCode,HttpException,Inject,NotFoundException,Param,Post,Req} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Request} from 'express';
import {DATABASE_POOL} from '../modules/database.module';
import {Public} from '../security/public.decorator';
import {RequirePermission,TenantPermissionOnly} from '../security/require-permission.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
import {executeWriteAction} from '@syncos/shared';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const uuid=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v))throw new BadRequestException('Invalid record reference.');return v;};
const text=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new BadRequestException('Complete all required fields within the displayed limits.');return v.trim();};
export async function inquiryOwnerAvailable(c:Pool|PoolClient,tenant:string,user:string){return Boolean((await c.query(`SELECT 1 FROM tenant_users tu JOIN users u ON u.id=tu.user_id JOIN tenants t ON t.id=tu.tenant_id
 WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='active' AND tu.deleted_at IS NULL AND u.status='active' AND u.deleted_at IS NULL AND t.status='active' AND t.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.tenant_id=ur.tenant_id AND r.deleted_at IS NULL JOIN role_permissions rp ON rp.role_id=ur.role_id AND rp.tenant_id=ur.tenant_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.tenant_user_id=tu.id AND ur.tenant_id=tu.tenant_id AND ur.scope_type='tenant' AND p.key='customer_inquiry.manage')`,[tenant,user])).rowCount);}
@Controller('public/customer-intake')
export class PublicCustomerIntakeController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Get(':slug') @Public()
 async describe(@Param('slug') slug:string){const row=(await this.pool.query("SELECT c.label,c.privacy_notice FROM customer_intake_channels c JOIN tenants t ON t.id=c.tenant_id WHERE c.slug=$1 AND c.enabled AND t.status='active' AND t.deleted_at IS NULL",[slug])).rows[0];if(!row)throw new NotFoundException('Request channel unavailable.');return row;}
 @Post(':slug') @Public() @HttpCode(202)
 async submit(@Param('slug') slug:string,@Req() req:Request,@Body() b:Record<string,unknown>){
  const key=uuid(b.request_key),name=text(b.customer_name,200),email=text(b.email,254).toLowerCase(),subject=text(b.subject,240),details=text(b.details,10000);
  if(!/^\S+@\S+\.\S+$/.test(email)||b.consent!==true)throw new BadRequestException('Provide a valid email and permission to process this request.');
  const receipt={message:'Your request was received for review. This does not approve work or establish commercial terms.',reference:key};
  const c=await this.pool.connect();try{await c.query('BEGIN');
   // Persist throttling even for unavailable channels and honeypot submissions. Never trust forwarded IP headers.
   let limited=false;
   for(const [value,maximum] of [[`ip:${req.ip??req.socket?.remoteAddress??'unknown'}`,30],[`email:${email}`,5]] as const){const r=(await c.query(`INSERT INTO public_intake_limits(key_hash) VALUES($1) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN public_intake_limits.window_start<now()-interval '1 hour' THEN 1 ELSE public_intake_limits.attempts+1 END,window_start=CASE WHEN public_intake_limits.window_start<now()-interval '1 hour' THEN now() ELSE public_intake_limits.window_start END RETURNING attempts`,[hash(value)])).rows[0];if(r.attempts>maximum)limited=true;}
   await c.query('COMMIT');if(limited)throw new HttpException('Too many requests. Try again later.',429);
   if(b.website)return receipt;
   await c.query('BEGIN');const channel=(await c.query(`SELECT c.* FROM customer_intake_channels c JOIN tenants t ON t.id=c.tenant_id WHERE c.slug=$1 AND c.enabled AND t.status='active' AND t.deleted_at IS NULL FOR SHARE OF c`,[slug])).rows[0];
   if(!channel)throw new NotFoundException('Request channel unavailable.');
   const digest=hash(JSON.stringify([name,email,subject,details]));
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[channel.id+':'+key]);
   const prior=(await c.query('SELECT payload_hash FROM public_intake_receipts WHERE channel_id=$1 AND request_key=$2',[channel.id,key])).rows[0];
   if(prior){if(prior.payload_hash!==digest)throw new BadRequestException('This submission reference has different contents. Start a new request.');await c.query('COMMIT');return receipt;}
   if(!await inquiryOwnerAvailable(c,channel.tenant_id,channel.owner_user_id)||!await inquiryOwnerAvailable(c,channel.tenant_id,channel.escalation_user_id))throw new HttpException('This request channel is temporarily unavailable.',503);
   const inquiry=(await c.query(`INSERT INTO customer_service_inquiries(tenant_id,request_key,customer_name,email,subject,details,source_reference,status,owner_user_id,due_at) VALUES($1,gen_random_uuid(),$2,$3,$4,$5,$6,'assigned',$7,now()+$8::int*interval '1 hour') RETURNING id`,[channel.tenant_id,name,email,subject,details,'Public channel '+channel.id+'; customer consent recorded',channel.owner_user_id,channel.follow_up_hours])).rows[0];
   await c.query('INSERT INTO public_intake_receipts(channel_id,request_key,tenant_id,inquiry_id,payload_hash) VALUES($1,$2,$3,$4,$5)',[channel.id,key,channel.tenant_id,inquiry.id,digest]);
   await c.query(`INSERT INTO inquiry_follow_up_notifications(tenant_id,inquiry_id,recipient_user_id,kind,dedupe_key) VALUES($1,$2,$3,'assigned',$4)`,[channel.tenant_id,inquiry.id,channel.owner_user_id,'assigned:'+inquiry.id]);
   await c.query('COMMIT');return receipt;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}
@Controller('customer-intake-channels') @TenantPermissionOnly()
export class CustomerIntakeChannelsController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Get() @RequirePermission('customer_inquiry.manage')
 async list(@Req() r:AuthenticatedRequest){return (await this.pool.query('SELECT * FROM customer_intake_channels WHERE tenant_id=$1 ORDER BY label',[r.auth.tenantId])).rows;}
 @Post() @RequirePermission('customer_inquiry.manage')
 async save(@Req() r:AuthenticatedRequest,@Body() b:Record<string,unknown>){const slug=text(b.slug,80),label=text(b.label,200),privacy=text(b.privacy_notice,4000),owner=uuid(b.owner_user_id),escalation=uuid(b.escalation_user_id),hours=Number(b.follow_up_hours);if(!/^[a-z0-9][a-z0-9-]{7,79}$/.test(slug)||!Number.isInteger(hours)||hours<1||hours>720||typeof b.enabled!=='boolean')throw new BadRequestException('Choose a valid channel address, enabled state and a follow-up deadline from 1 to 720 hours.');
  const c=await this.pool.connect();try{return await executeWriteAction(c,{tenantId:r.auth.tenantId,actorUserId:r.auth.userId,action:'customer_intake.configured',aggregateType:'customer_intake_channel',eventType:'customer_intake.configured',write:async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['intake-channel:'+slug]);
   const old=(await tx.query('SELECT * FROM customer_intake_channels WHERE slug=$1',[slug])).rows[0];if(old&&old.tenant_id!==r.auth.tenantId)throw new BadRequestException('Channel address unavailable.');
   for(const user of [owner,escalation])if(!await inquiryOwnerAvailable(tx,r.auth.tenantId,user))throw new BadRequestException('Choose active authorized inquiry owners.');
   const row=(await tx.query(`INSERT INTO customer_intake_channels(tenant_id,slug,label,privacy_notice,owner_user_id,escalation_user_id,follow_up_hours,enabled,configured_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(slug) DO UPDATE SET label=EXCLUDED.label,privacy_notice=EXCLUDED.privacy_notice,owner_user_id=EXCLUDED.owner_user_id,escalation_user_id=EXCLUDED.escalation_user_id,follow_up_hours=EXCLUDED.follow_up_hours,enabled=EXCLUDED.enabled,configured_by=EXCLUDED.configured_by,updated_at=now() RETURNING *`,[r.auth.tenantId,slug,label,privacy,owner,escalation,hours,b.enabled,r.auth.userId])).rows[0];return {entityType:'customer_intake_channel',entityId:row.id,beforeState:old,afterState:row};}});}finally{c.release();}
 }
}
