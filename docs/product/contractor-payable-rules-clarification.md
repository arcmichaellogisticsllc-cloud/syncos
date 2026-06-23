# Contractor Payable Rules Clarification

Current validated commit: `4afe9378ae58996332cf9477bb51448bf9d591a8`

This is a rules clarification document only. It does not create backend objects, migrations, routes, UI, or application behavior.

The approved SyncOS revenue chain remains:

Billable -> Settlement -> Invoice -> Cash Receipt -> Payment Application -> Invoice Balance -> Collections

The payable chain to clarify is:

Production -> QC -> Billable -> Settlement -> Contractor Payable -> Payment / Payroll later

## 1. Current Backend Inventory

| Area | Current state | Classification |
| --- | --- | --- |
| `settlements` table | Exists and is hardened with settlement number, type, approval/review states, invoice readiness, payable readiness, totals, hold/dispute, void/archive, and tenant-scoped indexes. | Supported |
| Settlement routes | `GET/POST/PATCH /settlements`, detail, items, review, approve/reject, invoice-ready, payable-ready, hold/release, dispute/resolve, void/archive, timeline, and audit routes exist. | Supported |
| `settlement_items` table | Exists with source traceability to billable, QC, production, work order, project, customer, provider, and crew. Includes customer billable amount, contractor payable amount, contractor rate, retainage, deduction, chargeback, margin, `payable_item_id` future link, status, void/archive. | Supported |
| Contractor payable fields on settlement items | `contractor_payable_amount`, `contractor_rate`, `payable_item_id`, provider/crew traceability, deductions, chargebacks, and retainage exist. | Partially supported |
| `capacity_providers` routes/table | Table and routes exist for list, detail, create, update, qualify, verify, contract, activate, suspend, and archive. | Supported |
| `crews` routes/table | Table and read/create/update/archive routes exist. | Supported |
| `workers` routes/table | Table and read/create/update/archive routes exist. No payroll workflow was found. | Partially supported |
| `equipment` routes/table | Table and read/create/update/archive routes exist. | Supported |
| Compliance documents | `compliance_documents` table and read/create/update/verify/archive routes exist. | Supported |
| Contracts and rates | `contracts`, `rate_schedules`, and `rate_codes` tables/routes exist; rate codes include customer and contractor rates. | Supported |
| `billable_items` | Exists with production/QC/project/work order/customer/provider/crew/rate/retainage traceability and ready-for-settlement lifecycle. | Supported |
| `qc_reviews` | Exists with review status, accepted/rejected/correction lifecycle, timeline, and audit. | Supported |
| `production_records` | Exists with provider/crew/work order/project, production quantities, QC/billable states, evidence, correction, stop-work, archive/void lifecycle. | Supported |
| `work_orders` | Exists with assignment fields, provider/crew/equipment links, lifecycle, holds, and production rollups. | Supported |
| `projects` | Exists with lifecycle, holds, financial fields, timeline, and audit. | Supported |
| `cash_receipts` / `payment_applications` | First-class cash application objects exist and update invoice receivable state. They are customer cash-in objects, not contractor payable objects. | Supported, separate boundary |
| Legacy `payments` table/routes | Legacy payments table/routes exist and can create/reconcile/archive payment records. They are not approved as Contractor Payable output in this clarification. | Partially supported / unsafe to reuse |
| Payroll fields/routes | No first-class payroll run, payslip, payroll item, or payroll route found. Worker records exist but are not payroll. | Missing |
| Payable fields/routes | Settlement payable readiness exists. No `contractor_payables` or `contractor_payable_items` table/routes found. | Missing |
| Retainage fields/tables | Retainage fields exist on billable and settlement/settlement item records. No formal contractor retainage ledger found. | Partially supported |
| Chargeback/deduction fields | Settlement items support deduction and chargeback amounts. No first-class payable chargeback workflow found. | Partially supported |
| Tax/compliance fields | Compliance documents exist for provider readiness. Tax document readiness for payable parties is not first-class. | Partially supported |
| Reports controller | Compliance, billing-completeness, and constraints reports exist. No contractor payable aging/pay cycle report found. | Partially supported |
| Search support | Search includes capacity, contracts/rates, billable, settlements/items, invoices, cash receipts, payment applications, collections, legacy payments. No contractor payable search objects. | Partially supported |
| Permissions | Settlement, settlement item, capacity, crew, worker, equipment, compliance, cash, payment, invoice, and collection permissions exist. No `contractor_payable.*` or `contractor_payable_item.*` permissions found. | Missing |
| Events and audit | Existing write helpers create events/audit/system actions for current objects. No contractor payable event types exist. | Partially supported |
| Smoke tests | Existing smokes cover production, QC, billable, settlement, invoice, cash application, collections, and release validation. No contractor payable smoke command exists. | Missing |
| Related docs | Settlement, Billable, Production, QC, Cash Application, and Collections docs exist and establish the payable boundary as future. | Supported |

