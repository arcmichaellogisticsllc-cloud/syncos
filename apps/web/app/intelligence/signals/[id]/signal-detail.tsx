"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { dateValue, defaultSignalPermissions, hasPermission, numberValue, readPermissions, readToken, savePermissions, saveToken, syncosFetch, textValue, type SyncRecord } from "../../api";
import { IntelligenceShell } from "../../intelligence-shell";

const evidenceTypes = ["source_url", "document", "screenshot", "email_note", "call_note", "meeting_note", "public_record", "procurement_notice", "permit_record", "funding_notice", "relationship_note", "other"];
const archiveReasons = ["duplicate", "stale", "false_signal", "out_of_territory", "not_telecom_work", "insufficient_evidence", "no_longer_relevant", "other"];
const workTypes = ["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"];

type SignalDetailResponse = {
  signal: SyncRecord;
  evidence: SyncRecord[];
  entities: { organizations: SyncRecord[]; territories: SyncRecord[]; contacts: SyncRecord[] };
  primary_organization: SyncRecord | null;
  primary_territory: SyncRecord | null;
  contacts: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  readiness: {
    candidate_ready: boolean;
    checklist: Record<string, boolean>;
    missing_items: string[];
    recommended_action?: string;
  };
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  workflow_tasks: SyncRecord[];
  timeline_summary: SyncRecord[];
};

