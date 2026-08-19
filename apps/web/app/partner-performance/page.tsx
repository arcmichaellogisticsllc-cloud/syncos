"use client";

import { useEffect, useState } from "react";
import { readToken, syncosFetch } from "../intelligence/api";

type PartnerRow = {
  partner_organization_id?: string;
  partner_name?: string;
  organization_status?: string;
  score?: number;
  score_band?: string;
  confidence?: string;
  trend?: string;
  lifecycle_recommendation?: string;
  critical_risk_count?: number;
  ready_crews?: number;
  thirty_day_capacity?: number;
  territories?: string[];
  capabilities?: string[];
};
type Dashboard = {
  metrics?: Record<string, number>;
  partners?: PartnerRow[];
};

export default function PartnerPerformancePage() {
  const [state, setState] = useState<{ loading: boolean; error?: string; dashboard?: Dashboard; selected?: Record<string, unknown> }>({ loading: true });
  const [filter, setFilter] = useState({ confidence: "", score_band: "", recommendation: "" });

  useEffect(() => {
    void load();
  }, []);

  async function load(next = filter) {
    if (!readToken()) {
      setState({ loading: false, error: "Sign in with an internal Sync account." });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) if (value) query.set(key, value);
      const dashboard = await syncosFetch<Dashboard>(`partner-performance/dashboard${query.toString() ? `?${query}` : ""}`);
      setState({ loading: false, dashboard });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Partner Performance failed." });
    }
  }

  async function recalculate() {
    await syncosFetch("partner-performance/recalculate", { method: "POST", body: {} });
    await load();
  }

  async function openDetail(partnerId?: string) {
    if (!partnerId) return;
    const detail = await syncosFetch<Record<string, unknown>>(`partner-performance/partners/${partnerId}`);
    setState((current) => ({ ...current, selected: detail }));
  }

  if (state.loading) return <main className="workspace-page"><section className="workspace-panel loading-state">Loading Partner Performance...</section></main>;
  if (state.error) return <main className="workspace-page"><section className="workspace-panel error-state"><h1>Access denied</h1><p>{state.error}</p></section></main>;
  const metrics = state.dashboard?.metrics ?? {};
  const partners = state.dashboard?.partners ?? [];

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operational Intelligence</p>
          <h1>Partner Performance</h1>
          <p>Derived scorecards, capacity intelligence, critical risk flags, and lifecycle recommendations for internal decision support.</p>
        </div>
        <button className="primary-button" onClick={recalculate}>Recalculate</button>
      </header>
      <section className="workspace-panel">
        <h2>Executive Ranking</h2>
        <div className="summary-grid">
          <Metric label="Active Partners" value={metrics.active_partners} />
          <Metric label="Preferred Candidates" value={metrics.preferred_candidates} />
          <Metric label="Strategic Candidates" value={metrics.strategic_candidates} />
          <Metric label="Ready Crews" value={metrics.ready_crews} />
          <Metric label="High Risk" value={metrics.high_risk_partners} />
          <Metric label="Capacity Gaps" value={metrics.capacity_gaps} />
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Filters</h2>
        <div className="filter-row">
          <select value={filter.confidence} onChange={(event) => setFilter({ ...filter, confidence: event.target.value })}><option value="">Confidence</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          <select value={filter.score_band} onChange={(event) => setFilter({ ...filter, score_band: event.target.value })}><option value="">Score Band</option><option value="excellent">Excellent</option><option value="strong">Strong</option><option value="acceptable">Acceptable</option><option value="watch">Watch</option><option value="high_risk">High Risk</option></select>
          <select value={filter.recommendation} onChange={(event) => setFilter({ ...filter, recommendation: event.target.value })}><option value="">Recommendation</option><option value="promote">Promote</option><option value="maintain">Maintain</option><option value="review">Review</option><option value="demote">Demote</option><option value="suspend_review">Suspend Review</option><option value="insufficient_data">Insufficient Data</option></select>
          <button className="secondary-button" onClick={() => load()}>Apply</button>
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Partners</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Partner</th><th>Lifecycle</th><th>Score</th><th>Confidence</th><th>Trend</th><th>Critical Risk</th><th>Ready Crews</th><th>30-Day Capacity</th><th>Territories</th><th>Capabilities</th><th>Action</th></tr></thead>
            <tbody>
              {partners.map((row) => (
                <tr key={row.partner_organization_id}>
                  <td>{row.partner_name}</td>
                  <td>{label(row.organization_status)}</td>
                  <td>{row.score} {label(row.score_band)}</td>
                  <td>{label(row.confidence)}</td>
                  <td>{label(row.trend)}</td>
                  <td>{row.critical_risk_count ?? 0}</td>
                  <td>{row.ready_crews ?? 0}</td>
                  <td>{row.thirty_day_capacity ?? 0}</td>
                  <td>{(row.territories ?? []).join(", ") || "Explicit territory missing"}</td>
                  <td>{(row.capabilities ?? []).join(", ") || "No approved capability"}</td>
                  <td><button className="secondary-button" onClick={() => openDetail(row.partner_organization_id)}>Open</button></td>
                </tr>
              ))}
              {!partners.length ? <tr><td colSpan={11}>No score snapshots. Recalculate to create derived performance intelligence.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {state.selected ? <DetailPanel detail={state.selected} /> : null}
      <section className="workspace-panel warning-box">
        Scores are derived and explainable. P14 does not automatically change lifecycle, contracts, rates, settlements, payments, or Work Order awards.
      </section>
    </main>
  );
}

