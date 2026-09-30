"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Capability, useCapability } from '../access-control';
import { syncosFetch } from '../intelligence/api';
type Preview={preview_fingerprint:string;contract:{name:string;contract_number?:string};rates:Array<{id:string;code:string;unit:string;amount:number;customer_rate?:number;contractor_rate?:number}>;revisions:Array<{id:string;party_type:string;revision_number:number;payment_days:number;payment_trigger:string;retainage_percent:number;source_reference:string}>};
export function CommercialTerms() {
 const canRead=useCapability('contract.read');
 const [schedules,setSchedules]=useState<Array<{id:string;name:string;organization_name:string}>>([]),[id,setId]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[party,setParty]=useState('customer'),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
 const requestKey=useRef('');
 useEffect(()=>{if(!canRead)return;let alive=true;syncosFetch<{schedules:typeof schedules}>('commercial-terms/choices').then(v=>{if(alive)setSchedules(v.schedules);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[canRead,reload]);
 useEffect(()=>{setPreview(null);requestKey.current='';if(!id)return;let alive=true;setLoading(true);syncosFetch<Preview>(`commercial-terms/rate-schedules/${id}`).then(v=>{if(alive){setPreview(v);setError('');}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[id,reload]);
 async function approve(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy||!preview)return;setBusy(true);setError('');setMessage('');const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));if(!requestKey.current)requestKey.current=crypto.randomUUID();try{
  await syncosFetch(`commercial-terms/rate-schedules/${id}/approve`,{method:'POST',body:{...data,party_type:party,effective_until:data.effective_until||null,payment_days:Number(data.payment_days),retainage_percent:Number(data.retainage_percent),verified:data.verified==='on',preview_fingerprint:preview.preview_fingerprint,client_mutation_id:requestKey.current}});
  requestKey.current='';setMessage('Agreement revision approved. Existing financial records retain their original pricing.');setReload(v=>v+1);
 }catch(e){setError((e as Error).message+' Your entries are preserved.');}finally{setBusy(false);}}
 if(!canRead)return null;
 return <section className="workspace-panel"><h2>Approved agreement terms</h2><p>Review the executed agreement and pricing addendum. Approvals preserve the rates shown below and determine retainage and when payment becomes due.</p>
 <label>Agreement rate schedule<select aria-label="Agreement rate schedule" value={id} disabled={busy} onChange={e=>{setId(e.target.value);setMessage('');}} style={{minHeight:44}}><option value="">Choose an agreement</option>{schedules.map(s=><option key={s.id} value={s.id}>{s.organization_name} · {s.name}</option>)}</select></label>
 {!schedules.length&&<p>No active contract-linked schedules are available. Add the executed contract and its rate schedule in Contracts before approval.</p>}
 <button type="button" disabled={busy||loading} onClick={()=>setReload(v=>v+1)}>Refresh agreement preview</button>
 {loading&&<p role="status">Loading agreement and rates…</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {preview&&<><h3>{preview.contract.name}</h3><p>{preview.contract.contract_number}</p>
 <Capability permission="contract.update"><form onSubmit={approve} onChange={()=>{if(!busy)requestKey.current='';}}><fieldset disabled={busy||loading} style={{border:0,padding:0,minWidth:0}}><div className="form-grid">
 <label>Agreement party<select name="party_type" value={party} onChange={e=>setParty(e.target.value)}><option value="customer">Customer</option><option value="partner">Partner contractor</option></select></label>
 <label>Payment clock starts at<select name="payment_trigger" required defaultValue=""><option value="">Choose the contract trigger</option><option value="invoice_issue">Invoice issue</option><option value="invoice_delivery">Invoice delivery</option><option value="invoice_acceptance">Invoice acceptance</option>{party==='partner'&&<option value="customer_payment">Customer payment</option>}</select></label>
 <label>Calendar days after trigger<input name="payment_days" type="number" min="0" max="3660" step="1" required /></label>
 <label>Retainage percent<input name="retainage_percent" type="number" min="0" max="100" step="0.01" required /></label>
 <label>Work effective from<input name="effective_from" type="date" required /></label><label>Work effective through (optional)<input name="effective_until" type="date" /></label>
 <label>Agreement time zone<input name="time_zone" placeholder="America/New_York" required /></label>
 <label>Executed agreement and pricing source<input name="source_reference" required minLength={3} maxLength={2000}/></label></div>
 <h4>Rates included in this approval</h4><ul>{preview.rates.map(r=><li key={r.id}>{r.code} · {r.unit} · {(party==='customer'?(r.customer_rate??r.amount):r.contractor_rate)==null?'Missing rate — update the schedule before approval':`$${Number(party==='customer'?(r.customer_rate??r.amount):r.contractor_rate).toFixed(2)}`}</li>)}</ul>
 <label><input type="checkbox" name="verified" required/> I verified these terms and rates against the executed agreement and approved pricing.</label><button type="submit" disabled={busy||!preview.rates.length} style={{minHeight:44}}>{busy?'Approving…':'Approve agreement revision'}</button></fieldset></form></Capability>
 <h4>Approval history</h4>{preview.revisions.length?<ul>{preview.revisions.map(r=><li key={r.id}>{r.party_type} revision {r.revision_number}: {r.payment_days} days from {r.payment_trigger.replaceAll('_',' ')}; {r.retainage_percent}% retainage. Source: {r.source_reference}</li>)}</ul>:<p>No terms have been approved for this schedule.</p>}</>}
 </section>;
}
