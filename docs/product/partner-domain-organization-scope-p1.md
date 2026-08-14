# SyncOS P1 Partner Domain and Organization Scope

## 1. Baseline branch and commit

- Baseline branch: `feat/partner-domain-scope-p1`
- Baseline HEAD before P1 application changes: `43c57690bb3137d86ab7904d8fad74f43ff1b03f`
- Repository root: `/Users/User/syncos`
- Nested public website repository excluded from this sprint: `/Users/User/syncos/synccommsystems.com`

## 2. Files changed

- `apps/api/src/security/organization-scope.ts`
- `apps/api/src/routes/partner-domain.controller.ts`
- `apps/api/src/modules/app.module.ts`
- `tests/partner-domain-scope.test.js`
- `tests/e2e/partner-domain-scope.spec.ts`
- `docs/product/partner-domain-organization-scope-p1.md`

## 3. Existing objects reused

P1 reuses the canonical SyncOS objects approved in the P0 audit:

- `organizations` remains the legal Partner company identity.
- `capacity_providers` remains the operational capacity representation.
- `tenant_users`, `roles`, `permissions`, `role_permissions`, and `user_roles` remain the access model.
- `scope_type = 'organization'` binds a user role to an Organization.
- `scope_type = 'contractor'` is resolved through `capacity_providers.id` to the owning `capacity_providers.organization_id`.
- `events`, `event_payloads`, `audit_logs`, and `system_actions` remain the write/audit path through `executeWriteAction`.

## 4. Schema decision

No migration was added for P1.

Reason:

- The existing `organizations` table already owns Partner legal identity.
- The existing `capacity_providers.organization_id` relationship already links operational capacity to an Organization.
- Migration `016_tenant_fk_hardening.sql` already adds tenant-safe composite foreign keys for `capacity_providers` to `organizations`.
- The existing `user_roles.scope_type` and `scope_id` columns already support server-side organization scope primitives.
- A new Partner company table would duplicate Organization and violate the P0 anti-duplication decision.

Duplicate active Partner linkage is guarded in the P1 classification path by taking a PostgreSQL advisory lock over the tenant/Organization/provider-type classification key, reusing an existing active linkage without writing, and refusing ambiguous active linkage for the same Organization/provider type.

## 5. Canonical Partner definition

For P1, a canonical Partner Organization is:

1. an `organizations` record in the authenticated tenant;
2. linked to at least one non-archived `capacity_providers` record;
3. where `capacity_providers.provider_type` is `subcontractor` or `crew_provider`;
4. where both records are not soft-deleted.

This definition is intentionally narrow. It does not create a Partner profile, Partner worker, Partner crew, Partner project, Partner settlement, or Partner payable object.

## 6. Organization/capacity-provider relationship

The internal P1 classify route:

- validates the Organization by tenant;
- derives access through the server-side organization-scope service;
- reuses an existing active Partner-type capacity provider when exactly one exists;
- creates a minimal `capacity_providers` record only when no active Partner-type linkage exists;
- rejects ambiguous active linkage instead of guessing which provider is canonical.

The Partner company remains the Organization. The capacity provider is the operational capacity record.

## 7. Organization-scope enforcement model

`OrganizationScopeService` resolves access from the authenticated tenant/user and the required permission. It does not trust `x-scope-type` or `x-scope-id` headers.

The existing global `PermissionGuard` still uses the established `x-scope-type` and `x-scope-id` convention to evaluate whether an organization-scoped role has the route permission. The P1 Partner Domain service then independently resolves the effective Organization scope from database role assignments and revalidates tenant/Organization/capacity-provider ownership. Runtime tests verify that spoofed scope headers, query parameters, and body fields cannot broaden access.

Resolution rules:

- tenant-scoped permission grants tenant-wide internal access;
- organization-scoped permission grants access only to that Organization;
- contractor-scoped permission maps `scope_id` to `capacity_providers.id` and then to `capacity_providers.organization_id`;
- missing scope produces `403`;
- out-of-scope detail and child access produces `404` to avoid record disclosure.

List queries add organization scope directly into SQL predicates. Detail and mutation paths re-check tenant and organization scope server-side before returning or writing.

## 8. API/service changes

New internal API routes:

- `GET /partner-domain/organizations`
- `GET /partner-domain/organizations/:organizationId`
- `GET /partner-domain/organizations/:organizationId/capacity-providers/:capacityProviderId`
- `POST /partner-domain/organizations/:organizationId/classify`

These routes are not public and do not create a Partner Portal. They are protected with existing permissions:

- read routes require `capacity_provider.read`;
- classify route requires `capacity_provider.create`.

No web routes, Partner UI, dashboard, or external authentication flow was added.

## 9. Permission impact

P1 does not add Partner Owner, Partner Admin, or Partner Foreman roles.

