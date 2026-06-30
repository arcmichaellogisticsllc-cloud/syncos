# Production Readiness Checklist

## Purpose

This checklist defines the minimum operational, release, security, data, and certification conditions that must be true before SyncOS is promoted beyond local or CI validation.

It is intentionally stricter than a successful local E2E run. A passing release gate proves the current build can satisfy the automated suite in a controlled environment. Production readiness also requires environment ownership, backup and rollback planning, secrets control, observability, deployment rehearsal, and signoff.

## Current Readiness Position

Current baseline:

- Main branch is expected to be clean and synced before release work begins.
- Release validation is implemented through `npm run release:validate`.
- Browser release certification is implemented through `npm run e2e:ci:release`.
- CI, nightly, and release workflows provision PostgreSQL, run migrations, seed required E2E data, start API and web, and execute the configured gates.
- E2E seed order is:
  1. `npm run db:migrate`
  2. `npm run db:seed`
  3. `npm run seed:e2e-demo`
  4. `npm run e2e:seed-smoke`

Readiness classification until staging is rehearsed:

- GO for continued staging deployment planning.
- NO-GO for production traffic until staging deployment, backup restore, observability, and rollback rehearsal pass.

## Required Readiness Owners

Every production release must identify owners before deployment.

| Area | Required Owner | Signoff Required |
|---|---|---|
| Release manager | Person coordinating the release | Yes |
| Application engineering | API, web, worker deployability | Yes |
| Database owner | Migration, backup, restore, data safety | Yes |
| Security owner | Secrets, auth, audit exposure, access policy | Yes |
| QA/certification owner | Release validation and E2E evidence | Yes |
| Operations owner | Monitoring, incident response, rollback execution | Yes |
| Product owner | Business GO/NO-GO acceptance | Yes |

No production release should proceed with an unowned row.

## Readiness Tiers

### Local Release Gate Ready

This tier means an engineer can validate the build locally.

Required:

- `npm run release:validate` passes against a clean validation database.
- `npm run e2e:ci:release` passes against a clean E2E database with local API and web services.
- `node scripts/check-e2e-certification.js --ci` passes.
- `npm test` passes.
- `npm run typecheck` passes.
- `npm run build -w @syncos/api` passes.
- `npm run build -w @syncos/worker` passes.
- `npm run build -w @syncos/web` passes.
- `git diff --check` passes.
- Worktree is clean.

This tier is necessary but not sufficient for production.

### CI Release Gate Ready

This tier means GitHub Actions can reproduce release validation.

Required:

- `.github/workflows/ci.yml` PR gate passes.
- `.github/workflows/nightly.yml` nightly gate passes on `main`.
- `.github/workflows/release.yml` release validation and E2E certification jobs pass.
- Release artifacts are uploaded.
- Release summary is generated.
- No skipped, only, or fixme E2E tests are present.
- No `forbiddenTables: []` certification escapes are present.

This tier is necessary before staging promotion.

### Staging Deployment Ready

This tier means the application can be deployed to a production-like environment.

Required:

- Staging infrastructure exists for API, web, worker, and PostgreSQL.
- Staging uses production-like secrets, not local test secrets.
- Staging database can be backed up and restored.
- Migrations run against staging successfully.
- API, web, and worker start from built artifacts.
- Staging health checks pass.
- Staging smoke tests pass.
- Browser E2E release gate passes against staging URLs or a staging-equivalent isolated database and service set.
- Observability captures API logs, worker logs, web errors, health status, and deploy version.
- Rollback rehearsal has been performed at least once.

This tier is required before any production deployment attempt.

### Production Traffic Ready

This tier means the system is ready for real users and real data.

Required:

- All staging deployment requirements pass.
- Production infrastructure is provisioned and documented.
- Production database backup and restore are verified.
- Production secrets are present in the runtime secret store.
- Production migration plan is approved.
- Production rollback plan is approved.
- Production monitoring and alerts are live.
- Initial access control and admin user policy are approved.
- E2E demo seed is explicitly blocked from production unless a release manager grants a one-time emergency exception for a non-user-facing validation database.
- Product owner signs GO for the release.

## Environment Readiness

### Required Runtime Components

