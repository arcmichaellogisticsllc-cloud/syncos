# Payroll Backend Contract

Current scope: Payroll Backend Contract Foundation.

Payroll is the individual-worker compensation readiness layer:

Worker / Production Context -> Payroll Item -> Payroll Run -> Payroll Approval -> Payroll Ready -> Payroll Execution later

Payroll does not execute payment, create ACH/card/check payouts, submit payroll providers, create bank transactions, file taxes, generate W2/1099 records, administer benefits, remit garnishments, export accounting data, or create worker portal records.

## Model

Hybrid Option D is implemented.

Source context remains in workers, crews, projects, work orders, and production records. Payroll readiness and approval are represented by first-class `payroll_runs` and `payroll_items`.

## Tables

`payroll_runs` stores payroll period, cycle, approval, readiness, financial totals, compliance/tax readiness, hold/dispute state, void/archive metadata, and audit fields.

`payroll_items` stores worker-level compensation source, worker classification, crew/project/work order/production traceability, hours, rates, quantities, gross/reimbursement/deduction/tax/net amounts, readiness state, void/archive metadata, and audit fields.

Payroll run numbers are tenant-unique and generated as `PR-{tenantScopedSequence}`.

## Routes

- `GET /payroll-runs`
- `GET /payroll-runs/:id`
- `GET /payroll-runs/:id/detail`
- `POST /payroll-runs`
- `PATCH /payroll-runs/:id`
- `POST /payroll-runs/:id/items`
- `POST /payroll-runs/:id/recalculate-totals`
- `POST /payroll-runs/:id/submit-review`
- `POST /payroll-runs/:id/start-review`
- `POST /payroll-runs/:id/approve`
- `POST /payroll-runs/:id/reject`
- `POST /payroll-runs/:id/mark-payroll-ready`
- `POST /payroll-runs/:id/place-hold`
- `POST /payroll-runs/:id/release-hold`
- `POST /payroll-runs/:id/dispute`
- `POST /payroll-runs/:id/resolve-dispute`
- `POST /payroll-runs/:id/void`
- `POST /payroll-runs/:id/archive`
- `GET /payroll-runs/:id/items`
- `GET /payroll-runs/:id/timeline`
- `GET /payroll-runs/:id/audit-summary`
- `GET /payroll-items/:id`
- `GET /payroll-items/:id/detail`
- `PATCH /payroll-items/:id`
- `POST /payroll-items/:id/void`
- `POST /payroll-items/:id/archive`

## Payroll Item Rules

Payroll item requires worker, source type, earning type, and worker classification.

Conditional rules:

- `approved_time` requires hours.
- `production_based` requires production, work order, project, or quantity unless override is supplied.
- `manual` requires `manual_reason`.
- `reimbursement` requires reimbursement amount and description/evidence unless override is supplied.
- `bonus`, `correction`, and `deduction` require reason context.
- `unknown` worker classification blocks readiness unless override is supplied.

Totals are backend-calculated from active, non-voided, non-archived items:

`net_pay_amount = gross_pay_amount + reimbursement_amount - deduction_amount - estimated_tax_amount`

If estimated tax is absent, the run remains readiness-warning only. No tax filing or tax calculation workflow is executed.

## Lifecycle

Payroll run lifecycle:

`draft -> ready_for_review -> under_review -> approved -> payroll_ready`

Supporting states include `rejected`, `held`, `disputed`, `voided`, and `archived`.

Approval requires active items, valid totals, compliance/tax readiness unless override, no active hold unless override, and no open dispute unless override.

Marking payroll ready requires approved status, valid net pay, compliance/tax readiness unless override, no hold, no open dispute, and no future payment item links.

Payroll Ready is a status only.

## Permissions

Payroll run permissions:

- `payroll_run.read`
- `payroll_run.create`
- `payroll_run.update`
- `payroll_run.add_item`
- `payroll_run.remove_item`
- `payroll_run.recalculate_totals`
- `payroll_run.submit_review`
- `payroll_run.start_review`
- `payroll_run.approve`
- `payroll_run.reject`
- `payroll_run.mark_payroll_ready`
- `payroll_run.place_hold`
- `payroll_run.release_hold`
- `payroll_run.dispute`
- `payroll_run.resolve_dispute`
- `payroll_run.void`
- `payroll_run.archive`
- `payroll_run.timeline.read`
- `payroll_run.audit.read`

Payroll item permissions:

- `payroll_item.read`
- `payroll_item.create`
- `payroll_item.update`
- `payroll_item.void`
- `payroll_item.archive`

## Events And Audit

Every write uses the standard write-action helper and creates event, audit log, and system action records.

Payroll run events include create/update, item added, totals recalculated, review submitted/started, approved/rejected, payroll ready, hold/release, dispute/resolve, void, and archive.

Payroll item events include create, update, void, and archive.

Timeline and audit endpoints are tenant-scoped and permission protected.

## Search

Global search includes `payroll_run` and `payroll_item`, searching run number, worker name, crew, project, source type, earning type, status, hold reason, and dispute reason.

## Boundary

Payroll creates no payment, ACH, card payout, check, bank transaction, payroll provider submission, tax filing, W2, 1099, benefits, garnishment, accounting export, worker portal, bank reconciliation, or cash movement records.
