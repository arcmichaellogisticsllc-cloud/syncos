const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{Pool}=require('pg');
const {ResumableEvidence,UPLOAD_CHUNK_BYTES,withEvidenceFinalization}=require('../apps/api/dist/routes/resumable-evidence');
const url=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
const concurrency=Number(process.env.SYNCOS_UPLOAD_CONCURRENCY||8);if(!Number.isInteger(concurrency)||concurrency<2||concurrency>64)throw Error('Use 2–64 streams');
test('concurrent upload streams preserve originals and retry bounded finalization',{skip:!url,timeout:120000},async()=>{
 const pool=new Pool({connectionString:url});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic upload load',$1) RETURNING id",['load-'+randomUUID()])).rows[0].id,user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic uploader') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const users=[user];for(let n=1;n<Math.ceil(concurrency/8);n++)users.push((await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic uploader') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id);
 const storage=new ResumableEvidence(pool),before=process.memoryUsage().rss,started=Date.now();
 const streams=await Promise.all(Array.from({length:concurrency},async(_,i)=>{const user=users[Math.floor(i/8)];const original=Buffer.alloc(UPLOAD_CHUNK_BYTES*4,i),checksum=createHash('sha256').update(original).digest('hex');const session=await storage.start(tenant,user,{request_key:randomUUID(),metadata:{daily_report_id:randomUUID(),description:'Synthetic stream '+i},byte_size:original.length,checksum});await Promise.all(Array.from({length:4},(_,index)=>storage.chunk(tenant,user,session.id,index,original.subarray(index*UPLOAD_CHUNK_BYTES,(index+1)*UPLOAD_CHUNK_BYTES).toString('base64'))));return {session,checksum,user};}));
 async function finish(stream){return withEvidenceFinalization(async()=>{const result=await storage.assemble(tenant,stream.user,stream.session.id);assert.equal(createHash('sha256').update(result.bytes).digest('hex'),stream.checksum);await storage.finish(tenant,stream.user,stream.session.id,randomUUID());});}
 const first=await Promise.allSettled(streams.map(finish));assert.equal(first.filter(r=>r.status==='fulfilled').length,1);
 for(let i=0;i<first.length;i++)if(first[i].status==='rejected'){assert.equal(first[i].reason.getStatus(),503);await finish(streams[i]);}
 const rows=(await pool.query('SELECT count(*)::int n FROM field_upload_sessions WHERE tenant_id=$1 AND evidence_id IS NOT NULL',[tenant])).rows[0];assert.equal(rows.n,concurrency);assert.equal((await pool.query('SELECT count(*)::int n FROM field_upload_chunks ch JOIN field_upload_sessions s ON s.id=ch.session_id WHERE s.tenant_id=$1',[tenant])).rows[0].n,0);
 console.log(JSON.stringify({scenario:'synthetic database transport only',streams:concurrency,originalMiB:4,totalMiB:concurrency*4,elapsedMs:Date.now()-started,rssGrowthMiB:Math.round((process.memoryUsage().rss-before)/1048576)}));
 }finally{await pool.end();}
});
