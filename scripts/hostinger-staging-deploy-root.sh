#!/usr/bin/env bash
# Installed root-owned as /usr/local/sbin/syncos-staging-deploy.
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 027
[[ "$(id -u)" -eq 0 ]] || { echo 'Use the approved privileged staging wrapper.' >&2; exit 64; }
[[ $# -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply one exact 40-character release SHA.' >&2; exit 64; }
sha=$1
APP_ROOT=/opt/syncos/staging
ENV_FILE=/etc/syncos/staging/api.env
CHECKPOINT=/usr/local/libexec/syncos/checkpoint-staging.sh
REPO=https://github.com/arcmichaellogisticsllc-cloud/syncos.git
BRANCH=codex/financial-completion-20260930
exec 9>/run/lock/syncos-staging-deploy.lock
flock -n 9 || { echo 'Another staging deployment is active.' >&2; exit 75; }
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
install -d -o root -g syncos -m 2755 "$APP_ROOT/releases"
install -d -o root -g syncos -m 2750 "$APP_ROOT/shared/deployments"
dir="$APP_ROOT/releases/$sha"
[[ ! -L "$dir" ]] || { echo 'Symlink release path rejected.' >&2; exit 65; }
if [[ ! -e "$dir" ]]; then
 install -d -o deploy -g syncos -m 2750 "$dir"
 runuser -u deploy -- git clone --branch "$BRANCH" --single-branch "$REPO" "$dir"
fi
[[ -d "$dir/.git" ]] || { echo 'Release is not a repository.' >&2; exit 65; }
chown -R deploy:syncos "$dir"
git_at(){ runuser -u deploy -- git -c safe.directory="$dir" -C "$dir" "$@"; }
[[ "$(git_at remote get-url origin)" == "$REPO" ]] || { echo 'Repository origin rejected.' >&2; exit 65; }
[[ -z "$(git_at status --porcelain --untracked-files=all)" ]] || { echo 'Dirty release rejected.' >&2; exit 65; }
git_at fetch origin "$BRANCH"
git_at merge-base --is-ancestor "$sha" FETCH_HEAD
git_at checkout --detach "$sha"
[[ "$(git_at rev-parse HEAD)" == "$sha" ]] || exit 65
# Build as the separate deployment user, never as root or the running service user.
chown -R deploy:syncos "$dir"
runuser -u deploy -- bash -c 'set -euo pipefail; cd "$1"; npm ci; npm audit --omit=dev --audit-level=high; npm run build -w @syncos/api; npm run build -w @syncos/web; npm run build -w @syncos/worker' bash "$dir"
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
 set +a
 cd "$dir"
 runuser -u syncos -- env NODE_ENV=staging STAGING_DB_BACKUP_CONFIRMED=true npm run release:staging:migrate
)
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
