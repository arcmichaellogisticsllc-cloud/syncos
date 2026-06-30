"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell, ObjectTable, Panel } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const payableTypes = ["subcontractor", "crew", "worker_later", "vendor_later", "internal_self_perform", "adjustment", "retainage_release", "chargeback"];
const partyTypes = ["capacity_provider", "crew", "worker_later", "vendor_later", "internal_self_perform"];
const payableStatuses = ["draft", "assembling", "ready_for_review", "under_review", "approved", "rejected", "held", "disputed", "payment_ready", "payment_created_later", "partially_paid_later", "paid_later", "voided", "archived"];
const approvalStatuses = ["not_submitted", "pending", "approved", "rejected", "withdrawn"];
const readinessStatuses = ["not_ready", "ready_with_warning", "ready_for_payment", "blocked"];
const paymentStatuses = ["not_paid", "partially_paid_later", "paid_later", "held", "disputed"];
const complianceStatuses = ["unknown", "missing", "incomplete", "ready", "expired", "blocked"];
const taxStatuses = ["unknown", "missing_w9", "ready", "expired", "blocked"];
const disputeStatuses = ["none", "open", "under_review", "resolved", "rejected"];
const holdStatuses = ["none", "hold", "released"];
const itemTypes = ["labor", "subcontractor_production", "equipment", "material_reimbursement", "retainage_hold", "retainage_release", "deduction", "chargeback", "adjustment", "correction", "bonus", "penalty"];
const itemStatuses = ["draft", "ready", "approved", "held", "disputed", "payment_ready", "payment_created_later", "voided", "archived"];
const tabs = ["overview", "payable_items", "payable_party", "provider_crew_context", "settlement_context", "project_context", "financial_summary", "compliance_tax_readiness", "retainage", "deductions_chargebacks", "holds_disputes", "approval", "payment_readiness", "timeline", "audit", "future_payment", "future_payroll", "future_bank_accounting"];

type Session = ReturnType<typeof useSession>;

