# Staging Deployment Dry Run Plan

## 1. Dry-Run Objective

Rehearse staging deployment steps without creating cloud services, configuring DNS, provisioning a remote database, setting provider secrets, or deploying SyncOS.

## 2. What Will Be Simulated Locally

- Repo preflight.
- Static staging readiness checks.
- Static staging implementation plan checks.
- Build and typecheck.
- Fresh local database migrate/seed/smoke.
- Full local release E2E gate.
- Mock provider, secrets, tenant/admin, and UAT start checklists.

## 3. What Will Not Be Done

- No live deployment.
- No cloud infrastructure.
- No paid services.
- No DNS.
- No provider secrets.
- No remote database migrations.
- No real tenant or user creation.

## 4. Local Commands

```bash
npm run staging:check
npm run staging:plan:check
node scripts/check-e2e-certification.js --ci
npm test
npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
dropdb syncos_staging_plan --if-exists
createdb syncos_staging_plan
DATABASE_URL=postgres:///syncos_staging_plan AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run db:migrate
DATABASE_URL=postgres:///syncos_staging_plan AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run db:seed
DATABASE_URL=postgres:///syncos_staging_plan AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run seed:e2e-demo
DATABASE_URL=postgres:///syncos_staging_plan AUTH_JWT_SECRET=e2e-secret-for-local-testing npm run e2e:seed-smoke
npm run e2e:ci:release -- --reporter=line
```

## 5. Mock Provider Checklist

- Provider selected on paper.
- Web/API/Worker service names drafted.
- Managed Postgres tier drafted.
- Logs location drafted.
- Backup setting drafted.
- Rollback option drafted.

## 6. Mock Secrets Checklist

- Secret names mapped.
- Secret owners identified.
- No secret values entered into repo.
- Dev auth disabled in staging plan.
- Public env values separated from secrets.

## 7. Mock Tenant / Admin Checklist

- Tenant name approved on paper.
- Admin placeholder approved on paper.
- Persona users approved on paper.
- Bootstrap method selected on paper.
- Password/reset process selected on paper.

## 8. PASS / PARTIAL / FAIL Criteria

- PASS: all local checks pass, planning docs exist, no secrets/artifacts are committed, and approval gate is ready for Mike.
- PARTIAL: local checks pass but one or more approval decisions remain open.
- FAIL: static checks fail, release gate fails, secrets are detected, or deployment actions are attempted.

## 9. Issues To Resolve Before Real Deployment

- Provider approval.
- DB provider approval.
- Secrets process approval.
- Bootstrap method verification.
- Backup/restore drill plan.
- GitHub Actions validation.
- Branch protection.

Dry run does not deploy anything.
