const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {DurableIntake}=require('../packages/passport/src/durable-intake');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('durable Passport intake survives restart, deduplicates observations and rolls back incomplete pages without posting payments',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const t=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic Passport durability',$1) RETURNING id",['passport-'+randomUUID()])).rows[0].id;
 const u=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic reviewer') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const ref=randomUUID();const connection=(await pool.query("INSERT INTO passport_connections(tenant_id,customer_reference,account_reference,created_by) VALUES($1,$2,$3,$4) RETURNING id",[t,ref,'account',u])).rows[0].id;
 await assert.rejects(pool.query('UPDATE passport_connections SET enabled=true WHERE id=$1',[connection]),/check constraint/);
 const repo=new DurableIntake(pool);const [a,b]=await Promise.all([repo.enqueue(t,connection,'tx1'),repo.enqueue(t,connection,'tx1')]);assert.equal(a.id,b.id);
 const jobs=await Promise.all([repo.claim(t,connection),repo.claim(t,connection)]);assert.equal(jobs.filter(Boolean).length,1);const job=jobs.find(Boolean);
 await assert.rejects(repo.complete(randomUUID(),job.id,job.lease_token),/lease/);
 await pool.query("UPDATE passport_refresh_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
 const restarted=new DurableIntake(pool),reclaimed=await restarted.claim(t,connection);assert.notEqual(reclaimed.lease_token,job.lease_token);
 await assert.rejects(repo.complete(t,job.id,job.lease_token),/lease/);await repo.enqueue(t,connection,'tx1');
 // A notification transaction may have begun before the lease; wall time must not lose it.
 await pool.query("UPDATE passport_refresh_jobs SET updated_at=now()-interval '1 hour' WHERE id=$1",[job.id]);await restarted.complete(t,job.id,reclaimed.lease_token);
 assert.equal((await pool.query('SELECT status FROM passport_refresh_jobs WHERE id=$1',[job.id])).rows[0].status,'queued');
 const tx={customerId:ref,accountId:'account',transactionId:'tx1',payeeId:'payee',amount:'10.00',currency:'USD',direction:'outgoing',status:'completed',version:1,completedDate:'2026-01-01',secret:'must not persist'};
 assert.deepEqual(await repo.ingestPage(t,connection,0,[tx],'next'),{observed:1,automaticallyRecorded:0});
 await restarted.ingestPage(t,connection,1,[tx],'next2');
 assert.equal((await pool.query('SELECT count(*)::int n FROM passport_observations WHERE tenant_id=$1',[t])).rows[0].n,1);
 assert.equal((await pool.query('SELECT normalized_metadata FROM passport_observations WHERE tenant_id=$1',[t])).rows[0].normalized_metadata.secret,undefined);
 await assert.rejects(repo.ingestPage(t,connection,2,[{...tx,transactionId:'tx2'},{...tx,customerId:'foreign'}],'bad'),/scope/);
 assert.deepEqual(await restarted.checkpoint(t,connection),{cursor:'next2',version:'2'});
 assert.equal((await pool.query('SELECT count(*)::int n FROM passport_observations WHERE tenant_id=$1',[t])).rows[0].n,1);
 await repo.ingestPage(t,connection,2,[{...tx,amount:'11.00'}],null);
 assert.ok((await pool.query("SELECT id FROM passport_reconciliation_exceptions WHERE tenant_id=$1 AND reason='conflicting_same_version'",[t])).rowCount);
 assert.equal((await pool.query('SELECT count(*)::int n FROM external_partner_payments WHERE tenant_id=$1',[t])).rows[0].n,0);
 await assert.rejects(repo.checkpoint(randomUUID(),connection),/not found/);
 }finally{await pool.end();}
});
