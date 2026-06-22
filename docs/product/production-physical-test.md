# Production Physical Test

This test validates the Production Workspace UI and the current backend contract.

## Backend Contract Checks

1. Confirm unauthorized users cannot access `/production-records`.
2. Confirm users without production permissions are blocked.
3. Confirm cross-tenant production access returns not found.
4. Create production against an eligible Work Order.
5. Confirm production does not create settlement, invoice, payment, payroll, AR, or cash records.
6. Add production evidence metadata.
7. Confirm evidence archive requires a reason.
8. Submit draft production.
9. Start review.
10. Approve production.
11. Reject production with reason.
12. Request correction with reason.
13. Mark corrected with note.
14. Mark billable.
15. Confirm no finance records are created.
16. Void production with reason.
17. Archive production with reason.
18. Confirm list returns enriched project, Work Order, provider, crew, quantity, and evidence data.
19. Confirm detail returns context, evidence, quantity, QC, billable, warnings, blockers, timeline flag, and audit flag.
20. Confirm timeline shows production and evidence events.
21. Confirm audit is permission protected.
22. Confirm global search includes production records tenant-safely.

## UI Checks

1. Open `/production`.
2. Filter production records by project, Work Order, production type, status, QC status, billable status, date, provider, crew, foreman, submitter, territory, work type, evidence, corrections, archived, and text search.
3. Create production through `/production/new`.
4. Confirm no settlement, invoice, AR, payment, cash, payroll, or tax records are created.
5. Open `/production/:id`.
6. View the field truth scorecard.
7. View Work Order context.
8. View Project context.
9. View performer context.
10. View quantity summary.
11. Add evidence metadata.
12. Archive evidence metadata with reason.
13. Submit production.
14. Start review.
15. Approve production and confirm approved quantity updates.
16. Reject production with reason.
17. Request correction.
18. Mark corrected.
19. Mark billable.
20. Confirm no settlement, invoice, AR, payment, cash, payroll, or tax records are created.
21. Void with reason.
22. Archive with reason.
23. View timeline.
24. View audit as an authorized user.
25. Confirm audit is hidden for an unauthorized user.
26. Confirm QC Workspace is placeholder only.
27. Confirm Billable Workspace is placeholder only.

No test should pass if Production creates settlement, invoice, AR, payment, cash, payroll, or tax records.
