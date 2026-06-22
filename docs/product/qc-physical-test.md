# QC Physical Test

## Preconditions

- Backend migrations are applied.
- Seed data is present.
- User has QC review permissions.
- Submitted production records exist.
- Work Orders and Projects linked to production records are tenant-scoped.

## Test Steps

1. Open `/qc`.
2. Confirm the QC Review Queue loads.
3. Filter QC reviews by review status.
4. Filter QC reviews by review type.
5. Filter QC reviews by production record, Work Order, Project, reviewer, evidence status, customer acceptance, and q search.
6. Confirm summary cards filter the queue.
7. Open `/qc/new`.
8. Create a QC review for a production record.
9. Confirm no billable item, settlement, invoice, AR, payment, cash, payroll, or tax record is created.
10. Open the QC Review Detail page.
11. View the acceptance truth scorecard.
12. View production context.
13. View Work Order context.
14. View Project context.
15. View quantity acceptance.
16. View evidence review and confirm production evidence metadata is read-only.
17. Start review.
18. Approve QC review with approval note and approved quantity.
19. Confirm approved/rejected quantities update through backend response.
20. Confirm billable-candidate quantity does not create a billable item or settlement.
21. Create or open another review and reject it with a reason.
22. Request correction with correction reason.
23. Mark corrected with correction note.
24. Confirm correction traceability is visible.
25. Void a review with void reason.
26. Archive a review with archive reason.
27. View timeline.
28. Confirm timeline shows QC create/start/approve/reject/correction/void/archive events.
29. View audit as an authorized user.
30. Confirm audit is hidden for an unauthorized user.
31. Confirm Billable Workspace is placeholder only.
32. Confirm Settlement is placeholder only.

## Pass Criteria

- QC navigation exists.
- QC Review Queue is usable.
- QC Create works.
- QC edit route does not bypass missing backend update route.
- QC Detail is usable.
- Acceptance truth scorecard is visible.
- Production context is visible.
- Work Order context is visible.
- Project context is visible.
- Quantity acceptance is visible.
- Evidence review is visible.
- Correction management is visible.
- Customer/prime acceptance is visible.
- Billable candidate summary is visible.
- Lifecycle actions work through backend routes.
- Timeline is visible.
- Audit is permission-protected.
- Billable Workspace is placeholder only.
- Settlement is placeholder only.
- No settlement, invoice, AR, payment, cash, payroll, or tax records are created.
