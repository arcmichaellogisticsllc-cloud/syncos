"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ActionButton as OperatorActionButton, BoundaryNotice, ErrorBanner, ModalActions } from "../../operator-actions";
import { EmptyState, FilterDrawer, LoadingState, PriorityCard, QueueTabs, RecordsPanel } from "../../operator-page-templates";
import { dateValue, defaultSignalPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../api";
import { IntelligenceShell } from "../intelligence-shell";

type Filters = {
  search: string;
  status: string;
  category: string;
  type: string;
  source: string;
  sourceType: string;
  confidenceMin: string;
  confidenceMax: string;
  trustLevel: string;
  ownerUserId: string;
  evidence: string;
  organization: string;
  contact: string;
  converted: string;
  archived: string;
  stale: string;
};

const initialFilters: Filters = {
  search: "",
  status: "",
  category: "",
  type: "",
  source: "",
  sourceType: "",
  confidenceMin: "",
  confidenceMax: "",
  trustLevel: "",
  ownerUserId: "",
  evidence: "",
  organization: "",
  contact: "",
  converted: "",
  archived: "",
  stale: "",
};

const signalCategories = ["funding", "utility", "prime_contractor", "engineering", "permit", "relationship", "market", "other"];
const signalTypes = ["broadband_funding", "utility_work", "prime_bid", "engineering_plan", "permit_activity", "relationship_note", "other"];
const sourceTypes = ["public_source", "relationship_source", "procurement_source", "government_source", "customer_source", "prime_source", "engineering_source", "manual_entry", "internal_note"];
const trustLevels = ["unverified", "low", "medium", "high", "verified"];
const workTypes = ["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"];
const evidenceTypes = ["source_url", "document", "screenshot", "email_note", "call_note", "meeting_note", "public_record", "procurement_notice", "permit_record", "funding_notice", "relationship_note", "other"];
const archiveReasons = ["duplicate", "stale", "false_signal", "out_of_territory", "not_telecom_work", "insufficient_evidence", "no_longer_relevant", "other"];
const queueTabs = ["Needs Review", "Verified Signals", "Ready for Candidate", "Missing Evidence", "Archived Signals"] as const;

type SignalAction = "categorize" | "score" | "verify" | "archive";
type QueueTab = (typeof queueTabs)[number];
type ActionModalState = { action: SignalAction; signal: SyncRecord } | null;

export function SignalFeed() {
  const [signals, setSignals] = useState<SyncRecord[]>([]);
  const [organizations, setOrganizations] = useState<SyncRecord[]>([]);
  const [territories, setTerritories] = useState<SyncRecord[]>([]);
  const [permissions, setPermissions] = useState<string[]>(defaultSignalPermissions);
  const [token, setToken] = useState("");
  const [activeQueue, setActiveQueue] = useState<string>("Needs Review");
  const [filters, setFilters] = useState<Filters>(filtersForQueue("Needs Review"));
  const [showCreate, setShowCreate] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModalState>(null);
  const [authMissing, setAuthMissing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setToken(readToken());
    setPermissions(readPermissions());
  }, []);

  useEffect(() => {
    void load();
  }, [filters]);

  async function load() {
    setLoading(true);
    setError("");
    const nextToken = readToken();
    if (!nextToken) {
      setAuthMissing(true);
      setSignals([]);
      setOrganizations([]);
      setTerritories([]);
      setLoading(false);
      return;
    }
    setAuthMissing(false);
    try {
      const [signalRows, orgRows, territoryRows, effective] = await Promise.all([
        syncosFetch<SyncRecord[]>(`/signals${queryString(filters)}`),
        syncosFetch<SyncRecord[]>("/organizations").catch(() => []),
        syncosFetch<SyncRecord[]>("/territories").catch(() => []),
        syncosFetch<{ permissions?: string[] }>("/auth/me/permissions").catch(() => null),
      ]);
      setSignals(signalRows);
      setOrganizations(orgRows);
      setTerritories(territoryRows);
      if (effective?.permissions?.length) {
        setPermissions(effective.permissions);
        savePermissions(effective.permissions);
      }
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    const readyForCandidate = signals.filter((signal) => {
      const confidence = numberValue(signal.confidence_score ?? signal.confidence, 0);
      const evidence = numberValue(signal.active_evidence_count, 0);
      return signal.status === "verified" && confidence >= 60 && evidence > 0 && Boolean(signal.primary_organization_id) && !signal.converted;
    }).length;
    return {
      total: signals.length,
      verified: signals.filter((signal) => signal.status === "verified").length,
      highConfidence: signals.filter((signal) => numberValue(signal.confidence_score ?? signal.confidence, 0) >= 80).length,
      highConfidenceUnassigned: signals.filter((signal) => numberValue(signal.confidence_score ?? signal.confidence, 0) >= 80 && !signal.owner_user_id).length,
      needsReview: signals.filter((signal) => ["discovered", "categorized", "scored"].includes(String(signal.status))).length,
      withoutOrganization: signals.filter((signal) => !signal.primary_organization_id).length,
      missingEvidence: signals.filter((signal) => numberValue(signal.active_evidence_count, 0) === 0).length,
      withoutOwner: signals.filter((signal) => !signal.owner_user_id).length,
      readyForCandidate,
      converted: signals.filter((signal) => Boolean(signal.converted)).length,
      archived: signals.filter((signal) => signal.status === "archived" || signal.archived_at).length,
    };
  }, [signals]);

  const nextReviewSignal = useMemo(() => {
    return signals.find((signal) => ["discovered", "categorized", "scored"].includes(String(signal.status))) ?? signals[0];
  }, [signals]);

  function persistSession() {
    saveToken(token);
    savePermissions(permissions);
    void load();
  }

  function applyQueue(label: string) {
    setActiveQueue(label);
    setFilters(filtersForQueue(label));
  }

  async function submitAction(action: SignalAction, signal: SyncRecord, body: Record<string, unknown>) {
    const id = String(signal.id);
    await syncosFetch(`/signals/${id}/${action}`, { method: "POST", body });
    await load();
  }

  return (
    <IntelligenceShell title="Signal Feed" purpose="Review market intelligence and move qualified signals toward opportunity candidates.">
      <SessionPanel token={token} setToken={setToken} permissions={permissions} setPermissions={setPermissions} save={persistSession} />
      {authMissing ? <LoginRequiredCard /> : null}
      {!authMissing && error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {!authMissing ? (
        <>
          <section className="panel workspace-panel operator-hero">
            <div>
              <h2>Today&apos;s signal work</h2>
              <p className="muted">Start with reviewable signals, then clear missing owner, evidence, and organization blockers before a signal can become candidate-ready.</p>
            </div>
            <div className="form-actions">
              <OperatorActionButton label="Create Signal" variant="primary" disabledReason={!hasPermission(permissions, "signal.create") ? "Your role can review signals but cannot create them." : undefined} onClick={() => setShowCreate(true)} />
              <OperatorActionButton label="Review Next Signal" disabledReason={!nextReviewSignal ? "No signals are available for review." : undefined} consequence="Open the highest-priority signal in the current queue." onClick={() => nextReviewSignal && (window.location.href = `/intelligence/signals/${nextReviewSignal.id}`)} />
            </div>
          </section>

          <div className="summary-grid priority-grid" aria-label="Today's Priorities">
            <PriorityCard label="Needs Review" value={summary.needsReview} helper="New or scored intelligence that needs a decision." onClick={() => applyQueue("Needs Review")} />
            <PriorityCard label="High Confidence Unassigned" value={summary.highConfidenceUnassigned} helper="Strong signals that still need an owner." onClick={() => applyQueue("High Confidence Unassigned")} />
            <PriorityCard label="Missing Organization" value={summary.withoutOrganization} helper="Signals blocked from candidate readiness." onClick={() => applyQueue("Missing Organization")} />
            <PriorityCard label="Missing Evidence" value={summary.missingEvidence} helper="Signals that cannot be verified yet." onClick={() => applyQueue("Missing Evidence")} />
            <PriorityCard label="Ready for Candidate" value={summary.readyForCandidate} helper="Verified signals with evidence and organization context." onClick={() => applyQueue("Ready for Candidate")} />
          </div>
        </>
      ) : null}

      {!authMissing ? <section className="panel workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Queue</h2>
            <p className="muted">Queues drive the page. Filters are secondary when the operator needs a narrower search.</p>
          </div>
          <span className="badge">{signals.length} Signals shown</span>
        </div>
        <QueueTabs tabs={queueTabs.map((label) => ({ label }))} activeTab={activeQueue} onTabChange={applyQueue} />
        <FilterDrawer>
          <div className="filter-grid">
            <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search by title" />
            <Select value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={["", "discovered", "categorized", "scored", "investigated", "verified", "consumed", "archived"]} label="Status" />
            <Select value={filters.category} onChange={(category) => setFilters({ ...filters, category })} options={["", ...signalCategories]} label="Category" />
            <Select value={filters.type} onChange={(type) => setFilters({ ...filters, type })} options={["", ...signalTypes]} label="Type" />
            <input value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} placeholder="Source" />
            <Select value={filters.sourceType} onChange={(sourceType) => setFilters({ ...filters, sourceType })} options={["", ...sourceTypes]} label="Source type" />
            <input value={filters.confidenceMin} onChange={(event) => setFilters({ ...filters, confidenceMin: event.target.value })} placeholder="Min confidence" type="number" min="0" max="100" />
            <input value={filters.confidenceMax} onChange={(event) => setFilters({ ...filters, confidenceMax: event.target.value })} placeholder="Max confidence" type="number" min="0" max="100" />
            <Select value={filters.trustLevel} onChange={(trustLevel) => setFilters({ ...filters, trustLevel })} options={["", ...trustLevels]} label="Trust level" />
            <Select value={filters.evidence} onChange={(evidence) => setFilters({ ...filters, evidence })} options={["", "true", "false"]} label="Evidence" />
            <Select value={filters.organization} onChange={(organization) => setFilters({ ...filters, organization })} options={["", "true", "false"]} label="Organization" />
            <Select value={filters.converted} onChange={(converted) => setFilters({ ...filters, converted })} options={["", "true", "false"]} label="Candidate" />
            <button type="button" onClick={() => setFilters(initialFilters)}>
              Clear filters
            </button>
          </div>
        </FilterDrawer>
      </section> : null}

      {!authMissing ? <RecordsPanel title="Signals" count={`${signals.length} shown`}>
        {loading ? <LoadingState>Loading signals...</LoadingState> : null}
        {!loading && signals.length === 0 ? (
          <EmptyState>
            <p>No signals yet. Start by adding market intelligence from a funding source, utility, prime contractor, engineering firm, permit activity, or relationship note.</p>
            <OperatorActionButton label="Create Signal" variant="primary" disabledReason={!hasPermission(permissions, "signal.create") ? "Your role can review signals but cannot create them." : undefined} onClick={() => setShowCreate(true)} />
          </EmptyState>
        ) : null}
        {signals.length > 0 ? <SignalTable signals={signals} permissions={permissions} openAction={(action, signal) => setActionModal({ action, signal })} /> : null}
      </RecordsPanel> : null}

      {showCreate ? <CreateSignalModal organizations={organizations} territories={territories} onClose={() => setShowCreate(false)} onCreated={(signal) => (window.location.href = `/intelligence/signals/${signal.id}`)} /> : null}
      {actionModal ? <SignalActionModal modal={actionModal} onClose={() => setActionModal(null)} onSubmit={submitAction} /> : null}
    </IntelligenceShell>
  );
}

