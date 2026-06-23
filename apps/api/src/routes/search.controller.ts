import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../modules/database.module";
import { RequirePermission } from "../security/require-permission.decorator";
import type { AuthenticatedRequest } from "./intelligence.types";

@Controller("search")
export class SearchController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @RequirePermission("search.read")
  async search(@Req() request: AuthenticatedRequest, @Query("q") q?: string, @Query("archived") archived?: string) {
    const query = typeof q === "string" ? q.trim() : "";
    if (!query) return [];
    const search = `%${query}%`;
    const includeArchived = archived === "true";
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT 'territory' AS object_type, id, name AS title, status, name AS snippet
        FROM territories
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (name ILIKE $2 OR code ILIKE $2)
        UNION ALL
        SELECT 'organization' AS object_type, id, name AS title, status, concat_ws(' ', name, type, source_name) AS snippet
        FROM organizations
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (name ILIKE $2 OR type ILIKE $2 OR source_name ILIKE $2)
        UNION ALL
        SELECT 'contact' AS object_type, id, coalesce(full_name, concat_ws(' ', first_name, last_name)) AS title, status, concat_ws(' ', full_name, first_name, last_name, email, phone) AS snippet
        FROM contacts
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          full_name ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2
        )
        UNION ALL
        SELECT 'signal' AS object_type, id, title, status, concat_ws(' ', title, description, signal_type, signal_category, source_name) AS snippet
        FROM signals
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          title ILIKE $2 OR description ILIKE $2 OR signal_type ILIKE $2 OR signal_category ILIKE $2 OR source_name ILIKE $2
        )
        UNION ALL
        SELECT 'relationship_map' AS object_type, id, name AS title, status, concat_ws(' ', name, status, root_entity_type, target_object_type) AS snippet
        FROM relationship_maps
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR status ILIKE $2 OR root_entity_type ILIKE $2 OR target_object_type ILIKE $2
        )
        UNION ALL
        SELECT 'opportunity_candidate' AS object_type, id, coalesce(name, title) AS title, status, concat_ws(' ', name, title, work_type, evidence_summary, status) AS snippet
        FROM opportunity_candidates
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR title ILIKE $2 OR work_type ILIKE $2 OR evidence_summary ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'opportunity' AS object_type, id, title, status, concat_ws(' ', title, work_type, evidence_summary, scope_summary, status, recommendation) AS snippet
        FROM opportunities
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          title ILIKE $2 OR work_type ILIKE $2 OR evidence_summary ILIKE $2 OR scope_summary ILIKE $2 OR status ILIKE $2 OR recommendation ILIKE $2
        )
        UNION ALL
        SELECT 'coverage_plan' AS object_type, cp.id, concat('Coverage Plan: ', o.title) AS title, cp.status, concat_ws(' ', o.title, cp.status, cp.coverage_readiness_band, cp.notes) AS snippet
        FROM coverage_plans cp
        JOIN opportunities o ON o.id = cp.opportunity_id AND o.tenant_id = cp.tenant_id
        WHERE cp.tenant_id = $1
          AND cp.deleted_at IS NULL
          AND ($3::boolean OR (cp.archived_at IS NULL AND cp.status <> 'archived'))
          AND (
            o.title ILIKE $2 OR cp.status ILIKE $2 OR cp.coverage_readiness_band ILIKE $2 OR cp.notes ILIKE $2
          )
        UNION ALL
        SELECT 'project_handoff' AS object_type, ph.id, concat('Project Handoff: ', o.title) AS title, ph.status, concat_ws(' ', o.title, ph.status, ph.handoff_readiness_band, ph.scope_summary, ph.location_summary, ph.handoff_notes) AS snippet
        FROM project_handoffs ph
        JOIN opportunities o ON o.id = ph.opportunity_id AND o.tenant_id = ph.tenant_id
        WHERE ph.tenant_id = $1
          AND ph.deleted_at IS NULL
          AND ($3::boolean OR (ph.archived_at IS NULL AND ph.status <> 'archived'))
          AND (
            o.title ILIKE $2 OR ph.status ILIKE $2 OR ph.handoff_readiness_band ILIKE $2 OR ph.scope_summary ILIKE $2 OR ph.location_summary ILIKE $2 OR ph.handoff_notes ILIKE $2
          )
        UNION ALL
        SELECT 'capacity_requirement' AS object_type, id, capacity_type AS title, status, concat_ws(' ', capacity_type, unit, status) AS snippet
        FROM opportunity_capacity_requirements
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          capacity_type ILIKE $2 OR unit ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'capacity_provider' AS object_type, id, name AS title, status, concat_ws(' ', name, provider_type, status) AS snippet
        FROM capacity_providers
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR provider_type ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'crew' AS object_type, id, name AS title, status, concat_ws(' ', name, crew_type, status) AS snippet
        FROM crews
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR crew_type ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'worker' AS object_type, id, concat_ws(' ', first_name, last_name) AS title, status, concat_ws(' ', first_name, last_name, status) AS snippet
        FROM workers
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          first_name ILIKE $2 OR last_name ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'equipment' AS object_type, id, name AS title, status, concat_ws(' ', name, equipment_type, status) AS snippet
        FROM equipment
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR equipment_type ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'capacity_record' AS object_type, id, capacity_type AS title, compliance_status AS status, concat_ws(' ', capacity_type, unit, compliance_status, insurance_status) AS snippet
        FROM capacity_records
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          capacity_type ILIKE $2 OR unit ILIKE $2 OR compliance_status ILIKE $2 OR insurance_status ILIKE $2
        )
        UNION ALL
        SELECT 'project' AS object_type, p.id, p.name AS title, p.status, concat_ws(' ', p.name, p.scope_summary, p.location_summary, co.name, t.name, p.status) AS snippet
        FROM projects p
        LEFT JOIN organizations co ON co.tenant_id = p.tenant_id AND co.id = p.customer_organization_id
        LEFT JOIN territories t ON t.tenant_id = p.tenant_id AND t.id = p.territory_id
        WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND ($3::boolean OR p.status <> 'archived') AND (
          p.name ILIKE $2 OR p.scope_summary ILIKE $2 OR p.location_summary ILIKE $2 OR co.name ILIKE $2 OR t.name ILIKE $2 OR p.status ILIKE $2
        )
        UNION ALL
        SELECT 'work_order' AS object_type, id, coalesce(work_order_name, title) AS title, status, concat_ws(' ', work_order_name, title, work_order_number, customer_work_order_number, prime_work_order_number, scope_summary, location_summary, work_type, unit, status) AS snippet
        FROM work_orders
        WHERE tenant_id = $1 AND deleted_at IS NULL AND ($3::boolean OR status <> 'archived') AND (
          work_order_name ILIKE $2 OR title ILIKE $2 OR work_order_number ILIKE $2 OR customer_work_order_number ILIKE $2 OR prime_work_order_number ILIKE $2 OR scope_summary ILIKE $2 OR location_summary ILIKE $2 OR work_type ILIKE $2 OR unit ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'production_record' AS object_type, pr.id, concat_ws(' ', pr.production_type, wo.work_order_name, p.name) AS title, pr.status,
          concat_ws(' ', pr.production_type, pr.description, pr.production_notes, pr.location_summary, pr.route_name, pr.node_id, pr.segment_id, wo.work_order_name, wo.work_order_number, p.name, pr.unit_type, pr.status, pr.billable_status, pr.stop_work_status, pr.correction_reason, pr.rejection_reason) AS snippet
        FROM production_records pr
        LEFT JOIN work_orders wo ON wo.tenant_id = pr.tenant_id AND wo.id = pr.work_order_id
        LEFT JOIN projects p ON p.tenant_id = pr.tenant_id AND p.id = pr.project_id
        WHERE pr.tenant_id = $1 AND pr.deleted_at IS NULL AND ($3::boolean OR pr.status <> 'archived') AND (
          pr.production_type ILIKE $2 OR pr.description ILIKE $2 OR pr.production_notes ILIKE $2 OR pr.location_summary ILIKE $2 OR pr.route_name ILIKE $2 OR pr.node_id ILIKE $2 OR pr.segment_id ILIKE $2 OR wo.work_order_name ILIKE $2 OR wo.work_order_number ILIKE $2 OR p.name ILIKE $2 OR pr.unit_type ILIKE $2 OR pr.status ILIKE $2 OR pr.billable_status ILIKE $2 OR pr.stop_work_status ILIKE $2 OR pr.correction_reason ILIKE $2 OR pr.rejection_reason ILIKE $2
        )
        UNION ALL
        SELECT 'qc_review' AS object_type, qr.id, concat_ws(' ', qr.review_type, wo.work_order_name, p.name) AS title, qr.review_status AS status,
          concat_ws(' ', qr.review_type, qr.review_status, qr.review_notes, qr.rejection_reason, qr.correction_reason, pr.production_type, wo.work_order_name, wo.work_order_number, p.name) AS snippet
        FROM qc_reviews qr
        LEFT JOIN production_records pr ON pr.tenant_id = qr.tenant_id AND pr.id = qr.production_record_id
        LEFT JOIN work_orders wo ON wo.tenant_id = qr.tenant_id AND wo.id = qr.work_order_id
        LEFT JOIN projects p ON p.tenant_id = qr.tenant_id AND p.id = qr.project_id
        WHERE qr.tenant_id = $1 AND qr.deleted_at IS NULL AND ($3::boolean OR qr.review_status <> 'archived') AND (
          qr.review_type ILIKE $2 OR qr.review_status ILIKE $2 OR qr.review_notes ILIKE $2 OR qr.rejection_reason ILIKE $2 OR qr.correction_reason ILIKE $2 OR pr.production_type ILIKE $2 OR wo.work_order_name ILIKE $2 OR wo.work_order_number ILIKE $2 OR p.name ILIKE $2
        )
        UNION ALL
        SELECT 'billable_item' AS object_type, bi.id, concat_ws(' ', wo.work_order_name, p.name, co.name) AS title, bi.status,
          concat_ws(' ', bi.status, bi.readiness_status, bi.rate_description, bi.hold_reason, bi.dispute_reason, wo.work_order_name, wo.work_order_number, p.name, co.name) AS snippet
        FROM billable_items bi
        LEFT JOIN work_orders wo ON wo.tenant_id = bi.tenant_id AND wo.id = bi.work_order_id
        LEFT JOIN projects p ON p.tenant_id = bi.tenant_id AND p.id = bi.project_id
        LEFT JOIN organizations co ON co.tenant_id = bi.tenant_id AND co.id = bi.customer_organization_id
        WHERE bi.tenant_id = $1 AND bi.deleted_at IS NULL AND ($3::boolean OR bi.status <> 'archived') AND (
          bi.status ILIKE $2 OR bi.readiness_status ILIKE $2 OR bi.rate_description ILIKE $2 OR bi.hold_reason ILIKE $2 OR bi.dispute_reason ILIKE $2 OR wo.work_order_name ILIKE $2 OR wo.work_order_number ILIKE $2 OR p.name ILIKE $2 OR co.name ILIKE $2
        )
        UNION ALL
        SELECT 'contract' AS object_type, id, name AS title, status, concat_ws(' ', name, contract_number, contract_type, status) AS snippet
        FROM contracts
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          name ILIKE $2 OR contract_number ILIKE $2 OR contract_type ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'rate_schedule' AS object_type, id, name AS title, status, concat_ws(' ', name, status) AS snippet
        FROM rate_schedules
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (name ILIKE $2 OR status ILIKE $2)
        UNION ALL
        SELECT 'rate_code' AS object_type, id, code AS title, status, concat_ws(' ', code, description, unit_type, status) AS snippet
        FROM rate_codes
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          code ILIKE $2 OR description ILIKE $2 OR unit_type ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'settlement' AS object_type, s.id, coalesce(s.settlement_number, s.status) AS title, s.status,
          concat_ws(' ', s.settlement_number, s.settlement_type, s.status, s.hold_reason, s.dispute_reason, co.name, cp.name, p.name, wo.work_order_name) AS snippet
        FROM settlements s
        LEFT JOIN organizations co ON co.tenant_id = s.tenant_id AND co.id = s.customer_organization_id
        LEFT JOIN capacity_providers cp ON cp.tenant_id = s.tenant_id AND cp.id = s.capacity_provider_id
        LEFT JOIN projects p ON p.tenant_id = s.tenant_id AND p.id = s.project_id
        LEFT JOIN work_orders wo ON wo.tenant_id = s.tenant_id AND wo.id = s.work_order_id
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND ($3::boolean OR s.status <> 'archived') AND (
          s.settlement_number ILIKE $2 OR s.settlement_type ILIKE $2 OR s.status ILIKE $2 OR s.hold_reason ILIKE $2 OR s.dispute_reason ILIKE $2 OR co.name ILIKE $2 OR cp.name ILIKE $2 OR p.name ILIKE $2 OR wo.work_order_name ILIKE $2
        )
        UNION ALL
        SELECT 'settlement_item' AS object_type, si.id, concat_ws(' ', si.item_type, s.settlement_number) AS title, si.status,
          concat_ws(' ', si.item_type, si.status, si.hold_reason, si.dispute_reason, s.settlement_number, co.name, cp.name, p.name, wo.work_order_name) AS snippet
        FROM settlement_items si
        LEFT JOIN settlements s ON s.tenant_id = si.tenant_id AND s.id = si.settlement_id
        LEFT JOIN organizations co ON co.tenant_id = si.tenant_id AND co.id = si.customer_organization_id
        LEFT JOIN capacity_providers cp ON cp.tenant_id = si.tenant_id AND cp.id = si.capacity_provider_id
        LEFT JOIN projects p ON p.tenant_id = si.tenant_id AND p.id = si.project_id
        LEFT JOIN work_orders wo ON wo.tenant_id = si.tenant_id AND wo.id = si.work_order_id
        WHERE si.tenant_id = $1 AND si.deleted_at IS NULL AND ($3::boolean OR si.status <> 'archived') AND (
          si.item_type ILIKE $2 OR si.status ILIKE $2 OR si.hold_reason ILIKE $2 OR si.dispute_reason ILIKE $2 OR s.settlement_number ILIKE $2 OR co.name ILIKE $2 OR cp.name ILIKE $2 OR p.name ILIKE $2 OR wo.work_order_name ILIKE $2
        )
        UNION ALL
        SELECT 'invoice' AS object_type, i.id, i.invoice_number AS title, i.status,
          concat_ws(' ', i.invoice_number, i.status, i.delivery_status, i.cash_application_status, i.payment_status, i.collection_status, i.dispute_reason, co.name, p.name, s.settlement_number) AS snippet
        FROM invoices i
        LEFT JOIN organizations co ON co.tenant_id = i.tenant_id AND co.id = i.customer_organization_id
        LEFT JOIN projects p ON p.tenant_id = i.tenant_id AND p.id = i.project_id
        LEFT JOIN settlements s ON s.tenant_id = i.tenant_id AND s.id = i.settlement_id
        WHERE i.tenant_id = $1 AND i.deleted_at IS NULL AND ($3::boolean OR i.status <> 'archived') AND (
          i.invoice_number ILIKE $2 OR i.status ILIKE $2 OR i.delivery_status ILIKE $2 OR i.cash_application_status ILIKE $2 OR i.payment_status ILIKE $2 OR i.collection_status ILIKE $2 OR i.dispute_reason ILIKE $2 OR co.name ILIKE $2 OR p.name ILIKE $2 OR s.settlement_number ILIKE $2
        )
        UNION ALL
        SELECT 'invoice_item' AS object_type, ii.id, concat_ws(' ', ii.item_type, i.invoice_number) AS title, ii.status,
          concat_ws(' ', ii.item_type, ii.status, ii.description, i.invoice_number, co.name, p.name, s.settlement_number) AS snippet
        FROM invoice_items ii
        LEFT JOIN invoices i ON i.tenant_id = ii.tenant_id AND i.id = ii.invoice_id
        LEFT JOIN organizations co ON co.tenant_id = ii.tenant_id AND co.id = ii.customer_organization_id
        LEFT JOIN projects p ON p.tenant_id = ii.tenant_id AND p.id = ii.project_id
        LEFT JOIN settlements s ON s.tenant_id = ii.tenant_id AND s.id = ii.settlement_id
        WHERE ii.tenant_id = $1 AND ii.deleted_at IS NULL AND ($3::boolean OR ii.status <> 'archived') AND (
          ii.item_type ILIKE $2 OR ii.status ILIKE $2 OR ii.description ILIKE $2 OR i.invoice_number ILIKE $2 OR co.name ILIKE $2 OR p.name ILIKE $2 OR s.settlement_number ILIKE $2
        )
        UNION ALL
        SELECT 'cash_receipt' AS object_type, cr.id, cr.receipt_number AS title, cr.receipt_status AS status,
          concat_ws(' ', cr.receipt_number, cr.payment_reference, cr.external_transaction_id, cr.payer_name, cr.receipt_status, co.name) AS snippet
        FROM cash_receipts cr
        LEFT JOIN organizations co ON co.tenant_id = cr.tenant_id AND co.id = cr.customer_organization_id
        WHERE cr.tenant_id = $1 AND cr.deleted_at IS NULL AND ($3::boolean OR cr.receipt_status <> 'archived') AND (
          cr.receipt_number ILIKE $2 OR cr.payment_reference ILIKE $2 OR cr.external_transaction_id ILIKE $2 OR cr.payer_name ILIKE $2 OR cr.receipt_status ILIKE $2 OR co.name ILIKE $2
        )
        UNION ALL
        SELECT 'payment_application' AS object_type, pa.id, concat_ws(' ', cr.receipt_number, i.invoice_number) AS title, pa.application_status AS status,
          concat_ws(' ', pa.application_type, pa.application_status, cr.receipt_number, cr.payment_reference, i.invoice_number, co.name) AS snippet
        FROM payment_applications pa
        JOIN cash_receipts cr ON cr.tenant_id = pa.tenant_id AND cr.id = pa.cash_receipt_id
        JOIN invoices i ON i.tenant_id = pa.tenant_id AND i.id = pa.invoice_id
        LEFT JOIN organizations co ON co.tenant_id = pa.tenant_id AND co.id = pa.customer_organization_id
        WHERE pa.tenant_id = $1 AND pa.deleted_at IS NULL AND ($3::boolean OR pa.application_status <> 'archived') AND (
          pa.application_type ILIKE $2 OR pa.application_status ILIKE $2 OR cr.receipt_number ILIKE $2 OR cr.payment_reference ILIKE $2 OR i.invoice_number ILIKE $2 OR co.name ILIKE $2
        )
        UNION ALL
        SELECT 'collection_case' AS object_type, cc.id, cc.case_number AS title, cc.case_status AS status,
          concat_ws(' ', cc.case_number, cc.case_status, cc.collection_priority, cc.risk_level, cc.aging_bucket, cc.notes, i.invoice_number, co.name) AS snippet
        FROM collection_cases cc
        JOIN invoices i ON i.tenant_id = cc.tenant_id AND i.id = cc.invoice_id
        LEFT JOIN organizations co ON co.tenant_id = cc.tenant_id AND co.id = cc.customer_organization_id
        WHERE cc.tenant_id = $1 AND ($3::boolean OR (cc.deleted_at IS NULL AND cc.case_status <> 'archived')) AND (
          cc.case_number ILIKE $2 OR cc.case_status ILIKE $2 OR cc.collection_priority ILIKE $2 OR cc.risk_level ILIKE $2 OR cc.aging_bucket ILIKE $2 OR cc.notes ILIKE $2 OR i.invoice_number ILIKE $2 OR co.name ILIKE $2
        )
        UNION ALL
        SELECT 'collection_action' AS object_type, ca.id, concat_ws(' ', ca.action_type, cc.case_number) AS title, ca.action_status AS status,
          concat_ws(' ', ca.action_type, ca.action_status, ca.note, ca.dispute_reason, ca.escalation_reason, ca.outcome, cc.case_number, i.invoice_number, co.name) AS snippet
        FROM collection_actions ca
        JOIN collection_cases cc ON cc.tenant_id = ca.tenant_id AND cc.id = ca.collection_case_id
        JOIN invoices i ON i.tenant_id = ca.tenant_id AND i.id = ca.invoice_id
        LEFT JOIN organizations co ON co.tenant_id = ca.tenant_id AND co.id = ca.customer_organization_id
        WHERE ca.tenant_id = $1 AND ($3::boolean OR (ca.deleted_at IS NULL AND ca.action_status <> 'archived')) AND (
          ca.action_type ILIKE $2 OR ca.action_status ILIKE $2 OR ca.note ILIKE $2 OR ca.dispute_reason ILIKE $2 OR ca.escalation_reason ILIKE $2 OR ca.outcome ILIKE $2 OR cc.case_number ILIKE $2 OR i.invoice_number ILIKE $2 OR co.name ILIKE $2
        )
        UNION ALL
        SELECT 'contractor_payable' AS object_type, cp.id, cp.payable_number AS title, cp.status,
          concat_ws(' ', cp.payable_number, cp.payable_type, cp.payable_party_type, cp.status, cp.payment_readiness_status, cp.payment_status, cp.hold_reason, cp.dispute_reason, provider.name, crew.name, project.name, settlement.settlement_number) AS snippet
        FROM contractor_payables cp
        LEFT JOIN capacity_providers provider ON provider.tenant_id = cp.tenant_id AND provider.id = cp.capacity_provider_id
        LEFT JOIN crews crew ON crew.tenant_id = cp.tenant_id AND crew.id = cp.crew_id
        LEFT JOIN projects project ON project.tenant_id = cp.tenant_id AND project.id = cp.project_id
        LEFT JOIN settlements settlement ON settlement.tenant_id = cp.tenant_id AND settlement.id = cp.settlement_id
        WHERE cp.tenant_id = $1 AND cp.deleted_at IS NULL AND ($3::boolean OR cp.status <> 'archived') AND (
          cp.payable_number ILIKE $2 OR cp.payable_type ILIKE $2 OR cp.payable_party_type ILIKE $2 OR cp.status ILIKE $2 OR cp.payment_readiness_status ILIKE $2 OR cp.payment_status ILIKE $2 OR cp.hold_reason ILIKE $2 OR cp.dispute_reason ILIKE $2 OR provider.name ILIKE $2 OR crew.name ILIKE $2 OR project.name ILIKE $2 OR settlement.settlement_number ILIKE $2
        )
        UNION ALL
        SELECT 'contractor_payable_item' AS object_type, cpi.id, concat_ws(' ', cpi.item_type, cp.payable_number) AS title, cpi.status,
          concat_ws(' ', cpi.item_type, cpi.status, cpi.description, cp.payable_number, provider.name, crew.name, project.name, settlement.settlement_number) AS snippet
        FROM contractor_payable_items cpi
        JOIN contractor_payables cp ON cp.tenant_id = cpi.tenant_id AND cp.id = cpi.contractor_payable_id
        LEFT JOIN capacity_providers provider ON provider.tenant_id = cpi.tenant_id AND provider.id = cpi.capacity_provider_id
        LEFT JOIN crews crew ON crew.tenant_id = cpi.tenant_id AND crew.id = cpi.crew_id
        LEFT JOIN projects project ON project.tenant_id = cpi.tenant_id AND project.id = cpi.project_id
        LEFT JOIN settlements settlement ON settlement.tenant_id = cpi.tenant_id AND settlement.id = cpi.settlement_id
        WHERE cpi.tenant_id = $1 AND cpi.deleted_at IS NULL AND ($3::boolean OR cpi.status <> 'archived') AND (
          cpi.item_type ILIKE $2 OR cpi.status ILIKE $2 OR cpi.description ILIKE $2 OR cp.payable_number ILIKE $2 OR provider.name ILIKE $2 OR crew.name ILIKE $2 OR project.name ILIKE $2 OR settlement.settlement_number ILIKE $2
        )
        UNION ALL
        SELECT 'payroll_run' AS object_type, pr.id, pr.payroll_run_number AS title, pr.status,
          concat_ws(' ', pr.payroll_run_number, pr.payroll_run_type, pr.status, pr.payroll_readiness_status, pr.payroll_cycle, pr.hold_reason, pr.dispute_reason, project.name, crew.name) AS snippet
        FROM payroll_runs pr
        LEFT JOIN projects project ON project.tenant_id = pr.tenant_id AND project.id = pr.project_id
        LEFT JOIN crews crew ON crew.tenant_id = pr.tenant_id AND crew.id = pr.crew_id
        WHERE pr.tenant_id = $1 AND pr.deleted_at IS NULL AND ($3::boolean OR pr.status <> 'archived') AND (
          pr.payroll_run_number ILIKE $2 OR pr.payroll_run_type ILIKE $2 OR pr.status ILIKE $2 OR pr.payroll_readiness_status ILIKE $2 OR pr.payroll_cycle ILIKE $2 OR pr.hold_reason ILIKE $2 OR pr.dispute_reason ILIKE $2 OR project.name ILIKE $2 OR crew.name ILIKE $2
        )
        UNION ALL
        SELECT 'payroll_item' AS object_type, pi.id, concat_ws(' ', pi.earning_type, pr.payroll_run_number) AS title, pi.status,
          concat_ws(' ', pi.source_type, pi.earning_type, pi.status, pi.worker_classification, pi.description, pr.payroll_run_number, w.first_name, w.last_name, project.name, crew.name) AS snippet
        FROM payroll_items pi
        JOIN payroll_runs pr ON pr.tenant_id = pi.tenant_id AND pr.id = pi.payroll_run_id
        JOIN workers w ON w.tenant_id = pi.tenant_id AND w.id = pi.worker_id
        LEFT JOIN projects project ON project.tenant_id = pi.tenant_id AND project.id = pi.project_id
        LEFT JOIN crews crew ON crew.tenant_id = pi.tenant_id AND crew.id = pi.crew_id
        WHERE pi.tenant_id = $1 AND pi.deleted_at IS NULL AND ($3::boolean OR pi.status <> 'archived') AND (
          pi.source_type ILIKE $2 OR pi.earning_type ILIKE $2 OR pi.status ILIKE $2 OR pi.worker_classification ILIKE $2 OR pi.description ILIKE $2 OR pr.payroll_run_number ILIKE $2 OR w.first_name ILIKE $2 OR w.last_name ILIKE $2 OR project.name ILIKE $2 OR crew.name ILIKE $2
        )
        UNION ALL
        SELECT 'payment_batch' AS object_type, pb.id, pb.payment_batch_number AS title, pb.status,
          concat_ws(' ', pb.payment_batch_number, pb.batch_type, pb.payment_method, pb.status, pb.approval_status, pb.execution_status, pb.execution_reference, pb.failure_reason, pb.notes) AS snippet
        FROM payment_batches pb
        WHERE pb.tenant_id = $1 AND pb.deleted_at IS NULL AND ($3::boolean OR pb.status <> 'archived') AND (
          pb.payment_batch_number ILIKE $2 OR pb.batch_type ILIKE $2 OR pb.payment_method ILIKE $2 OR pb.status ILIKE $2 OR pb.approval_status ILIKE $2 OR pb.execution_status ILIKE $2 OR pb.execution_reference ILIKE $2 OR pb.failure_reason ILIKE $2 OR pb.notes ILIKE $2
        )
        UNION ALL
        SELECT 'payment_item' AS object_type, pi2.id, concat_ws(' ', pi2.source_type, pi2.payee_name, pb.payment_batch_number) AS title, pi2.status,
          concat_ws(' ', pi2.source_type, pi2.payee_type, pi2.status, pi2.execution_status, pi2.execution_reference, pi2.failure_reason, pi2.payee_name, pb.payment_batch_number, cp.payable_number, pr.payroll_run_number) AS snippet
        FROM payment_items pi2
        JOIN payment_batches pb ON pb.tenant_id = pi2.tenant_id AND pb.id = pi2.payment_batch_id
        LEFT JOIN contractor_payables cp ON cp.tenant_id = pi2.tenant_id AND cp.id = pi2.contractor_payable_id
        LEFT JOIN payroll_runs pr ON pr.tenant_id = pi2.tenant_id AND pr.id = pi2.payroll_run_id
        WHERE pi2.tenant_id = $1 AND pi2.deleted_at IS NULL AND ($3::boolean OR pi2.status <> 'archived') AND (
          pi2.source_type ILIKE $2 OR pi2.payee_type ILIKE $2 OR pi2.status ILIKE $2 OR pi2.execution_status ILIKE $2 OR pi2.execution_reference ILIKE $2 OR pi2.failure_reason ILIKE $2 OR pi2.payee_name ILIKE $2 OR pb.payment_batch_number ILIKE $2 OR cp.payable_number ILIKE $2 OR pr.payroll_run_number ILIKE $2
        )
        UNION ALL
        SELECT 'payment' AS object_type, id, payment_reference AS title, status, concat_ws(' ', payment_reference, status) AS snippet
        FROM payments
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (payment_reference ILIKE $2 OR status ILIKE $2)
        UNION ALL
        SELECT 'constraint' AS object_type, id, title, status, concat_ws(' ', title, constraint_type, severity, status) AS snippet
        FROM constraints
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          title ILIKE $2 OR constraint_type ILIKE $2 OR severity ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'recommendation' AS object_type, id, title, status, concat_ws(' ', title, recommendation_type, risk_level, expected_impact, status) AS snippet
        FROM recommendations
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          title ILIKE $2 OR recommendation_type ILIKE $2 OR risk_level ILIKE $2 OR expected_impact ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'workflow_definition' AS object_type, id, coalesce(workflow_name, name) AS title, status, concat_ws(' ', workflow_name, name, workflow_category, trigger_event_type, status) AS snippet
        FROM workflow_definitions
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          workflow_name ILIKE $2 OR name ILIKE $2 OR workflow_category ILIKE $2 OR trigger_event_type ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'workflow_instance' AS object_type, id, source_object_type AS title, status, concat_ws(' ', source_object_type, entity_type, status) AS snippet
        FROM workflow_instances
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          source_object_type ILIKE $2 OR entity_type ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'workflow_task' AS object_type, id, coalesce(task_name, title) AS title, status, concat_ws(' ', task_name, title, assigned_role, status) AS snippet
        FROM workflow_tasks
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          task_name ILIKE $2 OR title ILIKE $2 OR assigned_role ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'kpi' AS object_type, id, coalesce(kpi_name, name) AS title, status, concat_ws(' ', kpi_name, name, kpi_category, owner_role, status) AS snippet
        FROM kpi_definitions
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          kpi_name ILIKE $2 OR name ILIKE $2 OR kpi_category ILIKE $2 OR owner_role ILIKE $2 OR status ILIKE $2
        )
        UNION ALL
        SELECT 'learning_score' AS object_type, id, score_type AS title, status, concat_ws(' ', score_type, object_type, entity_type, status) AS snippet
        FROM learning_scores
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (
          score_type ILIKE $2 OR object_type ILIKE $2 OR entity_type ILIKE $2 OR status ILIKE $2
        )
        LIMIT 50
        `,
        [request.auth.tenantId, search, includeArchived],
      );
      return result.rows;
    } finally {
      client.release();
    }
  }
}
