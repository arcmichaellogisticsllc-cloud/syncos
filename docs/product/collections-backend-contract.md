# Collections Backend Contract Foundation

## Definition

Collections coordinates follow-up on unpaid invoice balances. It manages case ownership, actions, promises to pay, disputes, escalations, write-off review readiness, timeline, audit, and search.

Approved chain:

Billable -> Settlement -> Invoice -> Cash Receipt -> Payment Application -> Invoice Balance -> Collections

Collections does not move money and does not reduce invoice balances. Payment Application remains the only path that updates invoice `paid_amount` and `balance_amount`.

## Objects

`collection_cases` store case-level collection state:

- tenant-scoped `case_number`
- invoice and customer organization context
- case status, priority, risk level, aging bucket
- assigned owner
- balance snapshot and current invoice balance summary
- last payment context
- next action, promise-to-pay, dispute, escalation, and write-off-review fields
- close/archive and audit fields

`collection_actions` store action history:

- source `collection_case_id`
- invoice and customer organization context
- action type, status, date, due/completed timestamps
- actor, contact method, outcome, notes
- promise, dispute, escalation, follow-up, evidence, and override fields
- archive and audit fields

## Routes

- `GET /collection-cases`
- `GET /collection-cases/:id`
- `GET /collection-cases/:id/detail`
- `POST /collection-cases`
- `PATCH /collection-cases/:id`
- `POST /collection-cases/:id/assign-owner`
- `POST /collection-cases/:id/actions`
- `POST /collection-cases/:id/recalculate`
- `POST /collection-cases/:id/close`
- `POST /collection-cases/:id/archive`
- `GET /collection-actions`
- `GET /collection-actions/:id`
- `GET /collection-actions/:id/detail`
- `PATCH /collection-actions/:id`
- `POST /collection-actions/:id/complete`
- `POST /collection-actions/:id/cancel`
- `POST /collection-actions/:id/archive`
- `GET /collection-cases/:id/timeline`
- `GET /collection-actions/:id/timeline`
- `GET /collection-cases/:id/audit-summary`
- `GET /collection-actions/:id/audit-summary`

## Rules

- Collection case creation requires an open invoice balance unless an override is supplied.
- Paid, voided, and archived invoices are blocked from active collections by default.
- Duplicate active cases for the same invoice are blocked unless override is supplied.
- Aging bucket, priority, and risk are deterministically calculated from invoice aging, balance, and dispute state.
- Promise-to-pay actions update case promise fields only.
- Dispute actions may update `invoice.collection_status`; they never mutate invoice amounts.
- Escalation actions update case escalation state only.
- Write-off review actions set readiness state only and do not execute write-off.
- Closing a case with an unresolved balance requires override or an unresolved close reason.
- Read models show current invoice balance context without requiring background automation.

## Boundary

Collections does not create:

- cash receipts
- payment applications
- payroll records
- contractor payments
- ACH/card payouts
- bank transactions
- bank reconciliation records
- deposit batches
- processor charges
- refunds
- tax records
- legal filings
- accounting exports
- automated email/SMS reminders
- collections agency records

Collections may update invoice collection summary/status through audited logic, but it does not update invoice `paid_amount`, `balance_amount`, `last_payment_at`, or `last_payment_amount`.

## Permissions

Collection case:

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

Collection action:

- `collection_action.read`
- `collection_action.create`
- `collection_action.update`
- `collection_action.complete`
- `collection_action.cancel`
- `collection_action.archive`
- `collection_action.timeline.read`
- `collection_action.audit.read`

## Events

Collection case:

- `collection_case.created`
- `collection_case.updated`
- `collection_case.owner_assigned`
- `collection_case.escalated`
- `collection_case.closed`
- `collection_case.archived`
- `collection_case.recalculated`

Collection action:

- `collection_action.created`
- `collection_action.updated`
- `collection_action.completed`
- `collection_action.cancelled`
- `collection_action.archived`

Invoice collection events:

- `invoice.collection_status_changed`
- `invoice.collection_case_opened`
- `invoice.collection_case_closed`
- `invoice.promise_to_pay_recorded`
- `invoice.dispute_opened`
- `invoice.dispute_resolved`

Every write uses the write-action helper so event, event payload, audit log, and system action behavior is preserved.
