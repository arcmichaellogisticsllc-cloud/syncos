"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell, ObjectTable, Panel } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const payrollRunTypes = ["regular", "off_cycle", "correction", "bonus", "reimbursement", "final_pay", "manual_adjustment"];
const payrollStatuses = ["draft", "assembling", "ready_for_review", "under_review", "approved", "rejected", "held", "disputed", "payroll_ready", "payroll_created_later", "partially_paid_later", "paid_later", "voided", "archived"];
const approvalStatuses = ["not_submitted", "pending", "approved", "rejected", "withdrawn"];
const readinessStatuses = ["not_ready", "ready_with_warning", "ready_for_payroll", "blocked"];
const payrollCycles = ["weekly", "biweekly", "semimonthly", "monthly", "custom"];
const complianceStatuses = ["unknown", "missing", "incomplete", "ready", "expired", "blocked"];
const taxStatuses = ["unknown", "missing_w9", "missing_w4_later", "ready", "expired", "blocked"];
const disputeStatuses = ["none", "open", "under_review", "resolved", "rejected"];
const holdStatuses = ["none", "hold", "released"];
const sourceTypes = ["approved_time", "production_based", "per_diem", "reimbursement", "bonus", "adjustment", "correction", "manual", "imported_later"];
const earningTypes = ["regular", "overtime", "doubletime", "piece_rate", "per_diem", "reimbursement", "bonus", "incentive", "adjustment", "correction", "deduction", "penalty"];
const workerClassifications = ["w2_employee", "contractor_1099", "temp_worker", "seasonal_worker", "internal_self_perform", "union_later", "unknown"];
const itemStatuses = ["draft", "ready", "approved", "held", "disputed", "payroll_ready", "payroll_created_later", "voided", "archived"];
const tabs = ["overview", "payroll_items", "worker_summary", "crew_context", "project_production_context", "payroll_period_cycle", "financial_summary", "earnings", "reimbursements", "deductions", "compliance_tax_readiness", "holds_disputes", "approval", "payroll_readiness", "timeline", "audit", "future_payment", "future_payroll_provider", "future_tax_accounting"];

type Session = ReturnType<typeof useSession>;

type DetailShape = {
  payroll_run?: SyncRecord;
  payroll_items?: SyncRecord[];
  project_context?: SyncRecord | null;
  crew_context?: SyncRecord | null;
  worker_summary?: SyncRecord;
  financial_summary?: SyncRecord;
  earning_summary?: SyncRecord;
  reimbursement_summary?: SyncRecord;
  deduction_summary?: SyncRecord;
  compliance_summary?: SyncRecord;
  tax_document_summary?: SyncRecord;
  hold_dispute_summary?: SyncRecord;
  payroll_boundary_summary?: SyncRecord;
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
  workers: SyncRecord[];
  crews: SyncRecord[];
  projects: SyncRecord[];
  workOrders: SyncRecord[];
  productionRecords: SyncRecord[];
};

const emptyRelated: RelatedData = { workers: [], crews: [], projects: [], workOrders: [], productionRecords: [] };

