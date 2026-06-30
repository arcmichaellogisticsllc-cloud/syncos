"use client";

import Link from "next/link";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  dateValue,
  defaultOrganizationPermissions,
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

const organizationTypes = ["utility", "isp_carrier", "broadband_office", "municipality", "engineering_firm", "prime_contractor", "general_contractor_program_manager", "subcontractor", "vendor", "equipment_provider", "staffing_partner", "customer", "internal_company"];
const organizationStatuses = ["discovered", "researched", "qualified", "relationship_opened", "active", "strategic", "dormant", "archived"];
const actorRoles = ["work_creator", "work_influencer", "work_distributor", "capacity_provider", "work_validator", "cash_controller", "vendor_enabler", "regulatory_public_actor"];
const archiveReasons = ["duplicate", "inactive", "not_relevant", "bad_data", "merged", "out_of_territory", "no_longer_target", "other"];
const providerTypes = ["subcontractor", "crew_provider", "equipment_provider", "staffing_partner", "vendor"];
const workTypes = ["fiber", "coax", "aerial", "underground", "directional_bore", "trenching", "splicing", "drops", "make_ready", "inspection", "restoration", "project_management", "unknown"];

type WorkspaceData = {
  organizations: SyncRecord[];
  territories: SyncRecord[];
  contacts: SyncRecord[];
  signals: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  capacityProviders: SyncRecord[];
  projects: SyncRecord[];
  settlements: SyncRecord[];
  invoices: SyncRecord[];
  payments: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  learningScores: SyncRecord[];
  events: SyncRecord[];
  audit: SyncRecord[];
  unavailable: Record<string, string>;
};

type OrgFilters = {
  q: string;
  type: string;
  actorRole: string;
  territoryId: string;
  status: string;
  strategic: string;
  trustMin: string;
  hasContacts: string;
  hasSignals: string;
  hasOpportunities: string;
  archived: string;
  sort: string;
};

const initialFilters: OrgFilters = {
  q: "",
  type: "",
  actorRole: "",
  territoryId: "",
  status: "",
  strategic: "",
  trustMin: "",
  hasContacts: "",
  hasSignals: "",
  hasOpportunities: "",
  archived: "false",
  sort: "default",
};

