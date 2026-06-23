# Bank Reconciliation Rules Clarification

Current validated commit: `e099800b495411834da7d96d82af018d58439cf5`

This is a rules clarification document only. No code, migrations, routes, UI, or backend objects are implemented in this sprint.

## 1. Current Backend Inventory

| Area | Current state | Classification | Notes |
| --- | --- | --- | --- |
| `payment_batches` | First-class table, routes, lifecycle, timeline, audit, search, smoke coverage. | Supported | Stores outbound payment intent, approval, schedule, status-only submission, status-only executed-later outcome, failure, cancel, void, archive. |
| `payment_items` | First-class payment instruction table sourced from contractor payables or payroll items. | Supported | Stores source references, payee, method, amount, execution status/reference/failure. No bank-cleared proof. |
| Payment execution status fields | `payment_batches.execution_status`, `payment_items.execution_status`, `execution_reference`, `submitted_at`, `executed_at`, `failure_reason`. | Supported for intent/status | `executed_later` is explicitly status-only and not bank-cleared. |
| `contractor_payables` | First-class payable obligation layer through payment readiness. | Supported | Payment Execution consumes `payment_ready` payables. Bank Reconciliation should use payables only as source context through payment items. |
| `payroll_runs` | First-class payroll readiness layer through `payroll_ready`. | Supported | Payment Execution consumes payroll-ready runs/items. Bank Reconciliation should use payroll only as source context through payment items. |
| `cash_receipts` | First-class inbound cash receipt table/routes. | Supported | Includes `deposit_status` and `reconciliation_status` placeholders: `not_deposited`, `deposited_later`, `pending_later`, `reconciled_later`; `not_reconciled`, `pending_later`, `reconciled_later`, `exception_later`. |
| `payment_applications` | First-class cash-to-invoice allocation table/routes. | Supported | Updates invoice receivable fields through Cash Application. Should remain allocation context, not bank truth. |
| `invoices` | First-class receivable state with `paid_amount`, `balance_amount`, `payment_status`, `cash_application_status`, and `collection_status`. | Supported | Bank Reconciliation must not directly update invoice balance. |
| Legacy `payments` table/routes | Legacy `payments` table exists with `status`, `payment_reference`, and `reconciled_at`; search includes it. | Partially supported / unsafe to infer | Legacy finance compatibility object. Do not reuse for new bank reconciliation without explicit deprecation/migration decision. |
| Legacy `ar_records` | Legacy AR table exists and smoke tests guard against new workflows creating it. | Partially supported / unsafe to infer | Invoice now owns receivable state; AR records remain compatibility artifacts. |
| Bank account tables | No `bank_accounts` table found. | Missing | Required for durable bank account context. |
| Bank transaction tables | No `bank_transactions` table found. | Missing | Required for actual bank truth. |
| Deposit/reconciliation fields | Cash receipts include deposit/reconciliation status placeholders. Payment Execution does not include reconciliation fields. | Partially supported | No durable bank transaction or match object exists. |
| Cash receipt deposit/reconciliation routes | Cash Application can create/update receipts and applications, but there is no bank match route. | Missing | Existing status fields are not governed by bank transaction matching. |
| Payment execution `executed_later` | Supported status on payment batches/items. | Supported for candidate matching | Candidate for reconciliation only; not proof of bank clearing. |
| Payment batch/item `execution_reference` | Supported. | Partially supported | Useful for matching, but not a bank reference guarantee. |
| Reports controller | Compliance, billing completeness, and constraints reports exist. | Partially supported | No cash close, bank reconciliation, or exceptions report exists. |
| Search support | Search includes payment batches/items, cash receipts, payment applications, invoices, contractor payables, payroll, and legacy payments. | Partially supported | No bank accounts, bank transactions, or reconciliation matches search because objects do not exist. |
| Permissions | Payment Execution, Cash Application, Invoice, Contractor Payable, Payroll, and legacy payment permissions exist. | Partially supported | No `bank_account.*`, `bank_transaction.*`, or `reconciliation_match.*` permissions exist. |
| Events | Write-action helper creates events, payloads, audit logs, and system actions. Payment Execution and Cash Application events exist. | Supported pattern | Bank reconciliation events are missing. |
| Audit behavior | Timeline/audit endpoints exist for current finance objects. | Supported pattern | Bank transaction/match audit endpoints are missing. |
| Smoke tests | Payment Execution and Cash Application smokes validate no bank/reconciliation side effects. | Supported for existing boundaries | No bank reconciliation smoke exists. |
| Payment Execution docs | Backend/workspace/rules docs explicitly defer bank reconciliation. | Supported | Current docs say mark executed does not prove bank clearing. |
| Cash Application docs | Backend/workspace/rules docs explicitly defer bank reconciliation/deposits. | Supported | Current docs say Cash Application creates no bank transaction or reconciliation records. |
| Invoice docs | Invoice owns receivable state; Cash Application updates invoice paid/balance fields. | Supported | Bank Reconciliation should not bypass Cash Application. |
| Contractor Payable docs | Payment readiness stops before Payment Execution. | Supported | Bank reconciliation is downstream of Payment Execution, not payable approval. |
| Payroll docs | Payroll readiness stops before Payment Execution/provider submission. | Supported | Bank reconciliation is downstream of Payment Execution/provider status, not payroll approval. |

