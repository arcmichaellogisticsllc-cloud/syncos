# Tenant Safety Hardening

## Current Tenant-Safe Controls

- Authentication derives tenant from signed token claims.
- Tenant membership is validated before protected routes execute.
- Permission checks use tenant-scoped role assignments.
- Tenant-owned reads and writes use tenant-scoped helpers or explicit `tenant_id` filters.
- Smoke suites validate cross-tenant access denial across major modules.

## Current Tenant-Unsafe Database FK Patterns

Most tenant-owned tables include `tenant_id`, but many foreign keys still reference parent `id` only. High-risk examples:

- `contacts.organization_id -> organizations.id`
- `opportunities.organization_id -> organizations.id`
- `candidate_signals.signal_id -> signals.id`
- `projects.opportunity_id -> opportunities.id`
- `work_orders.project_id -> projects.id`
- `production_records.work_order_id -> work_orders.id`
- `settlement_items.production_record_id -> production_records.id`
- `invoices.settlement_id -> settlements.id`
- `workflow_tasks.workflow_instance_id -> workflow_instances.id`
- `kpi_snapshots.kpi_definition_id -> kpi_definitions.id`
- `score_history.learning_score_id -> learning_scores.id`

## Hardening Plan

Before production data import, convert high-risk relationships to composite tenant-safe constraints:

1. Add unique indexes on parent `(tenant_id, id)`.
2. Backfill and validate child tenant consistency.
3. Add composite child FKs `(tenant_id, parent_id)` referencing parent `(tenant_id, id)`.
4. Keep API tenant isolation tests as regression coverage.

## Sprint 14 Decision

No broad FK conversion was applied in Sprint 14. The change spans every domain and could destabilize mature migrations late in release hardening. Current API and smoke coverage remains the production gate until a focused schema-hardening migration is scheduled.

## RC1.1 Update

RC1.1 adds `016_tenant_fk_hardening.sql` with additive composite `(tenant_id, id)` FK hardening for the highest-risk operational references. Remaining identity-scope and polymorphic references are documented in `tenant-safety-hardening-report.md`.
