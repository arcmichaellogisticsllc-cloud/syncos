# Award & Project Handoff Rules Clarification

Original clarification commit: `309014bff0a79ef4dbb14aa4b24004ce9a3dde46`

Implementation update: Project Handoff Backend Contract Foundation was implemented after Coverage Planning hardening at commit `6ced244dd0e54bf73afac2addc5168bbc9a77be4`.

This document is a rules clarification artifact only. It does not approve implementation, migrations, routes, UI, workflow categories, project automation, capacity deployment, work order automation, production automation, settlement automation, invoicing, payment records, payroll, or AI automation.

The implemented Project Handoff backend foundation creates first-class handoff, checklist, risk, and approval records. It preserves the rule that awarded work and coverage approval do not automatically create a project. Project creation is explicit through `POST /project-handoffs/:id/create-project` after handoff approval and creates only a `planning` project.

## Files Inspected

- `apps/api/src/routes/opportunities.controller.ts`
- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/capacity.controller.ts`
- `apps/api/src/routes/settlements.controller.ts`
- `apps/api/src/routes/cash.controller.ts`
- `packages/database/migrations/007_capacity_providers_crews_workers_equipment.sql`
- `packages/database/migrations/008_compliance_documents_capacity_records.sql`
- `packages/database/migrations/009_projects_work_orders_production.sql`
- `packages/database/migrations/010_contracts_rates_settlements_invoices_payments.sql`
- `packages/database/migrations/012_events_actions_approvals_audit.sql`
- `packages/database/migrations/022_opportunity_pipeline_contract_hardening.sql`
- `packages/database/migrations/023_opportunity_approval_policy_hardening.sql`
- `packages/permissions/src/index.ts`
- `docs/product/opportunity-approval-policy.md`
- `docs/product/opportunity-pipeline-backend-contract.md`
- `docs/product/opportunity-pipeline-product-contract.md`
- `docs/product/opportunity-pipeline-physical-test.md`

## Current Backend Inventory

| Area | Classification | Current state |
| --- | --- | --- |
| Opportunity award route | partially supported | `POST /opportunities/:id/award` requires `opportunity.award`, current role authority, status `negotiation`, `award_evidence`, and `customer_confirmation`; it stores `awarded_by`, `awarded_at`, status/stage `awarded`, emits `opportunity.awarded`, and returns a handoff message. |
| Opportunity awarded status | supported | `awarded` is an approved/persisted opportunity status. Existing docs state award does not create downstream execution or finance records. |
| Opportunity approval policy | supported for pursuit only | Pursuit approval tiers, warnings, hard blockers, and override fields are hardened. Award thresholds are explicitly deferred. |
| Project table | partially supported | `projects` exists with `tenant_id`, `opportunity_id`, `customer_organization_id`, `name`, status `created/active/archived`, timestamps, and soft delete. It lacks handoff readiness fields, operations owner, project manager, scope/location details, capacity/compliance/financial readiness, and proposed project statuses. |
| Project routes | partially supported | `GET /projects`, `GET /projects/:id`, `POST /projects`, `PATCH /projects/:id`, and archive exist. Manual create requires an awarded opportunity and customer organization, then creates status `created`. No explicit handoff approval gate exists. |
| Current award-to-project behavior | partially supported | Award does not auto-create a project. A separate manual `POST /projects` can create a project from an awarded opportunity. No route currently named `POST /opportunities/:id/create-project`. |
| Work order table/routes | supported as execution primitives | Work orders exist and can be created under projects, assigned to capacity providers/crews, started, updated, and archived. Assignment requires activated capacity provider; start requires assigned status. No award handoff integration exists. |
| Production record table/routes | supported as execution primitives | Production records, evidence, QC review, accept/reject/approve, billable, correction, stop-work, and release-stop-work flows exist with permissions/events/audit. They are not tied to award handoff readiness. |
| Capacity provider/crew/equipment tables/routes | supported as capacity primitives | Capacity providers, crews, workers, equipment, capacity records, compliance documents, and gap analyses exist. Activation requires contracted provider, approved documents, capacity record, compliant/approved compliance status, and active/approved insurance status. |
| Compliance document routes | supported for provider compliance | Compliance documents can be created, updated, verified by Compliance Manager, and archived. Compliance is capacity-provider scoped; no direct project handoff compliance checklist exists. |
| Contracts/rate schedules/rate codes | supported as finance/contract primitives | Contract, rate schedule, and rate code CRUD exists. Contracts may reference opportunities. No project handoff requirement binds opportunity award to contract/rate readiness. |
| Settlements/invoices/payments | supported as finance primitives | Settlement, settlement item, invoice, AR, and payment routes exist with lifecycle controls. They are not automatically created from awards or projects. |
| Current permissions | supported but not handoff-specific | Permissions exist for opportunity award, project create/update/archive, work orders, production, capacity, compliance, contracts/rates, settlements, invoices, payments, and audit/timeline reads. No `opportunity.award_accept`, `project_handoff.approve`, or `opportunity.create_project` permission exists. |
| Current events | supported for existing writes | Existing writes use `executeWriteAction` and emit events such as `opportunity.awarded`, `project.created`, `work_order.created`, `production_record.created`, `capacity_provider.activated`, `contract.created`, `settlement.created`, `invoice.created`, and `payment.created`. No distinct award acceptance or project handoff events exist. |
| Current audit behavior | supported | Writes create event, event payload, audit log, and system action through shared write helper. Audit/event tables are append-only. |
| Project creation readiness | missing | There is no backend readiness checklist for operations, capacity, compliance, customer/contract, financial, or constraint review before project creation. |
| Award acceptance policy | missing | Award currently marks opportunity awarded; it is not separated from a stricter award acceptance decision with value tiers and override model. |
| Project handoff object/state | missing | No dedicated handoff table, handoff status, handoff checklist, handoff event set, or handoff approval route exists. |
| Automatic downstream creation | supported as absent | Current award route returns “No project was created.” Inspection found no award-side creation of projects, work orders, contracts, settlements, invoices, payments, payroll, or cash. |

## Implemented Project Handoff Backend Foundation

The backend now includes:

- `project_handoffs`
- `project_handoff_checklist_items`
- `project_handoff_risks`
- `project_handoff_approvals`

Implemented routes include:

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
- checklist item routes
- handoff risk routes
- approval list route

Implemented rules:

- handoff requires an awarded opportunity
- handoff requires a coverage plan with `status = approved_for_handoff`
- duplicate active handoff for the same coverage plan requires an override reason
- default checklist items are created on handoff creation
- handoff readiness is backend-calculated from checklist/risk state
- unresolved hard stops block approval and project creation
- non-hard-stop warnings require override reasons
- handoff approval does not create a project
- project creation requires explicit `POST /project-handoffs/:id/create-project`
- explicit project creation requires both `project_handoff.create_project` and `project.create`
- explicit project creation creates one `projects` row with `status = planning`
- no work orders, production records, settlements, invoices, payments, payroll, AR, or cash records are created

Deferred:

- Project Handoff UI
- Project Workspace UI
- award acceptance value threshold enforcement
- work order start gates
- production readiness gates
- finance readiness gates

## Definitions

Awarded Opportunity: a growth-side opportunity record showing Jackson has been awarded or selected for work.

Award Acceptance: management decision that Jackson is willing to accept responsibility for the awarded work. Award acceptance is stricter than pursuit approval because it may lead to operational commitment.

Project Handoff: controlled transition from Growth to Operations. It validates operational ownership, scope, capacity, compliance, customer/contract, financial readiness, and constraints before execution records are created or activated.

Project: execution-side container for awarded work accepted into operations.

Work Order: specific unit of assigned work under a project.

Production Record: field-recorded work completed against a work order.

Important boundaries:

- Awarded status does not automatically mean a project exists.
- Awarded status does not automatically mean Jackson is ready to execute.
- Project handoff is not the same decision as award.

## Award Acceptance Authority

Proposed award acceptance authority:

| Award tier | Estimated value | Allowed roles |
| --- | --- | --- |
| Tier 1 Award | `$0-$49,999` | Regional Director, Executive, System Admin |
| Tier 2 Award | `$50,000-$249,999` | Regional Director, Executive, System Admin |
| Tier 3 Award | `$250,000+` | Executive, System Admin |
| Missing value | Missing estimated value | Executive or System Admin unless Product approves Regional Director with override |

Growth Director may approve pursuit under `$50k` but should not approve award acceptance unless explicitly approved later.

System Admin is included for system administration/testing and emergency data correction, not normal business approval.

Recommendation: implement award thresholds during Award Acceptance Policy Hardening, before Project Handoff Backend Contract Foundation.

## Award Acceptance Policy

Award acceptance should verify:

- opportunity belongs to tenant
- actor has `opportunity.award`
- actor meets award value authority
- opportunity is in valid lifecycle state
- opportunity is not archived
- organization exists
- territory exists
- owner exists
- estimated value exists or approved missing-value override exists
- scope is sufficiently described
- award evidence and customer confirmation exist
- capacity readiness was reviewed
- compliance readiness was reviewed
- contract/customer readiness was reviewed
- financial readiness was reviewed
- critical constraints were reviewed
- no `hard_stop = true` constraint exists

Award acceptance may proceed with warnings and override reasons for:

- weak relationship access
- missing relationship map
- capacity not fully deployed
- project manager not assigned yet
- billing contact missing
- AP contact missing
- final rate schedule not attached
- PO/NTP pending, if not legally required before acceptance
- scope partially incomplete
- non-critical constraints

Award acceptance must hard-stop for:

- tenant mismatch
- actor lacks permission
- actor lacks award authority
- invalid lifecycle transition
- archived opportunity
- illegal/prohibited work
- explicit safety hard stop
- explicit compliance hard stop
- explicit contract prohibition
- fraud/falsified evidence
- executive hold
- any `hard_stop = true` constraint

## Award Value Thresholds

Award thresholds should be stricter than pursuit thresholds.

Recommended first implementation:

- Tier 1 and Tier 2 awards may be accepted by Regional Director, Executive, or System Admin.
- Tier 3 awards may be accepted only by Executive or System Admin.
- Growth Director is excluded from award acceptance.
- Missing estimated value should require Executive/System Admin unless Product explicitly approves Regional Director with override.

Open decision: whether award thresholds should be enforced on existing `POST /opportunities/:id/award` or whether award should remain status-only while a new `POST /opportunities/:id/accept-award` handles authority and readiness.

## Project Handoff Definition

Project Handoff is the controlled operations acceptance process.

It answers:

- Are we ready to operationalize this award?
- Who owns operations?
- What work needs to be done?
- What capacity is required?
- What compliance is required?
- What documentation is required?
- What billing rules apply?
- What rate schedule applies?
- What constraints must be resolved before field work starts?

Award means Jackson won or was selected. Project Handoff means Operations is ready to convert that award into executable work.

## Project Creation Trigger

Options:

| Option | Assessment |
| --- | --- |
| A. Award automatically creates project | Not recommended. This collapses Growth and Operations boundaries and can create execution records before readiness. |
| B. Award creates Project Handoff Required status/task only | Recommended if workflow linkage is approved and existing workflow categories can be reused safely. |
| C. Operations manually creates project from awarded opportunity after readiness checklist | Recommended if no handoff workflow/task support is approved yet. Current backend partially supports manual project creation from awarded opportunity, but lacks readiness checks. |
| D. New route `POST /opportunities/:id/create-project` | Recommended future implementation after handoff rules are approved. It should enforce handoff readiness before creating the project. |

Recommendation: do not auto-create project on award. Use explicit project handoff action after readiness checks. If a future route is approved, prefer `POST /opportunities/:id/create-project` because it keeps the handoff source and audit trail clear.

## Project Readiness Checklist

Core identity:

- opportunity is awarded
- tenant valid
- organization/customer confirmed
- territory confirmed
- work type confirmed
- scope summary present
- location summary present

Operational ownership:

- operations owner assigned
- project manager assigned or explicitly deferred
- field supervisor/foreman plan identified if available

Capacity:

- capacity requirements defined
- required crew type identified
- required equipment identified where applicable
- capacity coverage reviewed
- capacity gap identified if any

Compliance:

- customer requirements reviewed
- insurance requirements reviewed
- subcontractor requirements reviewed if applicable
- safety requirements reviewed
- permits/ROW requirements reviewed if applicable

Customer/contract:

- customer organization confirmed
- prime organization identified if applicable
- contract/MSA requirement identified
- PO requirement identified
- NTP requirement identified
- rate schedule requirement identified
- documentation package requirement identified

Financial:

- billing method identified
- billing contact identified or override reason captured
- AP contact identified if available or override reason captured
- payment terms known or marked unknown with override
- retainage known or marked unknown
- customer payment risk reviewed

Constraint review:

- no `hard_stop = true` constraints
- critical constraints reviewed
- non-critical constraints assigned or overridden

Handoff decision:

- approved_by
- approved_at
- handoff_notes
- override reasons if any

## Capacity Readiness Rules

At pursuit, capacity unknown is warning + override. At project handoff, capacity readiness should be stricter.

Hard requirements before project creation:

- capacity requirements defined
- territory defined
- work type defined
- required crew type defined

Warnings with override:

- specific crew not assigned
- equipment not assigned
- subcontractor not activated yet
- availability not confirmed
- capacity gap exists but recruiting/coverage plan exists

Hard stops:

- no possible capacity path
- required capacity provider is compliance-blocked
- safety hard stop
- executive hold

Open decision: whether project can be created with capacity warnings, or whether project can be created but cannot move to `ready_for_work` until capacity warnings are resolved.

## Compliance Readiness Rules

Compliance readiness depends on stage:

- before pursuit: warning unless legally required
- before project creation: stronger gate
- before field work: strict gate

Project handoff should require compliance review.

Hard stops may include:

- expired insurance where required
- missing mandatory safety requirement
- missing required customer onboarding document
- compliance document rejected
- safety stop-work condition
- legal/contract prohibition

Warnings may include:

- compliance document pending
- customer requirement not fully mapped
- safety docs need update
- missing non-critical document

Recommendation: project may be created with compliance warnings if approved by authorized operations/management actor, but work order start should be stricter in a later Production/Work Order hardening sprint.

## Customer / Contract Readiness Rules

Project handoff should identify:

- customer organization
- prime organization if applicable
- contract/MSA requirement
- purchase order requirement
- NTP requirement
- rate schedule requirement
- billing package requirement
- documentation package requirement
- customer project manager
- customer inspector/validator
- billing/AP contact

Hard stops:

- known contract prohibition
- required agreement absent when legally required before execution
- customer disallowed status if later modeled

Warnings:

- PO not received yet
- NTP pending
- billing contact missing
- AP contact missing
- rate schedule pending

Open decision: whether PO/NTP and rate schedule are required before project creation, before `ready_for_work`, or before billing only.

## Financial Readiness Rules

Financial readiness should not create finance records during handoff unless a future finance sprint explicitly approves it.

At project handoff, SyncOS should identify:

- expected contract requirement
- rate schedule requirement
- expected billing method
- expected payment terms
- retainage if known
- invoice requirements
- settlement package requirements
- customer payment risk

Do not create from award/project handoff:

- contracts
- settlements
- settlement items
- invoices
- AR
- payments
- payroll
- cash records

Financial warnings:

- rate schedule unknown
- payment terms unknown
- billing contact missing
- AP contact missing
- customer payment risk high

Financial hard stops:

- known non-payment prohibition
- contract prohibition
- executive hold

## Project Object Boundary

Project should represent:

- awarded work accepted into operations
- operational owner
- customer/prime/territory
- scope
- location
- work type
- planned dates
- capacity requirements
- compliance requirements
- project status
- handoff source opportunity

Project should not represent:

- individual daily production
- work order line execution
- invoice
- settlement
- payment
- crew payroll

## Project Status Proposal

Proposed project statuses:

- `handoff_pending`: awarded opportunity needs operational acceptance.
- `planning`: project exists but execution details are being prepared.
- `ready_for_work`: required pre-work checks are satisfied.
- `active`: field work has started.
- `on_hold`: project paused.
- `completed`: field work completed.
- `closed`: operational/financial closeout complete.
- `archived`: inactive historical record.

Current backend project statuses are only `created`, `active`, and `archived`. Project status hardening is required before building a full Project Workspace.

## Override And Hard-Stop Rules

Warnings may be overridden only by actors with approved authority and a required reason. Override records should capture warning type, reason, actor, timestamp, and related object if available.

Hard stops cannot be overridden in this clarification.

Hard-stop sources:

- tenant boundary violation
- missing permission
- insufficient award/handoff authority
- invalid lifecycle state
- archived opportunity/project
- explicit legal prohibition
- explicit safety hard stop
- explicit compliance hard stop
- explicit contract prohibition
- fraud/falsified evidence
- executive hold
- `hard_stop = true` constraint

Warnings:

- weak/missing relationship access
- pending capacity assignment
- missing specific crew/equipment
- pending non-critical compliance document
- AP/billing contact missing
- rate schedule pending
- PO/NTP pending unless legally required
- non-critical constraints

## Events And Audit Requirements

Current supported events include existing write events such as:

- `opportunity.awarded`
- `project.created`
- `project.updated`
- `project.archived`
- `work_order.created`
- `work_order.assigned`
- `work_order.started`
- `production_record.created`
- `capacity_provider.activated`
- `contract.created`
- `rate_schedule.created`
- `settlement.created`
- `invoice.created`
- `payment.created`

Proposed future events:

- `opportunity.award_accepted`
- `opportunity.project_handoff_started`
- `opportunity.project_handoff_approved`
- `opportunity.project_handoff_rejected`
- `opportunity.project_created_from_award`
- `project.handoff_received`
- `project.ready_for_work`

Recommendation: avoid event sprawl. If award acceptance remains part of the existing award action, enrich `opportunity.awarded` payload with award tier, warnings, blockers, and override reasons. If award acceptance becomes a separate management decision, add `opportunity.award_accepted`.

Award acceptance audit must capture:

- actor
- timestamp
- opportunity id
- tenant id
- estimated value
- award tier
- required roles
- warnings
- blockers
- override reasons
- status before
- status after

Project handoff audit must capture:

- actor
- timestamp
- opportunity id
- project id if created
- readiness checklist
- warnings
- blockers
- override reasons
- operations owner
- project manager if assigned
- handoff decision

Every future write must continue through the shared write-action helper and create event, event payload, audit log, and system action.

## Future UI Behavior Rules

Award / Project Handoff UI should show:

- award tier
- required award approver role
- award warnings
- award blockers
- project handoff readiness checklist
- capacity readiness
- compliance readiness
- customer/contract readiness
- financial readiness
- override fields
- project creation eligibility

Award button behavior:

- disabled if hard blockers exist
- enabled with override fields if warnings exist and actor has authority
- disabled if actor lacks award authority

Project handoff button behavior:

- disabled if opportunity is not awarded
- disabled if hard blockers exist
- enabled with override fields if warnings exist and actor has handoff authority

## Required Product Confirmations

1. Are award value thresholds approved as proposed?
2. Should Growth Director be excluded from award acceptance?
3. Should award acceptance be separate from project handoff?
4. Should award automatically create a project? Recommendation: no.
5. Should project creation require explicit handoff approval?
6. Which roles can approve project handoff?
7. Can a project be created with compliance warnings?
8. Can a project be created with capacity warnings?
9. Should work order start be stricter than project creation?
10. Should rate schedule be required before project creation, before `ready_for_work`, or before billing only?
11. Should PO/NTP be required before project creation, before work order start, or only before field work begins?
12. Should project handoff create workflow tasks or only expose readiness state?
13. Should award override data use the existing `opportunity.awarded` payload or a separate `opportunity.award_accepted` event?
14. Should project creation route be `POST /opportunities/:id/create-project`?
15. What is the minimum approved project field set?
16. Should missing estimated value for award acceptance be Executive/System Admin only, or Regional Director+ with override?
17. Should project handoff have its own permission such as `project_handoff.approve` or reuse `project.create` plus role authority?

## Recommended Next Coding Sprint

Recommended sequence:

1. Award Acceptance Policy Hardening
2. Project Handoff Backend Contract Foundation
3. Capacity Workspace

### Option A: Award Acceptance Policy Hardening

Scope:

- award thresholds
- award warnings/blockers
- award override fields
- award audit/event payload
- no project creation

This is the recommended immediate next sprint because award authority should be locked before handoff or capacity workspace work.

### Option B: Project Handoff Backend Contract Foundation

Scope:

- handoff readiness fields or read model
- explicit create-project-from-opportunity route if approved
- handoff checklist
- project created only after handoff
- no work orders, production, finance, payroll, or capacity deployment automation

### Option C: Capacity Workspace

Only proceed first if Product explicitly defers award/project handoff enforcement and accepts that current project creation remains manual with limited readiness checks.

## Ambiguities / Stop Points

- Award currently changes status directly; Product must decide whether that is “award acceptance” or only “award recorded.”
- Manual `POST /projects` currently creates a project from an awarded opportunity with minimal readiness checks; Product must decide whether this should remain allowed before handoff hardening.
- Project handoff roles are not defined.
- Minimum project fields are not defined.
- Compliance warning vs hard-stop timing is not defined for project creation versus work order start.
- Capacity warning vs hard-stop timing is not defined for project creation versus work order start.
- PO/NTP/rate schedule timing is not defined.
- Event strategy is ambiguous: enrich `opportunity.awarded` or create `opportunity.award_accepted`.
- Workflow task behavior is ambiguous and should not be inferred.

## GO / NO-GO Recommendation

NO-GO for Capacity Workspace, Project Workspace, or Production Workspace UI as the next coding sprint until award acceptance and project handoff rules are approved.

GO for a narrow Award Acceptance Policy Hardening sprint after Product confirms the award thresholds, Growth Director exclusion, event strategy, and whether award acceptance is separate from project handoff.

GO for Project Handoff Backend Contract Foundation only after Product confirms handoff authority roles, minimum project fields, readiness checklist blocking rules, and the explicit project creation route.
