"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { readPermissions, readToken, syncosFetch } from "../intelligence/api";

type Persona = "partner_admin" | "partner_foreman";
type Section =
  | "dashboard"
  | "company"
  | "compliance"
  | "workforce"
  | "workers"
  | "worker-detail"
  | "crews"
  | "crew-detail"
  | "agreements"
  | "agreement-detail"
  | "work-orders"
  | "work-order-detail"
  | "vehicles"
  | "mobilization"
  | "field-map"
  | "daily-jsa";

type PartnerContext = {
  user: { id: string; display_name: string };
  persona: Persona;
  organization: { id: string; name: string; status: string };
  capacity_provider: { id: string; name: string; status: string; verification_status?: string; contract_status?: string };
};

type PartnerActions = {
  allowed_actions?: string[];
  route_visibility?: Record<string, boolean>;
};

type ComplianceSummary = {
  overall_status?: string;
  profile_status?: string;
  w9_status?: string;
  payment_status?: string;
  insurance_status?: string;
  blockers?: Array<{ key?: string; category?: string; message?: string }>;
  blocker_categories?: string[];
  evaluated_at?: string;
};

type CompanyProfile = Record<string, unknown> | null;
type TaxProfile = Record<string, unknown> | null;
type PaymentProfile = Record<string, unknown> | null;
type InsurancePolicy = Record<string, unknown>;
type Worker = Record<string, unknown>;
type Crew = Record<string, unknown>;
type Agreement = Record<string, unknown>;
type WorkOrder = Record<string, unknown>;
type VehicleAssignment = Record<string, unknown>;
type Readiness = {
  id?: string;
  overall_status?: string;
  passed_check_count?: number;
  blocker_count?: number;
  warning_count?: number;
  blockers?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  passed_checks?: Array<Record<string, unknown>>;
  decision?: Decision;
};
type Decision = { decision?: string; external_conditions?: string[]; expires_at?: string | null; revocation_reason?: string | null };
type Notice = {
  id?: string;
  notice_number?: string;
  version_number?: number;
  status?: string;
  production_start_status?: string;
  production_start_date?: string | null;
  production_start_time?: string | null;
  timezone?: string | null;
  initial_map_work_package_ref?: string | null;
  initial_work_area?: string | null;
  external_instructions?: string | null;
  external_conditions?: string[];
  production_start?: { authorization_status?: string; start_date?: string | null; start_time?: string | null; timezone?: string | null; map_work_package_ref?: string | null; work_area?: string | null };
};
type MapAssignment = {
  id?: string;
  status?: string;
  project?: { id?: string; name?: string };
  work_order?: { id?: string; work_order_number?: string; scope_summary?: string; primary_work_area?: string | null };
  crew?: { id?: string; name?: string };
  map?: { document_id?: string; version_id?: string; name?: string; customer_document_number?: string | null; revision_number?: number; revision_label?: string | null; page_count?: number; processing_status?: string; status?: string; original_filename?: string; file_hash?: string };
  work_zones?: Array<{ id?: string; name?: string; page_number?: number; x_ratio?: number; y_ratio?: number; zoom_level?: number }>;
};
type DailyJsa = {
  id?: string;
  status?: string;
  work_date?: string;
  work_location?: string;
  weather?: string;
  site_conditions?: string;
  hazards?: string[];
  controls?: string[];
  meeting_completed_at?: string;
  foreman_certified?: boolean;
  crew_name?: string;
  foreman_name?: string;
  assignment?: Record<string, unknown>;
  participants?: Array<{ worker_id?: string; name?: string; role?: string; participation_status?: string; acknowledged?: boolean }>;
};

type PortalData = {
  context?: PartnerContext;
  actions?: PartnerActions;
  compliance?: ComplianceSummary;
  company?: CompanyProfile;
  tax?: TaxProfile;
  payment?: PaymentProfile;
  policies?: InsurancePolicy[];
  workers?: Worker[];
  crews?: Crew[];
  rosterByCrew?: Record<string, Worker[]>;
  readinessByCrew?: Record<string, Readiness>;
  agreements?: Agreement[];
  workOrders?: WorkOrder[];
  vehicles?: VehicleAssignment[];
  mobilization?: Readiness | null;
  notice?: Notice | null;
  mapAssignment?: MapAssignment | null;
  jsaToday?: DailyJsa | null;
  jsas?: DailyJsa[];
  foremanCrew?: Crew | null;
  foremanRoster?: Worker[];
  foremanWorkOrder?: WorkOrder | null;
};

const adminNav = [
  ["Dashboard", "/partner"],
  ["Company", "/partner/company"],
  ["Compliance", "/partner/compliance"],
  ["Workers", "/partner/workers"],
  ["Crews", "/partner/crews"],
  ["Agreements", "/partner/agreements"],
  ["Work Orders", "/partner/work-orders"],
  ["Vehicles", "/partner/vehicles"],
  ["Mobilization", "/partner/mobilization"],
  ["Daily JSA", "/partner/jsa"],
] as const;

const foremanNav = [
  ["Today", "/partner"],
  ["Crew", "/partner/crews"],
  ["Assignment", "/partner/work-orders"],
  ["Field Map", "/partner/field/map"],
  ["Daily JSA", "/partner/jsa"],
  ["Mobilization", "/partner/mobilization"],
] as const;

