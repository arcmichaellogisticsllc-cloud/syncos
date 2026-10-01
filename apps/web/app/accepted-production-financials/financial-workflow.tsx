"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Capability, PermissionLink } from "../access-control";
import { syncosFetch } from "../intelligence/api";

type Choice = { id: string; label: string; [key: string]: unknown };
type Choices = { accepted: Array<Choice & { customer_qc_decision_id: string }>; billables: Choice[]; invoices: Choice[]; receipts: Choice[]; sources: Choice[]; settlements: Choice[]; payables: Choice[] };
const empty: Choices = { accepted: [], billables: [], invoices: [], receipts: [], sources: [], settlements: [], payables: [] };

/** Every button uses the canonical accepted-production action, never the older workbench shortcut. */
export function FinancialWorkflow({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<Choices>(empty);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cashInvoice, setCashInvoice] = useState("");
  const [applyInvoice, setApplyInvoice] = useState("");
  useEffect(() => {
    let alive = true; setLoading(true); setError("");
    syncosFetch<Choices>("accepted-production-financials/workflow-choices").then(value => { if (alive) setData(value); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision]);
  const refresh = () => { setRevision(v => v + 1); onChange(); };
  const invoice = data.invoices.find(row => row.id === cashInvoice);
  const allocationInvoice = data.invoices.find(row => row.id === applyInvoice);
  return <section className="workspace-panel"><h2>Complete the financial handoff</h2>
    <p>Process customer-accepted quantities only. Customer billing supports both Sync and partner crews. Employee work stays outside partner settlements. Each step records a separate fact; none sends money.</p>
    {loading && <p role="status">Loading current financial records…</p>}
    {error && <p role="alert">{error} Your form entries are preserved.</p>}
    <button type="button" disabled={loading} onClick={() => setRevision(v => v + 1)}>Refresh financial records</button>
    <PermissionLink href="/payment-retainage-adjustments">Open external payments, retainage and adjustments</PermissionLink>
    <fieldset disabled={loading || Boolean(error)} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <FinanceAction permission="billing.create_billable" title="1. Convert accepted production" endpoint="billables/convert" submitLabel="Create billable" onSaved={refresh}>
        <ChoiceSelect label="Accepted production" name="customer_qc_decision_id" rows={data.accepted.filter(r => !r.billable_item_id).map(r => ({ ...r, id: r.customer_qc_decision_id, label: `${r.work_order_number || "Work order"} · ${String(r.production_date || "").slice(0,10)} · ${r.production_code} · ${r.accepted_quantity} ${r.unit_of_measure} · ${r.from_asset_identifier || r.production_description}${r.to_asset_identifier ? ` → ${r.to_asset_identifier}` : ""}` }))} />
      </FinanceAction>
      <FinanceAction permission="billing.create_invoice" title="2. Create customer invoice" endpoint="invoices/create" submitLabel="Create customer invoice" onSaved={refresh} transform={f => ({ ...f, billable_item_ids: [f.billable_item_id] })}>
        <p>The invoice is created as approved under your invoice-creation authority. Check the selected billable before submitting. Retainage and payment terms come from its approved agreement.</p>
        <ChoiceSelect label="Customer billable" name="billable_item_id" rows={data.billables} />
        <label>Billing period start<input name="period_start" type="date" required /></label><label>Billing period end<input name="period_end" type="date" required /></label>
      </FinanceAction>
      <FinanceAction permission="cash_receipt.record" title="3. Record customer cash received" endpoint="cash-receipts" submitLabel="Record customer receipt" onSaved={refresh} transform={f => { if (!invoice) throw new Error("Select a current customer invoice."); return { ...f, customer_organization_id: invoice.customer_organization_id, amount: Number(f.amount) }; }}>
        <ChoiceSelect label="Invoice identifying the paying customer" name="customer_invoice" rows={data.invoices} value={cashInvoice} onChange={setCashInvoice} />
        <label>Amount received<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label>Receipt date<input name="payment_date" type="date" required /></label>
        <label>Receipt method<select name="payment_method"><option value="ach">ACH</option><option value="wire">Wire</option><option value="check">Check</option><option value="other">Other</option></select></label>
        <label>Customer bank/payment reference<input name="payment_reference" required /></label>
        <p>This records receipt, not bank clearance or invoice application.</p>
      </FinanceAction>
      <FinanceAction permission="cash_receipt.record" title="4. Confirm customer cash cleared" endpoint={f => `cash-receipts/${f.cash_receipt_id}/clear`} submitLabel="Confirm cash cleared" onSaved={refresh}>
        <ChoiceSelect label="Uncleared customer receipt" name="cash_receipt_id" rows={data.receipts.filter(r => r.clearance_status !== "cleared")} />
        <label><input type="checkbox" required /> I verified this receipt cleared in the bank.</label>
      </FinanceAction>
      <FinanceAction permission="payment_application.create" title="5. Apply cleared cash to invoice" endpoint="payment-applications" submitLabel="Apply cleared customer cash" onSaved={refresh} transform={f => ({ ...f, amount: Number(f.amount) })}>
        <ChoiceSelect label="Invoice receiving cash" name="invoice_id" rows={data.invoices.filter(r => Number(r.balance_amount) > 0)} value={applyInvoice} onChange={setApplyInvoice} />
        <ChoiceSelect key={applyInvoice} label="Matching cleared receipt" name="cash_receipt_id" rows={data.receipts.filter(r => r.clearance_status === "cleared" && Number(r.unapplied_amount) > 0 && r.customer_organization_id === allocationInvoice?.customer_organization_id)} />
        <label>Amount to apply<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      </FinanceAction>
      <FinanceAction permission="partner_settlement.create" title="6. Create partner settlement" endpoint="partner-settlements/create" submitLabel="Create partner settlement" onSaved={refresh} transform={f => ({ ...f, accepted_production_source_ids: [f.accepted_production_source_id] })}>
        <ChoiceSelect label="Unsettled partner production" name="accepted_production_source_id" rows={data.sources.filter(r => r.provider_type !== "internal_workforce" && r.partner_organization_id && !r.settlement_item_id && ["accepted_production", "partner_coil_supplement"].includes(String(r.source_kind)))} />
        <p>Sync employee production is excluded. Settlement does not establish payment eligibility.</p>
      </FinanceAction>
      <FinanceAction permission="contractor_payable.create" title="7. Create partner payable" endpoint="contractor-payables/create" submitLabel="Create partner payable" onSaved={refresh}>
        <ChoiceSelect label="Partner settlement awaiting payable" name="settlement_id" rows={data.settlements} />
      </FinanceAction>
      <Capability permission="contractor_payable.read"><InstallmentSchedule rows={data.payables} revision={revision}/></Capability>
      <FinanceAction permission="contractor_payable.calculate_eligibility" title="Record a partner invoice payment trigger" endpoint={f=>`contractor-payables/${f.contractor_payable_id}/contract-trigger`} submitLabel="Record partner invoice event" onSaved={refresh} transform={f=>({...f,verified:f.verified==='on'})}>
        <ChoiceSelect label="Partner payable for invoice event" name="contractor_payable_id" rows={data.payables}/>
        <label>Actual event time with UTC offset<input name="occurred_at" required placeholder="2026-09-30T14:30:00-04:00"/></label>
        <label>Partner invoice event proof<input name="proof_reference" required/></label>
        <label><input name="verified" type="checkbox" required/> I verified the partner invoice event specified by the agreement.</label>
        <p>Use this for partner invoice issue, delivery or acceptance terms. Customer-payment triggers come from cleared allocated receipts.</p>
      </FinanceAction>
      <FinanceAction permission="contractor_payable.calculate_eligibility" title="8. Calculate payment eligibility" endpoint={f => `contractor-payables/${f.contractor_payable_id}/calculate-eligibility`} submitLabel="Calculate payment eligibility" onSaved={refresh}>
        <ChoiceSelect label="Partner payable" name="contractor_payable_id" rows={data.payables} />
        <p>Eligibility follows the approved partner agreement and its recorded trigger. Customer-payment terms use cleared cash allocated to accepted work. This does not mark the partner paid.</p>
      </FinanceAction>
    </fieldset>
  </section>;
}
export function ChoiceSelect({ label, name, rows, value, onChange }: { label: string; name: string; rows: Choice[]; value?: string; onChange?: (value: string) => void }) {
  return <label>{label}<select style={{ minHeight: 44 }} aria-label={label} name={name} required value={value} onChange={onChange ? e => onChange(e.target.value) : undefined} defaultValue={value === undefined ? "" : undefined}><option value="">Select {label.toLowerCase()}</option>{rows.map(row => <option value={row.id} key={row.id}>{row.label}</option>)}</select>{!rows.length && <small>No eligible records are available for this step.</small>}</label>;
}
export function FinanceAction({ permission, title, endpoint, submitLabel, children, transform, onSaved, prefix = "accepted-production-financials" }: { permission: string; title: string; endpoint: string | ((f: Record<string, string>) => string); submitLabel: string; children: ReactNode; transform?: (f: Record<string, string>) => Record<string, unknown>; onSaved: () => void; prefix?: string }) {
  const gate = useRef(false); const key = useRef("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (gate.current) return; gate.current = true; setBusy(true); setError(""); setMessage("");
    const form = event.currentTarget; const fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    if (!key.current) key.current = crypto.randomUUID();
    try {
      const result = await syncosFetch<{ entityType?: string; afterState?: Record<string, unknown> }>(`${prefix}/${typeof endpoint === "function" ? endpoint(fields) : endpoint}`, { method: "POST", body: { ...(transform ? transform(fields) : fields), idempotency_key: key.current, client_mutation_id: key.current } });
      key.current = "";
      const state = result.afterState ?? result as Record<string, unknown>;
      if (result.entityType !== "financial_exception" && !state.exception_type) form.reset();
      setMessage((result.entityType === "financial_exception" || state.exception_type) ? `Finance review required: ${state.message || "a rate or prerequisite is missing"}. No completed financial handoff was recorded.` : `${submitLabel} completed. ${state.invoice_number || state.payable_number || state.receipt_number || state.settlement_number || state.status || ""}${state.pay_when_paid_status ? ` · ${state.pay_when_paid_status}, eligible $${Number(state.eligible_amount).toFixed(2)}` : ""}`);
      onSaved();
    } catch (e) { setError(`${e instanceof Error ? e.message : "The action failed."} Your entries are preserved. Refresh the records before retrying if the result is uncertain.`); }
    finally { gate.current = false; setBusy(false); }
  }
  return <Capability permission={permission}><details className="workspace-panel"><summary style={{ minHeight: 44, paddingBlock: 12, cursor: "pointer" }}>{title}</summary><form onSubmit={submit} onChange={() => { if (!busy) key.current = ""; }}><fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}><div className="form-grid">{children}</div><button type="submit" style={{ minHeight: 44 }} disabled={busy}>{busy ? "Saving…" : submitLabel}</button></fieldset>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}</form></details></Capability>;
}

