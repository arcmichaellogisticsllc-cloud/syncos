"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell, ObjectTable, Panel } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";
import { DetailBoundaryNotice, DetailNextActionCard, FormBoundaryNotice, FormPurposeHeader, FormSection, ReadOnlyBanner, RequiredFieldNote } from "../operator-page-templates";

const exportTypes = ["invoices", "cash_receipts", "payment_applications", "contractor_payables", "payroll", "payment_execution", "bank_reconciliation", "mixed_later", "correction", "reversal"];
const targetSystems = ["quickbooks_later", "sage_later", "netsuite_later", "generic_csv", "generic_json", "manual_export", "other"];
const exportFormats = ["csv", "json", "manual_summary", "api_payload_later", "iif_later"];
const batchStatuses = ["draft", "assembling", "ready_for_review", "under_review", "approved", "generated", "submitted_later", "accepted_later", "rejected_later", "failed", "cancelled", "archived"];
const approvalStatuses = ["not_submitted", "pending", "approved", "rejected", "withdrawn"];
const exportStatuses = ["not_generated", "generated", "submitted_later", "accepted_later", "rejected_later", "failed", "cancelled"];
const sourceObjectTypes = ["invoice", "invoice_item", "cash_receipt", "payment_application", "contractor_payable", "contractor_payable_item", "payroll_run", "payroll_item", "payment_batch", "payment_item", "bank_transaction", "reconciliation_match"];
const exportItemTypes = ["revenue", "receivable", "cash_receipt", "unapplied_cash", "payable", "payroll_expense", "payment", "bank_transaction", "reconciliation", "fee", "adjustment", "correction", "reversal"];
const itemExportStatuses = ["pending", "generated", "submitted_later", "accepted_later", "rejected_later", "failed", "cancelled", "archived"];
const mappingStatuses = ["unmapped", "mapped", "mapping_warning", "mapping_error", "override_mapped"];
const tabs = ["overview", "export_items", "source_summary", "mapping_status", "target_system", "export_format", "totals", "review_approval", "generate", "submission_acceptance", "failure_retry", "timeline", "audit", "future_quickbooks", "future_erp", "future_gl", "future_tax", "future_accounting_close", "future_file_download"];

type Session = ReturnType<typeof useSession>;

type DetailShape = {
  accounting_export_batch?: SyncRecord;
  accounting_export_items?: SyncRecord[];
  source_summary?: SyncRecord | SyncRecord[];
  mapping_summary?: SyncRecord;
  export_summary?: SyncRecord;
  error_summary?: SyncRecord;
  approval_summary?: SyncRecord;
  boundary_summary?: SyncRecord;
  warnings?: unknown[];
  blockers?: unknown[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  invoices: SyncRecord[];
  cashReceipts: SyncRecord[];
  paymentApplications: SyncRecord[];
  contractorPayables: SyncRecord[];
  payrollRuns: SyncRecord[];
  paymentBatches: SyncRecord[];
  bankTransactions: SyncRecord[];
  reconciliationMatches: SyncRecord[];
};

const emptyRelated: RelatedData = { invoices: [], cashReceipts: [], paymentApplications: [], contractorPayables: [], payrollRuns: [], paymentBatches: [], bankTransactions: [], reconciliationMatches: [] };

type ExportQueueKey = "draft" | "submitted" | "approved" | "markedSubmitted" | "accepted" | "canceled" | "itemsAttention" | "archived";

const exportQueueDefinitions: Array<{ key: ExportQueueKey; label: string; helper: string; empty: string }> = [
  { key: "draft", label: "Draft", helper: "Export batches still being prepared.", empty: "No draft accounting exports need attention." },
  { key: "submitted", label: "Submitted for Review", helper: "Export batches waiting for accounting review.", empty: "No accounting export batches are waiting for review." },
  { key: "approved", label: "Approved", helper: "Export batches approved internally but not yet marked submitted.", empty: "No approved exports are waiting to be marked submitted." },
  { key: "markedSubmitted", label: "Marked Submitted", helper: "Export batches recorded as submitted manually or externally.", empty: "No submitted exports in this queue." },
  { key: "accepted", label: "Accepted", helper: "Export batches recorded as accepted by an external/manual accounting process.", empty: "No accepted exports in this queue." },
  { key: "canceled", label: "Canceled", helper: "Export batches canceled inside SyncOS.", empty: "No canceled exports in this queue." },
  { key: "itemsAttention", label: "Items Need Attention", helper: "Export items archived, blocked, rejected, or requiring review if supported by current data.", empty: "No accounting export items need attention." },
  { key: "archived", label: "Archived", helper: "Closed or removed export records.", empty: "No archived export records in this queue." },
];

export function AccountingExportQueue() {
  const session = useSession();
  const [rows, setRows] = useState<SyncRecord[]>([]);
  const [exportItems, setExportItems] = useState<SyncRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ archived: "false", sort: "updated_desc" });
  const [activeQueue, setActiveQueue] = useState<ExportQueueKey>("submitted");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const batches = await syncosFetch<SyncRecord[]>(`/accounting-export-batches?${accountingExportQuery(filters).toString()}`, { token: session.token });
      setRows(batches);
      const items = (await Promise.all(batches.slice(0, 25).map((batch) => optionalList(`/accounting-export-batches/${batch.id}/items`, session.token)))).flat();
      setExportItems(items);
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

  const visible = useMemo(() => sortBatches(rows.filter((row) => exportQueueMatches(row, activeQueue)), filters.sort), [rows, activeQueue, filters.sort]);
  const visibleItems = useMemo(() => exportItems.filter((item) => exportItemNeedsAttention(item) || activeQueue === "itemsAttention"), [exportItems, activeQueue]);
  const selectedQueue = exportQueueDefinitions.find((queue) => queue.key === activeQueue) ?? exportQueueDefinitions[1];

  function selectQueue(queue: ExportQueueKey) {
    setActiveQueue(queue);
    setFilters({ ...filters, archived: queue === "archived" ? "true" : "false", status: "", approval_status: "", export_status: "" });
  }

  return (
    <AccountingExportShell title="Accounting Export Workbench" purpose="Prepare and track internal accounting handoff batches and export items without posting to QuickBooks, ERP, GL, tax, payroll, or banking systems.">
      <SessionPanel session={session} />
      <div className="warning-box">Accounting Export prepares internal accounting handoff status only. SyncOS does not post to QuickBooks, ERP, GL, tax systems, payroll systems, banks, or accounting close.</div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {!session.token ? <div className="empty-state">Login required. Authentication is required before this workspace can load.</div> : null}
      {loading ? <div className="empty-state">Loading accounting exports...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Today&apos;s accounting handoff work</h2>
                <p className="muted">Review export batches, mark manual/external submission and acceptance, and inspect item attention without posting to accounting systems.</p>
              </div>
              <Link className="primary-button" href="/accounting-exports/new" aria-disabled={!hasPermission(session.permissions, "accounting_export_batch.create")}>Create Accounting Export Batch</Link>
            </div>
            <div className="summary-grid">
              {exportQueueDefinitions.map((queue) => <SummaryCard key={queue.key} label={queue.label} value={countExportQueue(rows, exportItems, queue.key)} helper={queue.helper} active={activeQueue === queue.key} onClick={() => selectQueue(queue.key)} />)}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Accounting export queues</h2>
                <p className="muted">{selectedQueue.helper}</p>
              </div>
              <button type="button" onClick={() => { setActiveQueue("submitted"); setFilters({ archived: "false", sort: "updated_desc" }); }}>Reset</button>
            </div>
            <div className="tab-row" role="tablist" aria-label="Accounting export queues">
              {exportQueueDefinitions.map((queue) => <button key={queue.key} type="button" role="tab" aria-selected={activeQueue === queue.key} onClick={() => selectQueue(queue.key)}>{queue.label}</button>)}
            </div>
            <details className="filter-drawer">
              <summary>Advanced filters</summary>
              <div className="tab-row">
                {["invoices", "cash_receipts", "contractor_payables", "payroll", "payment_execution", "bank_reconciliation"].map((export_type) => <button key={export_type} type="button" onClick={() => setFilters({ ...filters, export_type })}>{formatAction(export_type)}</button>)}
                {["generic_csv", "generic_json", "manual_export"].map((target_system) => <button key={target_system} type="button" onClick={() => setFilters({ ...filters, target_system })}>{formatAction(target_system)}</button>)}
                <button type="button" onClick={() => setFilters({ ...filters, has_mapping_errors: "true" })}>Mapping Errors</button>
              </div>
              <div className="filter-grid">
                <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search batch, target, account, reference, error" />
                <Select label="Export Type" value={filters.export_type ?? ""} options={["", ...exportTypes]} onChange={(export_type) => setFilters({ ...filters, export_type })} />
                <Select label="Target System" value={filters.target_system ?? ""} options={["", ...targetSystems]} onChange={(target_system) => setFilters({ ...filters, target_system })} />
                <Select label="Export Format" value={filters.export_format ?? ""} options={["", ...exportFormats]} onChange={(export_format) => setFilters({ ...filters, export_format })} />
                <Select label="Status" value={filters.status ?? ""} options={["", ...batchStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
                <Select label="Approval Status" value={filters.approval_status ?? ""} options={["", ...approvalStatuses]} onChange={(approval_status) => setFilters({ ...filters, approval_status })} />
                <Select label="Export Status" value={filters.export_status ?? ""} options={["", ...exportStatuses]} onChange={(export_status) => setFilters({ ...filters, export_status })} />
                <label>Period Start From<input type="date" value={filters.period_start_from ?? ""} onChange={(event) => setFilters({ ...filters, period_start_from: event.target.value })} /></label>
                <label>Period End To<input type="date" value={filters.period_end_to ?? ""} onChange={(event) => setFilters({ ...filters, period_end_to: event.target.value })} /></label>
                <label>Submitted From<input type="date" value={filters.submitted_from ?? ""} onChange={(event) => setFilters({ ...filters, submitted_from: event.target.value })} /></label>
                <label>Accepted To<input type="date" value={filters.accepted_to ?? ""} onChange={(event) => setFilters({ ...filters, accepted_to: event.target.value })} /></label>
                <Select label="Has Errors" value={filters.has_errors ?? ""} options={["", "true", "false"]} onChange={(has_errors) => setFilters({ ...filters, has_errors })} />
                <Select label="Has Mapping Errors" value={filters.has_mapping_errors ?? ""} options={["", "true", "false"]} onChange={(has_mapping_errors) => setFilters({ ...filters, has_mapping_errors })} />
                <Select label="Archived" value={filters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setFilters({ ...filters, archived })} />
                <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "period_end_desc", "amount_desc", "error_count_desc", "status", "export_batch_number"]} labels={{ updated_desc: "Recently Updated", period_end_desc: "Period End Newest", amount_desc: "Total Amount Highest", error_count_desc: "Error Count Highest", status: "Status", export_batch_number: "Export Batch Number" }} onChange={(sort) => setFilters({ ...filters, sort })} />
              </div>
            </details>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{selectedQueue.label}</h2>
                <p className="muted">Submitted and accepted states record manual/external handoff status only. SyncOS does not verify or post external accounting entries.</p>
              </div>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No accounting export batches yet. Create a batch and add source objects as export items.</div> : visible.length ? <AccountingExportBatchTable rows={visible} /> : <div className="empty-state">{selectedQueue.empty}</div>}
          </section>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Accounting Export Item Visibility</h2>
                <p className="muted">Shows export items needing attention from the loaded export batch population. Item actions remain on batch or item detail pages.</p>
              </div>
              <span>{visibleItems.length} items needing attention</span>
            </div>
            {visibleItems.length ? <AccountingExportItemVisibilityTable rows={visibleItems} /> : <div className="empty-state">No accounting export items need attention.</div>}
          </section>
          <FuturePlaceholders />
        </>
      ) : null}
    </AccountingExportShell>
  );
}

