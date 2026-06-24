import { expect, type Page } from "@playwright/test";
import { expectRouteHealthy } from "./page-assertions";

export async function expectSeededDetailHydrated(page: Page, route: string, seeded: { id: string; name: string; objectType: string }, domainHints: string[] = []) {
  await expectRouteHealthy(page, route, seeded.objectType);
  const body = page.locator("body");
  const values = [seeded.name, seeded.id, ...domainHints].filter(Boolean);
  await expect
    .poll(
      async () => {
        const text = await body.innerText();
        return values.some((value) => text.includes(value)) ? "hydrated" : "pending";
      },
      { message: `${route} should render seeded data, not only the app shell`, timeout: 30_000 },
    )
    .toBe("hydrated");
}

export async function expectBoundaryCopy(page: Page, text: RegExp | string) {
  await expect(page.locator("body")).toContainText(text);
}
