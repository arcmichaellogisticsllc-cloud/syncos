#!/usr/bin/env bash
set -euo pipefail

if [[ "${SYNCOS_DEPLOY_TARGET:-}" != "hostinger-staging" ]]; then
  echo "Set SYNCOS_DEPLOY_TARGET=hostinger-staging to run this staging deploy script." >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as the SyncOS deployment user, not root." >&2
  exit 1
fi

if [[ -z "${SYNCOS_RELEASE_SHA:-}" ]]; then
  echo "SYNCOS_RELEASE_SHA is required." >&2
  exit 1
fi

: "${STAGING_DB_BACKUP_CONFIRMED:?Confirm a verified staging backup before deployment}"
if [[ "${STAGING_DB_BACKUP_CONFIRMED}" != "true" ]]; then exit 1; fi
export STAGING_DB_BACKUP_CONFIRMED

APP_ROOT="${SYNCOS_APP_ROOT:-/opt/syncos/staging}"
STAGING_API_ENV_FILE="${SYNCOS_STAGING_API_ENV_FILE:-/etc/syncos/staging/api.env}"
REPO_URL="${SYNCOS_REPO_URL:-https://github.com/arcmichaellogisticsllc-cloud/syncos.git}"
: "${SYNCOS_RELEASE_BRANCH:?SYNCOS_RELEASE_BRANCH is required}"
BRANCH="${SYNCOS_RELEASE_BRANCH}"
RELEASE_DIR="${APP_ROOT}/releases/${SYNCOS_RELEASE_SHA}"
CURRENT_LINK="${APP_ROOT}/current"
DEPLOY_LOG_DIR="${APP_ROOT}/shared/deployments"

mkdir -p "${APP_ROOT}/releases" "${DEPLOY_LOG_DIR}"

if [[ ! -d "${RELEASE_DIR}/.git" ]]; then
  git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${RELEASE_DIR}"
fi

cd "${RELEASE_DIR}"
assert_clean_release() {
  if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
    echo "Release checkout contains local changes or untracked files; refusing to deploy." >&2
    exit 1
  fi
}
assert_clean_release
git fetch origin "${BRANCH}"
git checkout --detach "${SYNCOS_RELEASE_SHA}"

actual_sha="$(git rev-parse HEAD)"
if [[ "${actual_sha}" != "${SYNCOS_RELEASE_SHA}" ]]; then
  echo "Checked out ${actual_sha}, expected ${SYNCOS_RELEASE_SHA}." >&2
  exit 1
fi

assert_clean_release

npm ci
npm audit --omit=dev --audit-level=high
npm run build -w @syncos/api
npm run build -w @syncos/web
npm run build -w @syncos/worker

# Complete preflight before interrupting the running application.
if [[ -r "${STAGING_API_ENV_FILE}" ]]; then
  MIGRATION_ENV_ACCESS="direct"
elif sudo -n test -r "${STAGING_API_ENV_FILE}"; then
  MIGRATION_ENV_ACCESS="sudo"
else
  echo "Staging API environment file is required for migration: ${STAGING_API_ENV_FILE}" >&2
  exit 1
fi
MIGRATION_CEILING="$(node -p 'require("@syncos/database").currentMigrationCeiling')"
assert_clean_release

# Legacy services once shared this database. Never migrate underneath them.
for legacy_service in syncos-api syncos-web syncos-worker; do
  if sudo -n systemctl is-active --quiet "${legacy_service}"; then
    echo "Legacy service ${legacy_service} is active; resolve shared database writers before deployment." >&2
    exit 1
  fi
done

QUIESCE_ATTEMPTED=false
DEPLOY_COMPLETE=false
on_deploy_exit() {
  local status=$?
  if [[ "${QUIESCE_ATTEMPTED}" == "true" && "${DEPLOY_COMPLETE}" != "true" ]]; then
    # Migrations can partially commit. Do not restore old code against an unknown schema.
    sudo -n systemctl stop syncos-staging-api syncos-staging-worker syncos-staging-web || true
    echo "Deployment failed; staging services left stopped. Inspect migration and release state before recovery; no automatic rollback was attempted." >&2
  fi
  exit "${status}"
}
trap on_deploy_exit EXIT
QUIESCE_ATTEMPTED=true
sudo -n systemctl stop syncos-staging-api syncos-staging-worker syncos-staging-web

if [[ "${MIGRATION_ENV_ACCESS}" == "direct" ]]; then
  (
    set -a
    # shellcheck source=/dev/null
    source "${STAGING_API_ENV_FILE}"
    set +a
    NODE_ENV=staging npm run release:staging:migrate
  )
else
  sudo -n bash -c 'set -euo pipefail; cd "$1"; set -a; source "$2"; set +a; NODE_ENV=staging STAGING_DB_BACKUP_CONFIRMED=true npm run release:staging:migrate' bash "${RELEASE_DIR}" "${STAGING_API_ENV_FILE}"
fi

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "${CURRENT_LINK}"

sudo -n systemctl start syncos-staging-api
sudo -n systemctl start syncos-staging-worker
sudo -n systemctl start syncos-staging-web

for staging_service in syncos-staging-api syncos-staging-worker syncos-staging-web; do
  sudo -n systemctl is-active --quiet "${staging_service}"
done

node scripts/check-deployed-startup.js "${STAGING_API_STARTUP_URL:-https://staging-api.synccommsystems.com/health/startup}"
curl -fsSI "${STAGING_WEB_HEALTH_URL:-https://staging-app.synccommsystems.com/login}" >/dev/null

cat > "${DEPLOY_LOG_DIR}/current.json" <<EOF
{
  "environment": "staging",
  "branch": "${BRANCH}",
  "commit_sha": "${SYNCOS_RELEASE_SHA}",
  "migration_ceiling": "${MIGRATION_CEILING}",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

DEPLOY_COMPLETE=true
echo "Hostinger staging deploy completed for ${SYNCOS_RELEASE_SHA}."
