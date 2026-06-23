# Collections Physical Test

Backend validation checklist:

1. Create an invoice with an open balance.
2. Create a collection case from that invoice.
3. Confirm invoice `paid_amount` and `balance_amount` do not change.
4. Confirm duplicate active case is blocked unless override is supplied.
5. Confirm paid, voided, and archived invoices are blocked by default.
6. Assign a collection owner.
7. Add an internal note action.
8. Add a promise-to-pay action.
9. Confirm promise does not change invoice balance.
10. Add a dispute action.
11. Confirm dispute updates collection status only.
12. Resolve the dispute.
13. Add an escalation action.
14. Add a write-off review action and confirm it is flag-only.
15. Complete a collection action.
16. Cancel a collection action with reason.
17. Close a case with unresolved balance only with allowed reason or override.
18. Archive a collection action with reason.
19. Archive a collection case with reason.
20. View case list/detail and action list/detail.
21. View collection timeline.
22. View audit as authorized user.
23. Confirm audit is blocked for unauthorized user.
24. Search for the collection case.
25. Confirm no cash receipt, payment application, payroll, bank, legal, tax, accounting export, write-off execution, email/SMS, or collections agency records are created.
