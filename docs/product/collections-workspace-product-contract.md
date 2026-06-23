# Collections Workspace Product Contract

Collections is the operator workspace for follow-up governance on unpaid invoice balances. It exposes the hardened Collections backend and keeps invoice balances, cash receipts, payment applications, legal actions, tax actions, accounting exports, payroll, and contractor payment workflows out of scope.

## Routes

- `/collections` shows the Collection Case Queue.
- `/collections/new` creates a collection case from an invoice.
- `/collections/:id` shows collection case detail.
- `/collections/:id/edit` edits backend-supported case fields.
- `/collection-actions` shows collection actions across cases.
- `/collection-actions/:id` shows action detail.

The optional scoped invoice route is deferred unless a future sprint confirms a shared component can be reused without adding invoice behavior.

## Queue

The Collection Case Queue includes summary cards for total cases, open, in progress, promise to pay, disputed, escalated, awaiting payment, resolved, closed, archived, aging buckets, high/critical risk, due follow-up, and write-off candidates.

The queue table shows case number, case status, customer, invoice number, current balance, original invoice amount, aging bucket, priority, risk level, owner, last payment, next action, promise, dispute status, escalation status, write-off review status, recommended next action, and updated date.

Filters include case status, priority, risk level, aging bucket, customer, invoice, owner, dispute status, escalation status, write-off review status, next action due range, has promise, overdue promise, archived/active, and text search. Quick filters expose the primary operational states and high-risk follow-up views.

## Create And Edit

The create form posts to `POST /collection-cases` with invoice, optional assigned owner, collection priority, notes, and override reasons. Backend validation remains authoritative. Creating a case must not update invoice balances, create cash receipts, create payment applications, or send messages.

The edit form patches `PATCH /collection-cases/:id` for assigned owner, priority, risk level, next action type, next action due date, notes, and override reasons where the backend allows it. Invoice balance fields are never editable.

## Case Detail

The detail workspace shows a header, collections scorecard, strategic sidebar, and tabs for overview, invoice context, customer context, cash application context, collection actions, promise-to-pay, dispute, escalation, write-off review, aging and priority, timeline, audit, future cash application, future legal, and future accounting/tax.

Invoice context is read-only and includes invoice status, cash application status, payment status, collection status, original amount, paid amount, balance amount, aging days, due date, and last payment fields.

Cash application context is read-only. The workspace may show payment application count, cash receipt count, unapplied cash, last payment date, and last payment amount if exposed by the backend. Operators must use Cash Application to record or apply payments.

## Actions

Case actions use backend lifecycle routes:

- `POST /collection-cases/:id/assign-owner`
- `POST /collection-cases/:id/actions`
- `POST /collection-cases/:id/close`
- `POST /collection-cases/:id/archive`
- `POST /collection-actions/:id/complete`
- `POST /collection-actions/:id/cancel`
- `POST /collection-actions/:id/archive`

The add-action modal supports action type, status, action date, due date, contact, contact method, outcome, note, promise date and amount, dispute reason, escalation reason, follow-up fields, evidence reference, and override reasons. Conditional requirements are enforced by the backend.

No action sends email/SMS, creates a cash receipt, creates a payment application, reduces an invoice balance, triggers legal filing, executes write-off, or creates tax/accounting/payroll records.

## Promise, Dispute, Escalation, And Write-Off Readiness

Promise-to-pay actions show promise date, promise amount, current balance, and related actions. A promise does not change invoice balance.

Dispute actions show dispute status, dispute reason, related actions, and invoice collection status. Dispute resolution does not reduce balance; credits and write-offs remain future governed workflows.

Escalation actions show escalation status and related actions. Legal review and collections agency states are informational only in this sprint.

Write-off review readiness is a flag only. It does not execute accounting write-off, tax write-off, GL entry, or export.

## Aging And Priority

Aging bucket, priority, risk, balance, dispute modifiers, promise modifiers, and recommended next action are displayed from backend read models. The UI does not implement independent scoring logic.

## Action Workspace

`/collection-actions` lists actions by action type, status, case number, invoice number, customer, action date, due date, completion, actor, contact method, outcome, follow-up requirement, follow-up due, and updated date.

`/collection-actions/:id` shows action detail, case context, invoice context, customer context, actor context, promise/dispute/escalation fields, follow-up fields, timeline, and audit.

## Timeline And Audit

Case timeline uses `GET /collection-cases/:id/timeline`. Action timeline uses `GET /collection-actions/:id/timeline`.

Case audit uses `GET /collection-cases/:id/audit-summary`. Action audit uses `GET /collection-actions/:id/audit-summary`. Audit views are permission controlled and show an unauthorized message when the backend denies access.

## Permissions

The UI surfaces and respects:

- `collection_case.read`
- `collection_case.create`
- `collection_case.update`
- `collection_case.assign_owner`
- `collection_case.escalate`
- `collection_case.writeoff_review`
- `collection_case.close`
- `collection_case.archive`
- `collection_case.timeline.read`
- `collection_case.audit.read`
- `collection_action.read`
- `collection_action.create`
- `collection_action.update`
- `collection_action.complete`
- `collection_action.cancel`
- `collection_action.archive`
- `collection_action.timeline.read`
- `collection_action.audit.read`

The backend remains authoritative for permissions, tenant isolation, lifecycle validation, events, audit logs, and system actions.

## Boundaries

Collections is follow-up governance only. The workspace must not create cash receipts, payment applications, payroll, contractor payments, bank reconciliation, bank transactions, ACH/card payouts, legal filings, collections agency records, tax records, accounting exports, automated dunning, email/SMS messages, or write-off execution.

Invoice balances remain read-only. Payment Application remains the only approved path that reduces invoice balance.