Special focus recommendation:

Use Option D: Hybrid. Settlement items should preserve payable source values, while first-class `contractor_payables` and `contractor_payable_items` become the payable approval and payment-readiness layer. Do not pay directly from settlement. Do not treat payroll as the same workflow as contractor payable.

## 2. Contractor Payable Definition

Contractor Payable is a controlled financial obligation layer that converts approved settlement payable commitments into auditable obligations owed to subcontractors, crews, vendors, or internal/self-perform entities before any payment or payroll action occurs.

Contractor Payable represents payable party, payable source, approved payable amount, pay cycle, payable status, approval state, deductions, chargebacks, retainage or holdback, dispute state, compliance readiness, tax document readiness, payment readiness, and audit trail.

Contractor Payable does not represent cash receipt, customer payment, payroll run, ACH payout, card payout, check payment, bank transaction, tax filing, accounting export, contractor portal payment, or legal action.

## 3. Core Contractor Payable Principle

Contractor Payable is money-out commitment. Settlement is financial commitment. Payment and Payroll are money movement.

The future chain should be:

Settlement Item -> Contractor Payable Item -> Contractor Payable -> Payment / Payroll later

Never:

- Cash Receipt -> Contractor Payment
- Collections -> Contractor Payment
- Production -> Payroll
- Contractor Payable -> Bank Transaction

Contractor Payable may prepare obligations, but it must not execute payment.

## 4. Relationship To Settlement

Contractor Payable consumes approved settlements and settlement items that are contractor payable and payable-ready.

It should consume:

- approved settlement
- settlement items with contractor payable amount
- settlement items marked `payable_ready`
- capacity provider and crew context
- production, QC, work order, project, and billable traceability
- contractor rate
- deductions
- chargebacks
- retainage or holdback
- pay cycle
- compliance readiness where available

Rules:

- Only approved or payable-ready settlement items should become contractor payable items unless an override is explicitly approved.
- Customer-billable-only settlement items should not become contractor payable items unless an internal adjustment workflow is approved.
- A settlement item cannot be converted into an active payable item twice unless split/adjustment rules are approved.
- Contractor Payable must preserve `settlement_id` and `settlement_item_id`.
- Contractor Payable must not mutate the source settlement item silently.
- Contractor Payable approval must not send payment.

## 5. Relationship To Settlement Items

Settlement items are the source traceability and amount source for contractor payable items.

Contractor payable items should preserve:

- `settlement_id`
- `settlement_item_id`
- `billable_item_id`
- `qc_review_id`
- `production_record_id`
- `work_order_id`
- `project_id`
- `capacity_provider_id`
- `crew_id`
- future `worker_id` if approved
- quantity
- unit
- contractor rate
- gross payable amount
- deduction amount
- chargeback amount
- retainage amount
- net payable amount

The future payable layer should not overwrite settlement source values without an audited adjustment/reversal model.

## 6. Relationship To Production / QC / Billable / Work Orders / Projects

Contractor Payable must preserve traceability to project, work order, production record, QC review, billable item, settlement, settlement item, capacity provider, crew, and future worker/equipment references where approved.

It should support reporting by provider, crew, project, work order, territory, work type, pay cycle, production period, settlement, and customer indirectly.

