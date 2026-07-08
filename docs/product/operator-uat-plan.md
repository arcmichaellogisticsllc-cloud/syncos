# Operator UAT Plan

Purpose: provide structured role-by-role testing for controlled SyncOS operator UAT. UAT validates comprehension, safe action boundaries, role visibility, and daily workflow usefulness. It does not certify production deployment or external integrations.

## Test Format

Use the seeded staging/UAT tenant and record each result as PASS, PARTIAL, or FAIL. Capture friction notes, missing data, unclear copy, and any action the tester expected but could not find.

## Executive

- Primary landing page: `/` and `/executive`
- 30-second understanding: business health, blockers, cash exposure, workflow risk, and decisions needing attention.
- Daily tasks: review priorities, blockers, finance exposure, operations throughput, and recommendations.
- Required test path: open `/`, open `/executive`, review priority cards, open `/operations`, explain what needs attention today.
- Available actions: navigation, drill-down links, read-safe detail review.
- Unavailable actions: direct lifecycle mutation unless the user also has domain permissions.
- Success criteria: tester can identify blockers, cash risk, throughput risk, and next review surfaces without asking where to go.
- Tester questions: What would you review first? Which risk looks highest? What information is missing for a decision?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Growth Operator

- Primary landing page: `/intelligence/signals`
- 30-second understanding: which signals need review, evidence, verification, or candidate readiness.
- Daily tasks: review signals, create signal, categorize, score, verify when evidence exists, archive irrelevant signals.
- Required test path: open Signal Feed, select queue tabs, create a signal, open signal detail, read next-action and conversion boundary.
- Available actions: create/categorize/score/verify/archive when permissions and state allow.
- Unavailable actions: project, invoice, cash, payment, payroll, bank, or accounting creation from signal actions.
- Success criteria: tester can explain what Verify does and what it does not create downstream.
- Tester questions: Which signal would you open first? What evidence is required? Is conversion boundary clear?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Operations Manager

- Primary landing page: `/operations`
- 30-second understanding: planned, active, blocked, production-missing, and QC-ready work.
- Daily tasks: review operations lanes, open work orders, identify blockers, inspect production/QC relationships.
- Required test path: open `/operations`, open `/work-orders`, select Blocked or Production Missing, open a Work Order detail.
- Available actions: work-order lifecycle actions according to permission and state.
- Unavailable actions: finance, cash, payout, reconciliation, and accounting mutation.
- Success criteria: tester can state what work needs operational attention today.
- Tester questions: Where would you resolve a blocker? What would you hand to a field supervisor?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Field Supervisor

- Primary landing page: `/production`
- 30-second understanding: draft, submitted, correction-required, approved, and billable-ready production.
- Daily tasks: submit production, respond to corrections, review evidence, mark correction complete where permitted.
- Required test path: open Production Board, open correction-required or draft record, read next-action card, inspect evidence/timeline.
- Available actions: production lifecycle actions allowed by state and permission.
- Unavailable actions: invoice, cash, payment, payroll, bank, or accounting actions.
- Success criteria: tester can explain what Mark Billable does and does not do.
- Tester questions: What production needs correction? What proof would you add?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## QC Manager

- Primary landing page: `/qc`
- 30-second understanding: QC items pending review, in review, correction-required, corrected, approved, and aging.
- Daily tasks: start review, approve, request/track correction, inspect evidence.
- Required test path: open QC Review Queue, select Pending Review, open QC detail, read evidence and boundary copy.
- Available actions: QC review actions allowed by state and permission.
- Unavailable actions: invoicing, cash application, payout, bank reconciliation, and accounting export mutation.
- Success criteria: tester can distinguish QC approval from invoice/cash creation.
- Tester questions: Is evidence visible before approval? What would you send back?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Billing / Finance User

