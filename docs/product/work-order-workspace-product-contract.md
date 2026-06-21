# Work Order Workspace Product Contract

This document defines the Work Order Workspace UI exposed by the product sprint. The workspace consumes the hardened Work Order backend contract only. It does not create production records, QC evidence, settlements, invoices, payments, payroll, AR, or cash records.

## Routes

- `/work-orders`
- `/work-orders/new`
- `/work-orders/:id`
- `/work-orders/:id/edit`

## Directory

The `/work-orders` directory consumes `GET /work-orders` and displays:

- Work Order name
- Status
- Project
- Customer
- Territory
- Work type
- Planned, completed, approved, and billable quantities
- Unit
- Assignment type
- Assigned provider
- Assigned crew
- Readiness score and band
- Production eligible state
- QC status
- Billable status
- Scheduled start
- Planned start
- Recommended next action
- Updated date

Summary cards cover all approved Work Order statuses plus production eligible, blocked, and ready with risk.

## Filters And Sorting

The directory supports:

- Project
- Status
- Readiness status
- QC status
- Billable status
- Territory
- Work type
- Assignment type
- Assigned provider
- Assigned crew
- Production eligible
- Has blockers
- Has warnings
- Planned start range
- Scheduled start range
- Archived / active
- Text search

Sorting supports recently updated, planned start, scheduled start, lowest readiness, highest readiness, status, project, and assigned provider. The UI uses the backend sort parameter where available and retains deterministic client fallback ordering for displayed rows.

## Create Form

The `/work-orders/new` route posts to `POST /work-orders`.

Required fields:

- Project
- Work Order name
- Scope summary
- Location summary
- Work type
- Territory
- Planned quantity
- Unit

Optional fields include coverage plan, coverage requirement, coverage source, dates, Work Order numbers, assignment type, owner, field supervisor, documentation requirements, production requirements, customer validation requirements, billing package requirements, and risk notes.

The backend remains the authority for valid project status, tenant boundaries, approved units, events, audit, and system actions.

## Edit Form

The `/work-orders/:id/edit` route uses `PATCH /work-orders/:id`.

Editable planning fields include name, Work Order numbers, scope, location, route/node/segment/address fields, permit/map fields, work type, territory, planned quantity, unit, planned dates, scheduled dates, owners, documentation requirements, production requirements, customer validation requirements, billing package requirements, and risk notes.

Status changes use lifecycle routes. Assignment uses the assignment route.

## Detail Sections

The `/work-orders/:id` detail page consumes:

- `GET /work-orders/:id/detail`
- `GET /work-orders/:id/timeline`
- `GET /work-orders/:id/audit-summary`

Sections:

- Overview
- Project context
- Coverage context
- Assignment
- Schedule
- Scope and location
- Quantity
- Readiness
- Production summary
- QC summary
- Billable summary
- Constraints / risks
- Timeline
- Audit
- Future Production placeholder
- Future Settlement placeholder

## Lifecycle Actions

Actions call backend routes only:

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

The UI shows backend warnings, blockers, and required override context where returned. Backend validation remains authoritative.

## Readiness

The detail page displays:

- Work Order readiness score
- Readiness status
- Readiness band
- Production eligible state
- Warnings
- Blockers
- Recommended next action
- Checklist summary

The UI does not calculate approval truth. It displays backend values and uses deterministic display fallback only for checklist presentation.

## Assignment

Assignment uses `POST /work-orders/:id/assign` and supports:

- Assignment type
- Assigned organization
- Assigned capacity provider
- Assigned crew
- Assigned equipment
- Assignment note
- Override reason fields when needed

Assignment does not create dispatch or production records.

## Quantity

The workspace displays planned, completed, approved, and billable quantity. Completed quantity belongs to future Production. Approved quantity belongs to future QC. Billable quantity prepares future Settlement/Billing. This UI does not create downstream records.

## Timeline And Audit

Timeline uses `GET /work-orders/:id/timeline`.

Audit uses `GET /work-orders/:id/audit-summary` and is shown only when the actor has `work_order.audit.read`. Unauthorized users see a permission message instead of audit payloads.

## Permissions

The UI surfaces:

- `work_order.read`
- `work_order.create`
- `work_order.update`
- `work_order.recalculate_readiness`
- `work_order.mark_ready`
- `work_order.assign`
- `work_order.schedule`
- `work_order.start`
- `work_order.submit`
- `work_order.qc_review`
- `work_order.corrections`
- `work_order.approve`
- `work_order.mark_billable`
- `work_order.place_hold`
- `work_order.release_hold`
- `work_order.cancel`
- `work_order.close`
- `work_order.archive`
- `work_order.timeline.read`
- `work_order.audit.read`

Actions are disabled when the permission is absent. The backend remains authoritative.

## Boundaries

Production Summary, QC Summary, Billable Summary, Future Production, and Future Settlement are display-only or placeholder sections. No Work Order UI action creates production records, QC evidence, settlements, invoices, payments, payroll, AR, or cash records.
