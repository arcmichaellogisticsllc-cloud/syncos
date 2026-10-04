const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {PasswordRecoveryController}=require('../apps/api/dist/routes/password-recovery.controller');
const {AuthenticatedGuard}=require('../apps/api/dist/security/authenticated.guard');
const {hashPassword,verifyPassword,createAuthToken}=require('@syncos/auth');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('recovery protects tokens, resets once and revokes all old sessions',{skip:!url},async()=>{
 const old={...process.env};Object.assign(process.env,{PASSWORD_RECOVERY_ENABLED:'true',APPLICATION_BASE_URL:'https://synthetic.invalid',AUTH_JWT_SECRET:'synthetic-recovery-test-key-never-production'});
 const pool=new Pool({connectionString:url});
 try{
 const tag=randomUUID(),email=tag+'@synthetic.test';
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic recovery',$1) RETURNING id",['recovery-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name,password_hash) VALUES($1,'Synthetic recovery',$2) RETURNING id",[email,hashPassword('Original-test-password')])).rows[0].id;
 await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2)',[tenant,user]);
 const controller=new PasswordRecoveryController(pool),sent=[];controller.sendRecoveryEmail=async(to,link)=>sent.push({to,link});
 const req={ip:'192.0.2.'+Math.floor(Math.random()*200)};
 const known=await controller.request(req,{email}),unknown=await controller.request(req,{email:randomUUID()+'@synthetic.test'});assert.deepEqual(known,unknown);
 const row=(await pool.query('SELECT * FROM password_recovery_requests WHERE user_id=$1',[user])).rows[0];assert.match(row.token_hash,/^[a-f0-9]{64}$/);assert.ok(row.encrypted_message);assert.ok(!row.encrypted_message.includes(email));assert.ok(!JSON.stringify(known).includes('token'));
 await controller.deliverPending();assert.equal(sent.length,1);const token=new URLSearchParams(new URL(sent[0].link).hash.slice(1)).get('token');assert.ok(token);assert.ok(!row.encrypted_message.includes(token));
 process.env.PASSWORD_RECOVERY_ENABLED='false';
 await assert.rejects(controller.complete({token,password:'Disabled-test-password'}),/unavailable/);
 process.env.PASSWORD_RECOVERY_ENABLED='true';
 await pool.query("UPDATE tenant_users SET deleted_at=now() WHERE user_id=$1",[user]);
 await assert.rejects(controller.complete({token,password:'Inactive-test-password'}),/invalid or expired/);
 await pool.query("UPDATE tenant_users SET deleted_at=NULL WHERE user_id=$1",[user]);
 const oldToken=createAuthToken({sub:user,tenant_id:tenant,auth_version:0},process.env.AUTH_JWT_SECRET);
 const guard=new AuthenticatedGuard({getAllAndOverride:()=>false},pool);
 const context=bearer=>({getHandler:()=>null,getClass:()=>null,switchToHttp:()=>({getRequest:()=>({header:n=>n==='authorization'?'Bearer '+bearer:undefined})})});
 assert.equal(await guard.canActivate(context(oldToken)),true);
 const results=await Promise.allSettled([controller.complete({token,password:'New-safe-test-password'}),controller.complete({token,password:'Other-test-password'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(controller.complete({token,password:'Reuse-token-password'}),/invalid or expired/);
 await assert.rejects(guard.canActivate(context(oldToken)),/Session expired/);
 const updated=(await pool.query('SELECT * FROM users WHERE id=$1',[user])).rows[0];assert.equal(updated.auth_version,1);assert.ok(verifyPassword('New-safe-test-password',updated.password_hash)||verifyPassword('Other-test-password',updated.password_hash));
 assert.equal(await guard.canActivate(context(createAuthToken({sub:user,tenant_id:tenant,auth_version:1},process.env.AUTH_JWT_SECRET))),true);
 assert.equal((await pool.query("SELECT count(*)::int n FROM password_recovery_audit WHERE user_id=$1 AND event_type='password_reset'",[user])).rows[0].n,1);
 for(let i=0;i<5;i++)assert.deepEqual(await controller.request(req,{email}),known);
 assert.equal((await pool.query('SELECT count(*)::int n FROM password_recovery_requests WHERE user_id=$1',[user])).rows[0].n,3);
 // Only this synthetic user's queued messages are tested; no external email is sent.
 await pool.query("UPDATE password_recovery_requests SET delivery_status='expired',encrypted_message=NULL WHERE user_id=$1 AND used_at IS NULL",[user]);
 }finally{await pool.end();for(const k of ['PASSWORD_RECOVERY_ENABLED','APPLICATION_BASE_URL','AUTH_JWT_SECRET'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});

test('delivery resumes after a database connection failure',async()=>{
 const before=process.env.PASSWORD_RECOVERY_ENABLED;process.env.PASSWORD_RECOVERY_ENABLED='true';
 let attempts=0;
 const controller=new PasswordRecoveryController({connect:async()=>{attempts++;throw new Error('Synthetic database outage');}});
 try{await assert.rejects(controller.deliverPending(),/Synthetic database outage/);await assert.rejects(controller.deliverPending(),/Synthetic database outage/);assert.equal(attempts,2);}finally{if(before===undefined)delete process.env.PASSWORD_RECOVERY_ENABLED;else process.env.PASSWORD_RECOVERY_ENABLED=before;}
});

test('delivery retries are bounded and expired links cannot reset passwords',{skip:!url},async()=>{
 const old={...process.env};Object.assign(process.env,{PASSWORD_RECOVERY_ENABLED:'true',APPLICATION_BASE_URL:'https://synthetic.invalid',AUTH_JWT_SECRET:'synthetic-recovery-test-key-never-production'});
 const pool=new Pool({connectionString:url});
 try{
 const tag=randomUUID(),email=tag+'@synthetic.test';
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic retry',$1) RETURNING id",['retry-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name,password_hash) VALUES($1,'Synthetic retry',$2) RETURNING id",[email,hashPassword('Original-test-password')])).rows[0].id;
 await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2)',[tenant,user]);
 const controller=new PasswordRecoveryController(pool);let calls=0;controller.sendRecoveryEmail=async()=>{calls++;throw new Error('Synthetic delivery outage');};
 await controller.request({ip:'198.51.100.2'},{email});
 for(let i=0;i<3;i++){await pool.query('UPDATE password_recovery_requests SET next_attempt_at=now() WHERE user_id=$1',[user]);await controller.deliverPending();}
 const row=(await pool.query('SELECT * FROM password_recovery_requests WHERE user_id=$1',[user])).rows[0];
 assert.equal(calls,3);assert.equal(row.delivery_status,'failed');assert.equal(row.encrypted_message,null);
 await controller.deliverPending();assert.equal(calls,3);
 assert.equal((await pool.query("SELECT count(*)::int n FROM password_recovery_audit WHERE user_id=$1 AND event_type='delivery_failed'",[user])).rows[0].n,1);
 const links=[];controller.sendRecoveryEmail=async(to,link)=>links.push(link);
 await controller.request({ip:'198.51.100.2'},{email});await controller.deliverPending();
 const token=new URLSearchParams(new URL(links[0]).hash.slice(1)).get('token');
 await pool.query("UPDATE password_recovery_requests SET expires_at=now()-interval '1 second' WHERE user_id=$1",[user]);
 await assert.rejects(controller.complete({token,password:'Expired-link-password'}),/invalid or expired/);
 assert.equal((await pool.query('SELECT auth_version FROM users WHERE id=$1',[user])).rows[0].auth_version,0);
 }finally{await pool.end();for(const k of ['PASSWORD_RECOVERY_ENABLED','APPLICATION_BASE_URL','AUTH_JWT_SECRET'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});
