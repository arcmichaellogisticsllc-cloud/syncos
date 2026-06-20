"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
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

export function SignalFeed() {
  const [signals, setSignals] = useState<SyncRecord[]>([]);
  const [organizations, setOrganizations] = useState<SyncRecord[]>([]);
  const [territories, setTerritories] = useState<SyncRecord[]>([]);
  const [permissions, setPermissions] = useState<string[]>(defaultSignalPermissions);
  const [token, setToken] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showCreate, setShowCreate] = useState(false);
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
    return {
      total: signals.length,
      verified: signals.filter((signal) => signal.status === "verified").length,
      highConfidence: signals.filter((signal) => numberValue(signal.confidence_score ?? signal.confidence, 0) >= 80).length,
      needsReview: signals.filter((signal) => ["discovered", "categorized", "scored"].includes(String(signal.status))).length,
      withoutOrganization: signals.filter((signal) => !signal.primary_organization_id).length,
      withoutOwner: signals.filter((signal) => !signal.owner_user_id).length,
      converted: signals.filter((signal) => Boolean(signal.converted)).length,
      archived: signals.filter((signal) => signal.status === "archived" || signal.archived_at).length,
    };
  }, [signals]);

  function persistSession() {
    saveToken(token);
    savePermissions(permissions);
    void load();
  }

  return (
    <IntelligenceShell title="Signal Feed" purpose="Review market intelligence and move verified signals toward candidate readiness.">
      <SessionPanel token={token} setToken={setToken} permissions={permissions} setPermissions={setPermissions} save={persistSession} />
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="summary-grid">
        <SummaryCard label="Total Signals" value={summary.total} onClick={() => setFilters(initialFilters)} />
        <SummaryCard label="Verified Signals" value={summary.verified} onClick={() => setFilters({ ...initialFilters, status: "verified" })} />
        <SummaryCard label="High Confidence" value={summary.highConfidence} onClick={() => setFilters({ ...initialFilters, confidenceMin: "80" })} />
        <SummaryCard label="Needs Review" value={summary.needsReview} onClick={() => setFilters({ ...initialFilters, status: "discovered" })} />
        <SummaryCard label="Without Organization" value={summary.withoutOrganization} onClick={() => setFilters({ ...initialFilters, organization: "false" })} />
        <SummaryCard label="Without Owner" value={summary.withoutOwner} onClick={() => setFilters({ ...initialFilters, ownerUserId: "unassigned" })} disabled />
        <SummaryCard label="Converted to Candidates" value={summary.converted} onClick={() => setFilters({ ...initialFilters, converted: "true" })} />
        <SummaryCard label="Archived" value={summary.archived} onClick={() => setFilters({ ...initialFilters, archived: "true" })} />
      </div>

      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Filters</h2>
            <p className="muted">Filters run against the tenant-scoped signal feed API.</p>
          </div>
          <button className="primary-button" type="button" disabled={!hasPermission(permissions, "signal.create")} onClick={() => setShowCreate(true)}>
            Create Signal
          </button>
        </div>
        <div className="quick-filter-row">
          {["Needs Review", "High Confidence", "Missing Organization", "Missing Evidence", "Unassigned", "Ready for Candidate", "Recently Discovered", "Verified Signals", "Archived Signals"].map((label) => (
            <button key={label} type="button" onClick={() => setQuickFilter(label, setFilters)}>
              {label}
            </button>
          ))}
        </div>
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
      </section>

      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <h2>Signals</h2>
          <span className="badge">{signals.length} shown</span>
        </div>
        {loading ? <div className="empty-state">Loading signals...</div> : null}
        {!loading && signals.length === 0 ? (
          <div className="empty-state">
            <p>No signals yet. Start by adding market intelligence from a funding source, utility, prime contractor, engineering firm, permit activity, or relationship note.</p>
            <button className="primary-button" type="button" disabled={!hasPermission(permissions, "signal.create")} onClick={() => setShowCreate(true)}>
              Create Signal
            </button>
          </div>
        ) : null}
        {signals.length > 0 ? <SignalTable signals={signals} permissions={permissions} reload={load} /> : null}
      </section>

      {showCreate ? <CreateSignalModal organizations={organizations} territories={territories} onClose={() => setShowCreate(false)} onCreated={(signal) => (window.location.href = `/intelligence/signals/${signal.id}`)} /> : null}
    </IntelligenceShell>
  );
}

