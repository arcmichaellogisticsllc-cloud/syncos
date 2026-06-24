import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Accounting Export", () => {
  test.use({ storageState: personas.accountingManager.storageState });

  test("opens Cedar Ridge accounting export records", async ({ page }) => {
    await expectRouteHealthy(page, records.accountingExportBatch.route, "Accounting");
    await expectRouteHealthy(page, records.accountingExportItem.route, "Accounting");
  });
});
