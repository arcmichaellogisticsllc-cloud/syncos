# Staging Smoke Test Plan

Use result values: PASS, PARTIAL, FAIL, BLOCKED.

## Environment

- Web loads.
- API health works.
- Worker status is known.
- DB is reachable.
- App version or commit is known if exposed.

## Auth

- Admin can log in.
- Role user can log in.
- Read-only auditor can log in.
- Bad or unauthorized user is denied.

## Navigation

- Command Center.
- Growth.
- Operations.
- Finance.
- Admin or planned/disabled Admin areas.

## Workbench Smoke

- Signal Feed.
- Work Orders.
- Production.
- QC.
- Billable.
- Settlements.
- Invoices.
- Cash.
- Collections.
- Contractor Payables.
- Payroll.
- Payments.
- Bank Reconciliation.
- Accounting Exports.

## Detail / Form Smoke

- Open representative detail page.
- Open representative create form or modal.
- Cancel safely.
- Verify boundary copy.

## Permissions

- Read-only user cannot mutate.
- Finance user cannot perform unrelated admin action.
- Field user cannot perform finance mutation where role policy supports this split.

## Safety

- No developer session UI.
- No external integration behavior.
- No money movement language.
- No real bank/payroll/payment actions.
