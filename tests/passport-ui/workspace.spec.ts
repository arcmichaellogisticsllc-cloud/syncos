import {test,expect,type Page} from '@playwright/test';
const {buildPreview}=require('../../packages/passport/src/preview');
async function session(page:Page,permissions=['partner_payment.confirm']){
 await page.route('**/api/syncos/passport-intake',r=>r.fulfill({json:{connections:[],mappings:[],exceptions:[],jobs:[]}}));
 await page.addInitScript(()=>{localStorage.setItem('syncos.apiToken','synthetic-token');localStorage.setItem('syncos.permissions','partner_payment.confirm');});
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'synthetic',tenant_id:'synthetic',roles:['finance_manager'],permissions,routing:{workspace:'/finance'}}}));
}
test('finance sees simulation, filters and details without any write actions',async({page})=>{
 await session(page);await page.route('**/api/syncos/payment-retainage-adjustments/passport-preview',async r=>r.fulfill({json:await buildPreview()}));
 const writes:string[]=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 await page.goto('/passport');await expect(page.getByRole('heading',{name:'Passport reconciliation',exact:true})).toBeVisible();
 await expect(page.getByText('Never connected',{exact:true})).toBeVisible();await expect(page.getByText('8 examples shown',{exact:true})).toBeVisible();
 await page.getByLabel('Show payments').selectOption('exception');await expect(page.getByText('5 examples shown',{exact:true})).toBeVisible();
 await page.getByLabel('Search examples').fill('EXAMPLE-RETURNED');await expect(page.getByText('1 example shown',{exact:true})).toBeVisible();
 await page.getByText('Review details for EXAMPLE-RETURNED',{exact:true}).click();await expect(page.getByText('Review the provider return and prepare an audited adjustment.',{exact:true})).toBeVisible();
 await page.getByLabel('Search examples').fill('absent');await expect(page.getByRole('heading',{name:'No matching examples'})).toBeVisible();await page.getByRole('button',{name:'Clear filters'}).click();await expect(page.getByText('8 examples shown',{exact:true})).toBeVisible();
 expect(writes).toEqual([]);await expect(page.getByRole('button',{name:/send payment|mark paid|resolve|connect/i})).toHaveCount(0);
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/private/tmp/passport-ui-${width}.png`,fullPage:true});}
});
test('unapproved server identity overrides forged stored permissions and never requests preview',async({page})=>{
 await session(page,[]);let requests=0;await page.route('**/api/syncos/payment-retainage-adjustments/passport-preview',r=>{requests++;return r.fulfill({json:{}});});await page.goto('/passport');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();expect(requests).toBe(0);await expect(page.getByRole('link',{name:'Passport Reconciliation'})).toHaveCount(0);
});
test('failed preview provides retry and recovers',async({page})=>{
 await session(page);let fail=true;await page.route('**/api/syncos/payment-retainage-adjustments/passport-preview',async r=>{return fail?r.fulfill({status:503,json:{message:'unavailable'}}):r.fulfill({json:await buildPreview()});});await page.goto('/passport');await expect(page.getByText('We could not load the preview. Check your connection and retry.',{exact:true})).toBeVisible();fail=false;await page.getByRole('button',{name:'Retry preview'}).click();await expect(page.getByText('8 examples shown',{exact:true})).toBeVisible();
});

test('saved preparation is distinct from preview, requires admin for accounts and never posts money',async({page})=>{
 await session(page,['partner_payment.confirm','admin.manage_users']);
 await page.route('**/api/syncos/payment-retainage-adjustments/passport-preview',async r=>r.fulfill({json:await buildPreview()}));
 const data={connections:[] as any[],mappings:[] as any[],payables:[{id:'payable-1',payable_number:'SYNTHETIC-PAYABLE',net_payable_amount:'100.00'}],exceptions:[{id:'review-1',transaction_reference:'SYNTHETIC-1',reason:'provider_acceptance_required',status:'open'}],jobs:[]};
 await page.route('**/api/syncos/passport-intake',r=>r.fulfill({json:data}));
 const writes:string[]=[];
 await page.route('**/api/syncos/passport-intake/connections',async r=>{writes.push(r.request().url());expect(r.request().postDataJSON()).toEqual({customer_reference:'SYNTHETIC-CUSTOMER',account_reference:'SYNTHETIC-ACCOUNT'});data.connections.push({id:'connection-1',customer_reference:'SYNTHETIC-CUSTOMER',account_reference:'SYNTHETIC-ACCOUNT'});await r.fulfill({json:data.connections[0]});});
 await page.route('**/api/syncos/passport-intake/connections/connection-1/mappings',async r=>{writes.push(r.request().url());expect(r.request().postDataJSON()).toEqual({contractor_payable_id:'payable-1',transaction_reference:'TX-1',payee_reference:'PAYEE-1',amount:'40.00',currency:'USD',evidence_reference:'Synthetic sandbox verification',account_and_payee_verified:true});data.mappings.push({id:'mapping-1',transaction_reference:'TX-1',amount:'40.00'});await r.fulfill({json:data.mappings[0]});});
 await page.route('**/api/syncos/passport-intake/exceptions/review-1/review',async r=>{writes.push(r.request().url());expect(r.request().postDataJSON()).toEqual({review_note:'Awaiting sandbox evidence'});data.exceptions[0].status='reviewed';await r.fulfill({json:data.exceptions[0]});});
 await page.goto('/passport');await expect(page.getByRole('heading',{name:'Saved integration preparation'})).toBeVisible();
 await page.getByLabel('Customer reference',{exact:true}).fill('SYNTHETIC-CUSTOMER');await page.getByLabel('Account reference',{exact:true}).fill('SYNTHETIC-ACCOUNT');await page.getByRole('button',{name:'Save account references'}).click();
 await expect(page.getByText('SYNTHETIC-CUSTOMER / SYNTHETIC-ACCOUNT — disabled',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Prepared account',exact:true}).selectOption('connection-1');await page.getByRole('combobox',{name:'Partner payable',exact:true}).selectOption('payable-1');await page.getByLabel('Transaction reference',{exact:true}).fill('TX-1');await page.getByLabel('Payee reference',{exact:true}).fill('PAYEE-1');await page.getByLabel('Transaction amount (USD)',{exact:true}).fill('40.00');await page.getByLabel('Verification evidence',{exact:true}).fill('Synthetic sandbox verification');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve mapping',exact:true}).click();await expect(page.getByText('TX-1: $40.00',{exact:true})).toBeVisible();
 await page.getByLabel('Review findings').fill('Awaiting sandbox evidence');await page.getByRole('button',{name:'Record review'}).click();await expect(page.getByRole('button',{name:'Record review'})).toHaveCount(0);
 expect(writes).toHaveLength(3);expect(writes.every(x=>x.includes('/passport-intake/'))).toBe(true);
});
test('finance without administrator permission cannot prepare accounts',async({page})=>{
 await session(page);await page.route('**/api/syncos/payment-retainage-adjustments/passport-preview',async r=>r.fulfill({json:await buildPreview()}));await page.goto('/passport');await expect(page.getByRole('heading',{name:'Saved integration preparation'})).toBeVisible();await expect(page.getByRole('button',{name:'Save account references'})).toHaveCount(0);
});
