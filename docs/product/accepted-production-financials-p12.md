# SyncOS P12 - Accepted Production Financials

## 1. Baseline Branch / Commit

Branch: `feat/accepted-production-financials-p12`

Baseline HEAD: `7dc3b74bb0d6b9e1c9d5112813718f39151a8d1f`

## 2. Existing Finance Capability Audit

- Billable: PARTIALLY SUPPORTED. `billable_items` existed, but needed nullable P10 Customer-QC linkage and P12 source locking.
- Customer invoice: SUPPORTED. `invoices` and `invoice_items` are reused.
- Cash: PARTIALLY SUPPORTED. `cash_receipts` and `payment_applications` existed; P12 adds explicit clearance and source allocation.
- Partner settlement: PARTIALLY SUPPORTED. `settlements` and `settlement_items` existed; P12 adds Partner organization and accepted-production source lineage.
- Contractor payable: PARTIALLY SUPPORTED. `contractor_payables` existed; P12 adds pay-when-paid eligibility state.
- Rate engine: PARTIALLY SUPPORTED. `rate_schedules` and `rate_codes` are reused; P12 separates Work Order customer and Partner rate schedules.

## 3. Financial Domain Boundaries

Customer invoice, cash, Partner settlement, Contractor Payable, and Partner payment remain separate objects. P12 creates no Partner payment, ACH, bank transfer, accounting export, or settlement of cash.

## 4. Customer Revenue Chain

Customer-accepted production can create one active Billable, one invoice item, and invoice balance changes through explicit cleared cash applications.

## 5. Partner Payable Chain

Customer-accepted production can create one Partner settlement item and one Contractor Payable item. Eligibility is calculated only from cleared, applied Customer cash allocated to the same accepted-production sources.

## 6. Accepted Production Eligibility

P12 reuses P10 Customer QC decisions and P11 lineage rules: only current effective `accepted` or `partially_accepted` decisions with positive `customerAcceptedQuantity` are eligible.

## 7. Billable Model

`billable_items` is reused and extended with accepted-production source and Customer-QC decision references.

## 8. Customer Rate Resolution

Customer billing uses `work_orders.customer_rate_schedule_id` and matching active `rate_codes.customer_rate` / `amount` by production code and unit.

## 9. Partner Rate Resolution

Partner settlement uses `work_orders.partner_rate_schedule_id` and matching active `rate_codes.contractor_rate`.

## 10. Rate Versioning

P12 locks rate schedule ID, effective date, unit, rate code, and amount on source, Billable, and Partner settlement facts.

## 11. Money Precision / Rounding

Authoritative storage uses PostgreSQL `NUMERIC`. API calculations round money to two decimals; quantities preserve source precision.

## 12. Customer Invoice Model

P12 reuses `invoices` and `invoice_items`, preserving invoice source fingerprints and retained balance metadata.

## 13. Invoice Source Lineage

Invoice item lineage is: Invoice Item -> Billable Item -> Accepted Production Financial Source -> Customer QC Decision -> Production Record.

## 14. Customer Retainage

Retainage is applied only when explicitly requested/configured in invoice creation. No global retainage assumption exists.

## 15. Cash Receipt

P12 reuses `cash_receipts` and adds clearance status, clear timestamp, and idempotency key.

## 16. Cash Clearing

Only cleared cash can be applied to Customer invoices.

## 17. Payment Application

P12 reuses `payment_applications` and adds `payment_application_allocations` for source-level/pro-rata funding correspondence.

## 18. Invoice Balance

Invoice balance is invoice original amount minus valid payment applications. Customer cash never directly mutates Partner payment.

## 19. Unapplied Cash

Unapplied cash remains on the cash receipt and is not forced to Partner payables.

## 20. Partner Settlement

Partner settlement statements use weekly date boundaries and Partner rates only.

## 21. Weekly Settlement Period

Default weekly boundary is Monday through Sunday in date form. Explicit period dates may be supplied.

## 22. Settlement Statement

Partner Admin sees accepted quantity, unit, Partner rate, gross/net settlement amount, eligibility status, and due date.

## 23. Partner Retainage

Partner retainage is represented separately where configured. P12 does not infer Partner retainage from every Customer invoice.

## 24. Backcharges / Holds

Backcharges, holds, and retainage remain separate amounts. Arbitrary negative lines without source/reason are not introduced.

## 25. Contractor Payable

`contractor_payables` is reused and extended with Partner organization, eligible amount, ineligible amount, pay-when-paid status, eligible timestamp, and due date.

## 26. Pay-When-Paid Model

Eligibility requires cleared Customer cash applied to an invoice whose invoice items trace to the same accepted-production sources as the Contractor Payable items.

## 27. Source Correspondence

Correspondence is preserved through `payment_application_allocations.accepted_production_source_id`.

## 28. Partial Customer Payment

When line-level allocation is not provided, P12 uses deterministic invoice-item pro-rata allocation.

