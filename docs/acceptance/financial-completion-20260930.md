# Financial completion candidate — September 30, 2026

Status: implemented and undergoing final local verification; **not activated on staging and not signed off for the crew pilot**. The durable managed checkout is `/Users/User/.codex/worktrees/syncos-financial-completion/syncos`, reconstructed from `16164b9` after the earlier temporary checkout disappeared. The main checkout and shared staging/demo data were not reset or reseeded.

## Delivered scope

- Migration 078: immutable approved customer/partner agreement revisions, effective work dates, rate snapshots, payment triggers, calendar-day terms, time zones and retainage. Approval checks the reviewed preview has not changed. Partner pricing must match the work's governing agreement.
- Customer invoices inherit locked prices and retainage; line allocations round consistently in cents. Invoice acceptance starts pending. Net 14 from acceptance stays undated until the actual invoice acceptance event. Internal QC and customer acceptance of production do not fabricate invoice acceptance.
- Migration 079: approved prime package requirements, reviewed supplementary PDFs, immutable ZIP package revisions containing printable invoice/manifest and original accepted evidence, checksum validation, and separate delivery/rejection/resubmission/acceptance receipts. Replay does not duplicate events. Stale or incomplete packages cannot advance; invoice-line tampering and duplicate work fail validation.
- Migration 080: immutable, proof-backed partner invoice triggers. Customer-payment eligibility uses cleared allocated receipts and excludes voided/deleted/reversed facts. No provider automation was enabled.
- Migration 082 makes invoice-event history follow insertion order under concurrent requests.
- Migration 081: immutable administrative production correction history and original export-query provenance. Work-order and partner summaries count reviewed canonical work rather than reference subsets/summaries. Export downloads validate bytes and report stale sources honestly.
- Permission-gated agreement/package screens, approved-retainage invoice creation, and updated downloadable/in-app finance training. A 390-pixel viewport showed no horizontal document overflow; this is browser evidence, not a phone certification.

## Verification evidence

Evidence logs are copied into `evidence-20260930-financial/` after checks finish. Do not add repeat test runs together as additional coverage.

- Both workforce paths: 30 end-to-end tests passed, including safety, individual acknowledgments, shutdown replay, original evidence, quantity correction/reinspection, customer acceptance, approved pricing, invoice package receipt lifecycle and partner financial boundaries. The Sync crew invoice test uses 10% retainage and pays the resulting net amount.
- Older workflows: 31 end-to-end tests passed covering partner onboarding, local-only invitation lifecycle, exports, closeout, retainage release, external-payment concurrency/idempotency, adjustments and access boundaries. Historical P17 payables lacking accepted settlement items are now explicitly tested as blocked; successful payment behavior is covered by the complete P13/crew fixtures.
- Synthetic payment fixtures explicitly include quantity-review pins and approved-term snapshots. This fixture preparation is restricted to disposable local databases and is not an operational backfill.
- Fresh database verification applied all migrations 001–082 and passed. Restoring today's staging database backup and applying 073–082 preserved counts and original-column content hashes across 18 checked business tables, including 16 users, 7 production records, 6 invoices, 6 payables and 26 audit records. No actual acceptance or pricing was backfilled.
- Today's staging database and private-file backups have valid checksums and successful job results. The private-file archive restored two files, 373 bytes total. Database and file backups were taken separately; this is not a coordinated cutover backup.
- Production and full dependency audits reported zero vulnerabilities after updating fflate to 0.8.3. Production uses ZIP creation; archive parsing is tested with the patched library.

## Staging and remaining release gates

Read-only staging verification found release `1d51523f8adc60a3b8ea46b39fc93c250912c2af`, 72 migrations, healthy startup and active API/web/worker. This candidate is newer than that deployment.

1. Run the physical-phone worksheet for a named Sync crew and partner crew: interrupted upload/response, unchanged resend, loaded-session offline replay, browser/device shutdown, work shutdown, text scaling and actual camera formats. Device availability remains unanswered. Cold offline start, storage eviction, HEIC and OS suspension are not certified by desktop emulation.
2. Review the actual executed customer/partner agreements, prime correction policies and invoice package requirements. Synthetic Net 14 tests prove calculation behavior, not the truth of any customer's contract. Obtain the pilot's current agreement/pricing source before operational approvals.
3. The implemented commercial model covers calendar-day triggers and flat retainage. Business-day clauses, unusual exceptions, and per-partial-payment maturity schedules are not certified. Current customer-payment eligibility prorates against gross customer source value and records the earliest funding trigger; confirm the actual relationship's treatment of retained customer funds and later receipt tranches before use. Do not enable automated payment scheduling from this model without that review.
4. Historical demo invoices/payables without canonical lineage remain preserved and blocked. There is no bulk historical repricing/backdating action. Operational equivalents require documented reconciliation, not invented acceptance. Legacy escalation/reassignment parity and every historical application smoke path have not been exhaustively certified by the scoped tests above.
5. Demonstrate offsite total-server-loss recovery and name the backup/alert owner. Local restoration and current scheduled jobs do not establish offsite recovery.
6. Before activation: commit the exact candidate, build under the server runtime, rehearse the upgrade under the actual application role, take a fresh coordinated database/private-file backup, then verify the complete migration manifest, permissions, authentication and both crew paths. Preserve the legacy service shutdown. Roll back code, database and files together; do not assume old code is compatible with newly recorded facts.
7. Passport sandbox/provider mapping and automation remain outside this candidate. No real payments, external invitations or customer package emails were sent.

## Training and continuity

The new click paths are appended to `docs/training/finance-and-controls.md` and generated into the in-app Training guide. Use the existing `docs/pilot/actual-phone-acceptance-2026-09-25.md` worksheet for supervised hardware acceptance. Final checkpoint and bundle metadata should identify the exact commit; uncommitted changes are not a release identity.
