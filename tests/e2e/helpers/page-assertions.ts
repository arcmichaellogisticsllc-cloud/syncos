import { expect, type Page } from "@playwright/test";

const fatalPatterns = [
  /Unhandled Runtime Error/i,
  /Application error/i,
  /This page could not be found/i,
  /404 Not Found/i,
  /500 Internal Server Error/i,
  /Internal server error/i,
  /"statusCode"\s*:\s*500/i,
  /Hydration failed/i,
];

export async function expectRouteHealthy(page: Page, route: string, expectedText?: string) {
  let response;
  try {
    response = await page.goto(route, { waitUntil: "domcontentloaded" });
  } catch {
    // Retry once on transient navigation errors (ERR_ABORTED under load)
    await page.waitForTimeout(3_000);
    response = await page.goto(route, { waitUntil: "domcontentloaded" });
  }
  expect(response?.status(), `${route} should return a successful HTTP status`).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
  for (const pattern of fatalPatterns) {
    await expect(page.locator("body"), `${route} should not show ${pattern}`).not.toContainText(pattern);
  }
  if (expectedText) {
    await expect(page.locator("body"), `${route} should include ${expectedText}`).toContainText(new RegExp(escapeRegExp(expectedText), "i"));
  }
}

export async function expectAnyText(page: Page, values: string[]) {
  const body = page.locator("body");
  await expect(body).toBeVisible();
  const text = await body.innerText();
  expect(values.some((value) => text.toLowerCase().includes(value.toLowerCase())), `Expected body to include one of: ${values.join(", ")}`).toBe(true);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
