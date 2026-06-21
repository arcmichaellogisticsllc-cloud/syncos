# Work Order Physical Test

## Preconditions

- User can log in with Work Order permissions.
- At least one Project is `ready_for_work` or `active`.
- At least one Capacity Provider or Crew exists for assignment.

## Steps

1. Open `/work-orders`.
2. Confirm the Work Order Directory loads without direct database access.
3. Filter by status, readiness status, QC status, billable status, project, territory, work type, assignment type, production eligible, blockers, warnings, planned start, scheduled start, and text search.
4. Use summary cards for Draft, Ready To Assign, Assigned, Scheduled, In Progress, Submitted, QC Review, Corrections Required, Approved, Billable, Closed, On Hold, Cancelled, Archived, Production Eligible, Blocked, and Ready With Risk.
5. Open `/work-orders/new`.
6. Create a Work Order with project, name, scope, location, work type, territory, planned quantity, and unit.
7. Confirm the app navigates to Work Order Detail.
8. Confirm no production, QC evidence, settlement, invoice, payment, payroll, AR, or cash record was created.
9. Open Work Order Detail.
10. View the readiness scorecard.
11. View project context.
12. View coverage context.
13. View assignment tab.
14. Assign provider or crew through `POST /work-orders/:id/assign`.
15. Schedule the Work Order.
16. Mark ready to assign when backend readiness allows.
17. Start the Work Order.
18. Confirm start creates no production record.
19. Submit the Work Order.
20. Confirm submit creates no production record.
21. Start QC review.
22. Confirm QC review creates no QC evidence.
23. Request corrections and confirm correction reason is required.
24. Approve the Work Order.
25. Mark billable.
26. Confirm mark billable creates no settlement, invoice, payment, AR, cash, or payroll record.
27. Place on hold and confirm hold reason is required.
28. Release hold and confirm release note is required.
29. Cancel a separate Work Order and confirm cancellation reason is required.
30. Close a Work Order and confirm closeout notes are required.
31. Archive a Work Order and confirm archive reason is required.
32. Open `/work-orders/:id/edit`.
33. Edit planning fields and confirm lifecycle status is not directly changed.
34. View timeline.
35. View audit as an authorized user.
36. Confirm audit is hidden or blocked for unauthorized users.
37. Confirm Production Summary is display-only.
38. Confirm QC evidence is placeholder-only.
39. Confirm Future Settlement is placeholder-only.

## Pass Criteria

- No database access is required by the operator.
- Tenant and permission boundaries hold.
- All writes go through backend APIs.
- Work Order lifecycle actions use backend routes.
- Timeline is visible.
- Audit is permission-protected.
- Work Order lifecycle does not create production, QC evidence, settlement, invoice, payment, payroll, AR, or cash records.
