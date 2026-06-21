# Project Handoff Backend Contract

Current validated implementation commit: pending.

Project Handoff is the backend governance gate between coverage-approved awarded work and explicit project creation.

Boundary: Project Handoff may create one `planning` project only through `POST /project-handoffs/:id/create-project` after handoff approval rules pass. It must not create work orders, production records, settlements, invoices, payments, payroll, AR, or cash records.

## Object Model

`project_handoffs`

- Links one awarded `opportunity` and one approved-for-handoff `coverage_plan`.
- Stores handoff status, readiness score/band, operations owner, project manager, field supervisor, customer/prime, territory, work type, scope/location, expected dates, approval/rejection/archive metadata, override reasons, and optional created project link.
- One active handoff per coverage plan is enforced by route validation unless an override reason is supplied.

Statuses:

- `draft`
- `readiness_review`
- `ready_for_project`
- `approved`
- `rejected`
- `project_created`
- `blocked`
- `archived`

`project_handoff_checklist_items`

- Stores checklist category, key, label, status, required flag, hard stop flag, override behavior, owner/due date, completion, override, notes, and archive metadata.
- Default checklist items are generated at handoff creation.

Checklist categories:

- `core_identity`
- `operations_ownership`
- `coverage`
- `capacity`
- `compliance`
- `customer_contract`
- `financial_readiness`
- `documentation`
- `risk_review`

`project_handoff_risks`

- Stores operational risks, severity, source object, recommended action, hard stop/override behavior, owner/due date, resolution, override, and archive metadata.

`project_handoff_approvals`

- Stores approval records for `handoff_approval` and `project_creation_approval`, including readiness score, warnings, blockers, and override reasons.

## Readiness

Readiness is deterministic:

- `completed applicable checklist items / applicable checklist items * 100`
- unresolved hard stop checklist item, hard stop risk, hard blocked risk, or hard stop coverage gap caps readiness at `39`
- unresolved critical non-hard-stop risk caps readiness at `69`
- unresolved warning items keep readiness below `85`

Bands:

- `not_ready`: `0-39`
- `needs_handoff_work`: `40-69`
- `ready_with_risk`: `70-84`
- `ready_for_project`: `85-100`

## Warnings And Blockers

Warnings require override reasons but do not create downstream records:

- incomplete non-hard-stop checklist items
- open non-hard-stop risks
- missing project manager
- missing field supervisor
- coverage approved with risk

Blockers stop handoff approval and project creation:

- archived handoff
- opportunity not awarded
- coverage plan not approved for handoff
- missing customer organization
- missing territory
- missing work type
- missing scope summary
- missing location summary
- unresolved hard stop coverage gap
- unresolved hard stop checklist item
- unresolved hard stop risk
- hard blocked risk

## Project Creation Boundary

Route: `POST /project-handoffs/:id/create-project`

Required:

- `creation_note`
- actor has `project_handoff.create_project`
- actor has `project.create`
- handoff status is `approved`
- no project already linked
- no hard blockers
- `customer_organization_id`
- `territory_id`
- `work_type`
- `scope_summary`
- `location_summary`
- `operations_owner_user_id`
- `project_manager_user_id` or `project_manager_override_reason`
- `expected_start_date` or `expected_start_override_reason`

On success:

- creates one `projects` row with `status = planning`
- sets `source_opportunity_id`
- sets `source_coverage_plan_id`
- sets `source_project_handoff_id`
- links `project_handoffs.project_id`
- sets handoff `status = project_created`
- emits `project_handoff.project_created`
- emits additional `project.created`
- creates audit/system_action through write-action helper

It does not create work orders, production, settlement, invoice, payment, payroll, AR, or cash records.

## Routes

Project handoffs:

- `GET /project-handoffs`
- `GET /project-handoffs/:id`
- `GET /project-handoffs/:id/detail`
- `POST /project-handoffs`
- `PATCH /project-handoffs/:id`
- `POST /project-handoffs/:id/recalculate`
- `POST /project-handoffs/:id/submit-readiness-review`
- `POST /project-handoffs/:id/approve`
- `POST /project-handoffs/:id/reject`
- `POST /project-handoffs/:id/create-project`
- `POST /project-handoffs/:id/archive`
- `GET /project-handoffs/:id/timeline`
- `GET /project-handoffs/:id/audit-summary`

Checklist:

- `GET /project-handoffs/:id/checklist-items`
- `POST /project-handoffs/:id/checklist-items`
- `PATCH /project-handoff-checklist-items/:id`
- `POST /project-handoff-checklist-items/:id/complete`
- `POST /project-handoff-checklist-items/:id/override`
- `POST /project-handoff-checklist-items/:id/archive`

Risks:

- `GET /project-handoffs/:id/risks`
- `POST /project-handoffs/:id/risks`
- `PATCH /project-handoff-risks/:id`
- `POST /project-handoff-risks/:id/resolve`
- `POST /project-handoff-risks/:id/override`
- `POST /project-handoff-risks/:id/archive`

Approvals:

- `GET /project-handoffs/:id/approvals`

## Permissions

Added permissions:

- `project_handoff.read`
- `project_handoff.create`
- `project_handoff.update`
- `project_handoff.recalculate`
- `project_handoff.submit_review`
- `project_handoff.approve`
- `project_handoff.reject`
- `project_handoff.create_project`
- `project_handoff.archive`
- `project_handoff.timeline.read`
- `project_handoff.audit.read`
- `project_handoff_checklist.read`
- `project_handoff_checklist.create`
- `project_handoff_checklist.update`
- `project_handoff_checklist.complete`
- `project_handoff_checklist.override`
- `project_handoff_checklist.archive`
- `project_handoff_risk.read`
- `project_handoff_risk.create`
- `project_handoff_risk.update`
- `project_handoff_risk.resolve`
- `project_handoff_risk.override`
- `project_handoff_risk.archive`
- `project_handoff_approval.read`

Project creation also requires existing `project.create`.

## Events

Added handoff events:

- `project_handoff.created`
- `project_handoff.updated`
- `project_handoff.recalculated`
- `project_handoff.readiness_review_submitted`
- `project_handoff.approved`
- `project_handoff.rejected`
- `project_handoff.project_created`
- `project_handoff.archived`
- `project_handoff_checklist.created`
- `project_handoff_checklist.updated`
- `project_handoff_checklist.completed`
- `project_handoff_checklist.overridden`
- `project_handoff_checklist.archived`
- `project_handoff_risk.created`
- `project_handoff_risk.updated`
- `project_handoff_risk.resolved`
- `project_handoff_risk.overridden`
- `project_handoff_risk.archived`

Existing event reused:

- `project.created`

## Timeline And Audit

Timeline returns direct handoff, checklist, risk, and created project events.

Audit summary returns direct handoff, checklist, risk, approval, and created project audit rows where tenant-safe and authorized.

## Deferred

- Project Handoff UI
- Project Workspace UI
- Work Order creation
- Capacity deployment
- Production
- Settlement/invoice/payment/payroll/AR/cash
- Award acceptance value thresholds
- Workflow task generation
