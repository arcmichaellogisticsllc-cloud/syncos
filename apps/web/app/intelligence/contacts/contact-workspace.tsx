"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultContactPermissions, hasPermission, readPermissions, readToken, savePermissions, saveToken, syncosFetch, type SyncRecord, textValue, dateValue, numberValue } from "../api";
import { IntelligenceShell } from "../intelligence-shell";

const contactRoles = [
  "decision_maker",
  "executive_sponsor",
  "economic_buyer",
  "technical_buyer",
  "procurement_contact",
  "vendor_manager",
  "construction_manager",
  "project_manager",
  "field_supervisor",
  "field_inspector",
  "qc_contact",
  "safety_contact",
  "engineering_contact",
  "design_contact",
  "permitting_contact",
  "row_contact",
  "ap_contact",
  "billing_contact",
  "contract_manager",
  "subcontractor_owner",
  "subcontractor_foreman",
  "equipment_contact",
  "staffing_contact",
  "gatekeeper",
  "relationship_bridge",
  "influencer",
  "unknown",
];

const verificationMethods = ["direct_confirmation", "email_validated", "phone_validated", "linkedin_confirmed", "organization_website", "public_source", "relationship_source", "internal_note"];
const contactStatuses = ["discovered", "enriched", "verified", "contacted", "engaged", "relationship_active", "dormant", "invalid", "archived"];
const verificationStatuses = ["unverified", "partially_verified", "verified", "invalid", "stale"];
const financeRoles = new Set(["ap_contact", "billing_contact", "contract_manager", "economic_buyer"]);
const projectRoles = new Set(["project_manager", "field_supervisor", "field_inspector", "qc_contact", "safety_contact", "construction_manager"]);

type ContactData = {
  contacts: SyncRecord[];
  organizations: SyncRecord[];
  signals: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  projects: SyncRecord[];
  settlements: SyncRecord[];
  invoices: SyncRecord[];
  payments: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  unavailable: string[];
};

type ContactView = SyncRecord & {
  id: string;
  name: string;
  organization?: SyncRecord;
  organizationName: string;
  organizationType: string;
  organizationActorRoles: string[];
  contactRole: string;
  ownerName: string;
  influenceScore: number | null;
  decisionAuthorityScore: number | null;
  relationshipStrengthScore: number | null;
  completenessScore: number;
  completenessBand: string;
  recommendedNextAction: string;
  stale: boolean;
  missingContactMethod: boolean;
};

type Filters = {
  q: string;
  organizationId: string;
  organizationType: string;
  actorRole: string;
  contactRole: string;
  status: string;
  verificationStatus: string;
  missingMethod: string;
  stale: string;
  owner: string;
  sort: string;
};

const initialFilters: Filters = {
  q: "",
  organizationId: "",
  organizationType: "",
  actorRole: "",
  contactRole: "",
  status: "",
  verificationStatus: "",
  missingMethod: "",
  stale: "",
  owner: "",
  sort: "default",
};

export function ContactDirectory() {
  const [session, setSession] = useSession();
  const [data, setData] = useState<ContactData>(emptyContactData);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await loadContactData());
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const contacts = useMemo(() => sortContacts(data.contacts.map((contact) => enrichContact(contact, data)), filters).filter((contact) => contactMatchesFilters(contact, filters)), [data, filters]);
  const summary = useMemo(() => buildSummary(data.contacts.map((contact) => enrichContact(contact, data))), [data]);

  return (
    <IntelligenceShell title="Contacts" purpose="Search, verify, and prepare human access points for telecom relationship pathing.">
      <SessionPanel session={session} />
      {error ? <div className="error">{error}</div> : null}
      <div className="summary-grid">
        <SummaryCard label="Total Contacts" value={summary.total} onClick={() => setFilters(initialFilters)} />
        <SummaryCard label="Verified Contacts" value={summary.verified} onClick={() => setFilters({ ...initialFilters, verificationStatus: "verified" })} />
        <SummaryCard label="Strategic Contacts" value={summary.strategic} onClick={() => setFilters({ ...initialFilters, sort: "strategic_first" })} />
        <SummaryCard label="Missing Email/Phone" value={summary.missingMethod} onClick={() => setFilters({ ...initialFilters, missingMethod: "true" })} />
        <SummaryCard label="Missing Role" value={summary.missingRole} onClick={() => setFilters({ ...initialFilters, contactRole: "missing" })} />
        <SummaryCard label="Stale Contacts" value={summary.stale} onClick={() => setFilters({ ...initialFilters, stale: "true" })} />
        <SummaryCard label="Without Owner" value={summary.noOwner} onClick={() => setFilters({ ...initialFilters, owner: "missing" })} />
        <SummaryCard label="Decision-Makers" value={summary.decisionMakers} onClick={() => setFilters({ ...initialFilters, contactRole: "decision_maker" })} />
        <SummaryCard label="AP / Billing" value={summary.finance} onClick={() => setFilters({ ...initialFilters, contactRole: "billing_contact" })} />
        <SummaryCard label="Construction" value={summary.construction} onClick={() => setFilters({ ...initialFilters, contactRole: "construction_manager" })} />
        <SummaryCard label="Relationship Bridges" value={summary.bridges} onClick={() => setFilters({ ...initialFilters, contactRole: "relationship_bridge" })} />
        <SummaryCard label="Archived Contacts" value={summary.archived} onClick={() => setFilters({ ...initialFilters, status: "archived" })} />
      </div>

      <section className="workspace-panel">
        <div className="section-header">
          <div>
            <h2>Contact Directory</h2>
            <p className="muted">Filters run over tenant-scoped contact and organization data exposed by existing APIs.</p>
          </div>
          <Link className="primary-button" href="/intelligence/contacts/new" aria-disabled={!hasPermission(session.permissions, "contact.create")}>Create Contact</Link>
        </div>
        <div className="filter-grid">
          <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search contacts" />
          <Select label="Organization" value={filters.organizationId} options={["", ...data.organizations.map((organization) => String(organization.id))]} labels={labelMap(data.organizations, "name")} onChange={(organizationId) => setFilters({ ...filters, organizationId })} />
          <Select label="Organization type" value={filters.organizationType} options={["", ...unique(data.organizations.map((organization) => String(organization.organization_type ?? organization.type ?? "")).filter(Boolean))]} onChange={(organizationType) => setFilters({ ...filters, organizationType })} />
          <Select label="Actor role" value={filters.actorRole} options={["", ...unique(data.organizations.flatMap((organization) => arrayValue(organization.actor_roles)))]} onChange={(actorRole) => setFilters({ ...filters, actorRole })} />
          <Select label="Contact role" value={filters.contactRole} options={["", "missing", ...contactRoles]} onChange={(contactRole) => setFilters({ ...filters, contactRole })} />
          <Select label="Status" value={filters.status} options={["", ...contactStatuses]} onChange={(status) => setFilters({ ...filters, status })} />
          <Select label="Verification" value={filters.verificationStatus} options={["", ...verificationStatuses]} onChange={(verificationStatus) => setFilters({ ...filters, verificationStatus })} />
          <Select label="Missing method" value={filters.missingMethod} options={["", "true", "false"]} onChange={(missingMethod) => setFilters({ ...filters, missingMethod })} />
          <Select label="Stale" value={filters.stale} options={["", "true", "false"]} onChange={(stale) => setFilters({ ...filters, stale })} />
          <Select label="Owner" value={filters.owner} options={["", "missing"]} onChange={(owner) => setFilters({ ...filters, owner })} />
          <Select label="Sort" value={filters.sort} options={["default", "name_asc", "updated_desc", "influence_desc", "decision_desc", "relationship_desc", "last_contacted_oldest", "last_verified_oldest", "strategic_first"]} onChange={(sort) => setFilters({ ...filters, sort })} />
        </div>
        <div className="badge-row">
          {[
            ["Strategic Contacts", { sort: "strategic_first" }],
            ["Needs Verification", { verificationStatus: "unverified" }],
            ["Missing Email/Phone", { missingMethod: "true" }],
            ["Stale Contacts", { stale: "true" }],
            ["No Owner", { owner: "missing" }],
            ["Decision-Makers", { contactRole: "decision_maker" }],
            ["Vendor Managers", { contactRole: "vendor_manager" }],
            ["Field Validators", { contactRole: "field_inspector" }],
            ["Finance Contacts", { contactRole: "billing_contact" }],
          ].map(([label, patch]) => (
            <button key={String(label)} type="button" onClick={() => setFilters({ ...initialFilters, ...(patch as Partial<Filters>) })}>{String(label)}</button>
          ))}
        </div>
      </section>

      <section className="workspace-panel">
        {loading ? <div className="empty-state">Loading contacts...</div> : contacts.length ? <ContactTable contacts={contacts} permissions={session.permissions} reload={load} /> : <EmptyContacts filters={filters} clear={() => setFilters(initialFilters)} />}
      </section>
    </IntelligenceShell>
  );
}

