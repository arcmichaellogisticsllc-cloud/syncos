# Billable Workspace Product Contract

## Purpose

Billable Workspace exposes the hardened Billable backend through an operator workspace. Billable is the financial eligibility layer between QC and future Settlement/Invoice workflows.

Billable answers:

“What accepted work is financially eligible to be billed or settled?”

Billable Workspace does not create settlement, settlement item, invoice, AR, payment, cash, payroll, or tax records.

## Routes

- `/billable`: Billable Queue
- `/billable/new`: Create Billable Candidate
- `/billable/:id`: Billable Detail
- `/billable/:id/edit`: Billable Edit

## Backend APIs Reused

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

Related reads:

- `GET /qc-reviews`
- `GET /production-records/:id/detail` through billable detail context
- `GET /work-orders/:id/detail` through billable detail context
- `GET /projects/:id/detail` through billable detail context
- `GET /organizations/:id/detail` through billable detail context
- `GET /auth/me/permissions` through existing permission/session helpers

## Queue Fields

- Status
- Readiness status
- Readiness score
- Project
- Work Order
- Production Record
- QC Review
- Customer
- Provider
- Crew
- Approved quantity
- Billable quantity
- Held quantity
- Unit
- Unit rate
- Rate source
- Rate confidence
- Estimated billable amount
- Retainage required
- Retainage amount
- Net billable amount
- Customer acceptance
- Prime acceptance
- Billing package status
- Documentation status
- Recommended next action
- Updated date

## Create Form

The create form posts to `POST /billable-items`.

Required:

- QC Review

Optional:

- Billable quantity
- Rate code
- Rate description
- Unit rate
- Rate source
- Rate confidence
- Customer acceptance status
- Prime acceptance status
- Billing package status
- Documentation status
- Retainage required
- Retainage percent
- Override reasons

The backend requires approved QC and approved production, blocks duplicate active billable items unless overridden, validates quantity limits, and creates event/audit/system_action records.

## Edit Form

The edit form patches `PATCH /billable-items/:id`.

Editable fields where backend allows:

- Billable quantity
- Rate code
- Rate description
- Unit rate
- Rate source
- Rate confidence
- Customer acceptance status
- Prime acceptance status
- Billing package status
- Documentation status
- Retainage required
- Retainage percent
- Retainage release condition
- Hold note
- Dispute note
- Override reasons

Status changes use lifecycle routes. Voided, archived, and settlement-created items are read-only.

## Detail Sections

- Header
- Financial eligibility scorecard
- Strategic sidebar
- Overview
- QC context
- Production context
- Work Order context
- Project context
- Quantity & Amount
- Rate Readiness
- Documentation Readiness
- Customer / Prime Acceptance
- Retainage
- Holds & Disputes
- Timeline
- Audit
- Future Settlement placeholder
- Future Invoice placeholder

## Lifecycle Actions

Actions call backend routes only:

- Recalculate Readiness
- Mark Ready For Settlement
- Place Hold
- Release Hold
- Dispute
- Resolve Dispute
- Void
- Archive

Mark Ready For Settlement requires `approval_note`; blockers disable submit.

Place Hold requires `hold_reason`.

Release Hold requires `release_note`.

Dispute requires `dispute_reason`.

Resolve Dispute requires `resolution_note`.

Void requires `void_reason`.

Archive requires `archive_reason`.

## Readiness Behavior

Billable readiness is backend-calculated and displayed through score, status, band, warnings, blockers, required override fields, and recommended next action.

Ready for settlement is a status/readiness state only. It does not create settlement or invoice records.

## Rate Readiness

Displayed fields:

- Rate code
- Rate description
- Unit rate
- Rate source
- Rate confidence
- Rate warnings
- Manual rate warning
- Unknown rate warning

No pricing engine is available in this sprint.

## Documentation Readiness

Displayed fields:

- Billing package status
- Documentation status
- Missing documentation warnings
- Billing package readiness note

PDF billing package generation is not available in this sprint.

## Customer / Prime Acceptance

Displayed fields:

- Customer acceptance status
- Prime acceptance status
- Acceptance warnings/blockers

No customer or prime portal is created.

## Retainage

Displayed fields:

- Retainage required
- Retainage percent
- Retainage amount
- Retainage release condition
- Net billable amount

Retainage is estimated here. Formal retainage ledgering belongs to a future Settlement/Finance sprint.

## Holds / Disputes

Displayed fields:

- Hold reason
- Hold note
- Dispute reason
- Dispute note
- Current status
- Resolution state

Actions are route-backed and permission-aware.

## Timeline / Audit

Timeline uses `GET /billable-items/:id/timeline`.

Audit uses `GET /billable-items/:id/audit-summary` and is permission protected. If unauthorized, the UI shows:

“You do not have permission to view billable audit details.”

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

Related read permissions:

- `qc_review.read`
- `production.read`
- `production_record.read`
- `work_order.read`
- `project.read`
- `organization.read`

Backend permissions remain authoritative.

## No Finance Creation Boundary

Billable Workspace must not create:

- Settlement
- Settlement item
- Invoice
- AR
- Payment
- Cash
- Payroll
- Tax record

Future Settlement and Invoice sections are placeholders only.
