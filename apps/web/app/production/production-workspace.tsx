"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, type ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const productionTypes = ["daily_production", "progress_update", "completion_submission", "correction_submission", "inspection_submission", "restoration_submission", "delay_report", "no_work_report", "safety_observation", "material_issue", "access_issue", "weather_delay", "customer_issue", "other"];
const productionStatuses = ["draft", "submitted", "under_review", "correction_required", "corrected", "approved", "rejected", "voided", "archived", "billable"];
const qcStatuses = ["not_started", "pending_review", "corrections_required", "approved", "rejected"];
const billableStatuses = ["not_billable", "billable_candidate", "billable", "blocked"];
const units = ["feet", "miles", "drops", "addresses", "passings", "splice_cases", "nodes", "poles", "permits", "inspections", "restoration_items", "days", "crews", "workers", "equipment_units", "each"];
const evidenceTypes = ["photo", "document", "form", "test_result", "gps_point", "map_markup", "customer_signature", "inspector_signature", "material_ticket", "permit_document", "restoration_photo", "before_photo", "after_photo", "other"];
const archiveReasons = ["duplicate", "no_longer_relevant", "replaced", "created_in_error", "project_cancelled", "other"];
const issueTypes = new Set(["delay_report", "no_work_report", "safety_observation", "material_issue", "access_issue", "weather_delay", "customer_issue", "other"]);
const tabs = ["overview", "work_order", "project", "performer", "quantity", "evidence", "location_time", "qc", "corrections", "billable", "timeline", "audit", "future_qc", "future_billable"];

type ProductionDetailShape = {
  production_record?: SyncRecord;
  project_context?: SyncRecord | null;
  work_order_context?: SyncRecord | null;
  performer_context?: SyncRecord;
  evidence?: SyncRecord[];
  correction_context?: SyncRecord;
  quantity_summary?: SyncRecord;
  qc_summary?: SyncRecord;
  billable_summary?: SyncRecord;
  warnings?: SyncRecord[];
  blockers?: SyncRecord[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  workOrders: SyncRecord[];
  capacityProviders: SyncRecord[];
  crews: SyncRecord[];
  equipment: SyncRecord[];
  organizations: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function ProductionDirectory() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "production_date_desc" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("archived", filters.archived === "true" ? "true" : "false");
      const backendFilters = ["project_id", "work_order_id", "production_type", "status", "qc_status", "billable_status", "production_date_from", "production_date_to", "capacity_provider_id", "crew_id", "foreman_user_id", "submitted_by", "territory_id", "work_type", "q"];
      for (const key of backendFilters) if (filters[key]) query.set(key, filters[key]);
      if (filters.sort) query.set("sort", filters.sort);
      setRows(await syncosFetch<SyncRecord[]>(`/production-records?${query.toString()}`, { token: session.token }));
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session.token) void load();
    else setLoading(false);
  }, [session.token, filters.archived]);

  const visible = useMemo(() => sortProduction(rows.filter((row) => matchesFilters(row, filters)), filters.sort), [rows, filters]);
  const summary = useMemo(() => buildSummary(rows), [rows]);

  return (
    <ProductionShell title="Production Directory" purpose="Manage field-truth production records without creating settlement, invoice, AR, payment, cash, payroll, or tax records.">
      <SessionPanel session={session} />
      <div className="warning-box">Production Workspace uses hardened backend routes only. QC Workspace, Billable Workspace, settlement, invoice, AR, payment, cash, payroll, and tax workflows are not created here.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Production.</div> : null}
      {loading ? <div className="empty-state">Loading production records...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Production Summary</h2>
                <p className="muted">Production records are prioritized by corrections, review state, production date, and recent updates.</p>
              </div>
              <Link className="primary-button" href="/production/new" aria-disabled={!hasAnyPermission(session.permissions, ["production_record.create", "production.create"])}>Create Production</Link>
            </div>
            <div className="summary-grid">
              <SummaryCard label="Total Production Records" value={summary.total} onClick={() => setFilters({ archived: "false", sort: "production_date_desc" })} />
              {["draft", "submitted", "under_review", "correction_required", "corrected", "approved", "rejected", "voided", "archived"].map((status) => <SummaryCard key={status} label={formatAction(status)} value={summary.status[status] ?? 0} onClick={() => setFilters({ archived: status === "archived" ? "true" : "false", sort: "production_date_desc", status })} />)}
              <SummaryCard label="Billable Candidate" value={summary.billableCandidate} onClick={() => setFilters({ ...filters, billable_status: "billable_candidate" })} />
              <SummaryCard label="Billable" value={summary.billable} onClick={() => setFilters({ ...filters, billable_status: "billable" })} />
              <SummaryCard label="Evidence Missing" value={summary.evidenceMissing} onClick={() => setFilters({ ...filters, hasEvidence: "false" })} />
              <SummaryCard label="Corrections Open" value={summary.correctionsOpen} onClick={() => setFilters({ ...filters, correctionRequired: "true" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "production_date_desc" })}>Reset</button>
            </div>
            <div className="tab-row">
              {["submitted", "under_review", "correction_required", "corrected", "approved", "rejected"].map((status) => <button key={status} type="button" onClick={() => setFilters({ ...filters, status })}>{formatAction(status)}</button>)}
              <button type="button" onClick={() => setFilters({ ...filters, billable_status: "billable_candidate" })}>Billable Candidate</button>
              <button type="button" onClick={() => setFilters({ ...filters, hasEvidence: "false" })}>Evidence Missing</button>
              <button type="button" onClick={() => setFilters({ ...filters, production_type: "delay_report" })}>Delay / No Work Reports</button>
              <button type="button" onClick={() => setFilters({ ...filters, production_type: "safety_observation" })}>Safety Observations</button>
              <button type="button" onClick={() => setFilters({ ...filters, issueOnly: "true" })}>Issues</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search production, work order, project, location" />
              <input value={filters.project_id ?? ""} onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} placeholder="Project id" />
              <input value={filters.work_order_id ?? ""} onChange={(event) => setFilters({ ...filters, work_order_id: event.target.value })} placeholder="Work Order id" />
              <Select label="Production type" value={filters.production_type ?? ""} options={["", ...productionTypes]} onChange={(production_type) => setFilters({ ...filters, production_type })} />
              <Select label="Status" value={filters.status ?? ""} options={["", ...productionStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
              <Select label="QC status" value={filters.qc_status ?? ""} options={["", ...qcStatuses]} onChange={(qc_status) => setFilters({ ...filters, qc_status })} />
              <Select label="Billable status" value={filters.billable_status ?? ""} options={["", ...billableStatuses]} onChange={(billable_status) => setFilters({ ...filters, billable_status })} />
              <input value={filters.production_date_from ?? ""} onChange={(event) => setFilters({ ...filters, production_date_from: event.target.value })} type="date" aria-label="Production date from" />
              <input value={filters.production_date_to ?? ""} onChange={(event) => setFilters({ ...filters, production_date_to: event.target.value })} type="date" aria-label="Production date to" />
              <input value={filters.capacity_provider_id ?? ""} onChange={(event) => setFilters({ ...filters, capacity_provider_id: event.target.value })} placeholder="Capacity provider id/name" />
              <input value={filters.crew_id ?? ""} onChange={(event) => setFilters({ ...filters, crew_id: event.target.value })} placeholder="Crew id/name" />
              <input value={filters.foreman_user_id ?? ""} onChange={(event) => setFilters({ ...filters, foreman_user_id: event.target.value })} placeholder="Foreman id/name" />
              <input value={filters.submitted_by ?? ""} onChange={(event) => setFilters({ ...filters, submitted_by: event.target.value })} placeholder="Submitted by" />
              <input value={filters.territory_id ?? ""} onChange={(event) => setFilters({ ...filters, territory_id: event.target.value })} placeholder="Territory" />
              <input value={filters.work_type ?? ""} onChange={(event) => setFilters({ ...filters, work_type: event.target.value })} placeholder="Work type" />
              <Select label="Has evidence" value={filters.hasEvidence ?? ""} options={["", "true", "false"]} onChange={(hasEvidence) => setFilters({ ...filters, hasEvidence })} />
              <Select label="Correction required" value={filters.correctionRequired ?? ""} options={["", "true", "false"]} onChange={(correctionRequired) => setFilters({ ...filters, correctionRequired })} />
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "production_date_desc"} options={["production_date_desc", "production_date_asc", "updated_desc", "status", "project", "work_order", "provider", "crew"]} labels={{ production_date_desc: "Production date newest", production_date_asc: "Production date oldest", updated_desc: "Recently updated", status: "Status", project: "Project", work_order: "Work Order", provider: "Provider", crew: "Crew" }} onChange={(sort) => setFilters({ ...filters, sort })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Production Records</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No production records yet. Create production against an eligible Work Order through backend validation.</div> : <ProductionTable rows={visible} />}
          </section>
        </>
      ) : null}
    </ProductionShell>
  );
}

