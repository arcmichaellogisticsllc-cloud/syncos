const test=require('node:test'),assert=require('node:assert/strict');
const {validateFormTemplate:template,validateFormAnswers:answers,visibleFormFields}=require('../packages/shared/form-schema');
const schema=template({name:'Supplemental inspection',fields:[{key:'damage',label:'Damage?',type:'checkbox',required:true},{key:'detail',label:'Describe damage',type:'textarea',required:true,showWhen:{key:'damage',equals:true}},{key:'date',label:'Date',type:'date',required:false}]});
test('shared forms enforce conditional required fields and reject hidden or unknown values',()=>{
 assert.deepEqual(answers(schema,{damage:false}),{damage:false});
 assert.throws(()=>answers(schema,{damage:true}),/Describe damage/);
 assert.throws(()=>answers(schema,{damage:false,detail:'hidden'}),/hidden/);
 assert.throws(()=>answers(schema,{damage:false,other:'unknown'}),/unknown/);
 assert.deepEqual(answers(schema,{damage:true,detail:'Documented'}),{damage:true,detail:'Documented'});
 assert.equal(visibleFormFields(schema,{damage:false}).length,2);
});
test('shared forms reject invalid dates, types, conditions and duplicate keys',()=>{
 assert.throws(()=>answers(schema,{damage:'false'}),/yes or no/);
 assert.throws(()=>answers(schema,{damage:false,date:'2026-02-30'}),/valid date/);
 assert.throws(()=>template({name:'Invalid',fields:[schema.fields[1],schema.fields[0]]}),/earlier/);
 assert.throws(()=>template({name:'Duplicate',fields:[schema.fields[0],schema.fields[0]]}),/unique/);
 assert.throws(()=>template({name:'Unsupported',fields:[{key:'exec',type:'script',label:'Script'}]}),/Unsupported/);
 const numeric=template({name:'Number',fields:[{key:'qty',label:'Quantity',type:'number'}]});
 assert.throws(()=>answers(numeric,{qty:Infinity}),/finite/);assert.throws(()=>answers(numeric,{qty:'1'}),/finite/);
});
