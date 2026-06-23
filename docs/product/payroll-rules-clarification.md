# Payroll Rules Clarification

Current validated commit: `020097d4bd9250ece346baef1c5712044aca7a31`

This is a rules clarification document only. It does not create backend objects, migrations, routes, UI, or application behavior.

The approved SyncOS revenue chain remains:

Billable -> Settlement -> Invoice -> Cash Receipt -> Payment Application -> Invoice Balance -> Collections

The approved contractor payable chain remains:

Production -> QC -> Billable -> Settlement -> Contractor Payable -> Payment / Payroll later

Payroll is clarified separately as the individual-worker compensation readiness layer. Payroll must stop before payment execution, tax filing, payroll provider submission, bank transaction creation, accounting export, benefits administration, garnishment remittance, or worker portal payout.

## 1. Current Backend Inventory

| Area | Current state | Classification |
| --- | --- | --- |
| `workers` table | Exists from the capacity foundation with `tenant_id`, `capacity_provider_id`, nullable `crew_id`, first/last name, status, and timestamps. No worker classification, worker rate, worker tax document status, payroll eligibility, or payroll readiness fields were found. | Partially supported |
| Worker routes | `GET /workers`, `GET /workers/:id`, `POST /workers`, `PATCH /workers/:id`, and archive route exist through `capacity.controller.ts`. These are capacity resource routes, not payroll routes. | Partially supported |
| `crews` table/routes | Crews exist with tenant/provider context and read/create/update/archive routes. Crew is usable as payroll context, but crew-level payable remains separate from worker payroll. | Supported as context |
| Capacity providers | Capacity provider table/routes exist with lifecycle states and provider context. Provider-level compliance documents exist. Provider payment obligations are handled by Contractor Payable, not Payroll. | Supported as context |
| Compliance documents | `compliance_documents` table/routes exist for capacity providers. No worker-level payroll compliance/tax document model was found. | Partially supported |
| Worker compliance fields | No first-class worker compliance readiness, tax document readiness, W2/W9 status, I-9 status, or payroll eligibility fields were found on workers. | Missing |
| Worker rate fields | No worker hourly, overtime, piece, per diem, reimbursement, or payroll-specific rate fields were found. Contractor rates exist through rate codes and settlement/payable layers, but they are not worker payroll rates. | Missing |
| Time tracking fields | No first-class timesheet, approved time, clock-in/out, payroll hours, or worker time route was found. | Missing |
| Production quantity/time fields | `production_records` exist with project, work order, provider, crew, production date, quantity, unit, QC/billable states, and rate code references. They do not record individual worker payroll hours or worker-level earnings. | Partially supported |
| Work orders | Work orders exist with project, customer, provider, crew, equipment, lifecycle, holds, and production rollups. They can provide context, but they do not create payroll. | Supported as context |
| Projects | Projects exist with customer/territory/work type/lifecycle and financial context. They can provide context, but they do not create payroll. | Supported as context |
| `contractor_payables` | First-class Contractor Payable backend exists with payable approval, payment readiness, provider/crew/vendor/internal context, hold/dispute, compliance/tax readiness, timeline/audit, and search. It includes `worker_later` fields as future placeholders. | Supported, separate boundary |
| `contractor_payable_items` | First-class payable items exist with settlement item traceability, amounts, retainage, deductions, chargebacks, compliance/tax status, hold/dispute, and future payment item reference. They are not payroll items. | Supported, separate boundary |
| Settlements | Settlements and settlement items exist with payable-ready behavior and contractor payable source values. They do not create payroll runs. | Supported as upstream context |
| Payroll fields/routes | No `payroll_runs`, `payroll_items`, payroll approval routes, payroll readiness routes, payroll timeline, or payroll audit endpoints were found. | Missing |
| Legacy payments table/routes | Legacy `payments` table/routes exist in the finance/cash area. They are not approved for Payroll execution or payroll readiness. | Supported legacy / unsafe to reuse |
| Cash/payment application routes | Cash Receipts and Payment Applications exist for customer cash-in and invoice balance updates. They have no payroll role. | Supported, separate boundary |
| Tax/compliance fields | Contractor payable has compliance/tax readiness statuses. No payroll tax filing, W2/1099 generation, withholding, benefits, or garnishment model was found. | Missing for Payroll |
| Worker classification fields | No `w2_employee`, `contractor_1099`, temp, seasonal, union, or unknown classification field was found on workers. | Missing |
| Reports controller | Reports cover compliance, billing completeness, and constraints. No payroll run, payroll period, gross/net pay, reimbursement, deduction, or worker payroll report was found. | Partially supported |
| Search support | Global search includes workers, crews, providers, production, work orders, settlements, cash application, collections, and contractor payable objects. It does not include `payroll_runs` or `payroll_items`. | Partially supported |
| Permissions | Worker, crew, provider, production, settlement, cash, collections, and contractor payable permissions exist. No `payroll_run.*` or `payroll_item.*` permissions were found. | Missing |
| Events | Existing domains use event/audit/system_action write behavior. No payroll event types were found. | Partially supported |
| Audit behavior | Existing write routes use the standard write-action pattern. Payroll should use the same event/audit/system_action behavior. | Supported pattern |
| Smoke tests | Smokes exist for security, organization, contact, relationship, candidate, opportunity, coverage, project handoff, project, work order, production, QC, billable, settlement, invoice, cash application, collections, contractor payable, and release validation. No payroll smoke command exists. | Missing |
| Related docs | Production, Work Order, Contractor Payable, Cash Application, and Collections docs exist. Contractor Payable docs explicitly keep payroll/payment execution as future scope. No Payroll doc existed before this clarification. | Partially supported |

