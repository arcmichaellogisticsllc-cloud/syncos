import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

const devUiPattern = /Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i;

async function expectNoDevSessionUi(page: import("@playwright/test").Page) {
  await expect(page.locator("body")).not.toContainText(devUiPattern);
  await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
}

test.describe("Operator UI Phase 11 account onboarding workbench", () => {
  test("renders the account onboarding pipeline and boundary copy", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto("/intelligence/account-onboarding");

    await expect(page.getByRole("heading", { name: "Account Onboarding Workbench" })).toBeVisible();
    await expect(page.getByText(/Track prime\/customer and contractor\/vendor onboarding readiness/i)).toBeVisible();
    await expect(page.getByText(/Account onboarding tracks internal relationship, compliance, commercial, market, and mobilization readiness/i)).toBeVisible();
    await expect(page.getByText(/does not create contracts, payables, payroll, invoices, tax filings, insurance verification, customer assignments, or guaranteed work/i)).toBeVisible();
    for (const stage of ["Identified", "Contact Discovered", "Initial Outreach", "Application Submitted", "Documents Requested", "Compliance Review", "Operational Interview", "Rate Negotiation", "Approved", "Market Assigned", "Mobilized"]) {
      await expect(page.getByRole("tab", { name: stage })).toBeVisible();
    }
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("stage tabs and account lanes are interactive", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await page.goto("/intelligence/account-onboarding");

    const rateNegotiation = page.getByRole("tab", { name: "Rate Negotiation" });
    await rateNegotiation.click();
    await expect(rateNegotiation).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Rate Negotiation" })).toBeVisible();

    await page.getByLabel("Account lane").selectOption("contractor");
    await expect(page.getByLabel("Account lane")).toHaveValue("contractor");
    await page.getByLabel("Search").fill("Blue Splice");
    await expect(page.getByLabel("Search")).toHaveValue("Blue Splice");
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("shows contract-backed prime onboarding fields instead of hardcoded UI data", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto("/intelligence/account-onboarding");

    await page.getByRole("tab", { name: "Application Submitted" }).click();
    await expect(page.getByRole("row", { name: /Underground Contractors Inc\./i })).toBeVisible();
    await expect(page.getByRole("row", { name: /Underground Contractors Inc\./i })).toContainText("MI/OH");
    await expect(page.getByRole("row", { name: /Underground Contractors Inc\./i })).toContainText("Vendor Manager");
    await expect(page.getByRole("row", { name: /Underground Contractors Inc\./i })).toContainText("Probability: Medium (58)");
    await expect(page.getByRole("heading", { name: "Current schema gaps" })).toHaveCount(0);
    await expectNoDevSessionUi(page);

    await context.close();
  });
});
