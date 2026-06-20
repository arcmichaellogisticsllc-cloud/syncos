"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  dateValue,
  defaultOpportunityPermissions,
  hasPermission,
  readPermissions,
  readToken,
  savePermissions,
  saveToken,
  syncosFetch,
  textValue,
  type SyncRecord,
} from "../../intelligence/api";
import { OpportunityShell } from "../opportunity-shell";

const productStatuses = ["draft", "pursuit_review", "pursuit_approved", "pursuing", "proposal", "negotiation", "awarded", "lost", "deferred", "archived"];
const workTypes = ["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"];
const lostReasons = ["price", "relationship_access", "capacity", "schedule", "compliance", "competitor", "customer_cancelled", "poor_fit", "other"];
const deferredReasons = ["timing", "funding_delay", "relationship_gap", "capacity_gap", "customer_delay", "more_research_needed", "other"];

type OpportunityData = {
  opportunities: SyncRecord[];
  candidates: SyncRecord[];
  organizations: SyncRecord[];
  relationshipMaps: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  capacityByOpportunity: Record<string, SyncRecord[]>;
  unavailable: string[];
};

type OpportunityView = SyncRecord & {
  id: string;
  name: string;
  backendStatus: string;
  productStatus: string;
  organization?: SyncRecord;
  candidate?: SyncRecord;
  relationshipMap?: SyncRecord;
  capacityRequirements: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  relationshipAccessScore: number | null;
  pursuitScore: number | null;
  estimatedValue: number | null;
  recommendedNextAction: string;
};

type Filters = {
  q: string;
  status: string;
  organizationId: string;
  territoryId: string;
  workType: string;
  valueMin: string;
  valueMax: string;
  pursuitMin: string;
  relationshipMin: string;
  owner: string;
  hasCandidate: string;
  hasRelationshipMap: string;
  hasCapacity: string;
  hasConstraints: string;
  archived: string;
  sort: string;
};

const initialFilters: Filters = {
  q: "",
  status: "",
  organizationId: "",
  territoryId: "",
  workType: "",
  valueMin: "",
  valueMax: "",
  pursuitMin: "",
  relationshipMin: "",
  owner: "",
  hasCandidate: "",
  hasRelationshipMap: "",
  hasCapacity: "",
  hasConstraints: "",
  archived: "false",
  sort: "default",
};

export function OpportunityPipeline() {
  const session = useSession();
  const [data, setData] = useState<OpportunityData>(emptyData);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [view, setView] = useState<"board" | "table">("board");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await loadOpportunityData());
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const opportunities = useMemo(() => {
    const enriched = data.opportunities.map((opportunity) => enrichOpportunity(opportunity, data));
    return sortOpportunities(enriched.filter((opportunity) => opportunityMatchesFilters(opportunity, filters)), filters.sort);
  }, [data, filters]);
  const summary = useMemo(() => buildSummary(data.opportunities.map((opportunity) => enrichOpportunity(opportunity, data))), [data]);

  return (
    <OpportunityShell title="Opportunity Pipeline" purpose="Manage work Jackson has decided is worth pursuing without creating execution or finance records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <UnsupportedNotice unavailable={data.unavailable} />
      <div className="warning-box">
        Relationship access is not a creation blocker in this workspace. The current backend may still block pursuit approval when no relationship path exists; the UI does not bypass that backend rule.
      </div>
      <div className="summary-grid">
        <SummaryCard label="Total Opportunities" value={summary.total} onClick={() => setFilters(initialFilters)} />
        <SummaryCard label="Draft" value={summary.draft} onClick={() => setFilters({ ...initialFilters, status: "draft" })} />
        <SummaryCard label="Pursuit Review" value={summary.pursuitReview} onClick={() => setFilters({ ...initialFilters, status: "pursuit_review" })} />
        <SummaryCard label="Pursuit Approved" value={summary.pursuitApproved} onClick={() => setFilters({ ...initialFilters, status: "pursuit_approved" })} />
        <SummaryCard label="Pursuing" value={summary.pursuing} onClick={() => setFilters({ ...initialFilters, status: "pursuing" })} />
        <SummaryCard label="Proposal" value={summary.proposal} onClick={() => setFilters({ ...initialFilters, status: "proposal" })} />
        <SummaryCard label="Negotiation" value={summary.negotiation} onClick={() => setFilters({ ...initialFilters, status: "negotiation" })} />
        <SummaryCard label="Awarded" value={summary.awarded} onClick={() => setFilters({ ...initialFilters, status: "awarded", archived: "" })} />
        <SummaryCard label="Lost" value={summary.lost} onClick={() => setFilters({ ...initialFilters, status: "lost", archived: "" })} />
        <SummaryCard label="Deferred" value={summary.deferred} onClick={() => setFilters({ ...initialFilters, status: "deferred", archived: "" })} />
        <SummaryCard label="High Value" value={summary.highValue} onClick={() => setFilters({ ...initialFilters, valueMin: "50000" })} />
        <SummaryCard label="Weak Relationship Access" value={summary.weakRelationship} onClick={() => setFilters({ ...initialFilters, relationshipMin: "", hasRelationshipMap: "" })} />
        <SummaryCard label="Missing Capacity Requirements" value={summary.missingCapacity} onClick={() => setFilters({ ...initialFilters, hasCapacity: "false" })} />
        <SummaryCard label="Open Constraints" value={summary.openConstraints} onClick={() => setFilters({ ...initialFilters, hasConstraints: "true" })} />
        <SummaryCard label="Ready For Pursuit Approval" value={summary.readyForApproval} onClick={() => setFilters({ ...initialFilters, status: "draft" })} />
      </div>

      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Pipeline Work Queue</h2>
            <p className="muted">Backend statuses are mapped for display: `qualified` appears as Draft and `bid_proposal` appears as Proposal.</p>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setView(view === "board" ? "table" : "board")}>{view === "board" ? "Table View" : "Board View"}</button>
            <Link className="primary-button link-button" href="/opportunities/new" aria-disabled={!hasPermission(session.permissions, "opportunity.create")}>Create Opportunity</Link>
          </div>
        </div>
        <div className="filter-grid">
          <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search opportunities, organizations, work type" />
          <Select label="Status" value={filters.status} options={["", ...productStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
          <Select label="Organization" value={filters.organizationId} options={["", ...data.organizations.map((organization) => String(organization.id))]} labels={labelMap(data.organizations, "name")} onChange={(organizationId) => setFilters({ ...filters, organizationId })} />
          <input value={filters.territoryId} onChange={(event) => setFilters({ ...filters, territoryId: event.target.value })} placeholder="Territory id" />
          <Select label="Work type" value={filters.workType} options={["", ...workTypes]} onChange={(workType) => setFilters({ ...filters, workType })} />
          <input value={filters.valueMin} onChange={(event) => setFilters({ ...filters, valueMin: event.target.value })} type="number" min="0" placeholder="Min value" />
          <input value={filters.valueMax} onChange={(event) => setFilters({ ...filters, valueMax: event.target.value })} type="number" min="0" placeholder="Max value" />
          <input value={filters.pursuitMin} onChange={(event) => setFilters({ ...filters, pursuitMin: event.target.value })} type="number" min="0" max="100" placeholder="Min pursuit score" />
          <input value={filters.relationshipMin} onChange={(event) => setFilters({ ...filters, relationshipMin: event.target.value })} type="number" min="0" max="100" placeholder="Min relationship access" />
          <input value={filters.owner} onChange={(event) => setFilters({ ...filters, owner: event.target.value })} placeholder="Owner user id" />
          <Select label="Source candidate" value={filters.hasCandidate} options={["", "true", "false"]} onChange={(hasCandidate) => setFilters({ ...filters, hasCandidate })} />
          <Select label="Relationship map" value={filters.hasRelationshipMap} options={["", "true", "false"]} onChange={(hasRelationshipMap) => setFilters({ ...filters, hasRelationshipMap })} />
          <Select label="Capacity requirements" value={filters.hasCapacity} options={["", "true", "false"]} onChange={(hasCapacity) => setFilters({ ...filters, hasCapacity })} />
          <Select label="Open constraints" value={filters.hasConstraints} options={["", "true", "false"]} onChange={(hasConstraints) => setFilters({ ...filters, hasConstraints })} />
          <Select label="Archived" value={filters.archived} options={["", "true", "false"]} onChange={(archived) => setFilters({ ...filters, archived })} />
          <Select label="Sort" value={filters.sort} options={["default", "updated_desc", "created_desc", "value_desc", "pursuit_desc", "relationship_desc", "decision_date", "status", "organization"]} onChange={(sort) => setFilters({ ...filters, sort })} />
          <button type="button" onClick={() => setFilters(initialFilters)}>Clear filters</button>
        </div>
        <div className="quick-filter-row">
          {[
            ["Pursuit Review", { status: "pursuit_review" }],
            ["Ready For Approval", { status: "draft" }],
            ["Weak Relationship Access", { hasRelationshipMap: "" }],
            ["No Relationship Map", { hasRelationshipMap: "false" }],
            ["Missing Capacity Requirements", { hasCapacity: "false" }],
            ["High Value", { valueMin: "50000" }],
            ["Open Constraints", { hasConstraints: "true" }],
            ["Awarded", { status: "awarded", archived: "" }],
            ["Lost", { status: "lost", archived: "" }],
            ["Deferred", { status: "deferred", archived: "" }],
          ].map(([label, patch]) => (
            <button key={String(label)} type="button" onClick={() => setFilters({ ...initialFilters, ...(patch as Partial<Filters>) })}>{String(label)}</button>
          ))}
        </div>
      </section>

      <section className="workspace-panel">
        {loading ? <div className="empty-state">Loading opportunities...</div> : null}
        {!loading && opportunities.length === 0 ? (
          <div className="empty-state">
            <p>No opportunities yet. Create an opportunity only when Jackson has decided the work is worth pursuing.</p>
            <Link className="primary-button link-button" href="/opportunities/new">Create Opportunity</Link>
          </div>
        ) : null}
        {opportunities.length > 0 && view === "board" ? <OpportunityKanban opportunities={opportunities} /> : null}
        {opportunities.length > 0 && view === "table" ? <OpportunityTable opportunities={opportunities} /> : null}
      </section>
    </OpportunityShell>
  );
}

