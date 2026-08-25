"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { clearAuthContext, readPermissions, readToken, sessionEmailFromToken, syncosFetch } from "../intelligence/api";

type Persona = "partner_admin" | "partner_foreman";
type Section =
  | "dashboard"
  | "onboarding"
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
  | "corrections"
  | "settlements"
  | "payments"
  | "performance";

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
type DesignSegment = {
  id?: string;
  production_code_id?: string | null;
  production_code?: string | null;
  production_description?: string | null;
  from_asset_identifier?: string | null;
  to_asset_identifier?: string | null;
  design_label?: string | null;
  design_length_ft?: number | null;
  design_unit?: string | null;
  geometry?: { points?: Array<{ x?: number; y?: number }> };
  status?: string;
  span_completion_id?: string | null;
  completion_status?: string | null;
  production_record_id?: string | null;
  design_deviation?: boolean | null;
};
type AssetObservation = {
  id?: string;
  design_segment_id?: string | null;
  asset_identifier?: string;
  asset_type?: string;
  pdf_x?: number;
  pdf_y?: number;
  input_tick?: number | null;
  output_tick?: number | null;
  tick_difference?: number | null;
  tick_unit?: string;
  reel_cable_id?: string | null;
  fiber_type?: string | null;
  notes?: string | null;
  status?: string;
};
type CoilObservation = {
  id?: string;
  asset_observation_id?: string;
  design_segment_id?: string | null;
  span_completion_id?: string | null;
  production_record_id?: string | null;
  asset_identifier?: string;
  easement_type?: string;
  coil_type?: string;
  required_length_ft?: number | null;
  actual_length_ft?: number | null;
  variance_ft?: number | null;
  variance_status?: string;
  rule_source?: string;
  rule_source_reference?: string | null;
  reel_cable_id?: string | null;
  fiber_type?: string | null;
  commercial_treatment?: string;
  status?: string;
};
type SpanCompletion = {
  id?: string;
  design_segment_id?: string | null;
  production_record_id?: string;
  from_asset_observation_id?: string | null;
  to_asset_observation_id?: string | null;
  from_asset_identifier?: string;
  to_asset_identifier?: string;
  redline_geometry?: { points?: Array<{ x?: number; y?: number }> };
  completion_status?: string;
  design_deviation?: boolean;
  deviation_reason?: string | null;
  reported_quantity?: number | null;
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
  participants?: Array<{ id?: string; worker_id?: string; name?: string; role?: string; participation_status?: string; acknowledged?: boolean }>;
};
type JsaCompletionPayload = {
  work_location: string;
  weather?: string;
  site_conditions?: string;
  hazards: string[];
  controls: string[];
  notes?: string;
  foreman_certified: boolean;
};
type ProductionCode = { id?: string; code?: string; description?: string; unit_of_measure?: string; location_type?: string };
type ProductionRecord = {
  id?: string;
  production_code_id?: string;
  code?: string;
  description?: string;
  reported_quantity?: number;
  unit_of_measure?: string;
  location_type?: string;
  status?: string;
  asset_identifier?: string;
  from_asset_identifier?: string;
  to_asset_identifier?: string;
  map_page?: number;
  tick_start_label?: string | null;
  tick_end_label?: string | null;
  reel_cable_id?: string | null;
  fiber_type?: string | null;
  sequence_start?: number | null;
  sequence_end?: number | null;
  sequence_direction?: string | null;
  sequence_calculated_footage?: number | null;
  sequence_reported_variance?: number | null;
  sequence_variance_status?: string | null;
  sequence_variance_explanation?: string | null;
  notes?: string;
  locked?: boolean;
};
type DailyProduction = {
  id?: string;
  status?: string;
  work_date?: string;
  work_order_version_id?: string;
  work_order_number?: string;
  revision_number?: number;
  customer_qc_outcome?: string;
  customer_accepted_quantity?: number;
  gate?: { allowed?: boolean; blockers?: string[] };
  records?: ProductionRecord[];
  annotations?: Array<Record<string, unknown>>;
  coil_observations?: CoilObservation[];
  totals?: {
    by_code?: Array<{ code?: string; description?: string; quantity?: number; unit?: string; count?: number }>;
    record_count?: number;
    status_counts?: Record<string, number>;
    coils?: { coil_observation_count?: number; required_coil_ft?: number; actual_coil_ft?: number; variance_count?: number; commercial_treatment?: string };
  };
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
type ProductionDashboard = {
  headline?: Record<string, number | string>;
  reported_vs_accepted?: Array<Record<string, unknown>>;
  production_by_crew?: Array<Record<string, unknown>>;
  production_by_work_order?: Array<Record<string, unknown>>;
  project_to_date?: Array<Record<string, unknown>>;
  missing_reports?: Record<string, unknown>;
  customer_qc_aging?: Array<Record<string, unknown>>;
  correction_aging?: Array<Record<string, unknown>>;
  recent_reports?: Array<Record<string, unknown>>;
  reports?: Array<Record<string, unknown>>;
  closeout?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
};
type PartnerSettlement = {
  id?: string;
  settlement_number?: string;
  settlement_period_start?: string;
  settlement_period_end?: string;
  net_settlement_amount?: number;
  pay_when_paid_status?: string;
  eligible_amount?: number;
  payment_due_at?: string | null;
  dispute_deadline?: string | null;
  items?: Array<{ production_code?: string; accepted_quantity?: number; unit?: string; partner_rate?: number; gross_partner_amount?: number }>;
};
type PartnerPayment = {
  contractor_payable_id?: string;
  payable_number?: string;
  net_payable_amount?: number;
  eligible_amount?: number;
  paid_amount?: number;
  in_flight_payment_amount?: number;
  retained_balance_amount?: number;
  payment_due_at?: string | null;
  payment_status?: string;
  pay_when_paid_status?: string;
  payments?: Array<{ id?: string; amount?: number; status?: string; provider_reference?: string; requested_at?: string }>;
};
type PartnerPerformanceSummary = {
  overall_status?: string;
  score?: number;
  confidence?: string;
  trend?: string;
  dimensions?: Array<{ dimension?: string; normalized_score?: number; sample_size?: number; reason_code?: string }>;
  improvement_items?: string[];
  boundary?: Record<string, boolean>;
};
type OnboardingChecklist = {
  organization_id?: string;
  required_complete?: boolean;
  ready_for_review?: boolean;
  readiness_status?: string;
  items?: Array<{ key?: string; label?: string; requirement?: string; complete?: boolean; route?: string; status?: string }>;
};

type PortalData = {
  context?: PartnerContext;
  actions?: PartnerActions;
  onboarding?: OnboardingChecklist;
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
  designSegments?: DesignSegment[];
  assetObservations?: AssetObservation[];
  coilObservations?: CoilObservation[];
  spanCompletions?: SpanCompletion[];
  productionReports?: DailyProduction[];
  customerQcReports?: CustomerQcItem[];
  productionDashboard?: ProductionDashboard | null;
  productionHistory?: ProductionDashboard | null;
  partnerSettlements?: PartnerSettlement[];
  partnerPayments?: PartnerPayment[];
  partnerPerformance?: PartnerPerformanceSummary | null;
  foremanCrew?: Crew | null;
  foremanRoster?: Worker[];
  foremanWorkOrder?: WorkOrder | null;
  foremanAssignments?: MapAssignment[];
  selectedAssignment?: MapAssignment | null;
};

const adminNav = [
  ["Dashboard", "/partner"],
  ["Onboarding", "/partner/onboarding"],
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
  ["Settlements", "/partner/settlements"],
  ["Payments", "/partner/payments"],
  ["Performance", "/partner/performance"],
] as const;

const syncfieldNav = [
  ["Today", "/syncfield/today"],
  ["Crew", "/syncfield/crew"],
  ["Workload", "/syncfield/workload"],
  ["Map", "/syncfield/map"],
  ["Production", "/syncfield/production"],
  ["Corrections", "/syncfield/corrections"],
] as const;

const syncfieldAssignmentKey = "syncos.syncfieldAssignmentId";
const foremanFieldPermissions = ["partner_map.read_assigned", "partner_jsa.read_own", "partner_daily_production.read"];

export function PartnerShell({ section, itemId, product = "partner" }: { section: Section; itemId?: string; product?: "partner" | "syncfield" }) {
  const [state, setState] = useState<{ loading: boolean; error?: string; denied?: boolean; data: PortalData }>({ loading: true, data: {} });
  const [message, setMessage] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");

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
        const permissions = readPermissions();
        const canEnterSyncField = context.persona === "partner_foreman" || foremanFieldPermissions.some((permission) => permissions.includes(permission));
        if (product === "syncfield" && !canEnterSyncField) {
          setState({ loading: false, denied: true, error: "SyncField requires an active Foreman assignment.", data: { context } });
          return;
        }
        const actions = await safeFetch<PartnerActions>("partner-personas/me/actions");
        const effectiveContext = product === "syncfield" && canEnterSyncField ? { ...context, persona: "partner_foreman" as const } : context;
        const data = effectiveContext.persona === "partner_foreman" ? await loadForeman(effectiveContext, actions, section, selectedAssignmentId) : await loadAdmin(effectiveContext, actions, section, itemId);
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
  }, [section, itemId, product, selectedAssignmentId]);

  useEffect(() => {
    setSessionEmail(sessionEmailFromToken());
    if (typeof window !== "undefined") setSelectedAssignmentId(window.localStorage.getItem(syncfieldAssignmentKey) ?? "");
  }, []);

  const data = state.data;
  const persona = data.context?.persona;
  const isSyncField = persona === "partner_foreman";
  const nav = isSyncField ? syncfieldNav : adminNav;
  const activeLabel = activeSectionLabel(section, persona);
  const shellLabel = isSyncField ? "SyncField" : "Partner Portal";
  const shellHome = isSyncField ? "/syncfield/today" : "/partner";
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
    <main className={isSyncField ? "partner-portal-shell syncfield-shell" : "partner-portal-shell"}>
      <aside className={isSyncField ? "partner-sidebar syncfield-sidebar" : "partner-sidebar"} aria-label={isSyncField ? "SyncField navigation" : "Partner navigation"}>
        <div className="partner-brand-block">
          <a className="partner-logo-link" href={shellHome} aria-label={`${shellLabel} home`}>
            <img src="/brand/sync-comm-systems-logo.png" alt="Sync Comm Systems" />
          </a>
          <div>
            <p className="eyebrow">{shellLabel}</p>
            <h1>{isSyncField ? "SyncField" : data.context?.organization.name ?? "SyncOS Partner"}</h1>
            <p className="partner-persona">{isSyncField ? `${data.context?.organization.name ?? "Assigned Crew"} · Field Execution` : personaLabel(persona)}</p>
          </div>
        </div>
        <nav className="partner-nav">
          {nav.map(([label, href]) => (
            <Link key={href} className={label === activeLabel ? "partner-nav-link active" : "partner-nav-link"} href={href}>
              {label}
            </Link>
          ))}
          {persona === "partner_admin" && foremanFieldPermissions.some((permission) => permissions.includes(permission)) ? <Link className="partner-nav-link" href="/syncfield/today">SyncField</Link> : null}
          {persona === "partner_admin" ? <Link className={section === "daily-production" ? "partner-nav-link active" : "partner-nav-link"} href="/partner/production">Daily Production</Link> : null}
        </nav>
        <div className="partner-account-control">
          <div>
            <span>{sessionEmail || "Signed in"}</span>
            <strong>{personaLabel(persona)}</strong>
          </div>
          <button
            type="button"
            onClick={() => {
              clearAuthContext();
              window.location.assign("/login");
            }}
          >
            Log Out
          </button>
        </div>
      </aside>
      <section className="partner-main">
        {state.loading ? <LoadingPortal product={shellLabel} /> : state.denied ? <DeniedPortal message={state.error} /> : state.error ? <ErrorPortal product={shellLabel} message={state.error} /> : (
          <>
            <header className="partner-page-header">
              <div>
                <p className="eyebrow">{isSyncField ? "SyncField" : personaLabel(persona)}</p>
                <h2>{pageTitle(section, persona)}</h2>
              </div>
              <StatusPill label={isSyncField ? "Assignment Scope" : "Organization"} value={isSyncField ? data.foremanCrew?.name ? "crew_assigned" : "pending_assignment" : data.context?.organization.status} />
            </header>
            {message ? <div className={/failed|forbidden|error/i.test(message) ? "partner-banner error" : "partner-banner success"}>{message}</div> : null}
            {isSyncField ? (
              <AssignmentContext
                assignments={data.foremanAssignments ?? []}
                selectedAssignment={data.selectedAssignment}
                onSelect={(assignmentId) => {
                  if (typeof window !== "undefined") window.localStorage.setItem(syncfieldAssignmentKey, assignmentId);
                  setSelectedAssignmentId(assignmentId);
                  setMessage("SyncField assignment context selected.");
                }}
              />
            ) : null}
            {isSyncField && (data.foremanAssignments?.length ?? 0) > 1 && !data.selectedAssignment
              ? <EmptyPortal title="Select a SyncField assignment" body="Choose the Crew and Work Order you are working before opening JSA, map, production, or corrections. SyncOS will not silently decide where production is recorded." />
              : renderSection(section, data, permissions, itemId, acknowledgeNotice, completeJsa)}
          </>
        )}
      </section>
    </main>
  );

  async function completeJsa(payload: JsaCompletionPayload) {
    try {
      setMessage(null);
      const completed = await syncosFetch<DailyJsa>("syncfield/foreman/jsa/today/complete", {
        method: "POST",
        body: {
          ...payload,
          assignment_id: data.selectedAssignment?.id,
        },
      });
      setState((current) => ({ ...current, data: { ...current.data, jsaToday: completed } }));
      setMessage("Daily JSA completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Daily JSA completion failed.");
    }
  }
}

