"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  dateValue,
  defaultOpportunityPermissions,
  hasPermission,
  numberValue,
  readPermissions,
  syncosFetch,
  textValue,
  type SyncRecord,
} from "../api";
import { IntelligenceShell } from "../intelligence-shell";

const onboardingStages = [
  "Identified",
  "Contact Discovered",
  "Initial Outreach",
  "Application Submitted",
  "Documents Requested",
  "Compliance Review",
  "Operational Interview",
  "Rate Negotiation",
  "Approved",
  "Market Assigned",
  "Mobilized",
] as const;

type OnboardingStage = (typeof onboardingStages)[number];
type AccountLane = "prime" | "contractor" | "all";

type OnboardingData = {
  organizations: SyncRecord[];
  territories: SyncRecord[];
  contacts: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  capacityProviders: SyncRecord[];
  contracts: SyncRecord[];
  rateSchedules: SyncRecord[];
  unavailable: Record<string, string>;
};

type AccountOnboardingRecord = {
  id: string;
  organization: SyncRecord;
  accountType: "Prime / Customer" | "Contractor / Vendor";
  company: string;
  stateRegion: string;
  stage: OnboardingStage;
  accountOwner: string;
  relationshipStrength: string;
  contactTitle: string;
  lastInteraction: string;
  nextAction: string;
  deadline: string;
  requiredDocuments: string;
  missingDocuments: string;
  marketAvailability: string;
  customerPrograms: string;
  rateSheet: string;
  paymentTerms: string;
  approvalStatus: string;
  probabilityOfReceivingWork: string;
  contacts: SyncRecord[];
  candidates: SyncRecord[];
  opportunities: SyncRecord[];
  capacityProviders: SyncRecord[];
  contracts: SyncRecord[];
  rateSchedules: SyncRecord[];
};

