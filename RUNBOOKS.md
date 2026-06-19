# SyncOS Operational Runbooks

## API Failure

1. Check process/container status.
2. Check `DATABASE_URL`, `AUTH_JWT_SECRET`, and `NODE_ENV`.
3. Check `/health/startup`.
4. Review API logs for auth, permission, or database errors.
5. Roll back if the API cannot start after configuration correction.

## Worker Failure

1. Check worker process status.
2. Verify `REDIS_URL`.
3. Confirm Redis connectivity.
4. Restart worker.
5. Inspect failed BullMQ jobs and preserve failure payloads.

## Database Failure

1. Confirm PostgreSQL availability.
2. Check connection limits and disk space.
3. Validate latest backup.
4. Restore service before restarting API/worker.
5. Run `/health/startup` after recovery.

## Migration Failure

1. Stop deployment.
2. Preserve migration logs.
3. Restore database backup if partial changes were committed.
4. Fix migration in a new commit.
5. Re-run `npm run db:verify` from an empty database before retrying.

## Permission Failure

1. Confirm user tenant membership is active.
2. Confirm role assignment and scope.
3. Confirm permission key exists in seed data.
4. Re-run seed if permission metadata is missing.
5. Do not bypass guards.

## Tenant Isolation Incident

1. Disable affected user/session.
2. Preserve request logs, audit logs, and event IDs.
3. Identify affected tenant IDs and object IDs.
4. Check route-level tenant lookups and FK paths.
5. Patch and add regression coverage before re-enabling access.

## Rollback Procedure

1. Stop API and worker.
2. Deploy previous approved release artifact.
3. Restore database backup if required.
4. Start API.
5. Verify `/health/startup`.
6. Start worker.
7. Run security smoke and targeted regression tests.
