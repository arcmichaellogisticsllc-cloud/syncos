# Collections Rules Clarification

Current validated commit: `0f6c16ae247a4877b7aacf99491e36e77d9650ee`

This is a rules clarification document only. It does not implement code, migrations, routes, UI, or business logic.

## 1. Current Backend Inventory

| Area | Classification | Current state |
| --- | --- | --- |
| `invoices` table | Supported | Hardened by `033_invoice_contract_foundation.sql`. Invoice owns receivable fields: `original_amount`, `paid_amount`, `balance_amount`, `aging_days`, `payment_status`, `collection_status`, `cash_application_status`, `last_payment_at`, `last_payment_amount`, and write-off placeholder fields. |
| Invoice routes | Supported | `cash.controller.ts` exposes invoice list/detail/create/update, lifecycle, dispute, overdue, timeline, and audit routes. |
| Invoice receivable fields | Supported | Backend calculates receivable state on invoice creation, approval, sent, ready-for-cash-application, payment application, and payment application void. |
| Invoice dispute fields | Supported | `dispute_reason`, `dispute_note`, `disputed_by`, `disputed_at`; invoice dispute route sets `collection_status = disputed`. |
| Invoice writeoff fields | Partially supported | `writeoff_amount` and `writeoff_reason` exist on invoices; no governed write-off workflow exists. |
| `cash_receipts` table/routes | Supported | First-class receipt object exists with list/detail/create/update/apply/void/archive/timeline/audit. |
| `payment_applications` table/routes | Supported | First-class payment application object exists with list/detail/void/archive/timeline/audit. Applying cash updates invoice balance through audited logic. |
| Cash Application relationship to invoices | Supported | Payment applications update invoice `paid_amount`, `balance_amount`, `payment_status`, `collection_status`, and cash application state. |
| Customer organizations | Supported | Organizations are tenant-scoped and referenced by invoices, cash receipts, and payment applications. |
| Customer payment stats | Partially supported | Legacy `customer_payment_stats` exists from the original finance migration. It is not part of the new Cash Application or Collections contract yet. |
| Reports controller | Partially supported | Existing reports cover compliance, billing completeness, and constraints. No Collections report exists. |
| Legacy `ar_records` | Supported legacy/deprecated | Table exists and legacy smoke coverage references it. New Invoice/Cash contracts do not use it as the default receivable object. |
| Legacy `payments` | Supported legacy/deprecated | Table exists from the original finance migration. New Cash Application uses `cash_receipts` and `payment_applications` instead. |
| Notes/tasks/workflow model | Partially supported | Generic workflow definitions, instances, tasks, and escalations exist. They are not collections-specific and do not model promise-to-pay, collection case ownership, or collection action history. |
| Recommendations/constraints | Partially supported | Constraints and recommendations exist and can represent operational risk, but no Collections-specific integration exists. |
| Search support | Partially supported | Global search includes invoices, invoice items, cash receipts, payment applications, legacy payments, workflows, constraints, and recommendations. It does not include collection cases/actions because they do not exist. |
| Invoice/cash permissions | Supported | Invoice, invoice item, cash receipt, payment application, and invoice cash application permissions are seeded and typed. |
| Collections permissions | Missing | No `collection_case.*` or `collection_action.*` permissions exist. |
| Events | Partially supported | Invoice and cash application events exist, including `invoice.payment_applied`, `invoice.balance_updated`, and invoice dispute events. Collections-specific events are missing. |
| Audit behavior | Supported pattern | Existing write routes use write-action behavior that creates event/audit/system_action. Collections should follow the same pattern. |
| Smoke tests | Partially supported | Invoice and Cash Application smokes validate receivable state, disputes, payment application, and no AR/cash boundary violations. No collections smoke exists. |
| Invoice/Cash docs | Supported | Invoice and Cash Application backend/workspace docs define receivable ownership, cash application, and future Collections placeholder boundaries. |
| Collection cases/actions | Missing | No collection case or collection action objects, routes, permissions, events, docs, or smoke tests exist. |

Object model options:

- Option A, fields only on invoices: partially supported by invoice `collection_status`, but insufficient for action history.
- Option B, first-class `collection_cases` and `collection_actions`: missing, but best supports durable history.
- Option C, workflow tasks only: partially supported generically, but unsafe to infer for Collections-specific state.
- Option D, hybrid: recommended. Invoices keep collection summary fields; collection cases/actions store ownership, actions, promise, dispute, escalation, and write-off review history.

