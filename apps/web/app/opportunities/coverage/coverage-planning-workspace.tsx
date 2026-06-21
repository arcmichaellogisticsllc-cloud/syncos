"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { defaultOpportunityPermissions, dateValue, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../../intelligence/api";
import { OpportunityShell } from "../opportunity-shell";

const planStatuses = ["not_started", "requirements_defined", "sources_identified", "partially_covered", "fully_covered", "covered_with_risk", "gap_exists", "blocked", "approved_for_handoff", "archived"];
const workTypes = ["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"];
const units = ["feet", "miles", "drops", "addresses", "passings", "splice_cases", "nodes", "poles", "permits", "inspections", "restoration_items", "days", "crews", "workers", "equipment_units"];
const sourceTypes = ["internal_workforce", "approved_subcontractor", "preferred_contractor", "strategic_partner", "recruitable_contractor", "partner_workforce", "vendor_equipment_source", "staffing_source", "mixed_coverage", "unknown"];
const commitmentStatuses = ["identified", "contacted", "interested", "verbally_committed", "committed", "unavailable", "rejected", "needs_activation"];
const marginConfidence = ["unknown", "low", "medium", "high", "verified"];
const gapTypes = ["no_capacity_source", "insufficient_crew_count", "insufficient_worker_count", "equipment_gap", "compliance_gap", "schedule_gap", "territory_gap", "production_rate_gap", "subcontractor_not_active", "contractor_not_verified", "insurance_gap", "safety_gap", "permit_or_row_gap", "material_or_vendor_gap", "economic_gap", "low_margin_gap", "negative_margin_gap", "margin_unknown_gap", "payment_risk_gap", "unknown_scope_gap"];
const gapSeverities = ["low", "medium", "high", "critical"];
const gapStatuses = ["open", "action_assigned", "in_progress", "resolved", "overridden", "hard_blocked", "archived"];
const archiveReasons = ["duplicate", "no_longer_relevant", "replaced", "created_in_error", "opportunity_cancelled", "other"];
const closedGapStatuses = new Set(["resolved", "overridden", "archived"]);

type CoverageDetail = {
  coverage_plan: SyncRecord;
  opportunity: SyncRecord | null;
  opportunity_context?: SyncRecord | null;
  requirements: SyncRecord[];
  sources: SyncRecord[];
  gaps: SyncRecord[];
  readiness: SyncRecord;
  warnings: SyncRecord[];
  blockers: SyncRecord[];
  required_override_fields: string[];
  recommended_next_action?: string;
  approval_context?: SyncRecord;
  economic_summary?: SyncRecord;
  compliance_summary?: SyncRecord;
  capacity_summary?: SyncRecord;
  audit_allowed?: boolean;
  timeline_available?: boolean;
  project_creation_boundary?: string;
};

type CoverageRow = SyncRecord & {
  detail?: CoverageDetail;
  recommended_next_action?: string;
};

type CoverageData = {
  plans: CoverageRow[];
  opportunities: SyncRecord[];
  organizations: SyncRecord[];
  capacityProviders: SyncRecord[];
  crews: SyncRecord[];
  equipment: SyncRecord[];
  complianceDocuments: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
};

type ModalState =
  | { type: "" }
  | { type: "requirement"; row?: SyncRecord }
  | { type: "source"; row?: SyncRecord }
  | { type: "gap"; row?: SyncRecord }
  | { type: "resolve-gap"; row: SyncRecord }
  | { type: "override-gap"; row: SyncRecord }
  | { type: "archive"; objectType: "plan" | "requirement" | "source" | "gap"; id: string }
  | { type: "approve" };