export function ProductionCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ production_type: "daily_production", status: "submitted", unit: "feet" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session.token) return;
    void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/production-records", { method: "POST", body: buildProductionPayload(form, true), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const record = after?.production_record as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? record?.id ?? after?.id ?? "");
      router.push(id ? `/production/${id}` : "/production");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <ProductionShell title="Create Production" purpose="Create field-truth production against a Work Order. No finance records are created.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">The backend enforces Work Order eligibility, Project status, performer context, quantity rules, evidence requirements, tenant boundaries, and write-action audit behavior.</div>
        <ProductionFormFields form={form} setForm={setForm} related={related} includeRequired />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasAnyPermission(session.permissions, ["production_record.create", "production.create"])}>Create Production</button>
          <Link className="link-button" href="/production">Cancel</Link>
        </div>
      </form>
    </ProductionShell>
  );
}

export function ProductionEdit({ productionId }: { productionId: string }) {
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
          syncosFetch<ProductionDetailShape>(`/production-records/${productionId}/detail`, { token: session.token }),
          loadRelated(session.token),
        ]);
        const record = productionRecord(detail);
        setRelated(nextRelated);
        setForm({
          production_type: String(record.production_type ?? ""),
          production_date: dateInput(record.production_date),
          claimed_quantity: String(record.claimed_quantity ?? ""),
          unit: String(record.unit ?? ""),
          location_summary: String(record.location_summary ?? ""),
          description: String(record.description ?? ""),
          production_notes: String(record.production_notes ?? ""),
          delay_reason: String(record.delay_reason ?? ""),
          no_work_reason: String(record.no_work_reason ?? ""),
          safety_observation_note: String(record.safety_observation_note ?? ""),
          material_issue_note: String(record.material_issue_note ?? ""),
          access_issue_note: String(record.access_issue_note ?? ""),
          weather_delay_note: String(record.weather_delay_note ?? ""),
          customer_issue_note: String(record.customer_issue_note ?? ""),
          capacity_provider_id: String(record.capacity_provider_id ?? ""),
          crew_id: String(record.crew_id ?? ""),
          assigned_organization_id: String(record.assigned_organization_id ?? ""),
          foreman_user_id: String(record.foreman_user_id ?? ""),
          worker_count: String(record.worker_count ?? ""),
          equipment_used: jsonText(record.equipment_used),
          subcontractor_reference: String(record.subcontractor_reference ?? ""),
          started_at: dateTimeInput(record.started_at),
          ended_at: dateTimeInput(record.ended_at),
          route_name: String(record.route_name ?? ""),
          node_id: String(record.node_id ?? ""),
          segment_id: String(record.segment_id ?? ""),
          address_range: String(record.address_range ?? ""),
          latitude: String(record.latitude ?? ""),
          longitude: String(record.longitude ?? ""),
          correction_reason: String(record.correction_reason ?? ""),
          correction_note: String(record.correction_note ?? ""),
          corrected_quantity: String(record.corrected_quantity ?? ""),
          correction_due_date: dateInput(record.correction_due_date),
          correction_owner_user_id: String(record.correction_owner_user_id ?? ""),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [session.token, productionId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/production-records/${productionId}`, { method: "PATCH", body: buildProductionPayload(form, false), token: session.token });
      router.push(`/production/${productionId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <ProductionShell title="Edit Production" purpose="Edit allowed field-truth fields without bypassing lifecycle action routes.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Loading production record...</div> : null}
      {!loading ? (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Approved, rejected, voided, billable, and archived records are backend read-only. Status changes use lifecycle routes.</div>
          <ProductionFormFields form={form} setForm={setForm} related={related} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!hasAnyPermission(session.permissions, ["production_record.update", "production.update"])}>Save Production</button>
            <Link className="link-button" href={`/production/${productionId}`}>Cancel</Link>
          </div>
        </form>
      ) : null}
    </ProductionShell>
  );
}

export function ProductionDetail({ productionId }: { productionId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<ProductionDetailShape | null>(null);
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
        syncosFetch<ProductionDetailShape>(`/production-records/${productionId}/detail`, { token: session.token }),
        optionalList(`/production-records/${productionId}/timeline`, session.token),
        optionalList(`/production-records/${productionId}/audit-summary`, session.token),
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
  }, [session.token, productionId]);

  const record = detail ? productionRecord(detail) : null;
  const warnings = detail?.warnings ?? arrayValue(record?.warnings);
  const blockers = detail?.blockers ?? arrayValue(record?.blockers);
  const evidence = detail?.evidence ?? [];

  return (
    <ProductionShell title="Production Detail" purpose="Review field truth, performer context, evidence metadata, QC state, billable state, timeline, and audit.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Production Detail.</div> : null}
      {!record && session.token && !error ? <div className="empty-state">Production record not found or you do not have access.</div> : null}
      {record && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{formatAction(record.production_type)}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(record.status)}</span>
                  <span className="badge">{formatAction(record.qc_status)}</span>
                  <span className="badge">{formatAction(record.billable_status)}</span>
                  <span className="badge">{formatAction(record.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/production/${productionId}/edit`} aria-disabled={!hasAnyPermission(session.permissions, ["production_record.update", "production.update"])}>Edit Production</Link>
                <ActionButton permissions={["production_record.submit", "production.submit"]} session={session} disabled={String(record.status) !== "draft" && String(record.status) !== "corrected"} onClick={() => setModal("submit")}>Submit</ActionButton>
                <ActionButton permissions={["production.review", "qc.review"]} session={session} disabled={!["submitted", "corrected"].includes(String(record.status))} onClick={() => setModal("start_review")}>Start Review</ActionButton>
                <ActionButton permissions={["qc.approve", "production.approve"]} session={session} disabled={!["submitted", "under_review", "corrected"].includes(String(record.status))} onClick={() => setModal("approve")}>Approve</ActionButton>
                <ActionButton permissions={["qc.reject", "production.reject"]} session={session} disabled={!["submitted", "under_review", "corrected"].includes(String(record.status))} onClick={() => setModal("reject")}>Reject</ActionButton>
                <ActionButton permissions={["production.request_correction", "production_record.correction_required"]} session={session} disabled={["voided", "archived"].includes(String(record.status))} onClick={() => setModal("correction")}>Request Correction</ActionButton>
                <ActionButton permissions={["production.mark_corrected"]} session={session} disabled={String(record.status) !== "correction_required"} onClick={() => setModal("corrected")}>Mark Corrected</ActionButton>
                <ActionButton permissions={["production.mark_billable"]} session={session} disabled={String(record.status) !== "approved"} onClick={() => setModal("billable")}>Mark Billable</ActionButton>
                <ActionButton permissions={["production.void"]} session={session} disabled={["voided", "archived"].includes(String(record.status))} onClick={() => setModal("void")}>Void</ActionButton>
                <ActionButton permissions={["production_record.archive", "production.archive"]} session={session} disabled={String(record.status) === "archived"} onClick={() => setModal("archive")}>Archive</ActionButton>
                <ActionButton permissions={["production_evidence.create"]} session={session} disabled={String(record.status) === "archived"} onClick={() => setModal("evidence")}>Add Evidence Metadata</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Claimed Quantity" value={quantity(record.claimed_quantity, record.unit)} />
              <Metric label="Approved Quantity" value={quantity(record.approved_quantity, record.unit)} />
              <Metric label="Rejected Quantity" value={quantity(record.rejected_quantity, record.unit)} />
              <Metric label="Corrected Quantity" value={quantity(record.corrected_quantity, record.unit)} />
              <Metric label="Billable Quantity" value={quantity(record.billable_quantity, record.unit)} />
              <Metric label="QC Status" value={formatAction(record.qc_status)} />
              <Metric label="Billable Status" value={formatAction(record.billable_status)} />
              <Metric label="Evidence Count" value={String(numberValue(record.evidence_count ?? evidence.length))} />
              <Metric label="Production Date" value={dateValue(record.production_date)} />
              <Metric label="Recommended Next Action" value={formatAction(record.recommended_next_action ?? detail.recommended_next_action)} />
            </div>
            <div className="warning-box">Claimed is not approved. Approved is not automatically billable. Billable is not settlement.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Project</dt><dd>{projectLink(record.project_id, record.project_name ?? detail.project_context?.project_name ?? detail.project_context?.name)}</dd>
                <dt>Work Order</dt><dd>{workOrderLink(record.work_order_id, record.work_order_name ?? detail.work_order_context?.work_order_name)}</dd>
                <dt>Work Order status</dt><dd>{formatAction(record.work_order_status ?? detail.work_order_context?.status)}</dd>
                <dt>Production eligibility</dt><dd>{record.production_eligible_context ? "Eligible" : "Not confirmed"}</dd>
                <dt>Customer</dt><dd>{organizationLink(record.customer_organization_id, record.customer_organization_name)}</dd>
                <dt>Territory</dt><dd>{textValue(record.territory_name ?? record.territory_id)}</dd>
                <dt>Work type</dt><dd>{formatAction(record.work_type)}</dd>
                <dt>Provider</dt><dd>{textValue(record.capacity_provider_name ?? record.capacity_provider_id)}</dd>
                <dt>Crew</dt><dd>{textValue(record.crew_name ?? record.crew_id)}</dd>
                <dt>Submitted by</dt><dd>{textValue(record.submitted_by_name ?? record.submitted_by)}</dd>
                <dt>Foreman</dt><dd>{textValue(record.foreman_name ?? record.foreman_user_id)}</dd>
                <dt>Evidence status</dt><dd>{numberValue(record.evidence_count ?? evidence.length) > 0 ? "Metadata attached" : "No evidence metadata"}</dd>
                <dt>Correction status</dt><dd>{formatAction(record.correction_required ? "correction_required" : record.status)}</dd>
                <dt>Billable status</dt><dd>{formatAction(record.billable_status)}</dd>
              </dl>
              <Checklist items={productionChecklist(record, detail)} />
              <WarningList title="Key Blockers" rows={blockers.slice(0, 4)} empty="No blockers returned." />
              <WarningList title="Key Warnings" rows={warnings.slice(0, 4)} empty="No warnings returned." />
              <div className="warning-box">Production can prepare downstream truth, but this workspace does not create finance records.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}
              </div>
              <ProductionTab tab={tab} detail={detail} record={record} session={session} onArchiveEvidence={(evidenceId) => setModal(`archive_evidence:${evidenceId}`)} />
            </section>
          </div>
          {modal ? <LifecycleModal type={modal} productionId={productionId} record={record} detail={detail} related={related} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </ProductionShell>
  );
}

function ProductionShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/production", "Production Directory", "active"],
    ["/production/new", "Create Production", "active"],
    ["#detail", "Detail", "placeholder"],
    ["#field-truth", "Field Truth", "placeholder"],
    ["#work-order", "Work Order Context", "placeholder"],
    ["#project", "Project Context", "placeholder"],
    ["#performer", "Performer Context", "placeholder"],
    ["#quantity", "Quantity Summary", "placeholder"],
    ["#evidence", "Evidence Metadata", "placeholder"],
    ["#qc", "QC Summary", "placeholder"],
    ["#billable", "Billable Summary", "placeholder"],
    ["#corrections", "Corrections", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-qc", "Future QC Workspace", "placeholder"],
    ["#future-billable", "Future Billable Workspace", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Production</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function ProductionTable({ rows }: { rows: SyncRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Production Type", "Status", "QC Status", "Billable Status", "Production Date", "Project", "Work Order", "Customer", "Territory", "Work Type", "Provider", "Crew", "Foreman", "Submitted By", "Claimed Quantity", "Approved Quantity", "Rejected Quantity", "Corrected Quantity", "Billable Quantity", "Unit", "Evidence Count", "Location Summary", "Recommended Next Action", "Updated Date"].map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td><Link className="table-link" href={`/production/${row.id}`}>{formatAction(row.production_type)}</Link></td>
              <td>{formatAction(row.status)}</td>
              <td>{formatAction(row.qc_status)}</td>
              <td>{formatAction(row.billable_status)}</td>
              <td>{dateValue(row.production_date)}</td>
              <td>{projectLink(row.project_id, row.project_name)}</td>
              <td>{workOrderLink(row.work_order_id, row.work_order_name ?? row.work_order_title)}</td>
              <td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td>
              <td>{textValue(row.territory_name ?? row.territory_id)}</td>
              <td>{formatAction(row.work_type)}</td>
              <td>{textValue(row.capacity_provider_name ?? row.capacity_provider_id)}</td>
              <td>{textValue(row.crew_name ?? row.crew_id)}</td>
              <td>{textValue(row.foreman_name ?? row.foreman_user_id)}</td>
              <td>{textValue(row.submitted_by_name ?? row.submitted_by)}</td>
              <td>{formatCell(row.claimed_quantity)}</td>
              <td>{formatCell(row.approved_quantity)}</td>
              <td>{formatCell(row.rejected_quantity)}</td>
              <td>{formatCell(row.corrected_quantity)}</td>
              <td>{formatCell(row.billable_quantity)}</td>
              <td>{formatAction(row.unit)}</td>
              <td>{formatCell(row.evidence_count)}</td>
              <td>{textValue(row.location_summary)}</td>
              <td>{formatAction(row.recommended_next_action)}</td>
              <td>{dateValue(row.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductionTab({ tab, detail, record, session, onArchiveEvidence }: { tab: string; detail: ProductionDetailShape; record: SyncRecord; session: Session; onArchiveEvidence: (evidenceId: string) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Production type</dt><dd>{formatAction(record.production_type)}</dd><dt>Status</dt><dd>{formatAction(record.status)}</dd><dt>QC status</dt><dd>{formatAction(record.qc_status)}</dd><dt>Billable status</dt><dd>{formatAction(record.billable_status)}</dd><dt>Production date</dt><dd>{dateValue(record.production_date)}</dd><dt>Description</dt><dd>{textValue(record.description)}</dd><dt>Production notes</dt><dd>{textValue(record.production_notes)}</dd><dt>Delay reason</dt><dd>{textValue(record.delay_reason)}</dd><dt>No-work reason</dt><dd>{textValue(record.no_work_reason)}</dd><dt>Safety observation</dt><dd>{textValue(record.safety_observation_note)}</dd><dt>Material issue</dt><dd>{textValue(record.material_issue_note)}</dd><dt>Access issue</dt><dd>{textValue(record.access_issue_note)}</dd><dt>Weather delay</dt><dd>{textValue(record.weather_delay_note)}</dd><dt>Customer issue</dt><dd>{textValue(record.customer_issue_note)}</dd><dt>Created</dt><dd>{dateValue(record.created_at)}</dd><dt>Updated</dt><dd>{dateValue(record.updated_at)}</dd></dl><div className="warning-box">This production record documents field truth. It does not create settlement, invoice, payment, payroll, AR, or cash records.</div></Panel>;
  if (tab === "work_order") return <ContextPanel title="Work Order Context" record={detail.work_order_context} href={record.work_order_id ? `/work-orders/${record.work_order_id}` : undefined} fields={["work_order_name", "status", "readiness_score", "production_eligible", "planned_quantity", "completed_quantity", "approved_quantity", "billable_quantity", "unit", "assignment_type", "assigned_capacity_provider_id", "assigned_crew_id"]} />;
  if (tab === "project") return <ContextPanel title="Project Context" record={detail.project_context} href={record.project_id ? `/projects/${record.project_id}` : undefined} fields={["project_name", "name", "status", "project_readiness_score", "customer_organization_id", "territory_id", "work_type", "project_manager_user_id", "field_supervisor_user_id"]} />;
  if (tab === "performer") return <Panel title="Performer Context"><dl className="detail-list"><dt>Capacity Provider</dt><dd>{textValue(record.capacity_provider_name ?? record.capacity_provider_id)}</dd><dt>Crew</dt><dd>{textValue(record.crew_name ?? record.crew_id)}</dd><dt>Assigned Organization</dt><dd>{textValue(record.assigned_organization_id)}</dd><dt>Foreman</dt><dd>{textValue(record.foreman_name ?? record.foreman_user_id)}</dd><dt>Submitted By</dt><dd>{textValue(record.submitted_by_name ?? record.submitted_by)}</dd><dt>Worker Count</dt><dd>{formatCell(record.worker_count)}</dd><dt>Equipment Used</dt><dd><JsonBlock value={record.equipment_used} /></dd><dt>Subcontractor Reference</dt><dd>{textValue(record.subcontractor_reference)}</dd></dl><WarningList title="Performer Warnings" rows={arrayValue(detail.warnings).filter((row) => /performer|provider|crew|foreman/i.test(JSON.stringify(row)))} empty="No performer warnings returned." /></Panel>;
  if (tab === "quantity") return <Panel title="Quantity Summary"><dl className="detail-list"><dt>Claimed quantity</dt><dd>{quantity(record.claimed_quantity, record.unit)}</dd><dt>Approved quantity</dt><dd>{quantity(record.approved_quantity, record.unit)}</dd><dt>Rejected quantity</dt><dd>{quantity(record.rejected_quantity, record.unit)}</dd><dt>Corrected quantity</dt><dd>{quantity(record.corrected_quantity, record.unit)}</dd><dt>Billable quantity</dt><dd>{quantity(record.billable_quantity, record.unit)}</dd><dt>Work Order planned</dt><dd>{quantity(detail.work_order_context?.planned_quantity, detail.work_order_context?.unit)}</dd><dt>Work Order completed</dt><dd>{quantity(detail.work_order_context?.completed_quantity, detail.work_order_context?.unit)}</dd><dt>Work Order approved</dt><dd>{quantity(detail.work_order_context?.approved_quantity, detail.work_order_context?.unit)}</dd><dt>Work Order billable</dt><dd>{quantity(detail.work_order_context?.billable_quantity, detail.work_order_context?.unit)}</dd></dl><div className="warning-box">Claimed quantity comes from field submission. Approved quantity comes from QC. Billable quantity comes from billable review. Settlement consumes billable items later.</div></Panel>;
  if (tab === "evidence") return <Panel title="Evidence Metadata"><EvidenceTable rows={detail.evidence ?? []} session={session} onArchive={onArchiveEvidence} />{!(detail.evidence ?? []).length ? <div className="empty-state">No evidence metadata has been attached yet.</div> : null}<div className="warning-box">Evidence is metadata-only in this workspace. Binary upload storage is not implemented here.</div></Panel>;
  if (tab === "location_time") return <Panel title="Location / Time"><dl className="detail-list"><dt>Production date</dt><dd>{dateValue(record.production_date)}</dd><dt>Started at</dt><dd>{dateValue(record.started_at)}</dd><dt>Ended at</dt><dd>{dateValue(record.ended_at)}</dd><dt>Submitted at</dt><dd>{dateValue(record.submitted_at)}</dd><dt>Reviewed at</dt><dd>{dateValue(record.reviewed_at)}</dd><dt>Approved at</dt><dd>{dateValue(record.approved_at)}</dd><dt>Rejected at</dt><dd>{dateValue(record.rejected_at)}</dd><dt>Location summary</dt><dd>{textValue(record.location_summary)}</dd><dt>Route name</dt><dd>{textValue(record.route_name)}</dd><dt>Node ID</dt><dd>{textValue(record.node_id)}</dd><dt>Segment ID</dt><dd>{textValue(record.segment_id)}</dd><dt>Address range</dt><dd>{textValue(record.address_range)}</dd><dt>Latitude</dt><dd>{formatCell(record.latitude)}</dd><dt>Longitude</dt><dd>{formatCell(record.longitude)}</dd></dl><div className="warning-box">GPS values are displayed only when captured by the backend. This UI does not fake GPS.</div></Panel>;
  if (tab === "qc") return <Panel title="QC Summary"><dl className="detail-list"><dt>QC status</dt><dd>{formatAction(record.qc_status)}</dd><dt>Reviewed at</dt><dd>{dateValue(record.reviewed_at)}</dd><dt>Approved at</dt><dd>{dateValue(record.approved_at)}</dd><dt>Rejected at</dt><dd>{dateValue(record.rejected_at)}</dd><dt>Approved quantity</dt><dd>{quantity(record.approved_quantity, record.unit)}</dd><dt>Rejected quantity</dt><dd>{quantity(record.rejected_quantity, record.unit)}</dd><dt>Rejection reason</dt><dd>{textValue(record.rejection_reason)}</dd><dt>Rejection note</dt><dd>{textValue(record.rejection_note)}</dd><dt>Correction reason</dt><dd>{textValue(record.correction_reason)}</dd><dt>Correction note</dt><dd>{textValue(record.correction_note)}</dd><dt>Correction due date</dt><dd>{dateValue(record.correction_due_date)}</dd><dt>Correction owner</dt><dd>{textValue(record.correction_owner_user_id)}</dd><dt>Source QC Review</dt><dd>{textValue(record.source_qc_review_id)}</dd></dl><div className="warning-box">Full QC Workspace is not available in this sprint. These actions use Production backend review routes.</div></Panel>;
  if (tab === "corrections") return <Panel title="Corrections"><dl className="detail-list"><dt>Parent Production Record</dt><dd>{productionLink(record.parent_production_record_id)}</dd><dt>Source QC Review</dt><dd>{textValue(record.source_qc_review_id)}</dd><dt>Correction reason</dt><dd>{textValue(record.correction_reason)}</dd><dt>Correction note</dt><dd>{textValue(record.correction_note)}</dd><dt>Corrected quantity</dt><dd>{quantity(record.corrected_quantity, record.unit)}</dd><dt>Correction due date</dt><dd>{dateValue(record.correction_due_date)}</dd><dt>Correction owner</dt><dd>{textValue(record.correction_owner_user_id)}</dd><dt>Correction status</dt><dd>{formatAction(record.status)}</dd></dl></Panel>;
  if (tab === "billable") return <Panel title="Billable Summary"><dl className="detail-list"><dt>Billable status</dt><dd>{formatAction(record.billable_status)}</dd><dt>Billable quantity</dt><dd>{quantity(record.billable_quantity, record.unit)}</dd><dt>Related billable item count</dt><dd>{formatCell(record.billable_item_count ?? detail.billable_summary?.billable_item_count)}</dd><dt>Billable candidate state</dt><dd>{formatAction(record.billable_status)}</dd></dl><div className="warning-box">Marking production billable does not create settlement, invoice, AR, payment, cash, payroll, or tax records.</div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor_name", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") {
    if (!hasAnyPermission(session.permissions, ["production.audit.read"])) return <Panel title="Audit"><div className="empty-state">You do not have permission to view production audit details.</div></Panel>;
    return <Panel title="Audit"><ObjectTable rows={detail._audit ?? []} columns={["actor_name", "action", "object_type", "object_id", "reason", "created_at", "correlation_id"]} /></Panel>;
  }
  if (tab === "future_qc") return <PlaceholderPanel title="Future QC Workspace" message="Full QC Workspace is not available in this sprint. Production review actions remain backend lifecycle actions here." columns={["QC review", "Reviewer", "Evidence findings", "Correction quantity", "Customer acceptance"]} />;
  if (tab === "future_billable") return <PlaceholderPanel title="Future Billable Workspace" message="Billable Workspace is not available in this sprint. Production billable status does not create finance records." columns={["Billable item", "Rate", "Billing package", "Ready for settlement", "Settlement"]} />;
  return null;
}

function LifecycleModal({ type, productionId, record, detail, related, session, onClose, onSaved }: { type: string; productionId: string; record: SyncRecord; detail: ProductionDetailShape; related: RelatedData; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const archiveEvidenceId = type.startsWith("archive_evidence:") ? type.split(":")[1] : "";
  const actionType = archiveEvidenceId ? "archive_evidence" : type;
  const [form, setForm] = useState<Record<string, string>>({ billable_quantity: String(record.approved_quantity ?? ""), approved_quantity: String(record.claimed_quantity ?? ""), evidence_type: "photo" });
  const [error, setError] = useState("");
  const title = formatAction(actionType);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (actionType === "submit") await syncosFetch(`/production-records/${productionId}/submit`, { method: "POST", body: prune({ submit_note: form.submit_note, override_reasons: overrideReasons(form) }), token: session.token });
      if (actionType === "start_review") await syncosFetch(`/production-records/${productionId}/start-review`, { method: "POST", body: prune({ review_note: form.review_note }), token: session.token });
      if (actionType === "approve") await syncosFetch(`/production-records/${productionId}/approve`, { method: "POST", body: prune({ approval_note: form.approval_note, approved_quantity: form.approved_quantity, billable_quantity: form.billable_quantity, approval_override_reason: form.approval_override_reason }), token: session.token });
      if (actionType === "reject") await syncosFetch(`/production-records/${productionId}/reject`, { method: "POST", body: prune({ rejection_reason: form.rejection_reason, rejected_quantity: form.rejected_quantity, rejection_note: form.rejection_note }), token: session.token });
      if (actionType === "correction") await syncosFetch(`/production-records/${productionId}/request-correction`, { method: "POST", body: prune({ correction_reason: form.correction_reason, correction_note: form.correction_note, correction_due_date: form.correction_due_date, correction_owner_user_id: form.correction_owner_user_id }), token: session.token });
      if (actionType === "corrected") await syncosFetch(`/production-records/${productionId}/mark-corrected`, { method: "POST", body: prune({ correction_note: form.correction_note, corrected_quantity: form.corrected_quantity }), token: session.token });
      if (actionType === "billable") await syncosFetch(`/production-records/${productionId}/mark-billable`, { method: "POST", body: prune({ billable_quantity: form.billable_quantity, billable_note: form.billable_note, override_reason: form.override_reason }), token: session.token });
      if (actionType === "void") await syncosFetch(`/production-records/${productionId}/void`, { method: "POST", body: prune({ void_reason: form.void_reason, void_note: form.void_note }), token: session.token });
      if (actionType === "archive") await syncosFetch(`/production-records/${productionId}/archive`, { method: "POST", body: prune({ archive_reason: form.archive_reason, archive_note: form.archive_note }), token: session.token });
      if (actionType === "evidence") await syncosFetch(`/production-records/${productionId}/evidence`, { method: "POST", body: buildEvidencePayload(form), token: session.token });
      if (actionType === "archive_evidence") await syncosFetch(`/production-evidence/${archiveEvidenceId}/archive`, { method: "POST", body: prune({ archive_reason: form.archive_reason, archive_note: form.archive_note }), token: session.token });
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
        {actionType === "submit" ? <><label>Submit note<textarea value={form.submit_note ?? ""} onChange={(event) => setForm({ ...form, submit_note: event.target.value })} /></label><label>Evidence override reason<textarea value={form.evidence_override_reason ?? ""} onChange={(event) => setForm({ ...form, evidence_override_reason: event.target.value })} /></label></> : null}
        {actionType === "start_review" ? <label>Review note<textarea value={form.review_note ?? ""} onChange={(event) => setForm({ ...form, review_note: event.target.value })} /></label> : null}
        {actionType === "approve" ? <><label>Approval note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><label>Approved quantity<input type="number" min="0" value={form.approved_quantity ?? ""} onChange={(event) => setForm({ ...form, approved_quantity: event.target.value })} required /></label><label>Billable quantity<input type="number" min="0" value={form.billable_quantity ?? ""} onChange={(event) => setForm({ ...form, billable_quantity: event.target.value })} /></label><label>Approval override reason<textarea value={form.approval_override_reason ?? ""} onChange={(event) => setForm({ ...form, approval_override_reason: event.target.value })} /></label></> : null}
        {actionType === "reject" ? <><label>Rejection reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejected quantity<input type="number" min="0" value={form.rejected_quantity ?? ""} onChange={(event) => setForm({ ...form, rejected_quantity: event.target.value })} /></label><label>Rejection note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {actionType === "correction" ? <><label>Correction reason<textarea value={form.correction_reason ?? ""} onChange={(event) => setForm({ ...form, correction_reason: event.target.value })} required /></label><label>Correction note<textarea value={form.correction_note ?? ""} onChange={(event) => setForm({ ...form, correction_note: event.target.value })} /></label><label>Correction due date<input type="date" value={form.correction_due_date ?? ""} onChange={(event) => setForm({ ...form, correction_due_date: event.target.value })} /></label><label>Correction owner<SelectInline value={form.correction_owner_user_id ?? ""} options={[""]} onChange={(correction_owner_user_id) => setForm({ ...form, correction_owner_user_id })} /></label></> : null}
        {actionType === "corrected" ? <><label>Correction note<textarea value={form.correction_note ?? ""} onChange={(event) => setForm({ ...form, correction_note: event.target.value })} required /></label><label>Corrected quantity<input type="number" min="0" value={form.corrected_quantity ?? ""} onChange={(event) => setForm({ ...form, corrected_quantity: event.target.value })} /></label></> : null}
        {actionType === "billable" ? <><label>Billable quantity<input type="number" min="0" value={form.billable_quantity ?? ""} onChange={(event) => setForm({ ...form, billable_quantity: event.target.value })} required /></label><label>Billable note<textarea value={form.billable_note ?? ""} onChange={(event) => setForm({ ...form, billable_note: event.target.value })} /></label><label>Override reason<textarea value={form.override_reason ?? ""} onChange={(event) => setForm({ ...form, override_reason: event.target.value })} /></label><div className="warning-box">This action creates no settlement, invoice, AR, payment, cash, payroll, or tax record.</div></> : null}
        {actionType === "void" ? <><label>Void reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {actionType === "archive" || actionType === "archive_evidence" ? <><label>Archive reason<SelectInline value={form.archive_reason ?? ""} options={["", ...archiveReasons]} onChange={(archive_reason) => setForm({ ...form, archive_reason })} /></label><label>Archive note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {actionType === "evidence" ? <EvidenceFormFields form={form} setForm={setForm} /> : null}
        {actionType !== "evidence" ? <div className="warning-box">Lifecycle action uses the backend route. The backend remains authoritative for validation, permissions, tenant boundaries, events, audit, and system actions.</div> : null}
        <div className="form-actions"><button className="primary-button" type="submit">{title}</button></div>
      </form>
    </div>
  );
}

function ProductionFormFields({ form, setForm, related, includeRequired = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeRequired?: boolean }) {
  const isIssue = issueTypes.has(form.production_type ?? "");
  return (
    <div className="form-grid">
      {includeRequired ? <><label>Work Order<SelectInline value={form.work_order_id ?? ""} options={["", ...related.workOrders.map((row) => String(row.id))]} labels={labelsFor(related.workOrders, "work_order_name")} onChange={(work_order_id) => setForm({ ...form, work_order_id })} /></label><label>Status<SelectInline value={form.status ?? "submitted"} options={["draft", "submitted"]} onChange={(status) => setForm({ ...form, status })} /></label></> : null}
      <label>Production Type<SelectInline value={form.production_type ?? ""} options={["", ...productionTypes]} onChange={(production_type) => setForm({ ...form, production_type })} /></label>
      <label>Production Date<input type="date" value={form.production_date ?? ""} onChange={(event) => setForm({ ...form, production_date: event.target.value })} required={includeRequired} /></label>
      <label>Claimed Quantity<input type="number" min="0" value={form.claimed_quantity ?? ""} onChange={(event) => setForm({ ...form, claimed_quantity: event.target.value })} required={includeRequired && !isIssue} /></label>
      <label>Unit<SelectInline value={form.unit ?? ""} options={["", ...units]} onChange={(unit) => setForm({ ...form, unit })} /></label>
      <label>Location Summary<textarea value={form.location_summary ?? ""} onChange={(event) => setForm({ ...form, location_summary: event.target.value })} required={includeRequired} /></label>
      <label>Description<textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} required={includeRequired && isIssue} /></label>
      <label>Production Notes<textarea value={form.production_notes ?? ""} onChange={(event) => setForm({ ...form, production_notes: event.target.value })} /></label>
      <label>Capacity Provider<SelectInline value={form.capacity_provider_id ?? ""} options={["", ...related.capacityProviders.map((row) => String(row.id))]} labels={labelsFor(related.capacityProviders)} onChange={(capacity_provider_id) => setForm({ ...form, capacity_provider_id })} /></label>
      <label>Crew<SelectInline value={form.crew_id ?? ""} options={["", ...related.crews.map((row) => String(row.id))]} labels={labelsFor(related.crews)} onChange={(crew_id) => setForm({ ...form, crew_id })} /></label>
      <label>Assigned Organization<SelectInline value={form.assigned_organization_id ?? ""} options={["", ...related.organizations.map((row) => String(row.id))]} labels={labelsFor(related.organizations)} onChange={(assigned_organization_id) => setForm({ ...form, assigned_organization_id })} /></label>
      <label>Foreman User ID<input value={form.foreman_user_id ?? ""} onChange={(event) => setForm({ ...form, foreman_user_id: event.target.value })} /></label>
      <label>Worker Count<input type="number" min="0" value={form.worker_count ?? ""} onChange={(event) => setForm({ ...form, worker_count: event.target.value })} /></label>
      <label>Equipment Used JSON<textarea value={form.equipment_used ?? ""} onChange={(event) => setForm({ ...form, equipment_used: event.target.value })} /></label>
      <label>Subcontractor Reference<input value={form.subcontractor_reference ?? ""} onChange={(event) => setForm({ ...form, subcontractor_reference: event.target.value })} /></label>
      <label>Started At<input type="datetime-local" value={form.started_at ?? ""} onChange={(event) => setForm({ ...form, started_at: event.target.value })} /></label>
      <label>Ended At<input type="datetime-local" value={form.ended_at ?? ""} onChange={(event) => setForm({ ...form, ended_at: event.target.value })} /></label>
      <label>Route Name<input value={form.route_name ?? ""} onChange={(event) => setForm({ ...form, route_name: event.target.value })} /></label>
      <label>Node ID<input value={form.node_id ?? ""} onChange={(event) => setForm({ ...form, node_id: event.target.value })} /></label>
      <label>Segment ID<input value={form.segment_id ?? ""} onChange={(event) => setForm({ ...form, segment_id: event.target.value })} /></label>
      <label>Address Range<input value={form.address_range ?? ""} onChange={(event) => setForm({ ...form, address_range: event.target.value })} /></label>
      <label>Latitude<input value={form.latitude ?? ""} onChange={(event) => setForm({ ...form, latitude: event.target.value })} /></label>
      <label>Longitude<input value={form.longitude ?? ""} onChange={(event) => setForm({ ...form, longitude: event.target.value })} /></label>
      <label>Parent Production Record ID<input value={form.parent_production_record_id ?? ""} onChange={(event) => setForm({ ...form, parent_production_record_id: event.target.value })} /></label>
      <label>Source QC Review ID<input value={form.source_qc_review_id ?? ""} onChange={(event) => setForm({ ...form, source_qc_review_id: event.target.value })} /></label>
      <label>Correction Due Date<input type="date" value={form.correction_due_date ?? ""} onChange={(event) => setForm({ ...form, correction_due_date: event.target.value })} /></label>
      <label>Correction Owner User ID<input value={form.correction_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, correction_owner_user_id: event.target.value })} /></label>
      <label>Delay Reason<textarea value={form.delay_reason ?? ""} onChange={(event) => setForm({ ...form, delay_reason: event.target.value })} /></label>
      <label>No-Work Reason<textarea value={form.no_work_reason ?? ""} onChange={(event) => setForm({ ...form, no_work_reason: event.target.value })} /></label>
      <label>Safety Observation Note<textarea value={form.safety_observation_note ?? ""} onChange={(event) => setForm({ ...form, safety_observation_note: event.target.value })} /></label>
      <label>Material Issue Note<textarea value={form.material_issue_note ?? ""} onChange={(event) => setForm({ ...form, material_issue_note: event.target.value })} /></label>
      <label>Access Issue Note<textarea value={form.access_issue_note ?? ""} onChange={(event) => setForm({ ...form, access_issue_note: event.target.value })} /></label>
      <label>Weather Delay Note<textarea value={form.weather_delay_note ?? ""} onChange={(event) => setForm({ ...form, weather_delay_note: event.target.value })} /></label>
      <label>Customer Issue Note<textarea value={form.customer_issue_note ?? ""} onChange={(event) => setForm({ ...form, customer_issue_note: event.target.value })} /></label>
      <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>
    </div>
  );
}

function EvidenceFormFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <div className="form-grid"><label>Evidence Type<SelectInline value={form.evidence_type ?? "photo"} options={evidenceTypes} onChange={(evidence_type) => setForm({ ...form, evidence_type })} /></label><label>File URL<input value={form.file_url ?? ""} onChange={(event) => setForm({ ...form, file_url: event.target.value })} /></label><label>Storage Reference<input value={form.storage_reference ?? ""} onChange={(event) => setForm({ ...form, storage_reference: event.target.value })} /></label><label>Filename<input value={form.filename ?? ""} onChange={(event) => setForm({ ...form, filename: event.target.value })} /></label><label>MIME Type<input value={form.mime_type ?? ""} onChange={(event) => setForm({ ...form, mime_type: event.target.value })} /></label><label>Caption<textarea value={form.caption ?? ""} onChange={(event) => setForm({ ...form, caption: event.target.value })} /></label><label>GPS Latitude<input value={form.geo_latitude ?? ""} onChange={(event) => setForm({ ...form, geo_latitude: event.target.value })} /></label><label>GPS Longitude<input value={form.geo_longitude ?? ""} onChange={(event) => setForm({ ...form, geo_longitude: event.target.value })} /></label><label>Captured At<input type="datetime-local" value={form.captured_at ?? ""} onChange={(event) => setForm({ ...form, captured_at: event.target.value })} /></label><label>Metadata JSON<textarea value={form.metadata ?? ""} onChange={(event) => setForm({ ...form, metadata: event.target.value })} /></label><div className="warning-box">This creates evidence metadata only. It does not upload binary files.</div></div>;
}

function EvidenceTable({ rows, session, onArchive }: { rows: SyncRecord[]; session: Session; onArchive: (id: string) => void }) {
  if (!rows.length) return null;
  return <div className="wide-table"><table><thead><tr>{["Evidence Type", "Filename / Reference", "Caption", "Uploaded By", "Uploaded At", "Captured At", "GPS", "Archived", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{formatAction(row.evidence_type)}</td><td>{textValue(row.filename ?? row.storage_reference ?? row.file_url ?? row.source_url)}</td><td>{textValue(row.caption ?? row.description ?? row.summary)}</td><td>{textValue(row.uploaded_by)}</td><td>{dateValue(row.uploaded_at)}</td><td>{dateValue(row.captured_at)}</td><td>{gps(row.geo_latitude, row.geo_longitude)}</td><td>{row.archived_at || row.status === "archived" ? "Yes" : "No"}</td><td><button type="button" disabled={!hasPermission(session.permissions, "production_evidence.archive") || Boolean(row.archived_at)} onClick={() => onArchive(String(row.id))}>Archive</button></td></tr>)}</tbody></table></div>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test production actions.</p></div><button type="button" onClick={session.applyDefaults}>Use production defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>([]);
  useEffect(() => {
    setTokenState(readToken());
    setPermissionsState(readPermissions().length ? readPermissions() : productionDefaultPermissions);
  }, []);
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  return { token, permissions, setToken, setPermissions, applyDefaults: () => setPermissions(productionDefaultPermissions) };
}

function buildProductionPayload(form: Record<string, string>, includeCreateFields: boolean) {
  return prune({
    ...(includeCreateFields ? { work_order_id: form.work_order_id, status: form.status } : {}),
    production_type: form.production_type,
    production_date: form.production_date,
    claimed_quantity: form.claimed_quantity,
    unit: form.unit,
    location_summary: form.location_summary,
    description: form.description,
    production_notes: form.production_notes,
    capacity_provider_id: form.capacity_provider_id,
    crew_id: form.crew_id,
    assigned_organization_id: form.assigned_organization_id,
    foreman_user_id: form.foreman_user_id,
    worker_count: form.worker_count,
    equipment_used: parseJsonField(form.equipment_used, "equipment_used"),
    subcontractor_reference: form.subcontractor_reference,
    started_at: form.started_at,
    ended_at: form.ended_at,
    route_name: form.route_name,
    node_id: form.node_id,
    segment_id: form.segment_id,
    address_range: form.address_range,
    latitude: form.latitude,
    longitude: form.longitude,
    parent_production_record_id: form.parent_production_record_id,
    source_qc_review_id: form.source_qc_review_id,
    correction_due_date: form.correction_due_date,
    correction_owner_user_id: form.correction_owner_user_id,
    delay_reason: form.delay_reason,
    no_work_reason: form.no_work_reason,
    safety_observation_note: form.safety_observation_note,
    material_issue_note: form.material_issue_note,
    access_issue_note: form.access_issue_note,
    weather_delay_note: form.weather_delay_note,
    customer_issue_note: form.customer_issue_note,
    correction_reason: form.correction_reason,
    correction_note: form.correction_note,
    corrected_quantity: form.corrected_quantity,
    override_reasons: parseJsonField(form.override_reasons, "override_reasons"),
  });
}

function buildEvidencePayload(form: Record<string, string>) {
  return prune({
    evidence_type: form.evidence_type,
    file_url: form.file_url,
    storage_reference: form.storage_reference,
    filename: form.filename,
    mime_type: form.mime_type,
    caption: form.caption,
    geo_latitude: form.geo_latitude,
    geo_longitude: form.geo_longitude,
    captured_at: form.captured_at,
    metadata: parseJsonField(form.metadata, "metadata"),
  });
}

async function loadRelated(token: string): Promise<RelatedData> {
  const [workOrders, capacityProviders, crews, equipment, organizations] = await Promise.all([
    optionalList("/work-orders?archived=false", token),
    optionalList("/capacity-providers", token),
    optionalList("/crews", token),
    optionalList("/equipment", token),
    optionalList("/organizations", token),
  ]);
  return { workOrders, capacityProviders, crews, equipment, organizations };
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

function ActionButton({ permissions, session, disabled, onClick, children }: { permissions: string[]; session: Session; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || !hasAnyPermission(session.permissions, permissions)} onClick={onClick}>{children}</button>;
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
  return <div className="workspace-panel"><h3>Checklist Summary</h3>{items.map(([label, complete]) => <div className={`check-item ${complete ? "complete" : "missing"}`} key={label}><span>{label}</span><strong>{complete ? "Complete" : "Missing"}</strong></div>)}</div>;
}

function PlaceholderPanel({ title, message, columns }: { title: string; message: string; columns: string[] }) {
  return <Panel title={title}><div className="warning-box">{message}</div><ObjectTable rows={[]} columns={columns} /><div className="empty-state">No creation button is available in this sprint.</div></Panel>;
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <>Not captured yet.</>;
  return <pre className="json-block">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

function buildSummary(rows: SyncRecord[]) {
  const status = Object.fromEntries(productionStatuses.map((item) => [item, 0]));
  for (const row of rows) status[String(row.status)] = (status[String(row.status)] ?? 0) + 1;
  return {
    total: rows.length,
    status,
    billableCandidate: rows.filter((row) => row.billable_status === "billable_candidate").length,
    billable: rows.filter((row) => row.billable_status === "billable").length,
    evidenceMissing: rows.filter((row) => numberValue(row.evidence_count) === 0).length,
    correctionsOpen: rows.filter((row) => row.status === "correction_required" || row.correction_required).length,
  };
}

function matchesFilters(row: SyncRecord, filters: Record<string, string>) {
  const haystack = [row.production_type, row.status, row.qc_status, row.billable_status, row.project_name, row.work_order_name, row.customer_organization_name, row.territory_name, row.work_type, row.capacity_provider_name, row.crew_name, row.foreman_name, row.submitted_by_name, row.location_summary, row.description, row.production_notes].map((value) => String(value ?? "").toLowerCase()).join(" ");
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.project_id && !String(row.project_id ?? "").includes(filters.project_id)) return false;
  if (filters.work_order_id && !String(row.work_order_id ?? "").includes(filters.work_order_id)) return false;
  if (filters.production_type && row.production_type !== filters.production_type) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.qc_status && row.qc_status !== filters.qc_status) return false;
  if (filters.billable_status && row.billable_status !== filters.billable_status) return false;
  if (filters.production_date_from && dateTime(row.production_date) < dateTime(filters.production_date_from)) return false;
  if (filters.production_date_to && dateTime(row.production_date) > dateTime(filters.production_date_to)) return false;
  if (filters.capacity_provider_id && !String(row.capacity_provider_name ?? row.capacity_provider_id ?? "").toLowerCase().includes(filters.capacity_provider_id.toLowerCase())) return false;
  if (filters.crew_id && !String(row.crew_name ?? row.crew_id ?? "").toLowerCase().includes(filters.crew_id.toLowerCase())) return false;
  if (filters.foreman_user_id && !String(row.foreman_name ?? row.foreman_user_id ?? "").toLowerCase().includes(filters.foreman_user_id.toLowerCase())) return false;
  if (filters.submitted_by && !String(row.submitted_by_name ?? row.submitted_by ?? "").toLowerCase().includes(filters.submitted_by.toLowerCase())) return false;
  if (filters.territory_id && !String(row.territory_name ?? row.territory_id ?? "").toLowerCase().includes(filters.territory_id.toLowerCase())) return false;
  if (filters.work_type && !String(row.work_type ?? "").toLowerCase().includes(filters.work_type.toLowerCase())) return false;
  if (filters.hasEvidence && boolMatch(numberValue(row.evidence_count) > 0, filters.hasEvidence)) return false;
  if (filters.correctionRequired && boolMatch(Boolean(row.correction_required) || row.status === "correction_required", filters.correctionRequired)) return false;
  if (filters.issueOnly === "true" && !issueTypes.has(String(row.production_type))) return false;
  return true;
}

function sortProduction(rows: SyncRecord[], sort = "production_date_desc") {
  return [...rows].sort((a, b) => {
    if (sort === "production_date_asc") return dateTime(a.production_date) - dateTime(b.production_date);
    if (sort === "updated_desc") return dateTime(b.updated_at) - dateTime(a.updated_at);
    if (sort === "status") return String(a.status).localeCompare(String(b.status));
    if (sort === "project") return String(a.project_name ?? "").localeCompare(String(b.project_name ?? ""));
    if (sort === "work_order") return String(a.work_order_name ?? "").localeCompare(String(b.work_order_name ?? ""));
    if (sort === "provider") return String(a.capacity_provider_name ?? "").localeCompare(String(b.capacity_provider_name ?? ""));
    if (sort === "crew") return String(a.crew_name ?? "").localeCompare(String(b.crew_name ?? ""));
    const correctionPriority = Number(Boolean(b.correction_required) || b.status === "correction_required") - Number(Boolean(a.correction_required) || a.status === "correction_required");
    if (correctionPriority) return correctionPriority;
    const reviewPriority = reviewRank(b.status) - reviewRank(a.status);
    if (reviewPriority) return reviewPriority;
    const productionDate = dateTime(b.production_date) - dateTime(a.production_date);
    if (productionDate) return productionDate;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function reviewRank(status: unknown) {
  if (status === "submitted" || status === "under_review") return 2;
  if (status === "corrected") return 1;
  return 0;
}

function productionChecklist(record: SyncRecord, detail: ProductionDetailShape): [string, boolean][] {
  return [
    ["Work Order valid", Boolean(record.work_order_id)],
    ["Project ready/active", ["ready_for_work", "active"].includes(String(detail.project_context?.status))],
    ["Performer context present", Boolean(record.capacity_provider_id || record.crew_id || record.foreman_user_id || record.submitted_by)],
    ["Quantity valid", issueTypes.has(String(record.production_type)) || numberValue(record.claimed_quantity, -1) >= 0],
    ["Evidence requirement reviewed", numberValue(record.evidence_count ?? detail.evidence?.length) > 0 || !["completion_submission", "correction_submission", "restoration_submission", "inspection_submission"].includes(String(record.production_type))],
    ["QC status known", Boolean(record.qc_status)],
    ["No finance created", true],
  ];
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function productionRecord(detail: ProductionDetailShape): SyncRecord {
  return detail.production_record ?? (detail as SyncRecord);
}

function arrayValue(value: unknown): SyncRecord[] {
  return Array.isArray(value) ? value as SyncRecord[] : [];
}

function boolMatch(actual: boolean, expected: string) {
  return (expected === "true" && !actual) || (expected === "false" && actual);
}

function hasAnyPermission(permissions: string[], required: string[]) {
  return required.some((permission) => hasPermission(permissions, permission));
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

function dateTimeInput(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
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
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.work_order_name, String(row.id))]));
}

function overrideReasons(form: Record<string, string>) {
  return prune({
    evidence_override_reason: form.evidence_override_reason,
    performer_override_reason: form.performer_override_reason,
    production_eligibility_override_reason: form.production_eligibility_override_reason,
  });
}

function gps(latitude: unknown, longitude: unknown) {
  if (!latitude || !longitude) return "Not captured";
  return `${latitude}, ${longitude}`;
}

function projectLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/projects/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function workOrderLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/work-orders/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function productionLink(id: unknown) {
  return id ? <Link className="table-link" href={`/production/${id}`}>{String(id)}</Link> : "Not linked";
}

function organizationLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/intelligence/organizations/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function actionNotice(type: string) {
  if (type === "billable") return "Production marked billable. No settlement, invoice, AR, payment, cash, payroll, or tax record was created.";
  if (type === "evidence") return "Evidence metadata added. No binary file upload was performed.";
  if (type.startsWith("archive_evidence")) return "Evidence metadata archived.";
  return "Production action completed.";
}

function plainError(message: string) {
  if (!message) return "Production action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden")) return "You do not have permission to perform this action.";
  if (message.includes("not found")) return "Production record not found or you do not have access.";
  if (message.includes("production eligible")) return "Work Order is not production eligible.";
  if (message.includes("ready_for_work") || message.includes("active")) return "Project must be ready for work or active.";
  if (message.includes("performer")) return "Performer context is required.";
  if (message.includes("evidence")) return "Evidence is required or an override reason is needed.";
  if (message.includes("approved_quantity")) return "Approved quantity cannot exceed claimed quantity without override.";
  if (message.includes("billable_quantity")) return "Billable quantity cannot exceed approved quantity without override.";
  if (message.includes("rejection")) return "Rejection reason is required.";
  if (message.includes("correction")) return "Correction reason is required.";
  if (message.includes("void")) return "Void reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

const productionDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "production.read",
  "production.create",
  "production.update",
  "production.submit",
  "production.review",
  "production.approve",
  "production.reject",
  "production.request_correction",
  "production.mark_corrected",
  "production.mark_billable",
  "production.void",
  "production.archive",
  "production.timeline.read",
  "production.audit.read",
  "production_record.read",
  "production_record.create",
  "production_record.update",
  "production_record.submit",
  "production_record.correction_required",
  "production_record.archive",
  "qc.review",
  "qc.reject",
  "qc.approve",
  "production_evidence.read",
  "production_evidence.create",
  "production_evidence.archive",
];

const emptyRelated: RelatedData = { workOrders: [], capacityProviders: [], crews: [], equipment: [], organizations: [] };