P1 does not add broad Partner permissions.

P1 uses existing permission keys and adds server-side organization-scope resolution to prove the access boundary required before P2.

## 10. Event/audit impact

Partner classification writes flow through `executeWriteAction`.

New event/action names used by the P1 classify route:

- action: `partner_classification.create`
- event: `partner_classification.created`
- aggregate type: `organization`
- entity id: Organization id

Payload includes:

- tenant id;
- actor user id;
- Organization id;
- capacity provider id;
- Organization state;
- capacity provider state;
- canonical definition marker: `organization_with_capacity_provider`;
- whether existing linkage was reused.

Denied read and mutation attempts do not create audit rows unless the existing guard/write architecture already supports audit for that failure type.

## 11. Isolation tests

Added source regression coverage in `tests/partner-domain-scope.test.js`:

- verifies P1 reuses `organizations` and `capacity_providers`;
- verifies no duplicate Partner table is introduced;
- verifies scope resolution uses `tenant_users`, `user_roles`, `role_permissions`, and `permissions`;
- verifies the resolver does not use client scope headers;
- verifies Partner Domain SQL has tenant and organization predicates;
- verifies routes are permission protected.

Added E2E coverage in `tests/e2e/partner-domain-scope.spec.ts`:

- Tenant A cannot access Tenant B's Partner Organization.
- Organization-scoped actor for Partner A cannot access Partner B.
- Organization-scoped actor for Partner A cannot classify/update Partner B.
- Guessing another Organization id returns not found.
- Guessing another capacity-provider id returns not found.
- A mismatched child capacity provider cannot be accessed under an authorized parent Organization.
- Organization-scoped list queries return only authorized records.
- Organization-scoped detail queries return not found for unauthorized records.
- Organization-scoped mutations revalidate scope.
- Classification creation creates one event/audit pair.
- Idempotent classification reuse does not create a second event/audit pair.
- Near-concurrent classification creates only one active Partner linkage.
- Tenant-scoped internal authorized roles can access intended records.
- Internal unauthorized roles remain denied.
- Existing tenant-scoped `capacity-providers` route still works for internal authorized roles.

## 12. Explicitly excluded scope

P1 does not implement:

- external Partner Portal UI;
- `/partner` web route pages;
- Partner dashboard;
- Partner self-registration;
- invitation emails;
- Partner Owner/Admin/Foreman login personas;
- W-9 onboarding;
- payment setup;
- Priority Passport integration;
- banking/ACH fields;
- insurance upload/verification;
- worker credentials;
- agreements;
- PDF generation;
- e-signature;
- Work Order signing;
- vehicle assignment workflow;
- mobilization readiness;
- Notice to Proceed;
- JSA;
- production submission;
- photo upload;
- offline/mobile support;
- QC/corrections/incidents;
- settlement visibility;
- contractor payable eligibility;
- payment execution;
- performance scoring;
- closeout;
- public website changes.

## 13. Validation results

Validation commands run:

- `npm test` - passed.
- `npm run typecheck -w @syncos/api` - passed.
- `npm run build -w @syncos/api` - passed.
- `DATABASE_URL=postgres:///syncos_partner_scope_test npm run db:migrate` - passed.
- `DATABASE_URL=postgres:///syncos_partner_scope_test npm run db:seed` - passed.
- `DATABASE_URL=postgres:///syncos_partner_scope_test npm run seed:e2e-demo` - passed.
- `DATABASE_URL=postgres:///syncos_partner_scope_test npm run e2e:seed-smoke` - passed.
- `PORT=3137 DATABASE_URL=postgres:///syncos_partner_scope_test AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run start -w @syncos/api` - API started locally for runtime validation.
- `DATABASE_URL=postgres:///syncos_partner_scope_test API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npx playwright test tests/e2e/partner-domain-scope.spec.ts` - passed, 8 tests.
- `DATABASE_URL=postgres:///syncos_partner_scope_test API_BASE_URL=http://localhost:3137 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run security:smoke` - passed.
- `DATABASE_URL=postgres:///syncos_partner_scope_test API_BASE_URL=http://localhost:3137 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run organization:smoke` - passed.
- `DATABASE_URL=postgres:///syncos_partner_scope_test API_BASE_URL=http://localhost:3137 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run sprint4:smoke` - failed because Sprint 4 smoke asserts an empty database-wide project/work-order/production baseline, while the E2E demo seed intentionally creates project/work-order/production records.
- `DATABASE_URL=postgres:///syncos_partner_scope_sprint4_test npm run db:migrate` - passed.
- `DATABASE_URL=postgres:///syncos_partner_scope_sprint4_test npm run db:seed` - passed.
- `PORT=3137 DATABASE_URL=postgres:///syncos_partner_scope_sprint4_test AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run start -w @syncos/api` - API started locally for Sprint 4 clean-database smoke.
- `DATABASE_URL=postgres:///syncos_partner_scope_sprint4_test API_BASE_URL=http://localhost:3137 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run sprint4:smoke` - passed.
- `git diff --check` - pending final run after documentation update.

