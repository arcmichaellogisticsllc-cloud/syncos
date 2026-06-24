import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Cost, labor, and payment execution", () => {
  test.use({ storageState: personas.payablesPayrollAdmin.storageState });

  test("opens Cedar Ridge payable, payroll, and payment records", async ({ page }) => {
    await expectRouteHealthy(page, records.contractorPayable.route, "Contractor");
    await expectRouteHealthy(page, records.payrollRun.route, "Payroll");
    await expectRouteHealthy(page, records.paymentBatch.route, "Payment");
    await expectRouteHealthy(page, records.paymentItem.route, "Payment");
  });
});
