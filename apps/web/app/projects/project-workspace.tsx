"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, type ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const projectStatuses = ["planning", "ready_for_work", "active", "on_hold", "completed", "closed", "archived"];
const projectPhases = ["intake", "planning", "pre_construction", "construction", "closeout", "complete"];
const archiveReasons = ["duplicate", "no_longer_relevant", "replaced", "created_in_error", "customer_cancelled", "other"];
const tabs = ["overview", "source", "operations", "scope", "readiness", "compliance", "financial", "documentation", "constraints", "work_orders", "production", "timeline", "audit"];

type ProjectDetailShape = {
  project: SyncRecord;
  source_opportunity?: SyncRecord | null;
  source_coverage_plan?: SyncRecord | null;
  source_project_handoff?: SyncRecord | null;
  customer_context?: SyncRecord | null;
  operations_context?: SyncRecord | null;
  readiness?: SyncRecord;
  warnings?: SyncRecord[];
  blockers?: SyncRecord[];
  documentation_requirements?: unknown;
  billing_package_requirements?: unknown;
  customer_validation_requirements?: unknown;
  constraints_summary?: SyncRecord;
  work_orders_summary?: SyncRecord;
  production_summary?: SyncRecord;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function ProjectDirectory() {
  const session = useSession();
  const [projects, setProjects] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "default" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const archived = filters.archived === "true" ? "true" : "false";
      setProjects(await syncosFetch<SyncRecord[]>(`/projects?archived=${archived}`, { token: session.token }));
    } catch (nextError) {
      setError((nextError as Error).message || "Projects could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session.token) void load();
    else setLoading(false);
  }, [session.token, filters.archived]);

  const visible = useMemo(() => sortProjects(projects.filter((project) => matchesFilters(project, filters)), filters.sort), [projects, filters]);
  const summary = useMemo(() => buildSummary(projects), [projects]);

  return (
    <ProjectShell title="Project Directory" purpose="Manage execution-side project readiness without creating work orders, production, or finance records.">
      <SessionPanel session={session} />
      <div className="warning-box">Project Workspace is an operator surface only. Work Orders and Production are placeholders in this sprint.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Projects.</div> : null}
      {loading ? <div className="empty-state">Loading projects...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Project Summary</h2>
                <p className="muted">Projects are prioritized by hard blockers, readiness, planned start, and recent updates.</p>
              </div>
              <span className="badge">Manual project creation hidden</span>
            </div>
            <div className="summary-grid">
              <SummaryCard label="Total Projects" value={summary.total} onClick={() => setFilters({ archived: "false", sort: "default" })} />
              {projectStatuses.map((status) => <SummaryCard key={status} label={formatAction(status)} value={summary.status[status] ?? 0} onClick={() => setFilters({ archived: status === "archived" ? "true" : "false", sort: "default", status })} />)}
              <SummaryCard label="Not Ready" value={summary.notReady} onClick={() => setFilters({ archived: "false", sort: "default", band: "not_ready" })} />
              <SummaryCard label="Ready With Risk" value={summary.readyWithRisk} onClick={() => setFilters({ archived: "false", sort: "default", band: "ready_with_risk" })} />
              <SummaryCard label="Hard Blockers" value={summary.hardBlockers} onClick={() => setFilters({ archived: "false", sort: "default", hasBlockers: "true" })} />
              <SummaryCard label="Open Constraints" value={summary.openConstraints} onClick={() => setFilters({ archived: "false", sort: "default", hasOpenConstraints: "true" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "default" })}>Reset</button>
            </div>
            <div className="tab-row">
              {["planning", "ready_for_work", "active", "on_hold", "completed", "closed"].map((status) => <button key={status} type="button" onClick={() => setFilters({ ...filters, status })}>{formatAction(status)}</button>)}
              <button type="button" onClick={() => setFilters({ ...filters, band: "not_ready" })}>Not Ready</button>
              <button type="button" onClick={() => setFilters({ ...filters, band: "ready_with_risk" })}>Ready With Risk</button>
              <button type="button" onClick={() => setFilters({ ...filters, missingProjectManager: "true" })}>Missing Project Manager</button>
              <button type="button" onClick={() => setFilters({ ...filters, missingFieldSupervisor: "true" })}>Missing Field Supervisor</button>
              <button type="button" onClick={() => setFilters({ ...filters, hasBlockers: "true" })}>Hard Blockers</button>
              <button type="button" onClick={() => setFilters({ ...filters, hasOpenConstraints: "true" })}>Open Constraints</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search project, customer, territory, scope" />
              <Select label="Status" value={filters.status ?? ""} options={["", ...projectStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
              <Select label="Phase" value={filters.phase ?? ""} options={["", ...projectPhases]} onChange={(phase) => setFilters({ ...filters, phase })} />
              <input value={filters.customer ?? ""} onChange={(event) => setFilters({ ...filters, customer: event.target.value })} placeholder="Customer / organization" />
              <input value={filters.territory ?? ""} onChange={(event) => setFilters({ ...filters, territory: event.target.value })} placeholder="Territory" />
              <input value={filters.workType ?? ""} onChange={(event) => setFilters({ ...filters, workType: event.target.value })} placeholder="Work type" />
              <input value={filters.operationsOwner ?? ""} onChange={(event) => setFilters({ ...filters, operationsOwner: event.target.value })} placeholder="Operations owner" />
              <input value={filters.projectManager ?? ""} onChange={(event) => setFilters({ ...filters, projectManager: event.target.value })} placeholder="Project manager" />
              <input value={filters.fieldSupervisor ?? ""} onChange={(event) => setFilters({ ...filters, fieldSupervisor: event.target.value })} placeholder="Field supervisor" />
              <input value={filters.readinessMin ?? ""} onChange={(event) => setFilters({ ...filters, readinessMin: event.target.value })} type="number" min="0" max="100" placeholder="Min readiness" />
              <input value={filters.readinessMax ?? ""} onChange={(event) => setFilters({ ...filters, readinessMax: event.target.value })} type="number" min="0" max="100" placeholder="Max readiness" />
              <Select label="Readiness band" value={filters.band ?? ""} options={["", "not_ready", "needs_planning", "ready_with_risk", "ready_for_work"]} onChange={(band) => setFilters({ ...filters, band })} />
              <Select label="Has blockers" value={filters.hasBlockers ?? ""} options={["", "true", "false"]} onChange={(hasBlockers) => setFilters({ ...filters, hasBlockers })} />
              <Select label="Has warnings" value={filters.hasWarnings ?? ""} options={["", "true", "false"]} onChange={(hasWarnings) => setFilters({ ...filters, hasWarnings })} />
              <Select label="Has constraints" value={filters.hasOpenConstraints ?? ""} options={["", "true", "false"]} onChange={(hasOpenConstraints) => setFilters({ ...filters, hasOpenConstraints })} />
              <input value={filters.plannedStartFrom ?? ""} onChange={(event) => setFilters({ ...filters, plannedStartFrom: event.target.value })} type="date" aria-label="Planned start from" />
              <input value={filters.plannedEndTo ?? ""} onChange={(event) => setFilters({ ...filters, plannedEndTo: event.target.value })} type="date" aria-label="Planned end to" />
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "default"} options={["default", "updated_desc", "planned_start", "readiness_asc", "readiness_desc", "status", "customer", "project_manager"]} labels={{ default: "Default", updated_desc: "Recently updated", planned_start: "Planned start date", readiness_asc: "Lowest readiness", readiness_desc: "Highest readiness", status: "Status", customer: "Customer", project_manager: "Project manager" }} onChange={(sort) => setFilters({ ...filters, sort })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Projects</h2>
              <span>{visible.length} shown</span>
            </div>
            {!projects.length ? <div className="empty-state">No projects yet. Projects are created from approved project handoff; manual creation is not exposed here.</div> : <ProjectTable projects={visible} />}
          </section>
        </>
      ) : null}
    </ProjectShell>
  );
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<ProjectDetailShape | null>(null);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const next = await syncosFetch<ProjectDetailShape>(`/projects/${projectId}/detail`, { token: session.token });
      const [timeline, audit] = await Promise.all([
        optionalList(`/projects/${projectId}/timeline`, session.token),
        optionalList(`/projects/${projectId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
    } catch (nextError) {
      setError((nextError as Error).message || "Project could not be loaded.");
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, projectId]);

  const project = detail?.project;
  const warnings = detail?.warnings ?? arrayValue(project?.warnings);
  const blockers = detail?.blockers ?? arrayValue(project?.blockers);

  return (
    <ProjectShell title="Project Detail" purpose="Review readiness, ownership, source context, risk, lifecycle status, timeline, and audit.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Project Detail.</div> : null}
      {!project && session.token && !error ? <div className="empty-state">Project not found or you do not have access.</div> : null}
      {project ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(project.project_name ?? project.name, "Untitled project")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(project.status)}</span>
                  <span className="badge">{formatAction(project.project_phase)}</span>
                  <span className="badge">{textValue(project.customer_organization_name ?? detail?.customer_context?.name, "No customer")}</span>
                  <span className="badge">{formatAction(project.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/projects/${projectId}/edit`} aria-disabled={!hasPermission(session.permissions, "project.update")}>Edit Project</Link>
                <ActionButton permission="project.recalculate_readiness" session={session} onClick={() => setModal("recalculate")}>Recalculate Readiness</ActionButton>
                <ActionButton permission="project.mark_ready" session={session} disabled={String(project.status) !== "planning"} onClick={() => setModal("mark_ready")}>Mark Ready For Work</ActionButton>
                <ActionButton permission="project.start" session={session} disabled={String(project.status) !== "ready_for_work"} onClick={() => setModal("start")}>Start Project</ActionButton>
                <ActionButton permission="project.place_hold" session={session} disabled={String(project.status) === "archived"} onClick={() => setModal("hold")}>Place On Hold</ActionButton>
                <ActionButton permission="project.release_hold" session={session} disabled={String(project.status) !== "on_hold"} onClick={() => setModal("release")}>Release Hold</ActionButton>
                <ActionButton permission="project.complete" session={session} disabled={!["active", "ready_for_work"].includes(String(project.status))} onClick={() => setModal("complete")}>Complete</ActionButton>
                <ActionButton permission="project.close" session={session} disabled={String(project.status) === "archived"} onClick={() => setModal("close")}>Close</ActionButton>
                <ActionButton permission="project.archive" session={session} disabled={String(project.status) === "archived"} onClick={() => setModal("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Project Readiness" value={scoreValue(project.project_readiness_score)} />
              <Metric label="Coverage Readiness" value={scoreValue(project.coverage_readiness_score)} />
              <Metric label="Compliance Readiness" value={scoreValue(project.compliance_readiness_score)} />
              <Metric label="Financial Readiness" value={scoreValue(project.financial_readiness_score)} />
              <Metric label="Open Constraints" value={String(numberValue(project.open_constraints_count ?? detail?.constraints_summary?.open_constraints_count))} />
              <Metric label="Hard Blockers" value={String(blockers.length || numberValue(project.hard_stop_constraints_count ?? detail?.constraints_summary?.hard_stop_constraints_count))} />
              <Metric label="Warnings" value={String(warnings.length)} />
              <Metric label="Recommended Next Action" value={formatAction(project.recommended_next_action)} />
            </div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Opportunity</dt><dd>{sourceLink("/opportunities", project.source_opportunity_id, project.source_opportunity_name)}</dd>
                <dt>Coverage Plan</dt><dd>{sourceLink("/opportunities/coverage", project.source_coverage_plan_id, project.source_coverage_plan_id)}</dd>
                <dt>Project Handoff</dt><dd>{textValue(project.source_project_handoff_id, "Not linked")}</dd>
                <dt>Customer</dt><dd>{project.customer_organization_id ? <Link className="table-link" href={`/intelligence/organizations/${project.customer_organization_id}`}>{textValue(project.customer_organization_name ?? detail.customer_context?.name)}</Link> : "Not captured yet"}</dd>
                <dt>Territory</dt><dd>{textValue(project.territory_name ?? detail.customer_context?.territory_name)}</dd>
                <dt>Work type</dt><dd>{formatAction(project.work_type)}</dd>
                <dt>Operations owner</dt><dd>{textValue(project.operations_owner_name ?? project.operations_owner_user_id)}</dd>
                <dt>Project manager</dt><dd>{textValue(project.project_manager_name ?? project.project_manager_user_id)}</dd>
                <dt>Field supervisor</dt><dd>{textValue(project.field_supervisor_name ?? project.field_supervisor_user_id)}</dd>
                <dt>Planned dates</dt><dd>{dateValue(project.planned_start_date)} - {dateValue(project.planned_end_date)}</dd>
              </dl>
              <Checklist items={readinessChecklist(project, detail)} />
              <WarningList title="Key Warnings" rows={warnings.slice(0, 4)} empty="No warnings returned." />
              <WarningList title="Key Blockers" rows={blockers.slice(0, 4)} empty="No blockers returned." />
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}
              </div>
              <ProjectTab tab={tab} detail={detail} project={project} session={session} />
            </section>
          </div>
          {modal ? <LifecycleModal type={modal} projectId={projectId} project={project} detail={detail} session={session} onClose={() => setModal("")} onSaved={load} /> : null}
        </>
      ) : null}
    </ProjectShell>
  );
}

