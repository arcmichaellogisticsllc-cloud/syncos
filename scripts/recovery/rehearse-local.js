#!/usr/bin/env node
'use strict';
// Restore into a new local database and file root; never overwrite a live target.
const {Client}=require('pg');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const {createReadStream}=require('node:fs');
const quote=id=>'"'+id.replaceAll('"','""')+'"';
function localUrl(value){const url=new URL(value);if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('This rehearsal accepts only isolated localhost databases.');if(!/^syncos_(remaining_test|certification_[a-z0-9_]+|synthetic_[a-z0-9_]+)$/.test(url.pathname.slice(1)))throw Error('Source must be an explicitly named SyncOS synthetic test database.');return url;}
function envFor(url){return {...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))};}
async function command(name,args,url){await new Promise((resolve,reject)=>{const p=spawn(name,args,{env:envFor(url),stdio:['ignore','ignore','pipe']});let detail='';p.stderr.on('data',b=>{detail+=b.toString();});p.on('error',()=>reject(Error(`${name} could not start`)));p.on('exit',code=>code===0?resolve():reject(Error(`${name} failed (${code}); partial artifacts were preserved. ${detail.replace(/postgres(?:ql)?:\/\/\S+/g,'[connection redacted]').slice(0,1200)}`)));});}
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function counts(client){const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;const result={};for(const {tablename} of tables)result[tablename]=(await client.query(`SELECT count(*)::text n FROM ${quote(tablename)}`)).rows[0].n;return result;}
async function main(){
 const source=localUrl(process.env.DATABASE_URL||''),name=process.env.RECOVERY_DATABASE;
 if(!/^syncos_recovery_[a-z0-9_]+$/.test(name||''))throw Error('Set RECOVERY_DATABASE to a new syncos_recovery_ name.');
 const sourceRoot=await fs.realpath(process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR||'/private/tmp/syncos-restricted-files');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'syncos-recovery-'));await fs.chmod(root,0o700);
 const snapshotClient=new Client({connectionString:source.href}),target=new URL(source.href);target.pathname='/'+name;
 const adminUrl=new URL(source.href);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});
 let restore;const started=Date.now();
 try{
  await snapshotClient.connect();await admin.connect();
  if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)throw Error('Recovery target already exists; choose a new database.');
  await snapshotClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot=(await snapshotClient.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const before=await counts(snapshotClient);
  const files=(await snapshotClient.query('SELECT id,storage_key,checksum,size_bytes FROM partner_restricted_file_objects ORDER BY id')).rows;
  const dump=path.join(root,'database.dump');
  await command('pg_dump',['--format=custom','--no-owner','--no-acl','--snapshot='+snapshot,'--file='+dump],source);await fs.chmod(dump,0o600);
  const restoredRoot=path.join(root,'restored-files');await fs.mkdir(restoredRoot,{mode:0o700});
  for(const file of files){
   if(typeof file.storage_key!=='string'||path.isAbsolute(file.storage_key)||file.storage_key.split(/[\\/]/).includes('..'))throw Error('Unsafe restricted-file key; recovery stopped.');
   const origin=await fs.realpath(path.resolve(sourceRoot,file.storage_key));if(!origin.startsWith(sourceRoot+path.sep))throw Error('Restricted file escapes source root.');
   const destination=path.join(restoredRoot,file.storage_key);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.copyFile(origin,destination);await fs.chmod(destination,0o600);
   if((await fs.stat(destination)).size!==Number(file.size_bytes)||(await digest(destination))!==file.checksum)throw Error(`Restricted original ${file.id} failed integrity verification.`);
  }
  await snapshotClient.query('COMMIT');
  await admin.query(`CREATE DATABASE ${quote(name)}`);
  await command('pg_restore',['--single-transaction','--no-owner','--no-acl','--dbname='+name,dump],target);
  restore=new Client({connectionString:target.href});await restore.connect();const after=await counts(restore);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Restored table counts do not match the coordinated snapshot.');
  const restoredFiles=(await restore.query('SELECT id,storage_key,checksum,size_bytes FROM partner_restricted_file_objects ORDER BY id')).rows;
  if(JSON.stringify(files)!==JSON.stringify(restoredFiles))throw Error('Restricted-file metadata differs after restore.');
  const result={status:'passed',scope:'Local synthetic coordinated database and restricted-file restore; not offsite or total-server-loss acceptance',database:name,tableCount:Object.keys(after).length,tableCounts:after,restrictedOriginals:files.length,dumpSha256:await digest(dump),elapsedSeconds:Math.round((Date.now()-started)/1000),artifacts:root,restoredFileRoot:restoredRoot};
  await fs.writeFile(path.join(root,'recovery-evidence.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));
 }finally{await restore?.end();await snapshotClient.end();await admin.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
