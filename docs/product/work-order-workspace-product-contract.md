# Work Order Workspace Product Contract

This document defines future UI behavior only. No Work Order UI is built in the backend foundation sprint.

## Future Routes

- `/work-orders`
- `/work-orders/:id`
- `/work-orders/:id/edit`

## Directory Fields

The future directory should use backend-enriched Work Order rows:

- Work Order name/number
- Project
- Customer
- Territory
- Work type
- Status
- Readiness status/score/band
- QC status
- Billable status
- Planned/completed/approved/billable quantity
- Assignment type
- Assigned provider/crew
- Planned and scheduled dates
- Warnings/blockers
- Production eligibility
- Recommended next action

## Detail Sections

The detail page should show:

- Project context
- Coverage context
- Assignment context
- Scope and location
- Quantity summary
- Readiness
- Production summary placeholder
- QC summary placeholder
- Billable summary placeholder
- Constraints summary
- Timeline
- Audit

## Lifecycle Actions

Actions must call backend routes only:

- Recalculate readiness
- Mark ready to assign
- Assign
- Schedule
- Start
- Submit
- Start QC review
- Request corrections
- Approve
- Mark billable
- Place on hold
- Release hold
- Cancel
- Close
- Archive

The UI must hide or disable actions without permission and must not bypass backend warnings, blockers, or required override fields.

## Boundaries

The workspace must not create production records, QC evidence, settlements, invoices, payments, payroll, AR, or cash. Production, QC evidence, and finance sections remain informational until their respective sprints.
