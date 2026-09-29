const test=require('node:test');
const assert=require('node:assert/strict');
const {requirePartnerWorkAgreement,requirePartnerPayableLineage}=require('../apps/api/dist/routes/partner-financial-lineage');
const approved={agreement_id:'agreement',agreement_status:'effective',execution_model:'partner',organization_id:'partner',work_organization_id:'partner',capacity_provider_id:'provider',work_provider_id:'provider',executed_at:'2026-01-01',artifact_verified_at:'2026-01-01',artifact_file_object_id:'file',effective_for_work:true};
const db=row=>({query:async()=>({rows:row?[row]:[]})});
test('partner settlement requires verified agreement and correct workforce, party and work date',async()=>{
 for(const row of [null,{...approved,execution_model:'internal'},{...approved,organization_id:'other'},{...approved,work_provider_id:'other'},{...approved,agreement_status:'draft'},{...approved,artifact_verified_at:null},{...approved,effective_for_work:false}]){
  await assert.rejects(requirePartnerWorkAgreement(db(row),'tenant','production','partner','provider'));
 }
 assert.equal(await requirePartnerWorkAgreement(db(approved),'tenant','production','partner','provider'),'agreement');
 assert.equal(await requirePartnerWorkAgreement(db({...approved,agreement_status:'superseded'}),'tenant','production','partner','provider'),'agreement');
});
test('payment cannot use a payable without traceable active settlement items',async()=>{
 await assert.rejects(requirePartnerPayableLineage(db(null),'tenant',{}),/lineage/);
 await assert.rejects(requirePartnerPayableLineage(db(null),'tenant',{settlement_id:'s',partner_organization_id:'p',capacity_provider_id:'c'}),/no active/);
 await assert.rejects(requirePartnerPayableLineage(db({production_record_id:'work',partner_organization_id:'other',capacity_provider_id:'c'}),'tenant',{settlement_id:'s',partner_organization_id:'p',capacity_provider_id:'c'}),/same partner/);
});
