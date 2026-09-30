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
 return bearer;
}
