# Accounting Export Physical Test

Validate the Accounting Export Workspace UI.

1. Open `/accounting-exports`.
2. Filter export batches by status, export type, target system, export format, mapping errors, archived state, and text search.
3. Create export batch.
4. Add invoice export item.
5. Add cash receipt export item.
6. Add payment application export item.
7. Add contractor payable export item.
8. Add payroll export item.
9. Add payment execution export item.
10. Add bank reconciliation export item.
11. Confirm no source record is mutated.
12. Confirm no QuickBooks, Sage, NetSuite, ERP, or API call is made.
13. Confirm no GL entry or journal is created.
14. Confirm no tax filing, W2, or 1099 is created.
15. Confirm no payment or bank transaction is created.
16. View batch detail.
17. View item detail.
18. View mapping status.
19. Edit mapping fields.
20. Recalculate totals.
21. Generate status only.
22. Submit review.
23. Start review.
24. Approve.
25. Mark submitted manually.
26. Mark accepted manually.
27. Mark failed.
28. Cancel batch.
29. Archive batch.
30. Archive export item.
31. View timeline.
32. View audit as authorized user.
33. Confirm audit hidden for unauthorized user.
34. Confirm QuickBooks placeholder only.
35. Confirm ERP placeholder only.
36. Confirm GL placeholder only.
37. Confirm Tax placeholder only.
38. Confirm Accounting Close placeholder only.
39. Confirm File Download placeholder only.

Automated backend smoke remains:

`npm run accounting-export:smoke`
