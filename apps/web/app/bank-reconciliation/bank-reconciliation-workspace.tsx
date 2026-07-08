"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CommandShell, ObjectTable, Panel } from "../dashboard-components";
import { dateValue, defaultOpportunityPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../intelligence/api";
import { DetailBoundaryNotice, DetailNextActionCard, ReadOnlyBanner } from "../operator-page-templates";

const accountTypes = ["operating", "payroll", "tax", "savings", "escrow", "credit_card", "other"];
const accountStatuses = ["active", "inactive", "closed", "archived"];
const directions = ["debit", "credit"];
const transactionTypes = ["payment_out", "deposit_in", "fee", "transfer", "reversal", "chargeback", "adjustment", "interest", "unknown"];
const reconciliationStatuses = ["unreconciled", "matched", "partially_matched", "exception", "ignored", "archived"];
const clearedStatuses = ["pending", "posted", "cleared", "returned", "reversed", "unknown"];
const exceptionStatuses = ["none", "open", "under_review", "resolved", "ignored"];
const sourceTypes = ["manual", "statement_import_later", "bank_feed_later", "processor_import_later"];
const paymentMethods = ["ach", "wire", "check", "card", "card_payout", "cash", "lockbox", "portal", "zelle", "manual", "payroll_provider", "other"];
const matchTypes = ["payment_batch", "payment_item", "cash_receipt", "payment_application_context", "manual_adjustment", "unknown"];
const matchedObjectTypes = ["payment_batch", "payment_item", "cash_receipt", "payment_application", "invoice", "manual"];
const matchStatuses = ["proposed", "reviewed", "approved", "rejected", "voided", "archived"];
const matchConfidences = ["exact", "high", "medium", "low", "manual"];
const transactionTabs = ["overview", "match_payment_batch", "match_payment_item", "match_cash_receipt", "payment_application_context", "matches", "exception", "reconciliation_status", "timeline", "audit", "future_accounting_export", "future_processor_settlement"];
const accountTabs = ["overview", "transactions", "reconciliation_summary", "exceptions", "timeline", "audit", "future_bank_feed", "future_statement_import"];

type Session = ReturnType<typeof useSession>;

type LandingData = {
  accounts: SyncRecord[];
  transactions: SyncRecord[];
  matches: SyncRecord[];
};

type AccountDetailShape = {
  bank_account?: SyncRecord;
  transaction_summary?: SyncRecord;
  reconciliation_summary?: SyncRecord;
  recent_transactions?: SyncRecord[];
  warnings?: unknown[];
  blockers?: unknown[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type TransactionDetailShape = {
  bank_transaction?: SyncRecord;
  bank_account_context?: SyncRecord;
  reconciliation_matches?: SyncRecord[];
  matched_payment_context?: unknown;
  matched_cash_context?: unknown;
  exception_summary?: unknown;
  boundary_summary?: unknown;
  warnings?: unknown[];
  blockers?: unknown[];
  recommended_next_action?: string;
  timeline_available?: boolean;
  audit_allowed?: boolean;
  _timeline?: SyncRecord[];
  _audit?: SyncRecord[];
};

type MatchDetailShape = {
  reconciliation_match?: SyncRecord;
  bank_transaction_context?: SyncRecord;
  matched_object_context?: unknown;
  payment_context?: unknown;
  cash_context?: unknown;
  invoice_context?: unknown;
  review_approval_summary?: unknown;
  boundary_summary?: unknown;
  audit_allowed?: boolean;
  _audit?: SyncRecord[];
};

type ReconciliationQueueKey = "unmatchedCredits" | "unmatchedDebits" | "reviewMatches" | "openExceptions" | "resolvedExceptions" | "ignored" | "matched" | "archived";

const reconciliationQueueDefinitions: Array<{ key: ReconciliationQueueKey; label: string; helper: string; empty: string }> = [
  { key: "unmatchedCredits", label: "Unmatched Credits", helper: "Credit transactions that may need cash receipt matching.", empty: "No unmatched credit transactions need review." },
  { key: "unmatchedDebits", label: "Unmatched Debits", helper: "Debit transactions that may need payment batch matching.", empty: "No unmatched debit transactions need review." },
  { key: "reviewMatches", label: "Review Matches", helper: "Matches that need review or confirmation.", empty: "No reconciliation matches need review." },
  { key: "openExceptions", label: "Open Exceptions", helper: "Transactions or matches flagged for investigation.", empty: "No reconciliation exceptions are open." },
  { key: "resolvedExceptions", label: "Resolved Exceptions", helper: "Exceptions resolved and retained for audit/history.", empty: "No resolved exceptions in this queue." },
  { key: "ignored", label: "Ignored", helper: "Transactions intentionally removed from active reconciliation queues.", empty: "No ignored transactions in this queue." },
  { key: "matched", label: "Matched", helper: "Transactions matched to SyncOS records.", empty: "No matched transactions in this queue." },
  { key: "archived", label: "Archived", helper: "Closed or removed records retained for audit.", empty: "No archived accounts or transactions in this queue." },
];

export function BankReconciliationLanding() {
  const session = useSession();
  const [data, setData] = useState<LandingData>({ accounts: [], transactions: [], matches: [] });
  const [accountFilters, setAccountFilters] = useState<Record<string, string>>({ archived: "false" });
  const [transactionFilters, setTransactionFilters] = useState<Record<string, string>>({ archived: "false", sort: "exception_first" });
  const [matchFilters, setMatchFilters] = useState<Record<string, string>>({ archived: "false" });
  const [activeQueue, setActiveQueue] = useState<ReconciliationQueueKey>("unmatchedCredits");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [accounts, transactions, matches] = await Promise.all([
        syncosFetch<SyncRecord[]>(`/bank-accounts?${queryString(accountFilters)}`, { token: session.token }),
        syncosFetch<SyncRecord[]>(`/bank-transactions?${queryString(transactionFilters)}`, { token: session.token }),
        syncosFetch<SyncRecord[]>(`/reconciliation-matches?${queryString(matchFilters)}`, { token: session.token }),
      ]);
      setData({ accounts, transactions, matches });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session.token) void load();
    else setLoading(false);
  }, [session.token, accountFilters.archived, transactionFilters.archived, matchFilters.archived]);

  const visibleTransactions = useMemo(() => sortTransactions(data.transactions.filter((row) => reconciliationTransactionMatches(row, activeQueue)), transactionFilters.sort), [data.transactions, activeQueue, transactionFilters.sort]);
  const visibleMatches = useMemo(() => data.matches.filter((row) => reconciliationMatchMatches(row, activeQueue)), [data.matches, activeQueue]);
  const visibleAccounts = useMemo(() => data.accounts.filter((row) => activeQueue !== "archived" || String(row.status) === "archived"), [data.accounts, activeQueue]);
  const selectedQueue = reconciliationQueueDefinitions.find((queue) => queue.key === activeQueue) ?? reconciliationQueueDefinitions[0];

  function selectQueue(queue: ReconciliationQueueKey) {
    setActiveQueue(queue);
    setAccountFilters({ archived: queue === "archived" ? "true" : "false" });
    setTransactionFilters({ archived: queue === "archived" ? "true" : "false", sort: "exception_first" });
    setMatchFilters({ archived: queue === "archived" ? "true" : "false" });
  }

  return (
    <BankShell title="Bank Reconciliation Workbench" purpose="Match bank-side evidence to SyncOS cash and payment records, review exceptions, and keep reconciliation status visible without connecting to banks or moving money.">
      <SessionPanel session={session} />
      <div className="warning-box">Bank Reconciliation verifies internal matches against bank-side evidence. SyncOS does not import bank feeds, connect to banks, move money, create cash receipts, execute payments, or post accounting entries.</div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {!session.token ? <div className="empty-state">Login required. Authentication is required before this workspace can load.</div> : null}
      {loading ? <div className="empty-state">Loading bank reconciliation workspace...</div> : null}
      {session.token && !loading ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Today&apos;s reconciliation work</h2>
                <p className="muted">Prioritize unmatched credits, unmatched debits, exceptions, and match reviews without implying SyncOS imported bank data or moved money.</p>
              </div>
              <div className="form-actions">
                <Link className="primary-button" href="/bank-reconciliation/accounts/new" aria-disabled={!hasPermission(session.permissions, "bank_account.create")}>Create Bank Account</Link>
                <Link className="primary-button" href="/bank-reconciliation/transactions/new" aria-disabled={!hasPermission(session.permissions, "bank_transaction.create")}>Create Manual Bank Transaction</Link>
              </div>
            </div>
            <div className="summary-grid">
              {reconciliationQueueDefinitions.map((queue) => <SummaryCard key={queue.key} label={queue.label} value={countReconciliationQueue(data, queue.key)} helper={queue.helper} active={activeQueue === queue.key} onClick={() => selectQueue(queue.key)} />)}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Reconciliation queues</h2>
                <p className="muted">{selectedQueue.helper}</p>
              </div>
              <button type="button" onClick={() => { setActiveQueue("unmatchedCredits"); setAccountFilters({ archived: "false" }); setTransactionFilters({ archived: "false", sort: "exception_first" }); setMatchFilters({ archived: "false" }); }}>Reset</button>
            </div>
            <div className="tab-row" role="tablist" aria-label="Bank reconciliation queues">
              {reconciliationQueueDefinitions.map((queue) => <button key={queue.key} type="button" role="tab" aria-selected={activeQueue === queue.key} onClick={() => selectQueue(queue.key)}>{queue.label}</button>)}
            </div>
            <details className="filter-drawer">
              <summary>Advanced filters</summary>
              <LandingFilters accountFilters={accountFilters} setAccountFilters={setAccountFilters} transactionFilters={transactionFilters} setTransactionFilters={setTransactionFilters} matchFilters={matchFilters} setMatchFilters={setMatchFilters} accounts={data.accounts} />
            </details>
          </section>

          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Bank Account Visibility</h2>
                <p className="muted">Account records are internal control references. They do not connect SyncOS to a bank.</p>
              </div>
              <span>{visibleAccounts.length} shown</span>
            </div>
            <BankAccountTable rows={visibleAccounts} />
          </section>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{selectedQueue.label}</h2>
                <p className="muted">Matching verifies relationship state only. It does not create receipts, execute payments, or post accounting entries.</p>
              </div>
              <span>{visibleTransactions.length} shown</span>
            </div>
            {!data.transactions.length ? <div className="empty-state">No bank transactions yet. Create manual bank-side evidence before reconciliation begins.</div> : visibleTransactions.length ? <BankTransactionTable rows={visibleTransactions} /> : <div className="empty-state">{selectedQueue.empty}</div>}
          </section>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>Reconciliation Match Visibility</h2>
                <p className="muted">Review proposed, reviewed, approved, rejected, voided, or archived matches without changing external bank or accounting systems.</p>
              </div>
              <span>{visibleMatches.length} shown</span>
            </div>
            {visibleMatches.length ? <MatchTable rows={visibleMatches} /> : <div className="empty-state">{activeQueue === "reviewMatches" ? selectedQueue.empty : "No reconciliation matches in this queue."}</div>}
          </section>
          <FuturePlaceholders />
        </>
      ) : null}
    </BankShell>
  );
}

