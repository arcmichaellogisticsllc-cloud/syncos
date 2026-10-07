#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile);
async function backupAge(root,extension,now=Date.now()){
 const files=await fs.readdir(root,{withFileTypes:true});let latest=0;
 for(const f of files)if(f.isFile()&&f.name.endsWith(extension))latest=Math.max(latest,(await fs.stat(path.join(root,f.name))).mtimeMs);
 return latest ? Math.max(0,(now-latest)/3600000) : null;
}
async function httpStatus(url,validate){try{const r=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});const valid=validate ? validate(await r.json()) : true;if(!validate)await r.body?.cancel();return {ok:r.ok&&valid,status:r.status};}catch{return {ok:false,status:null};}}
function assess(report){
 const alerts=[];
 for(const [name,result]of Object.entries(report.http))if(!result.ok)alerts.push(name+'_unavailable');
 for(const [name,active]of Object.entries(report.services))if(!active)alerts.push(name+'_inactive');
 if(report.diskUsedPercent===null||report.diskUsedPercent>=85)alerts.push('storage_pressure_or_unavailable');
 for(const [name,age]of Object.entries(report.backupAgeHours))if(age===null||age>36)alerts.push(name+'_backup_missing_or_stale');
 if(report.database!==true)alerts.push('database_monitor_unavailable');
 for(const [name,counts]of Object.entries(report.queues))if(counts.failed>0||counts.overdue>0||counts.stalled>0)alerts.push(name+'_requires_review');
 return alerts;
}
async function collect(env=process.env){
 const report={checkedAt:new Date().toISOString(),http:{},services:{},diskUsedPercent:null,backupAgeHours:{},database:false,queues:{},notificationDelivery:'not_configured'};
 for(const [name,url]of Object.entries({api:'http://127.0.0.1:3237/health/startup',web:'http://127.0.0.1:3238/login'}))report.http[name]=await httpStatus(url,name==='api'?require('./check-deployed-startup').isReleaseHealthy:undefined);
 for(const service of ['syncos-staging-api','syncos-staging-web','syncos-staging-worker']){try{await exec('systemctl',['is-active','--quiet',service]);report.services[service]=true;}catch{report.services[service]=false;}}
 const shared=env.SYNCOS_STAGING_SHARED||'/opt/syncos/staging/shared';
 try{const s=await fs.statfs(shared);report.diskUsedPercent=Math.round((1-s.bavail/s.blocks)*100);}catch{}
 for(const [name,ext]of [['postgres','.dump'],['files','.tar.gz']]){try{report.backupAgeHours[name]=await backupAge(path.join(shared,'backups',name,'daily'),ext);}catch{report.backupAgeHours[name]=null;}}
 const {Pool}=require('pg');const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:10000,statement_timeout:10000});
 try{
  await pool.query('SELECT 1');report.database=true;
  // Aggregate only: never emit record identifiers, recipients, error messages or payloads.
  for(const [name,table,pending,time,stalled]of [
   ['workflow_notifications','workflow_notifications',"status='pending'",'next_attempt_at'],
   ['inquiry_notifications','inquiry_follow_up_notifications',"status='pending'",'next_attempt_at'],
   ['passport_refresh','passport_refresh_jobs',"status='queued'",'available_at',"status='leased' AND (lease_until IS NULL OR lease_until<now())"],
   ['prime_delivery','prime_delivery_jobs',"status='queued'",'next_attempt_at',"status='processing' AND (started_at IS NULL OR started_at<now()-interval '30 minutes')"]]){
   const q=await pool.query(`SELECT count(*) FILTER(WHERE status IN ('failed','review'))::int failed,count(*) FILTER(WHERE ${pending} AND ${time}<now()-interval '30 minutes')::int overdue,count(*) FILTER(WHERE ${stalled||'false'})::int stalled FROM ${table}`);report.queues[name]=q.rows[0];
  }
 }catch{report.database=false;}finally{await pool.end();}
 report.alerts=assess(report);report.status=report.alerts.length?'attention_required':'healthy';return report;
}
async function main(){const report=await collect();const dest=process.env.SYNCOS_HEALTH_REPORT||'/opt/syncos/staging/shared/monitoring/current.json';await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o750});await fs.writeFile(dest+'.next',JSON.stringify(report,null,2)+'\n',{mode:0o640});await fs.rename(dest+'.next',dest);console.log(JSON.stringify(report));if(report.alerts.length)process.exitCode=1;}
module.exports={backupAge,httpStatus,assess,collect};
if(require.main===module)main().catch(()=>{console.error('staging_monitor_execution_failed');process.exitCode=1;});
