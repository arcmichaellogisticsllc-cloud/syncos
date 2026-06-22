# Billable Physical Test

## Preconditions

- Backend migrations are applied.
- Seed data is present.
- User has Billable permissions.
- Approved QC reviews and approved production records exist.

## Test Steps

1. Open `/billable`.
2. Confirm the Billable Queue loads.
3. Filter billable items by status, readiness, project, work order, production record, QC review, customer, provider, crew, rate source, rate confidence, acceptance, package status, retainage, hold, dispute, archived state, and q search.
4. Confirm summary cards filter the queue.
5. Open `/billable/new`.
6. Create billable candidate from approved QC.
7. Confirm no settlement, settlement item, invoice, AR, payment, cash, payroll, or tax record is created.
8. Open Billable Detail.
9. View financial eligibility scorecard.
10. View QC context.
11. View production context.
12. View Work Order context.
13. View Project context.
14. View quantity and amount.
15. View rate readiness.
16. View documentation readiness.
17. View customer/prime acceptance.
18. View retainage.
19. Edit allowed billable fields.
20. Recalculate readiness.
21. Attempt mark ready for settlement with blockers.
22. Resolve rate/documentation/acceptance gaps or provide backend-allowed overrides.
23. Mark ready for settlement.
24. Confirm no settlement or settlement item is created.
25. Place item on hold with reason.
26. Release hold with note.
27. Dispute item with reason.
28. Resolve dispute with note.
29. Void item with reason.
30. Archive item with reason.
31. View timeline.
32. View audit as authorized user.
33. Confirm audit hidden from unauthorized user.
34. Confirm Settlement placeholder only.
35. Confirm Invoice placeholder only.
36. Confirm no invoice, AR, payment, cash, payroll, or tax records are created.

## Pass Criteria

- Billable navigation exists.
- Billable Queue is usable.
- Billable Create/Edit works.
- Billable Detail is usable.
- Financial eligibility scorecard is visible.
- QC context is visible.
- Production context is visible.
- Work Order context is visible.
- Project context is visible.
- Quantity and amount are visible.
- Rate readiness is visible.
- Documentation readiness is visible.
- Customer/prime acceptance is visible.
- Retainage is visible.
- Hold/dispute actions work.
- Mark ready for settlement works through backend.
- Timeline is visible.
- Audit is permission-protected.
- Settlement placeholder only.
- Invoice placeholder only.
- No settlement, invoice, AR, payment, cash, payroll, or tax records are created.