| Component | Required | Notes |
|---|---:|---|
| Node.js runtime | Yes | Must match repo-supported major version. CI currently uses Node 20. |
| PostgreSQL | Yes | CI currently uses PostgreSQL 16. Production must define managed service and backup policy. |
| API service | Yes | Runs `@syncos/api`. |
| Web service | Yes | Runs `@syncos/web`. |
| Worker service | Yes | Runs `@syncos/worker`; no production deployment should omit worker ownership. |
| Browser runtime | CI only | Required for Playwright certification gates. |
| Secret store | Yes | Production must not use local `.env` files as the source of truth. |
| Artifact storage | Yes | Required for release certification artifacts. |

### Required Environment Variables

| Variable | API | Web | Worker | CI/E2E | Production Notes |
|---|---:|---:|---:|---:|---|
| `NODE_ENV` | Yes | Yes | Yes | Yes | Production should use `production`; CI uses `test`. |
| `DATABASE_URL` | Yes | No | Yes | Yes | Must point to the intended environment database. |
| `AUTH_JWT_SECRET` | Yes | No | Depends on worker auth use | Yes | Must be strong, private, rotated by policy. |
| `PORT` | Yes | Yes | No | Yes | API and web ports must be unique per service. |
| `API_BASE_URL` | Yes for validation scripts | Optional | Optional | Yes | Used by smoke/E2E helpers. |
| `SYNCOS_API_BASE_URL` | No | Yes | No | Yes | Web server proxy target. |
| `WEB_BASE_URL` | Optional | Yes for E2E | No | Yes | Used by E2E tests. |
| `NEXT_PUBLIC_API_BASE_URL` | No | If browser direct API config is used | No | Local/E2E | Must not expose private credentials. |

Production readiness requires a final environment matrix for the chosen hosting provider. This document records current repo-level requirements, not provider-specific secret names.

### Forbidden Production Values

The following values are acceptable only in local or CI validation:

- `release-validation-secret`
- `e2e-secret-for-ci`
- `e2e-secret-for-local-testing`
- `postgres:postgres`
- Any `syncos_e2e_*` database name for production traffic
- Any canonical E2E demo seed used as production bootstrap data

## Database Readiness

### Migration Requirements

Before staging:

- `npm run db:verify` must pass.
- `npm run db:migrate` must be tested against a fresh database.
- `npm run db:migrate` must be tested against a database representing the prior deployed version.

Before production:

- A database backup must be taken and verified.
- Migration duration estimate must be recorded.
- Locking risk must be assessed.
- Destructive changes must have explicit approval.
- A forward-fix plan must exist for any migration that cannot be rolled back safely.

### Seed Requirements

Base seed:

- `npm run db:seed` creates base permissions/catalog data required by app auth and E2E validation.
- It is permitted only if the target environment explicitly requires baseline permissions/catalog data and the script is approved for that environment.

E2E demo seed:

- `npm run seed:e2e-demo` is for deterministic browser certification only.
- It must not run against production traffic databases.
- It may run against CI, local validation, and isolated staging certification databases.

Seed smoke:

- `npm run e2e:seed-smoke` must pass after E2E seeding in every browser certification environment.

### Backup And Restore Requirements

Production is not ready until:

- A backup can be taken on demand.
- A backup can be restored into an isolated database.
- The restored database can pass at least API health and read-only smoke checks.
- Restore time objective is recorded.
- Restore point objective is recorded.

## Application Readiness

### API

Required checks:

- `npm run build -w @syncos/api`
- API starts from built output through `npm run start -w @syncos/api`.
- `/health` returns success.
- `/health/db` returns success where available.
- Startup logs do not contain unhandled exceptions.
- Runtime uses the intended `DATABASE_URL`.

### Web

Required checks:

- `npm run build -w @syncos/web`
- Web starts from built output through `npm run start -w @syncos/web`.
- Root URL responds.
- Web can reach API through configured base URL.
- Browser route matrix has no fatal route-health failures.

### Worker

Required checks:

- `npm run build -w @syncos/worker`
- Worker deployment unit is defined.
- Worker startup command is defined for the target host.
- Worker logging destination is defined.
- Worker failure/retry policy is defined.

No production deployment is complete if the worker is silently omitted.

## Certification Readiness

