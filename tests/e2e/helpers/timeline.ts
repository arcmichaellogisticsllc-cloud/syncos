import { expect, type APIRequestContext } from "@playwright/test";
import { apiGet } from "./api";

type TimelineEvent = { event_type?: string; action?: string; aggregate_type?: string; created_at?: string };

export async function expectTimelineHasEvent(request: APIRequestContext, storageStatePath: string, path: string, eventPattern: RegExp) {
  const rows = await apiGet<TimelineEvent[]>(request, storageStatePath, path);
  expect(Array.isArray(rows), `${path} should return timeline rows`).toBe(true);
  expect(rows.length, `${path} timeline should not be empty`).toBeGreaterThan(0);
  expect(rows.some((row) => eventPattern.test(String(row.event_type ?? row.action ?? ""))), `${path} should include ${eventPattern}`).toBe(true);
}

export async function expectTimelineReadable(request: APIRequestContext, storageStatePath: string, path: string) {
  const rows = await apiGet<TimelineEvent[]>(request, storageStatePath, path);
  expect(Array.isArray(rows), `${path} should return timeline rows`).toBe(true);
}

export async function expectAuditAllowed(request: APIRequestContext, storageStatePath: string, path: string) {
  const rows = await apiGet<unknown[]>(request, storageStatePath, path);
  expect(Array.isArray(rows), `${path} should return audit rows`).toBe(true);
}

export async function expectAuditDenied(request: APIRequestContext, storageStatePath: string, path: string) {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required for E2E audit helpers");
  const { authHeaders } = await import("./auth");
  const response = await request.get(`${base}/${path.replace(/^\//, "")}`, { headers: authHeaders(storageStatePath) });
  expect([401, 403], `${path} should deny audit access`).toContain(response.status());
}
