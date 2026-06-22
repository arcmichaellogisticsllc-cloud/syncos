# Invoice Rules Clarification

Current validated commit: `597a7c3f3725273590473e75f5913fdbbe48c2d1`

This is a rules clarification document only. It does not create backend objects, migrations, routes, UI, invoice records, invoice items, cash records, payment records, payroll records, tax records, ACH records, card payout records, accounting export records, or bank transaction records.

Architecture update:

Approved Option B:

Invoice carries receivable state.

No separate first-class AR object will be built by default.

Invoice owns:

- `original_amount`
- `paid_amount`
- `balance_amount`
- `aging_days`
- `payment_status`
- `collection_status`

Cash Application will later apply payments to invoices and update invoice balances.

The approved financial chain is now:

`Billable -> Settlement -> Invoice -> Cash Application`

For contractor payables:

`Settlement -> Payable / Payroll later`

## 1. Current Backend Inventory

Files inspected:

- `packages/database/migrations/010_contracts_rates_settlements_invoices_payments.sql`
- `packages/database/migrations/029_production_contract_hardening.sql`
- `packages/database/migrations/030_qc_review_contract_foundation.sql`
- `packages/database/migrations/031_billable_contract_foundation.sql`
- `packages/database/migrations/032_settlement_contract_foundation.sql`
- `packages/permissions/src/index.ts`
- `packages/database/scripts/seed.js`
- `apps/api/src/routes/cash.controller.ts`
- `apps/api/src/routes/settlements.controller.ts`
- `apps/api/src/routes/production.controller.ts`
- `apps/api/src/routes/search.controller.ts`
- `apps/api/scripts/sprint8-smoke.js`
- `apps/api/scripts/settlement-smoke.js`
- `scripts/release-validation.sh`
- `docs/product/settlement-rules-clarification.md`
- `docs/product/settlement-backend-contract.md`
- `docs/product/settlement-workspace-product-contract.md`
- `docs/product/billable-backend-contract.md`
- `docs/product/qc-backend-contract.md`
- `docs/product/production-backend-contract.md`

