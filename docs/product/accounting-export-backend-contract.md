# Accounting Export Backend Contract

Current implementation scope: backend contract foundation only.

Accounting Export packages approved or reconciled SyncOS financial facts for later delivery to an external accounting system. It does not create ledger truth inside SyncOS, post journals, call QuickBooks/Sage/NetSuite/ERP APIs, create payments, create bank transactions, file taxes, generate W2/1099 records, close periods, or mutate source financial facts.

## Object Model

The backend uses Hybrid Option D:

- `accounting_export_batches`
- `accounting_export_items`
- mapping fields on export items
- status-only submission and acceptance references
- future external accounting integrations deferred

## Batch Contract

`accounting_export_batches` includes:

- tenant-unique `export_batch_number`
- `export_type`
- `target_system`
- `export_format`
- `status`
- `approval_status`
- `export_status`
- optional period
- item/totals/error/retry counts
- generated/manual external references
- submitted/accepted/rejected/failure/cancel/archive metadata
- audit fields

Supported export types are invoices, cash receipts, payment applications, contractor payables, payroll, payment execution, bank reconciliation, mixed later, correction, and reversal.

Target systems and formats are labels only in this sprint. `quickbooks_later`, `sage_later`, `netsuite_later`, `api_payload_later`, and `iif_later` do not call external systems.

## Item Contract

`accounting_export_items` includes:

- batch reference
- source object type and id
- explicit source references where applicable
- export item type
- export status
- mapping status
- target account/entity/item/class/location references
- debit/credit/amount/currency
- memo and transaction date
- external reference and error message
- archive and audit fields

Supported source objects are invoice, invoice item, cash receipt, payment application, contractor payable, contractor payable item, payroll run, payroll item, payment batch, payment item, bank transaction, and reconciliation match.

## Source Intake

The API validates tenant ownership for every source. Batch export type must match source type unless `mixed_later`, `correction`, `reversal`, or override is supplied.

Duplicate active export items for the same source object are blocked unless override/correction/reversal policy is supplied.

Source eligibility is status-based:

- invoices should be approved or sent
- contractor payables should be approved or payment ready
- payroll should be approved or payroll ready
- payment execution should be submitted or executed later
- reconciliation matches should be approved
- open bank reconciliation exceptions block export unless override

## Lifecycle

Routes support:

- create/update batch
- add/update/archive items
- recalculate totals
- generate status
- submit/start review
- approve/reject
- mark submitted
- mark accepted
- mark failed
- cancel/archive
- list/detail/items
- timeline
- audit summary

`generate`, `mark-submitted`, and `mark-accepted` are status-only/manual-reference actions. They do not create files, submit APIs, post GL entries, or mutate sources.

## Permissions

Batch permissions:

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

Item permissions:

- `accounting_export_item.read`
- `accounting_export_item.create`
- `accounting_export_item.update`
- `accounting_export_item.archive`

## Events And Audit

Every write uses the standard write-action helper and creates event, audit log, event payload, and system action records.

Events include batch create/update/item added/totals recalculated/generated/review submitted/review started/approved/rejected/submitted/accepted/failed/cancelled/archived and item created/updated/archived.

## Boundary

Accounting Export does not:

- call accounting APIs
- create GL entries
- post journals
- file taxes
- generate W2s or 1099s
- close accounting periods
- create payments
- create bank transactions
- mutate invoice balances or source financial facts
- generate downloadable files in this sprint