export function ContactForm({ mode, contactId }: { mode: "create" | "edit"; contactId?: string }) {
  const router = useRouter();
  const [session, setSession] = useSession();
  const [organizations, setOrganizations] = useState<SyncRecord[]>([]);
  const [contact, setContact] = useState<SyncRecord | null>(null);
  const [form, setForm] = useState({
    organization_id: "",
    full_name: "",
    title: "",
    email: "",
    phone: "",
    mobile: "",
    linkedin_url: "",
    status: "discovered",
    contact_role: "",
    notes: "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [nextOrganizations, nextContact] = await Promise.all([
          syncosFetch<SyncRecord[]>("/organizations"),
          mode === "edit" && contactId ? syncosFetch<SyncRecord>(`/contacts/${contactId}`) : Promise.resolve(null),
        ]);
        setOrganizations(nextOrganizations);
        if (nextContact) {
          setContact(nextContact);
          setForm({
            organization_id: textValue(nextContact.organization_id, ""),
            full_name: textValue(nextContact.full_name ?? [nextContact.first_name, nextContact.last_name].filter(Boolean).join(" "), ""),
            title: textValue(nextContact.title, ""),
            email: textValue(nextContact.email, ""),
            phone: textValue(nextContact.phone, ""),
            mobile: textValue(nextContact.mobile, ""),
            linkedin_url: textValue(nextContact.linkedin_url, ""),
            status: textValue(nextContact.status, "discovered"),
            contact_role: textValue(nextContact.contact_role, "unknown"),
            notes: textValue(nextContact.notes, ""),
          });
        }
      } catch (nextError) {
        setError((nextError as Error).message);
      }
    }
    void load();
  }, [contactId, mode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.organization_id) {
      setError("A contact must belong to an organization.");
      return;
    }
    if (![form.email, form.phone, form.mobile, form.linkedin_url, form.notes].some((value) => value.trim())) {
      setError("Add at least one contact method or source note.");
      return;
    }
    try {
      const body = prune({
        organization_id: form.organization_id,
        full_name: form.full_name,
        title: form.title,
        contact_role: form.contact_role || "unknown",
        email: form.email,
        phone: form.phone,
        mobile: form.mobile,
        linkedin_url: form.linkedin_url,
        status: form.status,
        notes: form.notes,
      });
      const saved = mode === "edit" && contactId ? await syncosFetch<SyncRecord>(`/contacts/${contactId}`, { method: "PATCH", body }) : await syncosFetch<SyncRecord>("/contacts", { method: "POST", body });
      router.push(`/intelligence/contacts/${saved.id ?? contactId}`);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <IntelligenceShell title={mode === "create" ? "Create Contact" : "Edit Contact"} purpose="Capture a human access point inside a telecom actor organization.">
      <SessionPanel session={session} />
      {error ? <div className="error">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <label>Organization<SelectInline value={form.organization_id} options={["", ...organizations.map((organization) => String(organization.id))]} labels={labelMap(organizations, "name")} onChange={(organization_id) => setForm({ ...form, organization_id })} /></label>
        <label>Full name<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required /></label>
        <label>Title or role description<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
        <label>Contact role<SelectInline value={form.contact_role} options={["", ...contactRoles]} onChange={(contact_role) => setForm({ ...form, contact_role })} /></label>
        <label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label>Mobile<input value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} /></label>
        <label>LinkedIn<input value={form.linkedin_url} onChange={(event) => setForm({ ...form, linkedin_url: event.target.value })} /></label>
        <label>Source note<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <label>Status<SelectInline value={form.status} options={contactStatuses} onChange={(status) => setForm({ ...form, status })} /></label>
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={!hasPermission(session.permissions, mode === "create" ? "contact.create" : "contact.update")}>{mode === "create" ? "Create Contact" : "Save Contact"}</button>
          {contact ? <Link href={`/intelligence/contacts/${contact.id}`}>Cancel</Link> : <Link href="/intelligence/contacts">Cancel</Link>}
        </div>
      </form>
    </IntelligenceShell>
  );
}