Special focus recommendation:

Use Option D: Hybrid. Production, work orders, projects, workers, crews, and future time sources provide source context. First-class `payroll_runs` and `payroll_items` should govern payroll readiness, approval, totals, audit, and future handoff to payroll execution. Payment execution remains future scope.

Do not reuse Contractor Payable as the default Payroll object for individual workers. Contractor Payable may retain `worker_later` placeholders, but individual worker compensation should be clarified and built through Payroll unless product explicitly chooses otherwise.

## 2. Payroll Definition

Payroll is a controlled worker compensation preparation layer that converts approved worker time, earnings, reimbursements, deductions, and adjustments into payroll-ready obligations before any payment, tax filing, or bank transaction occurs.

Payroll represents:

- worker
- worker classification
- payroll period
- approved payable time or earnings
- gross pay
- overtime if supplied by approved source
- per diem or reimbursement
- bonuses or incentives
- deductions
- estimated net payroll
- compliance readiness
- tax document readiness
- approval state
- payroll readiness
- audit trail

Payroll does not represent:

- ACH payout
- card payout
- check payment
- bank transaction
- payroll tax filing
- W2 filing
- 1099 filing
- benefits administration
- garnishment remittance
- accounting export
- contractor portal payment
- worker portal payout

## 3. Core Payroll Principle

Payroll is individual-worker compensation readiness.

Payroll is not money movement.

Payroll is not tax filing.

Payroll is not Contractor Payable.

The future chain should be:

Worker Time / Earnings Source -> Payroll Item -> Payroll Run -> Payroll Approval -> Payroll Ready -> Payment / Payroll Execution later

Never:

- Production -> Bank Payment
- Payroll Run -> ACH
- Payroll Run -> Tax Filing
- Contractor Payable -> Worker Payroll without explicit worker-level payroll rules

Payroll may prepare obligations, but it must not execute payment, file taxes, submit to a payroll provider, create paystubs, create bank transactions, create accounting exports, or remit benefits/garnishments.

## 4. Payroll Relationship To Workers

