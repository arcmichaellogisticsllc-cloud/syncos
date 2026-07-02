# Operator Page Wireframe Specs

## Page Type A: Command Center Dashboard

```text
Header
  SyncOS Command Center
  Persona selector/context: "Signed in as [Name], [Role]"
  Environment badge: production/staging/demo, never token text

Status Summary
  [Needs Review] [Blocked] [Overdue] [Financial Exceptions] [My Work]

Primary Action Area
  Continue My Queue
  Review Highest Risk
  View All Exceptions

Priority Queue
  Row: domain, object, status, owner, age, risk, next action

Detail Panels
  Operations health
  Revenue health
  Cash/reconciliation health
  Payables/accounting export health

Timeline
  Recent high-risk lifecycle transitions

Audit
  Recent audited financial actions and denied attempts for admin/auditor roles

Empty State
  "No priority work for your role. Use workspace navigation or adjust role."

Error State
  "Command Center could not load. Retry or contact admin with reference."

Role Behavior
  Modules and actions filtered by permission; read-only auditor sees no mutation CTAs.
```

## Page Type B: Queue/List Page

```text
Header
  [Workspace Name]
  Purpose sentence: "Review [domain] records and move them through [workflow]."

Status Summary
  Queue cards with counts and meaning, not raw zeros only

Primary Action Area
  Primary create/review action
  Review Next
  Refresh

Priority Queue
  Default tab selected by role
  Tabs: Needs Review, Ready, Blocked, Exceptions, Archived

List/Table
  Business identifier
  Customer/source
  Status
  Owner
  Amount/quantity/date where relevant
  Age/SLA
  Next action
  Row actions limited to Open Detail and safe quick actions

Filters
  Collapsed drawer by default
  Advanced filters below queue tabs

Empty State
  Explain no records in selected queue and offer safe next action

Loading State
  Skeleton rows with queue header still visible

Error State
  Retry, preserve filters, show plain-language failure

Role Behavior
  Hide unauthorized create/actions; read-only users can still open details.
```

## Page Type C: Detail Page

```text
Header
  Object business identifier
  Status chip
  Owner
  Last updated
  Breadcrumb to queue

Status Summary
  Current state
  Readiness checklist
  Blocking reasons
  Downstream boundary warning for financial domains

Primary Action Area
  One primary next action
  Secondary actions
  Danger zone separated

Detail Panels
  Summary
  Required data
  Related records
  Financial/control totals where relevant

Tabs
  Summary
  Items/Evidence/Matches as domain requires
  Timeline
  Audit

Timeline
  Lifecycle transitions and notes

Audit
  Actor, permission, before/after, request reference where available

Empty State
  Per related section: "No evidence yet", "No matches proposed", etc.

Error State
  Keep object header if loaded, show failing panel retry

Role Behavior
  Read-only sees same context with action area replaced by "Read-only access".
```

## Page Type D: Review/Approval Page

```text
Header
  Review queue/detail title
  Current review state and age

Status Summary
  What is being approved
  Required evidence
  Exceptions/blockers

Primary Action Area
  Approve
  Reject or Request Correction
  Start Review where applicable

Priority Queue
  Pending Review
  In Review
  Correction Requested
  Aging

Detail Panels
  Submitted facts
  Evidence
  Comparison to expected
  Notes

Tabs
  Review Summary
  Evidence
  Source Record
  Timeline
  Audit

Empty State
  "No records require review."

Error State
  Preserve review notes on failure.

Role Behavior
  Only reviewers see approve/reject; submitters see correction guidance.
```

## Page Type E: Financial Control Page

```text
Header
  Financial object name
  Internal-only boundary badge
  Status and amount

Status Summary
  Control total
  Balance/readiness
  Downstream boundary
  Audit state

Primary Action Area
  State-specific primary action
  Secondary recalculate/add item
  Danger actions separated

Priority Queue
  Ready
  Under Review
  Disputed
  Void/Archive

Detail Panels
  Source records
  Items/lines
  Amounts
  Exceptions

Tabs
  Summary
  Items
  Related Cash/Payment/Export
  Timeline
  Audit

Empty State
  "No items have been added. Add items before submitting review."

Error State
  Explain validation blocker and preserve modal state.

Role Behavior
  Finance can mutate within permission; auditor sees control data only.
```

## Page Type F: Reconciliation Workspace

```text
Header
  Reconciliation
  "Match internal bank transaction records to internal cash/payment records."

Status Summary
  Unmatched debits
  Unmatched credits
  Open exceptions
  Proposed matches

Primary Action Area
  Review Next Exception
  Match Selected
  Open Exception

Priority Queue
  Unmatched Debits
  Unmatched Credits
  Open Exceptions
  Proposed Matches
  Ignored/Archived

Detail Panels
  Left: transaction
  Right: candidate source record
  Bottom: match history

Tabs
  Transaction
  Candidate Matches
  Exceptions
  Timeline
  Audit

Empty State
  "No unmatched transactions in this queue."

Error State
  "Could not load candidate matches. Transaction context remains visible."

Role Behavior
  Accounting Manager mutates; auditor reads; finance may read related cash/payment only.
```

## Page Type G: Accounting Export Workspace

