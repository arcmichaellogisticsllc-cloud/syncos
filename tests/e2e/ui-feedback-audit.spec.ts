import { test, expect } from '@playwright/test';
import { personas } from './fixtures/personas';

test.describe('Honest queue feedback', () => {
  test.use({ storageState: personas.systemAdmin.storageState });
  test('QC failure never presents unavailable counts as an empty queue', async ({ page }) => {
    await page.route('**/api/syncos/qc-reviews?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Review service unavailable. Try again.' }) }));
    await page.goto('/qc');
    await expect(page.getByRole('alert').filter({ hasText: 'Review service unavailable' })).toBeVisible();
    await expect(page.getByText('No QC reviews have been created yet.', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Pending Review 0/ })).toHaveCount(0);
  });
  test('invoice summary agrees with a nonempty queue', async ({ page }) => {
    await page.route('**/api/syncos/invoices?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'audit-invoice', invoice_number: 'PILOT-UI-001', status: 'draft', approval_status: 'not_submitted', total_amount: 100, balance_amount: 100 }]) }));
    await page.goto('/invoices');
    await expect(page.getByRole('link', { name: 'PILOT-UI-001', exact: true })).toBeVisible();
    await expect(page.getByText('1 invoice in this view.', { exact: true })).toBeVisible();
    await expect(page.getByText('No draft invoices need attention.', { exact: true })).toHaveCount(0);
  });
  test('production shows the actual mobilization blocker instead of a project-status error', async ({page}) => {
    const blocker='One active, assigned work-order version is required; review mobilization before recording production';
    await page.route('**/api/syncos/production-records', route => route.request().method()==='POST' ? route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:blocker})}) : route.continue());
    await page.goto('/production/new');
    const orders=page.getByRole('combobox',{name:'Work Order',exact:true});
    await expect(orders.locator('option').nth(1)).toBeAttached();
    await orders.selectOption({index:1});
    await page.getByRole('combobox',{name:'Production Type',exact:true}).selectOption('daily_production');
    await page.getByLabel('Production Date',{exact:true}).fill('2026-09-23');
    await page.getByLabel('Claimed Quantity',{exact:true}).fill('12');
    await page.getByLabel('Location Summary',{exact:true}).fill('Synthetic mobilization message check');
    await page.getByRole('button',{name:'Create Production',exact:true}).click();
    await expect(page.locator('.error-banner')).toHaveText(blocker);
    await expect(page.getByText('Project must be ready for work or active.',{exact:true})).toHaveCount(0);
  });
  test('QC creation uses supported choices and no raw override JSON', async ({ page }) => {
    await page.goto('/qc/new');
    await expect(page.getByRole('heading', { name: 'Create QC Review', exact: true })).toBeVisible();
    await expect(page.getByLabel('Override Reasons JSON')).toHaveCount(0);
    await expect(page.getByLabel('Reviewer User ID')).toHaveCount(0);
    await expect(page.getByLabel('Evidence Status').locator('option[value="missing"]')).toHaveCount(0);
    await expect(page.getByLabel('Evidence Status').locator('option[value="insufficient"]')).toHaveCount(1);
  });
});

test.describe('Correction owner choices', () => {
  test('authorized choices expose names rather than private user profiles', async ({ request }) => {
    const { authHeaders } = await import('./helpers/auth');
    const response = await request.get(`${process.env.API_BASE_URL}/qc-review-correction-owners`, { headers: authHeaders(personas.systemAdmin.storageState) });
    expect(response.status()).toBe(200);
    const rows = await response.json();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['display_name', 'id']);
  });
  test('read-only user cannot load correction assignment choices', async ({ request }) => {
    const { authHeaders } = await import('./helpers/auth');
    const response = await request.get(`${process.env.API_BASE_URL}/qc-review-correction-owners`, { headers: authHeaders(personas.readOnlyAuditor.storageState) });
    expect(response.status()).toBe(403);
  });
});
