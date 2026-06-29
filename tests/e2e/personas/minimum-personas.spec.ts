import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { actionStates } from "../fixtures/action-states";
import { readE2EManifest } from "../helpers/manifest";
import { expectBackendDenied, expectNavVisible, expectStoredPermission, expectStoredPermissionAbsent } from "../helpers/permissions";
import { installStoredSession } from "../helpers/auth";
import { expectRouteHealthy } from "../helpers/page-assertions";

const manifest = readE2EManifest();
const invoiceApproved = actionStates.find((s) => s.stateKey === "invoiceApproved")!;
const paymentBatchExecutionSubmitted = actionStates.find((s) => s.stateKey === "paymentBatchExecutionSubmitted")!;

test.describe("Minimum persona permission certification", () => {
  test.setTimeout(180_000);

  test("system admin has broad workspace and action visibility", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, invoiceApproved.route, invoiceApproved.objectType);
    await expectNavVisible(page, ["Intelligence", "Operations", "Finance"]);
    await expect(page.getByRole("button", { name: invoiceApproved.expectedActionLabel }).first()).toBeVisible({ timeout: 60_000 });
    await installStoredSession(page, personas.systemAdmin.storageState);
    await expectRouteHealthy(page, paymentBatchExecutionSubmitted.route, paymentBatchExecutionSubmitted.objectType);
    await expect(page.getByRole("button", { name: paymentBatchExecutionSubmitted.expectedActionLabel }).first()).toBeVisible({ timeout: 60_000 });
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
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto(invoiceApproved.route);
    await expect(page.locator("body")).toContainText(/invoice/i);
    await expectStoredPermission(page, "invoice.read");
    await expectStoredPermissionAbsent(page, "invoice.create");
    await expectBackendDenied(request, personas.readOnlyAuditor.storageState, "POST", "/cash-receipts", { receipt_number: "E2E-DENIED" });
    await context.close();
  });
});
