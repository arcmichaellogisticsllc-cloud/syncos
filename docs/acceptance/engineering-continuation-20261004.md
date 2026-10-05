# Engineering continuation — local candidate, October 4–5, 2026

This continuation is not full completion of the eighteen-area backlog and is not deployed. Database mutations target isolated localhost databases: `syncos_remaining_test`, `syncos_certification_20261004_continuation`, `syncos_migration_test_20261004_097`, `syncos_restore_test_20261004_097` and `syncos_migration_test_20261005_098`. New databases were created solely for certification, fresh-install verification and recovery; staging and existing operational/demo records are preserved. Migration 097 adds temporary upload storage and history indexes; migration 098 widens the final evidence-original constraint to 100 MiB without altering existing records. No external email or payment is sent.

## Implemented locally

- Device form drafts scoped by verified user, tenant and immutable version; explicit restore/review, seven-day expiry and logout cleanup.
- Tenant-scoped keyset history for forms, responses, inquiries and material movements, including equal-timestamp ordering and literal search. Older related records can be found through dedicated selection search.
- Evidence originals up to 100 MiB: bounded chunks, deterministic retry identity, SHA-256 verification, ownership, incomplete/corrupt rejection, per-user pending quota, seven-day expiry, worker cleanup and completed-original deduplication. Finalization is limited to one buffered original per API process; a busy response preserves received chunks for retry. Smaller originals retain the existing direct path.
- New evidence must pass active assignment and both record-level and work-order safety-stop checks before insertion. Already recorded evidence can still be recognized on retry.
- Read-only offline recovery shell with one-hour same-session context, assignment labels, supported pending-device visibility, expiry, logout cleanup and online revalidation. It caches static recovery assets only, not authenticated API responses. Full cold-start offline editing/maps remain open.
- Production queue saves wait for transaction completion and close device database handles. Field-page initialization avoids duplicate initial assignment fetches.
- Repository-scoped web build tracing.

## Verification

- API, worker and production web builds passed. API was rebuilt after adding bounded finalization.
- Final post-098 regression run with every database variable supplied: **252 passed, zero failed, zero skipped**. Earlier evidence also records the separate 250-pass run and two preservation checks.
- Final focused UI suite with controlled API responses: **7 passed**, covering restricted controls, form creation/submission, retry preservation, phone-sized inventory layout, draft reload/version/user separation, and offline shell isolation/logout.
- Integrated field suite at `e93ff6e`, before migration 098: **17 passed** against the local API and production web build. This includes lost-response photo recovery, resumed multipart originals, incident recovery, offline replay, revoked authorization, work shutdown, immutable submitted reports, partner isolation, evidence-readability gates and quantity reconciliation.
- An earlier integrated upload test caught the default JSON parser rejecting chunks. A route-specific 2 MiB parser fixed the transport without widening ordinary API request limits.
- The first full 706-test certification attempt was interrupted: **19 passed, 2 failed, 685 did not run**. It encountered browser teardown/display errors. This attempt is retained as failed/incomplete evidence, not certification.
- Fresh full existing-application certification against application commit `e93ff6e`: **706 passed, zero failed**, completed October 5 UTC. This supersedes the interrupted attempt for that local checkpoint. It preceded migration 098; the focused maximum-size and regression suites were rerun after that follow-up. It does not prove unimplemented features or physical/deployed acceptance. Counts from the focused and full suites overlap and must not be summed.
- A follow-up 100 MiB synthetic-original browser test exposed the older 20 MiB final-storage constraint. Migration 098 corrects it. The five-test setup/recovery sequence then passed with `SYNCOS_E2E_UPLOAD_BYTES=104857600`: lost response, reload, received-part reuse, one stored original and matching checksum. Playwright required a disk-backed fixture because its in-memory file injection is capped at 50 MiB. This is desktop transport acceptance, not camera-format/readability or physical-phone certification.
- Fresh empty-database installation passed all **98 migrations**. Local startup health returned HTTP 200 after the change. A local synthetic database dump/restore preserved 12 upload sessions, 5 chunks with identical content fingerprint, 6 evidence originals and 448 audit entries. That restored database was then upgraded to 098 with identical session/chunk/original/audit counts and chunk fingerprint. This is database recovery evidence, not a coordinated file/server or offsite recovery claim. A future rollback must preserve larger originals; do not simply reinstate the 20 MiB constraint or delete evidence to fit it.
- Evidence is saved in `docs/acceptance/evidence-20261004-continuation/`. No physical-phone, independent offsite recovery or staging activation result is asserted.

## Items not closed by this continuation

1. Full cold-start offline editing/maps and operational device acceptance.
2. Resumable-upload real-device/background/concurrency acceptance.
3. Field-scoped forms and their device acceptance.
4. Field/partner inventory and form assignment views/actions.
5. Public customer intake, routing and acknowledgment.
6. Broader record-volume performance and any remaining application-wide history limits.
7. Operational alert routing/delivery/escalation implementation and provider acceptance.
8. Deployed email/password recovery delivery.
9. Actual executed agreement verification.
10. Prime-specific package/delivery acceptance.
11. Authorized historical reconciliation.
12. Actual Passport adapter, mapping corrections, scheduling/posting and sandbox acceptance.
13. Final application-wide permissions/audit certification and role grants.
14. Exact-candidate full integrated certification and training walkthrough.
15. Physical phones and both crew leads.
16. Independent offsite total-loss recovery and operational ownership.
17. Coordinated backup/rehearsal/staging activation and supervised pilot.
18. SSO/magic-link/optional prime integrations remain visible; provider choices and implementation are not supplied by this continuation.

Current agreement locations, phones/crew leads, independent backup destination/owner and protected provider configuration locations were requested. No answer has been received at this checkpoint. Missing external inputs do not turn unfinished independent engineering into completed work.
