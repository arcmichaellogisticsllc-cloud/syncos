# 015 Files, File Links

## Purpose

Provide a generic file registry and link files to domain records.

## Tables

- `files`: stored file metadata.
- `file_versions`: immutable file object versions.
- `file_links`: links between files and domain entities.
- `file_access_grants`: explicit file access grants beyond normal entity permissions.
- `file_scan_results`: malware, content, OCR, or policy scan results.

## Key Relationships

- `files.tenant_id` references `tenants.id`.
- `file_versions.file_id` references `files.id`.
- `file_links.file_id` references `files.id`.
- `file_access_grants.file_id` references `files.id`.
- `file_scan_results.file_version_id` references `file_versions.id`.

## Notes

- Store object storage bucket, key, size, content type, checksum, and upload actor.
- Domain links should support polymorphic entity type and entity ID pairs.
