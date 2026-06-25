import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { actionStates } from "../fixtures/action-states";
import { installStoredSession } from "../helpers/auth";
import { openAction, expectModal, expectRequiredFields, cancelModal } from "../helpers/modal";
import { expectRouteHealthy } from "../helpers/page-assertions";

/**
 * For each action state:
 *  1. Navigates to the pre-seeded route
 *  2. Clicks the expected action button
 *  3. Asserts the modal title matches
 *  4. Asserts any declared required fields are present
 *  5. Cancels the modal — no submission, no side-effects
 *
 * Goal: prove open/cancel round-trip is safe. Submit certification is a
 * separate concern tracked by submitCertificationStatus on each ActionState.
 */

test.describe("Action-state modals — open, inspect, cancel", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  for (const state of actionStates) {
    test(`[${state.domain}] ${state.stateKey}: modal opens and cancels cleanly`, async ({ page }) => {
      await installStoredSession(page, personas.systemAdmin.storageState);
      await page.goto(state.route);

      await expectRouteHealthy(page, state.route, state.objectType);

      // Ensure action button is present before clicking
      await expect(
        page.getByRole("button", { name: state.expectedActionLabel }),
      ).toBeVisible({ timeout: 15_000 });

      await openAction(page, state.expectedActionLabel);
      await expectModal(page, state.expectedModalTitle);

      if (state.requiredFields.length > 0) {
        await expectRequiredFields(page, state.requiredFields);
      }

      await cancelModal(page);

      // Modal must close — no residual dialog
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
    });
  }
});
