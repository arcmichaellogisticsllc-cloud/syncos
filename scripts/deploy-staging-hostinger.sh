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

APP_ROOT="${SYNCOS_APP_ROOT:-/opt/syncos/staging}"
REPO_URL="${SYNCOS_REPO_URL:-https://github.com/arcmichaellogisticsllc-cloud/syncos.git}"
BRANCH="${SYNCOS_RELEASE_BRANCH:-release/syncos-v0.9.0-rc1}"
RELEASE_DIR="${APP_ROOT}/releases/${SYNCOS_RELEASE_SHA}"
CURRENT_LINK="${APP_ROOT}/current"
DEPLOY_LOG_DIR="${APP_ROOT}/shared/deployments"

mkdir -p "${APP_ROOT}/releases" "${DEPLOY_LOG_DIR}"

if [[ ! -d "${RELEASE_DIR}/.git" ]]; then
  git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${RELEASE_DIR}"
fi

cd "${RELEASE_DIR}"
git fetch origin "${BRANCH}"
git checkout --detach "${SYNCOS_RELEASE_SHA}"

actual_sha="$(git rev-parse HEAD)"
if [[ "${actual_sha}" != "${SYNCOS_RELEASE_SHA}" ]]; then
  echo "Checked out ${actual_sha}, expected ${SYNCOS_RELEASE_SHA}." >&2
  exit 1
fi

npm ci
npm run build -w @syncos/api
npm run build -w @syncos/web
npm run build -w @syncos/worker

NODE_ENV=staging npm run release:staging:migrate

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "${CURRENT_LINK}"

sudo systemctl restart syncos-staging-api
sudo systemctl restart syncos-staging-worker
sudo systemctl restart syncos-staging-web

cat > "${DEPLOY_LOG_DIR}/current.json" <<EOF
{
  "environment": "staging",
  "branch": "${BRANCH}",
  "commit_sha": "${SYNCOS_RELEASE_SHA}",
  "migration_ceiling": "059_syncfield_coil_commercial_policy.sql",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

curl -fsS "${STAGING_API_HEALTH_URL:-https://staging-api.synccommsystems.com/health}"
curl -fsSI "${STAGING_WEB_HEALTH_URL:-https://staging-app.synccommsystems.com/login}" >/dev/null

echo "Hostinger staging deploy completed for ${SYNCOS_RELEASE_SHA}."
