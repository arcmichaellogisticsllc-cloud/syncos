# SyncOS P13 - Payment Execution, Retainage Release, Adjustments

## 1. Baseline Branch / Commit

Branch: `feat/payment-retainage-adjustments-p13`

Baseline commit: `1d0cf47634686c06fa0ba1924be38d23f8066089`

## 2. Existing Payment Capability Audit

SUPPORTED: `payment_batches` and `payment_items` already support governed internal payment preparation, review, approval, scheduling, and manual/external execution status tracking.

PARTIALLY SUPPORTED: `payments` exists as a compact confirmed payment record tied to invoices/settlements. It does not model Partner provider attempts or instruction lifecycle by itself.

MISSING: provider-neutral Partner payment instructions, per-attempt provider status, confirmed paid-balance mutation for Contractor Payables, retainage release history, and controlled post-billing adjustment records.

UNSAFE TO INFER: there is no certified production payout adapter in the local test environment.

DUPLICATE - DO NOT BUILD: P13 does not create a second settlement, invoice, cash, billable, or payable ledger.

## 3. Payment Domain Boundaries

Settlement is not Payment. Contractor Payable is not Payment. Eligibility is not Payment. Customer Cash is not Partner Payment. Payment Instruction is not Payment Confirmation. Provider Submission is not settled/completed payment.

## 4. Contractor Payable -> Payment Flow

P13 pays only from `contractor_payables` after P12 eligibility has created `eligible_amount`. The flow is:

`contractor_payables` -> `partner_payment_instructions` -> `partner_payment_attempts` -> confirmed local/test provider status -> `payments` record -> `contractor_payables.paid_amount`.

## 5. Payment Eligibility

`availableToPay = eligible_amount - paid_amount - active instruction amount`.

Held payables are blocked. A client amount is never trusted without recalculation.

## 6. Payment Instruction

`partner_payment_instructions` records Partner, Contractor Payable, amount, currency, method, payment profile, requested/approved/submitted facts, status, safe failure reason, and idempotency key.

## 7. Payment Approval

No existing maker-checker threshold is configured for this P13 local workflow, so instructions are created as internally approved by the authorized finance actor. This is a documented control limitation, not a hidden threshold.

## 8. Payment Destination

P13 reuses `partner_payment_profiles`. Payment creation requires active Partner profile and active Priority Passport status. Raw payment account digits are not stored or returned.

## 9. Provider Adapter

P13 uses a provider-neutral local test adapter named `local_test_provider`. It creates synthetic provider references only. Provider credentials for production, production payout rails, and real money movement are excluded.

## 10. Provider Submission

Submission creates a `partner_payment_attempts` row and transitions the instruction to `processing`. It does not mutate `paid_amount`.

## 11. Confirmation

Only explicit confirmed provider/test status marks an attempt confirmed, creates a compact `payments` record, and increases `contractor_payables.paid_amount`.

## 12. Failure / Return

Failure preserves the attempt, records a safe reason, returns the instruction to failed state, and releases the in-flight amount for retry. It does not increase paid balance.

## 13. Retry

Retry creates a new attempt number for the same instruction. Prior failed attempts remain intact.

## 14. Payment Idempotency

Instruction creation and provider attempts use tenant-scoped idempotency keys. Duplicate confirmation is no-op after the instruction reaches `confirmed`.

## 15. Partner Payment Portal

Partner Admin can view own Contractor Payable payment status, eligible amount, in-flight amount, paid amount, due date, retainage held, and provider reference. Customer rates, margins, restricted payment details, and provider secrets are omitted.

## 16. Internal Payment Workspace

The internal page `/payment-retainage-adjustments` shows eligible, in-flight, paid, retained, adjustment, and ready-to-pay summaries.

## 17. Retainage Model

P13 preserves original `retainage_amount` and adds `retained_balance_amount` for remaining retained balance.

## 18. Retainage Release Eligibility

Automatic release conditions are not inferred. P13 requires authorized internal release reason and source reference.

## 19. Retainage Release

`retainage_releases` records source payable, retained amount, release amount, reason, source, authorization, status, and idempotency.

## 20. Retainage Release Payable

Authorization creates a separate `contractor_payables` row with `payable_type = retainage_release`. The original settlement/payable history is not rewritten.

## 21. Post-Billing QC Change

P13 reuses the P12 exception and creates controlled adjustment facts when Customer accepted quantity changes after billing.

## 22. Credit / Rebill Strategy

`financial_adjustments` records customer credit/rebill review requirements using the original billed rate source. Issued invoices are not mutated.

## 23. Invoice History Preservation

Original invoice and invoice item rows remain unchanged. Adjustment rows carry lineage back to invoice item, Billable, accepted production source, and Customer QC decision.

## 24. Partner Payable Adjustment

Partner payable adjustment is controlled through `financial_adjustments` and recovery exceptions. Already-paid Partner amounts are not automatically debited or clawed back.

## 25. Already-Paid Recovery Exception

When a correction may require Partner recovery, P13 creates a `partner_recovery_required` exception for authorized resolution.

