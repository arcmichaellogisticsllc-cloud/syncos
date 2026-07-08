import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

const productionRoute = "/production/d07f0f37-b932-50c0-a3c2-f007b62be454";
const invoiceRoute = "/invoices/c8c9233d-8c96-55d9-a920-04dd928234ef";
const accountingExportRoute = "/accounting-exports/b82c2439-08d3-5f49-8bf0-5b5538884df6";
const signalRoute = "/intelligence/signals/a0d4da94-a197-538f-ba6c-371154494228";

async function expectNoDevSessionUi(page: import("@playwright/test").Page) {
  await expect(page.locator("body")).not.toContainText(/Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i);
  await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
}

test.describe("Operator UI Phase 9 detail and form standards", () => {
  test("representative operational detail shows next action and boundary copy", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await page.goto(productionRoute);

    await expect(page.getByRole("heading", { name: "Production Detail" })).toBeVisible();
    await expect(page.getByLabel("Next Action")).toBeVisible();
    await expect(page.getByText(/Review field truth, evidence, correction status, QC state, and billable readiness/i)).toBeVisible();
    await expect(page.getByText(/Mark Billable makes approved production eligible for billing workflow/i)).toBeVisible();
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("representative finance detail shows boundary and danger separation", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.financeUser.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.financeUser.storageState);
    await page.goto(invoiceRoute);

    await expect(page.getByRole("heading", { name: "Invoice Detail" })).toBeVisible();
    await expect(page.getByLabel("Next Action")).toBeVisible();
    await expect(page.getByText(/SyncOS does not email the customer, collect payment, apply cash, move money, or post accounting entries/i)).toBeVisible();
    await expect(page.getByLabel("Danger zone")).toBeVisible();
    await expect(page.getByText(/Reject, dispute, void, and archive actions change lifecycle state/i)).toBeVisible();
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("read-only auditor sees banner and disabled reason on detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto(productionRoute);

    await expect(page.getByText(/You are viewing this record in read-only mode/i)).toBeVisible();
    await expect(page.getByText(/Read-only users cannot perform lifecycle actions/i)).toBeVisible();
    await expect(page.getByLabel("Next Action")).toBeVisible();
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("representative create form has purpose header and boundary notice", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.accountingManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.accountingManager.storageState);
    await page.goto("/accounting-exports/new");

    await expect(page.locator("h1", { hasText: "Create Accounting Export Batch" })).toBeVisible();
    await expect(page.getByText(/Create an internal accounting handoff batch for review/i)).toBeVisible();
    await expect(page.getByText(/Export type, target system, and export format are required/i)).toBeVisible();
    await expect(page.getByText(/Create Accounting Export does not post to QuickBooks, ERP, GL, tax systems, banks, payroll systems, or accounting close/i)).toBeVisible();
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("signal detail hides developer controls and shows conversion boundary", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(signalRoute);

    await expect(page.getByRole("heading", { name: "Signal Detail" })).toBeVisible();
    await expect(page.getByLabel("Next Action")).toBeVisible();
    await expect(page.getByText(/Signal actions do not create opportunity, project, invoice, cash, payment, payroll, bank, or accounting records/i)).toBeVisible();
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("accounting export detail shows handoff next-action guidance", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.accountingManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.accountingManager.storageState);
    await page.goto(accountingExportRoute);

    await expect(page.getByRole("heading", { name: "Accounting Export Batch Detail" })).toBeVisible();
    await expect(page.getByLabel("Next Action")).toBeVisible();
    await expect(page.getByText(/Review batch items, mapping state, approval, submission, acceptance, and errors/i)).toBeVisible();
    await expect(page.locator(".boundary-notice").filter({ hasText: /SyncOS does not post to QuickBooks, ERP, GL, tax systems, payroll systems, banks, or accounting close/i })).toHaveCount(2);
    await expectNoDevSessionUi(page);

    await context.close();
  });
});