Payroll consumes worker identity and payroll eligibility context.

Payroll should consume:

- `worker_id`
- worker name
- worker status
- worker classification
- crew assignment
- capacity provider context if applicable
- worker rate if approved
- compliance status if available
- tax document status if available
- role/title if available
- location/territory if available

Rules:

- Payroll item must reference a worker.
- Worker must belong to the actor tenant.
- Worker must be active or eligible unless an override is explicitly supplied.
- Worker classification must be known before payroll readiness unless an approved override exists.
- Worker tax/compliance status should warn or block based on approved product policy.
- Worker pay rate must be known before payroll approval unless an override is explicitly supplied.
- Payroll must not silently create worker records.
- Payroll must not treat provider or crew records as individual workers.

Current gap:

Worker records are basic capacity resources. Payroll-specific worker classification, payroll rates, tax document readiness, and compliance readiness are missing and require product confirmation before implementation.

## 5. Payroll Relationship To Crews

Payroll may group or filter worker payroll by crew.

Payroll may consume:

- `crew_id`
- crew assignment
- crew foreman context
- crew production context
- crew work date
- crew project/work order context

Rules:

- Crew may provide context, but worker remains the payable person.
- Crew-level payable and worker payroll must stay separate.
- Crew entity obligations remain Contractor Payable unless future rules state otherwise.
- Worker payroll must not silently pay a crew entity.
- Moving a worker between crews must not rewrite historical payroll source context.

## 6. Payroll Relationship To Production / Work Orders / Projects

Payroll may source context from Production, Work Orders, and Projects, but those domains do not create Payroll automatically.

Payroll may source from:

- `production_record_id`
- `work_order_id`
- `project_id`
- `crew_id`
- approved hours
- approved quantities
- production date
- work type
- role performed

Rules:

- Production can support payroll source data only where source fields are explicit.
- Production approval does not automatically create payroll.
- Work Order approval does not automatically create payroll.
- Project lifecycle does not automatically create payroll.
- Payroll item should preserve source traceability.
- Payroll must not change production quantities.
- Payroll must not change QC approved quantities.
- Payroll must not change work order completion state.
- Payroll must not change contractor payable amounts.

Current gap:

Production records store provider/crew/project/work order/quantity context, but they do not currently store individual worker IDs, approved payroll hours, overtime, doubletime, or worker earning details.

## 7. Payroll Relationship To Contractor Payables

Payroll and Contractor Payable are separate.

Contractor Payable handles:

- subcontractor obligations
- crew entity obligations
- vendor/internal obligations
- payment-ready external obligations

Payroll handles:

- individual worker wage obligations
- individual worker reimbursements
- individual worker deductions
- individual worker payroll readiness

Rules:

- Contractor Payable should not be reused as the default W2 payroll object.
- `worker_later` in Contractor Payable should remain future/deprecated for Payroll unless product explicitly chooses to pay individual workers through Contractor Payable.
- Payroll may reference Contractor Payable for context only if explicitly approved.
- Payroll must not create Contractor Payable.
- Contractor Payable must not create payroll runs automatically.
- Payroll readiness and Contractor Payable payment readiness are separate statuses.

Ambiguity requiring confirmation:

The backend has `worker_later` values on Contractor Payable. Product must confirm whether these remain placeholders only, or whether 1099 individual workers should use Payroll, Contractor Payable, or a governed bridge.

## 8. Worker Classification Model

Worker classifications:

- `w2_employee`
- `contractor_1099`
- `temp_worker`
- `seasonal_worker`
- `internal_self_perform`
- `union_later`
- `unknown`

Rules:

- `w2_employee` may require payroll tax readiness later.
- `contractor_1099` may require W9/1099 readiness later.
- `temp_worker` may require agency/vendor workflow later.
- `union_later` is future scope.
- `unknown` classification blocks payroll readiness unless an override is explicitly supplied.
- Classification determines downstream tax/payment handling later.
- Classification must be auditable when used for payroll readiness.

