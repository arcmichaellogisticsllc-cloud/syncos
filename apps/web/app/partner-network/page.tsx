"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CommandShell } from "../dashboard-components";
import { loadAuthContext, syncosFetch, textValue } from "../intelligence/api";

type Inquiry = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string | null;
  territory: string;
  capability: string;
  crew_count?: number | null;
  availability?: string | null;
  equipment?: string | null;
  experience_notes?: string | null;
  source: string;
  status: string;
  owner_user_id?: string | null;
  qualified_organization_id?: string | null;
  potential_capacity_signal?: Record<string, unknown>;
  created_at?: string;
};

type Invitation = {
  id: string;
  organization_id: string;
  organization_name?: string;
  inquiry_id?: string | null;
  invitation_source: string;
  invitation_type: string;
  primary_contact_name: string;
  email: string;
  intended_role_key: string;
  status: string;
  delivery_status: string;
  expires_at?: string;
  created_at?: string;
};

type OnboardingPartner = {
  organization_id: string;
  company: string;
  source: string;
  invite_status: string;
  account_status: string;
  checklist_status: string;
  safe_blockers: string[];
  last_invite_at?: string | null;
};

const statuses = ["ALL", "NEW", "REVIEWING", "CONTACT_REQUIRED", "CONTACTED", "QUALIFIED", "FUTURE_CAPACITY", "NOT_A_FIT", "INVITED", "CONVERTED", "CLOSED"];
const inviteSources = ["MANUAL_INTERNAL", "REFERRAL", "EXISTING_RELATIONSHIP", "OPPORTUNITY_CAPACITY_GAP", "PRIME_CUSTOMER_INTRODUCTION", "PARTNER_NETWORK_RECRUITING", "OTHER"];

