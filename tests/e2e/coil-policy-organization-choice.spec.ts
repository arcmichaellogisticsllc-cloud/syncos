import { test, expect, type Page } from '@playwright/test';
import { personas } from './fixtures/personas';

test.use({ storageState: personas.systemAdmin.storageState });
async function setup(page: Page, organizationRead: boolean) {
  await page.route('**/api/syncos/auth/me', route => route.fulfill({ json: { user_id: 'pilot-finance', tenant_id: 'pilot-tenant', roles: ['finance_user'], role_names: ['Finance User'], permissions: ['billing.read', 'billing.create_billable', 'work_order.read', ...(organizationRead ? ['organization.read'] : [])] } }));
  await page.route('**/api/syncos/work-orders?*', route => route.fulfill({ json: [{ id: 'test-work-order', work_order_number: 'PILOT-WO-1', work_order_name: 'Pilot work' }] }));
  await page.route('**/api/syncos/accepted-production-financials/**', route => route.fulfill({ json: route.request().url().endsWith('/dashboard') ? {} : [] }));
}
test('policy counterparty uses organization names and preserves the nullable default', async ({ page }) => {
  await setup(page, true);
  await page.route('**/api/syncos/organizations?*', route => route.fulfill({ json: [{ id: 'org-1', name: 'Pilot Customer', status: 'active' }] }));
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/syncos/accepted-production-financials/coil-policies', route => {
    if (route.request().method() === 'POST') writes.push(route.request().postDataJSON());
    return route.fulfill({ json: [] });
  });
  await page.goto('/accepted-production-financials');
  await expect(page.getByLabel('Counterparty Organization ID')).toHaveCount(0);
  const selector = page.getByRole('combobox', { name: 'Counterparty organization', exact: true });
  await expect(selector).toBeEnabled();
  await expect(selector.getByRole('option', { name: 'Pilot Customer', exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Work Order ID', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Work order', exact: true }).selectOption('test-work-order');
  await selector.selectOption('org-1');
  await page.getByRole('button', { name: 'Save Coil Policy' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].counterparty_organization_id).toBe('org-1');
  await selector.selectOption('');
  await page.getByRole('button', { name: 'Save Coil Policy' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).not.toHaveProperty('counterparty_organization_id');
});
test('policy writers without organization read never load or display organization choices', async ({ page }) => {
  await setup(page, false);
  let reads = 0;
  page.on('request', request => { if (request.url().includes('/api/syncos/organizations')) reads++; });
  await page.goto('/accepted-production-financials');
  await expect(page.getByText('This policy will use the work order’s customer or partner.', { exact: false })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Counterparty organization', exact: true })).toHaveCount(0);
  expect(reads).toBe(0);
});

test('separate production item uses named choices and a failed save preserves the policy draft', async ({ page }) => {
  await setup(page, false);
  await page.route('**/api/syncos/accepted-production-financials/production-code-choices', route => route.fulfill({ json: [{ id: 'code-1', code: 'COIL', name: 'Coil footage', unit: 'feet' }] }));
  await page.route('**/api/syncos/accepted-production-financials/coil-policies', route => route.request().method() === 'POST' ? route.fulfill({ status: 400, json: { message: 'Source evidence is required.' } }) : route.fulfill({ json: [] }));
  await page.goto('/accepted-production-financials');
  await page.getByRole('combobox', { name: 'Work order', exact: true }).selectOption('test-work-order');
  await page.getByLabel('Treatment').selectOption('separate_pay_item');
  await expect(page.getByLabel('Separate Production Code ID')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Separate production item', exact: true }).selectOption({ label: 'COIL · Coil footage (feet)' });
  await page.getByRole('button', { name: 'Save Coil Policy' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Source evidence is required.' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Work order', exact: true })).toHaveValue('test-work-order');
  await expect(page.getByRole('combobox', { name: 'Separate production item', exact: true })).toHaveValue('code-1');
  await expect(page.getByRole('heading', { name: 'Accepted Production Financials', exact: true })).toBeVisible();
});
