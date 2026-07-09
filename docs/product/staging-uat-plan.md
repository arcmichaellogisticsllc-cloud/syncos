# Staging UAT Plan

References:

- `docs/product/operator-uat-plan.md`
- `docs/product/operator-demo-scripts.md`

## Objective

Validate operator comprehension, workflow clarity, role restrictions, and safe financial boundaries in staging.

## Participants

- Mike / product owner.
- Operations user.
- Field supervisor.
- QC reviewer.
- Finance user.
- Payables/payroll user.
- Accounting user.
- Read-only auditor.

## Session Structure

1. 15-minute intro.
2. 30-45 minute guided workflow test.
3. 15-minute feedback capture.
4. Issue triage.

## Test Cycles

- Cycle 1: Navigation and comprehension.
- Cycle 2: Workflow execution using demo/staging data.
- Cycle 3: Read-only and permissions.
- Cycle 4: Financial boundary comprehension.
- Cycle 5: Mobile/tablet quick review.

## Feedback Capture

| Field | Value |
| --- | --- |
| Persona | TBD |
| Page | TBD |
| Task | TBD |
| Expected behavior | TBD |
| Observed behavior | TBD |
| Confusion | TBD |
| Severity | LOW / MEDIUM / HIGH / BLOCKER |
| Blocks UAT | yes/no |
| Recommended fix | TBD |
| Owner | TBD |
| Status | OPEN / TRIAGED / FIXED / DEFERRED |

## GO / NO-GO

Must pass before production-readiness planning:

- Role users can navigate.
- Key workflows are understood.
- No developer UI appears.
- No external integration confusion.
- No critical permission issue.
- No critical mobile blocker.
- Release gate remains green.
