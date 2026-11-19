const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const path=require('node:path');const {createRequire}=require('node:module');
const apiRequire=createRequire(path.resolve('apps/api/src/routes/project-handoffs.controller.ts'));
const source=fs.readFileSync('apps/api/src/routes/project-handoffs.controller.ts','utf8');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{exports:exportsObject,require(name){if(name==='../modules/database.module')return {DATABASE_POOL:'pool'};if(name==='../security/require-permission.decorator')return {RequirePermission:()=>()=>{}};if(name==='./activity-pagination')return require('../apps/api/dist/routes/activity-pagination');if(name==='./intelligence.types')return {pick:(body,keys)=>Object.fromEntries(keys.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]))};return apiRequire(name);},Set,Date,Number,Object,String,Boolean,Array,Math});
const Controller=exportsObject.ProjectHandoffsController;
const request={auth:{tenantId:'tenant',userId:'user'}};
test('general handoff update cannot assign approval or project-created status',async()=>{
 const controller=new Controller({});controller.write=()=>{throw Error('Must not write');};
 for(const status of ['approved','project_created','ready_for_project'])await assert.rejects(controller.update(request,'handoff',{status}),/explicit handoff/);
});
test('general checklist/risk editing cannot weaken gates or finalize review',async()=>{
 const controller=new Controller({});controller.childUpdate=()=>{throw Error('Must not write');};
 for(const body of [{hard_stop:false},{required:false},{override_allowed:true},{status:'overridden'},{status:'complete'},{status:'not_applicable'}])await assert.rejects(controller.updateChecklist(request,'item',body));
 for(const body of [{hard_stop:false},{override_allowed:true},{status:'overridden'},{status:'resolved'}])await assert.rejects(controller.updateRisk(request,'risk',body));
});
test('explicit override still rejects hard stops and non-overridable records',async()=>{
 const controller=new Controller({});controller.write=async(_request,_action,_event,_entity,fn)=>fn({});controller.requireActiveHandoff=async()=>({});
 for(const gate of [{hard_stop:true,override_allowed:true},{hard_stop:false,override_allowed:false}]){
  controller.requireRecord=async()=>({...gate,project_handoff_id:'handoff'});
  await assert.rejects(controller.overrideChecklist(request,'item',{override_reason:'test'}),/cannot be overridden/);
  await assert.rejects(controller.overrideRisk(request,'risk',{override_reason:'test'}),/cannot be overridden/);
 }
});
