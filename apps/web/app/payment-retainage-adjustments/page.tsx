"use client";

import { useEffect, useState } from "react";
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
  const [state, setState] = useState<{ loading: boolean; error?: string; dashboard?: Dashboard; ready?: Payable[] }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!readToken()) {
        setState({ loading: false, error: "Sign in with an internal finance account." });
        return;
      }
      try {
        const [dashboard, ready] = await Promise.all([
          syncosFetch<Dashboard>("payment-retainage-adjustments/dashboard"),
          syncosFetch<Payable[]>("payment-retainage-adjustments/ready-to-pay"),
        ]);
        if (!cancelled) setState({ loading: false, dashboard, ready });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : "Payment workspace failed." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
          <p>Execute Partner payments through controlled instructions, release retained balances, and preserve issued invoice history during adjustments.</p>
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
      <section className="workspace-panel warning-box">
        Payment Instruction is not payment confirmation. Provider submission is not settled payment. Confirmed local/test provider status is required before paid balances change.
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
