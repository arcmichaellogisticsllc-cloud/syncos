# Deployment Plan

## Purpose

This document defines the intended deployment shape for SyncOS and the operational decisions that must be made before staging or production promotion.

It does not prescribe a hosting vendor. It defines the components, boundaries, environment configuration, deployment order, validation gates, and open decisions required for a production-grade deployment.

## Deployment Principles

- Deploy built artifacts, not development servers.
- Run database migrations before application traffic is promoted.
- Keep API, web, worker, and database as separately observable deployment units.
- Use isolated databases per environment.
- Never run E2E demo seed against production traffic data.
- Treat browser E2E release certification as a deployment gate, not as a replacement for runtime observability.
- Prefer forward-only database recovery unless a migration has an explicitly rehearsed rollback.
- Do not begin external integrations until Release Certified status is achieved in the target environment.

## Environments

### Local

Purpose:

- Developer validation.
- Local release gate rehearsal.
- Debugging E2E failures.

Typical URLs:

- API: `http://localhost:3137`
- Web: `http://localhost:3138`

Typical database:

- `postgres:///syncos_e2e_local_cert`

Allowed seeds:

- `npm run db:seed`
- `npm run seed:e2e-demo`

Production data:

- Forbidden.

### CI

Purpose:

- Pull request validation.
- Main branch validation.
- Nightly certification.
- Release certification.

Current provider:

- GitHub Actions.

Current database:

- PostgreSQL service container.

Allowed seeds:

- Base permissions/catalog seed.
- E2E demo seed for browser certification jobs.

Production data:

- Forbidden.

### Staging

Purpose:

- Production-like deployment rehearsal.
- Release candidate validation.
- Migration rehearsal.
- Observability and rollback rehearsal.

Required:

- Persistent staging database.
- Independent secrets.
- API, web, and worker deployment targets.
- Logs and alerts.
- Backup/restore rehearsal.

Allowed seeds:

- Base permissions/catalog seed only if approved for staging bootstrap.
- E2E demo seed only against an isolated staging certification database, not against shared staging traffic data.

Production data:

- Only sanitized or explicitly approved data.

### Production

Purpose:

- Real users and real operational data.

Required:

- Managed PostgreSQL or equivalent operational ownership.
- Backup and restore.
- Secrets management.
- Monitoring and alerting.
- Deployment rollback procedure.
- Strict seed policy.

Allowed seeds:

- Production-approved bootstrap only.
- E2E demo seed is forbidden.

## Logical Architecture

```text
Browser
  |
  v
Web service (@syncos/web)
  |
  v
API service (@syncos/api)
  |
  v
PostgreSQL

Worker service (@syncos/worker)
  |
  v
PostgreSQL
```

## Deployment Units

### API Service

Workspace:

- `apps/api`

Build command:

```bash
npm run build -w @syncos/api
```

Start command:

```bash
npm run start -w @syncos/api
```

Required environment:

- `NODE_ENV`
- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `PORT`
- `API_BASE_URL` for validation scripts where required

Health checks:

- `GET /health`
- `GET /health/db` where enabled
- `GET /health/startup` where enabled

Deployment notes:

- API must not start against an unintended database.
- API must not log bearer tokens or secrets.
- API health must be checked before web traffic is promoted.

### Web Service

Workspace:

- `apps/web`

Build command:

```bash
npm run build -w @syncos/web
```

Start command:

```bash
npm run start -w @syncos/web
```

Required environment:

- `NODE_ENV`
- `PORT`
- `SYNCOS_API_BASE_URL`
- `WEB_BASE_URL` for E2E and release certification
- `NEXT_PUBLIC_API_BASE_URL` only if the browser build needs direct API URL configuration

Health checks:

- Root URL responds.
- Web can route API proxy calls to the API service.
- Browser route matrix passes in E2E.

Deployment notes:

- Web should not be promoted until API health is good.
- Web deployment must include the same commit SHA as API unless a controlled split deploy is explicitly approved.

### Worker Service

Workspace:

- `apps/worker`

Build command:

```bash
npm run build -w @syncos/worker
```

Start command:

- Must be defined by the chosen deployment target.

Required environment:

- `NODE_ENV`
- `DATABASE_URL`
- Any worker-specific queue, scheduler, or integration secrets once introduced.

Health checks:

- Process up.
- Worker logs are flowing.
- Job failure count is observable.

Deployment notes:

- Worker must not be omitted from production planning.
- Worker deployments should be version-aligned with API and web.
- If no production worker jobs are active yet, the service should still have an explicit "deployed idle" or "not deployed by design" decision.

### Database

System:

- PostgreSQL.

CI version:

- PostgreSQL 16.

Required commands:

```bash
npm run db:verify
npm run db:migrate
```

Base seed:

```bash
npm run db:seed
```

E2E seed:

```bash
npm run seed:e2e-demo
```

Deployment notes:

- `db:migrate` is required before app promotion.
- `db:seed` must be environment-approved.
- `seed:e2e-demo` must never target production traffic data.
- Production migration credentials should be separated from runtime credentials if possible.

## Network Boundaries

### Public

Publicly reachable:

- Web service.

Potentially public, depending on product/API strategy:

- API service.

If API is public:

- TLS required.
- Auth required for protected routes.
- Rate limiting should be evaluated.
- CORS policy must be explicit.

### Private

Private only:

- PostgreSQL.
- Worker service.
- Internal health endpoints if separated from public health endpoint.
- Secret store.

## Secrets Plan

Required secret categories:

- API JWT signing secret.
- Database runtime URL.
- Database migration URL if separated.
- Web API base URL if environment-managed.
- Future integration credentials.

Secret rules:

- Production secrets must not be shared with staging or CI.
- CI test secrets must not be reused in staging or production.
- Secrets must not be committed.
- Secrets must not appear in Playwright artifacts.
- Secret rotation owner must be known before production.

## Build And Artifact Plan

Required builds:

```bash
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
```

Build artifact requirements:

- Artifact must identify commit SHA.
- API, web, and worker artifacts should be produced from the same commit.
- Release notes must reference the commit SHA.
- Failed builds block deployment.

## Deployment Order

### Standard Order

1. Confirm target commit.
2. Confirm worktree clean and remote synced.
3. Confirm release validation passed.
4. Confirm E2E release certification passed.
5. Take database backup for persistent environments.
6. Run migration verification or dry run where supported.
7. Run `db:migrate`.
8. Deploy API.
9. Verify API health.
10. Deploy worker.
11. Verify worker process and logs.
12. Deploy web.
13. Verify web health.
14. Run post-deploy smoke checks.
15. Monitor error rate and health during the release window.
16. Record release result.

### Why API Before Web

The web service depends on API availability. Deploying API first allows:

- API health verification before web requests depend on it.
- Faster identification of database or migration issues.
- Reduced chance of web surfacing misleading route errors caused by API startup failure.

### Why Worker Before Web

Worker deployment before web ensures background processing is not lagging behind user-visible actions. If worker functions are inactive in the current product state, record that as an explicit deployment decision.

## Staging Deployment Procedure

1. Select release candidate commit.
2. Create or reset staging validation database.
3. Install dependencies:

```bash
npm ci
```

4. Run static validation:

```bash
node scripts/check-e2e-certification.js --ci
npm test
npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
```

5. Run release validation against a clean validation database:

```bash
DATABASE_URL=<staging-validation-db-url> npm run release:validate
```

6. Prepare E2E certification database:

```bash
DATABASE_URL=<staging-e2e-db-url> npm run db:migrate
DATABASE_URL=<staging-e2e-db-url> npm run db:seed
DATABASE_URL=<staging-e2e-db-url> npm run seed:e2e-demo
DATABASE_URL=<staging-e2e-db-url> npm run e2e:seed-smoke
```

7. Deploy API with staging secrets.
8. Deploy worker with staging secrets.
9. Deploy web with staging API URL.
10. Run release E2E gate:

```bash
DATABASE_URL=<staging-e2e-db-url> API_BASE_URL=<staging-api-url> WEB_BASE_URL=<staging-web-url> AUTH_JWT_SECRET=<staging-e2e-secret> npm run e2e:ci:release
```

11. Verify artifacts are captured.
12. Verify logs and alerts.
13. Run rollback rehearsal before approving production deployment.

## Production Deployment Procedure

Production deployment must be performed only after staging passes.

1. Confirm staging release candidate commit equals production target commit.
2. Confirm release manager, database owner, security owner, operations owner, and product owner are available.
3. Confirm no open NO-GO items.
4. Confirm production secrets exist.
5. Confirm backup window.
6. Take production database backup.
7. Verify backup completion.
8. Run migration plan.
9. Deploy API.
10. Verify API health.
11. Deploy worker.
12. Verify worker logs.
13. Deploy web.
14. Verify web health.
15. Run production-safe smoke checks.
16. Monitor release window.
17. Record GO, rollback, or forward-fix decision.

Production-safe smoke checks must not:

- Create fake production business records unless explicitly approved.
- Run E2E demo seed.
- Mutate money, bank, accounting, or audit-sensitive data outside an approved test tenant.

## Post-Deploy Validation

Minimum checks:

- API `/health` is healthy.
- API DB health is healthy.
- Web root responds.
- Auth permission read works for an approved production admin or smoke identity.
- One read-only route per critical domain responds.
- Worker process is healthy.
- Error logs are clean for the first release window.
- Database connection count is normal.

Critical domains:

- Intelligence
- Opportunity
- Project/work order/production
- QC
- Billable/settlement/invoice/cash
- Collections
- Contractor payable/payroll/payment execution
- Bank reconciliation
- Accounting export

## Artifact Requirements

Staging:

- Build logs.
- Migration logs.
- Release validation logs.
- E2E Playwright HTML report.
- JUnit XML if generated.
- Failure screenshots/videos/traces if any.
- Release candidate commit SHA.

Production:

- Deployment logs.
- Migration logs.
- Backup confirmation.
- Smoke check output.
- Release signoff.
- Commit SHA.
- Rollback decision record.

## Open Provider Decisions

These must be resolved before staging deployment:

- Hosting provider for API.
- Hosting provider for web.
- Hosting provider or process manager for worker.
- Managed PostgreSQL provider.
- Secret store.
- Log aggregation provider.
- Metrics provider.
- Alerting provider.
- Domain/TLS ownership.
- Environment promotion mechanism.
- Whether API is public or private behind the web layer.

## Deployment GO/NO-GO Matrix

| Condition | Staging | Production |
|---|---:|---:|
| Static checks pass | Required | Required |
| Release validation passes | Required | Required |
| E2E release gate passes | Required | Required before release approval |
| Backup exists | Recommended | Required |
| Restore tested | Required before production planning complete | Required |
| Observability active | Required | Required |
| Rollback rehearsed | Required before production planning complete | Required |
| Product signoff | Recommended | Required |

## Production NO-GO

Production deployment is blocked by:

- Staging not deployed or not validated.
- Unknown production database backup status.
- Missing production secrets.
- Missing migration plan.
- Missing rollback plan.
- Missing API/web/worker health checks.
- Failed release validation.
- Failed E2E release gate.
- Unresolved critical or workflow-blocking defect.
- Any forbidden downstream creation in certification.
- Any tenant isolation issue.