Contractor Payable must not directly change production quantity, QC approved quantity, billable quantity, settlement amount, invoice balance, or cash receipt balance except through future governed adjustment/reversal workflows.

## 7. Object Model Options

Option A: Fields only on settlement items.

Pros: simpler and fewer objects.

Cons: weak payable approval, weak pay cycle batching, poor deductions/holdback tracking, and weak audit before payment.

Option B: First-class `contractor_payables` and `contractor_payable_items`.

Pros: clear payable approval layer, pay cycles, provider/crew grouping, deductions/chargebacks/retainage, and separation of obligation from actual payment.

Cons: more objects.

Option C: Payroll-only later.

Pros: simple for W2 payroll.

Cons: does not support subcontractor payables and mixes payroll with contractor obligations.

Option D: Hybrid.

Settlement items keep payable source values. `contractor_payables` and `contractor_payable_items` become the payable approval and payment-readiness layer.

Recommendation: use Hybrid Option D.

## 8. Proposed `contractor_payables` Object

Future `contractor_payables` fields:

- `id`
- `tenant_id`
- `payable_number`
- `payable_type`
- `status`
- `approval_status`
- `payment_readiness_status`
- `payable_party_type`
- `capacity_provider_id` nullable
- `crew_id` nullable
- `worker_id` nullable future
- `vendor_organization_id` nullable future
- `project_id` nullable
- `settlement_id` nullable
- `pay_cycle_start` nullable
- `pay_cycle_end` nullable
- `due_date` nullable
- `gross_payable_amount`
- `deduction_amount`
- `chargeback_amount`
- `retainage_amount`
- `net_payable_amount`
- `payment_status`
- `compliance_status`
- `tax_document_status`
- `dispute_status`
- `hold_status`
- `approved_by` nullable
- `approved_at` nullable
- `rejected_by` nullable
- `rejected_at` nullable
- `rejection_reason` nullable
- `hold_reason` nullable
- `dispute_reason` nullable
- `override_reasons` jsonb
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Payable types:

- `subcontractor`
- `crew`
- `worker_later`
- `vendor_later`
- `internal_self_perform`
- `adjustment`
- `retainage_release`
- `chargeback`

Statuses:

- `draft`
- `assembling`
- `ready_for_review`
- `under_review`
- `approved`
- `rejected`
- `held`
- `disputed`
- `payment_ready`
- `payment_created_later`
- `partially_paid_later`
- `paid_later`
- `voided`
- `archived`

Approval statuses:

- `not_submitted`
- `pending`
- `approved`
- `rejected`
- `withdrawn`

Payment readiness statuses:

- `not_ready`
- `ready_with_warning`
- `ready_for_payment`
- `blocked`

Payment statuses:

- `not_paid`
- `partially_paid_later`
- `paid_later`
- `held`
- `disputed`

Compliance statuses:

- `unknown`
- `missing`
- `incomplete`
- `ready`
- `expired`
- `blocked`

Tax document statuses:

- `unknown`
- `missing_w9`
- `ready`
- `expired`
- `blocked`

Dispute statuses:

- `none`
- `open`
- `under_review`
- `resolved`
- `rejected`

Hold statuses:

- `none`
- `hold`
- `released`

## 9. Proposed `contractor_payable_items` Object

Future `contractor_payable_items` fields:

- `id`
- `tenant_id`
- `contractor_payable_id`
- `settlement_id`
- `settlement_item_id`
- `billable_item_id` nullable
- `qc_review_id` nullable
- `production_record_id` nullable
- `work_order_id` nullable
- `project_id` nullable
- `capacity_provider_id` nullable
- `crew_id` nullable
- `worker_id` nullable future
- `item_type`
- `status`
- `description`
- `quantity`
- `unit`
- `contractor_rate`
- `gross_payable_amount`
- `deduction_amount`
- `chargeback_amount`
- `retainage_percent` nullable
- `retainage_amount`
- `net_payable_amount`
- `compliance_status`
- `tax_document_status`
- `dispute_status`
- `hold_status`
- `payment_item_id` nullable future
- `created_by`
- `updated_by`
- `voided_by` nullable
- `voided_at` nullable
- `void_reason` nullable
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Item types:

- `labor`
- `subcontractor_production`
- `equipment`
- `material_reimbursement`
- `retainage_hold`
- `retainage_release`
- `deduction`
- `chargeback`
- `adjustment`
- `correction`
- `bonus`
- `penalty`

Statuses:

- `draft`
- `ready`
- `approved`
- `held`
- `disputed`
- `payment_ready`
- `payment_created_later`
- `voided`
- `archived`

## 10. Payable Party Model

Payable party types:

- `capacity_provider`
- `crew`
- `worker_later`
- `vendor_later`
- `internal_self_perform`

Rules:

- Capacity provider payable requires `capacity_provider_id`.
- Crew payable requires `crew_id`.
- Worker payable is future scope unless worker payroll rules are approved.
- Vendor payable is future scope unless vendor payable rules are approved.
- Internal self-perform may track internal cost but should not create external payment.
- Subcontractor payable and W2 payroll must remain separate workflows.

## 11. Payable Creation Rules

Future route:

`POST /contractor-payables`

Required:

- `payable_type`
- `payable_party_type`

Optional:

- `capacity_provider_id`
- `crew_id`
- `project_id`
- `settlement_id`
- `pay_cycle_start`
- `pay_cycle_end`
- `due_date`
- `override_reasons`

Validation:

- actor has `contractor_payable.create`
- payable type is approved
- payable party belongs to tenant
- settlement belongs to tenant if provided
- project belongs to tenant if provided
- payable number is generated
- status defaults `draft`
- approval status defaults `not_submitted`
- payment status defaults `not_paid`

On create:

- event `contractor_payable.created`
- audit/system action
- no payment
- no payroll
- no bank transaction

## 12. Add Payable Item From Settlement Item

Future route:

`POST /contractor-payables/:id/items`

Required:

- `settlement_item_id`

Optional:

- `quantity`
- `contractor_rate`
- `description`
- `deduction_amount`
- `chargeback_amount`
- `retainage_percent`
- `override_reasons`

Validation:

- actor has `contractor_payable.add_item` or `contractor_payable_item.create`
- contractor payable belongs to tenant
- settlement item belongs to tenant
- settlement item is payable-ready or parent settlement is payable-ready unless override is supplied
- settlement item has contractor payable amount or contractor rate unless override is supplied
- customer-billable-only item is rejected unless adjustment override is supplied
- no duplicate active payable item for the same settlement item unless split/adjustment override is supplied
- quantity is positive unless adjustment/chargeback type allows negative value
- quantity does not exceed settlement item quantity unless override is supplied
- payable party matches settlement item provider/crew where available unless override is supplied
- source traceability is copied

Derived:

- `settlement_id`
- `billable_item_id`
- `qc_review_id`
- `production_record_id`
- `work_order_id`
- `project_id`
- `capacity_provider_id`
- `crew_id`
- `quantity`
- `unit`
- `contractor_rate`
- `gross_payable_amount`
- `retainage_amount`
- `deduction_amount`
- `chargeback_amount`
- `net_payable_amount`

On add:

- contractor payable item created
- contractor payable totals recalculated
- event `contractor_payable.item_added`
- event `contractor_payable_item.created`
- audit/system action
- no payment
- no payroll

## 13. Payable Totals

Totals derive from active payable items.

Exclude:

- voided
- archived

Calculate:

- `gross_payable_amount`
- `deduction_amount`
- `chargeback_amount`
- `retainage_amount`
- `net_payable_amount`

Formula:

`net_payable_amount = gross_payable_amount - deductions - chargebacks - retainage`

Rules:

- no negative net payable unless adjustment/chargeback type allows it
- totals are auditable
- recalculation endpoint is recommended

## 14. Payable Approval Model

Approval verifies:

- payable has items
- payable party is valid
- payable party compliance was reviewed
- tax documents were reviewed
- rates were reviewed
- deductions and chargebacks were reviewed
- retainage was reviewed
- no unresolved dispute exists
- no hold exists
- net payable amount is valid

