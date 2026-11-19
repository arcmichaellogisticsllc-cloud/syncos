const {spawn}=require('node:child_process'),{once}=require('node:events'),net=require('node:net'),fs=require('node:fs'),path=require('node:path');
const {acceptanceEnvironment}=require('./run-regression');
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){const env=acceptanceEnvironment(process.env),children=[],dist='.next-staffing-'+process.pid,generated=['next-env.d.ts','tsconfig.json'].map(f=>({file:path.resolve('apps/web',f),content:fs.readFileSync(path.resolve('apps/web',f))}));
 function launch(args,extra={},cwd=process.cwd()){const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},stdio:'inherit'});children.push(child);return child;}
 async function ready(url,child){for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error('Test service exited');try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Local test service did not start');}
 try{const ap=await port(),wp=await port(),api=`http://127.0.0.1:${ap}`,web=`http://127.0.0.1:${wp}`;
 const backend=launch(['apps/api/dist/main.js'],{SYNCOS_WEB_ORIGIN:web,PORT:String(ap),HOST:'127.0.0.1',EMAIL_PROVIDER:'disabled',WORKFLOW_NOTIFICATION_DELIVERY_ENABLED:'false'});await ready(api+'/health',backend);
 const frontend=launch([require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(wp)],{NODE_ENV:'development',SYNCOS_NEXT_DIST_DIR:dist,SYNCOS_API_BASE_URL:api,SYNCOS_WEB_ORIGIN:web},path.resolve('apps/web'));await ready(web+'/login',frontend);
 const tests=launch([require.resolve('@playwright/test/cli'),'test','--config','tests/staffing.config.ts'],{API_BASE_URL:api,WEB_BASE_URL:web});const [code]=await once(tests,'exit');if(code!==0)throw Error('Staffing browser tests failed');
 }finally{for(const child of children){if(child.exitCode!==null)continue;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await done;clearTimeout(timer);}fs.rmSync(path.resolve('apps/web',dist),{recursive:true,force:true});for(const item of generated)fs.writeFileSync(item.file,item.content);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
