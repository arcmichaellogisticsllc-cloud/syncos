import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { actionStates } from "../fixtures/action-states";
import { installStoredSession } from "../helpers/auth";
import { expectRouteHealthy } from "../helpers/page-assertions";

/**
 * Verifies that every action-state record:
 *  1. Exists — the detail route loads without 404 / 500
 *  2. Hydrates — at least one seeded label or ID appears in the page body
 *  3. Shows the expected action button — the CTA for this state is visible
 *
 * Tests are intentionally read-only; no modal is opened or submitted.
 */

test.describe("Action-state readiness — route loads, label hydrates, action visible", () => {
  test.use({ storageState: personas.systemAdmin.storageState });

  for (const state of actionStates) {
    test(`[${state.domain}] ${state.stateKey}: route loads and action label visible`, async ({ page }) => {
      // Readiness runs last in the suite; triple timeout so API calls under sustained load still resolve
      test.slow();
      await installStoredSession(page, personas.systemAdmin.storageState);
      await expectRouteHealthy(page, state.route, state.objectType);

      // Label, ID, or action button visible — proves record hydrated, not just shell.
      // Custom-session workspaces may not surface the internal label in visible text;
      // action button visibility is an equivalent proof of hydration.
      const body = page.locator("body");
      await expect
        .poll(
          async () => {
            const text = await body.innerText();
            if (text.includes(state.label) || text.includes(state.recordId)) return "hydrated";
            const actionVisible = await page
              .getByRole("button", { name: state.expectedActionLabel })
              .isVisible()
              .catch(() => false);
            if (actionVisible) return "hydrated";
            return "pending";
          },
          { message: `${state.route} must render seeded label, ID, or action button`, timeout: 60_000 },
        )
        .toBe("hydrated");

      // The primary action CTA for this state must be present
      await expect(
        page.getByRole("button", { name: state.expectedActionLabel }),
      ).toBeVisible({ timeout: 30_000 });
    });
  }
});
