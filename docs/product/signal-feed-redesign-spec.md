# Signal Feed Redesign Spec

## Source Screenshot Problem

The current Signal Feed screenshot shows Safari pointed at the local app and, in prior local UI, the page itself includes developer/test-session concepts. The product problem is broader than the browser connection state: when loaded, Signal Feed currently behaves like a testable database list rather than an operator work queue.

## Current Problems

- Developer Operator Session is visible.
- Sign-in token warning appears in main content.
- Zero metrics have no explanation.
- Filters dominate the page.
- No priority queue is visible.
- No recommended actions are prominent.
- No operator workflow is obvious.
- Create button lacks context.
- The page does not explain what makes a signal actionable.
- Advanced filters are always competing with the work list.

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
- Boundary: does not create candidate, opportunity, project, work order, invoice, or financial record.

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

- Production-mode Signal Feed does not show Operator Session/token UI.
- Unauthenticated state shows login-required card.
- Default queue is Needs Review.
- Filter drawer is collapsed by default.
- Priority cards link to correct queues.
- Verify disabled reason appears when evidence is missing.
- Read-only auditor can view but cannot mutate.
- Create Signal modal follows modal standards.
- Archive requires danger styling and modal confirmation.

## Redesign Acceptance Criteria

- The first viewport answers: what this page is, what matters today, and what to do next.
- No developer/test session controls appear in production operator mode.
- Advanced filters no longer dominate the workflow.
- Every metric has a meaning and queue link.
- Every disabled action has a reason.
- No candidate/opportunity is created without explicit user action.
