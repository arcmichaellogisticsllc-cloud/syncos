# Project Workspace Product Contract

This document defines the Project Workspace operator experience implemented for the Project Workspace UI sprint.

## Routes

- `/projects`
- `/projects/:id`
- `/projects/:id/edit`

## Workspace Mission

Help operations understand whether accepted awarded work is ready to be planned, started, monitored, completed, and closed.

The workspace must make clear that Project is an operational container, not a work order or production entry surface.

Manual project creation is not exposed in this sprint. Projects are created by the approved Project Handoff backend route.

## Project List

The `/projects` directory consumes `GET /projects` and displays:

- Project Name
- Status
- Phase
- Customer
- Territory
- Work Type
- Scope Summary
- Location Summary
- Planned Start
- Planned End
- Operations Owner
- Project Manager
- Field Supervisor
- Project Readiness
- Readiness Band
- Open Constraints
- Hard Blockers
- Recommended Next Action
- Updated Date

Filters:

- Status
- Phase
- Customer
- Territory
- Work type
- Operations owner
- Project manager
- Field supervisor
- Readiness score range
- Readiness band
- Has blockers
- Has warnings
- Has open constraints
- Planned start date range
- Planned end date range
- Archived / Active
- Text search

Default sort:

- hard blockers first where available
- lowest readiness
- planned start date
- recently updated

## Project Detail

The `/projects/:id` detail page consumes `GET /projects/:id/detail`, `GET /projects/:id/timeline`, and `GET /projects/:id/audit-summary`.

Sections:

- Header
- Readiness scorecard
- Strategic sidebar
- Overview tab
- Source context tab
- Operations ownership tab
- Scope & Location tab
- Readiness tab
- Compliance / Safety tab
- Financial / Billing readiness tab
- Documentation tab
- Constraints / Risks tab
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

Action routes:

- `POST /projects/:id/recalculate-readiness`
- `POST /projects/:id/mark-ready-for-work`
- `POST /projects/:id/start`
- `POST /projects/:id/place-on-hold`
- `POST /projects/:id/release-hold`
- `POST /projects/:id/complete`
- `POST /projects/:id/close`
- `POST /projects/:id/archive`

## Readiness Scorecard

Cards:

- Project Readiness
- Coverage Readiness
- Compliance Readiness
- Financial Readiness
- Open Constraints
- Hard Blockers
- Warnings
- Recommended Next Action

Warnings should be visible and overridable only when backend permits. Blockers should disable the blocked action.

Bands:

- `not_ready`: 0-39
- `needs_planning`: 40-69
- `ready_with_risk`: 70-84
- `ready_for_work`: 85-100

## Edit Page

The `/projects/:id/edit` page uses `PATCH /projects/:id` for planning fields only:

- `project_name`
- `project_phase`
- `scope_summary`
- `location_summary`
- `planned_start_date`
- `planned_end_date`
- `operations_owner_user_id`
- `project_manager_user_id`
- `field_supervisor_user_id`
- `billing_package_requirements`
- `documentation_requirements`
- `customer_validation_requirements`
- `risk_notes`

Lifecycle status changes remain on dedicated backend action routes.

## Permissions

The UI surfaces these permissions:

- `project.read`
- `project.update`
- `project.recalculate_readiness`
- `project.mark_ready`
- `project.start`
- `project.place_hold`
- `project.release_hold`
- `project.complete`
- `project.close`
- `project.archive`
- `project.timeline.read`
- `project.audit.read`

The backend remains the source of truth for every action.

## Future Work Order Placeholder

Message:

“Work Orders are not available in this sprint. A Work Order will represent a specific package of assigned work under this project.”

## Future Production Placeholder

Message:

“Production entry is not available in this sprint. Production records will capture field-completed work against work orders.”

## Timeline

Use `GET /projects/:id/timeline`.

Display project events and linked handoff project-created event where returned.

## Audit

Use `GET /projects/:id/audit-summary`.

Only visible when the actor has `project.audit.read`.

Unauthorized users see a permission message instead of audit payloads.

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
