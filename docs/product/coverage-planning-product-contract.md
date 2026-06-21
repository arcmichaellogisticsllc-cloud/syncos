# Coverage Planning Product Contract

Coverage Planning is the operator workspace between awarded opportunity and future project handoff. It answers whether awarded work can be covered across capacity readiness, compliance readiness, and economic or margin readiness.

Coverage Planning does not create projects, work orders, production records, settlements, invoices, payments, payroll, AR, or cash records.

## Workspace Routes

- `/opportunities/coverage`: coverage plan list.
- `/opportunities/coverage/new`: create coverage plan for awarded opportunity.
- `/opportunities/coverage/:id`: coverage plan detail.
- `/opportunities/coverage/:id/edit`: edit plan owner and notes.

The Opportunity navigation includes Candidate Board, Opportunity Pipeline, Coverage Planning, and the Pursuit Management placeholder.

## Backend Endpoints Used

Coverage plan APIs:

- `GET /coverage-plans`
- `GET /coverage-plans/:id`
- `GET /coverage-plans/:id/detail`
- `GET /coverage-plans/:id/timeline`
- `GET /coverage-plans/:id/audit-summary`
- `POST /coverage-plans`
- `PATCH /coverage-plans/:id`
- `POST /coverage-plans/:id/recalculate`
- `POST /coverage-plans/:id/approve-for-handoff`
- `POST /coverage-plans/:id/archive`

Requirement APIs:

- `GET /coverage-plans/:id/requirements`
- `POST /coverage-plans/:id/requirements`
- `PATCH /coverage-requirements/:id`
- `POST /coverage-requirements/:id/archive`

Source APIs:

- `GET /coverage-plans/:id/sources`
- `POST /coverage-plans/:id/sources`
- `PATCH /coverage-sources/:id`
- `POST /coverage-sources/:id/archive`

Gap APIs:

- `GET /coverage-plans/:id/gaps`
- `POST /coverage-plans/:id/gaps`
- `PATCH /coverage-gaps/:id`
- `POST /coverage-gaps/:id/resolve`
- `POST /coverage-gaps/:id/override`
- `POST /coverage-gaps/:id/archive`

Related read APIs:

- `GET /opportunities`
- `GET /opportunities/:id/detail`
- `GET /organizations`
- `GET /capacity-providers`
- `GET /crews`
- `GET /equipment`
- `GET /compliance-documents`
- `GET /constraints`
- `GET /recommendations`
- `GET /auth/me/permissions`

The web app never direct-queries the database.

## Coverage Plan List Fields

The list displays:

- coverage plan identifier
- opportunity and opportunity value
- status
- coverage, capacity, compliance, and economic readiness scores
- readiness band
- requirements count
- sources count
- open gaps count
- hard stop count
- operations owner
- approved-for-handoff state
- updated date
- recommended next action

The backend provides enriched list rows. The UI does not fetch every plan detail row just to calculate list counts, hard stops, owner names, warnings, blockers, or recommended next action.

Backend list fields include:

- active and total requirement counts
- active and total source counts
- total, open, hard-stop, overridden, resolved, economic, compliance, and capacity gap counts
- owner and approval actor names where safe
- warnings and blockers
- required override fields
- backend recommended next action
- ready-for-handoff, hard-stop, economic-risk, compliance-risk, and capacity-gap flags

## Filters And Sorting

Filters:

- status
- opportunity
- territory
- work type
- readiness score range
- capacity readiness range
- compliance readiness range
- economic readiness range
- has requirements
- has sources
- has open gaps
- has hard stop gaps
- economic risk
- compliance risk
- capacity gap
- approved for handoff
- operations owner
- archived or active
- text search

Quick filters:

- Needs Requirements
- Needs Sources
- Gap Exists
- Hard Stop
- Economic Risk
- Covered With Risk
- Ready For Handoff
- Approved For Handoff
- Blocked

Sorting:

- default: hard stops first, lowest readiness, recently updated
- recently updated
- lowest readiness
- highest readiness
- most gaps
- hard stops first
- opportunity value
- status
- approved date

## Coverage Detail Sections

Coverage detail shows:

- header and primary actions
- readiness scorecard
- strategic sidebar
- opportunity context
- requirements
- sources
- gaps
- economic / margin readiness
- compliance readiness
- approval for handoff
- constraints and recommendations where safely related
- timeline placeholder
- audit placeholder