export function OpportunityForm({ mode, opportunityId }: { mode: "create" | "edit"; opportunityId?: string }) {
  const router = useRouter();
  const session = useSession();
  const [data, setData] = useState<OpportunityData>(emptyData);
  const [form, setForm] = useState({
    title: "",
    candidate_id: "",
    organization_id: "",
    territory_id: "",
    work_type: "unknown",
    estimated_value: "",
    owner_user_id: "",
    evidence_summary: "",
    scope_summary: "",
    next_action: "",
    signal_strength_score: "",
    relationship_access_score: "",
    capacity_fit_score: "",
    margin_potential_score: "",
    strategic_fit_score: "",
    payment_risk_score: "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const nextData = await loadOpportunityData();
        setData(nextData);
        if (mode === "edit" && opportunityId) {
          const opportunity = await syncosFetch<SyncRecord>(`/opportunities/${opportunityId}`);
          setForm({
            title: textValue(opportunity.title, ""),
            candidate_id: textValue(opportunity.candidate_id, ""),
            organization_id: textValue(opportunity.organization_id, ""),
            territory_id: textValue(opportunity.territory_id, ""),
            work_type: textValue(opportunity.work_type, "unknown"),
            estimated_value: textValue(opportunity.estimated_value, ""),
            owner_user_id: textValue(opportunity.owner_user_id, ""),
            evidence_summary: textValue(opportunity.evidence_summary, ""),
            scope_summary: textValue(opportunity.scope_summary, ""),
            next_action: textValue(opportunity.next_action, ""),
            signal_strength_score: textValue(opportunity.signal_strength_score, ""),
            relationship_access_score: textValue(opportunity.relationship_access_score, ""),
            capacity_fit_score: textValue(opportunity.capacity_fit_score, ""),
            margin_potential_score: textValue(opportunity.margin_potential_score, ""),
            strategic_fit_score: textValue(opportunity.strategic_fit_score, ""),
            payment_risk_score: textValue(opportunity.payment_risk_score, ""),
          });
        }
      } catch (nextError) {
        setError((nextError as Error).message);
      }
    }
    void load();
  }, [mode, opportunityId]);

  function applyCandidate(candidateId: string) {
    const candidate = data.candidates.find((row) => row.id === candidateId);
    setForm({
      ...form,
      candidate_id: candidateId,
      title: candidate ? textValue(candidate.name ?? candidate.title, form.title) : form.title,
      organization_id: candidate ? textValue(candidate.organization_id, form.organization_id) : form.organization_id,
      territory_id: candidate ? textValue(candidate.territory_id, form.territory_id) : form.territory_id,
      work_type: candidate ? textValue(candidate.work_type, form.work_type) : form.work_type,
      estimated_value: candidate ? textValue(candidate.estimated_value, form.estimated_value) : form.estimated_value,
      owner_user_id: candidate ? textValue(candidate.owner_user_id, form.owner_user_id) : form.owner_user_id,
      evidence_summary: candidate ? textValue(candidate.summary ?? candidate.evidence_summary, form.evidence_summary) : form.evidence_summary,
      relationship_access_score: candidate ? textValue(candidate.relationship_access_score, form.relationship_access_score) : form.relationship_access_score,
      signal_strength_score: candidate ? textValue(candidate.confidence_score ?? candidate.candidate_score ?? candidate.score, form.signal_strength_score) : form.signal_strength_score,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("Opportunity name is required.");
    if (!form.organization_id) return setError("Organization is required.");
    if (!form.territory_id) return setError("Territory is required.");
    if (!form.owner_user_id) return setError("Owner is required.");
    if (!form.evidence_summary.trim()) return setError("Summary / evidence is required by the current backend.");
    try {
      const body = prune({
        title: form.title,
        candidate_id: form.candidate_id,
        organization_id: form.organization_id,
        territory_id: form.territory_id,
        work_type: form.work_type,
        estimated_value: optionalNumber(form.estimated_value),
        owner_user_id: form.owner_user_id,
        evidence_summary: form.evidence_summary,
        scope_summary: form.scope_summary,
        next_action: form.next_action,
        signal_strength_score: optionalNumber(form.signal_strength_score),
        relationship_access_score: optionalNumber(form.relationship_access_score),
        capacity_fit_score: optionalNumber(form.capacity_fit_score),
        margin_potential_score: optionalNumber(form.margin_potential_score),
        strategic_fit_score: optionalNumber(form.strategic_fit_score),
        payment_risk_score: optionalNumber(form.payment_risk_score),
      });
      const saved = mode === "edit" && opportunityId
        ? await syncosFetch<SyncRecord>(`/opportunities/${opportunityId}`, { method: "PATCH", body })
        : await syncosFetch<SyncRecord>("/opportunities", { method: "POST", body });
      router.push(`/opportunities/${String(saved.id ?? opportunityId)}`);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  const qualifiedCandidates = data.candidates.filter((candidate) => normalizeCandidateStatus(candidate.status ?? candidate.normalized_status) === "qualified");

  return (
    <OpportunityShell title={mode === "create" ? "Create Opportunity" : "Edit Opportunity"} purpose="Create or update pursue-worthy work without creating downstream execution or finance records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label>Source candidate<SelectInline value={form.candidate_id} options={["", ...qualifiedCandidates.map((candidate) => String(candidate.id))]} labels={labelMap(qualifiedCandidates, "name")} onChange={applyCandidate} /></label>
          <label>Opportunity name<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
          <label>Organization<SelectInline value={form.organization_id} options={["", ...data.organizations.map((organization) => String(organization.id))]} labels={labelMap(data.organizations, "name")} onChange={(organization_id) => setForm({ ...form, organization_id })} /></label>
          <label>Territory id<input value={form.territory_id} onChange={(event) => setForm({ ...form, territory_id: event.target.value })} required /></label>
          <label>Work type<SelectInline value={form.work_type} options={workTypes} onChange={(work_type) => setForm({ ...form, work_type })} /></label>
          <label>Estimated value<input value={form.estimated_value} onChange={(event) => setForm({ ...form, estimated_value: event.target.value })} type="number" min="0" step="0.01" required /></label>
          <label>Owner user id<input value={form.owner_user_id} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} required /></label>
          <label>Relationship access score<input value={form.relationship_access_score} onChange={(event) => setForm({ ...form, relationship_access_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Pursuit score component: signal<input value={form.signal_strength_score} onChange={(event) => setForm({ ...form, signal_strength_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Capacity fit score<input value={form.capacity_fit_score} onChange={(event) => setForm({ ...form, capacity_fit_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Margin potential score<input value={form.margin_potential_score} onChange={(event) => setForm({ ...form, margin_potential_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Strategic fit score<input value={form.strategic_fit_score} onChange={(event) => setForm({ ...form, strategic_fit_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Payment risk score<input value={form.payment_risk_score} onChange={(event) => setForm({ ...form, payment_risk_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Next action<input value={form.next_action} onChange={(event) => setForm({ ...form, next_action: event.target.value })} /></label>
          <label>Summary / evidence<textarea value={form.evidence_summary} onChange={(event) => setForm({ ...form, evidence_summary: event.target.value })} required /></label>
          <label>Scope summary<textarea value={form.scope_summary} onChange={(event) => setForm({ ...form, scope_summary: event.target.value })} /></label>
        </div>
        <div className="warning-box">The current backend starts created opportunities at `qualified`, displayed here as Draft. Candidate-backed creation uses existing `POST /opportunities` with `candidate_id`; no project, capacity deployment, or finance record is created.</div>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, mode === "create" ? "opportunity.create" : "opportunity.update")}>{mode === "create" ? "Create Opportunity" : "Save Opportunity"}</button>
          <Link href={opportunityId ? `/opportunities/${opportunityId}` : "/opportunities/pipeline"}>Cancel</Link>
        </div>
      </form>
    </OpportunityShell>
  );
}

export function OpportunityDetail({ opportunityId }: { opportunityId: string }) {
  const session = useSession();
  const [data, setData] = useState<OpportunityData>(emptyData);
  const [opportunity, setOpportunity] = useState<OpportunityView | null>(null);
  const [scoreSummary, setScoreSummary] = useState<SyncRecord | null>(null);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [nextData, row, score] = await Promise.all([
        loadOpportunityData(),
        syncosFetch<SyncRecord>(`/opportunities/${opportunityId}`),
        optionalRecord(`/opportunities/${opportunityId}/score-summary`),
      ]);
      const merged = {
        ...nextData,
        opportunities: [row, ...nextData.opportunities.filter((item) => item.id !== row.id)],
        capacityByOpportunity: {
          ...nextData.capacityByOpportunity,
          [opportunityId]: await optionalList(`/opportunities/${opportunityId}/capacity-requirements`),
        },
      };
      setData(merged);
      setOpportunity(enrichOpportunity(row, merged));
      setScoreSummary(score);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [opportunityId]);

  const tabs = ["overview", "candidate", "organization", "relationship", "capacity", "constraints", "recommendations", "timeline", "audit"];

  return (
    <OpportunityShell title="Opportunity Detail" purpose="Decide what must happen next to pursue, approve, award, lose, defer, or archive this opportunity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!opportunity ? (
        <section className="workspace-panel"><div className="empty-state">Opportunity not found or you do not have access.</div></section>
      ) : (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{opportunity.name}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(opportunity.productStatus)}</span>
                  <span className="badge">Backend: {formatAction(opportunity.backendStatus)}</span>
                  <span className="badge">{opportunity.organization ? textValue(opportunity.organization.name) : "No organization"}</span>
                  <span className="badge">{moneyValue(opportunity.estimatedValue)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link href={`/opportunities/${opportunity.id}/edit`}>Edit Opportunity</Link>
                <button type="button" disabled>Submit for Pursuit Review</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.pursuit_approve") || opportunity.backendStatus !== "qualified"} onClick={() => setModal("approve")}>Approve Pursuit</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.pursue") || opportunity.backendStatus !== "pursuit_approved"} onClick={() => setModal("pursue")}>Begin Pursuit</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.proposal") || opportunity.backendStatus !== "pursuing"} onClick={() => setModal("proposal")}>Move to Proposal</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.negotiation") || opportunity.backendStatus !== "bid_proposal"} onClick={() => void lifecycle(opportunity, "negotiation", {}, load, setError)}>Move to Negotiation</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.award") || opportunity.backendStatus !== "negotiation"} onClick={() => setModal("award")}>Mark Awarded</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.lost") || opportunity.backendStatus === "archived"} onClick={() => setModal("lost")}>Mark Lost</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.defer") || opportunity.backendStatus === "archived"} onClick={() => setModal("defer")}>Defer</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.archive") || opportunity.backendStatus === "archived"} onClick={() => setModal("archive")}>Archive</button>
                <button type="button" disabled={!hasPermission(session.permissions, "opportunity.score") || opportunity.backendStatus === "archived"} onClick={() => void scoreOpportunity(opportunity, load, setError)}>Score Opportunity</button>
                <button type="button" disabled={!hasPermission(session.permissions, "capacity_requirement.create") || opportunity.backendStatus === "archived"} onClick={() => setModal("capacity")}>Add Capacity Requirement</button>
                <button type="button" onClick={() => setModal("research")}>Analyze Pursuit</button>
              </div>
            </div>
            <div className="summary-grid">
              <SummaryMetric label="Estimated Value" value={moneyValue(opportunity.estimatedValue)} />
              <SummaryMetric label="Pursuit Score" value={scoreValue(opportunity.pursuitScore)} />
              <SummaryMetric label="Relationship Access" value={scoreValue(opportunity.relationshipAccessScore)} />
              <SummaryMetric label="Capacity Requirements" value={String(opportunity.capacityRequirements.length)} />
              <SummaryMetric label="Open Constraints" value={String(opportunity.constraints.length)} />
              <SummaryMetric label="Probability" value="Not captured yet" />
              <SummaryMetric label="Expected Decision Date" value={dateValue(opportunity.expected_decision_date ?? opportunity.review_date)} />
              <SummaryMetric label="Next Action" value={formatAction(opportunity.recommendedNextAction)} />
            </div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Status</dt><dd>{formatAction(opportunity.productStatus)}</dd>
                <dt>Owner</dt><dd>{textValue(opportunity.owner_name ?? opportunity.owner_user_id)}</dd>
                <dt>Organization roles</dt><dd>{arrayValue(opportunity.organization?.actor_roles).map(formatAction).join(", ") || "Not captured yet"}</dd>
                <dt>Source candidate</dt><dd>{opportunity.candidate ? textValue(opportunity.candidate.name ?? opportunity.candidate.title) : "Not linked"}</dd>
                <dt>Relationship map</dt><dd>{opportunity.relationshipMap ? textValue(opportunity.relationshipMap.map_name ?? opportunity.relationshipMap.name) : "Not linked"}</dd>
                <dt>Relationship access</dt><dd>{scoreValue(opportunity.relationshipAccessScore)}</dd>
                <dt>Capacity state</dt><dd>{opportunity.capacityRequirements.length ? "Defined" : "Missing"}</dd>
              </dl>
              <Checklist title="Approval readiness" items={approvalReadiness(opportunity)} />
              {opportunity.relationshipAccessScore === null || opportunity.relationshipAccessScore < 50 ? <div className="warning-box">Relationship access is weak or missing. This does not block acquisition, but it creates a relationship constraint. Build or improve the relationship path to increase win probability.</div> : null}
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}
              </div>
              <OpportunityTab tab={tab} opportunity={opportunity} scoreSummary={scoreSummary} permissions={session.permissions} onCapacity={() => setModal("capacity")} />
            </section>
          </div>
          {modal === "approve" ? <ApproveModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "pursue" ? <PursueModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "proposal" ? <ProposalModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "award" ? <AwardModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "lost" ? <LostModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "defer" ? <DeferModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "archive" ? <ArchiveModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "capacity" ? <CapacityModal opportunity={opportunity} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "research" ? <ResearchModal opportunity={opportunity} onClose={() => setModal("")} /> : null}
        </>
      )}
    </OpportunityShell>
  );
}

function OpportunityKanban({ opportunities }: { opportunities: OpportunityView[] }) {
  return (
    <div className="detail-grid">
      {productStatuses.map((status) => (
        <div className="workspace-panel" key={status}>
          <h2>{formatAction(status)}</h2>
          {opportunities.filter((opportunity) => opportunity.productStatus === status).map((opportunity) => <OpportunityCard opportunity={opportunity} key={opportunity.id} />)}
          {opportunities.filter((opportunity) => opportunity.productStatus === status).length === 0 ? <div className="empty-state">No opportunities in this status.</div> : null}
        </div>
      ))}
    </div>
  );
}

function OpportunityCard({ opportunity }: { opportunity: OpportunityView }) {
  return (
    <div className="summary-card">
      <strong><Link className="table-link" href={`/opportunities/${opportunity.id}`}>{opportunity.name}</Link></strong>
      <span>{opportunity.organization ? textValue(opportunity.organization.name) : "No organization"}</span>
      <div className="mini-grid">
        <span>Territory: {textValue(opportunity.territory_name ?? opportunity.territory_id)}</span>
        <span>Work: {formatAction(opportunity.work_type)}</span>
        <span>Value: {moneyValue(opportunity.estimatedValue)}</span>
        <span>Pursuit: {scoreValue(opportunity.pursuitScore)}</span>
        <span>Relationship: {scoreValue(opportunity.relationshipAccessScore)}</span>
        <span>Capacity reqs: {opportunity.capacityRequirements.length}</span>
        <span>Constraints: {opportunity.constraints.length}</span>
        <span>Owner: {textValue(opportunity.owner_name ?? opportunity.owner_user_id)}</span>
        <span>Decision: {dateValue(opportunity.expected_decision_date ?? opportunity.review_date)}</span>
        <span>Next: {formatAction(opportunity.recommendedNextAction)}</span>
      </div>
    </div>
  );
}

function OpportunityTable({ opportunities }: { opportunities: OpportunityView[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Opportunity Name", "Status", "Organization", "Territory", "Work Type", "Estimated Value", "Pursuit Score", "Relationship Access", "Capacity Requirements", "Open Constraints", "Owner", "Expected Decision", "Created", "Updated", "Recommended Next Action"].map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => (
            <tr key={opportunity.id}>
              <td><Link className="table-link" href={`/opportunities/${opportunity.id}`}>{opportunity.name}</Link></td>
              <td><span className="badge">{formatAction(opportunity.productStatus)}</span></td>
              <td>{opportunity.organization ? <Link href={`/intelligence/organizations/${opportunity.organization.id}`}>{textValue(opportunity.organization.name)}</Link> : "Not linked"}</td>
              <td>{textValue(opportunity.territory_name ?? opportunity.territory_id)}</td>
              <td>{formatAction(opportunity.work_type)}</td>
              <td>{moneyValue(opportunity.estimatedValue)}</td>
              <td>{scoreValue(opportunity.pursuitScore)}</td>
              <td>{opportunity.relationshipMap ? <Link href={`/intelligence/relationship-maps/${opportunity.relationshipMap.id}`}>{scoreValue(opportunity.relationshipAccessScore)}</Link> : scoreValue(opportunity.relationshipAccessScore)}</td>
              <td>{opportunity.capacityRequirements.length}</td>
              <td>{opportunity.constraints.length}</td>
              <td>{textValue(opportunity.owner_name ?? opportunity.owner_user_id)}</td>
              <td>{dateValue(opportunity.expected_decision_date ?? opportunity.review_date)}</td>
              <td>{dateValue(opportunity.created_at)}</td>
              <td>{dateValue(opportunity.updated_at)}</td>
              <td>{formatAction(opportunity.recommendedNextAction)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpportunityTab({ tab, opportunity, scoreSummary, permissions, onCapacity }: { tab: string; opportunity: OpportunityView; scoreSummary: SyncRecord | null; permissions: string[]; onCapacity: () => void }) {
  if (tab === "overview") {
    return (
      <div className="workspace-panel">
        <SummaryMetric label="Opportunity definition" value="An Opportunity is work Jackson has decided is worth pursuing. It is not casual lead storage and it does not create execution or finance records." />
        <SummaryMetric label="Summary" value={textValue(opportunity.evidence_summary ?? opportunity.summary, "No summary captured yet.")} />
        <SummaryMetric label="Scope" value={textValue(opportunity.scope_summary, "No scope captured yet.")} />
        <SummaryMetric label="Current status" value={`${formatAction(opportunity.productStatus)} (backend ${formatAction(opportunity.backendStatus)})`} />
        <SummaryMetric label="Recommended next action" value={formatAction(opportunity.recommendedNextAction)} />
        <ObjectSlice title="Score Summary" rows={scoreSummary ? [scoreSummary] : []} columns={["signal_strength_score", "relationship_access_score", "capacity_fit_score", "margin_potential_score", "strategic_fit_score", "payment_risk_score", "pursuit_score", "recommendation"]} empty="This opportunity has not been scored yet." />
      </div>
    );
  }
  if (tab === "candidate") return <ObjectSlice title="Source Candidate" rows={opportunity.candidate ? [opportunity.candidate] : []} columns={["name", "status", "normalized_status", "candidate_score", "confidence_score", "estimated_value", "relationship_access_score", "recommended_next_action"]} empty="No source candidate is linked. Manual opportunities are supported by the backend when the actor has authority." action={opportunity.candidate ? <Link href={`/opportunities/candidates/${opportunity.candidate.id}`}>Open Candidate</Link> : undefined} />;
  if (tab === "organization") return <ObjectSlice title="Related Organization" rows={opportunity.organization ? [opportunity.organization] : []} columns={["name", "organization_type", "actor_roles", "territory_name", "status", "relationship_owner_name", "strategic_flag", "influence_score", "work_relevance_score", "payment_relevance_score", "recommended_next_action"]} empty="This opportunity is not connected to an organization." action={opportunity.organization ? <Link href={`/intelligence/organizations/${opportunity.organization.id}`}>Open Organization</Link> : undefined} />;
  if (tab === "relationship") {
    return (
      <div className="workspace-panel">
        <div className="warning-box">Relationship access is weak or missing when below 50. This does not hide or kill the opportunity. The current backend may still block pursuit approval until a relationship path exists.</div>
        <ObjectSlice title="Relationship Access" rows={opportunity.relationshipMap ? [opportunity.relationshipMap] : []} columns={["map_name", "map_type", "status", "target_organization_name", "target_contact_name", "relationship_access_score", "best_path_strength", "best_path_confidence", "recommended_next_action"]} empty="No relationship map is directly linked to this opportunity or source candidate." action={opportunity.relationshipMap ? <Link href={`/intelligence/relationship-maps/${opportunity.relationshipMap.id}`}>Open Relationship Map</Link> : <button type="button" disabled>Create Relationship Map</button>} />
      </div>
    );
  }
  if (tab === "capacity") return <ObjectSlice title="Capacity Requirements" rows={opportunity.capacityRequirements} columns={["capacity_type", "quantity", "unit", "territory_id", "start_date", "end_date", "status"]} empty="No capacity requirements are connected yet. Capacity is planning only in this sprint." action={hasPermission(permissions, "capacity_requirement.create") ? <button type="button" onClick={onCapacity}>Add Capacity Requirement</button> : undefined} />;
  if (tab === "constraints") return <ObjectSlice title="Constraints" rows={opportunity.constraints} columns={["constraint_type", "severity", "owner_id", "due_date", "status", "resolution_summary"]} empty="No active constraints are tied to this opportunity." action={hasPermission(permissions, "constraint.create") ? <button type="button" disabled>Create Constraint</button> : undefined} />;
  if (tab === "recommendations") return <ObjectSlice title="Recommendations" rows={opportunity.recommendations} columns={["recommendation_type", "confidence_score", "risk_level", "expected_impact", "status", "owner_id"]} empty="No recommendations are tied to this opportunity." />;
  if (tab === "timeline") return <div className="empty-state">Opportunity timeline endpoint is not available yet.</div>;
  if (tab === "audit") return <div className="empty-state">Opportunity audit summary is not available yet or you do not have permission.</div>;
  return null;
}

function ApproveModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  return (
    <ActionModal title="Approve Pursuit" submitLabel="Approve Pursuit" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/pursuit-approve`, { method: "POST", body: {} });
      await onSaved();
    }}>
      <SummaryMetric label="Estimated value" value={moneyValue(opportunity.estimatedValue)} />
      <SummaryMetric label="Relationship access" value={scoreValue(opportunity.relationshipAccessScore)} />
      <SummaryMetric label="Capacity requirements" value={opportunity.capacityRequirements.length ? "Defined" : "Missing"} />
      <SummaryMetric label="Open constraints" value={String(opportunity.constraints.length)} />
      <SummaryMetric label="Pursuit score" value={scoreValue(opportunity.pursuitScore)} />
      <div className="warning-box">If backend blocks approval due to relationship path, capacity fit, margin fit, authority, or pursuit score, the UI will show that backend result. No client-side override is available in this sprint.</div>
    </ActionModal>
  );
}

function PursueModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [owner, setOwner] = useState(textValue(opportunity.owner_user_id, ""));
  const [nextAction, setNextAction] = useState(textValue(opportunity.next_action, ""));
  return (
    <ActionModal title="Begin Pursuit" submitLabel="Begin Pursuit" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/pursue`, { method: "POST", body: { owner_user_id: owner, next_action: nextAction } });
      await onSaved();
    }}>
      <label>Owner user id<input value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
      <label>Next action<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label>
    </ActionModal>
  );
}

function ProposalModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [scope, setScope] = useState(textValue(opportunity.scope_summary, ""));
  const [estimatedValue, setEstimatedValue] = useState(textValue(opportunity.estimated_value, ""));
  return (
    <ActionModal title="Move to Proposal" submitLabel="Move to Proposal" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/proposal`, { method: "POST", body: { scope_summary: scope, estimated_value: optionalNumber(estimatedValue) } });
      await onSaved();
    }}>
      <label>Scope summary<textarea value={scope} onChange={(event) => setScope(event.target.value)} /></label>
      <label>Estimated value<input value={estimatedValue} onChange={(event) => setEstimatedValue(event.target.value)} type="number" min="0" /></label>
      <div className="warning-box">The current backend requires an active capacity requirement before proposal.</div>
    </ActionModal>
  );
}

function AwardModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [awardEvidence, setAwardEvidence] = useState(textValue(opportunity.award_evidence, ""));
  const [customerConfirmation, setCustomerConfirmation] = useState(textValue(opportunity.customer_confirmation, ""));
  return (
    <ActionModal title="Mark Awarded" submitLabel="Mark Awarded" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/award`, { method: "POST", body: { award_evidence: awardEvidence, customer_confirmation: customerConfirmation } });
      await onSaved();
    }}>
      <label>Award evidence<textarea value={awardEvidence} onChange={(event) => setAwardEvidence(event.target.value)} /></label>
      <label>Customer confirmation<textarea value={customerConfirmation} onChange={(event) => setCustomerConfirmation(event.target.value)} /></label>
      <div className="warning-box">Awarded opportunity is ready for a future project handoff workflow. No project is created in this sprint.</div>
    </ActionModal>
  );
}

function LostModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("relationship_access");
  return (
    <ActionModal title="Mark Lost" submitLabel="Mark Lost" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/lost`, { method: "POST", body: { loss_reason: reason } });
      await onSaved();
    }}>
      <label>Loss reason<SelectInline value={reason} options={lostReasons} onChange={setReason} /></label>
    </ActionModal>
  );
}

function DeferModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("timing");
  const [reviewDate, setReviewDate] = useState("");
  return (
    <ActionModal title="Defer Opportunity" submitLabel="Defer" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/defer`, { method: "POST", body: { deferral_reason: reason, review_date: reviewDate } });
      await onSaved();
    }}>
      <label>Deferral reason<SelectInline value={reason} options={deferredReasons} onChange={setReason} /></label>
      <label>Review date<input value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} type="date" /></label>
    </ActionModal>
  );
}

function ArchiveModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  return (
    <ActionModal title="Archive Opportunity" submitLabel="Archive" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/archive`, { method: "POST", body: {} });
      await onSaved();
    }}>
      <div className="warning-box">The current backend archive route does not accept or persist an archive reason. This is documented as a backend gap.</div>
    </ActionModal>
  );
}

function CapacityModal({ opportunity, onClose, onSaved }: { opportunity: OpportunityView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ capacity_type: textValue(opportunity.work_type, "crew"), quantity: "1", unit: "crew", territory_id: textValue(opportunity.territory_id, ""), start_date: "", end_date: "" });
  return (
    <ActionModal title="Add Capacity Requirement" submitLabel="Add Capacity Requirement" onClose={onClose} onSubmit={async () => {
      await syncosFetch(`/opportunities/${opportunity.id}/capacity-requirements`, { method: "POST", body: { ...form, quantity: optionalNumber(form.quantity) } });
      await onSaved();
    }}>
      <label>Required crew type / capacity type<input value={form.capacity_type} onChange={(event) => setForm({ ...form, capacity_type: event.target.value })} /></label>
      <label>Estimated quantity<input value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} type="number" min="0" /></label>
      <label>Unit<input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
      <label>Territory id<input value={form.territory_id} onChange={(event) => setForm({ ...form, territory_id: event.target.value })} /></label>
      <label>Required start date<input value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} type="date" /></label>
      <label>Required end date<input value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} type="date" /></label>
      <div className="warning-box">Capacity is planning only. This does not deploy crews, assign workers, allocate equipment, create work orders, or create projects.</div>
    </ActionModal>
  );
}

function ResearchModal({ opportunity, onClose }: { opportunity: OpportunityView; onClose: () => void }) {
  return (
    <Modal title="Analyze Pursuit" onClose={onClose}>
      <div className="empty-state">AI-assisted pursuit analysis will help evaluate opportunity quality, relationship access, constraints, and next actions. No automatic pursuit decisions occur without human approval.</div>
      <ObjectSlice title="AI Pursuit Placeholder" rows={[{
        opportunity_summary: opportunity.name,
        source_candidate: opportunity.candidate ? textValue(opportunity.candidate.name ?? opportunity.candidate.title) : "Not linked",
        relationship_access: scoreValue(opportunity.relationshipAccessScore),
        capacity_requirements: String(opportunity.capacityRequirements.length),
        constraints: String(opportunity.constraints.length),
        risks: opportunity.relationshipAccessScore === null || opportunity.relationshipAccessScore < 50 ? "Weak or missing relationship access" : "Not captured yet",
        missing_information: approvalReadiness(opportunity).filter(([, complete]) => !complete).map(([label]) => label).join(", "),
        recommended_next_action: formatAction(opportunity.recommendedNextAction),
        confidence: "No live AI analysis in this sprint",
        sources: "Approved sources placeholder",
        suggested_field_updates: "No automatic updates",
      }]} columns={["opportunity_summary", "source_candidate", "relationship_access", "capacity_requirements", "constraints", "risks", "missing_information", "recommended_next_action", "confidence", "sources", "suggested_field_updates"]} empty="" />
    </Modal>
  );
}

function ActionModal({ title, submitLabel, onClose, onSubmit, children }: { title: string; submitLabel: string; onClose: () => void; onSubmit: () => Promise<void>; children: ReactNode }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="compact-modal" onSubmit={(event) => void submit(event)}>
        {children}
        <button className="primary-button" type="submit">{submitLabel}</button>
      </form>
    </Modal>
  );
}

async function loadOpportunityData(): Promise<OpportunityData> {
  const unavailable: string[] = [];
  const [opportunities, candidates, organizations, relationshipMaps, constraints, recommendations] = await Promise.all([
    optionalList("/opportunities", unavailable, "opportunities"),
    optionalList("/opportunity-candidates", unavailable, "opportunity candidates"),
    optionalList("/organizations", unavailable, "organizations"),
    optionalList("/relationship-maps", unavailable, "relationship maps"),
    optionalList("/constraints", unavailable, "constraints"),
    optionalList("/recommendations", unavailable, "recommendations"),
  ]);
  const capacityByOpportunity: Record<string, SyncRecord[]> = {};
  await Promise.all(opportunities.map(async (opportunity) => {
    const id = String(opportunity.id ?? "");
    if (!id) return;
    capacityByOpportunity[id] = await optionalList(`/opportunities/${id}/capacity-requirements`, unavailable, "capacity requirements");
  }));
  return { opportunities, candidates, organizations, relationshipMaps, constraints, recommendations, capacityByOpportunity, unavailable };
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

function enrichOpportunity(opportunity: SyncRecord, data: OpportunityData): OpportunityView {
  const id = String(opportunity.id ?? "");
  const backendStatus = textValue(opportunity.status, "qualified");
  const candidate = data.candidates.find((row) => row.id === opportunity.candidate_id);
  const organization = data.organizations.find((row) => row.id === opportunity.organization_id) ?? objectFromPrefix(opportunity, "organization");
  const relationshipMap = data.relationshipMaps.find((map) => map.related_opportunity_id === id || (opportunity.candidate_id && map.related_candidate_id === opportunity.candidate_id));
  const constraints = relatedConstraints(id, data);
  const recommendations = relatedRecommendations(id, constraints, data);
  const capacityRequirements = data.capacityByOpportunity[id] ?? [];
  const enriched: OpportunityView = {
    ...opportunity,
    id,
    name: textValue(opportunity.title ?? opportunity.name, "Untitled opportunity"),
    backendStatus,
    productStatus: productStatus(backendStatus),
    organization,
    candidate,
    relationshipMap,
    capacityRequirements,
    constraints,
    recommendations,
    relationshipAccessScore: nullableNumber(opportunity.relationship_access_score ?? relationshipMap?.relationship_access_score ?? relationshipMap?.access_score),
    pursuitScore: nullableNumber(opportunity.pursuit_score),
    estimatedValue: nullableNumber(opportunity.estimated_value),
    recommendedNextAction: "",
  };
  enriched.recommendedNextAction = recommendedNextAction(enriched);
  return enriched;
}

function productStatus(status: string) {
  if (status === "qualified") return "draft";
  if (status === "bid_proposal") return "proposal";
  return status;
}

function recommendedNextAction(opportunity: OpportunityView) {
  if (opportunity.backendStatus === "archived") return "view_only";
  if (!opportunity.organization_id) return "attach_organization";
  if (!opportunity.territory_id) return "attach_territory";
  if (!opportunity.owner_user_id) return "assign_owner";
  if (!opportunity.candidate_id) return "link_candidate_optional";
  if (!opportunity.relationshipMap) return "build_relationship_path";
  if (opportunity.relationshipAccessScore === null || opportunity.relationshipAccessScore < 50) return "relationship_constraint_review";
  if (opportunity.capacityRequirements.length === 0) return "define_capacity_requirements";
  if (opportunity.constraints.some((constraint) => textValue(constraint.severity, "").toLowerCase() === "critical")) return "resolve_constraints";
  if (opportunity.productStatus === "draft") return "submit_for_pursuit_review";
  if (opportunity.productStatus === "pursuit_review") return "approve_or_defer_pursuit";
  if (opportunity.productStatus === "pursuit_approved") return "begin_pursuit";
  if (opportunity.productStatus === "pursuing") return "prepare_proposal_or_negotiate";
  if (opportunity.productStatus === "proposal") return "follow_up_proposal";
  if (opportunity.productStatus === "negotiation") return "close_award_or_lost";
  if (opportunity.productStatus === "awarded") return "prepare_project_handoff_later";
  return "review_opportunity";
}

function opportunityMatchesFilters(opportunity: OpportunityView, filters: Filters) {
  const haystack = [opportunity.name, opportunity.backendStatus, opportunity.productStatus, opportunity.organization?.name, opportunity.work_type, opportunity.evidence_summary].join(" ").toLowerCase();
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.status && opportunity.productStatus !== filters.status) return false;
  if (filters.organizationId && opportunity.organization_id !== filters.organizationId) return false;
  if (filters.territoryId && String(opportunity.territory_id ?? "") !== filters.territoryId) return false;
  if (filters.workType && opportunity.work_type !== filters.workType) return false;
  if (filters.valueMin && (opportunity.estimatedValue ?? -1) < Number(filters.valueMin)) return false;
  if (filters.valueMax && (opportunity.estimatedValue ?? Number.MAX_SAFE_INTEGER) > Number(filters.valueMax)) return false;
  if (filters.pursuitMin && (opportunity.pursuitScore ?? -1) < Number(filters.pursuitMin)) return false;
  if (filters.relationshipMin && (opportunity.relationshipAccessScore ?? -1) < Number(filters.relationshipMin)) return false;
  if (filters.owner && String(opportunity.owner_user_id ?? "") !== filters.owner) return false;
  if (filters.hasCandidate === "true" && !opportunity.candidate_id) return false;
  if (filters.hasCandidate === "false" && opportunity.candidate_id) return false;
  if (filters.hasRelationshipMap === "true" && !opportunity.relationshipMap) return false;
  if (filters.hasRelationshipMap === "false" && opportunity.relationshipMap) return false;
  if (filters.hasCapacity === "true" && opportunity.capacityRequirements.length === 0) return false;
  if (filters.hasCapacity === "false" && opportunity.capacityRequirements.length > 0) return false;
  if (filters.hasConstraints === "true" && opportunity.constraints.length === 0) return false;
  if (filters.hasConstraints === "false" && opportunity.constraints.length > 0) return false;
  if (filters.archived === "true" && opportunity.backendStatus !== "archived") return false;
  if (filters.archived === "false" && opportunity.backendStatus === "archived") return false;
  return true;
}

function sortOpportunities(opportunities: OpportunityView[], sort: string) {
  return [...opportunities].sort((a, b) => {
    if (sort === "default" || sort === "value_desc") return (b.estimatedValue ?? -1) - (a.estimatedValue ?? -1) || dateNumber(a.expected_decision_date ?? a.review_date) - dateNumber(b.expected_decision_date ?? b.review_date) || dateNumber(b.updated_at) - dateNumber(a.updated_at);
    if (sort === "pursuit_desc") return (b.pursuitScore ?? -1) - (a.pursuitScore ?? -1);
    if (sort === "relationship_desc") return (b.relationshipAccessScore ?? -1) - (a.relationshipAccessScore ?? -1);
    if (sort === "decision_date") return dateNumber(a.expected_decision_date ?? a.review_date) - dateNumber(b.expected_decision_date ?? b.review_date);
    if (sort === "status") return a.productStatus.localeCompare(b.productStatus);
    if (sort === "organization") return textValue(a.organization?.name, "").localeCompare(textValue(b.organization?.name, ""));
    if (sort === "created_desc") return dateNumber(b.created_at) - dateNumber(a.created_at);
    return dateNumber(b.updated_at) - dateNumber(a.updated_at);
  });
}

function buildSummary(opportunities: OpportunityView[]) {
  return {
    total: opportunities.length,
    draft: opportunities.filter((opportunity) => opportunity.productStatus === "draft").length,
    pursuitReview: opportunities.filter((opportunity) => opportunity.productStatus === "pursuit_review").length,
    pursuitApproved: opportunities.filter((opportunity) => opportunity.productStatus === "pursuit_approved").length,
    pursuing: opportunities.filter((opportunity) => opportunity.productStatus === "pursuing").length,
    proposal: opportunities.filter((opportunity) => opportunity.productStatus === "proposal").length,
    negotiation: opportunities.filter((opportunity) => opportunity.productStatus === "negotiation").length,
    awarded: opportunities.filter((opportunity) => opportunity.productStatus === "awarded").length,
    lost: opportunities.filter((opportunity) => opportunity.productStatus === "lost").length,
    deferred: opportunities.filter((opportunity) => opportunity.productStatus === "deferred").length,
    highValue: opportunities.filter((opportunity) => (opportunity.estimatedValue ?? 0) >= 50000).length,
    weakRelationship: opportunities.filter((opportunity) => opportunity.relationshipAccessScore === null || opportunity.relationshipAccessScore < 50).length,
    missingCapacity: opportunities.filter((opportunity) => opportunity.capacityRequirements.length === 0).length,
    openConstraints: opportunities.filter((opportunity) => opportunity.constraints.length > 0).length,
    readyForApproval: opportunities.filter((opportunity) => opportunity.productStatus === "draft" && opportunity.owner_user_id && opportunity.estimatedValue !== null).length,
  };
}

async function lifecycle(opportunity: OpportunityView, action: "negotiation", body: SyncRecord, onSaved: () => Promise<void>, setError: (value: string) => void) {
  setError("");
  try {
    await syncosFetch(`/opportunities/${opportunity.id}/${action}`, { method: "POST", body });
    await onSaved();
  } catch (nextError) {
    setError((nextError as Error).message);
  }
}

async function scoreOpportunity(opportunity: OpportunityView, onSaved: () => Promise<void>, setError: (value: string) => void) {
  setError("");
  try {
    await syncosFetch(`/opportunities/${opportunity.id}/score`, { method: "POST", body: {} });
    await onSaved();
  } catch (nextError) {
    setError((nextError as Error).message);
  }
}

function approvalReadiness(opportunity: OpportunityView): [string, boolean][] {
  return [
    ["Organization attached", Boolean(opportunity.organization_id)],
    ["Territory attached", Boolean(opportunity.territory_id)],
    ["Owner assigned", Boolean(opportunity.owner_user_id)],
    ["Estimated value captured", opportunity.estimatedValue !== null],
    ["Source candidate attached or manual source reason exists", Boolean(opportunity.candidate_id || opportunity.evidence_summary)],
    ["Relationship access reviewed", opportunity.relationshipAccessScore !== null || Boolean(opportunity.relationshipMap)],
    ["Capacity requirements reviewed", opportunity.capacityRequirements.length > 0],
    ["Critical constraints reviewed", !opportunity.constraints.some((constraint) => textValue(constraint.severity, "").toLowerCase() === "critical")],
    ["Pursuit score captured if supported", opportunity.pursuitScore !== null],
  ];
}

function relatedConstraints(opportunityId: string, data: OpportunityData) {
  return data.constraints.filter((constraint) =>
    (constraint.affected_object_type === "opportunity" && constraint.affected_object_id === opportunityId) ||
    (constraint.related_object_type === "opportunity" && constraint.related_object_id === opportunityId),
  );
}

function relatedRecommendations(opportunityId: string, constraints: SyncRecord[], data: OpportunityData) {
  return data.recommendations.filter((recommendation) =>
    (recommendation.related_object_type === "opportunity" && recommendation.related_object_id === opportunityId) ||
    (recommendation.constraint_id && constraints.some((constraint) => constraint.id === recommendation.constraint_id)),
  );
}

function UnsupportedNotice({ unavailable }: { unavailable: string[] }) {
  return (
    <div className="empty-state">
      Opportunity Pipeline uses existing opportunity, candidate, organization, relationship map, capacity requirement, constraint, and recommendation APIs. Timeline, audit, draft, pursuit review, archive reason, direct opportunity relationship map linkage, and value-threshold approval remain backend gaps.
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
                <tr key={String(row.id ?? index)}>
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
          <p className="muted">Paste a JWT and comma-separated permissions to test permission-aware opportunity actions.</p>
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

const emptyData: OpportunityData = {
  opportunities: [],
  candidates: [],
  organizations: [],
  relationshipMaps: [],
  constraints: [],
  recommendations: [],
  capacityByOpportunity: {},
  unavailable: [],
};
