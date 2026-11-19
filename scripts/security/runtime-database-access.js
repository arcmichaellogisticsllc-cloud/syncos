'use strict';
const {Client}=require('pg');
const crypto=require('node:crypto');
function verifier(password){
 if(!/^[\x21-\x7e]{32,128}$/.test(password))throw Error('Use a generated ASCII password of 32 to 128 characters');
 const salt=crypto.randomBytes(16),iterations=16384,base=crypto.pbkdf2Sync(password,salt,iterations,32,'sha256');
 const stored=crypto.createHash('sha256').update(crypto.createHmac('sha256',base).update('Client Key').digest()).digest('base64');
 const server=crypto.createHmac('sha256',base).update('Server Key').digest('base64');
 return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${stored}:${server}`;
}
const identifier=value=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(value||''))throw Error('Use a lowercase database role identifier');return '"'+value+'"';};
async function configureRuntimeRole(client,{role,password,apply=false}){
 const quoted=identifier(role);
 const current=(await client.query('SELECT current_user,current_database() AS database')).rows[0];
 if(role===current.current_user)throw Error('Runtime role must differ from migration owner');
 const existing=(await client.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[role])).rows[0];
 if(existing&&Object.values(existing).some(Boolean))throw Error('Refuse privileged runtime role');
 if(existing){
  const unsafe=(await client.query(`SELECT
    (SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1))+
    (SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1))+
    (SELECT count(*) FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=$1))+
    (SELECT count(*) FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=$1)) AS count`,[role])).rows[0];
  if(Number(unsafe.count))throw Error('Runtime role has ownership or inherited authority; resolve explicitly before provisioning');
 }
 const plan={runtimeRole:role,migrationOwner:current.current_user,database:current.database,exists:!!existing,applied:apply};
 if(!apply)return plan;
 await client.query('BEGIN');
 try{
  if(!existing)await client.query(`CREATE ROLE ${quoted} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
  if(password){if(password.length<32)throw Error('Runtime password must be at least 32 characters');const literal=(await client.query('SELECT quote_literal($1) AS value',[verifier(password)])).rows[0].value;await client.query(`ALTER ROLE ${quoted} LOGIN PASSWORD ${literal}`);}
  const dbName='"'+current.database.replaceAll('"','""')+'"';
  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT CONNECT ON DATABASE ${dbName} TO ${quoted}; GRANT USAGE ON SCHEMA public TO ${quoted}; REVOKE CREATE ON SCHEMA public FROM ${quoted}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quoted}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${quoted}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoted}`);
  await client.query(`REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.schema_migrations FROM ${quoted}`);
  for(const table of ['audit_logs','identity_audit']){
   const exists=(await client.query('SELECT to_regclass($1) AS table',['public.'+table])).rows[0].table;
   if(exists)await client.query(`REVOKE UPDATE,DELETE,TRUNCATE ON public.${table} FROM ${quoted}`);
  }
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${quoted}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${quoted}`);
  await client.query('COMMIT');return plan;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
module.exports={configureRuntimeRole};
if(require.main===module)(async()=>{
 const client=new Client({connectionString:process.env.MIGRATION_DATABASE_URL});
 if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL is required and must be supplied privately');
 await client.connect();try{console.log(JSON.stringify(await configureRuntimeRole(client,{role:process.env.RUNTIME_DATABASE_ROLE,password:process.env.RUNTIME_DATABASE_PASSWORD,apply:process.argv.includes('--apply')})));}finally{await client.end();}
})().catch(()=>{console.error('Database access configuration failed; no credentials are printed. Check role prerequisites and protected settings.');process.exitCode=1;});
