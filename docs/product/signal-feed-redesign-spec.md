# Signal Feed Redesign Spec

## Source Screenshot Problem

The current Signal Feed screenshot shows Safari pointed at the local app and, in prior local UI, the page itself includes developer/test-session concepts. The product problem is broader than the browser connection state: when loaded, Signal Feed currently behaves like a testable database list rather than an operator work queue.

## Current Problems

- Developer Operator Session is hidden in normal operator mode as of Phase 1A.
- Sign-in token warning was replaced with production-safe login-required copy in Phase 1B.
- Zero metrics have no explanation.
- Filters dominate the page.
- Priority queue cards and queue tabs exist as the first page-template pilot.
- Recommended actions are prominent for Create Signal and Review Next Signal.
- Operator workflow is present but still needs selected-row context and bulk actions.
- Create button has context and modal boundary copy.
- The page does not explain what makes a signal actionable.
- Advanced filters are always competing with the work list.
- Row actions previously used browser prompt/alert; Phase 1B replaces the feed actions with operator modals.

## Page Purpose

Signal Feed is the Growth Operator's daily queue for reviewing market intelligence and moving qualified signals toward opportunity candidates.

Header copy:

```text
Signal Feed
Review new market intelligence and move qualified signals toward opportunity candidates.
```

## Primary Persona

Growth Operator.

Secondary personas:

- Executive: read-only health and conversion review.
- Operations Manager: read-only visibility into likely future work.
- Read-only Auditor: read-only inspection of signal lifecycle and evidence.
- System Admin: all access for support.

## Operator Question

"Which signals deserve attention today, what is missing, and what action should I take next?"

## Proposed Layout

```text
Header
  Signal Feed
  Review new market intelligence and move qualified signals toward opportunity candidates.
  Role context: Growth Operator
  Primary buttons: Create Signal, Review Next Signal

Today's Priorities
  Needs review
  High-confidence unassigned
  Missing organization
  Ready for candidate

Queue Tabs
  Needs Review
  Verified
  Ready for Candidate
  Missing Evidence
  Archived

Signal List
  title | source | territory | organization | confidence | owner | evidence count | status | next action

Filter Drawer
  collapsed by default
  search, status, category, type, source, confidence, trust, evidence, organization, candidate, archived

Right/Bottom Context Panel
  selected signal summary on wide screens or row detail drawer on compact screens
```

## Priority Cards

| Card | Definition | Click behavior | Empty/zero copy |
|---|---|---|---|
| Needs review | Signals in discovered/categorized/scored states. | Opens Needs Review queue. | "No new signals need review." |
| High-confidence unassigned | Confidence >= 80 and no owner. | Opens filtered queue. | "No high-confidence signals are unassigned." |
| Missing organization | Signal lacks primary organization. | Opens Missing Organization queue. | "All visible signals have organizations." |
| Ready for candidate | Verified, has evidence, org, sufficient confidence, not converted. | Opens Ready for Candidate queue. | "No signals are candidate-ready yet." |

## Primary Actions

| Button | Behavior | Appears when | Disabled when | Modal |
|---|---|---|---|---|
| Create Signal | Opens create signal modal/page. | User has `signal.create`. | Missing create permission. | Yes; title "Create Signal". |
| Review Next Signal | Opens highest-priority signal detail. | Needs Review has records. | No reviewable signals. | No. |
| Assign Owners | Bulk owner assignment. | One or more unassigned signals selected. | No selection or missing permission. | Yes; owner and note. |
| Convert Ready Signals | Creates candidate workflow from selected ready signals in future implementation. | Ready signals selected and permission granted. | Missing readiness criteria or permission. | Yes; confirmation and candidate fields. |

No conversion button should create candidates implicitly from page load or filtering.

## Queue Tabs