export function PartnerShell({ section, itemId }: { section: Section; itemId?: string }) {
  const [state, setState] = useState<{ loading: boolean; error?: string; denied?: boolean; data: PortalData }>({ loading: true, data: {} });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState({ loading: true, data: {} });
      if (!readToken()) {
        setState({ loading: false, denied: true, error: "Sign in with a Partner account to access SyncOS Partner Portal.", data: {} });
        return;
      }
      try {
        const context = await syncosFetch<PartnerContext>("partner-personas/me/context");
        const actions = await safeFetch<PartnerActions>("partner-personas/me/actions");
        const data = context.persona === "partner_foreman" ? await loadForeman(context, actions) : await loadAdmin(context, actions);
        if (!cancelled) setState({ loading: false, data });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!cancelled) setState({ loading: false, denied: /401|403|forbidden|unauthorized/i.test(text), error: text, data: {} });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.data;
  const persona = data.context?.persona;
  const nav = persona === "partner_foreman" ? foremanNav : adminNav;
  const activeLabel = activeSectionLabel(section, persona);
  const permissions = useMemo(() => readPermissions(), [state.loading]);

  async function acknowledgeNotice() {
    if (!data.notice?.id || !persona) return;
    try {
      setMessage(null);
      const path = persona === "partner_foreman" ? `partner-mobilization/foreman/notices/${data.notice.id}/acknowledge` : `partner-mobilization/me/notices/${data.notice.id}/acknowledge`;
      await syncosFetch(path, { method: "POST", body: {} });
      setMessage("Notice acknowledgment recorded as receipt only.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notice acknowledgment failed.");
    }
  }

  return (
    <main className="partner-portal-shell">
      <aside className="partner-sidebar" aria-label="Partner navigation">
        <div>
          <p className="eyebrow">Partner Portal</p>
          <h1>{data.context?.organization.name ?? "SyncOS Partner"}</h1>
          <p className="partner-persona">{personaLabel(persona)}</p>
        </div>
        <nav className="partner-nav">
          {nav.map(([label, href]) => (
            <Link key={href} className={label === activeLabel ? "partner-nav-link active" : "partner-nav-link"} href={href}>
              {label}
            </Link>
          ))}
          <span className="partner-nav-link disabled" aria-disabled="true">Daily Production <small>After start authorization</small></span>
        </nav>
      </aside>
      <section className="partner-main">
        {state.loading ? <LoadingPortal /> : state.denied ? <DeniedPortal message={state.error} /> : state.error ? <ErrorPortal message={state.error} /> : (
          <>
            <header className="partner-page-header">
              <div>
                <p className="eyebrow">{personaLabel(persona)}</p>
                <h2>{pageTitle(section, persona)}</h2>
              </div>
              <StatusPill label="Organization" value={data.context?.organization.status} />
            </header>
            {message ? <div className={/failed|forbidden|error/i.test(message) ? "partner-banner error" : "partner-banner success"}>{message}</div> : null}
            {renderSection(section, data, permissions, itemId, acknowledgeNotice, completeJsa)}
          </>
        )}
      </section>
    </main>
  );

  async function completeJsa() {
    try {
      setMessage(null);
      const completed = await syncosFetch<DailyJsa>("syncfield/foreman/jsa/today/complete", {
        method: "POST",
        body: {
          work_location: data.mapAssignment?.work_order?.primary_work_area || data.notice?.initial_work_area || "Assigned work area",
          weather: "Field reviewed",
          site_conditions: "Reviewed with Crew",
          hazards: ["traffic", "overhead_utilities"],
          controls: ["ppe_reviewed", "emergency_procedures_reviewed", "stop_work_authority_reviewed", "traffic_control_reviewed"],
          foreman_certified: true,
        },
      });
      setState((current) => ({ ...current, data: { ...current.data, jsaToday: completed } }));
      setMessage("Daily JSA completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Daily JSA completion failed.");
    }
  }
}

async function loadAdmin(context: PartnerContext, actions?: PartnerActions): Promise<PortalData> {
  const permissions = readPermissions();
  const [compliance, company, tax, payment, policies, workers, crews, agreements, workOrders, vehicles, mapAssignment, jsas] = await Promise.all([
    safeFetch<ComplianceSummary>("partner-compliance/me/summary"),
    safeFetch<CompanyProfile>("partner-compliance/me/company-profile"),
    safeFetch<TaxProfile>("partner-compliance/me/w9"),
    safeFetch<PaymentProfile>("partner-compliance/me/payment-profile"),
    safeFetch<InsurancePolicy[]>("partner-compliance/me/insurance-policies", []),
    safeFetch<Worker[]>("partner-workforce/me/workers", []),
    safeFetch<Crew[]>("partner-workforce/me/crews", []),
    safeFetch<Agreement[]>("partner-agreements/me/agreements", []),
    safeFetch<WorkOrder[]>("partner-agreements/me/work-orders", []),
    safeFetch<VehicleAssignment[]>("partner-agreements/me/vehicle-assignments", []),
    permissions.includes("partner_map.read") ? safeFetch<MapAssignment | null>("syncfield/partner/map-assignment", null) : null,
    permissions.includes("partner_jsa.read") ? safeFetch<DailyJsa[]>("syncfield/partner/jsas", []) : [],
  ]);
  const rosterByCrew: Record<string, Worker[]> = {};
  const readinessByCrew: Record<string, Readiness> = {};
  await Promise.all((crews ?? []).map(async (crew) => {
    const id = str(crew.id);
    if (!id) return;
    rosterByCrew[id] = await safeFetch<Worker[]>(`partner-workforce/me/crews/${id}/roster`, []);
    const readiness = await safeFetch<Readiness | null>(`partner-workforce/me/crews/${id}/readiness`, null);
    if (readiness) readinessByCrew[id] = readiness;
  }));
  const firstWorkOrder = (workOrders ?? [])[0];
  const versionId = str(firstWorkOrder?.id);
  const mobilization = versionId ? await safeFetch<Readiness | null>(`partner-mobilization/me/work-order-versions/${versionId}/readiness`, null) : null;
  const notice = versionId ? await safeFetch<Notice | null>(`partner-mobilization/me/work-order-versions/${versionId}/notice`, null) : null;
  return { context, actions, compliance, company, tax, payment, policies, workers, crews, rosterByCrew, readinessByCrew, agreements, workOrders, vehicles, mobilization, notice, mapAssignment, jsas };
}

async function loadForeman(context: PartnerContext, actions?: PartnerActions): Promise<PortalData> {
  const permissions = readPermissions();
  const [compliance, foremanCrew, foremanRoster, foremanWorkOrder, mobilization, notice, mapAssignment, jsaToday] = await Promise.all([
    safeFetch<ComplianceSummary>("partner-compliance/me/summary"),
    safeFetch<Crew | null>("partner-workforce/foreman/crew", null),
    safeFetch<Worker[]>("partner-workforce/foreman/crew/roster", []),
    safeFetch<WorkOrder | null>("partner-agreements/foreman/work-order", null),
    safeFetch<Readiness | null>("partner-mobilization/foreman/readiness", null),
    safeFetch<Notice | null>("partner-mobilization/foreman/notice", null),
    permissions.includes("partner_map.read_assigned") ? safeFetch<MapAssignment | null>("syncfield/foreman/map-assignment", null) : null,
    permissions.includes("partner_jsa.read_own") ? safeFetch<DailyJsa | null>("syncfield/foreman/jsa/today", null) : null,
  ]);
  return { context, actions, compliance, foremanCrew, foremanRoster, foremanWorkOrder, mobilization, notice, mapAssignment, jsaToday };
}

