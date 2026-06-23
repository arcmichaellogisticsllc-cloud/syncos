# Payment Execution Physical Test

Use an authorized tenant-scoped user with Payment Execution permissions unless a step explicitly tests unauthorized behavior.

## Workspace Flow

- Open `/payments`.
- Confirm the main navigation includes Payments.
- Confirm the Payment Batch Queue loads.
- Confirm summary cards are visible for total, lifecycle statuses, batch types, payment methods, and total payment amount.
- Filter payment batches by status, batch type, payment method, execution status, archived state, date ranges, and text search.
- Use quick filters for Draft, Ready For Review, Approved, Scheduled, Submitted, Executed Later, Failed, Contractor Payable, Payroll, ACH, Check, and Manual.
- Create a payment batch from `/payments/new`.
- Confirm creation does not create ACH, card payout, check, wire, bank transaction, payroll provider submission, tax filing, W2, 1099, benefit, garnishment, accounting export, bank reconciliation, portal, or real money movement records.
- Edit scheduled payment date, payment method, notes, and override reasons from `/payments/:id/edit` if backend allows.

## Payment Items

- Open Payment Batch Detail at `/payments/:id`.
- Add a contractor payable payment item from a payment-ready contractor payable.
- Add a payroll payment item from a payroll-ready payroll run and payroll item.
- Confirm whole payroll run intake requires payroll item selection unless the backend safely expands worker items.
- Open the Payment Items tab.
- Open a payment item detail at `/payment-items/:id`.
- Edit a payment item if backend allows.
- Void a payment item with a reason.
- Archive a payment item with a reason.
- Confirm payment item actions do not create real payment, provider, bank, tax, accounting, or reconciliation records.

## Detail Sections

- View Payment Batch Detail header.
- View payment execution scorecard.
- View strategic sidebar.
- View Overview.
- View Payment Items.
- View Contractor Payable Sources.
- View Payroll Sources.
- View Payee Summary.
- View Payment Method.
- View Financial Summary.
- View Approval.
- View Schedule.
- View Execution Status.
- View Failure / Cancellation.
- View Timeline.
- View Audit.

## Lifecycle Actions

- Submit review.
- Start review.
- Approve with approval note.
- Reject with rejection reason.
- Schedule with scheduled payment date.
- Submit execution with submit note and optional manual reference.
- Confirm Submit Execution is status-only and creates no ACH, card payout, check, wire, payroll provider submission, bank transaction, tax filing, accounting export, or real money movement.
- Mark executed with execution reference and execution note.
- Confirm Mark Executed is status-only and creates no bank transaction or bank reconciliation.
- Mark failed with failure reason.
- Cancel with cancel reason.
- Void with void reason.
- Archive with archive reason.

## Permissions And Audit

- Confirm unauthorized users cannot open protected data.
- Confirm users missing action permissions see disabled or hidden action controls.
- View audit as an authorized user.
- Confirm audit is hidden or replaced with “You do not have permission to view payment execution audit details.” for unauthorized users.

## Future Placeholders

- Confirm ACH placeholder only and no ACH submit button.
- Confirm Check placeholder only and no print check button.
- Confirm Payroll Provider placeholder only and no provider submit button.
- Confirm Bank Reconciliation placeholder only.
- Confirm Accounting / Tax placeholder only.

## Backend Smoke

- Run `npm run payment-execution:smoke`.
- Confirm no ACH, card payout, check, wire, bank transaction, payroll provider submission, tax filing, W2, 1099, benefit, garnishment, accounting export, bank reconciliation, portal, or real money movement records are created.
