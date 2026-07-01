import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { authHeaders, installStoredSession } from "./helpers/auth";

const signalFeedRoute = "/intelligence/signals";

test.describe("Operator shell and page templates", () => {
  test("operator shell renders compact workspace navigation", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Workspace navigation", exact: true });
    await expect(nav).toBeVisible();
    for (const label of ["Command Center", "Growth", "Operations", "Finance", "Admin"]) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(nav.getByText("Planned")).toBeVisible();

    await context.close();
  });

  test("workspace subnavigation follows the active workspace", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(signalFeedRoute);

    const growthNav = page.getByRole("navigation", { name: "Growth workspace navigation" });
    await expect(growthNav).toBeVisible();
    await expect(growthNav.getByRole("link", { name: "Signal Feed" })).toHaveAttribute("aria-current", "page");
    await expect(growthNav.getByRole("link", { name: "Organizations" })).toBeVisible();
    await expect(growthNav.getByRole("link", { name: "Contacts" })).toBeVisible();

    await context.close();
  });

  test("Signal Feed uses the shared queue page pattern", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(signalFeedRoute);

    await expect(page.getByText("Today's signal work")).toBeVisible();
    for (const label of ["Needs Review", "High Confidence Unassigned", "Missing Organization", "Missing Evidence", "Ready for Candidate"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Needs Review" })).toBeVisible();
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");
    await expect(page.getByText("Operator Session")).toHaveCount(0);

    await context.close();
  });

  test("production/default UI hides developer session controls on operator pages", async ({ browser }) => {
    const routes = [signalFeedRoute, "/billable", "/payments", "/bank-reconciliation", "/accounting-exports"];
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);

    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("body")).not.toContainText(/Operator Session|API Session|Paste a JWT|Bearer token|permissions textarea/i);
      await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
    }

    await context.close();
  });

  test("read-only auditor can view Signal Feed without mutation actions", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto(signalFeedRoute);

    await expect(page.getByText("Today's signal work")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Signal" }).first()).toBeDisabled();
    await expect(page.getByText("Your role can review signals but cannot create them.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Categorize" }).first()).toBeDisabled();

    await context.close();
  });

  test("ActionButton disabled reason appears for blocked Verify action", async ({ browser }) => {
    const title = await createSignalWithoutEvidence();
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(signalFeedRoute);
    await page.getByRole("tab", { name: "Needs Review" }).click();
    const row = page.getByRole("row").filter({ hasText: title });

    await expect(row.getByRole("button", { name: "Verify" })).toBeDisabled();
    await expect(row.getByText("Add evidence before verifying.")).toBeVisible();

    await context.close();
  });

  test("queue tabs expose active state changes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(signalFeedRoute);

    const archived = page.getByRole("tab", { name: "Archived Signals" });
    await archived.click();
    await expect(archived).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Needs Review" })).toHaveAttribute("aria-selected", "false");

    await context.close();
  });
});

async function createSignalWithoutEvidence() {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) throw new Error("API_BASE_URL is required for operator shell E2E setup");
  const title = `E2E Operator Shell Missing Evidence ${Date.now()} ${Math.random().toString(16).slice(2)}`;
  const response = await fetch(`${apiBaseUrl}/signals`, {
    method: "POST",
    headers: authHeaders(personas.growthOperator.storageState),
    body: JSON.stringify({
      title,
      description: "Signal created to verify shared ActionButton disabled reason behavior.",
      signal_category: "funding",
      signal_type: "broadband_funding",
      source_name: "E2E Operator Shell",
      source_type: "manual_entry",
      source_note: "No evidence is intentionally attached.",
      trust_level: "unverified",
      work_type: "fiber",
    }),
  });
  expect(response.ok, await response.text()).toBe(true);
  return title;
}
