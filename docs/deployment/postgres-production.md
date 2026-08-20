# PostgreSQL Production Readiness

## Requirement

- PostgreSQL 15 or 16.
- SSL required for app and worker connections.
- Separate credentials recommended:
  - application role: runtime DML only.
  - migration role: schema migration authority.
- Managed backup and restore support required before pilot.
- Connection pooling required at provider or process level.

## Current Application Behavior

- API uses `pg.Pool` from `apps/api/src/modules/database.module.ts`.
- Worker creates bounded `pg.Pool` instances for scheduled scans.
- Migration runner is idempotent through `schema_migrations`.
- Certified migration list currently ends at `056_syncfield_field_traceability.sql`.

## Pool Sizing

Initial controlled pilot:

| Service | Suggested max connections |
| --- | ---: |
| API | 5-10 |
| Worker | 2-5 |
| Migration | 1 |

If the hosting platform does not provide a pooler, set a managed PostgreSQL connection limit high enough for API replicas plus worker plus admin maintenance. Do not scale API replicas without revisiting pool totals.

## SSL

Production `DATABASE_URL` must include provider-required SSL configuration, such as `sslmode=require`. Startup validation warns when SSL is not visible in the URL.

## Production Migration Gate

Use:

```bash
NODE_ENV=production \
PRODUCTION_DB_BACKUP_CONFIRMED=true \
DATABASE_URL=<set-in-provider-secret-manager> \
npm run release:production:migrate
```

The gate:

1. checks DB connectivity;
2. prints current database, role, time, and recent migrations;
3. requires explicit backup confirmation;
4. applies pending migrations once;
5. reports the latest applied migration from `schema_migrations`;
6. never seeds, resets, or runs empty-database verification against production data.

## Backup Policy

- Automated backup: at least daily.
- Retention: minimum 14 days for pilot, 30 days before broader production.
- PITR: enable where provider supports it.
- Restore test: before pilot and then at least monthly.

## Restore Procedure

1. Create a new restore database.
2. Restore backup into the new database.
3. Set `DATABASE_URL` to the restored database.
4. Query `schema_migrations` and confirm the restored database includes the certified migration ceiling.
5. Validate representative tenant, user, work order, production, finance, invitation, and SyncField traceability records.
6. Do not overwrite production during restore drills.

## Health Query

```sql
SELECT current_database(), current_user, now();
```

## Monitoring

Track connections, locks, slow queries, CPU, memory, disk growth, replication/backup status, failed backups, and migration duration.