type DetailShape = {
  contractor_payable?: SyncRecord;
  contractor_payable_items?: SyncRecord[];
  payable_party_context?: SyncRecord | null;
  provider_context?: SyncRecord | null;
  crew_context?: SyncRecord | null;
  project_context?: SyncRecord | null;
  settlement_context?: SyncRecord | null;
  financial_summary?: SyncRecord;
  compliance_summary?: SyncRecord;
  tax_document_summary?: SyncRecord;
  retainage_summary?: SyncRecord;
  deduction_chargeback_summary?: SyncRecord;
  hold_dispute_summary?: SyncRecord;
  payment_boundary_summary?: SyncRecord;
  warnings?: unknown[];
  blockers?: unknown[];
  required_override_fields?: unknown[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  providers: SyncRecord[];
  crews: SyncRecord[];
  projects: SyncRecord[];
  settlements: SyncRecord[];
  settlementItems: SyncRecord[];
};

const emptyRelated: RelatedData = { providers: [], crews: [], projects: [], settlements: [], settlementItems: [] };

export function ContractorPayableQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = payableQuery(filters);
      setRows(await syncosFetch<SyncRecord[]>(`/contractor-payables?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortPayables(rows.filter((row) => payableMatches(row, filters)), filters.sort), [rows, filters]);
  const summary = useMemo(() => buildSummary(rows), [rows]);

  return (
    <PayableShell title="Contractor Payable Queue" purpose="Control approved money-out obligations before payment or payroll without creating cash movement, bank transactions, tax filings, or accounting exports.">
      <SessionPanel session={session} />
      <div className="warning-box">Contractor Payable stops at payment readiness. Payment Ready does not create payroll, ACH, card payout, check, bank transaction, tax filing, or accounting export records.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view contractor payables.</div> : null}
      {loading ? <div className="empty-state">Loading contractor payables...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Contractor Payable Summary</h2>
                <p className="muted">Blocked, held, disputed, review-ready, approved, and due payables stay visible before payment readiness.</p>
              </div>
              <Link className="primary-button" href="/contractor-payables/new" aria-disabled={!hasPermission(session.permissions, "contractor_payable.create")}>Create Contractor Payable</Link>
            </div>
            <div className="summary-grid">
              <SummaryCard label="Total Payables" value={summary.total} onClick={() => setFilters({ archived: "false", sort: "updated_desc" })} />
              {["draft", "assembling", "ready_for_review", "under_review", "approved", "rejected", "held", "disputed", "payment_ready", "payment_created_later", "partially_paid_later", "paid_later", "voided", "archived"].map((status) => <SummaryCard key={status} label={formatAction(status)} value={summary.status[status] ?? 0} onClick={() => setFilters({ archived: status === "archived" ? "true" : "false", status, sort: "updated_desc" })} />)}
              {["subcontractor", "crew", "internal_self_perform"].map((payable_type) => <SummaryCard key={payable_type} label={formatAction(payable_type)} value={summary.type[payable_type] ?? 0} onClick={() => setFilters({ ...filters, payable_type })} />)}
              <SummaryCard label="Compliance Blocked" value={summary.compliance.blocked ?? 0} onClick={() => setFilters({ ...filters, compliance_status: "blocked" })} />
              <SummaryCard label="Tax Docs Missing" value={summary.tax.missing_w9 ?? 0} onClick={() => setFilters({ ...filters, tax_document_status: "missing_w9" })} />
              <SummaryCard label="Retainage Held" value={summary.retainageHeld} onClick={() => setFilters({ ...filters, hasRetainage: "true" })} />
              <SummaryCard label="Net Payable" value={money(summary.netPayable)} onClick={() => setFilters({ ...filters, sort: "net_amount_desc" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "updated_desc" })}>Reset</button>
            </div>
            <div className="tab-row">
              {["draft", "ready_for_review", "under_review", "approved", "held", "disputed", "payment_ready"].map((status) => <button key={status} type="button" onClick={() => setFilters({ ...filters, status })}>{formatAction(status)}</button>)}
              {["subcontractor", "crew"].map((payable_type) => <button key={payable_type} type="button" onClick={() => setFilters({ ...filters, payable_type })}>{formatAction(payable_type)}</button>)}
              <button type="button" onClick={() => setFilters({ ...filters, compliance_status: "blocked" })}>Compliance Blocked</button>
              <button type="button" onClick={() => setFilters({ ...filters, tax_document_status: "missing_w9" })}>Tax Docs Missing</button>
              <button type="button" onClick={() => setFilters({ ...filters, hasRetainage: "true" })}>Retainage</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search payable, provider, crew, project, settlement" />
              <Select label="Payable Type" value={filters.payable_type ?? ""} options={["", ...payableTypes]} onChange={(payable_type) => setFilters({ ...filters, payable_type })} />
              <Select label="Party Type" value={filters.payable_party_type ?? ""} options={["", ...partyTypes]} onChange={(payable_party_type) => setFilters({ ...filters, payable_party_type })} />
              <Select label="Status" value={filters.status ?? ""} options={["", ...payableStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
              <Select label="Approval Status" value={filters.approval_status ?? ""} options={["", ...approvalStatuses]} onChange={(approval_status) => setFilters({ ...filters, approval_status })} />
              <Select label="Payment Readiness" value={filters.payment_readiness_status ?? ""} options={["", ...readinessStatuses]} onChange={(payment_readiness_status) => setFilters({ ...filters, payment_readiness_status })} />
              <Select label="Payment Status" value={filters.payment_status ?? ""} options={["", ...paymentStatuses]} onChange={(payment_status) => setFilters({ ...filters, payment_status })} />
              <input value={filters.capacity_provider_id ?? ""} onChange={(event) => setFilters({ ...filters, capacity_provider_id: event.target.value })} placeholder="Provider" />
              <input value={filters.crew_id ?? ""} onChange={(event) => setFilters({ ...filters, crew_id: event.target.value })} placeholder="Crew" />
              <input value={filters.project_id ?? ""} onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} placeholder="Project" />
              <input value={filters.settlement_id ?? ""} onChange={(event) => setFilters({ ...filters, settlement_id: event.target.value })} placeholder="Settlement" />
              <Select label="Compliance" value={filters.compliance_status ?? ""} options={["", ...complianceStatuses]} onChange={(compliance_status) => setFilters({ ...filters, compliance_status })} />
              <Select label="Tax Documents" value={filters.tax_document_status ?? ""} options={["", ...taxStatuses]} onChange={(tax_document_status) => setFilters({ ...filters, tax_document_status })} />
              <Select label="Dispute Status" value={filters.dispute_status ?? ""} options={["", ...disputeStatuses]} onChange={(dispute_status) => setFilters({ ...filters, dispute_status })} />
              <Select label="Hold Status" value={filters.hold_status ?? ""} options={["", ...holdStatuses]} onChange={(hold_status) => setFilters({ ...filters, hold_status })} />
              <label>Pay Cycle Start<input type="date" value={filters.pay_cycle_start ?? ""} onChange={(event) => setFilters({ ...filters, pay_cycle_start: event.target.value })} /></label>
              <label>Pay Cycle End<input type="date" value={filters.pay_cycle_end ?? ""} onChange={(event) => setFilters({ ...filters, pay_cycle_end: event.target.value })} /></label>
              <label>Due From<input type="date" value={filters.due_date_from ?? ""} onChange={(event) => setFilters({ ...filters, due_date_from: event.target.value })} /></label>
              <label>Due To<input type="date" value={filters.due_date_to ?? ""} onChange={(event) => setFilters({ ...filters, due_date_to: event.target.value })} /></label>
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "due_date_asc", "net_amount_desc", "status", "payable_number", "payment_readiness"]} labels={{ updated_desc: "Recently Updated", due_date_asc: "Due Date Soonest", net_amount_desc: "Net Amount Highest", status: "Status", payable_number: "Payable Number", payment_readiness: "Payment Readiness" }} onChange={(sort) => setFilters({ ...filters, sort })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Contractor Payables</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No contractor payables yet. Create a payable and add payable-ready settlement items.</div> : <PayableTable rows={visible} />}
          </section>
        </>
      ) : null}
    </PayableShell>
  );
}

export function ContractorPayableCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ payable_type: "subcontractor", payable_party_type: "capacity_provider", compliance_status: "unknown", tax_document_status: "unknown" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/contractor-payables", { method: "POST", body: payableCreatePayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? after?.id ?? "");
      router.push(id ? `/contractor-payables/${id}` : "/contractor-payables");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <PayableShell title="Create Contractor Payable" purpose="Create an obligation shell without creating payment, payroll, bank, tax, accounting, contractor portal, or vendor portal records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Backend validation is authoritative. Creating a payable does not create payment, payroll, bank transaction, or accounting export records.</div>
        <PayableFormFields form={form} setForm={setForm} related={related} includeCreate />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "contractor_payable.create")}>Create Contractor Payable</button>
          <Link className="link-button" href="/contractor-payables">Cancel</Link>
        </div>
      </form>
    </PayableShell>
  );
}

export function ContractorPayableEdit({ payableId }: { payableId: string }) {
  const router = useRouter();
  const session = useSession();
  const [record, setRecord] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const next = await syncosFetch<SyncRecord>(`/contractor-payables/${payableId}`, { token: session.token });
        setRecord(next);
        setForm({
          pay_cycle_start: dateInput(next.pay_cycle_start),
          pay_cycle_end: dateInput(next.pay_cycle_end),
          due_date: dateInput(next.due_date),
          compliance_status: String(next.compliance_status ?? ""),
          tax_document_status: String(next.tax_document_status ?? ""),
          hold_note: String(next.hold_note ?? ""),
          dispute_note: String(next.dispute_note ?? ""),
          override_reasons: jsonText(next.override_reasons),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, payableId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/contractor-payables/${payableId}`, { method: "PATCH", body: payablePatchPayload(form), token: session.token });
      router.push(`/contractor-payables/${payableId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  const readonly = ["voided", "archived", "payment_created_later", "paid_later"].includes(String(record?.status));
  return (
    <PayableShell title="Edit Contractor Payable" purpose="Edit payment-readiness context without creating payment, payroll, bank, tax, or accounting activity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Contractor payable not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Cannot create payment, payroll, or mark paid from this form. Lifecycle states use backend action routes.</div>
          <PayableFormFields form={form} setForm={setForm} related={emptyRelated} disabled={readonly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readonly || !hasPermission(session.permissions, "contractor_payable.update")}>Save Payable</button>
            <Link className="link-button" href={`/contractor-payables/${payableId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </PayableShell>
  );
}

export function ContractorPayableDetail({ payableId }: { payableId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<DetailShape | null>(null);
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [selectedItem, setSelectedItem] = useState<SyncRecord | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const [next, nextRelated] = await Promise.all([
        syncosFetch<DetailShape>(`/contractor-payables/${payableId}/detail`, { token: session.token }),
        loadRelated(session.token),
      ]);
      const [timeline, audit] = await Promise.all([
        optionalList(`/contractor-payables/${payableId}/timeline`, session.token),
        optionalList(`/contractor-payables/${payableId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
      setRelated(nextRelated);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, payableId]);

  const payable = detail?.contractor_payable;
  const items = detail?.contractor_payable_items ?? [];

  function openAction(type: string, item?: SyncRecord) {
    setSelectedItem(item ?? null);
    setModal(type);
  }

  return (
    <PayableShell title="Contractor Payable Detail" purpose="Show money-out obligation truth before future Payment or Payroll workflows consume payment-ready payables.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Contractor Payable Detail.</div> : null}
      {!payable && session.token && !error ? <div className="empty-state">Contractor payable not found or no access.</div> : null}
      {payable && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(payable.payable_number, "Contractor Payable")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(payable.payable_type)}</span>
                  <span className="badge">{formatAction(payable.status)}</span>
                  <span className="badge">{formatAction(payable.approval_status)}</span>
                  <span className="badge">{formatAction(payable.payment_readiness_status)}</span>
                  <span className="badge">{formatAction(payable.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/contractor-payables/${payableId}/edit`} aria-disabled={!hasPermission(session.permissions, "contractor_payable.update")}>Edit Payable</Link>
                <ActionButton permission="contractor_payable.add_item" session={session} disabled={payableInactive(payable)} onClick={() => openAction("add_item")}>Add Payable Item</ActionButton>
                <ActionButton permission="contractor_payable.recalculate_totals" session={session} disabled={payableInactive(payable)} onClick={() => openAction("recalculate")}>Recalculate Totals</ActionButton>
                <ActionButton permission="contractor_payable.submit_review" session={session} disabled={payableInactive(payable)} onClick={() => openAction("submit_review")}>Submit Review</ActionButton>
                <ActionButton permission="contractor_payable.start_review" session={session} disabled={payableInactive(payable)} onClick={() => openAction("start_review")}>Start Review</ActionButton>
                <ActionButton permission="contractor_payable.approve" session={session} disabled={payableInactive(payable)} onClick={() => openAction("approve")}>Approve</ActionButton>
                <ActionButton permission="contractor_payable.reject" session={session} disabled={payableInactive(payable)} onClick={() => openAction("reject")}>Reject</ActionButton>
                <ActionButton permission="contractor_payable.mark_payment_ready" session={session} disabled={payableInactive(payable)} onClick={() => openAction("payment_ready")}>Mark Payment Ready</ActionButton>
                <ActionButton permission="contractor_payable.place_hold" session={session} disabled={payableInactive(payable)} onClick={() => openAction("place_hold")}>Place Hold</ActionButton>
                <ActionButton permission="contractor_payable.release_hold" session={session} disabled={payableInactive(payable)} onClick={() => openAction("release_hold")}>Release Hold</ActionButton>
                <ActionButton permission="contractor_payable.dispute" session={session} disabled={payableInactive(payable)} onClick={() => openAction("dispute")}>Dispute</ActionButton>
                <ActionButton permission="contractor_payable.resolve_dispute" session={session} disabled={payableInactive(payable)} onClick={() => openAction("resolve_dispute")}>Resolve Dispute</ActionButton>
                <ActionButton permission="contractor_payable.void" session={session} disabled={payable.status === "voided" || payable.status === "archived"} onClick={() => openAction("void")}>Void</ActionButton>
                <ActionButton permission="contractor_payable.archive" session={session} disabled={payable.status === "archived"} onClick={() => openAction("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Gross Payable Amount" value={money(payable.gross_payable_amount)} />
              <Metric label="Deduction Amount" value={money(payable.deduction_amount)} />
              <Metric label="Chargeback Amount" value={money(payable.chargeback_amount)} />
              <Metric label="Retainage Amount" value={money(payable.retainage_amount)} />
              <Metric label="Net Payable Amount" value={money(payable.net_payable_amount)} />
              <Metric label="Approval Status" value={formatAction(payable.approval_status)} />
              <Metric label="Payment Readiness" value={formatAction(payable.payment_readiness_status)} />
              <Metric label="Payment Status" value={formatAction(payable.payment_status)} />
              <Metric label="Compliance Status" value={formatAction(payable.compliance_status)} />
              <Metric label="Tax Document Status" value={formatAction(payable.tax_document_status)} />
              <Metric label="Hold Status" value={formatAction(payable.hold_status)} />
              <Metric label="Dispute Status" value={formatAction(payable.dispute_status)} />
              <Metric label="Item Count" value={formatCell(payable.item_count ?? items.length)} />
            </div>
            <div className="warning-box">Contractor Payable does not send payment. Payment Ready does not create payroll, ACH, card payout, check, or bank transaction. Payroll and Payment Execution are future workflows.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Payable Party</dt><dd>{formatAction(payable.payable_party_type)}</dd>
                <dt>Provider</dt><dd>{providerLink(payable.capacity_provider_id, payable.capacity_provider_name ?? detail.provider_context?.name)}</dd>
                <dt>Crew</dt><dd>{crewLink(payable.crew_id, payable.crew_name ?? detail.crew_context?.name)}</dd>
                <dt>Project</dt><dd>{projectLink(payable.project_id, payable.project_name ?? detail.project_context?.name)}</dd>
                <dt>Settlement</dt><dd>{settlementLink(payable.settlement_id, payable.settlement_number ?? detail.settlement_context?.settlement_number)}</dd>
                <dt>Pay Cycle</dt><dd>{dateValue(payable.pay_cycle_start)} to {dateValue(payable.pay_cycle_end)}</dd>
                <dt>Due Date</dt><dd>{dateValue(payable.due_date)}</dd>
                <dt>Approval</dt><dd>{formatAction(payable.approval_status)}</dd>
                <dt>Payment Readiness</dt><dd>{formatAction(payable.payment_readiness_status)}</dd>
                <dt>Payment Status</dt><dd>{formatAction(payable.payment_status)}</dd>
                <dt>Compliance</dt><dd>{formatAction(payable.compliance_status)}</dd>
                <dt>Tax Docs</dt><dd>{formatAction(payable.tax_document_status)}</dd>
                <dt>Hold / Dispute</dt><dd>{formatAction(payable.hold_status)} / {formatAction(payable.dispute_status)}</dd>
              </dl>
              <Checklist items={payableChecklist(payable, items)} />
              <div className="warning-box">No payment created. No payroll created. No bank, tax, accounting, contractor portal, or vendor portal action is available here.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <PayableTab tab={tab} detail={detail} payable={payable} items={items} session={session} onAction={openAction} />
            </section>
          </div>
          {modal ? <PayableModal type={modal} payableId={payableId} payable={payable} item={selectedItem} related={related} session={session} onClose={() => { setModal(""); setSelectedItem(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </PayableShell>
  );
}

function PayableShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/contractor-payables", "Contractor Payable Queue", "active"],
    ["/contractor-payables/new", "Create Payable", "active"],
    ["#detail", "Contractor Payable Detail", "placeholder"],
    ["#items", "Payable Items", "placeholder"],
    ["#party", "Payable Party", "placeholder"],
    ["#provider-crew", "Provider / Crew Context", "placeholder"],
    ["#settlement", "Settlement Context", "placeholder"],
    ["#project", "Project Context", "placeholder"],
    ["#financial", "Financial Summary", "placeholder"],
    ["#compliance-tax", "Compliance / Tax Readiness", "placeholder"],
    ["#retainage", "Retainage", "placeholder"],
    ["#deductions", "Deductions / Chargebacks", "placeholder"],
    ["#holds", "Holds & Disputes", "placeholder"],
    ["#approval", "Approval", "placeholder"],
    ["#payment-readiness", "Payment Readiness", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-payment", "Future Payment", "placeholder"],
    ["#future-payroll", "Future Payroll", "placeholder"],
    ["#future-bank-accounting", "Future Bank / Accounting", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Contractor Payables</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function PayableTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Payable Number", "Payable Type", "Payable Party Type", "Status", "Approval Status", "Payment Readiness Status", "Payment Status", "Provider", "Crew", "Project", "Settlement", "Pay Cycle Start", "Pay Cycle End", "Due Date", "Gross Payable Amount", "Deduction Amount", "Chargeback Amount", "Retainage Amount", "Net Payable Amount", "Compliance Status", "Tax Document Status", "Dispute Status", "Hold Status", "Item Count", "Recommended Next Action", "Updated Date"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{payableLink(row.id, row.payable_number)}</td><td>{formatAction(row.payable_type)}</td><td>{formatAction(row.payable_party_type)}</td><td>{formatAction(row.status)}</td><td>{formatAction(row.approval_status)}</td><td>{formatAction(row.payment_readiness_status)}</td><td>{formatAction(row.payment_status)}</td><td>{providerLink(row.capacity_provider_id, row.capacity_provider_name)}</td><td>{crewLink(row.crew_id, row.crew_name)}</td><td>{projectLink(row.project_id, row.project_name)}</td><td>{settlementLink(row.settlement_id, row.settlement_number)}</td><td>{dateValue(row.pay_cycle_start)}</td><td>{dateValue(row.pay_cycle_end)}</td><td>{dateValue(row.due_date)}</td><td>{money(row.gross_payable_amount)}</td><td>{money(row.deduction_amount)}</td><td>{money(row.chargeback_amount)}</td><td>{money(row.retainage_amount)}</td><td>{money(row.net_payable_amount)}</td><td>{formatAction(row.compliance_status)}</td><td>{formatAction(row.tax_document_status)}</td><td>{formatAction(row.dispute_status)}</td><td>{formatAction(row.hold_status)}</td><td>{formatCell(row.item_count)}</td><td>{formatAction(row.recommended_next_action)}</td><td>{dateValue(row.updated_at)}</td></tr>)}</tbody></table></div>;
}

function PayableTab({ tab, detail, payable, items, session, onAction }: { tab: string; detail: DetailShape; payable: SyncRecord; items: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Payable number</dt><dd>{textValue(payable.payable_number)}</dd><dt>Payable type</dt><dd>{formatAction(payable.payable_type)}</dd><dt>Payable party type</dt><dd>{formatAction(payable.payable_party_type)}</dd><dt>Status</dt><dd>{formatAction(payable.status)}</dd><dt>Approval status</dt><dd>{formatAction(payable.approval_status)}</dd><dt>Payment readiness</dt><dd>{formatAction(payable.payment_readiness_status)}</dd><dt>Payment status</dt><dd>{formatAction(payable.payment_status)}</dd><dt>Pay cycle</dt><dd>{dateValue(payable.pay_cycle_start)} to {dateValue(payable.pay_cycle_end)}</dd><dt>Due date</dt><dd>{dateValue(payable.due_date)}</dd><dt>Override reasons</dt><dd><JsonBlock value={payable.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(payable.created_at)}</dd><dt>Updated</dt><dd>{dateValue(payable.updated_at)}</dd></dl><div className="warning-box">Contractor Payable represents an approved obligation before money movement. It does not create payroll, ACH, card payout, check, bank transaction, tax filing, or accounting export records.</div></Panel>;
  if (tab === "payable_items") return <Panel title="Payable Items"><div className="form-actions"><ActionButton permission="contractor_payable.add_item" session={session} disabled={payableInactive(payable)} onClick={() => onAction("add_item")}>Add Item From Settlement Item</ActionButton></div><PayableItemsTable rows={items} session={session} onAction={onAction} /><div className="warning-box">Adding, editing, voiding, or archiving payable items creates no payment or payroll records.</div></Panel>;
  if (tab === "payable_party") return <Panel title="Payable Party"><dl className="detail-list"><dt>Payable party type</dt><dd>{formatAction(payable.payable_party_type)}</dd><dt>Capacity provider</dt><dd>{providerLink(payable.capacity_provider_id, payable.capacity_provider_name ?? detail.provider_context?.name)}</dd><dt>Crew</dt><dd>{crewLink(payable.crew_id, payable.crew_name ?? detail.crew_context?.name)}</dd><dt>Worker ID</dt><dd>{textValue(payable.worker_id)}</dd><dt>Vendor Organization ID</dt><dd>{textValue(payable.vendor_organization_id)}</dd><dt>Internal Self-Perform</dt><dd>{payable.payable_party_type === "internal_self_perform" ? "Yes" : "No"}</dd><dt>Party context</dt><dd><JsonBlock value={detail.payable_party_context} /></dd></dl><div className="warning-box">Provider/crew payable readiness does not create payout.</div></Panel>;
  if (tab === "provider_crew_context") return <Panel title="Provider / Crew Context"><dl className="detail-list"><dt>Provider</dt><dd>{providerLink(payable.capacity_provider_id, detail.provider_context?.name ?? payable.capacity_provider_name)}</dd><dt>Crew</dt><dd>{crewLink(payable.crew_id, detail.crew_context?.name ?? payable.crew_name)}</dd><dt>Compliance status</dt><dd>{formatAction(payable.compliance_status)}</dd><dt>Tax readiness</dt><dd>{formatAction(payable.tax_document_status)}</dd><dt>Provider context</dt><dd><JsonBlock value={detail.provider_context} /></dd><dt>Crew context</dt><dd><JsonBlock value={detail.crew_context} /></dd></dl></Panel>;
  if (tab === "settlement_context") return <Panel title="Settlement Context"><dl className="detail-list"><dt>Settlement</dt><dd>{settlementLink(payable.settlement_id, payable.settlement_number ?? detail.settlement_context?.settlement_number)}</dd><dt>Settlement type</dt><dd>{formatAction(detail.settlement_context?.settlement_type)}</dd><dt>Settlement status</dt><dd>{formatAction(detail.settlement_context?.status)}</dd><dt>Payable ready</dt><dd>{boolText(detail.settlement_context?.payable_ready)}</dd><dt>Contractor payable amount</dt><dd>{money(detail.settlement_context?.contractor_payable_amount)}</dd><dt>Retainage</dt><dd>{money(detail.settlement_context?.retainage_amount)}</dd><dt>Deductions</dt><dd>{money(detail.settlement_context?.deduction_amount)}</dd><dt>Chargebacks</dt><dd>{money(detail.settlement_context?.chargeback_amount)}</dd></dl></Panel>;
  if (tab === "project_context") return <Panel title="Project Context"><dl className="detail-list"><dt>Project</dt><dd>{projectLink(payable.project_id, payable.project_name ?? detail.project_context?.name)}</dd><dt>Project status</dt><dd>{formatAction(detail.project_context?.status)}</dd><dt>Customer</dt><dd>{textValue(detail.project_context?.customer_name ?? detail.project_context?.customer_organization_id)}</dd><dt>Territory</dt><dd>{textValue(detail.project_context?.territory)}</dd><dt>Work type</dt><dd>{formatAction(detail.project_context?.work_type)}</dd><dt>Project manager</dt><dd>{textValue(detail.project_context?.project_manager)}</dd><dt>Field supervisor</dt><dd>{textValue(detail.project_context?.field_supervisor)}</dd></dl></Panel>;
  if (tab === "financial_summary") return <Panel title="Financial Summary"><dl className="detail-list"><dt>Gross payable</dt><dd>{money(payable.gross_payable_amount)}</dd><dt>Deduction amount</dt><dd>{money(payable.deduction_amount)}</dd><dt>Chargeback amount</dt><dd>{money(payable.chargeback_amount)}</dd><dt>Retainage amount</dt><dd>{money(payable.retainage_amount)}</dd><dt>Net payable</dt><dd>{money(payable.net_payable_amount)}</dd><dt>Item count</dt><dd>{formatCell(payable.item_count ?? items.length)}</dd><dt>Pay cycle start</dt><dd>{dateValue(payable.pay_cycle_start)}</dd><dt>Pay cycle end</dt><dd>{dateValue(payable.pay_cycle_end)}</dd><dt>Due date</dt><dd>{dateValue(payable.due_date)}</dd><dt>Financial summary</dt><dd><JsonBlock value={detail.financial_summary} /></dd></dl><div className="warning-box">Net payable is payment-readiness context only. Payment execution is future scope.</div></Panel>;
  if (tab === "compliance_tax_readiness") return <Panel title="Compliance / Tax Readiness"><dl className="detail-list"><dt>Compliance status</dt><dd>{formatAction(payable.compliance_status)}</dd><dt>Tax document status</dt><dd>{formatAction(payable.tax_document_status)}</dd><dt>Compliance summary</dt><dd><JsonBlock value={detail.compliance_summary} /></dd><dt>Tax summary</dt><dd><JsonBlock value={detail.tax_document_summary} /></dd><dt>Warnings</dt><dd><JsonBlock value={detail.warnings} /></dd><dt>Blockers</dt><dd><JsonBlock value={detail.blockers} /></dd></dl><div className="warning-box">Compliance and tax readiness are status fields only. Tax filing is future scope.</div></Panel>;
  if (tab === "retainage") return <Panel title="Retainage"><dl className="detail-list"><dt>Retainage amount</dt><dd>{money(payable.retainage_amount)}</dd><dt>Retainage summary</dt><dd><JsonBlock value={detail.retainage_summary} /></dd></dl><ObjectTable rows={items.filter((item) => numberValue(item.retainage_amount, 0) !== 0 || String(item.item_type).includes("retainage"))} columns={["item_type", "retainage_percent", "retainage_amount", "net_payable_amount"]} /><div className="warning-box">Retainage release is future payable workflow unless already represented as an approved payable item.</div></Panel>;
  if (tab === "deductions_chargebacks") return <Panel title="Deductions / Chargebacks"><dl className="detail-list"><dt>Deduction amount</dt><dd>{money(payable.deduction_amount)}</dd><dt>Chargeback amount</dt><dd>{money(payable.chargeback_amount)}</dd><dt>Summary</dt><dd><JsonBlock value={detail.deduction_chargeback_summary} /></dd></dl><ObjectTable rows={items.filter((item) => numberValue(item.deduction_amount, 0) !== 0 || numberValue(item.chargeback_amount, 0) !== 0)} columns={["item_type", "description", "deduction_amount", "chargeback_amount", "net_payable_amount"]} /><div className="warning-box">Deductions and chargebacks are payable adjustments only. They do not create accounting exports.</div></Panel>;
  if (tab === "holds_disputes") return <Panel title="Holds & Disputes"><dl className="detail-list"><dt>Hold status</dt><dd>{formatAction(payable.hold_status)}</dd><dt>Hold reason</dt><dd>{textValue(payable.hold_reason)}</dd><dt>Hold note</dt><dd>{textValue(payable.hold_note)}</dd><dt>Dispute status</dt><dd>{formatAction(payable.dispute_status)}</dd><dt>Dispute reason</dt><dd>{textValue(payable.dispute_reason)}</dd><dt>Dispute note</dt><dd>{textValue(payable.dispute_note)}</dd><dt>Summary</dt><dd><JsonBlock value={detail.hold_dispute_summary} /></dd></dl><div className="form-actions"><ActionButton permission="contractor_payable.place_hold" session={session} disabled={payableInactive(payable)} onClick={() => onAction("place_hold")}>Place Hold</ActionButton><ActionButton permission="contractor_payable.release_hold" session={session} disabled={payableInactive(payable)} onClick={() => onAction("release_hold")}>Release Hold</ActionButton><ActionButton permission="contractor_payable.dispute" session={session} disabled={payableInactive(payable)} onClick={() => onAction("dispute")}>Dispute</ActionButton><ActionButton permission="contractor_payable.resolve_dispute" session={session} disabled={payableInactive(payable)} onClick={() => onAction("resolve_dispute")}>Resolve Dispute</ActionButton></div></Panel>;
  if (tab === "approval") return <Panel title="Approval"><dl className="detail-list"><dt>Approval status</dt><dd>{formatAction(payable.approval_status)}</dd><dt>Approved by</dt><dd>{textValue(payable.approved_by)}</dd><dt>Approved at</dt><dd>{dateValue(payable.approved_at)}</dd><dt>Rejected by</dt><dd>{textValue(payable.rejected_by)}</dd><dt>Rejected at</dt><dd>{dateValue(payable.rejected_at)}</dd><dt>Rejection reason</dt><dd>{textValue(payable.rejection_reason)}</dd><dt>Rejection note</dt><dd>{textValue(payable.rejection_note)}</dd></dl><div className="form-actions"><ActionButton permission="contractor_payable.submit_review" session={session} disabled={payableInactive(payable)} onClick={() => onAction("submit_review")}>Submit Review</ActionButton><ActionButton permission="contractor_payable.start_review" session={session} disabled={payableInactive(payable)} onClick={() => onAction("start_review")}>Start Review</ActionButton><ActionButton permission="contractor_payable.approve" session={session} disabled={payableInactive(payable)} onClick={() => onAction("approve")}>Approve</ActionButton><ActionButton permission="contractor_payable.reject" session={session} disabled={payableInactive(payable)} onClick={() => onAction("reject")}>Reject</ActionButton></div></Panel>;
  if (tab === "payment_readiness") return <Panel title="Payment Readiness"><dl className="detail-list"><dt>Payment readiness</dt><dd>{formatAction(payable.payment_readiness_status)}</dd><dt>Payment status</dt><dd>{formatAction(payable.payment_status)}</dd><dt>Net payable</dt><dd>{money(payable.net_payable_amount)}</dd><dt>Compliance</dt><dd>{formatAction(payable.compliance_status)}</dd><dt>Tax documents</dt><dd>{formatAction(payable.tax_document_status)}</dd><dt>Hold status</dt><dd>{formatAction(payable.hold_status)}</dd><dt>Dispute status</dt><dd>{formatAction(payable.dispute_status)}</dd><dt>Warnings</dt><dd><JsonBlock value={detail.warnings} /></dd><dt>Blockers</dt><dd><JsonBlock value={detail.blockers} /></dd><dt>Required overrides</dt><dd><JsonBlock value={detail.required_override_fields} /></dd><dt>Recommended next action</dt><dd>{formatAction(payable.recommended_next_action ?? detail.recommended_next_action)}</dd><dt>Boundary summary</dt><dd><JsonBlock value={detail.payment_boundary_summary} /></dd></dl><ActionButton permission="contractor_payable.mark_payment_ready" session={session} disabled={payableInactive(payable)} onClick={() => onAction("payment_ready")}>Mark Payment Ready</ActionButton><div className="warning-box">Mark Payment Ready does not send money. It only prepares this payable for a future payment/payroll workflow.</div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor", "action", "object", "before", "after", "reason", "timestamp", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view contractor payable audit details.</div>}</Panel>;
  if (tab === "future_payment") return <PlaceholderPanel title="Future Payment" message="Payment execution is not available in this sprint. Future payment workflows may consume payment-ready payables." columns={["Payment button", "Mark paid", "ACH/check/card action"]} />;
  if (tab === "future_payroll") return <PlaceholderPanel title="Future Payroll" message="Payroll is not available in this sprint. Worker payroll and contractor payables are governed separately." columns={["Payroll run", "Payslip", "Worker tax action"]} />;
  return <PlaceholderPanel title="Future Bank / Accounting" message="Bank reconciliation, tax filing, and accounting export are not available in this sprint." columns={["Bank transaction", "Tax filing", "Accounting export"]} />;
}

function PayableItemsTable({ rows, session, onAction }: { rows: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No payable items yet. Add payable-ready settlement items.</div>;
  return <div className="wide-table"><table><thead><tr>{["Item Type", "Status", "Description", "Settlement", "Settlement Item", "Billable Item", "QC Review", "Production Record", "Work Order", "Project", "Provider", "Crew", "Quantity", "Unit", "Contractor Rate", "Gross Payable Amount", "Deduction Amount", "Chargeback Amount", "Retainage Percent", "Retainage Amount", "Net Payable Amount", "Compliance Status", "Tax Document Status", "Dispute Status", "Hold Status", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{formatAction(row.item_type)}</td><td>{formatAction(row.status)}</td><td>{textValue(row.description)}</td><td>{settlementLink(row.settlement_id, row.settlement_number ?? row.settlement_id)}</td><td>{textValue(row.settlement_item_id)}</td><td>{textValue(row.billable_item_id)}</td><td>{textValue(row.qc_review_id)}</td><td>{textValue(row.production_record_id)}</td><td>{textValue(row.work_order_id)}</td><td>{projectLink(row.project_id, row.project_name ?? row.project_id)}</td><td>{providerLink(row.capacity_provider_id, row.capacity_provider_name ?? row.capacity_provider_id)}</td><td>{crewLink(row.crew_id, row.crew_name ?? row.crew_id)}</td><td>{formatCell(row.quantity)}</td><td>{textValue(row.unit)}</td><td>{money(row.contractor_rate)}</td><td>{money(row.gross_payable_amount)}</td><td>{money(row.deduction_amount)}</td><td>{money(row.chargeback_amount)}</td><td>{formatCell(row.retainage_percent)}</td><td>{money(row.retainage_amount)}</td><td>{money(row.net_payable_amount)}</td><td>{formatAction(row.compliance_status)}</td><td>{formatAction(row.tax_document_status)}</td><td>{formatAction(row.dispute_status)}</td><td>{formatAction(row.hold_status)}</td><td><div className="form-actions"><ActionButton permission="contractor_payable_item.update" session={session} disabled={itemInactive(row)} onClick={() => onAction("edit_item", row)}>Edit</ActionButton><ActionButton permission="contractor_payable_item.void" session={session} disabled={itemInactive(row)} onClick={() => onAction("void_item", row)}>Void</ActionButton><ActionButton permission="contractor_payable_item.archive" session={session} disabled={row.status === "archived"} onClick={() => onAction("archive_item", row)}>Archive</ActionButton></div></td></tr>)}</tbody></table></div>;
}

function PayableModal({ type, payableId, payable, item, related, session, onClose, onSaved }: { type: string; payableId: string; payable: SyncRecord; item: SyncRecord | null; related: RelatedData; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>(prefillItemForm(item));
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (type === "add_item") await syncosFetch(`/contractor-payables/${payableId}/items`, { method: "POST", body: addItemPayload(form), token: session.token });
      else if (type === "edit_item" && item) await syncosFetch(`/contractor-payable-items/${item.id}`, { method: "PATCH", body: itemPatchPayload(form), token: session.token });
      else if (type === "void_item" && item) await syncosFetch(`/contractor-payable-items/${item.id}/void`, { method: "POST", body: voidPayload(form), token: session.token });
      else if (type === "archive_item" && item) await syncosFetch(`/contractor-payable-items/${item.id}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      else if (type === "recalculate") await syncosFetch(`/contractor-payables/${payableId}/recalculate-totals`, { method: "POST", body: {}, token: session.token });
      else if (type === "submit_review") await syncosFetch(`/contractor-payables/${payableId}/submit-review`, { method: "POST", body: {}, token: session.token });
      else if (type === "start_review") await syncosFetch(`/contractor-payables/${payableId}/start-review`, { method: "POST", body: {}, token: session.token });
      else if (type === "approve") await syncosFetch(`/contractor-payables/${payableId}/approve`, { method: "POST", body: notePayload(form, "approval_note"), token: session.token });
      else if (type === "reject") await syncosFetch(`/contractor-payables/${payableId}/reject`, { method: "POST", body: rejectionPayload(form), token: session.token });
      else if (type === "payment_ready") await syncosFetch(`/contractor-payables/${payableId}/mark-payment-ready`, { method: "POST", body: notePayload(form, "ready_note"), token: session.token });
      else if (type === "place_hold") await syncosFetch(`/contractor-payables/${payableId}/place-hold`, { method: "POST", body: holdPayload(form), token: session.token });
      else if (type === "release_hold") await syncosFetch(`/contractor-payables/${payableId}/release-hold`, { method: "POST", body: { release_note: form.release_note }, token: session.token });
      else if (type === "dispute") await syncosFetch(`/contractor-payables/${payableId}/dispute`, { method: "POST", body: disputePayload(form), token: session.token });
      else if (type === "resolve_dispute") await syncosFetch(`/contractor-payables/${payableId}/resolve-dispute`, { method: "POST", body: notePayload(form, "resolution_note"), token: session.token });
      else if (type === "void") await syncosFetch(`/contractor-payables/${payableId}/void`, { method: "POST", body: voidPayload(form), token: session.token });
      else if (type === "archive") await syncosFetch(`/contractor-payables/${payableId}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card" onSubmit={(event) => void submit(event)}>
        <div className="section-toolbar"><h2>{modalTitle(type)}</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        {type === "add_item" ? <AddItemFields form={form} setForm={setForm} related={related} /> : null}
        {type === "edit_item" ? <ItemEditFields form={form} setForm={setForm} /> : null}
        {type === "approve" ? <><label>Approval Note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /></> : null}
        {type === "reject" ? <><label>Rejection Reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejection Note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {type === "payment_ready" ? <><label>Ready Note<textarea value={form.ready_note ?? ""} onChange={(event) => setForm({ ...form, ready_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">Payment Ready does not send money and does not create payment, payroll, ACH/card, check, or bank records.</div></> : null}
        {type === "place_hold" ? <><label>Hold Reason<textarea value={form.hold_reason ?? ""} onChange={(event) => setForm({ ...form, hold_reason: event.target.value })} required /></label><label>Hold Note<textarea value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label></> : null}
        {type === "release_hold" ? <label>Release Note<textarea value={form.release_note ?? ""} onChange={(event) => setForm({ ...form, release_note: event.target.value })} required /></label> : null}
        {type === "dispute" ? <><label>Dispute Reason<textarea value={form.dispute_reason ?? ""} onChange={(event) => setForm({ ...form, dispute_reason: event.target.value })} required /></label><label>Dispute Note<textarea value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}
        {type === "resolve_dispute" ? <><label>Resolution Note<textarea value={form.resolution_note ?? ""} onChange={(event) => setForm({ ...form, resolution_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /></> : null}
        {["void", "void_item"].includes(type) ? <VoidFields form={form} setForm={setForm} /> : null}
        {["archive", "archive_item"].includes(type) ? <ArchiveFields form={form} setForm={setForm} /> : null}
        {["recalculate", "submit_review", "start_review"].includes(type) ? <div className="warning-box">This lifecycle action uses the Contractor Payable backend and creates no payment, payroll, bank, tax, or accounting records.</div> : null}
        <div className="form-actions"><button className="primary-button" type="submit">Submit</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  );
}

function PayableFormFields({ form, setForm, related, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeCreate?: boolean; disabled?: boolean }) {
  return (
    <div className="form-grid">
      {includeCreate ? <><Select label="Payable Type" value={form.payable_type ?? ""} options={["", ...payableTypes]} onChange={(payable_type) => setForm({ ...form, payable_type })} required disabled={disabled} /><Select label="Payable Party Type" value={form.payable_party_type ?? ""} options={["", ...partyTypes]} onChange={(payable_party_type) => setForm({ ...form, payable_party_type })} required disabled={disabled} /><Select label="Capacity Provider" value={form.capacity_provider_id ?? ""} options={["", ...related.providers.map((row) => String(row.id))]} labels={labelsFor(related.providers)} onChange={(capacity_provider_id) => setForm({ ...form, capacity_provider_id })} disabled={disabled} /><Select label="Crew" value={form.crew_id ?? ""} options={["", ...related.crews.map((row) => String(row.id))]} labels={labelsFor(related.crews)} onChange={(crew_id) => setForm({ ...form, crew_id })} disabled={disabled} /><input value={form.worker_id ?? ""} onChange={(event) => setForm({ ...form, worker_id: event.target.value })} placeholder="Worker ID" disabled={disabled} /><input value={form.vendor_organization_id ?? ""} onChange={(event) => setForm({ ...form, vendor_organization_id: event.target.value })} placeholder="Vendor Organization ID" disabled={disabled} /><Select label="Project" value={form.project_id ?? ""} options={["", ...related.projects.map((row) => String(row.id))]} labels={labelsFor(related.projects)} onChange={(project_id) => setForm({ ...form, project_id })} disabled={disabled} /><Select label="Settlement" value={form.settlement_id ?? ""} options={["", ...related.settlements.map((row) => String(row.id))]} labels={labelsFor(related.settlements, "settlement_number")} onChange={(settlement_id) => setForm({ ...form, settlement_id })} disabled={disabled} /></> : null}
      <label>Pay Cycle Start<input disabled={disabled} type="date" value={form.pay_cycle_start ?? ""} onChange={(event) => setForm({ ...form, pay_cycle_start: event.target.value })} /></label>
      <label>Pay Cycle End<input disabled={disabled} type="date" value={form.pay_cycle_end ?? ""} onChange={(event) => setForm({ ...form, pay_cycle_end: event.target.value })} /></label>
      <label>Due Date<input disabled={disabled} type="date" value={form.due_date ?? ""} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label>
      <Select label="Compliance Status" value={form.compliance_status ?? ""} options={["", ...complianceStatuses]} onChange={(compliance_status) => setForm({ ...form, compliance_status })} disabled={disabled} />
      <Select label="Tax Document Status" value={form.tax_document_status ?? ""} options={["", ...taxStatuses]} onChange={(tax_document_status) => setForm({ ...form, tax_document_status })} disabled={disabled} />
      <label>Override Reasons JSON<textarea disabled={disabled} value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>
      {!includeCreate ? <><label>Hold Note<textarea disabled={disabled} value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label><label>Dispute Note<textarea disabled={disabled} value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}
    </div>
  );
}

function AddItemFields({ form, setForm, related }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData }) {
  return <div className="form-grid"><Select label="Settlement Item" value={form.settlement_item_id ?? ""} options={["", ...related.settlementItems.map((row) => String(row.id))]} labels={labelsFor(related.settlementItems, "description")} onChange={(settlement_item_id) => setForm({ ...form, settlement_item_id })} required /><label>Settlement Item ID<input value={form.settlement_item_id ?? ""} onChange={(event) => setForm({ ...form, settlement_item_id: event.target.value })} required /></label><label>Quantity<input type="number" step="0.01" value={form.quantity ?? ""} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label>Contractor Rate<input type="number" step="0.01" value={form.contractor_rate ?? ""} onChange={(event) => setForm({ ...form, contractor_rate: event.target.value })} /></label><label>Description<textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Deduction Amount<input type="number" step="0.01" value={form.deduction_amount ?? ""} onChange={(event) => setForm({ ...form, deduction_amount: event.target.value })} /></label><label>Chargeback Amount<input type="number" step="0.01" value={form.chargeback_amount ?? ""} onChange={(event) => setForm({ ...form, chargeback_amount: event.target.value })} /></label><label>Retainage Percent<input type="number" step="0.01" value={form.retainage_percent ?? ""} onChange={(event) => setForm({ ...form, retainage_percent: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">Payable item creation consumes payable-ready settlement items and creates no payment or payroll records.</div></div>;
}

function ItemEditFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <div className="form-grid"><Select label="Item Type" value={form.item_type ?? ""} options={["", ...itemTypes]} onChange={(item_type) => setForm({ ...form, item_type })} /><Select label="Status" value={form.status ?? ""} options={["", ...itemStatuses]} onChange={(status) => setForm({ ...form, status })} /><label>Description<textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Quantity<input type="number" step="0.01" value={form.quantity ?? ""} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label>Contractor Rate<input type="number" step="0.01" value={form.contractor_rate ?? ""} onChange={(event) => setForm({ ...form, contractor_rate: event.target.value })} /></label><label>Deduction Amount<input type="number" step="0.01" value={form.deduction_amount ?? ""} onChange={(event) => setForm({ ...form, deduction_amount: event.target.value })} /></label><label>Chargeback Amount<input type="number" step="0.01" value={form.chargeback_amount ?? ""} onChange={(event) => setForm({ ...form, chargeback_amount: event.target.value })} /></label><label>Retainage Percent<input type="number" step="0.01" value={form.retainage_percent ?? ""} onChange={(event) => setForm({ ...form, retainage_percent: event.target.value })} /></label><Select label="Compliance Status" value={form.compliance_status ?? ""} options={["", ...complianceStatuses]} onChange={(compliance_status) => setForm({ ...form, compliance_status })} /><Select label="Tax Document Status" value={form.tax_document_status ?? ""} options={["", ...taxStatuses]} onChange={(tax_document_status) => setForm({ ...form, tax_document_status })} /><OverrideField form={form} setForm={setForm} /></div>;
}

function OverrideField({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>;
}

function VoidFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></>;
}

function ArchiveFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  const [token, setToken] = useState(session.token);
  const [permissionText, setPermissionText] = useState(session.permissions.join(", "));
  return <section className="workspace-panel"><div className="section-toolbar"><h2>API Session</h2><span>{session.permissions.length} permissions loaded</span></div><div className="session-grid"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" /><input value={permissionText} onChange={(event) => setPermissionText(event.target.value)} placeholder="Permissions, comma separated" /><button type="button" onClick={() => { saveToken(token); savePermissions(permissionText.split(",").map((item) => item.trim()).filter(Boolean)); window.location.reload(); }}>Save Session</button></div></section>;
}

function useSession() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>(payableDefaultPermissions);
  useEffect(() => {
    const nextToken = readToken();
    setToken(nextToken);
    const stored = readPermissions();
    setPermissions(stored.length ? stored : payableDefaultPermissions);
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

const payableDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "settlement.read",
  "project.read",
  "capacity_provider.read",
  "crew.read",
  "contractor_payable.read",
  "contractor_payable.create",
  "contractor_payable.update",
  "contractor_payable.add_item",
  "contractor_payable.remove_item",
  "contractor_payable.recalculate_totals",
  "contractor_payable.submit_review",
  "contractor_payable.start_review",
  "contractor_payable.approve",
  "contractor_payable.reject",
  "contractor_payable.mark_payment_ready",
  "contractor_payable.place_hold",
  "contractor_payable.release_hold",
  "contractor_payable.dispute",
  "contractor_payable.resolve_dispute",
  "contractor_payable.void",
  "contractor_payable.archive",
  "contractor_payable.timeline.read",
  "contractor_payable.audit.read",
  "contractor_payable_item.read",
  "contractor_payable_item.create",
  "contractor_payable_item.update",
  "contractor_payable_item.void",
  "contractor_payable_item.archive",
];

async function loadRelated(token: string): Promise<RelatedData> {
  const [providers, crews, projects, settlements, settlementItems] = await Promise.all([
    optionalList("/capacity-providers", token),
    optionalList("/crews", token),
    optionalList("/projects", token),
    optionalList("/settlements?archived=false", token),
    optionalList("/settlement-items?archived=false", token),
  ]);
  return { providers, crews, projects, settlements, settlementItems };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function payableQuery(filters: Record<string, string>) {
  const query = new URLSearchParams();
  query.set("archived", filters.archived === "true" ? "true" : "false");
  for (const key of ["payable_type", "payable_party_type", "status", "approval_status", "payment_readiness_status", "payment_status", "capacity_provider_id", "crew_id", "project_id", "settlement_id", "compliance_status", "tax_document_status", "dispute_status", "hold_status", "pay_cycle_start", "pay_cycle_end", "due_date_from", "due_date_to", "q"]) if (filters[key]) query.set(key, filters[key]);
  if (filters.sort) query.set("sort", filters.sort);
  return query;
}

function payableCreatePayload(form: Record<string, string>) {
  return prune({ payable_type: form.payable_type, payable_party_type: form.payable_party_type, capacity_provider_id: form.capacity_provider_id, crew_id: form.crew_id, worker_id: form.worker_id, vendor_organization_id: form.vendor_organization_id, project_id: form.project_id, settlement_id: form.settlement_id, pay_cycle_start: form.pay_cycle_start, pay_cycle_end: form.pay_cycle_end, due_date: form.due_date, compliance_status: form.compliance_status, tax_document_status: form.tax_document_status, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function payablePatchPayload(form: Record<string, string>) {
  return prune({ pay_cycle_start: form.pay_cycle_start, pay_cycle_end: form.pay_cycle_end, due_date: form.due_date, compliance_status: form.compliance_status, tax_document_status: form.tax_document_status, override_reasons: parseJsonField(form.override_reasons, "Override Reasons"), hold_note: form.hold_note, dispute_note: form.dispute_note });
}

function addItemPayload(form: Record<string, string>) {
  return prune({ settlement_item_id: form.settlement_item_id, quantity: numericOrUndefined(form.quantity), contractor_rate: numericOrUndefined(form.contractor_rate), description: form.description, deduction_amount: numericOrUndefined(form.deduction_amount), chargeback_amount: numericOrUndefined(form.chargeback_amount), retainage_percent: numericOrUndefined(form.retainage_percent), override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function itemPatchPayload(form: Record<string, string>) {
  return prune({ item_type: form.item_type, status: form.status, description: form.description, quantity: numericOrUndefined(form.quantity), contractor_rate: numericOrUndefined(form.contractor_rate), deduction_amount: numericOrUndefined(form.deduction_amount), chargeback_amount: numericOrUndefined(form.chargeback_amount), retainage_percent: numericOrUndefined(form.retainage_percent), compliance_status: form.compliance_status, tax_document_status: form.tax_document_status, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function notePayload(form: Record<string, string>, key: string) {
  return prune({ [key]: form[key], override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function rejectionPayload(form: Record<string, string>) {
  return prune({ rejection_reason: form.rejection_reason, rejection_note: form.rejection_note });
}

function holdPayload(form: Record<string, string>) {
  return prune({ hold_reason: form.hold_reason, hold_note: form.hold_note });
}

function disputePayload(form: Record<string, string>) {
  return prune({ dispute_reason: form.dispute_reason, dispute_note: form.dispute_note });
}

function voidPayload(form: Record<string, string>) {
  return prune({ void_reason: form.void_reason, void_note: form.void_note });
}

function archivePayload(form: Record<string, string>) {
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
}

function prefillItemForm(item: SyncRecord | null): Record<string, string> {
  if (!item) return {};
  return { item_type: String(item.item_type ?? ""), status: String(item.status ?? ""), description: String(item.description ?? ""), quantity: String(item.quantity ?? ""), contractor_rate: String(item.contractor_rate ?? ""), deduction_amount: String(item.deduction_amount ?? ""), chargeback_amount: String(item.chargeback_amount ?? ""), retainage_percent: String(item.retainage_percent ?? ""), compliance_status: String(item.compliance_status ?? ""), tax_document_status: String(item.tax_document_status ?? ""), override_reasons: jsonText(item.override_reasons) };
}

function buildSummary(rows: SyncRecord[]) {
  const summary = { total: rows.length, status: {} as Record<string, number>, type: {} as Record<string, number>, compliance: {} as Record<string, number>, tax: {} as Record<string, number>, retainageHeld: 0, netPayable: 0 };
  for (const row of rows) {
    increment(summary.status, String(row.status ?? ""));
    increment(summary.type, String(row.payable_type ?? ""));
    increment(summary.compliance, String(row.compliance_status ?? ""));
    increment(summary.tax, String(row.tax_document_status ?? ""));
    if (numberValue(row.retainage_amount, 0) > 0) summary.retainageHeld += 1;
    summary.netPayable += numberValue(row.net_payable_amount, 0);
  }
  return summary;
}

function payableMatches(row: SyncRecord, filters: Record<string, string>) {
  if (filters.hasRetainage && numberValue(row.retainage_amount, 0) <= 0) return false;
  return true;
}

function sortPayables(rows: SyncRecord[], sort?: string) {
  const statusRank: Record<string, number> = { held: 8, disputed: 7, ready_for_review: 6, under_review: 5, approved: 4, draft: 3, assembling: 2 };
  return [...rows].sort((a, b) => {
    if (sort === "due_date_asc") return String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999"));
    if (sort === "net_amount_desc") return numberValue(b.net_payable_amount, 0) - numberValue(a.net_payable_amount, 0);
    if (sort === "status") return String(a.status ?? "").localeCompare(String(b.status ?? ""));
    if (sort === "payable_number") return String(a.payable_number ?? "").localeCompare(String(b.payable_number ?? ""));
    if (sort === "payment_readiness") return String(a.payment_readiness_status ?? "").localeCompare(String(b.payment_readiness_status ?? ""));
    return (statusRank[String(b.status)] ?? 0) - (statusRank[String(a.status)] ?? 0) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });
}

function payableChecklist(payable: SyncRecord, items: SyncRecord[]): Array<[string, unknown]> {
  return [["Payable party selected", Boolean(payable.payable_party_type)], ["Settlement item source reviewed", items.some((item) => item.settlement_item_id)], ["Items present", items.length > 0], ["Totals calculated", payable.net_payable_amount !== undefined], ["Compliance reviewed", payable.compliance_status && payable.compliance_status !== "unknown"], ["Tax documents reviewed", payable.tax_document_status && payable.tax_document_status !== "unknown"], ["Deductions reviewed", payable.deduction_amount !== undefined], ["Retainage reviewed", payable.retainage_amount !== undefined], ["No hold", payable.hold_status !== "hold"], ["No dispute", payable.dispute_status !== "open"], ["Approved", payable.approval_status === "approved"], ["Payment ready", payable.payment_readiness_status === "ready_for_payment"], ["No payment created", true]];
}

function payableInactive(row: SyncRecord) {
  return ["voided", "archived", "payment_created_later", "paid_later"].includes(String(row.status));
}

function itemInactive(row: SyncRecord) {
  return ["voided", "archived", "payment_created_later"].includes(String(row.status));
}

function modalTitle(type: string) {
  const titles: Record<string, string> = { add_item: "Add Payable Item", edit_item: "Edit Payable Item", recalculate: "Recalculate Totals", submit_review: "Submit Review", start_review: "Start Review", approve: "Approve Payable", reject: "Reject Payable", payment_ready: "Mark Payment Ready", place_hold: "Place Hold", release_hold: "Release Hold", dispute: "Dispute Payable", resolve_dispute: "Resolve Dispute", void: "Void Payable", archive: "Archive Payable", void_item: "Void Payable Item", archive_item: "Archive Payable Item" };
  return titles[type] ?? "Contractor Payable Action";
}

function actionNotice(type: string) {
  if (type === "add_item") return "Payable item added from a settlement item. No payment or payroll record was created.";
  if (type === "payment_ready") return "Payable marked payment ready. No money was sent.";
  if (type === "approve") return "Payable approved. No payment, payroll, bank, tax, or accounting record was created.";
  if (type.includes("hold")) return "Hold action completed. No payment was created.";
  if (type.includes("dispute")) return "Dispute action completed. No amount was paid.";
  return "Contractor payable action completed without payment, payroll, bank, tax, or accounting activity.";
}

function plainError(message: string) {
  if (!message) return "Contractor payable action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("contractor payable not found")) return "Contractor payable not found or no access.";
  if (message.includes("payable item not found")) return "Payable item not found or no access.";
  if (message.includes("payable_ready")) return "Settlement item must be payable ready unless override is supplied.";
  if (message.includes("customer_billable")) return "Customer billable-only settlement item cannot become contractor payable without override.";
  if (message.includes("duplicate")) return "Duplicate payable item is not allowed without override.";
  if (message.includes("payable party")) return "Payable party does not match settlement item source.";
  if (message.includes("approval")) return "Approval note is required.";
  if (message.includes("rejection")) return "Rejection reason is required.";
  if (message.includes("hold")) return "Hold reason is required.";
  if (message.includes("dispute")) return "Dispute reason is required.";
  if (message.includes("void")) return "Void reason is required.";
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

function payableLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/contractor-payables/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function providerLink(id: unknown, label: unknown) {
  return id ? textValue(label, String(id)) : "Not linked";
}

function crewLink(id: unknown, label: unknown) {
  return id ? textValue(label, String(id)) : "Not linked";
}

function projectLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/projects/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function settlementLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/settlements/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function labelsFor(rows: SyncRecord[], preferred = "name") {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.payable_number ?? row.settlement_number ?? row.description, String(row.id))]));
}

function increment(target: Record<string, number>, key: string) {
  if (!key) return;
  target[key] = (target[key] ?? 0) + 1;
}

function boolText(value: unknown) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not captured";
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
