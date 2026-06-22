# Billable Rules Clarification

Current validated commit: `bcbbd4150e5a41ff0eae8a377976d57637285ec0`

This is a rules clarification document only. It does not create backend objects, migrations, routes, UI, settlement records, invoices, payments, payroll, AR, or cash records.

## 1. Current Backend Inventory

Inventory classification:

| Area | Current state | Classification |
| --- | --- | --- |
| `production_records` billable fields | Production records include `billable_status`, `billable_quantity`, approved/rejected quantity fields, and a `POST /production-records/:id/mark-billable` action. The action updates production state only and uses write-action audit/event behavior. | Partially supported |
| `qc_reviews` billable candidate fields | QC reviews include `billable_candidate_quantity`, customer/prime acceptance fields, and approved/rejected/correction quantities. QC approval synchronizes production summary fields and creates no finance records. | Partially supported |
| `work_orders` billable fields | Work orders expose billable status/quantity summaries and `POST /work-orders/:id/mark-billable`. The action does not create production, settlement, invoice, payment, AR, cash, or payroll records. | Partially supported |
| Project financial readiness | Projects expose financial readiness fields and project detail context, but project-level billable rollups are not a first-class Billable model. | Partially supported |
| Contracts | `contracts` routes and permissions exist with tenant-scoped CRUD/archive and retainage percent support. | Supported |
| Rate schedules | `rate_schedules` routes and permissions exist with tenant-scoped CRUD/archive. | Supported |
| Rate codes | `rate_codes` routes and permissions exist, including customer/contractor rate fields. | Supported |
| Settlements | `settlements` and `settlement_items` routes exist. Settlement items currently consume billable production records, which means settlement is present but eligibility is still coupled to production status. | Partially supported |
| Invoices | Invoice routes exist and require approved settlement context. Invoice submission creates AR records through the cash controller. | Supported |
| Payments | Payment routes exist and apply payments against invoice/settlement context. | Supported |
| AR | AR read/archive support exists, and AR records are created from invoice submission. | Supported |
| Retainage tables/routes | Contracts and settlements have retainage fields. A dedicated retainage ledger/table was not found in the inspected routes/migrations. | Partially supported |
| Customer payment stats | Payment and AR data exist, plus finance/reporting routes. A dedicated customer payment statistics model was not identified. | Partially supported |
| Billing package logic | Reports include billing completeness checks for billable production, missing rate codes, settlement links, and invoice links. No dedicated billing package object was identified. | Partially supported |
| Finance permissions | `settlement.*`, `settlement_item.*`, `invoice.*`, `payment.*`, and `ar.*` permissions exist. | Supported |
| Production/QC permissions | `production.mark_billable`, `work_order.mark_billable`, and `qc_review.*` permissions exist. | Supported |
| Billable item permissions | No `billable_item.*` permissions were found. | Missing |
| Events | Production/work order billable events and finance events exist. No `billable_item.*` events were found. | Missing |
| Audit behavior | Existing write routes use the write-action helper pattern for event/audit/system action. A Billable object does not exist yet. | Partially supported |
| Search support | Search includes production records, work orders, projects, QC reviews, settlements, invoices, and payments. No `billable_item` search exists. | Partially supported |
| Smoke tests | Production, Work Order, QC, settlement, invoice/payment, and release smoke tests exist. No dedicated `billable:smoke` was identified. | Missing |

Object model options:

- Option A, fields/status only on production records and work orders: partially present today, but weak as a long-term financial eligibility gate.
- Option B, first-class `billable_items`: not implemented, but best matches the need for audit, holds, split quantities, rate readiness, customer acceptance, billing package readiness, and settlement preparation.
- Option C, settlement items only: settlement items exist, but this mixes eligibility with financial commitment and is too late in the workflow.
- Option D, hybrid model: production/work order summaries plus first-class `billable_items`. This matches the recently approved QC hybrid pattern and is the recommended path.

