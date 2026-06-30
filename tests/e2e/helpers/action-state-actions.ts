import { expect, type Locator, type Page } from "@playwright/test";
import type { ActionState } from "../fixtures/action-states";

type ActionStateLike = Pick<ActionState, "expectedActionLabel" | "stateKey">;

type ActionButtonOptions = {
  requireEnabled?: boolean;
  timeout?: number;
};

export async function actionButtonForState(
  page: Page,
  state: ActionStateLike,
  options: ActionButtonOptions = {},
): Promise<Locator> {
  return locateActionButton(page, state.expectedActionLabel, state.stateKey, options);
}

export async function actionButtonForLabel(
  page: Page,
  label: string | RegExp,
  options: ActionButtonOptions = {},
): Promise<Locator> {
  return locateActionButton(page, label, String(label), options);
}

export async function expectActionButtonVisible(page: Page, state: ActionStateLike, options: ActionButtonOptions = {}) {
  const button = await actionButtonForState(page, state, options);
  await expect(button, `Action should be visible: ${state.stateKey}`).toBeVisible({ timeout: options.timeout ?? 30_000 });
  if (options.requireEnabled) {
    await expect(button, `Action should be enabled: ${state.stateKey}`).toBeEnabled({ timeout: options.timeout ?? 30_000 });
  }
}

export async function expectActionButtonAbsentOrDisabled(page: Page, state: ActionStateLike) {
  const buttons = page.getByRole("button", { name: state.expectedActionLabel });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await isExcludedAction(button)) continue;
    if (!(await button.isVisible().catch(() => false))) continue;
    await expect(button, `Read-only action should be disabled: ${state.stateKey}`).toBeDisabled({ timeout: 5_000 });
  }
}

async function locateActionButton(
  page: Page,
  label: string | RegExp,
  stateKey: string | undefined,
  options: ActionButtonOptions,
): Promise<Locator> {
  const timeout = options.timeout ?? 30_000;
  await expect
    .poll(() => visibleCandidateCount(page, label), {
      message: `Action should be visible: ${stateKey ?? String(label)}`,
      timeout,
    })
    .toBeGreaterThan(0);

  const scopedButton = await chooseButton(page.locator(".form-actions").getByRole("button", { name: label }), options.requireEnabled);
  if (scopedButton) return scopedButton;

  const pageButton = await chooseButton(page.getByRole("button", { name: label }), options.requireEnabled);
  if (pageButton) return pageButton;

  throw new Error(`No ${options.requireEnabled ? "enabled " : ""}visible action button found for ${stateKey ?? String(label)}`);
}

async function visibleCandidateCount(page: Page, label: string | RegExp) {
  const buttons = page.getByRole("button", { name: label });
  const count = await buttons.count();
  let visible = 0;
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await isExcludedAction(button)) continue;
    if (await button.isVisible().catch(() => false)) visible += 1;
  }
  return visible;
}

async function chooseButton(buttons: Locator, requireEnabled = false): Promise<Locator | null> {
  const count = await buttons.count();
  const visible: Locator[] = [];
  const enabled: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await isExcludedAction(button)) continue;
    if (!(await button.isVisible().catch(() => false))) continue;
    visible.push(button);
    if (await button.isEnabled().catch(() => false)) enabled.push(button);
  }

  if (enabled.length > 0) {
    // Duplicate action labels can appear in both the primary toolbar and a detail panel.
    // DOM order is intentional here: the primary toolbar is rendered before secondary panels.
    return enabled[0];
  }
  if (!requireEnabled && visible.length > 0) return visible[0];
  return null;
}

async function isExcludedAction(button: Locator) {
  return button.evaluate((element) => Boolean(element.closest("[role='dialog'], .modal-backdrop, .modal-card, .modal-panel, .tabs, [role='tablist']"))).catch(() => false);
}
