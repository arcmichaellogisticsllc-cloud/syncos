"use client";

import { useEffect, useState } from "react";
import { readToken, syncosFetch } from "../../intelligence/api";
import { OpportunityShell } from "../opportunity-shell";

type CoverageRow = {
  opportunity_id?: string;
  title?: string;
  opportunity_status?: string;
  territory_name?: string;
  capability?: string;
  required_crew_count?: number;
  required_start_date?: string;
  required_start_window?: string;
  coverage_status?: string;
  covered_crew_count?: number;
  remaining_gap?: number;
  average_fit_score?: number;
  minimum_confidence?: string;
  reason_summary?: Record<string, unknown>;
};

export default function OpportunityCapacityMatchingPage() {
  const [state, setState] = useState<{ loading: boolean; error?: string; coverage?: CoverageRow[]; detail?: Record<string, unknown> }>({ loading: true });
  const [filter, setFilter] = useState({ capability: "", coverage_status: "" });
  const [opportunityId, setOpportunityId] = useState("");

  useEffect(() => {
    void loadCoverage();
  }, []);

  async function loadCoverage(next = filter) {
    if (!readToken()) {
      setState({ loading: false, error: "Sign in with an internal Sync account." });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) if (value) query.set(key, value);
      const coverage = await syncosFetch<CoverageRow[]>(`opportunity-capacity-matching/coverage${query.toString() ? `?${query}` : ""}`);
      setState((current) => ({ ...current, loading: false, coverage }));
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Opportunity matching failed." });
    }
  }

  async function openDetail(id?: string) {
    const target = id || opportunityId.trim();
    if (!target) return;
    const detail = await syncosFetch<Record<string, unknown>>(`opportunity-capacity-matching/opportunities/${target}`);
    setOpportunityId(target);
    setState((current) => ({ ...current, detail }));
  }

  async function recalculate() {
    const target = opportunityId.trim();
    if (!target) return;
    await syncosFetch(`opportunity-capacity-matching/opportunities/${target}/recalculate`, { method: "POST", body: {} });
    await openDetail(target);
    await loadCoverage();
  }

  if (state.loading) return <OpportunityShell title="Opportunity Capacity Matching" purpose="Internal capacity-fit intelligence"><section className="workspace-panel loading-state">Loading Opportunity Coverage...</section></OpportunityShell>;
  if (state.error) return <OpportunityShell title="Opportunity Capacity Matching" purpose="Internal capacity-fit intelligence"><section className="workspace-panel error-state"><h1>Access denied</h1><p>{state.error}</p></section></OpportunityShell>;

  const rows = state.coverage ?? [];

  return (
    <OpportunityShell title="Opportunity Capacity Matching" purpose="Ranked partner and crew fit for explicit opportunity requirements.">
      <section className="workspace-panel">
        <h2>Coverage View</h2>
        <div className="filter-row">
          <input value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)} placeholder="Opportunity ID" />
          <button className="secondary-button" onClick={() => openDetail()}>Open</button>
          <button className="primary-button" onClick={recalculate}>Recalculate</button>
        </div>
        <div className="filter-row">
          <input value={filter.capability} onChange={(event) => setFilter({ ...filter, capability: event.target.value })} placeholder="Capability" />
          <select value={filter.coverage_status} onChange={(event) => setFilter({ ...filter, coverage_status: event.target.value })}>
            <option value="">Coverage Status</option>
            <option value="fully_covered">Fully Covered</option>
            <option value="capacity_gap">Capacity Gap</option>
            <option value="low_confidence_coverage">Low Confidence</option>
            <option value="no_eligible_capacity">No Eligible Capacity</option>
          </select>
          <button className="secondary-button" onClick={() => loadCoverage()}>Apply</button>
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Opportunity Coverage</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Opportunity</th><th>Territory</th><th>Capability</th><th>Required</th><th>Verified</th><th>Gap</th><th>Confidence</th><th>Best Score</th><th>Recommendation</th><th>Action</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.opportunity_id}>
                  <td>{row.title}</td>
                  <td>{row.territory_name ?? "Explicit territory required"}</td>
                  <td>{label(row.capability)}</td>
                  <td>{row.required_crew_count ?? 0}</td>
                  <td>{row.covered_crew_count ?? 0}</td>
                  <td>{row.remaining_gap ?? row.required_crew_count ?? 0}</td>
                  <td>{label(row.minimum_confidence)}</td>
                  <td>{row.average_fit_score ?? 0}</td>
                  <td>{label((row.reason_summary ?? {}).pursue_recommendation ?? row.coverage_status)}</td>
                  <td><button className="secondary-button" onClick={() => openDetail(row.opportunity_id)}>Open</button></td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={10}>No current requirement profiles. Define requirements on an Opportunity before matching.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {state.detail ? <Detail detail={state.detail} /> : null}
      <section className="workspace-panel warning-box">
        Recommendations are decision support only. P15 does not award work, assign Partners, reserve Crews, change Opportunity stage, change rates, or mutate payments.
      </section>
    </OpportunityShell>
  );
}

