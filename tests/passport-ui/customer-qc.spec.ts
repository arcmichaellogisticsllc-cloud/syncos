import {test,expect} from '@playwright/test';
async function setup(page:any,permissions:string[]){
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic'));
 await page.route('**/api/syncos/auth/me',(r:any)=>r.fulfill({json:{user_id:'u',tenant_id:'t',roles:['qc_manager'],permissions}}));
 await page.route('**/api/syncos/syncfield/customer-qc/completeness-queue',(r:any)=>r.fulfill({json:[{id:'report',project_name:'Pilot project',crew_name:'Sync crew',work_date:'2026-09-25'}]}));
 await page.route('**/api/syncos/prime-correction-policies/reports/*',(r:any)=>r.fulfill({json:{policies:[],corrections:[],owners:[]}}));
 await page.route('**/api/syncos/syncfield/customer-qc/incidents',(r:any)=>r.fulfill({json:[{id:'incident',incident_type:'near_miss',crew_name:'Partner crew',location:'Pole 1',description:'Unsubmitted report incident',immediate_action:'Stopped work'}]}));
 await page.route('**/api/syncos/syncfield/customer-qc/reports/report',(r:any)=>r.fulfill({json:{id:'report',completeness_status:'complete',records:[{id:'record',code:'FIBER',reported_quantity:100,unit_of_measure:'LF'}],cycles:[{id:'cycle',cycle_number:1,status:'awaiting_customer',source_reference:'Customer email',decisions:[]}],revisions:[],evidence:[],incidents:[]}}));
}
test('customer decision failure preserves form and retry identity; phone layout fits',async({page})=>{
 await setup(page,['daily_production.completeness_read','customer_qc.decision_record']);let fail=true;const bodies:any[]=[];
 await page.route('**/api/syncos/syncfield/customer-qc/cycles/cycle/decisions',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({status:fail?503:200,json:fail?{message:'Service temporarily unavailable'}:{id:'decision'}});});
 await page.setViewportSize({width:390,height:844});await page.goto('/customer-qc');await expect(page.getByText('Unsubmitted report incident')).toBeVisible();await page.getByLabel('Submitted daily report').selectOption('report');await page.getByLabel('Production record',{exact:true}).selectOption('record');await page.getByLabel('Customer decision',{exact:true}).selectOption('correction_required');await page.getByLabel('Customer reason',{exact:true}).fill('Incorrect marker');await page.getByLabel('Customer comments / crew-safe correction instructions').fill('Replace marker and provide photo');await page.getByRole('button',{name:'Record customer decision',exact:true}).click();await expect(page.locator('p[role=alert]')).toContainText('Service temporarily unavailable');await expect(page.getByLabel('Customer reason',{exact:true})).toHaveValue('Incorrect marker');fail=false;await page.getByRole('button',{name:'Record customer decision',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Customer decision recorded.');expect(bodies[0].client_mutation_id).toBe(bodies[1].client_mutation_id);expect(bodies[1].decision).toBe('correction_required');expect(bodies[1]).not.toHaveProperty('customer_accepted_quantity');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'/private/tmp/syncos-customer-qc-phone.png',fullPage:true});
});
test('completeness reader sees incidents but no unapproved decisions or completeness actions',async({page})=>{
 await setup(page,['daily_production.completeness_read']);await page.goto('/customer-qc');await page.getByLabel('Submitted daily report').selectOption('report');await expect(page.getByText('Unsubmitted report incident')).toBeVisible();await expect(page.getByRole('button',{name:'Confirm completeness'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Record customer decision'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Open customer inspection cycle'})).toHaveCount(0);
});
test('QC report navigation reaches older reports, preserves the applied search and stops at the last page',async({page})=>{
 await setup(page,['daily_production.completeness_read']);
 const queries:URLSearchParams[]=[];
 await page.route('**/api/syncos/syncfield/customer-qc/completeness-queue*',route=>{
   const query=new URL(route.request().url()).searchParams;queries.push(query);
   const offset=Number(query.get('before')??0),filter=query.get('history_q')??'';
   const count=filter==='special'?1:Math.min(100,205-offset);
   return route.fulfill({json:Array.from({length:count},(_,i)=>({id:`report-${offset+i}`,project_name:filter==='special'?'Special project':'Pilot project',crew_name:'Sync crew',work_date:'2026-10-05',work_order_number:`WO-${offset+i}`, _history_cursor:String(offset+i+1)}))});
 });
 await page.goto('/customer-qc');const choices=page.getByLabel('Submitted daily report');await expect(choices.locator('option')).toHaveCount(101);
 await page.getByLabel('Search daily reports').fill('typed but not applied');await page.getByRole('button',{name:'More daily reports',exact:true}).click();await expect(choices.locator('option')).toHaveCount(201);expect(queries.at(-1)?.get('history_q')).toBe('');expect(queries.at(-1)?.get('before')).toBe('100');
 await page.getByRole('button',{name:'More daily reports',exact:true}).click();await expect(choices.locator('option')).toHaveCount(206);await expect(page.getByRole('button',{name:'More daily reports',exact:true})).toBeDisabled();
 await page.route('**/api/syncos/syncfield/customer-qc/reports/report-204',route=>route.fulfill({json:{id:'report-204',records:[],cycles:[],revisions:[],evidence:[],incidents:[]}}));
 await choices.selectOption('report-204');await expect(choices).toHaveValue('report-204');await expect(choices.locator('option')).toHaveCount(206);
 await page.getByLabel('Search daily reports').fill('special');await page.getByRole('button',{name:'Find daily reports',exact:true}).click();await expect(choices.locator('option')).toHaveCount(2);await expect(choices.locator('option').last()).toContainText('Special project');expect(queries.at(-1)?.has('before')).toBe(false);
});