Required local gate:

```bash
node scripts/check-e2e-certification.js --ci
npm test
npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
```

Required release validation gate:

```bash
DATABASE_URL=<clean-validation-db> npm run release:validate
```

Required browser release gate:

```bash
DATABASE_URL=<clean-e2e-db> npm run db:migrate
DATABASE_URL=<clean-e2e-db> npm run db:seed
DATABASE_URL=<clean-e2e-db> npm run seed:e2e-demo
DATABASE_URL=<clean-e2e-db> npm run e2e:seed-smoke
DATABASE_URL=<clean-e2e-db> API_BASE_URL=<api-url> WEB_BASE_URL=<web-url> AUTH_JWT_SECRET=<e2e-secret> npm run e2e:ci:release
```

Required release count:

- 100% pass.
- No critical failures.
- No workflow blockers.
- No forbidden downstream creation.
- No unauthorized audit/data leak.
- No test skip/only/fixme.
- No empty forbidden table assertions.

## Security Readiness

Required:

- Production secrets are not committed.
- CI secrets are stored in GitHub Actions secrets or equivalent provider secret store.
- Production `AUTH_JWT_SECRET` is unique and not shared with staging or CI.
- Database credentials are least-privilege for app runtime.
- Migration credentials are separated from runtime credentials if the platform supports it.
- Audit routes are denied to unauthorized personas.
- Read-only persona cannot mutate through UI or backend.
- Logs do not print bearer tokens or secrets.
- Playwright artifacts do not contain production secrets.

## Observability Readiness

Minimum required signals:

- API process up/down.
- Web process up/down.
- Worker process up/down.
- API `/health`.
- API DB health.
- HTTP 5xx rate.
- HTTP 4xx rate by route family.
- Unhandled exception count.
- Database connection errors.
- Migration failure.
- Worker job failure.
- Release version or commit SHA.

Minimum required alerts:

- API health failing for more than 2 consecutive checks.
- Web unavailable for more than 2 consecutive checks.
- Worker process down.
- DB health failing.
- Sustained 5xx increase.
- Failed deployment.
- Failed migration.

## Artifact Readiness

Required release artifacts:

- GitHub release workflow summary.
- Playwright HTML report.
- JUnit XML if generated.
- Failure screenshots.
- Failure videos.
- Failure/retry traces.
- Release validation logs.
- Commit SHA.
- Database migration version.
- Build logs for API, web, and worker.

Release certification artifacts must be retained according to workflow policy. Current release workflow retains Playwright HTML and JUnit XML for 90 days.

## GO/NO-GO Checklist

| Check | GO Requirement | Status |
|---|---|---|
| Repo status | Clean and synced with `origin/main` | Pending per release |
| Static checks | Typecheck, builds, unit tests pass | Pending per release |
| Release validation | `npm run release:validate` passes | Pending per release |
| Browser release gate | `npm run e2e:ci:release` passes | Pending per release |
| Database backup | Backup taken and restore tested | Required before production |
| Migrations | Dry-run and production plan approved | Required before production |
| Secrets | Production secrets loaded and reviewed | Required before production |
| Observability | Health, logs, metrics, alerts configured | Required before production |
| Rollback | Rollback runbook rehearsed | Required before production |
| Product signoff | Explicit GO from product owner | Required before production |

## Production NO-GO Conditions

Any of the following blocks production:

- Failed release validation.
- Failed E2E release gate.
- Any critical route 500.
- Any tenant isolation failure.
- Any unauthorized mutation.
- Any unauthorized audit/data exposure.
- Any forbidden downstream creation.
- Missing production backup.
- Unverified restore.
- Unknown migration rollback or forward-fix path.
- Missing production secrets.
- Missing API/web/worker health monitoring.
- Unknown deployment owner.
- Dirty worktree or unpushed release commit.

## Signoff Template

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Release manager |  | GO / NO-GO |  |  |
| Application engineering |  | GO / NO-GO |  |  |
| Database owner |  | GO / NO-GO |  |  |
| Security owner |  | GO / NO-GO |  |  |
| QA/certification owner |  | GO / NO-GO |  |  |
| Operations owner |  | GO / NO-GO |  |  |
| Product owner |  | GO / NO-GO |  |  |

