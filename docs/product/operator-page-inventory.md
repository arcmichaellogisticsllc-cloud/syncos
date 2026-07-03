# Operator Page Inventory

## Inventory Standards

Every page below is evaluated with the same product fields:

- Current route.
- Current page type.
- Proposed page type.
- Primary persona.
- Secondary personas.
- Operator purpose.
- Primary question answered.
- Primary action.
- Secondary actions.
- Destructive actions.
- Required data.
- Tabs/sections.
- Empty state.
- Loading state.
- Error state.
- Permission notes.
- Current UX problem.
- Redesign recommendation.
- Priority.

To keep this inventory readable, each row contains the route-specific values for those fields. Common standards apply to every row:

- Empty state: explain why no records exist and show a safe next action.
- Loading state: show skeleton or "Loading [business object]..." in the content area, not a blank page.
- Error state: show plain-language error with retry and correlation reference where available.
- Permission notes: hide unauthorized mutations, keep read-only context visible where granted, explain disabled actions when visible.
- Tabs/sections: details should include Summary, Activity/Timeline, Audit, Related Work, and domain-specific tabs.

## Page Type Definitions

| Type | Meaning |
|---|---|
| Dashboard | Aggregated health, priority, risk, and drill-down page. |
| Queue/List | Work queue with default prioritized filter, status summary, and next action. |
| Detail | Single-object command page with status, actions, related records, timeline, audit. |
| Create | Guided object creation flow. |
| Edit | Controlled field update flow. |
| Review/Approval | State-gated decision page or detail view with approve/reject/correction actions. |
| Financial Control | High-risk finance page requiring boundaries, audit, and safe actions. |
| Reconciliation Workspace | Match/exception/review workspace for bank or ledger verification. |
| Accounting Export Workspace | Internal export lifecycle workspace without external GL integration. |
| Admin/Config | Tenant, role, permission, and environment configuration. |

## A. Command / Executive