## 2. Billable Definition

Billable is a controlled financial eligibility layer that converts accepted field work into billable candidates before settlement or invoicing.

Billable represents:

- accepted production eligible for billing
- billable quantity
- unit
- rate code or rate basis
- billable amount estimate
- customer/prime acceptance state
- billing package readiness
- documentation readiness
- retainage treatment if applicable
- settlement readiness
- invoice readiness
- exceptions, holds, disputes, and overrides

Billable does not represent:

- settlement
- invoice
- AR
- payment
- cash receipt
- payroll
- tax accounting
- final customer payment

Core principle:

`Production claimed quantity -> QC approved quantity -> Billable quantity -> Settlement item -> Invoice item -> AR -> Cash`

Never:

`Production claimed quantity -> Invoice`

## 3. Billable Relationship To QC

QC creates billable candidates. Billable consumes approved QC review output, including:

- approved quantity
- rejected quantity
- correction-required quantity
- billable candidate quantity
- customer acceptance status
- prime acceptance status
- evidence/documentation status

Rules:

- Only QC-approved quantity can become billable.
- Billable quantity cannot exceed approved QC quantity unless an explicit executive/admin override is later approved.
- Rejected quantity cannot become billable.
- Correction-required quantity cannot become billable until correction is approved.
- Voided or archived QC cannot become billable.
- Billable candidate quantity does not create settlement, invoice, AR, payment, cash, or payroll.

## 4. Billable Relationship To Production

Production provides:

- production record
- production date
- production type
- work order
- project
- provider/crew
- claimed quantity
- evidence metadata
- location
- field notes

Billable must preserve traceability to:

- `production_record_id`
- `qc_review_id`
- `work_order_id`
- `project_id`
- `capacity_provider_id` and/or `crew_id` where available

Recommended first implementation rule:

- Do not create a billable item from production without approved QC.
- Do not allow an admin override around QC approval in the first Billable backend sprint.

## 5. Billable Relationship To Work Orders

Work Orders should surface billable summaries:

- billable candidate quantity
- billable quantity
- billable amount estimate
- billable status
- open billable exceptions
- settlement readiness
- billing package readiness

Rules:

- Work Order billable summaries should derive from Billable items through audited backend logic.
- Work Order status may become `billable` only after approved QC quantity exists and a Billable item is created or marked ready under approved rules.
- Work Order billable status must not create settlement automatically.

Ambiguity requiring confirmation:

- Whether Work Order billable status should update automatically from Billable items or only through explicit operator action.

## 6. Billable Relationship To Project

Project should surface financial progress, not own detailed billable records.

Project billable summary may include:

- total approved quantity by unit
- total billable quantity by unit
- estimated billable amount
- billable item count
- held billable item count
- ready-for-settlement count
- billing package gaps
- retainage exposure

Project must not directly create invoices.

## 7. Billable Quantity Model

Fields:

- approved_quantity
- billable_quantity
- held_quantity
- rejected_quantity
- correction_quantity
- unit

Rules:

- `billable_quantity <= approved_quantity`.
- `held_quantity = approved_quantity - billable_quantity` when applicable.
- Billable quantity uses the approved unit unless a future unit conversion model is approved.
- Partial billable quantity is allowed.
- Billable items may need splitting for partial billing, retainage, holds, or disputes.
- Billable quantity cannot be negative.
- Every quantity change must be auditable.

Example:

- QC approved: `1,000 feet`
- Billable: `900 feet`
- Held: `100 feet`
- Hold reason: documentation missing, retainage, customer hold, or dispute

## 8. Rate / Pricing Relationship

Billable needs pricing context but should not introduce a pricing engine.

Possible rate sources:

- contract rate schedule
- customer rate code
- prime rate code
- project rate schedule
- manually entered rate with approval
- future pricing engine

Required Billable pricing fields:

- `rate_code_id` nullable
- `rate_description` nullable
- `unit_rate` nullable
- `rate_source`
- `rate_confidence`
- `estimated_billable_amount`