export function OrganizationList() {
  const session = useWorkspaceSession();
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [filters, setFilters] = useState<OrgFilters>(initialFilters);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await loadWorkspaceData());
      await session.refreshPermissions();
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const enriched = data.organizations.map((organization) => enrichOrganization(organization, data));
    return sortOrganizations(
      enriched.filter((organization) => organizationMatchesFilters(organization, filters)),
      filters.sort,
    );
  }, [data, filters]);

  const summary = useMemo(() => {
    const enriched = data.organizations.map((organization) => enrichOrganization(organization, data));
    return {
      total: enriched.length,
      strategic: enriched.filter((organization) => isStrategic(organization)).length,
      workCreators: enriched.filter((organization) => hasActorRole(organization, "work_creator")).length,
      workInfluencers: enriched.filter((organization) => hasActorRole(organization, "work_influencer")).length,
      workDistributors: enriched.filter((organization) => hasActorRole(organization, "work_distributor")).length,
      capacityProviders: enriched.filter((organization) => hasActorRole(organization, "capacity_provider") || organization.capacityProviderCount > 0).length,
      workValidators: enriched.filter((organization) => hasActorRole(organization, "work_validator")).length,
      cashControllers: enriched.filter((organization) => hasActorRole(organization, "cash_controller")).length,
      missingContacts: enriched.filter((organization) => organization.contactsCount === 0).length,
      missingOwner: enriched.filter((organization) => !organization.relationship_owner_user_id).length,
      archived: enriched.filter((organization) => organization.status === "archived").length,
    };
  }, [data]);

  return (
    <IntelligenceShell title="Organizations" purpose="Open telecom actor dossiers and connect organizations to signals, contacts, candidates, capacity, production, and cash.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="summary-grid">
        <SummaryCard label="Total Organizations" value={summary.total} onClick={() => setFilters(initialFilters)} />
        <SummaryCard label="Strategic Organizations" value={summary.strategic} onClick={() => setFilters({ ...initialFilters, strategic: "true" })} />
        <SummaryCard label="Work Creators" value={summary.workCreators} onClick={() => setFilters({ ...initialFilters, actorRole: "work_creator" })} />
        <SummaryCard label="Work Influencers" value={summary.workInfluencers} onClick={() => setFilters({ ...initialFilters, actorRole: "work_influencer" })} />
        <SummaryCard label="Work Distributors" value={summary.workDistributors} onClick={() => setFilters({ ...initialFilters, actorRole: "work_distributor" })} />
        <SummaryCard label="Capacity Providers" value={summary.capacityProviders} onClick={() => setFilters({ ...initialFilters, actorRole: "capacity_provider" })} />
        <SummaryCard label="Work Validators" value={summary.workValidators} onClick={() => setFilters({ ...initialFilters, actorRole: "work_validator" })} />
        <SummaryCard label="Cash Controllers" value={summary.cashControllers} onClick={() => setFilters({ ...initialFilters, actorRole: "cash_controller" })} />
        <SummaryCard label="Missing Contacts" value={summary.missingContacts} onClick={() => setFilters({ ...initialFilters, hasContacts: "false" })} />
        <SummaryCard label="Missing Owner" value={summary.missingOwner} disabled />
        <SummaryCard label="Archived" value={summary.archived} onClick={() => setFilters({ ...initialFilters, archived: "true" })} />
      </div>

      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Filters</h2>
            <p className="muted">Organization relationship counts use tenant-scoped APIs. Some filters are client-side over currently loaded rows because the backend does not expose every organization filter yet.</p>
          </div>
          <Link className="primary-button link-button" href="/intelligence/organizations/new" aria-disabled={!hasPermission(session.permissions, "organization.create")}>
            Create Organization
          </Link>
        </div>
        <div className="quick-filter-row">
          {[
            ["Strategic", { strategic: "true" }],
            ["Work Creators", { actorRole: "work_creator" }],
            ["Work Influencers", { actorRole: "work_influencer" }],
            ["Work Distributors", { actorRole: "work_distributor" }],
            ["Capacity Providers", { actorRole: "capacity_provider" }],
            ["Cash Controllers", { actorRole: "cash_controller" }],
            ["Missing Contacts", { hasContacts: "false" }],
            ["Needs Research", { status: "discovered" }],
            ["Active Opportunities", { hasOpportunities: "true" }],
          ].map(([label, next]) => (
            <button key={String(label)} type="button" onClick={() => setFilters({ ...initialFilters, ...(next as Partial<OrgFilters>) })}>
              {String(label)}
            </button>
          ))}
        </div>
        <div className="filter-grid">
          <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search organizations" />
          <Select label="Organization type" value={filters.type} options={["", ...organizationTypes]} onChange={(type) => setFilters({ ...filters, type })} />
          <Select label="Actor role" value={filters.actorRole} options={["", ...actorRoles]} onChange={(actorRole) => setFilters({ ...filters, actorRole })} />
          <Select label="Territory" value={filters.territoryId} options={["", ...data.territories.map((territory) => String(territory.id))]} labels={territoryLabels(data.territories)} onChange={(territoryId) => setFilters({ ...filters, territoryId })} />
          <Select label="Status" value={filters.status} options={["", ...organizationStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
          <Select label="Strategic" value={filters.strategic} options={["", "true", "false"]} onChange={(strategic) => setFilters({ ...filters, strategic })} />
          <input value={filters.trustMin} onChange={(event) => setFilters({ ...filters, trustMin: event.target.value })} placeholder="Min trust score" type="number" min="0" max="100" />
          <Select label="Contacts" value={filters.hasContacts} options={["", "true", "false"]} onChange={(hasContacts) => setFilters({ ...filters, hasContacts })} />
          <Select label="Signals" value={filters.hasSignals} options={["", "true", "false"]} onChange={(hasSignals) => setFilters({ ...filters, hasSignals })} />
          <Select label="Opportunities" value={filters.hasOpportunities} options={["", "true", "false"]} onChange={(hasOpportunities) => setFilters({ ...filters, hasOpportunities })} />
          <Select label="Archived" value={filters.archived} options={["", "true", "false"]} onChange={(archived) => setFilters({ ...filters, archived })} />
          <Select label="Sort" value={filters.sort} options={["default", "name_asc", "updated_desc", "influence_desc", "work_desc", "capacity_desc", "payment_desc", "strategic_first"]} onChange={(sort) => setFilters({ ...filters, sort })} />
          <button type="button" onClick={() => setFilters(initialFilters)}>
            Clear filters
          </button>
        </div>
      </section>

      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <h2>Organization Actors</h2>
          <span className="badge">{rows.length} shown</span>
        </div>
        {loading ? <div className="empty-state">Loading organizations...</div> : null}
        {!loading && rows.length === 0 ? (
          <div className="empty-state">
            <p>No organizations yet. Add utilities, primes, engineering firms, subcontractors, customers, or vendors to begin building telecom intelligence.</p>
            <Link className="primary-button link-button" href="/intelligence/organizations/new">
              Create Organization
            </Link>
          </div>
        ) : null}
        {rows.length > 0 ? <OrganizationTable rows={rows} permissions={session.permissions} /> : null}
      </section>
    </IntelligenceShell>
  );
}

export function OrganizationForm({ organizationId, mode }: { organizationId?: string; mode: "create" | "edit" }) {
  const session = useWorkspaceSession();
  const [territories, setTerritories] = useState<SyncRecord[]>([]);
  const [organization, setOrganization] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({
    name: "",
    legal_name: "",
    organization_type: "utility",
    actor_roles: [],
    territory_id: "",
    status: "discovered",
    relationship_owner_user_id: "",
    trust_level: "unverified",
    strategic_flag: false,
    website: "",
    main_phone: "",
    main_email: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "US",
    description: "",
    influence_score: "",
    work_relevance_score: "",
    capacity_relevance_score: "",
    payment_relevance_score: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function load() {
    setError("");
    try {
      const [territoryRows, effective] = await Promise.all([
        syncosFetch<SyncRecord[]>("/territories").catch(() => []),
        syncosFetch<{ permissions?: string[] }>("/auth/me/permissions").catch(() => null),
      ]);
      setTerritories(territoryRows);
      if (effective?.permissions?.length) session.setPermissions(effective.permissions);
      if (organizationId) {
        const existing = await syncosFetch<SyncRecord>(`/organizations/${organizationId}`);
        setOrganization(existing);
        setForm({
          name: existing.name ?? "",
          legal_name: existing.legal_name ?? "",
          organization_type: existing.organization_type ?? existing.type ?? "",
          actor_roles: Array.isArray(existing.actor_roles) ? existing.actor_roles : [],
          territory_id: existing.territory_id ?? "",
          status: existing.status ?? "discovered",
          relationship_owner_user_id: existing.relationship_owner_user_id ?? "",
          trust_level: existing.trust_level ?? "unverified",
          strategic_flag: Boolean(existing.strategic_flag),
          website: existing.website ?? "",
          main_phone: existing.main_phone ?? "",
          main_email: existing.main_email ?? "",
          address_line_1: existing.address_line_1 ?? "",
          address_line_2: existing.address_line_2 ?? "",
          city: existing.city ?? "",
          state: existing.state ?? "",
          postal_code: existing.postal_code ?? "",
          country: existing.country ?? "US",
          description: existing.description ?? "",
          influence_score: existing.influence_score ?? "",
          work_relevance_score: existing.work_relevance_score ?? "",
          capacity_relevance_score: existing.capacity_relevance_score ?? "",
          payment_relevance_score: existing.payment_relevance_score ?? "",
        });
      }
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (!String(form.name ?? "").trim()) throw new Error("Organization name is required.");
      if (!form.organization_type) throw new Error("Organization type is required.");
      if (!form.territory_id) throw new Error("Territory is required.");
      const body = cleanPayload({
        ...form,
        influence_score: form.influence_score === "" ? undefined : Number(form.influence_score),
        work_relevance_score: form.work_relevance_score === "" ? undefined : Number(form.work_relevance_score),
        capacity_relevance_score: form.capacity_relevance_score === "" ? undefined : Number(form.capacity_relevance_score),
        payment_relevance_score: form.payment_relevance_score === "" ? undefined : Number(form.payment_relevance_score),
      });
      const saved = mode === "create" ? await syncosFetch<SyncRecord>("/organizations", { method: "POST", body }) : await syncosFetch<SyncRecord>(`/organizations/${organizationId}`, { method: "PATCH", body });
      window.location.href = `/intelligence/organizations/${saved.id ?? organizationId}`;
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const canSave = hasPermission(session.permissions, mode === "create" ? "organization.create" : "organization.update");

  return (
    <IntelligenceShell title={mode === "create" ? "Create Organization" : "Edit Organization"} purpose="Create a durable telecom actor record using the existing organization API.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <section className="panel workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>{mode === "create" ? "New Telecom Actor" : textValue(organization?.name, "Organization")}</h2>
            <p className="muted">Organization type, actor roles, owner, trust, strategic status, and scores are persisted through the hardened Organization API.</p>
          </div>
          {organizationId ? <Link className="table-link" href={`/intelligence/organizations/${organizationId}`}>Back to profile</Link> : <Link className="table-link" href="/intelligence/organizations">Back to organizations</Link>}
        </div>
        <form className="workspace-panel" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Organization name
              <input value={String(form.name ?? "")} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
            <label>
              Organization type
              <select value={String(form.organization_type ?? "")} onChange={(event) => setForm({ ...form, organization_type: event.target.value })} required>
                <option value="">Select type</option>
                {organizationTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label>
              Legal name
              <input value={String(form.legal_name ?? "")} onChange={(event) => setForm({ ...form, legal_name: event.target.value })} />
            </label>
            <label>
              Territory
              <select value={String(form.territory_id ?? "")} onChange={(event) => setForm({ ...form, territory_id: event.target.value })} required>
                <option value="">Select territory</option>
                {territories.map((territory) => <option key={String(territory.id)} value={String(territory.id)}>{textValue(territory.name)}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={String(form.status ?? "")} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {organizationStatuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label>
              Website
              <input value={String(form.website ?? "")} onChange={(event) => setForm({ ...form, website: event.target.value })} />
            </label>
            <label>
              Main email
              <input value={String(form.main_email ?? "")} onChange={(event) => setForm({ ...form, main_email: event.target.value })} />
            </label>
            <label>
              Main phone
              <input value={String(form.main_phone ?? "")} onChange={(event) => setForm({ ...form, main_phone: event.target.value })} />
            </label>
            <label>
              Trust level
              <select value={String(form.trust_level ?? "")} onChange={(event) => setForm({ ...form, trust_level: event.target.value })}>
                {["unverified", "low", "medium", "high", "verified"].map((level) => <option key={level}>{level}</option>)}
              </select>
            </label>
            <label>
              Influence score
              <input value={String(form.influence_score ?? "")} onChange={(event) => setForm({ ...form, influence_score: event.target.value })} type="number" min="0" max="100" />
            </label>
            <label>
              Work relevance score
              <input value={String(form.work_relevance_score ?? "")} onChange={(event) => setForm({ ...form, work_relevance_score: event.target.value })} type="number" min="0" max="100" />
            </label>
            <label>
              Capacity relevance score
              <input value={String(form.capacity_relevance_score ?? "")} onChange={(event) => setForm({ ...form, capacity_relevance_score: event.target.value })} type="number" min="0" max="100" />
            </label>
            <label>
              Payment relevance score
              <input value={String(form.payment_relevance_score ?? "")} onChange={(event) => setForm({ ...form, payment_relevance_score: event.target.value })} type="number" min="0" max="100" />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={Boolean(form.strategic_flag)} onChange={(event) => setForm({ ...form, strategic_flag: event.target.checked })} />
            Strategic organization
          </label>
          <label>
            Description
            <textarea value={String(form.description ?? "")} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <div>
            <div className="label">Actor roles</div>
            <div className="badge-row">
              {actorRoles.map((role) => {
                const selected = asArray(form.actor_roles).includes(role);
                return (
                  <label className="checkbox-row" key={role}>
                    <input type="checkbox" checked={selected} onChange={() => setForm({ ...form, actor_roles: toggleArrayValue(asArray(form.actor_roles), role) })} />
                    {formatAction(role)}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!canSave || saving}>
              {saving ? "Saving..." : "Save Organization"}
            </button>
            <Link className="link-button" href={organizationId ? `/intelligence/organizations/${organizationId}` : "/intelligence/organizations"}>Cancel</Link>
          </div>
        </form>
      </section>
    </IntelligenceShell>
  );
}

export function OrganizationProfile({ organizationId }: { organizationId: string }) {
  const session = useWorkspaceSession();
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [organization, setOrganization] = useState<SyncRecord | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [modal, setModal] = useState<"" | "contact" | "signal" | "candidate" | "capacity" | "archive" | "research">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [detail, nextData, effective] = await Promise.all([
        syncosFetch<SyncRecord>(`/organizations/${organizationId}/detail`),
        loadWorkspaceData(),
        syncosFetch<{ permissions?: string[] }>("/auth/me/permissions").catch(() => null),
      ]);
      const detailOrganization = (detail.organization ?? detail) as SyncRecord;
      setOrganization(detailOrganization);
      const [timeline, audit] = await Promise.all([
        syncosFetch<SyncRecord[]>(`/organizations/${organizationId}/timeline`).catch(() => recordArray(detail.events)),
        syncosFetch<SyncRecord[]>(`/organizations/${organizationId}/audit-summary`).catch(() => []),
      ]);
      setData({
        ...nextData,
        contacts: attachOrganizationId(recordArray(detail.contacts), organizationId, "full_name", "name"),
        signals: attachOrganizationId(recordArray(detail.signals), organizationId),
        candidates: attachOrganizationId(recordArray(detail.candidates), organizationId),
        opportunities: attachOrganizationId(recordArray(detail.opportunities), organizationId),
        capacityProviders: attachOrganizationId(recordArray((detail.capacity as SyncRecord | undefined)?.providers), organizationId),
        constraints: attachOrganizationId(recordArray(detail.constraints), organizationId),
        recommendations: attachOrganizationId(recordArray(detail.recommendations), organizationId),
        learningScores: attachOrganizationId(recordArray(detail.learning), organizationId, "object_type", "organization"),
        events: timeline,
        audit,
      });
      if (effective?.permissions?.length) session.setPermissions(effective.permissions);
    } catch (nextError) {
      setError((nextError as Error).message || "Organization not found or you do not have access.");
    } finally {
      setLoading(false);
    }
  }

  const dossier = useMemo(() => (organization ? enrichOrganization(organization, data) : null), [organization, data]);
  const slices = useMemo(() => (dossier ? organizationSlices(dossier, data) : emptySlices), [dossier, data]);

  if (loading) {
    return (
      <IntelligenceShell title="Organization Profile" purpose="Loading telecom actor dossier.">
        <div className="empty-state">Loading organization...</div>
      </IntelligenceShell>
    );
  }

  if (!dossier) {
    return (
      <IntelligenceShell title="Organization Profile" purpose="Open a tenant-scoped telecom actor dossier.">
        <div className="error-banner">{error || "Organization not found or you do not have access."}</div>
      </IntelligenceShell>
    );
  }

  const tabs = profileTabs(dossier, slices);

  return (
    <IntelligenceShell title="Organization Profile" purpose="Understand this telecom actor, its role, related work, constraints, recommendations, and next action.">
      <SessionPanel session={session} />
      {error ? <div className="error-banner">{error}</div> : null}
      <section className="panel workspace-panel">
        <div className="organization-header">
          <div>
            <h2>{textValue(dossier.name)}</h2>
            <div className="badge-row">
              <span className="badge">{textValue(dossier.type)}</span>
              <span className="badge">{textValue(dossier.status)}</span>
              {dossier.roles.map((role) => <span className="badge" key={role}>{role}</span>)}
              {isStrategic(dossier) ? <span className="badge">Strategic</span> : null}
            </div>
            <div className="header-facts">
              <span>Legal name: {textValue(dossier.legal_name)}</span>
              <span>Territory: {textValue(dossier.territoryName)}</span>
              <span>Relationship owner: {textValue(dossier.relationship_owner_name)}</span>
              <span>Trust: {scoreText(dossier.trust_level)}</span>
              <span>Last updated: {dateValue(dossier.updated_at)}</span>
            </div>
          </div>
          <div className="action-bar">
            <Link className="primary-button link-button" href={`/intelligence/organizations/${organizationId}/edit`} aria-disabled={!hasPermission(session.permissions, "organization.update")}>Edit Organization</Link>
            <button type="button" disabled={!hasPermission(session.permissions, "organization.qualify")} onClick={() => void qualifyOrganization(organizationId, load, setError)}>Qualify</button>
            <button type="button" disabled={!hasPermission(session.permissions, "contact.create")} onClick={() => setModal("contact")}>Add Contact</button>
            <button type="button" disabled={!hasPermission(session.permissions, "signal.create")} onClick={() => setModal("signal")}>Create Signal</button>
            <button type="button" disabled={!hasPermission(session.permissions, "opportunity_candidate.create")} onClick={() => setModal("candidate")}>Create Candidate</button>
            {hasActorRole(dossier, "capacity_provider") ? <button type="button" disabled={!hasPermission(session.permissions, "capacity_provider.create")} onClick={() => setModal("capacity")}>Add Capacity Provider</button> : null}
            <button type="button" onClick={() => setModal("research")}>Research Organization</button>
            <button type="button" disabled={!hasPermission(session.permissions, "organization.archive") || dossier.status === "archived"} onClick={() => setModal("archive")}>Archive</button>
          </div>
        </div>
      </section>

      <div className="organization-layout">
        <aside className="panel workspace-panel">
          <h2>Strategic Sidebar</h2>
          <dl className="detail-list">
            <dt>Primary role</dt>
            <dd>{textValue(dossier.roles[0])}</dd>
            <dt>Secondary roles</dt>
            <dd>{dossier.roles.slice(1).join(", ") || "Not captured yet"}</dd>
            <dt>Territory</dt>
            <dd>{textValue(dossier.territoryName)}</dd>
            <dt>Strategic status</dt>
            <dd>{isStrategic(dossier) ? "Strategic" : "Standard"}</dd>
            <dt>Best next action</dt>
            <dd>{formatAction(recommendedNextAction(dossier))}</dd>
          </dl>
          <h2>Missing Intelligence</h2>
          <Checklist items={missingIntelligence(dossier, slices)} />
          <h2>Key Warnings</h2>
          <div className="table-list">
            {warningsFor(dossier, slices).map((warning) => <div className="empty" key={warning}>{warning}</div>)}
          </div>
        </aside>

        <div className="workspace-main">
          <div className="summary-grid">
            <ScoreCard label="Influence Score" value={dossier.influenceScore} />
            <ScoreCard label="Work Relevance" value={dossier.workRelevanceScore} />
            <ScoreCard label="Capacity Relevance" value={dossier.capacityRelevanceScore} />
            <ScoreCard label="Payment Relevance" value={dossier.paymentRelevanceScore} />
            <SummaryMetric label="Relationship Strength" value="Not captured yet" />
            <SummaryMetric label="Signals" value={String(slices.signals.length)} />
            <SummaryMetric label="Contacts" value={String(slices.contacts.length)} />
            <SummaryMetric label="Opportunities" value={String(slices.opportunities.length)} />
            <SummaryMetric label="Open Constraints" value={String(slices.constraints.length)} />
            <SummaryMetric label="Recommended Next Action" value={formatAction(recommendedNextAction(dossier))} />
          </div>
          <div className="tab-row">
            {tabs.map((tab) => (
              <button className={activeTab === tab.id ? "active-tab" : ""} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <section className="panel workspace-panel">
            <TabPanel tab={activeTab} organization={dossier} slices={slices} data={data} permissions={session.permissions} setModal={setModal} />
          </section>
        </div>
      </div>

      {modal === "contact" ? <ContactModal organization={dossier} onClose={() => setModal("")} onSaved={load} /> : null}
      {modal === "signal" ? <SignalModal organization={dossier} territories={data.territories} onClose={() => setModal("")} onSaved={load} /> : null}
      {modal === "candidate" ? <CandidateModal organization={dossier} onClose={() => setModal("")} onSaved={load} /> : null}
      {modal === "capacity" ? <CapacityModal organization={dossier} contacts={slices.contacts} onClose={() => setModal("")} onSaved={load} /> : null}
      {modal === "archive" ? <ArchiveModal organization={dossier} onClose={() => setModal("")} onSaved={() => window.location.reload()} /> : null}
      {modal === "research" ? <ResearchModal organization={dossier} onClose={() => setModal("")} /> : null}
    </IntelligenceShell>
  );
}

function TabPanel({
  tab,
  organization,
  slices,
  data,
  permissions,
  setModal,
}: {
  tab: string;
  organization: EnrichedOrganization;
  slices: OrganizationSlices;
  data: WorkspaceData;
  permissions: string[];
  setModal: (modal: "" | "contact" | "signal" | "candidate" | "capacity" | "archive" | "research") => void;
}) {
  if (tab === "overview") {
    return (
      <>
        <div className="section-toolbar">
          <h2>30-Second Dossier</h2>
          <span className="badge">{completenessBand(completenessScore(organization, slices))} {completenessScore(organization, slices)}%</span>
        </div>
        <div className="detail-grid">
          <div>
            <h3>Actor Role Explanation</h3>
            <p>{actorRoleExplanation(organization)}</p>
            <h3>Type-Specific Guidance</h3>
            <p>{typeGuidance(organization)}</p>
            <h3>Recommended Next Action</h3>
            <p>{formatAction(recommendedNextAction(organization))}</p>
          </div>
          <div>
            <h3>Completeness</h3>
            <Checklist items={completenessChecklist(organization, slices)} />
          </div>
        </div>
        <ObjectSlice title="Primary contacts" rows={slices.contacts.slice(0, 3)} columns={["full_name", "title", "email", "phone", "status"]} empty="No contacts are connected to this organization. Add contacts to build access." />
        <ObjectSlice title="Recent signals" rows={slices.signals.slice(0, 5)} columns={["title", "category", "type", "status", "recommended_next_action"]} empty="No signals are connected to this organization yet." />
        <UnsupportedState title="Relationship status summary" message="Relationship map profile slices are deferred. Use the Relationship Maps placeholder until the backend exposes organization-centered relationship paths." />
        <button type="button" onClick={() => setModal("research")}>Research Organization</button>
      </>
    );
  }
  if (tab === "contacts") return <ContactsTab rows={slices.contacts} canCreate={hasPermission(permissions, "contact.create")} setModal={setModal} />;
  if (tab === "relationships") return <UnsupportedState title="Relationships" message="Relationship Mapping workspace is intentionally deferred. This profile only exposes a placeholder in Product Sprint 2." />;
  if (tab === "signals") return <SignalsTab rows={slices.signals} canCreate={hasPermission(permissions, "signal.create")} setModal={setModal} />;
  if (tab === "candidates") return <ObjectSlice title="Candidates" rows={slices.candidates} columns={["name", "status", "confidence_score", "estimated_value", "work_type", "owner_user_id", "evidence_summary"]} empty="No opportunity candidates are connected to this organization yet." action={<button type="button" disabled={!hasPermission(permissions, "opportunity_candidate.create")} onClick={() => setModal("candidate")}>Create Candidate</button>} />;
  if (tab === "opportunities") return <ObjectSlice title="Opportunities" rows={slices.opportunities} columns={["title", "status", "estimated_value", "pursuit_score", "capacity_fit_score", "relationship_access_score", "owner_user_id", "review_date"]} empty="No opportunities are connected to this organization yet." />;
  if (tab === "capacity") return <CapacityTab organization={organization} slices={slices} permissions={permissions} setModal={setModal} />;
  if (tab === "projects") return <ProjectsTab slices={slices} unavailable={data.unavailable.projects} />;
  if (tab === "finance") return <FinanceTab slices={slices} unavailable={data.unavailable.finance} />;
  if (tab === "constraints") return <ObjectSlice title="Constraints" rows={slices.constraints} columns={["constraint_type", "affected_object_type", "severity", "owner_id", "due_date", "status", "resolution_summary"]} empty="No active constraints are tied to this organization." />;
  if (tab === "recommendations") return <ObjectSlice title="Recommendations" rows={slices.recommendations} columns={["recommendation_type", "related_object_type", "confidence_score", "risk_level", "expected_impact", "status", "owner_id", "approval_required"]} empty="No recommendations are tied to this organization." />;
  if (tab === "learning") return <ObjectSlice title="Learning Scores" rows={slices.learningScores} columns={["score_type", "score_value", "confidence", "updated_at"]} empty="No learning scores are connected to this organization yet." />;
  if (tab === "documents") return <UnsupportedState title="Documents" message="Documents workspace coming later." />;
  if (tab === "events") return <ObjectSlice title="Events" rows={slices.events} columns={["event_type", "actor_name", "object_type", "summary", "timestamp"]} empty="No organization timeline events are visible yet." />;
  if (tab === "audit") return <ObjectSlice title="Audit" rows={slices.audit} columns={["actor_name", "action", "object_type", "before_json", "after_json", "reason", "created_at", "correlation_id"]} empty="No authorized organization audit records are visible yet." />;
  return null;
}

function OrganizationTable({ rows, permissions }: { rows: EnrichedOrganization[]; permissions: string[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            <th>Organization Name</th>
            <th>Organization Type</th>
            <th>Actor Roles</th>
            <th>Territory</th>
            <th>Status</th>
            <th>Relationship Owner</th>
            <th>Strategic</th>
            <th>Trust</th>
            <th>Influence</th>
            <th>Work</th>
            <th>Capacity</th>
            <th>Payment</th>
            <th>Contacts</th>
            <th>Signals</th>
            <th>Opportunities</th>
            <th>Recommended Next Action</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((organization) => (
            <tr key={organization.id}>
              <td><Link className="table-link" href={`/intelligence/organizations/${organization.id}`}>{textValue(organization.name)}</Link></td>
              <td>{textValue(organization.type)}</td>
              <td><BadgeList values={organization.roles} /></td>
              <td>{textValue(organization.territoryName)}</td>
              <td>{textValue(organization.status)}</td>
              <td>{textValue(organization.relationship_owner_name, "Unassigned")}</td>
              <td>{isStrategic(organization) ? "Yes" : "No"}</td>
              <td>{scoreText(organization.trust_level)}</td>
              <td>{scoreText(organization.influenceScore)}</td>
              <td>{scoreText(organization.workRelevanceScore)}</td>
              <td>{scoreText(organization.capacityRelevanceScore)}</td>
              <td>{scoreText(organization.paymentRelevanceScore)}</td>
              <td>{organization.contactsCount}</td>
              <td>{organization.signalsCount}</td>
              <td>{organization.opportunitiesCount}</td>
              <td>{formatAction(recommendedNextAction(organization))}</td>
              <td>
                <div className="row-actions">
                  <Link className="table-link" href={`/intelligence/organizations/${organization.id}`}>Open</Link>
                  {hasPermission(permissions, "organization.update") ? <Link className="table-link" href={`/intelligence/organizations/${organization.id}/edit`}>Edit</Link> : null}
                  {hasPermission(permissions, "signal.create") ? <Link className="table-link" href={`/intelligence/organizations/${organization.id}?action=create-signal`}>Create Signal</Link> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTab({ rows, canCreate, setModal }: { rows: SyncRecord[]; canCreate: boolean; setModal: (modal: "contact") => void }) {
  return (
    <ObjectSlice
      title="Contacts"
      rows={rows}
      columns={["full_name", "title", "department", "contact_role", "email", "phone", "verification_status", "influence_score", "decision_authority_score", "relationship_strength", "last_contacted_at", "owner_user_id"]}
      empty="No contacts are connected to this organization. Add contacts to build access and support relationship pathing."
      action={<button type="button" disabled={!canCreate} onClick={() => setModal("contact")}>Add Contact</button>}
    />
  );
}

function SignalsTab({ rows, canCreate, setModal }: { rows: SyncRecord[]; canCreate: boolean; setModal: (modal: "signal") => void }) {
  return (
    <ObjectSlice
      title="Signals"
      rows={rows}
      columns={["title", "category", "type", "confidence_score", "trust_level", "status", "source_name", "date_discovered", "converted", "recommended_next_action"]}
      empty="No signals are connected to this organization yet."
      action={<button type="button" disabled={!canCreate} onClick={() => setModal("signal")}>Create Signal</button>}
    />
  );
}

function CapacityTab({ organization, slices, permissions, setModal }: { organization: EnrichedOrganization; slices: OrganizationSlices; permissions: string[]; setModal: (modal: "capacity") => void }) {
  if (!hasActorRole(organization, "capacity_provider") && slices.capacityProviders.length === 0) {
    return <UnsupportedState title="Capacity" message="This organization is not currently configured as a capacity provider." />;
  }
  return (
    <>
      <ObjectSlice title="Capacity Providers" rows={slices.capacityProviders} columns={["provider_type", "status", "readiness_score", "verification_status", "primary_contact_id"]} empty="No capacity provider record is connected yet." action={<button type="button" disabled={!hasPermission(permissions, "capacity_provider.create")} onClick={() => setModal("capacity")}>Create Capacity Provider</button>} />
      <UnsupportedState title="Crews, Workers, Equipment, Compliance, Capacity Records" message="Detailed capacity sub-slices require provider-scoped filtering. Open the Capacity workspace when that product surface is approved." />
    </>
  );
}

function ProjectsTab({ slices, unavailable }: { slices: OrganizationSlices; unavailable?: string }) {
  if (unavailable) return <UnsupportedState title="Projects" message={unavailable} />;
  return (
    <>
      <ObjectSlice title="Projects" rows={slices.projects} columns={["name", "status", "customer_organization_id", "opportunity_id", "created_at"]} empty="No projects are connected to this organization yet." />
      <UnsupportedState title="Work Orders / Production" message="Work order and production slices are read-heavy in a later workspace. Organization-specific project filters are partial in the current backend." />
    </>
  );
}

function FinanceTab({ slices, unavailable }: { slices: OrganizationSlices; unavailable?: string }) {
  if (unavailable) return <UnsupportedState title="Finance" message={unavailable} />;
  return (
    <>
      <ObjectSlice title="Settlements" rows={slices.settlements} columns={["status", "gross_amount", "net_amount", "customer_organization_id", "billing_period_start", "billing_period_end"]} empty="No settlements are connected yet." />
      <ObjectSlice title="Invoices" rows={slices.invoices} columns={["invoice_number", "status", "invoice_amount", "due_date", "organization_id"]} empty="No invoices are connected yet." />
      <ObjectSlice title="Payments" rows={slices.payments} columns={["payment_reference", "status", "payment_amount", "payment_date", "invoice_id"]} empty="No payments are connected yet." />
      <UnsupportedState title="Customer Payment Intelligence" message="Customer payment stats are not exposed through an organization profile API yet." />
    </>
  );
}

function ObjectSlice({ title, rows, columns, empty, action }: { title: string; rows: SyncRecord[]; columns: string[]; empty: string; action?: ReactNode }) {
  return (
    <div className="workspace-panel">
      <div className="section-toolbar">
        <h2>{title}</h2>
        {action}
      </div>
      {rows.length === 0 ? <div className="empty-state">{empty}</div> : (
        <div className="wide-table">
          <table>
            <thead>
              <tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  {columns.map((column) => <td key={column}>{formatCell(row[column], column)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ContactModal({ organization, onClose, onSaved }: { organization: EnrichedOrganization; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ full_name: "", title: "", email: "", phone: "" });
  return (
    <Modal title="Add Contact" onClose={onClose}>
      <form className="workspace-panel" onSubmit={(event) => void submitModal(event, "/contacts", { ...form, organization_id: organization.id }, onSaved, onClose)}>
        <label>Full name<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required /></label>
        <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <button className="primary-button" type="submit">Create Contact</button>
      </form>
    </Modal>
  );
}

function SignalModal({ organization, territories, onClose, onSaved }: { organization: EnrichedOrganization; territories: SyncRecord[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ title: "", summary: "", category: "relationship", type: "relationship_note", source_name: "Manual organization note", source_type: "manual_entry", source_note: "", confidence_score: "50", trust_level: "unverified", work_type: "unknown" });
  return (
    <Modal title="Create Signal" onClose={onClose}>
      <form className="workspace-panel" onSubmit={(event) => void submitModal(event, "/signals", { ...form, organization_id: organization.id, territory_id: organization.territory_id, confidence_score: Number(form.confidence_score) }, onSaved, onClose)}>
        <div className="form-grid">
          <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
          <label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} required /></label>
          <label>Type<input value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} required /></label>
          <label>Source name<input value={form.source_name} onChange={(event) => setForm({ ...form, source_name: event.target.value })} required /></label>
          <label>Source type<input value={form.source_type} onChange={(event) => setForm({ ...form, source_type: event.target.value })} required /></label>
          <label>Confidence<input value={form.confidence_score} onChange={(event) => setForm({ ...form, confidence_score: event.target.value })} type="number" min="0" max="100" /></label>
          <label>Territory<select value={String(organization.territory_id ?? "")} disabled><option>{textValue(territories.find((territory) => territory.id === organization.territory_id)?.name, "Organization territory")}</option></select></label>
        </div>
        <label>Summary<textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} required /></label>
        <label>Source note<textarea value={form.source_note} onChange={(event) => setForm({ ...form, source_note: event.target.value })} /></label>
        <button className="primary-button" type="submit">Create Signal</button>
      </form>
    </Modal>
  );
}

function CandidateModal({ organization, onClose, onSaved }: { organization: EnrichedOrganization; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", work_type: "unknown", unknown_work_type_reason: "Organization context only", evidence_summary: "", confidence_score: "50" });
  return (
    <Modal title="Create Candidate" onClose={onClose}>
      <form className="workspace-panel" onSubmit={(event) => void submitModal(event, "/opportunity-candidates", { ...form, organization_id: organization.id, territory_id: organization.territory_id, confidence_score: Number(form.confidence_score) }, onSaved, onClose)}>
        <div className="form-grid">
          <label>Candidate name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label>Work type<select value={form.work_type} onChange={(event) => setForm({ ...form, work_type: event.target.value })}>{workTypes.map((workType) => <option key={workType}>{workType}</option>)}</select></label>
          <label>Confidence<input value={form.confidence_score} onChange={(event) => setForm({ ...form, confidence_score: event.target.value })} type="number" min="0" max="100" /></label>
        </div>
        <label>Evidence summary<textarea value={form.evidence_summary} onChange={(event) => setForm({ ...form, evidence_summary: event.target.value })} required /></label>
        <button className="primary-button" type="submit">Create Candidate</button>
      </form>
    </Modal>
  );
}

function CapacityModal({ organization, contacts, onClose, onSaved }: { organization: EnrichedOrganization; contacts: SyncRecord[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ provider_type: "subcontractor", primary_contact_id: "" });
  return (
    <Modal title="Create Capacity Provider" onClose={onClose}>
      <form className="workspace-panel" onSubmit={(event) => void submitModal(event, "/capacity-providers", cleanPayload({ ...form, organization_id: organization.id }), onSaved, onClose)}>
        <label>Provider type<select value={form.provider_type} onChange={(event) => setForm({ ...form, provider_type: event.target.value })}>{providerTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>Primary contact<select value={form.primary_contact_id} onChange={(event) => setForm({ ...form, primary_contact_id: event.target.value })}><option value="">Not assigned</option>{contacts.map((contact) => <option key={String(contact.id)} value={String(contact.id)}>{textValue(contact.full_name)}</option>)}</select></label>
        <button className="primary-button" type="submit">Create Capacity Provider</button>
      </form>
    </Modal>
  );
}

function ArchiveModal({ organization, onClose, onSaved }: { organization: EnrichedOrganization; onClose: () => void; onSaved: () => void }) {
  const [archiveReason, setArchiveReason] = useState("inactive");
  const [archiveNote, setArchiveNote] = useState("");
  return (
    <Modal title="Archive Organization" onClose={onClose}>
      <p>This uses the organization archive API and stores the archive reason on the organization record.</p>
      <label>Archive reason<select value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)}>{archiveReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
      <label>Archive note<textarea value={archiveNote} onChange={(event) => setArchiveNote(event.target.value)} /></label>
      <button className="primary-button" type="button" onClick={() => void syncosFetch(`/organizations/${organization.id}/archive`, { method: "POST", body: { archive_reason: archiveReason, archive_note: archiveNote } }).then(onSaved)}>
        Archive Organization
      </button>
    </Modal>
  );
}

function ResearchModal({ organization, onClose }: { organization: EnrichedOrganization; onClose: () => void }) {
  return (
    <Modal title="AI Research Placeholder" onClose={onClose}>
      <p>AI-assisted organization research will enrich this profile from approved sources. No automatic field updates occur without human approval.</p>
      <div className="detail-grid">
        {["Executive Summary", "Organization Identity", "Actor Role Assessment", "Territories", "Known Projects", "Known Contacts", "Known Partners", "Possible Opportunities", "Relationship Gaps", "Trust Concerns", "Recommended Next Action", "Sources", "Confidence", "Timestamp"].map((item) => (
          <div className="evidence-item" key={item}>
            <strong>{item}</strong>
            <span className="muted">{item === "Recommended Next Action" ? formatAction(recommendedNextAction(organization)) : "Manual research entry not captured yet."}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

async function submitModal(event: FormEvent, path: string, body: Record<string, unknown>, onSaved: () => Promise<void>, onClose: () => void) {
  event.preventDefault();
  await syncosFetch(path, { method: "POST", body: cleanPayload(body) });
  await onSaved();
  onClose();
}

async function qualifyOrganization(id: string, reload: () => Promise<void>, setError: (error: string) => void) {
  try {
    await syncosFetch(`/organizations/${id}/qualify`, { method: "POST", body: {} });
    await reload();
  } catch (error) {
    setError((error as Error).message || "Organization must have a type and territory before qualification.");
  }
}

function SessionPanel({ session }: { session: ReturnType<typeof useWorkspaceSession> }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return (
    <section className="panel workspace-panel">
      <div className="section-toolbar">
        <div>
          <h2>Session</h2>
          <p className="muted">The UI only calls protected backend APIs. Backend permissions remain the source of truth.</p>
        </div>
        <button type="button" onClick={session.save}>Save Session</button>
      </div>
      <div className="session-grid">
        <label>API token<input value={session.token} onChange={(event) => session.setToken(event.target.value)} placeholder="Paste JWT token" /></label>
        <label>Visible permissions<input value={session.permissions.join(",")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} /></label>
      </div>
    </section>
  );
}

function useWorkspaceSession() {
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>(defaultOrganizationPermissions);
  useEffect(() => {
    setToken(readToken());
    setPermissions(readPermissions().length ? readPermissions() : defaultOrganizationPermissions);
  }, []);
  async function refreshPermissions() {
    const effective = await syncosFetch<{ permissions?: string[] }>("/auth/me/permissions").catch(() => null);
    if (effective?.permissions?.length) {
      setPermissions(effective.permissions);
      savePermissions(effective.permissions);
    }
  }
  function save() {
    saveToken(token);
    savePermissions(permissions);
    void refreshPermissions();
  }
  return { token, setToken, permissions, setPermissions, save, refreshPermissions };
}

async function loadWorkspaceData(): Promise<WorkspaceData> {
  const unavailable: Record<string, string> = {};
  const [organizations, territories, contacts, signals, candidates, opportunities, capacityProviders, projects, settlements, invoices, payments, constraints, recommendations, learningScores] = await Promise.all([
    optionalList("/organizations", unavailable, "organizations"),
    optionalList("/territories", unavailable, "territories"),
    optionalList("/contacts", unavailable, "contacts"),
    optionalList("/signals", unavailable, "signals"),
    optionalList("/opportunity-candidates", unavailable, "candidates"),
    optionalList("/opportunities", unavailable, "opportunities"),
    optionalList("/capacity-providers", unavailable, "capacity"),
    optionalList("/projects", unavailable, "projects"),
    optionalList("/settlements", unavailable, "finance"),
    optionalList("/invoices", unavailable, "finance"),
    optionalList("/payments", unavailable, "finance"),
    optionalList("/constraints", unavailable, "constraints"),
    optionalList("/recommendations", unavailable, "recommendations"),
    optionalList("/learning-scores", unavailable, "learning"),
  ]);
  return { organizations, territories, contacts, signals, candidates, opportunities, capacityProviders, projects, settlements, invoices, payments, constraints, recommendations, learningScores, events: [], audit: [], unavailable };
}

async function optionalList(path: string, unavailable: Record<string, string>, key: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path);
  } catch (error) {
    unavailable[key] = "This section is not available yet because the backend does not expose this organization relationship or permission is missing.";
    return [];
  }
}

const emptyData: WorkspaceData = {
  organizations: [],
  territories: [],
  contacts: [],
  signals: [],
  candidates: [],
  opportunities: [],
  capacityProviders: [],
  projects: [],
  settlements: [],
  invoices: [],
  payments: [],
  constraints: [],
  recommendations: [],
  learningScores: [],
  events: [],
  audit: [],
  unavailable: {},
};

type EnrichedOrganization = SyncRecord & {
  id: string;
  roles: string[];
  territoryName: string;
  contactsCount: number;
  signalsCount: number;
  opportunitiesCount: number;
  capacityProviderCount: number;
  influenceScore: number | null;
  workRelevanceScore: number | null;
  capacityRelevanceScore: number | null;
  paymentRelevanceScore: number | null;
};

type OrganizationSlices = {
  contacts: SyncRecord[];
  signals: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  capacityProviders: SyncRecord[];
  projects: SyncRecord[];
  settlements: SyncRecord[];
  invoices: SyncRecord[];
  payments: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  learningScores: SyncRecord[];
  events: SyncRecord[];
  audit: SyncRecord[];
};

const emptySlices: OrganizationSlices = {
  contacts: [],
  signals: [],
  candidates: [],
  opportunities: [],
  capacityProviders: [],
  projects: [],
  settlements: [],
  invoices: [],
  payments: [],
  constraints: [],
  recommendations: [],
  learningScores: [],
  events: [],
  audit: [],
};

function enrichOrganization(organization: SyncRecord, data: WorkspaceData): EnrichedOrganization {
  const id = String(organization.id);
  const territory = data.territories.find((row) => row.id === organization.territory_id);
  const slices = organizationSlices({ id }, data);
  const roles = asArray(organization.actor_roles);
  return {
    ...organization,
    id,
    roles,
    territoryName: territory ? String(territory.name) : "",
    contactsCount: Number(organization.contacts_count ?? slices.contacts.length),
    signalsCount: Number(organization.signals_count ?? slices.signals.length),
    opportunitiesCount: Number(organization.opportunities_count ?? slices.opportunities.length),
    capacityProviderCount: Number(organization.capacity_provider_count ?? slices.capacityProviders.length),
    influenceScore: nullableNumber(organization.influence_score),
    workRelevanceScore: nullableNumber(organization.work_relevance_score),
    capacityRelevanceScore: nullableNumber(organization.capacity_relevance_score),
    paymentRelevanceScore: nullableNumber(organization.payment_relevance_score),
  };
}

function organizationSlices(organization: Pick<EnrichedOrganization, "id">, data: WorkspaceData): OrganizationSlices {
  const id = organization.id;
  const candidates = data.candidates.filter((row) => row.organization_id === id);
  const opportunities = data.opportunities.filter((row) => row.organization_id === id);
  const invoices = data.invoices.filter((row) => row.organization_id === id || row.customer_organization_id === id);
  return {
    contacts: data.contacts.filter((row) => row.organization_id === id),
    signals: data.signals.filter((row) => row.primary_organization_id === id || row.organization_id === id),
    candidates,
    opportunities,
    capacityProviders: data.capacityProviders.filter((row) => row.organization_id === id),
    projects: data.projects.filter((row) => row.customer_organization_id === id || row.organization_id === id || row.capacity_provider_organization_id === id),
    settlements: data.settlements.filter((row) => row.customer_organization_id === id || row.organization_id === id),
    invoices,
    payments: data.payments.filter((row) => invoices.some((invoice) => invoice.id === row.invoice_id) || row.organization_id === id || row.customer_organization_id === id),
  constraints: data.constraints.filter((row) => (row.affected_object_type === "organization" && row.affected_object_id === id) || row.related_object_id === id),
  recommendations: data.recommendations.filter((row) => (row.related_object_type === "organization" && row.related_object_id === id) || row.object_id === id),
  learningScores: data.learningScores.filter((row) => row.object_type === "organization" && row.object_id === id),
  events: data.events,
  audit: data.audit,
  };
}

function organizationMatchesFilters(organization: EnrichedOrganization, filters: OrgFilters) {
  if (filters.q && !`${organization.name ?? ""} ${organization.type ?? ""} ${organization.roles.join(" ")}`.toLowerCase().includes(filters.q.toLowerCase())) return false;
  if (filters.type && organization.type !== filters.type) return false;
  if (filters.actorRole && !hasActorRole(organization, filters.actorRole)) return false;
  if (filters.territoryId && organization.territory_id !== filters.territoryId) return false;
  if (filters.status && organization.status !== filters.status) return false;
  if (filters.strategic && String(isStrategic(organization)) !== filters.strategic) return false;
  if (filters.trustMin && numberValue(organization.trust_level, 0) < Number(filters.trustMin)) return false;
  if (filters.hasContacts && String(organization.contactsCount > 0) !== filters.hasContacts) return false;
  if (filters.hasSignals && String(organization.signalsCount > 0) !== filters.hasSignals) return false;
  if (filters.hasOpportunities && String(organization.opportunitiesCount > 0) !== filters.hasOpportunities) return false;
  if (filters.archived && String(organization.status === "archived") !== filters.archived) return false;
  return true;
}

function sortOrganizations(rows: EnrichedOrganization[], sort: string) {
  return [...rows].sort((a, b) => {
    if (sort === "name_asc") return String(a.name).localeCompare(String(b.name));
    if (sort === "updated_desc") return Date.parse(String(b.updated_at ?? 0)) - Date.parse(String(a.updated_at ?? 0));
    if (sort === "influence_desc") return numberValue(b.influenceScore, -1) - numberValue(a.influenceScore, -1);
    if (sort === "work_desc") return numberValue(b.workRelevanceScore, -1) - numberValue(a.workRelevanceScore, -1);
    if (sort === "capacity_desc") return numberValue(b.capacityRelevanceScore, -1) - numberValue(a.capacityRelevanceScore, -1);
    if (sort === "payment_desc") return numberValue(b.paymentRelevanceScore, -1) - numberValue(a.paymentRelevanceScore, -1);
    if (sort === "strategic_first" || sort === "default") {
      const strategic = Number(isStrategic(b)) - Number(isStrategic(a));
      if (strategic !== 0) return strategic;
      const influence = numberValue(b.influenceScore, -1) - numberValue(a.influenceScore, -1);
      if (influence !== 0) return influence;
      return Date.parse(String(b.updated_at ?? 0)) - Date.parse(String(a.updated_at ?? 0));
    }
    return 0;
  });
}

function profileTabs(organization: EnrichedOrganization, slices: OrganizationSlices) {
  const tabs = [
    ["overview", "Overview"],
    ["contacts", "Contacts"],
    ["relationships", "Relationships"],
    ["signals", "Signals"],
    ["candidates", "Candidates"],
    ["opportunities", "Opportunities"],
  ];
  if (hasActorRole(organization, "capacity_provider") || slices.capacityProviders.length > 0) tabs.push(["capacity", "Capacity"]);
  if (slices.projects.length > 0 || hasActorRole(organization, "work_validator")) tabs.push(["projects", "Projects"]);
  if (hasActorRole(organization, "cash_controller") || organization.type === "customer" || ["utility", "isp_carrier", "municipality", "prime_contractor"].includes(String(organization.type))) tabs.push(["finance", "Finance"]);
  return [...tabs, ["constraints", "Constraints"], ["recommendations", "Recommendations"], ["learning", "Learning"], ["documents", "Documents"], ["events", "Events"], ["audit", "Audit"]].map(([id, label]) => ({ id, label }));
}

function recommendedNextAction(organization: EnrichedOrganization) {
  if (typeof organization.recommended_next_action === "string" && organization.recommended_next_action) return organization.recommended_next_action;
  if (organization.status === "archived") return "view_only";
  if (!organization.relationship_owner_user_id) return "assign_owner";
  if (organization.roles.length === 0) return "assign_actor_role";
  if (!organization.territory_id) return "assign_territory";
  if (organization.contactsCount === 0) return "add_contact";
  if (hasActorRole(organization, "work_creator") && organization.signalsCount === 0) return "add_signal";
  if (hasActorRole(organization, "capacity_provider") && organization.capacityProviderCount === 0) return "add_capacity_provider";
  return "review_profile";
}

function formatAction(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function missingIntelligence(organization: EnrichedOrganization, slices: OrganizationSlices): Array<[string, boolean]> {
  return [
    ["Missing territory", Boolean(organization.territory_id)],
    ["Missing actor role", organization.roles.length > 0],
    ["Missing owner", Boolean(organization.relationship_owner_user_id)],
    ["Missing contacts", slices.contacts.length > 0],
    ["Missing verified contact", slices.contacts.some((contact) => contact.status === "verified" || contact.verification_status === "verified")],
    ["Missing signals for work creator", !hasActorRole(organization, "work_creator") || slices.signals.length > 0],
    ["Missing capacity profile for capacity provider", !hasActorRole(organization, "capacity_provider") || slices.capacityProviders.length > 0],
    ["Missing finance contact for cash controller", !hasActorRole(organization, "cash_controller") || slices.contacts.some((contact) => `${contact.title ?? ""} ${contact.department ?? ""}`.toLowerCase().includes("billing"))],
  ];
}

function completenessChecklist(organization: EnrichedOrganization, slices: OrganizationSlices): Array<[string, boolean]> {
  return [
    ["Identity complete", Boolean(organization.name && organization.type && organization.type !== "unknown")],
    ["Actor role assigned", organization.roles.length > 0],
    ["Territory assigned", Boolean(organization.territory_id)],
    ["Relationship owner assigned", Boolean(organization.relationship_owner_user_id)],
    ["At least one contact exists", slices.contacts.length > 0],
    ["At least one verified contact exists", slices.contacts.some((contact) => contact.status === "verified" || contact.verification_status === "verified")],
    ["Relevant work link exists", slices.signals.length + slices.candidates.length + slices.opportunities.length > 0 || !hasActorRole(organization, "work_creator")],
    ["Capacity profile exists", !hasActorRole(organization, "capacity_provider") || slices.capacityProviders.length > 0],
    ["Payment stats exist", !(hasActorRole(organization, "cash_controller") || organization.type === "customer") || slices.payments.length > 0],
  ];
}

function completenessScore(organization: EnrichedOrganization, slices: OrganizationSlices) {
  const items = completenessChecklist(organization, slices);
  return Math.round((items.filter(([, complete]) => complete).length / items.length) * 100);
}

function completenessBand(score: number) {
  if (score < 40) return "Incomplete";
  if (score < 70) return "Partial";
  if (score < 90) return "Usable";
  return "Complete";
}

function warningsFor(organization: EnrichedOrganization, slices: OrganizationSlices) {
  const warnings = [];
  if (organization.status === "archived") warnings.push("This organization is archived. Actions are limited.");
  if (!organization.territory_id) warnings.push("Territory is missing.");
  if (slices.constraints.length > 0) warnings.push("Open constraints are tied to this organization.");
  if (hasActorRole(organization, "capacity_provider") && slices.capacityProviders.length === 0) warnings.push("Capacity Provider role exists without a capacity provider record.");
  return warnings.length ? warnings : ["No critical warnings captured."];
}

function actorRoleExplanation(organization: EnrichedOrganization) {
  if (hasActorRole(organization, "work_creator")) return "This organization may originate telecom work. Emphasize signals, territory, funding or project indicators, opportunities, and access paths.";
  if (hasActorRole(organization, "work_influencer")) return "This organization can influence work before construction starts. Emphasize contacts, relationship access, signals, and relationship gaps.";
  if (hasActorRole(organization, "work_distributor")) return "This organization may route work to Jackson. Emphasize onboarding path, vendor contacts, opportunities, and capacity needs.";
  if (hasActorRole(organization, "capacity_provider")) return "This organization may help cover work. Emphasize provider status, compliance, readiness, crews, workers, equipment, and production history.";
  if (hasActorRole(organization, "work_validator")) return "This organization can validate or block production. Emphasize field contacts, QC contacts, approvals, corrections, and project history.";
  if (hasActorRole(organization, "cash_controller")) return "This organization can approve and pay correctly. Emphasize contracts, settlements, invoices, AR, payments, and billing contacts.";
  return "Actor role is not captured yet. Assign roles to make this dossier operationally meaningful.";
}

function typeGuidance(organization: EnrichedOrganization) {
  const type = String(organization.type ?? "");
  if (type === "utility") return "Utility profile: look for service territory, infrastructure relevance, known projects, engineering or prime partners, procurement path, field contacts, AP contacts, related signals, and opportunities.";
  if (type === "isp_carrier") return "ISP / Carrier profile: look for expansion markets, construction access, vendor managers, prime partners, drops, splicing, maintenance relevance, and payment process.";
  if (type === "broadband_office") return "Broadband Office profile: look for funding programs, award timelines, award recipients, eligible territories, compliance requirements, and public activity signals.";
  if (type === "municipality") return "Municipality profile: look for local work, permitting, ROW control, public broadband initiatives, public works contacts, meeting agenda signals, and procurement path.";
  if (type === "engineering_firm") return "Engineering Firm profile: look for design territories, customer relationships, project managers, design signals, permitting, survey activity, and contractor influence.";
  if (type === "prime_contractor" || type === "general_contractor_program_manager") return "Prime / Program Manager profile: determine whether they distribute work, control subcontractor onboarding, require documentation, validate field work, and drive payment behavior.";
  if (type === "subcontractor") return "Subcontractor profile: determine whether they can cover work, are compliant, available, and reliable.";
  if (type === "vendor") return "Vendor profile: determine whether they remove execution constraints through material, service, equipment, or staffing availability.";
  if (type === "equipment_provider") return "Equipment Provider profile: determine whether they remove equipment constraints, how fast equipment is accessible, and at what cost.";
  if (type === "staffing_partner") return "Staffing Partner profile: determine whether they can fill labor gaps with qualified, compliant workers.";
  if (type === "customer") return "Customer profile: focus on contracts, production approval path, settlements, invoices, AR, payments, days to pay, short pays, and disputes.";
  if (type === "internal_company") return "Internal Company profile: focus on internal crews, equipment, active projects, capacity gaps, cash status, constraints, and recommendations.";
  return "Assign an approved organization type to make this dossier operationally meaningful.";
}

function hasActorRole(organization: Pick<EnrichedOrganization, "roles">, role: string) {
  return organization.roles.includes(role);
}

function isStrategic(organization: SyncRecord) {
  return organization.status === "strategic" || Boolean(organization.strategic_flag ?? organization.strategic);
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function recordArray(value: unknown): SyncRecord[] {
  return Array.isArray(value) ? value.filter((item): item is SyncRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function attachOrganizationId(rows: SyncRecord[], organizationId: string, aliasKey?: string, sourceKey?: string) {
  return rows.map((row) => ({
    ...row,
    organization_id: row.organization_id ?? organizationId,
    ...(aliasKey && sourceKey && row[aliasKey] === undefined ? { [aliasKey]: row[sourceKey] } : {}),
  }));
}

function toggleArrayValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreText(value: unknown) {
  return value === null || value === undefined || value === "" ? "Not captured yet" : String(value);
}

function cleanPayload(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "" && value !== undefined && value !== null));
}

function formatCell(value: unknown, column: string) {
  if (column.includes("date") || column.endsWith("_at")) return dateValue(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return textValue(value, "Not captured yet");
}

function territoryLabels(territories: SyncRecord[]) {
  return Object.fromEntries(territories.map((territory) => [String(territory.id), textValue(territory.name)]));
}

function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option ? labels[option] ?? option : "Any"}</option>)}
      </select>
    </label>
  );
}

function SummaryCard({ label, value, onClick, disabled }: { label: string; value: number; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className="summary-card" type="button" onClick={onClick} disabled={disabled}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number | null }) {
  return <SummaryMetric label={label} value={scoreText(value)} />;
}

function BadgeList({ values }: { values: string[] }) {
  if (values.length === 0) return <span>Not captured yet</span>;
  return <div className="badge-row">{values.map((value) => <span className="badge" key={value}>{formatAction(value)}</span>)}</div>;
}

function Checklist({ items }: { items: Array<[string, boolean]> }) {
  return (
    <div className="checklist">
      {items.map(([label, complete]) => (
        <div className={`check-item ${complete ? "complete" : "missing"}`} key={label}>
          <span>{label}</span>
          <strong>{complete ? "Complete" : "Missing"}</strong>
        </div>
      ))}
    </div>
  );
}

function UnsupportedState({ title, message }: { title: string; message: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function UnsupportedFields() {
  return (
    <div className="empty-state">
      <strong>Unsupported backend fields</strong>
      <p>Legal name, DBA/trade names, website, phone, email, address, relationship owner, strategic flag, description, and manual relevance scores are product fields but are not currently stored on the organization schema.</p>
    </div>
  );
}