Lifecycle:

- submit review
- start review
- approve
- reject

Approval does not create payment.

Roles:

- Billing Admin / Operations prepares
- Finance Manager approves
- Executive/System Admin overrides
- Payroll/Payables role later executes payment

## 15. Payment Readiness Model

Payment readiness answers: "Can this payable be handed off to a future payment/payroll process?"

Payment readiness checks:

- approved payable
- compliance ready
- tax docs ready
- no hold
- no dispute
- net payable amount greater than zero
- payment method/payee info reviewed later
- no duplicate payment created

Statuses:

- `not_ready`
- `ready_with_warning`
- `ready_for_payment`
- `blocked`

Future route:

`POST /contractor-payables/:id/mark-payment-ready`

Required:

- `ready_note`

On success:

- `payment_readiness_status = ready_for_payment`
- `status = payment_ready`
- no payment

## 16. Retainage / Holdback Model

Retainage may be held from contractor payable.

Types:

- `retainage_hold`
- `retainage_release`
- `warranty_hold`
- `compliance_hold`
- `closeout_hold`

Rules:

- retainage reduces current net payable
- retainage does not reduce production quantity
- retainage release is future payable item/type
- formal retainage ledger may be future scope
- first payable backend can store retainage amount/percent on payable item

## 17. Deductions / Chargebacks Model

Deductions and chargebacks may reduce payable.

Reasons:

- rework
- failed QC
- safety violation
- missing documentation
- damage
- backcharge
- material issue
- equipment issue
- customer chargeback
- late completion
- other

Rules:

- deductions require reason/note if applied
- chargebacks require reason/note if applied
- deductions and chargebacks are auditable
- first implementation may store amounts as fields
- first-class chargeback object can be future scope

## 18. Dispute Model

Disputes may occur when a provider or crew disputes amount, deduction, chargeback, retainage, or readiness.

Rules:

- dispute does not create payment
- dispute blocks payment readiness unless override is explicitly approved
- dispute resolution does not change amount unless explicit adjustment workflow exists
- dispute reason is required

Dispute statuses:

- `none`
- `open`
- `under_review`
- `resolved`
- `rejected`

## 19. Hold Model

Holds pause payable readiness.

Hold reasons:

- `compliance_missing`
- `tax_docs_missing`
- `dispute`
- `executive_hold`
- `missing_docs`
- `quality_issue`
- `safety_issue`
- `other`

Rules:

- hold blocks payment readiness
- release hold requires note/reason
- hold does not change payable amount

## 20. Pay Cycle Model

Contractor Payable should support pay cycles.

Fields:

- `pay_cycle_start`
- `pay_cycle_end`
- `due_date`

Rules:

- pay cycle can group payable items
- payable may be filtered by pay cycle
- pay cycle does not create payment
- future payment run may consume payment-ready payables

## 21. Payment / Payroll Boundary

Contractor Payable must not create:

- payment record
- ACH payout
- card payout
- check
- bank transaction
- payroll run
- payslip
- contractor portal payment

Future chain:

Contractor Payable -> Payment Run / Payroll later -> Payment Execution later -> Bank Reconciliation later

## 22. Tax / Compliance Boundary

Contractor Payable may track tax and compliance readiness.

It must not create:

- 1099
- W2
- tax filing
- tax withholding
- payroll tax
- accounting export

Tax fields should remain readiness/status only until a tax rules sprint approves implementation.

## 23. Accounting / Bank Boundary

Contractor Payable must not create:

- GL journal entry
- accounting export
- bank transaction
- bank reconciliation

Accounting and banking remain future integrations.

## 24. Permissions / Roles

Proposed permissions:

Contractor payable:

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

Contractor payable item:

- `contractor_payable_item.read`
- `contractor_payable_item.create`
- `contractor_payable_item.update`
- `contractor_payable_item.void`
- `contractor_payable_item.archive`

Role guidance:

- Operations/Billing can prepare payables.
- Finance Manager can approve/reject and place holds.
- Executive/System Admin can override.
- Payables/Payroll role later can execute future payment/payroll workflows.

