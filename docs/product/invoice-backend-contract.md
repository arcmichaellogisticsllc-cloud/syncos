# Invoice Backend Contract Foundation - Option B

## Definition

Invoice is the customer-facing demand-for-payment and receivable-tracking object generated from approved settlement items.

The approved chain is:

Billable -> Settlement -> Invoice -> Cash Application

No separate first-class AR object is created by default. Invoice owns original amount, paid amount, balance amount, aging, payment status, collection status, and cash application readiness.

## Model

`invoices` are hardened to support invoice lifecycle, approval, delivery, package/documentation state, customer/prime acceptance, and receivable state.

`invoice_items` are first-class line items sourced from `settlement_items`. They preserve settlement, billable, QC, production, work order, project, and customer traceability.

Invoice numbers are tenant-unique and generated at invoice creation when not supplied.

## Receivable State

Invoice owns:

- `original_amount`
- `paid_amount`
- `balance_amount`
- `aging_days`
- `payment_status`
- `collection_status`
- `cash_application_status`

Cash Application later updates paid and balance amounts. This sprint does not create payment or cash records.

## Routes

- `GET /invoices`
- `GET /invoices/:id`
- `GET /invoices/:id/detail`
- `POST /invoices`
- `PATCH /invoices/:id`
- `POST /invoices/:id/recalculate-totals`
- `POST /invoices/:id/submit-review`
- `POST /invoices/:id/submit` legacy-compatible review submit
- `POST /invoices/:id/approve`
- `POST /invoices/:id/reject`
- `POST /invoices/:id/mark-sent`
- `POST /invoices/:id/mark-ready-for-cash-application`
- `POST /invoices/:id/dispute`
- `POST /invoices/:id/resolve-dispute`
- `POST /invoices/:id/void`
- `POST /invoices/:id/archive`
- `GET /invoices/:id/items`
- `POST /invoices/:id/items`
- `GET /invoice-items/:id`
- `GET /invoice-items/:id/detail`
- `POST /invoice-items/:id/void`
- `POST /invoice-items/:id/archive`
- `GET /invoices/:id/timeline`
- `GET /invoices/:id/audit-summary`

## Boundary

Invoice actions do not create:

- `ar_records`
- payments
- cash receipts
- payroll
- tax records
- ACH/card payouts
- bank transactions
- accounting exports

Legacy `ar_records` remain only for compatibility with older finance endpoints and are deprecated for the new Invoice contract.
