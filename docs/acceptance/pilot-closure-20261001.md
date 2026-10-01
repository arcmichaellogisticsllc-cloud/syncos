# Pilot closure review — October 1, 2026 UTC

Working candidate: `codex/financial-completion-20260930`, based on `e58f592`. This document is an evidence register, not a completed-pilot certificate. Staging was activated at application commit `f60c466008b42ff6a735129d53c3734c860dce63`. Physical-device testing and the supervised real-crew pilot have not occurred in this review.

## Implemented in this candidate

- Approved calendar/business-day terms with explicit holidays and a bounded holiday-calendar horizon. Monday–Friday is the supported business week. Unknown calendars are rejected rather than guessed.
- Four-decimal approved rates and decimal-safe quantity extension; monetary amounts remain cents. Existing locked prices are not reapproved or repriced.
- Explicit partner funding basis: gross accepted customer value, or customer invoice net of retainage. This does not authorize release of partner retainage.
- Separate funded installments and due dates for distinct cleared receipt allocations. A dated eligibility snapshot records the schedule; outstanding display applies recorded payments earliest-due-first. Recalculate after changed cash facts.
- Invoice archive manifests preserve the calendar and funding fields; printable invoices distinguish business from calendar days.
- Billing document requests now have a scoped body limit large enough for the advertised 20 MiB attachment after base64 encoding. Browser/API tests use a 256 KiB synthetic PDF to cross the former default parser limit.
- Workflow reassignment validates the role in the current tenant and removes stale user assignments; escalation and reassignment cannot reopen completed/cancelled/archived tasks.
- Remote database/file backup scripts invoke the AWS CLI correctly, protect locally created artifacts with restrictive permissions and reject invalid retention counts. Mocked remote upload tests verify failure propagation; they do not certify an actual remote provider.

- Invoice **Mark Sent** now opens the complete package and delivery-receipt workflow instead of an obsolete note-only form. In-app training was updated.
- Legacy payment batches revalidate active items, accepted-work lineage, source amounts, holds and readiness at scheduling, submission and execution; an old approval cannot bypass current controls.

## Agreement and prime source review

The mailbox was read through the Gmail connector for the Jackson account. These are historical source observations requiring applicability review, not automatic configuration instructions.

| Source | Observed evidence | Remaining verification |
| --- | --- | --- |
| PKS completed agreement, October 24, 2024; message `192c10e0ca1596ad` | Prior review recorded Net 14 from invoice acceptance. Later 2025 agreement requests also exist. | Identify the governing executed version, pricing addendum, work scope and exceptions for the pilot. Do not assume the 2024 document is current. |
| SQUAN executed-MSA email, May 8, 2026; `19e0909f682485de` | Attachment is a 19-page MSA. Available extraction shows PO-specific obligations and rework/safety/daily-report conditions. | Full attachment/signature/payment-section verification remains incomplete because the returned extraction was truncated and download access failed. |
| SQUAN Invoicing Procedure, May 12, 2026; `19e1d4a7e0f59818` | Thursday–Wednesday billing week, daily reports, Friday invoice submission, RDB submission date rather than work date, and designated email delivery. | Confirm this remains the applicable project procedure; approve the required document list and actual delivery/acceptance proof. |
| CommBridge invoice thread, July 2026; `19f9bea7d7a818ce` | Deliverables and Fulcrum pins/data are prerequisites; out-of-scope footage was challenged. A message describes Net 7 after complete invoice submission. | Reconcile written agreement, project direction and the verbal-term statement. A single promised payment date does not establish a general weekend rule. |
| WTC amended agreement email, August 2026; `19ff00b3749f83ab` | Limited extraction includes customer-payment-dependent terms. | Verify the full original, signatures, applicable parties and rates. Filename alone is not proof of an executed agreement. |
| Historical invoice rate evidence | 9,348 feet at $0.6435 equals $6,015.44 after final rounding. | This justifies precision support; it does not approve that rate for a new pilot. |

No mailbox password, access link or raw attachment is committed with this register. Identify the current pilot customer and partner before approving their configuration. Each requires an executed agreement, current rate addendum, effective dates, exceptions, retainage basis, payment trigger, approved prime package requirements and correction policy.

## Historical financial review

The isolated restored staging copy contains 10 active invoices/payables missing approved terms and complete accepted-work lineage. All 10 match exact deterministic seed identities from `packages/database/scripts/seed-e2e-demo.js`, including the tenant identity. Their origin is therefore documented as seed records; identity matching alone does not certify their later edits or business validity.