export function BankAccountCreate() {
  const router = useRouter();
  const session = useSession();
  const [form, setForm] = useState<Record<string, string>>({ account_type: "operating", currency: "USD" });
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/bank-accounts", { method: "POST", body: accountCreatePayload(form), token: session.token });
      router.push(`/bank-reconciliation/accounts/${createdId(created)}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <BankShell title="Create Bank Account" purpose="Create masked bank account context for reconciliation without credentials, feeds, imports, transfers, or treasury workflows.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Never enter full account numbers, online banking credentials, passwords, or API tokens.</div>
        <BankAccountFields form={form} setForm={setForm} includeCreate />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "bank_account.create")}>Create Bank Account</button>
          <Link className="link-button" href="/bank-reconciliation">Cancel</Link>
        </div>
      </form>
    </BankShell>
  );
}

export function BankAccountEdit({ accountId }: { accountId: string }) {
  const router = useRouter();
  const session = useSession();
  const [record, setRecord] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const next = await syncosFetch<SyncRecord>(`/bank-accounts/${accountId}`, { token: session.token });
        setRecord(next);
        setForm(accountForm(next));
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, accountId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/bank-accounts/${accountId}`, { method: "PATCH", body: accountPatchPayload(form), token: session.token });
      router.push(`/bank-reconciliation/accounts/${accountId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <BankShell title="Edit Bank Account" purpose="Edit masked bank account context without credentials, feeds, transfers, imports, or treasury behavior.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Bank account not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">No full account numbers, credentials, passwords, login information, or API tokens are allowed.</div>
          <BankAccountFields form={form} setForm={setForm} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "bank_account.update")}>Save Bank Account</button>
            <Link className="link-button" href={`/bank-reconciliation/accounts/${accountId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </BankShell>
  );
}

export function ManualBankTransactionCreate() {
  const router = useRouter();
  const session = useSession();
  const [accounts, setAccounts] = useState<SyncRecord[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ direction: "debit", currency: "USD", transaction_type: "unknown", source_type: "manual", cleared_status: "posted" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.token) void optionalList("/bank-accounts?archived=false", session.token).then(setAccounts);
  }, [session.token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await syncosFetch<SyncRecord>("/bank-transactions", { method: "POST", body: transactionCreatePayload(form), token: session.token });
      router.push(`/bank-reconciliation/transactions/${createdId(created)}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <BankShell title="Create Manual Bank Transaction" purpose="Record manual bank truth for reconciliation without creating payments, cash receipts, payment applications, invoice updates, or accounting records.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="warning-box">Manual bank transactions are records for reconciliation. They do not move money, create cash receipts, create payments, or update invoice balances.</div>
        <BankTransactionFields form={form} setForm={setForm} accounts={accounts} includeCreate />
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "bank_transaction.create")}>Create Manual Bank Transaction</button>
          <Link className="link-button" href="/bank-reconciliation">Cancel</Link>
        </div>
      </form>
    </BankShell>
  );
}

export function BankTransactionEdit({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const session = useSession();
  const [record, setRecord] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<SyncRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!session.token) return;
      try {
        const [next, nextAccounts] = await Promise.all([
          syncosFetch<SyncRecord>(`/bank-transactions/${transactionId}`, { token: session.token }),
          optionalList("/bank-accounts?archived=false", session.token),
        ]);
        setRecord(next);
        setAccounts(nextAccounts);
        setForm(transactionForm(next));
      } catch (nextError) {
        setError(plainError((nextError as Error).message));
      }
    }
    void load();
  }, [session.token, transactionId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await syncosFetch(`/bank-transactions/${transactionId}`, { method: "PATCH", body: transactionPatchPayload(form), token: session.token });
      router.push(`/bank-reconciliation/transactions/${transactionId}`);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  return (
    <BankShell title="Edit Bank Transaction" purpose="Edit bank transaction review fields without changing payment execution, cash application, invoice balances, accounting, or money movement.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!record ? <div className="empty-state">Bank transaction not found or no access.</div> : (
        <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
          <div className="warning-box">Amount and direction edits after matching rely on backend validation. No money movement, cash receipt creation, or invoice balance update is available here.</div>
          <BankTransactionFields form={form} setForm={setForm} accounts={accounts} />
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, "bank_transaction.update")}>Save Bank Transaction</button>
            <Link className="link-button" href={`/bank-reconciliation/transactions/${transactionId}`}>Cancel</Link>
          </div>
        </form>
      )}
    </BankShell>
  );
}

export function BankAccountDetail({ accountId }: { accountId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<AccountDetailShape | null>(null);
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const [next, timeline, audit] = await Promise.all([
        syncosFetch<AccountDetailShape>(`/bank-accounts/${accountId}/detail`, { token: session.token }),
        optionalList(`/bank-accounts/${accountId}/timeline`, session.token),
        optionalList(`/bank-accounts/${accountId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, accountId]);

  const account = detail?.bank_account;
  const transactions = detail?.recent_transactions ?? [];

  return (
    <BankShell title="Bank Account Detail" purpose="Show bank account context and reconciliation health without bank feeds, statement imports, or treasury workflows.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!account && session.token && !error ? <div className="empty-state">Bank account not found or no access.</div> : null}
      {account && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(account.account_name, "Bank Account")}</h2>
                <div className="badge-row"><span className="badge">{formatAction(account.account_type)}</span><span className="badge">{formatAction(account.status)}</span><span className="badge">{textValue(account.currency)}</span></div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/bank-reconciliation/accounts/${accountId}/edit`} aria-disabled={!hasPermission(session.permissions, "bank_account.update")}>Edit Account</Link>
                <ActionButton permission="bank_account.archive" session={session} disabled={account.status === "archived"} onClick={() => setModal("archive_account")}>Archive Account</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Opening Balance" value={money(account.opening_balance)} />
              <Metric label="Current Balance Snapshot" value={money(account.current_balance_snapshot)} />
              <Metric label="Last Statement Date" value={dateValue(account.last_statement_date)} />
              <Metric label="Last Reconciled At" value={dateValue(account.last_reconciled_at)} />
              <Metric label="Transaction Count" value={formatCell(account.transaction_count)} />
              <Metric label="Unreconciled Count" value={formatCell(account.unreconciled_count)} />
              <Metric label="Exception Count" value={formatCell(account.exception_count)} />
            </div>
          </section>
          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Account Health</h2>
              <dl className="detail-list">
                <dt>Institution</dt><dd>{textValue(account.institution_name)}</dd>
                <dt>Masked Account</dt><dd>{textValue(account.masked_account_number)}</dd>
                <dt>Routing Last 4</dt><dd>{textValue(account.routing_last4)}</dd>
                <dt>Recommended Next Action</dt><dd>{formatAction(detail.recommended_next_action)}</dd>
              </dl>
              <div className="warning-box">Bank credentials, feeds, transfers, treasury, statement imports, and accounting exports are not available from this workspace.</div>
            </aside>
            <section className="workspace-panel">
              <Tabs tabs={accountTabs} render={(tab) => <AccountTab tab={tab} detail={detail} account={account} transactions={transactions} />} />
            </section>
          </div>
          {modal ? <BankModal type={modal} id={accountId} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice("Bank account action completed without feeds, imports, transfers, treasury, tax, or accounting activity."); }} /> : null}
        </>
      ) : null}
    </BankShell>
  );
}

export function BankTransactionDetail({ transactionId }: { transactionId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<TransactionDetailShape | null>(null);
  const [related, setRelated] = useState<RelatedOptions>({ paymentBatches: [], paymentItems: [], cashReceipts: [], paymentApplications: [] });
  const [modal, setModal] = useState("");
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const [next, options, timeline, audit] = await Promise.all([
        syncosFetch<TransactionDetailShape>(`/bank-transactions/${transactionId}/detail`, { token: session.token }),
        loadRelatedOptions(session.token),
        optionalList(`/bank-transactions/${transactionId}/timeline`, session.token),
        optionalList(`/bank-transactions/${transactionId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _timeline: timeline, _audit: audit });
      setRelated(options);
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, transactionId]);

  const transaction = detail?.bank_transaction;
  const matches = detail?.reconciliation_matches ?? [];

  return (
    <BankShell title="Bank Transaction Detail" purpose="Show bank transaction truth and matching to SyncOS records without creating payment, cash, invoice, accounting, or money-movement workflows.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!transaction && session.token && !error ? <div className="empty-state">Bank transaction not found or no access.</div> : null}
      {transaction && detail ? (
        <>
          {!hasPermission(session.permissions, "bank_transaction.update") ? <ReadOnlyBanner /> : null}
          <DetailNextActionCard
            variant="finance"
            status={formatAction(transaction.reconciliation_status)}
            nextActionLabel={bankTransactionNextAction(transaction)}
            helperText="Review transaction direction, amount, match status, exception state, related SyncOS records, and audit evidence before matching or opening an exception."
            disabled={!hasPermission(session.permissions, "bank_transaction.update")}
            disabledReason="Read-only users cannot perform lifecycle actions."
            boundaryText="Reconciliation matches bank-side evidence to SyncOS records. It does not import bank feeds, move money, create cash, execute payments, or post accounting entries."
          />
          <DetailBoundaryNotice>Reconciliation matches bank-side evidence to SyncOS records. It does not import bank feeds, move money, create cash receipts, execute payments, change invoice balance, or post accounting entries.</DetailBoundaryNotice>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{textValue(transaction.description, "Bank Transaction")}</h2>
                <div className="badge-row"><span className="badge">{formatAction(transaction.direction)}</span><span className="badge">{formatAction(transaction.reconciliation_status)}</span><span className="badge">{formatAction(transaction.cleared_status)}</span><span className="badge">{formatAction(transaction.exception_status)}</span></div>
              </div>
              <div className="form-actions">
                <Link className="link-button" href={`/bank-reconciliation/transactions/${transactionId}/edit`} aria-disabled={!hasPermission(session.permissions, "bank_transaction.update")}>Edit Transaction</Link>
                <ActionButton permission="bank_transaction.match" session={session} disabled={transactionInactive(transaction)} onClick={() => setModal("match_payment_batch")}>Match Payment Batch</ActionButton>
                <ActionButton permission="bank_transaction.match" session={session} disabled={transactionInactive(transaction)} onClick={() => setModal("match_payment_item")}>Match Payment Item</ActionButton>
                <ActionButton permission="bank_transaction.match" session={session} disabled={transactionInactive(transaction)} onClick={() => setModal("match_cash_receipt")}>Match Cash Receipt</ActionButton>
                <ActionButton permission="bank_transaction.open_exception" session={session} disabled={transactionInactive(transaction)} onClick={() => setModal("open_exception")}>Open Exception</ActionButton>
                <ActionButton permission="bank_transaction.resolve_exception" session={session} disabled={transactionInactive(transaction)} onClick={() => setModal("resolve_exception")}>Resolve Exception</ActionButton>
                <ActionButton permission="bank_transaction.ignore" session={session} disabled={transactionInactive(transaction)} onClick={() => setModal("ignore_transaction")}>Ignore Transaction</ActionButton>
                <ActionButton permission="bank_transaction.archive" session={session} disabled={transaction.reconciliation_status === "archived"} onClick={() => setModal("archive_transaction")}>Archive Transaction</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Direction" value={formatAction(transaction.direction)} />
              <Metric label="Amount" value={money(transaction.amount)} />
              <Metric label="Transaction Date" value={dateValue(transaction.transaction_date)} />
              <Metric label="Posted Date" value={dateValue(transaction.posted_date)} />
              <Metric label="Reconciliation Status" value={formatAction(transaction.reconciliation_status)} />
              <Metric label="Cleared Status" value={formatAction(transaction.cleared_status)} />
              <Metric label="Exception Status" value={formatAction(transaction.exception_status)} />
              <Metric label="Active Match Count" value={formatCell(transaction.active_match_count ?? matches.length)} />
              <Metric label="Approved Match Amount" value={money(transaction.approved_match_amount)} />
              <Metric label="Unmatched Amount" value={money(transaction.unmatched_amount)} />
            </div>
            <div className="warning-box">Bank Reconciliation verifies bank truth. Matching does not create payment execution, cash receipts, payment applications, invoice balance changes, GL entries, accounting export, or money movement.</div>
          </section>
          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl className="detail-list">
                <dt>Bank Account</dt><dd>{textValue(detail.bank_account_context?.account_name ?? transaction.bank_account_name ?? transaction.bank_account_id)}</dd>
                <dt>Direction</dt><dd>{formatAction(transaction.direction)}</dd>
                <dt>Amount</dt><dd>{money(transaction.amount)}</dd>
                <dt>Reconciliation</dt><dd>{formatAction(transaction.reconciliation_status)}</dd>
                <dt>Cleared</dt><dd>{formatAction(transaction.cleared_status)}</dd>
                <dt>Exception</dt><dd>{formatAction(transaction.exception_status)}</dd>
                <dt>Recommended Next Action</dt><dd>{formatAction(transaction.recommended_next_action ?? detail.recommended_next_action)}</dd>
              </dl>
              <Checklist items={transactionChecklist(transaction, matches)} />
              <div className="warning-box">No invoice balance changed. No accounting export created. No payment, bank transfer, ACH, wire, card payout, check, or payroll provider workflow exists here.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs" role="tablist" aria-label="Bank transaction detail sections">{transactionTabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}</div>
              <TransactionTab tab={tab} detail={detail} transaction={transaction} matches={matches} related={related} session={session} onAction={setModal} />
            </section>
          </div>
          {modal ? <BankModal type={modal} id={transactionId} related={related} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </BankShell>
  );
}

export function ReconciliationMatchDetail({ matchId }: { matchId: string }) {
  const session = useSession();
  const [detail, setDetail] = useState<MatchDetailShape | null>(null);
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const [next, audit] = await Promise.all([
        syncosFetch<MatchDetailShape>(`/reconciliation-matches/${matchId}/detail`, { token: session.token }),
        optionalList(`/reconciliation-matches/${matchId}/audit-summary`, session.token),
      ]);
      setDetail({ ...next, _audit: audit });
    } catch (nextError) {
      setError(plainError((nextError as Error).message));
    }
  }

  useEffect(() => {
    if (session.token) void load();
  }, [session.token, matchId]);

  const match = detail?.reconciliation_match;

  return (
    <BankShell title="Reconciliation Match Detail" purpose="Review and approve bank-to-SyncOS evidence without accounting export, invoice balance updates, or money movement.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}
      {!match && session.token && !error ? <div className="empty-state">Reconciliation match not found or no access.</div> : null}
      {match && detail ? (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{formatAction(match.match_type)} Match</h2>
                <div className="badge-row"><span className="badge">{formatAction(match.matched_object_type)}</span><span className="badge">{formatAction(match.match_status)}</span><span className="badge">{formatAction(match.match_confidence)}</span></div>
              </div>
              <div className="form-actions">
                <ActionButton permission="reconciliation_match.review" session={session} disabled={matchInactive(match)} onClick={() => setModal("review_match")}>Review</ActionButton>
                <ActionButton permission="reconciliation_match.approve" session={session} disabled={matchInactive(match)} onClick={() => setModal("approve_match")}>Approve</ActionButton>
                <ActionButton permission="reconciliation_match.reject" session={session} disabled={matchInactive(match)} onClick={() => setModal("reject_match")}>Reject</ActionButton>
                <ActionButton permission="reconciliation_match.void" session={session} disabled={matchInactive(match)} onClick={() => setModal("void_match")}>Void</ActionButton>
                <ActionButton permission="reconciliation_match.archive" session={session} disabled={match.match_status === "archived"} onClick={() => setModal("archive_match")}>Archive</ActionButton>
              </div>
            </div>
            <div className="summary-grid">
              <Metric label="Matched Amount" value={money(match.matched_amount)} />
              <Metric label="Variance Amount" value={money(match.variance_amount)} />
              <Metric label="Reviewed At" value={dateValue(match.reviewed_at)} />
              <Metric label="Approved At" value={dateValue(match.approved_at)} />
              <Metric label="Rejected At" value={dateValue(match.rejected_at)} />
            </div>
            <div className="warning-box">Approving a match verifies bank evidence only. It does not create accounting export, GL posting, tax filing, payment execution, cash receipt, payment application, invoice balance change, or money movement.</div>
          </section>
          <div className="organization-layout">
            <Panel title="Match Detail"><dl className="detail-list"><dt>Match Type</dt><dd>{formatAction(match.match_type)}</dd><dt>Matched Object Type</dt><dd>{formatAction(match.matched_object_type)}</dd><dt>Matched Object ID</dt><dd>{textValue(match.matched_object_id)}</dd><dt>Bank Transaction</dt><dd>{transactionLink(match.bank_transaction_id, detail.bank_transaction_context?.description ?? match.bank_transaction_id)}</dd><dt>Match Reason</dt><dd>{textValue(match.match_reason)}</dd><dt>Notes</dt><dd>{textValue(match.notes)}</dd></dl></Panel>
            <Panel title="Context"><JsonBlock value={{ bank_transaction_context: detail.bank_transaction_context, matched_object_context: detail.matched_object_context, payment_context: detail.payment_context, cash_context: detail.cash_context, invoice_context: detail.invoice_context, review_approval_summary: detail.review_approval_summary, boundary_summary: detail.boundary_summary }} />{detail.audit_allowed === false ? <div className="warning-box">You do not have permission to view bank reconciliation audit details.</div> : <ObjectTable rows={detail._audit} columns={["action", "entity_type", "entity_id", "created_at"]} />}</Panel>
          </div>
          {modal ? <BankModal type={modal} id={matchId} session={session} onClose={() => setModal("")} onSaved={async () => { await load(); setNotice(actionNotice(modal)); }} /> : null}
        </>
      ) : null}
    </BankShell>
  );
}

