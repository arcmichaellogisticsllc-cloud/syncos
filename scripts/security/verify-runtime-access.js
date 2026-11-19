'use strict';
const {Client}=require('pg');
async function verifyRuntimeAccess(client){
 const r=(await client.query(`SELECT r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
 has_schema_privilege(current_user,'public','CREATE') AS schema_create,
 (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=r.oid) AS owned_objects,
 (SELECT count(*)::int FROM pg_auth_members m WHERE m.member=r.oid) AS memberships,
 has_table_privilege(current_user,'public.audit_logs','UPDATE') OR has_table_privilege(current_user,'public.audit_logs','DELETE') OR has_table_privilege(current_user,'public.audit_logs','TRUNCATE') AS audit_rewrite,
 has_table_privilege(current_user,'public.identity_audit','UPDATE') OR has_table_privilege(current_user,'public.identity_audit','DELETE') OR has_table_privilege(current_user,'public.identity_audit','TRUNCATE') AS identity_audit_rewrite,
 has_table_privilege(current_user,'public.schema_migrations','TRUNCATE') OR has_table_privilege(current_user,'public.schema_migrations','INSERT') OR has_table_privilege(current_user,'public.schema_migrations','UPDATE') OR has_table_privilege(current_user,'public.schema_migrations','DELETE') AS migration_write
 FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
 if(!r||Object.values(r).some(v=>v===true||typeof v==='number'&&v>0))throw Error('Runtime database privilege verification failed');
 await client.query('SELECT 1 FROM users LIMIT 1');return {status:'passed',scope:'runtime ownership, privileged role attributes, inherited roles, schema creation and audit/migration rewrite protection'};
}
module.exports={verifyRuntimeAccess};
if(require.main===module)(async()=>{if(!process.env.DATABASE_URL)throw Error('Missing protected runtime configuration');const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{console.log(JSON.stringify(await verifyRuntimeAccess(c)));}finally{await c.end();}})().catch(()=>{console.error('Runtime access verification failed; deployment must remain blocked.');process.exitCode=1;});
