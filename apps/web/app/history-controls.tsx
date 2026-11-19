"use client";
import {useState,type FormEvent} from 'react';
export function HistoryControls({label,busy,more,onSearch,onMore}:{label:string;busy:boolean;more:boolean;onSearch:(q:string)=>void;onMore:()=>void}){
 const [q,setQ]=useState('');
 return <div aria-busy={busy}><label>Search {label}<input type="search" maxLength={200} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!busy)onSearch(q);}}}/></label><button type="button" disabled={busy} onClick={()=>onSearch(q)}>Search {label}</button><button type="button" disabled={busy} onClick={()=>{setQ('');onSearch('');}}>Refresh {label}</button><button type="button" disabled={busy||!more} onClick={onMore}>Load older {label}</button></div>;
}
