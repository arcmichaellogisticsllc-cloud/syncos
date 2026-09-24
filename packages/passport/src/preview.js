'use strict';
const {fixture}=require('./fixture');
const {SimulationRepository,reconcile}=require('./index');
async function buildPreview(){
 const rows=[];
 const scenarios=[
  ['matched','Example partner A','Matched to an approved payable',()=>{}],
  ['unmatched','Example partner B','Confirm the payment and payable references before matching.',f=>f.repository.state.mappings=[]],
  ['amount','Example partner C','Compare the provider amount with the payable amount.',f=>f.transaction.amount='69.00'],
  ['cash','Example partner D','Customer cash must be cleared and allocated before recording.',f=>f.repository.state.payables['synthetic-payable'].cashClearedAndAllocated=false],
  ['employee','Example Sync crew','Employee production cannot generate partner debt.',f=>f.repository.state.payables['synthetic-payable'].workforce='internal'],
  ['pending','Example partner E','Wait for authoritative completion from Passport.',f=>f.transaction.status='pending'],
  ['duplicate','Example partner F','The existing recording is preserved; no second payment is created.',()=>{}],
  ['returned','Example partner G','Review the provider return and prepare an audited adjustment.',()=>{}]
 ];
 for(const [key,partner,guidance,change] of scenarios){
  const f=fixture();f.repository=new SimulationRepository(f.seed);change(f);
  let result=await reconcile(f.repository,f.binding,f.transaction);
  if(key==='duplicate') result=await reconcile(f.repository,f.binding,f.transaction);
  if(key==='returned') result=await reconcile(f.repository,f.binding,{...f.transaction,status:'returned',version:2});
  rows.push({id:key,partner,reference:`EXAMPLE-${key.toUpperCase()}`,amount:f.transaction.amount,currency:f.transaction.currency,outcome:result.outcome,reason:result.reason||null,guidance,completedDate:f.transaction.status==='completed'?f.transaction.completedDate:null});
 }
 return {mode:'simulation',connectionStatus:'awaiting_sandbox',automaticRecordingEnabled:false,paymentSendingEnabled:false,lastSuccessfulSyncAt:null,rows};
}
module.exports={buildPreview};
