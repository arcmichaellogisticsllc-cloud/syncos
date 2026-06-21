# Project Workspace Rules And Product Spec

Project is the execution-side system of record for awarded work accepted into operations. It is the operational container for planning, readiness, monitoring, completion, and closeout.

Project is not a work order, daily production record, settlement, invoice, payment, payroll, AR, or cash record.

## Current Backend Inventory

| Area | Classification | Notes |
| --- | --- | --- |
| Projects table | supported | Hardened with source handoff/coverage/opportunity fields, organization context, ownership, planned/actual dates, readiness scores, requirements JSON, hold/closeout/archive fields. |
| Project routes | supported | List, read, detail, update, readiness recalculation, lifecycle actions, timeline, and audit summary exist. |
| Project created from handoff | supported | Explicit `POST /project-handoffs/:id/create-project` creates exactly one planning project and links source ids. |
| Work orders | supported downstream, out of scope | Work order table/routes exist but Project Workspace hardening does not create them. |
| Production records | supported downstream, out of scope | Production routes exist but Project Workspace hardening does not create them. |
| Capacity/coverage relationship | supported | Projects can link to source coverage plan and carry readiness scores. |
| Project handoff relationship | supported | Projects can link to source project handoff. |
| Constraints relationship | partially supported | Constraint counts/readiness use existing affected-object model. No new project constraint workflow was added. |
| Compliance relationship | partially supported | Compliance readiness score is carried; richer project compliance review is deferred. |
| Contracts/rates relationship | missing for project | Financial readiness is represented by requirements and score fields. No contract/rate creation or linking was added. |
| Events/audit behavior | supported | Project writes use write-action helper. |
| Permissions | supported | Project lifecycle, timeline, and audit permissions are seeded. |
| Search support | supported | Global search includes active projects and excludes archived projects by default. |

## Product Definition

A telecom construction Project represents:

- customer, prime, and contractor relationship context
- territory and market
- awarded scope
- location or build area
- work type
- operational ownership
- project manager and field supervision responsibility
- planned dates
- readiness, compliance, coverage, documentation, customer validation, and billing-package expectations
- execution constraints and project-level risk
- status through completion and closeout

A Project does not represent:

- individual task assignment
- daily units completed
- crew payroll
- invoice
- settlement
- payment
- work ticket unless a later approved domain model defines it

## Status Model

Approved statuses:

- `planning`
- `ready_for_work`
- `active`
- `on_hold`
- `completed`
- `closed`
- `archived`

Legacy `created` remains compatible for existing records.

Project creation from handoff starts as `planning`.

## Phase Model

Approved phases:

- `intake`
- `planning`
- `pre_construction`
- `construction`
- `closeout`
- `complete`

Phase is operational context and should not replace status.

## Readiness Model

Project readiness answers: is this project ready to move toward future work order creation or field start?

Checklist categories:

- Core identity
- Operations ownership
- Coverage/capacity
- Compliance/safety
- Customer/contract
- Financial/billing
- Documentation
- Constraints/risks

Readiness score is deterministic and backend-calculated. Warnings reduce readiness but do not automatically block. Hard blockers cap readiness and prevent `ready_for_work`.

## Warning And Blocker Rules

Warnings:

- missing project manager
- missing field supervisor
- PO/NTP pending
- rate schedule pending
- billing/AP contact missing
- customer validation contact missing
- compliance or safety documents pending
- permits/ROW pending
- coverage approved with risk
- margin/economic risk
- unresolved non-hard-stop constraints
- documentation incomplete

Blockers:

- tenant mismatch
- archived project
- missing customer organization
- missing territory
- missing work type
- missing scope summary
- missing location summary
- unresolved safety/compliance/legal hard stop
- executive hold
- source handoff missing or invalid
- source coverage plan missing or invalid for handoff-created project

## Lifecycle Rules

Project lifecycle actions must use backend routes, not generic status edits when route exists.

- `mark-ready-for-work`: no blockers; warnings require override reason.
- `start`: requires ready_for_work and creates no work order.
- `place-on-hold`: requires hold reason.
- `release-hold`: requires release note.
- `complete`: requires completion note and creates no finance records.
- `close`: requires closeout notes and creates no settlement/invoice/payment.
- `archive`: requires archive reason.

## Product Workspace Specification

Future routes:

- `/projects`
- `/projects/:id`
- `/projects/:id/edit`

Project list should show:

- project name
- status and phase
- source opportunity
- source coverage plan
- source handoff
- customer
- territory
- work type
- planned dates
- operations owner
- project manager
- field supervisor
- readiness scores and band
- open constraints count
- hard-stop constraints count
- work order count if safe
- production record count if safe
- recommended next action

Project detail should include:

- header
- readiness scorecard
- source opportunity panel
- source coverage plan panel
- source project handoff panel
- operations ownership panel
- scope/location panel
- compliance/safety panel
- financial/billing readiness panel
- documentation requirements panel
- constraints/risk panel
- future work orders placeholder
- future production placeholder
- timeline
- audit

## No Downstream Creation Rule

Project Workspace must not create:

- work orders
- production records
- crew dispatch
- settlements
- invoices
- payments
- payroll
- AR
- cash

Project start means project status changes to `active`; it does not start work orders or production.

## Unsupported / Deferred

- Full Project Workspace UI
- Work Order creation from project
- Production entry
- QC expansion
- Settlement/invoice/payment automation
- Project-specific compliance workflow
- Pricing/rate engine
- AI automation