export function AccountOnboardingWorkbench() {
  const [data, setData] = useState<OnboardingData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStage, setActiveStage] = useState<OnboardingStage>("Identified");
  const [lane, setLane] = useState<AccountLane>("all");
  const [query, setQuery] = useState("");
  const permissions = useMemo(() => {
    const stored = readPermissions();
    return stored.length ? stored : defaultOpportunityPermissions;
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        setData(await loadOnboardingData());
      } catch (nextError) {
        setError((nextError as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const records = useMemo(() => buildRecords(data), [data]);
  const queueCards = onboardingStages.map((stage) => ({
    stage,
    count: records.filter((record) => record.stage === stage && laneMatches(record, lane)).length,
    helper: stageHelper(stage),
  }));
  const visible = records.filter((record) => record.stage === activeStage && laneMatches(record, lane) && queryMatches(record, query));

  function selectStage(stage: OnboardingStage) {
    setActiveStage(stage);
  }

  return (
    <IntelligenceShell title="Account Onboarding Workbench" purpose="Track prime/customer and contractor/vendor onboarding readiness from first identification through mobilization using current SyncOS intelligence records.">
      <div className="boundary-notice">
        <strong>Account onboarding boundary</strong>
        <span>Account onboarding tracks internal relationship, compliance, commercial, market, and mobilization readiness. It does not create contracts, payables, payroll, invoices, tax filings, insurance verification, customer assignments, or guaranteed work unless a separate supported workflow exists.</span>
      </div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      <UnsupportedNotice unavailable={data.unavailable} />

      <section className="workspace-panel operator-queue-hero">
        <div className="section-toolbar">
          <div>
            <h2>Onboarding pipeline</h2>
            <p className="muted">Stages are inferred from existing organization, contact, candidate, capacity provider, contract, and rate schedule fields until a dedicated onboarding lifecycle exists.</p>
          </div>
          <div className="form-actions">
            <Link className="link-button" href="/intelligence/organizations/new" aria-disabled={!hasPermission(permissions, "organization.create")}>Create Organization</Link>
            <Link className="primary-button link-button" href="/opportunities/candidates/new" aria-disabled={!hasPermission(permissions, "opportunity_candidate.create")}>Create Candidate</Link>
          </div>
        </div>
        <div className="summary-grid">
          {queueCards.map((card) => (
            <SummaryCard
              key={card.stage}
              label={card.stage}
              value={card.count}
              helper={card.helper}
              active={activeStage === card.stage}
              onClick={() => selectStage(card.stage)}
            />
          ))}
        </div>
      </section>

      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Account filters</h2>
            <p className="muted">Use the Prime / Customer lane for companies that may send work to Sync. Use the Contractor / Vendor lane for companies that may become usable capacity.</p>
          </div>
          <button type="button" onClick={() => { setActiveStage("Identified"); setLane("all"); setQuery(""); }}>Reset</button>
        </div>
        <div className="queue-tabs" role="tablist" aria-label="Account onboarding stages">
          {onboardingStages.map((stage) => (
            <button key={stage} type="button" role="tab" aria-selected={activeStage === stage} className={activeStage === stage ? "active" : ""} onClick={() => selectStage(stage)}>
              {stage}
            </button>
          ))}
        </div>
        <div className="filter-grid">
          <label>
            Account lane
            <select value={lane} onChange={(event) => setLane(event.target.value as AccountLane)}>
              <option value="all">All account types</option>
              <option value="prime">Prime / Customer</option>
              <option value="contractor">Contractor / Vendor</option>
            </select>
          </label>
          <label>
            Search
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, owner, contact title, market, program" />
          </label>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>{activeStage}</h2>
            <p className="muted">{emptyMessage(activeStage)}</p>
          </div>
          <span className="badge">{visible.length} shown</span>
        </div>
        {loading ? <div className="empty-state">Loading account onboarding records...</div> : null}
        {!loading && records.length === 0 ? <div className="empty-state">No prime, customer, contractor, vendor, equipment provider, or staffing partner organizations are available for onboarding review yet.</div> : null}
        {!loading && records.length > 0 && visible.length === 0 ? <div className="empty-state">{emptyMessage(activeStage)}</div> : null}
        {visible.length > 0 ? <OnboardingTable rows={visible} /> : null}
      </section>

      <section className="workspace-panel">
        <div className="section-toolbar">
          <div>
            <h2>Current schema gaps</h2>
            <p className="muted">These fields are part of the desired onboarding process but are not explicit first-class onboarding fields in the current API response.</p>
          </div>
        </div>
        <div className="detail-grid">
          <GapCard title="Explicit onboarding stage" body="Current workbench infers the stage from organization, contact, candidate, provider, contract, rate, and territory fields." />
          <GapCard title="Required and missing documents" body="Compliance document summary by account is not exposed here yet, so document fields are shown as schema gaps instead of hardcoded counts." />
          <GapCard title="Customer programs and rate sheet detail" body="Current contracts and rate schedules expose partial commercial context, but program membership and rate sheet readiness need dedicated fields." />
          <GapCard title="Deadline and probability" body="Deadlines are approximated from candidate or opportunity review dates when present. Probability uses current scores and should become an explicit onboarding field later." />
        </div>
      </section>
    </IntelligenceShell>
  );
}

function OnboardingTable({ rows }: { rows: AccountOnboardingRecord[] }) {
  return (
    <div className="wide-table">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Type</th>
            <th>State / Region</th>
            <th>Account Owner</th>
            <th>Relationship Strength</th>
            <th>Contact Title</th>
            <th>Last Interaction</th>
            <th>Next Action</th>
            <th>Deadline</th>
            <th>Required Documents</th>
            <th>Missing Documents</th>
            <th>Market Availability</th>
            <th>Customer Programs</th>
            <th>Rate Sheet</th>
            <th>Payment Terms</th>
            <th>Approval Status</th>
            <th>Probability Of Receiving Work</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><Link className="table-link" href={`/intelligence/organizations/${row.id}`}>{row.company}</Link></td>
              <td>{row.accountType}</td>
              <td>{row.stateRegion}</td>
              <td>{row.accountOwner}</td>
              <td>{row.relationshipStrength}</td>
              <td>{row.contactTitle}</td>
              <td>{row.lastInteraction}</td>
              <td>{row.nextAction}</td>
              <td>{row.deadline}</td>
              <td>{row.requiredDocuments}</td>
              <td>{row.missingDocuments}</td>
              <td>{row.marketAvailability}</td>
              <td>{row.customerPrograms}</td>
              <td>{row.rateSheet}</td>
              <td>{row.paymentTerms}</td>
              <td>{row.approvalStatus}</td>
              <td>{row.probabilityOfReceivingWork}</td>
              <td>
                <div className="row-actions">
                  <Link className="table-link" href={`/intelligence/organizations/${row.id}`}>Open Account</Link>
                  {row.candidates[0]?.id ? <Link className="table-link" href={`/opportunities/candidates/${row.candidates[0].id}`}>Open Candidate</Link> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({ label, value, helper, active, onClick }: { label: string; value: number; helper: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`summary-card ${active ? "active-summary-card" : ""}`} aria-pressed={active} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </button>
  );
}

function GapCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="evidence-item">
      <strong>{title}</strong>
      <span className="muted">{body}</span>
    </div>
  );
}

function UnsupportedNotice({ unavailable }: { unavailable: Record<string, string> }) {
  const rows = Object.entries(unavailable);
  if (!rows.length) return null;
  return (
    <section className="workspace-panel">
      <div className="section-toolbar">
        <h2>Partial Data</h2>
        <span className="badge">{rows.length} unavailable</span>
      </div>
      <div className="table-list">
        {rows.map(([key, message]) => <div className="empty" key={key}>{formatLabel(key)}: {message}</div>)}
      </div>
    </section>
  );
}

async function loadOnboardingData(): Promise<OnboardingData> {
  const unavailable: Record<string, string> = {};
  const [organizations, territories, contacts, candidates, opportunities, capacityProviders, contracts, rateSchedules] = await Promise.all([
    optionalList("/organizations", unavailable, "organizations"),
    optionalList("/territories", unavailable, "territories"),
    optionalList("/contacts", unavailable, "contacts"),
    optionalList("/opportunity-candidates", unavailable, "opportunity candidates"),
    optionalList("/opportunities", unavailable, "opportunities"),
    optionalList("/capacity-providers", unavailable, "capacity providers"),
    optionalList("/contracts", unavailable, "contracts"),
    optionalList("/rate-schedules", unavailable, "rate schedules"),
  ]);
  return { organizations, territories, contacts, candidates, opportunities, capacityProviders, contracts, rateSchedules, unavailable };
}

async function optionalList(path: string, unavailable: Record<string, string>, key: string) {
  try {
    return await syncosFetch<SyncRecord[]>(path);
  } catch {
    unavailable[key] = "Current API or permissions do not expose this onboarding slice.";
    return [];
  }
}

const emptyData: OnboardingData = {
  organizations: [],
  territories: [],
  contacts: [],
  candidates: [],
  opportunities: [],
  capacityProviders: [],
  contracts: [],
  rateSchedules: [],
  unavailable: {},
};

function buildRecords(data: OnboardingData): AccountOnboardingRecord[] {
  return data.organizations
    .filter((organization) => isOnboardingAccount(organization))
    .map((organization) => buildRecord(organization, data))
    .sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || probabilityNumber(b.probabilityOfReceivingWork) - probabilityNumber(a.probabilityOfReceivingWork) || a.company.localeCompare(b.company));
}

function buildRecord(organization: SyncRecord, data: OnboardingData): AccountOnboardingRecord {
  const id = String(organization.id);
  const contacts = data.contacts.filter((contact) => contact.organization_id === id);
  const candidates = data.candidates.filter((candidate) => candidate.organization_id === id);
  const opportunities = data.opportunities.filter((opportunity) => opportunity.organization_id === id);
  const capacityProviders = data.capacityProviders.filter((provider) => provider.organization_id === id);
  const contracts = data.contracts.filter((contract) => contract.organization_id === id);
  const rateSchedules = data.rateSchedules.filter((schedule) => schedule.organization_id === id || contracts.some((contract) => contract.id === schedule.contract_id));
  const territory = data.territories.find((row) => row.id === organization.territory_id);
  const primaryContact = pickPrimaryContact(contacts);
  const stage = inferStage(organization, { contacts, candidates, opportunities, capacityProviders, contracts, rateSchedules });
  const accountType = isContractorAccount(organization) ? "Contractor / Vendor" : "Prime / Customer";
  const paymentTermsDays = contracts.find((contract) => contract.payment_terms_days !== null && contract.payment_terms_days !== undefined)?.payment_terms_days;

  return {
    id,
    organization,
    accountType,
    company: textValue(organization.name),
    stateRegion: textValue(organization.state ?? territory?.code ?? territory?.name, "Not captured yet"),
    stage,
    accountOwner: ownerText(organization, candidates),
    relationshipStrength: relationshipStrengthText(organization, contacts),
    contactTitle: textValue(primaryContact?.title ?? primaryContact?.contact_role, "No contact title captured"),
    lastInteraction: lastInteractionText(organization, contacts, candidates, opportunities, capacityProviders),
    nextAction: nextActionText(stage, organization, contacts, candidates, capacityProviders, contracts, rateSchedules),
    deadline: deadlineText(candidates, opportunities),
    requiredDocuments: requiredDocumentsText(accountType, capacityProviders),
    missingDocuments: missingDocumentsText(capacityProviders),
    marketAvailability: textValue(territory?.name ?? organization.state, "Market not assigned"),
    customerPrograms: programsText(opportunities),
    rateSheet: rateSheetText(rateSchedules),
    paymentTerms: paymentTermsDays === undefined || paymentTermsDays === null ? "Not captured yet" : `Net ${paymentTermsDays}`,
    approvalStatus: approvalText(stage, organization, candidates, capacityProviders, contracts),
    probabilityOfReceivingWork: probabilityText(organization, candidates, opportunities),
    contacts,
    candidates,
    opportunities,
    capacityProviders,
    contracts,
    rateSchedules,
  };
}

function isOnboardingAccount(organization: SyncRecord) {
  const type = String(organization.organization_type ?? organization.type ?? "");
  const roles = asArray(organization.actor_roles);
  return ["prime_contractor", "general_contractor_program_manager", "customer", "utility", "isp_carrier", "subcontractor", "vendor", "equipment_provider", "staffing_partner"].includes(type) || roles.some((role) => ["work_creator", "work_distributor", "capacity_provider", "vendor_enabler"].includes(role));
}

function isContractorAccount(organization: SyncRecord) {
  const type = String(organization.organization_type ?? organization.type ?? "");
  const roles = asArray(organization.actor_roles);
  return ["subcontractor", "vendor", "equipment_provider", "staffing_partner"].includes(type) || roles.includes("capacity_provider") || roles.includes("vendor_enabler");
}

function inferStage(organization: SyncRecord, slices: Pick<AccountOnboardingRecord, "contacts" | "candidates" | "opportunities" | "capacityProviders" | "contracts" | "rateSchedules">): OnboardingStage {
  const status = String(organization.status ?? "");
  const candidateStatuses = slices.candidates.map((row) => String(row.normalized_status ?? row.status ?? ""));
  const opportunityStatuses = slices.opportunities.map((row) => String(row.status ?? row.stage ?? ""));
  const providerStatuses = slices.capacityProviders.map((row) => String(row.status ?? ""));
  const verificationStatuses = slices.capacityProviders.map((row) => String(row.verification_status ?? ""));
  const contractStatuses = slices.contracts.map((row) => String(row.status ?? row.contract_status ?? ""));
  const rateStatuses = slices.rateSchedules.map((row) => String(row.status ?? ""));

  if (providerStatuses.includes("activated") || (["active", "strategic"].includes(status) && Boolean(organization.territory_id) && slices.contacts.length > 0)) return "Mobilized";
  if (organization.territory_id && ["relationship_opened", "active", "strategic"].includes(status)) return "Market Assigned";
  if (["qualified", "relationship_opened", "active", "strategic"].includes(status) || candidateStatuses.some((item) => ["qualified", "qualified_candidate", "converted_to_opportunity"].includes(item)) || verificationStatuses.includes("verified") || contractStatuses.includes("active")) return "Approved";
  if (opportunityStatuses.includes("negotiation") || contractStatuses.includes("draft") || contractStatuses.includes("contract_pending") || rateStatuses.includes("draft")) return "Rate Negotiation";
  if (candidateStatuses.includes("investigating")) return "Operational Interview";
  if (verificationStatuses.includes("verification_pending") || providerStatuses.includes("verification_pending")) return "Compliance Review";
  if (providerStatuses.includes("contract_pending")) return "Documents Requested";
  if (slices.candidates.length > 0 || candidateStatuses.some((item) => ["created", "monitoring"].includes(item))) return "Application Submitted";
  if (slices.contacts.some((contact) => ["contacted", "engaged", "relationship_active"].includes(String(contact.status)) || Boolean(contact.last_contacted_at))) return "Initial Outreach";
  if (slices.contacts.length > 0) return "Contact Discovered";
  return "Identified";
}

function nextActionText(stage: OnboardingStage, organization: SyncRecord, contacts: SyncRecord[], candidates: SyncRecord[], providers: SyncRecord[], contracts: SyncRecord[], rates: SyncRecord[]) {
  if (!organization.relationship_owner_user_id) return "Assign an account owner.";
  if (stage === "Identified") return "Find a decision-maker, vendor manager, or operations contact.";
  if (stage === "Contact Discovered") return "Record initial outreach and confirm the contact path.";
  if (stage === "Initial Outreach") return "Capture application or onboarding requirements.";
  if (stage === "Application Submitted") return "Request onboarding documents and compliance evidence.";
  if (stage === "Documents Requested") return "Follow up on missing document packet.";
  if (stage === "Compliance Review") return "Complete internal compliance review.";
  if (stage === "Operational Interview") return "Confirm operational fit, market coverage, and crew/program expectations.";
  if (stage === "Rate Negotiation") return "Confirm rate sheet and payment terms.";
  if (stage === "Approved") return "Assign market and customer program context.";
  if (stage === "Market Assigned") return "Confirm mobilization readiness and first-work path.";
  if (providers.some((provider) => String(provider.status) === "activated") || contacts.length || candidates.length || contracts.length || rates.length) return "Monitor readiness and keep relationship current.";
  return "Review account.";
}

function ownerText(organization: SyncRecord, candidates: SyncRecord[]) {
  const owner = organization.relationship_owner_name ?? organization.owner_name ?? organization.relationship_owner_user_id ?? candidates.find((candidate) => candidate.owner_name || candidate.owner_user_id)?.owner_name ?? candidates.find((candidate) => candidate.owner_user_id)?.owner_user_id;
  if (!owner) return "Unassigned";
  return String(owner).includes("-") ? `Assigned user ${String(owner).slice(0, 8)}` : String(owner);
}

function relationshipStrengthText(organization: SyncRecord, contacts: SyncRecord[]) {
  const scores = contacts.map((contact) => numberOrNull(contact.relationship_strength_score)).filter((value): value is number => value !== null);
  const best = scores.length ? Math.max(...scores) : numberOrNull(organization.influence_score ?? organization.trust_level);
  if (best === null) return "Not captured yet";
  if (best >= 80) return `Strong (${best})`;
  if (best >= 55) return `Developing (${best})`;
  if (best >= 30) return `Weak (${best})`;
  return `Unproven (${best})`;
}

function lastInteractionText(organization: SyncRecord, contacts: SyncRecord[], candidates: SyncRecord[], opportunities: SyncRecord[], providers: SyncRecord[]) {
  const values = [organization.updated_at, ...contacts.flatMap((row) => [row.last_contacted_at, row.updated_at]), ...candidates.map((row) => row.updated_at), ...opportunities.map((row) => row.updated_at), ...providers.map((row) => row.updated_at)].filter(Boolean);
  const latest = values.map((value) => new Date(String(value))).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => b.getTime() - a.getTime())[0];
  return latest ? dateValue(latest.toISOString()) : "Not captured yet";
}

function deadlineText(candidates: SyncRecord[], opportunities: SyncRecord[]) {
  const value = candidates.find((row) => row.review_date)?.review_date ?? opportunities.find((row) => row.review_date)?.review_date;
  return dateValue(value);
}

function requiredDocumentsText(accountType: AccountOnboardingRecord["accountType"], providers: SyncRecord[]) {
  if (providers.some((provider) => ["verification_pending", "contract_pending"].includes(String(provider.status)))) return "Compliance packet, contract packet";
  return accountType === "Contractor / Vendor" ? "Schema gap: W-9, insurance, safety, rate packet" : "Schema gap: vendor packet, insurance, safety, program terms";
}

function missingDocumentsText(providers: SyncRecord[]) {
  if (providers.some((provider) => ["verified", "contracted", "activated"].includes(String(provider.status)))) return "No missing document summary exposed";
  return "Schema gap: missing document summary required";
}

function programsText(opportunities: SyncRecord[]) {
  const programs = opportunities.map((row) => row.program_name ?? row.customer_program ?? row.work_type ?? row.title).filter(Boolean).slice(0, 3).map(String);
  return programs.length ? programs.join(", ") : "Not captured yet";
}

function rateSheetText(rateSchedules: SyncRecord[]) {
  const active = rateSchedules.find((row) => String(row.status) === "active") ?? rateSchedules[0];
  if (!active) return "Not captured yet";
  return `${textValue(active.name, "Rate schedule")} (${textValue(active.status)})`;
}

function approvalText(stage: OnboardingStage, organization: SyncRecord, candidates: SyncRecord[], providers: SyncRecord[], contracts: SyncRecord[]) {
  if (stage === "Mobilized") return "Mobilized";
  if (stage === "Market Assigned") return "Market assigned";
  if (stage === "Approved") return "Approved internally";
  const statuses = [organization.status, ...candidates.map((row) => row.status), ...providers.map((row) => row.status), ...contracts.map((row) => row.status)].filter(Boolean).map(String);
  return statuses.length ? statuses.map(formatLabel).join(", ") : "Not captured yet";
}

function probabilityText(organization: SyncRecord, candidates: SyncRecord[], opportunities: SyncRecord[]) {
  const scores = [
    numberOrNull(organization.work_relevance_score),
    numberOrNull(organization.influence_score),
    numberOrNull(organization.capacity_relevance_score),
    ...candidates.flatMap((candidate) => [numberOrNull(candidate.candidate_score ?? candidate.score), numberOrNull(candidate.confidence_score), numberOrNull(candidate.relationship_access_score)]),
    ...opportunities.flatMap((opportunity) => [numberOrNull(opportunity.pursuit_score), numberOrNull(opportunity.relationship_access_score), numberOrNull(opportunity.capacity_fit_score)]),
  ].filter((value): value is number => value !== null);
  if (!scores.length) return "Not captured yet";
  const score = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  if (score >= 80) return `High (${score})`;
  if (score >= 55) return `Medium (${score})`;
  if (score >= 30) return `Low (${score})`;
  return `Unproven (${score})`;
}

function queryMatches(record: AccountOnboardingRecord, query: string) {
  if (!query.trim()) return true;
  const haystack = `${record.company} ${record.accountOwner} ${record.contactTitle} ${record.stateRegion} ${record.marketAvailability} ${record.customerPrograms} ${record.nextAction}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function laneMatches(record: AccountOnboardingRecord, lane: AccountLane) {
  if (lane === "all") return true;
  if (lane === "prime") return record.accountType === "Prime / Customer";
  return record.accountType === "Contractor / Vendor";
}

function pickPrimaryContact(contacts: SyncRecord[]) {
  return [...contacts].sort((a, b) => numberValue(b.relationship_strength_score, -1) - numberValue(a.relationship_strength_score, -1) || Date.parse(String(b.last_contacted_at ?? b.updated_at ?? 0)) - Date.parse(String(a.last_contacted_at ?? a.updated_at ?? 0)))[0];
}

function stageHelper(stage: OnboardingStage) {
  if (stage === "Identified") return "Account exists, but contact path is not captured.";
  if (stage === "Contact Discovered") return "Contact exists and outreach should be planned.";
  if (stage === "Initial Outreach") return "A first touch is recorded or implied.";
  if (stage === "Application Submitted") return "Candidate or onboarding intent exists.";
  if (stage === "Documents Requested") return "Document packet is likely blocking progress.";
  if (stage === "Compliance Review") return "Compliance review appears active.";
  if (stage === "Operational Interview") return "Operational fit needs review.";
  if (stage === "Rate Negotiation") return "Commercial terms or rate schedules need attention.";
  if (stage === "Approved") return "Internally approved but not fully market-ready.";
  if (stage === "Market Assigned") return "Market context exists and mobilization is next.";
  return "Account appears ready for controlled work intake or dispatch.";
}

function emptyMessage(stage: OnboardingStage) {
  if (stage === "Identified") return "No identified accounts are missing contacts in this lane.";
  if (stage === "Contact Discovered") return "No accounts are waiting for initial outreach.";
  if (stage === "Initial Outreach") return "No accounts are in initial outreach.";
  if (stage === "Application Submitted") return "No submitted applications or candidate records need document follow-up.";
  if (stage === "Documents Requested") return "No accounts are currently blocked by requested documents.";
  if (stage === "Compliance Review") return "No accounts are in compliance review.";
  if (stage === "Operational Interview") return "No accounts need operational interview review.";
  if (stage === "Rate Negotiation") return "No accounts are in rate negotiation.";
  if (stage === "Approved") return "No approved accounts are waiting for market assignment.";
  if (stage === "Market Assigned") return "No market-assigned accounts are waiting for mobilization.";
  return "No mobilized accounts are visible in this lane.";
}

function stageIndex(stage: OnboardingStage) {
  return onboardingStages.indexOf(stage);
}

function probabilityNumber(value: string) {
  const match = value.match(/\((\d+)\)/);
  return match ? Number(match[1]) : -1;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function formatLabel(value: unknown) {
  return textValue(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
