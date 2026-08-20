# Private File Storage Backup and Restore

## Current Implementation

SyncOS stores restricted operational files through API-controlled file paths and metadata rows. Relevant file classes include:

- worker headshots;
- credential evidence;
- W-9/payment/compliance evidence;
- executed agreements and work order artifacts;
- construction maps;
- production evidence;
- Customer QC evidence where represented;
- generated production PDFs, annotated PDFs, CSV, and closeout manifests.

The current adapter uses `SYNCOS_RESTRICTED_FILE_STORAGE_DIR` with path normalization and server-generated keys. API routes authorize access at request time and do not expose permanent public URLs.

## v0.9.0-rc1 Storage Model

Controlled pilot may use a private durable mounted volume if:

- only one API instance writes files;
- the volume is persistent across deploys;
- backups are configured;
- file permissions are private to API/worker runtime;
- restore is tested.

Before multi-instance or multi-region production, add an object-storage adapter behind the existing restricted-file boundary.

## Required Config

- `SYNCOS_RESTRICTED_FILE_STORAGE_DIR`
- platform volume or bucket credentials in provider secret manager
- upload size limits at proxy/API layer
- private network/storage ACLs

## Backup

- Frequency: daily minimum for pilot.
- Retention: 14 days minimum for pilot.
- Encryption: provider-managed encryption or encrypted backup destination.
- Scope: entire restricted storage root plus metadata backup through PostgreSQL.

## Restore Test

1. Upload or generate synthetic restricted files in staging.
2. Record file IDs and checksums.
3. Back up storage root or bucket.
4. Restore into a new storage root.
5. Point staging API at restored root.
6. Fetch files through authorized API routes.
7. Compare checksums.

Do not restore over production during a drill.

## Known Limit

Local filesystem storage is not suitable for horizontally scaled API writes unless backed by a shared durable volume. Object storage remains an operator/product follow-up before broad production scale.
