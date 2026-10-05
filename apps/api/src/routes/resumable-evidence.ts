import {BadRequestException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
export const UPLOAD_CHUNK_BYTES=1048576,UPLOAD_MAX_BYTES=104857600;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function uuid(value:unknown){if(typeof value!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))throw new BadRequestException('Invalid upload reference.');return value;}
export class ResumableEvidence {
 constructor(private pool:Pool){}
 async start(tenant:string,user:string,body:{request_key:unknown;metadata:Record<string,unknown>;byte_size:unknown;checksum:unknown}){
  const key=uuid(body.request_key),size=Number(body.byte_size),checksum=String(body.checksum);
  if(!Number.isSafeInteger(size)||size<1||size>UPLOAD_MAX_BYTES||!/^[a-f0-9]{64}$/.test(checksum))throw new BadRequestException('Choose an original file up to 100 MiB with a valid checksum.');
  return this.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant+':upload-quota:'+user]);
   await c.query('DELETE FROM field_upload_sessions WHERE tenant_id=$1 AND user_id=$2 AND expires_at<now()',[tenant,user]);
   const existing=(await c.query('SELECT * FROM field_upload_sessions WHERE tenant_id=$1 AND user_id=$2 AND request_key=$3',[tenant,user,key])).rows[0];
   if(existing){if(existing.byte_size!==size||existing.checksum!==checksum||JSON.stringify(canonical(existing.metadata))!==JSON.stringify(canonical(body.metadata)))throw new BadRequestException('This upload reference already belongs to different evidence.');return this.status(c,existing);}
   const usage=(await c.query('SELECT count(*)::int n,coalesce(sum(byte_size),0)::bigint bytes FROM field_upload_sessions WHERE tenant_id=$1 AND user_id=$2 AND evidence_id IS NULL',[tenant,user])).rows[0];
   if(usage.n>=10||Number(usage.bytes)+size>209715200)throw new BadRequestException('Finish pending uploads before starting more. Device originals are preserved.');
   const row=(await c.query('INSERT INTO field_upload_sessions(tenant_id,user_id,request_key,metadata,byte_size,checksum) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[tenant,user,key,JSON.stringify(body.metadata),size,checksum])).rows[0];return this.status(c,row);
  });
 }
 async chunk(tenant:string,user:string,id:string,index:unknown,encoded:unknown){
  uuid(id);if(!Number.isInteger(index)||Number(index)<0||Number(index)>99||typeof encoded!=='string'||encoded.length>1398104||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new BadRequestException('Invalid upload chunk.');
  const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded||!bytes.length||bytes.length>UPLOAD_CHUNK_BYTES)throw new BadRequestException('Invalid upload chunk.');
  return this.transaction(async c=>{const row=await this.session(c,tenant,user,id);if(row.evidence_id)return this.status(c,row);
   const expected=Math.min(UPLOAD_CHUNK_BYTES,row.byte_size-Number(index)*UPLOAD_CHUNK_BYTES);if(bytes.length!==expected)throw new BadRequestException('Chunk size does not match this upload.');
   const old=(await c.query('SELECT checksum FROM field_upload_chunks WHERE session_id=$1 AND chunk_index=$2',[id,index])).rows[0];if(old&&old.checksum!==hash(bytes))throw new BadRequestException('This chunk was already received with different contents.');
   if(!old)await c.query('INSERT INTO field_upload_chunks(session_id,chunk_index,content,checksum) VALUES($1,$2,$3,$4)',[id,index,bytes,hash(bytes)]);return this.status(c,row);
  });
 }
 async assemble(tenant:string,user:string,id:string){uuid(id);return this.transaction(async c=>{const row=await this.session(c,tenant,user,id);if(row.evidence_id)return {row,bytes:undefined};const chunks=(await c.query('SELECT chunk_index,content,checksum FROM field_upload_chunks WHERE session_id=$1 ORDER BY chunk_index',[id])).rows;if(chunks.length!==Math.ceil(row.byte_size/UPLOAD_CHUNK_BYTES)||chunks.some((part,i)=>part.chunk_index!==i||hash(part.content)!==part.checksum))throw new BadRequestException('Upload is incomplete. Resume missing chunks.');const bytes=Buffer.concat(chunks.map(part=>part.content));if(bytes.length!==row.byte_size||hash(bytes)!==row.checksum)throw new BadRequestException('Original file integrity check failed.');return {row,bytes};});}
 async finish(tenant:string,user:string,id:string,evidenceId:string){return this.transaction(async c=>{await this.session(c,tenant,user,id);await c.query('UPDATE field_upload_sessions SET evidence_id=$4 WHERE tenant_id=$1 AND user_id=$2 AND id=$3',[tenant,user,id,evidenceId]);await c.query('DELETE FROM field_upload_chunks WHERE session_id=$1',[id]);return {id,evidence_id:evidenceId};});}
 private async session(c:PoolClient,tenant:string,user:string,id:string){const row=(await c.query('SELECT * FROM field_upload_sessions WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND expires_at>now() FOR UPDATE',[tenant,user,id])).rows[0];if(!row)throw new NotFoundException('Upload is unavailable or expired. Retry from the saved original.');return row;}
 private async status(c:PoolClient,row:any){return {id:row.id,chunk_bytes:UPLOAD_CHUNK_BYTES,received:(await c.query('SELECT chunk_index FROM field_upload_chunks WHERE session_id=$1 ORDER BY chunk_index',[row.id])).rows.map(r=>r.chunk_index),evidence_id:row.evidence_id,expires_at:row.expires_at};}
 private async transaction<T>(fn:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
}
function canonical(value:any):any{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}

// Finalization briefly holds the original and its validation buffers in memory.
// Bound this per API process; clients retain received chunks and retry on 503.
let finalizingOriginal = false;
export async function withEvidenceFinalization<T>(action: () => Promise<T>): Promise<T> {
 if (finalizingOriginal) throw new ServiceUnavailableException('Another original is being finalized. Your uploaded parts are saved; retry shortly.');
 finalizingOriginal = true;
 try { return await action(); } finally { finalizingOriginal = false; }
}