| Route | Current type | Proposed type | Personas | Purpose and primary question | Actions | Required data and sections | UX problem | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/` | Dashboard shell | Role-aware Command Center | All, tailored | "What requires my attention today?" | Open priority queue, resume assigned work, view exceptions. | Cross-domain status, priority work, stale items, blocked workflows, timeline summary. | Generic command center with limited role guidance. | Make it the authenticated landing page with role-specific modules. | P0 |
| `/executive` | Dashboard | Executive dashboard module | Executive, Admin, Auditor | "Where is the business blocked or at risk?" | Drill into risk queues, export visible summary later. | Revenue health, ops throughput, aged exceptions, finance controls. | Too separate from command center. | Fold into Command Center as Executive view. | P1 |
| `/growth` | Dashboard | Growth command module | Growth Operator, Executive | "Which growth items should move forward?" | Open Signal Feed, review candidates, inspect stale relationships. | Signal counts, candidates, pipeline conversion. | Dashboard and Intelligence split creates confusion. | Merge into Growth landing with queue links. | P1 |
| `/operations` | Dashboard | Operations command module | Operations Manager, Field Supervisor | "Which projects/work orders/production records need action?" | Open blockers, production exceptions, QC returns. | Projects, work orders, production, QC aging. | Reads like a report, not a workbench. | Make default queue point to blockers and due work. | P1 |
| `/finance` | Dashboard | Finance command module | Finance, Accounting Manager | "Which billing, cash, payables, recon, export items need control?" | Open ready-to-bill, cash exceptions, payables ready, recon exceptions. | Billing, cash, payables, payroll, recon, export health. | Finance is too broad and duplicates many nav items. | Use as role landing, not a top-level peer to every finance workspace. | P1 |
| `/constraints-center` | Dashboard | Exception/risk dashboard | Executive, Ops Manager | "What constraints are limiting throughput?" | Open constrained work, assign owner future. | Constraint list, domain, severity, owner, age. | Abstract and disconnected from action queues. | Convert to cross-domain constraints module with links. | P2 |
| `/recommendations-center` | Dashboard | Recommendations review queue | Executive, Managers | "What does SyncOS recommend next?" | Review recommendation, dismiss/defer future. | Recommendation source, impact, confidence, owner. | No operator decision workflow. | Make recommendations actionable and auditable. | P2 |
| `/workflows-center` | Dashboard | Workflow health map | Executive, Admin | "Which workflow stages are healthy or stuck?" | Open stage queue. | Stage counts, SLA, stuck records, handoff boundaries. | Report-only. | Add drill-down queues per stage. | P2 |
| `/kpis-center` | Dashboard | KPI scorecard | Executive, Managers | "Are KPIs on target?" | Drill into KPI causes. | Current, target, trend, owner, queue link. | Zero or raw metrics lack context. | Add target/trend/explanation for every KPI. | P2 |

## B. Intelligence

| Route | Current type | Proposed type | Personas | Purpose and primary question | Actions | Required data and sections | UX problem | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/intelligence` | Dashboard/list entry | Growth workspace landing | Growth Operator | "What intelligence work is ready now?" | Open Signal Feed, Organizations, Contacts, Relationship Maps. | Priorities, source health, stale unassigned items. | Entry route is secondary to specific object lists. | Make it Growth workspace overview or redirect to Signal Feed. | P1 |
| `/intelligence/signals` | Queue/list | Signal Feed queue | Growth Operator | "Which signals deserve review, assignment, or candidate conversion?" | Create Signal, Review Next Signal, Assign Owners, Convert Ready Signals. | Priority cards, queue tabs, signal list, collapsed filter drawer. | Developer session UI, filters dominate, no next-best action. | Use `signal-feed-redesign-spec.md`. | P0 |
| `/intelligence/signals/[id]` | Detail | Signal detail command page | Growth Operator | "Is this signal actionable and what is missing?" | Categorize, Score, Verify, Archive, Convert future. | Summary, evidence, organizations, contacts, timeline, audit. | Detail route can expose object-first data. | Center evidence, confidence, owner, next action. | P1 |
| `/intelligence/organizations` | Queue/list | Organization account queue | Growth Operator | "Which organizations need qualification or relationship work?" | Create Organization, Qualify, Open Detail. | Organization list, status, territory, relationship strength. | List lacks operator priority. | Add queues: Needs Qualification, Active, Stale, Archived. | P2 |
| `/intelligence/organizations/new` | Create | Guided organization create | Growth Operator | "What minimum data creates a useful organization?" | Create, Cancel. | Required name/type, territory, source. | Generic create. | Add duplicate warning and required business fields. | P2 |
| `/intelligence/organizations/[id]` | Detail | Organization command page | Growth Operator | "What do we know and what relationship action is next?" | Qualify, Add Contact, Add Relationship, Archive future. | Profile, contacts, signals, opportunities, timeline, audit. | Relationship next action not prominent. | Add relationship health and next action. | P2 |
| `/intelligence/organizations/[id]/edit` | Edit | Controlled profile edit | Growth Operator | "What profile information needs correction?" | Save, Cancel. | Editable profile fields, validation. | Edit route isolated from command context. | Keep edit as secondary panel/modal from detail. | P3 |
| `/intelligence/contacts` | Queue/list | Contact relationship queue | Growth Operator | "Which contacts need verification or follow-up?" | Create Contact, Verify, Open Detail. | Contact status, org, role, last touch, owner. | No daily follow-up queue. | Add Needs Verification and Stale Contact queues. | P2 |
| `/intelligence/contacts/new` | Create | Guided contact create | Growth Operator | "Who is this contact and why does it matter?" | Create, Cancel. | Name, org, role, communication fields. | Generic form. | Add relationship purpose and source fields. | P3 |
| `/intelligence/contacts/[id]` | Detail | Contact command page | Growth Operator | "What is the relationship status and next touch?" | Verify, Add Note future, Open Org. | Profile, organization, signals, relationship map, timeline. | Weak next-touch workflow. | Add next interaction and relationship notes. | P2 |
| `/intelligence/contacts/[id]/edit` | Edit | Controlled contact edit | Growth Operator | "What contact data changed?" | Save, Cancel. | Contact fields, validation. | Edit page has low operator value. | Prefer inline edit from detail. | P3 |
| `/intelligence/relationship-maps` | Queue/list | Relationship map workspace | Growth Operator, Executive | "Which relationships can unlock opportunity?" | Create Map, Open Map. | Maps, orgs, contacts, influence strength. | Database-object language. | Reframe as Relationship Coverage. | P2 |
| `/intelligence/relationship-maps/new` | Create | Relationship map create | Growth Operator | "What relationship network are we mapping?" | Create, Cancel. | Primary org, contacts, purpose. | Generic create. | Add guided setup. | P3 |
| `/intelligence/relationship-maps/[id]` | Detail | Relationship map command page | Growth Operator | "Which path should we use?" | Add Path future, Update Strength future. | People, orgs, paths, signals, timeline. | Needs decision support. | Add recommended relationship path section. | P2 |
| `/intelligence/relationship-maps/[id]/edit` | Edit | Controlled map edit | Growth Operator | "What relationship map data changed?" | Save, Cancel. | Map fields. | Low-priority separate edit route. | Inline edit later. | P3 |

## C. Opportunity / Coverage

