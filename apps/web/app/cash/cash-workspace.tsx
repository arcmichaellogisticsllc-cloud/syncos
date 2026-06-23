"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const paymentMethods = ["ach", "wire", "check", "card", "cash", "lockbox", "portal", "zelle", "other"];
const receiptStatuses = ["received", "partially_applied", "fully_applied", "unapplied", "overapplied", "voided", "archived"];
const depositStatuses = ["not_deposited", "deposited_later", "pending_later", "reconciled_later"];
const reconciliationStatuses = ["not_reconciled", "pending_later", "reconciled_later", "exception_later"];
const sourceTypes = ["manual", "bank_import_later", "processor_import_later", "customer_portal_later", "accounting_import_later"];
const applicationStatuses = ["applied", "partially_applied", "reversed_later", "voided", "archived"];
const applicationTypes = ["standard_payment", "partial_payment", "overpayment_application", "retainage_payment", "discount", "writeoff_later", "adjustment", "correction"];
const receiptTabs = ["overview", "payment_applications", "customer", "invoice_impact", "unapplied_cash", "timeline", "audit", "future_collections", "future_reconciliation", "future_contractor_payables"];

type CashReceiptDetailShape = {
  cash_receipt?: SyncRecord;
  customer_context?: SyncRecord | null;
  payment_applications?: SyncRecord[];
  applied_invoices?: SyncRecord[];
  unapplied_summary?: SyncRecord;
  boundary_summary?: SyncRecord;
  warnings?: SyncRecord[];
  blockers?: SyncRecord[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type PaymentApplicationDetailShape = {
  application?: SyncRecord;
  cash_receipt_context?: SyncRecord | null;
  invoice_context?: SyncRecord | null;
  customer_context?: SyncRecord | null;
  before_after_invoice_balance?: unknown;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  customers: SyncRecord[];
  invoices: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function CashReceiptQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("archived", filters.archived === "true" ? "true" : "false");
      for (const key of ["customer_organization_id", "payment_method", "receipt_status", "deposit_status", "reconciliation_status", "source_type", "payment_date_from", "payment_date_to", "has_unapplied", "q"]) if (filters[key]) query.set(key, filters[key]);
      if (filters.sort) query.set("sort", filters.sort);
      setRows(await syncosFetch<SyncRecord[]>(`/cash-receipts?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortReceipts(rows.filter((row) => receiptMatches(row, filters)), filters.sort), [rows, filters]);
  const summary = useMemo(() => buildReceiptSummary(rows), [rows]);

  return (
    <CashShell title="Cash Receipt Queue" purpose="Control received money, unapplied cash, and payment applications without creating bank, payroll, tax, reconciliation, or accounting records.">
      <SessionPanel session={session} />
      <div className="warning-box">Receipt creation does not change invoice balances. Invoice balances change only through payment applications.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view cash receipts.</div> : null}
      {loading ? <div className="empty-state">Loading cash receipts...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Cash Receipt Summary</h2>
                <p className="muted">Receipts are prioritized by unapplied cash, partial application, and recent updates.</p>
              </div>
              <Link className="primary-button" href="/cash/receipts/new" aria-disabled={!hasPermission(session.permissions, "cash_receipt.create")}>Create Receipt</Link>
            </div>
            <div className="summary-grid">
              <SummaryCard label="Total Receipts" value={summary.total} onClick={() => setFilters({ archived: "false", sort: "updated_desc" })} />
              {["unapplied", "partially_applied", "fully_applied", "overapplied", "voided", "archived"].map((status) => <SummaryCard key={status} label={formatAction(status)} value={summary.status[status] ?? 0} onClick={() => setFilters({ archived: status === "archived" ? "true" : "false", sort: "updated_desc", receipt_status: status })} />)}
              {["ach", "wire", "check", "card", "cash", "lockbox", "portal"].map((method) => <SummaryCard key={method} label={formatAction(method)} value={summary.method[method] ?? 0} onClick={() => setFilters({ ...filters, payment_method: method })} />)}
              <SummaryCard label="Balance Remaining" value={summary.balanceRemaining} onClick={() => setFilters({ ...filters, has_unapplied: "true" })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false", sort: "updated_desc" })}>Reset</button>
            </div>
            <div className="tab-row">
              {["unapplied", "partially_applied", "fully_applied"].map((receipt_status) => <button key={receipt_status} type="button" onClick={() => setFilters({ ...filters, receipt_status })}>{formatAction(receipt_status)}</button>)}
              {["ach", "wire", "check", "card", "cash", "portal"].map((payment_method) => <button key={payment_method} type="button" onClick={() => setFilters({ ...filters, payment_method })}>{formatAction(payment_method)}</button>)}
              <button type="button" onClick={() => setFilters({ ...filters, receipt_status: "voided" })}>Voided</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search receipt, reference, payer, customer" />
              <input value={filters.customer_organization_id ?? ""} onChange={(event) => setFilters({ ...filters, customer_organization_id: event.target.value })} placeholder="Customer" />
              <Select label="Payment Method" value={filters.payment_method ?? ""} options={["", ...paymentMethods]} onChange={(payment_method) => setFilters({ ...filters, payment_method })} />
              <Select label="Receipt Status" value={filters.receipt_status ?? ""} options={["", ...receiptStatuses]} onChange={(receipt_status) => setFilters({ ...filters, receipt_status })} />
              <Select label="Deposit Status" value={filters.deposit_status ?? ""} options={["", ...depositStatuses]} onChange={(deposit_status) => setFilters({ ...filters, deposit_status })} />
              <Select label="Reconciliation Status" value={filters.reconciliation_status ?? ""} options={["", ...reconciliationStatuses]} onChange={(reconciliation_status) => setFilters({ ...filters, reconciliation_status })} />
              <Select label="Source Type" value={filters.source_type ?? ""} options={["", ...sourceTypes]} onChange={(source_type) => setFilters({ ...filters, source_type })} />
              <label>Payment Date From<input type="date" value={filters.payment_date_from ?? ""} onChange={(event) => setFilters({ ...filters, payment_date_from: event.target.value })} /></label>
              <label>Payment Date To<input type="date" value={filters.payment_date_to ?? ""} onChange={(event) => setFilters({ ...filters, payment_date_to: event.target.value })} /></label>
              <Select label="Has Unapplied Cash" value={filters.has_unapplied ?? ""} options={["", "true", "false"]} onChange={(has_unapplied) => setFilters({ ...filters, has_unapplied })} />
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
              <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "payment_date_desc", "payment_date_asc", "amount_desc", "unapplied_desc", "receipt_number"]} labels={{ updated_desc: "Recently updated", payment_date_desc: "Payment date newest", payment_date_asc: "Payment date oldest", amount_desc: "Gross amount highest", unapplied_desc: "Unapplied highest", receipt_number: "Receipt number" }} onChange={(sort) => setFilters({ ...filters, sort })} />
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Cash Receipts</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No cash receipts yet. Create a receipt, then apply unapplied cash to ready invoices.</div> : <CashReceiptTable rows={visible} />}
          </section>
        </>
      ) : null}
    </CashShell>
  );
}

export function CashReceiptCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ payment_method: "check", source_type: "manual", currency: "USD" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/cash-receipts", { method: "POST", body: buildReceiptCreatePayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? after?.id ?? "");
      router.push(id ? `/cash/receipts/${id}` : "/cash");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <CashShell title="Create Cash Receipt" purpose="Record received money without updating invoices or creating payment applications, bank transactions, payroll, tax, or accounting records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Backend validation is authoritative. Creating a receipt does not update invoice balances and does not create payment applications or bank transactions.</div>
        <ReceiptFormFields form={form} setForm={setForm} related={related} includeCreate />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "cash_receipt.create")}>Create Receipt</button>
          <Link className="link-button" href="/cash">Cancel</Link>
        </div>
      </form>
    </CashShell>
  );
}

export function CashReceiptEdit({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const session = useSession();
  const [detail, setDetail] = useState<CashReceiptDetailShape | null>(null);
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const [next, nextRelated] = await Promise.all([
          syncosFetch<CashReceiptDetailShape>(`/cash-receipts/${receiptId}/detail`, { token: session.token }),
          loadRelated(session.token),
        ]);
        const receipt = cashReceiptRecord(next);
        setDetail(next);
        setRelated(nextRelated);
        setForm({
          customer_organization_id: String(receipt.customer_organization_id ?? ""),
          payer_name: String(receipt.payer_name ?? ""),
          payment_reference: String(receipt.payment_reference ?? ""),
          external_transaction_id: String(receipt.external_transaction_id ?? ""),
          payment_method: String(receipt.payment_method ?? ""),
          payment_date: dateInput(receipt.payment_date),
          evidence_reference: String(receipt.evidence_reference ?? ""),
          notes: String(receipt.notes ?? ""),
          override_reasons: jsonText(receipt.override_reasons),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, receiptId]);

  const receipt = detail ? cashReceiptRecord(detail) : null;
  const readOnly = receipt ? receiptViewOnly(receipt) : true;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/cash-receipts/${receiptId}`, { method: "PATCH", body: buildReceiptPatchPayload(form), token: session.token });
      router.push(`/cash/receipts/${receiptId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <CashShell title="Edit Cash Receipt" purpose="Edit supported receipt reference fields without bypassing application rules.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!receipt ? <div className="empty-state">Receipt not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Cannot bypass payment application rules. Invoice balances are not edited from this form.</div>
          <ReceiptFormFields form={form} setForm={setForm} related={related} disabled={readOnly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readOnly || !hasPermission(session.permissions, "cash_receipt.update")}>Save Receipt</button>
            <Link className="link-button" href={`/cash/receipts/${receiptId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </CashShell>
  );
}

export function CashReceiptDetail({ receiptId }: { receiptId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<CashReceiptDetailShape | null>(null);
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [selectedApplication, setSelectedApplication] = useState<SyncRecord | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const next = await syncosFetch<CashReceiptDetailShape>(`/cash-receipts/${receiptId}/detail`, { token: session.token });
      const [timeline, audit, nextRelated] = await Promise.all([
        optionalList(`/cash-receipts/${receiptId}/timeline`, session.token),
        optionalList(`/cash-receipts/${receiptId}/audit-summary`, session.token),
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
  }, [session.token, receiptId]);

  const receipt = detail ? cashReceiptRecord(detail) : null;
  const applications = detail?.payment_applications ?? [];

  function openApplicationAction(type: string, application: SyncRecord) {
    setSelectedApplication(application);
    setModal(type);
  }

  return (
    <CashShell title="Cash Receipt Detail" purpose="Show received money, where it has been applied, unapplied cash, timeline, and audit history.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Cash Receipt Detail.</div> : null}
      {!receipt && session.token && !error ? <div className="empty-state">Receipt not found or no access.</div> : null}
      {receipt && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(receipt.receipt_number, "Cash Receipt")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(receipt.payment_method)}</span>
                  <span className="badge">{formatAction(receipt.receipt_status)}</span>
                  <span className="badge">{formatAction(receipt.deposit_status)}</span>
                  <span className="badge">{formatAction(receipt.reconciliation_status)}</span>
                  <span className="badge">{formatAction(receipt.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/cash/receipts/${receiptId}/edit`} aria-disabled={!hasPermission(session.permissions, "cash_receipt.update")}>Edit Receipt</Link>
                <ActionButton permission="cash_receipt.apply" session={session} disabled={receiptViewOnly(receipt) || numberValue(receipt.unapplied_amount, 0) <= 0} onClick={() => setModal("apply")}>Apply To Invoice</ActionButton>
                <ActionButton permission="cash_receipt.void" session={session} disabled={receiptViewOnly(receipt) || activeApplications(applications) > 0} onClick={() => setModal("void_receipt")}>Void</ActionButton>
                <ActionButton permission="cash_receipt.archive" session={session} disabled={String(receipt.receipt_status) === "archived"} onClick={() => setModal("archive_receipt")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Gross Amount" value={money(receipt.gross_received_amount)} />
              <Metric label="Applied Amount" value={money(receipt.applied_amount)} />
              <Metric label="Unapplied Amount" value={money(receipt.unapplied_amount)} />
              <Metric label="Application Count" value={formatCell(receipt.application_count ?? applications.length)} />
              <Metric label="Invoice Count" value={formatCell(receipt.invoice_count)} />
              <Metric label="Receipt Status" value={formatAction(receipt.receipt_status)} />
              <Metric label="Payment Method" value={formatAction(receipt.payment_method)} />
            </div>
            <div className="warning-box">Receipt creation does not change invoice balances. Invoice balances change only through payment applications.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Customer</dt><dd>{organizationLink(receipt.customer_organization_id, receipt.customer_organization_name ?? detail.customer_context?.name)}</dd>
                <dt>Payer</dt><dd>{textValue(receipt.payer_name)}</dd>
                <dt>Payment date</dt><dd>{dateValue(receipt.payment_date)}</dd>
                <dt>Method</dt><dd>{formatAction(receipt.payment_method)}</dd>
                <dt>Reference</dt><dd>{textValue(receipt.payment_reference)}</dd>
                <dt>Gross amount</dt><dd>{money(receipt.gross_received_amount)}</dd>
                <dt>Applied amount</dt><dd>{money(receipt.applied_amount)}</dd>
                <dt>Unapplied cash</dt><dd>{money(receipt.unapplied_amount)}</dd>
                <dt>Receipt status</dt><dd>{formatAction(receipt.receipt_status)}</dd>
                <dt>Recommended next action</dt><dd>{formatAction(receipt.recommended_next_action ?? detail.recommended_next_action)}</dd>
              </dl>
              <Checklist items={receiptChecklist(receipt, applications)} />
              <div className="warning-box">Cash Application does not create payroll, contractor payments, bank reconciliation, deposits, ACH/card payouts, tax records, accounting exports, processor transactions, refunds, collections automation, or separate AR records.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {receiptTabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <CashReceiptTab tab={tab} detail={detail} receipt={receipt} applications={applications} session={session} onApplicationAction={openApplicationAction} />
            </section>
          </div>
          {modal ? <CashReceiptModal type={modal} receiptId={receiptId} receipt={receipt} applications={applications} related={related} application={selectedApplication} session={session} onClose={() => { setModal(""); setSelectedApplication(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </CashShell>
  );
}

export function PaymentApplicationQueue() {
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
      for (const key of ["cash_receipt_id", "invoice_id", "customer_organization_id", "application_status", "application_type", "application_date_from", "application_date_to", "q"]) if (filters[key]) query.set(key, filters[key]);
      setRows(await syncosFetch<SyncRecord[]>(`/payment-applications?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => rows.filter((row) => paymentApplicationMatches(row, filters)), [rows, filters]);

  return (
    <CashShell title="Payment Applications" purpose="Review payment allocations from cash receipts to invoices without direct invoice balance edits.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Loading payment applications...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Payment Application Filters</h2>
              <button type="button" onClick={() => setFilters({ archived: "false" })}>Reset</button>
            </div>
            <div className="filter-grid">
              <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search receipt, invoice, customer" />
              <input value={filters.cash_receipt_id ?? ""} onChange={(event) => setFilters({ ...filters, cash_receipt_id: event.target.value })} placeholder="Receipt" />
              <input value={filters.invoice_id ?? ""} onChange={(event) => setFilters({ ...filters, invoice_id: event.target.value })} placeholder="Invoice" />
              <input value={filters.customer_organization_id ?? ""} onChange={(event) => setFilters({ ...filters, customer_organization_id: event.target.value })} placeholder="Customer" />
              <Select label="Status" value={filters.application_status ?? ""} options={["", ...applicationStatuses]} onChange={(application_status) => setFilters({ ...filters, application_status })} />
              <Select label="Type" value={filters.application_type ?? ""} options={["", ...applicationTypes]} onChange={(application_type) => setFilters({ ...filters, application_type })} />
              <label>Date From<input type="date" value={filters.application_date_from ?? ""} onChange={(event) => setFilters({ ...filters, application_date_from: event.target.value })} /></label>
              <label>Date To<input type="date" value={filters.application_date_to ?? ""} onChange={(event) => setFilters({ ...filters, application_date_to: event.target.value })} /></label>
              <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
            </div>
          </section>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Payment Applications</h2>
              <span>{visible.length} shown</span>
            </div>
            <PaymentApplicationTable rows={visible} />
          </section>
        </>
      ) : null}
    </CashShell>
  );
}

export function PaymentApplicationDetail({ applicationId }: { applicationId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<PaymentApplicationDetailShape | null>(null);
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    try {
      const next = await syncosFetch<PaymentApplicationDetailShape>(`/payment-applications/${applicationId}/detail`, { token: session.token });
      const [timeline, audit] = await Promise.all([
        optionalList(`/payment-applications/${applicationId}/timeline`, session.token),
        optionalList(`/payment-applications/${applicationId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, applicationId]);

  const application = detail?.application;

  return (
    <CashShell title="Payment Application Detail" purpose="Show receipt context, invoice impact, customer context, timeline, and audit for a payment allocation.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!application ? <div className="empty-state">Payment application not found or no access.</div> : null}
      {application && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{String(application.id)}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(application.application_type)}</span>
                  <span className="badge">{formatAction(application.application_status)}</span>
                </div>
              </div>
              <div className="form-actions">
                <ActionButton permission="payment_application.void" session={session} disabled={applicationInactive(application)} onClick={() => setModal("void_application")}>Void Application</ActionButton>
                <ActionButton permission="payment_application.archive" session={session} disabled={String(application.application_status) === "archived"} onClick={() => setModal("archive_application")}>Archive Application</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Applied Amount" value={money(application.applied_amount)} />
              <Metric label="Application Date" value={dateValue(application.application_date)} />
              <Metric label="Type" value={formatAction(application.application_type)} />
              <Metric label="Status" value={formatAction(application.application_status)} />
              <Metric label="Receipt" value={textValue(detail.cash_receipt_context?.receipt_number, String(application.cash_receipt_id))} />
              <Metric label="Invoice" value={textValue(detail.invoice_context?.invoice_number, String(application.invoice_id))} />
            </div>
          </section>
          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Contexts</h2>
              <dl className="detail-list">
                <dt>Receipt</dt><dd>{cashReceiptLink(application.cash_receipt_id, detail.cash_receipt_context?.receipt_number)}</dd>
                <dt>Invoice</dt><dd>{invoiceLink(application.invoice_id, detail.invoice_context?.invoice_number)}</dd>
                <dt>Customer</dt><dd>{organizationLink(application.customer_organization_id, detail.customer_context?.name)}</dd>
                <dt>Invoice paid amount</dt><dd>{money(detail.invoice_context?.paid_amount)}</dd>
                <dt>Invoice balance</dt><dd>{money(detail.invoice_context?.balance_amount)}</dd>
              </dl>
              <div className="warning-box">Voiding a payment application reverses invoice paid and balance amounts through the backend. It does not create bank reversal or accounting export records.</div>
            </aside>
            <section className="workspace-panel">
              <Panel title="Application"><dl className="detail-list"><dt>Application ID</dt><dd>{String(application.id)}</dd><dt>Receipt</dt><dd>{cashReceiptLink(application.cash_receipt_id, detail.cash_receipt_context?.receipt_number)}</dd><dt>Invoice</dt><dd>{invoiceLink(application.invoice_id, detail.invoice_context?.invoice_number)}</dd><dt>Customer</dt><dd>{organizationLink(application.customer_organization_id, detail.customer_context?.name)}</dd><dt>Applied amount</dt><dd>{money(application.applied_amount)}</dd><dt>Application date</dt><dd>{dateValue(application.application_date)}</dd><dt>Type</dt><dd>{formatAction(application.application_type)}</dd><dt>Status</dt><dd>{formatAction(application.application_status)}</dd><dt>Note</dt><dd>{textValue(application.note)}</dd><dt>Before/after invoice balances</dt><dd><JsonBlock value={detail.before_after_invoice_balance} /></dd></dl></Panel>
              <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor", "timestamp", "summary", "object_type", "object_id"]} /></Panel>
              <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor", "action", "object", "before", "after", "reason", "timestamp", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view audit details.</div>}</Panel>
            </section>
          </div>
          {modal ? <PaymentApplicationModal type={modal} applicationId={applicationId} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice("Payment application action completed."); }} /> : null}
        </>
      ) : null}
    </CashShell>
  );
}

function CashShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/cash", "Cash Receipt Queue", "active"],
    ["/cash/receipts/new", "Create Receipt", "active"],
    ["/payment-applications", "Payment Applications", "active"],
    ["#receipt-detail", "Cash Receipt Detail", "placeholder"],
    ["#invoice-impact", "Invoice Impact", "placeholder"],
    ["#unapplied", "Unapplied Cash", "placeholder"],
    ["#customer", "Customer Context", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-collections", "Future Collections", "placeholder"],
    ["#future-reconciliation", "Future Reconciliation", "placeholder"],
    ["#future-payables", "Future Contractor Payables", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Cash Application</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function CashReceiptTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Receipt Number", "Customer", "Payer Name", "Payment Date", "Payment Method", "Payment Reference", "Gross Amount", "Applied Amount", "Unapplied Amount", "Receipt Status", "Deposit Status", "Reconciliation Status", "Source Type", "Application Count", "Invoice Count", "Recommended Next Action", "Updated Date"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><Link className="table-link" href={`/cash/receipts/${row.id}`}>{textValue(row.receipt_number, String(row.id))}</Link></td><td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td><td>{textValue(row.payer_name)}</td><td>{dateValue(row.payment_date)}</td><td>{formatAction(row.payment_method)}</td><td>{textValue(row.payment_reference)}</td><td>{money(row.gross_received_amount)}</td><td>{money(row.applied_amount)}</td><td>{money(row.unapplied_amount)}</td><td>{formatAction(row.receipt_status)}</td><td>{formatAction(row.deposit_status)}</td><td>{formatAction(row.reconciliation_status)}</td><td>{formatAction(row.source_type)}</td><td>{formatCell(row.application_count)}</td><td>{formatCell(row.invoice_count)}</td><td>{formatAction(row.recommended_next_action)}</td><td>{dateValue(row.updated_at)}</td></tr>)}</tbody></table></div>;
}

function PaymentApplicationTable({ rows }: { rows: SyncRecord[] }) {
  if (!rows.length) return <div className="empty-state">No payment applications returned.</div>;
  return <div className="wide-table"><table><thead><tr>{["Application ID", "Receipt Number", "Invoice Number", "Customer", "Applied Amount", "Application Date", "Application Type", "Status", "Updated Date"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><Link className="table-link" href={`/payment-applications/${row.id}`}>{String(row.id)}</Link></td><td>{cashReceiptLink(row.cash_receipt_id, row.receipt_number)}</td><td>{invoiceLink(row.invoice_id, row.invoice_number)}</td><td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td><td>{money(row.applied_amount)}</td><td>{dateValue(row.application_date)}</td><td>{formatAction(row.application_type)}</td><td>{formatAction(row.application_status)}</td><td>{dateValue(row.updated_at)}</td></tr>)}</tbody></table></div>;
}

function CashReceiptTab({ tab, detail, receipt, applications, session, onApplicationAction }: { tab: string; detail: CashReceiptDetailShape; receipt: SyncRecord; applications: SyncRecord[]; session: Session; onApplicationAction: (type: string, application: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Receipt number</dt><dd>{textValue(receipt.receipt_number)}</dd><dt>Customer</dt><dd>{organizationLink(receipt.customer_organization_id, receipt.customer_organization_name ?? detail.customer_context?.name)}</dd><dt>Payer name</dt><dd>{textValue(receipt.payer_name)}</dd><dt>Payment date</dt><dd>{dateValue(receipt.payment_date)}</dd><dt>Payment method</dt><dd>{formatAction(receipt.payment_method)}</dd><dt>Payment reference</dt><dd>{textValue(receipt.payment_reference)}</dd><dt>External transaction ID</dt><dd>{textValue(receipt.external_transaction_id)}</dd><dt>Source type</dt><dd>{formatAction(receipt.source_type)}</dd><dt>Receipt status</dt><dd>{formatAction(receipt.receipt_status)}</dd><dt>Deposit status</dt><dd>{formatAction(receipt.deposit_status)}</dd><dt>Reconciliation status</dt><dd>{formatAction(receipt.reconciliation_status)}</dd><dt>Notes</dt><dd>{textValue(receipt.notes)}</dd><dt>Created</dt><dd>{dateValue(receipt.created_at)}</dd><dt>Updated</dt><dd>{dateValue(receipt.updated_at)}</dd></dl></Panel>;
  if (tab === "payment_applications") return <Panel title="Payment Applications"><PaymentApplicationsForReceipt rows={applications} session={session} onApplicationAction={onApplicationAction} /><div className="warning-box">Payment applications are the only supported invoice balance update path.</div></Panel>;
  if (tab === "customer") return <Panel title="Customer"><dl className="detail-list"><dt>Customer</dt><dd>{organizationLink(receipt.customer_organization_id, receipt.customer_organization_name ?? detail.customer_context?.name)}</dd><dt>Customer status</dt><dd>{formatAction(detail.customer_context?.status)}</dd><dt>Payment terms</dt><dd>{formatAction(detail.customer_context?.payment_terms)}</dd><dt>Related receipts</dt><dd>{formatCell(detail.customer_context?.receipt_count)}</dd><dt>Open invoice count</dt><dd>{formatCell(detail.customer_context?.open_invoice_count)}</dd></dl></Panel>;
  if (tab === "invoice_impact") return <Panel title="Invoice Impact"><ObjectTable rows={applications.map((row) => ({ invoice_number: row.invoice_number, original_amount: row.invoice_original_amount, paid_amount_before: row.paid_amount_before, paid_amount_after: row.paid_amount_after ?? row.invoice_paid_amount, balance_before: row.balance_before, balance_after: row.balance_after ?? row.invoice_balance_amount, payment_status: row.invoice_payment_status, collection_status: row.invoice_collection_status }))} columns={["invoice_number", "original_amount", "paid_amount_before", "paid_amount_after", "balance_before", "balance_after", "payment_status", "collection_status"]} /><div className="warning-box">Invoice balances are updated through payment applications.</div></Panel>;
  if (tab === "unapplied_cash") return <Panel title="Unapplied Cash"><dl className="detail-list"><dt>Gross amount</dt><dd>{money(receipt.gross_received_amount)}</dd><dt>Applied amount</dt><dd>{money(receipt.applied_amount)}</dd><dt>Unapplied amount</dt><dd>{money(receipt.unapplied_amount)}</dd><dt>Application count</dt><dd>{formatCell(receipt.application_count ?? applications.length)}</dd><dt>Unapplied summary</dt><dd><JsonBlock value={detail.unapplied_summary} /></dd></dl><div className="warning-box">Unapplied cash remains available for future invoice application.</div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor", "action", "object", "before", "after", "reason", "timestamp", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view audit details.</div>}</Panel>;
  if (tab === "future_collections") return <PlaceholderPanel title="Future Collections" message="Collections workflows are not available in this sprint. Collection status is tracked on invoices and may be used by future collections automation." columns={["Collection workflow", "Notice", "Writeoff"]} />;
  if (tab === "future_reconciliation") return <PlaceholderPanel title="Future Reconciliation" message="Bank reconciliation is not available in this sprint. Deposit and reconciliation statuses are informational only." columns={["Deposit batch", "Bank transaction", "Reconciliation record"]} />;
  return <PlaceholderPanel title="Future Contractor Payables" message="Contractor payments and payroll are not available in this sprint." columns={["Contractor payment", "Payroll", "ACH payout"]} />;
}

function PaymentApplicationsForReceipt({ rows, session, onApplicationAction }: { rows: SyncRecord[]; session: Session; onApplicationAction: (type: string, application: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No payment applications yet. Apply unapplied cash to a ready invoice.</div>;
  return <div className="wide-table"><table><thead><tr>{["Invoice Number", "Customer", "Applied Amount", "Application Date", "Application Type", "Status", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{invoiceLink(row.invoice_id, row.invoice_number)}</td><td>{organizationLink(row.customer_organization_id, row.customer_organization_name)}</td><td>{money(row.applied_amount)}</td><td>{dateValue(row.application_date)}</td><td>{formatAction(row.application_type)}</td><td>{formatAction(row.application_status)}</td><td><div className="form-actions"><Link className="link-button" href={`/payment-applications/${row.id}`}>Open</Link><ActionButton permission="payment_application.void" session={session} disabled={applicationInactive(row)} onClick={() => onApplicationAction("void_application", row)}>Void</ActionButton><ActionButton permission="payment_application.archive" session={session} disabled={String(row.application_status) === "archived"} onClick={() => onApplicationAction("archive_application", row)}>Archive</ActionButton></div></td></tr>)}</tbody></table></div>;
}

function CashReceiptModal({ type, receiptId, receipt, applications, related, application, session, onClose, onSaved }: { type: string; receiptId: string; receipt: SyncRecord; applications: SyncRecord[]; related: RelatedData; application: SyncRecord | null; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (type === "apply") {
        await syncosFetch(`/cash-receipts/${receiptId}/apply`, { method: "POST", body: applyPayload(form), token: session.token });
      } else if ((type === "void_application" || type === "archive_application") && application?.id) {
        await syncosFetch(`/payment-applications/${application.id}/${type === "void_application" ? "void" : "archive"}`, { method: "POST", body: applicationActionPayload(type, form), token: session.token });
      } else {
        await syncosFetch(`/cash-receipts/${receiptId}/${type === "void_receipt" ? "void" : "archive"}`, { method: "POST", body: receiptActionPayload(type, form), token: session.token });
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
        {type === "apply" ? <ApplyFields form={form} setForm={setForm} invoices={related.invoices} receipt={receipt} applications={applications} /> : null}
        {type === "void_receipt" ? <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {type === "archive_receipt" ? <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {type === "void_application" ? <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {type === "archive_application" ? <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        <div className="form-actions">
          <button className="primary-button" type="submit">Submit</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function PaymentApplicationModal({ type, applicationId, session, onClose, onSaved }: { type: string; applicationId: string; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/payment-applications/${applicationId}/${type === "void_application" ? "void" : "archive"}`, { method: "POST", body: applicationActionPayload(type, form), token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="modal-card" onSubmit={(event) => void submit(event)}><div className="section-toolbar"><h2>{modalTitle(type)}</h2><button type="button" onClick={onClose}>Close</button></div>{error ? <div className="error-banner">{error}</div> : null}{type === "void_application" ? <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></>}<div className="form-actions"><button className="primary-button" type="submit">Submit</button><button type="button" onClick={onClose}>Cancel</button></div></form></div>;
}

function ApplyFields({ form, setForm, invoices, receipt, applications }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; invoices: SyncRecord[]; receipt: SyncRecord; applications: SyncRecord[] }) {
  return <div className="form-grid"><Select label="Invoice" value={form.invoice_id ?? ""} options={["", ...invoices.map((row) => String(row.id))]} labels={labelsFor(invoices, "invoice_number")} onChange={(invoice_id) => setForm({ ...form, invoice_id })} /><label>Invoice ID<input value={form.invoice_id ?? ""} onChange={(event) => setForm({ ...form, invoice_id: event.target.value })} required /></label><label>Applied Amount<input type="number" step="0.01" value={form.applied_amount ?? ""} onChange={(event) => setForm({ ...form, applied_amount: event.target.value })} required /></label><Select label="Application Type" value={form.application_type ?? ""} options={["", ...applicationTypes]} onChange={(application_type) => setForm({ ...form, application_type })} /><label>Note<textarea value={form.note ?? ""} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><div className="warning-box">Available unapplied cash: {money(receipt.unapplied_amount)}. Active applications: {activeApplications(applications)}. Overpayments remain unapplied by default.</div></div>;
}

function ReceiptFormFields({ form, setForm, related, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeCreate?: boolean; disabled?: boolean }) {
  return <div className="form-grid">{includeCreate ? <label>Gross Received Amount<input disabled={disabled} type="number" step="0.01" value={form.gross_received_amount ?? ""} onChange={(event) => setForm({ ...form, gross_received_amount: event.target.value })} required /></label> : null}<label>Payment Date<input disabled={disabled} type="date" value={form.payment_date ?? ""} onChange={(event) => setForm({ ...form, payment_date: event.target.value })} required={includeCreate} /></label><Select label="Payment Method" value={form.payment_method ?? ""} options={includeCreate ? paymentMethods : ["", ...paymentMethods]} onChange={(payment_method) => setForm({ ...form, payment_method })} disabled={disabled} /><Select label="Customer" value={form.customer_organization_id ?? ""} options={["", ...related.customers.map((row) => String(row.id))]} labels={labelsFor(related.customers)} onChange={(customer_organization_id) => setForm({ ...form, customer_organization_id })} disabled={disabled} /><label>Payer Name<input disabled={disabled} value={form.payer_name ?? ""} onChange={(event) => setForm({ ...form, payer_name: event.target.value })} /></label><label>Payment Reference<input disabled={disabled} value={form.payment_reference ?? ""} onChange={(event) => setForm({ ...form, payment_reference: event.target.value })} /></label><label>External Transaction ID<input disabled={disabled} value={form.external_transaction_id ?? ""} onChange={(event) => setForm({ ...form, external_transaction_id: event.target.value })} /></label>{includeCreate ? <><label>Currency<input disabled={disabled} value={form.currency ?? "USD"} onChange={(event) => setForm({ ...form, currency: event.target.value })} /></label><Select label="Source Type" value={form.source_type ?? "manual"} options={sourceTypes} onChange={(source_type) => setForm({ ...form, source_type })} disabled={disabled} /></> : null}<label>Evidence Reference<input disabled={disabled} value={form.evidence_reference ?? ""} onChange={(event) => setForm({ ...form, evidence_reference: event.target.value })} /></label><label>Notes<textarea disabled={disabled} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><label>Override Reasons JSON<textarea disabled={disabled} value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label></div>;
}

function SessionPanel({ session }: { session: Session }) {
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test cash application actions.</p></div><button type="button" onClick={session.applyDefaults}>Use cash defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>([]);
  useEffect(() => {
    setTokenState(readToken());
    setPermissionsState(readPermissions().length ? readPermissions() : cashDefaultPermissions);
  }, []);
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  return { token, permissions, setToken, setPermissions, applyDefaults: () => setPermissions(cashDefaultPermissions) };
}

async function loadRelated(token: string): Promise<RelatedData> {
  const [customers, invoices] = await Promise.all([
    optionalList("/organizations", token),
    optionalList("/invoices?cash_application_status=ready_for_cash_application&archived=false", token),
  ]);
  return { customers, invoices };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function buildReceiptCreatePayload(form: Record<string, string>) {
  return prune({ gross_received_amount: form.gross_received_amount, payment_date: form.payment_date, payment_method: form.payment_method, customer_organization_id: form.customer_organization_id, payer_name: form.payer_name, payment_reference: form.payment_reference, external_transaction_id: form.external_transaction_id, currency: form.currency, source_type: form.source_type, evidence_reference: form.evidence_reference, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
}

function buildReceiptPatchPayload(form: Record<string, string>) {
  return prune({ customer_organization_id: form.customer_organization_id, payer_name: form.payer_name, payment_reference: form.payment_reference, external_transaction_id: form.external_transaction_id, payment_method: form.payment_method, payment_date: form.payment_date, evidence_reference: form.evidence_reference, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
}

function applyPayload(form: Record<string, string>) {
  return prune({ invoice_id: form.invoice_id, applied_amount: form.applied_amount, application_type: form.application_type, note: form.note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
}

function receiptActionPayload(type: string, form: Record<string, string>) {
  if (type === "void_receipt") return prune({ void_reason: form.void_reason, void_note: form.void_note });
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
}

function applicationActionPayload(type: string, form: Record<string, string>) {
  if (type === "void_application") return prune({ void_reason: form.void_reason, void_note: form.void_note });
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
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

function Select({ label, value, options, labels = {}, onChange, disabled = false }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? (option ? formatAction(option) : "Any")}</option>)}</select></label>;
}

function ObjectTable({ rows, columns }: { rows: SyncRecord[]; columns: string[] }) {
  if (!rows.length) return <div className="empty-state">No records returned.</div>;
  return <div className="wide-table"><table><thead><tr>{columns.map((column) => <th key={column}>{formatAction(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.event_id ?? row.audit_id ?? index)}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div>;
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

function buildReceiptSummary(rows: SyncRecord[]) {
  const status = Object.fromEntries(receiptStatuses.map((item) => [item, 0]));
  const method = Object.fromEntries(paymentMethods.map((item) => [item, 0]));
  for (const row of rows) {
    status[String(row.receipt_status)] = (status[String(row.receipt_status)] ?? 0) + 1;
    method[String(row.payment_method)] = (method[String(row.payment_method)] ?? 0) + 1;
  }
  return { total: rows.length, status, method, balanceRemaining: rows.filter((row) => numberValue(row.unapplied_amount, 0) > 0).length };
}

function receiptMatches(row: SyncRecord, filters: Record<string, string>) {
  if (filters.has_unapplied && boolMismatch(numberValue(row.unapplied_amount, 0) > 0, filters.has_unapplied)) return false;
  return true;
}

function paymentApplicationMatches(_row: SyncRecord, _filters: Record<string, string>) {
  return true;
}

function sortReceipts(rows: SyncRecord[], sort = "updated_desc") {
  return [...rows].sort((a, b) => {
    if (sort === "payment_date_desc") return dateTime(b.payment_date) - dateTime(a.payment_date);
    if (sort === "payment_date_asc") return dateTime(a.payment_date) - dateTime(b.payment_date);
    if (sort === "amount_desc") return numberValue(b.gross_received_amount, -1) - numberValue(a.gross_received_amount, -1);
    if (sort === "unapplied_desc") return numberValue(b.unapplied_amount, -1) - numberValue(a.unapplied_amount, -1);
    if (sort === "receipt_number") return String(a.receipt_number ?? "").localeCompare(String(b.receipt_number ?? ""));
    const unappliedPriority = Number(numberValue(b.unapplied_amount, 0) > 0) - Number(numberValue(a.unapplied_amount, 0) > 0);
    if (unappliedPriority) return unappliedPriority;
    const partialPriority = Number(b.receipt_status === "partially_applied") - Number(a.receipt_status === "partially_applied");
    if (partialPriority) return partialPriority;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function receiptChecklist(receipt: SyncRecord, applications: SyncRecord[]): [string, boolean][] {
  return [["Receipt exists", Boolean(receipt.id)], ["Customer context reviewed", Boolean(receipt.customer_organization_id) || Boolean(receipt.payer_name)], ["Gross amount captured", numberValue(receipt.gross_received_amount, 0) > 0], ["Applications visible", applications.length >= 0], ["Invoice balances changed only by applications", true], ["Unapplied cash tracked", receipt.unapplied_amount !== undefined], ["No bank transaction created", true], ["No payroll or contractor payment created", true]];
}

function cashReceiptRecord(detail: CashReceiptDetailShape): SyncRecord {
  return detail.cash_receipt ?? (detail as SyncRecord);
}

function activeApplications(applications: SyncRecord[]) {
  return applications.filter((row) => !applicationInactive(row)).length;
}

function applicationInactive(application: SyncRecord) {
  return ["voided", "archived"].includes(String(application.application_status));
}

function receiptViewOnly(receipt: SyncRecord) {
  return ["voided", "archived"].includes(String(receipt.receipt_status));
}

function boolMismatch(actual: boolean, expected: string) {
  return (expected === "true" && !actual) || (expected === "false" && actual);
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
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.invoice_number ?? row.receipt_number, String(row.id))]));
}

function modalTitle(type: string) {
  if (type === "void_receipt") return "Void Receipt";
  if (type === "archive_receipt") return "Archive Receipt";
  if (type === "void_application") return "Void Payment Application";
  if (type === "archive_application") return "Archive Payment Application";
  return "Apply To Invoice";
}

function actionNotice(type: string) {
  if (type === "apply") return "Payment applied to invoice through backend route. Invoice balance impact is visible; no bank or payroll record was created.";
  if (type === "void_application") return "Payment application voided and invoice balance reversed through backend route.";
  return "Cash Application action completed.";
}

function cashReceiptLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/cash/receipts/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function invoiceLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/invoices/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function organizationLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/intelligence/organizations/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function plainError(message: string) {
  if (!message) return "Cash Application action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("cash receipt not found")) return "Receipt not found or no access.";
  if (message.includes("invoice not found")) return "Invoice not found or no access.";
  if (message.includes("unapplied")) return "Applied amount exceeds available unapplied cash.";
  if (message.includes("overpayment") || message.includes("balance")) return "Applied amount exceeds invoice balance.";
  if (message.includes("customer")) return "Customer mismatch requires override.";
  if (message.includes("disputed")) return "Disputed invoice requires override.";
  if (message.includes("void")) return "Void reason required.";
  if (message.includes("archive")) return "Archive reason required.";
  return message;
}

const cashDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "invoice.read",
  "invoice.cash_application.read",
  "invoice.cash_application.update",
  "cash_receipt.read",
  "cash_receipt.create",
  "cash_receipt.update",
  "cash_receipt.apply",
  "cash_receipt.void",
  "cash_receipt.archive",
  "cash_receipt.timeline.read",
  "cash_receipt.audit.read",
  "payment_application.read",
  "payment_application.create",
  "payment_application.void",
  "payment_application.archive",
  "payment_application.timeline.read",
  "payment_application.audit.read",
  "organization.read",
];

const emptyRelated: RelatedData = { customers: [], invoices: [] };
