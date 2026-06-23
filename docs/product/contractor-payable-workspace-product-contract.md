# Contractor Payable Workspace Product Contract

Contractor Payable Workspace is future scope.

The backend contract now exposes contractor payable headers, payable items, approval lifecycle, payment readiness, holds, disputes, totals, timeline, audit, and search.

Future UI routes may include:

- `/contractor-payables`
- `/contractor-payables/new`
- `/contractor-payables/:id`
- `/contractor-payables/:id/edit`
- `/contractor-payable-items/:id`

The workspace must not create payment records, payroll runs, ACH/card payouts, bank transactions, tax records, accounting exports, contractor portal transactions, vendor portal transactions, or cash movement.

UI actions must call backend lifecycle routes and remain permission-controlled. Payment-ready status is only a handoff state for future Payment / Payroll workflows.
