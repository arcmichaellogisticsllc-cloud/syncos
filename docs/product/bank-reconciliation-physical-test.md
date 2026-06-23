# Bank Reconciliation Physical Test

Use this script after the backend foundation is running.

1. Confirm an unauthorized request to `GET /bank-accounts` is blocked.
2. Confirm a user without `bank_account.read` is blocked.
3. Create a bank account with masked account data.
4. Confirm a full account number is rejected.
5. Confirm credentials, tokens, passwords, and login fields are rejected.
6. Update bank account notes.
7. Create a manual debit bank transaction.
8. Create a manual credit bank transaction.
9. Confirm invalid direction is rejected.
10. Confirm invalid transaction type is rejected.
11. Confirm non-positive amount is rejected.
12. Match debit transaction to an executed/status-only payment batch.
13. Match debit transaction to an executed/status-only payment item.
14. Confirm credit-to-payment match is blocked unless override.
15. Match credit transaction to a cash receipt.
16. Review a reconciliation match.
17. Approve a reconciliation match.
18. Reject a reconciliation match.
19. Void a reconciliation match and confirm transaction status recalculates.
20. Archive a reconciliation match.
21. Confirm full approved matches set transaction status to `matched`.
22. Confirm partial approved matches set transaction status to `partially_matched`.
23. Confirm overmatch is blocked unless override.
24. Open a bank transaction exception.
25. Resolve a bank transaction exception.
26. Ignore a bank transaction.
27. Archive a bank transaction.
28. View bank account detail.
29. View bank transaction detail.
30. View reconciliation match detail.
31. View bank transaction timeline.
32. Confirm audit summary requires permission.
33. Search for bank account, bank transaction, and reconciliation match records.
34. Confirm no bank feed, statement import, processor settlement, payment execution, cash receipt creation, payment application creation, invoice balance update, accounting export, GL entry, tax filing, treasury forecast, ACH, wire, card payout, check, payroll provider submission, or real money movement is created.

Automated smoke command:

`npm run bank-reconciliation:smoke`
