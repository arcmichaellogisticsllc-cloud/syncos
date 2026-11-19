"use client";
import {useRef,useState} from 'react';
import {syncosFetch} from './intelligence/api';
/** Uses the cursor emitted by an already-authorized endpoint. */
export function HistoryPager<T>({rows,path,onRows,label,select}:{rows:T[];path:string;onRows:(rows:T[])=>void;label:string;select?:(value:any)=>T[]}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');const gate=useRef(false),applied=useRef('');const [end,setEnd]=useState('');
 const cursor=(rows.at(-1) as any)?._history_cursor;
 async function load(older=false){if(gate.current)return;gate.current=true;setBusy(true);setError('');try{const q=new URLSearchParams({history_q:older?applied.current:search,...(older&&cursor?{before:cursor}:{})});const value=await syncosFetch<any>(path+(path.includes('?')?'&':'?')+q);const incoming:T[]=select?select(value):value;if(!older)applied.current=search;setEnd(incoming.length<100?(incoming.at(-1) as any)?._history_cursor??cursor??'':'');onRows(older?[...rows,...incoming]:incoming);}catch(e){setError((e as Error).message);}finally{setBusy(false);gate.current=false;}}
 return <div aria-label={label+' navigation'}><label>Search {label}<input maxLength={200} value={search} onChange={e=>setSearch(e.target.value)}/></label><button type="button" disabled={busy} onClick={()=>void load()}>Find {label}</button><button type="button" disabled={busy||!cursor||end===cursor||rows.length%100!==0} onClick={()=>void load(true)}>More {label}</button>{busy&&<p role="status">Loading {label}…</p>}{error&&<p role="alert">{error}</p>}</div>;
}
