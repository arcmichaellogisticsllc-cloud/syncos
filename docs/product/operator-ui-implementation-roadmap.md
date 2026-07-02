# Operator UI Implementation Roadmap

## Phase 1: Remove Developer/Test UI From Operator Experience

Goal: production operator pages must never expose local token/session controls.

Scope:

- Hide Operator Session box outside dev/test.
- Replace token text warning with login-required card.
- Show authenticated user, role, tenant, and environment badge.
- Clarify unauthenticated state.
- Add tests that production-mode Signal Feed does not render token/session inputs.

Exit criteria:

- No token or permission text area appears in operator pages outside dev/test.
- Signal Feed unauthenticated state is product copy, not developer instructions.
- Existing E2E certification still passes.

Status:

- Phase 1A completed in `7c4678e` for the operator shell and default Signal Feed page.
- Phase 1B hardens Signal Feed list actions with operator modals and removes browser prompt/alert from the queue page.

## Phase 1B: Signal Feed Action Modal Hardening

Goal: make Signal Feed the first operator-grade queue-page pilot for modal behavior, disabled reasons, and queue tabs.

Scope:

- Replace Signal Feed list-action `window.prompt` and `window.alert` usage with SyncOS modals.
- Add modals for Categorize Signal, Score Signal, Verify Signal, and Archive Signal.
- Ensure Archive is styled as destructive and requires a reason.
- Ensure modal errors remain open with `role="alert"`.
- Ensure disabled row actions explain permission or readiness blockers.
- Ensure queue tabs expose active visual and ARIA state.
- Keep filters collapsed by default.
- Keep developer session controls hidden in default operator mode.

Exit criteria:

- Signal Feed list actions use modals, not browser-native dialogs.
- Create Signal modal follows the same close/cancel/error standards.
- Optional evidence creation failure is visible to the operator.
- E2E covers production-safe unauthenticated copy, hidden dev controls, queue tabs, modal opening/submission, disabled reasons, and read-only behavior.
- Release E2E and certification enforcer remain green.

Pilot readiness:

- Signal Feed is ready as the first page-template pilot after Phase 1B.
- Signal Feed is not yet fully operator-ready until detail-page actions, bulk owner assignment, ready-signal conversion, mobile review, and selected-row context are completed.

## Phase 2: Navigation Redesign

Goal: replace flat route nav with role/workspace navigation.

Scope:

- Implement full desktop workspace nav:
  - Command Center
  - Growth
  - Opportunities
  - Operations
  - Production
  - Quality
  - Billing
  - Cash
  - Payables
  - Reconciliation
  - Accounting Export
  - Admin
- Implement compact nav for mobile:
  - Command Center
  - Growth
  - Operations
  - Finance
  - Admin
- Filter nav by read permission.
- Keep route matrix E2E coverage intact.

Exit criteria:

- Users see only relevant workspaces.
- Route matrix still reaches all certified routes.
- Read-only auditor can navigate readable workspaces without mutation controls.

## Phase 3: Page Templates

Goal: establish reusable operator page structure before domain redesign.

Templates:

- Queue/list page template.
- Detail page template.
- Financial control page template.
- Review queue/template.
- Reconciliation workspace template.
- Accounting export workspace template.
- Admin/config template.

Shared components:

- `CommandHeader`.
- `RoleContext`.
- `PriorityQueueTabs`.
- `StatusSummary`.
- `ActionArea`.
- `ActionButton` with disabled reason.
- `BoundaryNotice`.
- `TimelinePanel`.
- `AuditPanel`.
- `EmptyState`.
- `ErrorState`.

Exit criteria:

- New templates preserve current route behavior.
- Action-state E2E selector helpers still target real action areas.
- Modal standards remain intact.

## Phase 4: Domain Page Redesign

Recommended order:

1. Growth / Signal Feed.
2. Command Center role landing.
3. Work Order Queue and Production Queue.
4. QC Review Queue.
5. Billing Workbench.
6. Cash / Collections.
7. Payables / Payroll.
8. Payment Execution internal tracking.
9. Reconciliation workspace.
10. Accounting Export workspace.

Domain specifics:

- Growth / Signal Feed: remove dev UI, add priority cards and queue tabs.
- Opportunity Pipeline: add stage aging, coverage readiness, handoff status.
- Operations Board: connect projects, work orders, production blockers.
- Production Board: highlight drafts, submitted, correction requested.
- QC Review Queue: evidence-first approval workflow.
- Billing Workbench: billable to settlement to invoice progression.
- Cash / Collections: unapplied cash, overdue invoices, collection action due.
- Payables / Payroll: readiness, approval, internal payment preparation.
- Reconciliation: side-by-side matching and exception handling.
- Accounting Export: control totals and internal export lifecycle.

