# Partner Mobilization Readiness, Approval, and Notice to Proceed - P6

## 1. Baseline Branch and Commit

- Branch: `feat/partner-mobilization-readiness-p6`
- Baseline HEAD: `bd772b89f0b49abbdf60daefeba80041528cfa69`

## 2. Existing Objects Reused

P6 reuses canonical P1-P5 objects: `organizations`, `capacity_providers`, Partner personas and scoped `user_roles`, P3 compliance tables, P4 `workers`, `crews`, headshots, credentials, Crew memberships, Foreman links, P5 `contracts`, agreement versions, `work_orders`, Work Order versions, Crew assignments, vehicle assignments, operator authorizations, vehicle condition records, events, audit logs, and `executeWriteAction`.

No Partner Portal UI, duplicate Partner table, duplicate Crew/Worker table, Production, QC, Settlement, or Payable object was added.

## 3. Mobilization Assignment Context

The P6 context resolves one canonical Work Order assignment from `partner_work_order_versions`, active `partner_work_order_crew_assignments`, optional `partner_vehicle_assignments`, governing `partner_agreement_versions`, canonical Project, Partner Organization, capacity provider, Crew, map/work package, and timezone. Client-supplied Organization, Work Order, Crew, or vehicle IDs are treated as selectors and are revalidated against canonical P5 relationships.

## 4. Readiness Evaluation Model

`mobilization_readiness_evaluations` stores immutable derived snapshots with tenant, Project, Work Order, Work Order version, Partner Organization, capacity provider, Crew assignment, Crew, vehicle assignment, evaluator version, status, counts, trigger, actor, and supersession history.

## 5. Readiness Check Result Model

`mobilization_readiness_check_results` stores each requirement result with code, category, status, severity, override policy, external-safe detail, optional internal detail, source type/id/version/observed state, override reference, and timestamp.

## 6. Requirement Policy Model

`mobilization_requirement_policies` defines typed requirement policy metadata. P6 also adds `mobilization_context_requirements` for assignment-scoped project/customer requirements such as housing confirmation or customer badge requirements.

## 7. Requirement Catalog

Implemented evaluator categories:

- Partner eligibility and capacity-provider relationship.
- P3 Partner company compliance readiness.
- Governing MSA version status/artifact.
- P5 Work Order version status, rate schedule, map/work package, and scope.
- P4 Crew/member/Foreman/Worker/headshot/credential readiness.
- Vehicle assignment, pre-assignment condition, and approved operator.
- Assignment-scoped project/customer requirements.

## 8. Blocker Severity / Override Policy

Checks are classified as non-overrideable, overrideable with expiration, or warning-only. Overrides are scoped to one Work Order version and Crew assignment.

## 9. Non-Overrideable Requirements

Non-overrideable checks include Partner eligibility, P3 compliance readiness, MSA effective state, Work Order active state, rate/map/scope, Crew base readiness, Worker readiness, approved Foreman, vehicle assignment validity, condition record, and approved operator.

## 10. Overrideable Requirements

P6 permits narrowly scoped overrides for administrative requirements only:

- `housing_confirmation`
- `reporting_acknowledgment`
- `customer_badge_or_clearance`
- `safety_orientation_acknowledgment`

Each override requires internal permission, reason, expiration, and context scoping.

## 11. Warning-Only Requirements

Warning-only checks include optional Alternate Foreman missing and insurance expiring soon where represented.

## 12. Readiness Status Rules

Statuses:

- `not_evaluated`
- `in_progress`
- `blocked`
- `conditional`
- `ready`

Partner users cannot set readiness. Readiness is separate from mobilization decision and production-start authorization.

## 13. Mobilization Decision Model

`mobilization_decisions` stores current and historical decisions:

- `pending`
- `approved_to_mobilize`
- `conditionally_approved`
- `hold`
- `revoked`

Decisions reference a readiness evaluation and preserve supersession history.

## 14. Conditional Approval Rules

Conditional approval requires exact external conditions and no unresolved non-overrideable blocker. Conditional approval does not by itself authorize production start.

## 15. Hold / Revocation Rules

Hold and revocation preserve prior decision history. Hold/revocation also places any current Notice and production-start authorization on hold.

## 16. Override Governance

