import { test, expect } from "@playwright/test";
import { personas } from "./fixtures/personas";

test.use({ storageState: personas.systemAdmin.storageState });

// UI contract with server identity/record fixtures; no database writes or financial execution.
for (const scenario of [
  { label: "read-only", canMatch: false, status: "unmatched" },
  { label: "authorized", canMatch: true, status: "unmatched" },
  { label: "archived", canMatch: true, status: "archived" },
]) {
  test(`bank match tabs honor ${scenario.label} access and lifecycle`, async ({ page }) => {
    const permissions = ["bank_transaction.read", ...(scenario.canMatch ? ["bank_transaction.match"] : [])];
    await page.route("**/api/syncos/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/me")) return route.fulfill({ json: {
        user_id: "ui-bank-reviewer", tenant_id: "ui-bank-tenant", roles: ["read_only_auditor"],
        role_names: ["Read Only Auditor"], permissions,
      } });
      if (path.endsWith("/bank-transactions/ui-transaction/detail")) return route.fulfill({ json: {
        bank_transaction: { id: "ui-transaction", amount: 25, currency: "USD", direction: "debit", reconciliation_status: scenario.status },
        reconciliation_matches: [],
      } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/bank-reconciliation/transactions/ui-transaction");
    await expect(page.getByRole("heading", { name: "Bank Transaction Detail", exact: true })).toBeVisible();
    for (const tab of ["Match Payment Batch", "Match Payment Item", "Match Cash Receipt"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const button = page.getByRole("button", { name: "Open Match Form", exact: true });
      if (!scenario.canMatch) await expect(button).toHaveCount(0);
      else if (scenario.status === "archived") await expect(button).toBeDisabled();
      else {
        await expect(button).toBeEnabled();
        await button.click();
        await expect(page.locator("form.modal-card")).toBeVisible();
        await page.locator("form.modal-card").getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.locator("form.modal-card")).toHaveCount(0);
      }
    }
  });
}