Timeline and audit panels consume backend coverage endpoints. The audit panel is visible only when the user has `coverage_plan.audit.read`; otherwise the UI shows an authorized-only state.

## Requirement Behavior

Operators can add, edit, and archive requirements when permissions allow.

Required UI fields:

- `work_type`
- `quantity`
- `unit`
- `territory_id`

Optional fields:

- `required_crew_type`
- `required_equipment_type`
- `required_start_date`
- `required_end_date`
- `production_rate_assumption`
- `notes`

Approved units:

- feet
- miles
- drops
- addresses
- passings
- splice_cases
- nodes
- poles
- permits
- inspections
- restoration_items
- days
- crews
- workers
- equipment_units

## Source Behavior

Operators can add, edit, and archive sources when permissions allow.

Required UI fields:

- `source_type`
- `covered_quantity`
- `unit`
- `confidence_score`
- `commitment_status`

Optional fields:

- `coverage_requirement_id`
- `organization_id`
- `capacity_provider_id`
- `crew_id`
- `equipment_id`
- `activation_steps`
- `estimated_cost`
- `expected_margin_amount`
- `expected_margin_percent`
- `margin_confidence`
- `notes`

Coverage sources identify possible coverage. They are not work order assignments.

## Gap Behavior

Operators can add, edit, resolve, override, and archive gaps when permissions allow.

Required UI fields:

- `gap_type`
- `severity`
- `gap_quantity`
- `unit`

Hard stop gaps visibly block approval for handoff. Non-hard-stop gaps can be resolved or overridden through backend routes.

## Economic Readiness Behavior

Economic readiness displays:

- opportunity value
- explicit source estimated cost if captured
- explicit expected margin amount if captured
- explicit expected margin percent if captured
- margin confidence
- economic readiness score
- economic status
- margin-related gaps

Unknown margin, low margin, and negative margin are warnings. They do not automatically hard-block handoff approval unless a hard stop gap exists.

No pricing engine, rate schedule, or finance record is created.

## Compliance Readiness Behavior

Compliance readiness uses available provider and compliance document data where safe. If backend data is not rich enough, the UI displays:
Compliance readiness uses backend-safe indicators: coverage compliance gaps, provider-linked sources, capacity provider state, capacity record compliance/insurance status, and provider-linked compliance documents where available. If backend data is not rich enough, the UI displays:

`Compliance readiness is partially available. Richer compliance review will be hardened in a future sprint.`

Compliance gaps can be added manually through the supported gap API. The UI does not auto-create constraints or recommendations.

## Approval For Handoff

Approval for handoff uses:

`POST /coverage-plans/:id/approve-for-handoff`

Required:

- `approval_note`
- `override_reasons` for backend warnings

Rules shown in UI:

- hard stop gaps disable approval
- unresolved non-hard-stop warnings require override reasons
- approval success displays that no project was created

Backend override fields are:

- `economic_override_reason`
- `capacity_override_reason`
- `compliance_override_reason`
- `gaps_override_reason`
- `source_override_reason`

Coverage approval moves the plan toward future Project Handoff only. It does not create execution or finance records.

## Permissions Surfaced

The UI hides or disables actions based on:

- `coverage_plan.read`
- `coverage_plan.create`
- `coverage_plan.update`
- `coverage_plan.recalculate`
- `coverage_plan.approve_handoff`
- `coverage_plan.archive`
- `coverage_plan.audit.read`
- `coverage_requirement.read`
- `coverage_requirement.create`
- `coverage_requirement.update`
- `coverage_requirement.archive`
- `coverage_source.read`
- `coverage_source.create`
- `coverage_source.update`
- `coverage_source.archive`
- `coverage_gap.read`
- `coverage_gap.create`
- `coverage_gap.update`
- `coverage_gap.resolve`
- `coverage_gap.override`
- `coverage_gap.archive`

The backend remains the source of truth for authorization, validation, tenant isolation, events, audit logs, and system actions.

## Unsupported Sections

- Rich compliance review is partial where backend data is unavailable.
- Coverage Planning does not create constraints automatically.
- Coverage Planning does not generate recommendations automatically.
- Coverage Planning does not create project handoff records.

## Physical Test Expectations

Physical testing must validate that a non-developer operator can create and manage a coverage plan, requirements, sources, gaps, recalculation, and approval for handoff without database access or API calls. The test must also confirm that no downstream execution or finance records are created.
