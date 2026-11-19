require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { WorkSafetyController } = require('../apps/api/dist/routes/work-safety.controller');
const { safetyBlockers } = require('../apps/api/dist/routes/work-safety');
const url = process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;

test('shutdown stays blocked until an authorized supervisor releases it after all clearances', { skip: !url }, async () => {
  const db = new Pool({ connectionString: url });
  try {
    const tenant = (await db.query("INSERT INTO tenants(name,slug) VALUES('Synthetic restart test',$1) RETURNING id", ['restart-'+randomUUID()])).rows[0].id;
    const project = (await db.query("INSERT INTO projects(tenant_id,name) VALUES($1,'Synthetic project') RETURNING id", [tenant])).rows[0].id;
    const wo = (await db.query("INSERT INTO work_orders(tenant_id,project_id,title,work_type,expected_units,unit_type) VALUES($1,$2,'Synthetic shutdown','aerial',1,'unit') RETURNING id", [tenant,project])).rows[0].id;
    async function actor(key) {
      const user = (await db.query("INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id", [randomUUID()+'@synthetic.test',key])).rows[0].id;
      const tu = (await db.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id', [tenant,user])).rows[0].id;
      const role = (await db.query('INSERT INTO roles(tenant_id,name,system_key) VALUES($1,$2,$2) RETURNING id', [tenant,key])).rows[0].id;
      await db.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,'tenant',$1)", [tenant,tu,role]);
      return {auth:{tenantId:tenant,userId:user}};
    }
    const safety = await actor('safety_manager'), ops = await actor('operations_manager'), supervisor = await actor('field_supervisor'), admin = await actor('system_admin');
    const controller = new WorkSafetyController(db);
    const { ProductionController } = require('../apps/api/dist/routes/production.controller');
    const production = new ProductionController(db);
    const executive=await actor('executive'), qc=await actor('qc_manager'), foreman=await actor('foreman'), impostor=await actor('custom_supervisor');
    await db.query("UPDATE roles SET name='Field Supervisor' WHERE tenant_id=$1 AND system_key='custom_supervisor'",[tenant]);
    for (const req of [safety,ops,admin,executive,qc,foreman,impostor]) {
      await assert.rejects(controller.stop(req,{work_order_id:wo,reason:'Unauthorized'}), /supervisor authority/);
      await assert.rejects(production.issueStopWork(req,randomUUID(),{reason:'Unauthorized',utility_strike:false}), /supervisor authority/);
    }
    // A supervisor must still belong to the current active tenant and exact scope.
    await assert.rejects(controller.stop({auth:{...supervisor.auth,tenantId:randomUUID()}},{work_order_id:wo,reason:'Wrong tenant'}), /supervisor authority/);
    await db.query("UPDATE tenant_users SET status='disabled' WHERE tenant_id=$1 AND user_id=$2",[tenant,supervisor.auth.userId]);
    await assert.rejects(controller.stop(supervisor,{work_order_id:wo,reason:'Inactive'}), /supervisor authority/);
    await db.query("UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2",[tenant,supervisor.auth.userId]);
    await db.query("UPDATE user_roles SET scope_id=$2 WHERE tenant_id=$1 AND role_id IN (SELECT id FROM roles WHERE tenant_id=$1 AND system_key='field_supervisor')",[tenant,randomUUID()]);
    await assert.rejects(controller.stop(supervisor,{work_order_id:wo,reason:'Wrong scope'}), /supervisor authority/);
    await db.query("UPDATE user_roles SET scope_id=$1 WHERE tenant_id=$1 AND role_id IN (SELECT id FROM roles WHERE tenant_id=$1 AND system_key='field_supervisor')",[tenant]);
    // Both routes admit supervisors; the legacy route now reaches record validation.
    await assert.rejects(production.issueStopWork(supervisor,randomUUID(),{reason:'Missing record',utility_strike:false}), /production record not found/);
    assert.equal((await db.query('SELECT count(*)::int n FROM work_safety_controls WHERE tenant_id=$1',[tenant])).rows[0].n,0);
    const stop = await controller.stop(supervisor, {work_order_id:wo,reason:'Synthetic hazard',utility_strike:true});
    assert.deepEqual(stop.required_approvals,['utility_owner','safety','operations','supervisor_release']);
    const body = kind => ({approval_kind:kind,approver_name:'Synthetic approver',approved_at:new Date().toISOString(),evidence_reference:'Synthetic reviewed evidence',verified:true});
    await assert.rejects(controller.approve(supervisor,stop.id,body('supervisor_release')), /preceding approvals/);
    for (const req of [safety,ops,admin]) await assert.rejects(controller.approve(req,stop.id,body('supervisor_release')), /authority/);
    await assert.rejects(controller.approve({auth:{...supervisor.auth,tenantId:randomUUID()}},stop.id,body('supervisor_release')), /not found/);
    await controller.approve(safety,stop.id,body('utility_owner'));
    await controller.approve(safety,stop.id,body('safety'));
    assert.equal((await controller.approve(ops,stop.id,body('operations'))).status,'active');
    const client = await db.connect();
    try { assert.ok((await safetyBlockers(client,tenant,wo,null,null,false)).includes('applicable_safety_stop_active')); }
    finally { client.release(); }
    await assert.rejects(db.query("UPDATE work_safety_controls SET status='released' WHERE id=$1",[stop.id]), /supervisor release/);
    const release = body('supervisor_release');
    // Two simultaneous submissions serialize, preserving one approval and audit event.
    const outcomes = await Promise.all([controller.approve(supervisor,stop.id,release),controller.approve(supervisor,stop.id,release)]);
    assert.ok(outcomes.every(x=>x.status==='released'));
    assert.equal((await db.query("SELECT count(*)::int n FROM work_safety_approvals WHERE control_id=$1 AND approval_kind='supervisor_release'",[stop.id])).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND actor_user_id=$3 AND action='work_safety.approval_recorded'",[tenant,stop.id,supervisor.auth.userId])).rows[0].n,1);
    await assert.rejects(controller.approve(supervisor,stop.id,{...release,evidence_reference:'changed evidence'}), /different details/);
    // An older importer cannot omit the final step; classification must retain it.
    const legacy = (await db.query("INSERT INTO work_safety_controls(tenant_id,work_order_id,control_type,reason,status,required_approvals,created_by,classification_review_required) VALUES($1,$2,'stop','Synthetic imported hold','active',ARRAY['safety','operations'],$3,true) RETURNING *",[tenant,wo,safety.auth.userId])).rows[0];
    assert.deepEqual(legacy.required_approvals,['safety','operations','supervisor_release']);
    assert.deepEqual((await controller.classifyStop(safety,legacy.id,{utility_strike:false,evidence_reference:'Synthetic classification'})).required_approvals,['safety','operations','supervisor_release']);
  } finally { await db.end(); }
});

test('migration adds supervisor release to open holds without rewriting completed history', { skip: !url }, async () => {
  const { readFileSync } = require('node:fs');
  const pool = new Pool({connectionString:url}), db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('DROP TRIGGER work_safety_supervisor_restart ON work_safety_controls');
    await db.query('DROP FUNCTION require_supervisor_restart_release()');
    const tenant=(await db.query("INSERT INTO tenants(name,slug) VALUES('Synthetic migration',$1) RETURNING id",['migration-'+randomUUID()])).rows[0].id;
    const user=(await db.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic user') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
    const project=(await db.query("INSERT INTO projects(tenant_id,name) VALUES($1,'Synthetic migration') RETURNING id",[tenant])).rows[0].id;
    const wo=(await db.query("INSERT INTO work_orders(tenant_id,project_id,title,work_type,expected_units,unit_type) VALUES($1,$2,'Synthetic migration','aerial',1,'unit') RETURNING id",[tenant,project])).rows[0].id;
    for(const status of ['active','released']) await db.query("INSERT INTO work_safety_controls(tenant_id,work_order_id,control_type,reason,status,required_approvals,created_by) VALUES($1,$2,'stop','Historical fixture',$3,ARRAY['safety','operations'],$4)",[tenant,wo,status,user]);
    await db.query(readFileSync('packages/database/migrations/115_supervisor_restart_release.sql','utf8'));
    const rows=(await db.query('SELECT status,required_approvals FROM work_safety_controls WHERE tenant_id=$1',[tenant])).rows;
    assert.deepEqual(rows.find(x=>x.status==='active').required_approvals,['safety','operations','supervisor_release']);
    assert.deepEqual(rows.find(x=>x.status==='released').required_approvals,['safety','operations']);
  } finally {await db.query('ROLLBACK');db.release();await pool.end();}
});


test('legacy production release cannot bypass or overwrite supervisor authorization', async () => {
  const { ProductionController } = require('../apps/api/dist/routes/production.controller');
  const controller = new ProductionController({connect(){throw Error('Legacy action must not write');}});
  await assert.rejects(controller.releaseStopWork({auth:{tenantId:randomUUID(),userId:randomUUID()}},randomUUID(),{release_reason:'Attempted replacement'}), /legacy action cannot release or rewrite/);
});

test('production-record hold uses supervisor identity and preserves scope and prior hold history', {skip:!url}, async()=>{
  const db=new Pool({connectionString:url});
  try {
    const {staffingFixture}=require('./helpers/staffing-fixture');
    const {ProductionController}=require('../apps/api/dist/routes/production.controller');
    const f=await staffingFixture(db,'partner'), controller=new ProductionController(db);
    const record=(await db.query("INSERT INTO production_records(tenant_id,project_id,work_order_id,capacity_provider_id,crew_id,production_date,quantity_submitted,quantity,unit_type,unit) VALUES($1,$2,$3,$4,$5,CURRENT_DATE,1,1,'feet','feet') RETURNING id",[f.t,f.project,f.wo,f.cp,f.crew])).rows[0].id;
    await assert.rejects(controller.issueStopWork(f.admin,record,{reason:'Admin bypass',utility_strike:false}),/supervisor authority/);
    for (const method of ['placeProjectOnHold','releaseProjectHold','placeWorkOrderOnHold','releaseWorkOrderHold']) {
      await assert.rejects(controller[method](f.admin,method.includes('Project')?f.project:f.wo,{hold_reason:'Unauthorized',release_note:'Unauthorized'}),/supervisor authority/);
    }
    await controller.placeProjectOnHold(f.supervisor,f.project,{hold_reason:'Synthetic project hold'});
    await controller.releaseProjectHold(f.supervisor,f.project,{release_note:'Synthetic supervisor review'});
    await controller.placeWorkOrderOnHold(f.supervisor,f.wo,{hold_reason:'Synthetic work hold'});
    await assert.rejects(controller.cancelWorkOrder(f.admin,f.wo,{cancellation_reason:'Attempted hold bypass'}),/supervisor hold-release/);
    assert.equal((await db.query('SELECT status FROM work_orders WHERE id=$1',[f.wo])).rows[0].status,'on_hold');
    await controller.releaseWorkOrderHold(f.supervisor,f.wo,{release_note:'Synthetic supervisor review'});
    const after=await controller.issueStopWork(f.supervisor,record,{reason:'Synthetic formal hold',utility_strike:false});
    assert.equal(after.stop_work_status,'active');assert.equal(after.stop_work_by,f.supervisor.auth.userId);
    const hold=(await db.query('SELECT * FROM work_safety_controls WHERE source_production_record_id=$1',[record])).rows[0];
    assert.equal(hold.crew_id,f.crew);assert.equal(hold.created_by,f.supervisor.auth.userId);
    assert.deepEqual(hold.required_approvals,['safety','operations','supervisor_release']);
    await assert.rejects(controller.issueStopWork(f.foreman,record,{reason:'Overwrite',utility_strike:true}),/supervisor authority/);
    assert.equal((await db.query('SELECT reason FROM work_safety_controls WHERE id=$1',[hold.id])).rows[0].reason,'Synthetic formal hold');
    assert.equal((await db.query('SELECT count(*)::int n FROM work_safety_controls WHERE source_production_record_id=$1',[record])).rows[0].n,1);
    const canonical=new WorkSafetyController(db);
    await assert.rejects(canonical.stop(f.supervisor,{work_order_id:f.wo,crew_id:randomUUID(),reason:'Unassigned crew'}),/not assigned/);
    await assert.rejects(canonical.stop(f.supervisor,{work_order_id:randomUUID(),reason:'Foreign work'}),/not found/);
  } finally {await db.end();}
});