function SignalTable({ signals, permissions, openAction }: { signals: SyncRecord[]; permissions: string[]; openAction: (action: SignalAction, signal: SyncRecord) => void }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            <th>Signal Title</th>
            <th>Category</th>
            <th>Type</th>
            <th>Source</th>
            <th>Territory</th>
            <th>Related Organization</th>
            <th>Evidence</th>
            <th>Confidence Score</th>
            <th>Trust Level</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Date Discovered</th>
            <th>Last Updated</th>
            <th>Recommended Next Action</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => {
            const id = String(signal.id);
            const activeEvidenceCount = numberValue(signal.active_evidence_count, 0);
            const archived = signal.status === "archived";
            const disabledReasons = {
              categorize: actionDisabledReason("Categorize", permissions, "signal.categorize", archived),
              score: actionDisabledReason("Score", permissions, "signal.score", archived),
              verify: !hasPermission(permissions, "signal.verify") ? "Your role can review signals but cannot verify them." : activeEvidenceCount === 0 ? "Add evidence before verifying." : archived ? "Archived signals are view-only." : "",
              archive: actionDisabledReason("Archive", permissions, "signal.archive", archived),
            };
            return (
              <tr key={id}>
                <td>
                  <Link className="table-link" href={`/intelligence/signals/${id}`}>
                    {textValue(signal.title)}
                  </Link>
                </td>
                <td>{textValue(signal.category ?? signal.signal_category)}</td>
                <td>{textValue(signal.type ?? signal.signal_type)}</td>
                <td>{textValue(signal.source_name ?? signal.source_url ?? signal.source_note)}</td>
                <td>{textValue(signal.primary_territory_name)}</td>
                <td>{textValue(signal.primary_organization_name)}</td>
                <td>{activeEvidenceCount}</td>
                <td>{textValue(signal.confidence_score ?? signal.confidence)}</td>
                <td>{textValue(signal.trust_level)}</td>
                <td><span className="badge">{textValue(signal.status)}</span></td>
                <td>{textValue(signal.owner_name)}</td>
                <td>{dateValue(signal.date_discovered ?? signal.created_at)}</td>
                <td>{dateValue(signal.updated_at)}</td>
                <td>{textValue(signal.recommended_next_action)}</td>
                <td>
                  <div className="row-actions">
                    <Link href={`/intelligence/signals/${id}`}>Open Detail</Link>
                    <OperatorActionButton label="Categorize" disabledReason={disabledReasons.categorize} onClick={() => openAction("categorize", signal)} />
                    <OperatorActionButton label="Score" disabledReason={disabledReasons.score} onClick={() => openAction("score", signal)} />
                    <OperatorActionButton label="Verify" disabledReason={disabledReasons.verify} onClick={() => openAction("verify", signal)} />
                    <OperatorActionButton label="Archive" variant="danger" disabledReason={disabledReasons.archive} onClick={() => openAction("archive", signal)} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function actionDisabledReason(label: string, permissions: string[], permission: string, archived: boolean) {
  if (!hasPermission(permissions, permission)) return `Your role can review signals but cannot ${label.toLowerCase()} them.`;
  if (archived) return "Archived signals are view-only.";
  return "";
}

function CreateSignalModal({ organizations, territories, onClose, onCreated }: { organizations: SyncRecord[]; territories: SyncRecord[]; onClose: () => void; onCreated: (signal: SyncRecord) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const signal = await syncosFetch<SyncRecord>("/signals", {
        method: "POST",
        body: {
          title: form.get("title"),
          description: form.get("summary"),
          signal_category: form.get("signal_category"),
          signal_type: form.get("signal_type"),
          source_name: form.get("source_name"),
          source_type: form.get("source_type"),
          source_url: form.get("source_url") || undefined,
          source_note: form.get("source_note") || undefined,
          organization_id: form.get("organization_id") || undefined,
          territory_id: form.get("territory_id") || undefined,
          date_discovered: form.get("date_discovered") || undefined,
          estimated_value: form.get("estimated_value") || undefined,
          estimated_scope: form.get("estimated_scope") || undefined,
          work_type: form.get("work_type") || "unknown",
          confidence_score: form.get("confidence_score") || undefined,
          trust_level: form.get("trust_level") || "unverified",
        },
      });
      if (form.get("evidence_summary")) {
        try {
          await syncosFetch(`/signals/${signal.id}/evidence`, {
            method: "POST",
            body: {
              evidence_type: form.get("evidence_type") || "source_url",
              summary: form.get("evidence_summary"),
              description: form.get("evidence_summary"),
              source_url: form.get("evidence_source_url") || undefined,
              trust_level: form.get("evidence_trust_level") || "unverified",
            },
          });
        } catch (evidenceError) {
          throw new Error(`Signal was created, but evidence could not be attached: ${(evidenceError as Error).message}`);
        }
      }
      onCreated(signal);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="create-signal-title" onSubmit={submit}>
        <div className="section-toolbar">
          <h2 id="create-signal-title">Create Signal</h2>
          <button type="button" disabled={busy} onClick={onClose}>Close</button>
        </div>
        <p className="muted">Add market intelligence for review. Creating a signal does not create candidates, opportunities, projects, invoices, payments, or accounting records.</p>
        <BoundaryNotice>This action adds market intelligence for review. It does not create candidates, opportunities, projects, invoices, payments, or accounting records.</BoundaryNotice>
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <div className="form-grid">
          <label>Title<input name="title" required /></label>
          <label>Summary<textarea name="summary" required /></label>
          <label>Signal category<SelectInput name="signal_category" options={signalCategories} required /></label>
          <label>Signal type<SelectInput name="signal_type" options={signalTypes} required /></label>
          <label>Source name<input name="source_name" required /></label>
          <label>Source type<SelectInput name="source_type" options={sourceTypes} required defaultValue="manual_entry" /></label>
          <label>Source URL<input name="source_url" type="url" /></label>
          <label>Source note<input name="source_note" /></label>
          <label>Territory<SelectInput name="territory_id" options={territories.map((row) => [String(row.id), textValue(row.name)])} /></label>
          <label>Date discovered<input name="date_discovered" type="date" /></label>
          <label>Related organization<SelectInput name="organization_id" options={organizations.map((row) => [String(row.id), textValue(row.name)])} /></label>
          <label>Estimated value<input name="estimated_value" type="number" /></label>
          <label>Estimated scope<input name="estimated_scope" /></label>
          <label>Work type<SelectInput name="work_type" options={workTypes} defaultValue="unknown" /></label>
          <label>Confidence score<input name="confidence_score" type="number" min="0" max="100" /></label>
          <label>Trust level<SelectInput name="trust_level" options={trustLevels} defaultValue="unverified" /></label>
          <label>Evidence type<SelectInput name="evidence_type" options={evidenceTypes} /></label>
          <label>Evidence attachment/source<textarea name="evidence_summary" /></label>
          <label>Evidence source URL<input name="evidence_source_url" type="url" /></label>
          <label>Evidence trust<SelectInput name="evidence_trust_level" options={trustLevels} defaultValue="unverified" /></label>
        </div>
        <ModalActions submitLabel="Create Signal" submitting={busy} onCancel={onClose} />
      </form>
    </div>
  );
}

function SignalActionModal({ modal, onClose, onSubmit }: { modal: NonNullable<ActionModalState>; onClose: () => void; onSubmit: (action: SignalAction, signal: SyncRecord, body: Record<string, unknown>) => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { action, signal } = modal;
  const title = actionTitle(action);
  const signalTitle = textValue(signal.title);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await onSubmit(action, signal, actionBody(action, form));
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className={`modal-panel ${action === "archive" ? "danger-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="signal-action-title" onSubmit={submit}>
        <div className="section-toolbar">
          <div>
            <h2 id="signal-action-title">{title}</h2>
            <p className="muted">{actionPurpose(action, signalTitle)}</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>Close</button>
        </div>
        <BoundaryNotice title={action === "archive" ? "Destructive boundary" : "Boundary"}>This action updates the signal only. It does not create candidates, opportunities, projects, invoices, payments, or accounting records.</BoundaryNotice>
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <div className="form-grid">
          {action === "categorize" ? (
            <>
              <label>Signal category<SelectInput name="signal_category" options={signalCategories} required defaultValue={String(signal.signal_category ?? signal.category ?? "funding")} /></label>
              <label>Signal type<SelectInput name="signal_type" options={signalTypes} required defaultValue={String(signal.signal_type ?? signal.type ?? "broadband_funding")} /></label>
            </>
          ) : null}
          {action === "score" ? <label>Confidence score<input name="confidence_score" type="number" min="0" max="100" required defaultValue={String(signal.confidence_score ?? signal.confidence ?? 75)} /></label> : null}
          {action === "verify" ? <label>Trust level<SelectInput name="trust_level" options={trustLevels} required defaultValue="verified" /></label> : null}
          {action === "archive" ? (
            <>
              <label>Archive reason<SelectInput name="archive_reason" options={archiveReasons} required defaultValue="stale" /></label>
              <label>Archive note<textarea name="archive_note" placeholder="Explain why this signal should leave the active queue." /></label>
            </>
          ) : null}
        </div>
        <ModalActions submitLabel={actionSubmitLabel(action)} danger={action === "archive"} submitting={busy} onCancel={onClose} />
      </form>
    </div>
  );
}

function SessionPanel({ token, setToken, permissions, setPermissions, save }: { token: string; setToken: (value: string) => void; permissions: string[]; setPermissions: (value: string[]) => void; save: () => void }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return (
    <section className="panel workspace-panel">
      <div className="section-toolbar">
        <div>
          <h2>Operator Session</h2>
          <p className="muted">Effective permissions are loaded from the API when available. Backend authorization remains source of truth.</p>
        </div>
        <button type="button" onClick={save}>Apply</button>
      </div>
      <div className="session-grid">
        <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" />
        <textarea value={permissions.join(", ")} onChange={(event) => setPermissions(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />
      </div>
    </section>
  );
}

function LoginRequiredCard() {
  return (
    <section className="panel workspace-panel login-required-card">
      <div>
        <h2>Login required</h2>
        <p className="muted">Sign in to review market intelligence and manage signal queues.</p>
      </div>
      <div className="warning-box">Authentication is required before this workspace can load.</div>
    </section>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option || "all"} value={option}>{option || label}</option>)}
    </select>
  );
}

function SelectInput({ name, options, required, defaultValue }: { name: string; options: Array<string | [string, string]>; required?: boolean; defaultValue?: string }) {
  return (
    <select name={name} required={required} defaultValue={defaultValue ?? ""}>
      <option value="">Select</option>
      {options.map((option) => {
        const value = Array.isArray(option) ? option[0] : option;
        const label = Array.isArray(option) ? option[1] : option;
        return <option key={value} value={value}>{label}</option>;
      })}
    </select>
  );
}

function filtersForQueue(label: string): Filters {
  const normalized = label.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "needs_review") return { ...initialFilters };
  if (normalized === "high_confidence" || normalized === "high_confidence_unassigned") return { ...initialFilters, confidenceMin: "80", ownerUserId: "unassigned" };
  if (normalized === "missing_organization") return { ...initialFilters, organization: "false" };
  if (normalized === "missing_evidence") return { ...initialFilters, evidence: "false" };
  if (normalized === "unassigned") return { ...initialFilters, ownerUserId: "unassigned" };
  if (normalized === "ready_for_candidate") return { ...initialFilters, status: "verified", confidenceMin: "60", evidence: "true", organization: "true" };
  if (normalized === "recently_discovered") return { ...initialFilters };
  if (normalized === "verified_signals") return { ...initialFilters, status: "verified" };
  if (normalized === "archived_signals") return { ...initialFilters, archived: "true" };
  return initialFilters;
}

function actionBody(action: SignalAction, form: FormData) {
  if (action === "categorize") {
    return { signal_category: form.get("signal_category"), signal_type: form.get("signal_type") };
  }
  if (action === "score") {
    return { confidence_score: Number(form.get("confidence_score")) };
  }
  if (action === "verify") {
    return { trust_level: form.get("trust_level") };
  }
  return { archive_reason: form.get("archive_reason"), archive_note: form.get("archive_note") || undefined };
}

function actionTitle(action: SignalAction) {
  if (action === "categorize") return "Categorize Signal";
  if (action === "score") return "Score Signal";
  if (action === "verify") return "Verify Signal";
  return "Archive Signal";
}

function actionPurpose(action: SignalAction, signalTitle: string) {
  if (action === "categorize") return `Classify ${signalTitle} so the queue can route it correctly.`;
  if (action === "score") return `Set confidence for ${signalTitle} so operators can prioritize review.`;
  if (action === "verify") return `Confirm ${signalTitle} has enough evidence to be trusted.`;
  return `Remove ${signalTitle} from the active signal queue with a required reason.`;
}

function actionSubmitLabel(action: SignalAction) {
  if (action === "categorize") return "Categorize Signal";
  if (action === "score") return "Score Signal";
  if (action === "verify") return "Verify Signal";
  return "Archive Signal";
}

function queryString(filters: Filters) {
  const params = new URLSearchParams();
  const entries: Array<[string, string]> = [
    ["q", filters.search],
    ["status", filters.status],
    ["category", filters.category],
    ["type", filters.type],
    ["source_name", filters.source],
    ["source_type", filters.sourceType],
    ["confidence_min", filters.confidenceMin],
    ["confidence_max", filters.confidenceMax],
    ["trust_level", filters.trustLevel],
    ["has_evidence", filters.evidence],
    ["has_organization", filters.organization],
    ["has_contact", filters.contact],
    ["converted", filters.converted],
    ["archived", filters.archived],
    ["stale", filters.stale],
    ["sort", "default"],
  ];
  for (const [key, value] of entries) {
    if (value && value !== "unassigned") params.set(key, value);
  }
  return params.toString() ? `?${params.toString()}` : "";
}