Rate source statuses:

- `contract_rate`
- `project_rate`
- `customer_rate`
- `manual_rate`
- `unknown`

Rules:

- Billable item may be created with unknown rate.
- Billable item cannot be ready for settlement unless rate is known or override is supplied.
- Manual rate requires approval and audit.
- Rate mismatch creates warning or blocker depending approved policy.
- No pricing engine should be built in the Billable backend foundation.

## 9. Customer Acceptance Relationship

Acceptance statuses:

- `not_required`
- `pending`
- `accepted`
- `rejected`
- `correction_required`
- `disputed`

Rules:

- Internal QC approval may be enough to create an internal billable candidate.
- Customer/prime acceptance may be required before ready-for-settlement or invoice.
- If customer acceptance is required and pending, a Billable item may exist but settlement readiness should be pending or blocked depending policy.

Recommended rule:

- Billable item creation may occur before customer acceptance.
- Settlement/invoice should require customer/prime acceptance when contract or customer policy requires it.

## 10. Billing Package Relationship

Billing package may require:

- production record
- QC approval
- photos
- as-builts
- OTDR/test results
- restoration photos
- inspection approvals
- permit closeout
- customer signature
- inspector signature
- daily report
- redline map
- work order number
- customer PO/NTP
- rate code
- crew/provider info

Billing package statuses:

- `not_started`
- `incomplete`
- `ready`
- `submitted_later`
- `accepted_later`
- `rejected_later`

Rules:

- Billable item can exist with incomplete billing package.
- Ready-for-settlement should require billing package ready unless override is supplied.
- Billing package completeness must be auditable.
- Do not generate PDF packages in the Billable backend foundation.

## 11. Retainage Relationship

Retainage examples:

- percentage hold, such as 5% or 10%
- fixed hold amount
- customer-specific retainage
- release after acceptance or closeout

Billable fields may include:

- `retainage_required`
- `retainage_percent`
- `retainage_amount`
- `retainage_release_condition`
- `net_billable_amount`

Rules:

- Retainage does not eliminate billable quantity.
- Retainage affects amount timing and payable timing.
- Retainage should be visible before settlement.
- Do not implement retainage ledger until a finance sprint approves it.

Recommendation:

- Billable should expose retainage estimate.
- Settlement should create the formal retainage ledger if a retainage ledger is approved later.

## 12. Contractor Payable Relationship

Customer billable and contractor payable are related but not identical.

Examples:

- customer pays 950 feet
- contractor paid 900 feet due correction, chargeback, or dispute
- retainage applies
- backcharge applies
- rate split applies
- margin held separately

Billable should preserve:

- production provider/crew
- capacity provider
- work order assignment
- approved quantity
- billable quantity

Rules:

- Do not create contractor settlement from Billable unless explicitly approved in a later Settlement sprint.
- Contractor payable should consume Billable and settlement context later; Billable should not become payroll.

## 13. Settlement / Invoice / AR / Cash Boundary

Billable must not create:

- settlement
- settlement item
- invoice
- invoice item
- AR record
- payment
- cash receipt
- payroll

Billable may expose:

- approved quantity
- billable quantity
- held quantity
- rate/rate-code readiness
- estimated billable amount
- customer/prime acceptance status
- billing package readiness
- retainage estimate
- settlement readiness

Settlement remains the first financial commitment layer. Invoice, AR, payment, and cash remain downstream.

## 14. Permissions / Roles

Proposed permissions:

- `billable_item.read`
- `billable_item.create`
- `billable_item.update`
- `billable_item.recalculate_readiness`
- `billable_item.mark_ready`
- `billable_item.place_hold`
- `billable_item.release_hold`
- `billable_item.dispute`
- `billable_item.resolve_dispute`
- `billable_item.void`
- `billable_item.archive`
- `billable_item.timeline.read`
- `billable_item.audit.read`

