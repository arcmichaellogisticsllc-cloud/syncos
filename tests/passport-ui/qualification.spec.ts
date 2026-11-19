import {test,expect} from '@playwright/test';
test('qualification resets company and checks, preserves failed notes, and sends only confirmed facts',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'s',tenant_id:'s',roles:['system_admin'],permissions:['partner_inquiry.read','partner_inquiry.manage','partner_inquiry.qualify']}}));
 await page.route('**/api/syncos/partner-invitations/qualification-organizations',r=>r.fulfill({json:[{id:'org-alpha',name:'Alpha'}]}));
 const inquiries=[{id:'a',company_name:'Alpha',contact_name:'A',email:'a@example.test',territory:'East',capability:'Fiber',status:'NEW',qualified_organization_id:'org-alpha',territory_verified:true},{id:'b',company_name:'Beta',contact_name:'B',email:'b@example.test',territory:'West',capability:'Fiber',status:'NEW'}];
 await page.route('**/api/syncos/partner-invitations/inquiries',r=>r.fulfill({json:{inquiries}}));
 let fail=true,body:any;
 await page.route('**/api/syncos/partner-invitations/inquiries/b/contact',r=>r.fulfill({status:fail?503:200,json:fail?{message:'Try again'}:{}}));
 await page.route('**/api/syncos/partner-invitations/inquiries/b/qualify',r=>{body=r.request().postDataJSON();return r.fulfill({json:{}});});
 await page.goto('/partner-network');await expect(page.getByLabel('Partner company for qualification/invite')).toHaveValue('org-alpha');
 await page.getByRole('button',{name:/Beta/}).click();await expect(page.getByLabel('Partner company for qualification/invite')).toHaveValue('');await expect(page.getByLabel('Territory verified',{exact:true})).not.toBeChecked();
 await page.getByLabel('Conversation note').fill('Keep my conversation');await page.getByRole('button',{name:'Record Contact'}).click();await expect(page.locator('section[role=alert]')).toContainText('Try again');await expect(page.getByLabel('Conversation note')).toHaveValue('Keep my conversation');
 fail=false;await page.getByRole('button',{name:'Record Contact'}).click();await expect(page.getByLabel('Conversation note')).toHaveValue('');
 await page.getByLabel('Territory verified',{exact:true}).check();await page.getByRole('button',{name:'Future Capacity',exact:true}).click();await expect(page.locator('section[role=status]')).toContainText('complete');expect(body).toMatchObject({territory_verified:true,capability_verified:false,crew_count_verified:false,availability_verified:false,equipment_verified:false});expect(body.organization_id).toBeUndefined();
});
