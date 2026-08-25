# Hostinger VPS Staging Runbook

## Source

Deploy from `release/syncos-v0.9.0-rc1` at an explicit approved commit SHA. Do not deploy a dirty working tree.

Current local candidate at audit time:

```text
ee3d0808415d9fb8103fc22cd87d032379f64885
```

## Required Domains

- `staging-app.synccommsystems.com`
- `staging-api.synccommsystems.com`

Both domains point to the Hostinger VPS public IP after services are ready locally.

## Service Ports

| Service | Bind |
|---|---|
| Web | `127.0.0.1:3138` |
| API | `127.0.0.1:3137` |
| Worker | no public listener |
| Postgres | `127.0.0.1:5432`, `::1:5432` |
| Redis | `127.0.0.1:6379`, `::1:6379` |
| Reverse proxy | `0.0.0.0:80`, `0.0.0.0:443` |

## Environment Files

Store secrets on the VPS, never in Git:

```text
/etc/syncos/staging/api.env
/etc/syncos/staging/web.env
/etc/syncos/staging/worker.env
```

Permissions:

```text
root:root 600
```

Required staging values are listed in `docs/deployment/staging-secrets-checklist.md`.

## Build Commands

Run from the deployed release directory:

```bash
npm ci
npm run build -w @syncos/api
npm run build -w @syncos/web
npm run build -w @syncos/worker
```

## Migration

Run migrations separately from deployment:

```bash
NODE_ENV=staging DATABASE_URL=<staging-db-url-with-ssl> npm run release:staging:migrate
```

This command must not reset the database. It validates that migrations reach `059_syncfield_coil_commercial_policy.sql`.

If using local VPS Postgres, the current script expects SSL markers in `DATABASE_URL`. Either connect over SSL with an appropriate local URL marker or adjust the staging migration gate only after review.

## Synthetic Seed

Seed is a deliberate operator action, not part of every deploy:

```bash
NODE_ENV=staging STAGING_SYNTHETIC_SEED_CONFIRM=true DATABASE_URL=<staging-db-url> npm run seed:staging
```

Seed data must stay synthetic and visibly marked staging.

## systemd Units

Staging should use distinct service names:

```text
syncos-staging-api
syncos-staging-web
syncos-staging-worker
```

Do not reuse current generic `syncos-api`, `syncos-web`, or `syncos-worker` for production and staging at the same time.

## Nginx Routing

Use two server blocks:

```text
staging-app.synccommsystems.com -> http://127.0.0.1:3138
staging-api.synccommsystems.com -> http://127.0.0.1:3137
```

Set:

- proxy headers: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`
- HTTPS redirect
- reasonable body size for uploads
- no public proxy to Postgres, Redis, or worker internals

## Health Checks

```bash
curl -fsS https://staging-api.synccommsystems.com/health
curl -fsS https://staging-api.synccommsystems.com/health/db
curl -fsS https://staging-api.synccommsystems.com/health/startup
curl -fsSI https://staging-app.synccommsystems.com/login
systemctl status syncos-staging-api
systemctl status syncos-staging-web
systemctl status syncos-staging-worker
journalctl -u syncos-staging-worker -n 100 --no-pager
```

Expected result: API health is OK, startup health reports the current migration ceiling, the web login loads, and the worker is continuously running.

## Deployment Order

1. Confirm release branch and commit SHA.
2. Create a new release directory under `/opt/syncos/staging/releases/<sha>`.
3. Fetch/checkout the exact commit.
4. Install dependencies.
5. Build API, web, and worker.
6. Run migration gate.
7. Update `/opt/syncos/staging/current` atomically.
8. Restart API.
9. Restart worker.
10. Restart web.
11. Check API, web, and worker health.
12. Record deployed SHA.

## Rollback

Application rollback may switch `/opt/syncos/staging/current` back to the previous release and restart services.

Database rollback is not automatic. Use backup/restore only after confirming whether a migration changed schema or data.

## Acceptance

Run `docs/pilot/staging-end-to-end-acceptance.md` after deploy. No live customer payment, ACH, payroll, or Partner payout may be executed in staging.