| Route | Current type | Proposed type | Personas | Purpose and primary question | Actions | Required data and sections | UX problem | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/opportunities` | List/landing | Opportunity workspace landing | Growth Operator, Ops Manager | "What deals need pursuit, approval, or handoff?" | Create Opportunity, open pipeline. | Pipeline summary, candidates, coverage gaps. | Split across candidates/pipeline/coverage. | Make landing with stage queues. | P1 |
| `/opportunities/pipeline` | Dashboard/board | Pipeline board | Growth Operator, Executive | "Which opportunities are moving or stuck?" | Open opportunity, submit review future. | Stage columns, value, owner, next action. | Needs operator next action. | Add stale and missing coverage indicators. | P1 |
| `/opportunities/new` | Create | Guided opportunity create | Growth Operator | "What opportunity should be pursued?" | Create, Cancel. | Customer, scope, value, source signal/candidate. | Generic. | Require source context where possible. | P2 |
| `/opportunities/[id]` | Detail | Opportunity command page | Growth/Ops | "Is this ready for approval or project handoff?" | Submit Review, approve future, start coverage. | Summary, coverage, candidate links, timeline, audit. | State-action hierarchy unclear. | Use review/approval page template. | P1 |
| `/opportunities/[id]/edit` | Edit | Controlled opportunity edit | Growth Operator | "What opportunity facts changed?" | Save, Cancel. | Editable fields. | Separate edit context. | Secondary action from detail. | P3 |
| `/opportunities/candidates` | Queue/list | Candidate qualification queue | Growth Operator | "Which candidates can become opportunities?" | Create Candidate, qualify, convert future. | Candidate score, evidence, org, owner. | Object-first list. | Add Needs Evidence, Ready to Convert queues. | P1 |
| `/opportunities/candidates/new` | Create | Candidate create | Growth Operator | "What evidence supports this candidate?" | Create, Cancel. | Signal, org, scope, confidence. | Generic. | Guide from signal conversion. | P2 |
| `/opportunities/candidates/[id]` | Detail | Candidate command page | Growth Operator | "What is missing before opportunity creation?" | Qualify, Convert future, Archive future. | Evidence, signals, org, contacts, timeline. | Missing checklist. | Add readiness checklist. | P1 |
| `/opportunities/candidates/[id]/edit` | Edit | Controlled candidate edit | Growth Operator | "What candidate facts changed?" | Save, Cancel. | Candidate fields. | Low priority. | Inline from detail. | P3 |
| `/opportunities/coverage` | Queue/list | Coverage planning queue | Ops Manager | "Which opportunities/projects lack coverage?" | Create Coverage Plan, open gaps. | Requirements, sources, gaps, status. | Not clearly tied to operations handoff. | Use coverage gap queue. | P1 |
| `/opportunities/coverage/new` | Create | Coverage plan create | Ops Manager | "What plan covers this work?" | Create, Cancel. | Opportunity/project, requirements. | Generic. | Add requirement checklist. | P2 |
| `/opportunities/coverage/[id]` | Detail | Coverage plan command page | Ops Manager | "Can we staff and execute this work?" | Add requirement/source/gap, mark ready future. | Requirements, assigned sources, gaps, timeline. | Need primary decision. | Add readiness status and blockers. | P1 |
| `/opportunities/coverage/[id]/edit` | Edit | Controlled coverage edit | Ops Manager | "What coverage plan changed?" | Save, Cancel. | Plan fields. | Low priority. | Inline sections. | P3 |

## D. Execution

| Route | Current type | Proposed type | Personas | Purpose and primary question | Actions | Required data and sections | UX problem | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/projects` | Queue/list | Project operations board | Operations Manager | "Which projects need attention?" | Open Project, create future. | Status, customer, owner, work orders, blockers. | Project list is database-first. | Add Active, Blocked, Ready for Work Order queues. | P1 |
| `/projects/[id]` | Detail | Project command page | Ops Manager | "What is project health and next operational action?" | Open work orders, create work order future. | Summary, work orders, production, QC, timeline, audit. | Needs operational status summary. | Add project health strip. | P1 |
| `/projects/[id]/edit` | Edit | Controlled project edit | Ops Manager | "What project details changed?" | Save, Cancel. | Project fields. | Low-priority separate edit. | Keep secondary. | P3 |
| `/work-orders` | Queue/list | Work order queue | Ops Manager, Field Supervisor | "Which work orders are ready, blocked, missing production, or ready for QC?" | Create Work Order, open blocked/active queues, open detail. | Ready to Start, Active, Blocked, Production Missing, Ready for QC, Completed, Archived; due date, crew, project, status, blockers, next action. | Phase 4 list redesign complete; detail/create still need stronger guided next-action treatment. | Add backend work-order-to-production coverage summary and detail next-action card later. | P0 |
| `/work-orders/new` | Create | Work order create | Ops Manager | "What work should field execute?" | Create, Cancel. | Project, scope, due date, crew. | Generic. | Add required scope and readiness. | P2 |
| `/work-orders/[id]` | Detail | Work order command page | Field Supervisor | "What needs to be done or submitted?" | Create Production, open production, update work order. | Scope, assignments, production records, QC status. | Next production action weak. | Add production CTA and blockers. | P0 |
| `/work-orders/[id]/edit` | Edit | Controlled work order edit | Ops Manager | "What work order plan changed?" | Save, Cancel. | Work order fields. | Low priority. | Secondary from detail. | P3 |
| `/production` | Queue/list | Production Board | Field Supervisor | "Which production records need submission, review, correction, approval, or billable readiness?" | Create Production Record, review submitted, open corrections, mark approved billable via detail. | Draft, Submitted, Under Review, Correction Required, Corrected, Approved, Billable Ready, Archived; work order, crew, quantity, QC, correction, billable, next action. | Phase 4 list redesign complete; detail/create still need stronger read-only context and guided workflows. | Add SLA/age fields and stronger production detail next-action card later. | P0 |
| `/production/new` | Create | Production create | Field Supervisor | "What work was completed?" | Create, Cancel. | Work order, quantity, date, evidence. | Generic. | Guide from work order and required measurements. | P1 |
| `/production/[id]` | Detail/review | Production command page | Field Supervisor, QC Manager | "Can this production record advance?" | Submit, Start Review, Approve, Mark Corrected, Mark Billable, Archive. | Summary, quantities, evidence, QC, billable status, timeline, audit. | Technically functional but state explanation can improve. | Use action-state standards and next-action card. | P0 |
| `/production/[id]/edit` | Edit | Controlled production edit | Field Supervisor | "What production details changed?" | Save, Cancel. | Production fields. | Edit separate from correction workflow. | Align edit with correction state. | P2 |
| `/qc` | Queue/list | QC Review Queue | QC Manager | "Which records need QC review, correction, aging attention, or approval?" | Create QC Review, review next item, open corrections, view aging reviews, open detail. | Pending Review, In Review, Correction Required, Corrected, Approved, Aging, Archived; evidence, issue status, review status, age, next action. | Phase 4 list redesign complete; detail page still needs fuller evidence-first layout. | Add explicit SLA aging and detail evidence decision template later. | P0 |
| `/qc/new` | Create | QC review create | QC Manager | "What production record requires QC?" | Create, Cancel. | Production, reviewer, criteria. | Generic. | Prefer create from production. | P2 |
| `/qc/[id]` | Review/detail | QC command page | QC Manager | "Approve, request correction, or archive?" | Start Review, Approve, Mark Corrected, Archive. | Production link, evidence, notes, timeline, audit. | Needs stronger decision framing. | Use review/approval template. | P0 |
| `/qc/[id]/edit` | Edit | Controlled QC edit | QC Manager | "What QC details changed?" | Save, Cancel. | QC fields. | Low priority. | Inline review notes. | P3 |

