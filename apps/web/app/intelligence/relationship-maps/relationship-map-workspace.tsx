"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  dateValue,
  defaultRelationshipPermissions,
  hasPermission,
  numberValue,
  readPermissions,
  readToken,
  savePermissions,
  saveToken,
  syncosFetch,
  textValue,
  type SyncRecord,
} from "../api";
import { IntelligenceShell } from "../intelligence-shell";

const mapTypes = ["organization_access", "opportunity_access", "customer_access", "prime_access", "engineering_access", "capacity_access", "billing_access", "field_access", "executive_access"];
const mapStatuses = ["no_path", "weak_path", "identified_path", "introduction_requested", "conversation_opened", "relationship_active", "strategic_access", "dormant", "archived"];
const backendMapStatuses = mapStatuses.filter((status) => status !== "archived");
const pathStatuses = ["proposed", "active", "inactive", "archived"];
const archiveReasons = ["no_longer_relevant", "duplicate", "target_changed", "organization_inactive", "opportunity_lost", "relationship_no_longer_useful", "other"];

type RelationshipData = {
  maps: SyncRecord[];
  pathsByMap: Record<string, SyncRecord[]>;
  organizations: SyncRecord[];
  contacts: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  workflowTasks: SyncRecord[];
  timelineByMap: Record<string, SyncRecord[]>;
  auditByMap: Record<string, SyncRecord[]>;
  unavailable: string[];
};

type MapView = SyncRecord & {
  id: string;
  name: string;
  targetOrganization?: SyncRecord;
  targetContact?: SyncRecord;
  candidate?: SyncRecord;
  opportunity?: SyncRecord;
  paths: SyncRecord[];
  activePaths: SyncRecord[];
  bestPath?: SyncRecord;
  bestStrength: number | null;
  bestConfidence: number | null;
  accessScore: number;
  recommendedNextAction: string;
  gaps: RelationshipGap[];
  mapType: string;
  objective: string;
  desiredOutcome: string;
};

type RelationshipGap = {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  suggestedAction: string;
};

type Filters = {
  q: string;
  status: string;
  mapType: string;
  targetOrganizationId: string;
  targetContactId: string;
  minStrength: string;
  minConfidence: string;
  minAccess: string;
  hasTargetContact: string;
  hasActivePath: string;
  archived: string;
  sort: string;
};

const initialFilters: Filters = {
  q: "",
  status: "",
  mapType: "",
  targetOrganizationId: "",
  targetContactId: "",
  minStrength: "",
  minConfidence: "",
  minAccess: "",
  hasTargetContact: "",
  hasActivePath: "",
  archived: "false",
  sort: "default",
};

