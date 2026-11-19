#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
function acceptanceEnvironment(env){
 const db=new URL(env.DATABASE_URL||'');
 if(!['postgres:','postgresql:'].includes(db.protocol)||!['localhost','127.0.0.1','[::1]'].includes(db.hostname)||!/^syncos_synthetic_[a-z0-9_]+$/.test(db.pathname.slice(1)))throw Error('Acceptance tests require an explicitly named local synthetic database.');
 const api=new URL(env.API_BASE_URL||'');
 if(api.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(api.hostname)||api.username||api.password||api.pathname!=='/'||api.search||api.hash)throw Error('Acceptance tests require a local test API origin.');
 if(!env.AUTH_JWT_SECRET)throw Error('A synthetic signing secret is required.');
 return {...env,NODE_ENV:'test',SYNCOS_COMMERCIAL_TEST_DATABASE_URL:db.href,ROLE_PERMISSION_TEST_DATABASE_URL:db.href,SYNCOS_REPAIR_TEST_DATABASE_URL:db.href,SYNCOS_PRODUCT_TEST_API_URL:api.origin};
}
function summary(text){const number=name=>{const m=text.match(new RegExp('^# '+name+' (\\d+)$','m'));return m?Number(m[1]):null;};return {tests:number('tests'),passed:number('pass'),failed:number('fail'),skipped:number('skipped'),cancelled:number('cancelled')};}
async function run(){const env=acceptanceEnvironment(process.env),files=fs.readdirSync('tests').filter(f=>f.endsWith('.test.js')).sort().map(f=>path.join('tests',f));if(!files.length)throw Error('Regression suite is empty.');let output='';const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...files],{env,stdio:['ignore','pipe','inherit']});child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});child.on('error',reject);child.on('close',resolve);});const result=summary(output);if(code!==0||!result.tests||result.failed!==0||result.skipped!==0||result.cancelled!==0||result.passed!==result.tests)throw Error('Acceptance regression did not pass every test without skips.');}
module.exports={acceptanceEnvironment,summary};
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
