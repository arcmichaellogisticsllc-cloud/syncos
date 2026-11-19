import {test,expect} from '@playwright/test';
test('training provides searchable role guides, clear limitations and downloads',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'s',tenant_id:'s',roles:['foreman'],permissions:['partner_context.read']}}));
 await page.goto('/training');await expect(page.getByRole('heading',{name:'Training',exact:true})).toBeVisible();
 for(const guide of ['operations','field','finance']){await page.getByLabel('Training guide').selectOption(guide);await expect(page.getByRole('status').filter({hasText:/sections found/})).not.toHaveText('0 sections found');}
 await page.getByLabel('Find a workflow').fill('Passport');await expect(page.getByRole('status').filter({hasText:/sections found/})).not.toHaveText('0 sections found');
 await page.getByLabel('Find a workflow').fill('not-a-real-workflow-zz');await expect(page.getByRole('heading',{name:'No matching workflow'})).toBeVisible();await page.getByRole('button',{name:'Clear search'}).click();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download this guide'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('finance-and-controls.md');
 for(const viewport of [{width:375,height:812},{width:844,height:390},{width:768,height:1024},{width:1440,height:900}]){await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('Training guide').selectOption('field');await page.getByLabel('Find a workflow').fill('JSA');await expect(page.getByRole('status').filter({hasText:/sections found/})).not.toHaveText('0 sections found');await page.getByLabel('Find a workflow').focus();await expect(page.getByLabel('Find a workflow')).toBeFocused();await page.screenshot({path:'/private/tmp/syncos-training-mobile.png',fullPage:false});
});
