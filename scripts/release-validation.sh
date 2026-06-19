#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required and should point to an empty validation database}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3120}"
export NODE_ENV="${NODE_ENV:-test}"
export AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-release-validation-secret}"
export API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
export PORT

cd "${ROOT_DIR}"

npm run typecheck
npm run build -w @syncos/api
npm run build -w @syncos/worker
npm run build -w @syncos/web
npm test
npm run db:verify

npm run start -w @syncos/api &
API_PID=$!
trap 'kill "${API_PID}" 2>/dev/null || true' EXIT

for attempt in $(seq 1 60); do
  if node -e "fetch(process.env.API_BASE_URL + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    break
  fi
  if [ "${attempt}" -eq 60 ]; then
    echo "API did not become healthy at ${API_BASE_URL}" >&2
    exit 1
  fi
  sleep 1
done

npm run security:smoke
npm run sprint1:smoke
npm run sprint2:smoke
npm run sprint3:smoke
npm run sprint4:smoke
npm run sprint5:smoke
npm run sprint6:smoke
npm run sprint7:smoke
npm run sprint8:smoke
npm run sprint9:smoke
npm run sprint10:smoke
npm run sprint11:smoke
npm run sprint12:smoke
npm run sprint13:smoke
npm run sprint14:smoke

echo "release validation passed"
