"use client";
import {useState,useRef} from 'react';
import {syncosFetch} from '../intelligence/api';
type Request={id:string;request_type:string;description:string;status:string;response?:string};
export function SetupReview({organizationId}:{organizationId:string}){
 const [rows,setRows]=useState<Request[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const lock=useRef(false);
 const root=`partner-compliance/organizations/${encodeURIComponent(organizationId)}/setup-requests`;
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Review unavailable.');}finally{lock.current=false;setBusy(false);}}
 async function load(){setRows(await syncosFetch<Request[]>(root));}
 return <div><button className="operator-link" disabled={busy} onClick={()=>void run(load)}>Review equipment and capability declarations</button>{error&&<p role="alert">{error}</p>}{rows?.length===0&&<p>No declarations submitted.</p>}{rows?.map(row=><form key={row.id} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{await syncosFetch(`${root}/${row.id}/review`,{method:'POST',body:{status:data.get('status'),response:data.get('response')}});await load();});}}><fieldset disabled={busy}><legend>{row.request_type.replaceAll('_',' ')} · {row.status}</legend><p>{row.description}</p><p>Recording a declaration does not verify capacity, transfer equipment custody, or authorize mobilization.</p><label>Review status<select name="status" defaultValue={row.status==='submitted'?'under_review':row.status}><option value="under_review">Under review</option><option value="action_required">Partner action required</option><option value="recorded">Declaration recorded</option></select></label><label>Response and next action<textarea name="response" required maxLength={4000} defaultValue={row.response??''}/></label><button>Save review response</button></fieldset></form>)}</div>;
}
