"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell, ObjectTable, Panel } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";
import { DetailBoundaryNotice, DetailNextActionCard, FormBoundaryNotice, FormPurposeHeader, FormSection, ReadOnlyBanner, RequiredFieldNote } from "../operator-page-templates";

const batchTypes = ["contractor_payable", "payroll", "mixed_later", "correction", "reversal"];
const paymentMethods = ["ach", "check", "card_payout", "wire", "payroll_provider", "manual", "other"];
const batchStatuses = ["draft", "assembling", "ready_for_review", "under_review", "approved", "scheduled", "submitted", "partially_executed_later", "executed_later", "failed", "cancelled", "voided", "archived"];
const approvalStatuses = ["not_submitted", "pending", "approved", "rejected", "withdrawn"];
const executionStatuses = ["not_submitted", "ready_for_execution", "submitted_later", "executed_later", "partially_executed_later", "failed", "cancelled"];
const itemStatuses = ["draft", "ready", "approved", "scheduled", "submitted_later", "executed_later", "failed", "cancelled", "voided", "archived"];
const sourceTypes = ["contractor_payable", "payroll", "correction", "reversal"];
const payeeTypes = ["capacity_provider", "crew", "worker", "vendor_later", "internal_self_perform"];
const tabs = ["overview", "payment_items", "contractor_sources", "payroll_sources", "payee_summary", "payment_method", "financial_summary", "approval", "schedule", "execution_status", "failure_cancellation", "timeline", "audit", "future_ach", "future_check", "future_payroll_provider", "future_bank_reconciliation", "future_accounting_tax"];

type Session = ReturnType<typeof useSession>;

type DetailShape = {
  payment_batch?: SyncRecord;
  payment_items?: SyncRecord[];
  contractor_payable_context?: unknown;
  payroll_context?: unknown;
  payee_summary?: unknown;
  source_summary?: unknown;
  approval_summary?: unknown;
  execution_summary?: unknown;
  failure_summary?: unknown;
  boundary_summary?: unknown;
  warnings?: unknown[];
  blockers?: unknown[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  contractorPayables: SyncRecord[];
  payrollRuns: SyncRecord[];
  providers: SyncRecord[];
  crews: SyncRecord[];
  workers: SyncRecord[];
};

const emptyRelated: RelatedData = { contractorPayables: [], payrollRuns: [], providers: [], crews: [], workers: [] };
type PaymentQueueKey = "draft" | "submitted" | "approved" | "scheduled" | "submittedExecution" | "executed" | "voided" | "itemsAttention" | "archived";

const paymentQueueDefinitions: Array<{ key: PaymentQueueKey; label: string; helper: string; empty: string }> = [
  { key: "draft", label: "Draft", helper: "Payment batches still being prepared.", empty: "No draft payment batches need attention." },
  { key: "submitted", label: "Submitted for Review", helper: "Payment batches waiting for review.", empty: "No payment batches are waiting for review." },
  { key: "approved", label: "Approved", helper: "Payment batches approved internally but not yet scheduled.", empty: "No approved payment batches are waiting for scheduling." },
  { key: "scheduled", label: "Scheduled", helper: "Payment batches scheduled for manual/external execution.", empty: "No scheduled payment batches in this queue." },
  { key: "submittedExecution", label: "Submitted Execution", helper: "Batches recorded as submitted manually or externally.", empty: "No payment batches have submitted-execution status in this queue." },
  { key: "executed", label: "Executed", helper: "Batches marked executed based on manual/external confirmation.", empty: "No executed payment batches in this queue." },
  { key: "voided", label: "Voided", helper: "Voided batches retained for audit.", empty: "No voided payment batches in this queue." },
  { key: "itemsAttention", label: "Items Need Attention", helper: "Payment items blocked, archived, voided, or requiring review if supported by current data.", empty: "No payment items need attention." },
  { key: "archived", label: "Archived", helper: "Closed or removed payment batches/items.", empty: "No archived payment batches/items in this queue." },
];

export function PaymentBatchQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [paymentItems, setPaymentItems] = useState<SyncRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [activeQueue, setActiveQueue] = useState<PaymentQueueKey>("submitted");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = paymentQuery(filters);
      const batches = await syncosFetch<SyncRecord[]>(`/payment-batches?${query.toString()}`, { token: session.token });
      setRows(batches);
      const batchItems = (await Promise.all(batches.slice(0, 25).map((batch) => optionalList(`/payment-batches/${batch.id}/items`, session.token)))).flat();
      setPaymentItems(batchItems);
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

  const visible = useMemo(() => sortBatches(rows.filter((row) => paymentQueueMatches(row, activeQueue)), filters.sort), [rows, activeQueue, filters.sort]);
  const visibleItems = useMemo(() => paymentItems.filter((item) => itemNeedsAttention(item) || activeQueue === "itemsAttention"), [paymentItems, activeQueue]);
  const selectedQueue = paymentQueueDefinitions.find((queue) => queue.key === activeQueue) ?? paymentQueueDefinitions[1];

  function selectQueue(queue: PaymentQueueKey) {
    setActiveQueue(queue);
    setFilters({ ...filters, archived: queue === "archived" ? "true" : "false", status: "", approval_status: "", execution_status: "" });
  }

  return (
    <PaymentShell title="Payment Execution Workbench" purpose="Track internal payment batch approval, scheduling, submission, and manual/external execution status without moving money inside SyncOS.">
      <SessionPanel session={session} />
      <div className="warning-box">Payment Execution records internal payment workflow status only. SyncOS does not move money, initiate ACH, send wires, issue card payouts, print checks, submit payroll, or connect to a bank.</div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {!session.token ? <div className="empty-state">Login required. Authentication is required before this workspace can load.</div> : null}
      {loading ? <div className="empty-state">Loading payment batches...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Today&apos;s payment execution work</h2>
                <p className="muted">Review, approve, schedule, and record external/manual execution status without implying SyncOS moved money.</p>
              </div>
              <Link className="primary-button" href="/payments/new" aria-disabled={!hasPermission(session.permissions, "payment_batch.create")}>Create Payment Batch</Link>
            </div>
            <div className="summary-grid">
              {paymentQueueDefinitions.map((queue) => <SummaryCard key={queue.key} label={queue.label} value={countPaymentQueue(rows, paymentItems, queue.key)} helper={queue.helper} active={activeQueue === queue.key} onClick={() => selectQueue(queue.key)} />)}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Payment queues</h2>
                <p className="muted">{selectedQueue.helper}</p>
              </div>
              <button type="button" onClick={() => { setActiveQueue("submitted"); setFilters({ archived: "false", sort: "updated_desc" }); }}>Reset</button>
            </div>
            <div className="tab-row" role="tablist" aria-label="Payment execution queues">
              {paymentQueueDefinitions.map((queue) => <button key={queue.key} type="button" role="tab" aria-selected={activeQueue === queue.key} onClick={() => selectQueue(queue.key)}>{queue.label}</button>)}
            </div>
            <details className="filter-drawer">
              <summary>Advanced filters</summary>
              <div className="tab-row">
              {["contractor_payable", "payroll"].map((batch_type) => <button key={batch_type} type="button" onClick={() => setFilters({ ...filters, batch_type })}>{formatAction(batch_type)}</button>)}
              {["ach", "check", "manual"].map((payment_method) => <button key={payment_method} type="button" onClick={() => setFilters({ ...filters, payment_method })}>{formatAction(payment_method)}</button>)}
              </div>
              <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search batch, reference, payee, source, failure" />
              <Select label="Batch Type" value={filters.batch_type ?? ""} options={["", ...batchTypes]} onChange={(batch_type) => setFilters({ ...filters, batch_type })} />
              <Select label="Payment Method" value={filters.payment_method ?? ""} options={["", ...paymentMethods]} onChange={(payment_method) => setFilters({ ...filters, payment_method })} />
              <Select label="Status" value={filters.status ?? ""} options={["", ...batchStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
              <Select label="Approval Status" value={filters.approval_status ?? ""} options={["", ...approvalStatuses]} onChange={(approval_status) => setFilters({ ...filters, approval_status })} />
              <Select label="Execution Status" value={filters.execution_status ?? ""} options={["", ...executionStatuses]} onChange={(execution_status) => setFilters({ ...filters, execution_status })} />
              <label>Scheduled From<input type="date" value={filters.scheduled_payment_date_from ?? ""} onChange={(event) => setFilters({ ...filters, scheduled_payment_date_from: event.target.value })} /></label>
              <label>Scheduled To<input type="date" value={filters.scheduled_payment_date_to ?? ""} onChange={(event) => setFilters({ ...filters, scheduled_payment_date_to: event.target.value })} /></label>
              <label>Submitted From<input type="date" value={filters.submitted_from ?? ""} onChange={(event) => setFilters({ ...filters, submitted_from: event.target.value })} /></label>
              <label>Submitted To<input type="date" value={filters.submitted_to ?? ""} onChange={(event) => setFilters({ ...filters, submitted_to: event.target.value })} /></label>
              <label>Executed From<input type="date" value={filters.executed_from ?? ""} onChange={(event) => setFilters({ ...filters, executed_from: event.target.value })} /></label>
              <label>Executed To<input type="date" value={filters.executed_to ?? ""} onChange={(event) => setFilters({ ...filters, executed_to: event.target.value })} /></label>
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "scheduled_date_asc", "executed_date_desc", "amount_desc", "status", "payment_batch_number"]} labels={{ updated_desc: "Recently Updated", scheduled_date_asc: "Scheduled Date Soonest", executed_date_desc: "Executed Date Newest", amount_desc: "Amount Highest", status: "Status", payment_batch_number: "Payment Batch Number" }} onChange={(sort) => setFilters({ ...filters, sort })} />
              </div>
            </details>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{selectedQueue.label}</h2>
                <p className="muted">Scheduled, submitted, and executed are internal status records only. They do not verify bank truth.</p>
              </div>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No payment batches yet. Create a batch and add payment-ready sources.</div> : visible.length ? <PaymentBatchTable rows={visible} /> : <div className="empty-state">{selectedQueue.empty}</div>}
          </section>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Payment Items Visibility</h2>
                <p className="muted">Shows items needing attention from the visible payment batch population. Item actions remain on batch or item detail pages.</p>
              </div>
              <span>{visibleItems.length} items needing attention</span>
            </div>
            {visibleItems.length ? <PaymentItemVisibilityTable rows={visibleItems} /> : <div className="empty-state">No payment items need attention.</div>}
          </section>
          <FuturePlaceholders />
        </>
      ) : null}
    </PaymentShell>
  );
}