export function ContactDetail({ contactId }: { contactId: string }) {
  const [session, setSession] = useSession();
  const [data, setData] = useState<ContactData>(emptyContactData);
  const [contact, setContact] = useState<ContactView | null>(null);
  const [related, setRelated] = useState<RelatedSlices>(emptyRelated);
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [nextData, detail, timeline, audit] = await Promise.all([
        loadContactData(),
        syncosFetch<SyncRecord>(`/contacts/${contactId}/detail`),
        hasPermission(session.permissions, "contact.timeline.read") ? optionalSingle(`/contacts/${contactId}/timeline`) : Promise.resolve([]),
        hasPermission(session.permissions, "contact.audit.read") ? optionalSingle(`/contacts/${contactId}/audit-summary`) : Promise.resolve([]),
      ]);
      const nextContact = (detail.contact ?? detail) as SyncRecord;
      const merged = { ...nextData, contacts: [nextContact, ...nextData.contacts.filter((row) => row.id !== nextContact.id)] };
      setData(merged);
      setContact(enrichContact(nextContact, merged));
      setRelated({
        signals: asRows(detail.related_signals),
        candidates: asRows(detail.related_candidates),
        opportunities: asRows(detail.related_opportunities),
        projects: asRows(detail.related_projects),
        settlements: asRows((detail.finance_relevance as SyncRecord | undefined)?.settlements),
        invoices: asRows((detail.finance_relevance as SyncRecord | undefined)?.invoices),
        payments: asRows((detail.finance_relevance as SyncRecord | undefined)?.payments),
        constraints: asRows(detail.constraints_summary),
        recommendations: asRows(detail.recommendations_summary),
        events: asRows(timeline),
        audit: asRows(audit),
      });
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [contactId, session.permissions.join(",")]);

  const tabs = contact ? buildTabs(contact, related) : [];

  return (
    <IntelligenceShell title="Contact Detail" purpose="Understand the human access point, organization context, authority, relationship strength, and next action.">
      <SessionPanel session={session} />
      {error ? <div className="error">{error}</div> : null}
      {!contact ? (
        <section className="workspace-panel"><div className="empty-state">Contact not found or you do not have access.</div></section>
      ) : (
        <>
          <section className="workspace-panel">
            <div className="section-header">
              <div>
                <h2>{contact.name}</h2>
                <div className="badge-row">
                  <span className="badge">{textValue(contact.title)}</span>
                  <span className="badge">{formatAction(contact.status)}</span>
                  <span className="badge">{formatAction(contact.verification_status)}</span>
                  <span className="badge">{contact.organizationName}</span>
                </div>
              </div>
              <div className="button-row">
                <Link href={`/intelligence/contacts/${contact.id}/edit`}>Edit Contact</Link>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.verify") || contact.status === "archived"} onClick={() => setModal("verify")}>Verify Contact</button>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.assign_owner") || contact.status === "archived"} onClick={() => setModal("owner")}>Assign Owner</button>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.update") || contact.status === "archived"} onClick={() => setModal("contacted")}>Mark Contacted</button>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.update") || contact.status === "archived"} onClick={() => setModal("engaged")}>Mark Engaged</button>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.mark_relationship_active") || contact.status === "archived"} onClick={() => setModal("active")}>Relationship Active</button>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.update") || contact.status === "archived"} onClick={() => setModal("dormant")}>Mark Dormant</button>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.mark_invalid") || contact.status === "archived"} onClick={() => setModal("invalid")}>Mark Invalid</button>
                <button type="button" disabled onClick={() => undefined}>Add to Relationship Map</button>
                <button type="button" disabled={!hasPermission(session.permissions, "contact.archive") || contact.status === "archived"} onClick={() => setModal("archive")}>Archive</button>
              </div>
            </div>
            <div className="summary-grid">
              <SummaryMetric label="Influence" value={scoreText(contact.influenceScore, "contact influence")} />
              <SummaryMetric label="Decision Authority" value={scoreText(contact.decisionAuthorityScore, "decision authority")} />
              <SummaryMetric label="Relationship Strength" value={relationshipText(contact.relationshipStrengthScore)} />
              <SummaryMetric label="Verification" value={formatAction(contact.verification_status)} />
              <SummaryMetric label="Completeness" value={`${contact.completenessScore}% ${contact.completenessBand}`} />
              <SummaryMetric label="Signals" value={String(related.signals.length)} />
              <SummaryMetric label="Candidates" value={String(related.candidates.length)} />
              <SummaryMetric label="Opportunities" value={String(related.opportunities.length)} />
              <SummaryMetric label="Open Constraints" value={String(related.constraints.length)} />
              <SummaryMetric label="Next Action" value={formatAction(contact.recommendedNextAction)} />
            </div>
          </section>

          <div className="workspace-grid">
            <aside className="workspace-panel">
              <h2>Strategic Sidebar</h2>
              <dl>
                <dt>Organization</dt><dd>{contact.organization ? <Link href={`/intelligence/organizations/${contact.organization.id}`}>{contact.organizationName}</Link> : "Not linked yet"}</dd>
                <dt>Actor roles</dt><dd>{contact.organizationActorRoles.length ? contact.organizationActorRoles.map(formatAction).join(", ") : "Not captured yet"}</dd>
                <dt>Contact role</dt><dd>{formatAction(contact.contactRole)}</dd>
                <dt>Primary relationship use</dt><dd>{relationshipUse(contact)}</dd>
                <dt>Best next action</dt><dd>{formatAction(contact.recommendedNextAction)}</dd>
              </dl>
              <Checklist items={missingContactChecklist(contact)} />
              <div className="warning-box">Relationship Mapping workspace coming next. This contact can prepare target, bridge, influencer, validator, or billing context once backend relationship pathing is exposed.</div>
            </aside>
            <section className="workspace-panel">
              <div className="tabs">
                {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
              </div>
              <ContactTab tab={tab} contact={contact} related={related} permissions={session.permissions} />
            </section>
          </div>
          {modal === "verify" ? <VerifyModal contact={contact} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "owner" ? <OwnerModal contact={contact} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "contacted" ? <ContactedModal contact={contact} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "engaged" ? <EngagedModal contact={contact} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "active" ? <RelationshipActiveModal contact={contact} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "dormant" ? <ReasonModal title="Mark Dormant" path={`/contacts/${contact.id}/mark-dormant`} reasonKey="reason" onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "invalid" ? <InvalidModal contact={contact} onClose={() => setModal("")} onSaved={load} /> : null}
          {modal === "archive" ? <ArchiveModal contact={contact} onClose={() => setModal("")} onSaved={load} /> : null}
        </>
      )}
    </IntelligenceShell>
  );
}

