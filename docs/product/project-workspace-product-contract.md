# Project Workspace Product Contract

This document defines the future Project Workspace operator experience. No UI is implemented in the backend hardening sprint.

## Routes

- `/projects`
- `/projects/:id`
- `/projects/:id/edit`

## Workspace Mission

Help operations understand whether accepted awarded work is ready to be planned, started, monitored, completed, and closed.

The workspace must make clear that Project is an operational container, not a work order or production entry surface.

## Project List

Required list fields:

- Project Name
- Status
- Phase
- Source Opportunity
- Source Coverage Plan
- Source Project Handoff
- Customer
- Territory
- Work Type
- Planned Start
- Planned End
- Operations Owner
- Project Manager
- Field Supervisor
- Coverage Readiness
- Compliance Readiness
- Financial Readiness
- Project Readiness
- Readiness Band
- Open Constraints
- Hard Stop Constraints
- Work Order Count if safely available
- Production Record Count if safely available
- Recommended Next Action

Filters:

- Status
- Phase
- Customer
- Territory
- Work type
- Operations owner
- Project manager
- Readiness band
- Planned date range
- Has hard-stop constraints
- Archived / Active
- Text search

Default sort:

- hard-stop constraints first
- lowest readiness
- recently updated

## Project Detail

Sections:

- Header
- Readiness scorecard
- Source opportunity panel
- Source coverage plan panel
- Source project handoff panel
- Operations ownership panel
- Scope/location panel
- Compliance/safety panel
- Financial/billing readiness panel
- Documentation requirements panel
- Constraints/risk panel
- Future work orders placeholder
- Future production placeholder
- Timeline
- Audit

## Header

Must show:

- Project name
- Status
- Phase
- Customer
- Territory
- Work type
- Planned dates
- Actual dates
- Operations owner
- Project manager
- Field supervisor
- Project readiness score and band
- Recommended next action

Primary actions:

- Edit Project
- Recalculate Readiness
- Mark Ready For Work
- Start
- Place On Hold
- Release Hold
- Complete
- Close
- Archive

Actions must be permission-aware and route-backed.

## Readiness Scorecard

Cards:

- Project Readiness
- Coverage Readiness
- Compliance Readiness
- Financial Readiness
- Open Constraints
- Hard Stop Constraints
- Recommended Next Action

Warnings should be visible and overridable only when backend permits. Blockers should disable the blocked action.

## Future Work Order Placeholder

Message:

“Work orders will be created in a future Work Order Workspace. Starting a project does not create work orders.”

## Future Production Placeholder

Message:

“Production will be recorded in a future Production Workspace. Project actions do not create production records.”

## Timeline

Use `GET /projects/:id/timeline`.

Display project events and linked handoff project-created event where returned.

## Audit

Use `GET /projects/:id/audit-summary`.

Only visible when the actor has `project.audit.read`.

## Error Handling

Plain-language errors:

- Project not found or you do not have access.
- Archived projects are view-only.
- Project readiness blockers must be resolved before ready for work.
- Override reason is required for readiness warnings.
- Project must be ready for work before it can start.
- Hold reason is required.
- Release note is required.
- Closeout notes are required.
- Archive reason is required.

## Non-Scope

- Work order creation
- Crew dispatch
- Field production entry
- Settlement creation
- Invoice creation
- Payment creation
- Payroll
- AR or cash automation
- Pricing engine
- AI automation
