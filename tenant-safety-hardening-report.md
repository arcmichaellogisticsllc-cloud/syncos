# Tenant Safety Hardening Report

## Converted

RC1.1 adds `016_tenant_fk_hardening.sql`, an additive schema-hardening migration.

Converted parent tables now have unique `(tenant_id, id)` indexes for composite FK targets:

- `territories`
- `organizations`
- `contacts`
- `signals`
- `relationship_maps`
- `opportunity_candidates`
- `opportunities`
- `capacity_providers`
- `crews`
- `capacity_records`
- `compliance_documents`
- `projects`
- `work_orders`
- `production_records`
- `contracts`
- `rate_schedules`
- `rate_codes`
- `settlements`
- `settlement_items`
- `invoices`
- `payments`
- `ar_records`
- `constraints`
- `recommendations`
- `workflow_definitions`
- `workflow_steps`
- `workflow_instances`
- `workflow_tasks`

Converted high-risk child references now include composite tenant-safe FK constraints:

- Organization, contact, signal, relationship map, and relationship path references.
- Opportunity candidate, candidate signal, opportunity, and capacity requirement references.
- Capacity provider, crew, worker, equipment, capacity record, compliance document, and gap analysis references.
- Project, work order, production record, and production evidence references.
- Contract, rate schedule, rate code, settlement, settlement item, invoice, payment, AR, and customer payment stats references.
- Recommendation, recommendation evidence, recommendation outcome, workflow definition, workflow step, workflow instance, workflow task, and workflow escalation references.

Risk level after conversion: Medium. New writes have stronger database-level tenant containment for the highest-risk operational chains.

## Deferred

The following remain deferred because they reference global identity or polymorphic object models:

- User references such as `owner_user_id`, `submitted_by_user_id`, `approved_by`, `verified_by`, `assigned_to`, and similar columns. `users.id` is global and tenant membership is validated through `tenant_users`; converting these requires an identity-scope migration.
- Role references such as `assigned_role_id` and escalation role references. Roles are tenant-owned, but a full conversion should be handled with scoped-role migration coverage.
- Polymorphic references such as `affected_object_type/affected_object_id`, `related_object_type/related_object_id`, `source_object_type/source_object_id`, and `file_links.entity_type/entity_id`. These need object-type-specific validation or future typed link tables.
- UUID array references such as `relationship_paths.intermediary_contact_ids`. PostgreSQL composite FK constraints do not apply directly to arrays; API-level validation remains required.

Risk level: Medium. API tenant guards and smoke tests still cover these paths, but database-level protection is not complete.

## Blocked

No FK hardening item is fully blocked for production readiness, but identity-scope and polymorphic references need a dedicated production migration plan before broad multi-tenant data import.

Risk level: Medium.
