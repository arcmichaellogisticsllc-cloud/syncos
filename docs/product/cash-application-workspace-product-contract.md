# Cash Application Workspace Product Contract

This is a future UI scope document. The current sprint implements backend contract foundation only.

## Future Routes

- `/cash-application`
- `/cash-application/new`
- `/cash-application/:id`
- `/cash-application/:id/edit`

## Future Workspace Sections

- Cash Receipt Queue
- Cash Receipt Detail
- Payment Applications
- Invoice Context
- Customer Context
- Unapplied Cash
- Partial / Full Payment
- Overpayment Review
- Voids / Reversals
- Timeline
- Audit
- Future Bank Reconciliation placeholder
- Future Refund placeholder
- Future Accounting Export placeholder

## Backend Routes To Reuse

- `GET /cash-receipts`
- `GET /cash-receipts/:id/detail`
- `POST /cash-receipts`
- `PATCH /cash-receipts/:id`
- `POST /cash-receipts/:id/apply`
- `POST /cash-receipts/:id/void`
- `POST /cash-receipts/:id/archive`
- `GET /payment-applications`
- `GET /payment-applications/:id/detail`
- `POST /payment-applications/:id/void`
- `POST /payment-applications/:id/archive`
- `GET /cash-receipts/:id/timeline`
- `GET /cash-receipts/:id/audit-summary`

## Product Boundary

The future workspace may create cash receipts and payment applications only. It must not create payroll, contractor payment, ACH/card payout, bank transaction, deposit batch, bank reconciliation, refund, tax, accounting export, processor charge, collections automation, or separate AR records.

Cash receipt creation alone must show no invoice balance change. Payment application is the only supported invoice balance update path.