Exit criteria:

- Each redesigned domain answers what this is, what matters, and what to do next.
- No forbidden integrations are introduced.
- E2E certification remains green.

## Phase 5: UAT And Refinement

Goal: validate operator comprehension and safety.

Activities:

- Role-based testing with each persona.
- Mobile/tablet screenshot review.
- Keyboard accessibility review.
- Financial action copy review.
- Read-only auditor review.
- Error and empty state review.
- Operator feedback sessions.

Exit criteria:

- Operators can complete daily workflows without developer guidance.
- High-risk financial boundaries are understood.
- Disabled action reasons are clear.
- Accessibility issues are triaged.
- Release gate and certification enforcer pass.

## Phase 2 Status

Status: partial implementation complete, pending validation.

Completed in Phase 2:

- Shared role-aware operator navigation foundation.
- Compact workspace navigation with active workspace subnavigation.
- Planned Admin treatment without inventing unsupported admin routes.
- Shared queue/list page primitives.
- Shared detail page primitives.
- Shared financial control page primitive.
- Shared review queue primitive.
- Shared action, disabled reason, boundary notice, status, success, error, and modal action components.
- Signal Feed alignment to shared queue/action primitives without changing backend behavior.
- E2E coverage for shell navigation, hidden developer controls, Signal Feed queue pattern, disabled reason behavior, read-only auditor behavior, and active queue tabs.

Remaining Phase 2 gaps:

- Role landing pages still need actual persona-specific dashboard content.
- Permission filtering should eventually be generated from the server-side permission/route matrix.
- Financial control and review templates are created but not rolled out to every domain page.
- Mobile screenshots and accessibility review remain a separate UAT task.
- Domain pages still require workflow-first redesign sprints.

## Recommended Next Sprint

If Phase 2 validation is green and the release E2E gate remains green, the next recommended sprint is Operator UI Phase 3: Command Center and Operations Board Redesign. That sprint should turn the shared shell/templates into role-specific daily work surfaces before rolling the pattern into finance-heavy pages.

## Phase 3 Status

Status: implemented for Command Center and Operations Board, pending validation.

Completed in Phase 3:

- Root `/` is now a real Command Center daily priorities page instead of a redirect-only route.
- `/executive` is redesigned as an executive Command Center module focused on blockers, cash exposure, workflow risk, and throughput decisions.
- `/operations` is redesigned as an Operations Board with planning, execution, and approval lanes.
- Command surfaces use existing dashboard data only; no backend routes, migrations, integrations, or business logic changed.
- New dashboard primitives were added for command hero sections, insight strips, priority decision cards, work queues, board columns, and operator links.
- E2E coverage was added for Command Center, Executive Command Center, Operations Board, queue links, and default hidden dev-session UI.

Remaining gaps:

- Role-specific landing content still needs deeper persona tailoring beyond the initial executive/operations views.
- Operations Board still relies on aggregate dashboard data; future sprints should add backend-backed daily queue counts before showing SLA/age badges.
- Work Orders, Production, and QC pages still need their own full queue redesigns.
- Mobile/tablet screenshot review remains open.
- Finance-heavy boundary templates are still not rolled out domain-wide.

Recommended next sprint after green validation:

Operator UI Phase 4: Work Order, Production, and QC Queue Redesign.

## Phase 4 Status

Status: implemented for Work Orders, Production Board, and QC Review Queue, pending final validation.

Completed in Phase 4:

- `/work-orders` is redesigned as an Operations Manager queue with Ready to Start, Active, Blocked, Production Missing, Ready for QC, Completed, and Archived queues.
- `/production` is redesigned as a Field Supervisor Production Board with Draft, Submitted, Under Review, Correction Required, Corrected, Approved, Billable Ready, and Archived queues.
- `/qc` is redesigned as a QC Manager review queue with Pending Review, In Review, Correction Required, Corrected, Approved, Aging, and Archived queues.
- Advanced filters are collapsed by default on the three execution queue pages.
- Each queue page now includes operator purpose copy, boundary copy, priority cards, queue tabs with ARIA state, operator-first table columns, next-action guidance, and queue-specific empty states.
- Existing detail-page lifecycle modals and action-state labels are preserved.
- No backend routes, migrations, external integrations, financial mutations, or unsupported lifecycle transitions were added.
- E2E coverage was added for Work Orders, Production Board, QC Review Queue, hidden developer UI, read-only auditor behavior, and queue tab state changes.

