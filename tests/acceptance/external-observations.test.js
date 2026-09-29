const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {Client}=require('pg');
const manifest=require('../e2e/fixtures/e2e-demo-records.json');
const base=process.env.API_BASE_URL;
if(base!=='http://127.0.0.1:3247'||!process.env.DATABASE_URL?.endsWith(':55439/syncos_acceptance'))throw new Error('This test requires the isolated acceptance API and database');
function token(persona){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify({sub:manifest.personas[persona].userId,tenant_id:manifest.tenant.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.${crypto.createHmac('sha256',process.env.AUTH_JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;}
async function call(persona,path,body){const response=await fetch(`${base}/payment-retainage-adjustments/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token(persona)}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
test('durable observations deduplicate concurrent delivery, retain conflicts and deny field actors without posting money',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const before=await db.query('SELECT count(*)::int AS n FROM payments');
  const tx='synthetic-'+crypto.randomUUID();const body={provider:'passport',account_reference:'synthetic-account',transaction_reference:tx,payee_reference:'synthetic-payee',amount:'123.45',currency:'USD',observed_status:'completed',completed_date:new Date().toISOString().slice(0,10),evidence_reference:'SYNTHETIC-NO-MONEY'};
  const all=await Promise.all(Array.from({length:8},()=>call('system-admin','external-payment-observations',body)));
  for(const r of all)assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(new Set(all.map(r=>r.data.id)).size,1);
  const row=all[0].data;assert.equal(row.review_status,'needs_review');
  const conflict=await call('system-admin','external-payment-observations',{...body,amount:'123.46'});assert.equal(conflict.status,201);assert.notEqual(conflict.data.id,row.id);
  const missing=await call('system-admin',`external-payment-observations/${row.id}/link-recorded-payment`,{external_partner_payment_id:crypto.randomUUID(),review_note:'Synthetic conflict test',account_and_payee_verified:true});assert.equal(missing.status,400);
  const denied=await call('field-supervisor','external-payment-observations',body);assert.equal(denied.status,403);
  const readDenied=await call('field-supervisor','external-payment-observations');assert.equal(readDenied.status,403);
  const persisted=(await db.query('SELECT count(*)::int AS n FROM external_payment_observations WHERE tenant_id=$1 AND transaction_reference=$2',[manifest.tenant.id,tx])).rows[0];assert.equal(persisted.n,2);
  const audit=(await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND entity_type='external_payment_observation' AND entity_id=$2",[manifest.tenant.id,row.id])).rows[0];assert.equal(audit.n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM payments')).rows[0].n,before.rows[0].n);
 }finally{await db.end();}
});
