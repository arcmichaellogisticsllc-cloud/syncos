# Work Order Physical Test

## Preconditions

- User can log in with Work Order permissions.
- At least one Project is `ready_for_work` or `active`.
- At least one Capacity Provider/Crew exists for assignment.

## Steps

1. Open Work Order API-backed directory when UI exists.
2. Confirm unauthorized users cannot list Work Orders.
3. Create a draft Work Order for a planning Project only as draft.
4. Create a Work Order for a `ready_for_work` Project.
5. Confirm invalid unit is rejected.
6. Confirm invalid status is rejected.
7. Confirm cross-tenant coverage source/provider/crew references are rejected.
8. Open Work Order detail.
9. Confirm project, coverage, assignment, readiness, quantity, production, QC, billable, and constraints summaries are visible.
10. Recalculate readiness.
11. Mark Work Order ready to assign when readiness allows.
12. Assign provider and crew.
13. Schedule Work Order.
14. Start Work Order.
15. Confirm start creates no production record.
16. Submit Work Order.
17. Confirm submit creates no production record.
18. Start QC review.
19. Confirm QC review creates no QC evidence.
20. Request corrections and confirm reason is required.
21. Approve Work Order.
22. Mark billable and confirm no settlement, invoice, payment, AR, cash, payroll, or finance record is created.
23. Place on hold and confirm reason is required.
24. Release hold and confirm release note is required.
25. Cancel a separate Work Order and confirm reason is required.
26. Close a Work Order and confirm closeout note is required.
27. Archive a Work Order and confirm archive reason is required.
28. View timeline.
29. View audit as an authorized user.
30. Confirm audit is hidden or blocked for unauthorized users.
31. Search for Work Order by name, number, scope, and location.

## Pass Criteria

- No database access is required by the operator.
- Tenant and permission boundaries hold.
- All writes create event, audit, and system_action records.
- Work Order lifecycle does not create production, QC evidence, settlement, invoice, payment, payroll, AR, or cash records.
