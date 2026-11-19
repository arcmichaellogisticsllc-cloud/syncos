const test=require('node:test');const assert=require('node:assert/strict');
const {assertQuantityRelationship,productionQuantityFingerprint,requireReviewedProductionQuantity}=require('../apps/api/dist/routes/production-quantity-integrity');
test('886 installed feet can include 180 rock without adding another installed quantity',()=>{
 assert.doesNotThrow(()=>assertQuantityRelationship('included_subset',180,[886]));
 assert.throws(()=>assertQuantityRelationship('included_subset',887,[886]),/cannot exceed/);
 assert.throws(()=>assertQuantityRelationship('included_subset',180,[886,886]),/one work item/);
});
test('overlapping summaries must exactly reconcile to distinct underlying records',()=>{
 assert.doesNotThrow(()=>assertQuantityRelationship('summary',548,[404,144]));
 assert.doesNotThrow(()=>assertQuantityRelationship('summary',7815,[7411,404]));
 assert.throws(()=>assertQuantityRelationship('summary',7959,[7411,404]),/reconcile/);
 assert.throws(()=>assertQuantityRelationship('additional_work',180,[886]),/already covered/);
});
test('date, quantity, location and submitted correction revisions invalidate quantity review',()=>{
 const original={id:'work',work_order_id:'wo',crew_id:'crew',production_date:'2026-09-29',quantity_submitted:886,unit:'LF',from_asset_identifier:'A',to_asset_identifier:'B'};
 for(const change of [{quantity_submitted:1066},{production_date:'2026-09-28'},{to_asset_identifier:'C'},{quantity_revision_ids:['revision-2']}])assert.notEqual(productionQuantityFingerprint(original),productionQuantityFingerprint({...original,...change}));
 assert.equal(productionQuantityFingerprint(original),productionQuantityFingerprint({...original,production_date:new Date('2026-09-29T00:00:00Z')}));
});
test('unreviewed, stale and summary quantities cannot advance to finance',async()=>{
 const record={id:'work',quantity_submitted:886,quantity_review_id:'review'};
 let review;
 const client={query:async sql=>({rows:sql.includes('FROM production_records')?[record]:sql.includes('FROM production_quantity_reviews')&&review?[review]:[]})};
 await assert.rejects(requireReviewedProductionQuantity(client,'tenant','work'),/Review the current/);
 review={disposition:'primary_work',source_fingerprint:productionQuantityFingerprint(record)};
 await requireReviewedProductionQuantity(client,'tenant','work');
 review.disposition='summary';await assert.rejects(requireReviewedProductionQuantity(client,'tenant','work'),/not additional billable/);
 review.disposition='primary_work';record.quantity_submitted=1066;await assert.rejects(requireReviewedProductionQuantity(client,'tenant','work'),/Review the current/);
});
test('an underlying correction invalidates the subset review without rewriting originals',async()=>{
 const {quantityReviewFingerprint,quantityReviewCurrent}=require('../apps/api/dist/routes/production-quantity-integrity');
 const parent={id:'parent',quantity_submitted:886,quantity_review_id:'parent-review'};
 const child={id:'child',quantity_submitted:180,quantity_review_id:'child-review'};
 const parentReview={disposition:'primary_work',source_fingerprint:productionQuantityFingerprint(parent)};
 const c={query:async(sql,params)=>({rows:sql.includes('FROM production_records')?[params[1]==='parent'?parent:child]:sql.includes('FROM production_quantity_reviews')?[parentReview]:[]})};
 const review={disposition:'included_subset',related_record_ids:['parent'],source_fingerprint:await quantityReviewFingerprint(c,'tenant',child,['parent'])};
 assert.equal(await quantityReviewCurrent(c,'tenant',child,review),true);
 parent.quantity_submitted=100;parentReview.source_fingerprint=productionQuantityFingerprint(parent);
 assert.equal(await quantityReviewCurrent(c,'tenant',child,review),false);assert.equal(child.quantity_submitted,180);
 assert.throws(()=>assertQuantityRelationship('summary',180,[NaN]),/finite/);
});
test('field production responses exclude internal quantity-review notes and commercial references',()=>{
 const {SyncfieldController}=require('../apps/api/dist/routes/syncfield.controller');
 const result=new SyncfieldController({},{}).safeProductionRecord({id:'record',quantity_submitted:886,quantity_review:{id:'review',disposition:'primary_work',canonical_reference:'pole-1',related_record_ids:[],source_reference:'PRIVATE COMMERCIAL SOURCE',review_notes:'PRIVATE REVIEW NOTES'},quantity_review_current:true});
 assert.equal(result.quantity_review.disposition,'primary_work');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
