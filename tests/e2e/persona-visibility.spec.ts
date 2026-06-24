import { test, expect } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { expectAnyText } from "./helpers/page-assertions";

test.describe("Persona visibility smoke", () => {
  test("system admin can see major governed navigation areas", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await page.goto("/executive");
    await expectAnyText(page, ["Intelligence", "Projects", "Finance", "Accounting"]);
    await context.close();
  });

  test("finance user can open finance workspaces", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await page.goto("/invoices");
    await expect(page.locator("body")).toContainText(/invoice/i);
    await page.goto("/cash");
    await expect(page.locator("body")).toContainText(/cash/i);
    await context.close();
  });

  test("operations user can open execution workspaces", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.opsManager.storageState });
    const page = await context.newPage();
    await page.goto("/projects");
    await expect(page.locator("body")).toContainText(/project/i);
    await page.goto("/work-orders");
    await expect(page.locator("body")).toContainText(/work order/i);
    await context.close();
  });

  test("read-only auditor does not receive create permissions in stored persona state", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await page.goto("/invoices");
    const permissions = await page.evaluate(() => window.localStorage.getItem("syncos.permissions") ?? "");
    expect(permissions).toContain("invoice.read");
    expect(permissions).not.toContain("invoice.create");
    await context.close();
  });
});