| Area | Current state | Classification |
| --- | --- | --- |
| `settlements` table | Exists from legacy finance migration and was hardened by Settlement Backend Foundation with settlement number, type, readiness, invoice/payable readiness, approval, hold, dispute, void, archive, and audit fields. | Supported |
| `settlement_items` table | Exists and was hardened with billable, QC, production, work order, project, customer, provider, crew, item type, quantity, rates, retainage, deductions, chargebacks, margin, invoice/payable future links, and lifecycle fields. | Supported |
| Settlement routes | `GET/POST/PATCH /settlements`, detail, items, readiness, review, approve/reject, invoice/payable ready, hold/dispute, void/archive, timeline, audit, and settlement item routes exist. | Supported |
| `billable_items` table/routes | First-class billable items exist and expose readiness, rate, retainage, customer/prime acceptance, settlement link, invoice item future link, timeline, audit, search, and smoke coverage. | Supported |
| `production_records` | Hardened field-truth records with production type, status, QC status, billable status, quantities, evidence, location, correction/revision, timeline/audit, and search support. | Supported |
| `qc_reviews` | First-class QC review records exist with approved/rejected/correction/billable candidate quantities, evidence/location/documentation/customer/prime statuses, lifecycle, timeline/audit, and search support. | Supported |
| `work_orders` | Work Order backend exists with detail/readiness/lifecycle routes and production/billable rollup context. | Supported |
| `projects` | Project backend exists with detail/readiness/lifecycle routes and project context for downstream records. | Supported |
| `invoices` table | Legacy table exists with `organization_id`, `settlement_id`, `invoice_number`, `invoice_date`, `due_date`, `invoice_amount`, `total_amount`, and limited status values: `draft`, `submitted`, `overdue`, `archived`. It lacks invoice item, approval, delivery, cash application readiness, receivable tracking fields, retainage, adjustment, package, customer/prime acceptance, void/dispute, and archive metadata fields proposed here. | Partially supported |
| `invoice_items` table/routes | No `invoice_items` table or invoice item routes were identified. | Missing |
| Invoice routes | Legacy routes exist in `CashController`: list/get/create/update/submit/mark-overdue/archive. Create requires an approved settlement and amount equal to settlement net amount. Submit creates an AR record. No detail, item, totals, approval, sent, ready-for-cash-application, dispute, void, timeline, or audit endpoint exists. | Partially supported |
| Invoice package/document routes | No dedicated invoice package, document, PDF, or invoice evidence routes were identified. | Missing |
| Legacy AR tables/routes | `ar_records` table and list/get/archive routes exist. AR is created by invoice submit today. Under Option B, `ar_records` are legacy/deprecated for the new Invoice contract and should not be used by new invoice flows unless future accounting integration requires it. | Legacy/deprecated |
| Cash receipts/payment routes | `payments` table and list/get/create/update/reconcile/archive routes exist. Payment reconciliation currently updates legacy AR and customer payment stats. Under Option B, future Cash Application should apply payments directly to Invoice receivable fields. | Supported but downstream |
| Payment application logic | Payment reconcile applies payments against legacy invoice/AR and handles exact, short, and overpayment outcomes. New Cash Application logic is future scope and should update invoice paid/balance/payment/collection fields. | Partially supported |
| Customer payment stats | `customer_payment_stats` table exists and is updated during payment reconciliation. | Supported |
| Retainage fields/tables | Contracts, billable items, settlements, and settlement items carry retainage fields. No formal retainage ledger was identified. Legacy invoices do not carry retainage fields. | Partially supported |
| Credit memo / adjustment tables | Settlement/billable/legacy settlement fields include adjustment/deduction concepts. No first-class credit memo or invoice adjustment object was identified. | Missing |
| Contracts/rates | Contracts, rate schedules, and rate codes exist with CRUD/archive routes and permissions. Contracts include payment terms days and retainage percent. | Supported |
| Customer organizations | Organizations exist and are tenant scoped; invoice legacy table uses `organization_id`, while newer finance layers generally use `customer_organization_id`. | Partially supported |
| Finance permissions | Legacy `invoice.read/create/update/submit/mark_overdue/archive`, `ar.read/archive`, and `payment.*` permissions exist. Proposed invoice permissions are broader and not yet present. | Partially supported |
| Settlement permissions | Settlement and settlement item permissions exist and are seeded. | Supported |
| Events | Legacy invoice, AR, payment, and settlement writes use the write-action helper and create event/audit/system_action behavior. Proposed invoice item, receivable-state, cash-application-readiness, and invoice lifecycle events are missing. | Partially supported |
| Audit behavior | Legacy invoice writes audit through the shared helper, but no invoice audit-summary endpoint exists. | Partially supported |
| Search support | Global search includes invoices and payments, but invoice search is limited to invoice number and status. No invoice item search exists. | Partially supported |
| Smoke tests | `sprint8-smoke` validates legacy invoice, AR, and payment behavior. New invoice smoke must prove the Option B invoice contract creates zero `ar_records`, cash, payment, bank, payroll, or tax records. Release validation includes settlement smoke but no dedicated `invoice:smoke` command. | Partially supported |

Special focus:

- Option A, directly from settlements only: partially exists today through legacy invoice creation from approved settlement. It is too coarse for the proposed Invoice layer because it lacks invoice item traceability and partial invoice support.
- Option B, approved architecture: first-class `invoices` and `invoice_items` sourced from invoice-ready `settlement_items`, with receivable state carried on `invoices` instead of a separate AR object.
- Option C, separate first-class AR after invoice: no longer recommended by default. It may be reconsidered only if future accounting integration requires it.
- Option D, hybrid summaries plus first-class invoices/items and separate AR: not recommended as default because it adds an extra accounting layer SyncOS does not currently need.

Important boundary issue:

Current legacy `POST /invoices/:id/submit` creates an `ar_records` row. This behavior must be removed, replaced, or isolated. New invoice submit/review/approve/sent/ready-for-cash-application behavior must create no separate AR record. If the legacy `ar_records` table remains, it should be documented as legacy/deprecated and excluded from the new Invoice contract.

## 2. Invoice Definition

Invoice is a formal customer-facing demand-for-payment and receivable-tracking record generated from approved and invoice-ready settlement items.

Invoice represents:

- customer billed
- invoice number
- invoice date
- due date
- payment terms
- invoice line items
- subtotal
- retainage withheld or released
- taxes/fees if later approved
- total amount due
- original amount
- paid amount
- balance amount
- aging days
- payment status
- collection status
- invoice package/documentation status
- approval status
- delivery status
- dispute state
- cash application readiness
- dispute, void, and write-off state where approved later

Invoice does not represent:

- field production
- QC acceptance
- financial eligibility
- settlement approval
- cash receipt
- bank transaction
- payment processor event
- ACH
- card payment
- payroll
- contractor payout
- tax filing
- accounting export

## 3. Core Invoice Principle

Invoice is customer demand for payment.

Settlement is financial commitment.

Invoice carries receivable state.

Cash Application is the future payment-application layer that updates invoice paid and balance fields.

The chain must remain:

`Settlement Item -> Invoice Item -> Invoice -> Cash Application`

Never:

`Production -> Invoice`

Never:

`QC -> Invoice`

Never:

`Billable -> Invoice`

Never:

`Invoice -> Payment/Bank Transaction`

## 4. Invoice Relationship To Settlement

Invoice consumes:

- approved settlements
- settlement items marked `invoice_ready`
- customer billable settlement items
- customer organization
- billing package readiness
- documentation readiness
- payment terms
- invoice cycle
- net customer billable amounts

Rules:

- Only invoice-ready settlement items can become invoice items unless an explicit override is approved.
- Settlement must be `approved` or `invoice_ready`.
- Settlement items already linked to an active invoice item cannot be invoiced again unless credit/rebill/split workflow is approved.
- Invoice creation must preserve `settlement_id`.
- Invoice item creation must preserve `settlement_item_id`.
- Invoice must not silently mutate settlement.
- Invoice may mark settlement or settlement items `invoice_created_later` only through audited backend logic if product approves that synchronization.
- Invoice creates receivable state internally through invoice balance fields.
- Invoice does not create an external AR object.

Current gap:

Legacy invoice creation consumes a settlement header and settlement net amount, not invoice-ready settlement items. It should not be treated as sufficient for the future Invoice contract.

## 5. Invoice Relationship To Settlement Items

Invoice item should preserve:

- `settlement_item_id`
- `settlement_id`
- `billable_item_id`
- `qc_review_id`
- `production_record_id`
- `work_order_id`
- `project_id`
- `customer_organization_id`
- quantity
- unit
- unit rate
- gross amount
- retainage amount
- deductions/chargebacks where customer-facing
- net amount

Rules:

- Invoice item quantity cannot exceed settlement item quantity unless override is approved.
- Invoice item amount should derive from settlement item net customer billable amount.
- Contractor payable settlement items must not become customer invoice items.
- Retainage hold and retainage release items must be explicit and traceable.
- Voided/archived settlement items cannot become invoice items.
- Settlement item with `payable_ready` only is not invoiceable unless it also represents customer billable invoice readiness.

## 6. Invoice Relationship To Billable / QC / Production / Work Orders / Projects

Invoice must preserve traceability back to:

- billable item
- QC review
- production record
- work order
- project
- customer organization
- territory
- work type

Invoice should allow reporting by:

- customer
- project
- work order
- settlement
- invoice cycle
- production period
- territory
- work type

Invoice must not directly change:

- production quantity
- QC approved quantity
- billable quantity
- settlement amount

Exceptions require a formal credit, rebill, void, or adjustment workflow after rules are approved.

## 7. Invoice Object Model Options

Option A: Directly invoice settlements

Pros:

- simple
- partly matches legacy implementation

