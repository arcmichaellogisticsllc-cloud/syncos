# Cash Application Rules Clarification

Current validated commit: `332ffab45c15303a9ad9dd9babbef0779deea453`

This is a rules clarification document only. It defines Cash Application before any Cash Application backend, Cash Workspace, payment posting, bank reconciliation, collections automation, accounting export, payroll, tax, ACH/card payout, or customer portal workflow is built.

Approved financial chain:

Billable -> Settlement -> Invoice -> Cash Application

Invoice answers:

> What formal demand for payment was issued, and what is still owed?

Cash Application answers:

> What money was received, where did it come from, and how should it be applied to invoice balances?

Invoice owns receivable state. Cash Application updates invoice receivable state through audited payment application logic.

Cash Application is not invoice creation, settlement approval, contractor payment, payroll, tax accounting, bank reconciliation, accounting export, or customer portal payment processing.

## 1. Current Backend Inventory

Inspection scope:

- `apps/api/src/routes/cash.controller.ts`
- `apps/api/src/routes/search.controller.ts`
- `apps/api/src/routes/reports.controller.ts`
- `packages/database/migrations/010_contracts_rates_settlements_invoices_payments.sql`
- `packages/database/migrations/032_settlement_contract_foundation.sql`
- `packages/database/migrations/033_invoice_contract_foundation.sql`
- `packages/database/scripts/seed.js`
- `apps/api/scripts/invoice-smoke.js`
- `apps/api/scripts/sprint8-smoke.js`
- `scripts/release-validation.sh`
- `docs/product/invoice-rules-clarification.md`
- `docs/product/invoice-backend-contract.md`
- `docs/product/invoice-workspace-product-contract.md`
- `docs/product/invoice-physical-test.md`

Inventory classification:

