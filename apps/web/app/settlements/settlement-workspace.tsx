"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, type ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";

const settlementTypes = ["customer_billable", "contractor_payable", "mixed", "internal_adjustment", "retainage_release", "correction_adjustment", "chargeback"];
const itemTypes = ["customer_billable", "contractor_payable", "retainage_hold", "retainage_release", "deduction", "chargeback", "adjustment", "correction"];
const readinessStatuses = ["not_ready", "needs_review", "ready_with_warning", "ready_for_approval", "blocked"];
const tabs = ["overview", "items", "customer_billable", "contractor_payable", "retainage", "deductions_chargebacks", "margin", "readiness", "invoice_readiness", "payable_readiness", "holds_disputes", "timeline", "audit", "future_invoice", "future_payment_payroll"];

type SettlementDetailShape = {
  settlement?: SyncRecord;
  settlement_items?: SyncRecord[];
  customer_context?: SyncRecord | null;
  provider_context?: SyncRecord | null;
  project_context?: SyncRecord | null;
  work_order_context?: SyncRecord | null;
  financial_summary?: SyncRecord;
  readiness?: SyncRecord;
  warnings?: SyncRecord[];
  blockers?: SyncRecord[];
  required_override_fields?: unknown[];
  recommended_next_action?: string;
  invoice_readiness_summary?: SyncRecord;
  payable_readiness_summary?: SyncRecord;
  margin_summary?: SyncRecord;
  retainage_summary?: SyncRecord;
  deduction_chargeback_summary?: SyncRecord;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type RelatedData = {
  billableItems: SyncRecord[];
  customers: SyncRecord[];
  providers: SyncRecord[];
  projects: SyncRecord[];
};

type Session = ReturnType<typeof useSession>;

export function SettlementQueue() {
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
      for (const key of ["settlement_type", "status", "readiness_status", "customer_organization_id", "capacity_provider_id", "project_id", "work_order_id", "invoice_ready", "payable_ready", "has_hold", "has_dispute", "q"]) if (filters[key]) query.set(key, filters[key]);
      if (filters.sort) query.set("sort", filters.sort);
      setRows(await syncosFetch<SyncRecord[]>(`/settlements?${query.toString()}`, { token: session.token }));
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

  const visible = useMemo(() => sortSettlements(rows.filter((row) => matchesFilters(row, filters)).filter((row) => matchesSettlementQueue(row, activeQueue)), filters.sort), [rows, filters, activeQueue]);
  const queueCards = settlementQueues.map((queue) => ({ ...queue, value: rows.filter((row) => matchesSettlementQueue(row, queue.id)).length }));
  const activeQueueLabel = queueCards.find((queue) => queue.id === activeQueue)?.label ?? "Draft";

  function selectQueue(queueId: string) {
    setActiveQueue(queueId);
    setFilters({ ...filters, archived: queueId === "archived" ? "true" : "false" });
  }

  return (
    <SettlementShell title="Settlement Workbench" purpose="Review billable totals, clear settlement blockers, and prepare approved settlements for invoice readiness.">
      <SessionPanel session={session} />
      <div className="warning-box">Settlement review confirms internal readiness and totals. Mark Invoice Ready prepares the settlement for invoicing workflow; it does not send, post, create cash, or collect payment.</div>
      {error ? <div className="error-banner">{error}</div> : null}
      {!session.token ? <div className="empty-state">Login required. Sign in to review settlement totals and invoice-readiness blockers.</div> : null}
      {loading ? <div className="empty-state">Loading settlements...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel operator-queue-hero">
            <div className="section-toolbar">
              <div>
                <h2>Which settlements need review, which totals are blocked, and which settlements are invoice-ready?</h2>
                <p className="muted">Settlement work is prioritized by review state, recalculation needs, disputes, invoice readiness, and recent updates.</p>
              </div>
              <div className="form-actions">
                <Link className="primary-button" href={firstHref(visible, "/settlements")} aria-disabled={!visible.length}>Review Next Settlement</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => row.readiness_status === "blocked" || arrayValue(row.blockers).length > 0), "/settlements")} aria-disabled={!rows.some((row) => row.readiness_status === "blocked" || arrayValue(row.blockers).length > 0)}>Recalculate Readiness</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => row.status === "disputed" || row.has_dispute), "/settlements")} aria-disabled={!rows.some((row) => row.status === "disputed" || row.has_dispute)}>Open Disputes</Link>
                <Link className="link-button" href={firstHref(rows.filter((row) => row.invoice_ready), "/settlements")} aria-disabled={!rows.some((row) => row.invoice_ready)}>Open Invoice Ready</Link>
                <Link className="link-button" href="/settlements/new" aria-disabled={!hasPermission(session.permissions, "settlement.create")}>Create Settlement</Link>
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
                <p className="muted">{emptySettlementQueue(activeQueue)}</p>
              </div>
              <button type="button" onClick={() => { setActiveQueue("draft"); setFilters({ archived: "false", sort: "updated_desc" }); }}>Reset</button>
            </div>
            <div className="queue-tabs" role="tablist" aria-label="Settlement queues">
              {settlementQueues.map((queue) => <button key={queue.id} type="button" role="tab" aria-selected={activeQueue === queue.id} className={activeQueue === queue.id ? "active" : ""} onClick={() => selectQueue(queue.id)}>{queue.label}</button>)}
            </div>
            <details className="filter-drawer">
              <summary aria-label="Advanced filters drawer">Advanced filters</summary>
              <div className="filter-grid">
                <input value={filters.q ?? ""} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search settlement, customer, provider, project" />
                <Select label="Settlement Type" value={filters.settlement_type ?? ""} options={["", ...settlementTypes]} onChange={(settlement_type) => setFilters({ ...filters, settlement_type })} />
                <Select label="Readiness Status" value={filters.readiness_status ?? ""} options={["", ...readinessStatuses]} onChange={(readiness_status) => setFilters({ ...filters, readiness_status })} />
                <input value={filters.customer_organization_id ?? ""} onChange={(event) => setFilters({ ...filters, customer_organization_id: event.target.value })} placeholder="Customer" />
                <input value={filters.project_id ?? ""} onChange={(event) => setFilters({ ...filters, project_id: event.target.value })} placeholder="Project" />
                <Select label="Invoice Ready" value={filters.invoice_ready ?? ""} options={["", "true", "false"]} onChange={(invoice_ready) => setFilters({ ...filters, invoice_ready })} />
                <Select label="Has Hold" value={filters.has_hold ?? ""} options={["", "true", "false"]} onChange={(has_hold) => setFilters({ ...filters, has_hold })} />
                <Select label="Has Dispute" value={filters.has_dispute ?? ""} options={["", "true", "false"]} onChange={(has_dispute) => setFilters({ ...filters, has_dispute })} />
                <Select label="Sort" value={filters.sort ?? "updated_desc"} options={["updated_desc", "readiness_asc", "readiness_desc", "gross_amount_desc", "net_amount_desc", "margin_asc", "status", "settlement_number"]} labels={{ updated_desc: "Recently updated", readiness_asc: "Lowest readiness", readiness_desc: "Highest readiness", gross_amount_desc: "Gross amount highest", net_amount_desc: "Net amount highest", margin_asc: "Margin lowest", status: "Status", settlement_number: "Settlement number" }} onChange={(sort) => setFilters({ ...filters, sort })} />
              </div>
            </details>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <h2>Settlements</h2>
              <span>{visible.length} shown</span>
            </div>
            {!rows.length ? <div className="empty-state">No settlements yet. Create a settlement shell, then add ready billable items.</div> : visible.length ? <SettlementTable rows={visible} /> : <div className="empty-state">{emptySettlementQueue(activeQueue)}</div>}
          </section>
        </>
      ) : null}
    </SettlementShell>
  );
}

