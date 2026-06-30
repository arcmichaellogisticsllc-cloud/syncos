"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell, ObjectTable, Panel } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const caseStatuses = ["open", "in_progress", "promise_to_pay", "disputed", "escalated", "awaiting_payment", "resolved", "closed", "archived"];
const priorities = ["low", "medium", "high", "urgent"];
const riskLevels = ["low", "medium", "high", "critical"];
const agingBuckets = ["current", "1_30", "31_60", "61_90", "90_plus"];
const disputeStatuses = ["none", "open", "under_review", "resolved", "rejected"];
const escalationStatuses = ["none", "internal_escalation", "executive_escalation", "legal_review_later", "collections_agency_later"];
const writeoffStatuses = ["not_applicable", "not_ready", "candidate", "under_review_later", "approved_later", "rejected_later"];
const actionTypes = ["call", "email", "text", "portal_message", "internal_note", "promise_to_pay", "dispute_opened", "dispute_updated", "dispute_resolved", "payment_reminder", "follow_up_scheduled", "escalation_requested", "escalation_approved", "writeoff_review_requested", "case_closed"];
const actionStatuses = ["planned", "completed", "failed", "cancelled", "archived"];
const contactMethods = ["phone", "email", "sms", "portal", "in_person", "internal"];
const outcomes = ["no_response", "left_message", "contacted", "promise_received", "payment_received_later", "dispute_reported", "wrong_contact", "follow_up_needed", "escalated", "resolved"];
const closeReasons = ["paid", "resolved", "duplicate", "opened_in_error", "transferred", "unresolved_close", "future_writeoff_review"];
const caseTabs = ["overview", "invoice_context", "customer_context", "cash_application_context", "actions", "promise_to_pay", "dispute", "escalation", "writeoff_review", "aging_priority", "timeline", "audit", "future_cash_application", "future_legal", "future_accounting_tax"];

type Session = ReturnType<typeof useSession>;