Recommended policy:

- Individual worker pay should go through Payroll.
- Company, subcontractor, crew, vendor, or provider obligations should stay in Contractor Payable.
- 1099 individual worker routing requires explicit product confirmation before implementation.

## 9. Payroll Period Model

Payroll period types:

- `weekly`
- `biweekly`
- `semimonthly`
- `monthly`
- `custom`

Future payroll run fields should include:

- `payroll_period_start`
- `payroll_period_end`
- `pay_date` nullable
- `payroll_cycle`
- `territory_id` nullable
- `project_id` nullable
- `crew_id` nullable

Rules:

- Payroll period groups payroll items.
- Payroll period does not create payment.
- `pay_date` is intended payment date, not payment execution.
- Payroll run may include many workers and many projects if approved.
- Off-cycle/correction payroll runs must be auditable.
- Payroll period date range must be valid and tenant scoped.

## 10. Time / Earning Source Model

Payroll source types:

- `approved_time`
- `production_based`
- `per_diem`
- `reimbursement`
- `bonus`
- `adjustment`
- `correction`
- `manual`
- `imported_later`

Possible sources:

- `production_record_id`
- `work_order_id`
- `project_id`
- `crew_id`
- `worker_id`
- manual entry
- future timesheet

Rules:

- Payroll source must be auditable.
- Manual payroll item requires reason.
- Production-based earnings require approved production context where applicable.
- Approved time source requires hours.
- Reimbursement requires note/evidence.
- Bonus requires reason/approval.
- Correction should reference original payroll item if available.
- Imported payroll source is future scope and must not be implemented without integration rules.

## 11. Object Model Options

### Option A: Fields Only On Workers / Production Records

Pros:

- simple
- fewer objects

Cons:

- weak payroll period control
- weak approval history
- poor deduction/reimbursement tracking
- no payroll run audit
- unsafe for future payment/tax handoff

### Option B: First-Class `payroll_runs` And `payroll_items`

Pros:

- clear payroll approval layer
- supports payroll periods
- supports worker-level earnings
- supports reimbursements, deductions, holds, disputes, and readiness
- keeps payment and tax execution separate

Cons:

- more objects
- requires worker classification/rate policy

### Option C: Reuse Contractor Payables For Workers

Pros:

- reuses a money-out approval pattern

Cons:

- mixes individual payroll with subcontractor/vendor obligations
- weak payroll-specific period/tax/readiness semantics
- risks routing W2 payroll through contractor payable behavior

### Option D: Hybrid

Production, workers, crews, and future time sources provide source data. `payroll_runs` and `payroll_items` govern payroll readiness and approval. Payment execution remains future.

Recommendation: use Hybrid Option D.

## 12. Proposed `payroll_runs` Object

Future `payroll_runs` fields:

- `id`
- `tenant_id`
- `payroll_run_number`
- `payroll_run_type`
- `status`
- `approval_status`
- `payroll_readiness_status`
- `payroll_cycle`
- `payroll_period_start`
- `payroll_period_end`
- `pay_date` nullable
- `territory_id` nullable
- `project_id` nullable
- `crew_id` nullable
- `gross_pay_amount`
- `reimbursement_amount`
- `deduction_amount`
- `estimated_tax_amount` nullable
- `net_pay_amount`
- `item_count`
- `worker_count`
- `compliance_status`
- `tax_document_status`
- `dispute_status`
- `hold_status`
- `approved_by` nullable
- `approved_at` nullable
- `rejected_by` nullable
- `rejected_at` nullable
- `rejection_reason` nullable
- `rejection_note` nullable
- `hold_reason` nullable
- `hold_note` nullable
- `dispute_reason` nullable
- `dispute_note` nullable
- `override_reasons` jsonb
- `created_by`
- `updated_by`
- `voided_by` nullable
- `voided_at` nullable
- `void_reason` nullable
- `void_note` nullable
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `archive_note` nullable
- `created_at`
- `updated_at`