| Area | Current State | Classification | Notes |
| --- | --- | --- | --- |
| `invoices` table | Existing legacy table hardened by migration `033_invoice_contract_foundation.sql`. | Supported | Includes invoice status, approval, delivery, receivable, cash application, package, acceptance, dispute, void/archive, and audit fields. |
| `invoice_items` table | Created by migration `033_invoice_contract_foundation.sql`. | Supported | Sourced from settlement items and preserves settlement, billable, QC, production, work order, project, and customer traceability. |
| Invoice receivable fields | `original_amount`, `paid_amount`, `balance_amount`, `aging_days`, `payment_status`, `collection_status`, `cash_application_status`, `last_payment_at`, `last_payment_amount`, `writeoff_amount`, `writeoff_reason`. | Supported | Fields exist on `invoices`. Current backend initializes and recalculates invoice-owned receivable state, but no Cash Application object updates them yet. |
| Invoice routes | `GET/POST/PATCH /invoices`, detail, totals, review, approve, reject, sent, ready for cash application, dispute, void/archive, timeline, audit. | Supported | Implemented in `cash.controller.ts`. Legacy `POST /invoices/:id/submit` now maps to review and creates no AR. |
| Invoice item routes | `GET /invoices/:id/items`, `POST /invoices/:id/items`, `GET /invoice-items/:id`, detail, void, archive. | Supported | Implemented in `cash.controller.ts`. |
| Legacy `ar_records` table | Created in migration `010_contracts_rates_settlements_invoices_payments.sql`. | Partially supported / legacy | Routes still exist for list/get/archive. New Invoice Option B contract does not create AR rows. |
| Legacy `ar_records` routes | `GET /ar-records`, `GET /ar-records/:id`, `POST /ar-records/:id/archive`. | Partially supported / legacy | Permission protected with `ar.read` and `ar.archive`; should remain deprecated for the new Invoice/Cash chain unless future accounting integration requires AR. |
| `payments` table | Created in migration `010_contracts_rates_settlements_invoices_payments.sql`. | Partially supported / legacy | Generic payment record linked to invoice and settlement. Does not represent the recommended Cash Application model. |
| Payment routes | `GET /payments`, `GET /payments/:id`, `POST /payments`, `PATCH /payments/:id`, `POST /payments/:id/reconcile`, `POST /payments/:id/archive`. | Partially supported / legacy | `payment.reconcile` updates `ar_records` and customer payment stats, not invoice receivable state. This is incompatible with Option B Cash Application as the default path. |
| `cash.controller.ts` | Contains invoice, invoice item, legacy AR, and legacy payment routes. | Partially supported | Current name is broad, but first-class Cash Application objects are missing. |
| Reports controller finance stats | `reports/billing-completeness` reports billing completeness. | Partially supported | No Cash Application report, unapplied cash report, or receivable aging report from invoice balances yet. |
| Settlements | `settlements` and `settlement_items` are first-class and support invoice readiness. | Supported | Settlement feeds invoice; Cash Application should not mutate settlement amounts. |
| Retainage fields/tables | Retainage exists on settlement, settlement item, invoice, and invoice item fields. No formal retainage ledger found. | Partially supported | Retainage can be represented on invoice lines; retainage payment application rules are not implemented. |
| Writeoff fields | `writeoff_amount` and `writeoff_reason` exist on invoices. | Partially supported | No governed writeoff workflow exists. |
| Customer payment stats | `customer_payment_stats` exists in migration `010`; legacy payment reconciliation updates it. | Partially supported / legacy | New Cash Application rules should decide whether and when to update this from payment applications. |
| Bank/deposit/reconciliation tables | No first-class bank transaction, deposit batch, or reconciliation table found. Legacy payment has `reconciled_at`; proposed deposit/reconciliation statuses do not exist. | Missing | Bank reconciliation must be future scope. |
| Accounting export routes/tables | No accounting export table found. | Missing | Accounting export must be future scope. |
| Payment processor integrations | No processor integration table found. `invoice:smoke` asserts forbidden processor/cash tables are absent. | Missing | Processor integrations must be future scope. |
| Invoice permissions | Invoice and invoice item permissions are seeded. | Supported | Includes `invoice.mark_ready_for_cash_application`. |
| Cash/payment permissions | Legacy `payment.*` permissions are seeded. No `cash_receipt.*` or `payment_application.*` permissions found. | Partially supported / missing | New Cash Application requires new permissions. |
| Events | Invoice and invoice item events are supported. Legacy payment events exist. | Partially supported | No `cash_receipt.*`, `payment_application.*`, or invoice balance-update events exist yet. |
| Audit behavior | Writes use `executeWriteAction`, creating event, event payload, audit log, and system action. | Supported | New Cash Application writes must use the same helper. |
| Search support | Search includes invoices, invoice items, and legacy payments. | Partially supported | No cash receipt or payment application search support exists. |
| Smoke tests | `invoice:smoke` exists and validates no AR/payment creation from invoice actions. Release validation includes it. | Supported for invoice / missing for cash | No `cash-application:smoke` exists. |

Special focus recommendation:

- Option A, direct updates to invoice paid/balance fields only, is not sufficient because it lacks payment truth, unapplied cash, multi-invoice allocation, and strong audit separation.
- Option B, first-class `cash_receipts` and `payment_applications`, provides the needed payment truth but must retain invoice receivable summaries.
- Option C, generic `payments` table only, is not recommended because the existing table mixes receipt and reconciliation behavior and still points at legacy AR.
- Option D is recommended: invoices retain receivable summary fields, while first-class `cash_receipts` and `payment_applications` store receipt and allocation truth.

## 2. Cash Application Definition

Cash Application is a controlled financial process that records received money and applies it against invoice balances.

Cash Application represents:

- payment received
- customer / payer
- payment date
- payment method
- payment reference
- gross received amount
- applied amount
- unapplied amount
- invoice application
- partial payment
- overpayment
- short payment
- write-off candidate later
- payment evidence/reference
- payment status
- audit trail

Cash Application does not represent:

- invoice creation
- settlement approval
- contractor payout
- payroll
- bank reconciliation
- tax filing
- accounting export
- payment processor settlement
- ACH/card payout

