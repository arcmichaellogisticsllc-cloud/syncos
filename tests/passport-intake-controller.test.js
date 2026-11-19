require('reflect-metadata');
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {PassportIntakeController}=require('../apps/api/dist/routes/passport-intake.controller');
test('Passport preparation routes require server-side administrative or finance permissions',()=>{
 for(const [method,permission] of [['read','partner_payment.confirm'],['connection','admin.manage_users'],['mapping','partner_payment.confirm'],['review','partner_payment.confirm']])assert.equal(Reflect.getMetadata('requiredPermission',PassportIntakeController.prototype[method]),permission);
});
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('Passport preparation is tenant isolated, retry safe, audited and cannot enable provider access',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const t=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic intake controller',$1) RETURNING id",['intake-'+randomUUID()])).rows[0].id;
 const t2=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic foreign intake',$1) RETURNING id",['intake-'+randomUUID()])).rows[0].id;
 const u=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic intake reviewer') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const c=new PassportIntakeController(pool),req={auth:{tenantId:t,userId:u}},other={auth:{tenantId:t2,userId:u}},input={customer_reference:randomUUID(),account_reference:'sandbox-account'};
 const first=await c.connection(req,input);assert.equal(first.enabled,false);assert.equal((await c.connection(req,input)).id,first.id);
 assert.equal((await pool.query('SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2',[t,first.id])).rows[0].n,1);
 await assert.rejects(c.connection(other,input),/unavailable/);
 assert.equal((await c.read(other)).connections.length,0);
 const exception=(await pool.query("INSERT INTO passport_reconciliation_exceptions(tenant_id,connection_id,transaction_reference,fingerprint,reason) VALUES($1,$2,'test','test','unmatched_payment') RETURNING id",[t,first.id])).rows[0];
 await assert.rejects(c.review(other,exception.id,{review_note:'Foreign review'}),/not found/);
 const reviewed=await c.review(req,exception.id,{review_note:'Awaiting verified provider mapping'});assert.equal(reviewed.status,'reviewed');
 assert.equal((await c.review(req,exception.id,{review_note:'Awaiting verified provider mapping'})).id,exception.id);
 assert.equal((await pool.query('SELECT count(*)::int n FROM external_partner_payments WHERE tenant_id=$1',[t])).rows[0].n,0);
 }finally{await pool.end();}
});
