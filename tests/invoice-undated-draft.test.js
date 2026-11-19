const test=require('node:test'),assert=require('node:assert/strict');
const {CashController}=require('../apps/api/dist/routes/cash.controller');
test('an invoice awaiting approved contractual timing keeps its balance without inventing an overdue date',()=>{
 const controller=new CashController({});
 const draft=controller.calculateReceivableState(null,100,0,'draft');
 assert.equal(draft.balance_amount,100);assert.equal(draft.aging_days,0);assert.equal(draft.collection_status,'not_due');
 const partial=controller.calculateReceivableState(null,100,25,'partially_paid');
 assert.equal(partial.balance_amount,75);assert.equal(partial.payment_status,'partially_paid');assert.equal(partial.collection_status,'not_due');
 assert.throws(()=>controller.calculateReceivableState('invalid-date',100,0,'draft'),/valid dates/);
});

test('invoice review accepts an undated draft without creating receivables or bypassing later approval',async()=>{
 const controller=new CashController({});let writes=0;
 const invoice={id:'synthetic',invoice_number:'SYNTHETIC',invoice_date:'2026-10-01',due_date:null,status:'draft',total_amount:100};
 controller.requireRoleAuthority=async()=>{};controller.requireRecord=async()=>invoice;controller.activeInvoiceItemCount=async()=>1;
 controller.write=async(_r,_a,_e,_t,fn)=>fn({query:async sql=>{assert.match(sql,/UPDATE invoices/);writes++;return {rows:[{...invoice,status:'ready_for_review'}]};}});
 const result=await controller.submitInvoiceForReview({auth:{tenantId:'synthetic',userId:'synthetic'}},invoice.id,{},'invoice.submit_review','invoice.review_submitted',true);
 assert.equal(result.afterState.status,'ready_for_review');assert.equal(writes,1);
 controller.activeInvoiceItemCount=async()=>0;
 await assert.rejects(controller.submitInvoiceForReview({auth:{tenantId:'synthetic',userId:'synthetic'}},invoice.id,{},'invoice.submit_review','invoice.review_submitted',true),/at least one item/);
 assert.equal(writes,1);
});