Cons:

- weak line-item audit
- poor partial invoice support
- hard to support retainage, credits, rebills, disputes, or split invoice cycles
- bypasses settlement item invoice readiness

Option B: First-class invoices/items with Invoice-owned receivable state

Pros:

- line-item traceability
- customer-facing invoice lifecycle
- receivable tracking without a separate AR object
- simpler chain: `Invoice -> Cash Application`

Cons:

- requires invoice hardening and invoice item foundation
- future accounting integration may later require export mapping

Option C: First-class invoices/items plus separate AR

Pros:

- customer-facing billing layer
- supports invoice numbers, due dates, delivery, cash application readiness
- supports partial billing, retainage, credits, adjustments
- clean audit boundary
- accounting-style AR separation if future integration requires it

Cons:

- more objects
- requires migration and route hardening
- not the approved default path

Option D: Hybrid

Settlement summary plus invoice summary plus first-class invoices/items plus separate AR summaries.

Recommendation:

Use approved Option B: first-class `invoices` and `invoice_items`, with Invoice carrying receivable state. Keep settlement invoice readiness and future invoice linkage summary fields where useful. Do not create a separate AR object by default. Do not invoice directly from Billable.

## 8. Proposed Invoice Object

Future `invoices`:

- `id`
- `tenant_id`
- `invoice_number`
- `customer_organization_id`
- `project_id` nullable
- `settlement_id` nullable
- `invoice_type`
- `status`
- `approval_status`
- `delivery_status`
- `cash_application_status`
- `invoice_date`
- `due_date`
- `payment_terms`
- `billing_period_start` nullable
- `billing_period_end` nullable
- `subtotal_amount`
- `retainage_amount`
- `adjustment_amount`
- `tax_amount` nullable
- `fee_amount` nullable
- `total_amount`
- `original_amount`
- `paid_amount`
- `balance_amount`
- `aging_days`
- `payment_status`
- `collection_status`
- `last_payment_at` nullable
- `last_payment_amount` nullable
- `writeoff_amount` nullable
- `currency`
- `invoice_package_status`
- `documentation_status`
- `customer_acceptance_status`
- `prime_acceptance_status`
- `submitted_by` nullable
- `submitted_at` nullable
- `approved_by` nullable
- `approved_at` nullable
- `sent_by` nullable
- `sent_at` nullable
- `voided_by` nullable
- `voided_at` nullable
- `void_reason` nullable
- `disputed_by` nullable
- `disputed_at` nullable
- `dispute_reason` nullable
- `writeoff_reason` nullable
- `override_reasons` jsonb
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Invoice types:

- `standard`
- `progress`
- `final`
- `retainage_release`
- `credit_memo`
- `rebill`
- `adjustment`
- `pro_forma`

Current legacy mapping:

- `organization_id` should map to future `customer_organization_id`.
- `invoice_amount` and `total_amount` should map into subtotal/total/original/balance only after rules confirm amount semantics.
- Legacy `submitted` status should not be assumed equivalent to future `sent` or `ready_for_cash_application` because legacy submit creates AR.
- Legacy `ar_status`, `ready_for_ar`, and `ar_created_later` concepts are deprecated for the new Invoice contract.

Payment statuses:

- `unpaid`
- `partially_paid`
- `paid`
- `overpaid`
- `written_off`

Collection statuses:

- `not_due`
- `due`
- `overdue`
- `in_collection`
- `disputed`
- `resolved`
- `written_off`

Cash application statuses:

- `not_ready`
- `ready_for_cash_application`
- `partially_applied_later`
- `fully_applied_later`
- `overpaid_later`
- `written_off_later`

Receivable rules:

- `original_amount = total_amount` at invoice approval or sent state.
- `paid_amount` defaults to `0`.
- `balance_amount = original_amount - paid_amount`.
- `aging_days` is derived from `due_date` and current date when unpaid.
- `payment_status` and `collection_status` are updated by future Cash Application workflows.
- Invoice backend may calculate initial aging/payment state but must not create cash records.

