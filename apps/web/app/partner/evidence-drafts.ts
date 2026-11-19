"use client";
import { readToken } from "../intelligence/api";
export const evidenceDatabase = "syncos-field-evidence";
export type EvidenceDraft = {
  scope: string; mutationId: string; reportId: string; recordId?: string;
  evidenceKind?: string; capturedAt?: string; captureLocation?: string;
  file: Blob; fileName: string; mimeType: string; description: string; savedAt: string;
};
// This key isolates local drafts; server authorization remains authoritative.
export function evidenceScope(reportId: string, recordId?: string) {
  try {
    const payload = JSON.parse(atob(readToken().split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (!payload.tenant_id || !payload.sub) throw new Error();
    return `${payload.tenant_id}:${payload.sub}:${reportId}:${recordId ?? 'report'}`;
  } catch { throw new Error("Sign in again before saving evidence."); }
}
async function database() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request=indexedDB.open(evidenceDatabase,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'scope'});
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    request.onerror=()=>reject(new Error("Device storage is unavailable. Keep the original file and try again."));
  });
}
export async function readEvidenceDraft(scope:string):Promise<EvidenceDraft|undefined> {
  const db=await database();
  try { return await new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readonly'), request=tx.objectStore('drafts').get(scope);
    tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  }); } finally { db.close(); }
}
export async function writeEvidenceDraft(scope:string, draft?:EvidenceDraft) {
  const db=await database();
  try { await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite');
    if(draft)tx.objectStore('drafts').put(draft);else tx.objectStore('drafts').delete(scope);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error("Could not save evidence on this device. Keep the original file and free some storage."));tx.onabort=()=>reject(new Error("Device save interrupted. Keep the original file and retry."));
  }); } finally { db.close(); }
}
