const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {Pool}=require('pg');
const database=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL;
test('login limits survive independent connections, serialize concurrent attempts and expire',{skip:!database},async()=>{
 assert.match(new URL(database).pathname,/security_audit/);
 const {consumeLoginBudget,clearLoginAccountBudget}=require('../apps/api/dist/security/login-budget');
 const a=new Pool({connectionString:database}),b=new Pool({connectionString:database});
 const email=randomUUID()+'@example.invalid',ip='synthetic-'+randomUUID();
 const key=createHash('sha256').update('account:'+email).digest('hex');
 try{
  const attempts=await Promise.allSettled(Array.from({length:12},(_,i)=>consumeLoginBudget(i%2?a:b,email,ip)));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,10);
  assert.equal(attempts.filter(x=>x.status==='rejected').length,2);
  await a.end();
  await assert.rejects(consumeLoginBudget(b,email,ip),/Invalid email or password/);
  await b.query("UPDATE password_login_limits SET window_start=now()-interval '16 minutes' WHERE key_hash=$1",[key]);
  await consumeLoginBudget(b,email,ip);
  assert.equal((await b.query('SELECT attempts FROM password_login_limits WHERE key_hash=$1',[key])).rows[0].attempts,1);
  await clearLoginAccountBudget(b,email);
  assert.equal((await b.query('SELECT count(*)::int n FROM password_login_limits WHERE key_hash=$1',[key])).rows[0].n,0);
 }finally{if(!a.ended)await a.end();await b.end();}
});