export function AccountingExportCreate() {
  const router = useRouter();
  const session = useSession();
  const [form, setForm] = useState<Record<string, string>>({ export_type: "invoices", target_system: "manual_export", export_format: "manual_summary", currency: "USD" });
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/accounting-export-batches", { method: "POST", body: createPayload(form), token: session.token });
      router.push(`/accounting-exports/${createdId(created)}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <AccountingExportShell title="Create Accounting Export Batch" purpose="Create an export batch shell without QuickBooks, ERP, GL, tax, payment, bank transaction, file download, or source mutation activity.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <FormPurposeHeader title="Create Accounting Export Batch" purpose="Create an internal accounting handoff batch for review." afterSave="the export batch opens in detail view so accounting can add items, generate, approve, mark submitted, or mark accepted." />
        <RequiredFieldNote>Export type, target system, and export format are required to create a batch shell.</RequiredFieldNote>
        <FormBoundaryNotice>Create Accounting Export does not post to QuickBooks, ERP, GL, tax systems, banks, payroll systems, or accounting close.</FormBoundaryNotice>
        <div className="warning-box">Backend validation is authoritative. Creating an export batch does not call QuickBooks or ERP APIs, post GL entries, create tax filings, create payments, create bank transactions, mutate source records, or generate downloadable files.</div>
        <FormSection title="Export setup" description="Choose the internal handoff scope and format. Source records are attached later through explicit export item actions.">
          <BatchFormFields form={form} setForm={setForm} includeCreate />
        </FormSection>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "accounting_export_batch.create")}>Create Accounting Export Batch</button>
          <Link className="link-button" href="/accounting-exports">Cancel</Link>
        </div>
      </form>
    </AccountingExportShell>
  );
}

export function AccountingExportEdit({ accountingExportBatchId }: { accountingExportBatchId: string }) {
  const router = useRouter();
  const session = useSession();
  const [record, setRecord] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const next = await syncosFetch<SyncRecord>(`/accounting-export-batches/${accountingExportBatchId}`, { token: session.token });
        setRecord(next);
        setForm({ period_start: dateInput(next.period_start), period_end: dateInput(next.period_end), target_system: String(next.target_system ?? ""), export_format: String(next.export_format ?? ""), currency: String(next.currency ?? ""), notes: String(next.notes ?? ""), override_reasons: jsonText(next.override_reasons) });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, accountingExportBatchId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/accounting-export-batches/${accountingExportBatchId}`, { method: "PATCH", body: patchPayload(form), token: session.token });
      router.push(`/accounting-exports/${accountingExportBatchId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  const readonly = ["accepted_later", "archived"].includes(String(record?.status));
  return (
    <AccountingExportShell title="Edit Accounting Export Batch" purpose="Edit export preparation context without external API submission, GL posting, tax filing, payment creation, bank transaction creation, or source mutation.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Accounting export batch not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Status transitions use lifecycle actions. This form cannot call external APIs, post GL, generate taxes, create payments, create bank transactions, or mutate source records.</div>
          <BatchFormFields form={form} setForm={setForm} disabled={readonly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readonly || !hasPermission(session.permissions, "accounting_export_batch.update")}>Save Accounting Export Batch</button>
            <Link className="link-button" href={`/accounting-exports/${accountingExportBatchId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </AccountingExportShell>
  );
}

export function AccountingExportDetail({ accountingExportBatchId }: { accountingExportBatchId: string }) {
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
        syncosFetch<DetailShape>(`/accounting-export-batches/${accountingExportBatchId}/detail`, { token: session.token }),
        loadRelated(session.token),
      ]);
      const [timeline, audit] = await Promise.all([
        optionalList(`/accounting-export-batches/${accountingExportBatchId}/timeline`, session.token),
        optionalList(`/accounting-export-batches/${accountingExportBatchId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
      setRelated(nextRelated);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, accountingExportBatchId]);

  const batch = detail?.accounting_export_batch;
  const items = detail?.accounting_export_items ?? [];

  function openAction(type: string, item?: SyncRecord) {
    setSelectedItem(item ?? null);
    setModal(type);
  }

  return (
    <AccountingExportShell title="Accounting Export Batch Detail" purpose="Show export preparation truth without creating external accounting, GL, tax, payment, bank, file download, or source-mutation workflows.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Accounting Export Detail.</div> : null}
      {!batch && session.token && !error ? <div className="empty-state">Accounting export batch not found or no access.</div> : null}
      {batch && detail ? (
        <>
          {!hasPermission(session.permissions, "accounting_export_batch.update") ? <ReadOnlyBanner /> : null}
          <DetailNextActionCard
            variant="finance"
            status={formatAction(batch.status)}
            nextActionLabel={exportBatchNextAction(batch)}
            helperText="Review batch items, mapping state, approval, submission, acceptance, and errors before recording the next accounting handoff step."
            disabled={!hasPermission(session.permissions, "accounting_export_batch.update")}
            disabledReason="Read-only users cannot perform lifecycle actions."
            boundaryText="Accounting Export prepares internal handoff status only. SyncOS does not post to QuickBooks, ERP, GL, tax systems, payroll systems, banks, or accounting close."
          />
          <DetailBoundaryNotice>Accounting Export prepares internal handoff status only. SyncOS does not post to QuickBooks, ERP, GL, tax systems, payroll systems, banks, or accounting close.</DetailBoundaryNotice>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(batch.export_batch_number, "Accounting Export Batch")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(batch.export_type)}</span>
                  <span className="badge">{formatAction(batch.target_system)}</span>
                  <span className="badge">{formatAction(batch.export_format)}</span>
                  <span className="badge">{formatAction(batch.status)}</span>
                  <span className="badge">{formatAction(batch.approval_status)}</span>
                  <span className="badge">{formatAction(batch.export_status)}</span>
                  <span className="badge">{formatAction(batch.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/accounting-exports/${accountingExportBatchId}/edit`} aria-disabled={!hasPermission(session.permissions, "accounting_export_batch.update")}>Edit Batch</Link>
                <ActionButton permission="accounting_export_batch.add_item" session={session} disabled={batchInactive(batch)} onClick={() => openAction("add_item")}>Add Export Item</ActionButton>
                <ActionButton permission="accounting_export_batch.update" session={session} disabled={batchInactive(batch)} onClick={() => openAction("recalculate")}>Recalculate Totals</ActionButton>
                <ActionButton permission="accounting_export_batch.generate" session={session} disabled={batchArchived(batch)} onClick={() => openAction("generate")}>Generate</ActionButton>
                <ActionButton permission="accounting_export_batch.submit_review" session={session} disabled={batchArchived(batch)} onClick={() => openAction("submit_review")}>Submit Review</ActionButton>
                <ActionButton permission="accounting_export_batch.start_review" session={session} disabled={batchArchived(batch)} onClick={() => openAction("start_review")}>Start Review</ActionButton>
                <ActionButton permission="accounting_export_batch.approve" session={session} disabled={batchArchived(batch)} onClick={() => openAction("approve")}>Approve</ActionButton>
                <ActionButton permission="accounting_export_batch.reject" session={session} disabled={batchArchived(batch)} onClick={() => openAction("reject")}>Reject</ActionButton>
                <ActionButton permission="accounting_export_batch.mark_submitted" session={session} disabled={batchArchived(batch)} onClick={() => openAction("mark_submitted")}>Mark Submitted</ActionButton>
                <ActionButton permission="accounting_export_batch.mark_accepted" session={session} disabled={batchArchived(batch)} onClick={() => openAction("mark_accepted")}>Mark Accepted</ActionButton>
                <ActionButton permission="accounting_export_batch.mark_failed" session={session} disabled={batchArchived(batch)} onClick={() => openAction("mark_failed")}>Mark Failed</ActionButton>
                <ActionButton permission="accounting_export_batch.cancel" session={session} disabled={batch.status === "accepted_later" || batch.status === "archived"} onClick={() => openAction("cancel")}>Cancel</ActionButton>
                <ActionButton permission="accounting_export_batch.archive" session={session} disabled={batch.status === "archived"} onClick={() => openAction("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Item Count" value={formatCell(batch.item_count ?? items.length)} />
              <Metric label="Total Debit Amount" value={money(batch.total_debit_amount)} />
              <Metric label="Total Credit Amount" value={money(batch.total_credit_amount)} />
              <Metric label="Total Amount" value={money(batch.total_amount)} />
              <Metric label="Error Count" value={formatCell(batch.error_count)} />
              <Metric label="Retry Count" value={formatCell(batch.retry_count)} />
              <Metric label="Export Type" value={formatAction(batch.export_type)} />
              <Metric label="Target System" value={formatAction(batch.target_system)} />
              <Metric label="Export Format" value={formatAction(batch.export_format)} />
              <Metric label="Approval Status" value={formatAction(batch.approval_status)} />
              <Metric label="Export Status" value={formatAction(batch.export_status)} />
              <Metric label="Submitted At" value={dateValue(batch.submitted_at)} />
              <Metric label="Accepted At" value={dateValue(batch.accepted_at)} />
            </div>
            <div className="warning-box">Accounting Export packages facts for external accounting. It does not post GL entries, call QuickBooks or ERP APIs, create payments, create bank transactions, file taxes, mutate source records, or close accounting periods.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Export Type</dt><dd>{formatAction(batch.export_type)}</dd>
                <dt>Target System</dt><dd>{formatAction(batch.target_system)}</dd>
                <dt>Export Format</dt><dd>{formatAction(batch.export_format)}</dd>
                <dt>Status</dt><dd>{formatAction(batch.status)}</dd>
                <dt>Approval</dt><dd>{formatAction(batch.approval_status)}</dd>
                <dt>Export Status</dt><dd>{formatAction(batch.export_status)}</dd>
                <dt>Period</dt><dd>{dateValue(batch.period_start)} - {dateValue(batch.period_end)}</dd>
                <dt>Item Count</dt><dd>{formatCell(batch.item_count ?? items.length)}</dd>
                <dt>Mapping State</dt><dd>{mappingState(items)}</dd>
                <dt>Error State</dt><dd>{formatCell(batch.error_count)}</dd>
                <dt>Submission State</dt><dd>{formatAction(batch.export_status)}</dd>
              </dl>
              <Checklist items={exportChecklist(batch, items)} />
              <div className="warning-box">No GL entry, external API call, file download, payment, bank transaction, tax filing, W2/1099, source mutation, or accounting close is available here.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <AccountingExportTab tab={tab} detail={detail} batch={batch} items={items} session={session} onAction={openAction} />
            </section>
          </div>
          {modal ? <AccountingExportModal type={modal} accountingExportBatchId={accountingExportBatchId} batch={batch} item={selectedItem} related={related} session={session} onClose={() => { setModal(""); setSelectedItem(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </AccountingExportShell>
  );
}

export function AccountingExportItemDetail({ accountingExportItemId }: { accountingExportItemId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<SyncRecord | null>(null);
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      setDetail(await syncosFetch<SyncRecord>(`/accounting-export-items/${accountingExportItemId}/detail`, { token: session.token }));
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, accountingExportItemId]);

  const item = (detail?.accounting_export_item ?? detail) as SyncRecord | null;
  return (
    <AccountingExportShell title="Accounting Export Item Detail" purpose="Show export item source, mapping, status, error, and boundary context without item-level external export actions.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!item ? <div className="empty-state">Accounting export item not found or no access.</div> : (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(item.source_object_type, "Accounting Export Item")}</h2>
                <div className="badge-row"><span className="badge">{formatAction(item.export_item_type)}</span><span className="badge">{formatAction(item.export_status)}</span><span className="badge">{formatAction(item.mapping_status)}</span></div>
              </div>
              <div className="form-actions">
                <ActionButton permission="accounting_export_item.update" session={session} disabled={item.export_status === "archived"} onClick={() => setModal("edit_item")}>Edit Item</ActionButton>
                <ActionButton permission="accounting_export_item.archive" session={session} disabled={item.export_status === "archived"} onClick={() => setModal("archive_item")}>Archive Item</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Source Object" value={`${formatAction(item.source_object_type)} ${textValue(item.source_object_id)}`} />
              <Metric label="Mapping Status" value={formatAction(item.mapping_status)} />
              <Metric label="Export Status" value={formatAction(item.export_status)} />
              <Metric label="Amount" value={money(item.amount ?? item.debit_amount ?? item.credit_amount)} />
              <Metric label="Currency" value={textValue(item.currency)} />
            </div>
          </section>
          <div className="organization-layout">
            <Panel title="Accounting Export Item"><JsonBlock value={item} /></Panel>
            <Panel title="Context"><JsonBlock value={detail} /><div className="warning-box">No external export action is available at item level. This item does not create GL entries, payments, bank transactions, tax filings, external accounting records, or source mutations.</div></Panel>
          </div>
          {modal ? <AccountingExportModal type={modal} accountingExportBatchId={String(item.accounting_export_batch_id ?? "")} batch={{}} item={item} related={emptyRelated} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      )}
    </AccountingExportShell>
  );
}

function AccountingExportShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/accounting-exports", "Accounting Export Queue", "active"],
    ["/accounting-exports/new", "Create Accounting Export Batch", "active"],
    ["#detail", "Accounting Export Batch Detail", "placeholder"],
    ["#items", "Accounting Export Items", "placeholder"],
    ["#source", "Source Object Context", "placeholder"],
    ["#mapping", "Mapping Status", "placeholder"],
    ["#target", "Target System", "placeholder"],
    ["#format", "Export Format", "placeholder"],
    ["#totals", "Export Totals", "placeholder"],
    ["#review", "Review / Approval", "placeholder"],
    ["#generate", "Generate Status", "placeholder"],
    ["#submission", "Submission / Acceptance", "placeholder"],
    ["#failure", "Failure / Retry", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-qb", "Future QuickBooks", "placeholder"],
    ["#future-erp", "Future ERP", "placeholder"],
    ["#future-gl", "Future GL", "placeholder"],
    ["#future-tax", "Future Tax", "placeholder"],
    ["#future-close", "Future Accounting Close", "placeholder"],
    ["#future-file", "Future File Download", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Accounting Exports</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function AccountingExportBatchTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Export Batch", "Export Type / Scope", "Source Period", "Item Count", "Total Amount", "Review Status", "Submission Status", "Acceptance Status", "Created / Updated", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{batchLink(row.id, row.export_batch_number)}<div className="muted">{formatAction(row.export_format)} / {formatAction(row.target_system)}</div></td><td>{formatAction(row.export_type)}</td><td>{dateValue(row.period_start)} - {dateValue(row.period_end)}</td><td>{formatCell(row.item_count)}</td><td>{money(row.total_amount)}<div className="muted">{textValue(row.currency)}</div></td><td>{formatAction(row.status)}<div className="muted">{formatAction(row.approval_status)}</div></td><td>{formatAction(row.export_status)}<div className="muted">{dateValue(row.submitted_at)}</div></td><td>{dateValue(row.accepted_at)}<div className="muted">{textValue(row.external_batch_reference)}</div></td><td>{dateValue(row.created_at)}<div className="muted">{dateValue(row.updated_at)}</div></td><td>{exportBatchNextAction(row)}</td><td><Link className="table-link" href={`/accounting-exports/${row.id}`}>Open Detail</Link></td></tr>)}</tbody></table></div>;
}

function AccountingExportItemVisibilityTable({ rows }: { rows: SyncRecord[] }) {
  return <div className="wide-table"><table><thead><tr>{["Export Item", "Source Record Type", "Source Record", "Amount", "Item Status", "Export Batch", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{textValue(row.memo ?? row.export_item_type ?? row.id)}<div className="muted">{formatAction(row.export_item_type)}</div></td><td>{formatAction(row.source_object_type)}</td><td>{sourceLink(row)}</td><td>{money(row.amount ?? row.debit_amount ?? row.credit_amount)}<div className="muted">{textValue(row.currency)}</div></td><td>{formatAction(row.export_status)}<div className="muted">{formatAction(row.mapping_status)}</div></td><td>{batchLink(row.accounting_export_batch_id, row.accounting_export_batch_number ?? row.accounting_export_batch_id)}</td><td>{exportItemNextAction(row)}</td><td><Link className="table-link" href={`/accounting-export-items/${row.id}`}>Open Detail</Link></td></tr>)}</tbody></table></div>;
}

function AccountingExportTab({ tab, detail, batch, items, session, onAction }: { tab: string; detail: DetailShape; batch: SyncRecord; items: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Export batch number</dt><dd>{textValue(batch.export_batch_number)}</dd><dt>Export type</dt><dd>{formatAction(batch.export_type)}</dd><dt>Target system</dt><dd>{formatAction(batch.target_system)}</dd><dt>Export format</dt><dd>{formatAction(batch.export_format)}</dd><dt>Status</dt><dd>{formatAction(batch.status)}</dd><dt>Approval status</dt><dd>{formatAction(batch.approval_status)}</dd><dt>Export status</dt><dd>{formatAction(batch.export_status)}</dd><dt>Period</dt><dd>{dateValue(batch.period_start)} - {dateValue(batch.period_end)}</dd><dt>Generated file reference</dt><dd>{textValue(batch.generated_file_reference)}</dd><dt>External batch reference</dt><dd>{textValue(batch.external_batch_reference)}</dd><dt>Notes</dt><dd>{textValue(batch.notes)}</dd><dt>Override reasons</dt><dd><JsonBlock value={batch.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(batch.created_at)}</dd><dt>Updated</dt><dd>{dateValue(batch.updated_at)}</dd></dl><div className="warning-box">Accounting Export is a translation layer from SyncOS operational and financial workflow truth into external accounting systems. It does not create the ledger, post journals, file taxes, create payments, create bank transactions, close accounting periods, or mutate source records.</div></Panel>;
  if (tab === "export_items") return <Panel title="Export Items"><div className="form-actions"><ActionButton permission="accounting_export_batch.add_item" session={session} disabled={batchInactive(batch)} onClick={() => onAction("add_item")}>Add Export Item</ActionButton></div><ExportItemsTable rows={items} session={session} onAction={onAction} /><div className="warning-box">Adding export items creates no external export, source mutation, GL posting, payment, bank transaction, tax filing, or external accounting record.</div></Panel>;
  if (tab === "source_summary") return <Panel title="Source Summary"><SourceSummary rows={items} /><JsonBlock value={detail.source_summary} /><div className="warning-box">Source objects remain unchanged by Accounting Export.</div></Panel>;
  if (tab === "mapping_status") return <Panel title="Mapping Status"><MappingSummary items={items} /><ObjectTable rows={items.filter((item) => String(item.mapping_status).includes("mapping") || item.mapping_status === "unmapped")} columns={["source_object_type", "source_object_id", "export_item_type", "mapping_status", "target_account_code", "target_account_name", "target_entity_reference", "error_message"]} /><JsonBlock value={detail.mapping_summary} /><div className="warning-box">Mapping status prepares export data. It does not create external accounting records.</div></Panel>;
  if (tab === "target_system") return <Panel title="Target System"><dl className="detail-list"><dt>Target System</dt><dd>{formatAction(batch.target_system)}</dd><dt>Export Format</dt><dd>{formatAction(batch.export_format)}</dd><dt>External Batch Reference</dt><dd>{textValue(batch.external_batch_reference)}</dd><dt>Submitted At</dt><dd>{dateValue(batch.submitted_at)}</dd><dt>Accepted At</dt><dd>{dateValue(batch.accepted_at)}</dd><dt>Rejected At</dt><dd>{dateValue(batch.rejected_at)}</dd><dt>Rejection Reason</dt><dd>{textValue(batch.rejection_reason)}</dd></dl><div className="warning-box">{targetSystemMessage(batch.target_system)}</div></Panel>;
  if (tab === "export_format") return <Panel title="Export Format"><dl className="detail-list"><dt>Export Format</dt><dd>{formatAction(batch.export_format)}</dd><dt>Generated File Reference</dt><dd>{textValue(batch.generated_file_reference)}</dd><dt>Generated Status</dt><dd>{formatAction(batch.export_status)}</dd></dl><div className="warning-box">{formatMessage(batch.export_format)}</div></Panel>;
  if (tab === "totals") return <Panel title="Totals"><div className="summary-grid"><Metric label="Item Count" value={formatCell(batch.item_count ?? items.length)} /><Metric label="Total Debit Amount" value={money(batch.total_debit_amount)} /><Metric label="Total Credit Amount" value={money(batch.total_credit_amount)} /><Metric label="Total Amount" value={money(batch.total_amount)} /><Metric label="Currency" value={textValue(batch.currency)} /><Metric label="Error Count" value={formatCell(batch.error_count)} /><Metric label="Retry Count" value={formatCell(batch.retry_count)} /></div><div className="warning-box">Totals are export preparation totals only. SyncOS does not post GL entries or accounting journals.</div></Panel>;
  if (tab === "review_approval") return <Panel title="Review / Approval"><div className="form-actions"><ActionButton permission="accounting_export_batch.submit_review" session={session} disabled={batchArchived(batch)} onClick={() => onAction("submit_review")}>Submit Review</ActionButton><ActionButton permission="accounting_export_batch.start_review" session={session} disabled={batchArchived(batch)} onClick={() => onAction("start_review")}>Start Review</ActionButton><ActionButton permission="accounting_export_batch.approve" session={session} disabled={batchArchived(batch)} onClick={() => onAction("approve")}>Approve</ActionButton><ActionButton permission="accounting_export_batch.reject" session={session} disabled={batchArchived(batch)} onClick={() => onAction("reject")}>Reject</ActionButton></div><ObjectTable rows={[batch]} columns={["approval_status", "submitted_at", "submitted_by", "approved_at", "approved_by", "rejected_at", "rejected_by", "rejection_reason", "rejection_note"]} /><JsonBlock value={detail.approval_summary} /></Panel>;
  if (tab === "generate") return <Panel title="Generate"><div className="form-actions"><ActionButton permission="accounting_export_batch.generate" session={session} disabled={batchArchived(batch)} onClick={() => onAction("generate")}>Generate</ActionButton></div><ObjectTable rows={[batch]} columns={["export_status", "generated_file_reference", "error_count", "recommended_next_action"]} /><JsonBlock value={{ warnings: detail.warnings, blockers: detail.blockers }} /><div className="warning-box">Generate updates Accounting Export status only. It does not call QuickBooks, create a file download unless backend already supports metadata, post GL entries, or mutate source records.</div></Panel>;
  if (tab === "submission_acceptance") return <Panel title="Submission / Acceptance"><div className="form-actions"><ActionButton permission="accounting_export_batch.mark_submitted" session={session} disabled={batchArchived(batch)} onClick={() => onAction("mark_submitted")}>Mark Submitted</ActionButton><ActionButton permission="accounting_export_batch.mark_accepted" session={session} disabled={batchArchived(batch)} onClick={() => onAction("mark_accepted")}>Mark Accepted</ActionButton><ActionButton permission="accounting_export_batch.mark_failed" session={session} disabled={batchArchived(batch)} onClick={() => onAction("mark_failed")}>Mark Failed</ActionButton></div><ObjectTable rows={[batch]} columns={["export_status", "external_batch_reference", "submitted_at", "submitted_by", "accepted_at", "accepted_by", "rejected_at", "rejected_by", "rejection_reason"]} /><div className="warning-box">Mark Submitted and Mark Accepted record manual/status-only references. They do not call external accounting APIs.</div></Panel>;
  if (tab === "failure_retry") return <Panel title="Failure / Retry"><div className="form-actions"><ActionButton permission="accounting_export_batch.mark_failed" session={session} disabled={batchArchived(batch)} onClick={() => onAction("mark_failed")}>Mark Failed</ActionButton><ActionButton permission="accounting_export_batch.cancel" session={session} disabled={batchArchived(batch)} onClick={() => onAction("cancel")}>Cancel</ActionButton><ActionButton permission="accounting_export_batch.archive" session={session} disabled={batch.status === "archived"} onClick={() => onAction("archive")}>Archive</ActionButton></div><ObjectTable rows={[batch]} columns={["failure_reason", "failure_note", "error_count", "retry_count", "rejection_reason"]} /><ObjectTable rows={items.filter((item) => item.error_message || item.mapping_status === "mapping_error")} columns={["source_object_type", "export_item_type", "mapping_status", "error_message"]} /><div className="warning-box">Retry and correction are tracked through export status. No external accounting system is called from this workspace.</div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "created_at", "actor_user_id", "aggregate_type", "aggregate_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["action", "entity_type", "entity_id", "created_at", "actor_user_id"]} /> : <div className="empty-state">You do not have permission to view accounting export audit details.</div>}</Panel>;
  if (tab === "future_quickbooks") return <PlaceholderPanel title="Future QuickBooks" message="QuickBooks integration is not available in this sprint. This workspace does not call QuickBooks APIs or create QuickBooks records." columns={["integration", "status"]} />;
  if (tab === "future_erp") return <PlaceholderPanel title="Future ERP" message="Sage, NetSuite, and ERP integrations are not available in this sprint." columns={["integration", "status"]} />;
  if (tab === "future_gl") return <PlaceholderPanel title="Future GL" message="GL posting and journal creation are not available in this sprint. External accounting systems remain the ledger." columns={["gl_workflow", "status"]} />;
  if (tab === "future_tax") return <PlaceholderPanel title="Future Tax" message="Tax filing, W2, 1099, payroll tax, and sales/use tax workflows are not available in this sprint." columns={["tax_workflow", "status"]} />;
  if (tab === "future_accounting_close") return <PlaceholderPanel title="Future Accounting Close" message="Accounting close, trial balance, and financial statements are not available in this sprint." columns={["close_workflow", "status"]} />;
  return <PlaceholderPanel title="Future File Download" message="File download generation is not available unless the backend explicitly provides a generated file reference. This sprint does not create downloadable accounting files." columns={["file_workflow", "status"]} />;
}

function ExportItemsTable({ rows, session, onAction }: { rows: SyncRecord[]; session: Session; onAction: (type: string, item?: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No export items yet.</div>;
  return <div className="wide-table"><table><thead><tr>{["Source Object Type", "Source Object ID", "Export Item Type", "Export Status", "Mapping Status", "Target Account Code", "Target Account Name", "Target Entity Reference", "Target Item Reference", "Target Class Reference", "Target Location Reference", "Debit Amount", "Credit Amount", "Amount", "Currency", "Transaction Date", "External Reference", "Error Message", "Notes", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{formatAction(row.source_object_type)}</td><td>{sourceLink(row)}</td><td>{formatAction(row.export_item_type)}</td><td>{formatAction(row.export_status)}</td><td>{formatAction(row.mapping_status)}</td><td>{textValue(row.target_account_code)}</td><td>{textValue(row.target_account_name)}</td><td>{textValue(row.target_entity_reference)}</td><td>{textValue(row.target_item_reference)}</td><td>{textValue(row.target_class_reference)}</td><td>{textValue(row.target_location_reference)}</td><td>{money(row.debit_amount)}</td><td>{money(row.credit_amount)}</td><td>{money(row.amount)}</td><td>{textValue(row.currency)}</td><td>{dateValue(row.transaction_date)}</td><td>{textValue(row.external_reference)}</td><td>{textValue(row.error_message)}</td><td>{textValue(row.notes)}</td><td><div className="form-actions"><Link className="table-link" href={`/accounting-export-items/${row.id}`}>Open</Link><ActionButton permission="accounting_export_item.update" session={session} disabled={row.export_status === "archived"} onClick={() => onAction("edit_item", row)}>Edit</ActionButton><ActionButton permission="accounting_export_item.archive" session={session} disabled={row.export_status === "archived"} onClick={() => onAction("archive_item", row)}>Archive</ActionButton></div></td></tr>)}</tbody></table></div>;
}

function AccountingExportModal({ type, accountingExportBatchId, batch, item, related, session, onClose, onSaved }: { type: string; accountingExportBatchId: string; batch: SyncRecord; item: SyncRecord | null; related: RelatedData; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>(type === "edit_item" ? prefillItemForm(item) : {});
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const { path, body } = modalRequest(type, accountingExportBatchId, item, form);
      await syncosFetch(path, { method: "POST", body, token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  async function submitPatch(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/accounting-export-items/${item?.id}`, { method: "PATCH", body: itemPatchPayload(form), token: session.token });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  const isPatch = type === "edit_item";
  return (
    <div className="modal-backdrop">
      <form className="modal-card" onSubmit={(event) => isPatch ? void submitPatch(event) : void submit(event)}>
        <div className="section-toolbar"><h2>{formatAction(type)}</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        {type === "add_item" ? <AddItemFields form={form} setForm={setForm} batch={batch} related={related} /> : null}
        {type === "edit_item" ? <ItemEditFields form={form} setForm={setForm} /> : null}
        {type === "generate" ? <><label>Generate Note<textarea value={form.generate_note ?? ""} onChange={(event) => setForm({ ...form, generate_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /><div className="warning-box">Generate updates Accounting Export status only. It does not call QuickBooks, create file downloads, post GL entries, or mutate source records.</div></> : null}
        {type === "approve" ? <><label>Approval Note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /></> : null}
        {type === "reject" ? <><label>Rejection Reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejection Note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {type === "mark_submitted" ? <><label>External Batch Reference<input value={form.external_batch_reference ?? ""} onChange={(event) => setForm({ ...form, external_batch_reference: event.target.value })} /></label><label>Submit Note<textarea value={form.submit_note ?? ""} onChange={(event) => setForm({ ...form, submit_note: event.target.value })} /></label><label>Submitted At<input type="datetime-local" value={form.submitted_at ?? ""} onChange={(event) => setForm({ ...form, submitted_at: event.target.value })} /></label><div className="warning-box">Mark Submitted records manual/external submission status only. It does not call an external accounting API.</div></> : null}
        {type === "mark_accepted" ? <><label>Acceptance Note<textarea value={form.acceptance_note ?? ""} onChange={(event) => setForm({ ...form, acceptance_note: event.target.value })} required /></label><label>External Batch Reference<input value={form.external_batch_reference ?? ""} onChange={(event) => setForm({ ...form, external_batch_reference: event.target.value })} /></label><label>Accepted At<input type="datetime-local" value={form.accepted_at ?? ""} onChange={(event) => setForm({ ...form, accepted_at: event.target.value })} /></label><div className="warning-box">Mark Accepted records manual acceptance status only.</div></> : null}
        {type === "mark_failed" ? <><label>Failure Reason<textarea value={form.failure_reason ?? ""} onChange={(event) => setForm({ ...form, failure_reason: event.target.value })} required /></label><label>Failure Note<textarea value={form.failure_note ?? ""} onChange={(event) => setForm({ ...form, failure_note: event.target.value })} /></label></> : null}
        {type === "cancel" ? <><label>Cancel Reason<textarea value={form.cancel_reason ?? ""} onChange={(event) => setForm({ ...form, cancel_reason: event.target.value })} required /></label><label>Cancel Note<textarea value={form.cancel_note ?? ""} onChange={(event) => setForm({ ...form, cancel_note: event.target.value })} /></label></> : null}
        {["archive", "archive_item"].includes(type) ? <ArchiveFields form={form} setForm={setForm} /> : null}
        {["recalculate", "submit_review", "start_review"].includes(type) ? <div className="warning-box">This lifecycle action uses the Accounting Export backend only. It creates no QuickBooks/ERP/API, GL, tax, payment, bank, file download, source mutation, or accounting close records.</div> : null}
        <div className="form-actions"><button className="primary-button" type="submit">Submit</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  );
}

function BatchFormFields({ form, setForm, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; includeCreate?: boolean; disabled?: boolean }) {
  return <div className="form-grid">{includeCreate ? <><Select label="Export Type" value={form.export_type ?? ""} options={["", ...exportTypes]} onChange={(export_type) => setForm({ ...form, export_type })} required disabled={disabled} /><Select label="Target System" value={form.target_system ?? ""} options={["", ...targetSystems]} onChange={(target_system) => setForm({ ...form, target_system })} required disabled={disabled} /><Select label="Export Format" value={form.export_format ?? ""} options={["", ...exportFormats]} onChange={(export_format) => setForm({ ...form, export_format })} required disabled={disabled} /></> : <><Select label="Target System" value={form.target_system ?? ""} options={["", ...targetSystems]} onChange={(target_system) => setForm({ ...form, target_system })} disabled={disabled} /><Select label="Export Format" value={form.export_format ?? ""} options={["", ...exportFormats]} onChange={(export_format) => setForm({ ...form, export_format })} disabled={disabled} /></>}<label>Period Start<input disabled={disabled} type="date" value={form.period_start ?? ""} onChange={(event) => setForm({ ...form, period_start: event.target.value })} /></label><label>Period End<input disabled={disabled} type="date" value={form.period_end ?? ""} onChange={(event) => setForm({ ...form, period_end: event.target.value })} /></label><label>Currency<input disabled={disabled} value={form.currency ?? ""} onChange={(event) => setForm({ ...form, currency: event.target.value })} /></label><label>Notes<textarea disabled={disabled} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /></div>;
}

function AddItemFields({ form, setForm, batch, related }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; batch: SyncRecord; related: RelatedData }) {
  const options = relatedOptions(form.source_object_type, related);
  return <div className="form-grid"><Select label="Source Object Type" value={form.source_object_type ?? ""} options={["", ...sourceObjectTypes]} onChange={(source_object_type) => setForm({ ...form, source_object_type, source_object_id: "" })} required /><Select label="Known Source Object" value={form.source_object_id ?? ""} options={["", ...options.map((row) => String(row.id))]} labels={labelsFor(options)} onChange={(source_object_id) => setForm({ ...form, source_object_id })} /><label>Source Object ID<input value={form.source_object_id ?? ""} onChange={(event) => setForm({ ...form, source_object_id: event.target.value })} required /></label><Select label="Export Item Type" value={form.export_item_type ?? ""} options={["", ...exportItemTypes]} onChange={(export_item_type) => setForm({ ...form, export_item_type })} required /><label>Target Account Code<input value={form.target_account_code ?? ""} onChange={(event) => setForm({ ...form, target_account_code: event.target.value })} /></label><label>Target Account Name<input value={form.target_account_name ?? ""} onChange={(event) => setForm({ ...form, target_account_name: event.target.value })} /></label><label>Target Entity Reference<input value={form.target_entity_reference ?? ""} onChange={(event) => setForm({ ...form, target_entity_reference: event.target.value })} /></label><label>Target Item Reference<input value={form.target_item_reference ?? ""} onChange={(event) => setForm({ ...form, target_item_reference: event.target.value })} /></label><label>Target Class Reference<input value={form.target_class_reference ?? ""} onChange={(event) => setForm({ ...form, target_class_reference: event.target.value })} /></label><label>Target Location Reference<input value={form.target_location_reference ?? ""} onChange={(event) => setForm({ ...form, target_location_reference: event.target.value })} /></label><label>Debit Amount<input type="number" step="0.01" value={form.debit_amount ?? ""} onChange={(event) => setForm({ ...form, debit_amount: event.target.value })} /></label><label>Credit Amount<input type="number" step="0.01" value={form.credit_amount ?? ""} onChange={(event) => setForm({ ...form, credit_amount: event.target.value })} /></label><label>Amount<input type="number" step="0.01" value={form.amount ?? ""} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label>Currency<input value={form.currency ?? String(batch.currency ?? "")} onChange={(event) => setForm({ ...form, currency: event.target.value })} /></label><label>Memo<textarea value={form.memo ?? ""} onChange={(event) => setForm({ ...form, memo: event.target.value })} /></label><label>Transaction Date<input type="date" value={form.transaction_date ?? ""} onChange={(event) => setForm({ ...form, transaction_date: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /><label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="warning-box">No external export, source mutation, GL posting, payment, bank transaction, tax filing, or accounting-system record is created.</div></div>;
}

function ItemEditFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <div className="form-grid"><Select label="Export Status" value={form.export_status ?? ""} options={["", ...itemExportStatuses]} onChange={(export_status) => setForm({ ...form, export_status })} /><Select label="Mapping Status" value={form.mapping_status ?? ""} options={["", ...mappingStatuses]} onChange={(mapping_status) => setForm({ ...form, mapping_status })} /><label>Target Account Code<input value={form.target_account_code ?? ""} onChange={(event) => setForm({ ...form, target_account_code: event.target.value })} /></label><label>Target Account Name<input value={form.target_account_name ?? ""} onChange={(event) => setForm({ ...form, target_account_name: event.target.value })} /></label><label>Target Entity Reference<input value={form.target_entity_reference ?? ""} onChange={(event) => setForm({ ...form, target_entity_reference: event.target.value })} /></label><label>Target Item Reference<input value={form.target_item_reference ?? ""} onChange={(event) => setForm({ ...form, target_item_reference: event.target.value })} /></label><label>Target Class Reference<input value={form.target_class_reference ?? ""} onChange={(event) => setForm({ ...form, target_class_reference: event.target.value })} /></label><label>Target Location Reference<input value={form.target_location_reference ?? ""} onChange={(event) => setForm({ ...form, target_location_reference: event.target.value })} /></label><label>Debit Amount<input type="number" step="0.01" value={form.debit_amount ?? ""} onChange={(event) => setForm({ ...form, debit_amount: event.target.value })} /></label><label>Credit Amount<input type="number" step="0.01" value={form.credit_amount ?? ""} onChange={(event) => setForm({ ...form, credit_amount: event.target.value })} /></label><label>Amount<input type="number" step="0.01" value={form.amount ?? ""} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label>Currency<input value={form.currency ?? ""} onChange={(event) => setForm({ ...form, currency: event.target.value })} /></label><label>Memo<textarea value={form.memo ?? ""} onChange={(event) => setForm({ ...form, memo: event.target.value })} /></label><label>Transaction Date<input type="date" value={form.transaction_date ?? ""} onChange={(event) => setForm({ ...form, transaction_date: event.target.value })} /></label><label>Error Message<textarea value={form.error_message ?? ""} onChange={(event) => setForm({ ...form, error_message: event.target.value })} /></label><OverrideField form={form} setForm={setForm} /><label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="warning-box">Export item edits update mapping/export preparation context only. No source records or external accounting systems are changed.</div></div>;
}

function OverrideField({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>;
}

function ArchiveFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></>;
}

function SourceSummary({ rows }: { rows: SyncRecord[] }) {
  const grouped = Object.values(rows.reduce<Record<string, SyncRecord>>((acc, item) => {
    const key = String(item.source_object_type ?? "unknown");
    const existing = acc[key] ?? { source_object_type: key, item_count: 0, total_amount: 0, mapped: 0, unmapped: 0, mapping_warning: 0, mapping_error: 0, pending: 0, generated: 0, failed: 0 };
    existing.item_count = numberValue(existing.item_count, 0) + 1;
    existing.total_amount = numberValue(existing.total_amount, 0) + numberValue(item.amount ?? item.debit_amount ?? item.credit_amount, 0);
    increment(existing as Record<string, number>, String(item.mapping_status ?? ""));
    increment(existing as Record<string, number>, String(item.export_status ?? ""));
    acc[key] = existing;
    return acc;
  }, {}));
  return <ObjectTable rows={grouped} columns={["source_object_type", "item_count", "total_amount", "mapped", "unmapped", "mapping_warning", "mapping_error", "pending", "generated", "failed"]} />;
}

function MappingSummary({ items }: { items: SyncRecord[] }) {
  const rows = mappingStatuses.map((status) => ({ mapping_status: status, count: items.filter((item) => item.mapping_status === status).length }));
  return <ObjectTable rows={rows} columns={["mapping_status", "count"]} />;
}

function FuturePlaceholders() {
  return <section className="workspace-panel"><h2>Future Workflow Placeholders</h2><div className="summary-grid"><Metric label="Future QuickBooks" value="QuickBooks integration is not available in this sprint." /><Metric label="Future ERP" value="Sage, NetSuite, and ERP integrations are not available." /><Metric label="Future GL" value="GL posting and journal creation are not available." /><Metric label="Future Tax" value="Tax filing, W2, 1099, payroll tax, and sales/use tax workflows are not available." /><Metric label="Future Accounting Close" value="Accounting close, trial balance, and financial statements are not available." /><Metric label="Future File Download" value="File download generation is not available unless the backend explicitly provides a generated file reference." /></div></section>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  const [token, setToken] = useState(session.token);
  const [permissionText, setPermissionText] = useState(session.permissions.join(", "));
  return <section className="workspace-panel"><div className="section-toolbar"><h2>API Session</h2><span>{session.permissions.length} permissions loaded</span></div><div className="session-grid"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" /><input value={permissionText} onChange={(event) => setPermissionText(event.target.value)} placeholder="Permissions, comma separated" /><button type="button" onClick={() => { saveToken(token); savePermissions(permissionText.split(",").map((item) => item.trim()).filter(Boolean)); window.location.reload(); }}>Save Session</button></div></section>;
}

function useSession() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>(accountingExportDefaultPermissions);
  useEffect(() => {
    const nextToken = readToken();
    setToken(nextToken);
    const stored = readPermissions();
    setPermissions(stored.length ? stored : accountingExportDefaultPermissions);
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

const accountingExportDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "accounting_export_batch.read",
  "accounting_export_batch.create",
  "accounting_export_batch.update",
  "accounting_export_batch.add_item",
  "accounting_export_batch.remove_item",
  "accounting_export_batch.generate",
  "accounting_export_batch.submit_review",
  "accounting_export_batch.start_review",
  "accounting_export_batch.approve",
  "accounting_export_batch.reject",
  "accounting_export_batch.mark_submitted",
  "accounting_export_batch.mark_accepted",
  "accounting_export_batch.mark_failed",
  "accounting_export_batch.cancel",
  "accounting_export_batch.archive",
  "accounting_export_batch.timeline.read",
  "accounting_export_batch.audit.read",
  "accounting_export_item.read",
  "accounting_export_item.create",
  "accounting_export_item.update",
  "accounting_export_item.archive",
  "invoice.read",
  "cash_receipt.read",
  "payment_application.read",
  "contractor_payable.read",
  "payroll_run.read",
  "payment_batch.read",
  "bank_transaction.read",
  "reconciliation_match.read",
];

async function loadRelated(token: string): Promise<RelatedData> {
  const [invoices, cashReceipts, paymentApplications, contractorPayables, payrollRuns, paymentBatches, bankTransactions, reconciliationMatches] = await Promise.all([
    optionalList("/invoices", token),
    optionalList("/cash-receipts", token),
    optionalList("/payment-applications", token),
    optionalList("/contractor-payables", token),
    optionalList("/payroll-runs", token),
    optionalList("/payment-batches", token),
    optionalList("/bank-transactions", token),
    optionalList("/reconciliation-matches", token),
  ]);
  return { invoices, cashReceipts, paymentApplications, contractorPayables, payrollRuns, paymentBatches, bankTransactions, reconciliationMatches };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function accountingExportQuery(filters: Record<string, string>) {
  const query = new URLSearchParams();
  query.set("archived", filters.archived === "true" ? "true" : "false");
  for (const key of ["export_type", "target_system", "export_format", "status", "approval_status", "export_status", "period_start_from", "period_end_to", "submitted_from", "accepted_to", "has_errors", "has_mapping_errors", "q"]) if (filters[key]) query.set(key, filters[key]);
  if (filters.sort) query.set("sort", filters.sort);
  return query;
}

function createPayload(form: Record<string, string>) {
  return prune({ export_type: form.export_type, target_system: form.target_system, export_format: form.export_format, period_start: form.period_start, period_end: form.period_end, currency: form.currency, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function patchPayload(form: Record<string, string>) {
  return prune({ period_start: form.period_start, period_end: form.period_end, target_system: form.target_system, export_format: form.export_format, currency: form.currency, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function addItemPayload(form: Record<string, string>) {
  return prune({ source_object_type: form.source_object_type, source_object_id: form.source_object_id, export_item_type: form.export_item_type, target_account_code: form.target_account_code, target_account_name: form.target_account_name, target_entity_reference: form.target_entity_reference, target_item_reference: form.target_item_reference, target_class_reference: form.target_class_reference, target_location_reference: form.target_location_reference, debit_amount: numericOrUndefined(form.debit_amount), credit_amount: numericOrUndefined(form.credit_amount), amount: numericOrUndefined(form.amount), currency: form.currency, memo: form.memo, transaction_date: form.transaction_date, override_reasons: parseJsonField(form.override_reasons, "Override Reasons"), notes: form.notes });
}

function itemPatchPayload(form: Record<string, string>) {
  return prune({ target_account_code: form.target_account_code, target_account_name: form.target_account_name, target_entity_reference: form.target_entity_reference, target_item_reference: form.target_item_reference, target_class_reference: form.target_class_reference, target_location_reference: form.target_location_reference, debit_amount: numericOrUndefined(form.debit_amount), credit_amount: numericOrUndefined(form.credit_amount), amount: numericOrUndefined(form.amount), currency: form.currency, memo: form.memo, transaction_date: form.transaction_date, mapping_status: form.mapping_status, error_message: form.error_message, override_reasons: parseJsonField(form.override_reasons, "Override Reasons"), notes: form.notes });
}

function modalRequest(type: string, batchId: string, item: SyncRecord | null, form: Record<string, string>) {
  if (type === "add_item") return { path: `/accounting-export-batches/${batchId}/items`, body: addItemPayload(form) };
  if (type === "recalculate") return { path: `/accounting-export-batches/${batchId}/recalculate-totals`, body: {} };
  if (type === "generate") return { path: `/accounting-export-batches/${batchId}/generate`, body: prune({ generate_note: form.generate_note, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") }) };
  if (type === "submit_review") return { path: `/accounting-export-batches/${batchId}/submit-review`, body: prune({ review_note: form.review_note }) };
  if (type === "start_review") return { path: `/accounting-export-batches/${batchId}/start-review`, body: prune({ review_note: form.review_note }) };
  if (type === "approve") return { path: `/accounting-export-batches/${batchId}/approve`, body: prune({ approval_note: form.approval_note, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") }) };
  if (type === "reject") return { path: `/accounting-export-batches/${batchId}/reject`, body: prune({ rejection_reason: form.rejection_reason, rejection_note: form.rejection_note }) };
  if (type === "mark_submitted") return { path: `/accounting-export-batches/${batchId}/mark-submitted`, body: prune({ external_batch_reference: form.external_batch_reference, submit_note: form.submit_note, submitted_at: form.submitted_at }) };
  if (type === "mark_accepted") return { path: `/accounting-export-batches/${batchId}/mark-accepted`, body: prune({ acceptance_note: form.acceptance_note, external_batch_reference: form.external_batch_reference, accepted_at: form.accepted_at }) };
  if (type === "mark_failed") return { path: `/accounting-export-batches/${batchId}/mark-failed`, body: prune({ failure_reason: form.failure_reason, failure_note: form.failure_note }) };
  if (type === "cancel") return { path: `/accounting-export-batches/${batchId}/cancel`, body: prune({ cancel_reason: form.cancel_reason, cancel_note: form.cancel_note }) };
  if (type === "archive") return { path: `/accounting-export-batches/${batchId}/archive`, body: archivePayload(form) };
  if (type === "archive_item") return { path: `/accounting-export-items/${item?.id}/archive`, body: archivePayload(form) };
  return { path: `/accounting-export-batches/${batchId}/recalculate-totals`, body: {} };
}

function archivePayload(form: Record<string, string>) {
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
}

function prefillItemForm(item: SyncRecord | null): Record<string, string> {
  if (!item) return {};
  return { export_status: String(item.export_status ?? ""), mapping_status: String(item.mapping_status ?? ""), target_account_code: String(item.target_account_code ?? ""), target_account_name: String(item.target_account_name ?? ""), target_entity_reference: String(item.target_entity_reference ?? ""), target_item_reference: String(item.target_item_reference ?? ""), target_class_reference: String(item.target_class_reference ?? ""), target_location_reference: String(item.target_location_reference ?? ""), debit_amount: String(item.debit_amount ?? ""), credit_amount: String(item.credit_amount ?? ""), amount: String(item.amount ?? ""), currency: String(item.currency ?? ""), memo: String(item.memo ?? ""), transaction_date: dateInput(item.transaction_date), error_message: String(item.error_message ?? ""), notes: String(item.notes ?? ""), override_reasons: jsonText(item.override_reasons) };
}

function buildSummary(rows: SyncRecord[]) {
  const summary = { total: rows.length, status: {} as Record<string, number>, type: {} as Record<string, number>, mappingErrors: 0, mappingWarnings: 0, pendingSubmission: 0 };
  for (const row of rows) {
    increment(summary.status, String(row.status ?? ""));
    increment(summary.type, String(row.export_type ?? ""));
    summary.mappingErrors += numberValue(row.mapping_error_count, 0);
    summary.mappingWarnings += numberValue(row.mapping_warning_count, 0);
    if (row.export_status === "generated") summary.pendingSubmission += 1;
  }
  return summary;
}

function countExportQueue(rows: SyncRecord[], items: SyncRecord[], queue: ExportQueueKey) {
  if (queue === "itemsAttention") return items.filter(exportItemNeedsAttention).length;
  return rows.filter((row) => exportQueueMatches(row, queue)).length;
}

function exportQueueMatches(row: SyncRecord, queue: ExportQueueKey) {
  const status = String(row.status ?? "");
  const approvalStatus = String(row.approval_status ?? "");
  const exportStatus = String(row.export_status ?? "");
  if (queue === "draft") return ["draft", "assembling"].includes(status) || approvalStatus === "not_submitted";
  if (queue === "submitted") return ["ready_for_review", "under_review"].includes(status) || approvalStatus === "pending";
  if (queue === "approved") return status === "approved" || approvalStatus === "approved" || exportStatus === "generated";
  if (queue === "markedSubmitted") return status === "submitted_later" || exportStatus === "submitted_later";
  if (queue === "accepted") return status === "accepted_later" || exportStatus === "accepted_later" || Boolean(row.accepted_at);
  if (queue === "canceled") return status === "cancelled" || exportStatus === "cancelled";
  if (queue === "archived") return status === "archived" || Boolean(row.archived_at);
  return false;
}

function exportItemNeedsAttention(item: SyncRecord) {
  const status = String(item.export_status ?? "");
  const mappingStatus = String(item.mapping_status ?? "");
  return ["rejected_later", "failed", "cancelled", "archived"].includes(status) || ["unmapped", "mapping_warning", "mapping_error"].includes(mappingStatus) || Boolean(item.error_message);
}

function exportBatchNextAction(row: SyncRecord) {
  const status = String(row.status ?? "");
  const approvalStatus = String(row.approval_status ?? "");
  const exportStatus = String(row.export_status ?? "");
  if (status === "archived") return "Archived for audit.";
  if (status === "cancelled" || exportStatus === "cancelled") return "Canceled; inspect detail if needed.";
  if (exportStatus === "accepted_later" || status === "accepted_later") return "Accepted by manual/external process.";
  if (exportStatus === "submitted_later" || status === "submitted_later") return "Mark Accepted or Failed.";
  if (approvalStatus === "approved" || status === "approved" || exportStatus === "generated") return "Mark Submitted when manually sent.";
  if (approvalStatus === "pending" || ["ready_for_review", "under_review"].includes(status)) return "Review and approve export.";
  return "Prepare or submit review.";
}

function exportItemNextAction(item: SyncRecord) {
  const status = String(item.export_status ?? "");
  const mappingStatus = String(item.mapping_status ?? "");
  if (status === "archived") return "Archived for audit.";
  if (["failed", "rejected_later", "cancelled"].includes(status)) return "Inspect item detail.";
  if (mappingStatus === "mapping_error") return "Fix mapping error.";
  if (mappingStatus === "mapping_warning") return "Review mapping warning.";
  if (mappingStatus === "unmapped") return "Map item before export.";
  return "No item action needed.";
}

function sortBatches(rows: SyncRecord[], sort?: string) {
  const statusRank: Record<string, number> = { failed: 9, ready_for_review: 8, under_review: 7, generated: 6, approved: 5, submitted_later: 4, draft: 3, assembling: 2 };
  return [...rows].sort((a, b) => {
    if (sort === "period_end_desc") return String(b.period_end ?? "").localeCompare(String(a.period_end ?? ""));
    if (sort === "amount_desc") return numberValue(b.total_amount, 0) - numberValue(a.total_amount, 0);
    if (sort === "error_count_desc") return numberValue(b.error_count, 0) - numberValue(a.error_count, 0);
    if (sort === "status") return String(a.status ?? "").localeCompare(String(b.status ?? ""));
    if (sort === "export_batch_number") return String(a.export_batch_number ?? "").localeCompare(String(b.export_batch_number ?? ""));
    return numberValue(b.error_count, 0) - numberValue(a.error_count, 0) || (statusRank[String(b.status)] ?? 0) - (statusRank[String(a.status)] ?? 0) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });
}

function exportChecklist(batch: SyncRecord, items: SyncRecord[]): Array<[string, unknown]> {
  return [["Batch created", Boolean(batch.id)], ["Source items added", items.length > 0], ["Mapping reviewed", items.some((item) => item.mapping_status && item.mapping_status !== "unmapped")], ["Totals calculated", batch.item_count !== undefined], ["Generated", batch.export_status === "generated" || ["generated", "submitted_later", "accepted_later"].includes(String(batch.status))], ["Reviewed", ["ready_for_review", "under_review", "approved", "generated", "submitted_later", "accepted_later"].includes(String(batch.status))], ["Approved", batch.approval_status === "approved"], ["Marked submitted if manually sent", ["submitted_later", "accepted_later"].includes(String(batch.export_status))], ["Marked accepted/failed if known", ["accepted_later", "failed"].includes(String(batch.export_status))], ["No GL entry created", true], ["No external API called", true], ["No source record mutated", true]];
}

function relatedOptions(sourceType: string | undefined, related: RelatedData) {
  if (sourceType === "invoice" || sourceType === "invoice_item") return related.invoices;
  if (sourceType === "cash_receipt") return related.cashReceipts;
  if (sourceType === "payment_application") return related.paymentApplications;
  if (sourceType === "contractor_payable" || sourceType === "contractor_payable_item") return related.contractorPayables;
  if (sourceType === "payroll_run" || sourceType === "payroll_item") return related.payrollRuns;
  if (sourceType === "payment_batch" || sourceType === "payment_item") return related.paymentBatches;
  if (sourceType === "bank_transaction") return related.bankTransactions;
  if (sourceType === "reconciliation_match") return related.reconciliationMatches;
  return [];
}

function mappingState(items: SyncRecord[]) {
  if (items.some((item) => item.mapping_status === "mapping_error")) return "Mapping Errors";
  if (items.some((item) => item.mapping_status === "mapping_warning")) return "Mapping Warnings";
  if (items.every((item) => item.mapping_status === "mapped" || item.mapping_status === "override_mapped")) return "Mapped";
  return "Needs Mapping";
}

function targetSystemMessage(value: unknown) {
  const target = String(value ?? "");
  if (target === "quickbooks_later") return "QuickBooks API integration is future scope.";
  if (target === "sage_later") return "Sage API integration is future scope.";
  if (target === "netsuite_later") return "NetSuite API integration is future scope.";
  if (target === "generic_csv") return "CSV export preparation is supported as metadata/status. File download is not implemented unless backend explicitly supports it.";
  if (target === "generic_json") return "JSON export preparation is supported as metadata/status. File download is not implemented unless backend explicitly supports it.";
  if (target === "manual_export") return "Manual export tracking is status-only.";
  return "Target system tracking is status-only.";
}

function formatMessage(value: unknown) {
  const format = String(value ?? "");
  if (format === "csv") return "CSV formatting/download is not implemented unless backend explicitly exposes a safe generated file reference.";
  if (format === "json") return "JSON formatting/download is not implemented unless backend explicitly exposes a safe generated file reference.";
  if (format === "manual_summary") return "Manual summary means operators track what was prepared and submitted outside SyncOS.";
  if (format === "api_payload_later") return "API payload generation is future scope.";
  if (format === "iif_later") return "IIF/QuickBooks import format is future scope.";
  return "Export format is preparation metadata only.";
}

function plainError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("not found")) return "Accounting export batch or item not found or no access.";
  if (lower.includes("source")) return "Source object not found, no access, does not match export type, or duplicate source object is not allowed without override.";
  if (lower.includes("mapping")) return "Mapping error must be fixed or overridden before generation.";
  if (lower.includes("generate")) return "Generate does not create external files or API submissions.";
  if (lower.includes("submitted")) return "Mark Submitted does not call an external accounting system.";
  if (lower.includes("accepted")) return "Mark Accepted does not verify with an external accounting system.";
  if (lower.includes("permission") || lower.includes("forbidden")) return "You do not have permission for this accounting export action.";
  if (lower.includes("archive")) return "Archive reason is required.";
  return message;
}

function Select({ label, value, options, labels = {}, onChange, disabled, required }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void; disabled?: boolean; required?: boolean }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? formatAction(option)}</option>)}</select></label>;
}

function SummaryCard({ label, value, helper, active, onClick }: { label: string; value: unknown; helper?: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className="summary-card" aria-pressed={active} onClick={onClick}><span>{label}</span><strong>{formatCell(value)}</strong>{helper ? <small>{helper}</small> : null}</button>;
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
  return id ? <Link className="table-link" href={`/accounting-exports/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function sourceLink(row: SyncRecord) {
  const id = row.source_object_id;
  if (!id) return "Not linked";
  const source = String(row.source_object_type ?? "");
  const route = source === "invoice" ? `/invoices/${id}` : source === "cash_receipt" ? `/cash/receipts/${id}` : source === "contractor_payable" ? `/contractor-payables/${id}` : source === "payroll_run" ? `/payroll/${id}` : source === "payment_batch" ? `/payments/${id}` : source === "bank_transaction" ? `/bank-reconciliation/transactions/${id}` : source === "reconciliation_match" ? `/reconciliation-matches/${id}` : "";
  return route ? <Link className="table-link" href={route}>{String(id)}</Link> : <span title="Source detail not available in this workspace.">{String(id)}</span>;
}

function labelsFor(rows: SyncRecord[]) {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row.invoice_number ?? row.receipt_number ?? row.payable_number ?? row.payroll_run_number ?? row.payment_batch_number ?? row.description ?? row.match_type ?? row.name, String(row.id))]));
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

function createdId(record: SyncRecord) {
  const after = record.afterState as SyncRecord | undefined;
  return String(record.id ?? record.entityId ?? after?.id ?? "");
}

function batchInactive(batch: SyncRecord) {
  return ["submitted_later", "accepted_later", "cancelled", "archived"].includes(String(batch.status));
}

function batchArchived(batch: SyncRecord) {
  return String(batch.status) === "archived";
}

function actionNotice(action: string) {
  return `${formatAction(action)} completed.`;
}
