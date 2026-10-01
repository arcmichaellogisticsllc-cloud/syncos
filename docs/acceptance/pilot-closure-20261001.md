# Pilot closure review — October 1, 2026 UTC

Working candidate: `codex/financial-completion-20260930`, based on `e58f592`. This document is an evidence register, not a completed-pilot certificate. Staging activation and physical-device testing have not occurred in this review.

## Implemented in this candidate

- Approved calendar/business-day terms with explicit holidays and a bounded holiday-calendar horizon. Monday–Friday is the supported business week. Unknown calendars are rejected rather than guessed.
- Four-decimal approved rates and decimal-safe quantity extension; monetary amounts remain cents. Existing locked prices are not reapproved or repriced.
- Explicit partner funding basis: gross accepted customer value, or customer invoice net of retainage. This does not authorize release of partner retainage.
- Separate funded installments and due dates for distinct cleared receipt allocations. A dated eligibility snapshot records the schedule; outstanding display applies recorded payments earliest-due-first. Recalculate after changed cash facts.
- Invoice archive manifests preserve the calendar and funding fields; printable invoices distinguish business from calendar days.
- Billing document requests now have a scoped body limit large enough for the advertised 20 MiB attachment after base64 encoding. Browser/API tests use a 256 KiB synthetic PDF to cross the former default parser limit.
- Workflow reassignment validates the role in the current tenant and removes stale user assignments; escalation and reassignment cannot reopen completed/cancelled/archived tasks.
- Remote database/file backup scripts invoke the AWS CLI correctly, protect locally created artifacts with restrictive permissions and reject invalid retention counts. Mocked remote upload tests verify failure propagation; they do not certify an actual remote provider.

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
| Staging activation | Exact candidate built and verified under server Node version; fresh coordinated DB/files backup; migrations with services quiesced; health, permissions, audit and both crew workflows after activation. |
| Passport | Approved sandbox, account/payee mapping, replay/partial/adjustment/unmatched tests, then a separate enablement decision. Live automation stays disabled. |

Read-only server inspection found daily local backups with retention set to seven, both backup timers active, and no configured remote destination. Those backups share the VPS failure domain. Provider snapshots and a local restore rehearsal do not establish the offsite total-loss gate.

## Verification checkpoint

- Regression suite: 230 passed, zero failed/skipped, including workflow role completion/ownership and both remote backup script branches.
- Targeted financial E2E: 13 passed, including four-decimal invoice persistence, independent receipt due dates and denied foreman access. A separate browser agreement-form test passed.
- Fresh migration verification: 001–084 passed. Restored staging upgrade preserved original values/counts across 17 checked tables. Rate-column textual scale changed from two to four places in two populated tables; casting only those columns to their original scale reproduced the original hashes. This is value preservation, not byte-identical numeric formatting.
- Production dependency audit: zero reported vulnerabilities. Full audit and broad browser certification results will be recorded at final checkpoint.
- Broad browser run is in progress. Two legacy demo production expectations were corrected to assert the safety-scope block; happy-path production remains covered by complete crew tests. Do not interpret this checkpoint as full browser certification.
- Read-only live inspection: current release `1d51523f8adc60a3b8ea46b39fc93c250912c2af`, 72 migrations, startup healthy; API/web/worker active, legacy services inactive; API/web/database/Redis bind to loopback. Today's database and private-file backup checksums passed. No cutover has been performed.
