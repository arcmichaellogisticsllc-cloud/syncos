const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {scheduleFingerprint,requireFreshSchedule,lockScheduleInputs}=require('../apps/api/dist/routes/payable-schedule-freshness');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('payment schedule freshness rejects missing calculations and changed inputs while serializing writers',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});const c=await pool.connect(),other=await pool.connect();
 try{
 const t=(await c.query("INSERT INTO tenants(name,slug) VALUES('Synthetic freshness',$1) RETURNING id",['fresh-'+randomUUID()])).rows[0].id;
 const p=(await c.query("INSERT INTO contractor_payables(tenant_id,payable_number,payable_type,payable_party_type,net_payable_amount) VALUES($1,'FRESH','subcontractor','capacity_provider',100) RETURNING id",[t])).rows[0].id;
 await c.query('BEGIN');await assert.rejects(requireFreshSchedule(c,t,p),/stale/);
 const f=await scheduleFingerprint(c,t,p);
 await c.query("INSERT INTO contractor_payable_eligibility_snapshots(tenant_id,contractor_payable_id,calculation_version,status,source_fingerprint) VALUES($1,$2,1,'eligible',$3)",[t,p,f]);
 await requireFreshSchedule(c,t,p);
 await c.query('UPDATE contractor_payable_eligibility_snapshots SET installments=$2 WHERE contractor_payable_id=$1',[p,JSON.stringify([{allocation_id:'a',amount:40,due_date:'2026-10-10',due_at:'2026-10-10T00:00:00Z'},{allocation_id:'b',amount:60,due_date:'2026-10-20',due_at:'2026-10-20T00:00:00Z'}])]);
 await c.query('UPDATE contractor_payables SET paid_amount=40 WHERE id=$1',[p]);
 assert.equal(String((await c.query('SELECT payment_due_at::text FROM contractor_payables WHERE id=$1',[p])).rows[0].payment_due_at),'2026-10-20');
 await c.query('UPDATE contractor_payables SET paid_amount=100 WHERE id=$1',[p]);
 assert.equal((await c.query('SELECT payment_due_at FROM contractor_payables WHERE id=$1',[p])).rows[0].payment_due_at,null);
 await requireFreshSchedule(c,t,p);await c.query('COMMIT');
 await c.query('BEGIN');await lockScheduleInputs(c,t);
 await other.query('BEGIN');await other.query("SET LOCAL lock_timeout='100ms'");
 await assert.rejects(other.query('UPDATE contractor_payables SET net_payable_amount=90 WHERE id=$1',[p]),/lock timeout/);await other.query('ROLLBACK');
 await c.query('COMMIT');await other.query('UPDATE contractor_payables SET net_payable_amount=90 WHERE id=$1',[p]);
 await assert.rejects(requireFreshSchedule(c,t,p),/stale/);
 }finally{await c.query('ROLLBACK');await other.query('ROLLBACK');c.release();other.release();await pool.end();}
});
