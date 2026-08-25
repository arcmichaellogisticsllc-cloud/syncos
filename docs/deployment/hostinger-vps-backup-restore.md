# Hostinger VPS Backup And Restore

## Staging Status

SyncOS staging currently runs on Hostinger VPS `srv1818105`.

For staging, the accepted recovery architecture is:

- Layer 1: daily SyncOS application backups stored locally on the VPS;
- Layer 2: weekly Hostinger VPS backups stored separately from the main server;
- Layer 3: manual Hostinger VPS snapshots before major infrastructure changes.

Hostinger hPanel currently confirms weekly automated VPS backups, separately stored restore points, and a manual snapshot. The manual snapshot expires on `2026-08-26`; it is temporary change protection, not a long-term backup.

Cloudflare R2 is not required for staging. S3-compatible backup mode remains available for later production hardening or independent remote application-level backup.

## Future S3/R2 Option

If independent remote application backup is enabled later, use a private S3-compatible bucket. Recommended R2 bucket name:

```text
syncos-staging-backups
```

The bucket must stay private. Do not attach a public custom domain.

## Backup Scope

Daily SyncOS application backup jobs back up:

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

## Backup Mode

Store non-secret backup configuration outside Git:

```text
/etc/syncos/staging/backup.env
```

Permissions:

```bash
chown root:syncos /etc/syncos/staging/backup.env
chmod 640 /etc/syncos/staging/backup.env
```

Staging-local Hostinger mode:

```bash
SYNCOS_BACKUP_MODE=local_hostinger
SYNCOS_BACKUP_CADENCE=daily
SYNCOS_BACKUP_RETENTION_KEEP=7
SYNCOS_BACKUP_DISK_CRITICAL_PERCENT=85
```

This mode does not require AWS or R2 credentials. It writes local application backup artifacts that are then captured by Hostinger's subsequent off-server VPS backup.

S3-compatible mode:

```bash
SYNCOS_BACKUP_MODE=s3_remote
SYNCOS_BACKUP_S3_BUCKET=syncos-staging-backups
SYNCOS_BACKUP_S3_PREFIX=
SYNCOS_BACKUP_CADENCE=daily
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=auto
AWS_ENDPOINT_URL_S3=https://<account-id>.r2.cloudflarestorage.com
SYNCOS_BACKUP_SSE=AES256
```

S3-compatible mode requires `aws` CLI or a compatible client on the VPS.

Use a least-privilege key scoped to the staging backup bucket or prefix where the provider supports it. Do not use account-wide admin credentials.

Credential name:

```text
syncos-staging-backup
```

Required Cloudflare R2 permissions:

- list objects in `syncos-staging-backups`;
- upload objects;
- read/download objects for restore;
- delete objects only if retention cleanup is implemented.

Do not paste R2 access keys into chat or commit them to Git.

Expected object layout:

```text
syncos-staging-backups/
├── postgres/
│   ├── daily/
│   ├── weekly/
│   └── manifests/
└── files/
    ├── daily/
    ├── weekly/
    └── manifests/
```

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
- stores the dump under `postgres/<daily|weekly>/`;
- stores the manifest under `postgres/manifests/`;
- verifies the dump with `pg_restore --list`;
- uploads and verifies the remote object only when `SYNCOS_BACKUP_MODE=s3_remote`;
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
- stores the archive under `files/<daily|weekly>/`;
- stores the manifest under `files/manifests/`;
- verifies the archive with `tar --list`;
- uploads and verifies the remote object only when `SYNCOS_BACKUP_MODE=s3_remote`;
- exits non-zero on failure.

## Manual Run

From the deployed release directory:

```bash
cd /opt/syncos/staging/current
SYNCOS_RELEASE_SHA=$(git rev-parse HEAD) scripts/backup-staging-postgres.sh
SYNCOS_RELEASE_SHA=$(git rev-parse HEAD) scripts/backup-staging-files.sh
```

## Systemd Timers

Use one daily timer per backup type. These local daily backups are intentionally staggered.

Database timer:

```text
syncos-staging-db-backup.service
syncos-staging-db-backup.timer
```

Recommended schedule:

```text
OnCalendar=*-*-* 02:10:00 UTC
Persistent=true
```

File timer:

```text
syncos-staging-files-backup.service
syncos-staging-files-backup.timer
```

Recommended schedule:

```text
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true
```

Timers must log to journald. A failed script exit must mark the service failed so monitoring can alert.

## Retention

Local staging retention target:

- daily backups: 7 copies;
- weekly backups: 4 copies if weekly jobs are enabled later;
- monthly backups: optional for staging.

Never delete the newest verified backup. Production needs a stronger policy with point-in-time recovery or equivalent managed database protection.

## Encryption

Staging requirements:

- Hostinger off-server VPS backup protection for the local backup artifacts;
- private local backup directories;
- no anonymous reads;
- no public URLs.

For S3-compatible mode, require TLS in transit and provider-managed encryption at rest. Client-side encryption can be added later if the evidence set becomes sensitive enough to require keys independent from the storage provider. Do not create encryption keys without a secure storage and recovery plan.

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

Application-level corruption in staging:

- RPO: 24 hours after daily timers are active;
- RTO: 1-2 hours for DB/file restore into the existing VPS.

Total VPS loss in staging:

- RPO: depends on latest Hostinger weekly off-server VPS backup;
- RTO: approximately 30 minutes for Hostinger restore once an operator initiates it, plus application validation time.

Do not claim total-loss RPO is 24 hours while Hostinger backup cadence is weekly. Production should use daily VPS backups at minimum and preferably independent remote application-level backups.

## Hostinger Restore Safety

Hostinger Restore is a full VPS restoration. Do not use it casually to recover one database record, one map, or one document.

Use SyncOS application-level DB/file backups for granular staging recovery. Use Hostinger whole-VPS restore only for disaster recovery.

## Cleanup

Restore-test artifacts are not production dependencies.

Cleanup commands after review:

```bash
dropdb --if-exists syncos_staging_restore_test
rm -rf /opt/syncos/staging-restore-test
```

Do not run cleanup until the recovery report has been reviewed.
