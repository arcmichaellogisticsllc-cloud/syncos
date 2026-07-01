import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

test.describe("Operator UI Phase 4 execution queues", () => {
  test("Work Orders page renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.opsManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.opsManager.storageState);
    await page.goto("/work-orders");

    await expect(page.getByRole("heading", { name: "Work Orders" })).toBeVisible();
    await expect(page.getByText("Plan, assign, and monitor executable telecom work before production and QC.")).toBeVisible();
    await expect(page.getByText("What work needs operational attention today?")).toBeVisible();
    for (const label of ["Ready to Start", "Active Work", "Blocked", "Production Missing", "Ready for QC"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Ready to Start" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("Production Board renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.fieldSupervisor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.fieldSupervisor.storageState);
    await page.goto("/production");

    await expect(page.getByRole("heading", { name: "Production Board" })).toBeVisible();
    await expect(page.getByText("Track field production from draft through review, correction, approval, and billable readiness.")).toBeVisible();
    for (const label of ["Drafts", "Submitted", "Under Review", "Correction Required", "Approved", "Billable Ready"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Draft" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/Mark Approved Billable/i)).toBeVisible();

    await context.close();
  });

  test("QC Review Queue renders operator queue", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.qcManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.qcManager.storageState);
    await page.goto("/qc");

    await expect(page.getByRole("heading", { name: "QC Review Queue" })).toBeVisible();
    await expect(page.getByText("Review production quality, clear corrections, and protect downstream billable readiness.")).toBeVisible();
    for (const label of ["Pending Review", "In Review", "Correction Required", "Approved"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Pending Review" })).toHaveAttribute("aria-selected", "true");

    await context.close();
  });

  test("developer session UI is hidden by default on execution pages", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);

    for (const route of ["/work-orders", "/production", "/qc"]) {
      await page.goto(route);
      await expect(page.locator("body")).not.toContainText(/Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT/i);
      await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
    }

    await context.close();
  });

  test("read-only auditor can view execution queue without mutation controls", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto("/production");

    await expect(page.getByRole("heading", { name: "Production Board" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create Production Record" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Open Detail" }).first()).toBeVisible();

    await context.close();
  });

  test("queue tabs can be selected on execution pages", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.opsManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.opsManager.storageState);

    await page.goto("/work-orders");
    const blocked = page.getByRole("tab", { name: "Blocked" });
    await blocked.click();
    await expect(blocked).toHaveAttribute("aria-selected", "true");

    await page.goto("/production");
    const approved = page.getByRole("tab", { name: "Approved" });
    await approved.click();
    await expect(approved).toHaveAttribute("aria-selected", "true");

    await page.goto("/qc");
    const correctionRequired = page.getByRole("tab", { name: "Correction Required" });
    await correctionRequired.click();
    await expect(correctionRequired).toHaveAttribute("aria-selected", "true");

    await context.close();
  });
});
