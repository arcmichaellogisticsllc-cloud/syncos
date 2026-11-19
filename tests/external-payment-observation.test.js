const test=require('node:test');const assert=require('node:assert/strict');
const {normalizePaymentObservation}=require('../apps/api/dist/routes/external-payment-observation');
const valid={provider:'passport',account_reference:'account-A',transaction_reference:'transaction-1',payee_reference:'partner-A',amount:'100.00',currency:'USD',observed_status:'completed',completed_date:'2026-09-29'};
test('observation identity is deterministic and raw provider payload is excluded',()=>{
 const a=normalizePaymentObservation(valid,'2026-09-29');const b=normalizePaymentObservation({...valid,raw_body:{secret:'ignored'}},'2026-09-29');assert.deepEqual(a,b);assert.equal(a.fingerprint.length,64);
 for(const patch of [{amount:'100.01'},{payee_reference:'other'},{observed_status:'reversed'}])assert.notEqual(normalizePaymentObservation({...valid,...patch},'2026-09-29').fingerprint,a.fingerprint);
});
test('observations reject invalid money, identity, completion dates and currency',()=>{
 for(const patch of [{amount:100},{amount:'1e2'},{amount:'0.00'},{amount:'100.001'},{completed_date:'2026-02-30'},{completed_date:'2026-09-30'},{completed_date:null},{currency:'usd'},{account_reference:'<script>'}])assert.throws(()=>normalizePaymentObservation({...valid,...patch},'2026-09-29'));
});
