import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });

test('login submits with Enter and announces a failed attempt', async ({ page }) => {
  let attempts = 0;
  await page.route('**/auth/login', async (route) => {
    attempts++;
    expect(route.request().postDataJSON().email).toBe('pilot@example.test');
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Email or password is incorrect.' }) });
  });
  await page.goto('/login');
  await expect(page.getByLabel('Email', { exact: true })).toBeInViewport();
  await page.getByLabel('Email', { exact: true }).fill('pilot@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-only-invalid-password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('status')).toContainText('Sign in with a valid SyncOS account to continue.');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
  expect(attempts).toBe(1);
});

test('login validates required fields before sending credentials', async ({ page }) => {
  let attempts = 0;
  await page.route('**/auth/login', async (route) => { attempts++; await route.abort(); });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  expect(attempts).toBe(0);
});
