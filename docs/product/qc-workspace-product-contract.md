# QC Workspace Product Contract

## Purpose

QC Workspace exposes the hardened QC review backend through an operator workspace. QC is the acceptance-truth layer for production records: it records approved quantity, rejected quantity, correction-required quantity, billable-candidate quantity, acceptance state, timeline, and audit.

QC Workspace does not create billable items, settlements, invoices, AR, payments, cash, payroll, or tax records.

## Routes

- `/qc`: QC Review Queue
- `/qc/new`: Create QC Review
- `/qc/:id`: QC Detail
- `/qc/:id/edit`: QC edit context

The edit route is conservative in this sprint because the backend exposes QC lifecycle action routes but does not expose `PATCH /qc-reviews/:id`. Direct lifecycle decisions must use the action routes.

## Backend APIs Reused

- `GET /qc-reviews`
- `GET /qc-reviews/:id/detail`
- `POST /qc-reviews`
- `POST /qc-reviews/:id/start-review`
- `POST /qc-reviews/:id/approve`
- `POST /qc-reviews/:id/reject`
- `POST /qc-reviews/:id/request-correction`
- `POST /qc-reviews/:id/mark-corrected`
- `POST /qc-reviews/:id/void`
- `POST /qc-reviews/:id/archive`
- `GET /qc-reviews/:id/timeline`
- `GET /qc-reviews/:id/audit-summary`

Related reads:

- `GET /production-records`
- `GET /production-records/:id/detail`
- `GET /work-orders/:id/detail` through QC detail context
- `GET /projects/:id/detail` through QC detail context
- `GET /billable-items`
- `GET /auth/me/permissions` through existing permission/session helpers

## Review Queue

The queue includes summary cards, quick filters, filter controls, sorting, and a wide review table.

Directory fields:

- Review type
- Review status
- Production record
- Production status
- Work order
- Project
- Customer
- Provider
- Crew
- Reviewer
- Reviewed at
- Claimed quantity
- Approved quantity
- Rejected quantity
- Correction-required quantity
- Billable-candidate quantity
- Unit
- Evidence status
- Location status
- Documentation status
- Customer acceptance
- Prime acceptance
- Recommended next action
- Updated date

## Create Form

The create form posts to `POST /qc-reviews`.

Required:

- Production record
- Review type

Supported optional fields:

- Reviewer
- Evidence status
- Location status
- Documentation status
- Production status
- Customer acceptance status
- Prime acceptance status
- Review notes
- Correction due date
- Correction owner
- Source QC review
- Hard stop
- Override reasons

The backend derives Work Order, Project, claimed quantity, and unit from the selected production record. Quantity acceptance decisions are handled by lifecycle routes.

## Detail Sections

- Header
- Acceptance truth scorecard
- Strategic sidebar
- Overview
- Production context
- Work Order context
- Project context
- Quantity acceptance
- Evidence review
- Correction management
- Customer / Prime acceptance
- Billable candidate
- Timeline
- Audit
- Future Billable Workspace placeholder
- Future Settlement placeholder

## Lifecycle Actions

Actions are permission-aware and route through the hardened backend:

- Start Review
- Approve
- Reject
- Request Correction
- Mark Corrected
- Void
- Archive

Approve captures approval note, approved quantity, optional billable-candidate quantity, review finding statuses, acceptance statuses, and override reason.

Reject requires rejection reason.

Request Correction requires correction reason.

Void requires void reason.

Archive requires archive reason.

## Quantity Acceptance

The UI displays:

- Claimed quantity
- Approved quantity
- Rejected quantity
- Correction-required quantity
- Billable-candidate quantity
- Unit

Displayed boundaries:

- Claimed is not approved.
- Approved is not automatically settled.
- Billable candidate does not create settlement.

## Evidence Review

Evidence review shows QC evidence status and read-only production evidence metadata when returned by `GET /production-records/:id/detail`.

No binary upload is implemented.

## Correction Behavior

The correction section displays reason, note, due date, owner, source production record, and source QC review. QC can request and mark corrections through QC action routes. It does not create correction production records.

## Customer / Prime Acceptance

Customer and prime acceptance are shown as QC review fields:

- `not_required`
- `pending`
- `accepted`
- `rejected`
- `correction_required`

No customer or prime portal is created.

## Billable Candidate Boundary

QC may store billable-candidate quantity. QC Workspace does not create billable items and does not create settlement, invoice, AR, payment, cash, payroll, or tax records.

## Timeline / Audit

Timeline uses `GET /qc-reviews/:id/timeline`.

Audit uses `GET /qc-reviews/:id/audit-summary` and is permission protected. If unauthorized, the UI shows:

“You do not have permission to view QC audit details.”

## Permissions

- `qc_review.read`
- `qc_review.create`
- `qc_review.update`
- `qc_review.start`
- `qc_review.approve`
- `qc_review.reject`
- `qc_review.request_correction`
- `qc_review.mark_corrected`
- `qc_review.void`
- `qc_review.archive`
- `qc_review.timeline.read`
- `qc_review.audit.read`

Related read permissions:

- `production.read`
- `production_record.read`
- `work_order.read`
- `project.read`
- `billable_item.read`

Backend permissions remain authoritative.

## No Finance Creation Boundary

QC Workspace must not create:

- Billable item
- Settlement
- Settlement item
- Invoice
- AR
- Payment
- Cash
- Payroll
- Tax record
