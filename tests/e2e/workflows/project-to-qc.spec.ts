import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Project to QC", () => {
  test.use({ storageState: personas.fieldSupervisor.storageState });

  test("opens Cedar Ridge execution records", async ({ page }) => {
    await expectRouteHealthy(page, records.project.route, "Project");
    await expectRouteHealthy(page, records.workOrder.route, "Work Order");
    await expectRouteHealthy(page, records.productionRecord.route, "Production");
    await expectRouteHealthy(page, records.qcReview.route, "QC");
  });
});
