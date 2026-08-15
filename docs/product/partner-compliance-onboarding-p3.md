# SyncOS P3 — Partner Compliance Onboarding Foundation

## 1. Baseline Branch and Commit

- Branch: `feat/partner-compliance-onboarding-p3`
- Baseline HEAD: `36feb0a23c1288d9e5f0670529bb7fba0542dd72`
- Repository root: `/Users/User/syncos`
- Public website nested repository excluded from this sprint: `/Users/User/syncos/synccommsystems.com`

## 2. Existing Objects Reused

P3 preserves the P0/P1/P2 architecture:

- Partner company identity remains `organizations`.
- Operational Partner capacity remains `capacity_providers`.
- External Partner users remain existing `users`, `tenant_users`, `roles`, `role_permissions`, and `user_roles`.
- Partner persona/scope resolution continues through the P2 role/scope model and the P1 Partner Organization/capacity-provider eligibility model.
- Writes use the existing audited write path through `executeWriteAction`.
- Audit records use `appendAuditLog`.
- File ownership is linked through the existing `files` table when a canonical file record exists.

No `partners`, `partner_company`, `partner_onboarding`, `partner_forms`, or generic onboarding-answer table was added.

## 3. Canonical Company Profile Model

P3 adds `partner_company_profiles` as an Organization-owned compliance extension for facts not already canonical on `organizations`.

It stores company-level onboarding facts such as legal business name, DBA, state of formation, entity type, business address, primary business contact, settlement contact, compliance contact, status, reviewer, external return reason, internal notes, version, and material-change timestamp.

The record is tenant-owned, Organization-owned, optionally linked to the canonical capacity provider, and constrained so there is one active current profile per Partner Organization.

## 4. W-9 / Tax Profile Model

P3 adds `partner_tax_profiles`.

It stores W-9 verification metadata only: legal name on W-9, DBA, federal tax classification, TIN type, TIN last four, signed/received dates, status, evidence reference, verifier, verification timestamp, external return reason, internal notes, and version.

Full TIN values are not stored in ordinary tables or returned by API responses.

## 5. Payment-Readiness Model

P3 adds `partner_payment_profiles`.

It represents readiness metadata only. Priority Passport is the primary payment method. The model stores safe provider reference, Priority Passport status, verification status, enrollment contact, card/account last four where appropriate, backup ACH status, bank display name, account type, restricted evidence references, hold reason, reviewer, and version.

Full bank account and routing values are rejected by the API and are not stored in ordinary tables.

## 6. Insurance Policy / COI Model

P3 adds `partner_insurance_policies`.

Supported policy types:

- `commercial_general_liability`
- `commercial_auto`
- `umbrella_excess`
- `workers_compensation`
- `employers_liability`

The model stores carrier, safe policy reference, effective and expiration dates, structured limits, auto coverage indicators, workers compensation statutory indicator, Additional Insured, Waiver of Subrogation, Primary/Non-Contributory, COI evidence, endorsement evidence, review status, reviewer, and version.

The current required limits are evaluated in code:

- CGL: $1M occurrence, $2M aggregate, $2M products/completed operations.
- Auto: $1M combined single limit, hired/rented and non-owned coverage required.
- Umbrella/Excess: $2M occurrence/aggregate.
- Workers Compensation: statutory.
- Employers Liability: $500K accident, $500K disease per employee, $500K disease policy.

## 7. Restricted Evidence Architecture

P3 adds `partner_restricted_evidence` for sensitive evidence metadata tied to canonical records.

Supported evidence categories:

- `partner_w9`
- `partner_ach_authorization`
- `partner_bank_verification`
- `partner_coi`
- `partner_insurance_endorsement`
- `partner_insurance_policy_evidence`

Evidence records are tenant-owned, Organization-owned, category-constrained, restricted by default, and optionally linked to `files(tenant_id, id)`.

Partner evidence responses do not expose permanent raw public URLs, bucket/object key, full document contents, or sensitive field values.

## 8. Sensitive Data and Redaction Rules

The P3 API rejects direct full TIN, routing-number, and bank-account payload fields.

Partner responses expose only safe metadata:

