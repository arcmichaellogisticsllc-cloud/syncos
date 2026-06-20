"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { dateValue, defaultSignalPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../../api";
import { IntelligenceShell } from "../../intelligence-shell";

const evidenceTypes = ["source_url", "document", "screenshot", "email_note", "call_note", "meeting_note", "public_record", "procurement_notice", "permit_record", "funding_notice", "relationship_note", "other"];
const archiveReasons = ["Duplicate", "Stale", "False signal", "Out of territory", "Not telecom work", "Insufficient evidence", "No longer relevant", "Other"];

export function SignalDetail({ signalId }: { signalId: string }) {
  const [signal, setSignal] = useState<SyncRecord | null>(null);
  const [evidence, setEvidence] = useState<SyncRecord[]>([]);
  const [organizations, setOrganizations] = useState<SyncRecord[]>([]);
  const [territories, setTerritories] = useState<SyncRecord[]>([]);
  const [permissions, setPermissions] = useState<string[]>(defaultSignalPermissions);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);
  const [showCandidate, setShowCandidate] = useState(false);

  useEffect(() => {
    setToken(readToken());
    setPermissions(readPermissions());
  }, []);

  useEffect(() => {
    void load();
  }, [signalId]);

  async function load() {
    setError("");
    try {
      const [nextSignal, nextEvidence, nextOrganizations, nextTerritories] = await Promise.all([
        syncosFetch<SyncRecord>(`/signals/${signalId}`),
        syncosFetch<SyncRecord[]>(`/signals/${signalId}/evidence`).catch(() => []),
        syncosFetch<SyncRecord[]>("/organizations").catch(() => []),
        syncosFetch<SyncRecord[]>("/territories").catch(() => []),
      ]);
      setSignal(nextSignal);
      setEvidence(nextEvidence);
      setOrganizations(nextOrganizations);
      setTerritories(nextTerritories);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  function persistSession() {
    saveToken(token);
    savePermissions(permissions);
    void load();
  }

  const activeEvidence = evidence.filter((row) => row.status !== "archived" && !row.deleted_at);
  const readiness = useMemo(() => readinessItems(signal, activeEvidence.length), [signal, activeEvidence.length]);
  const ready = readiness.every((item) => item.state === "Complete");
  const archived = signal?.status === "archived" || Boolean(signal?.deleted_at);

  return (
    <IntelligenceShell title="Signal Detail" purpose="Review evidence, lifecycle state, and candidate readiness for one signal.">
      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <Link href="/intelligence/signals">Back to Signal Feed</Link>
          <button type="button" onClick={persistSession}>Apply Session</button>
        </div>
        <div className="session-grid">
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" />
          <textarea value={permissions.join(", ")} onChange={(event) => setPermissions(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {!signal ? <section className="panel"><div className="empty-state">Loading signal...</div></section> : null}
      {signal ? (
        <>
          <section className="panel workspace-panel">
            <div className="signal-header">
              <div>
                <h2>{textValue(signal.title)}</h2>
                <div className="badge-row">
                  <span className="badge">{textValue(signal.status)}</span>
                  <span className="badge">Confidence {textValue(signal.confidence_score ?? signal.confidence, "0")}</span>
                  <span className="badge">Trust Not captured</span>
                </div>
              </div>
              <div className="header-facts">
                <span>Territory: {getSignalLinkLabel(signalId, "territory_name")}</span>
                <span>Owner: Not captured</span>
                <span>Date discovered: {dateValue(signal.created_at)}</span>
                <span>Last updated: {dateValue(signal.updated_at)}</span>
              </div>
            </div>
            <LifecycleActions
              signal={signal}
              permissions={permissions}
              ready={ready}
              activeEvidenceCount={activeEvidence.length}
              onAddEvidence={() => setShowEvidence(true)}
              onCreateCandidate={() => setShowCandidate(true)}
              onReload={load}
            />
          </section>

          <div className="detail-grid">
            <section className="panel">
              <h2>Main Summary</h2>
              <dl className="detail-list">
                <dt>Summary</dt>
                <dd>{textValue(signal.description)}</dd>
                <dt>Category</dt>
                <dd>{textValue(signal.signal_category)}</dd>
                <dt>Type</dt>
                <dd>{textValue(signal.signal_type)}</dd>
                <dt>Source</dt>
                <dd>{signal.source_url ? <a className="table-link" href={String(signal.source_url)} target="_blank">{textValue(signal.source_name ?? signal.source_url)}</a> : textValue(signal.source_name)}</dd>
              </dl>
            </section>

            <section className="panel">
              <div className="section-toolbar">
                <h2>Evidence</h2>
                <button type="button" disabled={archived || !hasPermission(permissions, "signal_evidence.create")} onClick={() => setShowEvidence(true)}>Add Evidence</button>
              </div>
              <p className="muted">A signal cannot be verified until at least one active evidence record exists.</p>
              <div className="metric-row">
                <span className="label">Evidence count</span>
                <span className="value">{activeEvidence.length}</span>
              </div>
              {evidence.length === 0 ? <div className="empty-state">No evidence has been added yet. Add source material, notes, or documentation before verifying this signal.</div> : null}
              <div className="evidence-list">
                {evidence.map((item) => (
                  <article key={String(item.id)} className="evidence-item">
                    <strong>{textValue(item.evidence_type)}</strong>
                    <p>{textValue(item.description ?? item.summary)}</p>
                    <div className="mini-grid">
                      <span>Trust level: Not captured</span>
                      <span>Uploaded by: Not captured</span>
                      <span>Created: {dateValue(item.created_at)}</span>
                    </div>
                    <div className="row-actions">
                      {item.source_url ? <a href={String(item.source_url)} target="_blank">Open Source</a> : null}
                      <button type="button" disabled={archived || !hasPermission(permissions, "signal_evidence.archive") || item.status === "archived"} onClick={() => archiveEvidence(String(item.id), load)}>
                        Archive Evidence
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>Related Organization</h2>
              {getSignalLink(signalId, "organization_id") ? (
                <p>{getSignalLinkLabel(signalId, "organization_name")}</p>
              ) : (
                <div className="empty-state">No organization is attached. Attach or create an organization before creating a candidate.</div>
              )}
              <button type="button" disabled>Attach organization not exposed by current signal update API</button>
            </section>

            <section className="panel">
              <h2>Related Contacts</h2>
              <div className="empty-state">Contact linking is not exposed by the current signal API.</div>
            </section>

            <section className="panel">
              <h2>Territory</h2>
              <p>{getSignalLinkLabel(signalId, "territory_name")}</p>
            </section>

            <section className="panel">
              <h2>Candidate Readiness</h2>
              <div className="checklist">
                {readiness.map((item) => (
                  <div className={`check-item ${item.state.toLowerCase().replace(/\s+/g, "-")}`} key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.state}</strong>
                  </div>
                ))}
              </div>
              {ready ? (
                <button className="primary-button" type="button" disabled={archived || !hasPermission(permissions, "opportunity_candidate.create")} onClick={() => setShowCandidate(true)}>
                  Create Opportunity Candidate
                </button>
              ) : (
                <p className="muted">This signal is not ready to become a candidate. Complete missing items and return here.</p>
              )}
            </section>

            <section className="panel">
              <h2>Confidence / Trust</h2>
              <Metric label="Confidence score" value={textValue(signal.confidence_score ?? signal.confidence, "0")} />
              <Metric label="Trust level" value="Not captured" />
              <Metric label="Recommended next action" value={recommendedAction(signal, activeEvidence.length, ready)} />
            </section>

            <section className="panel">
              <h2>Constraints / Recommendations</h2>
              <div className="empty-state">No related constraints or recommendations are available through this signal detail API yet.</div>
            </section>

            <section className="panel">
              <h2>Event Timeline</h2>
              <div className="empty-state">Event timeline summary is not exposed by the current read API.</div>
            </section>

            <section className="panel">
              <h2>Audit Summary</h2>
              <div className="empty-state">Audit summary is visible only when an approved audit read API is available.</div>
            </section>
          </div>

          {showEvidence ? <EvidenceModal signalId={signalId} onClose={() => setShowEvidence(false)} onSaved={load} /> : null}
          {showCandidate ? <CandidateModal signal={signal} organizations={organizations} territories={territories} evidenceCount={activeEvidence.length} onClose={() => setShowCandidate(false)} onSaved={load} /> : null}
        </>
      ) : null}
    </IntelligenceShell>
  );
}

function LifecycleActions({ signal, permissions, ready, activeEvidenceCount, onAddEvidence, onCreateCandidate, onReload }: { signal: SyncRecord; permissions: string[]; ready: boolean; activeEvidenceCount: number; onAddEvidence: () => void; onCreateCandidate: () => void; onReload: () => Promise<void> }) {
  const status = String(signal.status);
  const archived = status === "archived";
  const actions = [
    { label: "Categorize", permission: "signal.categorize", show: status === "discovered", run: () => categorize(String(signal.id), onReload) },
    { label: "Score", permission: "signal.score", show: status === "categorized", run: () => score(String(signal.id), onReload) },
    { label: "Verify", permission: "signal.verify", show: ["scored", "investigated"].includes(status), disabled: activeEvidenceCount === 0, run: () => verify(String(signal.id), onReload) },
    { label: "Add Evidence", permission: "signal_evidence.create", show: status !== "consumed", run: onAddEvidence },
    { label: "Create Candidate", permission: "opportunity_candidate.create", show: ["scored", "investigated", "verified"].includes(status), disabled: !ready, run: onCreateCandidate },
    { label: "Archive", permission: "signal.archive", show: status !== "consumed", run: () => archiveSignal(String(signal.id), onReload) },
  ].filter((action) => action.show && !archived);

  if (archived) return <div className="action-bar"><span className="muted">This signal is archived. Actions are limited.</span></div>;
  return (
    <div className="action-bar">
      {actions.map((action) => (
        <button key={action.label} type="button" disabled={action.disabled || !hasPermission(permissions, action.permission)} onClick={action.run}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

function EvidenceModal({ signalId, onClose, onSaved }: { signalId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await syncosFetch(`/signals/${signalId}/evidence`, {
        method: "POST",
        body: {
          evidence_type: form.get("evidence_type"),
          summary: form.get("description"),
          description: form.get("description"),
          source_url: form.get("source_url") || undefined,
        },
      });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal-panel compact-modal" onSubmit={submit}>
        <div className="section-toolbar">
          <h2>Add Evidence</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <label>Evidence type<SelectInput name="evidence_type" options={evidenceTypes} required /></label>
        <label>Description<textarea name="description" required /></label>
        <label>Source URL<input name="source_url" type="url" /></label>
        <button className="primary-button" type="submit">Add Evidence</button>
      </form>
    </div>
  );
}

function CandidateModal({ signal, organizations, territories, evidenceCount, onClose, onSaved }: { signal: SyncRecord; organizations: SyncRecord[]; territories: SyncRecord[]; evidenceCount: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const signalId = String(signal.id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!form.get("confirm")) {
      setError("Confirm that this signal has enough evidence to become an opportunity candidate.");
      return;
    }
    try {
      const candidate = await syncosFetch<SyncRecord>("/opportunity-candidates", {
        method: "POST",
        body: {
          name: form.get("name"),
          organization_id: form.get("organization_id"),
          territory_id: form.get("territory_id"),
          work_type: form.get("work_type"),
          unknown_work_type_reason: form.get("work_type") ? undefined : "Unknown from signal workspace",
          evidence_summary: form.get("evidence_summary"),
          confidence_score: numberValue(signal.confidence_score ?? signal.confidence, 0),
        },
      });
      await syncosFetch(`/opportunity-candidates/${candidate.id}/signals`, {
        method: "POST",
        body: {
          signal_id: signalId,
          contribution_score: Number(form.get("contribution_score") ?? signal.confidence_score ?? 60),
        },
      });
      writeSignalLinks(signalId, { candidate_id: String(candidate.id), candidate_name: textValue(candidate.name ?? candidate.title) });
      await onSaved();
      onClose();
      window.location.href = `/intelligence/signals/${signalId}`;
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal-panel compact-modal" onSubmit={submit}>
        <div className="section-toolbar">
          <h2>Create Opportunity Candidate</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <label>Candidate name<input name="name" defaultValue={textValue(signal.title, "")} required /></label>
        <label>Organization<SelectInput name="organization_id" options={organizations.map((row) => [String(row.id), textValue(row.name)])} defaultValue={getSignalLink(signalId, "organization_id")} required /></label>
        <label>Territory<SelectInput name="territory_id" options={territories.map((row) => [String(row.id), textValue(row.name)])} defaultValue={getSignalLink(signalId, "territory_id")} required /></label>
        <label>Work type<input name="work_type" placeholder="Fiber build, drops, splicing" /></label>
        <label>Estimated value<input disabled placeholder="Not supported by signal API" /></label>
        <label>Evidence summary<textarea name="evidence_summary" defaultValue={`${textValue(signal.description, "")} Evidence records: ${evidenceCount}`} required /></label>
        <label>Attached signal contribution score<input name="contribution_score" type="number" min="0" max="100" defaultValue={String(signal.confidence_score ?? signal.confidence ?? 60)} /></label>
        <label className="checkbox-row"><input name="confirm" type="checkbox" /> This signal has enough evidence to become an opportunity candidate.</label>
        <button className="primary-button" type="submit">Create Candidate</button>
      </form>
    </div>
  );
}

function readinessItems(signal: SyncRecord | null, evidenceCount: number) {
  if (!signal) return [];
  const confidence = numberValue(signal.confidence_score ?? signal.confidence, 0);
  return [
    { label: "Status is verified", state: signal.status === "verified" ? "Complete" : "Missing" },
    { label: "Confidence score >= 60", state: confidence >= 60 ? "Complete" : confidence > 0 ? "Needs Review" : "Missing" },
    { label: "Related organization exists", state: getSignalLink(String(signal.id), "organization_id") ? "Complete" : "Missing" },
    { label: "Active evidence exists", state: evidenceCount > 0 ? "Complete" : "Missing" },
    { label: "Territory exists", state: getSignalLink(String(signal.id), "territory_id") ? "Complete" : "Missing" },
  ];
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-row"><span className="label">{label}</span><span className="value">{value}</span></div>;
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

async function categorize(id: string, reload: () => Promise<void>) {
  const signal_category = window.prompt("Signal category", "funding");
  const signal_type = window.prompt("Signal type", "broadband_funding");
  if (!signal_category || !signal_type) return;
  await syncosFetch(`/signals/${id}/categorize`, { method: "POST", body: { signal_category, signal_type } }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function score(id: string, reload: () => Promise<void>) {
  const confidence_score = Number(window.prompt("Confidence score 0-100", "75"));
  if (!Number.isFinite(confidence_score)) return;
  await syncosFetch(`/signals/${id}/score`, { method: "POST", body: { confidence_score } }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function verify(id: string, reload: () => Promise<void>) {
  await syncosFetch(`/signals/${id}/verify`, { method: "POST", body: { verifier_note: "Verified from Intelligence Workspace" } }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function archiveSignal(id: string, reload: () => Promise<void>) {
  const reason = window.prompt(`Archive reason: ${archiveReasons.join(", ")}`, "Stale");
  if (!reason) return;
  await syncosFetch(`/signals/${id}/archive`, { method: "POST", body: { reason } }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function archiveEvidence(id: string, reload: () => Promise<void>) {
  await syncosFetch(`/signal-evidence/${id}/archive`, { method: "POST" }).catch((error) => window.alert((error as Error).message));
  await reload();
}

function recommendedAction(signal: SyncRecord, evidenceCount: number, ready: boolean) {
  if (signal.status === "archived") return "View only";
  if (ready) return "Create candidate";
  if (evidenceCount === 0) return "Add evidence";
  if (!signal.confidence_score) return "Score signal";
  if (signal.status !== "verified") return "Verify signal";
  return "Review missing candidate readiness items";
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
