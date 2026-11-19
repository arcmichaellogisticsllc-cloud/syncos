import { test, expect } from '@playwright/test';
import { personas } from './fixtures/personas';

test.use({ storageState: personas.systemAdmin.storageState });

test('saved profiles do not hide newly identified accounts', async ({ page }) => {
  await page.route('**/api/syncos/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/api/syncos/')[1];
    const rows: Record<string, unknown[]> = {
      'account-onboarding': [{ id: 'profile-one', organization_id: 'one', organization_name: 'Reviewed Customer', lane: 'prime', onboarding_stage: 'approved' }],
      organizations: [
        { id: 'one', name: 'Reviewed Customer', type: 'customer', status: 'discovered' },
        { id: 'two', name: 'New Pilot Customer', type: 'customer', status: 'discovered' },
        { id: 'three', name: 'Archived Customer', type: 'customer', status: 'archived' },
      ],
      territories: [], contacts: [], 'opportunity-candidates': [], opportunities: [], 'capacity-providers': [], contracts: [], 'rate-schedules': [],
    };
    if (!(path in rows)) return route.continue();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows[path]) });
  });
  await page.goto('/intelligence/account-onboarding');
  await expect(page.getByRole('link', { name: 'New Pilot Customer', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reviewed Customer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Archived Customer', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Reviewed Customer', exact: true })).toBeVisible();
});
