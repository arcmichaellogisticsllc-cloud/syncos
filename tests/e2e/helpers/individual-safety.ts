import crypto from 'node:crypto';
import { Client } from 'pg';
import { expect,type APIRequestContext } from '@playwright/test';
// Fixture setup provisions distinct worker identities; consent is then exercised
// through the same authenticated endpoint as the worker, never a bulk update.
export async function acknowledgeFixtureJsa(request:APIRequestContext, tenant:string, jsaId:string){
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const rows=(await db.query(`SELECT p.worker_id,p.acknowledged_by,p.acknowledged,j.organization_id,j.revision_number,l.tenant_user_id,tu.user_id
    FROM daily_jsa_participants p JOIN daily_jsas j ON j.tenant_id=p.tenant_id AND j.id=p.daily_jsa_id
    LEFT JOIN partner_worker_user_links l ON l.tenant_id=p.tenant_id AND l.worker_id=p.worker_id AND l.status='active' AND l.deleted_at IS NULL
    LEFT JOIN tenant_users tu ON tu.tenant_id=l.tenant_id AND tu.id=l.tenant_user_id
    WHERE p.tenant_id=$1 AND p.daily_jsa_id=$2 AND p.participation_status='present'`,[tenant,jsaId])).rows;
  expect(rows.length).toBeGreaterThan(0);
  for(const row of rows){
   let user=row.user_id;
   if(!user){user=crypto.randomUUID();const tu=crypto.randomUUID();await db.query('INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)',[user,`safety-${user}@syncos.test`,'Synthetic individual worker']);await db.query('INSERT INTO tenant_users(id,tenant_id,user_id) VALUES($1,$2,$3)',[tu,tenant,user]);await db.query('INSERT INTO partner_worker_user_links(tenant_id,organization_id,worker_id,tenant_user_id) VALUES($1,$2,$3,$4)',[tenant,row.organization_id,row.worker_id,tu]);}
   if(!row.acknowledged_by)expect(row.acknowledged).toBe(false);
   const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify({sub:user,tenant_id:tenant,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');const token=`${h}.${p}.${crypto.createHmac('sha256',process.env.AUTH_JWT_SECRET!).update(`${h}.${p}`).digest('base64url')}`;
   const response=await request.post(`${process.env.API_BASE_URL}/work-safety/jsas/${jsaId}/acknowledge`,{headers:{authorization:`Bearer ${token}`},data:{revision_number:row.revision_number,confirmed:true}});expect(response.ok(),await response.text()).toBe(true);
  }
  await establishFixtureStaffing(request,tenant,jsaId);
 }finally{await db.end();}
}

export async function safetyActor(tenant:string,key:string){
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const user=crypto.randomUUID(),tu=crypto.randomUUID();
  let role=(await db.query('SELECT id FROM roles WHERE tenant_id=$1 AND system_key=$2 AND deleted_at IS NULL',[tenant,key])).rows[0]?.id;
  if(!role){role=crypto.randomUUID();await db.query('INSERT INTO roles(id,tenant_id,name,system_key) VALUES($1,$2,$3,$3)',[role,tenant,key]);}
  await db.query('INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)',[user,`safety-${user}@syncos.test`,key]);
  await db.query('INSERT INTO tenant_users(id,tenant_id,user_id) VALUES($1,$2,$3)',[tu,tenant,user]);
  await db.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,'tenant',$1)",[tenant,tu,role]);
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub:user,tenant_id:tenant,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `${h}.${p}.${crypto.createHmac('sha256',process.env.AUTH_JWT_SECRET!).update(`${h}.${p}`).digest('base64url')}`;
 }finally{await db.end();}
}
export async function reviewFixtureSafetyScope(request:APIRequestContext,tenant:string,version:string){
 const bearer=await safetyActor(tenant,'operations_manager');
 const response=await request.post(`${process.env.API_BASE_URL}/work-safety/work-orders/${version}/scope-review`,{headers:{authorization:`Bearer ${bearer}`},data:{pre_bore_required:false,evidence_reference:'SYNTHETIC aerial-only scope; no field approval asserted'}});
 expect(response.ok(),await response.text()).toBe(true);
 const policy=await request.post(`${process.env.API_BASE_URL}/work-safety/work-orders/${version}/evidence-policy`,{headers:{authorization:`Bearer ${bearer}`},data:{requirements:{},capture_time_required:false,source_reference:'SYNTHETIC fixture baseline: evidence requirements tested independently'}});expect(policy.ok(),await policy.text()).toBe(true);
 return bearer;
}

