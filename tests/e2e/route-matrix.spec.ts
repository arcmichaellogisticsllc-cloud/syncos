import { test } from "@playwright/test";
import { personas } from "./fixtures/personas";
import { routeMatrix } from "./fixtures/route-matrix";
import { expectRouteHealthy } from "./helpers/page-assertions";

test.describe("Browser E2E route matrix", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  for (const entry of routeMatrix) {
    test(`${entry.group}: ${entry.route}`, async ({ page }) => {
      await expectRouteHealthy(page, entry.route, entry.expectedText);
    });
  }
});