## E. Revenue

| Route | Current type | Proposed type | Personas | Purpose and primary question | Actions | Required data and sections | UX problem | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/billable` | Queue/list | Billable Workbench | Billing / Finance User | "What work is ready to become billable, and what is blocking settlement readiness?" | Review Next Billable Item, Open Holds, Open Disputes, Create Billable Candidate. | Ready for Review, On Hold, Disputed, Ready for Settlement, Missing Support, Archived; source production/work order, customer/project, amount, readiness, next action. | Phase 5 list redesign complete; detail/create still need stronger guided next-action treatment. | Add backend readiness reason summary for Missing Support and detail next-action cards later. | P0 |
| `/billable/new` | Create | Billable create | Finance | "What billable item should exist?" | Create, Cancel. | Source, amount, customer, status. | Risk of unsupported downstream implication. | Clarify no invoice creation until action. | P2 |
| `/billable/[id]` | Detail | Billable command page | Finance | "Can this item move toward settlement?" | Recalculate Readiness, Release Hold, Resolve Dispute, Archive. | Summary, source, readiness, settlement links, timeline, audit. | Needs state reasons. | Add readiness checklist. | P0 |
| `/billable/[id]/edit` | Edit | Controlled billable edit | Finance | "What billable facts changed?" | Save, Cancel. | Item fields. | Low priority. | Secondary from detail. | P3 |
| `/settlements` | Queue/list | Settlement Workbench | Finance | "Which settlements need review, which totals are blocked, and which settlements are invoice-ready?" | Review Next Settlement, Recalculate Readiness, Open Disputes, Open Invoice Ready, Create Settlement. | Draft, Submitted for Review, Needs Recalculation, Rejected, Approved, Invoice Ready, Disputed, Archived; totals, item count, readiness, invoice readiness, next action. | Phase 5 list redesign complete; detail/create still need stronger guided next-action treatment. | Add explicit recalculation-required backend flag and detail financial control next-action card later. | P0 |
| `/settlements/new` | Create | Settlement create | Finance | "Which billable items form this settlement?" | Create, Cancel. | Customer, billable items, totals. | Generic. | Use selection workflow. | P2 |
| `/settlements/[id]` | Detail/control | Settlement command page | Finance | "Can this settlement become invoice-ready?" | Submit Review, Recalculate Readiness, Reject, Mark Invoice Ready, Resolve Dispute, Archive. | Items, totals, readiness, invoice link, timeline, audit. | Needs consequence and boundary clarity. | Use financial control template. | P0 |
| `/settlements/[id]/edit` | Edit | Controlled settlement edit | Finance | "What settlement data changed?" | Save, Cancel. | Settlement fields. | Low priority. | Inline where safe. | P3 |
| `/invoices` | Queue/list | Invoice Workbench | Billing / Finance User | "Which invoices need review, which are ready to send, which are sent, and which are disputed or aging?" | Review Next Invoice, Open Approved Invoices, Open Disputes, Open Aging Invoices, Create Invoice. | Draft, Submitted for Review, Rejected, Approved, Sent, Disputed, Aging, Archived; customer, settlement, amount, sent status, due date, dispute, cash status, next action. | Phase 5 list redesign complete; detail/create still need stronger guided next-action treatment. | Add customer-term-based aging and detail lifecycle summary later. | P0 |
| `/invoices/new` | Create | Invoice create | Finance | "What approved settlement becomes an invoice?" | Create, Cancel. | Customer, settlement, terms, amount. | Generic. | Prefer create from invoice-ready settlement. | P2 |
| `/invoices/[id]` | Detail/control | Invoice command page | Finance, Collections | "What is invoice status and next collection/cash action?" | Submit Review, Reject, Mark Sent, Resolve Dispute, Archive. | Lines, balance, receipts, applications, collections, timeline, audit. | State/action hierarchy can improve. | Add invoice lifecycle summary. | P0 |
| `/invoices/[id]/edit` | Edit | Controlled invoice edit | Finance | "What invoice fields changed?" | Save, Cancel. | Invoice fields. | Editing after send should be constrained. | State-aware edit rules. | P2 |
| `/cash` | Queue/list | Cash Application Workbench | Billing / Finance User | "What cash needs application, what invoices can be updated, and what receipt/application records need review?" | Create Cash Receipt, Apply Receipt to Invoice, Review Unapplied Cash, Review Voided / Exceptions. | Unapplied, Partially Applied, Fully Applied, Application Review, Voided, Archived, Exceptions; receipt, customer, amount, applied/unapplied balance, reference, status, next action. | Phase 6 list redesign complete; detail/create still need stronger guided next-action treatment. | Add backend receipt balance and exception summaries later. | P0 |
| `/cash/receipts/new` | Create | Cash receipt create | Finance | "What cash was received internally?" | Create, Cancel. | Payer, amount, date, reference. | Still CRUD-heavy but boundary is explicit. | Convert to guided manual-receipt workflow later. | P1 |
| `/cash/receipts/[id]` | Detail/control | Cash receipt command page | Finance | "Can this receipt be applied or voided?" | Apply to Invoice, Void Receipt, Archive Receipt. | Receipt, applications, invoice balance impact, timeline, audit. | Action-state modals certified; detail needs stronger next-action card. | Add receipt lifecycle summary and read-only role context. | P0 |
| `/cash/receipts/[id]/edit` | Edit | Controlled receipt edit | Finance | "What receipt details changed?" | Save, Cancel. | Receipt fields. | State constraints unclear. | Disable after void/archive. | P2 |
| `/payment-applications` | Queue/list | Payment application visibility queue | Finance | "Which receipt-to-invoice applications need review or audit visibility?" | Open application. | Application Review, Voided, Archived; receipt, invoice, amount, status, applied date, next action. | Phase 6 visibility redesign complete; remains under Cash workspace. | Add richer application exception/readiness summaries later. | P1 |
| `/payment-applications/[id]` | Detail/control | Payment application detail | Finance | "Is this application valid or should it be voided?" | Void Payment Application, Archive Payment Application. | Receipt, invoice, amount, balance effect, timeline, audit. | Action-state modals certified; boundary copy exists. | Add stronger balance reversal summary later. | P0 |
| `/collections` | Queue/list | Collections Workbench | Collections Specialist | "Which collection cases need action today, who owns them, what was promised, and what is blocking payment?" | Create Collection Case, Assign Owner, Add Collection Action, Complete Due Action, Review Disputes, Review Aging. | Needs Action, Unassigned, Promise to Pay, Disputed, Aging, Completed, Archived; customer, invoice, amount due, owner, status, promise/dispute, next action due, next action. | Phase 6 list redesign complete; detail/create still need stronger guided next-action treatment. | Add backend due-action/promise/aging summaries later. | P0 |
| `/collections/new` | Create | Collection case create | Collections | "What account needs collection management?" | Create, Cancel. | Invoice/customer, reason, owner. | Still generic and CRUD-heavy. | Prefer create from overdue invoice and guided owner assignment later. | P2 |
| `/collections/[id]` | Detail | Collection case command page | Collections | "Who owns this case and what action is next?" | Assign Owner, Archive Case, Add Action, Complete Action. | Case, invoices, actions, owner, timeline, audit. | Action-state modals certified; detail needs next-action prominence. | Add next action card and case timeline summary. | P0 |
| `/collections/[id]/edit` | Edit | Controlled case edit | Collections | "What case facts changed?" | Save, Cancel. | Case fields. | Low priority. | Inline owner/status edits. | P3 |
| `/collection-actions` | Queue/list | Collection Actions visibility queue | Collections | "Which actions are due, completed, or retained for history?" | Open action. | Needs Action, Promise to Pay, Disputed, Completed, Archived; case, type, due date, owner, status, outcome, next action. | Phase 6 visibility redesign complete; remains under Collections workspace. | Add backend due-action summaries later. | P1 |
| `/collection-actions/[id]` | Detail | Collection action command page | Collections | "Should this action be completed or archived?" | Complete Action, Archive Action. | Action, case, outcome, timeline, audit. | Action-state modals certified; detail has case/invoice context. | Add stronger next-action and role context later. | P1 |

## F. Cost / Labor

| Route | Current type | Proposed type | Personas | Purpose and primary question | Actions | Required data and sections | UX problem | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/contractor-payables` | Queue/list | Contractor Payables Workbench | Payables / Payroll Admin | "Which contractor payables need review, which are approved, which are disputed, and which are payment-ready?" | Review Next Payable, Recalculate Totals, Open Disputes, Open Payment Ready, Create Contractor Payable. | Draft, Submitted for Review, Needs Recalculation, Approved, Payment Ready, Disputed, Blocked, Archived; contractor/vendor, source work, amount, review status, readiness, dispute, payment readiness, next action. | Phase 7 list redesign complete; detail/create still need stronger guided next-action treatment. | Add explicit backend payment-readiness and blocker summaries later. | P0 |
| `/contractor-payables/new` | Create | Payable create | Payables Admin | "What contractor payable should be tracked?" | Create, Cancel. | Contractor, work source, amount. | Generic. | Guide from approved production/work order. | P2 |
| `/contractor-payables/[id]` | Detail/control | Payable command page | Payables Admin | "Can this payable move to payment ready?" | Submit Review, Recalculate Totals, Approve, Mark Payment Ready, Resolve Dispute, Archive. | Items, totals, source, payment readiness, timeline, audit. | Needs boundary: no payment movement. | Financial control template. | P0 |
| `/contractor-payables/[id]/edit` | Edit | Controlled payable edit | Payables Admin | "What payable fields changed?" | Save, Cancel. | Payable fields. | State constraints unclear. | State-aware edit. | P2 |
| `/payroll` | Queue/list | Payroll Readiness Workbench | Payables / Payroll Admin | "Which payroll records need review, which are approved, and which are payroll-ready?" | Review Next Payroll, Recalculate Totals, Open Disputes, Open Payroll Ready, Create Payroll Run. | Draft, Submitted for Review, Needs Recalculation, Approved, Payroll Ready, Disputed, Blocked, Archived; crew/worker group, amount, review status, readiness, dispute, pay period, next action. | Phase 7 list redesign complete; detail/create still need stronger guided next-action treatment. | Add explicit payroll-readiness and blocker summaries later. | P0 |
| `/payroll/new` | Create | Payroll run create | Payroll Admin | "What payroll run should be prepared?" | Create, Cancel. | Period, workers, amount. | Generic. | Explain internal tracking only. | P2 |
| `/payroll/[id]` | Detail/control | Payroll command page | Payroll Admin | "Can this run be marked payroll ready?" | Submit Review, Recalculate Totals, Approve, Mark Payroll Ready, Resolve Dispute, Archive. | Items, totals, approvals, timeline, audit. | Needs no-provider boundary. | Financial control template. | P0 |
| `/payroll/[id]/edit` | Edit | Controlled payroll edit | Payroll Admin | "What payroll facts changed?" | Save, Cancel. | Run fields. | Low priority. | State-aware edit. | P2 |
| `/payments` | Queue/list | Payment Execution Workbench | Payables Admin, Accounting Manager | "Which payment batches need review, which are approved, which are scheduled, and which have been manually/externally executed?" | Review Next Payment Batch, Open Approved Batches, Open Scheduled Batches, Open Items Needing Attention, Create Payment Batch. | Draft, Submitted for Review, Approved, Scheduled, Submitted Execution, Executed, Voided, Items Need Attention, Archived; batch, source type, amount, review, schedule, execution, payment items, next action. | Phase 7 list redesign complete; detail/create still need stronger guided next-action treatment. | Add explicit payment item attention and schedule/execution summary endpoints later. | P0 |
| `/payments/new` | Create | Payment batch create | Payables Admin | "What internal payment batch should be prepared?" | Create, Cancel. | Payables/payroll items, amount, method. | Must not imply ACH/check/card. | Boundary copy on create. | P1 |
| `/payments/[id]` | Detail/control | Payment batch command page | Payables/Admin | "Can this internal batch advance safely?" | Submit Review, Approve, Schedule, Void, Submit Execution, Mark Executed, Archive. | Items, totals, status, dates, timeline, audit. | High-risk external-payment ambiguity. | Prominent no-money-movement boundary. | P0 |
| `/payments/[id]/edit` | Edit | Controlled payment batch edit | Payables Admin | "What batch details changed?" | Save, Cancel. | Batch fields. | State constraints unclear. | Disable in scheduled/submitted/executed. | P2 |
| `/payment-items/[id]` | Detail | Payment item detail | Payables Admin | "Should this payment item remain in the batch?" | Archive Item. | Item, source payable/payroll, batch link. | Phase 7 adds list-level visibility inside `/payments`, but the route remains an isolated detail page. | Keep as secondary detail under Payment Execution; add richer attention summaries later. | P1 |