function AssignmentContext({ assignments, selectedAssignment, onSelect }: { assignments: MapAssignment[]; selectedAssignment?: MapAssignment | null; onSelect: (assignmentId: string) => void }) {
  if (!assignments.length) return null;
  if (assignments.length === 1) {
    const assignment = selectedAssignment ?? assignments[0];
    return (
      <section className="syncfield-assignment-strip" aria-label="SyncField assignment context">
        <div>
          <p className="eyebrow">Active Workload</p>
          <strong>{assignment.work_order?.work_order_number || "Assigned Work Order"}</strong>
          <span>{assignment.project?.name || "Assigned Project"} · {assignment.crew?.name || "Assigned Crew"}</span>
        </div>
        <StatusPill label="Context" value="selected" />
      </section>
    );
  }
  return (
    <section className="syncfield-assignment-strip multi" aria-label="Choose SyncField assignment context">
      <div>
        <p className="eyebrow">Assignment Context Required</p>
        <strong>Choose today&apos;s Crew and Work Order</strong>
        <span>Production, JSA, map activity, and offline replay use this context.</span>
      </div>
      <div className="syncfield-assignment-options">
        {assignments.map((assignment) => (
          <button
            key={assignment.id}
            className={selectedAssignment?.id === assignment.id ? "partner-button primary" : "partner-button"}
            type="button"
            onClick={() => assignment.id ? onSelect(assignment.id) : undefined}
          >
            {assignment.work_order?.work_order_number || "Work Order"} · {assignment.crew?.name || "Crew"}
          </button>
        ))}
      </div>
    </section>
  );
}

async function loadAdmin(context: PartnerContext, actions: PartnerActions | undefined, section: Section, itemId?: string): Promise<PortalData> {
  const permissions = readPermissions();
  const needsDashboard = section === "dashboard";
  const needsOnboarding = needsDashboard || section === "onboarding";
  const needsCompliance = needsDashboard || section === "onboarding" || section === "compliance";
  const needsCompany = section === "onboarding" || section === "company";
  const needsCrews = needsDashboard || section === "onboarding" || section === "crews" || section === "crew-detail";
  const needsAgreements = needsDashboard || section === "onboarding" || section === "agreements" || section === "agreement-detail";
  const needsWorkOrders = needsDashboard || section === "work-orders" || section === "work-order-detail" || section === "mobilization";
  const needsVehicles = needsDashboard || section === "onboarding" || section === "vehicles";
  const needsMobilization = needsDashboard || section === "mobilization";
  const [onboarding, compliance, company, tax, payment, policies, workers, crews, agreements, workOrders, vehicles, mapAssignment, jsas, productionReports, customerQcReports, productionDashboard, partnerSettlements, partnerPayments, partnerPerformance] = await Promise.all([
    needsOnboarding ? safeFetch<OnboardingChecklist>("partner-invitations/me/onboarding-checklist") : undefined,
    needsCompliance ? safeFetch<ComplianceSummary>("partner-compliance/me/summary") : undefined,
    needsCompany ? safeFetch<CompanyProfile>("partner-compliance/me/company-profile") : undefined,
    section === "compliance" ? safeFetch<TaxProfile>("partner-compliance/me/w9") : undefined,
    needsCompliance || needsDashboard ? safeFetch<PaymentProfile>("partner-compliance/me/payment-profile") : undefined,
    section === "compliance" ? safeFetch<InsurancePolicy[]>("partner-compliance/me/insurance-policies", []) : [],
    section === "onboarding" || section === "workers" || section === "worker-detail" ? safeFetch<Worker[]>("partner-workforce/me/workers", []) : [],
    needsCrews ? safeFetch<Crew[]>("partner-workforce/me/crews", []) : [],
    needsAgreements ? safeFetch<Agreement[]>("partner-agreements/me/agreements", []) : [],
    needsWorkOrders ? safeFetch<WorkOrder[]>("partner-agreements/me/work-orders", []) : [],
    needsVehicles ? safeFetch<VehicleAssignment[]>("partner-agreements/me/vehicle-assignments", []) : [],
    section === "field-map" && permissions.includes("partner_map.read") ? safeFetch<MapAssignment | null>("syncfield/partner/map-assignment", null) : null,
    section === "daily-jsa" && permissions.includes("partner_jsa.read") ? safeFetch<DailyJsa[]>("syncfield/partner/jsas", []) : [],
    (section === "daily-production" || section === "review-day") && permissions.includes("partner_daily_production.read_org") ? safeFetch<DailyProduction[]>("syncfield/partner/production", []) : [],
    (section === "customer-qc" || section === "corrections") && permissions.includes("partner_customer_qc.read") ? safeFetch<CustomerQcItem[]>("syncfield/partner/customer-qc", []) : [],
    section === "daily-production" && permissions.includes("partner_production_dashboard.read") ? safeFetch<ProductionDashboard | null>("syncfield/partner/production-dashboard", null) : null,
    section === "settlements" && permissions.includes("partner_settlement.read") ? safeFetch<PartnerSettlement[]>("accepted-production-financials/partner/settlements", []) : [],
    section === "payments" && permissions.includes("partner_payment.read") ? safeFetch<PartnerPayment[]>("payment-retainage-adjustments/partner/payments", []) : [],
    section === "performance" && permissions.includes("partner_performance.read_own") ? safeFetch<PartnerPerformanceSummary | null>("partner-performance/partner/summary", null) : null,
  ]);
  const rosterByCrew: Record<string, Worker[]> = {};
  const readinessByCrew: Record<string, Readiness> = {};
  const crewsForReadiness = needsDashboard ? (crews ?? []).slice(0, 1) : (section === "crews" || section === "crew-detail" ? crews ?? [] : []);
  await Promise.all(crewsForReadiness.map(async (crew) => {
    const id = str(crew.id);
    if (!id) return;
    rosterByCrew[id] = await safeFetch<Worker[]>(`partner-workforce/me/crews/${id}/roster`, []);
    const readiness = await safeFetch<Readiness | null>(`partner-workforce/me/crews/${id}/readiness`, null);
    if (readiness) readinessByCrew[id] = readiness;
  }));
  const selectedWorkOrder = itemId ? (workOrders ?? []).find((workOrder) => str(workOrder.id) === itemId) : (workOrders ?? [])[0];
  const versionId = str(selectedWorkOrder?.id);
  const mobilization = needsMobilization && versionId ? await safeFetch<Readiness | null>(`partner-mobilization/me/work-order-versions/${versionId}/readiness`, null) : null;
  const notice = needsMobilization && versionId ? await safeFetch<Notice | null>(`partner-mobilization/me/work-order-versions/${versionId}/notice`, null) : null;
  return { context, actions, onboarding, compliance, company, tax, payment, policies, workers, crews, rosterByCrew, readinessByCrew, agreements, workOrders, vehicles, mobilization, notice, mapAssignment, jsas, productionReports, customerQcReports, productionDashboard, partnerSettlements, partnerPayments, partnerPerformance };
}

async function loadForeman(context: PartnerContext, actions: PartnerActions | undefined, section: Section, selectedAssignmentId?: string): Promise<PortalData> {
  const permissions = readPermissions();
  const needsToday = section === "dashboard";
  const needsCrew = needsToday || section === "crews" || section === "crew-detail" || section === "workforce";
  const needsAssignment = needsToday || section === "work-orders" || section === "work-order-detail";
  const needsMobilization = needsToday || section === "mobilization";
  const needsMap = needsToday || section === "field-map" || section === "daily-production" || section === "review-day";
  const needsConstruction = section === "field-map" || section === "daily-production" || section === "review-day";
  const needsJsa = needsToday || section === "crews" || section === "crew-detail" || section === "workforce" || section === "daily-jsa" || section === "daily-production" || section === "review-day";
  const needsProduction = section === "daily-production" || section === "review-day";
  const needsProductionHistory = section === "daily-production" || section === "review-day";
  const foremanAssignments = permissions.includes("partner_map.read_assigned") ? await safeFetch<MapAssignment[]>("syncfield/foreman/assignments", []) : [];
  const selectedAssignment =
    selectedAssignmentId && foremanAssignments.some((assignment) => str(assignment.id) === selectedAssignmentId)
      ? foremanAssignments.find((assignment) => str(assignment.id) === selectedAssignmentId) ?? null
      : foremanAssignments.length === 1
        ? foremanAssignments[0]
        : null;
  const assignmentQuery = selectedAssignment?.id ? `?assignment_id=${encodeURIComponent(str(selectedAssignment.id))}` : "";
  if (foremanAssignments.length > 1 && !selectedAssignment) {
    return { context, actions, foremanAssignments, selectedAssignment: null };
  }
  const [compliance, foremanCrew, foremanRoster, foremanWorkOrder, mobilization, notice, mapAssignment, jsaToday, productionToday, productionCodes, designSegments, assetObservations, coilObservations, spanCompletions, customerQcReports, productionHistory] = await Promise.all([
    needsToday ? safeFetch<ComplianceSummary>("partner-compliance/me/summary") : undefined,
    needsCrew ? safeFetch<Crew | null>("partner-workforce/foreman/crew", null) : null,
    needsCrew ? safeFetch<Worker[]>("partner-workforce/foreman/crew/roster", []) : [],
    needsAssignment || needsToday ? safeFetch<WorkOrder | null>("partner-agreements/foreman/work-order", null) : null,
    needsMobilization ? safeFetch<Readiness | null>("partner-mobilization/foreman/readiness", null) : null,
    needsMobilization || needsToday ? safeFetch<Notice | null>("partner-mobilization/foreman/notice", null) : null,
    needsMap && permissions.includes("partner_map.read_assigned") ? safeFetch<MapAssignment | null>(`syncfield/foreman/map-assignment${assignmentQuery}`, null) : null,
    needsJsa && permissions.includes("partner_jsa.read_own") ? safeFetch<DailyJsa | null>(`syncfield/foreman/jsa/today${assignmentQuery}`, null) : null,
    needsProduction && permissions.includes("partner_daily_production.read") ? safeFetch<DailyProduction | null>(`syncfield/foreman/production/today${assignmentQuery}`, null) : null,
    needsProduction && permissions.includes("partner_daily_production.read") ? safeFetch<ProductionCode[]>(`syncfield/foreman/production/codes${assignmentQuery}`, []) : [],
    needsConstruction && permissions.includes("partner_map.read_assigned") ? safeFetch<DesignSegment[]>(`syncfield/foreman/design-segments${assignmentQuery}`, []) : [],
    needsConstruction && permissions.includes("partner_map.read_assigned") ? safeFetch<AssetObservation[]>(`syncfield/foreman/asset-observations${assignmentQuery}`, []) : [],
    needsConstruction && permissions.includes("partner_map.read_assigned") ? safeFetch<CoilObservation[]>(`syncfield/foreman/coil-observations${assignmentQuery}`, []) : [],
    needsConstruction && permissions.includes("partner_map.read_assigned") ? safeFetch<SpanCompletion[]>(`syncfield/foreman/span-completions${assignmentQuery}`, []) : [],
    (section === "customer-qc" || section === "corrections") && permissions.includes("partner_customer_qc.read_own") ? safeFetch<CustomerQcItem[]>("syncfield/foreman/customer-qc", []) : [],
    needsProductionHistory && permissions.includes("partner_production_history.read_own") ? safeFetch<ProductionDashboard | null>("syncfield/foreman/production-history", null) : null,
  ]);
  return { context, actions, compliance, foremanCrew, foremanRoster, foremanWorkOrder, mobilization, notice, mapAssignment, jsaToday, productionToday, productionCodes, designSegments, assetObservations, coilObservations, spanCompletions, customerQcReports, productionHistory, foremanAssignments, selectedAssignment: selectedAssignment ?? mapAssignment };
}

