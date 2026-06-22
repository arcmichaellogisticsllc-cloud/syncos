# Settlement Workspace Product Contract

Settlement Workspace exposes the hardened Settlement backend as the financial commitment layer between Billable and future Invoice/Payable workflows.

Settlement does not create invoices, invoice items, AR, payments, cash, payroll, ACH, card payouts, bank transactions, or tax records. Invoice Ready and Payable Ready are status/readiness states only.

## Routes

- `/settlements`
- `/settlements/new`
- `/settlements/:id`
- `/settlements/:id/edit`

The workspace may link to Billable, QC, Production, Work Order, Project, and Organization detail pages where routes already exist. It must not direct-query the database.

## Backend Routes Used

- `GET /settlements`
- `GET /settlements/:id/detail`
- `POST /settlements`
- `PATCH /settlements/:id`
- `POST /settlements/:id/recalculate-readiness`
- `POST /settlements/:id/submit-review`
- `POST /settlements/:id/start-review`
- `POST /settlements/:id/approve`
- `POST /settlements/:id/reject`
- `POST /settlements/:id/mark-invoice-ready`
- `POST /settlements/:id/mark-payable-ready`
- `POST /settlements/:id/place-hold`
- `POST /settlements/:id/release-hold`
- `POST /settlements/:id/dispute`
- `POST /settlements/:id/resolve-dispute`
- `POST /settlements/:id/void`
- `POST /settlements/:id/archive`
- `GET /settlements/:id/items`
- `POST /settlements/:id/items`
- `GET /settlements/:id/timeline`
- `GET /settlements/:id/audit-summary`
- `POST /settlement-items/:id/void`
- `POST /settlement-items/:id/archive`

## Settlement Queue

The queue shows summary cards, quick filters, full filters, sorting, and an enriched settlement table.

Required columns:

- Settlement number, type, status, readiness status, readiness score
- Customer, provider, project, work order
- Period start/end, invoice cycle, pay cycle
- Gross billable, contractor payable, retainage, deduction, chargeback, net settlement
- Estimated margin amount/percent
- Invoice ready, payable ready, item count
- Recommended next action and updated date

Filters include settlement type, status, readiness, customer, provider, project, work order, invoice ready, payable ready, hold, dispute, negative margin where exposed, retainage where exposed, archived/active, and text search.

## Create And Edit

Create Settlement requires settlement type and may capture customer, provider, project, work order, settlement period, invoice cycle, and pay cycle.

Edit Settlement uses backend-supported editable fields only: period, cycles, safe customer/provider changes, override reasons, hold note, and dispute note. Lifecycle state changes use action routes rather than direct edit.

Voided, archived, invoice-created-later, and payable-created-later states are read-only unless the backend explicitly allows notes.

## Detail Sections

Settlement Detail includes:

- Header with settlement identity, scope, totals, invoice/payable readiness, item count, and recommended next action
- Financial commitment scorecard
- Strategic sidebar with readiness and finance boundary checklist
- Overview
- Settlement Items
- Customer Billable
- Contractor Payable
- Retainage
- Deductions / Chargebacks
- Margin
- Readiness
- Invoice Readiness
- Payable Readiness
- Holds & Disputes
- Timeline
- Audit
- Future Invoice placeholder
- Future Payment / Payroll placeholder

## Settlement Item Management

Settlement Items can be added from ready billable items through `POST /settlements/:id/items`.

Add item fields:

- Required: billable item, item type, quantity
- Optional: unit rate, contractor rate, retainage percent, deduction amount, chargeback amount, override reasons

Settlement item void/archive actions use dedicated item routes and require reason fields. The UI does not create invoice items, payable items, payments, payroll, or bank transactions.

## Lifecycle Actions

Supported actions:

- Recalculate Readiness
- Submit Review
- Start Review
- Approve
- Reject
- Mark Invoice Ready
- Mark Payable Ready
- Place Hold
- Release Hold
- Dispute
- Resolve Dispute
- Void
- Archive

Action modals collect required notes/reasons and send only to the hardened backend routes.

## Financial Views

Customer Billable shows customer-side gross, retainage, deductions, chargebacks, net values, acceptance, billing package, and documentation state. It states that customer billable value is not an invoice.

Contractor Payable shows provider/crew context, contractor rates, payable amount, deductions/chargebacks, and payable readiness. It states that payable readiness does not send payment, payroll, ACH, card payout, or bank transaction.

Retainage shows retained amounts and release conditions where exposed. Formal retainage ledgering is future scope.

Deductions / Chargebacks shows settlement and item deduction/chargeback fields only. First-class chargeback workflow remains future scope.

Margin shows estimated margin amount/percent, negative margin warnings, and margin unknown warnings.

## Timeline And Audit

Timeline uses `GET /settlements/:id/timeline` and shows settlement and settlement item events.

Audit uses `GET /settlements/:id/audit-summary` and is visible only with `settlement.audit.read`. Unauthorized users see a permission message rather than audit payloads.

## Permissions

The UI surfaces:

- `settlement.read`
- `settlement.create`
- `settlement.update`
- `settlement.recalculate_readiness`
- `settlement.add_item`
- `settlement.remove_item`
- `settlement.submit_review`
- `settlement.start_review`
- `settlement.approve`
- `settlement.reject`
- `settlement.place_hold`
- `settlement.release_hold`
- `settlement.dispute`
- `settlement.resolve_dispute`
- `settlement.mark_invoice_ready`
- `settlement.mark_payable_ready`
- `settlement.void`
- `settlement.archive`
- `settlement.timeline.read`
- `settlement.audit.read`
- `settlement_item.read`
- `settlement_item.create`
- `settlement_item.update`
- `settlement_item.void`
- `settlement_item.archive`

The UI hides or disables actions based on permissions, while backend authorization remains authoritative.

## Finance Boundary

The workspace must show clear boundaries:

- Settlement does not create invoice.
- Invoice Ready does not create AR.
- Payable Ready does not send payment or payroll.
- Cash starts later after invoice, AR, and payment application.
