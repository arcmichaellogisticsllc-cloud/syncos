# Invoice Workspace Product Contract

Invoice Workspace exposes the hardened Invoice Backend Contract Foundation for Option B.

The approved chain is:

Billable -> Settlement -> Invoice -> Cash Application

Invoice is the customer-facing demand-for-payment and receivable-tracking workspace. It owns `original_amount`, `paid_amount`, `balance_amount`, `aging_days`, `payment_status`, `collection_status`, and `cash_application_status`.

Invoice Workspace must not create separate AR records, cash receipts, payments, payroll, tax records, ACH, card payouts, bank transactions, or accounting exports.

## Routes

- `/invoices`
- `/invoices/new`
- `/invoices/:id`
- `/invoices/:id/edit`

No Cash Application, Payment, Payroll, Collections, Customer Portal, or Accounting Export route is created in this sprint.

## Backend API Usage

The workspace uses only hardened Invoice backend routes:

- `GET /invoices`
- `GET /invoices/:id`
- `GET /invoices/:id/detail`
- `POST /invoices`
- `PATCH /invoices/:id`
- `POST /invoices/:id/recalculate-totals`
- `POST /invoices/:id/submit-review`
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

Related reads are limited to settlements, settlement items, projects, organizations, and permission context through existing API routes. The web app does not direct-query the database.

## Navigation

Main navigation includes `Invoices`.

Workspace navigation includes:

- Invoice Queue
- Create Invoice
- Invoice Detail
- Invoice Items
- Customer Context
- Settlement Context
- Project Context
- Financial Summary
- Receivable State
- Approval
- Delivery
- Package / Documentation
- Disputes
- Timeline
- Audit
- Future Cash Application
- Future Collections

## Invoice Queue

`/invoices` gives finance and operations users a control surface for invoice-owned receivable state.

Summary cards include:

- Total Invoices
- Draft
- Assembling
- Ready For Review
- Under Review
- Approved
- Sent
- Disputed
- Voided
- Archived
- Unpaid
- Partially Paid
- Paid Later
- Overpaid Later
- Ready For Cash Application
- Not Due
- Due
- Overdue
- Balance Outstanding

Required table columns are surfaced:

- Invoice Number
- Invoice Type
- Status
- Approval Status
- Delivery Status
- Cash Application Status
- Payment Status
- Collection Status
- Customer
- Project
- Settlement
- Invoice Date
- Due Date
- Payment Terms
- Subtotal Amount
- Retainage Amount
- Adjustment Amount
- Tax Amount
- Fee Amount
- Total Amount
- Original Amount
- Paid Amount
- Balance Amount
- Aging Days
- Currency
- Package Status
- Documentation Status
- Recommended Next Action
- Updated Date

Filters include invoice type, status, approval status, delivery status, cash application status, payment status, collection status, customer, project, settlement, invoice date range, due date range, payment terms, balance, overdue, archived, and text search.

Sorting includes recently updated, invoice date newest, due date soonest, total amount highest, balance amount highest, aging highest, status, and invoice number.

## Create / Edit Forms

`/invoices/new` creates an invoice shell for a customer through `POST /invoices`.

Required:

- Customer Organization

Optional:

- Invoice Type
- Settlement
- Project
- Invoice Date
- Due Date
- Payment Terms
- Billing Period Start
- Billing Period End
- Currency
- Override Reasons

`/invoices/:id/edit` updates only backend-supported invoice fields:

- Invoice Date
- Due Date
- Payment Terms
- Billing Period Start
- Billing Period End
- Invoice Package Status
- Documentation Status
- Customer Acceptance Status
- Prime Acceptance Status
- Override Reasons
- Dispute Note

Status changes use lifecycle routes. Voided, archived, sent, paid-later, and fully-applied-later states are treated as read-only unless backend policy allows specific updates.

## Invoice Detail

`/invoices/:id` shows the demand-for-payment truth and invoice-owned receivable state.

