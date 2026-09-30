const test=require('node:test'),assert=require('node:assert/strict');
const {commercialTermsInput,approvedRateSnapshot,commercialPreviewFingerprint,rateFromTerms,invoiceTermsAmounts,contractualDueDate}=require('../apps/api/dist/routes/commercial-terms');
const approved={party_type:'customer',payment_trigger:'invoice_acceptance',payment_days:14,time_zone:'America/New_York',retainage_percent:10,effective_from:'2026-01-01',effective_until:null};
test('Net 14 starts at invoice acceptance, not issue, and preserves local time across daylight saving',()=>{
 const terms=commercialTermsInput(approved);
 assert.deepEqual(contractualDueDate(terms,null),{due_at:null,due_date:null});
 assert.deepEqual(contractualDueDate(terms,'2026-10-25T10:00:00-04:00'),{due_at:'2026-11-08T15:00:00.000Z',due_date:'2026-11-08'});
 assert.throws(()=>contractualDueDate(terms,'2026-10-25T10:00:00'),/UTC offset/);
});
test('unapproved or incomplete terms cannot silently become Net 30 or zero retainage',()=>{
 for(const change of [{payment_days:null},{payment_days:''},{payment_days:1.5},{retainage_percent:null},{retainage_percent:100.01},{retainage_percent:1.234},{payment_trigger:'customer_payment'},{time_zone:'wrong'},{effective_from:'2026-02-30'},{effective_until:'2025-01-01'}])assert.throws(()=>commercialTermsInput({...approved,...change}));
});
test('rate approval rejects overlapping unit aliases and snapshots immutable rates',()=>{
 const rows=[{id:'a',code:'BORE',unit:'FEET',amount:4,customer_rate:5,contractor_rate:3}];
 const rates=approvedRateSnapshot(rows,'customer');rows[0].customer_rate=999;
 assert.equal(rateFromTerms({id:'terms',rate_schedule_id:'schedule',rate_snapshot:rates},'BORE','LF').rate,5);
 assert.throws(()=>approvedRateSnapshot([...rows,{...rows[0],id:'b',unit:'LF'}],'customer'),/duplicate/);
 assert.throws(()=>approvedRateSnapshot([{...rows[0],contractor_rate:null}],'partner'),/positive/);
});
test('invoice retainage rounds at cents and never exceeds subtotal',()=>{
 assert.deepEqual(invoiceTermsAmounts(886*5,10),{subtotal:4430,retainage:443,total:3987});
 assert.deepEqual(invoiceTermsAmounts(0.05,10),{subtotal:0.05,retainage:0.01,total:0.04});
 assert.throws(()=>invoiceTermsAmounts(10,101));
});
test('approval preview detects any changed agreement or rate while ignoring rate ordering',()=>{
 const rates=[{id:'b',amount:10},{id:'a',amount:5}],c={id:'contract'},s={id:'schedule'};
 assert.equal(commercialPreviewFingerprint(c,s,rates),commercialPreviewFingerprint(c,s,[...rates].reverse()));
 assert.notEqual(commercialPreviewFingerprint(c,s,rates),commercialPreviewFingerprint(c,s,[{id:'b',amount:11},rates[1]]));
});

test('invoice integrity rejects changed quantities, prices, duplicate work and mismatched line retainage',async()=>{
 const {requireInvoiceCommercialIntegrity}=require('../apps/api/dist/routes/commercial-terms');
 const terms={id:'terms',party_type:'customer',counterparty_organization_id:'customer',retainage_percent:10};
 const line={quantity:10,unit:'LF',unit_rate:2,gross_amount:20,retainage_amount:2,net_amount:18};
 const billable={id:'billable',accepted_production_source_id:'source',customer_organization_id:'customer',billable_quantity:10,unit:'feet',unit_rate:2,net_billable_amount:20,invoice_line:line};
 const source={id:'source',customer_terms_revision_id:'terms',customer_rate:2,customer_extended_amount:20,accepted_quantity:10};
 const invoice={id:'invoice',commercial_terms_revision_id:'terms',subtotal_amount:20,total_amount:18,retainage_amount:2};
 let items=[billable];
 const client={query:async(sql)=>({rows:sql.includes('row_to_json(i)')?items:sql.includes('count(*)')?[{count:items.length}]:sql.includes('accepted_production_financial_sources')?[source]:[terms]})};
 assert.equal((await requireInvoiceCommercialIntegrity(client,'tenant',invoice)).id,'terms');
 await assert.rejects(()=>requireInvoiceCommercialIntegrity(client,'tenant',{...invoice,subtotal_amount:21}),/totals differ/);
 for(const change of [{quantity:11},{unit_rate:3},{gross_amount:21},{retainage_amount:1,net_amount:19},{net_amount:20}]){
  items=[{...billable,invoice_line:{...line,...change}}];await assert.rejects(()=>requireInvoiceCommercialIntegrity(client,'tenant',invoice),/Invoice line/);
 }
 items=[billable,billable];await assert.rejects(()=>requireInvoiceCommercialIntegrity(client,'tenant',invoice),/more than once/);
});
