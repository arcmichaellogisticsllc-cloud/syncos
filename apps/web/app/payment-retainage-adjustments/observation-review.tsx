"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { syncosFetch } from "../intelligence/api";
type Observation = { id:string; provider:string; transaction_reference:string; account_reference:string; payee_reference:string; amount:string; currency:string; observed_status:string; review_status:string };
type Payment = {id:string; reference:string; amount:string; partner_name:string};
export function ObservationReview({ payments }: {payments:Payment[]}) {
  const [rows,setRows]=useState<Observation[]>([]);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const gate=useRef(false);
  async function load(){setRows(await syncosFetch<Observation[]>("payment-retainage-adjustments/external-payment-observations"));}
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  async function submit(event:FormEvent<HTMLFormElement>, path:string, linking=false){
    event.preventDefault();if(gate.current)return;gate.current=true;setBusy(true);setError("");setMessage("");
    const form=event.currentTarget;const values=Object.fromEntries(new FormData(form));
    try {
      await syncosFetch(`payment-retainage-adjustments/${path}`,{method:"POST",body:{...values,...(linking?{account_and_payee_verified:values.account_and_payee_verified==='on'}:{completed_date:values.completed_date||null})}});
      form.reset();await load();setMessage(linking?"Review recorded. The existing payment balance was not changed.":"Observation saved for review. No payment was posted or sent.");
    } catch(e){setError(e instanceof Error?e.message:"Could not confirm the save. Keep your entries and retry.");}
    finally{gate.current=false;setBusy(false);}
  }
  return <section className="workspace-panel"><h2>External payment review</h2>
    <p>Record non-sensitive transaction references for review. This does not connect to Priority or change payable balances. Repeated identical observations are kept once; conflicting observations remain visible.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <details><summary>Add an observed transaction</summary><form onSubmit={e=>submit(e,'external-payment-observations')}><fieldset disabled={busy}><legend>Transaction evidence</legend>
      <label>Source<select name="provider"><option value="bank">Bank</option><option value="passport">Passport</option><option value="other">Other</option></select></label>
      <label>Account reference (not a bank number)<input required name="account_reference" pattern="[A-Za-z0-9_.:-]+" maxLength={160}/></label>
      <label>Transaction reference<input required name="transaction_reference" pattern="[A-Za-z0-9_.:-]+" maxLength={160}/></label>
      <label>Payee reference<input required name="payee_reference" pattern="[A-Za-z0-9_.:-]+" maxLength={160}/></label>
      <label>Amount (for example 125.00)<input required name="amount" inputMode="decimal" pattern="[0-9]+\.[0-9]{2}"/></label>
      <label>Currency<input required name="currency" defaultValue="USD" pattern="[A-Z]{3}" maxLength={3}/></label>
      <label>Observed status<select name="observed_status">{['pending','completed','failed','returned','reversed'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Completed date, if completed<input name="completed_date" type="date"/></label>
      <label>Evidence reference<input required name="evidence_reference"/></label>
      <button type="submit">{busy?'Saving…':'Save for review'}</button>
    </fieldset></form></details>
    {!rows.length&&<p>No observations recorded.</p>}
    {rows.map(row=><article key={row.id}><h3>{row.transaction_reference}</h3><p>{row.provider} · {row.amount} {row.currency} · {row.observed_status} · {row.review_status==='linked'?'Linked to recorded payment':'Needs review'}</p>
      <p>Account {row.account_reference} · Payee {row.payee_reference}</p>
      {row.review_status==='needs_review'&&row.observed_status==='completed'&&<form onSubmit={e=>submit(e,`external-payment-observations/${row.id}/link-recorded-payment`,true)}><fieldset disabled={busy}><legend>Match existing payment</legend>
        <label>Recorded payment<select required name="external_partner_payment_id"><option value="">Choose a verified payment</option>{payments.map(p=><option key={p.id} value={p.id}>{p.partner_name} · {p.reference} · {p.amount}</option>)}</select></label>
        <label>Review note<textarea required name="review_note"/></label>
        <label><input required name="account_and_payee_verified" type="checkbox"/> I verified the source account and recipient against this payment.</label>
        <button type="submit">Link reviewed payment</button>
      </fieldset></form>}
    </article>)}
  </section>;
}