## 9. Proposed Invoice Item Object

Future `invoice_items`:

- `id`
- `tenant_id`
- `invoice_id`
- `settlement_id`
- `settlement_item_id`
- `billable_item_id` nullable
- `qc_review_id` nullable
- `production_record_id` nullable
- `work_order_id` nullable
- `project_id` nullable
- `customer_organization_id`
- `item_type`
- `description`
- `quantity`
- `unit`
- `unit_rate`
- `gross_amount`
- `retainage_amount`
- `deduction_amount` nullable
- `adjustment_amount` nullable
- `tax_amount` nullable
- `fee_amount` nullable
- `net_amount`
- `status`
- `voided_by` nullable
- `voided_at` nullable
- `void_reason` nullable
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Item types:

- `customer_billable`
- `retainage_hold`
- `retainage_release`
- `deduction`
- `chargeback`
- `credit`
- `adjustment`
- `fee`
- `tax`
- `correction`

Rules:

- `invoice_items` must be tenant scoped.
- Source traceability must be copied from settlement item.
- Contractor payable settlement items are excluded from customer invoice item creation.
- Active duplicate invoice items for one settlement item are blocked unless split/credit/rebill workflow is approved.
- Invoice items do not create separate AR lines.
- Cash Application should apply payments at the invoice header level first.
- Item-level cash application may be added later if product approves that complexity.

## 10. Customer / Prime Invoice Model

Customer invoice asks:

“What amount are we formally billing the customer?”

Prime invoice asks:

“What amount are we formally billing the prime or program manager?”

Customer/prime invoice context should include:

- customer organization
- prime/customer acceptance status
- customer work order or PO/NTP where available
- billing period
- invoice cycle
- payment terms
- delivery method/status later
- invoice package status

Rules:

- Internal contractor payable items must not become customer invoice items.
- Customer and prime acceptance may block invoice approval or sending depending contract policy.
- The model should support prime/customer-specific invoice numbers and references later, but the first foundation should avoid external delivery integrations.

## 11. Invoice Numbering Model

Invoice number must be tenant unique.

Options:

- system-generated sequential number
- customer-specific prefix
- project-specific prefix
- manual invoice number with uniqueness check
- integration-generated number later

Recommendation:

- Generate a tenant-scoped `invoice_number` at invoice creation.
- Allow manual override only with explicit permission and uniqueness validation.
- Reserve invoice numbers at draft creation to avoid collision.

Required clarification:

- Should invoice numbers be gapless for accounting purposes? If yes, draft reservation may need stricter void/cancel semantics.

## 12. Invoice Approval Model

Invoice approval should verify:

- settlement approved or invoice ready
- settlement items are invoice ready
- invoice items exist
- customer organization present
- invoice number valid and tenant unique
- invoice date present
- due date present
- payment terms present
- invoice package/documentation ready or override supplied
- customer/prime acceptance acceptable or override supplied
- no customer dispute
- no voided source settlement items
- totals valid
- no duplicate active invoicing

Approval should require:

- `approval_note`
- override reasons when warnings exist

Role guidance:

- Billing Admin prepares invoices.
- Finance Manager approves invoices.
- Executive/System Admin can override.

Invoice approval should not create payment, cash, bank, payroll, tax, accounting export, or separate AR records.

## 13. Invoice Status Model

Proposed statuses:

- `draft`
- `assembling`
- `ready_for_review`
- `under_review`
- `approved`
- `sent`
- `partially_paid_later`
- `paid_later`
- `overdue_later`
- `disputed`
- `voided`
- `archived`

Definitions:

- `draft`: invoice shell created.
- `assembling`: items and package are being prepared.
- `ready_for_review`: invoice ready for approval.
- `under_review`: finance/customer billing review underway.
- `approved`: approved for sending.
- `sent`: delivered to customer/prime.
- `partially_paid_later`: future Cash Application status reflected on Invoice.
- `paid_later`: future Cash Application status reflected on Invoice.
- `overdue_later`: future collection status reflected on Invoice.
- `disputed`: customer/prime disputes invoice.
- `voided`: administrative void.
- `archived`: historical inactive.

