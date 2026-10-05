const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{createAuthToken}=require('@syncos/auth');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL,base=process.env.SYNCOS_PRODUCT_TEST_API_URL,secret=process.env.AUTH_JWT_SECRET;
test('product workspace HTTP routes enforce unauthenticated, read-only and mutation boundaries',{skip:!url||!base||!secret},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tag=randomUUID(),tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic HTTP',$1) RETURNING id",['http-'+tag])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic reader') RETURNING id",[tag+'@synthetic.test'])).rows[0].id;
 const membership=(await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,user])).rows[0].id;
 const role=(await pool.query("INSERT INTO roles(tenant_id,name,system_key) VALUES($1,'Synthetic reader','synthetic_reader') RETURNING id",[tenant])).rows[0].id;
 await pool.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,membership,role]);
 const headers={authorization:'Bearer '+createAuthToken({sub:user,tenant_id:tenant,auth_version:0},secret),'content-type':'application/json'};
 for(const path of ['supplemental-forms','material-inventory','customer-inquiries']){assert.equal((await fetch(`${base}/${path}`)).status,401);assert.equal((await fetch(`${base}/${path}`,{headers})).status,403);}
 await pool.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key IN ('form.read','inventory.read','customer_inquiry.read')",[tenant,role]);
 for(const path of ['supplemental-forms','material-inventory','customer-inquiries'])assert.equal((await fetch(`${base}/${path}`,{headers})).status,200);
 for(const path of ['supplemental-forms/versions','supplemental-forms/records','material-inventory/lots','material-inventory/movements','material-inventory/adjustments','customer-inquiries','syncfield/foreman/evidence-uploads','syncfield/foreman/evidence-uploads/00000000-0000-0000-0000-000000000001/chunks','syncfield/foreman/evidence-uploads/00000000-0000-0000-0000-000000000001/complete'])assert.equal((await fetch(`${base}/${path}`,{method:'POST',headers,body:'{}'})).status,403);
 }finally{await pool.end();}
});