## G. Verification / Accounting

| Route | Current type | Proposed type | Personas | Purpose and primary question | Actions | Required data and sections | UX problem | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/bank-reconciliation` | Workspace/list | Reconciliation workspace | Accounting Manager | "Which transactions need matching, exception, or review?" | Match Payment Batch, Match Cash Receipt, Open Exception, Ignore. | Accounts, transactions, proposed matches, exceptions. | Must avoid bank-feed implication. | Reconciliation workspace template. | P0 |
| `/bank-reconciliation/accounts/new` | Create | Bank account record create | Accounting Manager | "What internal bank account record is tracked?" | Create, Cancel. | Account name, type, status. | Could imply feed connection. | Boundary: no bank feed connection. | P1 |
| `/bank-reconciliation/accounts/[id]` | Detail | Bank account command page | Accounting Manager | "Is this account active for reconciliation?" | Archive Account. | Account, transactions, status, timeline, audit. | Needs account activity summary. | Add transaction health. | P1 |
| `/bank-reconciliation/accounts/[id]/edit` | Edit | Controlled bank account edit | Accounting Manager | "What account metadata changed?" | Save, Cancel. | Account fields. | Low priority. | State-aware edit. | P3 |
| `/bank-reconciliation/transactions/new` | Create | Manual bank transaction create | Accounting Manager | "What transaction record should be reconciled?" | Create, Cancel. | Account, amount, date, reference. | Could imply import/feed. | Label as manual/internal transaction. | P1 |
| `/bank-reconciliation/transactions/[id]` | Detail/control | Bank transaction command page | Accounting Manager | "How should this transaction be reconciled?" | Match Payment Batch, Match Cash Receipt, Open Exception, Resolve Exception, Ignore. | Transaction, candidates, matches, exception, timeline, audit. | High-risk duplicate action labels handled technically, but UX needs clarity. | Separate action area from candidate tabs. | P0 |
| `/bank-reconciliation/transactions/[id]/edit` | Edit | Controlled transaction edit | Accounting Manager | "What transaction metadata changed?" | Save, Cancel. | Transaction fields. | State constraints unclear. | Disable after matched/ignored/archive. | P2 |
| `/reconciliation-matches/[id]` | Detail/review | Reconciliation match review | Accounting Manager | "Should this proposed match be reviewed/accepted internally?" | Review Match. | Match entities, amounts, status, timeline, audit. | Needs side-by-side comparison. | Add transaction/source comparison panel. | P0 |
| `/accounting-exports` | Queue/list | Accounting export queue | Accounting Manager | "Which internal export batches need review, submission marking, or acceptance?" | Submit Review, Mark Submitted, Approve, Mark Accepted, Cancel. | Batch status, items, period, control totals. | Could imply QuickBooks/GL integration. | Explicit internal export lifecycle. | P0 |
| `/accounting-exports/new` | Create | Export batch create | Accounting Manager | "What internal export package should be prepared?" | Create, Cancel. | Period, source records, totals. | External integration ambiguity. | Boundary: no GL/API/file submission. | P1 |
| `/accounting-exports/[id]` | Detail/control | Export batch command page | Accounting Manager | "Can this export be submitted/accepted internally?" | Submit Review, Mark Submitted, Approve, Mark Accepted, Cancel. | Items, totals, validation, timeline, audit. | Needs financial control framing. | Accounting export workspace template. | P0 |
| `/accounting-exports/[id]/edit` | Edit | Controlled export edit | Accounting Manager | "What export metadata changed?" | Save, Cancel. | Export fields. | State constraints unclear. | Disable after submitted/accepted/cancelled. | P2 |
| `/accounting-export-items/[id]` | Detail | Export item detail | Accounting Manager | "Should this item remain in the export batch?" | Archive Item. | Source record, status, batch link, timeline. | Item route isolated. | Keep under export batch with side detail. | P1 |

## Phase 8 Inventory Status Notes

| Route | Phase 8 status | Operator status note | Remaining gap |
|---|---|---|---|
| `/bank-reconciliation` | Redesigned list/workbench | Bank Reconciliation Workbench now includes Unmatched Credits, Unmatched Debits, Review Matches, Open Exceptions, Resolved Exceptions, Ignored, Matched, and Archived queues with bank boundary copy and next-action guidance. | Backend queue summaries should eventually replace loaded-row heuristics. |
| `/bank-reconciliation/accounts/new` | Existing create route preserved | Manual internal bank account reference creation remains available. | Create flow still needs guided copy and read-only role context. |
| `/bank-reconciliation/accounts/[id]` | Existing detail route preserved | Bank account detail remains certified and reachable from workbench visibility. | Add detail next-action card and account risk summary later. |
| `/bank-reconciliation/accounts/[id]/edit` | Existing edit route preserved | Bank account edit remains functional. | Add stronger state-aware edit guidance later. |
| `/bank-reconciliation/transactions/new` | Existing create route preserved | Manual bank-side evidence creation remains available. | Create flow should better explain manual evidence and no bank connection. |
| `/bank-reconciliation/transactions/[id]` | Existing detail route preserved | Bank transaction detail remains certified and reachable from workbench queue rows. | Add detail next-action card and match/exception summary later. |
| `/bank-reconciliation/transactions/[id]/edit` | Existing edit route preserved | Transaction edit remains functional. | Add state-aware constraints and guided edit copy later. |
| `/reconciliation-matches/[id]` | Existing detail route preserved | Reconciliation match detail remains certified and reachable from workbench match visibility. | Add review consequence card and read-only banner later. |
| `/accounting-exports` | Redesigned list/workbench | Accounting Export Workbench now includes Draft, Submitted for Review, Approved, Marked Submitted, Accepted, Canceled, Items Need Attention, and Archived queues with accounting boundary copy and next-action guidance. | Backend item-attention summaries should eventually replace loaded-batch item heuristics. |
| `/accounting-exports/new` | Existing create route preserved | Export batch creation remains available. | Create flow should become a guided handoff setup later. |
| `/accounting-exports/[id]` | Existing detail route preserved | Export batch detail remains certified and reachable from workbench queue rows. | Add detail next-action card and stronger item-readiness summary later. |
| `/accounting-exports/[id]/edit` | Existing edit route preserved | Export batch edit remains functional. | Add state-aware constraints and guided edit copy later. |
| `/accounting-export-items/[id]` | Existing detail route preserved | Export item detail remains certified and reachable from item visibility. | No standalone list route exists; item visibility remains scoped to loaded export batches. |

## Admin / Configuration Pages That Should Exist

| Proposed route | Type | Persona | Purpose | Priority |
|---|---|---|---|---|
| `/admin` | Admin dashboard | System Admin | Tenant and system administration landing. | P1 |
| `/admin/users` | Admin queue/list | System Admin | Manage users and role assignments. | P1 |
| `/admin/roles` | Admin/config | System Admin | Manage role templates and permission bundles. | P1 |
| `/admin/audit-policy` | Admin/config | System Admin, Auditor | Configure audit visibility and retention policy. | P2 |
| `/admin/environment` | Admin/status | System Admin | Show environment mode, build, health, and integration availability. | P2 |
| `/login` | Auth | All | Production login entry point. | P0 |

## Highest-Priority Page Redesigns

1. `/intelligence/signals`
2. `/`
3. `/work-orders`
4. `/production`
5. `/qc`
6. `/billable`
7. `/invoices`
8. `/payments`
9. `/bank-reconciliation`
10. `/accounting-exports`
