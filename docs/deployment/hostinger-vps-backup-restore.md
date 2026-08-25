# Hostinger VPS Backup And Restore

## Principle

A VPS-local snapshot is not enough. SyncOS must be restorable from:

- GitHub source;
- secure environment/secrets backup;
- Postgres backup;
- private file backup;
- deployment runbooks.

Backups must leave the VPS.

## Postgres Backup

For staging:

```bash
pg_dump --format=custom --no-owner --no-acl --dbname=<staging-database-url> --file=/opt/syncos/staging/shared/backups/postgres/syncos_staging_<timestamp>.dump
```

Then encrypt and copy the dump to an off-server backup target.

Operator must choose one:

- Hostinger backup facility with verified restore;
- S3/R2/object storage bucket with lifecycle retention;
- another secure backup destination.

Retention recommendation for staging:

- daily for 14 days;
- weekly for 4 weeks if storage cost allows.

Production needs stronger retention and restore objectives.

## Postgres Restore Drill

Never restore over active staging or production. Restore into a separate target:

```text
syncos_staging_restore
```

Validation:

```bash
pg_restore --clean --if-exists --dbname=<restore-database-url> <backup-file>
psql <restore-database-url> -c "select id from schema_migrations order by id desc limit 1"
```

Expected migration ceiling:

```text
059_syncfield_coil_commercial_policy.sql
```

## Private File Backup

Protected files include:

- engineering prints;
- redlines;
- evidence photos;
- QC evidence;
- credentials;
- agreements;
- exports.

For local VPS staging storage:

```bash
tar --create --gzip --file=/opt/syncos/staging/shared/backups/files/syncos_staging_files_<timestamp>.tar.gz /opt/syncos/staging/shared/storage
```

Encrypt and copy the archive off-server.

## File Restore Drill

Restore into a disposable path:

```text
/opt/syncos/staging-restore/shared/storage
```

Verify:

- representative file exists;
- checksum matches source metadata;
- file is not publicly served by Nginx;
- API can read it for an authorized synthetic user;
- unauthorized access is denied.

## Current Audit Status

No SyncOS-specific off-server Postgres or private-file backup job was found on the VPS during audit. This is an operator action before production.
