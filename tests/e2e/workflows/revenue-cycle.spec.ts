import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Revenue cycle", () => {
  test.use({ storageState: personas.financeUser.storageState });

  test("opens Cedar Ridge revenue records", async ({ page }) => {
    // Runs late in suite under sustained load; triple timeout for resilience
    test.slow();
    await expectRouteHealthy(page, records.billableItem.route, "Billable");
    await expectRouteHealthy(page, records.settlement.route, "Settlement");
    await expectRouteHealthy(page, records.invoice.route, "Invoice");
    await expectRouteHealthy(page, records.cashReceipt.route, "Cash");
    await expectRouteHealthy(page, records.paymentApplication.route, "Payment Application");
    await expectRouteHealthy(page, records.collectionCase.route, "Collection");
  });
});