## 29. Multi-Partner Allocation

Eligibility is calculated by accepted-production source, so a Partner can only become eligible for cash allocated to its own source lineage.

## 30. Eligibility Snapshots

Every eligibility calculation writes `contractor_payable_eligibility_snapshots` with a monotonic version.

## 31. Three-Business-Day Due Date

P12 calculates three weekdays after eligibility using weekday-only logic. Holidays are a known limitation.

## 32. Partner Portal Financial View

`/partner/settlements` exposes Partner Admin-safe statements. Foreman users are denied money routes.

## 33. Internal Finance Workspace

`/accepted-production-financials` exposes a compact internal operational dashboard.

## 34. Financial Exceptions

P12 creates auditable exceptions for missing Customer rate, missing Partner rate, rate mismatch, pay-when-paid allocation, and post-billing Customer-QC changes.

## 35. Post-Billing Customer-QC Change

P12 detects accepted-production changes after billing and creates a financial exception. Issued invoice and Billable history are not rewritten.

## 36. Idempotency

Unique indexes and source fingerprints prevent duplicate Billables, settlement items, invoice items, payable items, cash receipts, and allocation snapshots.

## 37. Void / Reversal

P12 does not implement full credit/rebill or reversal workflow. Changed accepted production after billing is routed to a controlled exception.

## 38. Permissions

P12 adds explicit finance permissions and Partner Admin read permissions. Field production permissions do not imply finance permissions.

## 39. Security

Tenant, customer, Partner, Work Order, invoice, settlement, payable, and source scope are enforced server-side. Partner responses omit Customer rates, margin, banking details, and internal notes.

## 40. Events

P12 uses the existing write-action event spine for Billable, invoice, cash, payment application, Partner settlement, Contractor Payable, eligibility, and exception writes.

## 41. Audit

All P12 money-changing writes use `executeWriteAction`, which records events and audit logs.

## 42. Migration

Migration: `050_accepted_production_financials.sql`

## 43. Fresh DB Result

CERTIFIED. Disposable database `syncos_p12_final` applied migrations `001` through `050`, seeded successfully, and passed `npm run db:verify`.

## 44. P11->P12 Upgrade Result

CERTIFIED. Disposable upgrade database `syncos_p12_upgrade` applied P1-P11 state through migration `049`, then migration `050`; seed rerun was idempotent and P11 accepted-production/export state remained intact.

## 45. P9 Offline Regression

CERTIFIED. P9 offline replay passed in targeted regression and in global certification at positions 607-614, including IndexedDB persistence, automatic reconnect replay, duplicate idempotency, submitted-report conflict, and Partner queue isolation.

## 46. P10 Customer-QC Regression

CERTIFIED. P10 Customer QC passed in targeted regression and in global certification at positions 597-606, including customer decision history, correction relay, reinspection, accepted quantities, and Partner-safe QC views.

## 47. P11 Export/Dashboard Regression

CERTIFIED. P11 export/dashboard coverage passed in targeted regression and in global certification at positions 619-622, including accepted lineage, CSV safety, PDF artifacts, closeout, and financial-boundary checks.

## 48. P1-P11 Regression

CERTIFIED. P1-P11 targeted Partner/SyncField regressions, hydration, boundaries, personas, action-state personas, lifecycle, and route matrix coverage passed in the final global run.

## 49. P12 Targeted E2E

CERTIFIED. `tests/e2e/accepted-production-financials.spec.ts` passed 6/6 targeted tests and executed globally at positions 1-6.

## 50. Global Certification

CERTIFIED. `npm run e2e:certification` passed 636/636 with exit code 0 against fresh API/web runtime on disposable database `syncos_p12_final`.

## 51. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/routes/accepted-production-financials.controller.ts`
- `apps/api/src/security/permission.guard.ts`
- `apps/web/app/accepted-production-financials/page.tsx`
- `apps/web/app/partner/partner-shell.tsx`
- `apps/web/app/partner/settlements/page.tsx`
- `docs/product/accepted-production-financials-p12.md`
- `package.json`
- `packages/database/migrations/050_accepted_production_financials.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/accepted-production-financials.spec.ts`
- `tests/regression.test.js`

## 52. Dependencies Added

None.

## 53. Known Limitations

Holiday calendars are not implemented for the three-business-day due date. Credit/rebill and retainage release remain future controlled finance workflows.

## 54. Partner Payment Execution Boundary

P12 stops at Contractor Payable eligibility and ready-to-pay status. No Partner payment, ACH, Priority payment, or bank movement is executed.

## 55. Explicit P13+ Exclusions

Actual Partner payment execution, ACH, bank reconciliation expansion, processor ingestion, QuickBooks, Partner invoice submission, collections automation expansion, and P13+ are excluded.

## 56. P12 Certification

CERTIFIED

## 57. GO / NO-GO for P13

GO after P12 is reviewed and committed. Do not begin P13 from an uncommitted P12 worktree.
