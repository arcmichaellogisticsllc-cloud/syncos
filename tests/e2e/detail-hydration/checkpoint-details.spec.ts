import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { detailCheckpoints } from "../fixtures/detail-checkpoints";
import { expectSeededDetailHydrated } from "../helpers/detail-hydration";
import { installStoredSession } from "../helpers/auth";

test.describe("Seeded detail hydration", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  for (const checkpoint of detailCheckpoints) {
    test(`${checkpoint.objectType} detail renders seeded checkpoint data`, async ({ page }) => {
      await installStoredSession(page, personas.systemAdmin.storageState);
      await expectSeededDetailHydrated(page, checkpoint.route, checkpoint, checkpoint.hints);
    });
  }
});