## 2. Bank Reconciliation Definition

Bank Reconciliation is a controlled financial verification layer that compares SyncOS payment/cash records against actual bank activity to confirm cleared money-in, cleared money-out, failures, returns, and exceptions.

Bank Reconciliation represents:

- bank account
- imported/manual bank transaction
- transaction date
- posted date
- amount
- debit/credit direction
- bank reference
- matched SyncOS object
- match confidence
- reconciliation status
- cleared status
- exceptions
- manual review
- audit trail

Bank Reconciliation does not represent:

- payment approval
- ACH submission
- card payout processing
- payroll provider submission
- cash receipt creation
- invoice payment application
- accounting export
- tax filing
- treasury forecasting

## 3. Core Bank Reconciliation Principle

Payment Execution records intended or manually marked money-out status.

Cash Receipt records money received.

Bank Reconciliation verifies actual bank-cleared activity.

Core rules:

- Executed Later does not mean Bank Cleared.
- Cash Receipt does not mean Bank Deposited.
- Payment Application does not mean Bank Reconciled.

Money-out chain:

`Payment Execution -> Bank Transaction Match -> Cleared / Exception Status -> Accounting Export later`

Money-in chain:

`Cash Receipt -> Bank Deposit / Bank Transaction Match -> Cleared / Exception Status -> Accounting Export later`

Never:

- `Bank Reconciliation -> Payment Execution`
- `Bank Reconciliation -> Cash Receipt Creation` without an explicitly approved future import workflow
- `Bank Reconciliation -> Accounting Export`
- `Bank Reconciliation -> Tax Filing`

## 4. Bank Reconciliation Relationship To Payment Execution

Bank Reconciliation consumes:

- `payment_batches`
- `payment_items`
- `execution_status`
- `execution_reference`
- `payment_method`
- `payment_amount`
- payee
- scheduled/executed dates

Rules:

- Only `submitted_later` or `executed_later` payment batches/items normally enter reconciliation.
- Bank Reconciliation may match bank debits to payment items or batches.
- Match may update reconciliation/cleared status on payment batch/item only if future fields are approved.
- Match must not change original approval or execution history.
- Match must not create new payment execution.
- Unmatched payment execution remains outstanding.
- Returned/failed bank activity creates exception status, not reversal workflow automatically.

## 5. Bank Reconciliation Relationship To Cash Receipts

Bank Reconciliation consumes:

- `cash_receipts`
- `gross_received_amount`
- `applied_amount`
- `unapplied_amount`
- `payment_method`
- `payment_reference`
- `external_transaction_id`
- `deposit_status`
- `reconciliation_status`

Rules:

- Cash Receipt may be matched to a bank credit.
- Bank match may update deposit/reconciliation status if safe and explicitly approved.
- Bank Reconciliation must not create payment applications.
- Bank Reconciliation must not reduce invoice balances.
- Unmatched cash receipt remains unreconciled or pending.
- Bank credits without cash receipt become exceptions or future cash receipt candidates.

## 6. Bank Reconciliation Relationship To Payment Applications

Payment Applications allocate cash to invoices.

Bank Reconciliation verifies whether receipt money cleared the bank.

Rules:

- Payment Application remains invoice allocation truth.
- Bank Reconciliation should not modify invoice paid/balance fields.
- If bank match fails/returns, reversal workflow is future scope.
- Reconciliation may expose related invoice/payment application context for visibility.
- `payment_application` should be context-only in the first bank reconciliation foundation unless product explicitly approves direct matching.

## 7. Object Model Options

Option A: Fields only on `payment_batches` and `cash_receipts`

Pros:

- simple

Cons:

- weak bank truth
- poor statement imports
- poor matching audit
- poor exception handling

Option B: First-class `bank_accounts`, `bank_transactions`, `reconciliation_matches`

Pros:

- clean bank truth
- supports money-in and money-out
- supports imports and manual transactions
- strong audit

Cons:

- more objects

Option C: Bank statement imports only

Pros:

- import-focused

Cons:

- no durable matching model
- weak manual transaction support

Option D: Hybrid

`bank_accounts` store account context.

`bank_transactions` store actual bank truth.

`reconciliation_matches` connect bank transactions to SyncOS payment/cash objects.

Recommendation: Use Hybrid Option D.

## 8. Proposed Bank Account Model

`bank_accounts`:

- `id`
- `tenant_id`
- `account_name`
- `account_type`
- `institution_name` nullable
- `masked_account_number` nullable
- `routing_last4` nullable
- `currency`
- `status`
- `opening_balance` nullable
- `current_balance_snapshot` nullable
- `last_statement_date` nullable
- `last_reconciled_at` nullable
- `notes` nullable
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Account types:

- `operating`
- `payroll`
- `tax`
- `savings`
- `escrow`
- `credit_card`
- `other`

Statuses:

- `active`
- `inactive`
- `closed`
- `archived`

Rules:

- Never store full bank account number.
- Never store credentials.
- Only masked/last4 fields are allowed.
- Bank integration credentials are future secure-vault scope.

## 9. Proposed Bank Transaction Model

`bank_transactions`:

- `id`
- `tenant_id`
- `bank_account_id`
- `transaction_date`
- `posted_date` nullable
- `direction`
- `amount`
- `currency`
- `description`
- `bank_reference` nullable
- `external_transaction_id` nullable
- `payment_method` nullable
- `transaction_type`
- `reconciliation_status`
- `cleared_status`
- `import_batch_id` nullable future
- `source_type`
- `notes` nullable
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Directions:

- `debit`
- `credit`

Transaction types:

- `payment_out`
- `deposit_in`
- `fee`
- `transfer`
- `reversal`
- `chargeback`
- `adjustment`
- `interest`
- `unknown`

Reconciliation statuses:

- `unreconciled`
- `matched`
- `partially_matched`
- `exception`
- `ignored`
- `archived`

Cleared statuses:

- `pending`
- `posted`
- `cleared`
- `returned`
- `reversed`
- `unknown`

Source types:

- `manual`
- `statement_import_later`
- `bank_feed_later`
- `processor_import_later`

## 10. Proposed Reconciliation Match Model

`reconciliation_matches`:

- `id`
- `tenant_id`
- `bank_transaction_id`
- `match_type`
- `matched_object_type`
- `matched_object_id`
- `matched_amount`
- `match_confidence`
- `match_status`
- `match_reason` nullable
- `variance_amount` nullable
- `reviewed_by` nullable
- `reviewed_at` nullable
- `approved_by` nullable
- `approved_at` nullable
- `rejected_by` nullable
- `rejected_at` nullable
- `rejection_reason` nullable
- `notes` nullable
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

Match types:

- `payment_batch`
- `payment_item`
- `cash_receipt`
- `payment_application_context`
- `manual_adjustment`
- `unknown`

Matched object types:

- `payment_batch`
- `payment_item`
- `cash_receipt`
- `payment_application`
- `invoice`
- `manual`

Match statuses:

- `proposed`
- `reviewed`
- `approved`
- `rejected`
- `voided`
- `archived`

Match confidence:

- `exact`
- `high`
- `medium`
- `low`
- `manual`

Rules:

- `matched_amount` cannot exceed transaction amount unless split/partial match rules allow.
- One bank transaction may match multiple objects if explicitly approved.
- One SyncOS object may match multiple bank transactions if split payment/deposit exists and is explicitly approved.
- Approved match does not create accounting export.

## 11. Bank Statement / Import Model

Future `bank_statement_imports` may include:

- import file metadata
- date range
- bank account
- row count
- imported by
- import status
- error count

Rules:

- No file upload/import in the first foundation unless explicitly approved.
- First backend may support manual bank transaction creation.
- Bank feed integration is future scope.

Recommended first backend: manual bank account, manual bank transaction, and reconciliation match. Statement import later.

## 12. Match Model

Matching links a bank transaction to one or more SyncOS objects with an amount, confidence, status, reviewer, and approval state.

Rules:

- Matches are proposed before they are approved.
- Review and approval are separate lifecycle states unless product confirms a simpler single-step flow.
- Approved match updates the bank transaction reconciliation status.
- Any source object status mirror must be explicitly confirmed before implementation.
- Match rejection preserves the bank transaction and source object unchanged.

## 13. Cleared Payment Model

Cleared payment means a bank debit has posted and has an approved reconciliation match to a Payment Execution object.

Rules:

- `payment_item` should be the preferred money-out matching target because it has payee and amount detail.
- `payment_batch` matching may be allowed for batch-level bank debits if a bank transaction represents the whole batch.
- `executed_later` remains candidate status only until bank match approval.
- Approved match may set future `cleared_status` / `reconciliation_status` on payment item or batch if those fields are approved.
- Cleared payment does not create bank reconciliation accounting entries.

## 14. Deposit Matching Model

Money-in matching connects bank credits to:

- `cash_receipts`
- payment applications as context
- invoices indirectly as context

Rules:

- Credit transaction should match cash receipt `gross_received_amount`.
- One bank deposit may contain multiple cash receipts if split/deposit batch matching is approved.
- One cash receipt may match multiple deposits only with explicit split support.
- Approved match may update `cash_receipt.reconciliation_status`.
- Approved match may update `cash_receipt.deposit_status` if product confirms deposit semantics.
- Bank Reconciliation does not update invoice paid/balance amounts.

## 15. Returned / Failed Payment Model

Returned or failed bank activity may include:

- ACH return
- check stop/void
- card payout failure
- wire rejection
- bank fee
- NSF

Rules:

- Returned/failed bank transaction creates reconciliation exception.
- It does not automatically reverse payment execution.
- It does not automatically reverse invoice cash application.
- Reversal/correction workflow is future scope.

## 16. Exception Model

Exceptions include:

- amount mismatch
- date mismatch
- duplicate transaction
- unmatched debit
- unmatched credit
- missing cash receipt
- missing payment batch
- returned payment
- bank fee
- unknown transaction

Exception statuses:

- `open`
- `under_review`
- `resolved`
- `ignored`
- `escalated`

First implementation may store exception state on `bank_transactions` or `reconciliation_matches`.

Recommendation: store durable transaction-level exception status on `bank_transactions.reconciliation_status = exception`, with match-level rejection/variance details on `reconciliation_matches`.

## 17. Manual Adjustment Model

Manual adjustments may be needed for:

- bank fees
- corrections
- rounding
- duplicate entries
- unknown transactions

Rules:

- Manual adjustment does not create accounting entry in first implementation.
- Manual adjustment requires a reason.
- Accounting Export later decides GL treatment.
- Manual adjustment match type should be auditable and tenant scoped.

## 18. Reconciliation Session Model