function BankShell({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  const nav = [
    ["/bank-reconciliation", "Bank Account Queue", "active"],
    ["/bank-reconciliation/accounts/new", "Create Bank Account", "active"],
    ["/bank-reconciliation/transactions/new", "Create Manual Transaction", "active"],
    ["#account-detail", "Bank Account Detail", "placeholder"],
    ["#transaction-detail", "Bank Transaction Detail", "placeholder"],
    ["#matches", "Reconciliation Matches", "placeholder"],
    ["#payment-context", "Payment Execution Context", "placeholder"],
    ["#cash-context", "Cash Receipt Context", "placeholder"],
    ["#exceptions", "Exception Management", "placeholder"],
    ["#cleared", "Cleared Status", "placeholder"],
    ["#reconciliation", "Reconciliation Status", "placeholder"],
    ["#timeline", "Timeline", "placeholder"],
    ["#audit", "Audit", "placeholder"],
    ["#future-feed", "Future Bank Feed", "placeholder"],
    ["#future-import", "Future Statement Import", "placeholder"],
    ["#future-processor", "Future Processor Settlement", "placeholder"],
    ["#future-accounting", "Future Accounting Export", "placeholder"],
    ["#future-treasury", "Future Treasury", "placeholder"],
  ];
  return (
    <CommandShell title={title} purpose={purpose}>
      <div className="workspace-layout">
        <aside className="workspace-nav">
          <div className="workspace-nav-title">Bank Reconciliation</div>
          {nav.map(([href, label, state]) => state === "active" ? <Link href={href} key={label}>{label}</Link> : <div className="nav-placeholder" key={label}><span>{label}</span><small>Section</small></div>)}
        </aside>
        <div className="workspace-main">{children}</div>
      </div>
    </CommandShell>
  );
}

function LandingFilters({ accountFilters, setAccountFilters, transactionFilters, setTransactionFilters, matchFilters, setMatchFilters, accounts }: { accountFilters: Record<string, string>; setAccountFilters: (filters: Record<string, string>) => void; transactionFilters: Record<string, string>; setTransactionFilters: (filters: Record<string, string>) => void; matchFilters: Record<string, string>; setMatchFilters: (filters: Record<string, string>) => void; accounts: SyncRecord[] }) {
  return (
    <section className="workspace-panel">
      <h2>Filters</h2>
      <div className="filter-grid">
        <input value={accountFilters.q ?? ""} onChange={(event) => setAccountFilters({ ...accountFilters, q: event.target.value })} placeholder="Search accounts" />
        <Select label="Account Type" value={accountFilters.account_type ?? ""} options={["", ...accountTypes]} onChange={(account_type) => setAccountFilters({ ...accountFilters, account_type })} />
        <Select label="Account Status" value={accountFilters.status ?? ""} options={["", ...accountStatuses]} onChange={(status) => setAccountFilters({ ...accountFilters, status })} />
        <Select label="Accounts Archived" value={accountFilters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setAccountFilters({ ...accountFilters, archived })} />
        <input value={transactionFilters.q ?? ""} onChange={(event) => setTransactionFilters({ ...transactionFilters, q: event.target.value })} placeholder="Search transactions" />
        <Select label="Bank Account" value={transactionFilters.bank_account_id ?? ""} options={["", ...accounts.map((row) => String(row.id))]} labels={labelsFor(accounts, "account_name")} onChange={(bank_account_id) => setTransactionFilters({ ...transactionFilters, bank_account_id })} />
        <Select label="Direction" value={transactionFilters.direction ?? ""} options={["", ...directions]} onChange={(direction) => setTransactionFilters({ ...transactionFilters, direction })} />
        <Select label="Transaction Type" value={transactionFilters.transaction_type ?? ""} options={["", ...transactionTypes]} onChange={(transaction_type) => setTransactionFilters({ ...transactionFilters, transaction_type })} />
        <Select label="Reconciliation" value={transactionFilters.reconciliation_status ?? ""} options={["", ...reconciliationStatuses]} onChange={(reconciliation_status) => setTransactionFilters({ ...transactionFilters, reconciliation_status })} />
        <Select label="Cleared" value={transactionFilters.cleared_status ?? ""} options={["", ...clearedStatuses]} onChange={(cleared_status) => setTransactionFilters({ ...transactionFilters, cleared_status })} />
        <Select label="Exception" value={transactionFilters.exception_status ?? ""} options={["", ...exceptionStatuses]} onChange={(exception_status) => setTransactionFilters({ ...transactionFilters, exception_status })} />
        <label>Transaction From<input type="date" value={transactionFilters.transaction_date_from ?? ""} onChange={(event) => setTransactionFilters({ ...transactionFilters, transaction_date_from: event.target.value })} /></label>
        <label>Transaction To<input type="date" value={transactionFilters.transaction_date_to ?? ""} onChange={(event) => setTransactionFilters({ ...transactionFilters, transaction_date_to: event.target.value })} /></label>
        <label>Posted From<input type="date" value={transactionFilters.posted_date_from ?? ""} onChange={(event) => setTransactionFilters({ ...transactionFilters, posted_date_from: event.target.value })} /></label>
        <label>Posted To<input type="date" value={transactionFilters.posted_date_to ?? ""} onChange={(event) => setTransactionFilters({ ...transactionFilters, posted_date_to: event.target.value })} /></label>
        <label>Amount Min<input type="number" step="0.01" value={transactionFilters.amount_min ?? ""} onChange={(event) => setTransactionFilters({ ...transactionFilters, amount_min: event.target.value })} /></label>
        <label>Amount Max<input type="number" step="0.01" value={transactionFilters.amount_max ?? ""} onChange={(event) => setTransactionFilters({ ...transactionFilters, amount_max: event.target.value })} /></label>
        <Select label="Source Type" value={transactionFilters.source_type ?? ""} options={["", ...sourceTypes]} onChange={(source_type) => setTransactionFilters({ ...transactionFilters, source_type })} />
        <Select label="Transactions Archived" value={transactionFilters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setTransactionFilters({ ...transactionFilters, archived })} />
        <Select label="Sort" value={transactionFilters.sort ?? "exception_first"} options={["updated_desc", "transaction_date_desc", "posted_date_desc", "amount_desc", "exception_first", "unreconciled_first"]} labels={{ updated_desc: "Recently Updated", transaction_date_desc: "Transaction Date Newest", posted_date_desc: "Posted Date Newest", amount_desc: "Amount Highest", exception_first: "Exception First", unreconciled_first: "Unreconciled First" }} onChange={(sort) => setTransactionFilters({ ...transactionFilters, sort })} />
        <input value={matchFilters.q ?? ""} onChange={(event) => setMatchFilters({ ...matchFilters, q: event.target.value })} placeholder="Search matches" />
        <Select label="Match Type" value={matchFilters.match_type ?? ""} options={["", ...matchTypes]} onChange={(match_type) => setMatchFilters({ ...matchFilters, match_type })} />
        <Select label="Matched Object" value={matchFilters.matched_object_type ?? ""} options={["", ...matchedObjectTypes]} onChange={(matched_object_type) => setMatchFilters({ ...matchFilters, matched_object_type })} />
        <Select label="Match Status" value={matchFilters.match_status ?? ""} options={["", ...matchStatuses]} onChange={(match_status) => setMatchFilters({ ...matchFilters, match_status })} />
        <Select label="Match Confidence" value={matchFilters.match_confidence ?? ""} options={["", ...matchConfidences]} onChange={(match_confidence) => setMatchFilters({ ...matchFilters, match_confidence })} />
        <Select label="Matches Archived" value={matchFilters.archived ?? "false"} options={["false", "true"]} onChange={(archived) => setMatchFilters({ ...matchFilters, archived })} />
      </div>
    </section>
  );
}

function AccountTab({ tab, detail, account, transactions }: { tab: string; detail: AccountDetailShape; account: SyncRecord; transactions: SyncRecord[] }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Account Name</dt><dd>{textValue(account.account_name)}</dd><dt>Account Type</dt><dd>{formatAction(account.account_type)}</dd><dt>Institution</dt><dd>{textValue(account.institution_name)}</dd><dt>Masked Account Number</dt><dd>{textValue(account.masked_account_number)}</dd><dt>Currency</dt><dd>{textValue(account.currency)}</dd><dt>Status</dt><dd>{formatAction(account.status)}</dd><dt>Notes</dt><dd>{textValue(account.notes)}</dd><dt>Created</dt><dd>{dateValue(account.created_at)}</dd><dt>Updated</dt><dd>{dateValue(account.updated_at)}</dd></dl></Panel>;
  if (tab === "transactions") return <Panel title="Transactions"><BankTransactionTable rows={transactions} /></Panel>;
  if (tab === "reconciliation_summary") return <Panel title="Reconciliation Summary"><JsonBlock value={detail.reconciliation_summary} /><div className="warning-box">Reconciliation status is verification context only and does not create accounting export or treasury activity.</div></Panel>;
  if (tab === "exceptions") return <Panel title="Exceptions"><ObjectTable rows={transactions.filter((row) => row.exception_status === "open" || row.reconciliation_status === "exception")} columns={["transaction_date", "direction", "amount", "description", "exception_status", "exception_reason"]} /></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline} columns={["event_type", "aggregate_type", "aggregate_id", "created_at"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail.audit_allowed === false ? <div className="warning-box">You do not have permission to view bank reconciliation audit details.</div> : <ObjectTable rows={detail._audit} columns={["action", "entity_type", "entity_id", "created_at"]} />}</Panel>;
  if (tab === "future_bank_feed") return <Panel title="Future Bank Feed"><div className="warning-box">Bank feed integration is not available in this sprint. Bank credentials and API tokens must not be entered.</div></Panel>;
  return <Panel title="Future Statement Import"><div className="warning-box">Statement import is not available in this sprint. Manual bank transactions are supported for controlled reconciliation.</div></Panel>;
}

function TransactionTab({ tab, detail, transaction, matches, related, session, onAction }: { tab: string; detail: TransactionDetailShape; transaction: SyncRecord; matches: SyncRecord[]; related: RelatedOptions; session: Session; onAction: (type: string) => void }) {
  if (tab === "overview") return <Panel title="Overview"><dl className="detail-list"><dt>Bank Account</dt><dd>{textValue(detail.bank_account_context?.account_name ?? transaction.bank_account_name)}</dd><dt>Transaction Date</dt><dd>{dateValue(transaction.transaction_date)}</dd><dt>Posted Date</dt><dd>{dateValue(transaction.posted_date)}</dd><dt>Direction</dt><dd>{formatAction(transaction.direction)}</dd><dt>Amount</dt><dd>{money(transaction.amount)}</dd><dt>Currency</dt><dd>{textValue(transaction.currency)}</dd><dt>Description</dt><dd>{textValue(transaction.description)}</dd><dt>Bank Reference</dt><dd>{textValue(transaction.bank_reference)}</dd><dt>External Transaction ID</dt><dd>{textValue(transaction.external_transaction_id)}</dd><dt>Payment Method</dt><dd>{formatAction(transaction.payment_method)}</dd><dt>Transaction Type</dt><dd>{formatAction(transaction.transaction_type)}</dd><dt>Source Type</dt><dd>{formatAction(transaction.source_type)}</dd><dt>Notes</dt><dd>{textValue(transaction.notes)}</dd><dt>Created</dt><dd>{dateValue(transaction.created_at)}</dd><dt>Updated</dt><dd>{dateValue(transaction.updated_at)}</dd></dl></Panel>;
  if (tab === "match_payment_batch") return <MatchPanel title="Match To Payment Batch" message="This links bank truth to payment intent. It does not execute payment or create bank movement." action="match_payment_batch" related={related} onAction={onAction} />;
  if (tab === "match_payment_item") return <MatchPanel title="Match To Payment Item" message="This verifies a bank debit against a payment item. It does not execute payment." action="match_payment_item" related={related} onAction={onAction} />;
  if (tab === "match_cash_receipt") return <MatchPanel title="Match To Cash Receipt" message="This verifies bank deposit context. It does not create a cash receipt or payment application." action="match_cash_receipt" related={related} onAction={onAction} />;
  if (tab === "payment_application_context") return <Panel title="Payment Application Context"><button type="button" disabled={!hasPermission(session.permissions, "bank_transaction.match") || transactionInactive(transaction)} onClick={() => onAction("match_payment_application")}>Create Context Match</button><JsonBlock value={related.paymentApplications.slice(0, 10)} /><div className="warning-box">Payment applications allocate cash to invoices. Bank reconciliation does not update invoice balances.</div></Panel>;
  if (tab === "matches") return <Panel title="Matches"><MatchTable rows={matches} /><div className="warning-box">Review, approve, reject, void, and archive actions are available from match detail.</div></Panel>;
  if (tab === "exception") return <Panel title="Exception"><dl className="detail-list"><dt>Exception Status</dt><dd>{formatAction(transaction.exception_status)}</dd><dt>Exception Reason</dt><dd>{textValue(transaction.exception_reason)}</dd></dl><div className="form-actions"><ActionButton permission="bank_transaction.open_exception" session={session} disabled={transactionInactive(transaction)} onClick={() => onAction("open_exception")}>Open Exception</ActionButton><ActionButton permission="bank_transaction.resolve_exception" session={session} disabled={transactionInactive(transaction)} onClick={() => onAction("resolve_exception")}>Resolve Exception</ActionButton></div></Panel>;
  if (tab === "reconciliation_status") return <Panel title="Reconciliation Status"><dl className="detail-list"><dt>Reconciliation Status</dt><dd>{formatAction(transaction.reconciliation_status)}</dd><dt>Cleared Status</dt><dd>{formatAction(transaction.cleared_status)}</dd><dt>Exception Status</dt><dd>{formatAction(transaction.exception_status)}</dd><dt>Approved Match Amount</dt><dd>{money(transaction.approved_match_amount)}</dd><dt>Unmatched Amount</dt><dd>{money(transaction.unmatched_amount)}</dd><dt>Active Match Count</dt><dd>{formatCell(transaction.active_match_count ?? matches.length)}</dd><dt>Recommended Next Action</dt><dd>{formatAction(transaction.recommended_next_action ?? detail.recommended_next_action)}</dd></dl><div className="warning-box">Matched means linked to SyncOS record. Cleared means bank-posted/confirmed. Reconciled means reviewed and accepted. These are separate states.</div></Panel>;
  if (tab === "timeline") return <Panel title="Timeline"><ObjectTable rows={detail._timeline} columns={["event_type", "aggregate_type", "aggregate_id", "created_at"]} /></Panel>;
  if (tab === "audit") return <Panel title="Audit">{detail.audit_allowed === false ? <div className="warning-box">You do not have permission to view bank reconciliation audit details.</div> : <ObjectTable rows={detail._audit} columns={["action", "entity_type", "entity_id", "created_at"]} />}</Panel>;
  if (tab === "future_processor_settlement") return <Panel title="Future Processor Settlement"><div className="warning-box">Payment processor settlement reconciliation is not available in this sprint.</div></Panel>;
  return <Panel title="Future Accounting Export"><div className="warning-box">Accounting export and GL posting are not available in this sprint.</div></Panel>;
}

function MatchPanel({ title, message, action, related, onAction }: { title: string; message: string; action: string; related: RelatedOptions; onAction: (type: string) => void }) {
  const preview = action === "match_payment_batch" ? related.paymentBatches : action === "match_payment_item" ? related.paymentItems : related.cashReceipts;
  return <Panel title={title}><button type="button" onClick={() => onAction(action)}>Open Match Form</button><ObjectTable rows={preview.slice(0, 10)} columns={["id", "payment_batch_number", "receipt_number", "status", "execution_status", "amount", "total_payment_amount", "gross_received_amount"]} /><div className="warning-box">{message}</div></Panel>;
}

function BankModal({ type, id, related = emptyRelatedOptions, session, onClose, onSaved }: { type: string; id: string; related?: RelatedOptions; session: Session; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>(type.startsWith("match_") ? { match_confidence: "manual" } : {});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      if (type === "archive_account") await syncosFetch(`/bank-accounts/${id}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      else if (type === "archive_transaction") await syncosFetch(`/bank-transactions/${id}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
      else if (type === "ignore_transaction") await syncosFetch(`/bank-transactions/${id}/ignore`, { method: "POST", body: ignorePayload(form), token: session.token });
      else if (type === "open_exception") await syncosFetch(`/bank-transactions/${id}/open-exception`, { method: "POST", body: openExceptionPayload(form), token: session.token });
      else if (type === "resolve_exception") await syncosFetch(`/bank-transactions/${id}/resolve-exception`, { method: "POST", body: resolveExceptionPayload(form), token: session.token });
      else if (type === "match_payment_batch") await syncosFetch(`/bank-transactions/${id}/matches/payment-batch`, { method: "POST", body: matchPaymentBatchPayload(form), token: session.token });
      else if (type === "match_payment_item") await syncosFetch(`/bank-transactions/${id}/matches/payment-item`, { method: "POST", body: matchPaymentItemPayload(form), token: session.token });
      else if (type === "match_cash_receipt") await syncosFetch(`/bank-transactions/${id}/matches/cash-receipt`, { method: "POST", body: matchCashReceiptPayload(form), token: session.token });
      else if (type === "match_payment_application") await syncosFetch(`/bank-transactions/${id}/matches/payment-application`, { method: "POST", body: matchPaymentApplicationPayload(form), token: session.token });
      else if (type === "review_match") await syncosFetch(`/reconciliation-matches/${id}/review`, { method: "POST", body: { review_note: form.review_note }, token: session.token });
      else if (type === "approve_match") await syncosFetch(`/reconciliation-matches/${id}/approve`, { method: "POST", body: notePayload(form, "approval_note"), token: session.token });
      else if (type === "reject_match") await syncosFetch(`/reconciliation-matches/${id}/reject`, { method: "POST", body: rejectionPayload(form), token: session.token });
      else if (type === "void_match") await syncosFetch(`/reconciliation-matches/${id}/void`, { method: "POST", body: voidPayload(form), token: session.token });
      else if (type === "archive_match") await syncosFetch(`/reconciliation-matches/${id}/archive`, { method: "POST", body: archivePayload(form), token: session.token });
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
        {type === "match_payment_batch" ? <MatchFields form={form} setForm={setForm} options={related.paymentBatches} idField="payment_batch_id" label="Payment Batch" /> : null}
        {type === "match_payment_item" ? <MatchFields form={form} setForm={setForm} options={related.paymentItems} idField="payment_item_id" label="Payment Item" /> : null}
        {type === "match_cash_receipt" ? <MatchFields form={form} setForm={setForm} options={related.cashReceipts} idField="cash_receipt_id" label="Cash Receipt" /> : null}
        {type === "match_payment_application" ? <MatchFields form={form} setForm={setForm} options={related.paymentApplications} idField="payment_application_id" label="Payment Application" contextOnly /> : null}
        {type === "open_exception" ? <><label>Exception Reason<textarea value={form.exception_reason ?? ""} onChange={(event) => setForm({ ...form, exception_reason: event.target.value })} required /></label><label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></> : null}
        {type === "resolve_exception" ? <label>Resolution Note<textarea value={form.resolution_note ?? ""} onChange={(event) => setForm({ ...form, resolution_note: event.target.value })} required /></label> : null}
        {type === "ignore_transaction" ? <><label>Ignore Reason<textarea value={form.ignore_reason ?? ""} onChange={(event) => setForm({ ...form, ignore_reason: event.target.value })} required /></label><label>Ignore Note<textarea value={form.ignore_note ?? ""} onChange={(event) => setForm({ ...form, ignore_note: event.target.value })} /></label></> : null}
        {type === "review_match" ? <label>Review Note<textarea value={form.review_note ?? ""} onChange={(event) => setForm({ ...form, review_note: event.target.value })} /></label> : null}
        {type === "approve_match" ? <><label>Approval Note<textarea value={form.approval_note ?? ""} onChange={(event) => setForm({ ...form, approval_note: event.target.value })} required /></label><OverrideField form={form} setForm={setForm} /></> : null}
        {type === "reject_match" ? <><label>Rejection Reason<textarea value={form.rejection_reason ?? ""} onChange={(event) => setForm({ ...form, rejection_reason: event.target.value })} required /></label><label>Rejection Note<textarea value={form.rejection_note ?? ""} onChange={(event) => setForm({ ...form, rejection_note: event.target.value })} /></label></> : null}
        {type === "void_match" ? <VoidFields form={form} setForm={setForm} /> : null}
        {["archive_account", "archive_transaction", "archive_match"].includes(type) ? <ArchiveFields form={form} setForm={setForm} /> : null}
        <div className="warning-box">This action uses hardened Bank Reconciliation backend routes only. It creates no bank feed, statement import, payment execution, cash receipt, payment application, invoice balance change, accounting export, GL entry, tax filing, treasury workflow, or money movement.</div>
        <div className="form-actions" data-testid="modal-actions"><button className={["reject_match", "void_match", "archive_match", "archive_account", "archive_transaction", "ignore_transaction"].includes(type) ? "danger-button" : "primary-button"} type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit"}</button><button type="button" onClick={onClose} disabled={submitting}>Cancel</button></div>
      </form>
    </div>
  );
}

function MatchFields({ form, setForm, options, idField, label, contextOnly }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; options: SyncRecord[]; idField: string; label: string; contextOnly?: boolean }) {
  return <div className="form-grid"><Select label={label} value={form[idField] ?? ""} options={["", ...options.map((row) => String(row.id))]} labels={labelsFor(options, label === "Payment Batch" ? "payment_batch_number" : label === "Cash Receipt" ? "receipt_number" : "id")} onChange={(value) => setForm({ ...form, [idField]: value })} required /><label>{label} ID<input value={form[idField] ?? ""} onChange={(event) => setForm({ ...form, [idField]: event.target.value })} required /></label><label>Matched Amount<input type="number" step="0.01" value={form.matched_amount ?? ""} onChange={(event) => setForm({ ...form, matched_amount: event.target.value })} required /></label><Select label="Match Confidence" value={form.match_confidence ?? ""} options={["", ...matchConfidences]} onChange={(match_confidence) => setForm({ ...form, match_confidence })} /><label>Match Reason<textarea value={form.match_reason ?? ""} onChange={(event) => setForm({ ...form, match_reason: event.target.value })} /></label><label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><OverrideField form={form} setForm={setForm} />{contextOnly ? <div className="warning-box">Payment application matching is context-only. It must not update invoice balances or create cash receipts.</div> : null}</div>;
}

function BankAccountFields({ form, setForm, includeCreate = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; includeCreate?: boolean }) {
  return <div className="form-grid"><label>Account Name<input value={form.account_name ?? ""} onChange={(event) => setForm({ ...form, account_name: event.target.value })} required /></label><Select label="Account Type" value={form.account_type ?? ""} options={["", ...accountTypes]} onChange={(account_type) => setForm({ ...form, account_type })} required /><label>Currency<input value={form.currency ?? ""} onChange={(event) => setForm({ ...form, currency: event.target.value })} required /></label>{!includeCreate ? <Select label="Status" value={form.status ?? ""} options={["", ...accountStatuses]} onChange={(status) => setForm({ ...form, status })} /> : null}<label>Institution Name<input value={form.institution_name ?? ""} onChange={(event) => setForm({ ...form, institution_name: event.target.value })} /></label><label>Masked Account Number<input value={form.masked_account_number ?? ""} onChange={(event) => setForm({ ...form, masked_account_number: event.target.value })} /></label><label>Routing Last 4<input maxLength={4} value={form.routing_last4 ?? ""} onChange={(event) => setForm({ ...form, routing_last4: event.target.value })} /></label><label>Opening Balance<input type="number" step="0.01" value={form.opening_balance ?? ""} onChange={(event) => setForm({ ...form, opening_balance: event.target.value })} /></label><label>Current Balance Snapshot<input type="number" step="0.01" value={form.current_balance_snapshot ?? ""} onChange={(event) => setForm({ ...form, current_balance_snapshot: event.target.value })} /></label><label>Last Statement Date<input type="date" value={form.last_statement_date ?? ""} onChange={(event) => setForm({ ...form, last_statement_date: event.target.value })} /></label><label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div>;
}

function BankTransactionFields({ form, setForm, accounts, includeCreate = false }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; accounts: SyncRecord[]; includeCreate?: boolean }) {
  return <div className="form-grid">{includeCreate ? <><Select label="Bank Account" value={form.bank_account_id ?? ""} options={["", ...accounts.map((row) => String(row.id))]} labels={labelsFor(accounts, "account_name")} onChange={(bank_account_id) => setForm({ ...form, bank_account_id })} required /><label>Bank Account ID<input value={form.bank_account_id ?? ""} onChange={(event) => setForm({ ...form, bank_account_id: event.target.value })} required /></label><Select label="Direction" value={form.direction ?? ""} options={["", ...directions]} onChange={(direction) => setForm({ ...form, direction })} required /><label>Amount<input type="number" step="0.01" value={form.amount ?? ""} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label><label>Currency<input value={form.currency ?? ""} onChange={(event) => setForm({ ...form, currency: event.target.value })} required /></label><Select label="Transaction Type" value={form.transaction_type ?? ""} options={["", ...transactionTypes]} onChange={(transaction_type) => setForm({ ...form, transaction_type })} required /></> : null}<label>Transaction Date<input type="date" value={form.transaction_date ?? ""} onChange={(event) => setForm({ ...form, transaction_date: event.target.value })} required={includeCreate} /></label><label>Posted Date<input type="date" value={form.posted_date ?? ""} onChange={(event) => setForm({ ...form, posted_date: event.target.value })} /></label><label>Description<textarea value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} required={includeCreate} /></label><label>Bank Reference<input value={form.bank_reference ?? ""} onChange={(event) => setForm({ ...form, bank_reference: event.target.value })} /></label><label>External Transaction ID<input value={form.external_transaction_id ?? ""} onChange={(event) => setForm({ ...form, external_transaction_id: event.target.value })} /></label><Select label="Payment Method" value={form.payment_method ?? ""} options={["", ...paymentMethods]} onChange={(payment_method) => setForm({ ...form, payment_method })} /><Select label="Cleared Status" value={form.cleared_status ?? ""} options={["", ...clearedStatuses]} onChange={(cleared_status) => setForm({ ...form, cleared_status })} />{includeCreate ? <Select label="Source Type" value={form.source_type ?? "manual"} options={["manual"]} onChange={(source_type) => setForm({ ...form, source_type })} /> : <label>Exception Reason<textarea value={form.exception_reason ?? ""} onChange={(event) => setForm({ ...form, exception_reason: event.target.value })} /></label>}<label>Notes<textarea value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div>;
}

