import { expect, test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { installStoredSession } from "./helpers/auth";

test.describe("Operator UI Phase 3 command surfaces", () => {
  test("Command Center renders daily priorities instead of redirect-only shell", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await expect(page.getByText("Start with what needs attention now.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review Blockers", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Operations Board", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's work" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Decisions to make" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Operator Session|Bearer token|Paste a JWT|permissions textarea/i);

    await context.close();
  });

  test("Executive Command Center leads with decisions and risk queues", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await page.goto("/executive");

    await expect(page.getByRole("heading", { name: "Executive Command Center" })).toBeVisible();
    await expect(page.getByText("What is stopping telecom work from becoming cash?")).toBeVisible();
    await expect(page.getByText("Blocked work")).toBeVisible();
    await expect(page.getByRole("link", { name: /Cash exposure.*Overdue/i })).toBeVisible();
    await expect(page.getByText("Approval pressure")).toBeVisible();
    await expect(page.getByText("Decision queues")).toBeVisible();
    await expect(page.getByRole("link", { name: "View Cash Exposure" })).toBeVisible();

    await context.close();
  });

  test("Operations Board renders workflow-first execution lanes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.systemAdmin.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.systemAdmin.storageState);
    await page.goto("/operations");

    await expect(page.getByRole("heading", { name: "Operations Board" })).toBeVisible();
    await expect(page.getByText("Can we execute the work safely and keep it moving?")).toBeVisible();
    await expect(page.getByText("Plan work")).toBeVisible();
    await expect(page.getByText("Execute work")).toBeVisible();
    await expect(page.getByText("Approve work")).toBeVisible();
    await expect(page.getByText("Capacity and crew signals")).toBeVisible();
    await expect(page.getByText("Execution control")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Work Orders" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Operator Session|Bearer token|Paste a JWT|permissions textarea/i);

    await context.close();
  });

  test("operations users without dashboard or QC permission see only their approved queues", async ({ browser }) => {
    const context = await browser.newContext({ storageState: personas.opsManager.storageState });
    const page = await context.newPage();
    await installStoredSession(page, personas.opsManager.storageState);
    await page.goto("/operations");

    await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open QC Queue" })).toHaveCount(0);
    await page.goto("/work-orders");
    await expect(page.getByRole("heading", { name: "Work Orders", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create Work Order", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "QC Queue", exact: true })).toHaveCount(0);
    await page.goto("/qc");
    await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create QC Review", exact: true })).toHaveCount(0);

    await context.close();
  });
});
