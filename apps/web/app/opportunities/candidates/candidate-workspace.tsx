"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  dateValue,
  defaultOpportunityPermissions,
  hasPermission,
  numberValue,
  readPermissions,
  readToken,
  savePermissions,
  saveToken,
  syncosFetch,
  textValue,
  type SyncRecord,
} from "../../intelligence/api";
import { OpportunityShell } from "../opportunity-shell";

const candidateStatuses = ["created", "monitoring", "investigating", "qualified", "rejected", "archived"];
const boardStatuses = candidateStatuses;
const workTypes = ["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"];
const rejectReasons = ["insufficient_evidence", "no_relationship_access", "out_of_territory", "low_value", "poor_fit", "capacity_gap", "not_telecom_work", "duplicate", "other"];
const archiveReasons = ["duplicate", "stale", "no_longer_relevant", "converted_later", "rejected_cleanup", "other"];
const sourceTypes = ["signal", "organization_research", "relationship_map", "manual_entry", "customer_request", "prime_request", "public_source", "internal_note", "other"];

type CandidateData = {
  candidates: SyncRecord[];
  organizations: SyncRecord[];
  signals: SyncRecord[];
  contacts: SyncRecord[];
  relationshipMaps: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  candidateSignalsByCandidate: Record<string, SyncRecord[]>;
  unavailable: string[];
};

type CandidateView = SyncRecord & {
  id: string;
  name: string;
  status: string;
  organization?: SyncRecord;
  signals: SyncRecord[];
  signalLinks: SyncRecord[];
  relationshipMap?: SyncRecord;
  candidateScore: number | null;
  confidenceScore: number | null;
  relationshipAccessScore: number | null;
  recommendedNextAction: string;
  readyForOpportunity: boolean;
  missingItems: string[];
  timeline: SyncRecord[];
  audit: SyncRecord[];
};

type Filters = {
  q: string;
  status: string;
  organizationId: string;
  territoryId: string;
  workType: string;
  confidenceMin: string;
  confidenceMax: string;
  scoreMin: string;
  relationshipMin: string;
  owner: string;
  hasSignals: string;
  hasOrganization: string;
  hasRelationshipMap: string;
  archived: string;
  sort: string;
};

const initialFilters: Filters = {
  q: "",
  status: "",
  organizationId: "",
  territoryId: "",
  workType: "",
  confidenceMin: "",
  confidenceMax: "",
  scoreMin: "",
  relationshipMin: "",
  owner: "",
  hasSignals: "",
  hasOrganization: "",
  hasRelationshipMap: "",
  archived: "false",
  sort: "default",
};

export function CandidateBoard() {
  const session = useSession();
  const [data, setData] = useState<CandidateData>(emptyData);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [view, setView] = useState<"board" | "table">("board");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await loadCandidateData());
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const candidates = useMemo(() => {
    const enriched = data.candidates.map((candidate) => enrichCandidate(candidate, data));
    return sortCandidates(enriched.filter((candidate) => candidateMatchesFilters(candidate, filters)), filters.sort);
  }, [data, filters]);
  const summary = useMemo(() => buildSummary(data.candidates.map((candidate) => enrichCandidate(candidate, data))), [data]);

  return (
    <OpportunityShell title="Opportunity Candidate Board" purpose="Triage intelligence-backed possible work before it becomes a formal opportunity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <UnsupportedNotice unavailable={data.unavailable} />
      <div className="summary-grid">
        <SummaryCard label="Total Candidates" value={summary.total} onClick={() => setFilters(initialFilters)} />
        <SummaryCard label="Monitoring" value={summary.monitoring} onClick={() => setFilters({ ...initialFilters, status: "monitoring" })} />
        <SummaryCard label="Investigating" value={summary.investigating} onClick={() => setFilters({ ...initialFilters, status: "investigating" })} />
        <SummaryCard label="Qualified" value={summary.qualified} onClick={() => setFilters({ ...initialFilters, status: "qualified" })} />
        <SummaryCard label="Rejected" value={summary.rejected} onClick={() => setFilters({ ...initialFilters, status: "rejected", archived: "" })} />
        <SummaryCard label="Archived" value={summary.archived} onClick={() => setFilters({ ...initialFilters, archived: "true" })} />
        <SummaryCard label="High Confidence" value={summary.highConfidence} onClick={() => setFilters({ ...initialFilters, confidenceMin: "75" })} />
        <SummaryCard label="Missing Organization" value={summary.missingOrganization} onClick={() => setFilters({ ...initialFilters, hasOrganization: "false", archived: "" })} />
        <SummaryCard label="Missing Signals" value={summary.missingSignals} onClick={() => setFilters({ ...initialFilters, hasSignals: "false", archived: "" })} />
        <SummaryCard label="Missing Relationship Access" value={summary.missingRelationshipAccess} onClick={() => setFilters({ ...initialFilters, hasRelationshipMap: "false", archived: "" })} />
        <SummaryCard label="Ready For Opportunity" value={summary.readyForOpportunity} onClick={() => setFilters({ ...initialFilters, status: "qualified" })} />
      </div>

      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Candidate Board</h2>
            <p className="muted">Board cards and table rows use tenant-scoped candidate, signal, organization, and relationship map APIs.</p>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setView(view === "board" ? "table" : "board")}>{view === "board" ? "Table View" : "Board View"}</button>
            <Link className="primary-button link-button" href="/opportunities/candidates/new" aria-disabled={!hasPermission(session.permissions, "opportunity_candidate.create")}>Create Candidate</Link>
          </div>
        </div>
        <div className="filter-grid">
          <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search candidates, organizations, work type" />
          <Select label="Status" value={filters.status} options={["", ...candidateStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
          <Select label="Organization" value={filters.organizationId} options={["", ...data.organizations.map((organization) => String(organization.id))]} labels={labelMap(data.organizations, "name")} onChange={(organizationId) => setFilters({ ...filters, organizationId })} />
          <input value={filters.territoryId} onChange={(event) => setFilters({ ...filters, territoryId: event.target.value })} placeholder="Territory id" />
          <Select label="Work type" value={filters.workType} options={["", ...workTypes]} onChange={(workType) => setFilters({ ...filters, workType })} />
          <input value={filters.confidenceMin} onChange={(event) => setFilters({ ...filters, confidenceMin: event.target.value })} type="number" min="0" max="100" placeholder="Min confidence" />
          <input value={filters.confidenceMax} onChange={(event) => setFilters({ ...filters, confidenceMax: event.target.value })} type="number" min="0" max="100" placeholder="Max confidence" />
          <input value={filters.scoreMin} onChange={(event) => setFilters({ ...filters, scoreMin: event.target.value })} type="number" min="0" max="100" placeholder="Min candidate score" />
          <input value={filters.relationshipMin} onChange={(event) => setFilters({ ...filters, relationshipMin: event.target.value })} type="number" min="0" max="100" placeholder="Min relationship access" />
          <input value={filters.owner} onChange={(event) => setFilters({ ...filters, owner: event.target.value })} placeholder="Owner user id" />
          <Select label="Signals" value={filters.hasSignals} options={["", "true", "false"]} onChange={(hasSignals) => setFilters({ ...filters, hasSignals })} />
          <Select label="Organization attached" value={filters.hasOrganization} options={["", "true", "false"]} onChange={(hasOrganization) => setFilters({ ...filters, hasOrganization })} />
          <Select label="Relationship map" value={filters.hasRelationshipMap} options={["", "true", "false"]} onChange={(hasRelationshipMap) => setFilters({ ...filters, hasRelationshipMap })} />
          <Select label="Archived" value={filters.archived} options={["", "true", "false"]} onChange={(archived) => setFilters({ ...filters, archived })} />
          <Select label="Sort" value={filters.sort} options={["default", "updated_desc", "created_desc", "score_desc", "confidence_desc", "value_desc", "relationship_desc", "status", "organization"]} onChange={(sort) => setFilters({ ...filters, sort })} />
          <button type="button" onClick={() => setFilters(initialFilters)}>Clear filters</button>
        </div>
        <div className="quick-filter-row">
          {[
            ["Needs Review", { status: "created" }],
            ["Monitoring", { status: "monitoring" }],
            ["Investigating", { status: "investigating" }],
            ["Qualified", { status: "qualified" }],
            ["High Confidence", { confidenceMin: "75" }],
            ["Missing Signals", { hasSignals: "false", archived: "" }],
            ["Missing Organization", { hasOrganization: "false", archived: "" }],
            ["Missing Relationship Access", { hasRelationshipMap: "false", archived: "" }],
            ["Ready For Opportunity", { status: "qualified" }],
            ["Rejected", { status: "rejected", archived: "" }],
            ["Archived", { archived: "true" }],
          ].map(([label, patch]) => (
            <button key={String(label)} type="button" onClick={() => setFilters({ ...initialFilters, ...(patch as Partial<Filters>) })}>{String(label)}</button>
          ))}
        </div>
      </section>

      <section className="workspace-panel">
        {loading ? <div className="empty-state">Loading opportunity candidates...</div> : null}
        {!loading && candidates.length === 0 ? (
          <div className="empty-state">
            <p>No opportunity candidates yet. Create a candidate from signal intelligence, organization intelligence, or relationship access.</p>
            <Link className="primary-button link-button" href="/opportunities/candidates/new">Create Candidate</Link>
          </div>
        ) : null}
        {candidates.length > 0 && view === "board" ? <CandidateKanban candidates={candidates} /> : null}
        {candidates.length > 0 && view === "table" ? <CandidateTable candidates={candidates} /> : null}
      </section>
    </OpportunityShell>
  );
}

