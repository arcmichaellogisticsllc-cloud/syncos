const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {AccountOnboardingController}=require('../apps/api/dist/routes/account-onboarding.controller');
const database=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('onboarding edits reject stale revisions and preserve finance and work authorization',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic onboarding',$1) RETURNING id",['onboard-'+randomUUID()])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic reviewer') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const org=(await pool.query("INSERT INTO organizations(tenant_id,name,type,status) VALUES($1,'Synthetic prime','customer','active') RETURNING id",[tenant])).rows[0].id;
 const req={auth:{tenantId:tenant,userId:user}},controller=new AccountOnboardingController(pool);
 await controller.create(req,{organization_id:org,lane:'prime'});
 const initial=(await controller.list(req,{}))[0];assert.ok(initial.revision);
 const results=await Promise.allSettled([controller.update(req,initial.id,{expected_revision:initial.revision,onboarding_stage:'initial_outreach',next_action:'Call prime'}),controller.update(req,initial.id,{expected_revision:initial.revision,onboarding_stage:'approved',next_action:'Conflicting edit'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const denial=results.find(r=>r.status==='rejected').reason;assert.equal(denial.getStatus(),409);
 const current=await controller.findOne(req,initial.id);assert.notEqual(current.revision,initial.revision);
 await assert.rejects(controller.findOne({auth:{tenantId:randomUUID(),userId:user}},initial.id),/not found/);
 const counts=(await pool.query('SELECT (SELECT count(*) FROM invoices WHERE tenant_id=$1)::int AS invoices,(SELECT count(*) FROM contractor_payables WHERE tenant_id=$1)::int AS payables,(SELECT count(*) FROM work_orders WHERE tenant_id=$1)::int AS work,(SELECT count(*) FROM audit_logs WHERE tenant_id=$1 AND action=\'account_onboarding.update\')::int AS edits',[tenant])).rows[0];
 assert.deepEqual(counts,{invoices:0,payables:0,work:0,edits:1});
 }finally{await pool.end();}
});


test('onboarding rejects foreign account contacts, deleted owners and malformed paging',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic account integrity',$1) RETURNING id",['account-'+randomUUID()])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic owner') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const orgs=(await pool.query("INSERT INTO organizations(tenant_id,name,type,status) VALUES($1,'Account A','customer','active'),($1,'Account B','customer','active') RETURNING id",[tenant])).rows;
 const contact=(await pool.query("INSERT INTO contacts(tenant_id,organization_id,full_name,status) VALUES($1,$2,'Other account contact','discovered') RETURNING id",[tenant,orgs[1].id])).rows[0].id;
 const req={auth:{tenantId:tenant,userId:user}},controller=new AccountOnboardingController(pool);
 await assert.rejects(controller.create(req,{organization_id:orgs[0].id,primary_contact_id:contact}),/Primary contact must belong/);
 await pool.query("INSERT INTO tenant_users(tenant_id,user_id,status,deleted_at) VALUES($1,$2,'active',now())",[tenant,user]);
 await assert.rejects(controller.create(req,{organization_id:orgs[0].id,account_owner_user_id:user}),/owner not found/);
 for(const query of [{limit:'NaN'},{offset:'Infinity'},{offset:'-1'},{limit:'1.5'},{limit:'201'}])await assert.rejects(controller.list(req,query),/must be an integer/);
 assert.equal((await controller.list(req,{})).length,0);
 }finally{await pool.end();}
});