function InstallmentSchedule({rows,revision}:{rows:Choice[];revision:number}) {
 const [id,setId]=useState(''),[state,setState]=useState<{snapshot:null|{created_at:string;installments:Array<{allocation_id:string;amount:number;outstanding_amount:number;due_date:string;trigger_at:string}>}}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{setState(null);setError('');if(!id)return;let active=true;setLoading(true);syncosFetch<NonNullable<typeof state>>(`accepted-production-financials/contractor-payables/${id}/installments`).then(v=>{if(active)setState(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[id,revision]);
 return <section><h3>Partner payment installments</h3><ChoiceSelect label="Payable schedule" name="schedule_payable_id" rows={rows} value={id} onChange={setId}/>{loading&&<p role="status">Loading installments…</p>}{error&&<p role="alert">{error}</p>}{state&&(state.snapshot?<><p>Last calculation: {new Date(state.snapshot.created_at).toLocaleString()}. Recalculate eligibility after cash changes. Outstanding amounts apply recorded payments to the earliest due installment.</p><ul>{state.snapshot.installments.map((row,i)=><li key={row.allocation_id+String(i)}>${Number(row.amount).toFixed(2)} due {row.due_date}; ${Number(row.outstanding_amount).toFixed(2)} outstanding. Trigger: {new Date(row.trigger_at).toLocaleString()}.</li>)}</ul></>:<p>Calculate eligibility to produce the agreement’s installment schedule.</p>)}</section>;
}