The header shows:

- Invoice number
- Invoice type
- Status
- Approval status
- Delivery status
- Cash application status
- Payment status
- Collection status
- Customer
- Project
- Settlement
- Invoice date
- Due date
- Payment terms
- Total amount
- Original amount
- Paid amount
- Balance amount
- Aging days
- Currency
- Recommended next action

Primary actions use backend lifecycle routes only:

- Edit Invoice
- Add Invoice Item
- Recalculate Totals
- Submit Review
- Approve
- Reject
- Mark Sent
- Mark Ready For Cash Application
- Dispute
- Resolve Dispute
- Void
- Archive

Actions are hidden or disabled when permissions or backend lifecycle state do not allow them. The backend remains authoritative.

## Demand-For-Payment Scorecard

Scorecard cards show:

- Total Amount
- Original Amount
- Paid Amount
- Balance Amount
- Aging Days
- Payment Status
- Collection Status
- Cash Application Status
- Approval Status
- Delivery Status
- Item Count

The workspace displays the boundary:

- Invoice owns receivable state.
- Ready for Cash Application does not create cash.
- Payments and cash application are future workflows.

## Invoice Items

Invoice items can be added from invoice-ready settlement items through `POST /invoices/:id/items`.

Add item fields:

- `settlement_item_id`
- `quantity`
- `unit_rate`
- `description`
- `adjustment_amount`
- `tax_amount`
- `fee_amount`
- `override_reasons`

The item table shows item type, status, description, settlement, settlement item, project, work order, production record, QC review, quantity, unit, unit rate, gross amount, retainage, deduction, adjustment, tax, fee, and net amount.

Invoice item void/archive use:

- `POST /invoice-items/:id/void`
- `POST /invoice-items/:id/archive`

These actions do not create cash or payment records.

## Detail Sections

Customer shows customer organization, customer status, payment terms, customer/prime acceptance, billing contact, and billing notes when backend context provides them.

Settlement shows settlement number, type, status, invoice readiness, payable readiness, gross billable amount, net settlement amount, margin amount, and item count.

Project shows project, project status, customer, territory, work type, project manager, and field supervisor.

Financial Summary shows subtotal, retainage, adjustment, tax, fee, total, original, paid, balance, and currency.

Receivable State shows original amount, paid amount, balance amount, aging days, payment status, collection status, cash application status, last payment, and writeoff fields. Cash Application is a placeholder only.

Approval shows submission, approval, and rejection state.

Delivery shows delivery state and sent metadata. Email delivery, PDF generation, and customer portal submission are not available.

Package / Documentation shows invoice package, documentation, customer acceptance, and prime acceptance state. PDF package generation is deferred.

Disputes shows dispute reason, note, actor, timestamp, current status, and collection status.

Timeline uses `GET /invoices/:id/timeline`.

Audit uses `GET /invoices/:id/audit-summary` and is permission protected.

## Permissions

Invoice permissions surfaced:

- `invoice.read`
- `invoice.create`
- `invoice.update`
- `invoice.add_item`
- `invoice.remove_item`
- `invoice.recalculate_totals`
- `invoice.submit_review`
- `invoice.approve`
- `invoice.reject`
- `invoice.mark_sent`
- `invoice.mark_ready_for_cash_application`
- `invoice.dispute`
- `invoice.resolve_dispute`
- `invoice.void`
- `invoice.archive`
- `invoice.timeline.read`
- `invoice.audit.read`

Invoice item permissions surfaced:

- `invoice_item.read`
- `invoice_item.create`
- `invoice_item.update`
- `invoice_item.void`
- `invoice_item.archive`

## Finance Boundary

Invoice Workspace creates or updates only invoice and invoice item records through the Invoice backend.

It does not create:

- separate AR records
- cash receipts
- payments
- payroll
- tax records
- ACH
- card payouts
- bank transactions
- accounting exports

Cash Application and Collections remain placeholders until their own rules and backend contracts are approved.
