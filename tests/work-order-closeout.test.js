require('reflect-metadata');
const test=require('node:test'),assert=require('node:assert/strict');
const {Pool}=require('pg');
const {staffingFixture}=require('./helpers/staffing-fixture');
const {ProductionController}=require('../apps/api/dist/routes/production.controller');
const {requireWorkOrderCloseout}=require('../apps/api/dist/routes/work-order-closeout');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('closeout denies empty, held, incomplete and unaccepted work without changing its approved state',{skip:!url},async()=>{
 const db=new Pool({connectionString:url});
 try{
  const f=await staffingFixture(db,'partner'),controller=new ProductionController(db);
  await db.query("UPDATE work_orders SET status='approved' WHERE tenant_id=$1 AND id=$2",[f.t,f.wo]);
  const {workOrderProductionBlocker}=require('../apps/api/dist/routes/work-order-operational-state');
  assert.equal(await workOrderProductionBlocker(db,f.t,f.wo),null);
  await db.query("UPDATE work_orders SET status='closed' WHERE tenant_id=$1 AND id=$2",[f.t,f.wo]);
  assert.equal(await workOrderProductionBlocker(db,f.t,f.wo),'work_order_or_project_not_open_for_production');
  await db.query("UPDATE work_orders SET status='approved' WHERE tenant_id=$1 AND id=$2",[f.t,f.wo]);
  const close=()=>controller.closeWorkOrder(f.admin,f.wo,{closeout_notes:'Synthetic closeout'});
  await assert.rejects(close,/Customer-accepted production/);
  const record=(await db.query("INSERT INTO production_records(tenant_id,project_id,work_order_id,capacity_provider_id,crew_id,production_date,quantity_submitted,quantity,unit_type,unit,stop_work_status) VALUES($1,$2,$3,$4,$5,CURRENT_DATE,1,1,'feet','feet','active') RETURNING id",[f.t,f.project,f.wo,f.cp,f.crew])).rows[0].id;
  await assert.rejects(close,/Release active safety holds/);
  await db.query("UPDATE production_records SET stop_work_status='released' WHERE tenant_id=$1 AND id=$2",[f.t,record]);
  await assert.rejects(close,/Current customer acceptance/);
  const report=(await db.query("INSERT INTO daily_production_reports(tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,daily_jsa_id,work_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_DATE,'draft') RETURNING id",[f.t,f.project,f.wo,f.v,f.org,f.cp,f.crew,f.workers[0],f.foreman.auth.userId,f.jsa.id])).rows[0].id;
  await assert.rejects(close,/Submit and review all daily reports/);
  const c=await db.connect();try{await assert.rejects(requireWorkOrderCloseout(c,f.t,require('node:crypto').randomUUID()),/Customer-accepted production/);}finally{c.release();}
  assert.equal((await db.query('SELECT status FROM work_orders WHERE tenant_id=$1 AND id=$2',[f.t,f.wo])).rows[0].status,'approved');
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='work_order.close'",[f.t])).rows[0].n,0);
 }finally{await db.end();}
});

test('accepted submitted records cannot imply complete contract scope from an estimated quantity',()=>{
 const {SyncfieldController}=require('../apps/api/dist/routes/syncfield.controller');
 const controller=new SyncfieldController({},{});
 for(const decision of ['accepted','partially_accepted']){
  const result=controller.closeoutSummary([{daily_report_id:'synthetic',customer_decision:decision,planned_quantity:3000,reported_quantity:10,customer_accepted_quantity:5}],[]);
  assert.equal(result.status,'all_submitted_production_resolved');
  assert.equal(result.scope_completion_verified,false);
 }
 assert.equal(controller.closeoutSummary([{daily_report_id:'synthetic',customer_decision:null}],[]).status,'awaiting_customer_qc');
});
