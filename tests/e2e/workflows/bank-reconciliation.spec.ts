import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Bank Reconciliation", () => {
  test.use({ storageState: personas.accountingManager.storageState });

  test("opens Cedar Ridge bank reconciliation records", async ({ page }) => {
    await expectRouteHealthy(page, records.bankAccount.route, "Bank Account");
    await expectRouteHealthy(page, records.bankTransaction.route, "Bank");
    await expectRouteHealthy(page, records.reconciliationMatch.route, "Reconciliation");
  });
});
