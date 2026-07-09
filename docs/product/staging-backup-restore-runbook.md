# Staging Backup and Restore Runbook

## Backup Scope

- PostgreSQL database.
- Environment config inventory, excluding secret values.
- Uploaded files if file storage exists.
- UAT issue logs and docs.

## Backup Timing

- Before migrations.
- Before major UAT cycle.
- Before destructive reset.
- Scheduled provider backups if available.

## Restore Procedure

1. Identify the backup.
2. Stop app writes if necessary.
3. Restore the database through provider tooling or `pg_restore`.
4. Restart services if needed.
5. Run staging smoke tests.
6. Validate tenant/admin login.
7. Validate key workflows and read-only access.

## Local Restore Drill

Placeholder only:

```bash
createdb syncos_restore_drill
pg_restore --dbname=syncos_restore_drill <backup-file>
DATABASE_URL=postgres:///syncos_restore_drill npm run db:migrate
DATABASE_URL=postgres:///syncos_restore_drill npm run e2e:seed-smoke
```

Do not use real secret values in commands committed to the repo.

## Draft RPO / RTO

- Staging RPO: 24 hours acceptable unless an active UAT session is running.
- Staging RTO: same day target unless provider outage blocks recovery.

## Limitations

Staging restore does not imply production disaster recovery is complete.
