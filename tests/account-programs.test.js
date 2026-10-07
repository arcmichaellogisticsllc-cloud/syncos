const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {AccountProgramsController}=require('../apps/api/dist/routes/account-programs.controller');
const {AccountOnboardingController}=require('../apps/api/dist/routes/account-onboarding.controller');
const database=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('program policies preserve originals, enforce current evidence, isolate accounts and retain history',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic policy',$1) RETURNING id",['policy-'+randomUUID()])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic reviewer') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const org=(await pool.query("INSERT INTO organizations(tenant_id,name,type,status) VALUES($1,'Synthetic prime','customer','active') RETURNING id",[tenant])).rows[0].id;
 const req={auth:{tenantId:tenant,userId:user}},onboarding=new AccountOnboardingController(pool),controller=new AccountProgramsController(pool);
 await onboarding.create(req,{organization_id:org});const profile=(await onboarding.list(req,{}))[0];
 await controller.create(req,profile.id,{name:'Fiber build'});await controller.create(req,profile.id,{name:'Fiber build'});const programs=await controller.list(req,profile.id);assert.equal(programs.length,1);const id=programs[0].id;
 await assert.rejects(onboarding.update(req,profile.id,{onboarding_stage:'approved'}),/document requirements/);
 await assert.rejects(controller.detail({auth:{tenantId:randomUUID(),userId:user}},id),/not found/);
 const content=Buffer.from('%PDF-1.4\nSynthetic governing policy\n%%EOF').toString('base64');await controller.upload(req,id,{file_name:'policy.pdf',content_base64:content});await controller.upload(req,id,{file_name:'retry.pdf',content_base64:content});let detail=await controller.detail(req,id);assert.equal(detail.originals.length,1);assert.equal(detail.ready,false);const original=detail.originals[0].id;
 await assert.rejects(controller.upload(req,id,{file_name:'script.html',content_base64:Buffer.from('<script>x</script>').toString('base64')}),/Supported originals/);
 const policy={source_original_id:original,effective_from:'2020-01-01',requirements:[{key:'insurance',label:'Insurance'}],reason:'Verified source requirements',confirmed:true,expected_revision:0};
 await controller.policy(req,id,policy);await assert.rejects(controller.policy(req,id,policy),/Policy changed/);detail=await controller.detail(req,id);assert.equal(detail.requirements[0].state,'missing');
 const review={policy_id:detail.active_policy_id,requirement_key:'insurance',original_id:original,decision:'approved',confirmed:true,reason:'Readable and meets requirement'};
 await controller.review(req,id,{...review,expires_on:'2020-01-01'});detail=await controller.detail(req,id);assert.equal(detail.requirements[0].state,'expired');assert.equal(detail.ready,false);
 await assert.rejects(controller.review(req,id,review),/Review changed/);
 await controller.review(req,id,{...review,expected_review_id:detail.requirements[0].review.id,expires_on:'2099-01-01'});detail=await controller.detail(req,id);assert.equal(detail.ready,true);const board=(await onboarding.findOne(req,profile.id));assert.equal(board.program_count,1);assert.equal(board.program_required_count,1);assert.equal(board.program_unresolved_count,0);assert.equal(board.program_policy_gap_count,0);
 await onboarding.update(req,profile.id,{onboarding_stage:'approved'});
 await controller.policy(req,id,{...policy,expected_revision:1,reason:'Revised requirements'});detail=await controller.detail(req,id);assert.equal(detail.ready,false);assert.equal(detail.reviews.length,2);assert.equal(detail.policies.length,2);assert.equal((await onboarding.findOne(req,profile.id)).program_unresolved_count,1);
 await assert.rejects(onboarding.update(req,profile.id,{onboarding_stage:'mobilized'}),/document requirements/);
 await assert.rejects(pool.query('DELETE FROM account_program_originals WHERE id=$1',[original]));
 await assert.rejects(pool.query('UPDATE account_program_policies SET reason=$2 WHERE id=$1',[detail.active_policy_id,'rewrite']));
 const originalBytes=(await pool.query('SELECT content FROM account_program_originals WHERE id=$1',[original])).rows[0].content;assert.equal(originalBytes.toString('base64'),content);
 assert.equal(Number((await pool.query('SELECT count(*) FROM invoices WHERE tenant_id=$1',[tenant])).rows[0].count),0);
 }finally{await pool.end();}
});

test('program HTTP endpoints require tenant-wide grants and accept bounded real originals',{skip:!database||!process.env.SYNCOS_PRODUCT_TEST_API_URL||!process.env.AUTH_JWT_SECRET},async()=>{
 const pool=new Pool({connectionString:database}),base=process.env.SYNCOS_PRODUCT_TEST_API_URL;try{
 const {createAuthToken}=require('@syncos/auth');const tag=randomUUID();const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic policy HTTP',$1) RETURNING id",['policy-http-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic reviewer') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const membership=(await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,user])).rows[0].id;
 const role=(await pool.query("INSERT INTO roles(tenant_id,name,system_key) VALUES($1,'Synthetic policy reviewer','synthetic_policy') RETURNING id",[tenant])).rows[0].id;
 await pool.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,membership,role]);
 const org=(await pool.query("INSERT INTO organizations(tenant_id,name,type,status) VALUES($1,'Synthetic prime','customer','active') RETURNING id",[tenant])).rows[0].id;
 const profile=(await pool.query('INSERT INTO account_onboarding_profiles(tenant_id,organization_id) VALUES($1,$2) RETURNING id',[tenant,org])).rows[0].id;
 const headers={authorization:'Bearer '+createAuthToken({sub:user,tenant_id:tenant,auth_version:0},process.env.AUTH_JWT_SECRET),'content-type':'application/json'},path=`${base}/account-programs/profiles/${profile}`;
 assert.equal((await fetch(path)).status,401);assert.equal((await fetch(path,{headers})).status,403);
 await pool.query("INSERT INTO permissions(key,name) VALUES('account_onboarding.read','account_onboarding.read'),('account_onboarding.update','account_onboarding.update') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key='account_onboarding.read'",[tenant,role]);
 assert.equal((await fetch(path,{headers})).status,200);assert.equal((await fetch(path,{headers,method:'POST',body:JSON.stringify({name:'Policy test'})})).status,403);
 await pool.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key='account_onboarding.update'",[tenant,role]);
 const created=await fetch(path,{headers,method:'POST',body:JSON.stringify({name:'Policy test'})});assert.equal(created.status,201);const program=(await created.json()).id;
 const bytes=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(150000,32),Buffer.from('\n%%EOF')]);const response=await fetch(`${base}/account-programs/${program}/originals`,{headers,method:'POST',body:JSON.stringify({file_name:'synthetic.pdf',content_base64:bytes.toString('base64')})});assert.equal(response.status,201,await response.clone().text());const file=await response.json();
 const download=await fetch(`${base}/account-programs/${program}/originals/${file.id}`,{headers});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.equal(download.headers.get('cache-control'),'no-store');
 await pool.query("UPDATE user_roles SET scope_type='organization',scope_id=$1 WHERE tenant_id=$2 AND role_id=$3",[org,tenant,role]);
 assert.equal((await fetch(path,{headers:{...headers,'x-scope-type':'organization','x-scope-id':org}})).status,403);
 assert.equal((await fetch(`${base}/account-programs/${program}/originals/${file.id}`,{headers})).status,403);
 }finally{await pool.end();}
});
