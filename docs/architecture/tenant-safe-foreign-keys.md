# Tenant-Safe Foreign Key Hardening

Sprint 0.5 validates tenant isolation at the API and data-access helper layer. Before production data import, high-risk cross-table relationships must also be hardened at the database layer with composite tenant-safe constraints.

## Required Pattern

For tenant-owned parent tables, prefer:

- Unique key on `(tenant_id, id)`.
- Child table composite foreign key `(tenant_id, parent_id)` referencing parent `(tenant_id, id)`.

This prevents a row in tenant A from referencing a parent row owned by tenant B.

## High-Risk Relationships To Convert

- `contacts.organization_id -> organizations.id`
- `organizations.territory_id -> territories.id`
- `organization_relationships.source_organization_id -> organizations.id`
- `organization_relationships.target_organization_id -> organizations.id`
- `contact_relationships.source_contact_id -> contacts.id`
- `contact_relationships.target_contact_id -> contacts.id`
- `signal_entities.signal_id -> signals.id`
- `signal_evidence.signal_id -> signals.id`
- `candidate_signals.candidate_id -> opportunity_candidates.id`
- `candidate_signals.signal_id -> signals.id`
- `opportunities.candidate_id -> opportunity_candidates.id`
- `opportunities.organization_id -> organizations.id`
- `opportunity_capacity_requirements.opportunity_id -> opportunities.id`
- `capacity_providers.organization_id -> organizations.id`
- `crews.capacity_provider_id -> capacity_providers.id`
- `workers.capacity_provider_id -> capacity_providers.id`
- `equipment.capacity_provider_id -> capacity_providers.id`
- `capacity_records.capacity_provider_id -> capacity_providers.id`
- `compliance_documents.capacity_provider_id -> capacity_providers.id`
- `projects.opportunity_id -> opportunities.id`
- `work_orders.project_id -> projects.id`
- `production_records.work_order_id -> work_orders.id`
- `production_evidence.production_record_id -> production_records.id`
- `contracts.organization_id -> organizations.id`
- `rate_schedules.contract_id -> contracts.id`
- `rate_codes.rate_schedule_id -> rate_schedules.id`
- `settlements.capacity_provider_id -> capacity_providers.id`
- `settlement_items.settlement_id -> settlements.id`
- `settlement_items.production_record_id -> production_records.id`
- `invoices.organization_id -> organizations.id`
- `payments.invoice_id -> invoices.id`
- `ar_records.invoice_id -> invoices.id`
- `recommendations.constraint_id -> constraints.id`
- `recommendation_evidence.recommendation_id -> recommendations.id`
- `recommendation_outcomes.recommendation_id -> recommendations.id`
- `relationship_paths.relationship_map_id -> relationship_maps.id`
- `workflow_steps.workflow_definition_id -> workflow_definitions.id`
- `workflow_instances.workflow_definition_id -> workflow_definitions.id`
- `workflow_tasks.workflow_instance_id -> workflow_instances.id`
- `workflow_escalations.workflow_task_id -> workflow_tasks.id`
- `kpi_snapshots.kpi_definition_id -> kpi_definitions.id`
- `kpi_alerts.kpi_definition_id -> kpi_definitions.id`
- `file_links.file_id -> files.id`

## Deferred Decision

This is intentionally not converted wholesale in Sprint 0.5 because it touches every domain migration and should be done in one focused schema-hardening pass before production data is loaded.
