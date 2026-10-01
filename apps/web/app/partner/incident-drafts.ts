"use client";
export type IncidentDraft={scope:string;payload:Record<string,unknown>;savedAt:string};
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('syncos-field-incidents',1);q.onupgradeneeded=()=>q.result.createObjectStore('drafts',{keyPath:'scope'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(new Error('Device storage unavailable. Your incident has not been saved.'));});}
export async function incidentDraft(scope:string,value?:IncidentDraft|null):Promise<IncidentDraft|undefined>{
 const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('drafts',value===undefined?'readonly':'readwrite'),store=tx.objectStore('drafts');const q=value===undefined?store.get(scope):value===null?store.delete(scope):store.put(value);tx.oncomplete=()=>resolve(value===undefined?q.result:value??undefined);tx.onerror=()=>reject(new Error('Device save failed. Keep your report and contact your supervisor.'));tx.onabort=()=>reject(new Error('Device save interrupted. Your report is not confirmed.'));});}finally{db.close();}
}
