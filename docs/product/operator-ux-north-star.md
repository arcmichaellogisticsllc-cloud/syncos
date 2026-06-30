# SyncOS Operator UX North Star

## Mission

SyncOS should feel like an operating room for service, billing, cash, payables, reconciliation, and accounting handoff work. The UI must help an operator understand what matters now, what decision is required, what action is safe, and what will happen next.

The product is not a database browser. It is not a test harness. It is not a developer console. It is a state-aware command system for operators who need to move real work through controlled lifecycle gates without accidentally creating financial side effects.

## Required Principles

| Principle | Meaning | UI requirement |
|---|---|---|
| Operator-first, not database-first | Pages should be organized around jobs people do, not table names. | Use queues such as Needs Review, Ready to Bill, Payment Ready, Exception Open. Keep raw object names secondary. |
| Role-specific, not one-size-fits-all | A QC manager and a finance user should not see the same daily command surface. | Landing page, nav, queues, actions, and empty states must adapt by persona and permission. |
| Queue-driven, not filter-driven | Operators should start from prioritized work, not a blank table plus filters. | Every list page needs priority queues, default queue, next action, and collapsed advanced filters. |
| Action-oriented, not report-only | Dashboards must point to work, not only count it. | Metrics must link to queues and explain why zero, high, or blocked counts matter. |
| State-aware, not generic CRUD | Buttons must reflect lifecycle state and consequences. | Primary action changes by state; impossible actions are hidden or disabled with reasons. |
| Permission-aware, not confusing | Missing permission should not look like missing product capability. | Disabled actions need plain-language reason where visible; unauthorized actions must not invite failed clicks. |
| Safe-by-default for financial workflows | Financial lifecycle actions must never imply external money movement or integration unless it exists. | Payment, bank, payroll, accounting, tax, GL, ACH, wire, card, check, and provider language must be explicit about internal-only state changes. |
| Every page answers: what is this, what matters, what do I do next? | Operators should not infer page intent from route names. | Header, status summary, priority queue, primary CTA, and next-best-action copy are required. |

## What The UI Should Feel Like

- Calm: dense enough for daily work, but not cluttered with every table and every route.
- Directed: each page has a default queue and one obvious primary action.
- Trustworthy: destructive and financial actions explain their boundary before submit.
- Specific: states, buttons, and empty states use business language, not implementation language.
- Fast to scan: status chips, owner, age, amount, exception reason, and next action are visible in the queue.
- Recoverable: errors stay in context, preserve operator input, and explain whether retry is safe.
- Auditable: every mutation clearly maps to timeline and audit expectations.

## What Operators Should Never See

- JWT, raw auth token, seeded persona token, or permission text boxes.
- Test-session controls such as "Operator Session" in production operator flows.
- Internal fixture labels such as "E2E Action" or "Cedar Ridge demo" outside demo/test mode.
- Table-first labels as primary page purpose, such as "payment_applications" or "accounting_export_items".
- Raw UUIDs as primary identifiers when a human-readable number exists.
- Buttons that imply unavailable integrations: Send ACH, Sync QuickBooks, Submit Payroll, Import Bank Feed, Print Check, Run Tax Filing.
- Empty metric cards with zero and no explanation.
- Disabled buttons with no reason.
- Destructive actions styled like ordinary secondary actions.
- Route-health, certification, seed, or developer diagnostics in operator pages.

## Developer/Test UI Versus Production Operator UI

| Concern | Developer/test UI | Production operator UI |
|---|---|---|
| Authentication | Can expose token and permission controls for local testing. | Shows authenticated user, role, tenant, and login/logout or login-required state. |
| Data labels | May expose seeded demo names and object IDs. | Uses business identifiers, owner, status, due date, amount, and next action. |
| Navigation | Can expose every certified route for coverage. | Groups work by role and workflow. |
| Errors | Can expose technical detail for debugging. | Shows plain-language problem, correlation reference, and recommended retry/escalation. |
| Metrics | Can show raw counts. | Explains target, trend, threshold, and queue link. |
| Buttons | Can be exhaustive for testing. | Shows only relevant actions, ordered by consequence and role. |

## Page Decision Contract

Every operator page must provide:

1. Page identity: business name and one-sentence purpose.
2. Owner persona: who should primarily use this page.
3. Default queue: what the user sees first.
4. Status summary: what is healthy, late, blocked, risky, or ready.
5. Primary action: the one action most likely needed now.
6. Secondary actions: useful but less consequential actions.
7. Destructive action area: separated visually and semantically.
8. State explanation: why actions are available or unavailable.
9. Boundary copy: what the action will not do.
10. Audit expectation: what will be recorded.

## Button Semantics

| Style | Meaning | Examples |
|---|---|---|
| Primary | Advances work to the next expected lifecycle state. | Submit Review, Approve, Mark Sent, Match Payment Batch. |
| Secondary | Adds context or performs a reversible utility action. | Add Item, Recalculate Totals, Assign Owner. |
| Danger | Voids, archives, rejects, cancels, ignores, or marks failure. | Archive, Void Receipt, Reject, Cancel, Ignore. |
| Ghost | Navigates, opens details, or changes view without mutation. | Open Detail, View Timeline, Clear Filters. |
| Utility | Non-business controls such as refresh, export visible table, or copy link. | Refresh Queue, Copy ID. |

Button labels must be verbs with consequence. "Submit" alone is acceptable only when local page context makes the object and next state clear; otherwise use "Submit Review" or "Submit Execution".

## Destructive Action Rules

- Use danger styling.
- Open a modal; no one-click destructive mutation.
- State what object is affected.
- State what will not happen downstream.
- Require a reason/note when the lifecycle requires one.
- Keep the modal open on validation or backend error.
- Disable submit, cancel, and close while submitting.
- Block repeated submits.
- Record timeline and audit entries.

## Disabled Action Rules

Disabled actions should be visible only when their absence would confuse the operator. Each disabled action needs:

- Plain-language reason.
- Required state or missing prerequisite.
- Permission reason when allowed by security policy.
- Link or next action to resolve the blocker where possible.

Examples:

- "Requires approved production."
- "Add at least one billable item before submit."
- "Your role can view this invoice but cannot reject it."
- "Payment batch must be approved before scheduling."
- "External payment submission is not available in SyncOS."

## How Each User Knows What To Do Next

| Persona | Primary guidance |
|---|---|
| Executive | See health, bottlenecks, risk, and accountable owners. |
| Growth Operator | Review new signals, qualify evidence, assign owners, move ready items to candidates. |
| Operations Manager | Clear work order blockers, production submission gaps, and handoff exceptions. |
| Field Supervisor | Submit production records and correct rejected work. |
| QC Manager | Start reviews, approve, request correction, and clear review aging. |
| Billing / Finance User | Move billable items through settlement, invoice, cash, and collection states. |
| Collections Specialist | Work overdue accounts, assign owners, complete collection actions. |
| Payables / Payroll Admin | Prepare payables and payroll for review and payment readiness. |
| Accounting Manager | Match transactions, resolve exceptions, review export batches. |
| Read-only Auditor | Inspect state, timeline, audit, and permission boundaries without mutation. |
| System Admin | Configure users, roles, tenant setup, and emergency lifecycle support. |

## Release Standard

The UI is not operator-ready until:

- Developer/test session UI is hidden from production operator pages.
- Navigation is role and workflow based.
- Every certified lifecycle button has visible consequence, state, permission, modal, error, audit, and E2E mapping.
- Every queue page has a default operator queue and next-best-action path.
- Empty, loading, error, permission-denied, and mobile states are reviewed.
- Release E2E remains green and certification remains intact.
