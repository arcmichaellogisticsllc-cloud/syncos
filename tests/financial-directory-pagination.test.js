const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {PaymentExecutionController}=require('../apps/api/dist/routes/payment-execution.controller');
const {AccountingExportController}=require('../apps/api/dist/routes/accounting-export.controller');
const database=process.env.SYNCOS_COMMERCIAL_TEST_DATABASE_URL;
test('financial directories expose older batches with stable paging, tenant isolation and validated bounds',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic directory',$1) RETURNING id",['directory-'+randomUUID()])).rows[0].id;
 await pool.query("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method) SELECT $1,'PAGE-'||n,'correction','manual' FROM generate_series(1,251) n",[tenant]);
 await pool.query("INSERT INTO accounting_export_batches(tenant_id,export_batch_number,export_type,target_system,export_format) SELECT $1,'PAGE-'||n,'correction','generic_csv','csv' FROM generate_series(1,251) n",[tenant]);
 const req={auth:{tenantId:tenant,userId:randomUUID()}};
 for(const controller of [new PaymentExecutionController(pool),new AccountingExportController(pool)]){
  const first=await controller.listBatches(req,{limit:'200',offset:'0'}),second=await controller.listBatches(req,{limit:'200',offset:'200'});
  assert.equal(first.length,200);assert.equal(second.length,51);assert.equal(new Set([...first,...second].map(r=>r.id)).size,251);
  assert.deepEqual((await controller.listBatches(req,{limit:'200',offset:'0'})).map(r=>r.id),first.map(r=>r.id));
  assert.equal((await controller.listBatches({auth:{tenantId:randomUUID()}},{limit:'200'})).length,0);
  for(const query of [{limit:'251'},{offset:'-1'},{limit:'1.5'},{offset:'Infinity'}])await assert.rejects(controller.listBatches(req,query),/must be an integer/);
 }
 }finally{await pool.end();}
});
