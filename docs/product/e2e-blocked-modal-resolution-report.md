# E2E Blocked Modal Resolution Report

## Summary

All 17 BLOCKED states and 2 not-certified states across the `action-state-submit.spec.ts` suite are now certified. Zero legitimately blocked states remain.

## Sprint 1 — Role Authority & Seed Data (14 BLOCKED + 2 not-certified)

### Category 1 — Role Authority (8 states)

These states were seeded with an insufficient role. The `requireRoleAuthority()` guard performs an exact DB-level check against a Set of allowed role names.

| State | Required Role | Fix |
|---|---|---|
| `prodSubmitted` | QC Manager | New `qc-manager` persona |
| `prodUnderReview` | QC Manager | New `qc-manager` persona |
| `prodCorrectionRequested` | QC Manager | New `qc-manager` persona + seed fixes |
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

These states were `"not-certified"` because no submit test existed.

| State | Action | Key Assertion |
|---|---|---|
| `paymentItemDraft` | Archive Item → "Archive Payment Item" modal | `payment_items.status = "archived"` |
| `aexItemDraft` | Archive Item → "Archive Item" modal | `accounting_export_items.export_status = "archived"` |

**Test placement note:** Both item-level archive tests run AFTER their parent batch submit-review tests. `submitReview` calls `requireActiveItemCount`. Archiving items before submit-review would cause the parent batch test to fail.

## Sprint 2 — Remaining Blocked Modal Resolution (3 BLOCKED)

### Root Cause Corrections and Fixes

| State | Prior (Wrong) Diagnosis | Actual Root Cause | Fix |
|---|---|---|---|
| `settlementApproved` | "Billable items in 'blocked' status" | No `settlement_items` with `item_type='customer_billable'`; `settlementHasItemType` returns false → API rejects Mark Invoice Ready | Added `settlementApprovedItem` settlement_item with `item_type: "customer_billable"`, `status: "approved"`, no `invoice_item_id` |
| `settlementDisputed` | "DB constraint violation on contract_status" | No `settlement_items` → `calculateSettlementReadiness` writes `readiness_band="blocked"` on Resolve Dispute → violates `settlements_contract_status_check` constraint (only allows `not_ready, needs_review, ready_with_warning, ready_for_approval` in readiness_band) | Added `settlementDisputedItem` settlement_item; with items present, readiness_band resolves to `"ready_for_approval"` which satisfies the constraint |
| `invoiceItemDraft` | "Reject button disabled after Submit Review (requires under_review status)" | MISDIAGNOSED: `rejectInvoice` API has NO status restriction. UI Reject button disabled only for `viewOnly` (voided/archived). Test was simply never written. | Added test: navigate to `/invoices/${s.invoiceDraft}` (in ready_for_review after Submit Review), click Reject, fill Rejection Reason, assert `approval_status = "rejected"` |

### Technical Details

**settlementApproved — Mark Invoice Ready:**
`markSettlementReadyFlag` guard chain:
1. `before.status !== "approved"` → passes (status IS "approved")
2. `settlementHasItemType(client, tenantId, id, "customer_billable")` → was failing (no items), now passes with added `settlementApprovedItem`
3. `settlementHasFutureLink(client, tenantId, id, "invoice_item_id")` → passes (no invoice_item_id set on new item)
4. Updates settlement to `invoice_ready` status, updates settlement_items to `invoice_ready`

**settlementDisputed — Resolve Dispute:**
`resolveSettlementDispute` calls `calculateSettlementReadiness` with `{...before, status: "draft", dispute_reason: null}`. Without settlement_items: `blockers.add("no_settlement_items")` → `readinessStatus = "blocked"` → `readiness_band = "blocked"` → DB constraint violation. With `settlementDisputedItem` (no billable_item_id, quantity > 0, unit_rate set, billing/doc status "ready"): all 14 completeChecks pass → score 100 → `readinessStatus = "ready_for_approval"` → `readiness_band = "ready_for_approval"` → satisfies constraint.

**invoiceItemDraft — Reject:**
`rejectInvoice` (cash.controller.ts line 317): no `requireRoleAuthority`, no status check. UI: `disabled={viewOnly(record)}` where `viewOnly` is `["voided","archived"].includes(status)`. For `ready_for_review`, button is enabled. Test runs after `invoiceDraft: Submit Review` (invoice → ready_for_review); Reject succeeds regardless. Both tests use different record IDs so there's no ordering conflict.

## All States Certified

All 17 previously BLOCKED states and 2 previously not-certified states are now `"certified"`. The `action-state-submit.spec.ts` suite runs with 0 skips and 0 failures on a fresh seed.

## Files Changed (Sprint 2)

- `packages/database/scripts/seed-e2e-demo.js` — added `settlementApprovedItem` and `settlementDisputedItem` settlement_items
- `tests/e2e/fixtures/action-states.ts` — certified all 3 remaining states
- `tests/e2e/action-states/action-state-submit.spec.ts` — removed 2 skips, added invoiceItemDraft test
- `docs/product/e2e-blocked-modal-resolution-report.md` — updated this report
- `docs/product/e2e-full-modal-certification-gap-backlog.md` — all gaps cleared
