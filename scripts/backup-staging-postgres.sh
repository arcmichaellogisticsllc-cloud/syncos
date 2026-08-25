#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${SYNCOS_STAGING_ENV_FILE:-/etc/syncos/staging/api.env}"
BACKUP_ENV_FILE="${SYNCOS_BACKUP_ENV_FILE:-/etc/syncos/staging/backup.env}"
BACKUP_ROOT="${SYNCOS_BACKUP_ROOT:-/opt/syncos/staging/shared/backups/postgres}"
SHA="${SYNCOS_RELEASE_SHA:-unknown}"
MIGRATION_CEILING="${SYNCOS_MIGRATION_CEILING:-059_syncfield_coil_commercial_policy.sql}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "missing readable staging env file: ${ENV_FILE}" >&2
  exit 1
fi
if [[ ! -r "${BACKUP_ENV_FILE}" ]]; then
  echo "missing readable backup env file: ${BACKUP_ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "${ENV_FILE}"
# shellcheck source=/dev/null
. "${BACKUP_ENV_FILE}"
set +a

required=(DATABASE_URL SYNCOS_BACKUP_S3_BUCKET SYNCOS_BACKUP_S3_PREFIX)
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
backup_file="${BACKUP_ROOT}/syncos_staging_${timestamp}_${SHA:0:12}.dump"
checksum_file="${backup_file}.sha256"
manifest_file="${backup_file}.manifest.json"
remote_key="${SYNCOS_BACKUP_S3_PREFIX%/}/postgres/$(basename "${backup_file}")"
remote_manifest_key="${remote_key}.manifest.json"

echo "starting postgres backup ${backup_file}"
pg_dump --format=custom --no-owner --no-acl --dbname="${DATABASE_URL}" --file="${backup_file}"
sha256sum "${backup_file}" > "${checksum_file}"
checksum="$(cut -d' ' -f1 "${checksum_file}")"
size_bytes="$(wc -c < "${backup_file}" | tr -d ' ')"

cat > "${manifest_file}" <<EOF
{
  "environment": "staging",
  "backup_type": "postgres",
  "timestamp_utc": "${timestamp}",
  "deployed_sha": "${SHA}",
  "migration_ceiling": "${MIGRATION_CEILING}",
  "database": "syncos_staging",
  "filename": "$(basename "${backup_file}")",
  "size_bytes": ${size_bytes},
  "sha256": "${checksum}"
}
EOF

aws_args=(s3 cp "${backup_file}" "s3://${SYNCOS_BACKUP_S3_BUCKET}/${remote_key}" --only-show-errors)
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

echo "postgres backup uploaded and verified: ${remote_key}"