Future reconciliation sessions may group:

- bank account
- statement period
- opening balance
- ending balance
- matched transactions
- exceptions
- reviewer
- approval

Recommended first backend:

- Defer full `reconciliation_sessions`.
- Focus on `bank_accounts`, `bank_transactions`, and `reconciliation_matches`.
- Keep `last_reconciled_at` on `bank_accounts` as informational until sessions are approved.

## 19. Reconciliation Status Model

Reconciliation states:

- `unreconciled`
- `matched`
- `partially_matched`
- `exception`
- `ignored`
- `archived`

Cleared states:

- `pending`
- `posted`
- `cleared`
- `returned`
- `reversed`
- `unknown`

Rules:

- Matched means linked to a SyncOS object.
- Cleared means bank activity posted/confirmed.
- Reconciled means reviewed and accepted.
- These terms must not be mixed.

## 20. Payment Processor Settlement Boundary

Bank Reconciliation must not reconcile processor batch details unless a future processor settlement workflow exists.

Processor settlement remains future scope.

Do not implement:

- card processor batch import
- merchant fee reconciliation
- chargeback workflow
- funding reconciliation

## 21. Accounting Export Boundary

Bank Reconciliation must not create:

- GL journal
- accounting export
- QuickBooks export
- ERP export
- accounting close

Accounting Export is a future layer.

## 22. Treasury / Cash Forecasting Boundary

Bank Reconciliation must not:

- forecast cash
- optimize payment timing
- manage funding
- manage credit lines
- initiate transfers

Treasury / Cash Forecasting is future scope.

## 23. Permissions / Roles

Proposed permissions:

Bank account:

- `bank_account.read`
- `bank_account.create`
- `bank_account.update`
- `bank_account.archive`

Bank transaction:

- `bank_transaction.read`
- `bank_transaction.create`
- `bank_transaction.update`
- `bank_transaction.archive`
- `bank_transaction.match`
- `bank_transaction.ignore`
- `bank_transaction.timeline.read`
- `bank_transaction.audit.read`

Reconciliation match:

- `reconciliation_match.read`
- `reconciliation_match.create`
- `reconciliation_match.review`
- `reconciliation_match.approve`
- `reconciliation_match.reject`
- `reconciliation_match.void`
- `reconciliation_match.archive`

Role guidance:

- Finance Manager can approve matches.
- Billing/Admin can propose money-in matches.
- Payroll/Finance can view money-out context where permitted.
- Executive/System Admin can override.
- Operations can view limited source context where permitted.

## 24. Events And Audit Requirements

Proposed events:

Bank account:

- `bank_account.created`
- `bank_account.updated`
- `bank_account.archived`

Bank transaction:

- `bank_transaction.created`
- `bank_transaction.updated`
- `bank_transaction.matched`
- `bank_transaction.exception_opened`
- `bank_transaction.ignored`
- `bank_transaction.archived`

Reconciliation match:

- `reconciliation_match.created`
- `reconciliation_match.reviewed`
- `reconciliation_match.approved`
- `reconciliation_match.rejected`
- `reconciliation_match.voided`
- `reconciliation_match.archived`

Payment/cash contextual events:

- `payment_item.bank_match_approved`
- `cash_receipt.bank_match_approved`

Every write must create:

- event
- event payload
- audit log
- system action

Use the existing write-action helper and preserve tenant isolation.

## 25. Search

Future search should include:

- `bank_accounts`
- `bank_transactions`
- `reconciliation_matches`

Search fields:

- account name
- institution name
- transaction description
- bank reference
- external transaction id
- matched payment batch
- matched payment item
- matched cash receipt
- exception reason

Tenant scoped. Archived records excluded unless `archived=true`.

## 26. Recommended Backend Foundation Scope

Recommended next coding sprint: Bank Reconciliation Backend Contract Foundation.

Build:

- `bank_accounts`
- `bank_transactions`
- `reconciliation_matches`
- manual bank account creation
- manual bank transaction creation
- match bank transaction to payment batch/item
- match bank transaction to cash receipt
- match review/approve/reject
- exception status
- ignore/archive
- timeline/audit
- search
- smoke validation

