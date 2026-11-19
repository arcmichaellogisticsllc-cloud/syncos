const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{chromium,expect}=require('@playwright/test'),{hashPassword}=require('../packages/auth/dist');
const database=process.env.SYNCOS_SECURITY_TEST_DATABASE_URL,web=process.env.SYNCOS_SECURITY_TEST_WEB;
test('real browser login uses HttpOnly session and logout preserves queued work',{skip:!database||!web,timeout:120000},async()=>{assert.match(new URL(database).pathname,/security_audit/);assert.match(web,/^http:\/\/127\.0\.0\.1:/);const db=new Pool({connectionString:database});let browser;try{
const tenant=(await db.query("SELECT id FROM tenants WHERE status='active' LIMIT 1")).rows[0].id,email=randomUUID()+'@example.invalid',password=randomUUID()+'test';
const u=(await db.query("INSERT INTO users(email,display_name,password_hash) VALUES($1,'Synthetic session browser',$2) RETURNING id",[email,hashPassword(password)])).rows[0].id;
await db.query('INSERT INTO tenant_users(tenant_id,user_id) VALUES($1,$2)',[tenant,u]);
browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage();await page.goto(web+'/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:/^Sign In$/i}).click();await expect(page).not.toHaveURL(/\/login$/,{timeout:30000});
const marker=await page.evaluate(()=>localStorage.getItem('syncos.apiToken'));assert.match(marker,/^browser-session\./);assert.ok(!(await page.evaluate(()=>document.cookie)).includes('syncos_session'));const cookie=(await context.cookies()).find(c=>c.name==='syncos_session');assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,'Strict');assert.notEqual(marker,cookie.value);
await page.evaluate(()=>localStorage.setItem('syncos.fieldMutations',JSON.stringify([{scope:'preservation-test',id:'unsent'}])));
await page.getByRole('button',{name:'Log Out',exact:true}).click();await expect(page).toHaveURL(/\/login$/);assert.equal(await page.evaluate(()=>localStorage.getItem('syncos.apiToken')),null);assert.match(await page.evaluate(()=>localStorage.getItem('syncos.fieldMutations')),/unsent/);assert.ok(!(await context.cookies()).some(c=>c.name==='syncos_session'));
// An interrupted sign-out preserves the queue and completes revocation on reconnect.
await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:/^Sign In$/i}).click();await expect(page).not.toHaveURL(/\/login$/,{timeout:30000});
await context.route('**/api/syncos/auth/browser-logout',route=>route.abort('internetdisconnected'));
await page.getByRole('button',{name:'Log Out',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
assert.equal(await page.evaluate(()=>localStorage.getItem('syncos.pendingSignOut')),'true');assert.equal(await page.evaluate(()=>localStorage.getItem('syncos.apiToken')),null);
await context.unroute('**/api/syncos/auth/browser-logout');await page.reload();await expect.poll(async()=>page.evaluate(()=>localStorage.getItem('syncos.pendingSignOut'))).toBe(null);
assert.ok(!(await context.cookies()).some(c=>c.name==='syncos_session'));assert.match(await page.evaluate(()=>localStorage.getItem('syncos.fieldMutations')),/unsent/);

}finally{if(browser)await browser.close();await db.end();}});