export function CoveragePlanningWorkspace() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [data, setData] = useState<CoverageData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false" });
  const [sort, setSort] = useState("default");

  useEffect(() => {
    setToken(readToken());
    const stored = readPermissions();
    const next = stored.length ? stored : defaultOpportunityPermissions;
    setPermissions(next);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void load();
  }, [token, filters.archived]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [plans, opportunities, organizations, capacityProviders, crews, equipment, complianceDocuments, constraints, recommendations] = await Promise.all([
        syncosFetch<SyncRecord[]>(`/coverage-plans?archived=${filters.archived === "true" ? "true" : "false"}`, { token }),
        syncosFetch<SyncRecord[]>("/opportunities", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/organizations", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/capacity-providers", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/crews", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/equipment", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/compliance-documents", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/constraints", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/recommendations", { token }).catch(() => []),
      ]);
      setData({ plans: plans.map((plan) => enrichPlan(plan)), opportunities, organizations, capacityProviders, crews, equipment, complianceDocuments, constraints, recommendations });
    } catch (nextError) {
      setError((nextError as Error).message || "Coverage plans could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const visiblePlans = useMemo(() => sortPlans(filterPlans(data.plans, filters), sort), [data.plans, filters, sort]);
  const summary = useMemo(() => buildSummary(data.plans), [data.plans]);
  const awardedWithoutCoverage = useMemo(() => {
    const activeOpportunityIds = new Set(data.plans.filter((plan) => !isArchived(plan)).map((plan) => String(plan.opportunity_id ?? "")));
    return data.opportunities.filter((opportunity) => normalizedStatus(opportunity) === "awarded" && !activeOpportunityIds.has(String(opportunity.id))).slice(0, 6);
  }, [data.plans, data.opportunities]);

  function applyQuickFilter(key: string) {
    const next: Record<string, string> = { archived: "false" };
    if (key === "needs_requirements") next.hasRequirements = "false";
    if (key === "needs_sources") next.hasSources = "false";
    if (key === "gap_exists") next.hasOpenGaps = "true";
    if (key === "hard_stop") next.hasHardStops = "true";
    if (key === "economic_risk") next.economicRisk = "true";
    if (key === "covered_with_risk") next.status = "covered_with_risk";
    if (key === "ready_for_handoff") next.readinessMin = "85";
    if (key === "approved_for_handoff") next.approved = "true";
    if (key === "blocked") next.status = "blocked";
    setFilters(next);
  }

  return (
    <OpportunityShell title="Coverage Planning" purpose="Determine whether awarded work can be covered before project handoff.">
      <SessionPanel token={token} permissions={permissions} setToken={setToken} setPermissions={setPermissions} />
      <div className="warning-box">Coverage Planning does not create projects, work orders, production, settlement, invoice, payment, payroll, AR, or cash records.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Loading coverage plans...</div> : null}
      {!token ? <div className="empty-state">Sign in with a SyncOS token to view Coverage Planning.</div> : null}
      {token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Coverage Plan Summary</h2>
                <p>Coverage work is prioritized by hard stops, low readiness, open gaps, and economic risk.</p>
              </div>
              {hasPermission(permissions, "coverage_plan.create") ? <Link className="primary-button" href="/opportunities/coverage/new">Create Coverage Plan</Link> : null}
            </div>
            <div className="summary-grid">
              {summary.map((card) => (
                <button className="summary-card" key={card.label} onClick={() => card.filter && applyQuickFilter(card.filter)}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button onClick={() => setFilters({ archived: "false" })}>Reset</button>
            </div>
            <div className="tab-row">
              {[
                ["needs_requirements", "Needs Requirements"],
                ["needs_sources", "Needs Sources"],
                ["gap_exists", "Gap Exists"],
                ["hard_stop", "Hard Stop"],
                ["economic_risk", "Economic Risk"],
                ["covered_with_risk", "Covered With Risk"],
                ["ready_for_handoff", "Ready For Handoff"],
                ["approved_for_handoff", "Approved For Handoff"],
                ["blocked", "Blocked"],
              ].map(([key, label]) => (
                <button key={key} onClick={() => applyQuickFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="filter-grid">
              <SelectInline label="Status" value={filters.status ?? ""} onChange={(value) => setFilters({ ...filters, status: value })} options={["", ...planStatuses]} />
              <SelectInline label="Opportunity" value={filters.opportunityId ?? ""} onChange={(value) => setFilters({ ...filters, opportunityId: value })} options={["", ...data.opportunities.map((opportunity) => String(opportunity.id))]} labels={optionLabels(data.opportunities, "title", "opportunity_name")} />
              <SelectInline label="Territory" value={filters.territoryId ?? ""} onChange={(value) => setFilters({ ...filters, territoryId: value })} options={["", ...uniqueValues(data.plans, "territory_id")]} labels={valueLabels(data.plans, "territory_id", "territory_name")} />
              <SelectInline label="Work type" value={filters.workType ?? ""} onChange={(value) => setFilters({ ...filters, workType: value })} options={["", ...workTypes]} />
              <RangeInput label="Readiness" min={filters.readinessMin ?? ""} max={filters.readinessMax ?? ""} setMin={(value) => setFilters({ ...filters, readinessMin: value })} setMax={(value) => setFilters({ ...filters, readinessMax: value })} />
              <RangeInput label="Capacity" min={filters.capacityMin ?? ""} max={filters.capacityMax ?? ""} setMin={(value) => setFilters({ ...filters, capacityMin: value })} setMax={(value) => setFilters({ ...filters, capacityMax: value })} />
              <RangeInput label="Compliance" min={filters.complianceMin ?? ""} max={filters.complianceMax ?? ""} setMin={(value) => setFilters({ ...filters, complianceMin: value })} setMax={(value) => setFilters({ ...filters, complianceMax: value })} />
              <RangeInput label="Economic" min={filters.economicMin ?? ""} max={filters.economicMax ?? ""} setMin={(value) => setFilters({ ...filters, economicMin: value })} setMax={(value) => setFilters({ ...filters, economicMax: value })} />
              <SelectInline label="Has requirements" value={filters.hasRequirements ?? ""} onChange={(value) => setFilters({ ...filters, hasRequirements: value })} options={["", "true", "false"]} />
              <SelectInline label="Has sources" value={filters.hasSources ?? ""} onChange={(value) => setFilters({ ...filters, hasSources: value })} options={["", "true", "false"]} />
              <SelectInline label="Has open gaps" value={filters.hasOpenGaps ?? ""} onChange={(value) => setFilters({ ...filters, hasOpenGaps: value })} options={["", "true", "false"]} />
              <SelectInline label="Has hard stops" value={filters.hasHardStops ?? ""} onChange={(value) => setFilters({ ...filters, hasHardStops: value })} options={["", "true", "false"]} />
              <SelectInline label="Economic risk" value={filters.economicRisk ?? ""} onChange={(value) => setFilters({ ...filters, economicRisk: value })} options={["", "true", "false"]} />
              <SelectInline label="Compliance risk" value={filters.complianceRisk ?? ""} onChange={(value) => setFilters({ ...filters, complianceRisk: value })} options={["", "true", "false"]} />
              <SelectInline label="Capacity gap" value={filters.capacityGap ?? ""} onChange={(value) => setFilters({ ...filters, capacityGap: value })} options={["", "true", "false"]} />
              <SelectInline label="Approved" value={filters.approved ?? ""} onChange={(value) => setFilters({ ...filters, approved: value })} options={["", "true", "false"]} />
              <SelectInline label="Operations owner" value={filters.ownerId ?? ""} onChange={(value) => setFilters({ ...filters, ownerId: value })} options={["", ...uniqueValues(data.plans, "operations_owner_user_id")]} labels={valueLabels(data.plans, "operations_owner_user_id", "operations_owner_name")} />
              <SelectInline label="Archived" value={filters.archived ?? "false"} onChange={(value) => setFilters({ ...filters, archived: value })} options={["false", "true"]} />
              <label>
                Search
                <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Opportunity, owner, status" />
              </label>
              <SelectInline label="Sort" value={sort} onChange={setSort} options={["default", "updated_desc", "readiness_asc", "readiness_desc", "gaps_desc", "hard_stops_desc", "opportunity_value_desc", "status", "approved_date_desc"]} labels={{ default: "Default", updated_desc: "Recently updated", readiness_asc: "Lowest readiness", readiness_desc: "Highest readiness", gaps_desc: "Most gaps", hard_stops_desc: "Hard stops first", opportunity_value_desc: "Opportunity value", status: "Status", approved_date_desc: "Approved date" }} />
            </div>
          </section>

          {awardedWithoutCoverage.length ? (
            <section className="workspace-panel">
              <h2>Awarded Opportunities Without Coverage Plan</h2>
              <div className="tab-row">
                {awardedWithoutCoverage.map((opportunity) => (
                  <Link className="link-button" href={`/opportunities/coverage/new?opportunityId=${opportunity.id}`} key={String(opportunity.id)}>
                    {textValue(opportunity.title ?? opportunity.opportunity_name, "Untitled opportunity")}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Coverage Plans</h2>
              <span>{visiblePlans.length} shown</span>
            </div>
            {!data.plans.length ? <div className="empty-state">No coverage plans yet. Create a coverage plan from awarded work to determine how the work can be covered before project handoff.</div> : null}
            {data.plans.length ? <CoveragePlanTable plans={visiblePlans} /> : null}
          </section>
        </>
      ) : null}
    </OpportunityShell>
  );
}

export function CoveragePlanFormPage({ mode, id, initialOpportunityId = "" }: { mode: "create" | "edit"; id?: string; initialOpportunityId?: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [opportunities, setOpportunities] = useState<SyncRecord[]>([]);
  const [plan, setPlan] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ opportunity_id: initialOpportunityId, operations_owner_user_id: "", notes: "", override_reason: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setToken(readToken());
    setPermissions(readPermissions().length ? readPermissions() : defaultOpportunityPermissions);
  }, []);

  useEffect(() => {
    if (!token) return;
    void load();
  }, [token, id]);

  async function load() {
    setError("");
    try {
      const [opportunityRows, planRow] = await Promise.all([
        syncosFetch<SyncRecord[]>("/opportunities", { token }).catch(() => []),
        mode === "edit" && id ? syncosFetch<SyncRecord>(`/coverage-plans/${id}`, { token }) : Promise.resolve(null),
      ]);
      setOpportunities(opportunityRows);
      if (planRow) {
        setPlan(planRow);
        setForm({
          opportunity_id: String(planRow.opportunity_id ?? ""),
          operations_owner_user_id: String(planRow.operations_owner_user_id ?? ""),
          notes: String(planRow.notes ?? ""),
          override_reason: "",
        });
      }
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "create" && !form.opportunity_id) {
      setError("Opportunity is required.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        const created = await syncosFetch<SyncRecord>("/coverage-plans", {
          method: "POST",
          token,
          body: compactBody({ opportunity_id: form.opportunity_id, operations_owner_user_id: form.operations_owner_user_id, notes: form.notes, override_reason: form.override_reason }),
        });
        const createdPlan = (created.coverage_plan as SyncRecord | undefined) ?? (created.afterState as CoverageDetail | undefined)?.coverage_plan ?? created;
        router.push(`/opportunities/coverage/${createdPlan.id}`);
      } else if (id) {
        await syncosFetch(`/coverage-plans/${id}`, { method: "PATCH", token, body: compactBody({ operations_owner_user_id: form.operations_owner_user_id, notes: form.notes }) });
        router.push(`/opportunities/coverage/${id}`);
      }
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const awardedOpportunities = opportunities.filter((opportunity) => normalizedStatus(opportunity) === "awarded");
  const canSave = mode === "create" ? hasPermission(permissions, "coverage_plan.create") : hasPermission(permissions, "coverage_plan.update");

  return (
    <OpportunityShell title={mode === "create" ? "Create Coverage Plan" : "Edit Coverage Plan"} purpose="Coverage planning prepares awarded work for handoff without creating execution or finance records.">
      <SessionPanel token={token} permissions={permissions} setToken={setToken} setPermissions={setPermissions} />
      <section className="workspace-panel">
        <div className="warning-box">Coverage plan creation does not create a project.</div>
        {error ? <div className="error-banner">{error}</div> : null}
        <form className="compact-modal" onSubmit={(event) => void submit(event)}>
          {mode === "create" ? (
            <SelectInline label="Opportunity" value={form.opportunity_id} onChange={(value) => setForm({ ...form, opportunity_id: value })} options={["", ...awardedOpportunities.map((opportunity) => String(opportunity.id))]} labels={optionLabels(awardedOpportunities, "title", "opportunity_name")} required />
          ) : (
            <label>
              Opportunity
              <input value={textValue(plan?.opportunity_name ?? plan?.opportunity_id)} disabled />
            </label>
          )}
          <label>
            Operations owner user ID
            <input value={form.operations_owner_user_id} onChange={(event) => setForm({ ...form, operations_owner_user_id: event.target.value })} placeholder="Optional active tenant user ID" />
          </label>
          <label>
            Notes
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          {mode === "create" ? (
            <label>
              Duplicate override reason
              <textarea value={form.override_reason} onChange={(event) => setForm({ ...form, override_reason: event.target.value })} placeholder="Only needed when another active plan exists for this opportunity" />
            </label>
          ) : null}
          <div className="form-actions">
            <Link className="link-button" href={mode === "edit" && id ? `/opportunities/coverage/${id}` : "/opportunities/coverage"}>Cancel</Link>
            <button className="primary-button" disabled={!canSave || saving} type="submit">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section>
    </OpportunityShell>
  );
}

export function CoveragePlanDetailPage({ id }: { id: string }) {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [detail, setDetail] = useState<CoverageDetail | null>(null);
  const [timeline, setTimeline] = useState<SyncRecord[]>([]);
  const [auditRows, setAuditRows] = useState<SyncRecord[]>([]);
  const [related, setRelated] = useState<Omit<CoverageData, "plans">>({ opportunities: [], organizations: [], capacityProviders: [], crews: [], equipment: [], complianceDocuments: [], constraints: [], recommendations: [] });
  const [modal, setModal] = useState<ModalState>({ type: "" });
  const [activeTab, setActiveTab] = useState("requirements");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setToken(readToken());
    setPermissions(readPermissions().length ? readPermissions() : defaultOpportunityPermissions);
  }, []);

  useEffect(() => {
    if (!token) return;
    void load();
  }, [token, id]);

  async function load() {
    setError("");
    try {
      const [nextDetail, nextTimeline, nextAudit, opportunities, organizations, capacityProviders, crews, equipment, complianceDocuments, constraints, recommendations] = await Promise.all([
        syncosFetch<CoverageDetail>(`/coverage-plans/${id}/detail`, { token }),
        syncosFetch<SyncRecord[]>(`/coverage-plans/${id}/timeline`, { token }).catch(() => []),
        hasPermission(permissions, "coverage_plan.audit.read") ? syncosFetch<SyncRecord[]>(`/coverage-plans/${id}/audit-summary`, { token }).catch(() => []) : Promise.resolve([]),
        syncosFetch<SyncRecord[]>("/opportunities", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/organizations", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/capacity-providers", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/crews", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/equipment", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/compliance-documents", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/constraints", { token }).catch(() => []),
        syncosFetch<SyncRecord[]>("/recommendations", { token }).catch(() => []),
      ]);
      setDetail(nextDetail);
      setTimeline(nextTimeline);
      setAuditRows(nextAudit);
      setRelated({ opportunities, organizations, capacityProviders, crews, equipment, complianceDocuments, constraints, recommendations });
    } catch (nextError) {
      setError((nextError as Error).message || "Coverage plan not found or you do not have access.");
    }
  }

  async function recalculate() {
    setError("");
    setNotice("");
    try {
      await syncosFetch(`/coverage-plans/${id}/recalculate`, { method: "POST", token, body: {} });
      await load();
      setNotice("Coverage readiness recalculated.");
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  if (!token) {
    return (
      <OpportunityShell title="Coverage Plan Detail" purpose="Define requirements, sources, gaps, and approval readiness.">
        <SessionPanel token={token} permissions={permissions} setToken={setToken} setPermissions={setPermissions} />
        <div className="empty-state">Sign in with a SyncOS token to view Coverage Planning.</div>
      </OpportunityShell>
    );
  }

  if (!detail) {
    return (
      <OpportunityShell title="Coverage Plan Detail" purpose="Define requirements, sources, gaps, and approval readiness.">
        <SessionPanel token={token} permissions={permissions} setToken={setToken} setPermissions={setPermissions} />
        {error ? <div className="error-banner">{error}</div> : <div className="empty-state">Loading coverage detail...</div>}
      </OpportunityShell>
    );
  }

  const plan = detail.coverage_plan;
  const opportunity = detail.opportunity_context ?? detail.opportunity;
  const hardStopCount = countHardStops(detail.coverage_plan, detail);
  const openGapCount = openGaps(detail).length;
  const action = String(detail.recommended_next_action ?? plan.recommended_next_action ?? recommendedNextAction(enrichPlan({ ...plan, detail })));
  const archived = isArchived(plan);

  return (
    <OpportunityShell title="Coverage Plan Detail" purpose="Define requirements, identify sources, expose gaps, review readiness, and approve for project handoff.">
      <SessionPanel token={token} permissions={permissions} setToken={setToken} setPermissions={setPermissions} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Coverage Plan {shortId(plan.id)}</h2>
            <p>{textValue(opportunity?.opportunity_name ?? plan.opportunity_name, "Opportunity not captured yet")}</p>
          </div>
          <div className="tab-row">
            <Link className="link-button" href="/opportunities/coverage">Back</Link>
            {hasPermission(permissions, "coverage_plan.update") && !archived ? <Link className="link-button" href={`/opportunities/coverage/${id}/edit`}>Edit Plan</Link> : null}
            {hasPermission(permissions, "coverage_requirement.create") && !archived ? <button onClick={() => setModal({ type: "requirement" })}>Add Requirement</button> : null}
            {hasPermission(permissions, "coverage_source.create") && !archived ? <button onClick={() => setModal({ type: "source" })}>Add Source</button> : null}
            {hasPermission(permissions, "coverage_gap.create") && !archived ? <button onClick={() => setModal({ type: "gap" })}>Add Gap</button> : null}
            {hasPermission(permissions, "coverage_plan.recalculate") && !archived ? <button onClick={() => void recalculate()}>Recalculate</button> : null}
            {hasPermission(permissions, "coverage_plan.approve_handoff") && !archived ? <button className="primary-button" onClick={() => setModal({ type: "approve" })}>Approve For Handoff</button> : null}
            {hasPermission(permissions, "coverage_plan.archive") && !archived ? <button onClick={() => setModal({ type: "archive", objectType: "plan", id })}>Archive Plan</button> : null}
            {opportunity?.id ? <Link className="link-button" href={`/opportunities/${opportunity.id}`}>Open Opportunity</Link> : null}
          </div>
        </div>
        <div className="summary-grid">
          <SummaryCard label="Coverage Readiness" value={scoreLabel(detail.readiness.coverage_readiness_score)} detail={bandLabel(detail.readiness.coverage_readiness_band)} />
          <SummaryCard label="Capacity Readiness" value={scoreLabel(detail.readiness.capacity_readiness_score)} />
          <SummaryCard label="Compliance Readiness" value={scoreLabel(detail.readiness.compliance_readiness_score)} />
          <SummaryCard label="Economic Readiness" value={scoreLabel(detail.readiness.economic_readiness_score)} detail={textValue(detail.readiness.economic_readiness_status, "Not captured yet")} />
          <SummaryCard label="Requirements Count" value={activeRows(detail.requirements).length} />
          <SummaryCard label="Sources Count" value={activeRows(detail.sources).length} />
          <SummaryCard label="Open Gaps" value={openGapCount} />
          <SummaryCard label="Hard Stops" value={hardStopCount} detail={hardStopCount > 0 ? "Blocks handoff approval" : "None"} />
          <SummaryCard label="Recommended Next Action" value={humanize(action)} />
        </div>
      </section>

      <section className="organization-layout">
        <aside className="workspace-panel">
          <h2>Strategic Sidebar</h2>
          <InfoList rows={[
            ["Opportunity status", textValue(opportunity?.normalized_status ?? opportunity?.status, "Not captured yet")],
            ["Award state", normalizedStatus(opportunity ?? {}) === "awarded" ? "Awarded" : "Not captured yet"],
            ["Opportunity value", currency(opportunity?.estimated_value)],
            ["Territory", textValue(opportunity?.territory_name, "Not captured yet")],
            ["Work type", textValue(opportunity?.work_type, "Not captured yet")],
            ["Operations owner", textValue(plan.operations_owner_name ?? plan.operations_owner_user_id, "Not captured yet")],
            ["Coverage status", humanize(String(plan.status ?? ""))],
            ["Gap summary", `${openGapCount} open, ${hardStopCount} hard stop`],
            ["Margin status", humanize(String(detail.readiness.economic_readiness_status ?? "unknown"))],
            ["Handoff readiness", bandLabel(detail.readiness.coverage_readiness_band)],
          ]} />
          <Checklist items={[
            ["Awarded opportunity exists", Boolean(opportunity?.id) && normalizedStatus(opportunity ?? {}) === "awarded"],
            ["Requirements defined", activeRows(detail.requirements).length > 0],
            ["Sources identified", activeRows(detail.sources).length > 0],
            ["Capacity readiness reviewed", detail.readiness.capacity_readiness_score !== null && detail.readiness.capacity_readiness_score !== undefined],
            ["Compliance readiness reviewed", detail.readiness.compliance_readiness_score !== null && detail.readiness.compliance_readiness_score !== undefined],
            ["Economic readiness reviewed", detail.readiness.economic_readiness_score !== null && detail.readiness.economic_readiness_score !== undefined],
            ["Hard stop gaps resolved", hardStopCount === 0],
            ["Non-hard-stop gaps resolved or overridden", openGapCount === 0],
            ["Operations owner assigned", Boolean(plan.operations_owner_user_id)],
            ["Approval note ready", Boolean(plan.approval_note)],
          ]} />
          {detail.blockers.length ? <IssueList title="Hard Blockers" rows={detail.blockers} /> : null}
          {detail.warnings.length ? <IssueList title="Key Warnings" rows={detail.warnings} /> : null}
        </aside>
        <div className="workspace-panel">
          <h2>Opportunity Context</h2>
          <InfoList rows={[
            ["Opportunity", textValue(opportunity?.opportunity_name, "Not captured yet")],
            ["Organization/customer", textValue(opportunity?.organization_name, "Not captured yet")],
            ["Territory", textValue(opportunity?.territory_name, "Not captured yet")],
            ["Work type", textValue(opportunity?.work_type, "Not captured yet")],
            ["Estimated value", currency(opportunity?.estimated_value)],
            ["Relationship access score", scoreLabel(opportunity?.relationship_access_score)],
            ["Pursuit approval status", textValue(opportunity?.normalized_status ?? opportunity?.status, "Not captured yet")],
            ["Awarded status", normalizedStatus(opportunity ?? {}) === "awarded" ? "Awarded" : "Not captured yet"],
            ["Expected start date", dateValue(opportunity?.expected_start_date)],
            ["Expected decision date", dateValue(opportunity?.expected_decision_date)],
            ["Risk notes", textValue(opportunity?.risk_notes, "Not captured yet")],
          ]} />
          <div className="tab-row">
            {opportunity?.id ? <Link className="link-button" href={`/opportunities/${opportunity.id}`}>Open Opportunity</Link> : null}
            {opportunity?.organization_id ? <Link className="link-button" href={`/intelligence/organizations/${opportunity.organization_id}`}>Open Organization</Link> : null}
            {opportunity?.relationship_map_id ? <Link className="link-button" href={`/intelligence/relationship-maps/${opportunity.relationship_map_id}`}>Open Relationship Map</Link> : null}
          </div>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="tab-row">
          {["requirements", "sources", "gaps", "economic", "compliance", "approval", "constraints", "timeline", "audit"].map((tab) => (
            <button className={activeTab === tab ? "active-tab" : ""} key={tab} onClick={() => setActiveTab(tab)}>
              {humanize(tab)}
            </button>
          ))}
        </div>
        {activeTab === "requirements" ? <RequirementsTab detail={detail} permissions={permissions} setModal={setModal} /> : null}
        {activeTab === "sources" ? <SourcesTab detail={detail} permissions={permissions} setModal={setModal} /> : null}
        {activeTab === "gaps" ? <GapsTab detail={detail} permissions={permissions} setModal={setModal} /> : null}
        {activeTab === "economic" ? <EconomicTab detail={detail} setModal={setModal} permissions={permissions} /> : null}
        {activeTab === "compliance" ? <ComplianceTab detail={detail} related={related} setModal={setModal} permissions={permissions} /> : null}
        {activeTab === "approval" ? <ApprovalPanel detail={detail} permissions={permissions} setModal={setModal} /> : null}
        {activeTab === "constraints" ? <ConstraintsRecommendations related={related} planId={id} /> : null}
        {activeTab === "timeline" ? <TimelineTab rows={timeline} available={detail.timeline_available !== false} /> : null}
        {activeTab === "audit" ? <AuditTab rows={auditRows} allowed={Boolean(detail.audit_allowed) || hasPermission(permissions, "coverage_plan.audit.read")} /> : null}
      </section>

      {modal.type === "requirement" ? <RequirementModal planId={id} row={modal.row} token={token} detail={detail} onClose={() => setModal({ type: "" })} onSaved={load} /> : null}
      {modal.type === "source" ? <SourceModal planId={id} row={modal.row} token={token} detail={detail} related={related} onClose={() => setModal({ type: "" })} onSaved={load} /> : null}
      {modal.type === "gap" ? <GapModal planId={id} row={modal.row} token={token} detail={detail} onClose={() => setModal({ type: "" })} onSaved={load} /> : null}
      {modal.type === "resolve-gap" ? <ReasonModal title="Resolve Gap" label="Resolution note" path={`/coverage-gaps/${modal.row.id}/resolve`} bodyKey="resolution_note" token={token} onClose={() => setModal({ type: "" })} onSaved={load} /> : null}
      {modal.type === "override-gap" ? <ReasonModal title="Override Gap" label="Override reason" path={`/coverage-gaps/${modal.row.id}/override`} bodyKey="override_reason" token={token} onClose={() => setModal({ type: "" })} onSaved={load} /> : null}
      {modal.type === "archive" ? <ArchiveModal modal={modal} token={token} onClose={() => setModal({ type: "" })} onSaved={load} /> : null}
      {modal.type === "approve" ? <ApproveModal detail={detail} token={token} onClose={() => setModal({ type: "" })} onSaved={async () => { await load(); setNotice("Coverage approved for handoff. No project was created."); }} /> : null}
    </OpportunityShell>
  );
}

function CoveragePlanTable({ plans }: { plans: CoverageRow[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            <th>Coverage Plan</th>
            <th>Opportunity</th>
            <th>Opportunity Value</th>
            <th>Status</th>
            <th>Coverage Readiness</th>
            <th>Capacity Readiness</th>
            <th>Compliance Readiness</th>
            <th>Economic Readiness</th>
            <th>Readiness Band</th>
            <th>Requirements</th>
            <th>Sources</th>
            <th>Open Gaps</th>
            <th>Hard Stops</th>
            <th>Operations Owner</th>
            <th>Approved For Handoff</th>
            <th>Updated Date</th>
            <th>Recommended Next Action</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={String(plan.id)}>
              <td><Link className="table-link" href={`/opportunities/coverage/${plan.id}`}>{shortId(plan.id)}</Link></td>
              <td>{plan.opportunity_id ? <Link className="table-link" href={`/opportunities/${plan.opportunity_id}`}>{textValue(plan.opportunity_name ?? plan.detail?.opportunity?.opportunity_name, "Not captured yet")}</Link> : "Not captured yet"}</td>
              <td>{currency(plan.opportunity_estimated_value ?? plan.detail?.opportunity?.estimated_value)}</td>
              <td><span className="badge">{humanize(String(plan.status ?? ""))}</span></td>
              <td>{scoreLabel(score(plan, "coverage_readiness_score"))}</td>
              <td>{scoreLabel(score(plan, "capacity_readiness_score"))}</td>
              <td>{scoreLabel(score(plan, "compliance_readiness_score"))}</td>
              <td>{scoreLabel(score(plan, "economic_readiness_score"))}</td>
              <td>{bandLabel(plan.detail?.readiness.coverage_readiness_band ?? plan.coverage_readiness_band)}</td>
              <td>{countRequirements(plan)}</td>
              <td>{countSources(plan)}</td>
              <td>{countOpenGaps(plan)}</td>
              <td><span className={countHardStops(plan) > 0 ? "error-banner" : "badge"}>{countHardStops(plan)}</span></td>
              <td>{textValue(plan.operations_owner_name ?? plan.operations_owner_user_id, "Not captured yet")}</td>
              <td>{plan.approved_for_handoff_at ? `Yes, ${dateValue(plan.approved_for_handoff_at)}` : "No"}</td>
              <td>{dateValue(plan.updated_at)}</td>
              <td>{humanize(String(plan.recommended_next_action ?? recommendedNextAction(plan)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequirementsTab({ detail, permissions, setModal }: { detail: CoverageDetail; permissions: string[]; setModal: (modal: ModalState) => void }) {
  const rows = detail.requirements;
  return (
    <>
      <div className="section-toolbar">
        <h2>Coverage Requirements</h2>
        {hasPermission(permissions, "coverage_requirement.create") ? <button onClick={() => setModal({ type: "requirement" })}>Add Requirement</button> : null}
      </div>
      {!activeRows(rows).length ? <div className="empty-state">No coverage requirements defined yet. Define the work types, quantities, territory, and crew/equipment needs.</div> : null}
      <SimpleTable headers={["Work Type", "Quantity", "Unit", "Territory", "Required Crew Type", "Required Equipment Type", "Required Start", "Required End", "Production Rate Assumption", "Notes", "Status/Archived", "Actions"]}>
        {rows.map((row) => (
          <tr key={String(row.id)}>
            <td>{humanize(String(row.work_type ?? ""))}</td>
            <td>{textValue(row.quantity, "Not captured yet")}</td>
            <td>{humanize(String(row.unit ?? ""))}</td>
            <td>{textValue(row.territory_name ?? row.territory_id, "Not captured yet")}</td>
            <td>{textValue(row.required_crew_type, "Not captured yet")}</td>
            <td>{textValue(row.required_equipment_type, "Not captured yet")}</td>
            <td>{dateValue(row.required_start_date)}</td>
            <td>{dateValue(row.required_end_date)}</td>
            <td>{textValue(row.production_rate_assumption, "Not captured yet")}</td>
            <td>{textValue(row.notes, "Not captured yet")}</td>
            <td>{row.archived_at ? `Archived ${dateValue(row.archived_at)}` : "Active"}</td>
            <td><RowActions row={row} editPermission="coverage_requirement.update" archivePermission="coverage_requirement.archive" permissions={permissions} onEdit={() => setModal({ type: "requirement", row })} onArchive={() => setModal({ type: "archive", objectType: "requirement", id: String(row.id) })} /></td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}

function SourcesTab({ detail, permissions, setModal }: { detail: CoverageDetail; permissions: string[]; setModal: (modal: ModalState) => void }) {
  return (
    <>
      <div className="section-toolbar">
        <h2>Coverage Sources</h2>
        {hasPermission(permissions, "coverage_source.create") ? <button onClick={() => setModal({ type: "source" })}>Add Source</button> : null}
      </div>
      {!activeRows(detail.sources).length ? <div className="empty-state">No coverage sources identified yet. Add internal, subcontracted, partner, recruitable, staffing, or vendor/equipment sources.</div> : null}
      <SimpleTable headers={["Source Type", "Related Organization", "Capacity Provider", "Crew", "Equipment", "Requirement", "Covered Quantity", "Unit", "Confidence Score", "Commitment Status", "Estimated Cost", "Expected Margin Amount", "Expected Margin %", "Margin Confidence", "Activation Steps", "Notes", "Actions"]}>
        {detail.sources.map((row) => (
          <tr key={String(row.id)}>
            <td>{humanize(String(row.source_type ?? ""))}</td>
            <td>{row.organization_id ? <Link className="table-link" href={`/intelligence/organizations/${row.organization_id}`}>{textValue(row.organization_name ?? row.organization_id)}</Link> : "Not captured yet"}</td>
            <td>{textValue(row.capacity_provider_name ?? row.capacity_provider_id, "Not captured yet")}</td>
            <td>{textValue(row.crew_name ?? row.crew_id, "Not captured yet")}</td>
            <td>{textValue(row.equipment_name ?? row.equipment_id, "Not captured yet")}</td>
            <td>{shortId(row.coverage_requirement_id)}</td>
            <td>{textValue(row.covered_quantity, "Not captured yet")}</td>
            <td>{humanize(String(row.unit ?? ""))}</td>
            <td>{scoreLabel(row.confidence_score)}</td>
            <td>{humanize(String(row.commitment_status ?? ""))}</td>
            <td>{currency(row.estimated_cost)}</td>
            <td>{currency(row.expected_margin_amount)}</td>
            <td>{percent(row.expected_margin_percent)}</td>
            <td>{humanize(String(row.margin_confidence ?? ""))}</td>
            <td>{textValue(row.activation_steps, "Not captured yet")}</td>
            <td>{textValue(row.notes, "Not captured yet")}</td>
            <td><RowActions row={row} editPermission="coverage_source.update" archivePermission="coverage_source.archive" permissions={permissions} onEdit={() => setModal({ type: "source", row })} onArchive={() => setModal({ type: "archive", objectType: "source", id: String(row.id) })} /></td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}

function GapsTab({ detail, permissions, setModal }: { detail: CoverageDetail; permissions: string[]; setModal: (modal: ModalState) => void }) {
  return (
    <>
      <div className="section-toolbar">
        <h2>Coverage Gaps</h2>
        {hasPermission(permissions, "coverage_gap.create") ? <button onClick={() => setModal({ type: "gap" })}>Add Gap</button> : null}
      </div>
      {!activeRows(detail.gaps).length ? <div className="empty-state">No coverage gaps are currently identified.</div> : null}
      <SimpleTable headers={["Gap Type", "Severity", "Required Quantity", "Covered Quantity", "Gap Quantity", "Unit", "Owner", "Due Date", "Recommended Action", "Override Allowed", "Hard Stop", "Status", "Resolution Note", "Actions"]}>
        {detail.gaps.map((row) => (
          <tr key={String(row.id)}>
            <td>{humanize(String(row.gap_type ?? ""))}</td>
            <td>{humanize(String(row.severity ?? ""))}</td>
            <td>{textValue(row.required_quantity, "Not captured yet")}</td>
            <td>{textValue(row.covered_quantity, "Not captured yet")}</td>
            <td>{textValue(row.gap_quantity, "Not captured yet")}</td>
            <td>{humanize(String(row.unit ?? ""))}</td>
            <td>{textValue(row.owner_name ?? row.owner_user_id, "Not captured yet")}</td>
            <td>{dateValue(row.due_date)}</td>
            <td>{textValue(row.recommended_action, "Not captured yet")}</td>
            <td>{row.override_allowed === false ? "No" : "Yes"}</td>
            <td>{row.hard_stop ? "Yes" : "No"}</td>
            <td>{humanize(String(row.status ?? ""))}</td>
            <td>{textValue(row.resolution_note, "Not captured yet")}</td>
            <td>
              <div className="tab-row">
                {hasPermission(permissions, "coverage_gap.update") && !row.archived_at ? <button onClick={() => setModal({ type: "gap", row })}>Edit</button> : null}
                {hasPermission(permissions, "coverage_gap.resolve") && !closedGapStatuses.has(String(row.status)) ? <button onClick={() => setModal({ type: "resolve-gap", row })}>Resolve</button> : null}
                {hasPermission(permissions, "coverage_gap.override") && !row.hard_stop && !closedGapStatuses.has(String(row.status)) ? <button onClick={() => setModal({ type: "override-gap", row })}>Override</button> : null}
                {hasPermission(permissions, "coverage_gap.archive") && !row.archived_at ? <button onClick={() => setModal({ type: "archive", objectType: "gap", id: String(row.id) })}>Archive</button> : null}
              </div>
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}

function EconomicTab({ detail, permissions, setModal }: { detail: CoverageDetail; permissions: string[]; setModal: (modal: ModalState) => void }) {
  const activeSources = activeRows(detail.sources);
  const explicitCost = sumExplicit(activeSources, "estimated_cost");
  const explicitMargin = sumExplicit(activeSources, "expected_margin_amount");
  const marginGaps = detail.gaps.filter((gap) => String(gap.gap_type ?? "").includes("margin") || String(gap.gap_type) === "economic_gap" || String(gap.gap_type) === "payment_risk_gap");
  return (
    <>
      <div className="section-toolbar">
        <h2>Economic / Margin Readiness</h2>
        <div className="tab-row">
          {hasPermission(permissions, "coverage_gap.create") ? <button onClick={() => setModal({ type: "gap" })}>Add Economic Gap</button> : null}
          {hasPermission(permissions, "coverage_source.create") ? <button onClick={() => setModal({ type: "source" })}>Add Source Margin Data</button> : null}
        </div>
      </div>
      <div className="summary-grid">
        <SummaryCard label="Estimated Opportunity Value" value={currency(detail.opportunity?.estimated_value)} />
        <SummaryCard label="Total Estimated Source Cost" value={explicitCost === null ? "Not captured yet" : currency(explicitCost)} />
        <SummaryCard label="Expected Margin Amount" value={explicitMargin === null ? "Not captured yet" : currency(explicitMargin)} />
        <SummaryCard label="Expected Margin Percent" value={averagePercent(activeSources, "expected_margin_percent")} />
        <SummaryCard label="Margin Confidence" value={dominantValue(activeSources, "margin_confidence") ?? "Not captured yet"} />
        <SummaryCard label="Economic Readiness" value={scoreLabel(detail.readiness.economic_readiness_score)} detail={humanize(String(detail.readiness.economic_readiness_status ?? "unknown"))} />
      </div>
      <div className="warning-box">Unknown margin, low margin, and negative margin are warnings. They do not hard-block handoff approval unless a hard stop gap exists.</div>
      {marginGaps.length ? <IssueList title="Margin-related gaps" rows={marginGaps} /> : <div className="empty-state">Margin readiness is unknown. Add source cost or margin information to evaluate economic coverage.</div>}
    </>
  );
}

function ComplianceTab({ detail, related, permissions, setModal }: { detail: CoverageDetail; related: Omit<CoverageData, "plans">; permissions: string[]; setModal: (modal: ModalState) => void }) {
  const providerIds = new Set(detail.sources.map((source) => String(source.capacity_provider_id ?? "")).filter(Boolean));
  const providerDocs = related.complianceDocuments.filter((doc) => providerIds.has(String(doc.capacity_provider_id ?? "")));
  return (
    <>
      <div className="section-toolbar">
        <h2>Compliance Readiness</h2>
        {hasPermission(permissions, "coverage_gap.create") ? <button onClick={() => setModal({ type: "gap" })}>Add Compliance Gap</button> : null}
      </div>
      <div className="summary-grid">
        <SummaryCard label="Compliance Readiness" value={scoreLabel(detail.readiness.compliance_readiness_score)} />
        <SummaryCard label="Capacity Providers" value={providerIds.size} />
        <SummaryCard label="Compliance Documents" value={providerDocs.length} />
      </div>
      {!providerDocs.length ? <div className="empty-state">Compliance readiness is partially available. Richer compliance review will be hardened in a future sprint.</div> : null}
      {providerDocs.length ? (
        <SimpleTable headers={["Document", "Provider", "Status", "Insurance Status", "Expires"]}>
          {providerDocs.map((doc) => (
            <tr key={String(doc.id)}>
              <td>{textValue(doc.document_type ?? doc.name, "Compliance document")}</td>
              <td>{textValue(doc.capacity_provider_name ?? doc.capacity_provider_id, "Not captured yet")}</td>
              <td>{humanize(String(doc.status ?? doc.compliance_status ?? ""))}</td>
              <td>{humanize(String(doc.insurance_status ?? ""))}</td>
              <td>{dateValue(doc.expires_at ?? doc.expiration_date)}</td>
            </tr>
          ))}
        </SimpleTable>
      ) : null}
    </>
  );
}

function ApprovalPanel({ detail, permissions, setModal }: { detail: CoverageDetail; permissions: string[]; setModal: (modal: ModalState) => void }) {
  const blockers = detail.blockers ?? [];
  return (
    <>
      <h2>Approval For Handoff</h2>
      <div className="summary-grid">
        <SummaryCard label="Coverage Readiness" value={scoreLabel(detail.readiness.coverage_readiness_score)} />
        <SummaryCard label="Capacity Readiness" value={scoreLabel(detail.readiness.capacity_readiness_score)} />
        <SummaryCard label="Compliance Readiness" value={scoreLabel(detail.readiness.compliance_readiness_score)} />
        <SummaryCard label="Economic Readiness" value={scoreLabel(detail.readiness.economic_readiness_score)} />
        <SummaryCard label="Open Gaps" value={openGaps(detail).length} />
        <SummaryCard label="Hard Stop Gaps" value={countHardStops(detail.coverage_plan, detail)} />
      </div>
      {blockers.length ? <IssueList title="Hard stop blockers" rows={blockers} /> : null}
      {detail.warnings.length ? <IssueList title="Warnings requiring override or resolution" rows={detail.warnings} /> : null}
      <InfoList rows={[
        ["Required override fields", detail.required_override_fields.length ? detail.required_override_fields.map(humanize).join(", ") : "None"],
        ["Boundary", detail.project_creation_boundary ?? "Coverage approval creates no project."],
      ]} />
      <button className="primary-button" disabled={!hasPermission(permissions, "coverage_plan.approve_handoff") || blockers.length > 0} onClick={() => setModal({ type: "approve" })}>
        Approve For Handoff
      </button>
      {blockers.length ? <div className="error-banner">Hard stop gaps must be resolved before handoff approval.</div> : null}
    </>
  );
}

function ConstraintsRecommendations({ related, planId }: { related: Omit<CoverageData, "plans">; planId: string }) {
  const constraints = related.constraints.filter((row) => relatesTo(row, planId, "coverage_plan"));
  const recommendations = related.recommendations.filter((row) => relatesTo(row, planId, "coverage_plan"));
  return (
    <>
      <h2>Constraints / Recommendations</h2>
      {constraints.length ? <IssueList title="Related constraints" rows={constraints} /> : <div className="empty-state">No active constraints are tied to this coverage plan.</div>}
      {recommendations.length ? <IssueList title="Related recommendations" rows={recommendations} /> : <div className="empty-state">No recommendations are tied to this coverage plan.</div>}
    </>
  );
}

function TimelineTab({ rows, available }: { rows: SyncRecord[]; available: boolean }) {
  if (!available) return <div className="empty-state">Coverage timeline endpoint is not available yet.</div>;
  if (!rows.length) return <div className="empty-state">No coverage timeline events are available yet.</div>;
  return (
    <>
      <h2>Coverage Timeline</h2>
      <SimpleTable headers={["Event", "Actor", "Object", "Timestamp", "Summary"]}>
        {rows.map((row, index) => (
          <tr key={String(row.event_id ?? row.id ?? index)}>
            <td>{humanize(String(row.event_type ?? row.action ?? ""))}</td>
            <td>{textValue(row.actor_name ?? row.actor_id, "System")}</td>
            <td>{humanize(String(row.object_type ?? ""))} {shortId(row.object_id)}</td>
            <td>{dateValue(row.timestamp ?? row.created_at)}</td>
            <td>{textValue(row.summary, "Review event")}</td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}

function AuditTab({ rows, allowed }: { rows: SyncRecord[]; allowed: boolean }) {
  if (!allowed) return <div className="empty-state">Coverage audit summary is available only to authorized users.</div>;
  if (!rows.length) return <div className="empty-state">No coverage audit records are available yet.</div>;
  return (
    <>
      <h2>Coverage Audit Summary</h2>
      <SimpleTable headers={["Actor", "Action", "Object", "Reason", "Timestamp", "Correlation ID"]}>
        {rows.map((row, index) => (
          <tr key={String(row.audit_id ?? row.id ?? index)}>
            <td>{textValue(row.actor_name ?? row.actor_id, "System")}</td>
            <td>{humanize(String(row.action ?? ""))}</td>
            <td>{humanize(String(row.object_type ?? ""))} {shortId(row.object_id)}</td>
            <td>{textValue(row.reason, "Not captured yet")}</td>
            <td>{dateValue(row.created_at)}</td>
            <td>{shortId(row.correlation_id)}</td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}

function RequirementModal({ planId, row, token, detail, onClose, onSaved }: { planId: string; row?: SyncRecord; token: string; detail: CoverageDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({
    work_type: String(row?.work_type ?? ""),
    quantity: String(row?.quantity ?? ""),
    unit: String(row?.unit ?? ""),
    territory_id: String(row?.territory_id ?? detail.opportunity?.territory_id ?? ""),
    required_crew_type: String(row?.required_crew_type ?? ""),
    required_equipment_type: String(row?.required_equipment_type ?? ""),
    required_start_date: dateInput(row?.required_start_date),
    required_end_date: dateInput(row?.required_end_date),
    production_rate_assumption: String(row?.production_rate_assumption ?? ""),
    notes: String(row?.notes ?? ""),
  });
  return (
    <RecordModal title={row ? "Edit Requirement" : "Add Requirement"} onClose={onClose} onSubmit={async () => {
      if (!form.work_type || !form.quantity || !form.unit || !form.territory_id) throw new Error("work_type, quantity, unit, and territory are required.");
      const body = compactBody(form);
      if (row) await syncosFetch(`/coverage-requirements/${row.id}`, { method: "PATCH", token, body });
      else await syncosFetch(`/coverage-plans/${planId}/requirements`, { method: "POST", token, body });
      await onSaved();
    }}>
      <SelectInline label="Work type" value={form.work_type} onChange={(value) => setForm({ ...form, work_type: value })} options={["", ...workTypes]} required />
      <label>Quantity<input required type="number" min="0" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
      <SelectInline label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} options={["", ...units]} required />
      <label>Territory ID<input required value={form.territory_id} onChange={(event) => setForm({ ...form, territory_id: event.target.value })} /></label>
      <label>Required crew type<input value={form.required_crew_type} onChange={(event) => setForm({ ...form, required_crew_type: event.target.value })} /></label>
      <label>Required equipment type<input value={form.required_equipment_type} onChange={(event) => setForm({ ...form, required_equipment_type: event.target.value })} /></label>
      <label>Required start<input type="date" value={form.required_start_date} onChange={(event) => setForm({ ...form, required_start_date: event.target.value })} /></label>
      <label>Required end<input type="date" value={form.required_end_date} onChange={(event) => setForm({ ...form, required_end_date: event.target.value })} /></label>
      <label>Production rate assumption<input type="number" min="0" step="0.01" value={form.production_rate_assumption} onChange={(event) => setForm({ ...form, production_rate_assumption: event.target.value })} /></label>
      <label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
    </RecordModal>
  );
}

function SourceModal({ planId, row, token, detail, related, onClose, onSaved }: { planId: string; row?: SyncRecord; token: string; detail: CoverageDetail; related: Omit<CoverageData, "plans">; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({
    source_type: String(row?.source_type ?? ""),
    coverage_requirement_id: String(row?.coverage_requirement_id ?? ""),
    organization_id: String(row?.organization_id ?? ""),
    capacity_provider_id: String(row?.capacity_provider_id ?? ""),
    crew_id: String(row?.crew_id ?? ""),
    equipment_id: String(row?.equipment_id ?? ""),
    covered_quantity: String(row?.covered_quantity ?? ""),
    unit: String(row?.unit ?? ""),
    confidence_score: String(row?.confidence_score ?? ""),
    commitment_status: String(row?.commitment_status ?? ""),
    activation_steps: String(row?.activation_steps ?? ""),
    estimated_cost: String(row?.estimated_cost ?? ""),
    expected_margin_amount: String(row?.expected_margin_amount ?? ""),
    expected_margin_percent: String(row?.expected_margin_percent ?? ""),
    margin_confidence: String(row?.margin_confidence ?? ""),
    notes: String(row?.notes ?? ""),
  });
  return (
    <RecordModal title={row ? "Edit Source" : "Add Source"} onClose={onClose} onSubmit={async () => {
      if (!form.source_type || !form.covered_quantity || !form.unit || !form.confidence_score || !form.commitment_status) throw new Error("source_type, covered_quantity, unit, confidence_score, and commitment_status are required.");
      const body = compactBody(form);
      if (row) await syncosFetch(`/coverage-sources/${row.id}`, { method: "PATCH", token, body });
      else await syncosFetch(`/coverage-plans/${planId}/sources`, { method: "POST", token, body });
      await onSaved();
    }}>
      <SelectInline label="Source type" value={form.source_type} onChange={(value) => setForm({ ...form, source_type: value })} options={["", ...sourceTypes]} required />
      <SelectInline label="Requirement" value={form.coverage_requirement_id} onChange={(value) => setForm({ ...form, coverage_requirement_id: value })} options={["", ...detail.requirements.map((requirement) => String(requirement.id))]} labels={Object.fromEntries(detail.requirements.map((requirement) => [String(requirement.id), `${humanize(String(requirement.work_type ?? ""))} ${textValue(requirement.quantity, "")} ${textValue(requirement.unit, "")}`]))} />
      <SelectInline label="Organization" value={form.organization_id} onChange={(value) => setForm({ ...form, organization_id: value })} options={["", ...related.organizations.map((row) => String(row.id))]} labels={optionLabels(related.organizations, "name")} />
      <SelectInline label="Capacity provider" value={form.capacity_provider_id} onChange={(value) => setForm({ ...form, capacity_provider_id: value })} options={["", ...related.capacityProviders.map((row) => String(row.id))]} labels={optionLabels(related.capacityProviders, "name")} />
      <SelectInline label="Crew" value={form.crew_id} onChange={(value) => setForm({ ...form, crew_id: value })} options={["", ...related.crews.map((row) => String(row.id))]} labels={optionLabels(related.crews, "name")} />
      <SelectInline label="Equipment" value={form.equipment_id} onChange={(value) => setForm({ ...form, equipment_id: value })} options={["", ...related.equipment.map((row) => String(row.id))]} labels={optionLabels(related.equipment, "name")} />
      <label>Covered quantity<input required type="number" min="0" step="0.01" value={form.covered_quantity} onChange={(event) => setForm({ ...form, covered_quantity: event.target.value })} /></label>
      <SelectInline label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} options={["", ...units]} required />
      <label>Confidence score<input required type="number" min="0" max="100" value={form.confidence_score} onChange={(event) => setForm({ ...form, confidence_score: event.target.value })} /></label>
      <SelectInline label="Commitment status" value={form.commitment_status} onChange={(value) => setForm({ ...form, commitment_status: value })} options={["", ...commitmentStatuses]} required />
      <label>Estimated cost<input type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(event) => setForm({ ...form, estimated_cost: event.target.value })} /></label>
      <label>Expected margin amount<input type="number" step="0.01" value={form.expected_margin_amount} onChange={(event) => setForm({ ...form, expected_margin_amount: event.target.value })} /></label>
      <label>Expected margin %<input type="number" step="0.01" value={form.expected_margin_percent} onChange={(event) => setForm({ ...form, expected_margin_percent: event.target.value })} /></label>
      <SelectInline label="Margin confidence" value={form.margin_confidence} onChange={(value) => setForm({ ...form, margin_confidence: value })} options={["", ...marginConfidence]} />
      <label>Activation steps<textarea value={form.activation_steps} onChange={(event) => setForm({ ...form, activation_steps: event.target.value })} /></label>
      <label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
    </RecordModal>
  );
}

function GapModal({ planId, row, token, detail, onClose, onSaved }: { planId: string; row?: SyncRecord; token: string; detail: CoverageDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({
    gap_type: String(row?.gap_type ?? ""),
    severity: String(row?.severity ?? ""),
    coverage_requirement_id: String(row?.coverage_requirement_id ?? ""),
    required_quantity: String(row?.required_quantity ?? ""),
    covered_quantity: String(row?.covered_quantity ?? ""),
    gap_quantity: String(row?.gap_quantity ?? ""),
    unit: String(row?.unit ?? ""),
    owner_user_id: String(row?.owner_user_id ?? ""),
    due_date: dateInput(row?.due_date),
    recommended_action: String(row?.recommended_action ?? ""),
    override_allowed: row?.override_allowed === false ? "false" : "true",
    hard_stop: row?.hard_stop ? "true" : "false",
    status: String(row?.status ?? ""),
    resolution_note: String(row?.resolution_note ?? ""),
  });
  return (
    <RecordModal title={row ? "Edit Gap" : "Add Gap"} onClose={onClose} onSubmit={async () => {
      if (!form.gap_type || !form.severity || !form.gap_quantity || !form.unit) throw new Error("gap_type, severity, gap_quantity, and unit are required.");
      const body = compactBody({ ...form, override_allowed: form.override_allowed === "true", hard_stop: form.hard_stop === "true" });
      if (row) await syncosFetch(`/coverage-gaps/${row.id}`, { method: "PATCH", token, body });
      else await syncosFetch(`/coverage-plans/${planId}/gaps`, { method: "POST", token, body });
      await onSaved();
    }}>
      <SelectInline label="Gap type" value={form.gap_type} onChange={(value) => setForm({ ...form, gap_type: value })} options={["", ...gapTypes]} required />
      <SelectInline label="Severity" value={form.severity} onChange={(value) => setForm({ ...form, severity: value })} options={["", ...gapSeverities]} required />
      <SelectInline label="Requirement" value={form.coverage_requirement_id} onChange={(value) => setForm({ ...form, coverage_requirement_id: value })} options={["", ...detail.requirements.map((requirement) => String(requirement.id))]} />
      <label>Required quantity<input type="number" min="0" step="0.01" value={form.required_quantity} onChange={(event) => setForm({ ...form, required_quantity: event.target.value })} /></label>
      <label>Covered quantity<input type="number" min="0" step="0.01" value={form.covered_quantity} onChange={(event) => setForm({ ...form, covered_quantity: event.target.value })} /></label>
      <label>Gap quantity<input required type="number" min="0" step="0.01" value={form.gap_quantity} onChange={(event) => setForm({ ...form, gap_quantity: event.target.value })} /></label>
      <SelectInline label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} options={["", ...units]} required />
      <label>Owner user ID<input value={form.owner_user_id} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} /></label>
      <label>Due date<input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label>
      <label>Recommended action<textarea value={form.recommended_action} onChange={(event) => setForm({ ...form, recommended_action: event.target.value })} /></label>
      <SelectInline label="Override allowed" value={form.override_allowed} onChange={(value) => setForm({ ...form, override_allowed: value })} options={["true", "false"]} />
      <SelectInline label="Hard stop" value={form.hard_stop} onChange={(value) => setForm({ ...form, hard_stop: value })} options={["false", "true"]} />
      <SelectInline label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={["", ...gapStatuses]} />
      <label>Resolution note<textarea value={form.resolution_note} onChange={(event) => setForm({ ...form, resolution_note: event.target.value })} /></label>
    </RecordModal>
  );
}

function ApproveModal({ detail, token, onClose, onSaved }: { detail: CoverageDetail; token: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [approvalNote, setApprovalNote] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  return (
    <RecordModal title="Approve For Handoff" onClose={onClose} error={error} onSubmit={async () => {
      setError("");
      if (!approvalNote.trim()) throw new Error("approval_note is required.");
      const body = { approval_note: approvalNote, override_reasons: reasons };
      try {
        await syncosFetch(`/coverage-plans/${detail.coverage_plan.id}/approve-for-handoff`, { method: "POST", token, body });
        await onSaved();
        onClose();
      } catch (nextError) {
        setError((nextError as Error).message || "Override reason is required for unresolved warnings.");
        throw nextError;
      }
    }}>
      <div className="warning-box">Approval for handoff creates no project.</div>
      {detail.blockers.length ? <IssueList title="Hard blockers" rows={detail.blockers} /> : null}
      {detail.warnings.length ? <IssueList title="Warnings" rows={detail.warnings} /> : null}
      <label>Approval note<textarea required value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} /></label>
      {detail.required_override_fields.map((field) => (
        <label key={field}>
          Override reason: {humanize(field)}
          <textarea required value={reasons[field] ?? ""} onChange={(event) => setReasons({ ...reasons, [field]: event.target.value })} />
        </label>
      ))}
    </RecordModal>
  );
}

function ArchiveModal({ modal, token, onClose, onSaved }: { modal: Extract<ModalState, { type: "archive" }>; token: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const path = modal.objectType === "plan" ? `/coverage-plans/${modal.id}/archive` : modal.objectType === "requirement" ? `/coverage-requirements/${modal.id}/archive` : modal.objectType === "source" ? `/coverage-sources/${modal.id}/archive` : `/coverage-gaps/${modal.id}/archive`;
  return (
    <RecordModal title={`Archive ${humanize(modal.objectType)}`} onClose={onClose} onSubmit={async () => {
      if (!reason) throw new Error("archive_reason is required.");
      await syncosFetch(path, { method: "POST", token, body: { archive_reason: reason } });
      await onSaved();
    }}>
      <SelectInline label="Archive reason" value={reason} onChange={setReason} options={["", ...archiveReasons]} required />
    </RecordModal>
  );
}

function ReasonModal({ title, label, path, bodyKey, token, onClose, onSaved }: { title: string; label: string; path: string; bodyKey: string; token: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState("");
  return (
    <RecordModal title={title} onClose={onClose} onSubmit={async () => {
      if (!value.trim()) throw new Error(`${bodyKey} is required.`);
      await syncosFetch(path, { method: "POST", token, body: { [bodyKey]: value } });
      await onSaved();
    }}>
      <label>{label}<textarea required value={value} onChange={(event) => setValue(event.target.value)} /></label>
    </RecordModal>
  );
}

function RecordModal({ title, children, onClose, onSubmit, error: externalError }: { title: string; children: React.ReactNode; onClose: () => void; onSubmit: () => Promise<void>; error?: string }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal-panel compact-modal" onSubmit={(event) => void submit(event)}>
        <div className="section-toolbar">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {externalError || error ? <div className="error-banner">{externalError || error}</div> : null}
        {children}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={saving} type="submit">{saving ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

function SessionPanel({ token, permissions, setToken, setPermissions }: { token: string; permissions: string[]; setToken: (token: string) => void; setPermissions: (permissions: string[]) => void }) {
  const [nextToken, setNextToken] = useState(token);
  const [nextPermissions, setNextPermissions] = useState(permissions.join(", "));
  useEffect(() => {
    setNextToken(token);
    setNextPermissions(permissions.join(", "));
  }, [token, permissions]);
  return (
    <section className="workspace-panel">
      <div className="section-toolbar">
        <div>
          <h2>Session</h2>
          <p>Actions are shown from the local permission set and enforced by the backend.</p>
        </div>
        <button onClick={() => {
          saveToken(nextToken);
          const parsed = nextPermissions.split(",").map((permission) => permission.trim()).filter(Boolean);
          savePermissions(parsed);
          setToken(nextToken.trim());
          setPermissions(parsed);
        }}>Apply</button>
      </div>
      <div className="session-grid">
        <label>API token<input value={nextToken} onChange={(event) => setNextToken(event.target.value)} placeholder="Paste SyncOS API token" /></label>
        <label>Permissions<textarea value={nextPermissions} onChange={(event) => setNextPermissions(event.target.value)} /></label>
      </div>
    </section>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function SelectInline({ label, value, onChange, options, labels = {}, required = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string>; required?: boolean }) {
  return (
    <label>
      {label}
      <select required={required} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option ? labels[option] ?? humanize(option) : "Any"}</option>
        ))}
      </select>
    </label>
  );
}

function RangeInput({ label, min, max, setMin, setMax }: { label: string; min: string; max: string; setMin: (value: string) => void; setMax: (value: string) => void }) {
  return (
    <label>
      {label}
      <span className="tab-row">
        <input type="number" min="0" max="100" placeholder="Min" value={min} onChange={(event) => setMin(event.target.value)} />
        <input type="number" min="0" max="100" placeholder="Max" value={max} onChange={(event) => setMax(event.target.value)} />
      </span>
    </label>
  );
}

function SimpleTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="wide-table">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function RowActions({ row, permissions, editPermission, archivePermission, onEdit, onArchive }: { row: SyncRecord; permissions: string[]; editPermission: string; archivePermission: string; onEdit: () => void; onArchive: () => void }) {
  return (
    <div className="tab-row">
      {hasPermission(permissions, editPermission) && !row.archived_at ? <button onClick={onEdit}>Edit</button> : null}
      {hasPermission(permissions, archivePermission) && !row.archived_at ? <button onClick={onArchive}>Archive</button> : null}
    </div>
  );
}

function InfoList({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="metadata-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Checklist({ items }: { items: Array<[string, boolean]> }) {
  return (
    <div className="checklist">
      {items.map(([label, complete]) => (
        <div key={label}>{complete ? "Complete" : "Open"}: {label}</div>
      ))}
    </div>
  );
}

function IssueList({ title, rows }: { title: string; rows: SyncRecord[] }) {
  return (
    <div className="warning-box">
      <strong>{title}</strong>
      <ul>
        {rows.map((row, index) => (
          <li key={String(row.id ?? row.related_object_id ?? row.warning_type ?? row.blocker_type ?? index)}>
            {humanize(String(row.warning_type ?? row.blocker_type ?? row.gap_type ?? row.constraint_type ?? row.recommendation_type ?? "issue"))}: {textValue(row.message ?? row.recommended_action ?? row.resolution_note, "Review required")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function emptyData(): CoverageData {
  return { plans: [], opportunities: [], organizations: [], capacityProviders: [], crews: [], equipment: [], complianceDocuments: [], constraints: [], recommendations: [] };
}

function enrichPlan(plan: CoverageRow): CoverageRow {
  return { ...plan, recommended_next_action: String(plan.recommended_next_action ?? recommendedNextAction(plan)) };
}

function filterPlans(plans: CoverageRow[], filters: Record<string, string>) {
  return plans.filter((plan) => {
    if (filters.status && String(plan.status) !== filters.status) return false;
    if (filters.opportunityId && String(plan.opportunity_id) !== filters.opportunityId) return false;
    if (filters.territoryId && String(plan.detail?.opportunity?.territory_id ?? plan.territory_id ?? "") !== filters.territoryId) return false;
    if (filters.workType && String(plan.work_type ?? plan.detail?.opportunity?.work_type ?? "") !== filters.workType) return false;
    if (filters.ownerId && String(plan.operations_owner_user_id ?? "") !== filters.ownerId) return false;
    if (filters.hasRequirements && boolString(countRequirements(plan) > 0) !== filters.hasRequirements) return false;
    if (filters.hasSources && boolString(countSources(plan) > 0) !== filters.hasSources) return false;
    if (filters.hasOpenGaps && boolString(countOpenGaps(plan) > 0) !== filters.hasOpenGaps) return false;
    if (filters.hasHardStops && boolString(countHardStops(plan) > 0) !== filters.hasHardStops) return false;
    if (filters.approved && boolString(String(plan.status) === "approved_for_handoff" || Boolean(plan.approved_for_handoff_at)) !== filters.approved) return false;
    if (filters.economicRisk && boolString(economicRisk(plan)) !== filters.economicRisk) return false;
    if (filters.complianceRisk && boolString(Boolean(plan.has_compliance_risk)) !== filters.complianceRisk) return false;
    if (filters.capacityGap && boolString(Boolean(plan.has_capacity_gap)) !== filters.capacityGap) return false;
    if (!rangeMatch(score(plan, "coverage_readiness_score"), filters.readinessMin, filters.readinessMax)) return false;
    if (!rangeMatch(score(plan, "capacity_readiness_score"), filters.capacityMin, filters.capacityMax)) return false;
    if (!rangeMatch(score(plan, "compliance_readiness_score"), filters.complianceMin, filters.complianceMax)) return false;
    if (!rangeMatch(score(plan, "economic_readiness_score"), filters.economicMin, filters.economicMax)) return false;
    if (filters.q) {
      const haystack = [plan.opportunity_name, plan.organization_name, plan.operations_owner_name, plan.status, plan.work_type, plan.detail?.opportunity?.organization_name, plan.detail?.opportunity?.work_type].map((value) => String(value ?? "").toLowerCase()).join(" ");
      if (!haystack.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  });
}

function sortPlans(plans: CoverageRow[], sort: string) {
  const rows = [...plans];
  return rows.sort((a, b) => {
    if (sort === "updated_desc") return dateMs(b.updated_at) - dateMs(a.updated_at);
    if (sort === "readiness_asc") return nullableScore(a, "coverage_readiness_score") - nullableScore(b, "coverage_readiness_score");
    if (sort === "readiness_desc") return nullableScore(b, "coverage_readiness_score") - nullableScore(a, "coverage_readiness_score");
    if (sort === "gaps_desc") return countOpenGaps(b) - countOpenGaps(a);
    if (sort === "hard_stops_desc") return countHardStops(b) - countHardStops(a);
    if (sort === "opportunity_value_desc") return numberValue(b.opportunity_estimated_value ?? b.detail?.opportunity?.estimated_value, -1) - numberValue(a.opportunity_estimated_value ?? a.detail?.opportunity?.estimated_value, -1);
    if (sort === "status") return String(a.status ?? "").localeCompare(String(b.status ?? ""));
    if (sort === "approved_date_desc") return dateMs(b.approved_for_handoff_at) - dateMs(a.approved_for_handoff_at);
    return countHardStops(b) - countHardStops(a) || nullableScore(a, "coverage_readiness_score") - nullableScore(b, "coverage_readiness_score") || dateMs(b.updated_at) - dateMs(a.updated_at);
  });
}

function buildSummary(plans: CoverageRow[]) {
  return [
    { label: "Total Coverage Plans", value: plans.length },
    { label: "Not Started", value: plans.filter((plan) => plan.status === "not_started").length, filter: "needs_requirements" },
    { label: "Requirements Defined", value: plans.filter((plan) => plan.status === "requirements_defined").length },
    { label: "Sources Identified", value: plans.filter((plan) => plan.status === "sources_identified").length },
    { label: "Partially Covered", value: plans.filter((plan) => plan.status === "partially_covered").length },
    { label: "Fully Covered", value: plans.filter((plan) => plan.status === "fully_covered").length },
    { label: "Covered With Risk", value: plans.filter((plan) => plan.status === "covered_with_risk").length, filter: "covered_with_risk" },
    { label: "Gap Exists", value: plans.filter((plan) => plan.status === "gap_exists" || countOpenGaps(plan) > 0).length, filter: "gap_exists" },
    { label: "Blocked", value: plans.filter((plan) => plan.status === "blocked" || countHardStops(plan) > 0).length, filter: "blocked" },
    { label: "Approved For Handoff", value: plans.filter((plan) => plan.status === "approved_for_handoff").length, filter: "approved_for_handoff" },
    { label: "Economic Risk", value: plans.filter(economicRisk).length, filter: "economic_risk" },
    { label: "Hard Stop Gaps", value: plans.filter((plan) => countHardStops(plan) > 0).length, filter: "hard_stop" },
  ];
}

function recommendedNextAction(plan: CoverageRow) {
  if (isArchived(plan)) return "view_only";
  if (countRequirements(plan) === 0) return "define_requirements";
  if (countSources(plan) === 0) return "identify_sources";
  if (countHardStops(plan) > 0) return "resolve_hard_stops";
  if (countOpenGaps(plan) > 0) return "resolve_or_override_gaps";
  const economic = score(plan, "economic_readiness_score");
  if (economic === null || economic < 70) return "review_margin";
  const coverage = score(plan, "coverage_readiness_score");
  if (coverage !== null && coverage >= 85) return "approve_for_handoff";
  return "continue_coverage_planning";
}

function countRequirements(plan: CoverageRow) {
  return plan.detail ? activeRows(plan.detail.requirements).length : numberValue(plan.active_requirements_count ?? plan.requirements_count ?? plan.requirement_count, 0);
}

function countSources(plan: CoverageRow) {
  return plan.detail ? activeRows(plan.detail.sources).length : numberValue(plan.active_sources_count ?? plan.sources_count ?? plan.source_count, 0);
}

function countOpenGaps(plan: CoverageRow) {
  return plan.detail ? openGaps(plan.detail).length : numberValue(plan.open_gaps_count ?? plan.open_gap_count, 0);
}

function countHardStops(plan?: CoverageRow | SyncRecord | null, detail?: CoverageDetail | null) {
  if (plan && (plan.hard_stop_gaps_count !== undefined || plan.hard_stop_count !== undefined)) {
    return numberValue(plan.hard_stop_gaps_count ?? plan.hard_stop_count, 0);
  }
  const nextDetail = detail ?? (plan && "detail" in plan ? (plan.detail as CoverageDetail | undefined) : undefined);
  if (!nextDetail) return 0;
  return nextDetail.gaps.filter((gap) => !gap.archived_at && !closedGapStatuses.has(String(gap.status)) && (gap.hard_stop || gap.status === "hard_blocked")).length;
}

function openGaps(detail: CoverageDetail) {
  return detail.gaps.filter((gap) => !gap.archived_at && !closedGapStatuses.has(String(gap.status)));
}

function activeRows(rows: SyncRecord[]) {
  return rows.filter((row) => !row.archived_at && row.status !== "archived");
}

function score(plan: CoverageRow, key: string) {
  const value = plan.detail?.readiness?.[key] ?? plan[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableScore(plan: CoverageRow, key: string) {
  return score(plan, key) ?? 999;
}

function economicRisk(plan: CoverageRow) {
  if (plan.has_economic_risk !== undefined) return Boolean(plan.has_economic_risk);
  const economic = score(plan, "economic_readiness_score");
  return economic === null || economic < 70 || Boolean(plan.detail?.gaps.some((gap) => String(gap.gap_type ?? "").includes("margin") || String(gap.gap_type) === "economic_gap" || String(gap.gap_type) === "payment_risk_gap"));
}

function rangeMatch(value: number | null, min?: string, max?: string) {
  if (!min && !max) return true;
  if (value === null) return false;
  if (min && value < Number(min)) return false;
  if (max && value > Number(max)) return false;
  return true;
}

function normalizedStatus(record: SyncRecord) {
  if (record.normalized_status) return String(record.normalized_status);
  if (record.status === "qualified") return "draft";
  if (record.status === "bid_proposal") return "proposal";
  return String(record.status ?? "");
}

function compactBody(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "" && value !== undefined && value !== null));
}

function optionLabels(rows: SyncRecord[], ...keys: string[]) {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(keys.map((key) => row[key]).find(Boolean), String(row.id))]));
}

function valueLabels(rows: SyncRecord[], idKey: string, labelKey: string) {
  return Object.fromEntries(rows.filter((row) => row[idKey]).map((row) => [String(row[idKey]), textValue(row[labelKey], String(row[idKey]))]));
}

function uniqueValues(rows: SyncRecord[], key: string) {
  return Array.from(new Set(rows.map((row) => String(row[key] ?? "")).filter(Boolean)));
}

function boolString(value: boolean) {
  return value ? "true" : "false";
}

function dateMs(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function scoreLabel(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.round(parsed)}/100` : textValue(value, "Not captured yet");
}

function bandLabel(value: unknown) {
  return value ? humanize(String(value)) : "Not captured yet";
}

function currency(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : String(value);
}

function percent(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed}%` : String(value);
}

function averagePercent(rows: SyncRecord[], key: string) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  if (!values.length) return "Not captured yet";
  return `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}%`;
}

function sumExplicit(rows: SyncRecord[], key: string) {
  const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== "").map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function dominantValue(rows: SyncRecord[], key: string) {
  const values = rows.map((row) => String(row[key] ?? "")).filter(Boolean);
  return values[0] ? humanize(values[0]) : null;
}

function shortId(value: unknown) {
  const text = String(value ?? "");
  return text ? text.slice(0, 8) : "Not captured yet";
}

function humanize(value: string) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()) : "Not captured yet";
}

function dateInput(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function isArchived(plan: SyncRecord) {
  return Boolean(plan.archived_at) || String(plan.status) === "archived";
}

function relatesTo(row: SyncRecord, id: string, type: string) {
  return String(row.related_object_id ?? row.object_id ?? row.aggregate_id ?? "") === id && (!row.related_object_type || String(row.related_object_type) === type);
}
