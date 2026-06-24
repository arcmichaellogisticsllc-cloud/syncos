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
WEB_BASE_URL=http://localhost:3138 NEXT_PUBLIC_API_BASE_URL=http://localhost:3137 PORT=3138 npm run dev -w @syncos/web
```

If the web app uses a different API base environment variable in a future sprint, update this runbook with the actual supported variable.

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
* No deep modal certification is implemented yet.
* No browser test is wired into `release:validate` yet.
* Auth uses seeded users and runtime JWT storage state. No production login behavior was added.
* Boundary assertions are table-count smoke checks; full before/after action certification remains future scope.
