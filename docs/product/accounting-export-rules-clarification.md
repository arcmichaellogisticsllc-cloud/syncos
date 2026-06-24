# Accounting Export Rules Clarification

Current validated commit: `f8e87551f2c86a541274ee79fdb28e000abe8ff8`

This is a rules clarification artifact only. It does not change application code, create migrations, create routes, create UI, create accounting exports, create GL entries, file taxes, close books, integrate QuickBooks/ERP systems, or mutate financial source records.

## 1. Current Backend Inventory

| Area | Classification | Current state | Accounting Export implication |
| --- | --- | --- | --- |
| `invoices` | Supported | First-class invoice table/routes exist. Invoices include invoice number/type/status, approval, delivery, cash application, payment, collection, dates, customer/project/settlement links, totals, paid amount, balance amount, timeline, audit, and smoke coverage. | Suitable source for revenue/receivable export after policy confirms eligible invoice statuses. Export must not create invoices or change invoice balances. |
| `invoice_items` | Supported | First-class invoice items exist with invoice, settlement, billable, QC, production, work order, project, customer, item type, quantity, rates, gross/retainage/adjustment/tax/fee/net context, void/archive, routes, and smoke coverage. | Suitable line-level revenue source. Mapping rules for item type, revenue account, class/job, tax/fee treatment, and retainage require confirmation. |
| `cash_receipts` | Supported | First-class inbound cash receipt table/routes exist. Receipts include receipt number, customer, payer, method/reference, gross/applied/unapplied amounts, deposit status, reconciliation status, source type, void/archive, timeline, audit, and smoke coverage. | Suitable source for cash receipt export. Policy must confirm whether reconciled receipt/match is required before export. |
| `payment_applications` | Supported | First-class cash-to-invoice allocation table/routes exist. Applications update invoice receivable state through Cash Application only and include status/type, applied amount, date, note, writeoff/discount/adjustment placeholders, timeline, audit, and smoke coverage. | Suitable allocation source. Export must not apply cash or update invoice paid/balance fields. |
| `contractor_payables` | Supported | First-class payable readiness table/routes exist. Payables include payable number/type/party, status, approval, payment readiness, payment status, provider/crew/worker/vendor/project/settlement, gross/deduction/chargeback/retainage/net, compliance/tax, dispute/hold, lifecycle, timeline, audit, and smoke coverage. | Suitable AP/payable source once approved/payment-ready policy is confirmed. Export must not create payables, execute payment, or mark paid. |
| `contractor_payable_items` | Supported | First-class payable item table/routes exist with settlement item traceability, provider/crew/worker/project context, item type, gross/deduction/chargeback/retainage/net amounts, compliance/tax, dispute/hold, future payment item link, void/archive, and smoke coverage. | Suitable AP line source. Retainage, chargeback, deduction, and vendor mapping treatment require confirmation. |
| `payroll_runs` | Supported | First-class payroll readiness table/routes exist. Payroll runs include run number/type/status, approval, readiness, cycle/period/pay date, project/crew, gross/reimbursement/deduction/estimated tax/net totals, compliance/tax, dispute/hold, lifecycle, timeline, audit, and smoke coverage. | Suitable payroll summary source. Export must not submit payroll, file taxes, create W2/1099, or create provider integrations. |
| `payroll_items` | Supported | First-class payroll item table/routes exist with worker, crew/project/work order/production traceability, source/earning type, worker classification, hours/quantity/rates, gross/reimbursement/deduction/estimated tax/net, compliance/tax, future payment item link, void/archive, and smoke coverage. | Suitable payroll detail source. Mapping for wages, reimbursements, deductions, estimated taxes, and worker/vendor identities requires confirmation. |
| `payment_batches` | Supported | First-class payment execution status table/routes exist. Batches include batch number/type/method/status, approval, execution status, scheduled/submitted/executed metadata, execution reference, totals, failure/cancel/void/archive, timeline, audit, and smoke coverage. | Suitable payment export source only if policy allows unreconciled executed-later status or requires bank match first. Export must not create payment or move money. |
| `payment_items` | Supported | First-class payment item table/routes exist with source type, payable/payroll references, payee, method, amount, execution status/reference/failure, future source links, void/archive, and smoke coverage. | Better payment export granularity than batch-only exports. Bank reconciliation status fields are not directly on items; reconciled status is inferred through reconciliation matches. |
| `bank_accounts` | Supported | First-class bank account table/routes exist with masked account metadata only, account type/status, balances, last statement/reconciled timestamps, archive, timeline, audit, search, and smoke coverage. | Suitable cash/bank account mapping source. Full account numbers and credentials are intentionally absent. |
| `bank_transactions` | Supported | First-class manual bank transaction table/routes exist with account, dates, debit/credit direction, amount, reference, method, type, reconciliation/cleared/exception status, source type, ignore/archive, timeline, audit, search, and smoke coverage. | Suitable bank truth export source. Export should prefer approved reconciliation matches and block open exceptions unless override. |
| `reconciliation_matches` | Supported | First-class match table/routes exist connecting bank transactions to payment batches/items, cash receipts, and payment application context. Includes matched amount, confidence, status, review/approval/rejection, void/archive, timeline/audit via transaction/match, and smoke coverage. | Suitable evidence source for reconciled export. Approved matches are preferred for export readiness. |
| Legacy `payments` | Partially supported / unsafe to infer | Legacy payment table/routes still exist with invoice/settlement, amount, payment date/reference, reconciled/short/overpaid statuses, reconcile/archive behavior, search/report use, and legacy smoke coverage. | Do not use as the new Accounting Export source of truth without explicit legacy compatibility decision. |
| Legacy `ar_records` | Partially supported / unsafe to infer | Legacy AR records table/routes exist with invoice/customer, open amount, aging bucket, balance, status, archive, search/report use, and legacy smoke coverage. | Do not use as the primary export model until Product decides whether AR records remain legacy or become accounting export context. |
| Reports controller | Partially supported | Reports exist for compliance, billing completeness, and constraints. No accounting export, GL mapping, export error, or close report exists. | Export reporting is missing. Backend foundation should add export read models rather than overloading reports first. |
| Search support | Partially supported | Global search includes invoices, invoice items, cash receipts, payment applications, contractor payables, payroll, payment batches/items, bank accounts, bank transactions, reconciliation matches, and legacy finance objects. | Search is ready to extend, but accounting export batches/items do not exist. |
| Permissions | Partially supported | Mature permissions exist for upstream finance layers through bank reconciliation. No `accounting_export_batch.*`, `accounting_export_item.*`, or mapping permissions exist. | New permissions are required before coding. |
| Events | Partially supported | Existing financial writes use event/audit/system_action behavior. No accounting export events exist. | New export events must follow the write-action standard. |
| Audit behavior | Supported pattern / missing export records | Existing source layers expose audit summaries and write through audited actions. Accounting export audit records do not exist. | Export writes must create audit entries; source mutation should be avoided unless explicitly approved. |
| Smoke tests | Partially supported | Existing smokes cover invoice, cash application, collections, contractor payable, payroll, payment execution, bank reconciliation, and boundary rules. No accounting export smoke exists. | Accounting export smoke is required in the backend foundation sprint. |
| Product docs | Supported context / missing export doc | Product docs exist for Invoice, Cash Application, Contractor Payable, Payroll, Payment Execution, Bank Reconciliation, physical tests, backend contracts, and workspaces. | This clarification becomes the first Accounting Export product artifact. |
| Accounting export objects/routes | Missing | No `accounting_export_batches`, `accounting_export_items`, accounting mapping table, routes, permissions, events, smoke, or workspace exists. | Backend foundation is needed before any UI or integration. |

