#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${SYNCOS_STAGING_ENV_FILE:-/etc/syncos/staging/api.env}"
BACKUP_ENV_FILE="${SYNCOS_BACKUP_ENV_FILE:-/etc/syncos/staging/backup.env}"
STORAGE_ROOT="${SYNCOS_STORAGE_ROOT:-/opt/syncos/staging/shared/storage}"
BACKUP_ROOT="${SYNCOS_BACKUP_ROOT:-/opt/syncos/staging/shared/backups/files}"
SHA="${SYNCOS_RELEASE_SHA:-unknown}"
MIGRATION_CEILING="${SYNCOS_MIGRATION_CEILING:-059_syncfield_coil_commercial_policy.sql}"
CADENCE="${SYNCOS_BACKUP_CADENCE:-daily}"
MODE="${SYNCOS_BACKUP_MODE:-local_hostinger}"
DISK_CRITICAL_PERCENT="${SYNCOS_BACKUP_DISK_CRITICAL_PERCENT:-85}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "missing readable staging env file: ${ENV_FILE}" >&2
  exit 1
fi
if [[ ! -d "${STORAGE_ROOT}" ]]; then
  echo "missing private storage root: ${STORAGE_ROOT}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "${ENV_FILE}"
if [[ -r "${BACKUP_ENV_FILE}" ]]; then
  # shellcheck source=/dev/null
  . "${BACKUP_ENV_FILE}"
fi
set +a
MODE="${SYNCOS_BACKUP_MODE:-${MODE}}"
CADENCE="${SYNCOS_BACKUP_CADENCE:-${CADENCE}}"

case "${MODE}" in
  local_hostinger|s3_remote) ;;
  *) echo "SYNCOS_BACKUP_MODE must be local_hostinger or s3_remote" >&2; exit 1 ;;
esac
if [[ "${MODE}" == "s3_remote" ]]; then
  if [[ -z "${SYNCOS_BACKUP_S3_BUCKET:-}" ]]; then
    echo "missing required backup setting: SYNCOS_BACKUP_S3_BUCKET" >&2
    exit 1
  fi
  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI is required for S3-compatible off-VPS backup upload" >&2
    exit 1
  fi
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${CADENCE}"
manifest_dir="${BACKUP_ROOT}/manifests"
mkdir -p "${backup_dir}" "${manifest_dir}"
disk_used_percent="$(df -P "${BACKUP_ROOT}" | awk 'NR==2 { gsub("%", "", $5); print $5 }')"
if [[ "${disk_used_percent}" -ge "${DISK_CRITICAL_PERCENT}" ]]; then
  echo "backup aborted: ${BACKUP_ROOT} filesystem is ${disk_used_percent}% full" >&2
  exit 1
fi
archive_file="${backup_dir}/syncos_staging_files_${timestamp}_${SHA:0:12}.tar.gz"
checksum_file="${archive_file}.sha256"
manifest_file="${manifest_dir}/$(basename "${archive_file}").manifest.json"
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
tar --list --gzip --file="${archive_file}" >/dev/null
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

if [[ "${MODE}" == "local_hostinger" ]]; then
  keep="${SYNCOS_BACKUP_RETENTION_KEEP:-7}"
  mapfile -t old_backups < <(find "${backup_dir}" -maxdepth 1 -type f -name "*.tar.gz" -printf "%T@ %p\n" | sort -rn | awk -v keep="${keep}" 'NR > keep { print $2 }')
  for old in "${old_backups[@]}"; do
    rm -f "${old}" "${old}.sha256" "${manifest_dir}/$(basename "${old}").manifest.json"
  done
  echo "private file backup stored locally and verified: ${archive_file}"
  exit 0
fi

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
