import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { readE2EManifest } from "../helpers/manifest";
import { expectBackendDenied, expectNavVisible, expectStoredPermission, expectStoredPermissionAbsent } from "../helpers/permissions";

const manifest = readE2EManifest();

test.describe("Minimum persona permission certification", () => {
  test("system admin has broad workspace and action visibility", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await page.goto("/executive");
    await expectNavVisible(page, ["Intelligence", "Operations", "Finance"]);
    await page.goto(manifest.records.invoice.route);
    await expect(page.getByRole("button", { name: /Approve|Mark Sent|Archive/i }).first()).toBeVisible();
    await page.goto(manifest.records.paymentBatch.route);
    await expect(page.getByRole("button", { name: /Submit Execution|Mark Executed/i }).first()).toBeVisible();
    await context.close();
  });

  test("operations manager can read execution but backend denies finance mutation", async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: personas.opsManager.storageState });
    const page = await context.newPage();
    await page.goto("/projects");
    await expect(page.locator("body")).toContainText(/project/i);
    await expectStoredPermission(page, "project.read");
    await expectStoredPermissionAbsent(page, "invoice.create");
    await expectBackendDenied(request, personas.opsManager.storageState, "POST", "/invoices", { invoice_number: "E2E-DENIED" });
    await context.close();
  });

  test("finance user can read finance workspaces and lacks production mutation permissions", async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await page.goto("/invoices");
    await expect(page.locator("body")).toContainText(/invoice/i);
    await page.goto("/cash");
    await expect(page.locator("body")).toContainText(/cash/i);
    await expectStoredPermission(page, "invoice.read");
    await expectStoredPermissionAbsent(page, "production.approve");
    await expectBackendDenied(request, personas.financeUser.storageState, "POST", `/production-records/${manifest.records.productionRecord.id}/approve`, { approval_note: "denied" });
    await context.close();
  });

  test("read-only auditor can read but cannot create or mutate", async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await page.goto(manifest.records.invoice.route);
    await expect(page.locator("body")).toContainText(/invoice/i);
    await expectStoredPermission(page, "invoice.read");
    await expectStoredPermissionAbsent(page, "invoice.create");
    await expectBackendDenied(request, personas.readOnlyAuditor.storageState, "POST", "/cash-receipts", { receipt_number: "E2E-DENIED" });
    await context.close();
  });
});
