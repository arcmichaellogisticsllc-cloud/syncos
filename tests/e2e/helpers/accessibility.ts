import {expect,test,type Page} from '@playwright/test';
/** Automated semantics/contrast checks supplement keyboard and physical-device acceptance. */
export async function assertAccessible(page:Page,label:string){
 await page.waitForLoadState('networkidle');
 await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
 const result=await page.evaluate(async()=> (window as any).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
 await test.info().attach(label,{body:JSON.stringify({url:page.url(),violations:result.violations,incomplete:result.incomplete},null,2),contentType:'application/json'});
 expect(result.violations.map((v:any)=>({id:v.id,impact:v.impact,targets:v.nodes.map((n:any)=>n.target)}))).toEqual([]);
}
