# Staging Backup and Restore

Staging is synthetic, but backup and restore must be exercised before production pilot.

## Database Backup

- Enable managed Postgres backups.
- Take a manual snapshot after migration and staging seed.
- Do not restore over active staging during drills.

## Database Restore Drill

1. Restore the latest staging snapshot into a separate `staging-restore` database.
2. Point a temporary API instance or local verification client at the restored database.
3. Confirm `schema_migrations` includes `059_syncfield_coil_commercial_policy.sql`.
4. Confirm representative synthetic records exist.
5. Destroy the restore target after the drill if provider policy requires it.

## File Backup

- Enable provider versioning or backup for private staging storage.
- Include synthetic map PDFs, evidence, exports, and agreement/credential files.

## File Restore Drill

1. Restore a synthetic object into a separate restore bucket/prefix.
2. Compare checksum with the original.
3. Confirm unauthorized access remains denied.
4. Do not overwrite active staging objects during the drill.
