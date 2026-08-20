# Disaster Recovery

## Targets

| Area | Pilot target |
| --- | --- |
| Database RPO | 24 hours or better |
| Database RTO | 4 hours |
| File storage RPO | 24 hours or better |
| File storage RTO | 4 hours |

## Database Recovery

1. Confirm automated backup schedule.
2. Restore to a new database instance.
3. Query `schema_migrations` and confirm the restored database includes the certified migration ceiling.
4. Validate representative tenant, user, Work Order, production, finance, invitation, and SyncField traceability records.
5. Point staging to restored DB for verification.
6. Only redirect production after incident lead approval.

## File Recovery

1. Restore restricted file backup to a new private root/bucket.
2. Validate sample file checksums against database metadata.
3. Point staging API at restored file root.
4. Fetch representative files through authorized routes.
5. Never expose backup storage publicly.

## Owner Roles

- Incident lead: internal operations/admin.
- Database restore: release engineer or provider admin.
- File restore: release engineer or storage admin.
- Business validation: operations, finance, partner operations.

## Test Schedule

Run a synthetic restore drill before controlled pilot and monthly during pilot.
