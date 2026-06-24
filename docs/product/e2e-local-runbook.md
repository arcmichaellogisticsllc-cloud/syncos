# Browser E2E Local Runbook

## Prerequisites

* PostgreSQL available locally.
* Repo dependencies installed with `npm install`.
* Playwright browser installed locally when browser execution is needed:

```bash
npx playwright install chromium
```

Browser binaries are local tooling and must not be committed.

## Fresh Database

```bash
dropdb syncos_e2e_demo --if-exists
createdb syncos_e2e_demo
DATABASE_URL=postgres:///syncos_e2e_demo npm run db:verify
DATABASE_URL=postgres:///syncos_e2e_demo npm run seed:e2e-demo
DATABASE_URL=postgres:///syncos_e2e_demo npm run e2e:seed-smoke
```

`db:verify` requires an empty database. `seed:e2e-demo` runs after `db:verify` and adds the ARC SyncOS Demo Tenant and Cedar Ridge records.

## Start API

Build first if needed:

```bash
npm run build -w @syncos/api
```

Start API:

```bash
DATABASE_URL=postgres:///syncos_e2e_demo AUTH_JWT_SECRET=e2e-secret-for-local-testing PORT=3137 npm run start -w @syncos/api
```

## Start Web

In another terminal:

```bash
WEB_BASE_URL=http://localhost:3138 SYNCOS_API_BASE_URL=http://localhost:3137 PORT=3138 npm run dev -w @syncos/web
```

## Run Browser E2E

```bash
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:route-matrix
```

Critical skeletons:

```bash
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:critical
```

Full foundation suite:

```bash
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e
```

Expanded certification groups:

```bash
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:hydration
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:personas
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:lifecycle
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:boundaries
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:timeline-audit
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:certification
```

Debug:

```bash
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:headed
DATABASE_URL=postgres:///syncos_e2e_demo API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:debug
```

## Artifact Locations

* HTML report: `playwright-report/`
* Test output, screenshots, videos, traces: `test-results/`
* Runtime auth storage: `tests/e2e/.auth/`

These paths are gitignored.

## Known Limitations

* This is a foundation suite, not full E2E certification.
* High-risk modal opening/required-field certification is implemented for representative payment, bank reconciliation, and accounting export actions.
* No browser test is wired into `release:validate` yet.
* Auth uses seeded users and runtime JWT storage state. No production login behavior was added.
* Boundary assertions include expanded page-inspection and source-snapshot checks. Full before/after action certification for every lifecycle modal remains future scope.
