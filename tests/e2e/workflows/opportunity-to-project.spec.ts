import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Opportunity to Project", () => {
  test.use({ storageState: personas.opsManager.storageState });

  test("opens Cedar Ridge coverage and project records", async ({ page }) => {
    await expectRouteHealthy(page, records.opportunity.route, "Opportunity");
    await expectRouteHealthy(page, records.coveragePlan.route, "Coverage");
    await expectRouteHealthy(page, records.project.route, "Project");
  });
});
