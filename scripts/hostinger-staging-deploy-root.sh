#!/usr/bin/env bash
# Installed root-owned as /usr/local/sbin/syncos-staging-deploy.
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 027
[[ "$(id -u)" -eq 0 ]] || { echo 'Use the approved privileged staging wrapper.' >&2; exit 64; }
[[ ( $# -eq 1 || $# -eq 3 ) && "$1" =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply one exact 40-character release SHA.' >&2; exit 64; }
sha=$1
bundle="${2:-}"
if [[ -n "$bundle" ]]; then
 [[ "$bundle" == /* && -f "$bundle" && ! -L "$bundle" && "$3" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid private release bundle.' >&2; exit 65; }
 [[ "$(stat -c %u "$bundle")" == 0 ]] || { echo 'Private bundle must be root-owned.' >&2; exit 65; }
 [[ "$(sha256sum "$bundle" | cut -d ' ' -f 1)" == "$3" ]] || { echo 'Private bundle checksum mismatch.' >&2; exit 65; }
 # A root-only spool prevents replacement between verification and import.
 [[ "$(stat -c %a "$(dirname "$bundle")")" == 700 && "$(stat -c %u "$(dirname "$bundle")")" == 0 ]] || { echo 'Private bundle requires a root-only spool.' >&2; exit 65; }
fi
APP_ROOT=/opt/syncos/staging
ENV_FILE=/etc/syncos/staging/api.env
MIGRATION_ENV_FILE=/etc/syncos/staging/migration.env
WORKER_ENV_FILE=/etc/syncos/staging/worker.env
WEB_ENV_FILE=/etc/syncos/staging/web.env
CHECKPOINT=/usr/local/libexec/syncos/checkpoint-staging.sh
REPO=https://github.com/arcmichaellogisticsllc-cloud/syncos.git
BRANCH=codex/financial-completion-20260930
exec 9>/run/lock/syncos-staging-deploy.lock
flock -n 9 || { echo 'Another staging deployment is active.' >&2; exit 75; }
[[ ! -e /run/syncos-staging-backup.restart && ! -L /run/syncos-staging-backup.restart ]] || { echo 'Backup restart recovery is pending; deployment refused.' >&2; exit 75; }
QUIESCED=false
COMPLETE=false
finish(){
 local rc=$?
 trap - EXIT
 if [[ "$QUIESCED" == true && "$COMPLETE" != true ]]; then
   systemctl stop syncos-staging-api syncos-staging-web syncos-staging-worker || true
   echo 'Activation failed; services remain stopped. Restore the paired checkpoint with its matching release before restarting.' >&2
 fi
 exit "$rc"
}
trap finish EXIT
for service in syncos-api syncos-web syncos-worker; do
 if systemctl is-active --quiet "$service"; then echo "Resolve active legacy writer: $service" >&2; exit 65; fi
done
[[ -r "$ENV_FILE" && -x "$CHECKPOINT" ]] || { echo 'Required environment/checkpoint helper unavailable.' >&2; exit 65; }
[[ -r "$WORKER_ENV_FILE" && -r "$WEB_ENV_FILE" ]] || { echo 'Worker/web protected settings unavailable.' >&2; exit 65; }
( set -a; source "$WEB_ENV_FILE"; set +a; [[ "${SYNCOS_WEB_ORIGIN:-}" == 'https://staging-app.synccommsystems.com' ]] ) || { echo 'Explicit staging browser origin is required.' >&2; exit 65; }
install -d -o root -g syncos -m 2755 "$APP_ROOT/releases"
install -d -o root -g syncos -m 2750 "$APP_ROOT/shared/deployments"
dir="$APP_ROOT/releases/$sha"
[[ ! -L "$dir" ]] || { echo 'Symlink release path rejected.' >&2; exit 65; }
if [[ ! -e "$dir" ]]; then
 install -d -o deploy -g syncos -m 2750 "$dir"
 if [[ -n "$bundle" ]]; then
   git clone "$bundle" "$dir"
   git -c safe.directory="$dir" -C "$dir" remote set-url origin "$REPO"
 else
   runuser -u deploy -- git clone --branch "$BRANCH" --single-branch "$REPO" "$dir"
 fi
fi
[[ -d "$dir/.git" ]] || { echo 'Release is not a repository.' >&2; exit 65; }
chown -R deploy:syncos "$dir"
git_at(){ runuser -u deploy -- git -c safe.directory="$dir" -C "$dir" "$@"; }
[[ "$(git_at remote get-url origin)" == "$REPO" ]] || { echo 'Repository origin rejected.' >&2; exit 65; }
[[ -z "$(git_at status --porcelain --untracked-files=all)" ]] || { echo 'Dirty release rejected.' >&2; exit 65; }
if [[ -n "$bundle" ]]; then
 git -c safe.directory="$dir" -C "$dir" bundle verify "$bundle"
 git -c safe.directory="$dir" -C "$dir" fetch "$bundle" "$sha"
 [[ "$(git -c safe.directory="$dir" -C "$dir" rev-parse FETCH_HEAD)" == "$sha" ]] || exit 65
 chown -R deploy:syncos "$dir"
else
 git_at fetch origin "$BRANCH"
 git_at merge-base --is-ancestor "$sha" FETCH_HEAD
fi
git_at checkout --detach "$sha"
[[ "$(git_at rev-parse HEAD)" == "$sha" ]] || exit 65
# Build as the separate deployment user, never as root or the running service user.
chown -R deploy:syncos "$dir"
runuser -u deploy -- bash -c 'set -euo pipefail; cd "$1"; npm ci; npm run security:dependencies; npm run build -w @syncos/api; npm run build -w @syncos/web; npm run build -w @syncos/worker' bash "$dir"
[[ -z "$(git_at status --porcelain --untracked-files=all)" ]] || { echo 'Build changed tracked release inputs.' >&2; exit 65; }
ceiling=$(runuser -u deploy -- bash -c 'cd "$1"; node -p "require(\"@syncos/database\").currentMigrationCeiling"' bash "$dir")
[[ "$ceiling" =~ ^[0-9]+_[a-z0-9_]+\.sql$ ]] || { echo 'Invalid migration manifest ceiling.' >&2; exit 65; }
# The runtime cannot rewrite code that privileged deployment tools inspect.
chown -R root:syncos "$dir"
chmod -R u=rwX,g=rX,o= "$dir"
QUIESCED=true
systemctl stop syncos-staging-api syncos-staging-web syncos-staging-worker
bash "$CHECKPOINT" "$APP_ROOT" "$ENV_FILE"
(
 set -a
 source "$ENV_FILE"
 if [[ -r "$MIGRATION_ENV_FILE" ]]; then source "$MIGRATION_ENV_FILE"; fi
 set +a
 cd "$dir"
 runuser -u deploy -- env NODE_ENV=staging STAGING_DB_BACKUP_CONFIRMED=true npm run release:staging:migrate
 if [[ -n "${RUNTIME_DATABASE_ROLE:-}" ]]; then runuser -u deploy -- node scripts/security/runtime-database-access.js --apply; fi
 runuser -u deploy -- node scripts/security/verify-runtime-access.js
)
( set -a; source "$WORKER_ENV_FILE"; set +a; cd "$dir"; runuser -u deploy -- node scripts/security/verify-runtime-access.js )
ln -sfn "$dir" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
systemctl start syncos-staging-api syncos-staging-worker syncos-staging-web
for service in syncos-staging-api syncos-staging-worker syncos-staging-web; do systemctl is-active --quiet "$service"; done
runuser -u syncos -- bash -c 'cd "$1"; node scripts/check-deployed-startup.js https://staging-api.synccommsystems.com/health/startup' bash "$dir"
curl -fsSI --retry 10 --retry-delay 1 --retry-connrefused https://staging-app.synccommsystems.com/login >/dev/null
python3 - "$APP_ROOT/shared/deployments/current.json" "$sha" "$BRANCH" "$ceiling" <<'PY'
import sys,json,datetime,pathlib,os
p=pathlib.Path(sys.argv[1]);tmp=p.with_suffix('.next')
tmp.write_text(json.dumps({'environment':'staging','commit_sha':sys.argv[2],'branch':sys.argv[3],'migration_ceiling':sys.argv[4],'deployed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n')
os.chmod(tmp,0o640);tmp.replace(p)
PY
chown root:syncos "$APP_ROOT/shared/deployments/current.json"
COMPLETE=true
printf 'Staging activated and startup verified: %s (%s)\n' "$sha" "$ceiling"
