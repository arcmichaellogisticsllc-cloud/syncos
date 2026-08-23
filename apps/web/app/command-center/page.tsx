"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { readToken, syncosFetch } from "../intelligence/api";
import { CommandShell } from "../dashboard-components";

type Summary = {
  snapshot: Record<string, unknown> | null;
  actions: Array<Record<string, unknown>>;
  blockers: Array<Record<string, unknown>>;
  boundary?: Record<string, unknown>;
  message?: string;
};

export default function CommandCenterPage() {
  const [state, setState] = useState<{ loading: boolean; error?: string; summary?: Summary }>({ loading: true });

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    if (!readToken()) {
      setState({ loading: false, error: "Sign in with an internal Sync account." });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const summary = await syncosFetch<Summary>("executive-command/summary");
      setState({ loading: false, summary });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Command Center unavailable." });
    }
  }

  async function recalculate() {
    await syncosFetch("executive-command/recalculate", { method: "POST", body: {} });
    await load();
  }

  if (state.loading) return <CommandShell title="Command Center" purpose="Executive throughput and action priorities"><section className="workspace-panel loading-state">Loading Command Center...</section></CommandShell>;
  if (state.error) return <CommandShell title="Command Center" purpose="Executive throughput and action priorities"><section className="workspace-panel error-state"><h1>Access denied</h1><p>{state.error}</p></section></CommandShell>;

  const summary = state.summary;
  const snapshot = summary?.snapshot;

  return (
    <CommandShell title="Command Center" purpose="Executive throughput and action priorities">
      <section className="command-header">
        <div>
          <p className="eyebrow">Executive Command</p>
          <h1>Telecom throughput and daily action board</h1>
          <p className="muted">As of {formatDate(snapshot?.as_of)} · Refreshed {formatDate(snapshot?.calculated_at)}</p>
        </div>
        <button className="primary-button" onClick={recalculate}>Refresh</button>
      </section>

      {!snapshot ? <section className="workspace-panel"><p>{summary?.message ?? "No current snapshot."}</p></section> : <CommandContent snapshot={snapshot} actions={summary?.actions ?? []} blockers={summary?.blockers ?? []} />}
    </CommandShell>
  );
}

