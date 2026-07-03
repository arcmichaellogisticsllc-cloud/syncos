import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

test.describe("Operator UI Phase 8 finance control workbenches", () => {
  test("Bank Reconciliation Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.accountingManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.accountingManager.storageState);
    await page.goto("/bank-reconciliation");

    await expect(page.getByRole("heading", { name: "Bank Reconciliation Workbench" })).toBeVisible();
    await expect(page.getByText("Match bank-side evidence to SyncOS cash and payment records, review exceptions, and keep reconciliation status visible without connecting to banks or moving money.")).toBeVisible();
    for (const label of ["Unmatched Credits", "Unmatched Debits", "Review Matches", "Open Exceptions", "Resolved Exceptions", "Ignored", "Matched", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Unmatched Credits" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("Accounting Export Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.accountingManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.accountingManager.storageState);
    await page.goto("/accounting-exports");

    await expect(page.getByRole("heading", { name: "Accounting Export Workbench" })).toBeVisible();
    await expect(page.getByText("Prepare and track internal accounting handoff batches and export items without posting to QuickBooks, ERP, GL, tax, payroll, or banking systems.")).toBeVisible();
    for (const label of ["Draft", "Submitted for Review", "Approved", "Marked Submitted", "Accepted", "Canceled", "Items Need Attention", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Submitted for Review" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("developer session UI is hidden by default on finance control pages", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.accountingManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.accountingManager.storageState);

    for (const route of ["/bank-reconciliation", "/accounting-exports", "/reconciliation-matches/e8e8852f-fb54-5dfa-8fc0-aa8cae22c42e", "/accounting-export-items/012a13a5-3f55-5523-a45c-d5f79a5367e0"]) {
      await page.goto(route);
      await expect(page.locator("body")).not.toContainText(/Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i);
      await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
    }

    await context.close();
  });

  test("finance control boundary copy appears", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.accountingManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.accountingManager.storageState);

    await page.goto("/bank-reconciliation");
    await expect(page.getByText(/does not import bank feeds, connect to banks, move money, create cash receipts, execute payments, or post accounting entries/i)).toBeVisible();

    await page.goto("/accounting-exports");
    await expect(page.getByText(/does not post to QuickBooks, ERP, GL, tax systems, payroll systems, banks, or accounting close/i)).toBeVisible();

    await context.close();
  });

  test("queue tabs can be selected on finance control workbenches", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.accountingManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.accountingManager.storageState);

    await page.goto("/bank-reconciliation");
    const openExceptions = page.getByRole("tab", { name: "Open Exceptions" });
    await openExceptions.click();
    await expect(openExceptions).toHaveAttribute("aria-selected", "true");

    await page.goto("/accounting-exports");
    const markedSubmitted = page.getByRole("tab", { name: "Marked Submitted" });
    await markedSubmitted.click();
    await expect(markedSubmitted).toHaveAttribute("aria-selected", "true");

    await context.close();
  });

  test("read-only auditor can view bank reconciliation without create access", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto("/bank-reconciliation");

    await expect(page.getByRole("heading", { name: "Bank Reconciliation Workbench" })).toBeVisible();
    await expect(page.locator(".workspace-main").getByRole("link", { name: "Create Bank Account" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Open Detail" }).first()).toBeVisible();

    await context.close();
  });
});
