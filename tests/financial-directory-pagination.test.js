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
const {BankReconciliationController}=require('../apps/api/dist/routes/bank-reconciliation.controller');
test('bank directories page all accounts, transactions and matches without losing older records',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic bank paging',$1) RETURNING id",['bank-paging-'+randomUUID()])).rows[0].id;
 const accounts=(await pool.query("INSERT INTO bank_accounts(tenant_id,account_name,account_type) SELECT $1,'Account '||n,'operating' FROM generate_series(1,251) n RETURNING id",[tenant])).rows;
 const transactions=(await pool.query("INSERT INTO bank_transactions(tenant_id,bank_account_id,transaction_date,direction,amount,description,transaction_type) SELECT $1,$2,'2026-10-06','credit',10,'Receipt '||n,'deposit_in' FROM generate_series(1,251) n RETURNING id",[tenant,accounts[0].id])).rows;
 await pool.query("INSERT INTO reconciliation_matches(tenant_id,bank_transaction_id,match_type,matched_object_type,matched_amount) SELECT $1,$2,'manual_adjustment','manual',1 FROM generate_series(1,251)",[tenant,transactions[0].id]);
 const controller=new BankReconciliationController(pool),req={auth:{tenantId:tenant,userId:randomUUID()}};
 for(const method of ['listAccounts','listTransactions','listMatches']){
  const first=await controller[method](req,{limit:'200'}),second=await controller[method](req,{limit:'200',offset:'200'});
  assert.equal(first.length,200);assert.equal(second.length,51);assert.equal(new Set([...first,...second].map(r=>r.id)).size,251);
  assert.deepEqual((await controller[method](req,{limit:'200'})).map(r=>r.id),first.map(r=>r.id));
  assert.equal((await controller[method]({auth:{tenantId:randomUUID()}},{})).length,0);
  await assert.rejects(controller[method](req,{limit:'251'}),/must be an integer/);
 }
 assert.equal((await controller.listTransactions(req,{q:'Receipt 251'})).length,1);
 assert.equal((await controller.listTransactions(req,{summary:'true'}))[0].unmatchedCredits,251);
 assert.equal((await controller.listTransactions(req,{summary:'true',q:'Receipt 251'}))[0].unmatchedCredits,1);
 assert.equal((await controller.listMatches(req,{summary:'true'}))[0].reviewMatches,251);
 assert.equal((await controller.listAccounts(req,{summary:'true'}))[0].archivedAccounts,0);
 }finally{await pool.end();}
});
test('accounting export filters honor date bounds and mapping/error flags',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic export filters',$1) RETURNING id",['export-filter-'+randomUUID()])).rows[0].id;
 const batch=(await pool.query("INSERT INTO accounting_export_batches(tenant_id,export_batch_number,export_type,target_system,export_format,period_start,period_end,error_count) VALUES($1,'EX-A','correction','generic_csv','csv','2026-09-01','2026-09-30',1) RETURNING id",[tenant])).rows[0].id;
 await pool.query("INSERT INTO accounting_export_items(tenant_id,accounting_export_batch_id,source_object_type,source_object_id,export_item_type,mapping_status) VALUES($1,$2,'invoice',$3,'correction','mapping_error')",[tenant,batch,randomUUID()]);
 const c=new AccountingExportController(pool),r={auth:{tenantId:tenant}};
 for(const q of [{period_start_from:'2026-09-01',period_end_to:'2026-09-30'},{has_errors:'true'},{has_mapping_errors:'true'}])assert.equal((await c.listBatches(r,q)).length,1);
 for(const q of [{period_start_from:'2026-09-02'},{period_end_to:'2026-09-29'},{has_errors:'false'},{has_mapping_errors:'false'}])assert.equal((await c.listBatches(r,q)).length,0);
 await assert.rejects(c.listBatches(r,{has_errors:'maybe'}),/must be true or false/);
 }finally{await pool.end();}
});
test('financial queue summaries use all matching rows, separate currencies and restrict item attention',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic summaries',$1) RETURNING id",['summary-'+randomUUID()])).rows[0].id;
 const user=(await pool.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic summary reader') RETURNING id",[randomUUID()+'@synthetic.test'])).rows[0].id;
 const membership=(await pool.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,user])).rows[0].id;
 const role=(await pool.query("INSERT INTO roles(tenant_id,name,system_key) VALUES($1,'Synthetic summary reader','synthetic_summary') RETURNING id",[tenant])).rows[0].id;
 await pool.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,membership,role]);
 const req={auth:{tenantId:tenant,userId:user}},payment=new PaymentExecutionController(pool),exports=new AccountingExportController(pool);
 const batch=(await pool.query("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method,status,total_payment_amount,currency) SELECT $1,'SUM-'||n,'correction','manual','scheduled',1.25,'USD' FROM generate_series(1,251) n RETURNING id",[tenant])).rows[0].id;
 await pool.query("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method,status,execution_status,total_payment_amount,currency) VALUES($1,'SUM-EUR','correction','manual','executed_later','executed_later',20,'EUR'),($1,'SUM-PARTIAL','correction','manual','partially_executed_later','partially_executed_later',50,'USD')",[tenant]);
 await pool.query("INSERT INTO payment_items(tenant_id,payment_batch_id,source_type,payment_method,payee_type,payment_amount,status) VALUES($1,$2,'correction','manual','internal_self_perform',1,'failed')",[tenant,batch]);
 const e=(await pool.query("INSERT INTO accounting_export_batches(tenant_id,export_batch_number,export_type,target_system,export_format) VALUES($1,'SUMMARY','correction','generic_csv','csv') RETURNING id",[tenant])).rows[0].id;
 await pool.query("INSERT INTO accounting_export_items(tenant_id,accounting_export_batch_id,source_object_type,source_object_id,export_item_type,mapping_status) VALUES($1,$2,'invoice',$3,'correction','mapping_error')",[tenant,e,randomUUID()]);
 let summary=await payment.queueSummary(req,{limit:'1'});assert.equal(summary.scheduled,251);assert.equal(summary.itemsAttention,null);assert.equal(summary.executed,2);
 assert.deepEqual(summary.currency_totals,[{currency:'EUR',scheduled_amount:'0',executed_amount:'20.00',partially_executed_batch_amount:'0'},{currency:'USD',scheduled_amount:'313.75',executed_amount:'0',partially_executed_batch_amount:'50.00'}]);
 assert.equal((await exports.queueSummary(req,{})).itemsAttention,null);
 await pool.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key IN ('payment_item.read','accounting_export_item.read')",[tenant,role]);
 assert.equal((await payment.queueSummary(req,{})).itemsAttention,1);assert.equal((await exports.queueSummary(req,{})).itemsAttention,1);
 assert.equal((await payment.queueSummary(req,{q:'SUM-EUR'})).scheduled,0);assert.equal((await exports.queueSummary(req,{q:'absent'})).itemsAttention,0);
 await pool.query("UPDATE user_roles SET scope_type='organization',scope_id=$2 WHERE tenant_id=$1",[tenant,randomUUID()]);
 assert.equal((await payment.queueSummary(req,{})).itemsAttention,null);
 await pool.query("UPDATE user_roles SET scope_type='tenant',scope_id=NULL WHERE tenant_id=$1",[tenant]);
 await pool.query('UPDATE tenant_users SET deleted_at=now() WHERE id=$1',[membership]);
 assert.equal((await exports.queueSummary(req,{})).itemsAttention,null);
 assert.equal((await payment.queueSummary({auth:{tenantId:randomUUID(),userId:user}},{})).scheduled,0);
 }finally{await pool.end();}
});
test('export queues prioritize current lifecycle over retained approval and acceptance history',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic queue precedence',$1) RETURNING id",['precedence-'+randomUUID()])).rows[0].id;
 for(const [number,status,approval,exported,accepted] of [['ACCEPTED','accepted_later','approved','accepted_later',true],['FAILED','failed','approved','failed',true],['CANCELLED','cancelled','approved','cancelled',true],['APPROVED','approved','approved','generated',false]]){
  await pool.query("INSERT INTO accounting_export_batches(tenant_id,export_batch_number,export_type,target_system,export_format,status,approval_status,export_status,accepted_at) VALUES($1,$2,'correction','generic_csv','csv',$3,$4,$5,CASE WHEN $6 THEN now() ELSE NULL END)",[tenant,number,status,approval,exported,accepted]);
 }
 const c=new AccountingExportController(pool),summary=await c.queueSummary({auth:{tenantId:tenant,userId:randomUUID()}},{});
 assert.equal(summary.accepted,1);assert.equal(summary.failed,1);assert.equal(summary.canceled,1);assert.equal(summary.approved,1);assert.equal(summary.draft,0);assert.equal(summary.submitted,0);
 }finally{await pool.end();}
});

