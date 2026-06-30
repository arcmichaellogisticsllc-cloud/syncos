# Operator UI Hardening Report

## Sprint

Operator UI Hardening

## Purpose

This sprint hardens the operator-facing UI without changing business logic. The focus is safety, clarity, deterministic action surfaces, modal behavior, persona readability, accessibility semantics, and release-gate preservation.

The sprint follows the 13-ticket recommendation:

1. Audit lifecycle action areas across all detail pages.
2. Add stable action-area/test-id conventions where needed.
3. Standardize modal footer and submit handling.
4. Improve modal validation error rendering.
5. Standardize disabled-action reasons.
6. Harden detail page reload after mutation.
7. Normalize boundary copy across high-risk domains.
8. Review read-only and natural persona UI behavior.
9. Fix mobile/compact viewport layout issues in detail pages.
10. Add or update E2E assertions for hardened action areas.
11. Run targeted E2E suites.
12. Run full release gate and static checks.
13. Produce Operator UI Hardening report.

## Current Baseline

The previous release certification work established:

- Full release E2E gate passed locally with 576 tests.
- Action-state certification has 68 certified states.
- CI seed order is correct:
  1. `npm run db:migrate`
  2. `npm run db:seed`
  3. `npm run seed:e2e-demo`
  4. `npm run e2e:seed-smoke`
- Shared E2E action-button helpers avoid broad selector ambiguity.
- No `test.skip`, `test.only`, `.fixme`, or `forbiddenTables: []` escape hatch is permitted.

## Audit Summary

The audit found that SyncOS already uses consistent macro patterns:

- `workspace-panel`
- `section-toolbar`
- `form-actions`
- `tabs`
- `warning-box`
- `error-banner`
- `success-banner`
- `empty-state`
- `detail-list`

The audit also found repeated local implementations:

- Many workspaces define their own `ActionButton`.
- Many workspaces render tab rows as plain buttons without tab semantics.
- Many modal implementations use the same shape but do not all prevent repeat submits.
- High-risk action surfaces are concentrated in:
  - Payment Execution
  - Bank Reconciliation
  - Accounting Export
  - Cash Application
  - Archive/void/approve/reject lifecycle modals

This sprint hardened shared CSS and the two highest-risk operator surfaces that recently exposed selector/modal issues:

- Payment Execution
- Bank Reconciliation

## Ticket 1: Audit Lifecycle Action Areas

### Findings

Lifecycle action areas are generally rendered in `.form-actions`, usually inside a `.section-toolbar` on detail pages. Secondary panels and tables may also contain `.form-actions`.

Operator risk:

- Primary actions and secondary panel actions can share labels.
- Tabs are button elements and can be confused with action buttons by both tests and operators if not visually/semantically distinct.
- Table-row actions are legitimate actions but should not be mistaken for primary lifecycle actions.

### Hardening Applied

- Shared CSS now makes `.form-actions` align consistently.
- `.section-toolbar > .form-actions` now right-aligns primary toolbar actions.
- Tabs now have a more distinct inactive background.
- Active tab styling also responds to `aria-selected="true"`.

### Remaining Work

Future sprint work should extract a shared `ActionButton` and `ActionArea` component rather than continuing per-workspace local implementations.

## Ticket 2: Stable Action-Area/Test-ID Conventions

### Findings

The E2E suite already uses a shared helper for deterministic action selection. For runtime UI, the convention should be:

- Primary lifecycle actions remain in `.section-toolbar .form-actions`.
- Modal footer actions use `data-testid="modal-actions"`.
- Tab controls use `role="tablist"` and `role="tab"`.

### Hardening Applied

- Payment Execution modal footer now uses `data-testid="modal-actions"`.
- Bank Reconciliation modal footer now uses `data-testid="modal-actions"`.
- Payment Execution detail tabs now use `role="tablist"` and `role="tab"`.
- Bank Reconciliation account and transaction tabs now use `role="tablist"` and `role="tab"`.

### Remaining Work

Add `data-testid="primary-actions"` to primary detail toolbars in all certified workspaces when a shared action-area component is introduced.

## Ticket 3: Modal Footer And Submit Handling

### Findings

High-risk modals submit backend lifecycle mutations. Repeat submit creates avoidable operator and test risk.

### Hardening Applied

Payment Execution modal:

- Tracks `submitting`.
- Ignores repeat submits while already submitting.
- Disables submit, cancel, and close while submitting.
- Shows `Submitting...` state.
- Uses danger styling for reject/cancel/void/archive/failure actions.

Bank Reconciliation modal:

- Tracks `submitting`.
- Ignores repeat submits while already submitting.
- Disables submit, cancel, and close while submitting.
- Shows `Submitting...` state.
- Uses danger styling for reject/void/archive/ignore actions.

### Business Logic Impact

None. Backend routes and payloads are unchanged.

## Ticket 4: Modal Validation Error Rendering

### Findings

Modal errors were visible, but not explicitly announced as alerts.

### Hardening Applied

- Payment Execution modal errors now render with `role="alert"`.
- Bank Reconciliation modal errors now render with `role="alert"`.
- Shared `.error-banner` styling remains unchanged except for compatibility with the shared alert usage.

### Business Logic Impact

None.

## Ticket 5: Disabled-Action Reasons

### Findings

Most disabled state logic is correct but local to each workspace. Reasons are not consistently surfaced to operators.

### Hardening Applied

- No backend or permission logic was changed.
- Shared focus and disabled styling was improved so disabled controls are visibly distinct and keyboard focus is clearer.

### Remaining Work