export default function PartnerNetworkPage() {
  const [state, setState] = useState({ loading: true, error: "", message: "" });
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [partners, setPartners] = useState<OnboardingPartner[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [contactNote, setContactNote] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [manualInvite, setManualInvite] = useState({ company_name: "", primary_contact_name: "", email: "", source: "MANUAL_INTERNAL" });
  const [manualInviteState, setManualInviteState] = useState({ loading: false, error: "", message: "" });
  const [currentUserId, setCurrentUserId] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  const selected = inquiries.find((inquiry) => inquiry.id === selectedId) ?? inquiries[0];
  const filtered = filter === "ALL" ? inquiries : inquiries.filter((inquiry) => inquiry.status === filter);

  useEffect(() => {
    if (!selectedId && inquiries[0]) setSelectedId(inquiries[0].id);
  }, [inquiries, selectedId]);

  useEffect(() => {
    if (selected?.qualified_organization_id && !organizationId) setOrganizationId(selected.qualified_organization_id);
  }, [selected?.qualified_organization_id, organizationId]);

  async function refresh(message = "") {
    setState({ loading: true, error: "", message });
    try {
      const [context, inquiryData, invitationData, workspaceData] = await Promise.all([
        loadAuthContext(),
        syncosFetch<{ inquiries: Inquiry[] }>("partner-invitations/inquiries"),
        syncosFetch<{ invitations: Invitation[] }>("partner-invitations"),
        syncosFetch<{ partners: OnboardingPartner[] }>("partner-invitations/onboarding-workspace"),
      ]);
      setCurrentUserId(context.user_id);
      setInquiries(inquiryData.inquiries ?? []);
      setInvitations(invitationData.invitations ?? []);
      setPartners(workspaceData.partners ?? []);
      setState({ loading: false, error: "", message });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Partner Network unavailable.", message: "" });
    }
  }

  async function action(label: string, run: () => Promise<unknown>) {
    setState((current) => ({ ...current, error: "", message: `${label}...` }));
    try {
      await run();
      await refresh(`${label} complete.`);
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : "Action failed.", message: "" }));
    }
  }

  function submitContact(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    action("Contact recorded", () => syncosFetch(`partner-invitations/inquiries/${selected.id}/contact`, { method: "POST", body: { note: contactNote } })).then(() => setContactNote(""));
  }

  function qualify(decision: string) {
    if (!selected) return;
    action("Qualification updated", () => syncosFetch(`partner-invitations/inquiries/${selected.id}/qualify`, {
      method: "POST",
      body: {
        decision,
        organization_id: organizationId || selected.qualified_organization_id || undefined,
        territory_verified: true,
        capability_verified: true,
        crew_count_verified: true,
        availability_verified: true,
        equipment_verified: true,
        note: `Sync Admin decision: ${decision}`,
      },
    }));
  }

  function inviteInquiry() {
    if (!selected) return;
    action("Invitation sent", () => syncosFetch(`partner-invitations/inquiries/${selected.id}/invite`, {
      method: "POST",
      body: { organization_id: organizationId || selected.qualified_organization_id },
    }));
  }

  async function submitManualInvite(event: FormEvent) {
    event.preventDefault();
    setManualInviteState({ loading: true, error: "", message: "Sending Partner Admin invitation..." });
    try {
      const result = await syncosFetch<{ email_delivery?: { delivery_status?: string; provider?: string } }>("partner-invitations", {
        method: "POST",
        body: { ...manualInvite, role_key: "partner_admin" },
      });
      await refresh();
      const delivery = result.email_delivery?.delivery_status ? ` Delivery: ${result.email_delivery.delivery_status}.` : "";
      setManualInviteState({ loading: false, error: "", message: `Manual invitation request complete.${delivery}` });
    } catch (error) {
      setManualInviteState({ loading: false, error: error instanceof Error ? error.message : "Manual invitation failed.", message: "" });
    }
  }

  function updateManualCompany(companyName: string) {
    const inquiry = inquiries.find((entry) => entry.company_name.toLowerCase() === companyName.trim().toLowerCase());
    setManualInvite((current) => ({
      ...current,
      company_name: companyName,
      primary_contact_name: inquiry && !current.primary_contact_name ? inquiry.contact_name : current.primary_contact_name,
      email: inquiry && !current.email ? inquiry.email : current.email,
    }));
  }

  const analytics = useMemo(() => ({
    inquiries: inquiries.length,
    qualified: inquiries.filter((inquiry) => inquiry.status === "QUALIFIED").length,
    invitations: invitations.length,
    accepted: invitations.filter((invite) => invite.status === "ACCEPTED").length,
  }), [inquiries, invitations]);
  const companySuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const inquiry of inquiries) names.add(inquiry.company_name);
    for (const partner of partners) names.add(partner.company);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [inquiries, partners]);

  return (
    <CommandShell title="Partner Network" purpose="Internal Sync Admin workspace for Partner inquiries, qualification, invitations, onboarding review, and approval gates.">
      {state.error ? <section className="workspace-panel error-state"><h2>Action unavailable</h2><p>{state.error}</p></section> : null}
      {state.message ? <section className="workspace-panel success-state"><p>{state.message}</p></section> : null}
      {state.loading ? <section className="workspace-panel loading-state">Loading Partner Network...</section> : null}

      <section className="partner-network-summary" aria-label="Partner Network summary">
        <div><span>Inquiries</span><strong>{analytics.inquiries}</strong></div>
        <div><span>Qualified</span><strong>{analytics.qualified}</strong></div>
        <div><span>Invitations</span><strong>{analytics.invitations}</strong></div>
        <div><span>Accepted</span><strong>{analytics.accepted}</strong></div>
      </section>

      <div className="partner-network-layout">
        <section className="workspace-panel partner-network-list">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Partner inquiries</p>
              <h2>Human qualification queue</h2>
            </div>
            <label className="compact-field">
              <span>Status</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                {statuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
          </div>
          <div className="record-list">
            {filtered.map((inquiry) => (
              <button className={selected?.id === inquiry.id ? "record-list-row active" : "record-list-row"} key={inquiry.id} type="button" onClick={() => setSelectedId(inquiry.id)}>
                <span>
                  <strong>{inquiry.company_name}</strong>
                  <small>{inquiry.capability} / {inquiry.territory}</small>
                </span>
                <b>{inquiry.status}</b>
              </button>
            ))}
            {!filtered.length ? <div className="empty-state">No inquiries in this status.</div> : null}
          </div>
        </section>

        <section className="workspace-panel partner-network-detail">
          <p className="eyebrow">Inquiry detail</p>
          {selected ? (
            <>
              <h2>{selected.company_name}</h2>
              <div className="detail-grid">
                <span>Contact</span><strong>{selected.contact_name}</strong>
                <span>Email</span><strong>{selected.email}</strong>
                <span>Phone</span><strong>{textValue(selected.phone)}</strong>
                <span>Capability</span><strong>{selected.capability}</strong>
                <span>Territory</span><strong>{selected.territory}</strong>
                <span>Crew count</span><strong>{textValue(selected.crew_count)}</strong>
                <span>Availability</span><strong>{textValue(selected.availability)}</strong>
                <span>Equipment</span><strong>{textValue(selected.equipment)}</strong>
                <span>Capacity confidence</span><strong>{String(selected.potential_capacity_signal?.confidence ?? "LOW")} / unverified</strong>
              </div>
              <p className="muted">{textValue(selected.experience_notes, "No notes captured.")}</p>

              <div className="partner-network-actions">
                <button type="button" className="operator-link" onClick={() => currentUserId && action("Owner assigned", () => syncosFetch(`partner-invitations/inquiries/${selected.id}/assign`, { method: "POST", body: { owner_user_id: currentUserId } }))}>Assign to Me</button>
                <form onSubmit={submitContact} className="inline-action-form">
                  <input value={contactNote} onChange={(event) => setContactNote(event.target.value)} placeholder="Conversation note" />
                  <button type="submit" className="operator-link">Record Contact</button>
                </form>
              </div>

              <div className="qualification-panel">
                <label className="form-field">
                  <span>Explicit Partner Organization ID for qualification/invite</span>
                  <input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} placeholder="Canonical organization id" />
                </label>
                <div className="button-row">
                  <button className="operator-link" type="button" onClick={() => qualify("QUALIFIED")}>Qualify</button>
                  <button className="operator-link" type="button" onClick={() => qualify("FUTURE_CAPACITY")}>Future Capacity</button>
                  <button className="operator-link operator-link-danger" type="button" onClick={() => qualify("NOT_A_FIT")}>Not a Fit</button>
                  <button className="operator-link operator-link-primary" type="button" disabled={selected.status !== "QUALIFIED"} onClick={inviteInquiry}>Invite Qualified Inquiry</button>
                </div>
                {selected.status !== "QUALIFIED" ? <p className="muted">Inquiry-driven invitation remains locked until a human qualification decision is recorded.</p> : null}
              </div>
            </>
          ) : (
            <div className="empty-state">Select an inquiry to review.</div>
          )}
        </section>
      </div>

      <div className="partner-network-layout secondary">
        <section className="workspace-panel">
          <p className="eyebrow">Manual invitation</p>
          <h2>Invite without public inquiry</h2>
          <p className="muted">Manual invitation bypasses public inquiry only. It does not bypass onboarding, compliance, internal review, approval, Work Order, or mobilization controls.</p>
          <form onSubmit={submitManualInvite} className="stacked-form">
            <label className="form-field">
              <span>Partner company</span>
              <input list="manual-invite-companies" value={manualInvite.company_name} onChange={(event) => updateManualCompany(event.target.value)} placeholder="Start typing a Partner company" />
              <datalist id="manual-invite-companies">
                {companySuggestions.map((company) => <option key={company} value={company} />)}
              </datalist>
            </label>
            <label className="form-field"><span>Primary contact name</span><input value={manualInvite.primary_contact_name} onChange={(event) => setManualInvite((current) => ({ ...current, primary_contact_name: event.target.value }))} /></label>
            <label className="form-field"><span>Email</span><input value={manualInvite.email} onChange={(event) => setManualInvite((current) => ({ ...current, email: event.target.value }))} /></label>
            <label className="form-field"><span>Source</span><select value={manualInvite.source} onChange={(event) => setManualInvite((current) => ({ ...current, source: event.target.value }))}>{inviteSources.map((source) => <option key={source}>{source}</option>)}</select></label>
            <button type="submit" className="primary-button" disabled={manualInviteState.loading}>{manualInviteState.loading ? "Sending..." : "Send Partner Admin Invite"}</button>
            {manualInviteState.error ? <p className="form-error" role="alert">{manualInviteState.error}</p> : null}
            {manualInviteState.message ? <p className="form-success" aria-live="polite">{manualInviteState.message}</p> : null}
          </form>
        </section>

        <section className="workspace-panel">
          <p className="eyebrow">Invitation lifecycle</p>
          <h2>Recent invitations</h2>
          <div className="record-list compact">
            {invitations.slice(0, 8).map((invite) => (
              <div className="record-list-row static" key={invite.id}>
                <span>
                  <strong>{invite.organization_name ?? invite.organization_id}</strong>
                  <small>{invite.email} / {invite.invitation_source}</small>
                </span>
                <span className="button-row">
                  <b>{invite.status}</b>
                  {invite.status === "SENT" ? <button type="button" className="mini-action" onClick={() => action("Invitation resent", () => syncosFetch(`partner-invitations/${invite.id}/resend`, { method: "POST" }))}>Resend</button> : null}
                  {invite.status === "SENT" ? <button type="button" className="mini-action danger" onClick={() => action("Invitation revoked", () => syncosFetch(`partner-invitations/${invite.id}/revoke`, { method: "POST", body: { reason: "Sync Admin revoked from Partner Network workspace" } }))}>Revoke</button> : null}
                </span>
              </div>
            ))}
            {!invitations.length ? <div className="empty-state">No invitations found.</div> : null}
          </div>
        </section>
      </div>

      <section className="workspace-panel">
        <p className="eyebrow">Onboarding review</p>
        <h2>Partner readiness and approval</h2>
        <div className="partner-review-grid">
          {partners.map((partner) => (
            <div className="review-card" key={partner.organization_id}>
              <div>
                <strong>{partner.company}</strong>
                <small>{partner.invite_status} / {partner.account_status}</small>
              </div>
              <p>{partner.checklist_status}</p>
              <p className="muted">{partner.safe_blockers.length ? `Missing: ${partner.safe_blockers.join(", ")}` : "No checklist blockers reported."}</p>
              <button className="operator-link" type="button" disabled={partner.checklist_status !== "READY_FOR_REVIEW"} onClick={() => action("Partner approval reviewed", () => syncosFetch(`partner-invitations/organizations/${partner.organization_id}/approve`, { method: "POST" }))}>Approve When Ready</button>
            </div>
          ))}
          {!partners.length ? <div className="empty-state">No onboarding partners found.</div> : null}
        </div>
      </section>
    </CommandShell>
  );
}
