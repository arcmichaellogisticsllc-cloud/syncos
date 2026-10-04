const test=require('node:test'),assert=require('node:assert/strict');
const {retainedTermsInput,allocateRetainedRelease}=require('../apps/api/dist/routes/retained-fund-schedule');
const {contractualDueDate}=require('../apps/api/dist/routes/commercial-terms');
const terms={payment_trigger:'release_approval',payment_days:14,payment_day_basis:'calendar_days',time_zone:'America/New_York',verified:true,source_reference:'Executed agreement retainage clause'};
test('retained-fund terms never assume the regular payable clock',()=>{
 const approved=retainedTermsInput(terms);assert.equal(approved.payment_trigger,'release_approval');
 assert.equal(contractualDueDate(approved,'2026-10-01T10:00:00-04:00').due_date,'2026-10-15');
 for(const patch of [{payment_trigger:''},{payment_days:''},{verified:false},{source_reference:''},{payment_trigger:'customer_retainage_receipt'},{payment_day_basis:'business_days'}])assert.throws(()=>retainedTermsInput({...terms,...patch}));
});
test('nonapproval retained-fund triggers require a completed, timezone-qualified event and proof',()=>{
 const receipt={...terms,payment_trigger:'customer_retainage_receipt',trigger_occurred_at:'2026-09-01T12:00:00Z',trigger_proof_reference:'Cleared bank receipt'};
 assert.equal(retainedTermsInput(receipt).trigger_proof_reference,'Cleared bank receipt');
 for(const patch of [{trigger_occurred_at:'2099-01-01T12:00:00Z'},{trigger_occurred_at:'2026-09-01T12:00:00'},{trigger_proof_reference:''}])assert.throws(()=>retainedTermsInput({...receipt,...patch}));
});
test('partial retained releases conserve exact cents and cannot reuse previous releases',()=>{
 const items=[{id:'a',retainage_amount:'10.01',released_amount:'5.00'},{id:'b',retainage_amount:'20.02',released_amount:'0.00'}];
 assert.deepEqual(allocateRetainedRelease(items,15).map(r=>[r.item.id,r.amount]),[['a',5.01],['b',9.99]]);
 assert.throws(()=>allocateRetainedRelease(items,25.04),/exceeds/);
 assert.throws(()=>allocateRetainedRelease(items,0.001),/exact cent/);
 assert.throws(()=>allocateRetainedRelease([{retainage_amount:1,released_amount:2}],1),/Reconcile/);
});
