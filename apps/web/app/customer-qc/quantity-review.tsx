"use client";
import { useEffect, useRef, useState } from 'react';
import { syncosFetch } from '../intelligence/api';
import { Capability } from '../access-control';
type Choice = {id:string;label:string};
export function QuantityReview({records,onSaved}:{records:any[];onSaved:()=>Promise<void>}) {
 return <Capability permission="customer_qc.completeness_review"><section className="workspace-panel">
  <h2>Reconcile production quantities</h2>
  <p>Review each work item once before customer acceptance. Included quantities and summaries reference existing work; they do not add installed footage or authorize a premium. For example, 886 feet including 180 feet of rock remains 886 installed feet.</p>
  {records.map(record=><QuantityItem key={record.id} record={record} onSaved={onSaved}/>)}
 </section></Capability>;
}
function QuantityItem({record,onSaved}:{record:any;onSaved:()=>Promise<void>}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [kind,setKind]=useState(record.quantity_review?.disposition??'primary_work');
 const [choices,setChoices]=useState<Choice[]>([]),[search,setSearch]=useState('');
 const [selected,setSelected]=useState<string[]>(record.quantity_review?.related_record_ids??[]);
 const guard=useRef(false),pending=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{setKind(record.quantity_review?.disposition??'primary_work');setSelected(record.quantity_review?.related_record_ids??[]);},[record.quantity_review?.id]);
 const reference=['included_subset','summary'].includes(kind);
 async function loadChoices(){setError('');try{setChoices(await syncosFetch<Choice[]>(`production-quantity/${record.id}/candidates?search=${encodeURIComponent(search)}`));}catch(e){setError(e instanceof Error?e.message:'Unable to load underlying work');}}
 return <details onToggle={event=>{if(event.currentTarget.open)void loadChoices();}}>
  <summary>{record.code??record.description??'Production'} · {record.asset_identifier??record.from_asset_identifier??''} · {record.effective_reported_quantity??record.reported_quantity} {record.unit_of_measure} · {record.quantity_review_current?record.quantity_review?.disposition?.replaceAll('_',' '):'Quantity review required'}</summary>
  <p>Original reported quantity: {record.reported_quantity}. Submitted corrections remain in revision history.</p>
  {record.quantity_review&&<p>Previous review: {record.quantity_review.source_reference} · {record.quantity_review.review_notes}</p>}
  <form onSubmit={async event=>{
   event.preventDefault();if(guard.current)return;guard.current=true;setBusy(true);setError('');setMessage('');
   const form=new FormData(event.currentTarget);
   const body={disposition:kind,canonical_reference:reference?undefined:form.get('canonical_reference'),related_record_ids:reference?selected:[],source_reference:form.get('source_reference'),review_notes:form.get('review_notes')};
   const key=JSON.stringify(body);if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
   try{await syncosFetch(`production-quantity/${record.id}/review`,{method:'POST',body:{...body,client_mutation_id:pending.current.id}});pending.current=null;await onSaved();setMessage('Quantity review saved. Customer acceptance remains separate.');}
   catch(e){setError(e instanceof Error?e.message:'Quantity review could not be confirmed; retry with the same entries');}
   finally{guard.current=false;setBusy(false);}
  }}>
   <fieldset disabled={busy}><legend>Quantity relationship</legend>
    <label>Classification<select name="disposition" value={kind} onChange={e=>setKind(e.target.value)}><option value="primary_work">Primary installed work</option><option value="additional_work">Separately approved additional work</option><option value="included_subset">Included within another work item</option><option value="summary">Summary of existing work items</option></select></label>
    {!reference&&<label>Stable work-item reference (primary or additional work)<input required name="canonical_reference" maxLength={200} defaultValue={record.quantity_review?.canonical_reference??''}/></label>}
    {reference&&<fieldset><legend>Underlying reviewed work</legend><p>Search by work reference, asset or route. Up to 100 matches are shown.</p><label>Find underlying work<input value={search} onChange={e=>setSearch(e.target.value)}/></label><button type="button" onClick={()=>void loadChoices()}>Find work</button>{choices.map(choice=><label key={choice.id}><input type="checkbox" checked={selected.includes(choice.id)} onChange={e=>setSelected(e.target.checked?[...selected,choice.id]:selected.filter(id=>id!==choice.id))}/>{choice.label}</label>)}{!choices.length&&<p>No matching reviewed work. Review the underlying work first.</p>}<p>{selected.length} work item(s) selected.</p><button type="button" onClick={()=>setSelected([])}>Clear selection</button></fieldset>}
    <label>Governing work or additional-work approval reference<input required name="source_reference"/></label>
    <label>Reconciliation findings<textarea required name="review_notes"/></label>
    <button disabled={reference&&!selected.length}>{busy?'Saving…':'Save quantity review'}</button>
   </fieldset>
  </form>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </details>;
}
