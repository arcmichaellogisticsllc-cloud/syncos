# Operator UI Phase 6 Report

## Baseline

- Baseline commit: `255b04333a66707e1763831b1fadce06b74beb40`
- Baseline message: `Redesign billing settlement and invoice workbenches`
- Branch: `main`
- Worktree status before changes: clean
- Branch state before changes: aligned with `origin/main`

## Sprint Purpose

Phase 6 turns the cash and collections workflow spine into operator-grade finance follow-up surfaces:

- Cash Application Workbench
- Payment Application workflow visibility
- Collections Workbench
- Collection Actions workflow visibility

The sprint keeps backend lifecycle behavior intact and does not add migrations, integrations, portals, bank feeds, payment processing, automated communication, legal filing, accounting posting, or money movement.

## Audit Findings

- `/cash`, `/cash/receipts/new`, `/cash/receipts/[id]`, and `/cash/receipts/[id]/edit` already existed.
- `/payment-applications` and `/payment-applications/[id]` already existed.
- `/collections`, `/collections/new`, `/collections/[id]`, and `/collections/[id]/edit` already existed.
- `/collection-actions` and `/collection-actions/[id]` already existed.
- Cash and collections detail pages already expose certified action-state buttons and backend lifecycle modals.
- List pages were still filter/table-first and did not clearly answer what cash or collections work needed attention.
- Developer session panels are environment-gated behind `NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL`.
- Current action-state labels are covered by release E2E and were preserved.

## Files Changed

- `apps/web/app/cash/cash-workspace.tsx`
- `apps/web/app/collections/collections-workspace.tsx`
- `tests/e2e/operator-phase6.spec.ts`
- `docs/product/operator-ui-phase-6-report.md`
- `docs/product/operator-ui-implementation-roadmap.md`
- `docs/product/operator-ui-gap-backlog.md`
- `docs/product/operator-page-inventory.md`
- `docs/product/operator-button-action-registry.md`
- `docs/product/operator-modal-registry.md`
- `docs/product/operator-page-wireframe-specs.md`

## Components And Patterns Updated

- Cash queue metric cards with active `aria-pressed` state.
- Cash queue tabs with `role="tab"` and `aria-selected`.
- Collections queue metric cards with active `aria-pressed` state.
- Collections queue tabs with `role="tab"` and `aria-selected`.
- Collapsed advanced filter drawers on Cash, Payment Applications, Collections, and Collection Actions.
- Operator-first cash, payment application, collection case, and collection action table columns.
- Next-action columns for receipts, payment applications, cases, and actions.
- Boundary notices for cash application, payment applications, collections, and collection actions.
- Queue-specific empty states.

## Cash Application Workbench

- `/cash` is now a Billing / Finance User workbench.
- Primary question: "What cash needs application, what invoices can be updated, and what receipt/application records need review?"
- Queues:
  - Unapplied
  - Partially Applied
  - Fully Applied
  - Application Review
  - Voided
  - Archived
  - Exceptions
- Primary actions:
  - Create Cash Receipt
  - Apply Receipt to Invoice
  - Review Unapplied Cash
  - Review Voided / Exceptions
- Required action-state labels remain on detail pages:
  - Apply to Invoice
  - Void Receipt
  - Archive Receipt

## Payment Application Visibility

- `/payment-applications` now shows application review, voided, and archived queues.
- Payment applications remain under the Cash Application workspace.
- Table copy clarifies receipt, invoice, applied amount, status, applied date, and next action.
- Required action-state labels remain on detail pages:
  - Void Payment Application
  - Archive Payment Application

## Collections Workbench

- `/collections` is now a Collections Specialist workbench.
- Primary question: "Which collection cases need action today, who owns them, what was promised, and what is blocking payment?"
- Queues:
  - Needs Action
  - Unassigned
  - Promise to Pay
  - Disputed
  - Aging
  - Completed
  - Archived
- Primary actions:
  - Create Collection Case
  - Assign Owner
  - Add Collection Action
  - Complete Due Action
  - Review Disputes
  - Review Aging
- Required action-state labels remain on detail pages:
  - Assign Owner
  - Archive Case

## Collection Actions Visibility

- `/collection-actions` now shows action due, promise, dispute, completed, and archived queues.
- Collection actions remain manual follow-up records and do not send communications.
- Required action-state labels remain on detail pages:
  - Complete Action
  - Archive Action

## Boundary Copy

- Cash page states SyncOS does not pull bank feeds, move money, process cards, initiate ACH, or post accounting entries.
- Payment Application page states applications update internal receipt-to-invoice allocation state only and do not move money, refund money, process cards, initiate ACH, or post accounting entries.
- Collections page states SyncOS does not automatically email customers, make calls, collect money, report credit, or create legal action.
- Collection Actions page states actions record manual follow-up work and do not send email, text, letters, phone calls, collect money, report credit, or create legal action.

## Tests Added

- `tests/e2e/operator-phase6.spec.ts`

Coverage:

- Cash Application Workbench queue rendering.
- Collections Workbench queue rendering.
- Default hidden developer session UI on cash and collections pages.
- Cash and collections boundary copy.
- Queue tab active state changes.
- Read-only auditor viewing without create mutation access.

## Validation Results

Passed before commit.

| Check | Result |
| --- | --- |
| `node scripts/check-e2e-certification.js --ci` | Passed, 68 certified |
| `npm test` | Passed, 7 passed, 0 failed, 0 skipped |
| `npm run typecheck` | Passed |
| `npm run build -w @syncos/api` | Passed |
| `npm run build -w @syncos/worker` | Passed |
| `npm run build -w @syncos/web` | Passed |
| Fresh `syncos_operator_phase6` DB migration | Passed |
| Fresh `syncos_operator_phase6` base seed | Passed |
| Fresh `syncos_operator_phase6` E2E demo seed | Passed |
| `npm run e2e:seed-smoke` | Passed |
| `npx playwright test tests/e2e/operator-phase6.spec.ts --reporter=line` | Passed, 7 passed |
| `npm run e2e:action-state-boundaries -- --reporter=line` | Passed, 68 passed |
| `npm run e2e:action-state-personas -- --reporter=line` | Passed, 140 passed |
| `npm run e2e:action-states -- --reporter=line` | Passed, 412 passed |
| Fresh DB reset before release gate | Passed |
| `npm run e2e:ci:release -- --reporter=line` | Passed, 576 passed, 0 failed |
| `git diff --check` | Passed |

Notes:

- One first-pass `action-state-boundaries` run had a transient production detail hydration miss for `prodApprovedNotMarked`; the direct API returned 200 for the seeded row, the isolated rerun passed, and the full clean rerun passed 68/68.
- The full release gate was run after reseeding the database because `npm run e2e:action-states` intentionally mutates certified action-state records.

## Known Gaps

- Unapplied and partial cash queues should eventually use backend receipt balance summaries.
- Cash exceptions should eventually use explicit backend exception/readiness reason fields.
- Collection Needs Action should eventually use backend action due summaries.
- Promise-to-pay queues should eventually use richer promise metadata and outcome history.
- Aging should eventually use invoice customer terms and due-date policy rather than current case/action fields.
- Detail pages still need stronger next-action cards and read-only role context.
- Create/edit pages remain CRUD-heavy and need guided cash/collections workflows later.
- Mobile/tablet review remains open.

## Recommended Next Sprint

If Phase 6 validation is green and release E2E remains green, proceed to Operator UI Phase 7: Contractor Payables, Payroll, and Payment Execution Workbench Redesign.