## 2. Collections Definition

Collections is a controlled follow-up and risk-management layer for invoices with open balances, overdue balances, disputes, promises to pay, or escalation needs.

Collections represents:

- open invoice balance review
- collection owner
- collection priority
- aging bucket
- collection status
- follow-up actions
- customer contact attempts
- promises to pay
- disputes
- escalation status
- write-off readiness
- collection notes
- next action
- risk level
- audit history

Collections does not represent:

- invoice creation
- payment receipt
- cash application
- bank reconciliation
- legal action filing
- tax write-off
- accounting export
- contractor payment
- payroll

## 3. Core Collections Principle

Collections does not create money movement.

Collections does not erase balances.

Collections coordinates follow-up on unpaid invoice balances.

Approved chain:

`Invoice Balance -> Collection Case -> Collection Action -> Promise / Dispute / Escalation -> Future Payment or Write-Off Review`

Never:

- `Collections -> Cash Receipt`
- `Collections -> Payment Application`
- `Collections -> Payroll`
- `Collections -> Legal Filing`
- `Collections -> Tax Write-Off`

Collections may recommend action, but it must not execute cash, legal, tax, payroll, contractor payable, accounting export, or bank workflows.

## 4. Collections Relationship To Invoice

Collections consumes invoice receivable state:

- `invoice_id`
- `customer_organization_id`
- `invoice_number`
- `original_amount`
- `paid_amount`
- `balance_amount`
- `aging_days`
- `payment_status`
- `collection_status`
- `due_date`
- `delivery_status`
- dispute state
- `last_payment_at`
- `last_payment_amount`

Rules:

- Only invoices with `balance_amount > 0` normally enter collections.
- Paid invoices should not have active collection cases.
- Voided or archived invoices should not have active collection cases.
- Disputed invoices may enter dispute-focused collection cases.
- Collection actions must not directly edit invoice balances.
- Collection outcome may update `invoice.collection_status` only through controlled backend logic.
- Payment application remains the only way to reduce invoice balance.

## 5. Collections Relationship To Cash Application

Collections should show:

- last payment date
- last payment amount
- payment application history
- unapplied cash for customer if available
- partial payment state
- cash application readiness

Rules:

- Collection users may view cash application context when permission allows.
- Collection actions may recommend applying unapplied cash.
- Collections must not apply cash directly unless a future approved workflow explicitly connects a collection action to Cash Application.
- Collections must not create cash receipts.
- Collections must not create payment applications.

## 6. Object Model Options

### Option A: Fields Only On Invoices

Pros:

- simple
- fewer objects

Cons:

- weak history
- poor action tracking
- no promise-to-pay history
- no escalation audit

### Option B: First-Class Collection Cases And Collection Actions

Pros:

- durable history
- supports ownership, priorities, promises, escalations
- supports reporting and audits
- separates invoice balance from follow-up activity

Cons:

- more objects

### Option C: Workflow Tasks Only

Pros:

- uses existing workflow infrastructure

Cons:

- too generic
- weak Collections-specific state
- unsafe to infer promise, dispute, and write-off behavior from workflow tasks alone

### Option D: Hybrid

Invoices keep collection summary fields. `collection_cases` store collection ownership/status. `collection_actions` store attempts, notes, promises, disputes, and escalations.

Recommendation: use hybrid Option D.

## 7. Proposed `collection_cases` Object

Future `collection_cases` fields:

- `id`
- `tenant_id`
- `invoice_id`
- `customer_organization_id`
- `case_number`
- `case_status`
- `collection_priority`
- `risk_level`
- `aging_bucket`
- `assigned_owner_user_id` nullable
- `opened_at`
- `closed_at` nullable
- `close_reason` nullable
- `balance_at_open`
- `current_balance`
- `original_invoice_amount`
- `last_payment_at` nullable
- `last_payment_amount` nullable
- `next_action_type` nullable
- `next_action_due_at` nullable
- `promise_to_pay_date` nullable
- `promise_to_pay_amount` nullable
- `dispute_status`
- `escalation_status`
- `writeoff_review_status`
- `notes` nullable
- `override_reasons` jsonb
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Case statuses:

- `open`
- `in_progress`
- `promise_to_pay`
- `disputed`
- `escalated`
- `awaiting_payment`
- `resolved`
- `closed`
- `archived`

Collection priorities:

- `low`
- `medium`
- `high`
- `urgent`