function BankAccountTable({ rows }: { rows: SyncRecord[] }) {
  if (!rows.length) return <div className="empty-state">No bank accounts found.</div>;
  return <div className="wide-table"><table><thead><tr>{["Account", "Institution / Reference", "Status", "Active Transactions", "Unmatched Count", "Exception Count", "Last Statement", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{accountLink(row.id, row.account_name)}<div className="muted">{formatAction(row.account_type)} / {textValue(row.currency)}</div></td><td>{textValue(row.institution_name)}<div className="muted">{textValue(row.masked_account_number)}</div></td><td>{formatAction(row.status)}</td><td>{formatCell(row.transaction_count)}</td><td>{formatCell(row.unreconciled_count)}</td><td>{formatCell(row.exception_count)}</td><td>{dateValue(row.last_statement_date)}</td><td>{bankAccountNextAction(row)}</td><td><Link className="table-link" href={`/bank-reconciliation/accounts/${row.id}`}>Open Detail</Link></td></tr>)}</tbody></table></div>;
}

function BankTransactionTable({ rows }: { rows: SyncRecord[] }) {
  if (!rows.length) return <div className="empty-state">No bank transactions found.</div>;
  return <div className="wide-table"><table><thead><tr>{["Bank Transaction", "Account", "Direction / Type", "Amount", "Transaction Date", "Reference / Memo", "Match Status", "Exception Status", "Related SyncOS Record", "Age / Updated", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{transactionLink(row.id, row.description ?? row.id)}<div className="muted">{textValue(row.bank_reference)}</div></td><td>{textValue(row.bank_account_name ?? row.bank_account_id)}</td><td>{formatAction(row.direction)}<div className="muted">{formatAction(row.transaction_type)}</div></td><td>{money(row.amount)}</td><td>{dateValue(row.transaction_date)}</td><td>{textValue(row.description)}<div className="muted">{textValue(row.external_transaction_id)}</div></td><td>{formatAction(row.reconciliation_status)}<div className="muted">{formatCell(row.active_match_count)} active matches</div></td><td>{formatAction(row.exception_status)}<div className="muted">{textValue(row.exception_reason)}</div></td><td>{relatedBankRecord(row)}</td><td>{dateValue(row.updated_at)}</td><td>{bankTransactionNextAction(row)}</td><td><Link className="table-link" href={`/bank-reconciliation/transactions/${row.id}`}>Open Detail</Link></td></tr>)}</tbody></table></div>;
}