export function ProjectEdit({ projectId }: { projectId: string }) {
  const router = useRouter();
  const session = useSession();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return setLoading(false);
      try {
        const detail = await syncosFetch<ProjectDetailShape>(`/projects/${projectId}/detail`, { token: session.token });
        const project = detail.project;
        setForm({
          project_name: String(project.project_name ?? project.name ?? ""),
          project_phase: String(project.project_phase ?? ""),
          scope_summary: String(project.scope_summary ?? ""),
          location_summary: String(project.location_summary ?? ""),
          planned_start_date: dateInput(project.planned_start_date),
          planned_end_date: dateInput(project.planned_end_date),
          operations_owner_user_id: String(project.operations_owner_user_id ?? ""),
          project_manager_user_id: String(project.project_manager_user_id ?? ""),
          field_supervisor_user_id: String(project.field_supervisor_user_id ?? ""),
          billing_package_requirements: jsonText(project.billing_package_requirements),
          documentation_requirements: jsonText(project.documentation_requirements),
          customer_validation_requirements: jsonText(project.customer_validation_requirements),
          risk_notes: String(project.risk_notes ?? ""),
        });
      } catch (nextError) {
        setError((nextError as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [session.token, projectId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = prune({
        project_name: form.project_name,
        project_phase: form.project_phase,
        scope_summary: form.scope_summary,
        location_summary: form.location_summary,
        planned_start_date: form.planned_start_date,
        planned_end_date: form.planned_end_date,
        operations_owner_user_id: form.operations_owner_user_id,
        project_manager_user_id: form.project_manager_user_id,
        field_supervisor_user_id: form.field_supervisor_user_id,
        billing_package_requirements: parseJsonField(form.billing_package_requirements, "billing_package_requirements"),
        documentation_requirements: parseJsonField(form.documentation_requirements, "documentation_requirements"),
        customer_validation_requirements: parseJsonField(form.customer_validation_requirements, "customer_validation_requirements"),
        risk_notes: form.risk_notes,
      });
      await syncosFetch(`/projects/${projectId}`, { method: "PATCH", body, token: session.token });
      router.push(`/projects/${projectId}`);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <ProjectShell title="Edit Project" purpose="Edit project planning fields without bypassing lifecycle action routes.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Loading project...</div> : null}
      {!loading ? (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Status changes use lifecycle actions from Project Detail. This edit form does not create work orders or production records.</div>
          <div className="form-grid">
            <label>Project name<input value={form.project_name ?? ""} onChange={(event) => setForm({ ...form, project_name: event.target.value })} /></label>
            <label>Project phase<SelectInline value={form.project_phase ?? ""} options={["", ...projectPhases]} onChange={(project_phase) => setForm({ ...form, project_phase })} /></label>
            <label>Planned start<input value={form.planned_start_date ?? ""} onChange={(event) => setForm({ ...form, planned_start_date: event.target.value })} type="date" /></label>
            <label>Planned end<input value={form.planned_end_date ?? ""} onChange={(event) => setForm({ ...form, planned_end_date: event.target.value })} type="date" /></label>
            <label>Operations owner user id<input value={form.operations_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, operations_owner_user_id: event.target.value })} /></label>
            <label>Project manager user id<input value={form.project_manager_user_id ?? ""} onChange={(event) => setForm({ ...form, project_manager_user_id: event.target.value })} /></label>
            <label>Field supervisor user id<input value={form.field_supervisor_user_id ?? ""} onChange={(event) => setForm({ ...form, field_supervisor_user_id: event.target.value })} /></label>
            <label>Scope summary<textarea value={form.scope_summary ?? ""} onChange={(event) => setForm({ ...form, scope_summary: event.target.value })} /></label>
            <label>Location summary<textarea value={form.location_summary ?? ""} onChange={(event) => setForm({ ...form, location_summary: event.target.value })} /></label>
            <label>Risk notes<textarea value={form.risk_notes ?? ""} onChange={(event) => setForm({ ...form, risk_notes: event.target.value })} /></label>
            <label>Billing package requirements JSON<textarea value={form.billing_package_requirements ?? ""} onChange={(event) => setForm({ ...form, billing_package_requirements: event.target.value })} /></label>
            <label>Documentation requirements JSON<textarea value={form.documentation_requirements ?? ""} onChange={(event) => setForm({ ...form, documentation_requirements: event.target.value })} /></label>
            <label>Customer validation requirements JSON<textarea value={form.customer_validation_requirements ?? ""} onChange={(event) => setForm({ ...form, customer_validation_requirements: event.target.value })} /></label>
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "project.update")}>Save Project</button>
            <Link className="link-button" href={`/projects/${projectId}`}>Cancel</Link>
          </div>
        </form>
      ) : null}
    </ProjectShell>
  );
}

function ProjectShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/projects", "Project Directory", "active"],
    ["#detail", "Project Detail", "placeholder"],
    ["#readiness", "Readiness", "placeholder"],
    ["#operations", "Operations", "placeholder"],
    ["#scope", "Scope & Location", "placeholder"],
    ["#coverage", "Coverage Context", "placeholder"],
    ["#handoff", "Handoff Context", "placeholder"],
    ["#compliance", "Compliance / Safety", "placeholder"],
    ["#financial", "Financial / Billing", "placeholder"],
    ["#documentation", "Documentation", "placeholder"],
    ["#risks", "Constraints / Risks", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#work-orders", "Future Work Orders", "placeholder"],
    ["#production", "Future Production", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Projects</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function ProjectTable({ projects }: { projects: SyncRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Project Name", "Status", "Phase", "Customer / Organization", "Territory", "Work Type", "Scope Summary", "Location Summary", "Planned Start", "Planned End", "Operations Owner", "Project Manager", "Field Supervisor", "Project Readiness Score", "Readiness Band", "Open Constraints", "Hard Blockers", "Recommended Next Action", "Updated Date"].map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={String(project.id)}>
              <td><Link className="table-link" href={`/projects/${project.id}`}>{textValue(project.project_name ?? project.name, "Untitled project")}</Link></td>
              <td>{formatAction(project.status)}</td>
              <td>{formatAction(project.project_phase)}</td>
              <td>{project.customer_organization_id ? <Link className="table-link" href={`/intelligence/organizations/${project.customer_organization_id}`}>{textValue(project.customer_organization_name, String(project.customer_organization_id))}</Link> : "Not captured"}</td>
              <td>{textValue(project.territory_name ?? project.territory_id)}</td>
              <td>{formatAction(project.work_type)}</td>
              <td>{textValue(project.scope_summary)}</td>
              <td>{textValue(project.location_summary)}</td>
              <td>{dateValue(project.planned_start_date)}</td>
              <td>{dateValue(project.planned_end_date)}</td>
              <td>{textValue(project.operations_owner_name ?? project.operations_owner_user_id)}</td>
              <td>{textValue(project.project_manager_name ?? project.project_manager_user_id)}</td>
              <td>{textValue(project.field_supervisor_name ?? project.field_supervisor_user_id)}</td>
              <td>{scoreValue(project.project_readiness_score)}</td>
              <td>{formatAction(project.project_readiness_band)}</td>
              <td>{String(numberValue(project.open_constraints_count))}</td>
              <td>{String(arrayValue(project.blockers).length || numberValue(project.hard_stop_constraints_count))}</td>
              <td>{formatAction(project.recommended_next_action)}</td>
              <td>{dateValue(project.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectTab({ tab, detail, project, session }: { tab: string; detail: ProjectDetailShape; project: SyncRecord; session: Session }) {
  if (tab === "overview") {
    return <Panel title="Overview"><dl className="detail-list">
      <dt>Project</dt><dd>{textValue(project.project_name ?? project.name)}</dd>
      <dt>Status</dt><dd>{formatAction(project.status)}</dd>
      <dt>Phase</dt><dd>{formatAction(project.project_phase)}</dd>
      <dt>Scope</dt><dd>{textValue(project.scope_summary)}</dd>
      <dt>Location</dt><dd>{textValue(project.location_summary)}</dd>
      <dt>Planned dates</dt><dd>{dateValue(project.planned_start_date)} - {dateValue(project.planned_end_date)}</dd>
      <dt>Actual dates</dt><dd>{dateValue(project.actual_start_date)} - {dateValue(project.actual_end_date)}</dd>
      <dt>Risk notes</dt><dd>{textValue(project.risk_notes)}</dd>
      <dt>Hold reason</dt><dd>{textValue(project.hold_reason)}</dd>
      <dt>Closeout notes</dt><dd>{textValue(project.closeout_notes)}</dd>
      <dt>Created</dt><dd>{dateValue(project.created_at)}</dd>
      <dt>Updated</dt><dd>{dateValue(project.updated_at)}</dd>
    </dl><div className="warning-box">This project is the execution-side container for awarded work accepted into operations. It does not represent individual work orders, daily production, settlements, invoices, or payments.</div></Panel>;
  }
  if (tab === "source") {
    return <div className="detail-grid">
      <ContextPanel title="Source Opportunity" record={detail.source_opportunity} fields={["title", "status", "estimated_value", "work_type", "relationship_access_score", "source_candidate_id"]} href={project.source_opportunity_id ? `/opportunities/${project.source_opportunity_id}` : undefined} />
      <ContextPanel title="Source Coverage Plan" record={detail.source_coverage_plan} fields={["status", "coverage_readiness_score", "capacity_readiness_score", "compliance_readiness_score", "economic_readiness_score", "approved_for_handoff_by", "approved_for_handoff_at"]} href={project.source_coverage_plan_id ? `/opportunities/coverage/${project.source_coverage_plan_id}` : undefined} />
      <ContextPanel title="Source Project Handoff" record={detail.source_project_handoff} fields={["status", "handoff_readiness_score", "approved_by", "approved_at", "created_project_by", "created_project_at"]} />
    </div>;
  }
  if (tab === "operations") return <Panel title="Operations Ownership"><dl className="detail-list"><dt>Operations owner</dt><dd>{textValue(project.operations_owner_name ?? project.operations_owner_user_id)}</dd><dt>Project manager</dt><dd>{textValue(project.project_manager_name ?? project.project_manager_user_id)}</dd><dt>Field supervisor</dt><dd>{textValue(project.field_supervisor_name ?? project.field_supervisor_user_id)}</dd></dl><WarningList title="Ownership Warnings" rows={arrayValue(detail.warnings).filter((row) => String(row.warning_type ?? "").includes("owner") || String(row.warning_type ?? "").includes("manager") || String(row.warning_type ?? "").includes("supervisor"))} empty="No ownership warnings returned." /></Panel>;
  if (tab === "scope") return <Panel title="Scope & Location"><dl className="detail-list"><dt>Work type</dt><dd>{formatAction(project.work_type)}</dd><dt>Scope</dt><dd>{textValue(project.scope_summary)}</dd><dt>Location</dt><dd>{textValue(project.location_summary)}</dd><dt>Territory</dt><dd>{textValue(project.territory_name ?? project.territory_id)}</dd><dt>Planned dates</dt><dd>{dateValue(project.planned_start_date)} - {dateValue(project.planned_end_date)}</dd><dt>Actual dates</dt><dd>{dateValue(project.actual_start_date)} - {dateValue(project.actual_end_date)}</dd><dt>Customer validation</dt><dd><JsonBlock value={project.customer_validation_requirements ?? detail.customer_validation_requirements} /></dd><dt>Documentation</dt><dd><JsonBlock value={project.documentation_requirements ?? detail.documentation_requirements} /></dd></dl></Panel>;
  if (tab === "readiness") return <Panel title="Readiness"><div className="summary-grid"><Metric label="Readiness score" value={scoreValue(project.project_readiness_score)} /><Metric label="Readiness band" value={formatAction(project.project_readiness_band)} /><Metric label="Next action" value={formatAction(project.recommended_next_action)} /><Metric label="Ready for work" value={project.ready_for_work ? "Yes" : "No"} /></div><WarningList title="Warnings" rows={detail.warnings ?? []} empty="No warnings returned." /><WarningList title="Blockers" rows={detail.blockers ?? []} empty="No blockers returned." /><Checklist items={readinessChecklist(project, detail)} /></Panel>;
  if (tab === "compliance") return <Panel title="Compliance / Safety"><Metric label="Compliance readiness" value={scoreValue(project.compliance_readiness_score)} /><WarningList title="Compliance / Safety Warnings" rows={arrayValue(detail.warnings).filter((row) => /compliance|safety|permit/i.test(JSON.stringify(row)))} empty="No compliance warnings returned." /><WarningList title="Compliance / Safety Blockers" rows={arrayValue(detail.blockers).filter((row) => /compliance|safety|permit/i.test(JSON.stringify(row)))} empty="No compliance blockers returned." /><div className="warning-box">Compliance readiness is available only from currently modeled project and source records. Richer compliance workflow will be handled in a future sprint.</div></Panel>;
  if (tab === "financial") return <Panel title="Financial / Billing Readiness"><dl className="detail-list"><dt>Financial readiness</dt><dd>{scoreValue(project.financial_readiness_score)}</dd><dt>Billing package</dt><dd><JsonBlock value={project.billing_package_requirements ?? detail.billing_package_requirements} /></dd><dt>Documentation package</dt><dd><JsonBlock value={project.documentation_requirements ?? detail.documentation_requirements} /></dd><dt>Customer validation</dt><dd><JsonBlock value={project.customer_validation_requirements ?? detail.customer_validation_requirements} /></dd><dt>Coverage economic readiness</dt><dd>{scoreValue(detail.source_coverage_plan?.economic_readiness_score)}</dd></dl><div className="warning-box">Finance execution begins later. This section only tracks readiness and requirements.</div></Panel>;
  if (tab === "documentation") return <Panel title="Documentation"><dl className="detail-list"><dt>Billing package</dt><dd><JsonBlock value={project.billing_package_requirements ?? detail.billing_package_requirements} /></dd><dt>Production documentation</dt><dd><JsonBlock value={project.documentation_requirements ?? detail.documentation_requirements} /></dd><dt>Customer validation</dt><dd><JsonBlock value={project.customer_validation_requirements ?? detail.customer_validation_requirements} /></dd><dt>Closeout</dt><dd>{textValue(project.closeout_notes)}</dd></dl></Panel>;
  if (tab === "constraints") return <Panel title="Constraints / Risks"><ObjectTable rows={constraintRows(detail.constraints_summary)} columns={["type", "severity", "status", "owner", "due_date", "hard_stop", "recommended_action"]} /><div className="form-actions"><Link className="link-button" href="/constraints-center">Open Constraints</Link></div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor_name", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") {
    if (!hasPermission(session.permissions, "project.audit.read")) return <Panel title="Audit"><div className="empty-state">You do not have permission to view project audit details.</div></Panel>;
    return <Panel title="Audit"><ObjectTable rows={detail._audit ?? []} columns={["actor_name", "action", "object_type", "object_id", "reason", "created_at", "correlation_id"]} /></Panel>;
  }
  if (tab === "work_orders") return <PlaceholderPanel title="Future Work Orders" message="Work Orders are not available in this sprint. A Work Order will represent a specific package of assigned work under this project." columns={["Work package", "Assigned crew/provider", "Start date", "Due date", "Status", "Quantity", "Unit"]} />;
  if (tab === "production") return <PlaceholderPanel title="Future Production" message="Production entry is not available in this sprint. Production records will capture field-completed work against work orders." columns={["Date", "Crew/provider", "Quantity completed", "Unit", "Evidence/photos", "QC status", "Billable status"]} />;
  return null;
}

function LifecycleModal({ type, projectId, project, detail, session, onClose, onSaved }: { type: string; projectId: string; project: SyncRecord; detail: ProjectDetailShape; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const warnings = detail.warnings ?? [];
  const blockers = detail.blockers ?? [];
  const blocked = type === "mark_ready" && blockers.length > 0;
  const title = formatAction(type);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (type === "recalculate") await syncosFetch(`/projects/${projectId}/recalculate-readiness`, { method: "POST", body: {}, token: session.token });
      if (type === "mark_ready") await syncosFetch(`/projects/${projectId}/mark-ready-for-work`, { method: "POST", body: { override_reasons: form.readiness_override_reason ? { readiness_override_reason: form.readiness_override_reason } : undefined }, token: session.token });
      if (type === "start") await syncosFetch(`/projects/${projectId}/start`, { method: "POST", body: {}, token: session.token });
      if (type === "hold") await syncosFetch(`/projects/${projectId}/place-on-hold`, { method: "POST", body: { hold_reason: form.hold_reason, hold_note: form.hold_note }, token: session.token });
      if (type === "release") await syncosFetch(`/projects/${projectId}/release-hold`, { method: "POST", body: { release_note: form.release_note }, token: session.token });
      if (type === "complete") await syncosFetch(`/projects/${projectId}/complete`, { method: "POST", body: { completion_note: form.completion_note }, token: session.token });
      if (type === "close") await syncosFetch(`/projects/${projectId}/close`, { method: "POST", body: { closeout_notes: form.closeout_notes, override_reason: form.override_reason }, token: session.token });
      if (type === "archive") await syncosFetch(`/projects/${projectId}/archive`, { method: "POST", body: { archive_reason: form.archive_reason, archive_note: form.archive_note }, token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-panel compact-modal" onSubmit={(event) => void submit(event)}>
        <div className="section-toolbar"><h2>{title}</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        {type === "mark_ready" ? <><WarningList title="Warnings" rows={warnings} empty="No warnings returned." /><WarningList title="Blockers" rows={blockers} empty="No blockers returned." />{warnings.length ? <label>Readiness override reason<textarea value={form.readiness_override_reason ?? ""} onChange={(event) => setForm({ ...form, readiness_override_reason: event.target.value })} required /></label> : null}</> : null}
        {type === "hold" ? <><label>Hold reason<input value={form.hold_reason ?? ""} onChange={(event) => setForm({ ...form, hold_reason: event.target.value })} required /></label><label>Hold note<textarea value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label></> : null}
        {type === "release" ? <label>Release note<textarea value={form.release_note ?? ""} onChange={(event) => setForm({ ...form, release_note: event.target.value })} required /></label> : null}
        {type === "complete" ? <label>Completion note<textarea value={form.completion_note ?? ""} onChange={(event) => setForm({ ...form, completion_note: event.target.value })} required /></label> : null}
        {type === "close" ? <><label>Closeout notes<textarea value={form.closeout_notes ?? ""} onChange={(event) => setForm({ ...form, closeout_notes: event.target.value })} required /></label>{String(project.status) !== "completed" ? <label>Override reason<input value={form.override_reason ?? ""} onChange={(event) => setForm({ ...form, override_reason: event.target.value })} /></label> : null}</> : null}
        {type === "archive" ? <><label>Archive reason<SelectInline value={form.archive_reason ?? ""} options={["", ...archiveReasons]} onChange={(archive_reason) => setForm({ ...form, archive_reason })} /></label><label>Archive note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {["recalculate", "start"].includes(type) ? <div className="warning-box">This action does not create work orders or production records.</div> : null}
        <div className="form-actions"><button className="primary-button" type="submit" disabled={blocked}>{title}</button></div>
      </form>
    </div>
  );
}

function SessionPanel({ session }: { session: Session }) {
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test project actions.</p></div><button type="button" onClick={session.applyDefaults}>Use project defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>([]);
  useEffect(() => {
    setTokenState(readToken());
    setPermissionsState(readPermissions().length ? readPermissions() : defaultOpportunityPermissions);
  }, []);
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  return { token, permissions, setToken, setPermissions, applyDefaults: () => setPermissions(defaultOpportunityPermissions) };
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="workspace-panel"><h2>{title}</h2>{children}</section>;
}

function SummaryCard({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return <button type="button" className="summary-card" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="summary-card" role="group"><span>{label}</span><strong>{value}</strong></div>;
}

function ActionButton({ permission, session, disabled, onClick, children }: { permission: string; session: Session; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || !hasPermission(session.permissions, permission)} onClick={onClick}>{children}</button>;
}

function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label>{label}<SelectInline value={value} options={options} labels={labels} onChange={onChange} /></label>;
}

function SelectInline({ value, options, labels = {}, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? (option ? formatAction(option) : "Any")}</option>)}</select>;
}

function ObjectTable({ rows, columns }: { rows: SyncRecord[]; columns: string[] }) {
  if (!rows.length) return <div className="empty-state">No records returned.</div>;
  return <div className="wide-table"><table><thead><tr>{columns.map((column) => <th key={column}>{formatAction(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.event_id ?? row.audit_id ?? index)}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

function ContextPanel({ title, record, fields, href }: { title: string; record?: SyncRecord | null; fields: string[]; href?: string }) {
  return <Panel title={title}>{record ? <><dl className="detail-list">{fields.map((field) => <Fragment key={field}><dt>{formatAction(field)}</dt><dd>{formatCell(record[field])}</dd></Fragment>)}</dl>{href ? <Link className="link-button" href={href}>Open {title}</Link> : <div className="empty-state">No UI route is available for this source yet.</div>}</> : <div className="empty-state">Not linked or not returned by backend.</div>}</Panel>;
}

function WarningList({ title, rows, empty }: { title: string; rows: SyncRecord[]; empty: string }) {
  return <div className="workspace-panel"><h3>{title}</h3>{rows.length ? rows.map((row, index) => <div className="check-item needs-review" key={String(row.warning_type ?? row.blocker_type ?? index)}><span>{formatAction(row.warning_type ?? row.blocker_type ?? row.message ?? "warning")}</span><strong>{formatAction(row.severity ?? "review")}</strong></div>) : <div className="empty-state">{empty}</div>}</div>;
}

function Checklist({ items }: { items: [string, boolean][] }) {
  return <div className="workspace-panel"><h3>Readiness Checklist Summary</h3>{items.map(([label, complete]) => <div className={`check-item ${complete ? "complete" : "missing"}`} key={label}><span>{label}</span><strong>{complete ? "Complete" : "Missing"}</strong></div>)}</div>;
}

function PlaceholderPanel({ title, message, columns }: { title: string; message: string; columns: string[] }) {
  return <Panel title={title}><div className="warning-box">{message}</div><ObjectTable rows={[]} columns={columns} /><div className="empty-state">No creation button is available in this sprint.</div></Panel>;
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <>Not captured yet.</>;
  return <pre className="json-block">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

function buildSummary(projects: SyncRecord[]) {
  const status = Object.fromEntries(projectStatuses.map((item) => [item, 0]));
  for (const project of projects) status[String(project.status)] = (status[String(project.status)] ?? 0) + 1;
  return {
    total: projects.length,
    status,
    notReady: projects.filter((project) => project.project_readiness_band === "not_ready").length,
    readyWithRisk: projects.filter((project) => project.project_readiness_band === "ready_with_risk").length,
    hardBlockers: projects.filter((project) => arrayValue(project.blockers).length || numberValue(project.hard_stop_constraints_count) > 0).length,
    openConstraints: projects.filter((project) => numberValue(project.open_constraints_count) > 0).length,
  };
}

function matchesFilters(project: SyncRecord, filters: Record<string, string>) {
  const haystack = [project.project_name, project.name, project.customer_organization_name, project.territory_name, project.work_type, project.scope_summary, project.location_summary, project.operations_owner_name, project.project_manager_name, project.field_supervisor_name].map((value) => String(value ?? "").toLowerCase()).join(" ");
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.status && project.status !== filters.status) return false;
  if (filters.phase && project.project_phase !== filters.phase) return false;
  if (filters.customer && !String(project.customer_organization_name ?? project.customer_organization_id ?? "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
  if (filters.territory && !String(project.territory_name ?? project.territory_id ?? "").toLowerCase().includes(filters.territory.toLowerCase())) return false;
  if (filters.workType && !String(project.work_type ?? "").toLowerCase().includes(filters.workType.toLowerCase())) return false;
  if (filters.operationsOwner && !String(project.operations_owner_name ?? project.operations_owner_user_id ?? "").toLowerCase().includes(filters.operationsOwner.toLowerCase())) return false;
  if (filters.projectManager && !String(project.project_manager_name ?? project.project_manager_user_id ?? "").toLowerCase().includes(filters.projectManager.toLowerCase())) return false;
  if (filters.fieldSupervisor && !String(project.field_supervisor_name ?? project.field_supervisor_user_id ?? "").toLowerCase().includes(filters.fieldSupervisor.toLowerCase())) return false;
  if (filters.band && project.project_readiness_band !== filters.band) return false;
  if (filters.readinessMin && numberValue(project.project_readiness_score, -1) < Number(filters.readinessMin)) return false;
  if (filters.readinessMax && numberValue(project.project_readiness_score, 101) > Number(filters.readinessMax)) return false;
  if (filters.hasBlockers && boolMatch(arrayValue(project.blockers).length > 0 || numberValue(project.hard_stop_constraints_count) > 0, filters.hasBlockers)) return false;
  if (filters.hasWarnings && boolMatch(arrayValue(project.warnings).length > 0, filters.hasWarnings)) return false;
  if (filters.hasOpenConstraints && boolMatch(numberValue(project.open_constraints_count) > 0, filters.hasOpenConstraints)) return false;
  if (filters.missingProjectManager === "true" && project.project_manager_user_id) return false;
  if (filters.missingFieldSupervisor === "true" && project.field_supervisor_user_id) return false;
  if (filters.plannedStartFrom && dateTime(project.planned_start_date) < dateTime(filters.plannedStartFrom)) return false;
  if (filters.plannedEndTo && dateTime(project.planned_end_date) > dateTime(filters.plannedEndTo)) return false;
  return true;
}

function sortProjects(projects: SyncRecord[], sort = "default") {
  const rows = [...projects];
  return rows.sort((a, b) => {
    if (sort === "readiness_desc") return numberValue(b.project_readiness_score, -1) - numberValue(a.project_readiness_score, -1);
    if (sort === "planned_start") return dateTime(a.planned_start_date) - dateTime(b.planned_start_date);
    if (sort === "status") return String(a.status).localeCompare(String(b.status));
    if (sort === "customer") return String(a.customer_organization_name ?? "").localeCompare(String(b.customer_organization_name ?? ""));
    if (sort === "project_manager") return String(a.project_manager_name ?? "").localeCompare(String(b.project_manager_name ?? ""));
    if (sort === "updated_desc") return dateTime(b.updated_at) - dateTime(a.updated_at);
    const blockers = (arrayValue(b.blockers).length + numberValue(b.hard_stop_constraints_count)) - (arrayValue(a.blockers).length + numberValue(a.hard_stop_constraints_count));
    if (blockers) return blockers;
    const readiness = numberValue(a.project_readiness_score, 999) - numberValue(b.project_readiness_score, 999);
    if (readiness) return readiness;
    const start = dateTime(a.planned_start_date) - dateTime(b.planned_start_date);
    if (start) return start;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function readinessChecklist(project: SyncRecord, detail: ProjectDetailShape): [string, boolean][] {
  return [
    ["Customer attached", Boolean(project.customer_organization_id)],
    ["Territory attached", Boolean(project.territory_id)],
    ["Work type attached", Boolean(project.work_type)],
    ["Scope summary present", Boolean(project.scope_summary)],
    ["Location summary present", Boolean(project.location_summary)],
    ["Operations owner assigned", Boolean(project.operations_owner_user_id)],
    ["Project manager assigned or overridden", Boolean(project.project_manager_user_id) || !arrayValue(detail.warnings).some((row) => String(row.warning_type).includes("project_manager"))],
    ["Field supervisor identified or overridden", Boolean(project.field_supervisor_user_id) || !arrayValue(detail.warnings).some((row) => String(row.warning_type).includes("field_supervisor"))],
    ["Coverage approved", Boolean(project.source_coverage_plan_id)],
    ["Compliance reviewed", project.compliance_readiness_score !== null && project.compliance_readiness_score !== undefined],
    ["Financial readiness reviewed", project.financial_readiness_score !== null && project.financial_readiness_score !== undefined],
    ["Documentation requirements identified", Boolean(project.documentation_requirements)],
    ["Hard blockers resolved", !arrayValue(detail.blockers).length],
  ];
}

function constraintRows(summary?: SyncRecord): SyncRecord[] {
  const rows = arrayValue(summary?.constraints ?? summary?.rows ?? summary?.items);
  if (rows.length) return rows;
  return [
    { type: "open_constraints", severity: "summary", status: numberValue(summary?.open_constraints_count), owner: "", due_date: "", hard_stop: false, recommended_action: "Open Constraints Center" },
    { type: "hard_stop_constraints", severity: "summary", status: numberValue(summary?.hard_stop_constraints_count), owner: "", due_date: "", hard_stop: true, recommended_action: "Resolve blockers" },
  ];
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function sourceLink(base: string, id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`${base}/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function arrayValue(value: unknown): SyncRecord[] {
  return Array.isArray(value) ? value as SyncRecord[] : [];
}

function boolMatch(actual: boolean, expected: string) {
  return (expected === "true" && !actual) || (expected === "false" && actual);
}

function scoreValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet.";
  return `${numberValue(value)}%`;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  if (String(value).match(/^\d{4}-\d{2}-\d{2}T/) || String(value).match(/^\d{4}-\d{2}-\d{2}$/)) return dateValue(value);
  return String(value);
}

function formatAction(value: unknown) {
  if (!value) return "Not captured yet";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: unknown) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function dateInput(value: unknown) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function jsonText(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function parseJsonField(value: string | undefined, field: string) {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${field} must be valid JSON.`);
  }
}

function prune(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}
