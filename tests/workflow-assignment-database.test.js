const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {WorkflowsController}=require('../apps/api/dist/routes/workflows.controller');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('role reassignment clears old person; unknown roles and closed-task escalation preserve state',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic workflow review',$1) RETURNING id",[randomUUID()])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic owner') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 await pool.query("INSERT INTO roles(tenant_id,name) VALUES($1,'QC Manager')",[tenant]);
 const definition=(await pool.query("INSERT INTO workflow_definitions(tenant_id,name) VALUES($1,'Synthetic correction') RETURNING id",[tenant])).rows[0].id;
 const instance=(await pool.query("INSERT INTO workflow_instances(tenant_id,workflow_definition_id,owner_user_id) VALUES($1,$2,$3) RETURNING id",[tenant,definition,user])).rows[0].id;
 const task=(await pool.query("INSERT INTO workflow_tasks(tenant_id,workflow_instance_id,title,assigned_to,assigned_user_id) VALUES($1,$2,'Synthetic follow-up',$3,$3) RETURNING id",[tenant,instance,user])).rows[0].id;
 const step=(await pool.query("INSERT INTO workflow_steps(tenant_id,workflow_definition_id,step_key,step_type,step_order,sort_order,step_name,owner_role,sla_hours) VALUES($1,$2,'review','task',1,1,'Review','QC Manager',24) RETURNING id",[tenant,definition])).rows[0].id;
 await pool.query('UPDATE workflow_tasks SET step_id=$2 WHERE id=$1',[task,step]);
 const controller=new WorkflowsController(pool),req={auth:{tenantId:tenant,userId:user}};
 await controller.reassignTask(req,task,{assigned_role:'QC Manager',reason:'Escalate ownership to reviewed team'});
 const row=(await pool.query('SELECT assigned_to,assigned_user_id,assigned_role FROM workflow_tasks WHERE id=$1',[task])).rows[0];
 assert.deepEqual(row,{assigned_to:null,assigned_user_id:null,assigned_role:'QC Manager'});
 await assert.rejects(controller.reassignTask(req,task,{assigned_role:'Unknown',reason:'Invalid'}),/existing role/);
 await controller.escalateTask(req,task,{escalated_to_role:'QC Manager',reason:'Needs review'});
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM workflow_escalations WHERE workflow_task_id=$1',[task])).rows[0].n,1);
 const reviewer=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic reviewer') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const membership=(await pool.query("INSERT INTO tenant_users(tenant_id,user_id,status) VALUES($1,$2,'active') RETURNING id",[tenant,reviewer])).rows[0].id;
 const role=(await pool.query("SELECT id FROM roles WHERE tenant_id=$1 AND name='QC Manager'",[tenant])).rows[0].id;
 await pool.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,membership,role]);
 await assert.rejects(controller.completeTask({auth:{tenantId:tenant,userId:randomUUID()}},task,{}),/authority/);
 await assert.rejects(controller.updateTask(req,task,{assigned_to:reviewer}),/reassignment action/);
 await controller.completeTask({auth:{tenantId:tenant,userId:reviewer}},task,{completion_note:'Reviewed role work'});
 await assert.rejects(controller.escalateTask(req,task,{escalated_to_role:'QC Manager',reason:'Must not reopen'}),/Closed tasks/);
 await assert.rejects(controller.reassignTask(req,task,{assigned_role:'QC Manager',reason:'Must not reopen'}),/Closed tasks/);
 assert.equal((await pool.query('SELECT status FROM workflow_tasks WHERE id=$1',[task])).rows[0].status,'completed');
 }finally{await pool.end();}
});
