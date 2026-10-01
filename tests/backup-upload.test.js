const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
for(const kind of ['postgres','files'])test(`${kind} remote backup invokes AWS CLI for archive, manifest and verification and propagates failures`,()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'syncos-backup-test-')),bin=path.join(root,'bin');fs.mkdirSync(bin);
 const executable=(name,body)=>fs.writeFileSync(path.join(bin,name),'#!/bin/bash\nset -eu\n'+body,{mode:0o700});
 executable('aws','printf "%s\\n" "$*" >> "$CALLS"\nif [[ "${FAIL_UPLOAD:-}" == yes ]]; then exit 42; fi\n');
 executable('pg_dump','for arg in "$@"; do case "$arg" in --file=*) printf synthetic > "${arg#--file=}";; esac; done\n');
 executable('pg_restore','exit 0\n');
 executable('sha256sum','exec shasum -a 256 "$@"\n');
 executable('df','printf "Filesystem Blocks Used Available Capacity Mounted\\nlocal 100 1 99 1%% /\\n"\n');
 fs.mkdirSync(path.join(root,'storage'));fs.writeFileSync(path.join(root,'storage','proof.txt'),'synthetic');
 fs.writeFileSync(path.join(root,'env'),'DATABASE_URL=postgresql://synthetic\n');
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,CALLS:path.join(root,'calls'),SYNCOS_STAGING_ENV_FILE:path.join(root,'env'),SYNCOS_BACKUP_ENV_FILE:path.join(root,'absent'),SYNCOS_BACKUP_MODE:'s3_remote',SYNCOS_BACKUP_ROOT:path.join(root,'backups'),SYNCOS_STORAGE_ROOT:path.join(root,'storage'),SYNCOS_BACKUP_S3_BUCKET:'synthetic-test',SYNCOS_BACKUP_S3_PREFIX:'pilot',SYNCOS_BACKUP_SSE:'AES256',AWS_ENDPOINT_URL_S3:'https://example.invalid'};
 try{
  const run=spawnSync('bash',[`scripts/backup-staging-${kind}.sh`],{env,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const calls=fs.readFileSync(env.CALLS,'utf8').trim().split('\n');assert.equal(calls.length,3);assert.match(calls[0],/^s3 cp /);assert.match(calls[1],/manifest.json/);assert.match(calls[2],/^s3api head-object /);for(const line of calls)assert.match(line,/--endpoint-url https:\/\/example.invalid/);
  const failed=spawnSync('bash',[`scripts/backup-staging-${kind}.sh`],{env:{...env,FAIL_UPLOAD:'yes'},encoding:'utf8'});assert.equal(failed.status,42);assert.doesNotMatch(failed.stdout,/uploaded and verified/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