async function safeFetch<T>(path: string, fallback?: T): Promise<T> {
  try {
    return await syncosFetch<T>(path);
  } catch (error) {
    if (fallback !== undefined && error instanceof Error && /404|not found/i.test(error.message)) return fallback;
    throw error;
  }
}

function renderSection(section: Section, data: PortalData, permissions: string[], itemId: string | undefined, acknowledgeNotice: () => Promise<void>, completeJsa: (payload: JsaCompletionPayload) => Promise<void>) {
    if (data.context?.persona === "partner_foreman" && ["onboarding", "company", "compliance", "workers", "worker-detail", "agreements", "agreement-detail", "vehicles", "settlements", "payments", "performance"].includes(section)) {
    return <DeniedPortal message="This Partner workspace is not available to Foreman users." />;
  }
  if (data.context?.persona === "partner_foreman") {
    if (section === "dashboard") return <ForemanToday data={data} acknowledgeNotice={acknowledgeNotice} />;
    if (section === "crews" || section === "crew-detail" || section === "workforce") return <ForemanCrew data={data} />;
    if (section === "work-orders" || section === "work-order-detail") return <ForemanWorkload data={data} />;
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
    case "onboarding":
      return <OnboardingChecklistWorkspace data={data} />;
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
    case "settlements":
      return <PartnerSettlementsWorkspace data={data} />;
    case "payments":
      return <PartnerPaymentsWorkspace data={data} />;
    case "performance":
      return <PartnerPerformanceWorkspace data={data} />;
    case "field-map":
      return <FieldMapWorkspace data={data} />;
    default:
      return <EmptyPortal title="Workspace unavailable" body="This Partner workspace is not available." />;
  }
}

function OnboardingChecklistWorkspace({ data }: { data: PortalData }) {
  const checklist = data.onboarding;
  const items = checklist?.items ?? [];
  const steps = onboardingSteps(data);
  const completedRequired = steps.filter((step) => step.required).filter((step) => step.complete).length;
  const totalRequired = steps.filter((step) => step.required).length;
  const companyApproved = /approved/.test(str(data.context?.organization.status).toLowerCase());
  const readyForReview = Boolean(checklist?.ready_for_review || checklist?.readiness_status === "READY_FOR_REVIEW");
  const companyGate = companyApproved ? "approved" : readyForReview ? "ready for sync review" : "not ready";
  const crewGate = crewReadinessStatus(data);
  const mobilizationGate = data.mobilization?.overall_status ?? "work order specific";
  const nextStep = steps.find((step) => !step.complete && step.required) ?? steps.find((step) => !step.complete);
  return (
    <div className="partner-stack onboarding-workflow">
      <section className="partner-panel onboarding-hero">
        <div className="onboarding-hero-copy">
          <p className="eyebrow">Partner Onboarding</p>
          <h3>{data.context?.organization.name ?? "Partner company"}</h3>
          <p>Complete the company, tax, insurance, agreement, workforce, crew, equipment, and safety gates before Sync review.</p>
        </div>
        <div className="onboarding-status-card">
          <span>Status</span>
          <strong>{companyApproved ? "Approved" : readyForReview ? "Ready for Sync Review" : "Not Ready"}</strong>
          <small>{completedRequired} of {totalRequired} required gates complete</small>
        </div>
      </section>

      <section className="onboarding-gates" aria-label="Readiness gates">
        <GateCard title="Company Approved" status={companyGate} body="Company approval admits the Partner into the Sync Partner network." />
        <GateCard title="Crew Ready" status={crewGate} body="Crew readiness is specific to each crew's people, equipment, and compliance." />
        <GateCard title="Project Mobilization" status={mobilizationGate} body="Mobilization approval is issued per Work Order before production starts." />
      </section>

      <section className="partner-panel">
        <div className="panel-header onboarding-section-header">
          <div>
            <p className="eyebrow">Readiness Checklist</p>
            <h3>Required order</h3>
            {nextStep ? <p className="partner-safe-text">Next: {nextStep.label}</p> : <p className="partner-safe-text">Ready for Sync review.</p>}
          </div>
          <StatusPill label="Review" value={checklist?.readiness_status ?? (readyForReview ? "READY_FOR_REVIEW" : "ACCOUNT_ACTIVATED")} />
        </div>
        <div className="onboarding-step-list">
          {steps.map((step, index) => (
            <Link key={step.key} className={step.complete ? "onboarding-step complete" : "onboarding-step"} href={step.route}>
              <span className="onboarding-step-index">{step.complete ? "Done" : String(index + 1)}</span>
              <div className="onboarding-step-body">
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              <StatusPill label={step.label} value={step.complete ? "complete" : step.status} />
            </Link>
          ))}
        </div>
        {!items.length ? <EmptyPortal title="No checklist available" body="The onboarding checklist appears after the Partner Admin invitation is accepted." /> : null}
        <div className="onboarding-submit-row">
          {readyForReview ? <span className="partner-button primary disabled-action">Ready for Sync Review</span> : <button className="partner-button primary" type="button" disabled>Submit for Sync Review</button>}
          <span>{readyForReview ? "Sync Admin can review and approve the Partner." : "Approval remains locked until required gates are complete."}</span>
        </div>
      </section>

      <section className="partner-panel">
        <div className="panel-header onboarding-section-header">
          <div>
            <p className="eyebrow">After Approval</p>
            <h3>Partner Portal</h3>
          </div>
          <StatusPill label="Portal" value={companyApproved ? "active" : "locked"} />
        </div>
        <div className="portal-workspace-grid">
          {[
            ["Company", "/partner/company"],
            ["Compliance", "/partner/compliance"],
            ["Workers", "/partner/workers"],
            ["Crews", "/partner/crews"],
            ["Equipment", "/partner/vehicles"],
            ["Work Orders", "/partner/work-orders"],
            ["Production", "/partner/production"],
            ["Corrections", "/partner/corrections"],
            ["Settlements", "/partner/settlements"],
            ["Performance", "/partner/performance"],
          ].map(([label, route]) => <Link key={route} className="portal-workspace-link" href={route}>{label}</Link>)}
        </div>
      </section>
    </div>
  );
}

type OnboardingStep = { key: string; label: string; detail: string; route: string; required: boolean; complete: boolean; status: string };

function onboardingSteps(data: PortalData): OnboardingStep[] {
  const byKey = new Map((data.onboarding?.items ?? []).map((item) => [item.key ?? "", item]));
  const fromItem = (key: string) => byKey.get(key);
  const itemComplete = (key: string) => Boolean(fromItem(key)?.complete);
  const itemStatus = (key: string) => fromItem(key)?.status ?? "required";
  const vehiclesComplete = (data.vehicles ?? []).length > 0;
  const safetyComplete = itemComplete("insurance") && itemComplete("credentials") && itemComplete("headshots");
  const finalReviewComplete = Boolean(data.onboarding?.ready_for_review || data.onboarding?.readiness_status === "READY_FOR_REVIEW");
  return [
    { key: "company_setup", label: "Company Setup", detail: "Legal company name, DBA, tax classification, address, contacts, territories, capabilities, and emergency contact.", route: "/partner/company", required: true, complete: itemComplete("company_profile"), status: itemStatus("company_profile") },
    { key: "w9_tax", label: "W-9 / Tax Information", detail: "Signed W-9 and secure tax profile for internal Sync review.", route: "/partner/compliance", required: true, complete: itemComplete("w9"), status: itemStatus("w9") },
    { key: "payment_setup", label: "Payment Setup", detail: "Payment contact, remittance email, setup method, and required authorization. This does not enable automatic payouts.", route: "/partner/compliance", required: true, complete: itemComplete("payment_setup"), status: itemStatus("payment_setup") },
    { key: "insurance", label: "Insurance", detail: "General liability, auto liability, Workers' Comp, umbrella coverage, COI, limits, and expiration tracking.", route: "/partner/compliance", required: true, complete: itemComplete("insurance"), status: itemStatus("insurance") },
    { key: "agreements", label: "Agreements", detail: "Master Partner Agreement, NDA, safety acknowledgements, payment terms, and countersignature status.", route: "/partner/agreements", required: false, complete: itemComplete("agreement"), status: itemStatus("agreement") },
    { key: "workers", label: "Workers", detail: "Worker roster, role, phone, email where needed, certifications, credential evidence, and headshot status.", route: "/partner/workers", required: true, complete: itemComplete("workers"), status: itemStatus("workers") },
    { key: "foremen", label: "Foremen", detail: "Foreman designation, active status, assigned crew, and SyncField eligibility.", route: "/partner/workers", required: true, complete: itemComplete("foreman"), status: itemStatus("foreman") },
    { key: "crews", label: "Crews", detail: "Crew name, Foreman, worker count, capabilities, availability, home market, travel radius, and deployable status.", route: "/partner/crews", required: true, complete: itemComplete("crew"), status: itemStatus("crew") },
    { key: "equipment", label: "Vehicles / Equipment", detail: "Trucks, bucket trucks, reel trailers, lashers, drills, trailers, inspections, and crew assignments.", route: "/partner/vehicles", required: false, complete: vehiclesComplete, status: vehiclesComplete ? `${data.vehicles?.length ?? 0} assigned` : "pending" },
    { key: "safety", label: "Safety / Compliance", detail: "Insurance, worker qualifications, headshots, credentials, safety acknowledgements, and missing documentation.", route: "/partner/compliance", required: true, complete: safetyComplete, status: safetyComplete ? "complete" : "required" },
    { key: "final_review", label: "Final Review", detail: "Sync reviews the completed company package. Partner approval, crew readiness, and project mobilization stay separate.", route: "/partner/onboarding", required: false, complete: finalReviewComplete, status: finalReviewComplete ? "ready for sync review" : "locked" },
  ];
}

function crewReadinessStatus(data: PortalData) {
  const crews = data.crews ?? [];
  if (!crews.length) return "not ready";
  const readiness = crews.map((crew) => data.readinessByCrew?.[str(crew.id)]?.overall_status).filter(Boolean);
  if (readiness.some((status) => /ready|conditional/i.test(String(status)))) return "some crews ready";
  return "setup required";
}

