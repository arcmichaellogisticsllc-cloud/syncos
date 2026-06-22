# Production Backend Contract

Current implementation target: Production Backend Contract Foundation.

Production is the field-truth record for work completed, attempted, delayed, corrected, reviewed, or approved against a Work Order. Production does not create settlements, invoices, payments, payroll, AR, or cash records.

## Object Model

The backend hardens existing `production_records` and `production_evidence`.

`production_records` captures:

- Project and Work Order identity
- Production type
- Production/QC/billable status
- Provider, crew, foreman, submitter, worker count, equipment used, and subcontractor reference
- Claimed, approved, rejected, corrected, and billable quantities
- Production date, field timestamps, submitted/reviewed/approved/rejected timestamps
- Field location summary and route/node/segment/address references
- Notes, reasons, correction fields, revision fields, archive fields, and audit fields

`production_evidence` is metadata-only. It may reference a file URL, storage reference, filename, MIME type, caption, GPS metadata, capture time, and JSON metadata. This contract does not implement binary upload.

## Production Types

Supported types:

- `daily_production`
- `progress_update`
- `completion_submission`
- `correction_submission`
- `inspection_submission`
- `restoration_submission`
- `delay_report`
- `no_work_report`
- `safety_observation`
- `material_issue`
- `access_issue`
- `weather_delay`
- `customer_issue`
- `other`

Issue report types require a reason, note, or description. Quantity-producing types require quantity and unit unless a future approved override applies.

## Status Models

Production statuses:

- `draft`
- `submitted`
- `under_review`
- `correction_required`
- `corrected`
- `approved`
- `rejected`
- `voided`
- `archived`

Legacy statuses `qc_review`, `accepted`, and `billable` remain supported for compatibility.

QC statuses:

- `not_started`
- `pending_review`
- `corrections_required`
- `approved`
- `rejected`

Billable statuses:

- `not_billable`
- `billable_candidate`
- `billable`
- `blocked`

Legacy billable states remain tolerated where existing downstream code depends on them.

## Quantity Rules

Approved units match Work Order units:

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

Claimed quantity, approved quantity, rejected quantity, corrected quantity, and billable quantity are separate values. Claimed does not equal approved. Approved does not equal billable. Billable does not create settlement.

## Routes

Production:

- `GET /production-records`
- `GET /production-records/:id`
- `GET /production-records/:id/detail`
- `POST /production-records`
- `PATCH /production-records/:id`
- `POST /production-records/:id/submit`
- `POST /production-records/:id/start-review`
- `POST /production-records/:id/approve`
- `POST /production-records/:id/reject`
- `POST /production-records/:id/request-correction`
- `POST /production-records/:id/mark-corrected`
- `POST /production-records/:id/mark-billable`
- `POST /production-records/:id/void`
- `POST /production-records/:id/archive`
- `GET /production-records/:id/timeline`
- `GET /production-records/:id/audit-summary`

Compatibility routes remain available:

- `POST /production-records/:id/qc-review`
- `POST /production-records/:id/accept`
- `POST /production-records/:id/correction-required`
- `POST /production-records/:id/clear-correction`
- `POST /production-records/:id/stop-work`
- `POST /production-records/:id/release-stop-work`

Evidence:

- `GET /production-records/:id/evidence`
- `POST /production-records/:id/evidence`
- `PATCH /production-evidence/:id`
- `POST /production-evidence/:id/archive`

Rollups:

- `POST /work-orders/:id/recalculate-production-rollups`

## Read Models

`GET /production-records` returns enriched rows with project, Work Order, customer, territory, provider, crew, foreman, submitter, quantities, evidence count, production eligibility context, and recommended next action.

`GET /production-records/:id/detail` returns the production record plus Project context, Work Order context, performer context, evidence, correction context, quantity summary, QC summary, billable summary, warnings, blockers, recommended next action, and timeline/audit availability flags.

## Evidence Boundary

Evidence routes create metadata only. They do not upload or store raw binary files in the database. Evidence archive requires a reason.

## QC Boundary

Production backend supports basic review, approve, reject, correction request, and corrected states. Full QC evidence workflow and QC Workspace remain future scope.

## Billable / Finance Boundary

Marking production billable updates only production and Work Order rollup state. It creates no settlement, settlement item, invoice, payment, payroll, AR, or cash record.

## Events And Audit

Production writes use the write-action helper and create event, event payload, audit log, and system action.

Primary events:

- `production.created`
- `production.updated`
- `production.submitted`
- `production.review_started`
- `production.approved`
- `production.rejected`
- `production.correction_requested`
- `production.corrected`
- `production.marked_billable`
- `production.voided`
- `production.archived`
- `production_evidence.created`
- `production_evidence.updated`
- `production_evidence.archived`

Legacy event names remain where compatibility routes require them.

## Permissions

The hardened contract adds `production.*` permissions while preserving `production_record.*` compatibility permissions.

Production:

- `production.read`
- `production.create`
- `production.update`
- `production.submit`
- `production.review`
- `production.approve`
- `production.reject`
- `production.request_correction`
- `production.mark_corrected`
- `production.mark_billable`
- `production.void`
- `production.archive`
- `production.timeline.read`
- `production.audit.read`

Evidence:

- `production_evidence.read`
- `production_evidence.create`
- `production_evidence.update`
- `production_evidence.archive`

## Deferred

- Production UI
- Foreman mobile UI
- File upload
- Full QC Workspace
- Settlement, invoice, payment, payroll, AR, and cash automation
- AI production approval
