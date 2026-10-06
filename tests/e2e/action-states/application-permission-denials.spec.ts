import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {personaList} from '../fixtures/personas';
import 'reflect-metadata';
const {AppModule}=require('../../../apps/api/dist/modules/app.module');
const reflected=Reflect as any;
const controllers=reflected.getMetadata('controllers',AppModule) as any[];
const methods=['GET','POST','PUT','DELETE','PATCH','ALL','OPTIONS','HEAD'];
const routes:{path:string;method:string;permission:string}[]=[];
for(const controller of controllers){const base=reflected.getMetadata('path',controller);for(const name of Object.getOwnPropertyNames(controller.prototype)){const handler=controller.prototype[name];if(typeof handler!=='function'||reflected.getMetadata('isPublic',handler))continue;const method=methods[reflected.getMetadata('method',handler)],permission=reflected.getMetadata('requiredPermission',handler),path=reflected.getMetadata('path',handler);if(!['POST','PATCH','PUT','DELETE'].includes(method)||!permission||typeof base!=='string'||typeof path!=='string')continue;routes.push({path:('/'+base+'/'+path).replace(/\/+/g,'/').replace(/\/$/,'').replace(/:[^/]+/g,'00000000-0000-4000-8000-000000000001'),method,permission});}}
for(const persona of personaList)test(`all protected writes deny missing grants for ${persona.slug}`,async({request})=>{
 test.setTimeout(120000);const storage=JSON.parse(readFileSync(persona.storageState,'utf8')),token=storage.origins[0].localStorage.find((v:any)=>v.name==='syncos.apiToken').value,headers={authorization:`Bearer ${token}`};
 const me=await request.get(`${process.env.API_BASE_URL}/auth/me`,{headers});expect(me.ok()).toBeTruthy();const context=await me.json(),permissions=new Set(context.permissions);
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 async function counts(){return (await db.query(`SELECT (SELECT count(*) FROM audit_logs) audit,(SELECT count(*) FROM events) events,(SELECT count(*) FROM invoices) invoices,(SELECT count(*) FROM payments) payments,(SELECT count(*) FROM prime_delivery_jobs) deliveries,(SELECT count(*) FROM oidc_identity_links) identities`)).rows[0];}
 try{const before=await counts();let checked=0;for(const route of routes){if(permissions.has(route.permission))continue;const response=await request.fetch(`${process.env.API_BASE_URL}${route.path}`,{method:route.method,headers,data:{}});expect(response.status(),`${persona.slug} ${route.method} ${route.path}: ${await response.text()}`).toBe(403);checked++;}expect(checked).toBeGreaterThanOrEqual(persona.slug==='system-admin'?0:20);expect(await counts()).toEqual(before);}finally{await db.end();}
});
