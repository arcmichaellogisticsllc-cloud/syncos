"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";
import { DangerZone, DetailBoundaryNotice, DetailNextActionCard, FormBoundaryNotice, FormPurposeHeader, FormSection, ReadOnlyBanner, RequiredFieldNote } from "../operator-page-templates";

const invoiceTypes = ["standard", "progress", "final", "retainage_release", "credit_memo", "rebill", "adjustment", "pro_forma"];
const approvalStatuses = ["not_submitted", "pending", "approved", "rejected", "withdrawn"];
const deliveryStatuses = ["not_sent", "queued", "sent", "failed", "acknowledged", "rejected"];
const cashApplicationStatuses = ["not_ready", "ready_for_cash_application", "partially_applied_later", "fully_applied_later", "overpaid_later", "written_off_later"];
const paymentStatuses = ["unpaid", "partially_paid", "paid", "overpaid", "written_off"];
const collectionStatuses = ["not_due", "due", "overdue", "in_collection", "disputed", "resolved", "written_off"];
const paymentTerms = ["due_on_receipt", "net_7", "net_15", "net_30", "net_45", "net_60", "custom"];
const packageStatuses = ["not_started", "incomplete", "ready", "attached", "submitted", "accepted", "rejected"];
const acceptanceStatuses = ["not_required", "pending", "accepted", "rejected", "correction_required", "disputed"];
const tabs = ["overview", "items", "customer", "settlement", "project", "financial_summary", "receivable_state", "approval", "delivery", "package_documentation", "disputes", "timeline", "audit", "future_cash_application", "future_collections"];

