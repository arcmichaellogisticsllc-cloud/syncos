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
  confidenceMin: string;
  confidenceMax: string;
  evidence: string;
  organization: string;
  converted: string;
};

const initialFilters: Filters = {
  search: "",
  status: "",
  category: "",
  type: "",
  source: "",
  confidenceMin: "",
  confidenceMax: "",
  evidence: "",
  organization: "",
  converted: "",
};

const signalCategories = ["funding", "utility", "prime_contractor", "engineering", "permit", "relationship", "market", "other"];
const signalTypes = ["broadband_funding", "utility_work", "prime_bid", "engineering_plan", "permit_activity", "relationship_note", "other"];

export function SignalFeed() {
  const [signals, setSignals] = useState<SyncRecord[]>([]);
  const [evidenceCounts, setEvidenceCounts] = useState<Record<string, number>>({});
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
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [signalRows, orgRows, territoryRows] = await Promise.all([
        syncosFetch<SyncRecord[]>("/signals"),
        syncosFetch<SyncRecord[]>("/organizations").catch(() => []),
        syncosFetch<SyncRecord[]>("/territories").catch(() => []),
      ]);
      setSignals(signalRows);
      setOrganizations(orgRows);
      setTerritories(territoryRows);
      const counts: Record<string, number> = {};
      await Promise.all(
        signalRows.map(async (signal) => {
          const id = String(signal.id);
          const rows = await syncosFetch<SyncRecord[]>(`/signals/${id}/evidence`).catch(() => []);
          counts[id] = rows.filter((row) => row.status !== "archived").length;
        }),
      );
      setEvidenceCounts(counts);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    return signals
      .filter((signal) => {
        const confidence = numberValue(signal.confidence_score ?? signal.confidence, 0);
        const title = textValue(signal.title, "").toLowerCase();
        const evidenceCount = evidenceCounts[String(signal.id)] ?? 0;
        if (filters.search && !title.includes(filters.search.toLowerCase())) return false;
        if (filters.status && signal.status !== filters.status) return false;
        if (filters.category && signal.signal_category !== filters.category) return false;
        if (filters.type && signal.signal_type !== filters.type) return false;
        if (filters.source && textValue(signal.source_name, "").toLowerCase() !== filters.source.toLowerCase()) return false;
        if (filters.confidenceMin && confidence < Number(filters.confidenceMin)) return false;
        if (filters.confidenceMax && confidence > Number(filters.confidenceMax)) return false;
        if (filters.evidence === "has" && evidenceCount === 0) return false;
        if (filters.evidence === "missing" && evidenceCount > 0) return false;
        if (filters.organization === "missing" && getSignalLink(String(signal.id), "organization_id")) return false;
        if (filters.organization === "has" && !getSignalLink(String(signal.id), "organization_id")) return false;
        if (filters.converted === "converted" && !getSignalLink(String(signal.id), "candidate_id")) return false;
        if (filters.converted === "not_converted" && getSignalLink(String(signal.id), "candidate_id")) return false;
        return true;
      })
      .sort((a, b) => numberValue(b.confidence_score ?? b.confidence, 0) - numberValue(a.confidence_score ?? a.confidence, 0) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  }, [signals, filters, evidenceCounts]);

  const summary = useMemo(() => {
    return {
      total: signals.length,
      verified: signals.filter((signal) => signal.status === "verified").length,
      highConfidence: signals.filter((signal) => numberValue(signal.confidence_score ?? signal.confidence, 0) >= 80).length,
      needsReview: signals.filter((signal) => ["discovered", "categorized", "scored"].includes(String(signal.status))).length,
      withoutOrganization: signals.filter((signal) => !getSignalLink(String(signal.id), "organization_id")).length,
      withoutOwner: signals.length,
      converted: signals.filter((signal) => getSignalLink(String(signal.id), "candidate_id")).length,
      archived: signals.filter((signal) => signal.status === "archived" || signal.deleted_at).length,
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
        <SummaryCard label="Total Signals" value={summary.total} onClick={() => setFilters({ ...filters, status: "" })} />
        <SummaryCard label="Verified Signals" value={summary.verified} onClick={() => setFilters({ ...filters, status: "verified" })} />
        <SummaryCard label="High Confidence" value={summary.highConfidence} onClick={() => setFilters({ ...filters, confidenceMin: "80" })} />
        <SummaryCard label="Needs Review" value={summary.needsReview} onClick={() => setQuickFilter("needs_review", setFilters)} />
        <SummaryCard label="Without Organization" value={summary.withoutOrganization} onClick={() => setFilters({ ...filters, organization: "missing" })} />
        <SummaryCard label="Without Owner" value={summary.withoutOwner} disabled />
        <SummaryCard label="Converted to Candidates" value={summary.converted} onClick={() => setFilters({ ...filters, converted: "converted" })} />
        <SummaryCard label="Archived" value={summary.archived} onClick={() => setFilters({ ...filters, status: "archived" })} />
      </div>

      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Filters</h2>
            <p className="muted">Default sort is highest confidence plus newest discovered.</p>
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
          <input value={filters.confidenceMin} onChange={(event) => setFilters({ ...filters, confidenceMin: event.target.value })} placeholder="Min confidence" type="number" min="0" max="100" />
          <input value={filters.confidenceMax} onChange={(event) => setFilters({ ...filters, confidenceMax: event.target.value })} placeholder="Max confidence" type="number" min="0" max="100" />
          <Select value={filters.evidence} onChange={(evidence) => setFilters({ ...filters, evidence })} options={["", "has", "missing"]} label="Evidence" />
          <Select value={filters.organization} onChange={(organization) => setFilters({ ...filters, organization })} options={["", "has", "missing"]} label="Organization" />
          <Select value={filters.converted} onChange={(converted) => setFilters({ ...filters, converted })} options={["", "converted", "not_converted"]} label="Candidate" />
          <button type="button" onClick={() => setFilters(initialFilters)}>
            Clear filters
          </button>
        </div>
      </section>

      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <h2>Signals</h2>
          <span className="badge">{filtered.length} shown</span>
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
        {!loading && signals.length > 0 && filtered.length === 0 ? (
          <div className="empty-state">
            <p>No signals match this filter.</p>
            <button type="button" onClick={() => setFilters(initialFilters)}>
              Clear filters
            </button>
          </div>
        ) : null}
        {filtered.length > 0 ? <SignalTable signals={filtered} evidenceCounts={evidenceCounts} permissions={permissions} reload={load} /> : null}
      </section>

      {showCreate ? <CreateSignalModal organizations={organizations} territories={territories} onClose={() => setShowCreate(false)} onCreated={(signal) => (window.location.href = `/intelligence/signals/${signal.id}`)} /> : null}
    </IntelligenceShell>
  );
}

function SignalTable({ signals, evidenceCounts, permissions, reload }: { signals: SyncRecord[]; evidenceCounts: Record<string, number>; permissions: string[]; reload: () => Promise<void> }) {
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
            const evidenceCount = evidenceCounts[id] ?? 0;
            return (
              <tr key={id}>
                <td>
                  <Link className="table-link" href={`/intelligence/signals/${id}`}>
                    {textValue(signal.title)}
                  </Link>
                </td>
                <td>{textValue(signal.signal_category)}</td>
                <td>{textValue(signal.signal_type)}</td>
                <td>{textValue(signal.source_name ?? signal.source_url)}</td>
                <td>{getSignalLinkLabel(id, "territory_name")}</td>
                <td>{getSignalLinkLabel(id, "organization_name")}</td>
                <td>{textValue(signal.confidence_score ?? signal.confidence)}</td>
                <td>Not captured</td>
                <td>
                  <span className="badge">{textValue(signal.status)}</span>
                </td>
                <td>Not captured</td>
                <td>{dateValue(signal.created_at)}</td>
                <td>{dateValue(signal.updated_at)}</td>
                <td>{nextAction(signal, evidenceCount)}</td>
                <td>
                  <div className="row-actions">
                    <Link href={`/intelligence/signals/${id}`}>Open Detail</Link>
                    <button type="button" disabled={!hasPermission(permissions, "signal.categorize") || signal.status === "archived"} onClick={() => simpleAction(id, "categorize", reload)}>
                      Categorize
                    </button>
                    <button type="button" disabled={!hasPermission(permissions, "signal.score") || signal.status === "archived"} onClick={() => simpleAction(id, "score", reload)}>
                      Score
                    </button>
                    <button type="button" disabled={!hasPermission(permissions, "signal.verify") || evidenceCount === 0 || signal.status === "archived"} onClick={() => simpleAction(id, "verify", reload)}>
                      Verify
                    </button>
                    <button type="button" disabled={!hasPermission(permissions, "signal.archive") || signal.status === "archived"} onClick={() => archiveSignal(id, reload)}>
                      Archive
                    </button>
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
    const organizationId = String(form.get("organization_id") ?? "");
    const territoryId = String(form.get("territory_id") ?? "");
    try {
      const signal = await syncosFetch<SyncRecord>("/signals", {
        method: "POST",
        body: {
          title: form.get("title"),
          description: form.get("summary"),
          signal_category: form.get("signal_category"),
          signal_type: form.get("signal_type"),
          source_name: form.get("source_name"),
          source_url: form.get("source_url") || form.get("source_note"),
          organization_id: organizationId || undefined,
          territory_id: territoryId || undefined,
        },
      });
      writeSignalLinks(String(signal.id), {
        organization_id: organizationId,
        organization_name: optionLabel(organizations, organizationId),
        territory_id: territoryId,
        territory_name: optionLabel(territories, territoryId),
      });
      if (form.get("evidence_summary")) {
        await syncosFetch(`/signals/${signal.id}/evidence`, {
          method: "POST",
          body: {
            evidence_type: form.get("evidence_type") || "source_url",
            summary: form.get("evidence_summary"),
            description: form.get("evidence_summary"),
            source_url: form.get("evidence_source_url") || undefined,
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
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="form-grid">
          <label>Title<input name="title" required /></label>
          <label>Summary<textarea name="summary" required /></label>
          <label>Signal category<SelectInput name="signal_category" options={signalCategories} required /></label>
          <label>Signal type<SelectInput name="signal_type" options={signalTypes} required /></label>
          <label>Source name<input name="source_name" required /></label>
          <label>Source type<input name="source_type" placeholder="Funding source, utility, contractor" /></label>
          <label>Source URL<input name="source_url" type="url" /></label>
          <label>Source note<input name="source_note" /></label>
          <label>Territory<SelectInput name="territory_id" options={territories.map((row) => [String(row.id), textValue(row.name)])} /></label>
          <label>Date discovered<input name="date_discovered" type="date" /></label>
          <label>Related organization<SelectInput name="organization_id" options={organizations.map((row) => [String(row.id), textValue(row.name)])} /></label>
          <label>Related contact<input name="related_contact" placeholder="Not supported by current signal API" disabled /></label>
          <label>Estimated value<input name="estimated_value" type="number" disabled placeholder="Not supported by current signal API" /></label>
          <label>Estimated scope<input name="estimated_scope" disabled placeholder="Not supported by current signal API" /></label>
          <label>Work type<input name="work_type" disabled placeholder="Captured during candidate creation" /></label>
          <label>Confidence score<input name="confidence_score" type="number" min="0" max="100" disabled placeholder="Use Score action after create" /></label>
          <label>Trust level<input name="trust_level" disabled placeholder="Not supported by current signal API" /></label>
          <label>Evidence type<SelectInput name="evidence_type" options={["source_url", "document", "screenshot", "email_note", "call_note", "meeting_note", "public_record", "procurement_notice", "permit_record", "funding_notice", "relationship_note", "other"]} /></label>
          <label>Evidence attachment/source<textarea name="evidence_summary" /></label>
          <label>Evidence source URL<input name="evidence_source_url" type="url" /></label>
          <label>Owner<input name="owner" disabled placeholder="Not supported by current signal API" /></label>
        </div>
        <div className="form-actions">
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Creating..." : "Create Signal"}
          </button>
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
          <p className="muted">Token and permissions are used by the UI only. The API remains the source of truth.</p>
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
  return (
    <button className="summary-card" disabled={disabled} type="button" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option || "all"} value={option}>
          {option || label}
        </option>
      ))}
    </select>
  );
}

function SelectInput({ name, options, required }: { name: string; options: Array<string | [string, string]>; required?: boolean }) {
  return (
    <select name={name} required={required}>
      <option value="">Select</option>
      {options.map((option) => {
        const value = Array.isArray(option) ? option[0] : option;
        const label = Array.isArray(option) ? option[1] : option;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

function setQuickFilter(label: string, setFilters: (filters: Filters) => void) {
  const normalized = label.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "needs_review") setFilters({ ...initialFilters, status: "discovered" });
  else if (normalized === "high_confidence") setFilters({ ...initialFilters, confidenceMin: "80" });
  else if (normalized === "missing_organization") setFilters({ ...initialFilters, organization: "missing" });
  else if (normalized === "missing_evidence") setFilters({ ...initialFilters, evidence: "missing" });
  else if (normalized === "ready_for_candidate") setFilters({ ...initialFilters, status: "verified", confidenceMin: "60", evidence: "has", organization: "has" });
  else if (normalized === "verified_signals") setFilters({ ...initialFilters, status: "verified" });
  else if (normalized === "archived_signals") setFilters({ ...initialFilters, status: "archived" });
  else setFilters(initialFilters);
}

async function simpleAction(id: string, action: "categorize" | "score" | "verify", reload: () => Promise<void>) {
  const body =
    action === "categorize"
      ? { signal_category: window.prompt("Signal category", "funding"), signal_type: window.prompt("Signal type", "broadband_funding") }
      : action === "score"
        ? { confidence_score: Number(window.prompt("Confidence score 0-100", "75")) }
        : { verifier_note: "Verified from Intelligence Workspace" };
  await syncosFetch(`/signals/${id}/${action}`, { method: "POST", body }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function archiveSignal(id: string, reload: () => Promise<void>) {
  const reason = window.prompt("Archive reason: Duplicate, Stale, False signal, Out of territory, Not telecom work, Insufficient evidence, No longer relevant, Other", "Stale");
  if (!reason) return;
  await syncosFetch(`/signals/${id}/archive`, { method: "POST", body: { reason } }).catch((error) => window.alert((error as Error).message));
  await reload();
}

function nextAction(signal: SyncRecord, evidenceCount: number) {
  if (signal.status === "archived") return "View only";
  if (signal.status === "verified") return getSignalLink(String(signal.id), "candidate_id") ? "View candidate" : "Create candidate";
  if (evidenceCount === 0) return "Add evidence";
  if (!signal.signal_category || signal.signal_type === "uncategorized") return "Categorize";
  if (!signal.confidence_score) return "Score";
  return "Verify";
}

function optionLabel(rows: SyncRecord[], id: string) {
  return textValue(rows.find((row) => String(row.id) === id)?.name, "");
}

function getSignalLinks() {
  try {
    return JSON.parse(window.localStorage.getItem("syncos.signalLinks") ?? "{}") as Record<string, Record<string, string>>;
  } catch {
    return {};
  }
}

function writeSignalLinks(id: string, values: Record<string, string>) {
  const links = getSignalLinks();
  links[id] = { ...(links[id] ?? {}), ...values };
  window.localStorage.setItem("syncos.signalLinks", JSON.stringify(links));
}

function getSignalLink(id: string, key: string) {
  if (typeof window === "undefined") return "";
  return getSignalLinks()[id]?.[key] ?? "";
}

function getSignalLinkLabel(id: string, key: string) {
  return getSignalLink(id, key) || "Not captured";
}
