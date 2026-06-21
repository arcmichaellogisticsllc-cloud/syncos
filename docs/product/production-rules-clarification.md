# Production Rules Clarification

Current validated commit: `0d957a4fe2357e45de844d32fef2ae4fb6dc878e`

Purpose: define the Production object before building Production backend hardening, Foreman UI, expanded QC workflows, or billing logic.

Approved execution chain:

`Project -> Work Order -> Production -> QC -> Billable -> Settlement -> Cash`

Work Order answers: what specific work package is assigned?

Production answers: what work actually happened in the field?

Production is the first field-truth layer. QC, approved quantity, billable quantity, settlement, invoice package, cash conversion, contractor performance, crew performance, productivity analytics, safety history, and compliance history all depend on production truth.

## 1. Current Backend Inventory

Inspected files:

- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/search.controller.ts`
- `apps/api/scripts/sprint6-smoke.js`
- `apps/api/scripts/sprint7-smoke.js`
- `apps/api/scripts/sprint11-smoke.js`
- `apps/api/scripts/sprint14-smoke.js`
- `apps/api/scripts/work-order-smoke.js`
- `packages/database/migrations/009_projects_work_orders_production.sql`
- `packages/database/migrations/027_project_backend_contract_hardening.sql`
- `packages/database/migrations/028_work_order_contract_hardening.sql`
- `packages/permissions/src/index.ts`
- `packages/database/scripts/seed.js`
- `package.json`
- `apps/api/package.json`
- `docs/product/work-order-rules-clarification.md`
- `docs/product/work-order-backend-contract.md`
- `docs/product/work-order-workspace-product-contract.md`

| Area | Classification | Current behavior |
| --- | --- | --- |
| `production_records` table | partially supported | Exists with tenant, project, work order, provider, crew, foreman, production date, submitted quantity, accepted/approved/rejected quantities, billable status, stop-work fields, status, and soft delete. It does not include production type, rich location fields, submitted timestamp, draft notes/description, correction linkage, or revision/version model. |
| Production tenant safety | supported | Routes load production records, projects, work orders, providers, crews, contacts, and evidence tenant-safely through tenant-scoped helpers. |
| Production routes | partially supported | Existing routes cover list, get, create draft, update limited fields, submit, correction required, QC review, accept, reject, approve, mark billable, clear correction, stop-work, release stop-work, and archive. No enriched detail, timeline, or audit summary endpoint exists for production. |
| Production create behavior | partially supported | Creates a `draft` production record with required project, work order, provider, production date, quantity, and unit. It does not enforce Work Order production eligibility at creation. |
| Production submit behavior | partially supported | Submit requires Work Order status `in_progress`, quantity, unit, production date, submitted user, and active evidence. It does not validate Project status `ready_for_work` or `active`, assignment match, cumulative quantity limits, or production type-specific rules. |
| Production record types | missing | Current schema does not model `daily_production`, `delay_report`, `completion_submission`, correction submission type, or other production type taxonomy. |
| Production evidence table/routes | partially supported | `production_evidence` exists with evidence type, summary, description, source URL, file id, status, metadata, and archive. Evidence types are limited to `photo`, `video`, `gps`, `daily_report`, `safety_form`, `inspection_note`, `material_ticket`, and `other`. No upload workflow is implemented here. |
| Correction task routes/table | missing | No dedicated correction task table/routes were found. Corrections are modeled on `production_records` with `correction_reason`, `correction_required_at`, `correction_required_by`, and `clear-correction`. |
| QC routes/statuses | partially supported | QC review queue exists, with production actions for review, accept, reject, approve, and clear correction. Current status model includes `accepted`, which is not in the proposed clarification status list. Full QC evidence/workflow remains broader than current backend. |
| Work Orders | supported | Hardened Work Order backend exists with readiness, assignment, lifecycle, QC summary, billable summary, timeline, audit, search, and no downstream creation from Work Order actions. Production summary is count-based. |
| Work Order production eligibility | partially supported | Work Order readiness calculates `production_eligible` when Project is ready/active and Work Order status is assigned/scheduled/in_progress. Production submit only checks Work Order `in_progress`; create does not use the production eligibility contract. |
| Projects | supported | Hardened Project backend exists with statuses `planning`, `ready_for_work`, `active`, `on_hold`, `completed`, `closed`, and `archived`. Production create/submit does not fully enforce Project status. |
| Capacity providers | supported | Capacity provider records exist; production requires provider. Provider active/suspended/verified behavior is not fully enforced in production submission. |
| Crews | supported | Crew records exist; production may reference crew and requires crew/provider alignment when crew is provided. Crew is not always required. |
| Workers | supported as table/domain | Worker records exist in capacity module, but production records do not currently capture worker-level production or worker count. |
| Equipment | supported as table/domain | Equipment records exist, but production records do not currently capture equipment used. |
| Compliance documents | supported as table/domain | Compliance document records exist, but production submission does not perform explicit compliance document readiness checks. |
| Settlements/invoices/payments | supported downstream | Settlement, invoice, AR, payment, and reporting flows exist. Current production `mark-billable` changes production state and requires a rate code but does not itself create settlement, invoice, AR, payment, cash, or payroll records. |
| Billable package logic | partially supported | Production can be marked billable after approval with rate code validation. Settlement item creation later requires billable production. No production-specific billable package object exists. |
| Current production permissions | partially supported | Existing permissions include `production_record.read/create/update/submit/correction_required/archive`, `qc.review/accept/reject/approve`, `production.clear_correction`, `production.mark_billable`, `production_evidence.*`, `stop_work.issue`, and `stop_work.release`. Proposed `production.*` names are not yet aligned. |
| Current production events | partially supported | Write-action helper emits production and evidence events for current routes, including created, updated, submitted, correction required, QC review started, accepted, rejected, approved, billable, correction cleared, stop-work issued/released, archived, and evidence created/updated/archived. Event names use `production_record.*`, not proposed `production.*`. |
| Current audit behavior | supported for writes | Current writes use the write-action helper, which creates event, event payload, audit log, and system action. No production audit-summary endpoint exists. |
| Current search support | supported | Global search includes tenant-scoped `production_record` results and excludes deleted records. Search fields are limited to unit/status/billable/stop-work/correction/rejection text. |
| Current smoke tests | partially supported | `sprint6:smoke` validates current production/QC/billable/stop-work behavior. `work-order:smoke` validates no production/evidence/finance records are created from Work Order actions. No dedicated `production:smoke` script exists. |

Conclusion: existing Production is useful but not sufficient as the next field-truth contract. A Production Backend Contract Foundation is required before Production Workspace UI, Foreman UI, expanded QC UI, or billing automation.

## 2. Production Definition

Production is a field-truth record documenting work completed, attempted, delayed, corrected, or submitted against a Work Order.

Production should represent:

- what work happened
- where it happened
- when it happened
- who performed it
- which crew, contractor, or provider performed it
- what quantity was claimed
- what unit was claimed
- what evidence supports it
- whether it is ready for QC
- whether it was approved, rejected, or corrected
- whether it contributes to billable quantity later

Production should not represent:

- the full Project
- the full Work Order
- invoice
- settlement
- payment
- payroll
- crew timesheet unless later explicitly modeled
- generic note with no field-production meaning

## 3. Production Relationship To Work Orders

Every production record must belong to exactly one Work Order.

Rules:

- Work Order must belong to the same tenant.
- Work Order must not be archived, cancelled, closed, or billable for normal production entry.
- Work Order must be production eligible unless a future administrative override is explicitly approved.
- Work Order assignment should exist unless direct self-perform or administrative override is approved.
- Production should inherit or reference Work Order scope, location, work type, quantity unit, documentation requirements, and validation requirements.

Recommended normal production statuses:

- `assigned`
- `scheduled`
- `in_progress`

Recommended correction/inspection statuses:

- `corrections_required`
- `submitted`, only for inspection or review-support production if approved
- `qc_review`, only for inspection or correction-support production if approved

Production should not be allowed on:

- `draft`
- `ready_to_assign`
- `billable`
- `closed`
- `cancelled`
- `archived`

Clarification required: whether administrative override can permit production against `draft`, `ready_to_assign`, `submitted`, or `qc_review` Work Orders, and which roles can use that override.

## 4. Production Relationship To Projects

Production inherits from Work Order and Project:

- project id
- customer organization
- territory
- work type
- scope/location context
- documentation requirements
- validation requirements

Project must normally be:

- `ready_for_work`
- `active`

Production should not normally be allowed when Project is:

- `planning`
- `on_hold`
- `completed`
- `closed`
- `archived`

Recommended rule: first Production Backend Foundation should not automatically start a Project. Production may create a warning/action path when Project is `ready_for_work`; starting the Project should remain an explicit Project lifecycle action unless product approves automatic activation.

Clarification required: should first accepted production automatically set Project status to `active`?

## 5. Production Relationship To Crews / Contractors / Capacity Providers

Production must identify who performed the work.

Required performer context should include at least one of:

- `capacity_provider_id`
- `crew_id`
- `assigned_organization_id`
- `foreman_user_id`
- `submitted_by_user_id`

Recommended fields for future hardening:

- `capacity_provider_id`
- `crew_id`
- `foreman_user_id`
- `submitted_by_user_id`
- `worker_count`
- `equipment_used`
- `subcontractor_reference`
- `crew_notes`

Rules:

- Provider, crew, organization, equipment, and users must be tenant-safe.
- Provider/crew should match the Work Order assignment unless override reason is supplied.
- Suspended or archived provider should block production submission.
- Archived crew should block production submission.
- Unverified provider should warn or require override, depending final product decision.
- Field user or foreman must have permission to submit production.

## 6. Production Record Type Model

Approved production record types:

- `daily_production`
- `progress_update`
- `completion_submission`
- `correction_submission`
- `inspection_submission`
- `restoration_submission`
- `delay_report`
- `no_work_report`
- `safety_observation`
- `material_issue`
- `access_issue`
- `weather_delay`
- `customer_issue`
- `other`

Definitions:

- `daily_production`: field production completed during a workday.
- `progress_update`: partial field update where no final completion is submitted.
- `completion_submission`: Work Order, segment, or package completion submission.
- `correction_submission`: corrective work submitted after QC, customer, or inspector correction.
- `inspection_submission`: inspection record or field verification.
- `restoration_submission`: restoration-specific completion.
- `delay_report`: work was delayed.
- `no_work_report`: crew was assigned but no production occurred.
- `safety_observation`: safety issue or observation tied to work.
- `material_issue`: material shortage or equipment/material issue.
- `access_issue`: crew could not access the site/location.
- `weather_delay`: weather prevented or delayed production.
- `customer_issue`: customer, prime, or customer inspector blocked progress.
- `other`: requires note.

Current backend gap: production type is not modeled and must be added safely before a field-facing Production Workspace is considered backend-truthful.

## 7. Quantity Model

Production quantity must support telecom units.

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

Recommended production quantity fields:

- `claimed_quantity`
- `approved_quantity`
- `rejected_quantity`
- `corrected_quantity`
- `billable_quantity_later`
- `unit`

Current equivalent fields:

- `quantity_submitted` and `quantity`
- `accepted_quantity`
- `approved_quantity`
- `rejected_quantity`
- `unit_type` and `unit`

Rules:

- `claimed_quantity >= 0`.
- `approved_quantity` defaults null until QC or approval.
- `rejected_quantity` defaults null until QC or rejection.
- `corrected_quantity` defaults null until correction.
- `billable_quantity_later` defaults null until billable stage.
- Claimed production should use the same unit as the Work Order unless override reason is supplied.
- Cumulative claimed quantity should not exceed Work Order planned quantity unless overage override is supplied.
- Approved quantity cannot exceed claimed quantity unless explicit administrative override is approved.
- Billable quantity should derive later from approved quantity, not claimed quantity.

Important rules:

- Claimed production is not automatically approved production.
- Approved production is not automatically billable production.
- Billable production is not automatically settlement.

## 8. Evidence Model

Production evidence is critical.

Approved evidence types:

- `photo`
- `document`
- `form`
- `test_result`
- `gps_point`
- `map_markup`
- `customer_signature`
- `inspector_signature`
- `material_ticket`
- `permit_document`
- `restoration_photo`
- `before_photo`
- `after_photo`
- `other`

Current backend evidence types:

- `photo`
- `video`
- `gps`
- `daily_report`
- `safety_form`
- `inspection_note`
- `material_ticket`
- `other`

Recommended evidence fields:

- `production_record_id`
- `evidence_type`
- `file_url` or storage reference
- `filename`
- `mime_type`
- `uploaded_by`
- `uploaded_at`
- `caption`
- `geo_latitude`
- `geo_longitude`
- `captured_at`
- `metadata`

Current evidence fields:

- `production_record_id`
- `evidence_type`
- `summary`
- `description`
- `source_url`
- `file_id`
- `status`
- `metadata`
- timestamps

Minimum evidence rules:

- Daily production: evidence recommended and required if customer, work type, or documentation requirements require it.
- Completion submission: evidence required.
- Correction submission: evidence required.
- Inspection/restoration submission: evidence required.
- Delay/no-work report: evidence optional but reason required.
- Safety observation: evidence optional but recommended.

Recommendation: implement evidence metadata foundation first if file upload/storage is not already safe for production use. Do not fake file upload or GPS capture.

## 9. Location / Timestamp Model

Recommended production location and timestamp fields:

- `production_date`
- `started_at`
- `ended_at`
- `submitted_at`
- `location_summary`
- `route_name`
- `node_id`
- `segment_id`
- `address_range`
- `latitude`
- `longitude`

Rules:

- `production_date` is required.
- `submitted_at` is set by backend.
- Location should default from Work Order but can be refined by the submitter.
- GPS is optional unless work type/customer requirement makes it mandatory.
- Future mobile UI may capture GPS automatically.
- Do not fake GPS.

Current backend gap: `production_records` has `production_date` but not started/ended/submitted timestamps or rich production location fields.

## 10. Production Submission Rules

Recommended supported modes:

- Option A: create draft production, then submit.
- Option B: create submitted production immediately.

Recommended first backend foundation: support both if safe.

Required fields for submitted production:

- `work_order_id`
- `production_type`
- `production_date`
- `claimed_quantity` for production/completion/correction types
- `unit`
- performer context
- `location_summary`
- notes or description
- evidence if required by type/work rules

Delay/no-work/safety/material/customer issue types may require:

- reason
- description

They may not require claimed quantity.

Current backend behavior:

- `POST /production-records` creates draft records.
- `POST /production-records/:id/submit` submits draft records.
- Submit requires active evidence and Work Order `in_progress`.

Clarification required: should submitted production automatically move Work Order to `submitted`, or should Work Order status only move through explicit Work Order lifecycle routes?

## 11. Revision / Correction Rules

Production corrections must be audit-safe.

Correction concepts:

- QC correction requested
- field correction submitted
- corrected quantity
- corrected evidence
- correction note
- correction due date
- correction owner

Rules:

- Do not mutate approved production silently.
- Revisions should preserve the original record.
- Correction submission should link back to the original production record.
- Correction approval should update corrected/approved state only through an approved route.

Current backend behavior:

- Correction request is modeled on the production record.
- Clearing correction requires updated active evidence after `correction_required_at`.
- No separate `correction_tasks` or `production_revisions` object exists.

Recommended approach: use existing correction fields for the next foundation only if product accepts record-level correction. If multiple correction cycles, field edits after approval, or formal correction assignments are required, introduce a `production_revisions` or correction task model in a future approved backend sprint.

Clarification required: should production revisions be versioned, or should correction records link to the original production record?

## 12. QC Relationship

QC validates production.

QC should answer:

- Is the claimed quantity accepted?
- Is evidence sufficient?
- Are photos/documents acceptable?
- Is location correct?
- Does customer/prime accept it?
- Are corrections needed?

Recommended QC actions:

- start review
- approve production
- reject production
- request correction
- mark corrected
- approve correction

Current backend behavior:

- QC queue exists.
- `qc-review`, `accept`, `reject`, `approve`, and `clear-correction` actions exist.
- Current flow has both `accepted` and `approved`, with `approved_quantity` limited to accepted quantity.

Recommendation: Production Backend Foundation should support basic production review status and quantities. Full QC evidence workflow, inspector packages, customer acceptance packages, and richer QC assignment should be deferred to a dedicated QC Backend Hardening sprint.

Clarification required: should the future status model keep `accepted` as a separate state, or collapse acceptance into `approved`?

## 13. Billable Relationship

Production becomes billable only after approval.

Rules:

- Claimed quantity does not become billable.
- Approved quantity may become billable candidate.
- Billable quantity should be set only after billable review.
- Work Order billable state may be updated later from approved/billable production.
- Settlement creation must be deferred.
- Production approval should not create settlement.
- Billable mark should not create invoice.

Current backend behavior:

- Production can be marked billable only after approval.
- Mark billable requires active evidence and active rate code matching unit.
- Settlement item creation later can reference billable production.

Clarification required: should billable quantity be set during production approval or only during later billing review?

## 14. Settlement / Finance Boundary

Production must not create:

- settlement
- settlement item
- invoice
- AR
- payment
- cash receipt
- payroll

Production may expose:

- claimed quantity
- approved quantity
- billable candidate quantity
- Work Order billable status
- documentation completeness
- evidence readiness

Finance happens later.

## 15. Permissions / Roles

Proposed future permissions:

- `production.read`
- `production.create`
- `production.update`
- `production.submit`
- `production.review`
- `production.approve`
- `production.reject`
- `production.request_correction`
- `production.mark_corrected`
- `production.void`
- `production.archive`
- `production_evidence.read`
- `production_evidence.create`
- `production_evidence.archive`
- `production.timeline.read`
- `production.audit.read`

Current permissions:

- `production_record.read`
- `production_record.create`
- `production_record.update`
- `production_record.submit`
- `production_record.correction_required`
- `production_record.archive`
- `qc.review`
- `qc.accept`
- `qc.reject`
- `qc.approve`
- `production.clear_correction`
- `production.mark_billable`
- `production_evidence.read`
- `production_evidence.create`
- `production_evidence.update`
- `production_evidence.archive`
- `stop_work.issue`
- `stop_work.release`

Role guidance:

- Foreman / Field User: create, submit, evidence create, read own/assigned production.
- Project Manager: read, review, request correction, approve if authorized.
- QC Reviewer: review, approve, reject, request correction.
- Operations Manager: approve, reject, void, archive.
- System Admin: administrative access.

Current authority checks:

- Correction required: Project Manager or Operations Manager.
- QC review: QC Manager or Project Manager.
- Accept: QC Manager.
- Reject: QC Manager or Project Manager.
- Approve: QC Manager or Operations Manager.
- Mark billable: Billing Manager or QC Manager.
- Stop-work issue: Safety Manager, QC Manager, or Executive.
- Stop-work release: Safety Manager or Executive.

Clarification required: confirm whether future naming should migrate from `production_record.*` to `production.*`, or preserve current permission namespace for compatibility.

## 16. Events and Audit Requirements

Proposed future events:

- `production.created`
- `production.updated`
- `production.submitted`
- `production.review_started`
- `production.approved`
- `production.rejected`
- `production.correction_requested`
- `production.corrected`
- `production.voided`
- `production.archived`
- `production_evidence.created`
- `production_evidence.archived`

Current event names:

- `production_record.created`
- `production_record.updated`
- `production_record.submitted`
- `production_record.qc_review_started`
- `production_record.accepted`
- `production_record.rejected`
- `production_record.approved`
- `production_record.billable`
- `production_record.correction_required`
- `production_record.correction_cleared`
- `production_record.stop_work_issued`
- `production_record.stop_work_released`
- `production_record.archived`
- `production_evidence.created`
- `production_evidence.updated`
- `production_evidence.archived`

Every write must create:

- event
- event payload
- audit log
- system action

Audit must capture:

- actor
- timestamp
- tenant
- production record id
- work order id
- project id
- production type
- status before/after
- claimed quantity
- approved quantity
- rejected quantity
- unit
- performer context
- evidence references
- correction links
- reason/note
- correlation id

Production must be highly auditable because it drives QC, billable, settlement, contractor performance, crew performance, productivity analytics, safety history, and compliance history.

## 17. Recommended Next Coding Sprint

Recommended next coding sprint: Production Backend Contract Foundation.

Build:

- production record schema hardening
- production type model
- field-truth quantity model while preserving existing quantity fields
- production evidence metadata hardening if safe
- create/list/detail endpoints with enriched Work Order, Project, performer, evidence, QC, and billable context
- submit/review/approve/reject/correction/void/archive routes
- production timeline endpoint
- production audit-summary endpoint
- production smoke test
- search hardening
- release validation wiring

Do not build:

- mobile Foreman UI
- Production Workspace UI
- file upload if storage path is not already safe
- full QC evidence workflow
- settlement, invoice, AR, payment, cash, or payroll automation
- AI review

Suggested first-sprint compatibility approach:

- Preserve current `production_records` and `production_evidence` objects.
- Harden existing routes instead of replacing them.
- Add fields only where missing.
- Preserve current event/audit/system_action write standards.
- Preserve existing permission names unless product approves a namespace migration.

## 18. Required Product Confirmations

Product must confirm:

1. Should production allow drafts, or only submitted records?
2. Should production require Work Order status `assigned`, `scheduled`, or `in_progress`?
3. Can production be entered against `corrections_required` Work Orders?
4. Can production be entered without a crew/provider assignment?
5. Should submitted production automatically move Work Order to `submitted`?
6. Should approved production automatically update Work Order `approved_quantity`?
7. Should completed/claimed production automatically update Work Order `completed_quantity`?
8. Should production approval automatically mark Work Order `approved`?
9. Should billable quantity be set during production approval or later billing review?
10. Should production evidence be required for completion, correction, inspection, and restoration submissions?
11. Should evidence upload be implemented now, or should the first sprint be metadata-only?
12. Should GPS be required or optional?
13. Should production revisions be versioned?
14. Should correction tasks be used, or should production revisions be added?
15. Who can approve production?
16. Who can reject production?
17. Who can void production?
18. Should production approval require QC Reviewer role, Project Manager role, Operations Manager role, or a combination?
19. Should production create billable candidates but not settlements?
20. Should production records be immutable after approval?
21. Should future permissions use `production.*` or preserve existing `production_record.*`?
22. Should current `accepted` status remain separate from `approved`?
23. Should first accepted production automatically set Project status to `active`?
24. Should production type `delay_report`, `no_work_report`, and issue types require quantity `0`, no quantity, or optional quantity?

Recommended answers:

- Support draft and submitted production if safe.
- Require Work Order `assigned`, `scheduled`, or `in_progress` for normal production.
- Allow `corrections_required` only for correction submissions.
- Require assignment unless administrative override is explicitly approved.
- Do not create settlement, invoice, payment, AR, cash, or payroll records.
- Evidence metadata first if file upload is not already safe.
- Approved production should update Work Order quantity rollups only through audited backend logic if product approves rollups.
- Preserve existing permission namespace in the first hardening sprint unless a migration is explicitly approved.
- Do not automatically start Project from production in the first hardening sprint.

## 19. GO / NO-GO Recommendation

GO for Production Backend Contract Foundation.

NO-GO for Production Workspace UI, Foreman UI, expanded QC UI, billing automation, settlement automation, invoice automation, payment automation, payroll, or AI review until Production backend rules are hardened and validated.

The existing Production backend is a working operational primitive, but it is not yet backend-truthful enough to serve as the field-truth layer for the approved execution chain. The next sprint should harden Production before any field-facing experience is built.
