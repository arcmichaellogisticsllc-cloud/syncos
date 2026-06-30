# E2E Blocked Modal Resolution Report

## Sprint: Browser E2E Blocked Modal Resolution & CI Gate Hardening

## Summary

Sprint resolved 14 of 17 BLOCKED states and 2 of 2 not-certified states across the `action-state-submit.spec.ts` suite. Three states remain legitimately blocked due to seed data constraints that cannot be fixed without mutating product business logic.

## Resolved States

### Category 1 — Role Authority (8 states)

These states were seeded with an insufficient role. The `requireRoleAuthority()` guard performs an exact DB-level check against a Set of allowed role names.

| State | Required Role | Fix |
|---|---|---|
| `prodSubmitted` | QC Manager | New `qc-manager` persona |
| `prodUnderReview` | QC Manager | New `qc-manager` persona |
| `prodCorrectionRequested` | QC Manager | New `qc-manager` persona + seed fixes (see below) |
| `prodApprovedNotMarked` | QC Manager | New `qc-manager` persona |
| `qcPending` | QC Manager | New `qc-manager` persona |
| `qcInReview` | QC Manager | New `qc-manager` persona |
| `qcCorrectionRequested` | QC Manager | New `qc-manager` persona |
| `invoiceDraft` | Billing Manager or Finance Manager | New `billing-manager` persona |

**New personas added:**
- `qc-manager`: role "QC Manager", permissions `["production.", "production_record.", "qc.", "qc_review.", "production_evidence."]`
- `billing-manager`: role "Billing Manager", permissions `["invoice.", "invoice_item.", "billable_item."]`

### Category 2 — Seed Data Fixes (8 states)

| State | Root Cause | Fix |
|---|---|---|
| `cpayUnderReview` | No active contractor_payable_items; `requireActiveItemCount` rejected Approve | Added `cpayItemUnderReview` with `status: "draft"` |
| `payrollUnderReview` | No active payroll_items; `requireActiveItemCount` rejected Approve | Added `payrollItemUnderReview` with `status: "draft"` |
| `paymentBatchUnderReview` | No active payment_items (`item_count: 0`); `requireActiveItemCount` rejected Approve | Added `paymentItemUnderReview` with `status: "draft"`, set `item_count: 1` |
| `paymentBatchScheduled` | `execution_status: "not_submitted"` prevented Submit Execution (requires `"ready_for_execution"`) | Changed `execution_status` to `"ready_for_execution"` |
| `bankTxnUnmatchedDebit` | No payment batch with `execution_status: "executed_later"`; Match Payment Batch SELECT loads only `executed_later` batches | Added `bankReconPaymentBatch` with `status: "executed_later"`, `execution_status: "executed_later"` |
| `aexGenerated` | `status: "draft"` prevented Mark Submitted (requires `status ∈ {approved, generated}`) | Changed `status` to `"generated"` |
| `aexUnderReview` | No active accounting_export_items (`item_count: 0`); `requireActiveItemCount` rejected Approve | Added `aexItemUnderReview` with `export_status: "pending"`, set `item_count: 1` |
| `prodCorrectionRequested` | Additional blockers beyond role: (1) `correction_required_at` was null, (2) no `production_evidence` with `status='active'` created after `correction_required_at` | Added `correction_required_at: "2026-01-31T12:00:00Z"` + new `production_evidence` row |

### Category 3 — New Spec Coverage (2 states)

These states were `"not-certified"` because no submit test existed. Tests were added and the states are now `"certified"`.

| State | Action | Key Assertion |
|---|---|---|
| `paymentItemDraft` | Archive Item → "Archive Payment Item" modal | `payment_items.status = "archived"` |
| `aexItemDraft` | Archive Item → "Archive Item" modal | `accounting_export_items.export_status = "archived"` |

**Test placement note:** Both item-level archive tests run AFTER their parent batch submit-review tests. `submitReview` for both payment batches and AEX batches calls `requireActiveItemCount`. Archiving items before submit-review would cause the parent batch test to fail.

## Remaining Blocked States

These three states remain `"blocked"` with legitimate reasons that cannot be resolved without mutating product business logic or introducing fake seed data.

| State | Blocked Reason |
|---|---|
| `settlementApproved` | Seeded billable items are in `'blocked'` status. API rejects Mark Invoice Ready when any item is not in a ready-for-settlement state. Fixing this requires business-logic-complete billable item state sequences not currently seeded. |
| `settlementDisputed` | Seeded `settlementDisputed` violates the `settlements_contract_status_check` DB constraint on Resolve Dispute. The contract status is incompatible with dispute resolution as seeded. |
| `invoiceItemDraft` | State uses the parent `invoiceDraft` route. After invoiceDraft submits for review, the invoice transitions to `ready_for_review`, making the Reject button disabled (requires `under_review` status). The test cannot certify submit without a dedicated invoice-item route that is independent of the parent invoice state. |

## Files Changed

- `packages/database/scripts/seed-e2e-demo.js` — seed data fixes and new records
- `tests/e2e/fixtures/personas.ts` — two new personas
- `tests/e2e/fixtures/action-states.ts` — certification status updates for all 14 resolved + 2 new states
- `tests/e2e/action-states/action-state-submit.spec.ts` — removed skips, added 2 new tests
- `package.json` — added CI gate scripts
