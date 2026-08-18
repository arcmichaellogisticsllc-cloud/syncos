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

export default function AcceptedProductionFinancialsPage() {
  const [state, setState] = useState<{ loading: boolean; error?: string; dashboard?: Dashboard }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!readToken()) {
        setState({ loading: false, error: "Sign in with an internal finance account." });
        return;
      }
      try {
        const dashboard = await syncosFetch<Dashboard>("accepted-production-financials/dashboard");
        if (!cancelled) setState({ loading: false, dashboard });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : "Financial dashboard failed." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
