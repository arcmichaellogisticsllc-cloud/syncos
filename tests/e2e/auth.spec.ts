import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { personas } from "./fixtures/personas";

test.describe("E2E auth storage state foundation", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  test("system admin storage state is generated and can open the app shell", async ({ page }) => {
    expect(fs.existsSync(personas.systemAdmin.storageState)).toBe(true);
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    const token = await page.evaluate(() => window.localStorage.getItem("syncos.apiToken"));
    const permissions = await page.evaluate(() => window.localStorage.getItem("syncos.permissions"));
    expect(token).toBeTruthy();
    expect(permissions).toContain(personas.systemAdmin.expectedPermissionHint);
  });
});