export function RelationshipMapDirectory() {
  const session = useSession();
  const [data, setData] = useState<RelationshipData>(emptyData);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await loadRelationshipData());
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const maps = useMemo(() => sortMaps(data.maps.map((map) => enrichMap(map, data)).filter((map) => mapMatchesFilters(map, filters)), filters.sort), [data, filters]);
  const summary = useMemo(() => buildSummary(data.maps.map((map) => enrichMap(map, data))), [data]);

  return (
    <IntelligenceShell title="Relationship Maps" purpose="Define telecom access targets, compare relationship paths, and identify the next relationship action.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <UnsupportedNotice />
      <div className="summary-grid">
        <SummaryCard label="Total Relationship Maps" value={summary.total} onClick={() => setFilters(initialFilters)} />
        <SummaryCard label="No Path" value={summary.noPath} onClick={() => setFilters({ ...initialFilters, status: "no_path" })} />
        <SummaryCard label="Weak Path" value={summary.weakPath} onClick={() => setFilters({ ...initialFilters, status: "weak_path" })} />
        <SummaryCard label="Identified Path" value={summary.identifiedPath} onClick={() => setFilters({ ...initialFilters, status: "identified_path" })} />
        <SummaryCard label="Introduction Requested" value={summary.introductionRequested} onClick={() => setFilters({ ...initialFilters, status: "introduction_requested" })} />
        <SummaryCard label="Conversation Opened" value={summary.conversationOpened} onClick={() => setFilters({ ...initialFilters, status: "conversation_opened" })} />
        <SummaryCard label="Active Relationships" value={summary.activeRelationships} onClick={() => setFilters({ ...initialFilters, status: "relationship_active" })} />
        <SummaryCard label="Strategic Access" value={summary.strategicAccess} onClick={() => setFilters({ ...initialFilters, status: "strategic_access" })} />
        <SummaryCard label="Dormant Relationships" value={summary.dormant} onClick={() => setFilters({ ...initialFilters, status: "dormant" })} />
        <SummaryCard label="Archived Maps" value={summary.archived} onClick={() => setFilters({ ...initialFilters, archived: "true" })} />
        <SummaryCard label="Relationship Constraints" value={summary.constraints} onClick={() => undefined} />
      </div>

      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Relationship Map Directory</h2>
            <p className="muted">Filters are shown over the tenant-scoped enriched relationship read model.</p>
          </div>
          <Link className="primary-button link-button" href="/intelligence/relationship-maps/new" aria-disabled={!hasPermission(session.permissions, "relationship_map.create")}>Create Relationship Map</Link>
        </div>
        <div className="filter-grid">
          <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search maps, organizations, contacts" />
          <Select label="Status" value={filters.status} options={["", ...mapStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
          <Select label="Map type" value={filters.mapType} options={["", ...mapTypes]} onChange={(mapType) => setFilters({ ...filters, mapType })} />
          <Select label="Target organization" value={filters.targetOrganizationId} options={["", ...data.organizations.map((organization) => String(organization.id))]} labels={labelMap(data.organizations, "name")} onChange={(targetOrganizationId) => setFilters({ ...filters, targetOrganizationId })} />
          <Select label="Target contact" value={filters.targetContactId} options={["", ...data.contacts.map((contact) => String(contact.id))]} labels={contactLabels(data.contacts)} onChange={(targetContactId) => setFilters({ ...filters, targetContactId })} />
          <input value={filters.minStrength} onChange={(event) => setFilters({ ...filters, minStrength: event.target.value })} type="number" min="0" max="100" placeholder="Min path strength" />
          <input value={filters.minConfidence} onChange={(event) => setFilters({ ...filters, minConfidence: event.target.value })} type="number" min="0" max="100" placeholder="Min confidence" />
          <input value={filters.minAccess} onChange={(event) => setFilters({ ...filters, minAccess: event.target.value })} type="number" min="0" max="100" placeholder="Min access score" />
          <Select label="Target contact" value={filters.hasTargetContact} options={["", "true", "false"]} onChange={(hasTargetContact) => setFilters({ ...filters, hasTargetContact })} />
          <Select label="Active path" value={filters.hasActivePath} options={["", "true", "false"]} onChange={(hasActivePath) => setFilters({ ...filters, hasActivePath })} />
          <Select label="Archived" value={filters.archived} options={["", "true", "false"]} onChange={(archived) => setFilters({ ...filters, archived })} />
          <Select label="Sort" value={filters.sort} options={["default", "updated_desc", "access_desc", "strength_desc", "confidence_desc", "status", "target_organization"]} onChange={(sort) => setFilters({ ...filters, sort })} />
          <button type="button" onClick={() => setFilters(initialFilters)}>Clear filters</button>
        </div>
        <div className="quick-filter-row">
          {[
            ["No Path", { status: "no_path" }],
            ["Weak Path", { status: "weak_path" }],
            ["Needs Introduction", { status: "identified_path" }],
            ["Active Relationships", { status: "relationship_active" }],
            ["Opportunity-Linked", { mapType: "opportunity_access" }],
            ["Prime Contractor Access", { mapType: "prime_access" }],
            ["Billing Access", { mapType: "billing_access" }],
            ["Capacity Access", { mapType: "capacity_access" }],
            ["Missing Target Contact", { hasTargetContact: "false" }],
            ["No Active Path", { hasActivePath: "false" }],
          ].map(([label, patch]) => (
            <button key={String(label)} type="button" onClick={() => setFilters({ ...initialFilters, ...(patch as Partial<Filters>) })}>{String(label)}</button>
          ))}
        </div>
      </section>

      <section className="workspace-panel">
        {loading ? <div className="empty-state">Loading relationship maps...</div> : null}
        {!loading && maps.length === 0 ? (
          <div className="empty-state">
            <p>No relationship maps yet. Create a map to define who Jackson needs access to and how that access may be built.</p>
            <Link className="primary-button link-button" href="/intelligence/relationship-maps/new">Create Relationship Map</Link>
          </div>
        ) : null}
        {maps.length > 0 ? <RelationshipMapTable maps={maps} /> : null}
      </section>
    </IntelligenceShell>
  );
}

export function RelationshipMapForm({ mode, mapId }: { mode: "create" | "edit"; mapId?: string }) {
  const router = useRouter();
  const session = useSession();
  const [data, setData] = useState<RelationshipData>(emptyData);
  const [form, setForm] = useState({
    name: "",
    map_type: "organization_access",
    target_organization_id: "",
    target_contact_id: "",
    objective: "",
    desired_outcome: "",
    related_candidate_id: "",
    related_opportunity_id: "",
    owner_user_id: "",
    priority: "",
    strategic_flag: false,
    due_date: "",
    status: "no_path",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const nextData = await loadRelationshipData();
        setData(nextData);
        if (mode === "edit" && mapId) {
          const map = await syncosFetch<SyncRecord>(`/relationship-maps/${mapId}`);
          setForm({
            name: textValue(map.name, ""),
            map_type: textValue(map.map_type, deriveMapType(map)),
            target_organization_id: textValue(map.target_organization_id, ""),
            target_contact_id: textValue(map.target_contact_id, ""),
            objective: textValue(map.objective, ""),
            desired_outcome: textValue(map.desired_outcome, ""),
            related_candidate_id: textValue(map.related_candidate_id ?? (map.target_object_type === "opportunity_candidate" ? map.target_object_id : ""), ""),
            related_opportunity_id: textValue(map.related_opportunity_id, ""),
            owner_user_id: textValue(map.owner_user_id, ""),
            priority: textValue(map.priority, ""),
            strategic_flag: Boolean(map.strategic_flag),
            due_date: textValue(map.due_date, ""),
            status: textValue(map.status, "no_path"),
          });
        }
      } catch (nextError) {
        setError((nextError as Error).message);
      }
    }
    void load();
  }, [mapId, mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Relationship map name is required.");
    if (!form.target_organization_id) return setError("Target organization is required.");
    if (!form.objective.trim()) return setError("Objective is required.");
    const body = prune({
      name: form.name,
      map_type: form.map_type,
      objective: form.objective,
      desired_outcome: form.desired_outcome,
      target_organization_id: form.target_organization_id,
      target_contact_id: form.target_contact_id,
      related_candidate_id: form.related_candidate_id || undefined,
      related_opportunity_id: form.related_opportunity_id || undefined,
      owner_user_id: form.owner_user_id || undefined,
      priority: form.priority || undefined,
      strategic_flag: form.strategic_flag,
      due_date: form.due_date || undefined,
      status: mode === "create" && backendMapStatuses.includes(form.status) ? form.status : undefined,
    });
    try {
      const saved = mode === "edit" && mapId ? await syncosFetch<SyncRecord>(`/relationship-maps/${mapId}`, { method: "PATCH", body }) : await syncosFetch<SyncRecord>("/relationship-maps", { method: "POST", body });
      if (mode === "edit" && mapId && form.status && backendMapStatuses.includes(form.status)) {
        await syncosFetch(`/relationship-maps/${mapId}/status`, { method: "POST", body: { status: form.status, reason: "Updated from relationship map edit form." } });
      }
      router.push(`/intelligence/relationship-maps/${saved.id ?? mapId}`);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <IntelligenceShell title={mode === "create" ? "Create Relationship Map" : "Edit Relationship Map"} purpose="Define who Jackson needs access to and which existing backend relationship fields can support that access target.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <UnsupportedNotice />
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label>Map name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label>Map type<SelectInline value={form.map_type} options={mapTypes} onChange={(map_type) => setForm({ ...form, map_type })} /></label>
          <label>Target organization<SelectInline value={form.target_organization_id} options={["", ...data.organizations.map((organization) => String(organization.id))]} labels={labelMap(data.organizations, "name")} onChange={(target_organization_id) => setForm({ ...form, target_organization_id, target_contact_id: "" })} /></label>
          <label>Target contact<SelectInline value={form.target_contact_id} options={["", ...data.contacts.filter((contact) => !form.target_organization_id || contact.organization_id === form.target_organization_id).map((contact) => String(contact.id))]} labels={contactLabels(data.contacts)} onChange={(target_contact_id) => setForm({ ...form, target_contact_id })} /></label>
          <label>Related candidate<SelectInline value={form.related_candidate_id} options={["", ...data.candidates.map((candidate) => String(candidate.id))]} labels={labelMap(data.candidates, "name")} onChange={(related_candidate_id) => setForm({ ...form, related_candidate_id })} /></label>
          <label>Related opportunity<SelectInline value={form.related_opportunity_id} options={["", ...data.opportunities.map((opportunity) => String(opportunity.id))]} labels={labelMap(data.opportunities, "name")} onChange={(related_opportunity_id) => setForm({ ...form, related_opportunity_id })} /></label>
          <label>Owner user id<input value={form.owner_user_id} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} /></label>
          <label>Priority<input value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} /></label>
          <label>Due date<input value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} type="date" /></label>
          <label>Strategic flag<input type="checkbox" checked={form.strategic_flag} onChange={(event) => setForm({ ...form, strategic_flag: event.target.checked })} /></label>
          <label>Status<SelectInline value={form.status} options={backendMapStatuses} onChange={(status) => setForm({ ...form, status })} /></label>
          <label>Objective<textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} required /></label>
          <label>Desired outcome<textarea value={form.desired_outcome} onChange={(event) => setForm({ ...form, desired_outcome: event.target.value })} /></label>
        </div>
        <div className="warning-box">This form uses the hardened relationship map API. Owner choices appear when the backend exposes tenant users to the UI.</div>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, mode === "create" ? "relationship_map.create" : "relationship_map.update")}>{mode === "create" ? "Create Relationship Map" : "Save Relationship Map"}</button>
          <Link href={mapId ? `/intelligence/relationship-maps/${mapId}` : "/intelligence/relationship-maps"}>Cancel</Link>
        </div>
      </form>
    </IntelligenceShell>
  );
}