export function SettlementCreate() {
  const router = useRouter();
  const session = useSession();
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({ settlement_type: "customer_billable" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void loadRelated(session.token).then(setRelated);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/settlements", { method: "POST", body: buildSettlementPayload(form), token: session.token });
      const after = created.afterState as SyncRecord | undefined;
      const settlement = after?.settlement as SyncRecord | undefined;
      const id = String(created.id ?? created.entityId ?? settlement?.id ?? after?.id ?? "");
      router.push(id ? `/settlements/${id}` : "/settlements");
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <SettlementShell title="Create Settlement" purpose="Create a settlement shell without creating invoice, AR, payment, payroll, cash, tax, ACH, card payout, or bank transaction records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Backend validation enforces tenant scope, approved settlement types, settlement number uniqueness, and event/audit/system_action behavior.</div>
        <SettlementFormFields form={form} setForm={setForm} related={related} includeCreate />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "settlement.create")}>Create Settlement</button>
          <Link className="link-button" href="/settlements">Cancel</Link>
        </div>
      </form>
    </SettlementShell>
  );
}

export function SettlementEdit({ settlementId }: { settlementId: string }) {
  const router = useRouter();
  const session = useSession();
  const [detail, setDetail] = useState<SettlementDetailShape | null>(null);
  const [related, setRelated] = useState<RelatedData>(emptyRelated);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const [next, nextRelated] = await Promise.all([
          syncosFetch<SettlementDetailShape>(`/settlements/${settlementId}/detail`, { token: session.token }),
          loadRelated(session.token),
        ]);
        const record = settlementRecord(next);
        setDetail(next);
        setRelated(nextRelated);
        setForm({
          settlement_period_start: dateInput(record.settlement_period_start),
          settlement_period_end: dateInput(record.settlement_period_end),
          invoice_cycle: String(record.invoice_cycle ?? ""),
          pay_cycle: String(record.pay_cycle ?? ""),
          customer_organization_id: String(record.customer_organization_id ?? ""),
          capacity_provider_id: String(record.capacity_provider_id ?? ""),
          override_reasons: jsonText(record.override_reasons),
          hold_note: String(record.hold_note ?? ""),
          dispute_note: String(record.dispute_note ?? ""),
        });
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, settlementId]);

  const record = detail ? settlementRecord(detail) : null;
  const readOnly = record ? ["voided", "archived", "invoice_created_later", "payable_created_later"].includes(String(record.status)) : true;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/settlements/${settlementId}`, { method: "PATCH", body: buildSettlementPatchPayload(form), token: session.token });
      router.push(`/settlements/${settlementId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <SettlementShell title="Edit Settlement" purpose="Edit supported settlement fields without bypassing review and approval lifecycle routes.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Settlement not found or you do not have access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Status changes use lifecycle routes. Voided, archived, invoice-created, and payable-created future states are read-only.</div>
          <SettlementFormFields form={form} setForm={setForm} related={related} disabled={readOnly} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={readOnly || !hasPermission(session.permissions, "settlement.update")}>Save Settlement</button>
            <Link className="link-button" href={`/settlements/${settlementId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </SettlementShell>
  );
}

export function SettlementDetail({ settlementId }: { settlementId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<SettlementDetailShape | null>(null);
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
      const [next, timeline, audit, nextRelated] = await Promise.all([
        syncosFetch<SettlementDetailShape>(`/settlements/${settlementId}/detail`, { token: session.token }),
        optionalList(`/settlements/${settlementId}/timeline`, session.token),
        optionalList(`/settlements/${settlementId}/audit-summary`, session.token),
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
  }, [session.token, settlementId]);

  const record = detail ? settlementRecord(detail) : null;
  const items = detail?.settlement_items ?? [];
  const warnings = detail?.warnings ?? arrayValue(record?.warnings);
  const blockers = detail?.blockers ?? arrayValue(record?.blockers);

  function openItemModal(type: string, item: SyncRecord) {
    setSelectedItem(item);
    setModal(type);
  }

  return (
    <SettlementShell title="Settlement Detail" purpose="Show financial commitment truth, settlement items, readiness, timeline, and audit without creating downstream finance records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!session.token ? <div className="empty-state">Sign in with a SyncOS token to view Settlement Detail.</div> : null}
      {!record && session.token && !error ? <div className="empty-state">Settlement not found or you do not have access.</div> : null}
      {record && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(record.settlement_number, "Settlement")}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(record.settlement_type)}</span>
                  <span className="badge">{formatAction(record.status)}</span>
                  <span className="badge">{formatAction(record.readiness_status)}</span>
                  <span className="badge">{formatCell(record.readiness_score)}</span>
                  <span className="badge">{formatAction(record.recommended_next_action ?? detail.recommended_next_action)}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/settlements/${settlementId}/edit`} aria-disabled={!hasPermission(session.permissions, "settlement.update")}>Edit Settlement</Link>
                <ActionButton permission="settlement.recalculate_readiness" session={session} disabled={viewOnly(record)} onClick={() => setModal("recalculate")}>Recalculate Readiness</ActionButton>
                <ActionButton permission="settlement.add_item" session={session} disabled={viewOnly(record)} onClick={() => setModal("add_item")}>Add Settlement Item</ActionButton>
                <ActionButton permission="settlement.submit_review" session={session} disabled={viewOnly(record) || !items.length || blockers.length > 0} onClick={() => setModal("submit_review")}>Submit Review</ActionButton>
                <ActionButton permission="settlement.start_review" session={session} disabled={String(record.status) !== "ready_for_review"} onClick={() => setModal("start_review")}>Start Review</ActionButton>
                <ActionButton permission="settlement.approve" session={session} disabled={viewOnly(record) || blockers.length > 0} onClick={() => setModal("approve")}>Approve</ActionButton>
                <ActionButton permission="settlement.reject" session={session} disabled={viewOnly(record)} onClick={() => setModal("reject")}>Reject</ActionButton>
                <ActionButton permission="settlement.mark_invoice_ready" session={session} disabled={String(record.status) !== "approved" || Boolean(record.invoice_ready)} onClick={() => setModal("invoice_ready")}>Mark Invoice Ready</ActionButton>
                <ActionButton permission="settlement.mark_payable_ready" session={session} disabled={String(record.status) !== "approved" || Boolean(record.payable_ready)} onClick={() => setModal("payable_ready")}>Mark Payable Ready</ActionButton>
                <ActionButton permission="settlement.place_hold" session={session} disabled={viewOnly(record) || String(record.status) === "held"} onClick={() => setModal("hold")}>Place Hold</ActionButton>
                <ActionButton permission="settlement.release_hold" session={session} disabled={String(record.status) !== "held"} onClick={() => setModal("release")}>Release Hold</ActionButton>
                <ActionButton permission="settlement.dispute" session={session} disabled={viewOnly(record) || String(record.status) === "disputed"} onClick={() => setModal("dispute")}>Dispute</ActionButton>
                <ActionButton permission="settlement.resolve_dispute" session={session} disabled={String(record.status) !== "disputed"} onClick={() => setModal("resolve")}>Resolve Dispute</ActionButton>
                <ActionButton permission="settlement.void" session={session} disabled={viewOnly(record) || Boolean(record.invoice_ready || record.payable_ready)} onClick={() => setModal("void")}>Void</ActionButton>
                <ActionButton permission="settlement.archive" session={session} disabled={String(record.status) === "archived"} onClick={() => setModal("archive")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Gross Billable Amount" value={money(record.gross_billable_amount)} />
              <Metric label="Contractor Payable Amount" value={money(record.contractor_payable_amount)} />
              <Metric label="Retainage Amount" value={money(record.retainage_amount)} />
              <Metric label="Deduction Amount" value={money(record.deduction_amount)} />
              <Metric label="Chargeback Amount" value={money(record.chargeback_amount)} />
              <Metric label="Net Settlement Amount" value={money(record.net_settlement_amount)} />
              <Metric label="Estimated Margin Amount" value={money(record.estimated_margin_amount)} />
              <Metric label="Estimated Margin Percent" value={percent(record.estimated_margin_percent)} />
              <Metric label="Readiness Score" value={formatCell(record.readiness_score)} />
              <Metric label="Invoice Ready" value={boolText(record.invoice_ready)} />
              <Metric label="Payable Ready" value={boolText(record.payable_ready)} />
              <Metric label="Item Count" value={formatCell(record.item_count ?? items.length)} />
            </div>
            <div className="warning-box">Settlement does not create invoice. Invoice ready does not create AR. Payable ready does not send payment or payroll. Cash starts later after invoice, AR, and payment application.</div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Settlement type</dt><dd>{formatAction(record.settlement_type)}</dd>
                <dt>Status</dt><dd>{formatAction(record.status)}</dd>
                <dt>Readiness</dt><dd>{formatAction(record.readiness_status)} / {formatCell(record.readiness_score)}</dd>
                <dt>Customer</dt><dd>{organizationLink(record.customer_organization_id, record.customer_organization_name ?? detail.customer_context?.name)}</dd>
                <dt>Provider</dt><dd>{textValue(record.capacity_provider_name ?? record.capacity_provider_id)}</dd>
                <dt>Project</dt><dd>{projectLink(record.project_id, record.project_name ?? detail.project_context?.name)}</dd>
                <dt>Work Order</dt><dd>{workOrderLink(record.work_order_id, record.work_order_name ?? detail.work_order_context?.work_order_name)}</dd>
                <dt>Period</dt><dd>{dateValue(record.settlement_period_start)} to {dateValue(record.settlement_period_end)}</dd>
                <dt>Invoice cycle</dt><dd>{textValue(record.invoice_cycle)}</dd>
                <dt>Pay cycle</dt><dd>{textValue(record.pay_cycle)}</dd>
                <dt>Customer billable state</dt><dd>{formatCell(record.customer_billable_item_count)} items</dd>
                <dt>Contractor payable state</dt><dd>{formatCell(record.contractor_payable_item_count)} items</dd>
                <dt>Retainage state</dt><dd>{money(record.retainage_amount)}</dd>
                <dt>Margin state</dt><dd>{money(record.estimated_margin_amount)} / {percent(record.estimated_margin_percent)}</dd>
                <dt>Hold/dispute state</dt><dd>{textValue(record.hold_reason ?? record.dispute_reason, "No hold or dispute")}</dd>
              </dl>
              <Checklist items={settlementChecklist(record, items)} />
              <WarningList title="Key Blockers" rows={blockers.slice(0, 4)} empty="No blockers returned." />
              <WarningList title="Key Warnings" rows={warnings.slice(0, 4)} empty="No warnings returned." />
              <div className="warning-box">Invoice, payment, payroll, ACH, card payout, and bank transaction workflows are future layers.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((itemTab) => <button key={itemTab} type="button" className={tab === itemTab ? "active" : ""} onClick={() => setTab(itemTab)}>{formatAction(itemTab)}</button>)}
              </div>
              <SettlementTab tab={tab} detail={detail} settlement={record} items={items} onItemAction={openItemModal} session={session} />
            </section>
          </div>
          {modal ? <SettlementLifecycleModal type={modal} settlementId={settlementId} settlement={record} related={related} blockers={blockers} session={session} item={selectedItem} onClose={() => { setModal(""); setSelectedItem(null); }} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </SettlementShell>
  );
}

function SettlementShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/settlements", "Settlement Queue", "active"],
    ["/settlements/new", "Create Settlement", "active"],
    ["#detail", "Settlement Detail", "placeholder"],
    ["#items", "Settlement Items", "placeholder"],
    ["#financial", "Financial Summary", "placeholder"],
    ["#customer-billable", "Customer Billable", "placeholder"],
    ["#contractor-payable", "Contractor Payable", "placeholder"],
    ["#retainage", "Retainage", "placeholder"],
    ["#deductions", "Deductions / Chargebacks", "placeholder"],
    ["#margin", "Margin", "placeholder"],
    ["#readiness", "Readiness", "placeholder"],
    ["#invoice", "Invoice Readiness", "placeholder"],
    ["#payable", "Payable Readiness", "placeholder"],
    ["#holds", "Holds & Disputes", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-invoice", "Future Invoice", "placeholder"],
    ["#future-payment", "Future Payment / Payroll", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Settlements</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function SettlementTable({ rows }: { rows: SyncRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Settlement", "Customer / Project", "Billable Items", "Total Amount", "Readiness", "Review Status", "Invoice Readiness", "Dispute Status", "Age / Updated", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>
                <Link className="table-link" href={`/settlements/${row.id}`}>{textValue(row.settlement_number, "Settlement")}</Link>
                <div className="cell-helper">{formatAction(row.settlement_type)}</div>
              </td>
              <td>
                {organizationLink(row.customer_organization_id, row.customer_organization_name)}
                <div className="cell-helper">{projectLink(row.project_id, row.project_name)}</div>
              </td>
              <td>{formatCell(row.item_count ?? row.customer_billable_item_count)}</td>
              <td>
                {money(row.net_settlement_amount)}
                <div className="cell-helper">Gross {money(row.gross_billable_amount)}</div>
              </td>
              <td>
                {formatAction(row.readiness_status)}
                <div className="cell-helper">Score {formatCell(row.readiness_score)}</div>
              </td>
              <td>{formatAction(row.status)}</td>
              <td>{row.invoice_ready ? "Invoice Ready" : "Not invoice-ready"}</td>
              <td>{row.status === "disputed" || row.dispute_reason ? formatAction(row.dispute_reason ?? "Disputed") : "No dispute"}</td>
              <td>{dateValue(row.updated_at)}</td>
              <td>{nextSettlementAction(row)}</td>
              <td><Link className="link-button" href={`/settlements/${row.id}`}>Open Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettlementTab({ tab, detail, settlement, items, session, onItemAction }: { tab: string; detail: SettlementDetailShape; settlement: SyncRecord; items: SyncRecord[]; session: Session; onItemAction: (type: string, item: SyncRecord) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Settlement number</dt><dd>{textValue(settlement.settlement_number)}</dd><dt>Settlement type</dt><dd>{formatAction(settlement.settlement_type)}</dd><dt>Status</dt><dd>{formatAction(settlement.status)}</dd><dt>Readiness status</dt><dd>{formatAction(settlement.readiness_status)}</dd><dt>Readiness score</dt><dd>{formatCell(settlement.readiness_score)}</dd><dt>Readiness band</dt><dd>{formatAction(settlement.readiness_band)}</dd><dt>Settlement period</dt><dd>{dateValue(settlement.settlement_period_start)} to {dateValue(settlement.settlement_period_end)}</dd><dt>Invoice cycle</dt><dd>{textValue(settlement.invoice_cycle)}</dd><dt>Pay cycle</dt><dd>{textValue(settlement.pay_cycle)}</dd><dt>Warnings</dt><dd><JsonBlock value={detail.warnings ?? settlement.warnings} /></dd><dt>Blockers</dt><dd><JsonBlock value={detail.blockers ?? settlement.blockers} /></dd><dt>Required override fields</dt><dd><JsonBlock value={detail.required_override_fields ?? settlement.required_override_fields} /></dd><dt>Recommended next action</dt><dd>{formatAction(settlement.recommended_next_action ?? detail.recommended_next_action)}</dd><dt>Override reasons</dt><dd><JsonBlock value={settlement.override_reasons} /></dd><dt>Created</dt><dd>{dateValue(settlement.created_at)}</dd><dt>Updated</dt><dd>{dateValue(settlement.updated_at)}</dd></dl><div className="warning-box">This settlement represents financial commitment from eligible billable work. It does not create invoice, AR, payment, cash, payroll, tax, ACH, card payout, or bank transaction records.</div></Panel>;
  if (tab === "items") return <Panel title="Settlement Items"><SettlementItemsTable rows={items} session={session} onItemAction={onItemAction} /><div className="warning-box">Adding or voiding settlement items does not create invoice or payment records.</div></Panel>;
  if (tab === "customer_billable") return <Panel title="Customer Billable"><dl className="detail-list"><dt>Customer billable item count</dt><dd>{formatCell(settlement.customer_billable_item_count)}</dd><dt>Gross billable amount</dt><dd>{money(settlement.gross_billable_amount)}</dd><dt>Retainage amount</dt><dd>{money(settlement.retainage_amount)}</dd><dt>Deduction amount</dt><dd>{money(settlement.deduction_amount)}</dd><dt>Chargeback amount</dt><dd>{money(settlement.chargeback_amount)}</dd><dt>Net customer billable amount</dt><dd>{money(settlement.net_settlement_amount)}</dd><dt>Customer acceptance</dt><dd><JsonBlock value={acceptanceSummary(items, "customer_acceptance_status")} /></dd><dt>Prime acceptance</dt><dd><JsonBlock value={acceptanceSummary(items, "prime_acceptance_status")} /></dd><dt>Billing package</dt><dd><JsonBlock value={acceptanceSummary(items, "billing_package_status")} /></dd><dt>Documentation</dt><dd><JsonBlock value={acceptanceSummary(items, "documentation_status")} /></dd></dl><div className="warning-box">Customer billable amount is not an invoice. Invoice creation is a future workflow.</div></Panel>;
  if (tab === "contractor_payable") return <Panel title="Contractor Payable"><dl className="detail-list"><dt>Contractor payable item count</dt><dd>{formatCell(settlement.contractor_payable_item_count)}</dd><dt>Provider</dt><dd>{textValue(settlement.capacity_provider_name ?? settlement.capacity_provider_id)}</dd><dt>Contractor payable amount</dt><dd>{money(settlement.contractor_payable_amount)}</dd><dt>Contractor rates</dt><dd><JsonBlock value={items.map((item) => ({ item_type: item.item_type, contractor_rate: item.contractor_rate, contractor_payable_amount: item.contractor_payable_amount }))} /></dd><dt>Payable ready</dt><dd>{boolText(settlement.payable_ready)}</dd></dl><div className="warning-box">Contractor payable readiness does not send payment, payroll, ACH, card payout, or bank transaction.</div></Panel>;
  if (tab === "retainage") return <Panel title="Retainage"><dl className="detail-list"><dt>Retainage amount</dt><dd>{money(settlement.retainage_amount)}</dd><dt>Retainage by item</dt><dd><JsonBlock value={items.map((item) => ({ item: item.id, retainage_percent: item.retainage_percent, retainage_amount: item.retainage_amount }))} /></dd><dt>Retainage summary</dt><dd><JsonBlock value={detail.retainage_summary} /></dd></dl><div className="warning-box">Formal retainage ledgering and release workflows are deferred to future finance sprints.</div></Panel>;
  if (tab === "deductions_chargebacks") return <Panel title="Deductions / Chargebacks"><dl className="detail-list"><dt>Deduction amount</dt><dd>{money(settlement.deduction_amount)}</dd><dt>Chargeback amount</dt><dd>{money(settlement.chargeback_amount)}</dd><dt>Item details</dt><dd><JsonBlock value={items.map((item) => ({ item: item.id, deduction_amount: item.deduction_amount, chargeback_amount: item.chargeback_amount, net_amount: item.net_amount }))} /></dd><dt>Summary</dt><dd><JsonBlock value={detail.deduction_chargeback_summary} /></dd></dl><div className="warning-box">First-class chargeback workflow is deferred. This workspace displays settlement-level and item-level deduction/chargeback fields only.</div></Panel>;
  if (tab === "margin") return <Panel title="Margin"><dl className="detail-list"><dt>Gross billable amount</dt><dd>{money(settlement.gross_billable_amount)}</dd><dt>Contractor payable amount</dt><dd>{money(settlement.contractor_payable_amount)}</dd><dt>Net settlement amount</dt><dd>{money(settlement.net_settlement_amount)}</dd><dt>Estimated margin amount</dt><dd>{money(settlement.estimated_margin_amount)}</dd><dt>Estimated margin percent</dt><dd>{percent(settlement.estimated_margin_percent)}</dd><dt>Negative margin warning</dt><dd>{numberValue(settlement.estimated_margin_amount) < 0 ? "Negative margin requires review." : "No negative margin returned."}</dd><dt>Margin unknown warning</dt><dd>{settlement.estimated_margin_amount === null || settlement.estimated_margin_amount === undefined ? "Margin unknown." : "Margin calculated."}</dd><dt>Margin summary</dt><dd><JsonBlock value={detail.margin_summary} /></dd></dl><div className="warning-box">Margin is estimated at settlement. Final realized margin may depend on invoice, AR, cash, retainage release, and payable workflows later.</div></Panel>;
  if (tab === "readiness") return <Panel title="Readiness"><div className="summary-grid"><Metric label="Readiness Score" value={formatCell(settlement.readiness_score)} /><Metric label="Readiness Status" value={formatAction(settlement.readiness_status)} /><Metric label="Readiness Band" value={formatAction(settlement.readiness_band)} /><Metric label="Recommended Next Action" value={formatAction(settlement.recommended_next_action ?? detail.recommended_next_action)} /></div><WarningList title="Warnings" rows={detail.warnings ?? []} empty="No warnings returned." /><WarningList title="Blockers" rows={detail.blockers ?? []} empty="No blockers returned." /><dl className="detail-list"><dt>Required override fields</dt><dd><JsonBlock value={detail.required_override_fields} /></dd></dl></Panel>;
  if (tab === "invoice_readiness") return <Panel title="Invoice Readiness"><dl className="detail-list"><dt>Invoice ready</dt><dd>{boolText(settlement.invoice_ready)}</dd><dt>Customer billable item count</dt><dd>{formatCell(settlement.customer_billable_item_count)}</dd><dt>Documentation readiness</dt><dd><JsonBlock value={acceptanceSummary(items, "documentation_status")} /></dd><dt>Customer acceptance</dt><dd><JsonBlock value={acceptanceSummary(items, "customer_acceptance_status")} /></dd><dt>Prime acceptance</dt><dd><JsonBlock value={acceptanceSummary(items, "prime_acceptance_status")} /></dd><dt>Invoice readiness summary</dt><dd><JsonBlock value={detail.invoice_readiness_summary} /></dd></dl><div className="warning-box">Mark Invoice Ready does not create invoice, invoice item, AR, payment, or cash records.</div></Panel>;
  if (tab === "payable_readiness") return <Panel title="Payable Readiness"><dl className="detail-list"><dt>Payable ready</dt><dd>{boolText(settlement.payable_ready)}</dd><dt>Contractor payable item count</dt><dd>{formatCell(settlement.contractor_payable_item_count)}</dd><dt>Contractor rates reviewed</dt><dd><JsonBlock value={items.map((item) => ({ item: item.id, contractor_rate: item.contractor_rate, contractor_payable_amount: item.contractor_payable_amount }))} /></dd><dt>Contractor deductions/chargebacks</dt><dd><JsonBlock value={items.map((item) => ({ item: item.id, deduction_amount: item.deduction_amount, chargeback_amount: item.chargeback_amount }))} /></dd><dt>Payable readiness summary</dt><dd><JsonBlock value={detail.payable_readiness_summary} /></dd></dl><div className="warning-box">Mark Payable Ready does not create payment, payroll, ACH, card payout, or bank transaction records.</div></Panel>;
  if (tab === "holds_disputes") return <Panel title="Holds & Disputes"><dl className="detail-list"><dt>Hold reason</dt><dd>{textValue(settlement.hold_reason)}</dd><dt>Hold note</dt><dd>{textValue(settlement.hold_note)}</dd><dt>Dispute reason</dt><dd>{textValue(settlement.dispute_reason)}</dd><dt>Dispute note</dt><dd>{textValue(settlement.dispute_note)}</dd><dt>Status</dt><dd>{formatAction(settlement.status)}</dd><dt>Resolution state</dt><dd>{["held", "disputed"].includes(String(settlement.status)) ? "Open" : "No active hold or dispute"}</dd></dl></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline ?? []} columns={["event_type", "actor", "timestamp", "summary", "object_type", "object_id"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail._audit?.length ? <ObjectTable rows={detail._audit} columns={["actor", "action", "object", "before", "after", "reason", "timestamp", "correlation_id"]} /> : <div className="empty-state">You do not have permission to view settlement audit details.</div>}</Panel>;
  if (tab === "future_invoice") return <PlaceholderPanel title="Future Invoice" message="Invoice creation is not available in this sprint. Invoice, invoice item, AR, payment, and cash workflows require future rules and backend approval." columns={["Invoice", "Invoice item", "AR", "Payment", "Cash"]} />;
  return <PlaceholderPanel title="Future Payment / Payroll" message="Payment, payroll, ACH, card payout, and bank transaction workflows are not available in this sprint." columns={["Payment", "Payroll", "ACH", "Card payout", "Bank transaction"]} />;
}

function SettlementItemsTable({ rows, session, onItemAction }: { rows: SyncRecord[]; session: Session; onItemAction: (type: string, item: SyncRecord) => void }) {
  if (!rows.length) return <div className="empty-state">No settlement items returned. Add items from ready billable items.</div>;
  return (
    <div className="wide-table">
      <table>
        <thead><tr>{["Item Type", "Status", "Billable Item", "Project", "Work Order", "Production Record", "QC Review", "Customer", "Provider", "Crew", "Quantity", "Unit", "Unit Rate", "Gross Amount", "Retainage Amount", "Deduction Amount", "Chargeback Amount", "Net Amount", "Contractor Rate", "Contractor Payable Amount", "Margin Amount", "Margin Percent", "Billing Package Status", "Documentation Status", "Customer Acceptance", "Prime Acceptance", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((item) => <tr key={String(item.id)}>
            <td>{formatAction(item.item_type)}</td>
            <td>{formatAction(item.status)}</td>
            <td>{item.billable_item_id ? <Link className="table-link" href={`/billable/${item.billable_item_id}`}>{textValue(item.billable_item_id)}</Link> : "Not linked"}</td>
            <td>{projectLink(item.project_id, item.project_name)}</td>
            <td>{workOrderLink(item.work_order_id, item.work_order_name)}</td>
            <td>{productionLink(item.production_record_id, item.production_type)}</td>
            <td>{qcLink(item.qc_review_id, item.review_type)}</td>
            <td>{organizationLink(item.customer_organization_id, item.customer_organization_name)}</td>
            <td>{textValue(item.capacity_provider_name ?? item.capacity_provider_id)}</td>
            <td>{textValue(item.crew_name ?? item.crew_id)}</td>
            <td>{formatCell(item.quantity)}</td>
            <td>{formatAction(item.unit)}</td>
            <td>{money(item.unit_rate)}</td>
            <td>{money(item.gross_amount)}</td>
            <td>{money(item.retainage_amount)}</td>
            <td>{money(item.deduction_amount)}</td>
            <td>{money(item.chargeback_amount)}</td>
            <td>{money(item.net_amount)}</td>
            <td>{money(item.contractor_rate)}</td>
            <td>{money(item.contractor_payable_amount)}</td>
            <td>{money(item.margin_amount)}</td>
            <td>{percent(item.margin_percent)}</td>
            <td>{formatAction(item.billing_package_status)}</td>
            <td>{formatAction(item.documentation_status)}</td>
            <td>{formatAction(item.customer_acceptance_status)}</td>
            <td>{formatAction(item.prime_acceptance_status)}</td>
            <td><div className="form-actions"><ActionButton permission="settlement_item.void" session={session} disabled={["voided", "archived"].includes(String(item.status))} onClick={() => onItemAction("void_item", item)}>Void</ActionButton><ActionButton permission="settlement_item.archive" session={session} disabled={String(item.status) === "archived"} onClick={() => onItemAction("archive_item", item)}>Archive</ActionButton></div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

function SettlementLifecycleModal({ type, settlementId, settlement, related, blockers, session, item, onClose, onSaved }: { type: string; settlementId: string; settlement: SyncRecord; related: RelatedData; blockers: SyncRecord[]; session: Session; item: SyncRecord | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({ item_type: String(settlement.settlement_type) === "contractor_payable" ? "contractor_payable" : "customer_billable" });
  const [error, setError] = useState("");
  const itemAction = type === "void_item" || type === "archive_item";
  const blockedReady = type === "approve" && blockers.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blockedReady) return;
    setError("");
    try {
      if (type === "add_item") {
        await syncosFetch(`/settlements/${settlementId}/items`, { method: "POST", body: addItemBody(form), token: session.token });
      } else if (itemAction && item?.id) {
        await syncosFetch(`/settlement-items/${item.id}/${type === "void_item" ? "void" : "archive"}`, { method: "POST", body: itemModalBody(type, form), token: session.token });
      } else {
        await syncosFetch(`/settlements/${settlementId}/${settlementModalPath(type)}`, { method: "POST", body: settlementModalBody(type, form), token: session.token });
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
        {blockedReady ? <div className="error-banner">Resolve blockers before approval.</div> : null}
        {type === "add_item" ? <AddItemFields form={form} setForm={setForm} billableItems={related.billableItems} /> : null}
        {type === "approve" ? <><label>Approval Note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><WarningList title="Backend Warnings" rows={arrayValue(settlement.warnings)} empty="No warnings returned." /><WarningList title="Backend Blockers" rows={blockers} empty="No blockers returned." /></> : null}
        {type === "reject" ? <><label>Rejection Reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejection Note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {type === "invoice_ready" || type === "payable_ready" ? <><label>Ready Note<textarea value={form.ready_note ?? ""} onChange={(event) => setForm({ ...form, ready_note: event.target.value })} required /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><div className="warning-box">{type === "invoice_ready" ? "Mark Invoice Ready does not create invoice, invoice item, AR, payment, or cash records." : "Mark Payable Ready does not create payment, payroll, ACH, card payout, or bank transaction records."}</div></> : null}
        {type === "hold" ? <><label>Hold Reason<textarea value={form.hold_reason ?? ""} onChange={(event) => setForm({ ...form, hold_reason: event.target.value })} required /></label><label>Hold Note<textarea value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label></> : null}
        {type === "release" ? <label>Release Note<textarea value={form.release_note ?? ""} onChange={(event) => setForm({ ...form, release_note: event.target.value })} required /></label> : null}
        {type === "dispute" ? <><label>Dispute Reason<textarea value={form.dispute_reason ?? ""} onChange={(event) => setForm({ ...form, dispute_reason: event.target.value })} required /></label><label>Dispute Note<textarea value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}
        {type === "resolve" ? <><label>Resolution Note<textarea value={form.resolution_note ?? ""} onChange={(event) => setForm({ ...form, resolution_note: event.target.value })} required /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label></> : null}
        {type === "void" ? <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {type === "archive" ? <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {type === "void_item" ? <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></> : null}
        {type === "archive_item" ? <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></> : null}
        {["recalculate", "submit_review", "start_review"].includes(type) ? <div className="warning-box">This action uses the Settlement backend lifecycle route and creates no invoice or payment records.</div> : null}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={blockedReady}>Submit</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function AddItemFields({ form, setForm, billableItems }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; billableItems: SyncRecord[] }) {
  return <div className="form-grid"><Select label="Billable Item" value={form.billable_item_id ?? ""} options={["", ...billableItems.map((row) => String(row.id))]} labels={labelsFor(billableItems, "work_order_name")} onChange={(billable_item_id) => setForm({ ...form, billable_item_id })} /><Select label="Item Type" value={form.item_type ?? "customer_billable"} options={itemTypes} onChange={(item_type) => setForm({ ...form, item_type })} /><label>Quantity<input type="number" min="0" step="0.01" value={form.quantity ?? ""} onChange={(event) => setForm({ ...form, quantity: event.target.value })} required /></label><label>Unit Rate<input type="number" min="0" step="0.01" value={form.unit_rate ?? ""} onChange={(event) => setForm({ ...form, unit_rate: event.target.value })} /></label><label>Contractor Rate<input type="number" min="0" step="0.01" value={form.contractor_rate ?? ""} onChange={(event) => setForm({ ...form, contractor_rate: event.target.value })} /></label><label>Retainage Percent<input type="number" min="0" max="100" step="0.01" value={form.retainage_percent ?? ""} onChange={(event) => setForm({ ...form, retainage_percent: event.target.value })} /></label><label>Deduction Amount<input type="number" min="0" step="0.01" value={form.deduction_amount ?? ""} onChange={(event) => setForm({ ...form, deduction_amount: event.target.value })} /></label><label>Chargeback Amount<input type="number" min="0" step="0.01" value={form.chargeback_amount ?? ""} onChange={(event) => setForm({ ...form, chargeback_amount: event.target.value })} /></label><label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><div className="warning-box">Settlement item creation consumes ready billable items and creates no invoice or payment records.</div></div>;
}

function SettlementFormFields({ form, setForm, related, includeCreate = false, disabled = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; related: RelatedData; includeCreate?: boolean; disabled?: boolean }) {
  return <div className="form-grid">{includeCreate ? <Select label="Settlement Type" value={form.settlement_type ?? "customer_billable"} options={settlementTypes} onChange={(settlement_type) => setForm({ ...form, settlement_type })} disabled={disabled} /> : null}<Select label="Customer Organization" value={form.customer_organization_id ?? ""} options={["", ...related.customers.map((row) => String(row.id))]} labels={labelsFor(related.customers)} onChange={(customer_organization_id) => setForm({ ...form, customer_organization_id })} disabled={disabled} /><Select label="Capacity Provider" value={form.capacity_provider_id ?? ""} options={["", ...related.providers.map((row) => String(row.id))]} labels={labelsFor(related.providers)} onChange={(capacity_provider_id) => setForm({ ...form, capacity_provider_id })} disabled={disabled} /><Select label="Project" value={form.project_id ?? ""} options={["", ...related.projects.map((row) => String(row.id))]} labels={labelsFor(related.projects)} onChange={(project_id) => setForm({ ...form, project_id })} disabled={disabled || !includeCreate} /><label>Work Order ID<input disabled={disabled || !includeCreate} value={form.work_order_id ?? ""} onChange={(event) => setForm({ ...form, work_order_id: event.target.value })} /></label><label>Settlement Period Start<input disabled={disabled} type="date" value={form.settlement_period_start ?? ""} onChange={(event) => setForm({ ...form, settlement_period_start: event.target.value })} /></label><label>Settlement Period End<input disabled={disabled} type="date" value={form.settlement_period_end ?? ""} onChange={(event) => setForm({ ...form, settlement_period_end: event.target.value })} /></label><label>Invoice Cycle<input disabled={disabled} value={form.invoice_cycle ?? ""} onChange={(event) => setForm({ ...form, invoice_cycle: event.target.value })} /></label><label>Pay Cycle<input disabled={disabled} value={form.pay_cycle ?? ""} onChange={(event) => setForm({ ...form, pay_cycle: event.target.value })} /></label>{!includeCreate ? <><label>Override Reasons JSON<textarea disabled={disabled} value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label><label>Hold Note<textarea disabled={disabled} value={form.hold_note ?? ""} onChange={(event) => setForm({ ...form, hold_note: event.target.value })} /></label><label>Dispute Note<textarea disabled={disabled} value={form.dispute_note ?? ""} onChange={(event) => setForm({ ...form, dispute_note: event.target.value })} /></label></> : null}</div>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return <section className="workspace-panel"><div className="section-toolbar"><div><h2>Session</h2><p className="muted">Paste a JWT and comma-separated permissions to test settlement actions.</p></div><button type="button" onClick={session.applyDefaults}>Use settlement defaults</button></div><div className="session-grid"><input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" /><input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" /></div></section>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>([]);
  useEffect(() => {
    setTokenState(readToken());
    setPermissionsState(readPermissions().length ? readPermissions() : settlementDefaultPermissions);
  }, []);
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  return { token, permissions, setToken, setPermissions, applyDefaults: () => setPermissions(settlementDefaultPermissions) };
}

async function loadRelated(token: string): Promise<RelatedData> {
  const [billableItems, customers, providers, projects] = await Promise.all([
    optionalList("/billable-items?status=ready_for_settlement&archived=false", token),
    optionalList("/organizations", token),
    optionalList("/capacity-providers", token),
    optionalList("/projects", token),
  ]);
  return { billableItems, customers, providers, projects };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function buildSettlementPayload(form: Record<string, string>) {
  return prune({ settlement_type: form.settlement_type, customer_organization_id: form.customer_organization_id, capacity_provider_id: form.capacity_provider_id, project_id: form.project_id, work_order_id: form.work_order_id, settlement_period_start: form.settlement_period_start, settlement_period_end: form.settlement_period_end, invoice_cycle: form.invoice_cycle, pay_cycle: form.pay_cycle });
}

function buildSettlementPatchPayload(form: Record<string, string>) {
  return prune({ settlement_period_start: form.settlement_period_start, settlement_period_end: form.settlement_period_end, invoice_cycle: form.invoice_cycle, pay_cycle: form.pay_cycle, customer_organization_id: form.customer_organization_id, capacity_provider_id: form.capacity_provider_id, override_reasons: parseJsonField(form.override_reasons, "override_reasons"), hold_note: form.hold_note, dispute_note: form.dispute_note });
}

function addItemBody(form: Record<string, string>) {
  return prune({ billable_item_id: form.billable_item_id, item_type: form.item_type, quantity: form.quantity, unit_rate: form.unit_rate, contractor_rate: form.contractor_rate, retainage_percent: form.retainage_percent, deduction_amount: form.deduction_amount, chargeback_amount: form.chargeback_amount, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
}

function settlementModalBody(type: string, form: Record<string, string>) {
  if (type === "approve") return prune({ approval_note: form.approval_note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "reject") return prune({ rejection_reason: form.rejection_reason, rejection_note: form.rejection_note });
  if (type === "invoice_ready" || type === "payable_ready") return prune({ ready_note: form.ready_note, override_reasons: parseJsonField(form.override_reasons, "override_reasons") });
  if (type === "hold") return prune({ hold_reason: form.hold_reason, hold_note: form.hold_note });
  if (type === "release") return prune({ release_note: form.release_note });
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

function settlementModalPath(type: string) {
  if (type === "submit_review") return "submit-review";
  if (type === "start_review") return "start-review";
  if (type === "invoice_ready") return "mark-invoice-ready";
  if (type === "payable_ready") return "mark-payable-ready";
  if (type === "hold") return "place-hold";
  if (type === "release") return "release-hold";
  if (type === "resolve") return "resolve-dispute";
  if (type === "recalculate") return "recalculate-readiness";
  return type;
}

function modalTitle(type: string) {
  if (type === "add_item") return "Add Settlement Item";
  if (type === "submit_review") return "Submit Review";
  if (type === "start_review") return "Start Review";
  if (type === "invoice_ready") return "Mark Invoice Ready";
  if (type === "payable_ready") return "Mark Payable Ready";
  if (type === "hold") return "Place Hold";
  if (type === "release") return "Release Hold";
  if (type === "resolve") return "Resolve Dispute";
  if (type === "recalculate") return "Recalculate Readiness";
  if (type === "void_item") return "Void Settlement Item";
  if (type === "archive_item") return "Archive Settlement Item";
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

const settlementQueues = [
  { id: "draft", label: "Draft", helper: "Settlement records still being prepared." },
  { id: "submitted_for_review", label: "Submitted for Review", helper: "Settlements waiting for finance review." },
  { id: "needs_recalculation", label: "Needs Recalculation", helper: "Settlements that require readiness or total refresh." },
  { id: "rejected", label: "Rejected", helper: "Settlements returned from review and needing correction." },
  { id: "approved", label: "Approved", helper: "Settlements approved internally but not yet invoice-ready." },
  { id: "invoice_ready", label: "Invoice Ready", helper: "Settlements ready for the invoice workflow." },
  { id: "disputed", label: "Disputed", helper: "Settlements blocked by dispute state." },
  { id: "archived", label: "Archived", helper: "Closed or removed settlements." },
];

function matchesSettlementQueue(row: SyncRecord, queue: string) {
  if (queue === "submitted_for_review") return ["ready_for_review", "under_review"].includes(String(row.status));
  if (queue === "needs_recalculation") return row.readiness_status === "blocked" || row.readiness_status === "not_ready" || arrayValue(row.blockers).length > 0;
  if (queue === "rejected") return row.status === "rejected";
  if (queue === "approved") return row.status === "approved" && !row.invoice_ready;
  if (queue === "invoice_ready") return row.status === "invoice_ready" || Boolean(row.invoice_ready);
  if (queue === "disputed") return row.status === "disputed" || Boolean(row.dispute_reason);
  if (queue === "archived") return row.status === "archived";
  return ["draft", "assembling"].includes(String(row.status));
}

function emptySettlementQueue(queue: string) {
  if (queue === "submitted_for_review") return "No settlements are waiting for review.";
  if (queue === "needs_recalculation") return "No settlements currently need recalculation.";
  if (queue === "rejected") return "No rejected settlements need correction.";
  if (queue === "approved") return "No approved settlements are waiting for invoice readiness.";
  if (queue === "invoice_ready") return "No settlements are invoice-ready yet.";
  if (queue === "disputed") return "No settlement disputes are open.";
  if (queue === "archived") return "No archived settlements in this queue.";
  return "No draft settlements need attention.";
}

function nextSettlementAction(row: SyncRecord) {
  if (row.status === "disputed") return "Resolve Dispute";
  if (row.status === "rejected") return "Correct settlement";
  if (row.readiness_status === "blocked" || arrayValue(row.blockers).length > 0) return "Recalculate Readiness";
  if (["ready_for_review", "under_review"].includes(String(row.status))) return "Review settlement";
  if (row.status === "approved" && !row.invoice_ready) return "Mark Invoice Ready";
  if (row.invoice_ready || row.status === "invoice_ready") return "Prepare invoice workflow";
  return "Submit Review";
}

function firstHref(rows: SyncRecord[], fallback: string) {
  const first = rows[0];
  return first?.id ? `${fallback}/${first.id}` : fallback;
}

function matchesFilters(row: SyncRecord, filters: Record<string, string>) {
  if (filters.negativeMargin && boolMismatch(numberValue(row.estimated_margin_amount, 0) < 0, filters.negativeMargin)) return false;
  if (filters.retainageApplies && boolMismatch(numberValue(row.retainage_amount, 0) > 0, filters.retainageApplies)) return false;
  if (filters.hasBlockers && boolMismatch(arrayValue(row.blockers).length > 0 || row.readiness_status === "blocked", filters.hasBlockers)) return false;
  return true;
}

function sortSettlements(rows: SyncRecord[], sort = "updated_desc") {
  return [...rows].sort((a, b) => {
    if (sort === "readiness_asc") return numberValue(a.readiness_score, -1) - numberValue(b.readiness_score, -1);
    if (sort === "readiness_desc") return numberValue(b.readiness_score, -1) - numberValue(a.readiness_score, -1);
    if (sort === "gross_amount_desc") return numberValue(b.gross_billable_amount, -1) - numberValue(a.gross_billable_amount, -1);
    if (sort === "net_amount_desc") return numberValue(b.net_settlement_amount, -1) - numberValue(a.net_settlement_amount, -1);
    if (sort === "margin_asc") return numberValue(a.estimated_margin_amount, 0) - numberValue(b.estimated_margin_amount, 0);
    if (sort === "status") return String(a.status).localeCompare(String(b.status));
    if (sort === "settlement_number") return String(a.settlement_number ?? "").localeCompare(String(b.settlement_number ?? ""));
    const blockerPriority = Number(arrayValue(b.blockers).length > 0 || b.readiness_status === "blocked") - Number(arrayValue(a.blockers).length > 0 || a.readiness_status === "blocked");
    if (blockerPriority) return blockerPriority;
    const interruptionPriority = interruptionRank(b.status) - interruptionRank(a.status);
    if (interruptionPriority) return interruptionPriority;
    const readiness = numberValue(a.readiness_score, -1) - numberValue(b.readiness_score, -1);
    if (readiness) return readiness;
    return dateTime(b.updated_at) - dateTime(a.updated_at);
  });
}

function interruptionRank(status: unknown) {
  return ["held", "disputed"].includes(String(status)) ? 2 : ["draft", "assembling"].includes(String(status)) ? 1 : 0;
}

function settlementChecklist(settlement: SyncRecord, items: SyncRecord[]): [string, boolean][] {
  return [["Settlement has items", items.length > 0], ["Billable items are ready", items.every((item) => item.billable_item_id)], ["Customer billable amount reviewed", numberValue(settlement.gross_billable_amount, 0) >= 0], ["Contractor payable reviewed", settlement.contractor_payable_amount !== undefined], ["Retainage reviewed", settlement.retainage_amount !== undefined], ["Deductions reviewed", settlement.deduction_amount !== undefined], ["Chargebacks reviewed", settlement.chargeback_amount !== undefined], ["Margin reviewed", settlement.estimated_margin_amount !== undefined], ["No hold", settlement.status !== "held" && !settlement.hold_reason], ["No dispute", settlement.status !== "disputed" && !settlement.dispute_reason], ["Invoice not created", !settlement.invoice_item_id], ["Payment/payroll not created", !settlement.payable_item_id]];
}

function settlementRecord(detail: SettlementDetailShape): SyncRecord {
  return detail.settlement ?? (detail as SyncRecord);
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

function percent(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet";
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)}%` : String(value);
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
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.settlement_number ?? row.work_order_name, String(row.id))]));
}

function viewOnly(item: SyncRecord) {
  return ["voided", "archived", "invoice_created_later", "payable_created_later"].includes(String(item.status));
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

function acceptanceSummary(items: SyncRecord[], field: string) {
  return items.map((item) => ({ item: item.id, item_type: item.item_type, [field]: item[field] }));
}

function actionNotice(type: string) {
  if (type === "invoice_ready") return "Settlement marked invoice ready. No invoice, invoice item, AR, payment, or cash record was created.";
  if (type === "payable_ready") return "Settlement marked payable ready. No payment, payroll, ACH, card payout, or bank transaction was created.";
  if (type === "add_item") return "Settlement item added from a billable item. No invoice or payment record was created.";
  if (type === "approve") return "Settlement approved. No invoice or payable record was created.";
  return "Settlement action completed.";
}

function plainError(message: string) {
  if (!message) return "Settlement action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("not found")) return "Settlement not found or you do not have access.";
  if (message.includes("at least one item")) return "Settlement requires at least one item.";
  if (message.includes("ready_for_settlement") || message.includes("billable")) return "Billable item must be ready for settlement.";
  if (message.includes("duplicate")) return "Duplicate settlement item is not allowed without override.";
  if (message.includes("quantity")) return "Quantity cannot exceed billable quantity without override.";
  if (message.includes("customer_rate") || message.includes("unit_rate")) return "Customer rate is required.";
  if (message.includes("contractor_rate")) return "Contractor rate is required for payable readiness.";
  if (message.includes("hold")) return "Hold reason is required.";
  if (message.includes("dispute")) return "Dispute reason is required.";
  if (message.includes("reject")) return "Rejection reason is required.";
  if (message.includes("void")) return "Void reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

const settlementDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "settlement.read",
  "settlement.create",
  "settlement.update",
  "settlement.recalculate_readiness",
  "settlement.add_item",
  "settlement.remove_item",
  "settlement.submit_review",
  "settlement.start_review",
  "settlement.approve",
  "settlement.reject",
  "settlement.place_hold",
  "settlement.release_hold",
  "settlement.dispute",
  "settlement.resolve_dispute",
  "settlement.mark_invoice_ready",
  "settlement.mark_payable_ready",
  "settlement.void",
  "settlement.archive",
  "settlement.timeline.read",
  "settlement.audit.read",
  "settlement_item.read",
  "settlement_item.create",
  "settlement_item.update",
  "settlement_item.void",
  "settlement_item.archive",
  "billable_item.read",
  "qc_review.read",
  "production.read",
  "production_record.read",
  "work_order.read",
  "project.read",
  "organization.read",
  "capacity_provider.read",
  "crew.read",
];

const emptyRelated: RelatedData = { billableItems: [], customers: [], providers: [], projects: [] };
