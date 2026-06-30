# Release Runbook

## Purpose

This runbook describes how to validate, certify, and promote a SyncOS release candidate. It is written for release managers and engineers executing a release.

It covers local release rehearsal, CI release certification, staging release, and production release. It does not replace the rollback runbook. If a release fails after deployment begins, use `docs/operations/rollback-runbook.md`.

## Release Rule

A release is not certified until both gates pass:

1. Release validation:

```bash
npm run release:validate
```

2. Browser release certification:

```bash
npm run e2e:ci:release
```

The browser gate must run against a correctly prepared database and live API/web services.

## Required Inputs

Before starting, collect:

- Release version.
- Target commit SHA.
- Target branch.
- Release manager.
- Database owner.
- Security owner.
- QA/certification owner.
- Operations owner.
- Product owner.
- Target environment.
- Deployment window.
- Rollback decision deadline.

## Preflight

### Confirm Repository State

```bash
git fetch origin
git status -sb
git rev-parse --short HEAD
git rev-parse --short origin/main
git diff --stat HEAD origin/main
```

Expected for a main release:

- `git status -sb` shows no local modifications.
- `HEAD` equals `origin/main`.
- `git diff --stat HEAD origin/main` prints no diff.

If local and remote differ, stop and resolve before release validation.

### Confirm Scripts Exist

```bash
npm run
```

Required scripts:

- `release:validate`
- `db:migrate`
- `db:seed`
- `seed:e2e-demo`
- `e2e:seed-smoke`
- `e2e:ci:release`
- `typecheck`
- `test`
- `build`

### Confirm Database Target

Print the database target before any migration:

```bash
node -e "console.log(process.env.DATABASE_URL || 'DATABASE_URL not set')"
```

Never run production commands if `DATABASE_URL` is unknown or points to the wrong environment.

## Local Release Rehearsal

Use local rehearsal to verify the release candidate before relying on CI.

### 1. Prepare Validation Database

Create a clean database:

```bash
createdb syncos_release_validate
```

If it already exists and is safe to replace:

```bash
dropdb syncos_release_validate --if-exists
createdb syncos_release_validate
```

### 2. Run Release Validation

```bash
DATABASE_URL=postgres:///syncos_release_validate npm run release:validate
```

This runs:

- E2E certification status check in CI mode.
- Typecheck.
- API build.
- Worker build.
- Web build.
- Unit tests.
- Migration verification.
- API startup.
- Security smoke.
- Sprint smoke scripts.
- Domain smoke scripts.

Expected final line:

```text
release validation passed
```

Failure response:

- Stop.
- Do not continue to browser release certification.
- Fix the failing validation item.
- Recreate a clean validation database before rerun unless the failure is proven unrelated to database state.

### 3. Prepare E2E Certification Database

Create a clean E2E database:

```bash
createdb syncos_e2e_release
```

If it already exists and is safe to replace:

```bash
dropdb syncos_e2e_release --if-exists
createdb syncos_e2e_release
```

Run the required setup in this order:

```bash
DATABASE_URL=postgres:///syncos_e2e_release npm run db:migrate
DATABASE_URL=postgres:///syncos_e2e_release npm run db:seed
DATABASE_URL=postgres:///syncos_e2e_release npm run seed:e2e-demo
DATABASE_URL=postgres:///syncos_e2e_release npm run e2e:seed-smoke
```

Expected seed smoke result:

```text
E2E seed smoke passed
```

### 4. Start Local Services

API:

```bash
NODE_ENV=test \
PORT=3137 \
API_BASE_URL=http://localhost:3137 \
WEB_BASE_URL=http://localhost:3138 \
NEXT_PUBLIC_API_BASE_URL=http://localhost:3137 \
SYNCOS_API_BASE_URL=http://localhost:3137 \
AUTH_JWT_SECRET=e2e-secret-for-local-testing \
DATABASE_URL=postgres:///syncos_e2e_release \
npm run start -w @syncos/api
```

Web:

```bash
NODE_ENV=test \
PORT=3138 \
API_BASE_URL=http://localhost:3137 \
WEB_BASE_URL=http://localhost:3138 \
NEXT_PUBLIC_API_BASE_URL=http://localhost:3137 \
SYNCOS_API_BASE_URL=http://localhost:3137 \
npm run start -w @syncos/web
```

Verify:

```bash
curl -fsS http://localhost:3137/health
curl -fsS -I http://localhost:3138
```

### 5. Run Browser Release Certification

```bash
API_BASE_URL=http://localhost:3137 \
WEB_BASE_URL=http://localhost:3138 \
AUTH_JWT_SECRET=e2e-secret-for-local-testing \
DATABASE_URL=postgres:///syncos_e2e_release \
npm run e2e:ci:release
```

Expected result:

```text
576 passed
```

The exact count may change when tests are intentionally added or removed. Any count change must be explained in the release notes.

Failure response:

- Stop.
- Inspect Playwright failure context.
- Inspect API logs.
- Inspect screenshots/videos/traces.
- Determine whether the failure is product behavior, seed state, selector ambiguity, environment readiness, or a real defect.
- Do not remove assertions.
- Do not add `test.skip`, `test.only`, or `.fixme`.
- Do not weaken certification.

### 6. Run Final Static Checks

```bash
node scripts/check-e2e-certification.js --ci
npm test
npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
git diff --check
git status --short
```

Expected:

- All commands pass.
- `git status --short` is empty unless the release intentionally includes uncommitted docs or generated files, which must be committed before release.

