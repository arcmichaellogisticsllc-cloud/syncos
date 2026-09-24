import {test,expect,type Page} from '@playwright/test';
const {buildPreview}=require('../../packages/passport/src/preview');
async function session(page:Page,permissions=['partner_payment.confirm']){
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
