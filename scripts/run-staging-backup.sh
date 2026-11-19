#!/usr/bin/env bash
set -euo pipefail
umask 077
# systemd must supply api.env and backup.env via EnvironmentFile.
release="$(readlink -f "${SYNCOS_STAGING_CURRENT:-/opt/syncos/staging/current}")"
export SYNCOS_RELEASE_SHA="$(git -c safe.directory="${release}" -C "${release}" rev-parse HEAD)"
export SYNCOS_MIGRATION_CEILING="$(node -p "require('${release}/packages/database/src/migration-manifest.json').at(-1)")"
export SYNCOS_STAGING_ENV_FILE=/dev/null
export SYNCOS_BACKUP_ENV_FILE=/dev/null
case "${1:-}" in
  postgres) exec bash "${release}/scripts/backup-staging-postgres.sh" ;;
  files) exec bash "${release}/scripts/backup-staging-files.sh" ;;
  *) echo "Usage: run-staging-backup.sh postgres|files" >&2; exit 2 ;;
esac
