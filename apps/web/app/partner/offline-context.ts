"use client";
import {readToken} from '../intelligence/api';
export async function prepareOfflineContext(assignments:Array<{id?:string;project?:{name?:string};work_order?:{work_order_number?:string};crew?:{name?:string}}>) {
 if(!('serviceWorker' in navigator))return;
 const token=readToken();if(!token)return;
 const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
 if(!claims.sub||!claims.tenant_id)return;
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 if(token!==readToken())return;
 const now=Date.now(),expires=Math.min(now+3600000,claims.exp?Number(claims.exp)*1000:now+3600000);if(!Number.isFinite(expires)||expires<=now)return;
 localStorage.setItem('syncos.offlineContext',JSON.stringify({fingerprint,tenant:claims.tenant_id,user:claims.sub,savedAt:now,expires,assignments:assignments.map(a=>({id:a.id,project:a.project?.name,workOrder:a.work_order?.work_order_number,crew:a.crew?.name}))}));
 await navigator.serviceWorker.register('/syncfield/offline-worker.js',{scope:'/syncfield/'});
}