Only internal users with `partner_mobilization.override` may create overrides. Partner Admin and Partner Foreman cannot create, extend, revoke, or clear overrides. Expired or revoked overrides no longer satisfy checks.

## 17. Notice-to-Proceed Model

`notice_to_proceed_versions` stores structured Notice versions with notice number, version, exact context, readiness evaluation, mobilization decision, production-start date/time/timezone, map/work package, work area, external instructions, external conditions, issuer, status, supersession, and hold/revocation state.

P6 does not render a PDF.

## 18. Production-Start Authorization Model

`production_start_authorizations` stores explicit start authorization state:

- `not_authorized`
- `scheduled`
- `authorized`
- `held`
- `revoked`
- `superseded`

It identifies date, time, timezone, map/work package, work area, and issuing Sync actor. It does not create a Production record.

## 19. Approval-to-Mobilize vs. Production-Start Separation

Readiness evaluation, approval to mobilize, Notice issuance, and production-start authorization are separate records. Work Order activation and Crew readiness do not automatically authorize mobilization or production.

## 20. Partner Acknowledgment

`notice_acknowledgments` records Partner Admin receipt and Partner Foreman operational instruction acknowledgment. Acknowledgment does not approve, amend, activate, or change commercial terms.

## 21. Automatic Reevaluation / Invalidation

P6 now has two automatic invalidation paths:

- Canonical audited writes use `executeWriteAction`; critical P3/P4/P5/P6 source events are inspected in the shared write-action transaction and create a P6 source-event invalidation snapshot automatically.
- The SyncOS Worker runs a recurring P6 expiration scan that detects pure time-based invalidation for current P6 contexts.

Automatic source-write invalidation creates a new blocked readiness evaluation, records source IDs/state, places the current mobilization decision on hold when one exists, holds the current Notice/production-start authorization, writes P6 events/audit, and records an idempotency row in `mobilization_source_event_invalidations`.

Critical authorization paths still synchronously reevaluate before approval and Notice issuance.

### Transactional Source-Write Invalidation

The P6 hook in `packages/shared/src/write-action.ts` runs only after a canonical source write has successfully persisted through `executeWriteAction`. It uses an explicit source-event allowlist and ignores P6 downstream hold/readiness/start events so it does not recurse. The hook receives safe canonical IDs from typed event payloads, resolves the current P6 assignment context from database relationships, rejects missing tenant scope and cross-context mismatches, and stores only source identifiers, source state, blocker codes, and source versions.

The invalidation uses `mobilization_source_event_invalidations` for idempotency. Duplicate event delivery is suppressed by source-event/context uniqueness, and duplicate semantic delivery is suppressed by a fingerprint/context uniqueness key. `ON CONFLICT DO NOTHING` prevents duplicate active evaluations, holds, Notices, or production-start changes on replay.

### Shared Write-Action Hook Architecture

The shared helper contains a narrow post-write P6 hook, not a generic P6 controller. Existing non-P6 write behavior remains unchanged because unmapped event types return immediately. P6 failures affect only mapped critical events; the source event and invalidation are processed in the same write-action path, with idempotent retry protection.

### Worker Suspension Correction

P6C corrected the P4 Worker suspension prerequisite by allowing the approved `suspended` Worker lifecycle state in migration 045. The Partner workforce review route now maps a suspension review to `workers.status = 'suspended'`, records the suspension reason/timestamp where available, emits `worker.suspended`, and the P6 source-event hook turns that into a `crew_base_ready` blocker and authorization hold. Invalid Worker transitions return controlled 400/409-style errors rather than a database 500.

### Scheduled Expiration Job

The Worker registers `startMobilizationExpirationScheduler` in `apps/worker/src/index.ts`. The job is disabled with `SYNCOS_P6_EXPIRATION_SCAN_DISABLED=true`, otherwise it runs immediately and then every `SYNCOS_P6_EXPIRATION_SCAN_INTERVAL_MS` milliseconds with a safe default of 300000 and a minimum of 60000. Batch size is controlled by `SYNCOS_P6_EXPIRATION_BATCH_SIZE`, capped to 1-250.

