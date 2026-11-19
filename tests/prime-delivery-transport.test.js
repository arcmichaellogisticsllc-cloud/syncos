const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {transmitPrimePackage,validateDeliveryReceipt,approvedDeliveryEndpoint}=require('../apps/api/dist/routes/prime-delivery-transport');
test('delivery transport binds receipt to original package and refuses redirects or ambiguous acknowledgment',async()=>{
 const before={...process.env};Object.assign(process.env,{NODE_ENV:'test',PRIME_DELIVERY_TOKEN_SYNTHETIC:'synthetic-only'});let mode='success',calls=0;
 const server=http.createServer(async(req,res)=>{calls++;let bytes=[];for await(const p of req)bytes.push(p);assert.equal(Buffer.concat(bytes).toString(),'original package');assert.equal(req.headers['idempotency-key'],'synthetic-job');assert.equal(req.headers.authorization,'Bearer synthetic-only');
  if(mode==='redirect'){res.writeHead(302,{location:'/should-not-follow'});res.end();return;}if(mode==='rate'){res.writeHead(429);res.end();return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(mode==='ambiguous'?{status:'accepted'}:{receipt_id:'synthetic-receipt',status:'delivered',received_at:new Date().toISOString(),package_checksum:'checksum'}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const d={endpoint:'http://127.0.0.1:'+server.address().port,credential_env:'PRIME_DELIVERY_TOKEN_SYNTHETIC'},j={id:'synthetic-job',checksum:'checksum',bytes:Buffer.from('original package')};assert.equal((await transmitPrimePackage(d,j)).receipt_id,'synthetic-receipt');mode='redirect';await assert.rejects(transmitPrimePackage(d,j));assert.equal(calls,2);mode='ambiguous';await assert.rejects(transmitPrimePackage(d,j),/does not establish/);mode='rate';await assert.rejects(transmitPrimePackage(d,j),e=>e.retryable===true);
 assert.throws(()=>validateDeliveryReceipt({receipt_id:'x',status:'delivered',received_at:new Date().toISOString(),package_checksum:'other'},'checksum'));
 process.env.NODE_ENV='production';assert.throws(()=>approvedDeliveryEndpoint(d.endpoint));assert.throws(()=>approvedDeliveryEndpoint('https://unapproved.invalid'));
 }finally{await new Promise(r=>server.close(r));for(const k of ['NODE_ENV','PRIME_DELIVERY_TOKEN_SYNTHETIC'])if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}
});