| Tab | Criteria | Primary next action |
|---|---|---|
| Needs Review | discovered, categorized, scored. | Categorize, Score, Verify after evidence. |
| Verified | verified but not converted. | Assign owner or prepare candidate. |
| Ready for Candidate | verified, evidence present, organization present, confidence threshold met, not converted. | Convert Ready Signals future. |
| Missing Evidence | no active evidence. | Open detail and add evidence future. |
| Archived | archived status or archived_at. | Open detail read-only/archive context. |

## Signal List Design

Columns:

- Title: business title, link to detail.
- Source: source name or source URL/note.
- Territory: primary territory.
- Organization: linked organization or "Missing".
- Confidence: numeric score with visual band.
- Owner: assigned owner or "Unassigned".
- Evidence Count: active evidence count.
- Status: state chip.
- Next Action: generated from readiness rules.

Row actions:

- Open Detail.
- Categorize.
- Score.
- Verify.
- Archive.

Row action rules:

- Quick actions should not crowd the row on mobile.
- Destructive Archive should be in row overflow or detail danger area.
- Verify disabled when evidence count is zero with explanation "Add evidence before verifying."

## Filters

Filters should be a collapsed drawer by default.

Default visible controls:

- Queue tab.
- Search.
- Refresh.

Advanced drawer controls:

- Status.
- Category.
- Type.
- Source.
- Source type.
- Confidence min/max.
- Trust level.
- Evidence present.
- Organization present.
- Candidate converted.
- Archived.

Clear Filters should be ghost/utility and should not reset the selected role or permission state.

## Empty States

Global empty:

```text
No signals yet. Create a signal or connect a future intelligence source.
```

Queue empty examples:

- Needs Review: "No signals need review. New market intelligence will appear here."
- Ready for Candidate: "No signals are ready for candidate conversion. Verify evidence and organization first."
- Missing Evidence: "All visible signals have evidence."
- Archived: "No archived signals."

Create Signal CTA appears only if the user has create permission.

## Unauthenticated State

Do not show token text boxes.

Show:

```text
Login required
Sign in to review market intelligence and manage signal queues.
```

Buttons:

- Sign In, when a real login route exists.
- Retry Session, if auth refresh exists.

For local dev/test, token controls may exist behind an explicit dev-only environment gate and never in production operator mode.

## Permission Behavior

| Permission state | UI behavior |
|---|---|
| Can read only | Show queues and details; hide create and mutation row actions; show read-only context. |
| Can create | Show Create Signal. |
| Can categorize/score/verify | Show relevant row/detail actions when state allows. |
| Cannot archive | Hide Archive unless policy prefers disabled with reason. |
| Read-only auditor | No mutation buttons, backend still denies direct writes. |

## Modals

### Create Signal

- Purpose: create a manually entered intelligence signal.
- Required fields: title, category/type, source/source note, date discovered where applicable.
- Optional fields: organization, territory, owner, confidence, evidence seed.
- Submit label: Create Signal.
- Success: closes modal and navigates to signal detail.
- Error: remains open with alert role.
- Optional evidence failure: operator is told the signal was created but evidence could not be attached; no silent failure is allowed.
- Boundary: does not create candidate, opportunity, project, work order, invoice, or financial record.

### Categorize Signal

- Purpose: classify a signal for routing and review.
- Required fields: signal category, signal type.
- Submit label: Categorize Signal.
- Success: closes modal and refreshes the queue.
- Error: remains open with alert role.
- Boundary: updates the signal only; does not create candidates, opportunities, projects, invoices, payments, or accounting records.

### Score Signal

- Purpose: set confidence so operators can prioritize review.
- Required fields: confidence score 0-100.
- Submit label: Score Signal.
- Success: closes modal and refreshes the queue.
- Error: remains open with alert role.
- Boundary: updates the signal only; does not create downstream records.

### Verify Signal

- Purpose: confirm the signal has enough evidence to trust.
- Required fields: trust level.
- Disabled condition: evidence count is zero, with reason "Add evidence before verifying."
- Submit label: Verify Signal.
- Success: closes modal and refreshes the queue.
- Error: remains open with alert role.
- Boundary: verification does not create candidates, opportunities, projects, invoices, payments, or accounting records.