export function PaymentBatchCreate() {
  const router = useRouter();
  const session = useSession();
  const [form, setForm] = useState<Record<string, string>>({ batch_type: "contractor_payable", payment_method: "manual", currency: "USD" });
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/payment-batches", { method: "POST", body: createPayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? after?.id ?? "");
      router.push(id ? `/payments/${id}` : "/payments");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <PaymentShell title="Create Payment Batch" purpose="Create governed payment intent without moving money or creating provider, bank, tax, accounting, or reconciliation records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <FormPurposeHeader title="Create Payment Batch" purpose="Create an internal payment execution batch for approval and manual/external status tracking." afterSave="the batch opens in detail view so payables can add items, submit review, approve, schedule, and record manual/external execution state." />
        <RequiredFieldNote>Batch type, payment method, and currency are required for the internal payment batch shell.</RequiredFieldNote>
        <FormBoundaryNotice>Create Payment Batch does not move money, initiate ACH, send wires, issue card payouts, print checks, submit payroll, connect to a bank, or post accounting entries.</FormBoundaryNotice>
        <div className="warning-box">Backend validation is authoritative. Creating a batch does not create ACH, card payout, check, wire, payroll provider, bank transaction, tax filing, or accounting export records.</div>
        <FormSection title="Payment batch setup" description="Define the internal batch type and method before adding payable or payroll items.">
          <PaymentFormFields form={form} setForm={setForm} includeCreate />
        </FormSection>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "payment_batch.create")}>Create Payment Batch</button>
          <Link className="link-button" href="/payments">Cancel</Link>
        </div>
      </form>
    </PaymentShell>
  );
}

