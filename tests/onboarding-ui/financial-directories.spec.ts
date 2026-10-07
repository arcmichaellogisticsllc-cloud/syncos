import {test,expect} from '@playwright/test';
for(const domain of ['payments','accounting-exports']) {
 const payment=domain==='payments',prefix=payment?'payment-batches':'accounting-export-batches',permission=payment?'payment':'accounting_export';
 test(`${domain} displays attention items beyond 25 batches and reports incomplete loading`,async({page})=>{
  test.setTimeout(90000);
  const permissions=[`${permission}_batch.read`,`${permission}_item.read`];
  await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic-financial-directory'));
  await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'synthetic',tenant_id:'synthetic',roles:['system_admin'],permissions,tenant_permissions:permissions}}));
  const batches=Array.from({length:26},(_,i)=>({id:`batch-${i}`,payment_batch_number:`Batch ${i}`,export_batch_number:`Batch ${i}`,status:'submitted',created_at:'2026-10-06',updated_at:'2026-10-06'}));let fail=false;const requested=new Set<string>();
  await page.route(`**/api/syncos/${prefix}**`,r=>{const url=new URL(r.request().url());if(url.pathname.endsWith('/items')){const id=url.pathname.split('/').at(-2)!;requested.add(id);if(id==='batch-25'){if(fail)return r.fulfill({status:503,json:{message:'Older batch temporarily unavailable'}});return r.fulfill({json:[{id:'older-item',payee_name:'Older batch exception',memo:'Older batch exception',status:'failed',execution_status:'failed',export_status:'failed',mapping_status:'mapping_error',payment_batch_id:id,accounting_export_batch_id:id}]});}return r.fulfill({json:[]});}const offset=Number(url.searchParams.get('offset')??0);return r.fulfill({json:batches.slice(offset,offset+200)});});
  await page.goto('/'+domain);await expect(page.getByRole('cell',{name:/Older batch exception/})).toBeVisible({timeout:45000});expect(requested.size).toBe(26);
  fail=true;await page.reload();await expect(page.getByText('Older batch temporarily unavailable',{exact:false}).first()).toBeVisible({timeout:45000});await expect(page.getByRole('cell',{name:/Older batch exception/})).toHaveCount(0);
 });
}
