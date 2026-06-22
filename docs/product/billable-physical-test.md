# Billable Physical Test

Use after Billable UI is approved. Backend-only smoke coverage is provided by `npm run billable:smoke`.

## Test Script

1. Open Billable Directory.
2. Confirm only tenant-scoped Billable items are visible.
3. Filter by status, readiness, project, work order, customer, provider, rate source, acceptance, documentation, and archived state.
4. Open Billable detail.
5. Confirm Project, Work Order, Production, and QC context.
6. Confirm approved, billable, held, rejected, and correction quantities.
7. Confirm rate source, rate confidence, unit rate, and estimated amount.
8. Confirm retainage estimate and net billable amount.
9. Confirm customer and prime acceptance states.
10. Confirm billing package and documentation status.
11. Recalculate readiness.
12. Attempt mark ready for settlement with blockers.
13. Resolve rate/documentation/acceptance gaps.
14. Mark ready for settlement.
15. Confirm no settlement or settlement item is created.
16. Place item on hold with reason.
17. Release hold with note.
18. Dispute item with reason.
19. Resolve dispute with note.
20. Void item with reason.
21. Archive item with reason.
22. View timeline.
23. View audit as authorized user.
24. Confirm audit hidden from unauthorized user.
25. Confirm no invoice, AR, payment, cash, payroll, or tax records are created.

