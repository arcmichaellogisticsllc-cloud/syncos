import {BadRequestException,Body,Controller,Get,HttpCode,Inject,Post,Req,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Request} from 'express';
import {DATABASE_POOL} from '../modules/database.module';
import {Public} from '../security/public.decorator';
import {openIdentity,sealIdentity,tokenDigest} from '../identity/secret-envelope';
import {identityLimited} from '../identity/rate-limit';
import {sendIdentityMail} from '../email/identity-mail';
import {AuthController} from './auth.controller';
const generic={message:'If sign-in links are available for this account and workspace, an email will arrive with instructions.'};
const invalid=()=>new BadRequestException('This sign-in link is invalid or expired. Request a new link.');
@Controller('auth/magic-link')
export class MagicLinkController implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private processing=false;
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 onModuleInit(){if(process.env.MAGIC_LINK_ENABLED==='true'){this.timer=setInterval(()=>{void this.deliverPending().catch(()=>{});},5000);this.timer.unref();}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 @Get('availability') @Public() availability(){return {enabled:process.env.MAGIC_LINK_ENABLED==='true'};}
 @Post('request') @Public() @HttpCode(202)
 async request(@Req() req:Request,@Body() body:Record<string,unknown>){
  const email=String(body.email??'').trim().toLowerCase(),slug=String(body.tenant_slug??'').trim().toLowerCase();
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||slug.length>100)return generic;
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const limited=await identityLimited(c,'magic-link',req.ip??req.socket?.remoteAddress??'unknown',email);
   const users=(await c.query(`SELECT u.id,u.email,u.auth_version,t.id tenant_id FROM users u JOIN tenant_users tu ON tu.user_id=u.id JOIN tenants t ON t.id=tu.tenant_id
    WHERE lower(u.email)=$1 AND ($2='' OR t.slug=$2) AND u.status='active' AND tu.status='active' AND t.status='active'
    AND u.deleted_at IS NULL AND tu.deleted_at IS NULL AND t.deleted_at IS NULL`,[email,slug])).rows;
   // Never choose an arbitrary tenant for an account with multiple memberships.
   if(!limited&&users.length===1&&process.env.MAGIC_LINK_ENABLED==='true'){
    const user=users[0],base=new URL(process.env.APPLICATION_BASE_URL??'');
    if(base.protocol!=='https:'&&process.env.NODE_ENV!=='test')throw Error('HTTPS application address required');
    const token=randomBytes(32).toString('base64url'),url=new URL('/sign-in-link',base);url.hash='token='+token;
    await c.query(`INSERT INTO magic_link_requests(user_id,tenant_id,auth_version,token_hash,expires_at,encrypted_message) VALUES($1,$2,$3,$4,now()+interval '15 minutes',$5)`,[user.id,user.tenant_id,user.auth_version,tokenDigest(token),sealIdentity('magic-link',JSON.stringify({to:user.email,url:url.toString()}))]);
   }
   await c.query('COMMIT');return generic;
  }catch{await c.query('ROLLBACK');return generic;}finally{c.release();}
 }
 @Post('complete') @Public() @HttpCode(200)
 async complete(@Body() body:Record<string,unknown>){
  const token=String(body.token??'');if(process.env.MAGIC_LINK_ENABLED!=='true'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalid();
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const row=(await c.query(`SELECT r.* FROM magic_link_requests r JOIN users u ON u.id=r.user_id JOIN tenant_users tu ON tu.user_id=u.id AND tu.tenant_id=r.tenant_id JOIN tenants t ON t.id=r.tenant_id
    WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at>now() AND r.auth_version=u.auth_version
    AND u.status='active' AND tu.status='active' AND t.status='active' AND u.deleted_at IS NULL AND tu.deleted_at IS NULL AND t.deleted_at IS NULL FOR UPDATE OF r`,[tokenDigest(token)])).rows[0];
   if(!row)throw invalid();
   await c.query("UPDATE magic_link_requests SET used_at=now(),encrypted_message=NULL,delivery_status=CASE WHEN delivery_status='pending' THEN 'expired' ELSE delivery_status END WHERE id=$1",[row.id]);
   await c.query("INSERT INTO identity_audit(tenant_id,user_id,event_type,reference_id) VALUES($1,$2,'magic_link_sign_in',$3)",[row.tenant_id,row.user_id,row.id]);
   await c.query('COMMIT');
   // Recheck membership and password-reset version immediately before issuing a session.
   return await new AuthController(this.pool).sessionFor(row.user_id,row.tenant_id,row.auth_version);
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async deliverPending(){
  if(this.processing||process.env.MAGIC_LINK_ENABLED!=='true')return;
  this.processing=true;let c:PoolClient|undefined;try{c=await this.pool.connect();
   await c.query("UPDATE magic_link_requests SET encrypted_message=NULL,delivery_status='expired' WHERE delivery_status='pending' AND (expires_at<=now() OR used_at IS NOT NULL)");
   await c.query("DELETE FROM identity_rate_limits WHERE window_start<now()-interval '2 days'");
   await c.query('BEGIN');
   const row=(await c.query("SELECT * FROM magic_link_requests WHERE delivery_status='pending' AND expires_at>now() AND used_at IS NULL AND next_attempt_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
   if(row){try{
    const message=JSON.parse(openIdentity('magic-link',row.encrypted_message));await this.sendEmail(message.to,message.url,row.id);
    await c.query("UPDATE magic_link_requests SET delivery_status='sent',encrypted_message=NULL,attempts=attempts+1 WHERE id=$1",[row.id]);
   }catch{const failed=row.attempts>=2;
    await c.query("UPDATE magic_link_requests SET attempts=attempts+1,delivery_status=$2,encrypted_message=CASE WHEN $2='failed' THEN NULL ELSE encrypted_message END,next_attempt_at=now()+interval '1 minute' WHERE id=$1",[row.id,failed?'failed':'pending']);
    if(failed)await c.query("INSERT INTO identity_audit(tenant_id,user_id,event_type,reference_id) VALUES($1,$2,'magic_link_delivery_failed',$3)",[row.tenant_id,row.user_id,row.id]);
   }}await c.query('COMMIT');
  }catch(e){if(c)await c.query('ROLLBACK');throw e;}finally{c?.release();this.processing=false;}
 }
 protected sendEmail(to:string,url:string,id:string){return sendIdentityMail(to,url,id);}
}
