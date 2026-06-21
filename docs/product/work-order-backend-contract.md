# Work Order Backend Contract

Current implementation commit target: Work Order Backend Contract Foundation.

## Definition

A Work Order is a specific executable work package under a Project. It carries scope, location, quantity, unit, work type, assignment context, readiness, QC summary state, and billable eligibility. It does not create production records, QC evidence, settlements, invoices, payments, payroll, AR, or cash.

## Schema Fields

The hardened `work_orders` contract supports project linkage, optional coverage linkage, identity/scope fields, classification, quantities, schedule, assignment, ownership, documentation requirements, hold/cancel/closeout notes, archive reason fields, and audit attribution.

Legacy fields remain compatible:

- `title` maps to `work_order_name`
- `location_description` maps to `location_summary`
- `expected_units` maps to `planned_quantity`
- `unit_type` maps to `unit`
- legacy `created` is normalized to `draft`

## Statuses

Approved statuses:

- `draft`
- `ready_to_assign`
- `assigned`
- `scheduled`
- `in_progress`
- `submitted`
- `qc_review`
- `corrections_required`
- `approved`
- `billable`
- `closed`
- `on_hold`
- `cancelled`
- `archived`

## Readiness

Readiness answers whether the Work Order can be assigned or started.

Statuses:

- `not_ready`
- `ready_to_assign`
- `ready_to_start`
- `blocked`

Bands:

- `not_ready`: 0-39
- `needs_assignment`: 40-69
- `ready_with_risk`: 70-84
- `ready_to_start`: 85-100

Backend readiness is deterministic and evaluates project validity/readiness, scope, location, work type, territory, quantity, unit, assignment when required, schedule, coverage source, documentation requirements, and hard-stop constraints.

## Assignment

Assignment uses:

- `unassigned`
- `internal_crew`
- `subcontractor`
- `partner_contractor`
- `vendor_equipment`
- `staffing_source`

Assignment targets are tenant-validated. Archived or suspended providers block assignment where safely detected. Non-activated providers require override.

## Quantity Boundary

Approved units:

- `feet`
- `miles`
- `drops`
- `addresses`
- `passings`
- `splice_cases`
- `nodes`
- `poles`
- `permits`
- `inspections`
- `restoration_items`
- `days`
- `crews`
- `workers`
- `equipment_units`
- `each`

Work Order tracks planned, completed, approved, and billable quantities. This sprint does not make production/QC/billing engines authoritative for those values yet.

## Routes

- `GET /work-orders`
- `GET /work-orders/:id`
- `GET /work-orders/:id/detail`
- `POST /work-orders`
- `PATCH /work-orders/:id`
- `POST /work-orders/:id/recalculate-readiness`
- `POST /work-orders/:id/mark-ready-to-assign`
- `POST /work-orders/:id/assign`
- `POST /work-orders/:id/schedule`
- `POST /work-orders/:id/start`
- `POST /work-orders/:id/submit`
- `POST /work-orders/:id/start-qc-review`
- `POST /work-orders/:id/request-corrections`
- `POST /work-orders/:id/approve`
- `POST /work-orders/:id/mark-billable`
- `POST /work-orders/:id/place-on-hold`
- `POST /work-orders/:id/release-hold`
- `POST /work-orders/:id/cancel`
- `POST /work-orders/:id/close`
- `POST /work-orders/:id/archive`
- `GET /work-orders/:id/timeline`
- `GET /work-orders/:id/audit-summary`

## Read Models

List rows include project/customer/territory/provider/crew names, normalized status, readiness, QC/billable state, quantity fields, schedule fields, warnings, blockers, required override fields, production eligibility, recommended next action, and safe counts.

Detail includes:

- work_order
- project_context
- coverage_context
- assignment_context
- readiness
- warnings
- blockers
- quantity_summary
- production_summary
- qc_summary
- billable_summary
- constraints_summary
- timeline_available
- audit_allowed

## Filters And Sorting

Supported filters include project, status, normalized status, readiness status, QC status, billable status, territory, work type, assigned provider, assigned crew, assignment type, production eligibility, blockers, warnings, planned/scheduled date ranges, archived, and text search.

Supported sorting includes updated, planned start, scheduled start, readiness, status, project, and assigned provider.

## Events And Audit

Every Work Order write uses the write-action helper and emits event, event payload, audit log, and system action.

Added events include Work Order creation, update, readiness recalculation, ready-to-assign, assignment, scheduling, start, submit, QC review, corrections, approval, billable marking, hold/release, cancellation, close, and archive.

## Permissions

Added Work Order permissions cover read, create, update, readiness recalculation, mark ready, assign, schedule, start, submit, QC review, corrections, approve, mark billable, hold/release, cancel, close, archive, timeline read, and audit read.

## Boundaries

Work Order lifecycle actions do not create:

- production records
- QC evidence
- settlements
- invoices
- payments
- payroll
- AR
- cash records

Marking a Work Order billable only marks Work Order eligibility for a later billing/settlement sprint.
