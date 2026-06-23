# Payment Execution Rules Clarification

Current validated commit: `6983a88a055723bc64dd61eb541cd9970f95ca93`

This is a rules clarification document only. No code, migrations, routes, UI, or backend objects are implemented in this sprint.

## 1. Current Backend Inventory

| Area | Current state | Classification | Notes |
| --- | --- | --- | --- |
| `contractor_payables` | First-class table, routes, lifecycle, timeline, audit, search, smoke coverage. | Supported | Stores payable obligations through approval and `payment_readiness_status`. Stops at `payment_ready`. |
| `contractor_payable_items` | First-class payable line table with source traceability and future `payment_item_id`. | Supported | `payment_item_id` exists as a future link, but no payment item table exists. |
| Contractor payment readiness | `payment_readiness_status` supports `not_ready`, `ready_with_warning`, `ready_for_payment`, `blocked`; status supports `payment_ready`. | Supported | Marking ready creates no payment, payroll, ACH/card, bank, tax, accounting, portal, or cash movement records. |
| `payroll_runs` | First-class table, routes, lifecycle, timeline, audit, search, smoke coverage. | Supported | Stores payroll approval/readiness only. Stops at `payroll_ready`. |
| `payroll_items` | First-class worker compensation item table with worker/source traceability and future `payment_item_id`. | Supported | `payment_item_id` exists as a future link, but no payment item table exists. |
| Payroll readiness | `payroll_readiness_status` supports `not_ready`, `ready_with_warning`, `ready_for_payroll`, `blocked`; status supports `payroll_ready`. | Supported | Marking payroll ready creates no payment, ACH/card/check, provider submission, bank, tax, or accounting records. |
| `cash_receipts` | Hardened inbound cash receipt model exists. | Supported | Revenue-side money received; not usable for money-out Payment Execution. |
| `payment_applications` | Hardened invoice application model exists. | Supported | Applies received customer cash to invoices; not outbound payment execution. |
| Legacy `payments` table/routes | Legacy table exists for invoice-side payment/reconciliation concepts. Search and finance-context reads still reference it. | Partially supported / unsafe to infer | Name conflicts with future outbound payment execution. Do not reuse as new Payment Execution source of truth without explicit migration/deprecation strategy. |
| Invoice payment fields | Invoice receivable state and payment status are supported through Invoice and Cash Application layers. | Supported | Revenue-side only. Do not use for outbound payment execution. |
| Worker records | Workers table/routes exist and Payroll references workers. | Supported | Worker identity supports Payroll source/payee context, but payment destination fields are not confirmed. |
| Capacity providers | Capacity providers table/routes exist and Contractor Payable references providers. | Supported | Provider identity supports payee context, but payment destination fields are not confirmed. |
| Crews | Crews table/routes exist and Contractor Payable/Payroll reference crews. | Supported | Crew entity may be payable context; individual worker payroll remains separate. |
| Tax/compliance fields | Contractor Payable and Payroll include readiness statuses; compliance reports exist. | Partially supported | Readiness/status only. No tax filing, tax remittance, W2/1099, benefits, or garnishment workflow exists. |
| Reports controller | Compliance, billing completeness, and constraints reports exist. | Partially supported | No Payment Execution reports exist. |
| Search support | Global search includes contractor payables, contractor payable items, payroll runs, payroll items, cash receipts, payment applications, and legacy payments. | Partially supported | No payment batch/item search because those objects do not exist. |
| Permissions | Contractor Payable and Payroll permission sets exist and are seeded. | Supported for current domains | No `payment_batch.*` or `payment_item.*` permissions exist. |
| Events | Write-action helper creates events, event payloads, audit logs, and system actions. Existing payable/payroll events are present. | Supported | Payment Execution events are missing. |
| Audit behavior | Timeline/audit endpoints exist for Contractor Payable and Payroll. Audit is permission controlled. | Supported | Payment Execution audit endpoints are missing. |
| Smoke tests | Contractor Payable and Payroll smoke tests validate readiness and no payment/cash movement side effects. | Supported | No Payment Execution smoke exists. |
| Contractor Payable docs | Rules, backend contract, workspace contract, and physical test docs exist. | Supported | Current docs explicitly defer payment execution. |
| Payroll docs | Rules, backend contract, workspace contract, and physical test docs exist. | Supported | Current docs explicitly defer payroll execution and provider submission. |
| Payment Execution objects | No `payment_batches`, `payment_items`, ACH, check, card payout, payroll provider submission, tax remittance, accounting export, or bank reconciliation objects found. | Missing | Must be introduced only in a future coding sprint after confirmations. |