### Archive Signal

- Purpose: remove an irrelevant or closed signal from the active queue.
- Required fields: archive reason.
- Optional fields: archive note.
- Submit label: Archive Signal.
- Success: closes danger modal and refreshes the queue.
- Error: remains open with alert role.
- Boundary: archive is destructive for the active queue but does not mutate downstream records.

### Assign Owners

- Purpose: assign selected signals to a responsible user.
- Required fields: owner, assignment note.
- Submit label: Assign Owners.
- Success: refreshes queue and shows updated owner.
- Error: remains open with alert role.
- Boundary: does not verify, convert, or archive signals.

### Convert Ready Signals

- Purpose: future explicit conversion from ready signal to opportunity candidate.
- Required fields: selected signals, candidate name/scope, owner.
- Submit label: Convert to Candidate.
- Success: creates candidate and links source signals.
- Error: remains open with alert role.
- Boundary: does not create opportunity, project, work order, or revenue record.

## E2E Implications

Existing coverage:

- Route matrix covers `/intelligence/signals`.
- Signal Feed route health is covered by release gate.

New coverage needed:

- Production-mode Signal Feed does not show Operator Session/token UI. Added in Phase 1B.
- Unauthenticated state shows login-required card with production-safe copy. Added in Phase 1B.
- Default queue is Needs Review. Added in Phase 1B.
- Filter drawer is collapsed by default. Added in Phase 1B.
- Priority cards and queue tabs render and select predictably. Added in Phase 1B.
- Verify disabled reason appears when evidence is missing. Added in Phase 1B.
- Read-only auditor can view but cannot mutate. Added in Phase 1B.
- Create Signal modal follows modal standards. Added in Phase 1B.
- Categorize, Score, and Archive modals submit and refresh. Added in Phase 1B.
- Archive requires danger styling and modal confirmation. Added in Phase 1B.

## Phase 1B Status

Complete:

- Production-safe unauthenticated copy.
- No developer session UI in default Signal Feed.
- No browser prompt or alert for Signal Feed list actions.
- Categorize, Score, Verify, and Archive action modals.
- Active queue tab visual and ARIA state.
- Visible disabled reasons for missing permissions and missing evidence.
- Focused E2E coverage for Signal Feed operator hardening.

Remaining gaps before declaring Signal Feed fully operator-ready:

- Detail page still needs the same modal hardening pattern.
- Assign Owners and Convert Ready Signals remain future actions.
- Queue counts are based on the loaded result set, not a separate all-queue summary endpoint.
- Mobile/tablet layout has not had screenshot review.
- Selected-row context panel and bulk action ergonomics are still future work.

Pilot readiness:

Signal Feed is now ready as the first queue-page template pilot for modal behavior, disabled reasons, collapsed filters, and priority tabs. It is not yet a complete reusable component system.

## Phase 2 Alignment

Implemented:

- Signal Feed now uses shared queue/action primitives for priority cards, queue tabs, filter drawer, records panel, loading and empty states, error banners, action buttons, boundary notices, and modal actions.
- The page continues to avoid developer session UI in production/default mode.
- The page keeps production-safe unauthenticated copy.
- The Create, Categorize, Score, Verify, and Archive modal behavior remains intact.
- Verify remains disabled when evidence is missing and explains why.
- Read-only users can view the queue without mutation capability.

Remaining:

- Signal detail still needs the same shared action/modal pattern.
- Assign Owners and Convert Ready Signals remain future actions.
- Queue-level counts still reflect loaded results rather than a dedicated summary endpoint.
- Bulk actions and selected-record context panel are still future work.
- Mobile/tablet screenshot review is still required before calling the Signal Feed fully operator-ready.

## Redesign Acceptance Criteria

- The first viewport answers: what this page is, what matters today, and what to do next.
- No developer/test session controls appear in production operator mode.
- Advanced filters no longer dominate the workflow.
- Every metric has a meaning and queue link.
- Every disabled action has a reason.
- No candidate/opportunity is created without explicit user action.
