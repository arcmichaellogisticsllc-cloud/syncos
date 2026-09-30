"use client";
import { InvoicePackages } from "./invoice-packages";
import { CommercialTerms } from "./commercial-terms";
import { FinancialWorkflow } from "./financial-workflow";
import { Capability, useCapability } from "../access-control";

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
  const [retry, setRetry] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [productionCodes, setProductionCodes] = useState<Array<{ id: string; code: string; name: string; unit: string }>>([]);
  const [codeState, setCodeState] = useState<"loading" | "ready" | "error">("loading");
  const canReadBilling = useCapability("billing.read");
  const canReadWorkOrders = useCapability("work_order.read");
  const [workOrders, setWorkOrders] = useState<Array<{ id: string; work_order_number?: string; work_order_name?: string; name?: string }>>([]);
  const [workOrderState, setWorkOrderState] = useState<"loading" | "ready" | "error">("loading");
  const canReadOrganizations = useCapability("organization.read");
  const canCreatePolicy = useCapability("billing.create_billable");
  const [organizationChoices, setOrganizationChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [organizationState, setOrganizationState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!canReadBilling || !canCreatePolicy) return;
    let cancelled = false;
    setCodeState("loading");
    syncosFetch<typeof productionCodes>("accepted-production-financials/production-code-choices").then(rows => {
      if (!cancelled) { setProductionCodes(rows); setCodeState("ready"); }
    }).catch(() => { if (!cancelled) setCodeState("error"); });
    return () => { cancelled = true; };
  }, [canReadBilling, canCreatePolicy, retry]);

  useEffect(() => {
    if (!canReadWorkOrders || !canCreatePolicy) return;
    let cancelled = false;
    setWorkOrderState("loading");
    syncosFetch<typeof workOrders>("work-orders?archived=false").then((rows) => {
      if (!cancelled) { setWorkOrders(rows); setWorkOrderState("ready"); }
    }).catch(() => { if (!cancelled) setWorkOrderState("error"); });
    return () => { cancelled = true; };
  }, [canReadWorkOrders, canCreatePolicy, retry]);

  useEffect(() => {
    if (!canReadOrganizations || !canCreatePolicy) return;
    let cancelled = false;
    async function loadOrganizations() {
      setOrganizationState("loading");
      try {
        const choices: Array<{ id: string; name: string }> = [];
        for (let offset = 0; ; offset += 200) {
          const rows = await syncosFetch<Array<{ id: string; name?: string; legal_name?: string; status?: string }>>(`organizations?limit=200&offset=${offset}`);
          for (const row of rows) if (row.status !== "archived" && (row.name || row.legal_name)) choices.push({ id: row.id, name: row.name || row.legal_name! });
          if (cancelled) return;
          if (rows.length < 200) break;
        }
        setOrganizationChoices(choices.sort((a, b) => a.name.localeCompare(b.name)));
        setOrganizationState("ready");
      } catch { if (!cancelled) setOrganizationState("error"); }
    }
    void loadOrganizations();
    return () => { cancelled = true; };
  }, [canReadOrganizations, canCreatePolicy, retry]);

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
  }, [retry]);

  async function createPolicy() {
    if (saving || !canCreatePolicy || !canReadWorkOrders || !workOrders.some((order) => order.id === form.work_order_id)) return;
    if (form.treatment === "separate_pay_item" && (codeState !== "ready" || !productionCodes.some(code => code.id === form.separate_production_code_id))) return;
    setSaving(true);
    setSaveError(""); setSaveMessage("");
    let policySaved = false;
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
      policySaved = true;
      setSaveMessage("Coil policy saved.");
      const [policies, coils] = await Promise.all([
        syncosFetch<CoilPolicy[]>("accepted-production-financials/coil-policies"),
        syncosFetch<CoilSummary[]>("accepted-production-financials/coil-commercial-summary"),
      ]);
      setState((current) => ({ ...current, policies, coils }));
    } catch (error) {
      if (policySaved) setSaveMessage("Coil policy saved. Refresh the policy list to see the latest result.");
      else setSaveError(error instanceof Error ? error.message : "Coil policy save failed. Your entries are preserved.");
    } finally {
      setSaving(false);
    }
  }

  if (state.loading) return <main className="workspace-page"><section className="workspace-panel loading-state">Loading accepted-production financials...</section></main>;
  if (state.error) return <main className="workspace-page"><section className="workspace-panel error-state"><h1>Financial workspace unavailable</h1><p role="alert">{state.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry loading</button></section></main>;
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
        Settlement is not payment. Contractor Payable is not payment. Customer cash is applied to customer invoices. Partner payment eligibility follows the approved agreement trigger and accepted-work controls.
      </section>
      <CommercialTerms />
      <InvoicePackages />
      <FinancialWorkflow onChange={() => setRetry(value => value + 1)} />
      <section className="workspace-panel">
        <h2>Coil Commercial Policy</h2>
        <p className="muted-copy">Recorded coil is construction truth. These policies determine customer billing and Partner compensation separately after accepted production.</p>
        <Capability permission="billing.create_billable">
        {!canReadWorkOrders ? <p>Creating a policy requires access to the work order list. Ask an administrator to review your work order access.</p> : workOrderState === "loading" ? <p role="status">Loading authorized work orders…</p> : workOrderState === "error" ? <div><p role="alert">Work order choices could not load. Your entries are preserved.</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry work order choices</button></div> : !workOrders.length ? <p>No authorized work orders are available for a policy.</p> : <>
        <div className="form-grid">
          <label>Work order<select aria-label="Work order" value={form.work_order_id ?? ""} onChange={(event) => setForm({ ...form, work_order_id: event.target.value, counterparty_organization_id: "" })}><option value="">Select a work order</option>{workOrders.map((order) => <option key={order.id} value={order.id}>{[order.work_order_number, order.work_order_name || order.name].filter(Boolean).join(" · ") || "Unnamed work order"}</option>)}</select></label>
          {canReadOrganizations ? <label>Counterparty organization<select aria-label="Counterparty organization" value={form.counterparty_organization_id ?? ""} disabled={organizationState !== "ready"} onChange={(event) => setForm({ ...form, counterparty_organization_id: event.target.value })}>
            <option value="">Use the work order customer or partner</option>
            {organizationChoices.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          </select><small>{organizationState === "loading" ? "Loading authorized organizations…" : organizationState === "error" ? "Organization choices could not load. You can still save a default policy, or retry to choose a specific organization." : "The default uses the selected work order’s customer or partner. Any explicit selection must match that work order."}</small>{organizationState === "error" ? <button type="button" onClick={() => setRetry(value => value + 1)}>Retry organization choices</button> : null}</label> : <p>This policy will use the work order’s customer or partner. Your account does not have access to select a specific organization.</p>}
          <label>Party<select value={form.party_type ?? "customer"} onChange={(event) => setForm({ ...form, party_type: event.target.value })}><option value="customer">Customer</option><option value="partner">Partner</option></select></label>
          <label>Treatment<select value={form.treatment ?? "unconfirmed"} onChange={(event) => setForm({ ...form, treatment: event.target.value })}><option value="unconfirmed">Unconfirmed</option><option value="billable_as_footage">Billable as footage</option><option value="included_in_route_rate">Included in route rate</option><option value="separate_pay_item">Separate pay item</option><option value="non_billable">Non-billable</option></select></label>
          <label>Coil type<select aria-label="Coil type" value={form.coil_type ?? ""} onChange={(event) => setForm({ ...form, coil_type: event.target.value })}><option value="">All coil types</option>{["front_easement", "rear_easement", "express_splice", "butt_splice", "riser_slack", "general_slack", "customer_required", "field_condition", "other"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label>Easement<select aria-label="Easement" value={form.easement_type ?? ""} onChange={(event) => setForm({ ...form, easement_type: event.target.value })}><option value="">All easements</option>{["front", "rear", "unknown", "not_applicable"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
{form.treatment === "separate_pay_item" ? <label>Separate production item<select aria-label="Separate production item" value={form.separate_production_code_id ?? ""} disabled={codeState !== "ready"} onChange={event => setForm({ ...form, separate_production_code_id: event.target.value })}><option value="">Select a production item</option>{productionCodes.map(code => <option key={code.id} value={code.id}>{code.code} · {code.name} ({code.unit})</option>)}</select>{codeState === "loading" ? <small role="status">Loading production items…</small> : codeState === "error" ? <><small role="alert">Production items could not load. Your entries are preserved.</small><button type="button" onClick={() => setRetry(value => value + 1)}>Retry production items</button></> : !productionCodes.length ? <small>No authorized production items are available.</small> : null}</label> : null}
          <label>Effective From<input type="date" value={form.effective_from ?? ""} onChange={(event) => setForm({ ...form, effective_from: event.target.value })} /></label>
          <label>Source type<select aria-label="Source type" value={form.source_type ?? ""} onChange={(event) => setForm({ ...form, source_type: event.target.value })}>{["customer_rate_sheet", "partner_rate_sheet", "msa", "work_order", "change_order", "customer_email", "partner_agreement", "written_direction", "other"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label>Source Reference<input value={form.source_reference ?? ""} onChange={(event) => setForm({ ...form, source_reference: event.target.value })} /></label>
          <label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        </div>
        {saveError ? <p role="alert">{saveError}</p> : null}
        {saveMessage ? <p role="status">{saveMessage}</p> : null}
        <button className="primary-button" type="button" disabled={saving || !form.work_order_id || (form.treatment === "separate_pay_item" && (codeState !== "ready" || !form.separate_production_code_id))} onClick={createPolicy}>{saving ? "Saving..." : "Save Coil Policy"}</button></> }</Capability>
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
