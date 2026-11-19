const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {createAuthToken}=require('../packages/auth/dist');
const database=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL,base=process.env.SYNCOS_SECURITY_TEST_API;
test('customer and territory grants allow only related projects and cannot reparent, spoof, or survive revocation',{skip:!database||!base,timeout:60000},async()=>{
 assert.match(new URL(database).pathname,/security_audit/);assert.match(base,/^http:\/\/127\.0\.0\.1:/);
 const p=new Pool({connectionString:database});try{
 const t=(await p.query("INSERT INTO tenants(name,slug) VALUES('Synthetic scoped access',$1) RETURNING id",['scope-'+randomUUID()])).rows[0].id;
 const orgs=[],territories=[],projects=[];
 for(let n=0;n<2;n++){orgs.push((await p.query("INSERT INTO organizations(tenant_id,name) VALUES($1,'Synthetic customer') RETURNING id",[t])).rows[0].id);territories.push((await p.query("INSERT INTO territories(tenant_id,name) VALUES($1,$2) RETURNING id",[t,'Synthetic territory '+n])).rows[0].id);projects.push((await p.query("INSERT INTO projects(tenant_id,name,customer_organization_id,territory_id) VALUES($1,'Synthetic project',$2,$3) RETURNING id",[t,orgs[n],territories[n]])).rows[0].id);}
 const foreman=(await p.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic foreman') RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id;
 const records=[];
 for(let n=0;n<2;n++){
 const cp=(await p.query("INSERT INTO capacity_providers(tenant_id,name,provider_type) VALUES($1,'Synthetic provider','subcontractor') RETURNING id",[t])).rows[0].id;
 const wo=(await p.query("INSERT INTO work_orders(tenant_id,project_id,title,work_type,expected_units,unit_type) VALUES($1,$2,'Synthetic work','construction',10,'feet') RETURNING id",[t,projects[n]])).rows[0].id;
 const pr=(await p.query("INSERT INTO production_records(tenant_id,project_id,work_order_id,capacity_provider_id,production_date,quantity_submitted,quantity,unit_type,unit) VALUES($1,$2,$3,$4,'2026-10-07',10,10,'feet','feet') RETURNING id",[t,projects[n],wo,cp])).rows[0].id;
 const qc=(await p.query('INSERT INTO qc_reviews(tenant_id,project_id,work_order_id,production_record_id) VALUES($1,$2,$3,$4) RETURNING id',[t,projects[n],wo,pr])).rows[0].id;
 const bi=(await p.query("INSERT INTO billable_items(tenant_id,project_id,work_order_id,production_record_id,customer_organization_id,approved_quantity,billable_quantity,unit) VALUES($1,$2,$3,$4,$5,10,10,'feet') RETURNING id",[t,projects[n],wo,pr,orgs[n]])).rows[0].id;
 const crew=(await p.query("INSERT INTO crews(tenant_id,name,capacity_provider_id,target_staffing_level,crew_type) VALUES($1,'Synthetic crew',$2,1,'aerial') RETURNING id",[t,cp])).rows[0].id;
 const worker=(await p.query("INSERT INTO workers(tenant_id,capacity_provider_id,first_name,last_name) VALUES($1,$2,'Synthetic','Foreman') RETURNING id",[t,cp])).rows[0].id;
 await p.query("INSERT INTO partner_crew_memberships(tenant_id,organization_id,capacity_provider_id,crew_id,worker_id,membership_role) VALUES($1,$2,$3,$4,$5,'foreman')",[t,orgs[n],cp,crew,worker]);
 const version=(await p.query("INSERT INTO partner_work_order_versions(tenant_id,work_order_id,project_id,assigned_crew_id,work_order_number,status,execution_model,safety_scope_reviewed_at,pre_bore_required,organization_id,capacity_provider_id,scope_summary,map_work_package_ref,production_unit) VALUES($1,$2,$3,$4,$5,'active','internal',now(),false,$6,$7,'Synthetic scope','Synthetic map','feet') RETURNING id",[t,wo,projects[n],crew,randomUUID(),orgs[n],cp])).rows[0].id;
 await p.query("INSERT INTO internal_field_clearances(tenant_id,work_order_version_id,status,evidence_reference,checklist,valid_until,authorized_by) VALUES($1,$2,'authorized','Synthetic scope fixture','{}',CURRENT_DATE+30,$3)",[t,version,foreman]);
 const jsa=(await p.query("INSERT INTO daily_jsas(tenant_id,project_id,work_order_id,work_order_version_id,organization_id,capacity_provider_id,crew_id,foreman_worker_id,foreman_user_id,work_date,status,work_location,meeting_completed_at,foreman_certified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-10-07','completed','Synthetic location',now(),true) RETURNING id",[t,projects[n],wo,version,orgs[n],cp,crew,worker,foreman])).rows[0].id;
 await p.query("INSERT INTO daily_jsa_participants(tenant_id,daily_jsa_id,worker_id,acknowledged,acknowledged_by,acknowledged_at) VALUES($1,$2,$3,true,$4,now())",[t,jsa,worker,foreman]);
 await p.query('UPDATE production_records SET crew_id=$2,work_order_version_id=$3 WHERE id=$1',[pr,crew,version]);
 await p.query('UPDATE work_orders SET assigned_crew_id=$2 WHERE id=$1',[wo,crew]);
 records.push({'work-orders':wo,'production-records':pr,'qc-reviews':qc,'billable-items':bi});
 }
 for(const [scope,target]of [['customer',orgs[0]],['territory',territories[0]],['project',projects[0]]]){
 const u=(await p.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic scoped reviewer') RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id;
 const m=(await p.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[t,u])).rows[0].id;
 const role=(await p.query("INSERT INTO roles(tenant_id,name) VALUES($1,$2) RETURNING id",[t,'QC Manager'])).rows[0].id;
 await p.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key IN ('project.read','project.update','work_order.timeline.read','work_order.audit.read','production.timeline.read','production.audit.read','qc_review.timeline.read','qc_review.audit.read','billable_item.timeline.read','billable_item.audit.read','production_evidence.read','production_evidence.create','production_evidence.update','production_evidence.archive','work_order.read','work_order.update','work_order.create','production_record.read','production_record.update','qc_review.read','qc_review.create','qc.review','qc_review.request_correction','qc_review.start','billable_item.read','billable_item.update')",[t,role]);
 await p.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)',[t,m,role,scope,target]);
 const token=createAuthToken({sub:u,tenant_id:t},process.env.AUTH_JWT_SECRET);
 async function call(url,method='GET',body){const response=await fetch(base+url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json','x-scope-type':'tenant','x-scope-id':t},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
 assert.equal((await call('/projects/'+projects[0])).status,200,scope+' own');assert.equal((await call('/projects/'+projects[1])).status,403,scope+' foreign');
 const list=await call('/projects');assert.equal(list.status,200);assert.deepEqual(list.data.map(x=>x.id),[projects[0]]);
 for(const route of Object.keys(records[0])){
 const own=await call('/'+route+'/'+records[0][route]);assert.equal(own.status,200,scope+' '+route+' own '+JSON.stringify(own.data));
 assert.equal((await call('/'+route+'/'+records[1][route])).status,403,scope+' '+route+' foreign');
 for(const suffix of ['/detail','/timeline','/audit-summary',...(route==='production-records'?['/evidence']:[])]){
 assert.equal((await call('/'+route+'/'+records[0][route]+suffix)).status,200,scope+' '+route+suffix+' permitted');
 assert.equal((await call('/'+route+'/'+records[1][route]+suffix)).status,403,scope+' '+route+suffix+' forbidden');
 }
 const rows=await call('/'+route);assert.equal(rows.status,200,route+' list '+JSON.stringify(rows.data));assert.deepEqual(rows.data.map(x=>x.id),[records[0][route]],scope+' '+route+' list');
 }
 for(const [route,method,suffix,body]of [
 ['production-records','PATCH','',{description:'Scoped production edit'}],
 ['qc-reviews','POST','/start-review',{}],
 ['billable-items','PATCH','',{rate_description:'Scoped billable description'}]]){
 if(route==='qc-reviews')await p.query("UPDATE qc_reviews SET review_status='pending' WHERE id=$1",[records[0][route]]);
 const edit=await call('/'+route+'/'+records[0][route]+suffix,method,body);assert.ok([200,201].includes(edit.status),scope+' '+route+' own mutation '+JSON.stringify(edit.data));
 assert.equal((await call('/'+route+'/'+records[1][route]+suffix,method,body)).status,403,scope+' '+route+' forbidden mutation');
 }
 const evidence=await call('/production-records/'+records[0]['production-records']+'/evidence','POST',{evidence_type:'photo',caption:'Synthetic scoped evidence metadata'});
 assert.equal(evidence.status,201,JSON.stringify(evidence.data));const evidenceId=evidence.data.id;assert.ok(evidenceId);
 assert.equal((await call('/production-evidence/'+evidenceId,'PATCH',{caption:'Updated synthetic evidence'})).status,200);
 assert.equal((await call('/production-records/'+records[1]['production-records']+'/evidence','POST',{evidence_type:'photo',caption:'Forbidden'})).status,403);
 const foreignEvidence=(await p.query("INSERT INTO production_evidence(tenant_id,production_record_id,evidence_type,summary) VALUES($1,$2,'photo','Synthetic foreign evidence') RETURNING id",[t,records[1]['production-records']])).rows[0].id;
 assert.equal((await call('/production-evidence/'+foreignEvidence,'PATCH',{caption:'Forbidden'})).status,403);
 assert.equal((await call('/production-evidence/'+foreignEvidence+'/archive','POST',{archive_reason:'duplicate'})).status,403);
 assert.equal((await call('/production-evidence/'+evidenceId,'PATCH',{file_id:randomUUID()})).status,403);
 const files=[];
 for(let n=0;n<2;n++){
 const file=(await p.query("INSERT INTO files(tenant_id,bucket,object_key,file_name) VALUES($1,'synthetic-no-upload',$2,'synthetic.txt') RETURNING id",[t,randomUUID()])).rows[0].id;
 await p.query("INSERT INTO file_links(tenant_id,file_id,entity_type,entity_id) VALUES($1,$2,'project',$3)",[t,file,projects[n]]);files.push(file);
 }
 assert.equal((await call('/production-evidence/'+evidenceId,'PATCH',{file_id:files[0]})).status,200);
 assert.equal((await call('/production-evidence/'+evidenceId,'PATCH',{file_id:files[1]})).status,403);
 assert.equal((await p.query('SELECT file_id FROM production_evidence WHERE id=$1',[evidenceId])).rows[0].file_id,files[0]);
 assert.equal((await call('/production-evidence/'+evidenceId+'/archive','POST',{archive_reason:'duplicate'})).status,201);
 const options=await call('/qc-review-create-options');assert.equal(options.status,200);assert.deepEqual(options.data.sourceReviews.map(x=>x.id),[records[0]['qc-reviews']]);
 assert.ok(options.data.reviewers.some(x=>x.id===u));assert.equal((await call('/qc-review-correction-owners')).status,200);
 await p.query("UPDATE production_records SET status='submitted' WHERE tenant_id=$1",[t]);
 const queue=await call('/qc/review-queue');assert.equal(queue.status,200);assert.deepEqual(queue.data.map(x=>x.id),[records[0]['production-records']]);
 assert.equal((await call('/qc/review-queue/'+records[0]['production-records'])).status,200);assert.equal((await call('/qc/review-queue/'+records[1]['production-records'])).status,403);
 await p.query("UPDATE production_records SET status='draft' WHERE tenant_id=$1",[t]);
 const wo=records[0]['work-orders'];
 assert.equal((await call('/work-orders/'+wo,'PATCH',{risk_notes:'Scoped work edit'})).status,200,scope+' work edit');
 assert.equal((await call('/work-orders/'+records[1]['work-orders'],'PATCH',{risk_notes:'Forbidden edit'})).status,403,scope+' foreign work edit');
 assert.equal((await call('/work-orders/'+wo,'PATCH',{project_id:projects[1]})).status,403,scope+' work reparent');
 assert.equal((await p.query('SELECT project_id FROM work_orders WHERE id=$1',[wo])).rows[0].project_id,projects[0]);
 await p.query("UPDATE projects SET status='planning' WHERE id=$1",[projects[0]]);
 const create={project_id:projects[0],work_order_name:'Synthetic scoped creation',work_type:'construction',location_summary:'Synthetic location',planned_quantity:10,unit:'feet'};
 const created=await call('/work-orders','POST',create);assert.equal(created.status,201,scope+' work create '+JSON.stringify(created.data));
 assert.equal((await call('/work-orders','POST',{...create,project_id:projects[1]})).status,403,scope+' foreign work create');
 await p.query('UPDATE work_orders SET deleted_at=now() WHERE tenant_id=$1 AND work_order_name=$2',[t,'Synthetic scoped creation']);
 const concurrent=await Promise.all([call('/projects/'+projects[0],'PATCH',{risk_notes:'First concurrent edit'}),call('/projects/'+projects[0],'PATCH',{risk_notes:'Second concurrent edit'})]);assert.deepEqual(concurrent.map(x=>x.status),[200,200],scope+' concurrent project writes');

 assert.equal((await call('/projects/'+projects[0],'PATCH',{risk_notes:'Scoped edit'})).status,200,scope+' edit');
 assert.equal((await call('/projects/'+projects[0],'PATCH',{territory_id:territories[1]})).status,403,scope+' reparent');
 assert.equal((await p.query('SELECT territory_id FROM projects WHERE id=$1',[projects[0]])).rows[0].territory_id,territories[0]);
 if(scope!=='project'){
 const empty=(await p.query(scope==='customer'?"INSERT INTO organizations(tenant_id,name) VALUES($1,'Synthetic empty scope') RETURNING id":"INSERT INTO territories(tenant_id,name) VALUES($1,'Synthetic empty scope') RETURNING id",[t])).rows[0].id;
 await p.query('UPDATE user_roles SET scope_id=$2 WHERE role_id=$1',[role,empty]);
 for(const route of ['projects','work-orders','production-records','qc-reviews','billable-items','qc/review-queue']){
 const response=await call('/'+route);assert.equal(response.status,200,scope+' empty '+route);assert.deepEqual(response.data,[]);
 }
 await p.query('UPDATE user_roles SET scope_id=$2 WHERE role_id=$1',[role,target]);
 }
 await p.query("UPDATE roles SET deleted_at=now(),name=id::text WHERE id=$1",[role]);assert.equal((await call('/projects/'+projects[0])).status,403,scope+' revoked');assert.equal((await call('/work-orders/'+wo,'PATCH',{risk_notes:'Revoked edit'})).status,403);
 }
 }finally{await p.end();}
});
