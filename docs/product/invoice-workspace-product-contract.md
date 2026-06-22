# Invoice Workspace Product Contract

Invoice Workspace is future scope.

When approved, it should expose the hardened Invoice backend only. It must not create Cash Application, payment, payroll, tax, bank transaction, or accounting export records.

Expected future routes:

- `/invoices`
- `/invoices/new`
- `/invoices/:id`
- `/invoices/:id/edit`

Expected sections:

- Invoice Queue
- Invoice Detail
- Settlement Item Context
- Invoice Items
- Financial Summary
- Receivable State
- Package / Documentation
- Approval
- Delivery
- Cash Application Boundary
- Disputes
- Timeline
- Audit

Future UI must use backend permissions and keep Cash Application as a placeholder until rules are approved.