test('payment queues exclude terminal batches from scheduled and executed currency totals',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic terminal payments',$1) RETURNING id",['terminal-'+randomUUID()])).rows[0].id;
 for(const [number,status,execution] of [['FAILED','failed','executed_later'],['CANCELLED','cancelled','not_submitted'],['VOIDED','voided','executed_later']]){
  await pool.query("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method,status,execution_status,total_payment_amount,currency) VALUES($1,$2,'correction','manual',$3,$4,25,'USD')",[tenant,number,status,execution]);
 }
 const summary=await new PaymentExecutionController(pool).queueSummary({auth:{tenantId:tenant,userId:randomUUID()}},{});
 assert.equal(summary.failed,2);assert.equal(summary.voided,1);assert.equal(summary.scheduled,0);assert.equal(summary.executed,0);
 for(const row of summary.currency_totals){assert.equal(Number(row.scheduled_amount),0);assert.equal(Number(row.executed_amount),0);assert.equal(Number(row.partially_executed_batch_amount),0);}
 }finally{await pool.end();}
});
const {CashController}=require('../apps/api/dist/routes/cash.controller');
test('cash receipt and allocation directories retain older reconciliation sources with stable pages',{skip:!database},async()=>{
 const pool=new Pool({connectionString:database});try{
 const tenant=(await pool.query("INSERT INTO tenants(name,slug) VALUES('Synthetic receipt paging',$1) RETURNING id",['cash-paging-'+randomUUID()])).rows[0].id;
 const receipts=(await pool.query("INSERT INTO cash_receipts(tenant_id,receipt_number,payment_date,payment_method,gross_received_amount,unapplied_amount) SELECT $1,'OLDER-'||n,'2026-10-06','check',10,10 FROM generate_series(1,251) n RETURNING id",[tenant])).rows;
 const invoice=(await pool.query("INSERT INTO invoices(tenant_id,invoice_number) VALUES($1,'SYNTHETIC-PAGING') RETURNING id",[tenant])).rows[0].id;
 const organization=(await pool.query("INSERT INTO organizations(tenant_id,name,organization_type) VALUES($1,'Synthetic paging customer','prime_contractor') RETURNING id",[tenant])).rows[0].id;
 await pool.query("INSERT INTO payment_applications(tenant_id,cash_receipt_id,invoice_id,customer_organization_id,applied_amount,application_date) SELECT $1,$2,$3,$4,1,'2026-10-06' FROM generate_series(1,251)",[tenant,receipts[0].id,invoice,organization]);
 const c=new CashController(pool),r={auth:{tenantId:tenant,userId:randomUUID()}};
 for(const method of ['listCashReceipts','listPaymentApplications']){
  const first=await c[method](r,{limit:'200'}),second=await c[method](r,{limit:'200',offset:'200'});
  assert.equal(first.length,200);assert.equal(second.length,51);assert.equal(new Set([...first,...second].map(v=>v.id)).size,251);
  assert.deepEqual((await c[method](r,{limit:'200'})).map(v=>v.id),first.map(v=>v.id));
  assert.equal((await c[method]({auth:{tenantId:randomUUID()}},{limit:'200'})).length,0);
  await assert.rejects(c[method](r,{limit:'251'}),/must be an integer/);
 }
 assert.equal((await c.listCashReceipts(r,{q:'OLDER-251'})).length,1);
 }finally{await pool.end();}
});