- Primary landing page: `/billable`
- 30-second understanding: billable readiness, settlement review, invoice review/sent/dispute state.
- Daily tasks: review billable items, settlements, invoices, disputes, holds, and finance boundaries.
- Required test path: open `/billable`, `/settlements`, `/invoices`, open invoice detail, review danger zone and boundary copy.
- Available actions: finance lifecycle actions allowed by state and permission.
- Unavailable actions: money movement, cash collection, QuickBooks/ERP/GL posting.
- Success criteria: tester can explain Mark Sent and Mark Invoice Ready without implying external sending/posting.
- Tester questions: Which invoice needs review? What does Mark Sent not do?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Collections Specialist

- Primary landing page: `/collections`
- 30-second understanding: cases needing action, unassigned cases, disputes, promises, aging, completed actions.
- Daily tasks: assign owner, add/complete manual collection actions, review disputes/promises.
- Required test path: open Collections Workbench, select Needs Action, open a case/action detail, review boundary copy.
- Available actions: collection case/action updates allowed by state and permission.
- Unavailable actions: automatic email, phone calls, legal filing, credit reporting, collecting money.
- Success criteria: tester understands actions are manual task records, not automated communications.
- Tester questions: What follow-up is due? Who owns it? What was promised?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Payables / Payroll Admin

- Primary landing page: `/contractor-payables`
- 30-second understanding: contractor payables, payroll readiness, and payment execution status.
- Daily tasks: review payables, approve readiness, mark payment/payroll ready, schedule/record manual payment execution.
- Required test path: open `/contractor-payables`, `/payroll`, `/payments`, open payment batch detail.
- Available actions: payout/payroll readiness actions allowed by state and permission.
- Unavailable actions: ACH, wire, card payout, check printing, payroll provider submission, tax filing, money movement.
- Success criteria: tester can explain payment-ready vs paid and payroll-ready vs payroll run.
- Tester questions: Which batch is scheduled? What does Mark Executed mean?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Accounting Manager

- Primary landing page: `/bank-reconciliation`
- 30-second understanding: bank evidence matching, exceptions, export review, submitted/accepted handoff state.
- Daily tasks: review unmatched credits/debits, open/resolve exceptions, review matches, approve/mark exports.
- Required test path: open Bank Reconciliation, select Open Exceptions, open Accounting Export, create export batch form review.
- Available actions: reconciliation/accounting handoff actions allowed by state and permission.
- Unavailable actions: bank connection, bank feed import, payment execution, GL posting, QuickBooks/ERP/tax posting.
- Success criteria: tester can explain reconciliation/export boundaries.
- Tester questions: What transaction needs matching? What does Mark Accepted prove?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## Read-only Auditor

- Primary landing page: `/`
- 30-second understanding: readable workspaces and details are inspectable; mutation actions are hidden or disabled.
- Daily tasks: inspect queues, open representative details, review read-only banner, timeline, and audit context.
- Required test path: open Production detail, Invoice detail, Accounting Export detail, confirm read-only banner and disabled reason.
- Available actions: read-safe navigation and inspection.
- Unavailable actions: lifecycle mutation, creates, edits, destructive actions.
- Success criteria: tester understands why actions are unavailable and where evidence lives.
- Tester questions: Can you find status, related records, and audit history? Is the read-only explanation sufficient?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL

## System Admin

- Primary landing page: `/`
- 30-second understanding: broad read/workflow access exists; Admin workspace is planned unless implemented later.
- Daily tasks: inspect all workspaces, validate role visibility, review audit-sensitive areas.
- Required test path: navigate all top workspaces, confirm Admin planned treatment, verify no developer session UI.
- Available actions: broad actions per seeded permissions.
- Unavailable actions: unsupported Admin routes, external integrations, direct backend/admin bypasses.
- Success criteria: tester can validate shell/navigation without seeing unsupported admin pages as broken routes.
- Tester questions: Which Admin capabilities are missing for staging? Which role setup steps are needed?
- Observed friction notes: TBD.
- Result: [ ] PASS [ ] PARTIAL [ ] FAIL