function GateCard({ title, status, body }: { title: string; status: string; body: string }) {
  return (
    <section className="partner-panel onboarding-gate-card">
      <div className="panel-header">
        <h3>{title}</h3>
        <StatusPill label={title} value={status} />
      </div>
      <p>{body}</p>
    </section>
  );
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
            ["Start Authorization", data.mobilization?.decision?.decision ?? "pending"],
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
          <p className="partner-safe-text">{notice?.external_instructions || "Use the authorized start instructions when issued. Production remains blocked until the day is ready for field submission."}</p>
          {notice?.id ? <button className="partner-button primary wide-touch" type="button" onClick={() => void acknowledgeNotice()}>Acknowledge Notice</button> : null}
          <div className="partner-actions-row">
            {map?.status === "ready" ? <Link className="partner-button wide-touch" href="/syncfield/map">Open Map</Link> : null}
            <Link className="partner-button wide-touch" href="/syncfield/jsa">{jsa?.status === "completed" ? "View Daily JSA" : "Complete JSA"}</Link>
            <Link className="partner-button wide-touch" href="/syncfield/production">Open Production</Link>
          </div>
        </Panel>
        <Panel title="Crew" eyebrow={str(data.foremanCrew?.name)}>
          <StatusRows rows={[["Crew Readiness", data.mobilization?.overall_status ?? "not_evaluated"], ["Roster", `${data.foremanRoster?.length ?? 0} active Workers`]]} />
          <RosterList roster={data.foremanRoster ?? []} foreman />
        </Panel>
        <Panel title="Workload" eyebrow="Assigned work package">
          <StatusRows rows={[
            ["Work Order", str(data.foremanWorkOrder?.work_order_id) || "Not assigned"],
            ["Customer", str(data.foremanWorkOrder?.customer_name) || "Not shown"],
            ["Vehicle", vehicleLabel(data.foremanWorkOrder?.vehicle as Record<string, unknown> | undefined)],
            ["Operator", "Use assigned vehicle authorization"],
            ["Field Work", data.productionToday?.status ? "Production record available" : "Open Production to record work"],
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
  const designSegments = data.designSegments ?? [];
  const spanCompletions = data.spanCompletions ?? [];
  const observations = data.assetObservations ?? [];
  const coils = data.coilObservations ?? [];
  return (
    <div className="field-map-shell">
      <section className="field-map-header" aria-label="Field map context">
        <div>
          <p className="eyebrow">Assigned field map</p>
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
        <div className="field-map-canvas field-construction-canvas" role="img" aria-label={`PDF map ${assignment.map.name} revision ${assignment.map.revision_number ?? 0} with planned and completed overlays`}>
          <span>{assignment.map.customer_document_number || assignment.map.name}</span>
          <strong>PDF page preview</strong>
          <small>Pan, zoom, and review the assigned print before recording production.</small>
          <div className="field-design-layer" aria-hidden="true">
            {designSegments.slice(0, 8).map((segment, index) => <MapPolyline key={segment.id ?? index} points={segment.geometry?.points} className="design" />)}
          </div>
          <div className="field-redline-layer" aria-hidden="true">
            {spanCompletions.slice(0, 8).map((span, index) => <MapPolyline key={span.id ?? index} points={span.redline_geometry?.points} className="redline" />)}
          </div>
          <div className="field-pole-layer" aria-hidden="true">
            {observations.slice(0, 12).map((observation) => (
              <span key={observation.id} className="field-pole-marker" style={{ left: `${Number(observation.pdf_x ?? 0) * 100}%`, top: `${Number(observation.pdf_y ?? 0) * 100}%` }}>
                {observation.asset_identifier}
              </span>
            ))}
          </div>
        </div>
      </section>
      <section className="field-map-legend" aria-label="Map legend">
        <span><b className="legend-line design" /> DESIGN / PLANNED</span>
        <span><b className="legend-line redline" /> COMPLETED REDLINE</span>
        <span><b className="legend-dot" /> POLE / ASSET OBSERVATION</span>
      </section>
      <Panel title="Work Zones" eyebrow="Navigation bookmarks">
        <div className="partner-actions-row">
          {zones.map((zone) => <button className="partner-button" type="button" key={zone.id}>Jump to {zone.name} · Pg {zone.page_number}</button>)}
          {!zones.length ? <span className="partner-safe-text">No Work Zones assigned.</span> : null}
        </div>
      </Panel>
      <Panel title="Field Access" eyebrow="Assigned print">
        <StatusRows rows={[["State", "Available"], ["Source", "Read-only field map"], ["Map Package", assignment.map.name], ["Production Entry", "Use the Production workspace"]]} />
      </Panel>
      <Panel title="Production marks" eyebrow="Authoritative quantity remains ProductionRecord">
        <StatusRows rows={[
          ["Planned Segments", String(designSegments.length)],
          ["Completed Redlines", String(spanCompletions.length)],
          ["Pole Observations", String(observations.length)],
          ["Coil / Slack", `${coils.length} records · ${quantityText(coilActualTotal(coils), "FT")} actual`],
        ]} />
        <div className="field-construction-list" aria-label="Visible construction spans">
          {designSegments.slice(0, 4).map((segment) => (
            <div className="field-construction-list-item design" key={segment.id}>
              <span>DESIGN</span>
              <strong>{constructionSpanLabel(segment.from_asset_identifier, segment.to_asset_identifier, segment.design_label)}</strong>
            </div>
          ))}
          {spanCompletions.slice(0, 4).map((span) => (
            <div className="field-construction-list-item redline" key={span.id}>
              <span>REDLINE</span>
              <strong>{constructionSpanLabel(span.from_asset_identifier, span.to_asset_identifier)}</strong>
            </div>
          ))}
        </div>
        <p className="partner-safe-text">Yellow planned segments, red completion overlays, and annotation marks are construction evidence. ProductionRecord remains the reported quantity authority.</p>
        <p className="partner-safe-text">Recorded coil/slack is material traceability only. It does not create billable production, settlement, payable, or payment eligibility.</p>
        <Link className="partner-button wide-touch" href="/syncfield/production">Open Production</Link>
      </Panel>
    </div>
  );
}

function constructionSpanLabel(from?: string | null, to?: string | null, fallback?: string | null) {
  if (from || to) return `${from ?? "From"} -> ${to ?? "To"}`;
  return fallback || "Unlabeled span";
}

function MapPolyline({ points, className }: { points?: Array<{ x?: number; y?: number }>; className: "design" | "redline" }) {
  const valid = (points ?? []).filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
  if (valid.length < 2) return null;
  const style = {
    left: `${Number(valid[0].x) * 100}%`,
    top: `${Number(valid[0].y) * 100}%`,
    width: `${Math.max(12, Math.abs(Number(valid[valid.length - 1].x) - Number(valid[0].x)) * 100)}%`,
    transform: `rotate(${Math.atan2(Number(valid[valid.length - 1].y) - Number(valid[0].y), Number(valid[valid.length - 1].x) - Number(valid[0].x))}rad)`,
  };
  return <span className={`field-map-polyline ${className}`} style={style} />;
}

type ChecklistOption = readonly [string, string];

const jsaScopeOptions: ChecklistOption[] = [
  ["aerial_fiber", "Aerial Fiber"],
  ["underground_hdd", "Underground / HDD"],
  ["fiber_pulling", "Fiber Pulling"],
  ["splicing", "Splicing"],
  ["electrical", "Electrical"],
  ["civil", "Civil"],
] as const;

const jsaHazardOptions: ChecklistOption[] = [
  ["fall_exposure", "Falls from elevation"],
  ["trip_hazards", "Slip, trip, falls"],
  ["traffic", "Vehicle traffic"],
  ["energized_utilities", "Electrical shock / energized utilities"],
  ["overhead_utilities", "Overhead utilities"],
  ["underground_utilities", "Underground utilities"],
  ["heat_stress", "Heat stress"],
  ["cold_stress", "Cold stress"],
  ["chemical_exposure", "Chemical exposure"],
  ["rf_exposure", "RF / EME exposure"],
  ["noise_exposure", "Noise exposure"],
  ["rough_terrain", "Rough terrain"],
  ["environmental", "Environmental"],
  ["lead_asbestos", "Lead / asbestos"],
  ["site_security", "Site security"],
  ["inner_city", "Inner city"],
  ["night_work", "Night work"],
  ["rural", "Rural"],
  ["locked_access", "Locked fences / access doors"],
  ["lighting_required", "Lighting required"],
  ["trash_debris_dunnage", "Trash / debris / dunnage"],
  ["other", "Other"],
] as const;

const jsaControlGroups: Array<{ title: string; options: ChecklistOption[] }> = [
  {
    title: "Required PPE",
    options: [
      ["ppe_reviewed", "PPE reviewed"],
      ["hard_hat", "Hard hat"],
      ["safety_glasses", "Safety glasses"],
      ["hearing_protection", "Hearing protection"],
      ["gloves", "Gloves"],
      ["fall_protection_reviewed", "Fall protection"],
      ["respirator_protection", "Respirator protection"],
    ],
  },
  {
    title: "Required Training",
    options: [
      ["rf_site_safety_awareness", "RF site safety awareness"],
      ["competent_climber", "Competent climber"],
      ["equipment_operation_training", "Equipment operation"],
      ["first_aid_cpr", "First Aid / CPR"],
      ["fall_protection_plan", "Fall protection plan"],
      ["lockout_tagout", "Lockout / tagout"],
      ["confined_space", "Confined space"],
      ["competent_person_identified", "Competent person identified"],
    ],
  },
  {
    title: "Work Zone / Emergency",
    options: [
      ["traffic_control_reviewed", "Traffic control plan"],
      ["proper_signage", "Proper work-area signage"],
      ["cones_tapers", "Adequate cones and tapers"],
      ["drop_zone", "Drop zone"],
      ["barriers_barricades", "Barriers / barricades"],
      ["storm_drains_protected", "Storm drains protected"],
      ["emergency_procedures_reviewed", "Emergency action plan"],
      ["muster_area", "Muster area"],
      ["first_aid_kit_supplied", "First aid kit supplied"],
      ["fire_extinguishers_inspected", "Fire extinguishers inspected"],
      ["stop_work_authority_reviewed", "Stop-work authority reviewed"],
      ["incident_reporting_reviewed", "Incident reporting reviewed"],
    ],
  },
  {
    title: "Electrical / Underground / Civil",
    options: [
      ["utilities_reviewed", "Utilities reviewed"],
      ["underground_utilities_located", "Underground utilities located"],
      ["utilities_potholed", "Utilities potholed and located"],
      ["gfci", "GFCI"],
      ["electrical_ppe", "Electrical PPE"],
      ["electrical_equipment_inspection", "Electrical equipment inspection"],
      ["electrical_tools_tested", "Electrical tools and testing equipment"],
      ["drill_equipment_grounded", "Drill equipment grounded"],
      ["drilling_fluid_containment", "Drilling fluid containment"],
      ["certified_equipment_operators", "Certified equipment operators"],
      ["startup_inspections", "Equipment startup inspections"],
      ["excavation_trench_inspection", "Excavation / trench inspection"],
      ["shore_bench_slope_shield", "Shore / bench / slope / shield"],
      ["egress_every_25ft", "Egress every 25 ft"],
    ],
  },
  {
    title: "Site Readiness",
    options: [
      ["aerial_hazards_reviewed", "Aerial hazards reviewed"],
      ["equipment_inspection_complete", "Equipment inspection complete"],
      ["communication_confirmed", "Communication confirmed"],
      ["exclusion_zone_established", "Exclusion zone established"],
      ["eye_wash_station", "Eye wash station"],
      ["rubber_boots_gloves", "Rubber boots / gloves"],
      ["wash_basin_hose", "Wash basin / hose"],
      ["dust_control", "Dust control"],
      ["formwork_stability", "Formwork stability"],
      ["ladders_good_condition", "Ladders in good condition"],
      ["msds_available", "MSDS available"],
      ["mobile_equipment_good_condition", "Mobile equipment in good condition"],
      ["general_neatness", "General neatness of work area"],
    ],
  },
];

const requiredJsaControls = ["ppe_reviewed", "emergency_procedures_reviewed", "stop_work_authority_reviewed"];

function DailyJsaWorkspace({ data, completeJsa }: { data: PortalData; completeJsa: (payload: JsaCompletionPayload) => Promise<void> }) {
  const jsa = data.jsaToday;
  const defaultWorkLocation = jsa?.work_location || data.mapAssignment?.work_order?.primary_work_area || data.notice?.initial_work_area || "Assigned work area";
  const [workLocation, setWorkLocation] = useState(defaultWorkLocation);
  const [weather, setWeather] = useState(jsa?.weather ?? "");
  const [siteConditions, setSiteConditions] = useState(jsa?.site_conditions ?? "");
  const [scope, setScope] = useState<string[]>(["aerial_fiber"]);
  const [hazards, setHazards] = useState<string[]>(jsa?.hazards?.length ? jsa.hazards : ["traffic", "overhead_utilities"]);
  const [controls, setControls] = useState<string[]>(jsa?.controls?.length ? jsa.controls : ["ppe_reviewed", "emergency_procedures_reviewed", "stop_work_authority_reviewed", "traffic_control_reviewed"]);
  const [taskNotes, setTaskNotes] = useState("");
  const [otherScope, setOtherScope] = useState("");
  const [certified, setCertified] = useState(Boolean(jsa?.foreman_certified));
  const requiredMissing = requiredJsaControls.filter((control) => !controls.includes(control));
  const canComplete = hazards.length > 0 && requiredMissing.length === 0 && certified && workLocation.trim().length > 0;

  function toggle(value: string, values: string[], setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedScope = jsaScopeOptions.filter(([value]) => scope.includes(value)).map(([, label]) => label);
    void completeJsa({
      work_location: workLocation,
      weather,
      site_conditions: siteConditions,
      hazards,
      controls,
      foreman_certified: certified,
      notes: [
        selectedScope.length ? `Scope: ${selectedScope.join(", ")}` : null,
        otherScope.trim() ? `Other scope: ${otherScope.trim()}` : null,
        taskNotes.trim() ? `Daily task / hazard / procedure notes: ${taskNotes.trim()}` : null,
      ].filter(Boolean).join("\n"),
    });
  }

  return (
    <div className="partner-stack">
      <Panel title="Daily JSA" eyebrow={jsa?.work_date || "Today"}>
        <StatusRows rows={[
          ["Status", jsa?.status === "completed" ? "complete" : "required"],
          ["Work Area", jsa?.work_location || data.mapAssignment?.work_order?.primary_work_area || data.notice?.initial_work_area || "Assigned work area"],
          ["Map", data.mapAssignment?.map?.name ? `${data.mapAssignment.map.name} Rev ${data.mapAssignment.map.revision_number ?? 0}` : "Not assigned"],
          ["Completed", jsa?.meeting_completed_at ? shortTime(jsa.meeting_completed_at) : "Not completed"],
          ["Production", data.productionToday?.status ?? "Open Production after JSA"],
        ]} />
        {jsa?.status === "completed" ? <p className="partner-safe-text">Foreman attestation is complete for today. This does not create production, QC, billable, settlement, payable, or payment records.</p> : null}
      </Panel>
      {jsa?.status !== "completed" ? (
        <form className="field-jsa-form partner-stack" onSubmit={submit}>
          <Panel title="Project / Site" eyebrow="Tailgate setup">
            <div className="partner-form-grid">
              <label>Work Area<input value={workLocation} onChange={(event) => setWorkLocation(event.target.value)} required /></label>
              <label>Weather<input value={weather} onChange={(event) => setWeather(event.target.value)} placeholder="Current weather / conditions" /></label>
              <label>Site Conditions<textarea value={siteConditions} onChange={(event) => setSiteConditions(event.target.value)} placeholder="Access, traffic, terrain, lighting, unusual conditions" /></label>
              <label>Daily Task / Hazard / Procedure Notes<textarea value={taskNotes} onChange={(event) => setTaskNotes(event.target.value)} placeholder="Task, potential hazard, recommended action or procedure" /></label>
            </div>
          </Panel>
          <Panel title="Scope of Work" eyebrow="Select all that apply">
            <ChecklistGrid options={jsaScopeOptions} values={scope} onToggle={(value) => toggle(value, scope, setScope)} />
            <label className="field-jsa-other">Other scope<textarea value={otherScope} onChange={(event) => setOtherScope(event.target.value)} placeholder="Describe other scope of work" /></label>
          </Panel>
          <Panel title="Site Hazards" eyebrow="Physical, health, and site-security hazards">
            <ChecklistGrid options={jsaHazardOptions} values={hazards} onToggle={(value) => toggle(value, hazards, setHazards)} />
          </Panel>
          {jsaControlGroups.map((group) => (
            <Panel key={group.title} title={group.title} eyebrow="Mitigation measures">
              <ChecklistGrid options={group.options} values={controls} onToggle={(value) => toggle(value, controls, setControls)} />
            </Panel>
          ))}
          <Panel title="Review and Certification" eyebrow="Required before production">
            {requiredMissing.length ? <div className="partner-banner error">Required controls missing: {requiredMissing.map(jsaLabel).join(", ")}.</div> : null}
            {!hazards.length ? <div className="partner-banner error">At least one hazard must be selected.</div> : null}
            <label className="field-jsa-certify"><input type="checkbox" checked={certified} onChange={(event) => setCertified(event.target.checked)} /> I reviewed this JSA with the Crew, confirmed stop-work authority, and certify the site is ready for today&apos;s assigned work.</label>
            <button className="partner-button primary wide-touch" type="submit" disabled={!canComplete}>Complete JSA</button>
          </Panel>
        </form>
      ) : (
        <Panel title="Hazards and Controls" eyebrow="Completed tailgate review">
          <StatusRows rows={[
            ["Hazards", (jsa.hazards ?? []).map(jsaLabel).join(", ") || "Not recorded"],
            ["Controls", (jsa.controls ?? []).map(jsaLabel).join(", ") || "Not recorded"],
            ["Certification", jsa.foreman_certified ? "Foreman certified" : "Required before completion"],
          ]} />
        </Panel>
      )}
      <Panel title="Crew Attendance" eyebrow="Resolved from P4 Crew membership">
        <RosterList roster={data.foremanRoster ?? []} foreman />
      </Panel>
    </div>
  );
}

function ChecklistGrid({ options, values, onToggle }: { options: ChecklistOption[]; values: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="field-jsa-check-grid">
      {options.map(([value, label]) => (
        <label key={value}>
          <input type="checkbox" checked={values.includes(value)} onChange={() => onToggle(value)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function jsaLabel(value: string) {
  const options: ChecklistOption[] = [...jsaScopeOptions, ...jsaHazardOptions, ...jsaControlGroups.flatMap((group) => group.options)];
  return options.find(([optionValue]) => optionValue === value)?.[1] ?? str(value).replace(/_/g, " ");
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
  const designSegments = data.designSegments ?? [];
  const availableDesignSegments = designSegments.filter((segment) => !segment.span_completion_id);
  const selectedDesignSegment = availableDesignSegments[0] ?? designSegments[0];
  const localRecords = localProductionRecords(queue.mutations, codes);
  const visibleRecords = [...(report?.records ?? []), ...localRecords];
  const visibleTotals = mergeProductionTotals(report?.totals, localRecords);
  const visibleAnnotationCount = (report?.annotation_count ?? 0) + localRecords.filter((record) => record.location_type !== "daily").length;
  const coilObservations = uniqueCoils([...(data.coilObservations ?? []), ...(report?.coil_observations ?? [])]);
  const assetObservations = data.assetObservations ?? [];
  const selectedAssetObservation = assetObservations[0];
  const [error, setError] = useState<string | null>(null);
  const [spanForm, setSpanForm] = useState({
    designSegmentId: selectedDesignSegment?.id ?? "",
    from: "Pole 12301",
    to: "Pole 12312",
    fromInput: "14826",
    fromOutput: "14780",
    toInput: "14639",
    toOutput: "14600",
    reel: "REEL-A",
    fiberType: "144ct",
    start: "14826",
    end: "12131",
    reported: "2695",
    explanation: "",
  });
  const [coilForm, setCoilForm] = useState({
    assetObservationId: selectedAssetObservation?.id ?? "",
    easementType: "front",
    coilType: "front_easement",
    required: "150",
    actual: "150",
    reel: "R-327",
    fiberType: "96CT",
    ruleSource: "work_order_rule",
    sourceReference: "Default front easement slack requirement",
    notes: "",
  });
  const sequenceCalc = sequencePreview(spanForm.start, spanForm.end, spanForm.reported);
  const selectedSegment = designSegments.find((segment) => segment.id === spanForm.designSegmentId) ?? selectedDesignSegment;
  const selectedCoilAsset = assetObservations.find((observation) => observation.id === coilForm.assetObservationId) ?? selectedAssetObservation;
  const coilVariance = coilVariancePreview(coilForm.required, coilForm.actual);

  async function quickCreate(kind: "asset" | "route" | "daily") {
    const code = kind === "asset" ? transfer : kind === "route" ? fiber : labor;
    if (!code?.id) return;
    const mutation = {
      client_mutation_id: crypto.randomUUID(),
      assignment_id: data.selectedAssignment?.id,
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
      tick_start_label: "Start Tick",
      tick_end_label: "End Tick",
      x_ratio: 0.42,
      y_ratio: 0.48,
      start_x_ratio: 0.42,
      start_y_ratio: 0.48,
      end_x_ratio: 0.66,
      end_y_ratio: 0.52,
      reel_cable_id: kind === "route" ? "REEL-A" : undefined,
      fiber_type: kind === "route" ? "144ct" : undefined,
      sequence_start: kind === "route" ? 14826 : undefined,
      sequence_end: kind === "route" ? 14685 : undefined,
      notes: `${kind} field entry`,
    };
    await saveProduction(mutation);
  }

  async function saveFiberSpan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fiber?.id) return;
    if (sequenceCalc.status === "review_required" && !spanForm.explanation.trim()) {
      setError("Sequence variance needs a short field explanation before save.");
      return;
    }
    await saveProduction({
      client_mutation_id: crypto.randomUUID(),
      assignment_id: data.selectedAssignment?.id,
      work_date: report?.work_date,
      production_code_id: fiber.id,
      location_type: "route",
      reported_quantity: Number(spanForm.reported),
      status: sequenceCalc.status === "review_required" ? "partial" : "complete",
      map_page: 1,
      from_asset_identifier: spanForm.from,
      to_asset_identifier: spanForm.to,
      tick_start_label: `${spanForm.from} start`,
      tick_end_label: `${spanForm.to} end`,
      start_x_ratio: 0.42,
      start_y_ratio: 0.48,
      end_x_ratio: 0.66,
      end_y_ratio: 0.52,
      reel_cable_id: spanForm.reel,
      fiber_type: spanForm.fiberType,
      sequence_start: Number(spanForm.start),
      sequence_end: Number(spanForm.end),
      sequence_variance_explanation: spanForm.explanation || undefined,
      notes: "Fiber span entered from field tick and sequence workflow.",
    });
  }

  async function completeDesignSpan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fiber?.id || !selectedSegment?.id) return;
    const geometryPoints = selectedSegment.geometry?.points?.length ? selectedSegment.geometry.points : [{ x: 0.42, y: 0.48 }, { x: 0.66, y: 0.52 }];
    const mutationId = crypto.randomUUID();
    const spanMutation = {
      client_mutation_id: mutationId,
      assignment_id: data.selectedAssignment?.id,
      work_date: report?.work_date,
      design_segment_id: selectedSegment.id,
      production_code_id: fiber.id,
      page_number: 1,
      from_asset_identifier: spanForm.from,
      to_asset_identifier: spanForm.to,
      reported_quantity: Number(spanForm.reported),
      sequence_start: Number(spanForm.start),
      sequence_end: Number(spanForm.end),
      sequence_variance_explanation: spanForm.explanation || undefined,
      reel_cable_id: spanForm.reel,
      fiber_type: spanForm.fiberType,
      from_observation: {
        asset_type: "pole",
        asset_identifier: spanForm.from,
        pdf_x: geometryPoints[0]?.x ?? 0.42,
        pdf_y: geometryPoints[0]?.y ?? 0.48,
        input_tick: Number(spanForm.fromInput),
        output_tick: Number(spanForm.fromOutput),
        notes: "From pole observation for completed design span.",
      },
      to_observation: {
        asset_type: "pole",
        asset_identifier: spanForm.to,
        pdf_x: geometryPoints[geometryPoints.length - 1]?.x ?? 0.66,
        pdf_y: geometryPoints[geometryPoints.length - 1]?.y ?? 0.52,
        input_tick: Number(spanForm.toInput),
        output_tick: Number(spanForm.toOutput),
        notes: "To pole observation for completed design span.",
      },
      redline_geometry: { points: geometryPoints },
      design_deviation: false,
      notes: "Completed against planned design segment.",
    };
    await saveConstructionMutation("CREATE_SPAN_COMPLETION", spanMutation);
  }

  async function saveCoilObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCoilAsset?.id) {
      setError("Create or select a pole observation before recording coil/slack.");
      return;
    }
    if (coilForm.coilType === "other" && !coilForm.notes.trim()) {
      setError("Notes are required for OTHER coil/slack type.");
      return;
    }
    await saveConstructionMutation("CREATE_COIL_OBSERVATION", {
      client_mutation_id: crypto.randomUUID(),
      assignment_id: data.selectedAssignment?.id,
      work_date: report?.work_date,
      asset_observation_id: selectedCoilAsset.id,
      design_segment_id: selectedCoilAsset.design_segment_id ?? selectedSegment?.id,
      asset_identifier: selectedCoilAsset.asset_identifier,
      easement_type: coilForm.easementType,
      coil_type: coilForm.coilType,
      required_length_ft: coilForm.required.trim() ? Number(coilForm.required) : undefined,
      actual_length_ft: coilForm.actual.trim() ? Number(coilForm.actual) : undefined,
      rule_source: coilForm.ruleSource,
      rule_source_reference: coilForm.sourceReference,
      reel_cable_id: coilForm.reel,
      fiber_type: coilForm.fiberType,
      notes: coilForm.notes || undefined,
    });
  }

  function setCoilType(nextType: string) {
    const defaults = coilDefaults(nextType);
    setCoilForm({
      ...coilForm,
      coilType: nextType,
      easementType: defaults.easementType,
      required: defaults.required,
      ruleSource: defaults.ruleSource,
      sourceReference: defaults.sourceReference,
    });
  }

  async function saveProduction(mutation: Record<string, unknown>) {
    await saveConstructionMutation("CREATE_PRODUCTION", mutation);
  }

  async function saveConstructionMutation(operation: OfflineMutation["operation"], mutation: Record<string, unknown>) {
    setError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queue.enqueue({ operation, payload: mutation });
      return;
    }
    try {
      await syncosFetch(fieldMutationEndpoint(operation), { method: "POST", body: mutation });
    } catch (caught) {
      if (isTransientNetworkError(caught)) {
        await queue.enqueue({ operation, payload: mutation });
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
          <button className="partner-button primary wide-touch" type="button" onClick={() => void quickCreate("asset")}>Asset</button>
          <button className="partner-button primary wide-touch" type="button" onClick={() => void quickCreate("route")}>Route / Span</button>
          <button className="partner-button wide-touch" type="button" onClick={() => void quickCreate("daily")}>Daily</button>
          <Link className="partner-button wide-touch" href="/syncfield/production/review">Review & Submit</Link>
        </div>
      </Panel>
      <Panel title="Fiber Span" eyebrow="Ticks, poles, sequence">
        <form className="partner-form-grid compact-form" onSubmit={(event) => void saveFiberSpan(event)}>
          <label>From pole<input value={spanForm.from} onChange={(event) => setSpanForm({ ...spanForm, from: event.target.value })} /></label>
          <label>To pole<input value={spanForm.to} onChange={(event) => setSpanForm({ ...spanForm, to: event.target.value })} /></label>
          <label>Reel / cable<input value={spanForm.reel} onChange={(event) => setSpanForm({ ...spanForm, reel: event.target.value })} /></label>
          <label>Fiber type<input value={spanForm.fiberType} onChange={(event) => setSpanForm({ ...spanForm, fiberType: event.target.value })} /></label>
          <label>Sequence start<input inputMode="decimal" value={spanForm.start} onChange={(event) => setSpanForm({ ...spanForm, start: event.target.value })} /></label>
          <label>Sequence end<input inputMode="decimal" value={spanForm.end} onChange={(event) => setSpanForm({ ...spanForm, end: event.target.value })} /></label>
          <label>Reported footage<input inputMode="decimal" value={spanForm.reported} onChange={(event) => setSpanForm({ ...spanForm, reported: event.target.value })} /></label>
          <label>Variance explanation<input value={spanForm.explanation} onChange={(event) => setSpanForm({ ...spanForm, explanation: event.target.value })} placeholder={sequenceCalc.status === "review_required" ? "Required" : "Optional"} /></label>
          <StatusRows rows={[
            ["Calculated Footage", quantityText(sequenceCalc.calculated, "FT")],
            ["Variance", quantityText(sequenceCalc.variance, "FT")],
            ["Review", sequenceCalc.status],
          ]} />
          <button className="partner-button primary wide-touch" type="submit">Save Fiber Span</button>
        </form>
      </Panel>
      <Panel title="Complete Planned Span" eyebrow="Yellow design to redline">
        <form className="partner-form-grid compact-form" onSubmit={(event) => void completeDesignSpan(event)}>
          <label>Planned segment<select value={spanForm.designSegmentId} onChange={(event) => {
            const next = designSegments.find((segment) => segment.id === event.target.value);
            setSpanForm({
              ...spanForm,
              designSegmentId: event.target.value,
              from: next?.from_asset_identifier ?? spanForm.from,
              to: next?.to_asset_identifier ?? spanForm.to,
              reported: next?.design_length_ft ? String(next.design_length_ft) : spanForm.reported,
            });
          }}>
            {designSegments.map((segment) => <option key={segment.id} value={segment.id}>{segment.design_label || `${segment.from_asset_identifier ?? "From"} to ${segment.to_asset_identifier ?? "To"}`} {segment.completion_status ? `(${segment.completion_status})` : ""}</option>)}
          </select></label>
          <label>From pole<input value={spanForm.from} onChange={(event) => setSpanForm({ ...spanForm, from: event.target.value })} /></label>
          <label>From input tick<input inputMode="decimal" value={spanForm.fromInput} onChange={(event) => setSpanForm({ ...spanForm, fromInput: event.target.value })} /></label>
          <label>From output tick<input inputMode="decimal" value={spanForm.fromOutput} onChange={(event) => setSpanForm({ ...spanForm, fromOutput: event.target.value })} /></label>
          <label>To pole<input value={spanForm.to} onChange={(event) => setSpanForm({ ...spanForm, to: event.target.value })} /></label>
          <label>To input tick<input inputMode="decimal" value={spanForm.toInput} onChange={(event) => setSpanForm({ ...spanForm, toInput: event.target.value })} /></label>
          <label>To output tick<input inputMode="decimal" value={spanForm.toOutput} onChange={(event) => setSpanForm({ ...spanForm, toOutput: event.target.value })} /></label>
          <label>Reported footage<input inputMode="decimal" value={spanForm.reported} onChange={(event) => setSpanForm({ ...spanForm, reported: event.target.value })} /></label>
          <StatusRows rows={[
            ["Design Footage", selectedSegment?.design_length_ft ? `${selectedSegment.design_length_ft} FT` : "Not provided"],
            ["From Tick Difference", quantityText(sequenceFootage(spanForm.fromInput, spanForm.fromOutput), "FT")],
            ["To Tick Difference", quantityText(sequenceFootage(spanForm.toInput, spanForm.toOutput), "FT")],
            ["Financial Authority", "ProductionRecord after Customer QC"],
          ]} />
          <button className="partner-button primary wide-touch" type="submit" disabled={!selectedSegment?.id}>Mark Complete / Redline</button>
        </form>
        {!designSegments.length ? <p className="partner-safe-text">No planned design segments are prepared for this map revision yet. Use Fiber Span for manual field production until Sync Operations prepares the print.</p> : null}
      </Panel>
      <Panel title="Coil / Slack" eyebrow="Construction material truth only">
        <form className="partner-form-grid compact-form" onSubmit={(event) => void saveCoilObservation(event)}>
          <label>Pole / asset<select value={coilForm.assetObservationId} onChange={(event) => setCoilForm({ ...coilForm, assetObservationId: event.target.value })}>
            {assetObservations.map((observation) => <option key={observation.id} value={observation.id}>{observation.asset_identifier || observation.id}</option>)}
          </select></label>
          <label>Easement<select value={coilForm.easementType} onChange={(event) => setCoilForm({ ...coilForm, easementType: event.target.value })}>
            <option value="front">Front</option>
            <option value="rear">Rear</option>
            <option value="unknown">Unknown</option>
            <option value="not_applicable">Not applicable</option>
          </select></label>
          <label>Coil / slack type<select value={coilForm.coilType} onChange={(event) => setCoilType(event.target.value)}>
            <option value="front_easement">Front easement</option>
            <option value="rear_easement">Rear easement</option>
            <option value="express_splice">Express splice</option>
            <option value="butt_splice">Butt splice</option>
            <option value="riser_slack">Riser slack</option>
            <option value="general_slack">General slack</option>
            <option value="customer_required">Customer required</option>
            <option value="field_condition">Field condition</option>
            <option value="other">Other</option>
          </select></label>
          <label>Required FT<input inputMode="decimal" value={coilForm.required} onChange={(event) => setCoilForm({ ...coilForm, required: event.target.value })} /></label>
          <label>Actual FT<input inputMode="decimal" value={coilForm.actual} onChange={(event) => setCoilForm({ ...coilForm, actual: event.target.value })} /></label>
          <label>Reel / cable<input value={coilForm.reel} onChange={(event) => setCoilForm({ ...coilForm, reel: event.target.value })} /></label>
          <label>Fiber type<input value={coilForm.fiberType} onChange={(event) => setCoilForm({ ...coilForm, fiberType: event.target.value })} /></label>
          <label>Rule source<select value={coilForm.ruleSource} onChange={(event) => setCoilForm({ ...coilForm, ruleSource: event.target.value })}>
            <option value="project_rule">Project rule</option>
            <option value="work_order_rule">Work Order rule</option>
            <option value="customer_design">Customer design</option>
            <option value="customer_direction">Customer direction</option>
            <option value="field_requirement">Field requirement</option>
            <option value="manual">Manual</option>
            <option value="other">Other</option>
          </select></label>
          <label>Source / notes<input value={coilForm.sourceReference} onChange={(event) => setCoilForm({ ...coilForm, sourceReference: event.target.value })} /></label>
          <label>Field notes<textarea value={coilForm.notes} onChange={(event) => setCoilForm({ ...coilForm, notes: event.target.value })} placeholder={coilForm.coilType === "other" ? "Required for OTHER" : "Optional field condition notes"} /></label>
          <StatusRows rows={[
            ["Input / Output Tick", selectedCoilAsset ? `${selectedCoilAsset.input_tick ?? "not set"} / ${selectedCoilAsset.output_tick ?? "not set"}` : "Create pole observation first"],
            ["Tick Difference", selectedCoilAsset?.tick_difference === null || selectedCoilAsset?.tick_difference === undefined ? "unknown" : quantityText(selectedCoilAsset.tick_difference, "FT")],
            ["Coil Variance", quantityText(coilVariance.variance, "FT")],
            ["Variance Status", coilVariance.status],
            ["Commercial Treatment", "not configured"],
          ]} />
          <button className="partner-button primary wide-touch" type="submit" disabled={!selectedCoilAsset?.id}>Save Coil / Slack</button>
        </form>
        {!assetObservations.length ? <p className="partner-safe-text">Record a pole observation through completed span workflow before adding coil/slack.</p> : null}
      </Panel>
      <Panel title="Today's Production" eyebrow={`${visibleRecords.length} records`}>
        <ProductionList records={visibleRecords} />
      </Panel>
      <Panel title="Construction Evidence" eyebrow="Subordinate to ProductionRecord">
        <StatusRows rows={[
          ["Planned Segments", String(designSegments.length)],
          ["Redlines", String((data.spanCompletions ?? []).length)],
          ["Pole Observations", String((data.assetObservations ?? []).length)],
          ["Coil / Slack", `${coilObservations.length} records`],
          ["Actual Coil", quantityText(coilActualTotal(coilObservations), "FT")],
        ]} />
        <div className="field-construction-list" aria-label="Coil and slack evidence">
          {coilObservations.slice(0, 4).map((coil) => (
            <div className="field-construction-list-item coil" key={coil.id}>
              <span>{str(coil.coil_type).replace(/_/g, " ")}</span>
              <strong>{coil.asset_identifier || "Asset"} · actual {quantityText(coil.actual_length_ft, "FT")}</strong>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Daily Totals" eyebrow="Derived from ProductionRecords">
        <TotalsView totals={visibleTotals} annotationCount={visibleAnnotationCount} coilActual={coilActualTotal(coilObservations)} />
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
    await syncosFetch("syncfield/foreman/production/review-day/submit", { method: "POST", body: { assignment_id: data.selectedAssignment?.id, work_date: report?.work_date, client_mutation_id: crypto.randomUUID(), general_notes: "Foreman reviewed daily production." } });
  }
  return (
    <div className="partner-stack">
      <Panel title="Review & Submit" eyebrow={report?.work_date || "Today"}>
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
      <Panel title="Production History" eyebrow="Own Crew">
        <div className="partner-card-grid">
          {(data.productionHistory?.reports ?? []).map((history) => (
            <RecordCard key={str(history.id)} title={`${str(history.work_date) || "Work date"} · ${str(history.work_order_number) || "Work Order"}`} status={str(history.customer_qc_outcome)}>
              <StatusRows rows={[
                ["Reported", quantityText(history.reported_quantity, "")],
                ["Customer Accepted", quantityText(history.customer_accepted_quantity, "")],
                ["Records", str(history.record_count)],
              ]} />
            </RecordCard>
          ))}
        </div>
        {!(data.productionHistory?.reports ?? []).length ? <EmptyPortal title="No submitted production history" body="Submitted days for your assigned Crew appear here." /> : null}
      </Panel>
    </div>
  );
}

function AdminProductionWorkspace({ data }: { data: PortalData }) {
  const dashboard = data.productionDashboard;
  return (
    <div className="partner-stack">
      <Panel title="Production Dashboard" eyebrow="Partner Admin-safe">
        <div className="summary-grid">
          <MetricTile label="Reported Records" value={dashboard?.headline?.production_record_count ?? data.productionReports?.length ?? 0} />
          <MetricTile label="Pending Customer QC" value={dashboard?.headline?.pending_customer_qc ?? 0} />
          <MetricTile label="Corrections Required" value={dashboard?.headline?.correction_required ?? 0} />
          <MetricTile label="Blocked / Rework" value={dashboard?.headline?.blocked_rework ?? 0} />
        </div>
        <StatusRows rows={[
          ["Closeout", str(dashboard?.closeout?.status) || "in_progress"],
          ["Missing Reports", str(dashboard?.missing_reports?.status) || "insufficient_schedule_data"],
          ["Artifacts", str(dashboard?.closeout?.artifact_count) || "0"],
          ["Recorded Coil / Slack", quantityText(dashboard?.headline?.recorded_coil_slack_ft ?? 0, "FT")],
          ["Coil Commercial Treatment", str(dashboard?.headline?.coil_commercial_treatment) || "not configured"],
        ]} />
      </Panel>
      <Panel title="Reported vs Customer Accepted" eyebrow="Unit-aware totals">
        <ProductionMetricRows rows={dashboard?.reported_vs_accepted ?? []} />
      </Panel>
      <Panel title="Daily Production" eyebrow="Submitted reports">
        <div className="partner-card-grid">
          {(dashboard?.recent_reports ?? data.productionReports ?? []).map((report) => (
            <RecordCard key={str(report.id)} title={str(report.work_date) || "Work date"} status={str(report.customer_qc_outcome ?? report.status)}>
              <StatusRows rows={[["Work Order", str(report.work_order_number ?? report.work_order_version_id)], ["Submitted", str(report.submitted_at) || "Not submitted"], ["Revision", str(report.revision_number) || "1"], ["Customer Accepted", quantityText(report.customer_accepted_quantity, "")]]} />
            </RecordCard>
          ))}
        </div>
        {!(dashboard?.recent_reports ?? data.productionReports ?? []).length ? <EmptyPortal title="No Daily Production" body="Draft and submitted field reports appear here after Foreman entry." /> : null}
      </Panel>
      <Panel title="Aging" eyebrow="Customer QC and corrections">
        <StatusRows rows={[["Awaiting Customer QC", String(dashboard?.customer_qc_aging?.length ?? 0)], ["Open Corrections", String(dashboard?.correction_aging?.length ?? 0)]]} />
      </Panel>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return <div className="partner-metric-tile"><span>{label}</span><strong>{value}</strong></div>;
}

function ProductionMetricRows({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <EmptyPortal title="No accepted-production totals" body="Production summaries appear after submitted field reports exist." />;
  return (
    <div className="partner-card-grid">
      {rows.map((row) => (
        <RecordCard key={`${str(row.code)}-${str(row.unit_of_measure)}`} title={str(row.description) || str(row.code)} status={str(row.unit_of_measure)}>
          <StatusRows rows={[
            ["Reported", quantityText(row.reported_quantity, row.unit_of_measure)],
            ["Customer Accepted", row.customer_accepted_quantity ? quantityText(row.customer_accepted_quantity, row.unit_of_measure) : "Pending Customer QC"],
            ["Variance", quantityText(row.variance, row.unit_of_measure)],
            ["Variance %", row.variance_percent === null || row.variance_percent === undefined ? "Not set" : `${row.variance_percent}%`],
          ]} />
        </RecordCard>
      ))}
    </div>
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

function PartnerSettlementsWorkspace({ data }: { data: PortalData }) {
  const settlements = data.partnerSettlements ?? [];
  return (
    <div className="partner-stack">
      <Panel title="Weekly Settlements" eyebrow="Partner Admin financial view">
        <div className="partner-card-grid">
          {settlements.map((settlement) => (
            <RecordCard key={str(settlement.id)} title={str(settlement.settlement_number)} status={str(settlement.pay_when_paid_status) || "awaiting_customer_funds"}>
              <StatusRows rows={[
                ["Period", `${str(settlement.settlement_period_start)} to ${str(settlement.settlement_period_end)}`],
                ["Net Settlement", currency(settlement.net_settlement_amount)],
                ["Customer-Funded Eligibility", currency(settlement.eligible_amount)],
                ["Due Date", str(settlement.payment_due_at) || "Awaiting cleared customer funds"],
                ["Dispute Deadline", str(settlement.dispute_deadline)],
              ]} />
            </RecordCard>
          ))}
        </div>
        {!settlements.length ? <EmptyPortal title="No settlement statements" body="Weekly settlement statements appear after Customer-accepted production is converted by Sync Finance." /> : null}
      </Panel>
      <Panel title="Statement Lines" eyebrow="No Customer rate or margin">
        {settlements.flatMap((settlement) => settlement.items ?? []).length ? (
          <div className="partner-list">
            {settlements.flatMap((settlement) => settlement.items ?? []).map((item, index) => (
              <div className="partner-list-row static" key={`${str(item.production_code)}-${index}`}>
                <span><strong>{str(item.production_code)}</strong><small>{quantityText(item.accepted_quantity, item.unit)} Customer Accepted</small></span>
                <StatusPill label="Partner Rate" value={`${currency(item.partner_rate)} / ${str(item.unit)}`} />
                <StatusPill label="Gross" value={currency(item.gross_partner_amount)} />
              </div>
            ))}
          </div>
        ) : <EmptyPortal title="No settlement line items" body="Accepted production line items appear after settlement creation." />}
      </Panel>
    </div>
  );
}

function PartnerPaymentsWorkspace({ data }: { data: PortalData }) {
  const payables = data.partnerPayments ?? [];
  return (
    <div className="partner-stack">
      <Panel title="Payments" eyebrow="Partner Admin payment status">
        <div className="partner-card-grid">
          {payables.map((payable) => (
            <RecordCard key={str(payable.contractor_payable_id)} title={str(payable.payable_number)} status={paymentDisplayStatus(payable)}>
              <StatusRows rows={[
                ["Net Payable", currency(payable.net_payable_amount)],
                ["Eligible Amount", currency(payable.eligible_amount)],
                ["In Flight", currency(payable.in_flight_payment_amount)],
                ["Paid", currency(payable.paid_amount)],
                ["Retainage Held", currency(payable.retained_balance_amount)],
                ["Due Date", str(payable.payment_due_at) || "Awaiting customer funds"],
              ]} />
            </RecordCard>
          ))}
        </div>
        {!payables.length ? <EmptyPortal title="No payment records" body="Payment status appears after eligible Contractor Payables receive controlled internal payment instructions." /> : null}
      </Panel>
      <Panel title="Payment Instructions" eyebrow="No Customer rate or bank data">
        {payables.flatMap((payable) => payable.payments ?? []).length ? (
          <div className="partner-list">
            {payables.flatMap((payable) => payable.payments ?? []).map((payment) => (
              <div className="partner-list-row static" key={str(payment.id)}>
                <span><strong>{currency(payment.amount)}</strong><small>{str(payment.provider_reference) || "Provider reference pending"}</small></span>
                <StatusPill label="Status" value={str(payment.status)} />
                <StatusPill label="Requested" value={shortTime(payment.requested_at)} />
              </div>
            ))}
          </div>
        ) : <EmptyPortal title="No payment instructions" body="Confirmed and processing payment instructions appear here without provider secrets or raw payment account digits." />}
      </Panel>
    </div>
  );
}

function PartnerPerformanceWorkspace({ data }: { data: PortalData }) {
  const summary = data.partnerPerformance;
  const dimensions = summary?.dimensions ?? [];
  return (
    <div className="partner-stack">
      <Panel title="Performance Summary" eyebrow="Own organization only">
        {summary ? (
          <>
            <div className="summary-grid">
              <MetricTile label="Operational Status" value={partnerPerformanceLabel(summary.overall_status)} />
              <MetricTile label="Score" value={summary.score ?? "Pending"} />
              <MetricTile label="Confidence" value={partnerPerformanceLabel(summary.confidence)} />
              <MetricTile label="Trend" value={partnerPerformanceLabel(summary.trend)} />
            </div>
            <div className="warning-box">This summary is operational feedback for your organization only. It does not show competitive rankings, internal strategy, Worker rankings, rates, or margin.</div>
          </>
        ) : <EmptyPortal title="No performance snapshot" body="Performance summaries appear after Sync recalculates derived Partner intelligence." />}
      </Panel>
      <Panel title="Dimensions" eyebrow="Source-derived feedback">
        {dimensions.length ? (
          <div className="partner-list">
            {dimensions.map((dimension) => (
              <div className="partner-list-row static" key={str(dimension.dimension)}>
                <span><strong>{partnerPerformanceLabel(dimension.dimension)}</strong><small>Sample {dimension.sample_size ?? 0}</small></span>
                <StatusPill label="Score" value={String(dimension.normalized_score ?? 0)} />
                <StatusPill label="Reason" value={partnerPerformanceLabel(dimension.reason_code)} />
              </div>
            ))}
          </div>
        ) : <EmptyPortal title="No dimension evidence" body="Dimension evidence appears after a score snapshot is calculated." />}
      </Panel>
      <Panel title="Improvement Items" eyebrow="Partner-safe">
        {summary?.improvement_items?.length ? (
          <div className="partner-list">
            {summary.improvement_items.map((item) => <div className="partner-list-row static" key={item}><span><strong>{partnerPerformanceLabel(item)}</strong></span></div>)}
          </div>
        ) : <EmptyPortal title="No current improvement items" body="Partner-safe improvement items appear when a dimension needs attention." />}
      </Panel>
    </div>
  );
}

function partnerPerformanceLabel(value: unknown) {
  return str(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "None";
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
            ["Ticks", [record.tick_start_label, record.tick_end_label].filter(Boolean).join(" -> ")],
            ["Reel / Cable", record.reel_cable_id || ""],
            ["Fiber Sequence", fiberSequenceText(record)],
            ["Sequence Variance", record.sequence_reported_variance === null || record.sequence_reported_variance === undefined ? "" : quantityText(record.sequence_reported_variance, "FT")],
            ["Sequence Review", record.sequence_variance_status],
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

function TotalsView({ totals, annotationCount, coilActual = 0 }: { totals?: DailyProduction["totals"]; annotationCount: number; coilActual?: number }) {
  const reported = (totals?.by_code ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
  const apiCoilActual = Number(totals?.coils?.actual_coil_ft ?? 0);
  const actualCoil = apiCoilActual || coilActual;
  return (
    <StatusRows rows={[
      ...((totals?.by_code ?? []).map((row) => [row.description || row.code || "Production", `${row.quantity ?? 0} ${row.unit ?? ""}`] as [string, string])),
      ["Production Records", String(totals?.record_count ?? 0)],
      ["Recorded Coil / Slack", quantityText(actualCoil, "FT")],
      ["Estimated Cable Consumption", quantityText(reported + actualCoil, "FT")],
      ["Coil Commercial Treatment", totals?.coils?.commercial_treatment ?? "not configured"],
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
  const [participants, setParticipants] = useState(data.jsaToday?.participants ?? []);
  const [issueNote, setIssueNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const jsaStatus = data.jsaToday?.status ?? "required";

  async function updateParticipant(workerId: string | undefined, participationStatus: "present" | "absent" | "not_applicable") {
    if (!workerId) return;
    try {
      setMessage(null);
      const updated = await syncosFetch<{ worker_id?: string; participation_status?: string; acknowledged?: boolean }>(`syncfield/foreman/jsa/today/participants/${workerId}`, {
        method: "PATCH",
        body: { assignment_id: data.selectedAssignment?.id, work_date: data.jsaToday?.work_date, participation_status: participationStatus, issue_note: issueNote || undefined },
      });
      setParticipants((current) => {
        const found = current.some((participant) => participant.worker_id === workerId);
        const next = current.map((participant) => participant.worker_id === workerId ? { ...participant, ...updated } : participant);
        return found ? next : [...next, updated];
      });
      setIssueNote("");
      setMessage("Crew participation updated for today's JSA.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Crew participation update failed.");
    }
  }

  const participantByWorker = new Map(participants.map((participant) => [participant.worker_id, participant]));
  return (
    <div className="partner-stack">
      <Panel title={str(data.foremanCrew?.name) || "Assigned Crew"} eyebrow="Foreman-safe crew view">
        <StatusRows rows={[["Crew Type", str(data.foremanCrew?.crew_type)], ["Lifecycle", str(data.foremanCrew?.lifecycle_status)], ["Target Staffing", str(data.foremanCrew?.target_staffing_level)], ["Daily Participation", jsaStatus === "completed" ? "confirmed" : "open"]]} />
        <p className="partner-safe-text">SyncField lets Foremen confirm today's active crew participation and report issues. Add/remove roster changes remain Partner Admin or Sync Admin work.</p>
        {message ? <p className={/failed|error|invalid/i.test(message) ? "partner-safe-text error-text" : "partner-safe-text success-text"}>{message}</p> : null}
      </Panel>
      <Panel title="Daily Crew Participation" eyebrow={data.jsaToday?.work_date || "Today"}>
        <div className="partner-form-grid compact-form">
          <label>Issue note<input value={issueNote} onChange={(event) => setIssueNote(event.target.value)} placeholder="Missing crew member, late arrival, safety concern" /></label>
        </div>
        <div className="syncfield-roster-list">
          {(data.foremanRoster ?? []).map((worker) => {
            const workerId = str(worker.id);
            const participant = participantByWorker.get(workerId);
            return (
              <div className="syncfield-roster-row" key={workerId || str(worker.display_name)}>
                <div>
                  <strong>{str(worker.display_name) || `${str(worker.first_name)} ${str(worker.last_name)}`.trim() || "Worker"}</strong>
                  <span>{str(worker.membership_role) || str(participant?.role) || "crew"} · {participant?.participation_status ?? "not_marked"}</span>
                </div>
                <div className="partner-actions-row compact-actions">
                  <button className="partner-button" type="button" onClick={() => void updateParticipant(workerId, "present")}>Present</button>
                  <button className="partner-button" type="button" onClick={() => void updateParticipant(workerId, "absent")}>Absent</button>
                  <button className="partner-button" type="button" onClick={() => void updateParticipant(workerId, "not_applicable")}>N/A</button>
                </div>
              </div>
            );
          })}
        </div>
        {!(data.foremanRoster ?? []).length ? <EmptyPortal title="No active roster" body="Crew members appear here after Partner Admin or Sync Admin assigns active Workers to the Crew." /> : null}
      </Panel>
    </div>
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

function ForemanWorkload({ data }: { data: PortalData }) {
  if (!data.foremanWorkOrder) return <EmptyPortal title="No current workload" body="Assigned Work Orders and work areas appear here after Sync assigns them to your Crew." />;
  return <WorkOrderSummary workOrder={data.foremanWorkOrder} foreman />;
}

function WorkOrderSummary({ workOrder, foreman }: { workOrder: WorkOrder; foreman: boolean }) {
  return (
    <Panel title={str(workOrder.work_order_number) || str(workOrder.work_order_id) || "Work Order"} eyebrow={foreman ? "Assigned workload" : "Partner Admin"}>
      <StatusRows rows={[
        ["Project", str(workOrder.project_name)],
        ["Customer", str(workOrder.customer_name)],
        ["Status", str(workOrder.status)],
        ["Scope", str(workOrder.scope_summary)],
        ["Map Package", str(workOrder.map_work_package_ref)],
        ["Vehicle", vehicleLabel(workOrder.vehicle as Record<string, unknown> | undefined)],
        ...(foreman ? [] : [["Partner Rate", rateLabel(workOrder.partner_rate as Record<string, unknown> | undefined)] as [string, string]]),
      ]} />
      <p className="partner-safe-text">Use this workload view to confirm the assigned scope, map package, vehicle, and work area before recording field production.</p>
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

function RecordCard({ title, status, href, children }: { title: string; status?: string; href?: string; children: ReactNode }) {
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

function LoadingPortal({ product = "Partner Portal" }: { product?: string }) {
  return <div className="partner-panel loading-state" role="status" aria-live="polite">Loading {product}...</div>;
}

function DeniedPortal({ message }: { message?: string }) {
  return <div className="partner-panel error-state"><h2>Access denied</h2><p>{message || "Your current SyncOS session is not authorized for this Partner workspace."}</p></div>;
}

function ErrorPortal({ message, product = "Partner Portal" }: { message?: string; product?: string }) {
  return <div className="partner-panel error-state"><h2>Unable to load {product}</h2><p>{message || "The Partner Portal API request failed."}</p></div>;
}

function EmptyPortal({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{body}</p></div>;
}

function activeSectionLabel(section: Section, persona?: Persona) {
  if (persona === "partner_foreman") {
    if (section === "dashboard") return "Today";
    if (section === "crews" || section === "crew-detail" || section === "workforce") return "Crew";
    if (section === "work-orders" || section === "work-order-detail") return "Workload";
    if (section === "field-map") return "Map";
    if (section === "daily-jsa") return "Daily JSA";
    if (section === "daily-production") return "Production";
    if (section === "review-day") return "Production";
    if (section === "corrections" || section === "customer-qc") return "Corrections";
    if (section === "mobilization") return "Today";
    return "Today";
  }
  if (section === "onboarding") return "Onboarding";
  if (section === "worker-detail") return "Workers";
  if (section === "crew-detail") return "Crews";
  if (section === "agreement-detail") return "Agreements";
  if (section === "work-order-detail") return "Work Orders";
  const labels: Record<string, string> = { dashboard: "Dashboard", onboarding: "Onboarding", company: "Company", compliance: "Compliance", workforce: "Workers", workers: "Workers", crews: "Crews", agreements: "Agreements", "work-orders": "Work Orders", vehicles: "Vehicles", mobilization: "Mobilization", "field-map": "Field Map", "daily-jsa": "Daily JSA", "daily-production": "Daily Production", "review-day": "Review Day", "customer-qc": "Customer QC", corrections: "Customer QC", settlements: "Settlements", payments: "Payments", performance: "Performance" };
  return labels[section] ?? "Dashboard";
}

function pageTitle(section: Section, persona?: Persona) {
  if (persona === "partner_foreman" && section === "dashboard") return "Today";
  if (section === "onboarding") return "Onboarding Checklist";
  if (section === "work-order-detail") return persona === "partner_foreman" ? "Workload" : "Work Order";
  if (section === "worker-detail") return "Worker";
  if (section === "crew-detail") return "Crew";
  if (section === "agreement-detail") return "Agreement";
  if (section === "field-map") return persona === "partner_foreman" ? "Map" : "Field Map";
  if (section === "daily-jsa") return "Daily JSA";
  if (section === "daily-production") return persona === "partner_foreman" ? "Production" : "Daily Production";
  if (section === "review-day") return persona === "partner_foreman" ? "Production Review" : "Review Day";
  if (section === "customer-qc") return "Customer QC";
  if (section === "corrections") return "Corrections";
  if (section === "settlements") return "Settlements";
  if (section === "payments") return "Payments";
  if (section === "performance") return "Performance";
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

function quantityText(quantity: unknown, unit: unknown) {
  if (quantity === null || quantity === undefined || quantity === "") return "Pending Customer QC";
  return [str(quantity), str(unit)].filter(Boolean).join(" ");
}

function sequencePreview(start: string, end: string, reported: string) {
  const startNumber = Number(start);
  const endNumber = Number(end);
  const reportedNumber = Number(reported);
  if (![startNumber, endNumber, reportedNumber].every(Number.isFinite)) return { calculated: "", variance: "", status: "not_applicable" };
  const calculated = Math.abs(endNumber - startNumber);
  const variance = reportedNumber - calculated;
  return { calculated, variance, status: Math.abs(variance) > 25 ? "review_required" : "within_tolerance" };
}

function coilDefaults(coilType: string) {
  if (coilType === "front_easement") return { easementType: "front", required: "150", ruleSource: "work_order_rule", sourceReference: "Default front easement slack requirement" };
  if (coilType === "rear_easement") return { easementType: "rear", required: "80", ruleSource: "work_order_rule", sourceReference: "Default rear easement slack requirement" };
  return { easementType: "unknown", required: "", ruleSource: "manual", sourceReference: "Manual field requirement" };
}

function coilVariancePreview(required: string, actual: string) {
  const requiredNumber = Number(required);
  const actualNumber = Number(actual);
  if (![requiredNumber, actualNumber].every(Number.isFinite)) return { variance: "", status: "unknown" };
  const variance = Number((actualNumber - requiredNumber).toFixed(2));
  return { variance, status: Math.abs(variance) > 5 ? "variance" : "within_expectation" };
}

function coilActualTotal(coils: CoilObservation[]) {
  return Number(coils.reduce((sum, coil) => sum + Number(coil.actual_length_ft ?? 0), 0).toFixed(2));
}

function uniqueCoils(coils: CoilObservation[]) {
  const byId = new Map<string, CoilObservation>();
  coils.forEach((coil, index) => byId.set(str(coil.id) || `${coil.asset_identifier ?? "asset"}:${coil.coil_type ?? "coil"}:${index}`, coil));
  return [...byId.values()];
}

function fiberSequenceText(record: ProductionRecord) {
  if (record.sequence_start === null || record.sequence_start === undefined) return "";
  return `${record.sequence_start} -> ${record.sequence_end} (${record.sequence_direction || "direction not set"}; calc ${record.sequence_calculated_footage ?? 0} FT)`;
}

function currency(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(number) ? number : 0);
}

function paymentDisplayStatus(payable: PartnerPayment) {
  if (Number(payable.paid_amount ?? 0) >= Number(payable.net_payable_amount ?? 0) && Number(payable.net_payable_amount ?? 0) > 0) return "paid";
  if (Number(payable.in_flight_payment_amount ?? 0) > 0) return "payment_processing";
  if (Number(payable.eligible_amount ?? 0) > Number(payable.paid_amount ?? 0)) return "eligible";
  return str(payable.pay_when_paid_status) || str(payable.payment_status) || "awaiting_customer_funds";
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
type FieldMutationOperation = "CREATE_PRODUCTION" | "CREATE_ASSET_OBSERVATION" | "CREATE_SPAN_COMPLETION" | "CREATE_COIL_OBSERVATION";
type OfflineMutation = {
  mutationId: string;
  operation: FieldMutationOperation;
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
    await replayFieldMutations(scopeKey, setMutations);
  }

  useEffect(() => {
    if (!scopeKey) return;
    const handleOnline = () => {
      setOnline(true);
      void replayFieldMutations(scopeKey, setMutations);
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

  async function enqueue(entry: { operation: FieldMutationOperation; payload: Record<string, unknown> }) {
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
      const canonical = await syncosFetch<Record<string, unknown>>(fieldMutationEndpoint(mutation.operation), { method: "POST", body: mutation.payload });
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

function fieldMutationEndpoint(operation: FieldMutationOperation) {
  if (operation === "CREATE_ASSET_OBSERVATION") return "syncfield/foreman/asset-observations";
  if (operation === "CREATE_SPAN_COMPLETION") return "syncfield/foreman/span-completions";
  if (operation === "CREATE_COIL_OBSERVATION") return "syncfield/foreman/coil-observations";
  return "syncfield/foreman/production/records";
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
      tick_start_label: str(mutation.payload.tick_start_label),
      tick_end_label: str(mutation.payload.tick_end_label),
      reel_cable_id: str(mutation.payload.reel_cable_id),
      fiber_type: str(mutation.payload.fiber_type),
      sequence_start: mutation.payload.sequence_start === undefined ? null : Number(mutation.payload.sequence_start),
      sequence_end: mutation.payload.sequence_end === undefined ? null : Number(mutation.payload.sequence_end),
      sequence_direction: sequenceDirection(mutation.payload.sequence_start, mutation.payload.sequence_end),
      sequence_calculated_footage: sequenceFootage(mutation.payload.sequence_start, mutation.payload.sequence_end),
      sequence_reported_variance: sequenceVariance(mutation.payload.sequence_start, mutation.payload.sequence_end, mutation.payload.reported_quantity),
      sequence_variance_status: sequenceVarianceStatus(mutation.payload.sequence_start, mutation.payload.sequence_end, mutation.payload.reported_quantity),
      notes: mutation.status === "PENDING" ? "Saved locally; waiting to sync." : mutation.lastSafeError ?? "Syncing saved field entry.",
      locked: false,
    };
  });
}

function sequenceFootage(start: unknown, end: unknown) {
  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) return null;
  return Math.abs(endNumber - startNumber);
}

function sequenceVariance(start: unknown, end: unknown, reported: unknown) {
  const calculated = sequenceFootage(start, end);
  const reportedNumber = Number(reported);
  if (calculated === null || !Number.isFinite(reportedNumber)) return null;
  return reportedNumber - calculated;
}

function sequenceVarianceStatus(start: unknown, end: unknown, reported: unknown) {
  const variance = sequenceVariance(start, end, reported);
  if (variance === null) return "not_applicable";
  return Math.abs(variance) > 25 ? "review_required" : "within_tolerance";
}

function sequenceDirection(start: unknown, end: unknown) {
  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) return null;
  if (endNumber > startNumber) return "increasing";
  if (endNumber < startNumber) return "decreasing";
  return "same";
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
