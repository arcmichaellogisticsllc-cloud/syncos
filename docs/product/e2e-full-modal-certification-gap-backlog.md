# E2E Full Modal Certification Gap Backlog

## Purpose

Tracks action states that remain blocked or not-certified after the blocked-modal resolution sprint, with root cause and resolution path.

## Legitimately Blocked States

### settlementApproved — Mark Invoice Ready

**Blocked reason:** Seeded billable items are in `'blocked'` status. The Mark Invoice Ready API guard rejects the action when any billable item is not in a ready-for-settlement state.

**Resolution path:** Seed a complete billable item state sequence for `settlementApproved` such that all items are in an invoice-ready status. Requires understanding the full billable item lifecycle from contract through settlement readiness.

**Risk:** Complex seed sequence. Must not introduce fake business logic.

---

### settlementDisputed — Resolve Dispute

**Blocked reason:** Seeded `settlementDisputed` violates the `settlements_contract_status_check` DB constraint on Resolve Dispute. The contract status stored for this record is incompatible with dispute resolution as currently seeded.

**Resolution path:** Determine the exact contract status that satisfies the DB check for a resolvable dispute. Reseed `settlementDisputed` with a compatible contract status and dispute history.

**Risk:** DB constraint is strict. Requires reading the constraint definition and seeding the right contract status combination.

---

### invoiceItemDraft — Reject (Invoice Item)

**Blocked reason:** `invoiceItemDraft` is tested via the parent `invoiceDraft` route (`/invoices/${s.invoiceDraft}`). After `invoiceDraft` submits for review, the invoice moves to `ready_for_review`, which disables the Reject button (requires `under_review` status). There is no dedicated invoice-item route that would allow independent Reject certification.

**Resolution path:** Either:
1. Add a second seeded invoice that is permanently in `under_review` status, with a dedicated `invoiceUnderReviewForItemReject` seed state, OR
2. Restructure the spec so `invoiceItemDraft` test does not depend on the same invoice that `invoiceDraft` mutates.

**Risk:** Requires careful seed ordering to avoid state collision between invoice-level and item-level tests.

---

## States Certified This Sprint

| State | Was | Now | Sprint |
|---|---|---|---|
| `prodSubmitted` | blocked | certified | Blocked Modal Resolution |
| `prodUnderReview` | blocked | certified | Blocked Modal Resolution |
| `prodCorrectionRequested` | blocked | certified | Blocked Modal Resolution |
| `prodApprovedNotMarked` | blocked | certified | Blocked Modal Resolution |
| `qcPending` | blocked | certified | Blocked Modal Resolution |
| `qcInReview` | blocked | certified | Blocked Modal Resolution |
| `qcCorrectionRequested` | blocked | certified | Blocked Modal Resolution |
| `invoiceDraft` | blocked | certified | Blocked Modal Resolution |
| `cpayUnderReview` | blocked | certified | Blocked Modal Resolution |
| `payrollUnderReview` | blocked | certified | Blocked Modal Resolution |
| `paymentBatchUnderReview` | blocked | certified | Blocked Modal Resolution |
| `paymentBatchScheduled` | blocked | certified | Blocked Modal Resolution |
| `bankTxnUnmatchedDebit` | blocked | certified | Blocked Modal Resolution |
| `aexGenerated` | blocked | certified | Blocked Modal Resolution |
| `aexUnderReview` | blocked | certified | Blocked Modal Resolution |
| `paymentItemDraft` | not-certified | certified | Blocked Modal Resolution |
| `aexItemDraft` | not-certified | certified | Blocked Modal Resolution |
