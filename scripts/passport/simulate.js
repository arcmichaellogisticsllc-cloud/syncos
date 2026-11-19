'use strict';
const {mkdir,writeFile}=require('node:fs/promises');
const path=require('node:path');
const {fixture}=require('./fixture');
const {SimulationRepository,reconcile}=require('../../packages/passport');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function main(){
 const rows=[];
 for(const [name,change] of [
  ['Matched completed partner payment',()=>{}],
  ['Unmatched payment',f=>f.repository.state.mappings=[]],
  ['Payment amount differs',f=>f.transaction.amount='69.00'],
  ['Customer cash not cleared and allocated',f=>f.repository.state.payables['synthetic-payable'].cashClearedAndAllocated=false],
  ['Employee work excluded from partner payments',f=>f.repository.state.payables['synthetic-payable'].workforce='internal'],
  ['Payment still processing',f=>f.transaction.status='pending'],
 ]){
  const f=fixture();f.repository=new SimulationRepository(f.seed);change(f);
  const result=await reconcile(f.repository,f.binding,f.transaction);
  rows.push({scenario:name,...result,paidAmount:f.repository.state.payables['synthetic-payable'].paidAmount});
 }
 const f=fixture(), repository=new SimulationRepository(f.seed);
 await reconcile(repository,f.binding,f.transaction);
 rows.push({scenario:'Duplicate confirmation',...await reconcile(repository,f.binding,f.transaction),paidAmount:repository.state.payables['synthetic-payable'].paidAmount});
 rows.push({scenario:'Return after recorded payment',...await reconcile(repository,f.binding,{...f.transaction,status:'returned',version:2}),paidAmount:repository.state.payables['synthetic-payable'].paidAmount});
 const folder=path.resolve(process.argv[2]||'test-results/passport-simulation');await mkdir(folder,{recursive:true});
 await writeFile(path.join(folder,'results.json'),JSON.stringify({mode:'synthetic offline simulation',rows},null,2));
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SyncOS · Payment reconciliation preview</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f3f5f8;color:#172435;margin:0}main{max-width:960px;margin:auto;padding:24px}h1{font-size:clamp(1.7rem,5vw,2.5rem);line-height:1.2}header,article{background:white;border:1px solid #ccd5e0;border-radius:12px;padding:20px;margin-bottom:16px}p{max-width:70ch}.badge{font-weight:700;color:#374970}ul{padding-left:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:16px}h2{font-size:1.1rem;margin-top:0}.result{font-weight:700}footer{border-top:1px solid #ccd5e0;padding:16px 0}</style><main><header><p class="badge">SyncOS · Offline simulation</p><h1>Payment reconciliation</h1><p>Preview using invented records. These results do not represent payments made or changes to your application.</p><p>Live connection: <strong>Disabled</strong> · Payment sending: <strong>Disabled</strong></p></header><section class="grid" aria-label="Simulation scenarios">${rows.map(r=>`<article><h2>${escape(r.scenario)}</h2><p class="result">${escape(({recorded:'Recorded in simulation',exception:'Finance review needed',duplicate:'Duplicate ignored',pending:'Waiting for completion'})[r.outcome]||r.outcome)}</p>${r.reason?`<p>${escape(r.reason.replaceAll('_',' '))}</p>`:''}<p>Simulated paid balance: $${escape(r.paidAmount)}</p></article>`).join('')}</section><footer><h2>Next acceptance steps</h2><ul><li>Verify real sandbox payloads, authentication and completed/returned status meanings.</li><li>Wire durable storage, background processing and authorized finance screens into SyncOS.</li><li>Rehearse reconciliation and recovery before activating automatic recording.</li></ul></footer></main></html>`;
 await writeFile(path.join(folder,'index.html'),html);console.log(`Offline simulation: ${rows.length} scenarios. Report: ${path.join(folder,'index.html')}`);
}
main().catch(()=>{console.error('Simulation failed; no live integration was used.');process.exitCode=1;});