Preserve these legacy demo references and keep advancement blocked. Do not retrofit invented customer acceptance or apply current rates to them. Run new complete pilot transactions from authorized work through customer acceptance. The private per-record inventory remains outside Git. `scripts/review-historical-finance.js` reruns the read-only inventory; any nonmatching record requires original invoice, accepted work, executed terms, cash history and a finance-approved reconciliation disposition.

## Release gates still requiring evidence

| Gate | Evidence needed to close |
| --- | --- |
| Actual contract verification | Named pilot relationships and verified original executed documents, then approved configuration comparison. |
| Prime-specific packet | A complete packet checked against that prime's current requirements; actual submission/rejection/resubmission/acceptance proof kept separate. No customer email is sent by this review. |
| Physical phone acceptance | Both crew types on each supported actual device; use `docs/pilot/actual-phone-acceptance-2026-09-25.md`. Record interruptions, original camera formats, background suspension, browser/device restart, offline replay, and stop-work rejection/release. Desktop emulation is not a pass. |
| Total-server-loss recovery | Approved independent backup destination and recovery owner; retrieve backups without using the source VPS, provision a clean target, restore DB/files, verify private access/checksums/lineage, record measured RPO/RTO. |
| Supervised staging pilot | Activation is complete. Real Sync and partner crews still require current approved agreements, selected work and actual-phone execution through acceptance and finance. Synthetic local workflow tests are not that sign-off. |
| Passport | Approved sandbox, account/payee mapping, replay/partial/adjustment/unmatched tests, then a separate enablement decision. Live automation stays disabled. |

Read-only server inspection found daily local backups with retention set to seven, both backup timers active, and no configured remote destination. Those backups share the VPS failure domain. Provider snapshots and a local restore rehearsal do not establish the offsite total-loss gate.

## Final verification checkpoint

- Regression suite after the batch repair: **230 passed, zero failed/skipped**.
- Financial E2E: **13 passed**; the additional business-calendar agreement UI test passed. Invoice package delivery UI/role checks: **6 passed**.
- Broad certification was executed in segments. The first run had 398 passes and five failures; the remaining segment had 354 passes, three failures and three not run. Failures exposed the obsolete Mark Sent form, stale legacy advancement expectations and the expected numeric-scale change. Repairs and focused reruns covered those paths. The final action/partner-agreement run had 70 passes and three empty-batch message expectation failures; the corrected three tests then passed, checking both an empty batch and a populated batch without accepted-work lineage. These counts overlap and must not be summed or called one clean 702-test run.
- Both synthetic Sync and partner field/QC/customer-acceptance/finance paths passed in the isolated browser runs, including offline replay and shutdown checks. These were desktop automation, not physical-device certification.
- Fresh migrations 001–084 passed. An isolated restored staging upgrade under the application database role passed. Original values/counts across 17 checked tables were preserved. Two populated rate columns changed textual scale from two to four places; comparison normalized only those original columns to their prior scale.
- Local production and full dependency audits: zero reported vulnerabilities. Hostinger's exact candidate production build passed under Node 20.20.2, and its production audit reported zero vulnerabilities.

## Controlled staging activation

Application commit: `f60c466008b42ff6a735129d53c3734c860dce63` in `/opt/syncos/staging/releases/f60c466`. Previous release: `1d51523f8adc60a3b8ea46b39fc93c250912c2af`.

API, web and worker were stopped for a coordinated database/private-file backup. Both backup checksums passed before migrations. The old database/file pair and schema-plus-code recovery instructions are retained at `/opt/syncos/staging/shared/backups/cutover/20261001-f60c466`. No staging reseed occurred.

After migration, all 17 monitored original tables retained their values/counts, including the 26 existing audit records. Startup confirmed the exact 84-entry migration manifest with no missing/unexpected entries. API/web/worker are active; HTTPS login responds; unauthenticated protected requests return 401. All 14 active seeded personas passed authenticated session checks. Foreman and partner customer-finance access, and auditor contract approval, return 403. Live payment automation remains explicitly false.

The backup wrapper now uses the scripts from the active release; both post-deployment backup services completed with success/exit 0. The coordinated pre-cutover database was restored into `syncos_cutover_recovery_20261001`, where all 17 baseline table comparisons passed. The private-file archive matches the source files. This is a same-server restore rehearsal, **not** independent total-server-loss recovery.

Authenticated deployed checks ran on the server. An attempted export of server credentials to a local test runner was rejected by automatic approval review; no credentials were exported, and server-side checks completed without that transfer.

Sanitized evidence summaries are stored in `docs/acceptance/evidence-20261001-closure/`. Actual agreements, actual phones, an approved independent recovery destination/owner, and the Passport sandbox remain external gates. No customer delivery, real payment, or completed supervised pilot is claimed.