## 2. Payment Execution Definition

Payment Execution is a controlled money-movement preparation and execution layer that converts approved payment-ready contractor payables and payroll-ready payroll runs into auditable payment instructions and payment outcomes.

Payment Execution represents:

- payment batch
- payment item
- payee
- payment method
- payment amount
- execution status
- execution result
- execution reference
- payment date
- approval
- audit trail

Payment Execution does not represent:

- bank reconciliation
- accounting export
- tax filing
- payroll tax deposit
- collections
- invoice payment application
- treasury cash forecasting

## 3. Core Payment Principle

Payment Ready is not payment.

Payroll Ready is not payment.

Payment Execution is the first SyncOS layer that creates money movement intent.

Contractor payable chain:

`Contractor Payable -> Payment Ready -> Payment Item -> Payment Batch -> Payment Execution -> Bank Reconciliation later`

Payroll chain:

`Payroll Run -> Payroll Ready -> Payment Item -> Payment Batch -> Payroll Provider Submission later -> Bank Reconciliation later`

Payment Execution should represent approved intent, method, amount, payee, scheduled timing, execution attempt, and outcome. Provider settlement, bank statement matching, tax filing, accounting export, treasury forecasting, and portal payout experience remain separate governed layers.

## 4. Relationship To Contractor Payables

Payment Execution consumes:

- `contractor_payables.status = payment_ready`
- `contractor_payables.payment_readiness_status = ready_for_payment`
- `contractor_payable_items`
- payable party
- net payable amount
- pay cycle
- readiness approvals
- compliance/tax readiness context

Rules:

- Contractor Payable remains the source obligation.
- Payment Execution must not alter payable approval history.
- Payment Item should reference `contractor_payable_id`.
- Payment Item may reference one or more `contractor_payable_items` directly or through an item link table if split payments are approved.
- One contractor payable may create one payment item or many payment items.
- Contractor payable items should link to payment items through existing future `payment_item_id` only after the Payment Execution model is approved.
- Payment Execution must not recalculate contractor payable totals except through future audited correction/reversal workflow.
- Payment Execution must not mark contractor payable paid unless an explicit execution outcome rule is approved.

## 5. Relationship To Payroll

Payment Execution consumes:

- `payroll_runs.status = payroll_ready`
- `payroll_runs.payroll_readiness_status = ready_for_payroll`
- `payroll_items`
- worker
- worker classification
- net pay amount
- payroll period
- compliance/tax readiness context

Rules:

- Payroll remains the source obligation.
- Payroll approval history remains immutable.
- Payment Execution may prepare payroll payment instructions.
- Payroll provider submission should remain a future sub-layer unless explicitly approved in the Payment Execution foundation.
- Payment Item should reference `payroll_run_id`.
- Payment Item may reference payroll items directly or through an item link table if worker-level splitting is approved.
- Payment Execution must not calculate legal payroll taxes, file taxes, generate W2/1099 records, administer benefits, or remit garnishments.
- Payment Execution must not mark payroll paid unless an explicit execution outcome rule is approved.

## 6. Recommended Object Model

Options evaluated:

Option A: Direct payment records only.

- Pros: fewer objects, simpler early implementation.
- Cons: weak batch approval, weak review controls, poor separation of contractor payable and payroll sources, poor failure/retry tracking, weak audit for multi-item payment flows.

