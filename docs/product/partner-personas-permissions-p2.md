# SyncOS P2 Partner Personas, Permissions, and Route Visibility

## 1. Baseline Branch and Commit

- Branch: `feat/partner-personas-permissions-p2`
- Baseline HEAD: `4fe786d6751de1f266bb5706a095b8c3918a06d4`
- Repository root: `/Users/User/syncos`
- Excluded repository: `/Users/User/syncos/synccommsystems.com`

## 2. Existing Identity Architecture Reused

P2 reuses the existing `users`, `tenant_users`, `roles`, `permissions`, `role_permissions`, and `user_roles` tables from `001_tenants_users_roles_permissions.sql`.

No Partner user table, Partner auth database, Partner session store, or Partner tenant was added.

## 3. Partner Persona Definitions

### Partner Admin

External company-level representative for one approved Partner Organization. P2 allows only safe Partner context, own Partner Organization summary, capacity-provider status summary, action metadata, and route visibility metadata.

### Partner Foreman

External field representative for one approved Partner Organization. P2 allows only safe Partner context and route/action metadata. JSA, production, incidents, corrections, and work-order screens remain excluded.

## 4. Role Keys and Provisioning Method

- `partner_admin`
- `partner_foreman`

Provisioning uses the existing seed convention in `packages/database/scripts/seed.js`. The internal role-assignment route also idempotently ensures the tenant-local Partner role and its narrow permissions before assigning the scoped user role.

## 5. Permission Keys Added

- `partner_context.read`
- `partner_profile.read`
- `partner_actions.read`

`Partner Admin` receives all three. `Partner Foreman` receives `partner_context.read` and `partner_actions.read`.

## 6. Partner Role Scope Rules

- Partner permissions cannot be satisfied by tenant-scoped roles.
- Partner role assignments are accepted only with `scope_type = organization`.
- `scope_id` is mandatory.
- The scope must be an Organization in the authenticated tenant.
- The Organization must have an active/non-archived P1 Partner capacity-provider linkage with `provider_type` of `subcontractor` or `crew_provider`.
- Cross-tenant scope assignment is rejected.
- Partner users cannot assign, revoke, or elevate roles.
- Role removal immediately removes context access because context is resolved from live `user_roles`.

## 7. Partner Organization Eligibility Rules

P2 follows the certified P1 canonical rule: a Partner Organization is an `organizations` row in the tenant with a non-archived `capacity_providers` row linked to it where `provider_type` is `subcontractor` or `crew_provider`.

## 8. Role Assignment and Revocation Rules

Internal assignment and revocation routes are protected by `admin.manage_roles`.

- `POST /partner-personas/users/:userId/roles`
- `DELETE /partner-personas/users/:userId/roles/:roleKey/scopes/:organizationId`

Successful assignment emits `partner_role.assigned`. Successful revocation emits `partner_role.revoked`. Duplicate assignment returns the existing assignment without emitting duplicate success events.

## 9. Partner Session / Context Response

`GET /partner-personas/me/context` returns only:

- authenticated user ID and display name
- tenant ID
- persona
- authorized Partner Organization ID/name/status
- safe capacity-provider ID/name/type/status fields
- allowed P2 actions
- route visibility metadata

It does not return EIN, W-9 data, banking data, internal rates, customer rates, margin, internal scorecards, unrelated permissions, or other Partner Organizations.

## 10. Scope Selection Behavior

- Single scope: server auto-resolves the one valid Partner Organization scope.
- Multiple scope: request without selected scope returns conflict; caller must select an assigned Organization.
- Spoofed scope: rejected by the permission guard and Partner context resolver.
- Missing scope: allowed only when the user has exactly one valid Partner Organization scope.
- Tenant scope: not accepted for Partner permissions or Partner roles.

## 11. Route Visibility Matrix

| Persona | Visible P2 metadata |
|---|---|
| `partner_admin` | `partner.context`, `partner.organization`, `partner.actions` |
| `partner_foreman` | `partner.context`, `partner.actions` |

No web UI route group was added.

## 12. P1 Partner-Domain Route Classification