Payroll run types:

- `regular`
- `off_cycle`
- `correction`
- `bonus`
- `reimbursement`
- `final_pay`
- `manual_adjustment`

Statuses:

- `draft`
- `assembling`
- `ready_for_review`
- `under_review`
- `approved`
- `rejected`
- `held`
- `disputed`
- `payroll_ready`
- `payroll_created_later`
- `partially_paid_later`
- `paid_later`
- `voided`
- `archived`

Approval statuses:

- `not_submitted`
- `pending`
- `approved`
- `rejected`
- `withdrawn`

Payroll readiness statuses:

- `not_ready`
- `ready_with_warning`
- `ready_for_payroll`
- `blocked`

## 13. Proposed `payroll_items` Object

Future `payroll_items` fields:

- `id`
- `tenant_id`
- `payroll_run_id`
- `worker_id`
- `crew_id` nullable
- `project_id` nullable
- `work_order_id` nullable
- `production_record_id` nullable
- `source_type`
- `earning_type`
- `status`
- `worker_classification`
- `work_date` nullable
- `hours_regular` nullable
- `hours_overtime` nullable
- `hours_doubletime` nullable
- `quantity` nullable
- `unit` nullable
- `rate_regular` nullable
- `rate_overtime` nullable
- `rate_doubletime` nullable
- `piece_rate` nullable
- `gross_pay_amount`
- `reimbursement_amount`
- `deduction_amount`
- `estimated_tax_amount` nullable
- `net_pay_amount`
- `compliance_status`
- `tax_document_status`
- `dispute_status`
- `hold_status`
- `description` nullable
- `manual_reason` nullable
- `evidence_reference` nullable
- `created_by`
- `updated_by`
- `voided_by` nullable
- `voided_at` nullable
- `void_reason` nullable
- `void_note` nullable
- `archived_by` nullable
- `archived_at` nullable
- `archive_reason` nullable
- `archive_note` nullable
- `created_at`
- `updated_at`

Earning types:

- `regular`
- `overtime`
- `doubletime`
- `piece_rate`
- `per_diem`
- `reimbursement`
- `bonus`
- `incentive`
- `adjustment`
- `correction`
- `deduction`
- `penalty`

Statuses:

- `draft`
- `ready`
- `approved`
- `held`
- `disputed`
- `payroll_ready`
- `payroll_created_later`
- `voided`
- `archived`

## 14. Payroll Item Creation Rules

Future route:

`POST /payroll-runs/:id/items`

Required:

- `worker_id`
- `source_type`
- `earning_type`

Conditional:

- `approved_time` requires regular, overtime, or doubletime hours.
- `production_based` requires production, work order, project context, or quantity.
- `manual` requires `manual_reason`.
- `reimbursement` requires amount and note/evidence.
- `bonus` requires reason.
- `correction` should reference original payroll item if available.

Validation:

- actor has `payroll_item.create`
- payroll run belongs to tenant
- worker belongs to tenant
- worker classification known unless override supplied
- source type approved
- earning type approved
- rates known unless override supplied
- hours/quantity valid
- compliance/tax status checked
- no duplicate payroll item for same worker/source unless override supplied

On add:

- payroll item created
- payroll run totals recalculated
- `payroll_run.item_added` event
- `payroll_item.created` event
- audit/system_action

Must not create payment, ACH/card payout, check, bank transaction, payroll tax filing, paystub, accounting export, benefits remittance, garnishment remittance, worker portal payout, or contractor payable.

## 15. Gross Pay Model

Gross pay can derive from:

- `hours_regular * rate_regular`
- `hours_overtime * rate_overtime`
- `hours_doubletime * rate_doubletime`
- `quantity * piece_rate`
- flat bonus
- reimbursement amount
- manual adjustment

