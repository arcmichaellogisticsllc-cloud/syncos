"use client";
import {useEffect,useRef,useState} from 'react';
import {Capability} from '../access-control';
import {syncosFetch} from '../intelligence/api';
type Policy={id:string;revision_number:number;source_reference:string;duration:number;duration_unit:string;trigger_event:string;time_zone:string};
type Correction={id:string;status:string;partner_safe_instructions:string;deadline_status:string;due_at?:string;due_date?:string;deadline_time_zone?:string;responsible_name?:string;customer_received_at?:string};
type Data={work_order_version_id:string;can_manage:boolean;policies:Policy[];corrections:Correction[]};
export function CorrectionDeadlines({reportId,revision}:{reportId:string;revision:unknown}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const guard=useRef(false),pending=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{let active=true;setData(null);setError('');syncosFetch<Data>(`prime-correction-policies/reports/${reportId}`).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[reportId,revision]);
 async function save(path:string,body:Record<string,unknown>){
  if(guard.current)return;guard.current=true;setBusy(true);setError('');setMessage('');
  const key=JSON.stringify([path,body]);if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
  try{await syncosFetch(path,{method:'POST',body:{...body,client_mutation_id:pending.current.id}});pending.current=null;setData(await syncosFetch<Data>(`prime-correction-policies/reports/${reportId}`));setMessage('Saved. Review the deadline status below; customer acceptance remains a separate decision.');}
  catch(e){setError(e instanceof Error?e.message:'Unable to confirm; retry with the same entries.');}
  finally{setBusy(false);guard.current=false;}
 }
 return <section className="workspace-panel"><h2>Correction deadlines and ownership</h2>
 <p>Deadlines follow the approved prime policy and its original triggering event. A new policy does not reset scheduled deadlines.</p>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {!data&&!error&&<p role="status">Loading correction policy…</p>}
 {data&&!data.policies.length&&<p>No approved correction policy is recorded for this work order. Failed findings can still be recorded; their deadlines require policy review.</p>}
 {data?.policies.map(policy=><p key={policy.id}>Revision {policy.revision_number}: {policy.duration} {policy.duration_unit.replaceAll('_',' ')} from {policy.trigger_event.replaceAll('_',' ')} · {policy.time_zone} · Source: {policy.source_reference}</p>)}
 {data?.can_manage&&<Capability permission="customer_qc.decision_record"><details><summary>Approve a prime correction policy</summary>
 <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save(`prime-correction-policies/work-orders/${data.work_order_version_id}`,{duration:Number(f.get('duration')),duration_unit:f.get('duration_unit'),trigger_event:f.get('trigger_event'),time_zone:f.get('time_zone'),effective_from:f.get('effective_from'),effective_until:f.get('effective_until')||null,holidays:String(f.get('holidays')||'').split(/[\s,]+/).filter(Boolean),source_reference:f.get('source_reference'),verified:f.get('verified')==='on'});}}>
 <fieldset disabled={busy}><legend>Verified customer policy</legend>
 <label>Duration<input name="duration" type="number" min="0" max="3660" required/></label>
 <label>Duration unit<select name="duration_unit"><option value="hours">Elapsed hours</option><option value="calendar_days">Calendar days at the same local time</option><option value="business_days">Business days, Monday–Friday, at the same local time</option></select></label>
 <label>Clock starts at<select name="trigger_event"><option value="customer_received">Customer finding received</option><option value="decision_recorded">Decision recorded in SyncOS</option></select></label>
 <label>Policy time zone<input name="time_zone" placeholder="America/New_York" required/></label>
 <label>Effective from, with UTC offset<input name="effective_from" placeholder="2026-09-01T00:00:00-04:00" required/></label>
 <label>Effective until, optional<input name="effective_until" placeholder="2027-01-01T00:00:00-05:00"/></label>
 <label>Approved holiday dates, separated by commas<textarea name="holidays" placeholder="2026-11-26, 2026-12-25"/></label>
 <p>Day durations exclude the triggering day. Business days exclude Saturday, Sunday and the listed holidays. Enter only a rule that matches the approved policy.</p>
 <label>Governing policy and approval reference<input name="source_reference" required/></label>
 <label><input name="verified" type="checkbox" required/> I verified this rule and the holiday calendar against the approved prime policy.</label>
 <button>{busy?'Saving…':'Approve correction policy'}</button></fieldset></form></details></Capability>}
 {data?.corrections.map(c=><article key={c.id}><h3>{c.partner_safe_instructions}</h3><p>Status: {c.status.replaceAll('_',' ')} · Responsible: {c.responsible_name||'Owner review required'}</p><p>Deadline: {c.deadline_status==='scheduled'&&c.due_at?`${new Date(c.due_at).toLocaleString(undefined,{timeZone:c.deadline_time_zone})} (${c.deadline_time_zone})`:c.deadline_status.replaceAll('_',' ')}{c.deadline_status!=='scheduled'&&c.due_date?` · Historical manual date: ${c.due_date}`:''}</p>
 {!['resolved','cancelled'].includes(c.status)&&c.deadline_status!=='scheduled'&&<Capability permission="customer_qc.decision_record"><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save(`prime-correction-policies/corrections/${c.id}/schedule`,{customer_received_at:f.get('customer_received_at')||undefined,verified:f.get('verified')==='on'});}}><fieldset disabled={busy}><legend>Resolve deadline prerequisites</legend><label>Original customer finding received time, with UTC offset<input name="customer_received_at" defaultValue={c.customer_received_at??''} placeholder="2026-09-29T09:30:00-04:00" readOnly={Boolean(c.customer_received_at)}/></label><label><input type="checkbox" name="verified"/> I verified the received time against the customer source.</label><button>{busy?'Saving…':'Apply approved deadline policy'}</button></fieldset></form></Capability>}
 </article>)}
 </section>;
}