| Route | Classification |
|---|---|
| `GET /partner-domain/organizations` | NOT EXPOSED IN P2 |
| `GET /partner-domain/organizations/:organizationId` | NOT EXPOSED IN P2 |
| `GET /partner-domain/organizations/:organizationId/capacity-providers/:capacityProviderId` | NOT EXPOSED IN P2 |
| `POST /partner-domain/organizations/:organizationId/classify` | INTERNAL ONLY |

Partner Admin and Partner Foreman do not receive `capacity_provider.read` or `capacity_provider.create`.

## 13. Internal vs. External Permission Matrix

| Action | Internal authorized | Partner Admin | Partner Foreman |
|---|---:|---:|---:|
| Assign Partner role | Yes, with `admin.manage_roles` | No | No |
| Revoke Partner role | Yes, with `admin.manage_roles` | No | No |
| Classify Partner Organization | Existing P1 internal permission only | No | No |
| Read own Partner context | No external need; allowed only if explicitly scoped | Yes | Yes |
| Read own Partner Organization summary | No external need; allowed only if explicitly scoped | Yes | No |
| Read Partner route/actions metadata | No external need; allowed only if explicitly scoped | Yes | Yes |
| Access internal Organization list | Existing internal permission only | No | No |
| Access internal capacity-provider routes | Existing internal permission only | No | No |

## 14. Server-Side Enforcement Path

The global `PermissionGuard` treats the new Partner permissions as organization-scoped only. Tenant-scoped roles cannot satisfy them.

`PartnerPersonasController` then re-resolves context from live `tenant_users`, `user_roles`, `roles`, `role_permissions`, `permissions`, `organizations`, and `capacity_providers`. Headers and query parameters are selectors only; they are not authority.

## 15. Event and Audit Behavior

Role assignment and revocation use `executeWriteAction`, writing `events`, `event_payloads`, `audit_logs`, and `system_actions`.

Payloads include tenant ID, target user ID, tenant user ID, role ID/key, scope type, scope ID, Partner Organization ID, capacity-provider ID, actor user ID, and assignment/revocation state.

Denied assignments do not create success events.

## 16. Security and Isolation Test Matrix

Covered by `tests/e2e/partner-personas-permissions.spec.ts`:

- unauthenticated access denied
- inactive tenant membership denied
- no Partner role denied
- Partner Admin and Foreman recognized
- internal assignment allowed only with `admin.manage_roles`
- unauthorized internal and Partner role assignment denied
- tenant-scope and missing-scope assignment denied
- non-Partner and cross-tenant Organization assignment denied
- duplicate assignment idempotent without duplicate event/audit
- role revocation audited and immediately effective
- cross-Partner and cross-tenant scope spoofing denied
- internal routes and P1 classify mutation denied to Partner users
- safe context shape verified
- multiple Partner scopes require explicit selection

## 17. Runtime Validation Environment

- Local PostgreSQL database: `syncos_partner_permissions_test_p2`
- Local empty migration-verification database: `syncos_partner_permissions_verify_p2`
- Local API: `http://localhost:3137`
- API startup: `PORT=3137 DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run start -w @syncos/api`
- No production, staging, shared remote database, public-site repository, or deployment environment was used.

## 18. Exact Validation Results

- `npm test` - passed.
- `npm run typecheck -w @syncos/api` - passed.
- `npm run build -w @syncos/api` - passed.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 npm run db:migrate` - passed.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 npm run db:seed` - passed.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 npm run seed:e2e-demo` - passed.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npx playwright test tests/e2e/partner-domain-scope.spec.ts` - passed, 8 tests.
- Initial parallel P2 run failed because P1 and P2 were writing event rows concurrently in the same database. P2 was rerun alone for deterministic event/audit assertions.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npx playwright test tests/e2e/partner-personas-permissions.spec.ts` - passed, 8 tests.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 API_BASE_URL=http://localhost:3137 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run security:smoke` - passed.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 API_BASE_URL=http://localhost:3137 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run organization:smoke` - passed.
- `DATABASE_URL=postgres:///syncos_partner_permissions_test_p2 npm run db:verify` - refused populated database as expected.
- `DATABASE_URL=postgres:///syncos_partner_permissions_verify_p2 npm run db:verify` - passed.
- `git diff --check` - passed.

