# Operator Persona Workflow Maps

## Executive

- Landing page: Command Center Executive view.
- Nav visible: Command Center, Growth, Opportunities, Operations, Production, Quality, Billing, Cash, Payables, Reconciliation, Accounting Export.
- Daily workflow: inspect health, drill into exceptions, review bottlenecks, identify owner accountability.
- Key queues: aged opportunities, blocked work orders, QC aging, invoice/cash aging, reconciliation exceptions, export blockers.
- Primary decisions: where to allocate management attention; which process is constrained.
- Allowed actions: read, drill down, view timelines; mutation only if explicitly granted.
- Denied actions: operational and finance lifecycle mutations by default.
- Dashboard widgets: revenue at risk, production throughput, QC aging, unapplied cash, payables ready, recon exceptions.
- Success criteria: can identify the top five bottlenecks in under two minutes.
- Current UX gaps: executive dashboards are separate routes, metrics lack targets/trends, no role landing page.

## Growth Operator

- Landing page: Growth workspace, default Signal Feed.
- Nav visible: Command Center, Growth, Opportunities.
- Daily workflow: review new signals, add evidence, assign owners, qualify organizations/contacts, convert ready signals to candidates.
- Key queues: Needs Review, High Confidence Unassigned, Missing Organization, Ready for Candidate.
- Primary decisions: whether a signal is actionable and who owns it.
- Allowed actions: create/categorize/score/verify/archive signals; manage organizations, contacts, relationship maps, candidates; create opportunities where granted.
- Denied actions: finance, payables, payroll, payment, bank, accounting export writes.
- Dashboard widgets: new signals, verified signals, candidate conversion, stale relationships.
- Success criteria: every high-confidence signal has owner, organization, evidence, and next action.
- Current UX gaps: developer token/session panel visible, filters dominate, no review-next flow.

## Operations Manager

- Landing page: Operations Board.
- Nav visible: Command Center, Opportunities, Operations, Production, Quality.
- Daily workflow: review pipeline handoff, unblock projects, create/monitor work orders, track production and QC throughput.
- Key queues: Blocked Projects, Ready Work Orders, Production Drafts, QC Returned.
- Primary decisions: what work can start, what is blocked, what needs escalation.
- Allowed actions: coverage/project/work-order lifecycle; production read/create/submit where policy grants.
- Denied actions: finance/payment/accounting writes.
- Dashboard widgets: active projects, blocked work orders, due production, QC aging.
- Success criteria: work orders are staffed, blockers are owned, production flow is visible.
- Current UX gaps: Projects, Work Orders, Production, and QC are separate object pages without a unified board.

## Field Supervisor

- Landing page: Production Queue.
- Nav visible: Command Center, Operations, Production, Quality read-only.
- Daily workflow: open assigned work, create production records, submit production, correct returned records.
- Key queues: My Drafts, Due Today, Correction Requested, Submitted Awaiting QC.
- Primary decisions: what production record must be submitted or corrected.
- Allowed actions: production create/update/submit/correct where granted; evidence actions.
- Denied actions: finance, payables, payroll, bank, accounting writes.
- Dashboard widgets: assigned work orders, draft production, corrections, approved production.
- Success criteria: no completed field work remains unsubmitted.
- Current UX gaps: next production action is not prominent from work order detail.

## QC Manager

- Landing page: Quality Review Queue.
- Nav visible: Command Center, Production read-only, Quality.
- Daily workflow: start reviews, approve, request/mark corrections, archive voided review records.
- Key queues: Pending Review, In Review, Correction Requested, Aging Reviews.
- Primary decisions: approve or require correction.
- Allowed actions: QC start review, approve, mark corrected, archive per permission.
- Denied actions: production creation beyond review scope; finance/payment/accounting writes.
- Dashboard widgets: pending reviews, aging reviews, correction loop count, approval throughput.
- Success criteria: review queue is current and correction loops are visible.
- Current UX gaps: QC list needs stronger review queue defaults and decision framing.

## Billing / Finance User

