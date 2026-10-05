const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {PublicCustomerIntakeController,CustomerIntakeChannelsController}=require('../apps/api/dist/routes/public-customer-intake.controller');
const {InquiryNotificationsController}=require('../apps/api/dist/routes/inquiry-notifications.controller');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('public intake routes explicitly, deduplicates, throttles, and preserves durable follow-up',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic public intake',$1) RETURNING id",['intake-'+tag])).rows[0].id;
 const other=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Other intake',$1) RETURNING id",['intake-other-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Intake owner') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const member=(await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,user])).rows[0].id;
 const role=(await pool.query("INSERT INTO roles(tenant_id,name,system_key) VALUES($1,'Intake owner','synthetic_intake') RETURNING id",[tenant])).rows[0].id;
 await pool.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,member,role]);
 await pool.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key='customer_inquiry.manage'",[tenant,role]);
 const admin=new CustomerIntakeChannelsController(pool),publicApi=new PublicCustomerIntakeController(pool),req={auth:{tenantId:tenant,userId:user}},slug='request-'+tag;
 const config={slug,label:'Synthetic service requests',privacy_notice:'Synthetic privacy notice',owner_user_id:user,escalation_user_id:user,follow_up_hours:2,enabled:false};
 await admin.save(req,config);await assert.rejects(publicApi.describe(slug),/unavailable/);
 await admin.save(req,{...config,enabled:true});assert.deepEqual(await publicApi.describe(slug),{label:config.label,privacy_notice:config.privacy_notice});
 await assert.rejects(admin.save({auth:{tenantId:other,userId:user}},config),/unavailable/);
 const body={request_key:randomUUID(),customer_name:'Synthetic customer',email:tag+'-customer@synthetic.test',subject:'Underground request',details:'Synthetic work area',consent:true};
 const ip={ip:tag};const [a,b]=await Promise.all([publicApi.submit(slug,ip,body),publicApi.submit(slug,ip,body)]);assert.equal(a.reference,b.reference);
 assert.equal((await pool.query('SELECT count(*)::int n FROM public_intake_receipts WHERE channel_id=(SELECT id FROM customer_intake_channels WHERE slug=$1)',[slug])).rows[0].n,1);
 await assert.rejects(publicApi.submit(slug,ip,{...body,details:'Changed contents'}),/different/);
 await assert.rejects(publicApi.submit(slug,ip,{...body,consent:false}),/permission/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM customer_service_inquiries WHERE tenant_id=$1',[other])).rows[0].n,0);
 const inquiry=(await pool.query('SELECT * FROM customer_service_inquiries WHERE tenant_id=$1',[tenant])).rows[0];assert.equal(inquiry.created_by,null);assert.equal(inquiry.owner_user_id,user);assert.ok(inquiry.due_at);
 class SimulatedDelivery extends InquiryNotificationsController{constructor(p){super(p);this.fail=true;this.sent=0;}async send(){if(this.fail)throw Error('simulated provider unavailable');this.sent++;}}
 const delivery=new SimulatedDelivery(pool);
 for(let attempt=0;attempt<5;attempt++){await delivery.deliverOne(tenant);await pool.query('UPDATE inquiry_follow_up_notifications SET next_attempt_at=now() WHERE tenant_id=$1',[tenant]);}
 let notices=await delivery.list(req);assert.equal(notices[0].status,'failed');assert.equal(notices[0].attempts,5);
 await assert.rejects(delivery.retry({auth:{tenantId:other,userId:user}},notices[0].id),/Only failed/);
 await delivery.retry(req,notices[0].id);delivery.fail=false;await Promise.all([delivery.deliverOne(tenant),delivery.deliverOne(tenant)]);assert.equal(delivery.sent,1);assert.equal((await delivery.list(req))[0].status,'sent');
 await pool.query("UPDATE customer_service_inquiries SET due_at=now()-interval '1 minute' WHERE id=$1",[inquiry.id]);
 await delivery.tick();await delivery.tick();notices=await delivery.list(req);assert.equal(notices.filter(n=>n.kind==='overdue').length,1);
 await pool.query("UPDATE customer_service_inquiries SET due_at=now()+interval '1 day',revision=revision+1 WHERE id=$1",[inquiry.id]);
 await delivery.deliverOne(tenant);assert.equal((await delivery.list(req)).find(n=>n.kind==='overdue').status,'cancelled','A changed future deadline must cancel the stale reminder');assert.equal(delivery.sent,1);
 await pool.query("UPDATE customer_service_inquiries SET due_at=now()-interval '1 minute',revision=revision+1 WHERE id=$1",[inquiry.id]);await delivery.tick();
 await pool.query("UPDATE customer_service_inquiries SET status='closed' WHERE id=$1",[inquiry.id]);await delivery.deliverOne(tenant);assert.equal((await delivery.list(req)).find(n=>n.kind==='overdue').status,'cancelled');
 const spyEmail=tag+'-trap@synthetic.test';await publicApi.submit(slug,ip,{...body,request_key:randomUUID(),email:spyEmail,website:'bot'});assert.equal((await pool.query('SELECT count(*)::int n FROM customer_service_inquiries WHERE email=$1',[spyEmail])).rows[0].n,0);
 for(let i=0;i<2;i++)await publicApi.submit(slug,ip,body);
 await assert.rejects(publicApi.submit(slug,ip,body),e=>e.status===429);
 }finally{await pool.end();}
});