export function PaymentBatchEdit({ paymentBatchId }: { paymentBatchId: string }) {
  const router = useRouter();
  const session = useSession();
  const [record, setRecord] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const next = await syncosFetch<SyncRecord>(`/payment-batches/${paymentBatchId}`, { token: session.token });
        setRecord(next);
        setForm({ scheduled_payment_date: dateInput(next.scheduled_payment_date), payment_method: String(next.payment_method ?? ""), notes: String(next.notes ?? ""), override_reasons: jsonText(next.override_reasons) });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, paymentBatchId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/payment-batches/${paymentBatchId}`, { method: "PATCH", body: patchPayload(form), token: session.token });
      router.push(`/payments/${paymentBatchId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  const readonly = ["submitted", "executed_later", "voided", "archived"].includes(String(record?.status));
  return (
    <PaymentShell title="Edit Payment Batch" purpose="Edit payment instruction context without moving money or creating bank/provider/tax/accounting activity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Payment batch not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Cannot move money, create bank transactions, submit providers, mark paid, reconcile, file taxes, or export accounting from this form.</div>
          <PaymentFormFields form={form} setForm={setForm} disabled={readonly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readonly || !hasPermission(session.permissions, "payment_batch.update")}>Save Payment Batch</button>
            <Link className="link-button" href={`/payments/${paymentBatchId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </PaymentShell>
  );
}

export function PaymentBatchDetail({ paymentBatchId }: { paymentBatchId: string }) {
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
        syncosFetch<DetailShape>(`/payment-batches/${paymentBatchId}/detail`, { token: session.token }),
        loadRelated(session.token),
      ]);
      const [timeline, audit] = await Promise.all([
        optionalList(`/payment-batches/${paymentBatchId}/timeline`, session.token),
        optionalList(`/payment-batches/${paymentBatchId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
      setRelated(nextRelated);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, paymentBatchId]);

  const batch = detail?.payment_batch;
  const items = detail?.payment_items ?? [];

  function openAction(type: string, item?: SyncRecord) {
    setSelectedItem(item ?? null);
    setModal(type);
  }

  return (
    <PaymentShell title="Payment Batch Detail" purpose="Show payment execution intent and status before external money movement, bank reconciliation, tax, or accounting workflows exist.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Payment Batch Detail.</div> : null}
      {!batch && session.token && !error ? <div className="empty-state">Payment batch not found or no access.</div> : null}
      {batch && detail ? (
        <>
          {!hasPermission(session.permissions, "payment_batch.update") ? <ReadOnlyBanner /> : null}
          <DetailNextActionCard
            variant="finance"
            status={formatAction(batch.status)}
            nextActionLabel={nextPaymentAction(batch)}
            helperText="Review approval, schedule, submission, execution status, included items, and exceptions before recording the next internal payment state."
            disabled={!hasPermission(session.permissions, "payment_batch.update")}
            disabledReason="Read-only users cannot perform lifecycle actions."
            boundaryText="Payment Execution records internal/manual status only. SyncOS does not initiate ACH, wire, card payout, check, payroll, or bank movement."
          />
          <DetailBoundaryNotice>Payment Execution records internal/manual status only. SyncOS does not initiate ACH, wire, card payout, check, payroll, bank movement, tax filing, or accounting posting.</DetailBoundaryNotice>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(batch.payment_batch_number, "Payment Batch")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(batch.batch_type)}</span>
                  <span className="badge">{formatAction(batch.payment_method)}</span>
                  <span className="badge">{formatAction(batch.status)}</span>
                  <span className="badge">{formatAction(batch.approval_status)}</span>
                  <span className="badge">{formatAction(batch.execution_status)}</span>
                  <span className="badge">{formatAction(batch.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/payments/${paymentBatchId}/edit`} aria-disabled={!hasPermission(session.permissions, "payment_batch.update")}>Edit Batch</Link>
                <ActionButton permission="payment_batch.add_item" session={session} disabled={batchInactive(batch)} onClick={() => openAction("add_contractor")}>Add Contractor Payable Item</ActionButton>
                <ActionButton permission="payment_batch.add_item" session={session} disabled={batchInactive(batch)} onClick={() => openAction("add_payroll")}>Add Payroll Item</ActionButton>
                <ActionButton permission="payment_batch.recalculate_totals" session={session} disabled={batchInactive(batch)} onClick={() => openAction("recalculate")}>Recalculate Totals</ActionButton>
                <ActionButton permission="payment_batch.submit_review" session={session} disabled={batchInactive(batch)} onClick={() => openAction("submit_review")}>Submit Review</ActionButton>
                <ActionButton permission="payment_batch.start_review" session={session} disabled={batchInactive(batch)} onClick={() => openAction("start_review")}>Start Review</ActionButton>
                <ActionButton permission="payment_batch.approve" session={session} disabled={batchInactive(batch)} onClick={() => openAction("approve")}>Approve</ActionButton>
                <ActionButton permission="payment_batch.reject" session={session} disabled={batchInactive(batch)} onClick={() => openAction("reject")}>Reject</ActionButton>
                <ActionButton permission="payment_batch.schedule" session={session} disabled={batchInactive(batch)} onClick={() => openAction("schedule")}>Schedule</ActionButton>
                <ActionButton permission="payment_batch.submit_execution" session={session} disabled={batchInactive(batch)} onClick={() => openAction("submit_execution")}>Submit Execution</ActionButton>
                <ActionButton permission="payment_batch.mark_executed" session={session} disabled={batch.status === "archived" || batch.status === "voided"} onClick={() => openAction("mark_executed")}>Mark Executed</ActionButton>
                <ActionButton permission="payment_batch.mark_failed" session={session} disabled={batch.status === "archived" || batch.status === "voided"} onClick={() => openAction("mark_failed")}>Mark Failed</ActionButton>
                <ActionButton permission="payment_batch.cancel" session={session} disabled={batch.status === "executed_later" || batch.status === "archived" || batch.status === "voided"} onClick={() => openAction("cancel")}>Cancel</ActionButton>
                <ActionButton permission="payment_batch.void" session={session} disabled={batch.status === "voided" || batch.status === "archived"} onClick={() => openAction("void")}>Void</ActionButton>
                <ActionButton permission="payment_batch.archive" session={session} disabled={batch.status === "archived"} onClick={() => openAction("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Total Payment Amount" value={money(batch.total_payment_amount)} />
              <Metric label="Item Count" value={formatCell(batch.item_count ?? items.length)} />
              <Metric label="Batch Type" value={formatAction(batch.batch_type)} />
              <Metric label="Payment Method" value={formatAction(batch.payment_method)} />
              <Metric label="Approval Status" value={formatAction(batch.approval_status)} />
              <Metric label="Execution Status" value={formatAction(batch.execution_status)} />
              <Metric label="Scheduled Date" value={dateValue(batch.scheduled_payment_date)} />
              <Metric label="Submitted At" value={dateValue(batch.submitted_at)} />
              <Metric label="Executed At" value={dateValue(batch.executed_at)} />
              <Metric label="Failure Reason" value={textValue(batch.failure_reason)} />
            </div>
            <div className="warning-box">Payment Execution does not move money in this sprint. Submit Execution is status-only/manual reference. Mark Executed is status-only/manual reference. Bank reconciliation and accounting export are future workflows.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Batch Type</dt><dd>{formatAction(batch.batch_type)}</dd>
                <dt>Payment Method</dt><dd>{formatAction(batch.payment_method)}</dd>
                <dt>Status</dt><dd>{formatAction(batch.status)}</dd>
                <dt>Approval</dt><dd>{formatAction(batch.approval_status)}</dd>
                <dt>Execution</dt><dd>{formatAction(batch.execution_status)}</dd>
                <dt>Scheduled Date</dt><dd>{dateValue(batch.scheduled_payment_date)}</dd>
                <dt>Total Amount</dt><dd>{money(batch.total_payment_amount)}</dd>
                <dt>Item Count</dt><dd>{formatCell(batch.item_count ?? items.length)}</dd>
                <dt>Contractor Payable Count</dt><dd>{items.filter((item) => item.source_type === "contractor_payable").length}</dd>
                <dt>Payroll Item Count</dt><dd>{items.filter((item) => item.source_type === "payroll").length}</dd>
                <dt>Failure State</dt><dd>{textValue(batch.failure_reason)}</dd>
              </dl>
              <Checklist items={paymentChecklist(batch, items)} />
              <div className="warning-box">No real money movement. No bank transaction, provider submission, reconciliation, tax filing, W2/1099, benefit, garnishment, or accounting export is available here.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs" role="tablist" aria-label="Payment batch detail sections">
                {tabs.map((itemTab) => <button key={itemTab} type="button" role="tab" aria-selected={tab === itemTab} className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <PaymentTab tab={tab} detail={detail} batch={batch} items={items} session={session} onAction={openAction} />
            </section>
          </div>
          {modal ? <PaymentModal type={modal} paymentBatchId={paymentBatchId} batch={batch} item={selectedItem} related={related} session={session} onClose={() => { setModal(""); setSelectedItem(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </PaymentShell>
  );
}

export function PaymentItemDetail({ paymentItemId }: { paymentItemId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<SyncRecord | null>(null);
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      setDetail(await syncosFetch<SyncRecord>(`/payment-items/${paymentItemId}/detail`, { token: session.token }));
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, paymentItemId]);

  const item = (detail?.item ?? detail) as SyncRecord | null;
  return (
    <PaymentShell title="Payment Item Detail" purpose="Show payment item instruction context without item-level execution controls or external money movement.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!item ? <div className="empty-state">Payment item not found or no access.</div> : (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(item.payee_name ?? item.id, "Payment Item")}</h2>
                <div className="badge-row"><span className="badge">{formatAction(item.source_type)}</span><span className="badge">{formatAction(item.status)}</span><span className="badge">{formatAction(item.execution_status)}</span></div>
              </div>
              <div className="form-actions">
                <ActionButton permission="payment_item.update" session={session} disabled={itemInactive(item)} onClick={() => setModal("edit_item")}>Edit Item</ActionButton>
                <ActionButton permission="payment_item.void" session={session} disabled={itemInactive(item)} onClick={() => setModal("void_item")}>Void Item</ActionButton>
                <ActionButton permission="payment_item.archive" session={session} disabled={item.status === "archived"} onClick={() => setModal("archive_item")}>Archive Item</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Payment Amount" value={money(item.payment_amount)} />
              <Metric label="Payment Method" value={formatAction(item.payment_method)} />
              <Metric label="Payee Type" value={formatAction(item.payee_type)} />
              <Metric label="Execution Status" value={formatAction(item.execution_status)} />
              <Metric label="Currency" value={textValue(item.currency)} />
            </div>
          </section>
          <div className="organization-layout">
            <Panel title="Payment Item"><JsonBlock value={item} /></Panel>
            <Panel title="Context"><JsonBlock value={detail} /><div className="warning-box">No execution buttons are exposed at item level. Payment Execution records instruction/status only and does not create ACH, card, check, wire, provider, bank, tax, accounting, or reconciliation records.</div></Panel>
          </div>
          {modal ? <PaymentModal type={modal} paymentBatchId={String(item.payment_batch_id ?? "")} batch={{}} item={item} related={emptyRelated} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      )}
    </PaymentShell>
  );
}

function PaymentShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/payments", "Payment Batch Queue", "active"],
    ["/payments/new", "Create Payment Batch", "active"],
    ["#detail", "Payment Batch Detail", "placeholder"],
    ["#items", "Payment Items", "placeholder"],
    ["#contractor", "Contractor Payable Source Context", "placeholder"],
    ["#payroll", "Payroll Source Context", "placeholder"],
    ["#payee", "Payee Context", "placeholder"],
    ["#method", "Payment Method", "placeholder"],
    ["#financial", "Financial Summary", "placeholder"],
    ["#approval", "Approval", "placeholder"],
    ["#schedule", "Schedule", "placeholder"],
    ["#execution", "Execution Status", "placeholder"],
    ["#failure", "Failure / Cancellation", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-ach", "Future ACH", "placeholder"],
    ["#future-check", "Future Check", "placeholder"],
    ["#future-provider", "Future Payroll Provider", "placeholder"],
    ["#future-bank", "Future Bank Reconciliation", "placeholder"],
    ["#future-accounting-tax", "Future Accounting / Tax", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Payments</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function PaymentBatchTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Payment Batch", "Source Type / Items", "Total Amount", "Review Status", "Schedule Status", "Execution Status", "Submitted / Executed", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{batchLink(row.id, row.payment_batch_number ?? row.id)}<div className="muted">{formatAction(row.payment_method)}</div></td><td>{formatAction(row.batch_type)}<div className="muted">{formatCell(row.item_count)} items</div></td><td>{money(row.total_payment_amount)}<div className="muted">{textValue(row.currency)}</div></td><td>{formatAction(row.status)}<div className="muted">{formatAction(row.approval_status)}</div></td><td>{dateValue(row.scheduled_payment_date)}</td><td>{formatAction(row.execution_status)}<div className="muted">{textValue(row.execution_reference)}</div></td><td>{dateValue(row.submitted_at)} / {dateValue(row.executed_at)}</td><td>{nextPaymentAction(row)}</td><td><Link className="link-button" href={`/payments/${row.id}`}>Open Detail</Link></td></tr>)}</tbody></table></div>;
}

function PaymentItemVisibilityTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Payment Item", "Source", "Payee", "Amount", "Item Status", "Batch", "Next Action"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><Link className="table-link" href={`/payment-items/${row.id}`}>{textValue(row.id)}</Link></td><td>{formatAction(row.source_type)}<div className="muted">{payableLink(row.contractor_payable_id, row.contractor_payable_number ?? row.contractor_payable_id)} {payrollLink(row.payroll_run_id, row.payroll_run_number ?? row.payroll_run_id)}</div></td><td>{textValue(row.payee_name ?? row.worker_name ?? row.capacity_provider_name ?? row.crew_name)}</td><td>{money(row.payment_amount)}<div className="muted">{textValue(row.currency)}</div></td><td>{formatAction(row.status)}<div className="muted">{formatAction(row.execution_status)}</div></td><td>{batchLink(row.payment_batch_id, row.payment_batch_number ?? row.payment_batch_id)}</td><td>{paymentItemNextAction(row)}</td></tr>)}</tbody></table></div>;
}

function PaymentTab({ tab, detail, batch, items, session, onAction }: { tab: string; detail: DetailShape; batch: SyncRecord; items: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Payment batch number</dt><dd>{textValue(batch.payment_batch_number)}</dd><dt>Batch type</dt><dd>{formatAction(batch.batch_type)}</dd><dt>Payment method</dt><dd>{formatAction(batch.payment_method)}</dd><dt>Status</dt><dd>{formatAction(batch.status)}</dd><dt>Approval status</dt><dd>{formatAction(batch.approval_status)}</dd><dt>Execution status</dt><dd>{formatAction(batch.execution_status)}</dd><dt>Scheduled payment date</dt><dd>{dateValue(batch.scheduled_payment_date)}</dd><dt>Submitted at/by</dt><dd>{dateValue(batch.submitted_at)} / {textValue(batch.submitted_by)}</dd><dt>Executed at</dt><dd>{dateValue(batch.executed_at)}</dd><dt>Execution reference</dt><dd>{textValue(batch.execution_reference)}</dd><dt>Notes</dt><dd>{textValue(batch.notes)}</dd><dt>Override reasons</dt><dd><JsonBlock value={batch.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(batch.created_at)}</dd><dt>Updated</dt><dd>{dateValue(batch.updated_at)}</dd></dl><div className="warning-box">Payment Execution represents governed payment intent and status. It does not process ACH, card payouts, checks, wires, payroll provider submissions, bank transactions, tax filings, or accounting exports.</div></Panel>;
  if (tab === "payment_items") return <Panel title="Payment Items"><div className="form-actions"><ActionButton permission="payment_batch.add_item" session={session} disabled={batchInactive(batch)} onClick={() => onAction("add_contractor")}>Add Contractor Payable Item</ActionButton><ActionButton permission="payment_batch.add_item" session={session} disabled={batchInactive(batch)} onClick={() => onAction("add_payroll")}>Add Payroll Item</ActionButton></div><PaymentItemsTable rows={items} session={session} onAction={onAction} /><div className="warning-box">Adding payment items creates no real payment. Sources must already be payment-ready or payroll-ready according to backend validation.</div></Panel>;
  if (tab === "contractor_sources") return <Panel title="Contractor Payable Sources"><SourceSummary rows={items.filter((item) => item.source_type === "contractor_payable")} /><JsonBlock value={detail.contractor_payable_context} /><div className="warning-box">Contractor Payable remains the obligation source. Payment Execution records payment intent only.</div></Panel>;
  if (tab === "payroll_sources") return <Panel title="Payroll Sources"><SourceSummary rows={items.filter((item) => item.source_type === "payroll")} /><JsonBlock value={detail.payroll_context} /><div className="warning-box">Payroll remains the worker compensation source. Payment Execution does not submit to payroll provider.</div></Panel>;
  if (tab === "payee_summary") return <Panel title="Payee Summary"><PayeeSummary items={items} /><JsonBlock value={detail.payee_summary} /><div className="warning-box">Payee information is payment instruction context only. No payout is sent.</div></Panel>;
  if (tab === "payment_method") return <Panel title="Payment Method"><dl className="detail-list"><dt>Payment Method</dt><dd>{formatAction(batch.payment_method)}</dd><dt>Indicator</dt><dd>{methodMessage(batch.payment_method)}</dd></dl><div className="warning-box">{methodMessage(batch.payment_method)}</div></Panel>;
  if (tab === "financial_summary") return <Panel title="Financial Summary"><dl className="detail-list"><dt>Total Payment Amount</dt><dd>{money(batch.total_payment_amount)}</dd><dt>Currency</dt><dd>{textValue(batch.currency)}</dd><dt>Item Count</dt><dd>{formatCell(batch.item_count ?? items.length)}</dd><dt>Contractor Payable Total</dt><dd>{money(sumBySource(items, "contractor_payable"))}</dd><dt>Payroll Total</dt><dd>{money(sumBySource(items, "payroll"))}</dd><dt>Failed Amount</dt><dd>{money(sumByStatus(items, "failed"))}</dd><dt>Submitted Amount</dt><dd>{money(sumByStatus(items, "submitted_later"))}</dd><dt>Executed Amount</dt><dd>{money(sumByStatus(items, "executed_later"))}</dd></dl><div className="warning-box">Totals are payment instruction totals, not bank-cleared amounts.</div></Panel>;
  if (tab === "approval") return <Panel title="Approval"><dl className="detail-list"><dt>Approval Status</dt><dd>{formatAction(batch.approval_status)}</dd><dt>Approved By</dt><dd>{textValue(batch.approved_by)}</dd><dt>Approved At</dt><dd>{dateValue(batch.approved_at)}</dd><dt>Rejected By</dt><dd>{textValue(batch.rejected_by)}</dd><dt>Rejected At</dt><dd>{dateValue(batch.rejected_at)}</dd><dt>Rejection Reason</dt><dd>{textValue(batch.rejection_reason)}</dd><dt>Rejection Note</dt><dd>{textValue(batch.rejection_note)}</dd></dl><div className="form-actions"><ActionButton permission="payment_batch.submit_review" session={session} disabled={batchInactive(batch)} onClick={() => onAction("submit_review")}>Submit Review</ActionButton><ActionButton permission="payment_batch.start_review" session={session} disabled={batchInactive(batch)} onClick={() => onAction("start_review")}>Start Review</ActionButton><ActionButton permission="payment_batch.approve" session={session} disabled={batchInactive(batch)} onClick={() => onAction("approve")}>Approve</ActionButton><ActionButton permission="payment_batch.reject" session={session} disabled={batchInactive(batch)} onClick={() => onAction("reject")}>Reject</ActionButton></div></Panel>;
  if (tab === "schedule") return <Panel title="Schedule"><dl className="detail-list"><dt>Scheduled Payment Date</dt><dd>{dateValue(batch.scheduled_payment_date)}</dd><dt>Payment Method</dt><dd>{formatAction(batch.payment_method)}</dd><dt>Status</dt><dd>{formatAction(batch.status)}</dd><dt>Execution Status</dt><dd>{formatAction(batch.execution_status)}</dd></dl><ActionButton permission="payment_batch.schedule" session={session} disabled={batchInactive(batch)} onClick={() => onAction("schedule")}>Schedule</ActionButton><div className="warning-box">Scheduling does not move money.</div></Panel>;
  if (tab === "execution_status") return <Panel title="Execution Status"><dl className="detail-list"><dt>Execution Status</dt><dd>{formatAction(batch.execution_status)}</dd><dt>Status</dt><dd>{formatAction(batch.status)}</dd><dt>Submitted At</dt><dd>{dateValue(batch.submitted_at)}</dd><dt>Submitted By</dt><dd>{textValue(batch.submitted_by)}</dd><dt>Executed At</dt><dd>{dateValue(batch.executed_at)}</dd><dt>Execution Reference</dt><dd>{textValue(batch.execution_reference)}</dd></dl><div className="form-actions"><ActionButton permission="payment_batch.submit_execution" session={session} disabled={batchInactive(batch)} onClick={() => onAction("submit_execution")}>Submit Execution</ActionButton><ActionButton permission="payment_batch.mark_executed" session={session} disabled={batch.status === "archived" || batch.status === "voided"} onClick={() => onAction("mark_executed")}>Mark Executed</ActionButton><ActionButton permission="payment_batch.mark_failed" session={session} disabled={batch.status === "archived" || batch.status === "voided"} onClick={() => onAction("mark_failed")}>Mark Failed</ActionButton></div><div className="warning-box">Submit Execution records a status-only/manual submission reference. Mark Executed records executed_later only and does not confirm bank clearing or reconciliation.</div></Panel>;
  if (tab === "failure_cancellation") return <Panel title="Failure / Cancellation"><dl className="detail-list"><dt>Failure Reason</dt><dd>{textValue(batch.failure_reason)}</dd><dt>Failure Note</dt><dd>{textValue(batch.failure_note)}</dd><dt>Cancel Reason</dt><dd>{textValue(batch.cancel_reason)}</dd><dt>Cancel Note</dt><dd>{textValue(batch.cancel_note)}</dd><dt>Current Status</dt><dd>{formatAction(batch.status)}</dd></dl><div className="form-actions"><ActionButton permission="payment_batch.mark_failed" session={session} disabled={batch.status === "archived" || batch.status === "voided"} onClick={() => onAction("mark_failed")}>Mark Failed</ActionButton><ActionButton permission="payment_batch.cancel" session={session} disabled={batch.status === "executed_later" || batch.status === "archived" || batch.status === "voided"} onClick={() => onAction("cancel")}>Cancel</ActionButton><ActionButton permission="payment_batch.void" session={session} disabled={batch.status === "voided" || batch.status === "archived"} onClick={() => onAction("void")}>Void</ActionButton><ActionButton permission="payment_batch.archive" session={session} disabled={batch.status === "archived"} onClick={() => onAction("archive")}>Archive</ActionButton></div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "entity_type", "entity_id", "created_at", "actor_user_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail.audit_allowed === false ? <div className="warning-box">You do not have permission to view payment execution audit details.</div> : <ObjectTable rows={detail._audit ?? []} columns={["action", "entity_type", "entity_id", "created_at", "actor_user_id"]} />}</Panel>;
  if (tab === "future_ach") return <PlaceholderPanel title="Future ACH Placeholder" message="ACH processor integration is not available in this sprint." columns={["ach_submit_button"]} />;
  if (tab === "future_check") return <PlaceholderPanel title="Future Check Placeholder" message="Check printing is not available in this sprint." columns={["print_check_button"]} />;
  if (tab === "future_payroll_provider") return <PlaceholderPanel title="Future Payroll Provider Placeholder" message="Payroll provider submission is not available in this sprint." columns={["provider_submit_button"]} />;
  if (tab === "future_bank_reconciliation") return <PlaceholderPanel title="Future Bank Reconciliation Placeholder" message="Bank reconciliation is not available in this sprint. Executed status does not mean bank-cleared." columns={["bank_reconciliation"]} />;
  return <PlaceholderPanel title="Future Accounting / Tax Placeholder" message="Accounting export, GL posting, tax filing, W2/1099, benefit, and garnishment workflows are not available in this sprint." columns={["accounting_export", "tax_filing"]} />;
}

function PaymentItemsTable({ rows, session, onAction }: { rows: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No payment items in this batch.</div>;
  return <div className="wide-table"><table><thead><tr>{["Source Type", "Status", "Execution Status", "Payee Type", "Payee Name", "Contractor Payable", "Contractor Payable Item", "Payroll Run", "Payroll Item", "Worker", "Provider", "Crew", "Payment Method", "Payment Amount", "Currency", "Payment Date", "Execution Reference", "Failure Reason", "Notes", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{formatAction(row.source_type)}</td><td>{formatAction(row.status)}</td><td>{formatAction(row.execution_status)}</td><td>{formatAction(row.payee_type)}</td><td>{textValue(row.payee_name)}</td><td>{payableLink(row.contractor_payable_id, row.contractor_payable_number ?? row.contractor_payable_id)}</td><td>{textValue(row.contractor_payable_item_id)}</td><td>{payrollLink(row.payroll_run_id, row.payroll_run_number ?? row.payroll_run_id)}</td><td>{textValue(row.payroll_item_id)}</td><td>{textValue(row.worker_name ?? row.worker_id)}</td><td>{textValue(row.capacity_provider_name ?? row.capacity_provider_id)}</td><td>{textValue(row.crew_name ?? row.crew_id)}</td><td>{formatAction(row.payment_method)}</td><td>{money(row.payment_amount)}</td><td>{textValue(row.currency)}</td><td>{dateValue(row.payment_date)}</td><td>{textValue(row.execution_reference)}</td><td>{textValue(row.failure_reason)}</td><td>{textValue(row.notes)}</td><td><div className="form-actions"><Link className="link-button" href={`/payment-items/${row.id}`}>Open</Link><ActionButton permission="payment_item.update" session={session} disabled={itemInactive(row)} onClick={() => onAction("edit_item", row)}>Edit</ActionButton><ActionButton permission="payment_item.void" session={session} disabled={itemInactive(row)} onClick={() => onAction("void_item", row)}>Void</ActionButton><ActionButton permission="payment_item.archive" session={session} disabled={row.status === "archived"} onClick={() => onAction("archive_item", row)}>Archive</ActionButton></div></td></tr>)}</tbody></table></div>;
}

function PaymentModal({ type, paymentBatchId, item, related, session, onClose, onSaved }: { type: string; paymentBatchId: string; batch: SyncRecord; item: SyncRecord | null; related: RelatedData; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>(prefillItemForm(item));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      if (type === "add_contractor") await syncosFetch(`/payment-batches/${paymentBatchId}/items/contractor-payable`, { method: "POST", body: addContractorPayload(form), token: session.token });
      else if (type === "add_payroll") await syncosFetch(`/payment-batches/${paymentBatchId}/items/payroll-run`, { method: "POST", body: addPayrollPayload(form), token: session.token });
      else if (type === "edit_item" && item) await syncosFetch(`/payment-items/${item.id}`, { method: "PATCH", body: itemPatchPayload(form), token: session.token });
      else if (type === "void_item" && item) await syncosFetch(`/payment-items/${item.id}/void`, { method: "POST", body: voidPayload(form), token: session.token });
      else if (type === "archive_item" && item) await syncosFetch(`/payment-items/${item.id}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      else if (type === "recalculate") await syncosFetch(`/payment-batches/${paymentBatchId}/recalculate-totals`, { method: "POST", body: {}, token: session.token });
      else if (type === "submit_review") await syncosFetch(`/payment-batches/${paymentBatchId}/submit-review`, { method: "POST", body: {}, token: session.token });
      else if (type === "start_review") await syncosFetch(`/payment-batches/${paymentBatchId}/start-review`, { method: "POST", body: {}, token: session.token });
      else if (type === "approve") await syncosFetch(`/payment-batches/${paymentBatchId}/approve`, { method: "POST", body: notePayload(form, "approval_note"), token: session.token });
      else if (type === "reject") await syncosFetch(`/payment-batches/${paymentBatchId}/reject`, { method: "POST", body: rejectionPayload(form), token: session.token });
      else if (type === "schedule") await syncosFetch(`/payment-batches/${paymentBatchId}/schedule`, { method: "POST", body: schedulePayload(form), token: session.token });
      else if (type === "submit_execution") await syncosFetch(`/payment-batches/${paymentBatchId}/submit-execution`, { method: "POST", body: submitExecutionPayload(form), token: session.token });
      else if (type === "mark_executed") await syncosFetch(`/payment-batches/${paymentBatchId}/mark-executed`, { method: "POST", body: markExecutedPayload(form), token: session.token });
      else if (type === "mark_failed") await syncosFetch(`/payment-batches/${paymentBatchId}/mark-failed`, { method: "POST", body: failurePayload(form), token: session.token });
      else if (type === "cancel") await syncosFetch(`/payment-batches/${paymentBatchId}/cancel`, { method: "POST", body: cancelPayload(form), token: session.token });
      else if (type === "void") await syncosFetch(`/payment-batches/${paymentBatchId}/void`, { method: "POST", body: voidPayload(form), token: session.token });
      else if (type === "archive") await syncosFetch(`/payment-batches/${paymentBatchId}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card" onSubmit={(event) => void submit(event)}>
        <div className="section-toolbar"><h2>{modalTitle(type)}</h2><button type="button" onClick={onClose} disabled={submitting}>Close</button></div>
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        {type === "add_contractor" ? <AddContractorFields form={form} setForm={setForm} related={related} /> : null}
        {type === "add_payroll" ? <AddPayrollFields form={form} setForm={setForm} related={related} /> : null}
        {type === "edit_item" ? <ItemEditFields form={form} setForm={setForm} /> : null}
        {type === "approve" ? <><label>Approval Note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /></> : null}
        {type === "reject" ? <><label>Rejection Reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejection Note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {type === "schedule" ? <><label>Scheduled Payment Date<input type="date" value={form.scheduled_payment_date ?? ""} onChange={(event) => setForm({ ...form, scheduled_payment_date: event.target.value })} required /></label><label>Schedule Note<textarea value={form.schedule_note ?? ""} onChange={(event) => setForm({ ...form, schedule_note: event.target.value })} /></label><div className="warning-box">Scheduling does not move money.</div></> : null}
        {type === "submit_execution" ? <><label>Submit Note<textarea value={form.submit_note ?? ""} onChange={(event) => setForm({ ...form, submit_note: event.target.value })} required /></label><label>External Reference<input value={form.external_reference ?? ""} onChange={(event) => setForm({ ...form, external_reference: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">This records a status-only/manual submission reference. It does not send ACH, card payout, check, wire, payroll provider file, or bank transaction.</div></> : null}
        {type === "mark_executed" ? <><label>Execution Reference<input value={form.execution_reference ?? ""} onChange={(event) => setForm({ ...form, execution_reference: event.target.value })} required /></label><label>Execution Note<textarea value={form.execution_note ?? ""} onChange={(event) => setForm({ ...form, execution_note: event.target.value })} required /></label><label>Executed At<input type="datetime-local" value={form.executed_at ?? ""} onChange={(event) => setForm({ ...form, executed_at: event.target.value })} /></label><div className="warning-box">This records executed_later status only. It does not confirm bank clearing or reconciliation.</div></> : null}
        {type === "mark_failed" ? <><label>Failure Reason<textarea value={form.failure_reason ?? ""} onChange={(event) => setForm({ ...form, failure_reason: event.target.value })} required /></label><label>Failure Note<textarea value={form.failure_note ?? ""} onChange={(event) => setForm({ ...form, failure_note: event.target.value })} /></label></> : null}
        {type === "cancel" ? <><label>Cancel Reason<textarea value={form.cancel_reason ?? ""} onChange={(event) => setForm({ ...form, cancel_reason: event.target.value })} required /></label><label>Cancel Note<textarea value={form.cancel_note ?? ""} onChange={(event) => setForm({ ...form, cancel_note: event.target.value })} /></label></> : null}
        {["void", "void_item"].includes(type) ? <VoidFields form={form} setForm={setForm} /> : null}
        {["archive", "archive_item"].includes(type) ? <ArchiveFields form={form} setForm={setForm} /> : null}
        {["recalculate", "submit_review", "start_review"].includes(type) ? <div className="warning-box">This lifecycle action uses the Payment Execution backend only. It creates no ACH, card, check, wire, provider, bank, tax, accounting, reconciliation, or real money movement records.</div> : null}
        <div className="form-actions" data-testid="modal-actions"><button className={["reject", "cancel", "void", "void_item", "archive", "archive_item", "mark_failed"].includes(type) ? "danger-button" : "primary-button"} type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit"}</button><button type="button" onClick={onClose} disabled={submitting}>Cancel</button></div>
      </form>
    </div>
  );
}

function PaymentFormFields({ form, setForm, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; includeCreate?: boolean; disabled?: boolean }) {
  return <div className="form-grid">{includeCreate ? <><Select label="Batch Type" value={form.batch_type ?? ""} options={["", ...batchTypes]} onChange={(batch_type) => setForm({ ...form, batch_type })} required disabled={disabled} /><Select label="Payment Method" value={form.payment_method ?? ""} options={["", ...paymentMethods]} onChange={(payment_method) => setForm({ ...form, payment_method })} required disabled={disabled} /></> : <Select label="Payment Method" value={form.payment_method ?? ""} options={["", ...paymentMethods]} onChange={(payment_method) => setForm({ ...form, payment_method })} disabled={disabled} />}<label>Scheduled Payment Date<input disabled={disabled} type="date" value={form.scheduled_payment_date ?? ""} onChange={(event) => setForm({ ...form, scheduled_payment_date: event.target.value })} /></label>{includeCreate ? <label>Currency<input disabled={disabled} value={form.currency ?? ""} onChange={(event) => setForm({ ...form, currency: event.target.value })} /></label> : null}<label>Notes<textarea disabled={disabled} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /></div>;
}

function AddContractorFields({ form, setForm, related }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData }) {
  return <div className="form-grid"><Select label="Payment-Ready Contractor Payable" value={form.contractor_payable_id ?? ""} options={["", ...related.contractorPayables.map((row) => String(row.id))]} labels={labelsFor(related.contractorPayables, "payable_number")} onChange={(contractor_payable_id) => setForm({ ...form, contractor_payable_id })} required /><label>Contractor Payable ID<input value={form.contractor_payable_id ?? ""} onChange={(event) => setForm({ ...form, contractor_payable_id: event.target.value })} required /></label><label>Contractor Payable Item ID<input value={form.contractor_payable_item_id ?? ""} onChange={(event) => setForm({ ...form, contractor_payable_item_id: event.target.value })} /></label><label>Payment Amount<input type="number" step="0.01" value={form.payment_amount ?? ""} onChange={(event) => setForm({ ...form, payment_amount: event.target.value })} /></label><label>Payee Name<input value={form.payee_name ?? ""} onChange={(event) => setForm({ ...form, payee_name: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">No real payment is created. Contractor payable must be payment ready unless backend accepts an override.</div></div>;
}

function AddPayrollFields({ form, setForm, related }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData }) {
  return <div className="form-grid"><Select label="Payroll-Ready Payroll Run" value={form.payroll_run_id ?? ""} options={["", ...related.payrollRuns.map((row) => String(row.id))]} labels={labelsFor(related.payrollRuns, "payroll_run_number")} onChange={(payroll_run_id) => setForm({ ...form, payroll_run_id })} required /><label>Payroll Run ID<input value={form.payroll_run_id ?? ""} onChange={(event) => setForm({ ...form, payroll_run_id: event.target.value })} required /></label><label>Payroll Item ID<input value={form.payroll_item_id ?? ""} onChange={(event) => setForm({ ...form, payroll_item_id: event.target.value })} required /></label><label>Payment Amount<input type="number" step="0.01" value={form.payment_amount ?? ""} onChange={(event) => setForm({ ...form, payment_amount: event.target.value })} /></label><label>Payee Name<input value={form.payee_name ?? ""} onChange={(event) => setForm({ ...form, payee_name: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">Whole payroll run intake requires payroll item selection unless backend safely expands worker items. No provider submission, ACH, or bank transaction is created.</div></div>;
}

function ItemEditFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <div className="form-grid"><Select label="Status" value={form.status ?? ""} options={["", ...itemStatuses]} onChange={(status) => setForm({ ...form, status })} /><Select label="Execution Status" value={form.execution_status ?? ""} options={["", ...executionStatuses]} onChange={(execution_status) => setForm({ ...form, execution_status })} /><Select label="Payee Type" value={form.payee_type ?? ""} options={["", ...payeeTypes]} onChange={(payee_type) => setForm({ ...form, payee_type })} /><Select label="Payment Method" value={form.payment_method ?? ""} options={["", ...paymentMethods]} onChange={(payment_method) => setForm({ ...form, payment_method })} /><label>Payment Amount<input type="number" step="0.01" value={form.payment_amount ?? ""} onChange={(event) => setForm({ ...form, payment_amount: event.target.value })} /></label><label>Payment Date<input type="date" value={form.payment_date ?? ""} onChange={(event) => setForm({ ...form, payment_date: event.target.value })} /></label><label>Payee Name<input value={form.payee_name ?? ""} onChange={(event) => setForm({ ...form, payee_name: event.target.value })} /></label><label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">Payment item edits update instruction context only. No source changes or money movement are performed.</div></div>;
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

function SourceSummary({ rows }: { rows: SyncRecord[] }) {
  return <ObjectTable rows={rows} columns={["source_type", "status", "execution_status", "payment_amount", "currency", "payee_name", "failure_reason"]} />;
}

function PayeeSummary({ items }: { items: SyncRecord[] }) {
  const rows = Object.values(items.reduce<Record<string, SyncRecord>>((acc, item) => {
    const key = `${item.payee_type ?? "unknown"}:${item.payee_name ?? item.worker_id ?? item.capacity_provider_id ?? item.crew_id ?? "unknown"}`;
    const existing = acc[key] ?? { payee_type: item.payee_type, payee_name: item.payee_name ?? item.worker_name ?? item.capacity_provider_name ?? item.crew_name, payment_amount: 0, item_count: 0 };
    existing.payment_amount = numberValue(existing.payment_amount, 0) + numberValue(item.payment_amount, 0);
    existing.item_count = numberValue(existing.item_count, 0) + 1;
    acc[key] = existing;
    return acc;
  }, {}));
  return <ObjectTable rows={rows} columns={["payee_type", "payee_name", "payment_amount", "item_count"]} />;
}

function FuturePlaceholders() {
  return <section className="workspace-panel"><h2>Future Workflow Placeholders</h2><div className="summary-grid"><Metric label="Future ACH" value="ACH processor integration is not available in this sprint." /><Metric label="Future Check" value="Check printing is not available in this sprint." /><Metric label="Future Payroll Provider" value="Payroll provider submission is not available in this sprint." /><Metric label="Future Bank Reconciliation" value="Bank reconciliation is not available in this sprint." /><Metric label="Future Accounting / Tax" value="Accounting export, GL posting, tax filing, W2/1099, benefit, and garnishment workflows are not available." /></div></section>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  const [token, setToken] = useState(session.token);
  const [permissionText, setPermissionText] = useState(session.permissions.join(", "));
  return <section className="workspace-panel"><div className="section-toolbar"><h2>API Session</h2><span>{session.permissions.length} permissions loaded</span></div><div className="session-grid"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" /><input value={permissionText} onChange={(event) => setPermissionText(event.target.value)} placeholder="Permissions, comma separated" /><button type="button" onClick={() => { saveToken(token); savePermissions(permissionText.split(",").map((item) => item.trim()).filter(Boolean)); window.location.reload(); }}>Save Session</button></div></section>;
}

function useSession() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>(paymentDefaultPermissions);
  useEffect(() => {
    const nextToken = readToken();
    setToken(nextToken);
    const stored = readPermissions();
    setPermissions(stored.length ? stored : paymentDefaultPermissions);
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

const paymentDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "payment_batch.read",
  "payment_batch.create",
  "payment_batch.update",
  "payment_batch.add_item",
  "payment_batch.remove_item",
  "payment_batch.recalculate_totals",
  "payment_batch.submit_review",
  "payment_batch.start_review",
  "payment_batch.approve",
  "payment_batch.reject",
  "payment_batch.schedule",
  "payment_batch.submit_execution",
  "payment_batch.mark_executed",
  "payment_batch.mark_failed",
  "payment_batch.cancel",
  "payment_batch.void",
  "payment_batch.archive",
  "payment_batch.timeline.read",
  "payment_batch.audit.read",
  "payment_item.read",
  "payment_item.create",
  "payment_item.update",
  "payment_item.void",
  "payment_item.archive",
  "contractor_payable.read",
  "payroll_run.read",
  "payroll_item.read",
];

async function loadRelated(token: string): Promise<RelatedData> {
  const [contractorPayables, payrollRuns, providers, crews, workers] = await Promise.all([
    optionalList("/contractor-payables?status=payment_ready&payment_readiness_status=ready_for_payment&archived=false", token),
    optionalList("/payroll-runs?status=payroll_ready&payroll_readiness_status=ready_for_payroll&archived=false", token),
    optionalList("/capacity-providers", token),
    optionalList("/crews", token),
    optionalList("/workers", token),
  ]);
  return { contractorPayables, payrollRuns, providers, crews, workers };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function paymentQuery(filters: Record<string, string>) {
  const query = new URLSearchParams();
  query.set("archived", filters.archived === "true" ? "true" : "false");
  for (const key of ["batch_type", "payment_method", "status", "approval_status", "execution_status", "scheduled_payment_date_from", "scheduled_payment_date_to", "submitted_from", "submitted_to", "executed_from", "executed_to", "q"]) if (filters[key]) query.set(key, filters[key]);
  if (filters.sort) query.set("sort", filters.sort);
  return query;
}

function createPayload(form: Record<string, string>) {
  return prune({ batch_type: form.batch_type, payment_method: form.payment_method, scheduled_payment_date: form.scheduled_payment_date, currency: form.currency, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function patchPayload(form: Record<string, string>) {
  return prune({ scheduled_payment_date: form.scheduled_payment_date, payment_method: form.payment_method, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function addContractorPayload(form: Record<string, string>) {
  return prune({ contractor_payable_id: form.contractor_payable_id, contractor_payable_item_id: form.contractor_payable_item_id, payment_amount: numericOrUndefined(form.payment_amount), payee_name: form.payee_name, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function addPayrollPayload(form: Record<string, string>) {
  return prune({ payroll_run_id: form.payroll_run_id, payroll_item_id: form.payroll_item_id, payment_amount: numericOrUndefined(form.payment_amount), payee_name: form.payee_name, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function itemPatchPayload(form: Record<string, string>) {
  return prune({ payment_amount: numericOrUndefined(form.payment_amount), payment_date: form.payment_date, payee_name: form.payee_name, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function notePayload(form: Record<string, string>, key: string) {
  return prune({ [key]: form[key], override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function rejectionPayload(form: Record<string, string>) {
  return prune({ rejection_reason: form.rejection_reason, rejection_note: form.rejection_note });
}

function schedulePayload(form: Record<string, string>) {
  return prune({ scheduled_payment_date: form.scheduled_payment_date, schedule_note: form.schedule_note });
}

function submitExecutionPayload(form: Record<string, string>) {
  return prune({ submit_note: form.submit_note, external_reference: form.external_reference, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function markExecutedPayload(form: Record<string, string>) {
  return prune({ execution_reference: form.execution_reference, execution_note: form.execution_note, executed_at: form.executed_at });
}

function failurePayload(form: Record<string, string>) {
  return prune({ failure_reason: form.failure_reason, failure_note: form.failure_note });
}

function cancelPayload(form: Record<string, string>) {
  return prune({ cancel_reason: form.cancel_reason, cancel_note: form.cancel_note });
}

function voidPayload(form: Record<string, string>) {
  return prune({ void_reason: form.void_reason, void_note: form.void_note });
}

function archivePayload(form: Record<string, string>) {
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
}

function prefillItemForm(item: SyncRecord | null): Record<string, string> {
  if (!item) return {};
  return { status: String(item.status ?? ""), execution_status: String(item.execution_status ?? ""), payee_type: String(item.payee_type ?? ""), payment_method: String(item.payment_method ?? ""), payment_amount: String(item.payment_amount ?? ""), payment_date: dateInput(item.payment_date), payee_name: String(item.payee_name ?? ""), notes: String(item.notes ?? ""), override_reasons: jsonText(item.override_reasons) };
}

function buildSummary(rows: SyncRecord[]) {
  const summary = { total: rows.length, status: {} as Record<string, number>, type: {} as Record<string, number>, method: {} as Record<string, number>, totalAmount: 0 };
  for (const row of rows) {
    increment(summary.status, String(row.status ?? ""));
    increment(summary.type, String(row.batch_type ?? ""));
    increment(summary.method, String(row.payment_method ?? ""));
    summary.totalAmount += numberValue(row.total_payment_amount, 0);
  }
  return summary;
}

function sortBatches(rows: SyncRecord[], sort?: string) {
  const statusRank: Record<string, number> = { failed: 9, scheduled: 8, approved: 7, ready_for_review: 6, under_review: 5, submitted: 4, draft: 3, assembling: 2 };
  return [...rows].sort((a, b) => {
    if (sort === "scheduled_date_asc") return String(a.scheduled_payment_date ?? "9999").localeCompare(String(b.scheduled_payment_date ?? "9999"));
    if (sort === "executed_date_desc") return String(b.executed_at ?? "").localeCompare(String(a.executed_at ?? ""));
    if (sort === "amount_desc") return numberValue(b.total_payment_amount, 0) - numberValue(a.total_payment_amount, 0);
    if (sort === "status") return String(a.status ?? "").localeCompare(String(b.status ?? ""));
    if (sort === "payment_batch_number") return String(a.payment_batch_number ?? "").localeCompare(String(b.payment_batch_number ?? ""));
    return (statusRank[String(b.status)] ?? 0) - (statusRank[String(a.status)] ?? 0) || String(a.scheduled_payment_date ?? "9999").localeCompare(String(b.scheduled_payment_date ?? "9999")) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });
}

function countPaymentQueue(rows: SyncRecord[], items: SyncRecord[], queue: PaymentQueueKey) {
  if (queue === "itemsAttention") return items.filter(itemNeedsAttention).length;
  return rows.filter((row) => paymentQueueMatches(row, queue)).length;
}

function paymentQueueMatches(row: SyncRecord, queue: PaymentQueueKey) {
  const status = String(row.status ?? "");
  const execution = String(row.execution_status ?? "");
  if (queue === "draft") return ["draft", "assembling"].includes(status);
  if (queue === "submitted") return ["ready_for_review", "under_review"].includes(status) || String(row.approval_status ?? "") === "pending";
  if (queue === "approved") return status === "approved";
  if (queue === "scheduled") return status === "scheduled";
  if (queue === "submittedExecution") return status === "submitted" || execution === "submitted_later";
  if (queue === "executed") return status === "executed_later" || execution === "executed_later" || status === "partially_executed_later";
  if (queue === "voided") return status === "voided";
  if (queue === "itemsAttention") return false;
  return status === "archived";
}

function itemNeedsAttention(item: SyncRecord) {
  return ["failed", "cancelled", "voided", "archived"].includes(String(item.status)) || ["failed", "cancelled"].includes(String(item.execution_status));
}

function nextPaymentAction(row: SyncRecord) {
  const status = String(row.status ?? "");
  const execution = String(row.execution_status ?? "");
  if (status === "ready_for_review") return "Submit or start review";
  if (status === "under_review") return "Approve or reject";
  if (status === "approved") return "Schedule";
  if (status === "scheduled") return "Submit Execution";
  if (status === "submitted" || execution === "submitted_later") return "Mark Executed";
  if (status === "executed_later" || execution === "executed_later") return "Executed status recorded";
  if (status === "voided") return "Retained for audit";
  return formatAction(row.recommended_next_action);
}

function paymentItemNextAction(item: SyncRecord) {
  const status = String(item.status ?? "");
  if (status === "failed") return "Review failure";
  if (status === "cancelled") return "Review cancellation";
  if (status === "voided") return "Retained for audit";
  if (status === "archived") return "Archived";
  if (item.execution_status === "failed") return "Review execution failure";
  return "Open item detail";
}

function paymentChecklist(batch: SyncRecord, items: SyncRecord[]): Array<[string, unknown]> {
  return [["Batch created", Boolean(batch.id)], ["Payment items present", items.length > 0], ["Sources payment-ready", true], ["Totals calculated", batch.total_payment_amount !== undefined], ["Reviewed", ["ready_for_review", "under_review", "approved", "scheduled", "submitted", "executed_later"].includes(String(batch.status))], ["Approved", batch.approval_status === "approved"], ["Scheduled if needed", Boolean(batch.scheduled_payment_date) || batch.status !== "scheduled"], ["Submitted as status-only", ["submitted", "executed_later"].includes(String(batch.status))], ["Executed status recorded", batch.execution_status === "executed_later"], ["No real money movement", true], ["No bank transaction created", true], ["No provider submission created", true]];
}

function batchInactive(row: SyncRecord) {
  return ["voided", "archived", "submitted", "executed_later"].includes(String(row.status));
}

function itemInactive(row: SyncRecord) {
  return ["voided", "archived", "submitted_later", "executed_later"].includes(String(row.status));
}

function modalTitle(type: string) {
  const titles: Record<string, string> = { add_contractor: "Add Contractor Payable Item", add_payroll: "Add Payroll Item", edit_item: "Edit Payment Item", recalculate: "Recalculate Totals", submit_review: "Submit Review", start_review: "Start Review", approve: "Approve Payment Batch", reject: "Reject Payment Batch", schedule: "Schedule Payment Batch", submit_execution: "Submit Execution", mark_executed: "Mark Executed", mark_failed: "Mark Failed", cancel: "Cancel Payment Batch", void: "Void Payment Batch", archive: "Archive Payment Batch", void_item: "Void Payment Item", archive_item: "Archive Payment Item" };
  return titles[type] ?? "Payment Action";
}

function actionNotice(type: string) {
  if (type === "submit_execution") return "Execution submitted as status-only/manual reference. No money moved.";
  if (type === "mark_executed") return "Executed-later status recorded. No bank clearing or reconciliation was created.";
  if (type === "approve") return "Payment batch approved. No ACH, card, check, wire, provider, bank, tax, or accounting record was created.";
  if (type.startsWith("add_")) return "Payment item added. No real payment was created.";
  return "Payment action completed without ACH, card, check, wire, provider, bank, tax, accounting, reconciliation, or real money movement activity.";
}

function plainError(message: string) {
  if (!message) return "Payment execution action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("payment batch not found")) return "Payment batch not found or no access.";
  if (message.includes("payment item not found")) return "Payment item not found or no access.";
  if (message.includes("contractor payable")) return "Contractor payable must be payment ready.";
  if (message.includes("payroll")) return "Payroll run and payroll item must be payroll ready.";
  if (message.includes("whole payroll") || message.includes("payroll_item_id")) return "Whole payroll run requires payroll item selection unless backend safely expands worker items.";
  if (message.includes("duplicate")) return "Duplicate source is not allowed without override.";
  if (message.includes("approval")) return "Approval note is required.";
  if (message.includes("rejection")) return "Rejection reason is required.";
  if (message.includes("scheduled")) return "Scheduled payment date is required.";
  if (message.includes("submit")) return "Submit note is required.";
  if (message.includes("execution reference")) return "Execution reference is required.";
  if (message.includes("execution note")) return "Execution note is required.";
  if (message.includes("failure")) return "Failure reason is required.";
  if (message.includes("cancel")) return "Cancel reason is required.";
  if (message.includes("void")) return "Void reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

function methodMessage(value: unknown) {
  const method = String(value ?? "");
  if (method === "ach") return "ACH integration is future scope.";
  if (method === "check") return "Check printing is future scope.";
  if (method === "card_payout") return "Card payout integration is future scope.";
  if (method === "wire") return "Wire execution is future scope.";
  if (method === "payroll_provider") return "Payroll provider submission is future scope.";
  if (method === "manual") return "Manual reference may be stored, but no bank transaction is created.";
  return "Payment method is instruction context only in this sprint.";
}

function Select({ label, value, options, labels = {}, onChange, disabled, required }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void; disabled?: boolean; required?: boolean }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? formatAction(option)}</option>)}</select></label>;
}

function SummaryCard({ label, value, helper, active, onClick }: { label: string; value: unknown; helper?: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={`summary-card${active ? " active" : ""}`} aria-pressed={active ? "true" : "false"} onClick={onClick}><span>{label}</span><strong>{formatCell(value)}</strong>{helper ? <small>{helper}</small> : null}</button>;
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

function batchLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/payments/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function payableLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/contractor-payables/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function payrollLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/payroll/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function labelsFor(rows: SyncRecord[], preferred = "name") {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.payable_number ?? row.payroll_run_number, String(row.id))]));
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

function sumBySource(items: SyncRecord[], source: string) {
  return items.filter((item) => item.source_type === source).reduce((sum, item) => sum + numberValue(item.payment_amount, 0), 0);
}

function sumByStatus(items: SyncRecord[], status: string) {
  return items.filter((item) => item.status === status || item.execution_status === status).reduce((sum, item) => sum + numberValue(item.payment_amount, 0), 0);
}
