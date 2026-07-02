import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

test.describe("Operator UI Phase 5 finance workbenches", () => {
  test("Billable Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);
    await page.goto("/billable");

    await expect(page.getByRole("heading", { name: "Billable Workbench" })).toBeVisible();
    await expect(page.getByText("Review approved production and QC-cleared work, resolve billing blockers, and prepare billable items for settlement workflow.")).toBeVisible();
    for (const label of ["Ready for Review", "On Hold", "Disputed", "Ready for Settlement", "Missing Support", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Ready for Review" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("Settlement Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);
    await page.goto("/settlements");

    await expect(page.getByRole("heading", { name: "Settlement Workbench" })).toBeVisible();
    await expect(page.getByText("Review billable totals, clear settlement blockers, and prepare approved settlements for invoice readiness.")).toBeVisible();
    for (const label of ["Draft", "Submitted for Review", "Approved", "Invoice Ready", "Disputed", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Draft" })).toHaveAttribute("aria-selected", "true");

    await context.close();
  });

  test("Invoice Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);
    await page.goto("/invoices");

    await expect(page.getByRole("heading", { name: "Invoice Workbench" })).toBeVisible();
    await expect(page.getByText("Track invoice review, sent status, disputes, and aging before cash application and collections workflows.")).toBeVisible();
    for (const label of ["Draft", "Submitted for Review", "Approved", "Sent", "Disputed", "Aging", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Draft" })).toHaveAttribute("aria-selected", "true");

    await context.close();
  });

  test("developer session UI is hidden by default on finance workbenches", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);

    for (const route of ["/billable", "/settlements", "/invoices"]) {
      await page.goto(route);
      await expect(page.locator("body")).not.toContainText(/Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i);
      await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
    }

    await context.close();
  });

  test("financial boundary copy appears on finance workbenches", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);

    await page.goto("/billable");
    await expect(page.getByText(/does not create a settlement, invoice, cash receipt, payment application, accounting export/i)).toBeVisible();

    await page.goto("/settlements");
    await expect(page.getByText(/Mark Invoice Ready.*does not send, post, create cash, or collect payment/i)).toBeVisible();

    await page.goto("/invoices");
    await expect(page.getByText(/Mark Sent.*does not email the customer, post to QuickBooks, create a cash receipt, apply cash, or collect payment/i)).toBeVisible();

    await context.close();
  });

  test("queue tabs can be selected on finance workbenches", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);

    await page.goto("/billable");
    const disputedBillable = page.getByRole("tab", { name: "Disputed" });
    await disputedBillable.click();
    await expect(disputedBillable).toHaveAttribute("aria-selected", "true");

    await page.goto("/settlements");
    const invoiceReady = page.getByRole("tab", { name: "Invoice Ready" });
    await invoiceReady.click();
    await expect(invoiceReady).toHaveAttribute("aria-selected", "true");

    await page.goto("/invoices");
    const aging = page.getByRole("tab", { name: "Aging" });
    await aging.click();
    await expect(aging).toHaveAttribute("aria-selected", "true");

    await context.close();
  });

  test("read-only auditor can view finance workbench without mutation controls", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto("/invoices");

    await expect(page.getByRole("heading", { name: "Invoice Workbench" })).toBeVisible();
    await expect(page.locator(".workspace-main").getByRole("link", { name: "Create Invoice" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Open Detail" }).first()).toBeVisible();

    await context.close();
  });
});
