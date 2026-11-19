const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {CustomerInquiriesController}=require('../apps/api/dist/routes/customer-inquiries.controller');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('inquiries preserve request history, attachments and tenant-scoped follow-up',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic inquiries',$1) RETURNING id",['inquiries-'+tag])).rows[0].id;
 const other=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Other inquiries',$1) RETURNING id",['inquiries-other-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic inquiry owner') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const member=(await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,user])).rows[0].id;
 const role=(await pool.query("INSERT INTO roles(tenant_id,name,system_key) VALUES($1,'Synthetic intake owner','synthetic_intake') RETURNING id",[tenant])).rows[0].id;
 await pool.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,member,role]);
 await pool.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key='customer_inquiry.manage'",[tenant,role]);
 const req={auth:{tenantId:tenant,userId:user}},foreign={auth:{tenantId:other,userId:user}},c=new CustomerInquiriesController(pool);
 const body={request_key:randomUUID(),customer_name:'Synthetic prime',email:'prime@synthetic.test',subject:'Service request',details:'Synthetic service area',source_reference:'Customer email permission',authorized:true};
 const [a,b]=await Promise.all([c.create(req,body),c.create(req,body)]);assert.equal(a.id,b.id);
 await assert.rejects(c.create(req,{...body,details:'Changed'}),/different/);
 await assert.rejects(c.create(req,{...body,authorized:false}),/authorized/);
 const review={revision:1,status:'assigned',owner_user_id:user,follow_up_note:'Owner accepted follow-up'};
 await assert.rejects(c.review(foreign,a.id,review),/unavailable/);
 const unapproved=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic unapproved handler') RETURNING id",['unapproved-'+tag+'@synthetic.test'])).rows[0].id;
 await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2)',[tenant,unapproved]);
 await assert.rejects(c.review(req,a.id,{...review,owner_user_id:unapproved}),/Owner unavailable/);
 assert.ok(!(await c.list(req)).owners.some(o=>o.id===unapproved));
 const assigned=await c.review(req,a.id,review);assert.equal(assigned.revision,2);assert.equal((await c.review(req,a.id,review)).revision,2);
 await assert.rejects(c.review(req,a.id,{...review,status:'closed'}),/changed/);
 await assert.rejects(c.review(req,a.id,{...review,revision:2,status:'qualified'}),/Link/);
 const project=(await pool.query("INSERT INTO projects(tenant_id,name) VALUES($1,'Synthetic reviewed project') RETURNING id",[tenant])).rows[0].id;
 const qualified=await c.review(req,a.id,{...review,revision:2,status:'qualified',project_id:project});assert.equal(qualified.status,'qualified');
 const file={file_name:'source.pdf',content_base64:Buffer.from('%PDF-1.4\nSynthetic only\n%%EOF').toString('base64')};
 const [one,two]=await Promise.all([c.upload(req,a.id,file),c.upload(req,a.id,file)]);assert.equal(one.id,two.id);
 assert.equal((await c.files(req,a.id)).length,1);assert.equal((await c.files(foreign,a.id)).length,0);
 await assert.rejects(c.upload(req,a.id,{...file,content_base64:Buffer.from('<script>bad</script>').toString('base64')}),/unsupported/);
 let downloaded;await c.download(req,one.id,{setHeader:()=>{},send:bytes=>{downloaded=bytes;}});assert.equal(downloaded.toString(),'%PDF-1.4\nSynthetic only\n%%EOF');
 await assert.rejects(c.download(foreign,one.id,{setHeader:()=>{},send:()=>{}}),/unavailable/);
 await c.create(req,{...body,request_key:randomUUID()});const queue=await c.list(req);assert.equal(queue.inquiries[0].possible_duplicates,1);assert.equal((await c.list(foreign)).inquiries.length,0);
 }finally{await pool.end();}
});
