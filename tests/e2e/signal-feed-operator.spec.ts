import { expect, test, type Browser, type Page } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { authHeaders, installStoredSession } from "./helpers/auth";

const route = "/intelligence/signals";

test.describe("Signal Feed operator hardening", () => {
  test("production/default mode hides developer session controls", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(route);

    await expect(page.getByText("Today's signal work")).toBeVisible();
    await expect(page.getByText("Operator Session")).toHaveCount(0);
    await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apply session" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);

    await context.close();
  });

  test("unauthenticated state uses production-safe copy", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(route);

    await expect(page.getByRole("heading", { name: "Login required" })).toBeVisible();
    await expect(page.getByText("Sign in to review market intelligence and manage signal queues.")).toBeVisible();
    await expect(page.getByText("Authentication is required before this workspace can load.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/developer|token|jwt|e2e|permissions textarea/i);

    await context.close();
  });

  test("authenticated Signal Feed renders priorities, tabs, and collapsed filters", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(route);

    await expect(page.getByText("Today's signal work")).toBeVisible();
    for (const label of ["Needs Review", "High Confidence Unassigned", "Missing Organization", "Missing Evidence", "Ready for Candidate"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
    const readyTab = page.getByRole("tab", { name: "Ready for Candidate" });
    await readyTab.click();
    await expect(readyTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer")).not.toHaveAttribute("open", "");

    await context.close();
  });

  test("Create Signal opens an operator modal with modal standards", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.growthOperator.storageState);
    await page.goto(route);

    await page.getByRole("button", { name: "Create Signal" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create Signal" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("does not create candidates, opportunities, projects, invoices, payments, or accounting records");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Create Signal" })).toBeEnabled();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await context.close();
  });

  test("Categorize opens modal, submits, and refreshes", async ({ browser }) => {
    const title = await createSignal("Categorize");
    const page = await openGrowthSignalFeed(browser, title);

    await rowFor(page, title).getByRole("button", { name: "Categorize" }).click();
    const dialog = page.getByRole("dialog", { name: "Categorize Signal" });
    await expect(dialog).toBeVisible();
    await dialog.locator("select[name='signal_category']").selectOption("utility");
    await dialog.locator("select[name='signal_type']").selectOption("utility_work");
    await dialog.getByRole("button", { name: "Categorize Signal" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(title)).toBeVisible();
  });

  test("Score opens modal, submits, and refreshes", async ({ browser }) => {
    const title = await createSignal("Score");
    const page = await openGrowthSignalFeed(browser, title);

    await rowFor(page, title).getByRole("button", { name: "Score" }).click();
    const dialog = page.getByRole("dialog", { name: "Score Signal" });
    await expect(dialog).toBeVisible();
    await dialog.locator("input[name='confidence_score']").fill("88");
    await dialog.getByRole("button", { name: "Score Signal" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(title)).toBeVisible();
  });

  test("Verify disabled reason appears when evidence is missing", async ({ browser }) => {
    const title = await createSignal("Verify Disabled");
    const page = await openGrowthSignalFeed(browser, title);
    const row = rowFor(page, title);

    await expect(row.getByRole("button", { name: "Verify" })).toBeDisabled();
    await expect(row.getByText("Add evidence before verifying.")).toBeVisible();
  });

  test("Archive opens danger modal and requires reason", async ({ browser }) => {
    const title = await createSignal("Archive");
    const page = await openGrowthSignalFeed(browser, title);

    await rowFor(page, title).getByRole("button", { name: "Archive" }).click();
    const dialog = page.getByRole("dialog", { name: "Archive Signal" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("select[name='archive_reason']")).toHaveAttribute("required", "");
    await expect(dialog).toContainText("does not create candidates, opportunities, projects, invoices, payments, or accounting records");
    await dialog.locator("textarea[name='archive_note']").fill("No longer actionable for operator review.");
    await dialog.getByRole("button", { name: "Archive Signal" }).click();

    await expect(dialog).toHaveCount(0);
  });

  test("read-only auditor can view but cannot mutate", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.readOnlyAuditor.storageState);
    await page.goto(route);

    await expect(page.getByText("Today's signal work")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Signal" }).first()).toBeDisabled();
    await expect(page.getByText("Your role can review signals but cannot create them.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Categorize" }).first()).toBeDisabled();
    await expect(page.getByText(/cannot categorize/i).first()).toBeVisible();

    await context.close();
  });
});

async function createSignal(prefix: string) {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) throw new Error("API_BASE_URL is required for Signal Feed E2E setup");
  const title = `E2E ${prefix} Signal ${Date.now()} ${Math.random().toString(16).slice(2)}`;
  const response = await fetch(`${apiBaseUrl}/signals`, {
    method: "POST",
    headers: authHeaders(personas.growthOperator.storageState),
    body: JSON.stringify({
      title,
      description: `${prefix} signal created by Signal Feed operator hardening E2E.`,
      signal_category: "funding",
      signal_type: "broadband_funding",
      source_name: "E2E Operator Signal Feed",
      source_type: "manual_entry",
      source_note: "E2E-owned signal record.",
      trust_level: "unverified",
      work_type: "fiber",
    }),
  });
  expect(response.ok, await response.text()).toBe(true);
  return title;
}

async function openGrowthSignalFeed(browser: Browser, title: string) {
  const context = await browser.newContext({ storageState: personas.growthOperator.storageState });
  const page = await context.newPage();
  await installStoredSession(page, personas.growthOperator.storageState);
  await page.goto(route);
  await page.getByRole("tab", { name: "Needs Review" }).click();
  await expect(page.getByText(title)).toBeVisible();
  return page;
}

function rowFor(page: Page, title: string) {
  return page.getByRole("row").filter({ hasText: title });
}