async function safeFetch<T>(path: string, fallback?: T): Promise<T> {
  try {
    return await syncosFetch<T>(path);
  } catch (error) {
    if (fallback !== undefined && error instanceof Error && /404|not found/i.test(error.message)) return fallback;
    throw error;
  }
}

function renderSection(section: Section, data: PortalData, permissions: string[], itemId: string | undefined, acknowledgeNotice: () => Promise<void>, completeJsa: () => Promise<void>) {
  if (data.context?.persona === "partner_foreman" && ["company", "compliance", "workers", "worker-detail", "agreements", "agreement-detail", "vehicles"].includes(section)) {
    return <DeniedPortal message="This Partner workspace is not available to Foreman users." />;
  }
  if (data.context?.persona === "partner_foreman") {
    if (section === "dashboard") return <ForemanToday data={data} acknowledgeNotice={acknowledgeNotice} />;
    if (section === "crews" || section === "crew-detail" || section === "workforce") return <ForemanCrew data={data} />;
    if (section === "work-orders" || section === "work-order-detail") return <ForemanAssignment data={data} />;
    if (section === "field-map") return <FieldMapWorkspace data={data} />;
    if (section === "daily-jsa") return <DailyJsaWorkspace data={data} completeJsa={completeJsa} />;
    if (section === "mobilization") return <MobilizationWorkspace data={data} acknowledgeNotice={acknowledgeNotice} />;
  }

  switch (section) {
    case "dashboard":
      return <AdminDashboard data={data} acknowledgeNotice={acknowledgeNotice} />;
    case "company":
      return <CompanyWorkspace data={data} permissions={permissions} />;
    case "compliance":
      return <ComplianceWorkspace data={data} permissions={permissions} />;
    case "workforce":
      return <WorkforceWorkspace data={data} />;
    case "workers":
      return <WorkersWorkspace data={data} />;
    case "worker-detail":
      return <WorkerDetail data={data} itemId={itemId} />;
    case "crews":
      return <CrewsWorkspace data={data} />;
    case "crew-detail":
      return <CrewDetail data={data} itemId={itemId} />;
    case "agreements":
      return <AgreementsWorkspace data={data} />;
    case "agreement-detail":
      return <AgreementDetail data={data} itemId={itemId} />;
    case "work-orders":
      return <WorkOrdersWorkspace data={data} />;
    case "work-order-detail":
      return <WorkOrderDetail data={data} itemId={itemId} />;
    case "vehicles":
      return <VehiclesWorkspace data={data} />;
    case "mobilization":
      return <MobilizationWorkspace data={data} acknowledgeNotice={acknowledgeNotice} />;
    case "daily-jsa":
      return <AdminJsaWorkspace data={data} />;
    case "field-map":
      return <FieldMapWorkspace data={data} />;
    default:
      return <EmptyPortal title="Workspace unavailable" body="This Partner workspace is not available." />;
  }
}

