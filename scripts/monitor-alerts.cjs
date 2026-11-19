'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
// Independent of the application database: alerts must survive database outages.
// A crash during SMTP submission is an unknown outcome, never an automatic resend.
async function save(file,state){const tmp=file+'.'+randomUUID();const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(JSON.stringify(state)+'\n');await h.sync();}finally{await h.close();}await fs.rename(tmp,file);const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}}
async function updateAlerts({directory,alerts,send,enabled=false,now=Date.now(),maxAttempts=5}){
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const stat=await fs.lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid()))throw Error('Alert state directory must be private and owned by the monitor');
 const lock=path.join(directory,'lock');let handle;
 try{handle=await fs.open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')return {status:'locked_requires_review'};throw e;}
 const file=path.join(directory,'alerts.json');
 try{
  let state;try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,incidents:[]};}
  if(state.version!==1||!Array.isArray(state.incidents))throw Error('Invalid alert state');
  const keys=[...new Set(alerts)];if(keys.some(k=>typeof k!=='string'||!/^\w{1,100}$/.test(k)))throw Error('Invalid alert code');
  for(const i of state.incidents){if(i.status==='submitting')i.status='unknown_requires_review';if(!keys.includes(i.code)&&!i.resolvedAt){i.resolvedAt=now;if(i.status==='pending')i.status='resolved_before_submission';}}
  for(const code of keys)if(!state.incidents.some(i=>i.code===code&&!i.resolvedAt))state.incidents.push({id:randomUUID(),code,createdAt:now,attempts:0,status:'pending',nextAttemptAt:now});
  await save(file,state);
  if(enabled){if(typeof send!=='function')throw Error('Alert sender required');for(const i of state.incidents){
   if(i.status!=='pending'||i.nextAttemptAt>now||i.resolvedAt)continue;
   i.status='submitting';i.attempts++;await save(file,state);
   try{const result=await send({id:i.id,code:i.code});i.status=result?.accepted===true?'relay_accepted':'rejected_requires_review';i.receipt=result?.receipt||null;}
   catch(e){i.lastFailure={responseCode:Number.isInteger(e?.responseCode)&&e.responseCode>=400&&e.responseCode<=599?e.responseCode:null,failureClass:['ETIMEDOUT','ECONNECTION','ESOCKET','EAUTH','EENVELOPE','EMESSAGE'].includes(e?.failureClass)?e.failureClass:'unknown',command:['CONN','EHLO','HELO','STARTTLS','AUTH','MAIL FROM','RCPT TO','DATA'].includes(e?.command)?e.command:'unknown'};if(e?.safeToRetry===true&&i.attempts<maxAttempts){i.status='pending';i.nextAttemptAt=now+Math.min(3600000,60000*2**(i.attempts-1));}else{i.status=e?.safeToRetry===true?'failed_requires_review':'unknown_requires_review';}}
   await save(file,state);
  }}
  return {status:enabled?'processed':'sending_disabled',pending:state.incidents.filter(i=>i.status==='pending').length,review:state.incidents.filter(i=>i.status.endsWith('requires_review')).length,relayAccepted:state.incidents.filter(i=>i.status==='relay_accepted').length};
 }finally{await handle.close();await fs.unlink(lock);}
}
module.exports={updateAlerts,save};
