const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {CommercialTermsController}=require('../apps/api/dist/routes/commercial-terms.controller');
const {approvedCommercialTerms,rateFromTerms}=require('../apps/api/dist/routes/commercial-terms');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('contract approval persists immutable rate snapshots, rejects stale previews and preserves historical data',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});const tag=randomUUID();
 try{
 const t=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic commercial verification',$1) RETURNING id",['commercial-'+tag])).rows[0].id;
 const u=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic commercial reviewer') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const o=(await pool.query("INSERT INTO organizations(tenant_id,name) VALUES($1,'Synthetic customer') RETURNING id",[t])).rows[0].id;
 const a=(await pool.query("INSERT INTO contracts(tenant_id,organization_id,name,status) VALUES($1,$2,'Synthetic executed contract','active') RETURNING id",[t,o])).rows[0].id;
 const s=(await pool.query("INSERT INTO rate_schedules(tenant_id,organization_id,contract_id,name,status) VALUES($1,$2,$3,'Synthetic approved prices','active') RETURNING id",[t,o,a])).rows[0].id;
 await pool.query("INSERT INTO rate_codes(tenant_id,rate_schedule_id,code,unit,amount,customer_rate,contractor_rate) VALUES($1,$2,'BORE','LF',5,5,3)",[t,s]);
 const controller=new CommercialTermsController(pool),req={auth:{tenantId:t,userId:u}};
 const preview=await controller.read(req,s);
 const input={party_type:'customer',payment_trigger:'invoice_acceptance',payment_days:14,time_zone:'America/New_York',retainage_percent:10,effective_from:'2026-01-01',effective_until:'2026-12-31',source_reference:'Synthetic executed agreement and pricing test only',verified:true,client_mutation_id:randomUUID(),preview_fingerprint:preview.preview_fingerprint};
 const first=await controller.approve(req,s,input);const again=await controller.approve(req,s,input);assert.ok(first.id);assert.equal(first.id,again.id);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commercial_terms_revisions WHERE tenant_id=$1',[t])).rows[0].n,1);
 await assert.rejects(controller.approve(req,s,{...input,payment_days:30}),/different approval/);
 await pool.query('UPDATE rate_codes SET customer_rate=9 WHERE tenant_id=$1',[t]);
 await assert.rejects(controller.approve(req,s,{...input,client_mutation_id:randomUUID()}),/changed/);
 const c=await pool.connect();try{
 const terms=await approvedCommercialTerms(c,t,s,'customer',o,'2026-09-30');assert.equal(rateFromTerms(terms,'BORE','FEET').rate,5);
 await assert.rejects(approvedCommercialTerms(c,t,s,'customer',o,'2027-01-01'),/covering the work date/);
 await assert.rejects(approvedCommercialTerms(c,t,s,'customer',randomUUID(),'2026-09-30'),/covering the work date/);
 await assert.rejects(c.query('UPDATE commercial_terms_revisions SET payment_days=30 WHERE id=$1',[terms.id]),/immutable/);
 }finally{c.release();}
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM rate_codes WHERE tenant_id=$1',[t])).rows[0].n,1);
 }finally{await pool.end();}
});
