# Staging Deployment Checklist

This checklist is for a future deployment sprint. It does not approve or perform deployment.

## A. Approval Prerequisites

- Mike approves provider.
- Mike approves architecture.
- Mike approves staging URL/subdomain.
- Mike approves staging DB provider.
- Mike approves secrets process.
- Mike approves tenant/admin bootstrap method.
- Mike approves UAT user list.
- Production remains NO-GO.
- External integrations remain NO-GO.

## B. Repo Preflight

```bash
git status -sb
git fetch origin main
git status -sb
git log -5 --oneline
npm run staging:check
npm run staging:plan:check
node scripts/check-e2e-certification.js --ci
npm test
npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
npm run e2e:ci:release -- --reporter=line
```

## C. Provider Setup

- Create staging project/app.
- Create Web service.
- Create API service.
- Create Worker service.
- Create managed Postgres.
- Configure provider-managed secrets.
- Configure logs.
- Configure backups if available.
- Do not enter secrets into repo files.

## D. Environment Variables

For each service, configure only provider-managed values:

- Web env vars.
- API env vars.
- Worker env vars.
- DB connection.
- JWT secret.
- Developer session disabled.
- Developer header auth disabled.

## E. Database Setup

- Create staging database.
- Apply migrations.
- Run safe base seed only after approving bootstrap behavior.
- Do not run `seed:e2e-demo` unless staging is intentionally demo-only.
- Document seed command, operator, date, and deployed commit.

## F. Tenant / Admin Setup

- Create Jackson Telcom Staging tenant.
- Create first admin through the approved secure method.
- Assign System Admin role.
- Create persona users.
- Verify login.
- Verify role navigation.
- Verify read-only auditor behavior.

## G. Post-Deploy Smoke

- API health works.
- Web loads.
- Worker status is known.
- No developer session UI.
- Tenant/admin login works.
- Role login works.
- Tenant isolation smoke passes.
- Core workbench smoke passes.
- Finance boundary smoke passes.
- No external integrations active.

## H. Backup / Restore

- Confirm provider backup is enabled.
- Create pre-UAT backup if available.
- Document restore command/process without secret values.
- Do not run destructive UAT without a reset plan.

## I. Rollback

- Roll back deployment artifact.
- Restore DB backup if needed.
- Verify health.
- Document incident and root cause.

## J. UAT Start Gate

UAT can begin only if:

- Staging smoke is PASS or accepted PARTIAL with documented issues.
- Admin login works.
- Persona users work.
- No developer UI appears.
- No external integrations are active.
- No critical permission defects are open.
- Local release gate remains green.