## 2. Accounting Export Definition

Accounting Export is a controlled reporting and export-preparation layer that packages approved or reconciled SyncOS financial facts for delivery into an external accounting system.

Accounting Export represents:

- export batch
- export item
- source financial object
- export type
- export format
- mapping status
- export status
- accounting system target
- external reference
- error/retry status
- audit trail

Accounting Export does not represent:

- accounting ledger
- GL posting inside SyncOS
- tax filing
- payment execution
- bank reconciliation
- accounting close
- treasury management
- external ERP ownership

## 3. Core Accounting Export Principle

SyncOS is the operational and financial workflow system.

The accounting system is the official accounting ledger.

Accounting Export packages facts for export. It does not become the ledger and does not silently mutate source truth.

Never:

- Accounting Export -> Payment Execution
- Accounting Export -> Bank Transaction
- Accounting Export -> Tax Filing
- Accounting Export -> Payroll Provider Submission
- Accounting Export -> Change Invoice Balance

Source financial records may receive export status metadata only if Product explicitly approves that behavior. Recommended first implementation: keep export status on export batches/items only.

## 4. Accounting Export Relationship To Invoices

Accounting Export may consume:

- approved/sent invoices
- invoice items
- customer organization
- original amount
- balance amount
- paid amount
- invoice dates
- payment status
- collection status

