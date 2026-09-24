const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('../scripts/passport/fixture');
const {money,normalize,reconcile,SimulationRepository,receiveWebhook,poll,sandboxReader}=require('../packages/passport');
const setup=()=>{const f=fixture();return {...f,repository:new SimulationRepository(f.seed)};};
test('whole-cent amounts use exact arithmetic and reject unsafe inputs',()=>{
 assert.equal(money('70.01'),7001n);
 for(const amount of ['1e2','1.001','-1.00','Infinity',1.01,'01.00','1'])assert.throws(()=>money(amount));
});
test('allowlisted normalization discards sensitive extra fields',()=>{
 const f=fixture();assert.equal(normalize({...f.transaction,bankAccount:'PRIVATE'}).bankAccount,undefined);
 assert.throws(()=>normalize({...f.transaction,status:'UNKNOWN'}));
 assert.throws(()=>normalize({...f.transaction,completedDate:'2026-02-30'}));
 assert.throws(()=>normalize({...f.transaction,direction:'incoming'}));
});
test('disabled reconciliation cannot touch repository',async()=>{
 const f=setup();await assert.rejects(reconcile(f.repository,{...f.binding,mode:'production'},f.transaction));assert.deepEqual(f.repository.state.audit,[]);
});
test('parallel webhook/poll replay records one payment with exact balance and provenance',async()=>{
 const f=setup();const r=await Promise.all(Array.from({length:20},()=>reconcile(f.repository,f.binding,f.transaction)));
 assert.equal(r.filter(x=>x.outcome==='recorded').length,1);assert.equal(f.repository.state.payables['synthetic-payable'].paidAmount,'70.00');assert.equal(f.repository.state.audit.length,1);
 assert.equal(Object.values(f.repository.state.recordings)[0].source,'passport_simulation');
});
for(const [reason,modify] of [
 ['unmatched_payment',f=>f.repository.state.mappings=[]],
 ['ambiguous_mapping',f=>f.repository.state.mappings.push({...f.repository.state.mappings[0]})],
 ['payee_or_tenant_mismatch',f=>f.repository.state.payables['synthetic-payable'].tenantId='other'],
 ['payee_or_tenant_mismatch',f=>f.transaction.payeeId='wrong-partner'],
 ['employee_work_not_partner_debt',f=>f.repository.state.payables['synthetic-payable'].workforce='internal'],
 ['amount_or_currency_mismatch',f=>f.transaction.amount='69.00'],
 ['amount_or_currency_mismatch',f=>f.transaction.currency='EUR'],
 ['payable_not_eligible',f=>f.repository.state.payables['synthetic-payable'].accepted=false],
 ['payable_not_eligible',f=>f.repository.state.payables['synthetic-payable'].approved=false],
 ['payable_not_eligible',f=>f.repository.state.payables['synthetic-payable'].cashClearedAndAllocated=false],
 ['exceeds_available_balance',f=>f.repository.state.payables['synthetic-payable'].inFlightAmount='1.00'],
 ['already_recorded_manually',f=>f.repository.state.manualReferences.push({tenantId:f.binding.tenantId,customerId:f.binding.customerId,transactionId:f.transaction.transactionId})],
 ['future_completion_date',f=>f.transaction.completedDate='2999-01-01'],
])test(`exception preserves payable: ${reason}`,async()=>{
 const f=setup();modify(f);assert.equal((await reconcile(f.repository,f.binding,f.transaction)).reason,reason);assert.equal(f.repository.state.payables['synthetic-payable'].paidAmount,'0.00');assert.equal(Object.keys(f.repository.state.recordings).length,0);
});
test('wrong provider account is rejected before storage',async()=>{
 const f=setup();await assert.rejects(reconcile(f.repository,f.binding,{...f.transaction,accountId:'other'}));assert.equal(Object.keys(f.repository.state.observations).length,0);
});
test('pending then completed then stale pending does not undo recording',async()=>{
 const f=setup();assert.equal((await reconcile(f.repository,f.binding,{...f.transaction,status:'pending'})).outcome,'pending');
 assert.equal((await reconcile(f.repository,f.binding,{...f.transaction,version:2})).outcome,'recorded');
 assert.equal((await reconcile(f.repository,f.binding,{...f.transaction,status:'pending'})).outcome,'stale');
});
test('same version with different amount requires review',async()=>{
 const f=setup();await reconcile(f.repository,f.binding,f.transaction);assert.equal((await reconcile(f.repository,f.binding,{...f.transaction,amount:'69.00'})).reason,'conflicting_same_version');
});
for(const status of ['failed','returned','reversed'])test(`${status} after recording creates exception without silently rewriting money`,async()=>{
 const f=setup();await reconcile(f.repository,f.binding,f.transaction);const changed={...f.transaction,status,version:2};await reconcile(f.repository,f.binding,changed);await reconcile(f.repository,f.binding,changed);
 assert.equal(f.repository.state.payables['synthetic-payable'].paidAmount,'70.00');assert.equal(Object.values(f.repository.state.exceptions).length,1);assert.equal(f.repository.state.audit.length,1);
});
test('new payee on recorded transaction requires review',async()=>{
 const f=setup();await reconcile(f.repository,f.binding,f.transaction);assert.equal((await reconcile(f.repository,f.binding,{...f.transaction,payeeId:'other',version:2})).reason,'recorded_payment_changed');
});
test('exception replay can resolve after mapping is explicitly fixed',async()=>{
 const f=setup(), mappings=f.repository.state.mappings;f.repository.state.mappings=[];await reconcile(f.repository,f.binding,f.transaction);f.repository.state.mappings=mappings;
 assert.equal((await reconcile(f.repository,f.binding,f.transaction)).outcome,'recorded');assert.equal(Object.values(f.repository.state.exceptions)[0].status,'resolved_by_reconciliation');
});
test('exceptions are tenant-scoped and finance-only',async()=>{
 const f=setup();f.repository.state.mappings=[];await reconcile(f.repository,f.binding,f.transaction);assert.throws(()=>f.repository.exceptionsFor(f.binding.tenantId,[]));assert.deepEqual(f.repository.exceptionsFor('other',['partner_payment.confirm']),[]);assert.equal(f.repository.exceptionsFor(f.binding.tenantId,['partner_payment.confirm']).length,1);
});
test('simulation transaction rolls back all writes on failure',async()=>{
 const f=setup();await assert.rejects(f.repository.transaction(state=>{state.audit.push({bad:true});throw Error('fail');}));assert.equal(f.repository.state.audit.length,0);
});
test('webhook verification is mandatory and payload cannot supply financial writes',async()=>{
 const f=setup(), hints=[];const args={rawBody:Buffer.from('{}'),headers:{},binding:f.binding,decode:()=>({...f.transaction,amount:'999.00'}),enqueue:x=>hints.push(x)};
 await assert.rejects(receiveWebhook(args));await assert.rejects(receiveWebhook({...args,verify:()=>false}));assert.equal(hints.length,0);
 await receiveWebhook({...args,verify:()=>true});assert.deepEqual(Object.keys(hints[0]).sort(),['customerId','tenantId','transactionId']);
 await assert.rejects(receiveWebhook({...args,verify:()=>true,decode:()=>({customerId:'other',transactionId:'x'})}));
});
test('poll retry after outage resumes cursor and duplicate items are harmless',async()=>{
 const f=setup();let fail=true;const listPage=async cursor=>{if(cursor==='page2'&&fail)throw Error('outage');return cursor==='page2'?{items:[f.transaction],done:true,nextCursor:'next-run'}:{items:[f.transaction],done:false,nextCursor:'page2'};};
 await assert.rejects(poll({...f,listPage}));assert.equal(Object.values(f.repository.state.checkpoints)[0],'page2');fail=false;await poll({...f,listPage});assert.equal(f.repository.state.audit.length,1);assert.equal(Object.values(f.repository.state.checkpoints)[0],'next-run');
});
test('page normalization failure does not advance checkpoint',async()=>{
 const f=setup();await assert.rejects(poll({...f,listPage:async()=>({items:[f.transaction,{...f.transaction,status:'unknown'}],done:true,nextCursor:'unsafe'})}));assert.deepEqual(f.repository.state.checkpoints,{});
});
test('repeated cursors terminate safely',async()=>{
 const f=setup();await assert.rejects(poll({...f,listPage:async()=>({items:[],done:false,nextCursor:'same'})}),/Repeated/);
});
test('sandbox reader defaults off; enabled reader only makes fixed-host GET',async()=>{
 let calls=0;const fetchImpl=async(url,options)=>{calls++;assert.match(url,/^https:\/\/sandbox-api.prioritycommerce.com\/v1\/passport\/v1\/customer\/id\/c\/transaction\/id\/t$/);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({id:'t'})};};
 await assert.rejects(sandboxReader({apiKey:'fake',fetchImpl}).getTransaction('c','t'));assert.equal(calls,0);
 assert.deepEqual(await sandboxReader({enabled:true,apiKey:'fake',fetchImpl}).getTransaction('c','t'),{id:'t'});assert.equal(calls,1);
});
test('provider error bodies and credentials are not exposed',async()=>{
 const reader=sandboxReader({enabled:true,apiKey:'PRIVATE',fetchImpl:async()=>({ok:false,status:429,text:async()=>'PRIVATE'})});
 await assert.rejects(reader.getTransaction('c','t'),e=>e.retryable===true&&!e.message.includes('PRIVATE'));
});
test('concurrent distinct payments cannot exceed one eligible balance',async()=>{
 const f=setup();f.transaction.amount='40.00';f.repository.state.mappings[0].amount='40.00';
 f.repository.state.mappings.push({...f.repository.state.mappings[0],transactionId:'second'});
 const outcomes=await Promise.all([reconcile(f.repository,f.binding,f.transaction),reconcile(f.repository,f.binding,{...f.transaction,transactionId:'second'})]);
 assert.equal(outcomes.filter(r=>r.outcome==='recorded').length,1);assert.equal(outcomes.filter(r=>r.reason==='exceeds_available_balance').length,1);assert.equal(f.repository.state.payables['synthetic-payable'].paidAmount,'40.00');
});
test('failure before recording never credits paid balance and later completion is held for review',async()=>{
 const f=setup();assert.equal((await reconcile(f.repository,f.binding,{...f.transaction,status:'failed'})).reason,'provider_failed');
 assert.equal((await reconcile(f.repository,f.binding,{...f.transaction,version:2})).reason,'terminal_status_changed');assert.equal(f.repository.state.payables['synthetic-payable'].paidAmount,'0.00');
});
