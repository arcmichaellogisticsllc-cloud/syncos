import {test,expect} from '@playwright/test';
test('handoff follows named coverage source, explicit review, approval and planning project gates',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('syncos.apiToken','synthetic'));
 let status='draft',projectId:string|null=null;const writes:Array<{path:string,body:any}>=[];
 const detail=()=>({project_handoff:{id:'handoff',status,project_id:projectId,handoff_readiness_band:'ready'},checklist_items:[],risks:[],warnings:[],blockers:[],required_override_fields:[]});
 await page.route('**/api/syncos/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/auth/me'))return route.fulfill({json:{user_id:'s',tenant_id:'s',roles:['operations_manager'],permissions:['project_handoff.read','project_handoff.create','project_handoff.submit_review','project_handoff.approve','project_handoff.create_project','project.create','project.read']}});
  if(path.endsWith('/options'))return route.fulfill({json:{sources:[{id:'coverage',opportunity_id:'opportunity',opportunity_name:'Fiber expansion',customer_name:'Customer',territory_name:'North'}],staff:[{id:'owner',display_name:'Morgan Ops'}]}});
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();writes.push({path,body});
   if(path.endsWith('/submit-readiness-review'))status='readiness_review';if(path.endsWith('/approve'))status='approved';if(path.endsWith('/create-project')){status='project_created';projectId='project';}
   return route.fulfill({json:detail()});
  }
  return route.fulfill({json:path.endsWith('/detail')?detail():[{id:'handoff',opportunity_name:'Fiber expansion',status}]});
 });
 await page.goto('/project-handoffs');await page.locator('summary').filter({hasText:'Create project handoff'}).click();
 await page.getByLabel('Approved coverage plan').selectOption('coverage');await page.getByLabel('Operations owner').selectOption('owner');await page.getByLabel('Project manager').selectOption('owner');await page.getByLabel('Scope summary').fill('Install fiber');await page.getByLabel('Location summary').fill('North service area');await page.getByLabel('Expected start date').fill('2026-10-01');
 await page.getByRole('button',{name:'Create project handoff',exact:true}).click();await expect(page.getByRole('heading',{name:'Readiness: ready'})).toBeVisible();expect(writes[0].body.opportunity_id).toBe('opportunity');expect(writes[0].body.coverage_plan_id).toBe('coverage');
 await expect(page.locator('summary').filter({hasText:'Create planning project'})).toHaveCount(0);
 await page.locator('summary').filter({hasText:'Submit readiness review'}).click();await page.getByLabel('Review note').fill('Reviewed requirements');await page.getByRole('button',{name:'Submit readiness review',exact:true}).click();
 await page.locator('summary').filter({hasText:'Approve handoff'}).click();await page.getByLabel('Approval note').fill('Authorized planning');await page.getByRole('button',{name:'Approve handoff',exact:true}).click();
 await page.locator('summary').filter({hasText:'Create planning project'}).click();await page.getByLabel('Project creation note').fill('Create planning only');await page.getByLabel('Create this planning project; field work still needs separate authorization').check();await page.getByRole('button',{name:'Create planning project',exact:true}).click();await expect(page.getByRole('link',{name:'Open created planning project'})).toHaveAttribute('href','/projects/project');
 expect(writes.map(row=>row.path.split('/').pop())).toEqual(['project-handoffs','submit-readiness-review','approve','create-project']);
});