// Establish a synthetic, reviewed staffing baseline for existing field lifecycle
// fixtures. Role shortages and authority boundaries are exercised separately.
async function establishFixtureStaffing(request:APIRequestContext,tenant:string,jsaId:string){
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const j=(await db.query('SELECT * FROM daily_jsas WHERE tenant_id=$1 AND id=$2',[tenant,jsaId])).rows[0];
  const workers=(await db.query("SELECT worker_id FROM daily_jsa_participants WHERE tenant_id=$1 AND daily_jsa_id=$2 AND participation_status='present'",[tenant,jsaId])).rows.map(x=>x.worker_id);
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub:j.foreman_user_id,tenant_id:tenant,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const foreman=`${h}.${p}.${crypto.createHmac('sha256',process.env.AUTH_JWT_SECRET!).update(`${h}.${p}`).digest('base64url')}`,supervisor=await safetyActor(tenant,'field_supervisor');
  const path=`staffing/${j.work_order_version_id}/${j.crew_id}`;
  async function read(){const r=await request.get(`${process.env.API_BASE_URL}/${path}`,{headers:{authorization:`Bearer ${foreman}`}});expect(r.ok(),await r.text()).toBe(true);return r.json();}
  async function post(token:string,route:string,data:any){const r=await request.post(`${process.env.API_BASE_URL}/${route}`,{headers:{authorization:`Bearer ${token}`},data});expect(r.ok(),await r.text()).toBe(true);return r.json();}
  let state=await read(),plan=state.plans.find((x:any)=>x.approved_at);
  if(!plan||plan.requirements[0]?.minimum!==workers.length){
   plan=await post(foreman,path+'/plans',{previous_plan_id:state.plans[0]?.id??null,phase:'Synthetic field fixture',requirements:[{code:'fixture_work',minimum:workers.length,qualification:'SYNTHETIC reviewed fixture workers'}],plan_reference:'SYNTHETIC no real site authority',pause_instructions:'SYNTHETIC maintain protective functions and pause affected production'});
   await post(supervisor,`staffing/plans/${plan.id}/approve`,{review_reference:'SYNTHETIC fixture qualification and plan review'});
  }
  for(const worker of workers)await post(supervisor,`staffing/plans/${plan.id}/eligibility`,{worker_id:worker,role_code:'fixture_work',valid_until:new Date(Date.now()+4*3600000).toISOString(),evidence_reference:'SYNTHETIC verified fixture eligibility',revoked:false});
  state=await read();const check=await post(foreman,path+'/checks',{plan_id:plan.id,daily_jsa_id:jsaId,client_mutation_id:crypto.randomUUID(),expected_check_id:state.check?.id??null,coverage:workers.map((worker_id:string)=>({worker_id,role_code:'fixture_work'})),shift_ends_at:new Date(Date.now()+2*3600000).toISOString(),reason:'SYNTHETIC current fixture coverage'});
  expect(check.findings).toEqual([]);
  state=await read();for(const active of state.cases.filter((x:any)=>x.status!=='released'))await post(supervisor,`staffing/cases/${active.id}/release`,{check_id:check.id,release_reference:'SYNTHETIC reviewed fixture restart'});
 }finally{await db.end();}
}
