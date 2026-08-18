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
  | "daily-jsa"
  | "daily-production"
  | "review-day"
  | "customer-qc"
  | "corrections";

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
type ProductionCode = { id?: string; code?: string; description?: string; unit_of_measure?: string; location_type?: string };
type ProductionRecord = { id?: string; production_code_id?: string; code?: string; description?: string; reported_quantity?: number; unit_of_measure?: string; location_type?: string; status?: string; asset_identifier?: string; from_asset_identifier?: string; to_asset_identifier?: string; map_page?: number; notes?: string; locked?: boolean };
type DailyProduction = {
  id?: string;
  status?: string;
  work_date?: string;
  work_order_version_id?: string;
  revision_number?: number;
  gate?: { allowed?: boolean; blockers?: string[] };
  records?: ProductionRecord[];
  annotations?: Array<Record<string, unknown>>;
  totals?: { by_code?: Array<{ code?: string; description?: string; quantity?: number; unit?: string; count?: number }>; record_count?: number; status_counts?: Record<string, number> };
  annotation_count?: number;
  submitted_at?: string;
};
type CustomerQcDecision = {
  id?: string;
  production_record_id?: string;
  decision?: string;
  reported_quantity?: number;
  customer_accepted_quantity?: number | null;
  unit_of_measure?: string;
  code?: string;
  description?: string;
  customer_reason_code?: string | null;
  customer_comments?: string | null;
};
type CustomerCorrection = {
  id?: string;
  correction_type?: string;
  status?: string;
  partner_safe_instructions?: string;
  customer_reason?: string;
  due_date?: string | null;
  allowed_fields?: string[];
  production_record_id?: string;
};
type CustomerQcItem = {
  report_id?: string;
  work_date?: string;
  revision_number?: number;
  completeness_status?: string;
  report_outcome?: string;
  work_order_number?: string;
  crew_name?: string;
  cycle_id?: string;
  cycle_number?: number | null;
  cycle_status?: string | null;
  qc_authority_name?: string | null;
  decision?: CustomerQcDecision | null;
  correction?: CustomerCorrection | null;
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
  productionToday?: DailyProduction | null;
  productionCodes?: ProductionCode[];
  productionReports?: DailyProduction[];
  customerQcReports?: CustomerQcItem[];
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
  ["Customer QC", "/partner/customer-qc"],
] as const;

