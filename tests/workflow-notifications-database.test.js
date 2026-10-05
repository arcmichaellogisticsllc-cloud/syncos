const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {WorkflowNotificationsController}=require('../apps/api/dist/routes/workflow-notifications.controller');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('workflow notices route by owner and escalation, cancel stale recipients, and audit bounded retry',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 await pool.query("INSERT INTO permissions(key,name) VALUES('workflow_task.read','Read workflow tasks'),('workflow_task.update','Update workflow tasks') ON CONFLICT(key) DO NOTHING");
 const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic workflow notices',$1) RETURNING id",['notices-'+tag])).rows[0].id;
 async function actor(label){const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id",[tag+'-'+label+'@synthetic.test',label])).rows[0].id,member=(await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,user])).rows[0].id,role=(await pool.query('INSERT INTO roles(tenant_id,name) VALUES($1,$2) RETURNING id',[tenant,label])).rows[0].id;await pool.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,member,role]);await pool.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key IN ('workflow_task.read','workflow_task.update')",[tenant,role]);return {user,member,role};}
 const owner=await actor('Owner'),manager=await actor('Manager'),unrelated=await actor('Unrelated');
 const task=(await pool.query("INSERT INTO workflow_tasks(tenant_id,title,assigned_user_id,due_at) VALUES($1,'Synthetic deadline',$2,now()-interval '1 hour') RETURNING id",[tenant,owner.user])).rows[0].id;
 class Simulated extends WorkflowNotificationsController{constructor(p){super(p);this.fail=true;this.sent=[];}async send(to,kind,id){if(this.fail)throw Error('simulated provider unavailable');this.sent.push({to,kind,id});}}
 const delivery=new Simulated(pool),req=user=>({auth:{tenantId:tenant,userId:user}});
 await delivery.tick();await delivery.tick();let rows=await delivery.list(req(owner.user));assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.kind).sort(),['assigned','overdue']);assert.equal((await delivery.list(req(unrelated.user))).length,0);
 await assert.rejects(delivery.retry(req(manager.user),rows[0].id),/Only your failed/);
 // Exhaust each message's budget without changing other synthetic tenants.
 for(let i=0;i<10;i++){await pool.query('UPDATE workflow_notifications SET next_attempt_at=now() WHERE tenant_id=$1',[tenant]);await delivery.deliverOne(tenant);}
 rows=await delivery.list(req(owner.user));assert.ok(rows.every(n=>n.status==='failed'&&n.attempts===5));
 await delivery.retry(req(owner.user),rows[0].id);delivery.fail=false;await Promise.all([delivery.deliverOne(tenant),delivery.deliverOne(tenant)]);assert.equal(delivery.sent.length,1);
 await pool.query("UPDATE workflow_tasks SET status='escalated',escalated_at=now() WHERE id=$1",[task]);await pool.query("INSERT INTO workflow_escalations(tenant_id,workflow_task_id,escalated_by,escalated_to_role,reason) VALUES($1,$2,$3,'Manager','Synthetic overdue escalation')",[tenant,task,owner.user]);await delivery.tick();const escalated=await delivery.list(req(manager.user));assert.equal(escalated.length,1);assert.equal(escalated[0].kind,'escalated');
 await pool.query("UPDATE tenant_users SET status='disabled' WHERE id=$1",[manager.member]);await delivery.deliverOne(tenant);assert.equal((await delivery.list(req(manager.user)))[0].status,'cancelled');
 await delivery.retry(req(owner.user),rows.find(n=>n.id!==rows[0].id).id);await pool.query("UPDATE workflow_tasks SET status='completed' WHERE id=$1",[task]);await delivery.deliverOne(tenant);assert.equal((await delivery.list(req(owner.user))).filter(n=>n.status==='cancelled').length,1);
 const attempts=(await pool.query('SELECT a.status,count(*)::int n FROM workflow_notification_attempts a JOIN workflow_notifications n ON n.id=a.notification_id WHERE n.tenant_id=$1 GROUP BY a.status',[tenant])).rows;assert.ok(attempts.some(a=>a.status==='retry_requested'&&a.n===2));
 }finally{await pool.end();}
});
