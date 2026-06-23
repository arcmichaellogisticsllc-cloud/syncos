# Contractor Payable Backend Contract Foundation

## Approved Architecture

Production -> QC -> Billable -> Settlement -> Contractor Payable -> Payment / Payroll later

Contractor Payable is the money-out commitment layer. It converts payable-ready settlement item source values into approved payable obligations. It stops at payment readiness.

Contractor Payable must not create payment records, payroll records, ACH/card payouts, bank transactions, bank reconciliation records, tax filings, accounting exports, contractor portal transactions, vendor portal transactions, or cash movement.

## Objects

### contractor_payables

Stores the payable header, payable party, pay cycle, approval state, payment-readiness state, totals, compliance/tax readiness, holds, disputes, archive/void metadata, and audit fields.

Key statuses:

- `status`: `draft`, `assembling`, `ready_for_review`, `under_review`, `approved`, `rejected`, `held`, `disputed`, `payment_ready`, `payment_created_later`, `partially_paid_later`, `paid_later`, `voided`, `archived`
- `approval_status`: `not_submitted`, `pending`, `approved`, `rejected`, `withdrawn`
- `payment_readiness_status`: `not_ready`, `ready_with_warning`, `ready_for_payment`, `blocked`
- `payment_status`: `not_paid`, `partially_paid_later`, `paid_later`, `held`, `disputed`

### contractor_payable_items

Stores payable lines consumed from payable-ready settlement items. Items preserve settlement, billable, QC, production, work order, project, provider, and crew traceability.

Active payable totals exclude `voided` and `archived` items.

## API Routes

- `GET /contractor-payables`
- `GET /contractor-payables/:id`
- `GET /contractor-payables/:id/detail`
- `POST /contractor-payables`
- `PATCH /contractor-payables/:id`
- `POST /contractor-payables/:id/items`
- `PATCH /contractor-payable-items/:id`
- `POST /contractor-payable-items/:id/void`
- `POST /contractor-payable-items/:id/archive`
- `POST /contractor-payables/:id/recalculate-totals`
- `POST /contractor-payables/:id/submit-review`
- `POST /contractor-payables/:id/start-review`
- `POST /contractor-payables/:id/approve`
- `POST /contractor-payables/:id/reject`
- `POST /contractor-payables/:id/mark-payment-ready`
- `POST /contractor-payables/:id/place-hold`
- `POST /contractor-payables/:id/release-hold`
- `POST /contractor-payables/:id/dispute`
- `POST /contractor-payables/:id/resolve-dispute`
- `POST /contractor-payables/:id/void`
- `POST /contractor-payables/:id/archive`
- `GET /contractor-payables/:id/items`
- `GET /contractor-payable-items/:id`
- `GET /contractor-payable-items/:id/detail`
- `GET /contractor-payables/:id/timeline`
- `GET /contractor-payables/:id/audit-summary`

## Settlement Item Consumption

Payable items consume `settlement_items` only when the settlement item or parent settlement is `payable_ready`, unless an override reason is supplied.

Rules:

- Contractor payable items preserve `settlement_id` and `settlement_item_id`.
- Duplicate active payable items for one settlement item are blocked unless an override reason is supplied.
- Customer-billable-only settlement items are rejected unless an adjustment override is supplied.
- Quantity cannot exceed the settlement item quantity unless an override reason is supplied.
- Payable party must match the source provider/crew where available unless an override reason is supplied.

## Totals

Totals are backend-calculated from active payable items:

`net_payable_amount = gross_payable_amount - deduction_amount - chargeback_amount - retainage_amount`

## Lifecycles

Approval lifecycle:

`draft/assembling/rejected -> ready_for_review -> under_review -> approved/rejected`

Payment-readiness lifecycle:

`approved -> payment_ready`

Payment readiness is not payment. `mark-payment-ready` does not create payment, payroll, ACH/card, bank, tax, accounting, portal, or cash movement records.

## Permissions

Contractor payable permissions:

- `contractor_payable.read`
- `contractor_payable.create`
- `contractor_payable.update`
- `contractor_payable.add_item`
- `contractor_payable.remove_item`
- `contractor_payable.recalculate_totals`
- `contractor_payable.submit_review`
- `contractor_payable.start_review`
- `contractor_payable.approve`
- `contractor_payable.reject`
- `contractor_payable.mark_payment_ready`
- `contractor_payable.place_hold`
- `contractor_payable.release_hold`
- `contractor_payable.dispute`
- `contractor_payable.resolve_dispute`
- `contractor_payable.void`
- `contractor_payable.archive`
- `contractor_payable.timeline.read`
- `contractor_payable.audit.read`

Contractor payable item permissions:

- `contractor_payable_item.read`
- `contractor_payable_item.create`
- `contractor_payable_item.update`
- `contractor_payable_item.void`
- `contractor_payable_item.archive`

## Events

Every write uses the write-action helper and creates event, audit log, and system action records.

Contractor payable events:

- `contractor_payable.created`
- `contractor_payable.updated`
- `contractor_payable.item_added`
- `contractor_payable.item_removed`
- `contractor_payable.totals_recalculated`
- `contractor_payable.review_submitted`
- `contractor_payable.review_started`
- `contractor_payable.approved`
- `contractor_payable.rejected`
- `contractor_payable.payment_ready`
- `contractor_payable.held`
- `contractor_payable.hold_released`
- `contractor_payable.disputed`
- `contractor_payable.dispute_resolved`
- `contractor_payable.voided`
- `contractor_payable.archived`

Contractor payable item events:

- `contractor_payable_item.created`
- `contractor_payable_item.updated`
- `contractor_payable_item.voided`
- `contractor_payable_item.archived`

## Validation

Smoke command:

`npm run contractor-payable:smoke`

Release validation includes contractor payable smoke after collections smoke.