## 19. Files Changed

- `apps/api/src/modules/app.module.ts`
- `apps/api/src/routes/partner-personas.controller.ts`
- `apps/api/src/security/permission.guard.ts`
- `packages/database/scripts/seed.js`
- `packages/permissions/src/index.ts`
- `tests/e2e/partner-personas-permissions.spec.ts`
- `tests/partner-personas-permissions.test.js`
- `docs/product/partner-personas-permissions-p2.md`

## 20. Migrations / Seed Changes

No migration was added. P2 uses existing schema.

Seed changes add:

- `Partner Admin`
- `Partner Foreman`
- `partner_context.read`
- `partner_profile.read`
- `partner_actions.read`
- role-permission links for the two Partner roles

## 21. Explicitly Excluded P3+ Scope

No Partner Portal UI, `/partner` web routes, invitations, self-registration, W-9, payment setup, Priority Passport, insurance submission, crews, workers, credentials, agreements, PDF generation, e-signature, Work Orders, vehicle assignment, mobilization readiness, JSA, production, evidence upload, QC, corrections, incidents, settlements, payables, payments, closeout, performance scoring, or public website changes were implemented.

## 22. Remaining Risks and Limitations

- Partner roles are tenant-local rows. Existing tenant databases need the updated seed/provisioning path run or a future tenant-role provisioning command.
- Multiple Partner Organization assignments are supported only with explicit Organization selection.
- Broader internal role-management UI/routes do not exist yet; P2 adds a narrow API foundation only.
- Partner context route visibility is metadata only. No UI consumes it yet.

## Global Authorization Regression Certification

### 1. PermissionGuard change summary

The shared `PermissionGuard` change is narrowly scoped to `partner_context.read`, `partner_profile.read`, and `partner_actions.read`. Those Partner permissions require an organization-scoped role assignment and cannot be satisfied by tenant-scoped role rows. Non-Partner permissions retain the established tenant-scope or selected-scope authorization path.

### 2. Shared permissions compatibility

The three Partner permission keys are used only by `PartnerPersonasController` safe context/profile/actions endpoints. Partner roles do not receive tenant-wide Organization, capacity-provider management, Partner classification, role administration, project, work order, production, QC, settlement, payable, payment, internal reporting, rate, margin, or scorecard permissions.

### 3. Generic role-assignment path review

Repository search found no older API controller/service route that directly creates or revokes `user_roles`. P2 role assignment and revocation are handled by the narrow `PartnerPersonasController` paths, guarded by `admin.manage_roles`, self-elevation denial, Organization-scope validation, and P1 Partner eligibility checks.

### 4. Partner role invariant results

Partner Admin and Partner Foreman remain external personas, must be assigned at Organization scope, must resolve to a same-tenant eligible Partner Organization with a valid P1 capacity-provider relationship, and lose context access after role revocation, tenant membership deactivation, or Partner eligibility removal.

### 5. Session/context safe-field review

The Partner context response includes only user identity, display name, tenant ID, persona, Partner Organization ID/name, capacity-provider ID/status, allowed P2 actions, and safe route metadata. It excludes EIN, W-9, banking, insurance documents, rates, margin, financial reports, internal scorecard, other Partner Organizations, unrelated permissions, and security internals.

### 6. Root/all-workspace typecheck result

`npm run typecheck` passed.

### 7. API build result

`npm run build -w @syncos/api` passed.

### 8. Web build result

`npm run build -w @syncos/web` passed.

### 9. Persona E2E result

`npm run e2e:personas` failed on a fresh disposable database. Three persona cases passed; System Admin broad action visibility failed because `invoiceApproved` action was not visible. A read-only database check confirmed System Admin still had `invoice.mark_sent`, `production_record.submit`, and `payment_batch.mark_executed` role permissions, so the failure is in UI hydration/action visibility rather than missing seeded permission rows.

### 10. Hydration E2E result

`npm run e2e:hydration` failed on a fresh disposable database with 25 passing and 2 failing cases. The failing routes were Production Record and Billable Item detail pages, both rendering `Request failed with status 500`.