export function PayrollRunQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = payrollQuery(filters);
      setRows(await syncosFetch<SyncRecord[]>(`/payroll-runs?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortPayrollRuns(rows, filters.sort), [rows, filters.sort]);
  const summary = useMemo(() => buildSummary(rows), [rows]);

  return (
    <PayrollShell title="Payroll Run Queue" purpose="Control worker compensation readiness before payment execution, payroll provider submission, or tax filing.">
      <SessionPanel session={session} />
      <div className="warning-box">Payroll Ready is only a status. It does not send money, submit payroll, create ACH/card/check records, create bank transactions, or file taxes.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view payroll runs.</div> : null}
      {loading ? <div className="empty-state">Loading payroll runs...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Payroll Run Summary</h2>
                <p className="muted">Blocked, held, disputed, review-ready, approved, and payroll-ready runs stay visible before execution.</p>
              </div>
              <Link className="primary-button" href="/payroll/new" aria-disabled={!hasPermission(session.permissions, "payroll_run.create")}>Create Payroll Run</Link>
            </div>
            <div className="summary-grid">
              <SummaryCard label="Total Payroll Runs" value={summary.total} onClick={() => setFilters({ archived: "false", sort: "updated_desc" })} />
              {payrollStatuses.map((status) => <SummaryCard key={status} label={formatAction(status)} value={summary.status[status] ?? 0} onClick={() => setFilters({ ...filters, archived: status === "archived" ? "true" : "false", status })} />)}
              {["regular", "off_cycle", "correction", "bonus", "reimbursement", "final_pay"].map((payroll_run_type) => <SummaryCard key={payroll_run_type} label={formatAction(payroll_run_type)} value={summary.type[payroll_run_type] ?? 0} onClick={() => setFilters({ ...filters, payroll_run_type })} />)}
              <SummaryCard label="Compliance Blocked" value={summary.compliance.blocked ?? 0} onClick={() => setFilters({ ...filters, compliance_status: "blocked" })} />
              <SummaryCard label="Tax Docs Missing" value={(summary.tax.missing_w9 ?? 0) + (summary.tax.missing_w4_later ?? 0)} onClick={() => setFilters({ ...filters, tax_document_status: "missing_w9" })} />
              <SummaryCard label="Net Pay" value={money(summary.netPay)} onClick={() => setFilters({ ...filters, sort: "net_amount_desc" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "updated_desc" })}>Reset</button>
            </div>
            <div className="tab-row">
              {["draft", "ready_for_review", "under_review", "approved", "held", "disputed", "payroll_ready"].map((status) => <button key={status} type="button" onClick={() => setFilters({ ...filters, status })}>{formatAction(status)}</button>)}
              {["regular", "off_cycle", "correction", "bonus", "reimbursement"].map((payroll_run_type) => <button key={payroll_run_type} type="button" onClick={() => setFilters({ ...filters, payroll_run_type })}>{formatAction(payroll_run_type)}</button>)}
              <button type="button" onClick={() => setFilters({ ...filters, compliance_status: "blocked" })}>Compliance Blocked</button>
              <button type="button" onClick={() => setFilters({ ...filters, tax_document_status: "missing_w9" })}>Tax Docs Missing</button>
              <button type="button" onClick={() => setFilters({ ...filters, sort: "net_amount_desc" })}>Net Pay</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search payroll run, worker, crew, project, source, earning" />
              <Select label="Payroll Run Type" value={filters.payroll_run_type ?? ""} options={["", ...payrollRunTypes]} onChange={(payroll_run_type) => setFilters({ ...filters, payroll_run_type })} />
              <Select label="Status" value={filters.status ?? ""} options={["", ...payrollStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
              <Select label="Approval Status" value={filters.approval_status ?? ""} options={["", ...approvalStatuses]} onChange={(approval_status) => setFilters({ ...filters, approval_status })} />
              <Select label="Payroll Readiness" value={filters.payroll_readiness_status ?? ""} options={["", ...readinessStatuses]} onChange={(payroll_readiness_status) => setFilters({ ...filters, payroll_readiness_status })} />
              <Select label="Payroll Cycle" value={filters.payroll_cycle ?? ""} options={["", ...payrollCycles]} onChange={(payroll_cycle) => setFilters({ ...filters, payroll_cycle })} />
              <input value={filters.project_id ?? ""} onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} placeholder="Project" />
              <input value={filters.crew_id ?? ""} onChange={(event) => setFilters({ ...filters, crew_id: event.target.value })} placeholder="Crew" />
              <label>Period Start<input type="date" value={filters.payroll_period_start ?? ""} onChange={(event) => setFilters({ ...filters, payroll_period_start: event.target.value })} /></label>
              <label>Period End<input type="date" value={filters.payroll_period_end ?? ""} onChange={(event) => setFilters({ ...filters, payroll_period_end: event.target.value })} /></label>
              <label>Pay Date From<input type="date" value={filters.pay_date_from ?? ""} onChange={(event) => setFilters({ ...filters, pay_date_from: event.target.value })} /></label>
              <label>Pay Date To<input type="date" value={filters.pay_date_to ?? ""} onChange={(event) => setFilters({ ...filters, pay_date_to: event.target.value })} /></label>
              <Select label="Compliance" value={filters.compliance_status ?? ""} options={["", ...complianceStatuses]} onChange={(compliance_status) => setFilters({ ...filters, compliance_status })} />
              <Select label="Tax Documents" value={filters.tax_document_status ?? ""} options={["", ...taxStatuses]} onChange={(tax_document_status) => setFilters({ ...filters, tax_document_status })} />
              <Select label="Dispute Status" value={filters.dispute_status ?? ""} options={["", ...disputeStatuses]} onChange={(dispute_status) => setFilters({ ...filters, dispute_status })} />
              <Select label="Hold Status" value={filters.hold_status ?? ""} options={["", ...holdStatuses]} onChange={(hold_status) => setFilters({ ...filters, hold_status })} />
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "pay_date_asc", "net_amount_desc", "status", "payroll_run_number", "payroll_readiness"]} labels={{ updated_desc: "Recently Updated", pay_date_asc: "Pay Date Soonest", net_amount_desc: "Net Amount Highest", status: "Status", payroll_run_number: "Payroll Run Number", payroll_readiness: "Payroll Readiness" }} onChange={(sort) => setFilters({ ...filters, sort })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Payroll Runs</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No payroll runs yet. Create a payroll run and add payroll items.</div> : <PayrollRunTable rows={visible} />}
          </section>
        </>
      ) : null}
    </PayrollShell>
  );
}

export function PayrollRunCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ payroll_run_type: "regular", payroll_cycle: "weekly", compliance_status: "unknown", tax_document_status: "unknown" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/payroll-runs", { method: "POST", body: payrollCreatePayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? after?.id ?? "");
      router.push(id ? `/payroll/${id}` : "/payroll");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <PayrollShell title="Create Payroll Run" purpose="Create a worker compensation readiness shell without creating payment, provider submission, bank, tax, accounting, or worker portal records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Backend validation is authoritative. Creating a payroll run does not create payment, ACH/card/check, provider submission, tax filing, or accounting export records.</div>
        <PayrollFormFields form={form} setForm={setForm} related={related} includeCreate />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "payroll_run.create")}>Create Payroll Run</button>
          <Link className="link-button" href="/payroll">Cancel</Link>
        </div>
      </form>
    </PayrollShell>
  );
}

export function PayrollRunEdit({ payrollRunId }: { payrollRunId: string }) {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [record, setRecord] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const [next, nextRelated] = await Promise.all([
          syncosFetch<SyncRecord>(`/payroll-runs/${payrollRunId}`, { token: session.token }),
          loadRelated(session.token),
        ]);
        setRecord(next);
        setRelated(nextRelated);
        setForm({
          payroll_period_start: dateInput(next.payroll_period_start),
          payroll_period_end: dateInput(next.payroll_period_end),
          pay_date: dateInput(next.pay_date),
          payroll_cycle: String(next.payroll_cycle ?? ""),
          project_id: String(next.project_id ?? ""),
          crew_id: String(next.crew_id ?? ""),
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
  }, [session.token, payrollRunId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/payroll-runs/${payrollRunId}`, { method: "PATCH", body: payrollPatchPayload(form), token: session.token });
      router.push(`/payroll/${payrollRunId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  const readonly = ["voided", "archived", "payroll_created_later", "paid_later", "partially_paid_later"].includes(String(record?.status));
  return (
    <PayrollShell title="Edit Payroll Run" purpose="Edit payroll readiness context without creating payment, provider submission, bank, tax, or accounting activity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Payroll run not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Cannot create payment, submit payroll, mark paid, or file taxes from this form. Lifecycle states use backend action routes.</div>
          <PayrollFormFields form={form} setForm={setForm} related={related} disabled={readonly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readonly || !hasPermission(session.permissions, "payroll_run.update")}>Save Payroll Run</button>
            <Link className="link-button" href={`/payroll/${payrollRunId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </PayrollShell>
  );
}

export function PayrollRunDetail({ payrollRunId }: { payrollRunId: string }) {
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
        syncosFetch<DetailShape>(`/payroll-runs/${payrollRunId}/detail`, { token: session.token }),
        loadRelated(session.token),
      ]);
      const [timeline, audit] = await Promise.all([
        optionalList(`/payroll-runs/${payrollRunId}/timeline`, session.token),
        optionalList(`/payroll-runs/${payrollRunId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
      setRelated(nextRelated);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, payrollRunId]);

  const run = detail?.payroll_run;
  const items = detail?.payroll_items ?? [];

  function openAction(type: string, item?: SyncRecord) {
    setSelectedItem(item ?? null);
    setModal(type);
  }

  return (
    <PayrollShell title="Payroll Run Detail" purpose="Show worker compensation readiness before future Payment Execution or Payroll Provider workflows consume payroll-ready runs.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Payroll Run Detail.</div> : null}
      {!run && session.token && !error ? <div className="empty-state">Payroll run not found or no access.</div> : null}
      {run && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(run.payroll_run_number, "Payroll Run")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(run.payroll_run_type)}</span>
                  <span className="badge">{formatAction(run.status)}</span>
                  <span className="badge">{formatAction(run.approval_status)}</span>
                  <span className="badge">{formatAction(run.payroll_readiness_status)}</span>
                  <span className="badge">{formatAction(run.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/payroll/${payrollRunId}/edit`} aria-disabled={!hasPermission(session.permissions, "payroll_run.update")}>Edit Payroll Run</Link>
                <ActionButton permission="payroll_run.add_item" session={session} disabled={runInactive(run)} onClick={() => openAction("add_item")}>Add Payroll Item</ActionButton>
                <ActionButton permission="payroll_run.recalculate_totals" session={session} disabled={runInactive(run)} onClick={() => openAction("recalculate")}>Recalculate Totals</ActionButton>
                <ActionButton permission="payroll_run.submit_review" session={session} disabled={runInactive(run)} onClick={() => openAction("submit_review")}>Submit Review</ActionButton>
                <ActionButton permission="payroll_run.start_review" session={session} disabled={runInactive(run)} onClick={() => openAction("start_review")}>Start Review</ActionButton>
                <ActionButton permission="payroll_run.approve" session={session} disabled={runInactive(run)} onClick={() => openAction("approve")}>Approve</ActionButton>
                <ActionButton permission="payroll_run.reject" session={session} disabled={runInactive(run)} onClick={() => openAction("reject")}>Reject</ActionButton>
                <ActionButton permission="payroll_run.mark_payroll_ready" session={session} disabled={runInactive(run)} onClick={() => openAction("payroll_ready")}>Mark Payroll Ready</ActionButton>
                <ActionButton permission="payroll_run.place_hold" session={session} disabled={runInactive(run)} onClick={() => openAction("place_hold")}>Place Hold</ActionButton>
                <ActionButton permission="payroll_run.release_hold" session={session} disabled={runInactive(run)} onClick={() => openAction("release_hold")}>Release Hold</ActionButton>
                <ActionButton permission="payroll_run.dispute" session={session} disabled={runInactive(run)} onClick={() => openAction("dispute")}>Dispute</ActionButton>
                <ActionButton permission="payroll_run.resolve_dispute" session={session} disabled={runInactive(run)} onClick={() => openAction("resolve_dispute")}>Resolve Dispute</ActionButton>
                <ActionButton permission="payroll_run.void" session={session} disabled={run.status === "voided" || run.status === "archived"} onClick={() => openAction("void")}>Void</ActionButton>
                <ActionButton permission="payroll_run.archive" session={session} disabled={run.status === "archived"} onClick={() => openAction("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Gross Pay Amount" value={money(run.gross_pay_amount)} />
              <Metric label="Reimbursement Amount" value={money(run.reimbursement_amount)} />
              <Metric label="Deduction Amount" value={money(run.deduction_amount)} />
              <Metric label="Estimated Tax Amount" value={money(run.estimated_tax_amount)} />
              <Metric label="Net Pay Amount" value={money(run.net_pay_amount)} />
              <Metric label="Worker Count" value={formatCell(run.worker_count)} />
              <Metric label="Item Count" value={formatCell(run.item_count ?? items.length)} />
              <Metric label="Approval Status" value={formatAction(run.approval_status)} />
              <Metric label="Payroll Readiness" value={formatAction(run.payroll_readiness_status)} />
              <Metric label="Compliance Status" value={formatAction(run.compliance_status)} />
              <Metric label="Tax Document Status" value={formatAction(run.tax_document_status)} />
              <Metric label="Hold Status" value={formatAction(run.hold_status)} />
              <Metric label="Dispute Status" value={formatAction(run.dispute_status)} />
            </div>
            <div className="warning-box">Payroll Run does not send payment. Payroll Ready does not create ACH, card payout, check, bank transaction, payroll provider submission, or tax filing. Payment execution and payroll provider submission are future workflows.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Payroll Run Type</dt><dd>{formatAction(run.payroll_run_type)}</dd>
                <dt>Payroll Cycle</dt><dd>{formatAction(run.payroll_cycle)}</dd>
                <dt>Payroll Period</dt><dd>{dateValue(run.payroll_period_start)} to {dateValue(run.payroll_period_end)}</dd>
                <dt>Pay Date</dt><dd>{dateValue(run.pay_date)}</dd>
                <dt>Project</dt><dd>{projectLink(run.project_id, run.project_name ?? detail.project_context?.name)}</dd>
                <dt>Crew</dt><dd>{textValue(run.crew_name ?? detail.crew_context?.name ?? run.crew_id)}</dd>
                <dt>Workers</dt><dd>{formatCell(run.worker_count)}</dd>
                <dt>Approval</dt><dd>{formatAction(run.approval_status)}</dd>
                <dt>Payroll Readiness</dt><dd>{formatAction(run.payroll_readiness_status)}</dd>
                <dt>Compliance</dt><dd>{formatAction(run.compliance_status)}</dd>
                <dt>Tax Docs</dt><dd>{formatAction(run.tax_document_status)}</dd>
                <dt>Hold / Dispute</dt><dd>{formatAction(run.hold_status)} / {formatAction(run.dispute_status)}</dd>
              </dl>
              <Checklist items={payrollChecklist(run, items)} />
              <div className="warning-box">No payment created. No provider submission created. No bank, tax, accounting, benefit, garnishment, or worker portal action is available here.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <PayrollTab tab={tab} detail={detail} run={run} items={items} session={session} onAction={openAction} />
            </section>
          </div>
          {modal ? <PayrollModal type={modal} payrollRunId={payrollRunId} run={run} item={selectedItem} related={related} session={session} onClose={() => { setModal(""); setSelectedItem(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </PayrollShell>
  );
}

function PayrollShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/payroll", "Payroll Run Queue", "active"],
    ["/payroll/new", "Create Payroll Run", "active"],
    ["#detail", "Payroll Run Detail", "placeholder"],
    ["#items", "Payroll Items", "placeholder"],
    ["#worker", "Worker Context", "placeholder"],
    ["#crew", "Crew Context", "placeholder"],
    ["#project-production", "Project / Work Order / Production Context", "placeholder"],
    ["#period", "Payroll Period / Cycle", "placeholder"],
    ["#financial", "Financial Summary", "placeholder"],
    ["#earnings", "Earnings", "placeholder"],
    ["#reimbursements", "Reimbursements", "placeholder"],
    ["#deductions", "Deductions", "placeholder"],
    ["#compliance-tax", "Compliance / Tax Readiness", "placeholder"],
    ["#holds", "Holds & Disputes", "placeholder"],
    ["#approval", "Approval", "placeholder"],
    ["#payroll-readiness", "Payroll Readiness", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-payment", "Future Payment", "placeholder"],
    ["#future-provider", "Future Payroll Provider", "placeholder"],
    ["#future-tax-accounting", "Future Tax / Accounting", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Payroll</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function PayrollRunTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Payroll Run Number", "Payroll Run Type", "Status", "Approval Status", "Payroll Readiness Status", "Payroll Cycle", "Payroll Period Start", "Payroll Period End", "Pay Date", "Project", "Crew", "Gross Pay Amount", "Reimbursement Amount", "Deduction Amount", "Estimated Tax Amount", "Net Pay Amount", "Item Count", "Worker Count", "Compliance Status", "Tax Document Status", "Dispute Status", "Hold Status", "Recommended Next Action", "Updated Date"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{payrollLink(row.id, row.payroll_run_number)}</td><td>{formatAction(row.payroll_run_type)}</td><td>{formatAction(row.status)}</td><td>{formatAction(row.approval_status)}</td><td>{formatAction(row.payroll_readiness_status)}</td><td>{formatAction(row.payroll_cycle)}</td><td>{dateValue(row.payroll_period_start)}</td><td>{dateValue(row.payroll_period_end)}</td><td>{dateValue(row.pay_date)}</td><td>{projectLink(row.project_id, row.project_name)}</td><td>{textValue(row.crew_name ?? row.crew_id)}</td><td>{money(row.gross_pay_amount)}</td><td>{money(row.reimbursement_amount)}</td><td>{money(row.deduction_amount)}</td><td>{money(row.estimated_tax_amount)}</td><td>{money(row.net_pay_amount)}</td><td>{formatCell(row.item_count)}</td><td>{formatCell(row.worker_count)}</td><td>{formatAction(row.compliance_status)}</td><td>{formatAction(row.tax_document_status)}</td><td>{formatAction(row.dispute_status)}</td><td>{formatAction(row.hold_status)}</td><td>{formatAction(row.recommended_next_action)}</td><td>{dateValue(row.updated_at)}</td></tr>)}</tbody></table></div>;
}

function PayrollTab({ tab, detail, run, items, session, onAction }: { tab: string; detail: DetailShape; run: SyncRecord; items: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Payroll run number</dt><dd>{textValue(run.payroll_run_number)}</dd><dt>Payroll run type</dt><dd>{formatAction(run.payroll_run_type)}</dd><dt>Status</dt><dd>{formatAction(run.status)}</dd><dt>Approval status</dt><dd>{formatAction(run.approval_status)}</dd><dt>Payroll readiness</dt><dd>{formatAction(run.payroll_readiness_status)}</dd><dt>Payroll cycle</dt><dd>{formatAction(run.payroll_cycle)}</dd><dt>Payroll period</dt><dd>{dateValue(run.payroll_period_start)} to {dateValue(run.payroll_period_end)}</dd><dt>Pay date</dt><dd>{dateValue(run.pay_date)}</dd><dt>Project</dt><dd>{projectLink(run.project_id, run.project_name ?? detail.project_context?.name)}</dd><dt>Crew</dt><dd>{textValue(run.crew_name ?? detail.crew_context?.name ?? run.crew_id)}</dd><dt>Override reasons</dt><dd><JsonBlock value={run.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(run.created_at)}</dd><dt>Updated</dt><dd>{dateValue(run.updated_at)}</dd></dl><div className="warning-box">Payroll represents worker compensation readiness before money movement. It does not create ACH, card payout, check, bank transaction, payroll provider submission, tax filing, W2, 1099, accounting export, or worker portal records.</div></Panel>;
  if (tab === "payroll_items") return <Panel title="Payroll Items"><div className="form-actions"><ActionButton permission="payroll_run.add_item" session={session} disabled={runInactive(run)} onClick={() => onAction("add_item")}>Add Payroll Item</ActionButton></div><PayrollItemsTable rows={items} session={session} onAction={onAction} /><div className="warning-box">Payroll item actions create no payment, provider submission, bank, tax, benefit, garnishment, or accounting records.</div></Panel>;
  if (tab === "worker_summary") return <Panel title="Worker Summary"><dl className="detail-list"><dt>Worker count</dt><dd>{formatCell(run.worker_count)}</dd><dt>Worker classifications</dt><dd>{Array.from(new Set(items.map((item) => String(item.worker_classification ?? "")).filter(Boolean))).map(formatAction).join(", ") || "Not captured"}</dd><dt>Workers included</dt><dd>{Array.from(new Set(items.map((item) => textValue(item.worker_name ?? item.worker_id)).filter((value) => value !== "Not captured"))).join(", ") || "Not captured"}</dd><dt>Worker summary</dt><dd><JsonBlock value={detail.worker_summary} /></dd></dl><div className="warning-box">Individual worker compensation belongs in Payroll. Contractor/company/crew obligations belong in Contractor Payables.</div></Panel>;
  if (tab === "crew_context") return <Panel title="Crew Context"><dl className="detail-list"><dt>Crew</dt><dd>{textValue(run.crew_name ?? detail.crew_context?.name ?? run.crew_id)}</dd><dt>Crew status</dt><dd>{formatAction(detail.crew_context?.status)}</dd><dt>Crew foreman</dt><dd>{textValue(detail.crew_context?.foreman_name ?? detail.crew_context?.foreman_id)}</dd><dt>Workers from items</dt><dd>{Array.from(new Set(items.map((item) => textValue(item.worker_name ?? item.worker_id)).filter((value) => value !== "Not captured"))).join(", ") || "Not captured"}</dd><dt>Crew context</dt><dd><JsonBlock value={detail.crew_context} /></dd></dl><div className="warning-box">Crew context does not mean payroll pays the crew entity. Payroll pays individual workers only.</div></Panel>;
  if (tab === "project_production_context") return <Panel title="Project / Production Context"><dl className="detail-list"><dt>Project</dt><dd>{projectLink(run.project_id, run.project_name ?? detail.project_context?.name)}</dd><dt>Work Orders represented</dt><dd>{Array.from(new Set(items.map((item) => textValue(item.work_order_id)).filter((value) => value !== "Not captured"))).join(", ") || "Not captured"}</dd><dt>Production Records represented</dt><dd>{Array.from(new Set(items.map((item) => textValue(item.production_record_id)).filter((value) => value !== "Not captured"))).join(", ") || "Not captured"}</dd><dt>Source types represented</dt><dd>{Array.from(new Set(items.map((item) => String(item.source_type ?? "")).filter(Boolean))).map(formatAction).join(", ") || "Not captured"}</dd><dt>Project context</dt><dd><JsonBlock value={detail.project_context} /></dd></dl><div className="warning-box">Production context supports payroll traceability but does not automatically create payroll or payment.</div></Panel>;
  if (tab === "payroll_period_cycle") return <Panel title="Payroll Period / Cycle"><dl className="detail-list"><dt>Payroll Cycle</dt><dd>{formatAction(run.payroll_cycle)}</dd><dt>Payroll Period Start</dt><dd>{dateValue(run.payroll_period_start)}</dd><dt>Payroll Period End</dt><dd>{dateValue(run.payroll_period_end)}</dd><dt>Pay Date</dt><dd>{dateValue(run.pay_date)}</dd><dt>Run Type</dt><dd>{formatAction(run.payroll_run_type)}</dd></dl></Panel>;
  if (tab === "financial_summary") return <Panel title="Financial Summary"><dl className="detail-list"><dt>Gross Pay Amount</dt><dd>{money(run.gross_pay_amount)}</dd><dt>Reimbursement Amount</dt><dd>{money(run.reimbursement_amount)}</dd><dt>Deduction Amount</dt><dd>{money(run.deduction_amount)}</dd><dt>Estimated Tax Amount</dt><dd>{money(run.estimated_tax_amount)}</dd><dt>Net Pay Amount</dt><dd>{money(run.net_pay_amount)}</dd><dt>Worker Count</dt><dd>{formatCell(run.worker_count)}</dd><dt>Item Count</dt><dd>{formatCell(run.item_count ?? items.length)}</dd><dt>Financial summary</dt><dd><JsonBlock value={detail.financial_summary} /></dd></dl><div className="warning-box">Estimated tax amount is status/readiness only. Tax filing is future scope.</div></Panel>;
  if (tab === "earnings") return <Panel title="Earnings"><ObjectTable rows={items.filter((item) => ["regular", "overtime", "doubletime", "piece_rate", "bonus", "incentive", "adjustment", "correction"].includes(String(item.earning_type)))} columns={["worker_id", "earning_type", "hours_regular", "hours_overtime", "hours_doubletime", "quantity", "rate_regular", "rate_overtime", "rate_doubletime", "piece_rate", "gross_pay_amount", "source_type"]} /><JsonBlock value={detail.earning_summary} /><div className="warning-box">Legal overtime calculation is not performed unless backend explicitly supports it. Approved overtime hours are stored and reviewed.</div></Panel>;
  if (tab === "reimbursements") return <Panel title="Reimbursements"><ObjectTable rows={items.filter((item) => ["per_diem", "reimbursement"].includes(String(item.earning_type)) || ["per_diem", "reimbursement"].includes(String(item.source_type)))} columns={["worker_id", "source_type", "earning_type", "reimbursement_amount", "description", "evidence_reference"]} /><JsonBlock value={detail.reimbursement_summary} /><div className="warning-box">Reimbursement payment is not executed in this sprint.</div></Panel>;
  if (tab === "deductions") return <Panel title="Deductions"><ObjectTable rows={items.filter((item) => numberValue(item.deduction_amount, 0) !== 0 || item.earning_type === "deduction" || item.earning_type === "penalty")} columns={["worker_id", "earning_type", "deduction_amount", "description", "manual_reason", "net_pay_amount"]} /><JsonBlock value={detail.deduction_summary} /><div className="warning-box">Benefits, garnishments, tax withholding, and remittance are future workflows.</div></Panel>;
  if (tab === "compliance_tax_readiness") return <Panel title="Compliance / Tax Readiness"><dl className="detail-list"><dt>Compliance Status</dt><dd>{formatAction(run.compliance_status)}</dd><dt>Tax Document Status</dt><dd>{formatAction(run.tax_document_status)}</dd><dt>Classification Distribution</dt><dd>{Array.from(new Set(items.map((item) => String(item.worker_classification ?? "")).filter(Boolean))).map(formatAction).join(", ") || "Not captured"}</dd><dt>Warnings</dt><dd><JsonBlock value={detail.warnings} /></dd><dt>Blockers</dt><dd><JsonBlock value={detail.blockers} /></dd><dt>Compliance summary</dt><dd><JsonBlock value={detail.compliance_summary} /></dd><dt>Tax document summary</dt><dd><JsonBlock value={detail.tax_document_summary} /></dd></dl><ObjectTable rows={items} columns={["worker_id", "worker_classification", "compliance_status", "tax_document_status"]} /><div className="warning-box">Compliance and tax readiness are status fields only. Tax filing, W2, 1099, and payroll tax deposits are future workflows.</div></Panel>;
  if (tab === "holds_disputes") return <Panel title="Holds & Disputes"><dl className="detail-list"><dt>Hold Status</dt><dd>{formatAction(run.hold_status)}</dd><dt>Hold Reason</dt><dd>{textValue(run.hold_reason)}</dd><dt>Hold Note</dt><dd>{textValue(run.hold_note)}</dd><dt>Dispute Status</dt><dd>{formatAction(run.dispute_status)}</dd><dt>Dispute Reason</dt><dd>{textValue(run.dispute_reason)}</dd><dt>Dispute Note</dt><dd>{textValue(run.dispute_note)}</dd><dt>Hold dispute summary</dt><dd><JsonBlock value={detail.hold_dispute_summary} /></dd></dl><div className="form-actions"><ActionButton permission="payroll_run.place_hold" session={session} disabled={runInactive(run)} onClick={() => onAction("place_hold")}>Place Hold</ActionButton><ActionButton permission="payroll_run.release_hold" session={session} disabled={runInactive(run)} onClick={() => onAction("release_hold")}>Release Hold</ActionButton><ActionButton permission="payroll_run.dispute" session={session} disabled={runInactive(run)} onClick={() => onAction("dispute")}>Dispute</ActionButton><ActionButton permission="payroll_run.resolve_dispute" session={session} disabled={runInactive(run)} onClick={() => onAction("resolve_dispute")}>Resolve Dispute</ActionButton></div></Panel>;
  if (tab === "approval") return <Panel title="Approval"><dl className="detail-list"><dt>Approval Status</dt><dd>{formatAction(run.approval_status)}</dd><dt>Approved By</dt><dd>{textValue(run.approved_by)}</dd><dt>Approved At</dt><dd>{dateValue(run.approved_at)}</dd><dt>Rejected By</dt><dd>{textValue(run.rejected_by)}</dd><dt>Rejected At</dt><dd>{dateValue(run.rejected_at)}</dd><dt>Rejection Reason</dt><dd>{textValue(run.rejection_reason)}</dd><dt>Rejection Note</dt><dd>{textValue(run.rejection_note)}</dd></dl><div className="form-actions"><ActionButton permission="payroll_run.submit_review" session={session} disabled={runInactive(run)} onClick={() => onAction("submit_review")}>Submit Review</ActionButton><ActionButton permission="payroll_run.start_review" session={session} disabled={runInactive(run)} onClick={() => onAction("start_review")}>Start Review</ActionButton><ActionButton permission="payroll_run.approve" session={session} disabled={runInactive(run)} onClick={() => onAction("approve")}>Approve</ActionButton><ActionButton permission="payroll_run.reject" session={session} disabled={runInactive(run)} onClick={() => onAction("reject")}>Reject</ActionButton></div></Panel>;
  if (tab === "payroll_readiness") return <Panel title="Payroll Readiness"><dl className="detail-list"><dt>Payroll Readiness Status</dt><dd>{formatAction(run.payroll_readiness_status)}</dd><dt>Net Pay Amount</dt><dd>{money(run.net_pay_amount)}</dd><dt>Compliance Status</dt><dd>{formatAction(run.compliance_status)}</dd><dt>Tax Document Status</dt><dd>{formatAction(run.tax_document_status)}</dd><dt>Hold Status</dt><dd>{formatAction(run.hold_status)}</dd><dt>Dispute Status</dt><dd>{formatAction(run.dispute_status)}</dd><dt>Warnings</dt><dd><JsonBlock value={detail.warnings} /></dd><dt>Blockers</dt><dd><JsonBlock value={detail.blockers} /></dd><dt>Required Override Fields</dt><dd><JsonBlock value={detail.required_override_fields} /></dd><dt>Recommended Next Action</dt><dd>{formatAction(run.recommended_next_action ?? detail.recommended_next_action)}</dd></dl><div className="form-actions"><ActionButton permission="payroll_run.mark_payroll_ready" session={session} disabled={runInactive(run)} onClick={() => onAction("payroll_ready")}>Mark Payroll Ready</ActionButton></div><div className="warning-box">Mark Payroll Ready does not send money, submit payroll, create ACH/card/check, create bank transaction, or file taxes.</div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "entity_type", "entity_id", "created_at", "actor_user_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail.audit_allowed === false ? <div className="warning-box">You do not have permission to view payroll audit details.</div> : <ObjectTable rows={detail._audit ?? []} columns={["action", "entity_type", "entity_id", "actor_user_id", "created_at"]} />}</Panel>;
  if (tab === "future_payment") return <PlaceholderPanel title="Future Payment" message="Payment execution is not available in this sprint. Future payment workflows may consume payroll-ready runs." columns={["No payment button", "No mark paid button", "No check/ACH/card action"]} />;
  if (tab === "future_payroll_provider") return <PlaceholderPanel title="Future Payroll Provider" message="Payroll provider submission is not available in this sprint." columns={["No provider submission", "No payroll execution", "No external integration"]} />;
  return <PlaceholderPanel title="Future Tax / Accounting" message="Tax filing, W2/1099 generation, payroll tax deposits, accounting export, and bank reconciliation are not available in this sprint." columns={["No tax filing", "No W2/1099", "No accounting export", "No bank reconciliation"]} />;
}

function PayrollItemsTable({ rows, session, onAction }: { rows: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No payroll items yet.</div>;
  return <div className="wide-table"><table><thead><tr>{["Worker", "Worker Classification", "Source Type", "Earning Type", "Status", "Work Date", "Crew", "Project", "Work Order", "Production Record", "Regular Hours", "Overtime Hours", "Doubletime Hours", "Quantity", "Unit", "Regular Rate", "Overtime Rate", "Doubletime Rate", "Piece Rate", "Gross Pay Amount", "Reimbursement Amount", "Deduction Amount", "Estimated Tax Amount", "Net Pay Amount", "Compliance Status", "Tax Document Status", "Dispute Status", "Hold Status", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{textValue(row.worker_name ?? row.worker_id)}</td><td>{formatAction(row.worker_classification)}</td><td>{formatAction(row.source_type)}</td><td>{formatAction(row.earning_type)}</td><td>{formatAction(row.status)}</td><td>{dateValue(row.work_date)}</td><td>{textValue(row.crew_name ?? row.crew_id)}</td><td>{projectLink(row.project_id, row.project_name ?? row.project_id)}</td><td>{textValue(row.work_order_id)}</td><td>{textValue(row.production_record_id)}</td><td>{formatCell(row.hours_regular)}</td><td>{formatCell(row.hours_overtime)}</td><td>{formatCell(row.hours_doubletime)}</td><td>{formatCell(row.quantity)}</td><td>{textValue(row.unit)}</td><td>{money(row.rate_regular)}</td><td>{money(row.rate_overtime)}</td><td>{money(row.rate_doubletime)}</td><td>{money(row.piece_rate)}</td><td>{money(row.gross_pay_amount)}</td><td>{money(row.reimbursement_amount)}</td><td>{money(row.deduction_amount)}</td><td>{money(row.estimated_tax_amount)}</td><td>{money(row.net_pay_amount)}</td><td>{formatAction(row.compliance_status)}</td><td>{formatAction(row.tax_document_status)}</td><td>{formatAction(row.dispute_status)}</td><td>{formatAction(row.hold_status)}</td><td><div className="form-actions"><ActionButton permission="payroll_item.update" session={session} disabled={itemInactive(row)} onClick={() => onAction("edit_item", row)}>Edit</ActionButton><ActionButton permission="payroll_item.void" session={session} disabled={itemInactive(row)} onClick={() => onAction("void_item", row)}>Void</ActionButton><ActionButton permission="payroll_item.archive" session={session} disabled={row.status === "archived"} onClick={() => onAction("archive_item", row)}>Archive</ActionButton></div></td></tr>)}</tbody></table></div>;
}

function PayrollModal({ type, payrollRunId, item, related, session, onClose, onSaved }: { type: string; payrollRunId: string; run: SyncRecord; item: SyncRecord | null; related: RelatedData; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>(prefillItemForm(item));
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (type === "add_item") await syncosFetch(`/payroll-runs/${payrollRunId}/items`, { method: "POST", body: addItemPayload(form), token: session.token });
      else if (type === "edit_item" && item) await syncosFetch(`/payroll-items/${item.id}`, { method: "PATCH", body: itemPatchPayload(form), token: session.token });
      else if (type === "void_item" && item) await syncosFetch(`/payroll-items/${item.id}/void`, { method: "POST", body: voidPayload(form), token: session.token });
      else if (type === "archive_item" && item) await syncosFetch(`/payroll-items/${item.id}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      else if (type === "recalculate") await syncosFetch(`/payroll-runs/${payrollRunId}/recalculate-totals`, { method: "POST", body: {}, token: session.token });
      else if (type === "submit_review") await syncosFetch(`/payroll-runs/${payrollRunId}/submit-review`, { method: "POST", body: {}, token: session.token });
      else if (type === "start_review") await syncosFetch(`/payroll-runs/${payrollRunId}/start-review`, { method: "POST", body: {}, token: session.token });
      else if (type === "approve") await syncosFetch(`/payroll-runs/${payrollRunId}/approve`, { method: "POST", body: notePayload(form, "approval_note"), token: session.token });
      else if (type === "reject") await syncosFetch(`/payroll-runs/${payrollRunId}/reject`, { method: "POST", body: rejectionPayload(form), token: session.token });
      else if (type === "payroll_ready") await syncosFetch(`/payroll-runs/${payrollRunId}/mark-payroll-ready`, { method: "POST", body: notePayload(form, "ready_note"), token: session.token });
      else if (type === "place_hold") await syncosFetch(`/payroll-runs/${payrollRunId}/place-hold`, { method: "POST", body: holdPayload(form), token: session.token });
      else if (type === "release_hold") await syncosFetch(`/payroll-runs/${payrollRunId}/release-hold`, { method: "POST", body: { release_note: form.release_note }, token: session.token });
      else if (type === "dispute") await syncosFetch(`/payroll-runs/${payrollRunId}/dispute`, { method: "POST", body: disputePayload(form), token: session.token });
      else if (type === "resolve_dispute") await syncosFetch(`/payroll-runs/${payrollRunId}/resolve-dispute`, { method: "POST", body: notePayload(form, "resolution_note"), token: session.token });
      else if (type === "void") await syncosFetch(`/payroll-runs/${payrollRunId}/void`, { method: "POST", body: voidPayload(form), token: session.token });
      else if (type === "archive") await syncosFetch(`/payroll-runs/${payrollRunId}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
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
        {type === "edit_item" ? <ItemEditFields form={form} setForm={setForm} related={related} /> : null}
        {type === "approve" ? <><label>Approval Note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /></> : null}
        {type === "reject" ? <><label>Rejection Reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejection Note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {type === "payroll_ready" ? <><label>Ready Note<textarea value={form.ready_note ?? ""} onChange={(event) => setForm({ ...form, ready_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">Payroll Ready does not send money, submit payroll, create ACH/card/check, create bank records, or file taxes.</div></> : null}
        {type === "place_hold" ? <><label>Hold Reason<textarea value={form.hold_reason ?? ""} onChange={(event) => setForm({ ...form, hold_reason: event.target.value })} required /></label><label>Hold Note<textarea value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label></> : null}
        {type === "release_hold" ? <label>Release Note<textarea value={form.release_note ?? ""} onChange={(event) => setForm({ ...form, release_note: event.target.value })} required /></label> : null}
        {type === "dispute" ? <><label>Dispute Reason<textarea value={form.dispute_reason ?? ""} onChange={(event) => setForm({ ...form, dispute_reason: event.target.value })} required /></label><label>Dispute Note<textarea value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}
        {type === "resolve_dispute" ? <><label>Resolution Note<textarea value={form.resolution_note ?? ""} onChange={(event) => setForm({ ...form, resolution_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /></> : null}
        {["void", "void_item"].includes(type) ? <VoidFields form={form} setForm={setForm} /> : null}
        {["archive", "archive_item"].includes(type) ? <ArchiveFields form={form} setForm={setForm} /> : null}
        {["recalculate", "submit_review", "start_review"].includes(type) ? <div className="warning-box">This lifecycle action uses the Payroll backend and creates no payment, provider submission, bank, tax, or accounting records.</div> : null}
        <div className="form-actions"><button className="primary-button" type="submit">Submit</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  );
}

function PayrollFormFields({ form, setForm, related, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeCreate?: boolean; disabled?: boolean }) {
  return (
    <div className="form-grid">
      {includeCreate ? <><Select label="Payroll Run Type" value={form.payroll_run_type ?? ""} options={["", ...payrollRunTypes]} onChange={(payroll_run_type) => setForm({ ...form, payroll_run_type })} required disabled={disabled} /><Select label="Payroll Cycle" value={form.payroll_cycle ?? ""} options={["", ...payrollCycles]} onChange={(payroll_cycle) => setForm({ ...form, payroll_cycle })} required disabled={disabled} /></> : <Select label="Payroll Cycle" value={form.payroll_cycle ?? ""} options={["", ...payrollCycles]} onChange={(payroll_cycle) => setForm({ ...form, payroll_cycle })} disabled={disabled} />}
      <label>Payroll Period Start<input disabled={disabled} required={includeCreate} type="date" value={form.payroll_period_start ?? ""} onChange={(event) => setForm({ ...form, payroll_period_start: event.target.value })} /></label>
      <label>Payroll Period End<input disabled={disabled} required={includeCreate} type="date" value={form.payroll_period_end ?? ""} onChange={(event) => setForm({ ...form, payroll_period_end: event.target.value })} /></label>
      <label>Pay Date<input disabled={disabled} type="date" value={form.pay_date ?? ""} onChange={(event) => setForm({ ...form, pay_date: event.target.value })} /></label>
      <Select label="Project" value={form.project_id ?? ""} options={["", ...related.projects.map((row) => String(row.id))]} labels={labelsFor(related.projects)} onChange={(project_id) => setForm({ ...form, project_id })} disabled={disabled} />
      <Select label="Crew" value={form.crew_id ?? ""} options={["", ...related.crews.map((row) => String(row.id))]} labels={labelsFor(related.crews)} onChange={(crew_id) => setForm({ ...form, crew_id })} disabled={disabled} />
      <Select label="Compliance Status" value={form.compliance_status ?? ""} options={["", ...complianceStatuses]} onChange={(compliance_status) => setForm({ ...form, compliance_status })} disabled={disabled} />
      <Select label="Tax Document Status" value={form.tax_document_status ?? ""} options={["", ...taxStatuses]} onChange={(tax_document_status) => setForm({ ...form, tax_document_status })} disabled={disabled} />
      <label>Override Reasons JSON<textarea disabled={disabled} value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>
      {!includeCreate ? <><label>Hold Note<textarea disabled={disabled} value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label><label>Dispute Note<textarea disabled={disabled} value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}
    </div>
  );
}

function AddItemFields({ form, setForm, related }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData }) {
  return <div className="form-grid"><Select label="Worker" value={form.worker_id ?? ""} options={["", ...related.workers.map((row) => String(row.id))]} labels={labelsFor(related.workers)} onChange={(worker_id) => setForm({ ...form, worker_id })} required /><label>Worker ID<input value={form.worker_id ?? ""} onChange={(event) => setForm({ ...form, worker_id: event.target.value })} required /></label><Select label="Source Type" value={form.source_type ?? ""} options={["", ...sourceTypes]} onChange={(source_type) => setForm({ ...form, source_type })} required /><Select label="Earning Type" value={form.earning_type ?? ""} options={["", ...earningTypes]} onChange={(earning_type) => setForm({ ...form, earning_type })} required /><Select label="Worker Classification" value={form.worker_classification ?? ""} options={["", ...workerClassifications]} onChange={(worker_classification) => setForm({ ...form, worker_classification })} required /><ItemEditFields form={form} setForm={setForm} related={related} createMode /><div className="warning-box">Payroll item creation records worker compensation readiness only. No payment or tax filing is created.</div></div>;
}

function ItemEditFields({ form, setForm, related, createMode = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; createMode?: boolean }) {
  return <div className="form-grid">{!createMode ? <><Select label="Status" value={form.status ?? ""} options={["", ...itemStatuses]} onChange={(status) => setForm({ ...form, status })} /><Select label="Worker Classification" value={form.worker_classification ?? ""} options={["", ...workerClassifications]} onChange={(worker_classification) => setForm({ ...form, worker_classification })} /></> : null}<Select label="Crew" value={form.crew_id ?? ""} options={["", ...related.crews.map((row) => String(row.id))]} labels={labelsFor(related.crews)} onChange={(crew_id) => setForm({ ...form, crew_id })} /><Select label="Project" value={form.project_id ?? ""} options={["", ...related.projects.map((row) => String(row.id))]} labels={labelsFor(related.projects)} onChange={(project_id) => setForm({ ...form, project_id })} /><Select label="Work Order" value={form.work_order_id ?? ""} options={["", ...related.workOrders.map((row) => String(row.id))]} labels={labelsFor(related.workOrders, "work_order_number")} onChange={(work_order_id) => setForm({ ...form, work_order_id })} /><Select label="Production Record" value={form.production_record_id ?? ""} options={["", ...related.productionRecords.map((row) => String(row.id))]} labels={labelsFor(related.productionRecords, "production_record_number")} onChange={(production_record_id) => setForm({ ...form, production_record_id })} /><label>Work Date<input type="date" value={form.work_date ?? ""} onChange={(event) => setForm({ ...form, work_date: event.target.value })} /></label>{["hours_regular", "hours_overtime", "hours_doubletime", "quantity", "rate_regular", "rate_overtime", "rate_doubletime", "piece_rate", "gross_pay_amount", "reimbursement_amount", "deduction_amount", "estimated_tax_amount"].map((field) => <label key={field}>{formatAction(field)}<input type="number" step="0.01" value={form[field] ?? ""} onChange={(event) => setForm({ ...form, [field]: event.target.value })} /></label>)}<label>Unit<input value={form.unit ?? ""} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label><label>Description<textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Manual Reason<textarea value={form.manual_reason ?? ""} onChange={(event) => setForm({ ...form, manual_reason: event.target.value })} /></label><label>Evidence Reference<input value={form.evidence_reference ?? ""} onChange={(event) => setForm({ ...form, evidence_reference: event.target.value })} /></label><Select label="Compliance Status" value={form.compliance_status ?? ""} options={["", ...complianceStatuses]} onChange={(compliance_status) => setForm({ ...form, compliance_status })} /><Select label="Tax Document Status" value={form.tax_document_status ?? ""} options={["", ...taxStatuses]} onChange={(tax_document_status) => setForm({ ...form, tax_document_status })} /><OverrideField form={form} setForm={setForm} /></div>;
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
  const [token, setToken] = useState(session.token);
  const [permissionText, setPermissionText] = useState(session.permissions.join(", "));
  return <section className="workspace-panel"><div className="section-toolbar"><h2>API Session</h2><span>{session.permissions.length} permissions loaded</span></div><div className="session-grid"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" /><input value={permissionText} onChange={(event) => setPermissionText(event.target.value)} placeholder="Permissions, comma separated" /><button type="button" onClick={() => { saveToken(token); savePermissions(permissionText.split(",").map((item) => item.trim()).filter(Boolean)); window.location.reload(); }}>Save Session</button></div></section>;
}

function useSession() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>(payrollDefaultPermissions);
  useEffect(() => {
    const nextToken = readToken();
    setToken(nextToken);
    const stored = readPermissions();
    setPermissions(stored.length ? stored : payrollDefaultPermissions);
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

const payrollDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "worker.read",
  "crew.read",
  "project.read",
  "work_order.read",
  "production_record.read",
  "payroll_run.read",
  "payroll_run.create",
  "payroll_run.update",
  "payroll_run.add_item",
  "payroll_run.remove_item",
  "payroll_run.recalculate_totals",
  "payroll_run.submit_review",
  "payroll_run.start_review",
  "payroll_run.approve",
  "payroll_run.reject",
  "payroll_run.mark_payroll_ready",
  "payroll_run.place_hold",
  "payroll_run.release_hold",
  "payroll_run.dispute",
  "payroll_run.resolve_dispute",
  "payroll_run.void",
  "payroll_run.archive",
  "payroll_run.timeline.read",
  "payroll_run.audit.read",
  "payroll_item.read",
  "payroll_item.create",
  "payroll_item.update",
  "payroll_item.void",
  "payroll_item.archive",
];

async function loadRelated(token: string): Promise<RelatedData> {
  const [workers, crews, projects, workOrders, productionRecords] = await Promise.all([
    optionalList("/workers", token),
    optionalList("/crews", token),
    optionalList("/projects", token),
    optionalList("/work-orders", token),
    optionalList("/production-records", token),
  ]);
  return { workers, crews, projects, workOrders, productionRecords };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function payrollQuery(filters: Record<string, string>) {
  const query = new URLSearchParams();
  query.set("archived", filters.archived === "true" ? "true" : "false");
  for (const key of ["payroll_run_type", "status", "approval_status", "payroll_readiness_status", "payroll_cycle", "project_id", "crew_id", "payroll_period_start", "payroll_period_end", "pay_date_from", "pay_date_to", "compliance_status", "tax_document_status", "dispute_status", "hold_status", "q"]) if (filters[key]) query.set(key, filters[key]);
  if (filters.sort) query.set("sort", filters.sort);
  return query;
}

function payrollCreatePayload(form: Record<string, string>) {
  return prune({ payroll_run_type: form.payroll_run_type, payroll_cycle: form.payroll_cycle, payroll_period_start: form.payroll_period_start, payroll_period_end: form.payroll_period_end, pay_date: form.pay_date, project_id: form.project_id, crew_id: form.crew_id, compliance_status: form.compliance_status, tax_document_status: form.tax_document_status, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function payrollPatchPayload(form: Record<string, string>) {
  return prune({ payroll_period_start: form.payroll_period_start, payroll_period_end: form.payroll_period_end, pay_date: form.pay_date, payroll_cycle: form.payroll_cycle, project_id: form.project_id, crew_id: form.crew_id, compliance_status: form.compliance_status, tax_document_status: form.tax_document_status, override_reasons: parseJsonField(form.override_reasons, "Override Reasons"), hold_note: form.hold_note, dispute_note: form.dispute_note });
}

function addItemPayload(form: Record<string, string>) {
  return prune({ worker_id: form.worker_id, source_type: form.source_type, earning_type: form.earning_type, worker_classification: form.worker_classification, crew_id: form.crew_id, project_id: form.project_id, work_order_id: form.work_order_id, production_record_id: form.production_record_id, work_date: form.work_date, hours_regular: numericOrUndefined(form.hours_regular), hours_overtime: numericOrUndefined(form.hours_overtime), hours_doubletime: numericOrUndefined(form.hours_doubletime), quantity: numericOrUndefined(form.quantity), unit: form.unit, rate_regular: numericOrUndefined(form.rate_regular), rate_overtime: numericOrUndefined(form.rate_overtime), rate_doubletime: numericOrUndefined(form.rate_doubletime), piece_rate: numericOrUndefined(form.piece_rate), gross_pay_amount: numericOrUndefined(form.gross_pay_amount), reimbursement_amount: numericOrUndefined(form.reimbursement_amount), deduction_amount: numericOrUndefined(form.deduction_amount), estimated_tax_amount: numericOrUndefined(form.estimated_tax_amount), description: form.description, manual_reason: form.manual_reason, evidence_reference: form.evidence_reference, compliance_status: form.compliance_status, tax_document_status: form.tax_document_status, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function itemPatchPayload(form: Record<string, string>) {
  return prune({ status: form.status, worker_classification: form.worker_classification, crew_id: form.crew_id, project_id: form.project_id, work_order_id: form.work_order_id, production_record_id: form.production_record_id, work_date: form.work_date, hours_regular: numericOrUndefined(form.hours_regular), hours_overtime: numericOrUndefined(form.hours_overtime), hours_doubletime: numericOrUndefined(form.hours_doubletime), quantity: numericOrUndefined(form.quantity), unit: form.unit, rate_regular: numericOrUndefined(form.rate_regular), rate_overtime: numericOrUndefined(form.rate_overtime), rate_doubletime: numericOrUndefined(form.rate_doubletime), piece_rate: numericOrUndefined(form.piece_rate), gross_pay_amount: numericOrUndefined(form.gross_pay_amount), reimbursement_amount: numericOrUndefined(form.reimbursement_amount), deduction_amount: numericOrUndefined(form.deduction_amount), estimated_tax_amount: numericOrUndefined(form.estimated_tax_amount), description: form.description, manual_reason: form.manual_reason, evidence_reference: form.evidence_reference, compliance_status: form.compliance_status, tax_document_status: form.tax_document_status, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
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
  return { status: String(item.status ?? ""), worker_classification: String(item.worker_classification ?? ""), crew_id: String(item.crew_id ?? ""), project_id: String(item.project_id ?? ""), work_order_id: String(item.work_order_id ?? ""), production_record_id: String(item.production_record_id ?? ""), work_date: dateInput(item.work_date), hours_regular: String(item.hours_regular ?? ""), hours_overtime: String(item.hours_overtime ?? ""), hours_doubletime: String(item.hours_doubletime ?? ""), quantity: String(item.quantity ?? ""), unit: String(item.unit ?? ""), rate_regular: String(item.rate_regular ?? ""), rate_overtime: String(item.rate_overtime ?? ""), rate_doubletime: String(item.rate_doubletime ?? ""), piece_rate: String(item.piece_rate ?? ""), gross_pay_amount: String(item.gross_pay_amount ?? ""), reimbursement_amount: String(item.reimbursement_amount ?? ""), deduction_amount: String(item.deduction_amount ?? ""), estimated_tax_amount: String(item.estimated_tax_amount ?? ""), description: String(item.description ?? ""), manual_reason: String(item.manual_reason ?? ""), evidence_reference: String(item.evidence_reference ?? ""), compliance_status: String(item.compliance_status ?? ""), tax_document_status: String(item.tax_document_status ?? ""), override_reasons: jsonText(item.override_reasons) };
}

function buildSummary(rows: SyncRecord[]) {
  const summary = { total: rows.length, status: {} as Record<string, number>, type: {} as Record<string, number>, compliance: {} as Record<string, number>, tax: {} as Record<string, number>, netPay: 0 };
  for (const row of rows) {
    increment(summary.status, String(row.status ?? ""));
    increment(summary.type, String(row.payroll_run_type ?? ""));
    increment(summary.compliance, String(row.compliance_status ?? ""));
    increment(summary.tax, String(row.tax_document_status ?? ""));
    summary.netPay += numberValue(row.net_pay_amount, 0);
  }
  return summary;
}

function sortPayrollRuns(rows: SyncRecord[], sort?: string) {
  const statusRank: Record<string, number> = { held: 9, disputed: 8, ready_for_review: 7, under_review: 6, approved: 5, draft: 4, assembling: 3, payroll_ready: 2 };
  return [...rows].sort((a, b) => {
    if (sort === "pay_date_asc") return String(a.pay_date ?? "9999").localeCompare(String(b.pay_date ?? "9999"));
    if (sort === "net_amount_desc") return numberValue(b.net_pay_amount, 0) - numberValue(a.net_pay_amount, 0);
    if (sort === "status") return String(a.status ?? "").localeCompare(String(b.status ?? ""));
    if (sort === "payroll_run_number") return String(a.payroll_run_number ?? "").localeCompare(String(b.payroll_run_number ?? ""));
    if (sort === "payroll_readiness") return String(a.payroll_readiness_status ?? "").localeCompare(String(b.payroll_readiness_status ?? ""));
    return (statusRank[String(b.status)] ?? 0) - (statusRank[String(a.status)] ?? 0) || String(a.pay_date ?? "9999").localeCompare(String(b.pay_date ?? "9999")) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });
}

function payrollChecklist(run: SyncRecord, items: SyncRecord[]): Array<[string, unknown]> {
  return [["Payroll period selected", Boolean(run.payroll_period_start && run.payroll_period_end)], ["Workers included", numberValue(run.worker_count, items.length ? 1 : 0) > 0], ["Items present", items.length > 0], ["Totals calculated", run.net_pay_amount !== undefined], ["Worker classifications reviewed", items.every((item) => item.worker_classification && item.worker_classification !== "unknown")], ["Rates reviewed", items.some((item) => item.rate_regular || item.rate_overtime || item.piece_rate || item.gross_pay_amount)], ["Earnings reviewed", run.gross_pay_amount !== undefined], ["Reimbursements reviewed", run.reimbursement_amount !== undefined], ["Deductions reviewed", run.deduction_amount !== undefined], ["Compliance reviewed", run.compliance_status && run.compliance_status !== "unknown"], ["Tax documents reviewed", run.tax_document_status && run.tax_document_status !== "unknown"], ["No hold", run.hold_status !== "hold"], ["No dispute", run.dispute_status !== "open"], ["Approved", run.approval_status === "approved"], ["Payroll ready", run.payroll_readiness_status === "ready_for_payroll"], ["No payment created", true]];
}

function runInactive(row: SyncRecord) {
  return ["voided", "archived", "payroll_created_later", "paid_later", "partially_paid_later"].includes(String(row.status));
}

function itemInactive(row: SyncRecord) {
  return ["voided", "archived", "payroll_created_later"].includes(String(row.status));
}

function modalTitle(type: string) {
  const titles: Record<string, string> = { add_item: "Add Payroll Item", edit_item: "Edit Payroll Item", recalculate: "Recalculate Totals", submit_review: "Submit Review", start_review: "Start Review", approve: "Approve Payroll Run", reject: "Reject Payroll Run", payroll_ready: "Mark Payroll Ready", place_hold: "Place Hold", release_hold: "Release Hold", dispute: "Dispute Payroll Run", resolve_dispute: "Resolve Dispute", void: "Void Payroll Run", archive: "Archive Payroll Run", void_item: "Void Payroll Item", archive_item: "Archive Payroll Item" };
  return titles[type] ?? "Payroll Action";
}

function actionNotice(type: string) {
  if (type === "add_item") return "Payroll item added. No payment or tax record was created.";
  if (type === "payroll_ready") return "Payroll run marked payroll ready. No money was sent and no provider submission was created.";
  if (type === "approve") return "Payroll run approved. No payment, provider submission, bank, tax, or accounting record was created.";
  if (type.includes("hold")) return "Hold action completed. No payment was created.";
  if (type.includes("dispute")) return "Dispute action completed. No amount was paid.";
  return "Payroll action completed without payment, provider submission, bank, tax, or accounting activity.";
}

function plainError(message: string) {
  if (!message) return "Payroll action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("payroll run not found")) return "Payroll run not found or no access.";
  if (message.includes("payroll item not found")) return "Payroll item not found or no access.";
  if (message.includes("worker")) return "Worker is required.";
  if (message.includes("classification")) return "Worker classification is required.";
  if (message.includes("unknown")) return "Unknown worker classification blocks payroll readiness unless override is supplied.";
  if (message.includes("approved_time") || message.includes("hours")) return "Approved time requires hours.";
  if (message.includes("manual")) return "Manual payroll item requires reason.";
  if (message.includes("reimbursement")) return "Reimbursement requires amount and note/evidence unless override is supplied.";
  if (message.includes("deduction")) return "Deduction requires amount and reason.";
  if (message.includes("duplicate")) return "Duplicate payroll item is not allowed without override.";
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

function payrollLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/payroll/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function projectLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/projects/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function labelsFor(rows: SyncRecord[], preferred = "name") {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.worker_name ?? row.payroll_run_number ?? row.work_order_number ?? row.production_record_number, String(row.id))]));
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
