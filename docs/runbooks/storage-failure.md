# Storage Failure Runbook

## Symptoms

- Restricted evidence/artifact upload fails.
- Authorized artifact download fails.
- Checksums mismatch.

## Checks

- Storage volume/bucket status.
- `SYNCOS_RESTRICTED_FILE_STORAGE_DIR`.
- Permissions and free space.
- API logs for path validation failures.

## Safe Actions

- Stop workflows requiring new file writes.
- Preserve database/file state.
- Restore files to a new root if recovery is needed.

## Escalation

Release engineer and storage admin.

## Data Safety

Never make restricted storage public. Do not expose raw paths to users.

## Verification

Synthetic upload/download succeeds through authorized API route and unauthorized access is denied.
