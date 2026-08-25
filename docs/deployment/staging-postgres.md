# Staging Postgres

Staging uses a managed PostgreSQL database isolated from production. It must contain synthetic data only.

## Required Configuration

- `NODE_ENV=staging`
- `DATABASE_URL=<provider secret>` with SSL required, for example `sslmode=require`
- `DB_POOL_MAX=20` for the API service
- `WORKER_DB_POOL_MAX=5` for the worker service
- `DB_SSL_REJECT_UNAUTHORIZED=true` unless the provider requires a documented exception

## Provisioning Rules

- Create a dedicated staging database and restricted database user.
- Do not import production data.
- Do not reuse production credentials.
- Enable provider backups before running remote acceptance.
- Restrict network access to the app/API/worker services where the provider supports it.

## Migration

Run from the release branch after secrets are configured:

```sh
NODE_ENV=staging DATABASE_URL=<staging-url> npm run release:staging:migrate
```

The command checks connectivity, applies pending migrations, and verifies that the schema reaches `059_syncfield_coil_commercial_policy.sql`. It never resets or cleans the database.

## Verification

```sh
curl https://staging-api.synccommsystems.com/health
curl https://staging-api.synccommsystems.com/health/db
curl https://staging-api.synccommsystems.com/health/startup
```

Expected result: API health is OK, DB health is OK, and startup health reports the current migration ceiling.