function CommandContent({ snapshot, actions, blockers }: { snapshot: Record<string, unknown>; actions: Array<Record<string, unknown>>; blockers: Array<Record<string, unknown>> }) {
  const reported = arrayValue(snapshot.reported_production_summary);
  const accepted = arrayValue(snapshot.accepted_production_summary);
  const daysToCash = objectValue(snapshot.days_to_cash);
  const changed = objectValue(objectValue(snapshot.daily_brief).what_changed);
  const topActions = actions.slice(0, 10);
  const freshness = objectValue(snapshot.freshness);
  const stale = staleData(freshness.as_of);

  return (
    <>
      <section className="kpi-grid command-kpis">
        <Kpi label="Qualified Value" value={money(snapshot.qualified_opportunity_value)} />
        <Kpi label="Coverage Ready" value={snapshot.coverage_ready_count} />
        <Kpi label="Ready Crews" value={snapshot.ready_crew_count} />
        <Kpi label="Active Work Orders" value={snapshot.active_work_order_count} />
        <Kpi label="Accepted Today" value={unitSummary(accepted)} />
        <Kpi label="Outstanding AR" value={money(snapshot.outstanding_ar_amount)} />
        <Kpi label="Eligible Payables" value={money(snapshot.partner_eligible_payable_amount)} />
      </section>

      {stale ? <section className="workspace-panel warning-box">STALE DATA · snapshot age exceeds {String(freshness.stale_threshold_minutes ?? 120)} minutes</section> : null}

      <section className="workspace-panel top-actions">
        <div className="panel-title-row">
          <h2>Top Actions Today</h2>
          <a className="secondary-button" href="/recommendations-center">Review Recommendations</a>
        </div>
        <div className="action-list">
          {topActions.map((action) => <ActionRow key={String(action.id)} action={action} />)}
          {!topActions.length ? <p className="muted">No open executive actions.</p> : null}
        </div>
      </section>

      <section className="throughput-grid">
        <Panel title="Growth">
          <Metric label="Qualified Opportunities" value={snapshot.qualified_opportunity_count} route="/opportunities" />
          <Metric label="Capacity Gaps" value={snapshot.capacity_gap_count} route="/opportunities/capacity-matching" />
          <Metric label="Coverage Ready" value={snapshot.coverage_ready_count} route="/opportunities/capacity-matching" />
        </Panel>
        <Panel title="Capacity">
          <Metric label="Ready Now" value={snapshot.ready_crew_count} route="/partner-performance" />
          <Metric label="Committed" value={changed.committed_crew_count ?? "See capacity"} route="/partner-performance" />
          <Metric label="Low Confidence" value={changed.low_confidence_claimed_capacity ?? "Separated"} route="/partner-performance" />
        </Panel>
        <Panel title="Execution">
          <Metric label="Reported Today" value={unitSummary(reported)} route="/production-dashboard" />
          <Metric label="Reports Submitted" value={changed.reports_submitted_today ?? "Current"} route="/production-dashboard" />
          <Metric label="Pending QC" value={snapshot.pending_qc_count} route="/partner/customer-qc" />
        </Panel>
        <Panel title="Customer QC">
          <Metric label="QC Aging" value={snapshot.customer_qc_aging_count} route="/partner/customer-qc" />
          <Metric label="Accepted" value={unitSummary(accepted)} route="/production-dashboard" />
          <Metric label="Corrections" value={blockers.filter((row) => row.reason_code === "PARTNER_CORRECTION_OVERDUE").length} route="/partner/customer-qc" />
        </Panel>
        <Panel title="Cash / Finance">
          <Metric label="Cleared Cash" value={money(snapshot.cleared_cash_amount)} route="/accepted-production-financials" />
          <Metric label="Unapplied Cash" value={money(snapshot.unapplied_cash_amount)} route="/accepted-production-financials" />
          <Metric label="Payment Due" value={money(snapshot.partner_payment_due_amount)} route="/payment-retainage-adjustments" />
        </Panel>
        <Panel title="Partner Health">
          <Metric label="Critical Risks" value={snapshot.critical_risk_count} route="/partner-performance" />
          <Metric label="High Blockers" value={snapshot.high_blocker_count} route="/partner-performance" />
          <Metric label="Payables Awaiting Funds" value={money(snapshot.partner_awaiting_funds_amount)} route="/accepted-production-financials" />
        </Panel>
      </section>

      <section className="workspace-panel">
        <h2>Throughput Funnel</h2>
        <div className="funnel-strip">
          <FunnelStep label="Qualified" value={snapshot.qualified_opportunity_count} />
          <FunnelStep label="Covered" value={snapshot.coverage_ready_count} />
          <FunnelStep label="Work Orders" value={snapshot.active_work_order_count} />
          <FunnelStep label="Production" value={unitSummary(reported)} />
          <FunnelStep label="Accepted" value={unitSummary(accepted)} />
          <FunnelStep label="Billed" value={money(snapshot.outstanding_ar_amount)} />
          <FunnelStep label="Cash" value={money(snapshot.cleared_cash_amount)} />
        </div>
      </section>

      <section className="workspace-panel">
        <h2>Billing Velocity</h2>
        <div className="summary-grid">
          <Metric label="Acceptance to Cash" value={daysToCash.accepted_to_cleared_cash_days ?? "No completed cash cycle"} route="/accepted-production-financials" />
          <Metric label="Acceptance to Invoice" value={daysToCash.accepted_to_invoice_days ?? "Not evaluated"} route="/accepted-production-financials" />
          <Metric label="Invoice to Cash" value={daysToCash.invoice_to_cleared_cash_days ?? "Not evaluated"} route="/accepted-production-financials" />
        </div>
      </section>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: unknown }) {
  return <div className="metric-card command-kpi"><span>{label}</span><strong>{String(value ?? "Not evaluated")}</strong></div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="workspace-panel command-panel"><div className="panel-heading"><h2>{title}</h2></div>{children}</section>;
}

function Metric({ label, value, route }: { label: string; value: unknown; route: string }) {
  return <a className="metric-line" href={route}><span>{label}</span><strong>{String(value ?? "Not evaluated")}</strong></a>;
}

function ActionRow({ action }: { action: Record<string, unknown> }) {
  return (
    <a className={`action-row priority-${String(action.priority ?? "p3")}`} href={String(action.route ?? "/command-center")}>
      <span className="priority-pill">{String(action.priority ?? "p3").toUpperCase()}</span>
      <span><strong>{String(action.title)}</strong><small>{String(action.reason_summary)}</small></span>
      <span>{String(action.owner_attribution ?? "unknown").replace(/_/g, " ")}</span>
    </a>
  );
}

function FunnelStep({ label, value }: { label: string; value: unknown }) {
  return <div className="funnel-step"><span>{label}</span><strong>{String(value ?? "Not evaluated")}</strong></div>;
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unitSummary(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "No evaluated units";
  return rows.map((row) => `${row.quantity} ${row.unit}`).join(", ");
}

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not evaluated";
  return `$${number.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatDate(value: unknown) {
  if (!value) return "Not refreshed";
  return new Date(String(value)).toLocaleString();
}

function staleData(value: unknown) {
  if (!value) return false;
  return Date.now() - new Date(String(value)).getTime() > 120 * 60 * 1000;
}
