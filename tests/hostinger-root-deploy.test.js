const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
function scenario(t,name){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'syncos-root-deploy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const bin=path.join(root,'bin'),app=path.join(root,'app'),sha='b'.repeat(40),calls=path.join(root,'calls');fs.mkdirSync(bin);fs.mkdirSync(path.join(app,'releases',sha,'.git'),{recursive:true});fs.mkdirSync(path.join(app,'shared/deployments'),{recursive:true});fs.writeFileSync(path.join(root,'api.env'),'NODE_ENV=staging\n');
 const checkpoint=path.join(root,'checkpoint');fs.writeFileSync(checkpoint,'#!/bin/bash\necho checkpoint >> "$TEST_CALLS"\n[[ "$TEST_SCENARIO" != checkpoint-failed ]]\n',{mode:0o755});
 const mock=`#!${process.execPath}
const fs=require('fs'),path=require('path');const tool=path.basename(process.argv[1]),a=process.argv.slice(2),s=process.env.TEST_SCENARIO;fs.appendFileSync(process.env.TEST_CALLS,tool+' '+a.join(' ')+'\\n');
if(tool==='id')console.log('0');
if(tool==='systemctl'&&a[0]==='is-active'){if(!a.at(-1).startsWith('syncos-staging-'))process.exit(s==='legacy'?0:3);if(s==='service-failed'&&a.at(-1)==='syncos-staging-worker')process.exit(3);}
if(tool==='runuser'){
 if(a.includes('git')){if(a.includes('get-url'))console.log('https://github.com/arcmichaellogisticsllc-cloud/syncos.git');if(a.includes('status')&&s==='dirty')console.log('?? tampered');if(a.includes('rev-parse'))console.log(process.env.TEST_SHA);}
 if(a.join(' ').includes('npm ci')&&s==='build-failed')process.exit(1);
 if(a.join(' ').includes('currentMigrationCeiling'))console.log('110_account_program_evidence.sql');
 if(a.includes('release:staging:migrate')&&s==='migration-failed')process.exit(1);
 if(a.join(' ').includes('check-deployed-startup.js')&&s==='health-failed')process.exit(1);
}
`;
 for(const tool of ['id','flock','systemctl','install','runuser','chown','chmod','ln','mv','curl'])fs.writeFileSync(path.join(bin,tool),mock,{mode:0o755});
 let source=fs.readFileSync('scripts/hostinger-staging-deploy-root.sh','utf8').replace(/^PATH=.*$/m,`PATH="${bin}:${process.env.PATH}"`).replace('APP_ROOT=/opt/syncos/staging',`APP_ROOT=${app}`).replace('ENV_FILE=/etc/syncos/staging/api.env',`ENV_FILE=${root}/api.env`).replace('CHECKPOINT=/usr/local/libexec/syncos/checkpoint-staging.sh',`CHECKPOINT=${checkpoint}`).replace('/run/lock/syncos-staging-deploy.lock',root+'/lock');const script=path.join(root,'deploy.sh');fs.writeFileSync(script,source);
 const result=spawnSync('bash',[script,sha],{env:{...process.env,TEST_CALLS:calls,TEST_SCENARIO:name,TEST_SHA:sha},encoding:'utf8',timeout:60000});assert.equal(result.error,undefined,result.error?.message);assert.ok(fs.existsSync(calls),result.stderr);return{result,calls:fs.readFileSync(calls,'utf8'),metadata:fs.existsSync(path.join(app,'shared/deployments/current.json'))};
}
for(const name of ['legacy','dirty','build-failed'])test('root wrapper rejects '+name+' without stopping writers',t=>{const r=scenario(t,name);assert.notEqual(r.result.status,0);assert.doesNotMatch(r.calls,/systemctl stop|checkpoint\n|release:staging:migrate/);assert.equal(r.metadata,false);});
for(const name of ['checkpoint-failed','migration-failed','service-failed','health-failed'])test('root wrapper fails closed on '+name,t=>{const r=scenario(t,name);assert.notEqual(r.result.status,0);assert.match(r.calls.trim().split('\n').at(-1),/systemctl stop/);assert.equal(r.metadata,false);if(name==='checkpoint-failed')assert.doesNotMatch(r.calls,/release:staging:migrate/);});
test('root wrapper checkpoints stopped writers, migrates as service user and publishes exact metadata after health',t=>{const r=scenario(t,'healthy');assert.equal(r.result.status,0,r.result.stderr);assert.ok(r.calls.indexOf('systemctl stop')<r.calls.indexOf('checkpoint\n'));assert.ok(r.calls.indexOf('checkpoint\n')<r.calls.indexOf('release:staging:migrate'));assert.match(r.calls,/runuser -u syncos -- env NODE_ENV=staging STAGING_DB_BACKUP_CONFIRMED=true npm run release:staging:migrate/);assert.match(r.calls,/runuser -u deploy -- bash/);assert.equal(r.metadata,true);});
