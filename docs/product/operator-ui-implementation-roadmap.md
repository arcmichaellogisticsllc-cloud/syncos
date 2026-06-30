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

## Recommended Next Sprint

After Phase 1B, the next recommended sprint is Signal Detail and Growth action consistency: replace remaining Signal Detail browser-native prompts with the same modal pattern, add read-only page-level role context, and prepare shared queue/action primitives only after the Signal Feed and Signal Detail patterns agree.
