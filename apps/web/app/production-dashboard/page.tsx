"use client";

import { useEffect, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { readToken, syncosFetch } from "../intelligence/api";

type Dashboard = {
  headline?: Record<string, number>;
  reported_vs_accepted?: Array<Record<string, unknown>>;
  production_by_crew?: Array<Record<string, unknown>>;
  production_by_work_order?: Array<Record<string, unknown>>;
  missing_reports?: Record<string, unknown>;
  customer_qc_aging?: Array<Record<string, unknown>>;
  correction_aging?: Array<Record<string, unknown>>;
  closeout?: Record<string, unknown>;
};

export default function ProductionDashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!readToken()) {
      setError("Login required.");
      return;
    }
    void syncosFetch<Dashboard>("syncfield/production-dashboard")
      .then(setDashboard)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Production dashboard failed to load."));
  }, []);

  return (
    <CommandShell title="Production Dashboard" purpose="Customer Accepted production operations, exports, and closeout without financial record creation.">
      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Accepted Production Operations</h2>
            <p className="muted">Reported production, Customer QC status, correction aging, and operational closeout without billing or settlement records.</p>
          </div>
        </div>
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        {!dashboard && !error ? <div className="loading-state" role="status">Loading production dashboard...</div> : null}
        {dashboard ? (
          <>
            <div className="summary-grid">
              <Metric label="Submitted Reports" value={dashboard.headline?.submitted_reports ?? 0} />
              <Metric label="Production Records" value={dashboard.headline?.production_record_count ?? 0} />
              <Metric label="Pending Customer QC" value={dashboard.headline?.pending_customer_qc ?? 0} />
              <Metric label="Corrections Required" value={dashboard.headline?.correction_required ?? 0} />
              <Metric label="Rejected" value={dashboard.headline?.rejected ?? 0} />
              <Metric label="Blocked / Rework" value={dashboard.headline?.blocked_rework ?? 0} />
            </div>
            <Section title="Reported vs Customer Accepted" rows={dashboard.reported_vs_accepted ?? []} />
            <Section title="Production by Crew" rows={dashboard.production_by_crew ?? []} />
            <Section title="Production by Work Order" rows={dashboard.production_by_work_order ?? []} />
            <div className="detail-grid">
              <div className="detail-card"><strong>Missing Reports</strong><span>{text(dashboard.missing_reports?.status)}</span></div>
              <div className="detail-card"><strong>Customer QC Aging</strong><span>{dashboard.customer_qc_aging?.length ?? 0}</span></div>
              <div className="detail-card"><strong>Correction Aging</strong><span>{dashboard.correction_aging?.length ?? 0}</span></div>
              <div className="detail-card"><strong>Closeout</strong><span>{text(dashboard.closeout?.status)}</span></div>
            </div>
          </>
        ) : null}
      </section>
    </CommandShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="summary-card"><span>{label}</span><strong>{value}</strong></div>;
}

function Section({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <section className="workspace-panel">
      <h3>{title}</h3>
      {!rows.length ? <div className="empty-state">No rows.</div> : null}
      {rows.length ? (
        <div className="object-table-wrapper">
          <table className="object-table">
            <thead><tr>{Object.keys(rows[0]).slice(0, 7).map((key) => <th key={key}>{key.replace(/_/g, " ")}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index}>{Object.keys(rows[0]).slice(0, 7).map((key) => <td key={key}>{text(row[key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value);
}
