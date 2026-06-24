# Bank Reconciliation Physical Test

Use this script after the Bank Reconciliation backend and web workspace are running.

1. Open `/bank-reconciliation`.
2. Confirm Bank Reconciliation navigation exists in the main nav.
3. Confirm summary cards, bank account queue, bank transaction queue, reconciliation match queue, quick filters, and future placeholders render.
4. Create a bank account from `/bank-reconciliation/accounts/new` with masked data only.
5. Confirm the full account number and credential warning is visible.
6. Open the bank account detail page.
7. Edit the bank account and confirm no credential or token fields exist.
8. Create a manual debit transaction from `/bank-reconciliation/transactions/new`.
9. Create a manual credit transaction.
10. Confirm manual bank transaction copy states that no money, cash receipt, payment, or invoice update is created.
11. Open a debit transaction detail page.
12. Match the debit transaction to a payment batch.
13. Match the debit transaction to a payment item.
14. Open a credit transaction detail page.
15. Match the credit transaction to a cash receipt.
16. Confirm matching does not move money.
17. Confirm matching does not create a cash receipt.
18. Confirm matching does not create a payment application.
19. Confirm matching does not update invoice paid or balance amounts.
20. Open a reconciliation match detail page.
21. Review a match.
22. Approve a match.
23. Reject a match.
24. Void a match.
25. Archive a match.
26. Open a transaction exception.
27. Resolve a transaction exception.
28. Ignore a transaction.
29. Archive a transaction.
30. Confirm reconciliation status, cleared status, exception status, approved match amount, unmatched amount, and recommended next action are visible.
31. View bank account timeline.
32. View bank transaction timeline.
33. View audit as an authorized user.
34. Confirm audit is hidden for an unauthorized user with: "You do not have permission to view bank reconciliation audit details."
35. Confirm Bank Feed placeholder only.
36. Confirm Statement Import placeholder only.
37. Confirm Processor Settlement placeholder only.
38. Confirm Accounting Export placeholder only.
39. Confirm Treasury placeholder only.
40. Confirm no bank feed, statement import, processor settlement, payment execution, cash receipt creation, payment application creation, invoice balance update, accounting export, GL entry, tax filing, treasury forecast, ACH, wire, card payout, check, payroll provider submission, bank transfer, or real money movement workflow is created.

Automated smoke command:

`npm run bank-reconciliation:smoke`
