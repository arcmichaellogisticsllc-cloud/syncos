"use client";
import type {FormSchema} from '@syncos/shared/form-schema';
export type FormDraft={scope:string;versionId:string;schema:FormSchema;answers:Record<string,unknown>;requestKey:string;savedAt:number};
export const draftScope=(tenant:string,user:string,version:string)=>JSON.stringify([tenant,user,version]);
const lifetime=7*24*60*60*1000;
export async function formDraft(scope:string,value?:FormDraft|null):Promise<FormDraft|undefined>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('syncos-form-drafts',1);q.onupgradeneeded=()=>q.result.createObjectStore('drafts',{keyPath:'scope'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(new Error('Device storage is unavailable. Keep this page open to preserve your answers.'));});
 try{
  const result=await new Promise<FormDraft|undefined>((resolve,reject)=>{const tx=db.transaction('drafts',value===undefined?'readonly':'readwrite');const store=tx.objectStore('drafts');const q=value===undefined?store.get(scope):value===null?store.delete(scope):store.put(value);tx.oncomplete=()=>resolve(value===undefined?q.result:value??undefined);tx.onerror=tx.onabort=()=>reject(new Error('Device save failed. Your draft is not confirmed saved.'));});
  if(result&&(!Number.isFinite(result.savedAt)||Date.now()-result.savedAt>lifetime)){await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(scope);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('Expired draft cleanup failed.'));});return undefined;}
  return result;
 }finally{db.close();}
}
