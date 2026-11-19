const test=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),{Client}=require('pg');
const {configureRuntimeRole}=require('../scripts/security/runtime-database-access');
const url=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL;
test('runtime can perform application DML but cannot rewrite schema, migrations or audit history',{skip:!url},async()=>{
 assert.match(new URL(url).pathname,/security_audit/);
 const admin=new Client({connectionString:url});await admin.connect();const role='security_runtime_'+randomBytes(6).toString('hex'),password=randomBytes(36).toString('base64url');const privilegedRole='security_owner_'+randomBytes(6).toString('hex');let runtime;
 try{
  await admin.query(`CREATE ROLE "${privilegedRole}" NOLOGIN`);
  const plan=await configureRuntimeRole(admin,{role,password});assert.equal(plan.applied,false);
  await configureRuntimeRole(admin,{role,password,apply:true});
  const connection=new URL(url);connection.username=role;connection.password=password;
  runtime=new Client({connectionString:connection.href});await runtime.connect();
  assert.equal((await require('../scripts/security/verify-runtime-access').verifyRuntimeAccess(runtime)).status,'passed');
  await assert.rejects(require('../scripts/security/verify-runtime-access').verifyRuntimeAccess(admin),/privilege verification failed/);
  assert.equal((await runtime.query('SELECT current_user')).rows[0].current_user,role);
  await runtime.query('SELECT count(*) FROM users');await runtime.query('BEGIN');
  const key=randomBytes(32).toString('hex');await runtime.query('INSERT INTO password_login_limits(key_hash,attempts,window_start) VALUES($1,1,now())',[key]);
  assert.equal((await runtime.query('UPDATE password_login_limits SET attempts=2 WHERE key_hash=$1 RETURNING attempts',[key])).rows[0].attempts,2);
  for(const sql of ["CREATE TABLE public.forbidden_runtime_ddl(id int)","ALTER TABLE users ADD COLUMN forbidden_runtime_ddl int","UPDATE audit_logs SET action='tampered' WHERE false","DELETE FROM identity_audit WHERE false","INSERT INTO schema_migrations(id) VALUES('forbidden.sql')",`SET ROLE "${privilegedRole}"`]){
   await runtime.query('SAVEPOINT denied');await assert.rejects(runtime.query(sql),e=>e.code==='42501');await runtime.query('ROLLBACK TO SAVEPOINT denied');
  }
  await runtime.query('ROLLBACK');
 }finally{if(runtime)await runtime.end();await admin.query(`DROP OWNED BY "${role}"`);await admin.query(`DROP ROLE "${role}"`);await admin.query(`DROP ROLE "${privilegedRole}"`);await admin.end();}
});
