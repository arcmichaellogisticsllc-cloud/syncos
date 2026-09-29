# Pre-payment acceptance — 2026-09-29

The engineering candidate is on `codex/pre-payment-acceptance-20260929`, based on 228eac1. The commit containing this report identifies the tested source. Priority automation remains disabled. This report is not physical-device or payment-provider certification.

## Implemented safeguards

- Evidence is saved to scoped device storage before transmission, survives reload, and retries with the original request identity. Server replay compares content hash and metadata; an identical retry produces one evidence record and one audit entry. JPEG, PNG, PDF and MP4 are capped at 20 MiB decoded; malformed content and changed retries fail.
- Completed safety reviews are immutable. Changed conditions require a new JSA revision; new production remains blocked until completion. Foreman certification does not fabricate each worker's acknowledgment. Production audit history retains the JSA used for the record. Active crew/work-order shutdowns block new production and require authorized release.
- Partner payment advancement requires current customer acceptance, a matching accepted-production financial source, accepted quantity, locked partner rate, and a verified executed agreement effective for the work. Active payable totals cannot exceed the settlement budget. Employee production cannot create partner debt.
- External transaction observations are retained in a review inbox. Concurrent duplicates return the same observation. Unmatched, conflicting and returned transactions require review and cannot post money. Explicitly reviewed matching observations can link to already recorded payments; linking and replay do not create another payment. Provider authentication, polling/webhooks and actual Passport mappings await sandbox certification.
- Role/tenant/crew boundaries remain server-enforced. Payment observation controls are hidden from field users. Logout clears device queues as documented; crews must finish pending synchronization before signing out.

## Verified results

Evidence is in [evidence-20260929](evidence-20260929/).

| Check | Observed result |
| --- | --- |
| Workspace build and final API/web builds | Passed |
| Full unit suite, including database preservation tests | 199 passed; 0 failed; 0 skipped |
| Complete six-file workflow run | 49 passed |
| Added safety revision/shutdown and upload suite | 12 passed, including two additional cases |
| Final payment/reconciliation suite | 8 passed, including amount tampering, link retry and late return checks |
| Concurrent observation deliveries | Eight simultaneous identical deliveries produced one observation and one audit; conflict retained separately; no payment posted |
| Fresh database migration verification | All migrations 001–072 passed |
| Dependency audit, production and development | Zero reported vulnerabilities |
| Local candidate recovery | 180 tables: all counts and sorted row-content hashes matched; 16 private files matched; replay after restore added no observation, audit or payment |
| Hostinger recovery rehearsal | Restored separate database and identical private files from protected backup; 179 original table counts matched |
| Hostinger restored-copy upgrade | Migrations 070–072 passed under application role; original business-table counts unchanged |

The 49-test run plus the added cases cover 51 distinct targeted browser tests; later runs overlap the original tests and must not be added as separate coverage. These are scoped acceptance checks, not a claim that every historical application test or every device has passed.

Both crew types reached customer-accepted billing and cash allocation using their actual test field records. The partner path continued to a funded payable and one externally recorded synthetic payment. Tests covered corrections/reinspection, role denial, tenant isolation, immutable history, lost upload responses, reload, offline production replay, and stop-work enforcement. No actual money moved.

## Preserved legacy financial exceptions

The staging recovery copy contains six historical seeded subcontractor payables: CPAY-CR-001 and CPAY-ACT-001 through CPAY-ACT-005. Their numbers and states match the existing demo seed definitions. Five are active; CPAY-ACT-005 is voided. All lack the canonical partner-organization/accepted-source trace required by the new controls, including the legacy record labeled payment_ready.

No records were deleted, reseeded, relabeled, paid, or given fabricated acceptance/agreement evidence. The new approval/readiness/payment guards reject advancement of these incomplete legacy payables. Preserve them as historical demo fixtures; use the verified complete workflow to create traceable pilot transactions. Before any provider automation, explicitly exclude demo/test tenants and transactions and resolve any equivalent exception in real operational data. A stored payment_ready label is not evidence of eligibility.

## Remaining acceptance gates

1. Physical-phone execution has not occurred. Device availability was requested and remains unconfirmed. Run the [phone worksheet](../pilot/actual-phone-acceptance-2026-09-25.md) for both crews, covering interrupted uploads, resend, loaded-session offline replay, browser/device shutdown and work shutdown. Browser emulation cannot sign this off. Cold offline startup, storage eviction, HEIC capture and OS upload suspension remain device-specific limitations to observe.
2. Stage the exact candidate using the [activation requirements](staging-activation-requirements.md), with a fresh coordinated backup before cutover. Existing staging was still ea41c37 at the recovery rehearsal. The restored-copy upgrade is not a live deployment.
3. Offsite total-server-loss recovery has not been demonstrated by this work; daily local backups and the isolated VPS restore do not prove it. Identify the operational owner and retention/restore requirement before field release.
4. Passport sandbox certification and verified production account/payee mappings remain prerequisites to automatic reconciliation. No provider/live payment automation is enabled by this candidate.

The work is not signed off as fully field-ready while these gates remain open.
