export type DeliveryReceipt={receipt_id:string;status:'delivered';received_at:string;package_checksum:string};
export function approvedDeliveryEndpoint(value:string){const url=new URL(value),allowed=(process.env.PRIME_DELIVERY_ALLOWED_HOSTS??'').split(',').map(s=>s.trim());const local=process.env.NODE_ENV==='test'&&url.hostname==='127.0.0.1';if((url.protocol!=='https:'&&!local)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||(!local&&!allowed.includes(url.host)))throw Error('Destination is not approved by the server operator');return url;}
export function validateDeliveryReceipt(value:unknown,checksum:string):DeliveryReceipt{
 const r=value as Partial<DeliveryReceipt>;if(!r||r.status!=='delivered'||typeof r.receipt_id!=='string'||!r.receipt_id.trim()||r.receipt_id.length>500||r.package_checksum!==checksum||typeof r.received_at!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(r.received_at)||!Number.isFinite(Date.parse(r.received_at))||Date.parse(r.received_at)>Date.now()+5000)throw Error('Provider response does not establish package delivery');return r as DeliveryReceipt;
}
export async function transmitPrimePackage(destination:{endpoint:string;credential_env:string},job:{id:string;checksum:string;bytes:Buffer}):Promise<DeliveryReceipt>{
 const endpoint=approvedDeliveryEndpoint(destination.endpoint);if(!/^PRIME_DELIVERY_TOKEN_[A-Z0-9_]+$/.test(destination.credential_env)||!process.env[destination.credential_env])throw Error('Destination credentials are unavailable');
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${process.env[destination.credential_env]}`,'content-type':'application/zip','idempotency-key':job.id,'x-package-sha256':job.checksum},body:new Uint8Array(job.bytes),signal:AbortSignal.timeout(30000)});
 // Only an explicit retryable rejection can be retried automatically. Timeouts remain uncertain.
 if(response.status===429){await response.body?.cancel();throw Object.assign(Error('Provider rate limited this attempt'),{retryable:true});}
 if(!response.ok){await response.body?.cancel();throw Error('Provider did not confirm delivery');}
 const reader=response.body?.getReader();if(!reader)throw Error('Missing delivery receipt');let size=0;const parts:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384)throw Error('Receipt exceeds size limit');parts.push(part.value);}}finally{await reader.cancel();}
 return validateDeliveryReceipt(JSON.parse(Buffer.concat(parts).toString('utf8')),job.checksum);
}