The run-once domain function is `runMobilizationExpirationScan(client, { asOf, batchSize })`. It uses `pg_try_advisory_lock(hashtext('syncos.p6.mobilization_expiration_scan'))`, scans bounded current P6 contexts, emits canonical expiration source events, and reuses the same P6 invalidation path. Repeated scans are safe because source fingerprints are idempotent.

### Time and Timezone Semantics

Date-only expiration fields are evaluated using the repository's database date convention against a controlled `asOf` date in tests. Timestamp fields compare instants. P6 does not expose any public API for arbitrary time control.

### Time-Based Expiration Coverage

The scheduled scan covers:

- Required Partner insurance expiration.
- Required Worker credential expiration.
- Required driver/operator credential expiration.
- Required vehicle/aerial inspection expiration via `partner_vehicle_assignments.aerial_inspection_expires_at`.
- Mobilization override expiration.
- Conditional decision expiration where represented.

Runtime E2E proves before-expiration state remains ready, after-expiration scans create blocked evaluations with exact blockers, and mobilization/Notice/production-start authorizations are held while prior history remains intact.

## 22. Source Event Map

Mapped automatic write-path events include Partner company/W-9/payment/insurance rejection or return, insurance expiration events, Worker inactivation/suspension review, Worker credential/headshot rejection or return/expiration, Crew membership ending, Foreman changes, MSA termination, Work Order suspension/termination/map/rate changes, vehicle return/suspension/aerial inspection expiration, operator revocation, override expiration/revocation, and conditional decision expiration.

The source-event hook uses only safe canonical identifiers and statuses. It does not copy W-9/payment details, Worker PII, insurance files, credential evidence, headshot/file bytes, storage keys, rates, margin, or internal notes into P6 event payloads.

Duplicate replay and older source-event replay are covered by runtime E2E. The current canonical source state remains authoritative, and older replay cannot restore a stale ready/authorized state.

## 23. Partner Admin Visibility

Partner Admin can read own external-safe readiness, blockers/warnings, decision, Notice, production-start authorization, and acknowledge receipt. Responses exclude internal notes, W-9/payment details, restricted insurance documents, rates, margins, and other Partner data.

## 24. Partner Foreman Visibility

Partner Foreman can read only the Foreman-linked Crew readiness/Notice/start instructions and acknowledge operational receipt. Responses exclude company-sensitive compliance details, W-9/payment data, rates, artifacts, and another Crew.

## 25. Internal Permission Matrix

Internal permissions:

- `partner_mobilization.review`
- `partner_mobilization.evaluate`
- `partner_mobilization.approve`
- `partner_mobilization.hold`
- `partner_mobilization.revoke`
- `partner_mobilization.override`
- `partner_notice.issue`
- `partner_notice.revoke`

## 26. API / Route Map

Internal:

- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/evaluate`
- `GET /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/readiness`
- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/overrides`
- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/approve`
- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/conditional-approve`
- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/hold`
- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/revoke`
- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/source-events`
- `POST /partner-mobilization/organizations/:organizationId/work-order-versions/:versionId/notices`

Partner Admin:

- `GET /partner-mobilization/me/work-order-versions/:versionId/readiness`
- `GET /partner-mobilization/me/notices/:noticeId`
- `POST /partner-mobilization/me/notices/:noticeId/acknowledge`

Partner Foreman:

- `GET /partner-mobilization/foreman/readiness`
- `GET /partner-mobilization/foreman/notice`
- `POST /partner-mobilization/foreman/notices/:noticeId/acknowledge`

## 27. Events and Audit

P6 writes use `executeWriteAction`. Events include readiness evaluation/change, mobilization approval/conditional approval/hold/revocation, override creation, Notice issuance/acknowledgment, and production-start authorization.

Payloads contain safe identifiers, status changes, requirement codes, Notice IDs, start date/time/timezone, and actor context. They must not contain W-9/payment data, Worker PII, file bytes, storage keys, internal notes, rates, or margin.

## 28. Status / Transition Rules

Blocked readiness cannot be approved. Conditional approval requires conditions. Notice issuance requires mobilization approval and non-blocked readiness. Notice issuance creates a production-start authorization but no Production, QC, Settlement, Payable, or Payment record.

## 29. Migrations / Database Changes

Migration added:

- `packages/database/migrations/045_partner_mobilization_readiness_foundation.sql`

New P6 tables:

- `mobilization_requirement_policies`
- `mobilization_context_requirements`
- `mobilization_readiness_evaluations`
- `mobilization_readiness_check_results`
- `mobilization_overrides`
- `mobilization_decisions`
- `notice_to_proceed_versions`
- `notice_acknowledgments`
- `production_start_authorizations`
- `mobilization_source_event_invalidations`

## 30. Fresh Migration Result

CERTIFIED. Fresh disposable validation completed on local-only PostgreSQL databases:

- `syncos_partner_mobilization_p6c_verify_final`: `npm run db:verify` applied migrations 001-045, ran seed, and passed migration verification.
- `syncos_partner_mobilization_p6c_cert_final2`: full migration chain applied through `045_partner_mobilization_readiness_foundation.sql`; seed and synthetic E2E demo seed completed.

## 31. P5-to-P6 Upgrade Result

CERTIFIED. P5-to-P6 upgrade validation completed on `syncos_partner_mobilization_p6c_upgrade_final`:

- Migrations 001-044 were applied to establish the certified P5 schema.
- Seed completed at P5 state.
- Migration 045 applied as the only pending migration.
- Seed rerun completed after migration 045.
- Verification queries confirmed migration 045 was recorded once, P6 tables exist, P1-P5 seed records survived, role/permission counts remained stable, P6 tables initialized empty, and no duplicate P6 permission mappings were introduced.

## 32. Security / Isolation Tests

CERTIFIED. Source tests and runtime E2E validate tenant/Partner scoping, Partner self-approval denial, Partner override denial, Foreman Crew scoping, direct ID guessing denial, safe Partner responses, and event/audit payload redaction.

The P6 E2E event-leak query is scoped to the exact P6 aggregate IDs, tenant, Partner Organization, Work Order version, and test correlation context so unrelated pre-existing events cannot produce false failures while P6 event payload leaks remain detectable.

## 33. Override Tests

CERTIFIED. Targeted P6 E2E covers Partner override denial, non-overrideable requirement override rejection, internal override creation for an administrative requirement, expiration scoping, expired override behavior, and Partner-safe redaction.

## 34. Notice / Start-Authorization Tests

CERTIFIED. Targeted P6 E2E covers approval before Notice, structured Notice issuance, production-start authorization, Partner acknowledgments, Partner Admin and Foreman Notice visibility, Notice supersession/current-version behavior, and no Production/QC/Settlement/Payable creation.

## 35. Automatic Reevaluation Tests

CERTIFIED for the P6 targeted suite. Runtime E2E covers canonical source mutations and scheduled expiration without calling the P6 source-event endpoint as the action under test:

- P4 Worker review/suspension/inactivation emits canonical events and automatically creates blocked P6 evaluations with `crew_base_ready`.
- P4 Worker credential rejection and expiration produce Worker/Crew/P6 blockers.
- Crew membership and Foreman changes produce exact Crew/Foreman blockers.
- P3 insurance/compliance rejection produces Partner compliance blockers.
- P5 MSA termination and Work Order suspension produce legal/Work Order blockers.
- P5 vehicle return and operator revocation produce vehicle/operator blockers.
- Scheduled expiration scan produces insurance, credential, driver/operator credential, aerial inspection, override, and decision expiration invalidations.
- Duplicate source-event replay is idempotent, and older replay cannot restore stale readiness or authorization.

Each invalidation holds active mobilization decisions, Notices, and production-start authorizations while preserving prior history.

## 36. Customer QC Boundary

P6 creates no QC record, Customer acceptance record, billable record, Settlement, Payable, Payment, or Production record. Production-start authorization only authorizes identified start instructions.

## 37. Global Certification Registration

`npm run e2e:certification` includes `tests/e2e/partner-mobilization-readiness.spec.ts`, and `tests/regression.test.js` asserts registration.

## 38. Exact Validation Results

Completed:

- Mandatory baseline check: passed.
- `npm install --package-lock-only`: passed.
- `npm test`: 47/47 passed.
- `npm run typecheck`: passed.
- `npm run typecheck -w @syncos/api`: passed.
- `npm run typecheck -w @syncos/worker`: passed.
- `npm run build -w @syncos/api`: passed.
- `npm run build -w @syncos/worker`: passed.
- `npm run build -w @syncos/web`: passed.
- Fresh migration/seed/db:verify: passed on disposable local databases.
- P5-to-P6 upgrade verification: passed on disposable local database.
- Targeted P1-P6 Partner E2E command: 39/39 passed.
- Targeted P6 E2E: 8/8 passed.
- `npm run security:smoke`: passed.
- `npm run organization:smoke`: passed.
- `npm run project:smoke`: passed.
- `npm run work-order:smoke`: passed.
- `npm run sprint3:smoke`: passed on isolated disposable database.
- `npm run sprint4:smoke`: passed on isolated disposable database.
- `npm run sprint5:smoke`: passed on isolated disposable database.
- `npm run sprint6:smoke`: passed on isolated disposable database.
- `npm run e2e:hydration`: 27/27 passed after rerun of one transient browser teardown timeout.
- `npm run e2e:boundaries`: 22/22 passed.
- `npm run e2e:personas`: 4/4 passed.
- `npm run e2e:action-state-personas`: 140/140 passed.
- `npm run e2e:lifecycle`: 4/4 passed.
- `npm run e2e:certification` on fresh P6C database: 596/600 passed, exit 1. Output explicitly executed and passed P6 tests 476-483, but four non-P6 UI tests timed out:
  - `tests/e2e/action-states/action-state-submit.spec.ts:501`: Invoice item reject modal.
  - `tests/e2e/action-states/action-state-submit.spec.ts:664`: Collection case closed archive action visibility.
  - `tests/e2e/action-states/action-state-submit.spec.ts:1007`: Accounting export approve modal.
  - `tests/e2e/workflows/project-to-qc.spec.ts:12`: Project-to-QC skeleton.
- P6D differential rerun on fresh P6 production runtime and disposable database `syncos_p6d_candidate_cert_prod`: the four formerly failing tests each passed individually:
  - Invoice item reject: 1/1 passed.
  - Collection case closed archive: 1/1 passed.
  - Accounting export approve: 1/1 passed.
  - Project-to-QC skeleton: 1/1 passed.
- P6D isolated P5 baseline comparison in detached worktree `/Users/User/syncos-p6-baseline-check` with disposable database `syncos_p6d_baseline_four`: the same four tests each passed individually. Classification for all four is `BASELINE PASS / CLEAN P6 PASS`, so the earlier failures were not deterministic P6 regressions.
- P6D final global certification on fresh P6 production runtime and disposable database `syncos_p6d_candidate_global_prod`: `npm run e2e:certification` passed 600/600 with exit 0. Output explicitly executed and passed P6 tests 476-483:
  - 476 evaluates canonical assignment context and blockers.
  - 477 enforces override governance.
  - 478 approves mobilization, issues Notice, and keeps production start separate.
  - 479 proves Partner Admin/Foreman safe visibility and receipt-only acknowledgment.
  - 480 proves canonical source mutations automatically invalidate and hold authorization.
  - 481 proves canonical P3/P4/P5 source events automatically invalidate ready authorization.
  - 482 proves scheduled expiration scan invalidates time-based sources and is idempotent.
  - 483 proves duplicate and older source-event replay does not duplicate or restore authorization.
- `git diff --check`: passed after the final P6D documentation update.

Defects corrected during P6A certification:

- Identical blocked reevaluation compared against persisted prior check results instead of a missing prior blocker field, preventing duplicate material-change events.
- Notice revision now supersedes the prior current Notice and current production-start authorization before inserting the replacement records.
- Internal notes were removed from serialized decision and Notice payloads so `executeWriteAction` events/audit metadata cannot leak them.
- Tenant B test fixture now creates deterministic canonical IDs including a Tenant B capacity provider, avoiding partial or cross-tenant fixture state.
- Foreman-safe readiness no longer exposes commercial/rate wording.
- P6 event/audit leak query was narrowed to exact P6 aggregate IDs, tenant, Partner Organization, Work Order version, and correlation context.
- P6B added automatic source-write invalidation through `executeWriteAction`, including Worker inactivation and vehicle return runtime proof.
- P6C corrected Worker suspension status handling and added runtime proof for Worker suspension invalidation.
- P6C added scheduled expiration processing, run-once testing, duplicate-delivery idempotency, older replay protection, and additional P3/P4/P5 source-event runtime coverage.

### Global Certification Differential Triage

P6D created an isolated detached P5 baseline worktree at `bd772b89f0b49abbdf60daefeba80041528cfa69` and ran the four failed tests against separate P5 and P6 databases, API ports, web ports, build outputs, and production web servers.

- Invoice item reject modal: passed on clean P6 and passed on P5 baseline. Classification: runtime/environment contamination, not a P6 regression.
- Collection closed archive action visibility: passed on clean P6 and passed on P5 baseline. A deliberately contaminated rerun after the individual tests had already mutated deterministic seed records reproduced the missing-action symptom, confirming stale/consumed seed state can create this failure. Classification: seed/runtime contamination, not a P6 regression.
- Accounting export approve modal: passed on clean P6 and passed on P5 baseline. The contaminated rerun against already-mutated seed data reproduced the modal timeout pattern. Classification: seed/runtime contamination, not a P6 regression.
- Project-to-QC skeleton: passed on clean P6 and passed on P5 baseline. Classification: prior runtime/dev-server timing or stale runtime state, not a P6 regression.

Shared write-action review: `packages/shared/src/write-action.ts` returns before P6 table lookup for unmapped source events. Invoice item, collection case, accounting export, and project/QC events are not in the P6 invalidation allowlist, so the P6 hook is a no-op for those domains and does not acquire P6 locks, mutate P6 state, alter return values, or swallow unrelated errors.

Scheduler review: the P6 expiration scheduler runs only inside the Worker package. The P6D candidate and baseline Playwright runtimes started API and web only; the Worker was not active, so the scheduler could not interfere with invoice, collection, accounting export, or project/QC UI tests.

Final rerun result: after using a second fresh P6 database for the decisive global run, all four formerly failing tests passed inside `npm run e2e:certification`, and the full command exited 0 with 600/600 passed.

## 39. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/routes/partner-agreements.controller.ts`
- `apps/api/src/routes/partner-mobilization.controller.ts`
- `apps/api/src/routes/partner-workforce.controller.ts`
- `apps/api/src/security/permission.guard.ts`
- `apps/worker/package.json`
- `apps/worker/src/index.ts`
- `apps/worker/tsconfig.json`
- `package-lock.json`
- `packages/shared/src/write-action.ts`
- `packages/database/migrations/045_partner_mobilization_readiness_foundation.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/partner-mobilization-readiness.spec.ts`
- `tests/partner-mobilization-readiness.test.js`
- `tests/regression.test.js`
- `package.json`
- `docs/product/partner-mobilization-readiness-p6.md`

