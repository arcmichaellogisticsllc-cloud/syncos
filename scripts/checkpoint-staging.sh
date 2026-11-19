#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || { echo 'Checkpoint requires the staging administrator.' >&2; exit 1; }
app_root="${1:?Staging root required}"
env_file="${2:?API environment file required}"
for service in syncos-staging-api syncos-staging-web syncos-staging-worker syncos-api syncos-web syncos-worker; do
  if systemctl is-active --quiet "$service"; then echo "Refusing checkpoint while $service is active." >&2; exit 1; fi
done
set -a
source "$env_file"
set +a
: "${DATABASE_URL:?Database configuration required}"
: "${SYNCOS_RESTRICTED_FILE_STORAGE_DIR:?Private file location must be explicit}"
[[ -d "$SYNCOS_RESTRICTED_FILE_STORAGE_DIR" ]] || { echo 'Private file directory unavailable.' >&2; exit 1; }
release="$(readlink -f "$app_root/current")"
sha="$(git -c safe.directory="$release" -C "$release" rev-parse HEAD)"
checkpoint="$(mktemp -d "$app_root/shared/deployments/checkpoint-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
# Credentials remain in the root environment; no shell tracing or URL logging.
CHECKPOINT="$checkpoint" SOURCE_RELEASE="$sha" python3 - <<'PY'
import os,pathlib,subprocess,urllib.parse,json,hashlib,datetime
root=pathlib.Path(os.environ['CHECKPOINT']);u=urllib.parse.urlsplit(os.environ['DATABASE_URL']);env=dict(os.environ)
env.update(PGHOST=u.hostname or 'localhost',PGPORT=str(u.port or 5432),PGUSER=urllib.parse.unquote(u.username or ''),PGPASSWORD=urllib.parse.unquote(u.password or ''),PGDATABASE=urllib.parse.unquote(u.path.lstrip('/')))
for key,value in urllib.parse.parse_qsl(u.query):
 if key in ('sslmode','sslrootcert','sslcert','sslkey','connect_timeout'):env['PG'+key.upper()]=value
storage=pathlib.Path(os.environ['SYNCOS_RESTRICTED_FILE_STORAGE_DIR']).resolve()
subprocess.run(['pg_dump','--format=custom','--no-owner','--no-acl','--file='+str(root/'database.dump')],env=env,check=True)
subprocess.run(['pg_restore','--list',str(root/'database.dump')],stdout=subprocess.DEVNULL,check=True)
subprocess.run(['tar','-czf',str(root/'private-files.tar.gz'),'-C',str(storage),'.'],check=True)
subprocess.run(['tar','-tzf',str(root/'private-files.tar.gz')],stdout=subprocess.DEVNULL,check=True)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
 return h.hexdigest()
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':os.environ['SOURCE_RELEASE'],'databaseName':env['PGDATABASE'],'storageRoot':str(storage),'writersStopped':True,'offsite':False,'files':{p.name:{'bytes':p.stat().st_size,'sha256':sha(p)} for p in [root/'database.dump',root/'private-files.tar.gz']}}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(root/'COMPLETE').write_text('Verified archive structure and paired checksums; restore rehearsal is separate.\n')
print(json.dumps({'checkpoint':str(root),'release':manifest['release'],'writersStopped':True,'offsite':False}))
PY