export function RelationshipMapDetail({ mapId }: { mapId: string }) {
  const session = useSession();
  const [data, setData] = useState<RelationshipData>(emptyData);
  const [map, setMap] = useState<MapView | null>(null);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [nextData, detail, timeline, audit] = await Promise.all([
        loadRelationshipData(),
        syncosFetch<SyncRecord>(`/relationship-maps/${mapId}/detail`),
        hasPermission(session.permissions, "relationship_map.timeline.read") ? optionalList(`/relationship-maps/${mapId}/timeline`) : Promise.resolve([]),
        hasPermission(session.permissions, "relationship_map.audit.read") ? optionalList(`/relationship-maps/${mapId}/audit-summary`) : Promise.resolve([]),
      ]);
      const nextMap = (detail.relationship_map ?? detail) as SyncRecord;
      const paths = Array.isArray(detail.paths) ? detail.paths as SyncRecord[] : [];
      const candidates = detail.related_candidate ? [detail.related_candidate as SyncRecord, ...nextData.candidates.filter((candidate) => candidate.id !== (detail.related_candidate as SyncRecord).id)] : nextData.candidates;
      const opportunities = detail.related_opportunity ? [detail.related_opportunity as SyncRecord, ...nextData.opportunities.filter((opportunity) => opportunity.id !== (detail.related_opportunity as SyncRecord).id)] : nextData.opportunities;
      const merged = { ...nextData, maps: [nextMap, ...nextData.maps.filter((row) => row.id !== nextMap.id)], pathsByMap: { ...nextData.pathsByMap, [mapId]: paths } };
      merged.candidates = candidates;
      merged.opportunities = opportunities;
      merged.timelineByMap = { ...nextData.timelineByMap, [mapId]: timeline };
      merged.auditByMap = { ...nextData.auditByMap, [mapId]: audit };
      setData(merged);
      setMap(enrichMap(nextMap, merged));
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [mapId]);

  const tabs = ["overview", "paths", "gaps", "organization", "contact", "candidate", "opportunity", "constraints", "recommendations", "workflow", "timeline", "audit"];

  return (
    <IntelligenceShell title="Relationship Map Detail" purpose="See the access target, best path, relationship gaps, and supported next action.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      {!map ? (
        <section className="workspace-panel"><div className="empty-state">Relationship map not found or you do not have access.</div></section>
      ) : (
        <>
          <section className="workspace-panel">
            <div className="section-toolbar">
              <div>
                <h2>{map.name}</h2>
                <div className="badge-row">
                  <span className="badge">{formatAction(map.status)}</span>
                  <span className="badge">{formatAction(map.mapType)}</span>
                  <span className="badge">{map.targetOrganization ? textValue(map.targetOrganization.name) : "No target organization"}</span>
                  <span className="badge">{map.targetContact ? contactName(map.targetContact) : "No target contact"}</span>
                </div>
              </div>
              <div className="form-actions">
                <Link href={`/intelligence/relationship-maps/${map.id}/edit`}>Edit Map</Link>
                <button type="button" disabled={!hasPermission(session.permissions, "relationship_path.create") || map.status === "archived"} onClick={() => setModal("path")}>Add Path</button>
                <button type="button" disabled={!hasPermission(session.permissions, "relationship_map.status") || map.status === "archived"} onClick={() => setModal("status")}>Update Status</button>
                <button type="button" disabled={!hasPermission(session.permissions, "relationship_map.status") || map.status === "archived"} onClick={() => setModal("introduction")}>Request Introduction</button>
                <button type="button" disabled={!hasPermission(session.permissions, "relationship_map.archive") || map.status === "archived"} onClick={() => setModal("archive")}>Archive Map</button>
                <button type="button" onClick={() => setModal("analysis")}>Analyze Relationship</button>
              </div>
            </div>
            <div className="summary-grid">
              <SummaryMetric label="Relationship Access Score" value={`${map.accessScore}`} />
              <SummaryMetric label="Best Path Strength" value={scoreBand(map.bestStrength, "strength")} />
              <SummaryMetric label="Best Path Confidence" value={confidenceBand(map.bestConfidence)} />
              <SummaryMetric label="Active Paths" value={String(map.activePaths.length)} />
              <SummaryMetric label="Proposed Paths" value={String(map.paths.filter((path) => path.status === "proposed").length)} />
              <SummaryMetric label="Target Contact Influence" value={scoreBand(nullableNumber(map.targetContact?.influence_score), "strength")} />
              <SummaryMetric label="Target Decision Authority" value={scoreBand(nullableNumber(map.targetContact?.decision_authority_score), "strength")} />
              <SummaryMetric label="Relationship Gaps" value={String(map.gaps.length)} />
              <SummaryMetric label="Open Constraints" value={String(relatedConstraints(map, data).length)} />
              <SummaryMetric label="Next Action" value={formatAction(map.recommendedNextAction)} />
            </div>
          </section>

          <div className="organization-layout">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl>
                <dt>Map type</dt><dd>{formatAction(map.mapType)}</dd>
                <dt>Target actor roles</dt><dd>{arrayValue(map.targetOrganization?.actor_roles).map(formatAction).join(", ") || "Not captured yet"}</dd>
                <dt>Target contact role</dt><dd>{formatAction(map.targetContact?.contact_role)}</dd>
                <dt>Objective</dt><dd>{map.objective}</dd>
                <dt>Owner</dt><dd>{textValue(map.owner_name ?? map.owner_user_id)}</dd>
                <dt>Priority</dt><dd>{textValue(map.priority)}</dd>
                <dt>Due date</dt><dd>{dateValue(map.due_date)}</dd>
                <dt>Best path</dt><dd>{map.bestPath ? pathName(map.bestPath, data) : "No active path"}</dd>
              </dl>
              <Checklist items={map.gaps.map((gap) => [gap.type, false])} />
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{formatAction(item)}</button>)}
              </div>
              <RelationshipTab tab={tab} map={map} data={data} permissions={session.permissions} onRank={load} onEditPath={(path) => setModal(`edit-path:${path.id}`)} />
            </section>
          </div>
          {modal === "path" ? <PathModal map={map} data={data} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal.startsWith("edit-path:") ? <PathModal map={map} data={data} path={map.paths.find((path) => path.id === modal.split(":")[1])} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "status" ? <StatusModal map={map} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "introduction" ? <IntroductionModal map={map} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "archive" ? <ArchiveModal map={map} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "analysis" ? <AnalysisModal map={map} onClose={() => setModal("")} /> : null}
        </>
      )}
    </IntelligenceShell>
  );
}

