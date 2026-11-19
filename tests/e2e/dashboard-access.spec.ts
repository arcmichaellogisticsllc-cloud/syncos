import { test, expect } from "@playwright/test";
import { personas } from "./fixtures/personas";

test.use({ storageState: personas.systemAdmin.storageState });
const context = (permissions: string[]) => ({ user_id: "dashboard-user", tenant_id: "dashboard-tenant", roles: ["read_only_auditor"], role_names: ["Read Only Auditor"], permissions });

test("a resource reader cannot open a dashboard or request its metrics", async ({ page }) => {
  await page.route("**/api/syncos/auth/me", route => route.fulfill({ json: context(["invoice.read"]) }));
  let metricReads = 0;
  page.on("request", request => { if (request.url().includes("/api/syncos/dashboard/")) metricReads++; });
  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  expect(metricReads).toBe(0);
  await expect(page.getByText("Settlement conversion", { exact: true })).toHaveCount(0);
});

test("dashboard requests use the signed-in identity and preserve successful metrics", async ({ page }) => {
  await page.route("**/api/syncos/auth/me", route => route.fulfill({ json: context(["dashboard.finance.read"]) }));
  let authorization = "";
  await page.route("**/api/syncos/dashboard/finance", route => {
    authorization = route.request().headers().authorization ?? "";
    return route.fulfill({ json: { settlementConversionRate: { currentValue: 487.75 }, cashConversionRate: { currentValue: 12 }, arAging: [], invoiceCounts: [], paymentCounts: [] } });
  });
  await page.goto("/finance");
  await expect(page.locator(".insight-strip").getByText("487.7500", { exact: true })).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("syncos.apiToken"));
  expect(authorization === `Bearer ${token}`).toBe(true);
});

for (const [route, kind] of [["/", "executive"], ["/executive", "executive"], ["/operations", "operations"], ["/finance", "finance"], ["/growth", "growth"], ["/constraints-center", "constraints"], ["/recommendations-center", "recommendations"], ["/kpis-center", "kpis"], ["/workflows-center", "workflows"]]) {
  test(`${route} reports failed data instead of a zero dashboard`, async ({ page }) => {
    await page.route("**/api/syncos/auth/me", handler => handler.fulfill({ json: context([`dashboard.${kind}.read`]) }));
    await page.route(`**/api/syncos/dashboard/${kind}`, handler => handler.fulfill({ status: 503, json: { message: "Dashboard temporarily unavailable" } }));
    await page.goto(route);
    await expect(page.getByRole("heading", { name: "Dashboard unavailable", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry dashboard" })).toBeVisible();
    await expect(page.locator(".insight-strip,.command-hero,.metric-list,.wide-table")).toHaveCount(0);
  });
}

test("unauthenticated requests never receive server-rendered dashboard metrics", async ({ browser, baseURL }) => {
  const isolated = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await isolated.newPage();
  let reads = 0;
  page.on("request", request => { if (request.url().includes("/api/syncos/dashboard/")) reads++; });
  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await expect(page.getByText("Settlement conversion", { exact: true })).toHaveCount(0);
  expect(reads).toBe(0);
  await isolated.close();
});

test("login falls back to the permitted queue when the suggested dashboard is not authorized", async ({ page }) => {
  const invoiceReader = { ...context(["invoice.read"]), routing: { workspace: "/finance" } };
  await page.route("**/api/syncos/auth/login", handler => handler.fulfill({ json: { token: "browser-test-only", context: invoiceReader } }));
  await page.route("**/api/syncos/auth/me", handler => handler.fulfill({ json: invoiceReader }));
  await page.route("**/api/syncos/invoices?*", handler => handler.fulfill({ json: [] }));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("reader@example.test");
  await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  await page.getByRole("button", { name: /Sign In/i }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toHaveCount(0);
});
