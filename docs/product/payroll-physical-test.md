# Payroll Physical Test

Validate Payroll Backend Contract Foundation.

1. Create payroll run.
2. Confirm payroll run number is tenant-unique.
3. Confirm invalid payroll run type is rejected.
4. Confirm invalid payroll cycle is rejected.
5. Confirm invalid payroll period is rejected.
6. Add payroll item for valid worker.
7. Confirm worker/source traceability is preserved.
8. Confirm unknown worker classification blocks readiness unless override is supplied.
9. Confirm approved-time item requires hours.
10. Confirm production-based item requires production/work order/project/quantity unless override is supplied.
11. Confirm manual item requires manual reason.
12. Confirm reimbursement item requires amount and note/evidence unless override is supplied.
13. Confirm deduction item requires amount and reason.
14. Confirm duplicate worker/source item is blocked unless override is supplied.
15. Confirm totals recalculate after item add/update/void/archive.
16. Submit review.
17. Start review.
18. Approve payroll run.
19. Confirm approval creates no payment, ACH, card payout, check, bank transaction, payroll provider submission, tax filing, W2, 1099, benefits, garnishment, accounting export, worker portal, or bank reconciliation record.
20. Mark payroll ready.
21. Confirm Payroll Ready creates no payment or provider submission.
22. Place hold.
23. Release hold.
24. Open dispute.
25. Resolve dispute.
26. Reject payroll run.
27. Void payroll item.
28. Archive payroll item.
29. Void payroll run.
30. Archive payroll run.
31. View list and detail read models.
32. View timeline.
33. View audit as authorized user.
34. Confirm audit is hidden for unauthorized user.
35. Confirm global search returns payroll runs and payroll items.
