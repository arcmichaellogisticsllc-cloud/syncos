"use client";
import { useEffect, useState } from "react";
import { syncosFetch } from "../intelligence/api";
import { CommandShell } from "../dashboard-components";
import {PassportIntake} from "./intake";
import styles from "./passport.module.css";

type Row = {id:string;partner:string;reference:string;amount:string;currency:string;outcome:string;reason:string|null;guidance:string;completedDate:string|null};
type Preview = {mode:"simulation";connectionStatus:string;automaticRecordingEnabled:boolean;paymentSendingEnabled:boolean;lastSuccessfulSyncAt:string|null;rows:Row[]};
const labels:Record<string,string>={recorded:"Recorded in simulation",exception:"Needs review",pending:"Pending completion",duplicate:"Duplicate ignored"};
const reasons:Record<string,string>={unmatched_payment:"No payable match",amount_or_currency_mismatch:"Amount does not match",payable_not_eligible:"Payment not eligible",employee_work_not_partner_debt:"Employee work",recorded_payment_return_or_reversal:"Payment returned"};
const money=(row:Row)=>new Intl.NumberFormat("en-US",{style:"currency",currency:row.currency}).format(Number(row.amount));
export default function PassportPage(){
 const [data,setData]=useState<Preview|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const [filter,setFilter]=useState("all"),[search,setSearch]=useState("");
 useEffect(()=>{let active=true;setLoading(true);setError("");setData(null);
  syncosFetch<Preview>("payment-retainage-adjustments/passport-preview").then(next=>{if(active)setData(next);}).catch(()=>{if(active)setError("We could not load the preview. Check your connection and retry.");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[revision]);
 const rows=(data?.rows||[]).filter(row=>(filter==="all"||row.outcome===filter)&&`${row.partner} ${row.reference}`.toLowerCase().includes(search.toLowerCase()));
 return <CommandShell title="Passport reconciliation" purpose="Review how external payment confirmations will match your partner payables."><div className={styles.page}>
  <section className={styles.notice} aria-label="Simulation notice"><strong>Simulation preview · Live connection disabled</strong><p>The payment preview uses invented examples. Saved integration preparation is labeled separately. Reviewing them does not change your records or move money.</p></section>
  <section className="workspace-panel" aria-labelledby="connection-title"><h2 id="connection-title">Connection status</h2><dl className={styles.metrics}><div><dt>Passport sandbox</dt><dd>Awaiting approval and setup</dd></div><div><dt>Automatic recording</dt><dd>Disabled</dd></div><div><dt>Last successful sync</dt><dd>Never connected</dd></div><div><dt>Payment sending</dt><dd>Disabled</dd></div></dl><p>Continue recording completed external payments through the existing payment workspace until the connection is verified.</p></section>
  <PassportIntake/>
  {loading?<p role="status">Loading payment preview…</p>:null}
  {error?<section className="workspace-panel"><p role="alert">{error}</p><button type="button" onClick={()=>setRevision(x=>x+1)}>Retry preview</button></section>:null}
  {data?<section className="workspace-panel" aria-labelledby="payments-title"><h2 id="payments-title">Payment review</h2><p>Example confirmations and exceptions, with guidance for finance review.</p>
   <div className={styles.filters}><label>Show payments<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All examples</option><option value="exception">Needs review</option><option value="recorded">Recorded in simulation</option><option value="pending">Pending completion</option><option value="duplicate">Duplicates ignored</option></select></label><label>Search examples<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Partner or payment reference"/></label></div>
   <p role="status">{rows.length} {rows.length===1?"example":"examples"} shown</p>
   {!rows.length?<div className={styles.empty}><h3>No matching examples</h3><p>Try another partner name or payment reference.</p><button type="button" onClick={()=>{setSearch("");setFilter("all");}}>Clear filters</button></div>:null}
   <div className={styles.cards}>{rows.map(row=><article className={styles.card} key={row.id}><div className={styles.cardHeader}><h3>{row.partner}</h3><strong>{money(row)}</strong></div><p className={styles.badge}>{labels[row.outcome]||"Needs review"}</p><dl><dt>Example provider reference</dt><dd>{row.reference}</dd>{row.completedDate?<><dt>Example completion date</dt><dd>{row.completedDate}</dd></>:null}</dl><details><summary>Review details for {row.reference}</summary><p><strong>{row.reason?(reasons[row.reason]||"Manual review needed"):labels[row.outcome]}</strong></p><p>{row.guidance}</p><p>Preview only. Matching, resolving and recording live payments will become available after sandbox validation.</p></details></article>)}</div>
  </section>:null}
 </div></CommandShell>;
}