Risk levels:

- `low`
- `medium`
- `high`
- `critical`

Aging buckets:

- `current`
- `1_30`
- `31_60`
- `61_90`
- `90_plus`

Dispute statuses:

- `none`
- `open`
- `under_review`
- `resolved`
- `rejected`

Escalation statuses:

- `none`
- `internal_escalation`
- `executive_escalation`
- `legal_review_later`
- `collections_agency_later`

Write-off review statuses:

- `not_applicable`
- `not_ready`
- `candidate`
- `under_review_later`
- `approved_later`
- `rejected_later`

## 8. Proposed `collection_actions` Object

Future `collection_actions` fields:

- `id`
- `tenant_id`
- `collection_case_id`
- `invoice_id`
- `customer_organization_id`
- `action_type`
- `action_status`
- `action_date`
- `due_at` nullable
- `completed_at` nullable
- `actor_user_id`
- `contact_id` nullable
- `contact_method` nullable
- `outcome` nullable
- `note` nullable
- `promise_to_pay_date` nullable
- `promise_to_pay_amount` nullable
- `dispute_reason` nullable
- `escalation_reason` nullable
- `follow_up_required`
- `follow_up_due_at` nullable
- `evidence_reference` nullable
- `override_reasons` jsonb
- `created_by`
- `updated_by`
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `created_at`
- `updated_at`

Action types:

- `call`
- `email`
- `text`
- `portal_message`
- `internal_note`
- `promise_to_pay`
- `dispute_opened`
- `dispute_updated`
- `dispute_resolved`
- `payment_reminder`
- `follow_up_scheduled`
- `escalation_requested`
- `escalation_approved`
- `writeoff_review_requested`
- `case_closed`

Action statuses:

- `planned`
- `completed`
- `failed`
- `cancelled`
- `archived`

Contact methods:

- `phone`
- `email`
- `sms`
- `portal`
- `in_person`
- `internal`

Outcomes:

- `no_response`
- `left_message`
- `contacted`
- `promise_received`
- `payment_received_later`
- `dispute_reported`
- `wrong_contact`
- `follow_up_needed`
- `escalated`
- `resolved`

## 9. Collection Case Creation Rules

Future route:

`POST /collection-cases`

Required:

- `invoice_id`

Optional:

- `assigned_owner_user_id`
- `collection_priority`
- `notes`
- `override_reasons`

Validation:

- actor has `collection_case.create`
- invoice belongs to tenant
- invoice `balance_amount > 0` unless override
- invoice is not voided or archived
- no active collection case exists for invoice unless override
- customer organization exists
- `case_number` generated
- `aging_bucket` derived from invoice aging/due date
- `current_balance` copied from invoice balance amount
- status defaults `open`
- risk level calculated from aging, balance, dispute, and customer risk if available

On create:

- `collection_case.created`
- audit/system_action

No cash receipt.

No payment application.

No invoice balance change.

## 10. Collection Action Creation Rules

Future route:

`POST /collection-cases/:id/actions`

Required:

- `action_type`
- `note` or `due_at` depending action

Optional:

- `contact_id`
- `contact_method`
- `outcome`
- `promise_to_pay_date`
- `promise_to_pay_amount`
- `dispute_reason`
- `escalation_reason`
- `follow_up_required`
- `follow_up_due_at`
- `evidence_reference`
- `override_reasons`

Validation:

- actor has `collection_action.create`
- case belongs to tenant
- invoice belongs to tenant
- action type approved
- `promise_to_pay` requires date and amount
- `dispute_opened` requires dispute reason
- `escalation_requested` requires escalation reason
- `writeoff_review_requested` requires high authority or permission
- no direct balance changes

On create:

- `collection_action.created`
- case summary fields update if applicable
- `invoice.collection_status` may update if applicable
- audit/system_action

No cash receipt.

No payment application.

## 11. Promise-To-Pay Model

Promise to pay tracks a customer commitment.

Fields:

- `promise_to_pay_date`
- `promise_to_pay_amount`
- `action_id`
- `case_id`
- `invoice_id`

Rules:

- Promise amount cannot exceed invoice balance unless override.
- Promise date must be today or future.
- Promise does not change invoice balance.
- Promise does not mark invoice paid.
- Missed promise may increase risk/priority later.
- Fulfilled promise is inferred from payment application later.

If a first-class promise object is approved later, possible statuses are:

- `active`
- `fulfilled_later`
- `missed_later`
- `cancelled`
- `replaced`

Recommended first implementation: store promise fields on `collection_case` and `collection_action`. Do not create a first-class promise object yet.

## 12. Dispute Model

Collections may manage invoice disputes.

Rules:

- Dispute opened sets `collection_case.dispute_status = open`.
- Invoice `collection_status` may become `disputed`.
- Dispute does not change balance.
- Dispute resolution does not reduce balance unless a future credit/payment/write-off workflow exists.
- Payment application can still apply to disputed invoice only through override.
- Disputes must include a reason.

Dispute reasons:

- `pricing_issue`
- `quantity_dispute`
- `documentation_missing`
- `customer_not_approved`
- `duplicate_invoice`
- `wrong_customer`
- `work_not_accepted`
- `retainage_issue`
- `other`

## 13. Escalation Model

Escalations represent higher-level review, not legal action.

Escalation statuses:

- `none`
- `internal_escalation`
- `executive_escalation`
- `legal_review_later`
- `collections_agency_later`

Rules:

- Escalation requires a reason.
- Escalation does not file a legal claim.
- Escalation does not send the account to a collections agency automatically.
- Legal and agency steps are future workflows.

## 14. Dunning / Reminder Model

Dunning means structured reminders.

Reminder types:

- `friendly_reminder`
- `due_today`
- `past_due`
- `final_notice_later`

Rules:

- First sprint may store reminder actions only.
- No automated email/SMS sending.
- No customer portal message sending.
- No external dunning automation.
- Reminders are planned or completed `collection_actions`.

## 15. Aging And Priority Model

Aging buckets:

- `current`
- `1_30`
- `31_60`
- `61_90`
- `90_plus`

Priority factors:

- balance amount
- aging days
- customer risk
- dispute status
- missed promise
- repeated no response
- strategic customer flag if available

Recommended basic priority:

- `current`: `low`
- `1_30`: `medium`
- `31_60`: `high`
- `61_90`: `high`
- `90_plus`: `urgent`

Large balances may raise priority. Disputes may raise or special-route priority.

## 16. Write-Off Readiness Model

Write-off is not Collections itself.

Collections can flag write-off review readiness.

Rules:

- `writeoff_review_status` may become `candidate`.
- No balance write-off in Collections Backend Foundation.
- No accounting action.
- No tax action.
- No GL entry.
- No invoice amount mutation.

Write-off workflow is a future governed sprint.

## 17. Customer Risk Relationship

Collections should update or contribute to customer risk later.

Potential customer-level signals:

- repeated late payments
- high overdue balance
- frequent disputes
- broken promises
- slow payment history
- unapplied cash patterns

First implementation: case-level risk only.

Customer master risk score update is deferred unless an existing safe reputation/risk model is explicitly approved for Collections.

## 18. Reporting Relationship

Collections should support future reporting:

- open collection cases
- overdue balance
- aging buckets
- promises due
- disputes open
- escalated cases
- collection owner workload
- high-risk customers

Existing reports do not provide Collections-specific reporting. Do not build reporting UI in the clarification sprint.

## 19. Legal / Accounting / Tax Boundary

Collections must not create:

- legal filing
- lien
- demand letter as legal instrument
- accounting export
- tax write-off
- GL journal entry
- bad debt accounting

Legal, accounting, and tax workflows are future scope.

## 20. Contractor Payable / Payroll Boundary

Customer collections do not create contractor payment actions.

Collections must not create:

- contractor payment
- payroll
- ACH payout
- card payout
- settlement payable change

Contractor payables remain a separate future layer.

## 21. Collections Permissions

Proposed collection case permissions:

- `collection_case.read`
- `collection_case.create`
- `collection_case.update`
- `collection_case.assign_owner`
- `collection_case.escalate`
- `collection_case.close`
- `collection_case.archive`
- `collection_case.timeline.read`
- `collection_case.audit.read`

Proposed collection action permissions:

- `collection_action.read`
- `collection_action.create`
- `collection_action.update`
- `collection_action.complete`
- `collection_action.cancel`
- `collection_action.archive`

Role guidance:

- Billing Admin can create/update cases and actions.
- Collections Specialist can manage cases/actions.
- Finance Manager can escalate/close.
- Executive/System Admin can override.
- Operations and project users may view related cases if permitted.

## 22. Collections Events

Proposed collection case events:

- `collection_case.created`
- `collection_case.updated`
- `collection_case.owner_assigned`
- `collection_case.escalated`
- `collection_case.closed`
- `collection_case.archived`

Proposed collection action events:

- `collection_action.created`
- `collection_action.updated`
- `collection_action.completed`
- `collection_action.cancelled`
- `collection_action.archived`

Proposed invoice collection events:

- `invoice.collection_status_changed`
- `invoice.collection_case_opened`
- `invoice.collection_case_closed`
- `invoice.promise_to_pay_recorded`
- `invoice.dispute_opened`
- `invoice.dispute_resolved`

Every write must create:

- event
- event_payload
- audit_log
- system_action

using the existing write-action helper.

## 23. Audit Requirements

Collections audit must capture:

- actor
- tenant
- invoice_id
- collection_case_id
- collection_action_id
- customer_organization_id
- balance at time of action
- aging at time of action
- case status before/after
- collection status before/after
- priority before/after
- promise date/amount
- dispute reason
- escalation reason
- notes
- override reasons
- timestamp
- correlation id

## 24. Search

Future search should include:

- `collection_cases`
- `collection_actions`

Search fields:

- case number
- invoice number
- customer
- action note
- dispute reason
- escalation reason
- promise data

Search must remain tenant scoped. Archived cases/actions should be excluded unless `archived=true`.

## 25. Recommended Backend Foundation Scope

Recommended next coding sprint: Collections Backend Contract Foundation.

Build:

- `collection_cases`
- `collection_actions`
- create case from invoice
- assign owner
- update priority/status
- add action
- complete/cancel action
- promise-to-pay action
- dispute action
- escalation action
- close/archive case
- timeline/audit
- search
- smoke test
- release validation wiring

Do not build:

- automated reminders
- email/SMS sending
- legal filing
- write-off execution
- tax/accounting export
- cash receipt creation
- payment application
- contractor payable/payroll
- customer portal
- collections agency integration

## 26. Required Product Confirmations

1. Should Collections use hybrid `collection_cases` + `collection_actions`?
2. Should invoices keep collection summary fields?
3. Should only invoices with balance > 0 enter active collections by default?
4. Should paid invoices automatically close collection cases?
5. Should payment application trigger case status updates?
6. Should promise-to-pay be stored on collection case/action first, not a first-class promise object?
7. Should disputes update `invoice.collection_status`?
8. Should dispute resolution ever reduce invoice balance? Recommended: no.
9. Should collection actions send emails/SMS automatically? Recommended: no.
10. Should dunning be manual/planned actions first?
11. Should write-off review be flag-only for now?
12. Should escalations be internal only for now?
13. Should legal/collections agency workflows be future scope?
14. Who can create collection cases?
15. Who can close collection cases?
16. Who can escalate cases?
17. Who can request write-off review?
18. Should Collections update customer risk now or later?
19. Should reporting be read-only later?
20. Should Collections ever create cash receipts or payment applications? Recommended: no.

Recommended answers:

- Yes, use hybrid `collection_cases` and `collection_actions`.
- Yes, invoices keep summary fields such as `collection_status`, `aging_days`, and balance.
- Active collections should normally require `balance_amount > 0`.
- Paid invoices should close or resolve active collection cases through audited backend logic.
- Payment application may update case status/readiness later, but it must not happen silently.
- Store promise-to-pay on case/action first.
- Dispute resolution should not reduce invoice balance.
- Keep reminders manual/planned first.
- Keep write-off review flag-only.
- Keep legal, agency, accounting, tax, and collections automation future scope.
- Collections must not create cash receipts or payment applications.

## 27. Validation

Non-mutating checks performed for this clarification:

- `git status --short`
- inspected invoice and cash migrations
- inspected legacy finance migration
- inspected invoice/cash routes
- inspected reports controller
- inspected workflow task model
- inspected permissions seed/type union
- inspected search support
- inspected smoke tests
- inspected Invoice and Cash Application docs
- `git diff --check`

No application code, migrations, routes, or UI were changed.

## GO / NO-GO Recommendation

GO: Collections Backend Contract Foundation after product confirms the required questions above, especially hybrid `collection_cases` + `collection_actions`, no cash/payment creation, payment-application-triggered case updates, and write-off boundaries.

NO-GO: Collections Workspace UI, automated reminders, email/SMS sending, legal workflows, write-off execution, accounting export, tax, customer portal, payroll, contractor payments, bank reconciliation, cash receipt creation, and payment application creation from Collections.
