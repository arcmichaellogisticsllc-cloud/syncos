# Hostinger VPS Backup And Restore

## Status

SyncOS staging currently runs on Hostinger VPS `srv1818105`.

The required backup target is an S3-compatible private bucket. Cloudflare R2 is the recommended first target for staging because it is inexpensive, supports S3-compatible tooling, keeps recovery provider-neutral, and avoids depending on the same VPS that is being protected.

Current gate status: off-VPS backup is not complete until `/etc/syncos/staging/backup.env` is populated, `aws` CLI or a compatible client is installed on the VPS, both backup scripts upload successfully, and restore validation passes.

## Backup Scope

Back up:

- `syncos_staging` PostgreSQL database;
- `/opt/syncos/staging/shared/storage` private application files;
- safe backup manifests and checksums.

Do not back up through these SyncOS jobs:

- `/etc/syncos/staging/*.env`;
- SSH private keys;
- GitHub deploy private keys;
- release directories;
- logs;
- Postgres data directories;
- Redis data;
- legacy Jackson application/runtime directories.

Secrets must be recovered through the operator-controlled secret backup process, not by copying them into the DB/file backup set.

## Backup Credentials

Store backup credentials outside Git:

```text
/etc/syncos/staging/backup.env
```

Permissions:

```bash
chown root:syncos /etc/syncos/staging/backup.env
chmod 640 /etc/syncos/staging/backup.env
```

Required settings:

```bash
SYNCOS_BACKUP_S3_BUCKET=
SYNCOS_BACKUP_S3_PREFIX=syncos/staging
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=auto
AWS_ENDPOINT_URL_S3=https://<account-id>.r2.cloudflarestorage.com
SYNCOS_BACKUP_SSE=AES256
```

Use a least-privilege key scoped to the staging backup bucket or prefix where the provider supports it. Do not use account-wide admin credentials.

## Postgres Backup

Script:

```bash
scripts/backup-staging-postgres.sh
```

Behavior:

- reads `/etc/syncos/staging/api.env`;
- reads `/etc/syncos/staging/backup.env`;
- creates a custom-format `pg_dump`;
- includes the deployed SHA in the backup filename;
- writes a SHA-256 checksum;
- writes a JSON manifest with environment, timestamp, deployed SHA, migration ceiling, filename, size, and checksum;
- uploads the dump and manifest to the configured S3-compatible bucket;
- verifies the remote object with `head-object`;
- exits non-zero on failure.

The script does not contain database passwords or backup provider secrets.

## Private File Backup

Script:

```bash
scripts/backup-staging-files.sh
```

Behavior:

- backs up only `/opt/syncos/staging/shared/storage`;
- creates a compressed archive;
- preserves directory structure;
- writes a SHA-256 checksum;
- writes a JSON manifest with file count and deployed SHA;
- uploads the archive and manifest to the configured S3-compatible bucket;
- verifies the remote object with `head-object`;
- exits non-zero on failure.

## Manual Run

From the deployed release directory:

```bash
cd /opt/syncos/staging/current
SYNCOS_RELEASE_SHA=$(git rev-parse HEAD) scripts/backup-staging-postgres.sh
SYNCOS_RELEASE_SHA=$(git rev-parse HEAD) scripts/backup-staging-files.sh
```

## Systemd Timers

Use one daily timer per backup type.

Database timer:

```text
syncos-staging-db-backup.service
syncos-staging-db-backup.timer
```

Recommended schedule:

```text
OnCalendar=*-*-* 06:15:00 UTC
Persistent=true
```

File timer:

```text
syncos-staging-files-backup.service
syncos-staging-files-backup.timer
```

Recommended schedule:

```text
OnCalendar=*-*-* 06:45:00 UTC
Persistent=true
```

Timers must log to journald. A failed script exit must mark the service failed so monitoring can alert.

## Retention

Staging retention target:

- daily backups: 7 copies;
- weekly backups: 4 copies;
- monthly backups: optional for staging.

Use bucket lifecycle rules where possible. Production needs a stronger policy with point-in-time recovery or equivalent managed database protection.

## Encryption

Required:

- TLS in transit to the backup target;
- provider-managed encryption at rest;
- private bucket/container only;
- no anonymous reads;
- no public URLs.

Client-side encryption can be added later if the staging evidence set becomes sensitive enough to require keys independent from the storage provider. Do not create encryption keys without a secure storage and recovery plan.

## Restore Drill

Never restore over active staging.

Disposable database:

```text
syncos_staging_restore_test
```

Disposable file target:

```text
/opt/syncos/staging-restore-test/storage
```

Restore sequence:

```bash
createdb -O syncos_staging_app syncos_staging_restore_test
pg_restore --clean --if-exists --no-owner --no-acl --dbname=<restore-database-url> <downloaded-db-dump>
psql <restore-database-url> -c "select max(id) from schema_migrations"
```

Expected migration ceiling:

```text
059_syncfield_coil_commercial_policy.sql
```

`npm run db:verify` requires an empty database and is useful for migration integrity, not for validating an already-restored dump. For restored staging data, verify the migration ceiling and representative synthetic records.

File restore:

```bash
mkdir -p /opt/syncos/staging-restore-test
tar --extract --gzip --file=<downloaded-file-archive> --directory=/opt/syncos/staging-restore-test
sha256sum --check <downloaded-file-archive>.sha256
```

Verify:

- archive extracts successfully;
- checksum matches manifest;
- representative synthetic files are readable;
- restored path is not under an Nginx public root;
- restored permissions are not world-readable.

## Representative Data Checks

On the restored database, confirm presence of:

- Sync Comm Systems tenant;
- synthetic staging customer or demo customer;
- synthetic staging Partner;
- staging or demo crew;
- staging or demo Foreman;
- staging or demo project;
- staging or demo Work Order;
- SyncField map/production tables at migration ceiling 059.

Do not print IDs or secrets in recovery reports.

## Total Loss Recovery

If `srv1818105` is destroyed, recovery requires:

- GitHub source at the deployed SHA;
- operator-held staging secrets;
- latest verified DB backup;
- latest verified private-file backup;
- this runbook;
- DNS/TLS operator access.

Recovery outline:

1. Provision a replacement VPS.
2. Install Node, Git, Nginx, Postgres, Redis, Certbot, and backup tooling.
3. Recreate `deploy` and `syncos` users.
4. Restore `/etc/syncos/staging/*.env` from the operator secret store.
5. Clone the exact deployed SHA.
6. Restore Postgres into `syncos_staging`.
7. Restore private files into `/opt/syncos/staging/shared/storage`.
8. Start Redis, API, worker, and web.
9. Verify `/health`, `/health/startup`, `/login`, worker logs, and representative files.
10. Cut DNS only if the IP changed and the replacement is healthy.

## RPO/RTO

Staging target:

- RPO: 24 hours after daily timers are active;
- RTO: 4-8 hours for a full VPS rebuild by an operator with provider access.

These are realistic staging targets. Production should use a stronger database and file durability plan.

## Cleanup

Restore-test artifacts are not production dependencies.

Cleanup commands after review:

```bash
dropdb --if-exists syncos_staging_restore_test
rm -rf /opt/syncos/staging-restore-test
```

Do not run cleanup until the recovery report has been reviewed.