function Detail({ detail }: { detail: Record<string, unknown> }) {
  const requirement = (detail.requirement ?? {}) as Record<string, unknown>;
  const summary = (detail.capacity_summary ?? {}) as Record<string, unknown>;
  const partners = Array.isArray(detail.partner_matches) ? detail.partner_matches as Array<Record<string, unknown>> : [];
  const crews = Array.isArray(detail.crew_matches) ? detail.crew_matches as Array<Record<string, unknown>> : [];
  const coverage = Array.isArray(detail.coverage_options) ? detail.coverage_options as Array<Record<string, unknown>> : [];
  const shortlist = Array.isArray(detail.shortlist) ? detail.shortlist as Array<Record<string, unknown>> : [];
  return (
    <>
      <section className="workspace-panel">
        <h2>Requirements</h2>
        <div className="summary-grid">
          <Metric label="Capability" value={label(requirement.capability)} />
          <Metric label="Crew Type" value={label(requirement.crew_type)} />
          <Metric label="Required Crews" value={requirement.required_crew_count} />
          <Metric label="Start Window" value={label(requirement.required_start_window)} />
          <Metric label="Verified Coverage" value={summary.verified_ready} />
          <Metric label="Remaining Gap" value={summary.gap} />
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Recommended Partners</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Partner</th><th>Eligible</th><th>Score</th><th>Ready</th><th>Suggested</th><th>Performance</th><th>Capacity Confidence</th><th>Risk</th><th>Reasons</th></tr></thead>
            <tbody>{partners.map((row) => <tr key={String(row.id)}><td>{String(row.partner_name ?? row.partner_organization_id)}</td><td>{String(row.eligible)}</td><td>{String(row.fit_score)}</td><td>{String(row.ready_crew_count)}</td><td>{String(row.recommended_crew_count)}</td><td>{String(row.performance_score)} {label(row.performance_confidence)}</td><td>{label(row.capacity_confidence)}</td><td>{String(row.review_required ? "Review Required" : "Clear")}</td><td>{Array.isArray(row.reason_codes) ? row.reason_codes.join(", ") : ""}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Crew Matches</h2>
        <div className="table-wrap"><table><thead><tr><th>Crew</th><th>Ready</th><th>Horizon</th><th>Territory</th><th>Capability</th><th>Equipment</th><th>Score</th></tr></thead><tbody>{crews.map((row) => <tr key={String(row.id)}><td>{String(row.crew_name ?? row.crew_id)}</td><td>{label(row.readiness_status)}</td><td>{label(row.availability_horizon)}</td><td>{label(row.territory_fit)}</td><td>{label(row.capability_fit)}</td><td>{label(row.equipment_fit)}</td><td>{String(row.fit_score)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="workspace-panel">
        <h2>Coverage Options</h2>
        <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Status</th><th>Covered</th><th>Required</th><th>Gap</th><th>Confidence</th><th>Partners</th></tr></thead><tbody>{coverage.map((row) => <tr key={String(row.id)}><td>{String(row.rank)}</td><td>{label(row.coverage_status)}</td><td>{String(row.covered_crew_count)}</td><td>{String(row.required_crew_count)}</td><td>{String(row.remaining_gap)}</td><td>{label(row.minimum_confidence)}</td><td>{String(row.partner_count)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="workspace-panel">
        <h2>Shortlist</h2>
        {shortlist.length ? <div className="table-wrap"><table><thead><tr><th>Partner</th><th>Status</th><th>Note</th></tr></thead><tbody>{shortlist.map((row) => <tr key={String(row.id)}><td>{String(row.partner_name)}</td><td>{label(row.status)}</td><td>{String(row.note ?? "")}</td></tr>)}</tbody></table></div> : <p className="muted">No human shortlist recorded.</p>}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return <div className="metric-card"><span>{label}</span><strong>{String(value ?? 0)}</strong></div>;
}

function label(value: unknown) {
  return String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "None";
}
