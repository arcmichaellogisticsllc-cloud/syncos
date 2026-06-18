import crypto from "node:crypto";

export type AuthenticatedPrincipal = {
  tenantId: string;
  userId: string;
  email?: string;
};

export type AuthTokenClaims = {
  sub: string;
  tenant_id: string;
  email?: string;
  exp?: number;
  iat?: number;
};

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value));
}

function parseBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function sign(input: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

export function createAuthToken(claims: AuthTokenClaims, secret: string): string {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({ ...claims, iat: claims.iat ?? Math.floor(Date.now() / 1000) });
  const signature = sign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyAuthToken(token: string, secret: string): AuthTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [header, payload, signature] = parts;
  const expectedSignature = sign(`${header}.${payload}`, secret);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Invalid token signature");
  }

  const parsedHeader = parseBase64UrlJson<{ alg: string; typ: string }>(header);
  if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") {
    throw new Error("Unsupported token header");
  }

  const claims = parseBase64UrlJson<AuthTokenClaims>(payload);
  if (!claims.sub || !claims.tenant_id) {
    throw new Error("Token missing required claims");
  }

  if (claims.exp && claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return claims;
}
