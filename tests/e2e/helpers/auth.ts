import fs from "node:fs";
import type { Page } from "@playwright/test";

export function readStorageToken(storageStatePath: string): string {
  const state = JSON.parse(fs.readFileSync(storageStatePath, "utf8")) as {
    origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
  };
  const token = state.origins?.flatMap((origin) => origin.localStorage ?? []).find((entry) => entry.name === "syncos.apiToken")?.value;
  if (!token) throw new Error(`No syncos.apiToken found in ${storageStatePath}`);
  return token;
}

export function authHeaders(storageStatePath: string): Record<string, string> {
  return {
    authorization: `Bearer ${readStorageToken(storageStatePath)}`,
    "content-type": "application/json",
  };
}

export function readStorageSession(storageStatePath: string): { token: string; permissions: string } {
  const state = JSON.parse(fs.readFileSync(storageStatePath, "utf8")) as {
    origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
  };
  const entries = state.origins?.flatMap((origin) => origin.localStorage ?? []) ?? [];
  const token = entries.find((entry) => entry.name === "syncos.apiToken")?.value;
  const permissions = entries.find((entry) => entry.name === "syncos.permissions")?.value;
  if (!token || !permissions) throw new Error(`No SyncOS browser session found in ${storageStatePath}`);
  return { token, permissions };
}

export async function installStoredSession(page: Page, storageStatePath: string) {
  const session = readStorageSession(storageStatePath);
  await page.addInitScript((nextSession) => {
    window.localStorage.setItem("syncos.apiToken", nextSession.token);
    window.localStorage.setItem("syncos.permissions", nextSession.permissions);
  }, session);
  if (page.url().startsWith("http")) {
    await page.evaluate((nextSession) => {
      window.localStorage.setItem("syncos.apiToken", nextSession.token);
      window.localStorage.setItem("syncos.permissions", nextSession.permissions);
    }, session);
  }
}