Option B: `payment_batches` + `payment_items`.

- Pros: durable batch approval, item-level traceability, supports contractor and payroll sources, supports multiple payment methods, supports future reconciliation and audit.
- Cons: requires more objects and clearer status rules.

Option C: Provider-specific execution objects.

- Pros: maps closely to ACH/payroll provider/check/card workflows.
- Cons: premature integration coupling, hard to build a provider-agnostic approval layer, risks confusing payment intent with provider execution.

Option D: Hybrid.

- `payment_batches`
- `payment_items`
- provider-agnostic execution outcome fields
- future provider-specific integration records or adapters

Recommendation: use Hybrid Option D.

Rationale: Payment Execution needs first-class batch and item auditability, but ACH, card, check printing, payroll provider submission, tax remittance, accounting export, and bank reconciliation should remain future governed integrations. The first coding sprint should create a provider-agnostic payment execution contract that can later feed provider-specific workflows.

## 7. Proposed `payment_batches` Object

Proposed fields:

- `id`
- `tenant_id`
- `batch_number`
- `batch_type`
- `payment_method`
- `status`
- `approval_status`
- `scheduled_date`
- `execution_date`
- `item_count`
- `total_amount`
- `currency`
- `created_by`
- `updated_by`
- `approved_by`
- `approved_at`
- `submitted_by`
- `submitted_at`
- `executed_by`
- `executed_at`
- `cancelled_by`
- `cancelled_at`
- `cancellation_reason`
- `execution_reference`
- `failure_reason`
- `failure_note`
- `override_reasons`
- `archived_by`
- `archived_at`
- `archive_reason`
- `created_at`
- `updated_at`

Batch types:

- `contractor_payable`
- `payroll`
- `mixed_later`
- `correction`
- `reversal`

Statuses:

- `draft`
- `ready_for_review`
- `approved`
- `scheduled`
- `submitted`
- `partially_executed`
- `executed`
- `failed`
- `cancelled`
- `archived`

Rules:

- Batch number must be tenant-unique.
- Batch totals derive from active payment items.
- Batch approval must not mutate source payable/payroll approval history.
- `mixed_later` should remain disabled unless Product approves mixed contractor/payroll batches.

## 8. Proposed `payment_items` Object

Proposed fields:

- `id`
- `tenant_id`
- `payment_batch_id`
- `source_type`
- `contractor_payable_id` nullable
- `payroll_run_id` nullable
- `worker_id` nullable
- `capacity_provider_id` nullable
- `crew_id` nullable
- `vendor_organization_id` nullable future
- `payee_name`
- `payee_reference`
- `payment_amount`
- `currency`
- `payment_method`
- `execution_status`
- `scheduled_date`
- `execution_date`
- `execution_reference`
- `failure_reason`
- `failure_note`
- `reversal_of_payment_item_id` nullable
- `correction_reason` nullable
- `created_by`
- `updated_by`
- `voided_by`
- `voided_at`
- `void_reason`
- `archived_by`
- `archived_at`
- `archive_reason`
- `created_at`
- `updated_at`

Source types:

- `contractor_payable`
- `payroll`
- `correction`
- `reversal`

Rules:

- Contractor payment item requires `contractor_payable_id`.
- Payroll payment item requires `payroll_run_id`.
- Worker-level payroll payment item should also reference `worker_id` where backend can safely derive it.
- Payment item amount should be copied from approved source net amount or explicitly derived from source items.
- Payment item must not mutate source payable/payroll totals.
- Payment item may update source `payment_item_id` links only through future audited backend logic.

## 9. Payment Methods

Payment methods to evaluate:

- `ach`
- `check`
- `card_payout`
- `wire`
- `payroll_provider`
- `manual_payment`
- `other`

Recommendation:

- First-class in model now: `ach`, `check`, `payroll_provider`, `manual_payment`, `wire`, `other`.
- Future-specific provider workflows: `ach`, `card_payout`, `payroll_provider`, and check printing.
- Defer `card_payout` unless contractor/payroll card program rules are approved.

The first Payment Execution backend should store method intent and execution outcome, not perform external network execution.

## 10. ACH Model

ACH should be modeled as a payment method and future execution provider path.

Readiness requirements to define before implementation:

- verified payee bank account
- account ownership verification
- routing/account validation
- authorization on file
- payment amount approval
- effective date
- standard vs same-day ACH policy
- return handling policy

Execution outcome fields should include:

- ACH batch/reference id
- trace number or provider execution reference
- submission timestamp
- settlement/effective date
- return code and return reason if failed

No ACH integration is implemented in this clarification sprint.

## 11. Check Model

Checks should be modeled as a payment method and future execution/printing workflow.

Concepts:

- printed check
- manual check
- check number
- check date
- mailing/delivery status later
- voided check
- stop payment later

Rules:

- Check number tracking must be tenant-scoped and auditable.
- Check printing is future scope.
- Check clearing/reconciliation is Bank Reconciliation future scope.

No check implementation is included in this clarification sprint.

## 12. Card Payout Model

Card payout should remain future unless card program rules are approved.

Potential card payout contexts:

- contractor card
- payroll card
- provider card

Requirements before implementation:

- card issuer/provider model
- authorized cardholder or payee
- payout limits
- fee handling
- failure/reversal policy
- compliance requirements

No card payout implementation is included in this clarification sprint.

## 13. Payroll Provider Submission Model

Payroll provider submission should remain separate from core Payment Execution unless explicitly approved.

Future support may include:

- payroll provider exports
- payroll provider APIs
- payroll submission references
- provider acceptance/rejection status
- payroll provider batch id
- provider error payloads

Recommendation:

- Payment Execution may create a payroll payment batch with method `payroll_provider`.
- Actual payroll provider submission should be a future provider integration sprint.
- Payroll provider rejection should update payment execution outcome, not rewrite payroll approval history.

No payroll provider integration is included in this clarification sprint.

## 14. Payment Approval Model

Payment approval verifies:

- source obligations are payment-ready or payroll-ready
- payment item amounts match approved source obligations
- payee is identified
- payment method is selected
- compliance/tax readiness warnings are reviewed
- batch total is valid
- no hold/dispute blocks execution
- separation of duties is satisfied if required

Recommended roles:

- Finance Manager approves contractor payment batches.
- Payroll Admin prepares payroll batches.
- Finance Manager or Executive approves payroll payment execution.
- Executive/System Admin can override.
- System Admin can archive/cancel with reason.

Recommended separation of duties:

- Creator and approver should be different users for actual execution.
- Payroll batches should require Payroll Admin preparation and Finance Manager or Executive approval.
- High-value batches should require dual approval if Product approves threshold rules.

## 15. Payment Status Model

Recommended shared statuses:

- `draft`: batch or item is being assembled.
- `ready_for_review`: batch is complete enough for approval review.
- `approved`: batch has approval but is not yet scheduled/submitted.
- `scheduled`: batch has an intended execution date.
- `submitted`: batch/item has been sent to a future provider or marked as submitted manually.
- `partially_executed`: some items executed and some remain pending/failed.
- `executed`: all active items executed successfully.
- `failed`: execution attempt failed for all or materially failed for the batch.
- `cancelled`: batch/item was cancelled before completion.
- `archived`: batch/item is retained read-only and hidden by default.

Item-level `execution_status` may mirror the same values or use a narrower set:

- `pending`
- `scheduled`
- `submitted`
- `executed`
- `failed`
- `cancelled`
- `reversed`
- `archived`

## 16. Failed Payment Model

Failure examples:

- failed ACH
- ACH return
- rejected payment
- invalid account
- returned payment
- provider rejection
- stale payee information
- insufficient funding later
- manual check voided before delivery

Rules:

- Failure must not erase contractor payable or payroll history.
- Failure must keep original payment item audit trail.
- Failure should store provider/manual failure reason and reference.
- Retry/correction workflow should be future scope unless explicitly approved.
- Source obligation status updates after failure are unsafe to infer and require confirmation.

## 17. Reversal / Correction Model

Payment reversal and correction are future governed workflows.

Concepts:

- reversal batch
- correction batch
- duplicate payment review
- payment item reversal link
- partial reversal
- replacement payment

Rules:

- Reversal must not delete original executed payment item.
- Correction must reference original payment item or batch.
- Duplicate payment handling should be auditable and permission-gated.
- Reversal accounting and bank reconciliation effects are future scope.

No reversal/correction implementation is included in this clarification sprint.

## 18. Treasury / Funding Boundary

Payment Execution must not:

- forecast cash
- manage credit lines
- manage treasury
- optimize funding
- move money between bank accounts
- select funding source automatically

Treasury remains future scope.

Payment Execution may show funding readiness later, but it should not become cash forecasting or treasury management.

## 19. Tax / Compliance Boundary

Payment Execution must not:

- file taxes
- remit payroll taxes
- generate W2
- generate 1099
- submit tax forms
- calculate statutory withholding
- administer benefits
- remit garnishments

Tax and compliance remain readiness/status context until future governed tax and payroll compliance sprints.

## 20. Bank Reconciliation Boundary

Payment Execution must not:

- reconcile bank statements
- reconcile deposits
- match cleared checks
- match ACH settlement lines
- perform accounting close

Bank Reconciliation is a future sprint.

Payment Execution may store execution references that future Bank Reconciliation can consume.

## 21. Accounting Export Boundary

Payment Execution must not:

- create accounting exports
- create GL journals
- export to QuickBooks
- export to ERP systems
- create accounting close entries

Accounting Export is a future sprint.

Payment Execution may store source and execution data needed for future accounting export, but must not export or post accounting entries.

## 22. Permissions

Proposed permissions:

Payment batch:

- `payment_batch.read`
- `payment_batch.create`
- `payment_batch.update`
- `payment_batch.add_item`
- `payment_batch.remove_item`
- `payment_batch.recalculate_totals`
- `payment_batch.submit_review`
- `payment_batch.approve`
- `payment_batch.schedule`
- `payment_batch.submit_execution`
- `payment_batch.mark_executed`
- `payment_batch.mark_failed`
- `payment_batch.cancel`
- `payment_batch.archive`
- `payment_batch.timeline.read`
- `payment_batch.audit.read`

Payment item:

- `payment_item.read`
- `payment_item.create`
- `payment_item.update`
- `payment_item.mark_submitted`
- `payment_item.mark_executed`
- `payment_item.mark_failed`
- `payment_item.cancel`
- `payment_item.reverse_later`
- `payment_item.archive`

Role guidance:

- Finance Manager: read/create/update/review/approve contractor payment batches.
- Payroll Admin: read/create/update payroll payment batches and submit for review.
- Executive: approve high-value or override batches.
- System Admin: full operational and audit access.
- Operations/Billing users: read related payment execution context only if permitted.

## 23. Events

Proposed payment batch events:

- `payment_batch.created`
- `payment_batch.updated`
- `payment_batch.item_added`
- `payment_batch.item_removed`
- `payment_batch.totals_recalculated`
- `payment_batch.review_submitted`
- `payment_batch.approved`
- `payment_batch.scheduled`
- `payment_batch.submitted`
- `payment_batch.partially_executed`
- `payment_batch.executed`
- `payment_batch.failed`
- `payment_batch.cancelled`
- `payment_batch.archived`

Proposed payment item events:

- `payment_item.created`
- `payment_item.updated`
- `payment_item.submitted`
- `payment_item.executed`
- `payment_item.failed`
- `payment_item.cancelled`
- `payment_item.reversed_later`
- `payment_item.archived`

Every write must create:

- event
- event payload
- audit log
- system action

using the standard write-action helper.

Audit should capture:

- actor
- tenant
- batch id
- item id
- source type
- source payable/payroll id
- payee
- amount
- payment method
- status before/after
- execution reference
- failure reason
- override reasons
- timestamp
- correlation id

## 24. Search

Future search should include:

- payment batches
- payment items
- payees
- execution references
- failure reasons
- source payable number
- payroll run number
- provider/worker names

Search must be tenant-scoped.

Archived records should be excluded unless `archived=true`.

## 25. Recommended Backend Foundation Scope

Recommended next coding sprint:

Payment Execution Backend Contract Foundation

Build:

- `payment_batches`
- `payment_items`
- batch number generation
- create batch
- add contractor payable payment items from `payment_ready` payables
- add payroll payment items from `payroll_ready` runs
- payment approval lifecycle
- execution readiness/status tracking
- schedule/submit/mark executed/mark failed/cancel/archive
- totals calculation
- list/detail endpoints
- timeline
- audit
- search
- smoke validation
- release validation wiring

Do not build:

- ACH integration
- payroll provider integration
- check printing
- card payout integration
- tax filing
- tax remittance
- W2/1099 generation
- accounting export
- GL journal entries
- bank reconciliation
- treasury automation
- portal payout workflows

## 26. Required Product Confirmations

1. Should Payment Execution use Hybrid Option D? Recommended: yes.
2. Should contractor payables and payroll both feed payment items? Recommended: yes.
3. Should mixed contractor/payroll batches be allowed? Recommended: no for first implementation; keep `mixed_later`.
4. Should ACH be first-class? Recommended: yes as a method/status model, no external ACH integration yet.
5. Should check support exist? Recommended: yes as manual/check method tracking, no check printing yet.
6. Should card payouts be future? Recommended: yes.
7. Should payroll provider submission be separate? Recommended: yes.
8. Should payment execution require dual approval? Recommended: yes for high-value or override batches; confirm thresholds.
9. Should failed payments create correction workflows later? Recommended: yes, future governed sprint.
10. Should treasury remain separate? Recommended: yes.
11. Should bank reconciliation remain separate? Recommended: yes.
12. Should accounting export remain separate? Recommended: yes.
13. Should tax filing remain separate? Recommended: yes.
14. Who can approve execution? Recommended: Finance Manager for standard batches, Executive/System Admin for overrides/high-value batches.
15. Who can cancel execution? Recommended: Finance Manager before submission, Executive/System Admin after submission if provider state permits.
16. Who can reverse execution? Recommended: Executive/System Admin only in a future reversal sprint.
17. Should source payable/payroll status be updated to `payment_created_later` or equivalent when payment item is created? Recommended: defer until explicit source-status synchronization rules are approved.
18. Should payment item amounts support partial payments? Recommended: yes for contractor payables, but require explicit split rules; payroll partials need separate confirmation.
19. Should manual payment execution be allowed in the foundation? Recommended: only as status/reference capture, not as bank or check generation.
20. Should provider failure payloads be stored raw? Recommended: store normalized failure reason and limited provider reference; raw payload policy needs security/privacy review.

## 27. Validation

Required non-mutating checks for this sprint:

- `git status --short`
- document inspection
- `git diff --check`

No code changes, migrations, routes, UI, or tests are required.

## GO / NO-GO Recommendation

Recommendation: GO for a future Payment Execution Backend Contract Foundation after Product confirms the required questions above.

Rationale:

- Contractor Payable and Payroll now both stop cleanly at readiness.
- Current models include future `payment_item_id` linkage points.
- Search, permission, event, audit, and smoke patterns are established.
- No existing Payment Execution source of truth exists, so a first-class model is required.

Constraint:

- Do not reuse the legacy `payments` table as outbound Payment Execution without an explicit deprecation/migration plan. Its current semantics are invoice-side/legacy payment records, not approved outbound execution.