No validation command was pointed at production or staging.

## Runtime Isolation Certification

### 1. Test environment used

Local PostgreSQL plus local Nest API on `http://localhost:3137`. No production, staging, shared remote database, deployment service, or nested public-site repository was used.

### 2. Database name/type

- Primary runtime isolation database: local PostgreSQL database `syncos_partner_scope_test`.
- Clean Sprint 4 smoke database: local PostgreSQL database `syncos_partner_scope_sprint4_test`.

### 3. API startup method

- Primary runtime API: `PORT=3137 DATABASE_URL=postgres:///syncos_partner_scope_test AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run start -w @syncos/api`.
- Clean Sprint 4 API: `PORT=3137 DATABASE_URL=postgres:///syncos_partner_scope_sprint4_test AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run start -w @syncos/api`.

### 4. Exact tests run

- `npm test`
- `npm run typecheck -w @syncos/api`
- `npm run build -w @syncos/api`
- `npx playwright test tests/e2e/partner-domain-scope.spec.ts`
- `npm run security:smoke`
- `npm run organization:smoke`
- `npm run sprint4:smoke`
- `git diff --check` pending final repository check.

### 5. Cross-tenant results

PASSED. Tenant A could not list, retrieve, classify, or access Tenant B Partner Organization/capacity-provider records. Tenant B list operations returned only Tenant B Partner Organization records.

### 6. Cross-Partner results

PASSED. An Organization-scoped actor for Partner Organization A could access Partner A and could not access Partner B in the same tenant.

### 7. ID-guessing results

PASSED. Guessed Organization ids, guessed capacity-provider ids, and mismatched authorized-parent/unauthorized-child combinations returned denied responses without returning unauthorized data.

### 8. Mutation-scope results

PASSED. Classification mutations revalidated tenant ownership, Organization scope, and Organization/capacity-provider linkage server-side. Body-supplied `organization_id`, query parameters, and spoofed scope headers did not broaden access.

### 9. Classification idempotency results

PASSED. Repeating the same classification request reused the existing active linkage and did not create a duplicate active `capacity_providers` record. Near-concurrent classification requests produced only one active Partner linkage.

### 10. Event/audit results

PASSED. Successful initial classification created one `partner_classification.created` event and one `partner_classification.create` audit log. Idempotent reuse did not create a second event/audit pair. Denied and invalid classification attempts did not create successful classification events.

### 11. Any defects found and corrected

- Runtime E2E initially failed with `403` because the existing global `PermissionGuard` requires the established scope header convention for organization-scoped roles. The E2E was corrected to use legitimate org-scope headers while still proving spoofed headers cannot broaden access.
- Invalid provider type initially returned `500` because validation happened before the controller converted validation failures into `BadRequestException`. The controller now returns `400`.
- Classification was idempotent but not concurrency-safe. The controller now uses a PostgreSQL advisory lock over tenant/Organization/provider type and does not emit events/audit rows for idempotent reuse.
- Sprint 4 smoke initially failed on the E2E demo database because that smoke requires a clean no-project baseline. It passed on a separate clean disposable database.

### 12. Remaining limitations

- No database uniqueness constraint was added in P1. Duplicate prevention is enforced in the server write path with an advisory lock; if later bulk imports or alternate write paths create Partner classifications, they must reuse this same domain path or add an explicitly approved database constraint.
- The global `PermissionGuard` still uses `x-scope-type`/`x-scope-id` for scoped permission evaluation. P1 mitigates broadening by resolving effective Partner Organization scope from database assignments inside `OrganizationScopeService`, but P2 should decide whether Partner-facing routes should derive guard scope entirely from authenticated context.
- P1 does not audit denied read attempts beyond current platform behavior.

### 13. Final P1 certification status

CERTIFIED

## 14. Remaining P2 prerequisites

- Define Partner Owner/Admin and Partner Foreman roles.
- Define Partner permission keys without granting access to unfinished domains.
- Add external authentication/invitation flow or approved login binding.
- Decide whether Partner Owner and Partner Admin are one role or separate roles.
- Add sensitive file authorization before exposing W-9, COI, credentials, headshots, or signed agreements.
- Add explicit Partner route group only after P2 permission boundaries are approved.

## 15. GO / NO-GO recommendation for P2

GO for P2 planning and implementation if P1 validation passes.

NO-GO for external Partner Portal UI until P2 roles, permissions, and route visibility are implemented and tested against the P1 organization-scope resolver.