Rules:

- Gross pay must be auditable.
- Manual override requires reason.
- Rates must be explicit; do not infer worker rates from contractor payable rates unless approved.
- Reimbursement may not count as taxable wages depending future tax logic, but first sprint stores status only.
- Taxes are estimated only if modeled; no tax filing.
- Gross pay calculation must be deterministic and tenant scoped.

## 16. Overtime Model

Overtime may depend on:

- state law
- company policy
- worker classification
- daily hours
- weekly hours
- union rules later

Rules:

- Do not implement legal overtime calculation unless rules are explicitly approved.
- Store `hours_regular`, `hours_overtime`, `hours_doubletime`, `rate_overtime`, and `rate_doubletime` where supplied.
- Require user/system source to provide approved overtime hours in the first Payroll Backend Foundation.
- Do not infer legal overtime automatically.
- Document overtime policy as a future rules sprint if needed.

## 17. Per Diem / Reimbursement Model

Types:

- `per_diem`
- `mileage`
- `lodging`
- `fuel`
- `tools`
- `equipment`
- `materials`
- `other`

Rules:

- Reimbursement requires note/evidence.
- Reimbursement amount is included in payroll run summary.
- Tax treatment is future scope.
- No payment is created.
- Reimbursement must not create vendor payable or accounting export.

## 18. Deductions Model

Deduction types:

- `advance_repayment`
- `equipment_charge`
- `damage_charge`
- `uniform_charge`
- `benefit_later`
- `garnishment_later`
- `tax_withholding_later`
- `other`

Rules:

- Deductions require reason.
- Benefit, garnishment, and tax withholding are future scopes unless explicitly approved.
- Deductions reduce estimated net pay.
- Deductions do not create remittance records.
- Deductions do not create tax filing records.
- Deductions do not create accounting exports.

## 19. Payroll Approval Model

Approval verifies:

- payroll run has items
- workers are valid
- classifications are known
- rates are reviewed
- hours/quantities are reviewed
- deductions are reviewed
- reimbursements are reviewed
- compliance/tax readiness is reviewed
- no unresolved disputes
- no holds

Lifecycle:

- `submit_review`
- `start_review`
- `approve`
- `reject`

Rules:

- Approval does not create payment.
- Approval does not create payroll execution.
- Approval does not file taxes.
- Approval does not create ACH/card payout, check, bank transaction, accounting export, benefit remittance, or garnishment remittance.

Role guidance:

- Foreman may submit worker time context later if allowed.
- Operations may review production/time context.
- Payroll Admin prepares.
- Finance Manager approves.
- Executive/System Admin overrides.

## 20. Payroll Readiness Model

Payroll readiness answers:

"Can this payroll run be handed to a future payroll execution process?"

Payroll readiness checks:

- approved payroll run
- worker classification known
- rates known
- gross/net totals valid
- tax docs reviewed
- compliance reviewed
- no hold
- no dispute
- no duplicate payroll execution

Readiness statuses:

- `not_ready`
- `ready_with_warning`
- `ready_for_payroll`
- `blocked`

Future route:

`POST /payroll-runs/:id/mark-payroll-ready`

Required:

- `ready_note`

On success:

- `payroll_readiness_status = ready_for_payroll`
- `status = payroll_ready`
- `payroll_run.payroll_ready` event
- audit/system_action

No payment, ACH, card payout, check, bank transaction, payroll provider submission, payroll tax filing, paystub, or accounting export.

## 21. Payroll Run Model

Payroll run groups payroll items by:

- payroll period
- payroll cycle
- crew
- project
- territory
- off-cycle/correction reason

Rules:

- Payroll run may contain many workers.
- Payroll run may contain multiple source types.
- Payroll run can be voided before payroll execution.
- Once `payroll_created_later`, edits should be blocked except through future reversal/correction workflow.
- Payroll run numbering must be tenant-unique.
- Payroll run number must not be reused after void/archive.

