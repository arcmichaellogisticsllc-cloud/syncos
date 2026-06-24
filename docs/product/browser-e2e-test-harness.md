# Browser E2E Test Harness

Status: foundation implemented.

Current validated commit at sprint start: `df030878aa898103de585cf51acd8bf1a7af9106`.

## Repository Inventory

| Area | Current state | Classification | Notes |
| --- | --- | --- | --- |
| Root package scripts | Typecheck, build, db verify, domain smokes, release validation, and Browser E2E scripts now exist. | Supported | Browser E2E is not wired into `release:validate` yet. |
| API package scripts | API build/start and all smoke scripts through Accounting Export exist. | Supported | Smokes use HMAC JWTs from `AUTH_JWT_SECRET`. |
| Web package scripts | Next build/typecheck/dev exist. | Supported | No production UI routes were added for E2E. |
| Existing test dependencies | Node test runner existed; `@playwright/test` was added as dev dependency. | Supported | Browser binaries are not committed. |
| Existing tests directory | Regression tests existed; `tests/e2e` now contains Playwright foundation tests. | Supported | Full modal certification remains future scope. |
| Release validation | Builds API/worker/web, runs db verify and all domain smokes. | Supported | Browser E2E remains a separate CI-ready command. |
| Database seed | Baseline Jackson Telcom seed existed; `seed:e2e-demo` now adds ARC/Cedar Ridge tenant data after `db:verify`. | Supported | No migrations were added. |
| Permission seed | Global permissions and roles are seeded by baseline seed. | Supported | E2E seed creates tenant-scoped persona roles from existing permission keys. |
| Auth/token pattern | Backend accepts HMAC bearer JWTs for active tenant users. | Supported | E2E uses runtime-generated JWT storage state; no login workflow was added. |
| Existing E2E docs | Clarification docs are committed and treated as source of truth. | Supported | Implementation follows Hybrid Option D. |
| Physical QA report | Route-load QA and release validation already passed before this sprint. | Supported | Browser click certification remains partial/foundation only. |
| Web route structure | Existing workspace routes cover the route matrix. | Supported | No new UI routes were created. |
| Login/auth flow | No first-class browser login flow exists. | Partially supported | E2E uses storage state matching current workspace token/session pattern. |
| API base URL behavior | Web client uses configured API base behavior in existing helpers. | Supported | Tests require `API_BASE_URL` for auth setup. |
| Dev server start commands | API starts via `npm run start -w @syncos/api`; web starts via `npm run dev -w @syncos/web` or built Next start if added later. | Partially supported | Root concurrent start script is not added. |

## Harness

Playwright is configured in `playwright.config.ts`.

Default behavior:

* `testDir`: `tests/e2e`
* Chromium only
* one worker
* no local retries
* one retry in CI
* screenshots on failure
* video retained on failure
* trace on first retry
* HTML report
* JUnit report in CI

Environment:

* `WEB_BASE_URL` defaults to `http://localhost:3138`.
* `API_BASE_URL` is required by auth setup.
* `AUTH_JWT_SECRET` is required by auth setup.
* `DATABASE_URL` is required for seed validation and DB boundary assertions.

## Implemented Tests

* `tests/e2e/auth.spec.ts`
* `tests/e2e/route-matrix.spec.ts`
* `tests/e2e/persona-visibility.spec.ts`
* `tests/e2e/boundary-assertions.spec.ts`
* `tests/e2e/workflows/growth-to-opportunity.spec.ts`
* `tests/e2e/workflows/opportunity-to-project.spec.ts`
* `tests/e2e/workflows/project-to-qc.spec.ts`
* `tests/e2e/workflows/revenue-cycle.spec.ts`
* `tests/e2e/workflows/cost-labor-payment.spec.ts`
* `tests/e2e/workflows/bank-reconciliation.spec.ts`
* `tests/e2e/workflows/accounting-export.spec.ts`

## Implemented Boundary Helpers

`tests/e2e/helpers/boundary-assertions.ts` captures and compares tenant-scoped table counts for allowlisted domain tables.

Current boundary smoke verifies:

* Payment Execution page inspection does not create bank transactions, reconciliation matches, or accounting exports.
* Bank Reconciliation page inspection does not create accounting exports.
* Accounting Export page inspection does not mutate invoices, cash receipts, payment batches, or bank transactions.

Full action-level boundary certification remains future scope.

## Current Limitations

The initial route matrix asserts HTTP success, absence of runtime/404 failures, visible app shell content, and stable route/domain text. Some existing detail workspaces still show a session prompt or "not found or no access" message until their local workspace session controls are applied. The foundation does not add production login behavior or rewrite those workspaces. Full seeded detail hydration is therefore a follow-up certification requirement, not silently treated as completed.
