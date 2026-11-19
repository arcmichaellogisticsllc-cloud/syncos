const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
for(const [name,scan] of Object.entries({startMobilizationExpirationScheduler:'runMobilizationExpirationScan',startPartnerPerformanceScheduler:'runPartnerPerformanceRecalculationScan',startOpportunityCapacityMatchingScheduler:'runOpportunityCapacityMatchingScan',startExecutiveCommandScheduler:'runExecutiveCommandRefreshScan'})){
 test(`${name} retries after connection failure and releases after scan failure`,async()=>{
  let tick,attempts=0,releases=0,scans=0;const exports={};const errors=[];
  const shared={[scan]:async()=>{scans++;if(scans===1)throw Error('scan failed');return {};}};
  const fakeRequire=n=>n==='pg'?{Pool:class{}}:n==='bullmq'?{Queue:class{},Worker:class{}}:shared;
  const code=ts.transpileModule(fs.readFileSync('apps/worker/src/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,module:{exports},require:fakeRequire,process:{env:{DATABASE_URL:'mock'}},URL,console:{log(){},error(e){errors.push(e);}},setInterval:fn=>{tick=fn;return {unref(){}}},clearInterval(){}});
  exports[name]({pool:{connect:async()=>{attempts++;if(attempts===1)throw Error('connection failed');return {release(){releases++;}};}}});
  await new Promise(r=>setImmediate(r));await tick();await tick();
  assert.equal(attempts,3);assert.equal(scans,2);assert.equal(releases,2);assert.equal(errors.length,2);
 });
}