Legacy status mapping:

- `draft` maps cleanly to future `draft`.
- `submitted` is ambiguous because it currently creates AR. It should not silently map to future `sent` or `ready_for_cash_application`.
- `overdue` belongs to future collections behavior and should be treated as `overdue_later`.
- `archived` maps to future `archived`.

Cash application statuses replace AR statuses:

- `not_ready`
- `ready_for_cash_application`
- `partially_applied_later`
- `fully_applied_later`
- `overpaid_later`
- `written_off_later`

## 14. Invoice Package / Documentation Model

Invoice readiness may require:

- settlement approval
- settlement items
- production evidence
- QC approval
- billable readiness
- customer acceptance
- billing package
- supporting documentation
- work order numbers
- PO/NTP
- rate support
- as-builts, test results, photos where applicable
- customer signoff

Invoice package statuses:

- `not_started`
- `incomplete`
- `ready`
- `attached`
- `submitted`
- `accepted`
- `rejected`

Rules:

- Invoice can exist before package is ready.
- Invoice approval/sending should require package ready unless override is approved.
- PDF package generation is future scope unless a safe existing document mechanism is confirmed.

## 15. Retainage and Retainage Release Model

Invoices may include:

- retainage held
- retainage released

Retainage scenarios:

- customer retains percentage
- retainage released after closeout
- retainage credit/adjustment
- retainage carried in settlement

Rules:

- Retainage hold reduces current invoice total but remains traceable.
- Retainage release invoice type can bill previously held retainage later.
- Invoice should preserve retainage amount from settlement items.
- Formal retainage ledger may belong to a later Finance or Cash Application sprint.

Recommended:

- Support invoice item types for `retainage_hold` and `retainage_release`.
- Defer formal retainage ledger until Finance or Cash Application rules are approved.

## 16. Credit Memo / Adjustment Model

Future correction capability:

- Credit memo: customer-facing negative invoice or credit.
- Adjustment: line-level amount correction.
- Rebill: replacement invoice after void/credit.

Rules:

- Credit memo should reference original invoice.
- Adjustment should reference original invoice item where applicable.
- Voided invoices remain audit-visible.
- Do not implement credit/rebill workflow until backend rules are approved.

Recommended:

- Support `invoice_type` values now.
- Defer full credit memo/rebill workflow.
- Do not allow ad hoc negative invoice items unless product confirms credit memo handling.

## 17. Ready For Cash Application

Replace “mark ready for AR” with “mark ready for cash application.”

Future route recommendation:

`POST /invoices/:id/mark-ready-for-cash-application`

Required:

- `ready_note`

Validation:

- invoice approved or sent
- `total_amount > 0`
- customer organization exists
- `due_date` exists
- invoice is not voided or archived
- no hard dispute blocker unless override is approved

On success:

- `cash_application_status = ready_for_cash_application`

This action creates no payment record, cash receipt, bank transaction, ACH, card payment, payroll, tax, accounting export, or separate AR record.

Legacy `ar_records` note:

Existing `ar_records` are legacy/deprecated for the new Invoice contract. If the table remains for compatibility with old tests or historical records, new Invoice Backend Foundation smoke tests must prove invoice submit/review/approve/sent/ready-for-cash-application creates zero `ar_records`.

## 18. Cash Application Relationship

Cash Application later consumes invoices with:

`cash_application_status = ready_for_cash_application`

Cash Application will:

- record payment events
- apply payments to invoice balance
- update `paid_amount`
- update `balance_amount`
- update `payment_status`
- update `collection_status`
- update `last_payment_at`
- update `last_payment_amount`

Cash Application must be a future rules clarification and backend sprint. Invoice Backend Foundation should only prepare the invoice to receive payments later.

## 19. Collections Relationship

Collection status should be derived from:

- due date
- balance amount
- payment status
- dispute status

Initial rules:

- `not_due` when due date is in the future and invoice is unpaid.
- `due` when due date is today or recent and invoice is unpaid.
- `overdue` when due date has passed and balance is greater than zero.
- `disputed` when invoice is disputed.
- `written_off` when a future write-off workflow applies.

Collections workflow is future scope.

## 20. Cash / Payment Boundary

Invoice must not create:

- cash receipt
- payment application
- deposit
- bank transaction
- ACH
- card payment
- check record
- accounting export

Cash Application belongs later.

Payment records and reconciliation already exist as legacy downstream behavior, but they must not be triggered from Invoice in the next Invoice Backend Foundation.

## 21. Contractor Payable / Payroll Boundary

Invoice is customer-facing.

Contractor payables and payroll should come from settlement payable readiness, not from customer invoice directly.

Invoice must not create:

- payroll
- contractor payment
- ACH payout
- card payout
- bank transaction

## 22. Permissions / Roles

Current invoice permissions:

- `invoice.read`
- `invoice.create`
- `invoice.update`
- `invoice.submit`
- `invoice.mark_overdue`
- `invoice.archive`

Proposed invoice permissions:

- `invoice.read`
- `invoice.create`
- `invoice.update`
- `invoice.add_item`
- `invoice.remove_item`
- `invoice.recalculate_totals`
- `invoice.submit_review`
- `invoice.approve`
- `invoice.reject`
- `invoice.mark_sent`
- `invoice.mark_ready_for_cash_application`
- `invoice.dispute`
- `invoice.resolve_dispute`
- `invoice.void`
- `invoice.archive`
- `invoice.timeline.read`
- `invoice.audit.read`

Invoice item:

- `invoice_item.read`
- `invoice_item.create`
- `invoice_item.update`
- `invoice_item.void`
- `invoice_item.archive`

Role guidance:

- Billing Admin: create/update invoice shell, add items, prepare package.
- Finance Manager: approve/reject, mark ready for cash application.
- Billing Manager: mark sent where delivery is manual.
- Operations Manager: review operational disputes.
- Executive/System Admin: override authority.

Required clarification:

- Existing `invoice.submit` currently creates AR. Product must decide whether to deprecate it, remap it to `invoice.submit_review`, or keep it as legacy-only and excluded from the new Invoice contract.

## 23. Events and Audit Requirements

Proposed invoice events:

- `invoice.created`
- `invoice.updated`
- `invoice.item_added`
- `invoice.item_removed`
- `invoice.totals_recalculated`
- `invoice.review_submitted`
- `invoice.approved`
- `invoice.rejected`
- `invoice.sent`
- `invoice.ready_for_cash_application`
- `invoice.disputed`
- `invoice.dispute_resolved`
- `invoice.voided`
- `invoice.archived`

Invoice item events:

- `invoice_item.created`
- `invoice_item.updated`
- `invoice_item.voided`
- `invoice_item.archived`

Every write must create:

- event
- event payload
- audit log
- system action

Audit must capture:

- actor
- timestamp
- tenant
- invoice id
- invoice item id where applicable
- settlement id
- settlement item id
- customer organization id
- project/work order/source traceability
- status before/after
- approval/delivery/cash application status before/after
- original amount, paid amount, balance amount, aging days, payment status, and collection status
- quantities and amounts
- retainage/adjustment/tax/fee values
- package/documentation/acceptance status
- reasons/notes/override reasons
- correlation id

## 24. Recommended Next Coding Sprint

Recommended next coding sprint:

Invoice Backend Contract Foundation - Option B

Build:

- harden `invoices`
- create first-class `invoice_items`
- create invoice shell
- add invoice items from invoice-ready settlement items
- list/detail endpoints
- totals calculation
- `original_amount`
- `paid_amount`
- `balance_amount`
- `aging_days`
- `payment_status`
- `collection_status`
- `cash_application_status`
- submit review
- approve/reject
- mark sent
- mark ready for cash application
- dispute/resolve
- void/archive
- invoice item void/archive
- timeline/audit endpoints
- search support for invoices and invoice items
- invoice smoke test
- release validation wiring