## 40. Explicitly Excluded P7+ Scope

No Partner Portal UI, PDF generation, e-signature, Daily JSA, Daily Production, production photo evidence, Customer QC intake, Sync technical QC, customer acceptance, correction/rework, incident reporting, Billable, Settlement, Contractor Payable, Priority Passport transfer, ACH payment, payroll, closeout, performance scoring, or public website changes were implemented.

## 41. Risks and Limitations

- Automatic invalidation is wired for critical canonical writes that emit mapped events through `executeWriteAction`.
- Pure time-based expiration is now backed by the Worker scheduler and run-once scan, but production deployment must ensure the Worker process is running and local configuration does not disable `SYNCOS_P6_EXPIRATION_SCAN_DISABLED`.
- Requirement policy is typed and minimal, not a generic rules engine.
- Notice is structured data only; PDF rendering remains later scope.
- P6 authorizes a start instruction only; it does not create Production, Daily JSA, Customer QC, accepted quantities, Billable, Settlement, Payable, Payment, or PDF artifacts.

## 42. P6 Certification Status

CERTIFIED

## 43. GO / NO-GO Recommendation for P7

GO for committing P6 after final review. P6 targeted behavior is certified by its 8/8 targeted suite and by P6 tests 476-483 passing inside final global certification. `npm run e2e:certification` completed with exit 0 and 600/600 passed on a fresh P6D production runtime. NO-GO for starting P7 until P6 is committed and accepted. No P7 work was started in this sprint.
