// Standalone destructive-to-new-target recovery check. Refuses shared environments.
const {Client,Pool}=require('pg');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const {PaymentRetainageAdjustmentsController}=require('../../apps/api/dist/routes/payment-retainage-adjustments.controller');
const sourceUrl=process.env.DATABASE_URL;
if(sourceUrl!=='postgresql://syncos_test@127.0.0.1:55439/syncos_acceptance')throw new Error('Requires disposable acceptance database');
const suffix=Date.now(), target=`syncos_recovery_${suffix}`, targetUrl=`postgresql://syncos_test@127.0.0.1:55439/${target}`;
const root=fs.mkdtempSync('/private/tmp/syncos-acceptance-recovery-');fs.chmodSync(root,0o700);
const quote=s=>'"'+s.replaceAll('"','""')+'"';
async function digest(client,table){return (await client.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${quote(table)} t`)).rows[0];}
async function files(rootPath){const result={};function visit(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.isDirectory())visit(file);else if(item.isFile())result[path.relative(rootPath,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}visit(rootPath);return result;}
(async()=>{
 const source=new Client({connectionString:sourceUrl}),restored=new Client({connectionString:targetUrl});await source.connect();let pool;
 try{
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot=(await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const tables=(await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  const before={};for(const table of tables)before[table]=await digest(source,table);
  const dump=path.join(root,'database.dump');execFileSync('pg_dump',['--format=custom','--no-owner','--no-acl',`--snapshot=${snapshot}`,`--dbname=${sourceUrl}`,`--file=${dump}`]);
  await source.query('COMMIT');
  execFileSync('createdb',['-h','127.0.0.1','-p','55439','-U','syncos_test',target]);
  execFileSync('pg_restore',['--exit-on-error','--no-owner','--no-acl',`--dbname=${targetUrl}`,dump]);
  await restored.connect();for(const table of tables)assert.deepEqual(await digest(restored,table),before[table],`restored ${table}`);
  const storage='/private/tmp/syncos-pre-payment-files', copy=path.join(root,'restored-files');fs.cpSync(storage,copy,{recursive:true});const originalFiles=await files(storage);assert.deepEqual(await files(copy),originalFiles);
  const row=(await restored.query("SELECT * FROM external_payment_observations WHERE observed_status='completed' ORDER BY received_at LIMIT 1")).rows[0];assert.ok(row,'a durable observation must exist');
  const paymentsBefore=await digest(restored,'payments'),auditBefore=await digest(restored,'audit_logs'),observationsBefore=await digest(restored,'external_payment_observations');
  pool=new Pool({connectionString:targetUrl});const controller=new PaymentRetainageAdjustmentsController(pool);
  const req={auth:{tenantId:row.tenant_id,userId:row.received_by},header:()=>undefined,ip:'127.0.0.1'};
  const replay=await controller.observeExternalPayment(req,{...row,completed_date:row.completed_date.toISOString().slice(0,10)});
  assert.equal(replay.id,row.id);
  assert.deepEqual(await digest(restored,'payments'),paymentsBefore);
  assert.deepEqual(await digest(restored,'audit_logs'),auditBefore);
  assert.deepEqual(await digest(restored,'external_payment_observations'),observationsBefore);
  const summary={status:'passed',tables:tables.length,tableContents:'all row counts and sorted row-content hashes matched',privateFiles:Object.keys(originalFiles).length,privateFileHashes:'matched',observationReplay:'same id; no additional observation, payment or audit',backupSha256:crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex'),target,artifactDirectory:root};
  fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
 }finally{await source.end();await restored.end().catch(()=>{});if(pool)await pool.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
