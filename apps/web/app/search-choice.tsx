"use client";
import {useRef,useState} from 'react';
import {syncosFetch} from './intelligence/api';
type Choice={id:string;label:string};
export function SearchChoice({name,label,rows,value,required=false,endpoint}:{name:string;label:string;rows:Choice[];value?:string|null;required?:boolean;endpoint:string}){
 const [matches,setMatches]=useState<Choice[]>([]),[q,setQ]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 async function search(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const found=await syncosFetch<Choice[]>(`${endpoint}&q=${encodeURIComponent(q)}`);setMatches(old=>[...old,...found.filter(v=>!old.some(x=>x.id===v.id))]);if(found.length===0)setError('No matching records. Try another name or number.');else if(found.length===200)setError('Showing 200 matching choices. Refine your search for a specific record.');}catch(e){setError((e as Error).message);}finally{setBusy(false);lock.current=false;}}
 const combined=[...rows,...matches.filter(m=>!rows.some(r=>r.id===m.id))];
 return <div><label>Find {label.toLowerCase()}<input type="search" value={q} maxLength={200} onChange={e=>{e.stopPropagation();setQ(e.target.value);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search();}}}/></label><button type="button" disabled={busy} onClick={()=>void search()}>{busy?'Searching…':`Find ${label.toLowerCase()}`}</button>{error&&<p role="status">{error}</p>}<label>{label}<select name={name} required={required} defaultValue={value??''}><option value="">Not selected</option>{value&&!combined.some(r=>r.id===value)&&<option value={value}>Current linked record — search to view its name</option>}{combined.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label></div>;
}
