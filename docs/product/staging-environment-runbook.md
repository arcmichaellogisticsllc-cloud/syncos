# Staging Environment Runbook

## Required Services

- API service for `@syncos/api`.
- Web service for `@syncos/web`.
- Worker service for `@syncos/worker` if active in the selected staging topology.
- PostgreSQL database.
- Optional managed logs and managed backups.

## Recommended Architecture

Preferred:

- Managed PostgreSQL.
- Web on Vercel or equivalent.
- API and worker on Render, Railway, Fly.io, or equivalent.
- Provider-managed secrets for all runtime values.

Alternative:

- Single VPS or container host.
- Managed PostgreSQL preferred.
- Reverse proxy, TLS/SSL, process manager, and deploy logs.

## Required Environment Variables

Use placeholders only in docs. Store real values in the provider secret manager.

```bash
NODE_ENV=production
DATABASE_URL=<staging-postgres-url>
AUTH_JWT_SECRET=<strong-staging-secret>
API_BASE_URL=<staging-api-url>
WEB_BASE_URL=<staging-web-url>
SYNCOS_API_BASE_URL=<staging-api-url>
NEXT_PUBLIC_API_BASE_URL=<staging-api-url>
NEXT_PUBLIC_ALLOW_DEV_SESSION_PANEL=false
ALLOW_DEV_HEADER_AUTH=false
CI=true # CI contexts only
PORT=<provider-assigned>
```

## Startup Sequence

1. Select target commit and confirm it matches `main`.
2. Install dependencies with `npm ci`.
3. Build: `npm run build -w @syncos/api`, `npm run build -w @syncos/worker`, `npm run build -w @syncos/web`.
4. Back up or snapshot the staging database if it already contains data.
5. Apply migrations with `DATABASE_URL=<staging-db> npm run db:migrate`.
6. Run base/system seed only after confirming no default local-development admin credentials will be used for real staging.
7. Start API.
8. Start web.
9. Start worker if required.
10. Run health checks and staging smoke tests.

## Health Checks

- API health endpoint responds.
- Web loads the shell without developer session UI.
- Auth/session behavior works for a known staging admin.
- Tenant isolation smoke passes.
- Role permissions smoke passes.
- Operator workbench smoke passes.
- External integrations are disabled and no workflow suggests external money movement or posting.

## Reset Policy

Reset staging only during scheduled windows. Back up first when the environment contains UAT findings or records worth preserving. Never run destructive E2E against shared staging traffic data.

## Rollback Policy

1. Stop new writes if needed.
2. Revert application services to the previous known-good commit.
3. Restore DB backup only if migrations or data changes require it.
4. Run smoke tests.
5. Record incident, cause, and follow-up.

## Open Decisions

- Final hosting provider.
- Staging domain.
- Staging DB provider.
- Auth method.
- Admin bootstrap mechanism.
- Worker requirement and schedule.
- Backup cadence and retention.