const foremanNav = [
  ["Today", "/partner"],
  ["Crew", "/partner/crews"],
  ["Assignment", "/partner/work-orders"],
  ["Field Map", "/partner/field/map"],
  ["Daily JSA", "/partner/jsa"],
  ["Production", "/partner/production"],
  ["Review Day", "/partner/production/review"],
  ["Corrections", "/partner/corrections"],
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
          {persona === "partner_admin" ? <Link className={section === "daily-production" ? "partner-nav-link active" : "partner-nav-link"} href="/partner/production">Daily Production</Link> : null}
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
  const [compliance, company, tax, payment, policies, workers, crews, agreements, workOrders, vehicles, mapAssignment, jsas, productionReports, customerQcReports] = await Promise.all([
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
    permissions.includes("partner_daily_production.read_org") ? safeFetch<DailyProduction[]>("syncfield/partner/production", []) : [],
    permissions.includes("partner_customer_qc.read") ? safeFetch<CustomerQcItem[]>("syncfield/partner/customer-qc", []) : [],
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
  return { context, actions, compliance, company, tax, payment, policies, workers, crews, rosterByCrew, readinessByCrew, agreements, workOrders, vehicles, mobilization, notice, mapAssignment, jsas, productionReports, customerQcReports };
}

async function loadForeman(context: PartnerContext, actions?: PartnerActions): Promise<PortalData> {
  const permissions = readPermissions();
  const [compliance, foremanCrew, foremanRoster, foremanWorkOrder, mobilization, notice, mapAssignment, jsaToday, productionToday, productionCodes, customerQcReports] = await Promise.all([
    safeFetch<ComplianceSummary>("partner-compliance/me/summary"),
    safeFetch<Crew | null>("partner-workforce/foreman/crew", null),
    safeFetch<Worker[]>("partner-workforce/foreman/crew/roster", []),
    safeFetch<WorkOrder | null>("partner-agreements/foreman/work-order", null),
    safeFetch<Readiness | null>("partner-mobilization/foreman/readiness", null),
    safeFetch<Notice | null>("partner-mobilization/foreman/notice", null),
    permissions.includes("partner_map.read_assigned") ? safeFetch<MapAssignment | null>("syncfield/foreman/map-assignment", null) : null,
    permissions.includes("partner_jsa.read_own") ? safeFetch<DailyJsa | null>("syncfield/foreman/jsa/today", null) : null,
    permissions.includes("partner_daily_production.read") ? safeFetch<DailyProduction | null>("syncfield/foreman/production/today", null) : null,
    permissions.includes("partner_daily_production.read") ? safeFetch<ProductionCode[]>("syncfield/foreman/production/codes", []) : [],
    permissions.includes("partner_customer_qc.read_own") ? safeFetch<CustomerQcItem[]>("syncfield/foreman/customer-qc", []) : [],
  ]);
  return { context, actions, compliance, foremanCrew, foremanRoster, foremanWorkOrder, mobilization, notice, mapAssignment, jsaToday, productionToday, productionCodes, customerQcReports };
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
    if (section === "daily-production") return <DailyProductionWorkspace data={data} />;
    if (section === "review-day") return <ReviewDayWorkspace data={data} />;
    if (section === "customer-qc" || section === "corrections") return <ForemanCorrectionsWorkspace data={data} />;
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
    case "daily-production":
    case "review-day":
      return <AdminProductionWorkspace data={data} />;
    case "customer-qc":
    case "corrections":
      return <CustomerQcWorkspace data={data} />;
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

function DailyProductionWorkspace({ data }: { data: PortalData }) {
  const report = data.productionToday;
  const blockers = report?.gate?.blockers ?? [];
  const codes = data.productionCodes ?? [];
  const queue = useFieldProductionQueue(data);
  const fiber = codes.find((code) => code.code === "FIBER") ?? codes.find((code) => code.location_type === "route");
  const transfer = codes.find((code) => code.code === "TRANSFER") ?? codes.find((code) => code.location_type === "asset");
  const labor = codes.find((code) => code.code === "LABOR") ?? codes.find((code) => code.location_type === "daily");
  const localRecords = localProductionRecords(queue.mutations, codes);
  const visibleRecords = [...(report?.records ?? []), ...localRecords];
  const visibleTotals = mergeProductionTotals(report?.totals, localRecords);
  const visibleAnnotationCount = (report?.annotation_count ?? 0) + localRecords.filter((record) => record.location_type !== "daily").length;
  const [error, setError] = useState<string | null>(null);

  async function quickCreate(kind: "asset" | "route" | "daily") {
    const code = kind === "asset" ? transfer : kind === "route" ? fiber : labor;
    if (!code?.id) return;
    const mutation = {
      client_mutation_id: crypto.randomUUID(),
      work_date: report?.work_date,
      production_code_id: code.id,
      location_type: kind,
      reported_quantity: kind === "route" ? 141 : 1,
      status: "complete",
      map_page: 1,
      asset_type: "pole",
      asset_identifier: "Pole 12301",
      from_asset_identifier: "Pole 12301",
      to_asset_identifier: "Pole 12312",
      x_ratio: 0.42,
      y_ratio: 0.48,
      start_x_ratio: 0.42,
      start_y_ratio: 0.48,
      end_x_ratio: 0.66,
      end_y_ratio: 0.52,
      notes: `${kind} field entry`,
    };
    setError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queue.enqueue({ operation: "CREATE_PRODUCTION", payload: mutation });
      return;
    }
    try {
      await syncosFetch("syncfield/foreman/production/records", { method: "POST", body: mutation });
      location.reload();
    } catch (caught) {
      if (isTransientNetworkError(caught)) {
        await queue.enqueue({ operation: "CREATE_PRODUCTION", payload: mutation });
        return;
      }
      setError(caught instanceof Error ? safeSyncError(caught.message) : "Production save failed.");
    }
  }
  return (
    <div className="partner-stack">
      <Panel title="Daily Production" eyebrow={report?.work_date || "Today"}>
        <StatusRows rows={[
          ["Report", report?.status ?? "not_started"],
          ["Gate", blockers.length ? blockers.join(", ") : "ready"],
          ["Sync", queue.label],
          ["Map Revision", data.mapAssignment?.map?.revision_number === undefined ? "Not assigned" : `Rev ${data.mapAssignment.map.revision_number}`],
          ["Daily JSA", data.jsaToday?.status ?? "required"],
        ]} />
        {error ? <p className="partner-safe-text error-text">{error}</p> : null}
        {queue.failedMessages.length ? <SyncFailureList messages={queue.failedMessages} onRetry={() => void queue.replay()} /> : null}
        <div className="field-action-bar">
          <button className="partner-button primary wide-touch" type="button" onClick={() => void quickCreate("asset")}>+ Asset</button>
          <button className="partner-button primary wide-touch" type="button" onClick={() => void quickCreate("route")}>+ Route</button>
          <button className="partner-button wide-touch" type="button" onClick={() => void quickCreate("daily")}>+ Daily</button>
          <Link className="partner-button wide-touch" href="/partner/production/review">Review Day</Link>
        </div>
      </Panel>
      <Panel title="Today's Production" eyebrow={`${visibleRecords.length} records`}>
        <ProductionList records={visibleRecords} />
      </Panel>
      <Panel title="Daily Totals" eyebrow="Derived from ProductionRecords">
        <TotalsView totals={visibleTotals} annotationCount={visibleAnnotationCount} />
      </Panel>
    </div>
  );
}

function ReviewDayWorkspace({ data }: { data: PortalData }) {
  const report = data.productionToday;
  const queue = useFieldProductionQueue(data);
  const unsynced = queue.unsyncedCount;
  async function submitDay() {
    if (unsynced) return;
    await syncosFetch("syncfield/foreman/production/review-day/submit", { method: "POST", body: { work_date: report?.work_date, client_mutation_id: crypto.randomUUID(), general_notes: "Foreman reviewed daily production." } });
    location.reload();
  }
  return (
    <div className="partner-stack">
      <Panel title="Review Day" eyebrow={report?.work_date || "Today"}>
        <StatusRows rows={[
          ["Report", report?.status ?? "not_started"],
          ["Daily JSA", data.jsaToday?.status ?? "required"],
          ["Map Revision", data.mapAssignment?.map?.revision_number === undefined ? "Not assigned" : `Rev ${data.mapAssignment.map.revision_number}`],
          ["Record Count", String(report?.totals?.record_count ?? 0)],
          ["Map Annotation Count", String(report?.annotation_count ?? 0)],
          ["Unsynced Mutations", String(unsynced)],
          ["Sync", queue.label],
          ["Submitted", report?.submitted_at ?? "Not submitted"],
        ]} />
        {queue.failedMessages.length ? <SyncFailureList messages={queue.failedMessages} onRetry={() => void queue.replay()} /> : null}
        <button className="partner-button primary wide-touch" type="button" disabled={Boolean(unsynced) || report?.status === "submitted"} onClick={() => void submitDay()}>
          Submit Daily Production
        </button>
        {unsynced ? <p className="partner-safe-text">Submission disabled: sync unsynced field mutations first.</p> : null}
      </Panel>
      <Panel title="Daily Totals" eyebrow="No billing calculation">
        <TotalsView totals={report?.totals} annotationCount={report?.annotation_count ?? 0} />
      </Panel>
      <Panel title="Production Records" eyebrow="Submitted records become read-only">
        <ProductionList records={report?.records ?? []} />
      </Panel>
    </div>
  );
}

function AdminProductionWorkspace({ data }: { data: PortalData }) {
  return (
    <Panel title="Daily Production" eyebrow="Partner Admin-safe">
      <div className="partner-card-grid">
        {(data.productionReports ?? []).map((report) => (
          <RecordCard key={report.id} title={report.work_date || "Work date"} status={report.status}>
            <StatusRows rows={[["Work Order", str(report.work_order_version_id)], ["Submitted", report.submitted_at ?? "Not submitted"], ["Revision", str(report.revision_number) || "1"]]} />
          </RecordCard>
        ))}
      </div>
      {!(data.productionReports ?? []).length ? <EmptyPortal title="No Daily Production" body="Draft and submitted field reports appear here after Foreman entry." /> : null}
    </Panel>
  );
}

function CustomerQcWorkspace({ data }: { data: PortalData }) {
  const reports = data.customerQcReports ?? [];
  return (
    <div className="partner-stack">
      <Panel title="Customer QC" eyebrow="Customer authority decisions">
        <div className="partner-card-grid">
          {reports.map((report) => (
            <RecordCard key={`${report.report_id}-${report.cycle_id ?? "no-cycle"}-${report.decision?.id ?? "no-decision"}`} title={`${report.work_order_number || "Work Order"} · ${report.work_date || "Work date"}`} status={report.report_outcome}>
              <StatusRows rows={[
                ["Crew", report.crew_name],
                ["Completeness", report.completeness_status],
                ["Submitted Revision", str(report.revision_number)],
                ["Customer Outcome", report.report_outcome],
                ["QC Authority", report.qc_authority_name || "Not assigned"],
                ["Decision", report.decision?.decision || "Pending"],
                ["Accepted Quantity", report.decision?.customer_accepted_quantity === null || report.decision?.customer_accepted_quantity === undefined ? "Not set" : `${report.decision.customer_accepted_quantity} ${report.decision.unit_of_measure ?? ""}`],
              ]} />
            </RecordCard>
          ))}
        </div>
        {!reports.length ? <EmptyPortal title="No Customer QC decisions" body="Customer QC outcomes appear here after Sync records decisions from the configured QC authority." /> : null}
      </Panel>
      <Panel title="Correction History" eyebrow="Partner-safe relay">
        <CorrectionList reports={reports} />
      </Panel>
    </div>
  );
}

function ForemanCorrectionsWorkspace({ data }: { data: PortalData }) {
  const reports = data.customerQcReports ?? [];
  return (
    <div className="partner-stack">
      <section className="field-status-band" aria-label="Customer correction status">
        <div>
          <p className="eyebrow">Corrections</p>
          <h3>{str(data.foremanWorkOrder?.work_order_number) || "Assigned Work Order"}</h3>
          <p>Customer decisions and correction instructions for your assigned Crew.</p>
        </div>
        <StatusPill label="Open" value={String(openCorrections(reports).length)} />
      </section>
      <Panel title="Corrections Required" eyebrow="Customer QC relay">
        <CorrectionList reports={reports} field />
      </Panel>
      <Panel title="Customer QC Status" eyebrow="Own Crew">
        <div className="partner-card-grid">
          {reports.map((report) => (
            <RecordCard key={`${report.report_id}-${report.cycle_id ?? "no-cycle"}-${report.decision?.id ?? "no-decision"}`} title={`${report.work_date || "Work date"} · Rev ${report.revision_number ?? 1}`} status={report.report_outcome}>
              <StatusRows rows={[
                ["Work Order", report.work_order_number],
                ["Completeness", report.completeness_status],
                ["Customer Outcome", report.report_outcome],
                ["QC Authority", report.qc_authority_name || "Not assigned"],
                ["Decision", report.decision?.decision || "Pending"],
              ]} />
            </RecordCard>
          ))}
        </div>
        {!reports.length ? <EmptyPortal title="No Customer QC status" body="Customer decisions for your Crew appear after Sync records them from the QC authority." /> : null}
      </Panel>
    </div>
  );
}

function CorrectionList({ reports, field = false }: { reports: CustomerQcItem[]; field?: boolean }) {
  const corrections = openCorrections(reports);
  if (!corrections.length) return <EmptyPortal title="No open corrections" body="Correction-required Customer decisions appear here with Partner-safe instructions." />;
  return (
    <div className="partner-card-grid">
      {corrections.map(({ report, correction }) => (
        <RecordCard key={correction.id} title={`${report.work_order_number || "Work Order"} · ${correction.correction_type || "Correction"}`} status={correction.status}>
          <StatusRows rows={[
            ["Work Date", report.work_date],
            ["QC Cycle", report.cycle_number === undefined || report.cycle_number === null ? "Current" : `Cycle ${report.cycle_number}`],
            ["QC Authority", report.qc_authority_name || "Not assigned"],
            ["Production", report.decision?.description || report.decision?.code],
            ["Reported Quantity", report.decision?.reported_quantity === undefined ? "Not set" : `${report.decision.reported_quantity} ${report.decision.unit_of_measure ?? ""}`],
            ["Customer Instruction", correction.partner_safe_instructions || correction.customer_reason],
            ["Allowed Fields", (correction.allowed_fields ?? []).join(", ") || "Correction scope required"],
            ["Due", correction.due_date || "Not set"],
          ]} />
          {field ? <p className="partner-safe-text">Save Correction and Resubmit Correction are server-controlled P10 actions. Customer acceptance fields are not editable by Partner users.</p> : null}
        </RecordCard>
      ))}
    </div>
  );
}

function ProductionList({ records }: { records: ProductionRecord[] }) {
  if (!records.length) return <EmptyPortal title="No production records" body="Saved Asset, Route, and Daily production records appear here." />;
  return (
    <div className="partner-card-grid">
      {records.map((record) => (
        <RecordCard key={record.id} title={recordTitle(record)} status={record.status}>
          <StatusRows rows={[
            ["Production", record.description || record.code],
            ["Quantity", `${record.reported_quantity ?? 0} ${record.unit_of_measure ?? ""}`],
            ["Location", record.location_type],
            ["Record", record.locked ? "read_only_submitted" : "draft_editable"],
          ]} />
        </RecordCard>
      ))}
    </div>
  );
}

function SyncFailureList({ messages, onRetry }: { messages: string[]; onRetry: () => void }) {
  return (
    <div className="partner-sync-failures" role="status" aria-live="polite">
      {messages.map((message) => <p key={message} className="partner-safe-text error-text">{message}</p>)}
      <button className="partner-button wide-touch" type="button" onClick={onRetry}>Retry Sync</button>
    </div>
  );
}

function TotalsView({ totals, annotationCount }: { totals?: DailyProduction["totals"]; annotationCount: number }) {
  return (
    <StatusRows rows={[
      ...((totals?.by_code ?? []).map((row) => [row.description || row.code || "Production", `${row.quantity ?? 0} ${row.unit ?? ""}`] as [string, string])),
      ["Production Records", String(totals?.record_count ?? 0)],
      ["Complete", String(totals?.status_counts?.complete ?? 0)],
      ["Partial", String(totals?.status_counts?.partial ?? 0)],
      ["Blocked", String(totals?.status_counts?.blocked ?? 0)],
      ["Rework", String(totals?.status_counts?.rework ?? 0)],
      ["Map Annotations", String(annotationCount)],
    ]} />
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
    if (section === "daily-production") return "Production";
    if (section === "review-day") return "Review Day";
    if (section === "corrections" || section === "customer-qc") return "Corrections";
    return "Mobilization";
  }
  if (section === "worker-detail") return "Workers";
  if (section === "crew-detail") return "Crews";
  if (section === "agreement-detail") return "Agreements";
  if (section === "work-order-detail") return "Work Orders";
  const labels: Record<string, string> = { dashboard: "Dashboard", company: "Company", compliance: "Compliance", workforce: "Workers", workers: "Workers", crews: "Crews", agreements: "Agreements", "work-orders": "Work Orders", vehicles: "Vehicles", mobilization: "Mobilization", "field-map": "Field Map", "daily-jsa": "Daily JSA", "daily-production": "Daily Production", "review-day": "Review Day", "customer-qc": "Customer QC", corrections: "Customer QC" };
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
  if (section === "daily-production") return "Daily Production";
  if (section === "review-day") return "Review Day";
  if (section === "customer-qc") return "Customer QC";
  if (section === "corrections") return "Corrections";
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

function openCorrections(reports: CustomerQcItem[]) {
  const rows: Array<{ report: CustomerQcItem; correction: CustomerCorrection }> = [];
  for (const report of reports) {
    if (report.correction && !["resolved", "cancelled"].includes(str(report.correction.status))) rows.push({ report, correction: report.correction });
  }
  return rows;
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

function recordTitle(record: ProductionRecord) {
  if (record.location_type === "route") return `${record.from_asset_identifier ?? "Start"} -> ${record.to_asset_identifier ?? "End"}`;
  if (record.location_type === "asset") return record.asset_identifier || "Asset production";
  return record.description || record.code || "Daily production";
}

type OfflineMutationStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";
type OfflineMutation = {
  mutationId: string;
  operation: "CREATE_PRODUCTION";
  scopeKey: string;
  reportId?: string;
  localEntityId: string;
  serverEntityId?: string;
  payload: Record<string, unknown>;
  status: OfflineMutationStatus;
  createdAt: string;
  sequence: number;
  retryCount: number;
  lastAttemptAt?: string;
  lastSafeError?: string;
  canonical?: Record<string, unknown>;
};

const queueDbName = "syncos-field-production";
const queueStoreName = "mutations";
const legacyQueueKey = "syncos.fieldMutations";
const maxAutoRetries = 3;

function useFieldProductionQueue(data: PortalData) {
  const scopeKey = fieldQueueScope(data);
  const [mutations, setMutations] = useState<OfflineMutation[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
  }, []);

  useEffect(() => {
    if (!scopeKey) return;
    let cancelled = false;
    async function load() {
      await migrateLegacyQueue(scopeKey);
      const next = await listFieldMutations(scopeKey);
      if (!cancelled) setMutations(next);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  async function replay() {
    if (!scopeKey || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const result = await replayFieldMutations(scopeKey, setMutations);
    if (result.syncedCount > 0 && result.remainingUnsynced === 0) location.reload();
  }

  useEffect(() => {
    if (!scopeKey) return;
    const handleOnline = () => {
      setOnline(true);
      void replayFieldMutations(scopeKey, setMutations).then((result) => {
        if (result.syncedCount > 0 && result.remainingUnsynced === 0) location.reload();
      });
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (typeof navigator !== "undefined" && navigator.onLine) handleOnline();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [scopeKey]);

  async function enqueue(entry: { operation: "CREATE_PRODUCTION"; payload: Record<string, unknown> }) {
    if (!scopeKey) return;
    const payload = { ...entry.payload, client_mutation_id: str(entry.payload.client_mutation_id) || crypto.randomUUID() };
    const mutation: OfflineMutation = {
      mutationId: String(payload.client_mutation_id),
      operation: entry.operation,
      scopeKey,
      reportId: data.productionToday?.id,
      localEntityId: crypto.randomUUID(),
      payload,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      sequence: Date.now(),
      retryCount: 0,
    };
    await saveFieldMutation(mutation);
    setMutations(await listFieldMutations(scopeKey));
  }

  const unsynced = mutations.filter(isUnsyncedMutation);
  const failedMessages = [...new Set(mutations.filter((mutation) => mutation.status === "FAILED" || mutation.status === "CONFLICT").map((mutation) => mutation.lastSafeError ?? "Sync failed."))];
  return {
    mutations,
    unsyncedCount: unsynced.length,
    failedMessages,
    enqueue,
    replay,
    label: syncLabel(mutations, online),
  };
}

function syncLabel(mutations: OfflineMutation[], online: boolean) {
  const failed = mutations.filter((mutation) => mutation.status === "FAILED" || mutation.status === "CONFLICT").length;
  if (failed) return "sync failed";
  const syncing = mutations.filter((mutation) => mutation.status === "SYNCING").length;
  if (syncing) return "syncing";
  const pending = mutations.filter((mutation) => mutation.status === "PENDING").length;
  if (pending && !online) return `offline - ${pending} ${pending === 1 ? "change" : "changes"} saved locally`;
  if (pending) return `syncing ${pending} pending ${pending === 1 ? "change" : "changes"}`;
  return online ? "synced" : "offline";
}

function fieldQueueScope(data: PortalData) {
  const userId = data.context?.user.id;
  const organizationId = data.context?.organization.id;
  const report = data.productionToday;
  const reportScope = report?.id ?? report?.work_date;
  if (!userId || !organizationId || !reportScope) return "";
  return ["tenant", tokenTenantId(), "user", userId, "org", organizationId, "report", reportScope].join(":");
}

function tokenTenantId() {
  const token = readToken();
  const payload = token.split(".")[1];
  if (!payload) return "unknown";
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { tenant_id?: string };
    return decoded.tenant_id ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function replayFieldMutations(scopeKey: string, setMutations: (mutations: OfflineMutation[]) => void) {
  let syncedCount = 0;
  const queue = (await listFieldMutations(scopeKey)).filter(isReplayableMutation).sort((left, right) => left.sequence - right.sequence);
  for (const mutation of queue) {
    if (mutation.retryCount >= maxAutoRetries) {
      await saveFieldMutation({ ...mutation, status: "FAILED", lastSafeError: "Sync failed. Retry when connection is stable." });
      setMutations(await listFieldMutations(scopeKey));
      continue;
    }
    const syncing = { ...mutation, status: "SYNCING" as const, lastAttemptAt: new Date().toISOString() };
    await saveFieldMutation(syncing);
    setMutations(await listFieldMutations(scopeKey));
    try {
      const canonical = await syncosFetch<Record<string, unknown>>("syncfield/foreman/production/records", { method: "POST", body: mutation.payload });
      await saveFieldMutation({ ...syncing, status: "SYNCED", serverEntityId: str(canonical.id), canonical, lastSafeError: undefined });
      syncedCount += 1;
      setMutations(await listFieldMutations(scopeKey));
    } catch (error) {
      const message = safeSyncError(error instanceof Error ? error.message : "Sync failed.");
      const status: OfflineMutationStatus = isConflictMessage(message) ? "CONFLICT" : isTransientNetworkError(error) ? "PENDING" : "FAILED";
      await saveFieldMutation({ ...mutation, status, retryCount: mutation.retryCount + 1, lastAttemptAt: new Date().toISOString(), lastSafeError: message });
      setMutations(await listFieldMutations(scopeKey));
      if (status === "PENDING") break;
    }
  }
  const remainingUnsynced = (await listFieldMutations(scopeKey)).filter(isUnsyncedMutation).length;
  return { syncedCount, remainingUnsynced };
}

function isReplayableMutation(mutation: OfflineMutation) {
  return mutation.status === "PENDING" || mutation.status === "FAILED";
}

function isUnsyncedMutation(mutation: OfflineMutation) {
  return mutation.status === "PENDING" || mutation.status === "SYNCING" || mutation.status === "FAILED" || mutation.status === "CONFLICT";
}

function localProductionRecords(mutations: OfflineMutation[], codes: ProductionCode[]): ProductionRecord[] {
  const codeById = new Map(codes.map((code) => [code.id, code]));
  return mutations.filter(isUnsyncedMutation).map((mutation) => {
    const code = codeById.get(str(mutation.payload.production_code_id));
    return {
      id: mutation.localEntityId,
      production_code_id: str(mutation.payload.production_code_id),
      code: code?.code,
      description: code?.description ?? "Unsynced production",
      reported_quantity: Number(mutation.payload.reported_quantity ?? 0),
      unit_of_measure: code?.unit_of_measure,
      location_type: str(mutation.payload.location_type),
      status: mutation.status === "CONFLICT" || mutation.status === "FAILED" ? "blocked" : str(mutation.payload.status) || "complete",
      asset_identifier: str(mutation.payload.asset_identifier),
      from_asset_identifier: str(mutation.payload.from_asset_identifier),
      to_asset_identifier: str(mutation.payload.to_asset_identifier),
      map_page: mutation.payload.map_page === undefined ? undefined : Number(mutation.payload.map_page),
      notes: mutation.status === "PENDING" ? "Saved locally; waiting to sync." : mutation.lastSafeError ?? "Syncing saved field entry.",
      locked: false,
    };
  });
}

function mergeProductionTotals(totals: DailyProduction["totals"], localRecords: ProductionRecord[]): DailyProduction["totals"] {
  if (!localRecords.length) return totals;
  const byCode = new Map<string, { code?: string; description?: string; quantity: number; unit?: string; count: number }>();
  for (const row of totals?.by_code ?? []) byCode.set(row.code ?? row.description ?? crypto.randomUUID(), { ...row, quantity: Number(row.quantity ?? 0), count: Number(row.count ?? 0) });
  const status_counts: Record<string, number> = { complete: totals?.status_counts?.complete ?? 0, partial: totals?.status_counts?.partial ?? 0, blocked: totals?.status_counts?.blocked ?? 0, rework: totals?.status_counts?.rework ?? 0 };
  for (const record of localRecords) {
    const key = record.code ?? record.production_code_id ?? record.description ?? "local";
    const current = byCode.get(key) ?? { code: record.code, description: record.description, quantity: 0, unit: record.unit_of_measure, count: 0 };
    current.quantity += Number(record.reported_quantity ?? 0);
    current.count += 1;
    byCode.set(key, current);
    const status = record.status ?? "complete";
    status_counts[status] = (status_counts[status] ?? 0) + 1;
  }
  return { by_code: [...byCode.values()], record_count: (totals?.record_count ?? 0) + localRecords.length, status_counts };
}

async function migrateLegacyQueue(scopeKey: string) {
  if (typeof window === "undefined") return;
  const legacy = window.localStorage.getItem(legacyQueueKey);
  if (!legacy) return;
  try {
    const parsed = JSON.parse(legacy) as Array<{ operation?: string; payload?: Record<string, unknown>; createdAt?: string; retryCount?: number; status?: string }>;
    for (const entry of parsed) {
      if (entry.operation !== "CREATE_PRODUCTION" || !entry.payload) continue;
      const payload = { ...entry.payload, client_mutation_id: str(entry.payload.client_mutation_id) || crypto.randomUUID() };
      await saveFieldMutation({
        mutationId: String(payload.client_mutation_id),
        operation: "CREATE_PRODUCTION",
        scopeKey,
        localEntityId: crypto.randomUUID(),
        payload,
        status: "PENDING",
        createdAt: entry.createdAt ?? new Date().toISOString(),
        sequence: Date.now(),
        retryCount: Number(entry.retryCount ?? 0),
      });
    }
    window.localStorage.removeItem(legacyQueueKey);
  } catch {
    window.localStorage.removeItem(legacyQueueKey);
  }
}

async function listFieldMutations(scopeKey: string): Promise<OfflineMutation[]> {
  if (typeof window === "undefined") return [];
  const store = await fieldQueueStore();
  return store.list(scopeKey);
}

async function saveFieldMutation(mutation: OfflineMutation) {
  if (typeof window === "undefined") return;
  const store = await fieldQueueStore();
  await store.save(mutation);
}

async function fieldQueueStore(): Promise<{ list(scopeKey: string): Promise<OfflineMutation[]>; save(mutation: OfflineMutation): Promise<void> }> {
  if (!("indexedDB" in window)) return localStorageQueueStore();
  return indexedDbQueueStore();
}

async function indexedDbQueueStore() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(queueDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(queueStoreName)) {
        const store = db.createObjectStore(queueStoreName, { keyPath: "mutationId" });
        store.createIndex("scopeKey", "scopeKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable."));
  });
  return {
    list(scopeKey: string) {
      return new Promise<OfflineMutation[]>((resolve, reject) => {
        const request = db.transaction(queueStoreName, "readonly").objectStore(queueStoreName).index("scopeKey").getAll(scopeKey);
        request.onsuccess = () => resolve((request.result as OfflineMutation[]).sort((left, right) => left.sequence - right.sequence));
        request.onerror = () => reject(request.error ?? new Error("Field queue read failed."));
      });
    },
    save(mutation: OfflineMutation) {
      return new Promise<void>((resolve, reject) => {
        const request = db.transaction(queueStoreName, "readwrite").objectStore(queueStoreName).put(mutation);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("Field queue write failed."));
      });
    },
  };
}

function localStorageQueueStore() {
  const storageKey = "syncos.fieldProductionMutations";
  return {
    async list(scopeKey: string) {
      try {
        const all = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as OfflineMutation[];
        return all.filter((mutation) => mutation.scopeKey === scopeKey).sort((left, right) => left.sequence - right.sequence);
      } catch {
        return [];
      }
    },
    async save(mutation: OfflineMutation) {
      const all = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as OfflineMutation[];
      const next = all.filter((candidate) => candidate.mutationId !== mutation.mutationId);
      next.push(mutation);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    },
  };
}

function isTransientNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|network|load failed|offline/i.test(message);
}

function isConflictMessage(message: string) {
  return /submitted|read-only|already submitted/i.test(message);
}

function safeSyncError(message: string) {
  if (/submitted|read-only|only draft/i.test(message)) return "REPORT ALREADY SUBMITTED - LOCAL CHANGES NOT APPLIED";
  if (/production_start_not_authorized/i.test(message)) return "Production start is no longer authorized. Local changes were not applied.";
  if (/daily_jsa_incomplete/i.test(message)) return "Daily JSA is no longer complete. Local changes were not applied.";
  if (/permission|forbidden/i.test(message)) return "You do not have permission to sync this field change.";
  if (/production code/i.test(message)) return "Production code is no longer available for this Work Order.";
  return message || "Sync failed.";
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
