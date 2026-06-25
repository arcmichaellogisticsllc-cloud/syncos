import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { actionStates } from "../fixtures/action-states";
import { readE2EManifest } from "../helpers/manifest";
import { installStoredSession } from "../helpers/auth";
import { openAction, expectModal, cancelModal } from "../helpers/modal";
import { expectRouteHealthy } from "../helpers/page-assertions";
import { countTables } from "../helpers/db";

const manifest = readE2EManifest();

/**
 * For each action state, captures table counts before opening the action modal,
 * then opens and cancels the modal, then verifies that every forbidden table
 * count is unchanged.
 *
 * This confirms that:
 *  - Navigating to the route does not create downstream records
 *  - Opening the modal does not create downstream records
 *  - Cancelling the modal does not create downstream records
 *
 * Tests do NOT submit modals. Submit-path boundary enforcement is tracked
 * separately under submitCertificationStatus on each ActionState.
 */

test.describe("Action-state boundaries — open/cancel must not mutate forbidden tables", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  for (const state of actionStates) {
    if (state.forbiddenTables.length === 0) continue;

    test(`[${state.domain}] ${state.stateKey}: cancel does not mutate forbidden tables`, async ({ page }) => {
      const before = await countTables(manifest.tenant.id, state.forbiddenTables);

      await installStoredSession(page, personas.systemAdmin.storageState);
      await page.goto(state.route);

      await expectRouteHealthy(page, state.route, state.objectType);

      await expect(
        page.getByRole("button", { name: state.expectedActionLabel }),
      ).toBeVisible({ timeout: 15_000 });

      await openAction(page, state.expectedActionLabel);
      await expectModal(page, state.expectedModalTitle);
      await cancelModal(page);

      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

      const after = await countTables(manifest.tenant.id, state.forbiddenTables);

      for (const table of state.forbiddenTables) {
        expect(after[table], `${table} count must not change after cancel on ${state.stateKey}`).toBe(before[table]);
      }
    });
  }
});
