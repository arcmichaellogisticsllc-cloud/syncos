# Remaining engineering closure register — October 1, 2026

This register supersedes blanket claims that all engineering or pilot acceptance is complete. The operating scope remains both Sync employee and partner crews. Preserve shared demo data. Internal QC is not customer acceptance; employee work must not generate partner settlements. Passport automation remains disabled.

## Ten-area disposition

| Area | Implemented or verified in this continuation | Still required to close |
| --- | --- | --- |
| 1. Durable Passport integration | Tenant-scoped persistent account/mapping records; immutable normalized observations; versioned atomic polling checkpoints; leased refresh jobs with duplicate/concurrent/restart protection; review exceptions and audit; prepared-account/mapping/review UI. No provider secrets stored. | Approved sandbox; confirmed provider payload, authentication/signature, ordering/finality and account/payee semantics; actual provider adapter/scheduler and transactional posting integration; provider partial/return/reversal/duplicate/unmatched acceptance. These are not certified by the internal normalized simulator. |
| 2. Financial schedule freshness | Eligibility snapshots fingerprint authoritative source facts. Payment gates reject missing/stale snapshots. Input writers and decisions share a database lock. UI hides stale dates; partial/full paid balance updates the next outstanding due date. | Final deployed verification and governed configuration for actual relationships. |
| 3. Contract exceptions and actual verification | Existing approved business calendars, four-decimal rates, net/gross funding basis and installment clocks retained. Unknown bespoke policies are not guessed. | Named pilot parties and current executed agreements/addenda. Verify rates, dates, triggers, retainage and exceptions, then approve exact configuration. Historical mailbox evidence does not establish current applicability. |
| 4. Prime-specific billing | Existing package completeness, separate delivery/rejection/resubmission/acceptance and correction rules retained; automated path included in certification. | Prime-approved current required documents/policy, an actual complete package comparison and delivery/acceptance evidence. No external message is sent by this review. |
| 5. Mobile/offline | Incident device draft survives reconnect/reload and lost response; unchanged retries yield one incident and audit. Existing production/evidence retry/shutdown paths retained. Training updated. | Actual supported phones, camera originals, background suspension, restarts and both-crew sign-off. Full offline cold start and resumable uploads over the current 20 MiB limit remain unsupported; determine whether they are needed for the selected pilot. |
| 6. Historical reconciliation | Read-only prior review identified ten blocked legacy records matching deterministic demo identities. New gates continue to block unapproved/unlinked amounts. | A finance owner must accept their demo-only disposition or provide source documents for any operational record; no invented links, automatic repricing or deletion. Rerun inventory if records change. |
| 7. Complete certification | Final regression, production builds, focused field/finance and Passport UI checks run on isolated local data. One complete 705-check browser run passed on the final candidate; see evidence below. | A failed/incomplete full run is not closed by adding overlapping pass counts. Deployed checks remain distinct. |
| 8. Independent recovery | Local backup services and timers rechecked; prior coordinated same-server restore preserved. | Independent destination, approved retention and owner; restore without the original VPS; verify files, tenant boundaries and source lineage; measure RPO/RTO. |
| 9. Production operations | Current Hostinger services, health, backup results and migration ceiling reverified. Current operating reference added. | Named incident/recovery owners, tested alert delivery/escalation, maintenance decision and new-candidate deployment verification. Existing backup success alone does not close monitoring. |
| 10. Supervised pilot | Both synthetic crew paths and interruption checks covered in browser tests; actual-phone worksheet/training updated. | Named crews/work and approved agreements, physical sessions, customer acceptance/finance sign-off, resolution of observed issues. A simulated browser workflow is not an actual crew pilot. |

## Candidate boundaries

New migrations 085–088 are additive controls and preparation storage. They do not import provider data, enable money movement, reprice legacy financial records or reseed shared staging. New Passport mappings are immutable; a conflicting mapping is rejected and requires a governed correction design before live integration, not an overwrite.

Staging observed at `f60c466` with migrations 001–084, all three staging services active and startup healthy. Do not treat the local candidate as deployed.

Training sources: `docs/training/field-and-partner.md`, `docs/training/finance-and-controls.md`; regenerate in-app manuals after edits. Physical acceptance: `docs/pilot/actual-phone-acceptance-2026-09-25.md`. Operations: `docs/operations/hostinger-current-operations-20261001.md`.

## Wider product backlog

See `docs/product/remaining-capabilities-20261001.md`: self-service password recovery, customer/service inquiry intake, configurable form templates and full material/reel inventory reconciliation remain visible unfinished capabilities. SSO and magic-link login remain future enhancements. They are not collectively prerequisites for a controlled crew pilot, and they must not be represented as completed features.

## Additional retained-fund boundary found during review

Retainage authorization currently creates a separate payable without its own approved-term revision, payable-item funding schedule or eligibility snapshot. The new freshness gate therefore blocks payment of that release. Creating/authorizing a release and preserving the retained balance are tested; **paying the released funds under an approved contract clock is not complete**. This must be closed with explicit retained-fund trigger/due-date configuration and an end-to-end release-payment test. Do not bypass the gate or label a created release as a fully payable/certified installment.

## Final candidate verification

Application checkpoint: `8100dcf` (following `dea84be`). It is built in the inactive server directory `/opt/syncos/staging/releases/8100dcf`; staging remains on `f60c466` and 84 migrations. Activation is held, not completed.

- **705/705 browser certification checks passed in one uninterrupted final run**, 22.6 minutes, no failures/skips. The final binaries were fixed throughout this run, and only disposable local seed records were reset beforehand.
- **234 regression tests passed**, zero failures/skips. This includes real-database schedule freshness, partial/full paid due-date movement, concurrent input locking, durable queue restart/replay, page rollback and tenant/permission checks.
- **Six Passport/training UI tests passed**, including saved references, mapping approval, review, access denial and responsive preview; **eight final payment tests passed** including a cash change between submission and confirmation. Counts overlap certification where applicable and are not summed into a unique total.
- API, web, worker and database package builds/type checks passed. Production dependency audit reported zero vulnerabilities. The final exact application checkpoint built successfully under the Hostinger runtime.
- A fresh staging database copy upgraded from 84 to 88 migrations under the application role. Seventeen business/audit tables retained their prior contents/counts. Final candidate startup against that isolated database confirms the exact 88-entry manifest and rejects unauthenticated Passport access.
- An earlier broad run had 694 passes, four failures and seven not run: two build-interruption browser failures and two old payment fixtures missing a fresh funding calculation. The fixtures now create source-linked cleared funding and use the real calculation. Subsequent interrupted runs are not certification evidence. Only the final complete 705-pass run closes the clean-run requirement.

Sanitized evidence is in `docs/acceptance/evidence-20261001-remaining/`. No shared staging reseed, live activation, real payment, customer delivery or actual-phone sign-off occurred. The retained-fund payment path remains blocked pending its approved contractual trigger/due-date design and implementation. The other external gates in the table remain open.
