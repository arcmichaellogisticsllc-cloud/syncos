const {randomUUID}=require('node:crypto');
async function staffingFixture(db,kind='internal',tenant){
 async function row(sql,args=[]){return (await db.query(sql,args)).rows[0];}
 const t=tenant??(await row("INSERT INTO tenants(name,slug) VALUES('Synthetic staffing',$1) RETURNING id",['staffing-'+randomUUID()])).id;
 const org=(await row("INSERT INTO organizations(tenant_id,name) VALUES($1,'Synthetic staffing organization') RETURNING id",[t])).id;
 const cp=(await row("INSERT INTO capacity_providers(tenant_id,organization_id,name,provider_type,status) VALUES($1,$2,'Synthetic provider',$3,'activated') RETURNING id",[t,org,kind==='internal'?'internal_workforce':'subcontractor'])).id;
 const crew=(await row("INSERT INTO crews(tenant_id,organization_id,capacity_provider_id,name,crew_type) VALUES($1,$2,$3,'Synthetic staffing crew','aerial') RETURNING id",[t,org,cp])).id;
 const project=(await row("INSERT INTO projects(tenant_id,name) VALUES($1,'Synthetic staffing project') RETURNING id",[t])).id;
 const wo=(await row("INSERT INTO work_orders(tenant_id,project_id,title,work_type,expected_units,unit_type) VALUES($1,$2,'Synthetic staffing work','aerial',100,'unit') RETURNING id",[t,project])).id;
 const contract=(await row("INSERT INTO contracts(tenant_id,name) VALUES($1,'Synthetic staffing contract') RETURNING id",[t])).id;
 const agreement=(await row('INSERT INTO partner_agreement_versions(tenant_id,organization_id,capacity_provider_id,contract_id,version_number) VALUES($1,$2,$3,$4,1) RETURNING id',[t,org,cp,contract])).id;
 const rates=(await row("INSERT INTO rate_schedules(tenant_id,name) VALUES($1,'Synthetic rates') RETURNING id",[t])).id;
 const v=(await row("INSERT INTO partner_work_order_versions(tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,governing_agreement_version_id,assigned_crew_id,rate_schedule_id,work_order_number,scope_summary,map_work_package_ref,production_unit,status,execution_model,safety_scope_reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Synthetic scope','Synthetic map','unit','active',$10,now()) RETURNING id",[t,org,cp,project,wo,agreement,crew,rates,'STAFF-'+randomUUID(),kind==='internal'?'internal':'partner'])).id;
 async function actor(key,scope='tenant'){
  const user=(await row("INSERT INTO users(email,display_name) VALUES($1,'Synthetic staffing actor') RETURNING id",[randomUUID()+'@synthetic.test'])).id;
  const tu=(await row('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[t,user])).id;
  let role=(await row('SELECT id FROM roles WHERE tenant_id=$1 AND system_key=$2',[t,key]))?.id;
  if(!role)role=(await row('INSERT INTO roles(tenant_id,name,system_key) VALUES($1,$2,$2) RETURNING id',[t,key])).id;
  await db.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)',[t,tu,role,scope,scope==='tenant'?t:org]);
  return {auth:{tenantId:t,userId:user},tu};
 }
 const foreman=await actor(kind==='internal'?'sync_foreman':'partner_foreman','organization'),supervisor=await actor('field_supervisor'),admin=await actor('system_admin');
 const workers=[];
 for(let i=0;i<6;i++){
  const worker=(await row("INSERT INTO workers(tenant_id,organization_id,capacity_provider_id,first_name,last_name) VALUES($1,$2,$3,'Synthetic',$4) RETURNING id",[t,org,cp,'Worker '+i])).id;workers.push(worker);
  await db.query('INSERT INTO partner_crew_memberships(tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role) VALUES($1,$2,$3,$4,$5,$6)',[t,org,cp,crew,worker,i===0?'foreman':'member']);
 }
 await db.query('INSERT INTO partner_worker_user_links(tenant_id,organization_id,worker_id,tenant_user_id) VALUES($1,$2,$3,$4)',[t,org,workers[0],foreman.tu]);
 const jsa=(await row("INSERT INTO daily_jsas(tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,work_location,status,meeting_completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE,'Synthetic site','completed',now()) RETURNING *",[t,project,wo,v,org,cp,crew,workers[0],foreman.auth.userId]));
 for(const w of workers)await db.query("INSERT INTO daily_jsa_participants(tenant_id,daily_jsa_id,worker_id,acknowledged,acknowledged_by,acknowledged_at) VALUES($1,$2,$3,true,$4,now())",[t,jsa.id,w,foreman.auth.userId]); // synthetic consent fixture, not a product write path
 return {t,org,cp,crew,project,wo,v,foreman,supervisor,admin,workers,jsa,actor};
}
module.exports={staffingFixture};