function AdminDashboard({ data, acknowledgeNotice }: { data: PortalData; acknowledgeNotice: () => Promise<void> }) {
  const assignment = data.workOrders?.[0];
  const crew = data.crews?.[0];
  const roster = crew ? data.rosterByCrew?.[str(crew.id)] ?? [] : [];
  const vehicle = data.vehicles?.[0];
  const blockers = externalBlockers(data.mobilization, data.compliance, data.notice);
  return (
    <div className="partner-stack">
      <div className="partner-dashboard-grid">
        <Panel title="Company" eyebrow={data.context?.organization.name}>
          <StatusRows rows={[
            ["Lifecycle", data.context?.organization.status],
            ["Compliance", data.compliance?.overall_status],
            ["MSA", data.agreements?.[0]?.status ? "executed" : "action_required"],
            ["Payment Setup", statusFrom(data.payment, "status")],
            ["Insurance", data.compliance?.insurance_status],
          ]} />
        </Panel>
        <Panel title="Current Assignment" eyebrow={str(assignment?.project_name) || "No active assignment"}>
          <StatusRows rows={[
            ["Work Order", str(assignment?.work_order_number) || str(assignment?.work_order_id) || "Not assigned"],
            ["Status", statusFrom(assignment, "status")],
            ["Crew", str(crew?.name) || "Not assigned"],
            ["Vehicle", str(vehicle?.equipment_name) || "Not assigned"],
            ["Mobilization", data.mobilization?.decision?.decision ?? "pending"],
            ["Production Start", data.notice?.production_start?.authorization_status ?? data.notice?.production_start_status ?? "not_authorized"],
            ["Map Package", str(assignment?.map_work_package_ref) || data.notice?.initial_map_work_package_ref || "Not issued"],
            ["Notice", data.notice?.status ?? "not_issued"],
          ]} />
        </Panel>
        <Panel title="Crew" eyebrow={str(crew?.crew_type) || "Crew"}>
          <StatusRows rows={[
            ["Target Staffing", str(crew?.target_staffing_level) || "4"],
            ["Active Staffing", String(roster.length)],
            ["Ready Workers", String(roster.length - (data.readinessByCrew?.[str(crew?.id)]?.blocker_count ?? 0))],
            ["Foreman", roster.find((worker) => str(worker.membership_role) === "foreman") ? workerName(roster.find((worker) => str(worker.membership_role) === "foreman")) : "Not assigned"],
            ["Crew Readiness", data.readinessByCrew?.[str(crew?.id)]?.overall_status ?? "not_evaluated"],
          ]} />
          <RosterStrip roster={roster} />
        </Panel>
        <Panel title="Action Required" eyebrow="Partner-safe blockers">
          <ActionList blockers={blockers} />
          <div className="partner-actions-row">
            <Link className="partner-button" href="/partner/compliance">View Compliance</Link>
            <Link className="partner-button" href="/partner/workers">Manage Workers</Link>
            <Link className="partner-button" href="/partner/mobilization">View Mobilization</Link>
            {data.notice?.id ? <button className="partner-button primary" type="button" onClick={() => void acknowledgeNotice()}>Acknowledge Notice</button> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ForemanToday({ data, acknowledgeNotice }: { data: PortalData; acknowledgeNotice: () => Promise<void> }) {
  const notice = data.notice;
  const map = data.mapAssignment?.map;
  const jsa = data.jsaToday;
  return (
    <div className="partner-field-layout">
      <section className="field-status-band" aria-label="Today assignment">
        <div>
          <p className="eyebrow">Today</p>
          <h3>{str(data.foremanWorkOrder?.project_name) || "Assigned Project"}</h3>
          <p>{str(data.foremanWorkOrder?.scope_summary) || "Current Work Order assignment"}</p>
        </div>
        <StatusPill label="Production Start" value={notice?.production_start?.authorization_status ?? "not_authorized"} />
      </section>
      <div className="partner-dashboard-grid">
        <Panel title="Start Instructions" eyebrow="Notice to Proceed">
          <StatusRows rows={[
            ["Mobilization", data.mobilization?.decision?.decision ?? "pending"],
            ["Notice", notice?.status ?? "not_issued"],
            ["Start Date", notice?.production_start_date ?? notice?.production_start?.start_date ?? "Not authorized"],
            ["Start Time", notice?.production_start_time ?? notice?.production_start?.start_time ?? "Not authorized"],
            ["Timezone", notice?.timezone ?? notice?.production_start?.timezone ?? "Not set"],
            ["Map Package", notice?.initial_map_work_package_ref ?? str(data.foremanWorkOrder?.map_work_package_ref) ?? "Not issued"],
            ["Initial Work Area", notice?.initial_work_area ?? "Not assigned"],
            ["Map Version", map?.name ? `${map.name} Rev ${map.revision_number ?? "0"}` : "Not assigned"],
            ["Daily JSA", jsa?.status === "completed" ? `complete - ${shortTime(jsa.meeting_completed_at)}` : "required"],
          ]} />
          <p className="partner-safe-text">{notice?.external_instructions || "Production entry is not available in P7. Use the authorized start instructions when issued."}</p>
          {notice?.id ? <button className="partner-button primary wide-touch" type="button" onClick={() => void acknowledgeNotice()}>Acknowledge Notice</button> : null}
          <div className="partner-actions-row">
            {map?.status === "ready" ? <Link className="partner-button wide-touch" href="/partner/field/map">Open Field Map</Link> : null}
            <Link className="partner-button wide-touch" href="/partner/jsa">{jsa?.status === "completed" ? "View Daily JSA" : "Complete JSA"}</Link>
          </div>
        </Panel>
        <Panel title="Crew" eyebrow={str(data.foremanCrew?.name)}>
          <StatusRows rows={[["Crew Readiness", data.mobilization?.overall_status ?? "not_evaluated"], ["Roster", `${data.foremanRoster?.length ?? 0} active Workers`]]} />
          <RosterList roster={data.foremanRoster ?? []} foreman />
        </Panel>
        <Panel title="Assignment" eyebrow="Work package">
          <StatusRows rows={[
            ["Work Order", str(data.foremanWorkOrder?.work_order_id) || "Not assigned"],
            ["Customer", str(data.foremanWorkOrder?.customer_name) || "Not shown"],
            ["Vehicle", vehicleLabel(data.foremanWorkOrder?.vehicle as Record<string, unknown> | undefined)],
            ["Operator", "Use assigned vehicle authorization"],
            ["SyncField", "Daily Production is not available in P8"],
          ]} />
        </Panel>
      </div>
    </div>
  );
}

function FieldMapWorkspace({ data }: { data: PortalData }) {
  const assignment = data.mapAssignment;
  if (!assignment?.map || assignment.map.status !== "ready") {
    return <EmptyPortal title="No assigned field map" body="A read-only field map appears after Sync assigns a READY Map Version to your Work Order and Crew." />;
  }
  const zones = assignment.work_zones ?? [];
  return (
    <div className="field-map-shell">
      <section className="field-map-header" aria-label="Field map context">
        <div>
          <p className="eyebrow">Read-only field map</p>
          <h3>{assignment.map.name} Rev {assignment.map.revision_number ?? 0}</h3>
          <p>{assignment.work_order?.work_order_number} · {assignment.crew?.name}</p>
        </div>
        <StatusPill label="Map" value={assignment.map.processing_status} />
      </section>
      <section className="field-map-viewer" aria-label="PDF map viewer">
        <div className="field-map-toolbar" aria-label="Map controls">
          <button className="partner-button" type="button" aria-label="Previous PDF page">Page -</button>
          <span>Page 1 / {assignment.map.page_count ?? 1}</span>
          <button className="partner-button" type="button" aria-label="Next PDF page">Page +</button>
          <button className="partner-button" type="button" aria-label="Zoom out">-</button>
          <button className="partner-button" type="button" aria-label="Zoom in">+</button>
        </div>
        <div className="field-map-canvas" role="img" aria-label={`Read-only PDF map ${assignment.map.name} revision ${assignment.map.revision_number ?? 0}`}>
          <span>{assignment.map.customer_document_number || assignment.map.name}</span>
          <strong>PDF page preview</strong>
          <small>Pan and zoom target area. Production marks and annotations are not available in P8.</small>
        </div>
      </section>
      <Panel title="Work Zones" eyebrow="Navigation bookmarks">
        <div className="partner-actions-row">
          {zones.map((zone) => <button className="partner-button" type="button" key={zone.id}>Jump to {zone.name} · Pg {zone.page_number}</button>)}
          {!zones.length ? <span className="partner-safe-text">No Work Zones assigned.</span> : null}
        </div>
      </Panel>
      <Panel title="Field Cache" eyebrow="Online only in P8">
        <StatusRows rows={[["State", "available_online"], ["Offline Map Cache", "Future P9 prerequisite"], ["Production Entry", "not_available_in_p8"]]} />
      </Panel>
    </div>
  );
}

function DailyJsaWorkspace({ data, completeJsa }: { data: PortalData; completeJsa: () => Promise<void> }) {
  const jsa = data.jsaToday;
  return (
    <div className="partner-stack">
      <Panel title="Daily JSA" eyebrow={jsa?.work_date || "Today"}>
        <StatusRows rows={[
          ["Status", jsa?.status === "completed" ? "complete" : "required"],
          ["Work Area", jsa?.work_location || data.mapAssignment?.work_order?.primary_work_area || data.notice?.initial_work_area || "Assigned work area"],
          ["Map", data.mapAssignment?.map?.name ? `${data.mapAssignment.map.name} Rev ${data.mapAssignment.map.revision_number ?? 0}` : "Not assigned"],
          ["Completed", jsa?.meeting_completed_at ? shortTime(jsa.meeting_completed_at) : "Not completed"],
          ["Production", "not_available_in_p8"],
        ]} />
        {jsa?.status === "completed" ? <p className="partner-safe-text">Foreman attestation is complete for today. This does not create production, QC, billable, settlement, payable, or payment records.</p> : (
          <button className="partner-button primary wide-touch" type="button" onClick={() => void completeJsa()}>Complete JSA</button>
        )}
      </Panel>
      <Panel title="Hazards and Controls" eyebrow="Tailgate review">
        <StatusRows rows={[
          ["Hazards", (jsa?.hazards ?? ["traffic", "overhead_utilities"]).join(", ")],
          ["Controls", (jsa?.controls ?? ["ppe_reviewed", "emergency_procedures_reviewed", "stop_work_authority_reviewed"]).join(", ")],
          ["Certification", jsa?.foreman_certified ? "Foreman certified" : "Required before completion"],
        ]} />
      </Panel>
      <Panel title="Crew Attendance" eyebrow="Resolved from P4 Crew membership">
        <RosterList roster={data.foremanRoster ?? []} foreman />
      </Panel>
    </div>
  );
}

function AdminJsaWorkspace({ data }: { data: PortalData }) {
  const jsas = data.jsas ?? [];
  return (
    <Panel title="Daily JSAs" eyebrow="Partner Admin-safe history">
      <div className="partner-card-grid">
        {jsas.map((jsa) => (
          <RecordCard key={jsa.id} title={`${jsa.work_date || "Work date"} · ${jsa.work_location || "Work area"}`} status={jsa.status}>
            <StatusRows rows={[["Crew", str(jsa.crew_name)], ["Foreman", str(jsa.foreman_name)], ["Completed", shortTime(jsa.meeting_completed_at)], ["Hazards", (jsa.hazards ?? []).join(", ") || "Not set"]]} />
          </RecordCard>
        ))}
      </div>
      {!jsas.length ? <EmptyPortal title="No Daily JSAs" body="Completed Foreman safety attestations appear here." /> : null}
    </Panel>
  );
}

function CompanyWorkspace({ data, permissions }: { data: PortalData; permissions: string[] }) {
  if (!data.company) return <EmptyPortal title="Company profile not submitted" body="Submit the company profile through the approved Partner compliance workflow." />;
  return (
    <Panel title="Company" eyebrow="Partner Admin">
      <StatusRows rows={[
        ["Legal Business Name", str(data.company.legal_business_name)],
        ["DBA", str(data.company.dba_name) || "None"],
        ["Entity Type", str(data.company.entity_type)],
        ["State of Formation", str(data.company.state_of_formation)],
        ["Business Contact", contactLine(data.company, "primary")],
        ["Compliance Contact", contactLine(data.company, "compliance")],
        ["Settlement Contact", contactLine(data.company, "settlement")],
        ["Profile Review", str(data.company.status)],
        ["Correction Reason", str(data.company.external_return_reason) || "None"],
      ]} />
      <ActionPermission permission="partner_compliance.profile.submit" permissions={permissions} label="Profile edits use the certified P3 submission workflow." />
    </Panel>
  );
}

function ComplianceWorkspace({ data, permissions }: { data: PortalData; permissions: string[] }) {
  return (
    <div className="partner-stack">
      <Panel title="Compliance Summary" eyebrow="Company readiness">
        <StatusRows rows={[
          ["Overall", data.compliance?.overall_status],
          ["Company Profile", data.compliance?.profile_status],
          ["W-9", data.compliance?.w9_status ?? statusFrom(data.tax, "status")],
          ["Payment Setup", data.compliance?.payment_status ?? statusFrom(data.payment, "status")],
          ["Insurance", data.compliance?.insurance_status],
          ["Evaluated", data.compliance?.evaluated_at],
        ]} />
        <ActionList blockers={externalBlockers(undefined, data.compliance)} />
      </Panel>
      <Panel title="Insurance" eyebrow="Structured policies">
        <div className="partner-card-grid">
          {(data.policies ?? []).map((policy) => (
            <RecordCard key={str(policy.id)} title={str(policy.policy_type)} status={str(policy.status)}>
              <StatusRows rows={[
                ["Carrier", str(policy.carrier)],
                ["Effective", str(policy.effective_date)],
                ["Expires", str(policy.expiration_date)],
                ["Additional Insured", str(policy.additional_insured_status)],
                ["Correction", str(policy.external_return_reason) || "None"],
              ]} />
            </RecordCard>
          ))}
        </div>
        {!(data.policies ?? []).length ? <EmptyPortal title="No insurance policies" body="Insurance requirements appear here after submission." /> : null}
        <ActionPermission permission="partner_compliance.insurance.submit" permissions={permissions} label="Insurance updates use the certified P3 submission workflow." />
      </Panel>
    </div>
  );
}

function WorkforceWorkspace({ data }: { data: PortalData }) {
  return (
    <div className="partner-dashboard-grid">
      <Panel title="Workers" eyebrow={`${data.workers?.length ?? 0} records`}><WorkersList workers={data.workers ?? []} /></Panel>
      <Panel title="Crews" eyebrow={`${data.crews?.length ?? 0} records`}><CrewsList data={data} /></Panel>
    </div>
  );
}

function WorkersWorkspace({ data }: { data: PortalData }) {
  return <Panel title="Workers" eyebrow="Partner Admin-safe roster"><WorkersList workers={data.workers ?? []} /></Panel>;
}

function WorkerDetail({ data, itemId }: { data: PortalData; itemId?: string }) {
  const worker = (data.workers ?? []).find((candidate) => str(candidate.id) === itemId);
  if (!worker) return <DeniedPortal message="Worker not found in your Partner organization." />;
  return (
    <Panel title={workerName(worker)} eyebrow="Worker detail">
      <StatusRows rows={[
        ["Role", str(worker.worker_role)],
        ["Status", str(worker.status)],
        ["Review", str(worker.review_status)],
        ["Reference", str(worker.partner_worker_reference)],
        ["Action", str(worker.external_return_reason) || "None"],
      ]} />
      <p className="partner-safe-text">Restricted Worker PII and full credential evidence are not rendered in the Partner Portal shell.</p>
    </Panel>
  );
}

function CrewsWorkspace({ data }: { data: PortalData }) {
  return <Panel title="Crews" eyebrow="Current Crew readiness"><CrewsList data={data} /></Panel>;
}

function CrewDetail({ data, itemId }: { data: PortalData; itemId?: string }) {
  const crew = (data.crews ?? []).find((candidate) => str(candidate.id) === itemId);
  if (!crew) return <DeniedPortal message="Crew not found in your Partner organization." />;
  return (
    <Panel title={str(crew.name)} eyebrow={str(crew.crew_type)}>
      <StatusRows rows={[
        ["Lifecycle", str(crew.lifecycle_status)],
        ["Target Staffing", str(crew.target_staffing_level)],
        ["Readiness", data.readinessByCrew?.[str(crew.id)]?.overall_status ?? "not_evaluated"],
        ["Blockers", String(data.readinessByCrew?.[str(crew.id)]?.blocker_count ?? 0)],
      ]} />
      <RosterList roster={data.rosterByCrew?.[str(crew.id)] ?? []} />
    </Panel>
  );
}

function ForemanCrew({ data }: { data: PortalData }) {
  return (
    <Panel title={str(data.foremanCrew?.name) || "Assigned Crew"} eyebrow="Foreman-safe">
      <StatusRows rows={[["Crew Type", str(data.foremanCrew?.crew_type)], ["Lifecycle", str(data.foremanCrew?.lifecycle_status)], ["Target Staffing", str(data.foremanCrew?.target_staffing_level)]]} />
      <RosterList roster={data.foremanRoster ?? []} foreman />
    </Panel>
  );
}

function AgreementsWorkspace({ data }: { data: PortalData }) {
  return (
    <Panel title="Agreements" eyebrow="Executed artifacts use P5 authorization">
      <div className="partner-card-grid">
        {(data.agreements ?? []).map((agreement) => (
          <RecordCard key={str(agreement.version_id)} title={str(agreement.contract_number) || str(agreement.name)} status={str(agreement.status)} href={`/partner/agreements/${str(agreement.version_id)}`}>
            <StatusRows rows={[["Version", str(agreement.version_number)], ["Effective", str(agreement.effective_date)], ["Artifact", "Authorized through P5 only"]]} />
          </RecordCard>
        ))}
      </div>
      {!(data.agreements ?? []).length ? <EmptyPortal title="No Agreements" body="Executed Agreements appear after Sync issues them." /> : null}
    </Panel>
  );
}

function AgreementDetail({ data, itemId }: { data: PortalData; itemId?: string }) {
  const agreement = (data.agreements ?? []).find((candidate) => str(candidate.version_id) === itemId);
  if (!agreement) return <DeniedPortal message="Agreement not found for your Partner organization." />;
  return (
    <Panel title={str(agreement.contract_number) || "Agreement"} eyebrow="Partner-safe Agreement">
      <StatusRows rows={[["Name", str(agreement.name)], ["Status", str(agreement.status)], ["Version", str(agreement.version_number)], ["Effective", str(agreement.effective_date)], ["Execution", "Secure artifact access is handled by certified P5 APIs"]]} />
    </Panel>
  );
}

function WorkOrdersWorkspace({ data }: { data: PortalData }) {
  const workOrders = data.context?.persona === "partner_foreman" && data.foremanWorkOrder ? [data.foremanWorkOrder] : data.workOrders ?? [];
  return (
    <Panel title="Work Orders" eyebrow="Partner-safe assignments">
      <div className="partner-card-grid">
        {workOrders.map((workOrder) => (
          <RecordCard key={str(workOrder.id) || str(workOrder.work_order_id)} title={str(workOrder.work_order_number) || str(workOrder.work_order_id)} status={str(workOrder.status)} href={data.context?.persona === "partner_foreman" ? "/partner/work-orders" : `/partner/work-orders/${str(workOrder.id)}`}>
            <StatusRows rows={[
              ["Project", str(workOrder.project_name)],
              ["Customer", str(workOrder.customer_name)],
              ["Scope", str(workOrder.scope_summary)],
              ["Map Package", str(workOrder.map_work_package_ref)],
              ...(data.context?.persona === "partner_foreman" ? [] : [["Partner Rate", rateLabel(workOrder.partner_rate as Record<string, unknown> | undefined)] as [string, string]]),
            ]} />
          </RecordCard>
        ))}
      </div>
      {!workOrders.length ? <EmptyPortal title="No Work Orders" body="Work Orders appear after assignment." /> : null}
    </Panel>
  );
}

function WorkOrderDetail({ data, itemId }: { data: PortalData; itemId?: string }) {
  const workOrder = (data.workOrders ?? []).find((candidate) => str(candidate.id) === itemId);
  if (!workOrder) return <DeniedPortal message="Work Order not found for your Partner organization." />;
  return <WorkOrderSummary workOrder={workOrder} foreman={false} />;
}

function ForemanAssignment({ data }: { data: PortalData }) {
  if (!data.foremanWorkOrder) return <EmptyPortal title="No current assignment" body="Your current Work Order assignment appears here after Sync assigns it." />;
  return <WorkOrderSummary workOrder={data.foremanWorkOrder} foreman />;
}

function WorkOrderSummary({ workOrder, foreman }: { workOrder: WorkOrder; foreman: boolean }) {
  return (
    <Panel title={str(workOrder.work_order_number) || str(workOrder.work_order_id) || "Work Order"} eyebrow={foreman ? "Foreman assignment" : "Partner Admin"}>
      <StatusRows rows={[
        ["Project", str(workOrder.project_name)],
        ["Customer", str(workOrder.customer_name)],
        ["Status", str(workOrder.status)],
        ["Scope", str(workOrder.scope_summary)],
        ["Map Package", str(workOrder.map_work_package_ref)],
        ["Vehicle", vehicleLabel(workOrder.vehicle as Record<string, unknown> | undefined)],
        ...(foreman ? [] : [["Partner Rate", rateLabel(workOrder.partner_rate as Record<string, unknown> | undefined)] as [string, string]]),
      ]} />
      <p className="partner-safe-text">Read-only map/work-package viewing is prepared here. P8 will add SyncField production entry after canonical map document/version and production records exist.</p>
    </Panel>
  );
}

function VehiclesWorkspace({ data }: { data: PortalData }) {
  return (
    <Panel title="Vehicles" eyebrow="Assigned equipment">
      <div className="partner-card-grid">
        {(data.vehicles ?? []).map((vehicle) => (
          <RecordCard key={str(vehicle.id)} title={str(vehicle.equipment_name) || str(vehicle.equipment_id)} status={str(vehicle.status)}>
            <StatusRows rows={[
              ["Type", str(vehicle.equipment_type)],
              ["Crew", str(vehicle.crew_id)],
              ["Custody Start", str(vehicle.partner_custody_start_date)],
              ["Return", str(vehicle.partner_return_release_date) || "Not returned"],
              ["Allocation Preview", vehicle.daily_allocation_amount ? `${str(vehicle.currency)} ${str(vehicle.daily_allocation_amount)}` : "Not shown"],
              ["Condition", str(vehicle.odometer_at_assignment) ? "Recorded" : "Pending"],
            ]} />
          </RecordCard>
        ))}
      </div>
      {!(data.vehicles ?? []).length ? <EmptyPortal title="No assigned vehicles" body="Vehicle assignments appear after Sync assigns equipment." /> : null}
    </Panel>
  );
}

function MobilizationWorkspace({ data, acknowledgeNotice }: { data: PortalData; acknowledgeNotice: () => Promise<void> }) {
  const readiness = data.mobilization;
  const notice = data.notice;
  return (
    <div className="partner-stack">
      <div className="mobilization-lanes" aria-label="Mobilization states">
        <Panel title="Readiness" eyebrow="Derived evaluation">
          <StatusRows rows={[["Status", readiness?.overall_status ?? "not_evaluated"], ["Passed Checks", String(readiness?.passed_check_count ?? 0)], ["Blockers", String(readiness?.blocker_count ?? 0)], ["Warnings", String(readiness?.warning_count ?? 0)]]} />
        </Panel>
        <Panel title="Approval to Mobilize" eyebrow="Internal Sync decision">
          <StatusRows rows={[["Decision", readiness?.decision?.decision ?? "pending"], ["Conditions", readiness?.decision?.external_conditions?.join("; ") || "None"], ["Expires", readiness?.decision?.expires_at ?? "No expiration"], ["Revocation", readiness?.decision?.revocation_reason ?? "None"]]} />
        </Panel>
        <Panel title="Production Start" eyebrow="Operational authorization">
          <StatusRows rows={[["Authorization", notice?.production_start?.authorization_status ?? notice?.production_start_status ?? "not_authorized"], ["Start Date", notice?.production_start_date ?? notice?.production_start?.start_date ?? "Not authorized"], ["Start Time", notice?.production_start_time ?? notice?.production_start?.start_time ?? "Not authorized"], ["Timezone", notice?.timezone ?? notice?.production_start?.timezone ?? "Not set"]]} />
        </Panel>
      </div>
      <Panel title="Partner-Safe Blockers and Warnings" eyebrow="No internal notes">
        <ActionList blockers={externalBlockers(readiness, data.compliance, notice)} />
        <WarningsList warnings={readiness?.warnings ?? []} />
      </Panel>
      <Panel title="Notice to Proceed" eyebrow={notice?.notice_number ?? "Not issued"}>
        <StatusRows rows={[
          ["Version", notice?.version_number ? String(notice.version_number) : "None"],
          ["Status", notice?.status ?? "not_issued"],
          ["Map Package", notice?.initial_map_work_package_ref ?? "Not issued"],
          ["Initial Work Area", notice?.initial_work_area ?? "Not assigned"],
          ["Instructions", notice?.external_instructions ?? "None issued"],
          ["Conditions", notice?.external_conditions?.join("; ") || "None"],
        ]} />
        {notice?.id ? <button className="partner-button primary" type="button" onClick={() => void acknowledgeNotice()}>Acknowledge Notice</button> : null}
      </Panel>
    </div>
  );
}

function WorkersList({ workers }: { workers: Worker[] }) {
  if (!workers.length) return <EmptyPortal title="No Workers" body="Workers appear after they are added through P4." />;
  return (
    <div className="partner-list">
      {workers.map((worker) => (
        <Link className="partner-list-row" key={str(worker.id)} href={`/partner/workers/${str(worker.id)}`}>
          <Avatar name={workerName(worker)} status={str(worker.status)} />
          <span><strong>{workerName(worker)}</strong><small>{str(worker.worker_role) || "Worker"} · {str(worker.review_status) || str(worker.status)}</small></span>
          <StatusPill label="Readiness" value={str(worker.review_status) || str(worker.status)} />
        </Link>
      ))}
    </div>
  );
}

function CrewsList({ data }: { data: PortalData }) {
  if (!(data.crews ?? []).length) return <EmptyPortal title="No Crews" body="Crews appear after they are created through P4." />;
  return (
    <div className="partner-card-grid">
      {(data.crews ?? []).map((crew) => (
        <RecordCard key={str(crew.id)} title={str(crew.name)} status={data.readinessByCrew?.[str(crew.id)]?.overall_status ?? str(crew.lifecycle_status)} href={`/partner/crews/${str(crew.id)}`}>
          <StatusRows rows={[["Type", str(crew.crew_type)], ["Target Staffing", str(crew.target_staffing_level)], ["Active Staffing", String(data.rosterByCrew?.[str(crew.id)]?.length ?? 0)], ["Blockers", String(data.readinessByCrew?.[str(crew.id)]?.blocker_count ?? 0)]]} />
        </RecordCard>
      ))}
    </div>
  );
}

function RosterStrip({ roster }: { roster: Worker[] }) {
  if (!roster.length) return null;
  return <div className="roster-strip">{roster.slice(0, 6).map((worker) => <Avatar key={str(worker.id)} name={workerName(worker)} status={str(worker.headshot_status) || str(worker.status)} />)}</div>;
}

function RosterList({ roster, foreman = false }: { roster: Worker[]; foreman?: boolean }) {
  if (!roster.length) return <EmptyPortal title="No active Crew members" body="Crew roster appears after membership is assigned." />;
  return (
    <div className="partner-list">
      {roster.map((worker) => (
        <div className="partner-list-row static" key={str(worker.id)}>
          <Avatar name={workerName(worker)} status={str(worker.headshot_status) || str(worker.status)} />
          <span><strong>{workerName(worker)}</strong><small>{str(worker.membership_role) || str(worker.worker_role)} · {str(worker.headshot_status) || "headshot pending"}</small></span>
          <StatusPill label={foreman ? "Safe status" : "Readiness"} value={str(worker.status) || str(worker.review_status)} />
        </div>
      ))}
    </div>
  );
}

function Panel({ title, eyebrow, children }: { title: string; eyebrow?: string | null; children: ReactNode }) {
  return <section className="partner-panel"><p className="eyebrow">{eyebrow}</p><h3>{title}</h3>{children}</section>;
}

function RecordCard({ title, status, href, children }: { title: string; status?: string; href?: string; children: React.ReactNode }) {
  const body = <><div className="record-card-header"><h4>{title || "Record"}</h4><StatusPill label="Status" value={status} /></div>{children}</>;
  return href ? <Link className="partner-record-card" href={href}>{body}</Link> : <div className="partner-record-card">{body}</div>;
}

function StatusRows({ rows }: { rows: Array<[string, string | undefined | null]> }) {
  return <dl className="partner-status-rows">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not set"}</dd></div>)}</dl>;
}

function StatusPill({ label, value }: { label: string; value?: string | null }) {
  const status = (value || "unknown").replace(/_/g, " ");
  return <span className={`partner-status-pill ${statusClass(status)}`} aria-label={`${label}: ${status}`}>{status}</span>;
}

function ActionList({ blockers }: { blockers: Array<Record<string, unknown>> }) {
  if (!blockers.length) return <p className="partner-safe-text">No Partner-facing blockers.</p>;
  return <ul className="partner-action-list">{blockers.map((blocker, index) => <li key={`${str(blocker.requirement_code) || str(blocker.key)}-${index}`}><strong>{str(blocker.requirement_code) || str(blocker.key) || "action_required"}</strong><span>{str(blocker.external_detail) || str(blocker.message) || "Partner action is required."}</span></li>)}</ul>;
}

function WarningsList({ warnings }: { warnings: Array<Record<string, unknown>> }) {
  if (!warnings.length) return null;
  return <ul className="partner-warning-list">{warnings.map((warning, index) => <li key={`${str(warning.requirement_code)}-${index}`}>{str(warning.external_detail) || str(warning.requirement_code)}</li>)}</ul>;
}

function ActionPermission({ permission, permissions, label }: { permission: string; permissions: string[]; label: string }) {
  if (!permissions.includes(permission)) return null;
  return <p className="partner-safe-text">{label}</p>;
}

function Avatar({ name, status }: { name: string; status?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "W";
  return <span className={`partner-avatar ${statusClass(status)}`} aria-label={`${name} headshot status ${status || "unknown"}`}>{initials}</span>;
}

function LoadingPortal() {
  return <div className="partner-panel loading-state" role="status" aria-live="polite">Loading Partner Portal...</div>;
}

function DeniedPortal({ message }: { message?: string }) {
  return <div className="partner-panel error-state"><h2>Access denied</h2><p>{message || "Your current SyncOS session is not authorized for this Partner workspace."}</p></div>;
}

function ErrorPortal({ message }: { message?: string }) {
  return <div className="partner-panel error-state"><h2>Unable to load Partner Portal</h2><p>{message || "The Partner Portal API request failed."}</p></div>;
}

function EmptyPortal({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{body}</p></div>;
}

function activeSectionLabel(section: Section, persona?: Persona) {
  if (persona === "partner_foreman") {
    if (section === "dashboard") return "Today";
    if (section === "crews" || section === "crew-detail" || section === "workforce") return "Crew";
    if (section === "work-orders" || section === "work-order-detail") return "Assignment";
    if (section === "field-map") return "Field Map";
    if (section === "daily-jsa") return "Daily JSA";
    return "Mobilization";
  }
  if (section === "worker-detail") return "Workers";
  if (section === "crew-detail") return "Crews";
  if (section === "agreement-detail") return "Agreements";
  if (section === "work-order-detail") return "Work Orders";
  const labels: Record<string, string> = { dashboard: "Dashboard", company: "Company", compliance: "Compliance", workforce: "Workers", workers: "Workers", crews: "Crews", agreements: "Agreements", "work-orders": "Work Orders", vehicles: "Vehicles", mobilization: "Mobilization", "field-map": "Field Map", "daily-jsa": "Daily JSA" };
  return labels[section] ?? "Dashboard";
}

function pageTitle(section: Section, persona?: Persona) {
  if (persona === "partner_foreman" && section === "dashboard") return "Today";
  if (section === "work-order-detail") return persona === "partner_foreman" ? "Assignment" : "Work Order";
  if (section === "worker-detail") return "Worker";
  if (section === "crew-detail") return "Crew";
  if (section === "agreement-detail") return "Agreement";
  if (section === "field-map") return "Field Map";
  if (section === "daily-jsa") return "Daily JSA";
  return activeSectionLabel(section, persona);
}

function personaLabel(persona?: Persona) {
  if (persona === "partner_foreman") return "Partner Foreman";
  if (persona === "partner_admin") return "Partner Admin";
  return "Partner";
}

function externalBlockers(readiness?: Readiness | null, compliance?: ComplianceSummary, notice?: Notice | null) {
  const blockers = [...(readiness?.blockers ?? [])];
  for (const blocker of compliance?.blockers ?? []) blockers.push(blocker);
  for (const category of compliance?.blocker_categories ?? []) blockers.push({ key: category, message: `${category.replace(/_/g, " ")} requires attention` });
  const productionStartStatus = notice?.production_start?.authorization_status ?? notice?.production_start_status;
  if (!productionStartStatus || ["not_authorized", "held", "revoked"].includes(productionStartStatus)) blockers.push({ key: "production_start_not_authorized", message: "Production start is not yet authorized." });
  return blockers;
}

function statusFrom(row: Record<string, unknown> | null | undefined, key: string) {
  return str(row?.[key]) || "not_started";
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function workerName(worker?: Record<string, unknown>) {
  if (!worker) return "Worker";
  return [worker.first_name, worker.last_name].map(str).filter(Boolean).join(" ") || str(worker.display_name) || "Worker";
}

function contactLine(row: Record<string, unknown>, prefix: "primary" | "compliance" | "settlement") {
  return [row[`${prefix}_contact_name`], row[`${prefix}_contact_email`], row[`${prefix}_contact_phone`]].map(str).filter(Boolean).join(" · ");
}

function vehicleLabel(vehicle?: Record<string, unknown>) {
  if (!vehicle) return "Not assigned";
  return [vehicle.equipment_name, vehicle.equipment_type].map(str).filter(Boolean).join(" · ") || str(vehicle.assignment_id) || "Assigned vehicle";
}

function shortTime(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function rateLabel(rate?: Record<string, unknown>) {
  if (!rate?.amount) return "Not shown";
  return `${str(rate.amount)} / ${str(rate.unit) || "unit"}`;
}

function statusClass(status?: string | null) {
  const value = (status ?? "").toLowerCase();
  if (/ready|active|approved|authorized|executed|verified|current|acknowledged/.test(value)) return "ok";
  if (/conditional|warning|pending|submitted|review|scheduled/.test(value)) return "warn";
  if (/blocked|hold|held|revoked|rejected|expired|inactive|suspended|missing|denied/.test(value)) return "bad";
  return "neutral";
}
