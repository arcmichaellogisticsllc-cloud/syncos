# Work Order Rules Clarification

Current validated commit: `2ad8c2ca8f16feedbff2823826b565f604f40ff7`

This is a rules clarification artifact. It does not change code, create migrations, create routes, create UI, or approve production, settlement, invoice, payment, payroll, AR, or cash automation.

Approved execution chain:

`Opportunity -> Award -> Coverage Planning -> Coverage Approval -> Project Handoff -> Project -> Work Orders -> Production -> QC -> Billable -> Settlement -> Cash`

Project answers: what awarded work are we responsible for operationally?

Work Order answers: what specific package of work is ready to be assigned, tracked, produced, validated, and eventually billed?

## Files Inspected

- `packages/database/migrations/009_projects_work_orders_production.sql`
- `packages/database/migrations/016_tenant_fk_hardening.sql`
- `packages/database/migrations/024_coverage_planning_contract_foundation.sql`
- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/search.controller.ts`
- `packages/permissions/src/index.ts`
- `packages/database/scripts/seed.js`
- `apps/api/scripts/sprint5-smoke.js`
- `apps/api/scripts/sprint6-smoke.js`
- `docs/product/project-backend-contract.md`
- `docs/product/project-workspace-product-contract.md`

## 1. Current Backend Inventory

| Area | Classification | Current behavior |
| --- | --- | --- |
| `work_orders` table | partially supported | Exists with `project_id`, assigned provider/crew, `title`, `work_type`, location text/GPS, `expected_units`, `unit_type`, status, timestamps, and soft delete. Statuses are limited to `created`, `assigned`, `in_progress`, `archived`. |
| Work order tenant safety | supported | Tenant FKs harden project, capacity provider, and crew relationships. Routes use tenant-scoped helpers. |
| Work order routes | partially supported | Existing routes: `GET /work-orders`, `GET /work-orders/:id`, `POST /work-orders`, `PATCH /work-orders/:id`, `POST /work-orders/:id/assign`, `POST /work-orders/:id/start`, `POST /work-orders/:id/archive`. |
| Work order readiness | missing | No readiness score, readiness status, warning/blocker model, or recommended next action exists for work orders. |
| Work order detail read model | missing | Existing detail returns the raw row, not enriched project, coverage, assignment, production, QC, constraints, timeline, or audit context. |
| Work order timeline/audit endpoints | missing | Existing writes use write helper, but no work-order-scoped timeline or audit summary endpoint exists. |
| Project routes/statuses | supported | Hardened project backend supports `planning`, `ready_for_work`, `active`, `on_hold`, `completed`, `closed`, `archived`, with readiness and lifecycle actions. |
| Project relationship | partially supported | Work orders must reference a tenant-scoped project, but current create route does not require project status `ready_for_work` or `active`. |
| Production records table/routes | supported | Production records exist and require project, work order, provider, production date, quantity, unit, and evidence for submission. |
| Production eligibility | partially supported | Submit requires work order status `in_progress`, but production record creation can occur before work order start. Current route does not enforce project status readiness. |
| QC routes/statuses | supported | QC queue and production QC actions exist: submit, correction required, QC review, accept, reject, approve, clear correction, stop-work, release stop-work, mark billable. |
| Billable/settlement routes | partially supported | Production can be marked billable after approval and rate code validation. Settlement/invoice/payment routes exist downstream. Work order does not create settlement or invoice records. |
| Capacity providers | supported | Provider routes and statuses exist. Work order assignment currently requires provider status `activated`. |
| Crews | supported | Crew relationship exists. Work order assignment can include crew and validates crew belongs to provider when supplied. |
| Workers | partially supported | Worker tables exist, but current work order assignment does not assign workers directly. |
| Equipment | partially supported | Equipment tables exist. Current work order schema has no assigned equipment field. |
| Coverage sources | supported as separate object | `coverage_sources` exist with source type, provider, crew, equipment, quantity, unit, confidence, commitment status, and economic fields. |
| Coverage requirements | supported as separate object | `coverage_requirements` exist with work type, territory, quantity, unit, crew/equipment needs, dates, and production-rate assumption. |
| Coverage gaps | supported as separate object | `coverage_gaps` exist with severity, hard stop, override, quantity, owner, and status fields. |
| Work order to coverage linkage | missing | Current `work_orders` table has no `coverage_plan_id`, `coverage_requirement_id`, or `coverage_source_id`. |
| Project readiness model | supported | Backend project readiness exists and next action returns `prepare_work_orders_later` when project is `ready_for_work`. |
| Project lifecycle model | supported | Project can be marked ready, started, held, completed, closed, and archived. Project actions do not create work orders. |
| Work order permissions | partially supported | Existing permissions: `work_order.read`, `work_order.create`, `work_order.update`, `work_order.assign`, `work_order.start`, `work_order.archive`. Proposed lifecycle needs more granular permissions. |
| Production/QC permissions | supported | Production and QC permissions exist for production creation, submission, correction, QC review, accept/reject/approve, mark billable, evidence, and stop-work actions. |
| Events | partially supported | Current work order events include `work_order.created`, `work_order.updated`, `work_order.assigned`, `work_order.started`, `work_order.archived`. Production/QC/billable events exist downstream. |
| Audit behavior | supported for writes | Current write routes use the shared write helper and create event, event payload, audit log, and system action. |
| Search support | supported | Global search includes tenant-scoped work orders and production records. |

Conclusion: existing work orders are not sufficient for the next Work Order Workspace. A Work Order Backend Contract Foundation is required before UI.

## 2. Work Order Definition

A Work Order is a specific executable work package under a Project.

A Work Order should represent:

- defined scope
- location or route segment
- quantity and unit
- work type
- assigned delivery source
- assigned capacity provider or crew where applicable
- planned dates
- readiness for production
- production status
- QC status
- billable eligibility
- constraints and blockers

A Work Order should not represent:

- the entire project unless the project is very small
- daily production record
- invoice
- settlement
- payment
- payroll
- generic task with no production scope

## 3. Industry Standard Work Order Examples

Underground:

- trench 5,000 feet on Route A
- bore 2,000 feet under road crossing
- place 3 handholes
- restore 20 sidewalk panels

Aerial:

- lash 8,000 feet fiber
- replace 12 poles
- transfer attachments
- make-ready correction package

Drops:

- install 75 residential drops
- complete 22 business drops
- activate service addresses

Splicing:

- splice 4 cases
- test 96-count fiber segment
- complete OTDR package

Inspection / QC:

- inspect completed bore segment
- verify restoration
- complete customer punch list

Make-ready / permits:

- complete make-ready corrections
- permit inspection package
- ROW correction work

## 4. Work Order Relationship To Project

A Work Order must belong to exactly one Project.

The Project must be:

- same tenant
- not archived
- status `ready_for_work` or `active`

Recommended rule:

- Work Order creation should be allowed only when Project status is `ready_for_work` or `active`.
- If product wants work packaging during `planning`, introduce a future `draft` work package state explicitly and prevent production until Project is `ready_for_work` or `active`.
- Production must not be allowed against a work order unless the Project is `ready_for_work` or `active`.

Work Order should inherit or reference from Project:

- customer organization
- territory
- default work type
- location context
- documentation requirements
- validation requirements

## 5. Work Order Relationship To Coverage Plan / Sources

Work Order may reference:

- `coverage_plan_id`
- `coverage_requirement_id`
- `coverage_source_id`

Purpose:

- tie assigned work back to approved coverage planning
- show which requirement the work satisfies
- show which coverage source is expected to cover the work
- support future remaining-coverage calculations

Recommended rules:

- Work Order should reference `coverage_source_id` when assigned to a specific provider/source.
- Work Order should reference `coverage_requirement_id` when the work satisfies a known requirement.
- Assigned work quantity should not exceed coverage source covered quantity unless an override is captured.
- Work Order assignment may reduce remaining available coverage in a future sprint if capacity reservation tracking is approved.

Clarification needed: whether a Work Order must reference coverage source at creation, or only before assignment.

Recommended answer: coverage source is required for assigned work orders and optional for draft/unassigned work orders only if draft work orders are approved.

## 6. Work Order Relationship To Capacity Provider / Crew

Work Order assignment can be to:

- internal crew
- capacity provider
- subcontractor crew
- partner contractor
- equipment source
- staffing source

Recommended fields:

- `assigned_capacity_provider_id`
- `assigned_crew_id`
- `assigned_equipment_id`
- `assigned_organization_id`
- `assignment_type`

Assignment types:

- `internal_crew`
- `subcontractor`
- `partner_contractor`
- `vendor_equipment`
- `staffing_source`
- `unassigned`

Rules:

- Assigned provider, organization, crew, and equipment must belong to the tenant.
- Suspended or archived provider should block assignment unless a future reactivation override is approved.
- Crew must be active/available if status is modeled.
- Assignment to an unverified provider should warn or require override.
- Production submission should be stricter than work order creation.

## 7. Work Order Status Model

Proposed statuses:

- `draft`
- `ready_to_assign`
- `assigned`
- `scheduled`
- `in_progress`
- `submitted`
- `qc_review`
- `corrections_required`
- `approved`
- `billable`
- `closed`
- `on_hold`
- `cancelled`
- `archived`

Definitions:

- `draft`: Scope exists but is not ready for assignment.
- `ready_to_assign`: Scope and readiness are sufficient to assign.
- `assigned`: Provider or crew is assigned.
- `scheduled`: Work has a planned execution date.
- `in_progress`: Field work is underway.
- `submitted`: Production has been submitted for review.
- `qc_review`: QC is reviewing submitted production.
- `corrections_required`: QC or customer requires correction.
- `approved`: Work is accepted operationally.
- `billable`: Work is eligible for billing/settlement later.
- `closed`: Work order complete and closed.
- `on_hold`: Work order is paused.
- `cancelled`: Work order is no longer needed.
- `archived`: Historical inactive record.

Recommended first backend foundation: implement the full status set above, even if some statuses are driven by production/QC routes later.

## 8. Work Order Lifecycle Rules

Proposed transitions:

- `draft -> ready_to_assign`
- `ready_to_assign -> assigned`
- `assigned -> scheduled`
- `scheduled -> in_progress`
- `in_progress -> submitted`
- `submitted -> qc_review`
- `qc_review -> corrections_required`
- `qc_review -> approved`
- `corrections_required -> in_progress`
- `approved -> billable`
- `billable -> closed`
- any active status -> `on_hold`
- `on_hold -> prior status`, or `ready_to_assign` if prior status cannot be safely restored
- `draft`, `ready_to_assign`, `assigned`, or `scheduled` -> `cancelled`
- `closed` or `cancelled` -> `archived`
- `archived` is view-only

Recommended rule: Work Order status may reflect production and QC state, but production records remain the proof system and drive detailed production/QC quantities.

## 9. Work Order Quantity / Unit Model

Work Orders must support telecom units.

Approved units:

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

Required quantity fields:

- `planned_quantity`
- `completed_quantity`
- `approved_quantity`
- `billable_quantity`
- `unit`

Rules:

- `planned_quantity >= 0`
- `completed_quantity` cannot exceed `planned_quantity` without override
- `approved_quantity` cannot exceed `completed_quantity` without override
- `billable_quantity` cannot exceed `approved_quantity` without override
- Unit must be an approved value.
- Production records update completed quantities later.
- QC approval updates approved quantities later.
- Billing readiness updates billable quantities later.

Do not create finance records in the Work Order sprint.

## 10. Work Order Scope / Location Model

Required fields:

- `work_order_name`
- `scope_summary`
- `location_summary`
- `work_type`
- `territory_id`
- `planned_start_date`
- `planned_end_date`

Recommended fields:

- `route_name`
- `node_id`
- `segment_id`
- `address_range`
- `permit_reference`
- `customer_work_order_number`
- `prime_work_order_number`
- `internal_work_order_number`

Geospatial fields may come later:

- latitude / longitude
- route geometry
- map link

Recommended first implementation: use text and reference fields first; do not require map/geospatial support in the backend foundation.

## 11. Work Order Readiness Rules

Readiness answers: can this work order be assigned or started?

Readiness components:

- project status ready
- scope defined
- location defined
- quantity and unit defined
- assigned source/provider/crew when required
- schedule defined
- compliance reviewed
- safety requirements reviewed
- documentation requirements identified
- no hard blockers

Readiness statuses:

- `not_ready`
- `ready_to_assign`
- `ready_to_start`
- `blocked`

Readiness score bands:

- `0-39`: `not_ready`
- `40-69`: `needs_assignment`
- `70-84`: `ready_with_risk`
- `85-100`: `ready_to_start`

Hard blockers:

- project not `ready_for_work` or `active`
- missing scope
- missing location
- missing quantity/unit
- hard-stop safety/compliance issue
- assigned provider suspended/archived
- assigned crew unavailable if modeled
- tenant mismatch
- archived work order

Warnings:

- provider not verified
- schedule missing
- documentation incomplete
- permit pending
- equipment not confirmed
- production rate uncertain
- quantity uncertainty

## 12. Work Order Assignment Rules

Assignment may happen when:

- work order belongs to a ready/active project
- scope, location, quantity, and unit are present
- capacity provider/source/crew belongs to tenant
- no hard blockers exist
- actor has `work_order.assign`

Assignment should store:

- `assigned_capacity_provider_id`
- `assigned_crew_id`
- `assigned_organization_id`
- `assigned_by`
- `assigned_at`
- `assignment_note`

Warnings requiring override:

- provider not active
- crew not fully verified
- coverage source not committed
- capacity gap exists
- schedule uncertainty

Hard blockers:

- provider archived/suspended unless reactivation override is explicitly approved
- crew archived
- tenant mismatch
- compliance hard stop
- safety hard stop

## 13. Work Order Production Eligibility

Production can be entered only when:

- Work Order status is `assigned`, `scheduled`, or `in_progress`
- Project status is `ready_for_work` or `active`
- Work Order is not archived, cancelled, or on hold
- Required production documentation rules are known or overridden
- actor has `production_record.create`
- provider/crew assignment exists unless a direct internal/self-perform override is approved

Clarification needed: whether production can be entered on unassigned work orders.

Recommended answer: no, except explicit administrative override.

## 14. Work Order QC Relationship

QC is downstream of production.

Work Order should surface QC status but not replace production QC records.

Proposed QC statuses:

- `not_started`
- `pending_review`
- `corrections_required`
- `approved`
- `rejected`

Rules:

- Production submission may move Work Order to `submitted` or `qc_review`.
- QC approval may move Work Order to `approved`.
- Corrections may move Work Order to `corrections_required`.
- Work Order itself should not create QC evidence unless a future sprint approves that behavior.

## 15. Work Order Billable Relationship

Billable should happen after QC approval.

Rules:

- Work Order can become billable only after approved quantity exists.
- Billable status does not create settlement automatically.
- Billable quantity should be derived from approved production later.
- Work Order billable status may enable settlement in a later sprint.

Do not create settlement, invoice, AR, payment, cash, or payroll records from Work Order actions.

## 16. Financial Boundary

Work Order may display:

- rate code if known
- customer work order number
- prime work order number
- planned value estimate
- billable quantity
- billing package requirements

Work Order must not create:

- contract
- rate schedule
- settlement
- invoice
- AR
- payment
- payroll

Financial readiness is informational until the billing sprint.

## 17. Work Order Constraints / Risks

Work Order should support related constraints.

Examples:

- missing crew
- missing equipment
- permit not ready
- safety issue
- compliance issue
- unclear scope
- customer access issue
- utility conflict
- material issue
- weather delay
- failed inspection
- correction required

Recommended first implementation: use existing `constraints` with `affected_object_type = 'work_order'` before introducing a separate work order risk object.

Open question: confirm whether constraints are sufficient for Work Order risk management or whether a future first-class work order risk object is needed.

## 18. Work Order Events

Proposed events:

- `work_order.created`
- `work_order.updated`
- `work_order.readiness_recalculated`
- `work_order.ready_to_assign`
- `work_order.assigned`
- `work_order.scheduled`
- `work_order.started`
- `work_order.submitted`
- `work_order.qc_review_started`
- `work_order.corrections_required`
- `work_order.approved`
- `work_order.marked_billable`
- `work_order.closed`
- `work_order.on_hold`
- `work_order.hold_released`
- `work_order.cancelled`
- `work_order.archived`
- `work_order.provider_assigned`
- `work_order.crew_assigned`

Recommendation: use the minimum event set needed for lifecycle, assignment, readiness, and audit clarity in the backend foundation. Do not add event sprawl beyond observable business transitions.

## 19. Audit Requirements

Every Work Order write must capture:

- actor
- timestamp
- tenant
- work order id
- project id
- status before/after
- assignment before/after
- quantity changes
- reason/notes
- correlation id

Assignment audit must capture:

- assigned provider
- assigned crew
- assignment note
- warnings overridden

## 20. Work Order Permissions

Proposed permissions:

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

Current permissions cover only read/create/update/assign/start/archive. Backend foundation should add the missing granular permissions and update seed/role grants after product confirms role ownership.

## 21. Recommended Backend Foundation Scope

Recommended next coding sprint: Work Order Backend Contract Foundation.

Build:

- work order schema hardening
- coverage/project/source/provider linkage
- enriched list/detail endpoints
- create/update/archive with reason persistence
- readiness calculation
- lifecycle routes through at least assigned/scheduled/in_progress
- assignment route hardening
- timeline endpoint
- audit summary endpoint
- search hardening
- smoke test

Do not build:

- production entry UI
- QC evidence expansion
- settlement/billing automation
- crew payroll
- mobile foreman UI

## 22. Required Product Confirmations

1. Should Work Orders require Project status `ready_for_work` or `active`?
2. Can draft Work Orders be created while Project is `planning`?
3. Must Work Orders reference coverage source before assignment?
4. Can Work Orders be assigned to capacity provider without crew?
5. Can Work Orders be assigned directly to crew without provider?
6. Can production be entered without assignment?
7. Should Work Order completed quantity be driven only by production records?
8. Should approved quantity be driven only by QC approval?
9. Should billable quantity be driven only by approved production?
10. Should Work Order marked billable create settlement later or only enable settlement?
11. Are the proposed statuses approved?
12. Are the proposed units approved?
13. Are geospatial/map fields required in first sprint?
14. Should Work Order use existing constraints or get its own risk object?
15. Which roles can assign providers/crews?
16. Which roles can approve Work Orders?
17. Which roles can mark Work Orders billable?
18. Should Work Order archive require reason?
19. Should Work Order cancellation require reason?
20. Should Work Order start automatically start Project if Project is `ready_for_work`?

Recommended answers:

- Work Orders require Project `ready_for_work` or `active` unless product explicitly approves draft work packages during planning.
- Assignment requires provider or crew.
- Production requires assignment.
- Quantities should flow from production, QC, and billable stages later.
- Mark billable should not create settlement automatically.
- Work Order start should not automatically start Project unless explicitly approved.

## 23. Ambiguities Found

- Current backend permits Work Order creation against any tenant-scoped project; product must confirm whether to hard-gate creation to `ready_for_work` or `active`.
- Current backend has `created` status instead of `draft`/`ready_to_assign`; mapping requires approval.
- Current backend requires activated provider for assignment; product must confirm whether warnings/overrides are allowed for qualified/verified but not active providers.
- Current schema does not connect Work Orders to coverage plans, requirements, or sources.
- Current schema has no equipment assignment, organization assignment, assignment type, readiness fields, quantity rollups, archive reason, cancellation reason, timeline endpoint, or audit endpoint.
- Existing production routes can create draft production before Work Order is `in_progress`; product must confirm whether creation should also be gated or only submission should be gated.
- Current Work Order archive does not require a reason.
- No role-to-permission policy is clarified for assignment, approval, or billable actions.

## 24. GO / NO-GO Recommendation

GO for Work Order Backend Contract Foundation.

NO-GO for Work Order Workspace UI, Production Workspace UI, expanded QC UI, settlement automation, invoice automation, payment automation, payroll, or mobile foreman experience until Work Order backend rules are hardened and validated.

The current Work Order primitive is useful but not backend-truthful enough for the approved execution bridge. The next sprint should harden the Work Order backend contract before any operator UI is built.

## 25. Backend Foundation Decisions Applied

The Work Order Backend Contract Foundation sprint applies these clarified decisions:

- Harden the existing `work_orders` table rather than creating a new backend business object.
- Permit draft Work Orders while a Project is `planning`.
- Require Project `ready_for_work` or `active` for assignment/start/production eligibility.
- Keep coverage linkage optional at creation but visible and recommended in readiness.
- Require assignment targets before assignment unless assignment type remains `unassigned`.
- Normalize legacy `created` status to `draft`.
- Require archive and cancellation reasons.
- Treat Work Order `billable` as eligibility only; it creates no settlement, invoice, AR, payment, payroll, or cash record.
- Do not create production records or QC evidence from Work Order lifecycle actions.