type CollectionCaseDetailShape = {
  collection_case?: SyncRecord;
  invoice_context?: SyncRecord;
  customer_context?: SyncRecord;
  cash_application_context?: SyncRecord;
  collection_actions?: SyncRecord[];
  promise_summary?: SyncRecord;
  dispute_summary?: SyncRecord;
  escalation_summary?: SyncRecord;
  aging_priority_summary?: SyncRecord;
  writeoff_review_summary?: SyncRecord;
  boundary_summary?: SyncRecord;
  warnings?: unknown[];
  blockers?: unknown[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type CollectionActionDetailShape = {
  action?: SyncRecord;
  case_context?: SyncRecord;
  invoice_context?: SyncRecord;
  customer_context?: SyncRecord;
  actor_context?: SyncRecord;
  boundary_summary?: SyncRecord;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

export function CollectionCaseQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = caseQuery(filters);
      setRows(await syncosFetch<SyncRecord[]>(`/collection-cases?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortCases(rows.filter((row) => caseMatches(row, filters)), filters.sort), [rows, filters]);
  const summary = useMemo(() => buildCaseSummary(rows), [rows]);

  return (
    <CollectionsShell title="Collection Case Queue" purpose="Control unpaid invoice follow-up, risk, promises, disputes, escalations, and write-off review readiness without moving cash or reducing invoice balances.">
      <SessionPanel session={session} />
      <div className="warning-box">Collections coordinates follow-up only. It does not create cash receipts, payment applications, legal filings, tax/accounting workflows, payroll, or invoice balance reductions.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view collection cases.</div> : null}
      {loading ? <div className="empty-state">Loading collection cases...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Collection Case Summary</h2>
                <p className="muted">Cases are prioritized by critical risk, overdue follow-up, aging, and recent updates.</p>
              </div>
              <Link className="primary-button" href="/collections/new" aria-disabled={!hasPermission(session.permissions, "collection_case.create")}>Create Collection Case</Link>
            </div>
            <div className="summary-grid">
              <SummaryCard label="Total Cases" value={summary.total} onClick={() => setFilters({ archived: "false", sort: "updated_desc" })} />
              {["open", "in_progress", "promise_to_pay", "disputed", "escalated", "awaiting_payment", "resolved", "closed", "archived"].map((case_status) => <SummaryCard key={case_status} label={formatAction(case_status)} value={summary.status[case_status] ?? 0} onClick={() => setFilters({ archived: case_status === "archived" ? "true" : "false", sort: "updated_desc", case_status })} />)}
              {agingBuckets.map((aging_bucket) => <SummaryCard key={aging_bucket} label={formatAging(aging_bucket)} value={summary.aging[aging_bucket] ?? 0} onClick={() => setFilters({ ...filters, aging_bucket })} />)}
              <SummaryCard label="High Risk" value={summary.risk.high ?? 0} onClick={() => setFilters({ ...filters, risk_level: "high" })} />
              <SummaryCard label="Critical Risk" value={summary.risk.critical ?? 0} onClick={() => setFilters({ ...filters, risk_level: "critical" })} />
              <SummaryCard label="Due Follow-Up" value={summary.dueFollowUp} onClick={() => setFilters({ ...filters, dueToday: "true" })} />
              <SummaryCard label="Write-Off Candidates" value={summary.writeoff.candidate ?? 0} onClick={() => setFilters({ ...filters, writeoff_review_status: "candidate" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "updated_desc" })}>Reset</button>
            </div>
            <div className="tab-row">
              {["open", "in_progress", "promise_to_pay", "disputed", "escalated", "awaiting_payment", "resolved", "closed"].map((case_status) => <button key={case_status} type="button" onClick={() => setFilters({ ...filters, case_status })}>{formatAction(case_status)}</button>)}
              <button type="button" onClick={() => setFilters({ ...filters, aging_bucket: "90_plus" })}>90+</button>
              <button type="button" onClick={() => setFilters({ ...filters, dueToday: "true" })}>Due Today</button>
              <button type="button" onClick={() => setFilters({ ...filters, overdueFollowUp: "true" })}>Overdue Follow-Up</button>
              <button type="button" onClick={() => setFilters({ ...filters, writeoff_review_status: "candidate" })}>Write-Off Candidate</button>
              <button type="button" onClick={() => setFilters({ ...filters, risk_level: "critical" })}>Critical Risk</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search case, invoice, customer, note" />
              <Select label="Case Status" value={filters.case_status ?? ""} options={["", ...caseStatuses]} onChange={(case_status) => setFilters({ ...filters, case_status })} />
              <Select label="Priority" value={filters.collection_priority ?? ""} options={["", ...priorities]} onChange={(collection_priority) => setFilters({ ...filters, collection_priority })} />
              <Select label="Risk Level" value={filters.risk_level ?? ""} options={["", ...riskLevels]} onChange={(risk_level) => setFilters({ ...filters, risk_level })} />
              <Select label="Aging Bucket" value={filters.aging_bucket ?? ""} options={["", ...agingBuckets]} labels={agingLabels} onChange={(aging_bucket) => setFilters({ ...filters, aging_bucket })} />
              <input value={filters.customer_organization_id ?? ""} onChange={(event) => setFilters({ ...filters, customer_organization_id: event.target.value })} placeholder="Customer" />
              <input value={filters.invoice_id ?? ""} onChange={(event) => setFilters({ ...filters, invoice_id: event.target.value })} placeholder="Invoice" />
              <input value={filters.assigned_owner_user_id ?? ""} onChange={(event) => setFilters({ ...filters, assigned_owner_user_id: event.target.value })} placeholder="Owner" />
              <Select label="Dispute Status" value={filters.dispute_status ?? ""} options={["", ...disputeStatuses]} onChange={(dispute_status) => setFilters({ ...filters, dispute_status })} />
              <Select label="Escalation Status" value={filters.escalation_status ?? ""} options={["", ...escalationStatuses]} onChange={(escalation_status) => setFilters({ ...filters, escalation_status })} />
              <Select label="Write-Off Review" value={filters.writeoff_review_status ?? ""} options={["", ...writeoffStatuses]} onChange={(writeoff_review_status) => setFilters({ ...filters, writeoff_review_status })} />
              <label>Next Action From<input type="date" value={filters.next_action_due_from ?? ""} onChange={(event) => setFilters({ ...filters, next_action_due_from: event.target.value })} /></label>
              <label>Next Action To<input type="date" value={filters.next_action_due_to ?? ""} onChange={(event) => setFilters({ ...filters, next_action_due_to: event.target.value })} /></label>
              <Select label="Has Promise" value={filters.has_promise ?? ""} options={["", "true", "false"]} onChange={(has_promise) => setFilters({ ...filters, has_promise })} />
              <Select label="Overdue Promise" value={filters.overdue_promise ?? ""} options={["", "true", "false"]} onChange={(overdue_promise) => setFilters({ ...filters, overdue_promise })} />
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "aging_desc", "balance_desc", "priority_desc", "next_action_due_asc", "opened_desc", "case_number"]} labels={{ updated_desc: "Recently Updated", aging_desc: "Aging Highest", balance_desc: "Balance Highest", priority_desc: "Priority Highest", next_action_due_asc: "Next Action Due Soonest", opened_desc: "Opened Newest", case_number: "Case Number" }} onChange={(sort) => setFilters({ ...filters, sort })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Collection Cases</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No collection cases yet. Create a case from an open invoice balance.</div> : <CollectionCaseTable rows={visible} />}
          </section>
        </>
      ) : null}
    </CollectionsShell>
  );
}

export function CollectionCaseCreate() {
  const router = useRouter();
  const session = useSession();
  const [invoices, setInvoices] = useState<SyncRecord[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadInvoices(session.token).then(setInvoices);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/collection-cases", { method: "POST", body: caseCreatePayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? after?.id ?? "");
      router.push(id ? `/collections/${id}` : "/collections");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <CollectionsShell title="Create Collection Case" purpose="Open follow-up governance for an invoice balance without changing the invoice balance or creating cash/payment activity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Backend validation is authoritative. Creating a case does not update invoice balance, create a cash receipt, create a payment application, or send a message.</div>
        <div className="form-grid">
          <Select label="Invoice" value={form.invoice_id ?? ""} options={["", ...invoices.map((row) => String(row.id))]} labels={labelsFor(invoices, "invoice_number")} onChange={(invoice_id) => setForm({ ...form, invoice_id })} required />
          <input value={form.assigned_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, assigned_owner_user_id: event.target.value })} placeholder="Assigned owner user ID" />
          <Select label="Priority" value={form.collection_priority ?? ""} options={["", ...priorities]} onChange={(collection_priority) => setForm({ ...form, collection_priority })} />
          <label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} placeholder='{"reason":"Reviewed"}' /></label>
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "collection_case.create")}>Create Collection Case</button>
          <Link className="link-button" href="/collections">Cancel</Link>
        </div>
      </form>
    </CollectionsShell>
  );
}

export function CollectionCaseEdit({ caseId }: { caseId: string }) {
  const router = useRouter();
  const session = useSession();
  const [record, setRecord] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const next = await syncosFetch<SyncRecord>(`/collection-cases/${caseId}`, { token: session.token });
        setRecord(next);
        setForm({
          assigned_owner_user_id: String(next.assigned_owner_user_id ?? ""),
          collection_priority: String(next.collection_priority ?? ""),
          risk_level: String(next.risk_level ?? ""),
          next_action_type: String(next.next_action_type ?? ""),
          next_action_due_at: dateInput(next.next_action_due_at),
          notes: String(next.notes ?? ""),
          override_reasons: jsonText(next.override_reasons),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, caseId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/collection-cases/${caseId}`, { method: "PATCH", body: casePatchPayload(form), token: session.token });
      router.push(`/collections/${caseId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  const archived = record?.case_status === "archived";
  return (
    <CollectionsShell title="Edit Collection Case" purpose="Edit ownership, priority, risk, next action, and notes without changing invoice balances or creating payment activity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Collection case not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Cannot edit invoice balance. Status changes must use lifecycle actions.</div>
          <div className="form-grid">
            <input value={form.assigned_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, assigned_owner_user_id: event.target.value })} placeholder="Assigned owner user ID" disabled={archived} />
            <Select label="Priority" value={form.collection_priority ?? ""} options={["", ...priorities]} onChange={(collection_priority) => setForm({ ...form, collection_priority })} disabled={archived} />
            <Select label="Risk Level" value={form.risk_level ?? ""} options={["", ...riskLevels]} onChange={(risk_level) => setForm({ ...form, risk_level })} disabled={archived} />
            <input value={form.next_action_type ?? ""} onChange={(event) => setForm({ ...form, next_action_type: event.target.value })} placeholder="Next action type" disabled={archived} />
            <label>Next Action Due At<input type="date" value={form.next_action_due_at ?? ""} onChange={(event) => setForm({ ...form, next_action_due_at: event.target.value })} disabled={archived} /></label>
            <label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={archived} /></label>
            <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} disabled={archived} /></label>
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={archived || !hasPermission(session.permissions, "collection_case.update")}>Save Case</button>
            <Link className="link-button" href={`/collections/${caseId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </CollectionsShell>
  );
}

export function CollectionCaseDetail({ caseId }: { caseId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<CollectionCaseDetailShape | null>(null);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [selectedAction, setSelectedAction] = useState<SyncRecord | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const next = await syncosFetch<CollectionCaseDetailShape>(`/collection-cases/${caseId}/detail`, { token: session.token });
      const [timeline, audit] = await Promise.all([
        optionalList(`/collection-cases/${caseId}/timeline`, session.token),
        optionalList(`/collection-cases/${caseId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, caseId]);

  const collectionCase = detail?.collection_case;
  const actions = detail?.collection_actions ?? [];

  function openAction(type: string, action?: SyncRecord) {
    setSelectedAction(action ?? null);
    setModal(type);
  }

  return (
    <CollectionsShell title="Collection Case Detail" purpose="Show collection truth for an open invoice balance: owner, aging, actions, promise, dispute, escalation, and next action.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Collection Case Detail.</div> : null}
      {!collectionCase && session.token && !error ? <div className="empty-state">Collection case not found or no access.</div> : null}
      {collectionCase && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(collectionCase.case_number, "Collection Case")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(collectionCase.case_status)}</span>
                  <span className="badge">{formatAction(collectionCase.collection_priority)}</span>
                  <span className="badge">{formatAction(collectionCase.risk_level)}</span>
                  <span className="badge">{formatAging(collectionCase.aging_bucket)}</span>
                  <span className="badge">{formatAction(collectionCase.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/collections/${caseId}/edit`} aria-disabled={!hasPermission(session.permissions, "collection_case.update")}>Edit Case</Link>
                <ActionButton permission="collection_case.assign_owner" session={session} disabled={caseInactive(collectionCase)} onClick={() => openAction("assign_owner")}>Assign Owner</ActionButton>
                <ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => openAction("add_action")}>Add Action</ActionButton>
                <ActionButton permission="collection_case.close" session={session} disabled={caseInactive(collectionCase)} onClick={() => openAction("close_case")}>Close Case</ActionButton>
                <ActionButton permission="collection_case.archive" session={session} disabled={collectionCase.case_status === "archived"} onClick={() => openAction("archive_case")}>Archive Case</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Current Balance" value={money(collectionCase.current_balance)} />
              <Metric label="Original Invoice Amount" value={money(collectionCase.original_invoice_amount)} />
              <Metric label="Aging Bucket" value={formatAging(collectionCase.aging_bucket)} />
              <Metric label="Priority" value={formatAction(collectionCase.collection_priority)} />
              <Metric label="Risk Level" value={formatAction(collectionCase.risk_level)} />
              <Metric label="Last Payment Amount" value={money(collectionCase.last_payment_amount)} />
              <Metric label="Last Payment At" value={dateValue(collectionCase.last_payment_at)} />
              <Metric label="Next Action Due" value={dateValue(collectionCase.next_action_due_at)} />
              <Metric label="Promise Amount" value={money(collectionCase.promise_to_pay_amount)} />
              <Metric label="Promise Date" value={dateValue(collectionCase.promise_to_pay_date)} />
              <Metric label="Dispute Status" value={formatAction(collectionCase.dispute_status)} />
              <Metric label="Escalation Status" value={formatAction(collectionCase.escalation_status)} />
              <Metric label="Write-Off Review Status" value={formatAction(collectionCase.writeoff_review_status)} />
            </div>
            <div className="warning-box">Collections does not reduce invoice balance. Payments are handled through Cash Application. Write-off review does not execute accounting write-off.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Customer</dt><dd>{organizationLink(collectionCase.customer_organization_id, collectionCase.customer_organization_name ?? detail.customer_context?.name)}</dd>
                <dt>Invoice</dt><dd>{invoiceLink(collectionCase.invoice_id, collectionCase.invoice_number ?? detail.invoice_context?.invoice_number)}</dd>
                <dt>Invoice status</dt><dd>{formatAction(detail.invoice_context?.status)}</dd>
                <dt>Invoice balance</dt><dd>{money(detail.invoice_context?.balance_amount ?? collectionCase.current_balance)}</dd>
                <dt>Payment status</dt><dd>{formatAction(detail.invoice_context?.payment_status)}</dd>
                <dt>Collection status</dt><dd>{formatAction(detail.invoice_context?.collection_status)}</dd>
                <dt>Cash status</dt><dd>{formatAction(detail.invoice_context?.cash_application_status)}</dd>
                <dt>Owner</dt><dd>{textValue(collectionCase.assigned_owner_name ?? collectionCase.assigned_owner_user_id)}</dd>
                <dt>Case status</dt><dd>{formatAction(collectionCase.case_status)}</dd>
                <dt>Risk</dt><dd>{formatAction(collectionCase.risk_level)}</dd>
                <dt>Aging</dt><dd>{formatAging(collectionCase.aging_bucket)}</dd>
                <dt>Promise</dt><dd>{collectionCase.promise_to_pay_date ? `${dateValue(collectionCase.promise_to_pay_date)} / ${money(collectionCase.promise_to_pay_amount)}` : "Not captured"}</dd>
                <dt>Dispute</dt><dd>{formatAction(collectionCase.dispute_status)}</dd>
                <dt>Escalation</dt><dd>{formatAction(collectionCase.escalation_status)}</dd>
              </dl>
              <Checklist items={caseChecklist(collectionCase, detail)} />
              <div className="warning-box">No cash/payment created. No balance reduced. Legal, accounting, tax, payroll, and collections agency workflows are placeholders only.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {caseTabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <CollectionCaseTab tab={tab} detail={detail} collectionCase={collectionCase} actions={actions} session={session} onAction={openAction} />
            </section>
          </div>
          {modal ? <CollectionCaseModal type={modal} caseId={caseId} collectionCase={collectionCase} action={selectedAction} session={session} onClose={() => { setModal(""); setSelectedAction(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </CollectionsShell>
  );
}

export function CollectionActionQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("archived", filters.archived === "true" ? "true" : "false");
      for (const key of ["collection_case_id", "invoice_id", "customer_organization_id", "action_type", "action_status", "actor_user_id", "action_date_from", "action_date_to", "due_at_from", "due_at_to", "follow_up_due_from", "follow_up_due_to", "q"]) if (filters[key]) query.set(key, filters[key]);
      setRows(await syncosFetch<SyncRecord[]>(`/collection-actions?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => rows.filter((row) => actionMatches(row, filters)), [rows, filters]);

  return (
    <CollectionsShell title="Collection Actions" purpose="View and manage collection activities across cases without sending messages or moving money.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Loading collection actions...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Action Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false" })}>Reset</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search case, invoice, customer, note" />
              <input value={filters.collection_case_id ?? ""} onChange={(event) => setFilters({ ...filters, collection_case_id: event.target.value })} placeholder="Collection Case" />
              <input value={filters.invoice_id ?? ""} onChange={(event) => setFilters({ ...filters, invoice_id: event.target.value })} placeholder="Invoice" />
              <input value={filters.customer_organization_id ?? ""} onChange={(event) => setFilters({ ...filters, customer_organization_id: event.target.value })} placeholder="Customer" />
              <Select label="Action Type" value={filters.action_type ?? ""} options={["", ...actionTypes]} onChange={(action_type) => setFilters({ ...filters, action_type })} />
              <Select label="Action Status" value={filters.action_status ?? ""} options={["", ...actionStatuses]} onChange={(action_status) => setFilters({ ...filters, action_status })} />
              <input value={filters.actor_user_id ?? ""} onChange={(event) => setFilters({ ...filters, actor_user_id: event.target.value })} placeholder="Actor" />
              <label>Action Date From<input type="date" value={filters.action_date_from ?? ""} onChange={(event) => setFilters({ ...filters, action_date_from: event.target.value })} /></label>
              <label>Action Date To<input type="date" value={filters.action_date_to ?? ""} onChange={(event) => setFilters({ ...filters, action_date_to: event.target.value })} /></label>
              <label>Due From<input type="date" value={filters.due_at_from ?? ""} onChange={(event) => setFilters({ ...filters, due_at_from: event.target.value })} /></label>
              <label>Due To<input type="date" value={filters.due_at_to ?? ""} onChange={(event) => setFilters({ ...filters, due_at_to: event.target.value })} /></label>
              <label>Follow-Up From<input type="date" value={filters.follow_up_due_from ?? ""} onChange={(event) => setFilters({ ...filters, follow_up_due_from: event.target.value })} /></label>
              <label>Follow-Up To<input type="date" value={filters.follow_up_due_to ?? ""} onChange={(event) => setFilters({ ...filters, follow_up_due_to: event.target.value })} /></label>
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
            </div>
          </section>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Collection Actions</h2>
              <span>{visible.length} shown</span>
            </div>
            <CollectionActionTable rows={visible} />
          </section>
        </>
      ) : null}
    </CollectionsShell>
  );
}

export function CollectionActionDetail({ actionId }: { actionId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<CollectionActionDetailShape | null>(null);
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const next = await syncosFetch<CollectionActionDetailShape>(`/collection-actions/${actionId}/detail`, { token: session.token });
      const [timeline, audit] = await Promise.all([
        optionalList(`/collection-actions/${actionId}/timeline`, session.token),
        optionalList(`/collection-actions/${actionId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, actionId]);

  const action = detail?.action;
  return (
    <CollectionsShell title="Collection Action Detail" purpose="Show collection activity context, promise/dispute/escalation data, follow-up fields, timeline, and audit history.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!action ? <div className="empty-state">Collection action not found or no access.</div> : null}
      {action && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{formatAction(action.action_type)}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(action.action_status)}</span>
                  <span className="badge">{dateValue(action.action_date)}</span>
                  <span className="badge">{formatAction(action.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <ActionButton permission="collection_action.complete" session={session} disabled={actionInactive(action)} onClick={() => setModal("complete_action")}>Complete Action</ActionButton>
                <ActionButton permission="collection_action.cancel" session={session} disabled={actionInactive(action)} onClick={() => setModal("cancel_action")}>Cancel Action</ActionButton>
                <ActionButton permission="collection_action.archive" session={session} disabled={action.action_status === "archived"} onClick={() => setModal("archive_action")}>Archive Action</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Action Type" value={formatAction(action.action_type)} />
              <Metric label="Status" value={formatAction(action.action_status)} />
              <Metric label="Case" value={textValue(detail.case_context?.case_number, String(action.collection_case_id))} />
              <Metric label="Invoice" value={textValue(detail.invoice_context?.invoice_number, String(action.invoice_id))} />
              <Metric label="Customer" value={textValue(detail.customer_context?.name, String(action.customer_organization_id))} />
              <Metric label="Follow-Up Due" value={dateValue(action.follow_up_due_at)} />
            </div>
          </section>
          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Contexts</h2>
              <dl className="detail-list">
                <dt>Case</dt><dd>{caseLink(action.collection_case_id, detail.case_context?.case_number)}</dd>
                <dt>Invoice</dt><dd>{invoiceLink(action.invoice_id, detail.invoice_context?.invoice_number)}</dd>
                <dt>Customer</dt><dd>{organizationLink(action.customer_organization_id, detail.customer_context?.name)}</dd>
                <dt>Actor</dt><dd>{textValue(detail.actor_context?.name ?? action.actor_user_id)}</dd>
                <dt>Boundary</dt><dd>Read-only invoice context. No cash movement.</dd>
              </dl>
              <div className="warning-box">Collection actions do not send email/SMS, apply cash, reduce invoice balances, trigger legal filing, or execute write-offs.</div>
            </aside>
            <section className="workspace-panel">
              <Panel title="Action"><dl className="detail-list"><dt>Action ID</dt><dd>{String(action.id)}</dd><dt>Action type</dt><dd>{formatAction(action.action_type)}</dd><dt>Status</dt><dd>{formatAction(action.action_status)}</dd><dt>Action date</dt><dd>{dateValue(action.action_date)}</dd><dt>Due at</dt><dd>{dateValue(action.due_at)}</dd><dt>Completed at</dt><dd>{dateValue(action.completed_at)}</dd><dt>Contact method</dt><dd>{formatAction(action.contact_method)}</dd><dt>Outcome</dt><dd>{formatAction(action.outcome)}</dd><dt>Note</dt><dd>{textValue(action.note)}</dd><dt>Promise</dt><dd>{action.promise_to_pay_date ? `${dateValue(action.promise_to_pay_date)} / ${money(action.promise_to_pay_amount)}` : "Not captured"}</dd><dt>Dispute reason</dt><dd>{textValue(action.dispute_reason)}</dd><dt>Escalation reason</dt><dd>{textValue(action.escalation_reason)}</dd><dt>Follow-up</dt><dd>{action.follow_up_required ? `Required by ${dateValue(action.follow_up_due_at)}` : "Not required"}</dd></dl></Panel>
              <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor", "timestamp", "summary", "object_type", "object_id"]} /></Panel>
              <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor", "action", "object", "before", "after", "reason", "timestamp", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view collections audit details.</div>}</Panel>
            </section>
          </div>
          {modal ? <CollectionActionModal type={modal} actionId={actionId} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice("Collection action updated."); }} /> : null}
        </>
      ) : null}
    </CollectionsShell>
  );
}

function CollectionsShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/collections", "Collection Case Queue", "active"],
    ["/collections/new", "Create Case", "active"],
    ["/collection-actions", "Collection Actions", "active"],
    ["#case-detail", "Collection Case Detail", "placeholder"],
    ["#invoice-context", "Invoice Context", "placeholder"],
    ["#customer-context", "Customer Context", "placeholder"],
    ["#cash-context", "Cash Application Context", "placeholder"],
    ["#promise", "Promise-To-Pay", "placeholder"],
    ["#dispute", "Dispute Management", "placeholder"],
    ["#escalation", "Escalation", "placeholder"],
    ["#writeoff", "Write-Off Review", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-cash", "Future Cash Application", "placeholder"],
    ["#future-legal", "Future Legal", "placeholder"],
    ["#future-accounting-tax", "Future Accounting / Tax", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Collections</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function CollectionCaseTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Case Number", "Case Status", "Customer", "Invoice Number", "Current Balance", "Original Invoice Amount", "Aging Bucket", "Priority", "Risk Level", "Owner", "Last Payment At", "Last Payment Amount", "Next Action", "Next Action Due", "Promise Date", "Promise Amount", "Dispute Status", "Escalation Status", "Write-Off Review Status", "Recommended Next Action", "Updated Date"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{caseLink(row.id, row.case_number)}</td><td>{formatAction(row.case_status)}</td><td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td><td>{invoiceLink(row.invoice_id, row.invoice_number)}</td><td>{money(row.current_balance)}</td><td>{money(row.original_invoice_amount)}</td><td>{formatAging(row.aging_bucket)}</td><td>{formatAction(row.collection_priority)}</td><td>{formatAction(row.risk_level)}</td><td>{textValue(row.assigned_owner_name ?? row.assigned_owner_user_id)}</td><td>{dateValue(row.last_payment_at)}</td><td>{money(row.last_payment_amount)}</td><td>{formatAction(row.next_action_type)}</td><td>{dateValue(row.next_action_due_at)}</td><td>{dateValue(row.promise_to_pay_date)}</td><td>{money(row.promise_to_pay_amount)}</td><td>{formatAction(row.dispute_status)}</td><td>{formatAction(row.escalation_status)}</td><td>{formatAction(row.writeoff_review_status)}</td><td>{formatAction(row.recommended_next_action)}</td><td>{dateValue(row.updated_at)}</td></tr>)}</tbody></table></div>;
}

function CollectionActionTable({ rows }: { rows: SyncRecord[] }) {
  if (!rows.length) return <div className="empty-state">No collection actions returned.</div>;
  return <div className="wide-table"><table><thead><tr>{["Action Type", "Status", "Case Number", "Invoice Number", "Customer", "Action Date", "Due At", "Completed At", "Actor", "Contact Method", "Outcome", "Follow-Up Required", "Follow-Up Due", "Updated Date"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><Link className="table-link" href={`/collection-actions/${row.id}`}>{formatAction(row.action_type)}</Link></td><td>{formatAction(row.action_status)}</td><td>{caseLink(row.collection_case_id, row.case_number)}</td><td>{invoiceLink(row.invoice_id, row.invoice_number)}</td><td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td><td>{dateValue(row.action_date)}</td><td>{dateValue(row.due_at)}</td><td>{dateValue(row.completed_at)}</td><td>{textValue(row.actor_name ?? row.actor_user_id)}</td><td>{formatAction(row.contact_method)}</td><td>{formatAction(row.outcome)}</td><td>{row.follow_up_required ? "Yes" : "No"}</td><td>{dateValue(row.follow_up_due_at)}</td><td>{dateValue(row.updated_at)}</td></tr>)}</tbody></table></div>;
}

function CollectionCaseTab({ tab, detail, collectionCase, actions, session, onAction }: { tab: string; detail: CollectionCaseDetailShape; collectionCase: SyncRecord; actions: SyncRecord[]; session: Session; onAction: (type: string, action?: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Case number</dt><dd>{textValue(collectionCase.case_number)}</dd><dt>Case status</dt><dd>{formatAction(collectionCase.case_status)}</dd><dt>Priority</dt><dd>{formatAction(collectionCase.collection_priority)}</dd><dt>Risk level</dt><dd>{formatAction(collectionCase.risk_level)}</dd><dt>Aging bucket</dt><dd>{formatAging(collectionCase.aging_bucket)}</dd><dt>Opened at</dt><dd>{dateValue(collectionCase.opened_at)}</dd><dt>Closed at</dt><dd>{dateValue(collectionCase.closed_at)}</dd><dt>Close reason</dt><dd>{formatAction(collectionCase.close_reason)}</dd><dt>Notes</dt><dd>{textValue(collectionCase.notes)}</dd><dt>Override reasons</dt><dd><JsonBlock value={collectionCase.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(collectionCase.created_at)}</dd><dt>Updated</dt><dd>{dateValue(collectionCase.updated_at)}</dd></dl><div className="warning-box">Collections coordinates follow-up on unpaid balances. It does not create cash receipts, apply payments, reduce invoice balances, trigger legal filing, or execute accounting write-offs.</div></Panel>;
  if (tab === "invoice_context") return <Panel title="Invoice Context"><dl className="detail-list"><dt>Invoice</dt><dd>{invoiceLink(collectionCase.invoice_id, detail.invoice_context?.invoice_number ?? collectionCase.invoice_number)}</dd><dt>Status</dt><dd>{formatAction(detail.invoice_context?.status)}</dd><dt>Approval status</dt><dd>{formatAction(detail.invoice_context?.approval_status)}</dd><dt>Delivery status</dt><dd>{formatAction(detail.invoice_context?.delivery_status)}</dd><dt>Cash status</dt><dd>{formatAction(detail.invoice_context?.cash_application_status)}</dd><dt>Payment status</dt><dd>{formatAction(detail.invoice_context?.payment_status)}</dd><dt>Collection status</dt><dd>{formatAction(detail.invoice_context?.collection_status)}</dd><dt>Original amount</dt><dd>{money(detail.invoice_context?.original_amount)}</dd><dt>Paid amount</dt><dd>{money(detail.invoice_context?.paid_amount)}</dd><dt>Balance amount</dt><dd>{money(detail.invoice_context?.balance_amount)}</dd><dt>Aging days</dt><dd>{formatCell(detail.invoice_context?.aging_days)}</dd><dt>Due date</dt><dd>{dateValue(detail.invoice_context?.due_date)}</dd><dt>Last payment at</dt><dd>{dateValue(detail.invoice_context?.last_payment_at)}</dd><dt>Last payment amount</dt><dd>{money(detail.invoice_context?.last_payment_amount)}</dd></dl><div className="warning-box">Read-only. No balance edits are available from Collections.</div></Panel>;
  if (tab === "customer_context") return <Panel title="Customer Context"><dl className="detail-list"><dt>Customer</dt><dd>{organizationLink(collectionCase.customer_organization_id, detail.customer_context?.name ?? collectionCase.customer_organization_name)}</dd><dt>Status</dt><dd>{formatAction(detail.customer_context?.status)}</dd><dt>Open invoice count</dt><dd>{formatCell(detail.customer_context?.open_invoice_count)}</dd><dt>Unpaid balance</dt><dd>{money(detail.customer_context?.unpaid_balance)}</dd><dt>Payment terms</dt><dd>{formatAction(detail.customer_context?.payment_terms)}</dd><dt>Related cases</dt><dd>{formatCell(detail.customer_context?.collection_case_count)}</dd></dl></Panel>;
  if (tab === "cash_application_context") return <Panel title="Cash Application Context"><dl className="detail-list"><dt>Last payment at</dt><dd>{dateValue(collectionCase.last_payment_at ?? detail.invoice_context?.last_payment_at)}</dd><dt>Last payment amount</dt><dd>{money(collectionCase.last_payment_amount ?? detail.invoice_context?.last_payment_amount)}</dd><dt>Payment applications</dt><dd>{formatCell(detail.cash_application_context?.payment_application_count)}</dd><dt>Cash receipts</dt><dd>{formatCell(detail.cash_application_context?.cash_receipt_count)}</dd><dt>Customer unapplied cash</dt><dd>{money(detail.cash_application_context?.customer_unapplied_cash)}</dd></dl><div className="warning-box">Cash Application is not controlled from Collections. Open Cash Application workspace to record or apply payment. No payment button is available here.</div></Panel>;
  if (tab === "actions") return <Panel title="Collection Actions"><div className="form-actions"><ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_action")}>Add Action</ActionButton></div><CollectionActionsForCase rows={actions} session={session} onAction={onAction} /><div className="warning-box">Adding an action does not send email/SMS or create cash/payment activity.</div></Panel>;
  if (tab === "promise_to_pay") return <Panel title="Promise-To-Pay"><dl className="detail-list"><dt>Promise date</dt><dd>{dateValue(collectionCase.promise_to_pay_date)}</dd><dt>Promise amount</dt><dd>{money(collectionCase.promise_to_pay_amount)}</dd><dt>Current balance</dt><dd>{money(collectionCase.current_balance)}</dd><dt>Promise summary</dt><dd><JsonBlock value={detail.promise_summary} /></dd></dl><ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_promise")}>Add Promise-To-Pay Action</ActionButton><div className="warning-box">Promise-to-pay does not change invoice balance. Fulfillment is inferred later through payment application.</div></Panel>;
  if (tab === "dispute") return <Panel title="Dispute"><dl className="detail-list"><dt>Dispute status</dt><dd>{formatAction(collectionCase.dispute_status)}</dd><dt>Invoice collection status</dt><dd>{formatAction(detail.invoice_context?.collection_status)}</dd><dt>Dispute summary</dt><dd><JsonBlock value={detail.dispute_summary} /></dd></dl><div className="form-actions"><ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_dispute_opened")}>Add Dispute Opened</ActionButton><ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_dispute_updated")}>Add Dispute Updated</ActionButton><ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_dispute_resolved")}>Add Dispute Resolved</ActionButton></div><div className="warning-box">Dispute resolution does not reduce balance. Credits/write-offs require future governed workflows.</div></Panel>;
  if (tab === "escalation") return <Panel title="Escalation"><dl className="detail-list"><dt>Escalation status</dt><dd>{formatAction(collectionCase.escalation_status)}</dd><dt>Escalation summary</dt><dd><JsonBlock value={detail.escalation_summary} /></dd></dl><div className="form-actions"><ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_escalation_requested")}>Add Escalation Requested</ActionButton><ActionButton permission="collection_action.create" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_escalation_approved")}>Add Escalation Approved</ActionButton></div><div className="warning-box">Escalation does not trigger legal filing or collections agency workflow.</div></Panel>;
  if (tab === "writeoff_review") return <Panel title="Write-Off Review"><dl className="detail-list"><dt>Write-Off Review Status</dt><dd>{formatAction(collectionCase.writeoff_review_status)}</dd><dt>Write-Off Summary</dt><dd><JsonBlock value={detail.writeoff_review_summary} /></dd></dl><ActionButton permission="collection_case.writeoff_review" session={session} disabled={caseInactive(collectionCase)} onClick={() => onAction("add_writeoff_review")}>Add Write-Off Review Requested</ActionButton><div className="warning-box">Write-off review is a flag only. It does not execute accounting or tax write-off.</div></Panel>;
  if (tab === "aging_priority") return <Panel title="Aging & Priority"><dl className="detail-list"><dt>Aging days</dt><dd>{formatCell(detail.invoice_context?.aging_days)}</dd><dt>Aging bucket</dt><dd>{formatAging(collectionCase.aging_bucket)}</dd><dt>Priority</dt><dd>{formatAction(collectionCase.collection_priority)}</dd><dt>Risk level</dt><dd>{formatAction(collectionCase.risk_level)}</dd><dt>Balance</dt><dd>{money(collectionCase.current_balance)}</dd><dt>Dispute modifiers</dt><dd>{formatAction(collectionCase.dispute_status)}</dd><dt>Promise modifiers</dt><dd>{dateValue(collectionCase.promise_to_pay_date)}</dd><dt>Recommended next action</dt><dd>{formatAction(collectionCase.recommended_next_action ?? detail.recommended_next_action)}</dd></dl></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor", "action", "object", "before", "after", "reason", "timestamp", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view collections audit details.</div>}</Panel>;
  if (tab === "future_cash_application") return <PlaceholderPanel title="Future Cash Application" message="Cash Application is not performed from Collections in this sprint. Use Cash Application workspace to record or apply payments." columns={["Cash receipt button", "Payment application button", "Invoice balance edit"]} />;
  if (tab === "future_legal") return <PlaceholderPanel title="Future Legal" message="Legal filing and collections agency workflows are not available in this sprint." columns={["Legal filing", "Agency referral", "Demand letter"]} />;
  return <PlaceholderPanel title="Future Accounting / Tax" message="Accounting export, tax write-off, and GL workflows are not available in this sprint." columns={["Accounting export", "Tax write-off", "GL entry"]} />;
}

function CollectionActionsForCase({ rows, session, onAction }: { rows: SyncRecord[]; session: Session; onAction: (type: string, action?: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No collection actions yet. Add an internal note, promise, dispute, escalation, or follow-up.</div>;
  return <div className="wide-table"><table><thead><tr>{["Action Type", "Status", "Date", "Due At", "Completed At", "Actor", "Contact Method", "Outcome", "Follow-Up Required", "Follow-Up Due", "Note", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{actionLink(row.id, formatAction(row.action_type))}</td><td>{formatAction(row.action_status)}</td><td>{dateValue(row.action_date)}</td><td>{dateValue(row.due_at)}</td><td>{dateValue(row.completed_at)}</td><td>{textValue(row.actor_name ?? row.actor_user_id)}</td><td>{formatAction(row.contact_method)}</td><td>{formatAction(row.outcome)}</td><td>{row.follow_up_required ? "Yes" : "No"}</td><td>{dateValue(row.follow_up_due_at)}</td><td>{textValue(row.note)}</td><td><div className="form-actions"><ActionButton permission="collection_action.complete" session={session} disabled={actionInactive(row)} onClick={() => onAction("complete_action", row)}>Complete</ActionButton><ActionButton permission="collection_action.cancel" session={session} disabled={actionInactive(row)} onClick={() => onAction("cancel_action", row)}>Cancel</ActionButton><ActionButton permission="collection_action.archive" session={session} disabled={row.action_status === "archived"} onClick={() => onAction("archive_action", row)}>Archive</ActionButton></div></td></tr>)}</tbody></table></div>;
}

function CollectionCaseModal({ type, caseId, collectionCase, action, session, onClose, onSaved }: { type: string; caseId: string; collectionCase: SyncRecord; action: SyncRecord | null; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>(prefillActionForm(type));
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (type === "assign_owner") await syncosFetch(`/collection-cases/${caseId}/assign-owner`, { method: "POST", body: assignOwnerPayload(form), token: session.token });
      else if (type === "close_case") await syncosFetch(`/collection-cases/${caseId}/close`, { method: "POST", body: closeCasePayload(form), token: session.token });
      else if (type === "archive_case") await syncosFetch(`/collection-cases/${caseId}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      else if (type === "complete_action" && action?.id) await syncosFetch(`/collection-actions/${action.id}/complete`, { method: "POST", body: completeActionPayload(form), token: session.token });
      else if (type === "cancel_action" && action?.id) await syncosFetch(`/collection-actions/${action.id}/cancel`, { method: "POST", body: cancelActionPayload(form), token: session.token });
      else if (type === "archive_action" && action?.id) await syncosFetch(`/collection-actions/${action.id}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      else await syncosFetch(`/collection-cases/${caseId}/actions`, { method: "POST", body: actionCreatePayload(form), token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card" onSubmit={(event) => void submit(event)}>
        <div className="section-toolbar">
          <h2>{modalTitle(type)}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="warning-box">Collections actions do not send email/SMS, apply cash, create payment applications, reduce invoice balances, trigger legal filing, or execute write-offs.</div>
        {type === "assign_owner" ? <><input value={form.assigned_owner_user_id ?? ""} onChange={(event) => setForm({ ...form, assigned_owner_user_id: event.target.value })} placeholder="Assigned owner user ID" required /><label>Assignment Note<textarea value={form.assignment_note ?? ""} onChange={(event) => setForm({ ...form, assignment_note: event.target.value })} /></label></> : null}
        {type === "close_case" ? <><Select label="Close Reason" value={form.close_reason ?? ""} options={["", ...closeReasons]} onChange={(close_reason) => setForm({ ...form, close_reason })} required /><label>Close Note<textarea value={form.close_note ?? ""} onChange={(event) => setForm({ ...form, close_note: event.target.value })} /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label></> : null}
        {type === "archive_case" ? <ArchiveFields form={form} setForm={setForm} /> : null}
        {type === "add_action" || type.startsWith("add_") ? <ActionFields form={form} setForm={setForm} currentBalance={numberValue(collectionCase.current_balance, 0)} /> : null}
        {type === "complete_action" ? <><Select label="Outcome" value={form.outcome ?? ""} options={["", ...outcomes]} onChange={(outcome) => setForm({ ...form, outcome })} /><label>Note<textarea value={form.note ?? ""} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><label><input type="checkbox" checked={form.follow_up_required === "true"} onChange={(event) => setForm({ ...form, follow_up_required: event.target.checked ? "true" : "" })} /> Follow-up Required</label><label>Follow-Up Due At<input type="date" value={form.follow_up_due_at ?? ""} onChange={(event) => setForm({ ...form, follow_up_due_at: event.target.value })} /></label></> : null}
        {type === "cancel_action" ? <><label>Cancel Reason<textarea value={form.cancel_reason ?? ""} onChange={(event) => setForm({ ...form, cancel_reason: event.target.value })} required /></label><label>Cancel Note<textarea value={form.cancel_note ?? ""} onChange={(event) => setForm({ ...form, cancel_note: event.target.value })} /></label></> : null}
        {type === "archive_action" ? <ArchiveFields form={form} setForm={setForm} /> : null}
        <div className="form-actions">
          <button className="primary-button" type="submit">Submit</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function CollectionActionModal({ type, actionId, session, onClose, onSaved }: { type: string; actionId: string; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (type === "complete_action") await syncosFetch(`/collection-actions/${actionId}/complete`, { method: "POST", body: completeActionPayload(form), token: session.token });
      else if (type === "cancel_action") await syncosFetch(`/collection-actions/${actionId}/cancel`, { method: "POST", body: cancelActionPayload(form), token: session.token });
      else await syncosFetch(`/collection-actions/${actionId}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="modal-card" onSubmit={(event) => void submit(event)}><div className="section-toolbar"><h2>{modalTitle(type)}</h2><button type="button" onClick={onClose}>Close</button></div>{error ? <div className="error-banner">{error}</div> : null}{type === "complete_action" ? <><Select label="Outcome" value={form.outcome ?? ""} options={["", ...outcomes]} onChange={(outcome) => setForm({ ...form, outcome })} /><label>Note<textarea value={form.note ?? ""} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><label><input type="checkbox" checked={form.follow_up_required === "true"} onChange={(event) => setForm({ ...form, follow_up_required: event.target.checked ? "true" : "" })} /> Follow-up Required</label><label>Follow-Up Due At<input type="date" value={form.follow_up_due_at ?? ""} onChange={(event) => setForm({ ...form, follow_up_due_at: event.target.value })} /></label></> : type === "cancel_action" ? <><label>Cancel Reason<textarea value={form.cancel_reason ?? ""} onChange={(event) => setForm({ ...form, cancel_reason: event.target.value })} required /></label><label>Cancel Note<textarea value={form.cancel_note ?? ""} onChange={(event) => setForm({ ...form, cancel_note: event.target.value })} /></label></> : <ArchiveFields form={form} setForm={setForm} />}<div className="form-actions"><button className="primary-button" type="submit">Submit</button><button type="button" onClick={onClose}>Cancel</button></div></form></div>;
}

function ActionFields({ form, setForm, currentBalance }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; currentBalance: number }) {
  const type = form.action_type;
  return (
    <div className="form-grid">
      <Select label="Action Type" value={form.action_type ?? ""} options={["", ...actionTypes]} onChange={(action_type) => setForm({ ...form, action_type })} required />
      <Select label="Action Status" value={form.action_status ?? "planned"} options={["", ...actionStatuses]} onChange={(action_status) => setForm({ ...form, action_status })} />
      <label>Action Date<input type="date" value={form.action_date ?? ""} onChange={(event) => setForm({ ...form, action_date: event.target.value })} /></label>
      <label>Due At<input type="date" value={form.due_at ?? ""} onChange={(event) => setForm({ ...form, due_at: event.target.value })} /></label>
      <input value={form.contact_id ?? ""} onChange={(event) => setForm({ ...form, contact_id: event.target.value })} placeholder="Contact ID" />
      <Select label="Contact Method" value={form.contact_method ?? ""} options={["", ...contactMethods]} onChange={(contact_method) => setForm({ ...form, contact_method })} />
      <Select label="Outcome" value={form.outcome ?? ""} options={["", ...outcomes]} onChange={(outcome) => setForm({ ...form, outcome })} />
      <label>Note<textarea value={form.note ?? ""} onChange={(event) => setForm({ ...form, note: event.target.value })} required={type === "dispute_resolved" || type === "writeoff_review_requested"} /></label>
      <label>Promise Date<input type="date" value={form.promise_to_pay_date ?? ""} onChange={(event) => setForm({ ...form, promise_to_pay_date: event.target.value })} required={type === "promise_to_pay"} /></label>
      <label>Promise Amount<input type="number" step="0.01" max={currentBalance || undefined} value={form.promise_to_pay_amount ?? ""} onChange={(event) => setForm({ ...form, promise_to_pay_amount: event.target.value })} required={type === "promise_to_pay"} /></label>
      <label>Dispute Reason<textarea value={form.dispute_reason ?? ""} onChange={(event) => setForm({ ...form, dispute_reason: event.target.value })} required={type === "dispute_opened"} /></label>
      <label>Escalation Reason<textarea value={form.escalation_reason ?? ""} onChange={(event) => setForm({ ...form, escalation_reason: event.target.value })} required={type === "escalation_requested"} /></label>
      <label><input type="checkbox" checked={form.follow_up_required === "true"} onChange={(event) => setForm({ ...form, follow_up_required: event.target.checked ? "true" : "" })} /> Follow-Up Required</label>
      <label>Follow-Up Due<input type="date" value={form.follow_up_due_at ?? ""} onChange={(event) => setForm({ ...form, follow_up_due_at: event.target.value })} required={type === "follow_up_scheduled"} /></label>
      <input value={form.evidence_reference ?? ""} onChange={(event) => setForm({ ...form, evidence_reference: event.target.value })} placeholder="Evidence reference" />
      <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>
    </div>
  );
}

function ArchiveFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  const [token, setToken] = useState(session.token);
  const [permissionText, setPermissionText] = useState(session.permissions.join(", "));
  return (
    <section className="workspace-panel">
      <div className="section-toolbar">
        <h2>API Session</h2>
        <span>{session.permissions.length} permissions loaded</span>
      </div>
      <div className="session-grid">
        <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" />
        <input value={permissionText} onChange={(event) => setPermissionText(event.target.value)} placeholder="Permissions, comma separated" />
        <button type="button" onClick={() => { saveToken(token); savePermissions(permissionText.split(",").map((item) => item.trim()).filter(Boolean)); window.location.reload(); }}>Save Session</button>
      </div>
    </section>
  );
}

function useSession() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>(collectionsDefaultPermissions);
  useEffect(() => {
    const nextToken = readToken();
    setToken(nextToken);
    const stored = readPermissions();
    setPermissions(stored.length ? stored : collectionsDefaultPermissions);
    if (nextToken) {
      syncosFetch<{ permissions?: string[] }>("/auth/me/permissions", { token: nextToken }).then((result) => {
        if (Array.isArray(result.permissions)) {
          setPermissions(result.permissions);
          savePermissions(result.permissions);
        }
      }).catch(() => undefined);
    }
  }, []);
  return { token, permissions };
}

const collectionsDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "invoice.read",
  "cash_receipt.read",
  "payment_application.read",
  "organization.read",
  "collection_case.read",
  "collection_case.create",
  "collection_case.update",
  "collection_case.assign_owner",
  "collection_case.escalate",
  "collection_case.writeoff_review",
  "collection_case.close",
  "collection_case.archive",
  "collection_case.timeline.read",
  "collection_case.audit.read",
  "collection_action.read",
  "collection_action.create",
  "collection_action.update",
  "collection_action.complete",
  "collection_action.cancel",
  "collection_action.archive",
  "collection_action.timeline.read",
  "collection_action.audit.read",
];

function caseQuery(filters: Record<string, string>) {
  const query = new URLSearchParams();
  query.set("archived", filters.archived === "true" ? "true" : "false");
  for (const key of ["case_status", "collection_priority", "risk_level", "aging_bucket", "customer_organization_id", "invoice_id", "assigned_owner_user_id", "dispute_status", "escalation_status", "writeoff_review_status", "next_action_due_from", "next_action_due_to", "has_promise", "overdue_promise", "q"]) if (filters[key]) query.set(key, filters[key]);
  if (filters.sort) query.set("sort", filters.sort);
  return query;
}

async function loadInvoices(token: string) {
  try {
    return await syncosFetch<SyncRecord[]>("/invoices?archived=false&sort=balance_amount_desc", { token });
  } catch {
    return [];
  }
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function caseCreatePayload(form: Record<string, string>) {
  return prune({
    invoice_id: form.invoice_id,
    assigned_owner_user_id: form.assigned_owner_user_id,
    collection_priority: form.collection_priority,
    notes: form.notes,
    override_reasons: parseJsonField(form.override_reasons, "Override Reasons"),
  });
}

function casePatchPayload(form: Record<string, string>) {
  return prune({
    assigned_owner_user_id: form.assigned_owner_user_id,
    collection_priority: form.collection_priority,
    risk_level: form.risk_level,
    next_action_type: form.next_action_type,
    next_action_due_at: form.next_action_due_at,
    notes: form.notes,
    override_reasons: parseJsonField(form.override_reasons, "Override Reasons"),
  });
}

function assignOwnerPayload(form: Record<string, string>) {
  return prune({ assigned_owner_user_id: form.assigned_owner_user_id, assignment_note: form.assignment_note });
}

function closeCasePayload(form: Record<string, string>) {
  return prune({ close_reason: form.close_reason, close_note: form.close_note, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function archivePayload(form: Record<string, string>) {
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
}

function completeActionPayload(form: Record<string, string>) {
  return prune({ outcome: form.outcome, note: form.note, follow_up_required: form.follow_up_required === "true", follow_up_due_at: form.follow_up_due_at });
}

function cancelActionPayload(form: Record<string, string>) {
  return prune({ cancel_reason: form.cancel_reason, cancel_note: form.cancel_note });
}

function actionCreatePayload(form: Record<string, string>) {
  return prune({
    action_type: form.action_type,
    action_status: form.action_status,
    action_date: form.action_date,
    due_at: form.due_at,
    contact_id: form.contact_id,
    contact_method: form.contact_method,
    outcome: form.outcome,
    note: form.note,
    promise_to_pay_date: form.promise_to_pay_date,
    promise_to_pay_amount: numericOrUndefined(form.promise_to_pay_amount),
    dispute_reason: form.dispute_reason,
    escalation_reason: form.escalation_reason,
    follow_up_required: form.follow_up_required === "true",
    follow_up_due_at: form.follow_up_due_at,
    evidence_reference: form.evidence_reference,
    override_reasons: parseJsonField(form.override_reasons, "Override Reasons"),
  });
}

function prefillActionForm(type: string): Record<string, string> {
  if (type === "add_promise") return { action_type: "promise_to_pay" };
  if (type === "add_dispute_opened") return { action_type: "dispute_opened" };
  if (type === "add_dispute_updated") return { action_type: "dispute_updated" };
  if (type === "add_dispute_resolved") return { action_type: "dispute_resolved" };
  if (type === "add_escalation_requested") return { action_type: "escalation_requested" };
  if (type === "add_escalation_approved") return { action_type: "escalation_approved" };
  if (type === "add_writeoff_review") return { action_type: "writeoff_review_requested" };
  return {};
}

function buildCaseSummary(rows: SyncRecord[]) {
  const summary = { total: rows.length, status: {} as Record<string, number>, aging: {} as Record<string, number>, risk: {} as Record<string, number>, writeoff: {} as Record<string, number>, dueFollowUp: 0 };
  const today = new Date().toISOString().slice(0, 10);
  for (const row of rows) {
    increment(summary.status, String(row.case_status ?? ""));
    increment(summary.aging, String(row.aging_bucket ?? ""));
    increment(summary.risk, String(row.risk_level ?? ""));
    increment(summary.writeoff, String(row.writeoff_review_status ?? ""));
    if (row.next_action_due_at && String(row.next_action_due_at).slice(0, 10) <= today && !["closed", "resolved", "archived"].includes(String(row.case_status))) summary.dueFollowUp += 1;
  }
  return summary;
}

function caseMatches(row: SyncRecord, filters: Record<string, string>) {
  if (filters.dueToday && String(row.next_action_due_at).slice(0, 10) !== new Date().toISOString().slice(0, 10)) return false;
  if (filters.overdueFollowUp && String(row.next_action_due_at).slice(0, 10) >= new Date().toISOString().slice(0, 10)) return false;
  return true;
}

function actionMatches(_row: SyncRecord, _filters: Record<string, string>) {
  return true;
}

function sortCases(rows: SyncRecord[], sort?: string) {
  const priorityRank: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  const riskRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const agingRank: Record<string, number> = { "90_plus": 5, "61_90": 4, "31_60": 3, "1_30": 2, current: 1 };
  return [...rows].sort((a, b) => {
    if (sort === "aging_desc") return (agingRank[String(b.aging_bucket)] ?? 0) - (agingRank[String(a.aging_bucket)] ?? 0);
    if (sort === "balance_desc") return numberValue(b.current_balance, 0) - numberValue(a.current_balance, 0);
    if (sort === "priority_desc") return (priorityRank[String(b.collection_priority)] ?? 0) - (priorityRank[String(a.collection_priority)] ?? 0);
    if (sort === "next_action_due_asc") return String(a.next_action_due_at ?? "9999").localeCompare(String(b.next_action_due_at ?? "9999"));
    if (sort === "opened_desc") return String(b.opened_at ?? "").localeCompare(String(a.opened_at ?? ""));
    if (sort === "case_number") return String(a.case_number ?? "").localeCompare(String(b.case_number ?? ""));
    return (riskRank[String(b.risk_level)] ?? 0) - (riskRank[String(a.risk_level)] ?? 0) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });
}

function caseChecklist(collectionCase: SyncRecord, detail: CollectionCaseDetailShape): Array<[string, unknown]> {
  return [
    ["Invoice balance open", numberValue(detail.invoice_context?.balance_amount ?? collectionCase.current_balance, 0) > 0],
    ["Customer identified", !!collectionCase.customer_organization_id],
    ["Owner assigned", !!collectionCase.assigned_owner_user_id],
    ["Next action scheduled", !!collectionCase.next_action_due_at],
    ["Promise tracked if applicable", collectionCase.case_status !== "promise_to_pay" || !!collectionCase.promise_to_pay_date],
    ["Dispute tracked if applicable", collectionCase.dispute_status === "none" || collectionCase.dispute_status],
    ["Escalation tracked if applicable", collectionCase.escalation_status === "none" || collectionCase.escalation_status],
    ["No cash/payment created", true],
    ["No balance reduced", true],
  ];
}

function caseInactive(row: SyncRecord) {
  return ["closed", "resolved", "archived"].includes(String(row.case_status));
}

function actionInactive(row: SyncRecord) {
  return ["completed", "cancelled", "archived"].includes(String(row.action_status));
}

function modalTitle(type: string) {
  if (type === "assign_owner") return "Assign Owner";
  if (type === "close_case") return "Close Case";
  if (type === "archive_case") return "Archive Case";
  if (type === "complete_action") return "Complete Action";
  if (type === "cancel_action") return "Cancel Action";
  if (type === "archive_action") return "Archive Action";
  return "Add Collection Action";
}

function actionNotice(type: string) {
  if (type.includes("promise")) return "Promise-to-pay recorded. Invoice balance was not changed.";
  if (type.includes("dispute")) return "Dispute action recorded. Balance was not reduced.";
  if (type.includes("escalation")) return "Escalation recorded. No legal or agency workflow was triggered.";
  if (type.includes("writeoff")) return "Write-off review flagged only. No accounting or tax write-off was executed.";
  return "Collections action completed without cash movement or invoice balance reduction.";
}

function plainError(message: string) {
  if (!message) return "Collections action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("collection case not found")) return "Collection case not found or no access.";
  if (message.includes("collection action not found")) return "Collection action not found or no access.";
  if (message.includes("balance")) return "Invoice must have an open balance unless override is supplied. Collections does not apply payments or reduce invoice balances.";
  if (message.includes("paid")) return "A paid invoice cannot enter active collections without override.";
  if (message.includes("active collection case")) return "Duplicate active case is not allowed without override.";
  if (message.includes("promise")) return "Promise-to-pay requires date and amount.";
  if (message.includes("dispute")) return "Dispute action requires a reason.";
  if (message.includes("escalation")) return "Escalation action requires a reason.";
  if (message.includes("close")) return "Close reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

function Select({ label, value, options, labels = {}, onChange, disabled, required }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void; disabled?: boolean; required?: boolean }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? formatAction(option)}</option>)}</select></label>;
}

function SummaryCard({ label, value, onClick }: { label: string; value: unknown; onClick: () => void }) {
  return <button type="button" className="summary-card" onClick={onClick}><span>{label}</span><strong>{formatCell(value)}</strong></button>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="summary-card"><span>{label}</span><strong>{value}</strong></div>;
}

function ActionButton({ permission, session, disabled, onClick, children }: { permission: string; session: Session; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled || !hasPermission(session.permissions, permission)} onClick={onClick}>{children}</button>;
}

function Checklist({ items }: { items: Array<[string, unknown]> }) {
  return <div className="checklist">{items.map(([label, ok]) => <div className="metric-row" key={label}><span className="label">{label}</span><span className="badge">{ok ? "Yes" : "No"}</span></div>)}</div>;
}

function PlaceholderPanel({ title, message, columns }: { title: string; message: string; columns: string[] }) {
  return <Panel title={title}><div className="warning-box">{message}</div><ObjectTable rows={[]} columns={columns} /></Panel>;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{value === undefined || value === null || value === "" ? "Not captured" : JSON.stringify(value, null, 2)}</pre>;
}

function caseLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/collections/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function actionLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/collection-actions/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function invoiceLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/invoices/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function organizationLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/intelligence/organizations/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function labelsFor(rows: SyncRecord[], preferred = "name") {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.invoice_number ?? row.case_number, String(row.id))]));
}

function increment(target: Record<string, number>, key: string) {
  if (!key) return;
  target[key] = (target[key] ?? 0) + 1;
}

function money(value: unknown) {
  const amount = numberValue(value, NaN);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "Not captured";
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function formatAction(value: unknown) {
  if (!value) return "Not captured";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

const agingLabels: Record<string, string> = { current: "Current", "1_30": "1-30", "31_60": "31-60", "61_90": "61-90", "90_plus": "90+" };

function formatAging(value: unknown) {
  return agingLabels[String(value)] ?? formatAction(value);
}

function dateInput(value: unknown) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function jsonText(value: unknown) {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseJsonField(value: string | undefined, field: string) {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${field} must be valid JSON.`);
  }
}

function numericOrUndefined(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function prune(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}
