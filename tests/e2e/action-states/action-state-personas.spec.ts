import { test, expect } from "@playwright/test";
import { personas } from "../fixtures/personas";
import { actionStates } from "../fixtures/action-states";
import { installStoredSession } from "../helpers/auth";
import { expectRouteHealthy } from "../helpers/page-assertions";
import { expectBackendDenied } from "../helpers/permissions";

/**
 * Persona-scoped readiness checks:
 *
 * 1. The natural persona for each action state can reach the route and sees the
 *    expected action button (positive path).
 * 2. The read-only auditor can reach the same route but does NOT see any
 *    write/action buttons (negative path).
 *
 * This is a foundation-level persona check. Full cross-persona permission matrix
 * certification (e.g. finance-user cannot approve QC) is tracked in the gap
 * backlog and requires persona-specific auth storage states.
 */

const READ_ONLY = personas.readOnlyAuditor;

test.describe("Action-state personas — natural persona sees action, read-only does not", () => {
  for (const state of actionStates) {
    const naturalPersona = Object.values(personas).find((p) => p.slug === state.persona);
    if (!naturalPersona) continue;

    test.describe(`[${state.domain}] ${state.stateKey}`, () => {
      test("natural persona sees action button", async ({ page }) => {
        await installStoredSession(page, naturalPersona.storageState);
        await page.goto(state.route);
        await expectRouteHealthy(page, state.route, state.objectType);

        await expect(
          page.getByRole("button", { name: state.expectedActionLabel }),
        ).toBeVisible({ timeout: 15_000 });
      });

      test("read-only auditor: route loads but action button hidden or disabled", async ({ page }) => {
        await installStoredSession(page, READ_ONLY.storageState);
        await page.goto(state.route);

        // Route must still load — auditor has read access
        await expectRouteHealthy(page, state.route, state.objectType);

        // Action button must be absent or disabled for read-only user
        const actionBtn = page.getByRole("button", { name: state.expectedActionLabel });
        const count = await actionBtn.count();
        if (count > 0) {
          await expect(actionBtn).toBeDisabled({ timeout: 5_000 });
        }
        // If count === 0 the button is hidden, which also satisfies the assertion
      });
    });
  }
});

/**
 * Backend denial smoke: verify that the read-only auditor cannot perform
 * write operations via the API even if they somehow reach the endpoint.
 *
 * Tests a representative sample using the most common lifecycle patterns.
 */
test.describe("Action-state personas — backend denies writes for read-only auditor", () => {
  test.use({ storageState: READ_ONLY.storageState });

  const sampleStates = actionStates.filter((s) =>
    ["prodDraft", "invoiceApproved", "settlementDraft", "aexDraft"].includes(s.stateKey),
  );

  for (const state of sampleStates) {
    test(`[${state.domain}] ${state.stateKey}: backend denies write as read-only`, async ({ request }) => {
      await expectBackendDenied(request, READ_ONLY.storageState, "POST", `/${state.objectType.replace(/_/g, "-")}s/${state.recordId}/actions`);
    });
  }
});