Rules:

- Exporting invoice data does not create invoices.
- Exporting invoice data does not update invoice balances.
- Exporting invoice data does not apply cash.
- Invoice export status should be tracked on export items unless Product approves source metadata fields.
- Credit memo/write-off export rules are unsafe to infer beyond existing modeled fields.

Recommended first policy:

- Export approved or sent invoices by default.
- Allow draft/voided/archived invoice export only through explicit override and audit.
- Treat invoice items as revenue/receivable line candidates.

## 5. Accounting Export Relationship To Cash Application

Accounting Export may consume:

- cash receipts
- payment applications
- invoice allocation
- receipt date
- application date
- customer
- unapplied cash
- bank reconciliation match if available

Rules:

- Export does not create cash receipts.
- Export does not apply cash.
- Export does not update invoice paid or balance amounts.
- Export may include unapplied cash only if Product confirms the accounting treatment.

Recommended first policy:

- Export cash receipt and payment application facts separately but in the same batch type when needed.
- Prefer reconciled receipts or approved bank matches where available.
- Keep payment application as allocation truth, not bank-cleared truth.

## 6. Accounting Export Relationship To Contractor Payables

Accounting Export may consume:

- approved/payment-ready contractor payables
- contractor payable items
- gross payable amount
- deductions
- chargebacks
- retainage
- net payable amount
- payable party
- provider/crew/vendor context

Rules:

- Export does not create contractor payables.
- Export does not execute payment.
- Export does not mark paid.
- Export does not create vendor portal or contractor portal records.
- Retainage treatment requires mapping confirmation.

Recommended first policy:

- Export approved or payment-ready contractor payable obligations as AP candidates.
- Export actual payment/disbursement facts separately from Payment Execution or Bank Reconciliation.

## 7. Accounting Export Relationship To Payroll

Accounting Export may consume:

- approved/payroll-ready payroll runs
- payroll items
- worker earnings
- reimbursements
- deductions
- estimated tax amounts
- worker classification

Rules:

- Export does not submit payroll.
- Export does not file taxes.
- Export does not create W2, 1099, benefits, garnishments, or payroll provider records.
- Payroll provider remains future integration.

Recommended first policy:

- Export payroll readiness facts as payroll expense/accrual candidates only.
- Treat `estimated_tax_amount` as estimated/status context, not filed tax.
- Defer payroll tax liability/remittance export until a tax/payroll rules sprint approves it.

## 8. Accounting Export Relationship To Payment Execution

Accounting Export may consume:

- payment batches
- payment items
- execution status
- execution reference
- payee
- payment method
- scheduled/submitted/executed status-only dates

Rules:

- Export does not create payment.
- Export does not send money.
- Export does not prove bank clearing.
- Export does not create bank transactions.
- Payment export may require reconciliation first.

Recommended first policy:

- Treat `executed_later` payment execution as payment intent/status evidence, not bank-cleared proof.
- Prefer approved reconciliation matches for cleared disbursement export.