Suggested numbering:

`PAYROLL-{tenantScopedSequence}`

## 22. Payroll Execution Boundary

Payroll must not create:

- ACH
- card payout
- check
- bank transaction
- payment processor action
- payroll provider submission
- paystub
- payment confirmation
- worker portal payout

Future chain:

Payroll Run -> Payroll Execution later -> Payment Execution later -> Bank Reconciliation later

Payroll Backend Foundation should stop at payroll readiness.

## 23. Payroll Tax / Compliance Boundary

Payroll may track:

- worker classification
- tax document status
- compliance status
- estimated tax amount

Payroll must not create:

- tax filing
- payroll tax deposit
- W2
- 1099
- withholding remittance
- benefit remittance
- garnishment remittance

Tax and compliance remain readiness/status only in the Payroll Backend Foundation.

## 24. Accounting / Bank Reconciliation Boundary

Payroll must not create:

- GL journal
- accounting export
- bank transaction
- reconciliation record
- deposit batch
- payment confirmation

Accounting and banking are future integrations.

## 25. Permissions / Roles

Proposed permissions:

Payroll run:

- `payroll_run.read`
- `payroll_run.create`
- `payroll_run.update`
- `payroll_run.add_item`
- `payroll_run.remove_item`
- `payroll_run.recalculate_totals`
- `payroll_run.submit_review`
- `payroll_run.start_review`
- `payroll_run.approve`
- `payroll_run.reject`
- `payroll_run.mark_payroll_ready`
- `payroll_run.place_hold`
- `payroll_run.release_hold`
- `payroll_run.dispute`
- `payroll_run.resolve_dispute`
- `payroll_run.void`
- `payroll_run.archive`
- `payroll_run.timeline.read`
- `payroll_run.audit.read`

Payroll item:

- `payroll_item.read`
- `payroll_item.create`
- `payroll_item.update`
- `payroll_item.void`
- `payroll_item.archive`

Role guidance:

- Payroll Admin can create payroll runs and items.
- Operations can review worker/production context where permitted.
- Finance Manager can approve/reject payroll runs.
- Executive/System Admin can override.
- Project/Ops users may view related payroll context only where permissions allow.

## 26. Events And Audit Requirements

Proposed events:

Payroll run:

- `payroll_run.created`
- `payroll_run.updated`
- `payroll_run.item_added`
- `payroll_run.item_removed`
- `payroll_run.totals_recalculated`
- `payroll_run.review_submitted`
- `payroll_run.review_started`
- `payroll_run.approved`
- `payroll_run.rejected`
- `payroll_run.payroll_ready`
- `payroll_run.held`
- `payroll_run.hold_released`
- `payroll_run.disputed`
- `payroll_run.dispute_resolved`
- `payroll_run.voided`
- `payroll_run.archived`

Payroll item:

- `payroll_item.created`
- `payroll_item.updated`
- `payroll_item.voided`
- `payroll_item.archived`

Every write must create:

- event
- event payload
- audit log
- system action

Audit must capture:

- actor
- tenant
- payroll run
- payroll item
- worker
- worker classification
- source object IDs
- payroll period
- gross/reimbursement/deduction/tax/net amounts
- hours/quantity/rates
- status before/after
- approval status before/after
- payroll readiness status before/after
- hold/dispute status before/after
- override reasons
- correlation ID
- timestamp

## 27. Search

Future search should include:

- `payroll_runs`
- `payroll_items`

Search fields:

- payroll run number
- worker name
- crew
- project
- source type
- earning type
- status
- payroll period

Rules:

- Tenant scoped.
- Archived excluded unless `archived=true`.
- Search must not expose unauthorized payroll detail.

## 28. Recommended Backend Foundation Scope

Recommended next coding sprint:

Payroll Backend Contract Foundation

Build:

