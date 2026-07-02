import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

test.describe("Operator UI Phase 7 payout workbenches", () => {
  test("Contractor Payables Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.payablesPayrollAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.payablesPayrollAdmin.storageState);
    await page.goto("/contractor-payables");

    await expect(page.getByRole("heading", { name: "Contractor Payables Workbench" })).toBeVisible();
    await expect(page.getByText("Review contractor payable records, resolve disputes, approve totals, and prepare approved payables for internal payment execution readiness.")).toBeVisible();
    for (const label of ["Draft", "Submitted for Review", "Approved", "Payment Ready", "Disputed", "Blocked", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Submitted for Review" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("Payroll Readiness Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.payablesPayrollAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.payablesPayrollAdmin.storageState);
    await page.goto("/payroll");

    await expect(page.getByRole("heading", { name: "Payroll Readiness Workbench" })).toBeVisible();
    await expect(page.getByText("Review internal payroll readiness, resolve disputes, approve totals, and prepare approved payroll records for manual or external payroll processing.")).toBeVisible();
    for (const label of ["Draft", "Submitted for Review", "Approved", "Payroll Ready", "Disputed", "Blocked", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Submitted for Review" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("Payment Execution Workbench renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.payablesPayrollAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.payablesPayrollAdmin.storageState);
    await page.goto("/payments");

    await expect(page.getByRole("heading", { name: "Payment Execution Workbench" })).toBeVisible();
    await expect(page.getByText("Track internal payment batch approval, scheduling, submission, and manual/external execution status without moving money inside SyncOS.")).toBeVisible();
    for (const label of ["Draft", "Submitted for Review", "Approved", "Scheduled", "Submitted Execution", "Executed", "Voided", "Items Need Attention", "Archived"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Submitted for Review" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("developer session UI is hidden by default on payout pages", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.payablesPayrollAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.payablesPayrollAdmin.storageState);

    for (const route of ["/contractor-payables", "/payroll", "/payments", "/payment-items/6a46faba-f5a3-521e-aac6-4a334c104f9e"]) {
      await page.goto(route);
      await expect(page.locator("body")).not.toContainText(/Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i);
      await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
    }

    await context.close();
  });

  test("payout boundary copy appears", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.payablesPayrollAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.payablesPayrollAdmin.storageState);

    await page.goto("/contractor-payables");
    await expect(page.getByText(/does not pay contractors, initiate ACH, issue card payouts, print checks, or post accounting entries/i)).toBeVisible();

    await page.goto("/payroll");
    await expect(page.getByText(/does not run payroll, issue direct deposit, submit to a payroll provider, file payroll taxes, or produce W-2\/1099 filings/i)).toBeVisible();

    await page.goto("/payments");
    await expect(page.getByText(/does not move money, initiate ACH, send wires, issue card payouts, print checks, submit payroll, or connect to a bank/i)).toBeVisible();

    await context.close();
  });

  test("queue tabs can be selected on payout workbenches", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.payablesPayrollAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.payablesPayrollAdmin.storageState);

    await page.goto("/contractor-payables");
    const paymentReady = page.getByRole("tab", { name: "Payment Ready" });
    await paymentReady.click();
    await expect(paymentReady).toHaveAttribute("aria-selected", "true");

    await page.goto("/payroll");
    const payrollReady = page.getByRole("tab", { name: "Payroll Ready" });
    await payrollReady.click();
    await expect(payrollReady).toHaveAttribute("aria-selected", "true");

    await page.goto("/payments");
    const scheduled = page.getByRole("tab", { name: "Scheduled" });
    await scheduled.click();
    await expect(scheduled).toHaveAttribute("aria-selected", "true");

    await context.close();
  });

  test("read-only auditor can view contractor payables without create access", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto("/contractor-payables");

    await expect(page.getByRole("heading", { name: "Contractor Payables Workbench" })).toBeVisible();
    await expect(page.locator(".workspace-main").getByRole("link", { name: "Create Contractor Payable" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Open Detail" }).first()).toBeVisible();

    await context.close();
  });
});
