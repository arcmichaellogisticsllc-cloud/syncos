# Accounting Export Workspace Product Contract

No Accounting Export UI is implemented in this backend foundation sprint.

Future workspace scope may expose:

- export batch queue
- export batch detail
- export item management
- source context
- mapping status review
- export status review
- generate/review/approval actions
- manual submitted/accepted/failed status actions
- timeline and audit views

The future UI must use backend routes only and must not direct-query the database.

Future UI must not:

- integrate QuickBooks, Sage, NetSuite, or ERP APIs
- post GL entries
- create journals
- file taxes
- generate W2s or 1099s
- close periods
- create payments
- create bank transactions
- mutate source financial facts
- provide file downloads unless a later backend contract explicitly supports them

Placeholders should make clear that accounting-system submission, GL posting, accounting close, tax filing, and file downloads are future workflows.