Do not build:

- separate AR object
- payment application
- cash receipts
- bank transactions
- payroll
- tax accounting
- accounting exports
- payment processor integrations
- actual invoice delivery integrations
- customer portal
- PDF invoice package generation unless already safe and explicitly approved

Critical implementation note:

The next backend sprint must either remove, replace, or isolate the legacy `POST /invoices/:id/submit` behavior because it currently creates `ar_records`. Under Option B, Invoice carries receivable state and must not create separate AR rows.

## 25. Required Confirmations

Product must confirm:

1. Confirm Invoice carries receivable state and no separate AR object will be built by default.

2. Confirm `ar_records` are legacy/deprecated for the new Invoice contract.

3. Confirm invoice approval does not create payment/cash/bank records.

4. Confirm invoice sent does not create payment/cash/bank records.

5. Confirm `ready_for_cash_application` replaces `ready_for_ar`.

6. Confirm Cash Application will update invoice paid/balance/payment status later.

7. Confirm invoice header-level cash application first, item-level application later.

8. Confirm invoice balance fields are owned by Invoice.

9. Confirm collection status lives on Invoice.

10. Confirm Collections is future scope.

11. Should Invoice be first-class `invoices` plus `invoice_items`?

12. Should Invoice consume only invoice-ready `settlement_items`?

13. Can one settlement create multiple invoices?

14. Can one invoice include items from multiple settlements?

15. Should invoice numbers be generated at draft creation?

16. Should manual invoice numbers be allowed?

17. Should invoice numbers be gapless or only tenant-unique?

18. Should existing `invoice.submit` be deprecated, renamed, or changed to stop creating AR?

19. Should invoice delivery be modeled now but integrations deferred?

20. Should invoice package/PDF generation be deferred?

21. Should credit memo workflow be included now or later?

22. Should retainage release invoice type be supported now?

23. Should invoice item quantity be allowed to differ from settlement item quantity?

24. Should duplicate invoice items for one settlement item be blocked unless credit/rebill/split is approved?

25. Who can approve invoices?

26. Who can mark invoices sent?

27. Who can mark ready for cash application?

28. Should voided invoices reverse settlement or settlement item `invoice_created_later` flags?

29. Should invoices become immutable after sent?

30. Should invoice package readiness be required before approval or before sent?

31. Should customer/prime acceptance be required before invoice creation, approval, or sending?

Recommended answers:

- Yes, use first-class `invoices` and `invoice_items`.
- Consume invoice-ready settlement items.
- Allow one invoice to include multiple settlement items.
- Allow one settlement to produce multiple invoices only through explicit split logic.
- Generate invoice number at creation.
- Allow manual invoice number only with permission and uniqueness validation.
- Do not build a separate AR object by default.
- Change/replace legacy `invoice.submit` so Invoice does not create AR rows in the Invoice Backend Foundation.
- Use `ready_for_cash_application`.
- Cash Application later updates Invoice paid/balance/payment/collection fields.
- Defer delivery integration and PDF generation.
- Support `invoice_type` values now but defer full credit memo workflow.
- Support retainage hold/release item types, but defer formal retainage ledger.

## 26. GO / NO-GO Recommendation

Recommendation: GO for Invoice Backend Contract Foundation - Option B.

Rationale:

- Settlement Backend and Settlement Workspace now establish invoice readiness without creating invoice/payment/cash records.
- Legacy invoice support exists but is not sufficient for the approved chain because it has no invoice item model and currently creates AR on submit.
- First-class invoices and invoice items are required before Invoice Workspace, Cash Application, Collections, customer portal, or accounting export workflows.
- Invoice must carry receivable state directly through original, paid, balance, aging, payment status, collection status, and cash application status fields.

NO-GO for Invoice Workspace UI, Cash Application, Payment Application, Collections, Payroll, Tax, Accounting export, and a separate AR Backend sprint unless a future accounting need appears.
