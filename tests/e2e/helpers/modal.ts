import { expect, type Page } from "@playwright/test";

export async function openAction(page: Page, name: string | RegExp) {
  const button = page.getByRole("button", { name }).first();
  await expect(button, `Action should be visible: ${String(name)}`).toBeVisible();
  await expect(button, `Action should be enabled: ${String(name)}`).toBeEnabled();
  await button.click();
}

export async function expectModal(page: Page, title: string | RegExp) {
  const modal = page.locator("[role='dialog'], .modal-backdrop, .modal-panel, .modal-card").last();
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(title);
  return modal;
}

export async function expectRequiredFields(page: Page, labels: Array<string | RegExp>) {
  for (const label of labels) {
    await expect(page.getByLabel(label).first(), `Required field should be present: ${String(label)}`).toBeVisible();
  }
}

export async function cancelModal(page: Page) {
  await page.getByRole("button", { name: /cancel|close/i }).last().click();
}
