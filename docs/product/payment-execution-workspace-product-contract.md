# Payment Execution Workspace Product Contract

Payment Execution exposes the hardened backend as an operator workspace for governed payment intent and status tracking. It does not move money or integrate with ACH, card payout, check printing, wire, payroll provider, bank reconciliation, tax, accounting, treasury, or portal workflows.

## Routes

- `/payments` - Payment Batch Queue
- `/payments/new` - Create Payment Batch
- `/payments/:id` - Payment Batch Detail
- `/payments/:id/edit` - Edit Payment Batch
- `/payment-items/:id` - Payment Item Detail

Scoped source routes are deferred unless the same workspace can be reused safely.

## Queue Fields

The queue shows summary cards, filters, quick filters, future workflow placeholders, and a batch table with:

- Payment Batch Number
- Batch Type
- Payment Method
- Status
- Approval Status
- Execution Status
- Scheduled Payment Date
- Submitted At
- Executed At
- Execution Reference
- Item Count
- Total Payment Amount
- Currency
- Failure Reason
- Recommended Next Action
- Updated Date

Supported filters include batch type, payment method, status, approval status, execution status, scheduled/submitted/executed date ranges, archived/active, and text search.

## Create And Edit Forms

Creating a payment batch requires:

- Batch Type
- Payment Method

Optional fields:

- Scheduled Payment Date
- Currency
- Notes
- Override Reasons

Editing a payment batch is limited to backend-authorized instruction context:

- Scheduled Payment Date
- Payment Method
- Notes
- Override Reasons

The UI does not expose payment movement, bank transaction, provider submission, tax filing, or accounting export controls.

## Item Management

Payment items can be added from backend routes only:

- `POST /payment-batches/:id/items/contractor-payable`
- `POST /payment-batches/:id/items/payroll-run`

Contractor payable intake supports:

- contractor payable
- optional contractor payable item
- optional payment amount
- optional payee name
- optional override reasons

Payroll intake requires:

- payroll run
- payroll item
- optional payment amount
- optional payee name
- optional override reasons

Whole payroll run intake remains blocked unless the backend safely expands to worker-level items. Payment item edit, void, and archive use payment item backend routes.

## Detail Sections

Payment Batch Detail includes:

- Header
- Payment execution scorecard
- Strategic sidebar
- Overview
- Payment Items
- Contractor Payable Sources
- Payroll Sources
- Payee Summary
- Payment Method
- Financial Summary
- Approval
- Schedule
- Execution Status
- Failure / Cancellation
- Timeline
- Audit
- Future ACH placeholder
- Future Check placeholder
- Future Payroll Provider placeholder
- Future Bank Reconciliation placeholder
- Future Accounting / Tax placeholder

Payment Item Detail shows payment item, batch context, source context, payee context, execution summary, and boundary summary. Item-level execution actions are not exposed.

## Contractor Payable Intake

Contractor payable sources must be payment ready according to backend validation. Payment Execution records payment intent only and does not alter the payable approval history.

## Payroll Intake

Payroll sources must be payroll ready according to backend validation. The UI requires payroll item selection for payroll payment items and does not submit payroll provider files.

## Payment Method Behavior

Payment methods are displayed as instruction context:

- ACH integration is future scope.
- Check printing is future scope.
- Card payout integration is future scope.
- Wire execution is future scope.
- Payroll provider submission is future scope.
- Manual reference may be stored, but no bank transaction is created.

## Approval, Scheduling, And Execution Status

The workspace exposes backend lifecycle routes for:

- Submit Review
- Start Review
- Approve
- Reject
- Schedule
- Submit Execution
- Mark Executed
- Mark Failed
- Cancel
- Void
- Archive
- Recalculate Totals

Submit Execution is status-only/manual reference. Mark Executed records `executed_later` status only and does not confirm bank clearing or reconciliation.

## Placeholders

The workspace must show placeholder-only sections for:

- ACH processor integration
- Check printing
- Payroll provider submission
- Bank reconciliation
- Accounting export and tax workflows

No ACH submit, print check, provider submit, bank reconciliation, tax filing, or accounting export buttons are present.

## Permissions

Actions are hidden or disabled by:

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
- `payment_item.read`
- `payment_item.create`
- `payment_item.update`
- `payment_item.void`
- `payment_item.archive`

The backend remains authoritative for permissions, tenant isolation, event creation, audit, and system actions.

## Boundary Rule

Payment Execution UI must not create ACH, card payout, check, wire, bank transaction, payroll provider submission, tax filing, W2, 1099, benefit, garnishment, treasury, accounting export, bank reconciliation, contractor portal, vendor portal, worker portal, or real money movement records.
