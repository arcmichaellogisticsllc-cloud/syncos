const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {AccessAdministrationController}=require('../apps/api/dist/routes/access-administration.controller');
const database=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('administration preserves tenant boundaries, prevents self-escalation and revokes old sessions',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{const tag=randomUUID(),t=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic access',$1) RETURNING id",['access-'+tag])).rows[0].id;
 async function user(){const id=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic access member') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;const membership=(await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[t,id])).rows[0].id;return {id,membership};}
 const admin=await user(),member=await user(),limited=await user();
 const permissions=(await pool.query("SELECT id,key FROM permissions WHERE key IN ('admin.manage_users','admin.manage_roles','invoice.read')")).rows;assert.equal(permissions.length,3);
 async function role(name,keys){const id=(await pool.query('INSERT INTO roles(tenant_id,name,system_key) VALUES($1,$2,$2) RETURNING id',[t,name])).rows[0].id;for(const p of permissions.filter(p=>keys.includes(p.key)))await pool.query('INSERT INTO role_permissions(tenant_id,role_id,permission_id) VALUES($1,$2,$3)',[t,id,p.id]);return id;}
 const all=await role('synthetic_admin',permissions.map(p=>p.key)),reader=await role('synthetic_reader',['invoice.read']),roleManager=await role('synthetic_role_manager',['admin.manage_roles']);
 for(const [u,r]of [[admin,all],[limited,roleManager]])await pool.query("INSERT INTO user_roles(tenant_id,tenant_user_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,'tenant',$1)",[t,u.membership,r]);
 const controller=new AccessAdministrationController(pool),req={auth:{tenantId:t,userId:admin.id}},low={auth:{tenantId:t,userId:limited.id}};
 await assert.rejects(controller.grant(req,admin.membership,{role_id:reader,operation:'grant',reason:'Synthetic test'}),/another workspace member/);
 await assert.rejects(controller.grant(low,member.membership,{role_id:all,operation:'grant',reason:'Synthetic forbidden escalation'}),/beyond your own/);
 await controller.grant(req,member.membership,{role_id:reader,operation:'grant',reason:'Synthetic approved reader'});assert.equal((await controller.read(req,member.membership)).grants.length,1);
 const version=(await pool.query('SELECT auth_version FROM users WHERE id=$1',[member.id])).rows[0].auth_version;assert.equal(version,1);
 await controller.status(req,member.membership,{status:'disabled',reason:'Synthetic removal'});assert.equal((await controller.read(req,member.membership)).member.status,'disabled');
 await assert.rejects(controller.grant(req,member.membership,{role_id:reader,operation:'grant',reason:'Synthetic test'}),/Activate/);
 await controller.status(req,member.membership,{status:'active',reason:'Synthetic restoration'});await controller.grant(req,member.membership,{role_id:reader,operation:'revoke',reason:'Synthetic grant retirement'});assert.equal((await controller.read(req,member.membership)).grants.length,0);
 await assert.rejects(controller.status(low,admin.membership,{status:'disabled',reason:'Synthetic last-admin removal'}),/administrator must remain/);assert.equal((await controller.read(req,admin.membership)).member.status,'active');
 const foreign={auth:{tenantId:randomUUID(),userId:admin.id}};await assert.rejects(controller.read(foreign,member.membership),/not found/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action LIKE 'access.%'",[t])).rows[0].n,4);
 }finally{await pool.end();}
});