## 3. Cash Application Relationship To Invoice

Cash Application consumes invoices with:

- `cash_application_status = ready_for_cash_application`
- `original_amount`
- `paid_amount`
- `balance_amount`
- `payment_status`
- `collection_status`
- `due_date`
- customer organization

Cash Application updates invoice receivable fields:

- `paid_amount`
- `balance_amount`
- `payment_status`
- `collection_status`
- `cash_application_status`
- `last_payment_at`
- `last_payment_amount`
- `aging_days`

Rules:

- Applied payment cannot exceed invoice balance unless overpayment handling is explicit.
- Full payment sets `balance_amount = 0`.
- Partial payment reduces balance and leaves invoice open.
- Overpayment creates unapplied cash or an explicit overpayment state.
- Disputed invoices may accept payment only with warning/override.
- Voided or archived invoices cannot receive payment.
- Payments must be auditable.
- Reversal must be future governed workflow unless explicitly approved in Cash Application Backend Foundation.

## 4. Cash Receipt Model

Recommended future object: `cash_receipts`.

Fields:

- `id`
- `tenant_id`
- `receipt_number`
- `customer_organization_id` nullable
- `payer_name` nullable
- `payment_date`
- `received_at`
- `payment_method`
- `payment_reference` nullable
- `external_transaction_id` nullable
- `gross_received_amount`
- `applied_amount`
- `unapplied_amount`
- `currency`
- `receipt_status`
- `deposit_status`
- `reconciliation_status`
- `source_type`
- `notes` nullable
- `evidence_reference` nullable
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

Payment methods:

- `ach`
- `wire`
- `check`
- `card`
- `cash`
- `lockbox`
- `portal`
- `zelle`
- `other`

Receipt statuses:

- `received`
- `partially_applied`
- `fully_applied`
- `unapplied`
- `overapplied`
- `voided`
- `archived`

Deposit statuses:

- `not_deposited`
- `deposited_later`
- `pending_later`
- `reconciled_later`

Reconciliation statuses:

- `not_reconciled`
- `pending_later`
- `reconciled_later`
- `exception_later`

Source types:

- `manual`
- `bank_import_later`
- `processor_import_later`
- `customer_portal_later`
- `accounting_import_later`

Receipt numbering rules:

- `receipt_number` is tenant-unique.
- Generate at receipt creation.
- Manual receipt/reference belongs in `payment_reference`, not the primary receipt number.
- Receipt numbers must not be reused after void/archive.
- Suggested format: `RCPT-{tenantScopedSequence}`.

Future creation route:

`POST /cash-receipts`

Required:

- `gross_received_amount`
- `payment_date`
- `payment_method`

Optional:

- `customer_organization_id`
- `payer_name`
- `payment_reference`
- `external_transaction_id`
- `currency`
- `source_type`
- `evidence_reference`
- `notes`

Validation:

- Actor has `cash_receipt.create`.
- Amount is greater than zero.
- Customer belongs to tenant if supplied.
- Payment method is approved.
- Receipt number is generated.
- `applied_amount` defaults to `0`.
- `unapplied_amount` defaults to `gross_received_amount`.
- Status defaults to `unapplied` or `received`; product must confirm exact default.
- Receipt creation alone does not update invoice balances unless a create-and-apply route is explicitly approved.

## 5. Payment Application Model

Recommended future object: `payment_applications`.

Fields:

- `id`
- `tenant_id`
- `cash_receipt_id`
- `invoice_id`
- `customer_organization_id`
- `applied_amount`
- `application_date`
- `application_status`
- `application_type`
- `note` nullable
- `writeoff_amount` nullable
- `discount_amount` nullable
- `adjustment_amount` nullable
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

Application statuses:

- `applied`
- `partially_applied`
- `reversed_later`
- `voided`
- `archived`

Application types:

- `standard_payment`
- `partial_payment`
- `overpayment_application`
- `retainage_payment`
- `discount`
- `writeoff_later`
- `adjustment`
- `correction`

Future application route:

`POST /cash-receipts/:id/apply`

Required:

- `invoice_id`
- `applied_amount`

Optional:

- `application_type`
- `note`
- `override_reasons`

Validation:

- Actor has `payment_application.create` or `cash_receipt.apply`.
- Receipt belongs to tenant.
- Invoice belongs to tenant.
- Invoice customer matches receipt customer if receipt customer is supplied, unless override is approved.
- Invoice is not voided or archived.
- Invoice `cash_application_status` is `ready_for_cash_application` unless override is approved.
- `applied_amount > 0`.
- `applied_amount <= receipt.unapplied_amount` unless overapplication is explicitly allowed.
- `applied_amount <= invoice.balance_amount` unless overpayment handling is supplied.
- Disputed invoice requires warning/override.

On application:

- Create `payment_application`.
- Increase `cash_receipt.applied_amount`.
- Decrease `cash_receipt.unapplied_amount`.
- Increase `invoice.paid_amount`.
- Decrease `invoice.balance_amount`.
- Set `invoice.last_payment_at`.
- Set `invoice.last_payment_amount`.
- Recalculate `invoice.payment_status`.
- Recalculate `invoice.collection_status`.
- Recalculate `invoice.cash_application_status`.
- Create event, event payload, audit log, and system action.

Do not create bank transaction, payroll, contractor payment, tax filing, or accounting export.

## 6. Partial Payment Model

Partial payment occurs when:

`applied_amount < invoice.balance_amount`

Invoice updates:

- `paid_amount += applied_amount`
- `balance_amount` remains greater than zero
- `payment_status = partially_paid`
- `collection_status` remains based on due date and dispute state
- `cash_application_status = partially_applied_later`
- `last_payment_at` and `last_payment_amount` update

Rules:

- Partial payment is allowed.
- Partial payment does not close invoice.
- Partial payment is auditable.
- Partial payment does not create a write-off, deduction, credit memo, or collection closure automatically.

## 7. Overpayment Model

Overpayment can happen when:

- receipt amount exceeds invoice balance
- customer pays a duplicate invoice
- customer pays a round amount covering multiple invoices
- customer pays retainage plus current invoice

Options:

- Option A: leave excess as unapplied cash on receipt.
- Option B: apply excess and mark invoice overpaid.
- Option C: create customer credit later.

Recommended first implementation:

- Leave excess as unapplied cash.
- Do not mark invoice overpaid unless explicitly applied as overpayment.
- Do not create credit memo automatically.
- Do not create refund workflow in the first Cash Application sprint.

## 8. Short Payment Model

Short payment occurs when customer pays less than invoice balance and may indicate:

- partial payment
- dispute
- deduction
- retainage hold
- customer short-pay
- billing error

Rules:

- Short payment is partial payment by default.
- Do not write off automatically.
- Do not create deduction automatically.
- User may mark collection/dispute later through approved workflows.
- Short payment should preserve payment application traceability.

## 9. Unapplied Cash Model

Unapplied cash is received money not yet allocated.

Rules:

- Track `unapplied_amount` on `cash_receipts`.
- Unapplied cash is not revenue recognition by itself.
- Unapplied cash can later be applied to invoice, refunded, reclassified, or written off.
- Refund, reclassification, and write-off workflows are future scope.
- Unapplied cash must be tenant scoped and auditable.

## 10. Credit / Adjustment Relationship

Credits and adjustments may affect invoice balance.

Options:

- invoice adjustment item
- credit memo invoice
- payment application adjustment type
- write-off workflow

Recommended:

- Do not implement credit or write-off automation in the first Cash Application sprint.
- Allow `application_type` values for future compatibility.
- Use explicit future rules for credit memo, adjustment, refund, and write-off workflows.

## 11. Retainage Payment Relationship

Retainage payment may come later than the original invoice.

Rules:

- Retainage payments are cash receipts like other payments.
- `application_type` can be `retainage_payment`.
- A retainage release invoice may receive retainage payment.
- No retainage ledger should be created in the first cash sprint unless already approved.
- Retainage balance reporting can derive from invoices and settlements later.

## 12. Dispute / Collection Relationship

Cash Application may affect collection status.

Rules:

- Payment on a disputed invoice must not automatically resolve dispute unless user confirms through an approved override.
- If full payment resolves the business issue, collection status may become `resolved`, but dispute audit history remains.
- Collection status should update from balance, due date, payment status, and dispute state.
- Collections automation is future scope.
- Payment may reduce aging risk but must not erase audit history.

## 13. Bank Deposit / Reconciliation Boundary

Cash Application does not equal bank reconciliation.

Cash receipt may store:

- `payment_reference`
- `external_transaction_id`
- `evidence_reference`
- `deposit_status`
- `reconciliation_status`

Cash Application must not create:

- bank transaction
- deposit batch
- reconciliation record
- bank ledger entry

Deposit and reconciliation statuses are future-ready fields only. Bank reconciliation should be a separate future rules and backend sprint.

## 14. Payment Processor Boundary

Cash Application does not process payments.

It records and applies payments already received or imported.

Cash Application must not create:

- card charge
- ACH debit
- payment link
- payment gateway capture
- processor settlement
- refund to card

Processor integrations are future scope.

## 15. Contractor Payable / Payroll Boundary

Cash received from a customer does not automatically pay contractors.

Cash Application must not create:

- contractor payment
- payroll
- ACH payout
- card payout
- payable ledger

Contractor payables remain a separate future workflow sourced from Settlement payable readiness, not from customer cash receipt.

## 16. Tax / Accounting Export Boundary

Cash Application must not create:

- tax filing
- accounting export
- general ledger posting
- journal entry
- QuickBooks export

Accounting export and tax workflows are future scope.

## 17. Permissions / Roles

Proposed cash receipt permissions:

- `cash_receipt.read`
- `cash_receipt.create`
- `cash_receipt.update`
- `cash_receipt.apply`
- `cash_receipt.void`
- `cash_receipt.archive`
- `cash_receipt.timeline.read`
- `cash_receipt.audit.read`

Proposed payment application permissions:

- `payment_application.read`
- `payment_application.create`
- `payment_application.void`
- `payment_application.archive`

Proposed invoice receivable permissions:

- `invoice.cash_application.read`
- `invoice.cash_application.update`

Role guidance:

- Billing Admin can create and apply receipts.
- Finance Manager can void/reverse payment applications and receipts.
- Executive/System Admin can override.
- Project/Ops roles can view where permitted.

Existing permissions to distinguish from new contract:

- Legacy `payment.read`, `payment.create`, `payment.update`, `payment.reconcile`, `payment.archive`, and `payment.record` exist.
- Legacy `ar.read` and `ar.archive` exist.
- These should not be treated as the new Cash Application permission model unless product explicitly approves migration or aliasing.

## 18. Events and Audit Requirements

Proposed cash receipt events:

- `cash_receipt.created`
- `cash_receipt.updated`
- `cash_receipt.applied`
- `cash_receipt.voided`
- `cash_receipt.archived`

Proposed payment application events:

- `payment_application.created`
- `payment_application.voided`
- `payment_application.archived`

Proposed invoice update events:

- `invoice.payment_applied`
- `invoice.balance_updated`
- `invoice.payment_status_changed`
- `invoice.collection_status_changed`

Every write must create:

- event
- event payload
- audit log
- system action

using the established write-action helper.

Audit must capture:

- actor
- tenant
- `cash_receipt_id`
- `payment_application_id`
- `invoice_id`
- `customer_organization_id`
- gross received amount
- applied amount
- unapplied amount
- invoice original amount
- invoice paid amount before/after
- invoice balance before/after
- payment status before/after
- collection status before/after
- payment method
- payment reference
- external transaction id
- override reasons
- correlation id
- timestamp

