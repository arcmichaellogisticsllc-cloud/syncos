import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Growth to Opportunity", () => {
  test.use({ storageState: personas.growthOperator.storageState });

  test("opens Cedar Ridge growth records in order", async ({ page }) => {
    await expectRouteHealthy(page, records.signal.route, "Signal");
    await expectRouteHealthy(page, records.organization.route, "Organization");
    await expectRouteHealthy(page, records.contact.route, "Contact");
    await expectRouteHealthy(page, records.relationshipMap.route, "Relationship");
    await expectRouteHealthy(page, records.opportunityCandidate.route, "Candidate");
    await expectRouteHealthy(page, records.opportunity.route, "Opportunity");
  });
});