function DetailPanel({ detail }: { detail: Record<string, unknown> }) {
  const snapshot = (detail.snapshot ?? {}) as Record<string, unknown>;
  const components = Array.isArray(detail.components) ? detail.components as Array<Record<string, unknown>> : [];
  const risks = Array.isArray(detail.risks) ? detail.risks as Array<Record<string, unknown>> : [];
  const capacity = Array.isArray(detail.capacity) ? detail.capacity as Array<Record<string, unknown>> : [];
  const crews = Array.isArray(detail.crew_performance) ? detail.crew_performance as Array<Record<string, unknown>> : [];
  return (
    <section className="workspace-panel">
      <h2>Partner Detail</h2>
      <div className="summary-grid">
        <Metric label="Score" value={`${snapshot.score ?? "Pending"} ${label(snapshot.score_band)}`} />
        <Metric label="Confidence" value={label(snapshot.confidence)} />
        <Metric label="Trend" value={label(snapshot.trend)} />
        <Metric label="Lifecycle Recommendation" value={label(snapshot.lifecycle_recommendation)} />
      </div>
      <h3>Dimensions</h3>
      <div className="table-wrap"><table><thead><tr><th>Dimension</th><th>Score</th><th>Weight</th><th>Sample</th><th>Reason</th></tr></thead><tbody>{components.map((row) => <tr key={`${row.dimension}-${row.metric_code}`}><td>{label(row.dimension)}</td><td>{String(row.normalized_score)}</td><td>{String(row.weight)}</td><td>{String(row.sample_size)}</td><td>{label(row.reason_code)}</td></tr>)}</tbody></table></div>
      <h3>Capacity</h3>
      <div className="table-wrap"><table><thead><tr><th>Horizon</th><th>Capability</th><th>Ready</th><th>Conditional</th><th>Unverified</th><th>Confidence</th><th>Recommendation</th></tr></thead><tbody>{capacity.map((row) => <tr key={`${row.horizon}-${row.capability}`}><td>{label(row.horizon)}</td><td>{label(row.capability)}</td><td>{String(row.ready_crew_count)}</td><td>{String(row.conditional_crew_count)}</td><td>{String(row.unverified_crew_count)}</td><td>{label(row.capacity_confidence)}</td><td>{label(row.recommendation)}</td></tr>)}</tbody></table></div>
      <h3>Crew Performance</h3>
      <div className="table-wrap"><table><thead><tr><th>Crew</th><th>Type</th><th>Score</th><th>Reviewed</th><th>Accepted Quantity</th><th>Corrections</th></tr></thead><tbody>{crews.map((row) => <tr key={String(row.id)}><td>{String(row.name ?? "")}</td><td>{label(row.crew_type)}</td><td>{String(row.crew_score)}</td><td>{String(row.reviewed_records)}</td><td>{String(row.accepted_quantity)}</td><td>{String(row.correction_count)}</td></tr>)}</tbody></table></div>
      <h3>Critical Risks</h3>
      {risks.length ? <div className="table-wrap"><table><thead><tr><th>Risk</th><th>Severity</th><th>Status</th><th>Reason</th></tr></thead><tbody>{risks.map((row) => <tr key={`${row.risk_type}-${row.reason_code}`}><td>{label(row.risk_type)}</td><td>{label(row.severity)}</td><td>{label(row.status)}</td><td>{label(row.reason_code)}</td></tr>)}</tbody></table></div> : <p className="muted">No active critical risk flags.</p>}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return <div className="metric-card"><span>{label}</span><strong>{String(value ?? 0)}</strong></div>;
}

function label(value: unknown) {
  return String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "None";
}