## 26. Eligibility Recalculation

P12 eligibility snapshots remain the eligibility source. P13 payment confirmation changes paid balance only and does not destructively rewrite eligibility snapshots.

## 27. Security

All routes enforce tenant and finance/Partner permissions. Partner reads resolve organization scope server-side. Foremen have no money/payment route permission.

## 28. Permissions

New permissions: `partner_payment.execute`, `partner_payment.submit`, `partner_payment.confirm`, `partner_payment.read`, `retainage.release`, and `financial_adjustment.create`.

## 29. Events

Events include `partner_payment.instruction_created`, `partner_payment.submitted`, `partner_payment.confirmed`, `partner_payment.failed`, `retainage.release_created`, `retainage.release_authorized`, and `financial_adjustment.created`.

## 30. Audit

All money-affecting writes use `executeWriteAction`, producing audit and event records without provider secrets, bank data, Customer rates in Partner context, or internal notes.

## 31. Migration

Migration added: `packages/database/migrations/051_payment_retainage_adjustments.sql`.

## 32. Fresh DB Result

PASS. Fresh disposable database `syncos_p13_cert_final` migrated through `051_payment_retainage_adjustments.sql`, base seed completed, E2E demo seed completed, API health returned OK, and full global certification passed against that runtime.

## 33. P12->P13 Upgrade Result

PASS. Disposable upgrade database `syncos_p13_upgrade` was built through migrations `001`-`050`, seeded as the P12 baseline, then upgraded with the normal migration runner. The runner applied only `051_payment_retainage_adjustments.sql`; seed rerun remained idempotent. Verified `partner_payment_instructions`, `partner_payment_attempts`, `retainage_releases`, and `financial_adjustments` exist after upgrade.

## 34. P9 Offline Regression

PASS. `tests/e2e/syncfield-daily-production.spec.ts` passed 8/8, including IndexedDB persistence, automatic replay, idempotency, authorization-loss failure, submitted-report conflict, and Partner queue isolation. In global certification, P9 executed at positions 611-618 and passed.

## 35. P10 QC Regression

PASS. `tests/e2e/syncfield-customer-qc.spec.ts` passed 10/10, including Customer QC cycles, Partner correction, reinspection, and safe Partner views. In global certification, P10 executed at positions 601-610 and passed.

## 36. P11 Export/Dashboard Regression

PASS. `tests/e2e/syncfield-production-exports-dashboard.spec.ts` passed 4/4, including accepted-production aggregation, exports, PDF artifacts, closeout, and financial boundary checks. In global certification, P11 executed at positions 623-626 and passed.

## 37. P12 Financial Regression

PASS. `tests/e2e/accepted-production-financials.spec.ts` passed 6/6, including Billable conversion, invoice/cash/application behavior, Partner settlement/payable eligibility, no Customer-rate leakage, missing-rate exception, and post-billing QC change handling. In global certification, P12 executed at positions 1-6 and passed.

## 38. P1-P12 Regression

PASS. Full global certification passed 640/640 against the fresh P13 runtime, covering P1-P12 targeted suites and cross-cutting hydration, boundaries, personas, action-states, lifecycle, route matrix, timeline/audit, and critical workflows.

## 39. P13 Targeted E2E

PASS. `tests/e2e/payment-retainage-adjustments.spec.ts` passed 4/4 targeted. In global certification, P13 executed at positions 499-502 and passed.

## 40. Global Certification

PASS. `npm run e2e:certification` passed 640/640 with exit code 0. P13 is registered in the command and executed globally at positions 499-502.

## 41. Real-Money Safety Proof

The runtime adapter is `local_test_provider`; production ACH, production Priority payout, provider credential use, payout rail access, and real Partner payout are excluded.

## 42. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/routes/payment-retainage-adjustments.controller.ts`
- `apps/api/src/security/permission.guard.ts`
- `apps/web/app/payment-retainage-adjustments/page.tsx`
- `apps/web/app/partner/payments/page.tsx`
- `apps/web/app/partner/partner-shell.tsx`
- `docs/product/payment-retainage-adjustments-p13.md`
- `packages/database/migrations/051_payment_retainage_adjustments.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/payment-retainage-adjustments.spec.ts`
- `tests/regression.test.js`
- `package.json`

## 43. Dependencies Added

None.

## 44. Known Limitations

No holiday calendar engine is implemented. Business-day logic remains the P12 weekday-only rule where used by pay-when-paid eligibility.

No live provider adapter is certified in P13. The provider boundary is local/test only.

No full settlement dispute adjudication is implemented.

## 45. Explicit P14+ Exclusions

Live production ACH, production Priority payout, bank reconciliation expansion, automatic bank feed, 1099 reporting, full general ledger, QuickBooks sync, collections expansion, fraud engine, holiday calendar engine, full settlement dispute adjudication, customer portal, and P14+ scope remain excluded.

## 46. P13 Certification

CERTIFIED.

## 47. GO / NO-GO for P14

NO-GO until P13 is committed.
