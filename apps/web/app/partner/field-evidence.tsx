"use client";
import { useEffect, useRef, useState } from "react";
import { syncosFetch } from "../intelligence/api";
import { evidenceScope, readEvidenceDraft, writeEvidenceDraft, type EvidenceDraft } from "./evidence-drafts";
export function FieldEvidence({ reportId, recordId, canUpload, onSaved }: { reportId: string; recordId?: string; canUpload: boolean; onSaved?: () => void }) {
 const [rows,setRows]=useState<{included_in_submission:boolean;included_in_customer_acceptance:boolean;id:string;file_name:string;description:string;readability_status:string;evidence_kind:string;captured_at?:string;created_at:string}[]>([]);
 const [readiness,setReadiness]=useState<{ready:boolean;missing:string[]}>();
 const [kind,setKind]=useState('other'),[captured,setCaptured]=useState(''),[location,setLocation]=useState('');
 const [file,setFile]=useState<File|null>(null), [description,setDescription]=useState("");
 const [draft,setDraft]=useState<EvidenceDraft>(), [busy,setBusy]=useState(false), [ready,setReady]=useState(false);
 const [message,setMessage]=useState(""), [error,setError]=useState("");
 const guard=useRef(false), input=useRef<HTMLInputElement>(null);
 async function load(){const [files,state]=await Promise.all([syncosFetch<typeof rows>(`syncfield/foreman/evidence?daily_report_id=${encodeURIComponent(reportId)}`),syncosFetch<{ready:boolean;missing:string[]}>(`syncfield/foreman/evidence-readiness?daily_report_id=${encodeURIComponent(reportId)}`)]);setRows(files);setReadiness(state);}
 useEffect(()=>{
   let active=true;setReady(false);setRows([]);setReadiness(undefined);if(input.current)input.current.value="";setDraft(undefined);setFile(null);setDescription("");setKind("other");setCaptured("");setLocation("");setMessage("");setError("");
   void Promise.resolve().then(()=>readEvidenceDraft(evidenceScope(reportId,recordId))).then(saved=>{if(active){setDraft(saved);setReady(true);}}).catch(e=>{if(active)setError(e.message);});
   void load().catch(()=>{if(active)setMessage("Saved evidence cannot be refreshed while disconnected.");});
   return ()=>{active=false;};
 },[reportId,recordId]);
 async function send(saved:EvidenceDraft){
   if(saved.scope!==evidenceScope(reportId,recordId))throw new Error("Sign in as the original crew member to retry this upload.");
   if(!navigator.onLine){setMessage("Saved on this device; not uploaded. Reconnect and choose Retry upload.");return;}
   const content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Could not read this file."));reader.readAsDataURL(saved.file);});
   await syncosFetch("syncfield/foreman/evidence",{method:"POST",body:{daily_report_id:saved.reportId,production_record_id:saved.recordId,file_name:saved.fileName,mime_type:saved.mimeType,description:saved.description,evidence_kind:saved.evidenceKind??'other',captured_at:saved.capturedAt,capture_location:saved.captureLocation,content_base64:content,client_mutation_id:saved.mutationId}});
   await writeEvidenceDraft(saved.scope);setDraft(undefined);setFile(null);setDescription("");setKind("other");setCaptured("");setLocation("");if(input.current)input.current.value="";
   setMessage("Evidence saved on the server.");onSaved?.();
   await load().catch(()=>setMessage("Evidence saved on the server. Refresh the list when connected."));
 }
 async function upload(){
   if(guard.current||!ready||!canUpload)return;guard.current=true;setBusy(true);setError("");setMessage("");
   try{
     let saved=draft;
     if(!saved){
       if(!file||!description.trim())throw new Error("Choose a file and describe the evidence.");
       if(file.size>20971520)throw new Error("Choose a file up to 20 MB.");
       saved={scope:evidenceScope(reportId,recordId),mutationId:crypto.randomUUID(),reportId,recordId,file,fileName:file.name,mimeType:file.type||(({heic:'image/heic',heif:'image/heif',mov:'video/quicktime'} as Record<string,string>)[file.name.split('.').pop()?.toLowerCase()??'']??''),evidenceKind:kind,capturedAt:captured?new Date(captured).toISOString():undefined,captureLocation:location.trim()||undefined,description:description.trim(),savedAt:new Date().toISOString()};
       await writeEvidenceDraft(saved.scope,saved);setDraft(saved);
     }
     await send(saved);
   }catch(e){setError(`${e instanceof Error?e.message:"Upload could not be confirmed."} If an upload is waiting, retry it when connected; the same evidence will not be recorded twice.`);}
   finally{guard.current=false;setBusy(false);}
 }
 return <section className="partner-panel" aria-label="Photos and evidence"><h3>Photos and evidence</h3>
   <p>JPEG, PNG, HEIC, HEIF, PDF, MP4 or MOV, up to 20 MB. HEIC and MOV originals may require a compatible viewer. Keep your original files until upload is confirmed. Uploading does not change quantities or imply acceptance.</p>
   {readiness&&<div role="status">{readiness.ready?'Required uploads are present. Readability review and customer acceptance remain separate.':readiness.missing.map(item=><p key={item}>{item.replaceAll('_',' ')}</p>)}</div>}
   {rows.map(row=><div key={row.id}><p>{row.file_name} — {row.description}</p><p>{row.evidence_kind?.replaceAll('_',' ')} · uploaded {new Date(row.created_at).toLocaleString()} · {row.readability_status}. {row.included_in_submission?'Included in a submitted revision.':'Not yet included in a submitted revision.'} {row.included_in_customer_acceptance?'Included in recorded customer acceptance; see QC history.':'No recorded customer acceptance for this file.'} Capture: {row.captured_at?new Date(row.captured_at).toLocaleString():'not supplied'}</p><button type="button" className="partner-button" onClick={async()=>{try{const downloaded=await syncosFetch<{content_base64:string;mime_type:string;file_name:string}>(`syncfield/foreman/evidence/${row.id}`);const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(downloaded.content_base64),c=>c.charCodeAt(0))],{type:downloaded.mime_type}));const link=document.createElement("a");link.href=url;link.download=downloaded.file_name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:"Unable to download evidence.");}}}>Download {row.file_name}</button></div>)}
   {canUpload && (draft?<div><p role="status">Waiting for confirmation: {draft.fileName} — {draft.description}. This upload is saved on this device.</p><button type="button" disabled={busy} className="partner-button wide-touch" onClick={()=>void upload()}>{busy?"Uploading…":"Retry upload"}</button><button type="button" disabled={busy} className="partner-button" onClick={async()=>{if(!window.confirm("Discard this device's pending copy? Keep your original file. If the server already received this upload, its evidence record remains."))return;try{await writeEvidenceDraft(draft.scope);setDraft(undefined);setFile(null);setDescription("");setKind("other");setCaptured("");setLocation("");setError("");setMessage("Pending device copy removed. Server evidence is unchanged.");}catch(e){setError(e instanceof Error?e.message:"Unable to remove the device copy.");}}}>Discard device copy</button></div>:<form className="partner-form-grid" onSubmit={e=>{e.preventDefault();void upload();}}>
     <label>Evidence file<input ref={input} required disabled={busy||!ready} type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf,video/mp4,video/quicktime,.heic,.heif,.mov" onChange={e=>{const selected=e.target.files?.[0]??null;setFile(selected);if(selected){const date=new Date(selected.lastModified);setCaptured(new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19));}}} /></label>
     <label>Evidence category<select disabled={busy||!ready} value={kind} onChange={e=>setKind(e.target.value)}>{['before','during','after','as_built','test_result','permit','other'].map(k=><option key={k} value={k}>{k.replaceAll('_',' ')}</option>)}</select></label>
     <label>Capture time — verify the device file time<input type="datetime-local" step="1" disabled={busy||!ready} value={captured} onChange={e=>setCaptured(e.target.value)}/></label>
     <label>Capture location<input disabled={busy||!ready} value={location} onChange={e=>setLocation(e.target.value)}/></label>
     <label>What does this evidence show?<textarea required disabled={busy||!ready} value={description} onChange={e=>setDescription(e.target.value)} /></label>
     <button disabled={busy||!file||!ready} className="partner-button wide-touch">{busy?"Uploading…":"Upload evidence"}</button>
   </form>)}
   {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
export function FieldIncident({assignmentId}:{assignmentId?:string}){
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const guard=useRef(false);const mutation=useRef(crypto.randomUUID());
 return <details className="partner-panel"><summary>Report an incident or near miss</summary><p>For an emergency, contact emergency services and your supervisor immediately. This report records the event; it does not contact emergency services.</p><form className="partner-form-grid" onChange={()=>{mutation.current=crypto.randomUUID();}} onSubmit={async e=>{e.preventDefault();if(guard.current)return;const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));guard.current=true;setBusy(true);try{await syncosFetch("syncfield/foreman/incidents",{method:"POST",body:{...values,occurred_at:new Date(String(values.occurred_at)).toISOString(),assignment_id:assignmentId,client_mutation_id:mutation.current}});mutation.current=crypto.randomUUID();form.reset();setMessage("Incident recorded. Follow your supervisor’s reporting procedure.");}catch(error){setMessage(error instanceof Error?error.message:"Report could not be saved. Retry.");}finally{guard.current=false;setBusy(false);}}}><fieldset disabled={busy}><legend>Incident details</legend><label>Type<select name="incident_type"><option value="near_miss">Near miss</option><option value="injury">Injury</option><option value="property_damage">Property damage</option><option value="environmental">Environmental</option><option value="other">Other</option></select></label><label>When did it happen?<input required type="datetime-local" name="occurred_at" /></label><label>Location<input required name="location" /></label><label>What happened?<textarea required name="description" /></label><label>Immediate action taken<textarea required name="immediate_action" /></label></fieldset><button disabled={busy} className="partner-button wide-touch">{busy?"Saving…":"Record incident"}</button>{message&&<p role="status">{message}</p>}</form></details>;
}