type InvoiceDetailShape = {
  invoice?: SyncRecord;
  invoice_items?: SyncRecord[];
  customer_context?: SyncRecord | null;
  project_context?: SyncRecord | null;
  settlement_context?: SyncRecord | null;
  financial_summary?: SyncRecord;
  receivable_summary?: SyncRecord;
  package_summary?: SyncRecord;
  approval_summary?: SyncRecord;
  delivery_summary?: SyncRecord;
  cash_application_boundary_summary?: SyncRecord;
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
  customers: SyncRecord[];
  projects: SyncRecord[];
  settlements: SyncRecord[];
  settlementItems: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function InvoiceQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [activeQueue, setActiveQueue] = useState("draft");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("archived", filters.archived === "true" ? "true" : "false");
      for (const key of ["invoice_type", "status", "approval_status", "delivery_status", "cash_application_status", "payment_status", "collection_status", "customer_organization_id", "project_id", "settlement_id", "invoice_date_from", "invoice_date_to", "due_date_from", "due_date_to", "payment_terms", "q"]) if (filters[key]) query.set(key, filters[key]);
      if (filters.sort) query.set("sort", filters.sort);
      setRows(await syncosFetch<SyncRecord[]>(`/invoices?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortInvoices(rows.filter((row) => matchesFilters(row, filters)).filter((row) => matchesInvoiceQueue(row, activeQueue)), filters.sort), [rows, filters, activeQueue]);
  const queueCards = invoiceQueues.map((queue) => ({ ...queue, value: rows.filter((row) => matchesInvoiceQueue(row, queue.id)).length }));
  const activeQueueLabel = queueCards.find((queue) => queue.id === activeQueue)?.label ?? "Draft";

  function selectQueue(queueId: string) {
    setActiveQueue(queueId);
    setFilters({ ...filters, archived: queueId === "archived" ? "true" : "false" });
  }

  return (
    <InvoiceShell title="Invoice Workbench" purpose="Track invoice review, sent status, disputes, and aging before cash application and collections workflows.">
      <SessionPanel session={session} />
      <div className="warning-box">Invoice workflow tracks internal invoice status. Mark Sent records that an invoice was sent externally or by manual reference. SyncOS does not email the customer, post to QuickBooks, create a cash receipt, apply cash, or collect payment.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Login required. Sign in to review invoice state, disputes, and aging.</div> : null}
      {loading ? <div className="empty-state">Loading invoices...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel operator-queue-hero">
            <div className="section-toolbar">
              <div>
                <h2>Which invoices need review, which are ready to send, which are sent, and which are disputed or aging?</h2>
                <p className="muted">Invoice work is prioritized by review state, sent state, dispute state, aging, balance, and recent updates.</p>
              </div>
              <div className="form-actions">
                <Link className="primary-button" href={firstHref(visible, "/invoices")} aria-disabled={!visible.length}>Review Next Invoice</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => row.status === "approved" || row.approval_status === "approved"), "/invoices")} aria-disabled={!rows.some((row) => row.status === "approved" || row.approval_status === "approved")}>Open Approved Invoices</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => row.status === "disputed" || row.collection_status === "disputed"), "/invoices")} aria-disabled={!rows.some((row) => row.status === "disputed" || row.collection_status === "disputed")}>Open Disputes</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => String(row.collection_status) === "overdue" || numberValue(row.aging_days, 0) > 0), "/invoices")} aria-disabled={!rows.some((row) => String(row.collection_status) === "overdue" || numberValue(row.aging_days, 0) > 0)}>Open Aging Invoices</Link>
                <Link className="link-button" href="/invoices/new" aria-disabled={!hasPermission(session.permissions, "invoice.create")}>Create Invoice</Link>
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
                <p className="muted">{emptyInvoiceQueue(activeQueue)}</p>
              </div>
              <button type="button" onClick={() => { setActiveQueue("draft"); setFilters({ archived: "false", sort: "updated_desc" }); }}>Reset</button>
            </div>
            <div className="queue-tabs" role="tablist" aria-label="Invoice queues">
              {invoiceQueues.map((queue) => <button key={queue.id} type="button" role="tab" aria-selected={activeQueue === queue.id} className={activeQueue === queue.id ? "active" : ""} onClick={() => selectQueue(queue.id)}>{queue.label}</button>)}
            </div>
            <details className="filter-drawer">
              <summary>Advanced filters</summary>
              <div className="filter-grid">
                <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search invoice, customer, project, settlement" />
                <Select label="Invoice Type" value={filters.invoice_type ?? ""} options={["", ...invoiceTypes]} onChange={(invoice_type) => setFilters({ ...filters, invoice_type })} />
                <Select label="Approval Status" value={filters.approval_status ?? ""} options={["", ...approvalStatuses]} onChange={(approval_status) => setFilters({ ...filters, approval_status })} />
                <Select label="Delivery Status" value={filters.delivery_status ?? ""} options={["", ...deliveryStatuses]} onChange={(delivery_status) => setFilters({ ...filters, delivery_status })} />
                <Select label="Cash Application Status" value={filters.cash_application_status ?? ""} options={["", ...cashApplicationStatuses]} onChange={(cash_application_status) => setFilters({ ...filters, cash_application_status })} />
                <Select label="Payment Status" value={filters.payment_status ?? ""} options={["", ...paymentStatuses]} onChange={(payment_status) => setFilters({ ...filters, payment_status })} />
                <Select label="Collection Status" value={filters.collection_status ?? ""} options={["", ...collectionStatuses]} onChange={(collection_status) => setFilters({ ...filters, collection_status })} />
                <input value={filters.customer_organization_id ?? ""} onChange={(event) => setFilters({ ...filters, customer_organization_id: event.target.value })} placeholder="Customer" />
                <input value={filters.settlement_id ?? ""} onChange={(event) => setFilters({ ...filters, settlement_id: event.target.value })} placeholder="Settlement" />
                <Select label="Has Balance" value={filters.hasBalance ?? ""} options={["", "true", "false"]} onChange={(hasBalance) => setFilters({ ...filters, hasBalance })} />
                <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "invoice_date_desc", "due_date_asc", "total_amount_desc", "balance_amount_desc", "aging_desc", "status", "invoice_number"]} labels={{ updated_desc: "Recently updated", invoice_date_desc: "Invoice date newest", due_date_asc: "Due date soonest", total_amount_desc: "Total amount highest", balance_amount_desc: "Balance amount highest", aging_desc: "Aging highest", status: "Status", invoice_number: "Invoice number" }} onChange={(sort) => setFilters({ ...filters, sort })} />
              </div>
            </details>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Invoices</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No invoices yet. Create an invoice shell, then add invoice-ready settlement items.</div> : visible.length ? <InvoiceTable rows={visible} /> : <div className="empty-state">{emptyInvoiceQueue(activeQueue)}</div>}
          </section>
        </>
      ) : null}
    </InvoiceShell>
  );
}

export function InvoiceCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ invoice_type: "standard", payment_terms: "net_30", currency: "USD" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/invoices", { method: "POST", body: buildInvoicePayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const invoice = after?.invoice as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? invoice?.id ?? after?.id ?? "");
      router.push(id ? `/invoices/${id}` : "/invoices");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <InvoiceShell title="Create Invoice" purpose="Create an invoice shell for a customer without creating cash, payment, payroll, tax, bank, ACH, card payout, or accounting export records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <FormPurposeHeader title="Create Invoice" purpose="Create an internal invoice record for review." afterSave="the invoice opens in detail view so finance can add items, submit review, approve, and mark sent when external/manual sending occurs." />
        <RequiredFieldNote>Customer and invoice context should be completed before invoice review. Required backend fields are enforced on submit.</RequiredFieldNote>
        <FormBoundaryNotice>Create Invoice does not email the customer, collect payment, create cash, apply payment, post accounting entries, or move money.</FormBoundaryNotice>
        <div className="warning-box">Backend validation enforces tenant scope, customer/project/settlement validation, tenant-unique invoice numbers, and event/audit/system_action behavior.</div>
        <FormSection title="Invoice setup" description="Use customer, settlement, project, date, and terms to establish the internal receivable workflow record.">
          <InvoiceFormFields form={form} setForm={setForm} related={related} includeCreate />
        </FormSection>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "invoice.create")}>Create Invoice</button>
          <Link className="link-button" href="/invoices">Cancel</Link>
        </div>
      </form>
    </InvoiceShell>
  );
}

export function InvoiceEdit({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const session = useSession();
  const [detail, setDetail] = useState<InvoiceDetailShape | null>(null);
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const [next, nextRelated] = await Promise.all([
          syncosFetch<InvoiceDetailShape>(`/invoices/${invoiceId}/detail`, { token: session.token }),
          loadRelated(session.token),
        ]);
        const record = invoiceRecord(next);
        setDetail(next);
        setRelated(nextRelated);
        setForm({
          invoice_date: dateInput(record.invoice_date),
          due_date: dateInput(record.due_date),
          payment_terms: String(record.payment_terms ?? ""),
          billing_period_start: dateInput(record.billing_period_start),
          billing_period_end: dateInput(record.billing_period_end),
          invoice_package_status: String(record.invoice_package_status ?? ""),
          documentation_status: String(record.documentation_status ?? ""),
          customer_acceptance_status: String(record.customer_acceptance_status ?? ""),
          prime_acceptance_status: String(record.prime_acceptance_status ?? ""),
          override_reasons: jsonText(record.override_reasons),
          dispute_note: String(record.dispute_note ?? ""),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, invoiceId]);

  const record = detail ? invoiceRecord(detail) : null;
  const readOnly = record ? viewOnly(record) || ["sent", "paid_later"].includes(String(record.status)) || String(record.cash_application_status) === "fully_applied_later" : true;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/invoices/${invoiceId}`, { method: "PATCH", body: buildInvoicePatchPayload(form), token: session.token });
      router.push(`/invoices/${invoiceId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <InvoiceShell title="Edit Invoice" purpose="Edit supported invoice fields without bypassing approval, delivery, or cash application readiness routes.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Invoice not found or you do not have access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Status changes use lifecycle routes. Voided, archived, sent, paid-later, and fully-applied-later invoices are read-only unless backend policy explicitly allows updates.</div>
          <InvoiceFormFields form={form} setForm={setForm} related={related} disabled={readOnly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readOnly || !hasPermission(session.permissions, "invoice.update")}>Save Invoice</button>
            <Link className="link-button" href={`/invoices/${invoiceId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </InvoiceShell>
  );
}

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<InvoiceDetailShape | null>(null);
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
      const next = await syncosFetch<InvoiceDetailShape>(`/invoices/${invoiceId}/detail`, { token: session.token });
      const record = invoiceRecord(next);
      const [timeline, audit, nextRelated] = await Promise.all([
        optionalList(`/invoices/${invoiceId}/timeline`, session.token),
        optionalList(`/invoices/${invoiceId}/audit-summary`, session.token),
        loadRelated(session.token, String(record.settlement_id ?? "")),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
      setRelated(nextRelated);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, invoiceId]);

  const record = detail ? invoiceRecord(detail) : null;
  const items = detail?.invoice_items ?? [];
  const warnings = detail?.warnings ?? arrayValue(record?.warnings);
  const blockers = detail?.blockers ?? arrayValue(record?.blockers);

  function openItemModal(type: string, item: SyncRecord) {
    setSelectedItem(item);
    setModal(type);
  }

  return (
    <InvoiceShell title="Invoice Detail" purpose="Show customer demand-for-payment truth, invoice-owned receivable state, timeline, and audit without creating cash/payment records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Invoice Detail.</div> : null}
      {!record && session.token && !error ? <div className="empty-state">Invoice not found or you do not have access.</div> : null}
      {record && detail ? (
        <>
          {!hasPermission(session.permissions, "invoice.update") ? <ReadOnlyBanner /> : null}
          <DetailNextActionCard
            variant="finance"
            status={formatAction(record.status)}
            nextActionLabel={nextInvoiceAction(record)}
            helperText="Review invoice status, approval, sent state, dispute state, aging, and cash-readiness before taking the next finance action."
            disabled={!hasPermission(session.permissions, "invoice.update")}
            disabledReason="Read-only users cannot perform lifecycle actions."
            boundaryText="Invoice status tracks internal workflow. Mark Sent records external/manual send status only. SyncOS does not email the customer, collect payment, apply cash, or post accounting entries."
          />
          <DetailBoundaryNotice>Invoice status tracks internal workflow. Mark Sent records external/manual send status only. SyncOS does not email the customer, collect payment, apply cash, move money, or post accounting entries.</DetailBoundaryNotice>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(record.invoice_number, "Invoice")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(record.invoice_type)}</span>
                  <span className="badge">{formatAction(record.status)}</span>
                  <span className="badge">{formatAction(record.approval_status)}</span>
                  <span className="badge">{formatAction(record.delivery_status)}</span>
                  <span className="badge">{formatAction(record.cash_application_status)}</span>
                  <span className="badge">{formatAction(record.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/invoices/${invoiceId}/edit`} aria-disabled={!hasPermission(session.permissions, "invoice.update")}>Edit Invoice</Link>
                <ActionButton permission="invoice.add_item" session={session} disabled={viewOnly(record)} onClick={() => setModal("add_item")}>Add Invoice Item</ActionButton>
                <ActionButton permission="invoice.recalculate_totals" session={session} disabled={viewOnly(record)} onClick={() => setModal("recalculate")}>Recalculate Totals</ActionButton>
                <ActionButton permission="invoice.submit_review" session={session} disabled={viewOnly(record) || !items.length} onClick={() => setModal("submit_review")}>Submit Review</ActionButton>
                <ActionButton permission="invoice.approve" session={session} disabled={viewOnly(record) || !items.length || blockers.length > 0} onClick={() => setModal("approve")}>Approve</ActionButton>
                <ActionButton permission="invoice.reject" session={session} disabled={viewOnly(record)} onClick={() => setModal("reject")}>Reject</ActionButton>
                <ActionButton permission="invoice.mark_sent" session={session} disabled={viewOnly(record) || String(record.approval_status) !== "approved"} onClick={() => setModal("mark_sent")}>Mark Sent</ActionButton>
                <ActionButton permission="invoice.mark_ready_for_cash_application" session={session} disabled={viewOnly(record) || !["approved", "sent"].includes(String(record.status)) || String(record.cash_application_status) === "ready_for_cash_application"} onClick={() => setModal("cash_ready")}>Mark Ready For Cash Application</ActionButton>
                <ActionButton permission="invoice.dispute" session={session} disabled={viewOnly(record) || String(record.status) === "disputed"} onClick={() => setModal("dispute")}>Dispute</ActionButton>
                <ActionButton permission="invoice.resolve_dispute" session={session} disabled={String(record.status) !== "disputed"} onClick={() => setModal("resolve")}>Resolve Dispute</ActionButton>
                <ActionButton permission="invoice.void" session={session} disabled={viewOnly(record) || ["paid_later", "fully_applied_later"].includes(String(record.cash_application_status))} onClick={() => setModal("void")}>Void</ActionButton>
                <ActionButton permission="invoice.archive" session={session} disabled={String(record.status) === "archived"} onClick={() => setModal("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Total Amount" value={money(record.total_amount)} />
              <Metric label="Original Amount" value={money(record.original_amount)} />
              <Metric label="Paid Amount" value={money(record.paid_amount)} />
              <Metric label="Balance Amount" value={money(record.balance_amount)} />
              <Metric label="Aging Days" value={formatCell(record.aging_days)} />
              <Metric label="Payment Status" value={formatAction(record.payment_status)} />
              <Metric label="Collection Status" value={formatAction(record.collection_status)} />
              <Metric label="Cash Application Status" value={formatAction(record.cash_application_status)} />
              <Metric label="Approval Status" value={formatAction(record.approval_status)} />
              <Metric label="Delivery Status" value={formatAction(record.delivery_status)} />
              <Metric label="Item Count" value={formatCell(record.item_count ?? items.length)} />
            </div>
            <div className="warning-box">Invoice owns receivable state. Ready for Cash Application does not create cash. Payments and cash application are future workflows.</div>
            <DangerZone description="Reject, dispute, void, and archive actions change lifecycle state and should stay separated from routine invoice review work. Existing modals continue to control the actual submit behavior.">
              <span>Danger actions available in the action bar: Reject, Dispute, Void, Archive.</span>
            </DangerZone>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Customer</dt><dd>{organizationLink(record.customer_organization_id, record.customer_organization_name ?? detail.customer_context?.name)}</dd>
                <dt>Project</dt><dd>{projectLink(record.project_id, record.project_name ?? detail.project_context?.name)}</dd>
                <dt>Settlement</dt><dd>{settlementLink(record.settlement_id, record.settlement_number ?? detail.settlement_context?.settlement_number)}</dd>
                <dt>Invoice type</dt><dd>{formatAction(record.invoice_type)}</dd>
                <dt>Status</dt><dd>{formatAction(record.status)}</dd>
                <dt>Approval</dt><dd>{formatAction(record.approval_status)}</dd>
                <dt>Delivery</dt><dd>{formatAction(record.delivery_status)}</dd>
                <dt>Cash application readiness</dt><dd>{formatAction(record.cash_application_status)}</dd>
                <dt>Payment status</dt><dd>{formatAction(record.payment_status)}</dd>
                <dt>Collection status</dt><dd>{formatAction(record.collection_status)}</dd>
                <dt>Due date</dt><dd>{dateValue(record.due_date)}</dd>
                <dt>Balance state</dt><dd>{money(record.balance_amount)}</dd>
                <dt>Package state</dt><dd>{formatAction(record.invoice_package_status)}</dd>
                <dt>Dispute state</dt><dd>{textValue(record.dispute_reason, "No active dispute")}</dd>
              </dl>
              <Checklist items={invoiceChecklist(record, items)} />
              <WarningList title="Key Blockers" rows={blockers.slice(0, 4)} empty="No blockers returned." />
              <WarningList title="Key Warnings" rows={warnings.slice(0, 4)} empty="No warnings returned." />
              <div className="warning-box">Cash receipts, payments, payroll, tax, bank, ACH, card payout, and accounting export workflows are future layers.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <InvoiceTab tab={tab} detail={detail} invoice={record} items={items} session={session} onItemAction={openItemModal} />
            </section>
          </div>
          {modal ? <InvoiceLifecycleModal type={modal} invoiceId={invoiceId} invoice={record} related={related} blockers={blockers} session={session} item={selectedItem} onClose={() => { setModal(""); setSelectedItem(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </InvoiceShell>
  );
}

function InvoiceShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/invoices", "Invoice Queue", "active"],
    ["/invoices/new", "Create Invoice", "active"],
    ["#detail", "Invoice Detail", "placeholder"],
    ["#items", "Invoice Items", "placeholder"],
    ["#customer", "Customer Context", "placeholder"],
    ["#settlement", "Settlement Context", "placeholder"],
    ["#project", "Project Context", "placeholder"],
    ["#financial", "Financial Summary", "placeholder"],
    ["#receivable", "Receivable State", "placeholder"],
    ["#approval", "Approval", "placeholder"],
    ["#delivery", "Delivery", "placeholder"],
    ["#package", "Package / Documentation", "placeholder"],
    ["#disputes", "Disputes", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-cash", "Future Cash Application", "placeholder"],
    ["#future-collections", "Future Collections", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Invoices</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function InvoiceTable({ rows }: { rows: SyncRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead><tr>{["Invoice", "Customer", "Settlement / Source", "Invoice Amount", "Sent Status", "Due Date / Age", "Dispute Status", "Cash Status", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>
                <Link className="table-link" href={`/invoices/${row.id}`}>{textValue(row.invoice_number, "Invoice")}</Link>
                <div className="cell-helper">{formatAction(row.status)} / {formatAction(row.approval_status)}</div>
              </td>
              <td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td>
              <td>
                {settlementLink(row.settlement_id, row.settlement_number)}
                <div className="cell-helper">{projectLink(row.project_id, row.project_name)}</div>
              </td>
              <td>
                {money(row.total_amount)}
                <div className="cell-helper">Balance {money(row.balance_amount)}</div>
              </td>
              <td>{formatAction(row.delivery_status ?? row.status)}</td>
              <td>
                {dateValue(row.due_date)}
                <div className="cell-helper">{formatCell(row.aging_days)} days</div>
              </td>
              <td>{row.status === "disputed" || row.collection_status === "disputed" || row.dispute_reason ? formatAction(row.dispute_reason ?? "Disputed") : "No dispute"}</td>
              <td>{formatAction(row.cash_application_status)}</td>
              <td>{nextInvoiceAction(row)}</td>
              <td><Link className="link-button" href={`/invoices/${row.id}`}>Open Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTab({ tab, detail, invoice, items, session, onItemAction }: { tab: string; detail: InvoiceDetailShape; invoice: SyncRecord; items: SyncRecord[]; session: Session; onItemAction: (type: string, item: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Invoice number</dt><dd>{textValue(invoice.invoice_number)}</dd><dt>Invoice type</dt><dd>{formatAction(invoice.invoice_type)}</dd><dt>Status</dt><dd>{formatAction(invoice.status)}</dd><dt>Approval status</dt><dd>{formatAction(invoice.approval_status)}</dd><dt>Delivery status</dt><dd>{formatAction(invoice.delivery_status)}</dd><dt>Cash application status</dt><dd>{formatAction(invoice.cash_application_status)}</dd><dt>Payment status</dt><dd>{formatAction(invoice.payment_status)}</dd><dt>Collection status</dt><dd>{formatAction(invoice.collection_status)}</dd><dt>Invoice date</dt><dd>{dateValue(invoice.invoice_date)}</dd><dt>Due date</dt><dd>{dateValue(invoice.due_date)}</dd><dt>Payment terms</dt><dd>{formatAction(invoice.payment_terms)}</dd><dt>Billing period</dt><dd>{dateValue(invoice.billing_period_start)} to {dateValue(invoice.billing_period_end)}</dd><dt>Currency</dt><dd>{textValue(invoice.currency)}</dd><dt>Warnings</dt><dd><JsonBlock value={detail.warnings ?? invoice.warnings} /></dd><dt>Blockers</dt><dd><JsonBlock value={detail.blockers ?? invoice.blockers} /></dd><dt>Required override fields</dt><dd><JsonBlock value={detail.required_override_fields ?? invoice.required_override_fields} /></dd><dt>Recommended next action</dt><dd>{formatAction(invoice.recommended_next_action ?? detail.recommended_next_action)}</dd><dt>Override reasons</dt><dd><JsonBlock value={invoice.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(invoice.created_at)}</dd><dt>Updated</dt><dd>{dateValue(invoice.updated_at)}</dd></dl><div className="warning-box">This invoice is the customer demand for payment and owns receivable state. It does not create cash receipts, payments, payroll, tax, ACH, card payout, bank transaction, or accounting export records.</div></Panel>;
  if (tab === "items") return <Panel title="Invoice Items"><InvoiceItemsTable rows={items} session={session} onItemAction={onItemAction} /><div className="warning-box">Adding, voiding, or archiving invoice items does not create cash or payment records.</div></Panel>;
  if (tab === "customer") return <Panel title="Customer"><dl className="detail-list"><dt>Customer organization</dt><dd>{organizationLink(invoice.customer_organization_id, invoice.customer_organization_name ?? detail.customer_context?.name)}</dd><dt>Customer status</dt><dd>{formatAction(detail.customer_context?.status)}</dd><dt>Customer payment terms</dt><dd>{formatAction(detail.customer_context?.payment_terms ?? invoice.payment_terms)}</dd><dt>Customer acceptance</dt><dd>{formatAction(invoice.customer_acceptance_status)}</dd><dt>Prime acceptance</dt><dd>{formatAction(invoice.prime_acceptance_status)}</dd><dt>Billing contact</dt><dd>{textValue(detail.customer_context?.billing_contact_name ?? detail.customer_context?.billing_email)}</dd><dt>Billing notes</dt><dd>{textValue(detail.customer_context?.billing_notes)}</dd></dl></Panel>;
  if (tab === "settlement") return <Panel title="Settlement"><dl className="detail-list"><dt>Settlement number</dt><dd>{settlementLink(invoice.settlement_id, invoice.settlement_number ?? detail.settlement_context?.settlement_number)}</dd><dt>Settlement type</dt><dd>{formatAction(detail.settlement_context?.settlement_type)}</dd><dt>Settlement status</dt><dd>{formatAction(detail.settlement_context?.status)}</dd><dt>Invoice ready</dt><dd>{boolText(detail.settlement_context?.invoice_ready)}</dd><dt>Payable ready</dt><dd>{boolText(detail.settlement_context?.payable_ready)}</dd><dt>Gross billable amount</dt><dd>{money(detail.settlement_context?.gross_billable_amount)}</dd><dt>Net settlement amount</dt><dd>{money(detail.settlement_context?.net_settlement_amount)}</dd><dt>Margin amount</dt><dd>{money(detail.settlement_context?.estimated_margin_amount)}</dd><dt>Settlement item count</dt><dd>{formatCell(detail.settlement_context?.item_count)}</dd></dl></Panel>;
  if (tab === "project") return <Panel title="Project"><dl className="detail-list"><dt>Project</dt><dd>{projectLink(invoice.project_id, invoice.project_name ?? detail.project_context?.name)}</dd><dt>Project status</dt><dd>{formatAction(detail.project_context?.status)}</dd><dt>Customer</dt><dd>{organizationLink(invoice.customer_organization_id, invoice.customer_organization_name ?? detail.customer_context?.name)}</dd><dt>Territory</dt><dd>{textValue(detail.project_context?.territory)}</dd><dt>Work type</dt><dd>{textValue(detail.project_context?.work_type)}</dd><dt>Project manager</dt><dd>{textValue(detail.project_context?.project_manager_name ?? detail.project_context?.project_manager_id)}</dd><dt>Field supervisor</dt><dd>{textValue(detail.project_context?.field_supervisor_name ?? detail.project_context?.field_supervisor_id)}</dd></dl></Panel>;
  if (tab === "financial_summary") return <Panel title="Financial Summary"><dl className="detail-list"><dt>Subtotal amount</dt><dd>{money(invoice.subtotal_amount)}</dd><dt>Retainage amount</dt><dd>{money(invoice.retainage_amount)}</dd><dt>Adjustment amount</dt><dd>{money(invoice.adjustment_amount)}</dd><dt>Tax amount</dt><dd>{money(invoice.tax_amount)}</dd><dt>Fee amount</dt><dd>{money(invoice.fee_amount)}</dd><dt>Total amount</dt><dd>{money(invoice.total_amount)}</dd><dt>Original amount</dt><dd>{money(invoice.original_amount)}</dd><dt>Paid amount</dt><dd>{money(invoice.paid_amount)}</dd><dt>Balance amount</dt><dd>{money(invoice.balance_amount)}</dd><dt>Currency</dt><dd>{textValue(invoice.currency)}</dd><dt>Financial summary</dt><dd><JsonBlock value={detail.financial_summary} /></dd></dl><div className="warning-box">Original amount locks when invoice is approved or sent. Paid amount and balance amount will be updated later by Cash Application.</div></Panel>;
  if (tab === "receivable_state") return <Panel title="Receivable State"><dl className="detail-list"><dt>Original amount</dt><dd>{money(invoice.original_amount)}</dd><dt>Paid amount</dt><dd>{money(invoice.paid_amount)}</dd><dt>Balance amount</dt><dd>{money(invoice.balance_amount)}</dd><dt>Aging days</dt><dd>{formatCell(invoice.aging_days)}</dd><dt>Payment status</dt><dd>{formatAction(invoice.payment_status)}</dd><dt>Collection status</dt><dd>{formatAction(invoice.collection_status)}</dd><dt>Cash application status</dt><dd>{formatAction(invoice.cash_application_status)}</dd><dt>Last payment at</dt><dd>{dateValue(invoice.last_payment_at)}</dd><dt>Last payment amount</dt><dd>{money(invoice.last_payment_amount)}</dd><dt>Writeoff amount</dt><dd>{money(invoice.writeoff_amount)}</dd><dt>Writeoff reason</dt><dd>{textValue(invoice.writeoff_reason)}</dd><dt>Receivable summary</dt><dd><JsonBlock value={detail.receivable_summary} /></dd></dl><div className="warning-box">Cash Application is not available in this sprint. Future payment application will update paid amount, balance amount, payment status, and collection status.</div></Panel>;
  if (tab === "approval") return <Panel title="Approval"><dl className="detail-list"><dt>Approval status</dt><dd>{formatAction(invoice.approval_status)}</dd><dt>Submitted by</dt><dd>{textValue(invoice.submitted_by)}</dd><dt>Submitted at</dt><dd>{dateValue(invoice.submitted_at)}</dd><dt>Approved by</dt><dd>{textValue(invoice.approved_by)}</dd><dt>Approved at</dt><dd>{dateValue(invoice.approved_at)}</dd><dt>Rejected by</dt><dd>{textValue(invoice.rejected_by)}</dd><dt>Rejected at</dt><dd>{dateValue(invoice.rejected_at)}</dd><dt>Rejection reason</dt><dd>{textValue(invoice.rejection_reason)}</dd><dt>Rejection note</dt><dd>{textValue(invoice.rejection_note)}</dd><dt>Approval summary</dt><dd><JsonBlock value={detail.approval_summary} /></dd></dl></Panel>;
  if (tab === "delivery") return <Panel title="Delivery"><dl className="detail-list"><dt>Delivery status</dt><dd>{formatAction(invoice.delivery_status)}</dd><dt>Sent by</dt><dd>{textValue(invoice.sent_by)}</dd><dt>Sent at</dt><dd>{dateValue(invoice.sent_at)}</dd><dt>Customer acceptance</dt><dd>{formatAction(invoice.customer_acceptance_status)}</dd><dt>Prime acceptance</dt><dd>{formatAction(invoice.prime_acceptance_status)}</dd><dt>Delivery summary</dt><dd><JsonBlock value={detail.delivery_summary} /></dd></dl><div className="warning-box">Email delivery, PDF generation, and customer portal submission are not available in this sprint.</div></Panel>;
  if (tab === "package_documentation") return <Panel title="Package / Documentation"><dl className="detail-list"><dt>Invoice package status</dt><dd>{formatAction(invoice.invoice_package_status)}</dd><dt>Documentation status</dt><dd>{formatAction(invoice.documentation_status)}</dd><dt>Customer acceptance</dt><dd>{formatAction(invoice.customer_acceptance_status)}</dd><dt>Prime acceptance</dt><dd>{formatAction(invoice.prime_acceptance_status)}</dd><dt>Package summary</dt><dd><JsonBlock value={detail.package_summary} /></dd></dl><WarningList title="Package / Documentation Warnings" rows={detail.warnings ?? []} empty="No package or documentation warnings returned." /><div className="warning-box">PDF invoice package generation is deferred.</div></Panel>;
  if (tab === "disputes") return <Panel title="Disputes"><dl className="detail-list"><dt>Dispute reason</dt><dd>{textValue(invoice.dispute_reason)}</dd><dt>Dispute note</dt><dd>{textValue(invoice.dispute_note)}</dd><dt>Disputed by</dt><dd>{textValue(invoice.disputed_by)}</dd><dt>Disputed at</dt><dd>{dateValue(invoice.disputed_at)}</dd><dt>Current status</dt><dd>{formatAction(invoice.status)}</dd><dt>Collection status</dt><dd>{formatAction(invoice.collection_status)}</dd></dl></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor", "action", "object", "before", "after", "reason", "timestamp", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view invoice audit details.</div>}</Panel>;
  if (tab === "future_cash_application") return <PlaceholderPanel title="Future Cash Application" message="Cash Application is not available in this sprint. Future Cash Application will record payment events and apply payments against invoice balance." columns={["Payment event", "Cash receipt", "Bank transaction"]} />;
  return <PlaceholderPanel title="Future Collections" message="Collections automation is not available in this sprint. Collection status is tracked on the invoice and may be used by a future Collections workflow." columns={["Collection workflow", "Collection notice", "Writeoff workflow"]} />;
}

function InvoiceItemsTable({ rows, session, onItemAction }: { rows: SyncRecord[]; session: Session; onItemAction: (type: string, item: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No invoice items returned. Add items from invoice-ready settlement items.</div>;
  return (
    <div className="wide-table">
      <table>
        <thead><tr>{["Item Type", "Status", "Description", "Settlement", "Settlement Item", "Project", "Work Order", "Production Record", "QC Review", "Quantity", "Unit", "Unit Rate", "Gross Amount", "Retainage Amount", "Deduction Amount", "Adjustment Amount", "Tax Amount", "Fee Amount", "Net Amount", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((item) => <tr key={String(item.id)}>
            <td>{formatAction(item.item_type)}</td>
            <td>{formatAction(item.status)}</td>
            <td>{textValue(item.description)}</td>
            <td>{settlementLink(item.settlement_id, item.settlement_number)}</td>
            <td>{textValue(item.settlement_item_id)}</td>
            <td>{projectLink(item.project_id, item.project_name)}</td>
            <td>{workOrderLink(item.work_order_id, item.work_order_name)}</td>
            <td>{productionLink(item.production_record_id, item.production_type)}</td>
            <td>{qcLink(item.qc_review_id, item.review_type)}</td>
            <td>{formatCell(item.quantity)}</td>
            <td>{formatAction(item.unit)}</td>
            <td>{money(item.unit_rate)}</td>
            <td>{money(item.gross_amount)}</td>
            <td>{money(item.retainage_amount)}</td>
            <td>{money(item.deduction_amount)}</td>
            <td>{money(item.adjustment_amount)}</td>
            <td>{money(item.tax_amount)}</td>
            <td>{money(item.fee_amount)}</td>
            <td>{money(item.net_amount)}</td>
            <td><div className="form-actions"><ActionButton permission="invoice_item.void" session={session} disabled={["voided", "archived"].includes(String(item.status))} onClick={() => onItemAction("void_item", item)}>Void</ActionButton><ActionButton permission="invoice_item.archive" session={session} disabled={String(item.status) === "archived"} onClick={() => onItemAction("archive_item", item)}>Archive</ActionButton></div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceLifecycleModal({ type, invoiceId, invoice, related, blockers, session, item, onClose, onSaved }: { type: string; invoiceId: string; invoice: SyncRecord; related: RelatedData; blockers: SyncRecord[]; session: Session; item: SyncRecord | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const itemAction = type === "void_item" || type === "archive_item";
  const blockedApproval = type === "approve" && blockers.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blockedApproval) return;
    setError("");
    try {
      if (type === "add_item") {
        await syncosFetch(`/invoices/${invoiceId}/items`, { method: "POST", body: addInvoiceItemBody(form), token: session.token });
      } else if (itemAction && item?.id) {
        await syncosFetch(`/invoice-items/${item.id}/${type === "void_item" ? "void" : "archive"}`, { method: "POST", body: itemModalBody(type, form), token: session.token });
      } else {
        await syncosFetch(`/invoices/${invoiceId}/${invoiceModalPath(type)}`, { method: "POST", body: invoiceModalBody(type, form), token: session.token });
      }
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
        {blockedApproval ? <div className="error-banner">Resolve blockers before approval.</div> : null}
        {type === "add_item" ? <AddInvoiceItemFields form={form} setForm={setForm} settlementItems={related.settlementItems} /> : null}
        {type === "approve" ? <><label>Approval Note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><WarningList title="Backend Warnings" rows={arrayValue(invoice.warnings)} empty="No warnings returned." /><WarningList title="Backend Blockers" rows={blockers} empty="No blockers returned." /></> : null}
        {type === "reject" ? <><label>Rejection Reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejection Note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {type === "mark_sent" ? <><label>Sent Note<textarea value={form.sent_note ?? ""} onChange={(event) => setForm({ ...form, sent_note: event.target.value })} required /></label><Select label="Delivery Status" value={form.delivery_status ?? ""} options={["", ...deliveryStatuses]} onChange={(delivery_status) => setForm({ ...form, delivery_status })} /><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><div className="warning-box">Mark Sent does not create cash, payment, bank, payroll, tax, ACH, card payout, or accounting export records.</div></> : null}
        {type === "cash_ready" ? <><label>Ready Note<textarea value={form.ready_note ?? ""} onChange={(event) => setForm({ ...form, ready_note: event.target.value })} required /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><div className="warning-box">Mark Ready For Cash Application does not create cash receipt, payment, bank transaction, ACH, card payout, payroll, tax, or accounting export records.</div></> : null}
        {type === "dispute" ? <><label>Dispute Reason<textarea value={form.dispute_reason ?? ""} onChange={(event) => setForm({ ...form, dispute_reason: event.target.value })} required /></label><label>Dispute Note<textarea value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}
        {type === "resolve" ? <><label>Resolution Note<textarea value={form.resolution_note ?? ""} onChange={(event) => setForm({ ...form, resolution_note: event.target.value })} required /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label></> : null}
        {type === "void" ? <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {type === "archive" ? <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {type === "void_item" ? <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {type === "archive_item" ? <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {["recalculate", "submit_review"].includes(type) ? <div className="warning-box">This action uses the Invoice backend lifecycle route and creates no cash/payment records.</div> : null}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={blockedApproval}>Submit</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function AddInvoiceItemFields({ form, setForm, settlementItems }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; settlementItems: SyncRecord[] }) {
  return <div className="form-grid"><Select label="Settlement Item" value={form.settlement_item_id ?? ""} options={["", ...settlementItems.map((row) => String(row.id))]} labels={labelsFor(settlementItems, "description")} onChange={(settlement_item_id) => setForm({ ...form, settlement_item_id })} /><label>Settlement Item ID<input value={form.settlement_item_id ?? ""} onChange={(event) => setForm({ ...form, settlement_item_id: event.target.value })} required /></label><label>Quantity<input type="number" step="0.01" value={form.quantity ?? ""} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label>Unit Rate<input type="number" step="0.01" value={form.unit_rate ?? ""} onChange={(event) => setForm({ ...form, unit_rate: event.target.value })} /></label><label>Description<textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Adjustment Amount<input type="number" step="0.01" value={form.adjustment_amount ?? ""} onChange={(event) => setForm({ ...form, adjustment_amount: event.target.value })} /></label><label>Tax Amount<input type="number" step="0.01" value={form.tax_amount ?? ""} onChange={(event) => setForm({ ...form, tax_amount: event.target.value })} /></label><label>Fee Amount<input type="number" step="0.01" value={form.fee_amount ?? ""} onChange={(event) => setForm({ ...form, fee_amount: event.target.value })} /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><div className="warning-box">Invoice item creation consumes invoice-ready settlement items and creates no cash/payment records.</div></div>;
}

function InvoiceFormFields({ form, setForm, related, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeCreate?: boolean; disabled?: boolean }) {
  return <div className="form-grid">{includeCreate ? <><Select label="Customer Organization" value={form.customer_organization_id ?? ""} options={["", ...related.customers.map((row) => String(row.id))]} labels={labelsFor(related.customers)} onChange={(customer_organization_id) => setForm({ ...form, customer_organization_id })} disabled={disabled} /><Select label="Invoice Type" value={form.invoice_type ?? "standard"} options={invoiceTypes} onChange={(invoice_type) => setForm({ ...form, invoice_type })} disabled={disabled} /><Select label="Settlement" value={form.settlement_id ?? ""} options={["", ...related.settlements.map((row) => String(row.id))]} labels={labelsFor(related.settlements, "settlement_number")} onChange={(settlement_id) => setForm({ ...form, settlement_id })} disabled={disabled} /><Select label="Project" value={form.project_id ?? ""} options={["", ...related.projects.map((row) => String(row.id))]} labels={labelsFor(related.projects)} onChange={(project_id) => setForm({ ...form, project_id })} disabled={disabled} /></> : null}<label>Invoice Date<input disabled={disabled} type="date" value={form.invoice_date ?? ""} onChange={(event) => setForm({ ...form, invoice_date: event.target.value })} /></label><label>Due Date<input disabled={disabled} type="date" value={form.due_date ?? ""} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label><Select label="Payment Terms" value={form.payment_terms ?? ""} options={["", ...paymentTerms]} onChange={(payment_terms) => setForm({ ...form, payment_terms })} disabled={disabled} /><label>Billing Period Start<input disabled={disabled} type="date" value={form.billing_period_start ?? ""} onChange={(event) => setForm({ ...form, billing_period_start: event.target.value })} /></label><label>Billing Period End<input disabled={disabled} type="date" value={form.billing_period_end ?? ""} onChange={(event) => setForm({ ...form, billing_period_end: event.target.value })} /></label>{includeCreate ? <label>Currency<input disabled={disabled} value={form.currency ?? "USD"} onChange={(event) => setForm({ ...form, currency: event.target.value })} /></label> : null}{!includeCreate ? <><Select label="Invoice Package Status" value={form.invoice_package_status ?? ""} options={["", ...packageStatuses]} onChange={(invoice_package_status) => setForm({ ...form, invoice_package_status })} disabled={disabled} /><Select label="Documentation Status" value={form.documentation_status ?? ""} options={["", ...packageStatuses]} onChange={(documentation_status) => setForm({ ...form, documentation_status })} disabled={disabled} /><Select label="Customer Acceptance Status" value={form.customer_acceptance_status ?? ""} options={["", ...acceptanceStatuses]} onChange={(customer_acceptance_status) => setForm({ ...form, customer_acceptance_status })} disabled={disabled} /><Select label="Prime Acceptance Status" value={form.prime_acceptance_status ?? ""} options={["", ...acceptanceStatuses]} onChange={(prime_acceptance_status) => setForm({ ...form, prime_acceptance_status })} disabled={disabled} /></> : null}<label>Override Reasons JSON<textarea disabled={disabled} value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>{!includeCreate ? <label>Dispute Note<textarea disabled={disabled} value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label> : null}</div>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test invoice actions.</p></div><button type="button" onClick={session.applyDefaults}>Use invoice defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>([]);
  useEffect(() => {
    setTokenState(readToken());
    setPermissionsState(readPermissions().length ? readPermissions() : invoiceDefaultPermissions);
  }, []);
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  return { token, permissions, setToken, setPermissions, applyDefaults: () => setPermissions(invoiceDefaultPermissions) };
}

async function loadRelated(token: string, settlementId = ""): Promise<RelatedData> {
  const [customers, projects, settlements, settlementItems] = await Promise.all([
    optionalList("/organizations", token),
    optionalList("/projects", token),
    optionalList("/settlements?invoice_ready=true&archived=false", token),
    settlementId ? optionalList(`/settlements/${settlementId}/items`, token) : Promise.resolve([]),
  ]);
  return { customers, projects, settlements, settlementItems };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function buildInvoicePayload(form: Record<string, string>) {
  return prune({ customer_organization_id: form.customer_organization_id, invoice_type: form.invoice_type, settlement_id: form.settlement_id, project_id: form.project_id, invoice_date: form.invoice_date, due_date: form.due_date, payment_terms: form.payment_terms, billing_period_start: form.billing_period_start, billing_period_end: form.billing_period_end, currency: form.currency, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
}

function buildInvoicePatchPayload(form: Record<string, string>) {
  return prune({ invoice_date: form.invoice_date, due_date: form.due_date, payment_terms: form.payment_terms, billing_period_start: form.billing_period_start, billing_period_end: form.billing_period_end, invoice_package_status: form.invoice_package_status, documentation_status: form.documentation_status, customer_acceptance_status: form.customer_acceptance_status, prime_acceptance_status: form.prime_acceptance_status, override_reasons: parseJsonField(form.override_reasons, "override_reasons"), dispute_note: form.dispute_note });
}

function addInvoiceItemBody(form: Record<string, string>) {
  return prune({ settlement_item_id: form.settlement_item_id, quantity: form.quantity, unit_rate: form.unit_rate, description: form.description, adjustment_amount: form.adjustment_amount, tax_amount: form.tax_amount, fee_amount: form.fee_amount, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
}

function invoiceModalBody(type: string, form: Record<string, string>) {
  if (type === "approve") return prune({ approval_note: form.approval_note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "reject") return prune({ rejection_reason: form.rejection_reason, rejection_note: form.rejection_note });
  if (type === "mark_sent") return prune({ sent_note: form.sent_note, delivery_status: form.delivery_status, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "cash_ready") return prune({ ready_note: form.ready_note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "dispute") return prune({ dispute_reason: form.dispute_reason, dispute_note: form.dispute_note });
  if (type === "resolve") return prune({ resolution_note: form.resolution_note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "void") return prune({ void_reason: form.void_reason, void_note: form.void_note });
  if (type === "archive") return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
  return {};
}

function itemModalBody(type: string, form: Record<string, string>) {
  if (type === "void_item") return prune({ void_reason: form.void_reason, void_note: form.void_note });
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
}

function invoiceModalPath(type: string) {
  if (type === "submit_review") return "submit-review";
  if (type === "mark_sent") return "mark-sent";
  if (type === "cash_ready") return "mark-ready-for-cash-application";
  if (type === "resolve") return "resolve-dispute";
  if (type === "recalculate") return "recalculate-totals";
  return type;
}

function modalTitle(type: string) {
  if (type === "add_item") return "Add Invoice Item";
  if (type === "submit_review") return "Submit Review";
  if (type === "mark_sent") return "Mark Sent";
  if (type === "cash_ready") return "Mark Ready For Cash Application";
  if (type === "resolve") return "Resolve Dispute";
  if (type === "recalculate") return "Recalculate Totals";
  if (type === "void_item") return "Void Invoice Item";
  if (type === "archive_item") return "Archive Invoice Item";
  return formatAction(type);
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
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? (option ? formatAction(option) : "Any")}</option>)}</select></label>;
}

function ObjectTable({ rows, columns }: { rows: SyncRecord[]; columns: string[] }) {
  if (!rows.length) return <div className="empty-state">No records returned.</div>;
  return <div className="wide-table"><table><thead><tr>{columns.map((column) => <th key={column}>{formatAction(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.event_id ?? row.audit_id ?? index)}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div>;
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

const invoiceQueues = [
  { id: "draft", label: "Draft", helper: "Invoices being prepared." },
  { id: "submitted_for_review", label: "Submitted for Review", helper: "Invoices waiting for finance approval or review." },
  { id: "rejected", label: "Rejected", helper: "Invoices returned for correction." },
  { id: "approved", label: "Approved", helper: "Invoices approved internally and ready to be marked sent if sent externally." },
  { id: "sent", label: "Sent", helper: "Invoices recorded as sent externally or by manual reference." },
  { id: "disputed", label: "Disputed", helper: "Invoices blocked by dispute state." },
  { id: "aging", label: "Aging", helper: "Invoices that may require cash follow-up or collections in later workflow." },
  { id: "archived", label: "Archived", helper: "Closed or removed invoices." },
];

function matchesInvoiceQueue(row: SyncRecord, queue: string) {
  if (queue === "submitted_for_review") return ["ready_for_review", "under_review"].includes(String(row.status)) || row.approval_status === "pending";
  if (queue === "rejected") return row.status === "rejected" || row.approval_status === "rejected";
  if (queue === "approved") return row.status === "approved" || row.approval_status === "approved";
  if (queue === "sent") return row.status === "sent" || row.delivery_status === "sent";
  if (queue === "disputed") return row.status === "disputed" || row.collection_status === "disputed" || Boolean(row.dispute_reason);
  if (queue === "aging") return String(row.collection_status) === "overdue" || numberValue(row.aging_days, 0) > 0;
  if (queue === "archived") return row.status === "archived";
  return ["draft", "assembling"].includes(String(row.status));
}

function emptyInvoiceQueue(queue: string) {
  if (queue === "submitted_for_review") return "No invoices are waiting for review.";
  if (queue === "rejected") return "No rejected invoices need correction.";
  if (queue === "approved") return "No approved invoices are waiting to be marked sent.";
  if (queue === "sent") return "No sent invoices in this queue.";
  if (queue === "disputed") return "No invoice disputes are open.";
  if (queue === "aging") return "No invoices are aging in this queue.";
  if (queue === "archived") return "No archived invoices in this queue.";
  return "No draft invoices need attention.";
}

function nextInvoiceAction(row: SyncRecord) {
  if (row.status === "disputed" || row.collection_status === "disputed") return "Resolve Dispute";
  if (row.status === "rejected" || row.approval_status === "rejected") return "Correct invoice";
  if (["ready_for_review", "under_review"].includes(String(row.status)) || row.approval_status === "pending") return "Review invoice";
  if (row.status === "approved" || row.approval_status === "approved") return "Mark Sent";
  if (row.status === "sent" || row.delivery_status === "sent") return "Monitor cash readiness";
  if (String(row.collection_status) === "overdue" || numberValue(row.aging_days, 0) > 0) return "Review aging";
  return "Submit Review";
}

function firstHref(rows: SyncRecord[], fallback: string) {
  const first = rows[0];
  return first?.id ? `${fallback}/${first.id}` : fallback;
}

function matchesFilters(row: SyncRecord, filters: Record<string, string>) {
  if (filters.hasBalance && boolMismatch(numberValue(row.balance_amount, 0) > 0, filters.hasBalance)) return false;
  if (filters.overdue && boolMismatch(String(row.collection_status) === "overdue" || numberValue(row.aging_days, 0) > 0, filters.overdue)) return false;
  return true;
}

function sortInvoices(rows: SyncRecord[], sort = "updated_desc") {
  return [...rows].sort((a, b) => {
    if (sort === "invoice_date_desc") return dateTime(b.invoice_date) - dateTime(a.invoice_date);
    if (sort === "due_date_asc") return dateTime(a.due_date) - dateTime(b.due_date);
    if (sort === "total_amount_desc") return numberValue(b.total_amount, -1) - numberValue(a.total_amount, -1);
    if (sort === "balance_amount_desc") return numberValue(b.balance_amount, -1) - numberValue(a.balance_amount, -1);
    if (sort === "aging_desc") return numberValue(b.aging_days, -1) - numberValue(a.aging_days, -1);
    if (sort === "status") return String(a.status).localeCompare(String(b.status));
    if (sort === "invoice_number") return String(a.invoice_number ?? "").localeCompare(String(b.invoice_number ?? ""));
    const disputePriority = Number(b.status === "disputed" || b.collection_status === "disputed") - Number(a.status === "disputed" || a.collection_status === "disputed");
    if (disputePriority) return disputePriority;
    const duePriority = collectionRank(b.collection_status) - collectionRank(a.collection_status);
    if (duePriority) return duePriority;
    const balancePriority = Number(numberValue(b.balance_amount, 0) > 0) - Number(numberValue(a.balance_amount, 0) > 0);
    if (balancePriority) return balancePriority;
    const dueDate = dateTime(a.due_date) - dateTime(b.due_date);
    if (dueDate) return dueDate;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function collectionRank(status: unknown) {
  if (status === "overdue") return 3;
  if (status === "due") return 2;
  if (status === "not_due") return 1;
  return 0;
}

function invoiceChecklist(invoice: SyncRecord, items: SyncRecord[]): [string, boolean][] {
  return [["Customer exists", Boolean(invoice.customer_organization_id)], ["Settlement context reviewed", Boolean(invoice.settlement_id)], ["Invoice items present", items.length > 0], ["Totals calculated", invoice.total_amount !== undefined], ["Invoice approved", invoice.approval_status === "approved"], ["Invoice sent", invoice.delivery_status === "sent"], ["Ready for cash application", invoice.cash_application_status === "ready_for_cash_application"], ["No cash/payment created", true], ["Balance tracked on invoice", invoice.balance_amount !== undefined]];
}

function invoiceRecord(detail: InvoiceDetailShape): SyncRecord {
  return detail.invoice ?? (detail as SyncRecord);
}

function arrayValue(value: unknown): SyncRecord[] {
  return Array.isArray(value) ? value as SyncRecord[] : [];
}

function boolMismatch(actual: boolean, expected: string) {
  return (expected === "true" && !actual) || (expected === "false" && actual);
}

function boolText(value: unknown) {
  return value ? "Yes" : "No";
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
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.invoice_number ?? row.settlement_number ?? row.description, String(row.id))]));
}

function viewOnly(item: SyncRecord) {
  return ["voided", "archived"].includes(String(item.status));
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

function settlementLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/settlements/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function organizationLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/intelligence/organizations/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function actionNotice(type: string) {
  if (type === "add_item") return "Invoice item added from a settlement item. No cash or payment record was created.";
  if (type === "approve") return "Invoice approved. No AR, cash, payment, payroll, tax, bank, ACH, card payout, or accounting export record was created.";
  if (type === "mark_sent") return "Invoice marked sent. No cash or payment record was created.";
  if (type === "cash_ready") return "Invoice marked ready for cash application. No cash receipt, payment, or bank transaction was created.";
  return "Invoice action completed.";
}

function plainError(message: string) {
  if (!message) return "Invoice action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("not found")) return "Invoice not found or you do not have access.";
  if (message.includes("at least one item")) return "Invoice requires at least one item.";
  if (message.includes("invoice_ready") || message.includes("settlement item")) return "Settlement item must be invoice ready.";
  if (message.includes("contractor")) return "Contractor payable items cannot be invoiced to customer.";
  if (message.includes("duplicate")) return "Duplicate invoice item is not allowed without override.";
  if (message.includes("quantity")) return "Quantity cannot exceed settlement item quantity without override.";
  if (message.includes("reject")) return "Rejection reason is required.";
  if (message.includes("dispute")) return "Dispute reason is required.";
  if (message.includes("void")) return "Void reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

const invoiceDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "invoice.read",
  "invoice.create",
  "invoice.update",
  "invoice.add_item",
  "invoice.remove_item",
  "invoice.recalculate_totals",
  "invoice.submit_review",
  "invoice.approve",
  "invoice.reject",
  "invoice.mark_sent",
  "invoice.mark_ready_for_cash_application",
  "invoice.dispute",
  "invoice.resolve_dispute",
  "invoice.void",
  "invoice.archive",
  "invoice.timeline.read",
  "invoice.audit.read",
  "invoice_item.read",
  "invoice_item.create",
  "invoice_item.update",
  "invoice_item.void",
  "invoice_item.archive",
  "settlement.read",
  "settlement_item.read",
  "project.read",
  "organization.read",
];

const emptyRelated: RelatedData = { customers: [], projects: [], settlements: [], settlementItems: [] };
