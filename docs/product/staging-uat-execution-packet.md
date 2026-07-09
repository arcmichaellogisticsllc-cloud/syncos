# Staging UAT Execution Packet

## 1. UAT Objective

Validate that operators understand SyncOS workflows, role boundaries, financial boundary copy, and core tasks in a controlled staging environment.

## 2. Participants

- Product owner.
- Executive tester.
- Growth tester.
- Operations tester.
- Field tester.
- QC tester.
- Finance tester.
- Collections tester.
- Payables/payroll tester.
- Accounting tester.
- Read-only auditor tester.

## 3. Session Structure

- 10 minutes: orientation.
- 20 minutes: guided demo.
- 30 minutes: persona task execution.
- 15 minutes: feedback capture.
- 15 minutes: issue triage.

## 4. UAT Cycles

- Cycle 1: Navigation and first impression.
- Cycle 2: Operator workbench comprehension.
- Cycle 3: Detail-page next action comprehension.
- Cycle 4: Role and permission boundaries.
- Cycle 5: Financial boundary comprehension.
- Cycle 6: Mobile/tablet quick pass.

## 5. Role Paths

Use `docs/product/operator-uat-plan.md` and `docs/product/operator-demo-scripts.md` as the detailed source plans.

| Persona | Summary path |
| --- | --- |
| Executive | `/`, `/executive`, `/operations` |
| Growth | `/intelligence/signals`, signal detail |
| Operations | `/operations`, `/work-orders`, `/production`, `/qc` |
| Finance | `/billable`, `/settlements`, `/invoices`, `/cash` |
| Collections | `/collections` |
| Payables | `/contractor-payables`, `/payroll`, `/payments` |
| Accounting | `/bank-reconciliation`, `/accounting-exports` |
| Auditor | Representative read-only pages |

## 6. Feedback Form Fields

| Field | Values / notes |
| --- | --- |
| Date | UAT session date. |
| Tester | Name or initials. |
| Persona | Assigned test persona. |
| Page | Route or feature area. |
| Task | Task attempted. |
| Expected behavior | What the tester expected. |
| Observed behavior | What happened. |
| Confusion | Plain-language note. |
| Severity | BLOCKER, HIGH, MEDIUM, LOW. |
| Screenshot reference | Store outside repo if used. |
| Blocks UAT | yes/no. |
| Blocks staging | yes/no. |
| Recommended fix | Proposed change or decision. |
| Owner | TBD until triaged. |
| Status | OPEN, TRIAGED, FIXING, FIXED, ACCEPTED, DEFERRED. |

## 7. GO / NO-GO Criteria

GO to production-readiness planning only if:

- Critical workflows are understood.
- No developer UI appears.
- No critical permission issue is open.
- No financial boundary confusion remains.
- No critical mobile blocker remains.
- Release gate remains green.
- Staging backup path exists.
- Tenant/admin bootstrap is verified.

Production remains NO-GO during UAT.