- TIN type and last four.
- Payment provider status/reference and last four.
- Evidence metadata without raw permanent URLs.
- External return reasons but not internal review notes.

Partner Foreman receives only a minimal compliance summary and cannot access W-9, payment profile, insurance detail, or restricted evidence endpoints.

## 9. Status and Versioning Rules

Company profile states:

- `draft`
- `submitted`
- `under_review`
- `verified`
- `returned`
- `rejected`
- `superseded`

W-9 states:

- `not_submitted`
- `submitted`
- `under_review`
- `verified`
- `returned`
- `rejected`
- `superseded`

Payment profile states:

- `not_started`
- `submitted`
- `under_review`
- `active`
- `hold`
- `rejected`
- `superseded`

Insurance states:

- `draft`
- `submitted`
- `under_review`
- `verified`
- `returned`
- `rejected`
- `expired`
- `superseded`

Current-record uniqueness prevents duplicate active current records per Organization/policy type. Supersession/version fields are present for preserving history in later workflow expansion.

## 10. Partner Admin Capabilities

Partner Admin can, for its own approved Partner Organization only:

- Read compliance summary.
- Read/submit company profile.
- Read/submit W-9 metadata and restricted W-9 evidence metadata.
- Read/submit Priority Passport readiness and backup ACH evidence metadata.
- List/submit insurance policies, COI evidence, and endorsement evidence metadata.
- Read permitted own-Organization restricted evidence metadata.

Partner Admin cannot verify, approve, reject, clear blockers, access another Partner, or view internal reviewer notes.

## 11. Partner Foreman Capabilities

Partner Foreman can read only minimal compliance readiness:

- Organization ID.
- Overall status.
- High-level blocker categories.
- Evaluation timestamp.

Partner Foreman cannot access W-9, payment, insurance detail, restricted evidence, or internal notes.

## 12. Internal Review Capabilities

Internal authorized users with P3 review permissions can:

- Read Partner compliance summaries.
- Review company profile, W-9, payment profile, and insurance policies.
- Verify, return, reject, or hold records according to route-specific rules.
- Read restricted evidence metadata with the restricted evidence review permission.

Internal review routes revalidate tenant ownership, Organization eligibility, and Partner capacity-provider linkage.

## 13. Permission Matrix

Partner Admin:

- `partner_compliance.summary.read`
- `partner_compliance.profile.read`
- `partner_compliance.profile.submit`
- `partner_compliance.w9.read`
- `partner_compliance.w9.submit`
- `partner_compliance.payment.read`
- `partner_compliance.payment.submit`
- `partner_compliance.insurance.read`
- `partner_compliance.insurance.submit`
- `partner_compliance.evidence.read`

Partner Foreman:

- `partner_compliance.summary.read`

Internal review:

- `partner_compliance.review`
- `partner_compliance.evidence.review`

P3 Partner permissions are added to the `PermissionGuard` Partner-scoped permission set so tenant-scoped roles cannot satisfy them.

## 14. API / Route Map

Partner-safe routes:

- `GET /partner-compliance/me/summary`
- `GET /partner-compliance/me/company-profile`
- `POST /partner-compliance/me/company-profile`
- `GET /partner-compliance/me/w9`
- `POST /partner-compliance/me/w9`
- `GET /partner-compliance/me/payment-profile`
- `POST /partner-compliance/me/payment-profile`
- `GET /partner-compliance/me/insurance-policies`
- `POST /partner-compliance/me/insurance-policies`
- `GET /partner-compliance/me/evidence/:evidenceId`

Internal review routes:

- `GET /partner-compliance/organizations/:organizationId/summary`
- `POST /partner-compliance/organizations/:organizationId/company-profile/review`
- `POST /partner-compliance/organizations/:organizationId/w9/review`
- `POST /partner-compliance/organizations/:organizationId/payment-profile/review`
- `POST /partner-compliance/organizations/:organizationId/insurance-policies/:policyId/review`
- `GET /partner-compliance/organizations/:organizationId/evidence/:evidenceId`

No Partner Portal UI routes were added.

## 15. Compliance Evaluator

The evaluator returns:

- `overall_status`
- `profile_status`
- `w9_status`
- `payment_profile_status`
- `insurance_status`
- `blockers`
- `warnings`
- `evaluated_at`

Overall status is `ready` only when required profile, W-9, Priority Passport payment readiness, and all required insurance policies are verified and compliant.

## 16. Blocker Definitions

Implemented blocker categories include:

- `company_profile_missing`
- `company_profile_unverified`
- `w9_missing`
- `w9_unverified`
- `w9_rejected`
- `payment_profile_incomplete`
- `payment_profile_unverified`
- `payment_profile_on_hold`
- `required_policy_missing`
- `policy_unverified`
- `policy_expired`
- `coverage_limit_insufficient`
- `hired_auto_coverage_missing`
- `additional_insured_missing`
- `waiver_of_subrogation_missing`
- `primary_non_contributory_missing`

Blockers are calculated, not stored as duplicate canonical facts.

## 17. Expiration / Renewal Behavior

Insurance expiration is structurally represented by `expiration_date`.

Expired verified policies are treated as non-compliant by the evaluator. Replacement/supersession columns are present, but automated renewal reminders and notification scheduling remain later-sprint work.

P3 does not add a W-9 expiration rule.

## 18. Event and Audit Behavior

Successful P3 writes use the existing audited write path and emit canonical events for submitted/reviewed compliance records. Restricted evidence upload metadata emits `restricted_evidence.uploaded`.

Audit/event payloads use safe identifiers and safe state snapshots. They do not include full TIN, routing/account numbers, file contents, permanent storage URLs, or internal notes in Partner-facing responses.

Denied writes do not emit success events.

## 19. Database Changes / Migrations

Migration added:

- `packages/database/migrations/042_partner_compliance_onboarding_foundation.sql`

Objects added:

- `partner_company_profiles`
- `partner_tax_profiles`
- `partner_payment_profiles`
- `partner_insurance_policies`
- `partner_restricted_evidence`

Indexes/constraints include tenant-safe foreign keys, Organization ownership, current-record uniqueness, policy type constraints, evidence category constraints, and insurance date validation.

## 20. Security and Isolation Tests

Added source-level tests:

- `tests/partner-compliance-onboarding.test.js`

Added runtime E2E tests:

- `tests/e2e/partner-compliance-onboarding.spec.ts`

Covered behavior includes Partner Admin own-Organization access, cross-Partner denial, Partner Foreman restricted-evidence denial, internal review verification, sensitive value rejection, compliance blocker calculation, insufficient/expired policy blockers, and no permanent raw URL exposure.

## 21. Runtime Validation Environment

Local disposable PostgreSQL databases:

- Migration verification: `syncos_partner_compliance_p3_verify_20260815`
- Runtime E2E: `syncos_partner_compliance_p3_test_20260815`

Local API:

- `http://localhost:3139`
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3_test_20260815`
- `AUTH_JWT_SECRET=e2e-secret-for-local-testing`

Local web:

- `http://localhost:3138`
- `SYNCOS_API_BASE_URL=http://localhost:3139`

The full E2E certification was run with fresh API/web processes after builds completed.

## 22. Exact Validation Results

Passed:

- `npm test` — 23/23 passed.
- `npm run typecheck -w @syncos/api` — passed.
- `npm run typecheck` — passed.
- `npm run build -w @syncos/api` — passed.
- `npm run build -w @syncos/web` — passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3_verify_20260815 npm run db:verify` — passed against fresh empty DB.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3_test_20260815 API_BASE_URL=http://localhost:3139 AUTH_JWT_SECRET=e2e-secret-for-local-testing npx playwright test tests/e2e/partner-compliance-onboarding.spec.ts` — 5/5 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3_test_20260815 API_BASE_URL=http://localhost:3139 AUTH_JWT_SECRET=e2e-secret-for-local-testing npx playwright test tests/e2e/partner-domain-scope.spec.ts tests/e2e/partner-personas-permissions.spec.ts` — 16/16 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3_test_20260815 API_BASE_URL=http://localhost:3139 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run security:smoke` — passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3_test_20260815 API_BASE_URL=http://localhost:3139 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run organization:smoke` — passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 WEB_BASE_URL=http://localhost:3148 AUTH_JWT_SECRET=e2e-secret-for-local-testing npx playwright test tests/e2e/partner-domain-scope.spec.ts tests/e2e/partner-personas-permissions.spec.ts tests/e2e/partner-compliance-onboarding.spec.ts` — 21/21 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run security:smoke` — passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run organization:smoke` — passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 WEB_BASE_URL=http://localhost:3148 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:hydration` — 27/27 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 WEB_BASE_URL=http://localhost:3148 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:boundaries` — 22/22 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 WEB_BASE_URL=http://localhost:3148 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:personas` — 4/4 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 WEB_BASE_URL=http://localhost:3148 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:action-state-personas` — 140/140 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 WEB_BASE_URL=http://localhost:3148 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:lifecycle` — 4/4 passed.
- `DATABASE_URL=postgres:///syncos_partner_compliance_p3a_runtime_20260815 API_BASE_URL=http://localhost:3149 WEB_BASE_URL=http://localhost:3148 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:certification` — 582/582 passed, including `tests/e2e/partner-compliance-onboarding.spec.ts`.

`git diff --check` is part of final repository validation.

