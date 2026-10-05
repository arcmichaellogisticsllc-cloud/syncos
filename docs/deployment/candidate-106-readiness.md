# Candidate through migration 106 — activation and recovery preparation

This is a preparation procedure, not evidence that staging has been activated. Preserve the existing demo and pilot records. SSO, magic-link login and optional automated prime delivery remain product backlog items.

## Build and local certification

1. Finish all source edits. Build database/shared dependencies, API, worker and web. Record the Git checkpoint plus any uncommitted diff hash.
2. Do not clean or rebuild API/web artifacts while certification runs: some integration tests load compiled authorization helpers, and browser tests need a stable web build.
3. Use a new, explicitly synthetic local database for a fresh-install check. Apply every migration in `packages/database/src/migration-manifest.json`. For a new certification database only, install canonical synthetic roles with `packages/database/scripts/seed.js`, then the E2E fixture with `seed-e2e-demo.js`. Do not run these fixture seeders against existing staging/operational data.
4. Run regression checks with the database and local API variables present, the focused workspace browser tests, both crew suites and the full certification suite. A skip or a failed fixture is not a pass. Save failures and their superseding results.
5. Verify the production dependency audit, migration-state checks and training output. Keep phone and provider-delivery acceptance separate.

## Before staging activation

1. Identify the current deployed release, schema ceiling, database, restricted-file root and previous release. Check free space, active services, worker queues and restore access.
2. Arrange a short write pause covering API mutations, worker jobs, schedulers and upload finalization. Capture PostgreSQL and restricted originals together, recording release SHA, complete migration list and checksum manifest. Include unfinished database-backed upload chunks. Do not rely on unrelated DB/file backups taken at different write states.
3. Verify the backup artifact and restore it into a separate target. Fail the check if a referenced private original is missing or mismatched; do not silently skip the reference or fabricate its contents.
4. Migrations 103–106 add explicit company delegation/reporting permissions, immutable prepared-posting lineage and receivable mappings, and the material discrepancy queue. Earlier 099–102 migrations remain required. Existing records are not repriced or reseeded. Confirm the exact manifest rather than an old hardcoded migration number.
5. Keep `INQUIRY_NOTIFICATION_DELIVERY_ENABLED=false` and `WORKFLOW_NOTIFICATION_DELIVERY_ENABLED=false` until the email sender, authentication, delivery errors and staging recipient allowlist have been verified. Public channels must be deliberately configured and enabled with active authorized owners and a reviewed privacy notice. Password recovery requires its own enabled switch and verified sender.
6. Deploy the built candidate, apply migrations once under the write pause, verify startup health and migration state, then perform authorized-role and both-crew smoke checks before reopening writes.
7. Enable external delivery only after the corresponding configuration acceptance. Passport automatic posting and real payment execution remain disabled pending the confirmed provider contract and sandbox acceptance.

## Rollback boundary

The migration verifier rejects unexpected migrations. Therefore an old release whose manifest stops before 106 is **not** automatically a valid rollback against a 106 database, even though these changes are largely additive. Do not claim that switching a release symlink is sufficient.

Prefer a tested forward repair. If a full coordinated restore is required, first freeze writes, retain all post-backup records and private originals, and obtain an explicit business disposition for those later writes. Restore into a new database and private-file root, verify them, and only then redirect services. Do not delete new inquiries, forms, stock movements or financial records to make an older schema fit. No destructive down migration is supplied.

## Available local recovery rehearsal

`scripts/recovery/rehearse-local.js` accepts only explicitly named synthetic localhost source databases and creates a new `syncos_recovery_…` database plus a private temporary file root. It holds a repeatable-read snapshot while exporting the database and copying metadata-referenced originals, verifies each original's size and SHA-256, restores the dump transactionally, and compares every table count and the file metadata. It refuses an existing target and preserves failure artifacts.

Supply `DATABASE_URL`, `RECOVERY_DATABASE`, and `SYNCOS_RESTRICTED_FILE_STORAGE_DIR` through the local environment. The script never changes the source records, deletes old backups or contacts the production VPS. Its evidence is a local recovery rehearsal, not proof of an independent offsite copy, total-server-loss recovery, production RPO/RTO, production authorization after redirect, or retention policy enforcement. The candidate additionally passed local HTTP startup, authenticated private-original downloads/checksums, tenant/organization denial and audit checks against the separate restored copy.

## Acceptance still requiring external participation

- Actual phones for both workforce types: camera formats, large originals, network changes, suspension, browser/device restarts, offline replay and shutdowns.
- Configured email delivery and verified recovery links/operational reminders.
- Priority sandbox product/authentication, account/payee mapping, confirmed response/finality/signature contract and observed payment outcomes.
- Independent backup destination and credentials, retention evidence, named incident owner and a restore without the original server.
- Actual customer/partner agreements, prime package requirements and decisions on preserved historical exceptions.
- Controlled staging activation and supervised pilot sign-off for the exact deployed candidate.

## Additional candidate-106 checks

- Verify all 106 migration names against the manifest. Migrations 103 and 106 add only the explicit company form-delegation and inventory-report permissions to active partner-admin roles; no tenant-wide inventory or form authority is granted.
- Verify the served offline shell contains the new capture script and updated worker cache version. Prepare maps again after account verification. Keep device-only drafts until reconciliation confirms a server draft.
- Exercise a company administrator without write permissions and one with explicit delegation/reporting permissions. Verify operator-disabled form assignments remain disabled.
- Keep prepared posting synthetic-only. The rehearsal accepts explicitly named localhost synthetic databases; live endpoints and workers must not be pointed at the rehearsal as a shortcut. Actual provider integration acceptance is a separate gate.
- Run `scripts/acceptance/rehearse-schema-upgrade.js` only against a new empty localhost database named `syncos_synthetic_upgrade_…`; it creates a migration-102 synthetic baseline and checks business-row preservation through the current schema.
- Fill a copy of `external-evidence-template.json` with reviewed evidence, never credentials. Run `node scripts/acceptance/check-external-evidence.js <packet.json>`. Passing this checks completeness/hashes only and still requires human operational verification.
- Local certification may set `SYNCOS_E2E_VIDEO=off` to reduce resource contention. Screenshots on failure and the same assertions remain enabled. Physical-phone acceptance is still separate.

## Final local check sequence

Use the candidate with its exact source fingerprint and set local-only database/API/web settings before running:

1. `npm test`, supplying the synthetic database variables for commercial, role-upgrade and demo-repair tests, plus `SYNCOS_PRODUCT_TEST_API_URL` and the synthetic signing secret. Treat skipped database/HTTP tests as incomplete.
2. `npm run e2e:certification`, after seeding only the isolated test database. Set `API_BASE_URL`, `WEB_BASE_URL`, `DATABASE_URL` and the synthetic signing secret to that candidate.
3. `WEB_BASE_URL=<local web> npx playwright test --config tests/passport-ui/playwright.config.ts`; this covers UI failure recovery, finance controls, older QC selection and training.
4. Run the company-field and offline-capture browser configurations. The latter uses a local static server on 3478 and synthetic intercepted API responses; it is explicitly not phone or server workflow certification.
5. Run additional top-level E2E specifications outside the certification script after the main run completes, resetting only the synthetic fixture first. Do not run two seeders against shared test auth fixtures concurrently.
6. Keep the raw logs, source fingerprint, migration evidence, restored-original hashes and external acceptance packet with the candidate. Never publish a partial or interrupted suite as a pass.

Production-export generation uses rendering version 2. Older artifacts remain preserved; regenerate stale files to obtain complete multi-page detail. The annotation PDF is an annotation-coordinate summary; the original map remains separately preserved.
