# Billable Backend Contract

Current implementation commit target: Billable Backend Contract Foundation.

Billable is the financial eligibility bridge between QC and future Settlement. It consumes approved QC and approved Production, calculates readiness for future settlement, and never creates Settlement, Settlement Item, Invoice, AR, Payment, Cash, Payroll, or Tax records.

## Object Model

`billable_items` is first-class and tenant scoped.

Core links:

- `project_id`
- `work_order_id`
- `production_record_id`
- `qc_review_id`
- `customer_organization_id`
- optional `capacity_provider_id`
- optional `crew_id`

Summary fields remain on `production_records` and `work_orders` and are synchronized from active Billable items where safe.

## Statuses

Billable statuses:

- `candidate`
- `needs_rate`
- `needs_documentation`
- `needs_customer_acceptance`
- `held`
- `ready_for_settlement`
- `settlement_created`
- `disputed`
- `voided`
- `archived`

`settlement_created` is reserved for future Settlement workflow. This sprint does not create settlement items.

Readiness statuses:

- `not_ready`
- `needs_review`
- `ready_with_warning`
- `ready_for_settlement`
- `blocked`

Readiness bands:

- `not_ready`: 0-39
- `needs_review`: 40-69
- `ready_with_warning`: 70-84
- `ready_for_settlement`: 85-100

## Creation

`POST /billable-items`

Required:

- `qc_review_id`

Rules:

- actor must have `billable_item.create`
- QC review must belong to tenant
- QC review must be approved
- production record must belong to tenant
- production record must be approved
- work order and project must belong to tenant
- duplicate active Billable item for the same QC review is blocked unless override is supplied
- billable quantity must be positive
- billable quantity cannot exceed approved quantity unless override is supplied
- unit derives from QC/Production/Work Order

The route creates no finance records.

## Readiness

Readiness checks:

- approved QC review
- approved production
- valid work order/project
- billable quantity present
- billable quantity within approved quantity
- unit valid
- rate known or override supplied
- billing package ready or override supplied
- documentation ready or override supplied
- customer/prime acceptance reviewed
- no hold
- no dispute
- no void/archive
- no linked settlement item

Warnings include unknown/manual rate, incomplete package/documentation, pending acceptance, retainage, held quantity, dispute, quantity mismatch, and manual override.

Blockers include missing approved QC/Production, missing billable quantity, quantity overage without override, rejected/correction/disputed acceptance, hold, dispute, void/archive, and existing settlement linkage.

## Routes

- `GET /billable-items`
- `GET /billable-items/:id`
- `GET /billable-items/:id/detail`
- `POST /billable-items`
- `PATCH /billable-items/:id`
- `POST /billable-items/:id/recalculate-readiness`
- `POST /billable-items/:id/mark-ready-for-settlement`
- `POST /billable-items/:id/place-hold`
- `POST /billable-items/:id/release-hold`
- `POST /billable-items/:id/dispute`
- `POST /billable-items/:id/resolve-dispute`
- `POST /billable-items/:id/void`
- `POST /billable-items/:id/archive`
- `GET /billable-items/:id/timeline`
- `GET /billable-items/:id/audit-summary`

## List And Detail

List rows are enriched with project, work order, production, QC, customer, provider, crew, quantity, rate, retainage, acceptance, package, readiness, warnings, blockers, required override fields, and recommended next action.

Detail returns:

- `billable_item`
- `project_context`
- `work_order_context`
- `production_context`
- `qc_context`
- `customer_context`
- `provider_context`
- `quantity_summary`
- `rate_summary`
- `acceptance_summary`
- `billing_package_summary`
- `retainage_summary`
- `readiness`
- `warnings`
- `blockers`
- `required_override_fields`
- `recommended_next_action`
- timeline/audit availability flags

## Permissions

- `billable_item.read`
- `billable_item.create`
- `billable_item.update`
- `billable_item.recalculate_readiness`
- `billable_item.mark_ready`
- `billable_item.place_hold`
- `billable_item.release_hold`
- `billable_item.dispute`
- `billable_item.resolve_dispute`
- `billable_item.void`
- `billable_item.archive`
- `billable_item.timeline.read`
- `billable_item.audit.read`

## Events

- `billable_item.created`
- `billable_item.updated`
- `billable_item.readiness_recalculated`
- `billable_item.ready_for_settlement`
- `billable_item.held`
- `billable_item.hold_released`
- `billable_item.disputed`
- `billable_item.dispute_resolved`
- `billable_item.voided`
- `billable_item.archived`

Every write uses the write-action helper and creates event, event payload, audit log, and system action.

## Boundary

Billable creates eligibility only. It does not create:

- Settlement
- Settlement Item
- Invoice
- AR
- Payment
- Cash
- Payroll
- Tax records

