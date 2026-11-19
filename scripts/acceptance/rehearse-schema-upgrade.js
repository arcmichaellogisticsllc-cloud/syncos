#!/usr/bin/env node
'use strict';
const {Client}=require('pg'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const source=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(source.hostname)||!/^syncos_synthetic_upgrade_[a-z0-9_]+$/.test(source.pathname.slice(1)))throw Error('Use a new explicitly synthetic localhost upgrade database.');
const cutoff=102;
async function hashes(c){const out={};for(const {tablename}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('schema_migrations','permissions','role_permissions') ORDER BY tablename")).rows){out[tablename]=(await c.query(`SELECT count(*)::text n,md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) digest FROM "${tablename.replaceAll('"','""')}" t`)).rows[0];}return out;}
function run(file){const r=spawnSync(process.execPath,[file],{env:process.env,encoding:'utf8'});if(r.status!==0)throw Error(path.basename(file)+' failed: '+r.stderr.slice(0,500));}
(async()=>{const c=new Client({connectionString:source.href});await c.connect();try{
 if((await c.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount)throw Error('Upgrade source must be empty.');
 await c.query('CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 const files=fs.readdirSync('packages/database/migrations').filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>Number(f.slice(0,3))<=cutoff)){await c.query('BEGIN');try{await c.query(fs.readFileSync('packages/database/migrations/'+f,'utf8'));await c.query('INSERT INTO schema_migrations(id) VALUES($1)',[f]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}}
 run('packages/database/scripts/seed.js');run('packages/database/scripts/seed-e2e-demo.js');
 // Hash before upgrading. This database contains only canonical, explicitly synthetic fixtures.
 const before=await hashes(c);run('packages/database/scripts/migrate.js');const after=await hashes(c);
 const changed=Object.keys(before).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));if(changed.length)throw Error('Existing business records changed: '+changed.join(','));
 const migrations=(await c.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r=>r.id);
 console.log(JSON.stringify({status:'passed',scope:'Synthetic forward schema upgrade; not a production rollback or offsite restoration',from:cutoff,to:migrations.length,preservedTables:Object.keys(before).length,existingRows:Object.values(before).reduce((n,v)=>n+Number(v.n),0),existingTableHashes:before,newTables:Object.keys(after).filter(k=>!before[k]),migrations},null,2));
 }finally{await c.end()}})().catch(e=>{console.error(e.message);process.exitCode=1});
