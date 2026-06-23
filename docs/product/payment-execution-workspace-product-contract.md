# Payment Execution Workspace Product Contract

Payment Execution UI is future scope. This sprint intentionally ships backend contracts only.

Future workspace routes may include:

- `/payment-batches`
- `/payment-batches/new`
- `/payment-batches/:id`
- `/payment-batches/:id/edit`
- `/payment-items/:id`

The future workspace should expose:

- Payment Batch Queue
- Payment Batch Detail
- Payment Items
- Source Context
- Payee Context
- Method and Schedule
- Approval
- Execution Status
- Failure and Cancellation
- Timeline
- Audit
- Future ACH placeholder
- Future Check placeholder
- Future Payroll Provider placeholder
- Future Bank Reconciliation placeholder
- Future Tax / Accounting placeholder

The UI must use backend routes only. It must not direct-query the database and must hide or disable actions based on:

- `payment_batch.*`
- `payment_item.*`

The UI must clearly state that:

- submitting execution is status-only in this foundation
- mark executed later is manual/status-only
- bank reconciliation proves clearing later
- accounting export and tax workflows are unavailable
- no ACH, card payout, check printing, wire, payroll provider submission, tax filing, or real money movement is performed

No Payment Execution UI is implemented in the backend contract foundation sprint.
