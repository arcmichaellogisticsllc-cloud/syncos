import {BadRequestException,Body,Controller,HttpCode,Inject,Post,Req,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {hashPassword,validatePassword} from '@syncos/auth';
import type {Pool,PoolClient} from 'pg';
import type {Request} from 'express';
import {DATABASE_POOL} from '../modules/database.module';
import {Public} from '../security/public.decorator';
import {sendSmtpRelayEmail} from '../email/smtp-relay';
const response={message:'If this account can be recovered, an email will arrive with instructions. Check your inbox or contact your administrator.'};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
@Controller('auth/password-recovery')
export class PasswordRecoveryController implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private processing=false;
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 onModuleInit(){if(process.env.PASSWORD_RECOVERY_ENABLED==='true'){this.timer=setInterval(()=>{void this.deliverPending().catch(()=>{});},5000);this.timer.unref();}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private key(){const secret=process.env.AUTH_JWT_SECRET;if(!secret||secret.length<32)throw new Error('Recovery encryption unavailable');return createHash('sha256').update('syncos-password-recovery:'+secret).digest();}
 private encrypt(text:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(),iv),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
 private decrypt(value:string){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',this.key(),b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');}
 @Post('request') @Public() @HttpCode(202)
 async request(@Req() req:Request,@Body() body:Record<string,unknown>){
  const email=String(body.email??'').trim().toLowerCase();
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))return response;
  const c=await this.pool.connect();try{await c.query('BEGIN');
   let limited=false;
   for(const [value,max] of [[`ip:${req.ip??req.socket?.remoteAddress??'unknown'}`,20],[`email:${email}`,3]] as const){
    const key=digest(value);
    const row=(await c.query(`INSERT INTO password_recovery_limits(key_hash,window_start,attempts) VALUES($1,now(),1) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN password_recovery_limits.window_start<now()-interval '1 hour' THEN 1 ELSE password_recovery_limits.attempts+1 END,window_start=CASE WHEN password_recovery_limits.window_start<now()-interval '1 hour' THEN now() ELSE password_recovery_limits.window_start END RETURNING attempts`,[key])).rows[0];
    if(row.attempts>max)limited=true;
   }
   const user=(await c.query(`SELECT u.id,u.email FROM users u WHERE lower(u.email)=$1 AND u.status='active' AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM tenant_users tu JOIN tenants t ON t.id=tu.tenant_id WHERE tu.user_id=u.id AND tu.status='active' AND tu.deleted_at IS NULL AND t.status='active' AND t.deleted_at IS NULL)`,[email])).rows[0];
   if(!limited&&user&&process.env.PASSWORD_RECOVERY_ENABLED==='true'){
    const base=new URL(process.env.APPLICATION_BASE_URL??'');if(base.protocol!=='https:'&&process.env.NODE_ENV!=='test')throw new Error('Recovery requires an HTTPS application address');
    const token=randomBytes(32).toString('base64url');const url=new URL('/reset-password',base);url.hash='token='+token;
    await c.query(`INSERT INTO password_recovery_requests(user_id,token_hash,expires_at,encrypted_message) VALUES($1,$2,now()+interval '15 minutes',$3)`,[user.id,digest(token),this.encrypt(JSON.stringify({to:user.email,url:url.toString()}))]);
   }
   await c.query('COMMIT');return response;
  }catch{await c.query('ROLLBACK');return response;}finally{c.release();}
 }
 @Post('complete') @Public() @HttpCode(200)
 async complete(@Body() body:Record<string,unknown>){
  if(process.env.PASSWORD_RECOVERY_ENABLED!=='true')throw new BadRequestException('Password recovery is unavailable. Contact your administrator.');
  const token=String(body.token??''),password=String(body.password??'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new BadRequestException('This recovery link is invalid or expired. Request a new link.');
  const error=validatePassword(password);if(error)throw new BadRequestException(error);
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const owner=(await c.query('SELECT user_id FROM password_recovery_requests WHERE token_hash=$1',[digest(token)])).rows[0];
   if(!owner)throw new BadRequestException('This recovery link is invalid or expired. Request a new link.');
   // Serialize different links for the same account before locking individual requests.
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['password-recovery:'+owner.user_id]);
   const row=(await c.query(`SELECT r.id,r.user_id FROM password_recovery_requests r JOIN users u ON u.id=r.user_id WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at>now() AND u.status='active' AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM tenant_users tu JOIN tenants t ON t.id=tu.tenant_id WHERE tu.user_id=u.id AND tu.status='active' AND tu.deleted_at IS NULL AND t.status='active' AND t.deleted_at IS NULL) FOR UPDATE OF u,r`,[digest(token)])).rows[0];
   if(!row)throw new BadRequestException('This recovery link is invalid or expired. Request a new link.');
   await c.query('UPDATE users SET password_hash=$2,auth_version=auth_version+1,updated_at=now() WHERE id=$1',[row.user_id,hashPassword(password)]);
   await c.query("UPDATE password_recovery_requests SET used_at=now(),encrypted_message=NULL,delivery_status=CASE WHEN delivery_status='pending' THEN 'expired' ELSE delivery_status END WHERE user_id=$1 AND used_at IS NULL",[row.user_id]);
   await c.query("INSERT INTO password_recovery_audit(user_id,request_id,event_type) VALUES($1,$2,'password_reset')",[row.user_id,row.id]);
   await c.query('COMMIT');return {message:'Password updated. Sign in again on each device.'};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async deliverPending(){
  if(this.processing||process.env.PASSWORD_RECOVERY_ENABLED!=='true')return;
  this.processing=true;let c:PoolClient|undefined;try{
   c=await this.pool.connect();
   await c.query("UPDATE password_recovery_requests SET encrypted_message=NULL,delivery_status='expired' WHERE delivery_status='pending' AND expires_at<=now()");
   await c.query("DELETE FROM password_recovery_limits WHERE window_start<now()-interval '2 days'");
   await c.query('BEGIN');
   const row=(await c.query("SELECT * FROM password_recovery_requests WHERE delivery_status='pending' AND expires_at>now() AND used_at IS NULL AND next_attempt_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
   if(row){try{
     const message=JSON.parse(this.decrypt(row.encrypted_message));
     await this.sendRecoveryEmail(message.to,message.url);
     await c.query("UPDATE password_recovery_requests SET encrypted_message=NULL,delivery_status='sent',attempts=attempts+1 WHERE id=$1",[row.id]);
    }catch{
     const failed=row.attempts>=2;
     await c.query("UPDATE password_recovery_requests SET attempts=attempts+1,delivery_status=$2,encrypted_message=CASE WHEN $2='failed' THEN NULL ELSE encrypted_message END,next_attempt_at=now()+interval '1 minute' WHERE id=$1",[row.id,failed?'failed':'pending']);
     if(failed)await c.query("INSERT INTO password_recovery_audit(user_id,request_id,event_type) VALUES($1,$2,'delivery_failed')",[row.user_id,row.id]);
    }}
   await c.query('COMMIT');
  }catch(e){if(c)await c.query('ROLLBACK');throw e;}finally{c?.release();this.processing=false;}
 }
 protected async sendRecoveryEmail(to:string,url:string){
  if(process.env.NODE_ENV==='staging'&&!(process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST??'').split(',').map(s=>s.trim().toLowerCase()).includes(to.toLowerCase()))throw new Error('Recipient not allowed');
  const message={from:process.env.EMAIL_FROM??'',to,subject:'Reset your SyncOS password',text:`Use this link within 15 minutes to reset your password:\n\n${url}\n\nIf you did not request this, you can ignore this email.`};
  if(process.env.EMAIL_PROVIDER==='smtp_relay'){await sendSmtpRelayEmail(message);return;}
  if(process.env.EMAIL_PROVIDER==='generic_http'){
   const endpoint=new URL(process.env.EMAIL_HTTP_ENDPOINT??'');if(endpoint.protocol!=='https:')throw new Error('HTTPS email endpoint required');
   const result=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${process.env.EMAIL_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(10000)});if(!result.ok)throw new Error('Email delivery failed');return;
  }
  throw new Error('Email delivery is not configured');
 }
}
