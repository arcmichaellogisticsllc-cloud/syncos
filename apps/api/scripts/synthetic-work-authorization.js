'use strict';
// Only for disposable local release-test databases; never approve operational work.
async function authorizeSyntheticWork(client,tenant,user,order,date){
 const db=(await client.query('SELECT current_database() name')).rows[0].name;
 if(!/^syncos_synthetic_/.test(db))throw new Error('Synthetic authorization requires an explicitly synthetic database');
 const w=(await client.query(`SELECT w.*,p.customer_organization_id FROM work_orders w JOIN projects p ON p.id=w.project_id AND p.tenant_id=w.tenant_id WHERE w.tenant_id=$1 AND w.id=$2`,[tenant,order])).rows[0];
 const provider=w.assigned_capacity_provider_id,crew=w.assigned_crew_id,org=w.customer_organization_id;
 await client.query("UPDATE capacity_providers SET provider_type='internal_workforce' WHERE tenant_id=$1 AND id=$2",[tenant,provider]);
 await client.query("UPDATE crews SET target_staffing_level=1 WHERE tenant_id=$1 AND id=$2",[tenant,crew]);
 let v=(await client.query('SELECT id FROM partner_work_order_versions WHERE tenant_id=$1 AND work_order_id=$2',[tenant,order])).rows[0];
 if(!v)v=(await client.query(`INSERT INTO partner_work_order_versions(tenant_id,organization_id,capacity_provider_id,project_id,work_order_id,assigned_crew_id,work_order_number,scope_summary,map_work_package_ref,production_unit,execution_model,status,safety_scope_reviewed_at,pre_bore_required) VALUES($1,$2,$3,$4,$5,$6,$7,'SYNTHETIC authorized work','synthetic-map','feet','internal','active',now(),false) RETURNING id`,[tenant,org,provider,w.project_id,order,crew,"SYNTHETIC-"+order])).rows[0];
 await client.query(`INSERT INTO internal_field_clearances(tenant_id,work_order_version_id,status,evidence_reference,checklist,valid_until,authorized_by) VALUES($1,$2,'authorized','SYNTHETIC readiness fixture','{}','2099-12-31',$3) ON CONFLICT(tenant_id,work_order_version_id) DO NOTHING`,[tenant,v.id,user]);
 let worker=(await client.query("SELECT worker_id id FROM partner_crew_memberships WHERE tenant_id=$1 AND crew_id=$2 AND status='active'",[tenant,crew])).rows[0];
 if(!worker){worker=(await client.query("INSERT INTO workers(tenant_id,capacity_provider_id,crew_id,first_name,last_name,status) VALUES($1,$2,$3,'Synthetic','Foreman','active') RETURNING id",[tenant,provider,crew])).rows[0];await client.query("INSERT INTO partner_crew_memberships(tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role) VALUES($1,$2,$3,$4,$5,'foreman')",[tenant,org,provider,crew,worker.id]);}
 const jsa=(await client.query(`INSERT INTO daily_jsas(tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,work_location,status,meeting_completed_at,foreman_certified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SYNTHETIC work location','completed',now(),true) RETURNING id`,[tenant,w.project_id,order,v.id,org,provider,crew,worker.id,user,date])).rows[0];
 await client.query("INSERT INTO daily_jsa_participants(tenant_id,daily_jsa_id,worker_id,participation_status,acknowledged,acknowledged_by,acknowledged_at) VALUES($1,$2,$3,'present',true,$4,now())",[tenant,jsa.id,worker.id,user]);
 return {version:v.id,jsa:jsa.id};
}
module.exports={authorizeSyntheticWork};
