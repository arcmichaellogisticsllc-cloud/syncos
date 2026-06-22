# QC Physical Test

## Preconditions

- Backend migrations are applied.
- Seed data is present.
- User has QC review permissions.
- Submitted production records exist.

## Test Steps

1. Open QC review list endpoint or future QC directory.
2. Confirm list rows include production, work order, project, status, quantities, reviewer, and recommended next action.
3. Create a QC review for submitted production.
4. Start review.
5. Attempt self approval as the submitting non-admin reviewer.
6. Confirm self approval is blocked.
7. Approve review with approved quantity.
8. Confirm rejected quantity defaults to claimed minus approved when omitted.
9. Confirm billable candidate quantity is stored when supplied.
10. Confirm production summary fields update through backend action.
11. Confirm no settlement, invoice, payment, AR, cash, or payroll record is created.
12. Create another QC review and reject it with a reason.
13. Confirm production summary shows rejected state.
14. Create another QC review and request correction with reason.
15. Confirm correction state is stored on QC review and production summary.
16. Mark correction as corrected.
17. View QC timeline.
18. Confirm timeline shows create/start/approve/reject/correction events.
19. View QC audit as authorized user.
20. Confirm audit is blocked for unauthorized user.
21. Search for QC review notes.
22. Confirm tenant-scoped search returns the QC review.

## Pass Criteria

- QC review history is durable.
- Production summary is synchronized only through backend write actions.
- Self approval is blocked by default.
- Correction traceability exists.
- Timeline and audit endpoints work.
- No finance records are created.
