"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, type ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";
import { DetailBoundaryNotice, DetailNextActionCard, FormBoundaryNotice, FormPurposeHeader, FormSection, ReadOnlyBanner, RequiredFieldNote } from "../operator-page-templates";

const workOrderStatuses = ["draft", "ready_to_assign", "assigned", "scheduled", "in_progress", "submitted", "qc_review", "corrections_required", "approved", "billable", "closed", "on_hold", "cancelled", "archived"];
const readinessStatuses = ["not_ready", "ready_to_assign", "ready_to_start", "blocked"];
const readinessBands = ["not_ready", "needs_assignment", "ready_with_risk", "ready_to_start"];
const qcStatuses = ["not_started", "pending_review", "corrections_required", "approved", "rejected"];
const billableStatuses = ["not_billable", "pending_approval", "billable", "billed_later", "blocked"];
const assignmentTypes = ["unassigned", "internal_crew", "subcontractor", "partner_contractor", "vendor_equipment", "staffing_source"];
const units = ["feet", "miles", "drops", "addresses", "passings", "splice_cases", "nodes", "poles", "permits", "inspections", "restoration_items", "days", "crews", "workers", "equipment_units", "each"];
const archiveReasons = ["duplicate", "no_longer_relevant", "replaced", "created_in_error", "project_cancelled", "other"];
const tabs = ["overview", "project", "coverage", "assignment", "schedule", "scope", "quantity", "readiness", "production", "qc", "billable", "constraints", "timeline", "audit", "future_production", "future_settlement"];

type WorkOrderDetailShape = {
  work_order: SyncRecord;
  project_context?: SyncRecord;
  coverage_context?: SyncRecord;
  assignment_context?: SyncRecord;
  readiness?: SyncRecord;
  warnings?: SyncRecord[];
  blockers?: SyncRecord[];
  quantity_summary?: SyncRecord;
  production_summary?: SyncRecord;
  qc_summary?: SyncRecord;
  billable_summary?: SyncRecord;
  constraints_summary?: SyncRecord;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  projects: SyncRecord[];
  coveragePlans: SyncRecord[];
  capacityProviders: SyncRecord[];
  crews: SyncRecord[];
  equipment: SyncRecord[];
  organizations: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function WorkOrderDirectory() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "default", queue: "ready_to_start" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("archived", filters.archived === "true" ? "true" : "false");
      const backendFilters = ["project_id", "status", "readiness_status", "qc_status", "billable_status", "territory_id", "work_type", "assignment_type", "assigned_capacity_provider_id", "assigned_crew_id", "production_eligible", "planned_start_from", "planned_start_to", "scheduled_start_from", "scheduled_start_to", "q"];
      for (const key of backendFilters) if (filters[key]) query.set(key, filters[key]);
      if (filters.sort && filters.sort !== "default") query.set("sort", filters.sort);
      setRows(await syncosFetch<SyncRecord[]>(`/work-orders?${query.toString()}`, { token: session.token }));
    } catch (nextError) {
      setError((nextError as Error).message || "Work Orders could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session.token) void load();
    else setLoading(false);
  }, [session.token, filters.archived]);

  const visible = useMemo(() => sortWorkOrders(rows.filter((row) => matchesFilters(row, filters)), filters.sort), [rows, filters]);
  const summary = useMemo(() => buildSummary(rows), [rows]);
  const activeQueue = filters.queue ?? "ready_to_start";
  const setQueue = (queue: string, nextFilters: Record<string, string>) => setFilters({ archived: "false", sort: "default", queue, ...nextFilters });

  return (
    <WorkOrderShell title="Work Orders" purpose="Plan, assign, and monitor executable telecom work before production and QC.">
      <SessionPanel session={session} />
      <div className="boundary-notice"><strong>Execution boundary</strong><span>Work Orders plan and control field execution. This page does not create production records, QC evidence, settlements, invoices, payments, payroll, AR, or cash records.</span></div>
      {error ? <div className="error-banner" role="alert">{plainError(error)}</div> : null}
      {!session.token ? <div className="empty-state">Login required. Sign in to plan, assign, and monitor executable telecom work.</div> : null}
      {loading ? <div className="loading-state">Loading work orders...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel operator-queue-hero">
            <div className="section-toolbar">
              <div>
                <span className="eyebrow">Operations Manager Workspace</span>
                <h2>What work needs operational attention today?</h2>
                <p className="muted">Start with blocked work, ready execution, and work orders that need production or QC movement.</p>
              </div>
              <div className="form-actions">
                <Link className="primary-button" href="/work-orders/new" aria-disabled={!hasPermission(session.permissions, "work_order.create")}>Create Work Order</Link>
                <button type="button" onClick={() => setQueue("blocked", { hasBlockers: "true" })}>Open Next Blocked Work Order</button>
                <button type="button" onClick={() => setQueue("active", { status: "in_progress" })}>Review Active Work</button>
              </div>
            </div>
            <div className="summary-grid priority-grid">
              <SummaryCard label="Ready to Start" value={summary.readyToStart} helper="Assigned or scheduled work that can move into field execution." active={activeQueue === "ready_to_start"} onClick={() => setQueue("ready_to_start", { status: "scheduled" })} />
              <SummaryCard label="Active Work" value={summary.active} helper="Work already in progress or submitted by the field." active={activeQueue === "active"} onClick={() => setQueue("active", { status: "in_progress" })} />
              <SummaryCard label="Blocked" value={summary.blocked} helper="Readiness blockers, holds, or hard stops that need a decision." active={activeQueue === "blocked"} onClick={() => setQueue("blocked", { hasBlockers: "true" })} />
              <SummaryCard label="Production Missing" value={summary.productionMissing} helper="Execution records that appear eligible but do not yet show production truth." active={activeQueue === "production_missing"} onClick={() => setQueue("production_missing", { productionMissing: "true" })} />
              <SummaryCard label="Ready for QC" value={summary.readyForQc} helper="Submitted work ready for quality review." active={activeQueue === "ready_for_qc"} onClick={() => setQueue("ready_for_qc", { status: "submitted" })} />
              <SummaryCard label="Completed" value={summary.completed} helper="Approved, billable, closed, or completed execution packages." active={activeQueue === "completed"} onClick={() => setQueue("completed", { completedWork: "true" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Work Order Queue</h2>
                <p className="muted">{visible.length} shown. Queue tabs drive the page; filters are secondary.</p>
              </div>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "default" })}>Reset</button>
            </div>
            <div className="queue-tabs" role="tablist" aria-label="Work order queues">
              {[
                ["ready_to_start", "Ready to Start", { status: "scheduled" }],
                ["active", "Active", { status: "in_progress" }],
                ["blocked", "Blocked", { hasBlockers: "true" }],
                ["production_missing", "Production Missing", { productionMissing: "true" }],
                ["ready_for_qc", "Ready for QC", { status: "submitted" }],
                ["completed", "Completed", { completedWork: "true" }],
                ["archived", "Archived", { archived: "true", status: "archived" }],
              ].map(([queue, label, next]) => <button key={String(queue)} type="button" role="tab" aria-selected={activeQueue === queue} onClick={() => setQueue(String(queue), next as Record<string, string>)}>{String(label)}</button>)}
            </div>
            <details className="filter-drawer">
              <summary aria-label="Advanced filters drawer">Advanced filters</summary>
              <div className="filter-grid">
                <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search name, number, project, scope, location" />
                <input value={filters.project_id ?? ""} onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} placeholder="Project id" />
                <Select label="Status" value={filters.status ?? ""} options={["", ...workOrderStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
                <Select label="Readiness status" value={filters.readiness_status ?? ""} options={["", ...readinessStatuses]} onChange={(readiness_status) => setFilters({ ...filters, readiness_status })} />
                <Select label="QC status" value={filters.qc_status ?? ""} options={["", ...qcStatuses]} onChange={(qc_status) => setFilters({ ...filters, qc_status })} />
                <Select label="Billable status" value={filters.billable_status ?? ""} options={["", ...billableStatuses]} onChange={(billable_status) => setFilters({ ...filters, billable_status })} />
                <input value={filters.territory_id ?? ""} onChange={(event) => setFilters({ ...filters, territory_id: event.target.value })} placeholder="Territory id/name" />
                <input value={filters.work_type ?? ""} onChange={(event) => setFilters({ ...filters, work_type: event.target.value })} placeholder="Work type" />
                <Select label="Assignment type" value={filters.assignment_type ?? ""} options={["", ...assignmentTypes]} onChange={(assignment_type) => setFilters({ ...filters, assignment_type })} />
                <input value={filters.assigned_capacity_provider_id ?? ""} onChange={(event) => setFilters({ ...filters, assigned_capacity_provider_id: event.target.value })} placeholder="Assigned provider" />
                <input value={filters.assigned_crew_id ?? ""} onChange={(event) => setFilters({ ...filters, assigned_crew_id: event.target.value })} placeholder="Assigned crew" />
                <Select label="Production eligible" value={filters.production_eligible ?? ""} options={["", "true", "false"]} onChange={(production_eligible) => setFilters({ ...filters, production_eligible })} />
                <Select label="Has blockers" value={filters.hasBlockers ?? ""} options={["", "true", "false"]} onChange={(hasBlockers) => setFilters({ ...filters, hasBlockers })} />
                <Select label="Has warnings" value={filters.hasWarnings ?? ""} options={["", "true", "false"]} onChange={(hasWarnings) => setFilters({ ...filters, hasWarnings })} />
                <input value={filters.planned_start_from ?? ""} onChange={(event) => setFilters({ ...filters, planned_start_from: event.target.value })} type="date" aria-label="Planned start from" />
                <input value={filters.planned_start_to ?? ""} onChange={(event) => setFilters({ ...filters, planned_start_to: event.target.value })} type="date" aria-label="Planned start to" />
                <input value={filters.scheduled_start_from ?? ""} onChange={(event) => setFilters({ ...filters, scheduled_start_from: event.target.value })} type="date" aria-label="Scheduled start from" />
                <input value={filters.scheduled_start_to ?? ""} onChange={(event) => setFilters({ ...filters, scheduled_start_to: event.target.value })} type="date" aria-label="Scheduled start to" />
                <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
                <Select label="Sort" value={filters.sort ?? "default"} options={["default", "updated_desc", "planned_start_asc", "scheduled_start_asc", "readiness_asc", "readiness_desc", "status", "project", "assigned_provider"]} labels={{ default: "Default", updated_desc: "Recently updated", planned_start_asc: "Planned start", scheduled_start_asc: "Scheduled start", readiness_asc: "Lowest readiness", readiness_desc: "Highest readiness", status: "Status", project: "Project", assigned_provider: "Assigned provider" }} onChange={(sort) => setFilters({ ...filters, sort })} />
              </div>
            </details>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>{queueTitle(activeQueue)}</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No work orders yet. Create or accept a project handoff before field execution begins.</div> : null}
            {rows.length && !visible.length ? <div className="empty-state">{emptyWorkOrderQueue(activeQueue)}</div> : null}
            {visible.length ? <WorkOrderTable rows={visible} /> : null}
          </section>
        </>
      ) : null}
    </WorkOrderShell>
  );
}

