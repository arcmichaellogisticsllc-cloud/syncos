"use strict";
const {normalize}=require('./index');
// No default decoder: Passport's wire contract/finality must be verified in sandbox.
// Reader and decoder injection also make outage/replay acceptance possible without credentials.
async function preparedRefresh({enabled=false,intake,tenantId,connectionId,reader,decode}){
 if(!enabled)return {outcome:'disabled'};
 if(typeof reader?.getTransaction!=='function'||typeof decode!=='function')throw Error('Verified reader and decoder are required');
 const connection=await intake.transaction(c=>intake.connection(c,tenantId,connectionId));
 const job=await intake.claim(tenantId,connectionId);if(!job)return {outcome:'idle'};
 let code='provider_unavailable';
 try{
  const wire=await reader.getTransaction(connection.customer_reference,job.transaction_reference);
  code='invalid_response';const transaction=normalize(await decode(wire));
  const result=await intake.ingestRefresh(tenantId,connectionId,job.id,job.lease_token,transaction);
  return {outcome:'observed',...result};
 }catch{
  // Only a safe category is persisted. No provider body, credentials or bank data are logged.
  await intake.fail(tenantId,job.id,job.lease_token,code);
  return {outcome:'retry_or_review',reason:code};
 }
}
module.exports={preparedRefresh};