- Landing page: Billing Workbench.
- Nav visible: Command Center, Billing, Cash, Collections, limited Payables where policy grants.
- Daily workflow: review billable readiness, settlement review, invoice sending, cash application, dispute resolution.
- Key queues: Ready to Settle, Settlement Review, Ready to Send, Unapplied Cash, Disputed Invoices.
- Primary decisions: whether revenue records can advance and what is blocked.
- Allowed actions: billable, settlement, invoice, cash receipt, payment application, collections actions.
- Denied actions: production/QC/payment execution/bank/accounting export writes unless explicitly granted.
- Dashboard widgets: unbilled approved work, invoice aging, unapplied cash, disputed revenue.
- Success criteria: approved work moves to invoice and cash is applied with audit trail.
- Current UX gaps: finance pages are split by object and need a workbench view.

## Collections Specialist

- Landing page: Collections Queue.
- Nav visible: Command Center, Cash, Collections under Cash.
- Daily workflow: review overdue invoices, assign cases, complete collection actions, archive closed cases/actions.
- Key queues: Unassigned Cases, Next Action Due, Overdue, Closed Ready to Archive.
- Primary decisions: who owns the case and what action happens next.
- Allowed actions: collection case/action lifecycle, read invoice/cash/payment context.
- Denied actions: cash receipt creation/application unless granted; accounting export/tax/legal filing.
- Dashboard widgets: overdue balance, cases by owner, actions due, promises broken.
- Success criteria: every overdue case has owner and next action.
- Current UX gaps: collection actions are separate from case workflow and need due-date queue.

## Payables / Payroll Admin

- Landing page: Payables Workbench.
- Nav visible: Command Center, Payables.
- Daily workflow: prepare contractor payables, payroll runs, payment batches; submit for review; mark readiness.
- Key queues: Draft Payables, Under Review, Ready for Payment, Payroll Ready, Payment Batch Review.
- Primary decisions: whether cost/labor records are complete and ready.
- Allowed actions: contractor payable, payroll, payment batch preparation actions.
- Denied actions: actual payment movement, provider submission, bank/accounting writes unless granted.
- Dashboard widgets: payables needing totals, payroll pending review, payment batches awaiting approval.
- Success criteria: payables/payroll are internally ready without implying external payment.
- Current UX gaps: payment terminology can imply money movement; boundaries must be stronger.

## Accounting Manager

- Landing page: Reconciliation Board.
- Nav visible: Command Center, Cash read-only, Payables read-only, Reconciliation, Accounting Export.
- Daily workflow: match transactions, open/resolve exceptions, review matches, prepare/approve/export internal accounting batches.
- Key queues: Unmatched Debit, Unmatched Credit, Open Exceptions, Proposed Matches, Export Review.
- Primary decisions: how a transaction should reconcile and whether export totals are acceptable.
- Allowed actions: bank account/transaction/reconciliation/accounting export lifecycle.
- Denied actions: payment movement, payroll provider submission, external GL/API calls.
- Dashboard widgets: unmatched transactions, exception aging, proposed match confidence, export control totals.
- Success criteria: no stale unreconciled transaction or unreviewed export batch.
- Current UX gaps: bank/accounting pages must be explicit that no bank feed or GL integration exists.

## Read-only Auditor

- Landing page: Audit Command Center.
- Nav visible: all readable workspaces, no mutation actions.
- Daily workflow: inspect records, timelines, audit summaries, permission boundaries.
- Key queues: recently changed records, lifecycle transitions, high-risk financial actions.
- Primary decisions: whether records and actions are traceable.
- Allowed actions: read, timeline, optional audit view.
- Denied actions: all create/update/lifecycle/archive/void/cancel.
- Dashboard widgets: mutation history, high-risk action count, permission denial checks.
- Success criteria: can verify who changed what and when without mutation risk.
- Current UX gaps: read-only mode currently relies on tests but needs visible role context and disabled/hidden rationale.

## System Admin

- Landing page: Admin.
- Nav visible: all workspaces plus Admin.
- Daily workflow: manage users, roles, permission bundles, tenant settings, environment health, emergency support.
- Key queues: users needing role assignment, failed auth, integration status placeholders, audit policy tasks.
- Primary decisions: who has access and whether environment is correctly configured.
- Allowed actions: administrative actions and high-privilege lifecycle support where policy grants.
- Denied actions: forbidden integrations that do not exist.
- Dashboard widgets: users, roles, permissions, build/environment, audit health.
- Success criteria: production operator session is controlled without exposing developer token UI.
- Current UX gaps: no admin pages exist; developer session panel leaks into operator flow.
