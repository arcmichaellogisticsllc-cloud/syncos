# Collections Workspace Product Contract

This is a future UI contract placeholder. The Collections Backend Contract Foundation intentionally does not build Collections UI.

Future workspace routes may include:

- `/collections`
- `/collections/cases/:id`
- `/collections/actions/:id`

The future workspace should expose:

- collection case queue
- case detail
- invoice balance context
- cash application context
- promise-to-pay tracking
- dispute handling
- escalation state
- write-off review readiness
- timeline
- audit, permission protected

The workspace must not create cash receipts, payment applications, payroll, contractor payments, bank transactions, legal filings, tax records, accounting exports, automated dunning, or write-off execution.

Invoice balances must remain read-only in Collections. Payment Application remains the only workflow that reduces invoice balance.