function SignalTable({ signals, permissions, reload }: { signals: SyncRecord[]; permissions: string[]; reload: () => Promise<void> }) {
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
                    <button type="button" disabled={!hasPermission(permissions, "signal.categorize") || signal.status === "archived"} onClick={() => simpleAction(id, "categorize", reload)}>Categorize</button>
                    <button type="button" disabled={!hasPermission(permissions, "signal.score") || signal.status === "archived"} onClick={() => simpleAction(id, "score", reload)}>Score</button>
                    <button type="button" disabled={!hasPermission(permissions, "signal.verify") || activeEvidenceCount === 0 || signal.status === "archived"} onClick={() => simpleAction(id, "verify", reload)}>Verify</button>
                    <button type="button" disabled={!hasPermission(permissions, "signal.archive") || signal.status === "archived"} onClick={() => archiveSignal(id, reload)}>Archive</button>
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
        await syncosFetch(`/signals/${signal.id}/evidence`, {
          method: "POST",
          body: {
            evidence_type: form.get("evidence_type") || "source_url",
            summary: form.get("evidence_summary"),
            description: form.get("evidence_summary"),
            source_url: form.get("evidence_source_url") || undefined,
            trust_level: form.get("evidence_trust_level") || "unverified",
          },
        }).catch(() => undefined);
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
      <form className="modal-panel" onSubmit={submit}>
        <div className="section-toolbar">
          <h2>Create Signal</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
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
        <div className="form-actions">
          <button className="primary-button" disabled={busy} type="submit">{busy ? "Creating..." : "Create Signal"}</button>
        </div>
      </form>
    </div>
  );
}

function SessionPanel({ token, setToken, permissions, setPermissions, save }: { token: string; setToken: (value: string) => void; permissions: string[]; setPermissions: (value: string[]) => void; save: () => void }) {
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

function SummaryCard({ label, value, onClick, disabled }: { label: string; value: number; onClick?: () => void; disabled?: boolean }) {
  return <button className="summary-card" disabled={disabled} type="button" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>;
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

function setQuickFilter(label: string, setFilters: (filters: Filters) => void) {
  const normalized = label.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "needs_review") setFilters({ ...initialFilters, status: "discovered" });
  else if (normalized === "high_confidence") setFilters({ ...initialFilters, confidenceMin: "80" });
  else if (normalized === "missing_organization") setFilters({ ...initialFilters, organization: "false" });
  else if (normalized === "missing_evidence") setFilters({ ...initialFilters, evidence: "false" });
  else if (normalized === "unassigned") setFilters({ ...initialFilters, ownerUserId: "unassigned" });
  else if (normalized === "ready_for_candidate") setFilters({ ...initialFilters, status: "verified", confidenceMin: "60", evidence: "true", organization: "true" });
  else if (normalized === "recently_discovered") setFilters({ ...initialFilters });
  else if (normalized === "verified_signals") setFilters({ ...initialFilters, status: "verified" });
  else if (normalized === "archived_signals") setFilters({ ...initialFilters, archived: "true" });
  else setFilters(initialFilters);
}

async function simpleAction(id: string, action: "categorize" | "score" | "verify", reload: () => Promise<void>) {
  const body =
    action === "categorize"
      ? { signal_category: window.prompt("Signal category", "funding"), signal_type: window.prompt("Signal type", "broadband_funding") }
      : action === "score"
        ? { confidence_score: Number(window.prompt("Confidence score 0-100", "75")) }
        : {};
  await syncosFetch(`/signals/${id}/${action}`, { method: "POST", body }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function archiveSignal(id: string, reload: () => Promise<void>) {
  const reason = window.prompt("Archive reason: duplicate, stale, false_signal, out_of_territory, not_telecom_work, insufficient_evidence, no_longer_relevant, other", "stale");
  if (!reason) return;
  await syncosFetch(`/signals/${id}/archive`, { method: "POST", body: { archive_reason: reason } }).catch((error) => window.alert((error as Error).message));
  await reload();
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
