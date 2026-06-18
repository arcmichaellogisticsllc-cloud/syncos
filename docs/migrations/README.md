# Database Migration Design

This directory defines the initial SyncOS database migration plan. The sequence is ordered so foundational identity, tenant, permission, and organization data exists before relationship intelligence, opportunities, capacity, projects, financial records, workflows, analytics, and files.

## Migration Order

1. `001_tenants_users_roles_permissions`
2. `002_territories_organizations`
3. `003_contacts_relationships`
4. `004_signals_evidence`
5. `005_relationship_maps_paths`
6. `006_opportunity_candidates_opportunities`
7. `007_capacity_providers_crews_workers_equipment`
8. `008_compliance_documents_capacity_records`
9. `009_projects_work_orders_production`
10. `010_contracts_rates_settlements_invoices_payments`
11. `011_constraints_recommendations`
12. `012_events_actions_approvals_audit`
13. `013_workflows_tasks_escalations`
14. `014_kpis_learning`
15. `015_files_file_links`

## Conventions

- Every tenant-owned table includes `tenant_id`.
- Primary keys use UUIDs unless a later implementation chooses another globally unique identifier.
- Core mutable records include `created_at`, `updated_at`, and optional `deleted_at`.
- Audit-sensitive records include actor references where practical.
- Cross-tenant access is denied by default and must be expressed through explicit permissions.