## 25. Events And Audit Requirements

Proposed events:

Contractor payable:

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

Contractor payable item:

- `contractor_payable_item.created`
- `contractor_payable_item.updated`
- `contractor_payable_item.voided`
- `contractor_payable_item.archived`

Every write must create:

- event
- event payload
- audit log
- system action

Audit should capture actor, tenant, payable id, payable item id, settlement id, settlement item id, payable party, before/after amounts, reason/note, override reasons, correlation id, and timestamp.

## 26. Search

Future search should include:

- `contractor_payables`
- `contractor_payable_items`

Search fields:

- payable number
- provider
- crew
- project
- settlement number
- status
- dispute reason
- hold reason

Search must be tenant scoped. Archived records should be excluded unless `archived=true`.

## 27. Recommended Backend Foundation Scope

Recommended next coding sprint:

Contractor Payable Backend Contract Foundation.

Build:

- `contractor_payables`
- `contractor_payable_items`
- create payable
- add payable items from payable-ready settlement items
- list/detail endpoints
- totals calculation
- submit/start review
- approve/reject
- mark payment ready
- hold/release
- dispute/resolve
- void/archive
- timeline/audit
- search
- smoke test
- release validation wiring

Do not build:

- actual payment creation
- payroll
- ACH/card payout
- bank transaction
- tax filing
- accounting export
- contractor portal

## 28. Required Product Confirmations

The next coding sprint should not start until these are confirmed:

1. Should Contractor Payable use Hybrid Option D?
2. Should settlement items remain source of payable truth?
3. Should contractor payable items consume only payable-ready settlement items?
4. Can one settlement item be split across multiple payable items?
5. Should payable party be capacity provider first, crew second, worker later?
6. Should worker-level payroll be separate from contractor payable?
7. Should vendor payables be future scope?
8. Should internal self-perform be tracked as cost but not external payment?
9. Should retainage ledger be deferred?
10. Should deductions/chargebacks be fields now and first-class later?
11. Should disputes block payment readiness?
12. Should holds block payment readiness?
13. Should compliance/tax docs block payment readiness?
14. Should approval create payment? Recommended: no.
15. Should payment-ready create payment? Recommended: no.
16. Who can approve contractor payables?
17. Who can mark payment ready?
18. Should contractor payable ever consume cash receipts? Recommended: no.
19. Should accounting export be deferred?
20. Should bank reconciliation be deferred?

## 29. Validation

Non-mutating checks for this clarification sprint:

- `git status --short`
- inspect settlement/payable/capacity/cash/payment/payroll routes
- inspect migrations
- inspect permissions/events
- inspect smokes
- inspect docs
- `git diff --check`

No application code, migrations, routes, UI, or tests are required for this sprint.

## 30. GO / NO-GO Recommendation

GO: Contractor Payable Backend Contract Foundation, after product confirms the required questions above.

NO-GO:

- Contractor Payable Workspace UI
- Payment Run / Payroll
- ACH/card payout
- bank transaction
- tax filing
- accounting export
- contractor portal
- vendor payable expansion beyond explicitly approved scope

The recommended implementation is first-class `contractor_payables` and `contractor_payable_items` sourced from payable-ready settlement items, with Contractor Payable stopping at payment readiness and creating no money movement.

## 31. Backend Foundation Status

The Contractor Payable Backend Contract Foundation implements the Hybrid Option D recommendation:

- Settlement items preserve payable source values.
- `contractor_payables` and `contractor_payable_items` provide the payable approval and payment-readiness layer.
- Payment readiness remains a handoff state only.

Implemented documentation:

- `docs/product/contractor-payable-backend-contract.md`
- `docs/product/contractor-payable-workspace-product-contract.md`
- `docs/product/contractor-payable-physical-test.md`

Implemented validation:

- `npm run contractor-payable:smoke`

Boundary reaffirmation:

Contractor Payable approval and payment readiness do not create payment, payroll, ACH/card payout, bank transaction, bank reconciliation, tax, accounting export, contractor portal, vendor portal, or cash movement records.
