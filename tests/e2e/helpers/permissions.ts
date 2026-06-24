import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectApiDenied } from "./api";

export async function expectNavVisible(page: Page, labels: string[]) {
  for (const label of labels) {
    await expect(page.locator("body")).toContainText(new RegExp(label, "i"));
  }
}

export async function expectStoredPermission(page: Page, permission: string) {
  const permissions = await page.evaluate(() => window.localStorage.getItem("syncos.permissions") ?? "");
  expect(permissions).toContain(permission);
}

export async function expectStoredPermissionAbsent(page: Page, permission: string) {
  const permissions = await page.evaluate(() => window.localStorage.getItem("syncos.permissions") ?? "");
  expect(permissions).not.toContain(permission);
}

export async function expectBackendDenied(request: APIRequestContext, storageStatePath: string, method: "POST" | "PATCH", path: string, body: unknown = {}) {
  await expectApiDenied(request, storageStatePath, method, path, body);
}
