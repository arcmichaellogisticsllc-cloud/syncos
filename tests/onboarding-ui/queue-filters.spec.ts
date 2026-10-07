import {test,expect} from '@playwright/test';
for(const domain of ['payments','accounting-exports']) {
 const prefix=domain==='payments'?'payment-batches':'accounting-export-batches',permission=domain==='payments'?'payment':'accounting_export';
 test(`${domain} filters refresh without losing input focus and attention excludes healthy items`,async({page})=>{
  const permissions=[`${permission}_batch.read`,`${permission}_item.read`],queries:string[]=[];
  await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic-filter-test'));
  await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'synthetic',tenant_id:'synthetic',roles:['system_admin'],permissions,tenant_permissions:permissions}}));
  await page.route(`**/api/syncos/${prefix}**`,async r=>{
   const url=new URL(r.request().url());
   if(url.pathname.endsWith('/queue-summary'))return r.fulfill({json:{draft:0,submitted:26,approved:0,scheduled:0,submittedExecution:0,executed:0,voided:0,archived:0,itemsAttention:1,markedSubmitted:0,accepted:0,canceled:0,failed:0,currency_totals:[]}});if(url.pathname.endsWith('/items'))return r.fulfill({json:[{id:'healthy',payee_name:'Healthy payment item',memo:'Healthy payment item',status:'ready',execution_status:'not_submitted',export_status:'pending',mapping_status:'mapped'},{id:'attention',payee_name:'Needs review item',memo:'Needs review item',status:'failed',execution_status:'failed',export_status:'failed',mapping_status:'mapping_error'}]});
   const q=url.searchParams.get('q')??'';queries.push(q);if(q==='older')await new Promise(resolve=>setTimeout(resolve,800));
   return r.fulfill({json:[{id:q||'batch',payment_batch_number:q||'Default batch',export_batch_number:q||'Default batch',status:'under_review',approval_status:'pending'}]});
  });
  await page.goto('/'+domain);await expect(page.getByRole('cell',{name:/Needs review item/})).toBeVisible();
  await page.getByRole('tab',{name:'Items Need Attention'}).click();await expect(page.getByRole('cell',{name:/Healthy payment item/})).toHaveCount(0);
  await page.getByText('Advanced filters',{exact:true}).click();const search=page.getByRole('textbox',{name:'Search batches'});
  await search.fill('older');await expect.poll(()=>queries.includes('older')).toBe(true);await search.fill('latest');
  await expect.poll(()=>queries.includes('latest')).toBe(true);await expect(search).toBeFocused();await expect(search).toHaveValue('latest');
  await page.getByRole('tab',{name:'Submitted for Review'}).click();await expect(page.getByRole('link',{name:'latest',exact:true})).toBeVisible();
  await page.waitForTimeout(900);await expect(page.getByRole('link',{name:'older',exact:true})).toHaveCount(0);
 });
}
test('reconciliation includes transactions beyond the former 250-record cutoff',async({page})=>{
 const permissions=['bank_account.read','bank_transaction.read','reconciliation_match.read'],offsets:number[]=[];
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic-bank-paging'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'synthetic',tenant_id:'synthetic',roles:['system_admin'],permissions,tenant_permissions:permissions}}));
 await page.route('**/api/syncos/bank-accounts?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('summary')==='true'?[{archivedAccounts:0}]:[{id:'account',account_name:'Synthetic bank',status:'active'}]}));
 await page.route('**/api/syncos/reconciliation-matches?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('summary')==='true'?[{reviewMatches:0,archivedMatches:0}]:[]}));
 const rows=Array.from({length:251},(_,i)=>({id:`tx-${i}`,description:`Transaction ${i+1}`,bank_account_id:'account',bank_account_name:'Synthetic bank',direction:'credit',reconciliation_status:'unreconciled',exception_status:'none',amount:'10',transaction_date:'2026-10-06'}));
 await page.route('**/api/syncos/bank-transactions?**',r=>{const url=new URL(r.request().url()),offset=Number(url.searchParams.get('offset')??0);if(url.searchParams.get('summary')==='true')return r.fulfill({json:[{unmatchedCredits:251,unmatchedDebits:0,openExceptions:0,resolvedExceptions:0,ignored:0,matched:0,archivedTransactions:0}]});offsets.push(offset);return r.fulfill({json:rows.slice(offset,offset+200)});});
 await page.goto('/bank-reconciliation');await expect(page.getByRole('link',{name:'Transaction 251',exact:true})).toBeVisible();expect(offsets).toContain(200);
 await page.setViewportSize({width:390,height:860});const region=page.locator('.wide-table').filter({has:page.getByRole('link',{name:'Transaction 251',exact:true})});await expect(region).toHaveAttribute('tabindex','0');await region.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
});

for(const domain of ['payments','accounting-exports'])test(`${domain} terminal queue preserves history without appearing approved`,async({page})=>{
 const payment=domain==='payments',prefix=payment?'payment-batches':'accounting-export-batches',permission=payment?'payment':'accounting_export';
 const permissions=[`${permission}_batch.read`];
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic-terminal-test'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'synthetic',tenant_id:'synthetic',roles:['system_admin'],permissions,tenant_permissions:permissions}}));
 await page.route(`**/api/syncos/${prefix}**`,r=>r.fulfill({json:r.request().url().includes('/queue-summary')?{draft:0,submitted:0,approved:0,scheduled:0,submittedExecution:0,executed:0,voided:0,archived:0,itemsAttention:null,markedSubmitted:0,accepted:0,canceled:0,failed:1,currency_totals:[]}:[{id:'failed-history',payment_batch_number:'Failed historical batch',export_batch_number:'Failed historical batch',status:'failed',approval_status:'approved',execution_status:'failed',export_status:'failed'}]}));
 await page.goto('/'+domain);
 await page.getByRole('tab',{name:payment?'Failed / Cancelled':'Failed / Rejected',exact:true}).click();
 await expect(page.getByRole('link',{name:'Failed historical batch',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Approved',exact:true}).click();
 await expect(page.getByRole('link',{name:'Failed historical batch',exact:true})).toHaveCount(0);
});
test('cash workbench exposes receipts beyond its former 100-record cutoff',async({page})=>{
 const permissions=['cash_receipt.read'],offsets:number[]=[];
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic-cash-paging'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'synthetic',tenant_id:'synthetic',roles:['system_admin'],permissions,tenant_permissions:permissions}}));
 const rows=Array.from({length:251},(_,i)=>({id:`receipt-${i}`,receipt_number:`Cash receipt ${i+1}`,payer_name:'Synthetic customer',receipt_status:'unapplied',gross_received_amount:'10',unapplied_amount:'10',applied_amount:'0',currency:'USD',payment_date:'2026-10-06',payment_method:'check'}));
 await page.route('**/api/syncos/cash-receipts?**',r=>{const offset=Number(new URL(r.request().url()).searchParams.get('offset')??0);offsets.push(offset);return r.fulfill({json:rows.slice(offset,offset+200)});});
 await page.goto('/cash');await expect(page.getByRole('link',{name:'Cash receipt 251',exact:true})).toBeVisible();expect(offsets).toContain(200);
});