```text
Header
  Accounting Export
  "Track internal accounting export review. No external GL connection is performed."

Status Summary
  Draft batches
  Under review
  Submitted internally
  Accepted internally
  Exceptions

Primary Action Area
  Submit Review
  Approve
  Mark Submitted
  Mark Accepted
  Cancel in danger area

Priority Queue
  Draft
  Under Review
  Generated
  Submitted
  Cancelled/Archived

Detail Panels
  Control totals
  Items
  Source record coverage
  Validation findings

Tabs
  Summary
  Items
  Validation
  Timeline
  Audit

Empty State
  "No export items yet. Add source records before submitting review."

Error State
  Preserve validation results and modal inputs.

Role Behavior
  Accounting Manager controls lifecycle; no QuickBooks/GL/API buttons until integrations exist.
```

## Page Type H: Admin/Config Page

```text
Header
  Admin
  Tenant, environment, user identity

Status Summary
  Users
  Roles
  Permissions
  Environment health

Primary Action Area
  Invite User
  Create Role Template
  Review Audit Policy

Priority Queue
  Users without role
  High-risk permission grants
  Failed auth/config checks

Detail Panels
  User list
  Role permissions
  Environment mode
  Audit settings

Tabs
  Users
  Roles
  Permissions
  Audit Policy
  Environment

Empty State
  "No admin tasks require attention."

Error State
  Show admin-safe error with retry.

Role Behavior
  Only System Admin sees Admin nav; auditors may see audit policy read-only if granted.
```

## Phase 2 Template Status

Implemented as shared UI primitives:

- `QueuePageTemplate`
- `PriorityCard`
- `QueueTabs`
- `FilterDrawer`
- `RecordsPanel`
- `EmptyState`
- `LoadingState`
- `ErrorState`
- `DetailPageTemplate`
- `RecordHeader`
- `KeyFactsPanel`
- `StateExplanation`
- `RelatedRecordsPanel`
- `TimelinePanel`
- `AuditPanel`
- `FinancialControlTemplate`
- `ReviewQueueTemplate`
- `ActionButton`
- `ActionBar`
- `DisabledReason`
- `BoundaryNotice`
- `StatusBadge`
- `SuccessBanner`
- `ErrorBanner`
- `ModalActions`

Applied in Phase 2:

- Signal Feed now uses shared priority cards, queue tabs, filter drawer, records panel, loading/empty/error states, action buttons, boundary notices, and modal actions.
- The global shell uses the shared workspace navigation model.

Documented but not yet rolled out:

- Detail pages remain on existing domain-specific layouts until each domain redesign sprint.
- Financial control and review queue templates exist for future adoption, but the finance/reconciliation/accounting pages have not been visually redesigned.
- Command Center still needs its own role-specific dashboard redesign.

## Phase 5 Finance Workbench Status

Implemented finance-control queue wireframes on:

- `/billable`
- `/settlements`
- `/invoices`

Applied template behaviors:

- Header and purpose copy framed around finance decisions.
- Financial boundary notice above the queue body.
- Priority queue cards ahead of filters.
- Queue tabs with active ARIA state.
- Collapsed advanced filters.
- Operator-first records table with next-action column.
- Queue-specific empty states.

Remaining finance template gaps:

- Detail pages need stronger next-action cards and read-only role banners.
- Create/edit flows remain generic forms and should become guided finance workflows later.
- Mobile/tablet layout still requires visual review.

## Phase 6 Cash And Collections Workbench Status

Implemented cash/collections queue wireframes on:

- `/cash`
- `/payment-applications`
- `/collections`
- `/collection-actions`

Applied template behaviors:

- Header and purpose copy framed around received cash, invoice application, manual follow-up, and collection action decisions.
- Boundary notices above the queue body for cash application, payment applications, collections, and collection actions.
- Priority queue cards ahead of filters.
- Queue tabs with active ARIA state.
- Collapsed advanced filters.
- Operator-first records tables with next-action columns.
- Queue-specific empty states.
- Visibility panels for payment applications and collection actions under the main workbench pages.

Remaining cash/collections template gaps:

- Detail pages need stronger next-action cards and read-only role banners.
- Create/edit flows remain generic forms and should become guided cash/collections workflows later.
- Queue counts should eventually use backend receipt-balance, promise, due-action, and exception summaries.
- Mobile/tablet layout still requires visual review.

## Phase 7 Payout Workbench Status

Implemented payout-readiness queue wireframes on:

- `/contractor-payables`
- `/payroll`
- `/payments`

Applied template behaviors:

- Header and purpose copy framed around contractor payable readiness, payroll readiness, and internal payment execution decisions.
- Boundary notices above the queue body for payout, payroll, and payment execution non-consequences.
- Priority queue cards ahead of filters.
- Queue tabs with active ARIA state.
- Collapsed advanced filters.
- Operator-first records tables with next-action columns.
- Queue-specific empty states.
- Payment item visibility panel under the Payment Execution Workbench.

Remaining payout template gaps:

- Detail pages need stronger next-action cards and read-only role banners.
- Create/edit flows remain generic forms and should become guided payout workflows later.
- Queue counts should eventually use backend payment-readiness, payroll-readiness, payment-item-attention, schedule, and execution summaries.
- Mobile/tablet layout still requires visual review.
