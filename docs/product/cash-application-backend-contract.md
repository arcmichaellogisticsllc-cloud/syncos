# Cash Application Backend Contract Foundation

## Definition

Cash Application records received money and applies it to invoice balances through audited payment applications.

Approved chain:

Billable -> Settlement -> Invoice -> Cash Receipt -> Payment Application -> Invoice Balance Update

Invoice remains the receivable summary owner. Cash Application updates invoice receivable fields only through payment application routes.

## Objects

`cash_receipts` store receipt truth:

- tenant-scoped `receipt_number`
- customer / payer context
- payment date and method
- gross, applied, and unapplied amounts
- receipt, deposit, and reconciliation statuses
- source metadata, evidence reference, notes, overrides
- void/archive and audit fields

`payment_applications` store allocation truth:

- source `cash_receipt_id`
- target `invoice_id`
- customer organization
- applied amount and application date
- application status and type
- note, future writeoff/discount/adjustment fields, overrides
- void/archive and audit fields

## Routes

- `GET /cash-receipts`
- `GET /cash-receipts/:id`
- `GET /cash-receipts/:id/detail`
- `POST /cash-receipts`
- `PATCH /cash-receipts/:id`
- `POST /cash-receipts/:id/apply`
- `POST /cash-receipts/:id/void`
- `POST /cash-receipts/:id/archive`
- `GET /payment-applications`
- `GET /payment-applications/:id`
- `GET /payment-applications/:id/detail`
- `POST /payment-applications/:id/void`
- `POST /payment-applications/:id/archive`
- `GET /cash-receipts/:id/timeline`
- `GET /payment-applications/:id/timeline`
- `GET /cash-receipts/:id/audit-summary`
- `GET /payment-applications/:id/audit-summary`

## Rules

- Cash receipt creation does not update invoice balances.
- Payment application updates invoice `paid_amount`, `balance_amount`, `payment_status`, `collection_status`, `cash_application_status`, `last_payment_at`, and `last_payment_amount`.
- Partial payment leaves invoice open with `payment_status = partially_paid`.
- Full payment sets invoice `balance_amount = 0`, `payment_status = paid`, `collection_status = resolved`, and `cash_application_status = fully_applied_later`.
- Overpayment remains unapplied cash by default. The first implementation blocks application above invoice balance.
- One receipt can be applied to multiple invoices through multiple payment applications.
- Voiding a payment application reverses receipt applied/unapplied amounts and invoice paid/balance state.
- Cash receipt void is blocked while active payment applications exist.

## Boundary

Cash Application does not create:

- separate AR objects
- payroll records
- contractor payments
- ACH/card payouts
- bank transactions
- bank reconciliation records
- deposit batches
- processor charges
- refunds
- tax records
- accounting exports
- collections automation

Legacy `ar_records` and `payments` remain compatibility objects only and are not used by the new Cash Application contract.