Role guidance:

- Project Manager: read and update documentation readiness.
- Billing Admin: create, update, mark ready, hold/release, dispute.
- Operations Manager: override and hold authority.
- Executive/System Admin: high-authority overrides.

Current permission gap:

- `billable_item.*` permissions do not exist today.

## 15. Events and Audit Requirements

Proposed events:

- `billable_item.created`
- `billable_item.updated`
- `billable_item.readiness_recalculated`
- `billable_item.ready_for_settlement`
- `billable_item.held`
- `billable_item.hold_released`
- `billable_item.disputed`
- `billable_item.dispute_resolved`
- `billable_item.voided`
- `billable_item.archived`

Every Billable write must create:

- event
- event payload
- audit log
- system action

Audit must capture:

- actor
- timestamp
- tenant
- billable item id
- QC review id
- production record id
- work order id
- project id
- approved quantity
- billable quantity
- held quantity
- unit
- rate/rate code
- estimated amount
- customer/prime acceptance status
- billing package status
- retainage values
- hold/dispute reasons
- status before/after
- override reasons
- correlation id

## 16. Recommended Next Coding Sprint

Recommended next sprint: Billable Backend Contract Foundation.

Build:

- first-class `billable_items`
- list/detail endpoints
- create candidate from approved QC review
- readiness calculation
- mark ready for settlement
- hold/release/dispute/void/archive
- timeline/audit endpoints
- search
- `billable:smoke`
- release validation wiring

Do not build:

- settlement creation
- invoice creation
- payment, AR, or cash automation
- payroll
- PDF billing packages
- customer portal
- billing UI

## 17. Required Confirmations

Product confirmations required before coding:

1. Should Billable be a first-class `billable_items` object?
2. Should production and work order retain billable summary fields?
3. Should billable candidate creation require approved QC review?
4. Should billable quantity ever exceed approved quantity?
5. Should billable item creation be automatic on QC approval or manual?
6. Should customer/prime acceptance be required before billable item creation or before ready-for-settlement?
7. Should billing package readiness be required before ready-for-settlement?
8. Should rate/rate code be required before ready-for-settlement?
9. Should manual rate require approval?
10. Should retainage be estimated at Billable layer but ledgered at Settlement layer?
11. Should Work Order billable status update automatically from Billable items?
12. Should partial billable splits be supported now or later?
13. Should disputes block ready-for-settlement?
14. Who can mark Billable items ready for settlement?
15. Who can hold, release, dispute, resolve dispute, or void Billable items?
16. Should Billable ready-for-settlement ever create settlement automatically?
17. Should Billable items be immutable once `settlement_created`?
18. Should rate schedule integration be required in the first Billable backend sprint?

Recommended answers:

- Yes, create first-class `billable_items`.
- Keep summary fields on production and work orders.
- Require approved QC.
- Do not allow billable quantity to exceed approved quantity in first implementation.
- Start with manual Billable candidate creation; automate later only if approved.
- Customer/prime acceptance should be required before settlement/invoice when applicable, not necessarily before Billable item creation.
- Require billing package readiness before ready-for-settlement unless override is supplied.
- Require known rate or approved override before ready-for-settlement.
- Manual rate requires approval.
- Estimate retainage at Billable; ledger retainage at Settlement later.
- Do not create settlement automatically from Billable.

## 18. GO / NO-GO Recommendation

Recommendation: GO for a Billable Backend Contract Foundation only after product confirms the required questions above.

Implementation posture:

- Use a first-class `billable_items` object.
- Preserve production and work order summary fields.
- Require approved QC before Billable candidate creation.
- Keep settlement, invoice, AR, payment, cash, and payroll fully downstream.
- Enforce tenant scoping, permissions, event creation, audit logging, and system_action creation on every write.

NO-GO for:

- Billable UI
- settlement automation
- invoice automation
- AR/payment/cash automation
- payroll
- pricing engine
- customer portal
