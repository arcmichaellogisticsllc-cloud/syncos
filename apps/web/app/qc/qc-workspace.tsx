"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, type ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const reviewTypes = ["internal_qc", "safety_qc", "compliance_qc", "customer_qc", "prime_qc", "billing_qc", "final_acceptance"];
const reviewStatuses = ["pending", "in_review", "approved", "rejected", "correction_required", "corrected", "voided", "archived"];
const findingStatuses = ["pending", "not_reviewed", "sufficient", "insufficient", "missing", "not_required"];
const locationStatuses = ["pending", "valid", "invalid", "not_required"];
const acceptanceStatuses = ["not_required", "pending", "accepted", "rejected", "correction_required"];
const archiveReasons = ["duplicate", "no_longer_relevant", "replaced", "created_in_error", "project_cancelled", "other"];
const tabs = ["overview", "production", "work_order", "project", "quantity", "evidence", "correction", "acceptance", "billable", "timeline", "audit", "future_billable", "future_settlement"];

type QcDetailShape = {
  qc_review?: SyncRecord;
  production_record?: SyncRecord;
  work_order_context?: SyncRecord | null;
  project_context?: SyncRecord | null;
  performer_context?: SyncRecord;
  quantity_summary?: SyncRecord;
  findings?: SyncRecord;
  acceptance?: SyncRecord;
  correction_context?: SyncRecord;
  warnings?: SyncRecord[];
  blockers?: SyncRecord[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
  _production_detail?: SyncRecord;
  _billable_items?: SyncRecord[];
};

type RelatedData = {
  productionRecords: SyncRecord[];
  billableItems: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function QcReviewQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("archived", filters.archived === "true" ? "true" : "false");
      for (const key of ["production_record_id", "work_order_id", "project_id", "review_type", "review_status", "reviewer_user_id", "q"]) if (filters[key]) query.set(key, filters[key]);
      if (filters.sort) query.set("sort", filters.sort === "reviewed_at_asc" ? "reviewed_at_desc" : filters.sort);
      setRows(await syncosFetch<SyncRecord[]>(`/qc-reviews?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortQcReviews(rows.filter((row) => matchesFilters(row, filters)), filters.sort), [rows, filters]);
  const summary = useMemo(() => buildSummary(rows), [rows]);

  return (
    <QcShell title="QC Review Queue" purpose="Review acceptance truth for production records without creating billable items, settlements, invoices, AR, payments, cash, payroll, or tax records.">
      <SessionPanel session={session} />
      <div className="warning-box">QC Workspace uses hardened QC review routes only. Billable Workspace and Settlement are placeholders in this sprint.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view QC reviews.</div> : null}
      {loading ? <div className="empty-state">Loading QC reviews...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>QC Summary</h2>
                <p className="muted">Reviews are prioritized by corrections, active review state, and recent updates.</p>
              </div>
              <Link className="primary-button" href="/qc/new" aria-disabled={!hasPermission(session.permissions, "qc_review.create")}>Create QC Review</Link>
            </div>
            <div className="summary-grid">
              <SummaryCard label="Total QC Reviews" value={summary.total} onClick={() => setFilters({ archived: "false", sort: "updated_desc" })} />
              {reviewStatuses.map((status) => <SummaryCard key={status} label={formatAction(status)} value={summary.status[status] ?? 0} onClick={() => setFilters({ archived: status === "archived" ? "true" : "false", sort: "updated_desc", review_status: status })} />)}
              {reviewTypes.map((type) => <SummaryCard key={type} label={formatAction(type)} value={summary.type[type] ?? 0} onClick={() => setFilters({ ...filters, review_type: type })} />)}
              <SummaryCard label="Billable Candidates" value={summary.billableCandidates} onClick={() => setFilters({ ...filters, hasBillableCandidate: "true" })} />
              <SummaryCard label="Corrections Open" value={summary.correctionsOpen} onClick={() => setFilters({ ...filters, hasCorrectionRequired: "true" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "updated_desc" })}>Reset</button>
            </div>
            <div className="tab-row">
              {["pending", "in_review", "correction_required", "approved", "rejected", "corrected"].map((status) => <button key={status} type="button" onClick={() => setFilters({ ...filters, review_status: status })}>{formatAction(status)}</button>)}
              <button type="button" onClick={() => setFilters({ ...filters, review_type: "billing_qc" })}>Billing QC</button>
              <button type="button" onClick={() => setFilters({ ...filters, review_type: "final_acceptance" })}>Final Acceptance</button>
              <button type="button" onClick={() => setFilters({ ...filters, customer_acceptance_status: "pending" })}>Needs Customer Acceptance</button>
              <button type="button" onClick={() => setFilters({ ...filters, prime_acceptance_status: "pending" })}>Needs Prime Acceptance</button>
              <button type="button" onClick={() => setFilters({ ...filters, hasBillableCandidate: "true" })}>Billable Candidate</button>
              <button type="button" onClick={() => setFilters({ ...filters, review_status: "voided" })}>Voided</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search QC, production, work order, project" />
              <Select label="Review type" value={filters.review_type ?? ""} options={["", ...reviewTypes]} onChange={(review_type) => setFilters({ ...filters, review_type })} />
              <Select label="Review status" value={filters.review_status ?? ""} options={["", ...reviewStatuses]} onChange={(review_status) => setFilters({ ...filters, review_status })} />
              <input value={filters.production_record_id ?? ""} onChange={(event) => setFilters({ ...filters, production_record_id: event.target.value })} placeholder="Production record" />
              <input value={filters.work_order_id ?? ""} onChange={(event) => setFilters({ ...filters, work_order_id: event.target.value })} placeholder="Work Order" />
              <input value={filters.project_id ?? ""} onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} placeholder="Project" />
              <input value={filters.customer ?? ""} onChange={(event) => setFilters({ ...filters, customer: event.target.value })} placeholder="Customer" />
              <input value={filters.provider ?? ""} onChange={(event) => setFilters({ ...filters, provider: event.target.value })} placeholder="Provider" />
              <input value={filters.crew ?? ""} onChange={(event) => setFilters({ ...filters, crew: event.target.value })} placeholder="Crew" />
              <input value={filters.reviewer_user_id ?? ""} onChange={(event) => setFilters({ ...filters, reviewer_user_id: event.target.value })} placeholder="Reviewer" />
              <Select label="Evidence status" value={filters.evidence_status ?? ""} options={["", ...findingStatuses]} onChange={(evidence_status) => setFilters({ ...filters, evidence_status })} />
              <Select label="Location status" value={filters.location_status ?? ""} options={["", ...locationStatuses]} onChange={(location_status) => setFilters({ ...filters, location_status })} />
              <Select label="Documentation status" value={filters.documentation_status ?? ""} options={["", ...findingStatuses]} onChange={(documentation_status) => setFilters({ ...filters, documentation_status })} />
              <Select label="Customer acceptance" value={filters.customer_acceptance_status ?? ""} options={["", ...acceptanceStatuses]} onChange={(customer_acceptance_status) => setFilters({ ...filters, customer_acceptance_status })} />
              <Select label="Prime acceptance" value={filters.prime_acceptance_status ?? ""} options={["", ...acceptanceStatuses]} onChange={(prime_acceptance_status) => setFilters({ ...filters, prime_acceptance_status })} />
              <Select label="Correction required" value={filters.hasCorrectionRequired ?? ""} options={["", "true", "false"]} onChange={(hasCorrectionRequired) => setFilters({ ...filters, hasCorrectionRequired })} />
              <Select label="Billable candidate" value={filters.hasBillableCandidate ?? ""} options={["", "true", "false"]} onChange={(hasBillableCandidate) => setFilters({ ...filters, hasBillableCandidate })} />
              <input value={filters.reviewed_from ?? ""} onChange={(event) => setFilters({ ...filters, reviewed_from: event.target.value })} type="date" aria-label="Reviewed from" />
              <input value={filters.reviewed_to ?? ""} onChange={(event) => setFilters({ ...filters, reviewed_to: event.target.value })} type="date" aria-label="Reviewed to" />
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "reviewed_at_desc", "reviewed_at_asc", "status", "review_type", "project", "work_order", "reviewer"]} labels={{ updated_desc: "Recently updated", reviewed_at_desc: "Reviewed date newest", reviewed_at_asc: "Reviewed date oldest", status: "Status", review_type: "Review type", project: "Project", work_order: "Work Order", reviewer: "Reviewer" }} onChange={(sort) => setFilters({ ...filters, sort })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>QC Reviews</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No QC reviews have been created yet. QC reviews validate submitted production before it can become a billable candidate.</div> : <QcReviewTable rows={visible} />}
          </section>
        </>
      ) : null}
    </QcShell>
  );
}

export function QcReviewCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ review_type: "internal_qc", evidence_status: "pending", location_status: "pending", documentation_status: "pending", production_status: "pending", customer_acceptance_status: "not_required", prime_acceptance_status: "not_required" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/qc-reviews", { method: "POST", body: buildCreatePayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const review = after?.qc_review as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? review?.id ?? after?.id ?? "");
      router.push(id ? `/qc/${id}` : "/qc");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <QcShell title="Create QC Review" purpose="Create an acceptance review for a production record without creating billable, settlement, invoice, AR, payment, cash, payroll, or tax records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">The backend derives Work Order, Project, claimed quantity, and unit from the selected production record. Quantity decisions use lifecycle action routes after creation.</div>
        <QcCreateFields form={form} setForm={setForm} related={related} />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "qc_review.create")}>Create QC Review</button>
          <Link className="link-button" href="/qc">Cancel</Link>
        </div>
      </form>
    </QcShell>
  );
}

export function QcReviewEdit({ qcReviewId }: { qcReviewId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<QcDetailShape | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        setDetail(await syncosFetch<QcDetailShape>(`/qc-reviews/${qcReviewId}/detail`, { token: session.token }));
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, qcReviewId]);

  const review = detail ? qcReview(detail) : null;
  return (
    <QcShell title="Edit QC Review" purpose="Review editable QC fields where backend support exists; lifecycle decisions use action routes.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!review ? <div className="empty-state">QC review not found or you do not have access.</div> : (
        <section className="workspace-panel">
          <div className="warning-box">The hardened QC backend does not expose a direct PATCH route in this sprint. Use lifecycle actions for approval, rejection, correction, void, or archive decisions.</div>
          <dl className="detail-list">
            <dt>Review type</dt><dd>{formatAction(review.review_type)}</dd>
            <dt>Review status</dt><dd>{formatAction(review.review_status)}</dd>
            <dt>Evidence status</dt><dd>{formatAction(review.evidence_status)}</dd>
            <dt>Location status</dt><dd>{formatAction(review.location_status)}</dd>
            <dt>Documentation status</dt><dd>{formatAction(review.documentation_status)}</dd>
            <dt>Customer acceptance</dt><dd>{formatAction(review.customer_acceptance_status)}</dd>
            <dt>Prime acceptance</dt><dd>{formatAction(review.prime_acceptance_status)}</dd>
            <dt>Review notes</dt><dd>{textValue(review.review_notes)}</dd>
            <dt>Hard stop</dt><dd>{review.hard_stop ? "Yes" : "No"}</dd>
            <dt>Override reasons</dt><dd><JsonBlock value={review.override_reasons} /></dd>
          </dl>
          <div className="form-actions">
            <Link className="primary-button" href={`/qc/${qcReviewId}`}>Back to QC Detail</Link>
          </div>
        </section>
      )}
    </QcShell>
  );
}

export function QcReviewDetail({ qcReviewId }: { qcReviewId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<QcDetailShape | null>(null);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const next = await syncosFetch<QcDetailShape>(`/qc-reviews/${qcReviewId}/detail`, { token: session.token });
      const review = qcReview(next);
      const productionId = String(review.production_record_id ?? "");
      const [timeline, audit, productionDetail, billableItems] = await Promise.all([
        optionalList(`/qc-reviews/${qcReviewId}/timeline`, session.token),
        optionalList(`/qc-reviews/${qcReviewId}/audit-summary`, session.token),
        productionId ? optionalObject(`/production-records/${productionId}/detail`, session.token) : Promise.resolve({}),
        optionalList(`/billable-items?qc_review_id=${qcReviewId}`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit, _production_detail: productionDetail, _billable_items: billableItems });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, qcReviewId]);

  const review = detail ? qcReview(detail) : null;
  const production = detail?.production_record ?? {};
  const warnings = detail?.warnings ?? arrayValue(review?.warnings);
  const blockers = detail?.blockers ?? arrayValue(review?.blockers);

  return (
    <QcShell title="QC Detail" purpose="Show acceptance truth, context, quantity decisions, correction state, timeline, and audit without creating finance records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view QC Detail.</div> : null}
      {!review && session.token && !error ? <div className="empty-state">QC review not found or you do not have access.</div> : null}
      {review && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{formatAction(review.review_type)}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(review.review_status)}</span>
                  <span className="badge">{formatAction(review.evidence_status)}</span>
                  <span className="badge">{formatAction(review.customer_acceptance_status)}</span>
                  <span className="badge">{formatAction(review.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/qc/${qcReviewId}/edit`} aria-disabled={!hasPermission(session.permissions, "qc_review.update")}>Edit QC Review</Link>
                <ActionButton permission="qc_review.start" session={session} disabled={!["pending", "corrected"].includes(String(review.review_status))} onClick={() => setModal("start")}>Start Review</ActionButton>
                <ActionButton permission="qc_review.approve" session={session} disabled={["approved", "voided", "archived"].includes(String(review.review_status))} onClick={() => setModal("approve")}>Approve</ActionButton>
                <ActionButton permission="qc_review.reject" session={session} disabled={["rejected", "voided", "archived"].includes(String(review.review_status))} onClick={() => setModal("reject")}>Reject</ActionButton>
                <ActionButton permission="qc_review.request_correction" session={session} disabled={["voided", "archived"].includes(String(review.review_status))} onClick={() => setModal("correction")}>Request Correction</ActionButton>
                <ActionButton permission="qc_review.mark_corrected" session={session} disabled={String(review.review_status) !== "correction_required"} onClick={() => setModal("corrected")}>Mark Corrected</ActionButton>
                <ActionButton permission="qc_review.void" session={session} disabled={["voided", "archived"].includes(String(review.review_status))} onClick={() => setModal("void")}>Void</ActionButton>
                <ActionButton permission="qc_review.archive" session={session} disabled={String(review.review_status) === "archived"} onClick={() => setModal("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Claimed Quantity" value={quantity(review.claimed_quantity, review.unit)} />
              <Metric label="Approved Quantity" value={quantity(review.approved_quantity, review.unit)} />
              <Metric label="Rejected Quantity" value={quantity(review.rejected_quantity, review.unit)} />
              <Metric label="Correction Required Quantity" value={quantity(review.correction_required_quantity, review.unit)} />
              <Metric label="Billable Candidate Quantity" value={quantity(review.billable_candidate_quantity, review.unit)} />
              <Metric label="Review Status" value={formatAction(review.review_status)} />
              <Metric label="Evidence Status" value={formatAction(review.evidence_status)} />
              <Metric label="Location Status" value={formatAction(review.location_status)} />
              <Metric label="Documentation Status" value={formatAction(review.documentation_status)} />
              <Metric label="Customer Acceptance" value={formatAction(review.customer_acceptance_status)} />
              <Metric label="Prime Acceptance" value={formatAction(review.prime_acceptance_status)} />
              <Metric label="Recommended Next Action" value={formatAction(review.recommended_next_action ?? detail.recommended_next_action)} />
            </div>
            <div className="warning-box">Claimed is not approved. Approved is not automatically settled. Billable candidate does not create settlement.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Production record</dt><dd>{productionLink(review.production_record_id, production.production_type)}</dd>
                <dt>Work Order</dt><dd>{workOrderLink(review.work_order_id, review.work_order_name ?? detail.work_order_context?.work_order_name)}</dd>
                <dt>Project</dt><dd>{projectLink(review.project_id, review.project_name ?? detail.project_context?.project_name ?? detail.project_context?.name)}</dd>
                <dt>Customer</dt><dd>{organizationLink(production.customer_organization_id, production.customer_organization_name)}</dd>
                <dt>Provider</dt><dd>{textValue(production.capacity_provider_name ?? production.capacity_provider_id)}</dd>
                <dt>Crew</dt><dd>{textValue(production.crew_name ?? production.crew_id)}</dd>
                <dt>Reviewer</dt><dd>{textValue(review.reviewer_name ?? review.reviewer_user_id)}</dd>
                <dt>Review type</dt><dd>{formatAction(review.review_type)}</dd>
                <dt>Review status</dt><dd>{formatAction(review.review_status)}</dd>
                <dt>Customer acceptance</dt><dd>{formatAction(review.customer_acceptance_status)}</dd>
                <dt>Prime acceptance</dt><dd>{formatAction(review.prime_acceptance_status)}</dd>
                <dt>Correction state</dt><dd>{formatAction(review.correction_reason ? "correction_required" : review.review_status)}</dd>
                <dt>Billable candidate state</dt><dd>{numberValue(review.billable_candidate_quantity) > 0 ? "Candidate quantity captured" : "Not captured yet"}</dd>
              </dl>
              <Checklist items={qcChecklist(review, detail)} />
              <WarningList title="Key Blockers" rows={blockers.slice(0, 4)} empty="No blockers returned." />
              <WarningList title="Key Warnings" rows={warnings.slice(0, 4)} empty="No warnings returned." />
              <div className="warning-box">QC can create billable candidate quantity only. It does not create settlement, invoice, AR, payment, cash, payroll, or tax records.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}
              </div>
              <QcTab tab={tab} detail={detail} review={review} />
            </section>
          </div>
          {modal ? <QcLifecycleModal type={modal} qcReviewId={qcReviewId} review={review} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </QcShell>
  );
}

function QcShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/qc", "QC Review Queue", "active"],
    ["/qc/new", "Create QC Review", "active"],
    ["#detail", "QC Detail", "placeholder"],
    ["#production", "Production Context", "placeholder"],
    ["#work-order", "Work Order Context", "placeholder"],
    ["#project", "Project Context", "placeholder"],
    ["#quantity", "Quantity Acceptance", "placeholder"],
    ["#evidence", "Evidence Review", "placeholder"],
    ["#correction", "Correction Management", "placeholder"],
    ["#acceptance", "Customer / Prime Acceptance", "placeholder"],
    ["#billable", "Billable Candidate Summary", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-billable", "Future Billable Workspace", "placeholder"],
    ["#future-settlement", "Future Settlement", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">QC</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function QcReviewTable({ rows }: { rows: SyncRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Review Type", "Review Status", "Production Record", "Production Status", "Work Order", "Project", "Customer", "Provider", "Crew", "Reviewer", "Reviewed At", "Claimed Quantity", "Approved Quantity", "Rejected Quantity", "Correction Required Quantity", "Billable Candidate Quantity", "Unit", "Evidence Status", "Location Status", "Documentation Status", "Customer Acceptance", "Prime Acceptance", "Recommended Next Action", "Updated Date"].map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td><Link className="table-link" href={`/qc/${row.id}`}>{formatAction(row.review_type)}</Link></td>
              <td>{formatAction(row.review_status)}</td>
              <td>{productionLink(row.production_record_id, row.production_type ?? row.production_record_id)}</td>
              <td>{formatAction(row.production_record_status)}</td>
              <td>{workOrderLink(row.work_order_id, row.work_order_name ?? row.work_order_number)}</td>
              <td>{projectLink(row.project_id, row.project_name)}</td>
              <td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td>
              <td>{textValue(row.capacity_provider_name ?? row.capacity_provider_id)}</td>
              <td>{textValue(row.crew_name ?? row.crew_id)}</td>
              <td>{textValue(row.reviewer_name ?? row.reviewer_user_id)}</td>
              <td>{dateValue(row.reviewed_at)}</td>
              <td>{formatCell(row.claimed_quantity)}</td>
              <td>{formatCell(row.approved_quantity)}</td>
              <td>{formatCell(row.rejected_quantity)}</td>
              <td>{formatCell(row.correction_required_quantity)}</td>
              <td>{formatCell(row.billable_candidate_quantity)}</td>
              <td>{formatAction(row.unit)}</td>
              <td>{formatAction(row.evidence_status)}</td>
              <td>{formatAction(row.location_status)}</td>
              <td>{formatAction(row.documentation_status)}</td>
              <td>{formatAction(row.customer_acceptance_status)}</td>
              <td>{formatAction(row.prime_acceptance_status)}</td>
              <td>{formatAction(row.recommended_next_action)}</td>
              <td>{dateValue(row.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QcTab({ tab, detail, review }: { tab: string; detail: QcDetailShape; review: SyncRecord }) {
  const production = detail.production_record ?? {};
  const evidence = arrayValue((detail._production_detail?.evidence as unknown) ?? []);
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Review type</dt><dd>{formatAction(review.review_type)}</dd><dt>Review status</dt><dd>{formatAction(review.review_status)}</dd><dt>Reviewer</dt><dd>{textValue(review.reviewer_name ?? review.reviewer_user_id)}</dd><dt>Reviewed at</dt><dd>{dateValue(review.reviewed_at)}</dd><dt>Review notes</dt><dd>{textValue(review.review_notes)}</dd><dt>Evidence status</dt><dd>{formatAction(review.evidence_status)}</dd><dt>Location status</dt><dd>{formatAction(review.location_status)}</dd><dt>Documentation status</dt><dd>{formatAction(review.documentation_status)}</dd><dt>Customer acceptance</dt><dd>{formatAction(review.customer_acceptance_status)}</dd><dt>Prime acceptance</dt><dd>{formatAction(review.prime_acceptance_status)}</dd><dt>Hard stop</dt><dd>{review.hard_stop ? "Yes" : "No"}</dd><dt>Override reasons</dt><dd><JsonBlock value={review.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(review.created_at)}</dd><dt>Updated</dt><dd>{dateValue(review.updated_at)}</dd></dl><div className="warning-box">QC review records acceptance truth. It determines approved, rejected, correction-required, and billable-candidate quantities. It does not create settlement, invoice, payment, payroll, AR, or cash records.</div></Panel>;
  if (tab === "production") return <Panel title="Production Context"><dl className="detail-list"><dt>Production record</dt><dd>{productionLink(review.production_record_id, production.production_type)}</dd><dt>Production type</dt><dd>{formatAction(production.production_type)}</dd><dt>Production status</dt><dd>{formatAction(production.status ?? review.production_record_status)}</dd><dt>QC status</dt><dd>{formatAction(production.qc_status ?? review.production_qc_status)}</dd><dt>Billable status</dt><dd>{formatAction(production.billable_status ?? review.production_billable_status)}</dd><dt>Production date</dt><dd>{dateValue(production.production_date)}</dd><dt>Claimed quantity</dt><dd>{quantity(production.claimed_quantity ?? review.claimed_quantity, production.unit ?? review.unit)}</dd><dt>Approved quantity</dt><dd>{quantity(production.approved_quantity, production.unit ?? review.unit)}</dd><dt>Rejected quantity</dt><dd>{quantity(production.rejected_quantity, production.unit ?? review.unit)}</dd><dt>Corrected quantity</dt><dd>{quantity(production.corrected_quantity, production.unit ?? review.unit)}</dd><dt>Billable quantity</dt><dd>{quantity(production.billable_quantity, production.unit ?? review.unit)}</dd><dt>Evidence count</dt><dd>{formatCell(production.evidence_count ?? evidence.length)}</dd><dt>Location summary</dt><dd>{textValue(production.location_summary)}</dd><dt>Submitted by</dt><dd>{textValue(production.submitted_by_name ?? production.submitted_by)}</dd><dt>Foreman</dt><dd>{textValue(production.foreman_name ?? production.foreman_user_id)}</dd></dl>{productionLink(review.production_record_id, "Open Production")}</Panel>;
  if (tab === "work_order") return <ContextPanel title="Work Order Context" record={detail.work_order_context} href={review.work_order_id ? `/work-orders/${review.work_order_id}` : undefined} fields={["work_order_name", "status", "readiness_status", "production_eligible", "planned_quantity", "completed_quantity", "approved_quantity", "billable_quantity", "unit", "assignment_type", "assigned_capacity_provider_id", "assigned_crew_id"]} />;
  if (tab === "project") return <ContextPanel title="Project Context" record={detail.project_context} href={review.project_id ? `/projects/${review.project_id}` : undefined} fields={["project_name", "name", "status", "project_readiness_score", "customer_organization_id", "territory_id", "work_type", "project_manager_user_id", "field_supervisor_user_id"]} />;
  if (tab === "quantity") return <Panel title="Quantity Acceptance"><dl className="detail-list"><dt>Claimed quantity</dt><dd>{quantity(review.claimed_quantity, review.unit)}</dd><dt>Approved quantity</dt><dd>{quantity(review.approved_quantity, review.unit)}</dd><dt>Rejected quantity</dt><dd>{quantity(review.rejected_quantity, review.unit)}</dd><dt>Correction required quantity</dt><dd>{quantity(review.correction_required_quantity, review.unit)}</dd><dt>Billable candidate quantity</dt><dd>{quantity(review.billable_candidate_quantity, review.unit)}</dd><dt>Unit</dt><dd>{formatAction(review.unit)}</dd></dl><div className="warning-box">Claimed quantity comes from production. Approved quantity comes from QC. Rejected quantity is not billable. Correction-required quantity must be corrected before becoming billable. Billable candidate quantity feeds the Billable layer later.</div></Panel>;
  if (tab === "evidence") return <Panel title="Evidence Review"><dl className="detail-list"><dt>Evidence status</dt><dd>{formatAction(review.evidence_status)}</dd><dt>Evidence count</dt><dd>{String(numberValue(production.evidence_count ?? evidence.length))}</dd><dt>Missing evidence warning</dt><dd>{String(review.evidence_status) === "missing" ? "Evidence missing" : "No missing-evidence warning returned."}</dd><dt>QC evidence</dt><dd>Placeholder only</dd></dl>{evidence.length ? <ObjectTable rows={evidence} columns={["evidence_type", "filename", "storage_reference", "caption", "uploaded_by", "uploaded_at", "captured_at", "geo_latitude", "geo_longitude", "archived_at"]} /> : <div className="empty-state">No production evidence metadata returned.</div>}<div className="warning-box">Production evidence is shown as read-only. No binary upload is available in this sprint.</div></Panel>;
  if (tab === "correction") return <Panel title="Correction Management"><dl className="detail-list"><dt>Correction reason</dt><dd>{textValue(review.correction_reason ?? detail.correction_context?.correction_reason)}</dd><dt>Correction due date</dt><dd>{dateValue(review.correction_due_date ?? detail.correction_context?.correction_due_date)}</dd><dt>Correction owner</dt><dd>{textValue(review.correction_owner_name ?? review.correction_owner_user_id ?? detail.correction_context?.correction_owner_name)}</dd><dt>Correction required quantity</dt><dd>{quantity(review.correction_required_quantity, review.unit)}</dd><dt>Correction status</dt><dd>{formatAction(review.review_status)}</dd><dt>Source production record</dt><dd>{productionLink(review.production_record_id, production.production_type)}</dd><dt>Source QC review</dt><dd>{textValue(review.source_qc_review_id)}</dd></dl><div className="warning-box">QC can request and mark corrections through QC routes. It does not create correction production records unless a future backend route explicitly supports that workflow.</div></Panel>;
  if (tab === "acceptance") return <Panel title="Customer / Prime Acceptance"><dl className="detail-list"><dt>Customer acceptance status</dt><dd>{formatAction(review.customer_acceptance_status)}</dd><dt>Prime acceptance status</dt><dd>{formatAction(review.prime_acceptance_status)}</dd><dt>Acceptance notes</dt><dd>{textValue(review.review_notes)}</dd><dt>Customer blocker state</dt><dd>{["rejected", "correction_required"].includes(String(review.customer_acceptance_status)) ? "Blocked" : "Not blocked"}</dd><dt>Prime blocker state</dt><dd>{["rejected", "correction_required"].includes(String(review.prime_acceptance_status)) ? "Blocked" : "Not blocked"}</dd></dl><div className="warning-box">Customer and prime acceptance are tracked here as review fields. No customer or prime portal is available in this sprint.</div></Panel>;
  if (tab === "billable") return <Panel title="Billable Candidate"><dl className="detail-list"><dt>Approved quantity</dt><dd>{quantity(review.approved_quantity, review.unit)}</dd><dt>Billable candidate quantity</dt><dd>{quantity(review.billable_candidate_quantity, review.unit)}</dd><dt>Unit</dt><dd>{formatAction(review.unit)}</dd><dt>Production billable status</dt><dd>{formatAction(production.billable_status ?? review.production_billable_status)}</dd><dt>Related billable item count</dt><dd>{String(detail._billable_items?.length ?? 0)}</dd></dl><div className="warning-box">Billable Workspace is not available in this sprint. QC may create billable candidate quantity, but it does not create settlement, invoice, AR, payment, cash, or payroll records.</div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor_name", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor_name", "action", "object_type", "object_id", "before_json", "after_json", "reason", "created_at", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view QC audit details.</div>}</Panel>;
  if (tab === "future_billable") return <PlaceholderPanel title="Future Billable Workspace" message="Billable Workspace is not available in this sprint. QC may create billable candidate quantity only." columns={["billable_item", "status", "quantity", "unit", "rate", "readiness"]} />;
  return <PlaceholderPanel title="Future Settlement" message="Settlement is not available in this sprint. QC does not create settlement, invoice, AR, payment, cash, payroll, or tax records." columns={["settlement_item", "invoice_item", "AR", "payment", "cash", "status"]} />;
}

function QcLifecycleModal({ type, qcReviewId, review, session, onClose, onSaved }: { type: string; qcReviewId: string; review: SyncRecord; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({
    approved_quantity: String(review.approved_quantity ?? review.claimed_quantity ?? ""),
    rejected_quantity: String(review.rejected_quantity ?? ""),
    correction_required_quantity: String(review.correction_required_quantity ?? ""),
    billable_candidate_quantity: String(review.billable_candidate_quantity ?? review.approved_quantity ?? ""),
    evidence_status: String(review.evidence_status ?? "pending"),
    location_status: String(review.location_status ?? "pending"),
    documentation_status: String(review.documentation_status ?? "pending"),
    production_status: String(review.production_status ?? "pending"),
    customer_acceptance_status: String(review.customer_acceptance_status ?? "not_required"),
    prime_acceptance_status: String(review.prime_acceptance_status ?? "not_required"),
    archive_reason: "other",
  });
  const [error, setError] = useState("");

  const title = modalTitle(type);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/qc-reviews/${qcReviewId}/${modalPath(type)}`, { method: "POST", body: modalBody(type, form), token: session.token });
      onClose();
      await onSaved();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-card" onSubmit={(event) => void submit(event)}>
        <div className="section-toolbar"><h2>{title}</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        {type === "start" ? <label>Review note<textarea value={form.review_note ?? ""} onChange={(event) => setForm({ ...form, review_note: event.target.value })} /></label> : null}
        {type === "approve" ? <div className="form-grid"><label>Approval note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><label>Approved quantity<input type="number" min="0" value={form.approved_quantity ?? ""} onChange={(event) => setForm({ ...form, approved_quantity: event.target.value })} required /></label><label>Billable candidate quantity<input type="number" min="0" value={form.billable_candidate_quantity ?? ""} onChange={(event) => setForm({ ...form, billable_candidate_quantity: event.target.value })} /></label><label>Approval override reason<textarea value={form.approval_override_reason ?? ""} onChange={(event) => setForm({ ...form, approval_override_reason: event.target.value })} /></label><Select label="Evidence status" value={form.evidence_status ?? ""} options={findingStatuses} onChange={(evidence_status) => setForm({ ...form, evidence_status })} /><Select label="Location status" value={form.location_status ?? ""} options={locationStatuses} onChange={(location_status) => setForm({ ...form, location_status })} /><Select label="Documentation status" value={form.documentation_status ?? ""} options={findingStatuses} onChange={(documentation_status) => setForm({ ...form, documentation_status })} /><Select label="Production status" value={form.production_status ?? ""} options={locationStatuses} onChange={(production_status) => setForm({ ...form, production_status })} /><Select label="Customer acceptance" value={form.customer_acceptance_status ?? ""} options={acceptanceStatuses} onChange={(customer_acceptance_status) => setForm({ ...form, customer_acceptance_status })} /><Select label="Prime acceptance" value={form.prime_acceptance_status ?? ""} options={acceptanceStatuses} onChange={(prime_acceptance_status) => setForm({ ...form, prime_acceptance_status })} /></div> : null}
        {type === "reject" ? <div className="form-grid"><label>Rejection reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejected quantity<input type="number" min="0" value={form.rejected_quantity ?? ""} onChange={(event) => setForm({ ...form, rejected_quantity: event.target.value })} /></label><label>Rejection note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></div> : null}
        {type === "correction" ? <div className="form-grid"><label>Correction reason<textarea value={form.correction_reason ?? ""} onChange={(event) => setForm({ ...form, correction_reason: event.target.value })} required /></label><label>Correction required quantity<input type="number" min="0" value={form.correction_required_quantity ?? ""} onChange={(event) => setForm({ ...form, correction_required_quantity: event.target.value })} /></label><label>Correction due date<input type="date" value={form.correction_due_date ?? ""} onChange={(event) => setForm({ ...form, correction_due_date: event.target.value })} /></label><label>Correction owner user ID<input value={form.correction_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, correction_owner_user_id: event.target.value })} /></label><label>Correction note<textarea value={form.correction_note ?? ""} onChange={(event) => setForm({ ...form, correction_note: event.target.value })} /></label></div> : null}
        {type === "corrected" ? <div className="form-grid"><label>Correction note<textarea value={form.correction_note ?? ""} onChange={(event) => setForm({ ...form, correction_note: event.target.value })} required /></label><label>Corrected quantity<input type="number" min="0" value={form.corrected_quantity ?? ""} onChange={(event) => setForm({ ...form, corrected_quantity: event.target.value })} /></label></div> : null}
        {type === "void" ? <div className="form-grid"><label>Void reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></div> : null}
        {type === "archive" ? <div className="form-grid"><label>Archive reason<SelectInline value={form.archive_reason ?? ""} options={["", ...archiveReasons]} onChange={(archive_reason) => setForm({ ...form, archive_reason })} /></label><label>Archive note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></div> : null}
        <div className="warning-box">Lifecycle action uses the backend route. The backend remains authoritative for validation, permissions, tenant boundaries, events, audit, and system actions. No finance records are created.</div>
        <div className="form-actions"><button className="primary-button" type="submit">{title}</button></div>
      </form>
    </div>
  );
}

function QcCreateFields({ form, setForm, related }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData }) {
  return (
    <div className="form-grid">
      <label>Production Record<SelectInline value={form.production_record_id ?? ""} options={["", ...related.productionRecords.map((row) => String(row.id))]} labels={labelsFor(related.productionRecords, "production_type")} onChange={(production_record_id) => setForm({ ...form, production_record_id })} /></label>
      <label>Review Type<SelectInline value={form.review_type ?? "internal_qc"} options={reviewTypes} onChange={(review_type) => setForm({ ...form, review_type })} /></label>
      <label>Reviewer User ID<input value={form.reviewer_user_id ?? ""} onChange={(event) => setForm({ ...form, reviewer_user_id: event.target.value })} /></label>
      <label>Review Notes<textarea value={form.review_notes ?? ""} onChange={(event) => setForm({ ...form, review_notes: event.target.value })} /></label>
      <Select label="Evidence Status" value={form.evidence_status ?? ""} options={findingStatuses} onChange={(evidence_status) => setForm({ ...form, evidence_status })} />
      <Select label="Location Status" value={form.location_status ?? ""} options={locationStatuses} onChange={(location_status) => setForm({ ...form, location_status })} />
      <Select label="Documentation Status" value={form.documentation_status ?? ""} options={findingStatuses} onChange={(documentation_status) => setForm({ ...form, documentation_status })} />
      <Select label="Production Status" value={form.production_status ?? ""} options={locationStatuses} onChange={(production_status) => setForm({ ...form, production_status })} />
      <Select label="Customer Acceptance Status" value={form.customer_acceptance_status ?? ""} options={acceptanceStatuses} onChange={(customer_acceptance_status) => setForm({ ...form, customer_acceptance_status })} />
      <Select label="Prime Acceptance Status" value={form.prime_acceptance_status ?? ""} options={acceptanceStatuses} onChange={(prime_acceptance_status) => setForm({ ...form, prime_acceptance_status })} />
      <label>Correction Due Date<input type="date" value={form.correction_due_date ?? ""} onChange={(event) => setForm({ ...form, correction_due_date: event.target.value })} /></label>
      <label>Correction Owner User ID<input value={form.correction_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, correction_owner_user_id: event.target.value })} /></label>
      <label>Source QC Review ID<input value={form.source_qc_review_id ?? ""} onChange={(event) => setForm({ ...form, source_qc_review_id: event.target.value })} /></label>
      <label>Hard Stop<SelectInline value={form.hard_stop ?? "false"} options={["false", "true"]} onChange={(hard_stop) => setForm({ ...form, hard_stop })} /></label>
      <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>
    </div>
  );
}

function SessionPanel({ session }: { session: Session }) {
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test QC actions.</p></div><button type="button" onClick={session.applyDefaults}>Use QC defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>([]);
  useEffect(() => {
    setTokenState(readToken());
    setPermissionsState(readPermissions().length ? readPermissions() : qcDefaultPermissions);
  }, []);
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  return { token, permissions, setToken, setPermissions, applyDefaults: () => setPermissions(qcDefaultPermissions) };
}

function buildCreatePayload(form: Record<string, string>) {
  return prune({
    production_record_id: form.production_record_id,
    review_type: form.review_type,
    reviewer_user_id: form.reviewer_user_id,
    correction_owner_user_id: form.correction_owner_user_id,
    source_qc_review_id: form.source_qc_review_id,
    evidence_status: form.evidence_status,
    location_status: form.location_status,
    documentation_status: form.documentation_status,
    production_status: form.production_status,
    customer_acceptance_status: form.customer_acceptance_status,
    prime_acceptance_status: form.prime_acceptance_status,
    review_notes: form.review_notes,
    hard_stop: form.hard_stop === "true",
    override_reasons: parseJsonField(form.override_reasons, "override_reasons"),
  });
}

function modalBody(type: string, form: Record<string, string>) {
  if (type === "start") return prune({ review_note: form.review_note });
  if (type === "approve") return prune({ approval_note: form.approval_note, approved_quantity: form.approved_quantity, billable_candidate_quantity: form.billable_candidate_quantity, evidence_status: form.evidence_status, location_status: form.location_status, documentation_status: form.documentation_status, production_status: form.production_status, customer_acceptance_status: form.customer_acceptance_status, prime_acceptance_status: form.prime_acceptance_status, override_reasons: overrideReasons(form) });
  if (type === "reject") return prune({ rejection_reason: form.rejection_reason, rejected_quantity: form.rejected_quantity, rejection_note: form.rejection_note, override_reasons: overrideReasons(form) });
  if (type === "correction") return prune({ correction_reason: form.correction_reason, correction_note: form.correction_note, correction_required_quantity: form.correction_required_quantity, correction_due_date: form.correction_due_date, correction_owner_user_id: form.correction_owner_user_id });
  if (type === "corrected") return prune({ correction_note: form.correction_note, corrected_quantity: form.corrected_quantity });
  if (type === "void") return prune({ void_reason: form.void_reason, void_note: form.void_note });
  if (type === "archive") return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
  return {};
}

function modalPath(type: string) {
  if (type === "start") return "start-review";
  if (type === "correction") return "request-correction";
  if (type === "corrected") return "mark-corrected";
  return type;
}

function modalTitle(type: string) {
  if (type === "start") return "Start Review";
  if (type === "correction") return "Request Correction";
  if (type === "corrected") return "Mark Corrected";
  return formatAction(type);
}

async function loadRelated(token: string): Promise<RelatedData> {
  const [productionRecords, billableItems] = await Promise.all([
    optionalList("/production-records?archived=false", token),
    optionalList("/billable-items?archived=false", token),
  ]);
  return { productionRecords, billableItems };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

async function optionalObject(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord>(path, { token });
  } catch {
    return {};
  }
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
  const status = Object.fromEntries(reviewStatuses.map((item) => [item, 0]));
  const type = Object.fromEntries(reviewTypes.map((item) => [item, 0]));
  for (const row of rows) {
    status[String(row.review_status)] = (status[String(row.review_status)] ?? 0) + 1;
    type[String(row.review_type)] = (type[String(row.review_type)] ?? 0) + 1;
  }
  return {
    total: rows.length,
    status,
    type,
    billableCandidates: rows.filter((row) => numberValue(row.billable_candidate_quantity) > 0).length,
    correctionsOpen: rows.filter((row) => row.review_status === "correction_required").length,
  };
}

function matchesFilters(row: SyncRecord, filters: Record<string, string>) {
  const haystack = [row.review_type, row.review_status, row.production_type, row.production_record_status, row.work_order_name, row.project_name, row.customer_organization_name, row.capacity_provider_name, row.crew_name, row.reviewer_name, row.review_notes, row.rejection_reason, row.correction_reason].map((value) => String(value ?? "").toLowerCase()).join(" ");
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.production_record_id && !String(row.production_record_id ?? "").includes(filters.production_record_id)) return false;
  if (filters.work_order_id && !String(row.work_order_id ?? "").includes(filters.work_order_id)) return false;
  if (filters.project_id && !String(row.project_id ?? "").includes(filters.project_id)) return false;
  if (filters.review_type && row.review_type !== filters.review_type) return false;
  if (filters.review_status && row.review_status !== filters.review_status) return false;
  if (filters.customer && !String(row.customer_organization_name ?? row.customer_organization_id ?? "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
  if (filters.provider && !String(row.capacity_provider_name ?? row.capacity_provider_id ?? "").toLowerCase().includes(filters.provider.toLowerCase())) return false;
  if (filters.crew && !String(row.crew_name ?? row.crew_id ?? "").toLowerCase().includes(filters.crew.toLowerCase())) return false;
  if (filters.reviewer_user_id && !String(row.reviewer_name ?? row.reviewer_user_id ?? "").toLowerCase().includes(filters.reviewer_user_id.toLowerCase())) return false;
  if (filters.evidence_status && row.evidence_status !== filters.evidence_status) return false;
  if (filters.location_status && row.location_status !== filters.location_status) return false;
  if (filters.documentation_status && row.documentation_status !== filters.documentation_status) return false;
  if (filters.customer_acceptance_status && row.customer_acceptance_status !== filters.customer_acceptance_status) return false;
  if (filters.prime_acceptance_status && row.prime_acceptance_status !== filters.prime_acceptance_status) return false;
  if (filters.hasCorrectionRequired && boolMismatch(row.review_status === "correction_required" || numberValue(row.correction_required_quantity) > 0, filters.hasCorrectionRequired)) return false;
  if (filters.hasBillableCandidate && boolMismatch(numberValue(row.billable_candidate_quantity) > 0, filters.hasBillableCandidate)) return false;
  if (filters.reviewed_from && dateTime(row.reviewed_at) < dateTime(filters.reviewed_from)) return false;
  if (filters.reviewed_to && dateTime(row.reviewed_at) > dateTime(filters.reviewed_to)) return false;
  return true;
}

function sortQcReviews(rows: SyncRecord[], sort = "updated_desc") {
  return [...rows].sort((a, b) => {
    if (sort === "reviewed_at_desc") return dateTime(b.reviewed_at) - dateTime(a.reviewed_at);
    if (sort === "reviewed_at_asc") return dateTime(a.reviewed_at) - dateTime(b.reviewed_at);
    if (sort === "status") return String(a.review_status).localeCompare(String(b.review_status));
    if (sort === "review_type") return String(a.review_type).localeCompare(String(b.review_type));
    if (sort === "project") return String(a.project_name ?? "").localeCompare(String(b.project_name ?? ""));
    if (sort === "work_order") return String(a.work_order_name ?? "").localeCompare(String(b.work_order_name ?? ""));
    if (sort === "reviewer") return String(a.reviewer_name ?? "").localeCompare(String(b.reviewer_name ?? ""));
    const correctionPriority = Number(b.review_status === "correction_required") - Number(a.review_status === "correction_required");
    if (correctionPriority) return correctionPriority;
    const reviewPriority = activeReviewRank(b.review_status) - activeReviewRank(a.review_status);
    if (reviewPriority) return reviewPriority;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function activeReviewRank(status: unknown) {
  if (status === "pending" || status === "in_review") return 2;
  if (status === "corrected") return 1;
  return 0;
}

function qcChecklist(review: SyncRecord, detail: QcDetailShape): [string, boolean][] {
  return [
    ["Production record valid", Boolean(review.production_record_id)],
    ["Production submitted/approved context", Boolean(detail.production_record?.status)],
    ["Claimed quantity present", review.claimed_quantity !== null && review.claimed_quantity !== undefined],
    ["Evidence reviewed", Boolean(review.evidence_status)],
    ["Location reviewed", Boolean(review.location_status)],
    ["Documentation reviewed", Boolean(review.documentation_status)],
    ["Quantity decision made", ["approved", "rejected", "correction_required"].includes(String(review.review_status))],
    ["Correction path clear if required", review.review_status !== "correction_required" || Boolean(review.correction_reason)],
    ["Billable candidate quantity reviewed", review.billable_candidate_quantity !== null && review.billable_candidate_quantity !== undefined],
    ["No finance created", true],
  ];
}

function qcReview(detail: QcDetailShape): SyncRecord {
  return detail.qc_review ?? (detail as SyncRecord);
}

function arrayValue(value: unknown): SyncRecord[] {
  return Array.isArray(value) ? value as SyncRecord[] : [];
}

function boolMismatch(actual: boolean, expected: string) {
  return (expected === "true" && !actual) || (expected === "false" && actual);
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
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.production_type, String(row.id))]));
}

function overrideReasons(form: Record<string, string>) {
  return prune({
    admin_override_reason: form.approval_override_reason,
    override_reason: form.approval_override_reason,
  });
}

function projectLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/projects/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function workOrderLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/work-orders/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function productionLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/production/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function organizationLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/intelligence/organizations/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function actionNotice(type: string) {
  if (type === "approve") return "QC review approved. No billable item, settlement, invoice, AR, payment, cash, payroll, or tax record was created.";
  if (type === "reject") return "QC review rejected.";
  if (type === "correction") return "Correction requested.";
  if (type === "corrected") return "Correction marked corrected.";
  return "QC action completed.";
}

function plainError(message: string) {
  if (!message) return "QC action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("not found")) return "QC review not found or you do not have access.";
  if (message.includes("production")) return "Production record is not eligible for QC review.";
  if (message.includes("self")) return "Reviewer cannot approve their own production without override.";
  if (message.includes("approved_quantity")) return "Approved quantity cannot exceed claimed quantity without override.";
  if (message.includes("billable_candidate_quantity")) return "Billable candidate quantity cannot exceed approved quantity without override.";
  if (message.includes("rejection")) return "Rejection reason is required.";
  if (message.includes("correction")) return "Correction reason is required.";
  if (message.includes("void")) return "Void reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

const qcDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "qc_review.read",
  "qc_review.create",
  "qc_review.update",
  "qc_review.start",
  "qc_review.approve",
  "qc_review.reject",
  "qc_review.request_correction",
  "qc_review.mark_corrected",
  "qc_review.void",
  "qc_review.archive",
  "qc_review.timeline.read",
  "qc_review.audit.read",
  "production.read",
  "production_record.read",
  "work_order.read",
  "project.read",
  "billable_item.read",
];

const emptyRelated: RelatedData = { productionRecords: [], billableItems: [] };
