import { expect, test, type Page } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

const devUiPattern = /Operator Session|API Session|Bearer token|Permissions textarea|Paste a JWT|E2E session|Developer token controls/i;

async function openWithPersona(page: Page, route: string, storageState = personas.systemAdmin.storageState) {
  await installStoredSession(page, storageState);
  await page.goto(route);
}

async function expectNoDevSessionUi(page: Page) {
  await expect(page.locator("body")).not.toContainText(devUiPattern);
  await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
}

async function expectNoBodyOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe("Operator UI Phase 10 mobile, accessibility, and UAT readiness", () => {
  test("mobile shell renders without accidental horizontal overflow", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await openWithPersona(page, "/", personas.systemAdmin.storageState);

    await expect(page.locator(".brand", { hasText: "SyncOS" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace navigation", exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expectNoBodyOverflow(page);
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("tablet workbenches keep titles, queues, and controls visible", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState, viewport: { width: 768, height: 1024 } });
    const page = await context.newPage();

    for (const check of [
      { route: "/intelligence/signals", title: "Today's signal work" },
      { route: "/production", title: "Production Board" },
      { route: "/invoices", title: "Invoice Workbench" },
      { route: "/payments", title: "Payment Execution Workbench" },
      { route: "/bank-reconciliation", title: "Bank Reconciliation Workbench" },
    ]) {
      await openWithPersona(page, check.route, personas.systemAdmin.storageState);
      await expect(page.getByText(check.title).first()).toBeVisible();
      await expect(page.getByRole("tablist").first()).toBeVisible();
      await expect(page.locator(".summary-grid").first()).toBeVisible();
      await expectNoBodyOverflow(page);
      await expectNoDevSessionUi(page);
    }

    await context.close();
  });

  test("mobile Create Signal modal keeps title and actions in viewport", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState, viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    await openWithPersona(page, "/intelligence/signals", personas.growthOperator.storageState);

    await page.getByRole("button", { name: "Create Signal" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create Signal" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create Signal" })).toBeVisible();
    await expect(dialog.locator("input[name='title']")).toHaveAttribute("required", "");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(430);
    await expectNoBodyOverflow(page);
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("keyboard focus reaches navigation, queue controls, and modal controls", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.growthOperator.storageState, viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await openWithPersona(page, "/intelligence/signals", personas.growthOperator.storageState);

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Needs Review" })).toBeVisible();
    await page.getByRole("tab", { name: "Ready for Candidate" }).focus();
    await expect(page.getByRole("tab", { name: "Ready for Candidate" })).toBeFocused();
    await page.getByRole("button", { name: "Create Signal" }).first().focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create Signal" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).focus();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await context.close();
  });

  test("representative accessibility semantics are present", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState, viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await openWithPersona(page, "/production", personas.systemAdmin.storageState);

    await expect(page.getByRole("navigation", { name: "Workspace navigation", exact: true })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Production queues" })).toBeVisible();
    const submittedTab = page.getByRole("tab", { name: "Submitted" });
    await submittedTab.click();
    await expect(submittedTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("details.filter-drawer summary").first()).toHaveAttribute("aria-label", /drawer/i);
    await expectNoDevSessionUi(page);

    await context.close();
  });

  test("read-only detail still explains view-only state on tablet", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.readOnlyAuditor.storageState, viewport: { width: 768, height: 1024 } });
    const page = await context.newPage();
    await openWithPersona(page, "/production/d07f0f37-b932-50c0-a3c2-f007b62be454", personas.readOnlyAuditor.storageState);

    await expect(page.getByText(/You are viewing this record in read-only mode/i)).toBeVisible();
    await expect(page.getByText(/Read-only users cannot perform lifecycle actions/i)).toBeVisible();
    await expect(page.getByLabel("Next Action")).toBeVisible();
    await expectNoBodyOverflow(page);
    await expectNoDevSessionUi(page);

    await context.close();
  });
});
