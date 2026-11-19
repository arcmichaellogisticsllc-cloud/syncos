import { test, expect, type Page } from '@playwright/test';
async function portal(page: Page, permissions: string[]) {
 await page.addInitScript(() => localStorage.setItem('syncos.apiToken', 'synthetic'));
 await page.route('**/api/syncos/**', route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/auth/me')) return route.fulfill({json:{user_id:'s',tenant_id:'s',roles:['partner_admin'],permissions}});
  if (path.endsWith('/partner-personas/me/context')) return route.fulfill({json:{persona:'partner_admin',user:{id:'s'},organization:{id:'org',name:'Pilot Partner',status:'onboarding'},capacityProvider:{id:'cp'}}});
  if (path.endsWith('/workers')) return route.fulfill({json:[{id:'worker-a',first_name:'Avery',last_name:'Crew',review_status:'draft'}]});
  if (path.endsWith('/company-profile')) return route.fulfill({json:{legal_business_name:'Pilot Partner LLC',primary_contact_name:'Alex'}});
  return route.fulfill({json: /setup-requests|insurance-policies|crews|agreements|vehicle-assignments/.test(path) ? [] : {}});
 });
}
test('company edits retain entries on failure and hide unauthorized actions', async ({page}) => {
 await portal(page,['partner_context.read','partner_compliance.profile.read','partner_compliance.profile.submit']);
 let attempts=0; const bodies:any[]=[];
 await page.route('**/api/syncos/partner-compliance/me/company-profile', route => {
  if (route.request().method()==='GET') return route.fulfill({json:{legal_business_name:'Pilot Partner LLC'}});
  bodies.push(route.request().postDataJSON()); attempts++;
  return attempts===1 ? route.fulfill({status:503,json:{message:'Temporary service outage'}}) : route.fulfill({json:{status:'submitted'}});
 });
 await page.goto('/partner/company'); await page.locator('summary').filter({hasText:'Save company profile'}).click();
 await page.getByLabel('Legal business name').fill('Correct Partner LLC');
 await page.getByRole('button',{name:'Save company profile',exact:true}).click();
 await expect(page.getByRole('form',{name:'Save company profile'}).getByRole('alert')).toContainText('Temporary service outage');
 await expect(page.getByLabel('Legal business name')).toHaveValue('Correct Partner LLC');
 await page.getByRole('button',{name:'Save company profile',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Saved'); expect(bodies[0].client_mutation_id).toBe(bodies[1].client_mutation_id);
 expect(bodies[1].organization_id).toBeUndefined(); expect(bodies[1].legal_business_name).toBe('Correct Partner LLC');
 await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('read-only partner cannot see company submit or declaration controls',async({page})=>{
 await portal(page,['partner_context.read','partner_compliance.profile.read']); await page.goto('/partner/company');
 await expect(page.getByRole('heading',{name:'Company',level:2,exact:true})).toBeVisible();
 await expect(page.locator('summary').filter({hasText:'Save company profile'})).toHaveCount(0);
 await expect(page.locator('summary').filter({hasText:'Send capability declaration'})).toHaveCount(0);
});
test('worker creation uses scoped endpoint and never submits approval',async({page})=>{
 await portal(page,['partner_context.read','partner_workforce.worker.read','partner_workforce.worker.create']);
 let body:any;
 await page.route('**/api/syncos/partner-workforce/me/workers',r=>r.request().method()==='POST'?(body=r.request().postDataJSON(),r.fulfill({json:{id:'new-worker'}})):r.fulfill({json:[]}));
 await page.goto('/partner/workers'); await page.locator('summary').filter({hasText:'Add worker'}).click();
 await page.getByLabel('First name').fill('Jordan');await page.getByLabel('Last name').fill('Pilot');await page.getByRole('button',{name:'Add worker',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Saved');expect(body.first_name).toBe('Jordan');expect(body.organization_id).toBeUndefined();expect(body.review_status).toBeUndefined();
});
