import {test,expect} from '@playwright/test';
test('authorized operator generates scoped exports and downloads privately; failures are recoverable',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'s',tenant_id:'s',roles:['system_admin'],permissions:['production_dashboard.read','production_export.generate','production_export.read','production_closeout.generate']}}));
 await page.route('**/api/syncos/syncfield/production-dashboard',r=>r.fulfill({json:{recent_reports:[{id:'report-a',work_order_number:'WO-A',work_date:'2026-09-25',crew_name:'Crew A'}],artifacts:[]}}));
 let fail=true,body:any;
 await page.route('**/api/syncos/syncfield/production-exports',r=>{body=r.request().postDataJSON();return r.fulfill({status:fail?503:200,json:fail?{message:'Export unavailable'}:{id:'export-a',artifact_type:'production_csv',status:'ready'}});});
 await page.route('**/api/syncos/syncfield/production-exports/export-a/bytes',r=>r.fulfill({json:{content_base64:Buffer.from('Work,Quantity\nWO-A,12').toString('base64'),mime_type:'text/csv',file_name:'production.csv'}}));
 await page.goto('/production-dashboard');await page.getByLabel('Submitted daily report').selectOption('report-a');await page.getByLabel('Export format').selectOption('production_csv');await page.getByRole('button',{name:'Generate export'}).click();await expect(page.locator('p[role=alert]')).toHaveText('Export unavailable');await expect(page.getByLabel('Submitted daily report')).toHaveValue('report-a');fail=false;await page.getByRole('button',{name:'Generate export'}).click();await expect(page.getByRole('button',{name:'Download',exact:true})).toBeVisible();expect(body).toEqual({daily_report_id:'report-a',artifact_type:'production_csv',generation_mode:'customer_qc_status'});const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();expect((await downloaded).suggestedFilename()).toBe('production.csv');
});
test('dashboard reader does not see unauthorized export actions',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic'));
 await page.route('**/api/syncos/auth/me',r=>r.fulfill({json:{user_id:'s',tenant_id:'s',roles:['readonly_auditor'],permissions:['production_dashboard.read']}}));
 await page.route('**/api/syncos/syncfield/production-dashboard',r=>r.fulfill({json:{}}));await page.goto('/production-dashboard');await expect(page.getByRole('heading',{name:'Accepted Production Operations'})).toBeVisible();await expect(page.getByRole('button',{name:'Generate export'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Download',exact:true})).toHaveCount(0);
});