function RelationshipMapTable({ maps }: { maps: MapView[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            {["Map Name", "Target Organization", "Target Contact", "Map Type", "Objective", "Status", "Owner", "Priority", "Best Path Strength", "Best Path Confidence", "Access Score", "Related Candidate", "Related Opportunity", "Recommended Next Action", "Last Activity"].map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {maps.map((map) => (
            <tr key={map.id}>
              <td><Link className="table-link" href={`/intelligence/relationship-maps/${map.id}`}>{map.name}</Link></td>
              <td>{map.targetOrganization ? <Link href={`/intelligence/organizations/${map.targetOrganization.id}`}>{textValue(map.targetOrganization.name)}</Link> : "Not linked yet"}</td>
              <td>{map.targetContact ? <Link href={`/intelligence/contacts/${map.targetContact.id}`}>{contactName(map.targetContact)}</Link> : "Not identified"}</td>
              <td>{formatAction(map.mapType)}</td>
              <td>{map.objective}</td>
              <td><span className="badge">{formatAction(map.status)}</span></td>
              <td>{textValue(map.owner_name ?? map.owner_user_id)}</td>
              <td>{textValue(map.priority)}</td>
              <td>{scoreBand(map.bestStrength, "strength")}</td>
              <td>{confidenceBand(map.bestConfidence)}</td>
              <td>{map.accessScore}</td>
              <td>{map.candidate ? textValue(map.candidate.name) : "Not linked"}</td>
              <td>{map.opportunity ? textValue(map.opportunity.name) : "Not linked"}</td>
              <td>{formatAction(map.recommendedNextAction)}</td>
              <td>{dateValue(map.updated_at ?? map.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RelationshipTab({ tab, map, data, permissions, onRank, onEditPath }: { tab: string; map: MapView; data: RelationshipData; permissions: string[]; onRank: () => Promise<void>; onEditPath: (path: SyncRecord) => void }) {
  if (tab === "overview") {
    return (
      <div className="workspace-panel">
        <SummaryMetric label="Objective" value={map.objective} />
        <SummaryMetric label="Desired outcome" value={map.desiredOutcome} />
        <SummaryMetric label="Why it matters" value={mapTypeGuidance(map.mapType)} />
        <SummaryMetric label="Current access gap" value={map.gaps[0]?.type ? formatAction(map.gaps[0].type) : "No blocking gap detected"} />
        <SummaryMetric label="Recommended next action" value={formatAction(map.recommendedNextAction)} />
      </div>
    );
  }
  if (tab === "paths") return <PathList map={map} data={data} permissions={permissions} onRank={onRank} onEditPath={onEditPath} />;
  if (tab === "gaps") return <GapList gaps={map.gaps} permissions={permissions} />;
  if (tab === "organization") return <ObjectSlice title="Target Organization" rows={map.targetOrganization ? [map.targetOrganization] : []} columns={["name", "organization_type", "actor_roles", "status", "territory_name", "relationship_owner_name", "strategic_flag", "influence_score", "work_relevance_score", "capacity_relevance_score", "payment_relevance_score"]} empty="No target organization is attached. Attach a target organization before building paths." />;
  if (tab === "contact") return <ObjectSlice title="Target Contact" rows={map.targetContact ? [map.targetContact] : []} columns={["full_name", "title", "organization_name", "contact_role", "verification_status", "email", "phone", "mobile", "influence_score", "decision_authority_score", "relationship_strength_score", "last_contacted_at", "last_verified_at"]} empty="No target contact identified. Add or research the person who controls, influences, validates, or pays for the work." />;
  if (tab === "candidate") return <ObjectSlice title="Related Candidate" rows={map.candidate ? [map.candidate] : []} columns={["name", "status", "confidence_score", "estimated_value", "work_type", "owner_name"]} empty="No candidate or opportunity is linked to this relationship map." />;
  if (tab === "opportunity") return <ObjectSlice title="Related Opportunity" rows={map.opportunity ? [map.opportunity] : []} columns={["name", "status", "estimated_value", "pursuit_score", "capacity_coverage", "relationship_access_score", "owner_name", "decision_date"]} empty="No opportunity is linked to this relationship map." />;
  if (tab === "constraints") return <ObjectSlice title="Constraints" rows={relatedConstraints(map, data)} columns={["constraint_type", "severity", "owner_id", "due_date", "status", "resolution_summary"]} empty="No active constraints are tied to this relationship map." action={hasPermission(permissions, "constraint.create") ? <button type="button" disabled>Create Constraint</button> : undefined} />;
  if (tab === "recommendations") return <ObjectSlice title="Recommendations" rows={relatedRecommendations(map, data)} columns={["recommendation_type", "confidence_score", "risk_level", "expected_impact", "status", "owner_id"]} empty="No recommendations are tied to this relationship map." />;
  if (tab === "workflow") return <ObjectSlice title="Workflow Tasks" rows={data.workflowTasks.filter((task) => task.source_object_type === "relationship_map" && task.source_object_id === map.id)} columns={["task_name", "title", "assigned_to", "due_at", "status"]} empty="Workflow task linkage for relationship maps is not available yet." />;
  if (tab === "timeline") return <ObjectSlice title="Timeline" rows={data.timelineByMap[map.id] ?? []} columns={["event_type", "actor_name", "timestamp", "summary"]} empty="No relationship timeline entries are available yet." />;
  if (tab === "audit") return <ObjectSlice title="Audit" rows={data.auditByMap[map.id] ?? []} columns={["actor_name", "action", "object_type", "created_at", "correlation_id"]} empty="Relationship audit summary is not available for this user." />;
  return null;
}

function PathList({ map, data, permissions, onRank, onEditPath }: { map: MapView; data: RelationshipData; permissions: string[]; onRank: () => Promise<void>; onEditPath: (path: SyncRecord) => void }) {
  if (!map.paths.length) return <div className="empty-state">No relationship path exists yet. Add known contacts or research possible intermediaries.</div>;
  return (
    <div className="workspace-panel">
      {map.paths.map((path) => (
        <div className="summary-card" key={String(path.id)}>
          <div className="section-toolbar">
            <div>
              <strong>{pathName(path, data)}</strong>
              <div className="badge-row">
                <span className="badge">Rank {textValue(path.rank, "Not ranked")}</span>
                <span className="badge">{formatAction(path.status)}</span>
                <span className="badge">{scoreBand(nullableNumber(path.strength_score), "strength")}</span>
                <span className="badge">{confidenceBand(nullableNumber(path.confidence_score))}</span>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" disabled={!hasPermission(permissions, "relationship_path.update")} onClick={() => onEditPath(path)}>Edit Path</button>
              <button type="button" disabled={!hasPermission(permissions, "relationship_path.rank")} onClick={() => void rankPath(path, Math.max(1, numberValue(path.rank, 1) - 1), onRank)}>Move Up</button>
              <button type="button" disabled={!hasPermission(permissions, "relationship_path.rank")} onClick={() => void rankPath(path, numberValue(path.rank, 1) + 1, onRank)}>Move Down</button>
              <button type="button" disabled={!hasPermission(permissions, "relationship_path.archive")} onClick={() => void archivePath(path, onRank)}>Archive Path</button>
            </div>
          </div>
          <dl>
            <dt>From contact</dt><dd>{contactLink(path.from_contact_id, data.contacts)}</dd>
            <dt>Intermediary contacts</dt><dd>{arrayValue(path.intermediary_contact_ids).map((id) => contactName(data.contacts.find((contact) => contact.id === id))).filter(Boolean).join(", ") || "Not captured yet"}</dd>
            <dt>To contact</dt><dd>{contactLink(path.to_contact_id, data.contacts)}</dd>
            <dt>Path summary</dt><dd>{pathSummary(path)}</dd>
            <dt>Recommended action</dt><dd>{pathRecommendedAction(path)}</dd>
            <dt>Risk notes</dt><dd>{textValue(path.risk_notes)}</dd>
            <dt>Blocked reason</dt><dd>{textValue(path.blocked_reason)}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

function PathModal({ map, data, path, onClose, onSaved }: { map: MapView; data: RelationshipData; path?: SyncRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    path_name: textValue(path?.path_name, ""),
    from_contact_id: textValue(path?.from_contact_id, ""),
    to_contact_id: textValue(path?.to_contact_id ?? map.target_contact_id, ""),
    intermediary_contact_ids: arrayValue(path?.intermediary_contact_ids).join(","),
    strength_score: textValue(path?.strength_score, ""),
    confidence_score: textValue(path?.confidence_score, ""),
    rank: textValue(path?.rank, ""),
    status: textValue(path?.status, "proposed"),
    path_summary: pathSummary(path ?? {}),
  });
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.from_contact_id || !form.to_contact_id) return setError("From contact and target contact are required.");
    if (form.from_contact_id === form.to_contact_id) return setError("From contact and target contact must be different.");
    if (!form.path_name.trim()) return setError("Path name is required.");
    const body = prune({
      path_name: form.path_name,
      from_contact_id: form.from_contact_id,
      to_contact_id: form.to_contact_id,
      intermediary_contact_ids: form.intermediary_contact_ids.split(",").map((value) => value.trim()).filter(Boolean),
      strength_score: form.strength_score === "" ? undefined : Number(form.strength_score),
      confidence_score: form.confidence_score === "" ? undefined : Number(form.confidence_score),
      rank: form.rank === "" ? undefined : Number(form.rank),
      status: form.status,
      path_summary: form.path_summary,
      path: form.path_summary ? [{ summary: form.path_summary }] : [],
    });
    try {
      if (path?.id) await syncosFetch(`/relationship-paths/${path.id}`, { method: "PATCH", body });
      else await syncosFetch(`/relationship-maps/${map.id}/paths`, { method: "POST", body });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <Modal title={path ? "Edit Relationship Path" : "Create Relationship Path"} onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label>Path name<input value={form.path_name} onChange={(event) => setForm({ ...form, path_name: event.target.value })} required /></label>
          <label>From contact<SelectInline value={form.from_contact_id} options={["", ...data.contacts.map((contact) => String(contact.id))]} labels={contactLabels(data.contacts)} onChange={(from_contact_id) => setForm({ ...form, from_contact_id })} /></label>
          <label>To contact<SelectInline value={form.to_contact_id} options={["", ...data.contacts.map((contact) => String(contact.id))]} labels={contactLabels(data.contacts)} onChange={(to_contact_id) => setForm({ ...form, to_contact_id })} /></label>
          <label>Intermediary contact ids<input value={form.intermediary_contact_ids} onChange={(event) => setForm({ ...form, intermediary_contact_ids: event.target.value })} placeholder="Comma-separated contact ids" /></label>
          <label>Strength score<input value={form.strength_score} onChange={(event) => setForm({ ...form, strength_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Confidence score<input value={form.confidence_score} onChange={(event) => setForm({ ...form, confidence_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Rank<input value={form.rank} onChange={(event) => setForm({ ...form, rank: event.target.value })} type="number" min="1" /></label>
          <label>Status<SelectInline value={form.status} options={pathStatuses} onChange={(status) => setForm({ ...form, status })} /></label>
          <label>Path summary<textarea value={form.path_summary} onChange={(event) => setForm({ ...form, path_summary: event.target.value })} /></label>
        </div>
        <button className="primary-button" type="submit">{path ? "Save Path" : "Create Path"}</button>
      </form>
    </Modal>
  );
}

function StatusModal({ map, onClose, onSaved }: { map: MapView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState(textValue(map.status, "no_path"));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!backendMapStatuses.includes(status)) return setError("The current backend does not support this status.");
    if (!reason.trim()) return setError("Reason is required.");
    try {
      await syncosFetch(`/relationship-maps/${map.id}/status`, { method: "POST", body: { status, reason } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Update Relationship Status" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <label>New status<SelectInline value={status} options={backendMapStatuses} onChange={setStatus} /></label>
        <label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
        <button className="primary-button" type="submit">Update Status</button>
      </form>
    </Modal>
  );
}

function IntroductionModal({ map, onClose, onSaved }: { map: MapView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!map.target_contact_id || !map.bestPath?.from_contact_id) return setError("Cannot request introduction without source and target contact.");
    try {
      await syncosFetch(`/relationship-maps/${map.id}/status`, { method: "POST", body: { status: "introduction_requested", reason } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Request Introduction" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <p className="muted">This uses the approved relationship map status route. No outreach, workflow, or external notification is created.</p>
        <label>Reason for intro<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
        <button className="primary-button" type="submit">Set Introduction Requested</button>
      </form>
    </Modal>
  );
}

function ArchiveModal({ map, onClose, onSaved }: { map: MapView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) return setError("Archive reason is required.");
    try {
      await syncosFetch(`/relationship-maps/${map.id}/archive`, { method: "POST", body: { archive_reason: reason } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Archive Relationship Map" onClose={onClose}>
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <label>Archive reason<SelectInline value={reason} options={["", ...archiveReasons]} onChange={setReason} /></label>
        <button className="primary-button" type="submit">Archive Map</button>
      </form>
    </Modal>
  );
}

function AnalysisModal({ map, onClose }: { map: MapView; onClose: () => void }) {
  return (
    <Modal title="AI Relationship Analysis Placeholder" onClose={onClose}>
      <div className="workspace-panel">
        <p>AI-assisted relationship analysis will help identify missing contacts, possible paths, and access gaps from approved sources. No automatic field updates occur without human approval.</p>
        <ObjectSlice title="Structured placeholder" rows={[{
          relationship_summary: map.name,
          target_organization: textValue(map.targetOrganization?.name),
          target_contact: map.targetContact ? contactName(map.targetContact) : "Not identified",
          best_path: map.bestPath ? pathName(map.bestPath, { ...emptyData, contacts: [] }) : "No active path",
          relationship_gaps: map.gaps.map((gap) => gap.type).join(", ") || "No current gaps",
          recommended_next_action: formatAction(map.recommendedNextAction),
          confidence: "No live AI analysis in this sprint",
          sources: "Approved sources placeholder",
          timestamp: "Not generated",
          suggested_field_updates: "No automatic updates",
        }]} columns={["relationship_summary", "target_organization", "target_contact", "best_path", "relationship_gaps", "recommended_next_action", "confidence", "sources", "timestamp", "suggested_field_updates"]} empty="" />
      </div>
    </Modal>
  );
}

async function loadRelationshipData(): Promise<RelationshipData> {
  const unavailable: string[] = [];
  const [maps, organizations, contacts, candidates, opportunities, constraints, recommendations, workflowTasks] = await Promise.all([
    optionalList("/relationship-maps", unavailable, "relationship maps"),
    optionalList("/organizations", unavailable, "organizations"),
    optionalList("/contacts", unavailable, "contacts"),
    optionalList("/opportunity-candidates", unavailable, "opportunity candidates"),
    optionalList("/opportunities", unavailable, "opportunities"),
    optionalList("/constraints", unavailable, "constraints"),
    optionalList("/recommendations", unavailable, "recommendations"),
    optionalList("/workflow-tasks", unavailable, "workflow tasks"),
  ]);
  const pathsByMap: Record<string, SyncRecord[]> = {};
  await Promise.all(maps.map(async (map) => {
    const id = String(map.id ?? "");
    if (!id) return;
    pathsByMap[id] = await optionalList(`/relationship-maps/${id}/paths`, unavailable, "relationship paths");
  }));
  return { maps, pathsByMap, organizations, contacts, candidates, opportunities, constraints, recommendations, workflowTasks, timelineByMap: {}, auditByMap: {}, unavailable };
}

async function optionalList(path: string, unavailable: string[] = [], label = path): Promise<SyncRecord[]> {
  try {
    const result = await syncosFetch<unknown>(path);
    return Array.isArray(result) ? result as SyncRecord[] : [];
  } catch {
    unavailable.push(label);
    return [];
  }
}

function enrichMap(map: SyncRecord, data: RelationshipData): MapView {
  const id = String(map.id ?? "");
  const paths = data.pathsByMap[id] ?? [];
  const activePaths = paths.filter((path) => path.status === "active");
  const scoredPaths = (activePaths.length ? activePaths : paths).filter((path) => path.status !== "archived");
  const bestPath = [...scoredPaths].sort((a, b) => accessScoreForPath(b) - accessScoreForPath(a))[0];
  const targetOrganization = data.organizations.find((organization) => organization.id === map.target_organization_id) ?? objectFromPrefix(map, "target_organization");
  const targetContact = data.contacts.find((contact) => contact.id === map.target_contact_id) ?? objectFromPrefix(map, "target_contact");
  const candidateId = map.related_candidate_id ?? (map.target_object_type === "opportunity_candidate" ? map.target_object_id : undefined);
  const candidate = data.candidates.find((row) => row.id === candidateId) ?? objectFromPrefix(map, "related_candidate");
  const opportunity = data.opportunities.find((row) => row.id === map.related_opportunity_id || row.relationship_map_id === id || row.opportunity_candidate_id === candidate?.id) ?? objectFromPrefix(map, "related_opportunity");
  const bestStrength = nullableNumber(map.best_path_strength ?? bestPath?.strength_score);
  const bestConfidence = nullableNumber(map.best_path_confidence ?? bestPath?.confidence_score);
  const enriched = {
    ...map,
    id,
    name: textValue(map.name, "Untitled relationship map"),
    targetOrganization,
    targetContact,
    candidate,
    opportunity,
    paths,
    activePaths,
    bestPath,
    bestStrength,
    bestConfidence,
    accessScore: numberValue(map.relationship_access_score ?? map.access_score, bestPath ? accessScoreForPath(bestPath) : 0),
    mapType: textValue(map.map_type, deriveMapType(map)),
    objective: textValue(map.objective, deriveObjective(map)),
    desiredOutcome: textValue(map.desired_outcome),
  } as MapView;
  enriched.gaps = normalizeGaps(map.relationship_gaps ?? map.relationship_gap_summary) ?? relationshipGaps(enriched);
  enriched.recommendedNextAction = textValue(map.recommended_next_action, recommendedNextAction(enriched));
  return enriched;
}

function deriveMapType(map: SyncRecord) {
  if (map.target_object_type === "opportunity_candidate") return "opportunity_access";
  return "organization_access";
}

function deriveObjective(map: SyncRecord) {
  if (map.target_object_type === "opportunity_candidate") return "Build relationship access for the linked opportunity candidate.";
  return "Build relationship access to the target organization.";
}

function objectFromPrefix(row: SyncRecord, prefix: string): SyncRecord | undefined {
  const id = row[`${prefix}_id`];
  if (!id) return undefined;
  const result: SyncRecord = { id };
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(`${prefix}_`) && value !== undefined) {
      result[key.replace(`${prefix}_`, "")] = value;
    }
  }
  return result;
}

function normalizeGaps(value: unknown): RelationshipGap[] | null {
  let rows = value;
  if (typeof value === "string") {
    try {
      rows = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => {
    const record = row as SyncRecord;
    return {
      type: textValue(record.gap_type ?? record.type, "relationship_gap"),
      severity: ["critical", "high", "medium", "low"].includes(String(record.severity)) ? String(record.severity) as RelationshipGap["severity"] : "medium",
      suggestedAction: textValue(record.suggested_action ?? record.suggestedAction, "Review relationship gap."),
    };
  });
}

function accessScoreForPath(path: SyncRecord) {
  const strength = numberValue(path.strength_score, 0);
  const confidence = numberValue(path.confidence_score, 0);
  return Math.round(strength * 0.6 + confidence * 0.4);
}

function relationshipGaps(map: MapView): RelationshipGap[] {
  const gaps: RelationshipGap[] = [];
  if (!map.targetOrganization) gaps.push({ type: "no_target_organization", severity: "high", suggestedAction: "Attach target organization." });
  if (!map.targetContact) gaps.push({ type: "no_target_contact", severity: "high", suggestedAction: "Identify the target contact." });
  if (map.targetContact && !hasContactMethod(map.targetContact)) gaps.push({ type: "no_verified_contact_method", severity: "high", suggestedAction: "Verify a contact method." });
  if (!map.activePaths.length) gaps.push({ type: "no_active_path", severity: "high", suggestedAction: "Create or activate a relationship path." });
  if (map.bestStrength !== null && map.bestStrength < 50) gaps.push({ type: "weak_path_only", severity: "medium", suggestedAction: "Strengthen the best path." });
  if (map.bestConfidence !== null && map.bestConfidence < 50) gaps.push({ type: "low_confidence_path", severity: "medium", suggestedAction: "Verify the path source." });
  if (map.targetContact && !["decision_maker", "executive_sponsor", "economic_buyer", "vendor_manager", "construction_manager", "project_manager"].includes(String(map.targetContact.contact_role ?? ""))) gaps.push({ type: "no_decision_maker", severity: "medium", suggestedAction: "Find a stronger authority contact." });
  if (map.mapType === "billing_access" && map.targetContact && !["ap_contact", "billing_contact", "contract_manager", "economic_buyer"].includes(String(map.targetContact.contact_role ?? ""))) gaps.push({ type: "no_ap_contact_for_billing_map", severity: "medium", suggestedAction: "Attach a billing or AP contact." });
  if (map.mapType === "field_access" && map.targetContact && !["field_supervisor", "field_inspector", "qc_contact", "project_manager"].includes(String(map.targetContact.contact_role ?? ""))) gaps.push({ type: "no_field_validator_for_field_map", severity: "medium", suggestedAction: "Attach a field validator." });
  if (map.mapType === "opportunity_access" && !map.candidate && !map.opportunity) gaps.push({ type: "no_related_candidate_or_opportunity", severity: "medium", suggestedAction: "Link a candidate or opportunity." });
  return gaps;
}

function recommendedNextAction(map: MapView) {
  if (map.status === "archived") return "view_only";
  if (!map.target_organization_id) return "attach_target_organization";
  if (!map.target_contact_id) return "identify_target_contact";
  if (!map.paths.length) return "create_path";
  if ((map.bestConfidence ?? 0) < 50) return "verify_path";
  if ((map.bestStrength ?? 0) < 50) return "strengthen_path";
  if (["no_path", "weak_path"].includes(String(map.status)) && map.paths.length) return "update_status_to_identified_path";
  if (map.status === "identified_path") return "request_introduction";
  if (map.status === "introduction_requested") return "follow_up_introduction";
  if (map.status === "conversation_opened") return "mark_relationship_active";
  if (map.status === "relationship_active" && (map.bestStrength ?? 0) >= 80) return "consider_strategic_access";
  return "maintain_relationship";
}

function mapMatchesFilters(map: MapView, filters: Filters) {
  const haystack = [map.name, map.status, map.targetOrganization?.name, map.targetContact ? contactName(map.targetContact) : "", map.mapType].join(" ").toLowerCase();
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.status && map.status !== filters.status) return false;
  if (filters.mapType && map.mapType !== filters.mapType) return false;
  if (filters.targetOrganizationId && map.target_organization_id !== filters.targetOrganizationId) return false;
  if (filters.targetContactId && map.target_contact_id !== filters.targetContactId) return false;
  if (filters.minStrength && (map.bestStrength ?? 0) < Number(filters.minStrength)) return false;
  if (filters.minConfidence && (map.bestConfidence ?? 0) < Number(filters.minConfidence)) return false;
  if (filters.minAccess && map.accessScore < Number(filters.minAccess)) return false;
  if (filters.hasTargetContact === "true" && !map.target_contact_id) return false;
  if (filters.hasTargetContact === "false" && map.target_contact_id) return false;
  if (filters.hasActivePath === "true" && !map.activePaths.length) return false;
  if (filters.hasActivePath === "false" && map.activePaths.length) return false;
  if (filters.archived === "true" && map.status !== "archived") return false;
  if (filters.archived === "false" && map.status === "archived") return false;
  return true;
}

function sortMaps(maps: MapView[], sort: string) {
  return [...maps].sort((a, b) => {
    if (sort === "access_desc" || sort === "default") return b.accessScore - a.accessScore || dateNumber(b.updated_at) - dateNumber(a.updated_at);
    if (sort === "strength_desc") return (b.bestStrength ?? -1) - (a.bestStrength ?? -1);
    if (sort === "confidence_desc") return (b.bestConfidence ?? -1) - (a.bestConfidence ?? -1);
    if (sort === "status") return String(a.status).localeCompare(String(b.status));
    if (sort === "target_organization") return textValue(a.targetOrganization?.name, "").localeCompare(textValue(b.targetOrganization?.name, ""));
    return dateNumber(b.updated_at) - dateNumber(a.updated_at);
  });
}

function buildSummary(maps: MapView[]) {
  return {
    total: maps.length,
    noPath: maps.filter((map) => map.status === "no_path").length,
    weakPath: maps.filter((map) => map.status === "weak_path").length,
    identifiedPath: maps.filter((map) => map.status === "identified_path").length,
    introductionRequested: maps.filter((map) => map.status === "introduction_requested").length,
    conversationOpened: maps.filter((map) => map.status === "conversation_opened").length,
    activeRelationships: maps.filter((map) => map.status === "relationship_active").length,
    strategicAccess: maps.filter((map) => map.status === "strategic_access").length,
    dormant: maps.filter((map) => map.status === "dormant").length,
    archived: maps.filter((map) => map.status === "archived").length,
    constraints: 0,
  };
}

async function rankPath(path: SyncRecord, rank: number, onSaved: () => Promise<void>) {
  await syncosFetch(`/relationship-paths/${path.id}/rank`, { method: "POST", body: { rank } });
  await onSaved();
}

async function archivePath(path: SyncRecord, onSaved: () => Promise<void>) {
  const reason = window.prompt("Archive reason", "no_longer_valid");
  if (!reason) return;
  await syncosFetch(`/relationship-paths/${path.id}/archive`, { method: "POST", body: { archive_reason: reason } });
  await onSaved();
}

function relatedConstraints(map: MapView, data: RelationshipData) {
  return data.constraints.filter((constraint) =>
    (constraint.affected_object_type === "relationship_map" && constraint.affected_object_id === map.id) ||
    (constraint.related_object_type === "relationship_map" && constraint.related_object_id === map.id),
  );
}

function relatedRecommendations(map: MapView, data: RelationshipData) {
  return data.recommendations.filter((recommendation) =>
    (recommendation.related_object_type === "relationship_map" && recommendation.related_object_id === map.id) ||
    (recommendation.constraint_id && relatedConstraints(map, data).some((constraint) => constraint.id === recommendation.constraint_id)),
  );
}

function GapList({ gaps, permissions }: { gaps: RelationshipGap[]; permissions: string[] }) {
  if (!gaps.length) return <div className="empty-state">No deterministic relationship gaps are visible from the current backend data.</div>;
  return (
    <div className="workspace-panel">
      {gaps.map((gap) => (
        <div className="summary-card" key={gap.type}>
          <strong>{formatAction(gap.type)}</strong>
          <span>{formatAction(gap.severity)} severity</span>
          <p>{gap.suggestedAction}</p>
          {hasPermission(permissions, "constraint.create") ? <button type="button" disabled>Create Constraint</button> : null}
        </div>
      ))}
    </div>
  );
}

function UnsupportedNotice() {
  return (
    <div className="empty-state">
      Relationship Mapping uses the hardened backend contract for persisted map fields, backend access scores, relationship gaps, timeline, and audit. Workflow task linkage appears only when existing workflow records safely reference a relationship map.
    </div>
  );
}

function ObjectSlice({ title, rows, columns, empty, action }: { title: string; rows: SyncRecord[]; columns: string[]; empty: string; action?: React.ReactNode }) {
  return (
    <div className="workspace-panel">
      <div className="section-toolbar">
        <h2>{title}</h2>
        {action}
      </div>
      {!rows.length ? <div className="empty-state">{empty}</div> : (
        <div className="wide-table">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{formatAction(column)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  {columns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-panel compact-modal">
        <div className="section-toolbar">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SessionPanel({ session }: { session: ReturnType<typeof useSession> }) {
  return (
    <section className="workspace-panel">
      <div className="section-toolbar">
        <div>
          <h2>Session</h2>
          <p className="muted">Paste a JWT and comma-separated permissions to test permission-aware relationship actions.</p>
        </div>
        <button type="button" onClick={() => session.applyDefaults()}>Use relationship defaults</button>
      </div>
      <div className="session-grid">
        <input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Bearer token" />
        <input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((permission) => permission.trim()).filter(Boolean))} placeholder="Permissions" />
      </div>
    </section>
  );
}

function SummaryCard({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return <button type="button" className="summary-card" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="summary-card"><span>{label}</span><strong>{value}</strong></div>;
}

function Checklist({ items }: { items: [string, boolean][] }) {
  return (
    <div className="workspace-panel">
      <h3>Missing relationship intelligence</h3>
      {items.length ? items.map(([label, complete]) => <div key={label} className="section-toolbar"><span>{formatAction(label)}</span><span className="badge">{complete ? "Complete" : "Missing"}</span></div>) : <div className="empty-state">No missing relationship checklist items.</div>}
    </div>
  );
}

function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label>{label}<SelectInline value={value} options={options} labels={labels} onChange={onChange} /></label>;
}

function SelectInline({ value, options, labels = {}, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option value={option} key={option}>{option ? labels[option] ?? formatAction(option) : "Any"}</option>)}
    </select>
  );
}

function useSession() {
  const [token, setTokenState] = useState(readToken());
  const [permissions, setPermissionsState] = useState<string[]>(unique([...defaultRelationshipPermissions, ...readPermissions()]));
  function setToken(next: string) {
    setTokenState(next);
    saveToken(next);
  }
  function setPermissions(next: string[]) {
    setPermissionsState(next);
    savePermissions(next);
  }
  function applyDefaults() {
    setPermissions(defaultRelationshipPermissions);
  }
  return { token, setToken, permissions, setPermissions, applyDefaults };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function labelMap(rows: SyncRecord[], field: string) {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[field], String(row.id))]));
}

function contactLabels(rows: SyncRecord[]) {
  return Object.fromEntries(rows.map((row) => [String(row.id), contactName(row)]));
}

function contactName(contact?: SyncRecord) {
  if (!contact) return "";
  return textValue(contact.full_name ?? contact.name ?? [contact.first_name, contact.last_name].filter(Boolean).join(" "), "Unnamed contact");
}

function contactLink(contactId: unknown, contacts: SyncRecord[]) {
  const contact = contacts.find((row) => row.id === contactId);
  return contact ? <Link href={`/intelligence/contacts/${contact.id}`}>{contactName(contact)}</Link> : "Not captured yet";
}

function pathName(path: SyncRecord, data: RelationshipData) {
  if (path.path_name) return textValue(path.path_name);
  const from = contactName(data.contacts.find((contact) => contact.id === path.from_contact_id)) || "Unknown source";
  const to = contactName(data.contacts.find((contact) => contact.id === path.to_contact_id)) || "Unknown target";
  return `${from} to ${to}`;
}

function pathSummary(path: SyncRecord) {
  if (path.path_summary) return textValue(path.path_summary);
  const rows = Array.isArray(path.path) ? path.path as SyncRecord[] : [];
  return textValue(rows[0]?.summary, "Not captured yet");
}

function pathRecommendedAction(path: SyncRecord) {
  if (path.recommended_action) return formatAction(path.recommended_action);
  if (path.status === "archived") return "View only";
  if ((nullableNumber(path.confidence_score) ?? 0) < 50) return "Verify path";
  if ((nullableNumber(path.strength_score) ?? 0) < 50) return "Strengthen path";
  if (path.status === "proposed") return "Rank and activate if useful";
  return "Maintain relationship";
}

function mapTypeGuidance(mapType: string) {
  const guidance: Record<string, string> = {
    organization_access: "Target organization, decision-maker, general access path, and relationship owner.",
    opportunity_access: "Related candidate or opportunity, target decision-maker, pursuit access, and relationship access score.",
    customer_access: "Customer decision-maker, executive sponsor, project/billing contacts, and payment contacts.",
    prime_access: "Prime regional PM, subcontractor manager, vendor onboarding contact, and relationship bridge.",
    engineering_access: "Design PM, OSP engineer, engineering influencer, and customer connected to engineering work.",
    capacity_access: "Subcontractor owner, foreman, operations contact, and compliance/admin contact.",
    billing_access: "AP contact, billing reviewer, contract manager, settlement approver, and escalation path.",
    field_access: "Field supervisor, inspector, QC contact, project manager, and escalation contact.",
    executive_access: "Executive sponsor, strategic decision-maker, high-influence bridge, and owner relationship.",
  };
  return guidance[mapType] ?? guidance.organization_access;
}

function scoreBand(score: number | null, type: "strength") {
  if (score === null) return "Not captured yet";
  if (score < 25) return `${score} None`;
  if (score < 50) return `${score} Weak`;
  if (score < 75) return `${score} Useful`;
  return `${score} Strong`;
}

function confidenceBand(score: number | null) {
  if (score === null) return "Not captured yet";
  if (score < 40) return `${score} Low`;
  if (score < 70) return `${score} Moderate`;
  if (score < 90) return `${score} Strong`;
  return `${score} Verified`;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function hasContactMethod(contact: SyncRecord) {
  return Boolean(contact.email || contact.phone || contact.mobile || contact.linkedin_url);
}

function displayValue(value: unknown) {
  if (Array.isArray(value)) return value.map(formatAction).join(", ") || "Not captured yet";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (String(value ?? "").includes("T") && String(value ?? "").includes("-")) return dateValue(value);
  return textValue(value);
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function formatAction(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not captured yet";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function prune(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "" && value !== undefined && value !== null));
}

function dateNumber(value: unknown) {
  const date = new Date(String(value ?? 0)).getTime();
  return Number.isFinite(date) ? date : 0;
}

const emptyData: RelationshipData = {
  maps: [],
  pathsByMap: {},
  organizations: [],
  contacts: [],
  candidates: [],
  opportunities: [],
  constraints: [],
  recommendations: [],
  workflowTasks: [],
  timelineByMap: {},
  auditByMap: {},
  unavailable: [],
};
