import {test,expect} from '@playwright/test';
import {routeMatrix} from '../e2e/fixtures/route-matrix';
import {personas} from '../e2e/fixtures/personas';
import {installStoredSession} from '../e2e/helpers/auth';
const routes=[...new Set([...routeMatrix.map(r=>r.route),'/forms','/material-inventory','/customer-inquiries','/passport','/record-history','/training'])];
for(const width of [1280,390])for(const route of routes){
 test(`${width===1280?'desktop':'mobile'} ${route}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await installStoredSession(page,personas.systemAdmin.storageState);
  const response=await page.goto(route);expect(response?.status()).toBeLessThan(400);
  await expect(page.locator('h1').first()).toBeVisible();await page.waitForLoadState('networkidle');
  await expect(page.getByText('Verifying access…',{exact:true})).toHaveCount(0);
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const results=await page.evaluate(async()=>{const axe=(window as any).axe;return axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});});
  await info.attach('accessibility-results',{body:JSON.stringify({route,width,violations:results.violations,incomplete:results.incomplete},null,2),contentType:'application/json'});
  expect(results.violations.map((v:any)=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map((n:any)=>({target:n.target,summary:n.failureSummary}))}))).toEqual([]);
 });
}
