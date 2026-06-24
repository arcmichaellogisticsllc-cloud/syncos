# E2E Persona Permission Matrix

## Purpose

This document defines the target browser E2E personas, permission families, allowed/denied workspace behavior, and certification expectations.

Current status: named E2E personas are not confirmed in seed. Existing smoke scripts create JWTs from `AUTH_JWT_SECRET` and verify missing permission/limited-token behavior. Future Browser E2E must seed named personas or create runtime auth storage states.

## Minimum Certification Personas

| Persona | Purpose | Expected result |
| --- | --- | --- |
| System Admin | Administrative full-path certification and fallback operator. | Can see all workspaces and perform administrative lifecycle actions. |
| Operations / Project Manager | Certify coverage, handoff, project, work order, and execution planning. | Cannot see or perform finance-only actions unless explicitly granted. |
| Finance / Billing User | Certify revenue, payables, payroll-ready payment preparation, reconciliation, and export where allowed. | Cannot perform growth/field operations lifecycle unless granted. |
| Read-Only Auditor | Certify read-only visibility and denial behavior. | Read-only actions visible; write buttons hidden/disabled; backend denies writes. |

## Full Certification Personas

| Persona | Purpose | Allowed workspace access | Denied workspace access | Timeline | Audit |
| --- | --- | --- | --- | --- | --- |
| System Admin | Full administration and certification setup. | All workspaces. | None except intentionally forbidden external integrations. | Allowed. | Allowed. |
| Growth Operator | Growth and early opportunity. | Signals, organizations, contacts, relationship maps, candidates, opportunities through submit/review. | Finance, payroll, payment, bank reconciliation, accounting export writes. | Allowed for growth. | Product decision: allow for growth or use separate audit variant. |
| Operations / Project Manager | Delivery planning and operations. | Opportunities read, coverage, project handoff, projects, work orders, production read/create/submit. | Finance/payment/accounting writes. | Allowed for operations. | Product decision. |
| Field Supervisor | Field execution. | Projects read, work orders read, production create/update/submit, evidence create/archive, QC read. | Finance, payables, payroll, bank, accounting writes. | Allowed for field records. | Usually denied unless product grants. |
| QC Reviewer | Quality review. | Production read, evidence read, QC review lifecycle. | Production creation beyond review scope, finance/payment/accounting writes. | Allowed for QC. | Product decision. |
| Billing / Finance User | Revenue cycle and broad finance. | Billable, settlement, invoice, cash receipt, payment application, collections. | Growth/field lifecycle writes unless granted. | Allowed for finance. | Allowed for finance if policy confirms. |
| Collections Specialist | Collections workflow. | Invoice read, cash receipt read, payment application read, collection case/action lifecycle. | Cash receipt/payment application creation unless explicitly granted. | Allowed for collections. | Product decision. |
| Payables / Payroll Admin | Payables, payroll, and payment preparation. | Contractor payable, payroll, payment batch read/create/update/add item/submit review/start review, payment item read/create/update. | Payment execution approval/mark executed unless product grants; bank/accounting writes. | Allowed for cost/labor. | Product decision. |
| Accounting Manager | Verification and accounting interface. | Bank accounts, bank transactions, reconciliation matches, accounting export, finance read context. | Payment movement, payroll provider submission, external accounting APIs. | Allowed. | Allowed. |
| Read-Only Auditor | Oversight without mutation. | Read-only workspace access and optional timeline. | All writes, lifecycle actions, archive/void/cancel. | Optional allowed. | Audit-specific variant only. |

## Permission Families

### System Admin

* all seeded permissions
* all future E2E test permissions once approved

Expected UI behavior:

* all authorized actions visible
* forbidden integration actions absent or placeholder-only

Expected backend behavior:

* authorized lifecycle actions succeed
* architecture-forbidden operations remain impossible because no routes/integrations exist

### Growth Operator

Allowed permission families:

* `signal.*`
* `signal_evidence.*`
* `signal_entity.*`
* `organization.read/create/update/qualify/timeline.read/audit.read` as appropriate
* `contact.read/create/update/verify`
* `relationship_map.*`
* `relationship_path.*`
* `opportunity_candidate.*`
* `candidate_signal.*`
* `opportunity.read/create/update/submit_review`

Should not have:

* `settlement.*`
* `invoice.*`
* `cash_receipt.*`
* `contractor_payable.*`
* `payroll_run.*`
* `payment_batch.*`
* `bank_transaction.*`
* `accounting_export_batch.*`

### Operations / Project Manager

Allowed permission families:

* `opportunity.read`
* `coverage_plan.*`
* `coverage_requirement.*`
* `coverage_source.*`
* `coverage_gap.*`
* `project_handoff.*`
* `project.*`
* `work_order.*`
* `production.read/create/update/submit`
* `production_evidence.*`

Should not have:

* invoice/cash/payable/payroll/payment/bank/accounting export write permissions unless explicitly confirmed.

### Field Supervisor

Allowed permission families:

* `project.read`
* `work_order.read`
* `production.read/create/update/submit`
* `production_evidence.read/create/archive`
* `qc_review.read`

Should not have:

* settlement, invoice, payment, payroll, bank, accounting export writes.

### QC Reviewer

Allowed permission families:

* `production.read`
* `production_evidence.read`
* `qc_review.*`

Should not have:

* settlement, invoice, payment, payroll, bank, accounting export writes.

### Billing / Finance User

Allowed permission families:

* `billable_item.*`
* `settlement.*`
* `settlement_item.*`
* `invoice.*`
* `invoice_item.*`
* `cash_receipt.*`
* `payment_application.*`
* `collection_case.*`
* `collection_action.*`

Should not have:

* payment execution mark-executed, bank reconciliation approval, accounting export approval unless finance/accounting policy grants them.

### Collections Specialist

Allowed permission families:

* `invoice.read`
* `cash_receipt.read`
* `payment_application.read`
* `collection_case.*`
* `collection_action.*`

Should not have:

* cash receipt creation
* payment application creation
* invoice balance mutation
* accounting export/tax/legal filing creation

### Payables / Payroll Admin

Allowed permission families:

* `contractor_payable.*`
* `contractor_payable_item.*`
* `payroll_run.*`
* `payroll_item.*`
* `payment_batch.read`
* `payment_batch.create`
* `payment_batch.update`
* `payment_batch.add_item`
* `payment_batch.submit_review`
* `payment_batch.start_review`
* `payment_item.read`
* `payment_item.create`
* `payment_item.update`

Should not have unless explicitly confirmed:

* `payment_batch.approve`
* `payment_batch.submit_execution`
* `payment_batch.mark_executed`
* bank transaction or accounting export write permissions

### Accounting Manager

Allowed permission families:

* `bank_account.*`
* `bank_transaction.*`
* `reconciliation_match.*`
* `accounting_export_batch.*`
* `accounting_export_item.*`
* finance read context

Should not have:

* external accounting API permissions because no such integrations are in scope
* payment movement permissions
* payroll provider submission permissions

### Read-Only Auditor

Allowed permission families:

* read permissions across major workspaces
* optional `*.timeline.read`
* audit permissions only in audit-specific test variant

Should not have:

* create/update/lifecycle/archive/void/cancel permissions

## Certification Expectations

For every persona:

* UI hides or disables actions the persona cannot perform.
* Backend denies direct unauthorized requests.
* Unauthorized audit payloads are not leaked.
* Cross-tenant IDs are rejected or hidden.
* Missing permissions produce plain-language denial where UI surfaces the error.

## Current Gaps / Unknowns

* Named E2E personas are not currently confirmed in seed.
* Exact role-to-permission bundles need product approval.
* Current workspace shells often accept pasted JWT/permission strings; browser E2E authentication method must be confirmed.
* Audit visibility for non-admin personas needs policy confirmation per domain.
* Whether Payables / Payroll Admin can approve or only submit payment batches needs confirmation.
