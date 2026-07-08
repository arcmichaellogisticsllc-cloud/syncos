# Operator Demo Scripts

Purpose: give the team repeatable SyncOS demo flows for controlled operator review. These scripts are for staging/UAT storytelling and must not claim production deployment, external integrations, money movement, bank connectivity, payroll submission, QuickBooks/ERP/GL posting, or automated customer/contractor communications.

## 1. Executive Command Center Demo

- Objective: show SyncOS as a telecom operations command center.
- Persona: Executive.
- Route sequence: `/` -> `/executive` -> `/operations`.
- Talking points:
  - Daily priorities, blockers, cash exposure, throughput risk, and decision queues are surfaced first.
  - Operators should not hunt through raw object pages to find today's work.
  - Operations Board shows what is planned, active, blocked, production-missing, and QC-ready.
- What not to claim: do not claim automated forecasting, accounting close, or production deployment.
- Expected operator questions: What data drives each priority? Can roles get custom landings? How are blockers escalated?
- Known gaps: role-specific landing modules need deeper personalization.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL

## 2. Growth to Opportunity Demo

- Objective: show market intelligence review and safe conversion boundaries.
- Persona: Growth Operator.
- Route sequence: `/intelligence/signals` -> seeded signal detail.
- Talking points:
  - Signal Feed is queue-first with priority cards, tabs, collapsed filters, and next actions.
  - Create/categorize/score/verify/archive use operator modals and disabled reasons.
  - Signal detail explains that signal actions do not create opportunity, project, invoice, cash, payment, payroll, bank, or accounting records unless a separate explicit conversion exists.
- What not to claim: do not claim automatic opportunity creation, AI qualification, or external data enrichment.
- Expected operator questions: What evidence is enough to verify? Who owns candidate conversion? How are duplicates handled?
- Known gaps: owner assignment and explicit candidate conversion remain future workflow work.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL

## 3. Field Execution Demo

- Objective: show work moving from planning to production to QC.
- Persona: Operations Manager / Field Supervisor / QC Manager.
- Route sequence: `/work-orders` -> `/production` -> `/qc`.
- Talking points:
  - Work Orders answer what is ready, active, blocked, production-missing, and ready for QC.
  - Production Board shows draft/submitted/review/correction/approved/billable-ready queues.
  - QC Review Queue protects downstream billable readiness with evidence and correction visibility.
- What not to claim: do not claim mobile app support, dispatch automation, customer portal, or invoice creation from approval.
- Expected operator questions: Can field supervisors submit from tablets? Where is evidence uploaded? How are corrections tracked?
- Known gaps: mobile field workflow needs UAT, and binary evidence upload is not part of this sprint.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL

## 4. Revenue Demo

- Objective: show approved work becoming internal billing and invoice readiness.
- Persona: Billing / Finance User.
- Route sequence: `/billable` -> `/settlements` -> `/invoices` -> invoice detail.
- Talking points:
  - Billable, Settlement, and Invoice workbenches use queue cards, tabs, next-action columns, and boundary notices.
  - Mark Invoice Ready and Mark Sent are internal workflow states.
  - Invoice Detail separates danger-zone risk from routine review.
- What not to claim: do not claim SyncOS emails invoices, collects payment, posts to QuickBooks/ERP/GL, or creates cash automatically.
- Expected operator questions: What creates an invoice? How are disputes resolved? Where is aging shown?
- Known gaps: customer terms/aging and deeper detail forms need more data support.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL

## 5. Customer Cash Demo

- Objective: show received cash, application visibility, and collections follow-up boundaries.
- Persona: Billing / Finance User / Collections Specialist.
- Route sequence: `/cash` -> `/collections`.
- Talking points:
  - Cash Application tracks internal receipt and application state.
  - Collections tracks manual follow-up tasks, ownership, disputes, promises, and action history.
  - Boundary copy explicitly rules out bank feeds, card processing, ACH, automatic email/calls, legal action, and credit reporting.
- What not to claim: do not claim bank integration, automated payment processing, automated communications, or credit/legal workflows.
- Expected operator questions: How is unapplied balance calculated? Can promises to pay be reported? Can actions be assigned?
- Known gaps: richer receipt balance and promise metadata summaries need backend support.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL

## 6. Payout Demo

- Objective: show contractor payable, payroll readiness, and payment execution as controlled internal states.
- Persona: Payables / Payroll Admin.
- Route sequence: `/contractor-payables` -> `/payroll` -> `/payments` -> payment batch detail.
- Talking points:
  - Contractor Payables and Payroll mark internal readiness, not payment or payroll execution.
  - Payment Execution records internal/manual scheduling, submission, and execution status.
  - Payment Ready is not Paid; Payroll Ready is not payroll run; Mark Executed records external/manual status only.
- What not to claim: do not claim ACH, wire, card payout, check printing, direct deposit, payroll provider submission, tax filing, or bank movement.
- Expected operator questions: Who approves payments? How are payment items grouped? What evidence supports Mark Executed?
- Known gaps: payment item attention summaries and explicit scheduled/executed reporting need more backend summary data.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL

## 7. Finance Control Demo

- Objective: show reconciliation and accounting handoff without implying external integrations.
- Persona: Accounting Manager.
- Route sequence: `/bank-reconciliation` -> bank transaction detail -> `/accounting-exports` -> accounting export detail/new form.
- Talking points:
  - Bank Reconciliation matches bank-side evidence to SyncOS cash/payment records.
  - Accounting Export prepares and tracks internal handoff batches and items.
  - Mark Submitted and Mark Accepted record manual/external process state only.
- What not to claim: do not claim bank feeds, bank connection, automated matching, QuickBooks/ERP/GL posting, tax filing, or accounting close.
- Expected operator questions: How are transactions entered? How are exceptions resolved? What export evidence is retained?
- Known gaps: side-by-side match comparison and backend export item attention summaries need future work.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL

## 8. Read-only Auditor Demo

- Objective: show inspect-only role behavior and audit/timeline context.
- Persona: Read-only Auditor.
- Route sequence: `/production/[seeded-id]` -> `/invoices/[seeded-id]` -> `/accounting-exports/[seeded-id]`.
- Talking points:
  - Read-only banner explains view-only behavior.
  - Mutation actions are hidden or disabled, while status, related records, timeline, and audit remain inspectable where permitted.
  - Disabled reasons explain permission/state blockers without revealing sensitive internals.
- What not to claim: do not claim auditor can approve, alter, export, or mutate lifecycle state.
- Expected operator questions: Which audit events are visible? Can auditors export reports? What is hidden by permission?
- Known gaps: audit/reporting package and full read-only UAT across all detail pages remain open.
- Demo readiness: [ ] PASS [ ] PARTIAL [ ] FAIL
