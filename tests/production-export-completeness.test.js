const test=require('node:test');
const assert=require('node:assert/strict');
const {SyncfieldController}=require('../apps/api/dist/routes/syncfield.controller');

test('production PDF and report selectors retain every detail beyond legacy cutoffs',()=>{
 const controller=new SyncfieldController({},{});
 const rows=Array.from({length:125},(_,i)=>({daily_report_id:'report-'+i,work_date:'2026-10-05',code:'FIBER',description:'Fiber installed',reported_quantity:1,customer_accepted_quantity:1,customer_decision:'accepted',unit_of_measure:'FT',field_status:'complete',sequence_start:i,sequence_end:i+1,sequence_calculated_footage:1,sequence_reported_variance:0,sequence_variance_status:'matches',map_annotation_id:'annotation-'+i,annotation_type:'asset_point',x_ratio:0.5,y_ratio:0.5,span_completion_id:'span-'+i,span_from_asset_identifier:'A'+i,span_to_asset_identifier:'B'+i}));
 assert.equal(controller.recentReportSummaries(rows).length,125);
 const lines=controller.dailyProductionPdfLines(rows,'customer_qc_status');
 assert.equal(lines.filter(line=>line.startsWith('FIBER 1 FT field=')).length,125);
 const annotationLines=controller.annotatedMapPdfLines(rows,'customer_qc_status');
 assert.equal(annotationLines.filter(line=>line.startsWith('REDLINE ')).length,125);
 assert.equal(annotationLines.filter(line=>line.startsWith('FIBER ')).length,125);
 const long='Long source reference '+ 'x'.repeat(250)+' LAST-REFERENCE';
 const pdf=controller.createSimplePdf('Synthetic full production report',[...lines,long,'FINAL DETAIL 125 (verified) \\ original']);
 const text=pdf.toString('latin1');assert.ok((text.match(/\/Type \/Page\b/g)||[]).length>=4);assert.match(text,/LAST-REFERENCE/);assert.match(text,/FINAL DETAIL 125/);assert.match(text,/\\\(verified\\\)/);assert.match(text,/Page 4 of/);
 // Validate that byte offsets point to the declared objects, including every page.
 const xref=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(xref,xref+4),'xref');
 const entries=text.slice(xref).split('\n');const count=Number(entries[1].split(' ')[1]);for(let id=1;id<count;id++){const offset=Number(entries[id+2].slice(0,10));assert.ok(text.slice(offset).startsWith(id+' 0 obj'));}
});
