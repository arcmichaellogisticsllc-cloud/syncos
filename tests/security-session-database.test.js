const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {createAuthToken}=require('../packages/auth/dist');
const db=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL,base=process.env.SYNCOS_SECURITY_TEST_API;
test('sign-out revokes only the current session and records an audit event',{skip:!db||!base},async()=>{assert.match(new URL(db).pathname,/security_audit/);assert.match(base,/^http:\/\/127\.0\.0\.1:/);const p=new Pool({connectionString:db});try{
const tenant=(await p.query("SELECT id FROM tenants WHERE status='active' LIMIT 1")).rows[0].id;
const user=(await p.query("INSERT INTO users(email,display_name) VALUES($1,'Session regression') RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id;
await p.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2)',[tenant,user]);
const claims={sub:user,tenant_id:tenant,auth_version:0};const a=createAuthToken(claims,process.env.AUTH_JWT_SECRET),b=createAuthToken(claims,process.env.AUTH_JWT_SECRET);assert.notEqual(a,b);
const call=(token,path='/auth/me',method='GET')=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
assert.equal((await call(a)).status,200);assert.equal((await call(a,'/auth/logout','POST')).status,200);assert.equal((await call(a)).status,401);assert.equal((await call(b)).status,200);
assert.equal(Number((await p.query("SELECT count(*) FROM audit_logs WHERE actor_user_id=$1 AND action='auth.signed_out'",[user])).rows[0].count),1);
}finally{await p.end();}});
