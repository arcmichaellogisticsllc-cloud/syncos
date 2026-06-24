import { expect, type APIRequestContext } from "@playwright/test";
import { authHeaders } from "./auth";

export async function apiGet<T>(request: APIRequestContext, storageStatePath: string, path: string): Promise<T> {
  const response = await request.get(apiUrl(path), { headers: authHeaders(storageStatePath) });
  expect(response.status(), `GET ${path}`).toBeLessThan(400);
  return await response.json() as T;
}

export async function apiPost<T>(request: APIRequestContext, storageStatePath: string, path: string, body: unknown = {}): Promise<T> {
  const response = await request.post(apiUrl(path), { headers: authHeaders(storageStatePath), data: body });
  expect(response.status(), `POST ${path}`).toBeLessThan(400);
  return await response.json() as T;
}

export async function expectApiDenied(request: APIRequestContext, storageStatePath: string, method: "POST" | "PATCH", path: string, body: unknown = {}) {
  const response = method === "POST"
    ? await request.post(apiUrl(path), { headers: authHeaders(storageStatePath), data: body })
    : await request.patch(apiUrl(path), { headers: authHeaders(storageStatePath), data: body });
  expect([401, 403], `${method} ${path} should be denied`).toContain(response.status());
}

function apiUrl(path: string): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is required for E2E API helpers");
  return `${base}/${path.replace(/^\//, "")}`;
}
