const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {DurableIntake}=require('../packages/passport/src/durable-intake');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('four refresh consumers drain 1000 queued hints and recover interrupted leases without duplicate completion',{skip:!url,timeout:60000},async()=>{
 const pool=new Pool({connectionString:url,max:8});try{
  const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic queue load',$1) RETURNING id",['queue-load-'+tag])).rows[0].id,user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Queue reviewer') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
  const connection=(await pool.query("INSERT INTO passport_connections(tenant_id,customer_reference,account_reference,created_by) VALUES($1,$2,'ACCOUNT',$3) RETURNING id",[tenant,tag,user])).rows[0].id,repo=new DurableIntake(pool),count=1000,started=Date.now();
  for(let i=0;i<count;i+=20)await Promise.all(Array.from({length:20},(_,n)=>repo.enqueue(tenant,connection,'TX-'+(i+n))));
  const abandoned=await Promise.all(Array.from({length:4},()=>repo.claim(tenant,connection)));assert.equal(new Set(abandoned.map(j=>j.id)).size,4);
  await pool.query("UPDATE passport_refresh_jobs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND lease_token IS NOT NULL",[tenant]);
  const seen=new Set();await Promise.all(Array.from({length:4},async()=>{const worker=new DurableIntake(pool);for(;;){const job=await worker.claim(tenant,connection);if(!job)break;assert.ok(!seen.has(job.id));seen.add(job.id);await worker.complete(tenant,job.id,job.lease_token);}}));
  assert.equal(seen.size,count);for(const j of abandoned)await assert.rejects(repo.complete(tenant,j.id,j.lease_token),/lease/);
  assert.equal((await pool.query("SELECT count(*)::int n FROM passport_refresh_jobs WHERE tenant_id=$1 AND status<>'complete'",[tenant])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM external_partner_payments WHERE tenant_id=$1',[tenant])).rows[0].n,0);
  console.log(JSON.stringify({scenario:'synthetic queue interruption',jobs:count,consumers:4,abandonedLeases:4,elapsedMs:Date.now()-started,automaticPayments:0}));
 }finally{await pool.end();}
});
