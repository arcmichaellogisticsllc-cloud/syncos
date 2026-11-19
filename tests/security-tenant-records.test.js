const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{createAuthToken}=require('../packages/auth/dist');
const database=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL,base=process.env.SYNCOS_SECURITY_TEST_API;
test('tenant administrator permissions cannot read another company field and finance records',{skip:!database||!base,timeout:60000},async()=>{assert.match(new URL(database).pathname,/security_audit/);assert.match(base,/^http:\/\/127\.0\.0\.1:/);const p=new Pool({connectionString:database});try{
const tenant=(await p.query("INSERT INTO tenants(name,slug) VALUES('Synthetic isolated administrator',$1) RETURNING id",['isolated-'+randomUUID()])).rows[0].id;
const user=(await p.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic isolated administrator') RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id;
const member=(await p.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,user])).rows[0].id;
const role=(await p.query("INSERT INTO roles(tenant_id,name) VALUES($1,'System Administrator') RETURNING id",[tenant])).rows[0].id;
await p.query('INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions',[tenant,role]);await p.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,member,role]);
const token=createAuthToken({sub:user,tenant_id:tenant},process.env.AUTH_JWT_SECRET);let checked=0;
for(const table of ['bank_accounts','bank_transactions','invoices','contractor_payables','payment_batches','payroll_runs','projects','work_orders','qc_reviews','billable_items','production_records','settlements']){
const row=(await p.query(`SELECT id FROM ${table} WHERE tenant_id<>$1 AND deleted_at IS NULL LIMIT 1`,[tenant])).rows[0];assert.ok(row,'Fixture missing '+table);const url=base+'/'+table.replaceAll('_','-')+'/'+row.id;const r=await fetch(url,{headers:{authorization:'Bearer '+token}});await r.arrayBuffer();assert.ok([403,404].includes(r.status),table+' cross-tenant status '+r.status);checked++;}
console.log(JSON.stringify({crossTenantRecordTypes:checked,role:'Full tenant permission grants',scope:'Field, QC and financial root records; nested files and same-tenant crew ownership remain separate checks'}));
}finally{await p.end();}});
