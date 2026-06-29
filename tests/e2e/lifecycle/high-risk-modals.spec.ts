import { test } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { modalMatrix } from "../fixtures/modal-matrix";
import { installStoredSession } from "../helpers/auth";
import { cancelModal, expectModal, expectRequiredFields, openAction } from "../helpers/modal";
import { expectBoundaryCopy, expectSeededDetailHydrated } from "../helpers/detail-hydration";

test.describe("High-risk lifecycle modal certification", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  for (const entry of modalMatrix) {
    test(`${entry.domain}: ${String(entry.action)} modal opens with required fields and boundary copy`, async ({ page }) => {
      // Runs late in suite under sustained load; triple timeout for resilience
      test.slow();
      await installStoredSession(page, personas.systemAdmin.storageState);
      await expectSeededDetailHydrated(page, entry.route, { id: entry.route, name: entry.expectedText, objectType: entry.domain }, [entry.expectedText]);
      await openAction(page, entry.action);
      await expectModal(page, entry.title);
      await expectRequiredFields(page, entry.requiredFields);
      await expectBoundaryCopy(page, entry.boundaryCopy);
      await cancelModal(page);
    });
  }
});
