const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,randomBytes,createHash}=require('node:crypto'),http=require('node:http'),{Pool}=require('pg');
const {MagicLinkController}=require('../apps/api/dist/routes/magic-link.controller');
const {PasswordRecoveryController}=require('../apps/api/dist/routes/password-recovery.controller');
const {SsoController}=require('../apps/api/dist/routes/sso.controller');
const {AuthenticatedGuard}=require('../apps/api/dist/security/authenticated.guard');
const {verifyAuthToken}=require('@syncos/auth');
const database=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
const token=()=>randomBytes(32).toString('base64url');
async function fixture(pool){const tag=randomUUID(),email=tag+'@synthetic.test',slug='identity-'+tag;const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic identity',$1) RETURNING id",[slug])).rows[0].id;const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic identity') RETURNING id",[email])).rows[0].id;await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2)',[tenant,user]);return {tenant,user,email,slug};}
function environment(values){const before={...process.env};Object.assign(process.env,values);return()=>{for(const k of Object.keys(values))if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];};}
test('magic links: separate token domain, one-use concurrency, tenant choice, revocation, expiry and bounded delivery',{skip:!database},async t=>{
 const restore=environment({NODE_ENV:'test',MAGIC_LINK_ENABLED:'true',PASSWORD_RECOVERY_ENABLED:'true',APPLICATION_BASE_URL:'https://synthetic.invalid',AUTH_JWT_SECRET:'synthetic-alternative-signin-key-never-production'}),pool=new Pool({connectionString:database});
 try{
 const a=await fixture(pool),controller=new MagicLinkController(pool),sent=[];controller.sendEmail=async(to,url)=>sent.push({to,url});
 const req={ip:randomUUID()};const known=await controller.request(req,{email:a.email}),unknown=await controller.request(req,{email:'unknown-'+a.email});assert.deepEqual(known,unknown);
 let row=(await pool.query('SELECT * FROM magic_link_requests WHERE user_id=$1',[a.user])).rows[0];assert.match(row.token_hash,/^[a-f0-9]{64}$/);assert.ok(!row.encrypted_message.includes(a.email));
 await controller.deliverPending();const linkToken=new URLSearchParams(new URL(sent[0].url).hash.slice(1)).get('token');
 await assert.rejects(new PasswordRecoveryController(pool).complete({token:linkToken,password:'Synthetic-new-password'}),/invalid or expired/);
 const results=await Promise.allSettled([controller.complete({token:linkToken}),controller.complete({token:linkToken})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const login=results.find(r=>r.status==='fulfilled').value;assert.equal(login.tenant_id,a.tenant);assert.deepEqual(login.context.roles,[]);assert.equal(verifyAuthToken(login.token,process.env.AUTH_JWT_SECRET).sub,a.user);
 assert.equal((await pool.query("SELECT count(*)::int n FROM identity_audit WHERE user_id=$1 AND event_type='magic_link_sign_in'",[a.user])).rows[0].n,1);
 const b=await fixture(pool);await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2)',[b.tenant,a.user]);
 await controller.request(req,{email:a.email});assert.equal((await pool.query('SELECT count(*)::int n FROM magic_link_requests WHERE user_id=$1',[a.user])).rows[0].n,1);
 await controller.request(req,{email:a.email,tenant_slug:b.slug});await controller.deliverPending();const tenantToken=new URLSearchParams(new URL(sent[1].url).hash.slice(1)).get('token');assert.equal((await controller.complete({token:tenantToken})).tenant_id,b.tenant);
 for(const scenario of ['disabled','expired','revoked','reset'])await t.test(scenario,async()=>{
  const f=await fixture(pool);await controller.request({ip:randomUUID()},{email:f.email});await controller.deliverPending();const current=new URLSearchParams(new URL(sent.at(-1).url).hash.slice(1)).get('token');
  if(scenario==='disabled')process.env.MAGIC_LINK_ENABLED='false';
  if(scenario==='expired')await pool.query("UPDATE magic_link_requests SET expires_at=now()-interval '1 second' WHERE user_id=$1",[f.user]);
  if(scenario==='revoked')await pool.query("UPDATE tenant_users SET deleted_at=now() WHERE user_id=$1",[f.user]);
  if(scenario==='reset')await pool.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[f.user]);
  await assert.rejects(controller.complete({token:current}),/invalid or expired/);process.env.MAGIC_LINK_ENABLED='true';
 });
 const f=await fixture(pool);let attempts=0;controller.sendEmail=async()=>{attempts++;throw Error('Synthetic provider outage');};await controller.request({ip:randomUUID()},{email:f.email});
 for(let i=0;i<4;i++){await pool.query('UPDATE magic_link_requests SET next_attempt_at=now() WHERE user_id=$1',[f.user]);await controller.deliverPending();}assert.equal(attempts,3);row=(await pool.query('SELECT * FROM magic_link_requests WHERE user_id=$1',[f.user])).rows[0];assert.equal(row.delivery_status,'failed');assert.equal(row.encrypted_message,null);
 }finally{await pool.end();restore();}
});
test('OIDC: signed tokens, explicit links, PKCE, nonce/state binding, tenant permissions and revocation',{skip:!database},async t=>{
 const restore=environment({NODE_ENV:'test',SSO_ENABLED:'true',APPLICATION_BASE_URL:'https://synthetic.invalid',SSO_CLIENT_SECRET_SYNTHETIC:'synthetic-provider-secret',AUTH_JWT_SECRET:'synthetic-alternative-signin-key-never-production'}),pool=new Pool({connectionString:database});
 let server;try{
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'synthetic',alg:'RS256',use:'sig'};let issuer,claims,expectedChallenge;
 server=http.createServer(async(req,res)=>{if(req.url==='/jwks'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));return;}if(req.url==='/token'){let raw='';for await(const part of req)raw+=part;const form=new URLSearchParams(raw);assert.equal(form.get('client_secret'),'synthetic-provider-secret');assert.equal(form.get('redirect_uri'),'https://synthetic.invalid/sso/callback');assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),expectedChallenge);const jwt=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(pair.privateKey);res.setHeader('content-type','application/json');res.end(JSON.stringify({id_token:jwt}));return;}res.statusCode=404;res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));issuer='http://127.0.0.1:'+server.address().port;
 const f=await fixture(pool),other=await fixture(pool),controller=new SsoController(pool),admin={auth:{tenantId:f.tenant,userId:f.user}};
 const settings={name:'Synthetic OIDC',issuer,client_id:'syncos-synthetic',secret_env:'SSO_CLIENT_SECRET_SYNTHETIC',authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',enabled:true};
 const connection=await controller.configure(admin,settings);
 await assert.rejects(controller.link(admin,{connection_id:connection.id,user_id:other.user,subject:'other-subject',active:true}),/active member/);
 await controller.link(admin,{connection_id:connection.id,user_id:f.user,subject:'approved-subject',active:true});
 async function start(){const binding=token(),request=await controller.start({ip:randomUUID()},{connection_id:connection.id,binding}),url=new URL(request.authorization_url);expectedChallenge=url.searchParams.get('code_challenge');assert.equal(url.searchParams.get('code_challenge_method'),'S256');const now=Math.floor(Date.now()/1000);claims={iss:issuer,aud:'syncos-synthetic',sub:'approved-subject',iat:now,exp:now+300,nonce:url.searchParams.get('nonce'),roles:['system_admin']};return {state:url.searchParams.get('state'),binding,code:'synthetic-code'};}
 let request=await start();await assert.rejects(controller.complete({...request,binding:token()}),/could not/);const result=await controller.complete(request);assert.equal(result.tenant_id,f.tenant);assert.deepEqual(result.context.roles,[]);assert.ok(verifyAuthToken(result.token,process.env.AUTH_JWT_SECRET).sso_link_id);await assert.rejects(controller.complete(request),/could not/);
 for(const scenario of ['nonce','issuer','audience','expired','unlinked','authorized-party'])await t.test(scenario,async()=>{request=await start();if(scenario==='nonce')claims.nonce=token();if(scenario==='issuer')claims.iss=issuer+'/wrong';if(scenario==='audience')claims.aud='other-client';if(scenario==='expired')claims.exp=Math.floor(Date.now()/1000)-30;if(scenario==='unlinked')claims.sub='unlinked-subject';if(scenario==='authorized-party'){claims.aud=['syncos-synthetic','another'];claims.azp='another';}await assert.rejects(controller.complete(request),/could not/);});
 const guard=new AuthenticatedGuard({getAllAndOverride:()=>false},pool),context={getHandler:()=>null,getClass:()=>null,switchToHttp:()=>({getRequest:()=>({header:n=>n==='authorization'?'Bearer '+result.token:undefined})})};assert.equal(await guard.canActivate(context),true);
 await controller.configure(admin,{...settings,id:connection.id,enabled:false});await assert.rejects(guard.canActivate(context),/SSO access has changed/);await assert.rejects(controller.start({ip:randomUUID()},{connection_id:connection.id,binding:token()}),/could not/);
 await assert.rejects(controller.configure(admin,{...settings,id:connection.id,issuer:issuer+'/other'}),/issuer change/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM oidc_identity_links WHERE connection_id=$1',[connection.id])).rows[0].n,1);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();restore();}
});
