# Bank Reconciliation Workspace Product Contract

The Bank Reconciliation Workspace is future scope.

Current backend foundation exposes bank accounts, manual bank transactions, reconciliation matches, match review/approval/rejection, exception handling, timeline, audit, and search. No UI is implemented in this sprint.

Future workspace routes may include:

- `/bank-reconciliation`
- `/bank-reconciliation/accounts`
- `/bank-reconciliation/accounts/:id`
- `/bank-reconciliation/transactions/:id`
- `/bank-reconciliation/matches/:id`

Future workspace behavior must:

- show bank account context
- show manual/imported bank transactions
- match debits to payment batches or payment items
- match credits to cash receipts
- show payment applications as context-only
- review, approve, reject, void, and archive matches
- open and resolve exceptions
- ignore/archive transactions
- show timeline and audit with permissions
- clearly distinguish bank-cleared proof from payment execution status

Future workspace must not:

- create bank feeds
- import statements unless a future import sprint approves it
- create payment execution
- create cash receipts
- create payment applications
- update invoice balances
- create accounting exports
- create GL entries
- create tax filings
- create treasury forecasts
- initiate ACH, wire, card payout, check, transfer, payroll provider submission, or any money movement

Boundary language:

“Bank Reconciliation verifies bank activity. It does not move money, create accounting entries, file taxes, or update invoice balances.”
