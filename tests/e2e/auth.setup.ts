import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { personaList } from "./fixtures/personas";

type Manifest = {
  tenant: { id: string };
  personas: Record<string, { userId: string; email: string }>;
};

export default async function globalSetup(_config: FullConfig) {
  const apiBaseUrl = process.env.API_BASE_URL;
  const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3138";
  const secret = process.env.AUTH_JWT_SECRET;
  if (!apiBaseUrl) throw new Error("API_BASE_URL is required for Browser E2E auth setup");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required for Browser E2E auth setup");

  const manifest = readManifest();
  fs.mkdirSync(path.join(process.cwd(), "tests/e2e/.auth"), { recursive: true });

  for (const persona of personaList) {
    const seeded = manifest.personas[persona.slug];
    if (!seeded) throw new Error(`Missing seeded persona in manifest: ${persona.slug}`);
    const token = createToken({ sub: seeded.userId, tenant_id: manifest.tenant.id, email: seeded.email }, secret);
    const response = await fetch(`${apiBaseUrl}/auth/me/permissions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Auth setup failed for ${persona.slug}: ${response.status} ${await response.text()}`);
    }
    const permissionsPayload = await response.json() as { permissions?: string[] };
    const permissions = permissionsPayload.permissions ?? [];
    if (!permissions.length) throw new Error(`Auth setup produced no permissions for ${persona.slug}`);
    const storageState = {
      cookies: [],
      origins: [
        {
          origin: webBaseUrl,
          localStorage: [
            { name: "syncos.apiToken", value: token },
            { name: "syncos.permissions", value: permissions.join(",") },
          ],
        },
      ],
    };
    fs.writeFileSync(path.join(process.cwd(), persona.storageState), `${JSON.stringify(storageState, null, 2)}\n`);
  }
}

function readManifest(): Manifest {
  const file = path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json");
  if (!fs.existsSync(file)) throw new Error("E2E demo manifest missing. Run npm run seed:e2e-demo first.");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

function createToken(claims: { sub: string; tenant_id: string; email: string }, secret: string): string {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({ ...claims, iat: Math.floor(Date.now() / 1000) });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
