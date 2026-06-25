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
      await installStoredSession(page, personas.systemAdmin.storageState);
      await page.goto(state.route);

      await expectRouteHealthy(page, state.route, state.objectType);

      // Label or ID visible in page body — proves record hydrated, not just shell
      const body = page.locator("body");
      await expect
        .poll(
          async () => {
            const text = await body.innerText();
            return text.includes(state.label) || text.includes(state.recordId) ? "hydrated" : "pending";
          },
          { message: `${state.route} must render seeded label or ID`, timeout: 30_000 },
        )
        .toBe("hydrated");

      // The primary action CTA for this state must be present
      await expect(
        page.getByRole("button", { name: state.expectedActionLabel }),
      ).toBeVisible({ timeout: 15_000 });
    });
  }
});
