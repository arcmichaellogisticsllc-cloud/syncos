# Project Backend Contract

Project is the execution-side operational container created after Project Handoff approval. It is not a work order, production record, settlement, invoice, payment, payroll, AR, or cash record.

## Boundary

Approved chain:

`Opportunity -> Award -> Coverage Planning -> Coverage Approval -> Project Handoff -> Project -> Work Orders -> Production -> QC -> Billable -> Settlement -> Cash`

Project Handoff may create exactly one Project through the explicit handoff create-project route. Project routes must not create work orders, production records, settlement records, invoices, payments, payroll, AR, or cash.

## Schema

The hardened `projects` contract includes:

- Source linkage: `source_opportunity_id`, `source_coverage_plan_id`, `source_project_handoff_id`
- Organization context: `customer_organization_id`, `prime_organization_id`, `contractor_organization_id`
- Operating context: `territory_id`, `work_type`, `scope_summary`, `location_summary`
- Ownership: `operations_owner_user_id`, `project_manager_user_id`, `field_supervisor_user_id`
- Timeline: `planned_start_date`, `planned_end_date`, `actual_start_date`, `actual_end_date`
- Readiness: `coverage_readiness_score`, `compliance_readiness_score`, `financial_readiness_score`, `project_readiness_score`, `project_readiness_band`
- Requirements: `billing_package_requirements`, `documentation_requirements`, `customer_validation_requirements`
- Risk/hold/closeout: `risk_notes`, `hold_reason`, `hold_note`, `hold_released_at`, `hold_release_note`, `previous_status`, `closeout_notes`
- Archive/audit fields: `created_by`, `updated_by`, `archived_by`, `archived_at`, `archive_reason`, `archive_note`

The migration preserves existing records and keeps legacy `created` status compatible while new handoff-created projects start as `planning`.

## Statuses

Supported statuses:

- `planning`
- `ready_for_work`
- `active`
- `on_hold`
- `completed`
- `closed`
- `archived`

Legacy-compatible status:

- `created`

Archived projects are view-only. Work order creation is not part of this contract.

## Phases

Supported phases:

- `intake`
- `planning`
- `pre_construction`
- `construction`
- `closeout`
- `complete`

Phase is separate from status and describes the operational stage.

## Readiness

Project readiness answers: is this project ready to move toward future work order creation or field start?

Backend readiness uses a deterministic checklist across:

- Core identity
- Operations ownership
- Coverage/capacity
- Compliance/safety
- Customer/contract
- Financial/billing
- Documentation
- Constraints/risks

Score formula:

`completed applicable readiness items / applicable readiness items * 100`

Caps:

- Unresolved hard stop or missing core identity caps at `39`
- Missing operations owner or project manager without override caps at `69`
- Compliance/safety unknown or billing/financial unknown caps at `84`

Bands:

- `not_ready`: 0-39
- `needs_planning`: 40-69
- `ready_with_risk`: 70-84
- `ready_for_work`: 85-100

Readiness does not automatically change project status.

## Warnings And Blockers

Warnings include missing project manager, missing field supervisor, PO/NTP pending, rate schedule pending, billing/AP contact gaps, compliance pending, permit/ROW pending, coverage approved with risk, margin/economic risk, unresolved non-hard-stop constraints, and incomplete documentation requirements.

Blockers include tenant mismatch, archived project, missing customer organization, missing territory, missing work type, missing scope summary, missing location summary, unresolved safety/compliance/legal hard stop, executive hold, invalid source handoff, or invalid source coverage plan.

Warnings may be overridden when the route supports override reasons. Blockers stop `ready_for_work`.

## Routes

Project routes:

- `GET /projects`
- `GET /projects/:id`
- `GET /projects/:id/detail`
- `PATCH /projects/:id`
- `POST /projects/:id/recalculate-readiness`
- `POST /projects/:id/mark-ready-for-work`
- `POST /projects/:id/start`
- `POST /projects/:id/place-on-hold`
- `POST /projects/:id/release-hold`
- `POST /projects/:id/complete`
- `POST /projects/:id/close`
- `POST /projects/:id/archive`
- `GET /projects/:id/timeline`
- `GET /projects/:id/audit-summary`

Handoff project creation remains:

- `POST /project-handoffs/:id/create-project`

## Lifecycle Actions

`mark-ready-for-work` requires no blockers. Warnings require `override_reasons.readiness_override_reason`. It sets status to `ready_for_work` and emits `project.ready_for_work`.

`start` requires `ready_for_work`, sets status to `active`, sets `actual_start_date` if missing, and emits `project.started`. It creates no work orders.

`place-on-hold` requires `hold_reason`, stores previous status, sets `on_hold`, and emits `project.on_hold`.

`release-hold` requires `release_note`, restores the previous safe status or `planning`, and emits `project.hold_released`.

`complete` requires `completion_note`, sets status to `completed`, sets `actual_end_date` if missing, and emits `project.completed`.

`close` requires `closeout_notes`, requires completed status unless override is supplied, sets `closed`, and emits `project.closed`. It creates no finance records.

`archive` requires approved `archive_reason`, sets `archived`, and emits `project.archived`.

## Enriched Reads

`GET /projects` returns enriched project rows with source ids/names, customer and territory names, owner names, readiness scores/bands, constraint/work order/production/coverage gap counts where safe, warnings, blockers, `recommended_next_action`, and `ready_for_work`.

`GET /projects/:id/detail` returns project, source opportunity, source coverage plan, source project handoff, customer context, operations context, readiness, warnings, blockers, requirements, constraints summary, work order summary, production summary, timeline availability, and audit permission state.

## Recommended Next Action

Backend next action rules:

- `view_only` for archived
- `resolve_blockers` when blockers exist
- `recalculate_readiness` when no stored readiness score exists
- `complete_project_readiness` for planning below 85
- `mark_ready_for_work` for planning at or above 85
- `prepare_work_orders_later` for ready_for_work
- `monitor_execution` for active
- `resolve_hold` for on_hold
- `begin_closeout` for completed
- `view_closed_project` for closed
- `review_project` fallback

## Permissions

Project permissions:

- `project.read`
- `project.create`
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

Every route remains tenant scoped.

## Events And Audit

Project writes use the write-action helper and create event, event payload, audit log, and system action.

Project events:

- `project.created`
- `project.updated`
- `project.readiness_recalculated`
- `project.ready_for_work`
- `project.started`
- `project.on_hold`
- `project.hold_released`
- `project.completed`
- `project.closed`
- `project.archived`

Timeline includes project events and the linked `project_handoff.project_created` event where applicable.

Audit summary requires `project.audit.read` and returns project audit records plus linked handoff project-creation audit where safe.

## Search

Global search includes tenant-scoped projects by project name, scope summary, location summary, customer organization, territory, and status. Archived projects are excluded unless `archived=true`.

## Deferred

- Project Workspace UI
- Work Order Workspace
- Production Workspace
- Crew dispatch
- Billing/settlement/finance automation
- Project-specific checklist object
- Project-level compliance workflow expansion
