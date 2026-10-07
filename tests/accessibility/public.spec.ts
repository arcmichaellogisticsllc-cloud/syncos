import {test,expect} from '@playwright/test';
import {assertAccessible} from '../e2e/helpers/accessibility';
const routes=['/login','/forgot-password','/reset-password#token=synthetic-accessibility-token','/sign-in-link','/sso/callback','/request-service/synthetic-accessibility'];
for(const width of [1280,390])for(const route of routes)test(`public ${width} ${route}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/api/syncos/auth/magic-link/availability',r=>r.fulfill({json:{enabled:true}}));
 await page.route('**/api/syncos/auth/sso/availability',r=>r.fulfill({json:{enabled:true}}));
 await page.route('**/api/syncos/public/customer-intake/synthetic-accessibility',r=>r.fulfill({json:{label:'Request service',privacy_notice:'Synthetic test channel. No request will be sent.'}}));
 await page.goto(route);await expect(page.locator('h1')).toBeVisible();
 if(route.startsWith('/reset-password'))await expect(page.getByLabel('New password',{exact:true})).toBeVisible();
 if(route.startsWith('/request-service'))await expect(page.getByLabel('Your name',{exact:true})).toBeVisible();
 if(route==='/sign-in-link')await expect(page.getByLabel('Email',{exact:true})).toBeVisible();
 await assertAccessible(page,`public-${width}-accessibility`);
});