## 23. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/routes/partner-compliance.controller.ts`
- `apps/api/src/security/permission.guard.ts`
- `package.json`
- `packages/database/migrations/042_partner_compliance_onboarding_foundation.sql`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/partner-compliance-onboarding.spec.ts`
- `tests/partner-compliance-onboarding.test.js`
- `tests/regression.test.js`
- `docs/product/partner-compliance-onboarding-p3.md`

## 24. Explicitly Excluded P4+ Scope

P3 did not implement Partner Portal UI, Partner web pages, self-registration, invitation delivery, crews, workers, credentials, headshots, background checks, drug screens, agreements, PDF generation, e-signature, Work Orders, vehicle assignment, mobilization readiness, Notice to Proceed, JSA, production, field evidence/photos, QC, corrections, incidents, settlement statements, Contractor Payable, Priority Passport transfers, ACH execution, payroll, reconciliation, closeout, performance scoring, or public website changes.

## 25. Risks and Limitations

- Restricted evidence stores metadata and authorization boundaries, not binary upload/download streaming.
- Sensitive-access audit exists for evidence metadata reads; full document-content access will need to follow the same authorization path when binary retrieval is implemented.
- Insurance reminder scheduling is not implemented in P3.
- Supersession columns exist, but richer renewal workflow UX and automated replacement flows remain later sprint work.
- ACH backup is treated as optional for readiness unless submitted and rejected/on hold; Priority Passport active/verified is the mandatory payment-readiness rule.

## 26. P3 Certification Status

CERTIFIED

## 27. GO / NO-GO Recommendation for P4

GO for P4 after committing P3.

P4 should build on this foundation for crews/workers/credentials without creating duplicate Partner-worker or Partner-crew identity objects.

## Sensitive Data, Migration, and Global Certification Review

1. Diff review summary
   - P3 adds the compliance controller, migration 042, P3 permission keys, seed provisioning, P3 E2E/source tests, global certification registration, and this documentation.
   - P3A corrected verified-record supersession and rejected client-supplied storage references for restricted-evidence metadata.

2. Database invariant review
   - Migration 042 stores P3 facts on Organization-owned compliance tables with `tenant_id` and `organization_id` on every row.
   - P3 tables use tenant-safe Organization foreign keys, constrained statuses/categories/types, current-record uniqueness, non-negative limit checks, date checks, and explicit supersession columns.

3. Fresh migration result
   - `syncos_partner_compliance_p3a_fresh_20260815` migrated through 042 and passed `npm run db:verify`.

4. P2-to-P3 upgrade result
   - `syncos_partner_compliance_p3a_upgrade_20260815` migrated 001-041, seeded, upgraded through 042, and reseeded without duplicate role/permission rows.
   - `syncos_partner_compliance_p3a_upgrade_demo_20260815` repeated the upgrade with representative E2E demo data; existing organizations, capacity providers, users, roles, permissions, projects, and work orders survived unchanged, and new compliance tables started empty.

5. Sensitive-data schema scan
   - Migration 042 does not create ordinary columns for full TIN, SSN, routing number, full bank account number, card number, provider secrets, or unrestricted document URLs.
   - Ordinary structured fields are limited to safe values such as `tin_last_four`, `account_last_four`, `card_last_four`, provider/status metadata, and restricted evidence metadata.

6. API-response redaction result
   - Partner-safe serializers return only own-Organization status, safe profile fields, tax type/last-four, payment readiness metadata, policy summaries, externally visible reasons, and blockers.
   - Full TIN/bank values, raw storage references, internal notes, audit metadata, and another Partner's records are not serialized to Partner users.

7. Event/audit redaction result
   - P3 event/audit payloads use safe identifiers and safe state snapshots.
   - Payloads do not include full TIN, full banking values, file contents, raw storage URLs, provider secrets, or unrestricted evidence paths.

8. Restricted evidence authorization result
   - Restricted evidence metadata is tenant-scoped, Organization-scoped, category-constrained, and related to P3 canonical records.
   - E2E verifies unauthenticated denial, cross-Partner denial, Partner Foreman denial for restricted company evidence, internal permission enforcement, and no public URL exposure.

9. Actual file-byte support vs metadata-only support
   - P3 implements restricted evidence metadata and authorization boundaries only.
   - Binary upload/download streaming is intentionally not implemented in P3 and must use the same server-side authorization path when added.

10. Partner Admin access result
   - Partner Admin can submit and read its own company profile, W-9 status/evidence metadata, payment-readiness metadata, insurance policy data, and external-safe blockers.
   - Partner Admin cannot broaden scope through headers, query values, body Organization IDs, guessed evidence IDs, or another Partner's record IDs.

11. Partner Foreman access result
   - Partner Foreman receives only the minimal compliance summary and high-level blocker categories.
   - Partner Foreman cannot access W-9, payment, banking, restricted evidence, internal review data, or detailed compliance records.

12. Internal review separation result
   - Internal review routes require internal P3 review permissions.
   - Partner users cannot verify, reject, return, hold, clear blockers, write internal notes, or approve their own compliance records.

13. Versioning/supersession result
   - Verified company profile, W-9, payment profile, and insurance records are not destructively overwritten.
   - Material replacement creates a new current submission and explicitly links prior/current records through supersession columns while preserving old evidence and verified history.

14. Compliance evaluator result
   - Compliance status is derived from canonical structured records, not client-provided status or stored duplicate blockers.
   - E2E covers empty, partial, blocked, and fully ready states with exact blocker behavior.

15. Insurance expiration result
   - Controlled-date tests verify insufficient limits and expired policies create blockers, rejected/returned policies cannot satisfy readiness, and verified replacement policies become current deterministically.
   - P3 does not introduce W-9 expiration.

16. P3 certification-runner inclusion result
   - P3 was missing from the global certification runner before P3A.
   - `package.json` now includes `tests/e2e/partner-compliance-onboarding.spec.ts` in `npm run e2e:certification`, and `tests/regression.test.js` asserts that registration.

17. Full E2E certification total
   - Final global certification passed 582/582.
   - The runner output explicitly executed P3 tests 466-470 from `tests/e2e/partner-compliance-onboarding.spec.ts`.

18. Defects found
   - Global certification did not include the P3 E2E spec.
   - Verified compliance rows could be overwritten in place instead of preserving explicit supersession history.
   - Partner clients could submit storage reference metadata for restricted evidence.

19. Defects corrected
   - Registered P3 E2E in global certification and added a source regression.
   - Added supersession columns and controller logic that supersedes verified current records.
   - Rejected client-supplied storage references and forced restricted evidence storage fields to remain server-owned.

20. Remaining limitations
   - Restricted evidence remains metadata-only until a later restricted-file byte service is implemented.
   - Insurance reminder scheduling and notification delivery remain later work.
   - ACH backup remains optional for compliance readiness unless submitted and rejected/on hold.

21. Final P3 certification
   - CERTIFIED