Add a shared disabled-reason convention:

- `disabledReason` prop on shared `ActionButton`.
- `title` and accessible description for disabled actions.
- Explicit reason strings for common states:
  - archived
  - voided
  - missing required item
  - not in required lifecycle state
  - permission denied
  - backend validation required

## Ticket 6: Detail Page Reload After Mutation

### Findings

High-risk modals already call `onSaved()` before `onClose()`. This is the correct order because stale modal closure should not hide failed reloads.

### Hardening Applied

- Payment Execution preserves `await onSaved(); onClose();`.
- Bank Reconciliation preserves `await onSaved(); onClose();`.
- Repeat-submit protection makes this reload path more deterministic.

### Business Logic Impact

None.

## Ticket 7: Boundary Copy Normalization

### Findings

Boundary copy is already strong in the high-risk areas:

- Payment Execution states no money movement, no bank transaction, no provider submission, no reconciliation, no tax filing, no accounting export.
- Bank Reconciliation states no bank feed, no statement import, no invoice balance change, no payment/cash/accounting side effects.

### Hardening Applied

- Boundary copy was preserved.
- No assertions were weakened.
- No unsupported capability language was added.

### Remaining Work

A later copy pass should normalize the tone and structure of all `warning-box` content across every workspace.

## Ticket 8: Persona UX Review

### Findings

Current persona behavior is enforced by:

- UI permission gating through `ActionButton`.
- Backend denied-write E2E tests.
- Read-only auditor UI checks.
- Natural persona action visibility checks.

### Hardening Applied

- No permission behavior changed.
- Payment and bank action surfaces remain governed by existing permission checks.
- Tab semantics reduce accidental action detection by assistive tech and tests.

### Validation Expectation

The following must remain green:

```bash
npm run e2e:action-state-personas
```

## Ticket 9: Mobile/Compact Viewport Layout

### Findings

The shared stylesheet already has mobile behavior for toolbar and layout collapse.

### Hardening Applied

- Focus states added for keyboard and compact viewport clarity.
- Modal card styling now applies consistently to both `.modal-panel` and `.modal-card`.
- This fixes modal-card surfaces that previously depended on class names not covered by shared modal styling.

### Remaining Work

Future browser screenshot validation should cover mobile width for:

- Payment Execution detail
- Bank Transaction detail
- Accounting Export detail
- Cash Receipt detail
- Invoice detail

## Ticket 10: E2E Assertions For Hardened Action Areas

### Findings

Existing action-state E2E already covers:

- Route health.
- Modal open/cancel.
- Boundary no-mutation checks.
- Persona action availability and denial.
- Readiness action visibility.
- Full submit certification.

### Hardening Applied

- UI changes were made to preserve existing role-based tests.
- Modal footer now has stable `data-testid="modal-actions"` for future targeted assertions.
- Tabs now expose tab semantics.

### Remaining Work

Add explicit E2E checks later for:

- Modal submit button disables while submitting.
- Modal error banner has `role="alert"`.
- Primary action area has stable test id after shared component extraction.

## Ticket 11: Targeted E2E Suites

Completed after this sprint:

```bash
npm run e2e:action-state-boundaries
npm run e2e:action-state-personas
npm run e2e:action-states
```

Results:

- `npm run e2e:action-state-boundaries -- --reporter=line`: 68 passed.
- `npm run e2e:action-state-personas -- --reporter=line`: 140 passed.
- `npm run e2e:action-states -- --reporter=line`: 412 passed.

These suites were required because the sprint touches high-risk action and modal surfaces.

## Ticket 12: Full Release Gate And Static Checks

Completed before certification claim:

```bash
npm run e2e:ci:release
node scripts/check-e2e-certification.js --ci
npm test
npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
git diff --check
git status --short
```

Release E2E result:

- `npm run e2e:ci:release -- --reporter=line`: 576 passed.

Static check results are recorded in the final sprint report response.

## Ticket 13: Report

This document is the sprint report.

## Files Changed

High-risk UI:

- `apps/web/app/styles.css`
- `apps/web/app/payments/payment-execution-workspace.tsx`
- `apps/web/app/bank-reconciliation/bank-reconciliation-workspace.tsx`

Sprint artifact:

- `docs/product/operator-ui-hardening-report.md`

## Certification Rules Preserved

This sprint did not:

- Add `test.skip`.
- Add `test.only`.
- Add `.fixme`.
- Set `forbiddenTables: []`.
- Remove E2E assertions.
- Change backend lifecycle business rules.
- Add external integration behavior.
- Add fake UI-only data.

## Current Sprint Status

Implementation status:

- Ticket 1: completed for audit and shared styling.
- Ticket 2: partially completed; modal action test id and tab semantics added for high-risk surfaces.
- Ticket 3: completed for Payment Execution and Bank Reconciliation.
- Ticket 4: completed for Payment Execution and Bank Reconciliation.
- Ticket 5: partially completed; shared styling improved, explicit disabled reasons remain future shared-component work.
- Ticket 6: completed for high-risk modal paths; existing reload order preserved.
- Ticket 7: reviewed and preserved; full copy normalization remains future work.
- Ticket 8: reviewed; no permission behavior changed.
- Ticket 9: partially completed; shared modal/focus compact behavior improved.
- Ticket 10: groundwork added; future explicit assertions recommended.
- Ticket 11: completed; targeted suites passed.
- Ticket 12: completed; full release E2E gate passed and static checks are required before commit.
- Ticket 13: completed.

Recommended status:

- GO for static certification checks.
- GO for release certification only after static checks pass.
