import crypto from "node:crypto";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const AUTH_JWT_SECRET_MIN_LENGTH = 32;

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

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function validatePassword(password: string): string | null {
  if (!password) return "password is required";
  if (password.length < PASSWORD_MIN_LENGTH) return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  return null;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split("$");
  if (parts.length === 3 && parts[0] === "scrypt") {
    const [, salt, expectedHash] = parts;
    const actual = Buffer.from(crypto.scryptSync(password, salt, 64).toString("base64url"));
    const expected = Buffer.from(expectedHash);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const actual = Buffer.from(crypto.createHash("sha256").update(password).digest("hex"));
    const expected = Buffer.from(storedHash);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  return false;
}
