# Project Workspace Physical Test

This UI test validates the Project Workspace without direct API calls, database access, or developer intervention.

## Preconditions

- User can log in with project permissions.
- At least one approved Project Handoff exists.
- At least one Project has been created through explicit Project Handoff project creation.

## Test Steps

1. Open `/projects`.
2. Confirm the main navigation includes Projects.
3. Confirm projects list loads with customer, territory, status, phase, readiness score, owners, constraints, hard blockers, and recommended next action.
4. Use summary cards or quick filters for Planning, Ready For Work, Active, On Hold, Not Ready, Ready With Risk, Missing Project Manager, Missing Field Supervisor, Hard Blockers, and Open Constraints.
5. Filter by status `planning`.
6. Search by project name, customer, territory, scope, or location.
7. Sort by planned start, lowest readiness, highest readiness, status, customer, and project manager.
8. Open a project detail page.
9. Confirm the readiness scorecard shows project, coverage, compliance, and financial readiness.
10. Confirm the strategic sidebar shows source opportunity, source coverage plan, source project handoff id, customer, territory, work type, owners, planned dates, warnings, blockers, and checklist summary.
11. Open Overview and confirm project status, phase, scope, location, dates, risk notes, hold reason, closeout notes, created date, and updated date.
12. Open Source Context and confirm source opportunity, coverage plan, and project handoff context.
13. Open Operations and confirm owner, project manager, field supervisor, and ownership warnings.
14. Open Scope & Location and confirm work type, scope, location, territory, dates, customer validation requirements, and documentation requirements.
15. Open Readiness and confirm warnings, blockers, recommended next action, and checklist sections.
16. Open Compliance / Safety and confirm backend readiness data is shown honestly.
17. Open Financial / Billing and confirm no finance execution records or actions are available.
18. Open Documentation and confirm requirements render from backend data or JSON.
19. Open Constraints / Risks and confirm project-related constraints or summary values are shown.
20. Confirm Future Work Orders is a placeholder only and has no creation button.
21. Confirm Future Production is a placeholder only and has no creation button.
22. Recalculate readiness.
23. Confirm warnings and blockers are backend-provided.
24. Attempt Mark Ready For Work with blockers present and confirm it is blocked.
25. Resolve test data or use a project with warnings only.
26. Attempt Mark Ready For Work without override reason and confirm override is required if backend requires it.
27. Mark Ready For Work with required override reason.
28. Confirm project status becomes `ready_for_work`.
29. Start project.
30. Confirm project status becomes `active`.
31. Confirm no work order was created.
32. Place project on hold with hold reason.
33. Release hold with release note.
34. Complete project with completion note.
35. Confirm no settlement, invoice, payment, payroll, AR, or cash record was created.
36. Close project with closeout notes.
37. Confirm no settlement, invoice, payment, payroll, AR, or cash record was created.
38. Archive requires archive reason.
39. Confirm archived project is view-only.
40. Open timeline and confirm project events are shown.
41. Open audit as authorized user and confirm audit records are shown.
42. Confirm unauthorized user cannot see audit summary.
43. Open `/projects/:id/edit`.
44. Edit allowed planning fields and save.
45. Confirm status changes are still performed only through lifecycle actions.

## Pass Criteria

- No API calls by tester.
- No DB access.
- No developer intervention.
- Project actions are permission-aware.
- Project edit is permission-aware.
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
