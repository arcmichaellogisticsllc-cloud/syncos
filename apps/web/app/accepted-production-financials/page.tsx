"use client";

import { useEffect, useState } from "react";
import { readToken, syncosFetch } from "../intelligence/api";

type Dashboard = Record<string, unknown> & {
  accepted_production_queue_count?: number;
  billable_count?: number;
  billable_amount?: number;
  invoice_count?: number;
  invoice_balance?: number;
  cash_received?: number;
  cash_applied?: number;
  partner_settlement_count?: number;
  partner_settlement_amount?: number;
  contractor_payable_count?: number;
  contractor_payable_net?: number;
  contractor_payable_eligible?: number;
  open_exception_count?: number;
};

type CoilPolicy = Record<string, unknown> & {
  id?: string;
  party_type?: string;
  treatment?: string;
  coil_type?: string;
  easement_type?: string;
  source_reference?: string;
  version?: number;
};

type CoilSummary = Record<string, unknown> & {
  id?: string;
  work_order_id?: string;
  asset_identifier?: string;
  coil_type?: string;
  actual_length_ft?: number;
  customer_treatment?: string;
  partner_treatment?: string;
};

export default function AcceptedProductionFinancialsPage() {
  const [state, setState] = useState<{ loading: boolean; error?: string; dashboard?: Dashboard; policies?: CoilPolicy[]; coils?: CoilSummary[] }>({ loading: true });
  const [form, setForm] = useState<Record<string, string>>({ party_type: "customer", treatment: "unconfirmed", effective_from: new Date().toISOString().slice(0, 10), source_type: "work_order" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!readToken()) {
        setState({ loading: false, error: "Sign in with an internal finance account." });
        return;
      }
      try {
        const [dashboard, policies, coils] = await Promise.all([
          syncosFetch<Dashboard>("accepted-production-financials/dashboard"),
          syncosFetch<CoilPolicy[]>("accepted-production-financials/coil-policies"),
          syncosFetch<CoilSummary[]>("accepted-production-financials/coil-commercial-summary"),
        ]);
        if (!cancelled) setState({ loading: false, dashboard, policies, coils });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : "Financial dashboard failed." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function createPolicy() {
    setSaving(true);
    try {
      await syncosFetch("accepted-production-financials/coil-policies", {
        method: "POST",
        body: {
          work_order_id: form.work_order_id,
          party_type: form.party_type,
          counterparty_organization_id: form.counterparty_organization_id || undefined,
          coil_type: form.coil_type || undefined,
          easement_type: form.easement_type || undefined,
          treatment: form.treatment,
          separate_production_code_id: form.separate_production_code_id || undefined,
          effective_from: form.effective_from,
          source_type: form.source_type,
          source_reference: form.source_reference || undefined,
          notes: form.notes || undefined,
        },
      });
      const [policies, coils] = await Promise.all([
        syncosFetch<CoilPolicy[]>("accepted-production-financials/coil-policies"),
        syncosFetch<CoilSummary[]>("accepted-production-financials/coil-commercial-summary"),
      ]);
      setState((current) => ({ ...current, policies, coils }));
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : "Coil policy save failed." }));
    } finally {
      setSaving(false);
    }
  }

  if (state.loading) return <main className="workspace-page"><section className="workspace-panel loading-state">Loading accepted-production financials...</section></main>;
  if (state.error) return <main className="workspace-page"><section className="workspace-panel error-state"><h1>Access denied</h1><p>{state.error}</p></section></main>;
  const dashboard = state.dashboard ?? {};
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Internal Finance</p>
          <h1>Accepted Production Financials</h1>
          <p>Customer-Accepted production converts to billing and Partner payable eligibility without executing Partner payments.</p>
        </div>
      </header>
      <section className="workspace-panel">
        <h2>Customer Revenue Chain</h2>
        <div className="summary-grid">
          <Metric label="Eligible Accepted Production" value={dashboard.accepted_production_queue_count} />
          <Metric label="Billables" value={dashboard.billable_count} />
          <Metric label="Billable Amount" value={money(dashboard.billable_amount)} />
          <Metric label="Invoices" value={dashboard.invoice_count} />
          <Metric label="Invoice Balance" value={money(dashboard.invoice_balance)} />
          <Metric label="Cash Received" value={money(dashboard.cash_received)} />
          <Metric label="Cash Applied" value={money(dashboard.cash_applied)} />
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Partner Payable Chain</h2>
        <div className="summary-grid">
          <Metric label="Partner Settlements" value={dashboard.partner_settlement_count} />
          <Metric label="Settlement Amount" value={money(dashboard.partner_settlement_amount)} />
          <Metric label="Contractor Payables" value={dashboard.contractor_payable_count} />
          <Metric label="Payable Net" value={money(dashboard.contractor_payable_net)} />
          <Metric label="Eligible To Pay" value={money(dashboard.contractor_payable_eligible)} />
          <Metric label="Open Exceptions" value={dashboard.open_exception_count} />
        </div>
      </section>
      <section className="workspace-panel warning-box">
        Settlement is not payment. Contractor Payable is not payment. Customer cash is applied to Customer invoices and only creates Partner pay-when-paid eligibility.
      </section>
      <section className="workspace-panel">
        <h2>Coil Commercial Policy</h2>
        <p className="muted-copy">Recorded coil is construction truth. These policies determine customer billing and Partner compensation separately after accepted production.</p>
        <div className="form-grid">
          <label>Work Order ID<input value={form.work_order_id ?? ""} onChange={(event) => setForm({ ...form, work_order_id: event.target.value })} /></label>
          <label>Counterparty Organization ID<input value={form.counterparty_organization_id ?? ""} onChange={(event) => setForm({ ...form, counterparty_organization_id: event.target.value })} /></label>
          <label>Party<select value={form.party_type ?? "customer"} onChange={(event) => setForm({ ...form, party_type: event.target.value })}><option value="customer">Customer</option><option value="partner">Partner</option></select></label>
          <label>Treatment<select value={form.treatment ?? "unconfirmed"} onChange={(event) => setForm({ ...form, treatment: event.target.value })}><option value="unconfirmed">Unconfirmed</option><option value="billable_as_footage">Billable as footage</option><option value="included_in_route_rate">Included in route rate</option><option value="separate_pay_item">Separate pay item</option><option value="non_billable">Non-billable</option></select></label>
          <label>Coil Type<input value={form.coil_type ?? ""} onChange={(event) => setForm({ ...form, coil_type: event.target.value })} placeholder="front_easement, general_slack..." /></label>
          <label>Easement<input value={form.easement_type ?? ""} onChange={(event) => setForm({ ...form, easement_type: event.target.value })} placeholder="front, rear..." /></label>
          <label>Separate Production Code ID<input value={form.separate_production_code_id ?? ""} onChange={(event) => setForm({ ...form, separate_production_code_id: event.target.value })} /></label>
          <label>Effective From<input type="date" value={form.effective_from ?? ""} onChange={(event) => setForm({ ...form, effective_from: event.target.value })} /></label>
          <label>Source Type<input value={form.source_type ?? ""} onChange={(event) => setForm({ ...form, source_type: event.target.value })} /></label>
          <label>Source Reference<input value={form.source_reference ?? ""} onChange={(event) => setForm({ ...form, source_reference: event.target.value })} /></label>
          <label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        </div>
        <button className="primary-button" type="button" disabled={saving || !form.work_order_id} onClick={createPolicy}>{saving ? "Saving..." : "Save Coil Policy"}</button>
        <div className="wide-table">
          <table>
            <thead><tr><th>Party</th><th>Coil Type</th><th>Easement</th><th>Treatment</th><th>Version</th><th>Source</th></tr></thead>
            <tbody>{(state.policies ?? []).map((policy) => <tr key={String(policy.id)}><td>{label(policy.party_type)}</td><td>{label(policy.coil_type)}</td><td>{label(policy.easement_type)}</td><td>{label(policy.treatment)}</td><td>{String(policy.version ?? "")}</td><td>{String(policy.source_reference ?? "")}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Coil Commercial Review</h2>
        <div className="wide-table">
          <table>
            <thead><tr><th>Work Order</th><th>Pole / Asset</th><th>Coil Type</th><th>Actual</th><th>Customer Treatment</th><th>Partner Treatment</th></tr></thead>
            <tbody>{(state.coils ?? []).map((coil) => <tr key={String(coil.id)}><td>{String(coil.work_order_id ?? "")}</td><td>{String(coil.asset_identifier ?? "")}</td><td>{label(coil.coil_type)}</td><td>{quantity(coil.actual_length_ft)}</td><td>{label(coil.customer_treatment)}</td><td>{label(coil.partner_treatment)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
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

function quantity(value: unknown) {
  const number = Number(value ?? 0);
  return `${Number.isFinite(number) ? number.toLocaleString() : "0"} FT`;
}

function label(value: unknown) {
  return String(value ?? "unconfirmed").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
