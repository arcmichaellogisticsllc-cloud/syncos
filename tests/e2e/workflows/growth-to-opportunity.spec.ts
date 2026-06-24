import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { expectRouteHealthy } from "../helpers/page-assertions";

const records = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")).records;

test.describe("Critical skeleton: Growth to Opportunity", () => {
  test.use({ storageState: personas.growthOperator.storageState });

  for (const step of [
    ["Signal", records.signal.route, "Signal"],
    ["Organization", records.organization.route, "Organization"],
    ["Contact", records.contact.route, "Contact"],
    ["Relationship Map", records.relationshipMap.route, "Relationship"],
    ["Opportunity Candidate", records.opportunityCandidate.route, "Candidate"],
    ["Opportunity", records.opportunity.route, "Opportunity"],
  ] as const) {
    test(`opens Cedar Ridge ${step[0]} record`, async ({ page }) => {
      await expectRouteHealthy(page, step[1], step[2]);
    });
  }
});
