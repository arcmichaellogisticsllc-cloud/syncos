# QC Rules Clarification

Current validated commit: `c882e859a7159e165c45092eacd4420e355d24d4`

Purpose: define the QC layer before building QC backend, QC workspace, Production Workspace UI, billable workflows, settlement logic, or invoice logic.

Approved execution chain:

Project -> Work Order -> Production -> QC -> Billable -> Settlement -> Cash

Production answers: "What actually happened in the field?"

QC answers: "Is the claimed production accepted, rejected, corrected, or billable candidate?"

QC is the quality and financial truth gate. Downstream settlement must eventually depend on approved QC quantity, not raw claimed production quantity.

This sprint is documentation-only. No application files, migrations, routes, UI, or backend objects are created here.

## 1. Current Backend Inventory

Files inspected:

- `packages/database/migrations/009_projects_work_orders_production.sql`
- `packages/database/migrations/028_work_order_contract_hardening.sql`
- `packages/database/migrations/029_production_contract_hardening.sql`
- `packages/database/migrations/010_contracts_rates_settlements_invoices_payments.sql`
- `packages/database/migrations/012_events_actions_approvals_audit.sql`
- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/settlements.controller.ts`
- `apps/api/src/routes/search.controller.ts`
- `packages/permissions/src/index.ts`
- `packages/database/scripts/seed.js`
- `apps/api/scripts/production-smoke.js`
- `apps/api/scripts/work-order-smoke.js`
- `apps/api/scripts/sprint5-smoke.js`
- `apps/api/scripts/sprint6-smoke.js`
- `apps/api/scripts/sprint7-smoke.js`
- `docs/product/production-backend-contract.md`
- `docs/product/work-order-backend-contract.md`
- `docs/product/production-rules-clarification.md`

Inventory classification:

| Area | Classification | Notes |
|---|---:|---|
| `production_records` table | Supported | Hardened by migration `029`; includes production type, status, `qc_status`, `billable_status`, claimed/approved/rejected/corrected/billable quantities, correction fields, reviewer timestamps, revision fields, and archive fields. |
| Production approval/rejection/correction routes | Partially supported | Existing routes act directly on `production_records`: start review, approve, reject, request correction, mark corrected, mark billable, void, archive. They provide core QC behavior but not durable multi-review history. |
| Production evidence table/routes | Supported for metadata | `production_evidence` exists and is metadata-only. It supports create, update, archive. It can support short-term QC evidence reuse, but it is production-scoped rather than QC-review-scoped. |
| Current QC status fields | Partially supported | `production_records.qc_status` supports `not_started`, `pending_review`, `corrections_required`, `approved`, `rejected`. Work Orders also carry QC summary status. No `in_review`, `corrected`, or first-class review status history exists. |
| Correction task tables/routes | Missing | Correction is currently represented on `production_records` and Work Order status/notes. No dedicated correction task object was found. |
| Work Orders table/routes/statuses | Supported | Hardened Work Orders include lifecycle status, QC status, billable status, quantity rollups, readiness, assignment, timeline, audit, and lifecycle routes. Routes are currently implemented in `production.controller.ts`. |
| Projects table/routes/statuses | Supported | Project lifecycle and readiness routes exist in `production.controller.ts`. Project status is not automatically changed by QC. |
| Constraints/correction workflows | Partially supported | Generic constraints exist elsewhere, but QC correction is not modeled as a workflow task or constraint by default. |
| Billable status fields | Supported | Production and Work Order both carry billable status/quantity fields. Production approval can create a billable candidate; mark-billable is a separate route. |
| Settlement/invoice/payment tables | Supported but downstream | Settlement/invoice/payment/AR tables exist. Settlement items require billable production. QC/production actions must not create finance records. |
| Production permissions | Supported | Both newer `production.*` and compatibility `production_record.*` permissions exist. |
| QC-related permissions | Partially supported | Existing permissions include `qc.review`, `qc.accept`, `qc.approve`, `qc.reject`, and production review permissions. No `qc_review.*` permission family exists. |
| Events | Partially supported | Production events exist for created, updated, submitted, review started, approved, rejected, correction requested, corrected, marked billable, voided, archived, and evidence events. No `qc_review.*` events exist. |
| Audit behavior | Supported for current writes | Production writes use the existing write-action helper and create event/audit/system_action records. No review-history object exists beyond audit/event trail. |
| Search support | Supported for production | Global search includes production records. QC reviews are not searchable because no QC review object exists. |
| Smoke tests | Supported for current production foundation | `production:smoke` validates current production review, approval, rejection, correction, evidence, timeline, audit, search, and no-finance boundaries. |

Special focus conclusion:

Current QC is implemented as **Option A: QC actions directly on `production_records`** with summary fields and event/audit history. This is sufficient for basic production approval, rejection, correction, billable candidate marking, and rollups. It is not sufficient for long-term QC as a quality and financial truth gate because it lacks durable review rounds, separate internal/customer/prime acceptance, independent reviewer assignment, QC-specific evidence, and a searchable review object.

Recommendation: use **Option C: Hybrid model** in the next coding sprint, pending product confirmation. Keep summary fields on `production_records`, but add first-class `qc_reviews` to store every review decision.

## 2. QC Definition

QC is a controlled review process that validates production claimed against Work Order requirements, evidence, location, quantity, customer requirements, and documentation standards.

QC should determine:

- accepted quantity
- rejected quantity
- correction requirement
- evidence sufficiency
- location validity
- documentation sufficiency
- customer/prime acceptance status
- billable eligibility

QC should not represent:

- original field production
- invoice
- settlement
- payment
- payroll
- general project management note
- crew timesheet

## 3. QC Relationship To Production

Every QC review must relate to one Production Record.

Production provides:

- claimed quantity
- unit
- production type
- Work Order
- Project
- provider/crew
- submitted evidence
- location/timestamps
- field notes

QC produces:

- approved quantity
- rejected quantity
- correction required quantity
- QC status
- reviewer decision
- review notes
- evidence/documentation findings
- billable candidate flag

Important principle:

- Production claim does not equal approved quantity.
- Approved quantity does not equal billable quantity.
- Billable candidate does not equal settlement.

Current backend state:

- `production_records` stores summary QC values directly.
- Production approval updates `status = approved`, `qc_status = approved`, `billable_status = billable_candidate`, `approved_quantity`, `rejected_quantity`, `approved_by`, and `approved_at`.
- Production rejection updates rejection fields and `qc_status = rejected`.
- Correction request updates correction fields and `qc_status = corrections_required`.

Gap:

- The system cannot yet store multiple QC decisions for the same Production Record except through event/audit history.

## 4. QC Relationship To Work Orders

QC results should update Work Order summaries only through audited backend logic.

Work Order should surface:

- completed quantity
- approved quantity
- rejected quantity
- billable candidate quantity
- QC status summary
- corrections required count
- open correction count
- approved production count
- rejected production count

Rules:

- Work Order approved quantity should derive from approved production/QC.
- Work Order billable quantity should derive from billable candidate or billable-approved records later.
- QC approval may move Work Order status to approved only when all required production for the Work Order is approved or explicitly approved as complete.
- QC correction may move Work Order to corrections_required.
- QC rejection may keep Work Order in qc_review or corrections_required depending policy.

Current backend state:

- Work Order quantity rollups are recalculated from production records.
- Work Order QC lifecycle routes exist, including start QC review, request corrections, approve, and mark billable.
- Work Order mark-billable does not create finance records.

Recommended rule:

QC backend should update quantity rollups but should not automatically close Work Orders or create financial records.

Ambiguity:

- Whether Production QC approval should automatically move Work Order status to approved is not confirmed.

## 5. QC Relationship To Projects

Project should surface QC progress but not store detailed QC decisions.

Project-level QC summaries may include:

- total production records submitted
- total under review
- total approved
- total rejected
- total corrections required
- approved quantity by unit/work type
- billable candidate quantity
- QC blockers

Rules:

- Project status should not automatically change because one QC record is approved.
- Project closeout may later require all required QC complete, but that rule is not confirmed in this sprint.

Current backend state:

- Projects have lifecycle and readiness routes.
- Project status is not automatically changed by production approval.

## 6. QC Reviewer / Authority Model

Current observed authority model:

- Start review requires QC Manager or Project Manager authority.
- Correction request requires Project Manager or Operations Manager authority.
- Approval requires QC Manager or Operations Manager authority.
- Mark billable requires Billing Manager or QC Manager authority.
- Stop-work actions have separate Safety/QC/Executive authority rules.

Role guidance:

- Field / Foreman: cannot approve their own production unless explicit override; can respond to corrections; can submit correction evidence.
- Project Manager: can review and request corrections; may approve low-risk production if authorized.
- QC Reviewer: primary approval authority.
- Operations Manager: can approve, reject, override, void.
- Compliance / Safety Reviewer: can approve/reject compliance/safety QC items.
- Executive / System Admin: administrative authority.

Recommended rule:

Default to no self-approval for production submitted by the same user unless admin override is explicitly supplied and audited.

Ambiguity:

- Self-approval is not currently confirmed as blocked.
- Exact role-to-permission seeding for a future `qc_review.*` object is not confirmed.

## 7. QC Evidence Model

QC evidence is not the same as production evidence.

Production evidence proves field claim.

QC evidence supports review decision.

QC evidence types:

- inspection_photo
- correction_photo
- annotated_photo
- checklist
- customer_signature
- inspector_signature
- test_result
- punch_list
- rejection_note
- approval_note
- map_markup
- other

Options:

| Option | Description | Pros | Cons |
|---|---|---|---|
| A | Reuse `production_evidence` with evidence type | Fast, uses current metadata routes | Evidence is production-scoped, not review-scoped |
| B | Create `qc_evidence` table | Clear review-specific evidence | New object and routes |
| C | Use generic evidence object later | Scales across domains | Larger architecture decision |

Recommendation:

- Short term: reuse `production_evidence` if safe.
- Long term: consider `qc_evidence` or a generic evidence object when review-specific evidence, customer signatures, and annotated QC packages become first-class.

## 8. QC Status Model

Approved QC statuses:

- not_started
- pending_review
- in_review
- approved
- rejected
- correction_required
- corrected
- voided
- archived

Current production `qc_status` mapping:

| Proposed QC status | Current production mapping |
|---|---|
| not_started | `not_started` |
| pending_review | `pending_review` |
| in_review | `pending_review` plus `production_records.status = under_review` |
| approved | `approved` |
| rejected | `rejected` |
| correction_required | `corrections_required` |
| corrected | production status `corrected`; no separate `qc_status = corrected` |
| voided | production status `voided`; no separate `qc_status = voided` |
| archived | production status `archived`; no separate `qc_status = archived` |

Gap:

- The current `qc_status` enum is intentionally compact and does not represent every review lifecycle state.

## 9. Quantity Acceptance Model

QC must distinguish:

- claimed_quantity
- approved_quantity
- rejected_quantity
- correction_required_quantity
- corrected_quantity
- billable_candidate_quantity

Rules:

- Approved quantity cannot exceed claimed quantity unless admin override.
- Rejected quantity should equal claimed quantity minus approved quantity if the review is complete.
- Partial approval is allowed if product confirms it.
- Correction required quantity may be less than total rejected quantity.
- Corrected quantity must link to correction submission.
- Billable candidate quantity cannot exceed approved quantity unless override.
- Unit must match production/work order unless override.

Example:

Claimed 1,000 feet.

QC approved 800 feet.

Rejected 200 feet.

Correction required 150 feet.

Billable candidate 800 feet.

Current backend state:

- Production approval requires `approved_quantity`.
- Approved quantity is validated against claimed/accepted quantity.
- Rejected quantity is calculated from submitted/claimed quantity minus approved quantity where safe.
- Mark billable validates billable quantity against approved quantity.

Gap:

- `correction_required_quantity` and `billable_candidate_quantity` are not dedicated current fields.

## 10. Correction Model

Corrections should be traceable.

Correction can be represented by:

- correction task
- correction_required QC review
- correction_submission production record
- linked parent production record

Required correction fields:

- correction_reason
- correction_required_quantity
- correction_due_date
- correction_owner_user_id
- correction_note
- source_qc_review_id if available
- source_production_record_id

Rules:

- Correction does not overwrite original production.
- Correction submission links back to original production/QC.
- Correction approval updates final approved/corrected quantity through audited logic.
- Open corrections should block billable status unless overridden.

Current backend state:

- `production_records` has correction reason/note/due date/owner fields.
- `parent_production_record_id`, `revision_number`, and `is_latest_revision` exist.
- There is no `source_qc_review_id` because no QC review object exists.
- No correction task route/table was found.

Recommendation:

Use the hybrid model so correction requests are stored as QC review decisions and correction submissions remain production records linked to the original record and review.

## 11. Customer / Prime Acceptance Model

Internal QC and customer acceptance may be separate.

Internal QC asks: "Do we accept this production internally?"

Customer/Prime acceptance asks: "Will the customer/prime accept this production for billing?"

Customer/prime acceptance statuses:

- not_required
- pending
- accepted
- rejected
- correction_required

Recommendation:

Do not build full customer/prime acceptance in the next backend sprint unless explicitly approved. Design the QC model so `customer_qc` and `prime_qc` review types can be added without changing production history.

## 12. Billable Relationship

QC creates billable candidates.

Rules:

- Only approved QC quantity may become billable candidate.
- Correction-required quantity is not billable.
- Rejected quantity is not billable.
- Billable candidate does not create settlement.
- Billable candidate does not create invoice.
- Billable candidate does not create payment.

Future Billable layer should consume:

- approved production
- QC approval
- documentation completeness
- customer acceptance
- rate schedule
- billing package readiness

Current backend state:

- Production approval sets `billable_status = billable_candidate`.
- Production mark-billable is a separate route and creates no finance records.
- Settlement item creation requires production status and billable status to be billable.

## 13. Settlement / Finance Boundary

QC must not create:

- settlement
- settlement item
- invoice
- AR
- payment
- cash receipt
- payroll

QC may expose:

- approved quantity
- rejected quantity
- correction quantity
- billable candidate quantity
- customer acceptance status
- documentation status

Finance starts later.

Current backend state:

- Production smoke validates no finance records are created by production create, mark billable, or related production actions.
- Settlement logic is downstream and requires billable production before settlement items can be created.

## 14. Permissions / Roles

Current relevant permissions:

- `production.review`
- `production.approve`
- `production.reject`
- `production.request_correction`
- `production.mark_corrected`
- `production.mark_billable`
- `production.void`
- `production.timeline.read`
- `production.audit.read`
- `production_record.read`
- `production_record.create`
- `production_record.update`
- `production_record.submit`
- `production_record.correction_required`
- `production_record.archive`
- `production_evidence.read`
- `production_evidence.create`
- `production_evidence.update`
- `production_evidence.archive`
- `qc.review`
- `qc.accept`
- `qc.approve`
- `qc.reject`

Proposed future `qc_review.*` permissions if first-class QC is approved:

- `qc_review.read`
- `qc_review.create`
- `qc_review.update`
- `qc_review.start`
- `qc_review.approve`
- `qc_review.reject`
- `qc_review.request_correction`
- `qc_review.mark_corrected`
- `qc_review.void`
- `qc_review.archive`
- `qc_review.timeline.read`
- `qc_review.audit.read`

Recommendation:

If implementing separate `qc_reviews`, add `qc_review.*` permissions. If staying on production actions temporarily, preserve production/QC compatibility permissions.

## 15. Events and Audit Requirements

Current production events:

- `production.created`
- `production.updated`
- `production.submitted`
- `production.review_started`
- `production.approved`
- `production.rejected`
- `production.correction_requested`
- `production.corrected`
- `production.marked_billable`
- `production.voided`
- `production.archived`
- `production_evidence.created`
- `production_evidence.updated`
- `production_evidence.archived`

Proposed future QC review events:

- `qc_review.created`
- `qc_review.started`
- `qc_review.approved`
- `qc_review.rejected`
- `qc_review.correction_requested`
- `qc_review.corrected`
- `qc_review.voided`
- `qc_review.archived`

Audit must capture:

- reviewer
- timestamp
- production record
- Work Order
- Project
- claimed quantity
- approved quantity
- rejected quantity
- correction quantity
- billable candidate quantity
- evidence findings
- location findings
- documentation findings
- customer acceptance findings
- notes
- reasons
- override reasons
- status before/after
- correlation id

QC must be fully auditable because it becomes the basis for:

- billable quantity
- settlement eligibility
- contractor performance
- correction history
- dispute handling

## 16. Recommended Next Coding Sprint

Recommended next sprint: **QC Backend Contract Foundation**.

Recommended scope:

- Create `qc_reviews` table if product approves hybrid model.
- Add QC review list/detail endpoints.
- Add create/start/approve/reject/request-correction/mark-corrected/void/archive routes.
- Link QC review to production/work order/project.
- Update production summary fields through audited helper.
- Update Work Order QC summary and quantity rollups through audited logic where safe.
- Add timeline/audit endpoints.
- Add QC smoke test.
- Wire QC smoke into release validation.

Do not build:

- QC UI
- Production UI
- Foreman UI
- file upload
- settlement
- invoice
- payment
- payroll
- automated billing

Alternative:

If product does not approve separate `qc_reviews`, harden production review actions only.

Recommendation:

Use hybrid model.

## 17. Required Confirmations

Product confirmations required before coding:

1. Should QC become a first-class `qc_reviews` object?
2. Should Production keep summary QC fields while `qc_reviews` stores review history?
3. Should self-approval be blocked by default?
4. Who can approve production QC?
5. Who can reject production QC?
6. Who can void QC review?
7. Is partial approval allowed?
8. Can approved quantity exceed claimed quantity with override?
9. Should rejected quantity auto-calculate as claimed minus approved?
10. Should `correction_required_quantity` be separately tracked?
11. Should correction submissions link to original production and QC review?
12. Should customer/prime acceptance be modeled now or later?
13. Should QC evidence reuse `production_evidence` or use `qc_evidence`?
14. Should QC approval automatically mark production billable_candidate?
15. Should QC approval automatically update Work Order approved_quantity?
16. Should QC approval automatically move Work Order to approved?
17. Should QC rejection move Work Order to corrections_required?
18. Should billable candidate ever create settlement automatically?
19. Should QC be required before any billable status?
20. Should QC review records be immutable after approval/void?

Recommended answers:

- Yes, QC should become first-class.
- Use hybrid model.
- Block self-approval by default.
- Partial approval should be allowed.
- Rejected quantity should auto-calculate unless explicitly provided.
- Customer/prime acceptance should be later unless urgently needed.
- Reuse `production_evidence` short-term.
- QC approval can update summary quantities but cannot create finance records.
- Billable candidate must never create settlement automatically.

## 18. GO / NO-GO Recommendation

Recommendation: **GO for QC Backend Contract Foundation after confirmations**.

Reason:

- Production Backend Contract is now strong enough to support QC hardening.
- Existing direct production QC actions are useful but not sufficient for long-term quality and financial truth.
- Settlement already depends on billable production, so QC must become more explicit before Billable, Settlement, or Invoice expansion.

NO-GO for:

- QC Workspace UI before the QC backend contract is confirmed.
- Billable/Settlement automation based only on current direct production summary fields.
- Customer/prime acceptance workflow until product confirms whether it belongs in initial QC or a later billing/customer validation sprint.