## GitHub Release Certification

Use `.github/workflows/release.yml`.

Trigger:

- GitHub Actions workflow dispatch.
- Required input: release version, for example `v1.2.3`.

The release workflow has two jobs:

1. `validate`
   - Installs dependencies.
   - Migrates release database.
   - Runs `npm run release:validate`.

2. `e2e-certify`
   - Builds API and web.
   - Migrates E2E database.
   - Runs base seed.
   - Runs E2E demo seed.
   - Runs seed smoke.
   - Installs Playwright Chromium.
   - Starts API and web.
   - Runs `npm run e2e:ci:release`.
   - Uploads Playwright HTML report.
   - Uploads JUnit XML if present.
   - Posts certification summary.

Required successful artifacts:

- `playwright-release-<version>-<run_id>`
- `junit-release-<version>-<run_id>` if generated
- GitHub step summary showing certification status

If the release workflow fails:

- Do not approve the release.
- Use the failed job logs and artifacts as the source of truth.
- Rerun only after the root cause is fixed or the infrastructure failure is proven transient.

## Staging Release Runbook

### Staging Preconditions

Required before deployment:

- Staging database exists.
- Staging secrets exist.
- Staging API target exists.
- Staging web target exists.
- Staging worker target exists or explicit "not deployed by design" decision is recorded.
- Staging logs and alerts are configured.
- Staging rollback owner is available.

### Staging Steps

1. Confirm target commit:

```bash
git fetch origin
git status -sb
git rev-parse --short HEAD
git rev-parse --short origin/main
```

2. Run release validation against staging validation database:

```bash
DATABASE_URL=<staging-validation-db-url> npm run release:validate
```

3. Back up staging database if it contains persistent data.

4. Run migrations:

```bash
DATABASE_URL=<staging-db-url> npm run db:migrate
```

5. Deploy API artifact.

6. Verify API:

```bash
curl -fsS <staging-api-url>/health
```

7. Deploy worker artifact.

8. Verify worker logs.

9. Deploy web artifact.

10. Verify web:

```bash
curl -fsS -I <staging-web-url>
```

11. Run production-safe smoke checks or staging E2E certification against an isolated staging E2E database.

12. Capture artifacts:

- Deployment logs.
- API health output.
- Web health output.
- Migration logs.
- E2E report if run.
- Commit SHA.

13. Record staging decision:

- GO for production planning.
- GO with conditions.
- NO-GO.

## Production Release Runbook

### Production Preconditions

Required:

- Staging release is approved.
- Production readiness checklist is signed.
- Rollback runbook is reviewed.
- Database backup window is confirmed.
- Production secrets are present.
- Observability is live.
- Product owner has approved deployment.

### Production Steps

1. Announce release start.

2. Confirm target commit and version.

3. Confirm no active incident or release freeze.

4. Confirm production `DATABASE_URL` points to production.

5. Take production database backup.

6. Verify backup completion.

7. Run migration:

```bash
DATABASE_URL=<production-db-url> npm run db:migrate
```

8. Deploy API.

9. Verify API:

```bash
curl -fsS <production-api-url>/health
```

10. Deploy worker.

11. Verify worker logs.

12. Deploy web.

13. Verify web:

```bash
curl -fsS -I <production-web-url>
```

14. Run production-safe smoke checks.

15. Monitor release window:

- API health.
- Web health.
- Worker logs.
- 5xx rate.
- Database errors.
- Auth errors.

16. Make release decision:

- GO: release accepted.
- Rollback: use rollback runbook.
- Forward-fix: only if rollback is riskier and owner approval is recorded.

17. Announce release result.

## Release Evidence Template

| Item | Value |
|---|---|
| Version |  |
| Commit SHA |  |
| Branch |  |
| Release manager |  |
| Target environment |  |
| Release validation result | PASS / FAIL |
| E2E release certification result | PASS / FAIL |
| API build result | PASS / FAIL |
| Worker build result | PASS / FAIL |
| Web build result | PASS / FAIL |
| Database migration result | PASS / FAIL |
| Backup ID |  |
| Artifact links |  |
| Decision | GO / GO WITH CONDITIONS / NO-GO / ROLLBACK |
| Notes |  |

## Post-Release Tasks

After GO:

- Confirm worktree and remote are synced.
- Confirm release notes are posted.
- Confirm artifacts are retained.
- Confirm alerts stayed quiet during the release window.
- Confirm product owner receives release evidence.

After rollback:

- Preserve logs.
- Preserve failed artifacts.
- Record rollback reason.
- Open follow-up issues.
- Do not retry deployment without a root-cause decision.

## Commands Quick Reference

Local static checks:

```bash
node scripts/check-e2e-certification.js --ci
npm test
npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
```

Release validation:

```bash
DATABASE_URL=<clean-validation-db> npm run release:validate
```

E2E database setup:

```bash
DATABASE_URL=<clean-e2e-db> npm run db:migrate
DATABASE_URL=<clean-e2e-db> npm run db:seed
DATABASE_URL=<clean-e2e-db> npm run seed:e2e-demo
DATABASE_URL=<clean-e2e-db> npm run e2e:seed-smoke
```

Browser release gate:

```bash
DATABASE_URL=<clean-e2e-db> API_BASE_URL=<api-url> WEB_BASE_URL=<web-url> AUTH_JWT_SECRET=<secret> npm run e2e:ci:release
```

Final repository checks:

```bash
git diff --check
git status -sb
git status --short
```