function MatchTable({ rows }: { rows: SyncRecord[] }) {
  if (!rows.length) return <div className="empty-state">No reconciliation matches found.</div>;
  return <div className="wide-table"><table><thead><tr>{["Match", "Bank Transaction", "Matched Record Type", "Matched Record", "Amount", "Review Status", "Exception Status", "Created / Updated", "Next Action", "Actions"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{matchLink(row.id, row.match_type)}<div className="muted">{formatAction(row.match_confidence)}</div></td><td>{transactionLink(row.bank_transaction_id, row.bank_transaction_description ?? row.bank_reference ?? row.bank_transaction_id)}</td><td>{formatAction(row.matched_object_type)}</td><td>{matchedObjectLink(row)}</td><td>{money(row.matched_amount)}<div className="muted">Variance {money(row.variance_amount)}</div></td><td>{formatAction(row.match_status)}<div className="muted">{textValue(row.match_reason)}</div></td><td>{formatAction(row.exception_status ?? "none")}</td><td>{dateValue(row.created_at)}<div className="muted">{dateValue(row.updated_at)}</div></td><td>{reconciliationMatchNextAction(row)}</td><td><Link className="table-link" href={`/reconciliation-matches/${row.id}`}>Open Detail</Link></td></tr>)}</tbody></table></div>;
}

