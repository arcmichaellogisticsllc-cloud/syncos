# Browser E2E CI Runbook

## Purpose

This runbook documents CI-ready Browser E2E commands. It does not add a CI workflow file in this sprint.

## Required Services

* Node.js matching repo expectations.
* PostgreSQL service.
* Browser runtime capable of running Playwright Chromium.

## Recommended PR Tier

1. Checkout repo.
2. Install dependencies.
3. Install Chromium browser.
4. Create fresh database.
5. Run db verify.
6. Run Cedar Ridge E2E seed.
7. Run seed smoke.
8. Build API and web.
9. Start API and web.
10. Run route matrix, critical skeleton tests, minimum persona tests, and boundary smoke.
11. Upload failure screenshots/videos/traces.
12. Drop database.

Example:

```bash
npm ci
npx playwright install chromium
createdb syncos_e2e_${GITHUB_RUN_ID}
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} npm run db:verify
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} npm run seed:e2e-demo
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} npm run e2e:seed-smoke
npm run build -w @syncos/api
npm run build -w @syncos/web
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} AUTH_JWT_SECRET=e2e-secret-for-ci PORT=3137 npm run start -w @syncos/api
WEB_BASE_URL=http://localhost:3138 SYNCOS_API_BASE_URL=http://localhost:3137 PORT=3138 npm run dev -w @syncos/web
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-ci npm run e2e:route-matrix
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-ci npm run e2e:critical
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-ci npm run e2e:personas
DATABASE_URL=postgres:///syncos_e2e_${GITHUB_RUN_ID} API_BASE_URL=http://localhost:3137 WEB_BASE_URL=http://localhost:3138 AUTH_JWT_SECRET=e2e-secret-for-ci npm run e2e:boundaries
```

CI must use its own process manager or shell backgrounding to keep API and web running. Do not add broad sleeps; wait for HTTP readiness in the CI workflow when it is created.

## Nightly Certification Tier

Run:

```bash
npm run e2e:hydration
npm run e2e:lifecycle
npm run e2e:timeline-audit
npm run e2e:certification
npm run e2e
```

Nightly should retain traces/videos for failures and may retain full artifacts for certification review once the suite becomes certification grade.

## Release Certification Tier

Before external integrations are started, release certification should include:

* `npm run release:validate`
* full Browser E2E suite
* all required personas
* full action-level boundary assertions
* artifact upload

## Artifact Retention

PR tier:

* screenshots on failure
* videos retained on failure
* traces on retry/failure

Nightly/release:

* retain canonical screenshots
* retain full videos and traces as configured by CI policy

## Cleanup

Drop the run database:

```bash
dropdb syncos_e2e_${GITHUB_RUN_ID} --if-exists
```
