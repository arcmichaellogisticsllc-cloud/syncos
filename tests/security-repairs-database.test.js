const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {createAuthToken}=require('../packages/auth/dist');
const database=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL,base=process.env.SYNCOS_SECURITY_TEST_API;
test('security: project boundaries, immutable approval, finance exceptions and concurrent payment sources',{skip:!database||!base,timeout:60000},async()=>{
 assert.match(new URL(database).pathname,/security_audit/,'Only disposable security audit database is permitted');assert.match(base,/^http:\/\/127\.0\.0\.1:/);
 const pool=new Pool({connectionString:database});try{
 const q=(s,p)=>pool.query(s,p);const w=(await q('SELECT w.id,w.tenant_id FROM workers w JOIN tenants t ON t.id=w.tenant_id WHERE t.status=\'active\' LIMIT 1')).rows[0];assert.ok(w);const t=w.tenant_id;
 async function actor(keys,scope='tenant',scopeId=t){const u=(await q("INSERT INTO users(email,display_name) VALUES($1,'Synthetic security regression') RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id;const m=(await q('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[t,u])).rows[0].id;const r=(await q('INSERT INTO roles(tenant_id,name) VALUES($1,$2) RETURNING id',[t,'Synthetic '+randomUUID()])).rows[0].id;await q('INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key=ANY($3::text[])',[t,r,keys]);await q('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)',[t,m,r,scope,scopeId]);return {id:u,token:createAuthToken({sub:u,tenant_id:t,auth_version:0,exp:Math.floor(Date.now()/1000)+3600},process.env.AUTH_JWT_SECRET)};}
 async function call(a,path,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+a.token,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 async function project(tenant=t){return(await q("INSERT INTO projects(tenant_id,name) VALUES($1,'Synthetic scope target') RETURNING id",[tenant])).rows[0].id;}
 const pa=await project(),pb=await project(),user=await actor(['project.read','project.update'],'project',pa);let z=await call(user,'/projects/'+pa);assert.equal(z.status,200);z=await call(user,'/projects/'+pb,'PATCH',{risk_notes:'Forbidden'},{'x-scope-type':'project','x-scope-id':pa});assert.equal(z.status,403);assert.notEqual((await q('SELECT risk_notes FROM projects WHERE id=$1',[pb])).rows[0].risk_notes,'Forbidden');z=await call(user,'/projects','GET',null,{'x-scope-type':'project','x-scope-id':pb});assert.equal(z.status,200);assert.deepEqual(z.data.map(x=>x.id),[pa]);
 const foreign=(await q("INSERT INTO tenants(name,slug) VALUES('Synthetic foreign',$1) RETURNING id",['audit-'+randomUUID()])).rows[0].id;const pc=await project(foreign);assert.equal((await call(user,'/projects/'+pc)).status,403);
 const preparer=await actor(['payment_batch.read','payment_batch.add_item','payment_batch.update','payment_batch.submit_review']);const finance=await actor(['payment_batch.read','payment_batch.add_item','payment_batch.approve','payment_batch.schedule','payment_exception.approve']);
 async function source(held=false){const run=(await q("INSERT INTO payroll_runs(tenant_id,payroll_run_number,payroll_run_type,payroll_cycle,payroll_period_start,payroll_period_end,status,payroll_readiness_status,hold_status,net_pay_amount) VALUES($1,$2,'regular','weekly','2026-10-01','2026-10-07','payroll_ready','ready_for_payroll',$3,100) RETURNING id",[t,'AUDIT-'+randomUUID(),held?'hold':'none'])).rows[0].id;const item=(await q("INSERT INTO payroll_items(tenant_id,payroll_run_id,worker_id,source_type,earning_type,worker_classification,net_pay_amount) VALUES($1,$2,$3,'manual','regular','w2_employee',100) RETURNING id",[t,run,w.id])).rows[0].id;return{payroll_run_id:run,payroll_item_id:item};}
 async function batch(){return(await q("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method) VALUES($1,$2,'payroll','manual') RETURNING id",[t,'AUDIT-'+randomUUID()])).rows[0].id;}
 const src=await source(),b=await batch();z=await call(preparer,`/payment-batches/${b}/items/payroll-run`,'POST',{...src,payment_amount:101,override_reasons:{anything:'not authority'}});assert.equal(z.status,400);
 z=await call(preparer,`/payment-batches/${b}/items/payroll-run`,'POST',src);assert.equal(z.status,201,JSON.stringify(z));assert.equal((await call(preparer,`/payment-batches/${b}/items/payroll-run`,'POST',{...src,override_reasons:{anything:'not authority'}})).status,400);
 assert.equal((await call(preparer,`/payment-batches/${b}/submit-review`,'POST',{})).status,201);z=await call(finance,`/payment-batches/${b}/approve`,'POST',{approval_note:'Independent synthetic review'});assert.equal(z.status,201,JSON.stringify(z));assert.equal((await call(preparer,`/payment-batches/${b}`,'PATCH',{payment_method:'wire'})).status,400);assert.equal((await q('SELECT payment_method FROM payment_batches WHERE id=$1',[b])).rows[0].payment_method,'manual');await assert.rejects(q("UPDATE payment_batches SET payment_method='wire' WHERE id=$1",[b]),/Withdraw approval/);
 assert.equal((await call(finance,`/payment-batches/${b}/withdraw-approval`,'POST',{reason:'Synthetic change requires renewed review'})).status,201);assert.equal((await call(preparer,`/payment-batches/${b}`,'PATCH',{payment_method:'wire'})).status,200);
 const held=await source(true),hb=await batch();assert.equal((await call(preparer,`/payment-batches/${hb}/items/payroll-run`,'POST',held)).status,400);z=await call(preparer,`/payment-batches/${hb}/exceptions`,'POST',{source_type:'payroll',source_id:held.payroll_run_id,reason:'Synthetic hold reviewed independently'});assert.equal(z.status,201,JSON.stringify(z));const exception=z.data.id;assert.ok(exception);assert.equal((await call(preparer,`/payment-batches/${hb}/exceptions/${exception}/review`,'POST',{decision:'approved',approval_note:'Must not self approve'})).status,403);z=await call(finance,`/payment-batches/${hb}/exceptions/${exception}/review`,'POST',{decision:'approved',approval_note:'Independent synthetic finance review'});assert.equal(z.status,201,JSON.stringify(z));assert.equal((await call(preparer,`/payment-batches/${hb}/items/payroll-run`,'POST',{...held,approved_exception_id:exception,payment_amount:101})).status,400);z=await call(preparer,`/payment-batches/${hb}/items/payroll-run`,'POST',{...held,approved_exception_id:exception});assert.equal(z.status,201,JSON.stringify(z));

 // An approval is tied to the reviewed source and remains valid only while the
 // independent reviewer still has authority. Recheck again at batch approval.
 assert.equal((await call(preparer,`/payment-batches/${hb}/submit-review`,'POST',{})).status,201);
 await q("UPDATE payment_security_exceptions SET expires_at=now()-interval '1 second' WHERE id=$1",[exception]);
 assert.equal((await call(finance,`/payment-batches/${hb}/approve`,'POST',{approval_note:'Expired approval must fail'})).status,400);
 await q("UPDATE payment_security_exceptions SET expires_at=now()+interval '1 hour' WHERE id=$1",[exception]);
 await q("UPDATE payroll_runs SET net_pay_amount=99 WHERE id=$1",[held.payroll_run_id]);
 assert.equal((await call(finance,`/payment-batches/${hb}/approve`,'POST',{approval_note:'Changed source must fail'})).status,400);
 await q("UPDATE payroll_runs SET net_pay_amount=100 WHERE id=$1",[held.payroll_run_id]);
 await q("UPDATE tenant_users SET status='disabled' WHERE tenant_id=$1 AND user_id=$2",[t,finance.id]);
 assert.equal((await call(preparer,`/payment-batches/${hb}/items/payroll-run`,'POST',{...held,approved_exception_id:exception})).status,400);
 await q("UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2",[t,finance.id]);
 const selfBatch=await batch();z=await call(finance,`/payment-batches/${selfBatch}/exceptions`,'POST',{source_type:'payroll',source_id:held.payroll_run_id,reason:'Synthetic self approval attempt'});assert.equal(z.status,201);assert.equal((await call(finance,`/payment-batches/${selfBatch}/exceptions/${z.data.id}/review`,'POST',{decision:'approved',approval_note:'Forbidden self approval'})).status,400);

 const lifecycle=await actor(['payment_batch.reject','payment_batch.mark_failed','payment_batch.cancel','payment_batch.void','payment_batch.update']);
 await q("UPDATE payment_batches SET status='executed_later',execution_status='executed_later' WHERE id=$1",[b]);
 for(const [action,body] of [['reject',{rejection_reason:'Cannot reopen completed payment'}],['mark-failed',{failure_reason:'Cannot reopen completed payment'}],['cancel',{cancel_reason:'Cannot reopen completed payment'}],['void',{void_reason:'Cannot reopen completed payment'}]]){
  assert.equal((await call(lifecycle,`/payment-batches/${b}/${action}`,'POST',body)).status,400,action);
 }
 assert.equal((await q('SELECT status FROM payment_batches WHERE id=$1',[b])).rows[0].status,'executed_later');
 for(let n=0;n<3;n++){const race=await source(),ba=await batch(),bb=await batch();const results=await Promise.all([call(preparer,`/payment-batches/${ba}/items/payroll-run`,'POST',race),call(preparer,`/payment-batches/${bb}/items/payroll-run`,'POST',race)]);assert.deepEqual(results.map(x=>x.status).sort(),[201,400]);assert.equal(Number((await q('SELECT count(*) FROM payment_items WHERE payroll_item_id=$1',[race.payroll_item_id])).rows[0].count),1);}
 assert.ok(Number((await q("SELECT count(*) FROM audit_logs WHERE tenant_id=$1 AND action='payment_exception.reviewed'",[t])).rows[0].count)>0);
 }finally{await pool.end();}
});

test('database guard counts provider instructions before reserving a legacy payable item',{skip:!database},async()=>{
 assert.match(new URL(database).pathname,/security_audit/);
 const pool=new Pool({connectionString:database}),c=await pool.connect();
 try{
  await c.query('BEGIN');
  const tenant=(await c.query("INSERT INTO tenants(name,slug) VALUES('Synthetic source reservation',$1) RETURNING id",[randomUUID()])).rows[0].id;
  const organization=(await c.query("INSERT INTO organizations(tenant_id,name) VALUES($1,'Synthetic provider') RETURNING id",[tenant])).rows[0].id;
  const source=(await c.query("INSERT INTO contractor_payables(tenant_id,partner_organization_id,payable_number,payable_type,payable_party_type,net_payable_amount) VALUES($1,$2,$3,'subcontractor','capacity_provider',100) RETURNING *",[tenant,organization,randomUUID()])).rows[0];
  await c.query("INSERT INTO partner_payment_instructions(tenant_id,partner_organization_id,contractor_payable_id,amount,idempotency_key) VALUES($1,$2,$3,$4,$5)",[source.tenant_id,source.partner_organization_id,source.id,Number(source.net_payable_amount)-Number(source.paid_amount??0),randomUUID()]);
  const batch=(await c.query("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method) VALUES($1,$2,'contractor_payable','manual') RETURNING id",[source.tenant_id,'CROSS-'+randomUUID()])).rows[0].id;
  await assert.rejects(c.query("INSERT INTO payment_items(tenant_id,payment_batch_id,source_type,contractor_payable_id,payee_type,payment_method,payment_amount) VALUES($1,$2,'contractor_payable',$3,'capacity_provider','manual',1)",[source.tenant_id,batch,source.id]),/exceeds unreserved source amount/);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
