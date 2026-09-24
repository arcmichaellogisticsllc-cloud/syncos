import { test, expect, type Page } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { readE2EManifest } from "./helpers/manifest";

test.use({ storageState: personas.systemAdmin.storageState });
const identity = (permissions: string[], roleNames = ["Read Only Auditor"]) => ({ user_id: "pilot-reader", tenant_id: "pilot-tenant", roles: ["read_only_auditor"], role_names: roleNames, permissions });
async function auth(page: Page, permissions: string[], roles?: string[]) {
  await page.route("**/api/syncos/auth/me", route => route.fulfill({ json: identity(permissions, roles) }));
  await page.route("**/api/syncos/qc-reviews?*", route => route.fulfill({ json: [] }));
}

test("QC read-only access hides create links and keeps the QC workspace active", async ({ page }) => {
  await auth(page, ["qc_review.read", "signal.read"]);
  await page.goto("/qc");
  await expect(page.getByRole("heading", { name: "QC Review Queue", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create QC Review", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Workspace navigation", exact: true }).getByRole("link", { name: /QC/ })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".nav-placeholder")).toHaveCount(0);
  await page.goto("/qc/new");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
});

test("stored fake grants cannot grant access when the server returns no permissions", async ({ page }) => {
  await auth(page, []);
  await page.addInitScript(() => localStorage.setItem("syncos.permissions", "qc_review.read,qc_review.create,invoice.approve"));
  let queueReads = 0;
  page.on("request", request => { if (request.url().includes("/qc-reviews")) queueReads++; });
  await page.goto("/qc");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create QC Review" })).toHaveCount(0);
  expect(queueReads).toBe(0);
});

test("unverified identity fails closed with a recovery control", async ({ page }) => {
  await page.route("**/api/syncos/auth/me", route => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry access check" })).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
});

test("revoked create access is removed on focus without revoking the read queue", async ({ page }) => {
  let permissions = ["qc_review.read", "qc_review.create"];
  await page.route("**/api/syncos/auth/me", route => route.fulfill({ json: identity(permissions) }));
  await page.route("**/api/syncos/qc-reviews?*", route => route.fulfill({ json: [] }));
  await page.goto("/qc");
  await expect(page.getByRole("link", { name: "Create QC Review", exact: true }).first()).toBeVisible();
  permissions = ["qc_review.read"];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Create QC Review", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "QC Review Queue", exact: true })).toBeVisible();
});

test('Operations Manager can inspect QC but cannot create reviews through direct URLs', async ({ browser }) => {
  const context = await browser.newContext({ storageState: personas.opsManager.storageState });
  const page = await context.newPage();
  await page.goto('/qc');
  await expect(page.getByRole('heading', { name: 'QC Review Queue', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create QC Review', exact: true })).toHaveCount(0);
  for (const path of ['/qc/new']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Create QC Review', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Pending Review/ })).toHaveCount(0);
  }
  await context.close();
});

test('finance staff without approval authority cannot see invoice submission or approval', async ({ browser }) => {
  const context = await browser.newContext({ storageState: personas.financeUser.storageState });
  const page = await context.newPage();
  const invoice = readE2EManifest().actionStates.invoiceDraft;
  const loaded = page.waitForResponse(response => response.url().endsWith(`/invoices/${invoice}/detail`) && response.ok());
  await page.goto(`/invoices/${invoice}`);
  await loaded;
  await expect(page.getByRole('button', { name: 'Submit Review', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await context.close();
});
