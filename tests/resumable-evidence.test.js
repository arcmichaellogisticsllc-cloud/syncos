const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{Pool}=require('pg');
const {ResumableEvidence,UPLOAD_CHUNK_BYTES}=require('../apps/api/dist/routes/resumable-evidence');const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
const hash=b=>createHash('sha256').update(b).digest('hex');
test('resumable originals enforce ownership, chunk integrity, retries, expiry and completion',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic uploads',$1) RETURNING id",['uploads-'+randomUUID()])).rows[0].id,user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic uploader') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const service=new ResumableEvidence(pool),bytes=Buffer.alloc(UPLOAD_CHUNK_BYTES+7,5),metadata={daily_report_id:randomUUID(),description:'Original'},body={request_key:randomUUID(),metadata,byte_size:bytes.length,checksum:hash(bytes)};
 const session=await service.start(tenant,user,body);assert.equal((await service.start(tenant,user,body)).id,session.id);await assert.rejects(service.start(tenant,user,{...body,metadata:{...metadata,description:'Changed'}}),/different evidence/);
 await assert.rejects(service.chunk(tenant,randomUUID(),session.id,0,bytes.subarray(0,UPLOAD_CHUNK_BYTES).toString('base64')),/unavailable/);
 await assert.rejects(service.assemble(tenant,user,session.id),/incomplete/);
 await service.chunk(tenant,user,session.id,0,bytes.subarray(0,UPLOAD_CHUNK_BYTES).toString('base64'));await service.chunk(tenant,user,session.id,0,bytes.subarray(0,UPLOAD_CHUNK_BYTES).toString('base64'));
 assert.deepEqual((await service.start(tenant,user,body)).received,[0]);await assert.rejects(service.chunk(tenant,user,session.id,0,Buffer.alloc(UPLOAD_CHUNK_BYTES,6).toString('base64')),/different contents/);
 await assert.rejects(service.chunk(tenant,user,session.id,1,Buffer.alloc(8).toString('base64')),/size/);await service.chunk(tenant,user,session.id,1,bytes.subarray(UPLOAD_CHUNK_BYTES).toString('base64'));assert.deepEqual((await service.assemble(tenant,user,session.id)).bytes,bytes);
 const evidence=randomUUID();await service.finish(tenant,user,session.id,evidence);assert.equal((await service.assemble(tenant,user,session.id)).row.evidence_id,evidence);assert.equal((await pool.query('SELECT count(*)::int n FROM field_upload_chunks WHERE session_id=$1',[session.id])).rows[0].n,0);
 const bad=await service.start(tenant,user,{...body,request_key:randomUUID(),byte_size:1,checksum:hash(Buffer.from('a'))});await service.chunk(tenant,user,bad.id,0,Buffer.from('b').toString('base64'));await assert.rejects(service.assemble(tenant,user,bad.id),/integrity/);await pool.query("UPDATE field_upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[bad.id]);await assert.rejects(service.assemble(tenant,user,bad.id),/expired/);
 }finally{await pool.end();}});
test('new evidence is rejected during either stop type or revoked assignment before insertion',async()=>{
 const {SyncfieldController}=require('../apps/api/dist/routes/syncfield.controller');
 for(const mode of ['record-stop','work-stop','revoked']){
  let inserted=false;const client={query:async sql=>{if(sql.includes('INSERT INTO syncfield_field_evidence')){inserted=true;throw Error('must not insert');}return {rows:sql.includes('FROM production_records')&&mode==='record-stop'||sql.includes('FROM work_safety_controls')&&mode==='work-stop'?[{id:'stop'}]:[]};}};
  const c=new SyncfieldController({},{});c.withClient=async fn=>fn(client);c.requirePartnerForeman=async()=>({tenant_id:'tenant',organization:{id:'org'}});c.requireForemanCrew=async()=>({id:'crew'});c.requireDailyReportById=async()=>({id:'report',crew_id:'crew',organization_id:'org',work_order_id:'work',work_order_version_id:'version'});c.activeForemanAssignments=async()=>[];c.writeWithClient=async(_c,_r,_a,_e,_t,fn)=>fn(client);
  await assert.rejects(c.uploadFieldEvidence({auth:{userId:'user'}},{daily_report_id:'report',mime_type:'image/jpeg',content_base64:Buffer.from([255,216,255]).toString('base64'),file_name:'photo.jpg',description:'Original',client_mutation_id:'mutation'}),mode==='record-stop'?/stopped/:mode==='work-stop'?/safety_stop/:/active assignment/);assert.equal(inserted,false);
 }
});

test('finalization bounds concurrent original buffers and releases capacity after failure',async()=>{
 const {withEvidenceFinalization}=require('../apps/api/dist/routes/resumable-evidence');
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const first=withEvidenceFinalization(async()=>{await gate;return 'stored';});
 await assert.rejects(withEvidenceFinalization(async()=>assert.fail('second assembly must not start')),error=>error.getStatus()===503);
 release();assert.equal(await first,'stored');
 await assert.rejects(withEvidenceFinalization(async()=>{throw Error('storage interrupted');}),/storage interrupted/);
 assert.equal(await withEvidenceFinalization(async()=>'retry stored'),'retry stored');
});
