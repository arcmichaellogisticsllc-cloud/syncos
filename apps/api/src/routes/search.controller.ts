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
        SELECT 'settlement' AS object_type, id, status AS title, status, concat_ws(' ', status, dispute_reason) AS snippet
        FROM settlements
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (status ILIKE $2 OR dispute_reason ILIKE $2)
        UNION ALL
        SELECT 'invoice' AS object_type, id, invoice_number AS title, status, concat_ws(' ', invoice_number, status) AS snippet
        FROM invoices
        WHERE tenant_id = $1 AND deleted_at IS NULL AND (invoice_number ILIKE $2 OR status ILIKE $2)
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