Do not build:

- bank feed integration
- statement import
- processor settlement
- accounting export
- treasury forecasting
- automatic matching AI
- tax filing
- cash receipt creation from bank transactions
- payment execution creation from bank transactions
- invoice balance updates from bank reconciliation

## 27. Required Product Confirmations

1. Should Bank Reconciliation use Hybrid Option D? Recommended yes.
2. Should first backend support manual bank transactions before statement import? Recommended yes.
3. Should bank accounts store only masked data? Recommended yes.
4. Should one bank transaction match multiple SyncOS objects? Recommended yes, for deposits/splits, but only with explicit partial-match rules.
5. Should one SyncOS object match multiple bank transactions? Recommended yes, for split payments/deposits, but only with explicit partial-match rules.
6. Should payment batches or payment items be primary matching target? Recommended primary `payment_item`, with batch-level matching allowed when the bank debit represents the full batch.
7. Should cash receipts be primary money-in matching target? Recommended yes.
8. Should payment applications be context-only? Recommended yes for first backend.
9. Should approved bank match update `cash_receipt.reconciliation_status`? Recommended yes if event/audit/system_action behavior is preserved.
10. Should approved bank match update `cash_receipt.deposit_status`? Needs confirmation because deposit and reconciliation semantics can differ.
11. Should approved bank match update payment item cleared/reconciliation status if fields exist? Recommended yes, but only after adding explicit fields.
12. Should returned payments create exception only? Recommended yes.
13. Should reversals be deferred? Recommended yes.
14. Should accounting export be deferred? Recommended yes.
15. Should treasury forecasting be deferred? Recommended yes.
16. Who can create bank transactions? Recommended Finance Manager, Billing/Admin for money-in, System Admin.
17. Who can approve reconciliation matches? Recommended Finance Manager, Executive, System Admin.
18. Who can ignore transactions? Recommended Finance Manager and System Admin only.
19. Should bank feed integration be future scope? Recommended yes.
20. Should statement import be future scope? Recommended yes after manual transaction foundation.
21. Should automatic matching be future scope? Recommended yes.
22. Should bank transaction fees become manual adjustments or future accounting objects? Recommended manual adjustment context only in first backend.
23. Should matching to legacy `payments` be prohibited? Recommended yes unless a legacy migration strategy is explicitly approved.

## 28. GO / NO-GO Recommendation

GO for a backend foundation sprint only after the required confirmations are answered.

Recommended implementation path:

- Use Hybrid Option D.
- Build bank truth as `bank_accounts` and `bank_transactions`.
- Build auditable linking as `reconciliation_matches`.
- Start with manual bank transactions and manual/proposed matches.
- Treat Payment Execution `executed_later` and Cash Receipt statuses as candidates, not proof.
- Defer bank feeds, statement import, processor settlement, accounting export, treasury forecasting, reversals, automatic matching, tax, and cash receipt creation from bank imports.

NO-GO for UI, migrations, or backend coding until product confirms matching cardinality, source status update rules, deposit status semantics, and approver roles.

## 29. Backend Foundation Follow-Up

The approved follow-up sprint may implement the Hybrid Option D backend foundation only:

- `bank_accounts`
- `bank_transactions`
- `reconciliation_matches`
- manual bank account creation
- manual bank transaction creation
- match to payment batch
- match to payment item
- match to cash receipt
- optional context-only match to payment application
- match review, approval, rejection, void, and archive
- transaction ignore/archive
- exception open/resolve
- timeline/audit
- search
- smoke validation

Still prohibited in the backend foundation:

- bank feed integration
- bank statement import
- payment processor settlement import
- accounting export
- GL entries
- tax filing
- treasury forecasting
- payment execution creation from bank reconciliation
- cash receipt creation from bank reconciliation
- payment application creation from bank reconciliation
- invoice balance updates from bank reconciliation
- ACH, wire, card payout, check, payroll provider submission, bank transfer, or money movement