export function CandidateForm({ mode, candidateId }: { mode: "create" | "edit"; candidateId?: string }) {
  const router = useRouter();
  const session = useSession();
  const [data, setData] = useState<CandidateData>(emptyData);
  const [form, setForm] = useState({
    name: "",
    organization_id: "",
    territory_id: "",
    work_type: "unknown",
    status: "created",
    evidence_summary: "",
    source_type: "manual_entry",
    source_note: "",
    estimated_value: "",
    candidate_score: "",
    relationship_map_id: "",
    confidence_score: "",
    capacity_fit_score: "",
    strategic_fit_score: "",
    risk_score: "",
    owner_user_id: "",
    related_signal_id: "",
    contribution_score: "50",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const nextData = await loadCandidateData();
        setData(nextData);
        if (mode === "edit" && candidateId) {
          const candidate = await syncosFetch<SyncRecord>(`/opportunity-candidates/${candidateId}`);
          setForm({
            name: textValue(candidate.name ?? candidate.title, ""),
            organization_id: textValue(candidate.organization_id, ""),
            territory_id: textValue(candidate.territory_id, ""),
            work_type: textValue(candidate.work_type, "unknown"),
            status: textValue(candidate.normalized_status ?? candidate.status, "created"),
            evidence_summary: textValue(candidate.summary ?? candidate.evidence_summary, ""),
            source_type: textValue(candidate.source_type, "manual_entry"),
            source_note: textValue(candidate.source_note, ""),
            estimated_value: textValue(candidate.estimated_value, ""),
            candidate_score: textValue(candidate.candidate_score ?? candidate.score, ""),
            relationship_map_id: textValue(candidate.relationship_map_id, ""),
            confidence_score: textValue(candidate.confidence_score, ""),
            capacity_fit_score: textValue(candidate.capacity_fit_score, ""),
            strategic_fit_score: textValue(candidate.strategic_fit_score, ""),
            risk_score: textValue(candidate.risk_score, ""),
            owner_user_id: textValue(candidate.owner_user_id, ""),
            related_signal_id: "",
            contribution_score: "50",
          });
        }
      } catch (nextError) {
        setError((nextError as Error).message);
      }
    }
    void load();
  }, [candidateId, mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Candidate name is required.");
    if (!form.organization_id) return setError("Candidate must have an organization before qualification.");
    if (!form.territory_id) return setError("Candidate territory is required.");
    try {
      const body = prune({
        name: form.name,
        title: form.name,
        organization_id: form.organization_id,
        territory_id: form.territory_id,
        work_type: form.work_type,
        status: form.status,
        summary: form.evidence_summary,
        evidence_summary: form.evidence_summary,
        source_type: form.source_type,
        source_note: form.source_note,
        estimated_value: optionalNumber(form.estimated_value),
        candidate_score: optionalNumber(form.candidate_score),
        relationship_map_id: form.relationship_map_id,
        owner_user_id: form.owner_user_id,
        confidence_score: optionalNumber(form.confidence_score),
        capacity_fit_score: optionalNumber(form.capacity_fit_score),
        strategic_fit_score: optionalNumber(form.strategic_fit_score),
        risk_score: optionalNumber(form.risk_score),
      });
      const saved = mode === "edit" && candidateId
        ? await syncosFetch<SyncRecord>(`/opportunity-candidates/${candidateId}`, { method: "PATCH", body })
        : await syncosFetch<SyncRecord>("/opportunity-candidates", { method: "POST", body });
      const id = String(saved.id ?? candidateId);
      if (mode === "create" && form.owner_user_id) {
        await syncosFetch(`/opportunity-candidates/${id}`, { method: "PATCH", body: { owner_user_id: form.owner_user_id } });
      }
      if (mode === "create" && form.related_signal_id) {
        await syncosFetch(`/opportunity-candidates/${id}/signals`, { method: "POST", body: { signal_id: form.related_signal_id, contribution_score: optionalNumber(form.contribution_score) ?? 50 } });
      }
      router.push(`/opportunities/candidates/${id}`);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <OpportunityShell title={mode === "create" ? "Create Opportunity Candidate" : "Edit Opportunity Candidate"} purpose="Create or update an intelligence-backed possible work event without creating a full opportunity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label>Candidate name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label>Organization<SelectInline value={form.organization_id} options={["", ...data.organizations.map((organization) => String(organization.id))]} labels={labelMap(data.organizations, "name")} onChange={(organization_id) => setForm({ ...form, organization_id })} /></label>
          <label>Territory id<input value={form.territory_id} onChange={(event) => setForm({ ...form, territory_id: event.target.value })} required /></label>
          <label>Work type<SelectInline value={form.work_type} options={workTypes} onChange={(work_type) => setForm({ ...form, work_type })} /></label>
          <label>Status<SelectInline value={form.status} options={candidateStatuses} onChange={(status) => setForm({ ...form, status })} /></label>
          <label>Estimated value<input value={form.estimated_value} onChange={(event) => setForm({ ...form, estimated_value: event.target.value })} type="number" min="0" step="0.01" /></label>
          <label>Confidence score<input value={form.confidence_score} onChange={(event) => setForm({ ...form, confidence_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Candidate score<input value={form.candidate_score} onChange={(event) => setForm({ ...form, candidate_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Owner user id<input value={form.owner_user_id} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} /></label>
          <label>Source type<SelectInline value={form.source_type} options={sourceTypes} onChange={(source_type) => setForm({ ...form, source_type })} /></label>
          <label>Source note<input value={form.source_note} onChange={(event) => setForm({ ...form, source_note: event.target.value })} /></label>
          <label>Relationship map<SelectInline value={form.relationship_map_id} options={["", ...data.relationshipMaps.map((map) => String(map.id))]} labels={labelMap(data.relationshipMaps, "map_name")} onChange={(relationship_map_id) => setForm({ ...form, relationship_map_id })} /></label>
          <label>Related signal<SelectInline value={form.related_signal_id} options={["", ...data.signals.map((signal) => String(signal.id))]} labels={labelMap(data.signals, "title")} onChange={(related_signal_id) => setForm({ ...form, related_signal_id })} /></label>
          <label>Signal contribution score<input value={form.contribution_score} onChange={(event) => setForm({ ...form, contribution_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Capacity fit score<input value={form.capacity_fit_score} onChange={(event) => setForm({ ...form, capacity_fit_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Strategic fit score<input value={form.strategic_fit_score} onChange={(event) => setForm({ ...form, strategic_fit_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Risk score<input value={form.risk_score} onChange={(event) => setForm({ ...form, risk_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Summary / evidence<textarea value={form.evidence_summary} onChange={(event) => setForm({ ...form, evidence_summary: event.target.value })} /></label>
        </div>
        <div className="warning-box">Lifecycle movement should still use the dedicated Monitor, Investigate, Qualify, Reject, and Archive actions where possible.</div>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, mode === "create" ? "opportunity_candidate.create" : "opportunity_candidate.update")}>{mode === "create" ? "Create Candidate" : "Save Candidate"}</button>
          <Link href={candidateId ? `/opportunities/candidates/${candidateId}` : "/opportunities/candidates"}>Cancel</Link>
        </div>
      </form>
    </OpportunityShell>
  );
}

export function CandidateDetail({ candidateId }: { candidateId: string }) {
  const session = useSession();
  const [data, setData] = useState<CandidateData>(emptyData);
  const [candidate, setCandidate] = useState<CandidateView | null>(null);
  const [scoreSummary, setScoreSummary] = useState<SyncRecord | null>(null);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [nextData, detail, timeline, audit] = await Promise.all([
        loadCandidateData(),
        syncosFetch<SyncRecord>(`/opportunity-candidates/${candidateId}/detail`),
        optionalList(`/opportunity-candidates/${candidateId}/timeline`),
        optionalList(`/opportunity-candidates/${candidateId}/audit-summary`),
      ]);
      const row = {
        ...(detail.candidate as SyncRecord),
        organization_context: detail.organization_context,
        attached_signals: detail.attached_signals,
        relationship_map_context: detail.relationship_map_context,
        constraints_summary: detail.constraints_summary,
        recommendations_summary: detail.recommendations_summary,
        timeline,
        audit,
      } as SyncRecord;
      const signals = Array.isArray(detail.attached_signals) ? detail.attached_signals as SyncRecord[] : [];
      const merged = {
        ...nextData,
        candidates: [row, ...nextData.candidates.filter((candidateRow) => candidateRow.id !== row.id)],
        candidateSignalsByCandidate: { ...nextData.candidateSignalsByCandidate, [candidateId]: signals },
      };
      setData(merged);
      setCandidate(enrichCandidate(row, merged));
      setScoreSummary(detail.score_summary && typeof detail.score_summary === "object" ? detail.score_summary as SyncRecord : null);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [candidateId]);

  const tabs = ["overview", "organization", "signals", "relationship", "capacity", "constraints", "recommendations", "timeline", "audit"];

  return (
    <OpportunityShell title="Opportunity Candidate Detail" purpose="Review whether this intelligence-backed candidate should be monitored, investigated, qualified, rejected, or archived.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!candidate ? (
        <section className="workspace-panel"><div className="empty-state">Candidate not found or you do not have access.</div></section>
      ) : (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{candidate.name}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(candidate.status)}</span>
                  <span className="badge">{candidate.organization ? textValue(candidate.organization.name) : "No organization"}</span>
                  <span className="badge">{textValue(candidate.work_type, "Unknown work type")}</span>
                  <span className="badge">{candidate.signalLinks.length} signals</span>
                </div>
              </div>
              <div className="form-actions">
                <Link href={`/opportunities/candidates/${candidate.id}/edit`}>Edit Candidate</Link>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.monitor") || candidate.status === "archived"} onClick={() => void lifecycle(candidate, "monitor", load, setError)}>Monitor</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.investigate") || candidate.status === "archived"} onClick={() => void lifecycle(candidate, "investigate", load, setError)}>Investigate</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.qualify") || candidate.status === "archived"} onClick={() => void lifecycle(candidate, "qualify", load, setError)}>Qualify</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.reject") || candidate.status === "archived"} onClick={() => setModal("reject")}>Reject</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.archive") || candidate.status === "archived"} onClick={() => setModal("archive")}>Archive</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.assign_owner") || candidate.status === "archived"} onClick={() => setModal("owner")}>Assign Owner</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.link_relationship_map") || candidate.status === "archived"} onClick={() => setModal("relationship")}>{candidate.relationshipMap ? "Change Relationship Map" : "Link Relationship Map"}</button>
                <button type="button" disabled={!hasPermission(session.permissions, "candidate_signal.create") || candidate.status === "archived"} onClick={() => setModal("signal")}>Attach Signal</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.score") || candidate.status === "archived"} onClick={() => void scoreCandidate(candidate, load, setError)}>Score Candidate</button>
                <button type="button" onClick={() => setModal("research")}>Research Candidate</button>
              </div>
            </div>
            <div className="summary-grid">
              <SummaryMetric label="Candidate Score" value={scoreValue(candidate.candidateScore)} />
              <SummaryMetric label="Confidence Score" value={scoreValue(candidate.confidenceScore)} />
              <SummaryMetric label="Estimated Value" value={moneyValue(candidate.estimated_value)} />
              <SummaryMetric label="Signal Count" value={String(candidate.signalLinks.length)} />
              <SummaryMetric label="Relationship Access" value={scoreValue(candidate.relationshipAccessScore)} />
              <SummaryMetric label="Organization Work Relevance" value={scoreValue(nullableNumber(candidate.organization?.work_relevance_score))} />
              <SummaryMetric label="Capacity Fit" value={scoreValue(nullableNumber(candidate.capacity_fit_score))} />
              <SummaryMetric label="Open Constraints" value={String(relatedConstraints(candidate, data).length)} />
              <SummaryMetric label="Next Action" value={formatAction(candidate.recommendedNextAction)} />
            </div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Status</dt><dd>{formatAction(candidate.status)}</dd>
                <dt>Owner</dt><dd>{textValue(candidate.owner_name ?? candidate.owner_user_id)}</dd>
                <dt>Organization</dt><dd>{candidate.organization ? textValue(candidate.organization.name) : "Not linked"}</dd>
                <dt>Actor roles</dt><dd>{arrayValue(candidate.organization?.actor_roles).map(formatAction).join(", ") || "Not captured yet"}</dd>
                <dt>Territory</dt><dd>{textValue(candidate.territory_name ?? candidate.territory_id)}</dd>
                <dt>Work type</dt><dd>{formatAction(candidate.work_type)}</dd>
                <dt>Estimated value</dt><dd>{moneyValue(candidate.estimated_value)}</dd>
                <dt>Relationship access</dt><dd>{candidate.relationshipMap ? "Connected" : "Not linked"}</dd>
              </dl>
              <Checklist title="Candidate readiness" items={candidateReadiness(candidate)} />
              {candidate.missingItems.length ? <div className="empty-state">Key warnings: {candidate.missingItems.map(formatAction).join(", ")}</div> : null}
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}
              </div>
              <CandidateTab tab={tab} candidate={candidate} data={data} scoreSummary={scoreSummary} permissions={session.permissions} onAttach={() => setModal("signal")} />
            </section>
          </div>
          {modal === "signal" ? <AttachSignalModal candidate={candidate} data={data} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "owner" ? <AssignOwnerModal candidate={candidate} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "relationship" ? <RelationshipMapModal candidate={candidate} data={data} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "reject" ? <RejectModal candidate={candidate} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "archive" ? <ArchiveModal candidate={candidate} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "research" ? <ResearchModal candidate={candidate} onClose={() => setModal("")} /> : null}
        </>
      )}
    </OpportunityShell>
  );
}

function CandidateKanban({ candidates }: { candidates: CandidateView[] }) {
  return (
    <div className="detail-grid">
      {boardStatuses.map((status) => (
        <div className="workspace-panel" key={status}>
          <h2>{formatAction(status)}</h2>
          {candidates.filter((candidate) => candidate.status === status).map((candidate) => <CandidateCard candidate={candidate} key={candidate.id} />)}
          {candidates.filter((candidate) => candidate.status === status).length === 0 ? <div className="empty-state">No candidates in this status.</div> : null}
        </div>
      ))}
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: CandidateView }) {
  return (
    <div className="summary-card">
      <strong><Link className="table-link" href={`/opportunities/candidates/${candidate.id}`}>{candidate.name}</Link></strong>
      <span>{candidate.organization ? textValue(candidate.organization.name) : "No organization"}</span>
      <div className="mini-grid">
        <span>Territory: {textValue(candidate.territory_name ?? candidate.territory_id)}</span>
        <span>Work: {formatAction(candidate.work_type)}</span>
        <span>Value: {moneyValue(candidate.estimated_value)}</span>
        <span>Confidence: {scoreValue(candidate.confidenceScore)}</span>
        <span>Candidate score: {scoreValue(candidate.candidateScore)}</span>
        <span>Relationship: {scoreValue(candidate.relationshipAccessScore)}</span>
        <span>Signals: {candidate.signalLinks.length}</span>
        <span>Owner: {textValue(candidate.owner_name ?? candidate.owner_user_id)}</span>
        <span>Next: {formatAction(candidate.recommendedNextAction)}</span>
      </div>
    </div>
  );
}

function CandidateTable({ candidates }: { candidates: CandidateView[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Candidate Name", "Status", "Organization", "Territory", "Work Type", "Estimated Value", "Confidence Score", "Candidate Score", "Relationship Access", "Signal Count", "Owner", "Created Date", "Updated Date", "Recommended Next Action"].map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.id}>
              <td><Link className="table-link" href={`/opportunities/candidates/${candidate.id}`}>{candidate.name}</Link></td>
              <td><span className="badge">{formatAction(candidate.status)}</span></td>
              <td>{candidate.organization ? <Link href={`/intelligence/organizations/${candidate.organization.id}`}>{textValue(candidate.organization.name)}</Link> : "Not linked"}</td>
              <td>{textValue(candidate.territory_name ?? candidate.territory_id)}</td>
              <td>{formatAction(candidate.work_type)}</td>
              <td>{moneyValue(candidate.estimated_value)}</td>
              <td>{scoreValue(candidate.confidenceScore)}</td>
              <td>{scoreValue(candidate.candidateScore)}</td>
              <td>{candidate.relationshipMap ? <Link href={`/intelligence/relationship-maps/${candidate.relationshipMap.id}`}>{scoreValue(candidate.relationshipAccessScore)}</Link> : scoreValue(candidate.relationshipAccessScore)}</td>
              <td>{candidate.signalLinks.length}</td>
              <td>{textValue(candidate.owner_name ?? candidate.owner_user_id)}</td>
              <td>{dateValue(candidate.created_at)}</td>
              <td>{dateValue(candidate.updated_at)}</td>
              <td>{formatAction(candidate.recommendedNextAction)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidateTab({ tab, candidate, data, scoreSummary, permissions, onAttach }: { tab: string; candidate: CandidateView; data: CandidateData; scoreSummary: SyncRecord | null; permissions: string[]; onAttach: () => void }) {
  if (tab === "overview") {
    return (
      <div className="workspace-panel">
        <SummaryMetric label="Candidate summary" value={textValue(candidate.summary ?? candidate.evidence_summary, "No summary captured yet.")} />
        <SummaryMetric label="Why this candidate matters" value="This candidate represents possible telecom work that has not yet become a formal opportunity. It should be monitored, investigated, qualified, or rejected based on evidence, relationship access, capacity fit, and strategic relevance." />
        <SummaryMetric label="Source / origin" value={candidate.source_type ? formatAction(candidate.source_type) : candidate.signals.length ? "Attached signal intelligence" : "Not linked yet"} />
        <SummaryMetric label="Work type" value={formatAction(candidate.work_type)} />
        <SummaryMetric label="Estimated value" value={moneyValue(candidate.estimated_value)} />
        <SummaryMetric label="Created" value={dateValue(candidate.created_at)} />
        <SummaryMetric label="Updated" value={dateValue(candidate.updated_at)} />
        <SummaryMetric label="Owner" value={textValue(candidate.owner_name ?? candidate.owner_user_id)} />
        <SummaryMetric label="Status explanation" value={statusExplanation(candidate.status)} />
        <ObjectSlice title="Score Summary" rows={scoreSummary ? [scoreSummary] : []} columns={["candidate_score", "signal_avg", "relationship_access_score", "capacity_fit_score", "strategic_fit_score", "risk_score"]} empty="This candidate has not been scored yet." />
      </div>
    );
  }
  if (tab === "organization") {
    return <ObjectSlice title="Related Organization" rows={candidate.organization ? [candidate.organization] : []} columns={["name", "organization_type", "actor_roles", "territory_name", "status", "relationship_owner_name", "strategic_flag", "influence_score", "work_relevance_score", "payment_relevance_score", "recommended_next_action"]} empty="This candidate is not connected to an organization. Attach an organization before qualification." />;
  }
  if (tab === "signals") {
    return <ObjectSlice title="Related Signals" rows={candidate.signals} columns={["title", "category", "type", "confidence_score", "trust_level", "status", "source_name", "date_discovered", "contribution_score"]} empty="No signals are attached to this candidate yet. Attach at least one signal before qualification." action={hasPermission(permissions, "candidate_signal.create") ? <button type="button" onClick={onAttach}>Attach Signal</button> : undefined} />;
  }
  if (tab === "relationship") {
    return (
      <div className="workspace-panel">
        <ObjectSlice title="Relationship Access" rows={candidate.relationshipMap ? [candidate.relationshipMap] : []} columns={["name", "map_type", "status", "target_organization_name", "target_contact_name", "relationship_access_score", "best_path_strength", "best_path_confidence", "recommended_next_action"]} empty="No relationship access is connected yet. Build or link a relationship map before pursuit." />
        {candidate.relationshipMap ? <Link className="primary-button link-button" href={`/intelligence/relationship-maps/${candidate.relationshipMap.id}`}>Open Relationship Map</Link> : <button type="button" disabled>Create Relationship Map</button>}
      </div>
    );
  }
  if (tab === "capacity") {
    return (
      <div className="empty-state">
        Capacity fit will be evaluated in a later Capacity Workspace sprint. For now, use this section to flag whether the candidate appears to require capacity review. Current backend score: {scoreValue(nullableNumber(candidate.capacity_fit_score))}.
      </div>
    );
  }
  if (tab === "constraints") return <ObjectSlice title="Constraints" rows={relatedConstraints(candidate, data)} columns={["constraint_type", "severity", "owner_id", "due_date", "status", "resolution_summary"]} empty="No active constraints are tied to this candidate." action={hasPermission(permissions, "constraint.create") ? <button type="button" disabled>Create Constraint</button> : undefined} />;
  if (tab === "recommendations") return <ObjectSlice title="Recommendations" rows={relatedRecommendations(candidate, data)} columns={["recommendation_type", "confidence_score", "risk_level", "expected_impact", "status", "owner_id"]} empty="No recommendations are tied to this candidate." />;
  if (tab === "timeline") return <ObjectSlice title="Candidate Timeline" rows={candidate.timeline} columns={["event_type", "actor_name", "timestamp", "object_type", "object_id", "summary"]} empty="Candidate timeline endpoint is not available yet." />;
  if (tab === "audit") return <ObjectSlice title="Candidate Audit" rows={candidate.audit} columns={["actor_name", "action", "object_type", "object_id", "before_json", "after_json", "reason", "created_at", "correlation_id"]} empty="Candidate audit summary is not available or you do not have permission." />;
  return null;
}

function AssignOwnerModal({ candidate, onClose, onSaved }: { candidate: CandidateView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [ownerUserId, setOwnerUserId] = useState(textValue(candidate.owner_user_id, ""));
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!ownerUserId) return setError("Owner user id is required.");
    try {
      await syncosFetch(`/opportunity-candidates/${candidate.id}/assign-owner`, { method: "POST", body: { owner_user_id: ownerUserId } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Assign Candidate Owner" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="compact-modal" onSubmit={(event) => void submit(event)}>
        <label>Owner user id<input value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} /></label>
        <button className="primary-button" type="submit">Assign Owner</button>
      </form>
    </Modal>
  );
}

function RelationshipMapModal({ candidate, data, onClose, onSaved }: { candidate: CandidateView; data: CandidateData; onClose: () => void; onSaved: () => Promise<void> }) {
  const [relationshipMapId, setRelationshipMapId] = useState(textValue(candidate.relationship_map_id, ""));
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (relationshipMapId) {
        await syncosFetch(`/opportunity-candidates/${candidate.id}/link-relationship-map`, { method: "POST", body: { relationship_map_id: relationshipMapId } });
      } else {
        await syncosFetch(`/opportunity-candidates/${candidate.id}/unlink-relationship-map`, { method: "POST", body: {} });
      }
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Link Relationship Map" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="compact-modal" onSubmit={(event) => void submit(event)}>
        <label>Relationship map<SelectInline value={relationshipMapId} options={["", ...data.relationshipMaps.map((map) => String(map.id))]} labels={labelMap(data.relationshipMaps, "map_name")} onChange={setRelationshipMapId} /></label>
        <div className="empty-state">Select a tenant-scoped relationship map to make relationship access backend-truthful for this candidate. Leave blank to unlink.</div>
        <button className="primary-button" type="submit">Save Relationship Link</button>
      </form>
    </Modal>
  );
}

function AttachSignalModal({ candidate, data, onClose, onSaved }: { candidate: CandidateView; data: CandidateData; onClose: () => void; onSaved: () => Promise<void> }) {
  const [signalId, setSignalId] = useState("");
  const [contribution, setContribution] = useState("50");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!signalId) return setError("Select a signal to attach.");
    try {
      await syncosFetch(`/opportunity-candidates/${candidate.id}/signals`, { method: "POST", body: { signal_id: signalId, contribution_score: optionalNumber(contribution) ?? 50, contribution_note: note } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Attach Signal" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="compact-modal" onSubmit={(event) => void submit(event)}>
        <label>Signal<SelectInline value={signalId} options={["", ...data.signals.map((signal) => String(signal.id))]} labels={labelMap(data.signals, "title")} onChange={setSignalId} /></label>
        <label>Contribution score<input value={contribution} onChange={(event) => setContribution(event.target.value)} type="number" min="0" max="100" /></label>
        <label>Contribution note<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="primary-button" type="submit">Attach Signal</button>
      </form>
    </Modal>
  );
}

function RejectModal({ candidate, onClose, onSaved }: { candidate: CandidateView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("insufficient_evidence");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/opportunity-candidates/${candidate.id}/reject`, { method: "POST", body: { rejection_reason: reason, rejection_note: note } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Reject Candidate" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="compact-modal" onSubmit={(event) => void submit(event)}>
        <label>Reason<SelectInline value={reason} options={rejectReasons} onChange={setReason} /></label>
        <label>Note<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="primary-button" type="submit">Reject Candidate</button>
      </form>
    </Modal>
  );
}

function ArchiveModal({ candidate, onClose, onSaved }: { candidate: CandidateView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("stale");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/opportunity-candidates/${candidate.id}/archive`, { method: "POST", body: { archive_reason: reason, archive_note: note } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Archive Candidate" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="compact-modal" onSubmit={(event) => void submit(event)}>
        <label>Reason<SelectInline value={reason} options={archiveReasons} onChange={setReason} /></label>
        <label>Note<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="primary-button" type="submit">Archive Candidate</button>
      </form>
    </Modal>
  );
}

function ResearchModal({ candidate, onClose }: { candidate: CandidateView; onClose: () => void }) {
  return (
    <Modal title="Research Candidate" onClose={onClose}>
      <div className="empty-state">AI-assisted candidate research will help enrich who, what, when, where, why, and how this possible work may become an opportunity. No automatic field updates occur without human approval.</div>
      <ObjectSlice title="AI Candidate Research Placeholder" rows={[{
        candidate_summary: candidate.name,
        related_organization: textValue(candidate.organization?.name),
        related_signals: String(candidate.signalLinks.length),
        possible_work_type: formatAction(candidate.work_type),
        territory: textValue(candidate.territory_name ?? candidate.territory_id),
        relationship_access: candidate.relationshipMap ? "Connected" : "Not linked",
        missing_evidence: candidate.signalLinks.length ? "None detected from attached signals" : "No attached signals",
        missing_contacts: "Not captured yet",
        missing_capacity_information: "Capacity workspace deferred",
        strategic_fit: scoreValue(nullableNumber(candidate.strategic_fit_score)),
        recommended_next_action: formatAction(candidate.recommendedNextAction),
        sources: "Approved sources placeholder",
        confidence: "No live AI analysis in this sprint",
        timestamp: "Not generated",
        suggested_field_updates: "No automatic updates",
      }]} columns={["candidate_summary", "related_organization", "related_signals", "possible_work_type", "territory", "relationship_access", "missing_evidence", "missing_contacts", "missing_capacity_information", "strategic_fit", "recommended_next_action", "sources", "confidence", "timestamp", "suggested_field_updates"]} empty="" />
    </Modal>
  );
}

async function loadCandidateData(): Promise<CandidateData> {
  const unavailable: string[] = [];
  const [candidates, organizations, signals, contacts, relationshipMaps, constraints, recommendations] = await Promise.all([
    optionalList("/opportunity-candidates", unavailable, "opportunity candidates"),
    optionalList("/organizations", unavailable, "organizations"),
    optionalList("/signals", unavailable, "signals"),
    optionalList("/contacts", unavailable, "contacts"),
    optionalList("/relationship-maps", unavailable, "relationship maps"),
    optionalList("/constraints", unavailable, "constraints"),
    optionalList("/recommendations", unavailable, "recommendations"),
  ]);
  const candidateSignalsByCandidate: Record<string, SyncRecord[]> = {};
  await Promise.all(candidates.map(async (candidate) => {
    const id = String(candidate.id ?? "");
    if (!id) return;
    candidateSignalsByCandidate[id] = await optionalList(`/opportunity-candidates/${id}/signals`, unavailable, "candidate signals");
  }));
  return { candidates, organizations, signals, contacts, relationshipMaps, constraints, recommendations, candidateSignalsByCandidate, unavailable };
}

async function optionalList(path: string, unavailable: string[] = [], label = path): Promise<SyncRecord[]> {
  try {
    const result = await syncosFetch<unknown>(path);
    return Array.isArray(result) ? result as SyncRecord[] : [];
  } catch {
    unavailable.push(label);
    return [];
  }
}

async function optionalRecord(path: string): Promise<SyncRecord | null> {
  try {
    const result = await syncosFetch<unknown>(path);
    return result && typeof result === "object" && !Array.isArray(result) ? result as SyncRecord : null;
  } catch {
    return null;
  }
}

function enrichCandidate(candidate: SyncRecord, data: CandidateData): CandidateView {
  const id = String(candidate.id ?? "");
  const signalLinks = Array.isArray(candidate.attached_signals) ? candidate.attached_signals as SyncRecord[] : data.candidateSignalsByCandidate[id] ?? [];
  const signals: SyncRecord[] = signalLinks.map((link) => {
    const signal = data.signals.find((row) => row.id === link.signal_id) ?? {};
    return { ...signal, ...link, title: link.signal_title ?? link.title ?? signal.title, contribution_score: link.contribution_score, candidate_signal_id: link.candidate_signal_id ?? link.id } as SyncRecord;
  }).filter((signal) => signal.id || signal.candidate_signal_id);
  const organization = objectRecord(candidate.organization_context) ?? data.organizations.find((row) => row.id === candidate.organization_id) ?? objectFromPrefix(candidate, "organization");
  const relationshipMap = objectRecord(candidate.relationship_map_context) ?? bestRelationshipMap(candidate, data.relationshipMaps);
  const relationshipAccessScore = nullableNumber(candidate.relationship_access_score ?? relationshipMap?.relationship_access_score);
  const candidateScore = nullableNumber(candidate.score ?? candidate.candidate_score);
  const confidenceScore = nullableNumber(candidate.confidence_score);
  const enriched: CandidateView = {
    ...candidate,
    id,
    name: textValue(candidate.name ?? candidate.title, "Untitled candidate"),
    status: textValue(candidate.normalized_status ?? normalizeCandidateStatus(candidate.status), "created"),
    organization,
    signals,
    signalLinks,
    relationshipMap,
    candidateScore,
    confidenceScore,
    relationshipAccessScore,
    recommendedNextAction: "",
    readyForOpportunity: false,
    missingItems: [],
    timeline: Array.isArray(candidate.timeline) ? candidate.timeline as SyncRecord[] : [],
    audit: Array.isArray(candidate.audit) ? candidate.audit as SyncRecord[] : [],
  };
  enriched.missingItems = arrayValue(candidate.missing_candidate_items).length ? arrayValue(candidate.missing_candidate_items) : missingCandidateItems(enriched);
  enriched.readyForOpportunity = Boolean(candidate.candidate_ready_for_opportunity) || (enriched.status === "qualified" && enriched.missingItems.length === 0);
  enriched.recommendedNextAction = textValue(candidate.recommended_next_action, "") || recommendedNextAction(enriched);
  return enriched;
}

function bestRelationshipMap(candidate: SyncRecord, relationshipMaps: SyncRecord[]) {
  if (!candidate.relationship_map_id) return undefined;
  return relationshipMaps.find((map) => map.id === candidate.relationship_map_id);
}

function missingCandidateItems(candidate: CandidateView) {
  const missing: string[] = [];
  if (!candidate.organization) missing.push("organization");
  if (!candidate.territory_id && !candidate.territory_name) missing.push("territory");
  if (Number(candidate.active_signal_count ?? candidate.signalLinks.length) === 0) missing.push("signals");
  if (candidate.confidenceScore === null) missing.push("confidence_score");
  if (candidate.candidateScore === null && candidate.score === undefined) missing.push("candidate_score");
  if (!candidate.relationship_map_id) missing.push("relationship_map");
  else if (candidate.relationshipAccessScore === null || candidate.relationshipAccessScore < 50) missing.push("relationship_access");
  return missing;
}

function candidateReadiness(candidate: CandidateView): [string, boolean][] {
  return [
    ["Organization attached", Boolean(candidate.organization)],
    ["Territory attached", Boolean(candidate.territory_id ?? candidate.territory_name)],
    ["At least one signal attached", Number(candidate.active_signal_count ?? candidate.signalLinks.length) > 0],
    ["Confidence score captured", candidate.confidenceScore !== null],
    ["Candidate score captured", candidate.candidateScore !== null || candidate.score !== undefined],
    ["Relationship access available", candidate.relationshipAccessScore !== null && candidate.relationshipAccessScore >= 50],
    ["No critical constraints", true],
    ["Qualified status if ready", candidate.status === "qualified"],
  ];
}

function recommendedNextAction(candidate: CandidateView) {
  if (candidate.status === "archived") return "view_only";
  if (candidate.status === "rejected") return "review_rejection";
  if (!candidate.organization) return "attach_organization";
  if (!candidate.territory_id && !candidate.territory_name) return "attach_territory";
  if (Number(candidate.active_signal_count ?? candidate.signalLinks.length) === 0) return "attach_signal";
  if (!candidate.relationship_map_id) return "link_relationship_map";
  if (candidate.relationshipAccessScore === null || candidate.relationshipAccessScore < 50) return "build_relationship_access";
  if (candidate.confidenceScore === null && candidate.candidateScore === null) return "score_candidate";
  if (candidate.status === "created") return "monitor_or_investigate";
  if (candidate.status === "monitoring") return "investigate";
  if (candidate.status === "investigating" && ((candidate.candidateScore ?? 0) >= 60 || (candidate.confidenceScore ?? 0) >= 60)) return "qualify_candidate";
  if (candidate.status === "qualified") return "ready_for_opportunity_later";
  return "continue_review";
}

function candidateMatchesFilters(candidate: CandidateView, filters: Filters) {
  const haystack = [candidate.name, candidate.status, candidate.organization?.name, candidate.work_type, candidate.evidence_summary].join(" ").toLowerCase();
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.status && candidate.status !== filters.status) return false;
  if (filters.organizationId && candidate.organization_id !== filters.organizationId) return false;
  if (filters.territoryId && String(candidate.territory_id ?? "") !== filters.territoryId) return false;
  if (filters.workType && candidate.work_type !== filters.workType) return false;
  if (filters.confidenceMin && (candidate.confidenceScore ?? -1) < Number(filters.confidenceMin)) return false;
  if (filters.confidenceMax && (candidate.confidenceScore ?? 101) > Number(filters.confidenceMax)) return false;
  if (filters.scoreMin && (candidate.candidateScore ?? -1) < Number(filters.scoreMin)) return false;
  if (filters.relationshipMin && (candidate.relationshipAccessScore ?? -1) < Number(filters.relationshipMin)) return false;
  if (filters.owner && String(candidate.owner_user_id ?? "") !== filters.owner) return false;
  const activeSignalCount = Number(candidate.active_signal_count ?? candidate.signalLinks.length);
  if (filters.hasSignals === "true" && activeSignalCount === 0) return false;
  if (filters.hasSignals === "false" && activeSignalCount > 0) return false;
  if (filters.hasOrganization === "true" && !candidate.organization) return false;
  if (filters.hasOrganization === "false" && candidate.organization) return false;
  if (filters.hasRelationshipMap === "true" && !candidate.relationshipMap) return false;
  if (filters.hasRelationshipMap === "false" && candidate.relationshipMap) return false;
  if (filters.archived === "true" && candidate.status !== "archived") return false;
  if (filters.archived === "false" && candidate.status === "archived") return false;
  return true;
}

function sortCandidates(candidates: CandidateView[], sort: string) {
  return [...candidates].sort((a, b) => {
    if (sort === "default" || sort === "score_desc") return (b.candidateScore ?? -1) - (a.candidateScore ?? -1) || dateNumber(b.updated_at) - dateNumber(a.updated_at);
    if (sort === "confidence_desc") return (b.confidenceScore ?? -1) - (a.confidenceScore ?? -1);
    if (sort === "relationship_desc") return (b.relationshipAccessScore ?? -1) - (a.relationshipAccessScore ?? -1);
    if (sort === "status") return a.status.localeCompare(b.status);
    if (sort === "organization") return textValue(a.organization?.name, "").localeCompare(textValue(b.organization?.name, ""));
    if (sort === "created_desc") return dateNumber(b.created_at) - dateNumber(a.created_at);
    if (sort === "value_desc") return (nullableNumber(b.estimated_value) ?? -1) - (nullableNumber(a.estimated_value) ?? -1);
    return dateNumber(b.updated_at) - dateNumber(a.updated_at);
  });
}

function buildSummary(candidates: CandidateView[]) {
  return {
    total: candidates.length,
    monitoring: candidates.filter((candidate) => candidate.status === "monitoring").length,
    investigating: candidates.filter((candidate) => candidate.status === "investigating").length,
    qualified: candidates.filter((candidate) => candidate.status === "qualified").length,
    rejected: candidates.filter((candidate) => candidate.status === "rejected").length,
    archived: candidates.filter((candidate) => candidate.status === "archived").length,
    highConfidence: candidates.filter((candidate) => (candidate.confidenceScore ?? 0) >= 75).length,
    missingOrganization: candidates.filter((candidate) => !candidate.organization).length,
    missingSignals: candidates.filter((candidate) => candidate.signalLinks.length === 0).length,
    missingRelationshipAccess: candidates.filter((candidate) => !candidate.relationshipMap).length,
    readyForOpportunity: candidates.filter((candidate) => candidate.readyForOpportunity).length,
  };
}

async function lifecycle(candidate: CandidateView, action: "monitor" | "investigate" | "qualify", onSaved: () => Promise<void>, setError: (value: string) => void) {
  setError("");
  try {
    await syncosFetch(`/opportunity-candidates/${candidate.id}/${action}`, { method: "POST", body: {} });
    await onSaved();
  } catch (nextError) {
    setError((nextError as Error).message);
  }
}

async function scoreCandidate(candidate: CandidateView, onSaved: () => Promise<void>, setError: (value: string) => void) {
  setError("");
  try {
    await syncosFetch(`/opportunity-candidates/${candidate.id}/score`, { method: "POST", body: {} });
    await onSaved();
  } catch (nextError) {
    setError((nextError as Error).message);
  }
}

function relatedConstraints(candidate: CandidateView, data: CandidateData) {
  return data.constraints.filter((constraint) =>
    (constraint.affected_object_type === "opportunity_candidate" && constraint.affected_object_id === candidate.id) ||
    (constraint.related_object_type === "opportunity_candidate" && constraint.related_object_id === candidate.id),
  );
}

function relatedRecommendations(candidate: CandidateView, data: CandidateData) {
  const constraints = relatedConstraints(candidate, data);
  return data.recommendations.filter((recommendation) =>
    (recommendation.related_object_type === "opportunity_candidate" && recommendation.related_object_id === candidate.id) ||
    (recommendation.constraint_id && constraints.some((constraint) => constraint.id === recommendation.constraint_id)),
  );
}

function statusExplanation(status: string) {
  const explanations: Record<string, string> = {
    created: "Candidate exists but has not been actively worked.",
    monitoring: "Candidate is worth watching but not ready for investigation.",
    investigating: "User is gathering more intelligence.",
    qualified: "Candidate has enough evidence to support future opportunity creation.",
    rejected: "Candidate should not be pursued.",
    archived: "Candidate is preserved but inactive.",
  };
  return explanations[status] ?? "Status is controlled by the backend candidate lifecycle.";
}

function UnsupportedNotice({ unavailable }: { unavailable: string[] }) {
  return (
    <div className="empty-state">
      Candidate workspace uses enriched candidate, signal, organization, relationship map, constraint, recommendation, timeline, and audit APIs. Unsupported downstream opportunity, capacity, and finance execution remains intentionally deferred.
      {unavailable.length ? <p className="muted">Unavailable reads in this session: {unique(unavailable).join(", ")}.</p> : null}
    </div>
  );
}

function ObjectSlice({ title, rows, columns, empty, action }: { title: string; rows: SyncRecord[]; columns: string[]; empty: string; action?: ReactNode }) {
  return (
    <div className="workspace-panel">
      <div className="section-toolbar">
        <h2>{title}</h2>
        {action}
      </div>
      {!rows.length ? <div className="empty-state">{empty}</div> : (
        <div className="wide-table">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{formatAction(column)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? row.candidate_signal_id ?? index)}>
                  {columns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SessionPanel({ session }: { session: ReturnType<typeof useSession> }) {
  return (
    <section className="workspace-panel">
      <div className="section-toolbar">
        <div>
          <h2>Session</h2>
          <p className="muted">Paste a JWT and comma-separated permissions to test permission-aware candidate actions.</p>
        </div>
        <button type="button" onClick={() => session.applyDefaults()}>Use opportunity defaults</button>
      </div>
      <div className="session-grid">
        <input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" />
        <input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" />
      </div>
    </section>
  );
}

function SummaryCard({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return <button type="button" className="summary-card" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="summary-card" role="group"><span>{label}</span><strong>{value}</strong></div>;
}

function Checklist({ title, items }: { title: string; items: [string, boolean][] }) {
  return (
    <div className="workspace-panel">
      <h3>{title}</h3>
      {items.map(([label, complete]) => (
        <div className={`check-item ${complete ? "complete" : "missing"}`} key={label}>
          <span>{label}</span>
          <strong>{complete ? "Complete" : "Missing"}</strong>
        </div>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-panel compact-modal">
        <div className="section-toolbar">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label>{label}<SelectInline value={value} options={options} labels={labels} onChange={onChange} /></label>;
}

function SelectInline({ value, options, labels = {}, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option value={option} key={option}>{option ? labels[option] ?? formatAction(option) : "Any"}</option>)}
    </select>
  );
}

function useSession() {
  const [token, setTokenState] = useState(readToken());
  const [permissions, setPermissionsState] = useState<string[]>(unique([...defaultOpportunityPermissions, ...readPermissions()]));
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  function applyDefaults() {
    setPermissions(defaultOpportunityPermissions);
  }
  return { token, setToken, permissions, setPermissions, applyDefaults };
}

function objectFromPrefix(row: SyncRecord, prefix: string): SyncRecord | undefined {
  const id = row[`${prefix}_id`];
  if (!id) return undefined;
  const result: SyncRecord = { id };
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(`${prefix}_`) && value !== undefined) result[key.replace(`${prefix}_`, "")] = value;
  }
  return result;
}

function objectRecord(value: unknown): SyncRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SyncRecord : undefined;
}

function labelMap(rows: SyncRecord[], field: string) {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[field] ?? row.name ?? row.title, String(row.id))]));
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function optionalNumber(value: string) {
  if (value === "") return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function dateNumber(value: unknown) {
  if (!value) return 0;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function displayValue(value: unknown) {
  if (Array.isArray(value)) return value.map(formatAction).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value) return JSON.stringify(value);
  if (String(value ?? "").includes("T")) return dateValue(value);
  return textValue(value, "Not captured yet");
}

function scoreValue(value: number | null) {
  return value === null ? "Not captured yet" : String(Math.round(value));
}

function moneyValue(value: unknown) {
  const next = nullableNumber(value);
  return next === null ? "Not captured yet" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(next);
}

function normalizeCandidateStatus(value: unknown) {
  return value === "qualified_candidate" ? "qualified" : textValue(value, "created");
}

function formatAction(value: unknown) {
  const text = textValue(value, "Not captured yet");
  return text.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function prune(values: SyncRecord) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

const emptyData: CandidateData = {
  candidates: [],
  organizations: [],
  signals: [],
  contacts: [],
  relationshipMaps: [],
  constraints: [],
  recommendations: [],
  candidateSignalsByCandidate: {},
  unavailable: [],
};
