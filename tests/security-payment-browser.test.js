const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {chromium,expect}=require('@playwright/test');
const {createAuthToken}=require('../packages/auth/dist');
const database=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL,web=process.env.SYNCOS_SECURITY_TEST_WEB;
test('browser: separate finance review and permission-based payment actions',{skip:!database||!web,timeout:120000},async()=>{
 assert.match(new URL(database).pathname,/security_audit/);assert.match(web,/^http:\/\/127\.0\.0\.1:/);
 const db=new Pool({connectionString:database});let browser;
 try{
  const tenant=(await db.query("SELECT id FROM tenants WHERE status='active' LIMIT 1")).rows[0].id;
  const permissions=['payment_batch.read','payment_item.read','payroll_run.read','contractor_payable.read','payment_batch.add_item'];
  async function actor(extra=[]){const id=(await db.query("INSERT INTO users(email,display_name) VALUES($1,'Synthetic browser security') RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id;
   const membership=(await db.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2) RETURNING id',[tenant,id])).rows[0].id;
   const role=(await db.query('INSERT INTO roles(tenant_id,name) VALUES($1,$2) RETURNING id',[tenant,randomUUID()])).rows[0].id;
   await db.query('INSERT INTO user_roles(tenant_id,tenant_user_id,role_id) VALUES($1,$2,$3)',[tenant,membership,role]);
   await db.query('INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE key=ANY($3::text[])',[tenant,role,[...permissions,...extra]]);
   return createAuthToken({sub:id,tenant_id:tenant,auth_version:0,exp:Math.floor(Date.now()/1000)+3600},process.env.AUTH_JWT_SECRET);
  }
  const preparer=await actor(),finance=await actor(['payment_exception.approve']);
  const batch=(await db.query("INSERT INTO payment_batches(tenant_id,payment_batch_number,batch_type,payment_method) VALUES($1,$2,'payroll','manual') RETURNING id",[tenant,'BROWSER-'+randomUUID()])).rows[0].id;
  const source=(await db.query("INSERT INTO payroll_runs(tenant_id,payroll_run_number,payroll_run_type,payroll_cycle,payroll_period_start,payroll_period_end,status,payroll_readiness_status,hold_status) VALUES($1,$2,'regular','weekly','2026-10-01','2026-10-07','payroll_ready','ready_for_payroll','hold') RETURNING id",[tenant,'BROWSER-'+randomUUID()])).rows[0].id;
  browser=await chromium.launch({headless:true});
  async function pageFor(token){const context=await browser.newContext();await context.addInitScript(value=>localStorage.setItem('syncos.apiToken',value),token);const page=await context.newPage();await page.goto(web+'/payments/'+batch,{waitUntil:'domcontentloaded',timeout:60000});await expect(page.getByRole('heading',{name:'Finance exception review'})).toBeVisible({timeout:30000});return page;}
  const p=await pageFor(preparer);
  await expect(p.getByRole('button',{name:'Approve exception',exact:true})).toHaveCount(0);
  await p.getByLabel('Payment source',{exact:true}).selectOption(source);
  await p.getByLabel('Reason for finance review').fill('Synthetic browser hold request for independent review');
  await p.getByRole('button',{name:'Request independent review'}).click();
  await expect(p.getByText('pending',{exact:true})).toBeVisible();
  await expect(p.getByRole('button',{name:'Approve exception',exact:true})).toHaveCount(0);
  const f=await pageFor(finance);
  await f.getByLabel('Finance review note',{exact:true}).fill('Independent finance approval from browser test');
  await f.getByRole('button',{name:'Approve exception',exact:true}).click();
  await expect(f.getByText('approved',{exact:true})).toBeVisible();
  const rows=await db.query('SELECT requested_by,approved_by,status FROM payment_security_exceptions WHERE payment_batch_id=$1',[batch]);
  assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].status,'approved');assert.notEqual(rows.rows[0].requested_by,rows.rows[0].approved_by);
  await expect(f.getByRole('button',{name:'Approve exception',exact:true})).toHaveCount(0);
 }finally{if(browser)await browser.close();await db.end();}
});
