# E2E Deterministic Action States

## Purpose

Deterministic action states are pre-seeded records placed in specific lifecycle positions so that browser E2E tests can open every major action modal from a known starting state without relying on test-time creation or teardown.

Each state is a UUID-stable record that lives in the `arc-syncos-demo` tenant alongside canonical Cedar Ridge records. They are seeded by `seed-e2e-demo.js` and described in `tests/e2e/fixtures/action-states.ts`.

## Goals of This Sprint

1. Prove each seeded record exists and is reachable (route loads, label hydrates).
2. Prove the expected CTA is visible in the correct lifecycle state.
3. Prove each modal opens, shows required fields, and can be cancelled without side effects.
4. Prove forbidden downstream tables do not change during navigate/open/cancel.
5. Prove the natural persona sees the action button and the read-only auditor does not.

Submit-path certification (actually submitting modals) is **out of scope** for this sprint. All action states have `submitCertificationStatus: "not-certified"` and are tracked in the gap backlog.

## Naming Conventions

| Concept | Convention |
|---|---|
| State key (JS/TS) | `camelCase`, e.g. `prodDraft`, `invoiceApproved` |
| Seed function key | `uuid("action-<domain>-<state>")` |
| Seeded label | `"E2E Action <Description>"` |
| Record number | `<PREFIX>-ACT-NNN` (e.g. `INV-ACT-001`) |

## ID Generation

All action state UUIDs are generated with the same deterministic SHA1 hash used for canonical records:

```js
const namespace = "syncos-browser-e2e-cedar-ridge";
crypto.createHash("sha1").update(namespace + ":" + value);
```

Pre-computed IDs are written to `tests/e2e/fixtures/e2e-demo-records.json` under the `actionStates` key and read at test time via `readE2EManifest().actionStates`.

## Domain Coverage

| Domain | States | Table |
|---|---|---|
| Production | draft, submitted, under_review, correction_requested, approved (billable markable), void | `production_records` |
| QC | pending, in_review, correction_requested, void | `qc_reviews` |
| Billable | draft, on_hold, disputed, void | `billable_items` |
| Settlement | draft + item, under_review, approved, disputed, void | `settlements`, `settlement_items` |
| Invoice | draft + item, under_review, approved, disputed, void | `invoices`, `invoice_items` |
| Cash / Payment Application | unapplied receipt, voidable receipt, void receipt, applied PA, void PA | `cash_receipts`, `payment_applications` |
| Collections | case open, case closed, action planned, action completed | `collection_cases`, `collection_actions` |
| Contractor Payable | draft + item, under_review, approved, disputed, void | `contractor_payables`, `contractor_payable_items` |
| Payroll | draft + item, under_review, approved, disputed, void | `payroll_runs`, `payroll_items` |
| Payment Batch / Execution | draft + item, under_review, approved, scheduled, execution_submitted, voidable, void | `payment_batches`, `payment_items` |
| Bank Reconciliation | bank account archivable, txn unmatched debit, txn unmatched credit, txn exception none, txn exception open, txn ignorable, recon match proposed | `bank_accounts`, `bank_transactions`, `reconciliation_matches` |
| Accounting Export | draft + item, generated, under_review, submitted, cancelable, void | `accounting_export_batches`, `accounting_export_items` |

## Test Spec Files

| File | What it tests |
|---|---|
| `action-state-readiness.spec.ts` | Route loads, label hydrates, action button visible |
| `action-state-modals.spec.ts` | Modal opens, title matches, required fields present, cancel clean |
| `action-state-boundaries.spec.ts` | Forbidden tables unchanged after navigate/open/cancel |
| `action-state-personas.spec.ts` | Natural persona sees button; read-only auditor does not |

## Running

```bash
# All four specs
npm run e2e:action-states

# Individual suites
npm run e2e:action-state-modals
npm run e2e:action-state-boundaries
npm run e2e:action-state-personas
```

## Seed Smoke

The `validate-seed.js` script (`npm run e2e:seed-smoke`) asserts all 67 action state records exist in the database.

## Invariants

- All action state records reference canonical FK IDs (`ids.project`, `ids.workOrder`, etc.) from the frozen `ids` constant. No new parent records are created.
- Seeding is idempotent — re-running `seed:e2e-demo` is safe.
- No action state record creates downstream objects (Settlement, Invoice, Cash, etc.) as part of seeding.
- `settlementItemDraft`, `invoiceItemDraft`, `cpayItemDraft`, `payrollItemDraft` are tested from their parent route since no dedicated sub-item route exists. `paymentItemDraft` and `aexItemDraft` have dedicated routes.