### 11. Boundary E2E result

`npm run e2e:boundaries` failed with 10 passing and 12 failing cases. The downstream creation and source mutation boundary checks passed. The failures were seeded detail/boundary-copy hydration failures across existing non-Partner operational and finance pages.

### 12. Action-state persona E2E result

`npm run e2e:action-state-personas` was started and reproduced action visibility failures on Production action states. The run was stopped after the first repeated timeout cluster to avoid a cascading multi-hour failure run.

### 13. Lifecycle E2E result

`npm run e2e:lifecycle` failed all 4 high-risk modal cases on a fresh disposable database. The failures were detail hydration failures for payment execution, bank reconciliation, and accounting export routes.

### 14. Full E2E certification result

`npm run e2e:certification` was started on the fresh disposable database and immediately reproduced Production action-state boundary failures. The run was stopped after the first repeated failure cluster because the global certification gate was already conclusively red.

### 15. Existing security/organization smoke results

`npm run security:smoke` passed. `npm run organization:smoke` passed. `npm run db:verify` passed against a separate empty disposable database.

### 16. Defects found and corrected

No additional P2 code defects were corrected during P2A. The global gate found existing shared UI hydration/action-state failures that block final certification but were not traced to a narrow Partner permission leak or cross-Partner isolation defect.

### 17. Remaining limitations

Superseded by P2B. At the end of P2A the broad shared-authorization UI regression suite was not green; P2B classified those failures as runtime/proxy configuration and completed clean certification.

### 18. Final P2 certification status

Superseded by the P2B differential regression analysis below. The P2A failures were reproduced as a runtime/proxy configuration issue, not as a P2 authorization regression.

## Differential Regression Analysis

### 1. Candidate workspace and database

- Workspace: `/Users/User/syncos`
- Branch: `feat/partner-personas-permissions-p2`
- Baseline HEAD: `4fe786d6751de1f266bb5706a095b8c3918a06d4`
- Candidate certification database: `syncos_p2b_candidate_cert`
- Empty migration-verification database: `syncos_p2b_db_verify`

### 2. Baseline workspace and database

- Baseline workspace: `/Users/User/syncos-p2-baseline-check`
- Baseline commit: `4fe786d6751de1f266bb5706a095b8c3918a06d4`
- Baseline comparison database: `syncos_p2b_baseline`

### 3. Process/port separation

- Candidate API: `http://127.0.0.1:3137`
- Candidate web: `http://127.0.0.1:3138`
- Baseline API: `http://127.0.0.1:3237`
- Baseline web: `http://127.0.0.1:3238`

### 4. Dependency isolation method

The baseline was created as a detached git worktree at the baseline commit. Dependencies were provisioned in that worktree with its own `node_modules`, build outputs, and `.next` directory. The baseline did not symlink to or reuse current P2 source files.

### 5. Candidate clean-reproduction result

The original P2A failures reproduced only when the web process was started with the wrong proxy variable: `NEXT_PUBLIC_SYNCOS_API_BASE`. The Next.js proxy reads `SYNCOS_API_BASE_URL`, so the web process fell back to `http://localhost:3100` and produced proxy `fetch failed` errors.

After restarting the candidate web process with `SYNCOS_API_BASE_URL=http://127.0.0.1:3137`, the targeted failing tests passed:

- Production detail hydration passed.
- Billable detail hydration passed.
- System Admin persona/action visibility passed.
- Production boundary copy passed.
- Payment Execution lifecycle modal passed.

### 6. Baseline comparison result

The same targeted tests passed in the isolated baseline workspace using the correct proxy variable and separate ports/databases:

- Production and Billable detail hydration: 2/2 passed.
- System Admin persona/action visibility: passed.
- Production boundary copy: passed.
- Payment Execution lifecycle modal: passed.

### 7. Failure classification for each suite

