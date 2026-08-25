# Staging Private Storage

Staging private storage is for synthetic map PDFs, evidence photos, exports, agreements, credentials, and generated artifacts. It must be isolated from production.

## Required Configuration

Use provider-specific secret names where applicable:

- `PRIVATE_STORAGE_PROVIDER`
- `PRIVATE_STORAGE_BUCKET=syncos-private-staging`
- `PRIVATE_STORAGE_REGION`
- `PRIVATE_STORAGE_ENDPOINT`
- `PRIVATE_STORAGE_ACCESS_KEY_ID`
- `PRIVATE_STORAGE_SECRET_ACCESS_KEY`

The current local adapter also supports:

- `SYNCOS_RESTRICTED_FILE_STORAGE_DIR`

Use the local directory only for mounted private staging storage if object storage is not yet wired for the selected provider.

## Requirements

- Bucket/container is private.
- Public listing is disabled.
- Credentials are server-side only.
- Object keys must remain tenant scoped.
- Source checksums must be retained for map/export lineage.

## Smoke Procedure

1. Upload a synthetic file through an authorized staging user.
2. Read it back through the authorized API path.
3. Verify checksum matches.
4. Confirm an unauthorized user is denied.
5. Delete the test artifact only if the workflow creates a disposable smoke object.

No permanent public URL should be generated.