function ContactTab({ tab, contact, related, permissions }: { tab: string; contact: ContactView; related: RelatedSlices; permissions: string[] }) {
  if (tab === "overview") {
    return (
      <div className="workspace-stack">
        <p>{contact.name} is connected to {contact.organizationName}. {roleExplanation(contact)}</p>
        <SummaryMetric label="Recommended next action" value={formatAction(contact.recommendedNextAction)} />
        <SummaryMetric label="Completeness" value={`${contact.completenessScore}% ${contact.completenessBand}`} />
        <ResearchPlaceholder />
      </div>
    );
  }
  if (tab === "organization") {
    return (
      <div className="workspace-stack">
        <ObjectSlice title="Organization context" rows={contact.organization ? [contact.organization] : []} columns={["name", "organization_type", "actor_roles", "status", "territory_name", "relationship_owner_name", "strategic_flag", "influence_score", "work_relevance_score", "capacity_relevance_score", "payment_relevance_score"]} empty="This contact is not connected to an organization. Attach an organization before using this contact in relationship pathing." />
        {contact.organization ? <Link href={`/intelligence/organizations/${contact.organization.id}`}>Open Organization</Link> : null}
      </div>
    );
  }
  if (tab === "methods") return <ContactMethods contact={contact} />;
  if (tab === "authority") {
    return (
      <div className="workspace-stack">
        <SummaryMetric label="Contact role" value={formatAction(contact.contactRole)} />
        <SummaryMetric label="Influence" value={scoreText(contact.influenceScore, "contact influence")} />
        <SummaryMetric label="Decision authority" value={scoreText(contact.decisionAuthorityScore, "decision authority")} />
        <SummaryMetric label="Relationship strength" value={relationshipText(contact.relationshipStrengthScore)} />
        <div className="empty-state">Authority categories not captured yet.</div>
      </div>
    );
  }
  if (tab === "relationships") {
    return <div className="empty-state">Relationship Mapping workspace coming next. This contact will be usable as a target, bridge, influencer, gatekeeper, validator, or billing contact.</div>;
  }
  if (tab === "signals") return <ObjectSlice title="Related Signals" rows={related.signals} columns={["title", "category", "type", "confidence_score", "trust_level", "status", "source_name", "date_discovered", "recommended_next_action"]} empty="No signals are linked to this contact yet. Organization-level signals may still exist." />;
  if (tab === "candidates") return <ObjectSlice title="Related Candidates" rows={related.candidates} columns={["name", "status", "confidence_score", "estimated_value", "work_type", "owner_name"]} empty="Contact-specific candidate linkage is not exposed yet." />;
  if (tab === "opportunities") return <ObjectSlice title="Related Opportunities" rows={related.opportunities} columns={["name", "status", "estimated_value", "pursuit_score", "owner_name", "decision_date"]} empty="Contact-specific opportunity linkage is not exposed yet." />;
  if (tab === "projects") return <ObjectSlice title="Related Projects" rows={related.projects} columns={["name", "status", "customer_organization_id", "created_at"]} empty="Project-contact linkage is not exposed yet." />;
  if (tab === "finance") return <FinanceSlice related={related} />;
  if (tab === "constraints") return <ObjectSlice title="Constraints" rows={related.constraints} columns={["constraint_type", "severity", "owner_id", "due_date", "status", "resolution_summary"]} empty="No active constraints are tied to this contact." action={hasPermission(permissions, "constraint.create") ? <button type="button" disabled>Create Constraint</button> : undefined} />;
  if (tab === "recommendations") return <ObjectSlice title="Recommendations" rows={related.recommendations} columns={["recommendation_type", "confidence_score", "risk_level", "expected_impact", "status", "owner_id"]} empty="No recommendations are tied to this contact." />;
  if (tab === "events") return <ObjectSlice title="Events" rows={related.events} columns={["event_type", "actor_name", "timestamp", "object_type", "summary"]} empty="No contact timeline events are available or you do not have timeline permission." />;
  if (tab === "audit") return <ObjectSlice title="Audit" rows={related.audit} columns={["actor_name", "action", "object_type", "reason", "created_at", "correlation_id"]} empty="Audit summary is unavailable or you do not have audit permission." />;
  return null;
}