- `payroll_runs`
- `payroll_items`
- create payroll run
- add payroll items
- list/detail endpoints
- totals calculation
- submit/start review
- approve/reject
- mark payroll ready
- hold/release
- dispute/resolve
- void/archive
- timeline/audit
- search
- smoke test
- release validation wiring

Do not build:

- payment execution
- payroll provider integration
- ACH/card payout
- checks
- tax filing
- W2/1099 generation
- benefits
- garnishment remittance
- accounting export
- bank reconciliation
- worker portal payout
- contractor payable creation

Backend foundation should also document or add only the minimum worker classification/readiness fields required to validate payroll safely, after product confirms classification ownership.

## 29. Required Product Confirmations

The Payroll Backend Foundation should not begin until product confirms:

1. Should Payroll use Hybrid Option D?
2. Should Payroll remain separate from Contractor Payable?
3. Should individual workers be paid through Payroll, not Contractor Payable?
4. Should crew/company/provider obligations remain Contractor Payable?
5. Should 1099 individual workers go through Payroll or Contractor Payable?
6. Should payroll source production records, manual approved time, or a new timesheet model first?
7. Should approved overtime be supplied, not calculated automatically?
8. Should legal overtime calculation be deferred?
9. Should payroll tax calculation be deferred?
10. Should tax filing be deferred?
11. Should W2/1099 generation be deferred?
12. Should benefits/garnishments be deferred?
13. Should payroll provider integration be deferred?
14. Should payment execution be deferred?
15. Should reimbursement/per diem be included in Payroll Backend Foundation?
16. Who can approve payroll runs?
17. Who can mark payroll ready?
18. Should payroll readiness require compliance/tax document readiness?
19. Should Payroll ever create Contractor Payables? Recommended no.
20. Should Payroll ever create bank/payment records? Recommended no.
21. Where should worker classification live: `workers`, a worker profile extension, or Payroll-only snapshot?
22. Where should worker pay rates live: worker profile, rate schedule, payroll item, or future compensation table?
23. Should Payroll allow manual items before a formal time tracking model exists?
24. Should payroll run item duplication rules key on worker/source/date, worker/source object, or another policy?

Recommended answers:

- Yes, use Hybrid Option D.
- Keep Payroll separate from Contractor Payable.
- Individual worker pay goes through Payroll.
- Company/crew/provider obligations stay Contractor Payable.
- Store overtime fields but defer legal overtime calculation.
- Store estimated tax fields only; no tax filing.
- Defer benefits, garnishments, tax filing, payroll provider submission, payment execution, accounting export, and bank reconciliation.
- Payroll must not create Contractor Payables, payments, bank transactions, tax filings, or accounting exports.

## 30. GO / NO-GO Recommendation

Recommendation: GO for Payroll Backend Contract Foundation only after the required product confirmations above are answered.

NO-GO for Payroll Workspace UI, payment execution, payroll provider integration, ACH/card/check payouts, tax filing, W2/1099 generation, benefits, garnishments, accounting export, bank reconciliation, or worker portal until Payroll Backend Contract Foundation is implemented and validated.

Primary readiness gaps before coding:

- Worker classification ownership is not defined.
- Worker payroll rate source is not defined.
- Worker-level tax/compliance readiness is missing.
- Approved time source is not implemented.
- 1099 individual worker routing between Payroll and Contractor Payable needs confirmation.
- Overtime must remain supplied, not inferred, unless a legal/policy rules sprint is completed.

## 31. Validation Notes

Non-mutating validation for this clarification sprint:

- `git status --short`
- inspected worker/crew/capacity/production/work order/project/contractor payable/cash/payment/payroll-adjacent routes
- inspected migrations for capacity, production, finance, settlement, cash, collections, and contractor payable
- inspected permissions/events patterns
- inspected smoke scripts
- inspected related product docs
- `git diff --check`

No application code, migrations, routes, UI, tests, or business objects should be changed by this sprint.