function FuturePlaceholders() {
  return <section className="workspace-panel"><h2>Future Workflow Placeholders</h2><div className="summary-grid"><Metric label="Future Bank Feed" value="Bank feed integration is not available in this sprint. Bank credentials and API tokens must not be entered." /><Metric label="Future Statement Import" value="Statement import is not available in this sprint. Manual bank transactions are supported for controlled reconciliation." /><Metric label="Future Processor Settlement" value="Payment processor settlement reconciliation is not available in this sprint." /><Metric label="Future Accounting Export" value="Accounting export and GL posting are not available in this sprint." /><Metric label="Future Treasury" value="Treasury forecasting, funding optimization, and cash forecasting are not available in this sprint." /></div></section>;
}

function SessionPanel({ session }: { session: Session }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  const [token, setToken] = useState(session.token);
  const [permissionText, setPermissionText] = useState(session.permissions.join(", "));
  return <section className="workspace-panel"><div className="section-toolbar"><h2>API Session</h2><span>{session.permissions.length} permissions loaded</span></div><div className="session-grid"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" /><input value={permissionText} onChange={(event) => setPermissionText(event.target.value)} placeholder="Permissions, comma separated" /><button type="button" onClick={() => { saveToken(token); savePermissions(permissionText.split(",").map((item) => item.trim()).filter(Boolean)); window.location.reload(); }}>Save Session</button></div></section>;
}

