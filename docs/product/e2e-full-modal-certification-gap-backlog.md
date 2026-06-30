# E2E Full Modal Certification Gap Backlog

## Status: All Gaps Cleared

All 17 BLOCKED states and 2 not-certified states from the initial certification gap audit are now certified. The `action-state-submit.spec.ts` suite runs with 0 skips on a fresh seed.

## States Certified

| State | Was | Now | Sprint |
|---|---|---|---|
| `prodSubmitted` | blocked | certified | Sprint 1: Role Authority |
| `prodUnderReview` | blocked | certified | Sprint 1: Role Authority |
| `prodCorrectionRequested` | blocked | certified | Sprint 1: Role Authority + Seed |
| `prodApprovedNotMarked` | blocked | certified | Sprint 1: Role Authority |
| `qcPending` | blocked | certified | Sprint 1: Role Authority |
| `qcInReview` | blocked | certified | Sprint 1: Role Authority |
| `qcCorrectionRequested` | blocked | certified | Sprint 1: Role Authority |
| `invoiceDraft` | blocked | certified | Sprint 1: Role Authority |
| `cpayUnderReview` | blocked | certified | Sprint 1: Seed Data |
| `payrollUnderReview` | blocked | certified | Sprint 1: Seed Data |
| `paymentBatchUnderReview` | blocked | certified | Sprint 1: Seed Data |
| `paymentBatchScheduled` | blocked | certified | Sprint 1: Seed Data |
| `bankTxnUnmatchedDebit` | blocked | certified | Sprint 1: Seed Data |
| `aexGenerated` | blocked | certified | Sprint 1: Seed Data |
| `aexUnderReview` | blocked | certified | Sprint 1: Seed Data |
| `paymentItemDraft` | not-certified | certified | Sprint 1: New Spec |
| `aexItemDraft` | not-certified | certified | Sprint 1: New Spec |
| `settlementApproved` | blocked | certified | Sprint 2: Missing settlement_items |
| `settlementDisputed` | blocked | certified | Sprint 2: Missing settlement_items |
| `invoiceItemDraft` | blocked | certified | Sprint 2: Misdiagnosed — test written |

## Closed: No Remaining Gaps

There are no remaining legitimately blocked states. Any future state added with `submitCertificationStatus: "blocked"` must include a `notes` field per the CI gate policy.
