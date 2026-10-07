import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { actionStates } from "../fixtures/action-states";
import { installStoredSession } from "../helpers/auth";
import { openAction, expectModal, expectRequiredFields, cancelModal } from "../helpers/modal";
import { expectRouteHealthy } from "../helpers/page-assertions";
import { actionButtonForLabel, expectActionButtonVisible } from "../helpers/action-state-actions";

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
    test(`[${state.domain}] ${state.stateKey}: modal opens and cancels cleanly`, async ({ page }, testInfo) => {
      // Modals run mid-suite under sustained load; triple timeout for resilience
      test.slow();
      await installStoredSession(page, Object.values(personas).find(persona => persona.slug === state.persona)!.storageState);
      await expectRouteHealthy(page, state.route, state.objectType);

      // Ensure action button is present before clicking
      await expectActionButtonVisible(page, state, { timeout: 60_000 });

      const trigger = await actionButtonForLabel(page, state.expectedActionLabel, { requireEnabled: true });
      await openAction(page, state.expectedActionLabel);
      await expectModal(page, state.expectedModalTitle);

      for(const label of state.visibleFields??[])await expect(page.getByLabel(label).first()).toBeVisible();
      if (state.requiredFields.length > 0) {
        await expectRequiredFields(page, state.requiredFields);
      }

      const dialog = page.getByRole("dialog");
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toHaveAccessibleName(state.expectedModalTitle);
      await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      const controls = dialog.locator('button:visible:not(:disabled),input:visible:not(:disabled),select:visible:not(:disabled),textarea:visible:not(:disabled),a[href]:visible').filter({visible:true});
      await controls.last().focus();
      await page.keyboard.press("Tab");
      await expect(controls.first()).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(controls.last()).toBeFocused();
      await testInfo.attach(`${state.stateKey}-open`,{body:await page.screenshot(),contentType:'image/png'});
      await cancelModal(page);

      // Modal must close — no residual dialog
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await testInfo.attach(`${state.stateKey}-cancelled`,{body:await page.screenshot(),contentType:'image/png'});
    });
  }
});
