# QC Backend Contract

Validated sprint: QC Backend Contract Foundation

## Boundary

QC is the acceptance-truth layer after Production. Production remains the field-truth record. QC determines accepted, rejected, correction-required, and billable-candidate quantities.

QC must not create settlement, invoice, AR, payment, cash, payroll, or other finance records.

## Hybrid Model

Production records retain summary fields:

- `qc_status`
- `approved_quantity`
- `rejected_quantity`
- `billable_status`

QC review history is stored in `qc_reviews`. Review actions update the QC review and synchronize production summary fields through backend write-action handling, including event, audit log, and system action.

## qc_reviews

Core fields:

- `id`
- `tenant_id`
- `production_record_id`
- `work_order_id`
- `project_id`
- `review_type`
- `review_status`
- `reviewer_user_id`
- `reviewed_at`
- `claimed_quantity`
- `approved_quantity`
- `rejected_quantity`
- `correction_required_quantity`
- `billable_candidate_quantity`
- `unit`
- `evidence_status`
- `location_status`
- `documentation_status`
- `production_status`
- `customer_acceptance_status`
- `prime_acceptance_status`
- `review_notes`
- `rejection_reason`
- `rejection_note`
- `correction_reason`
- `correction_note`
- `correction_due_date`
- `correction_owner_user_id`
- `source_qc_review_id`
- `hard_stop`
- `override_reasons`
- archive and audit fields

Review types:

- `internal_qc`
- `safety_qc`
- `compliance_qc`
- `customer_qc`
- `prime_qc`
- `billing_qc`
- `final_acceptance`

Review statuses:

- `pending`
- `in_review`
- `approved`
- `rejected`
- `correction_required`
- `corrected`
- `voided`
- `archived`

## Routes

- `GET /qc-reviews`
- `GET /qc-reviews/:id`
- `GET /qc-reviews/:id/detail`
- `POST /qc-reviews`
- `POST /qc-reviews/:id/start-review`
- `POST /qc-reviews/:id/approve`
- `POST /qc-reviews/:id/reject`
- `POST /qc-reviews/:id/request-correction`
- `POST /qc-reviews/:id/mark-corrected`
- `POST /qc-reviews/:id/void`
- `POST /qc-reviews/:id/archive`
- `GET /qc-reviews/:id/timeline`
- `GET /qc-reviews/:id/audit-summary`

## Quantity Rules

- `approved_quantity <= claimed_quantity` unless `admin_override_reason` is supplied.
- `rejected_quantity` defaults to `claimed_quantity - approved_quantity`.
- `correction_required_quantity <= rejected_quantity`.
- `billable_candidate_quantity <= approved_quantity` unless `override_reason` is supplied.
- Billable candidate quantity does not create finance records.

## Self Approval

Reviewers cannot approve production they submitted unless they are System Admin or supply an explicit self/admin override reason.

## Synchronization

Approved QC review:

- sets production `status = approved`
- sets production `qc_status = approved`
- stores approved and rejected quantities
- sets production `billable_status = billable_candidate` only when a candidate quantity exists
- recalculates work order production rollups

Rejected QC review:

- sets production `status = rejected`
- sets production `qc_status = rejected`
- stores rejected quantity and rejection notes
- recalculates work order production rollups

Correction requested:

- sets production `status = correction_required`
- sets production `qc_status = corrections_required`
- stores correction fields

## Permissions

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

## Events

- `qc_review.created`
- `qc_review.started`
- `qc_review.approved`
- `qc_review.rejected`
- `qc_review.correction_requested`
- `qc_review.corrected`
- `qc_review.voided`
- `qc_review.archived`

All writes use the backend write-action helper so event payload, audit log, and system action behavior remains centralized.

## Search

Global search includes `qc_review` results using review notes, rejection reason, correction reason, production type, work order name/number, and project name. Search remains tenant-scoped.

## Deferred

- QC Workspace UI
- QC evidence object
- Customer/prime portal review
- Settlement, invoice, payment, AR, cash, and payroll creation
