const test=require('node:test'),assert=require('node:assert/strict');
const {unzipSync,strFromU8}=require('node:module').createRequire(require.resolve('../apps/api/package.json'))('fflate');
const {requiredInvoiceDocuments,assertDeliveryTransition,buildInvoiceArchive,packageHash}=require('../apps/api/dist/routes/invoice-packages');
test('invoice delivery and acceptance remain separate ordered facts',()=>{
 assert.throws(()=>assertDeliveryTransition(null,'accepted'),/actual order/);
 assert.doesNotThrow(()=>assertDeliveryTransition(null,'delivered'));
 assert.doesNotThrow(()=>assertDeliveryTransition('delivered','rejected'));
 assert.throws(()=>assertDeliveryTransition('rejected','accepted'),/actual order/);
 assert.doesNotThrow(()=>assertDeliveryTransition('rejected','resubmitted'));
 assert.doesNotThrow(()=>assertDeliveryTransition('resubmitted','accepted'));
 assert.throws(()=>assertDeliveryTransition('accepted','delivered'),/actual order/);
});
test('prime requirements must be explicit, bounded and distinct',()=>{
 assert.deepEqual(requiredInvoiceDocuments([]),[]);
 assert.deepEqual(requiredInvoiceDocuments(['PO','Cover']),['Cover','PO']);
 for(const input of [null,[''],['PO','PO'],['PO',' PO '],Array(31).fill('a')])assert.throws(()=>requiredInvoiceDocuments(input));
});
test('package preserves original bytes, safe filenames and readable escaped invoice totals',()=>{
 const original=Buffer.from('%PDF-1.4\nSYNTHETIC original\n%%EOF');
 const facts={manifest:{invoice:{number:'<script>x</script>',customer:'Prime & co',subtotal:100,retainage:10,total:90,currency:'USD'},terms:{payment_days:14,payment_trigger:'invoice_acceptance'},items:[{description:'bore',quantity:20,unit:'LF',unit_rate:5,net:90}]},files:[{id:'evidence',file_name:'../../original.pdf',content_bytes:original}]};
 const zip=buildInvoiceArchive(facts),files=unzipSync(zip);
 assert.deepEqual(Buffer.from(files['evidence/evidence-.._.._original.pdf']),original);
 const html=strFromU8(files['invoice.html']);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/14 calendar days from invoice acceptance/);
 assert.equal(packageHash(Buffer.from(files['evidence/evidence-.._.._original.pdf'])),packageHash(original));
});
