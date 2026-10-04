"use client";
import { useEffect, useState } from "react";
import { Capability, useCapability } from "../access-control";
import { syncosFetch } from "../intelligence/api";
import { ChoiceSelect, FinanceAction } from "../accepted-production-financials/financial-workflow";
type Choice = { id: string; label: string; status?: string; contractor_payable_id?: string; approved_terms?: {payment_trigger:string;payment_days:number;source_reference:string} };
export function AdjustmentForms() {
  const canApproveTerms = useCapability("contract.update"), canRelease = useCapability("retainage.release"), canAdjust = useCapability("financial_adjustment.create");
  const [revision, setRevision] = useState(0), [error, setError] = useState("");
  const [data, setData] = useState<{ payables: Choice[]; releases: Choice[]; sources: Choice[]; adjustments: Array<{ id: string; status: string; reason: string; adjustment_amount: number }> }>({ payables: [], releases: [], sources: [], adjustments: [] });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setLoading(true); setError("");
    Promise.all([
      canRelease ? syncosFetch<{ payables: Choice[]; releases: Choice[] }>("payment-retainage-adjustments/retainage-choices") : canApproveTerms ? syncosFetch<{ payables: Choice[]; releases: Choice[] }>("payment-retainage-adjustments/retainage-term-choices") : Promise.resolve({ payables: [], releases: [] }),
      canAdjust ? syncosFetch<{ sources: Choice[]; adjustments: typeof data.adjustments }>("payment-retainage-adjustments/adjustment-choices") : Promise.resolve({ sources: [], adjustments: [] }),
    ]).then(([retainage, adjustments]) => { if (alive) setData({ ...retainage, ...adjustments }); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision, canRelease, canAdjust, canApproveTerms]);
  const refresh = () => setRevision(v => v + 1);
  if (!canRelease && !canAdjust && !canApproveTerms) return null;
  return <section className="workspace-panel"><h2>Retainage and controlled adjustments</h2><p>Release requests and credit/rebill reviews preserve the original financial history. They do not send payments or rewrite issued invoices.</p>
    {loading && <p role="status">Loading adjustment records…</p>}{error && <p role="alert">{error}</p>}<button type="button" onClick={refresh} disabled={loading}>Refresh adjustment records</button>
    <fieldset disabled={loading || Boolean(error)} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <FinanceAction permission="retainage.release" title="Request retainage release" endpoint="retainage-releases" prefix="payment-retainage-adjustments" submitLabel="Request retainage release" onSaved={refresh} transform={f => ({ ...f, release_amount: Number(f.release_amount) })}>
        <ChoiceSelect label="Payable with retained funds" name="contractor_payable_id" rows={data.payables} /><label>Release amount<input name="release_amount" type="number" min="0.01" step="0.01" required /></label><label>Release reason<textarea name="release_reason" required /></label><label>Release evidence reference<input name="source_reference" required /></label>
      </FinanceAction>
      <FinanceAction permission="contract.update" title="Approve retained-fund payment terms" endpoint={f=>`retainage-releases/${f.release_id}/terms`} prefix="payment-retainage-adjustments" submitLabel="Approve retained-fund terms" onSaved={refresh} transform={f=>({...f,verified:f.verified==='on',payment_days:Number(f.payment_days),holidays:(f.holidays??'').split(/[\s,]+/).filter(Boolean),holiday_calendar_through:f.holiday_calendar_through||null})}>
        <ChoiceSelect label="Release needing approved terms" name="release_id" rows={data.releases.filter(r=>r.status==='pending'&&!r.approved_terms)}/>
        <label>Retained-fund payment clock<select name="payment_trigger" required defaultValue=""><option value="">Choose the executed agreement trigger</option><option value="release_approval">Release approval</option><option value="customer_retainage_receipt">Receipt of customer retainage</option><option value="invoice_acceptance">Invoice acceptance</option><option value="other_contract_event">Other completed contract event</option></select></label>
        <label>Days after retained-fund trigger<input name="payment_days" type="number" min="0" max="3660" step="1" required/></label>
        <label>Retained-fund day calculation<select name="payment_day_basis" required defaultValue=""><option value="">Choose day calculation</option><option value="calendar_days">Calendar days</option><option value="business_days">Business days (Monday–Friday)</option></select></label>
        <label>Retained-fund time zone<input name="time_zone" required placeholder="America/New_York"/></label>
        <label>Approved holidays<textarea name="holidays" placeholder="YYYY-MM-DD, one per line"/></label>
        <label>Holiday calendar verified through<input type="date" name="holiday_calendar_through"/><small>Required for business-day terms.</small></label>
        <label>Completed trigger time with UTC offset<input name="trigger_occurred_at" placeholder="2026-10-01T10:00:00-04:00"/><small>Required except when the clock starts at this release's authorization.</small></label>
        <label>Completed trigger evidence<input name="trigger_proof_reference"/></label>
        <label>Executed retained-fund clause reference<input name="source_reference" required minLength={3} maxLength={2000}/></label>
        <label><input type="checkbox" name="verified" required/> I verified this release's terms and completed trigger evidence against the executed agreement.</label>
      </FinanceAction>
      <FinanceAction permission="retainage.release" title="Authorize pending retainage release" endpoint={f => `retainage-releases/${f.release_id}/authorize`} prefix="payment-retainage-adjustments" submitLabel="Authorize retainage release" onSaved={refresh}>
        <ChoiceSelect label="Pending retainage release" name="release_id" rows={data.releases.filter(r => r.status === "pending" && r.approved_terms)} /><label><input type="checkbox" required /> I reviewed the evidence and authorize this retained amount to become a separate payable.</label>
      </FinanceAction>
      <FinanceAction permission="financial_adjustment.create" title="Request credit/rebill review" endpoint="financial-adjustments/credit-rebill" prefix="payment-retainage-adjustments" submitLabel="Request credit/rebill review" onSaved={refresh} transform={f => { const source = data.sources.find(r => r.id === f.accepted_production_source_id); if (!source) throw new Error("Select a current billed source requiring adjustment."); return { ...f, contractor_payable_id: source.contractor_payable_id || undefined }; }}>
        <ChoiceSelect label="Billed production with reduced acceptance" name="accepted_production_source_id" rows={data.sources} /><label>Adjustment reason<textarea name="reason" required /></label><label>Customer decision evidence reference<input name="source_reference" required /></label><p>The server calculates the credit from the latest accepted quantity. This creates a review request; it does not issue a credit note or rebill automatically.</p>
      </FinanceAction>
    </fieldset>
    <Capability permission="retainage.release"><h3>Release history</h3>{data.releases.length ? <ul>{data.releases.map(r => <li key={r.id}>{r.label} — {r.status?.replaceAll("_", " ")}{r.approved_terms ? ` · ${r.approved_terms.payment_days} days from ${r.approved_terms.payment_trigger.replaceAll("_", " ")} · ${r.approved_terms.source_reference}` : " · Awaiting contract-term approval"}</li>)}</ul> : <p>No retainage releases recorded.</p>}</Capability>
    <Capability permission="financial_adjustment.create"><h3>Adjustment review history</h3>{data.adjustments.length ? <ul>{data.adjustments.map(r => <li key={r.id}>{r.reason} — ${Number(r.adjustment_amount).toFixed(2)} — {r.status.replaceAll("_", " ")}</li>)}</ul> : <p>No adjustment requests recorded.</p>}</Capability>
  </section>;
}
