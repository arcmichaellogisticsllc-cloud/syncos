# Contractor Payable Workspace Product Contract

Contractor Payable Workspace exposes the hardened Contractor Payable backend through an operator workspace.

Approved payable chain:

`Production -> QC -> Billable -> Settlement -> Contractor Payable -> Payment / Payroll later`

Contractor Payable represents the money-out obligation layer before any payment, payroll, bank, tax, portal, or accounting action.

## Routes

- `/contractor-payables`
- `/contractor-payables/new`
- `/contractor-payables/:id`
- `/contractor-payables/:id/edit`

## Navigation

The main navigation includes `Contractor Payables`.

The workspace provides sections for queue, detail, payable items, payable party, provider/crew context, settlement context, project context, financial summary, compliance/tax readiness, retainage, deductions/chargebacks, holds/disputes, approval, payment readiness, timeline, audit, and future payment/payroll/bank-accounting placeholders.

## Queue

The queue calls `GET /contractor-payables` and shows:

- Summary cards for statuses, payable types, compliance blockers, missing tax documents, retainage, and net payable.
- Filters for payable type, party type, status, approval, payment readiness, payment status, provider, crew, project, settlement, compliance, tax documents, dispute, hold, pay cycle, due date, archived state, and text search.
- Table columns for payable number, statuses, party, provider, crew, project, settlement, pay cycle, due date, gross/deduction/chargeback/retainage/net amounts, compliance, tax, dispute, hold, item count, next action, and updated date.

## Create / Edit

Create uses `POST /contractor-payables`.

Edit uses `PATCH /contractor-payables/:id`.

The forms do not expose payment creation, payroll creation, bank transaction creation, tax filing, or accounting export controls.

## Detail

Detail uses `GET /contractor-payables/:id/detail`.

The detail view includes:

- Header actions controlled by contractor payable permissions.
- Scorecard for financial amounts, approval, payment readiness, payment status, compliance, tax documents, hold, dispute, and item count.
- Strategic sidebar with payable party, provider, crew, project, settlement, pay cycle, due date, readiness, and boundary reminders.
- Tabs for overview, payable items, payable party, provider/crew, settlement, project, financial summary, compliance/tax readiness, retainage, deductions/chargebacks, holds/disputes, approval, payment readiness, timeline, audit, and placeholders.

## Item Management

Payable item add uses `POST /contractor-payables/:id/items`.

Item update uses `PATCH /contractor-payable-items/:id`.

Item void/archive use:

- `POST /contractor-payable-items/:id/void`
- `POST /contractor-payable-items/:id/archive`

Payable item actions consume payable-ready settlement items through backend validation and create no payment or payroll records.

## Lifecycle

Lifecycle actions call backend routes:

- `POST /contractor-payables/:id/recalculate-totals`
- `POST /contractor-payables/:id/submit-review`
- `POST /contractor-payables/:id/start-review`
- `POST /contractor-payables/:id/approve`
- `POST /contractor-payables/:id/reject`
- `POST /contractor-payables/:id/mark-payment-ready`
- `POST /contractor-payables/:id/place-hold`
- `POST /contractor-payables/:id/release-hold`
- `POST /contractor-payables/:id/dispute`
- `POST /contractor-payables/:id/resolve-dispute`
- `POST /contractor-payables/:id/void`
- `POST /contractor-payables/:id/archive`

Payment Ready is only a status and does not send money.

## Timeline / Audit

Timeline uses `GET /contractor-payables/:id/timeline`.

Audit uses `GET /contractor-payables/:id/audit-summary` and shows a no-permission message when audit details are unavailable.

## Permissions

The UI surfaces:

- `contractor_payable.read`
- `contractor_payable.create`
- `contractor_payable.update`
- `contractor_payable.add_item`
- `contractor_payable.remove_item`
- `contractor_payable.recalculate_totals`
- `contractor_payable.submit_review`
- `contractor_payable.start_review`
- `contractor_payable.approve`
- `contractor_payable.reject`
- `contractor_payable.mark_payment_ready`
- `contractor_payable.place_hold`
- `contractor_payable.release_hold`
- `contractor_payable.dispute`
- `contractor_payable.resolve_dispute`
- `contractor_payable.void`
- `contractor_payable.archive`
- `contractor_payable.timeline.read`
- `contractor_payable.audit.read`
- `contractor_payable_item.read`
- `contractor_payable_item.create`
- `contractor_payable_item.update`
- `contractor_payable_item.void`
- `contractor_payable_item.archive`

Backend remains authoritative.

## Boundaries

The workspace must not create payment records, payroll runs, ACH/card payouts, checks, bank transactions, bank reconciliation records, tax filings, accounting exports, contractor portal transactions, vendor portal transactions, or cash movement.

Future Payment, Payroll, and Bank / Accounting sections are placeholders only.
