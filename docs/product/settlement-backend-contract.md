# Settlement Backend Contract

Settlement is the financial commitment bridge between Billable and future Invoice/Payable workflows.

Settlement consumes `ready_for_settlement` billable items and produces settlement state, settlement items, invoice readiness, and payable readiness. It does not create invoices, invoice items, AR, payments, cash, payroll, ACH, card payouts, bank transactions, or tax records.

## Objects

`settlements` stores settlement header, scope, status, readiness, totals, approval, hold/dispute, invoice-ready, payable-ready, void, archive, and audit fields.

`settlement_items` stores source `billable_item_id`, project/work order/production/QC traceability, item type, quantity, customer billable amounts, contractor payable amounts, retainage, deductions, chargebacks, margin, acceptance/documentation state, void/archive state, and future invoice/payable links.

## Routes

- `GET /settlements`
- `GET /settlements/:id`
- `GET /settlements/:id/detail`
- `POST /settlements`
- `PATCH /settlements/:id`
- `POST /settlements/:id/items`
- `GET /settlements/:id/items`
- `GET /settlement-items/:id`
- `GET /settlement-items/:id/detail`
- `POST /settlement-items/:id/void`
- `POST /settlement-items/:id/archive`
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
- `GET /settlements/:id/timeline`
- `GET /settlements/:id/audit-summary`

Legacy contract/rate settlement routes remain compatible.

## Boundaries

Settlement item creation requires tenant-scoped billable items. Source billable items must be `ready_for_settlement` unless an override is supplied. Duplicate active settlement items for the same billable item are blocked unless overridden.

Settlement approval records financial commitment only. Marking invoice ready creates no invoice. Marking payable ready creates no payment, payroll, or payable record.

## Permissions

Settlement uses `settlement.*` and `settlement_item.*` permissions for read, create, update, readiness, item management, review, approval, hold/release, dispute/resolve, invoice/payable readiness, void, archive, timeline, and audit.

## Events / Audit

Every write uses the write-action helper and creates event, event payload, audit log, and system action entries. Timeline and audit endpoints are tenant scoped.