## 9. Accounting Export Relationship To Bank Reconciliation

Accounting Export may consume:

- bank transactions
- reconciliation matches
- approved matches
- cleared status
- exception status
- matched payment/cash context

Rules:

- Approved bank matches should be preferred for reconciled export.
- Unreconciled transactions may export only if Product policy allows.
- Open exceptions should block export unless override.
- Ignored transactions should be excluded unless Product policy explicitly includes them.
- Export does not change bank reconciliation status.

Recommended first policy:

- Reconciled/exportable financial facts should come from approved reconciliation matches where possible.
- Bank transactions with `exception_status = open` block export.

## 10. Recommended Object Model

Option A: Export flags only on financial objects

- Pros: Simple, minimal tables.
- Cons: Weak audit, poor batching, poor retries, hard to support mixed export formats, duplicate export detection is scattered, source objects become noisy.

Option B: First-class `accounting_export_batches` and `accounting_export_items`

- Pros: Strong batch control, audit trail, status/error/retry lifecycle, source traceability, supports multiple formats and target systems.
- Cons: Requires new objects and mapping semantics.

Option C: Direct QuickBooks/ERP integration first

- Pros: Fast path to one external system if requirements are fixed.
- Cons: Premature integration lock-in, unsafe without mapping/error/retry model, harder to preserve tenant/audit boundaries.

Option D: Hybrid

- Use first-class export batches/items with mapping/status/error metadata.
- Defer external integrations, direct APIs, file download, GL posting, tax filing, and close workflows.

Recommendation: Use Hybrid Option D.

## 11. Proposed `accounting_export_batches` Object

Fields:

- `id`
- `tenant_id`
- `export_batch_number`
- `export_type`
- `target_system`
- `export_format`
- `status`
- `approval_status`
- `export_status`
- `period_start` nullable
- `period_end` nullable
- `item_count`
- `total_debit_amount` nullable
- `total_credit_amount` nullable
- `total_amount` nullable
- `generated_file_reference` nullable
- `external_batch_reference` nullable
- `submitted_at` nullable
- `submitted_by` nullable
- `accepted_at` nullable
- `accepted_by` nullable
- `rejected_at` nullable
- `rejected_by` nullable
- `rejection_reason` nullable
- `error_count`
- `retry_count`
- `notes` nullable
- `override_reasons` jsonb
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Export types:

- `invoices`
- `cash_receipts`
- `payment_applications`
- `contractor_payables`
- `payroll`
- `payment_execution`
- `bank_reconciliation`
- `mixed_later`
- `correction`
- `reversal`

Target systems:

- `quickbooks_later`
- `sage_later`
- `netsuite_later`
- `generic_csv`
- `generic_json`
- `manual_export`
- `other`

Export formats:

- `csv`
- `json`
- `manual_summary`
- `api_payload_later`
- `iif_later`

Statuses:

- `draft`
- `assembling`
- `ready_for_review`
- `under_review`
- `approved`
- `generated`
- `submitted_later`
- `accepted_later`
- `rejected_later`
- `failed`
- `cancelled`
- `archived`

Approval statuses:

- `not_submitted`
- `pending`
- `approved`
- `rejected`
- `withdrawn`

Export statuses:

- `not_generated`
- `generated`
- `submitted_later`
- `accepted_later`
- `rejected_later`
- `failed`
- `cancelled`

Rules:

- `export_batch_number` must be tenant-unique.
- `period_start <= period_end` when both are supplied.
- `generated_file_reference` is metadata only unless a later file-generation sprint approves downloadable artifacts.
- `submitted_later` and `accepted_later` are manual/status-only in the first foundation.

## 12. Proposed `accounting_export_items` Object

Fields:

- `id`
- `tenant_id`
- `accounting_export_batch_id`
- `source_object_type`
- `source_object_id`
- `export_item_type`
- `target_account_code` nullable
- `target_account_name` nullable
- `target_entity_reference` nullable
- `debit_amount` nullable
- `credit_amount` nullable
- `amount` nullable
- `currency`
- `memo` nullable
- `transaction_date` nullable
- `export_status`
- `mapping_status`
- `error_message` nullable
- `external_reference` nullable
- `override_reasons` jsonb
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Source object types:

- `invoice`
- `invoice_item`
- `cash_receipt`
- `payment_application`
- `contractor_payable`
- `contractor_payable_item`
- `payroll_run`
- `payroll_item`
- `payment_batch`
- `payment_item`
- `bank_transaction`
- `reconciliation_match`

Export item types:

- `revenue`
- `receivable`
- `cash_receipt`
- `unapplied_cash`
- `payable`
- `payroll_expense`
- `payment`
- `bank_transaction`
- `reconciliation`
- `fee`
- `adjustment`
- `correction`
- `reversal`

Export statuses:

- `pending`
- `generated`
- `submitted_later`
- `accepted_later`
- `rejected_later`
- `failed`
- `cancelled`
- `archived`

Mapping statuses:

- `unmapped`
- `mapped`
- `mapping_warning`
- `mapping_error`
- `override_mapped`

Rules:

- Each item must reference one source object type/id.
- Cross-tenant source references are prohibited.
- Duplicate active export item for the same source object and export type should be blocked unless correction/reversal/override is supplied.
- Mapping errors should block generation unless override is supplied.

## 13. GL Account Mapping Model

Proposed future object: `accounting_mappings`.

Fields:

- `source_type`
- `source_category`
- `target_system`
- `target_account_code`
- `target_account_name`
- `mapping_status`
- `effective_date`
- `notes`

Rules:

- First sprint may store mapping fields directly on export items.
- A first-class mapping table is recommended before external integration because mapping reuse and validation will otherwise become duplicated.
- Mappings do not create GL entries inside SyncOS.
- Mapping warnings/errors are export readiness states only.

Recommendation:

- Backend foundation can include item-level mapping metadata.
- Defer a dedicated mapping administration object unless Product confirms mapping maintenance needs in the same sprint.

## 14. Customer / Vendor / Worker Mapping Model

Accounting export may require mapping:

- customer organization to accounting customer
- contractor/provider to accounting vendor
- worker to employee/vendor record
- project to class/job
- territory to class/location
- item/rate code to product/service
- bank account to accounting bank/cash account

Rules:

- Missing mappings should create mapping warnings/errors.
- Mapping should not create external customer/vendor/worker records unless a future integration sprint approves it.
- Manual external references may be stored on export items or future mapping objects.
- Worker classification should guide but not silently decide accounting identity.

## 15. Revenue Export Model

Revenue export may include:

- invoice
- invoice item
- customer
- revenue category
- project/class/location
- amount
- invoice date

Rules:

- Invoice must be approved/sent unless override.
- Export does not create invoice.
- Export does not change receivable state.
- Revenue recognition policy is unsafe to infer beyond invoice/item facts.

Recommended first implementation:

- Package invoice and invoice item facts.
- Use item-level mapping status for revenue account/class/product mapping.
- Defer advanced revenue recognition rules.

## 16. Cash Receipt Export Model

Cash receipt export may include:

- cash receipt
- payment applications
- bank reconciliation match if available
- customer
- cash account
- unapplied cash

Rules:

- Receipt export should prefer reconciled/approved bank match if policy requires.
- Export does not update invoice balance.
- Export does not create deposit.
- Export does not create bank transaction.

Recommended first implementation:

- Support cash receipt and payment application source object types.
- Mark missing bank match as warning or blocker depending on Product confirmation.

## 17. Payment Execution Export Model

Payment execution export may include:

- payment batch
- payment items
- payee
- payment method
- execution reference
- executed date/status

Rules:

- Export should prefer bank-reconciled executed payments if policy requires.
- Export does not create payment.
- Export does not mark paid.
- Export does not create bank transaction.

Recommended first implementation:

- Support payment batch/item source object types.
- Treat payment execution status as payment intent/status until reconciled.

## 18. Payroll Export Model

Payroll export may include:

- payroll run
- payroll items
- worker
- gross pay
- reimbursements
- deductions
- estimated tax

Rules:

- Export does not submit payroll.
- Export does not file taxes.
- Export does not create W2/1099.
- Export does not remit benefits or garnishments.
- Payroll provider export is future scope.

Recommended first implementation:

- Support payroll run/item source object types as payroll expense/accrual facts.
- Keep estimated taxes as estimated/status fields only.

## 19. Reconciliation Export Model

Reconciliation export may include:

- bank transaction
- reconciliation match
- source object
- cleared status
- exception status
- match status/confidence

Rules:

- Exceptions should block export unless override.
- Ignored transactions should be excluded unless policy says otherwise.
- Approved matches should be the preferred evidence for cleared money-in/money-out export.

Recommended first implementation:

- Support bank transaction and reconciliation match source object types.
- Require approved match for reconciled export batches unless Product explicitly permits unreconciled bank transaction exports.

## 20. Export Format Model

Formats:

- `csv`
- `json`
- `manual_summary`
- `api_payload_later`
- `iif_later`

Rules:

- First backend may generate structured JSON metadata only.
- File generation and export download should be future scope unless Product confirms otherwise.
- API submission is future scope.
- IIF/QuickBooks-specific formats should remain future until target mapping is confirmed.

## 21. Export Status Model

Statuses:

- `not_generated`
- `generated`
- `submitted_later`
- `accepted_later`
- `rejected_later`
- `failed`
- `cancelled`

Rules:

- `generated` means SyncOS prepared export data/status, not that a file was downloaded or an API was called.
- `submitted_later` means manually submitted or future integration status.
- `accepted_later` means externally accepted by manual/reference status, not independently verified by SyncOS.
- No external API submission in the first sprint.

## 22. Error / Retry Model

Errors may include:

- missing mapping
- invalid target account
- unmapped customer
- unmapped vendor
- unmapped worker
- period closed
- duplicate export
- external rejection
- validation error
- source object no longer eligible
- source object has open reconciliation exception

Rules:

- Retry does not mutate source objects.
- Retry creates audit trail.
- Errors do not create accounting entries.
- Duplicate export should be blocked unless correction/reversal/override is supplied.

Recommended first implementation:

- Store item-level `error_message`, batch `error_count`, and `retry_count`.
- Add lifecycle actions for mark failed and retry/generate only if product confirms retry semantics.

## 23. Accounting Close Boundary

Accounting Export must not:

- close accounting periods
- lock books
- post journal entries
- run trial balance
- generate financial statements
- mark accounting periods closed

Accounting close remains outside SyncOS or future scope.

## 24. Tax Boundary

Accounting Export must not:

- file taxes
- calculate payroll tax
- generate W2
- generate 1099
- remit taxes
- file sales/use tax
- create tax filing records

Tax remains future scope.

## 25. Permissions / Roles

Proposed permissions:

Accounting export batch:

- `accounting_export_batch.read`
- `accounting_export_batch.create`
- `accounting_export_batch.update`
- `accounting_export_batch.add_item`
- `accounting_export_batch.remove_item`
- `accounting_export_batch.generate`
- `accounting_export_batch.submit_review`
- `accounting_export_batch.start_review`
- `accounting_export_batch.approve`
- `accounting_export_batch.reject`
- `accounting_export_batch.mark_submitted`
- `accounting_export_batch.mark_accepted`
- `accounting_export_batch.mark_failed`
- `accounting_export_batch.cancel`
- `accounting_export_batch.archive`
- `accounting_export_batch.timeline.read`
- `accounting_export_batch.audit.read`

Accounting export item:

- `accounting_export_item.read`
- `accounting_export_item.create`
- `accounting_export_item.update`
- `accounting_export_item.archive`

Role guidance:

- Finance Manager approves exports.
- Accounting Admin prepares exports.
- Executive/System Admin overrides.
- Operations has limited read context only.

## 26. Events And Audit Requirements

Proposed events:

Accounting export batch:

- `accounting_export_batch.created`
- `accounting_export_batch.updated`
- `accounting_export_batch.item_added`
- `accounting_export_batch.item_removed`
- `accounting_export_batch.generated`
- `accounting_export_batch.review_submitted`
- `accounting_export_batch.review_started`
- `accounting_export_batch.approved`
- `accounting_export_batch.rejected`
- `accounting_export_batch.submitted`
- `accounting_export_batch.accepted`
- `accounting_export_batch.failed`
- `accounting_export_batch.cancelled`
- `accounting_export_batch.archived`

Accounting export item:

- `accounting_export_item.created`
- `accounting_export_item.updated`
- `accounting_export_item.archived`

Every write must create:

- event
- event payload
- audit log
- system action

All routes must remain tenant scoped and permission protected.

## 27. Search

Future search should include:

- `accounting_export_batches`
- `accounting_export_items`

Search fields:

- export batch number
- source object reference
- target system
- target account
- external reference
- error message
- export status
- mapping status

Archived records should be excluded unless `archived=true`.

## 28. Recommended Backend Foundation Scope

Recommended next coding sprint: Accounting Export Backend Contract Foundation.

Build:

- `accounting_export_batches`
- `accounting_export_items`
- export batch creation
- add source items
- mapping status fields
- totals calculation
- generate status
- review/approve/reject
- mark submitted/accepted/failed
- cancel/archive
- timeline/audit
- search
- smoke validation
- documentation

Do not build:

- QuickBooks API
- ERP API
- file download
- GL posting
- tax filing
- accounting close
- bank reconciliation mutation
- source object mutation except export status if explicitly safe
- direct external customer/vendor/worker creation

## 29. Required Product Confirmations

1. Use Hybrid Option D? Recommended yes.
2. Should Accounting Export be batch/item based? Recommended yes.
3. Should first backend use generic CSV/JSON/manual summary only? Recommended yes.
4. Should QuickBooks API be future scope? Recommended yes.
5. Should GL mapping table be first-class now or later? Recommended later unless mapping administration is required immediately.
6. Should source objects be mutated with export status? Recommended no for first foundation; keep export status on export items.
7. Should only reconciled items be exportable by default? Recommended yes for payment/cash/bank exports; invoices/payables/payroll may use approval/readiness statuses.
8. Should exceptions block export? Recommended yes unless override.
9. Should missing mappings block export? Recommended yes for generation; warning may allow draft assembly.
10. Should payroll export include estimated taxes only? Recommended yes; no tax filing or tax liability workflow.
11. Should tax filing remain separate? Recommended yes.
12. Should accounting close remain external? Recommended yes.
13. Who can approve exports? Recommended Finance Manager, Executive, System Admin.
14. Who can mark export submitted? Recommended Accounting Admin, Finance Manager, System Admin.
15. Who can mark export accepted? Recommended Finance Manager or Accounting Admin with audit.
16. Should file generation/download be deferred? Recommended yes unless Product explicitly approves generated file artifacts.
17. Should external customer/vendor creation be deferred? Recommended yes.
18. Should duplicate export be blocked? Recommended yes unless correction/reversal/override.
19. Should exports support correction/reversal batches? Recommended yes as status/model support, but no GL reversal posting.
20. Should accounting export ever create payments or bank transactions? Recommended no.

## 30. GO / NO-GO Recommendation

GO for Accounting Export Backend Contract Foundation after Product confirms:

- Hybrid Option D
- batch/item model
- source eligibility by export type
- reconciled-vs-approved export requirements
- missing mapping blocker behavior
- no source mutation except explicitly approved metadata
- no external API/file download/GL/tax/close behavior

NO-GO for Accounting Export UI, QuickBooks/ERP integration, GL posting, file download, tax filing, accounting close, external customer/vendor creation, or source-record mutation until the backend contract foundation exists and Product confirms the required rules.

## 31. Validation

Only non-mutating checks are required for this clarification:

- `git status --short`
- document/code inspection
- `git diff --check`

No code, migrations, routes, or UI were created by this clarification.
