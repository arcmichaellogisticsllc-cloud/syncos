const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
function scenario(t,name){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'syncos-root-deploy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const bin=path.join(root,'bin'),app=path.join(root,'app'),sha='b'.repeat(40),calls=path.join(root,'calls');fs.mkdirSync(bin);fs.mkdirSync(path.join(app,'releases',sha,'.git'),{recursive:true});fs.mkdirSync(path.join(app,'shared/deployments'),{recursive:true});fs.writeFileSync(path.join(root,'api.env'),'NODE_ENV=staging\n');
 fs.writeFileSync(path.join(root,'worker.env'),'NODE_ENV=staging\n');fs.writeFileSync(path.join(root,'web.env'),'SYNCOS_WEB_ORIGIN='+ (name==='bad-origin'?'https://wrong.example':'https://staging-app.synccommsystems.com')+'\n');
 const checkpoint=path.join(root,'checkpoint');fs.writeFileSync(checkpoint,'#!/bin/bash\necho checkpoint >> "$TEST_CALLS"\n[[ "$TEST_SCENARIO" != checkpoint-failed ]]\n',{mode:0o755});
 const mock=`#!${process.execPath}
const fs=require('fs'),path=require('path');const tool=path.basename(process.argv[1]),a=process.argv.slice(2),s=process.env.TEST_SCENARIO;fs.appendFileSync(process.env.TEST_CALLS,tool+' '+a.join(' ')+'\\n');
if(tool==='id')console.log('0');
if(tool==='stat')console.log(a[1]==='%a'?'700':'0');
if(tool==='sha256sum')console.log((s==='bundle-checksum-failed'?'e':'c').repeat(64)+'  bundle');
if(tool==='git'&&a.includes('rev-parse'))console.log(process.env.TEST_SHA);
if(tool==='systemctl'&&a[0]==='is-active'){if(!a.at(-1).startsWith('syncos-staging-'))process.exit(s==='legacy'?0:3);if(s==='service-failed'&&a.at(-1)==='syncos-staging-worker')process.exit(3);}
if(tool==='runuser'){
 if(a.includes('git')){if(a.includes('get-url'))console.log('https://github.com/arcmichaellogisticsllc-cloud/syncos.git');if(a.includes('status')&&s==='dirty')console.log('?? tampered');if(a.includes('rev-parse'))console.log(process.env.TEST_SHA);}
 if(a.join(' ').includes('npm ci')&&s==='build-failed')process.exit(1);
 if(a.join(' ').includes('currentMigrationCeiling'))console.log('110_account_program_evidence.sql');
 if(a.includes('scripts/security/verify-runtime-access.js')&&s==='privilege-failed')process.exit(1);
 if(a.includes('release:staging:migrate')&&s==='migration-failed')process.exit(1);
 if(a.join(' ').includes('check-deployed-startup.js')&&s==='health-failed')process.exit(1);
}
`;
 for(const tool of ['id','flock','systemctl','install','runuser','chown','chmod','ln','mv','curl','stat','sha256sum','git'])fs.writeFileSync(path.join(bin,tool),mock,{mode:0o755});
 let source=fs.readFileSync('scripts/hostinger-staging-deploy-root.sh','utf8').replace(/^PATH=.*$/m,`PATH="${bin}:${process.env.PATH}"`).replace('APP_ROOT=/opt/syncos/staging',`APP_ROOT=${app}`).replace('ENV_FILE=/etc/syncos/staging/api.env',`ENV_FILE=${root}/api.env`).replace('WORKER_ENV_FILE=/etc/syncos/staging/worker.env',`WORKER_ENV_FILE=${root}/worker.env`).replace('WEB_ENV_FILE=/etc/syncos/staging/web.env',`WEB_ENV_FILE=${root}/web.env`).replace('CHECKPOINT=/usr/local/libexec/syncos/checkpoint-staging.sh',`CHECKPOINT=${checkpoint}`).replace('/run/lock/syncos-staging-deploy.lock',root+'/lock').replaceAll('/run/syncos-staging-backup.restart',root+'/restart');if(name==='backup-pending')fs.writeFileSync(root+'/restart','restart-staging-only\n');const script=path.join(root,'deploy.sh');fs.writeFileSync(script,source);
 const bundle=path.join(root,'release.bundle');fs.writeFileSync(bundle,'synthetic bundle');const args=name.startsWith('bundle-')?[script,sha,bundle,'c'.repeat(64)]:[script,sha];
 const result=spawnSync('bash',args,{env:{...process.env,TEST_CALLS:calls,TEST_SCENARIO:name,TEST_SHA:sha},encoding:'utf8',timeout:180000});assert.equal(result.error,undefined,result.error?.message);assert.ok(fs.existsSync(calls),result.stderr);return{result,calls:fs.readFileSync(calls,'utf8'),metadata:fs.existsSync(path.join(app,'shared/deployments/current.json'))};
}
for(const name of ['legacy','dirty','build-failed','bad-origin','backup-pending'])test('root wrapper rejects '+name+' without stopping writers',t=>{const r=scenario(t,name);assert.notEqual(r.result.status,0);assert.doesNotMatch(r.calls,/systemctl stop|checkpoint\n|release:staging:migrate/);assert.equal(r.metadata,false);});
for(const name of ['checkpoint-failed','migration-failed','service-failed','health-failed','privilege-failed'])test('root wrapper fails closed on '+name,t=>{const r=scenario(t,name);assert.notEqual(r.result.status,0);assert.match(r.calls.trim().split('\n').at(-1),/systemctl stop/);assert.equal(r.metadata,false);if(name==='checkpoint-failed')assert.doesNotMatch(r.calls,/release:staging:migrate/);});
test('root wrapper checkpoints stopped writers, migrates as deployment user and publishes exact metadata after health',t=>{const r=scenario(t,'healthy');assert.equal(r.result.status,0,r.result.stderr);assert.ok(r.calls.indexOf('systemctl stop')<r.calls.indexOf('checkpoint\n'));assert.ok(r.calls.indexOf('checkpoint\n')<r.calls.indexOf('release:staging:migrate'));assert.match(r.calls,/runuser -u deploy -- env NODE_ENV=staging STAGING_DB_BACKUP_CONFIRMED=true npm run release:staging:migrate/);assert.match(r.calls,/runuser -u deploy -- bash/);assert.equal(r.metadata,true);});

test('private bundle checksum failure rejects activation before writers stop',t=>{const r=scenario(t,'bundle-checksum-failed');assert.notEqual(r.result.status,0);assert.doesNotMatch(r.calls,/systemctl stop|release:staging:migrate/);assert.equal(r.metadata,false);});
test('private bundle activates exact verified commit without fetching public origin',t=>{const r=scenario(t,'bundle-healthy');assert.equal(r.result.status,0,r.result.stderr);assert.match(r.calls,/bundle verify/);assert.doesNotMatch(r.calls,/fetch origin/);assert.equal(r.metadata,true);});

test('private bundle clone materializes files before clean-release validation',()=>{const source=fs.readFileSync('scripts/hostinger-staging-deploy-root.sh','utf8');assert.match(source,/git clone "\$bundle" "\$dir"/);assert.doesNotMatch(source,/git clone --no-checkout/);});
