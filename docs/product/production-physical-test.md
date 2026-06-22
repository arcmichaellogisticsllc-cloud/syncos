# Production Physical Test

This test is for the future Production Workspace and current backend contract validation.

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

## Future UI Checks

When Production Workspace UI is approved, validate:

- Directory filters and search
- Production create/edit forms
- Evidence metadata panel
- QC action panels
- Billable boundary messaging
- Timeline panel
- Audit permission behavior

No test should pass if Production creates settlement, invoice, payment, payroll, AR, or cash records.
