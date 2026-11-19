import {test,expect} from '@playwright/test';
import {personas} from './fixtures/personas';
import {installStoredSession} from './helpers/auth';
test('record history search is usable, scoped and recoverable',async({page})=>{
 await installStoredSession(page,personas.systemAdmin.storageState);await page.goto('/record-history');await page.getByRole('combobox',{name:'Record type',exact:true}).selectOption({label:'Projects'});await expect(page.getByRole('status')).toHaveCount(0);
 await page.getByLabel('Search name, reference, status or record ID').fill('no-such-synthetic-project-732159');await page.getByRole('button',{name:'Search history',exact:true}).click();await expect(page.getByText('No matching records on this page.')).toBeVisible();
 await page.getByLabel('Search name, reference, status or record ID').fill('');await page.getByRole('button',{name:'Search history',exact:true}).click();await expect(page.getByText('No matching records on this page.')).not.toBeVisible();await expect(page.getByRole('main').getByRole('link').first()).toBeVisible();
});
test('administration uses member search and hides unauthorized controls',async({page})=>{
 await installStoredSession(page,personas.systemAdmin.storageState);await page.goto('/access-administration');await page.getByLabel('Find member').fill('e2e.ops.manager');await page.getByRole('button',{name:'Search members',exact:true}).click();await page.getByRole('button',{name:/e2e.ops.manager@syncos.test/}).click();await expect(page.getByRole('heading',{name:'Current grants'})).toBeVisible();await expect(page.getByRole('button',{name:'Save role change'})).toBeVisible();
 await installStoredSession(page,personas.readOnlyAuditor.storageState);await page.goto('/access-administration');await expect(page.getByRole('button',{name:'Save role change'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Save membership status'})).toHaveCount(0);
});
test('unconfigured sign-in alternatives stay unavailable',async({page})=>{await page.goto('/login');await expect(page.getByRole('link',{name:'Email me a sign-in link'})).toHaveCount(0);await page.goto('/sign-in-link');await expect(page.getByText(/Email sign-in is not enabled/)).toBeVisible();await expect(page.getByRole('button',{name:'Send sign-in link'})).toHaveCount(0);await page.goto('/sso/callback');await expect(page.getByRole('alert').filter({hasText:/not completed/})).toBeVisible();});
test('global search returns readable records and recovers from an empty search',async({page})=>{
 await installStoredSession(page,personas.systemAdmin.storageState);await page.goto('/search');await page.getByRole('textbox',{name:'Search records',exact:true}).fill('E2E');await page.getByRole('button',{name:'Search records',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/results on page/})).toBeVisible();await expect(page.getByRole('main').getByRole('link').first()).toBeVisible();await page.getByRole('textbox',{name:'Search records',exact:true}).fill('no-record-synthetic-search-992163');await page.getByRole('button',{name:'Search records',exact:true}).click();await expect(page.getByText(/No matching records. Try another/)).toBeVisible();
});