Remaining Phase 4 gaps:

- Work Order Production Missing should eventually use a backend work-order-to-production coverage summary.
- Queue aging should eventually use explicit SLA/age fields rather than client-side updated timestamp calculations.
- Work Order, Production, and QC detail pages still need stronger next-action cards and read-only role context.
- Create/edit pages remain CRUD-heavy and should become guided workflows later.
- Mobile/tablet review remains open.

Recommended next sprint after green validation:

Operator UI Phase 5: Billing, Settlement, and Invoice Workbench Redesign.

## Phase 5 Status

Status: implemented for Billable Workbench, Settlement Workbench, and Invoice Workbench, pending final validation.

Completed in Phase 5:

- `/billable` is redesigned as a Billing / Finance User workbench with Ready for Review, On Hold, Disputed, Ready for Settlement, Missing Support, and Archived queues.
- `/settlements` is redesigned as a Settlement Workbench with Draft, Submitted for Review, Needs Recalculation, Rejected, Approved, Invoice Ready, Disputed, and Archived queues.
- `/invoices` is redesigned as an Invoice Workbench with Draft, Submitted for Review, Rejected, Approved, Sent, Disputed, Aging, and Archived queues.
- Advanced filters are collapsed by default on the three finance workbench pages.
- Each workbench now includes operator purpose copy, financial boundary copy, priority cards, queue tabs with ARIA state, operator-first table columns, next-action guidance, and queue-specific empty states.
- Existing detail-page lifecycle modals and action-state labels are preserved.
- No backend routes, migrations, external integrations, accounting posting, cash movement, or unsupported lifecycle transitions were added.
- E2E coverage was added for Billable, Settlement, and Invoice workbenches, hidden developer UI, financial boundary copy, read-only auditor behavior, and queue tab state changes.

Remaining Phase 5 gaps:

- Billable Missing Support should eventually use backend readiness reason summaries instead of source/readiness heuristics.
- Settlement Needs Recalculation should eventually use an explicit backend flag.
- Invoice Aging should eventually use customer terms and explicit due-date policy.
- Finance detail pages still need stronger next-action cards and read-only role context.
- Create/edit pages remain CRUD-heavy and should become guided finance workflows later.
- Mobile/tablet review remains open.

Recommended next sprint after green validation:

Operator UI Phase 6: Cash Application and Collections Workbench Redesign.

## Phase 6 Status

Status: implemented for Cash Application Workbench, Payment Applications, Collections Workbench, and Collection Actions, pending final validation.

Completed in Phase 6:

- `/cash` is redesigned as a Cash Application Workbench with Unapplied, Partially Applied, Fully Applied, Application Review, Voided, Archived, and Exceptions queues.
- `/payment-applications` now has application review, voided, and archived queue visibility under the Cash Application workspace.
- `/collections` is redesigned as a Collections Workbench with Needs Action, Unassigned, Promise to Pay, Disputed, Aging, Completed, and Archived queues.
- `/collection-actions` now has due-action, promise, dispute, completed, and archived queue visibility.
- Advanced filters are collapsed by default on cash and collections workbench pages.
- Each workbench now includes operator purpose copy, boundary copy, priority cards, queue tabs with ARIA state, operator-first table columns, next-action guidance, and queue-specific empty states.
- Existing detail-page lifecycle modals and action-state labels are preserved.
- No backend routes, migrations, external integrations, bank feeds, payment processing, automated communications, legal workflows, accounting posting, or unsupported lifecycle transitions were added.
- E2E coverage was added for Cash, Payment Applications, Collections, Collection Actions, hidden developer UI, boundary copy, read-only auditor behavior, and queue tab state changes.

Remaining Phase 6 gaps:

- Cash unapplied/partial queues should eventually use backend receipt balance summaries.
- Cash exceptions should eventually use explicit backend exception reason fields.
- Collections Needs Action should eventually use backend action due summaries.
- Promise-to-pay queues should eventually use richer promise metadata and outcome history.
- Aging should eventually use customer terms and due-date policy.
- Cash and collections detail/create/edit pages still need stronger guided workflows and read-only role context.
- Mobile/tablet review remains open.

Recommended next sprint after green validation:

Operator UI Phase 7: Contractor Payables, Payroll, and Payment Execution Workbench Redesign.
