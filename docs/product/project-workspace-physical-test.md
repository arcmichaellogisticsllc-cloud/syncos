# Project Workspace Physical Test

This future UI test validates the Project Workspace without direct API calls, database access, or developer intervention.

## Preconditions

- User can log in with project permissions.
- At least one approved Project Handoff exists.
- At least one Project has been created through explicit Project Handoff project creation.

## Test Steps

1. Open `/projects`.
2. Confirm projects list loads with customer, territory, status, phase, readiness scores, owners, constraints, and recommended next action.
3. Filter by status `planning`.
4. Search by project name, customer, territory, scope, or location.
5. Open a project detail page.
6. Confirm source opportunity panel is visible.
7. Confirm source coverage plan panel is visible.
8. Confirm source project handoff panel is visible.
9. Confirm operations ownership fields are visible.
10. Confirm scope and location are visible.
11. Confirm readiness scorecard shows project, coverage, compliance, and financial readiness.
12. Recalculate readiness.
13. Confirm warnings and blockers are backend-provided.
14. Attempt Mark Ready For Work with blockers present and confirm it is blocked.
15. Resolve test data or use a project with warnings only.
16. Attempt Mark Ready For Work without override reason and confirm override is required.
17. Mark Ready For Work with required override reason.
18. Confirm project status becomes `ready_for_work`.
19. Start project.
20. Confirm project status becomes `active`.
21. Confirm no work order was created.
22. Place project on hold with hold reason.
23. Release hold with release note.
24. Complete project with completion note.
25. Confirm no settlement, invoice, payment, payroll, AR, or cash record was created.
26. Close project with closeout notes.
27. Confirm no settlement, invoice, payment, payroll, AR, or cash record was created.
28. Archive requires archive reason.
29. Confirm archived project is view-only.
30. Open timeline and confirm project events are shown.
31. Open audit as authorized user and confirm audit records are shown.
32. Confirm unauthorized user cannot see audit summary.

## Pass Criteria

- No API calls by tester.
- No DB access.
- No developer intervention.
- Project actions are permission-aware.
- Project readiness is understandable.
- Warnings are visible and require override where appropriate.
- Blockers stop ready-for-work.
- Starting a project creates no work orders.
- Completing/closing a project creates no settlement, invoice, payment, payroll, AR, or cash records.

## Fail Criteria

- Project UI creates work orders or production records.
- Project UI creates settlement, invoice, payment, payroll, AR, or cash records.
- Archived project can be edited.
- Audit is visible without permission.
- Tenant data leaks across projects.