## 19. Recommended Next Coding Sprint

Recommended next coding sprint:

Cash Application Backend Contract Foundation

Build:

- `cash_receipts`
- `payment_applications`
- create receipt
- apply receipt to invoice
- list/detail endpoints
- invoice balance update through audited logic
- partial payment
- full payment
- unapplied cash
- overpayment as unapplied cash
- void/archive receipt
- void/archive application if safe
- timeline/audit
- search
- smoke test
- release validation wiring

Do not build:

- Bank reconciliation
- Processor integration
- Payment collection
- Payment gateway
- Refunds
- Payroll
- Contractor payout
- Tax
- Accounting export
- Collections automation
- Customer portal

## 20. Required Confirmations

Product confirmations required before coding:

1. Should Cash Application use first-class `cash_receipts` and `payment_applications`?
2. Should Invoice keep receivable summaries while `payment_applications` store payment history?
3. Should overpayments remain unapplied cash by default?
4. Should one payment be applicable to multiple invoices?
5. Should payments be allowed on disputed invoices with warning/override?
6. Should payments be allowed on invoices not yet `ready_for_cash_application`?
7. Should full payment automatically set `collection_status = resolved`?
8. Should partial payment leave `collection_status` based on due date?
9. Should payment application be invoice-header-level first, item-level later?
10. Should cash receipt creation alone update invoice balances? Recommended: no.
11. Should voiding a payment application reverse invoice paid/balance amounts?
12. Should cash receipt void be blocked if applications exist?
13. Should refunds be deferred?
14. Should write-offs be deferred?
15. Should bank reconciliation be deferred?
16. Should processor integrations be deferred?
17. Who can apply payments?
18. Who can void/reverse payment applications?
19. Should Cash Application create any contractor payable/payroll event? Recommended: no.
20. Should accounting export be deferred?
21. Should legacy `payments` routes be deprecated, replaced, or isolated from the new Cash Application contract?
22. Should legacy `payment.reconcile` stop updating `ar_records` for new Cash Application flows?
23. Should `customer_payment_stats` be updated by payment applications in the first sprint or deferred?
24. Should receipt default status be `received` or `unapplied`?
25. Should deposit/reconciliation statuses be stored now as future-ready fields?

Recommended answers:

- Yes, use first-class `cash_receipts` and `payment_applications`.
- Invoice keeps receivable summaries.
- Payment applications store payment history.
- Overpayment stays unapplied cash by default.
- One receipt may apply to multiple invoices.
- Cash receipt creation alone does not update invoices.
- Payment application updates invoice balances.
- Full payment sets `collection_status = resolved`.
- Payment application should be invoice-header-level first, item-level later.
- Refunds, write-offs, bank reconciliation, processor integrations, payroll, tax, and accounting export are deferred.
- Legacy `payments` and `ar_records` should be isolated from new Cash Application flows unless a migration plan is approved.

## 21. GO / NO-GO Recommendation

GO:

- Cash Application Backend Contract Foundation using hybrid Option D.
- First-class `cash_receipts`.
- First-class `payment_applications`.
- Invoice receivable summary updates through audited payment application logic.
- Partial/full payment.
- Unapplied cash.
- Overpayment as unapplied cash.
- Timeline, audit, permissions, search, and smoke coverage.

NO-GO:

- Cash Workspace UI.
- Bank reconciliation.
- Processor integrations.
- Payment gateway.
- Refunds.
- Payroll.
- Contractor payout.
- Tax.
- Accounting export.
- Collections automation.
- Customer portal.
- New separate AR object.
- Using legacy `payment.reconcile` / `ar_records` as the default Cash Application path.

## Validation

Non-mutating validation for this clarification sprint:

- `git status --short`
- inspected invoice/cash/payment routes
- inspected migrations
- inspected permissions/events
- inspected smokes
- inspected docs
- `git diff --check`

No application code changes, migrations, routes, UI, or tests are required for this clarification sprint.