export function WorkOrderCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ assignment_type: "unassigned", unit: "feet" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session.token) return;
    void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = buildWorkOrderPayload(form, true);
      const created = await syncosFetch<SyncRecord>("/work-orders", { method: "POST", body, token: session.token });
      const createdWorkOrder = created.work_order as SyncRecord | undefined;
      const id = String(created.id ?? createdWorkOrder?.id ?? created.entityId ?? "");
      router.push(id ? `/work-orders/${id}` : "/work-orders");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <WorkOrderShell title="Create Work Order" purpose="Create a specific work package under a project. No production or finance records are created.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <FormPurposeHeader title="Create Work Order" purpose="Create an executable field work package under an approved project." afterSave="the work order opens in detail view for assignment, scheduling, and lifecycle action review." />
        <RequiredFieldNote>Project and assignment type are required to create a work order. Scheduling, production, QC, and billing happen through separate supported actions.</RequiredFieldNote>
        <FormBoundaryNotice>Creating a work order does not create production, QC approval, invoice, cash, payment, payroll, bank, or accounting records.</FormBoundaryNotice>
        <div className="warning-box">The backend enforces tenant boundaries, valid project status, approved units, and write-action audit behavior.</div>
        <FormSection title="Required planning fields" description="These fields establish which approved project owns the executable work package.">
          <WorkOrderFormFields form={form} setForm={setForm} related={related} includeRequired />
        </FormSection>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "work_order.create")}>Create Work Order</button>
          <Link className="link-button" href="/work-orders">Cancel</Link>
        </div>
      </form>
    </WorkOrderShell>
  );
}

