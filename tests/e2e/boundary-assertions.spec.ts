import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { captureBoundaryCounts, expectBoundaryUnchanged } from "./helpers/boundary-assertions";
import { expectRouteHealthy } from "./helpers/page-assertions";

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")) as {
  tenant: { id: string };
  records: Record<string, { route: string }>;
};

test.describe("Boundary assertion foundation", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  test("Payment Execution route inspection does not create bank transactions", async ({ page }) => {
    const before = await captureBoundaryCounts(manifest.tenant.id, ["bank_transactions", "reconciliation_matches", "accounting_export_batches"]);
    await expectRouteHealthy(page, manifest.records.paymentBatch.route, "Payment");
    await expectBoundaryUnchanged(manifest.tenant.id, before, "payment execution route inspection");
  });

  test("Bank Reconciliation route inspection does not create accounting exports", async ({ page }) => {
    const before = await captureBoundaryCounts(manifest.tenant.id, ["accounting_export_batches", "accounting_export_items"]);
    await expectRouteHealthy(page, manifest.records.bankTransaction.route, "Bank");
    await expectBoundaryUnchanged(manifest.tenant.id, before, "bank reconciliation route inspection");
  });

  test("Accounting Export route inspection does not mutate source financial records", async ({ page }) => {
    const before = await captureBoundaryCounts(manifest.tenant.id, ["invoices", "cash_receipts", "payment_batches", "bank_transactions"]);
    await expectRouteHealthy(page, manifest.records.accountingExportBatch.route, "Accounting");
    await expectBoundaryUnchanged(manifest.tenant.id, before, "accounting export route inspection");
  });
});
