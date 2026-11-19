import {test,expect,type Page} from '@playwright/test';
import {Pool} from 'pg';
import {acknowledgeFixtureJsa} from './e2e/helpers/individual-safety';
import {createHmac} from 'node:crypto';
const {staffingFixture}=require('./helpers/staffing-fixture');
const token=(r:any)=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub:r.auth.userId,tenant_id:r.auth.tenantId,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.${createHmac('sha256',process.env.AUTH_JWT_SECRET!).update(`${h}.${p}`).digest('base64url')}`;};
async function session(page:Page,r:any){await page.addInitScript(value=>{localStorage.setItem('syncos.apiToken',value);localStorage.setItem('syncos.permissions','[]');},token(r));await page.goto('/work-safety');}
const future=()=>new Date(Date.now()+2*3600000).toISOString().slice(0,16);
test('real internal foreman and supervisor complete staffing, shortfall, release and lost-response recovery on phone layout',async({browser,request})=>{
 const db=new Pool({connectionString:process.env.DATABASE_URL});
 const f=await staffingFixture(db,'internal');
 const fc=await browser.newContext({viewport:{width:390,height:844}}),sc=await browser.newContext();
 const fp=await fc.newPage(),sp=await sc.newPage();
 try{
  expect((await request.get(process.env.API_BASE_URL+'/staffing/scopes')).status()).toBe(401);
  await session(fp,f.foreman);const field=fp.getByRole('region',{name:'Role-based staffing'});
  await field.getByLabel('Assigned work order and crew').selectOption(f.v+':'+f.crew);
  await field.getByText('Propose a staffing plan or revision',{exact:true}).click();
  await field.getByLabel('Work phase',{exact:true}).fill('Synthetic phase');await field.getByLabel('Applicable work and traffic-plan references').fill('SYNTHETIC source plan');await field.getByLabel('Affected work, protective coverage and safe-pause instructions').fill('SYNTHETIC maintain protective traffic coverage while production pauses');
  await field.getByLabel('Role code 1',{exact:true}).fill('production');await field.getByLabel('Minimum simultaneous workers').fill('3');await field.getByLabel('Required qualifications').fill('SYNTHETIC production qualification');
  await field.getByRole('button',{name:'Add required role'}).click();await field.getByLabel('Role code 2',{exact:true}).fill('traffic');await field.getByLabel('Minimum simultaneous workers').nth(1).fill('2');await field.getByLabel('Required qualifications').nth(1).fill('SYNTHETIC traffic qualification');await field.getByRole('button',{name:'Submit proposal for supervisor review'}).click();
  await expect(field.getByRole('status')).toContainText('Recorded');
  await session(sp,f.supervisor);const sup=sp.getByRole('region',{name:'Role-based staffing'});await sup.getByLabel('Assigned work order and crew').selectOption(f.v+':'+f.crew);
  await sup.getByLabel('Qualified review and governing-plan evidence').fill('SYNTHETIC reviewed requirements');await sup.getByRole('button',{name:'Approve this exact staffing plan'}).click();await expect(sup.getByRole('heading',{name:'Worker eligibility for revision 1'})).toBeVisible();
  for(let i=0;i<5;i++){
   await sup.getByLabel('Worker',{exact:true}).selectOption(f.workers[i]);await sup.getByLabel('Approved role').selectOption(i<3?'production':'traffic');await sup.getByLabel('Qualification validity ends').fill(new Date(Date.now()+8*3600000).toISOString().slice(0,16));await sup.getByLabel('Verified qualification and eligibility evidence').fill('SYNTHETIC qualification reviewed');await sup.getByRole('button',{name:'Record eligibility review'}).click();await expect(sup.getByLabel('Worker',{exact:true})).toHaveValue('');
  }
  await field.getByRole('button',{name:'Refresh staffing status'}).click();
  async function fillCoverage(count:number,reason:string){await field.getByLabel('Completed shift safety review').selectOption(f.jsa.id);await field.getByLabel('This shift ends').fill(future());for(let i=0;i<6;i++)await field.getByLabel('Synthetic Worker '+i,{exact:true}).selectOption(i<count?(i<3?'production':'traffic'):'');await field.getByLabel('Reason for check or relief handoff').fill(reason);}
  await fillCoverage(4,'SYNTHETIC one traffic position missing');await field.getByRole('button',{name:'Record actual coverage'}).click();await expect(field.getByRole('heading',{name:'Staffing pause · open',exact:true})).toBeVisible();
  await sup.getByRole('button',{name:'Refresh staffing status'}).click();await expect(sup.getByRole('button',{name:'Authorize resumption after this staffing pause'})).toBeDisabled();
  await sup.getByLabel('Crew contact and review plan').fill('SYNTHETIC phone contact and plan reviewed');await sup.getByRole('button',{name:'Acknowledge and record contact'}).click();
  await fillCoverage(5,'SYNTHETIC coverage restored');await field.getByRole('button',{name:'Record actual coverage'}).click();await expect(field.getByRole('heading',{name:'Staffing pause · awaiting release',exact:true})).toBeVisible();
  const detail=await (await request.get(process.env.API_BASE_URL+`/staffing/${f.v}/${f.crew}`,{headers:{authorization:'Bearer '+token(f.foreman)}})).json();
  expect((await request.post(process.env.API_BASE_URL+`/staffing/cases/${detail.cases[0].id}/release`,{headers:{authorization:'Bearer '+token(f.foreman)},data:{check_id:detail.check.id,release_reference:'Unauthorized'}})).status()).toBe(403);
  await sup.getByRole('button',{name:'Refresh staffing status'}).click();await sup.getByLabel('Current plan, coverage and crew contact review').fill('SYNTHETIC supervisor authorizes resumption');await sup.getByRole('button',{name:'Authorize resumption after this staffing pause'}).click();await expect(sup.getByRole('heading',{name:'Staffing pause · released',exact:true})).toBeVisible();
  await field.getByRole('button',{name:'Refresh staffing status'}).click();await fillCoverage(5,'SYNTHETIC lost response retry');
  let first=true;await fp.route('**/staffing/*/*/checks',async route=>{if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  const before=Number((await db.query('SELECT count(*) n FROM staffing_checks WHERE tenant_id=$1',[f.t])).rows[0].n);
  await field.getByRole('button',{name:'Record actual coverage'}).click();await expect(field.getByRole('alert')).toContainText('preserved for retry');await expect(field.getByLabel('Reason for check or relief handoff')).toHaveValue('SYNTHETIC lost response retry');
  await field.getByRole('button',{name:'Record actual coverage'}).click();await expect(field.getByRole('alert')).toHaveCount(0);
  expect(Number((await db.query('SELECT count(*) n FROM staffing_checks WHERE tenant_id=$1',[f.t])).rows[0].n)).toBe(before+1);
  expect(await fp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }finally{await fc.close().catch(()=>{});await sc.close().catch(()=>{});await db.end();}
});

test('existing individual safety fixture establishes a reviewed staffing baseline through real endpoints',async({request})=>{
 const db=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  const f=await staffingFixture(db,'partner');
  await db.query('UPDATE daily_jsa_participants SET acknowledged=false,acknowledged_by=NULL,acknowledged_at=NULL WHERE tenant_id=$1 AND daily_jsa_id=$2',[f.t,f.jsa.id]);
  await acknowledgeFixtureJsa(request,f.t,f.jsa.id);
  const response=await request.get(process.env.API_BASE_URL+`/staffing/${f.v}/${f.crew}`,{headers:{authorization:'Bearer '+token(f.foreman)}});
  expect(response.ok(),await response.text()).toBe(true);
  const state=await response.json();expect(state.live_findings).toEqual([]);expect(state.check.coverage).toHaveLength(6);expect(state.plans[0].approved_at).toBeTruthy();
 }finally{await db.end();}
});

test('formal hold UI and both endpoints require supervisor while foreman unsafe pause remains available',async({browser,request})=>{
 const db=new Pool({connectionString:process.env.DATABASE_URL});
 const contexts:any[]=[];
 try {
  const f=await staffingFixture(db,'partner');
  for(const actor of [f.foreman,f.admin,await f.actor('safety_manager'),await f.actor('qc_manager'),await f.actor('executive')]){
   const context=await browser.newContext();contexts.push(context);const page=await context.newPage();await session(page,actor);
   await expect(page.getByRole('heading',{name:'My safety reviews',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Refresh latest safety records'})).toBeVisible();
   await expect(page.getByRole('button',{name:'Place work on hold',exact:true})).toHaveCount(0);
   for(const [path,data] of [['work-safety/stops',{work_order_id:f.wo,reason:'Unauthorized'}],[`production-records/${f.wo}/stop-work`,{reason:'Unauthorized',utility_strike:false}]] as const){
    const response=await request.post(process.env.API_BASE_URL+'/'+path,{headers:{authorization:'Bearer '+token(actor)},data});expect(response.status(),await response.text()).toBe(403);
   }
  }
  const context=await browser.newContext();contexts.push(context);const page=await context.newPage();await session(page,f.supervisor);
  await expect(page.getByRole('button',{name:'Place work on hold',exact:true})).toBeVisible();
  const record=(await db.query("INSERT INTO production_records(tenant_id,project_id,work_order_id,capacity_provider_id,crew_id,production_date,quantity_submitted,quantity,unit_type,unit) VALUES($1,$2,$3,$4,$5,CURRENT_DATE,1,1,'feet','feet') RETURNING id",[f.t,f.project,f.wo,f.cp,f.crew])).rows[0].id;
  const legacy=await request.post(process.env.API_BASE_URL+`/production-records/${record}/stop-work`,{headers:{authorization:'Bearer '+token(f.supervisor)},data:{reason:'SYNTHETIC production hold',utility_strike:false}});
  expect(legacy.status(),await legacy.text()).toBe(201);
  const hold=await request.post(process.env.API_BASE_URL+'/work-safety/stops',{headers:{authorization:'Bearer '+token(f.supervisor)},data:{work_order_id:f.wo,crew_id:f.crew,reason:'SYNTHETIC supervisor hold',utility_strike:false}});
  expect(hold.status(),await hold.text()).toBe(201);
  await page.getByRole('button',{name:'Refresh latest safety records'}).click();await expect(page.getByText('— SYNTHETIC supervisor hold',{exact:false})).toBeVisible();
  const concern=await request.post(process.env.API_BASE_URL+`/staffing/${f.v}/${f.crew}/concerns`,{headers:{authorization:'Bearer '+token(f.foreman)},data:{reason:'SYNTHETIC unsafe condition; protective coverage preserved'}});
  expect(concern.status(),await concern.text()).toBe(201);
  expect((await db.query('SELECT count(*)::int n FROM staffing_cases WHERE tenant_id=$1 AND status<>\'released\'',[f.t])).rows[0].n).toBe(1);
 } finally {for(const c of contexts)await c.close();await db.end();}
});
