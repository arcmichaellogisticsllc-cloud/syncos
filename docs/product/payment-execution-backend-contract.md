# Payment Execution Backend Contract

Payment Execution is the governed money-movement-intent layer for approved contractor payables and payroll-ready payroll items. This backend foundation creates payment instructions and execution status records only. It does not integrate with ACH, card, wire, check printing, payroll providers, banks, treasury, tax, accounting export, portals, or bank reconciliation.

## Architecture

Revenue side remains:

`Billable -> Settlement -> Invoice -> Cash Receipt -> Payment Application -> Invoice Balance -> Collections`

Cost side:

`Settlement -> Contractor Payable -> Payment Ready -> Payment Execution`

Labor side:

`Worker -> Payroll Item -> Payroll Run -> Payroll Ready -> Payment Execution`

Payment Ready and Payroll Ready are source readiness states. Payment Execution records payment intent, batch approval, schedule, manual/status-only submission, manual/status-only executed-later outcomes, failure, cancellation, void, archive, timeline, audit, and search.

## Objects

`payment_batches` stores tenant-scoped payment batch headers:

- `payment_batch_number`, `batch_type`, `payment_method`
- `status`, `approval_status`, `execution_status`
- `scheduled_payment_date`, `submitted_at`, `submitted_by`, `executed_at`, `execution_reference`
- `item_count`, `total_payment_amount`, `currency`
- approval, rejection, failure, cancellation, void/archive controls
- `override_reasons`, notes, audit fields

`payment_items` stores tenant-scoped payment instructions:

- `payment_batch_id`, `source_type`
- contractor payable or payroll source references
- payee fields for provider, crew, worker, vendor-later, internal self-perform
- `payment_method`, `payment_amount`, `currency`, `payment_date`
- execution status/reference/failure fields
- void/archive controls and audit fields

## Source Intake

Contractor payable intake requires:

- `contractor_payable.status = payment_ready`
- `payment_readiness_status = ready_for_payment`
- no active hold/dispute unless override
- no duplicate active payment item for the same source unless override

Payroll intake requires:

- `payroll_run.status = payroll_ready`
- `payroll_readiness_status = ready_for_payroll`
- `payroll_item_id` for first implementation to avoid ambiguous worker payees
- no active hold/dispute unless override
- no duplicate active payment item for the same run/item unless override

## Lifecycle

Payment batches support:

- create
- update while not submitted/executed/voided/archived
- add contractor payable item
- add payroll item
- recalculate totals
- submit review
- start review
- approve/reject
- schedule
- submit execution as status only
- mark executed later as status only
- mark failed
- cancel
- void
- archive
- timeline
- audit summary

`submit-execution` does not call any external processor. `mark-executed` does not prove bank clearing and does not create reconciliation.

## Permissions

Payment batch permissions:

- `payment_batch.read`
- `payment_batch.create`
- `payment_batch.update`
- `payment_batch.add_item`
- `payment_batch.remove_item`
- `payment_batch.recalculate_totals`
- `payment_batch.submit_review`
- `payment_batch.start_review`
- `payment_batch.approve`
- `payment_batch.reject`
- `payment_batch.schedule`
- `payment_batch.submit_execution`
- `payment_batch.mark_executed`
- `payment_batch.mark_failed`
- `payment_batch.cancel`
- `payment_batch.void`
- `payment_batch.archive`
- `payment_batch.timeline.read`
- `payment_batch.audit.read`

Payment item permissions:

- `payment_item.read`
- `payment_item.create`
- `payment_item.update`
- `payment_item.void`
- `payment_item.archive`

## Events

Payment batch events:

- `payment_batch.created`
- `payment_batch.updated`
- `payment_batch.item_added`
- `payment_batch.item_removed`
- `payment_batch.totals_recalculated`
- `payment_batch.review_submitted`
- `payment_batch.review_started`
- `payment_batch.approved`
- `payment_batch.rejected`
- `payment_batch.scheduled`
- `payment_batch.submitted_for_execution`
- `payment_batch.executed`
- `payment_batch.failed`
- `payment_batch.cancelled`
- `payment_batch.voided`
- `payment_batch.archived`

Payment item events:

- `payment_item.created`
- `payment_item.updated`
- `payment_item.submitted_for_execution`
- `payment_item.executed`
- `payment_item.failed`
- `payment_item.voided`
- `payment_item.archived`

Every write must use the write-action helper so events, event payloads, audit logs, and system actions remain aligned.

## Boundaries

Payment Execution must not create ACH/card/check/wire transfers, bank transactions, payroll provider submissions, tax filings, W2/1099 records, benefits, garnishments, treasury records, accounting exports, bank reconciliation records, or portal transactions.

Bank reconciliation, treasury, tax, accounting, check printing, ACH/card/wire processors, and payroll provider submission are future governed workflows.