| Suite / failure cluster | Classification |
|---|---|
| Production detail `Request failed with status 500` | Environment/runtime proxy configuration |
| Billable detail `Request failed with status 500` | Environment/runtime proxy configuration |
| Boundary seeded detail/copy hydration failures | Environment/runtime proxy configuration |
| System Admin missing `invoiceApproved` action | Environment/runtime proxy configuration caused incomplete page/action hydration |
| Action-state persona visibility failures | Environment/runtime proxy configuration |
| Lifecycle seeded detail hydration failures | Environment/runtime proxy configuration |
| Full E2E certification immediate Production action-state failures | Environment/runtime proxy configuration |

### 8. Production API 500 root cause

No backend Production API regression was found in the clean candidate runtime. The prior browser-visible 500 was caused by the web proxy attempting to reach the wrong API target after being started with `NEXT_PUBLIC_SYNCOS_API_BASE` instead of `SYNCOS_API_BASE_URL`.

### 9. Billable API 500 root cause

No backend Billable API regression was found. Direct API calls to the Billable detail, timeline, and audit-summary endpoints returned HTTP 200 in the candidate runtime. The browser-visible 500 was the same web proxy misconfiguration.

### 10. invoiceApproved/action-state root cause

`invoiceApproved` remained seeded and authorized. System Admin retained the relevant baseline invoice action permissions. Under the corrected proxy setting, persona E2E and action-state persona E2E both displayed the approved invoice action correctly, and the full certification submit path marked the approved invoice sent successfully.

### 11. Seed comparison

Candidate seed row counts compared with baseline showed an additive P2 delta:

- Baseline: 31 roles, 564 permissions, 1759 role-permission links.
- Candidate: 33 roles, 567 permissions, 1773 role-permission links.
- Candidate adds `partner_admin`, `partner_foreman`, `partner_context.read`, `partner_profile.read`, and `partner_actions.read`.
- Baseline System Admin had 564 permissions; candidate System Admin had 567 permissions.
- No existing internal role permission set was reduced in the comparison.

### 12. PermissionGuard comparison

No broad PermissionGuard regression was found. The Partner-specific branch applies only to `partner_context.read`, `partner_profile.read`, and `partner_actions.read`; those permissions require valid Organization-scoped Partner role assignments and cannot fall back to tenant scope. Existing non-Partner permissions continue through the established tenant/scope evaluation path.

### 13. Defects corrected

No P2 application-code defects were corrected in P2B. The corrected runtime setup uses `SYNCOS_API_BASE_URL` for the Next.js proxy.

### 14. Files modified

Only `docs/product/partner-personas-permissions-p2.md` was modified during P2B.

### 15. Full clean certification totals

- `npm test` - passed, 16/16.
- `npm run typecheck` - passed.
- `npm run build -w @syncos/api` - passed.
- `npm run build -w @syncos/web` - passed.
- `npx playwright test tests/e2e/partner-domain-scope.spec.ts` - passed, 8/8.
- `npx playwright test tests/e2e/partner-personas-permissions.spec.ts` - passed, 8/8.
- `npm run e2e:hydration` - passed, 27/27.
- `npm run e2e:boundaries` - passed, 22/22.
- `npm run e2e:personas` - passed, 4/4.
- `npm run e2e:action-state-personas` - passed, 140/140.
- `npm run e2e:lifecycle` - passed, 4/4.
- `npm run e2e:certification` - passed, 577/577.
- `npm run security:smoke` - passed.
- `npm run organization:smoke` - passed.
- `npm run production:smoke` - passed.
- `npm run billable:smoke` - passed.
- `npm run invoice:smoke` - passed.
- `DATABASE_URL=postgres:///syncos_p2b_db_verify npm run db:verify` - passed.

### 16. Remaining limitations

- The web proxy must be started with `SYNCOS_API_BASE_URL`; `NEXT_PUBLIC_SYNCOS_API_BASE` is not consumed by `apps/web/app/api/syncos/[...path]/route.ts`.
- No P3 onboarding, compliance, crew, agreement, production, settlement, payment, Partner Portal UI, or external invitation workflows were started.

### 17. Final certification

CERTIFIED

## 23. P2 Certification Status

CERTIFIED

## 24. GO / NO-GO Recommendation for P3

GO for P3 after committing P2. P2 is now certified by clean candidate runtime validation and isolated baseline comparison. No P3 work has been started.
