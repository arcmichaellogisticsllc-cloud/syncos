import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

test.describe("Operator UI Phase 6 cash and collections workbenches", () => {
  test("Cash Application Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);
    await page.goto("/cash");

    await expect(page.getByRole("heading", { name: "Cash Application Workbench" })).toBeVisible();
    await expect(page.getByText("Track received cash, apply receipts to invoices, and control unapplied or voided cash application workflow inside SyncOS.")).toBeVisible();
    for (const label of ["Unapplied", "Partially Applied", "Fully Applied", "Application Review", "Voided", "Archived", "Exceptions"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Unapplied" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("Collections Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.collectionsSpecialist.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.collectionsSpecialist.storageState);
    await page.goto("/collections");

    await expect(page.getByRole("heading", { name: "Collections Workbench" })).toBeVisible();
    await expect(page.getByText("Manage overdue invoice follow-up, owner assignment, disputes, promises to pay, and collection action history.")).toBeVisible();
    for (const label of ["Needs Action", "Unassigned", "Promise to Pay", "Disputed", "Aging", "Completed", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Needs Action" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("developer session UI is hidden by default on cash and collections pages", async ({ browser }) => {
    const financeContext = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await financeContext.newPage();
    await installStoredSession(page, personas.financeUser.storageState);

    for (const route of ["/cash", "/payment-applications"]) {
      await page.goto(route);
      await expect(page.locator("body")).not.toContainText(/Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i);
      await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
    }

    await financeContext.close();

    const collectionsContext = await browser.newContext({ storageState: personas.collectionsSpecialist.storageState });
    const collectionsPage = await collectionsContext.newPage();
    await installStoredSession(collectionsPage, personas.collectionsSpecialist.storageState);

    for (const route of ["/collections", "/collection-actions"]) {
      await collectionsPage.goto(route);
      await expect(collectionsPage.locator("body")).not.toContainText(/Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i);
      await expect(collectionsPage.getByPlaceholder("Bearer token")).toHaveCount(0);
    }

    await collectionsContext.close();
  });

  test("cash boundary copy appears", async ({ browser }) => {
    const financeContext = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await financeContext.newPage();
    await installStoredSession(page, personas.financeUser.storageState);

    await page.goto("/cash");
    await expect(page.getByText(/does not pull bank feeds, move money, process cards, initiate ACH, or post accounting entries/i)).toBeVisible();

    await financeContext.close();
  });

  test("collections boundary copy appears", async ({ browser }) => {
    const collectionsContext = await browser.newContext({ storageState: personas.collectionsSpecialist.storageState });
    const collectionsPage = await collectionsContext.newPage();
    await installStoredSession(collectionsPage, personas.collectionsSpecialist.storageState);

    await collectionsPage.goto("/collections");
    await expect(collectionsPage.getByText(/does not automatically email customers, make calls, collect money, report credit, or create legal action/i)).toBeVisible();

    await collectionsContext.close();
  });

  test("queue tabs can be selected on cash and collections workbenches", async ({ browser }) => {
    const financeContext = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await financeContext.newPage();
    await installStoredSession(page, personas.financeUser.storageState);

    await page.goto("/cash");
    const voidedCash = page.getByRole("tab", { name: "Voided" });
    await voidedCash.click();
    await expect(voidedCash).toHaveAttribute("aria-selected", "true");

    await financeContext.close();

    const collectionsContext = await browser.newContext({ storageState: personas.collectionsSpecialist.storageState });
    const collectionsPage = await collectionsContext.newPage();
    await installStoredSession(collectionsPage, personas.collectionsSpecialist.storageState);

    await collectionsPage.goto("/collections");
    const disputed = collectionsPage.getByRole("tab", { name: "Disputed" });
    await disputed.click();
    await expect(disputed).toHaveAttribute("aria-selected", "true");

    await collectionsContext.close();
  });

  test("read-only auditor can view cash workbench without create access", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto("/cash");

    await expect(page.getByRole("heading", { name: "Cash Application Workbench" })).toBeVisible();
    await expect(page.locator(".workspace-main").getByRole("link", { name: "Create Cash Receipt" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Open Detail" }).first()).toBeVisible();

    await context.close();
  });
});