function useSession() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>(bankDefaultPermissions);
  useEffect(() => {
    const nextToken = readToken();
    setToken(nextToken);
    const stored = readPermissions();
    setPermissions(stored.length ? stored : bankDefaultPermissions);
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

const bankDefaultPermissions = [
  ...defaultOpportunityPermissions,
  "bank_account.read",
  "bank_account.create",
  "bank_account.update",
  "bank_account.archive",
  "bank_account.timeline.read",
  "bank_account.audit.read",
  "bank_transaction.read",
  "bank_transaction.create",
  "bank_transaction.update",
  "bank_transaction.archive",
  "bank_transaction.match",
  "bank_transaction.ignore",
  "bank_transaction.open_exception",
  "bank_transaction.resolve_exception",
  "bank_transaction.timeline.read",
  "bank_transaction.audit.read",
  "reconciliation_match.read",
  "reconciliation_match.create",
  "reconciliation_match.review",
  "reconciliation_match.approve",
  "reconciliation_match.reject",
  "reconciliation_match.void",
  "reconciliation_match.archive",
  "reconciliation_match.audit.read",
  "payment_batch.read",
  "payment_item.read",
  "cash_receipt.read",
  "payment_application.read",
];

type RelatedOptions = { paymentBatches: SyncRecord[]; paymentItems: SyncRecord[]; cashReceipts: SyncRecord[]; paymentApplications: SyncRecord[] };
const emptyRelatedOptions: RelatedOptions = { paymentBatches: [], paymentItems: [], cashReceipts: [], paymentApplications: [] };

async function loadRelatedOptions(token: string): Promise<RelatedOptions> {
  const [paymentBatches, cashReceipts, paymentApplications] = await Promise.all([
    optionalList("/payment-batches?execution_status=executed_later&archived=false", token),
    optionalList("/cash-receipts?archived=false", token),
    optionalList("/payment-applications?archived=false", token),
  ]);
  const paymentItems = (await Promise.all(paymentBatches.slice(0, 25).map((batch) => optionalList(`/payment-batches/${batch.id}/items`, token)))).flat();
  return { paymentBatches, paymentItems, cashReceipts, paymentApplications };
}

async function optionalList(path: string, token: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path, { token });
  } catch {
    return [];
  }
}

function queryString(filters: Record<string, string>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query.toString();
}

function accountCreatePayload(form: Record<string, string>) {
  return prune({ account_name: form.account_name, account_type: form.account_type, currency: form.currency, institution_name: form.institution_name, masked_account_number: form.masked_account_number, routing_last4: form.routing_last4, opening_balance: numericOrUndefined(form.opening_balance), current_balance_snapshot: numericOrUndefined(form.current_balance_snapshot), last_statement_date: form.last_statement_date, notes: form.notes });
}

function accountPatchPayload(form: Record<string, string>) {
  return prune({ ...accountCreatePayload(form), status: form.status });
}

function transactionCreatePayload(form: Record<string, string>) {
  return prune({ bank_account_id: form.bank_account_id, transaction_date: form.transaction_date, direction: form.direction, amount: numericOrUndefined(form.amount), currency: form.currency, description: form.description, transaction_type: form.transaction_type, posted_date: form.posted_date, bank_reference: form.bank_reference, external_transaction_id: form.external_transaction_id, payment_method: form.payment_method, cleared_status: form.cleared_status, source_type: "manual", notes: form.notes });
}

function transactionPatchPayload(form: Record<string, string>) {
  return prune({ transaction_date: form.transaction_date, posted_date: form.posted_date, description: form.description, bank_reference: form.bank_reference, external_transaction_id: form.external_transaction_id, payment_method: form.payment_method, cleared_status: form.cleared_status, notes: form.notes, exception_reason: form.exception_reason });
}

function matchPaymentBatchPayload(form: Record<string, string>) {
  return matchPayload(form, "payment_batch_id");
}

function matchPaymentItemPayload(form: Record<string, string>) {
  return matchPayload(form, "payment_item_id");
}

function matchCashReceiptPayload(form: Record<string, string>) {
  return matchPayload(form, "cash_receipt_id");
}

function matchPaymentApplicationPayload(form: Record<string, string>) {
  return matchPayload(form, "payment_application_id");
}