export function WorkOrderEdit({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return setLoading(false);
      try {
        const [detail, nextRelated] = await Promise.all([
          syncosFetch<WorkOrderDetailShape>(`/work-orders/${workOrderId}/detail`, { token: session.token }),
          loadRelated(session.token),
        ]);
        const workOrder = detail.work_order;
        setRelated(nextRelated);
        setForm({
          work_order_name: String(workOrder.work_order_name ?? workOrder.title ?? ""),
          work_order_number: String(workOrder.work_order_number ?? ""),
          customer_work_order_number: String(workOrder.customer_work_order_number ?? ""),
          prime_work_order_number: String(workOrder.prime_work_order_number ?? ""),
          internal_work_order_number: String(workOrder.internal_work_order_number ?? ""),
          scope_summary: String(workOrder.scope_summary ?? ""),
          location_summary: String(workOrder.location_summary ?? ""),
          route_name: String(workOrder.route_name ?? ""),
          node_id: String(workOrder.node_id ?? ""),
          segment_id: String(workOrder.segment_id ?? ""),
          address_range: String(workOrder.address_range ?? ""),
          permit_reference: String(workOrder.permit_reference ?? ""),
          map_link: String(workOrder.map_link ?? ""),
          work_type: String(workOrder.work_type ?? ""),
          territory_id: String(workOrder.territory_id ?? ""),
          planned_quantity: String(workOrder.planned_quantity ?? ""),
          unit: String(workOrder.unit ?? ""),
          planned_start_date: dateInput(workOrder.planned_start_date),
          planned_end_date: dateInput(workOrder.planned_end_date),
          scheduled_start_date: dateInput(workOrder.scheduled_start_date),
          scheduled_end_date: dateInput(workOrder.scheduled_end_date),
          owner_user_id: String(workOrder.owner_user_id ?? ""),
          field_supervisor_user_id: String(workOrder.field_supervisor_user_id ?? ""),
          qc_owner_user_id: String(workOrder.qc_owner_user_id ?? ""),
          documentation_requirements: jsonText(workOrder.documentation_requirements),
          production_requirements: jsonText(workOrder.production_requirements),
          customer_validation_requirements: jsonText(workOrder.customer_validation_requirements),
          billing_package_requirements: jsonText(workOrder.billing_package_requirements),
          risk_notes: String(workOrder.risk_notes ?? ""),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [session.token, workOrderId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/work-orders/${workOrderId}`, { method: "PATCH", body: buildWorkOrderPayload(form, false), token: session.token });
      router.push(`/work-orders/${workOrderId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <WorkOrderShell title="Edit Work Order" purpose="Edit planning fields without bypassing lifecycle or assignment action routes.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Loading work order...</div> : null}
      {!loading ? (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Status changes use lifecycle actions from Work Order Detail. Assignment uses the Assign action. This form does not create production or finance records.</div>
          <WorkOrderFormFields form={form} setForm={setForm} related={related} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "work_order.update")}>Save Work Order</button>
            <Link className="link-button" href={`/work-orders/${workOrderId}`}>Cancel</Link>
          </div>
        </form>
      ) : null}
    </WorkOrderShell>
  );
}

export function WorkOrderDetail({ workOrderId }: { workOrderId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<WorkOrderDetailShape | null>(null);
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const [next, timeline, audit, nextRelated] = await Promise.all([
        syncosFetch<WorkOrderDetailShape>(`/work-orders/${workOrderId}/detail`, { token: session.token }),
        optionalList(`/work-orders/${workOrderId}/timeline`, session.token),
        optionalList(`/work-orders/${workOrderId}/audit-summary`, session.token),
        loadRelated(session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
      setRelated(nextRelated);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, workOrderId]);

  const workOrder = detail?.work_order;
  const warnings = detail?.warnings ?? arrayValue(workOrder?.warnings);
  const blockers = detail?.blockers ?? arrayValue(workOrder?.blockers);

  return (
    <WorkOrderShell title="Work Order Detail" purpose="Review scope, readiness, assignment, schedule, quantity, lifecycle status, timeline, and audit.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Work Order Detail.</div> : null}
      {!workOrder && session.token && !error ? <div className="empty-state">Work order not found or you do not have access.</div> : null}
      {workOrder && detail ? (
        <>
          {!hasPermission(session.permissions, "work_order.update") ? <ReadOnlyBanner /> : null}
          <DetailNextActionCard
            status={formatAction(workOrder.status)}
            nextActionLabel={nextWorkOrderAction(workOrder)}
            helperText="Use this detail page to understand field execution state, assignment, production readiness, QC movement, and billable readiness before taking an action."
            disabled={!hasPermission(session.permissions, "work_order.update")}
            disabledReason="Read-only users cannot perform lifecycle actions."
            boundaryText="Work order actions manage field execution state. They do not create production, QC approval, invoice, cash, or payment records unless a separate supported action exists."
          />
          <DetailBoundaryNotice>Work order actions manage field execution state. They do not create production, QC approval, invoice, cash, payment, payroll, bank, or accounting records unless a separate supported action exists.</DetailBoundaryNotice>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(workOrder.work_order_name ?? workOrder.title, "Untitled work order")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(workOrder.status)}</span>
                  <span className="badge">{formatAction(workOrder.readiness_band)}</span>
                  <span className="badge">{formatAction(workOrder.assignment_type)}</span>
                  <span className="badge">{formatAction(workOrder.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/work-orders/${workOrderId}/edit`} aria-disabled={!hasPermission(session.permissions, "work_order.update")}>Edit Work Order</Link>
                <ActionButton permission="work_order.recalculate_readiness" session={session} onClick={() => setModal("recalculate")}>Recalculate Readiness</ActionButton>
                <ActionButton permission="work_order.mark_ready" session={session} disabled={String(workOrder.status) !== "draft"} onClick={() => setModal("mark_ready")}>Mark Ready To Assign</ActionButton>
                <ActionButton permission="work_order.assign" session={session} disabled={closedStatus(workOrder)} onClick={() => setModal("assign")}>Assign Provider/Crew</ActionButton>
                <ActionButton permission="work_order.schedule" session={session} disabled={!["ready_to_assign", "assigned"].includes(String(workOrder.status))} onClick={() => setModal("schedule")}>Schedule</ActionButton>
                <ActionButton permission="work_order.start" session={session} disabled={!["assigned", "scheduled"].includes(String(workOrder.status))} onClick={() => setModal("start")}>Start</ActionButton>
                <ActionButton permission="work_order.submit" session={session} disabled={String(workOrder.status) !== "in_progress"} onClick={() => setModal("submit")}>Submit</ActionButton>
                <ActionButton permission="work_order.qc_review" session={session} disabled={String(workOrder.status) !== "submitted"} onClick={() => setModal("qc_review")}>Start QC Review</ActionButton>
                <ActionButton permission="work_order.corrections" session={session} disabled={!["submitted", "qc_review"].includes(String(workOrder.status))} onClick={() => setModal("corrections")}>Request Corrections</ActionButton>
                <ActionButton permission="work_order.approve" session={session} disabled={!["submitted", "qc_review", "corrections_required"].includes(String(workOrder.status))} onClick={() => setModal("approve")}>Approve</ActionButton>
                <ActionButton permission="work_order.mark_billable" session={session} disabled={closedStatus(workOrder)} onClick={() => setModal("billable")}>Mark Billable</ActionButton>
                <ActionButton permission="work_order.place_hold" session={session} disabled={closedStatus(workOrder) || String(workOrder.status) === "on_hold"} onClick={() => setModal("hold")}>Place On Hold</ActionButton>
                <ActionButton permission="work_order.release_hold" session={session} disabled={String(workOrder.status) !== "on_hold"} onClick={() => setModal("release")}>Release Hold</ActionButton>
                <ActionButton permission="work_order.cancel" session={session} disabled={!["draft", "ready_to_assign", "assigned", "scheduled", "on_hold"].includes(String(workOrder.status))} onClick={() => setModal("cancel")}>Cancel</ActionButton>
                <ActionButton permission="work_order.close" session={session} disabled={!["approved", "billable"].includes(String(workOrder.status))} onClick={() => setModal("close")}>Close</ActionButton>
                <ActionButton permission="work_order.archive" session={session} disabled={String(workOrder.status) === "archived"} onClick={() => setModal("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Work Order Readiness" value={scoreValue(workOrder.readiness_score)} />
              <Metric label="Readiness Status" value={formatAction(workOrder.readiness_status)} />
              <Metric label="Production Eligible" value={workOrder.production_eligible ? "Yes" : "No"} />
              <Metric label="Planned Quantity" value={quantity(workOrder.planned_quantity, workOrder.unit)} />
              <Metric label="Completed Quantity" value={quantity(workOrder.completed_quantity, workOrder.unit)} />
              <Metric label="Approved Quantity" value={quantity(workOrder.approved_quantity, workOrder.unit)} />
              <Metric label="Billable Quantity" value={quantity(workOrder.billable_quantity, workOrder.unit)} />
              <Metric label="QC Status" value={formatAction(workOrder.qc_status)} />
              <Metric label="Billable Status" value={formatAction(workOrder.billable_status)} />
              <Metric label="Blockers" value={String(blockers.length)} />
              <Metric label="Warnings" value={String(warnings.length)} />
              <Metric label="Recommended Next Action" value={formatAction(workOrder.recommended_next_action)} />
            </div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Project</dt><dd>{projectLink(workOrder.project_id, workOrder.project_name)}</dd>
                <dt>Project status</dt><dd>{formatAction(workOrder.project_status ?? detail.project_context?.status)}</dd>
                <dt>Coverage source</dt><dd>{textValue(workOrder.coverage_source_id ?? detail.coverage_context?.coverage_source_id, "Not connected")}</dd>
                <dt>Assignment type</dt><dd>{formatAction(workOrder.assignment_type)}</dd>
                <dt>Assigned provider</dt><dd>{textValue(workOrder.assigned_capacity_provider_name ?? workOrder.assigned_capacity_provider_id)}</dd>
                <dt>Assigned crew</dt><dd>{textValue(workOrder.assigned_crew_name ?? workOrder.assigned_crew_id)}</dd>
                <dt>Territory</dt><dd>{textValue(workOrder.territory_name ?? workOrder.territory_id)}</dd>
                <dt>Work type</dt><dd>{formatAction(workOrder.work_type)}</dd>
                <dt>Planned dates</dt><dd>{dateValue(workOrder.planned_start_date)} - {dateValue(workOrder.planned_end_date)}</dd>
                <dt>Scheduled dates</dt><dd>{dateValue(workOrder.scheduled_start_date)} - {dateValue(workOrder.scheduled_end_date)}</dd>
                <dt>Actual dates</dt><dd>{dateValue(workOrder.actual_start_date)} - {dateValue(workOrder.actual_end_date)}</dd>
              </dl>
              <Checklist items={readinessChecklist(workOrder, detail)} />
              <WarningList title="Key Blockers" rows={blockers.slice(0, 4)} empty="No blockers returned." />
              <WarningList title="Key Warnings" rows={warnings.slice(0, 4)} empty="No warnings returned." />
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}
              </div>
              <WorkOrderTab tab={tab} detail={detail} workOrder={workOrder} session={session} />
            </section>
          </div>
          {modal ? <LifecycleModal type={modal} workOrderId={workOrderId} workOrder={workOrder} detail={detail} related={related} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </WorkOrderShell>
  );
}

function WorkOrderShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/work-orders", "Directory", "active"],
    ["/work-orders/new", "Create", "active"],
    ["#detail", "Detail", "placeholder"],
    ["#readiness", "Readiness", "placeholder"],
    ["#assignment", "Assignment", "placeholder"],
    ["#schedule", "Schedule", "placeholder"],
    ["#scope", "Scope & Location", "placeholder"],
    ["#quantity", "Quantity", "placeholder"],
    ["#production", "Production Summary", "placeholder"],
    ["#qc", "QC Summary", "placeholder"],
    ["#billable", "Billable Summary", "placeholder"],
    ["#risks", "Constraints / Risks", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-production", "Future Production", "placeholder"],
    ["#future-settlement", "Future Settlement", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Work Orders</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function WorkOrderTable({ rows }: { rows: SyncRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Work Order", "Project", "Territory / Location", "Crew / Owner", "Status", "Production Status", "QC Status", "Blocker", "Age / Due Date", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>
                <Link className="table-link" href={`/work-orders/${row.id}`}>{textValue(row.work_order_name ?? row.title, "Untitled work order")}</Link>
                <small className="cell-helper">{textValue(row.work_order_number ?? row.customer_work_order_number ?? row.prime_work_order_number, "No work order number")}</small>
              </td>
              <td>{projectLink(row.project_id, row.project_name)}</td>
              <td>
                {textValue(row.territory_name ?? row.territory_id)}
                <small className="cell-helper">{textValue(row.location_summary)}</small>
              </td>
              <td>
                {textValue(row.assigned_crew_name ?? row.assigned_capacity_provider_name ?? row.assigned_crew_id ?? row.assigned_capacity_provider_id, "Unassigned")}
                <small className="cell-helper">{formatAction(row.assignment_type)}</small>
              </td>
              <td><span className={`status-badge ${statusTone(row.status)}`}>{formatAction(row.status)}</span></td>
              <td>{productionState(row)}</td>
              <td>{formatAction(row.qc_status)}</td>
              <td>{blockerText(row)}</td>
              <td>
                {ageText(row.updated_at)}
                <small className="cell-helper">Due {dateValue(row.scheduled_start_date ?? row.planned_start_date)}</small>
              </td>
              <td>{nextWorkOrderAction(row)}</td>
              <td><Link className="link-button" href={`/work-orders/${row.id}`}>Open Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkOrderTab({ tab, detail, workOrder, session }: { tab: string; detail: WorkOrderDetailShape; workOrder: SyncRecord; session: Session }) {
  if (tab === "overview") {
    return <Panel title="Overview"><dl className="detail-list">
      <dt>Work Order</dt><dd>{textValue(workOrder.work_order_name ?? workOrder.title)}</dd>
      <dt>Work Order Number</dt><dd>{textValue(workOrder.work_order_number)}</dd>
      <dt>Customer Work Order Number</dt><dd>{textValue(workOrder.customer_work_order_number)}</dd>
      <dt>Prime Work Order Number</dt><dd>{textValue(workOrder.prime_work_order_number)}</dd>
      <dt>Internal Work Order Number</dt><dd>{textValue(workOrder.internal_work_order_number)}</dd>
      <dt>Status</dt><dd>{formatAction(workOrder.status)}</dd>
      <dt>Readiness status</dt><dd>{formatAction(workOrder.readiness_status)}</dd>
      <dt>QC status</dt><dd>{formatAction(workOrder.qc_status)}</dd>
      <dt>Billable status</dt><dd>{formatAction(workOrder.billable_status)}</dd>
      <dt>Scope</dt><dd>{textValue(workOrder.scope_summary)}</dd>
      <dt>Location</dt><dd>{textValue(workOrder.location_summary)}</dd>
      <dt>Risk notes</dt><dd>{textValue(workOrder.risk_notes)}</dd>
      <dt>Created</dt><dd>{dateValue(workOrder.created_at)}</dd>
      <dt>Updated</dt><dd>{dateValue(workOrder.updated_at)}</dd>
    </dl><div className="warning-box">This work order is a specific executable work package under a project. It does not create production records, QC evidence, settlements, invoices, payments, or payroll.</div></Panel>;
  }
  if (tab === "project") return <ContextPanel title="Project Context" record={detail.project_context} href={workOrder.project_id ? `/projects/${workOrder.project_id}` : undefined} fields={["project_name", "status", "project_readiness_score", "customer_organization_name", "territory_name", "work_type", "scope_summary", "location_summary", "project_manager_name", "field_supervisor_name"]} />;
  if (tab === "coverage") return <Panel title="Coverage Context"><dl className="detail-list"><dt>Coverage Plan</dt><dd>{coverageLink(workOrder.coverage_plan_id)}</dd><dt>Coverage Requirement</dt><dd>{textValue(workOrder.coverage_requirement_id)}</dd><dt>Coverage Source</dt><dd>{textValue(workOrder.coverage_source_id)}</dd><dt>Source type</dt><dd>{formatAction(detail.coverage_context?.source_type)}</dd><dt>Commitment status</dt><dd>{formatAction(detail.coverage_context?.commitment_status)}</dd><dt>Confidence score</dt><dd>{scoreValue(detail.coverage_context?.confidence_score)}</dd><dt>Covered quantity</dt><dd>{quantity(detail.coverage_context?.covered_quantity, detail.coverage_context?.unit)}</dd><dt>Coverage readiness</dt><dd>{scoreValue(detail.coverage_context?.coverage_readiness_score)}</dd></dl>{workOrder.coverage_plan_id ? <Link className="link-button" href={`/opportunities/coverage/${workOrder.coverage_plan_id}`}>Open Coverage Plan</Link> : <div className="empty-state">This work order is not connected to a coverage source yet.</div>}</Panel>;
  if (tab === "assignment") return <Panel title="Assignment"><dl className="detail-list"><dt>Assignment type</dt><dd>{formatAction(workOrder.assignment_type)}</dd><dt>Assigned organization</dt><dd>{textValue(workOrder.assigned_organization_name ?? workOrder.assigned_organization_id)}</dd><dt>Assigned capacity provider</dt><dd>{providerLink(workOrder.assigned_capacity_provider_id, workOrder.assigned_capacity_provider_name)}</dd><dt>Assigned crew</dt><dd>{textValue(workOrder.assigned_crew_name ?? workOrder.assigned_crew_id)}</dd><dt>Assigned equipment</dt><dd>{textValue(workOrder.assigned_equipment_id)}</dd><dt>Assigned by</dt><dd>{textValue(workOrder.assigned_by)}</dd><dt>Assigned at</dt><dd>{dateValue(workOrder.assigned_at)}</dd><dt>Assignment note</dt><dd>{textValue(workOrder.assignment_note)}</dd></dl><WarningList title="Assignment Warnings" rows={arrayValue(detail.warnings).filter((row) => /assignment|provider|crew|equipment|coverage_source/i.test(JSON.stringify(row)))} empty="No assignment warnings returned." /></Panel>;
  if (tab === "schedule") return <Panel title="Schedule"><dl className="detail-list"><dt>Planned start</dt><dd>{dateValue(workOrder.planned_start_date)}</dd><dt>Planned end</dt><dd>{dateValue(workOrder.planned_end_date)}</dd><dt>Scheduled start</dt><dd>{dateValue(workOrder.scheduled_start_date)}</dd><dt>Scheduled end</dt><dd>{dateValue(workOrder.scheduled_end_date)}</dd><dt>Actual start</dt><dd>{dateValue(workOrder.actual_start_date)}</dd><dt>Actual end</dt><dd>{dateValue(workOrder.actual_end_date)}</dd></dl></Panel>;
  if (tab === "scope") return <Panel title="Scope & Location"><dl className="detail-list"><dt>Scope</dt><dd>{textValue(workOrder.scope_summary)}</dd><dt>Location</dt><dd>{textValue(workOrder.location_summary)}</dd><dt>Route</dt><dd>{textValue(workOrder.route_name)}</dd><dt>Node ID</dt><dd>{textValue(workOrder.node_id)}</dd><dt>Segment ID</dt><dd>{textValue(workOrder.segment_id)}</dd><dt>Address range</dt><dd>{textValue(workOrder.address_range)}</dd><dt>Permit reference</dt><dd>{textValue(workOrder.permit_reference)}</dd><dt>Map link</dt><dd>{textValue(workOrder.map_link)}</dd><dt>Territory</dt><dd>{textValue(workOrder.territory_name ?? workOrder.territory_id)}</dd><dt>Work type</dt><dd>{formatAction(workOrder.work_type)}</dd></dl></Panel>;
  if (tab === "quantity") return <Panel title="Quantity"><dl className="detail-list"><dt>Planned quantity</dt><dd>{quantity(workOrder.planned_quantity, workOrder.unit)}</dd><dt>Completed quantity</dt><dd>{quantity(workOrder.completed_quantity, workOrder.unit)}</dd><dt>Approved quantity</dt><dd>{quantity(workOrder.approved_quantity, workOrder.unit)}</dd><dt>Billable quantity</dt><dd>{quantity(workOrder.billable_quantity, workOrder.unit)}</dd><dt>Unit</dt><dd>{formatAction(workOrder.unit)}</dd></dl><div className="warning-box">Completed quantity will be driven by Production later. Approved quantity will be driven by QC later. Billable quantity will feed Settlement later. This sprint only displays and moves Work Order lifecycle states.</div></Panel>;
  if (tab === "readiness") return <Panel title="Readiness"><div className="summary-grid"><Metric label="Readiness score" value={scoreValue(workOrder.readiness_score)} /><Metric label="Readiness status" value={formatAction(workOrder.readiness_status)} /><Metric label="Readiness band" value={formatAction(workOrder.readiness_band)} /><Metric label="Production eligible" value={workOrder.production_eligible ? "Yes" : "No"} /><Metric label="Next action" value={formatAction(workOrder.recommended_next_action)} /></div><WarningList title="Warnings" rows={detail.warnings ?? []} empty="No warnings returned." /><WarningList title="Blockers" rows={detail.blockers ?? []} empty="No blockers returned." /><Checklist items={readinessChecklist(workOrder, detail)} /></Panel>;
  if (tab === "production") return <Panel title="Production Summary"><dl className="detail-list"><dt>Production eligible</dt><dd>{workOrder.production_eligible ? "Yes" : "No"}</dd><dt>Production record count</dt><dd>{formatCell(detail.production_summary?.production_record_count ?? workOrder.production_record_count)}</dd><dt>Completed quantity</dt><dd>{quantity(workOrder.completed_quantity, workOrder.unit)}</dd><dt>Production status summary</dt><dd><JsonBlock value={detail.production_summary} /></dd></dl><div className="warning-box">Production entry is not available in this sprint. Production records will capture field-completed work against this work order.</div></Panel>;
  if (tab === "qc") return <Panel title="QC Summary"><dl className="detail-list"><dt>QC status</dt><dd>{formatAction(workOrder.qc_status)}</dd><dt>Corrections state</dt><dd>{String(workOrder.status) === "corrections_required" ? "Corrections required" : "No active correction state returned"}</dd><dt>Approved quantity</dt><dd>{quantity(workOrder.approved_quantity, workOrder.unit)}</dd></dl><WarningList title="QC Warnings" rows={arrayValue(detail.warnings).filter((row) => /qc|correction|approved/i.test(JSON.stringify(row)))} empty="No QC warnings returned." /><div className="warning-box">QC evidence and detailed inspection workflow are not available in this sprint. Work Order status can reflect QC review state, but evidence remains a future workflow.</div></Panel>;
  if (tab === "billable") return <Panel title="Billable Summary"><dl className="detail-list"><dt>Billable status</dt><dd>{formatAction(workOrder.billable_status)}</dd><dt>Billable quantity</dt><dd>{quantity(workOrder.billable_quantity, workOrder.unit)}</dd><dt>Billing package requirements</dt><dd><JsonBlock value={workOrder.billing_package_requirements ?? detail.billable_summary?.billing_package_requirements} /></dd><dt>Customer validation requirements</dt><dd><JsonBlock value={workOrder.customer_validation_requirements} /></dd></dl><div className="warning-box">Marking a work order billable does not create settlement, invoice, payment, AR, cash, or payroll records. It only prepares the work order for a future billing workflow.</div></Panel>;
  if (tab === "constraints") return <Panel title="Constraints / Risks"><ObjectTable rows={constraintRows(detail.constraints_summary)} columns={["type", "severity", "status", "owner", "due_date", "hard_stop", "recommended_action"]} /><div className="form-actions"><Link className="link-button" href="/constraints-center">Open Constraints</Link></div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor_name", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") {
    if (!hasPermission(session.permissions, "work_order.audit.read")) return <Panel title="Audit"><div className="empty-state">You do not have permission to view work order audit details.</div></Panel>;
    return <Panel title="Audit"><ObjectTable rows={detail._audit ?? []} columns={["actor_name", "action", "object_type", "object_id", "reason", "created_at", "correlation_id"]} /></Panel>;
  }
  if (tab === "future_production") return <PlaceholderPanel title="Future Production" message="Production entry is not available in this sprint. Production records will capture field-completed work against this work order." columns={["Date", "Crew/provider", "Quantity completed", "Unit", "Evidence/photos", "QC status", "Billable status"]} />;
  if (tab === "future_settlement") return <PlaceholderPanel title="Future Settlement" message="Settlement and finance execution are not available in this sprint. Work Order billable state only prepares future billing workflow." columns={["Settlement package", "Invoice", "Payment", "AR", "Cash", "Payroll"]} />;
  return null;
}

function LifecycleModal({ type, workOrderId, workOrder, detail, related, session, onClose, onSaved }: { type: string; workOrderId: string; workOrder: SyncRecord; detail: WorkOrderDetailShape; related: RelatedData; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({ assignment_type: String(workOrder.assignment_type ?? "unassigned") });
  const [error, setError] = useState("");
  const warnings = detail.warnings ?? [];
  const blockers = detail.blockers ?? [];
  const blocked = type === "mark_ready" && blockers.length > 0;
  const title = formatAction(type);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (type === "recalculate") await syncosFetch(`/work-orders/${workOrderId}/recalculate-readiness`, { method: "POST", body: {}, token: session.token });
      if (type === "mark_ready") await syncosFetch(`/work-orders/${workOrderId}/mark-ready-to-assign`, { method: "POST", body: { override_reasons: overrideReasons(form) }, token: session.token });
      if (type === "assign") await syncosFetch(`/work-orders/${workOrderId}/assign`, { method: "POST", body: prune({ assignment_type: form.assignment_type, assigned_organization_id: form.assigned_organization_id, assigned_capacity_provider_id: form.assigned_capacity_provider_id, assigned_crew_id: form.assigned_crew_id, assigned_equipment_id: form.assigned_equipment_id, assignment_note: form.assignment_note, override_reasons: overrideReasons(form) }), token: session.token });
      if (type === "schedule") await syncosFetch(`/work-orders/${workOrderId}/schedule`, { method: "POST", body: prune({ scheduled_start_date: form.scheduled_start_date, scheduled_end_date: form.scheduled_end_date, schedule_note: form.schedule_note }), token: session.token });
      if (type === "start") await syncosFetch(`/work-orders/${workOrderId}/start`, { method: "POST", body: prune({ start_note: form.start_note }), token: session.token });
      if (type === "submit") await syncosFetch(`/work-orders/${workOrderId}/submit`, { method: "POST", body: prune({ submit_note: form.submit_note }), token: session.token });
      if (type === "qc_review") await syncosFetch(`/work-orders/${workOrderId}/start-qc-review`, { method: "POST", body: prune({ qc_review_note: form.qc_review_note }), token: session.token });
      if (type === "corrections") await syncosFetch(`/work-orders/${workOrderId}/request-corrections`, { method: "POST", body: { correction_reason: form.correction_reason, correction_note: form.correction_note }, token: session.token });
      if (type === "approve") await syncosFetch(`/work-orders/${workOrderId}/approve`, { method: "POST", body: prune({ approval_note: form.approval_note, approved_quantity: form.approved_quantity }), token: session.token });
      if (type === "billable") await syncosFetch(`/work-orders/${workOrderId}/mark-billable`, { method: "POST", body: prune({ billable_note: form.billable_note, override_reason: form.override_reason }), token: session.token });
      if (type === "hold") await syncosFetch(`/work-orders/${workOrderId}/place-on-hold`, { method: "POST", body: { hold_reason: form.hold_reason, hold_note: form.hold_note }, token: session.token });
      if (type === "release") await syncosFetch(`/work-orders/${workOrderId}/release-hold`, { method: "POST", body: { release_note: form.release_note }, token: session.token });
      if (type === "cancel") await syncosFetch(`/work-orders/${workOrderId}/cancel`, { method: "POST", body: { cancellation_reason: form.cancellation_reason, cancellation_note: form.cancellation_note }, token: session.token });
      if (type === "close") await syncosFetch(`/work-orders/${workOrderId}/close`, { method: "POST", body: { closeout_notes: form.closeout_notes }, token: session.token });
      if (type === "archive") await syncosFetch(`/work-orders/${workOrderId}/archive`, { method: "POST", body: { archive_reason: form.archive_reason, archive_note: form.archive_note }, token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-panel compact-modal" onSubmit={(event) => void submit(event)}>
        <div className="section-toolbar"><h2>{title}</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        {type === "mark_ready" ? <><WarningList title="Warnings" rows={warnings} empty="No warnings returned." /><WarningList title="Blockers" rows={blockers} empty="No blockers returned." />{warnings.length ? <label>Override reason<textarea value={form.readiness_override_reason ?? ""} onChange={(event) => setForm({ ...form, readiness_override_reason: event.target.value })} required /></label> : null}</> : null}
        {type === "assign" ? <><div className="form-grid"><label>Assignment type<SelectInline value={form.assignment_type ?? "unassigned"} options={assignmentTypes} onChange={(assignment_type) => setForm({ ...form, assignment_type })} /></label><label>Assigned organization<SelectInline value={form.assigned_organization_id ?? ""} options={["", ...related.organizations.map((row) => String(row.id))]} labels={labelsFor(related.organizations)} onChange={(assigned_organization_id) => setForm({ ...form, assigned_organization_id })} /></label><label>Assigned provider<SelectInline value={form.assigned_capacity_provider_id ?? ""} options={["", ...related.capacityProviders.map((row) => String(row.id))]} labels={labelsFor(related.capacityProviders)} onChange={(assigned_capacity_provider_id) => setForm({ ...form, assigned_capacity_provider_id })} /></label><label>Assigned crew<SelectInline value={form.assigned_crew_id ?? ""} options={["", ...related.crews.map((row) => String(row.id))]} labels={labelsFor(related.crews)} onChange={(assigned_crew_id) => setForm({ ...form, assigned_crew_id })} /></label><label>Assigned equipment<SelectInline value={form.assigned_equipment_id ?? ""} options={["", ...related.equipment.map((row) => String(row.id))]} labels={labelsFor(related.equipment)} onChange={(assigned_equipment_id) => setForm({ ...form, assigned_equipment_id })} /></label><label>Assignment note<textarea value={form.assignment_note ?? ""} onChange={(event) => setForm({ ...form, assignment_note: event.target.value })} /></label><label>Assignment override reason<textarea value={form.assignment_override_reason ?? ""} onChange={(event) => setForm({ ...form, assignment_override_reason: event.target.value })} /></label></div><div className="warning-box">Assignment does not create dispatch or production.</div></> : null}
        {type === "schedule" ? <div className="form-grid"><label>Scheduled start<input type="date" value={form.scheduled_start_date ?? ""} onChange={(event) => setForm({ ...form, scheduled_start_date: event.target.value })} /></label><label>Scheduled end<input type="date" value={form.scheduled_end_date ?? ""} onChange={(event) => setForm({ ...form, scheduled_end_date: event.target.value })} /></label><label>Schedule note<textarea value={form.schedule_note ?? ""} onChange={(event) => setForm({ ...form, schedule_note: event.target.value })} /></label></div> : null}
        {type === "start" ? <><label>Start note<textarea value={form.start_note ?? ""} onChange={(event) => setForm({ ...form, start_note: event.target.value })} /></label><div className="warning-box">This action does not create production records.</div></> : null}
        {type === "submit" ? <><label>Submit note<textarea value={form.submit_note ?? ""} onChange={(event) => setForm({ ...form, submit_note: event.target.value })} /></label><div className="warning-box">Submitting a Work Order does not create a production record.</div></> : null}
        {type === "qc_review" ? <><label>QC review note<textarea value={form.qc_review_note ?? ""} onChange={(event) => setForm({ ...form, qc_review_note: event.target.value })} /></label><div className="warning-box">Starting QC review does not create QC evidence.</div></> : null}
        {type === "corrections" ? <><label>Correction reason<textarea value={form.correction_reason ?? ""} onChange={(event) => setForm({ ...form, correction_reason: event.target.value })} required /></label><label>Correction note<textarea value={form.correction_note ?? ""} onChange={(event) => setForm({ ...form, correction_note: event.target.value })} /></label></> : null}
        {type === "approve" ? <><label>Approval note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><label>Approved quantity<input type="number" min="0" value={form.approved_quantity ?? ""} onChange={(event) => setForm({ ...form, approved_quantity: event.target.value })} /></label></> : null}
        {type === "billable" ? <><label>Billable note<textarea value={form.billable_note ?? ""} onChange={(event) => setForm({ ...form, billable_note: event.target.value })} /></label><label>Override reason<textarea value={form.override_reason ?? ""} onChange={(event) => setForm({ ...form, override_reason: event.target.value })} /></label><div className="warning-box">Mark billable creates no settlement, invoice, payment, AR, cash, or payroll record.</div></> : null}
        {type === "hold" ? <><label>Hold reason<textarea value={form.hold_reason ?? ""} onChange={(event) => setForm({ ...form, hold_reason: event.target.value })} required /></label><label>Hold note<textarea value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label></> : null}
        {type === "release" ? <label>Release note<textarea value={form.release_note ?? ""} onChange={(event) => setForm({ ...form, release_note: event.target.value })} required /></label> : null}
        {type === "cancel" ? <><label>Cancellation reason<textarea value={form.cancellation_reason ?? ""} onChange={(event) => setForm({ ...form, cancellation_reason: event.target.value })} required /></label><label>Cancellation note<textarea value={form.cancellation_note ?? ""} onChange={(event) => setForm({ ...form, cancellation_note: event.target.value })} /></label></> : null}
        {type === "close" ? <label>Closeout notes<textarea value={form.closeout_notes ?? ""} onChange={(event) => setForm({ ...form, closeout_notes: event.target.value })} required /></label> : null}
        {type === "archive" ? <><label>Archive reason<SelectInline value={form.archive_reason ?? ""} options={["", ...archiveReasons]} onChange={(archive_reason) => setForm({ ...form, archive_reason })} /></label><label>Archive note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {type === "recalculate" ? <div className="warning-box">Readiness recalculation updates Work Order readiness only.</div> : null}
        <div className="form-actions"><button className="primary-button" type="submit" disabled={blocked}>{title}</button></div>
      </form>
    </div>
  );
}

function WorkOrderFormFields({ form, setForm, related, includeRequired = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeRequired?: boolean }) {
  return (
    <div className="form-grid">
      {includeRequired ? <label>Project<SelectInline value={form.project_id ?? ""} options={["", ...related.projects.map((row) => String(row.id))]} labels={labelsFor(related.projects, "project_name")} onChange={(project_id) => setForm({ ...form, project_id })} /></label> : null}
      <label>Work Order Name<input value={form.work_order_name ?? ""} onChange={(event) => setForm({ ...form, work_order_name: event.target.value })} required={includeRequired} /></label>
      <label>Scope Summary<textarea value={form.scope_summary ?? ""} onChange={(event) => setForm({ ...form, scope_summary: event.target.value })} required={includeRequired} /></label>
      <label>Location Summary<textarea value={form.location_summary ?? ""} onChange={(event) => setForm({ ...form, location_summary: event.target.value })} required={includeRequired} /></label>
      <label>Work Type<input value={form.work_type ?? ""} onChange={(event) => setForm({ ...form, work_type: event.target.value })} required={includeRequired} /></label>
      <label>Territory ID<input value={form.territory_id ?? ""} onChange={(event) => setForm({ ...form, territory_id: event.target.value })} required={includeRequired} /></label>
      <label>Planned Quantity<input type="number" min="0" value={form.planned_quantity ?? ""} onChange={(event) => setForm({ ...form, planned_quantity: event.target.value })} required={includeRequired} /></label>
      <label>Unit<SelectInline value={form.unit ?? ""} options={["", ...units]} onChange={(unit) => setForm({ ...form, unit })} /></label>
      {includeRequired ? <><label>Coverage Plan<SelectInline value={form.coverage_plan_id ?? ""} options={["", ...related.coveragePlans.map((row) => String(row.id))]} labels={labelsFor(related.coveragePlans)} onChange={(coverage_plan_id) => setForm({ ...form, coverage_plan_id })} /></label><label>Assignment Type<SelectInline value={form.assignment_type ?? "unassigned"} options={assignmentTypes} onChange={(assignment_type) => setForm({ ...form, assignment_type })} /></label></> : null}
      <label>Coverage Requirement ID<input value={form.coverage_requirement_id ?? ""} onChange={(event) => setForm({ ...form, coverage_requirement_id: event.target.value })} /></label>
      <label>Coverage Source ID<input value={form.coverage_source_id ?? ""} onChange={(event) => setForm({ ...form, coverage_source_id: event.target.value })} /></label>
      <label>Planned Start<input type="date" value={form.planned_start_date ?? ""} onChange={(event) => setForm({ ...form, planned_start_date: event.target.value })} /></label>
      <label>Planned End<input type="date" value={form.planned_end_date ?? ""} onChange={(event) => setForm({ ...form, planned_end_date: event.target.value })} /></label>
      <label>Scheduled Start<input type="date" value={form.scheduled_start_date ?? ""} onChange={(event) => setForm({ ...form, scheduled_start_date: event.target.value })} /></label>
      <label>Scheduled End<input type="date" value={form.scheduled_end_date ?? ""} onChange={(event) => setForm({ ...form, scheduled_end_date: event.target.value })} /></label>
      <label>Work Order Number<input value={form.work_order_number ?? ""} onChange={(event) => setForm({ ...form, work_order_number: event.target.value })} /></label>
      <label>Customer Work Order Number<input value={form.customer_work_order_number ?? ""} onChange={(event) => setForm({ ...form, customer_work_order_number: event.target.value })} /></label>
      <label>Prime Work Order Number<input value={form.prime_work_order_number ?? ""} onChange={(event) => setForm({ ...form, prime_work_order_number: event.target.value })} /></label>
      <label>Internal Work Order Number<input value={form.internal_work_order_number ?? ""} onChange={(event) => setForm({ ...form, internal_work_order_number: event.target.value })} /></label>
      <label>Route Name<input value={form.route_name ?? ""} onChange={(event) => setForm({ ...form, route_name: event.target.value })} /></label>
      <label>Node ID<input value={form.node_id ?? ""} onChange={(event) => setForm({ ...form, node_id: event.target.value })} /></label>
      <label>Segment ID<input value={form.segment_id ?? ""} onChange={(event) => setForm({ ...form, segment_id: event.target.value })} /></label>
      <label>Address Range<input value={form.address_range ?? ""} onChange={(event) => setForm({ ...form, address_range: event.target.value })} /></label>
      <label>Permit Reference<input value={form.permit_reference ?? ""} onChange={(event) => setForm({ ...form, permit_reference: event.target.value })} /></label>
      <label>Map Link<input value={form.map_link ?? ""} onChange={(event) => setForm({ ...form, map_link: event.target.value })} /></label>
      <label>Owner User ID<input value={form.owner_user_id ?? ""} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} /></label>
      <label>Field Supervisor User ID<input value={form.field_supervisor_user_id ?? ""} onChange={(event) => setForm({ ...form, field_supervisor_user_id: event.target.value })} /></label>
      <label>QC Owner User ID<input value={form.qc_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, qc_owner_user_id: event.target.value })} /></label>
      <label>Documentation Requirements JSON<textarea value={form.documentation_requirements ?? ""} onChange={(event) => setForm({ ...form, documentation_requirements: event.target.value })} /></label>
      <label>Production Requirements JSON<textarea value={form.production_requirements ?? ""} onChange={(event) => setForm({ ...form, production_requirements: event.target.value })} /></label>
      <label>Customer Validation Requirements JSON<textarea value={form.customer_validation_requirements ?? ""} onChange={(event) => setForm({ ...form, customer_validation_requirements: event.target.value })} /></label>
      <label>Billing Package Requirements JSON<textarea value={form.billing_package_requirements ?? ""} onChange={(event) => setForm({ ...form, billing_package_requirements: event.target.value })} /></label>
      <label>Risk Notes<textarea value={form.risk_notes ?? ""} onChange={(event) => setForm({ ...form, risk_notes: event.target.value })} /></label>
    </div>
  );
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test work order actions.</p></div><button type="button" onClick={session.applyDefaults}>Use work order defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
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

function buildWorkOrderPayload(form: Record<string, string>, includeCreateFields: boolean) {
  return prune({
    ...(includeCreateFields ? { project_id: form.project_id, assignment_type: form.assignment_type } : {}),
    work_order_name: form.work_order_name,
    work_order_number: form.work_order_number,
    customer_work_order_number: form.customer_work_order_number,
    prime_work_order_number: form.prime_work_order_number,
    internal_work_order_number: form.internal_work_order_number,
    scope_summary: form.scope_summary,
    location_summary: form.location_summary,
    route_name: form.route_name,
    node_id: form.node_id,
    segment_id: form.segment_id,
    address_range: form.address_range,
    permit_reference: form.permit_reference,
    map_link: form.map_link,
    work_type: form.work_type,
    territory_id: form.territory_id,
    planned_quantity: form.planned_quantity,
    unit: form.unit,
    coverage_plan_id: form.coverage_plan_id,
    coverage_requirement_id: form.coverage_requirement_id,
    coverage_source_id: form.coverage_source_id,
    planned_start_date: form.planned_start_date,
    planned_end_date: form.planned_end_date,
    scheduled_start_date: form.scheduled_start_date,
    scheduled_end_date: form.scheduled_end_date,
    owner_user_id: form.owner_user_id,
    field_supervisor_user_id: form.field_supervisor_user_id,
    qc_owner_user_id: form.qc_owner_user_id,
    documentation_requirements: parseJsonField(form.documentation_requirements, "documentation_requirements"),
    production_requirements: parseJsonField(form.production_requirements, "production_requirements"),
    customer_validation_requirements: parseJsonField(form.customer_validation_requirements, "customer_validation_requirements"),
    billing_package_requirements: parseJsonField(form.billing_package_requirements, "billing_package_requirements"),
    risk_notes: form.risk_notes,
  });
}

async function loadRelated(token: string): Promise<RelatedData> {
  const [projects, coveragePlans, capacityProviders, crews, equipment, organizations] = await Promise.all([
    optionalList("/projects?archived=false", token),
    optionalList("/coverage-plans?archived=false", token),
    optionalList("/capacity-providers", token),
    optionalList("/crews", token),
    optionalList("/equipment", token),
    optionalList("/organizations", token),
  ]);
  return { projects, coveragePlans, capacityProviders, crews, equipment, organizations };
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="workspace-panel"><h2>{title}</h2>{children}</section>;
}

function SummaryCard({ label, value, helper, active, onClick }: { label: string; value: number; helper?: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={`summary-card ${active ? "active-summary-card" : ""}`} aria-pressed={active} onClick={onClick}><span>{label}</span><strong>{value}</strong>{helper ? <small>{helper}</small> : null}</button>;
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

function buildSummary(rows: SyncRecord[]) {
  const status = Object.fromEntries(workOrderStatuses.map((item) => [item, 0]));
  for (const row of rows) status[String(row.status)] = (status[String(row.status)] ?? 0) + 1;
  return {
    total: rows.length,
    status,
    readyToStart: rows.filter((row) => ["assigned", "scheduled"].includes(String(row.status)) || row.readiness_status === "ready_to_start").length,
    active: rows.filter((row) => ["in_progress", "submitted", "qc_review"].includes(String(row.status))).length,
    productionEligible: rows.filter((row) => row.production_eligible).length,
    blocked: rows.filter((row) => arrayValue(row.blockers).length || row.readiness_status === "blocked").length,
    productionMissing: rows.filter((row) => Boolean(row.production_eligible) && numberValue(row.completed_quantity) === 0 && !["draft", "cancelled", "archived", "closed"].includes(String(row.status))).length,
    readyForQc: rows.filter((row) => ["submitted", "qc_review"].includes(String(row.status)) || row.qc_status === "pending_review").length,
    completed: rows.filter((row) => ["approved", "billable", "closed"].includes(String(row.status))).length,
    readyWithRisk: rows.filter((row) => row.readiness_band === "ready_with_risk").length,
  };
}

function matchesFilters(row: SyncRecord, filters: Record<string, string>) {
  const haystack = [row.work_order_name, row.title, row.work_order_number, row.customer_work_order_number, row.prime_work_order_number, row.project_name, row.customer_organization_name, row.territory_name, row.work_type, row.scope_summary, row.location_summary, row.assigned_capacity_provider_name, row.assigned_crew_name].map((value) => String(value ?? "").toLowerCase()).join(" ");
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.project_id && !String(row.project_id ?? "").includes(filters.project_id)) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.readiness_status && row.readiness_status !== filters.readiness_status) return false;
  if (filters.readiness_band && row.readiness_band !== filters.readiness_band) return false;
  if (filters.qc_status && row.qc_status !== filters.qc_status) return false;
  if (filters.billable_status && row.billable_status !== filters.billable_status) return false;
  if (filters.territory_id && !String(row.territory_name ?? row.territory_id ?? "").toLowerCase().includes(filters.territory_id.toLowerCase())) return false;
  if (filters.work_type && !String(row.work_type ?? "").toLowerCase().includes(filters.work_type.toLowerCase())) return false;
  if (filters.assignment_type && row.assignment_type !== filters.assignment_type) return false;
  if (filters.assigned_capacity_provider_id && !String(row.assigned_capacity_provider_name ?? row.assigned_capacity_provider_id ?? "").toLowerCase().includes(filters.assigned_capacity_provider_id.toLowerCase())) return false;
  if (filters.assigned_crew_id && !String(row.assigned_crew_name ?? row.assigned_crew_id ?? "").toLowerCase().includes(filters.assigned_crew_id.toLowerCase())) return false;
  if (filters.production_eligible && boolMatch(Boolean(row.production_eligible), filters.production_eligible)) return false;
  if (filters.hasBlockers && boolMatch(arrayValue(row.blockers).length > 0 || row.readiness_status === "blocked", filters.hasBlockers)) return false;
  if (filters.hasWarnings && boolMatch(arrayValue(row.warnings).length > 0, filters.hasWarnings)) return false;
  if (filters.missingAssignment === "true" && (row.assigned_capacity_provider_id || row.assigned_crew_id || row.assigned_organization_id || row.assigned_equipment_id)) return false;
  if (filters.productionMissing === "true" && (!row.production_eligible || numberValue(row.completed_quantity) > 0 || ["draft", "cancelled", "archived", "closed"].includes(String(row.status)))) return false;
  if (filters.completedWork === "true" && !["approved", "billable", "closed"].includes(String(row.status))) return false;
  if (filters.planned_start_from && dateTime(row.planned_start_date) < dateTime(filters.planned_start_from)) return false;
  if (filters.planned_start_to && dateTime(row.planned_start_date) > dateTime(filters.planned_start_to)) return false;
  if (filters.scheduled_start_from && dateTime(row.scheduled_start_date) < dateTime(filters.scheduled_start_from)) return false;
  if (filters.scheduled_start_to && dateTime(row.scheduled_start_date) > dateTime(filters.scheduled_start_to)) return false;
  return true;
}

function queueTitle(queue: string) {
  if (queue === "ready_to_start") return "Ready to Start";
  if (queue === "active") return "Active Work";
  if (queue === "blocked") return "Blocked Work Orders";
  if (queue === "production_missing") return "Production Missing";
  if (queue === "ready_for_qc") return "Ready for QC";
  if (queue === "completed") return "Completed Work";
  if (queue === "archived") return "Archived Work Orders";
  return "Work Orders";
}

function emptyWorkOrderQueue(queue: string) {
  if (queue === "ready_to_start") return "No work orders are ready to start.";
  if (queue === "blocked") return "No blocked work orders.";
  if (queue === "production_missing") return "All active work currently has production activity or no production is required yet.";
  if (queue === "ready_for_qc") return "No work orders are waiting for QC movement.";
  if (queue === "completed") return "No completed work orders are in this queue.";
  return "No work orders match this queue.";
}

function nextWorkOrderAction(row: SyncRecord) {
  if (arrayValue(row.blockers).length || row.readiness_status === "blocked") return "Resolve blocker";
  if (row.status === "draft") return "Mark ready to assign";
  if (row.status === "ready_to_assign") return "Assign crew";
  if (row.status === "assigned" || row.status === "scheduled") return "Start work";
  if (row.status === "in_progress") return "Submit field work";
  if (row.status === "submitted") return "Start QC review";
  if (row.status === "qc_review") return "Approve or request corrections";
  if (row.status === "approved") return "Mark billable";
  if (row.status === "billable") return "Ready for billing workflow";
  return formatAction(row.recommended_next_action);
}

function productionState(row: SyncRecord) {
  if (row.production_eligible && numberValue(row.completed_quantity) === 0) return "Production missing";
  if (numberValue(row.completed_quantity) > 0) return `${numberValue(row.completed_quantity)} ${formatAction(row.unit)} completed`;
  return row.production_eligible ? "Eligible" : "Not ready";
}

function blockerText(row: SyncRecord) {
  const blockers = arrayValue(row.blockers);
  if (blockers.length) return formatAction(blockers[0]?.blocker_type ?? blockers[0]?.message ?? "Blocked");
  if (row.readiness_status === "blocked") return "Readiness blocked";
  return "No blocker";
}

function statusTone(status: unknown) {
  if (["approved", "billable", "closed"].includes(String(status))) return "status-badge-success";
  if (["on_hold", "corrections_required", "cancelled"].includes(String(status))) return "status-badge-danger";
  if (["submitted", "qc_review", "in_progress"].includes(String(status))) return "status-badge-warning";
  return "status-badge-neutral";
}

function ageText(value: unknown) {
  const then = dateTime(value);
  if (then === Number.MAX_SAFE_INTEGER) return "Age unavailable";
  const days = Math.max(0, Math.floor((Date.now() - then) / 86400000));
  return days === 0 ? "Updated today" : `${days}d since update`;
}

function sortWorkOrders(rows: SyncRecord[], sort = "default") {
  return [...rows].sort((a, b) => {
    if (sort === "readiness_desc") return numberValue(b.readiness_score, -1) - numberValue(a.readiness_score, -1);
    if (sort === "planned_start_asc") return dateTime(a.planned_start_date) - dateTime(b.planned_start_date);
    if (sort === "scheduled_start_asc") return dateTime(a.scheduled_start_date) - dateTime(b.scheduled_start_date);
    if (sort === "status") return String(a.status).localeCompare(String(b.status));
    if (sort === "project") return String(a.project_name ?? "").localeCompare(String(b.project_name ?? ""));
    if (sort === "assigned_provider") return String(a.assigned_capacity_provider_name ?? "").localeCompare(String(b.assigned_capacity_provider_name ?? ""));
    if (sort === "updated_desc") return dateTime(b.updated_at) - dateTime(a.updated_at);
    const blockers = arrayValue(b.blockers).length - arrayValue(a.blockers).length;
    if (blockers) return blockers;
    const readiness = numberValue(a.readiness_score, 999) - numberValue(b.readiness_score, 999);
    if (readiness) return readiness;
    const scheduled = dateTime(a.scheduled_start_date) - dateTime(b.scheduled_start_date);
    if (scheduled) return scheduled;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function readinessChecklist(workOrder: SyncRecord, detail: WorkOrderDetailShape): [string, boolean][] {
  const projectStatus = String(workOrder.project_status ?? detail.project_context?.status ?? "");
  return [
    ["Project valid", Boolean(workOrder.project_id)],
    ["Project ready/active", ["ready_for_work", "active"].includes(projectStatus)],
    ["Scope present", Boolean(workOrder.scope_summary)],
    ["Location present", Boolean(workOrder.location_summary)],
    ["Quantity/unit present", numberValue(workOrder.planned_quantity, -1) >= 0 && Boolean(workOrder.unit)],
    ["Assignment target present", Boolean(workOrder.assigned_capacity_provider_id || workOrder.assigned_crew_id || workOrder.assigned_organization_id || workOrder.assigned_equipment_id)],
    ["Schedule present", Boolean(workOrder.scheduled_start_date || workOrder.planned_start_date)],
    ["Coverage source reviewed", Boolean(workOrder.coverage_source_id || !arrayValue(detail.warnings).some((row) => String(row.warning_type).includes("coverage_source")))],
    ["No hard blockers", !arrayValue(detail.blockers).length],
    ["Production eligible", Boolean(workOrder.production_eligible)],
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

function arrayValue(value: unknown): SyncRecord[] {
  return Array.isArray(value) ? value as SyncRecord[] : [];
}

function boolMatch(actual: boolean, expected: string) {
  return (expected === "true" && !actual) || (expected === "false" && actual);
}

function closedStatus(workOrder: SyncRecord) {
  return ["archived", "cancelled", "closed"].includes(String(workOrder.status));
}

function scoreValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet.";
  return `${numberValue(value)}%`;
}

function quantity(value: unknown, unit: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet.";
  return `${numberValue(value)} ${formatAction(unit)}`;
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

function labelsFor(rows: SyncRecord[], preferred = "name") {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.project_name ?? row.work_order_name, String(row.id))]));
}

function overrideReasons(form: Record<string, string>) {
  return prune({
    readiness_override_reason: form.readiness_override_reason,
    assignment_override_reason: form.assignment_override_reason,
    coverage_override_reason: form.coverage_override_reason,
    schedule_override_reason: form.schedule_override_reason,
  });
}

function projectLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/projects/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function coverageLink(id: unknown) {
  return id ? <Link className="table-link" href={`/opportunities/coverage/${id}`}>{String(id)}</Link> : "Not linked";
}

function providerLink(id: unknown, label: unknown) {
  return id ? textValue(label, String(id)) : "Not assigned";
}

function actionNotice(type: string) {
  if (["start", "submit"].includes(type)) return "Work Order action completed. No production record was created.";
  if (type === "qc_review") return "QC review started. No QC evidence was created.";
  if (type === "billable") return "Work Order marked billable. No settlement, invoice, payment, AR, cash, or payroll record was created.";
  return "Work Order action completed.";
}

function plainError(message: string) {
  if (!message) return "Work order action failed.";
  if (message.includes("Unauthorized")) return "You do not have permission to perform this action.";
  if (message.includes("Forbidden")) return "You do not have permission to perform this action.";
  if (message.includes("not found")) return "Work order not found or you do not have access.";
  return message;
}

const emptyRelated: RelatedData = { projects: [], coveragePlans: [], capacityProviders: [], crews: [], equipment: [], organizations: [] };