function ContactTable({ contacts, permissions, reload }: { contacts: ContactView[]; permissions: string[]; reload: () => Promise<void> }) {
  return (
    <table>
      <thead>
        <tr>
          {["Name", "Title", "Organization", "Organization Type", "Contact Role", "Email", "Phone", "Influence", "Decision Authority", "Relationship", "Verification", "Status", "Owner", "Last Contacted", "Last Verified", "Next Action", "Actions"].map((column) => <th key={column}>{column}</th>)}
        </tr>
      </thead>
      <tbody>
        {contacts.map((contact) => (
          <tr key={contact.id}>
            <td><Link href={`/intelligence/contacts/${contact.id}`}>{contact.name}</Link></td>
            <td>{textValue(contact.title)}</td>
            <td>{contact.organization ? <Link href={`/intelligence/organizations/${contact.organization.id}`}>{contact.organizationName}</Link> : "Not linked yet"}</td>
            <td>{formatAction(contact.organizationType)}</td>
            <td><span className="badge">{formatAction(contact.contactRole)}</span></td>
            <td>{textValue(contact.email)}</td>
            <td>{textValue(contact.phone ?? contact.mobile)}</td>
            <td>{scoreText(contact.influenceScore, "influence")}</td>
            <td>{scoreText(contact.decisionAuthorityScore, "authority")}</td>
            <td>{relationshipText(contact.relationshipStrengthScore)}</td>
            <td>{formatAction(contact.verification_status)}</td>
            <td>{formatAction(contact.status)}</td>
            <td>{contact.ownerName}</td>
            <td>{dateValue(contact.last_contacted_at)}</td>
            <td>{dateValue(contact.last_verified_at)}</td>
            <td>{formatAction(contact.recommendedNextAction)}</td>
            <td>
              <div className="button-row">
                <Link href={`/intelligence/contacts/${contact.id}`}>Open</Link>
                <Link href={`/intelligence/contacts/${contact.id}/edit`} aria-disabled={!hasPermission(permissions, "contact.update")}>Edit</Link>
                <button type="button" disabled title="Open detail to verify with method and source">Verify</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContactMethods({ contact }: { contact: ContactView }) {
  return (
    <div className="workspace-stack">
      <dl>
        <dt>Email</dt><dd>{textValue(contact.email)}</dd>
        <dt>Phone</dt><dd>{textValue(contact.phone)}</dd>
        <dt>Mobile</dt><dd>{textValue(contact.mobile)}</dd>
        <dt>LinkedIn</dt><dd>{contact.linkedin_url ? <a href={String(contact.linkedin_url)} target="_blank" rel="noreferrer">Open LinkedIn</a> : "Not captured yet"}</dd>
        <dt>Preferred contact method</dt><dd>{textValue(contact.preferred_contact_method)}</dd>
        <dt>Best time to contact</dt><dd>{textValue(contact.best_time_to_contact)}</dd>
        <dt>Source</dt><dd>{textValue(contact.source)}</dd>
        <dt>Verification method</dt><dd>{formatAction(contact.verification_method)}</dd>
        <dt>Verification source</dt><dd>{textValue(contact.verification_source)}</dd>
        <dt>Verification note</dt><dd>{textValue(contact.verification_note)}</dd>
        <dt>Last verified</dt><dd>{dateValue(contact.last_verified_at)}</dd>
      </dl>
      <Checklist items={[
        ["No contact method", !contact.missingContactMethod],
        ["Email missing", Boolean(contact.email)],
        ["Phone missing", Boolean(contact.phone || contact.mobile)],
        ["LinkedIn missing", Boolean(contact.linkedin_url)],
        ["Verification missing", contact.verification_status === "verified"],
        ["Contact may be stale", !contact.stale],
      ]} />
    </div>
  );
}

function FinanceSlice({ related }: { related: RelatedSlices }) {
  return (
    <div className="workspace-stack">
      <ObjectSlice title="Settlements" rows={related.settlements} columns={["settlement_number", "status", "gross_amount", "net_amount"]} empty="No settlements connected through this contact organization." />
      <ObjectSlice title="Invoices" rows={related.invoices} columns={["invoice_number", "status", "invoice_amount", "due_date"]} empty="No invoices connected through this contact organization." />
      <ObjectSlice title="Payments" rows={related.payments} columns={["payment_reference", "status", "payment_amount", "payment_date"]} empty="No payments connected through this contact organization." />
    </div>
  );
}

function VerifyModal({ contact, onClose, onSaved }: { contact: ContactView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ verification_method: "", verification_source: "", verification_note: "" });
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!hasContactMethod(contact)) {
      setError("Verification requires at least one contact method.");
      return;
    }
    if (!form.verification_method || (!form.verification_source && !form.verification_note)) {
      setError("Verification method and source or note are required.");
      return;
    }
    try {
      await syncosFetch(`/contacts/${contact.id}/verify`, { method: "POST", body: prune(form) });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <Modal title="Verify Contact" onClose={onClose}>
      {error ? <div className="error">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <label>Verification method<SelectInline value={form.verification_method} options={["", ...verificationMethods]} onChange={(verification_method) => setForm({ ...form, verification_method })} /></label>
        <label>Verification source<input value={form.verification_source} onChange={(event) => setForm({ ...form, verification_source: event.target.value })} /></label>
        <label>Verification note<textarea value={form.verification_note} onChange={(event) => setForm({ ...form, verification_note: event.target.value })} /></label>
        <button className="primary-button" type="submit">Verify Contact</button>
      </form>
    </Modal>
  );
}

function OwnerModal({ contact, onClose, onSaved }: { contact: ContactView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [ownerUserId, setOwnerUserId] = useState(textValue(contact.relationship_owner_user_id, ""));
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ownerUserId) {
      setError("Owner user id is required.");
      return;
    }
    try {
      await syncosFetch(`/contacts/${contact.id}/assign-owner`, { method: "POST", body: { owner_user_id: ownerUserId } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Assign Owner" onClose={onClose}>
      {error ? <div className="error">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <label>Owner user id<input value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} /></label>
        <button className="primary-button" type="submit">Assign Owner</button>
      </form>
    </Modal>
  );
}

function ContactedModal({ contact, onClose, onSaved }: { contact: ContactView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ contact_date: new Date().toISOString().slice(0, 10), interaction_type: "call", summary: "", outcome: "connected" });
  return <ActionFormModal title="Mark Contacted" path={`/contacts/${contact.id}/mark-contacted`} form={form} setForm={(next) => setForm(next as typeof form)} onClose={onClose} onSaved={onSaved} fields={[
    ["contact_date", "Contact date"],
    ["interaction_type", "Interaction type"],
    ["summary", "Summary"],
    ["outcome", "Outcome"],
  ]} />;
}

function EngagedModal({ contact, onClose, onSaved }: { contact: ContactView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ engagement_date: new Date().toISOString().slice(0, 10), summary: "", outcome: "requested_follow_up" });
  return <ActionFormModal title="Mark Engaged" path={`/contacts/${contact.id}/mark-engaged`} form={form} setForm={(next) => setForm(next as typeof form)} onClose={onClose} onSaved={onSaved} fields={[
    ["engagement_date", "Engagement date"],
    ["summary", "Summary"],
    ["outcome", "Outcome"],
  ]} />;
}

function RelationshipActiveModal({ contact, onClose, onSaved }: { contact: ContactView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ reason: "", recent_interaction_summary: "", relationship_strength_score: "" });
  return <ActionFormModal title="Relationship Active" path={`/contacts/${contact.id}/mark-relationship-active`} form={form} setForm={(next) => setForm(next as typeof form)} onClose={onClose} onSaved={onSaved} fields={[
    ["reason", "Reason"],
    ["recent_interaction_summary", "Recent interaction summary"],
    ["relationship_strength_score", "Relationship strength score"],
  ]} />;
}

function InvalidModal({ contact, onClose, onSaved }: { contact: ContactView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ invalid_reason: "", invalid_note: "" });
  return <ActionFormModal title="Mark Invalid" path={`/contacts/${contact.id}/mark-invalid`} form={form} setForm={(next) => setForm(next as typeof form)} onClose={onClose} onSaved={onSaved} fields={[
    ["invalid_reason", "Invalid reason"],
    ["invalid_note", "Invalid note"],
  ]} selectOptions={{ invalid_reason: ["", "bad_email", "bad_phone", "left_company", "wrong_person", "duplicate", "not_relevant", "other"] }} />;
}

function ReasonModal({ title, path, reasonKey, onClose, onSaved }: { title: string; path: string; reasonKey: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) {
      setError("Reason is required.");
      return;
    }
    try {
      await syncosFetch(path, { method: "POST", body: { [reasonKey]: reason } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {error ? <div className="error">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="primary-button" type="submit">{title}</button>
      </form>
    </Modal>
  );
}

function ActionFormModal({ title, path, form, setForm, fields, selectOptions = {}, onClose, onSaved }: { title: string; path: string; form: Record<string, string>; setForm: (form: Record<string, string>) => void; fields: Array<[string, string]>; selectOptions?: Record<string, string[]>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await syncosFetch(path, { method: "POST", body: prune(form) });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {error ? <div className="error">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        {fields.map(([key, label]) => (
          selectOptions[key]
            ? <label key={key}>{label}<SelectInline value={form[key] ?? ""} options={selectOptions[key]} onChange={(value) => setForm({ ...form, [key]: value })} /></label>
            : <label key={key}>{label}<input value={form[key] ?? ""} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>
        ))}
        <button className="primary-button" type="submit">{title}</button>
      </form>
    </Modal>
  );
}

function ArchiveModal({ contact, onClose, onSaved }: { contact: ContactView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) {
      setError("Archive reason is required.");
      return;
    }
    try {
      await syncosFetch(`/contacts/${contact.id}/archive`, { method: "POST", body: { archive_reason: reason } });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }
  return (
    <Modal title="Archive Contact" onClose={onClose}>
      {error ? <div className="error">{error}</div> : null}
      <form className="workspace-panel" onSubmit={(event) => void submit(event)}>
        <label>Reason<SelectInline value={reason} options={["", "duplicate", "left_company", "not_relevant", "bad_data", "inactive", "other"]} onChange={setReason} /></label>
        <button className="primary-button" type="submit">Archive Contact</button>
      </form>
    </Modal>
  );
}

async function loadContactData(): Promise<ContactData> {
  const unavailable: string[] = [];
  const [contacts, organizations, signals, candidates, opportunities, projects, settlements, invoices, payments, constraints, recommendations] = await Promise.all([
    optionalList("/contacts", unavailable, "contacts"),
    optionalList("/organizations", unavailable, "organizations"),
    optionalList("/signals", unavailable, "signals"),
    optionalList("/opportunity-candidates", unavailable, "opportunity candidates"),
    optionalList("/opportunities", unavailable, "opportunities"),
    optionalList("/projects", unavailable, "projects"),
    optionalList("/settlements", unavailable, "settlements"),
    optionalList("/invoices", unavailable, "invoices"),
    optionalList("/payments", unavailable, "payments"),
    optionalList("/constraints", unavailable, "constraints"),
    optionalList("/recommendations", unavailable, "recommendations"),
  ]);
  return { contacts, organizations, signals, candidates, opportunities, projects, settlements, invoices, payments, constraints, recommendations, unavailable };
}

async function optionalList(path: string, unavailable: string[], label: string) {
  try {
    const result = await syncosFetch<unknown>(path);
    return Array.isArray(result) ? (result as SyncRecord[]) : [];
  } catch {
    unavailable.push(label);
    return [];
  }
}

async function optionalSingle(path: string) {
  try {
    return await syncosFetch<unknown>(path);
  } catch {
    return [];
  }
}

function asRows(value: unknown): SyncRecord[] {
  return Array.isArray(value) ? (value as SyncRecord[]) : [];
}

function enrichContact(contact: SyncRecord, data: ContactData): ContactView {
  const id = String(contact.id);
  const organization = data.organizations.find((row) => row.id === contact.organization_id);
  const contactRole = readContactRole(contact);
  const influenceScore = scoreOrNull(contact.influence_score);
  const decisionAuthorityScore = scoreOrNull(contact.decision_authority_score);
  const relationshipStrengthScore = scoreOrNull(contact.relationship_strength_score);
  const missingContactMethod = !hasContactMethod(contact);
  const stale = isStale(contact);
  const completeness = contactCompleteness({ ...contact, contactRole, influenceScore, decisionAuthorityScore, relationshipStrengthScore });
  const enriched: ContactView = {
    ...contact,
    id,
    name: textValue(contact.full_name ?? [contact.first_name, contact.last_name].filter(Boolean).join(" "), "Unnamed contact"),
    organization,
    organizationName: textValue(contact.organization_name ?? organization?.name, "Not linked yet"),
    organizationType: textValue(contact.organization_type ?? organization?.organization_type ?? organization?.type, "Not captured yet"),
    organizationActorRoles: arrayValue(contact.organization_actor_roles ?? organization?.actor_roles),
    contactRole,
    ownerName: textValue(contact.relationship_owner_name ?? contact.owner_name ?? contact.relationship_owner_user_id, "Unassigned"),
    influenceScore,
    decisionAuthorityScore,
    relationshipStrengthScore,
    completenessScore: numberValue(contact.completeness_score, completeness.score),
    completenessBand: textValue(contact.completeness_band, completeness.band),
    missingContactMethod,
    stale: Boolean(contact.stale ?? stale),
    recommendedNextAction: textValue(contact.recommended_next_action, recommendedNextAction(contact, contactRole, missingContactMethod, stale, relationshipStrengthScore)),
  };
  return enriched;
}

type RelatedSlices = {
  signals: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  projects: SyncRecord[];
  settlements: SyncRecord[];
  invoices: SyncRecord[];
  payments: SyncRecord[];
  constraints: SyncRecord[];
  recommendations: SyncRecord[];
  events: SyncRecord[];
  audit: SyncRecord[];
};

const emptyRelated: RelatedSlices = { signals: [], candidates: [], opportunities: [], projects: [], settlements: [], invoices: [], payments: [], constraints: [], recommendations: [], events: [], audit: [] };

function buildRelatedSlices(contact: ContactView, data: ContactData): RelatedSlices {
  const orgId = String(contact.organization_id ?? "");
  const contactId = contact.id;
  const signals = data.signals.filter((signal) => signal.primary_contact_id === contactId || signal.contact_id === contactId || signal.organization_id === orgId || signal.primary_organization_id === orgId);
  const candidates = data.candidates.filter((candidate) => candidate.contact_id === contactId || candidate.organization_id === orgId);
  const opportunities = data.opportunities.filter((opportunity) => opportunity.contact_id === contactId || opportunity.organization_id === orgId);
  const projects = data.projects.filter((project) => project.contact_id === contactId || project.customer_organization_id === orgId || project.organization_id === orgId);
  const invoices = data.invoices.filter((invoice) => invoice.contact_id === contactId || invoice.customer_organization_id === orgId || invoice.organization_id === orgId);
  return {
    signals,
    candidates,
    opportunities,
    projects,
    settlements: data.settlements.filter((settlement) => settlement.contact_id === contactId || settlement.customer_organization_id === orgId || settlement.organization_id === orgId),
    invoices,
    payments: data.payments.filter((payment) => payment.contact_id === contactId || payment.customer_organization_id === orgId || payment.organization_id === orgId || invoices.some((invoice) => invoice.id === payment.invoice_id)),
    constraints: data.constraints.filter((constraint) => (constraint.affected_object_type === "contact" && constraint.affected_object_id === contactId) || (constraint.related_object_type === "contact" && constraint.related_object_id === contactId)),
    recommendations: data.recommendations.filter((recommendation) => (recommendation.related_object_type === "contact" && recommendation.related_object_id === contactId) || recommendation.object_id === contactId),
    events: [],
    audit: [],
  };
}

function contactMatchesFilters(contact: ContactView, filters: Filters) {
  const haystack = [contact.name, contact.title, contact.email, contact.phone, contact.mobile, contact.organizationName, contact.organizationType, contact.status, contact.verification_status].map((value) => String(value ?? "").toLowerCase()).join(" ");
  if (filters.q && !haystack.includes(filters.q.toLowerCase())) return false;
  if (filters.organizationId && contact.organization_id !== filters.organizationId) return false;
  if (filters.organizationType && contact.organizationType !== filters.organizationType) return false;
  if (filters.actorRole && !contact.organizationActorRoles.includes(filters.actorRole)) return false;
  if (filters.contactRole === "missing" && contact.contactRole !== "unknown") return false;
  if (filters.contactRole && filters.contactRole !== "missing" && contact.contactRole !== filters.contactRole) return false;
  if (filters.status && contact.status !== filters.status) return false;
  if (filters.verificationStatus && contact.verification_status !== filters.verificationStatus) return false;
  if (filters.missingMethod && String(contact.missingContactMethod) !== filters.missingMethod) return false;
  if (filters.stale && String(contact.stale) !== filters.stale) return false;
  if (filters.owner === "missing" && contact.ownerName !== "Unassigned") return false;
  return true;
}

function sortContacts(contacts: ContactView[], filters: Filters) {
  const sorted = [...contacts];
  sorted.sort((a, b) => {
    if (filters.sort === "name_asc") return a.name.localeCompare(b.name);
    if (filters.sort === "updated_desc") return timeValue(b.updated_at) - timeValue(a.updated_at);
    if (filters.sort === "influence_desc") return nullableScore(b.influenceScore) - nullableScore(a.influenceScore);
    if (filters.sort === "decision_desc") return nullableScore(b.decisionAuthorityScore) - nullableScore(a.decisionAuthorityScore);
    if (filters.sort === "relationship_desc") return nullableScore(b.relationshipStrengthScore) - nullableScore(a.relationshipStrengthScore);
    if (filters.sort === "last_contacted_oldest") return timeValue(a.last_contacted_at) - timeValue(b.last_contacted_at);
    if (filters.sort === "last_verified_oldest") return timeValue(a.last_verified_at) - timeValue(b.last_verified_at);
    if (filters.sort === "strategic_first") return nullableScore(b.influenceScore) + nullableScore(b.decisionAuthorityScore) - (nullableScore(a.influenceScore) + nullableScore(a.decisionAuthorityScore));
    return nullableScore(b.influenceScore) + nullableScore(b.decisionAuthorityScore) + timeValue(b.updated_at) / 1000000000000 - (nullableScore(a.influenceScore) + nullableScore(a.decisionAuthorityScore) + timeValue(a.updated_at) / 1000000000000);
  });
  return sorted;
}

function buildSummary(contacts: ContactView[]) {
  return {
    total: contacts.length,
    verified: contacts.filter((contact) => contact.verification_status === "verified").length,
    strategic: contacts.filter((contact) => nullableScore(contact.influenceScore) >= 75 || nullableScore(contact.decisionAuthorityScore) >= 75 || nullableScore(contact.relationshipStrengthScore) >= 80).length,
    missingMethod: contacts.filter((contact) => contact.missingContactMethod).length,
    missingRole: contacts.filter((contact) => contact.contactRole === "unknown").length,
    stale: contacts.filter((contact) => contact.stale).length,
    noOwner: contacts.filter((contact) => contact.ownerName === "Unassigned").length,
    decisionMakers: contacts.filter((contact) => contact.contactRole === "decision_maker").length,
    finance: contacts.filter((contact) => financeRoles.has(contact.contactRole)).length,
    construction: contacts.filter((contact) => projectRoles.has(contact.contactRole)).length,
    bridges: contacts.filter((contact) => contact.contactRole === "relationship_bridge").length,
    archived: contacts.filter((contact) => contact.status === "archived").length,
  };
}

function recommendedNextAction(contact: SyncRecord, contactRole: string, missingMethod: boolean, stale: boolean, relationshipStrengthScore: number | null) {
  if (contact.status === "archived") return "view_only";
  if (contact.status === "invalid") return "replace_or_archive";
  if (!contact.organization_id) return "attach_organization";
  if (!contactRole || contactRole === "unknown") return "assign_role";
  if (missingMethod) return "add_contact_method";
  if (contact.verification_status === "unverified") return "verify_contact";
  if (!contact.owner_user_id && !contact.owner_name) return "assign_owner";
  if (stale) return "reverify_contact";
  if (relationshipStrengthScore === null || relationshipStrengthScore < 40) return "strengthen_relationship";
  return "review_contact";
}

function contactCompleteness(contact: SyncRecord & { contactRole: string; influenceScore: number | null; decisionAuthorityScore: number | null; relationshipStrengthScore: number | null }) {
  const items = [
    Boolean(contact.organization_id),
    Boolean(contact.full_name || contact.first_name || contact.last_name),
    Boolean(contact.title),
    contact.contactRole !== "unknown",
    hasContactMethod(contact),
    contact.verification_status === "verified",
    Boolean(contact.owner_user_id || contact.owner_name),
    contact.influenceScore !== null,
    contact.decisionAuthorityScore !== null,
    contact.relationshipStrengthScore !== null,
  ];
  const score = Math.round((items.filter(Boolean).length / items.length) * 100);
  return { score, band: score >= 90 ? "complete" : score >= 70 ? "usable" : score >= 40 ? "partial" : "incomplete" };
}

function buildTabs(contact: ContactView, related: RelatedSlices) {
  const tabs = [
    ["overview", "Overview"],
    ["organization", "Organization Context"],
    ["methods", "Contact Methods"],
    ["authority", "Role & Authority"],
    ["relationships", "Relationship Context"],
    ["signals", "Related Signals"],
    ["candidates", "Related Candidates"],
    ["opportunities", "Related Opportunities"],
  ];
  if (projectRoles.has(contact.contactRole) || related.projects.length > 0) tabs.push(["projects", "Related Projects"]);
  if (financeRoles.has(contact.contactRole) || related.invoices.length > 0 || related.payments.length > 0) tabs.push(["finance", "Finance Relevance"]);
  return [...tabs, ["constraints", "Constraints"], ["recommendations", "Recommendations"], ["events", "Events"], ["audit", "Audit"]].map(([id, label]) => ({ id, label }));
}

function readContactRole(contact: SyncRecord) {
  const direct = String(contact.contact_role ?? "");
  if (contactRoles.includes(direct)) return direct;
  return "unknown";
}

async function verifyContact(id: string, reload: () => Promise<void>) {
  await syncosFetch(`/contacts/${id}/verify`, { method: "POST" });
  await reload();
}

function missingContactChecklist(contact: ContactView) {
  return [
    ["Missing organization", Boolean(contact.organization_id)],
    ["Missing role", contact.contactRole !== "unknown"],
    ["Missing email/phone/LinkedIn", !contact.missingContactMethod],
    ["Missing verification", contact.verification_status === "verified"],
    ["Missing owner", contact.ownerName !== "Unassigned"],
    ["Missing relationship strength", contact.relationshipStrengthScore !== null],
    ["Missing decision authority score", contact.decisionAuthorityScore !== null],
    ["Contact stale", !contact.stale],
    ["No related relationship map", false],
  ] as Array<[string, boolean]>;
}

function roleExplanation(contact: ContactView) {
  if (contact.contactRole === "vendor_manager") return "This contact may influence subcontractor onboarding, vendor approval, and access to work distributed by the organization.";
  if (contact.contactRole === "field_inspector" || contact.contactRole === "qc_contact") return "This contact may validate field work, influence correction flow, or unblock production acceptance.";
  if (contact.contactRole === "ap_contact" || contact.contactRole === "billing_contact") return "This contact may help resolve settlement, invoice, AR, or payment issues.";
  if (contact.contactRole === "relationship_bridge") return "This contact may introduce Jackson to target contacts or help relationship pathing.";
  if (contact.contactRole === "decision_maker") return "This contact may influence or approve telecom work decisions.";
  return "Contact role is not captured by the backend yet. Use the title, organization context, and notes to prepare relationship mapping.";
}

function relationshipUse(contact: ContactView) {
  if (financeRoles.has(contact.contactRole)) return "Cash resolution and billing access";
  if (projectRoles.has(contact.contactRole)) return "Production validation and field execution access";
  if (contact.contactRole === "relationship_bridge") return "Relationship bridge";
  if (contact.contactRole === "decision_maker") return "Decision access";
  return "General access point";
}

function ResearchPlaceholder() {
  return (
    <section className="workspace-panel">
      <h3>AI Contact Research</h3>
      <p className="muted">AI-assisted contact research will enrich this profile from approved sources. No automatic field updates occur without human approval.</p>
      <div className="summary-grid">
        {["Research Summary", "Identity Findings", "Organization Connection", "Role Assessment", "Authority Assessment", "Possible Contact Methods", "Related People", "Related Projects / Signals", "Sources", "Confidence", "Timestamp", "Suggested Field Updates", "Missing Information", "Recommended Next Action"].map((item) => <SummaryMetric key={item} label={item} value="Not captured yet" />)}
      </div>
    </section>
  );
}

function ObjectSlice({ title, rows, columns, empty, action }: { title: string; rows: SyncRecord[]; columns: string[]; empty: string; action?: React.ReactNode }) {
  return (
    <section>
      <div className="section-header">
        <h3>{title}</h3>
        {action}
      </div>
      {rows.length === 0 ? <div className="empty-state">{empty}</div> : (
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{formatAction(column)}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 12).map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

function Checklist({ items }: { items: Array<[string, boolean]> }) {
  return <ul className="checklist">{items.map(([label, complete]) => <li key={label}><span className={complete ? "complete" : "missing"}>{complete ? "Complete" : "Missing"}</span>{label}</li>)}</ul>;
}

function SessionPanel({ session }: { session: ReturnType<typeof useSession>[0] }) {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL !== "true") return null;
  return (
    <details className="workspace-panel">
      <summary>Session</summary>
      <label>API token<textarea value={session.token} onChange={(event) => session.setToken(event.target.value)} /></label>
      <label>Visible permissions<textarea value={session.permissions.join(", ")} onChange={(event) => session.setPermissions(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
    </details>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="section-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return <button className="summary-card" type="button" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="summary-card" role="group"><span>{label}</span><strong>{value}</strong></div>;
}

function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label>{label}<SelectInline value={value} options={options} labels={labels} onChange={onChange} /></label>;
}

function SelectInline({ value, options, labels = {}, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{labels[option] ?? (option ? formatAction(option) : "Any")}</option>)}</select>;
}

function EmptyContacts({ filters, clear }: { filters: Filters; clear: () => void }) {
  const filtered = Object.values(filters).some(Boolean);
  return <div className="empty-state">{filtered ? "No contacts match this filter." : "No contacts have been added yet. Add contacts to build access into organizations and support relationship pathing."}<div><button type="button" onClick={clear}>Clear filters</button><Link href="/intelligence/contacts/new">Create Contact</Link></div></div>;
}

function useSession() {
  const [token, setTokenState] = useState("");
  const [permissions, setPermissionsState] = useState<string[]>(defaultContactPermissions);
  useEffect(() => {
    setTokenState(readToken());
    const hasStoredPermissions = typeof window !== "undefined" && Boolean(window.localStorage.getItem("syncos.permissions"));
    const stored = readPermissions();
    setPermissionsState(hasStoredPermissions ? stored : defaultContactPermissions);
  }, []);
  function setToken(value: string) {
    setTokenState(value);
    saveToken(value);
  }
  function setPermissions(values: string[]) {
    setPermissionsState(values);
    savePermissions(values);
  }
  return [{ token, permissions, setToken, setPermissions }, setSessionNoop] as const;
}

function setSessionNoop() {
  return undefined;
}

const emptyContactData: ContactData = { contacts: [], organizations: [], signals: [], candidates: [], opportunities: [], projects: [], settlements: [], invoices: [], payments: [], constraints: [], recommendations: [], unavailable: [] };

function hasContactMethod(contact: SyncRecord) {
  return [contact.email, contact.phone, contact.mobile, contact.linkedin_url].some((value) => typeof value === "string" && value.trim());
}

function isStale(contact: SyncRecord) {
  const value = contact.last_verified_at ?? contact.updated_at;
  if (!value || contact.status === "archived") return false;
  return Date.now() - new Date(String(value)).getTime() > 90 * 24 * 60 * 60 * 1000;
}

function scoreOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function nullableScore(value: number | null) {
  return value ?? -1;
}

function scoreText(score: number | null, label: string) {
  if (score === null) return "Not captured yet";
  const band = score >= 75 ? "Strategic" : score >= 50 ? "Strong" : score >= 25 ? "Moderate" : "Low";
  return `${score} ${band}`;
}

function relationshipText(score: number | null) {
  if (score === null) return "Not captured yet";
  const band = score >= 80 ? "Strategic" : score >= 60 ? "Active" : score >= 40 ? "Known" : score >= 20 ? "Weak" : "Unknown";
  return `${score} ${band}`;
}

function timeValue(value: unknown) {
  if (!value) return 0;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function labelMap(rows: SyncRecord[], field: string) {
  return Object.fromEntries(rows.map((row) => [String(row.id), textValue(row[field])]));
}

function formatAction(value: unknown) {
  return textValue(value, "Not captured yet").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.map(formatAction).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (String(value ?? "").match(/^\d{4}-\d{2}-\d{2}T/)) return dateValue(value);
  return textValue(value, "Not captured yet");
}

function prune(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "" && value !== undefined && value !== null));
}
