import { expect,type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
const { requireRecordWorkAuthorization } = require('../../../apps/api/dist/routes/record-work-authorization');
import { acknowledgeFixtureJsa,safetyActor } from './individual-safety';

// Invoked against independently provisioned Sync and partner crew fixtures.
export async function verifySafetyLifecycle(request:APIRequestContext,tenant:string,version:string,foreman:string,date:string){
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const wo=(await db.query('SELECT work_order_id,assigned_crew_id FROM partner_work_order_versions WHERE tenant_id=$1 AND id=$2',[tenant,version])).rows[0];
  const ops=await safetyActor(tenant,'operations_manager'),safety=await safetyActor(tenant,'safety_manager');
  async function post(token:string,path:string,data:any,status=201){const r=await request.post(`${process.env.API_BASE_URL}/${path}`,{headers:{authorization:`Bearer ${token}`},data});expect(r.status(),await r.text()).toBe(status);return r.json();}
  async function current(){const r=await request.get(`${process.env.API_BASE_URL}/syncfield/foreman/jsa/today?work_date=${date}`,{headers:{authorization:`Bearer ${foreman}`}});expect(r.ok(),await r.text()).toBe(true);return r.json();}
  // A deliberate missing mutation id lets the test inspect the gate without adding work.
  async function probe(blocker:string){const r=await request.post(`${process.env.API_BASE_URL}/syncfield/foreman/production/records`,{headers:{authorization:`Bearer ${foreman}`},data:{work_date:date}});expect(r.status()).toBe(400);expect(await r.text()).toContain(blocker);
   await db.query('BEGIN');
   try{
    const input={tenant_id:tenant,work_order_id:wo.work_order_id,crew_id:wo.assigned_crew_id,work_order_version_id:version,production_date:date};
    if(blocker==='clientMutationId is required')expect((await requireRecordWorkAuthorization(db,input)).work_order_version_id).toBe(version);
    else await expect(requireRecordWorkAuthorization(db,input)).rejects.toThrow(blocker);
   }finally{await db.query('ROLLBACK');}
  }
  let jsa=await current();
  await post(foreman,`work-safety/jsas/${jsa.id}/acknowledge`,{confirmed:true,revision_number:jsa.revision_number-1},400);
  await post(foreman,`work-safety/jsas/${jsa.id}/acknowledge`,{confirmed:true,revision_number:jsa.revision_number,worker_id:jsa.foreman_worker_id},400);
  await post(foreman,`work-safety/work-orders/${version}/scope-review`,{pre_bore_required:false,evidence_reference:'SYNTHETIC unauthorized override'},403);
  await post(ops,`work-safety/work-orders/${version}/scope-review`,{pre_bore_required:true,evidence_reference:'SYNTHETIC underground safety requirement'});
  await probe('pre_bore_supervisor_approval_required');
  async function approve(token:string,id:string,kind:string){
   const body={approval_kind:kind,approver_name:`Synthetic ${kind}`,approved_at:new Date().toISOString(),evidence_reference:`SYNTHETIC-${id}-${kind}`,verified:true};
   const first=await post(token,`work-safety/controls/${id}/approvals`,body);
   await post(token,`work-safety/controls/${id}/approvals`,body); // retry final approvals too
   expect((await db.query('SELECT count(*)::int AS n FROM work_safety_approvals WHERE tenant_id=$1 AND control_id=$2 AND approval_kind=$3',[tenant,id,kind])).rows[0].n).toBe(1);
   await post(token,`work-safety/controls/${id}/approvals`,{...body,evidence_reference:'changed'},400);
   return first;
  }
  const pre=await post(foreman,'work-safety/pre-bore',{daily_jsa_id:jsa.id,reason:'SYNTHETIC inspection evidence'});
  expect((await post(foreman,'work-safety/pre-bore',{daily_jsa_id:jsa.id,reason:'SYNTHETIC inspection evidence'})).id).toBe(pre.id);
  await post(foreman,`work-safety/controls/${pre.id}/approvals`,{approval_kind:'construction_supervisor'},403);
  await approve(ops,pre.id,'construction_supervisor');
  await probe('clientMutationId is required');
  await post(ops,`work-safety/controls/${pre.id}/revoke-pre-bore`,{reason:'SYNTHETIC changed conditions'});
  await probe('pre_bore_supervisor_approval_required');
  const next=await post(foreman,'work-safety/pre-bore',{daily_jsa_id:jsa.id,reason:'SYNTHETIC reinspection'});
  expect(next.id).not.toBe(pre.id);await approve(ops,next.id,'construction_supervisor');
  const stop=await post(safety,'work-safety/stops',{work_order_id:wo.work_order_id,work_location:'Synthetic location',reason:'SYNTHETIC utility strike',utility_strike:true});
  await probe('applicable_safety_stop_active');
  await db.query('UPDATE work_safety_controls SET classification_review_required=true WHERE tenant_id=$1 AND id=$2',[tenant,stop.id]); // imported-state fixture
  await post(safety,`work-safety/controls/${stop.id}/approvals`,{approval_kind:'utility_owner'},400);
  await post(foreman,`work-safety/controls/${stop.id}/classify`,{utility_strike:false,evidence_reference:'Unauthorized'},403);
  await post(safety,`work-safety/controls/${stop.id}/classify`,{utility_strike:true,evidence_reference:'SYNTHETIC verified utility strike source'});
  await post(ops,`work-safety/controls/${stop.id}/approvals`,{approval_kind:'operations'},400);
  await post(foreman,'work-safety/stops',{work_order_id:wo.work_order_id,reason:'Unauthorized'},403);
  await approve(safety,stop.id,'utility_owner');await probe('applicable_safety_stop_active');
  await approve(safety,stop.id,'safety');await probe('applicable_safety_stop_active');
  expect((await approve(ops,stop.id,'operations')).status).toBe('released');
  await probe('jsa_review_after_shutdown_required');
  const revised=await post(foreman,'syncfield/foreman/jsa/today/revise',{work_date:date,prior_jsa_id:jsa.id,revision_reason:'SYNTHETIC approved restart review',work_location:'Synthetic restart location'});
  await post(foreman,`work-safety/jsas/${jsa.id}/acknowledge`,{confirmed:true,revision_number:jsa.revision_number},403);
  await post(foreman,'syncfield/foreman/jsa/today/complete',{work_date:date,work_location:'Synthetic restart location',hazards:['traffic'],controls:['ppe_reviewed','emergency_procedures_reviewed','stop_work_authority_reviewed'],foreman_certified:true});
  await probe('individual_jsa_acknowledgments_required');
  await acknowledgeFixtureJsa(request,tenant,revised.id);
  await probe('pre_bore_supervisor_approval_required'); // old location approval cannot carry forward
  const restart=await post(foreman,'work-safety/pre-bore',{daily_jsa_id:revised.id,reason:'SYNTHETIC restart inspection'});await approve(ops,restart.id,'construction_supervisor');
  await probe('clientMutationId is required');
  // Subsequent aerial workflow retains its approved aerial classification.
  await post(ops,`work-safety/work-orders/${version}/scope-review`,{pre_bore_required:false,evidence_reference:'SYNTHETIC subsequent aerial-only scope'});
 }finally{await db.end();}
}
