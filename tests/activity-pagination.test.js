const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {activityPage}=require('../apps/api/dist/routes/activity-pagination');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('legacy activity pages preserve microseconds, related scope, literal searches and concurrent additions',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url}),c=await pool.connect();try{
  await c.query('BEGIN');await c.query('CREATE TEMP TABLE activity_paging_test(id uuid PRIMARY KEY,entity_id uuid,created_at timestamptz,action text)');const parent=randomUUID(),other=randomUUID();
  await c.query("INSERT INTO activity_paging_test SELECT gen_random_uuid(),$1,'2026-01-01'::timestamptz+(n%3)*interval '1 microsecond','Action '||n FROM generate_series(1,1005)n",[parent]);
  await c.query("INSERT INTO activity_paging_test VALUES(gen_random_uuid(),$1,now(),'Literal % action'),(gen_random_uuid(),$2,now(),'Forbidden')",[parent,other]);
  const sql='SELECT id AS __history_id,created_at::text AS __history_time,id,action,created_at FROM activity_paging_test WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 100';
  let cursor;const seen=new Set();do{const page=await activityPage(c,sql,[parent],cursor?{before:cursor}:{});for(const r of page.rows){assert.ok(!seen.has(r.id));seen.add(r.id);assert.notEqual(r.action,'Forbidden');}if(!cursor)await c.query("INSERT INTO activity_paging_test VALUES(gen_random_uuid(),$1,now(),'Added after first page')",[parent]);cursor=page.rows.length===100?page.rows.at(-1)._history_cursor:null;}while(cursor);
  assert.equal(seen.size,1006);assert.equal((await activityPage(c,sql,[parent],{history_q:'%'})).rows.length,1);
  const first=await activityPage(c,sql,[parent],{});await assert.rejects(activityPage(c,sql,[other],{before:first.rows[0]._history_cursor}),/Invalid activity/);await assert.rejects(activityPage(c,sql,[parent],{before:'invalid'}),/Invalid activity/);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
