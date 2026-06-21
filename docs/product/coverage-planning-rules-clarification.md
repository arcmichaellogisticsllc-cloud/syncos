# Coverage Planning Rules Clarification

Current validated commit: `309014bff0a79ef4dbb14aa4b24004ce9a3dde46`

Status update: Product approved the Coverage Planning Backend Contract Foundation after this clarification. The implemented backend contract is documented in `docs/product/coverage-planning-backend-contract.md`.

This document was created as a rules clarification artifact. It does not approve UI, workflow categories, project automation, capacity deployment, contractor assignment, work order creation, production automation, settlement automation, invoicing, payment records, payroll, or AI automation.

## Files Inspected

- `apps/api/src/routes/opportunities.controller.ts`
- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/capacity.controller.ts`
- `apps/api/src/routes/constraints.controller.ts`
- `apps/api/src/routes/workflows.controller.ts`
- `apps/api/src/routes/settlements.controller.ts`
- `apps/api/src/routes/cash.controller.ts`
- `packages/database/migrations/007_capacity_providers_crews_workers_equipment.sql`
- `packages/database/migrations/008_compliance_documents_capacity_records.sql`
- `packages/database/migrations/009_projects_work_orders_production.sql`
- `packages/database/migrations/010_contracts_rates_settlements_invoices_payments.sql`
- `packages/database/migrations/011_constraints_recommendations.sql`
- `packages/database/migrations/012_events_actions_approvals_audit.sql`
- `packages/database/migrations/013_workflows_tasks_escalations.sql`
- `packages/database/migrations/022_opportunity_pipeline_contract_hardening.sql`
- `packages/database/migrations/023_opportunity_approval_policy_hardening.sql`
- `packages/permissions/src/index.ts`
- `docs/product/opportunity-approval-policy.md`
- `docs/product/opportunity-pipeline-backend-contract.md`
- `docs/product/opportunity-pipeline-product-contract.md`
- `docs/product/opportunity-pipeline-physical-test.md`
- `docs/product/award-project-handoff-rules-clarification.md`

## Current Backend Inventory

| Area | Classification | Current state |
| --- | --- | --- |
| Opportunities | supported for growth pipeline | Opportunity create, candidate conversion, lifecycle, score, detail, timeline, audit, capacity requirements, and award route exist. Opportunity read models expose readiness/warnings/blockers for pursuit approval. |
| Awarded opportunity behavior | partially supported | `POST /opportunities/:id/award` sets status/stage `awarded`, requires negotiation status, award evidence, customer confirmation, `opportunity.award`, and current role authority. It returns a handoff message and creates no downstream records. No coverage planning step exists. |
| Project routes/tables | partially supported | `projects` table and CRUD/archive routes exist. Manual project creation requires an awarded opportunity and customer organization, but does not require coverage planning, handoff readiness, operations owner, project manager, or capacity/compliance/finance readiness. |
| Capacity providers | supported as capacity primitives | Capacity providers have provider type, organization/contact links, verification/contract/status lifecycle, and activation checks. They do not currently model coverage commitment to an award. |
| Crews | supported as capacity primitives | Crews belong to capacity providers and carry crew type/status. They can later be assigned to work orders; no coverage planning role exists. |
| Workers | supported as capacity primitives | Workers belong to capacity providers and optionally crews. No worker group or coverage commitment model exists. |
| Equipment | supported as capacity primitives | Equipment belongs to capacity providers and optionally crews. No reservation/coverage commitment model exists. |
| Compliance documents | supported for provider compliance | Compliance documents are capacity-provider scoped and include document type/status/verification/expiry. They do not produce project handoff compliance readiness directly. |
| Capacity records | partially supported | Capacity records store provider capacity type, territory, availability, production rate/unit, compliance/insurance status, utilization, quantity/unit, readiness score, and evidence. They represent known capacity, not an award-specific coverage plan. |
| Capacity gap analysis | partially supported, not sufficient for Coverage Planning | `capacity_gap_analyses` stores opportunity/territory, required capacity JSON, available capacity JSON, gap summary JSON, created_by, and status. Route `POST /capacity-gap-analysis` calculates a snapshot from opportunity capacity requirements or supplied required capacity. It has no coverage source commitments, approval state, overrides, gap lifecycle, or handoff readiness. |
| Work orders | supported as execution primitives | Work orders belong to projects, can be assigned to activated capacity providers/crews, and can start only after assignment. Work order assignment is later execution, not coverage planning. |
| Production records | supported as execution primitives | Production record submission/QC/approval/billable/stop-work flows exist. They are downstream of project/work orders and out of Coverage Planning scope. |
| Contracts/rates | supported as finance primitives | Contracts, rate schedules, and rate codes exist, can reference opportunities/contracts/organizations, and are independently managed. Coverage Planning must not create them. |
| Settlements/invoices/payments | supported as finance primitives | Settlement, invoice, AR, and payment routes exist. They are downstream finance and must not be created by Coverage Planning. |
| Constraints | supported as general governance objects | Constraints include severity, status, affected object, owner, due date, and approval policy hardening fields `hard_stop`, `override_allowed`, and `approval_behavior`. Coverage gaps could become constraints only if explicitly approved. |
| Recommendations | supported as general optimization objects | Recommendations exist and may link to related objects. Coverage Planning should not auto-generate recommendations unless future rules approve it. |
| Workflow tasks | supported but unsafe to infer | Workflow definitions, instances, tasks, and escalations exist with categories including `capacity` and `execution`. Creating coverage workflow tasks would require explicit approval and no new workflow category. |
| Events | supported for existing writes | Existing writes use event names such as `opportunity.awarded`, `capacity_gap_analysis.created`, `capacity_record.created`, `project.created`, `work_order.assigned`, and `production_record.created`. No coverage events exist. |
| Audit behavior | supported | Writes use the shared write-action helper, creating event, event payload, audit log, and system action. Event/audit tables are append-only. |
| Permissions | supported for primitives | Permissions exist for opportunity award, capacity provider/record/gap analysis, project, work order, production, constraints, recommendations, workflow tasks, contracts/rates, settlements, invoices, and payments. No coverage-specific permissions exist. |
| Current readiness/checklist logic | partially supported | Pursuit approval readiness exists. Capacity records have readiness scoring. Opportunity detail exposes readiness/warnings/blockers. There is no coverage readiness/checklist model. |

## Coverage Planning Definition

Coverage Planning is a controlled planning process that determines how awarded work can be covered before Project Handoff.

Coverage Planning answers:

- What work was awarded?
- What work types are required?
- What territory is involved?
- What production quantities are expected?
- What crew types are required?
- What equipment is required?
- What compliance requirements apply?
- What capacity sources can cover the work?
- What gaps remain?
- What must be recruited, activated, rented, subcontracted, or escalated?
- Can the work move to Project Handoff?

Coverage Planning is not:

- crew dispatch
- work order assignment
- field production
- payroll
- contractor settlement
- invoice generation
- project closeout

## Correct Execution Chain

Approved execution chain:

`Opportunity -> Award -> Award Acceptance -> Coverage Planning -> Project Handoff -> Project -> Work Orders -> Production -> QC -> Billable -> Settlement -> Cash`

Winning work and covering work are separate decisions.

Award means the contractor has been selected or awarded work. Award Acceptance means the contractor is willing to accept responsibility for the awarded work. Coverage Planning means the contractor has identified how the work can be covered through available or actionable capacity sources. Project Handoff means Operations has enough readiness to create an execution-side project.

## Coverage Source Taxonomy

Valid coverage source types:

1. Internal Workforce: crews/workers/equipment directly controlled by the contractor.
2. Approved Subcontractor: external contractor already qualified, verified, contracted, and active.
3. Preferred Contractor: approved subcontractor with stronger reliability/history.
4. Strategic Partner: high-trust contractor with repeatable coverage value.
5. Recruitable Contractor: potential contractor not fully active yet but available for onboarding.
6. Partner Workforce: friendly contractor or partner organization that may cover work through relationship or agreement.
7. Vendor / Equipment Source: equipment/material/service vendor required to unlock execution.
8. Staffing Source: labor provider that can fill worker gaps.
9. Mixed Coverage: combination of multiple sources.

Rules:

- Coverage source should not require ownership of the crew.
- Coverage source should link to capacity provider, organization, crew, equipment, worker, or future recruiting target where possible.
- Unknown source may exist during early planning but cannot be considered fully covered.
- Coverage source is a planning signal, not work order assignment.

## Required Capacity Concepts

Required Capacity: what the awarded work requires, including crew type, worker count, equipment type, estimated quantity, production unit, expected production rate, dates, territory, and compliance requirements.

Available Capacity: capacity known and available but not committed to the awarded work.

Committed Capacity: capacity specifically assigned or reserved for the awarded work. Existing backend does not model this as a first-class coverage state.

Covered Capacity: required capacity that has a credible source.

Coverage Gap: required capacity that has no credible source yet.

Coverage Confidence: reliability of the coverage plan.

Coverage Risk: likelihood that coverage failure affects execution.

## Coverage Unit Model

Approved unit examples:

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

Coverage items should identify:

- work_type
- quantity
- unit
- territory
- required_start_date
- required_end_date
- required_crew_type
- required_equipment_type
- production_rate_assumption
- notes

## Coverage Readiness Model

Proposed statuses:

- `not_started`: no coverage planning has started.
- `requirements_defined`: required work/capacity has been defined.
- `sources_identified`: potential coverage sources exist.
- `partially_covered`: some required capacity is covered.
- `fully_covered`: all required capacity has credible coverage.
- `covered_with_risk`: coverage exists but with meaningful risk.
- `gap_exists`: some required capacity has no credible coverage source.
- `blocked`: a hard stop prevents coverage.
- `approved_for_handoff`: coverage has been approved to move toward Project Handoff.

## Coverage Readiness Score

Future score components:

- requirements completeness
- capacity source coverage
- compliance readiness
- equipment readiness
- schedule confidence
- contractor readiness
- risk level
- gap severity

Score bands:

| Score | Band |
| --- | --- |
| `0-39` | Not ready |
| `40-69` | Needs coverage work |
| `70-84` | Covered with risk |
| `85-100` | Ready for handoff |

Recommendation: future backend-calculated score, initially deterministic/checklist-based. Manual score should be avoided unless Product explicitly approves because coverage scoring affects operational readiness.

## Coverage Gap Model

Gap types:

- `no_capacity_source`
- `insufficient_crew_count`
- `insufficient_worker_count`
- `equipment_gap`
- `compliance_gap`
- `schedule_gap`
- `territory_gap`
- `production_rate_gap`
- `subcontractor_not_active`
- `contractor_not_verified`
- `insurance_gap`
- `safety_gap`
- `permit_or_row_gap`
- `material_or_vendor_gap`
- `unknown_scope_gap`

Each gap should include:

- gap_type
- severity
- required_quantity
- covered_quantity
- gap_quantity
- unit
- related_capacity_source
- owner_user_id
- due_date
- recommended_action
- override_allowed
- hard_stop

Severity values:

- `low`
- `medium`
- `high`
- `critical`

## Coverage Warnings Vs Hard Stops

Coverage warnings should not automatically block planning.

Warnings:

- source identified but not committed
- subcontractor not yet activated
- equipment not yet reserved
- compliance pending
- production rate uncertain
- partial coverage
- schedule risk
- unknown final quantity
- coverage depends on recruiting
- partner commitment verbal only

Hard stops:

- no possible capacity path
- safety hard stop
- compliance hard stop
- legal/contract prohibition
- executive hold
- disallowed subcontractor
- rejected compliance document required before work
- fraud/falsified capacity evidence

Default rule: Coverage gap = warning/action path. Coverage `hard_stop = true` = blocker.

## Coverage Approval Rules

Coverage plan may be approved for handoff when:

- awarded opportunity exists
- award accepted or equivalent approval exists
- required work types are defined
- territory is defined
- capacity requirements are defined
- coverage sources are identified
- coverage gaps are resolved or overridden
- no hard-stop gap exists
- operations owner is identified
- project handoff checklist can be started

Coverage approval should require one of:

- Operations Manager
- Regional Director
- Executive
- System Admin

If estimated value exceeds `$250k` or critical coverage risk exists, Executive or Regional Director should be required.

Clarification required: exact approval roles and whether `$250k+` coverage risk should require Executive only or Regional Director/Executive.

## Coverage Override Rules

Coverage approval may proceed with override when:

- partially covered
- covered with risk
- gap exists but credible action plan exists
- subcontractor activation pending
- equipment reservation pending
- compliance pending but not hard stop
- final quantities unknown

Override must capture:

- override_reason
- override_note
- approved_by
- approved_at
- gap types overridden
- action plan

Coverage cannot be overridden when:

- `hard_stop = true`
- safety stop
- legal/contract prohibition
- executive hold
- no possible capacity path unless future Executive override is explicitly approved

No Executive Emergency Override should be added unless Product explicitly approves it.

## Project Handoff Relationship

Coverage Planning should output one of:

- `not_ready_for_handoff`
- `ready_for_handoff`
- `ready_for_handoff_with_risk`
- `blocked`

Project Handoff should not begin until:

- coverage requirements are defined
- coverage readiness is reviewed
- coverage gaps are visible
- no hard-stop gap exists

Project Handoff may begin with:

- coverage risk
- pending subcontractor activation
- pending equipment assignment
- pending compliance items

provided override and action path exist.

## Capacity Provider Relationship

Coverage Planning should use existing capacity concepts.

Capacity provider states:

- `unknown`
- `qualified`
- `verified`
- `contracted`
- `active`
- `suspended`
- `archived`

Coverage source quality should depend on capacity provider status:

| Status | Coverage meaning |
| --- | --- |
| Unknown | low confidence |
| Qualified | possible source |
| Verified | credible source |
| Contracted | strong source |
| Active | ready source |
| Suspended/Archived | not valid unless override/reactivation path exists |

Coverage Planning must distinguish:

- source identified
- source approved
- source committed
- source unavailable

## Contractor Assignment Boundary

Coverage Planning is not final contractor assignment.

Coverage Planning may identify:

- preferred coverage provider
- backup coverage provider
- coverage source type
- expected quantity covered
- coverage confidence
- required activation steps

Actual assignment belongs later to:

- Project Workspace
- Work Order Workspace
- Production Workspace

Do not treat coverage source as work order assignment.

## Compliance Boundary

Coverage Planning should review compliance but not necessarily complete all compliance.

Coverage can proceed with warnings when:

- non-critical compliance items are pending
- insurance renewal is pending but not required immediately
- safety docs need update
- onboarding docs are incomplete but actionable

Coverage should hard-stop when:

- required insurance is missing for immediate work
- compliance document is rejected
- safety requirement failed
- legal/customer prohibition exists

Clarification required: which compliance items are required before coverage approval, project handoff, work order start, production submission, and settlement/billing.

## Financial Boundary

Coverage Planning must not create financial records.

Do not create:

- contracts
- rate schedules
- settlements
- settlement items
- invoices
- AR
- payments
- payroll
- cash records

Coverage Planning may show financial readiness warnings:

- rate schedule unknown
- expected margin unknown
- payment terms unknown
- billing contact missing
- AP contact missing

These warnings do not block coverage unless explicit executive/contract hold exists.

## Object Model Question

Option A: extend `opportunity_capacity_requirements`.

Pros:

- uses existing backend
- lower complexity
- already tied to opportunity planning

Cons:

- does not naturally model multiple sources, commitment state, provider quality, gap lifecycle, or approval-for-handoff.

Option B: new `coverage_plans` object.

Pros:

- clear execution bridge between Award Acceptance and Project Handoff
- supports multiple coverage sources
- supports requirements, sources, gaps, overrides, readiness, and handoff state
- avoids overloading capacity records or gap analysis snapshots

Cons:

- new business object/model requiring explicit approval

Option C: extend `capacity_gap_analyses`.

Pros:

- uses an existing concept and route
- already calculates required vs available capacity

Cons:

- current table is snapshot/math JSON, not an approval workflow
- no child sources, source commitments, gap owners, override reasons, handoff approval, or lifecycle beyond created/archived
- unsafe to use as the full Coverage Planning contract without hardening

Approved update: Coverage Planning is a first-class backend object: `coverage_plans` with child records `coverage_requirements`, `coverage_sources`, and `coverage_gaps`. The foundation implements these objects only; it does not include Coverage Planning UI, Project Handoff, Project Workspace, work orders, production, or finance automation.

## Proposed Future Coverage Objects

If first-class Coverage Planning is approved:

`coverage_plans`:

- tenant_id
- source_opportunity_id
- source_award_id if future award acceptance object exists
- status
- readiness_score
- readiness_band
- operations_owner_user_id
- approved_for_handoff_by
- approved_for_handoff_at
- override_reasons
- notes

`coverage_requirements`:

- coverage_plan_id
- work_type
- territory_id
- quantity
- unit
- required_crew_type
- required_equipment_type
- start_date
- end_date
- production_rate_assumption

`coverage_sources`:

- coverage_plan_id
- source_type
- organization_id
- capacity_provider_id
- crew_id
- equipment_id
- worker_group_reference if future
- covered_quantity
- unit
- confidence_score
- commitment_status
- activation_steps
- notes

`coverage_gaps`:

- coverage_plan_id
- gap_type
- severity
- required_quantity
- covered_quantity
- gap_quantity
- unit
- owner_user_id
- due_date
- recommended_action
- override_allowed
- hard_stop
- status

Do not create these objects now.

## Coverage Events

Potential future events:

- `coverage_plan.created`
- `coverage_plan.updated`
- `coverage_plan.requirements_defined`
- `coverage_plan.source_added`
- `coverage_plan.source_updated`
- `coverage_plan.gap_identified`
- `coverage_plan.gap_resolved`
- `coverage_plan.approved_for_handoff`
- `coverage_plan.blocked`
- `coverage_plan.archived`

Avoid event sprawl unless needed.

Minimum future implementation should include:

- `coverage_plan.created`
- `coverage_plan.updated`
- `coverage_plan.approved_for_handoff`
- `coverage_gap.created`
- `coverage_gap.resolved`

## Audit Requirements

Coverage audit must capture:

- actor
- timestamp
- opportunity id
- coverage plan id
- requirement changes
- source changes
- gap changes
- override reasons
- approval decision
- readiness score
- status before/after

Coverage approval audit must make clear:

- who approved coverage
- what gaps existed
- what was overridden
- what action plan exists
- why it can move to handoff

Every future write must continue through the shared write-action helper and create event, event payload, audit log, and system action.

## Future UI Behavior Rules

Future Coverage Planning UI should show:

- awarded opportunity context
- award acceptance state
- coverage status
- readiness score
- required work/capacity
- coverage sources
- coverage gaps
- warnings
- blockers
- override fields
- action plan
- approve for handoff button

Coverage gaps should not hide the plan. Hard stops should disable approval. Warnings should require override fields.

Coverage plan should visually distinguish:

- covered
- partially covered
- gap exists
- blocked

## Required Product Confirmations

1. Is Coverage Planning a required layer between Award Acceptance and Project Handoff?
2. Should Coverage Planning be a first-class object?
3. Should `coverage_plans`, `coverage_requirements`, `coverage_sources`, and `coverage_gaps` be created in the future?
4. Should coverage approval be required before Project Handoff?
5. Which roles can approve coverage for handoff?
6. Can coverage be approved with unresolved non-hard-stop gaps?
7. Can coverage be approved when subcontractor activation is pending?
8. Can coverage be approved when equipment is not yet assigned?
9. Can coverage be approved when compliance is pending but not hard stop?
10. What coverage readiness score threshold is required for handoff?
11. Should coverage unknown block project creation?
12. Should coverage planning create workflow tasks for gaps?
13. Should coverage gaps also create constraints?
14. Should coverage source commitment be tracked before work order assignment?
15. Should capacity provider status affect coverage confidence?
16. Should Work Order Start be stricter than Project Creation?
17. Should Coverage Planning come before Capacity Workspace UI?
18. Should `capacity_gap_analyses` remain a snapshot tool after first-class Coverage Planning exists?
19. Should recruitable contractors be modeled as organizations, capacity providers, contacts, or a future recruiting target?
20. Should coverage approval use new permissions such as `coverage_plan.approve`?

## Recommended Next Coding Sprint

Recommended sequence based on inspected system state:

1. Award Acceptance Policy Hardening
2. Coverage Planning Backend Contract Foundation
3. Coverage Planning Workspace
4. Project Handoff Backend Contract
5. Project Workspace
6. Capacity Workspace / Contractor Coverage Workspace

### Option A: Coverage Planning Backend Contract Foundation

Scope:

- create first-class coverage plan model if approved
- no full UI yet
- tie awarded opportunity to coverage plan
- define requirements/sources/gaps
- expose readiness output
- approve for handoff
- no project creation unless separately approved
- no work orders, production, finance, payroll, or capacity deployment automation

This is the recommended coding sprint after Award Acceptance Policy Hardening, because current `capacity_gap_analyses` is not enough to carry the operational bridge.

### Option B: Award Acceptance Policy Hardening

Scope:

- enforce award thresholds
- add award acceptance event or enrich `opportunity.awarded` payload
- no project creation

This should still happen before Coverage Planning if Product wants award acceptance authority locked first.

### Option C: Capacity Workspace UI

Only proceed first if Product explicitly defers Coverage Planning and accepts that capacity UI will expose primitives without award-specific coverage approval.

## Ambiguities / Stop Points

- Coverage Planning is not represented by a current backend object.
- `capacity_gap_analyses` is a snapshot and is not sufficient as a full coverage approval workflow.
- Coverage approval roles are not confirmed.
- Coverage source taxonomy is proposed, not implemented.
- Recruitable contractor modeling is undefined.
- Coverage gap to constraint behavior is undefined.
- Coverage workflow task creation is undefined and must not be inferred.
- Compliance timing is undefined across coverage approval, project handoff, work order start, production, and billing.
- Coverage readiness score threshold for handoff is undefined.
- Whether coverage unknown blocks project creation is undefined.

## GO / NO-GO Recommendation

NO-GO for Project Workspace, Production Workspace, or Capacity Workspace UI as the next coding sprint until Coverage Planning is approved or explicitly deferred.

GO for Award Acceptance Policy Hardening first if Product wants award authority locked before creating coverage objects.

GO for Coverage Planning Backend Contract Foundation after Product confirmation of first-class coverage objects, override rules, coverage source taxonomy, and the Project Handoff dependency. No downstream execution or finance automation is approved by this GO.
