# Payroll Workspace Product Contract

Payroll Workspace exposes the hardened Payroll backend through an operator workspace. Payroll represents worker compensation readiness before money movement. It does not create ACH, card payout, check, bank transaction, payroll provider submission, tax filing, W2, 1099, accounting export, benefit, garnishment, bank reconciliation, or worker portal records.

## Routes

- `/payroll`: Payroll Run Queue.
- `/payroll/new`: Create Payroll Run.
- `/payroll/:id`: Payroll Run Detail.
- `/payroll/:id/edit`: Edit Payroll Run.

Scoped worker, crew, and project payroll routes are deferred unless they can reuse the same workspace safely.

## Backend API Usage

Payroll Runs:

- `GET /payroll-runs`
- `GET /payroll-runs/:id`
- `GET /payroll-runs/:id/detail`
- `POST /payroll-runs`
- `PATCH /payroll-runs/:id`
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

Payroll Items:

- `POST /payroll-runs/:id/items`
- `GET /payroll-items/:id`
- `GET /payroll-items/:id/detail`
- `PATCH /payroll-items/:id`
- `POST /payroll-items/:id/void`
- `POST /payroll-items/:id/archive`

Related reads:

- `GET /workers`
- `GET /crews`
- `GET /projects`
- `GET /work-orders`
- `GET /production-records`
- `GET /auth/me/permissions`

The web app must not direct-query the database.

## Queue

The Payroll Run Queue shows summary cards, filters, quick filters, sorting, a create action, and a payroll run table.

Required queue fields:

- Payroll Run Number
- Payroll Run Type
- Status
- Approval Status
- Payroll Readiness Status
- Payroll Cycle
- Payroll Period Start
- Payroll Period End
- Pay Date
- Project
- Crew
- Gross Pay Amount
- Reimbursement Amount
- Deduction Amount
- Estimated Tax Amount
- Net Pay Amount
- Item Count
- Worker Count
- Compliance Status
- Tax Document Status
- Dispute Status
- Hold Status
- Recommended Next Action
- Updated Date

Filters include run type, status, approval status, readiness, cycle, project, crew, payroll period, pay date range, compliance status, tax document status, dispute status, hold status, archived state, and text search.

## Create And Edit Forms

Create Payroll Run requires:

- Payroll Run Type
- Payroll Cycle
- Payroll Period Start
- Payroll Period End

Optional create fields include pay date, project, crew, compliance status, tax document status, and override reasons.

Edit Payroll Run may update payroll period, pay date, payroll cycle, project, crew, compliance status, tax document status, override reasons, hold note, and dispute note when backend state permits.

Creating or editing a payroll run must not create payment, ACH/card/check, bank, provider submission, tax, accounting, benefit, garnishment, or worker portal records.

## Detail Sections

Payroll Run Detail includes:

- Header with permission-controlled lifecycle actions.
- Payroll scorecard.
- Strategic sidebar with readiness checklist and boundary reminders.
- Overview.
- Payroll Items.
- Worker Summary.
- Crew Context.
- Project / Production Context.
- Payroll Period / Cycle.
- Financial Summary.
- Earnings.
- Reimbursements.
- Deductions.
- Compliance / Tax Readiness.
- Holds & Disputes.
- Approval.
- Payroll Readiness.
- Timeline.
- Audit.
- Future Payment placeholder.
- Future Payroll Provider placeholder.
- Future Tax / Accounting placeholder.

Invoice, cash, contractor payable, payment execution, tax filing, accounting export, provider submission, and worker portal controls are not part of this workspace.

## Payroll Items

Add Payroll Item uses `POST /payroll-runs/:id/items`.

Required fields:

- `worker_id`
- `source_type`
- `earning_type`
- `worker_classification`

Optional fields include crew, project, work order, production record, work date, regular/overtime/doubletime hours, quantity, unit, rates, gross pay, reimbursement, deduction, estimated tax, description, manual reason, evidence reference, compliance status, tax document status, and override reasons.

Item edit, void, and archive use payroll item backend routes only. They must not create payment or tax records.

## Behavior

Worker classification is shown and reviewed on payroll items. Source and earning fields preserve traceability to worker, crew, project, work order, and production context when backend exposes those fields.

Gross pay, reimbursements, deductions, estimated tax, and net pay are displayed as backend-calculated readiness data. Legal overtime calculation is not performed by the UI.

Approval lifecycle actions are submit review, start review, approve, and reject. Payroll readiness action is mark payroll ready. Payroll Ready does not send money, submit payroll, create ACH/card/check, create a bank transaction, or file taxes.

Hold and dispute actions are tracked through backend lifecycle routes. Holds and disputes do not create cash movement.

## Placeholders

Future Payment placeholder:

“Payment execution is not available in this sprint. Future payment workflows may consume payroll-ready runs.”

Future Payroll Provider placeholder:

“Payroll provider submission is not available in this sprint.”

Future Tax / Accounting placeholder:

“Tax filing, W2/1099 generation, payroll tax deposits, accounting export, and bank reconciliation are not available in this sprint.”

## Permissions

Payroll run permissions surfaced:

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

Payroll item permissions surfaced:

- `payroll_item.read`
- `payroll_item.create`
- `payroll_item.update`
- `payroll_item.void`
- `payroll_item.archive`

The UI hides or disables actions the operator cannot perform. Backend permission and tenant checks remain authoritative.

## Boundary Rules

Payroll Workspace must not create:

- payment records
- ACH payouts
- card payouts
- checks
- bank transactions
- payroll provider submissions
- tax filings
- W2 or 1099 records
- benefits records
- garnishment records
- accounting exports
- bank reconciliation records
- worker portal transactions

Payroll Ready is readiness only.
