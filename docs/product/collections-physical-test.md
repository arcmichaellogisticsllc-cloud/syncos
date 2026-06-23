# Collections Physical Test

Use this checklist to validate the Collections Workspace UI against the hardened backend.

1. Open `/collections`.
2. Confirm the Collections navigation item is visible.
3. Filter cases by status, priority, risk, aging bucket, owner, dispute status, escalation status, write-off review status, promise, archive state, and search text.
4. Use quick filters for open, in progress, promise to pay, disputed, escalated, awaiting payment, resolved, closed, 90+, due today, overdue follow-up, write-off candidate, and critical risk.
5. Create a collection case from an open invoice at `/collections/new`.
6. Confirm creating a case does not change invoice `paid_amount` or `balance_amount`.
7. Confirm creating a case does not create a cash receipt or payment application.
8. Open the Collection Case Detail page.
9. Confirm the collections scorecard is visible.
10. Confirm invoice context is visible and read-only.
11. Confirm customer context is visible.
12. Confirm cash application context is visible and read-only.
13. Assign an owner.
14. Edit backend-supported case fields.
15. Add an internal note action.
16. Add a promise-to-pay action.
17. Confirm promise-to-pay does not change invoice balance.
18. Add a dispute action.
19. Confirm invoice collection status changes only if the backend supports that controlled update.
20. Add an escalation action.
21. Add a write-off review action.
22. Confirm write-off review does not execute accounting write-off, tax write-off, GL entry, or export.
23. Complete an action.
24. Cancel an action with a reason.
25. Close a case with a reason.
26. Archive a case with a reason.
27. Open `/collection-actions`.
28. Filter collection actions by case, invoice, customer, action type, action status, actor, dates, archive state, and search text.
29. Open a Collection Action Detail page.
30. Archive an action with a reason.
31. View the collection case timeline.
32. View the collection action timeline.
33. View case audit as an authorized user.
34. View action audit as an authorized user.
35. Confirm audit details are hidden for an unauthorized user.
36. Confirm the Cash Application placeholder is informational only and has no cash receipt or payment application creation control.
37. Confirm the Legal placeholder is informational only and triggers no legal filing or collections agency workflow.
38. Confirm the Accounting/Tax placeholder is informational only and triggers no tax, GL, accounting export, or write-off execution.
39. Confirm no email/SMS sending occurs from collection actions.
40. Confirm no payroll, contractor payment, bank transaction, bank reconciliation, ACH, card payout, legal, tax, accounting export, cash receipt, payment application, automated dunning, write-off execution, or collections agency records are created.
