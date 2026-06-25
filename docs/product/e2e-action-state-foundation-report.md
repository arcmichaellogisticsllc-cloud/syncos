# E2E Action State Foundation Report

Sprint: Browser E2E Deterministic Action State Foundation
Baseline HEAD: `89946b3801a496c0ee76a507069aaa07a08c9dbb`

## Summary

This sprint established a deterministic, action-specific seeded record layer enabling future browser tests to open every major action modal from a known starting state. All deliverables were completed without migrations, production routes, external integrations, or downstream record creation.

## Deliverables Completed

### 1. Action-State Taxonomy

67 pre-seeded records across 12 domains, covering every major lifecycle position. Each record has a stable SHA1-derived UUID, a unique seeded label, and a predictable DB state. See `e2e-deterministic-action-states.md` for the full domain/table matrix.

### 2. Deterministic Seed Extension

File: `packages/database/scripts/seed-e2e-demo.js`

Added:
- `actionIds` constant (67 entries) using the same `uuid()` function as canonical records
- `seedActionStateRecords(client)` function seeding all records with correct lifecycle fields
- Extended `writeManifest()` to output `actionStates` section in the JSON manifest

All records use canonical FK IDs (`ids.project`, `ids.workOrder`, etc.) and do not create new parent objects.

### 3. Action-State Manifest

File: `tests/e2e/fixtures/action-states.ts`

Exports:
- `ActionState` type with `stateKey`, `domain`, `objectType`, `recordId`, `label`, `route`, `expectedStatus`, `expectedActionLabel`, `expectedModalTitle`, `persona`, `requiredFields`, `forbiddenTables`, `submitCertificationStatus`, `notes?`
- `actionStates: ActionState[]` — 67 entries
- `actionStatesByKey` — keyed lookup
- `actionStatesByDomain` — grouped by domain

Also updated `tests/e2e/helpers/manifest.ts` to include `actionStates: Record<string, string>` in `E2EManifest`.

### 4. Test Spec Files

| File | Tests |
|---|---|
| `tests/e2e/action-states/action-state-readiness.spec.ts` | 67 tests — route loads, label hydrates, action button visible |
| `tests/e2e/action-states/action-state-modals.spec.ts` | 67 tests — modal opens, title matches, required fields present, cancel clean |
| `tests/e2e/action-states/action-state-boundaries.spec.ts` | ~65 tests — forbidden table counts unchanged after navigate/open/cancel |
| `tests/e2e/action-states/action-state-personas.spec.ts` | 67×2 + 4 backend denial tests — natural persona sees CTA, read-only auditor does not |

### 5. Seed Smoke Extension

File: `tests/e2e/validate-seed.js`

Added:
- `requiredActionStates` array (67 entries, each `[stateKey, table, idField]`)
- `assertActionStatesManifest(manifest)` — validates all keys present in manifest JSON
- `assertActionStateRecords(client, manifest)` — queries DB to confirm each record exists

### 6. Package Scripts

Added to `package.json`:
- `e2e:action-states` — runs all four action state specs
- `e2e:action-state-modals` — modals spec only
- `e2e:action-state-boundaries` — boundaries spec only
- `e2e:action-state-personas` — personas spec only
- Updated `e2e:certification` to include `tests/e2e/action-states`

### 7. Documentation

- `docs/product/e2e-deterministic-action-states.md` — design, naming, domain coverage, running
- `docs/product/e2e-action-state-foundation-report.md` — this file
- `docs/product/e2e-action-state-gap-backlog.md` — gap backlog for next sprint

## Constraint Verification

| Constraint | Status |
|---|---|
| No migrations added | ✅ |
| No production routes added | ✅ |
| No product features added | ✅ |
| No external integrations | ✅ |
| Settlement not created by Production/QC/Billable | ✅ |
| Invoice not created by Settlement | ✅ |
| Cash not created by Invoice | ✅ |
| Payment Application is only path to Invoice balance update | ✅ |
| Collections does not create Cash/PA | ✅ |
| Contractor Payable does not send money | ✅ |
| Payroll does not send money or file taxes | ✅ |
| Payment Execution is status/control only | ✅ |
| Bank Reconciliation does not create Accounting Export | ✅ |
| Accounting Export does not call external APIs | ✅ |

## Not Certified in This Sprint

- Submit-path modal certification: all states have `submitCertificationStatus: "not-certified"`
- Cross-persona denial matrix (non-admin personas blocked from wrong domains)
- Sub-item dedicated routes for settlement-items, invoice-items, cpay-items, payroll-items
- Modal required field exact-match validation (uses loose RegExp, not field-by-field)

These gaps are tracked in `e2e-action-state-gap-backlog.md`.

## Files Changed

```
packages/database/scripts/seed-e2e-demo.js          (modified)
tests/e2e/fixtures/e2e-demo-records.json             (modified)
tests/e2e/fixtures/action-states.ts                  (created)
tests/e2e/helpers/manifest.ts                        (modified)
tests/e2e/action-states/action-state-readiness.spec.ts   (created)
tests/e2e/action-states/action-state-modals.spec.ts      (created)
tests/e2e/action-states/action-state-boundaries.spec.ts  (created)
tests/e2e/action-states/action-state-personas.spec.ts    (created)
tests/e2e/validate-seed.js                           (modified)
package.json                                          (modified)
docs/product/e2e-deterministic-action-states.md      (created)
docs/product/e2e-action-state-foundation-report.md   (created)
docs/product/e2e-action-state-gap-backlog.md         (created)
```
