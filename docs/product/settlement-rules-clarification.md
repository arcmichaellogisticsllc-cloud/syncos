# Settlement Rules Clarification

Current validated commit: `eeb27214c8e35ea54942f43864136a6eda78f457`

Implementation follow-up: Settlement Backend Contract Foundation began from validated commit `8224025370a9bc71c0f400d17b5ddb0cd348412a`.

This is a rules clarification document only. It does not create backend objects, migrations, routes, UI, settlement records, settlement items, invoices, payments, payroll, AR, cash, or tax records.

## 1. Current Backend Inventory

Files inspected:

- `apps/api/src/routes/settlements.controller.ts`
- `apps/api/src/routes/cash.controller.ts`
- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/search.controller.ts`
- `packages/database/migrations/010_contracts_rates_settlements_invoices_payments.sql`
- `packages/database/migrations/029_production_contract_hardening.sql`
- `packages/database/migrations/030_qc_review_contract_foundation.sql`
- `packages/database/migrations/031_billable_contract_foundation.sql`
- `apps/api/scripts/sprint7-smoke.js`
- `apps/api/scripts/sprint8-smoke.js`
- `apps/api/scripts/production-smoke.js`
- `apps/api/scripts/qc-smoke.js`
- `apps/api/scripts/billable-smoke.js`
- `docs/product/work-order-backend-contract.md`
- `docs/product/production-backend-contract.md`
- `docs/product/qc-backend-contract.md`
- `docs/product/billable-backend-contract.md`
- `docs/product/billable-rules-clarification.md`

Inventory classification:

| Area | Current state | Classification |
| --- | --- | --- |
| `billable_items` table/routes | `billable_items` is first-class, tenant scoped, linked to project, work order, production, QC, customer, provider, crew, and optional future settlement item. Routes support list/detail/create/update/readiness/hold/dispute/void/archive/timeline/audit. | Supported |
| `production_records` billable fields | Production records include `billable_status`, `billable_quantity`, approval quantities, and production mark-billable behavior. Production does not create finance records. | Supported |
| `qc_reviews` | QC reviews exist as first-class acceptance records with approved/rejected/correction/billable-candidate quantities and production synchronization. | Supported |
| `work_orders` billable fields | Work Orders expose billable status and billable quantity summaries and have a mark-billable lifecycle action. | Supported |
| Project financial readiness fields | Projects include financial readiness fields and detail context, but no first-class settlement readiness summary was found. | Partially supported |
| `settlements` table/routes | A legacy `settlements` table and routes exist with contract/customer/provider, billing period, gross/retainage/adjustment/chargeback/net totals, and statuses `draft`, `internal_review`, `ready_to_submit`, `submitted`, `customer_review`, `approved`, `disputed`, `archived`. | Partially supported |
| `settlement_items` table/routes | Settlement items exist but link to `production_record_id` and `rate_code_id`, not `billable_item_id`, `qc_review_id`, work order, or project. | Partially supported |
| Retainage ledger/table | Contract and settlement retainage fields exist. No dedicated retainage ledger was found. | Missing |
| Chargeback table/routes | Settlement has `chargeback_amount` and `dispute_reason`; no first-class chargeback object/routes were found. | Partially supported |
| Invoices | Invoice routes exist and require approved settlement. Invoice submit creates AR. | Supported |
| Invoice items | No dedicated invoice item table was identified. | Missing |
| AR tables/routes | `ar_records` table and read/archive routes exist. AR is created when invoice is submitted. | Supported |
| Cash receipts/payment routes | Payment routes exist and reconcile against invoice/settlement context, updating AR and customer payment stats. No cash receipt object was found. | Partially supported |
| Payroll/payable fields/routes | No payroll/payable table or routes were found. Existing smoke checks explicitly ensure payroll tables are absent. | Missing |
| Contracts table/routes | Contracts support tenant-scoped CRUD/archive, organization/opportunity linkage, payment terms, retainage percent, and status. | Supported |
| Rate schedules/routes | Rate schedules support tenant-scoped CRUD/archive and contract/organization linkage. | Supported |
| Rate codes/routes | Rate codes include customer rate, contractor rate, margin fields, unit validation, and tenant-scoped CRUD/archive. | Supported |
| Customer payment stats | `customer_payment_stats` exists and is updated during payment reconciliation. | Supported |
| Finance permissions | Legacy `settlement.*`, `settlement_item.*`, `invoice.*`, `payment.*`, and `ar.*` permissions exist. New proposed settlement permissions do not all exist. | Partially supported |
| Billable permissions | `billable_item.*` permissions exist for read/create/update/readiness/hold/dispute/void/archive/timeline/audit. | Supported |
| Settlement permissions | Existing settlement permissions include read/create/update/internal_review/ready_to_submit/submit/customer_review/approve/dispute/archive and settlement item read/create/update/archive. Missing proposed hold/release, reject, readiness, invoice-ready, payable-ready, void, timeline, audit. | Partially supported |
| Events | Legacy settlement events exist through write-action helper, including settlement created/updated/internal_review_started/ready_to_submit/submitted/customer_review_started/approved/disputed/archived and settlement item created/updated/archived. | Partially supported |
| Audit behavior | Existing settlement writes use `executeWriteAction`, creating event, event payload, audit log, and system action. Dedicated settlement audit/timeline endpoints were not found. | Partially supported |
| Search support | Global search includes `settlement`, but only status/dispute reason fields; no `settlement_item` search and no enriched project/customer/provider search for settlements. | Partially supported |
| Smoke tests | `sprint7:smoke` covers legacy contracts/rates/settlements and ensures no invoice/payment/AR creation from settlement. `sprint8:smoke` covers invoice/AR/payment. `billable:smoke` covers ready-for-settlement. No dedicated `settlement:smoke` exists. | Partially supported |

Special focus conclusion:

Existing settlement support is not sufficient for the post-Billable architecture. It is legacy and production-driven: `settlement_items` are created from billable `production_records`, while the approved chain now requires `Billable Item -> Settlement Item -> Invoice Item -> AR -> Cash`. Settlement Backend Contract Foundation is required before Settlement UI.

Backend foundation implementation note:

- Legacy production-record settlement routes remain for compatibility.
- New settlement contract routes consume `ready_for_settlement` `billable_items`.
- Settlement can mark invoice-ready or payable-ready state only.
- Settlement does not create invoices, invoice items, AR, payments, cash, payroll, ACH, card payouts, bank transactions, or tax records.

## 2. Settlement Definition

Settlement is a controlled financial commitment layer that converts ready billable work into auditable financial line items before invoicing, AR, cash, contractor payable, or payroll.

Settlement represents:

- selected billable items
- settlement line items
- customer billable value
- contractor payable value where applicable
- margin estimate
- retainage amount
- deductions and chargebacks
- approval status
- invoice readiness
- payout readiness
- financial exceptions, holds, disputes, and overrides

Settlement does not represent:

- invoice
- AR
- cash receipt
- payment
- payroll
- tax filing
- bank transaction

## 3. Core Settlement Principle

Settlement is financial commitment.

Billable is financial eligibility.

Invoice is customer demand for payment.

AR is money owed.

Cash is money received.

Payroll/payables are money paid out.

The customer-billing chain must remain:

`Billable Item -> Settlement Item -> Invoice Item -> AR -> Cash`

The contractor-payable chain should remain:

`Billable Item -> Settlement Item -> Contractor Payable / Payroll later`

Never:

`Production -> Settlement`

Never:

`QC -> Invoice`

Never:

`Billable -> Cash`

## 4. Settlement Relationship To Billable

Settlement consumes:

- `billable_items` with status `ready_for_settlement`
- approved billable quantity
- unit
- rate context
- estimated billable amount
- customer/prime acceptance
- documentation readiness
- billing package readiness
- retainage estimates
- hold/dispute state

Rules:

- Only `ready_for_settlement` Billable items can be settled unless an explicit override is approved.
- Held, disputed, voided, or archived Billable items cannot be settled.
- A Billable item cannot be settled twice unless split settlement is explicitly approved.
- A Settlement Item must preserve `billable_item_id`.
- Settlement must not mutate source Billable items silently.
- Settlement may mark a source Billable item `settlement_created` only through audited backend logic if product approves that synchronization.
- Settlement must not create invoices, AR, payments, cash, payroll, or tax records.

## 5. Settlement Relationship To QC / Production / Work Orders / Projects

Settlement must preserve traceability to:

- `billable_item_id`
- `qc_review_id`
- `production_record_id`
- `work_order_id`
- `project_id`
- `customer_organization_id`
- `capacity_provider_id` and/or `crew_id` where applicable

Settlement should aggregate by:

- project
- work order
- customer
- provider
- crew
- rate code
- work type
- territory
- invoice cycle
- pay cycle

Settlement must not directly change:

- production claimed quantity
- QC approved quantity
- Billable quantity

Any reversal, void, adjustment, or backout of source quantity must be a later explicit workflow.

## 6. Settlement Object Model Options

Option A: Direct invoice from `billable_items`

Pros:

- fewer objects

Cons:

- skips financial commitment review
- weak payables, margin, retainage, hold, and chargeback handling
- poor audit separation between eligibility and invoice demand

Option B: First-class `settlements` and `settlement_items`

Pros:

- clear financial commitment layer
- supports approvals, retainage, chargebacks, deductions, margins, holds, disputes, and readiness
- supports both customer billables and contractor payables
- supports future invoice and payroll/payable workflows independently

Cons:

- more objects
- requires migration away from production-record-driven legacy settlement items

Option C: Contractor payout only

Pros:

- simpler subcontractor settlement

Cons:

- ignores customer billing workflow
- does not support invoice readiness cleanly

Option D: Hybrid settlement model

One settlement can support:

- customer billable items
- contractor payable items
- internal margin
- retainage
- chargebacks
- deductions
- adjustments

Recommendation:

Use first-class `settlements` and `settlement_items`, hardened for the Billable layer. Do not invoice directly from `billable_items`.

## 7. Proposed Settlement Object

Future `settlements` object:

- `id`
- `tenant_id`
- `settlement_number`
- `settlement_type`
- `status`
- `readiness_status`
- `readiness_score`
- `customer_organization_id` nullable
- `capacity_provider_id` nullable
- `project_id` nullable
- `work_order_id` nullable
- `settlement_period_start` nullable
- `settlement_period_end` nullable
- `invoice_cycle` nullable
- `pay_cycle` nullable
- `gross_billable_amount`
- `contractor_payable_amount`
- `retainage_amount`
- `deduction_amount`
- `chargeback_amount`
- `net_settlement_amount`
- `estimated_margin_amount`
- `estimated_margin_percent`
- `invoice_ready`
- `payable_ready`
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
- `voided_by` nullable
- `voided_at` nullable
- `void_reason` nullable
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Settlement types:

- `customer_billable`
- `contractor_payable`
- `mixed`
- `internal_adjustment`
- `retainage_release`
- `correction_adjustment`
- `chargeback`

## 8. Proposed Settlement Item Object

Future `settlement_items` object:

- `id`
- `tenant_id`
- `settlement_id`
- `billable_item_id`
- `project_id`
- `work_order_id`
- `production_record_id`
- `qc_review_id`
- `customer_organization_id` nullable
- `capacity_provider_id` nullable
- `crew_id` nullable
- `item_type`
- `quantity`
- `unit`
- `unit_rate`
- `gross_amount`
- `retainage_percent` nullable
- `retainage_amount` nullable
- `deduction_amount` nullable
- `chargeback_amount` nullable
- `net_amount`
- `contractor_rate` nullable
- `contractor_payable_amount` nullable
- `margin_amount` nullable
- `margin_percent` nullable
- `billing_package_status`
- `documentation_status`
- `customer_acceptance_status`
- `prime_acceptance_status`
- `invoice_item_id` nullable future
- `payable_item_id` nullable future
- `status`
- `hold_reason` nullable
- `dispute_reason` nullable
- `override_reasons` jsonb
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

- `customer_billable`
- `contractor_payable`
- `retainage_hold`
- `retainage_release`
- `deduction`
- `chargeback`
- `adjustment`
- `correction`

## 9. Settlement Status Model

Proposed statuses:

- `draft`
- `assembling`
- `ready_for_review`
- `under_review`
- `approved`
- `rejected`
- `held`
- `disputed`
- `invoice_ready`
- `payable_ready`
- `invoice_created_later`
- `payable_created_later`
- `voided`
- `archived`

Definitions:

- `draft`: Settlement created but not complete.
- `assembling`: Items are being added or reviewed.
- `ready_for_review`: Prepared for settlement approval.
- `under_review`: Finance/operations review is in progress.
- `approved`: Settlement is financially approved.
- `rejected`: Settlement is rejected.
- `held`: Settlement is paused due to issue, dispute, documentation, rate, margin, or customer/provider matter.
- `disputed`: Settlement is disputed.
- `invoice_ready`: Approved and eligible for future invoice creation.
- `payable_ready`: Approved and eligible for future payable process.
- `invoice_created_later`: Future invoice was created by a later Invoice sprint.
- `payable_created_later`: Future payable/payroll process was created by a later finance sprint.
- `voided`: Administrative void retained for audit.
- `archived`: Historical inactive record.

Legacy mapping recommendation:

- `internal_review` -> `under_review`
- `ready_to_submit` -> `ready_for_review`
- `submitted` -> `under_review` or `ready_for_review`, depending product confirmation
- `customer_review` -> `under_review`
- `approved` -> `approved`
- `disputed` -> `disputed`
- `archived` -> `archived`

## 10. Settlement Readiness Model

Settlement readiness answers:

“Can this settlement be approved as a financial commitment?”

Checks:

- at least one settlement item exists
- all source Billable items are `ready_for_settlement`
- no duplicate settlement item exists for the same Billable item unless split settlement is approved
- quantity is valid
- customer rates are valid
- contractor rates are valid when payable side exists
- gross amounts are calculated
- retainage is reviewed
- deductions and chargebacks are reviewed
- customer acceptance is ready where required
- prime acceptance is ready where required
- billing package is ready or override is captured
- documentation is ready or override is captured
- no unresolved hold
- no unresolved dispute
- margin is reviewed
- approval actor has authority

Readiness statuses:

- `not_ready`
- `needs_review`
- `ready_with_warning`
- `ready_for_approval`
- `blocked`

Readiness score:

- `not_ready`: 0-39
- `needs_review`: 40-69
- `ready_with_warning`: 70-84
- `ready_for_approval`: 85-100

## 11. Customer Billable vs Contractor Payable

Settlement must distinguish two money directions.

Customer billable:

Money the customer or prime owes.

Contractor payable:

Money owed to subcontractor, provider, crew, or other delivery source.

These amounts may differ.

Example:

- Customer billable: `1,000 feet @ $10.00 = $10,000`
- Contractor payable: `1,000 feet @ $7.50 = $7,500`
- Estimated margin: `$2,500`

Rules:

- Customer billable and contractor payable must not be assumed identical.
- Contractor payable requires provider/crew assignment and payable rate context.
- Internal self-perform work may have no contractor payable settlement item.
- Margin should be calculated where both customer and contractor sides exist.
- Customer billing and contractor payout may occur on different schedules.
- Settlement may represent customer billable, contractor payable, or mixed items, if approved.

## 12. Rate Model

Settlement needs rate context for customer and contractor sides.

Customer rate sources:

- Billable item unit rate
- contract rate
- project rate
- customer rate
- manual rate
- unknown

Contractor rate sources:

- subcontractor agreement
- provider rate schedule
- manual rate
- split-rate rule
- unknown

Rules:

- Customer unit rate is required before invoice readiness unless override is supplied.
- Contractor rate is required before payable readiness unless override is supplied.
- Manual rate requires audit and approval.
- Rates must not be silently changed from the source Billable item.
- Rate differences must be visible and auditable.
- No pricing engine should be built in the clarification sprint or first foundation unless separately approved.

## 13. Retainage Model

Retainage may apply to customer side, contractor side, or both.

Retainage types:

- `customer_retainage`
- `contractor_retainage`
- `internal_hold`
- `warranty_hold`
- `closeout_hold`

Rules:

- Retainage reduces net payable/receivable timing, not production quantity.
- Retainage amount should be calculated and auditable.
- Settlement item can store retainage estimate and amount.
- Formal retainage ledger should be deferred unless product explicitly approves it for Settlement Backend Foundation.
- Retainage release should be a future workflow unless product approves `retainage_release` items now.

Recommendation:

Store retainage amounts and release condition on `settlements` and `settlement_items`. Defer formal retainage ledger.

## 14. Deductions / Chargebacks

Settlement should support deductions and chargebacks.

Examples:

- failed QC
- rework
- damage
- missing documentation
- safety violation
- material loss
- equipment damage
- customer backcharge
- late completion
- permit issue
- restoration issue

Fields:

- `deduction_amount`
- `chargeback_amount`
- `deduction_reason`
- `chargeback_reason`
- `related_constraint_id` nullable
- `related_correction_id` nullable

Rules:

- Deductions and chargebacks require reason.
- Contractor payable can be reduced by deductions.
- Customer billable can be reduced by customer chargebacks.
- Chargebacks must be auditable.
- Formal chargeback object should be deferred unless product approves it.

Recommendation:

Model deductions and chargebacks as fields in the first backend foundation; consider first-class objects later.

## 15. Margin Model

Settlement should calculate:

- `gross_billable_amount`
- `contractor_payable_amount`
- `deduction_amount`
- `retainage_amount`
- `net_settlement_amount`
- `estimated_margin_amount`
- `estimated_margin_percent`

Formula:

`estimated_margin_amount = customer billable net amount - contractor payable net amount`

Rules:

- Margin is unknown if contractor payable is unknown.
- Negative margin creates warning.
- Negative margin should not automatically block unless a later hard-stop policy is approved.
- Executive override may be required for negative margin later.

## 16. Approval Model

Settlement approval is a financial governance action.

Approval should verify:

- source Billable items are valid
- settlement items are valid
- customer and contractor rates are reviewed
- retainage is reviewed
- deductions and chargebacks are reviewed
- documentation is reviewed
- customer/prime acceptance is reviewed
- margin is reviewed
- no holds/disputes remain unresolved
- no duplicate settlement items exist

Approval statuses:

- `pending`
- `approved`
- `rejected`
- `withdrawn`

Approval route later should require:

- `approval_note`
- override reasons if warnings exist

Recommended roles:

- Billing Admin can prepare.
- Operations Manager can review operational exceptions.
- Finance Manager / Executive can approve.
- System Admin can override.

## 17. Invoice Relationship

Settlement does not equal invoice.

Settlement approval may produce invoice readiness.

Invoice later consumes:

- approved settlement
- settlement items
- customer organization
- billing package
- invoice cycle
- invoice terms

Rules:

- Settlement must not automatically create invoice in the first backend foundation.
- Invoice creation should be explicit in a future Invoice sprint.
- `invoice_ready` means eligible for future invoice creation, not invoice created.
- Existing invoice routes currently create an invoice from an approved settlement and create AR on invoice submit. That behavior should remain outside Settlement Backend Foundation.

## 18. AR / Cash Boundary

Settlement must not create:

- AR
- payment
- cash receipt
- deposit
- bank transaction

Invoice creates AR later.

Cash application closes AR later.

Settlement only prepares financial commitment.

## 19. Payroll / Contractor Payable Boundary

Settlement may identify contractor payable amounts.

Settlement must not create:

- payroll run
- paycheck
- payment
- ACH
- card payout
- bank transaction

Future payable/payroll workflows consume approved payable settlement.

Ambiguity requiring confirmation:

- Whether contractor settlement belongs to the same `settlements`/`settlement_items` object or a separate payable object.

Recommended answer:

Use the same settlement and settlement item model for payable readiness. Actual payout/payroll remains deferred.

## 20. Settlement Permissions

Proposed permissions:

- `settlement.read`
- `settlement.create`
- `settlement.update`
- `settlement.recalculate_readiness`
- `settlement.add_item`
- `settlement.remove_item`
- `settlement.submit_review`
- `settlement.approve`
- `settlement.reject`
- `settlement.place_hold`
- `settlement.release_hold`
- `settlement.dispute`
- `settlement.resolve_dispute`
- `settlement.mark_invoice_ready`
- `settlement.mark_payable_ready`
- `settlement.void`
- `settlement.archive`
- `settlement.timeline.read`
- `settlement.audit.read`

Settlement item permissions:

- `settlement_item.read`
- `settlement_item.create`
- `settlement_item.update`
- `settlement_item.void`
- `settlement_item.archive`

Existing legacy permissions that should be mapped or preserved during transition:

- `settlement.internal_review`
- `settlement.ready_to_submit`
- `settlement.submit`
- `settlement.customer_review`
- `settlement.dispute`
- `settlement.archive`

## 21. Settlement Events

Proposed events:

- `settlement.created`
- `settlement.updated`
- `settlement.readiness_recalculated`
- `settlement.item_added`
- `settlement.item_removed`
- `settlement.review_submitted`
- `settlement.approved`
- `settlement.rejected`
- `settlement.held`
- `settlement.hold_released`
- `settlement.disputed`
- `settlement.dispute_resolved`
- `settlement.invoice_ready`
- `settlement.payable_ready`
- `settlement.voided`
- `settlement.archived`

Settlement item events:

- `settlement_item.created`
- `settlement_item.updated`
- `settlement_item.voided`
- `settlement_item.archived`

Every write must create:

- event
- event payload
- audit log
- system action

using the established write-action helper.

## 22. Search

Future search should include:

- `settlements`
- `settlement_items`

Search fields:

- settlement number
- customer
- provider
- project
- work order
- Billable item
- status
- dispute reason
- hold reason

Rules:

- Search must remain tenant scoped.
- Archived records should be excluded unless `archived=true`.

## 23. Recommended Backend Foundation Scope

Recommended next coding sprint:

Settlement Backend Contract Foundation.

Build:

- harden `settlements`
- harden `settlement_items`
- create settlement
- add/remove items from `ready_for_settlement` Billable items
- list/detail endpoints
- readiness calculation
- submit review
- approve/reject
- hold/release
- dispute/resolve
- mark invoice ready
- mark payable ready
- void/archive
- timeline/audit
- search
- `npm run settlement:smoke`
- release validation wiring

Do not build:

- invoice creation
- AR
- cash receipts
- payments
- payroll
- tax accounting
- customer portal
- automated payouts

## 24. Required Product Confirmations

Product confirmation is required before coding:

1. Should Settlement be first-class `settlements` plus `settlement_items`?
2. Should one settlement support both customer billable and contractor payable items?
3. Should customer billable and contractor payable be separate settlement types, or should mixed settlement be supported?
4. Can one Billable item be split across multiple settlement items?
5. Should `ready_for_settlement` Billable items be required before settlement item creation?
6. Should settlement item creation update Billable item status to `settlement_created`?
7. Should settlement approval automatically mark `invoice_ready`?
8. Should `invoice_ready` and `payable_ready` be separate states?
9. Should retainage ledger be created now or deferred?
10. Should deductions/chargebacks be fields now or first-class objects later?
11. Should negative margin block approval or warn?
12. Who can approve settlements?
13. Who can mark `invoice_ready`?
14. Who can mark `payable_ready`?
15. Should settlement ever create invoice automatically?
16. Should settlement ever create contractor payment/payroll automatically?
17. Should invoice and payable flows share settlement items or fork after approval?
18. Should settlement items be immutable after approval?
19. Should voided settlements reverse Billable item settlement status?
20. Should settlement support period-based batching?

Recommended answers:

- Yes, use first-class `settlements` and `settlement_items`.
- Support `customer_billable`, `contractor_payable`, and `mixed` settlement types.
- Require `ready_for_settlement` Billable items.
- Do not auto-create invoices or payments.
- Defer formal retainage ledger.
- Model deductions/chargebacks as fields now and first-class objects later.
- Treat negative margin as warning, not automatic blocker, unless a later hard-stop policy is approved.
- Keep `invoice_ready` and `payable_ready` separate.

## 25. GO / NO-GO Recommendation

NO-GO for Settlement Workspace UI.

GO for Settlement Backend Contract Foundation after product confirmations.

Rationale:

- The existing settlement backend is partially supported but legacy.
- Current settlement items are sourced from billable Production records, not first-class Billable items.
- The backend does not yet provide the required Billable-to-Settlement bridge, settlement readiness model, enriched detail/list model, item traceability to QC/Production/Work Order/Project, hold/release/reject/void/payable-ready/invoice-ready lifecycle, or dedicated timeline/audit endpoints.
- Building UI now would expose outdated settlement semantics and risk confusing eligibility, commitment, invoice, AR, cash, and payable boundaries.

## 26. Validation

Non-mutating checks performed:

- `git status --short`
- inspected current billable, production, QC, work order, project, settlement, invoice, AR, payment, search, permissions, events, migrations, smoke scripts, and product docs

No application code changes were made.

No migrations were created.

No routes were created.

No UI was created.
