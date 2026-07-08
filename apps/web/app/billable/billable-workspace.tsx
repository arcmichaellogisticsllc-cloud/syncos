"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, type ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const readinessStatuses = ["not_ready", "needs_review", "ready_with_warning", "ready_for_settlement", "blocked"];
const rateSources = ["contract_rate", "project_rate", "customer_rate", "manual_rate", "unknown"];
const rateConfidences = ["unknown", "low", "medium", "high", "confirmed"];
const acceptanceStatuses = ["not_required", "pending", "accepted", "rejected", "correction_required", "disputed"];
const packageStatuses = ["not_started", "incomplete", "ready", "submitted_later", "accepted_later", "rejected_later"];
const tabs = ["overview", "qc", "production", "work_order", "project", "quantity_amount", "rate", "documentation", "acceptance", "retainage", "holds_disputes", "timeline", "audit", "future_settlement", "future_invoice"];

type BillableDetailShape = {
  billable_item?: SyncRecord;
  project_context?: SyncRecord | null;
  work_order_context?: SyncRecord | null;
  production_context?: SyncRecord | null;
  qc_context?: SyncRecord | null;
  customer_context?: SyncRecord | null;
  provider_context?: SyncRecord;
  quantity_summary?: SyncRecord;
  rate_summary?: SyncRecord;
  acceptance_summary?: SyncRecord;
  billing_package_summary?: SyncRecord;
  retainage_summary?: SyncRecord;
  readiness?: SyncRecord;
  warnings?: SyncRecord[];
  blockers?: SyncRecord[];
  required_override_fields?: unknown[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  qcReviews: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function BillableQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [activeQueue, setActiveQueue] = useState("ready_for_review");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("archived", filters.archived === "true" ? "true" : "false");
      for (const key of ["project_id", "work_order_id", "production_record_id", "qc_review_id", "status", "readiness_status", "customer_organization_id", "capacity_provider_id", "crew_id", "customer_acceptance_status", "prime_acceptance_status", "billing_package_status", "documentation_status", "rate_source", "rate_confidence", "retainage_required", "q"]) if (filters[key]) query.set(key, filters[key]);
      if (filters.sort) query.set("sort", filters.sort);
      setRows(await syncosFetch<SyncRecord[]>(`/billable-items?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortBillable(rows.filter((row) => matchesFilters(row, filters)).filter((row) => matchesBillableQueue(row, activeQueue)), filters.sort), [rows, filters, activeQueue]);
  const queueCards = billableQueues.map((queue) => ({ ...queue, value: rows.filter((row) => matchesBillableQueue(row, queue.id)).length }));
  const activeQueueLabel = queueCards.find((queue) => queue.id === activeQueue)?.label ?? "Ready for Review";

  function selectQueue(queueId: string) {
    setActiveQueue(queueId);
    setFilters({ ...filters, archived: queueId === "archived" ? "true" : "false" });
  }

  return (
    <BillableShell title="Billable Workbench" purpose="Review approved production and QC-cleared work, resolve billing blockers, and prepare billable items for settlement workflow.">
      <SessionPanel session={session} />
      <div className="warning-box">Billable readiness does not create a settlement, invoice, cash receipt, payment application, accounting export, or external accounting entry.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Login required. Sign in to review billable readiness and settlement blockers.</div> : null}
      {loading ? <div className="empty-state">Loading billable items...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel operator-queue-hero">
            <div className="section-toolbar">
              <div>
                <h2>What work is ready to become billable, and what is blocking settlement readiness?</h2>
                <p className="muted">Finance work is prioritized by holds, disputes, missing support, readiness, and recent updates.</p>
              </div>
              <div className="form-actions">
                <Link className="primary-button" href={firstHref(visible, "/billable")} aria-disabled={!visible.length}>Review Next Billable Item</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => row.status === "held"), "/billable")} aria-disabled={!rows.some((row) => row.status === "held")}>Open Holds</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => row.status === "disputed"), "/billable")} aria-disabled={!rows.some((row) => row.status === "disputed")}>Open Disputes</Link>
                <Link className="link-button" href="/billable/new" aria-disabled={!hasPermission(session.permissions, "billable_item.create")}>Create Billable Candidate</Link>
              </div>
            </div>
            <div className="summary-grid">
              {queueCards.map((queue) => <SummaryCard key={queue.id} label={queue.label} value={queue.value} helper={queue.helper} active={activeQueue === queue.id} onClick={() => selectQueue(queue.id)} />)}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{activeQueueLabel}</h2>
                <p className="muted">{emptyBillableQueue(activeQueue)}</p>
              </div>
              <button type="button" onClick={() => { setActiveQueue("ready_for_review"); setFilters({ archived: "false", sort: "updated_desc" }); }}>Reset</button>
            </div>
            <div className="queue-tabs" role="tablist" aria-label="Billable queues">
              {billableQueues.map((queue) => <button key={queue.id} type="button" role="tab" aria-selected={activeQueue === queue.id} className={activeQueue === queue.id ? "active" : ""} onClick={() => selectQueue(queue.id)}>{queue.label}</button>)}
            </div>
            <details className="filter-drawer">
              <summary aria-label="Advanced filters drawer">Advanced filters</summary>
              <div className="filter-grid">
                <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search billable, project, work order, customer" />
                <input value={filters.project_id ?? ""} onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} placeholder="Project" />
                <input value={filters.work_order_id ?? ""} onChange={(event) => setFilters({ ...filters, work_order_id: event.target.value })} placeholder="Work Order" />
                <input value={filters.production_record_id ?? ""} onChange={(event) => setFilters({ ...filters, production_record_id: event.target.value })} placeholder="Production record" />
                <input value={filters.qc_review_id ?? ""} onChange={(event) => setFilters({ ...filters, qc_review_id: event.target.value })} placeholder="QC review" />
                <Select label="Readiness status" value={filters.readiness_status ?? ""} options={["", ...readinessStatuses]} onChange={(readiness_status) => setFilters({ ...filters, readiness_status })} />
                <Select label="Rate source" value={filters.rate_source ?? ""} options={["", ...rateSources]} onChange={(rate_source) => setFilters({ ...filters, rate_source })} />
                <Select label="Rate confidence" value={filters.rate_confidence ?? ""} options={["", ...rateConfidences]} onChange={(rate_confidence) => setFilters({ ...filters, rate_confidence })} />
                <Select label="Has hold" value={filters.hasHold ?? ""} options={["", "true", "false"]} onChange={(hasHold) => setFilters({ ...filters, hasHold })} />
                <Select label="Has dispute" value={filters.hasDispute ?? ""} options={["", "true", "false"]} onChange={(hasDispute) => setFilters({ ...filters, hasDispute })} />
                <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "readiness_asc", "readiness_desc", "amount_desc", "status", "project", "customer"]} labels={{ updated_desc: "Recently updated", readiness_asc: "Lowest readiness", readiness_desc: "Highest readiness", amount_desc: "Amount highest", status: "Status", project: "Project", customer: "Customer" }} onChange={(sort) => setFilters({ ...filters, sort })} />
              </div>
            </details>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Billable Items</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No billable items yet. Create a billable candidate from an approved QC review.</div> : visible.length ? <BillableTable rows={visible} /> : <div className="empty-state">{emptyBillableQueue(activeQueue)}</div>}
          </section>
        </>
      ) : null}
    </BillableShell>
  );
}

export function BillableCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ rate_source: "unknown", rate_confidence: "unknown", customer_acceptance_status: "not_required", prime_acceptance_status: "not_required", billing_package_status: "not_started", documentation_status: "not_started", retainage_required: "false" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/billable-items", { method: "POST", body: buildBillablePayload(form, true), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const item = after?.billable_item as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? item?.id ?? after?.id ?? "");
      router.push(id ? `/billable/${id}` : "/billable");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <BillableShell title="Create Billable Candidate" purpose="Create a financial eligibility candidate from approved QC without creating settlement, invoice, AR, payment, cash, payroll, or tax records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Backend validation requires approved QC and approved production, blocks duplicates unless overridden, and writes event/audit/system_action records.</div>
        <BillableFormFields form={form} setForm={setForm} related={related} includeCreate />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "billable_item.create")}>Create Billable Candidate</button>
          <Link className="link-button" href="/billable">Cancel</Link>
        </div>
      </form>
    </BillableShell>
  );
}

export function BillableEdit({ billableId }: { billableId: string }) {
  const router = useRouter();
  const session = useSession();
  const [detail, setDetail] = useState<BillableDetailShape | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const next = await syncosFetch<BillableDetailShape>(`/billable-items/${billableId}/detail`, { token: session.token });
        const item = billableItem(next);
        setDetail(next);
        setForm({
          billable_quantity: String(item.billable_quantity ?? ""),
          rate_code_id: String(item.rate_code_id ?? ""),
          rate_description: String(item.rate_description ?? ""),
          unit_rate: String(item.unit_rate ?? ""),
          rate_source: String(item.rate_source ?? "unknown"),
          rate_confidence: String(item.rate_confidence ?? "unknown"),
          customer_acceptance_status: String(item.customer_acceptance_status ?? "not_required"),
          prime_acceptance_status: String(item.prime_acceptance_status ?? "not_required"),
          billing_package_status: String(item.billing_package_status ?? "not_started"),
          documentation_status: String(item.documentation_status ?? "not_started"),
          retainage_required: String(Boolean(item.retainage_required)),
          retainage_percent: String(item.retainage_percent ?? ""),
          retainage_release_condition: String(item.retainage_release_condition ?? ""),
          hold_note: String(item.hold_note ?? ""),
          dispute_note: String(item.dispute_note ?? ""),
          override_reasons: jsonText(item.override_reasons),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, billableId]);

  const item = detail ? billableItem(detail) : null;
  const readOnly = item ? ["voided", "archived", "settlement_created"].includes(String(item.status)) : true;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/billable-items/${billableId}`, { method: "PATCH", body: buildBillablePayload(form, false), token: session.token });
      router.push(`/billable/${billableId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <BillableShell title="Edit Billable Item" purpose="Edit supported billable readiness fields without bypassing lifecycle action routes.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!item ? <div className="empty-state">Billable item not found or you do not have access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Status changes use lifecycle routes. Voided, archived, and settlement-created items are backend read-only.</div>
          <BillableFormFields form={form} setForm={setForm} related={emptyRelated} disabled={readOnly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readOnly || !hasPermission(session.permissions, "billable_item.update")}>Save Billable Item</button>
            <Link className="link-button" href={`/billable/${billableId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </BillableShell>
  );
}

export function BillableDetail({ billableId }: { billableId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<BillableDetailShape | null>(null);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const [next, timeline, audit] = await Promise.all([
        syncosFetch<BillableDetailShape>(`/billable-items/${billableId}/detail`, { token: session.token }),
        optionalList(`/billable-items/${billableId}/timeline`, session.token),
        optionalList(`/billable-items/${billableId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, billableId]);

  const item = detail ? billableItem(detail) : null;
  const warnings = detail?.warnings ?? arrayValue(item?.warnings);
  const blockers = detail?.blockers ?? arrayValue(item?.blockers);

  return (
    <BillableShell title="Billable Detail" purpose="Show financial eligibility truth, readiness, source context, timeline, and audit without creating finance records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Billable Detail.</div> : null}
      {!item && session.token && !error ? <div className="empty-state">Billable item not found or you do not have access.</div> : null}
      {item && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{formatAction(item.status)}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(item.readiness_status)}</span>
                  <span className="badge">{formatCell(item.readiness_score)}</span>
                  <span className="badge">{formatAction(item.rate_source)}</span>
                  <span className="badge">{formatAction(item.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/billable/${billableId}/edit`} aria-disabled={!hasPermission(session.permissions, "billable_item.update")}>Edit Billable Item</Link>
                <ActionButton permission="billable_item.recalculate_readiness" session={session} disabled={viewOnly(item)} onClick={() => setModal("recalculate")}>Recalculate Readiness</ActionButton>
                <ActionButton permission="billable_item.mark_ready" session={session} disabled={viewOnly(item) || ["held", "disputed"].includes(String(item.status)) || blockers.length > 0} onClick={() => setModal("ready")}>Mark Ready For Settlement</ActionButton>
                <ActionButton permission="billable_item.place_hold" session={session} disabled={viewOnly(item) || String(item.status) === "held"} onClick={() => setModal("hold")}>Place Hold</ActionButton>
                <ActionButton permission="billable_item.release_hold" session={session} disabled={String(item.status) !== "held"} onClick={() => setModal("release")}>Release Hold</ActionButton>
                <ActionButton permission="billable_item.dispute" session={session} disabled={viewOnly(item) || String(item.status) === "disputed"} onClick={() => setModal("dispute")}>Dispute</ActionButton>
                <ActionButton permission="billable_item.resolve_dispute" session={session} disabled={String(item.status) !== "disputed"} onClick={() => setModal("resolve")}>Resolve Dispute</ActionButton>
                <ActionButton permission="billable_item.void" session={session} disabled={viewOnly(item) || Boolean(item.settlement_item_id)} onClick={() => setModal("void")}>Void</ActionButton>
                <ActionButton permission="billable_item.archive" session={session} disabled={String(item.status) === "archived"} onClick={() => setModal("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Readiness Score" value={formatCell(item.readiness_score)} />
              <Metric label="Readiness Status" value={formatAction(item.readiness_status)} />
              <Metric label="Approved Quantity" value={quantity(item.approved_quantity, item.unit)} />
              <Metric label="Billable Quantity" value={quantity(item.billable_quantity, item.unit)} />
              <Metric label="Held Quantity" value={quantity(item.held_quantity, item.unit)} />
              <Metric label="Unit Rate" value={money(item.unit_rate)} />
              <Metric label="Estimated Billable Amount" value={money(item.estimated_billable_amount)} />
              <Metric label="Retainage Amount" value={money(item.retainage_amount)} />
              <Metric label="Net Billable Amount" value={money(item.net_billable_amount)} />
              <Metric label="Customer Acceptance" value={formatAction(item.customer_acceptance_status)} />
              <Metric label="Prime Acceptance" value={formatAction(item.prime_acceptance_status)} />
              <Metric label="Billing Package Status" value={formatAction(item.billing_package_status)} />
              <Metric label="Documentation Status" value={formatAction(item.documentation_status)} />
              <Metric label="Recommended Next Action" value={formatAction(item.recommended_next_action ?? detail.recommended_next_action)} />
            </div>
            <div className="warning-box">Billable does not create settlement. Ready for settlement does not create invoice. Cash begins later after invoice and payment.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Project</dt><dd>{projectLink(item.project_id, item.project_name ?? detail.project_context?.name)}</dd>
                <dt>Work Order</dt><dd>{workOrderLink(item.work_order_id, item.work_order_name ?? detail.work_order_context?.work_order_name)}</dd>
                <dt>Production</dt><dd>{productionLink(item.production_record_id, item.production_type)}</dd>
                <dt>QC Review</dt><dd>{qcLink(item.qc_review_id, item.qc_review_status ?? detail.qc_context?.review_type)}</dd>
                <dt>Customer</dt><dd>{organizationLink(item.customer_organization_id, item.customer_organization_name ?? detail.customer_context?.name)}</dd>
                <dt>Provider</dt><dd>{textValue(item.capacity_provider_name ?? item.capacity_provider_id)}</dd>
                <dt>Crew</dt><dd>{textValue(item.crew_name ?? item.crew_id)}</dd>
                <dt>Status</dt><dd>{formatAction(item.status)}</dd>
                <dt>Readiness</dt><dd>{formatAction(item.readiness_status)} / {formatCell(item.readiness_score)}</dd>
                <dt>Rate state</dt><dd>{formatAction(item.rate_source)} / {formatAction(item.rate_confidence)}</dd>
                <dt>Documentation state</dt><dd>{formatAction(item.documentation_status)}</dd>
                <dt>Acceptance state</dt><dd>{formatAction(item.customer_acceptance_status)} / {formatAction(item.prime_acceptance_status)}</dd>
                <dt>Retainage state</dt><dd>{item.retainage_required ? "Applies" : "Not required"}</dd>
                <dt>Hold/dispute state</dt><dd>{textValue(item.hold_reason ?? item.dispute_reason, "No hold or dispute")}</dd>
              </dl>
              <Checklist items={billableChecklist(item)} />
              <WarningList title="Key Blockers" rows={blockers.slice(0, 4)} empty="No blockers returned." />
              <WarningList title="Key Warnings" rows={warnings.slice(0, 4)} empty="No warnings returned." />
              <div className="warning-box">Settlement is not available in this sprint.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <BillableTab tab={tab} detail={detail} item={item} />
            </section>
          </div>
          {modal ? <BillableLifecycleModal type={modal} billableId={billableId} item={item} blockers={blockers} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </BillableShell>
  );
}

function BillableShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/billable", "Billable Queue", "active"],
    ["/billable/new", "Create Billable Candidate", "active"],
    ["#detail", "Billable Detail", "placeholder"],
    ["#qc", "Source QC Context", "placeholder"],
    ["#production", "Production Context", "placeholder"],
    ["#work-order", "Work Order Context", "placeholder"],
    ["#project", "Project Context", "placeholder"],
    ["#quantity", "Quantity & Amount", "placeholder"],
    ["#rate", "Rate Readiness", "placeholder"],
    ["#documentation", "Documentation Readiness", "placeholder"],
    ["#acceptance", "Customer / Prime Acceptance", "placeholder"],
    ["#retainage", "Retainage", "placeholder"],
    ["#holds", "Holds & Disputes", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-settlement", "Future Settlement", "placeholder"],
    ["#future-invoice", "Future Invoice", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Billable</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function BillableTable({ rows }: { rows: SyncRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Billable Item", "Source Production / Work Order", "Customer / Project", "Quantity / Amount", "Readiness", "Hold Status", "Dispute Status", "Settlement Status", "Age / Updated", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>
                <Link className="table-link" href={`/billable/${row.id}`}>{formatAction(row.status)}</Link>
                <div className="cell-helper">{formatAction(row.rate_source)} / {formatAction(row.rate_confidence)}</div>
              </td>
              <td>
                {productionLink(row.production_record_id, row.production_type)}
                <div className="cell-helper">{workOrderLink(row.work_order_id, row.work_order_name ?? row.work_order_number)}</div>
              </td>
              <td>
                {organizationLink(row.customer_organization_id, row.customer_organization_name)}
                <div className="cell-helper">{projectLink(row.project_id, row.project_name)}</div>
              </td>
              <td>
                {quantity(row.billable_quantity, row.unit)}
                <div className="cell-helper">{money(row.net_billable_amount ?? row.estimated_billable_amount)}</div>
              </td>
              <td>
                {formatAction(row.readiness_status)}
                <div className="cell-helper">Score {formatCell(row.readiness_score)}</div>
              </td>
              <td>{row.status === "held" || row.hold_reason ? formatAction(row.hold_reason ?? "On hold") : "No hold"}</td>
              <td>{row.status === "disputed" || row.dispute_reason ? formatAction(row.dispute_reason ?? "Disputed") : "No dispute"}</td>
              <td>{row.settlement_item_id ? "Settlement item linked" : formatAction(row.status === "ready_for_settlement" ? "Ready for settlement" : "Not ready yet")}</td>
              <td>{dateValue(row.updated_at)}</td>
              <td>{nextBillableAction(row)}</td>
              <td><Link className="link-button" href={`/billable/${row.id}`}>Open Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillableTab({ tab, detail, item }: { tab: string; detail: BillableDetailShape; item: SyncRecord }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Status</dt><dd>{formatAction(item.status)}</dd><dt>Readiness status</dt><dd>{formatAction(item.readiness_status)}</dd><dt>Readiness score</dt><dd>{formatCell(item.readiness_score)}</dd><dt>Readiness band</dt><dd>{formatAction(item.readiness_band)}</dd><dt>Warnings</dt><dd><JsonBlock value={detail.warnings ?? item.warnings} /></dd><dt>Blockers</dt><dd><JsonBlock value={detail.blockers ?? item.blockers} /></dd><dt>Required override fields</dt><dd><JsonBlock value={detail.required_override_fields ?? item.required_override_fields} /></dd><dt>Recommended next action</dt><dd>{formatAction(item.recommended_next_action ?? detail.recommended_next_action)}</dd><dt>Override reasons</dt><dd><JsonBlock value={item.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(item.created_at)}</dd><dt>Updated</dt><dd>{dateValue(item.updated_at)}</dd></dl><div className="warning-box">This billable item represents accepted work that may be financially eligible for future settlement or invoicing. It does not create settlement, invoice, AR, payment, cash, payroll, or tax records.</div></Panel>;
  if (tab === "qc") return <ContextPanel title="QC Context" record={detail.qc_context} href={item.qc_review_id ? `/qc/${item.qc_review_id}` : undefined} fields={["review_status", "review_type", "claimed_quantity", "approved_quantity", "rejected_quantity", "correction_required_quantity", "billable_candidate_quantity", "unit", "customer_acceptance_status", "prime_acceptance_status"]} />;
  if (tab === "production") return <ContextPanel title="Production Context" record={detail.production_context} href={item.production_record_id ? `/production/${item.production_record_id}` : undefined} fields={["production_type", "status", "qc_status", "billable_status", "production_date", "claimed_quantity", "approved_quantity", "rejected_quantity", "billable_quantity", "evidence_count", "location_summary"]} />;
  if (tab === "work_order") return <ContextPanel title="Work Order Context" record={detail.work_order_context} href={item.work_order_id ? `/work-orders/${item.work_order_id}` : undefined} fields={["work_order_name", "status", "planned_quantity", "completed_quantity", "approved_quantity", "billable_quantity", "unit", "assignment_type", "assigned_capacity_provider_id", "assigned_crew_id"]} />;
  if (tab === "project") return <ContextPanel title="Project Context" record={detail.project_context} href={item.project_id ? `/projects/${item.project_id}` : undefined} fields={["name", "project_name", "status", "customer_organization_id", "territory_id", "work_type", "project_manager_user_id", "field_supervisor_user_id"]} />;
  if (tab === "quantity_amount") return <Panel title="Quantity & Amount"><dl className="detail-list"><dt>Approved quantity</dt><dd>{quantity(item.approved_quantity, item.unit)}</dd><dt>Billable quantity</dt><dd>{quantity(item.billable_quantity, item.unit)}</dd><dt>Held quantity</dt><dd>{quantity(item.held_quantity, item.unit)}</dd><dt>Rejected quantity</dt><dd>{quantity(item.rejected_quantity, item.unit)}</dd><dt>Correction quantity</dt><dd>{quantity(item.correction_quantity, item.unit)}</dd><dt>Unit</dt><dd>{formatAction(item.unit)}</dd><dt>Unit rate</dt><dd>{money(item.unit_rate)}</dd><dt>Estimated billable amount</dt><dd>{money(item.estimated_billable_amount)}</dd><dt>Retainage amount</dt><dd>{money(item.retainage_amount)}</dd><dt>Net billable amount</dt><dd>{money(item.net_billable_amount)}</dd></dl><div className="warning-box">Approved quantity comes from QC. Billable quantity is financial eligibility. Held quantity is not immediately billable. Net amount is estimate only until Settlement/Invoice layers.</div></Panel>;
  if (tab === "rate") return <Panel title="Rate Readiness"><dl className="detail-list"><dt>Rate code</dt><dd>{textValue(item.rate_code_id)}</dd><dt>Rate description</dt><dd>{textValue(item.rate_description)}</dd><dt>Unit rate</dt><dd>{money(item.unit_rate)}</dd><dt>Rate source</dt><dd>{formatAction(item.rate_source)}</dd><dt>Rate confidence</dt><dd>{formatAction(item.rate_confidence)}</dd><dt>Rate warnings</dt><dd><JsonBlock value={(detail.warnings ?? []).filter((row) => String(row.warning_type ?? row.blocker_type ?? "").includes("rate"))} /></dd><dt>Manual rate warning</dt><dd>{item.rate_source === "manual_rate" ? "Manual rate requires review." : "Not applicable"}</dd><dt>Unknown rate warning</dt><dd>{item.rate_source === "unknown" ? "Unknown rate blocks readiness unless overridden." : "Not applicable"}</dd></dl><div className="warning-box">No pricing engine is available in this sprint. Rates are readiness context only.</div></Panel>;
  if (tab === "documentation") return <Panel title="Documentation Readiness"><dl className="detail-list"><dt>Billing package status</dt><dd>{formatAction(item.billing_package_status)}</dd><dt>Documentation status</dt><dd>{formatAction(item.documentation_status)}</dd><dt>Missing documentation warnings</dt><dd><JsonBlock value={(detail.warnings ?? []).filter((row) => String(row.warning_type ?? row.blocker_type ?? "").includes("documentation") || String(row.warning_type ?? row.blocker_type ?? "").includes("billing_package"))} /></dd><dt>Billing package readiness note</dt><dd>{formatAction(item.billing_package_status)}</dd></dl><div className="warning-box">PDF billing package generation is not available in this sprint.</div></Panel>;
  if (tab === "acceptance") return <Panel title="Customer / Prime Acceptance"><dl className="detail-list"><dt>Customer acceptance status</dt><dd>{formatAction(item.customer_acceptance_status)}</dd><dt>Prime acceptance status</dt><dd>{formatAction(item.prime_acceptance_status)}</dd><dt>Acceptance warnings/blockers</dt><dd><JsonBlock value={[...(detail.warnings ?? []), ...(detail.blockers ?? [])].filter((row) => String(row.warning_type ?? row.blocker_type ?? "").includes("acceptance") || String(row.warning_type ?? row.blocker_type ?? "").includes("customer") || String(row.warning_type ?? row.blocker_type ?? "").includes("prime"))} /></dd></dl><div className="warning-box">No customer or prime portal is available in this sprint.</div></Panel>;
  if (tab === "retainage") return <Panel title="Retainage"><dl className="detail-list"><dt>Retainage required</dt><dd>{item.retainage_required ? "Yes" : "No"}</dd><dt>Retainage percent</dt><dd>{formatCell(item.retainage_percent)}</dd><dt>Retainage amount</dt><dd>{money(item.retainage_amount)}</dd><dt>Retainage release condition</dt><dd>{textValue(item.retainage_release_condition)}</dd><dt>Net billable amount</dt><dd>{money(item.net_billable_amount)}</dd></dl><div className="warning-box">Retainage is estimated here. Formal retainage ledgering belongs to a future Settlement/Finance sprint.</div></Panel>;
  if (tab === "holds_disputes") return <Panel title="Holds & Disputes"><dl className="detail-list"><dt>Hold reason</dt><dd>{textValue(item.hold_reason)}</dd><dt>Hold note</dt><dd>{textValue(item.hold_note)}</dd><dt>Dispute reason</dt><dd>{textValue(item.dispute_reason)}</dd><dt>Dispute note</dt><dd>{textValue(item.dispute_note)}</dd><dt>Current status</dt><dd>{formatAction(item.status)}</dd><dt>Resolution state</dt><dd>{item.status === "held" || item.status === "disputed" ? "Open" : "No open hold or dispute"}</dd></dl></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor_name", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor_name", "action", "object_type", "object_id", "before_json", "after_json", "reason", "created_at", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view billable audit details.</div>}</Panel>;
  if (tab === "future_settlement") return <PlaceholderPanel title="Future Settlement" message="Settlement is not available in this sprint. A future Settlement layer will convert ready billable items into settlement items after rules are approved." columns={["settlement_item", "status", "quantity", "amount", "approval"]} />;
  return <PlaceholderPanel title="Future Invoice" message="Invoice creation is not available in this sprint. Invoice, AR, Payment, Cash, Payroll, and Tax workflows are future finance layers." columns={["invoice_item", "invoice", "AR", "payment", "cash", "status"]} />;
}

function BillableLifecycleModal({ type, billableId, item, blockers, session, onClose, onSaved }: { type: string; billableId: string; item: SyncRecord; blockers: SyncRecord[]; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const title = modalTitle(type);
  const blockedReady = type === "ready" && blockers.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blockedReady) return;
    setError("");
    try {
      await syncosFetch(`/billable-items/${billableId}/${modalPath(type)}`, { method: "POST", body: modalBody(type, form), token: session.token });
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
        {type === "ready" && blockedReady ? <div className="error-banner">Billable blockers must be resolved before this action.</div> : null}
        {type === "ready" ? <><label>Approval note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><label>Override reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><WarningList title="Warnings" rows={arrayValue(item.warnings)} empty="No warnings returned." /><WarningList title="Blockers" rows={blockers} empty="No blockers returned." /></> : null}
        {type === "hold" ? <><label>Hold reason<textarea value={form.hold_reason ?? ""} onChange={(event) => setForm({ ...form, hold_reason: event.target.value })} required /></label><label>Hold note<textarea value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label></> : null}
        {type === "release" ? <label>Release note<textarea value={form.release_note ?? ""} onChange={(event) => setForm({ ...form, release_note: event.target.value })} required /></label> : null}
        {type === "dispute" ? <><label>Dispute reason<textarea value={form.dispute_reason ?? ""} onChange={(event) => setForm({ ...form, dispute_reason: event.target.value })} required /></label><label>Dispute note<textarea value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}
        {type === "resolve" ? <><label>Resolution note<textarea value={form.resolution_note ?? ""} onChange={(event) => setForm({ ...form, resolution_note: event.target.value })} required /></label><label>Override reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label></> : null}
        {type === "void" ? <><label>Void reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {type === "archive" ? <><label>Archive reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {type === "recalculate" ? <div className="warning-box">This recalculates backend readiness only.</div> : null}
        <div className="warning-box">This action uses the backend route and creates no settlement, settlement item, invoice, AR, payment, cash, payroll, or tax record.</div>
        <div className="form-actions"><button className="primary-button" type="submit" disabled={blockedReady}>{title}</button></div>
      </form>
    </div>
  );
}

function BillableFormFields({ form, setForm, related, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeCreate?: boolean; disabled?: boolean }) {
  return (
    <div className="form-grid">
      {includeCreate ? <label>QC Review<SelectInline value={form.qc_review_id ?? ""} options={["", ...related.qcReviews.map((row) => String(row.id))]} labels={labelsFor(related.qcReviews, "review_type")} onChange={(qc_review_id) => setForm({ ...form, qc_review_id })} /></label> : null}
      <label>Billable Quantity<input disabled={disabled} type="number" min="0" value={form.billable_quantity ?? ""} onChange={(event) => setForm({ ...form, billable_quantity: event.target.value })} /></label>
      <label>Rate Code ID<input disabled={disabled} value={form.rate_code_id ?? ""} onChange={(event) => setForm({ ...form, rate_code_id: event.target.value })} /></label>
      <label>Rate Description<input disabled={disabled} value={form.rate_description ?? ""} onChange={(event) => setForm({ ...form, rate_description: event.target.value })} /></label>
      <label>Unit Rate<input disabled={disabled} type="number" min="0" value={form.unit_rate ?? ""} onChange={(event) => setForm({ ...form, unit_rate: event.target.value })} /></label>
      <Select label="Rate Source" value={form.rate_source ?? "unknown"} options={rateSources} onChange={(rate_source) => setForm({ ...form, rate_source })} disabled={disabled} />
      <Select label="Rate Confidence" value={form.rate_confidence ?? "unknown"} options={rateConfidences} onChange={(rate_confidence) => setForm({ ...form, rate_confidence })} disabled={disabled} />
      <Select label="Customer Acceptance Status" value={form.customer_acceptance_status ?? "not_required"} options={acceptanceStatuses} onChange={(customer_acceptance_status) => setForm({ ...form, customer_acceptance_status })} disabled={disabled} />
      <Select label="Prime Acceptance Status" value={form.prime_acceptance_status ?? "not_required"} options={acceptanceStatuses} onChange={(prime_acceptance_status) => setForm({ ...form, prime_acceptance_status })} disabled={disabled} />
      <Select label="Billing Package Status" value={form.billing_package_status ?? "not_started"} options={packageStatuses} onChange={(billing_package_status) => setForm({ ...form, billing_package_status })} disabled={disabled} />
      <Select label="Documentation Status" value={form.documentation_status ?? "not_started"} options={packageStatuses} onChange={(documentation_status) => setForm({ ...form, documentation_status })} disabled={disabled} />
      <Select label="Retainage Required" value={form.retainage_required ?? "false"} options={["false", "true"]} onChange={(retainage_required) => setForm({ ...form, retainage_required })} disabled={disabled} />
      <label>Retainage Percent<input disabled={disabled} type="number" min="0" max="100" value={form.retainage_percent ?? ""} onChange={(event) => setForm({ ...form, retainage_percent: event.target.value })} /></label>
      <label>Retainage Release Condition<textarea disabled={disabled} value={form.retainage_release_condition ?? ""} onChange={(event) => setForm({ ...form, retainage_release_condition: event.target.value })} /></label>
      <label>Hold Note<textarea disabled={disabled} value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label>
      <label>Dispute Note<textarea disabled={disabled} value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label>
      <label>Override Reasons JSON<textarea disabled={disabled} value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>
    </div>
  );
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test billable actions.</p></div><button type="button" onClick={session.applyDefaults}>Use billable defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>([]);
  useEffect(() => {
    setTokenState(readToken());
    setPermissionsState(readPermissions().length ? readPermissions() : billableDefaultPermissions);
  }, []);
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  return { token, permissions, setToken, setPermissions, applyDefaults: () => setPermissions(billableDefaultPermissions) };
}

function buildBillablePayload(form: Record<string, string>, includeCreate: boolean) {
  return prune({
    ...(includeCreate ? { qc_review_id: form.qc_review_id } : {}),
    billable_quantity: form.billable_quantity,
    rate_code_id: form.rate_code_id,
    rate_description: form.rate_description,
    unit_rate: form.unit_rate,
    rate_source: form.rate_source,
    rate_confidence: form.rate_confidence,
    customer_acceptance_status: form.customer_acceptance_status,
    prime_acceptance_status: form.prime_acceptance_status,
    billing_package_status: form.billing_package_status,
    documentation_status: form.documentation_status,
    retainage_required: form.retainage_required === "true",
    retainage_percent: form.retainage_percent,
    retainage_release_condition: form.retainage_release_condition,
    hold_note: form.hold_note,
    dispute_note: form.dispute_note,
    override_reasons: parseJsonField(form.override_reasons, "override_reasons"),
  });
}

function modalBody(type: string, form: Record<string, string>) {
  if (type === "ready") return prune({ approval_note: form.approval_note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "hold") return prune({ hold_reason: form.hold_reason, hold_note: form.hold_note });
  if (type === "release") return prune({ release_note: form.release_note });
  if (type === "dispute") return prune({ dispute_reason: form.dispute_reason, dispute_note: form.dispute_note });
  if (type === "resolve") return prune({ resolution_note: form.resolution_note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "void") return prune({ void_reason: form.void_reason, void_note: form.void_note });
  if (type === "archive") return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
  return {};
}

function modalPath(type: string) {
  if (type === "ready") return "mark-ready-for-settlement";
  if (type === "hold") return "place-hold";
  if (type === "release") return "release-hold";
  if (type === "resolve") return "resolve-dispute";
  if (type === "recalculate") return "recalculate-readiness";
  return type;
}

function modalTitle(type: string) {
  if (type === "ready") return "Mark Ready For Settlement";
  if (type === "hold") return "Place Hold";
  if (type === "release") return "Release Hold";
  if (type === "resolve") return "Resolve Dispute";
  if (type === "recalculate") return "Recalculate Readiness";
  return formatAction(type);
}

async function loadRelated(token: string): Promise<RelatedData> {
  const qcReviews = await optionalList("/qc-reviews?review_status=approved&archived=false", token);
  return { qcReviews };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="workspace-panel"><h2>{title}</h2>{children}</section>;
}

function SummaryCard({ label, value, helper, active = false, onClick }: { label: string; value: number; helper?: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={`summary-card ${active ? "active-summary-card" : ""}`} aria-pressed={active} onClick={onClick}><span>{label}</span><strong>{value}</strong>{helper ? <small>{helper}</small> : null}</button>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="summary-card" role="group"><span>{label}</span><strong>{value}</strong></div>;
}

function ActionButton({ permission, session, disabled, onClick, children }: { permission: string; session: Session; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || !hasPermission(session.permissions, permission)} onClick={onClick}>{children}</button>;
}

function Select({ label, value, options, labels = {}, onChange, disabled = false }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>{label}<SelectInline value={value} options={options} labels={labels} onChange={onChange} disabled={disabled} /></label>;
}

function SelectInline({ value, options, labels = {}, onChange, disabled = false }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void; disabled?: boolean }) {
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? (option ? formatAction(option) : "Any")}</option>)}</select>;
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

const billableQueues = [
  { id: "ready_for_review", label: "Ready for Review", helper: "Approved or submitted work that finance needs to inspect." },
  { id: "on_hold", label: "On Hold", helper: "Billable items blocked by hold status or missing prerequisite." },
  { id: "disputed", label: "Disputed", helper: "Items with dispute state requiring resolution before settlement readiness." },
  { id: "ready_for_settlement", label: "Ready for Settlement", helper: "Billable items that can move toward settlement workflow." },
  { id: "missing_support", label: "Missing Support", helper: "Items missing source context, approval support, or readiness data." },
  { id: "archived", label: "Archived", helper: "Closed or removed billable records." },
];

function matchesBillableQueue(row: SyncRecord, queue: string) {
  if (queue === "on_hold") return row.status === "held" || Boolean(row.hold_reason);
  if (queue === "disputed") return row.status === "disputed" || Boolean(row.dispute_reason);
  if (queue === "ready_for_settlement") return row.status === "ready_for_settlement" || row.readiness_status === "ready_for_settlement";
  if (queue === "missing_support") return ["needs_rate", "needs_documentation", "needs_customer_acceptance"].includes(String(row.status)) || ["blocked", "not_ready"].includes(String(row.readiness_status)) || !row.production_record_id || !row.qc_review_id;
  if (queue === "archived") return row.status === "archived";
  return ["candidate", "needs_rate", "needs_documentation", "needs_customer_acceptance"].includes(String(row.status)) || ["needs_review", "ready_with_warning"].includes(String(row.readiness_status));
}

function emptyBillableQueue(queue: string) {
  if (queue === "on_hold") return "No billable items are currently on hold.";
  if (queue === "disputed") return "No billable disputes are open.";
  if (queue === "ready_for_settlement") return "No billable items are ready for settlement yet.";
  if (queue === "missing_support") return "No visible billable items are missing support.";
  if (queue === "archived") return "No archived billable items in this queue.";
  return "No billable items need finance review.";
}

function nextBillableAction(row: SyncRecord) {
  if (row.status === "held") return "Release Hold";
  if (row.status === "disputed") return "Resolve Dispute";
  if (row.status === "ready_for_settlement" || row.readiness_status === "ready_for_settlement") return "Prepare settlement workflow";
  if (["needs_rate", "needs_documentation", "needs_customer_acceptance"].includes(String(row.status)) || row.readiness_status === "blocked") return "Resolve readiness support";
  return "Recalculate Readiness";
}

function firstHref(rows: SyncRecord[], fallback: string) {
  const first = rows[0];
  return first?.id ? `${fallback}/${first.id}` : fallback;
}

function matchesFilters(row: SyncRecord, filters: Record<string, string>) {
  if (filters.hasHold && boolMismatch(Boolean(row.hold_reason) || row.status === "held", filters.hasHold)) return false;
  if (filters.hasDispute && boolMismatch(Boolean(row.dispute_reason) || row.status === "disputed", filters.hasDispute)) return false;
  if (filters.hasBlockers && boolMismatch(arrayValue(row.blockers).length > 0 || row.readiness_status === "blocked", filters.hasBlockers)) return false;
  return true;
}

function sortBillable(rows: SyncRecord[], sort = "updated_desc") {
  return [...rows].sort((a, b) => {
    if (sort === "readiness_asc") return numberValue(a.readiness_score, -1) - numberValue(b.readiness_score, -1);
    if (sort === "readiness_desc") return numberValue(b.readiness_score, -1) - numberValue(a.readiness_score, -1);
    if (sort === "amount_desc") return numberValue(b.estimated_billable_amount, -1) - numberValue(a.estimated_billable_amount, -1);
    if (sort === "status") return String(a.status).localeCompare(String(b.status));
    if (sort === "project") return String(a.project_name ?? "").localeCompare(String(b.project_name ?? ""));
    if (sort === "customer") return String(a.customer_organization_name ?? "").localeCompare(String(b.customer_organization_name ?? ""));
    const blockerPriority = Number(arrayValue(b.blockers).length > 0) - Number(arrayValue(a.blockers).length > 0);
    if (blockerPriority) return blockerPriority;
    const gapPriority = gapRank(b.status) - gapRank(a.status);
    if (gapPriority) return gapPriority;
    const readiness = numberValue(a.readiness_score, -1) - numberValue(b.readiness_score, -1);
    if (readiness) return readiness;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function gapRank(status: unknown) {
  return ["needs_rate", "needs_documentation", "needs_customer_acceptance"].includes(String(status)) ? 2 : status === "held" || status === "disputed" ? 1 : 0;
}

function billableChecklist(item: SyncRecord): [string, boolean][] {
  return [
    ["Approved QC exists", Boolean(item.qc_review_id)],
    ["Production approved", Boolean(item.production_record_id)],
    ["Billable quantity present", numberValue(item.billable_quantity) > 0],
    ["Rate reviewed", item.rate_source !== "unknown"],
    ["Billing package reviewed", item.billing_package_status === "ready"],
    ["Documentation reviewed", item.documentation_status === "ready"],
    ["Customer acceptance reviewed", item.customer_acceptance_status !== "pending"],
    ["Prime acceptance reviewed", item.prime_acceptance_status !== "pending"],
    ["No hold", item.status !== "held" && !item.hold_reason],
    ["No dispute", item.status !== "disputed" && !item.dispute_reason],
    ["No settlement created", !item.settlement_item_id],
    ["Ready for settlement", item.status === "ready_for_settlement" || item.readiness_status === "ready_for_settlement"],
  ];
}

function billableItem(detail: BillableDetailShape): SyncRecord {
  return detail.billable_item ?? (detail as SyncRecord);
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

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { style: "currency", currency: "USD" }) : String(value);
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
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.review_type, String(row.id))]));
}

function viewOnly(item: SyncRecord) {
  return ["voided", "archived", "settlement_created"].includes(String(item.status));
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

function qcLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/qc/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function organizationLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/intelligence/organizations/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function actionNotice(type: string) {
  if (type === "ready") return "Billable item marked ready for settlement. No settlement, invoice, AR, payment, cash, payroll, or tax record was created.";
  if (type === "hold") return "Billable item placed on hold.";
  if (type === "release") return "Billable hold released.";
  if (type === "dispute") return "Billable item disputed.";
  if (type === "resolve") return "Billable dispute resolved.";
  return "Billable action completed.";
}

function plainError(message: string) {
  if (!message) return "Billable action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("not found")) return "Billable item not found or you do not have access.";
  if (message.includes("qc_review") || message.includes("production_record")) return "Billable creation requires approved QC and approved production.";
  if (message.includes("billable_quantity")) return "Billable quantity cannot exceed approved quantity without override.";
  if (message.includes("rate")) return "Rate is required before ready for settlement unless overridden.";
  if (message.includes("billing") || message.includes("documentation")) return "Billing package is not ready.";
  if (message.includes("customer_acceptance")) return "Customer acceptance is pending.";
  if (message.includes("prime_acceptance")) return "Prime acceptance is pending.";
  if (message.includes("hold")) return "Hold reason is required.";
  if (message.includes("dispute")) return "Dispute reason is required.";
  if (message.includes("void")) return "Void reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

const billableDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "billable_item.read",
  "billable_item.create",
  "billable_item.update",
  "billable_item.recalculate_readiness",
  "billable_item.mark_ready",
  "billable_item.place_hold",
  "billable_item.release_hold",
  "billable_item.dispute",
  "billable_item.resolve_dispute",
  "billable_item.void",
  "billable_item.archive",
  "billable_item.timeline.read",
  "billable_item.audit.read",
  "qc_review.read",
  "production.read",
  "production_record.read",
  "work_order.read",
  "project.read",
  "organization.read",
];

const emptyRelated: RelatedData = { qcReviews: [] };
