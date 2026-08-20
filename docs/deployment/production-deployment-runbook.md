# Production Deployment Runbook

## Pre-Deploy

1. Confirm main and public-site commits approved.
2. Confirm DB backup and file backup.
3. Confirm production secrets in provider secret manager.
4. Confirm `LIVE_AUTOMATED_PARTNER_PAYMENTS=false`.
5. Confirm email provider status.
6. Confirm public inquiry edge protection.
7. Confirm worker singleton deployment plan.

## Deploy Order

1. Backups confirmed.
2. Secrets validated.
3. DB migration with `npm run release:production:migrate`.
4. API deploy.
5. Worker deploy.
6. Web app deploy.
7. Public website deploy.
8. Health checks.
9. Worker scheduler checks.
10. Public inquiry smoke.
11. Invite smoke.
12. Login smoke.
13. Field smoke.
14. Finance smoke.
15. Command Center smoke.

## Rollback

- Roll back web/API/worker artifacts through platform controls.
- Disable public inquiry at the edge if intake is unhealthy.
- Stop worker if scheduler churn is unsafe.
- Keep payment execution disabled.
- Do not promise destructive DB rollback. Preserve database and forward-fix unless restore is explicitly chosen by incident lead.

## Verification

Use synthetic records for smoke tests. Do not run demo seed against production.
