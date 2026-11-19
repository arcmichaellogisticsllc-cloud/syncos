import {test,expect} from '@playwright/test';
test('capacity matching validates input, reports errors and completes recalculation',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'s',tenant_id:'s',roles:['operations_manager'],permissions:['opportunity_coverage.read','opportunity_capacity_match.recalculate']}}));
 await page.route('**/api/syncos/opportunity-capacity-matching/coverage',r=>r.fulfill({json:[]}));
 let fail=true, writes=0;
 await page.route('**/api/syncos/opportunity-capacity-matching/opportunities/example',r=>fail?r.fulfill({status:503,json:{message:'Temporary outage'}}):r.fulfill({json:{requirement:{},capacity_summary:{},partner_matches:[],crew_matches:[],coverage_options:[],shortlist:[]}}));
 await page.route('**/api/syncos/opportunity-capacity-matching/opportunities/example/recalculate',r=>{writes++;return r.fulfill({json:{}});});
 await page.goto('/opportunities/capacity-matching');await page.getByRole('button',{name:'Open',exact:true}).click();await expect(page.locator('.error-banner[role=alert]')).toContainText('Enter an Opportunity ID');
 await page.getByLabel('Opportunity ID').fill('example');await page.getByRole('button',{name:'Open',exact:true}).click();await expect(page.locator('.error-banner[role=alert]')).toContainText('Temporary outage');
 fail=false;await page.getByRole('button',{name:'Recalculate',exact:true}).click();await expect(page.getByRole('button',{name:'Recalculate',exact:true})).toBeEnabled();await expect(page.locator('.error-banner[role=alert]')).toHaveCount(0);expect(writes).toBe(1);
});
