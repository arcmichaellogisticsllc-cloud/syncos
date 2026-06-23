# Cash Application Workspace Product Contract

Cash Application exposes the hardened Cash Application backend through an operator workspace.

Approved chain:

`Billable -> Settlement -> Invoice -> Cash Receipt -> Payment Application -> Invoice Balance Update`

Invoice owns receivable state. Cash Application updates invoice receivable state only through audited payment applications.

## Routes

- `/cash`
- `/cash/receipts/new`
- `/cash/receipts/:id`
- `/cash/receipts/:id/edit`
- `/payment-applications`
- `/payment-applications/:id`

## Navigation

The main navigation includes `Cash Application`.

The workspace navigation includes:

- Cash Receipt Queue
- Create Receipt
- Payment Applications
- Cash Receipt Detail
- Invoice Impact
- Unapplied Cash
- Customer Context
- Timeline
- Audit
- Future Collections placeholder
- Future Reconciliation placeholder
- Future Contractor Payables placeholder

## Backend Routes Reused

Cash Receipts:

- `GET /cash-receipts`
- `GET /cash-receipts/:id`
- `GET /cash-receipts/:id/detail`
- `POST /cash-receipts`
- `PATCH /cash-receipts/:id`
- `POST /cash-receipts/:id/apply`
- `POST /cash-receipts/:id/void`
- `POST /cash-receipts/:id/archive`
- `GET /cash-receipts/:id/timeline`
- `GET /cash-receipts/:id/audit-summary`

Payment Applications:

- `GET /payment-applications`
- `GET /payment-applications/:id`
- `GET /payment-applications/:id/detail`
- `POST /payment-applications/:id/void`
- `POST /payment-applications/:id/archive`
- `GET /payment-applications/:id/timeline`
- `GET /payment-applications/:id/audit-summary`

Related reads:

- `GET /invoices`
- `GET /invoices/:id/detail`
- `GET /organizations/:id/detail`
- `GET /auth/me/permissions`

The web app does not direct-query the database.

## Cash Receipt Queue

Route: `/cash`

The queue provides summary cards, filters, quick filters, receipt list, create receipt action, and future placeholders.

Summary cards:

- Total Receipts
- Unapplied
- Partially Applied
- Fully Applied
- Overapplied
- Voided
- Archived
- ACH
- Wire
- Check
- Card
- Cash
- Lockbox
- Portal
- Balance Remaining

Table columns:

- Receipt Number
- Customer
- Payer Name
- Payment Date
- Payment Method
- Payment Reference
- Gross Amount
- Applied Amount
- Unapplied Amount
- Receipt Status
- Deposit Status
- Reconciliation Status
- Source Type
- Application Count
- Invoice Count
- Recommended Next Action
- Updated Date

Filters:

- Customer
- Payment Method
- Receipt Status
- Deposit Status
- Reconciliation Status
- Source Type
- Payment Date Range
- Has Unapplied Cash
- Archived / Active
- q

Sorting:

- Payment Date Newest
- Payment Date Oldest
- Gross Amount Highest
- Unapplied Highest
- Recently Updated

Default prioritization:

- Unapplied first
- Partially applied second
- Recently updated

## Create Receipt

Route: `/cash/receipts/new`

Required:

- Gross Received Amount
- Payment Date
- Payment Method

Optional:

- Customer
- Payer Name
- Payment Reference
- External Transaction ID
- Currency
- Source Type
- Evidence Reference
- Notes
- Override Reasons

On submit, the UI uses `POST /cash-receipts` and navigates to receipt detail.

Receipt creation does not update invoices, create payment applications, or create bank transactions.

## Edit Receipt

Route: `/cash/receipts/:id/edit`

Editable fields:

- Customer
- Payer Name
- Payment Reference
- External Transaction ID
- Payment Method
- Payment Date
- Evidence Reference
- Notes
- Override Reasons

The edit form does not edit invoice balances or bypass payment application rules.

## Cash Receipt Detail

Route: `/cash/receipts/:id`

The detail page shows received money and where it has been applied.

Header fields:

- Receipt Number
- Customer
- Payer
- Payment Date
- Method
- Gross Amount
- Applied Amount
- Unapplied Amount
- Receipt Status
- Recommended Next Action

Actions:

- Edit Receipt
- Apply To Invoice
- Void
- Archive

Actions are permission controlled. Voiding a receipt is disabled while active payment applications are visible.

Scorecard:

- Gross Amount
- Applied Amount
- Unapplied Amount
- Application Count
- Invoice Count
- Receipt Status
- Payment Method

Required display copy:

- `Receipt creation does not change invoice balances.`
- `Invoice balances change only through payment applications.`

## Detail Tabs

Overview shows receipt details, customer, method, references, statuses, notes, created date, and updated date.

Payment Applications shows:

- Invoice Number
- Customer
- Applied Amount
- Application Date
- Application Type
- Status
- Open / Void / Archive actions

Apply To Invoice modal:

- Required: Invoice, Applied Amount
- Optional: Application Type, Note, Override Reasons
- Uses `POST /cash-receipts/:id/apply`

Customer shows customer context where backend provides it.

Invoice Impact shows affected invoice values as read-only:

- Invoice Number
- Original Amount
- Paid Amount Before
- Paid Amount After
- Balance Before
- Balance After
- Payment Status
- Collection Status

Unapplied Cash shows:

- Gross Amount
- Applied Amount
- Unapplied Amount
- Application Count

Timeline uses `GET /cash-receipts/:id/timeline`.

Audit uses `GET /cash-receipts/:id/audit-summary` and displays an unauthorized message if audit details are not available.

## Payment Application Workspace

Route: `/payment-applications`

The queue lists payment allocations.

Columns:

- Application ID
- Receipt Number
- Invoice Number
- Customer
- Applied Amount
- Application Date
- Application Type
- Status
- Updated Date

Filters:

- Receipt
- Invoice
- Customer
- Status
- Type
- Date Range
- Archived / Active
- q

## Payment Application Detail

Route: `/payment-applications/:id`

The detail page shows:

- Application
- Receipt Context
- Invoice Context
- Customer Context
- Before/After Invoice Balances
- Timeline
- Audit

Actions:

- Void Application
- Archive Application

Voiding uses `POST /payment-applications/:id/void` and relies on the backend to reverse invoice paid and balance amounts.

## Permissions

Cash Receipt:

- `cash_receipt.read`
- `cash_receipt.create`
- `cash_receipt.update`
- `cash_receipt.apply`
- `cash_receipt.void`
- `cash_receipt.archive`
- `cash_receipt.timeline.read`
- `cash_receipt.audit.read`

Payment Application:

- `payment_application.read`
- `payment_application.create`
- `payment_application.void`
- `payment_application.archive`
- `payment_application.timeline.read`
- `payment_application.audit.read`

Invoice Cash:

- `invoice.cash_application.read`
- `invoice.cash_application.update`

The UI hides or disables actions based on permissions. The backend remains authoritative.

## Placeholders

Future Collections:

`Collections workflows are not available in this sprint. Collection status is tracked on invoices and may be used by future collections automation.`

Future Reconciliation:

`Bank reconciliation is not available in this sprint. Deposit and reconciliation statuses are informational only.`

Future Contractor Payables:

`Contractor payments and payroll are not available in this sprint.`

## Boundary

Cash Application Workspace may create cash receipts and payment applications only.

It must not create:

- Payroll
- Contractor payments
- Bank reconciliation
- Deposits
- ACH/card payouts
- Tax records
- Accounting exports
- Processor transactions
- Refunds
- Collections automation
- Separate AR records
