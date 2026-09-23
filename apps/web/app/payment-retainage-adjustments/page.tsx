"use client";
import { Capability } from "../access-control";

import { useEffect, useState, type FormEvent } from "react";
import { readToken, syncosFetch } from "../intelligence/api";

type Dashboard = {
  eligible_amount?: number;
  paid_amount?: number;
  in_flight_amount?: number;
  retained_balance?: number;
  adjustment_count?: number;
  instruction_statuses?: Array<{ status?: string; count?: number; amount?: number }>;
};

type Payable = {
  id?: string;
  payable_number?: string;
  partner_name?: string;
  net_payable_amount?: number;
  eligible_amount?: number;
  paid_amount?: number;
  in_flight_payment_amount?: number;
  payment_due_at?: string;
  pay_when_paid_status?: string;
};

export default function PaymentRetainageAdjustmentsPage() {
  const [state, setState] = useState<{ loading: boolean; error?: string; dashboard?: Dashboard; ready?: Payable[]; history?: Array<Record<string,any>> }>({ loading: true });

  const [recordError,setRecordError]=useState("");
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [requestKey,setRequestKey]=useState("");
  useEffect(() => { setRequestKey(crypto.randomUUID()); }, []);
  async function record(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget;const f=Object.fromEntries(new FormData(form).entries());setBusy(true);setRecordError("");
    try{await syncosFetch("payment-retainage-adjustments/external-payments",{method:"POST",body:{...f,amount:Number(f.amount),confirmed_completed:f.confirmed_completed==="on",idempotency_key:requestKey}});form.reset();setRequestKey(crypto.randomUUID());setRefresh(x=>x+1);}catch(e){setRecordError((e as Error).message);}finally{setBusy(false);}
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!readToken()) {
        setState({ loading: false, error: "Sign in with an internal finance account." });
        return;
      }
      try {
        const [dashboard, ready, history] = await Promise.all([
          syncosFetch<Dashboard>("payment-retainage-adjustments/dashboard"),
          syncosFetch<Payable[]>("payment-retainage-adjustments/ready-to-pay"),
          syncosFetch<Array<Record<string,any>>>("payment-retainage-adjustments/external-payments"),
        ]);
        if (!cancelled) setState({ loading: false, dashboard, ready, history });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : "Payment workspace failed." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (state.loading) return <main className="workspace-page"><section className="workspace-panel loading-state">Loading payment execution controls...</section></main>;
  if (state.error) return <main className="workspace-page"><section className="workspace-panel error-state"><h1>Access denied</h1><p>{state.error}</p></section></main>;
  const dashboard = state.dashboard ?? {};
  const ready = state.ready ?? [];

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Internal Finance</p>
          <h1>Payment, Retainage, Adjustments</h1>
          <p>Record completed external payments with their receipt references. Passport transfer automation is not enabled.</p>
        </div>
      </header>
      <section className="workspace-panel">
        <h2>Payment Control</h2>
        <div className="summary-grid">
          <Metric label="Eligible" value={money(dashboard.eligible_amount)} />
          <Metric label="In Flight" value={money(dashboard.in_flight_amount)} />
          <Metric label="Paid" value={money(dashboard.paid_amount)} />
          <Metric label="Retained" value={money(dashboard.retained_balance)} />
          <Metric label="Adjustments" value={dashboard.adjustment_count ?? 0} />
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Ready To Pay</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Payable</th><th>Partner</th><th>Eligible</th><th>In Flight</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {ready.map((row) => (
                <tr key={row.id}>
                  <td>{row.payable_number}</td>
                  <td>{row.partner_name}</td>
                  <td>{money(row.eligible_amount)}</td>
                  <td>{money(row.in_flight_payment_amount)}</td>
                  <td>{money(row.paid_amount)}</td>
                  <td>{row.payment_due_at || "Not due"}</td>
                  <td>{row.pay_when_paid_status}</td>
                </tr>
              ))}
              {!ready.length ? <tr><td colSpan={7}>No eligible Contractor Payables are ready for payment.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <Capability permission="partner_payment.confirm"><section className="workspace-panel"><h2>Record a completed payment</h2>
        {recordError&&<p role="alert">{recordError}</p>}
        <form onSubmit={record}><fieldset disabled={busy}>
          <label>Payable<select name="contractor_payable_id" required><option value="">Select payable</option>{ready.map(r=><option key={r.id} value={r.id}>{r.partner_name} — {r.payable_number}</option>)}</select></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required/></label>
          <label>Completed date<input name="payment_date" type="date" required/></label>
          <label>Method<select name="method">{['ach','wire','check','passport','other'].map(m=><option key={m}>{m}</option>)}</select></label>
          <label>Bank/payment reference<input name="reference" required/></label>
          <label>Receipt or confirmation reference<input name="evidence_reference" required/></label>
          <label><input name="confirmed_completed" type="checkbox" required/> I verified that this external payment completed.</label>
          <button type="submit">{busy?'Recording…':'Record payment'}</button>
        </fieldset></form>
      </section></Capability>
      <section className="workspace-panel"><h2>Recorded external payments</h2><p>Most recent 100 completed payments. Receipt references remain available for reconciliation.</p><div className="table-wrap"><table><thead><tr><th>Date</th><th>Partner / payable</th><th>Amount</th><th>Method / reference</th><th>Proof</th><th>Recorded by</th></tr></thead><tbody>{(state.history??[]).map(r=><tr key={r.id}><td>{String(r.payment_date).slice(0,10)}</td><td>{r.partner_name} · {r.payable_number}</td><td>{money(r.amount)}</td><td>{r.method} · {r.reference}</td><td>{r.evidence_reference}</td><td>{r.recorded_by}</td></tr>)}</tbody></table></div>{!state.history?.length&&<p>No external payments recorded.</p>}</section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return <div className="metric-card"><span>{label}</span><strong>{String(value ?? 0)}</strong></div>;
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(number) ? number : 0);
}