function matchPayload(form: Record<string, string>, idField: string) {
  return prune({ [idField]: form[idField], matched_amount: numericOrUndefined(form.matched_amount), match_confidence: form.match_confidence, match_reason: form.match_reason, notes: form.notes, override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function notePayload(form: Record<string, string>, key: string) {
  return prune({ [key]: form[key], override_reasons: parseJsonField(form.override_reasons, "Override Reasons") });
}

function rejectionPayload(form: Record<string, string>) {
  return prune({ rejection_reason: form.rejection_reason, rejection_note: form.rejection_note });
}

function openExceptionPayload(form: Record<string, string>) {
  return prune({ exception_reason: form.exception_reason, notes: form.notes });
}

function resolveExceptionPayload(form: Record<string, string>) {
  return prune({ resolution_note: form.resolution_note });
}

function ignorePayload(form: Record<string, string>) {
  return prune({ ignore_reason: form.ignore_reason, ignore_note: form.ignore_note });
}

function voidPayload(form: Record<string, string>) {
  return prune({ void_reason: form.void_reason, void_note: form.void_note });
}

function archivePayload(form: Record<string, string>) {
  return prune({ archive_reason: form.archive_reason, archive_note: form.archive_note });
}

function accountForm(row: SyncRecord) {
  return { account_name: String(row.account_name ?? ""), account_type: String(row.account_type ?? ""), institution_name: String(row.institution_name ?? ""), masked_account_number: String(row.masked_account_number ?? ""), routing_last4: String(row.routing_last4 ?? ""), currency: String(row.currency ?? ""), status: String(row.status ?? ""), opening_balance: String(row.opening_balance ?? ""), current_balance_snapshot: String(row.current_balance_snapshot ?? ""), last_statement_date: dateInput(row.last_statement_date), notes: String(row.notes ?? "") };
}

function transactionForm(row: SyncRecord) {
  return { transaction_date: dateInput(row.transaction_date), posted_date: dateInput(row.posted_date), description: String(row.description ?? ""), bank_reference: String(row.bank_reference ?? ""), external_transaction_id: String(row.external_transaction_id ?? ""), payment_method: String(row.payment_method ?? ""), cleared_status: String(row.cleared_status ?? ""), notes: String(row.notes ?? ""), exception_reason: String(row.exception_reason ?? "") };
}

function buildSummary(data: LandingData) {
  const summary = { accounts: data.accounts.length, activeAccounts: data.accounts.filter((row) => row.status === "active").length, transactions: data.transactions.length, reconciliation: {} as Record<string, number>, direction: {} as Record<string, number>, cleared: {} as Record<string, number>, matches: {} as Record<string, number> };
  for (const row of data.transactions) {
    increment(summary.reconciliation, String(row.reconciliation_status ?? ""));
    increment(summary.direction, String(row.direction ?? ""));
    increment(summary.cleared, String(row.cleared_status ?? ""));
  }
  for (const row of data.matches) increment(summary.matches, String(row.match_status ?? ""));
  return summary;
}

function countReconciliationQueue(data: LandingData, queue: ReconciliationQueueKey) {
  if (queue === "reviewMatches") return data.matches.filter((row) => reconciliationMatchMatches(row, queue)).length;
  if (queue === "archived") return data.accounts.filter((row) => String(row.status) === "archived").length + data.transactions.filter((row) => reconciliationTransactionMatches(row, queue)).length + data.matches.filter((row) => reconciliationMatchMatches(row, queue)).length;
  return data.transactions.filter((row) => reconciliationTransactionMatches(row, queue)).length;
}

function reconciliationTransactionMatches(row: SyncRecord, queue: ReconciliationQueueKey) {
  const direction = String(row.direction ?? "");
  const reconciliationStatus = String(row.reconciliation_status ?? "");
  const exceptionStatus = String(row.exception_status ?? "");
  if (queue === "unmatchedCredits") return direction === "credit" && ["unreconciled", "partially_matched"].includes(reconciliationStatus) && exceptionStatus !== "open";
  if (queue === "unmatchedDebits") return direction === "debit" && ["unreconciled", "partially_matched"].includes(reconciliationStatus) && exceptionStatus !== "open";
  if (queue === "openExceptions") return exceptionStatus === "open" || reconciliationStatus === "exception";
  if (queue === "resolvedExceptions") return exceptionStatus === "resolved";
  if (queue === "ignored") return reconciliationStatus === "ignored" || exceptionStatus === "ignored";
  if (queue === "matched") return reconciliationStatus === "matched";
  if (queue === "archived") return reconciliationStatus === "archived" || Boolean(row.archived_at);
  return false;
}

function reconciliationMatchMatches(row: SyncRecord, queue: ReconciliationQueueKey) {
  const status = String(row.match_status ?? "");
  if (queue === "reviewMatches") return ["proposed", "reviewed"].includes(status);
  if (queue === "matched") return status === "approved";
  if (queue === "archived") return status === "archived" || Boolean(row.archived_at);
  return false;
}

function bankAccountNextAction(row: SyncRecord) {
  if (String(row.status) === "archived") return "Archived for audit.";
  if (numberValue(row.exception_count, 0) > 0) return "Review account exceptions.";
  if (numberValue(row.unreconciled_count, 0) > 0) return "Review unmatched transactions.";
  return "Monitor reconciliation status.";
}

function bankTransactionNextAction(row: SyncRecord) {
  const direction = String(row.direction ?? "");
  const reconciliationStatus = String(row.reconciliation_status ?? "");
  const exceptionStatus = String(row.exception_status ?? "");
  if (exceptionStatus === "open" || reconciliationStatus === "exception") return "Resolve reconciliation exception.";
  if (reconciliationStatus === "ignored") return "Ignored; retained for audit.";
  if (reconciliationStatus === "matched") return "Matched; review detail if needed.";
  if (direction === "credit") return "Match Cash Receipt.";
  if (direction === "debit") return "Match Payment Batch.";
  return formatAction(row.recommended_next_action) || "Review transaction.";
}

function reconciliationMatchNextAction(row: SyncRecord) {
  const status = String(row.match_status ?? "");
  if (status === "proposed") return "Review Match.";
  if (status === "reviewed") return "Approve or reject match.";
  if (status === "approved") return "Approved match retained for reconciliation.";
  if (status === "rejected") return "Rejected; inspect detail if needed.";
  if (status === "archived") return "Archived for audit.";
  return "Open match detail.";
}

function relatedBankRecord(row: SyncRecord) {
  if (row.payment_batch_id) return <Link className="table-link" href={`/payments/${row.payment_batch_id}`}>{textValue(row.payment_batch_number ?? row.payment_batch_id)}</Link>;
  if (row.cash_receipt_id) return <Link className="table-link" href={`/cash/receipts/${row.cash_receipt_id}`}>{textValue(row.receipt_number ?? row.cash_receipt_id)}</Link>;
  if (row.payment_application_id) return <Link className="table-link" href={`/payment-applications/${row.payment_application_id}`}>{textValue(row.payment_application_id)}</Link>;
  return "Not linked";
}

function sortTransactions(rows: SyncRecord[], sort?: string) {
  return [...rows].sort((a, b) => {
    if (sort === "transaction_date_desc") return String(b.transaction_date ?? "").localeCompare(String(a.transaction_date ?? ""));
    if (sort === "posted_date_desc") return String(b.posted_date ?? "").localeCompare(String(a.posted_date ?? ""));
    if (sort === "amount_desc") return numberValue(b.amount, 0) - numberValue(a.amount, 0);
    if (sort === "unreconciled_first") return rank(a.reconciliation_status, ["unreconciled", "partially_matched", "exception"]) - rank(b.reconciliation_status, ["unreconciled", "partially_matched", "exception"]);
    if (sort === "updated_desc") return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    return rank(a.exception_status, ["open", "under_review", "resolved", "none"]) - rank(b.exception_status, ["open", "under_review", "resolved", "none"]) || rank(a.reconciliation_status, ["unreconciled", "partially_matched", "exception", "matched", "ignored"]) - rank(b.reconciliation_status, ["unreconciled", "partially_matched", "exception", "matched", "ignored"]) || String(b.transaction_date ?? "").localeCompare(String(a.transaction_date ?? ""));
  });
}

function transactionChecklist(transaction: SyncRecord, matches: SyncRecord[]): Array<[string, unknown]> {
  return [["Transaction recorded", Boolean(transaction.id)], ["Direction verified", Boolean(transaction.direction)], ["Amount verified", numberValue(transaction.amount, 0) > 0], ["SyncOS source selected", matches.length > 0], ["Match proposed", matches.some((match) => match.match_status === "proposed")], ["Match reviewed", matches.some((match) => match.match_status === "reviewed")], ["Match approved", matches.some((match) => match.match_status === "approved")], ["Exception resolved if applicable", transaction.exception_status !== "open"], ["No invoice balance changed", true], ["No accounting export created", true]];
}

function transactionInactive(row: SyncRecord) {
  return ["archived", "ignored"].includes(String(row.reconciliation_status));
}

function matchInactive(row: SyncRecord) {
  return ["voided", "archived", "approved"].includes(String(row.match_status));
}

function modalTitle(type: string) {
  const titles: Record<string, string> = { archive_account: "Archive Bank Account", archive_transaction: "Archive Bank Transaction", ignore_transaction: "Ignore Transaction", open_exception: "Open Exception", resolve_exception: "Resolve Exception", match_payment_batch: "Match Payment Batch", match_payment_item: "Match Payment Item", match_cash_receipt: "Match Cash Receipt", match_payment_application: "Payment Application Context Match", review_match: "Review Match", approve_match: "Approve Match", reject_match: "Reject Match", void_match: "Void Match", archive_match: "Archive Match" };
  return titles[type] ?? "Bank Reconciliation Action";
}

function actionNotice(type: string) {
  if (type.startsWith("match_")) return "Match created for bank verification only. No money moved and no invoice balance changed.";
  if (type === "approve_match") return "Match approved. No accounting export, GL posting, payment execution, cash receipt, payment application, invoice balance change, tax filing, treasury workflow, or money movement was created.";
  if (type.includes("exception")) return "Exception status updated without payment, cash, invoice, accounting, treasury, or money movement activity.";
  return "Bank reconciliation action completed without feeds, imports, processors, accounting, tax, treasury, payment, cash, invoice-balance, or money movement workflows.";
}

function plainError(message: string) {
  if (!message) return "Bank reconciliation action failed.";
  if (message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("permission")) return "You do not have permission to perform this action.";
  if (message.includes("bank account")) return "Bank account not found or no access.";
  if (message.includes("bank transaction")) return "Bank transaction not found or no access.";
  if (message.includes("reconciliation match")) return "Reconciliation match not found or no access.";
  if (message.includes("account number")) return "Full bank account numbers are not allowed.";
  if (message.includes("credential") || message.includes("token") || message.includes("password")) return "Bank credentials are not allowed.";
  if (message.includes("amount")) return "Amount must be positive and matched amount cannot exceed unmatched amount.";
  if (message.includes("direction")) return "Direction must be debit or credit. Debit transactions normally match payments and credit transactions normally match cash receipts.";
  if (message.includes("approval")) return "Approval note is required.";
  if (message.includes("rejection")) return "Rejection reason is required.";
  if (message.includes("void")) return "Void reason is required.";
  if (message.includes("archive")) return "Archive reason is required.";
  return message;
}

function Tabs({ tabs, render }: { tabs: string[]; render: (tab: string) => ReactNode }) {
  const [tab, setTab] = useState(tabs[0]);
  return <><div className="tabs" role="tablist" aria-label="Bank reconciliation detail sections">{tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}</div>{render(tab)}</>;
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

function OverrideField({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <label>Override Reasons JSON<textarea value={form.override_reasons ?? ""} onChange={(event) => setForm({ ...form, override_reasons: event.target.value })} /></label>;
}

function VoidFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <><label>Void Reason<textarea value={form.void_reason ?? ""} onChange={(event) => setForm({ ...form, void_reason: event.target.value })} required /></label><label>Void Note<textarea value={form.void_note ?? ""} onChange={(event) => setForm({ ...form, void_note: event.target.value })} /></label></>;
}

function ArchiveFields({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  return <><label>Archive Reason<textarea value={form.archive_reason ?? ""} onChange={(event) => setForm({ ...form, archive_reason: event.target.value })} required /></label><label>Archive Note<textarea value={form.archive_note ?? ""} onChange={(event) => setForm({ ...form, archive_note: event.target.value })} /></label></>;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{value === undefined || value === null || value === "" ? "Not captured" : JSON.stringify(value, null, 2)}</pre>;
}

function accountLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/bank-reconciliation/accounts/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function transactionLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/bank-reconciliation/transactions/${id}`}>{textValue(label, String(id))}</Link> : "Not linked";
}

function matchLink(id: unknown, label: unknown) {
  return id ? <Link className="table-link" href={`/reconciliation-matches/${id}`}>{formatAction(label)}</Link> : "Not linked";
}

function matchedObjectLink(row: SyncRecord) {
  if (row.payment_batch_id) return <Link className="table-link" href={`/payments/${row.payment_batch_id}`}>{textValue(row.payment_batch_number ?? row.payment_batch_id)}</Link>;
  if (row.payment_item_id) return <Link className="table-link" href={`/payment-items/${row.payment_item_id}`}>{textValue(row.payment_item_id)}</Link>;
  if (row.cash_receipt_id) return <Link className="table-link" href={`/cash/receipts/${row.cash_receipt_id}`}>{textValue(row.receipt_number ?? row.cash_receipt_id)}</Link>;
  return textValue(row.matched_object_id);
}

function labelsFor(rows: SyncRecord[], preferred = "name") {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[preferred] ?? row.name ?? row.account_name ?? row.description ?? row.payment_batch_number ?? row.receipt_number, String(row.id))]));
}

function createdId(created: SyncRecord) {
  const after = created.afterState as SyncRecord | undefined;
  return String(created.id ?? created.entityId ?? after?.id ?? "");
}

function increment(target: Record<string, number>, key: string) {
  if (!key) return;
  target[key] = (target[key] ?? 0) + 1;
}

function rank(value: unknown, order: string[]) {
  const found = order.indexOf(String(value));
  return found === -1 ? 999 : found;
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
