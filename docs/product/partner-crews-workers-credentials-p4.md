# SyncOS P4 - Partner Crews, Workers, Credentials & Secure Headshots

## 1. Baseline Branch and Commit

- Branch: `feat/partner-crews-workers-credentials-p4`
- Baseline HEAD: `3fd38c7117e5c0c4bedf7a24a50cba845de68ef8`
- Repository root: `/Users/User/syncos`

## 2. Existing Objects Reused

- Partner company identity remains `organizations`, certified in P1.
- Operational capacity remains `capacity_providers`.
- Canonical workforce identity reuses existing `workers`.
- Canonical crew identity reuses existing `crews`.
- Partner personas, active tenant membership, and organization-scoped roles reuse P2 `users`, `tenant_users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `scope_type`, and `scope_id`.
- P3 compliance records and restricted-evidence metadata remain separate from P4 personnel evidence.

## 3. Canonical Worker Model

P4 extends `workers` with Partner Organization ownership, worker role/reference, and review status metadata. Sensitive and versionable profile facts live in `partner_worker_profiles`.

## 4. Sensitive Worker PII Rules

Partner Admin can access only its own Organization-scoped Worker records. Partner Foreman receives only safe roster fields. Home address, emergency contact, driver-license metadata, credential evidence, internal notes, and file storage keys are excluded from Foreman responses and event payloads.

## 5. Driver-License Model

No full driver-license number is stored. P4 stores state/class, expiration date, verification status, and last four only. Evidence is stored as restricted personnel file bytes where submitted.

## 6. Headshot Model

Headshots are versioned records in `partner_worker_headshots` linked to `partner_restricted_file_objects`. One non-superseded headshot per Worker is enforced. Replacement preserves prior history through supersession fields.

## 7. Actual Secure File-Byte Architecture

P4 adds `partner_restricted_file_objects` and stores actual bytes in a server-owned local restricted directory controlled by `SYNCOS_RESTRICTED_FILE_STORAGE_DIR`, defaulting to `/private/tmp/syncos-restricted-files`. Storage keys are server-generated and never accepted from the client.

## 8. Headshot Privacy and Authorization Rules

Headshot access is authorized at request time. Partner Admin can access its own Organization's Worker headshots. Partner Foreman can access only approved headshots for active members of the Foreman's linked Crew. No public or permanent raw URL is returned.

## 9. Credential Model

`partner_worker_credentials` stores structured credential type, issuer, safe identifier last four, dates, required flag, status, evidence link, reviewer fields, and supersession history.

## 10. Credential Requirement Model

P4 does not make every credential globally mandatory. Required credentials block readiness only when the submitted credential row is marked required or when the driver/operator model requires a driver-license credential.

## 11. Crew Model

P4 extends canonical `crews` with Partner Organization ownership, lifecycle status, suspension metadata, and target staffing level. Initial aerial Crew default staffing is four.

## 12. Crew Membership Model

`partner_crew_memberships` preserves membership history. Active membership uniqueness prevents duplicate active Crew/Worker membership and more than one active primary Worker membership.

## 13. Foreman / Alternate Foreman Model

Foreman and Alternate Foreman are represented by active Crew membership roles. The model enforces one active Foreman and one active Alternate Foreman per Crew.

## 14. Partner Foreman User-to-Worker Link

`partner_worker_user_links` explicitly links an authenticated tenant user to a canonical Worker. Foreman roster access also requires an active Foreman/Alternate Foreman Crew membership.

## 15. Worker Status and Versioning

Worker review status is stored separately from canonical Worker active/inactive status. Approved Worker profile changes supersede profile history rather than erasing reviewed state.

## 16. Crew Lifecycle vs. Readiness

Crew lifecycle remains on `crews.lifecycle_status`; readiness is derived at request time and is not stored as a lifecycle state.

## 17. Worker Readiness Evaluator

Worker readiness checks active status, profile completeness/approval, approved current headshot, required credential verification, credential expiration, driver-license requirements, and suspension/inactivation.

## 18. Crew Readiness Evaluator

Crew readiness checks lifecycle, target staffing, active members, one Foreman, and each active member's Worker readiness.

## 19. Readiness Blockers

Implemented blockers include `worker_profile_incomplete`, `worker_profile_unverified`, `worker_headshot_missing`, `worker_headshot_unverified`, `worker_headshot_correction_required`, `worker_credential_unverified`, `worker_credential_expired`, `worker_driver_license_missing`, `worker_driver_license_unverified`, `worker_driver_license_expired`, `worker_suspended`, `worker_inactive`, `crew_staffing_incomplete`, `crew_foreman_missing`, `crew_foreman_unapproved`, `crew_member_not_ready`, `crew_suspended`, and `crew_inactive`.

## 20. Partner Attestation

P4 records Partner attestation metadata in `partner_workforce_attestations` for Worker, Crew, and headshot scope. It records actor, timestamp, version, and scope without biometric consent language.

## 21. Partner Admin Permissions

Partner Admin receives own-Organization permissions for Worker read/create/update/submit, headshot read/submit, credential read/submit, Crew read/create/update, membership manage, Foreman assignment, readiness read, and attestation submit.

## 22. Partner Foreman Permissions

Partner Foreman receives only `partner_workforce.foreman_roster.read`, plus existing P2 context/action permissions. It cannot create/update Workers, access credential evidence, or manage Crews.

## 23. Internal Review Permissions

Internal review uses `partner_workforce.review` and `partner_workforce.evidence.review`. These are not in the Partner-scoped permission list and are not granted to Partner roles.

## 24. API / Route Map

- Partner Admin: `/partner-workforce/me/workers`, `/partner-workforce/me/workers/:workerId`, `/headshots`, `/credentials`, `/readiness`, `/partner-workforce/me/crews`, `/members`, `/foreman`, `/alternate-foreman`, `/roster`.
- Partner Foreman: `/partner-workforce/foreman/crew`, `/partner-workforce/foreman/crew/roster`, `/partner-workforce/foreman/headshots/:headshotId/bytes`.
- Internal review: `/partner-workforce/organizations/:organizationId/.../review` and `/file-objects/:fileObjectId/bytes`.

## 25. Event and Audit Behavior

Writes use `executeWriteAction`. Restricted personnel evidence access uses `appendAuditLog`. Event/audit payloads include safe identifiers, status changes, categories, actor, MIME type, size, and checksum only.

## 26. Restricted Personnel Evidence Rules

Client-supplied storage keys, paths, public URLs, object keys, and buckets are rejected. File bytes and storage keys are never emitted in events/audit payloads or normal metadata responses.

## 27. Migrations / Database Changes

Added migration `043_partner_workforce_credentials_foundation.sql`:

- Extends `workers` and `crews`.
- Adds `partner_worker_profiles`.
- Adds `partner_restricted_file_objects`.
- Adds `partner_worker_headshots`.
- Adds `partner_worker_credentials`.
- Adds `partner_crew_memberships`.
- Adds `partner_worker_user_links`.
- Adds `partner_workforce_attestations`.

## 28. Fresh Migration Result

PASS. Fresh disposable database `syncos_partner_workforce_p4_verify2` applied the full migration chain through `043_partner_workforce_credentials_foundation.sql`, ran seed, and passed database verification.

## 29. P3-to-P4 Upgrade Result

PASS. Disposable upgrade database `syncos_partner_workforce_p4_upgrade2` was migrated through certified P3, seeded with representative Partner Organization, capacity provider, Partner persona, and P3 compliance records, then upgraded through migration 043. Existing P1/P2/P3 records survived, P4 tables started empty/safe, and seed rerun remained idempotent.

## 30. Security and Isolation Tests

Source regression tests added in `tests/partner-workforce-credentials.test.js`. Runtime E2E coverage added in `tests/e2e/partner-workforce-credentials.spec.ts`.

## 31. Headshot Byte-Storage Tests

The P4 E2E suite uploads synthetic PNG bytes, verifies DB storage metadata, downloads authorized bytes, rejects SVG and client storage references, and verifies cross-tenant/cross-Partner denial.

## 32. Global Certification Registration

`npm run e2e:certification` now includes `tests/e2e/partner-workforce-credentials.spec.ts`. `tests/regression.test.js` protects that registration.

## 33. Exact Validation Results

- `npm test`: PASS, 30/30.
- `npm run typecheck`: PASS.
- `npm run typecheck -w @syncos/api`: PASS.
- `npm run build -w @syncos/api`: PASS.
- `npm run build -w @syncos/web`: PASS.
- Fresh migration/database verification on `syncos_partner_workforce_p4_verify2`: PASS.
- P3-to-P4 upgrade verification on `syncos_partner_workforce_p4_upgrade2`: PASS.
- `npx playwright test tests/e2e/partner-domain-scope.spec.ts`: PASS, 8/8.
- `npx playwright test tests/e2e/partner-personas-permissions.spec.ts`: PASS, 8/8.
- `npx playwright test tests/e2e/partner-compliance-onboarding.spec.ts`: PASS, 5/5.
- `npx playwright test tests/e2e/partner-workforce-credentials.spec.ts`: PASS, 5/5.
- `npm run security:smoke`: PASS.
- `npm run organization:smoke`: PASS.
- `npm run sprint4:smoke`: PASS on clean non-demo database `syncos_partner_workforce_p4_smoke`. The same smoke intentionally fails on the E2E demo-seeded database because demo seed creates project records.
- `npm run e2e:hydration`: PASS, 27/27.
- `npm run e2e:boundaries`: PASS, 22/22.
- `npm run e2e:personas`: PASS, 4/4.
- `npm run e2e:action-state-personas`: PASS, 140/140.
- `npm run e2e:lifecycle`: PASS, 4/4.
- `npm run e2e:certification`: PASS, 587/587. Output proved execution of all five `tests/e2e/partner-workforce-credentials.spec.ts` P4 tests.
- `git diff --check`: pending final repository check.

## 34. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/security/permission.guard.ts`
- `apps/api/src/routes/partner-workforce.controller.ts`
- `packages/database/migrations/043_partner_workforce_credentials_foundation.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/partner-workforce-credentials.spec.ts`
- `tests/partner-workforce-credentials.test.js`
- `tests/regression.test.js`
- `package.json`
- `docs/product/partner-crews-workers-credentials-p4.md`

## 35. Explicitly Excluded P5+ Scope

No Partner Portal UI, Project assignment, Work Orders, vehicle assignment, mobilization, Notice to Proceed, JSA, production, QC, corrections, incidents, settlement, payable, payment, payroll, closeout, performance scoring, PDF generation, or e-sign work was started.

## 36. Risks and Limitations

- P4 secure file bytes use local restricted filesystem storage. A production object-storage adapter remains a later hardening task.
- Image validation uses magic-byte checks for JPEG/PNG/WEBP and does not perform image resizing or EXIF stripping.
- Foreman user-to-Worker linking exists structurally, but no external UI or invitation workflow is included.
- Readiness is base workforce readiness only and does not authorize mobilization or production.

## 37. P4 Certification Status

CERTIFIED

## 38. GO / NO-GO Recommendation for P5

GO for planning P5 after P4 is reviewed and committed. P5 should remain limited to Agreements, Work Orders, and vehicle assignment foundations and must not start Partner Portal UI or mobilization/production workflows.
