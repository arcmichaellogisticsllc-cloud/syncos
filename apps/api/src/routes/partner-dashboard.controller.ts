import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Query, Req } from "@nestjs/common";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

type PanelState = "READY" | "EMPTY" | "UNAVAILABLE" | "STALE" | "LOCKED";
type DashboardActionCategory = "needsYourAction" | "crewForemanAction" | "waitingInformational";
type PartnerDashboardContext = {
  tenantId: string;
  userId: string;
  userEmail: string | null;
  organizationId: string;
  organizationName: string;
  organizationStatus: string;
  capacityProviderId: string;
  capacityProviderName: string;
  providerStatus: string;
  providerVerificationStatus: string;
  providerContractStatus: string;
};

const partnerProviderTypes = new Set(["subcontractor", "crew_provider"]);
const panelNames = ["company", "crews", "todayByCrew", "workOrders", "production", "qcCorrections", "actions", "financial", "performance"] as const;

@Controller("partner")
export class PartnerDashboardController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get("dashboard")
  @RequirePermission("partner_profile.read")
  async dashboard(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string | undefined>, @Headers() headers: Record<string, string | string[] | undefined>) {
    this.rejectBrowserOrganizationScope(query, headers);
    const client = await this.pool.connect();
    const panelStatus = Object.fromEntries(panelNames.map((panel) => [panel, "READY" as PanelState]));
    const warnings: Array<{ panel: string; code: string; message: string }> = [];
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const clock = await client.query("SELECT now() AS as_of");
      const asOf = this.iso(clock.rows[0]?.as_of);
      const context = await this.resolvePartnerAdminContext(client, request);
      const company = await this.companyPanel(client, context, panelStatus, warnings);
      const crews = await this.crewsPanel(client, context, panelStatus, warnings);
      const todayByCrew = await this.todayByCrewPanel(client, context, panelStatus, warnings);
      const workOrders = await this.workOrdersPanel(client, context, panelStatus, warnings);
      const production = await this.productionPanel(client, context, panelStatus, warnings);
      const qcCorrections = await this.qcCorrectionsPanel(client, context, panelStatus, warnings);
      const financial = await this.financialPanel(client, context, panelStatus, warnings);
      const performance = await this.performancePanel(client, context, panelStatus, warnings);
      const actions = await this.actionsPanel(client, context, { company, crews, qcCorrections, financial }, panelStatus, warnings);
      await client.query("COMMIT");
      return {
        organization: {
          name: context.organizationName,
          status: context.organizationStatus,
          capacity_provider_name: context.capacityProviderName,
        },
        freshness: {
          asOf,
          calculatedAt: asOf,
          staleAfterSeconds: 300,
        },
        company,
        crews,
        todayByCrew,
        workOrders,
        production,
        qcCorrections,
        actions,
        financial,
        performance,
        panelStatus,
        warnings,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolvePartnerAdminContext(client: PoolClient, request: AuthenticatedRequest): Promise<PartnerDashboardContext> {
    const rows = await client.query(
      `
      SELECT u.id AS user_id, u.email AS user_email, r.system_key, o.id AS organization_id, o.name AS organization_name, o.status AS organization_status,
        cp.id AS capacity_provider_id, cp.name AS capacity_provider_name, cp.provider_type, cp.status AS provider_status,
        cp.verification_status, cp.contract_status
      FROM tenant_users tu
      JOIN users u ON u.id = tu.user_id
      JOIN user_roles ur ON ur.tenant_id = tu.tenant_id AND ur.tenant_user_id = tu.id AND ur.scope_type = 'organization'
      JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id AND r.system_key IN ('partner_admin','partner_foreman')
      JOIN organizations o ON o.tenant_id = ur.tenant_id AND o.id = ur.scope_id AND o.deleted_at IS NULL AND o.status <> 'inactive'
      JOIN capacity_providers cp ON cp.tenant_id = o.tenant_id AND cp.organization_id = o.id AND cp.deleted_at IS NULL
      WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.status = 'active' AND tu.deleted_at IS NULL
        AND cp.provider_type = ANY($3::text[])
        AND cp.status <> 'inactive'
      ORDER BY CASE r.system_key WHEN 'partner_admin' THEN 0 ELSE 1 END, o.name
      `,
      [request.auth.tenantId, request.auth.userId, Array.from(partnerProviderTypes)],
    );
    if (!rows.rows.length) throw new ForbiddenException("Partner Dashboard requires active Partner Administrator access");
    const organizationIds = Array.from(new Set(rows.rows.map((row) => row.organization_id)));
    if (organizationIds.length > 1) {
      throw new ConflictException({
        code: "PARTNER_ACCOUNT_ORGANIZATION_CONFLICT",
        message: "Your account has conflicting company access. Contact Sync Comm Systems support so we can correct your account.",
        reference: this.supportReference(request.auth.userId),
      });
    }
    const row = rows.rows.find((candidate) => candidate.organization_id === organizationIds[0] && (candidate.system_key === "partner_admin" || candidate.role_key === "partner_admin"));
    const selected = row ?? rows.rows[0];
    if (!rows.rows.some((candidate) => candidate.organization_id === selected.organization_id && (candidate.system_key === "partner_admin" || candidate.role_key === "partner_admin"))) {
      throw new ForbiddenException("Partner Dashboard requires Partner Administrator access");
    }
    return {
      tenantId: request.auth.tenantId,
      userId: request.auth.userId,
      userEmail: selected.user_email ?? null,
      organizationId: selected.organization_id,
      organizationName: selected.organization_name,
      organizationStatus: selected.organization_status,
      capacityProviderId: selected.capacity_provider_id,
      capacityProviderName: selected.capacity_provider_name,
      providerStatus: selected.provider_status,
      providerVerificationStatus: selected.verification_status,
      providerContractStatus: selected.contract_status,
    };
  }

  private async companyPanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "company", async () => {
      const result = await client.query(
        `
        SELECT
          EXISTS (SELECT 1 FROM partner_company_profiles WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'verified') AS company_profile_complete,
          EXISTS (SELECT 1 FROM partner_tax_profiles WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'verified') AS tax_complete,
          EXISTS (SELECT 1 FROM partner_payment_profiles WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'active') AS payment_complete,
          EXISTS (SELECT 1 FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'verified') AS insurance_complete,
          EXISTS (SELECT 1 FROM partner_agreement_versions WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status IN ('executed','effective')) AS agreement_complete,
          (SELECT min(expiration_date) FROM partner_insurance_policies WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND expiration_date >= CURRENT_DATE) AS next_insurance_expiration
        `,
        [context.tenantId, context.organizationId],
      );
      const row = result.rows[0] ?? {};
      const checks = ["company_profile_complete", "tax_complete", "payment_complete", "insurance_complete", "agreement_complete"];
      const requiredComplete = checks.filter((key) => row[key]).length;
      return {
        status: context.organizationStatus,
        providerStatus: context.providerStatus,
        verificationStatus: context.providerVerificationStatus,
        contractStatus: context.providerContractStatus,
        requiredComplete,
        requiredTotal: checks.length,
        nextInsuranceExpiration: row.next_insurance_expiration ?? null,
      };
    }, {
      status: context.organizationStatus,
      providerStatus: context.providerStatus,
      verificationStatus: context.providerVerificationStatus,
      contractStatus: context.providerContractStatus,
      requiredComplete: 0,
      requiredTotal: 0,
      nextInsuranceExpiration: null,
    });
  }

  private async crewsPanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "crews", async () => {
      const result = await client.query(
        `
        WITH crew_base AS (
          SELECT c.id, c.lifecycle_status, c.target_staffing_level,
            count(m.id) FILTER (WHERE m.status = 'active' AND m.deleted_at IS NULL) AS active_members,
            count(m.id) FILTER (WHERE m.status = 'active' AND m.deleted_at IS NULL AND m.membership_role = 'foreman') AS foremen
          FROM crews c
          LEFT JOIN partner_crew_memberships m ON m.tenant_id = c.tenant_id AND m.organization_id = c.organization_id AND m.crew_id = c.id
          WHERE c.tenant_id = $1 AND c.organization_id = $2 AND c.deleted_at IS NULL AND c.status = 'active'
          GROUP BY c.id
        ),
        assigned AS (
          SELECT DISTINCT assigned_crew_id AS crew_id
          FROM partner_work_order_versions
          WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status IN ('issued','partially_executed','executed','active','suspended')
        )
        SELECT
          count(*)::int AS active,
          count(*) FILTER (WHERE lifecycle_status = 'active' AND active_members >= target_staffing_level AND foremen = 1)::int AS ready,
          count(*) FILTER (WHERE NOT (lifecycle_status = 'active' AND active_members >= target_staffing_level AND foremen = 1))::int AS incomplete,
          count(*) FILTER (WHERE id IN (SELECT crew_id FROM assigned))::int AS assigned,
          count(*) FILTER (WHERE lifecycle_status IN ('suspended','inactive') OR active_members < target_staffing_level OR foremen <> 1)::int AS blocked
        FROM crew_base
        `,
        [context.tenantId, context.organizationId],
      );
      const row = result.rows[0] ?? {};
      return { active: this.int(row.active), ready: this.int(row.ready), incomplete: this.int(row.incomplete), assigned: this.int(row.assigned), activeToday: 0, blocked: this.int(row.blocked) };
    }, { active: 0, ready: 0, incomplete: 0, assigned: 0, activeToday: 0, blocked: 0 });
  }

  private async todayByCrewPanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "todayByCrew", async () => {
      const result = await client.query(
        `
        SELECT c.name AS crew_name, concat_ws(' ', w.first_name, w.last_name) AS foreman_name,
          wov.work_order_number, p.name AS project_name, COALESCE(psa.timezone, 'UTC') AS timezone,
          COALESCE(dpr.work_date, CURRENT_DATE) AS work_date,
          COALESCE(j.status, 'required') AS jsa_status,
          COALESCE(dpr.status, 'no_report') AS production_status,
          dpr.submitted_at,
          dpr.customer_qc_outcome,
          COALESCE(json_agg(json_build_object(
            'label', COALESCE(spc.description, pr.production_type, 'Production'),
            'quantity', pr.quantity_submitted::text,
            'unit', COALESCE(spc.unit_of_measure, pr.unit, 'Unit')
          ) ORDER BY COALESCE(spc.description, pr.production_type, 'Production')) FILTER (WHERE pr.id IS NOT NULL), '[]'::json) AS reported_quantities,
          max(GREATEST(COALESCE(dpr.updated_at, dpr.created_at), COALESCE(j.updated_at, j.created_at), COALESCE(wov.updated_at, wov.created_at))) AS last_activity
        FROM partner_work_order_versions wov
        JOIN projects p ON p.tenant_id = wov.tenant_id AND p.id = wov.project_id
        JOIN crews c ON c.tenant_id = wov.tenant_id AND c.id = wov.assigned_crew_id
        LEFT JOIN partner_crew_memberships fm ON fm.tenant_id = c.tenant_id AND fm.organization_id = c.organization_id AND fm.crew_id = c.id AND fm.membership_role = 'foreman' AND fm.status = 'active' AND fm.deleted_at IS NULL
        LEFT JOIN workers w ON w.tenant_id = fm.tenant_id AND w.id = fm.worker_id
        LEFT JOIN production_start_authorizations psa ON psa.tenant_id = wov.tenant_id AND psa.work_order_version_id = wov.id AND psa.superseded_by_authorization_id IS NULL AND psa.deleted_at IS NULL
        LEFT JOIN daily_jsas j ON j.tenant_id = wov.tenant_id AND j.work_order_version_id = wov.id AND j.crew_id = wov.assigned_crew_id AND j.work_date = CURRENT_DATE AND j.deleted_at IS NULL
        LEFT JOIN daily_production_reports dpr ON dpr.tenant_id = wov.tenant_id AND dpr.work_order_version_id = wov.id AND dpr.crew_id = wov.assigned_crew_id AND dpr.work_date = CURRENT_DATE AND dpr.current = true AND dpr.deleted_at IS NULL AND dpr.status <> 'void'
        LEFT JOIN production_records pr ON pr.tenant_id = dpr.tenant_id AND pr.daily_production_report_id = dpr.id AND pr.deleted_at IS NULL
        LEFT JOIN syncfield_production_codes spc ON spc.tenant_id = pr.tenant_id AND spc.id = pr.syncfield_production_code_id
        WHERE wov.tenant_id = $1 AND wov.organization_id = $2 AND wov.deleted_at IS NULL AND wov.status IN ('issued','partially_executed','executed','active','suspended')
        GROUP BY c.name, w.first_name, w.last_name, wov.work_order_number, p.name, psa.timezone, dpr.work_date, j.status, dpr.status, dpr.submitted_at, dpr.customer_qc_outcome
        ORDER BY c.name
        LIMIT 12
        `,
        [context.tenantId, context.organizationId],
      );
      return result.rows.map((row) => ({
        crewName: row.crew_name ?? "Crew",
        foremanName: row.foreman_name || "Foreman not assigned",
        workOrderNumber: row.work_order_number ?? "Work Order",
        projectName: row.project_name ?? "Assigned Project",
        workDate: row.work_date,
        timezone: row.timezone ?? "UTC",
        jsaStatus: this.presentationStatus(row.jsa_status),
        productionStatus: row.submitted_at ? "Submitted" : this.presentationStatus(row.production_status),
        reportedQuantities: row.reported_quantities ?? [],
        qcStatus: this.presentationStatus(row.customer_qc_outcome ?? "pending_customer_qc"),
        correctionStatus: /correction|required|rejected/i.test(String(row.customer_qc_outcome ?? "")) ? "Correction Required" : "No open correction",
        lastActivity: this.iso(row.last_activity),
        crewRoute: "/partner/crews",
        workOrderRoute: "/partner/work-orders",
      }));
    }, []);
  }

  private async workOrdersPanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "workOrders", async () => {
      const result = await client.query(
        `
        SELECT wov.id, wov.work_order_number, wov.status, p.name AS project_name, c.name AS crew_name,
          wov.map_work_package_ref, wo.partner_execution_status, wov.updated_at,
          EXISTS (SELECT 1 FROM rate_schedules rs WHERE rs.tenant_id = wov.tenant_id AND rs.id = wov.rate_schedule_id AND rs.deleted_at IS NULL) AS partner_rate_available
        FROM partner_work_order_versions wov
        JOIN work_orders wo ON wo.tenant_id = wov.tenant_id AND wo.id = wov.work_order_id
        JOIN projects p ON p.tenant_id = wov.tenant_id AND p.id = wov.project_id
        JOIN crews c ON c.tenant_id = wov.tenant_id AND c.id = wov.assigned_crew_id
        WHERE wov.tenant_id = $1 AND wov.organization_id = $2 AND wov.deleted_at IS NULL AND wov.status IN ('issued','partially_executed','executed','active','suspended')
        ORDER BY wov.updated_at DESC
        LIMIT 8
        `,
        [context.tenantId, context.organizationId],
      );
      return {
        active: result.rows.filter((row) => !/suspended|blocked/i.test(String(row.status))).length,
        blocked: result.rows.filter((row) => /suspended|blocked/i.test(String(row.status))).length,
        items: result.rows.map((row) => ({
          workOrderNumber: row.work_order_number,
          projectName: row.project_name,
          crewName: row.crew_name,
          status: this.presentationStatus(row.status),
          mobilizationState: this.presentationStatus(row.partner_execution_status ?? row.status),
          productionState: "See Production",
          qcState: "See QC",
          partnerRateAvailability: row.partner_rate_available ? "Available in Work Order detail" : "Not issued",
          route: "/partner/work-orders",
        })),
      };
    }, { active: 0, blocked: 0, items: [] });
  }

  private async productionPanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "production", async () => {
      const result = await client.query(
        `
        WITH reported AS (
          SELECT COALESCE(spc.code, pr.production_type, 'Production') AS code,
            COALESCE(spc.description, pr.production_type, 'Production') AS description,
            COALESCE(spc.unit_of_measure, pr.unit, 'Unit') AS unit,
            COALESCE(sum(pr.quantity_submitted),0)::numeric AS reported_quantity
          FROM daily_production_reports dpr
          JOIN production_records pr ON pr.tenant_id = dpr.tenant_id AND pr.daily_production_report_id = dpr.id AND pr.deleted_at IS NULL
          LEFT JOIN syncfield_production_codes spc ON spc.tenant_id = pr.tenant_id AND spc.id = pr.syncfield_production_code_id
          WHERE dpr.tenant_id = $1 AND dpr.organization_id = $2 AND dpr.current = true AND dpr.deleted_at IS NULL AND dpr.status <> 'void'
          GROUP BY COALESCE(spc.code, pr.production_type, 'Production'), COALESCE(spc.description, pr.production_type, 'Production'), COALESCE(spc.unit_of_measure, pr.unit, 'Unit')
        ),
        accepted AS (
          SELECT production_code AS code, COALESCE(production_description, production_code) AS description, unit_of_measure AS unit,
            COALESCE(sum(accepted_quantity),0)::numeric AS accepted_quantity
          FROM accepted_production_financial_sources
          WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND financial_status <> 'void' AND source_kind IN ('accepted_production','partner_coil_supplement')
          GROUP BY production_code, COALESCE(production_description, production_code), unit_of_measure
        )
        SELECT COALESCE(r.code, a.code) AS code, COALESCE(r.description, a.description) AS description, COALESCE(r.unit, a.unit) AS unit,
          COALESCE(r.reported_quantity,0)::text AS reported_quantity,
          COALESCE(a.accepted_quantity,0)::text AS accepted_quantity,
          GREATEST(COALESCE(r.reported_quantity,0) - COALESCE(a.accepted_quantity,0), 0)::text AS correction_quantity
        FROM reported r
        FULL OUTER JOIN accepted a ON a.code = r.code AND a.unit = r.unit
        ORDER BY COALESCE(r.description, a.description)
        LIMIT 20
        `,
        [context.tenantId, context.organizationId],
      );
      return {
        rows: result.rows.map((row) => ({
          label: row.description ?? row.code ?? "Production",
          code: row.code ?? "Production",
          unit: row.unit ?? "Unit",
          reported: row.reported_quantity ?? "0",
          accepted: row.accepted_quantity ?? "0",
          correction: row.correction_quantity ?? "0",
        })),
      };
    }, { rows: [] });
  }

  private async qcCorrectionsPanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "qcCorrections", async () => {
      const result = await client.query(
        `
        SELECT pc.id, pc.status, pc.partner_safe_instructions, pc.due_date, pc.created_at,
          wov.work_order_number, c.name AS crew_name, cqd.reported_quantity::text, cqd.customer_accepted_quantity::text, cqd.unit_of_measure
        FROM production_corrections pc
        JOIN customer_qc_decisions cqd ON cqd.tenant_id = pc.tenant_id AND cqd.id = pc.customer_qc_decision_id
        JOIN production_records pr ON pr.tenant_id = pc.tenant_id AND pr.id = pc.production_record_id
        JOIN partner_work_order_versions wov ON wov.tenant_id = pc.tenant_id AND wov.id = pr.work_order_version_id
        JOIN crews c ON c.tenant_id = pc.tenant_id AND c.id = pc.crew_id
        WHERE pc.tenant_id = $1 AND pc.partner_organization_id = $2 AND pc.deleted_at IS NULL AND pc.status NOT IN ('resolved','cancelled')
        ORDER BY pc.created_at DESC
        LIMIT 10
        `,
        [context.tenantId, context.organizationId],
      );
      const pending = await client.query("SELECT count(*)::int AS count FROM customer_qc_cycles WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND status IN ('awaiting_customer','awaiting_reinspection')", [context.tenantId, context.organizationId]);
      return {
        openCorrectionCount: result.rows.length,
        qcPendingCount: this.int(pending.rows[0]?.count),
        items: result.rows.map((row) => ({
          workOrderNumber: row.work_order_number,
          crewName: row.crew_name,
          status: this.presentationStatus(row.status),
          reportedQuantity: row.reported_quantity,
          acceptedQuantity: row.customer_accepted_quantity,
          unit: row.unit_of_measure,
          instruction: row.partner_safe_instructions,
          dueDate: row.due_date,
          route: "/partner/customer-qc",
        })),
      };
    }, { openCorrectionCount: 0, qcPendingCount: 0, items: [] });
  }

  private async financialPanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "financial", async () => {
      const totals = await client.query(
        `
        SELECT
          (SELECT COALESCE(sum(net_settlement_amount),0)::numeric::text FROM settlements s WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.settlement_type = 'contractor_payable' AND EXISTS (SELECT 1 FROM settlement_items si WHERE si.tenant_id = s.tenant_id AND si.settlement_id = s.id AND si.partner_organization_id = $2 AND si.deleted_at IS NULL)) AS issued_settlements,
          (SELECT COALESCE(sum(GREATEST(net_payable_amount - paid_amount, 0)),0)::numeric::text FROM contractor_payables WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL) AS outstanding_payable,
          (SELECT COALESCE(sum(eligible_amount),0)::numeric::text FROM contractor_payables WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND pay_when_paid_status IN ('eligible','partially_eligible')) AS eligible_payment,
          (SELECT COALESCE(sum(net_payable_amount),0)::numeric::text FROM contractor_payables WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND pay_when_paid_status = 'awaiting_customer_funds') AS awaiting_funds,
          (SELECT COALESCE(sum(in_flight_payment_amount),0)::numeric::text FROM contractor_payables WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL) AS processing,
          (SELECT COALESCE(sum(amount),0)::numeric::text FROM partner_payment_instructions WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND status = 'confirmed' AND requested_at >= date_trunc('month', now())) AS paid_this_month
        `,
        [context.tenantId, context.organizationId],
      );
      const accepted = await client.query(
        `
        SELECT production_code AS code, COALESCE(production_description, production_code) AS label, unit_of_measure AS unit,
          sum(accepted_quantity)::numeric::text AS quantity,
          max(commercial_treatment) FILTER (WHERE source_kind = 'partner_coil_supplement') AS partner_coil_treatment
        FROM accepted_production_financial_sources
        WHERE tenant_id = $1 AND partner_organization_id = $2 AND deleted_at IS NULL AND financial_status <> 'void' AND settlement_item_id IS NULL
        GROUP BY production_code, COALESCE(production_description, production_code), unit_of_measure
        ORDER BY label
        LIMIT 20
        `,
        [context.tenantId, context.organizationId],
      );
      const row = totals.rows[0] ?? {};
      return {
        currency: "USD",
        issuedSettlements: this.money(row.issued_settlements),
        outstandingPayable: this.money(row.outstanding_payable),
        eligiblePayment: this.money(row.eligible_payment),
        awaitingFunds: this.money(row.awaiting_funds),
        processing: this.money(row.processing),
        paidThisMonth: this.money(row.paid_this_month),
        acceptedProductionAwaitingSettlement: accepted.rows.map((item) => ({
          label: item.label,
          code: item.code,
          unit: item.unit,
          quantity: item.quantity,
          partnerCoilTreatment: item.partner_coil_treatment ?? null,
        })),
      };
    }, {
      currency: "USD",
      issuedSettlements: this.money("0"),
      outstandingPayable: this.money("0"),
      eligiblePayment: this.money("0"),
      awaitingFunds: this.money("0"),
      processing: this.money("0"),
      paidThisMonth: this.money("0"),
      acceptedProductionAwaitingSettlement: [],
    });
  }

  private async performancePanel(client: PoolClient, context: PartnerDashboardContext, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>) {
    return this.optionalPanel(client, panelStatus, warnings, "performance", async () => {
      const result = await client.query(
        `
        SELECT score::float AS score, confidence, trend, score_band, critical_risk_count, calculated_at
        FROM partner_performance_snapshots
        WHERE tenant_id = $1 AND partner_organization_id = $2 AND current = true
        ORDER BY calculated_at DESC
        LIMIT 1
        `,
        [context.tenantId, context.organizationId],
      );
      if (!result.rows[0]) {
        panelStatus.performance = "EMPTY";
        return { status: "not_available", confidence: "low", trend: "insufficient_data", score: null, criticalRiskCount: 0, signals: ["Performance confidence is low until enough current Partner work is reviewed."] };
      }
      const row = result.rows[0];
      return {
        status: row.score_band,
        score: row.score,
        confidence: row.confidence,
        trend: row.trend,
        criticalRiskCount: this.int(row.critical_risk_count),
        calculatedAt: this.iso(row.calculated_at),
        signals: row.confidence === "low" ? ["Low confidence: more reviewed work is required before this score is stable."] : [],
      };
    }, { status: "unavailable", confidence: "low", trend: "insufficient_data", score: null, criticalRiskCount: 0, signals: [] });
  }

  private async actionsPanel(
    client: PoolClient,
    context: PartnerDashboardContext,
    panels: { company: QueryResultRow; crews: QueryResultRow; qcCorrections: QueryResultRow; financial: QueryResultRow },
    panelStatus: Record<string, PanelState>,
    warnings: Array<{ panel: string; code: string; message: string }>,
  ) {
    return this.optionalPanel(client, panelStatus, warnings, "actions", async () => {
      const actions: Array<Record<string, unknown>> = [];
      if (this.int(panels.company.requiredComplete) < this.int(panels.company.requiredTotal)) {
        actions.push(this.action("onboarding_incomplete", "needsYourAction", "HIGH", "Complete Partner onboarding", `${panels.company.requiredComplete} of ${panels.company.requiredTotal} required items are complete.`, "Partner onboarding", "/partner/onboarding", "Complete Onboarding", true));
      }
      if (panels.company.nextInsuranceExpiration) {
        actions.push(this.action("insurance_expires_soon", "needsYourAction", "MEDIUM", "Insurance expiration approaching", "A current insurance policy is approaching expiration.", "Partner compliance", "/partner/compliance", "Resolve Insurance", true));
      }
      if (this.int(panels.crews.blocked) > 0) {
        actions.push(this.action("crew_readiness_blocked", "needsYourAction", "HIGH", "Crew readiness needs attention", `${panels.crews.blocked} Crew readiness issue${this.int(panels.crews.blocked) === 1 ? "" : "s"} require Partner review.`, "Crew readiness", "/partner/crews", "View Crews", true));
      }
      for (const item of (panels.qcCorrections.items ?? []) as Array<Record<string, unknown>>) {
        actions.push(this.action(`correction_required:${item.workOrderNumber}:${item.crewName}`, "crewForemanAction", "HIGH", "Customer correction required", String(item.instruction ?? "A Customer QC correction requires Foreman action in SyncField."), `${item.workOrderNumber ?? "Work Order"} · ${item.crewName ?? "Crew"}`, "/partner/customer-qc", "View Correction", true));
      }
      if (this.int(panels.qcCorrections.qcPendingCount) > 0) {
        actions.push(this.action("customer_qc_pending", "waitingInformational", "INFO", "Customer QC pending", "Customer review is pending and is not a Partner-controlled blocker.", "Customer QC", "/partner/customer-qc", "View QC", false));
      }
      if (this.decimalIsPositive(panels.financial.awaitingFunds?.amount)) {
        actions.push(this.action("awaiting_customer_funds", "waitingInformational", "INFO", "Awaiting Customer Funds", "Payment eligibility is waiting on canonical funding conditions.", "Partner payable", "/partner/payments", "View Payments", false));
      }
      return {
        needsYourAction: this.dedupe(actions.filter((action) => action.category === "needsYourAction")),
        crewForemanAction: this.dedupe(actions.filter((action) => action.category === "crewForemanAction")),
        waitingInformational: this.dedupe(actions.filter((action) => action.category === "waitingInformational")),
      };
    }, { needsYourAction: [], crewForemanAction: [], waitingInformational: [] });
  }

  private async optionalPanel<T>(client: PoolClient, panelStatus: Record<string, PanelState>, warnings: Array<{ panel: string; code: string; message: string }>, panel: string, read: () => Promise<T>, fallback: T): Promise<T> {
    const savepoint = `dashboard_${panel.toLowerCase()}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const value = await read();
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      if (Array.isArray(value) && value.length === 0) panelStatus[panel] = "EMPTY";
      return value;
    } catch {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
      panelStatus[panel] = "UNAVAILABLE";
      warnings.push({ panel, code: "PARTNER_DASHBOARD_PANEL_UNAVAILABLE", message: "Dashboard panel data is temporarily unavailable." });
      return fallback;
    }
  }

  private action(reasonCode: string, category: DashboardActionCategory, severity: string, title: string, description: string, sourceBusinessLabel: string, ctaRoute: string, ctaLabel: string, blocking: boolean) {
    return {
      key: `${reasonCode}:${sourceBusinessLabel}`,
      reasonCode,
      category,
      severity,
      title,
      description,
      sourceType: reasonCode.split(":")[0],
      sourceBusinessLabel,
      ctaRoute,
      ctaLabel,
      blocking,
    };
  }

  private dedupe(actions: Array<Record<string, unknown>>) {
    return Array.from(new Map(actions.map((action) => [String(action.key), action])).values()).slice(0, 8);
  }

  private money(amount: unknown) {
    const value = String(amount ?? "0");
    return { amount: value, currency: "USD" };
  }

  private decimalIsPositive(value: unknown) {
    return /^-?\d+(\.\d+)?$/.test(String(value ?? "")) && Number(value) > 0;
  }

  private rejectBrowserOrganizationScope(query: Record<string, string | undefined>, headers: Record<string, string | string[] | undefined>) {
    if (query.organization_id || query.organizationId || headers["x-scope-id"] || headers["x-scope-type"] || headers["x-partner-organization-id"]) {
      throw new BadRequestException({
        code: "PARTNER_BROWSER_ORGANIZATION_SCOPE_REJECTED",
        message: "Partner Dashboard organization context is resolved from your account, not browser selection.",
      });
    }
  }

  private presentationStatus(value: unknown) {
    return String(value ?? "Not Started").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private int(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private iso(value: unknown) {
    if (!value) return new Date().toISOString();
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  }

  private supportReference(userId: string) {
    return `partner-dashboard-${Buffer.from(userId).toString("base64url").slice(0, 10)}`;
  }
}
