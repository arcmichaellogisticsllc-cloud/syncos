const test=require('node:test');const assert=require('node:assert/strict');
const {summarizeReviewedProduction}=require('../apps/api/dist/routes/production-reporting');
const {productionQuantityFingerprint}=require('../apps/api/dist/routes/production-quantity-integrity');
test('operations quantities exclude references and stale reviews and keep feet separate from hours',()=>{
 const primary={id:'a',unit:'LF',quantity_submitted:886,review_disposition:'primary_work'};primary.review_fingerprint=productionQuantityFingerprint(primary);
 const labor={id:'b',unit:'HR',quantity_submitted:8,review_disposition:'primary_work'};labor.review_fingerprint=productionQuantityFingerprint(labor);
 const summary=summarizeReviewedProduction([primary,labor,{unit:'LF',quantity_submitted:180,review_disposition:'included_subset'},{unit:'LF',quantity_submitted:886,review_disposition:'summary'},{...primary,id:'stale'}, {unit:'LF',quantity_submitted:404}]);
 assert.deepEqual(summary.by_unit,[{unit:'HR',quantity:8,record_count:1},{unit:'LF',quantity:886,record_count:1}]);assert.equal(summary.pending_review_count,2);assert.equal(summary.excluded_reference_count,2);
});
