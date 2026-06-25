import { expect, type Page } from "@playwright/test";
import { expectRouteHealthy } from "./page-assertions";

function classifyHydration(text: string, values: string[]): string {
  if (values.some((v) => text.includes(v))) return "hydrated";
  if (text.includes("Sign in with a valid SyncOS token to continue.")) return "auth-denied: API returned 401 — check SYNCOS_API_BASE_URL and AUTH_JWT_SECRET match";
  if (text.includes("Cannot GET")) return "api-error: route not found on backend — check SYNCOS_API_BASE_URL and compiled dist";
  if (/Paste a JWT/.test(text)) return "session-prompt: workspace showing manual auth panel, localStorage token not applied";
  return "app-shell-only: no seeded data, no error, no session prompt detected";
}

export async function expectSeededDetailHydrated(page: Page, route: string, seeded: { id: string; name: string; objectType: string }, domainHints: string[] = []) {
  await expectRouteHealthy(page, route, seeded.objectType);
  const body = page.locator("body");
  const values = [seeded.name, seeded.id, ...domainHints].filter(Boolean);
  await expect
    .poll(
      async () => {
        const text = await body.innerText();
        return classifyHydration(text, values);
      },
      { message: `${route} should render seeded data (name/id/hints), not only the app shell`, timeout: 30_000 },
    )
    .toBe("hydrated");
}

export async function expectBoundaryCopy(page: Page, text: RegExp | string) {
  await expect(page.locator("body")).toContainText(text);
}