export function SignalDetail({ signalId }: { signalId: string }) {
  const [detail, setDetail] = useState<SignalDetailResponse | null>(null);
  const [organizations, setOrganizations] = useState<SyncRecord[]>([]);
  const [territories, setTerritories] = useState<SyncRecord[]>([]);
  const [contacts, setContacts] = useState<SyncRecord[]>([]);
  const [audit, setAudit] = useState<SyncRecord[]>([]);
  const [permissions, setPermissions] = useState<string[]>(defaultSignalPermissions);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);
  const [showCandidate, setShowCandidate] = useState(false);
  const [showAttach, setShowAttach] = useState<"organization" | "territory" | "contact" | null>(null);

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
      const [nextDetail, nextOrganizations, nextTerritories, nextContacts, effective] = await Promise.all([
        syncosFetch<SignalDetailResponse>(`/signals/${signalId}/detail`),
        syncosFetch<SyncRecord[]>("/organizations").catch(() => []),
        syncosFetch<SyncRecord[]>("/territories").catch(() => []),
        syncosFetch<SyncRecord[]>("/contacts").catch(() => []),
        syncosFetch<{ permissions?: string[] }>("/auth/me/permissions").catch(() => null),
      ]);
      setDetail(nextDetail);
      setOrganizations(nextOrganizations);
      setTerritories(nextTerritories);
      setContacts(nextContacts);
      if (effective?.permissions?.length) {
        setPermissions(effective.permissions);
        savePermissions(effective.permissions);
      }
      if (hasPermission(effective?.permissions ?? readPermissions(), "signal.audit.read")) {
        const auditRows = await syncosFetch<SyncRecord[]>(`/signals/${signalId}/audit-summary`).catch(() => []);
        setAudit(auditRows);
      }
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  function persistSession() {
    saveToken(token);
    savePermissions(permissions);
    void load();
  }

  const signal = detail?.signal;
  const archived = signal?.status === "archived" || Boolean(signal?.archived_at);

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
      {!detail || !signal ? <section className="panel"><div className="empty-state">Loading signal...</div></section> : null}
      {detail && signal ? (
        <>
          <section className="panel workspace-panel">
            <div className="signal-header">
              <div>
                <h2>{textValue(signal.title)}</h2>
                <div className="badge-row">
                  <span className="badge">{textValue(signal.status)}</span>
                  <span className="badge">Confidence {textValue(signal.confidence_score ?? signal.confidence, "0")}</span>
                  <span className="badge">Trust {textValue(signal.trust_level)}</span>
                </div>
              </div>
              <div className="header-facts">
                <span>Territory: {textValue(signal.primary_territory_name)}</span>
                <span>Owner: {textValue(signal.owner_name)}</span>
                <span>Date discovered: {dateValue(signal.date_discovered ?? signal.created_at)}</span>
                <span>Last updated: {dateValue(signal.updated_at)}</span>
              </div>
            </div>
            <LifecycleActions
              signal={signal}
              permissions={permissions}
              ready={detail.readiness.candidate_ready}
              activeEvidenceCount={numberValue(signal.active_evidence_count, 0)}
              onAddEvidence={() => setShowEvidence(true)}
              onAttachOrganization={() => setShowAttach("organization")}
              onAttachTerritory={() => setShowAttach("territory")}
              onAttachContact={() => setShowAttach("contact")}
              onCreateCandidate={() => setShowCandidate(true)}
              onReload={load}
            />
          </section>

          <div className="detail-grid">
            <section className="panel">
              <h2>Main Summary</h2>
              <dl className="detail-list">
                <dt>Summary</dt><dd>{textValue(signal.summary ?? signal.description)}</dd>
                <dt>Category</dt><dd>{textValue(signal.category ?? signal.signal_category)}</dd>
                <dt>Type</dt><dd>{textValue(signal.type ?? signal.signal_type)}</dd>
                <dt>Source type</dt><dd>{textValue(signal.source_type)}</dd>
                <dt>Source</dt><dd>{signal.source_url ? <a className="table-link" href={String(signal.source_url)} target="_blank">{textValue(signal.source_name ?? signal.source_url)}</a> : textValue(signal.source_name ?? signal.source_note)}</dd>
                <dt>Estimated value</dt><dd>{textValue(signal.estimated_value)}</dd>
                <dt>Work type</dt><dd>{textValue(signal.work_type)}</dd>
              </dl>
            </section>

            <section className="panel">
              <div className="section-toolbar">
                <h2>Evidence</h2>
                <button type="button" disabled={archived || !hasPermission(permissions, "signal_evidence.create")} onClick={() => setShowEvidence(true)}>Add Evidence</button>
              </div>
              <p className="muted">A signal cannot be verified until at least one active evidence record exists.</p>
              <Metric label="Evidence count" value={String(signal.active_evidence_count ?? detail.evidence.length)} />
              {detail.evidence.length === 0 ? <div className="empty-state">No evidence has been added yet. Add source material, notes, or documentation before verifying this signal.</div> : null}
              <div className="evidence-list">
                {detail.evidence.map((item) => (
                  <article key={String(item.id)} className="evidence-item">
                    <strong>{textValue(item.evidence_type)}</strong>
                    <p>{textValue(item.description ?? item.summary)}</p>
                    <div className="mini-grid">
                      <span>Trust level: {textValue(item.trust_level)}</span>
                      <span>Uploaded by: {textValue(item.created_by)}</span>
                      <span>Created: {dateValue(item.created_at)}</span>
                    </div>
                    <div className="row-actions">
                      {item.source_url ? <a href={String(item.source_url)} target="_blank">Open Source</a> : null}
                      <button type="button" disabled={archived || !hasPermission(permissions, "signal_evidence.archive") || item.status === "archived"} onClick={() => archiveEvidence(String(item.id), load)}>Archive Evidence</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="section-toolbar">
                <h2>Related Organization</h2>
                <button type="button" disabled={archived || !hasPermission(permissions, "signal_entity.create")} onClick={() => setShowAttach("organization")}>Attach</button>
              </div>
              {detail.entities.organizations.length ? detail.entities.organizations.map((entity) => <p key={String(entity.signal_entity_id)}>{textValue(entity.display_name)} {entity.is_primary ? <span className="badge">Primary</span> : null}</p>) : <div className="empty-state">No organization is attached. Attach or create an organization before creating a candidate.</div>}
            </section>

            <section className="panel">
              <div className="section-toolbar">
                <h2>Related Contacts</h2>
                <button type="button" disabled={archived || !hasPermission(permissions, "signal_entity.create")} onClick={() => setShowAttach("contact")}>Attach</button>
              </div>
              {detail.contacts.length ? detail.contacts.map((entity) => <p key={String(entity.signal_entity_id)}>{textValue(entity.display_name)}</p>) : <div className="empty-state">No contacts are attached.</div>}
            </section>

            <section className="panel">
              <div className="section-toolbar">
                <h2>Territory</h2>
                <button type="button" disabled={archived || !hasPermission(permissions, "signal_entity.create")} onClick={() => setShowAttach("territory")}>Attach</button>
              </div>
              {detail.entities.territories.length ? detail.entities.territories.map((entity) => <p key={String(entity.signal_entity_id)}>{textValue(entity.display_name)} {entity.is_primary ? <span className="badge">Primary</span> : null}</p>) : <div className="empty-state">No territory is attached.</div>}
            </section>

            <section className="panel">
              <h2>Candidate Readiness</h2>
              <div className="checklist">
                {Object.entries(detail.readiness.checklist).map(([key, complete]) => (
                  <div className={`check-item ${complete ? "complete" : "missing"}`} key={key}>
                    <span>{readinessLabel(key)}</span>
                    <strong>{complete ? "Complete" : "Missing"}</strong>
                  </div>
                ))}
              </div>
              {detail.readiness.candidate_ready ? (
                <button className="primary-button" type="button" disabled={archived || !hasPermission(permissions, "opportunity_candidate.create")} onClick={() => setShowCandidate(true)}>Create Opportunity Candidate</button>
              ) : <p className="muted">Missing: {detail.readiness.missing_items.join(", ")}</p>}
            </section>

            <section className="panel">
              <h2>Confidence / Trust</h2>
              <Metric label="Confidence score" value={textValue(signal.confidence_score ?? signal.confidence, "0")} />
              <Metric label="Trust level" value={textValue(signal.trust_level)} />
              <Metric label="Recommended next action" value={textValue(signal.recommended_next_action ?? detail.readiness.recommended_action)} />
            </section>

            <section className="panel">
              <h2>Constraints / Recommendations</h2>
              {[...detail.constraints, ...detail.recommendations].length === 0 ? <div className="empty-state">No related constraints or recommendations are currently attached to this signal.</div> : null}
              {detail.constraints.map((item) => <p key={String(item.id)}>{textValue(item.title)} <span className="badge">{textValue(item.status)}</span></p>)}
              {detail.recommendations.map((item) => <p key={String(item.id)}>{textValue(item.title)} <span className="badge">{textValue(item.status)}</span></p>)}
            </section>

            <section className="panel">
              <h2>Event Timeline</h2>
              {detail.timeline_summary.length === 0 ? <div className="empty-state">No signal events found.</div> : detail.timeline_summary.map((item) => <p key={String(item.event_id)}>{dateValue(item.timestamp)} - {textValue(item.event_type)}</p>)}
            </section>

            <section className="panel">
              <h2>Audit Summary</h2>
              {!hasPermission(permissions, "signal.audit.read") ? <div className="empty-state">Audit summary requires signal audit permission.</div> : null}
              {hasPermission(permissions, "signal.audit.read") && audit.length === 0 ? <div className="empty-state">No audit records found.</div> : null}
              {audit.map((item) => <p key={String(item.audit_id)}>{dateValue(item.created_at)} - {textValue(item.action)}</p>)}
            </section>
          </div>

          {showEvidence ? <EvidenceModal signalId={signalId} onClose={() => setShowEvidence(false)} onSaved={load} /> : null}
          {showCandidate ? <CandidateModal signal={signal} onClose={() => setShowCandidate(false)} onSaved={load} /> : null}
          {showAttach ? <AttachEntityModal signalId={signalId} entityType={showAttach} organizations={organizations} territories={territories} contacts={contacts} onClose={() => setShowAttach(null)} onSaved={load} /> : null}
        </>
      ) : null}
    </IntelligenceShell>
  );
}

function LifecycleActions({ signal, permissions, ready, activeEvidenceCount, onAddEvidence, onAttachOrganization, onAttachTerritory, onAttachContact, onCreateCandidate, onReload }: { signal: SyncRecord; permissions: string[]; ready: boolean; activeEvidenceCount: number; onAddEvidence: () => void; onAttachOrganization: () => void; onAttachTerritory: () => void; onAttachContact: () => void; onCreateCandidate: () => void; onReload: () => Promise<void> }) {
  const status = String(signal.status);
  const archived = status === "archived";
  const actions = [
    { label: "Categorize", permission: "signal.categorize", show: status === "discovered", run: () => categorize(String(signal.id), onReload) },
    { label: "Score", permission: "signal.score", show: status === "categorized", run: () => score(String(signal.id), onReload) },
    { label: "Verify", permission: "signal.verify", show: ["scored", "investigated"].includes(status), disabled: activeEvidenceCount === 0, run: () => verify(String(signal.id), onReload) },
    { label: "Add Evidence", permission: "signal_evidence.create", show: status !== "consumed", run: onAddEvidence },
    { label: "Attach Organization", permission: "signal_entity.create", show: !signal.primary_organization_id, run: onAttachOrganization },
    { label: "Attach Territory", permission: "signal_entity.create", show: !signal.primary_territory_id, run: onAttachTerritory },
    { label: "Attach Contact", permission: "signal_entity.create", show: true, run: onAttachContact },
    { label: "Create Candidate", permission: "opportunity_candidate.create", show: ["scored", "investigated", "verified"].includes(status), disabled: !ready, run: onCreateCandidate },
    { label: "Archive", permission: "signal.archive", show: status !== "consumed", run: () => archiveSignal(String(signal.id), onReload) },
  ].filter((action) => action.show && !archived);

  if (archived) return <div className="action-bar"><span className="muted">This signal is archived. Actions are limited.</span></div>;
  return <div className="action-bar">{actions.map((action) => <button key={action.label} type="button" disabled={action.disabled || !hasPermission(permissions, action.permission)} onClick={action.run}>{action.label}</button>)}</div>;
}

function EvidenceModal({ signalId, onClose, onSaved }: { signalId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await syncosFetch(`/signals/${signalId}/evidence`, {
        method: "POST",
        body: { evidence_type: form.get("evidence_type"), summary: form.get("description"), description: form.get("description"), source_url: form.get("source_url") || undefined, trust_level: form.get("trust_level") || "unverified" },
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
        <div className="section-toolbar"><h2>Add Evidence</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        <label>Evidence type<SelectInput name="evidence_type" options={evidenceTypes} required /></label>
        <label>Description<textarea name="description" required /></label>
        <label>Source URL<input name="source_url" type="url" /></label>
        <label>Trust level<SelectInput name="trust_level" options={["unverified", "low", "medium", "high", "verified"]} defaultValue="unverified" /></label>
        <button className="primary-button" type="submit">Add Evidence</button>
      </form>
    </div>
  );
}

function AttachEntityModal({ signalId, entityType, organizations, territories, contacts, onClose, onSaved }: { signalId: string; entityType: "organization" | "territory" | "contact"; organizations: SyncRecord[]; territories: SyncRecord[]; contacts: SyncRecord[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const rows = entityType === "organization" ? organizations : entityType === "territory" ? territories : contacts;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await syncosFetch(`/signals/${signalId}/entities`, { method: "POST", body: { entity_type: entityType, entity_id: form.get("entity_id"), is_primary: form.get("is_primary") === "on" } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal-panel compact-modal" onSubmit={submit}>
        <div className="section-toolbar"><h2>Attach {entityType}</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        <label>{entityType}<SelectInput name="entity_id" options={rows.map((row) => [String(row.id), textValue(row.name ?? row.full_name ?? row.title)])} required /></label>
        {entityType !== "contact" ? <label className="checkbox-row"><input name="is_primary" type="checkbox" defaultChecked /> Primary</label> : null}
        <button className="primary-button" type="submit">Attach</button>
      </form>
    </div>
  );
}

function CandidateModal({ signal, onClose, onSaved }: { signal: SyncRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!form.get("confirm")) {
      setError("Confirm that this signal has enough evidence to become an opportunity candidate.");
      return;
    }
    try {
      await syncosFetch(`/signals/${signal.id}/create-candidate`, {
        method: "POST",
        body: {
          candidate_name: form.get("name"),
          organization_id: signal.primary_organization_id,
          territory_id: signal.primary_territory_id,
          work_type: form.get("work_type") || signal.work_type || "unknown",
          evidence_summary: form.get("evidence_summary"),
          estimated_value: signal.estimated_value,
          contribution_score: Number(form.get("contribution_score") ?? signal.confidence_score ?? 60),
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
        <div className="section-toolbar"><h2>Create Opportunity Candidate</h2><button type="button" onClick={onClose}>Close</button></div>
        {error ? <div className="error-banner">{error}</div> : null}
        <label>Candidate name<input name="name" defaultValue={textValue(signal.title, "")} required /></label>
        <label>Organization<input value={textValue(signal.primary_organization_name, "")} readOnly /></label>
        <label>Territory<input value={textValue(signal.primary_territory_name, "")} readOnly /></label>
        <label>Work type<SelectInput name="work_type" options={workTypes} defaultValue={textValue(signal.work_type, "unknown")} required /></label>
        <label>Evidence summary<textarea name="evidence_summary" defaultValue={textValue(signal.summary ?? signal.description, "")} required /></label>
        <label>Attached signal contribution score<input name="contribution_score" type="number" min="0" max="100" defaultValue={String(signal.confidence_score ?? signal.confidence ?? 60)} /></label>
        <label className="checkbox-row"><input name="confirm" type="checkbox" /> This signal has enough evidence to become an opportunity candidate.</label>
        <button className="primary-button" type="submit">Create Candidate</button>
      </form>
    </div>
  );
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
  await syncosFetch(`/signals/${id}/verify`, { method: "POST", body: {} }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function archiveSignal(id: string, reload: () => Promise<void>) {
  const archive_reason = window.prompt(`Archive reason: ${archiveReasons.join(", ")}`, "stale");
  if (!archive_reason) return;
  await syncosFetch(`/signals/${id}/archive`, { method: "POST", body: { archive_reason } }).catch((error) => window.alert((error as Error).message));
  await reload();
}

async function archiveEvidence(id: string, reload: () => Promise<void>) {
  await syncosFetch(`/signal-evidence/${id}/archive`, { method: "POST" }).catch((error) => window.alert((error as Error).message));
  await reload();
}

function readinessLabel(key: string) {
  return {
    verified_status: "Status is verified",
    confidence_at_least_60: "Confidence score >= 60",
    organization_attached: "Related organization exists",
    active_evidence_exists: "Active evidence exists",
    territory_attached: "Territory exists",
  }[key] ?? key;
}
