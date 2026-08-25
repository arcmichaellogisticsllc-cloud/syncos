#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${SYNCOS_STAGING_ENV_FILE:-/etc/syncos/staging/api.env}"
BACKUP_ENV_FILE="${SYNCOS_BACKUP_ENV_FILE:-/etc/syncos/staging/backup.env}"
STORAGE_ROOT="${SYNCOS_STORAGE_ROOT:-/opt/syncos/staging/shared/storage}"
BACKUP_ROOT="${SYNCOS_BACKUP_ROOT:-/opt/syncos/staging/shared/backups/files}"
SHA="${SYNCOS_RELEASE_SHA:-unknown}"
MIGRATION_CEILING="${SYNCOS_MIGRATION_CEILING:-059_syncfield_coil_commercial_policy.sql}"
CADENCE="${SYNCOS_BACKUP_CADENCE:-daily}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "missing readable staging env file: ${ENV_FILE}" >&2
  exit 1
fi
if [[ ! -r "${BACKUP_ENV_FILE}" ]]; then
  echo "missing readable backup env file: ${BACKUP_ENV_FILE}" >&2
  exit 1
fi
if [[ ! -d "${STORAGE_ROOT}" ]]; then
  echo "missing private storage root: ${STORAGE_ROOT}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "${ENV_FILE}"
# shellcheck source=/dev/null
. "${BACKUP_ENV_FILE}"
set +a

required=(SYNCOS_BACKUP_S3_BUCKET)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required backup setting: ${name}" >&2
    exit 1
  fi
done
if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required for S3-compatible off-VPS backup upload" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${BACKUP_ROOT}"
archive_file="${BACKUP_ROOT}/syncos_staging_files_${timestamp}_${SHA:0:12}.tar.gz"
checksum_file="${archive_file}.sha256"
manifest_file="${archive_file}.manifest.json"
case "${CADENCE}" in
  daily|weekly) ;;
  *) echo "SYNCOS_BACKUP_CADENCE must be daily or weekly" >&2; exit 1 ;;
esac

object_key() {
  local key="$1"
  local prefix="${SYNCOS_BACKUP_S3_PREFIX:-}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  if [[ -n "${prefix}" ]]; then
    printf "%s/%s" "${prefix}" "${key}"
  else
    printf "%s" "${key}"
  fi
}

remote_key="$(object_key "files/${CADENCE}/$(basename "${archive_file}")")"
remote_manifest_key="$(object_key "files/manifests/$(basename "${manifest_file}")")"

echo "starting private file backup ${archive_file}"
file_count="$(find "${STORAGE_ROOT}" -type f | wc -l | tr -d ' ')"
tar --create --gzip --file="${archive_file}" --directory="$(dirname "${STORAGE_ROOT}")" "$(basename "${STORAGE_ROOT}")"
sha256sum "${archive_file}" > "${checksum_file}"
checksum="$(cut -d' ' -f1 "${checksum_file}")"
size_bytes="$(wc -c < "${archive_file}" | tr -d ' ')"

cat > "${manifest_file}" <<EOF
{
  "environment": "staging",
  "backup_type": "private_files",
  "timestamp_utc": "${timestamp}",
  "deployed_sha": "${SHA}",
  "migration_ceiling": "${MIGRATION_CEILING}",
  "storage_root": "${STORAGE_ROOT}",
  "filename": "$(basename "${archive_file}")",
  "file_count": ${file_count},
  "size_bytes": ${size_bytes},
  "sha256": "${checksum}"
}
EOF

aws_args=(s3 cp "${archive_file}" "s3://${SYNCOS_BACKUP_S3_BUCKET}/${remote_key}" --only-show-errors)
manifest_args=(s3 cp "${manifest_file}" "s3://${SYNCOS_BACKUP_S3_BUCKET}/${remote_manifest_key}" --only-show-errors)
if [[ -n "${AWS_ENDPOINT_URL_S3:-}" ]]; then
  aws_args+=(--endpoint-url "${AWS_ENDPOINT_URL_S3}")
  manifest_args+=(--endpoint-url "${AWS_ENDPOINT_URL_S3}")
fi
if [[ -n "${SYNCOS_BACKUP_SSE:-}" ]]; then
  aws_args+=(--sse "${SYNCOS_BACKUP_SSE}")
  manifest_args+=(--sse "${SYNCOS_BACKUP_SSE}")
fi

"${aws_args[@]}"
"${manifest_args[@]}"

head_args=(s3api head-object --bucket "${SYNCOS_BACKUP_S3_BUCKET}" --key "${remote_key}")
if [[ -n "${AWS_ENDPOINT_URL_S3:-}" ]]; then
  head_args+=(--endpoint-url "${AWS_ENDPOINT_URL_S3}")
fi
"${head_args[@]}" >/dev/null

echo "private file backup uploaded and verified: ${remote_key}"
