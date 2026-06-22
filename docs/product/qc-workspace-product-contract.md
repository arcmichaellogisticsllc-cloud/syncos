# QC Workspace Product Contract

This document defines the future QC Workspace surface. No QC UI is implemented in the backend foundation sprint.

## Purpose

QC Workspace will expose QC review history and actions so authorized reviewers can accept, reject, request corrections, mark corrected, void, archive, and audit production acceptance decisions.

## Planned Routes

- `/qc-reviews`
- `/qc-reviews/:id`

Optional later routes:

- `/production-records/:id/qc-reviews`
- `/work-orders/:id/qc-reviews`

## Directory Fields

- Review type
- Review status
- Production record
- Work order
- Project
- Reviewer
- Claimed quantity
- Approved quantity
- Rejected quantity
- Correction required quantity
- Billable candidate quantity
- Unit
- Evidence status
- Location status
- Documentation status
- Customer acceptance status
- Prime acceptance status
- Recommended next action
- Updated date

## Detail Sections

- QC review header
- Quantity acceptance summary
- Production context
- Work order context
- Project context
- Findings
- Customer/prime acceptance
- Correction context
- Timeline
- Audit

## Actions

Actions must use backend routes only:

- Start review
- Approve
- Reject
- Request correction
- Mark corrected
- Void
- Archive

Actions must be permission-aware and backend-authoritative.

## Boundaries

QC Workspace must not create:

- settlements
- invoices
- AR
- payments
- cash
- payroll

QC may create billable candidate quantity only.

## Permissions

The UI should surface actions based on:

- `qc_review.read`
- `qc_review.create`
- `qc_review.start`
- `qc_review.approve`
- `qc_review.reject`
- `qc_review.request_correction`
- `qc_review.mark_corrected`
- `qc_review.void`
- `qc_review.archive`
- `qc_review.timeline.read`
- `qc_review.audit.read`

## Empty States

No QC reviews:

“No QC reviews have been created yet. QC reviews validate submitted production before it can become a billable candidate.”

Audit unauthorized:

“You do not have permission to view QC audit details.”

## Future UI Scope

The first UI sprint should make QC acceptance understandable, show why production was accepted or rejected, and keep correction history traceable.
