import {BadRequestException,Body,Controller,Get,HttpCode,Inject,Post,Query,Req} from '@nestjs/common';
import type {Request} from 'express';
import type {Pool} from 'pg';
import {DATABASE_POOL} from '../modules/database.module';
import {Public} from '../security/public.decorator';
import {RequirePermission,TenantPermissionOnly} from '../security/require-permission.decorator';
import type {AuthenticatedRequest} from './intelligence.types';
import {AuthController} from './auth.controller';
import {authorizationRequest,exchangeIdentity,randomIdentityToken,validateConnection,type OidcConnection} from '../identity/oidc';
import {identityLimited} from '../identity/rate-limit';
import {openIdentity,sealIdentity,tokenDigest} from '../identity/secret-envelope';
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const invalid=()=>new BadRequestException('SSO sign-in could not be completed. Start again or contact your administrator.');
@Controller('auth/sso')
export class SsoController {
 constructor(@Inject(DATABASE_POOL) private readonly pool:Pool){}
 @Get('availability') @Public() availability(){return {enabled:process.env.SSO_ENABLED==='true'};}
 @Get('providers') @Public()
 async providers(@Query('workspace') workspace:string){
  if(process.env.SSO_ENABLED!=='true'||!workspace||workspace.length>100)return {providers:[]};
  return {providers:(await this.pool.query(`SELECT c.id,c.name FROM oidc_connections c JOIN tenants t ON t.id=c.tenant_id WHERE c.enabled AND t.slug=$1 AND t.status='active' AND t.deleted_at IS NULL ORDER BY c.name`,[workspace])).rows};
 }
 @Post('start') @Public() @HttpCode(200)
 async start(@Req() req:Request,@Body() body:Record<string,unknown>){
  if(process.env.SSO_ENABLED!=='true'||!uuid(body.connection_id)||typeof body.binding!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.binding))throw invalid();
  const c=await this.pool.connect();try{await c.query('BEGIN');
   if(await identityLimited(c,'sso-start',req.ip??req.socket?.remoteAddress??'unknown',String(body.connection_id)+body.binding)){await c.query('COMMIT');throw invalid();}
   const connection=(await c.query(`SELECT c.* FROM oidc_connections c JOIN tenants t ON t.id=c.tenant_id WHERE c.id=$1 AND c.enabled AND t.status='active' AND t.deleted_at IS NULL`,[body.connection_id])).rows[0];if(!connection)throw invalid();
   const state=randomIdentityToken(),nonce=randomIdentityToken(),verifier=randomIdentityToken();
   const url=authorizationRequest(connection,state,nonce,verifier);
   await c.query("UPDATE oidc_login_requests SET encrypted_verifier=NULL,used_at=now() WHERE expires_at<=now() AND used_at IS NULL");
   await c.query(`INSERT INTO oidc_login_requests(connection_id,connection_version,state_hash,binding_hash,nonce,encrypted_verifier,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,[connection.id,connection.version,tokenDigest(state),tokenDigest(body.binding),nonce,sealIdentity('sso-verifier',verifier)]);
   await c.query('COMMIT');return {authorization_url:url};
  }catch{await c.query('ROLLBACK');throw invalid();}finally{c.release();}
 }
 @Post('complete') @Public() @HttpCode(200)
 async complete(@Body() body:Record<string,unknown>){
  if(process.env.SSO_ENABLED!=='true'||typeof body.state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.state)||typeof body.binding!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.binding)||typeof body.code!=='string'||!body.code||body.code.length>4096)throw invalid();
  const client=await this.pool.connect();let pending,connection;
  try{await client.query('BEGIN');
   pending=(await client.query(`SELECT * FROM oidc_login_requests WHERE state_hash=$1 AND binding_hash=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,[tokenDigest(body.state),tokenDigest(body.binding)])).rows[0];
   if(!pending)throw invalid();
   connection=(await client.query('SELECT * FROM oidc_connections WHERE id=$1 AND enabled AND version=$2',[pending.connection_id,pending.connection_version])).rows[0];
   if(!connection)throw invalid();
   await client.query('UPDATE oidc_login_requests SET used_at=now(),encrypted_verifier=NULL WHERE id=$1',[pending.id]);
   await client.query('COMMIT');
  }catch{await client.query('ROLLBACK');throw invalid();}finally{client.release();}
  try{
   const identity=await exchangeIdentity(connection,body.code,openIdentity('sso-verifier',pending.encrypted_verifier),pending.nonce);
   const link=(await this.pool.query(`SELECT l.id,l.user_id,u.auth_version FROM oidc_identity_links l
    JOIN oidc_connections c ON c.id=l.connection_id JOIN users u ON u.id=l.user_id
    WHERE l.connection_id=$1 AND l.subject=$2 AND l.active AND c.enabled AND c.version=$3`,[connection.id,identity.subject,connection.version])).rows[0];
   if(!link)throw invalid();
   const result=await new AuthController(this.pool).sessionFor(link.user_id,connection.tenant_id,link.auth_version,{linkId:link.id,connectionVersion:connection.version});
   await this.pool.query("INSERT INTO identity_audit(tenant_id,user_id,event_type,reference_id) VALUES($1,$2,'sso_sign_in',$3)",[connection.tenant_id,link.user_id,link.id]);
   return result;
  }catch{throw invalid();}
 }
 @Get('connections') @RequirePermission('admin.manage_users') @TenantPermissionOnly()
 async connections(@Req() req:AuthenticatedRequest){return {connections:(await this.pool.query('SELECT id,name,issuer,client_id,secret_env,authorization_endpoint,token_endpoint,jwks_uri,enabled,version FROM oidc_connections WHERE tenant_id=$1 ORDER BY name',[req.auth.tenantId])).rows};}
 @Get('links') @RequirePermission('admin.manage_users') @TenantPermissionOnly()
 async links(@Req() req:AuthenticatedRequest,@Query('connection_id') connection:string){if(!uuid(connection))throw new BadRequestException('Choose a connection');return {links:(await this.pool.query(`SELECT l.id,l.user_id,l.subject,l.active,u.email,u.display_name FROM oidc_identity_links l JOIN users u ON u.id=l.user_id WHERE l.tenant_id=$1 AND l.connection_id=$2 ORDER BY u.email`,[req.auth.tenantId,connection])).rows};}
 @Get('members') @RequirePermission('admin.manage_users') @TenantPermissionOnly()
 async members(@Req() req:AuthenticatedRequest,@Query('search') search:string){return {members:(await this.pool.query(`SELECT u.id,u.email,u.display_name FROM users u JOIN tenant_users tu ON tu.user_id=u.id WHERE tu.tenant_id=$1 AND tu.status='active' AND u.status='active' AND tu.deleted_at IS NULL AND u.deleted_at IS NULL AND (u.email ILIKE $2 OR u.display_name ILIKE $2) ORDER BY u.email LIMIT 50`,[req.auth.tenantId,'%'+String(search??'').slice(0,100)+'%'])).rows};}
 @Post('connections') @RequirePermission('admin.manage_users') @TenantPermissionOnly()
 async configure(@Req() req:AuthenticatedRequest,@Body() body:Record<string,unknown>){
  const values:Record<string,string>={};for(const key of ['name','issuer','client_id','secret_env','authorization_endpoint','token_endpoint','jwks_uri']){if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>2048)throw new BadRequestException('Complete the SSO connection settings');values[key]=body[key].trim();}
  try{validateConnection(values as unknown as OidcConnection);}catch{throw new BadRequestException('SSO endpoints and credential reference must be approved by the server operator');}
  if(body.id!==undefined&&!uuid(body.id))throw new BadRequestException('Invalid connection');
  const c=await this.pool.connect();try{await c.query('BEGIN');let row;
   if(body.id)row=(await c.query(`UPDATE oidc_connections SET name=$3,issuer=$4,client_id=$5,secret_env=$6,authorization_endpoint=$7,token_endpoint=$8,jwks_uri=$9,enabled=$10,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND issuer=$4 RETURNING id,version`,[req.auth.tenantId,body.id,values.name,values.issuer,values.client_id,values.secret_env,values.authorization_endpoint,values.token_endpoint,values.jwks_uri,body.enabled===true])).rows[0];
   else row=(await c.query(`INSERT INTO oidc_connections(tenant_id,name,issuer,client_id,secret_env,authorization_endpoint,token_endpoint,jwks_uri,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version`,[req.auth.tenantId,values.name,values.issuer,values.client_id,values.secret_env,values.authorization_endpoint,values.token_endpoint,values.jwks_uri,body.enabled===true])).rows[0];
   if(!row)throw new BadRequestException('Connection not found; an issuer change requires a new connection and new identity links');
   await c.query("INSERT INTO identity_audit(tenant_id,actor_id,event_type,reference_id) VALUES($1,$2,'sso_connection_configured',$3)",[req.auth.tenantId,req.auth.userId,row.id]);await c.query('COMMIT');return row;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 @Post('links') @RequirePermission('admin.manage_users') @TenantPermissionOnly()
 async link(@Req() req:AuthenticatedRequest,@Body() body:Record<string,unknown>){
  if(!uuid(body.connection_id)||!uuid(body.user_id)||typeof body.subject!=='string'||!body.subject.trim()||body.subject.length>512||typeof body.active!=='boolean')throw new BadRequestException('Connection, member, provider subject and active state are required');
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const eligible=(await c.query(`SELECT 1 FROM oidc_connections oc JOIN tenant_users tu ON tu.tenant_id=oc.tenant_id JOIN users u ON u.id=tu.user_id WHERE oc.id=$1 AND oc.tenant_id=$2 AND tu.user_id=$3 AND ($4=false OR (tu.status='active' AND tu.deleted_at IS NULL AND u.status='active' AND u.deleted_at IS NULL))`,[body.connection_id,req.auth.tenantId,body.user_id,body.active])).rows[0];if(!eligible)throw new BadRequestException('Choose an active member in this workspace');
   // A subject cannot silently be transferred to another SyncOS user.
   const row=(await c.query(`INSERT INTO oidc_identity_links(tenant_id,connection_id,user_id,subject,active) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(connection_id,user_id) DO UPDATE SET active=EXCLUDED.active WHERE oidc_identity_links.subject=EXCLUDED.subject RETURNING id`,[req.auth.tenantId,body.connection_id,body.user_id,body.subject,body.active])).rows[0];if(!row)throw new BadRequestException('Identity differs from the approved link');
   await c.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[body.user_id]);
   await c.query("INSERT INTO identity_audit(tenant_id,user_id,actor_id,event_type,reference_id) VALUES($1,$2,$3,$4,$5)",[req.auth.tenantId,body.user_id,req.auth.userId,body.active?'sso_identity_linked':'sso_identity_revoked',row.id]);await c.query('COMMIT');return {id:row.id,active:body.active};
  }catch(e){await c.query('ROLLBACK');if((e as {code?:string}).code==='23505')throw new BadRequestException('This provider identity is already linked');throw e;}finally{c.release();}
 }
}
